/* Tela de aparência: o som de cada momento.

   A lista (momentos, opções, nomes) vem renderizada do servidor; aqui só se
   marca a escolha atual, se grava a nova e se toca a prévia. Quem sabe qual é
   o som de cada momento — inclusive o padrão — é `EN.audio`: esta tela não
   tem uma segunda cópia dessa regra. */
(function (EN) {
    "use strict";

    const momentos = Array.prototype.slice.call(document.querySelectorAll(".som-momento"));
    if (!momentos.length || !EN.audio) {
        return;
    }

    /* O nome da opção marcada, escrito no resumo da linha fechada: é o que
       deixa ver os cinco sons de relance sem abrir nenhum. */
    function pintar(linha) {
        const escolhida = EN.audio.escolha(linha.dataset.momento);
        let nome = "";
        linha.querySelectorAll('input[type="radio"]').forEach(function (radio) {
            radio.checked = radio.value === escolhida;
            if (radio.checked) {
                nome = radio.parentElement.querySelector("strong").textContent;
            }
        });
        linha.querySelector("[data-som-atual]").textContent = nome;
    }

    momentos.forEach(function (linha) {
        pintar(linha);

        linha.addEventListener("change", function (event) {
            if (event.target.type !== "radio") {
                return;
            }
            EN.audio.escolher(linha.dataset.momento, event.target.value);
            pintar(linha);
        });

        linha.addEventListener("click", function (event) {
            const botao = event.target.closest("[data-ouvir]");
            if (botao) {
                EN.audio.ouvir(botao.dataset.ouvir);
            }
        });
    });

    /* Outra aba mudou um som: esta acompanha, para as duas não mostrarem
       escolhas diferentes. */
    window.addEventListener("storage", function (event) {
        if (event.key === "en_sons") {
            momentos.forEach(pintar);
        }
    });
})(window.EN);
