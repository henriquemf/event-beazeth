/* A barra de formatação que aparece sobre o texto selecionado, como no Notion.

   Uma barra por DOCUMENTO, e não por cartão: só existe uma seleção por vez, e
   dez barras escondidas seriam dez cópias do mesmo markup esperando. O
   documento pode ser a página ou a janela flutuante do pip.js — por isso
   `ligar(doc)`, e não um init que assume `document`.

   A formatação em si é `execCommand`. É uma API marcada como obsoleta, mas
   continua em todo navegador e é a única que mexe no desfazer (Ctrl+Z) e
   dispara o `input` como uma edição da pessoa. A alternativa — montar os nós à
   mão com Range — quebraria as duas coisas. */
window.EN = window.EN || {};
EN.notes = EN.notes || {};

(function (notes) {
    "use strict";

    const COMANDOS = ["bold", "italic", "underline", "strikeThrough"];
    const RESPIRO = 8;
    const EMAIL = /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/;
    const TEM_ESQUEMA = /^[a-z][a-z0-9+.-]*:/i;

    /* "exemplo.com" vira https://exemplo.com e "a@b.com" vira mailto: — é o
       que a pessoa quis dizer. O que sobra passa pela mesma regra do servidor. */
    function normalizarLink(valor) {
        const limpo = String(valor || "").trim();
        if (!limpo) {
            return "";
        }
        if (EMAIL.test(limpo)) {
            return "mailto:" + limpo;
        }
        return TEM_ESQUEMA.test(limpo) ? limpo : "https://" + limpo;
    }

    notes.toolbar = {
        ligar: function (doc) {
            const molde = document.getElementById("note-toolbar-template");
            if (!molde) {
                return;
            }
            const barra = doc.importNode(molde.content.firstElementChild, true);
            doc.body.appendChild(barra);

            const form = barra.querySelector(".note-link-form");
            const entrada = barra.querySelector(".note-link-input");
            const botoes = barra.querySelectorAll("[data-format]");
            const abrirLink = barra.querySelector('[data-link="abrir"]');
            const removerLink = barra.querySelector('[data-link="remover"]');
            const janela = doc.defaultView;
            /* No toque o sistema já mostra o menu dele (copiar, colar) ACIMA da
               seleção; a barra vai para baixo, para os dois não se taparem. */
            const toque = janela.matchMedia("(pointer: coarse)").matches;

            let guardada = null;
            let linkAtual = null;
            let quadro = 0;

            doc.execCommand("styleWithCSS", false, false);

            function selecaoNoCampo() {
                const selecao = doc.getSelection();
                if (!selecao || !selecao.rangeCount || selecao.isCollapsed) {
                    return null;
                }
                const no = selecao.anchorNode;
                const el = no && (no.nodeType === 1 ? no : no.parentElement);
                const campo = el && el.closest(".note-text");
                return campo && campo.contains(selecao.focusNode) ? selecao : null;
            }

            function linkDa(selecao) {
                const no = selecao.anchorNode;
                const el = no && (no.nodeType === 1 ? no : no.parentElement);
                return el ? el.closest(".note-text a[href]") : null;
            }

            function esconder() {
                barra.hidden = true;
                form.hidden = true;
                guardada = null;
            }

            function posicionar(faixa) {
                const caixas = faixa.getClientRects();
                const alvo = faixa.getBoundingClientRect().width ? faixa.getBoundingClientRect() : caixas[0];
                if (!alvo) {
                    return;
                }
                const largura = barra.offsetWidth;
                const altura = barra.offsetHeight;
                const acima = alvo.top - altura - RESPIRO;
                const y = toque || acima < RESPIRO ? alvo.bottom + RESPIRO : acima;
                const x = Math.min(
                    Math.max(alvo.left + alvo.width / 2 - largura / 2, RESPIRO),
                    janela.innerWidth - largura - RESPIRO
                );
                barra.style.setProperty("--tb-x", Math.round(x) + "px");
                barra.style.setProperty("--tb-y", Math.round(y) + "px");
            }

            function atualizar() {
                quadro = 0;
                /* Com o campo do link aberto a seleção do texto some (o foco
                   está no campo): a barra fica onde está até o link ser dado. */
                if (!form.hidden) {
                    return;
                }
                const selecao = selecaoNoCampo();
                if (!selecao) {
                    esconder();
                    return;
                }
                COMANDOS.forEach(function (comando, i) {
                    botoes[i].setAttribute("aria-pressed", String(doc.queryCommandState(comando)));
                });
                barra.querySelector('[data-format="link"]').setAttribute("aria-pressed", String(!!linkDa(selecao)));
                barra.hidden = false;
                posicionar(selecao.getRangeAt(0));
            }

            function agendar() {
                if (!quadro) {
                    quadro = janela.requestAnimationFrame(atualizar);
                }
            }

            function restaurar() {
                if (!guardada) {
                    return;
                }
                const selecao = doc.getSelection();
                selecao.removeAllRanges();
                selecao.addRange(guardada);
            }

            function abrirFormulario() {
                const selecao = selecaoNoCampo();
                if (!selecao) {
                    return;
                }
                guardada = selecao.getRangeAt(0).cloneRange();
                linkAtual = linkDa(selecao);
                entrada.value = linkAtual ? linkAtual.getAttribute("href") : "";
                entrada.classList.remove("is-invalid");
                abrirLink.hidden = !linkAtual;
                removerLink.hidden = !linkAtual;
                form.hidden = false;
                posicionar(guardada);
                entrada.focus();
                entrada.select();
            }

            function fecharFormulario() {
                form.hidden = true;
                restaurar();
                agendar();
            }

            /* Tocar num botão não pode tirar o foco do texto: com o foco, vai
               embora a seleção que o botão ia formatar. */
            barra.addEventListener("mousedown", function (evento) {
                if (!evento.target.closest(".note-link-input")) {
                    evento.preventDefault();
                }
            });

            barra.addEventListener("click", function (evento) {
                const botao = evento.target.closest("[data-format]");
                if (!botao) {
                    return;
                }
                if (botao.dataset.format === "link") {
                    abrirFormulario();
                    return;
                }
                doc.execCommand(botao.dataset.format);
                agendar();
            });

            form.addEventListener("submit", function (evento) {
                evento.preventDefault();
                const url = normalizarLink(entrada.value);
                if (url && !notes.rich.linkAceito(url)) {
                    entrada.classList.add("is-invalid");
                    return;
                }
                form.hidden = true;
                restaurar();
                doc.execCommand(url ? "createLink" : "unlink", false, url || null);
                agendar();
            });

            removerLink.addEventListener("click", function () {
                form.hidden = true;
                restaurar();
                doc.execCommand("unlink");
                agendar();
            });

            abrirLink.addEventListener("click", function () {
                const href = linkAtual && notes.rich.linkAceito(linkAtual.getAttribute("href"));
                if (href) {
                    janela.open(href, "_blank", "noopener");
                }
            });

            entrada.addEventListener("keydown", function (evento) {
                if (evento.key === "Escape") {
                    evento.preventDefault();
                    evento.stopPropagation();
                    fecharFormulario();
                }
            });

            entrada.addEventListener("input", function () {
                entrada.classList.remove("is-invalid");
            });

            /* Sair do campo do link para fora da barra desiste do link. */
            entrada.addEventListener("blur", function (evento) {
                if (!barra.contains(evento.relatedTarget)) {
                    form.hidden = true;
                    agendar();
                }
            });

            doc.addEventListener("selectionchange", agendar);
            janela.addEventListener("scroll", agendar, { capture: true, passive: true });
            janela.addEventListener("resize", agendar);

            doc.addEventListener("keydown", function (evento) {
                if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "k" && selecaoNoCampo()) {
                    evento.preventDefault();
                    abrirFormulario();
                } else if (evento.key === "Escape" && !barra.hidden) {
                    esconder();
                }
            });
        },
    };
})(EN.notes);
