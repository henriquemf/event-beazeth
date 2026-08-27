"""Lista de tarefas da semana.

A navegação entre semanas é navegação de verdade (`/todo?semana=...`), não troca
de conteúdo por fetch: cada semana ganha URL própria, o botão voltar funciona e a
tela chega pintada do servidor. O JS só cuida do que muda sem sair da página —
marcar, escrever, apagar.
"""

from datetime import date, timedelta

from flask import Blueprint, jsonify, render_template, request

from app.auth import current_user
from app.db import (
    MAX_CONTENT,
    delete_todo_item,
    insert_todo_item,
    list_todo_items,
    parse_day,
    update_todo_item,
    week_bounds,
)


bp = Blueprint("todo", __name__)

MONTHS = (
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
)

WEEKDAYS = ("Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo")
WEEKDAYS_SHORT = ("Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom")

NOT_FOUND = "Tarefa não encontrada."


def build_week(reference: date, items: list[dict]) -> list[dict]:
    """Os sete dias com seus itens, prontos para o template.

    O agrupamento é feito aqui e não no Jinja: template que filtra lista dentro
    de laço vira sete varreduras da mesma coleção, e um lugar a mais onde a
    regra de negócio pode divergir da do servidor.
    """
    monday, _ = week_bounds(reference)
    today = date.today()

    by_day: dict[str, list[dict]] = {}
    for item in items:
        by_day.setdefault(item["day"], []).append(item)

    days = []
    for offset in range(7):
        current = monday + timedelta(days=offset)
        iso = current.isoformat()
        day_items = by_day.get(iso, [])
        days.append(
            {
                "iso": iso,
                "number": f"{current.day:02d}",
                "weekday": WEEKDAYS[offset],
                "weekday_short": WEEKDAYS_SHORT[offset],
                "is_today": current == today,
                "is_weekend": offset >= 5,
                "items": day_items,
                "done": sum(1 for item in day_items if item["done"]),
                "total": len(day_items),
            }
        )
    return days


def build_header(reference: date) -> dict:
    """Mês, ano, número da semana e intervalo, como no topo de uma agenda."""
    monday, sunday = week_bounds(reference)

    # Semana que cruza o mês (ou o ano) precisa dizer os dois, senão o título
    # mente na metade dos dias que estão logo abaixo dele.
    if monday.month == sunday.month:
        month_label = MONTHS[monday.month - 1]
    else:
        month_label = f"{MONTHS[monday.month - 1]} – {MONTHS[sunday.month - 1]}"

    year_label = str(monday.year) if monday.year == sunday.year else f"{monday.year}/{sunday.year}"

    return {
        "month": month_label,
        "year": year_label,
        "week_number": monday.isocalendar()[1],
        "range": f"{monday.day} → {sunday.day}",
        "monday": monday.isoformat(),
        "previous": (monday - timedelta(days=7)).isoformat(),
        "next": (monday + timedelta(days=7)).isoformat(),
        "is_current": week_bounds(date.today())[0] == monday,
    }


@bp.get("/todo")
def index():
    reference = parse_day(request.args.get("semana")) or date.today()
    monday, sunday = week_bounds(reference)

    items = list_todo_items(current_user()["id"], monday, sunday)
    days = build_week(reference, items)

    return render_template(
        "pages/todo.html",
        active_page="todo",
        header=build_header(reference),
        days=days,
        done=sum(day["done"] for day in days),
        total=sum(day["total"] for day in days),
        # Espelha o limite validado em app/db/todo.py: o `maxlength` do campo
        # evita o usuario digitar o que o servidor vai cortar calado.
        max_content=MAX_CONTENT,
    )


@bp.get("/api/todo")
def list_items():
    """A semana em JSON, para quem não recebe HTML pronto (o app nativo).

    Mesma semana que `/todo` renderiza, mesmo formato de dia e item — quem
    muda a regra da semana muda para os dois de uma vez, porque os dois passam
    por `week_bounds` e `build_week`.
    """
    reference = parse_day(request.args.get("semana")) or date.today()
    monday, sunday = week_bounds(reference)

    items = list_todo_items(current_user()["id"], monday, sunday)
    days = build_week(reference, items)

    return jsonify({
        "ok": True,
        "header": build_header(reference),
        "days": days,
        "done": sum(day["done"] for day in days),
        "total": sum(day["total"] for day in days),
        "maxContent": MAX_CONTENT,
    })


@bp.post("/api/todo")
def create_item():
    payload = request.get_json(silent=True) or {}
    day = parse_day(payload.get("day"))
    if day is None:
        return jsonify({"ok": False, "message": "Dia inválido."}), 400

    item = insert_todo_item(current_user()["id"], day, payload.get("content", ""))
    if item is None:
        return jsonify({"ok": False, "message": "Não foi possível criar a tarefa."}), 400
    return jsonify({"ok": True, "item": item}), 201


@bp.patch("/api/todo/<int:item_id>")
def patch_item(item_id: int):
    payload = request.get_json(silent=True) or {}
    item = update_todo_item(current_user()["id"], item_id, payload)
    if item is None:
        return jsonify({"ok": False, "message": NOT_FOUND}), 404
    return jsonify({"ok": True, "item": item})


@bp.delete("/api/todo/<int:item_id>")
def remove_item(item_id: int):
    if not delete_todo_item(current_user()["id"], item_id):
        return jsonify({"ok": False, "message": NOT_FOUND}), 404
    return jsonify({"ok": True})
