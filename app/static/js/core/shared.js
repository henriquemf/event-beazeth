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

    /* Confirmação de formulário destrutivo, por atributo.

       Era `onsubmit="return confirm(...)"` no HTML, em três lugares. Saiu
       porque a Content-Security-Policy recusa manipulador inline — e recusa
       CALADA: o formulário continuava enviando, só que sem perguntar nada.
       Um "excluir" que deixou de confirmar é pior do que um que não funciona.

       De quebra, a mensagem agora é dado (`data-confirmar`) e a regra é uma
       só, em vez de três cópias da mesma linha. */
    document.addEventListener("submit", function (event) {
        const pergunta = event.target && event.target.dataset
            ? event.target.dataset.confirmar
            : null;
        if (pergunta && !window.confirm(pergunta)) {
            event.preventDefault();
        }
    });

    /* CSS que carrega sem bloquear a pintura.

       Mesmo caso: era `onload="this.media='all'"` no `<link>`. A folha entra
       como `media="print"` (o navegador baixa sem bloquear) e vira `all`
       quando termina. Sob CSP, o handler inline não rodava e a folha ficava
       para sempre em "print" — na tela de Aparência, isso deixava as 18
       fontes de preview sem carregar.

       O `if` cobre a folha que já chegou antes deste script rodar. */
    document.querySelectorAll("link[data-ativar-ao-carregar]").forEach(function (folha) {
        if (folha.sheet) {
            folha.media = "all";
        } else {
            folha.addEventListener("load", function () {
                folha.media = "all";
            });
        }
    });
})(window.EN);
