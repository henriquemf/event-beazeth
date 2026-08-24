/* Criar, mover e redimensionar blocos com o ponteiro.

   O `pointermove` é agrupado em requestAnimationFrame e o rect do canvas fica
   em cache durante o arraste, para não forçar reflow a cada evento. */
window.EN = window.EN || {};
EN.planner = EN.planner || {};

(function (planner) {
    "use strict";

    const time = planner.time;
    const view = planner.view;
    const clamp = time.clamp;

    const DRAG_THRESHOLD = 4;

    planner.drag = {
        init: function (ctx) {
            let cachedRect = null;
            let pendingMove = null;
            let moveFrame = 0;

            function canvasRect() {
                if (!cachedRect) {
                    cachedRect = ctx.els.canvas.getBoundingClientRect();
                }
                return cachedRect;
            }

            function invalidateRect() {
                cachedRect = null;
            }

            function minuteFromPointer(clientY) {
                const rect = canvasRect();
                const raw = ctx.range.start + ((clientY - rect.top) / ctx.hourHeight) * 60;
                return clamp(raw, ctx.range.start, ctx.range.end);
            }

            function dayFromPointer(clientX) {
                const days = view.visibleDays(ctx);
                const rect = canvasRect();
                const width = rect.width / days.length;
                const index = clamp(Math.floor((clientX - rect.left) / width), 0, days.length - 1);
                return days[index];
            }

            function updateLabel() {
                if (!ctx.drag || !ctx.drag.el) {
                    return;
                }
                const label = ctx.drag.el.querySelector(".planner-block-time");
                if (label) {
                    label.textContent =
                        time.formatMinute(ctx.drag.draft.startMinute) + " – " + time.formatMinute(ctx.drag.draft.endMinute);
                }
            }

            function onPointerDown(event) {
                if (event.button !== 0 || ctx.drag) {
                    return;
                }

                const blockEl = event.target.closest(".planner-block");

                if (blockEl) {
                    const block = view.findBlock(ctx, Number(blockEl.dataset.id));
                    if (!block) {
                        return;
                    }
                    const handle = event.target.dataset ? event.target.dataset.handle : null;
                    ctx.drag = {
                        mode: handle ? "resize-" + handle : "move",
                        el: blockEl,
                        block: block,
                        draft: Object.assign({}, block),
                        grabOffset: minuteFromPointer(event.clientY) - block.startMinute,
                        originX: event.clientX,
                        originY: event.clientY,
                        moved: false,
                    };
                    ctx.selectedId = block.id;
                    ctx.els.canvas.querySelectorAll(".planner-block.is-selected").forEach(function (el) {
                        el.classList.remove("is-selected");
                    });
                    blockEl.classList.add("is-selected");
                    blockEl.classList.add("is-dragging");
                } else {
                    const column = event.target.closest(".planner-col");
                    if (!column) {
                        return;
                    }
                    const anchor = clamp(
                        time.snap(minuteFromPointer(event.clientY)),
                        0,
                        planner.DAY_MINUTES - planner.MIN_DURATION
                    );
                    const ghost = document.createElement("article");
                    ghost.className = "planner-block planner-ghost color-rose";
                    ghost.innerHTML = '<div class="planner-block-body"><span class="planner-block-time"></span></div>';
                    column.appendChild(ghost);

                    ctx.drag = {
                        mode: "create",
                        el: ghost,
                        day: Number(column.dataset.day),
                        anchor: anchor,
                        draft: { startMinute: anchor, endMinute: anchor + planner.MIN_DURATION },
                        originX: event.clientX,
                        originY: event.clientY,
                        moved: false,
                    };
                    planner.blocks.applyGeometry(ctx, ghost, ctx.drag.draft, 0, 1);
                    updateLabel();
                }

                event.preventDefault();
                invalidateRect();
                window.addEventListener("pointermove", onPointerMove, { passive: true });
                window.addEventListener("pointerup", onPointerUp);
                if (ctx.els.scroller) {
                    ctx.els.scroller.addEventListener("scroll", invalidateRect, { passive: true });
                }
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

            function processMove(event) {
                if (!ctx.drag) {
                    return;
                }
                const drag = ctx.drag;

                if (!drag.moved) {
                    const dx = Math.abs(event.clientX - drag.originX);
                    const dy = Math.abs(event.clientY - drag.originY);
                    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
                        return;
                    }
                    drag.moved = true;
                }

                const pointerMinute = minuteFromPointer(event.clientY);

                if (drag.mode === "create") {
                    const current = clamp(time.snap(pointerMinute), 0, planner.DAY_MINUTES);
                    drag.draft.startMinute = Math.min(drag.anchor, current);
                    drag.draft.endMinute = Math.max(
                        drag.anchor + planner.MIN_DURATION,
                        Math.max(drag.anchor, current)
                    );
                    planner.blocks.applyGeometry(ctx, drag.el, drag.draft, 0, 1);
                    updateLabel();
                    return;
                }

                if (drag.mode === "move") {
                    const duration = drag.block.endMinute - drag.block.startMinute;
                    const start = clamp(
                        time.snap(pointerMinute - drag.grabOffset),
                        0,
                        planner.DAY_MINUTES - duration
                    );
                    drag.draft.startMinute = start;
                    drag.draft.endMinute = start + duration;

                    if (!drag.block.isRoutine) {
                        const day = dayFromPointer(event.clientX);
                        if (day !== drag.draft.dayOfWeek) {
                            drag.draft.dayOfWeek = day;
                            const column = ctx.els.canvas.querySelector('.planner-col[data-day="' + day + '"]');
                            if (column) {
                                column.appendChild(drag.el);
                            }
                        }
                    }
                } else if (drag.mode === "resize-top") {
                    drag.draft.startMinute = clamp(
                        time.snap(pointerMinute),
                        0,
                        drag.draft.endMinute - planner.MIN_DURATION
                    );
                } else if (drag.mode === "resize-bottom") {
                    drag.draft.endMinute = clamp(
                        time.snap(pointerMinute),
                        drag.draft.startMinute + planner.MIN_DURATION,
                        planner.DAY_MINUTES
                    );
                }

                planner.blocks.applyGeometry(ctx, drag.el, drag.draft, 0, 1);
                updateLabel();
            }

            function onPointerUp() {
                window.removeEventListener("pointermove", onPointerMove);
                window.removeEventListener("pointerup", onPointerUp);
                if (ctx.els.scroller) {
                    ctx.els.scroller.removeEventListener("scroll", invalidateRect);
                }
                if (moveFrame) {
                    window.cancelAnimationFrame(moveFrame);
                    moveFrame = 0;
                }
                pendingMove = null;
                invalidateRect();

                const current = ctx.drag;
                ctx.drag = null;
                if (!current) {
                    return;
                }

                if (current.mode === "create") {
                    current.el.remove();
                    const start = current.draft.startMinute;
                    const end = current.moved
                        ? current.draft.endMinute
                        : Math.min(start + 60, planner.DAY_MINUTES);
                    planner.editor.open(ctx, null, {
                        dayOfWeek: current.day,
                        startMinute: start,
                        endMinute: end,
                    });
                    return;
                }

                current.el.classList.remove("is-dragging");

                if (!current.moved) {
                    planner.editor.open(ctx, current.block);
                    planner.blocks.render(ctx);
                    return;
                }

                const updated = Object.assign({}, current.block, {
                    startMinute: current.draft.startMinute,
                    endMinute: current.draft.endMinute,
                    dayOfWeek: current.block.isRoutine ? planner.ROUTINE_DAY : current.draft.dayOfWeek,
                });

                planner.store.save(ctx, updated).catch(function () {
                    planner.store.load(ctx);
                });
            }

            ctx.els.canvas.addEventListener("pointerdown", onPointerDown);

            ctx.els.canvas.addEventListener("keydown", function (event) {
                const blockEl = event.target.closest(".planner-block");
                if (blockEl && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    const block = view.findBlock(ctx, Number(blockEl.dataset.id));
                    if (block) {
                        planner.editor.open(ctx, block);
                    }
                }
            });

            window.addEventListener("resize", function () {
                invalidateRect();
                planner.blocks.renderNowLine(ctx);
            });
        },
    };
})(EN.planner);
