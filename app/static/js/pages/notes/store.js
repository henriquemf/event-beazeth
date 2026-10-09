/* Persistência dos post-its: API, cache local e gravação em lote.

   Arrastar e digitar geram muitas mudanças por segundo. Os patches são
   agrupados por post-it e enviados depois de uma pausa, então uma edição vira
   uma requisição, não uma por tecla ou por pixel. */
window.EN = window.EN || {};
EN.notes = EN.notes || {};

(function (notes, http) {
    "use strict";

    const ERROR_MESSAGE = "Não foi possível salvar o post-it.";
    const OFFLINE_WRITE = "Sem conexão com o servidor — as alterações estão guardadas neste navegador e sobem sozinhas quando ela voltar.";
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

    /* ------------------------------------------------ escritas não enviadas

       Antes, um PATCH que falhava saía da fila e ficava só no cache de leitura,
       com o aviso "as alterações ficaram só neste navegador". Ficavam até a
       próxima carga: ela trazia a versão do servidor, gravava no cache por
       cima, e o texto digitado sem rede sumia sem ninguém perceber.

       Agora a escrita que não chegou volta para a fila (e é reenviada sozinha)
       e vai para o disco do navegador, de onde a próxima carga da tela a manda
       antes de ler o servidor. */

    function lerNaoEnviadas() {
        try {
            const mapa = JSON.parse(localStorage.getItem(notes.UNSENT_KEY) || "{}");
            return mapa && typeof mapa === "object" && !Array.isArray(mapa) ? mapa : {};
        } catch (err) {
            return {};
        }
    }

    function gravarNaoEnviadas(mapa) {
        try {
            if (Object.keys(mapa).length) {
                localStorage.setItem(notes.UNSENT_KEY, JSON.stringify(mapa));
            } else {
                localStorage.removeItem(notes.UNSENT_KEY);
            }
        } catch (err) { /* cota cheia: a fila em memória continua tentando */ }
    }

    /* "Agora não deu" (sem rede, 5xx, 408, 429) espera; o resto dos 4xx é
       recusa -- o post-it foi apagado noutro aparelho, o valor é inválido -- e
       repetir não muda a resposta. A mesma regra da fila do app Android. */
    function passageiro(err) {
        const status = err && err.status;
        return !status || status >= 500 || status === 408 || status === 429;
    }

    /* `base` é a versão do post-it em que a escrita foi feita: é por ela que o
       reenvio, talvez noutro dia, sabe se o celular mexeu nele nesse meio
       tempo. Fica a da PRIMEIRA falha. */
    function guardarFalha(ctx, id, fields) {
        const mapa = lerNaoEnviadas();
        const nota = notes.find(ctx, id);
        const salvo = mapa[id] || { fields: {}, base: nota ? nota.updatedAt || null : null };
        const naFila = ctx.pending.get(id);
        /* O que foi digitado DEPOIS da falha vale mais que o que falhou. */
        salvo.fields = Object.assign(salvo.fields, fields, naFila ? naFila.fields : {});
        mapa[id] = salvo;
        gravarNaoEnviadas(mapa);

        const entry = naFila || { fields: {}, timer: 0 };
        entry.fields = Object.assign({}, fields, entry.fields);
        window.clearTimeout(entry.timer);
        entry.timer = window.setTimeout(function () {
            notes.store.flush(ctx, id);
        }, notes.RETRY_DELAY);
        ctx.pending.set(id, entry);
    }

    /* Tira do disco só os campos que chegaram COM ESTE valor: um campo que
       mudou de novo enquanto o pedido subia continua devendo. */
    function esquecerEnviadas(id, fields) {
        const mapa = lerNaoEnviadas();
        const salvo = mapa[id];
        if (!salvo) {
            return;
        }
        Object.keys(fields).forEach(function (campo) {
            if (JSON.stringify(salvo.fields[campo]) === JSON.stringify(fields[campo])) {
                delete salvo.fields[campo];
            }
        });
        if (!Object.keys(salvo.fields).length) {
            delete mapa[id];
        }
        gravarNaoEnviadas(mapa);
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

            request(notes.API + "/" + id, options).then(function (data) {
                esquecerEnviadas(id, entry.fields);
                /* A versão que o servidor tem agora é a desta tela: sem isto,
                   uma falha seguinte guardaria uma `base` velha, e o reenvio
                   veria "conflito" com a própria escrita anterior. */
                const nota = notes.find(ctx, id);
                if (nota && data.note) {
                    nota.updatedAt = data.note.updatedAt;
                }
                if (ctx.offline) {
                    ctx.offline = false;
                    notes.setStatus(ctx, "");
                }
            }).catch(function (err) {
                if (!passageiro(err)) {
                    esquecerEnviadas(id, entry.fields);
                    return;
                }
                ctx.offline = true;
                notes.setStatus(ctx, OFFLINE_WRITE);
                guardarFalha(ctx, id, entry.fields);
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

        /* `true` quando o que está em `ctx.items` veio do servidor. */
        load: async function (ctx) {
            try {
                const data = await request(notes.API, { headers: { Accept: "application/json" } });
                ctx.items = data.notes || [];
                writeCache(ctx);
                notes.setStatus(ctx, "");
                return true;
            } catch (err) {
                ctx.offline = true;
                ctx.items = readCache();
                notes.setStatus(ctx, OFFLINE_READ);
                return false;
            }
        },

        /* Manda o que ficou guardado de uma visita anterior, ANTES de a tela
           ler o servidor -- senão ela mostraria a versão sem estas escritas.

           Se o post-it mudou noutro aparelho depois da escrita guardada (a
           versão do servidor não é mais a `base`) e o texto diverge, gravar
           por cima apagaria o texto de lá; descartar apagaria o daqui. O texto
           daqui vira um post-it novo, ao lado do original. Post-it que não
           existe mais foi apagado por quem manda: a escrita sai junto. */
        reenviarGuardadas: async function (ctx) {
            const mapa = lerNaoEnviadas();
            const ids = Object.keys(mapa);
            if (!ids.length) {
                return;
            }
            let atuais;
            try {
                atuais = (await request(notes.API, { headers: { Accept: "application/json" } })).notes || [];
            } catch (err) {
                return;
            }
            for (const id of ids) {
                const salvo = mapa[id];
                const fields = Object.assign({}, salvo.fields);
                const nota = atuais.find(function (n) {
                    return String(n.id) === id;
                });
                try {
                    if (nota && "content" in fields && salvo.base && nota.updatedAt !== salvo.base &&
                            nota.content !== fields.content) {
                        await notes.store.create(ctx, {
                            content: fields.content,
                            bucket: fields.bucket || nota.bucket,
                            color: fields.color || nota.color,
                            x: nota.x + 28,
                            y: nota.y + 28,
                            width: nota.width,
                            height: nota.height,
                        });
                        delete fields.content;
                    }
                    if (nota && Object.keys(fields).length) {
                        await request(notes.API + "/" + id, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(fields),
                        });
                    }
                    esquecerEnviadas(id, salvo.fields);
                } catch (err) {
                    /* Sem rede no meio: o resto espera a próxima visita. */
                    if (passageiro(err)) {
                        return;
                    }
                    esquecerEnviadas(id, salvo.fields);
                }
            }
        },

        /* O que ainda deve ao servidor, por cima do que veio dele, e de volta
           à fila. Só acontece se o reenvio acima não conseguiu. */
        aplicarGuardadas: function (ctx) {
            const mapa = lerNaoEnviadas();
            Object.keys(mapa).forEach(function (id) {
                const nota = notes.find(ctx, Number(id));
                if (nota) {
                    Object.assign(nota, mapa[id].fields);
                    notes.store.queuePatch(ctx, nota.id, mapa[id].fields);
                }
            });
        },
    };
})(EN.notes, EN.http);
