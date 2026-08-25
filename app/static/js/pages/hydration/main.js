/* Tela da água.

   Assinante do mesmo motor que alimenta o widget (core/hydration.js): beber
   aqui atualiza a barra lateral e vice-versa, sem nenhum código ligando os
   dois.

   O formulário de configuração continua sendo POST normal, com redirect — é
   configuração, não interação contínua, e assim a página volta com os valores
   já validados pelo servidor. */
(function (EN) {
    "use strict";

    const stage = document.getElementById("water-stage");
    if (!stage || !EN.hydration.snapshot()) {
        return;
    }

    const els = {
        count: document.getElementById("water-count"),
        volume: document.getElementById("water-volume"),
        note: document.getElementById("water-note"),
        goalVolume: document.getElementById("water-goal-volume"),
    };

    /* Litros com vírgula e sem zeros à toa: 1,25 L / 2 L. */
    function litros(ml) {
        return (ml / 1000)
            .toFixed(2)
            .replace(/\.?0+$/, "")
            .replace(".", ",");
    }

    stage.addEventListener("click", function (event) {
        const button = event.target.closest("[data-water-action]");
        if (!button) {
            return;
        }
        EN.hydration.drink(button.dataset.waterAction === "undo" ? -1 : 1);
    });

    EN.hydration.subscribe(function (snap) {
        els.count.innerHTML = "<strong>" + snap.glasses + "</strong> de " + snap.goal +
            (snap.goal === 1 ? " copo" : " copos");
        els.volume.textContent = litros(snap.ml) + " L de " + litros(snap.goalMl) + " L";

        const erro = EN.hydration.lastError();
        if (erro) {
            els.note.textContent = erro;
        } else if (snap.reached) {
            els.note.textContent = "Meta do dia batida! 💗";
        } else if (snap.nextIn === 0) {
            els.note.textContent = "Hora de beber água.";
        } else if (snap.nextIn !== null) {
            els.note.textContent = "Próximo lembrete em " + EN.hydration.format(snap.nextIn) + ".";
        } else {
            els.note.textContent = "Ligue o lembrete abaixo para ser avisada durante o dia.";
        }

        stage.dataset.waterState = erro ? "error" : (snap.reached ? "done" : "normal");
        stage.querySelectorAll("[data-water-action]").forEach(function (btn) {
            btn.disabled = snap.busy || (btn.dataset.waterAction === "undo" && snap.glasses === 0);
        });
    });

    /* Prévia do total ao mexer na meta, antes de salvar: sem isso só dá para
       descobrir quantos litros a configuração dá depois de submeter. */
    const goalField = document.querySelector('input[name="daily_goal"]');
    const mlField = document.querySelector('input[name="glass_ml"]');

    if (goalField && mlField && els.goalVolume) {
        const preview = function () {
            const total = (Number(goalField.value) || 0) * (Number(mlField.value) || 0);
            els.goalVolume.textContent = litros(total);
        };
        goalField.addEventListener("input", preview);
        mlField.addEventListener("input", preview);
    }
})(window.EN);
