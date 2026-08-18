(function () {
    "use strict";

    const SNAP_MINUTES = 15;
    const MIN_DURATION = 15;
    const DAY_MINUTES = 1440;
    const ROUTINE_DAY = -1;

    const DAY_LABELS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
    const DAY_SHORT = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

    const STORE = {
        weekend: "en_planner_weekend",
        zoom: "en_planner_zoom",
        compact: "en_planner_compact",
    };

    const FULL_RANGE = { start: 0, end: DAY_MINUTES };
    const WORK_RANGE = { start: 360, end: 1380 };

    const panel = document.querySelector(".planner-panel");
    const grid = document.getElementById("planner-grid");
    const head = document.getElementById("planner-head");
    const hoursEl = document.getElementById("planner-hours");
    const canvas = document.getElementById("planner-canvas");
    const scroller = document.querySelector(".planner-scroll");

    const weekendToggle = document.getElementById("planner-weekend");
    const zoomInput = document.getElementById("planner-zoom");
    const compactBtn = document.getElementById("planner-compact");
    const newBtn = document.getElementById("planner-new");

    const modal = document.getElementById("planner-modal");
    const modalTitle = document.getElementById("planner-modal-title");
    const form = document.getElementById("planner-form");
    const titleInput = document.getElementById("planner-title");
    const notesInput = document.getElementById("planner-notes");
    const startInput = document.getElementById("planner-start");
    const endInput = document.getElementById("planner-end");
    const daySelect = document.getElementById("planner-day");
    const dayField = document.getElementById("planner-day-field");
    const routineInput = document.getElementById("planner-routine");
    const deleteBtn = document.getElementById("planner-delete");
    const errorEl = document.getElementById("planner-error");

    if (!panel || !grid || !canvas || !modal) {
        return;
    }

    const API = panel.dataset.blocksUrl || "/api/planner/blocks";

    let blocks = [];
    let showWeekend = localStorage.getItem(STORE.weekend) === "1";
    let hourHeight = clamp(parseInt(localStorage.getItem(STORE.zoom) || "52", 10) || 52, 28, 110);
    let range = localStorage.getItem(STORE.compact) === "1" ? WORK_RANGE : FULL_RANGE;
    let selectedId = null;
    let editingId = null;
    let drag = null;
    let nowTimer = null;

    /* ---------------------------------------------------------------- utils */

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function snap(minute) {
        return Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES;
    }

    function formatMinute(minute) {
        const h = Math.floor(minute / 60) % 24;
        const m = minute % 60;
        return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
    }

    function parseTimeValue(value) {
        const parts = String(value || "").split(":");
        const h = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        if (Number.isNaN(h) || Number.isNaN(m)) {
            return null;
        }
        return h * 60 + m;
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, function (ch) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
        });
    }

    function visibleDays() {
        return showWeekend ? [0, 1, 2, 3, 4, 5, 6] : [0, 1, 2, 3, 4];
    }

    function minuteToPx(minute) {
        return ((minute - range.start) / 60) * hourHeight;
    }

    function durationToPx(minutes) {
        return (minutes / 60) * hourHeight;
    }

    function todayIndex() {
        return (new Date().getDay() + 6) % 7;
    }

    /* ------------------------------------------------------------- skeleton */

    function buildSkeleton() {
        const days = visibleDays();
        const today = todayIndex();

        grid.style.setProperty("--days", days.length);
        grid.style.setProperty("--hour-h", hourHeight + "px");
        grid.style.setProperty("--hours-count", (range.end - range.start) / 60);
        grid.dataset.weekend = showWeekend ? "on" : "off";

        head.innerHTML = days
            .map(function (day) {
                return (
                    '<div class="planner-day-head' + (day === today ? " is-today" : "") + '">' +
                    '<span class="planner-day-name">' + DAY_LABELS[day] + "</span>" +
                    '<span class="planner-day-abbr">' + DAY_SHORT[day] + "</span>" +
                    "</div>"
                );
            })
            .join("");

        const hourList = [];
        for (let minute = range.start; minute < range.end; minute += 60) {
            hourList.push('<div class="planner-hour"><span>' + formatMinute(minute) + "</span></div>");
        }
        hoursEl.innerHTML = hourList.join("");

        canvas.innerHTML = days
            .map(function (day) {
                return (
                    '<div class="planner-col' + (day === today ? " is-today" : "") + '" data-day="' + day + '"></div>'
                );
            })
            .join("");
    }

    /* --------------------------------------------------------- block layout */

    function assignLanes(items) {
        const sorted = items.slice().sort(function (a, b) {
            return a.startMinute - b.startMinute || a.endMinute - b.endMinute;
        });

        const result = [];
        let cluster = [];
        let clusterEnd = -1;

        function flush() {
            if (!cluster.length) {
                return;
            }
            const laneEnds = [];
            cluster.forEach(function (entry) {
                let lane = laneEnds.findIndex(function (end) {
                    return end <= entry.block.startMinute;
                });
                if (lane === -1) {
                    laneEnds.push(entry.block.endMinute);
                    lane = laneEnds.length - 1;
                } else {
                    laneEnds[lane] = entry.block.endMinute;
                }
                entry.lane = lane;
            });
            cluster.forEach(function (entry) {
                entry.lanes = laneEnds.length;
                result.push(entry);
            });
            cluster = [];
            clusterEnd = -1;
        }

        sorted.forEach(function (block) {
            if (cluster.length && block.startMinute >= clusterEnd) {
                flush();
            }
            cluster.push({ block: block, lane: 0, lanes: 1 });
            clusterEnd = Math.max(clusterEnd, block.endMinute);
        });
        flush();

        return result;
    }

    function blockMarkup(block) {
        const badge = block.isRoutine ? '<span class="planner-block-badge" title="Rotina diária">🔁</span>' : "";
        const notes = block.notes
            ? '<span class="planner-block-notes">' + escapeHtml(block.notes) + "</span>"
            : "";

        return (
            '<span class="planner-handle planner-handle-top" data-handle="top"></span>' +
            '<div class="planner-block-body">' +
            '<span class="planner-block-title">' + escapeHtml(block.title) + badge + "</span>" +
            '<span class="planner-block-time">' + formatMinute(block.startMinute) + " – " + formatMinute(block.endMinute) + "</span>" +
            notes +
            "</div>" +
            '<span class="planner-handle planner-handle-bottom" data-handle="bottom"></span>'
        );
    }

    function applyGeometry(el, block, lane, lanes) {
        const height = Math.max(durationToPx(block.endMinute - block.startMinute), 16);
        el.style.top = minuteToPx(block.startMinute) + "px";
        el.style.height = height + "px";
        el.style.left = "calc(" + (lane / lanes) * 100 + "% + 3px)";
        el.style.width = "calc(" + (1 / lanes) * 100 + "% - 6px)";
        el.classList.toggle("is-tiny", height < 34);
    }

    function renderBlocks() {
        const columns = canvas.querySelectorAll(".planner-col");

        columns.forEach(function (column) {
            const day = Number(column.dataset.day);
            column.querySelectorAll(".planner-block").forEach(function (el) {
                el.remove();
            });

            const dayBlocks = blocks.filter(function (block) {
                return block.isRoutine || block.dayOfWeek === day;
            });

            assignLanes(dayBlocks).forEach(function (entry) {
                const block = entry.block;
                const el = document.createElement("article");
                el.className =
                    "planner-block color-" +
                    block.color +
                    (block.isRoutine ? " is-routine" : "") +
                    (block.id === selectedId ? " is-selected" : "");
                el.dataset.id = String(block.id);
                el.tabIndex = 0;
                el.title = block.title + " · " + formatMinute(block.startMinute) + "–" + formatMinute(block.endMinute);
                el.innerHTML = blockMarkup(block);
                applyGeometry(el, block, entry.lane, entry.lanes);
                column.appendChild(el);
            });
        });

        renderNowLine();
    }

    function renderNowLine() {
        canvas.querySelectorAll(".planner-now").forEach(function (el) {
            el.remove();
        });

        const now = new Date();
        const minute = now.getHours() * 60 + now.getMinutes();
        if (minute < range.start || minute > range.end) {
            return;
        }

        const column = canvas.querySelector('.planner-col[data-day="' + todayIndex() + '"]');
        if (!column) {
            return;
        }

        const line = document.createElement("div");
        line.className = "planner-now";
        line.style.top = minuteToPx(minute) + "px";
        column.appendChild(line);
    }

    /* -------------------------------------------------------------- pointer */

    function minuteFromPointer(clientY) {
        const rect = canvas.getBoundingClientRect();
        const raw = range.start + ((clientY - rect.top) / hourHeight) * 60;
        return clamp(raw, range.start, range.end);
    }

    function dayFromPointer(clientX) {
        const days = visibleDays();
        const rect = canvas.getBoundingClientRect();
        const width = rect.width / days.length;
        const index = clamp(Math.floor((clientX - rect.left) / width), 0, days.length - 1);
        return days[index];
    }

    function findBlock(id) {
        return blocks.find(function (block) {
            return block.id === id;
        });
    }

    function onPointerDown(event) {
        if (event.button !== 0 || drag) {
            return;
        }

        const blockEl = event.target.closest(".planner-block");

        if (blockEl) {
            const block = findBlock(Number(blockEl.dataset.id));
            if (!block) {
                return;
            }
            const handle = event.target.dataset ? event.target.dataset.handle : null;
            drag = {
                mode: handle ? "resize-" + handle : "move",
                el: blockEl,
                block: block,
                draft: Object.assign({}, block),
                grabOffset: minuteFromPointer(event.clientY) - block.startMinute,
                originX: event.clientX,
                originY: event.clientY,
                moved: false,
            };
            selectedId = block.id;
            canvas.querySelectorAll(".planner-block.is-selected").forEach(function (el) {
                el.classList.remove("is-selected");
            });
            blockEl.classList.add("is-selected");
            blockEl.classList.add("is-dragging");
        } else {
            const column = event.target.closest(".planner-col");
            if (!column) {
                return;
            }
            const anchor = clamp(snap(minuteFromPointer(event.clientY)), 0, DAY_MINUTES - MIN_DURATION);
            const ghost = document.createElement("article");
            ghost.className = "planner-block planner-ghost color-rose";
            ghost.innerHTML = '<div class="planner-block-body"><span class="planner-block-time"></span></div>';
            column.appendChild(ghost);

            drag = {
                mode: "create",
                el: ghost,
                day: Number(column.dataset.day),
                anchor: anchor,
                draft: { startMinute: anchor, endMinute: anchor + MIN_DURATION },
                originX: event.clientX,
                originY: event.clientY,
                moved: false,
            };
            applyGeometry(ghost, drag.draft, 0, 1);
            updateGhostLabel();
        }

        event.preventDefault();
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
    }

    function updateGhostLabel() {
        if (!drag || drag.mode !== "create") {
            return;
        }
        const label = drag.el.querySelector(".planner-block-time");
        if (label) {
            label.textContent = formatMinute(drag.draft.startMinute) + " – " + formatMinute(drag.draft.endMinute);
        }
    }

    function updateBlockLabel() {
        if (!drag || !drag.el) {
            return;
        }
        const label = drag.el.querySelector(".planner-block-time");
        if (label) {
            label.textContent = formatMinute(drag.draft.startMinute) + " – " + formatMinute(drag.draft.endMinute);
        }
    }

    function onPointerMove(event) {
        if (!drag) {
            return;
        }

        if (!drag.moved) {
            const dx = Math.abs(event.clientX - drag.originX);
            const dy = Math.abs(event.clientY - drag.originY);
            if (dx < 4 && dy < 4) {
                return;
            }
            drag.moved = true;
        }

        const pointerMinute = minuteFromPointer(event.clientY);

        if (drag.mode === "create") {
            const current = clamp(snap(pointerMinute), 0, DAY_MINUTES);
            drag.draft.startMinute = Math.min(drag.anchor, current);
            drag.draft.endMinute = Math.max(drag.anchor + MIN_DURATION, Math.max(drag.anchor, current));
            applyGeometry(drag.el, drag.draft, 0, 1);
            updateGhostLabel();
            return;
        }

        if (drag.mode === "move") {
            const duration = drag.block.endMinute - drag.block.startMinute;
            const start = clamp(snap(pointerMinute - drag.grabOffset), 0, DAY_MINUTES - duration);
            drag.draft.startMinute = start;
            drag.draft.endMinute = start + duration;

            if (!drag.block.isRoutine) {
                const day = dayFromPointer(event.clientX);
                if (day !== drag.draft.dayOfWeek) {
                    drag.draft.dayOfWeek = day;
                    const column = canvas.querySelector('.planner-col[data-day="' + day + '"]');
                    if (column) {
                        column.appendChild(drag.el);
                    }
                }
            }
        } else if (drag.mode === "resize-top") {
            drag.draft.startMinute = clamp(snap(pointerMinute), 0, drag.draft.endMinute - MIN_DURATION);
        } else if (drag.mode === "resize-bottom") {
            drag.draft.endMinute = clamp(snap(pointerMinute), drag.draft.startMinute + MIN_DURATION, DAY_MINUTES);
        }

        applyGeometry(drag.el, drag.draft, 0, 1);
        updateBlockLabel();
    }

    function onPointerUp() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);

        const current = drag;
        drag = null;
        if (!current) {
            return;
        }

        if (current.mode === "create") {
            current.el.remove();
            const start = current.draft.startMinute;
            const end = current.moved ? current.draft.endMinute : Math.min(start + 60, DAY_MINUTES);
            openModal(null, { dayOfWeek: current.day, startMinute: start, endMinute: end });
            return;
        }

        current.el.classList.remove("is-dragging");

        if (!current.moved) {
            openModal(current.block);
            renderBlocks();
            return;
        }

        const updated = Object.assign({}, current.block, {
            startMinute: current.draft.startMinute,
            endMinute: current.draft.endMinute,
            dayOfWeek: current.block.isRoutine ? ROUTINE_DAY : current.draft.dayOfWeek,
        });

        saveBlock(updated).catch(function () {
            loadBlocks();
        });
    }

    /* ------------------------------------------------------------------ api */

    async function request(url, options) {
        const response = await fetch(url, options);
        const data = await response.json().catch(function () {
            return {};
        });
        if (!response.ok || data.ok === false) {
            throw new Error(data.message || "Não foi possível salvar o bloco.");
        }
        return data;
    }

    async function loadBlocks() {
        try {
            const data = await request(API, { headers: { Accept: "application/json" } });
            blocks = data.blocks || [];
            renderBlocks();
        } catch (err) {
            panel.classList.add("has-error");
        }
    }

    function toPayload(block) {
        return {
            title: block.title,
            notes: block.notes || "",
            dayOfWeek: block.dayOfWeek,
            startMinute: block.startMinute,
            endMinute: block.endMinute,
            color: block.color,
            isRoutine: Boolean(block.isRoutine),
        };
    }

    async function saveBlock(block) {
        const isNew = !block.id;
        const data = await request(isNew ? API : API + "/" + block.id, {
            method: isNew ? "POST" : "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toPayload(block)),
        });

        const saved = data.block;
        const index = blocks.findIndex(function (item) {
            return item.id === saved.id;
        });
        if (index === -1) {
            blocks.push(saved);
        } else {
            blocks[index] = saved;
        }
        selectedId = saved.id;
        renderBlocks();
        return saved;
    }

    async function removeBlock(id) {
        await request(API + "/" + id, { method: "DELETE" });
        blocks = blocks.filter(function (block) {
            return block.id !== id;
        });
        if (selectedId === id) {
            selectedId = null;
        }
        renderBlocks();
    }

    /* ---------------------------------------------------------------- modal */

    function setError(message) {
        if (!message) {
            errorEl.hidden = true;
            errorEl.textContent = "";
            return;
        }
        errorEl.hidden = false;
        errorEl.textContent = message;
    }

    function syncRoutineField() {
        dayField.hidden = routineInput.checked;
    }

    function openModal(block, seed) {
        setError(null);
        editingId = block ? block.id : null;
        modalTitle.textContent = block ? "Editar bloco" : "Novo bloco";
        deleteBtn.hidden = !block;

        const source = block || Object.assign({ title: "", notes: "", color: "rose", isRoutine: false }, seed);

        titleInput.value = source.title || "";
        notesInput.value = source.notes || "";
        startInput.value = formatMinute(source.startMinute);
        endInput.value = source.endMinute >= DAY_MINUTES ? "23:59" : formatMinute(source.endMinute);
        routineInput.checked = Boolean(source.isRoutine);
        daySelect.value = String(source.isRoutine ? 0 : source.dayOfWeek);

        const swatch = form.querySelector('input[name="planner-color"][value="' + (source.color || "rose") + '"]');
        if (swatch) {
            swatch.checked = true;
        }

        syncRoutineField();
        modal.classList.add("show");
        modal.setAttribute("aria-hidden", "false");
        window.setTimeout(function () {
            titleInput.focus();
        }, 20);
    }

    function closeModal() {
        modal.classList.remove("show");
        modal.setAttribute("aria-hidden", "true");
        editingId = null;
    }

    async function onSubmit(event) {
        event.preventDefault();
        setError(null);

        const title = titleInput.value.trim();
        if (!title) {
            setError("Informe o título do bloco.");
            return;
        }

        const start = parseTimeValue(startInput.value);
        let end = parseTimeValue(endInput.value);
        if (start === null || end === null) {
            setError("Horário inválido.");
            return;
        }
        if (end === 1439) {
            end = DAY_MINUTES;
        }
        if (end <= start) {
            setError("O fim precisa ser depois do início.");
            return;
        }

        const colorInput = form.querySelector('input[name="planner-color"]:checked');
        const payload = {
            id: editingId,
            title: title,
            notes: notesInput.value.trim(),
            dayOfWeek: Number(daySelect.value),
            startMinute: snap(start),
            endMinute: Math.max(snap(end), snap(start) + MIN_DURATION),
            color: colorInput ? colorInput.value : "rose",
            isRoutine: routineInput.checked,
        };

        try {
            await saveBlock(payload);
            closeModal();
        } catch (err) {
            setError(err.message);
        }
    }

    /* -------------------------------------------------------------- toolbar */

    function refresh(rebuild) {
        if (rebuild) {
            buildSkeleton();
        } else {
            grid.style.setProperty("--hour-h", hourHeight + "px");
        }
        renderBlocks();
    }

    weekendToggle.checked = showWeekend;
    weekendToggle.addEventListener("change", function () {
        showWeekend = weekendToggle.checked;
        localStorage.setItem(STORE.weekend, showWeekend ? "1" : "0");
        refresh(true);
    });

    zoomInput.value = String(hourHeight);
    zoomInput.addEventListener("input", function () {
        hourHeight = clamp(parseInt(zoomInput.value, 10) || 52, 28, 110);
        localStorage.setItem(STORE.zoom, String(hourHeight));
        refresh(false);
    });

    function syncCompactButton() {
        const compact = range === WORK_RANGE;
        compactBtn.textContent = compact ? "Mostrar 24h" : "Horário útil";
        compactBtn.setAttribute("aria-pressed", String(compact));
    }

    compactBtn.addEventListener("click", function () {
        range = range === WORK_RANGE ? FULL_RANGE : WORK_RANGE;
        localStorage.setItem(STORE.compact, range === WORK_RANGE ? "1" : "0");
        syncCompactButton();
        refresh(true);
    });

    newBtn.addEventListener("click", function () {
        const now = new Date();
        const start = clamp(snap(now.getHours() * 60), 0, DAY_MINUTES - 60);
        openModal(null, { dayOfWeek: todayIndex(), startMinute: start, endMinute: start + 60 });
    });

    routineInput.addEventListener("change", syncRoutineField);
    form.addEventListener("submit", onSubmit);

    deleteBtn.addEventListener("click", async function () {
        if (!editingId || !window.confirm("Remover este bloco do planner?")) {
            return;
        }
        try {
            await removeBlock(editingId);
            closeModal();
        } catch (err) {
            setError(err.message);
        }
    });

    modal.addEventListener("click", function (event) {
        if (event.target.dataset && event.target.dataset.closePlanner === "1") {
            closeModal();
        }
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && modal.classList.contains("show")) {
            closeModal();
            return;
        }

        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
        if ((event.key === "Delete" || event.key === "Backspace") && selectedId && !typing && !modal.classList.contains("show")) {
            event.preventDefault();
            removeBlock(selectedId).catch(function () {});
        }
    });

    canvas.addEventListener("pointerdown", onPointerDown);

    canvas.addEventListener("keydown", function (event) {
        const blockEl = event.target.closest(".planner-block");
        if (blockEl && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            const block = findBlock(Number(blockEl.dataset.id));
            if (block) {
                openModal(block);
            }
        }
    });

    window.addEventListener("resize", function () {
        renderNowLine();
    });

    /* ----------------------------------------------------------------- init */

    syncCompactButton();
    buildSkeleton();
    loadBlocks();

    if (scroller) {
        const focusMinute = clamp(new Date().getHours() * 60 - 60, range.start, range.end);
        scroller.scrollTop = minuteToPx(focusMinute);
    }

    nowTimer = window.setInterval(renderNowLine, 60000);
    window.addEventListener("beforeunload", function () {
        window.clearInterval(nowTimer);
    });
})();
