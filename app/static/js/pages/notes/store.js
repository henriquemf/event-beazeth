/* Persistência dos post-its: API, cache local e gravação em lote.

   Arrastar e digitar geram muitas mudanças por segundo. Os patches são
   agrupados por post-it e enviados depois de uma pausa, então uma edição vira
   uma requisição, não uma por tecla ou por pixel. */
window.EN = window.EN || {};
EN.notes = EN.notes || {};

(function (notes, http) {
    "use strict";

    const ERROR_MESSAGE = "Não foi possível salvar o post-it.";
    const OFFLINE_WRITE = "Sem conexão com o servidor — as alterações ficaram só neste navegador.";
    const OFFLINE_READ = "Sem conexão com o servidor — mostrando a última cópia salva neste navegador.";

    function request(url, options) {
        return http.request(url, options, ERROR_MESSAGE);
    }

    function writeCache(ctx) {
        try {
            localStorage.setItem(notes.CACHE_KEY, JSON.stringify(ctx.items));
        } catch (err) { /* cota cheia: o cache é só um atalho de leitura */ }
    }

    function readCache() {
        try {
            const raw = JSON.parse(localStorage.getItem(notes.CACHE_KEY) || "[]");
            return Array.isArray(raw) ? raw : [];
        } catch (err) {
            return [];
        }
    }

    function scheduleCacheWrite(ctx) {
        if (ctx.cacheTimer) {
            return;
        }
        ctx.cacheTimer = window.setTimeout(function () {
            ctx.cacheTimer = 0;
            writeCache(ctx);
        }, notes.CACHE_DELAY);
    }

    notes.store = {
        writeCache: writeCache,

        queuePatch: function (ctx, id, fields) {
            const entry = ctx.pending.get(id) || { fields: {}, timer: 0 };
            Object.assign(entry.fields, fields);
            if (entry.timer) {
                window.clearTimeout(entry.timer);
            }
            entry.timer = window.setTimeout(function () {
                notes.store.flush(ctx, id);
            }, notes.SAVE_DELAY);
            ctx.pending.set(id, entry);
            scheduleCacheWrite(ctx);
        },

        flush: function (ctx, id, keepalive) {
            const entry = ctx.pending.get(id);
            if (!entry) {
                return;
            }
            window.clearTimeout(entry.timer);
            ctx.pending.delete(id);

            const options = {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(entry.fields),
            };
            if (keepalive) {
                options.keepalive = true;
            }

            request(notes.API + "/" + id, options).then(function () {
                if (ctx.offline) {
                    ctx.offline = false;
                    notes.setStatus(ctx, "");
                }
            }).catch(function () {
                ctx.offline = true;
                notes.setStatus(ctx, OFFLINE_WRITE, "error");
            });
        },

        flushAll: function (ctx, keepalive) {
            Array.from(ctx.pending.keys()).forEach(function (id) {
                notes.store.flush(ctx, id, keepalive);
            });
            if (ctx.cacheTimer) {
                window.clearTimeout(ctx.cacheTimer);
                ctx.cacheTimer = 0;
            }
            writeCache(ctx);
        },

        create: function (ctx, draft) {
            return request(notes.API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(draft),
            });
        },

        destroy: function (ctx, id) {
            return request(notes.API + "/" + id, { method: "DELETE" });
        },

        load: async function (ctx) {
            try {
                const data = await request(notes.API, { headers: { Accept: "application/json" } });
                ctx.items = data.notes || [];
                writeCache(ctx);
                notes.setStatus(ctx, "");
            } catch (err) {
                ctx.offline = true;
                ctx.items = readCache();
                notes.setStatus(ctx, OFFLINE_READ, "error");
            }
        },
    };
})(EN.notes, EN.http);
