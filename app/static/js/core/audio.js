/* Áudio da interface: um único AudioContext para todas as telas.

   Nasceu dentro de ui-effects.js. Saiu de lá quando o pomodoro passou a precisar
   tocar som: dois AudioContext no mesmo documento significam dois desbloqueios
   independentes, e o navegador só libera o que recebeu o gesto do usuário — o
   som do fim do timer simplesmente não sairia em metade das visitas.

   Tudo aqui é síntese: nenhum arquivo de áudio para baixar, nenhum request. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    let ctx = null;
    let pending = [];
    let listening = false;

    /* Os dois avisos longos do app. Mesma família (seno macio, filtro passa-
       baixa, volume de aviso e não de alarme) e desenhos opostos de propósito:
       um sobe em três notas, o outro desce em duas. Dá para saber qual dos dois
       tocou sem olhar para a tela. */
    const MOTIFS = {
        /* Fim do pomodoro: tríade maior ascendente, cauda longa. */
        pomodoro: {
            cutoff: 2400,
            layers: [
                { peak: 0.075, tail: 1.5, octave: 1 },
                { peak: 0.028, tail: 1.2, octave: 0.5 },
            ],
            notes: [
                { f: 523.25, t: 0 },     // dó
                { f: 659.25, t: 0.19 },  // mi
                { f: 783.99, t: 0.38 },  // sol
            ],
        },
        /* Notificação: quinta descendente, duas notas, mais curta. Precisa ser
           reconhecível em meio segundo, porque compete com a notificação do
           próprio sistema. */
        notify: {
            cutoff: 2800,
            layers: [
                { peak: 0.062, tail: 1.1, octave: 1 },
                { peak: 0.022, tail: 0.9, octave: 0.5 },
            ],
            /* Lá e ré: quinta descendente que não encosta em nenhuma nota do
               motivo do pomodoro, nem nas oitavas dele. Assim os dois avisos
               não têm como ser confundidos, mesmo ouvidos de longe. */
            notes: [
                { f: 880.00, t: 0 },     // lá
                { f: 587.33, t: 0.16 },  // ré
            ],
        },
    };

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

    /* Monta um motivo no instante `startAt` do relógio do contexto e devolve os
       osciladores criados, para quem agendou poder cancelar. */
    function buildMotif(audio, startAt, motif) {
        const master = audio.createGain();
        const filter = audio.createBiquadFilter();

        filter.type = "lowpass";
        filter.frequency.value = motif.cutoff;
        filter.Q.value = 0.6;
        filter.connect(master);
        master.gain.value = 1;
        master.connect(audio.destination);

        const nodes = [];
        motif.notes.forEach(function (note, index) {
            /* Cada nota sai em duas camadas: a fundamental e uma oitava abaixo
               bem baixinha, que dá corpo sem aumentar a sensação de volume. */
            motif.layers.forEach(function (layer) {
                const osc = audio.createOscillator();
                const gain = audio.createGain();
                const at = startAt + note.t;

                osc.type = "sine";
                osc.frequency.value = note.f * layer.octave;

                gain.gain.setValueAtTime(0.0001, at);
                gain.gain.exponentialRampToValueAtTime(layer.peak * (1 - index * 0.12), at + 0.05);
                gain.gain.exponentialRampToValueAtTime(0.0001, at + layer.tail);

                osc.connect(gain);
                gain.connect(filter);
                osc.start(at);
                osc.stop(at + layer.tail + 0.05);
                nodes.push(osc);
            });
        });

        return nodes;
    }

    function playNow(name) {
        const audio = context();
        if (audio) {
            buildMotif(audio, audio.currentTime, MOTIFS[name]);
        }
    }

    EN.audio = {
        /* Clique e navegação: os dois sons curtos que já existiam. */
        blip: function (type) {
            const audio = context();
            if (!audio) {
                return;
            }
            if (audio.state === "suspended") {
                audio.resume().catch(function () {});
            }

            const now = audio.currentTime;
            const master = audio.createGain();
            const filter = audio.createBiquadFilter();

            filter.type = "lowpass";
            filter.frequency.value = type === "nav" ? 1300 : 1700;
            filter.Q.value = 0.8;

            master.gain.setValueAtTime(0.0001, now);
            master.gain.exponentialRampToValueAtTime(type === "nav" ? 0.013 : 0.011, now + 0.008);
            master.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

            filter.connect(master);
            master.connect(audio.destination);

            const tones = type === "nav"
                ? [{ f: 520, t: 0 }, { f: 390, t: 0.045 }]
                : [{ f: 640, t: 0 }, { f: 520, t: 0.028 }];

            tones.forEach(function (tone) {
                const osc = audio.createOscillator();
                const gain = audio.createGain();
                osc.type = "triangle";
                osc.frequency.setValueAtTime(tone.f, now + tone.t);
                osc.frequency.exponentialRampToValueAtTime(tone.f * 0.96, now + tone.t + 0.045);

                gain.gain.setValueAtTime(0.0001, now + tone.t);
                gain.gain.exponentialRampToValueAtTime(0.8, now + tone.t + 0.004);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.t + 0.07);

                osc.connect(gain);
                gain.connect(filter);
                osc.start(now + tone.t);
                osc.stop(now + tone.t + 0.08);
            });
        },

        /* Fim do pomodoro. Espera o áudio ser liberado se ainda não foi: o
           aviso continua valendo alguns segundos depois. */
        chime: function () {
            whenReady(function () {
                playNow("pomodoro");
            });
        },

        /* Notificação chegando. NÃO entra na fila de espera de propósito: se o
           áudio ainda estiver travado, um som que só tocasse no próximo clique
           chegaria fora de hora e sem contexto nenhum. Nesse caso fica só o som
           do sistema, que é o que o navegador já toca sozinho.

           Devolve se chegou a tocar, que é o que o teste observa. */
        notify: function () {
            if (!isReady()) {
                return false;
            }
            playNow("notify");
            return true;
        },

        /* Agenda o sino do pomodoro para um instante absoluto (epoch em ms).

           O relógio do WebAudio roda numa thread própria, que o navegador não
           estrangula quando a aba fica em segundo plano — ao contrário de
           setTimeout/setInterval, que em aba escondida chegam a disparar uma vez
           por minuto. Sem isto, o som do fim atrasaria minutos em aba oculta.

           `armed` diz se o som já está garantido; quem detecta o fim consulta
           isso para não tocar duas vezes. */
        chimeAt: function (epochMs) {
            const handle = { armed: false, cancel: function () {} };
            let cancelled = false;
            let nodes = [];

            whenReady(function () {
                if (cancelled) {
                    return;
                }
                const audio = context();
                const delay = (epochMs - Date.now()) / 1000;
                /* Já passou faz tempo (aba dormindo): quem detectar toca na hora. */
                if (!audio || delay < -1) {
                    return;
                }
                nodes = buildMotif(audio, audio.currentTime + Math.max(delay, 0), MOTIFS.pomodoro);
                handle.armed = true;
            });

            handle.cancel = function () {
                cancelled = true;
                handle.armed = false;
                nodes.forEach(stopNode);
                nodes = [];
            };

            return handle;
        },
    };
})(window.EN);
