"""Sessão do usuário: quem está logado e o que exige login.

Separado de `blueprints/auth.py` de propósito — lá moram as telas de entrar e
criar conta, aqui mora o que TODA rota precisa. A fábrica registra o guarda uma
vez só, então rota nova nasce protegida: esquecer o decorador é o jeito clássico
de vazar dado, e aqui não existe decorador para esquecer.
"""

from flask import g, jsonify, redirect, request, session, url_for

from app.api_auth import bearer_token_from_request, user_id_from_token
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
    # As mesmas duas portas, na versão JSON que o app nativo usa. Precisam ser
    # públicas pelo mesmo motivo: são elas que entregam a credencial.
    "api.login",
    "api.signup",
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

        # Caminho que nao casou com rota nenhuma chega aqui com `endpoint`
        # None. Sem esta saida ele cai no 401 la embaixo e recebe "sessao
        # expirada" -- uma mentira cara: manda a pessoa refazer o login por um
        # erro que login nenhum resolve, e foi exatamente assim que uma rota
        # ausente em producao passou por token vencido. Deixa o 404 ser 404.
        # De quebra, um caminho inexistente para de custar uma ida ao banco.
        if request.endpoint is None:
            return None

        # Duas credenciais para a mesma conta: o cookie de sessão, que o
        # navegador manda sozinho, e o token do cabeçalho, que é como o app
        # Android se identifica. O token vem primeiro porque um cliente que se
        # deu ao trabalho de mandá-lo está dizendo qual conta quer — mesmo que
        # por acaso exista um cookie de outra pendurado na mesma requisição.
        token_user_id = user_id_from_token(bearer_token_from_request())

        if token_user_id is not None:
            g.user = get_user(token_user_id)
        else:
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
