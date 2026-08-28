"""Eventos e cursos cadastrados."""

from app.db.connection import get_connection, utc_now_iso
from app.db.tags import FALLBACK_TAG


# Toda leitura de evento sai com o rótulo e a cor da tag junto. O LEFT JOIN é
# por (user_id, slug) e cobre o evento cuja tag foi apagada entre a escrita e a
# leitura: `COALESCE` devolve o padrão em vez de deixar a tela sem cor nenhuma.
_EVENT_SELECT = """
    SELECT e.id,
           e.user_id,
           e.title,
           e.description,
           e.event_datetime,
           e.tag_type,
           COALESCE(t.label, 'Evento') AS tag_label,
           COALESCE(t.color, '#7ec8ff') AS tag_color,
           COALESCE(t.reminder_rule, 'dia') AS reminder_rule
    FROM events e
    LEFT JOIN event_tags t ON t.slug = e.tag_type AND t.user_id = e.user_id
"""


def _existing_tag(conn, user_id: int, tag_type: str) -> str:
    """Aceita a tag só se ela existe NA CONTA; senão devolve a padrão.

    A validação é aqui, e não no blueprint, porque `tag_type` é uma referência
    a `event_tags.slug` sem FOREIGN KEY — e é também o que impede alguém de
    marcar o próprio evento com o slug de uma tag de outra pessoa.
    """
    row = conn.execute(
        "SELECT 1 FROM event_tags WHERE user_id = %s AND slug = %s",
        (user_id, tag_type),
    ).fetchone()
    return tag_type if row else FALLBACK_TAG


def insert_event(
    user_id: int,
    title: str,
    description: str,
    event_datetime: str,
    tag_type: str,
) -> int:
    """Cria o evento e devolve o id.

    O id importa para o app Android: ele cria a linha localmente com um id
    provisorio negativo e precisa saber qual id o servidor emitiu para trocar a
    linha e reescrever a fila de pendencias. A tela do site ignora o retorno.
    """
    with get_connection() as conn:
        linha = conn.execute(
            """
            INSERT INTO events (user_id, title, description, event_datetime, tag_type, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                user_id,
                title.strip(),
                description.strip(),
                event_datetime,
                _existing_tag(conn, user_id, tag_type),
                utc_now_iso(),
            ),
        ).fetchone()
    return linha["id"]


def get_event(user_id: int, event_id: int):
    """Um evento da conta, com a tag ja resolvida — ou `None`.

    O `user_id` no WHERE nao e redundante com o `id`: sem ele, trocar o numero
    na URL leria evento de outra conta.
    """
    with get_connection() as conn:
        return conn.execute(
            _EVENT_SELECT + " WHERE e.id = %s AND e.user_id = %s",
            (event_id, user_id),
        ).fetchone()


def delete_event(user_id: int, event_id: int) -> bool:
    """O `user_id` no WHERE é o que impede apagar evento de outra conta trocando
    o id na URL — a rota recebe o id do cliente e confia nele."""
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM events WHERE id = %s AND user_id = %s",
            (event_id, user_id),
        )
    return cursor.rowcount > 0


def update_event(
    user_id: int,
    event_id: int,
    title: str,
    description: str,
    event_datetime: str,
    tag_type: str,
) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE events
            SET title = %s,
                description = %s,
                event_datetime = %s,
                tag_type = %s
            WHERE id = %s AND user_id = %s
            """,
            (
                title.strip(),
                description.strip(),
                event_datetime,
                _existing_tag(conn, user_id, tag_type),
                event_id,
                user_id,
            ),
        )
    return cursor.rowcount > 0


def list_events(user_id: int):
    with get_connection() as conn:
        rows = conn.execute(
            _EVENT_SELECT + " WHERE e.user_id = %s ORDER BY e.event_datetime ASC",
            (user_id,),
        ).fetchall()
    return rows


def list_due_event_candidates(window_start: str, window_end: str):
    """Candidatos a lembrete de TODAS as contas.

    Sem `user_id`: quem chama é o agendador, que roda fora de requisição e
    precisa varrer o banco inteiro. Cada linha traz o dono para o disparo saber
    a quem mandar.
    """
    with get_connection() as conn:
        rows = conn.execute(
            _EVENT_SELECT + " WHERE e.event_datetime BETWEEN %s AND %s",
            (window_start, window_end),
        ).fetchall()
    return rows
