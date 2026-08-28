"""Recurso evento: criação, edição e remoção.

Não tem tela própria desde que o cadastro virou popup do calendário — todas as
rotas daqui são POST e voltam para `/calendar`. O que sobrou de leitura é o
view model (`as_card`), que o calendário importa para montar "Próximos eventos".
"""

from datetime import datetime

from flask import (
    Blueprint,
    flash,
    jsonify,
    redirect,
    request,
    url_for,
)

from app.auth import current_user
from app.db import FALLBACK_TAG, delete_event, get_event, insert_event, update_event


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


# ---------------------------------------------------------------------- API
#
# As tres rotas abaixo existem para o app Android. Nao dava para ele reusar
# `POST /events`: aquela rota le `request.form`, responde 302 e comunica erro
# por `flash` -- tres coisas que um cliente JSON nao tem como consumir.
#
# O corpo aceita os dois estilos de nome (`eventDatetime` e `event_datetime`)
# porque o proprio servidor e inconsistente: `/api/sync` entrega os eventos em
# snake_case, vindos direto do SELECT, enquanto as rotas escritas a mao usam
# camelCase. Aceitar os dois no PEDIDO custa uma linha e evita que o app tenha
# de lembrar de qual lado esta.


def _campos_do_json(payload):
    """Os mesmos quatro campos de `read_event_form`, vindos de JSON."""
    def pega(*nomes):
        for nome in nomes:
            if nome in payload:
                return str(payload.get(nome) or "").strip()
        return ""

    titulo = pega("title")
    descricao = pega("description")
    quando = pega("eventDatetime", "event_datetime")
    tag = pega("tagType", "tag_type").lower() or FALLBACK_TAG

    if not titulo:
        return None, "Informe o título do evento."
    if not quando:
        return None, "Informe a data do evento (horário é opcional)."

    _, erro = parse_event_datetime(quando)
    if erro:
        return None, erro

    return (titulo, descricao, quando, tag), None


def _evento_em_json(user_id: int, event_id: int):
    """O evento no MESMO formato que `/api/sync` entrega.

    Igual de proposito: o app desserializa os dois com a mesma classe, e um
    formato proprio aqui seria uma segunda forma de ler a mesma coisa.
    """
    linha = get_event(user_id, event_id)
    if linha is None:
        return None
    return {k: v for k, v in linha.items() if k != "user_id"}


@bp.post("/api/events")
def api_create_event():
    fields, error = _campos_do_json(request.get_json(silent=True) or {})
    if error:
        return jsonify({"ok": False, "message": error}), 400

    user_id = current_user()["id"]
    event_id = insert_event(user_id, *fields)
    return jsonify({"ok": True, "event": _evento_em_json(user_id, event_id)}), 201


@bp.patch("/api/events/<int:event_id>")
def api_update_event(event_id: int):
    fields, error = _campos_do_json(request.get_json(silent=True) or {})
    if error:
        return jsonify({"ok": False, "message": error}), 400

    user_id = current_user()["id"]
    if not update_event(user_id, event_id, *fields):
        return jsonify({"ok": False, "message": "Evento não encontrado."}), 404
    return jsonify({"ok": True, "event": _evento_em_json(user_id, event_id)})


@bp.delete("/api/events/<int:event_id>")
def api_delete_event(event_id: int):
    if not delete_event(current_user()["id"], event_id):
        return jsonify({"ok": False, "message": "Evento não encontrado."}), 404
    return jsonify({"ok": True})
