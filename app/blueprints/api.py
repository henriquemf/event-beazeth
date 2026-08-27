"""Porta de entrada da API para clientes que não são navegador.

O que mora aqui é o que não pertence a nenhuma tela: entrar, criar conta e
descobrir quem está falando. O resto da API continua junto da tela que serve
(`/api/todo` em `todo.py`, `/api/notes` em `notes.py`), porque quem mexe numa
tela precisa ver as duas coisas lado a lado.

Toda resposta é JSON, inclusive as de erro — um app nativo não tem para onde
redirecionar e não sabe ler HTML.
"""

from flask import Blueprint, jsonify, request

from app.api_auth import TOKEN_MAX_AGE_SECONDS, issue_token
from app.auth import current_user
from app.db.sync import coletar_mudancas
from app.db import (
    MIN_PASSWORD_LENGTH,
    create_user,
    get_user_by_email,
    normalize_email,
    password_matches,
)


bp = Blueprint("api", __name__)

CREDENCIAIS_INVALIDAS = "E-mail ou senha incorretos."


def _conta(user) -> dict:
    """O que o cliente pode saber sobre a própria conta.

    Montado à mão, campo a campo. Devolver a linha do banco inteira mandaria o
    `password_hash` junto no dia em que alguém acrescentasse uma coluna.
    """
    return {
        "id": user["id"],
        "email": user["email"],
        "displayName": user["display_name"],
    }


@bp.post("/api/auth/login")
def login():
    payload = request.get_json(silent=True) or {}
    user = get_user_by_email(payload.get("email", ""))

    if not password_matches(user, payload.get("password", "")):
        # Mesma mensagem para e-mail inexistente e senha errada: dizer qual dos
        # dois falhou entrega quais e-mails têm conta aqui.
        return jsonify({"ok": False, "message": CREDENCIAIS_INVALIDAS}), 401

    return jsonify({
        "ok": True,
        "token": issue_token(user["id"]),
        "expiresIn": TOKEN_MAX_AGE_SECONDS,
        "user": _conta(user),
    })


@bp.post("/api/auth/signup")
def signup():
    payload = request.get_json(silent=True) or {}
    nome = (payload.get("displayName") or "").strip()
    email = normalize_email(payload.get("email", ""))
    senha = payload.get("password", "")

    if not nome or not email:
        return jsonify({"ok": False, "message": "Informe nome e e-mail."}), 400
    if len(senha) < MIN_PASSWORD_LENGTH:
        return jsonify({
            "ok": False,
            "message": f"A senha precisa de pelo menos {MIN_PASSWORD_LENGTH} caracteres.",
        }), 400

    user_id = create_user(email, senha, nome)
    if user_id is None:
        return jsonify({"ok": False, "message": "Já existe uma conta com este e-mail."}), 409

    return jsonify({
        "ok": True,
        "token": issue_token(user_id),
        "expiresIn": TOKEN_MAX_AGE_SECONDS,
        "user": {"id": user_id, "email": email, "displayName": nome},
    }), 201


@bp.get("/api/sync")
def sync():
    """O que mudou desde a última vez — a espinha dorsal do app offline.

    Sem `since`, devolve tudo: é a primeira sincronização, num aparelho novo.
    Com `since`, devolve só a diferença, que na maioria das aberturas é vazia e
    custa uma requisição curta.

    O `now` da resposta é o que o aplicativo guarda para a próxima chamada. Ele
    tem de vir daqui e não do relógio do celular: o aparelho pode estar
    adiantado, e um `since` no futuro faria a sincronização pular alterações
    para sempre, sem erro nenhum aparecer.
    """
    return jsonify({"ok": True, **coletar_mudancas(current_user()["id"],
                                                   request.args.get("since"))})


@bp.get("/api/me")
def me():
    """Quem sou eu, segundo o token que acabei de mandar.

    O app chama isto na abertura para saber se o token guardado ainda vale: se
    responder 401, é hora de pedir a senha de novo. O guarda de sessão já faz
    essa checagem, então aqui basta responder.
    """
    return jsonify({"ok": True, "user": _conta(current_user())})
