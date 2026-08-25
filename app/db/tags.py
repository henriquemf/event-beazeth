"""Tags de evento: rótulo, cor e regra de lembrete.

A chave é (user_id, slug): o slug continua sendo o que `events.tag_type` guarda,
e o par garante que a tag "prova" de uma conta não colida com a de outra.
"""

import re
import unicodedata

from app.db.connection import get_connection, utc_now_iso


# A regra decide quantos lembretes o agendador arma para o evento. São só duas
# porque são as duas que `services/scheduler_service.py` sabe montar; tag nova
# escolhe entre elas em vez de inventar um cronograma que ninguém dispara.
REMINDER_RULES = {
    "dia": {"title": "Só no dia", "hint": "Um aviso, na hora marcada"},
    "curso": {"title": "Com antecedência", "hint": "Na hora, e 15 e 7 dias antes"},
}

# `evento` é o destino de quem fica sem tag (tag apagada), então é a única que
# não pode ser removida. Toda conta nasce com ela.
FALLBACK_TAG = "evento"

# Cor em hex de 6 dígitos: o valor é escrito como custom property inline no
# HTML, então precisa ser validado aqui e não só no <input type="color">.
COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")

MAX_LABEL_LENGTH = 24

# Atalhos de cor do formulário. Ficam aqui e não no template porque são dado da
# tag como qualquer outro — o template não decide nada (regra 7).
SUGGESTED_COLORS = (
    "#7ec8ff", "#f38ab7", "#b56dff", "#ff8d91",
    "#ffc46b", "#6fd8aa", "#89c9d8", "#ff78b2",
)

# Semeadas em `create_user`, e não na criação das tabelas: elas pertencem a uma
# conta, não ao banco.
DEFAULT_TAGS = (
    ("evento", "Evento", "#7ec8ff", "dia"),
    ("curso", "Curso", "#f38ab7", "curso"),
)

_TAG_SELECT = "SELECT slug, label, color, reminder_rule FROM event_tags"


def slugify(label: str) -> str:
    """Converte o rótulo digitado na chave usada por `events.tag_type`."""
    normalized = unicodedata.normalize("NFKD", label)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "-", ascii_only).strip("-")


def normalize_color(color: str) -> str:
    """Devolve a cor em hex minúsculo, ou "" se não for hex de 6 dígitos."""
    value = (color or "").strip()
    return value.lower() if COLOR_PATTERN.match(value) else ""


def list_tags(user_id: int):
    with get_connection() as conn:
        # `id` desempata: `created_at` tem precisão de segundo e as duas tags
        # padrão são semeadas no mesmo segundo. Sem ele a ordem podia virar, e a
        # primeira da lista é a que já vem marcada no popup de agendamento.
        rows = conn.execute(
            _TAG_SELECT + " WHERE user_id = %s ORDER BY created_at ASC, slug ASC",
            (user_id,),
        ).fetchall()
    return rows


def count_events_by_tag(user_id: int):
    """Quantos eventos cada tag tem. A tela de tags avisa antes de remover."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT tag_type, COUNT(*) AS total FROM events WHERE user_id = %s GROUP BY tag_type",
            (user_id,),
        ).fetchall()
    return {row["tag_type"]: row["total"] for row in rows}


def insert_tag(user_id: int, slug: str, label: str, color: str, reminder_rule: str) -> bool:
    """Cria a tag. Devolve False se a conta já tiver esse slug."""
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO event_tags (user_id, slug, label, color, reminder_rule, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, slug) DO NOTHING
            """,
            (user_id, slug, label.strip(), color, reminder_rule, utc_now_iso()),
        )
    return cursor.rowcount > 0


def delete_tag(user_id: int, slug: str) -> int:
    """Remove a tag e devolve quantos eventos voltaram para a tag padrão.

    Os eventos são reapontados em vez de apagados junto: a tag é uma etiqueta,
    perder o compromisso ao trocar de etiqueta seria destruir o que importa.
    """
    with get_connection() as conn:
        moved = conn.execute(
            "UPDATE events SET tag_type = %s WHERE user_id = %s AND tag_type = %s",
            (FALLBACK_TAG, user_id, slug),
        ).rowcount
        conn.execute(
            "DELETE FROM event_tags WHERE user_id = %s AND slug = %s",
            (user_id, slug),
        )
    return moved
