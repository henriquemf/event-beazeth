/* Arraste, redimensionamento e edição inline dos post-its. */
window.EN = window.EN || {};
EN.notes = EN.notes || {};

(function (notes, utils) {
    "use strict";

    const clamp = utils.clamp;
    const LIMITS = notes.LIMITS;

    notes.actions = {
        update: function (ctx, id, fields) {
            const note = notes.find(ctx, id);
            if (!note) {
                return;
            }
            Object.assign(note, fields);

            const el = ctx.elements.get(id);
            if (el) {
                notes.card.sync(el, note);
            }
            notes.store.queuePatch(ctx, id, fields);
        },

        bringToFront: function (ctx, note) {
            const top = notes.maxZ(ctx);
            if (note.z >= top) {
                return;
            }
            note.z = top + 1;
            const el = ctx.elements.get(note.id);
            if (el) {
                el.style.setProperty("--n-z", note.z);
            }
            notes.store.queuePatch(ctx, note.id, { z: note.z });
        },

        create: async function (ctx) {
            const bucket = ctx.filter === "todos" ? "hoje" : ctx.filter;
            const width = clamp(
                notes.DEFAULT_SIZE.width,
                LIMITS.minW,
                Math.max(LIMITS.minW, notes.board.width(ctx) - notes.GAP * 2)
            );
            const height = notes.DEFAULT_SIZE.height;
            const spot = notes.board.findFreeSpot(ctx, width, height);

            const draft = {
                content: "",
                bucket: bucket,
                color: notes.COLORS[ctx.items.length % notes.COLORS.length],
                x: spot.x,
                y: spot.y,
                width: width,
                height: height,
                z: notes.maxZ(ctx) + 1,
            };

            try {
                const data = await notes.store.create(ctx, draft);
                ctx.items.push(data.note);
                notes.store.writeCache(ctx);
                notes.board.render(ctx, data.note.id);
                const el = ctx.elements.get(data.note.id);
                if (el) {
                    el.querySelector(".note-text").focus();
                }
            } catch (err) {
                notes.setStatus(ctx, "Não foi possível criar o post-it. Recarregue a página.");
            }
        },

        remove: function (ctx, id) {
            const el = ctx.elements.get(id);

            function drop() {
                ctx.items = ctx.items.filter(function (note) {
                    return note.id !== id;
                });
                /* Tira do DOM aqui: render() só limpa o que ainda está no mapa,
                   e a entrada é removida logo abaixo. */
                if (el) {
                    el.remove();
                }
                ctx.elements.delete(id);
                notes.store.writeCache(ctx);
                notes.board.render(ctx);
            }

            ctx.pending.delete(id);

            if (el) {
                el.classList.add("is-leaving");
                el.addEventListener("animationend", drop, { once: true });
                // Rede de segurança: com prefers-reduced-motion não há animação,
                // então animationend nunca dispara.
                window.setTimeout(function () {
                    if (ctx.elements.get(id) === el) {
                        drop();
                    }
                }, 280);
            } else {
                drop();
            }

            notes.store.destroy(ctx, id).catch(function () {
                notes.setStatus(ctx, "O post-it foi removido aqui, mas o servidor não respondeu.");
            });
        },
    };

    notes.interactions = {
        init: function (ctx) {
            const board = ctx.els.board;
            let pendingMove = null;
            let moveFrame = 0;

            /* ------------------------------------------------------ arraste */

            function onPointerDown(event) {
                if (event.button !== 0 || ctx.drag) {
                    return;
                }

                const el = event.target.closest(".note");
                if (!el) {
                    return;
                }

                const note = notes.find(ctx, Number(el.dataset.id));
                if (!note) {
                    return;
                }

                notes.actions.bringToFront(ctx, note);

                /* Digitar e clicar em botão nunca devem virar arraste. */
                if (event.target.closest(".note-text, .note-btn, .note-swatch")) {
                    return;
                }

                const action = event.target.dataset ? event.target.dataset.act : null;

                /* No toque, só a barra e o canto arrastam: o resto da área
                   continua rolando a página. */
                if (event.pointerType === "touch" && action !== "resize" && !event.target.closest(".note-bar")) {
                    return;
                }

                ctx.drag = {
                    mode: action === "resize" ? "resize" : "move",
                    el: el,
                    note: note,
                    pointerId: event.pointerId,
                    originX: event.clientX,
                    originY: event.clientY,
                    baseX: note.x,
                    baseY: note.y,
                    baseW: note.width,
                    baseH: note.height,
                    moved: false,
                };

                try {
                    el.setPointerCapture(event.pointerId);
                } catch (err) { /* opcional */ }
                el.classList.add(ctx.drag.mode === "resize" ? "is-resizing" : "is-dragging");
                event.preventDefault();

                window.addEventListener("pointermove", onPointerMove, { passive: true });
                window.addEventListener("pointerup", onPointerUp);
                window.addEventListener("pointercancel", onPointerUp);
            }

            function onPointerMove(event) {
                pendingMove = { clientX: event.clientX, clientY: event.clientY };
                if (moveFrame) {
                    return;
                }
                moveFrame = window.requestAnimationFrame(function () {
                    moveFrame = 0;
                    const point = pendingMove;
                    pendingMove = null;
                    if (point) {
                        processMove(point);
                    }
                });
            }

            function processMove(point) {
                const drag = ctx.drag;
                if (!drag) {
                    return;
                }

                const dx = point.clientX - drag.originX;
                const dy = point.clientY - drag.originY;

                if (!drag.moved) {
                    if (Math.abs(dx) < notes.DRAG_THRESHOLD && Math.abs(dy) < notes.DRAG_THRESHOLD) {
                        return;
                    }
                    drag.moved = true;
                }

                if (drag.mode === "move") {
                    drag.note.x = clamp(Math.round(drag.baseX + dx), 0, LIMITS.maxX);
                    drag.note.y = clamp(Math.round(drag.baseY + dy), 0, LIMITS.maxY);
                } else {
                    drag.note.width = clamp(Math.round(drag.baseW + dx), LIMITS.minW, LIMITS.maxW);
                    drag.note.height = clamp(Math.round(drag.baseH + dy), LIMITS.minH, LIMITS.maxH);
                }

                notes.card.applyGeometry(drag.el, drag.note);
            }

            function onPointerUp() {
                window.removeEventListener("pointermove", onPointerMove);
                window.removeEventListener("pointerup", onPointerUp);
                window.removeEventListener("pointercancel", onPointerUp);

                if (moveFrame) {
                    window.cancelAnimationFrame(moveFrame);
                    moveFrame = 0;
                }
                pendingMove = null;

                const current = ctx.drag;
                ctx.drag = null;
                if (!current) {
                    return;
                }

                current.el.classList.remove("is-dragging", "is-resizing");
                try {
                    current.el.releasePointerCapture(current.pointerId);
                } catch (err) { /* já liberado */ }

                if (!current.moved) {
                    return;
                }

                let fields;
                if (current.mode === "move") {
                    notes.board.clampToBoard(ctx, current.note);
                    notes.card.applyGeometry(current.el, current.note);
                    fields = { x: current.note.x, y: current.note.y };
                } else {
                    fields = { width: current.note.width, height: current.note.height };
                }

                notes.store.queuePatch(ctx, current.note.id, fields);
                notes.board.resize(ctx);
            }

            /* ------------------------------------------------------- edição */

            function closeSwatches(except) {
                board.querySelectorAll(".note-swatches:not([hidden])").forEach(function (panelEl) {
                    if (panelEl === except) {
                        return;
                    }
                    panelEl.hidden = true;
                    const trigger = panelEl.parentElement.querySelector('[data-act="palette"]');
                    if (trigger) {
                        trigger.setAttribute("aria-expanded", "false");
                    }
                });
            }

            board.addEventListener("click", function (event) {
                const noteEl = event.target.closest(".note");
                if (!noteEl) {
                    return;
                }
                const note = notes.find(ctx, Number(noteEl.dataset.id));
                if (!note) {
                    return;
                }

                const swatch = event.target.closest(".note-swatch");
                if (swatch) {
                    notes.actions.update(ctx, note.id, { color: swatch.dataset.color });
                    closeSwatches();
                    return;
                }

                const action = event.target.dataset ? event.target.dataset.act : null;

                if (action === "palette") {
                    const panelEl = noteEl.querySelector(".note-swatches");
                    const willOpen = panelEl.hidden;
                    closeSwatches(panelEl);
                    panelEl.hidden = !willOpen;
                    event.target.setAttribute("aria-expanded", String(willOpen));
                    return;
                }

                if (action === "bucket") {
                    const ids = notes.BUCKET_IDS;
                    const next = ids[(ids.indexOf(note.bucket) + 1) % ids.length];
                    notes.actions.update(ctx, note.id, { bucket: next });
                    if (ctx.filter !== "todos") {
                        notes.board.render(ctx);
                    }
                    return;
                }

                if (action === "delete") {
                    notes.actions.remove(ctx, note.id);
                }
            });

            board.addEventListener("input", function (event) {
                const textarea = event.target.closest(".note-text");
                if (!textarea) {
                    return;
                }
                const note = notes.find(ctx, Number(textarea.closest(".note").dataset.id));
                if (note) {
                    note.content = textarea.value;
                    notes.store.queuePatch(ctx, note.id, { content: textarea.value });
                }
            });

            /* O cartão ganha relevo enquanto está em edição. */
            board.addEventListener("focusin", function (event) {
                const noteEl = event.target.closest(".note");
                if (noteEl) {
                    noteEl.classList.add("is-editing");
                    const note = notes.find(ctx, Number(noteEl.dataset.id));
                    if (note) {
                        notes.actions.bringToFront(ctx, note);
                    }
                }
            });

            board.addEventListener("focusout", function (event) {
                const noteEl = event.target.closest(".note");
                if (noteEl && !noteEl.contains(event.relatedTarget)) {
                    noteEl.classList.remove("is-editing");
                    notes.store.flush(ctx, Number(noteEl.dataset.id));
                }
            });

            board.addEventListener("pointerdown", onPointerDown);

            document.addEventListener("click", function (event) {
                if (!event.target.closest(".note")) {
                    closeSwatches();
                }
            });

            document.addEventListener("keydown", function (event) {
                if (event.key !== "Escape") {
                    return;
                }
                const active = document.activeElement;
                if (active && active.closest && active.closest(".note")) {
                    closeSwatches();
                    active.blur();
                }
            });
        },
    };
})(EN.notes, EN.utils);
