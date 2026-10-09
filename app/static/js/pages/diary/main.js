/* Tela do diário: escolher o dia, o humor e escrever.

   A grade inteira chega pintada do servidor — 372 botões com `data-mood` e
   `data-note` já dentro. Este arquivo não desenha nada: ele abre o editor com o
   que já está na célula, manda o `PUT` e devolve a resposta para a mesma
   célula. Por isso não existe uma segunda lista de dias aqui para sair de
   sincronia com a que o Jinja renderizou.

   Um ouvinte só, no contêiner da grade: 372 ouvintes seria o mesmo trabalho
   feito 372 vezes, e cada célula nova (trocar de ano recarrega a página, mas
   ainda assim) precisaria lembrar de se inscrever. */

(function (EN) {
    "use strict";

    const grade = document.getElementById("diary-grid");
    const editor = document.getElementById("diary-editor");
    if (!grade || !editor) {
        return;
    }

    const titulo = document.getElementById("diary-editor-title");
    const campo = document.getElementById("diary-note");
    const aviso = document.getElementById("diary-status");
    const botaoGuardar = document.getElementById("diary-save");
    const botaoLimpar = document.getElementById("diary-clear");
    const humores = Array.from(editor.querySelectorAll(".diary-mood"));

    const CLASSES_DE_HUMOR = humores.map(function (botao) {
        return "mood-" + botao.dataset.mood;
    });

    let celula = null;
    /* Gravações no ar, para o ao vivo (fim do arquivo) esperar por elas. */
    let guardando = 0;

    function dizer(texto) {
        aviso.textContent = texto;
        aviso.hidden = !texto;
    }

    function humorEscolhido() {
        const marcado = humores.find(function (botao) {
            return botao.getAttribute("aria-pressed") === "true";
        });
        return marcado ? marcado.dataset.mood : "";
    }

    function marcarHumor(slug) {
        humores.forEach(function (botao) {
            botao.setAttribute(
                "aria-pressed",
                botao.dataset.mood === slug ? "true" : "false"
            );
        });
    }

    function abrir(alvo) {
        celula = alvo;
        editor.hidden = false;
        titulo.textContent = alvo.dataset.label;
        campo.value = alvo.dataset.note || "";
        marcarHumor(alvo.dataset.mood || "");
        dizer("");
        campo.focus();
    }

    /* A célula guarda o que o servidor confirmou, e é ela que a próxima
       abertura do editor vai ler — o estado da tela é a própria grade. */
    function aplicar(alvo, entrada) {
        const humor = entrada ? entrada.mood : "";
        const texto = entrada ? entrada.note : "";

        alvo.dataset.mood = humor;
        alvo.dataset.note = texto;
        alvo.classList.remove.apply(alvo.classList, CLASSES_DE_HUMOR);
        if (humor) {
            alvo.classList.add("mood-" + humor);
        }
        alvo.classList.toggle("has-note", Boolean(texto));

        const nome = humores.find(function (botao) {
            return botao.dataset.mood === humor;
        });
        alvo.setAttribute(
            "aria-label",
            alvo.dataset.label + " — " + (nome ? nome.textContent.trim() : "sem registro")
        );
    }

    async function guardar(humor, texto) {
        if (!celula) {
            return;
        }
        const alvo = celula;
        dizer("Guardando…");
        guardando += 1;

        try {
            const resposta = await EN.http.request(
                "/api/diary/" + encodeURIComponent(alvo.dataset.day),
                {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ mood: humor, note: texto }),
                },
                "Não deu para guardar o dia."
            );

            aplicar(alvo, resposta.entry);
            /* Só mexe no editor se ele ainda estiver no mesmo dia: quem tocou
               noutra célula enquanto o pedido subia não pode ver o texto do dia
               anterior voltar por cima do que acabou de abrir. */
            if (celula === alvo) {
                marcarHumor(resposta.entry ? resposta.entry.mood : "");
                campo.value = resposta.entry ? resposta.entry.note : "";
                dizer(resposta.entry ? "Guardado." : "Dia limpo.");
            }
        } catch (erro) {
            dizer(erro.message);
        } finally {
            guardando -= 1;
        }
    }

    /* O editor tem algo que a célula (o que o servidor confirmou) não tem? */
    function editorComMudanca() {
        return Boolean(celula) && !editor.hidden && (
            campo.value !== (celula.dataset.note || "") ||
            humorEscolhido() !== (celula.dataset.mood || "")
        );
    }

    grade.addEventListener("click", function (evento) {
        const alvo = evento.target.closest(".diary-cell");
        if (alvo) {
            abrir(alvo);
        }
    });

    humores.forEach(function (botao) {
        botao.addEventListener("click", function () {
            /* Tocar no humor já marcado tira a marca: sem isso, escolher por
               engano não teria volta a não ser limpando o dia inteiro. */
            marcarHumor(
                botao.getAttribute("aria-pressed") === "true" ? "" : botao.dataset.mood
            );
        });
    });

    botaoGuardar.addEventListener("click", function () {
        guardar(humorEscolhido(), campo.value);
    });

    botaoLimpar.addEventListener("click", function () {
        guardar("", "");
    });

    /* O que muda no celular ou noutra aba: a grade de novo, como o servidor a
       desenha agora. O ouvinte mora em `grade`, que fica; só o miolo troca.
       Espera o que está subindo e o editor com texto ainda não guardado --
       a troca o reescreveria com a versão de lá. */
    if (EN.aoVivo) {
        EN.aoVivo.quando(["diaryEntries"], async function () {
            if (guardando || editorComMudanca()) {
                return false;
            }
            const nova = (await EN.aoVivo.buscarTela()).getElementById("diary-grid");
            if (!nova) {
                return true;
            }
            if (guardando || editorComMudanca()) {
                return false;
            }
            const dia = celula ? celula.dataset.day : null;
            grade.innerHTML = nova.innerHTML;
            /* A célula aberta no editor agora é outro elemento: aponta para o
               novo, e o editor mostra o que ele traz. */
            if (dia) {
                celula = grade.querySelector('.diary-cell[data-day="' + dia + '"]');
                if (celula && !editor.hidden) {
                    campo.value = celula.dataset.note || "";
                    marcarHumor(celula.dataset.mood || "");
                }
            }
            return true;
        });
    }
})(window.EN);
