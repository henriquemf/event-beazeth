/* Tela de to-do da semana.

   A semana inteira chega pintada do servidor; aqui só mora o que muda sem sair
   da página. Trocar de semana é navegação normal, então não existe estado de
   "semana atual" no cliente para sair de sincronia com a URL.

   Os contadores (estrela do dia, placar da semana) são recontados a partir do
   DOM depois de cada mudança, e não incrementados na mão: um contador que se
   corrige sozinho não tem como acumular erro ao longo da sessão. */
(function (EN) {
    "use strict";

    const API = "/api/todo";
    const SAVE_DELAY = 420;

    const week = document.getElementById("todo-week");
    if (!week) {
        return;
    }

    const statusEl = document.getElementById("todo-status");
    const score = document.querySelector(".todo-score");

    /* id -> timer do debounce de texto. */
    const pending = new Map();

    function setStatus(message) {
        if (!statusEl) {
            return;
        }
        statusEl.hidden = !message;
        statusEl.textContent = message || "";
    }

    function itemOf(element) {
        return element.closest(".todo-item");
    }

    /* ----------------------------------------------------------- contagem */

    function refreshCounts() {
        let done = 0;
        let total = 0;

        week.querySelectorAll(".todo-day").forEach(function (day) {
            const items = day.querySelectorAll(".todo-item");
            const feitos = day.querySelectorAll(".todo-item.is-done");
            total += items.length;
            done += feitos.length;
            /* A estrela é do dia inteiro concluído — dia vazio não ganha. */
            day.classList.toggle("is-complete", items.length > 0 && items.length === feitos.length);
            day.classList.toggle("is-empty", items.length === 0);
        });

        if (score) {
            score.style.setProperty("--todo-progress", total ? done / total : 0);
            score.querySelector(".todo-score-text").innerHTML =
                done + "<small>/" + total + "</small>";
            score.querySelector(".todo-score-label").textContent = done === 1 ? "feita" : "feitas";
        }
    }

    /* -------------------------------------------------------------- criar */

    function buildItem(item, dayLabel) {
        const li = document.createElement("li");
        li.className = "todo-item is-new";
        li.dataset.id = String(item.id);

        const label = document.createElement("label");
        label.className = "todo-check";

        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = item.done;
        check.setAttribute("aria-label", "Concluir " + item.content);

        const box = document.createElement("span");
        box.className = "todo-box";
        box.setAttribute("aria-hidden", "true");

        label.append(check, box);

        /* createElement e não innerHTML: o texto é do usuário, e montar HTML
           com ele exigiria escapar à mão em todo ponto de inserção. */
        const text = document.createElement("input");
        text.type = "text";
        text.className = "todo-text";
        text.value = item.content;
        text.setAttribute("aria-label", dayLabel);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "todo-remove";
        remove.setAttribute("aria-label", "Apagar " + item.content);
        remove.textContent = "×";

        li.append(label, text, remove);
        /* Tira a classe de entrada depois da animação, senão ela toca de novo
           a cada vez que o elemento voltar a ser exibido. */
        li.addEventListener("animationend", function () {
            li.classList.remove("is-new");
        }, { once: true });

        return li;
    }

    async function createItem(field) {
        const content = field.value.trim();
        if (!content) {
            return;
        }

        const day = field.dataset.day;
        const list = week.querySelector('.todo-list[data-day="' + day + '"]');
        field.value = "";

        try {
            const data = await EN.http.request(API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ day: day, content: content }),
            }, "Não consegui criar a tarefa.");

            list.appendChild(buildItem(data.item, field.getAttribute("aria-label")));
            refreshCounts();
            setStatus("");
        } catch (err) {
            /* Devolve o texto ao campo: perder o que a pessoa acabou de digitar
               por causa de uma falha de rede é pior que o próprio erro. */
            field.value = content;
            setStatus(err.message);
        }
    }

    /* ------------------------------------------------------------ atualizar */

    async function patch(id, fields, onError) {
        try {
            await EN.http.request(API + "/" + id, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(fields),
            }, "Não consegui salvar a tarefa.");
            setStatus("");
        } catch (err) {
            setStatus(err.message);
            if (onError) {
                onError();
            }
        }
    }

    function queueText(li) {
        const id = li.dataset.id;
        const field = li.querySelector(".todo-text");

        window.clearTimeout(pending.get(id));
        pending.set(id, window.setTimeout(function () {
            pending.delete(id);
            const content = field.value.trim();
            if (!content) {
                return;
            }
            patch(id, { content: content });
        }, SAVE_DELAY));
    }

    function flushText(li) {
        const id = li.dataset.id;
        if (!pending.has(id)) {
            return;
        }
        window.clearTimeout(pending.get(id));
        pending.delete(id);
        const content = li.querySelector(".todo-text").value.trim();
        if (content) {
            patch(id, { content: content });
        }
    }

    /* --------------------------------------------------------------- eventos */

    week.addEventListener("change", function (event) {
        const check = event.target.closest('.todo-check input[type="checkbox"]');
        if (!check) {
            return;
        }

        const li = itemOf(check);
        const done = check.checked;

        /* Otimista: a marca aparece na hora e só volta atrás se o servidor
           recusar. Esperar a resposta para riscar deixa o clique "morto". */
        li.classList.toggle("is-done", done);
        refreshCounts();

        patch(li.dataset.id, { done: done }, function () {
            check.checked = !done;
            li.classList.toggle("is-done", !done);
            refreshCounts();
        });
    });

    week.addEventListener("input", function (event) {
        if (event.target.classList.contains("todo-text")) {
            queueText(itemOf(event.target));
        }
    });

    week.addEventListener("focusout", function (event) {
        if (event.target.classList.contains("todo-text")) {
            flushText(itemOf(event.target));
        }
    });

    week.addEventListener("keydown", function (event) {
        if (event.key !== "Enter") {
            return;
        }

        if (event.target.classList.contains("todo-new")) {
            event.preventDefault();
            createItem(event.target);
            return;
        }

        if (event.target.classList.contains("todo-text")) {
            event.preventDefault();
            event.target.blur();
        }
    });

    week.addEventListener("click", function (event) {
        const button = event.target.closest(".todo-remove");
        if (!button) {
            return;
        }

        const li = itemOf(button);
        const id = li.dataset.id;

        window.clearTimeout(pending.get(id));
        pending.delete(id);
        li.classList.add("is-leaving");

        EN.http.request(API + "/" + id, { method: "DELETE" }, "Não consegui apagar a tarefa.")
            .then(function () {
                li.remove();
                refreshCounts();
                setStatus("");
            })
            .catch(function (err) {
                li.classList.remove("is-leaving");
                setStatus(err.message);
            });
    });

    /* Sair da página com texto ainda no debounce perderia a última edição. */
    function flushAll() {
        week.querySelectorAll(".todo-item").forEach(flushText);
    }

    window.addEventListener("pagehide", flushAll);
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "hidden") {
            flushAll();
        }
    });

    refreshCounts();
})(window.EN);
