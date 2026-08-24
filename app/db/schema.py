"""Criacao das tabelas, migracoes e indices."""

from app.db.connection import get_connection


def init_db(db_path: str) -> None:
    with get_connection(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                event_datetime TEXT NOT NULL,
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

        # Colunas legadas. `is_course` era espelho de `tag_type` (escrita em todo
        # insert, nunca lida) e as de integração externa saíram há tempos.
        for legacy in ("is_course", "email_to", "whatsapp_to"):
            if legacy in columns:
                conn.execute(f"ALTER TABLE events DROP COLUMN {legacy}")

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

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS planner_blocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                day_of_week INTEGER NOT NULL,
                start_minute INTEGER NOT NULL,
                end_minute INTEGER NOT NULL,
                color TEXT NOT NULL DEFAULT 'rose',
                is_routine INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sticky_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL DEFAULT '',
                bucket TEXT NOT NULL DEFAULT 'hoje',
                pos_x INTEGER NOT NULL DEFAULT 24,
                pos_y INTEGER NOT NULL DEFAULT 24,
                width INTEGER NOT NULL DEFAULT 224,
                height INTEGER NOT NULL DEFAULT 208,
                color TEXT NOT NULL DEFAULT 'sun',
                z_index INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

        # Índices: consultas ordenam/filtram por essas colunas em todas as telas.
        # `pinned` nunca chegou a ter interface: nada lia o valor.
        note_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(sticky_notes)").fetchall()
        }
        if "pinned" in note_columns:
            conn.execute("ALTER TABLE sticky_notes DROP COLUMN pinned")

        conn.execute("CREATE INDEX IF NOT EXISTS idx_events_datetime ON events(event_datetime)")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_dispatches_lookup "
            "ON reminder_dispatches(event_id, reminder_type, channel, status)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_planner_day ON planner_blocks(day_of_week, start_minute)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notes_bucket ON sticky_notes(bucket, z_index)"
        )
