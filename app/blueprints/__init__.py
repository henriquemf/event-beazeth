"""Rotas da aplicação, um módulo por tela/recurso.

`register_blueprints` é o único ponto que a fábrica precisa conhecer.
"""

from app.blueprints import (
    appearance,
    calendar,
    events,
    home,
    hydration,
    notes,
    planner,
    push,
    system,
)


# A ordem não afeta o roteamento (os caminhos não se sobrepõem); segue a ordem
# do menu lateral para facilitar a leitura.
BLUEPRINTS = (
    system.bp,
    home.bp,
    events.bp,
    calendar.bp,
    planner.bp,
    notes.bp,
    appearance.bp,
    hydration.bp,
    push.bp,
)


def register_blueprints(app):
    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint)
