/* Ao vivo: o que muda no celular (ou noutra aba) aparece aqui sem recarregar.

   Até aqui toda tela do site era uma fotografia: lia o banco ao abrir e nunca
   mais. O post-it escrito no celular só aparecia no PC depois de um F5 -- e,
   pior, quem editasse a fotografia velha gravava por cima do que o celular
   tinha acabado de mandar.

   ## Como

   A cada 2 s, com a aba à vista, olha o contador de mudanças da conta
   (`/api/sync/versao`): um número que o banco sobe a cada escrita de qualquer
   aparelho, e que sai de graça porque vem junto com a conta que o servidor já
   lê para conferir o login. Só quando ele muda é que pergunta "o que mudou?"
   -- a MESMA rota que o app usa (`/api/sync`), com o mesmo `since`. Na
   prática, o que o celular grava aparece aqui em um ou dois segundos.

   Aba escondida não pergunta nada; ao voltar a aparecer, olha na hora. E uma
   vez por minuto faz a pergunta completa mesmo sem o contador mudar: a rede
   de segurança, caso algum caminho de escrita um dia escape do gatilho.

   Este arquivo não sabe desenhar tela nenhuma. Cada tela se inscreve nas
   entidades que mostra (`EN.aoVivo.quando(["notes"], fn)`) e decide como se
   atualizar. A `fn` devolve `false` quando não dá AGORA -- alguém digitando,
   arrastando, com o popup aberto, com gravação na fila -- e a mudança fica
   guardada para a próxima volta, em vez de passar por cima do que a pessoa
   está fazendo.

   ## Repetição

   O servidor reenvia o que mudou nos últimos dois minutos (ver `FOLGA` em
   `app/db/sync.py`), e cada escrita feita NESTA tela também volta pela rota.
   Uma impressão de cada linha já vista separa o que é novo do que só se
   repetiu, e a tela só é chamada quando há novidade. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    const OLHADA = 2000;
    const COMPLETA = 60000;

    /* O nome da TABELA (o que a lápide traz) para o nome do campo em `changed`. */
    const DA_TABELA = {
        sticky_notes: "notes",
        todo_items: "todoItems",
        planner_blocks: "plannerBlocks",
        events: "events",
        event_tags: "tags",
        diary_entries: "diaryEntries",
        pomodoros: "pomodoros",
    };

    /* O que identifica a linha em cada entidade. */
    function chave(entidade, linha) {
        if (entidade === "tags") {
            return linha.slug;
        }
        if (entidade === "hydrationIntake" || entidade === "diaryEntries") {
            return linha.day;
        }
        return linha.id;
    }

    const raiz = document.querySelector("[data-sync-agora]");
    const inscritos = [];

    EN.aoVivo = {
        /* `entidades`: nomes dos campos de `changed` (notes, todoItems...).
           `fn` pode ser assíncrona; `false` = "agora não, tenta de novo". */
        quando: function (entidades, fn) {
            inscritos.push({ entidades: new Set(entidades), fn: fn, pendentes: new Set() });
        },

        /* A própria tela, renderizada de novo pelo servidor, já interpretada.
           Para as telas que nascem prontas do Jinja: trocar um pedaço por ele
           é a forma de não ter uma segunda cópia do template em JS. */
        buscarTela: async function () {
            const resposta = await fetch(window.location.href, {
                headers: { Accept: "text/html" },
                credentials: "same-origin",
                cache: "no-store",
            });
            if (!resposta.ok) {
                throw new Error("tela " + resposta.status);
            }
            return new DOMParser().parseFromString(await resposta.text(), "text/html");
        },

        /* Alguém escrevendo num campo desta região? Aí não se troca nada. */
        digitando: function (regiao) {
            const ativo = document.activeElement;
            if (!ativo || !regiao || !regiao.contains(ativo)) {
                return false;
            }
            return ativo.isContentEditable || ativo.tagName === "INPUT" ||
                ativo.tagName === "TEXTAREA" || ativo.tagName === "SELECT";
        },
    };

    if (!raiz) {
        return;
    }

    let since = raiz.dataset.syncAgora;
    const vistos = new Map();
    let perguntando = false;
    let olhando = false;
    let versao = null;
    let relogio = 0;
    let relogioCompleto = 0;

    function anotar(mudadas, entidade, id, impressao) {
        const k = entidade + ":" + id;
        if (vistos.get(k) !== impressao) {
            vistos.set(k, impressao);
            mudadas.add(entidade);
        }
    }

    function novidades(dados) {
        const mudadas = new Set();
        const changed = dados.changed || {};

        Object.keys(changed).forEach(function (entidade) {
            const valor = changed[entidade];
            if (Array.isArray(valor)) {
                valor.forEach(function (linha) {
                    anotar(mudadas, entidade, chave(entidade, linha), JSON.stringify(linha));
                });
            } else if (valor) {
                /* `hydrationSettings`: uma linha por conta, ou null = não mudou. */
                anotar(mudadas, entidade, "conta", JSON.stringify(valor));
            }
        });

        (dados.deleted || []).forEach(function (morto) {
            const entidade = DA_TABELA[morto.entity];
            if (entidade) {
                anotar(mudadas, entidade, morto.id, "apagado");
            }
        });
        return mudadas;
    }

    async function entregar() {
        for (const inscrito of inscritos) {
            if (!inscrito.pendentes.size) {
                continue;
            }
            const estas = new Set(inscrito.pendentes);
            let resultado;
            try {
                resultado = await inscrito.fn(estas);
            } catch (erro) {
                /* Rede caiu no meio: fica para a próxima volta. */
                resultado = false;
            }
            if (resultado !== false) {
                estas.forEach(function (e) {
                    inscrito.pendentes.delete(e);
                });
            }
        }
    }

    async function perguntar() {
        if (perguntando || document.hidden) {
            return;
        }
        perguntando = true;
        try {
            const resposta = await fetch("/api/sync?since=" + encodeURIComponent(since), {
                headers: { Accept: "application/json" },
                credentials: "same-origin",
                cache: "no-store",
            });
            /* 401 é sessão que caiu: a próxima navegação leva ao login. Não
               adianta insistir daqui, nem gritar -- só parar. */
            if (resposta.status === 401) {
                parar();
                return;
            }
            if (!resposta.ok) {
                return;
            }
            const dados = await resposta.json();
            /* Grava o `now` só DEPOIS de anotar o que veio: a resposta já está
               toda na mão, e é ela que define o que falta absorver. */
            novidades(dados).forEach(function (entidade) {
                inscritos.forEach(function (inscrito) {
                    if (inscrito.entidades.has(entidade)) {
                        inscrito.pendentes.add(entidade);
                    }
                });
            });
            if (dados.now) {
                since = dados.now;
            }
        } catch (erro) {
            /* Sem rede: a próxima volta pergunta de novo, com o mesmo `since`. */
        } finally {
            perguntando = false;
        }
        await entregar();
    }

    function algumaAdiada() {
        return inscritos.some(function (inscrito) {
            return inscrito.pendentes.size > 0;
        });
    }

    /* A pergunta barata. A primeira olhada da página sempre segue para a
       completa: o contador ainda não tinha valor nenhum para comparar. */
    async function olhar() {
        if (olhando || document.hidden) {
            return;
        }
        olhando = true;
        let mudou = false;
        try {
            const resposta = await fetch("/api/sync/versao", {
                headers: { Accept: "application/json" },
                credentials: "same-origin",
                cache: "no-store",
            });
            if (resposta.status === 401) {
                parar();
                return;
            }
            if (resposta.ok) {
                const atual = (await resposta.json()).versao;
                mudou = atual !== versao;
                versao = atual;
            }
        } catch (erro) {
            /* Sem rede: a próxima olhada tenta de novo. */
        } finally {
            olhando = false;
        }
        if (mudou) {
            await perguntar();
        } else if (algumaAdiada()) {
            /* Uma mudança que esperava alguém parar de digitar entra assim
               que der, sem esperar o contador mexer de novo. */
            await entregar();
        }
    }

    function parar() {
        window.clearInterval(relogio);
        window.clearInterval(relogioCompleto);
        relogio = 0;
        relogioCompleto = 0;
        document.removeEventListener("visibilitychange", aoMostrar);
        window.removeEventListener("focus", olhar);
        window.removeEventListener("online", olhar);
    }

    function aoMostrar() {
        if (!document.hidden) {
            olhar();
        }
    }

    function comecar() {
        relogio = window.setInterval(olhar, OLHADA);
        relogioCompleto = window.setInterval(perguntar, COMPLETA);
        document.addEventListener("visibilitychange", aoMostrar);
        window.addEventListener("focus", olhar);
        window.addEventListener("online", olhar);
        /* Voltar pelo botão de voltar devolve a página do cache, congelada no
           instante em que saiu: a olhada compara o contador de lá com o de
           agora, e o que mudou nesse meio tempo vem. */
        window.addEventListener("pageshow", function (evento) {
            if (evento.persisted) {
                olhar();
            }
        });
        olhar();
    }

    /* Depois do `load`, e não já: as telas se inscrevem nos próprios scripts,
       que rodam depois deste, e a do calendário só no DOMContentLoaded. E
       página pré-renderizada pelo menu ainda não é a página da pessoa. */
    function quandoPronta() {
        if (document.prerendering) {
            document.addEventListener("prerenderingchange", comecar, { once: true });
        } else {
            comecar();
        }
    }

    if (document.readyState === "complete") {
        quandoPronta();
    } else {
        window.addEventListener("load", quandoPronta, { once: true });
    }
})(window.EN);
