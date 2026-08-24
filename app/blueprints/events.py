"""Tela de cadastro e lista de eventos."""

from datetime import datetime

from flask import (
    Blueprint,
    current_app,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)

from app.db import delete_event, insert_event, list_events, update_event


bp = Blueprint("events", __name__)


def parse_event_datetime(value: str):
    """Converte o campo do formulário em datetime.

    Aceita `YYYY-MM-DD` (assume 09:00) ou `YYYY-MM-DDTHH:MM`.
    Retorna (datetime, None) em sucesso ou (None, mensagem de erro).
    """
    try:
        if "T" in value:
            dt = datetime.fromisoformat(value)
        else:
            dt = datetime.fromisoformat(f"{value}T09:00")
    except ValueError:
        return None, "Data/hora inválida."

    if dt < datetime.now():
        return None, "A data/hora precisa estar no futuro."

    return dt, None


def read_event_form():
    """Extrai e normaliza os campos do formulário de evento."""
    return (
        request.form.get("title", "").strip(),
        request.form.get("description", "").strip(),
        request.form.get("event_datetime", "").strip(),
        request.form.get("tag_type", "evento").strip().lower(),
    )


@bp.route("/events", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        title, description, event_datetime, tag_type = read_event_form()

        if not title:
            flash("Informe o título do evento.", "error")
            return redirect(url_for("events.index"))

        if not event_datetime:
            flash("Informe a data do evento (horário é opcional).", "error")
            return redirect(url_for("events.index"))

        _, error = parse_event_datetime(event_datetime)
        if error:
            flash(error, "error")
            return redirect(url_for("events.index"))

        insert_event(
            current_app.config["DB_PATH"],
            title,
            description,
            event_datetime,
            tag_type,
        )
        flash("Evento cadastrado com sucesso.", "success")
        return redirect(url_for("events.index"))

    events = list_events(current_app.config["DB_PATH"])
    return render_template("pages/events.html", events=events, active_page="events")


@bp.post("/events/<int:event_id>/delete")
def remove_event(event_id: int):
    delete_event(current_app.config["DB_PATH"], event_id)
    flash("Evento removido.", "success")
    return redirect(url_for("events.index"))


@bp.post("/events/<int:event_id>/update")
def edit_event(event_id: int):
    title, description, event_datetime, tag_type = read_event_form()

    if not title:
        flash("Informe o título do evento.", "error")
        return redirect(url_for("calendar.index"))

    if not event_datetime:
        flash("Informe a data do evento.", "error")
        return redirect(url_for("calendar.index"))

    _, error = parse_event_datetime(event_datetime)
    if error:
        flash(error, "error")
        return redirect(url_for("calendar.index"))

    updated = update_event(
        current_app.config["DB_PATH"],
        event_id,
        title,
        description,
        event_datetime,
        tag_type,
    )
    if updated:
        flash("Evento atualizado com sucesso.", "success")
    else:
        flash("Evento não encontrado.", "error")
    return redirect(url_for("calendar.index"))
