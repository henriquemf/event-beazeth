"""Sessão do usuário: quem está logado e o que exige login.

Separado de `blueprints/auth.py` de propósito — lá moram as telas de entrar e
criar conta, aqui mora o que TODA rota precisa. A fábrica registra o guarda uma
vez só, então rota nova nasce protegida: esquecer o decorador é o jeito clássico
de vazar dado, e aqui não existe decorador para esquecer.
"""

from flask import g, jsonify, redirect, request, session, url_for

from app.db import get_user


SESSION_KEY = "user_id"

# Respostas que não mudam conforme quem pede: nem chegam a carregar a conta.
# A separação aqui é de CUSTO, não de permissão — ver o guarda abaixo.
USERLESS_ENDPOINTS = frozenset({
    "static",
    "system.healthz",
    "system.service_worker",
    "system.favicon",
    # Quem busca este é o Android, na instalação do .apk, sem cookie nenhum.
    "system.assetlinks",
})

# O que responde sem sessão. Tudo o mais exige login.
PUBLIC_ENDPOINTS = USERLESS_ENDPOINTS | frozenset({
    "auth.login",
    "auth.signup",
})


def log_in(user_id: int) -> None:
    # `permanent` faz o cookie durar o PERMANENT_SESSION_LIFETIME da config em
    # vez de morrer quando o navegador fecha.
    session.clear()
    session[SESSION_KEY] = user_id
    session.permanent = True


def log_out() -> None:
    session.clear()


def current_user():
    """Usuário da requisição, já carregado pelo guarda."""
    return g.get("user")


def register_auth_guard(app) -> None:
    @app.before_request
    def load_user():
        g.user = None

        # Sai antes de tocar no banco. Um CSS não muda conforme quem o pede,
        # mas o guarda roda em TODA requisição — e são doze estáticos por
        # página. Com o banco gerenciado fora do datacenter do app, carregar a
        # conta aqui custava duas idas de rede por arquivo: mais tempo gasto
        # servindo estático do que montando a própria tela.
        if request.endpoint in USERLESS_ENDPOINTS:
            return None

        user_id = session.get(SESSION_KEY)
        if user_id is not None:
            g.user = get_user(user_id)
            if g.user is None:
                # Conta apagada com a sessão ainda válida no navegador.
                session.clear()

        if g.user is not None or request.endpoint in PUBLIC_ENDPOINTS:
            return None

        # O fetch de uma tela aberta há muito tempo não pode receber o HTML do
        # login: o cliente espera JSON e mostraria "erro de sintaxe" no lugar
        # de "sua sessão expirou".
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "message": "Sessão expirada. Entre de novo."}), 401

        return redirect(url_for("auth.login", proxima=request.full_path if request.method == "GET" else None))

    @app.context_processor
    def inject_user():
        """A barra lateral mostra quem está logado em todas as telas."""
        return {"current_user": g.get("user")}
