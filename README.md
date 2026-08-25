# Event Notifier (Python + Flask)

Aplicativo simples para cadastrar eventos e enviar notificações em:
- Web Push (notificação do navegador/Windows sem Python local)
- Desktop local opcional (quando rodando no Windows)

Website:
- https://events-beazeth.onrender.com/

Recursos de interface:
- Tag de tipo no cadastro: `Evento` ou `Curso`, cada uma com cor própria
- Sidebar com menu de navegação
- Aba de calendário grande para visualizar eventos e cursos
- Aba **Weekly Planner**: grade semanal de 24 horas com blocos arrastáveis
- Aba **Pomodoro** 🍎: temporizador com ampulheta girando, que segue contando na barra lateral enquanto você navega
- **Home** é o quadro de **post-its**: papel livre, arrastável, redimensionável e colorido
- Cadastro e lista de eventos numa aba própria (`/events`)
- Aba de aparência com preview visual
- 10 temas e 10 fontes selecionáveis
- Seleção de tema e fonte por cards de preview (sem dropdown)
- Dark mode no menu lateral, aplicado em toda a interface (inclusive fundo e calendário)
- Nova aba de lembrete de beber água com intervalo e janela de horário
- Microanimações suaves de interface e sons de clique baixos
- Data com horário opcional no cadastro de evento
- PWA (manifest + service worker com cache de estáticos)
- Inscrição de notificações web direto no menu lateral

Regras de lembrete:
- Todo evento: notificação na hora do evento
- Se tag = curso: também notifica com 15 dias e 7 dias de antecedência

## Weekly Planner

Grade semanal no estilo Morgen, em `/planner`:

- Segunda a sexta por padrão, com toggle para exibir sábado e domingo
- As 24 horas do dia, com botão para focar no horário útil (06:00–23:00)
- Arraste numa coluna para criar um bloco; arraste o bloco para mover entre dias e horários
- Arraste as bordas superior/inferior para redimensionar (grade de 15 minutos)
- Clique num bloco para editar título, notas, horário, dia e cor; `Delete` remove o selecionado
- Marque **Rotina** para o bloco se repetir em todos os dias da semana
- Zoom de altura da hora, linha de horário atual e destaque do dia de hoje
- Preferências (fim de semana, zoom, faixa de horas) ficam no `localStorage`

Endpoints:

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/planner/blocks` | Lista todos os blocos |
| `POST` | `/api/planner/blocks` | Cria um bloco |
| `PUT` | `/api/planner/blocks/<id>` | Atualiza um bloco |
| `DELETE` | `/api/planner/blocks/<id>` | Remove um bloco |

Blocos de rotina são gravados com `day_of_week = -1` e renderizados em todas as colunas visíveis.

## Post-its (tela inicial)

O quadro de post-its é a home (`/`). Não é uma caixa com moldura e rolagem
própria: ocupa a largura da página e cresce em altura conforme os papéis descem,
então os cartões ficam soltos sobre a mesa em vez de presos a uma grade.

- **Novo post-it** cria a nota já em modo de edição, num espaço livre do quadro
- Edição inline: o corpo do cartão é o próprio campo de texto, sem modal
- Arraste pela fita do topo e redimensione pelo canto inferior direito
- Cada papel nasce com uma inclinação leve, derivada do id (não muda a cada render)
- O botão 🎨 abre a paleta com as seis cores do projeto
- Cada post-it tem uma categoria (Hoje, Amanhã, Semana, Ideias); o botão da categoria alterna entre elas
- Os chips do topo filtram por categoria, e o filtro escolhido fica no `localStorage`
- **Organizar** realinha os post-its visíveis em fileiras
- `Esc` sai da edição

No desktop o cartão arrasta de qualquer ponto que não seja o texto ou um botão.
No toque só a fita do topo e o canto de redimensionar arrastam, para o resto da
área continuar rolando a página. O eixo vertical é livre e o quadro acompanha; o
horizontal é limitado à largura visível para nenhum papel sumir da tela.

A persistência é no SQLite, no mesmo banco do resto do app. O `localStorage`
guarda apenas uma cópia de leitura, usada para o quadro continuar visível quando
o servidor não responde.

Endpoints:

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/api/notes` | Lista todos os post-its |
| `POST` | `/api/notes` | Cria um post-it |
| `PATCH` | `/api/notes/<id>` | Atualiza só os campos enviados |
| `DELETE` | `/api/notes/<id>` | Remove um post-it |

O `PATCH` é parcial de propósito: o arraste salva geometria e o editor salva
texto, os dois com debounce. Um `PUT` completo faria um sobrescrever o campo do
outro quando as duas gravações se cruzassem.

Sobre as bibliotecas de componentes pedidas: Origin UI, Skiper UI e Cult UI são
registries React + Tailwind + shadcn, e este projeto é Flask + Jinja + JS puro,
sem npm e sem build. Instalá-las exigiria trazer React, Tailwind e um bundler
para um projeto que hoje não tem nenhum dos três. Os padrões aproveitados delas
(cartão com textura de papel, cartão que ganha relevo em edição, dock de ações,
grupo de swatches, molas de entrada e saída) foram reimplementados sobre os
tokens de tema que já existem no CSS.

## Pomodoro

Temporizador em `/pomodoro`, com widget que acompanha o usuário pelo site.

- Seis tempos prontos (5, 15, 25, 30, 45 e 60 min) ou qualquer valor de 1 a 600
- Ampulheta girando no eixo vertical, com a areia escoando **no ritmo do tempo
  configurado** — o nível é a mesma fração que move o anel de progresso
- Ao começar, o timer vira um widget na barra lateral: tempo, ampulheta, barra de
  progresso e botões de pausar/parar, presentes em todas as telas
- Faltando 5 minutos, tela e widget mudam para âmbar e ganham um pulso. Em timers
  de até 5 min a regra vira "últimos 20%", senão um pomodoro de 3 minutos nasceria
  em estado de alerta
- No fim, um sino sintetizado (tríade dó–mi–sol em seno, pico de volume 0.075)

Três decisões que valem registro:

**O giro é em torno do eixo vertical, não uma virada de 180°.** Virar a ampulheta
de cabeça para baixo é incompatível com mostrar o tempo: depois da virada o bulbo
cheio passa a ser o de cima, e a areia teria de subir para a contagem continuar.
Girando em Y, "para baixo" nunca muda de lugar.

**O som é agendado no relógio do WebAudio, não em `setTimeout`.** Aba em segundo
plano tem `setInterval`/`setTimeout` estrangulados — chegam a disparar uma vez por
minuto. O relógio do WebAudio roda em thread própria e não sofre isso, então o
sino toca na hora exata mesmo com a aba escondida. Quem detecta o fim consulta se
o som já estava garantido, para não tocar duas vezes.

**O estado mora no localStorage, não no banco.** O widget precisa aparecer já
pintado a cada navegação; o que se guarda é `endsAt` (epoch absoluto), então
recarregar ou dormir a máquina não desalinha a contagem; e um timer rodando é do
aparelho — sincronizar pelo servidor faria o celular herdar o pomodoro do
notebook.

## Bibliotecas

| Biblioteca | Situação | Decisão |
| --- | --- | --- |
| **flatpickr** | Upstream congelado (4.6.13, sem release há anos), mas estável, sem dependências e ~50 KB | Mantida e **fixada em `@4.6.13`**. Estava sem versão na URL do CDN, ou seja, o jsDelivr entregava sempre a última: um release quebrado derrubaria o seletor de data em produção sem aviso. As alternativas atuais são todas React. |
| **FullCalendar** | Ativa (6.1.21) | Atualizada de 6.1.17 → 6.1.21. O `<link>` para `index.global.min.css` foi **removido**: o FullCalendar 6 não publica arquivo de CSS (o bundle JS injeta os estilos), então aquele link respondia 404 em toda visita à tela. |
| **plyer** | Só usada por `send_desktop_notification`, que só funciona no Windows | Import movido para dentro da função e marcada como opcional (`; sys_platform == "win32"`). No container Linux ela era instalada e importada sem nunca poder ser usada. |
| Flask, APScheduler, python-dotenv, pywebpush, gunicorn | Adequadas ao porte do projeto | Mantidas |
| **cryptography 42.0.8** | De meados de 2024, arrastada pelo pywebpush | Vale atualizar num passo próprio, com teste do Web Push junto — é a dependência mais sensível a correções de segurança. |

Nenhuma biblioteca nova foi adicionada.

## Performance

Medido com Playwright + throttle de CPU 4x, 35 blocos no planner, mediana de 5 execuções:

| Cenário | Antes | Depois |
| --- | --- | --- |
| Scroll do planner | 7 fps (70% dos frames perdidos) | **60 fps (0% perdidos)** |
| Scroll da home | 8 fps | **58 fps** |
| Slider de zoom do planner | 4 fps | **60 fps** |
| CSS de fontes por página | 102 KB | **8 KB** (102 KB só em `/appearance`) |

As três causas, isoladas por teste A/B:

1. **`backdrop-filter: blur()` nos cartões** — obrigava o compositor a reamostrar o fundo a cada frame. Sozinho respondia por toda a queda de 60 para 30 fps. Substituído por uma superfície opaca equivalente (`--surface-solid`, o `--surface` translúcido sobre uma camada sólida do fundo do tema). O blur ficou só no fundo do modal, que é um elemento único e sem scroll atrás.
2. **`repeating-linear-gradient` das linhas da grade** — mudar o zoom repintava a grade inteira (24h x 7 colunas). Trocado por um tile pequeno com `background-size`, que o browser rasteriza uma vez e replica.
3. **Atraso artificial de 80 ms em cada navegação** — o clique no menu dava `preventDefault` e esperava um `setTimeout` antes de trocar de página. Removido; a transição visual agora é `@view-transition` nativa, que não custa nada e não atrasa.

## Otimizações aplicadas

- Fontes: só as duas famílias do tema padrão bloqueiam a renderização; as outras 18 (usadas apenas nos previews) carregam de forma assíncrona
- Estáticos servidos com `?v=<mtime>` e `Cache-Control: immutable` de 1 ano
- Service worker com cache-first para `/static/` (seguro, pois as URLs são versionadas)
- Scripts com `defer` e tema aplicado antes da primeira pintura (sem flash de tema errado)
- SQLite em modo WAL com `busy_timeout`, para o scheduler não travar as requisições
- Índices em `events(event_datetime)`, `reminder_dispatches` e `planner_blocks(day_of_week, start_minute)`
- `preconnect`/`dns-prefetch` para os CDNs usados
- Geometria dos blocos do planner derivada de CSS custom properties: o zoom vira recálculo de estilo, sem reconstruir DOM
- `pointermove` do arraste agrupado em `requestAnimationFrame`, com o rect do canvas em cache (evita reflow síncrono por evento)
- `contain: layout paint style` nas colunas do planner
- Animações restritas a `transform`/`opacity` (rodam no compositor), respeitando `prefers-reduced-motion`
- Post-its com geometria em custom properties e `transform`: arrastar não passa por layout, e as gravações são agrupadas por debounce (uma requisição por pausa, não por tecla ou pixel)
- Ampulheta do pomodoro inteiramente em CSS: o giro é `@keyframes` e o nível da areia é `scaleY(var(--pomo-progress))`, então o JS escreve uma variável 4x por segundo e nada mais — nenhum trabalho por quadro
- Proporções da tela do pomodoro por `clamp()`, `cqi` (container query) e `auto-fit`: o mostrador se dimensiona pela largura do cartão, não da janela, e sobrou um único media query (para mudança de layout, não de tamanho)
- Um único `AudioContext` para toda a interface (`core/audio.js`): dois contextos no mesmo documento significariam dois desbloqueios independentes, e o som do fim do timer não sairia em metade das visitas
- Modal de evento fora do CSS global: cinco das sete telas deixaram de baixá-lo

## Estrutura

O projeto fica na raiz do repositório. Cada camada tem seu lugar: rotas por
tela, acesso a dados por tabela, e CSS/JS por página.

```
app/
  __init__.py            fábrica da aplicação (só monta e agenda)
  config.py              variáveis de ambiente
  assets.py              versionamento de estáticos + headers de resposta
  extensions.py          scheduler compartilhado
  blueprints/            uma rota por tela/recurso
    system.py            /healthz, /sw.js, /favicon.ico
    home.py              /            (quadro de post-its)
    events.py            /events      (cadastro e lista)
    calendar.py          /calendar    + /api/events
    planner.py           /planner     + /api/planner/blocks
    pomodoro.py          /pomodoro    (tempos prontos; o timer é do cliente)
    notes.py             /api/notes
    appearance.py        /appearance
    hydration.py         /hydration
    push.py              /api/push/*  + /api/live/notifications
  db/                    uma tabela por módulo
    connection.py        conexão SQLite (WAL, timeouts)
    schema.py            CREATE TABLE, migrações e índices
    events.py  reminders.py  hydration.py  push.py  planner.py  notes.py
  services/
    notifier.py          envio desktop e web push
    scheduler_service.py varredura de lembretes
  static/
    css/
      base.css           tokens, reset, layout, sidebar, cartões, forms, botões
      components.css     o que existe em TODA tela: caixas da sidebar, toggle de
                         dark mode, ampulheta e widget do pomodoro
      components/        componente de 2-3 telas, carregado só por elas
        modal.css        modal de evento (calendário e planner)
      themes.css         10 temas, 10 fontes, dark mode, responsivo
      pages/             notes, planner, calendar, events, appearance, hydration,
                         pomodoro
      vendor/            tema do flatpickr e do FullCalendar
    js/
      core/              shared (namespace + utils), theme, audio, ui-effects,
                         push, pomodoro
      pages/
        notes/           constants, context, store, card, board, interactions, main
        planner/         constants, time, context, grid, blocks, store, drag, editor, main
        calendar/        calendar.js
        events/          datepicker.js
        pomodoro/        main.js
    sw.js  manifest.webmanifest  icon.svg
  templates/
    layouts/base.html    casca da página
    partials/            sidebar, menu, flash, bootstrap de tema, widget do
                         pomodoro, macro da ampulheta
    pages/               home, events, calendar, planner, pomodoro, appearance,
                         hydration
tools/                   geração de chaves VAPID
Dockerfile  requirements.txt  run.py  wsgi.py  .env.example
```

Cada página carrega só o CSS e o JS da própria tela, além da base comum.

O que decide onde uma regra de CSS mora é o **alcance**, não o assunto: em toda
tela vai para `components.css`; em duas ou três vai para `css/components/`,
carregado só por elas; em uma só vai para `css/pages/`. Foi por essa regra que o
modal de evento saiu do pacote global — cinco telas baixavam 70 linhas de CSS de
um modal que nunca abriria ali.

Os três arquivos da base são faixas contíguas do CSS original e precisam
ser carregados nesta ordem (`base` → `components` → `themes`): trocar a
sequência muda a cascata, porque `themes.css` sobrescreve cores das outras duas.

**Por que namespace global e não `import` no JS:** os estáticos são servidos com
`?v=<mtime>` e o service worker usa cache-first justamente porque as URLs são
versionadas. Um `import "./x.js"` estático não carrega a versão, então o service
worker serviria submódulo velho para sempre. Os módulos conversam por
`window.EN` e a ordem vem das tags `<script defer>`, que executam em ordem.

As regras de organização, otimização e componentização que valem para qualquer
tela nova estão em [CONSTITUTION.md](CONSTITUTION.md).

## Como rodar

1. Crie e ative o ambiente virtual (Windows PowerShell):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2. Instale as dependências:

```bash
pip install -r requirements.txt
```

3. Crie o `.env` a partir do exemplo:

```powershell
Copy-Item .env.example .env
```

4. Ajuste as variáveis locais do app no `.env` se necessário.

5. Gere chaves VAPID para Web Push:

```bash
python tools/generate_vapid_keys.py
```

Copie os valores para o `.env`:

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:voce@exemplo.com
```

6. Execute:

```bash
python run.py
```

7. Acesse no navegador:

http://127.0.0.1:5000

Telas: `/` (post-its), `/events` (cadastro e lista), `/calendar`, `/planner`,
`/appearance`, `/hydration`.

## Observações importantes

- Web Push funciona melhor em HTTPS (produção).
- Em localhost também pode funcionar para testes.
- Notificação desktop local depende da máquina Windows com o app rodando.
- O scheduler roda a cada 60 segundos e aceita atraso de até 5 minutos para não perder lembretes.

## Docker (recomendado para deploy simples)

Build:

```bash
docker build -t event-notifier .
```

Run:

```bash
docker run -p 8000:8000 --env-file .env event-notifier
```

Nota: o container usa `gunicorn -w 1` para evitar execução duplicada do scheduler de lembretes.

## Deploy gratuito sugerido

Opções práticas gratuitas:
- Render (web service com Docker)
- Railway (container + variáveis de ambiente)

Passos gerais:
1. Subir o projeto para GitHub
2. Criar serviço apontando para o `Dockerfile`
3. Configurar variáveis do `.env` no painel da plataforma
4. Usar URL HTTPS gerada para ativar Web Push no navegador
