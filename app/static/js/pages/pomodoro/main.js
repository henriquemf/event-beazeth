/* Tela do pomodoro: escolha do tempo e mostrador.

   O motor (contagem, persistência, som) é o de core/pomodoro.js — esta tela é
   só mais um assinante dele, exatamente como o widget da barra lateral. Por isso
   os dois nunca saem de sincronia: pausar aqui atualiza o widget e vice-versa,
   sem nenhum código de ligação entre os dois. */
(function (EN) {
    "use strict";

    const CHOICE_KEY = "en_pomodoro_choice";
    const DEFAULT_MINUTES = 25;

    const stage = document.getElementById("pomo-stage");
    if (!stage) {
        return;
    }

    const els = {
        clock: document.getElementById("pomo-clock"),
        state: document.getElementById("pomo-state"),
        primary: document.getElementById("pomo-primary"),
        reset: document.getElementById("pomo-reset"),
        presets: document.getElementById("pomo-presets"),
        range: document.getElementById("pomo-minutes"),
        field: document.getElementById("pomo-minutes-field"),
        output: document.getElementById("pomo-minutes-out"),
        locked: document.getElementById("pomo-locked"),
    };

    /* Os tempos prontos chegam renderizados do servidor; o JS só lê o que já
       está no HTML em vez de manter uma segunda lista igual. */
    const buttons = Array.prototype.slice.call(els.presets.querySelectorAll(".pomo-preset"));
    const presetLabels = {};
    buttons.forEach(function (button) {
        const small = button.querySelector("small");
        presetLabels[button.dataset.minutes] = small ? small.textContent.trim() : "";
    });

    let choice = readChoice();
    let locked = false;

    /* ------------------------------------------------------------ escolha */

    function clampMinutes(value) {
        const minutes = Math.round(Number(value) || 0);
        return EN.utils.clamp(minutes, EN.pomodoro.MIN_MINUTES, EN.pomodoro.MAX_MINUTES);
    }

    function readChoice() {
        const stored = parseInt(localStorage.getItem(CHOICE_KEY), 10);
        return clampMinutes(stored > 0 ? stored : DEFAULT_MINUTES);
    }

    function labelFor(minutes) {
        return presetLabels[String(minutes)] || "Personalizado";
    }

    /* `persist` é falso quando quem mandou o valor foi o próprio timer em
       andamento: aí a tela só reflete o que está rodando, sem sobrescrever a
       preferência guardada do usuário. */
    function setChoice(minutes, persist) {
        choice = clampMinutes(minutes);

        buttons.forEach(function (button) {
            button.setAttribute("aria-pressed", String(Number(button.dataset.minutes) === choice));
        });

        /* O slider vai até 120; acima disso ele encosta no fim e quem manda é o
           campo numérico. */
        els.range.value = String(Math.min(choice, Number(els.range.max)));
        if (els.field.value !== String(choice)) {
            els.field.value = String(choice);
        }
        els.output.textContent = String(choice);

        if (persist) {
            try {
                localStorage.setItem(CHOICE_KEY, String(choice));
            } catch (e) {
                /* Sem cota: a escolha vale só nesta visita. */
            }
        }
    }

    /* Mexer na escolha depois que o tempo acabou dispensa o timer terminado —
       senão o mostrador exibiria o tempo novo ainda pintado de "concluído", e o
       widget continuaria na barra lateral anunciando um fim já visto. */
    function chooseFromUser(minutes) {
        if (EN.pomodoro.snapshot().status === "done") {
            EN.pomodoro.stop();
        }
        setChoice(minutes, true);
        paintIdle();
    }

    els.presets.addEventListener("click", function (event) {
        const button = event.target.closest(".pomo-preset");
        if (!button || locked) {
            return;
        }
        chooseFromUser(button.dataset.minutes);
    });

    els.range.addEventListener("input", function () {
        chooseFromUser(els.range.value);
    });

    /* `input` no campo numérico dispara a cada tecla: enquanto o campo está
       vazio ou incompleto, guarda o valor sem forçar o mínimo — senão digitar
       "45" viraria "4" → 4 min no meio da digitação. O `change` (sair do campo)
       é que normaliza. */
    els.field.addEventListener("input", function () {
        const typed = Number(els.field.value);
        if (els.field.value === "" || !(typed > 0)) {
            return;
        }
        chooseFromUser(typed);
    });

    els.field.addEventListener("change", function () {
        chooseFromUser(els.field.value);
    });

    /* -------------------------------------------------------- mostrador */

    function paintIdle() {
        if (locked) {
            return;
        }
        els.clock.textContent = EN.pomodoro.format(choice * 60000);
        stage.style.setProperty("--pomo-progress", "0");
    }

    function endsAtText(leftMs) {
        const end = new Date(Date.now() + leftMs);
        const pad = function (value) {
            return value < 10 ? "0" + value : String(value);
        };
        return pad(end.getHours()) + ":" + pad(end.getMinutes());
    }

    function describe(snap) {
        if (snap.status === "done") {
            return "Tempo esgotado! 🍎";
        }
        if (snap.status === "paused") {
            return "Pausado em " + EN.pomodoro.format(snap.leftMs);
        }
        if (snap.phase === "warning") {
            return "Reta final — termina às " + endsAtText(snap.leftMs);
        }
        return "Focando até às " + endsAtText(snap.leftMs);
    }

    const PRIMARY_LABEL = {
        idle: "Começar",
        running: "Pausar",
        paused: "Retomar",
        done: "Começar de novo",
    };

    function setLocked(value) {
        if (locked === value) {
            return;
        }
        locked = value;
        buttons.forEach(function (button) {
            button.disabled = value;
        });
        els.range.disabled = value;
        els.field.disabled = value;
        els.locked.hidden = !value;
    }

    els.primary.addEventListener("click", function () {
        const snap = EN.pomodoro.snapshot();
        if (snap.status === "running") {
            EN.pomodoro.pause();
        } else if (snap.status === "paused") {
            EN.pomodoro.resume();
        } else {
            EN.pomodoro.start(choice, labelFor(choice));
        }
    });

    els.reset.addEventListener("click", function () {
        EN.pomodoro.stop();
    });

    EN.pomodoro.subscribe(function (snap) {
        stage.dataset.pomoStatus = snap.status;
        stage.dataset.pomoPhase = snap.phase;
        els.primary.textContent = PRIMARY_LABEL[snap.status];
        els.reset.hidden = !snap.active;

        /* Terminado ainda é um estado visível (o widget mostra "Tempo
           esgotado"), mas já libera a escolha do próximo tempo. */
        setLocked(snap.active && snap.status !== "done");

        if (!snap.active) {
            els.state.textContent = "Pronto para começar";
            /* Sem timer, a tela volta para a preferência guardada. Sem isto,
               chegar aqui com um timer alheio em andamento (começado em outra
               tela ou em outro dia) e zerá-lo deixava o mostrador no tempo
               daquele timer, enquanto o localStorage guardava outro — a próxima
               recarga pularia sozinha para um valor diferente. */
            setChoice(readChoice(), false);
            paintIdle();
            return;
        }

        /* Ao chegar na tela com um timer rodando, os controles passam a mostrar
           o tempo dele — sem gravar por cima da preferência guardada. */
        if (snap.minutes !== choice) {
            setChoice(snap.minutes, false);
        }

        els.clock.textContent = EN.pomodoro.format(snap.leftMs);
        els.state.textContent = describe(snap);
        stage.style.setProperty("--pomo-progress", snap.progress.toFixed(4));
    });

    setChoice(choice, false);
})(window.EN);
