/* Contexto do planner: referências de DOM + estado mutável compartilhado.

   Todos os módulos recebem este objeto e escrevem nele, reproduzindo o closure
   que existia quando o planner era um arquivo único. */
window.EN = window.EN || {};
EN.planner = EN.planner || {};

(function (planner) {
    "use strict";

    function readPreferences() {
        const zoom = parseInt(localStorage.getItem(planner.STORE.zoom) || "", 10);
        return {
            showWeekend: localStorage.getItem(planner.STORE.weekend) === "1",
            hourHeight: planner.time.clamp(
                zoom || planner.ZOOM.fallback,
                planner.ZOOM.min,
                planner.ZOOM.max
            ),
            range: localStorage.getItem(planner.STORE.compact) === "1"
                ? planner.WORK_RANGE
                : planner.FULL_RANGE,
        };
    }

    /* Devolve o contexto, ou null se a página não é a do planner. */
    planner.createContext = function () {
        const els = {
            panel: document.querySelector(".planner-panel"),
            grid: document.getElementById("planner-grid"),
            head: document.getElementById("planner-head"),
            hours: document.getElementById("planner-hours"),
            canvas: document.getElementById("planner-canvas"),
            scroller: document.querySelector(".planner-scroll"),

            weekendToggle: document.getElementById("planner-weekend"),
            zoomInput: document.getElementById("planner-zoom"),
            compactBtn: document.getElementById("planner-compact"),
            newBtn: document.getElementById("planner-new"),

            modal: document.getElementById("planner-modal"),
            modalTitle: document.getElementById("planner-modal-title"),
            form: document.getElementById("planner-form"),
            titleInput: document.getElementById("planner-title"),
            notesInput: document.getElementById("planner-notes"),
            startInput: document.getElementById("planner-start"),
            endInput: document.getElementById("planner-end"),
            daySelect: document.getElementById("planner-day"),
            dayField: document.getElementById("planner-day-field"),
            routineInput: document.getElementById("planner-routine"),
            deleteBtn: document.getElementById("planner-delete"),
            errorEl: document.getElementById("planner-error"),
        };

        if (!els.panel || !els.grid || !els.canvas || !els.modal) {
            return null;
        }

        const prefs = readPreferences();

        return {
            els: els,
            api: els.panel.dataset.blocksUrl || "/api/planner/blocks",

            blocks: [],
            showWeekend: prefs.showWeekend,
            hourHeight: prefs.hourHeight,
            range: prefs.range,
            selectedId: null,
            editingId: null,
            drag: null,
            nowTimer: null,
        };
    };

    /* Helpers de geometria que dependem do estado atual. */
    planner.view = {
        visibleDays: function (ctx) {
            return ctx.showWeekend ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];
        },

        minuteToPx: function (ctx, minute) {
            return ((minute - ctx.range.start) / 60) * ctx.hourHeight;
        },

        durationToPx: function (ctx, minutes) {
            return (minutes / 60) * ctx.hourHeight;
        },

        findBlock: function (ctx, id) {
            return ctx.blocks.find(function (block) {
                return block.id === id;
            });
        },
    };
})(EN.planner);
