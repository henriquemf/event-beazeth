/* Ponto de entrada do planner: barra de ferramentas e inicialização. */
(function (planner) {
    "use strict";

    const ctx = planner.createContext();
    if (!ctx) {
        return;
    }

    const time = planner.time;
    const els = ctx.els;

    function refresh(rebuild) {
        if (rebuild) {
            planner.grid.build(ctx);
            planner.blocks.render(ctx);
            return;
        }
        // Zoom: uma variável muda e o CSS reposiciona tudo. Sem rebuild de DOM.
        els.grid.style.setProperty("--hour-h", ctx.hourHeight + "px");
        planner.blocks.refreshTinyFlags(ctx);
    }

    function syncCompactButton() {
        const compact = ctx.range === planner.WORK_RANGE;
        els.compactBtn.textContent = compact ? "Mostrar 24h" : "Horário útil";
        els.compactBtn.setAttribute("aria-pressed", String(compact));
    }

    els.weekendToggle.checked = ctx.showWeekend;
    els.weekendToggle.addEventListener("change", function () {
        ctx.showWeekend = els.weekendToggle.checked;
        localStorage.setItem(planner.STORE.weekend, ctx.showWeekend ? "1" : "0");
        refresh(true);
    });

    els.zoomInput.value = String(ctx.hourHeight);
    els.zoomInput.addEventListener("input", function () {
        ctx.hourHeight = time.clamp(
            parseInt(els.zoomInput.value, 10) || planner.ZOOM.fallback,
            planner.ZOOM.min,
            planner.ZOOM.max
        );
        refresh(false);
    });
    // Grava só ao soltar o slider, em vez de a cada tick.
    els.zoomInput.addEventListener("change", function () {
        localStorage.setItem(planner.STORE.zoom, String(ctx.hourHeight));
    });

    els.compactBtn.addEventListener("click", function () {
        ctx.range = ctx.range === planner.WORK_RANGE ? planner.FULL_RANGE : planner.WORK_RANGE;
        localStorage.setItem(planner.STORE.compact, ctx.range === planner.WORK_RANGE ? "1" : "0");
        syncCompactButton();
        refresh(true);
    });

    els.newBtn.addEventListener("click", function () {
        const now = new Date();
        const start = time.clamp(time.snap(now.getHours() * 60), 0, planner.DAY_MINUTES - 60);
        planner.editor.open(ctx, null, {
            dayOfWeek: time.todayIndex(),
            startMinute: start,
            endMinute: start + 60,
        });
    });

    planner.editor.init(ctx);
    planner.drag.init(ctx);

    syncCompactButton();
    planner.grid.build(ctx);
    planner.store.load(ctx);

    if (els.scroller) {
        const focusMinute = time.clamp(
            new Date().getHours() * 60 - 60,
            ctx.range.start,
            ctx.range.end
        );
        els.scroller.scrollTop = planner.view.minuteToPx(ctx, focusMinute);
    }

    ctx.nowTimer = window.setInterval(function () {
        planner.blocks.renderNowLine(ctx);
    }, 60000);
    window.addEventListener("beforeunload", function () {
        window.clearInterval(ctx.nowTimer);
    });
})(EN.planner);
