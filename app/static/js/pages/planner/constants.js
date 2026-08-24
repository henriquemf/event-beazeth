/* Constantes do weekly planner. */
window.EN = window.EN || {};
EN.planner = EN.planner || {};

(function (planner) {
    "use strict";

    planner.SNAP_MINUTES = 15;
    planner.MIN_DURATION = 15;
    planner.DAY_MINUTES = 1440;
    planner.ROUTINE_DAY = -1;

    planner.DAY_LABELS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
    planner.DAY_SHORT = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

    planner.STORE = {
        weekend: "en_planner_weekend",
        zoom: "en_planner_zoom",
        compact: "en_planner_compact",
    };

    planner.FULL_RANGE = { start: 0, end: planner.DAY_MINUTES };
    planner.WORK_RANGE = { start: 360, end: 1380 };

    planner.ZOOM = { min: 28, max: 110, fallback: 52 };
})(EN.planner);
