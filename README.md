# Event Notifier (Python + Flask)

Aplicativo simples para cadastrar eventos e enviar notificações em:
- Web Push (notificação do navegador/Windows sem Python local)
- Desktop local opcional (quando rodando no Windows)

Website:
- https://events-beazeth.onrender.com/

**Cada pessoa tem a própria conta e o próprio espaço.** Nada é compartilhado, e
os dados ficam num Postgres gerenciado — sobrevivem a build, deploy e restart.
Detalhes em [Contas e privacidade dos dados](#contas-e-privacidade-dos-dados).

Recursos de interface:
- Conta com e-mail e senha; o espaço já nasce com as tags padrão
- Tags criadas por você: nome, cor e regra de lembrete próprios; `Evento` e `Curso` vêm prontas
- Sidebar com menu de navegação
- Calendário grande como tela única dos eventos: clique num dia para agendar naquela data
- O dia sob o mouse acende e o dia clicado fica marcado enquanto o popup está aberto
- “Próximos eventos” lista os 5 mais próximos; lado a lado com o mês em telas largas, embaixo dele nas demais
- Aba **Weekly Planner**: grade semanal de 24 horas com blocos arrastáveis
- Aba **To-do** ✅: lista da semana no formato de agenda de papel, com navegação por semana
- Aba **Pomodoro** 🍎: temporizador com ampulheta que chacoalha de vez em quando e segue contando na barra lateral enquanto você navega
- **Home** é o quadro de **post-its**: papel livre, arrastável, redimensionável e colorido
- Cadastro e edição de evento em popup do calendário, com “Próximos eventos” na coluna ao lado
- Aba de aparência com preview visual
- 10 temas e 10 fontes selecionáveis
- Seleção de tema e fonte por cards de preview (sem dropdown)
- Dark mode no menu lateral, aplicado em toda a interface (inclusive fundo e calendário)
- Aba **Beber água** 💧: copo que enche com a meta do dia, gole animado ao registrar, e widget na barra lateral
- Microanimações suaves de interface e sons de clique baixos
- Som próprio quando a notificação chega com a aba aberta, distinto do sino do pomodoro
- Data com horário opcional no cadastro de evento
- PWA (manifest + service worker com cache de estáticos)
- Inscrição de notificações web direto no menu lateral

Regras de lembrete (escolhidas por tag, ao criar a tag):
- **Só no dia**: notificação na hora do evento
- **Com antecedência**: na hora, e também 15 e 7 dias antes

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

A persistência é no Postgres, no mesmo banco do resto do app e escopada pela sua conta. O `localStorage`
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

## To-do da semana

Lista semanal em `/todo`, no formato de agenda de papel: número do dia grande à
esquerda, linha tracejada separando os dias, caixinhas à direita.

- Segunda a domingo, com o dia de hoje circulado
- Marcar, escrever, apagar — tudo sem sair da página
- Estrela no dia com tudo concluído; placar da semana no topo
- Trocar de semana é **navegação de verdade** (`/todo?semana=2026-08-17`): cada
  semana tem URL própria, o voltar do navegador funciona e a tela chega pintada
  do servidor em vez de montada por fetch depois da pintura

Duas decisões que valem registro:

**O item pertence a um DIA, não a uma semana.** A semana é só o recorte que a
tela mostra. Assim navegar entre semanas é uma consulta por intervalo, e mover um
item de dia é um `UPDATE` de uma coluna só.

**Os contadores são recontados do DOM, não incrementados.** Depois de cada
mudança a tela varre os itens e refaz estrela e placar. Um contador que se
corrige sozinho não acumula erro ao longo da sessão — e a interface é otimista,
então erros de rede desfazem passos no meio do caminho.

## Beber água

Em `/hydration`, com o mesmo desenho do pomodoro: um copo que enche, e um widget
que acompanha na barra lateral.

- Meta do dia em copos, com o tamanho do copo em ml (o total em litros aparece
  enquanto você digita)
- **Bebi um copo** faz a gota cair, o copo balançar e a água subir
- Beber empurra o próximo lembrete um intervalo inteiro para frente: quem acabou
  de beber não quer ser cobrada logo em seguida
- Assim que o lembrete é ligado, o widget aparece no menu da esquerda — com o
  copo, o total do dia e a contagem para o próximo aviso
- O lembrete em si continua igual: intervalo em minutos e janela do dia, que pode
  cruzar a meia-noite

**O consumo é guardado como total do dia**, e não como um registro por copo. A
pergunta que a tela faz é sempre "quantos hoje?", e assim ela vira uma leitura de
chave primária em vez de um `COUNT` sobre uma história que só cresce.

**A contagem para o próximo lembrete viaja em segundos, não em horário.** O
servidor no deploy roda em UTC e o navegador está em outro fuso: um horário sem
fuso mandado ao cliente seria lido como hora local e a conta erraria por horas.
Uma duração não tem esse problema.

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

### Latência até o banco

Com o banco gerenciado fora do datacenter do app, o que manda no tempo de tela
não é CPU nem consulta pesada — é **quantas vezes** a requisição fala com o
banco. Cada ida custa um RTT inteiro, e elas acontecem em série.

Conte pelo **log do servidor** (`log_statement = 'all'`), nunca pelas chamadas
de `execute` do lado do cliente: `BEGIN` e `COMMIT` não passam por `execute` e
não aparecem na contagem do cliente, que por isso sai pela metade do real.

| Requisição | Antes | Depois |
| --- | --- | --- |
| Um arquivo estático | 4 | **0** |
| `/pomodoro` | 4 | **2** |
| `/todo` | 8 | **4** |
| `/calendar` | 16 | **8** |
| `POST /api/notes` (criar post-it) | 8 | **4** |
| `GET /api/events` | 8 | **4** |

Duas causas, cada uma valendo metade:

1. **O guarda de sessão carregava a conta antes de checar se a rota precisava
   dela**, então cada CSS e cada JS disparava um `SELECT` — doze arquivos por
   página, quarenta e oito conversas com o banco para servir folha de estilo.
2. **Transação implícita em toda consulta.** Fora do autocommit, o psycopg
   manda `BEGIN` antes e `COMMIT` depois, cada um uma ida de rede inteira. Com
   o ping de validação do pool, uma página com um único `SELECT` conversava
   quatro vezes com o servidor — três quartos disso cerimônia. O pool passou a
   rodar em `autocommit=True`, e as poucas operações que precisam de
   atomicidade abrem `with conn.transaction():` na mão (`create_user`,
   `delete_tag`).

**A distância é o resto da conta.** Render em Oregon e Neon em São Paulo dão
~168 ms por ida, medidos pelo `/healthz`; na mesma região, ~1 ms. Abrir o
calendário são 8 idas: 1,3 s contra 8 ms. Nenhuma otimização de código chega
perto disso. Ver "Escolhendo a região" abaixo.

O `/healthz` devolve `poolMs` e `queryMs` justamente para essa medição não
depender de palpite — como ler os dois está no docstring de
`app/blueprints/system.py`.

Uma coisa que **não** funciona: pular a validação de conexão do pool para
economizar a ida de rede. Foi tentado e medido. O pool guarda mais de uma
conexão (a thread do agendador é a segunda consumidora) e uma delas pode morrer
por queda de rede enquanto as outras seguem em uso — a conexão morta é entregue
sem validação e vira erro 500. Trocar 180 ms por um 500 é um mau negócio.

## Otimizações aplicadas

- Fontes: só as duas famílias do tema padrão bloqueiam a renderização; as outras 18 (usadas apenas nos previews) carregam de forma assíncrona
- Estáticos servidos com `?v=<mtime>` e `Cache-Control: immutable` de 1 ano
- Service worker com cache-first para `/static/` (seguro, pois as URLs são versionadas)
- Scripts com `defer` e tema aplicado antes da primeira pintura (sem flash de tema errado)
- Pool de conexões do Postgres aberto na subida, com verificação de conexão viva: o banco gerenciado suspende a instância ociosa e derruba o socket
- O guarda de sessão sai antes de consultar o banco quando a resposta não depende de quem pede (estáticos, `/healthz`, service worker, favicon): são doze arquivos por página, e cada um custava duas idas ao banco só para descobrir um usuário que o CSS não usa
- Gunicorn com threads: o worker síncrono atendia uma requisição por vez, e a dúzia de estáticos que o navegador pede em paralelo ficava em fila atrás de quem esperava o banco
- Pool em `autocommit`: sem transação implícita, uma consulta é uma ida de rede em vez de três (`BEGIN`, consulta, `COMMIT`). Quem precisa de atomicidade pede com `with conn.transaction():`
- `insert_todo_item` conta, calcula a posição e insere numa instrução só (`HAVING COUNT(*) < ...`): uma ida a menos numa escrita em que a tela fica esperando o id, e sem a corrida entre duas abas
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
- O widget da água viaja de carona na consulta do usuário (LEFT JOIN em `get_user`), que já acontece a cada requisição: um SELECT próprio dobraria as idas ao banco de cada página, e o banco é gerenciado — cada ida custa latência de rede
- Nível do copo por `--water-level` escrita na raiz do documento: um `setProperty` só faz todos os copos da página subirem juntos, e o motor não precisa saber quantos existem
- Contadores do to-do recontados do DOM em vez de incrementados, e barras de progresso por `scaleX` em vez de `width`

## Estrutura

O projeto fica na raiz do repositório. Cada camada tem seu lugar: rotas por
tela, acesso a dados por tabela, e CSS/JS por página.

```
app/
  __init__.py            fábrica da aplicação (só monta e agenda)
  config.py              variáveis de ambiente
  assets.py              versionamento de estáticos + headers de resposta
  auth.py                sessão do usuário e o guarda que protege toda rota
  extensions.py          scheduler compartilhado
  blueprints/            uma rota por tela/recurso
    system.py            /healthz, /sw.js, /favicon.ico
    auth.py              /entrar, /criar-conta, /sair
    home.py              /            (quadro de post-its)
    events.py            /events      (POST: criar, editar, remover)
    tags.py              /tags        (POST: criar, remover)
    calendar.py          /calendar    + /api/events
    planner.py           /planner     + /api/planner/blocks
    pomodoro.py          /pomodoro    (tempos prontos; o timer é do cliente)
    todo.py              /todo        + /api/todo
    notes.py             /api/notes
    appearance.py        /appearance
    hydration.py         /hydration
    push.py              /api/push/*  + /api/live/notifications
  db/                    uma tabela por módulo
    connection.py        pool de conexões do Postgres
    schema.py            CREATE TABLE e índices
    users.py             contas, hash de senha e criação do espaço
    events.py  tags.py  reminders.py  hydration.py  push.py  planner.py  notes.py
    todo.py              itens da lista semanal
  services/
    notifier.py          envio desktop e web push
    scheduler_service.py varredura de lembretes
  static/
    css/
      base.css           tokens (cor, fonte e escala --space-1..5), reset, layout,
                         sidebar, cartões, forms, botões
      components.css     casca comum a TODA tela: caixas da sidebar, botão de
                         notificações, toggle de dark mode
      widgets/           um arquivo por widget da sidebar (global, porque a
                         sidebar é do layout base)
        pomodoro.css     ampulheta + widget do pomodoro
        water.css        copo + widget da água
      components/        componente de 2-3 telas, carregado só por elas
        modal.css        modal de evento (calendário e planner)
      themes.css         10 temas, 10 fontes, dark mode, responsivo
      pages/             notes, planner, calendar, appearance, hydration,
                         pomodoro, todo, auth
      vendor/            tema do flatpickr e do FullCalendar
    js/
      core/              shared (namespace + utils), theme, audio, ui-effects,
                         push, pomodoro, hydration
      pages/
        notes/           constants, context, store, card, board, interactions, main
        planner/         constants, time, context, grid, blocks, store, drag, editor, main
        calendar/        event-modal, tags-modal, main
        pomodoro/        main.js
        todo/            main.js
        hydration/       main.js
    sw.js  manifest.webmanifest  icon.svg
  templates/
    layouts/base.html    casca da página
    partials/            sidebar, menu, flash, bootstrap de tema, widget do
                         pomodoro, macro da ampulheta, macro da pílula de tag,
                         casca das telas de conta
    pages/               home, calendar, planner, pomodoro, appearance,
                         hydration, login, signup
tools/                   geração de chaves VAPID
Dockerfile  docker-compose.yml  render.yaml
requirements.txt  run.py  wsgi.py  .env.example
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

## Contas e privacidade dos dados

Cada pessoa tem o próprio espaço. Não existe conteúdo compartilhado: eventos,
tags, post-its, blocos do planner, configuração de água e inscrições de push
são todos por conta.

- `/criar-conta` pede nome, e-mail e senha (mínimo de 8 caracteres). O espaço
  nasce junto e na mesma transação: as tags `Evento` e `Curso` e a linha de
  configuração de água. Sem isso a primeira visita abriria o popup de
  agendamento sem nenhuma tag para marcar.
- A senha nunca é gravada. Fica o hash do `werkzeug.security` (scrypt), com sal
  e algoritmo embutidos no próprio texto — trocar de algoritmo depois não
  invalida os hashes antigos.
- A sessão é um cookie assinado pela `SECRET_KEY`, com `HttpOnly`,
  `SameSite=Lax`, `Secure` fora do modo debug e validade de 30 dias.
- Toda tela exige login, e o guarda é registrado uma vez na fábrica em vez de
  um decorador por rota: rota nova nasce protegida, porque não existe decorador
  para esquecer. Rota `/api/` sem sessão responde `401` em JSON em vez do HTML
  do login — o cliente espera JSON e mostraria "erro de sintaxe" no lugar de
  "sua sessão expirou".
- Toda tabela de conteúdo tem `user_id` com `ON DELETE CASCADE`, e todo
  `UPDATE`/`DELETE` leva `AND user_id = %s`. É isso que impede editar ou apagar
  registro de outra conta trocando o id na URL — o id vem do cliente.
- Marcar um evento com o slug de uma tag de outra conta não funciona: a tag é
  procurada por `(user_id, slug)` e, não existindo, o evento cai na tag padrão.

## Banco de dados

Postgres. O SQLite em arquivo saiu porque o disco do container no Render é
efêmero: cada build, restart ou deploy criava um container novo e levava o
`.db` junto — todo mundo compartilhava o mesmo banco e perdia tudo a cada
publicação. O banco gerenciado vive fora do ciclo de deploy.

Um dialeto só, no local e no deploy. Manter SQLite de um lado e Postgres do
outro significaria duas versões de cada consulta, e a que não roda no dia a dia
é a que quebra sem ninguém ver.

As datas continuam gravadas como texto ISO-8601 (`2026-12-01T14:30`) e não como
`TIMESTAMP`: é o formato que chega do formulário, é o que o JS devolve, e a
ordenação lexicográfica de ISO-8601 coincide com a cronológica. Trocar o tipo
mudaria o formato em cinco lugares sem ganhar nada.

## Como rodar

1. Crie e ative o ambiente virtual:

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .\.venv\Scripts\Activate.ps1
```

2. Instale as dependências:

```bash
pip install -r requirements.txt
```

3. Suba um Postgres local:

```bash
docker compose up -d
```

O compose publica na porta **5433**, e não na 5432, porque essa costuma já
estar tomada por um Postgres instalado na máquina — o container falharia em
subir sem dizer claramente por quê.

Quem já tem Postgres na máquina pode pular o compose e apontar a `DATABASE_URL`
para lá:

```bash
createdb event_beazeth
```

4. Crie o `.env` a partir do exemplo e ajuste a `DATABASE_URL`:

```bash
cp .env.example .env               # Windows: Copy-Item .env.example .env
```

```env
DATABASE_URL=postgresql://dev:dev@127.0.0.1:5433/event_beazeth
DEBUG=True
```

As tabelas são criadas sozinhas na primeira subida (`init_db`), então não há
passo de migração.

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

7. Acesse http://127.0.0.1:5000 e crie sua conta em `/criar-conta`.

Telas (todas exigem login): `/` (post-its), `/calendar` (calendário, cadastro e
tags), `/planner`, `/pomodoro`, `/appearance`, `/hydration`.

## Observações importantes

- Web Push funciona melhor em HTTPS (produção).
- Em localhost também pode funcionar para testes.
- Notificação desktop local depende da máquina Windows com o app rodando.
- O scheduler roda a cada 60 segundos e aceita atraso de até 5 minutos para não perder lembretes.
- Ele vive dentro do processo web, então só roda enquanto o serviço está de pé — veja [Limitação conhecida](#limitação-conhecida-quando-os-lembretes-disparam).
- As duas rotinas da varredura (eventos e água) têm try/except separados: uma falhando não cala a outra.

## Deploy no Render

O `render.yaml` descreve o serviço. O banco NÃO está nele de propósito: o
Postgres gratuito do próprio Render expira 30 dias após a criação, tem 14 dias
de carência e depois é **apagado com os dados dentro** — exatamente a perda que
esta arquitetura existe para evitar.

### Por que Neon

O plano gratuito não expira e não pausa: o compute apenas dorme após 5 minutos
sem consulta e acorda sozinho na consulta seguinte. Como o serviço gratuito do
Render também dorme, os dois dormem juntos e o consumo fica em torno de 30 das
100 CU-horas mensais.

(O Supabase seria o certo no cenário oposto, de serviço sempre acordado: ele não
mede compute, mas pausa após 7 dias sem atividade e exige um clique para
voltar.)

### Criando o banco no Neon

1. Entre em [neon.tech](https://neon.tech) com o GitHub. Nenhum cartão é pedido.
2. **Create project**:
   - **Name**: `event-beazeth`
   - **Postgres version**: 17
   - **Cloud / Region**: a mais próxima de você (`AWS / São Paulo` ou
     `AWS / US East (Ohio)`) — a latência entra em toda requisição
3. O painel abre o **Connection string** já pronto. Copie inteiro, com o
   `?sslmode=require` no fim. Vai ter esta cara:

```
postgresql://event-beazeth_owner:npg_XXXX@ep-nome-123456-pooler.sa-east-1.aws.neon.tech/event-beazeth?sslmode=require
```

Pode deixar o **Pooled connection** marcado (é o padrão). Ele é PgBouncer em
modo transação, onde o prepared statement do psycopg colidiria — e é por isso
que `db/connection.py` desliga o `prepare_threshold`. A conexão direta também
funciona.

Não há passo de migração: as tabelas nascem na primeira subida.

### Escolhendo a região

**Antes de criar qualquer coisa, decida a região — e use a mesma nos dois.**
É a decisão de performance mais cara de reverter e a que mais rende: cada
requisição fala com o banco de 1 a 4 vezes, em série, e cada uma dessas idas
custa o RTT entre o app e o banco. Mesma região é ~1 ms; continentes diferentes
são ~180 ms, e a diferença aparece em toda troca de tela.

O Render não tem região no Brasil. A combinação que dá o melhor resultado para
quem acessa daqui:

| | Região | Por quê |
| --- | --- | --- |
| Render | **Virginia** (US East) | a mais próxima do Brasil na plataforma |
| Neon | **AWS US East (Ohio ou Virginia)** | mesma costa que o app |

Note que o instinto de pôr o Neon em `sa-east-1` (São Paulo) sai **pior**: o
banco fica perto de você, mas longe do app — e quem conversa com o banco várias
vezes por página é o app, não o navegador. O navegador fala com o Render uma vez.

Nenhum dos dois serviços deixa mudar a região depois de criado; é refazer o
projeto. Enquanto o Neon ainda não tem dado dentro, refazer custa nada — depois
custa uma migração.

### Configurando o Render

Em **Environment → Environment Variables**, do serviço web:

| Variável | O que preencher |
| --- | --- |
| `DATABASE_URL` | a connection string copiada do Neon, inteira |
| `SECRET_KEY` | a saída de `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `DEBUG` | `False` |
| `ENABLE_DESKTOP_NOTIFICATIONS` | `False` |
| `VAPID_PUBLIC_KEY` | a chave pública de `python tools/generate_vapid_keys.py` |
| `VAPID_PRIVATE_KEY` | a chave privada do mesmo comando |
| `VAPID_SUBJECT` | `mailto:seu@email.com` |

`PORT` o Render injeta sozinho, e o `Dockerfile` já a respeita.

Depois do deploy, confira em `https://SEU-APP.onrender.com/healthz` —
`{"ok": true, "database": "ok"}` significa que o app alcançou o Neon. Então
crie sua conta em `/criar-conta`.

O app **se recusa a subir** sem `DATABASE_URL`, e em produção também sem uma
`SECRET_KEY` de verdade. Os dois erros só apareceriam depois: o primeiro como
banco vazio a cada deploy, o segundo como cookie de sessão forjável — quem
soubesse a chave entraria como qualquer conta.

Trocar a `SECRET_KEY` depois desloga todo mundo (as sessões assinadas com a
chave antiga deixam de valer), mas não perde nenhum dado.

## Casca de celular

O app é o mesmo site, então "parecer um app" é trabalho de CSS, não de
plataforma. O que foi feito, e por quê:

**Barra de navegação inferior.** A lateral é menu de desktop; no celular ela
virava um bloco ACIMA do conteúdo, e era preciso rolar sete links e três
widgets antes de chegar na tela. Agora os destinos ficam fixos ao alcance do
polegar (`partials/bottom-nav.html`), o menu da lateral some, e o que sobra
dela — pomodoro, água, notificações, conta — desce para depois do conteúdo.

A lista de destinos vive em `app/navigation.py`, compartilhada pelas duas
barras: com duas listas, um destino novo entraria numa e faltaria na outra.

**Acabamentos de toque** (`css/app-shell.css`): sem realce cinza ao tocar, sem
menu de long-press na casca (o conteúdo segue selecionável), sem
puxar-para-recarregar, e `env(safe-area-inset-*)` para o conteúdo não passar
sob a barra de gestos — o que exige `viewport-fit=cover` no `<meta viewport>`.

**Pré-renderização** (`speculationrules` no `base.html`): o destino é carregado
enquanto o dedo ainda está no link, então o toque cai numa página pronta. É o
que substitui um roteador de SPA aqui — sem reescrever as telas, que são
renderizadas no servidor. Escopado aos links de menu, nunca `"/*"`.

### `min-width: 0`, ou por que a página inteira ficava larga demais

Vale registrar porque o sintoma não parece ter a ver com a causa.

Todo filho de flex e de grid nasce com `min-width: auto`, que o proíbe de
encolher abaixo da largura mínima do próprio conteúdo. Basta um elo da corrente
recusar encolher para o piso subir até a página: o navegador estica o viewport
de LAYOUT para caber, e tudo passa a ser mais largo que o aparelho — título
cortado, botão principal fora da tela, e o último item da barra inferior
invisível. Nada disso aparece como "rolagem horizontal".

Por isso `.layout-shell`, `.main-content`, `.sidebar` e `.main-content > *`
levam `min-width: 0` no celular. E por isso o calendário é contido no próprio
cartão (`#events-calendar { min-width: 0; overflow-x: auto }`): o FullCalendar
tem largura mínima própria e não é nosso para redimensionar.

O teste `test-mobile.mjs` roda as sete telas num Chromium a 360px e falha se o
viewport esticar — é a rede que impede isso de voltar.

## API para o app nativo

O site recebe a tela pronta do servidor, então nunca precisou de rotas de
leitura. O app Android precisa: ele pede os dados e monta a tela sozinho.

| Rota | Para quê |
| --- | --- |
| `POST /api/auth/login`, `/api/auth/signup` | devolvem um token `Bearer` |
| `GET /api/me` | o app confere na abertura se o token ainda vale |
| `GET /api/sync?since=` | o que mudou e o que sumiu desde a última vez |

O token é **assinado, não guardado**: leva o id da conta e o instante de
emissão, assinados com a mesma `SECRET_KEY` do cookie. Sem tabela, sem consulta
ao banco para validar. O preço é não poder revogar um token específico antes de
vencer — o botão de emergência é trocar a `SECRET_KEY`, que derruba todos.

O guarda de sessão aceita as duas credenciais. O token vem primeiro: um cliente
que se deu ao trabalho de mandá-lo está dizendo qual conta quer, mesmo que haja
um cookie de outra pendurado na mesma requisição.

### Carimbo e lápide, feitos pelo banco

Para o app perguntar "o que mudou desde ontem?", cada linha precisa saber
quando mudou — e o app precisa saber o que foi **apagado**, senão ressuscita no
celular o que você removeu no site.

Duas decisões que valem registro:

**Lápide em tabela separada (`deletions`), não `deleted_at` em cada tabela.**
Com `deleted_at`, toda consulta do app precisaria lembrar de filtrar
`WHERE deleted_at IS NULL`, e a que esquecesse mostraria lixo apagado em
silêncio. Assim, o `DELETE` continua sendo `DELETE` e nenhuma consulta muda.

**Quem carimba é um gatilho do Postgres, não o Python.** São 21 pontos de
escrita em sete módulos; bastaria esquecer um para aquela tabela parar de
sincronizar. E o modo de falhar não avisa: a linha grava, o site mostra tudo
certo, e semanas depois o celular está desatualizado. No gatilho é uma regra
só, e vale até para um `UPDATE` feito à mão no painel do Neon.

O gatilho da lápide ignora a exclusão quando a conta já sumiu: o `CASCADE`
remove o dono antes de propagar, então cada linha filha tentaria gravar uma
lápide apontando para um usuário inexistente — e a exclusão inteira falharia
por chave estrangeira.

### O contrato

`app/api_contract.py` lista rotas, métodos, exigência de credencial e campos
obrigatórios. Um teste falha quando o servidor diverge dele — inclusive quando
uma rota `/api/` nova **não** entra no contrato, que é o jeito de uma
funcionalidade existir no site e o app nunca ficar sabendo.

## Gerando o .apk

O app Android é um **TWA** (Trusted Web Activity): um `.apk` de verdade que
abre este mesmo site em tela cheia. Não é uma segunda versão do app — é a
mesma, então conta, senha e dados são os do Neon, e o que é criado no celular
aparece no navegador do computador na hora. Não existe banco no dispositivo e
não existe sincronização para escrever: só há um banco.

O que isso **não** faz: deixar mais rápido. É a mesma rede e o mesmo banco. Vale
migrar a região antes de empacotar, senão o resultado é um app lento em vez de
um site lento.

### 1. Ícones

Já versionados em `app/static/`. Se o desenho mudar:

```bash
pip install Pillow
python tools/generate_icons.py
```

Gera 192, 512 e a versão *maskable* (com a margem que o Android exige para
recortar em círculo sem cortar o desenho).

### 2. Empacotar

Precisa de Node 18+ (o Bubblewrap baixa o JDK e o Android SDK sozinho).

**Rode fora deste repositorio.** O `bubblewrap init` cria um projeto Android
inteiro na pasta atual, e o modulo Android dele tambem se chama `app` -- dentro
daqui, ele se mistura com o pacote Python. O projeto vive em
`../event-beazeth-android/`, com README proprio.

```bash
npm install -g @bubblewrap/cli
mkdir ../event-beazeth-android && cd ../event-beazeth-android
bubblewrap init --manifest https://SEU-APP.onrender.com/static/manifest.webmanifest
bubblewrap build
```

No `init` ele pergunta o **package name** (algo como `com.seunome.notifier` —
anote, vai no passo 3) e cria um **keystore**. Guarde o keystore e a senha: é a
chave que assina o app, e sem ela não dá para publicar atualização que instale
por cima da anterior — a pessoa teria que desinstalar e perder o login.

Saem `app-release-signed.apk` (para enviar direto) e um `.aab` (só serve para a
Play Store; ignore).

### 3. Tirar a barra de endereço

Sem este passo o app abre, funciona e sincroniza — mas com uma barra de
endereço no topo, com cara de navegador. O Android precisa confirmar que o site
e o pacote são da mesma pessoa.

Pegue a impressao digital da chave -- lendo do `.apk` ja assinado, o que
dispensa a senha do keystore:

```bash
"$HOME/.bubblewrap/jdk/jdk-17.0.11+9/bin/keytool" -printcert -jarfile app-release-signed.apk
```

O `bubblewrap fingerprint list` NAO serve aqui: ele lista as impressoes ja
registradas no `twa-manifest.json`, que comeca vazio.

E preencha no Render, em **Environment**:

| Variável | Valor |
| --- | --- |
| `ANDROID_PACKAGE_NAME` | o package name do passo 2 |
| `ANDROID_CERT_FINGERPRINT` | o SHA-256, no formato `AB:CD:EF:...` |

Faça deploy e confira em `https://SEU-APP.onrender.com/.well-known/assetlinks.json`
que o JSON aparece. **404 ali significa que as variáveis não chegaram** — e o
app vai abrir com a barra.

Depois reinstale o `.apk` no celular: a verificação acontece na instalação, não
a cada abertura.

Aceita mais de uma impressão digital separadas por vírgula, que é como se troca
a chave de assinatura sem quebrar quem já instalou.

### 4. Instalar sem loja

Mande o `.apk` por qualquer meio. No Android é preciso autorizar "instalar apps
desconhecidos" para o aplicativo que vai abrir o arquivo (o WhatsApp, o
Arquivos, o Drive). O aviso do sistema é normal para app fora da Play Store.

Notificações: o Web Push já funciona dentro do TWA. No Android 13+ o app tem que
pedir a permissão de notificação — passe `--enableNotifications` no `init` para
o Bubblewrap declará-la.

### Sem .apk nenhum

Se em algum momento o `.apk` não valer o trabalho: no Chrome do Android, menu →
**Instalar app**. O ícone vai para a tela inicial e abre em tela cheia igual,
usando o mesmo manifest. Não dá para enviar por WhatsApp, mas custa zero.

## Docker

Build:

```bash
docker build -t event-notifier .
```

Run:

```bash
docker run -p 8000:8000 --env-file .env event-notifier
```

Nota: o container usa `gunicorn -w 1` para evitar execução duplicada do scheduler de lembretes.

## Limitação conhecida: quando os lembretes disparam

O agendador vive dentro do processo web, e o serviço gratuito do Render **dorme
após 15 minutos sem tráfego**. Enquanto ele dorme, ninguém varre nada: o
lembrete das 14:00 só sai quando alguém abre o site. A janela de tolerância de
5 minutos do `_is_due` cobre atraso de execução, não horas de sono.

Na prática, os lembretes funcionam bem enquanto o app está em uso e chegam
atrasados depois de um período parado. O `reminder_dispatches` garante que
atrasado é diferente de perdido — quando o serviço acorda, o aviso ainda não
entregue sai, e sai uma vez só.

`/healthz` responde `lastScanSeconds`, que é quanto tempo faz desde a última
varredura, para conferir se o agendador está girando.

Duas saídas, se um dia isso incomodar:

- **Ping externo** em `/healthz` a cada 10 minutos (cron-job.org e afins) mantém
  o serviço acordado. Cuidado com dois limites: o Render dá 750 horas de
  instância por workspace por mês contra as 730–744 de um mês, e o agendador
  acordado consulta o banco de 60 em 60 segundos, o que impede o compute do Neon
  de dormir e estoura as 100 CU-horas por volta do dia 17. Ligar o ping implica
  restringir o horário do ping *e* trocar o Neon pelo Supabase, que não mede
  compute.
- **Render Background Worker** (plano pago): o agendador sai do processo web e
  vira serviço próprio, sempre ligado. É a solução sem ressalva.

## Outras plataformas

Qualquer uma que rode container serve (Railway, Fly.io, Koyeb). O roteiro é o
mesmo: apontar para o `Dockerfile`, configurar as variáveis da tabela acima e
usar a URL HTTPS gerada para ativar o Web Push no navegador. O banco continua
sendo externo — é justamente o que faz o dado sobreviver ao redeploy.
