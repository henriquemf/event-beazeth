"""Tela inicial: o quadro de post-its.

O CRUD dos post-its em si fica em `app/blueprints/notes.py` (API JSON); aqui só
mora a página.
"""

from flask import Blueprint, render_template


bp = Blueprint("home", __name__)


@bp.get("/")
def index():
    return render_template("pages/home.html", active_page="home")
