/* O cartão de post-it: montagem e sincronização com o estado. */
window.EN = window.EN || {};
EN.notes = EN.notes || {};

(function (notes) {
    "use strict";

    notes.card = {
        applyGeometry: function (el, note) {
            el.style.setProperty("--n-x", note.x);
            el.style.setProperty("--n-y", note.y);
            el.style.setProperty("--n-w", note.width);
            el.style.setProperty("--n-h", note.height);
            el.style.setProperty("--n-z", note.z || 1);
        },

        build: function (note) {
            const el = document.createElement("article");
            el.className = "note";
            el.dataset.id = String(note.id);
            el.tabIndex = 0;
            el.style.setProperty("--n-tilt", notes.tiltFor(note.id));

            el.innerHTML =
                '<div class="note-bar">' +
                    '<span class="note-grip" aria-hidden="true"></span>' +
                    '<div class="note-actions">' +
                        '<button class="note-btn note-bucket" type="button" data-act="bucket"></button>' +
                        '<button class="note-btn" type="button" data-act="palette" aria-label="Trocar cor" aria-expanded="false">🎨</button>' +
                        '<button class="note-btn note-btn-danger" type="button" data-act="delete" aria-label="Remover post-it">×</button>' +
                    '</div>' +
                '</div>' +
                '<textarea class="note-text" maxlength="2000" placeholder="Escreva seu lembrete..."></textarea>' +
                '<div class="note-swatches" hidden>' +
                    notes.COLORS.map(function (color) {
                        return '<button class="note-swatch color-' + color + '" type="button" data-color="' + color + '" aria-label="Cor ' + color + '"></button>';
                    }).join("") +
                '</div>' +
                '<span class="note-curl" aria-hidden="true"></span>' +
                '<span class="note-resize" data-act="resize" aria-hidden="true"></span>';

            return el;
        },

        /* Escreve no DOM só o que mudou: evita perder cursor/seleção do textarea. */
        sync: function (el, note) {
            if (el.dataset.color !== note.color) {
                notes.COLORS.forEach(function (color) {
                    el.classList.remove("color-" + color);
                });
                el.classList.add("color-" + note.color);
                el.dataset.color = note.color;
            }

            const textarea = el.querySelector(".note-text");
            if (document.activeElement !== textarea && textarea.value !== note.content) {
                textarea.value = note.content;
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
