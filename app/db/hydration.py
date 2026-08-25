"""Configuracao do lembrete de beber agua, uma linha por conta."""

from app.db.connection import get_connection


_SETTINGS_SELECT = """
    SELECT user_id, enabled, interval_minutes,
           COALESCE(start_time, '08:00') AS start_time,
           COALESCE(end_time, '22:00') AS end_time,
           last_sent_at
    FROM hydration_settings
"""


def get_hydration_settings(user_id: int):
    """A linha é criada junto com a conta, em `create_user`. O upsert aqui é
    rede de segurança para conta que exista de antes desta tabela."""
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO hydration_settings (user_id) VALUES (%s) ON CONFLICT DO NOTHING",
            (user_id,),
        )
        return conn.execute(
            _SETTINGS_SELECT + " WHERE user_id = %s", (user_id,)
        ).fetchone()


def list_enabled_hydration_settings():
    """Contas com o lembrete ligado. Quem chama é o agendador, fora de requisição."""
    with get_connection() as conn:
        return conn.execute(_SETTINGS_SELECT + " WHERE enabled IS TRUE").fetchall()


def upsert_hydration_settings(
    user_id: int,
    enabled: bool,
    interval_minutes: int,
    start_time: str,
    end_time: str,
) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO hydration_settings (user_id, enabled, interval_minutes, start_time, end_time)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE SET
                enabled = EXCLUDED.enabled,
                interval_minutes = EXCLUDED.interval_minutes,
                start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time
            """,
            (user_id, bool(enabled), interval_minutes, start_time, end_time),
        )


def update_hydration_last_sent(user_id: int, sent_at_iso: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE hydration_settings SET last_sent_at = %s WHERE user_id = %s",
            (sent_at_iso, user_id),
        )
