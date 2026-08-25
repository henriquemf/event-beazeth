"""Tela da água: meta do dia, copo animado e configuração do lembrete."""

import json
from datetime import datetime

from flask import (
    Blueprint,
    current_app,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    url_for,
)

from app.auth import current_user
from app.db import (
    MAX_GLASS_ML,
    MAX_GOAL,
    MIN_GLASS_ML,
    MIN_GOAL,
    change_hydration_glasses,
    get_hydration_settings,
    get_hydration_today,
    list_push_subscriptions,
    next_reminder_seconds,
    seconds_until,
    update_hydration_last_sent,
    upsert_hydration_settings,
)
from app.services.notifier import send_desktop_notification, send_web_push


bp = Blueprint("hydration", __name__)

REMINDER_TITLE = "MOMO BEBA ÁGUA 💗"
REMINDER_BODY = "Meu amorzinho, hora de BEBER ÁGUA <3"

MIN_INTERVAL = 1
MAX_INTERVAL = 1440


def send_test_notification():
    """Dispara a notificação de teste nos canais disponíveis.

    Retorna quantos canais aceitaram o envio.
    """
    sent_channels = 0
    user_id = current_user()["id"]

    if current_app.config.get("ENABLE_DESKTOP_NOTIFICATIONS", False):
        ok, _ = send_desktop_notification(
            REMINDER_TITLE,
            REMINDER_BODY,
            exact_title=True,
        )
        if ok:
            sent_channels += 1

    subscriptions = list_push_subscriptions(user_id)
    if subscriptions:
        payload = json.dumps(
            {
                "title": REMINDER_TITLE,
                "body": REMINDER_BODY,
                "icon": "/static/icon.svg",
                "tag": "hydration-test",
            }
        )

        for sub in subscriptions:
            info = {
                "endpoint": sub["endpoint"],
                "keys": {
                    "p256dh": sub["p256dh"],
                    "auth": sub["auth"],
                },
            }
            ok, _, _ = send_web_push(current_app.config, info, payload)
            if ok:
                sent_channels += 1

    return sent_channels


@bp.app_context_processor
def inject_water_widget():
    """Quanto falta para o proximo lembrete, para o widget da barra lateral.

    `app_context_processor` e nao `context_processor`: a sidebar e do layout
    base, ou seja, o widget aparece em TODAS as telas, nao so nas deste
    blueprint. Fica aqui mesmo assim para o assunto agua nao vazar para dentro
    de app/auth.py.

    Nao consulta nada: `get_user` ja traz `water_last_sent` e `water_interval`
    de carona na consulta que toda requisicao faz.
    """
    user = current_user()
    if not user or not user["water_enabled"]:
        return {"water_next_in": None}
    return {"water_next_in": seconds_until(user["water_last_sent"], user["water_interval"])}


@bp.route("/hydration", methods=["GET", "POST"])
def index():
    user_id = current_user()["id"]

    if request.method == "POST":
        enabled = bool(request.form.get("enabled"))
        action = request.form.get("action", "save")

        try:
            interval_minutes = int(request.form.get("interval_minutes", "60"))
            daily_goal = int(request.form.get("daily_goal", "8"))
            glass_ml = int(request.form.get("glass_ml", "250"))
            start_time = request.form.get("start_time", "08:00").strip()
            end_time = request.form.get("end_time", "22:00").strip()
            start_t = datetime.strptime(start_time, "%H:%M").time()
            end_t = datetime.strptime(end_time, "%H:%M").time()
        except ValueError:
            flash("Valores inválidos para lembrete de água.", "error")
            return redirect(url_for("hydration.index"))

        interval_minutes = min(max(interval_minutes, MIN_INTERVAL), MAX_INTERVAL)

        if start_t == end_t:
            flash("Início e fim não podem ser iguais.", "error")
            return redirect(url_for("hydration.index"))

        upsert_hydration_settings(
            user_id,
            enabled,
            interval_minutes,
            start_time,
            end_time,
            daily_goal,
            glass_ml,
        )

        if action == "test":
            if not enabled:
                flash("Ative o lembrete de água para testar a notificação.", "error")
                return redirect(url_for("hydration.index"))

            if send_test_notification() > 0:
                flash("Teste de notificação enviado com sucesso.", "success")
            else:
                flash(
                    "Não foi possível enviar o teste. Ative notificações web na lateral e tente novamente.",
                    "error",
                )
        else:
            flash("Lembrete de água atualizado.", "success")
        return redirect(url_for("hydration.index"))

    settings = get_hydration_settings(user_id)

    return render_template(
        "pages/hydration.html",
        active_page="hydration",
        settings=settings,
        glasses=get_hydration_today(user_id),
        next_in=next_reminder_seconds(settings),
        # Espelham os limites validados em app/db/hydration.py: os campos já
        # recusam o que o servidor cortaria calado.
        limits={
            "min_goal": MIN_GOAL,
            "max_goal": MAX_GOAL,
            "min_ml": MIN_GLASS_ML,
            "max_ml": MAX_GLASS_ML,
            "min_interval": MIN_INTERVAL,
            "max_interval": MAX_INTERVAL,
        },
    )


@bp.post("/api/hydration/drink")
def drink():
    """Registra (ou desfaz) um copo e devolve o dia recalculado.

    Beber empurra o próximo lembrete um intervalo inteiro para frente. É o que
    se espera de um botão "bebi": quem acabou de beber não quer ser cobrada
    logo em seguida. Na prática isso reaproveita `last_sent_at` como "última vez
    que o assunto foi resolvido", que é exatamente o que o agendador consulta.
    """
    user_id = current_user()["id"]
    payload = request.get_json(silent=True) or {}

    # Qualquer valor negativo desfaz um copo; qualquer outro adiciona um. O
    # cliente não escolhe o tamanho do passo — senão um payload adulterado
    # encheria a meta do dia de uma vez.
    delta = -1 if str(payload.get("delta", 1)).lstrip().startswith("-") else 1

    now = datetime.now().isoformat(timespec="seconds")
    glasses = change_hydration_glasses(user_id, delta, now)

    if delta > 0:
        update_hydration_last_sent(user_id, now)

    settings = get_hydration_settings(user_id)
    return jsonify(
        {
            "ok": True,
            "glasses": glasses,
            "goal": settings["daily_goal"],
            "glassMl": settings["glass_ml"],
            "nextIn": next_reminder_seconds(settings),
        }
    )
