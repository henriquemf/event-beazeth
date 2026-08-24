/* Conversões de horário do planner. Funções puras, sem estado. */
window.EN = window.EN || {};
EN.planner = EN.planner || {};

(function (planner, utils) {
    "use strict";

    planner.time = {
        clamp: utils.clamp,

        snap: function (minute) {
            return Math.round(minute / planner.SNAP_MINUTES) * planner.SNAP_MINUTES;
        },

        formatMinute: function (minute) {
            const h = Math.floor(minute / 60) % 24;
            const m = minute % 60;
            return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
        },

        parseTimeValue: function (value) {
            const parts = String(value || "").split(":");
            const h = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            if (Number.isNaN(h) || Number.isNaN(m)) {
                return null;
            }
            return h * 60 + m;
        },

        todayIndex: function () {
            return (new Date().getDay() + 6) % 7;
        },
    };
})(EN.planner, EN.utils);
