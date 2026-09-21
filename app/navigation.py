"""Destinos do menu, num lugar só.

A barra lateral (desktop) e a barra inferior (celular) levam aos mesmos lugares.
Com duas listas, um destino novo entraria numa e faltaria na outra — e o que
falta é sempre o do celular, que é o menos testado. Aqui elas são a mesma.

`short` existe porque a barra inferior tem uns 60px por item, e com oito
destinos sobra menos ainda: "Beber água" não cabe, "Água" cabe. `bottom` marca
quem merece o polegar: Aparência é tela de ajuste, se usa uma vez por mês e
fica só na lateral.

`badge` é um selo que o JS preenche em cima do link, nas duas barras. Só o
pomodoro tem um, para dizer que existe sub-pomodoro contando fora da tela — o
nome aqui é só o gancho; quem escreve o número é
`static/js/core/pomodoro-widget.js`.
"""


NAV_LINKS = (
    {"key": "home", "endpoint": "home.index", "icon": "🗒️",
     "label": "Post-its", "short": "Post-its", "bottom": True},
    {"key": "calendar", "endpoint": "calendar.index", "icon": "📅",
     "label": "Calendário", "short": "Agenda", "bottom": True},
    {"key": "planner", "endpoint": "planner.index", "icon": "🗓️",
     "label": "Planner", "short": "Planner", "bottom": True},
    {"key": "todo", "endpoint": "todo.index", "icon": "✅",
     "label": "To-do", "short": "To-do", "bottom": True},
    {"key": "pomodoro", "endpoint": "pomodoro.index", "icon": "🍎",
     # "Foco" e não "Pomodoro": com sete destinos a barra inferior dá ~51px por
     # item, e o nome inteiro não cabe. É o nome da fase que o cronômetro conta
     # — a outra é o descanso.
     "label": "Pomodoro", "short": "Foco", "bottom": True,
     "badge": "pomo-subs"},
    {"key": "hydration", "endpoint": "hydration.index", "icon": "💧",
     "label": "Beber água", "short": "Água", "bottom": True},
    {"key": "diary", "endpoint": "diary.index", "icon": "📔",
     "label": "Diário", "short": "Diário", "bottom": True},
    {"key": "appearance", "endpoint": "appearance.index", "icon": "🎨",
     "label": "Aparência", "short": "Tema", "bottom": False},
)

BOTTOM_LINKS = tuple(link for link in NAV_LINKS if link["bottom"])


def register_navigation(app) -> None:
    @app.context_processor
    def inject_navigation():
        return {"nav_links": NAV_LINKS, "bottom_links": BOTTOM_LINKS}
