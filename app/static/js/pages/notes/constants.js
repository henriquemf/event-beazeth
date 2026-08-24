/* Constantes do quadro de post-its. */
window.EN = window.EN || {};
EN.notes = EN.notes || {};

(function (notes) {
    "use strict";

    notes.API = "/api/notes";
    notes.CACHE_KEY = "en_notes_cache";
    notes.FILTER_KEY = "en_notes_filter";

    notes.COLORS = ["sun", "rose", "mint", "blue", "peach", "lavender"];

    notes.BUCKETS = [
        { id: "hoje", label: "Hoje", emoji: "☀️" },
        { id: "amanha", label: "Amanhã", emoji: "🌙" },
        { id: "semana", label: "Semana", emoji: "🗓️" },
        { id: "ideias", label: "Ideias", emoji: "💡" },
    ];

    notes.BUCKET_IDS = notes.BUCKETS.map(function (bucket) {
        return bucket.id;
    });

    /* Espelham os limites validados em app/db/notes.py (NOTE_BOUNDS). */
    notes.LIMITS = { minW: 150, maxW: 560, minH: 120, maxH: 560, maxX: 4000, maxY: 6000 };

    notes.GAP = 18;
    notes.DRAG_THRESHOLD = 4;
    notes.SAVE_DELAY = 420;
    notes.CACHE_DELAY = 900;

    notes.DEFAULT_SIZE = { width: 232, height: 216 };

    /* Inclinação leve e estável por post-it: derivada do id, então o cartão não
       "pula" de ângulo a cada render. */
    notes.tiltFor = function (id) {
        return (((Number(id) || 0) * 37) % 9) - 4;
    };

    notes.bucketOf = function (id) {
        return notes.BUCKETS.find(function (bucket) {
            return bucket.id === id;
        }) || notes.BUCKETS[0];
    };
})(EN.notes);
