"""A rádio lo-fi: a música que está tocando, e a lista de estações para o player.

O player em si é todo do navegador (`static/js/core/radio.js`): o áudio vem
direto da rádio, sem passar por aqui. Este módulo só responde o que o
navegador não consegue ler sozinho -- o nome da música -- e publica a lista de
estações para o template desenhar o cartão.
"""

from flask import Blueprint, jsonify

from app.services.radio import ESTACOES, tocando_agora


bp = Blueprint("radio", __name__)


@bp.app_context_processor
def publicar_estacoes():
    """As estações vão no HTML, e não num fetch: é dado fixo, e o cartão do
    player tem de nascer desenhado (seção 7 da constituição)."""
    return {"radio_estacoes": ESTACOES}


@bp.get("/api/radio/<estacao>/agora")
def agora(estacao: str):
    """O que está tocando na estação.

    Sem conta de propósito, e sem nem ler a sessão (`USERLESS_ENDPOINTS` em
    `auth.py`): a resposta é a mesma para todo mundo, e o player pergunta a
    cada 25 s enquanto toca -- carregar a conta a cada pergunta seria uma ida
    ao banco por nada. O custo para quem abusar é limitado pelo cache: uma
    leitura de stream por estação a cada 25 s, qualquer que seja o número de
    pedidos.
    """
    dados = tocando_agora(estacao)
    if dados is None:
        return jsonify({"ok": False, "message": "Estação desconhecida."}), 404
    resposta = jsonify({"ok": True, "estacao": estacao, **dados})
    # Duas abas abertas pedem juntas; a segunda pode levar a do navegador.
    resposta.headers["Cache-Control"] = "private, max-age=10"
    return resposta
