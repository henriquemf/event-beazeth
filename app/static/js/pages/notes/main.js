/* Ponto de entrada do quadro de post-its: filtros, ações e inicialização. */
(function (notes) {
    "use strict";

    const ctx = notes.createContext();
    if (!ctx) {
        return;
    }

    const els = ctx.els;

    function renderFilters() {
        const options = [{ id: "todos", label: "Todos", emoji: "📌" }].concat(notes.BUCKETS);
        els.filters.innerHTML = options.map(function (option) {
            return '<button class="notes-chip" type="button" data-bucket="' + option.id + '"' +
                ' aria-pressed="' + (option.id === ctx.filter) + '">' +
                '<span aria-hidden="true">' + option.emoji + "</span> " + option.label +
                "</button>";
        }).join("");
    }

    els.filters.addEventListener("click", function (event) {
        const chip = event.target.closest(".notes-chip");
        if (!chip) {
            return;
        }
        ctx.filter = chip.dataset.bucket;
        localStorage.setItem(notes.FILTER_KEY, ctx.filter);
        renderFilters();
        notes.board.render(ctx);
    });

    els.addBtn.addEventListener("click", function () {
        notes.actions.create(ctx);
    });

    els.tidyBtn.addEventListener("click", function () {
        notes.board.tidy(ctx);
    });

    /* Ao estreitar a janela, traz de volta quem ficou fora da área visível. */
    let resizeFrame = 0;
    window.addEventListener("resize", function () {
        if (resizeFrame) {
            return;
        }
        resizeFrame = window.requestAnimationFrame(function () {
            resizeFrame = 0;
            notes.visible(ctx).forEach(function (note) {
                const before = note.x;
                notes.board.clampToBoard(ctx, note);
                if (note.x !== before) {
                    const el = ctx.elements.get(note.id);
                    if (el) {
                        notes.card.applyGeometry(el, note);
                    }
                    notes.store.queuePatch(ctx, note.id, { x: note.x });
                }
            });
            notes.board.resize(ctx);
        });
    });

    /* Salva o que estiver pendente ao sair/esconder a aba. */
    window.addEventListener("pagehide", function () {
        notes.store.flushAll(ctx, true);
    });
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") {
            notes.store.flushAll(ctx, true);
        }
    });

    notes.interactions.init(ctx);
    renderFilters();

    notes.store.load(ctx).then(function () {
        notes.board.render(ctx);
    });
})(EN.notes);
