"""Eventos e cursos cadastrados."""

from app.db.connection import get_connection, utc_now_iso
from app.db.tags import FALLBACK_TAG


# Toda leitura de evento sai com o rótulo e a cor da tag junto. O LEFT JOIN
# cobre o evento cuja tag foi apagada entre a escrita e a leitura: `COALESCE`
# devolve o padrão em vez de deixar a tela sem cor nenhuma.
_EVENT_SELECT = """
    SELECT e.id,
           e.title,
           e.description,
           e.event_datetime,
           e.tag_type,
           COALESCE(t.label, 'Evento') AS tag_label,
           COALESCE(t.color, '#7ec8ff') AS tag_color,
           COALESCE(t.reminder_rule, 'dia') AS reminder_rule
    FROM events e
    LEFT JOIN event_tags t ON t.slug = e.tag_type
"""


def _existing_tag(conn, tag_type: str) -> str:
    """Aceita a tag só se ela existe; senão devolve a padrão.

    A validação é aqui, e não no blueprint, porque `tag_type` é uma referência
    a `event_tags.slug` sem FOREIGN KEY — o slug precisava continuar aceitando
    os valores que já estavam gravados antes da tabela existir.
    """
    row = conn.execute(
        "SELECT 1 FROM event_tags WHERE slug = ?", (tag_type,)
    ).fetchone()
    return tag_type if row else FALLBACK_TAG


def insert_event(
    db_path: str,
    title: str,
    description: str,
    event_datetime: str,
    tag_type: str,
) -> None:
    with get_connection(db_path) as conn:
        conn.execute(
            """
            INSERT INTO events (title, description, event_datetime, tag_type, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                title.strip(),
                description.strip(),
                event_datetime,
                _existing_tag(conn, tag_type),
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
    with get_connection(db_path) as conn:
        cursor = conn.execute(
            """
            UPDATE events
            SET title = ?,
                description = ?,
                event_datetime = ?,
                tag_type = ?
            WHERE id = ?
            """,
            (
                title.strip(),
                description.strip(),
                event_datetime,
                _existing_tag(conn, tag_type),
                event_id,
            ),
        )
    return cursor.rowcount > 0


def list_events(db_path: str):
    with get_connection(db_path) as conn:
        rows = conn.execute(
            _EVENT_SELECT + " ORDER BY e.event_datetime ASC"
        ).fetchall()
    return rows


def list_due_event_candidates(db_path: str, window_start: str, window_end: str):
    with get_connection(db_path) as conn:
        rows = conn.execute(
            _EVENT_SELECT + " WHERE e.event_datetime BETWEEN ? AND ?",
            (window_start, window_end),
        ).fetchall()
    return rows
