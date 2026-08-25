"""Inscricoes de Web Push, uma lista por conta.

O mesmo navegador pode estar inscrito em duas contas — daí a chave ser
(user_id, endpoint) e não o endpoint sozinho: cada conta precisa da própria
inscrição para receber os próprios lembretes.
"""

from app.db.connection import get_connection, utc_now_iso


def upsert_push_subscription(
    user_id: int,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str,
) -> None:
    with get_connection() as conn:
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
