"""Registro de lembretes ja disparados (evita reenvio)."""

from app.db.connection import get_connection, utc_now_iso


def has_successful_dispatch(db_path: str, event_id: int, reminder_type: str, channel: str) -> bool:
    with get_connection(db_path) as conn:
        row = conn.execute(
            """
            SELECT 1
            FROM reminder_dispatches
            WHERE event_id = ?
              AND reminder_type = ?
              AND channel = ?
              AND status = 'success'
            LIMIT 1
            """,
            (event_id, reminder_type, channel),
        ).fetchone()
    return row is not None


def save_dispatch(
    db_path: str,
    event_id: int,
    reminder_type: str,
    channel: str,
    status: str,
    error_message: str = "",
) -> None:
    with get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO reminder_dispatches
            (event_id, reminder_type, channel, status, error_message, sent_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                reminder_type,
                channel,
                status,
                error_message.strip(),
                utc_now_iso(),
            ),
        )
