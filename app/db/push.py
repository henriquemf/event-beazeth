"""Inscricoes de Web Push, uma lista por conta.

O mesmo navegador pode estar inscrito em duas contas — daí a chave ser
(user_id, endpoint) e não o endpoint sozinho: cada conta precisa da própria
inscrição para receber os próprios lembretes.
"""

from app.db.connection import get_connection, utc_now_iso


# Cada lembrete sai para TODAS as inscrições da conta, em série. Sem teto, uma
# conta que se inscrevesse mil vezes faria cada lembrete dela custar mil
# pedidos -- na mesma thread que atende os lembretes de todo mundo.
#
# O teto RECUSA a inscrição nova; não apaga nenhuma antiga. Apagar "a mais
# velha" parecia inofensivo, mas é tirar a notificação de um navegador que a
# pessoa ainda usa sem ela saber. Cinquenta passa longe de qualquer pessoa, e
# as inscrições mortas já saem sozinhas quando o serviço de push responde 404
# ou 410 (ver `scheduler_service.py`). Reinscrever o mesmo navegador não conta:
# é atualização da linha que já existe.
MAX_INSCRICOES_POR_CONTA = 50


def upsert_push_subscription(
    user_id: int,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str,
) -> bool:
    """Grava a inscrição. `False` se a conta já está no teto e ela é nova."""
    with get_connection() as conn:
        ja_existe = conn.execute(
            "SELECT 1 FROM push_subscriptions WHERE user_id = %s AND endpoint = %s",
            (user_id, endpoint.strip()),
        ).fetchone()
        if not ja_existe:
            total = conn.execute(
                "SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = %s",
                (user_id,),
            ).fetchone()["n"]
            if total >= MAX_INSCRICOES_POR_CONTA:
                return False
        conn.execute(
            """
            INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, endpoint) DO UPDATE SET
                p256dh = EXCLUDED.p256dh,
                auth = EXCLUDED.auth,
                user_agent = EXCLUDED.user_agent
            """,
            (
                user_id,
                endpoint.strip(),
                p256dh.strip(),
                auth.strip(),
                user_agent.strip(),
                utc_now_iso(),
            ),
        )
    return True


def list_push_subscriptions(user_id: int):
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT endpoint, p256dh, auth
            FROM push_subscriptions
            WHERE user_id = %s
            ORDER BY id DESC
            """,
            (user_id,),
        ).fetchall()
    return rows


def delete_push_subscription(user_id: int, endpoint: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM push_subscriptions WHERE user_id = %s AND endpoint = %s",
            (user_id, endpoint.strip()),
        )
