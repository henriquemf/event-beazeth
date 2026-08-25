"""Itens da lista semanal de tarefas.

Um item pertence a um DIA, e não a uma semana: a semana é só o recorte que a
tela mostra. Guardar o dia deixa a navegação entre semanas ser uma consulta por
intervalo, e mover um item de dia vira um `UPDATE` de uma coluna só.

`day` é TEXT em ISO-8601 (`2026-08-17`) e não DATE, pela mesma razão que
`event_datetime`: é o formato que chega do formulário, é o que o JS devolve, e a
ordenação lexicográfica de ISO-8601 coincide com a cronológica.
"""

from datetime import date, timedelta

from app.db.connection import get_connection, utc_now_iso


MAX_CONTENT = 500

# Teto por dia. Não é limitação de banco: é o que impede um laço com defeito no
# cliente de encher a tabela sem ninguém perceber.
MAX_ITEMS_PER_DAY = 60


def parse_day(value) -> date | None:
    """Aceita só `YYYY-MM-DD`. Devolve `None` para qualquer outra coisa."""
    try:
        return date.fromisoformat(str(value).strip())
    except (TypeError, ValueError):
        return None


def week_bounds(reference: date) -> tuple[date, date]:
    """Segunda e domingo da semana de `reference`.

    Segunda como primeiro dia porque é assim que a semana é numerada no padrão
    ISO, que é o mesmo que a tela mostra ("semana 34").
    """
    monday = reference - timedelta(days=reference.weekday())
    return monday, monday + timedelta(days=6)


def _row_to_item(row) -> dict:
    return {
        "id": row["id"],
        "day": row["day"],
        "content": row["content"] or "",
        "done": bool(row["done"]),
        "position": row["position"],
    }


_ITEM_COLUMNS = "id, day, content, done, position"

_ITEM_SELECT = "SELECT " + _ITEM_COLUMNS + " FROM todo_items"


def list_todo_items(user_id: int, start: date, end: date) -> list[dict]:
    """Itens de um intervalo fechado de dias, já na ordem em que a tela mostra."""
    with get_connection() as conn:
        rows = conn.execute(
            _ITEM_SELECT + """
            WHERE user_id = %s AND day >= %s AND day <= %s
            ORDER BY day ASC, position ASC, id ASC
            """,
            (user_id, start.isoformat(), end.isoformat()),
        ).fetchall()
    return [_row_to_item(row) for row in rows]


def insert_todo_item(user_id: int, day: date, content: str) -> dict | None:
    """Cria no fim do dia. Devolve `None` se o dia já estiver cheio."""
    text = (content or "").strip()[:MAX_CONTENT]
    if not text:
        return None

    with get_connection() as conn:
        total = conn.execute(
            "SELECT COUNT(*) AS total FROM todo_items WHERE user_id = %s AND day = %s",
            (user_id, day.isoformat()),
        ).fetchone()["total"]
        if total >= MAX_ITEMS_PER_DAY:
            return None

        # `COALESCE(MAX(...), 0) + 1` numa consulta só: buscar o máximo e depois
        # inserir daria duas idas ao banco e uma corrida entre duas abas.
        row = conn.execute(
            """
            INSERT INTO todo_items (user_id, day, content, done, position, created_at)
            SELECT %(user_id)s, %(day)s, %(content)s, FALSE,
                   COALESCE(MAX(position), 0) + 1, %(created_at)s
            FROM todo_items WHERE user_id = %(user_id)s AND day = %(day)s
            RETURNING """ + _ITEM_COLUMNS,
            {
                "user_id": user_id,
                "day": day.isoformat(),
                "content": text,
                "created_at": utc_now_iso(),
            },
        ).fetchone()
    return _row_to_item(row)


def update_todo_item(user_id: int, item_id: int, fields: dict) -> dict | None:
    """Atualização parcial: só grava as chaves presentes no payload.

    Marcar concluído e editar o texto são duas ações independentes na tela, e o
    texto salva com debounce — um PUT completo faria uma sobrescrever a outra.
    """
    updates = {}

    if "content" in fields:
        text = str(fields.get("content") or "").strip()[:MAX_CONTENT]
        if not text:
            return None
        updates["content"] = text

    if "done" in fields:
        updates["done"] = bool(fields.get("done"))

    if "day" in fields:
        novo_dia = parse_day(fields.get("day"))
        if novo_dia is None:
            return None
        updates["day"] = novo_dia.isoformat()

    if not updates:
        return None

    with get_connection() as conn:
        # As chaves vêm da lista fixa acima; nada do payload entra no texto da
        # consulta. O `user_id` no WHERE é o que impede editar item de outra
        # conta trocando o id da URL.
        assignments = ", ".join(key + " = %(" + key + ")s" for key in updates)
        row = conn.execute(
            "UPDATE todo_items SET " + assignments
            + " WHERE id = %(item_id)s AND user_id = %(user_id)s"
            + " RETURNING " + _ITEM_COLUMNS,
            dict(updates, item_id=item_id, user_id=user_id),
        ).fetchone()

    return _row_to_item(row) if row else None


def delete_todo_item(user_id: int, item_id: int) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM todo_items WHERE id = %s AND user_id = %s",
            (item_id, user_id),
        )
    return cursor.rowcount > 0
