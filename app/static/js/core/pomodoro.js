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

   O principal guarda em `en_pomodoro`; os subs vivem todos numa lista só, em
   `en_pomodoro_subs`, cada um com o próprio estado dentro da própria linha.
   Uma chave só para os subs porque o evento `storage` entre abas chega uma vez
   por chave: com onze chaves seriam onze ouvintes fazendo a mesma coisa.

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
    const SUBS_KEY = "en_pomodoro_subs";
    const CHOICE_KEY = "en_pomodoro_choice";
    const AUTO_KEY = "en_pomodoro_auto_descanso";
    const PADRAO_MINUTOS = 25;
    const MAX_SUBS = 10;
    const MAX_NOME = 24;
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
            state = {
                status: "running",
                mode: "descanso",
                totalMs: total,
                minutes: total / 60000,
                endsAt: Date.now() + total,
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

            /* Recalcula agora, sem esperar o próximo pulso. Serve para a aba que
               volta do segundo plano (onde o setInterval é estrangulado). */
            tick: tick,

            /* O estado mudou por fora — outra aba, ou a lista de subs sendo
               realinhada. Relê e se realinha SEM gravar: quem grava é quem
               mudou, e um eco daqui sobrescreveria o que acabou de chegar. */
            recarregar: function () {
                state = normalizar(porta.ler());
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

        /* Nascimento: adota o que estava guardado. */
        state = normalizar(porta.ler());
        if (state && state.status === "running") {
            if (leftOf(state) <= 0) {
                /* Acabou com a aba fechada: já entra como concluído, sem som — o
                   momento passou e um sino ao abrir a página só assustaria. */
                state.status = "done";
                state.leftMs = 0;
            } else {
                armChime();
                startTicker();
            }
        }
        write();

        return timer;
    }

    /* ---------------------------------------------------------- principal */

    const principal = criarMotor({
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
    };

    /* Um interruptor para os onze: o principal e os subs são o mesmo motor, e
       um sub que descansasse diferente do principal seria um "pomodoro igual"
       só no nome. */
    principal.AUTO_KEY = AUTO_KEY;
    principal.descansoAutomatico = descansoAutomatico;
    principal.definirDescansoAutomatico = function (ligado) {
        gravarJson(AUTO_KEY, !!ligado);
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

    /* --------------------------------------------------- sub-pomodoros */

    /* Cada linha é `{ id, nome, minutos, estado, timer }`. `estado` é o que vai
       para o localStorage; `timer` é o motor vivo e não é serializado. */
    let subs = [];
    const ouvintesDaLista = [];
    let carregando = true;

    function quantosCorrendo() {
        return subs.filter(function (sub) {
            return sub.timer && sub.timer.snapshot().status === "running";
        }).length;
    }

    function avisarLista() {
        ouvintesDaLista.forEach(function (fn) {
            fn(subs);
        });
    }

    /* Chamado a cada transição de qualquer sub (é o `gravar` da porta deles) e
       também quando a lista muda de tamanho ou de nome. Ou seja: NÃO roda a
       cada pulso do relógio — só quando algo de verdade mudou. */
    function gravarLista() {
        if (carregando) {
            return;
        }
        gravarJson(SUBS_KEY, subs.map(function (sub) {
            return { id: sub.id, nome: sub.nome, minutos: sub.minutos, estado: sub.estado };
        }));
        document.documentElement.dataset.pomoSubs = String(quantosCorrendo());
        avisarLista();
    }

    function acharSub(id) {
        return subs.filter(function (sub) {
            return sub.id === id;
        })[0] || null;
    }

    function nascer(linha) {
        const sub = {
            id: linha.id,
            nome: String(linha.nome || "").slice(0, MAX_NOME),
            minutos: clampMinutes(linha.minutos),
            estado: normalizar(linha.estado),
            timer: null,
        };
        sub.timer = criarMotor({
            ler: function () {
                return sub.estado;
            },
            gravar: function (estado) {
                sub.estado = estado;
                gravarLista();
            },
        });
        return sub;
    }

    function novoId() {
        return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    }

    /* Realinha a lista com o que está gravado — usado no nascimento e quando
       outra aba mexeu. Reaproveita os motores que continuam existindo: recriar
       todos derrubaria as assinaturas da tela a cada tecla digitada num nome. */
    function adotarGravado() {
        const guardado = lerJson(SUBS_KEY);
        const linhas = Array.isArray(guardado) ? guardado.slice(0, MAX_SUBS) : [];
        const antigos = subs;
        const vivos = {};

        /* Enquanto adota, ninguém grava. Um motor recém-nascido grava o próprio
           estado ao nascer, e nesse instante `subs` ainda é a lista velha: a
           gravação sairia SEM o sub que acabou de chegar da outra aba e a
           apagaria de volta lá. */
        carregando = true;

        subs = linhas.filter(function (linha) {
            return linha && linha.id;
        }).map(function (linha) {
            vivos[linha.id] = true;
            const sub = acharSub(linha.id);
            if (!sub) {
                return nascer(linha);
            }
            sub.nome = String(linha.nome || "").slice(0, MAX_NOME);
            sub.minutos = clampMinutes(linha.minutos);
            sub.estado = normalizar(linha.estado);
            sub.timer.recarregar();
            return sub;
        });

        antigos.forEach(function (sub) {
            if (!vivos[sub.id]) {
                sub.timer.encerrar();
            }
        });

        carregando = false;
        document.documentElement.dataset.pomoSubs = String(quantosCorrendo());
    }

    EN.pomodoroSubs = {
        MAX: MAX_SUBS,
        MAX_NOME: MAX_NOME,

        lista: function () {
            return subs.slice();
        },

        correndo: quantosCorrendo,

        /* Nasce com o tempo do principal: é o que "um pomodoro igual" quer
           dizer. Devolve a linha nova, ou null quando os 10 já estão de pé. */
        criar: function (minutos, nome) {
            if (subs.length >= MAX_SUBS) {
                return null;
            }
            const sub = nascer({ id: novoId(), nome: nome || "", minutos: minutos });
            subs.push(sub);
            gravarLista();
            return sub;
        },

        remover: function (id) {
            const sub = acharSub(id);
            if (!sub) {
                return;
            }
            sub.timer.encerrar();
            subs = subs.filter(function (item) {
                return item !== sub;
            });
            gravarLista();
        },

        renomear: function (id, nome) {
            const sub = acharSub(id);
            if (!sub) {
                return;
            }
            sub.nome = String(nome || "").slice(0, MAX_NOME);
            gravarLista();
        },

        definirMinutos: function (id, minutos) {
            const sub = acharSub(id);
            if (!sub) {
                return;
            }
            sub.minutos = clampMinutes(minutos);
            gravarLista();
        },

        /* Avisa quando a lista muda: alguém entrou, alguém saiu, alguém trocou
           de nome ou algum deles começou/parou de contar. */
        subscribe: function (fn) {
            ouvintesDaLista.push(fn);
            fn(subs);
            return function () {
                const index = ouvintesDaLista.indexOf(fn);
                if (index !== -1) {
                    ouvintesDaLista.splice(index, 1);
                }
            };
        },
    };

    /* ------------------------------------------------------ inicialização */

    adotarGravado();

    /* Aba em segundo plano tem setInterval estrangulado. Ao voltar, recalcula
       na hora em vez de esperar o próximo pulso. */
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState !== "visible") {
            return;
        }
        principal.tick();
        subs.forEach(function (sub) {
            sub.timer.tick();
        });
    });

    /* Duas abas abertas ficam em sincronia: quem não fez a mudança recebe o
       evento `storage` e realinha. */
    window.addEventListener("storage", function (event) {
        if (event.key === KEY) {
            principal.recarregar();
        } else if (event.key === SUBS_KEY) {
            adotarGravado();
            avisarLista();
        }
    });
})(window.EN);
