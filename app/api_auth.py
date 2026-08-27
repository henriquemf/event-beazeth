"""Autenticação para clientes que não são navegador — hoje, o app Android.

O site entra por formulário e anda com cookie de sessão, que o navegador manda
sozinho a cada requisição. Um app nativo não tem nada disso: não segue
redirecionamento de formulário, não guarda cookie por domínio, e espera JSON em
toda resposta — inclusive nas de erro. Então ele recebe um token no login e o
apresenta em `Authorization: Bearer <token>`.

O token é **assinado, não guardado**. Vai dentro dele o id da conta e o instante
de emissão, tudo assinado com a mesma SECRET_KEY do cookie de sessão. Não há
tabela de tokens, não há consulta ao banco para validar um: o servidor confere a
assinatura e pronto.

O preço dessa escolha é não conseguir revogar UM token antes de ele expirar. O
botão de emergência é trocar a SECRET_KEY, que invalida todos os tokens e todas
as sessões de uma vez. Para um app de duas pessoas isso é o suficiente; se um
dia precisar revogar por aparelho, aí sim entra uma tabela.
"""

from flask import current_app, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer


# Noventa dias, o mesmo espírito do cookie de sessão: ninguém quer relogar no
# celular toda semana. Como o token não é revogável, é o teto de estrago caso
# um aparelho seja perdido — e é por isso que não são 365.
TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 90

# O sal separa este token de qualquer outra coisa assinada com a mesma chave.
# O sufixo de versão permite invalidar todos os tokens antigos no dia em que o
# formato mudar: basta incrementar.
TOKEN_SALT = "event-beazeth-api-token-v1"

BEARER_PREFIX = "Bearer "


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=TOKEN_SALT)


def issue_token(user_id: int) -> str:
    """Token de acesso para a conta. Devolve texto pronto para o cabeçalho."""
    return _serializer().dumps({"uid": int(user_id)})


def user_id_from_token(token: str) -> int | None:
    """Id da conta, ou `None` se o token for inválido, adulterado ou vencido.

    Devolve `None` em vez de levantar: quem chama é o guarda de requisição, e
    todo caminho de falha ali termina na mesma resposta 401.
    """
    if not token:
        return None

    try:
        dados = _serializer().loads(token, max_age=TOKEN_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        return None

    uid = dados.get("uid") if isinstance(dados, dict) else None
    return uid if isinstance(uid, int) else None


def bearer_token_from_request() -> str | None:
    """Lê o token do cabeçalho `Authorization`, se houver um no formato certo."""
    cabecalho = request.headers.get("Authorization", "")
    if not cabecalho.startswith(BEARER_PREFIX):
        return None

    token = cabecalho[len(BEARER_PREFIX):].strip()
    return token or None
