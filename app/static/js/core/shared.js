/* Namespace e utilitários compartilhados entre as telas.

   O projeto não tem bundler, então os módulos se comunicam por um namespace
   global (`window.EN`) em vez de `import`. Motivo: cada arquivo é servido com
   `?v=<mtime>` e o service worker usa cache-first justamente porque as URLs são
   versionadas. Um `import "./x.js"` estático não carrega a versão, o que faria
   o service worker servir submódulo velho para sempre.

   A ordem de carga é garantida pelas tags `<script defer>`, que executam na
   ordem em que aparecem no HTML. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    EN.utils = {
        clamp: function (value, min, max) {
            return Math.min(Math.max(value, min), max);
        },

        escapeHtml: function (text) {
            return String(text).replace(/[&<>"']/g, function (ch) {
                return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
            });
        },
    };

    EN.http = {
        /* Envelope padrão das APIs: `{ok: false, message}` vira exceção. */
        request: async function (url, options, fallbackMessage) {
            const response = await fetch(url, options);
            const data = await response.json().catch(function () {
                return {};
            });
            if (!response.ok || data.ok === false) {
                throw new Error(data.message || fallbackMessage || "Não foi possível concluir a ação.");
            }
            return data;
        },
    };
})(window.EN);
