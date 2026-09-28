/* O campo de texto do post-it: ler, limitar e colar.

   Separado de interactions.js porque é outro assunto — lá é o cartão como
   objeto na mesa (arrastar, cor, apagar), aqui é o texto dentro dele. E porque
   a mesma lógica precisa valer em DOIS lugares: no quadro e na janela
   flutuante (pip.js), que é outro documento. Por isso tudo aqui se liga a uma
   `raiz`, e não ao quadro. */
window.EN = window.EN || {};
EN.notes = EN.notes || {};

(function (notes) {
    "use strict";

    const rich = notes.rich;

    function campoDe(evento) {
        return evento.target.closest ? evento.target.closest(".note-text") : null;
    }

    /* Quanto o campo ainda aceita, descontando o que a seleção vai substituir. */
    function sobra(campo) {
        const doc = campo.ownerDocument;
        const selecao = doc.getSelection();
        const selecionado = selecao && campo.contains(selecao.anchorNode) ? selecao.toString().length : 0;
        return rich.MAX_TEXTO - rich.tamanho(rich.doDom(campo)) + selecionado;
    }

    function inserirTexto(campo, texto) {
        const cabe = texto.slice(0, Math.max(0, sobra(campo)));
        if (cabe) {
            /* `execCommand` e não montar o nó à mão: só ele entra no desfazer
               do navegador (Ctrl+Z) e dispara o `input` como uma digitação. */
            campo.ownerDocument.execCommand("insertText", false, cabe);
        }
    }

    notes.editor = {
        ligar: function (ctx, raiz) {
            /* Cada mudança vira HTML canônico e entra na fila de gravação. */
            raiz.addEventListener("input", function (evento) {
                const campo = campoDe(evento);
                if (!campo) {
                    return;
                }
                const note = notes.find(ctx, Number(campo.closest(".note").dataset.id));
                if (!note) {
                    return;
                }
                const conteudo = rich.escrever(rich.doDom(campo));
                /* Apagando tudo, o navegador deixa um <br> sozinho no campo, e
                   o `:empty` do placeholder nunca mais vale. Vazio é vazio. */
                if (!conteudo && campo.firstChild) {
                    campo.replaceChildren();
                }
                note.content = conteudo;
                notes.card.marcarPintado(campo, conteudo);
                notes.store.queuePatch(ctx, note.id, { content: conteudo });
            });

            raiz.addEventListener("beforeinput", function (evento) {
                const campo = campoDe(evento);
                if (!campo) {
                    return;
                }
                /* Enter cria <div> por padrão, uma caixa por linha. Uma quebra
                   de linha é um <br>, que é o que a gramática guarda. */
                if (evento.inputType === "insertParagraph") {
                    evento.preventDefault();
                    if (sobra(campo) > 0) {
                        campo.ownerDocument.execCommand("insertLineBreak");
                    }
                    return;
                }
                const insere = evento.inputType.indexOf("insert") === 0 && evento.inputType !== "insertFromPaste";
                if (insere && sobra(campo) <= 0) {
                    evento.preventDefault();
                }
            });

            /* Colar entra como TEXTO. O que vem de uma página ou de um editor
               traz fonte, cor e tamanho junto, e o post-it só guarda as seis
               marcas: melhor não fingir que colou a formatação. */
            raiz.addEventListener("paste", function (evento) {
                const campo = campoDe(evento);
                if (!campo) {
                    return;
                }
                evento.preventDefault();
                inserirTexto(campo, (evento.clipboardData || window.clipboardData).getData("text/plain"));
            });

            raiz.addEventListener("drop", function (evento) {
                const campo = campoDe(evento);
                if (!campo || !evento.dataTransfer) {
                    return;
                }
                evento.preventDefault();
                inserirTexto(campo, evento.dataTransfer.getData("text/plain"));
            });

            /* Dentro de um campo editável, clicar num link põe o cursor nele —
               é assim em todo editor. Ctrl (ou Cmd) + clique abre, como no
               Notion e no Google Docs. */
            raiz.addEventListener("click", function (evento) {
                const link = evento.target.closest ? evento.target.closest(".note-text a[href]") : null;
                if (link && (evento.ctrlKey || evento.metaKey)) {
                    evento.preventDefault();
                    const href = rich.linkAceito(link.getAttribute("href"));
                    if (href) {
                        link.ownerDocument.defaultView.open(href, "_blank", "noopener");
                    }
                }
            });
        },
    };
})(EN.notes);
