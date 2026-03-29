from datetime import datetime, timedelta
import json

from app.db import (
    delete_push_subscription,
    get_hydration_settings,
    has_successful_dispatch,
    list_push_subscriptions,
    list_due_event_candidates,
    save_dispatch,
    update_hydration_last_sent,
)
from app.services.notifier import (
    send_desktop_notification,
    send_web_push,
)


def _parse_event_datetime(raw_value: str):
    try:
        value = (raw_value or "").strip()
        if len(value) == 10 and "T" not in value:
            value = f"{value}T09:00"
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _build_reminders(event_dt: datetime, is_course: bool):
    reminders = [("event_now", event_dt)]
    if is_course:
        reminders.append(("course_15_days", event_dt - timedelta(days=15)))
        reminders.append(("course_7_days", event_dt - timedelta(days=7)))
    return reminders


def _is_due(now: datetime, trigger: datetime) -> bool:
    # Aceita execução com atraso de até 5 minutos.
    delta = (now - trigger).total_seconds()
    return 0 <= delta <= 300


def _reminder_label(reminder_type: str) -> str:
    if reminder_type == "event_now":
        return "Evento Agora"
    if reminder_type == "course_15_days":
        return "Curso em 15 Dias"
    if reminder_type == "course_7_days":
        return "Curso em 7 Dias"
    return "Lembrete"


def _build_message(event, reminder_type: str):
    label = _reminder_label(reminder_type)
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
    now = datetime.now()
    db_path = app.config["DB_PATH"]

    # Janela enxuta: eventos de 1 dia atrás até 16 dias à frente cobrem
    # lembrete no momento e alertas de curso (15 e 7 dias antes).
    window_start = (now - timedelta(days=1)).isoformat(timespec="minutes")
    window_end = (now + timedelta(days=16)).isoformat(timespec="minutes")
    events = list_due_event_candidates(db_path, window_start, window_end)
    for event in events:
        event_dt = _parse_event_datetime(event["event_datetime"])
        if not event_dt:
            continue

        reminders = _build_reminders(event_dt, event["tag_type"] == "curso")
        for reminder_type, trigger_dt in reminders:
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

            subscriptions = list_push_subscriptions(db_path)
            if subscriptions:
                def _send_all_pushes():
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
                                delete_push_subscription(db_path, sub["endpoint"])

                    if successes > 0:
                        return True, f"Web push ok: {successes}"
                    return False, f"Web push falhou em {failures} inscrição(ões)"

                channels.append(("webpush", _send_all_pushes))

            for channel_name, action in channels:
                if has_successful_dispatch(db_path, event["id"], reminder_type, channel_name):
                    continue

                success, result_msg = action()
                status = "success" if success else "error"
                save_dispatch(
                    db_path,
                    event["id"],
                    reminder_type,
                    channel_name,
                    status,
                    "" if success else result_msg,
                )


def collect_due_live_event_notifications(app):
    now = datetime.now()
    db_path = app.config["DB_PATH"]
    window_start = (now - timedelta(days=1)).isoformat(timespec="minutes")
    window_end = (now + timedelta(days=16)).isoformat(timespec="minutes")
    events = list_due_event_candidates(db_path, window_start, window_end)

    payloads = []
    for event in events:
        event_dt = _parse_event_datetime(event["event_datetime"])
        if not event_dt:
            continue

        reminders = _build_reminders(event_dt, event["tag_type"] == "curso")
        for reminder_type, trigger_dt in reminders:
            if not _is_due(now, trigger_dt):
                continue

            if has_successful_dispatch(db_path, event["id"], reminder_type, "weblive"):
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
            save_dispatch(
                db_path,
                event["id"],
                reminder_type,
                "weblive",
                "success",
                "",
            )

    return payloads


def process_hydration_reminder(app):
    db_path = app.config["DB_PATH"]
    settings = get_hydration_settings(db_path)
    if not settings or not bool(settings["enabled"]):
        return

    now = datetime.now()
    now_minutes = now.hour * 60 + now.minute

    try:
        start_h, start_m = [int(part) for part in settings["start_time"].split(":")]
        end_h, end_m = [int(part) for part in settings["end_time"].split(":")]
    except (ValueError, AttributeError):
        return

    start_minutes = start_h * 60 + start_m
    end_minutes = end_h * 60 + end_m

    # Se cruzar meia-noite, considera janela contínua (ex: 22:30 -> 06:00).
    if start_minutes < end_minutes:
        in_window = start_minutes <= now_minutes < end_minutes
    else:
        in_window = now_minutes >= start_minutes or now_minutes < end_minutes

    if not in_window:
        return

    interval_minutes = max(1, int(settings["interval_minutes"]))
    last_sent_at = settings["last_sent_at"]

    if last_sent_at:
        try:
            last_dt = datetime.fromisoformat(last_sent_at)
            if (now - last_dt).total_seconds() < interval_minutes * 60:
                return
        except ValueError:
            pass

    send_desktop_notification(
        "MOMO BEBA ÁGUA 💗",
        "Meu amorzinho, hora de BEBER ÁGUA <3",
        exact_title=True,
    ) if app.config.get("ENABLE_DESKTOP_NOTIFICATIONS", True) else (True, "desktop desativado")

    subscriptions = list_push_subscriptions(db_path)
    if subscriptions:
        payload = json.dumps(
            {
                "title": "MOMO BEBA ÁGUA 💗",
                "body": "Meu amorzinho, hora de BEBER ÁGUA <3",
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
                delete_push_subscription(db_path, sub["endpoint"])

    update_hydration_last_sent(db_path, now.isoformat(timespec="seconds"))
