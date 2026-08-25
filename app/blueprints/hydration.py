"""Tela do lembrete de beber água."""

import json
from datetime import datetime

from flask import (
    Blueprint,
    current_app,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)

from app.auth import current_user
from app.db import (
    get_hydration_settings,
    list_push_subscriptions,
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
            ok, _ = send_web_push(current_app.config, info, payload)
            if ok:
                sent_channels += 1

    return sent_channels


@bp.route("/hydration", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        enabled = bool(request.form.get("enabled"))
        action = request.form.get("action", "save")

        try:
            interval_minutes = int(request.form.get("interval_minutes", "60"))
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
            current_user()["id"],
            enabled,
            interval_minutes,
            start_time,
            end_time,
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

    settings = get_hydration_settings(current_user()["id"])
    return render_template("pages/hydration.html", active_page="hydration", settings=settings)
