(function () {
    "use strict";

    /* Quadro de post-its da home.

       As bibliotecas pedidas (Origin UI, Skiper UI, Cult UI) são registries
       React + Tailwind + shadcn. Este projeto é Flask + Jinja + JS puro, sem
       npm e sem build, então os padrões delas foram reimplementados
       nativamente sobre os tokens de tema que já existem no style.css:

       - Cult UI "texture card"     -> camadas de borda/sombra com cara de papel
       - Cult UI "expandable"       -> o cartão levanta ao entrar em edição
       - Cult UI "dock"             -> barra de ações flutuante do cartão
       - Origin UI swatch/segmented -> filtros por categoria e troca de cor
       - Skiper UI spring motion    -> easing elástico ao criar e ao arrastar
    */

    const API = "/api/notes";
    const CACHE_KEY = "en_notes_cache";
    const FILTER_KEY = "en_notes_filter";

    const COLORS = ["sun", "rose", "mint", "blue", "peach", "lavender"];

    const BUCKETS = [
        { id: "hoje", label: "Hoje", emoji: "☀️" },
        { id: "amanha", label: "Amanhã", emoji: "🌙" },
        { id: "semana", label: "Semana", emoji: "🗓️" },
        { id: "ideias", label: "Ideias", emoji: "💡" },
    ];

    const BUCKET_IDS = BUCKETS.map(function (bucket) { return bucket.id; });

    /* Espelham os limites validados em db.py (NOTE_BOUNDS). */
    const LIMITS = { minW: 150, maxW: 560, minH: 120, maxH: 560, maxX: 4000, maxY: 6000 };

    const GAP = 16;
    const DRAG_THRESHOLD = 4;
    const SAVE_DELAY = 420;

    const board = document.getElementById("notes-board");
    const panel = document.querySelector(".notes-panel");
    if (!board || !panel) {
        return;
    }

    const scroller = panel.querySelector(".notes-scroll");
    const filterBar = document.getElementById("notes-filters");
    const emptyEl = document.getElementById("notes-empty");
    const statusEl = document.getElementById("notes-status");
    const addBtn = document.getElementById("notes-add");
    const tidyBtn = document.getElementById("notes-tidy");
    const countEl = document.getElementById("notes-count");

    /* --------------------------------------------------------------- estado */

    let notes = [];
    const elements = new Map();          // id -> elemento montado
    let filter = readFilter();
    let drag = null;
    let offline = false;

    function readFilter() {
        const stored = localStorage.getItem(FILTER_KEY);
        return stored === "todos" || BUCKET_IDS.indexOf(stored) !== -1 ? stored : "hoje";
    }

    /* ---------------------------------------------------------------- utils */

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function findNote(id) {
        return notes.find(function (note) { return note.id === id; });
    }

    function visibleNotes() {
        return filter === "todos"
            ? notes
            : notes.filter(function (note) { return note.bucket === filter; });
    }

    function maxZ() {
        return notes.reduce(function (top, note) { return Math.max(top, note.z || 1); }, 1);
    }

    function bucketOf(id) {
        return BUCKETS.find(function (bucket) { return bucket.id === id; }) || BUCKETS[0];
    }

    function setStatus(message, tone) {
        if (!statusEl) {
            return;
        }
        statusEl.hidden = !message;
        statusEl.textContent = message || "";
        statusEl.dataset.tone = tone || "info";
    }

    /* -------------------------------------------------------------- persist */

    function writeCache() {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(notes));
        } catch (err) { /* cota cheia: o cache é só um atalho de leitura */ }
    }

    /* Digitar dispara queuePatch a cada tecla; serializar o quadro inteiro
       nesse ritmo é desperdício, então o cache é gravado em lote. */
    let cacheTimer = 0;

    function scheduleCacheWrite() {
        if (cacheTimer) {
            return;
        }
        cacheTimer = window.setTimeout(function () {
            cacheTimer = 0;
            writeCache();
        }, 900);
    }

    function readCache() {
        try {
            const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
            return Array.isArray(raw) ? raw : [];
        } catch (err) {
            return [];
        }
    }

    async function request(url, options) {
        const response = await fetch(url, options);
        const data = await response.json().catch(function () { return {}; });
        if (!response.ok || data.ok === false) {
            throw new Error(data.message || "Não foi possível salvar o post-it.");
        }
        return data;
    }

    /* Patches são agrupados por post-it e enviados com atraso: arrastar e
       digitar geram muitas mudanças por segundo, mas só uma requisição. */
    const pending = new Map();           // id -> { fields, timer }

    function queuePatch(id, fields) {
        const entry = pending.get(id) || { fields: {}, timer: 0 };
        Object.assign(entry.fields, fields);
        if (entry.timer) {
            window.clearTimeout(entry.timer);
        }
        entry.timer = window.setTimeout(function () { flushPatch(id); }, SAVE_DELAY);
        pending.set(id, entry);
        scheduleCacheWrite();
    }

    function flushPatch(id, keepalive) {
        const entry = pending.get(id);
        if (!entry) {
            return;
        }
        window.clearTimeout(entry.timer);
        pending.delete(id);

        const options = {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry.fields),
        };
        if (keepalive) {
            options.keepalive = true;
        }

        request(API + "/" + id, options).then(function () {
            if (offline) {
                offline = false;
                setStatus("");
            }
        }).catch(function () {
            offline = true;
            setStatus("Sem conexão com o servidor — as alterações ficaram só neste navegador.", "error");
        });
    }

    function flushAll(keepalive) {
        Array.from(pending.keys()).forEach(function (id) { flushPatch(id, keepalive); });
        if (cacheTimer) {
            window.clearTimeout(cacheTimer);
            cacheTimer = 0;
        }
        writeCache();
    }

    /* ------------------------------------------------------------ geometria */

    function applyGeometry(el, note) {
        el.style.setProperty("--n-x", note.x);
        el.style.setProperty("--n-y", note.y);
        el.style.setProperty("--n-w", note.width);
        el.style.setProperty("--n-h", note.height);
        el.style.setProperty("--n-z", note.z || 1);
    }

    /* O quadro cresce para caber os post-its; em telas estreitas ele rola no
       eixo X, no mesmo padrão do .planner-scroll. */
    function updateBoardSize() {
        let right = 0;
        let bottom = 0;
        visibleNotes().forEach(function (note) {
            right = Math.max(right, note.x + note.width);
            bottom = Math.max(bottom, note.y + note.height);
        });
        board.style.setProperty("--board-w", Math.ceil(right + GAP * 2) + "px");
        board.style.setProperty("--board-h", Math.ceil(Math.max(bottom + GAP * 2, 320)) + "px");
    }

    function boardWidth() {
        return scroller ? Math.max(scroller.clientWidth - GAP, 220) : 900;
    }

    /* Procura um espaço livre percorrendo a grade do quadro; se tudo estiver
       ocupado, empilha em cascata. Evita post-it novo nascer escondido. */
    function findFreeSpot(width, height) {
        const others = visibleNotes();
        const limit = Math.max(boardWidth(), width + GAP * 2);
        const step = 24;

        for (let y = GAP; y < 1600; y += step) {
            for (let x = GAP; x + width <= limit; x += step) {
                const free = others.every(function (note) {
                    return x + width + 8 <= note.x ||
                        note.x + note.width + 8 <= x ||
                        y + height + 8 <= note.y ||
                        note.y + note.height + 8 <= y;
                });
                if (free) {
                    return { x: x, y: y };
                }
            }
        }

        const offset = (others.length % 8) * 26;
        return { x: GAP + offset, y: GAP + offset };
    }

    /* --------------------------------------------------------- cartão (DOM) */

    function buildNoteElement(note) {
        const el = document.createElement("article");
        el.className = "note";
        el.dataset.id = String(note.id);
        el.tabIndex = 0;

        el.innerHTML =
            '<div class="note-bar">' +
                '<span class="note-grip" aria-hidden="true"></span>' +
                '<div class="note-actions">' +
                    '<button class="note-btn note-bucket" type="button" data-act="bucket"></button>' +
                    '<button class="note-btn" type="button" data-act="palette" aria-label="Trocar cor" aria-expanded="false">🎨</button>' +
                    '<button class="note-btn note-btn-danger" type="button" data-act="delete" aria-label="Remover post-it">×</button>' +
                '</div>' +
            '</div>' +
            '<textarea class="note-text" maxlength="2000" placeholder="Escreva seu lembrete..."></textarea>' +
            '<div class="note-swatches" hidden>' +
                COLORS.map(function (color) {
                    return '<button class="note-swatch color-' + color + '" type="button" data-color="' + color + '" aria-label="Cor ' + color + '"></button>';
                }).join("") +
            '</div>' +
            '<span class="note-resize" data-act="resize" aria-hidden="true"></span>';

        return el;
    }

    /* Escreve no DOM só o que mudou: evita perder cursor/seleção do textarea. */
    function syncNoteElement(el, note) {
        if (el.dataset.color !== note.color) {
            COLORS.forEach(function (color) { el.classList.remove("color-" + color); });
            el.classList.add("color-" + note.color);
            el.dataset.color = note.color;
        }

        const textarea = el.querySelector(".note-text");
        if (document.activeElement !== textarea && textarea.value !== note.content) {
            textarea.value = note.content;
        }

        const bucketBtn = el.querySelector('[data-act="bucket"]');
        if (bucketBtn.dataset.bucket !== note.bucket) {
            const bucket = bucketOf(note.bucket);
            bucketBtn.dataset.bucket = note.bucket;
            bucketBtn.textContent = bucket.emoji + " " + bucket.label;
            bucketBtn.title = "Mover para a próxima categoria";
        }

        el.querySelectorAll(".note-swatch").forEach(function (swatch) {
            swatch.setAttribute("aria-pressed", String(swatch.dataset.color === note.color));
        });

        applyGeometry(el, note);
    }

    function mountNote(note, animate) {
        let el = elements.get(note.id);
        if (!el) {
            el = buildNoteElement(note);
            elements.set(note.id, el);
            if (animate) {
                el.classList.add("is-new");
                el.addEventListener("animationend", function () {
                    el.classList.remove("is-new");
                }, { once: true });
            }
            board.appendChild(el);
        }
        syncNoteElement(el, note);
        return el;
    }

    function render(animateId) {
        const visible = visibleNotes();
        const keep = new Set(visible.map(function (note) { return note.id; }));

        elements.forEach(function (el, id) {
            if (!keep.has(id)) {
                el.remove();
                elements.delete(id);
            }
        });

        visible.forEach(function (note) { mountNote(note, note.id === animateId); });

        updateBoardSize();

        const total = visible.length;
        emptyEl.hidden = total > 0;
        board.classList.toggle("is-empty", total === 0);
        if (countEl) {
            countEl.textContent = total === 1 ? "1 post-it" : total + " post-its";
        }
    }

    /* ---------------------------------------------------------------- ações */

    async function createNote() {
        const bucket = filter === "todos" ? "hoje" : filter;
        const width = clamp(224, LIMITS.minW, Math.max(LIMITS.minW, boardWidth() - GAP * 2));
        const height = 208;
        const spot = findFreeSpot(width, height);

        const draft = {
            content: "",
            bucket: bucket,
            color: COLORS[notes.length % COLORS.length],
            x: spot.x,
            y: spot.y,
            width: width,
            height: height,
            z: maxZ() + 1,
        };

        try {
            const data = await request(API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(draft),
            });
            notes.push(data.note);
            writeCache();
            render(data.note.id);
            const el = elements.get(data.note.id);
            if (el) {
                el.querySelector(".note-text").focus();
            }
        } catch (err) {
            setStatus("Não foi possível criar o post-it. Recarregue a página.", "error");
        }
    }

    function removeNote(id) {
        const el = elements.get(id);

        function drop() {
            notes = notes.filter(function (note) { return note.id !== id; });
            /* Tira do DOM aqui: render() só limpa o que ainda está no mapa, e
               a entrada já foi removida abaixo. */
            if (el) {
                el.remove();
            }
            elements.delete(id);
            writeCache();
            render();
        }

        pending.delete(id);

        if (el) {
            /* Skiper UI: o cartão "descola" antes de sumir. */
            el.classList.add("is-leaving");
            el.addEventListener("animationend", drop, { once: true });
            window.setTimeout(function () {
                if (elements.get(id) === el) { drop(); }
            }, 280);
        } else {
            drop();
        }

        request(API + "/" + id, { method: "DELETE" }).catch(function () {
            setStatus("O post-it foi removido aqui, mas o servidor não respondeu.", "error");
        });
    }

    function updateNote(id, fields) {
        const note = findNote(id);
        if (!note) {
            return;
        }
        Object.assign(note, fields);

        const el = elements.get(id);
        if (el) {
            syncNoteElement(el, note);
        }
        queuePatch(id, fields);
    }

    function bringToFront(note) {
        const top = maxZ();
        if (note.z >= top) {
            return;
        }
        note.z = top + 1;
        const el = elements.get(note.id);
        if (el) {
            el.style.setProperty("--n-z", note.z);
        }
        queuePatch(note.id, { z: note.z });
    }

    /* Reorganiza em grade, respeitando a largura visível. */
    function tidy() {
        const visible = visibleNotes().slice().sort(function (a, b) {
            return a.y - b.y || a.x - b.x;
        });
        if (!visible.length) {
            return;
        }

        const width = Math.max(boardWidth(), LIMITS.minW + GAP * 2);
        let x = GAP;
        let y = GAP;
        let rowHeight = 0;

        visible.forEach(function (note) {
            if (x > GAP && x + note.width > width) {
                x = GAP;
                y += rowHeight + GAP;
                rowHeight = 0;
            }
            note.x = x;
            note.y = y;
            rowHeight = Math.max(rowHeight, note.height);
            x += note.width + GAP;

            const el = elements.get(note.id);
            if (el) {
                el.classList.add("is-tidying");
                applyGeometry(el, note);
                window.setTimeout(function () { el.classList.remove("is-tidying"); }, 340);
            }
            queuePatch(note.id, { x: note.x, y: note.y });
        });

        updateBoardSize();
    }

    /* ------------------------------------------------------------- ponteiro */

    function onPointerDown(event) {
        if (event.button !== 0 || drag) {
            return;
        }

        const el = event.target.closest(".note");
        if (!el) {
            return;
        }

        const note = findNote(Number(el.dataset.id));
        if (!note) {
            return;
        }

        bringToFront(note);

        /* Digitar e clicar em botão nunca devem virar arraste. */
        if (event.target.closest(".note-text, .note-btn, .note-swatch")) {
            return;
        }

        const action = event.target.dataset ? event.target.dataset.act : null;

        /* No toque, só a barra e o canto arrastam: o resto da área continua
           rolando a página normalmente. */
        if (event.pointerType === "touch" && action !== "resize" && !event.target.closest(".note-bar")) {
            return;
        }

        drag = {
            mode: action === "resize" ? "resize" : "move",
            el: el,
            note: note,
            pointerId: event.pointerId,
            originX: event.clientX,
            originY: event.clientY,
            baseX: note.x,
            baseY: note.y,
            baseW: note.width,
            baseH: note.height,
            moved: false,
        };

        try { el.setPointerCapture(event.pointerId); } catch (err) { /* opcional */ }
        el.classList.add(drag.mode === "resize" ? "is-resizing" : "is-dragging");
        event.preventDefault();

        window.addEventListener("pointermove", onPointerMove, { passive: true });
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
    }

    let pendingMove = null;
    let moveFrame = 0;

    function onPointerMove(event) {
        pendingMove = { clientX: event.clientX, clientY: event.clientY };
        if (moveFrame) {
            return;
        }
        moveFrame = window.requestAnimationFrame(function () {
            moveFrame = 0;
            const point = pendingMove;
            pendingMove = null;
            if (point) {
                processMove(point);
            }
        });
    }

    function processMove(point) {
        if (!drag) {
            return;
        }

        const dx = point.clientX - drag.originX;
        const dy = point.clientY - drag.originY;

        if (!drag.moved) {
            if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
                return;
            }
            drag.moved = true;
        }

        if (drag.mode === "move") {
            drag.note.x = clamp(Math.round(drag.baseX + dx), 0, LIMITS.maxX);
            drag.note.y = clamp(Math.round(drag.baseY + dy), 0, LIMITS.maxY);
        } else {
            drag.note.width = clamp(Math.round(drag.baseW + dx), LIMITS.minW, LIMITS.maxW);
            drag.note.height = clamp(Math.round(drag.baseH + dy), LIMITS.minH, LIMITS.maxH);
        }

        applyGeometry(drag.el, drag.note);
    }

    function onPointerUp() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);

        if (moveFrame) {
            window.cancelAnimationFrame(moveFrame);
            moveFrame = 0;
        }
        pendingMove = null;

        const current = drag;
        drag = null;
        if (!current) {
            return;
        }

        current.el.classList.remove("is-dragging", "is-resizing");
        try { current.el.releasePointerCapture(current.pointerId); } catch (err) { /* já liberado */ }

        if (!current.moved) {
            return;
        }

        const fields = current.mode === "move"
            ? { x: current.note.x, y: current.note.y }
            : { width: current.note.width, height: current.note.height };

        queuePatch(current.note.id, fields);
        updateBoardSize();
    }

    /* --------------------------------------------------------------- edição */

    function closeSwatches(except) {
        board.querySelectorAll(".note-swatches:not([hidden])").forEach(function (panelEl) {
            if (panelEl === except) {
                return;
            }
            panelEl.hidden = true;
            const trigger = panelEl.parentElement.querySelector('[data-act="palette"]');
            if (trigger) {
                trigger.setAttribute("aria-expanded", "false");
            }
        });
    }

    board.addEventListener("click", function (event) {
        const noteEl = event.target.closest(".note");
        if (!noteEl) {
            return;
        }
        const note = findNote(Number(noteEl.dataset.id));
        if (!note) {
            return;
        }

        const swatch = event.target.closest(".note-swatch");
        if (swatch) {
            updateNote(note.id, { color: swatch.dataset.color });
            closeSwatches();
            return;
        }

        const action = event.target.dataset ? event.target.dataset.act : null;

        if (action === "palette") {
            const panelEl = noteEl.querySelector(".note-swatches");
            const willOpen = panelEl.hidden;
            closeSwatches(panelEl);
            panelEl.hidden = !willOpen;
            event.target.setAttribute("aria-expanded", String(willOpen));
            return;
        }

        if (action === "bucket") {
            const next = BUCKET_IDS[(BUCKET_IDS.indexOf(note.bucket) + 1) % BUCKET_IDS.length];
            updateNote(note.id, { bucket: next });
            if (filter !== "todos") {
                render();
            }
            return;
        }

        if (action === "delete") {
            removeNote(note.id);
        }
    });

    board.addEventListener("input", function (event) {
        const textarea = event.target.closest(".note-text");
        if (!textarea) {
            return;
        }
        const note = findNote(Number(textarea.closest(".note").dataset.id));
        if (note) {
            note.content = textarea.value;
            queuePatch(note.id, { content: textarea.value });
        }
    });

    /* Cult UI "expandable": o cartão ganha relevo enquanto está em edição. */
    board.addEventListener("focusin", function (event) {
        const noteEl = event.target.closest(".note");
        if (noteEl) {
            noteEl.classList.add("is-editing");
            const note = findNote(Number(noteEl.dataset.id));
            if (note) {
                bringToFront(note);
            }
        }
    });

    board.addEventListener("focusout", function (event) {
        const noteEl = event.target.closest(".note");
        if (noteEl && !noteEl.contains(event.relatedTarget)) {
            noteEl.classList.remove("is-editing");
            flushPatch(Number(noteEl.dataset.id));
        }
    });

    board.addEventListener("pointerdown", onPointerDown);

    document.addEventListener("click", function (event) {
        if (!event.target.closest(".note")) {
            closeSwatches();
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") {
            return;
        }
        const active = document.activeElement;
        if (active && active.closest && active.closest(".note")) {
            closeSwatches();
            active.blur();
        }
    });

    /* -------------------------------------------------------------- toolbar */

    function renderFilters() {
        const options = [{ id: "todos", label: "Todos", emoji: "📌" }].concat(BUCKETS);
        filterBar.innerHTML = options.map(function (option) {
            return '<button class="notes-chip" type="button" data-bucket="' + option.id + '"' +
                ' aria-pressed="' + (option.id === filter) + '">' +
                '<span aria-hidden="true">' + option.emoji + "</span> " + option.label +
                "</button>";
        }).join("");
    }

    filterBar.addEventListener("click", function (event) {
        const chip = event.target.closest(".notes-chip");
        if (!chip) {
            return;
        }
        filter = chip.dataset.bucket;
        localStorage.setItem(FILTER_KEY, filter);
        renderFilters();
        render();
    });

    addBtn.addEventListener("click", createNote);
    tidyBtn.addEventListener("click", tidy);

    /* Salva o que estiver pendente ao sair/esconder a aba. */
    window.addEventListener("pagehide", function () { flushAll(true); });
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") {
            flushAll(true);
        }
    });

    /* ----------------------------------------------------------------- init */

    async function load() {
        try {
            const data = await request(API, { headers: { Accept: "application/json" } });
            notes = data.notes || [];
            writeCache();
            setStatus("");
        } catch (err) {
            offline = true;
            notes = readCache();
            setStatus("Sem conexão com o servidor — mostrando a última cópia salva neste navegador.", "error");
        }
        render();
    }

    renderFilters();
    load();
})();
