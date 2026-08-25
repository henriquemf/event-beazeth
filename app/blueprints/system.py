"""Rotas de infraestrutura: health check, service worker e favicon."""

from flask import Blueprint, current_app, jsonify

from app.db import get_connection
from app.services.scheduler_service import scheduler_status


bp = Blueprint("system", __name__)


@bp.get("/healthz")
def healthz():
    """Saúde do serviço, e o healthCheckPath do Render.

    Toca o banco de propósito: um app que não alcança o Postgres não está
    saudável, e um health check que só responde "de pé" esconderia exatamente
    a falha que mais importa aqui — o banco é externo.

    `lastScanSeconds` diz se o agendador de lembretes está girando. Como ele
    vive dentro deste processo, e o serviço gratuito do Render dorme,
    encontrar `null` ou um número grande é o sintoma esperado de um serviço
    que acabou de acordar.
    """
    payload = {"ok": True, "database": "ok", **scheduler_status()}

    try:
        with get_connection() as conn:
            conn.execute("SELECT 1")
    except Exception:
        current_app.logger.exception("Health check não alcançou o banco.")
        payload["ok"] = False
        payload["database"] = "unreachable"
        return jsonify(payload), 503

    return jsonify(payload)


@bp.get("/sw.js")
def service_worker():
    # Servido da raiz para o escopo do service worker cobrir o site inteiro,
    # e sem cache para uma atualização entrar já no próximo carregamento.
    response = current_app.send_static_file("sw.js")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@bp.get("/favicon.ico")
def favicon():
    return current_app.send_static_file("icon.svg")
