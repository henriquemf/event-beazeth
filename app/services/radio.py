"""A rádio lo-fi: as estações e a música que está tocando em cada uma.

## As estações

Quatro rádios públicas de operadoras estabelecidas -- laut.fm, I Love Music
e RauteMusik são plataformas alemãs de rádio licenciadas, e a Hotmix é uma
rede francesa de webrádios. Todas publicam o endereço do stream para player
de terceiros tocar. Nada aqui é regravado nem guardado: o navegador toca
direto do servidor delas, como tocaria no site delas -- e o cartão do player
leva o link para a página de cada uma.

Três critérios, conferidos um a um com o stream de verdade:

- **HTTPS**, senão o navegador bloqueia (conteúdo misto) e o app também;
- **o nome da música no próprio stream** (o metadado ICY): rádio que não diz
  o que toca não serve para um player que mostra a música no canto da tela;
- **aceitar tocar dentro de outro site.** O SomaFM, que chegou a entrar aqui,
  responde 403 a qualquer pedido com `Referer` de outro domínio -- é a regra
  deles contra embutir o stream em site alheio. Daria para esconder o
  `Referer` e passar; não se faz: a regra é deles.

A MESMA lista está em `data/Radio.kt`, no app Android — mexeu aqui, mexe lá.

## A música que está tocando

O navegador não enxerga o metadado ICY: ele vem entremeado no áudio, e o
`<audio>` o descarta. Quem lê é o servidor, que pede o stream com
`Icy-MetaData: 1`, pula o áudio até o primeiro bloco de texto e fecha a
conexão — de 16 a 45 KB por leitura.

A leitura fica em cache por [VALIDADE] segundos, por estação, e é ela que todas
as abas abertas recebem: com dez pessoas ouvindo, o servidor lê o stream uma
vez a cada 25 segundos, e não dez. Enquanto uma leitura está em curso, quem
chega leva a anterior em vez de esperar -- uma rádio lenta não segura as
threads do gunicorn.

A lista de endereços é FIXA e mora aqui: o cliente só escolhe a chave. Um
endereço vindo do pedido faria do servidor um cliente HTTP a serviço de
qualquer um (ver a seção 8b da constituição).
"""

import re
import threading
import time
import urllib.request


ESTACOES = (
    {
        "id": "lofi",
        "nome": "Lo-fi",
        "descricao": "lo-fi hip hop para estudar e relaxar",
        "stream": "https://stream.laut.fm/lofi",
        "site": "https://laut.fm/lofi",
        "fonte": "laut.fm",
    },
    {
        "id": "chillhop",
        "nome": "Chillhop",
        "descricao": "batidas chill, jazz e hip hop suave",
        "stream": "https://ilm.stream12.radiohost.de/ilm_ilovechillhop_mp3-192",
        "site": "https://www.ilovemusic.de/ilovechillhop/",
        "fonte": "I Love Music",
    },
    {
        "id": "hotmix",
        "nome": "Hotmix Lo-Fi",
        "descricao": "lo-fi tranquilo, sem pressa",
        "stream": "https://streaming.hotmixradio.com/hotmix-lofi-en-mp3",
        "site": "https://www.hotmixradio.fr/",
        "fonte": "Hotmix Radio",
    },
    {
        "id": "study",
        "nome": "Study",
        "descricao": "instrumental para foco e estudo",
        "stream": "https://study-high.rautemusik.fm/",
        "site": "https://www.rautemusik.fm/study/",
        "fonte": "RauteMusik",
    },
)

POR_ID = {estacao["id"]: estacao for estacao in ESTACOES}

# Uma música de lo-fi dura de dois a três minutos: 25 s de atraso no nome é o
# que ninguém percebe, e é o que mantém o custo de uma leitura por estação.
VALIDADE = 25

# O stream responde em 1 a 4 s. Mais que isso é rádio com problema, e o player
# segue tocando com o nome anterior.
TIMEOUT = 6

# Um bloco ICY tem no máximo 255 * 16 bytes, e o texto dentro dele vai para a
# tela: corta num tamanho que cabe num cartão.
MAX_TEXTO = 160

_TITULO = re.compile(r"StreamTitle='(.*?)';", re.S)

_cache: dict[str, tuple[float, dict]] = {}
_travas = {estacao["id"]: threading.Lock() for estacao in ESTACOES}


def _decodificar(bloco: bytes) -> str:
    """ICY não diz a codificação. UTF-8 primeiro; o que não for, é Latin-1 --
    o padrão antigo do Shoutcast, e o único que nunca falha ao decodificar."""
    try:
        return bloco.decode("utf-8")
    except UnicodeDecodeError:
        return bloco.decode("latin-1")


def _separar(bruto: str) -> dict:
    """"Artista - Música" vira os dois campos; sem o separador, é só o título.

    A Hotmix pendura códigos internos depois de `||` ("Artista - Música || S ||
    <uuid>"): o que vem depois da primeira barra dupla não é para gente ler.
    """
    texto = " ".join(bruto.split("||")[0].split())[:MAX_TEXTO]
    artista, _, musica = texto.partition(" - ")
    if not musica:
        return {"titulo": texto, "artista": ""}
    return {"titulo": musica.strip(), "artista": artista.strip()}


def ler_icy(url: str) -> str:
    """O `StreamTitle` do stream, ou texto vazio se a rádio não mandar um."""
    pedido = urllib.request.Request(
        url, headers={"Icy-MetaData": "1", "User-Agent": "EventBeazeth/1.0"}
    )
    with urllib.request.urlopen(pedido, timeout=TIMEOUT) as resposta:
        intervalo = int(resposta.headers.get("icy-metaint") or 0)
        if not intervalo:
            return ""
        restante = intervalo
        # `read(n)` numa conexão de streaming pode devolver menos que n.
        while restante:
            pedaco = resposta.read(min(restante, 16384))
            if not pedaco:
                return ""
            restante -= len(pedaco)
        tamanho = resposta.read(1)
        if not tamanho:
            return ""
        bloco = resposta.read(tamanho[0] * 16).rstrip(b"\0")
    achado = _TITULO.search(_decodificar(bloco))
    return achado.group(1) if achado else ""


def tocando_agora(estacao_id: str) -> dict | None:
    """A música da estação, do cache ou lida agora. `None` se a estação não existe."""
    estacao = POR_ID.get(estacao_id)
    if estacao is None:
        return None

    agora = time.monotonic()
    guardado = _cache.get(estacao_id)
    if guardado and agora - guardado[0] < VALIDADE:
        return guardado[1]

    trava = _travas[estacao_id]
    if not trava.acquire(blocking=False):
        # Outra thread já está lendo esta estação: leva o que houver.
        return guardado[1] if guardado else {"titulo": "", "artista": ""}
    try:
        try:
            dados = _separar(ler_icy(estacao["stream"]))
        except (OSError, ValueError):
            # Rádio fora do ar ou lenta: mantém o nome anterior por mais um
            # ciclo em vez de apagar o cartão.
            dados = guardado[1] if guardado else {"titulo": "", "artista": ""}
        _cache[estacao_id] = (time.monotonic(), dados)
        return dados
    finally:
        trava.release()
