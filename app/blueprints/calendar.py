"""Tela de calendário: visualização mensal e feed de eventos para o FullCalendar."""

from flask import Blueprint, current_app, jsonify, render_template

from app.db import list_events


bp = Blueprint("calendar", __name__)

# Cores das tags no calendário, iguais às da legenda da barra lateral.
COURSE_COLORS = {"background": "#f38ab7", "border": "#e25a95"}
EVENT_COLORS = {"background": "#7ec8ff", "border": "#4fa5e4"}
TEXT_COLOR = "#2b1033"


@bp.get("/calendar")
def index():
    return render_template("pages/calendar.html", active_page="calendar")


@bp.get("/api/events")
def events_api():
    rows = list_events(current_app.config["DB_PATH"])
    payload = []
    for event in rows:
        is_course = event["tag_type"] == "curso"
        colors = COURSE_COLORS if is_course else EVENT_COLORS
        payload.append(
            {
                "id": event["id"],
                "title": event["title"],
                "start": event["event_datetime"],
                "allDay": False,
                "extendedProps": {
                    "description": event["description"] or "-",
                    "tagType": event["tag_type"],
                },
                "backgroundColor": colors["background"],
                "borderColor": colors["border"],
                "textColor": TEXT_COLOR,
            }
        )
    return jsonify(payload)
