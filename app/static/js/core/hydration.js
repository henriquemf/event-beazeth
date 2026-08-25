/* Água: estado do dia e widget da barra lateral.

   Carrega em todas as telas porque o widget vive na sidebar, que é do layout
   base. Mesmo desenho do pomodoro (core/pomodoro.js): um motor com
   `subscribe()`, e a tela e o widget como assinantes iguais — assim os dois não
   têm como sair de sincronia, porque não existe código ligando um ao outro.

   A diferença para o pomodoro é de onde vem o estado. Copo bebido é conteúdo da
   conta, então mora no banco: o servidor manda os valores prontos nos
   `data-*` do HTML, e daí em diante quem manda é a resposta da API. Nenhum
   fetch no carregamento — a tela já nasce certa. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    const API = "/api/hydration/drink";
    const SPLASH_MS = 780;

    const listeners = [];
    let state = null;
    let ticker = 0;

    function readBoot() {
        /* Widget e tela carregam os mesmos `data-*`. O primeiro do documento
           serve: quando os dois existem, vieram da mesma requisição. */
        const node = document.querySelector("[data-water-boot]");
        if (!node) {
            return null;
        }

        const nextIn = node.dataset.nextIn;
        return {
            glasses: Number(node.dataset.glasses) || 0,
            goal: Math.max(1, Number(node.dataset.goal) || 8),
            glassMl: Math.max(1, Number(node.dataset.glassMl) || 250),
            /* Guarda o INSTANTE do vencimento, não os segundos que faltavam: o
               servidor manda uma duração justamente para não depender do fuso
               do navegador, e aqui ela vira um alvo fixo na hora em que chegou. */
            dueAt: nextIn === undefined || nextIn === "" ? null : Date.now() + Number(nextIn) * 1000,
            busy: false,
        };
    }

    function snapshot() {
        const level = Math.min(1, state.glasses / state.goal);
        return {
            glasses: state.glasses,
            goal: state.goal,
            glassMl: state.glassMl,
            level: level,
            reached: state.glasses >= state.goal,
            ml: state.glasses * state.glassMl,
            goalMl: state.goal * state.glassMl,
            busy: state.busy,
            /* Segundos até o próximo lembrete, ou null quando não há hora
               marcada (lembrete desligado ou ainda não enviado hoje). */
            nextIn: state.dueAt === null ? null : Math.max(0, Math.round((state.dueAt - Date.now()) / 1000)),
        };
    }

    function emit() {
        const snap = snapshot();
        listeners.forEach(function (fn) {
            fn(snap);
        });
    }

    /* O nível é uma variável CSS herdada: escrevê-la na raiz faz todos os copos
       da página (o do widget e o da tela) subirem juntos, sem o motor precisar
       saber quantos existem. */
    function paintLevel() {
        document.documentElement.style.setProperty("--water-level", snapshot().level.toFixed(4));
    }

    function splash() {
        const copos = document.querySelectorAll(".glass");
        copos.forEach(function (copo) {
            /* Reinicia a animação quando dois goles vêm em sequência: sem tirar
               e repor a classe, o segundo clique não anima nada. */
            copo.classList.remove("is-drinking");
            void copo.offsetWidth;
            copo.classList.add("is-drinking");
            window.setTimeout(function () {
                copo.classList.remove("is-drinking");
            }, SPLASH_MS);
        });
    }

    function startTicker() {
        if (ticker || !state) {
            return;
        }
        /* Um pulso por segundo, e só quando existe contagem para mostrar. */
        ticker = window.setInterval(function () {
            if (state.dueAt === null) {
                return;
            }
            emit();
        }, 1000);
    }

    EN.hydration = {
        snapshot: function () {
            return state ? snapshot() : null;
        },

        /* "12:04", ou "1:02:33" quando passa de uma hora. */
        format: function (seconds) {
            const total = Math.max(0, Math.round(seconds));
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = total % 60;
            const pad = function (v) {
                return v < 10 ? "0" + v : String(v);
            };
            return h > 0 ? h + ":" + pad(m) + ":" + pad(s) : pad(m) + ":" + pad(s);
        },

        subscribe: function (fn) {
            listeners.push(fn);
            if (state) {
                fn(snapshot());
            }
            return function () {
                const i = listeners.indexOf(fn);
                if (i !== -1) {
                    listeners.splice(i, 1);
                }
            };
        },

        /* delta > 0 registra um copo; delta < 0 desfaz o último.

           Otimista com trava: o nível sobe na hora, mas um segundo clique só
           entra depois da resposta. Sem a trava, dois cliques rápidos mandariam
           dois POST a partir do mesmo total e a tela ficaria mostrando um copo a
           menos do que o banco tem. */
        drink: async function (delta) {
            if (!state || state.busy) {
                return;
            }

            const passo = delta < 0 ? -1 : 1;
            const anterior = state.glasses;

            state.glasses = Math.max(0, state.glasses + passo);
            state.busy = true;
            paintLevel();
            if (passo > 0) {
                splash();
            }
            emit();

            try {
                const data = await EN.http.request(API, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ delta: passo }),
                }, "Não consegui registrar o copo.");

                state.glasses = data.glasses;
                state.goal = data.goal || state.goal;
                state.glassMl = data.glassMl || state.glassMl;
                state.dueAt = data.nextIn === null || data.nextIn === undefined
                    ? null
                    : Date.now() + data.nextIn * 1000;
                state.error = "";
            } catch (err) {
                state.glasses = anterior;
                state.error = err.message;
            } finally {
                state.busy = false;
                paintLevel();
                emit();
            }
        },

        lastError: function () {
            return state ? (state.error || "") : "";
        },
    };

    state = readBoot();
    if (state) {
        paintLevel();
        startTicker();
    }
})(window.EN);

/* ------------------------------------------------------------------ widget */

(function (EN) {
    "use strict";

    const widget = document.getElementById("water-widget");
    if (!widget || !EN.hydration.snapshot()) {
        return;
    }

    const countEl = widget.querySelector(".water-widget-count");
    const labelEl = widget.querySelector(".water-widget-label");

    let lastLabel = "";

    widget.addEventListener("click", function (event) {
        const button = event.target.closest("[data-water-action]");
        if (!button) {
            return;
        }
        EN.hydration.drink(button.dataset.waterAction === "undo" ? -1 : 1);
    });

    EN.hydration.subscribe(function (snap) {
        countEl.innerHTML = snap.glasses + "<small>/" + snap.goal + "</small>";

        let label;
        if (snap.reached) {
            label = "meta batida 💗";
        } else if (snap.nextIn === null) {
            label = snap.glasses === 1 ? "copo hoje" : "copos hoje";
        } else if (snap.nextIn === 0) {
            label = "hora de beber!";
        } else {
            label = "próximo em " + EN.hydration.format(snap.nextIn);
        }

        /* Só escreve quando o texto muda: o pulso é de 1s e a maior parte das
           vezes o rótulo é o mesmo. */
        if (label !== lastLabel) {
            lastLabel = label;
            labelEl.textContent = label;
        }

        widget.dataset.waterState = snap.reached ? "done" : (snap.nextIn === 0 ? "due" : "normal");
        widget.querySelectorAll("[data-water-action]").forEach(function (btn) {
            btn.disabled = snap.busy || (btn.dataset.waterAction === "undo" && snap.glasses === 0);
        });
    });
})(window.EN);
