"""Recurso evento: criação, edição e remoção.

Não tem tela própria desde que o cadastro virou popup do calendário — todas as
rotas daqui são POST e voltam para `/calendar`. O que sobrou de leitura é o
view model (`as_card`), que o calendário importa para montar "Próximos eventos".
"""

from datetime import datetime

from flask import (
    Blueprint,
    flash,
    redirect,
    request,
    url_for,
)

from app.auth import current_user
from app.db import FALLBACK_TAG, delete_event, insert_event, update_event


bp = Blueprint("events", __name__)

MONTHS_SHORT = ("JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
                "JUL", "AGO", "SET", "OUT", "NOV", "DEZ")


def as_card(row):
    """Prepara a linha para o cartão da lista.

    A data é quebrada aqui em vez de no template: Jinja teria que fatiar a
    string ISO na mão e ainda mapear o número do mês para o nome.
    """
    raw = row["event_datetime"]
    has_time = "T" in raw

    try:
        moment = datetime.fromisoformat(raw if has_time else f"{raw}T09:00")
    except ValueError:
        moment = None

    return {
        "id": row["id"],
        "title": row["title"],
        "description": row["description"],
        "tag_type": row["tag_type"],
        "tag_label": row["tag_label"],
        "tag_color": row["tag_color"],
        "event_datetime": raw,
        "day": f"{moment.day:02d}" if moment else "--",
        "month": MONTHS_SHORT[moment.month - 1] if moment else "",
        "year": moment.year if moment else "",
        "time": moment.strftime("%H:%M") if moment and has_time else "",
    }


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
        request.form.get("tag_type", FALLBACK_TAG).strip().lower(),
    )


def validated_form():
    """Campos do formulário, ou (None, mensagem) no primeiro erro."""
    title, description, event_datetime, tag_type = read_event_form()

    if not title:
        return None, "Informe o título do evento."

    if not event_datetime:
        return None, "Informe a data do evento (horário é opcional)."

    _, error = parse_event_datetime(event_datetime)
    if error:
        return None, error

    return (title, description, event_datetime, tag_type), None


@bp.post("/events")
def create_event():
    fields, error = validated_form()
    if error:
        flash(error, "error")
        return redirect(url_for("calendar.index"))

    insert_event(current_user()["id"], *fields)
    flash("Evento cadastrado com sucesso.", "success")
    return redirect(url_for("calendar.index"))


@bp.post("/events/<int:event_id>/delete")
def remove_event(event_id: int):
    # A checagem do dono vive no WHERE da consulta: o id vem do cliente, e sem
    # ela trocar o número na URL apagaria evento de outra conta.
    if delete_event(current_user()["id"], event_id):
        flash("Evento removido.", "success")
    else:
        flash("Evento não encontrado.", "error")
    return redirect(url_for("calendar.index"))


@bp.post("/events/<int:event_id>/update")
def edit_event(event_id: int):
    fields, error = validated_form()
    if error:
        flash(error, "error")
        return redirect(url_for("calendar.index"))

    if update_event(current_user()["id"], event_id, *fields):
        flash("Evento atualizado com sucesso.", "success")
    else:
        flash("Evento não encontrado.", "error")
    return redirect(url_for("calendar.index"))
