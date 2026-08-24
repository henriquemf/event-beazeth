/* Esqueleto da grade: cabeçalho de dias, régua de horas e colunas. */
window.EN = window.EN || {};
EN.planner = EN.planner || {};

(function (planner) {
    "use strict";

    const time = planner.time;
    const view = planner.view;

    planner.grid = {
        /* Monta a grade inteira. Só é chamado quando dias ou faixa de horas
           mudam; o zoom sozinho não reconstrói DOM (ver toolbar). */
        build: function (ctx) {
            const els = ctx.els;
            const days = view.visibleDays(ctx);
            const today = time.todayIndex();

            els.grid.style.setProperty("--days", days.length);
            els.grid.style.setProperty("--hour-h", ctx.hourHeight + "px");
            els.grid.style.setProperty("--hours-count", (ctx.range.end - ctx.range.start) / 60);
            els.grid.style.setProperty("--view-start", ctx.range.start);
            els.grid.dataset.weekend = ctx.showWeekend ? "on" : "off";

            els.head.innerHTML = days
                .map(function (day) {
                    return (
                        '<div class="planner-day-head' + (day === today ? " is-today" : "") + '">' +
                        '<span class="planner-day-name">' + planner.DAY_LABELS[day] + "</span>" +
                        '<span class="planner-day-abbr">' + planner.DAY_SHORT[day] + "</span>" +
                        "</div>"
                    );
                })
                .join("");

            const hourList = [];
            for (let minute = ctx.range.start; minute < ctx.range.end; minute += 60) {
                hourList.push('<div class="planner-hour"><span>' + time.formatMinute(minute) + "</span></div>");
            }
            els.hours.innerHTML = hourList.join("");

            els.canvas.innerHTML = days
                .map(function (day) {
                    return (
                        '<div class="planner-col' + (day === today ? " is-today" : "") + '" data-day="' + day + '"></div>'
                    );
                })
                .join("");
        },
    };
})(EN.planner);
