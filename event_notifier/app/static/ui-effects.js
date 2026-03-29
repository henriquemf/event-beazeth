(function () {
    function createAudioContext() {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
            return null;
        }

        if (!window.__enAudioCtx) {
            window.__enAudioCtx = new AudioCtx();
        }
        return window.__enAudioCtx;
    }

    function playSoftTone(type) {
        const ctx = createAudioContext();
        if (!ctx) {
            return;
        }

        if (ctx.state === "suspended") {
            ctx.resume().catch(function () {});
        }

        const now = ctx.currentTime;
        const master = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        filter.type = "lowpass";
        filter.frequency.value = type === "nav" ? 1300 : 1700;
        filter.Q.value = 0.8;

        master.gain.setValueAtTime(0.0001, now);
        master.gain.exponentialRampToValueAtTime(type === "nav" ? 0.013 : 0.011, now + 0.008);
        master.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

        filter.connect(master);
        master.connect(ctx.destination);

        const tones = type === "nav"
            ? [
                { f: 520, t: 0 },
                { f: 390, t: 0.045 },
            ]
            : [
                { f: 640, t: 0 },
                { f: 520, t: 0.028 },
            ];

        tones.forEach(function (tone) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
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
    }

    function isPrimaryLeftClick(event) {
        return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
    }

    function shouldHandleNavLink(anchor) {
        if (!anchor || !anchor.href) {
            return false;
        }
        if (anchor.target && anchor.target !== "_self") {
            return false;
        }
        if (anchor.hasAttribute("download")) {
            return false;
        }

        const url = new URL(anchor.href, window.location.origin);
        if (url.origin !== window.location.origin) {
            return false;
        }

        return url.pathname !== window.location.pathname || url.search !== window.location.search;
    }

    function initEffects() {
        document.body.classList.add("page-ready");

        document.addEventListener("click", function (event) {
            const clickable = event.target.closest("button, .btn-primary, .btn-danger, .theme-preview, .font-preview, .fc-button");
            if (clickable) {
                playSoftTone("click");
            }

            const anchor = event.target.closest("a.menu-link");
            if (!anchor || !isPrimaryLeftClick(event)) {
                return;
            }
            if (!shouldHandleNavLink(anchor)) {
                return;
            }

            event.preventDefault();
            playSoftTone("nav");
            document.body.classList.add("page-leaving");

            window.setTimeout(function () {
                window.location.href = anchor.href;
            }, 80);
        });
    }

    document.addEventListener("DOMContentLoaded", initEffects);
})();
