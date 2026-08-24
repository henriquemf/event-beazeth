"""Blocos do weekly planner."""

from app.db.connection import get_connection, utc_now_iso


PLANNER_COLORS = ("rose", "blue", "mint", "lavender", "peach", "sun")


ROUTINE_DAY = -1


def _normalize_planner_color(color: str) -> str:
    color = (color or "").strip().lower()
    return color if color in PLANNER_COLORS else "rose"


def _row_to_planner_dict(row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "notes": row["notes"] or "",
        "dayOfWeek": row["day_of_week"],
        "startMinute": row["start_minute"],
        "endMinute": row["end_minute"],
        "color": row["color"],
        "isRoutine": bool(row["is_routine"]),
    }


def list_planner_blocks(db_path: str):
    with get_connection(db_path) as conn:
        rows = conn.execute(
            """
            SELECT id, title, notes, day_of_week, start_minute, end_minute, color, is_routine
            FROM planner_blocks
            ORDER BY day_of_week ASC, start_minute ASC
            """
        ).fetchall()
    return [_row_to_planner_dict(row) for row in rows]


def insert_planner_block(
    db_path: str,
    title: str,
    notes: str,
    day_of_week: int,
    start_minute: int,
    end_minute: int,
    color: str,
    is_routine: bool,
) -> dict:
    day = ROUTINE_DAY if is_routine else day_of_week
    with get_connection(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO planner_blocks
            (title, notes, day_of_week, start_minute, end_minute, color, is_routine, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                title.strip(),
                notes.strip(),
                day,
                start_minute,
                end_minute,
                _normalize_planner_color(color),
                int(is_routine),
                utc_now_iso(),
            ),
        )
        new_id = cursor.lastrowid
        row = conn.execute(
            """
            SELECT id, title, notes, day_of_week, start_minute, end_minute, color, is_routine
            FROM planner_blocks WHERE id = ?
            """,
            (new_id,),
        ).fetchone()
    return _row_to_planner_dict(row)


def update_planner_block(
    db_path: str,
    block_id: int,
    title: str,
    notes: str,
    day_of_week: int,
    start_minute: int,
    end_minute: int,
    color: str,
    is_routine: bool,
):
    day = ROUTINE_DAY if is_routine else day_of_week
    with get_connection(db_path) as conn:
        conn.execute(
            """
            UPDATE planner_blocks
            SET title = ?, notes = ?, day_of_week = ?, start_minute = ?,
                end_minute = ?, color = ?, is_routine = ?
            WHERE id = ?
            """,
            (
                title.strip(),
                notes.strip(),
                day,
                start_minute,
                end_minute,
                _normalize_planner_color(color),
                int(is_routine),
                block_id,
            ),
        )
        row = conn.execute(
            """
            SELECT id, title, notes, day_of_week, start_minute, end_minute, color, is_routine
            FROM planner_blocks WHERE id = ?
            """,
            (block_id,),
        ).fetchone()
    return _row_to_planner_dict(row) if row else None


def delete_planner_block(db_path: str, block_id: int) -> bool:
    with get_connection(db_path) as conn:
        cursor = conn.execute("DELETE FROM planner_blocks WHERE id = ?", (block_id,))
    return cursor.rowcount > 0
