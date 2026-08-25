"""Recurso tag de evento: criar e remover.

Sem tela própria de propósito — as tags só fazem sentido ao lado dos eventos,
então a interface é um popup do calendário e estas rotas só recebem POST.
"""

from flask import Blueprint, flash, redirect, request, url_for

from app.auth import current_user

from app.db import (
    FALLBACK_TAG,
    MAX_LABEL_LENGTH,
    REMINDER_RULES,
    delete_tag,
    insert_tag,
    normalize_color,
    slugify,
)


bp = Blueprint("tags", __name__)


@bp.post("/tags")
def create_tag():
    label = request.form.get("label", "").strip()[:MAX_LABEL_LENGTH]
    color = normalize_color(request.form.get("color", ""))
    rule = request.form.get("reminder_rule", "dia").strip().lower()

    slug = slugify(label)
    if not slug:
        flash("Dê um nome com pelo menos uma letra ou número para a tag.", "error")
        return redirect(url_for("calendar.index"))

    if not color:
        flash("Escolha uma cor válida para a tag.", "error")
        return redirect(url_for("calendar.index"))

    if rule not in REMINDER_RULES:
        flash("Escolha quando a tag deve lembrar você.", "error")
        return redirect(url_for("calendar.index"))

    if insert_tag(current_user()["id"], slug, label, color, rule):
        flash(f"Tag “{label}” criada.", "success")
    else:
        flash(f"Já existe uma tag chamada “{label}”.", "error")
    return redirect(url_for("calendar.index"))


@bp.post("/tags/<slug>/delete")
def remove_tag(slug: str):
    if slug == FALLBACK_TAG:
        # Ela é o destino de quem perde a tag; sem ela a remoção não teria para
        # onde mandar os eventos.
        flash("A tag padrão não pode ser removida.", "error")
        return redirect(url_for("calendar.index"))

    moved = delete_tag(current_user()["id"], slug)
    if moved:
        plural = "s" if moved > 1 else ""
        flash(f"Tag removida. {moved} evento{plural} voltou para a tag padrão.", "success")
    else:
        flash("Tag removida.", "success")
    return redirect(url_for("calendar.index"))
