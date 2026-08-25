import platform

from pywebpush import WebPushException, webpush


def send_desktop_notification(title: str, message: str, exact_title: bool = False):
    """Notificação nativa do Windows. Em qualquer outro sistema é no-op.

    O plyer é importado aqui dentro, e não no topo, porque só serve a este
    caminho: no deploy (container Linux) a função retorna antes de usá-lo, então
    o pacote vira dependência opcional em vez de obrigatória para subir o app.
    """
    if platform.system().lower() != "windows":
        return False, "Notificação desktop não suportada neste ambiente (use Web Push)."

    try:
        from plyer import notification
    except ImportError:
        return False, "plyer não instalado (opcional; só para notificação desktop local)."

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


# O serviço de push responde isto quando a inscrição não existe mais: o
# navegador foi reinstalado, a permissão foi revogada ou a inscrição expirou.
# Não adianta tentar de novo — a linha tem que sair do banco.
DEAD_SUBSCRIPTION_STATUSES = frozenset({404, 410})


def send_web_push(config, subscription: dict, payload: str):
    """Envia um push. Devolve `(ok, mensagem, status_http)`.

    O status vem separado da mensagem de propósito. Antes quem chamava decidia
    apagar a inscrição procurando `"(410"` dentro do texto do erro — decisão
    destrutiva tomada por farejamento de string, que erra nos dois sentidos.

    `status` é `None` quando nem chegou a haver resposta (DNS, timeout, TLS).
    """
    vapid_private_key = config.get("VAPID_PRIVATE_KEY", "").strip()
    vapid_claims = {"sub": config.get("VAPID_SUBJECT", "mailto:admin@example.com")}

    if not vapid_private_key:
        return False, "VAPID_PRIVATE_KEY não configurada", None

    try:
        webpush(
            subscription_info=subscription,
            data=payload,
            vapid_private_key=vapid_private_key,
            vapid_claims=vapid_claims,
            ttl=120,
        )
        return True, "Web push enviado", 201
    except WebPushException as exc:
        # `is not None` e não `if exc.response`: requests.Response.__bool__
        # devolve `response.ok`, ou seja, TODA resposta de erro é falsa aqui.
        # Era por isso que o status virava "sem status" justamente nos 410 —
        # e a limpeza de inscrição morta nunca rodava.
        status_code = exc.response.status_code if exc.response is not None else None
        return False, f"Falha web push ({status_code or 'sem status'}): {exc}", status_code
    except Exception as exc:
        return False, f"Falha web push: {exc}", None
