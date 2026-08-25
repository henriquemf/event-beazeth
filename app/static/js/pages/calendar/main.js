/* Tela do calendário: monta o FullCalendar e liga os dois popups.

   Clicar num dia abre o popup já naquela data — era o caminho que antes
   passava pela aba de cadastro, escolher a data de novo no seletor e voltar
   para o calendário para conferir. */
(function (EN) {
    "use strict";

    document.addEventListener("DOMContentLoaded", function () {
        const calendarEl = document.getElementById("events-calendar");
        const monthPicker = document.getElementById("month-picker");

        if (!calendarEl || !monthPicker || typeof FullCalendar === "undefined") {
            return;
        }

        const eventModal = EN.calendarEventModal();
        const tagsModal = EN.calendarTagsModal();
        const popups = [eventModal, tagsModal].filter(Boolean);

        /* Um só handler para os dois popups: o alvo diz qual fechar, e o Escape
           fecha o que estiver aberto. */
        popups.forEach(function (popup) {
            popup.element.addEventListener("click", function (event) {
                const target = event.target;
                if (target && target.dataset && target.dataset.closeModal === "1") {
                    popup.close();
                }
            });
        });

        document.addEventListener("keydown", function (event) {
            if (event.key !== "Escape") {
                return;
            }
            popups.forEach(function (popup) {
                if (popup.element.classList.contains("show")) {
                    popup.close();
                }
            });
        });

        const createButton = document.getElementById("event-create-open");
        if (createButton && eventModal) {
            createButton.addEventListener("click", function () {
                eventModal.openCreate("");
            });
        }

        const tagsButton = document.getElementById("tags-open");
        if (tagsButton && tagsModal) {
            tagsButton.addEventListener("click", tagsModal.open);
        }

        let monthFlatpickr = null;
        if (typeof flatpickr !== "undefined") {
            const monthOptions = {
                locale: "pt",
                dateFormat: "Y-m",
                altInput: true,
                altFormat: "F Y",
                allowInput: false,
            };
            if (typeof monthSelectPlugin !== "undefined") {
                monthOptions.plugins = [new monthSelectPlugin({
                    shorthand: true,
                    dateFormat: "Y-m",
                    altFormat: "F Y",
                })];
            }
            monthFlatpickr = flatpickr(monthPicker, monthOptions);
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
            events: calendarEl.dataset.eventsUrl || "/api/events",
            height: "auto",
            eventTimeFormat: {
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
            },
            eventDidMount: function (info) {
                const props = info.event.extendedProps;
                info.el.title = props.tagLabel + " | " + info.event.title + " | " + (props.description || "-");
            },
            datesSet: function (arg) {
                const refDate = arg.view.currentStart || arg.start;
                const monthValue = refDate.getFullYear() + "-" + String(refDate.getMonth() + 1).padStart(2, "0");
                if (monthFlatpickr) {
                    monthFlatpickr.setDate(monthValue, false, "Y-m");
                } else {
                    monthPicker.value = monthValue;
                }
            },
            dateClick: function (info) {
                if (eventModal) {
                    eventModal.openCreate(info.dateStr);
                }
            },
            eventClick: function (info) {
                if (eventModal) {
                    eventModal.openEdit(info.event);
                }
            },
        });

        monthPicker.addEventListener("change", function () {
            if (monthPicker.value) {
                calendar.gotoDate(monthPicker.value + "-01");
            }
        });

        calendar.render();
    });
})(window.EN);
