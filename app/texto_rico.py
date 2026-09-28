"""O texto formatado dos post-its: a gramatica, e a forma canonica de escreve-la.

O conteudo de um post-it e um HTML MINIMO -- seis marcas e nada mais:

    <b> <i> <u> <s> <a href="..."> <br>

## Por que HTML, e nao Markdown

O editor do site e um `contenteditable`, que ja fala HTML; no app cada marca
vira um estilo de trecho. Markdown obrigaria os dois a traduzir nos dois
sentidos, e pior: um `*` digitado a toa viraria italico, e os post-its que ja
existem sao cheios de texto livre.

## A leitura e TOLERANTE, e e isso que dispensa migracao

So as seis marcas (e as entidades `&amp; &lt; &gt; &quot; &#39; &nbsp;`) sao
reconhecidas. Todo o resto e texto: "pao & leite < 10 reais" continua sendo
exatamente isso, e um post-it antigo, que nunca teve marca nenhuma, e lido
igual a antes sem ninguem converte-lo. Quebra de linha crua tambem vale como
`<br>` -- e assim que os antigos guardam as deles.

## A escrita e CANONICA, e e isso que impede o vai-e-vem

O mesmo texto formatado sai sempre como a mesma string, aqui, no site
(`js/pages/notes/rich.js`) e no app (`data/TextoRico.kt`): cada trecho leva as
marcas na ordem fixa a > b > i > u > s, trechos vizinhos com o mesmo estilo
se juntam, e quebra de linha e `<br>`. Se os tres escrevessem cada um do seu
jeito, toda sincronizacao acharia uma "mudanca" que ninguem fez.

## O link so aceita http, https e mailto

`javascript:` num href e a porta classica para rodar codigo no clique. A
marca `<a>` com qualquer outro esquema e descartada -- o TEXTO dela fica.
"""

import re


# Espelha `MAX_TEXTO` em `js/pages/notes/rich.js` e `MAXIMO_DO_TEXTO` em
# `data/TextoRico.kt`. Conta caracteres de TEXTO, e nao de marcacao: o limite
# que a pessoa sente e o que ela escreve, nao o tamanho do HTML por baixo.
MAX_TEXTO = 2000

_ESTILOS = ("b", "i", "u", "s")
_SINONIMOS = {"b": "b", "strong": "b", "i": "i", "em": "i", "u": "u",
              "s": "s", "strike": "s", "del": "s"}

_MARCA = re.compile(r"<(/?)(b|strong|i|em|u|s|strike|del)>", re.IGNORECASE)
_QUEBRA = re.compile(r"<br\s*/?>", re.IGNORECASE)
_ABRE_LINK = re.compile(r'<a\s+href="([^"]*)"\s*>', re.IGNORECASE)
_FECHA_LINK = re.compile(r"</a>", re.IGNORECASE)
_ENTIDADE = re.compile(r"&(amp|lt|gt|quot|#39|nbsp);")
_ENTIDADES = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "#39": "'", "nbsp": " "}
_ESQUEMA_ACEITO = re.compile(r"^(https?://|mailto:)", re.IGNORECASE)


def _desescapar(texto: str) -> str:
    return _ENTIDADE.sub(lambda m: _ENTIDADES[m.group(1)], texto)


def link_aceito(href: str):
    """O endereco limpo, ou None se o esquema nao for um dos tres aceitos."""
    href = _desescapar(href or "").strip()
    return href if _ESQUEMA_ACEITO.match(href) else None


def ler(bruto: str) -> list:
    """Le o formato tolerante e devolve os trechos: [(texto, estilos, href)].

    `estilos` e um frozenset de "b", "i", "u", "s"; `href` e o link ou None.
    Marca fechada sem ter sido aberta e ignorada, marca aberta sem fechar vale
    ate o fim -- o que um `contenteditable` produz e sempre bem formado, e o
    que chega de outro lugar nao pode derrubar a leitura.
    """
    bruto = (bruto or "").replace("\r\n", "\n").replace("\r", "\n")
    contagem = {estilo: 0 for estilo in _ESTILOS}
    links = []
    trechos = []
    atual = []

    def estado():
        estilos = frozenset(e for e in _ESTILOS if contagem[e] > 0)
        href = next((h for h in reversed(links) if h), None)
        return estilos, href

    def fechar_texto():
        if atual:
            texto = "".join(atual)
            atual.clear()
            estilos, href = estado()
            trechos.append((texto, estilos, href))

    i = 0
    while i < len(bruto):
        c = bruto[i]
        if c == "<":
            m = _MARCA.match(bruto, i)
            if m:
                fechar_texto()
                estilo = _SINONIMOS[m.group(2).lower()]
                if m.group(1):
                    contagem[estilo] = max(0, contagem[estilo] - 1)
                else:
                    contagem[estilo] += 1
                i = m.end()
                continue
            m = _QUEBRA.match(bruto, i)
            if m:
                atual.append("\n")
                i = m.end()
                continue
            m = _ABRE_LINK.match(bruto, i)
            if m:
                fechar_texto()
                # Link recusado entra como None: o `</a>` dele ainda precisa
                # fechar a marca certa, e nao a do link de fora.
                links.append(link_aceito(m.group(1)))
                i = m.end()
                continue
            m = _FECHA_LINK.match(bruto, i)
            if m:
                fechar_texto()
                if links:
                    links.pop()
                i = m.end()
                continue
        elif c == "&":
            m = _ENTIDADE.match(bruto, i)
            if m:
                atual.append(_ENTIDADES[m.group(1)])
                i = m.end()
                continue
        atual.append(c)
        i += 1
    fechar_texto()
    return _juntar(trechos)


def _juntar(trechos: list) -> list:
    """Tira os vazios e junta vizinhos de mesmo estilo -- parte da forma canonica."""
    saida = []
    for texto, estilos, href in trechos:
        if not texto:
            continue
        if saida and saida[-1][1] == estilos and saida[-1][2] == href:
            saida[-1] = (saida[-1][0] + texto, estilos, href)
        else:
            saida.append((texto, estilos, href))
    return saida


def _cortar(trechos: list, maximo: int) -> list:
    saida = []
    resta = maximo
    for texto, estilos, href in trechos:
        if resta <= 0:
            break
        saida.append((texto[:resta], estilos, href))
        resta -= len(texto)
    return saida


def _escapar(texto: str) -> str:
    return texto.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def escrever(trechos: list) -> str:
    """A forma canonica: cada trecho com as marcas na ordem a > b > i > u > s."""
    partes = []
    for texto, estilos, href in trechos:
        abre = ""
        fecha = ""
        if href:
            abre += '<a href="' + _escapar(href).replace('"', "&quot;") + '">'
            fecha = "</a>" + fecha
        for estilo in _ESTILOS:
            if estilo in estilos:
                abre += "<" + estilo + ">"
                fecha = "</" + estilo + ">" + fecha
        partes.append(abre + _escapar(texto).replace("\n", "<br>") + fecha)
    return "".join(partes)


def limpar(bruto: str) -> str:
    """O que se grava: lido, cortado no limite de texto e reescrito canonico."""
    return escrever(_cortar(ler(bruto), MAX_TEXTO))
