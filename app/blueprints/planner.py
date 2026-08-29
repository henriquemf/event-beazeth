"""Tela do weekly planner: grade semanal e CRUD dos blocos."""

from flask import Blueprint, jsonify, render_template, request

from app.auth import current_user

from app.db import (
    delete_planner_block,
    insert_planner_block,
    list_planner_blocks,
    update_planner_block,
)


bp = Blueprint("planner", __name__)

DAY_MINUTES = 1440
MAX_TITLE = 120
MAX_NOTES = 500


def parse_block_payload(payload):
    """Valida e normaliza o corpo de um bloco do planner.

    Retorna (dados, None) em sucesso ou (None, mensagem de erro).
    """
    title = (payload.get("title") or "").strip()
    if not title:
        return None, "Informe o título do bloco."
    if len(title) > MAX_TITLE:
        title = title[:MAX_TITLE]

    notes = (payload.get("notes") or "").strip()[:MAX_NOTES]

    try:
        start_minute = int(payload.get("startMinute"))
        end_minute = int(payload.get("endMinute"))
    except (TypeError, ValueError):
        return None, "Horário inválido."

    is_routine = bool(payload.get("isRoutine"))

    try:
        day_of_week = int(payload.get("dayOfWeek", 0))
    except (TypeError, ValueError):
        day_of_week = 0

    if not is_routine and not 0 <= day_of_week <= 6:
        return None, "Dia da semana inválido."

    # Qualquer minuto serve. O que se exige é só o que não pode deixar de
    # valer: o bloco cabe no dia e termina depois de começar.
    #
    # Antes o piso aqui era um slot de 15 minutos, o mesmo do arraste. Isso
    # tornava impossível um bloco das 12:20 às 12:25 -- ele voltava do servidor
    # terminando 12:35, sem aviso nenhum. A grade é uma conveniência de gesto,
    # e não uma regra do dado.
    start_minute = max(0, min(start_minute, DAY_MINUTES - 1))
    end_minute = max(start_minute + 1, min(end_minute, DAY_MINUTES))

    return (
        {
            "title": title,
            "notes": notes,
            "day_of_week": day_of_week,
            "start_minute": start_minute,
            "end_minute": end_minute,
            "color": payload.get("color") or "rose",
            "is_routine": is_routine,
        },
        None,
    )


@bp.get("/planner")
def index():
    return render_template("pages/planner.html", active_page="planner")


@bp.get("/api/planner/blocks")
def blocks_list():
    return jsonify({"ok": True, "blocks": list_planner_blocks(current_user()["id"])})


@bp.post("/api/planner/blocks")
def blocks_create():
    data, error = parse_block_payload(request.get_json(silent=True) or {})
    if error:
        return jsonify({"ok": False, "message": error}), 400

    block = insert_planner_block(current_user()["id"], **data)
    return jsonify({"ok": True, "block": block}), 201


@bp.put("/api/planner/blocks/<int:block_id>")
def blocks_update(block_id: int):
    data, error = parse_block_payload(request.get_json(silent=True) or {})
    if error:
        return jsonify({"ok": False, "message": error}), 400

    block = update_planner_block(current_user()["id"], block_id, **data)
    if block is None:
        return jsonify({"ok": False, "message": "Bloco não encontrado."}), 404
    return jsonify({"ok": True, "block": block})


@bp.delete("/api/planner/blocks/<int:block_id>")
def blocks_delete(block_id: int):
    if not delete_planner_block(current_user()["id"], block_id):
        return jsonify({"ok": False, "message": "Bloco não encontrado."}), 404
    return jsonify({"ok": True})
