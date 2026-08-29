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
from app.ratelimit import espera_para_tentar, registrar_acerto, registrar_falha
from app.db.sync import coletar_mudancas
from app.db import (
    MIN_PASSWORD_LENGTH,
    create_user,
    get_user,
    get_user_by_email,
    normalize_email,
    password_matches,
    update_display_name,
    update_email,
    update_password,
)


bp = Blueprint("api", __name__)

CREDENCIAIS_INVALIDAS = "E-mail ou senha incorretos."

# Não diz quanto falta no corpo: quem está tentando adivinhar aprenderia a
# cadência exata do freio. O `Retry-After` diz, porque esse cabeçalho existe
# para um cliente legítimo saber quando voltar.
MUITAS_TENTATIVAS = "Tentativas demais. Espere alguns minutos e tente de novo."


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
    email = payload.get("email", "")

    espera = espera_para_tentar(request, email)
    if espera:
        return jsonify({"ok": False, "message": MUITAS_TENTATIVAS}), 429, {
            "Retry-After": str(espera),
        }

    user = get_user_by_email(email)

    if not password_matches(user, payload.get("password", "")):
        registrar_falha(request, email)
        # Mesma mensagem para e-mail inexistente e senha errada: dizer qual dos
        # dois falhou entrega quais e-mails têm conta aqui. O tempo de resposta
        # também é o mesmo -- ver `password_matches`.
        return jsonify({"ok": False, "message": CREDENCIAIS_INVALIDAS}), 401

    registrar_acerto(request, email)
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

    # Criar conta também entra no freio: sem isso, o caminho caro (um scrypt
    # NOVO por chamada) fica aberto para quem quiser ocupar a CPU do plano
    # gratuito, e nada impede encher o banco de contas.
    espera = espera_para_tentar(request, email)
    if espera:
        return jsonify({"ok": False, "message": MUITAS_TENTATIVAS}), 429, {
            "Retry-After": str(espera),
        }

    if not nome or not email:
        return jsonify({"ok": False, "message": "Informe nome e e-mail."}), 400
    if len(senha) < MIN_PASSWORD_LENGTH:
        return jsonify({
            "ok": False,
            "message": f"A senha precisa de pelo menos {MIN_PASSWORD_LENGTH} caracteres.",
        }), 400

    user_id = create_user(email, senha, nome)
    if user_id is None:
        registrar_falha(request, email)
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


@bp.patch("/api/me")
def atualizar_conta():
    """Trocar nome de exibição, e-mail ou senha — a tela de perfil do app.

    ## Por que os três numa rota só

    São a mesma tabela e a mesma pergunta ("quem é você?"), e o app manda só o
    que mudou. Três rotas dariam três vezes a mesma conferência de senha atual,
    e a tela teria de sequenciar chamadas quando alguém mexesse em duas coisas
    -- com a chance de a segunda falhar depois de a primeira já ter gravado.

    ## Nome não pede senha; e-mail e senha pedem

    O token já prova quem está falando, então trocar o nome de exibição não pede
    nada além dele: é cosmético e reversível.

    E-mail e senha são as CREDENCIAIS. Quem pegasse um aparelho destravado por
    um minuto poderia, sem a senha atual, trocar as duas e ficar dono da conta.
    Pedir a senha de novo é o que impede isso, e é o mesmo motivo pelo qual todo
    site pede.

    A troca de senha **não derruba** os outros aparelhos: o token é assinado e
    carrega só o id da conta (ver `api_auth.py`). Está escrito em
    `update_password`, e é uma limitação conhecida, não um esquecimento.
    """
    payload = request.get_json(silent=True) or {}
    user = current_user()

    nome = payload.get("displayName")
    email_novo = payload.get("email")
    senha_nova = payload.get("newPassword")

    if nome is None and email_novo is None and senha_nova is None:
        return jsonify({"ok": False, "message": "Nada para mudar."}), 400

    # ------------------------------------------------ o que exige a senha atual
    if email_novo is not None or senha_nova is not None:
        # O mesmo freio do login, pela mesma razão: aqui também se acerta uma
        # senha por tentativa. Sem ele, esta rota seria o caminho mais barato
        # para adivinhar a senha de uma conta já aberta num aparelho roubado.
        espera = espera_para_tentar(request, user["email"])
        if espera:
            return jsonify({"ok": False, "message": MUITAS_TENTATIVAS}), 429, {
                "Retry-After": str(espera),
            }

        # A linha vem de novo do banco porque a do guarda não traz o
        # `password_hash` -- `get_user` o deixa de fora de propósito.
        if not password_matches(get_user_by_email(user["email"]),
                                payload.get("currentPassword", "")):
            registrar_falha(request, user["email"])
            return jsonify({"ok": False, "message": "Senha atual incorreta."}), 401

        registrar_acerto(request, user["email"])

    # ------------------------------------------------------------- validações
    #
    # Todas antes de qualquer gravação: com a senha nova curta e o e-mail bom, o
    # e-mail não pode entrar e a senha ficar para trás. Sem transação entre as
    # três tabelas, a ordem é a única garantia de "ou tudo, ou nada".
    if nome is not None and not nome.strip():
        return jsonify({"ok": False, "message": "O nome não pode ficar vazio."}), 400

    if email_novo is not None and "@" not in normalize_email(email_novo):
        return jsonify({"ok": False, "message": "E-mail inválido."}), 400

    if senha_nova is not None and len(senha_nova) < MIN_PASSWORD_LENGTH:
        return jsonify({
            "ok": False,
            "message": f"A senha precisa de pelo menos {MIN_PASSWORD_LENGTH} caracteres.",
        }), 400

    # ------------------------------------------------------------- gravações
    #
    # O e-mail vem primeiro entre as duas credenciais porque é o único que pode
    # falhar por culpa de outra conta (já existe). Falhando depois da senha, a
    # pessoa ficaria com a senha nova e o e-mail antigo -- e teria de adivinhar
    # qual das duas valeu.
    if email_novo is not None and not update_email(user["id"], email_novo):
        return jsonify({"ok": False, "message": "Já existe uma conta com este e-mail."}), 409

    if senha_nova is not None:
        update_password(user["id"], senha_nova)

    if nome is not None:
        update_display_name(user["id"], nome)

    return jsonify({"ok": True, "user": _conta(get_user(user["id"]))})
