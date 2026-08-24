"""Tela de aparência: escolha de tema e fonte."""

from flask import Blueprint, render_template


bp = Blueprint("appearance", __name__)


@bp.get("/appearance")
def index():
    return render_template("pages/appearance.html", active_page="appearance")
