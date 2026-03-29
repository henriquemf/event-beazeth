(function () {
    function normalizeDateForInput(dateStr) {
        if (!dateStr) {
            return "";
        }
        return dateStr.length >= 16 ? dateStr.slice(0, 16) : dateStr;
    }

    function formatDateLabel(dateStr) {
        if (!dateStr) {
            return "-";
        }
        const date = new Date(dateStr);
        return date.toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        const calendarEl = document.getElementById("events-calendar");
        const monthPicker = document.getElementById("month-picker");
        const modal = document.getElementById("event-modal");
        const editForm = document.getElementById("event-edit-form");
        const deleteForm = document.getElementById("event-delete-form");
        const previewTag = document.getElementById("event-preview-tag");
        const previewTitle = document.getElementById("event-preview-title");
        const previewTime = document.getElementById("event-preview-time");
        const previewDesc = document.getElementById("event-preview-desc");
        const editTitle = document.getElementById("event-edit-title");
        const editDesc = document.getElementById("event-edit-description");
        const editDatetime = document.getElementById("event-edit-datetime");
        const editTag = document.getElementById("event-edit-tag");

        if (!calendarEl || !monthPicker || !modal || typeof FullCalendar === "undefined") {
            return;
        }

        const eventsUrl = calendarEl.dataset.eventsUrl || "/api/events";

        function openModal() {
            modal.classList.add("show");
            modal.setAttribute("aria-hidden", "false");
        }

        function closeModal() {
            modal.classList.remove("show");
            modal.setAttribute("aria-hidden", "true");
        }

        modal.addEventListener("click", function (event) {
            if (event.target && event.target.dataset && event.target.dataset.closeModal === "1") {
                closeModal();
            }
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && modal.classList.contains("show")) {
                closeModal();
            }
        });

        let monthFlatpickr = null;
        if (typeof flatpickr !== "undefined") {
            const monthOptions = {
                locale: "pt",
                dateFormat: "Y-m",
                altInput: true,
                altFormat: "F de Y",
                allowInput: false,
            };
            if (typeof monthSelectPlugin !== "undefined") {
                monthOptions.plugins = [new monthSelectPlugin({
                    shorthand: true,
                    dateFormat: "Y-m",
                    altFormat: "F de Y",
                })];
            }
            monthFlatpickr = flatpickr(monthPicker, monthOptions);

            flatpickr(editDatetime, {
                locale: "pt",
                enableTime: true,
                time_24hr: true,
                dateFormat: "Y-m-d\\TH:i",
                altInput: true,
                altFormat: "d/m/Y H:i",
                minuteIncrement: 5,
                allowInput: false,
            });
        }

        const calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: "dayGridMonth",
            locale: "pt-br",
            headerToolbar: {
                left: "prev,next today",
                center: "title",
                right: "dayGridMonth,timeGridWeek,timeGridDay",
            },
            buttonText: {
                today: "Hoje",
                month: "Mês",
                week: "Semana",
                day: "Dia",
            },
            events: eventsUrl,
            height: "auto",
            eventTimeFormat: {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            },
            eventDidMount: function (info) {
                const tag = info.event.extendedProps.tagType === "curso" ? "Curso" : "Evento";
                const desc = info.event.extendedProps.description || "-";
                info.el.title = tag + " | " + info.event.title + " | " + desc;
            },
            datesSet: function (arg) {
                const refDate = arg.view.currentStart || arg.start;
                const y = refDate.getFullYear();
                const m = String(refDate.getMonth() + 1).padStart(2, "0");
                const monthValue = y + "-" + m;
                if (monthFlatpickr) {
                    monthFlatpickr.setDate(monthValue, false, "Y-m");
                } else {
                    monthPicker.value = monthValue;
                }
            },
            eventClick: function (info) {
                const ev = info.event;
                const tagType = ev.extendedProps.tagType === "curso" ? "curso" : "evento";
                const tagLabel = tagType === "curso" ? "CURSO" : "EVENTO";

                previewTag.textContent = tagLabel;
                previewTag.className = "event-preview-tag " + (tagType === "curso" ? "tag-curso" : "tag-evento");
                previewTitle.textContent = ev.title;
                previewTime.textContent = formatDateLabel(ev.startStr);
                previewDesc.textContent = ev.extendedProps.description || "-";

                editTitle.value = ev.title || "";
                editDesc.value = ev.extendedProps.description || "";
                if (typeof flatpickr !== "undefined" && editDatetime._flatpickr) {
                    editDatetime._flatpickr.setDate(normalizeDateForInput(ev.startStr), true, "Y-m-d\\TH:i");
                } else {
                    editDatetime.value = normalizeDateForInput(ev.startStr);
                }
                editTag.value = tagType;

                editForm.action = "/events/" + ev.id + "/update";
                deleteForm.action = "/events/" + ev.id + "/delete";
                openModal();
            },
        });

        monthPicker.addEventListener("change", function () {
            if (!monthPicker.value) {
                return;
            }
            calendar.gotoDate(monthPicker.value + "-01");
        });

        calendar.render();
    });
})();
