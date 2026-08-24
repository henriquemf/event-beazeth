/* Pomodoro: motor do temporizador e widget da barra lateral.

   Carrega em todas as telas porque o widget vive na sidebar, que é do layout
   base — o timer precisa continuar contando quando o usuário navega para outra
   página. Segue o mesmo desenho de core/push.js: uma feature global inteira num
   arquivo só, dividida em duas seções bem marcadas.

   Por que localStorage e não o banco:
   - O widget precisa aparecer já pintado a cada navegação. Vindo de fetch, toda
     troca de página teria um buraco na sidebar até a resposta chegar.
   - O que é guardado é `endsAt` (epoch absoluto), não "segundos restantes".
     Assim recarregar a página, dormir a máquina ou trocar de aba não desalinha
     a contagem: ela é sempre recalculada a partir do relógio.
   - Um timer rodando é do aparelho, não da conta. Sincronizar via servidor faria
     o celular herdar o pomodoro do notebook. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    const KEY = "en_pomodoro";
    const TICK_MS = 250;
    const WARN_MS = 5 * 60 * 1000;
    const MIN_MINUTES = 1;
    const MAX_MINUTES = 600;

    let state = null;
    let ticker = 0;
    let chime = null;
    const listeners = [];

    /* ------------------------------------------------------------ estado */

    function isValid(data) {
        return !!data
            && typeof data.totalMs === "number"
            && data.totalMs > 0
            && ["running", "paused", "done"].indexOf(data.status) !== -1;
    }

    function read() {
        try {
            const raw = localStorage.getItem(KEY);
            if (!raw) {
                return null;
            }
            const data = JSON.parse(raw);
            return isValid(data) ? data : null;
        } catch (e) {
            return null;
        }
    }

    function write() {
        try {
            if (state) {
                localStorage.setItem(KEY, JSON.stringify(state));
            } else {
                localStorage.removeItem(KEY);
            }
        } catch (e) {
            /* Modo privado sem cota: o timer segue valendo só nesta página. */
        }
        document.documentElement.dataset.pomo = state ? "on" : "off";
    }

    function leftOf(data) {
        if (!data) {
            return 0;
        }
        if (data.status === "running") {
            return Math.max(0, data.endsAt - Date.now());
        }
        return Math.max(0, data.leftMs || 0);
    }

    /* Regra pedida: avisar faltando 5 min. Num timer de 3 min isso pintaria a
       tela de alerta desde o primeiro segundo, então abaixo de 5 min o aviso
       passa a valer para os últimos 20% do tempo. */
    function warnAt(totalMs) {
        return totalMs > WARN_MS ? WARN_MS : Math.round(totalMs * 0.2);
    }

    function snapshot() {
        if (!state) {
            return { active: false, status: "idle", phase: "normal", leftMs: 0, totalMs: 0, progress: 0, label: "" };
        }

        const leftMs = leftOf(state);
        const done = state.status === "done" || leftMs <= 0;

        return {
            active: true,
            status: done ? "done" : state.status,
            phase: done ? "done" : (leftMs <= warnAt(state.totalMs) ? "warning" : "normal"),
            leftMs: done ? 0 : leftMs,
            totalMs: state.totalMs,
            progress: done ? 1 : 1 - leftMs / state.totalMs,
            minutes: state.minutes,
            label: state.label || "",
        };
    }

    function emit() {
        const snap = snapshot();
        listeners.forEach(function (fn) {
            fn(snap);
        });
    }

    /* ---------------------------------------------------------- contagem */

    function stopTicker() {
        if (ticker) {
            clearInterval(ticker);
            ticker = 0;
        }
    }

    function startTicker() {
        stopTicker();
        if (state && state.status === "running") {
            ticker = setInterval(tick, TICK_MS);
        }
    }

    function finish() {
        /* Se o sino já estava agendado no relógio do WebAudio, ele está tocando
           agora — soltar o handle sem cancelar. Só toca na mão quando o
           agendamento não chegou a acontecer (aba nunca liberou o áudio). */
        const armed = chime && chime.armed;
        chime = null;

        state.status = "done";
        state.leftMs = 0;
        write();
        stopTicker();

        if (!armed) {
            EN.audio.chime();
        }
        emit();
    }

    function tick() {
        if (!state) {
            return;
        }
        if (state.status === "running" && leftOf(state) <= 0) {
            finish();
            return;
        }
        emit();
    }

    function cancelChime() {
        if (chime) {
            chime.cancel();
            chime = null;
        }
    }

    function armChime() {
        cancelChime();
        if (state && state.status === "running") {
            chime = EN.audio.chimeAt(state.endsAt);
        }
    }

    /* ------------------------------------------------------------- ações */

    function clampMinutes(minutes) {
        const value = Math.round(Number(minutes) || 0);
        return Math.min(Math.max(value, MIN_MINUTES), MAX_MINUTES);
    }

    EN.pomodoro = {
        KEY: KEY,
        MIN_MINUTES: MIN_MINUTES,
        MAX_MINUTES: MAX_MINUTES,

        snapshot: snapshot,

        /* "MM:SS", ou "H:MM:SS" quando passa de uma hora. Arredonda para cima
           para o mostrador nunca exibir 00:00 com tempo restante. */
        format: function (ms) {
            const total = Math.ceil(Math.max(0, ms) / 1000);
            const hours = Math.floor(total / 3600);
            const minutes = Math.floor((total % 3600) / 60);
            const seconds = total % 60;
            const pad = function (value) {
                return value < 10 ? "0" + value : String(value);
            };
            return hours > 0
                ? hours + ":" + pad(minutes) + ":" + pad(seconds)
                : pad(minutes) + ":" + pad(seconds);
        },

        start: function (minutes, label) {
            const total = clampMinutes(minutes) * 60000;
            state = {
                status: "running",
                totalMs: total,
                minutes: total / 60000,
                endsAt: Date.now() + total,
                leftMs: total,
                label: label || "",
            };
            write();
            armChime();
            startTicker();
            emit();
        },

        pause: function () {
            if (!state || state.status !== "running") {
                return;
            }
            state.leftMs = leftOf(state);
            state.status = "paused";
            write();
            cancelChime();
            stopTicker();
            emit();
        },

        resume: function () {
            if (!state || state.status !== "paused") {
                return;
            }
            state.endsAt = Date.now() + state.leftMs;
            state.status = "running";
            write();
            armChime();
            startTicker();
            emit();
        },

        stop: function () {
            state = null;
            write();
            cancelChime();
            stopTicker();
            emit();
        },

        subscribe: function (fn) {
            listeners.push(fn);
            fn(snapshot());
            return function () {
                const index = listeners.indexOf(fn);
                if (index !== -1) {
                    listeners.splice(index, 1);
                }
            };
        },
    };

    /* ------------------------------------------------------ inicialização */

    state = read();
    write();

    if (state && state.status === "running") {
        if (leftOf(state) <= 0) {
            /* Acabou com a aba fechada: já entra como concluído, sem som — o
               momento passou e um sino ao abrir a página só assustaria. */
            state.status = "done";
            state.leftMs = 0;
            write();
        } else {
            armChime();
            startTicker();
        }
    }

    /* Aba em segundo plano tem setInterval estrangulado. Ao voltar, recalcula
       na hora em vez de esperar o próximo pulso. */
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
            tick();
        }
    });

    /* Duas abas abertas ficam em sincronia: quem não fez a mudança recebe o
       evento `storage` e realinha. */
    window.addEventListener("storage", function (event) {
        if (event.key !== KEY) {
            return;
        }
        state = read();
        armChime();
        startTicker();
        emit();
    });
})(window.EN);

/* ------------------------------------------------------------------ widget */

/* O widget é servido pelo template (partials/pomodoro-widget.html) e só é
   revelado pelo CSS quando <html data-pomo="on"> — atributo que o bootstrap
   inline já define antes da primeira pintura. Assim ele nunca "aparece de
   repente" empurrando o resto da sidebar. */
(function (EN) {
    "use strict";

    const LABELS = { done: "Tempo esgotado", paused: "Pausado" };

    const widget = document.getElementById("pomo-widget");
    if (!widget) {
        return;
    }

    const timeEl = widget.querySelector(".pomo-widget-time");
    const labelEl = widget.querySelector(".pomo-widget-label");
    const toggleBtn = widget.querySelector('[data-pomo-action="toggle"]');

    let lastTime = "";

    widget.addEventListener("click", function (event) {
        const button = event.target.closest("[data-pomo-action]");
        if (!button) {
            return;
        }

        const snap = EN.pomodoro.snapshot();
        const action = button.dataset.pomoAction;

        if (action === "stop") {
            EN.pomodoro.stop();
        } else if (snap.status === "running") {
            EN.pomodoro.pause();
        } else if (snap.status === "paused") {
            EN.pomodoro.resume();
        }
    });

    EN.pomodoro.subscribe(function (snap) {
        if (!snap.active) {
            return;
        }

        /* Só escreve no DOM quando o segundo exibido muda: o pulso é de 250ms,
           então 3 de cada 4 atualizações seriam idênticas. */
        const text = EN.pomodoro.format(snap.leftMs);
        if (text !== lastTime) {
            lastTime = text;
            timeEl.textContent = text;
        }

        widget.style.setProperty("--pomo-progress", snap.progress.toFixed(4));
        widget.dataset.pomoStatus = snap.status;
        widget.dataset.pomoPhase = snap.phase;

        if (toggleBtn) {
            const paused = snap.status === "paused";
            toggleBtn.textContent = paused ? "Retomar" : "Pausar";
            toggleBtn.setAttribute("aria-label", paused ? "Retomar pomodoro" : "Pausar pomodoro");
            toggleBtn.hidden = snap.status === "done";
        }

        if (labelEl) {
            labelEl.textContent = LABELS[snap.status] || snap.label || snap.minutes + " min";
        }
    });
})(window.EN);
