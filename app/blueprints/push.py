"""Web Push: inscrição, teste e fila de notificações ao vivo."""

from flask import Blueprint, current_app, jsonify, request

from app.auth import current_user
from app.db import (
    delete_push_subscription,
    list_push_subscriptions,
    upsert_push_subscription,
)
from app.services.notifier import send_web_push
from app.services.scheduler_service import collect_due_live_event_notifications


bp = Blueprint("push", __name__)

TEST_PAYLOAD = (
    '{"title":"Teste Web Push 💗","body":"Tudo certo! Notificação web funcionando.",'
    '"icon":"/static/icon.svg","tag":"push-test"}'
)


def subscription_info(row):
    """Formato que o pywebpush espera para uma inscrição."""
    return {
        "endpoint": row["endpoint"],
        "keys": {
            "p256dh": row["p256dh"],
            "auth": row["auth"],
        },
    }


@bp.get("/api/push/public-key")
def public_key():
    return jsonify({"publicKey": current_app.config.get("VAPID_PUBLIC_KEY", "")})


@bp.post("/api/push/subscribe")
def subscribe():
    payload = request.get_json(silent=True) or {}
    endpoint = (payload.get("endpoint") or "").strip()
    keys = payload.get("keys") or {}
    p256dh = (keys.get("p256dh") or "").strip()
    auth = (keys.get("auth") or "").strip()

    if not endpoint or not p256dh or not auth:
        return jsonify({"ok": False, "message": "Inscrição inválida"}), 400

    upsert_push_subscription(
        current_user()["id"],
        endpoint,
        p256dh,
        auth,
        request.headers.get("User-Agent", ""),
    )
    return jsonify({"ok": True})


@bp.post("/api/push/unsubscribe")
def unsubscribe():
    payload = request.get_json(silent=True) or {}
    endpoint = (payload.get("endpoint") or "").strip()
    if endpoint:
        delete_push_subscription(current_user()["id"], endpoint)
    return jsonify({"ok": True})


@bp.post("/api/push/test")
def test():
    subscriptions = list_push_subscriptions(current_user()["id"])
    if not subscriptions:
        return jsonify({"ok": False, "message": "Nenhuma inscrição ativa"}), 400

    ok_count = 0
    for sub in subscriptions:
        ok, _ = send_web_push(current_app.config, subscription_info(sub), TEST_PAYLOAD)
        if ok:
            ok_count += 1

    return jsonify({"ok": ok_count > 0, "sent": ok_count})


@bp.get("/api/live/notifications")
def live_notifications():
    # Só a fila desta conta: a varredura do agendador é global, mas o que a aba
    # aberta recebe tem que ser o que é dela.
    items = collect_due_live_event_notifications(
        current_app._get_current_object(), current_user()["id"]
    )
    return jsonify({"ok": True, "items": items})
