"""Inscricoes de Web Push."""

from app.db.connection import get_connection, utc_now_iso


def upsert_push_subscription(
    db_path: str,
    endpoint: str,
    p256dh: str,
    auth: str,
    user_agent: str,
) -> None:
    with get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                p256dh = excluded.p256dh,
                auth = excluded.auth,
                user_agent = excluded.user_agent
            """,
            (
                endpoint.strip(),
                p256dh.strip(),
                auth.strip(),
                user_agent.strip(),
                utc_now_iso(),
            ),
        )


def list_push_subscriptions(db_path: str):
    with get_connection(db_path) as conn:
        rows = conn.execute(
            """
            SELECT endpoint, p256dh, auth
            FROM push_subscriptions
            ORDER BY id DESC
            """
        ).fetchall()
    return rows


def delete_push_subscription(db_path: str, endpoint: str) -> None:
    with get_connection(db_path) as conn:
        conn.execute(
            "DELETE FROM push_subscriptions WHERE endpoint = ?",
            (endpoint.strip(),),
        )
