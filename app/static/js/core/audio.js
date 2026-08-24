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

    /* Sino do fim do pomodoro: tríade ascendente em seno, ataque lento e cauda
       longa. Volume de propósito baixo (pico 0.075) — é aviso, não alarme. */
    function buildChime(audio, startAt) {
        const master = audio.createGain();
        const filter = audio.createBiquadFilter();

        filter.type = "lowpass";
        filter.frequency.value = 2400;
        filter.Q.value = 0.6;
        filter.connect(master);
        master.gain.value = 1;
        master.connect(audio.destination);

        const notes = [
            { f: 523.25, t: 0 },      // dó
            { f: 659.25, t: 0.19 },   // mi
            { f: 783.99, t: 0.38 },   // sol
        ];

        const nodes = [];
        notes.forEach(function (note, index) {
            /* Duas oscilações por nota: a fundamental e uma oitava abaixo bem
               baixinha, que dá corpo sem aumentar a sensação de volume. */
            [
                { freq: note.f, peak: 0.075, tail: 1.5 },
                { freq: note.f / 2, peak: 0.028, tail: 1.2 },
            ].forEach(function (layer) {
                const osc = audio.createOscillator();
                const gain = audio.createGain();
                const at = startAt + note.t;

                osc.type = "sine";
                osc.frequency.value = layer.freq;

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

        chime: function () {
            whenReady(function () {
                const audio = context();
                if (audio) {
                    buildChime(audio, audio.currentTime);
                }
            });
        },

        /* Agenda o sino para um instante absoluto (epoch em ms).

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
                nodes = buildChime(audio, audio.currentTime + Math.max(delay, 0));
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
