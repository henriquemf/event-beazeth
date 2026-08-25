"""Tela de calendário: mês, próximos eventos, popup de cadastro e feed do FullCalendar.

Virou a tela única dos eventos: o cadastro que tinha aba própria em `/events`
agora é o popup que abre ao clicar num dia, e "Próximos eventos" veio junto
para a coluna da direita.
"""

from datetime import datetime

from flask import Blueprint, current_app, jsonify, render_template

from app.blueprints.events import as_card
from app.db import (
    FALLBACK_TAG,
    MAX_LABEL_LENGTH,
    REMINDER_RULES,
    SUGGESTED_COLORS,
    count_events_by_tag,
    list_events,
    list_tags,
)


bp = Blueprint("calendar", __name__)

# Quantos cartões cabem na coluna lateral sem ela virar uma segunda lista
# rolável ao lado do mês.
UPCOMING_LIMIT = 3

# Cor do texto dentro do bloco do FullCalendar. Fixa e escura porque o fundo do
# bloco é a cor da tag, escolhida pelo usuário e sempre clara o bastante — o
# tema da página não alcança o interior do componente de terceiro.
EVENT_TEXT_COLOR = "#2b1033"


def _starts_from(row, floor: datetime) -> bool:
    """O evento ainda está por vir? Data inválida some da lista, não quebra."""
    raw = row["event_datetime"]
    try:
        moment = datetime.fromisoformat(raw if "T" in raw else f"{raw}T09:00")
    except ValueError:
        return False
    return moment >= floor


@bp.get("/calendar")
def index():
    db_path = current_app.config["DB_PATH"]
    rows = list_events(db_path)

    # O piso é a meia-noite de hoje, não `now`: um evento das 09:00 tem que
    # continuar na lista às 10:00 — ele ainda é o compromisso de hoje.
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    upcoming = [as_card(row) for row in rows if _starts_from(row, today)]

    return render_template(
        "pages/calendar.html",
        active_page="calendar",
        upcoming=upcoming[:UPCOMING_LIMIT],
        upcoming_total=len(upcoming),
        tags=list_tags(db_path),
        tag_usage=count_events_by_tag(db_path),
        reminder_rules=REMINDER_RULES,
        fallback_tag=FALLBACK_TAG,
        max_label_length=MAX_LABEL_LENGTH,
        swatches=SUGGESTED_COLORS,
    )


@bp.get("/api/events")
def events_api():
    rows = list_events(current_app.config["DB_PATH"])
    payload = []
    for event in rows:
        payload.append(
            {
                "id": event["id"],
                "title": event["title"],
                "start": event["event_datetime"],
                "allDay": False,
                "extendedProps": {
                    "description": event["description"] or "-",
                    "tagType": event["tag_type"],
                    "tagLabel": event["tag_label"],
                    "tagColor": event["tag_color"],
                },
                "backgroundColor": event["tag_color"],
                "borderColor": event["tag_color"],
                "textColor": EVENT_TEXT_COLOR,
            }
        )
    return jsonify(payload)
