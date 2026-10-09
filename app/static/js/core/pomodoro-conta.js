/* Os pomodoros na conta: o que se começa aqui aparece no celular, e vice-versa.

   O relógio continua rodando no localStorage (core/pomodoro.js e
   core/pomodoro-subs.js); este arquivo só leva e traz o ESTADO de cada
   temporizador, no formato da conta -- o mesmo que o app Android lê e grava
   (ver `app/db/pomodoros.py`).

   ## Subida

   Toda ação de quem está na tela (`EN.pomodoro.aoAgir`) põe o temporizador numa
   lista de "devendo", guardada no localStorage, e o estado de AGORA dele sobe
   pouco depois. Sem rede, a lista fica, e sobe na próxima tentativa ou na
   próxima visita -- nada se perde. Sub removido sobe como DELETE.

   ## Descida

   `GET /api/pomodoro` ao abrir a página e a cada mudança que o ao vivo
   (`core/ao-vivo.js`) anuncia. O que está "devendo" não é sobrescrito: a versão
   daqui ainda não subiu, e é a mais nova.

   ## Primeira vez

   Um navegador que nunca conversou sobre pomodoros com a conta SOBE os subs que
   tem e a conta não -- foram criados antes de existir sincronização, e jogá-los
   fora seria perder o que a pessoa montou. Depois disso, sub que some da conta
   foi removido no outro aparelho, e some daqui também. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    if (!document.querySelector("[data-sync-agora]") || !EN.pomodoro || !EN.pomodoroSubs) {
        return;
    }

    const API = "/api/pomodoro";
    const PRINCIPAL = "principal";
    const DEVENDO_KEY = "en_pomodoro_devendo";
    const SEMEADO_KEY = "en_pomodoro_semeado";
    /* Renomear dispara a cada tecla: espera a pessoa parar de digitar. */
    const ESPERA = 600;
    const DE_NOVO = 10000;
    /* Depois de subir, ignora por um instante o que vier da conta para o mesmo
       temporizador: uma leitura que saiu ANTES da subida traria o estado velho
       de volta, e o botão "voltaria" sozinho por dois segundos. Ignorar não é
       descartar: passada a janela, a conta é lida de novo (`releitura`), senão
       uma mudança de verdade do celular, chegada nesse instante, se perderia --
       o contador não mexe outra vez para avisar. */
    const RECENTE = 4000;

    const P = EN.pomodoro;
    const lerJson = P.interno.lerJson;
    const gravarJson = P.interno.gravarJson;

    /* ------------------------------------------------------ forma da conta */

    function paraConta(estado) {
        if (!estado || estado.status === "done") {
            return { fase: "parado", fimEm: 0, restanteMs: 0, totalMs: 0 };
        }
        if (estado.status === "running") {
            return { fase: estado.mode, fimEm: estado.endsAt, restanteMs: 0, totalMs: estado.totalMs };
        }
        return {
            fase: estado.mode,
            fimEm: 0,
            restanteMs: Math.max(0, Math.round(estado.leftMs || 0)),
            totalMs: estado.totalMs,
        };
    }

    function daConta(conta, nome) {
        if (!conta || conta.fase === "parado") {
            return null;
        }
        const minutos = conta.fase === "descanso" ? P.descansoDe(conta.minutos) : conta.minutos;
        const total = conta.totalMs > 0 ? conta.totalMs : minutos * 60000;
        return P.normalizar({
            status: conta.fimEm ? "running" : "paused",
            mode: conta.fase,
            totalMs: total,
            minutes: total / 60000,
            endsAt: conta.fimEm || 0,
            leftMs: conta.fimEm ? total : conta.restanteMs,
            label: nome || "",
        });
    }

    /* O temporizador daqui, na forma da conta -- ou null se ele não existe. */
    function exportar(id) {
        if (id === PRINCIPAL) {
            return Object.assign(paraConta(lerJson(P.KEY)), {
                minutos: P.escolha(),
                descansoAutomatico: P.descansoAutomatico(),
            });
        }
        const lista = EN.pomodoroSubs.lista();
        for (let i = 0; i < lista.length; i += 1) {
            if (lista[i].id === id) {
                return Object.assign(paraConta(lista[i].estado), {
                    minutos: lista[i].minutos,
                    nome: lista[i].nome,
                    posicao: i,
                });
            }
        }
        return null;
    }

    /* Mesmo estado? A posição fica de fora: remover um do meio muda a dos
       outros sem que nenhum deles tenha mudado. */
    function mesmo(a, b) {
        if (!a || !b) {
            return false;
        }
        return ["fase", "fimEm", "restanteMs", "minutos", "nome", "descansoAutomatico"].every(function (campo) {
            return (a[campo] === undefined ? null : a[campo]) === (b[campo] === undefined ? null : b[campo]);
        });
    }

    /* --------------------------------------------------------------- subida */

    const enviadoEm = {};
    let relogio = 0;
    let releitura = 0;
    let enviando = false;

    function devendo() {
        const lista = lerJson(DEVENDO_KEY);
        return Array.isArray(lista) ? lista : [];
    }

    function marcar(id) {
        const lista = devendo();
        if (lista.indexOf(id) === -1) {
            lista.push(id);
            gravarJson(DEVENDO_KEY, lista);
        }
        agendar(ESPERA);
    }

    function tirar(id) {
        gravarJson(DEVENDO_KEY, devendo().filter(function (outro) {
            return outro !== id;
        }));
    }

    function agendar(ms) {
        window.clearTimeout(relogio);
        relogio = window.setTimeout(enviar, ms);
    }

    async function enviar() {
        if (enviando) {
            agendar(ESPERA);
            return;
        }
        enviando = true;
        try {
            for (const id of devendo()) {
                const conta = exportar(id);
                try {
                    if (conta) {
                        await EN.http.request(API + "/" + encodeURIComponent(id), {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(conta),
                        }, "Não consegui guardar o pomodoro.");
                    } else if (id !== PRINCIPAL) {
                        await EN.http.request(API + "/" + encodeURIComponent(id), {
                            method: "DELETE",
                        }, "Não consegui remover o pomodoro.");
                    }
                    enviadoEm[id] = Date.now();
                    /* Só tira da lista se nada mudou enquanto subia: senão o
                       que subiu já é velho, e a próxima volta manda o novo. */
                    if (!conta || mesmo(conta, exportar(id))) {
                        tirar(id);
                    }
                } catch (erro) {
                    /* Recusa (4xx): repetir não muda nada, e a lista travaria.
                       Sem rede ou 5xx: fica, e tenta de novo. */
                    const s = erro.status;
                    if (s && s < 500 && s !== 408 && s !== 429) {
                        tirar(id);
                    } else {
                        agendar(DE_NOVO);
                        return;
                    }
                }
            }
        } finally {
            enviando = false;
        }
        if (devendo().length) {
            agendar(ESPERA);
        }
    }

    /* --------------------------------------------------------------- descida */

    function serial(sub) {
        return { id: sub.id, nome: sub.nome, minutos: sub.minutos, estado: sub.estado };
    }

    function aplicar(linhas) {
        const pendentes = devendo();
        const semeado = lerJson(SEMEADO_KEY) === true;
        const agora = Date.now();
        const remotos = {};
        linhas.forEach(function (linha) {
            remotos[linha.id] = linha;
        });

        let adiado = false;

        function intocavel(id) {
            if (pendentes.indexOf(id) !== -1) {
                return true;
            }
            if (agora - (enviadoEm[id] || 0) < RECENTE) {
                adiado = true;
                return true;
            }
            return false;
        }

        /* O principal. Conta sem ele: este aparelho é o primeiro a falar. */
        const principal = remotos[PRINCIPAL];
        let mexeuNoPrincipal = false;
        if (!principal) {
            marcar(PRINCIPAL);
        } else if (!intocavel(PRINCIPAL) && !mesmo(principal, exportar(PRINCIPAL))) {
            const estado = daConta(principal, "");
            gravarJson(P.KEY, estado);
            gravarJson(P.CHOICE_KEY, principal.minutos);
            gravarJson(P.AUTO_KEY, principal.descansoAutomatico !== false);
            document.documentElement.dataset.pomo = estado ? "on" : "off";
            P.recarregar();
            mexeuNoPrincipal = true;
        }

        /* Os outros, na ordem da conta; os que nasceram aqui e ainda não
           subiram entram no fim. */
        const locais = EN.pomodoroSubs.lista();
        const nova = [];
        let mudou = false;

        linhas.filter(function (linha) {
            return linha.id !== PRINCIPAL;
        }).sort(function (a, b) {
            return a.posicao - b.posicao;
        }).forEach(function (linha) {
            const local = locais.filter(function (sub) {
                return sub.id === linha.id;
            })[0];
            if (intocavel(linha.id)) {
                /* A versão daqui é a mais nova -- inclusive a de "removido". */
                if (local) {
                    nova.push(serial(local));
                }
                return;
            }
            if (local && mesmo(linha, exportar(linha.id))) {
                nova.push(serial(local));
                return;
            }
            mudou = true;
            nova.push({ id: linha.id, nome: linha.nome, minutos: linha.minutos, estado: daConta(linha, linha.nome) });
        });

        locais.forEach(function (sub) {
            if (remotos[sub.id]) {
                return;
            }
            if (intocavel(sub.id) || !semeado) {
                nova.push(serial(sub));
                if (!semeado) {
                    marcar(sub.id);
                }
                return;
            }
            /* Removido no outro aparelho. */
            mudou = true;
        });

        if (mudou || nova.length !== locais.length) {
            gravarJson(EN.pomodoroSubs.KEY, nova.slice(0, EN.pomodoroSubs.MAX));
            EN.pomodoroSubs.adotar();
        }
        if (!semeado) {
            gravarJson(SEMEADO_KEY, true);
        }
        if (mexeuNoPrincipal) {
            document.dispatchEvent(new CustomEvent("en:pomodoro-conta"));
        }
        if (adiado) {
            window.clearTimeout(releitura);
            releitura = window.setTimeout(function () {
                receber().catch(function () {});
            }, RECENTE);
        }
    }

    async function receber() {
        const dados = await EN.http.request(API, {
            headers: { Accept: "application/json" },
        }, "Não consegui ler os pomodoros.");
        aplicar(dados.pomodoros || []);
        return true;
    }

    /* ----------------------------------------------------------------- liga */

    P.aoAgir(marcar);

    if (EN.aoVivo) {
        EN.aoVivo.quando(["pomodoros"], receber);
    }

    /* Ao abrir: primeiro o que ficou devendo da visita anterior, depois o que
       a conta tem. */
    function comecar() {
        if (devendo().length) {
            enviar();
        }
        receber().catch(function () {});
    }

    if (document.prerendering) {
        document.addEventListener("prerenderingchange", comecar, { once: true });
    } else {
        comecar();
    }
})(window.EN);
