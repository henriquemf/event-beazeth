/* Posicionamento e renderização dos blocos dentro das colunas. */
window.EN = window.EN || {};
EN.planner = EN.planner || {};

(function (planner, utils) {
    "use strict";

    const time = planner.time;
    const view = planner.view;

    /* Distribui blocos que se sobrepõem em "faixas" lado a lado. */
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
            ? '<span class="planner-block-notes">' + utils.escapeHtml(block.notes) + "</span>"
            : "";

        return (
            '<span class="planner-handle planner-handle-top" data-handle="top"></span>' +
            '<div class="planner-block-body">' +
            '<span class="planner-block-title">' + utils.escapeHtml(block.title) + badge + "</span>" +
            '<span class="planner-block-time">' + time.formatMinute(block.startMinute) + " – " + time.formatMinute(block.endMinute) + "</span>" +
            notes +
            "</div>" +
            '<span class="planner-handle planner-handle-bottom" data-handle="bottom"></span>'
        );
    }

    planner.blocks = {
        assignLanes: assignLanes,

        applyGeometry: function (ctx, el, block, lane, lanes) {
            el.style.setProperty("--b-start", block.startMinute);
            el.style.setProperty("--b-dur", block.endMinute - block.startMinute);
            if (lane !== undefined) {
                el.style.setProperty("--lane", lane);
                el.style.setProperty("--lanes", lanes);
            }
            el.classList.toggle("is-tiny", view.durationToPx(ctx, block.endMinute - block.startMinute) < 34);
        },

        /* Reaplica só o rótulo de bloco curto após mudar o zoom: nenhuma leitura
           de layout, então não força reflow. */
        refreshTinyFlags: function (ctx) {
            ctx.els.canvas.querySelectorAll(".planner-block").forEach(function (el) {
                const duration = Number(el.style.getPropertyValue("--b-dur")) || 60;
                el.classList.toggle("is-tiny", view.durationToPx(ctx, duration) < 34);
            });
        },

        render: function (ctx) {
            const columns = ctx.els.canvas.querySelectorAll(".planner-col");

            columns.forEach(function (column) {
                const day = Number(column.dataset.day);
                column.querySelectorAll(".planner-block").forEach(function (el) {
                    el.remove();
                });

                const dayBlocks = ctx.blocks.filter(function (block) {
                    return block.isRoutine || block.dayOfWeek === day;
                });

                assignLanes(dayBlocks).forEach(function (entry) {
                    const block = entry.block;
                    const el = document.createElement("article");
                    el.className =
                        "planner-block color-" +
                        block.color +
                        (block.isRoutine ? " is-routine" : "") +
                        (block.id === ctx.selectedId ? " is-selected" : "");
                    el.dataset.id = String(block.id);
                    el.tabIndex = 0;
                    el.title = block.title + " · " + time.formatMinute(block.startMinute) + "–" + time.formatMinute(block.endMinute);
                    el.innerHTML = blockMarkup(block);
                    planner.blocks.applyGeometry(ctx, el, block, entry.lane, entry.lanes);
                    column.appendChild(el);
                });
            });

            planner.blocks.renderNowLine(ctx);
        },

        renderNowLine: function (ctx) {
            ctx.els.canvas.querySelectorAll(".planner-now").forEach(function (el) {
                el.remove();
            });

            const now = new Date();
            const minute = now.getHours() * 60 + now.getMinutes();
            if (minute < ctx.range.start || minute > ctx.range.end) {
                return;
            }

            const column = ctx.els.canvas.querySelector('.planner-col[data-day="' + time.todayIndex() + '"]');
            if (!column) {
                return;
            }

            const line = document.createElement("div");
            line.className = "planner-now";
            line.style.setProperty("--now-min", minute);
            column.appendChild(line);
        },
    };
})(EN.planner, EN.utils);
