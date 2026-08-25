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
        "updatedAt": row["updated_at"],
    }


_NOTE_COLUMNS = """
    id, content, bucket, pos_x, pos_y, width, height,
    color, z_index, updated_at
"""

_NOTE_SELECT = "SELECT " + _NOTE_COLUMNS + " FROM sticky_notes"


def list_sticky_notes(user_id: int):
    with get_connection() as conn:
        rows = conn.execute(
            _NOTE_SELECT + " WHERE user_id = %s ORDER BY z_index ASC, id ASC",
            (user_id,),
        ).fetchall()
    return [_row_to_note_dict(row) for row in rows]


def insert_sticky_note(user_id: int, fields: dict) -> dict:
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
    }

    with get_connection() as conn:
        # Nomeado em `%(nome)s`, que é a forma do psycopg — o `:nome` de antes é
        # do driver SQLite. `RETURNING` no lugar do `lastrowid`, pelo mesmo motivo.
        row = conn.execute(
            """
            INSERT INTO sticky_notes
            (user_id, content, bucket, pos_x, pos_y, width, height, color, z_index, created_at, updated_at)
            VALUES (%(user_id)s, %(content)s, %(bucket)s, %(pos_x)s, %(pos_y)s, %(width)s,
                    %(height)s, %(color)s, %(z_index)s, %(created_at)s, %(updated_at)s)
            RETURNING """ + _NOTE_COLUMNS,
            dict(data, user_id=user_id, created_at=now, updated_at=now),
        ).fetchone()
    return _row_to_note_dict(row)


def update_sticky_note(user_id: int, note_id: int, fields: dict):
    """Atualizacao parcial: so grava as chaves presentes no payload.

    O arraste envia geometria e o editor envia texto; como os dois salvam com
    debounce, um PUT completo faria um sobrescrever o campo do outro.

    SELECT e UPDATE aqui NÃO ficam numa transação, e isso é deliberado: o pool
    roda em autocommit, e envolver os dois custaria um `BEGIN` e um `COMMIT` —
    duas idas de rede a mais — sem comprar segurança nenhuma. O UPDATE já filtra
    por `user_id`, e cada patch grava só as chaves que ele mesmo trouxe, então
    dois patches simultâneos não se sobrescrevem. O SELECT serve para dizer se o
    post-it existe e para dar o valor atual como piso do clamp quando o payload
    manda algo inválido — nada que uma leitura um instante mais velha estrague.
    """
    with get_connection() as conn:
        row = conn.execute(
            _NOTE_SELECT + " WHERE id = %s AND user_id = %s", (note_id, user_id)
        ).fetchone()
        if row is None:
            return None

        updates = {}
        if "content" in fields:
            updates["content"] = str(fields.get("content") or "")[:2000]
        if "bucket" in fields:
            updates["bucket"] = _normalize_note_bucket(fields.get("bucket"))
        if "color" in fields:
            updates["color"] = _normalize_note_color(fields.get("color"))
        for key, source in (("pos_x", "x"), ("pos_y", "y"), ("width", "width"),
                            ("height", "height"), ("z_index", "z")):
            if source in fields:
                updates[key] = _clamp_note_int(key, fields.get(source), row[key])

        if updates:
            updates["updated_at"] = utc_now_iso()
            # As chaves vêm de `updates`, montado a partir de uma lista fixa de
            # campos logo acima — nada do payload entra no texto da consulta.
            assignments = ", ".join(key + " = %(" + key + ")s" for key in updates)
            row = conn.execute(
                "UPDATE sticky_notes SET " + assignments
                + " WHERE id = %(note_id)s AND user_id = %(user_id)s"
                + " RETURNING " + _NOTE_COLUMNS,
                dict(updates, note_id=note_id, user_id=user_id),
            ).fetchone()

    return _row_to_note_dict(row)


def delete_sticky_note(user_id: int, note_id: int) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM sticky_notes WHERE id = %s AND user_id = %s",
            (note_id, user_id),
        )
    return cursor.rowcount > 0
