"""Web Push: inscrição, teste e fila de notificações ao vivo."""

from flask import Blueprint, current_app, jsonify, request

from app.auth import current_user
from app.db import (
    delete_push_subscription,
    list_push_subscriptions,
    upsert_push_subscription,
)
from app.services.notifier import endpoint_aceito, send_web_push
from app.services.scheduler_service import collect_due_live_event_notifications


bp = Blueprint("push", __name__)

MAX_ENDPOINT = 2048
MAX_CHAVE = 256
MAX_USER_AGENT = 300

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


def _texto(valor, limite: int) -> str:
    """O campo como texto, ou vazio se não for texto ou passar do tamanho.

    Uma inscrição de verdade tem endereço de poucas centenas de caracteres e
    chaves de algumas dezenas; o que foge disso não veio de um navegador.
    """
    return valor.strip() if isinstance(valor, str) and len(valor) <= limite else ""


@bp.post("/api/push/subscribe")
def subscribe():
    payload = request.get_json(silent=True) or {}
    endpoint = _texto(payload.get("endpoint"), MAX_ENDPOINT)
    keys = payload.get("keys") if isinstance(payload.get("keys"), dict) else {}
    p256dh = _texto(keys.get("p256dh"), MAX_CHAVE)
    auth = _texto(keys.get("auth"), MAX_CHAVE)

    if not endpoint or not p256dh or not auth or not endpoint_aceito(endpoint):
        return jsonify({"ok": False, "message": "Inscrição inválida"}), 400

    gravou = upsert_push_subscription(
        current_user()["id"],
        endpoint,
        p256dh,
        auth,
        request.headers.get("User-Agent", "")[:MAX_USER_AGENT],
    )
    if not gravou:
        return jsonify({
            "ok": False,
            "message": "Esta conta já tem notificações ligadas em navegadores demais.",
        }), 409
    return jsonify({"ok": True})


@bp.post("/api/push/unsubscribe")
def unsubscribe():
    payload = request.get_json(silent=True) or {}
    endpoint = _texto(payload.get("endpoint"), MAX_ENDPOINT)
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
        ok, _, _ = send_web_push(current_app.config, subscription_info(sub), TEST_PAYLOAD)
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
