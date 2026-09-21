/* O que o pomodoro mostra na casca: o widget da barra lateral e o selo do menu.

   Saiu de core/pomodoro.js quando os sub-pomodoros chegaram: lá ficou o estado
   (motor, principal, lista de subs) e aqui ficou o DOM. São dois assuntos
   diferentes, e juntos o arquivo passava de 700 linhas sem nenhuma folga.

   Os dois blocos abaixo são assinantes iguais aos da tela do pomodoro — é o
   desenho da constituição (§5): um motor, vários assinantes, nenhum código
   ligando um ao outro. */
window.EN = window.EN || {};

/* ------------------------------------------------------------------ widget */

/* O widget é servido pelo template (partials/pomodoro-widget.html) e só é
   revelado pelo CSS quando <html data-pomo="on"> — atributo que o bootstrap
   inline já define antes da primeira pintura. Assim ele nunca "aparece de
   repente" empurrando o resto da sidebar. */
(function (EN) {
    "use strict";

    const LABELS = { done: "Tempo esgotado", paused: "Pausado" };
    const DESCANSO = "Descanso";

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
        widget.dataset.pomoMode = snap.mode;

        if (toggleBtn) {
            const paused = snap.status === "paused";
            toggleBtn.textContent = paused ? "Retomar" : "Pausar";
            toggleBtn.setAttribute("aria-label", paused ? "Retomar pomodoro" : "Pausar pomodoro");
            toggleBtn.hidden = snap.status === "done";
        }

        if (labelEl) {
            /* O descanso manda no rótulo antes do resto: ver "Foco" correndo
               enquanto o que corre é o intervalo é o tipo de erro que faz
               alguém voltar a trabalhar cedo demais. */
            labelEl.textContent = snap.mode === "descanso"
                ? DESCANSO
                : (LABELS[snap.status] || snap.label || snap.minutes + " min");
        }
    });
})(window.EN);

/* --------------------------------------------------------- selo dos subs */

/* Os sub-pomodoros NÃO ganham widget na barra lateral: eram até dez caixas
   empilhadas empurrando o menu para fora da tela. O que a casca precisa dizer
   é uma coisa só — "tem outro contando" — e para isso basta um número em cima
   do link do Pomodoro.

   Fica no link (e não no widget) porque o widget só existe com o principal em
   andamento: com um sub correndo sozinho, não haveria onde pendurar o aviso.
   O mesmo selo aparece na barra inferior do celular, que usa a mesma lista de
   destinos. */
(function (EN) {
    "use strict";

    const selos = Array.prototype.slice.call(
        document.querySelectorAll('[data-nav-badge="pomo-subs"]')
    );
    if (!selos.length || !EN.pomodoroSubs) {
        return;
    }

    let ultimo = -1;

    EN.pomodoroSubs.subscribe(function () {
        const quantos = EN.pomodoroSubs.correndo();
        if (quantos === ultimo) {
            return;
        }
        ultimo = quantos;

        selos.forEach(function (selo) {
            selo.hidden = quantos === 0;
            selo.textContent = String(quantos);
            selo.setAttribute(
                "aria-label",
                quantos === 1 ? "1 outro pomodoro contando" : quantos + " outros pomodoros contando"
            );
        });
    });
})(window.EN);
