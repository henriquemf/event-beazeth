"""Tela do pomodoro, e os temporizadores da conta.

A contagem continua do cliente: ela precisa seguir entre navegações e mesmo
offline, então o relógio roda no localStorage (site) e no DataStore (app). O
que passa por aqui é o ESTADO de cada temporizador depois de cada ação, para
o que se começa no PC aparecer no celular e vice-versa -- ver
`app/db/pomodoros.py`.

A lista de tempos prontos também fica no Python, para os botões chegarem
renderizados no HTML em vez de montados por JS depois da pintura.
"""

from flask import Blueprint, jsonify, render_template, request

from app.auth import current_user
from app.db import (
    MAX_POMODOROS,
    POMODORO_PRINCIPAL,
    apagar_pomodoro,
    gravar_pomodoro,
    id_de_pomodoro_valido,
    listar_pomodoros,
)


bp = Blueprint("pomodoro", __name__)

# Espelham os limites de app/static/js/core/pomodoro.js (MIN/MAX_MINUTES): aqui
# eles só alimentam os atributos `min`/`max` dos campos.
MIN_MINUTES = 1
MAX_MINUTES = 600

PRESETS = (
    {"minutes": 5, "label": "Respiro"},
    {"minutes": 15, "label": "Rápido"},
    {"minutes": 25, "label": "Clássico"},
    {"minutes": 30, "label": "Foco"},
    {"minutes": 45, "label": "Longo"},
    {"minutes": 60, "label": "Profundo"},
)


ID_INVALIDO = "Temporizador inválido."


@bp.get("/api/pomodoro")
def pomodoros():
    return jsonify({"ok": True, "pomodoros": listar_pomodoros(current_user()["id"])})


@bp.put("/api/pomodoro/<timer_id>")
def gravar(timer_id):
    """O estado de um temporizador depois de uma ação de quem está na tela."""
    if not id_de_pomodoro_valido(timer_id):
        return jsonify({"ok": False, "message": ID_INVALIDO}), 400
    pomodoro = gravar_pomodoro(current_user()["id"], timer_id, request.get_json(silent=True))
    if pomodoro is None:
        return jsonify({
            "ok": False,
            "message": f"Cabem {MAX_POMODOROS - 1} pomodoros além do principal.",
        }), 409
    return jsonify({"ok": True, "pomodoro": pomodoro})


@bp.delete("/api/pomodoro/<timer_id>")
def apagar(timer_id):
    """Remove um dos outros pomodoros. O principal não sai: zerar é parar."""
    if not id_de_pomodoro_valido(timer_id) or timer_id == POMODORO_PRINCIPAL:
        return jsonify({"ok": False, "message": ID_INVALIDO}), 400
    apagar_pomodoro(current_user()["id"], timer_id)
    return jsonify({"ok": True})


@bp.get("/pomodoro")
def index():
    return render_template(
        "pages/pomodoro.html",
        active_page="pomodoro",
        presets=PRESETS,
        min_minutes=MIN_MINUTES,
        max_minutes=MAX_MINUTES,
    )
