/* Pomodoro: o motor do temporizador, o principal e os sub-pomodoros.

   Carrega em todas as telas porque o widget vive na sidebar, que é do layout
   base — o timer precisa continuar contando quando o usuário navega para outra
   página. O widget em si mora em core/pomodoro-widget.js: aqui não há DOM
   nenhum, só estado.

   ## Um motor, onze temporizadores

   O principal e os até 10 sub-pomodoros contam exatamente igual: mesmo ciclo,
   mesmo descanso automático, mesmas palmas no fim. Então o motor virou uma
   fábrica — `criarMotor(porta)` devolve um temporizador inteiro, e a "porta" é
   quem sabe onde aquele estado mora. Duplicar a contagem para o sub seria ter
   dois lugares onde consertar o mesmo bug.

   O principal guarda em `en_pomodoro`. Os subs moram em
   `core/pomodoro-subs.js`, montados com o mesmo `criarMotor` daqui.

   O relógio roda no localStorage, e não num fetch:
   - O widget precisa aparecer já pintado a cada navegação. Vindo de fetch, toda
     troca de página teria um buraco na sidebar até a resposta chegar.
   - O que é guardado é `endsAt` (epoch absoluto), não "segundos restantes".
     Assim recarregar a página, dormir a máquina ou trocar de aba não desalinha
     a contagem: ela é sempre recalculada a partir do relógio.

   Mas o pomodoro é da CONTA: o que se começa aqui aparece no celular, e o
   contrário. Quem leva e traz é `core/pomodoro-conta.js`; daqui saem só duas
   coisas para ele. Uma é o aviso de cada AÇÃO de quem está na tela (`aoAgir`).
   A outra é a regra que faz os dois lados chegarem ao mesmo descanso sem
   conversar: ele começa no instante em que o foco acabou, e não quando a aba
   percebeu. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    const KEY = "en_pomodoro";
    const CHOICE_KEY = "en_pomodoro_choice";
    const AUTO_KEY = "en_pomodoro_auto_descanso";
    const PADRAO_MINUTOS = 25;
    const TICK_MS = 250;
    const WARN_MS = 5 * 60 * 1000;
    const MIN_MINUTES = 1;
    const MAX_MINUTES = 600;

    /* Quanto dura o descanso que começa sozinho quando o foco acaba.
       Espelhado em `avisos/Festa.kt` no app Android: os dois têm de dar o
       mesmo número, senão a mesma sessão descansa diferente em cada aparelho. */
    const DESCANSOS = [
        { ate: 30, minutos: 5 },
        { ate: 59, minutos: 10 },
    ];
    const DESCANSO_LONGO = 15;

    /* Quem quer saber de cada ação de quem está na tela: começar, pausar,
       zerar, renomear, trocar o tempo. O que acontece sozinho (o descanso que
       entra, o fim) não passa por aqui -- cada aparelho calcula o seu. */
    const ouvintesDeAcao = [];

    function agiu(id) {
        ouvintesDeAcao.forEach(function (fn) {
            fn(id);
        });
    }

    const VAZIO = { active: false, status: "idle", phase: "normal", mode: "foco", leftMs: 0, totalMs: 0, progress: 0, minutes: 0, label: "" };

    function descansoDe(minutos) {
        const faixa = DESCANSOS.find(function (item) {
            return minutos <= item.ate;
        });
        return faixa ? faixa.minutos : DESCANSO_LONGO;
    }

    /* Se o descanso começa sozinho quando o foco acaba. Ligado por padrão, que
       é a regra do pomodoro e como o app sempre foi.

       Lido do localStorage NA HORA do fim, e não guardado numa variável: assim
       vale a escolha mais recente mesmo que ela tenha sido feita em outra aba
       no meio do foco, sem precisar de ouvinte nenhum. */
    function descansoAutomatico() {
        return lerJson(AUTO_KEY) !== false;
    }

    function clampMinutes(minutes) {
        const value = Math.round(Number(minutes) || 0);
        return Math.min(Math.max(value, MIN_MINUTES), MAX_MINUTES);
    }

    /* Regra pedida: avisar faltando 5 min. Num timer de 3 min isso pintaria a
       tela de alerta desde o primeiro segundo, então abaixo de 5 min o aviso
       passa a valer para os últimos 20% do tempo. */
    function warnAt(totalMs) {
        return totalMs > WARN_MS ? WARN_MS : Math.round(totalMs * 0.2);
    }

    function normalizar(data) {
        const serve = !!data
            && typeof data.totalMs === "number"
            && data.totalMs > 0
            && ["running", "paused", "done"].indexOf(data.status) !== -1;
        if (!serve) {
            return null;
        }
        /* Estado gravado antes de o descanso existir não tem `mode`. Foco
           é o padrão: é o que ele era. */
        data.mode = data.mode === "descanso" ? "descanso" : "foco";
        return data;
    }

    function lerJson(chave) {
        try {
            const raw = localStorage.getItem(chave);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    }

    function gravarJson(chave, valor) {
        try {
            if (valor === null || valor === undefined) {
                localStorage.removeItem(chave);
            } else {
                localStorage.setItem(chave, JSON.stringify(valor));
            }
        } catch (e) {
            /* Modo privado sem cota: o timer segue valendo só nesta página. */
        }
    }

    /* --------------------------------------------------------------- motor */

    /* Um temporizador inteiro. `porta` é `{ ler, gravar }`: o motor não sabe
       (nem precisa saber) se aquele estado é o do principal ou o de um sub. */
    function criarMotor(porta) {
        let state = null;
        let ticker = 0;
        let chime = null;
        const listeners = [];

        function write() {
            porta.gravar(state);
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

        function snapshot() {
            if (!state) {
                return VAZIO;
            }

            const leftMs = leftOf(state);
            const done = state.status === "done" || leftMs <= 0;

            return {
                active: true,
                status: done ? "done" : state.status,
                phase: done ? "done" : (leftMs <= warnAt(state.totalMs) ? "warning" : "normal"),
                mode: state.mode,
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

        function cancelChime() {
            if (chime) {
                chime.cancel();
                chime = null;
            }
        }

        function armChime() {
            cancelChime();
            if (!state || state.status !== "running") {
                return;
            }
            /* Palmas no fim do foco, sino no fim do descanso: são dois fins
               diferentes, e o ouvido precisa saber qual deles chegou sem olhar. */
            chime = state.mode === "descanso"
                ? EN.audio.chimeAt(state.endsAt)
                : EN.audio.palmasAt(state.endsAt);
        }

        /* O foco acabou: começa o descanso.

           Começar sozinho é a regra do pomodoro, e é o padrão: um botão "agora
           descansar" seria só um jeito de esquecer de apertá-lo. Mas há quem
           use o timer para outra coisa que não o ciclo clássico — uma prova,
           um bloco de estudo que segue emendado —, e para essa pessoa o
           descanso entrando sozinho atrapalha. Daí o interruptor da tela
           (`descansoAutomatico`); desligado, o foco termina parado no fim.

           O contrário não vale em caso nenhum: quando o descanso termina, nada
           recomeça. Voltar a focar é decisão de quem está lá. */
        function comecarDescanso() {
            const total = descansoDe(state.minutes) * 60000;
            /* Do instante em que o foco ACABOU, e não de agora: assim o celular,
               que calcula o mesmo descanso a partir do mesmo fim, chega ao
               mesmo segundo. Com a aba dormindo, o descanso pode já ter
               passado -- e aí o próximo pulso o encerra. */
            const fimDoFoco = state.endsAt || Date.now();
            state = {
                status: "running",
                mode: "descanso",
                totalMs: total,
                minutes: total / 60000,
                endsAt: fimDoFoco + total,
                leftMs: total,
                label: state.label || "",
            };
            write();
            armChime();
            startTicker();
        }

        function finish() {
            /* Se o aviso já estava agendado no relógio do WebAudio, ele está
               tocando agora — soltar o handle sem cancelar. Só toca na mão quando
               o agendamento não chegou a acontecer (aba nunca liberou o áudio). */
            const armed = chime && chime.armed;
            const eraFoco = state.mode !== "descanso";
            chime = null;

            /* Sem descanso automático, o foco termina como o descanso termina:
               parado em "Tempo esgotado", no modo foco. A comemoração abaixo
               continua igual — o foco acabou do mesmo jeito. */
            if (eraFoco && descansoAutomatico()) {
                comecarDescanso();
            } else {
                state.status = "done";
                state.leftMs = 0;
                write();
                stopTicker();
            }

            if (!armed) {
                if (eraFoco) {
                    EN.audio.palmas();
                } else {
                    EN.audio.chime();
                }
            }
            /* O confete não é agendável como o som: ele precisa de uma tela na
               frente. Sai aqui, no instante em que a aba percebe o fim — que é
               quando alguém está olhando. */
            if (eraFoco) {
                EN.festa.soltar();
            }
            emit();
        }

        /* Um foco que terminou longe daqui -- com a aba fechada, ou no celular
           -- entra direto no ponto em que estaria, sem som: no descanso, se
           ele ainda corre, ou concluído. Fim de agora (menos de `quieto` ms)
           fica para o pulso, que comemora. */
        function assentar(quieto) {
            if (!state || state.status !== "running" || leftOf(state) > 0) {
                return;
            }
            if (Date.now() - state.endsAt < quieto) {
                return;
            }
            if (state.mode !== "descanso" && descansoAutomatico()) {
                const total = descansoDe(state.minutes) * 60000;
                const fimDoDescanso = state.endsAt + total;
                if (Date.now() < fimDoDescanso) {
                    state = {
                        status: "running",
                        mode: "descanso",
                        totalMs: total,
                        minutes: total / 60000,
                        endsAt: fimDoDescanso,
                        leftMs: total,
                        label: state.label || "",
                    };
                    return;
                }
            }
            state.status = "done";
            state.leftMs = 0;
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

        const timer = {
            snapshot: snapshot,

            start: function (minutes, label) {
                const total = clampMinutes(minutes) * 60000;
                state = {
                    status: "running",
                    mode: "foco",
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
                agiu(porta.id);
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
                agiu(porta.id);
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
                agiu(porta.id);
            },

            stop: function () {
                state = null;
                write();
                cancelChime();
                stopTicker();
                emit();
                agiu(porta.id);
            },

            /* Recalcula agora, sem esperar o próximo pulso. Serve para a aba que
               volta do segundo plano (onde o setInterval é estrangulado). */
            tick: tick,

            /* O estado mudou por fora — outra aba, ou a lista de subs sendo
               realinhada. Relê e se realinha SEM gravar: quem grava é quem
               mudou, e um eco daqui sobrescreveria o que acabou de chegar. */
            recarregar: function () {
                state = normalizar(porta.ler());
                assentar(3000);
                armChime();
                startTicker();
                emit();
            },

            /* Este temporizador deixou de existir (o sub foi removido). Desliga
               pulso e som agendado sem mexer no que está guardado. */
            encerrar: function () {
                cancelChime();
                stopTicker();
                listeners.length = 0;
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

        /* Nascimento: adota o que estava guardado. Acabou com a aba fechada:
           entra no descanso ou concluído, sem som -- o momento passou, e um
           sino ao abrir a página só assustaria. */
        state = normalizar(porta.ler());
        assentar(0);
        if (state && state.status === "running") {
            armChime();
            startTicker();
        }
        write();

        return timer;
    }

    /* ---------------------------------------------------------- principal */

    const principal = criarMotor({
        id: "principal",
        ler: function () {
            return lerJson(KEY);
        },
        gravar: function (estado) {
            gravarJson(KEY, estado);
            /* O CSS revela o widget da sidebar por este atributo, e o bootstrap
               inline já o escreve antes da primeira pintura. */
            document.documentElement.dataset.pomo = estado ? "on" : "off";
        },
    });

    principal.KEY = KEY;
    principal.MIN_MINUTES = MIN_MINUTES;
    principal.MAX_MINUTES = MAX_MINUTES;

    /* "MM:SS", ou "H:MM:SS" quando passa de uma hora. Arredonda para cima
       para o mostrador nunca exibir 00:00 com tempo restante. */
    principal.format = function (ms) {
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
    };

    /* O tempo escolhido na tela. Mora aqui, e não na tela, porque os sub-
       pomodoros nascem com ele: sem isto, a tela e os subs teriam cada um a sua
       cópia do mesmo nome de chave, e trocar um esqueceria o outro. */
    principal.escolha = function () {
        const guardado = parseInt(localStorage.getItem(CHOICE_KEY), 10);
        return clampMinutes(guardado > 0 ? guardado : PADRAO_MINUTOS);
    };

    principal.definirEscolha = function (minutos) {
        gravarJson(CHOICE_KEY, clampMinutes(minutos));
        agiu("principal");
    };

    /* Um interruptor para os onze: o principal e os subs são o mesmo motor, e
       um sub que descansasse diferente do principal seria um "pomodoro igual"
       só no nome. */
    principal.AUTO_KEY = AUTO_KEY;
    principal.descansoAutomatico = descansoAutomatico;
    principal.definirDescansoAutomatico = function (ligado) {
        gravarJson(AUTO_KEY, !!ligado);
        agiu("principal");
    };

    /* Para `core/pomodoro-conta.js`: as chaves e regras que ele precisa para
       ler e escrever o mesmo estado, sem uma segunda cópia delas. */
    principal.CHOICE_KEY = CHOICE_KEY;
    principal.descansoDe = descansoDe;
    principal.normalizar = normalizar;
    principal.aoAgir = function (fn) {
        ouvintesDeAcao.push(fn);
    };

    /* A frase de estado, em português e por extenso. Fica no motor porque a
       tela e cada cartão de sub-pomodoro dizem exatamente a mesma coisa — duas
       cópias sairiam do ar uma da outra na primeira palavra trocada. */
    principal.descrever = function (snap) {
        if (!snap.active) {
            return "Pronto para começar";
        }
        if (snap.mode === "descanso") {
            return snap.status === "paused"
                ? "Descanso pausado em " + principal.format(snap.leftMs)
                : "Descanso até às " + terminaAs(snap.leftMs);
        }
        if (snap.status === "done") {
            return "Tempo esgotado! 🍎";
        }
        if (snap.status === "paused") {
            return "Pausado em " + principal.format(snap.leftMs);
        }
        if (snap.phase === "warning") {
            return "Reta final — termina às " + terminaAs(snap.leftMs);
        }
        return "Focando até às " + terminaAs(snap.leftMs);
    };

    function terminaAs(leftMs) {
        const fim = new Date(Date.now() + leftMs);
        const pad = function (value) {
            return value < 10 ? "0" + value : String(value);
        };
        return pad(fim.getHours()) + ":" + pad(fim.getMinutes());
    }

    EN.pomodoro = principal;

    /* O motor e as regras, para `core/pomodoro-subs.js` montar os outros dez
       com exatamente o mesmo relógio -- e não com uma segunda cópia dele. */
    principal.interno = {
        criarMotor: criarMotor,
        clampMinutes: clampMinutes,
        normalizar: normalizar,
        lerJson: lerJson,
        gravarJson: gravarJson,
        agiu: agiu,
    };

    /* ------------------------------------------------------ inicialização */

    /* Aba em segundo plano tem setInterval estrangulado. Ao voltar, recalcula
       na hora em vez de esperar o próximo pulso. */
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
            principal.tick();
        }
    });

    /* Duas abas abertas ficam em sincronia: quem não fez a mudança recebe o
       evento `storage` e realinha. */
    window.addEventListener("storage", function (event) {
        if (event.key === KEY) {
            principal.recarregar();
        }
    });
})(window.EN);
