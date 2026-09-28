/* O cartão de post-it: montagem e sincronização com o estado. */
window.EN = window.EN || {};
EN.notes = EN.notes || {};

(function (notes) {
    "use strict";

    /* O último conteúdo pintado em cada campo. Comparar com ele evita repintar
       — e repintar é o que perde cursor e seleção de quem está escrevendo. */
    const pintado = new WeakMap();

    notes.card = {
        applyGeometry: function (el, note) {
            el.style.setProperty("--n-x", note.x);
            el.style.setProperty("--n-y", note.y);
            el.style.setProperty("--n-w", note.width);
            el.style.setProperty("--n-h", note.height);
            el.style.setProperty("--n-z", note.z || 1);
        },

        /* O campo acabou de ser editado: o que está nele é a versão atual, e
           o próximo `sync` não tem o que repintar. */
        marcarPintado: function (campo, conteudo) {
            pintado.set(campo, conteudo);
        },

        build: function (note) {
            const el = document.createElement("article");
            el.className = "note";
            el.dataset.id = String(note.id);
            el.tabIndex = 0;
            el.style.setProperty("--n-tilt", notes.tiltFor(note.id));

            /* O campo é um `contenteditable`, e não mais um <textarea>: só ele
               mostra negrito e link no próprio papel. `role="textbox"` e
               `aria-multiline` devolvem ao leitor de tela o que o textarea
               dizia sozinho. */
            el.innerHTML =
                '<div class="note-bar">' +
                    '<span class="note-grip" aria-hidden="true"></span>' +
                    '<div class="note-actions">' +
                        '<button class="note-btn note-bucket" type="button" data-act="bucket"></button>' +
                        '<button class="note-btn" type="button" data-act="palette" aria-label="Trocar cor" aria-expanded="false">🎨</button>' +
                        '<button class="note-btn note-btn-pip" type="button" data-act="pip" aria-label="Abrir em janela flutuante" title="Janela flutuante"' + (notes.pip.suportado ? "" : " hidden") + '>⧉</button>' +
                        '<button class="note-btn note-btn-danger" type="button" data-act="delete" aria-label="Remover post-it">×</button>' +
                    '</div>' +
                '</div>' +
                '<div class="note-text" contenteditable="true" role="textbox" aria-multiline="true"' +
                    ' aria-label="Texto do post-it" data-placeholder="Escreva seu lembrete..." spellcheck="true"></div>' +
                '<div class="note-swatches" hidden>' +
                    notes.COLORS.map(function (color) {
                        return '<button class="note-swatch color-' + color + '" type="button" data-color="' + color + '" aria-label="Cor ' + color + '"></button>';
                    }).join("") +
                '</div>' +
                '<span class="note-curl" aria-hidden="true"></span>' +
                '<span class="note-resize" data-act="resize" aria-hidden="true"></span>';

            return el;
        },

        /* Escreve no DOM só o que mudou: evita perder cursor/seleção do campo. */
        sync: function (el, note) {
            if (el.dataset.color !== note.color) {
                notes.COLORS.forEach(function (color) {
                    el.classList.remove("color-" + color);
                });
                el.classList.add("color-" + note.color);
                el.dataset.color = note.color;
            }

            const campo = el.querySelector(".note-text");
            const emEdicao = campo.ownerDocument.activeElement === campo;
            if (!emEdicao && pintado.get(campo) !== note.content) {
                notes.rich.pintar(campo, notes.rich.ler(note.content));
                pintado.set(campo, note.content);
            }

            const bucketBtn = el.querySelector('[data-act="bucket"]');
            if (bucketBtn.dataset.bucket !== note.bucket) {
                const bucket = notes.bucketOf(note.bucket);
                bucketBtn.dataset.bucket = note.bucket;
                bucketBtn.textContent = bucket.emoji + " " + bucket.label;
                bucketBtn.title = "Mover para a próxima categoria";
            }

            el.querySelectorAll(".note-swatch").forEach(function (swatch) {
                swatch.setAttribute("aria-pressed", String(swatch.dataset.color === note.color));
            });

            notes.card.applyGeometry(el, note);
        },
    };
})(EN.notes);
