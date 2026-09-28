/* O post-it numa janela flutuante, por cima de tudo, fora do site.

   É a Document Picture-in-Picture API: uma janela sempre-no-topo em que a
   página põe o HTML que quiser — ao contrário do PiP de vídeo, que só mostra
   um <video>. Existe no Chrome e no Edge de computador; onde não existe, o
   botão nem aparece (ver `card.build`), em vez de aparecer e não fazer nada.

   ## O cartão MUDA de documento, e não é copiado

   Uma cópia seriam dois editores do mesmo post-it, cada um com o seu texto —
   o que se escrevesse num teria de ser espelhado no outro a cada tecla. O
   elemento vai inteiro para a janela e volta quando ela fecha; o estado, a
   fila de gravação e o `ctx` continuam os mesmos. No lugar dele o quadro
   mostra um contorno, para ninguém achar que o post-it sumiu.

   Os ouvintes do quadro são delegados no próprio quadro, e não enxergam um
   elemento que foi para outro documento. Por isso a janela recebe os dela —
   os mesmos, ligados à raiz nova (`notes.interactions.ligar`,
   `notes.editor.ligar`, `notes.toolbar.ligar`). */
window.EN = window.EN || {};
EN.notes = EN.notes || {};

(function (notes) {
    "use strict";

    const API = window.documentPictureInPicture;

    /* Folga para a barra de título da janela, que o navegador desenha por fora
       mas desconta da área pedida. */
    const MARGEM = 24;

    function copiarAparencia(destino) {
        /* O tema e a fonte moram em atributos do <html> (theme-bootstrap). Sem
           eles a janela abriria no tema padrão, e não no escolhido. */
        Array.prototype.forEach.call(document.documentElement.attributes, function (atributo) {
            destino.documentElement.setAttribute(atributo.name, atributo.value);
        });
        document.querySelectorAll('link[rel="stylesheet"], style').forEach(function (folha) {
            destino.head.appendChild(folha.cloneNode(true));
        });
        destino.title = "Post-it";
        destino.body.classList.add("notes-pip");
    }

    function contorno(ctx, note) {
        const el = document.createElement("div");
        el.className = "note-ghost";
        notes.card.applyGeometry(el, note);
        el.innerHTML =
            '<span>⧉ Numa janela flutuante</span>' +
            '<button class="note-btn" type="button" data-act="pip-voltar">Trazer de volta</button>';
        el.querySelector("button").addEventListener("click", function () {
            if (ctx.pip) {
                ctx.pip.win.close();
            }
        });
        return el;
    }

    function devolver(ctx) {
        const aberto = ctx.pip;
        if (!aberto) {
            return;
        }
        ctx.pip = null;
        aberto.ghost.remove();
        aberto.el.classList.remove("is-pip");
        /* Some o que ainda estava esperando na fila antes de o cartão voltar:
           a janela já está fechando, e o que foi escrito nela não pode ficar
           dependendo de um temporizador. */
        notes.store.flush(ctx, aberto.id);
        if (notes.find(ctx, aberto.id)) {
            ctx.els.board.appendChild(aberto.el);
            notes.card.sync(aberto.el, notes.find(ctx, aberto.id));
        } else {
            ctx.elements.delete(aberto.id);
        }
        notes.board.render(ctx);
    }

    notes.pip = {
        suportado: !!API,

        /* O id do post-it que está na janela, ou null. O quadro pergunta isto
           para não arrancar de lá um cartão que está em outro documento. */
        idAberto: function (ctx) {
            return ctx.pip ? ctx.pip.id : null;
        },

        abrir: async function (ctx, id) {
            const note = notes.find(ctx, id);
            const el = ctx.elements.get(id);
            if (!API || !note || !el) {
                return;
            }
            if (ctx.pip) {
                if (ctx.pip.id === id) {
                    ctx.pip.win.focus();
                    return;
                }
                /* Só existe uma janela destas por vez: pedir outra fecha a
                   atual. Devolver ANTES de fechar deixa o cartão dela no
                   quadro já agora, sem esperar o `pagehide` chegar. */
                const anterior = ctx.pip.win;
                devolver(ctx);
                anterior.close();
            }

            let win;
            try {
                win = await API.requestWindow({ width: note.width + MARGEM, height: note.height + MARGEM });
            } catch (erro) {
                notes.setStatus(ctx, "O navegador não deixou abrir a janela flutuante.");
                return;
            }

            copiarAparencia(win.document);
            const ghost = contorno(ctx, note);
            el.after(ghost);
            el.classList.add("is-pip");
            win.document.body.appendChild(el);
            ctx.pip = { id: id, win: win, el: el, ghost: ghost };

            notes.interactions.ligar(ctx, win.document.body);
            notes.editor.ligar(ctx, win.document.body);
            notes.toolbar.ligar(win.document);

            /* Só devolve se ainda for ESTA a janela aberta: trocando de post-it,
               o `pagehide` da janela velha chega quando o `ctx.pip` já é o da
               nova, e devolveria o cartão errado. */
            win.addEventListener("pagehide", function () {
                if (ctx.pip && ctx.pip.win === win) {
                    devolver(ctx);
                }
            });
        },
    };
})(EN.notes);
