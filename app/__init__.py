"""Fábrica da aplicação.

Responsabilidades ficam separadas: as rotas vivem em `app/blueprints/`, o acesso
a dados em `app/db/`, a entrega de estáticos em `app/assets.py` e os jobs em
`app/services/`.
"""

from flask import Flask

from app.assets import register_asset_helpers, register_response_headers
from app.auth import register_auth_guard
from app.blueprints import register_blueprints
from app.config import Config, check_required
from app.db import init_db, init_pool
from app.extensions import scheduler
from app.navigation import register_navigation
from app.services.scheduler_service import run_scan


REMINDER_JOB_ID = "event-reminders"
REMINDER_INTERVAL_SECONDS = 60


def start_reminder_scheduler(app):
    """Agenda a varredura de lembretes.

    `max_instances=1` e `coalesce=True` evitam acúmulo de execuções se uma
    rodada demorar mais que o intervalo.
    """
    if scheduler.running:
        return

    scheduler.add_job(
        func=lambda: run_scan(app),
        trigger="interval",
        seconds=REMINDER_INTERVAL_SECONDS,
        id=REMINDER_JOB_ID,
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    # Antes de qualquer coisa: sem banco ou sem chave de sessão o app não tem
    # como funcionar direito, e falhar aqui é melhor do que descobrir na
    # primeira requisição — ou, pior, servir sessão assinada com chave pública.
    check_required(app.config)

    init_pool(app.config["DATABASE_URL"])
    init_db()

    register_asset_helpers(app)
    register_response_headers(app)
    register_auth_guard(app)
    register_navigation(app)
    register_blueprints(app)

    start_reminder_scheduler(app)

    return app
