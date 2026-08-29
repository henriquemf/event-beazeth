/* Popup de agendamento do calendário: cria e edita no mesmo formulário.

   Um formulário só porque os campos são idênticos nos dois modos; duas cópias
   sairiam de sincronia na primeira mudança de campo. O que troca entre criar e
   editar (título, `action`, prévia, botão de remover) é escrito na abertura.

   O flatpickr é remontado quando "incluir horário" muda porque `enableTime` só
   é lido na criação — a data já escolhida é reaplicada para não se perder. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    function formatDateLabel(dateStr) {
        if (!dateStr) {
            return "-";
        }
        return new Date(dateStr).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    /* O FullCalendar devolve a data com fuso ("2026-03-08T09:00:00-03:00") e o
       flatpickr espera "Y-m-dTH:i". Cortar em 16 caracteres mantém o horário
       local que já veio no texto, sem passar por Date e arriscar um dia a
       menos na conversão. */
    function trimToMinutes(dateStr) {
        if (!dateStr) {
            return "";
        }
        return dateStr.length >= 16 ? dateStr.slice(0, 16) : dateStr;
    }

    EN.calendarEventModal = function (options) {
        const modal = document.getElementById("event-modal");
        const form = document.getElementById("event-form");
        const deleteForm = document.getElementById("event-delete-form");
        const heading = document.getElementById("event-modal-title");
        const preview = document.getElementById("event-preview");
        const previewTag = document.getElementById("event-preview-tag");
        const previewTitle = document.getElementById("event-preview-title");
        const previewTime = document.getElementById("event-preview-time");
        const previewDesc = document.getElementById("event-preview-desc");
        const titleField = document.getElementById("event-title");
        const descField = document.getElementById("event-description");
        const datetimeField = document.getElementById("event-datetime");
        const includeTime = document.getElementById("include-time");

        if (!modal || !form || !datetimeField) {
            return null;
        }

        const createAction = form.dataset.createAction;
        /* Quem abriu precisa saber do fechamento para desmarcar o dia clicado
           na grade — e o fechamento vem de três lados (×, fundo, Escape). Um
           aviso na saída única evita repetir a limpeza nos três. */
        const onClose = (options && options.onClose) || function () {};
        let picker = null;

        function mountPicker(withTime, value) {
            if (typeof flatpickr === "undefined") {
                datetimeField.value = value || "";
                return;
            }
            if (picker) {
                picker.destroy();
            }
            picker = flatpickr(datetimeField, {
                locale: "pt",
                enableTime: withTime,
                time_24hr: true,
                dateFormat: withTime ? "Y-m-d\\TH:i" : "Y-m-d",
                altInput: true,
                altFormat: withTime ? "d/m/Y H:i" : "d/m/Y",
                // 1, e nao 5: as setinhas andam de minuto em minuto e
                // qualquer horario digitado fica como esta. Com 5, "12:22"
                // voltava para 12:20 sozinho.
                minuteIncrement: 1,
                allowInput: false,
            });
            /* `clear()` explícito no caso vazio: `form.reset()` devolve o
               <input> ao valor do atributo, mas o flatpickr guarda a data
               escolhida por fora dele — sem isto, abrir "Criar agendamento"
               depois de ter clicado num dia trazia aquele dia de volta. */
            if (value) {
                picker.setDate(value, false);
            } else {
                picker.clear();
            }
        }

        function currentDate() {
            if (picker && picker.selectedDates && picker.selectedDates[0]) {
                return picker.selectedDates[0];
            }
            return datetimeField.value || null;
        }

        function checkTag(slug) {
            const radio = form.querySelector('input[name="tag_type"][value="' + slug + '"]');
            /* Tag apagada depois do evento ter sido criado: nenhum rádio bate,
               e o primeiro (a tag padrão) fica marcado. */
            (radio || form.querySelector('input[name="tag_type"]')).checked = true;
        }

        function open() {
            modal.classList.add("show");
            modal.setAttribute("aria-hidden", "false");
            titleField.focus();
        }

        function close() {
            modal.classList.remove("show");
            modal.setAttribute("aria-hidden", "true");
            onClose();
        }

        function openCreate(isoDate) {
            /* Clique na grade de semana/dia traz a hora do slot junto
               ("...T09:00:00"); clique no mês traz só a data. O popup já abre
               com "incluir horário" no estado que o clique pediu. */
            const value = trimToMinutes(isoDate || "");
            const withTime = value.length === 16;

            heading.textContent = "Novo agendamento";
            form.action = createAction;
            form.reset();
            preview.hidden = true;
            deleteForm.hidden = true;
            includeTime.checked = withTime;
            mountPicker(withTime, value);
            open();
        }

        function openEdit(event) {
            const props = event.extendedProps;
            const startsWithTime = trimToMinutes(event.startStr).length === 16;

            heading.textContent = "Detalhes do evento";
            previewTag.textContent = props.tagLabel;
            previewTag.style.setProperty("--tag-color", props.tagColor);
            previewTitle.textContent = event.title;
            previewTime.textContent = formatDateLabel(event.startStr);
            previewDesc.textContent = props.description || "-";
            preview.hidden = false;

            titleField.value = event.title || "";
            descField.value = props.description === "-" ? "" : props.description || "";
            includeTime.checked = startsWithTime;
            mountPicker(startsWithTime, trimToMinutes(event.startStr));
            checkTag(props.tagType);

            form.action = "/events/" + event.id + "/update";
            deleteForm.action = "/events/" + event.id + "/delete";
            deleteForm.hidden = false;
            open();
        }

        includeTime.addEventListener("change", function () {
            mountPicker(includeTime.checked, currentDate());
        });

        return { openCreate: openCreate, openEdit: openEdit, close: close, element: modal };
    };
})(window.EN);
