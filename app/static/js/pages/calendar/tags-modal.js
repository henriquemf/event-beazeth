/* Popup de tags: lista o que existe e monta a tag nova com prévia ao vivo.

   Criar e remover são POST com redirect, como o resto dos eventos — a página
   recarrega e os rádios de tag do popup de agendamento voltam prontos do
   Python. Manter uma lista de tags em JS seria uma segunda cópia da verdade
   só para evitar um recarregamento. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    EN.calendarTagsModal = function () {
        const modal = document.getElementById("tags-modal");
        const labelField = document.getElementById("tag-label");
        const colorField = document.getElementById("tag-color");
        const chip = document.getElementById("tag-preview");
        const swatches = modal ? modal.querySelectorAll("[data-swatch]") : [];

        if (!modal || !labelField || !colorField || !chip) {
            return null;
        }

        function paintPreview() {
            chip.textContent = labelField.value.trim() || "Nova tag";
            chip.style.setProperty("--tag-color", colorField.value);
        }

        labelField.addEventListener("input", paintPreview);
        colorField.addEventListener("input", paintPreview);

        swatches.forEach(function (button) {
            button.addEventListener("click", function () {
                colorField.value = button.dataset.swatch;
                paintPreview();
            });
        });

        function open() {
            modal.classList.add("show");
            modal.setAttribute("aria-hidden", "false");
            labelField.focus();
        }

        function close() {
            modal.classList.remove("show");
            modal.setAttribute("aria-hidden", "true");
        }

        return { open: open, close: close, element: modal };
    };
})(window.EN);
