"""Rotas de infraestrutura: health check, service worker e favicon."""

from flask import Blueprint, current_app


bp = Blueprint("system", __name__)


@bp.get("/healthz")
def healthz():
    return {"ok": True}


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
