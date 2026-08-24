/* O quadro: montagem, crescimento livre e posicionamento.

   O quadro não é uma caixa fixa com rolagem própria: ele ocupa a largura
   disponível e cresce em altura conforme os post-its descem, deixando a página
   rolar normalmente. */
window.EN = window.EN || {};
EN.notes = EN.notes || {};

(function (notes) {
    "use strict";

    const GAP = notes.GAP;

    function boardWidth(ctx) {
        return Math.max(ctx.els.board.clientWidth || 0, notes.LIMITS.minW + GAP * 2);
    }

    notes.board = {
        width: boardWidth,

        /* Altura acompanha o post-it mais baixo; a largura é sempre 100%. */
        resize: function (ctx) {
            let bottom = 0;
            notes.visible(ctx).forEach(function (note) {
                bottom = Math.max(bottom, note.y + note.height);
            });
            ctx.els.board.style.setProperty(
                "--board-h",
                Math.ceil(Math.max(bottom + GAP * 3, 360)) + "px"
            );
        },

        /* Mantém o post-it dentro da largura visível para nunca sumir da tela.
           O eixo Y fica livre: o quadro cresce junto. */
        clampToBoard: function (ctx, note) {
            const limit = Math.max(boardWidth(ctx) - note.width - GAP, 0);
            note.x = Math.min(Math.max(note.x, 0), limit);
            note.y = Math.min(Math.max(note.y, 0), notes.LIMITS.maxY);
            return note;
        },

        /* Procura um espaço livre; se tudo estiver ocupado, empilha em cascata
           para o post-it novo nunca nascer escondido atrás de outro. */
        findFreeSpot: function (ctx, width, height) {
            const others = notes.visible(ctx);
            const limit = Math.max(boardWidth(ctx) - GAP, width + GAP);
            const step = 26;

            for (let y = GAP; y < 2400; y += step) {
                for (let x = GAP; x + width <= limit; x += step) {
                    const free = others.every(function (note) {
                        return x + width + 10 <= note.x ||
                            note.x + note.width + 10 <= x ||
                            y + height + 10 <= note.y ||
                            note.y + note.height + 10 <= y;
                    });
                    if (free) {
                        return { x: x, y: y };
                    }
                }
            }

            const offset = (others.length % 8) * 28;
            return { x: GAP + offset, y: GAP + offset };
        },

        mount: function (ctx, note, animate) {
            let el = ctx.elements.get(note.id);
            if (!el) {
                el = notes.card.build(note);
                ctx.elements.set(note.id, el);
                if (animate) {
                    el.classList.add("is-new");
                    el.addEventListener("animationend", function () {
                        el.classList.remove("is-new");
                    }, { once: true });
                }
                ctx.els.board.appendChild(el);
            }
            notes.card.sync(el, note);
            return el;
        },

        render: function (ctx, animateId) {
            const visible = notes.visible(ctx);
            const keep = new Set(visible.map(function (note) {
                return note.id;
            }));

            ctx.elements.forEach(function (el, id) {
                if (!keep.has(id)) {
                    el.remove();
                    ctx.elements.delete(id);
                }
            });

            visible.forEach(function (note) {
                notes.board.mount(ctx, note, note.id === animateId);
            });

            notes.board.resize(ctx);

            const total = visible.length;
            ctx.els.empty.hidden = total > 0;
            if (ctx.els.count) {
                ctx.els.count.textContent = total === 1 ? "1 post-it" : total + " post-its";
            }
        },

        /* Reorganiza em fileiras, respeitando a largura disponível. */
        tidy: function (ctx) {
            const visible = notes.visible(ctx).slice().sort(function (a, b) {
                return a.y - b.y || a.x - b.x;
            });
            if (!visible.length) {
                return;
            }

            const width = boardWidth(ctx);
            let x = GAP;
            let y = GAP;
            let rowHeight = 0;

            visible.forEach(function (note) {
                if (x > GAP && x + note.width > width - GAP) {
                    x = GAP;
                    y += rowHeight + GAP;
                    rowHeight = 0;
                }
                note.x = x;
                note.y = y;
                rowHeight = Math.max(rowHeight, note.height);
                x += note.width + GAP;

                const el = ctx.elements.get(note.id);
                if (el) {
                    el.classList.add("is-tidying");
                    notes.card.applyGeometry(el, note);
                    window.setTimeout(function () {
                        el.classList.remove("is-tidying");
                    }, 360);
                }
                notes.store.queuePatch(ctx, note.id, { x: note.x, y: note.y });
            });

            notes.board.resize(ctx);
        },
    };
})(EN.notes);
