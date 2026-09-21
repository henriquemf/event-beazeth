/* O confete do fim do pomodoro.

   Mora em `core/` e não na tela do pomodoro porque o timer corre em todas as
   telas — o widget da barra lateral está em todas elas. Quem termina um
   pomodoro lendo o calendário vê a festa ali mesmo.

   **O JS não anima nada.** Ele cria as peças, escreve a geometria de cada uma
   em custom properties e sai; quem faz o resto é um `@keyframes` em
   `components.css`, que roda no compositor. É a regra da constituição (§4):
   efeito decorativo não é laço de quadro em JavaScript. A cor também não vem
   daqui — sai de `:nth-child` no CSS, que é quem sabe a paleta.

   Com `prefers-reduced-motion` a festa simplesmente não acontece: `themes.css`
   desliga toda animação do documento, e peças criadas nesse estado ficariam
   paradas na tela até o temporizador removê-las. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    const PECAS = 42;
    const TONS = 6;
    const QUEDA_MIN = 1.7;
    const QUEDA_MAX = 3.1;

    /* Um palco só, reaproveitado: dois pomodoros seguidos não deixam dois
       contêineres presos no `body`. */
    let palco = null;
    let faxina = 0;

    function moveMenos() {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    function entre(minimo, maximo) {
        return minimo + Math.random() * (maximo - minimo);
    }

    EN.festa = {
        soltar: function () {
            if (moveMenos() || !document.body) {
                return;
            }

            if (!palco) {
                palco = document.createElement("div");
                palco.className = "festa";
                palco.setAttribute("aria-hidden", "true");
            }
            palco.textContent = "";
            document.body.appendChild(palco);

            let maisLonga = 0;
            for (let i = 0; i < PECAS; i += 1) {
                const peca = document.createElement("span");
                const queda = entre(QUEDA_MIN, QUEDA_MAX);
                const atraso = entre(0, 0.5);

                peca.className = "festa-peca tom-" + (i % TONS);
                peca.style.setProperty("--x", entre(2, 98).toFixed(2) + "vw");
                peca.style.setProperty("--deriva", entre(-14, 14).toFixed(2) + "vw");
                peca.style.setProperty("--girar", Math.round(entre(240, 900)) + "deg");
                peca.style.setProperty("--escala", entre(0.6, 1.25).toFixed(2));
                peca.style.setProperty("--tempo", queda.toFixed(2) + "s");
                peca.style.setProperty("--atraso", atraso.toFixed(2) + "s");

                maisLonga = Math.max(maisLonga, queda + atraso);
                palco.appendChild(peca);
            }

            clearTimeout(faxina);
            faxina = setTimeout(function () {
                palco.remove();
                palco.textContent = "";
            }, Math.ceil(maisLonga * 1000) + 120);
        },
    };
})(window.EN);
