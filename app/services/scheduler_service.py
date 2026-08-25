from datetime import datetime, timedelta, timezone
import json

from app.db import (
    delete_push_subscription,
    has_successful_dispatch,
    list_enabled_hydration_settings,
    list_push_subscriptions,
    list_due_event_candidates,
    save_dispatch,
    update_hydration_last_sent,
)
from app.services.notifier import (
    send_desktop_notification,
    send_web_push,
)


# Quando a última varredura terminou. Fica em memória e não no banco: é
# diagnóstico DESTE processo — "o agendador está girando?" — e gravar no banco
# a cada 60s tornaria a resposta indistinguível entre um processo vivo e um
# recém-nascido que leu o valor deixado pelo anterior.
_last_scan_at: datetime | None = None


def scheduler_status() -> dict:
    """Frescor da varredura, para o /healthz.

    `null` significa que o processo subiu e ainda não completou a primeira
    rodada — normal no primeiro minuto, sinal de problema depois disso.
    """
    if _last_scan_at is None:
        return {"lastScanSeconds": None}
    return {"lastScanSeconds": int((datetime.now(timezone.utc) - _last_scan_at).total_seconds())}


def run_scan(app) -> None:
    """Uma rodada do agendador: lembretes de evento e de água.

    As duas rotinas rodam em try/except separados de propósito. Antes eram uma
    tupla — `(process_due_reminders(app), process_hydration_reminder(app))` —
    e uma exceção na primeira impedia a segunda de rodar, então uma falha
    passageira nos eventos calava também o lembrete de água, sem sinal nenhum.
    """
    global _last_scan_at

    # O rótulo é fixo e não `rotina.__name__`: isto roda no caminho de erro, e
    # o que não pode acontecer ali é a linha de log estourar e esconder a
    # exceção de verdade. De quebra, o log fica legível.
    rotinas = (
        ("lembretes de evento", process_due_reminders),
        ("lembrete de água", process_hydration_reminder),
    )

    for rotulo, rotina in rotinas:
        try:
            rotina(app)
        except Exception:
            app.logger.exception("Falha em %s; a varredura continua.", rotulo)

    _last_scan_at = datetime.now(timezone.utc)


HYDRATION_TITLE = "MOMO BEBA ÁGUA 💗"
HYDRATION_BODY = "Meu amorzinho, hora de BEBER ÁGUA <3"


def _parse_event_datetime(raw_value: str):
    try:
        value = (raw_value or "").strip()
        if len(value) == 10 and "T" not in value:
            value = f"{value}T09:00"
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _build_reminders(event_dt: datetime, reminder_rule: str):
    """Cronograma de avisos da tag do evento.

    A regra vem da tag e não mais de `tag_type == "curso"`: com tags criadas
    pelo usuário, o nome da tag deixou de dizer quantos lembretes ela arma.
    Os nomes `course_*` ficaram porque são a chave gravada em
    `reminder_dispatches` — trocá-los reenviaria todo aviso já disparado.
    """
    reminders = [("event_now", event_dt)]
    if reminder_rule == "curso":
        reminders.append(("course_15_days", event_dt - timedelta(days=15)))
        reminders.append(("course_7_days", event_dt - timedelta(days=7)))
    return reminders


def _scan_window(now: datetime):
    """Janela enxuta: de 1 dia atrás a 16 dias à frente cobre o lembrete no
    momento e os alertas antecipados (15 e 7 dias antes)."""
    return (
        (now - timedelta(days=1)).isoformat(timespec="minutes"),
        (now + timedelta(days=16)).isoformat(timespec="minutes"),
    )


def _is_due(now: datetime, trigger: datetime) -> bool:
    # Aceita execução com atraso de até 5 minutos.
    delta = (now - trigger).total_seconds()
    return 0 <= delta <= 300


def _reminder_label(reminder_type: str, tag_label: str) -> str:
    """Texto do aviso, com o nome da tag do evento em vez de "Evento"/"Curso" fixos."""
    if reminder_type == "event_now":
        return f"{tag_label} Agora"
    if reminder_type == "course_15_days":
        return f"{tag_label} em 15 Dias"
    if reminder_type == "course_7_days":
        return f"{tag_label} em 7 Dias"
    return "Lembrete"


def _build_message(event, reminder_type: str):
    label = _reminder_label(reminder_type, event["tag_label"])
    event_dt = _parse_event_datetime(event["event_datetime"])
    when_text = event_dt.strftime("%d/%m/%Y %H:%M") if event_dt else event["event_datetime"]

    subject = "MOMO LEMBRETE 💗"
    body = (
        f"Meu amorzinho, lembrete: {label}\n"
        f"{event['title']}\n"
        f"Quando: {when_text}\n"
        f"{event['description'] or 'Sem descrição'}"
    )
    return subject, body


def process_due_reminders(app):
    """Varre os eventos de TODAS as contas e entrega a cada uma a sua.

    A varredura é global porque o agendador roda fora de requisição, sem
    sessão. O recorte por conta acontece no envio: as inscrições de push são
    buscadas com o `user_id` que veio na linha do evento, então o lembrete de
    uma pessoa nunca sai pelo canal de outra.
    """
    now = datetime.now()
    window_start, window_end = _scan_window(now)

    # As inscrições são lidas uma vez por conta e reaproveitadas: um mês cheio
    # de eventos daria uma consulta por evento sem isto.
    subscriptions_by_user = {}

    for event in list_due_event_candidates(window_start, window_end):
        event_dt = _parse_event_datetime(event["event_datetime"])
        if not event_dt:
            continue

        user_id = event["user_id"]

        for reminder_type, trigger_dt in _build_reminders(event_dt, event["reminder_rule"]):
            if not _is_due(now, trigger_dt):
                continue

            subject, body = _build_message(event, reminder_type)
            push_payload = json.dumps(
                {
                    "title": subject,
                    "body": body,
                    "icon": "/static/icon.svg",
                    "tag": f"event-{event['id']}-{reminder_type}",
                }
            )

            channels = []
            if app.config.get("ENABLE_DESKTOP_NOTIFICATIONS", True):
                channels.append(("desktop", lambda: send_desktop_notification(subject, body, exact_title=True)))

            if user_id not in subscriptions_by_user:
                subscriptions_by_user[user_id] = list_push_subscriptions(user_id)
            subscriptions = subscriptions_by_user[user_id]

            if subscriptions:
                def _send_all_pushes(subscriptions=subscriptions, user_id=user_id, push_payload=push_payload):
                    successes = 0
                    failures = 0
                    for sub in subscriptions:
                        subscription_info = {
                            "endpoint": sub["endpoint"],
                            "keys": {
                                "p256dh": sub["p256dh"],
                                "auth": sub["auth"],
                            },
                        }
                        ok, msg = send_web_push(app.config, subscription_info, push_payload)
                        if ok:
                            successes += 1
                        else:
                            failures += 1
                            if "(410" in msg or "(404" in msg:
                                delete_push_subscription(user_id, sub["endpoint"])

                    if successes > 0:
                        return True, f"Web push ok: {successes}"
                    return False, f"Web push falhou em {failures} inscrição(ões)"

                channels.append(("webpush", _send_all_pushes))

            for channel_name, action in channels:
                if has_successful_dispatch(event["id"], reminder_type, channel_name):
                    continue

                success, result_msg = action()
                save_dispatch(
                    event["id"],
                    reminder_type,
                    channel_name,
                    "success" if success else "error",
                    "" if success else result_msg,
                )


def collect_due_live_event_notifications(app, user_id: int):
    """Fila da aba aberta. Só os lembretes desta conta.

    O canal `weblive` é marcado como entregue aqui: quem pediu foi a aba da
    pessoa, e sem a marca o mesmo aviso voltaria a cada consulta.
    """
    now = datetime.now()
    window_start, window_end = _scan_window(now)

    payloads = []
    for event in list_due_event_candidates(window_start, window_end):
        if event["user_id"] != user_id:
            continue

        event_dt = _parse_event_datetime(event["event_datetime"])
        if not event_dt:
            continue

        for reminder_type, trigger_dt in _build_reminders(event_dt, event["reminder_rule"]):
            if not _is_due(now, trigger_dt):
                continue

            if has_successful_dispatch(event["id"], reminder_type, "weblive"):
                continue

            subject, body = _build_message(event, reminder_type)
            payloads.append(
                {
                    "event_id": event["id"],
                    "reminder_type": reminder_type,
                    "title": subject,
                    "body": body,
                    "icon": "/static/icon.svg",
                    "tag": f"live-{event['id']}-{reminder_type}",
                }
            )
            save_dispatch(event["id"], reminder_type, "weblive", "success", "")

    return payloads


def process_hydration_reminder(app):
    """Um lembrete de água por conta, cada uma no próprio intervalo e janela."""
    now = datetime.now()
    now_minutes = now.hour * 60 + now.minute

    for settings in list_enabled_hydration_settings():
        if not _in_hydration_window(settings, now_minutes):
            continue

        if not _hydration_interval_elapsed(settings, now):
            continue

        user_id = settings["user_id"]

        if app.config.get("ENABLE_DESKTOP_NOTIFICATIONS", True):
            send_desktop_notification(HYDRATION_TITLE, HYDRATION_BODY, exact_title=True)

        subscriptions = list_push_subscriptions(user_id)
        if subscriptions:
            payload = json.dumps(
                {
                    "title": HYDRATION_TITLE,
                    "body": HYDRATION_BODY,
                    "icon": "/static/icon.svg",
                    "tag": "hydration-reminder",
                }
            )
            for sub in subscriptions:
                subscription_info = {
                    "endpoint": sub["endpoint"],
                    "keys": {
                        "p256dh": sub["p256dh"],
                        "auth": sub["auth"],
                    },
                }
                ok, msg = send_web_push(app.config, subscription_info, payload)
                if not ok and ("(410" in msg or "(404" in msg):
                    delete_push_subscription(user_id, sub["endpoint"])

        update_hydration_last_sent(user_id, now.isoformat(timespec="seconds"))


def _in_hydration_window(settings, now_minutes: int) -> bool:
    try:
        start_h, start_m = [int(part) for part in settings["start_time"].split(":")]
        end_h, end_m = [int(part) for part in settings["end_time"].split(":")]
    except (ValueError, AttributeError):
        return False

    start_minutes = start_h * 60 + start_m
    end_minutes = end_h * 60 + end_m

    # Se cruzar meia-noite, considera janela contínua (ex: 22:30 -> 06:00).
    if start_minutes < end_minutes:
        return start_minutes <= now_minutes < end_minutes
    return now_minutes >= start_minutes or now_minutes < end_minutes


def _hydration_interval_elapsed(settings, now: datetime) -> bool:
    last_sent_at = settings["last_sent_at"]
    if not last_sent_at:
        return True

    interval_minutes = max(1, int(settings["interval_minutes"]))
    try:
        last_dt = datetime.fromisoformat(last_sent_at)
    except ValueError:
        return True
    return (now - last_dt).total_seconds() >= interval_minutes * 60
