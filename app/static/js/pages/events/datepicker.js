/* Seletor de data do cadastro de eventos.

   O toggle "incluir horário" remonta o flatpickr porque `enableTime` só é lido
   na criação; a data já escolhida é reaplicada para não se perder. */
(function () {
    "use strict";

    document.addEventListener("DOMContentLoaded", function () {
        const input = document.getElementById("event-datetime");
        const includeTimeToggle = document.getElementById("include-time");
        if (!input || typeof flatpickr === "undefined") {
            return;
        }

        let picker;

        function mountPicker(withTime) {
            if (picker) {
                picker.destroy();
            }

            picker = flatpickr(input, {
                locale: "pt",
                enableTime: withTime,
                time_24hr: true,
                dateFormat: withTime ? "Y-m-d\\TH:i" : "Y-m-d",
                altInput: true,
                altFormat: withTime ? "d/m/Y H:i" : "d/m/Y",
                minuteIncrement: 5,
                allowInput: false,
            });
        }

        mountPicker(false);

        if (includeTimeToggle) {
            includeTimeToggle.addEventListener("change", function () {
                const current = picker && picker.selectedDates && picker.selectedDates[0]
                    ? picker.selectedDates[0]
                    : null;
                mountPicker(includeTimeToggle.checked);
                if (current) {
                    picker.setDate(current, true);
                }
            });
        }
    });
})();
