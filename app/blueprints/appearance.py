"""Tela de aparência: tema, fonte e os sons do site."""

from flask import Blueprint, render_template


bp = Blueprint("appearance", __name__)


# As opções de som, com nome e descrição. Espelham `Som` e `SomDaFesta` em
# `avisos/Som.kt` no app Android: o mesmo toque tem o mesmo nome nos dois.
#
# O padrão de cada momento NÃO mora aqui: mora em `core/audio.js`, que é quem
# toca e quem resolve "nada escolhido ainda". Esta lista só diz o que existe.
TOQUES = (
    {"chave": "marimba", "nome": "Marimba", "descricao": "Três notas de madeira subindo. Alegre e macio."},
    {"chave": "vibrafone", "nome": "Vibrafone", "descricao": "Duas notas longas, calmas, que se apagam devagar."},
    {"chave": "sininho", "nome": "Sininho", "descricao": "Duas notas claras de glockenspiel."},
    {"chave": "gotinha", "nome": "Gotinha", "descricao": "Duas gotas, plic-ploc. O mais curto de todos."},
    {"chave": "mudo", "nome": "Sem som", "descricao": "Só o aviso na tela."},
)

FESTA = (
    {"chave": "festa_marimba", "nome": "Marimba em festa", "descricao": "Quatro notas subindo, um \"ta-dá\"."},
    {"chave": "aplausos", "nome": "Palmas", "descricao": "Uma salva de palmas de verdade."},
    {"chave": "mudo", "nome": "Sem som", "descricao": "Só o confete, em silêncio."},
)

CLIQUES = (
    {"chave": "ligados", "nome": "Ligados", "descricao": "Um toque baixinho a cada botão e troca de tela."},
    {"chave": "mudo", "nome": "Sem som", "descricao": "Botões em silêncio."},
)

MOMENTOS = (
    {"chave": "agua", "titulo": "Beber água", "descricao": "Quando o lembrete chega com o site aberto.", "opcoes": TOQUES},
    {"chave": "agenda", "titulo": "Agenda", "descricao": "Quando o lembrete de um evento chega com o site aberto.", "opcoes": TOQUES},
    {"chave": "foco", "titulo": "Fim do foco", "descricao": "A festa, junto do confete.", "opcoes": FESTA},
    {"chave": "descanso", "titulo": "Fim do descanso", "descricao": "Quando o descanso acaba.", "opcoes": TOQUES},
    {"chave": "cliques", "titulo": "Cliques", "descricao": "Botões e troca de tela.", "opcoes": CLIQUES},
)


@bp.get("/appearance")
def index():
    return render_template("pages/appearance.html", active_page="appearance", momentos=MOMENTOS)
