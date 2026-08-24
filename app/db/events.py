"""Eventos e cursos cadastrados."""

from app.db.connection import get_connection, utc_now_iso


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
                utc_now_iso(),
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
