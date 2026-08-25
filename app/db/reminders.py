"""Registro de lembretes ja disparados (evita reenvio).

Sem `user_id`: o dono vem do evento, e o CASCADE da FK já limpa esta tabela
quando o evento (ou a conta inteira) é removido.
"""

from app.db.connection import get_connection, utc_now_iso


def has_successful_dispatch(event_id: int, reminder_type: str, channel: str) -> bool:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT 1
            FROM reminder_dispatches
            WHERE event_id = %s
              AND reminder_type = %s
              AND channel = %s
              AND status = 'success'
            LIMIT 1
            """,
            (event_id, reminder_type, channel),
        ).fetchone()
    return row is not None


def save_dispatch(
    event_id: int,
    reminder_type: str,
    channel: str,
    status: str,
    error_message: str = "",
) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO reminder_dispatches
            (event_id, reminder_type, channel, status, error_message, sent_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (event_id, reminder_type, channel, status) DO NOTHING
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
