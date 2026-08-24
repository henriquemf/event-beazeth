"""Post-its do quadro da home."""

from app.db.connection import get_connection, utc_now_iso


NOTE_COLORS = ("sun", "rose", "mint", "blue", "peach", "lavender")


NOTE_BUCKETS = ("hoje", "amanha", "semana", "ideias")


# Limites de geometria do quadro. Espelham os do JS para que um payload
# adulterado nao consiga posicionar um post-it fora da area alcancavel.
NOTE_BOUNDS = {
    "pos_x": (0, 4000),
    "pos_y": (0, 6000),
    "width": (150, 560),
    "height": (120, 560),
    "z_index": (1, 100000),
}


NOTE_FIELDS = (
    "content",
    "bucket",
    "pos_x",
    "pos_y",
    "width",
    "height",
    "color",
    "z_index",
    "pinned",
)


def _normalize_note_color(color: str) -> str:
    color = (color or "").strip().lower()
    return color if color in NOTE_COLORS else "sun"


def _normalize_note_bucket(bucket: str) -> str:
    bucket = (bucket or "").strip().lower()
    return bucket if bucket in NOTE_BUCKETS else "hoje"


def _clamp_note_int(field: str, value, fallback: int) -> int:
    low, high = NOTE_BOUNDS[field]
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        return fallback
    return min(max(number, low), high)


def _row_to_note_dict(row) -> dict:
    return {
        "id": row["id"],
        "content": row["content"] or "",
        "bucket": row["bucket"],
        "x": row["pos_x"],
        "y": row["pos_y"],
        "width": row["width"],
        "height": row["height"],
        "color": row["color"],
        "z": row["z_index"],
        "pinned": bool(row["pinned"]),
        "updatedAt": row["updated_at"],
    }


_NOTE_SELECT = """
    SELECT id, content, bucket, pos_x, pos_y, width, height,
           color, z_index, pinned, updated_at
    FROM sticky_notes
"""


def list_sticky_notes(db_path: str):
    with get_connection(db_path) as conn:
        rows = conn.execute(_NOTE_SELECT + " ORDER BY z_index ASC, id ASC").fetchall()
    return [_row_to_note_dict(row) for row in rows]


def insert_sticky_note(db_path: str, fields: dict) -> dict:
    now = utc_now_iso()
    data = {
        "content": (fields.get("content") or "")[:2000],
        "bucket": _normalize_note_bucket(fields.get("bucket")),
        "pos_x": _clamp_note_int("pos_x", fields.get("x"), 24),
        "pos_y": _clamp_note_int("pos_y", fields.get("y"), 24),
        "width": _clamp_note_int("width", fields.get("width"), 224),
        "height": _clamp_note_int("height", fields.get("height"), 208),
        "color": _normalize_note_color(fields.get("color")),
        "z_index": _clamp_note_int("z_index", fields.get("z"), 1),
        "pinned": int(bool(fields.get("pinned"))),
    }

    with get_connection(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO sticky_notes
            (content, bucket, pos_x, pos_y, width, height, color, z_index, pinned, created_at, updated_at)
            VALUES (:content, :bucket, :pos_x, :pos_y, :width, :height, :color, :z_index, :pinned, :created_at, :updated_at)
            """,
            dict(data, created_at=now, updated_at=now),
        )
        row = conn.execute(_NOTE_SELECT + " WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_note_dict(row)


def update_sticky_note(db_path: str, note_id: int, fields: dict):
    """Atualizacao parcial: so grava as chaves presentes no payload.

    O arraste envia geometria e o editor envia texto; como os dois salvam com
    debounce, um PUT completo faria um sobrescrever o campo do outro.
    """
    with get_connection(db_path) as conn:
        row = conn.execute(_NOTE_SELECT + " WHERE id = ?", (note_id,)).fetchone()
        if row is None:
            return None

        updates = {}
        if "content" in fields:
            updates["content"] = str(fields.get("content") or "")[:2000]
        if "bucket" in fields:
            updates["bucket"] = _normalize_note_bucket(fields.get("bucket"))
        if "color" in fields:
            updates["color"] = _normalize_note_color(fields.get("color"))
        if "pinned" in fields:
            updates["pinned"] = int(bool(fields.get("pinned")))
        for key, source in (("pos_x", "x"), ("pos_y", "y"), ("width", "width"),
                            ("height", "height"), ("z_index", "z")):
            if source in fields:
                updates[key] = _clamp_note_int(key, fields.get(source), row[key])

        if updates:
            updates["updated_at"] = utc_now_iso()
            assignments = ", ".join(key + " = :" + key for key in updates)
            conn.execute(
                "UPDATE sticky_notes SET " + assignments + " WHERE id = :note_id",
                dict(updates, note_id=note_id),
            )
            row = conn.execute(_NOTE_SELECT + " WHERE id = ?", (note_id,)).fetchone()

    return _row_to_note_dict(row)


def delete_sticky_note(db_path: str, note_id: int) -> bool:
    with get_connection(db_path) as conn:
        cursor = conn.execute("DELETE FROM sticky_notes WHERE id = ?", (note_id,))
    return cursor.rowcount > 0
