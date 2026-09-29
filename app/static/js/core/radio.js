/* A rádio lo-fi do canto da tela.

   O áudio vem DIRETO da rádio: o servidor só diz o nome da música, que o
   `<audio>` não enxerga (ver app/services/radio.py). O cartão nasce pronto no
   HTML (partials/radio.html); aqui mora o comportamento.

   ## O site troca de página, a rádio não pode parar

   Cada tela é uma página nova, e página nova é `<audio>` novo. O que dá para
   fazer é a próxima página continuar sozinha: a intenção ("estava tocando,
   nesta estação, neste volume") fica no localStorage, e a página que abre
   retoma o stream. É ao vivo, então não há "de onde parou" -- só o silêncio
   de reconectar, menos de um segundo com a página pré-renderizada.

   O navegador só deixa tocar sem clique numa página se a pessoa já interagiu
   com o site; vindo de um clique no menu, o Chrome aceita. Onde ele recusar,
   o botão de play fica pulsando e um toque retoma.

   ## Uma aba toca, as outras esperam

   Duas abas abertas tocando a mesma rádio são um eco. A aba que toca manda um
   sinal de vida a cada poucos segundos; a página que abre só retoma sozinha se
   nenhuma OUTRA aba estiver tocando. E quem aperta play numa aba cala as
   outras. A identidade da aba mora no sessionStorage, que sobrevive à troca de
   página dentro dela e não passa para outra aba. */
window.EN = window.EN || {};

(function (EN) {
    "use strict";

    const raiz = document.getElementById("radio");
    if (!raiz) {
        return;
    }

    const CHAVE = "en_radio";
    const CHAVE_PAINEL = "en_radio_painel";
    const CHAVE_VIVO = "en_radio_vivo";
    const CHAVE_ABA = "en_radio_aba";

    /* Mesmo intervalo do cache do servidor: perguntar mais vezes só devolveria
       a mesma resposta. Com a aba escondida, a tela ninguém vê -- mas a tela
       de bloqueio do celular mostra a música, então continua, mais devagar. */
    const INTERVALO_MS = 25000;
    const INTERVALO_ESCONDIDA_MS = 60000;
    const VIVO_MS = 4000;
    const VIVO_VALE_MS = 9000;
    const MAX_TENTATIVAS = 5;
    const VOLUME_ABAIXADO = 0.25;
    const RAMPA_MS = 300;

    const html = document.documentElement;
    const endereco = raiz.dataset.agora;
    const estacoes = Array.prototype.map.call(
        raiz.querySelectorAll("[data-radio-estacao]"),
        function (botao) {
            return {
                id: botao.dataset.radioEstacao,
                stream: botao.dataset.stream,
                site: botao.dataset.site,
                nome: botao.dataset.nome,
                fonte: botao.dataset.fonte,
                descricao: botao.querySelector(".radio-estacao-desc").textContent,
                botao: botao,
            };
        }
    );
    const botoesPlay = raiz.querySelectorAll('[data-radio="alternar"]');
    const abrir = raiz.querySelector(".radio-abrir");
    const volumeEl = raiz.querySelector('[data-radio="volume"]');
    const fonteEl = raiz.querySelector('[data-radio-campo="fonte"]');

    const aba = (function () {
        try {
            let id = sessionStorage.getItem(CHAVE_ABA);
            if (!id) {
                id = Math.random().toString(36).slice(2);
                sessionStorage.setItem(CHAVE_ABA, id);
            }
            return id;
        } catch (e) {
            return Math.random().toString(36).slice(2);
        }
    })();
    const canal = "BroadcastChannel" in window ? new BroadcastChannel("en-radio") : null;

    let estado = ler();
    let audio = null;
    let tentativas = 0;
    let religar = 0;
    let relogio = 0;
    let vivo = 0;
    let abaixados = 0;
    let rampa = 0;
    let pausaNossa = 0;
    let musica = { titulo: "", artista: "" };

    /* ----------------------------------------------------------- estado */

    function ler() {
        const padrao = { estacao: estacoes[0].id, tocando: false, volume: 0.7 };
        try {
            const salvo = JSON.parse(localStorage.getItem(CHAVE) || "{}");
            const volume = Number(salvo.volume);
            return {
                estacao: estacoes.some(function (e) { return e.id === salvo.estacao; }) ? salvo.estacao : padrao.estacao,
                tocando: salvo.tocando === true,
                volume: volume >= 0 && volume <= 1 ? volume : padrao.volume,
            };
        } catch (e) {
            return padrao;
        }
    }

    function gravar() {
        try {
            localStorage.setItem(CHAVE, JSON.stringify(estado));
        } catch (e) {}
    }

    function atual() {
        return estacoes.find(function (e) { return e.id === estado.estacao; }) || estacoes[0];
    }

    function tocandoAqui() {
        return !!audio && !audio.paused;
    }

    /* ----------------------------------------------------------- desenho */

    function campo(nome, texto) {
        raiz.querySelectorAll('[data-radio-campo="' + nome + '"]').forEach(function (el) {
            el.textContent = texto;
        });
    }

    function pintar() {
        const estacao = atual();
        const tocando = tocandoAqui();
        raiz.dataset.tocando = tocando ? "sim" : "nao";

        botoesPlay.forEach(function (botao) {
            botao.setAttribute("aria-label", tocando ? "Pausar a rádio" : "Tocar a rádio");
            botao.firstElementChild.textContent = tocando ? "⏸" : "▶";
        });
        estacoes.forEach(function (e) {
            e.botao.setAttribute("aria-pressed", String(e.id === estacao.id));
        });

        fonteEl.href = estacao.site;
        fonteEl.textContent = estacao.nome + " · " + estacao.fonte + " ↗";
        volumeEl.value = String(Math.round(estado.volume * 100));

        if (tocando && musica.titulo) {
            campo("titulo", musica.titulo);
            campo("artista", musica.artista || estacao.nome);
        } else {
            campo("titulo", estacao.nome);
            campo("artista", tocando ? estacao.descricao : "toque para ouvir");
        }
    }

    function status(texto) {
        campo("status", texto || "");
    }

    function painelAberto() {
        return html.dataset.radioPainel === "aberto";
    }

    function mostrarPainel(aberto) {
        html.dataset.radioPainel = aberto ? "aberto" : "fechado";
        abrir.setAttribute("aria-expanded", String(aberto));
        try {
            localStorage.setItem(CHAVE_PAINEL, aberto ? "aberto" : "fechado");
        } catch (e) {}
    }

    /* ------------------------------------------------------------- áudio */

    function volumeAlvo() {
        return estado.volume * (abaixados > 0 ? VOLUME_ABAIXADO : 1);
    }

    /* `volume` do `<audio>` não tem rampa própria, e pular direto de 0.7 para
       0.17 é um tranco no ouvido. Trezentos milissegundos em passos por quadro. */
    function rampaPara(alvo) {
        if (!audio) {
            return;
        }
        cancelAnimationFrame(rampa);
        const de = audio.volume;
        const inicio = performance.now();
        function passo(agora) {
            const t = Math.min(1, (agora - inicio) / RAMPA_MS);
            audio.volume = de + (alvo - de) * t;
            if (t < 1) {
                rampa = requestAnimationFrame(passo);
            }
        }
        rampa = requestAnimationFrame(passo);
    }

    function criarAudio() {
        audio = new Audio();
        audio.preload = "none";

        audio.addEventListener("playing", function () {
            tentativas = 0;
            raiz.dataset.carregando = "nao";
            raiz.dataset.bloqueado = "nao";
            status("");
            pintar();
            anunciarVida();
        });
        audio.addEventListener("waiting", function () {
            raiz.dataset.carregando = "sim";
        });
        /* Pausa que não veio daqui: fone desconectado, o sistema tomando o
           áudio para uma ligação. Vale como pausa da pessoa. */
        audio.addEventListener("pause", function () {
            if (estado.tocando && !pausaNossa) {
                estado.tocando = false;
                gravar();
                desligarStream();
            }
            pintar();
        });
        audio.addEventListener("error", function () {
            if (estado.tocando && audio.getAttribute("src")) {
                reconectar();
            }
        });
    }

    /* O evento `pause` chega DEPOIS, numa tarefa própria -- uma marca limpa
       na mesma função já teria sumido quando ele chegasse, e a troca de
       estação ou a outra aba calando esta seriam lidas como "a pessoa
       pausou", apagando a intenção de ouvir para todas as abas. Uma janela
       curta resolve: o que pausar logo depois de uma ação daqui é daqui. */
    function marcarPausaNossa() {
        clearTimeout(pausaNossa);
        pausaNossa = setTimeout(function () { pausaNossa = 0; }, 1000);
    }

    /* Fecha a conexão de verdade. `pause()` sozinho deixa o navegador baixando
       o stream ao vivo para um buffer que ninguém vai ouvir. */
    function desligarStream() {
        if (!audio) {
            return;
        }
        marcarPausaNossa();
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        raiz.dataset.carregando = "nao";
    }

    function tocar() {
        clearTimeout(religar);
        if (!audio) {
            criarAudio();
        }
        const estacao = atual();
        /* Sempre `src` de novo, mesmo na mesma estação: retomar o buffer antigo
           tocaria o passado, e é rádio. Trocar o `src` de quem toca pausa. */
        marcarPausaNossa();
        audio.src = estacao.stream;
        audio.volume = volumeAlvo();
        estado.tocando = true;
        gravar();
        raiz.dataset.carregando = "sim";
        status("conectando…");
        calarOutrasAbas();

        audio.play().then(function () {
            atualizarMusica();
        }).catch(function (erro) {
            raiz.dataset.carregando = "nao";
            if (erro && erro.name === "NotAllowedError") {
                /* O navegador quer um clique antes do som. A intenção fica:
                   um toque no play, que pulsa, retoma. */
                raiz.dataset.bloqueado = "sim";
                status("toque ▶ para continuar a rádio");
                desligarStream();
                estado.tocando = true;
                gravar();
                pintar();
            } else if (erro && erro.name !== "AbortError") {
                reconectar();
            }
        });
        pintar();
        agendarMusica();
    }

    function pausar() {
        clearTimeout(religar);
        estado.tocando = false;
        gravar();
        desligarStream();
        pararMusica();
        esquecerVida();
        status("");
        pintar();
    }

    function reconectar() {
        desligarStream();
        tentativas += 1;
        if (tentativas > MAX_TENTATIVAS) {
            estado.tocando = false;
            gravar();
            pararMusica();
            status("A rádio não respondeu. Tente outra estação.");
            pintar();
            return;
        }
        status("sem sinal, tentando de novo…");
        religar = setTimeout(tocar, 1000 * Math.pow(2, tentativas - 1));
    }

    function selecionar(id) {
        if (id === estado.estacao && tocandoAqui()) {
            return;
        }
        estado.estacao = id;
        musica = { titulo: "", artista: "" };
        tentativas = 0;
        gravar();
        tocar();
    }

    function vizinha(passo) {
        const i = estacoes.indexOf(atual());
        selecionar(estacoes[(i + passo + estacoes.length) % estacoes.length].id);
    }

    /* --------------------------------------------------- a música que toca */

    function atualizarMusica() {
        if (!estado.tocando) {
            return;
        }
        const id = estado.estacao;
        fetch(endereco.replace("ESTACAO", encodeURIComponent(id)), {
            headers: { Accept: "application/json" },
            credentials: "same-origin",
        })
            .then(function (resposta) { return resposta.ok ? resposta.json() : null; })
            .then(function (dados) {
                if (!dados || id !== estado.estacao) {
                    return;
                }
                musica = { titulo: dados.titulo || "", artista: dados.artista || "" };
                pintar();
                sessaoDeMidia();
            })
            .catch(function () {});
    }

    function agendarMusica() {
        clearTimeout(relogio);
        relogio = setTimeout(function () {
            atualizarMusica();
            agendarMusica();
        }, document.hidden ? INTERVALO_ESCONDIDA_MS : INTERVALO_MS);
    }

    function pararMusica() {
        clearTimeout(relogio);
    }

    /* A música na tela de bloqueio e nas teclas de mídia do teclado. */
    function sessaoDeMidia() {
        if (!("mediaSession" in navigator) || !window.MediaMetadata) {
            return;
        }
        const estacao = atual();
        navigator.mediaSession.metadata = new MediaMetadata({
            title: musica.titulo || estacao.nome,
            artist: musica.artista || estacao.descricao,
            album: "Rádio lo-fi · " + estacao.nome,
        });
    }

    function ligarTeclasDeMidia() {
        if (!("mediaSession" in navigator)) {
            return;
        }
        const acoes = {
            play: tocar,
            pause: pausar,
            stop: pausar,
            nexttrack: function () { vizinha(1); },
            previoustrack: function () { vizinha(-1); },
        };
        Object.keys(acoes).forEach(function (acao) {
            try {
                navigator.mediaSession.setActionHandler(acao, acoes[acao]);
            } catch (e) {}
        });
    }

    /* --------------------------------------------------------- outras abas */

    function anunciarVida() {
        clearInterval(vivo);
        const marcar = function () {
            try {
                localStorage.setItem(CHAVE_VIVO, JSON.stringify({ aba: aba, em: Date.now() }));
            } catch (e) {}
        };
        marcar();
        vivo = setInterval(marcar, VIVO_MS);
    }

    function esquecerVida() {
        clearInterval(vivo);
        try {
            const vida = JSON.parse(localStorage.getItem(CHAVE_VIVO) || "null");
            if (vida && vida.aba === aba) {
                localStorage.removeItem(CHAVE_VIVO);
            }
        } catch (e) {}
    }

    function outraAbaTocando() {
        try {
            const vida = JSON.parse(localStorage.getItem(CHAVE_VIVO) || "null");
            return !!vida && vida.aba !== aba && Date.now() - vida.em < VIVO_VALE_MS;
        } catch (e) {
            return false;
        }
    }

    function calarOutrasAbas() {
        if (canal) {
            canal.postMessage({ tipo: "tocando", aba: aba });
        }
    }

    if (canal) {
        /* Outra aba começou a tocar: esta para, SEM gravar a pausa -- a
           intenção de ouvir continua valendo, só mudou de aba. */
        canal.addEventListener("message", function (evento) {
            if (evento.data && evento.data.tipo === "tocando" && evento.data.aba !== aba && tocandoAqui()) {
                clearTimeout(religar);
                clearInterval(vivo);
                desligarStream();
                pararMusica();
                status("tocando em outra aba");
                pintar();
            }
        });
    }

    /* --------------------------------------- avisos por cima da música */

    /* Um aviso (fim do foco, água, agenda) abaixa a rádio enquanto toca e
       devolve o volume depois. Contador, e não liga-desliga: dois avisos
       juntos não podem devolver o volume no fim do primeiro. */
    document.addEventListener("en:aviso-sonoro", function (evento) {
        const fonte = evento.detail && evento.detail.fonte;
        if (!fonte) {
            return;
        }
        let comecou = false;
        let acabou = false;
        const soltar = function () {
            if (comecou && !acabou) {
                acabou = true;
                abaixados = Math.max(0, abaixados - 1);
                rampaPara(volumeAlvo());
            }
        };
        fonte.addEventListener("ended", function () {
            /* `ended` antes de começar é som agendado que foi cancelado. */
            if (!comecou) {
                acabou = true;
                return;
            }
            setTimeout(soltar, 400);
        });
        setTimeout(function () {
            if (acabou) {
                return;
            }
            comecou = true;
            abaixados += 1;
            rampaPara(volumeAlvo());
            /* Rede de segurança: nenhum aviso dura quinze segundos. */
            setTimeout(soltar, 15000);
        }, evento.detail.emMs || 0);
    });

    /* ------------------------------------------------------------ eventos */

    raiz.addEventListener("click", function (evento) {
        const estacao = evento.target.closest("[data-radio-estacao]");
        if (estacao) {
            selecionar(estacao.dataset.radioEstacao);
            return;
        }
        const botao = evento.target.closest("[data-radio]");
        if (!botao) {
            return;
        }
        const acao = botao.dataset.radio;
        if (acao === "alternar") {
            if (tocandoAqui()) {
                pausar();
            } else {
                tentativas = 0;
                tocar();
            }
        } else if (acao === "painel") {
            mostrarPainel(!painelAberto());
        } else if (acao === "proxima") {
            vizinha(1);
        } else if (acao === "anterior") {
            vizinha(-1);
        }
    });

    volumeEl.addEventListener("input", function () {
        estado.volume = Number(volumeEl.value) / 100;
        if (audio) {
            cancelAnimationFrame(rampa);
            audio.volume = volumeAlvo();
        }
        gravar();
    });

    raiz.addEventListener("keydown", function (evento) {
        if (evento.key === "Escape" && painelAberto()) {
            mostrarPainel(false);
            abrir.focus();
        }
    });

    document.addEventListener("visibilitychange", function () {
        if (!document.hidden && estado.tocando && tocandoAqui()) {
            atualizarMusica();
            agendarMusica();
        }
    });

    window.addEventListener("pagehide", esquecerVida);

    /* ------------------------------------------------------------ começo */

    function comecar() {
        abrir.setAttribute("aria-expanded", String(painelAberto()));
        ligarTeclasDeMidia();
        pintar();
        if (!estado.tocando) {
            return;
        }
        if (outraAbaTocando()) {
            status("tocando em outra aba");
            return;
        }
        tocar();
    }

    /* Página pré-renderizada pelo menu ainda não é a página da pessoa: tocar
       ali seria som saindo de uma tela que ela nem abriu. Espera a ativação. */
    if (document.prerendering) {
        document.addEventListener("prerenderingchange", comecar, { once: true });
    } else {
        comecar();
    }

    EN.radio = {
        tocar: tocar,
        pausar: pausar,
        estado: function () {
            return {
                estacao: estado.estacao,
                tocando: tocandoAqui(),
                volume: estado.volume,
                /* O volume de fato agora, com o aviso abaixando por cima. */
                volumeAtual: audio ? audio.volume : null,
                musica: musica,
            };
        },
    };
})(window.EN);
