import platform

from plyer import notification
from pywebpush import WebPushException, webpush


def send_desktop_notification(title: str, message: str, exact_title: bool = False):
    if platform.system().lower() != "windows":
        return False, "Notificação desktop não suportada neste ambiente (use Web Push)."

    try:
        final_title = title if exact_title else f"Event Notifier ✨ | {title}"
        notification.notify(
            title=final_title,
            message=message,
            app_name="Event Notifier",
            timeout=12,
        )
        return True, "Notificação desktop enviada"
    except Exception as exc:
        return False, f"Falha desktop: {exc}"


def send_web_push(config, subscription: dict, payload: str):
    vapid_private_key = config.get("VAPID_PRIVATE_KEY", "").strip()
    vapid_claims = {"sub": config.get("VAPID_SUBJECT", "mailto:admin@example.com")}

    if not vapid_private_key:
        return False, "VAPID_PRIVATE_KEY não configurada"

    try:
        webpush(
            subscription_info=subscription,
            data=payload,
            vapid_private_key=vapid_private_key,
            vapid_claims=vapid_claims,
            ttl=120,
        )
        return True, "Web push enviado"
    except WebPushException as exc:
        status_code = getattr(exc.response, "status_code", None) if exc.response else None
        return False, f"Falha web push ({status_code or 'sem status'}): {exc}"
    except Exception as exc:
        return False, f"Falha web push: {exc}"
