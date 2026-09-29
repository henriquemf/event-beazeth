"""Porta de entrada da API para clientes que não são navegador.

O que mora aqui é o que não pertence a nenhuma tela: entrar, criar conta e
descobrir quem está falando. O resto da API continua junto da tela que serve
(`/api/todo` em `todo.py`, `/api/notes` em `notes.py`), porque quem mexe numa
tela precisa ver as duas coisas lado a lado.

Toda resposta é JSON, inclusive as de erro — um app nativo não tem para onde
redirecionar e não sabe ler HTML.
"""

from flask import Blueprint, jsonify, request, session

from app.api_auth import TOKEN_MAX_AGE_SECONDS, issue_token
from app.auth import SESSION_EPOCH_KEY, SESSION_KEY, current_user
from app.ratelimit import (
    espera_para_criar_conta,
    espera_para_tentar,
    registrar_acerto,
    registrar_conta_criada,
    registrar_falha,
)
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


@bp.before_app_request
def recusar_corpo_que_nao_e_objeto():
    """Toda rota que lê JSON espera um objeto, e usa `.get` nele.

    Uma lista ou um número no corpo virava `AttributeError` dentro da rota --
    um 500, e um 500 por rota que alguém esquecesse de proteger. Recusar aqui,
    uma vez, cobre as que existem e as que ainda vão existir.
    """
    if request.method in ("POST", "PUT", "PATCH") and request.is_json:
        corpo = request.get_json(silent=True)
        if corpo is not None and not isinstance(corpo, dict):
            return jsonify({"ok": False, "message": "O corpo precisa ser um objeto JSON."}), 400
    return None


def _texto(payload: dict, chave: str) -> str:
    """O campo como texto. Número, lista ou nulo contam como vazio."""
    valor = payload.get(chave)
    return valor if isinstance(valor, str) else ""


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
    email = _texto(payload, "email")

    espera = espera_para_tentar(request, email)
    if espera:
        return jsonify({"ok": False, "message": MUITAS_TENTATIVAS}), 429, {
            "Retry-After": str(espera),
        }

    user = get_user_by_email(email)

    if not password_matches(user, _texto(payload, "password")):
        registrar_falha(request, email)
        # Mesma mensagem para e-mail inexistente e senha errada: dizer qual dos
        # dois falhou entrega quais e-mails têm conta aqui. O tempo de resposta
        # também é o mesmo -- ver `password_matches`.
        return jsonify({"ok": False, "message": CREDENCIAIS_INVALIDAS}), 401

    registrar_acerto(request, email)
    return jsonify({
        "ok": True,
        "token": issue_token(user["id"], user["auth_epoch"]),
        "expiresIn": TOKEN_MAX_AGE_SECONDS,
        "user": _conta(user),
    })


@bp.post("/api/auth/signup")
def signup():
    payload = request.get_json(silent=True) or {}
    nome = _texto(payload, "displayName").strip()
    email = normalize_email(_texto(payload, "email"))
    senha = _texto(payload, "password")

    # Criar conta também entra no freio: sem isso, o caminho caro (um scrypt
    # NOVO por chamada) fica aberto para quem quiser ocupar a CPU do plano
    # gratuito, e nada impede encher o banco de contas.
    espera = max(espera_para_tentar(request, email), espera_para_criar_conta(request))
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

    registrar_conta_criada(request)
    return jsonify({
        "ok": True,
        # Conta nova nasce na época zero -- o DEFAULT da coluna.
        "token": issue_token(user_id, 0),
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

    ## Trocar a senha derruba os OUTROS aparelhos

    É para isso que se troca a senha depois de perder um celular. A época da
    conta avança (ver `api_auth.py`) e todo token anterior deixa de valer --
    inclusive o que fez este pedido. Por isso a resposta traz um `token` novo:
    é ele que mantém ESTE aparelho entrando. Sem troca de senha não há `token`
    na resposta, e o cliente segue com o que tem.
    """
    payload = request.get_json(silent=True) or {}
    user = current_user()

    nome = payload.get("displayName")
    email_novo = payload.get("email")
    senha_nova = payload.get("newPassword")

    if nome is None and email_novo is None and senha_nova is None:
        return jsonify({"ok": False, "message": "Nada para mudar."}), 400
    if any(v is not None and not isinstance(v, str) for v in (nome, email_novo, senha_nova)):
        return jsonify({"ok": False, "message": "Campo em formato inválido."}), 400

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
                                _texto(payload, "currentPassword")):
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

    token_novo = None
    if senha_nova is not None:
        epoch = update_password(user["id"], senha_nova)
        token_novo = issue_token(user["id"], epoch)
        # Pedido que veio pelo cookie do site: a sessão também é da época
        # velha, e sem isto quem trocou a senha cairia no próximo clique.
        if session.get(SESSION_KEY) == user["id"]:
            session[SESSION_EPOCH_KEY] = epoch

    if nome is not None:
        update_display_name(user["id"], nome)

    resposta = {"ok": True, "user": _conta(get_user(user["id"]))}
    if token_novo is not None:
        resposta["token"] = token_novo
    return jsonify(resposta)
