"""Configuracao do lembrete de beber agua."""

from app.db.connection import get_connection


def get_hydration_settings(db_path: str):
    with get_connection(db_path) as conn:
        row = conn.execute(
            """
            SELECT id, enabled, interval_minutes,
                   COALESCE(start_time, '08:00') AS start_time,
                   COALESCE(end_time, '22:00') AS end_time,
                   last_sent_at
            FROM hydration_settings
            WHERE id = 1
            """
        ).fetchone()
    return row


def upsert_hydration_settings(
    db_path: str,
    enabled: bool,
    interval_minutes: int,
    start_time: str,
    end_time: str,
) -> None:
    with get_connection(db_path) as conn:
        conn.execute(
            """
            UPDATE hydration_settings
            SET enabled = ?, interval_minutes = ?, start_time = ?, end_time = ?
            WHERE id = 1
            """,
            (int(enabled), interval_minutes, start_time, end_time),
        )


def update_hydration_last_sent(db_path: str, sent_at_iso: str) -> None:
    with get_connection(db_path) as conn:
        conn.execute(
            """
            UPDATE hydration_settings
            SET last_sent_at = ?
            WHERE id = 1
            """,
            (sent_at_iso,),
        )
