/* Comunicação com /api/planner/blocks. */
window.EN = window.EN || {};
EN.planner = EN.planner || {};

(function (planner, http) {
    "use strict";

    const ERROR_MESSAGE = "Não foi possível salvar o bloco.";

    function request(url, options) {
        return http.request(url, options, ERROR_MESSAGE);
    }

    function toPayload(block) {
        return {
            title: block.title,
            notes: block.notes || "",
            dayOfWeek: block.dayOfWeek,
            startMinute: block.startMinute,
            endMinute: block.endMinute,
            color: block.color,
            isRoutine: Boolean(block.isRoutine),
        };
    }

    planner.store = {
        toPayload: toPayload,

        load: async function (ctx) {
            try {
                const data = await request(ctx.api, { headers: { Accept: "application/json" } });
                ctx.blocks = data.blocks || [];
                planner.blocks.render(ctx);
            } catch (err) {
                ctx.els.panel.classList.add("has-error");
            }
        },

        save: async function (ctx, block) {
            const isNew = !block.id;
            const data = await request(isNew ? ctx.api : ctx.api + "/" + block.id, {
                method: isNew ? "POST" : "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(toPayload(block)),
            });

            const saved = data.block;
            const index = ctx.blocks.findIndex(function (item) {
                return item.id === saved.id;
            });
            if (index === -1) {
                ctx.blocks.push(saved);
            } else {
                ctx.blocks[index] = saved;
            }
            ctx.selectedId = saved.id;
            planner.blocks.render(ctx);
            return saved;
        },

        remove: async function (ctx, id) {
            await request(ctx.api + "/" + id, { method: "DELETE" });
            ctx.blocks = ctx.blocks.filter(function (block) {
                return block.id !== id;
            });
            if (ctx.selectedId === id) {
                ctx.selectedId = null;
            }
            planner.blocks.render(ctx);
        },
    };
})(EN.planner, EN.http);
