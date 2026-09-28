/* O texto formatado dos post-its: a gramática, a forma canônica e o DOM.

   É a mesma gramática de `app/texto_rico.py` (e de `data/TextoRico.kt` no app
   Android), com os mesmos casos: seis marcas — <b> <i> <u> <s> <a href> <br> —,
   leitura tolerante (o que não é marca é texto, então um post-it antigo de
   texto cru é lido igual a antes) e escrita canônica (marcas na ordem
   a > b > i > u > s, vizinhos de mesmo estilo juntos, quebra como <br>). As três
   escrevendo a MESMA string é o que impede uma sincronização de achar mudança
   onde não houve.

   O editor NUNCA recebe HTML por innerHTML: o que se pinta são nós montados
   aqui, um a um, a partir dos trechos. Assim nada que chegue no campo —
   inclusive de um banco adulterado — vira marca que o navegador execute. */
window.EN = window.EN || {};
EN.notes = EN.notes || {};

(function (notes) {
    "use strict";

    /* Espelha `MAX_TEXTO` em app/texto_rico.py: caracteres de TEXTO, não de
       marcação. */
    const MAX_TEXTO = 2000;
    const ESTILOS = ["b", "i", "u", "s"];
    const SINONIMOS = { b: "b", strong: "b", i: "i", em: "i", u: "u", s: "s", strike: "s", del: "s" };
    const MARCA = /^<(\/?)(b|strong|i|em|u|s|strike|del)>/i;
    const QUEBRA = /^<br\s*\/?>/i;
    const ABRE_LINK = /^<a\s+href="([^"]*)"\s*>/i;
    const FECHA_LINK = /^<\/a>/i;
    const ENTIDADE = /^&(amp|lt|gt|quot|#39|nbsp);/;
    const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };
    const ESQUEMA_ACEITO = /^(https?:\/\/|mailto:)/i;

    function desescapar(texto) {
        return texto.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, function (_, nome) {
            return ENTIDADES[nome];
        });
    }

    /* O endereço limpo, ou null se o esquema não for http, https ou mailto. */
    function linkAceito(href) {
        const limpo = desescapar(href || "").trim();
        return ESQUEMA_ACEITO.test(limpo) ? limpo : null;
    }

    function mesmoEstilo(a, b) {
        return a.href === b.href && ESTILOS.every(function (e) {
            return !!a[e] === !!b[e];
        });
    }

    /* Tira os vazios e junta vizinhos de mesmo estilo. */
    function juntar(trechos) {
        const saida = [];
        trechos.forEach(function (t) {
            if (!t.texto) {
                return;
            }
            const ultimo = saida[saida.length - 1];
            if (ultimo && mesmoEstilo(ultimo, t)) {
                ultimo.texto += t.texto;
            } else {
                saida.push(Object.assign({}, t));
            }
        });
        return saida;
    }

    /* Lê o formato tolerante. Um trecho é { texto, b, i, u, s, href }. */
    function ler(bruto) {
        const fonte = String(bruto || "").replace(/\r\n?/g, "\n");
        const contagem = { b: 0, i: 0, u: 0, s: 0 };
        const links = [];
        const trechos = [];
        let atual = "";

        function estado() {
            const t = { texto: atual, href: null };
            ESTILOS.forEach(function (e) {
                t[e] = contagem[e] > 0;
            });
            for (let k = links.length - 1; k >= 0; k -= 1) {
                if (links[k]) {
                    t.href = links[k];
                    break;
                }
            }
            return t;
        }

        function fecharTexto() {
            if (atual) {
                trechos.push(estado());
                atual = "";
            }
        }

        let i = 0;
        while (i < fonte.length) {
            const resto = fonte.slice(i);
            let m;
            if (fonte[i] === "<") {
                if ((m = MARCA.exec(resto))) {
                    fecharTexto();
                    const estilo = SINONIMOS[m[2].toLowerCase()];
                    contagem[estilo] = m[1] ? Math.max(0, contagem[estilo] - 1) : contagem[estilo] + 1;
                    i += m[0].length;
                    continue;
                }
                if ((m = QUEBRA.exec(resto))) {
                    atual += "\n";
                    i += m[0].length;
                    continue;
                }
                if ((m = ABRE_LINK.exec(resto))) {
                    fecharTexto();
                    /* Link recusado entra como null: o </a> dele ainda precisa
                       fechar a marca certa, e não a do link de fora. */
                    links.push(linkAceito(m[1]));
                    i += m[0].length;
                    continue;
                }
                if ((m = FECHA_LINK.exec(resto))) {
                    fecharTexto();
                    links.pop();
                    i += m[0].length;
                    continue;
                }
            } else if (fonte[i] === "&" && (m = ENTIDADE.exec(resto))) {
                atual += ENTIDADES[m[1]];
                i += m[0].length;
                continue;
            }
            atual += fonte[i];
            i += 1;
        }
        fecharTexto();
        return juntar(trechos);
    }

    function escapar(texto) {
        return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function cortar(trechos, maximo) {
        const saida = [];
        let resta = maximo;
        trechos.forEach(function (t) {
            if (resta <= 0) {
                return;
            }
            saida.push(Object.assign({}, t, { texto: t.texto.slice(0, resta) }));
            resta -= t.texto.length;
        });
        return saida;
    }

    /* A forma canônica. */
    function escrever(trechos) {
        return cortar(juntar(trechos), MAX_TEXTO).map(function (t) {
            let abre = "";
            let fecha = "";
            if (t.href) {
                abre += '<a href="' + escapar(t.href).replace(/"/g, "&quot;") + '">';
                fecha = "</a>" + fecha;
            }
            ESTILOS.forEach(function (e) {
                if (t[e]) {
                    abre += "<" + e + ">";
                    fecha = "</" + e + ">" + fecha;
                }
            });
            return abre + escapar(t.texto).replace(/\n/g, "<br>") + fecha;
        }).join("");
    }

    /* ------------------------------------------------------------ o DOM */

    const TAG_DO_ESTILO = { b: "B", i: "I", u: "U", s: "S" };
    const ESTILO_DA_TAG = { B: "b", STRONG: "b", I: "i", EM: "i", U: "u", S: "s", STRIKE: "s", DEL: "s" };

    /* Pinta os trechos num elemento. Um trecho que termina em quebra de linha
       ganha um <br> a mais no fim: sem ele o `contenteditable` não mostra a
       linha vazia de baixo, e o cursor não tem onde ficar. */
    function pintar(el, trechos) {
        const doc = el.ownerDocument;
        const frag = doc.createDocumentFragment();
        trechos.forEach(function (t) {
            let alvo = frag;
            if (t.href) {
                const a = doc.createElement("a");
                a.href = t.href;
                a.rel = "noopener noreferrer";
                a.target = "_blank";
                alvo.appendChild(a);
                alvo = a;
            }
            ESTILOS.forEach(function (e) {
                if (t[e]) {
                    const marca = doc.createElement(TAG_DO_ESTILO[e]);
                    alvo.appendChild(marca);
                    alvo = marca;
                }
            });
            t.texto.split("\n").forEach(function (linha, k) {
                if (k > 0) {
                    alvo.appendChild(doc.createElement("br"));
                }
                if (linha) {
                    alvo.appendChild(doc.createTextNode(linha));
                }
            });
        });
        const texto = trechos.map(function (t) {
            return t.texto;
        }).join("");
        if (texto.endsWith("\n")) {
            frag.appendChild(doc.createElement("br"));
        }
        el.replaceChildren(frag);
    }

    /* Lê os trechos de um elemento editado. O `contenteditable` produz mais do
       que as seis marcas — <div> por linha, <span>, <font> —, e o que não é
       estilo conhecido vira só texto. Bloco (<div>, <p>) conta como quebra de
       linha, que é o que ele era na tela. */
    function doDom(el) {
        const trechos = [];

        function andar(no, estilo) {
            if (no.nodeType === 3) {
                trechos.push(Object.assign({}, estilo, { texto: no.nodeValue.replace(/ /g, " ") }));
                return;
            }
            if (no.nodeType !== 1) {
                return;
            }
            const tag = no.tagName;
            if (tag === "BR") {
                trechos.push(Object.assign({}, estilo, { texto: "\n" }));
                return;
            }
            const bloco = (tag === "DIV" || tag === "P") && no !== el;
            if (bloco && trechos.length && !trechos[trechos.length - 1].texto.endsWith("\n")) {
                trechos.push(Object.assign({}, estilo, { texto: "\n" }));
            }
            const proximo = Object.assign({}, estilo);
            if (ESTILO_DA_TAG[tag]) {
                proximo[ESTILO_DA_TAG[tag]] = true;
            }
            if (tag === "A") {
                proximo.href = linkAceito(no.getAttribute("href"));
            }
            no.childNodes.forEach(function (filho) {
                andar(filho, proximo);
            });
        }

        andar(el, { b: false, i: false, u: false, s: false, href: null });
        const lidos = juntar(trechos);
        /* O <br> a mais que `pintar` põe no fim não é texto da pessoa. */
        const ultimo = lidos[lidos.length - 1];
        if (ultimo && ultimo.texto.endsWith("\n") && el.lastChild && el.lastChild.nodeName === "BR") {
            ultimo.texto = ultimo.texto.slice(0, -1);
        }
        return juntar(lidos);
    }

    function tamanho(trechos) {
        return trechos.reduce(function (soma, t) {
            return soma + t.texto.length;
        }, 0);
    }

    notes.rich = {
        MAX_TEXTO: MAX_TEXTO,
        ler: ler,
        escrever: escrever,
        pintar: pintar,
        doDom: doDom,
        tamanho: tamanho,
        linkAceito: linkAceito,
    };
})(EN.notes);
