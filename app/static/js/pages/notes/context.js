/* Contexto do quadro: referências de DOM e estado compartilhado. */
window.EN = window.EN || {};
EN.notes = EN.notes || {};

(function (notes) {
    "use strict";

    notes.createContext = function () {
        const els = {
            stage: document.querySelector(".notes-stage"),
            board: document.getElementById("notes-board"),
            filters: document.getElementById("notes-filters"),
            empty: document.getElementById("notes-empty"),
            status: document.getElementById("notes-status"),
            addBtn: document.getElementById("notes-add"),
            tidyBtn: document.getElementById("notes-tidy"),
            count: document.getElementById("notes-count"),
        };

        if (!els.stage || !els.board) {
            return null;
        }

        return {
            els: els,
            items: [],
            elements: new Map(),   // id -> elemento montado
            pending: new Map(),    // id -> { fields, timer }
            cacheTimer: 0,
            filter: notes.readFilter(),
            drag: null,
            offline: false,
        };
    };

    notes.readFilter = function () {
        const stored = localStorage.getItem(notes.FILTER_KEY);
        return stored === "todos" || notes.BUCKET_IDS.indexOf(stored) !== -1 ? stored : "hoje";
    };

    notes.visible = function (ctx) {
        return ctx.filter === "todos"
            ? ctx.items
            : ctx.items.filter(function (note) {
                return note.bucket === ctx.filter;
            });
    };

    notes.find = function (ctx, id) {
        return ctx.items.find(function (note) {
            return note.id === id;
        });
    };

    notes.maxZ = function (ctx) {
        return ctx.items.reduce(function (top, note) {
            return Math.max(top, note.z || 1);
        }, 1);
    };

    notes.setStatus = function (ctx, message) {
        const el = ctx.els.status;
        if (!el) {
            return;
        }
        el.hidden = !message;
        el.textContent = message || "";
    };
})(EN.notes);
