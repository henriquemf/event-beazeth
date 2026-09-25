/* Áudio da interface: um único AudioContext para todas as telas.

   Nasceu dentro de ui-effects.js. Saiu de lá quando o pomodoro passou a precisar
   tocar som: dois AudioContext no mesmo documento significam dois desbloqueios
   independentes, e o navegador só libera o que recebeu o gesto do usuário — o
   som do fim do timer simplesmente não sairia em metade das visitas.

   ## Por que gravações, e não mais síntese

   Até aqui tudo era gerado na hora: senos para os avisos e rajadas de ruído
   para as palmas. As palmas eram o problema — 87% da energia delas ficava
   acima de 6 kHz, e ruído agudo em estalos curtos é exatamente o som de um
   fone quebrado. Os senos não chiavam, mas soavam como aparelho de teste.

   Agora são gravações de verdade, todas CC0 (domínio público) do Freesound, com
   a origem de cada uma no README. Foram tratadas uma vez, fora daqui: silêncio
   da frente cortado, grave abaixo de ~120 Hz tirado (alto-falante de celular
   não o reproduz e o transforma em zumbido), nada acima de 10 kHz e volume
   nivelado entre elas. São 87 KB no total, e o service worker as guarda como
   qualquer outro estático.

   As URLs chegam pelo próprio `<script>` deste arquivo, em `data-som-*`, já
   com o `?v=<mtime>` que o Python põe — é por isso que trocar um som não
   deixa ninguém ouvindo o antigo do cache. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    /* `currentScript` só existe enquanto o arquivo roda pela primeira vez;
       depois disso é null. Por isso é lido aqui, e não quando o som toca. */
    const eu = document.currentScript;
    const URLS = {
        clique: eu && eu.dataset.somClique,
        navegar: eu && eu.dataset.somNavegar,
        aviso: eu && eu.dataset.somAviso,
        sino: eu && eu.dataset.somSino,
        aplausos: eu && eu.dataset.somAplausos,
    };

    /* O volume de cada uso. Os arquivos já saem nivelados entre si; isto é o
       quanto cada MOMENTO pede. O clique acontece dezenas de vezes por visita
       e tem de ficar quase abaixo da atenção — um quinto do volume de um aviso. */
    const VOLUME = {
        clique: 0.14,
        navegar: 0.3,
        aviso: 0.7,
        sino: 0.8,
        aplausos: 0.7,
    };

    let ctx = null;
    let pending = [];
    let listening = false;
    const buffers = {};
    const carregando = {};

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
       que valem alguns segundos depois; o clique NÃO passa por aqui. */
    function tocarQuandoPuder(nome) {
        whenReady(function () {
            carregar(nome).then(function (buffer) {
                const audio = context();
                if (buffer && audio) {
                    tocarBuffer(audio, nome, audio.currentTime);
                }
            });
        });
    }

    /* Agenda um som para um instante absoluto (epoch em ms) e devolve o cabo
       para cancelar. `armed` diz se o som já está garantido no relógio do
       contexto; quem detecta o fim consulta isso para não tocar duas vezes. */
    function agendar(epochMs, nome) {
        const handle = { armed: false, cancel: function () {} };
        let cancelled = false;
        let nodes = [];

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

    /* Os dois sons de clique são pedidos logo, porque o primeiro clique da
       visita já quer ouvi-los; os avisos, só depois que a página assenta —
       quase nenhuma visita chega ao fim de um pomodoro nos primeiros segundos. */
    carregar("clique");
    carregar("navegar");
    window.addEventListener("load", function () {
        setTimeout(function () {
            carregar("aviso");
            carregar("sino");
            carregar("aplausos");
        }, 1500);
    });

    EN.audio = {
        /* Clique e navegação. Se o som ainda não chegou, esse clique fica mudo:
           um "tec" que tocasse meio segundo depois pareceria outra coisa. */
        blip: function (type) {
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

        /* Fim do descanso: a caixinha de música. Espera o áudio ser liberado se
           ainda não foi: o aviso continua valendo alguns segundos depois. */
        chime: function () {
            tocarQuandoPuder("sino");
        },

        /* Notificação chegando: a kalimba, o mesmo toque padrão do app.

           NÃO entra na fila de espera de propósito: se o áudio ainda estiver
           travado, um som que só tocasse no próximo clique chegaria fora de
           hora e sem contexto nenhum. Nesse caso fica só o som do sistema, que
           é o que o navegador já toca sozinho.

           Devolve se chegou a tocar, que é o que o teste observa. */
        notify: function () {
            if (!isReady() || !buffers.aviso) {
                return false;
            }
            tocarBuffer(context(), "aviso", context().currentTime);
            return true;
        },

        /* A salva de palmas do fim do foco, agora. */
        palmas: function () {
            tocarQuandoPuder("aplausos");
        },

        /* As palmas num instante absoluto, pelo mesmo motivo de `chimeAt`: em
           aba escondida o `setTimeout` chega a disparar uma vez por minuto, e o
           relógio do WebAudio não é estrangulado. */
        palmasAt: function (epochMs) {
            return agendar(epochMs, "aplausos");
        },

        /* Agenda o fim do descanso para um instante absoluto (epoch em ms).

           O relógio do WebAudio roda numa thread própria, que o navegador não
           estrangula quando a aba fica em segundo plano — ao contrário de
           setTimeout/setInterval, que em aba escondida chegam a disparar uma vez
           por minuto. Sem isto, o som do fim atrasaria minutos em aba oculta. */
        chimeAt: function (epochMs) {
            return agendar(epochMs, "sino");
        },
    };
})(window.EN);
