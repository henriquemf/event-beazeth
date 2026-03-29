import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path


def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


@contextmanager
def get_connection(db_path: str):
    db_file = Path(db_path)
    db_file.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_file))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db(db_path: str) -> None:
    with get_connection(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                event_datetime TEXT NOT NULL,
                is_course INTEGER NOT NULL DEFAULT 0,
                tag_type TEXT NOT NULL DEFAULT 'evento',
                created_at TEXT NOT NULL
            )
            """
        )
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(events)").fetchall()
        }
        if "tag_type" not in columns:
            conn.execute("ALTER TABLE events ADD COLUMN tag_type TEXT NOT NULL DEFAULT 'evento'")
            conn.execute(
                """
                UPDATE events
                SET tag_type = CASE
                    WHEN is_course = 1 THEN 'curso'
                    ELSE 'evento'
                END
                """
            )

        # Migração para remover colunas legadas de integrações externas.
        legacy_columns = {"email_to", "whatsapp_to"}
        if any(col in columns for col in legacy_columns):
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS events_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    description TEXT,
                    event_datetime TEXT NOT NULL,
                    is_course INTEGER NOT NULL DEFAULT 0,
                    tag_type TEXT NOT NULL DEFAULT 'evento',
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                INSERT INTO events_new (id, title, description, event_datetime, is_course, tag_type, created_at)
                SELECT id,
                       title,
                       description,
                       event_datetime,
                       is_course,
                       COALESCE(tag_type, CASE WHEN is_course = 1 THEN 'curso' ELSE 'evento' END),
                       created_at
                FROM events
                """
            )
            conn.execute("DROP TABLE events")
            conn.execute("ALTER TABLE events_new RENAME TO events")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS reminder_dispatches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL,
                reminder_type TEXT NOT NULL,
                channel TEXT NOT NULL,
                status TEXT NOT NULL,
                error_message TEXT,
                sent_at TEXT NOT NULL,
                UNIQUE(event_id, reminder_type, channel, status),
                FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE CASCADE
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS hydration_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                enabled INTEGER NOT NULL DEFAULT 0,
                interval_minutes INTEGER NOT NULL DEFAULT 60,
                start_time TEXT NOT NULL DEFAULT '08:00',
                end_time TEXT NOT NULL DEFAULT '22:00',
                last_sent_at TEXT
            )
            """
        )

        hydration_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(hydration_settings)").fetchall()
        }
        if "start_time" not in hydration_columns:
            conn.execute("ALTER TABLE hydration_settings ADD COLUMN start_time TEXT NOT NULL DEFAULT '08:00'")
        if "end_time" not in hydration_columns:
            conn.execute("ALTER TABLE hydration_settings ADD COLUMN end_time TEXT NOT NULL DEFAULT '22:00'")

        if "start_hour" in hydration_columns:
            conn.execute(
                """
                UPDATE hydration_settings
                SET start_time = printf('%02d:00', start_hour)
                WHERE start_time IS NULL OR start_time = ''
                """
            )
        if "end_hour" in hydration_columns:
            conn.execute(
                """
                UPDATE hydration_settings
                SET end_time = printf('%02d:00', end_hour % 24)
                WHERE end_time IS NULL OR end_time = ''
                """
            )

        conn.execute(
            """
            INSERT OR IGNORE INTO hydration_settings
            (id, enabled, interval_minutes, start_time, end_time, last_sent_at)
            VALUES (1, 0, 60, '08:00', '22:00', NULL)
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                endpoint TEXT NOT NULL UNIQUE,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                user_agent TEXT,
                created_at TEXT NOT NULL
            )
            """
        )


def insert_event(
    db_path: str,
    title: str,
    description: str,
    event_datetime: str,
    tag_type: str,
) -> None:
    normalized_tag = "curso" if tag_type == "curso" else "evento"
    with get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT INTO events (title, description, event_datetime, is_course, tag_type, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                title.strip(),
                description.strip(),
                event_datetime,
                int(normalized_tag == "curso"),
                normalized_tag,
                _utc_now_iso(),
            ),
        )


def delete_event(db_path: str, event_id: int) -> None:
    with get_connection(db_path) as conn:
        conn.execute("DELETE FROM events WHERE id = ?", (event_id,))


def update_event(
    db_path: str,
    event_id: int,
    title: str,
    description: str,
    event_datetime: str,
    tag_type: str,
) -> bool:
    normalized_tag = "curso" if tag_type == "curso" else "evento"
    with get_connection(db_path) as conn:
        cursor = conn.execute(
            """
            UPDATE events
            SET title = ?,
                description = ?,
                event_datetime = ?,
                is_course = ?,
                tag_type = ?
            WHERE id = ?
            """,
            (
                title.strip(),
                description.strip(),
                event_datetime,
                int(normalized_tag == "curso"),
                normalized_tag,
                event_id,
            ),
        )
    return cursor.rowcount > 0


def list_events(db_path: str):
    with get_connection(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, title, description, event_datetime, is_course,
                   COALESCE(tag_type, CASE WHEN is_course = 1 THEN 'curso' ELSE 'evento' END) AS tag_type
            FROM events
            ORDER BY event_datetime ASC
            """
        ).fetchall()
    return rows


def list_due_event_candidates(db_path: str, window_start: str, window_end: str):
    with get_connection(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, title, description, event_datetime, is_course,
                   COALESCE(tag_type, CASE WHEN is_course = 1 THEN 'curso' ELSE 'evento' END) AS tag_type
            FROM events
            WHERE event_datetime BETWEEN ? AND ?
            """
            , (window_start, window_end)
        ).fetchall()
    return rows


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
                _utc_now_iso(),
            ),
        )


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
                _utc_now_iso(),
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
