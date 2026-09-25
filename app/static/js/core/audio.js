/* Áudio da interface: um único AudioContext para todas as telas.

   Nasceu dentro de ui-effects.js. Saiu de lá quando o pomodoro passou a precisar
   tocar som: dois AudioContext no mesmo documento significam dois desbloqueios
   independentes, e o navegador só libera o que recebeu o gesto do usuário — o
   som do fim do timer simplesmente não sairia em metade das visitas.

   ## Os sons são gravações sem perda, e sem chiado

   Marimba, vibrafone e glockenspiel são notas gravadas em estúdio pela
   Universidade de Iowa (AIFF, livres para qualquer uso); as gotas e os cliques
   são da Kenney (CC0), feitos digitalmente; as palmas, um WAV CC0 do Commons.
   Foram tratados uma vez, fora daqui: o chiado de gravação medido no silêncio
   antes de cada nota e subtraído, tudo abaixo de −70 dB virando zero digital,
   e saída em FLAC — sem perda nenhuma no caminho. Medido, o chiado de todos os
   sons musicais ficou abaixo de −97 dBFS. A origem de cada um está no README.

   As URLs chegam pelo próprio `<script>` deste arquivo, em `data-som-*`, já
   com o `?v=<mtime>` que o Python põe — é por isso que trocar um som não
   deixa ninguém ouvindo o antigo do cache.

   ## Cada momento tem o seu som, e a escolha é deste aparelho

   Água, agenda, fim do foco, fim do descanso e cliques: cada um toca o que
   foi escolhido na tela de Aparência, guardado em `en_sons` no localStorage —
   como o tema, é do aparelho, e não da conta. O padrão de cada um mora AQUI
   (`PADRAO`), e não na tela: quem toca é quem precisa saber o que tocar quando
   nada foi escolhido. É o mesmo padrão do app Android (`Canal.somPadrao`). */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    /* `currentScript` só existe enquanto o arquivo roda pela primeira vez;
       depois disso é null. Por isso é lido aqui, e não quando o som toca. */
    const eu = document.currentScript;
    const dados = eu ? eu.dataset : {};
    const URLS = {
        marimba: dados.somMarimba,
        vibrafone: dados.somVibrafone,
        sininho: dados.somSininho,
        gotinha: dados.somGotinha,
        festa_marimba: dados.somFestaMarimba,
        aplausos: dados.somAplausos,
        clique: dados.somClique,
        navegar: dados.somNavegar,
    };

    /* O volume de cada arquivo. Os avisos já saem nivelados entre si; o clique
       acontece dezenas de vezes por visita e tem de ficar quase abaixo da
       atenção. */
    const VOLUME = {
        marimba: 0.7,
        vibrafone: 0.8,
        sininho: 0.7,
        gotinha: 0.7,
        festa_marimba: 0.7,
        aplausos: 0.7,
        clique: 0.5,
        navegar: 0.3,
    };

    /* O som de fábrica de cada momento. Espelha `Canal.somPadrao` e
       `SomDaFesta.PADRAO` em avisos/ no app Android. Um diferente para cada de
       propósito: dá para saber o que chegou sem olhar para a tela. */
    const PADRAO = {
        agua: "gotinha",
        agenda: "sininho",
        foco: "festa_marimba",
        descanso: "vibrafone",
        cliques: "ligados",
    };
    const SONS_KEY = "en_sons";
    const MUDO = "mudo";

    let ctx = null;
    let pending = [];
    let listening = false;
    const buffers = {};
    const carregando = {};
    let previa = null;

    /* ----------------------------------------------------------- escolhas */

    function escolhas() {
        try {
            const salvo = JSON.parse(localStorage.getItem(SONS_KEY));
            return salvo && typeof salvo === "object" ? salvo : {};
        } catch (e) {
            return {};
        }
    }

    /* O som de um momento: o escolhido, se ainda existir; senão o padrão. Uma
       chave de um som que saiu da lista cai no padrão em vez de calar. */
    function escolha(momento) {
        const salvo = escolhas()[momento];
        const valido = salvo === MUDO
            || (momento === "cliques" ? salvo === "ligados" : !!URLS[salvo]);
        return valido ? salvo : PADRAO[momento];
    }

    /* A chave de ARQUIVO a tocar num momento, ou null para silêncio. */
    function arquivoDe(momento) {
        const som = escolha(momento);
        return som === MUDO || som === "ligados" ? null : som;
    }

    /* ------------------------------------------------------------- motor */

    function context() {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
            return null;
        }
        if (!ctx) {
            ctx = new AudioCtx();
        }
        return ctx;
    }

    function isReady() {
        const audio = context();
        return !!audio && audio.state === "running";
    }

    /* Quem decodifica é um contexto OFFLINE, que nunca toca nada. O contexto de
       verdade, criado antes de um gesto, faz o navegador reclamar de autoplay
       no console; este não. E um AudioBuffer não pertence a contexto nenhum:
       decodificado aqui, toca no outro (que reamostra se as taxas diferirem). */
    let decodificador = null;

    function decodificadorOffline() {
        const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!decodificador && Offline) {
            decodificador = new Offline(1, 1, 48000);
        }
        return decodificador;
    }

    /* Baixa e decodifica um som, uma vez só. Devolve a promessa do buffer —
       quem chamar de novo recebe a mesma, e não um segundo download. Como não
       depende de gesto, o buffer já está pronto quando o primeiro clique
       libera o áudio. */
    function carregar(nome) {
        if (!nome) {
            return Promise.resolve(null);
        }
        if (carregando[nome]) {
            return carregando[nome];
        }
        const audio = decodificadorOffline();
        if (!audio || !URLS[nome]) {
            return Promise.resolve(null);
        }
        carregando[nome] = fetch(URLS[nome])
            .then(function (resposta) {
                return resposta.ok ? resposta.arrayBuffer() : Promise.reject(resposta.status);
            })
            .then(function (bytes) {
                /* A forma de callback, e não a de promessa: o Safari antigo só
                   conhece esta, e a de promessa nele simplesmente não resolve. */
                return new Promise(function (resolve, reject) {
                    audio.decodeAudioData(bytes, resolve, reject);
                });
            })
            .then(function (buffer) {
                buffers[nome] = buffer;
                return buffer;
            })
            .catch(function () {
                /* Sem rede na primeira visita: fica sem som, e a próxima
                   tentativa baixa de novo em vez de lembrar do fracasso. */
                delete carregando[nome];
                return null;
            });
        return carregando[nome];
    }

    /* O navegador só deixa tocar depois de um gesto. Enquanto não vem, a fila
       espera; no primeiro clique/tecla tudo o que ficou pendente roda. */
    function listenForGesture() {
        if (listening) {
            return;
        }
        listening = true;

        const wake = function () {
            const audio = context();
            if (!audio) {
                return;
            }
            audio.resume().then(function () {
                const queued = pending;
                pending = [];
                queued.forEach(function (fn) {
                    fn();
                });
            }).catch(function () {});
        };

        ["pointerdown", "keydown", "touchstart"].forEach(function (type) {
            document.addEventListener(type, wake, { once: true, passive: true, capture: true });
        });
    }

    /* Executa agora se o contexto já está liberado; senão, no primeiro gesto. */
    function whenReady(fn) {
        const audio = context();
        if (!audio) {
            return;
        }
        if (audio.state === "running") {
            fn();
            return;
        }
        pending.push(fn);
        audio.resume().then(function () {
            const index = pending.indexOf(fn);
            if (index !== -1) {
                pending.splice(index, 1);
                fn();
            }
        }).catch(function () {});
        listenForGesture();
    }

    function stopNode(node) {
        try {
            node.stop();
        } catch (e) {
            /* Nó já encerrado: nada a fazer. */
        }
    }

    /* Põe um buffer para tocar no instante `quando` do relógio do contexto e
       devolve a fonte, para quem agendou poder cancelar. */
    function tocarBuffer(audio, nome, quando) {
        const fonte = audio.createBufferSource();
        const volume = audio.createGain();
        fonte.buffer = buffers[nome];
        volume.gain.value = VOLUME[nome];
        fonte.connect(volume);
        volume.connect(audio.destination);
        fonte.start(quando);
        return [fonte];
    }

    /* Toca agora, esperando o download se ainda não terminou. Para os avisos
       que valem alguns segundos depois; o clique NÃO passa por aqui. Devolve a
       promessa das fontes, para a prévia poder parar a anterior. */
    function tocarQuandoPuder(nome) {
        return new Promise(function (resolve) {
            if (!nome) {
                resolve([]);
                return;
            }
            whenReady(function () {
                carregar(nome).then(function (buffer) {
                    const audio = context();
                    resolve(buffer && audio ? tocarBuffer(audio, nome, audio.currentTime) : []);
                });
            });
        });
    }

    /* Agenda um som para um instante absoluto (epoch em ms) e devolve o cabo
       para cancelar. `armed` diz se o som já está garantido no relógio do
       contexto; quem detecta o fim consulta isso para não tocar duas vezes.

       O som é o escolhido NA HORA de agendar: trocar a escolha com um timer
       já correndo vale para o próximo, não para este. */
    function agendar(epochMs, nome) {
        const handle = { armed: false, cancel: function () {} };
        let cancelled = false;
        let nodes = [];

        if (!nome) {
            return handle;
        }

        whenReady(function () {
            carregar(nome).then(function (buffer) {
                const audio = context();
                const delay = (epochMs - Date.now()) / 1000;
                /* Já passou faz tempo (aba dormindo): quem detectar toca na hora. */
                if (cancelled || !buffer || !audio || delay < -1) {
                    return;
                }
                nodes = tocarBuffer(audio, nome, audio.currentTime + Math.max(delay, 0));
                handle.armed = true;
            });
        });

        handle.cancel = function () {
            cancelled = true;
            handle.armed = false;
            nodes.forEach(stopNode);
            nodes = [];
        };

        return handle;
    }

    /* Os sons de clique são pedidos logo, porque o primeiro clique da visita
       já quer ouvi-los; os avisos, só depois que a página assenta — e só os
       ESCOLHIDOS: os outros só descem se alguém for ouvi-los na Aparência. */
    if (escolha("cliques") !== MUDO) {
        carregar("clique");
        carregar("navegar");
    }
    window.addEventListener("load", function () {
        setTimeout(function () {
            ["agua", "agenda", "foco", "descanso"].forEach(function (momento) {
                carregar(arquivoDe(momento));
            });
        }, 1500);
    });

    EN.audio = {
        MUDO: MUDO,

        /* O som escolhido para um momento, já com o padrão aplicado. */
        escolha: escolha,

        /* Grava a escolha de um momento. Os outros momentos não mudam. */
        escolher: function (momento, som) {
            const todas = escolhas();
            todas[momento] = som;
            try {
                localStorage.setItem(SONS_KEY, JSON.stringify(todas));
            } catch (e) {
                /* Modo privado sem cota: vale só até a página fechar. */
            }
            carregar(arquivoDe(momento));
        },

        /* A prévia da tela de Aparência: toca um arquivo agora, parando a
           prévia anterior — duas de uma vez não deixam julgar nenhuma. */
        ouvir: function (nome) {
            if (previa) {
                previa.then(function (fontes) {
                    fontes.forEach(stopNode);
                });
            }
            previa = tocarQuandoPuder(nome);
        },

        /* Clique e navegação. Se o som ainda não chegou, esse clique fica mudo:
           um "tec" que tocasse meio segundo depois pareceria outra coisa. */
        blip: function (type) {
            if (escolha("cliques") === MUDO) {
                return;
            }
            const nome = type === "nav" ? "navegar" : "clique";
            const audio = context();
            if (!audio || !buffers[nome]) {
                return;
            }
            if (audio.state === "suspended") {
                audio.resume().catch(function () {});
            }
            tocarBuffer(audio, nome, audio.currentTime);
        },

        /* Fim do descanso, agora. Espera o áudio ser liberado se ainda não foi:
           o aviso continua valendo alguns segundos depois. */
        chime: function () {
            tocarQuandoPuder(arquivoDe("descanso"));
        },

        /* Notificação chegando com a aba aberta. A `tag` do push diz de que é:
           `hydration-reminder` é a água, o resto (`event-…`, `live-…`) é a
           agenda — ver `scheduler_service.py`.

           NÃO entra na fila de espera de propósito: se o áudio ainda estiver
           travado, um som que só tocasse no próximo clique chegaria fora de
           hora e sem contexto nenhum. Nesse caso fica só o som do sistema, que
           é o que o navegador já toca sozinho.

           Devolve se chegou a tocar, que é o que o teste observa. */
        notify: function (tag) {
            const momento = /^hydration/.test(tag || "") ? "agua" : "agenda";
            const nome = arquivoDe(momento);
            if (!nome || !isReady() || !buffers[nome]) {
                return false;
            }
            tocarBuffer(context(), nome, context().currentTime);
            return true;
        },

        /* O som da festa do fim do foco, agora. */
        palmas: function () {
            tocarQuandoPuder(arquivoDe("foco"));
        },

        /* A festa num instante absoluto, pelo mesmo motivo de `chimeAt`: em
           aba escondida o `setTimeout` chega a disparar uma vez por minuto, e o
           relógio do WebAudio não é estrangulado. */
        palmasAt: function (epochMs) {
            return agendar(epochMs, arquivoDe("foco"));
        },

        /* Agenda o fim do descanso para um instante absoluto (epoch em ms).

           O relógio do WebAudio roda numa thread própria, que o navegador não
           estrangula quando a aba fica em segundo plano — ao contrário de
           setTimeout/setInterval, que em aba escondida chegam a disparar uma vez
           por minuto. Sem isto, o som do fim atrasaria minutos em aba oculta. */
        chimeAt: function (epochMs) {
            return agendar(epochMs, arquivoDe("descanso"));
        },
    };
})(window.EN);
