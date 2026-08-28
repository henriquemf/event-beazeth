"""Telas de entrar e criar conta."""

from urllib.parse import urlparse

from flask import (
    Blueprint,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)

from app.auth import log_in, log_out
from app.ratelimit import espera_para_tentar, registrar_acerto, registrar_falha
from app.db import (
    MIN_PASSWORD_LENGTH,
    create_user,
    get_user_by_email,
    normalize_email,
    password_matches,
)


bp = Blueprint("auth", __name__)

# Mensagem única para e-mail inexistente e senha errada: dizer qual dos dois
# falhou entrega a quem tenta adivinhar a lista de quem tem conta aqui.
BAD_CREDENTIALS = "E-mail ou senha incorretos."

MUITAS_TENTATIVAS = "Tentativas demais. Espere alguns minutos e tente de novo."


def safe_next(target: str) -> str:
    """Só aceita destino do próprio site.

    Sem isto, `/entrar?proxima=https://site-falso` mandaria a pessoa para fora
    logo depois de digitar a senha, com a aparência de que o app a levou lá.
    """
    if not target:
        return url_for("calendar.index")
    parsed = urlparse(target)
    if parsed.scheme or parsed.netloc or not target.startswith("/"):
        return url_for("calendar.index")
    return target


@bp.route("/entrar", methods=["GET", "POST"])
def login():
    proxima = request.args.get("proxima", "")

    if request.method == "POST":
        email = request.form.get("email", "")
        password = request.form.get("password", "")

        # O mesmo freio da API. São duas portas para a mesma senha, e proteger
        # só uma não protege nada: quem estivesse barrado aqui tentaria em
        # `/api/auth/login`, e vice-versa. Por isso o contador é um só, no
        # módulo, e não um por blueprint.
        espera = espera_para_tentar(request, email)
        if espera:
            flash(MUITAS_TENTATIVAS, "error")
            return redirect(url_for("auth.login", proxima=proxima or None))

        user = get_user_by_email(email)
        if not password_matches(user, password):
            registrar_falha(request, email)
            flash(BAD_CREDENTIALS, "error")
            return redirect(url_for("auth.login", proxima=proxima or None))

        registrar_acerto(request, email)
        log_in(user["id"])
        return redirect(safe_next(request.form.get("proxima", "")))

    return render_template("pages/login.html", proxima=proxima)


@bp.route("/criar-conta", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        name = request.form.get("display_name", "").strip()
        email = normalize_email(request.form.get("email", ""))
        password = request.form.get("password", "")
        confirmation = request.form.get("password_confirm", "")

        if espera_para_tentar(request, email):
            flash(MUITAS_TENTATIVAS, "error")
            return redirect(url_for("auth.signup"))

        if not name:
            flash("Como podemos te chamar?", "error")
            return redirect(url_for("auth.signup"))

        if "@" not in email or "." not in email.split("@")[-1]:
            flash("Informe um e-mail válido.", "error")
            return redirect(url_for("auth.signup"))

        if len(password) < MIN_PASSWORD_LENGTH:
            flash(f"A senha precisa de pelo menos {MIN_PASSWORD_LENGTH} caracteres.", "error")
            return redirect(url_for("auth.signup"))

        if password != confirmation:
            flash("As duas senhas não são iguais.", "error")
            return redirect(url_for("auth.signup"))

        user_id = create_user(email, password, name)
        if user_id is None:
            registrar_falha(request, email)
            flash("Já existe uma conta com esse e-mail. Tente entrar.", "error")
            return redirect(url_for("auth.login"))

        log_in(user_id)
        flash(f"Bem-vinda, {name}! Seu espaço está pronto.", "success")
        return redirect(url_for("calendar.index"))

    return render_template("pages/signup.html", min_password=MIN_PASSWORD_LENGTH)


@bp.post("/sair")
def logout():
    log_out()
    flash("Você saiu da sua conta.", "success")
    return redirect(url_for("auth.login"))
