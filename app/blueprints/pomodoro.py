"""Tela do pomodoro.

Só a página: o temporizador é inteiramente do cliente. Ele precisa continuar
correndo entre navegações e mesmo offline, então o estado mora no localStorage —
o servidor não tem o que guardar nem o que validar aqui.

O que fica no Python é a lista de tempos prontos, para que os botões cheguem
renderizados no HTML em vez de serem montados por JS depois da pintura.
"""

from flask import Blueprint, render_template


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


@bp.get("/pomodoro")
def index():
    return render_template(
        "pages/pomodoro.html",
        active_page="pomodoro",
        presets=PRESETS,
        min_minutes=MIN_MINUTES,
        max_minutes=MAX_MINUTES,
    )
