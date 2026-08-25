"""Blocos do weekly planner."""

from app.db.connection import get_connection, utc_now_iso


PLANNER_COLORS = ("rose", "blue", "mint", "lavender", "peach", "sun")


ROUTINE_DAY = -1


_BLOCK_SELECT = """
    SELECT id, title, notes, day_of_week, start_minute, end_minute, color, is_routine
    FROM planner_blocks
"""


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


def list_planner_blocks(user_id: int):
    with get_connection() as conn:
        rows = conn.execute(
            _BLOCK_SELECT + " WHERE user_id = %s ORDER BY day_of_week ASC, start_minute ASC",
            (user_id,),
        ).fetchall()
    return [_row_to_planner_dict(row) for row in rows]


def insert_planner_block(
    user_id: int,
    title: str,
    notes: str,
    day_of_week: int,
    start_minute: int,
    end_minute: int,
    color: str,
    is_routine: bool,
) -> dict:
    day = ROUTINE_DAY if is_routine else day_of_week
    with get_connection() as conn:
        # `RETURNING` no lugar de `lastrowid`, que é de driver SQLite e não
        # existe no Postgres.
        row = conn.execute(
            """
            INSERT INTO planner_blocks
            (user_id, title, notes, day_of_week, start_minute, end_minute, color, is_routine, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id, title, notes, day_of_week, start_minute, end_minute, color, is_routine
            """,
            (
                user_id,
                title.strip(),
                notes.strip(),
                day,
                start_minute,
                end_minute,
                _normalize_planner_color(color),
                bool(is_routine),
                utc_now_iso(),
            ),
        ).fetchone()
    return _row_to_planner_dict(row)


def update_planner_block(
    user_id: int,
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
    with get_connection() as conn:
        row = conn.execute(
            """
            UPDATE planner_blocks
            SET title = %s, notes = %s, day_of_week = %s, start_minute = %s,
                end_minute = %s, color = %s, is_routine = %s
            WHERE id = %s AND user_id = %s
            RETURNING id, title, notes, day_of_week, start_minute, end_minute, color, is_routine
            """,
            (
                title.strip(),
                notes.strip(),
                day,
                start_minute,
                end_minute,
                _normalize_planner_color(color),
                bool(is_routine),
                block_id,
                user_id,
            ),
        ).fetchone()
    return _row_to_planner_dict(row) if row else None


def delete_planner_block(user_id: int, block_id: int) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM planner_blocks WHERE id = %s AND user_id = %s",
            (block_id, user_id),
        )
    return cursor.rowcount > 0
