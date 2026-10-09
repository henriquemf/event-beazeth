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

        /* Marca no <td> do dia clicado, para o popup não tapar a informação de
           qual dia está sendo agendado. Fica como atributo e não como classe
           porque quem pinta é o CSS do tema do FullCalendar, e o atributo deixa
           claro na inspeção que o estado é nosso e não da biblioteca. */
        let pickedCell = null;

        function clearPickedDay() {
            if (pickedCell) {
                pickedCell.removeAttribute("data-picked");
                pickedCell = null;
            }
        }

        function markPickedDay(dateStr) {
            clearPickedDay();
            pickedCell = calendarEl.querySelector('.fc-daygrid-day[data-date="' + dateStr + '"]');
            if (pickedCell) {
                pickedCell.setAttribute("data-picked", "1");
            }
        }

        const eventModal = EN.calendarEventModal({ onClose: clearPickedDay });
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
                clearPickedDay();
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
                    /* Na grade de semana/dia `dateStr` traz a hora junto, e o
                       seletor da célula do mês espera só a data. */
                    markPickedDay(info.dateStr.slice(0, 10));
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

        /* O que muda no celular ou noutra aba: os eventos da grade e o painel
           "Próximos eventos", que nasce pronto do servidor e é trocado pela
           versão de agora. Com um popup aberto, espera: ele está segurando um
           evento ou uma tag que a troca deixaria para trás. */
        const painel = document.querySelector(".upcoming-panel");
        if (EN.aoVivo) {
            EN.aoVivo.quando(["events", "tags"], async function () {
                const aberto = popups.some(function (popup) {
                    return popup.element.classList.contains("show");
                });
                if (aberto) {
                    return false;
                }
                calendar.refetchEvents();
                const novo = painel && (await EN.aoVivo.buscarTela()).querySelector(".upcoming-panel");
                if (novo) {
                    painel.innerHTML = novo.innerHTML;
                }
                return true;
            });
        }
    });
})(window.EN);
