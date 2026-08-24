/* Efeitos de interface: som de clique/navegação e a liberação das transições
   depois do primeiro quadro.

   A síntese de áudio saiu daqui para core/audio.js quando o pomodoro passou a
   precisar do mesmo AudioContext. */
(function () {
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

        // Libera as transições só depois do primeiro quadro pintado, para que
        // estados restaurados de localStorage não apareçam animando.
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                document.documentElement.classList.remove("en-preload");
            });
        });

        document.addEventListener("click", function (event) {
            const clickable = event.target.closest("button, .btn-primary, .btn-danger, .theme-preview, .font-preview, .fc-button");
            if (clickable) {
                EN.audio.blip("click");
            }

            const anchor = event.target.closest("a.menu-link");
            if (!anchor || !isPrimaryLeftClick(event) || !shouldHandleNavLink(anchor)) {
                return;
            }

            // Navegação segue nativa (sem preventDefault + setTimeout): o atraso
            // de 80ms por clique era o que dava a sensação de travado. A transição
            // visual fica por conta de @view-transition no CSS.
            EN.audio.blip("nav");
            document.body.classList.add("page-leaving");
        });
    }

    document.addEventListener("DOMContentLoaded", initEffects);
})();
