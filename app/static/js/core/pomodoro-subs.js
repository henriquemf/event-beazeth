/* Os sub-pomodoros: até dez, além do principal.

   Contam exatamente como o principal -- mesmo ciclo, mesmo descanso, mesmas
   palmas --, porque são feitos com o mesmo motor (`criarMotor`, em
   core/pomodoro.js). Aqui mora só o que é deles: a lista.

   Vivem todos numa chave só, `en_pomodoro_subs`, cada um com o próprio estado
   dentro da própria linha: o evento `storage` entre abas chega uma vez por
   chave, e com onze chaves seriam onze ouvintes fazendo a mesma coisa. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    const SUBS_KEY = "en_pomodoro_subs";
    const MAX_SUBS = 10;
    const MAX_NOME = 24;

    const interno = EN.pomodoro.interno;
    const criarMotor = interno.criarMotor;
    const clampMinutes = interno.clampMinutes;
    const normalizar = interno.normalizar;
    const lerJson = interno.lerJson;
    const gravarJson = interno.gravarJson;
    const agiu = interno.agiu;

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
            id: linha.id,
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
        KEY: SUBS_KEY,

        /* A lista gravada mudou por fora (veio da conta): realinha os motores
           e avisa a tela. */
        adotar: function () {
            adotarGravado();
            avisarLista();
        },

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
            agiu(sub.id);
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
            agiu(id);
        },

        renomear: function (id, nome) {
            const sub = acharSub(id);
            if (!sub) {
                return;
            }
            sub.nome = String(nome || "").slice(0, MAX_NOME);
            gravarLista();
            agiu(id);
        },

        definirMinutos: function (id, minutos) {
            const sub = acharSub(id);
            if (!sub) {
                return;
            }
            sub.minutos = clampMinutes(minutos);
            gravarLista();
            agiu(id);
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

    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState !== "visible") {
            return;
        }
        subs.forEach(function (sub) {
            sub.timer.tick();
        });
    });

    window.addEventListener("storage", function (event) {
        if (event.key === SUBS_KEY) {
            adotarGravado();
            avisarLista();
        }
    });
})(window.EN);
