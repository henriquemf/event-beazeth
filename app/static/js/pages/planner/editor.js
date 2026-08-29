/* Modal de criação/edição de bloco. */
window.EN = window.EN || {};
EN.planner = EN.planner || {};

(function (planner) {
    "use strict";

    const time = planner.time;

    function setError(ctx, message) {
        const errorEl = ctx.els.errorEl;
        if (!message) {
            errorEl.hidden = true;
            errorEl.textContent = "";
            return;
        }
        errorEl.hidden = false;
        errorEl.textContent = message;
    }

    function syncRoutineField(ctx) {
        ctx.els.dayField.hidden = ctx.els.routineInput.checked;
    }

    planner.editor = {
        setError: setError,
        syncRoutineField: syncRoutineField,

        open: function (ctx, block, seed) {
            const els = ctx.els;
            setError(ctx, null);
            ctx.editingId = block ? block.id : null;
            els.modalTitle.textContent = block ? "Editar bloco" : "Novo bloco";
            els.deleteBtn.hidden = !block;

            const source = block || Object.assign(
                { title: "", notes: "", color: "rose", isRoutine: false },
                seed
            );

            els.titleInput.value = source.title || "";
            els.notesInput.value = source.notes || "";
            els.startInput.value = time.formatMinute(source.startMinute);
            els.endInput.value = source.endMinute >= planner.DAY_MINUTES
                ? "23:59"
                : time.formatMinute(source.endMinute);
            els.routineInput.checked = Boolean(source.isRoutine);
            els.daySelect.value = String(source.isRoutine ? 0 : source.dayOfWeek);

            const swatch = els.form.querySelector(
                'input[name="planner-color"][value="' + (source.color || "rose") + '"]'
            );
            if (swatch) {
                swatch.checked = true;
            }

            syncRoutineField(ctx);
            els.modal.classList.add("show");
            els.modal.setAttribute("aria-hidden", "false");
            window.setTimeout(function () {
                els.titleInput.focus();
            }, 20);
        },

        close: function (ctx) {
            ctx.els.modal.classList.remove("show");
            ctx.els.modal.setAttribute("aria-hidden", "true");
            ctx.editingId = null;
        },

        submit: async function (ctx, event) {
            const els = ctx.els;
            event.preventDefault();
            setError(ctx, null);

            const title = els.titleInput.value.trim();
            if (!title) {
                setError(ctx, "Informe o título do bloco.");
                return;
            }

            const start = time.parseTimeValue(els.startInput.value);
            let end = time.parseTimeValue(els.endInput.value);
            if (start === null || end === null) {
                setError(ctx, "Horário inválido.");
                return;
            }
            if (end === 1439) {
                end = planner.DAY_MINUTES;
            }
            if (end <= start) {
                setError(ctx, "O fim precisa ser depois do início.");
                return;
            }

            const colorInput = els.form.querySelector('input[name="planner-color"]:checked');
            const payload = {
                id: ctx.editingId,
                title: title,
                notes: els.notesInput.value.trim(),
                dayOfWeek: Number(els.daySelect.value),
                // Sem `snap`: o que foi DIGITADO vale como foi digitado.
                // A grade de 15 minutos existe para o ARRASTE, onde o dedo (ou
                // o mouse) nao tem precisao de minuto -- ver `drag.js`. Aplicada
                // tambem aqui, ela transformava 12:20 em 12:15 depois de alguem
                // ter escrito 12:20, que e o oposto de ajudar.
                startMinute: start,
                endMinute: end,
                color: colorInput ? colorInput.value : "rose",
                isRoutine: els.routineInput.checked,
            };

            try {
                await planner.store.save(ctx, payload);
                planner.editor.close(ctx);
            } catch (err) {
                setError(ctx, err.message);
            }
        },

        init: function (ctx) {
            const els = ctx.els;

            els.routineInput.addEventListener("change", function () {
                syncRoutineField(ctx);
            });

            els.form.addEventListener("submit", function (event) {
                planner.editor.submit(ctx, event);
            });

            els.deleteBtn.addEventListener("click", async function () {
                if (!ctx.editingId || !window.confirm("Remover este bloco do planner?")) {
                    return;
                }
                try {
                    await planner.store.remove(ctx, ctx.editingId);
                    planner.editor.close(ctx);
                } catch (err) {
                    setError(ctx, err.message);
                }
            });

            els.modal.addEventListener("click", function (event) {
                if (event.target.dataset && event.target.dataset.closePlanner === "1") {
                    planner.editor.close(ctx);
                }
            });

            document.addEventListener("keydown", function (event) {
                if (event.key === "Escape" && els.modal.classList.contains("show")) {
                    planner.editor.close(ctx);
                    return;
                }

                const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
                if (
                    (event.key === "Delete" || event.key === "Backspace") &&
                    ctx.selectedId &&
                    !typing &&
                    !els.modal.classList.contains("show")
                ) {
                    event.preventDefault();
                    planner.store.remove(ctx, ctx.selectedId).catch(function () {});
                }
            });
        },
    };
})(EN.planner);
