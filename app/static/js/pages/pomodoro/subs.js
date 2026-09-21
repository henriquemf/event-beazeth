/* Os sub-pomodoros da tela: os cartões, o "+" e o minimizar.

   Nenhuma contagem acontece aqui. Cada cartão é assinante do temporizador do
   seu sub (`EN.pomodoroSubs`), do mesmo jeito que o mostrador grande é
   assinante do principal — por isso um cartão minimizado continua certo, e
   fechar a aba no meio não perde nada.

   O que é DESTA tela e não do motor: qual cartão está minimizado. É estado de
   aparelho e de tela, então mora numa chave própria daqui; o motor não precisa
   saber que existe um chevron. */
(function (EN) {
    "use strict";

    const DOBRADOS_KEY = "en_pomodoro_subs_dobrados";

    const lista = document.getElementById("pomo-sub-list");
    const molde = document.getElementById("pomo-sub-template");
    const mais = document.getElementById("pomo-sub-add");
    const dica = document.getElementById("pomo-subs-hint");
    if (!lista || !molde || !mais) {
        return;
    }

    const ROTULOS = {
        idle: "Começar",
        running: "Pausar",
        paused: "Retomar",
        done: "De novo",
    };

    /* id → { raiz, els, sub, desassinar, visto } */
    const cartoes = {};
    let ordemNaTela = "";

    /* ------------------------------------------------------ o que está dobrado */

    function lerDobrados() {
        try {
            const bruto = JSON.parse(localStorage.getItem(DOBRADOS_KEY));
            return Array.isArray(bruto) ? bruto : [];
        } catch (e) {
            return [];
        }
    }

    let dobrados = lerDobrados();

    function gravarDobrados() {
        try {
            localStorage.setItem(DOBRADOS_KEY, JSON.stringify(dobrados));
        } catch (e) {
            /* Sem cota: a escolha vale só nesta visita. */
        }
    }

    function estaDobrado(id) {
        return dobrados.indexOf(id) !== -1;
    }

    function dobrar(id, dobrar_) {
        dobrados = dobrados.filter(function (outro) {
            return outro !== id;
        });
        if (dobrar_) {
            dobrados.push(id);
        }
        gravarDobrados();
    }

    /* ------------------------------------------------------------- cartão */

    function aplicarDobra(cartao) {
        const aberto = !estaDobrado(cartao.sub.id);
        cartao.raiz.dataset.aberto = String(aberto);
        cartao.els.dobrar.setAttribute("aria-expanded", String(aberto));
        cartao.els.dobrar.setAttribute(
            "aria-label",
            aberto ? "Minimizar este pomodoro" : "Expandir este pomodoro"
        );
    }

    /* Só escreve no DOM quando o valor muda de verdade: o pulso é de 250ms e
       são até dez cartões: sem isto seriam umas 200 escritas por segundo para
       mostrar exatamente o mesmo texto. */
    function pintarSe(cartao, campo, valor, aplicar) {
        if (cartao.visto[campo] === valor) {
            return;
        }
        cartao.visto[campo] = valor;
        aplicar(valor);
    }

    function pintar(cartao, snap) {
        const els = cartao.els;
        const sub = cartao.sub;
        const travado = snap.active && snap.status !== "done";

        pintarSe(cartao, "status", snap.status, function (valor) {
            cartao.raiz.dataset.pomoStatus = valor;
            els.primario.textContent = ROTULOS[valor];
            els.zerar.hidden = !snap.active;
            els.minutos.disabled = travado;
        });
        pintarSe(cartao, "phase", snap.phase, function (valor) {
            cartao.raiz.dataset.pomoPhase = valor;
        });
        pintarSe(cartao, "mode", snap.mode, function (valor) {
            cartao.raiz.dataset.pomoMode = valor;
        });

        /* Parado, o relógio mostra o tempo configurado — é o que vai começar a
           correr no próximo toque. */
        const tempo = EN.pomodoro.format(snap.active ? snap.leftMs : sub.minutos * 60000);
        pintarSe(cartao, "tempo", tempo, function (valor) {
            els.relogio.textContent = valor;
        });

        pintarSe(cartao, "frase", EN.pomodoro.descrever(snap), function (valor) {
            els.frase.textContent = valor;
        });

        cartao.raiz.style.setProperty("--pomo-progress", snap.progress.toFixed(4));
    }

    function montarCartao(sub) {
        const raiz = molde.content.firstElementChild.cloneNode(true);
        const els = {
            nome: raiz.querySelector(".pomo-sub-name"),
            relogio: raiz.querySelector(".pomo-sub-clock"),
            frase: raiz.querySelector(".pomo-sub-state"),
            minutos: raiz.querySelector(".pomo-sub-minutes"),
            primario: raiz.querySelector(".pomo-sub-primary"),
            zerar: raiz.querySelector(".pomo-sub-reset"),
            dobrar: raiz.querySelector('[data-sub-action="fold"]'),
        };
        const cartao = { raiz: raiz, els: els, sub: sub, visto: {}, desassinar: null };

        els.nome.value = sub.nome;
        els.minutos.value = String(sub.minutos);
        aplicarDobra(cartao);

        raiz.addEventListener("click", function (evento) {
            const botao = evento.target.closest("[data-sub-action]");
            if (!botao) {
                return;
            }
            const acao = botao.dataset.subAction;

            if (acao === "fold") {
                dobrar(sub.id, raiz.dataset.aberto === "true");
                aplicarDobra(cartao);
                return;
            }
            if (acao === "remove") {
                EN.pomodoroSubs.remover(sub.id);
                return;
            }
            if (acao === "stop") {
                sub.timer.stop();
                return;
            }

            const snap = sub.timer.snapshot();
            if (snap.status === "running") {
                sub.timer.pause();
            } else if (snap.status === "paused") {
                sub.timer.resume();
            } else {
                sub.timer.start(sub.minutos, els.nome.value);
            }
        });

        els.nome.addEventListener("input", function () {
            EN.pomodoroSubs.renomear(sub.id, els.nome.value);
        });

        /* Mesmo cuidado do campo da tela grande: enquanto a pessoa digita "45",
           o valor passa por "4" — forçar o mínimo a cada tecla transformaria
           isso em 4 minutos. Quem normaliza é o `change`, ao sair do campo. */
        els.minutos.addEventListener("input", function () {
            const digitado = Number(els.minutos.value);
            if (els.minutos.value === "" || !(digitado > 0)) {
                return;
            }
            EN.pomodoroSubs.definirMinutos(sub.id, digitado);
            cartao.visto.tempo = null;
            pintar(cartao, sub.timer.snapshot());
        });

        els.minutos.addEventListener("change", function () {
            EN.pomodoroSubs.definirMinutos(sub.id, els.minutos.value);
            els.minutos.value = String(sub.minutos);
            cartao.visto.tempo = null;
            pintar(cartao, sub.timer.snapshot());
        });

        cartao.desassinar = sub.timer.subscribe(function (snap) {
            pintar(cartao, snap);
        });

        return cartao;
    }

    /* ------------------------------------------------------------- lista */

    function dizerODaDica(quantos) {
        if (!dica) {
            return;
        }
        if (quantos === 0) {
            dica.textContent = "Nenhum por enquanto. O + cria um com o tempo escolhido aqui em cima.";
        } else if (quantos >= EN.pomodoroSubs.MAX) {
            dica.textContent = "São " + EN.pomodoroSubs.MAX + ", o máximo. Remova um para abrir espaço.";
        } else {
            dica.textContent = "Cada um conta o seu, com o mesmo descanso e as mesmas palmas no fim. Cabem " + EN.pomodoroSubs.MAX + ".";
        }
    }

    function reconciliar(subs) {
        const vivos = {};

        subs.forEach(function (sub) {
            vivos[sub.id] = true;
            if (!cartoes[sub.id]) {
                cartoes[sub.id] = montarCartao(sub);
                lista.appendChild(cartoes[sub.id].raiz);
            }
        });

        Object.keys(cartoes).forEach(function (id) {
            if (vivos[id]) {
                return;
            }
            cartoes[id].desassinar();
            cartoes[id].raiz.remove();
            delete cartoes[id];
        });

        /* Reordenar é caro e quase nunca necessário — só muda quando outra aba
           mexeu na lista. Por isso a comparação antes: sem ela, cada pulso do
           relógio remontaria a ordem inteira do DOM. */
        const ordem = subs.map(function (sub) {
            return sub.id;
        }).join(",");
        if (ordem !== ordemNaTela) {
            ordemNaTela = ordem;
            subs.forEach(function (sub) {
                lista.appendChild(cartoes[sub.id].raiz);
            });
        }

        mais.disabled = subs.length >= EN.pomodoroSubs.MAX;
        dizerODaDica(subs.length);
    }

    mais.addEventListener("click", function () {
        /* Nasce com o tempo que está escolhido na tela e parado: dez cartões
           disparando sozinhos porque alguém clicou no + umas vezes seria o
           oposto de ajudar. */
        const novo = EN.pomodoroSubs.criar(EN.pomodoro.escolha());
        if (novo && cartoes[novo.id]) {
            cartoes[novo.id].els.nome.focus();
        }
    });

    EN.pomodoroSubs.subscribe(reconciliar);
})(window.EN);
