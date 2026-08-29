# Constituição do projeto

Regras de organização, otimização e componentização deste repositório. Não são
preferências de estilo: cada uma nasceu de um problema concreto que apareceu
aqui, e o motivo está escrito junto. Tela nova segue tudo isto.

---

## 1. Onde cada coisa mora

```
app/
  __init__.py          fábrica (create_app) — só monta, não decide nada
  config.py            configuração
  auth.py              sessão do usuário e o guarda de toda rota
  assets.py            versionamento de estáticos e cabeçalhos de resposta
  extensions.py        instâncias compartilhadas (scheduler)
  blueprints/          UMA tela ou recurso por módulo
  db/                  UMA tabela por módulo; __init__ reexporta a API pública
  services/            trabalho que não é request (notificações, agendador)
  static/
    css/
      base.css         tokens, reset, layout, sidebar, cartões, forms, botões
      components.css   casca comum a TODAS as telas
      components/      componente de 2–3 telas; carregado só por elas
      widgets/         um arquivo por widget da barra lateral (global)
      pages/<tela>.css o que só existe naquela tela
      vendor/          ajustes sobre CSS de terceiros
    js/
      core/            carrega em toda página
      pages/<tela>/    carrega só naquela tela
  templates/
    layouts/           esqueleto
    pages/             uma por tela
    partials/          pedaços incluídos e macros reutilizáveis
```

**O critério do CSS é o alcance, não o assunto.** Está em toda tela →
`components.css`, ou `css/widgets/<nome>.css` se for widget da barra lateral.
Está em duas ou três → `css/components/<nome>.css`, carregado no `head_extra`
delas. Está em uma → `css/pages/<tela>.css`. Foi assim que o modal de evento saiu
do pacote global: cinco telas baixavam 70 linhas de CSS de um modal que nunca
abriria ali.

Widget global ganha arquivo próprio mesmo cabendo junto: ampulheta e copo não têm
nada a ver um com o outro, e os dois no mesmo arquivo chegaram a 690 das 700
linhas — sem folga nenhuma para o próximo.

---

## 2. Tamanho de arquivo

Limite: **700 linhas**. Passou disso, divide-se por responsabilidade — nunca ao
meio. O post-it virou `constants / context / store / card / board / interactions
/ main`; o planner, nove módulos.

Dividir CSS é diferente de dividir JS: **as faixas precisam ser contíguas e a
ordem de carga preservada**, porque a cascata depende da ordem. `base.css →
components.css → themes.css` não é negociável.

---

## 3. CSS

- **Cor, medida e fonte saem de custom properties.** Nada de hex solto numa
  regra de componente: existem 10 temas × 10 fontes × dark mode, e valor cravado
  fica errado em 19 combinações.
- **Espaçamento do shell sai da escala `--space-1..5`** (base.css). Não é sobre
  tema — é sobre conseguir afrouxar a interface inteira num lugar só. Antes cada
  regra escolhia o próprio número, e "dar mais ar" virava caçar 14, 16, 18 e 20
  espalhados por seis arquivos.
- **Um padrão e seus modificadores declaram-se no mesmo arquivo**, senão a
  especificidade empata e quem decide passa a ser a ordem de carga. `--pomo-tint`
  tem o padrão em `components.css` junto com as fases justamente por isso — em
  `pages/pomodoro.css` o padrão venceria o alerta e a cor nunca mudaria.
- **Modificador de tamanho é explícito.** Nada de "o pequeno é o padrão da classe
  base": `.hourglass-sm` existia no HTML sem regra nenhuma no CSS até isso ser
  corrigido.
- **Proporção se resolve sozinha.** `clamp()`, `cqi` (container query),
  `repeat(auto-fit, minmax(min(100%, X), 1fr))`. Media query só para mudança de
  *layout* (algo troca de lugar), nunca para *tamanho* (algo cresce ou encolhe).
  `cqi` acima de `vw` quando o elemento vive num cartão: numa tela larga o cartão
  tem metade do espaço, e `vw` não sabe disso.
- **`@container` acima de `@media` pelo mesmo motivo**, inclusive para mudança de
  layout. A barra do calendário reflui pela largura do CARTÃO: numa janela de
  1280 ela tem 590px se dividir a linha com "Próximos eventos" e 920px se a
  lista já desceu. A janela mede 1280 nos dois casos e erraria um dos dois.
  Exige `container-type: inline-size` em quem contém — sem isso `cqi` cai
  silenciosamente no viewport, que é o bug que a regra existe para evitar.
- **Quebra escolhida, não quebra sofrida.** Onde `flex-wrap` decidia sozinho, a
  barra do calendário quebrava num lugar qualquer — às vezes com o título
  sozinho à direita. Passado o ponto em que não cabe, o layout das duas linhas
  é declarado.
- **Foco visível sempre**, com `outline: 2px solid transparent` junto do
  `box-shadow` — o outline transparente é o que mantém o indicador no modo de
  alto contraste do Windows.

---

## 4. Animação e performance

- **Só `transform` e `opacity` animam.** São as duas propriedades que o navegador
  resolve no compositor. Animar `width`, `height`, `top` ou `left` é layout a
  cada quadro.
  Consequências práticas: nível de areia é `scaleY`, não `height`; barra de
  progresso é `scaleX`, não `width`; arrastar post-it é `transform`, não
  `position`.
- **Nada de JS por quadro para efeito visual.** O que é decorativo é `@keyframes`.
  O que depende de estado entra por uma custom property que o JS escreve algumas
  vezes por segundo, e o CSS interpola com `transition`.
- **Geometria vira variável CSS**, não atributo de estilo espalhado: `--n-x/--n-y`
  nos post-its, `--pomo-progress` no pomodoro.
- `pointermove` sempre agrupado em `requestAnimationFrame`; escrita persistida
  com debounce; `flush` com `keepalive` em `pagehide` e `visibilitychange`.
- **Respeite `prefers-reduced-motion`** — já é global em `themes.css`; a
  interface tem que continuar correta com todas as animações desligadas.

---

## 5. JavaScript

- **Namespace global `window.EN`, sem bundler e sem `import`.** Não é preguiça:
  cada estático é servido com `?v=<mtime>` e o service worker é cache-first
  justamente porque as URLs são versionadas. Um `import "./x.js"` estático não
  carrega versão, então o SW serviria submódulo velho para sempre.
- **A ordem de carga é a ordem das tags `<script defer>`** em `layouts/base.html`.
  Dependência nova entra antes de quem usa.
- Todo módulo é uma IIFE com `"use strict"`.
- **Zero dependência nova sem necessidade real.** O projeto tem `npm` nenhum. As
  únicas bibliotecas de terceiros são flatpickr e FullCalendar, carregadas por
  CDN e só nas telas que as usam.
- **Um motor, vários assinantes.** Estado que aparece em mais de um lugar mora
  num módulo `core/` com `subscribe()`; a tela e o widget são assinantes iguais.
  Assim eles não têm como sair de sincronia — não existe código ligando os dois.

---

## 6. Estado do cliente: localStorage ou banco?

Vai para o **banco** o que é conteúdo do usuário: post-its, blocos do planner,
eventos, tarefas do to-do, copos de água, configuração de lembrete. Tudo isso é por conta (ver seção 8b) e vive
no Postgres, fora do ciclo de deploy — no arquivo SQLite de antes, cada
publicação começava do zero.

Vai para o **localStorage** o que é do aparelho e precisa estar pintado antes da
primeira requisição: tema, fonte, dark mode, timer do pomodoro.

Para o timer, os três motivos:

1. o widget precisa aparecer já pintado a cada navegação — vindo de `fetch`,
   toda troca de página teria um buraco na sidebar;
2. o que se guarda é `endsAt` (epoch absoluto), então recarregar, dormir a
   máquina ou trocar de aba não desalinha a contagem;
3. um timer rodando é do aparelho: sincronizar pelo servidor faria o celular
   herdar o pomodoro do notebook.

**Estado restaurado de localStorage que muda o layout entra no bootstrap inline**
(`partials/theme-bootstrap.html`), que roda antes da primeira pintura. Revelar por
JS depois do primeiro quadro empurra a página inteira.

---

## 7. Templates

- `layouts/base.html` é o único esqueleto; página nova só preenche os blocos
  `title`, `head_extra`, `content` e `scripts`.
- **Markup repetido em dois lugares vira macro**, não cópia (`partials/hourglass.html`).
- **Componente feito com `<span>` + `clip-path` em vez de SVG** quando aparece
  mais de uma vez na mesma página: SVG com `clipPath` precisa de `id` único por
  instância e duas cópias colidem.
- **Dado estático vem do Python renderizado**, não montado por JS depois da
  pintura — os tempos do pomodoro chegam prontos do blueprint, e o JS só lê o que
  já está no HTML, sem manter uma segunda lista igual.
- O template não calcula: view model no blueprint (ver `as_card` em
  `blueprints/events.py`).

---

## 8. Python

- Um blueprint por tela; a fábrica só registra.
- Um módulo de `db/` por tabela. A primeira posição da assinatura é o `user_id`
  — as poucas funções sem ele são as de autenticação e as que o agendador chama
  fora de requisição.
- **Configuração obrigatória falha na subida, não na primeira consulta.**
  `DATABASE_URL` ausente e `SECRET_KEY` de exemplo em produção só apareceriam
  depois, um como banco vazio e o outro como sessão forjável.
- `PATCH` aplica só as chaves presentes no payload. Cliente que salva geometria
  no arrasto e texto no editor, cada um no seu debounce, precisa disso — um `PUT`
  cheio faria um sobrescrever o outro.
- Constante que espelha limite do JS leva comentário dizendo de quem é o espelho.

---

## 8b. O dado é de alguém

O app é multiconta. Isto não é detalhe do módulo de login: é invariante de toda
consulta escrita daqui em diante.

- **Toda tabela de conteúdo tem `user_id` com `ON DELETE CASCADE`.** Apagar a
  conta leva junto o que era dela, sem varredura manual tabela por tabela.
- **Toda leitura filtra por `user_id`; todo `UPDATE`/`DELETE` leva
  `AND user_id = %s` no `WHERE`.** Não é redundância com o guarda de sessão: o
  guarda diz *quem* está pedindo, e o id do registro vem do cliente. Sem o
  filtro, trocar o número na URL edita o dado de outra pessoa.
- **Chave composta onde o identificador é escolhido pelo usuário.**
  `event_tags` é `(user_id, slug)` e `push_subscriptions` é
  `(user_id, endpoint)`: duas pessoas podem criar uma tag "prova", e o mesmo
  navegador pode estar inscrito em duas contas.
- **Referência a valor escolhido pelo usuário é validada por par.** `tag_type`
  é procurado por `(user_id, slug)` — sem isso, alguém marcaria o próprio
  evento com o slug de uma tag alheia.
- **O guarda é registrado na fábrica, não por decorador.** Rota nova nasce
  protegida. Decorador por rota é uma coisa a esquecer, e o preço de esquecer é
  vazamento.
- **Quem roda fora de requisição não tem sessão.** O agendador varre o banco
  inteiro de propósito; o recorte por conta acontece na entrega, com o
  `user_id` que veio na linha do evento.

---

## 8c. A superfície de autenticação

A seção 8b trata de quem pode ler o quê depois de entrar. Esta trata de entrar.

- **Errar senha custa cota.** `/entrar` e `/api/auth/login` são a mesma porta
  para a mesma senha, e um contador só, no módulo (`app/ratelimit.py`), atende
  as duas — proteger uma delas não protege nada. Conta-se **falha**, nunca
  requisição: quem acerta não gasta cota, então ninguém é barrado por usar o
  app. Duas chaves, e as duas precisam passar: por IP pega a máquina que
  ataca muitas contas, por e-mail pega a botnet que distribui os palpites
  contra uma conta só.

- **Caminho de erro custa o mesmo que o caminho normal.** A resposta já era
  igual para "e-mail não existe" e "senha errada"; o relógio não era.
  `bool(user_row) and check_password_hash(...)` faz curto-circuito, então
  e-mail sem conta voltava na hora e e-mail com conta pagava o scrypt inteiro.
  Quem cronometrasse separava as duas listas sem acertar uma senha. Hoje o
  caminho "não existe" compara contra um hash descartável e gasta o mesmo.
  **Regra geral: onde a resposta é deliberadamente ambígua, o tempo também tem
  de ser.**

- **Estado do freio é do processo, e isso está escrito.** A alternativa era uma
  escrita no banco a cada senha errada (num banco que está noutro datacenter)
  ou um Redis, que seria a primeira dependência de infraestrutura nova do
  projeto. Com um worker de gunicorn, memória de processo é o servidor inteiro;
  com dois, o teto efetivo dobra. Continua servindo para o que o freio existe,
  que é tirar a força bruta da mesa — não para contar tentativas com precisão
  contábil.

- **Trocar credencial pede a senha atual; trocar aparência não.** Nome de
  exibição e foto são cosméticos e reversíveis: o token já prova quem está
  falando. E-mail e senha SÃO a credencial — sem a senha atual, quem pegasse um
  aparelho destravado por um minuto trocaria as duas e ficaria dono da conta.
  Essa conferência entra no mesmo freio do login: é mais uma porta onde se
  acerta uma senha por tentativa.

- **Numa rota que grava várias coisas, valide TODAS antes de gravar UMA.** Em
  `PATCH /api/me` a senha curta é recusada antes de o e-mail novo entrar; e
  entre as duas credenciais o e-mail vai primeiro, por ser o único que pode
  falhar por culpa de outra conta. Sem essa ordem, metade da mudança grava e a
  pessoa fica sem saber qual metade.

- **O `X-Forwarded-For` só vale o PRIMEIRO valor.** Atrás do proxy do Render, o
  cabeçalho é uma lista e os últimos valores são os proxies. Confiar no último
  entregaria sempre o mesmo IP, e o freio inteiro passaria a contar uma chave
  só para o mundo todo.

## 8d. Cabeçalhos de resposta

Ficam todos em `app/assets.py`, num `after_request` só.

- **A CSP usa nonce, não `'unsafe-inline'`.** São dois scripts inline no
  projeto (o bootstrap de tema e as speculation rules) e os dois recebem o
  nonce do pedido, gerado em `before_request`. Com `'unsafe-inline'` a política
  não valeria quase nada: qualquer `<script>` injetado rodaria igual.
- **`style-src` precisa de `'unsafe-inline'` e não tem jeito**: a geometria dos
  post-its e a cor das tags chegam em `style="--n-x: ..."`, atributo de estilo é
  inline por definição, e o FullCalendar injeta `<style>` sozinho. Perde-se
  pouco — CSS injetado não executa código.
- **Toda origem externa na política tem de estar escrita com o motivo.** Uma
  linha a mais ali é uma porta a mais. Hoje são três: `fonts.googleapis.com`,
  `fonts.gstatic.com` e `cdn.jsdelivr.net` (flatpickr e FullCalendar).
- **`font-src` aceita `data:`** porque o CSS do flatpickr traz o próprio
  iconefonte em base64.
- **CSP se confere no NAVEGADOR, não no teste de servidor.** O Flask manda o
  cabeçalho, o teste vê o cabeçalho, e quem recusa o script é o Chrome — que
  nenhum dos dois estava rodando. `verify_csp.mjs` abre as sete telas e falha
  se houver uma violação, ou se o que a política tinha de deixar passar não
  passou (tema pintado, fontes carregadas, calendário desenhado).

**Manipulador inline em HTML está proibido, e a CSP é quem cobra.** Existiam
quatro: um `onload` na tela de Aparência e três `onsubmit="return confirm(...)"`
no calendário. Sob a política, os quatro pararam de rodar — **em silêncio**: a
folha das 18 fontes ficava para sempre em `media="print"`, e o "excluir" do
calendário deixava de perguntar antes de apagar. Um botão destrutivo que parou
de confirmar é pior do que um que parou de funcionar. Viraram `data-confirmar`
e `data-ativar-ao-carregar`, com um ouvinte delegado em `core/shared.js` — uma
regra em vez de três cópias.

## 9. Acessibilidade

- Elemento decorativo leva `aria-hidden="true"`.
- Estado que muda sozinho vai para uma região `aria-live="polite"` — mas o
  relógio em si não, senão é um segundo falado por segundo.
- Botão que troca de função troca também de `aria-label`.
- Escolha entre opções usa `aria-pressed`; nada de estado só na cor.

---

## 10. Nada de código morto

Regra dura: **classe sem regra, regra sem uso, variável sem leitura, função sem
chamada, coluna sem interface — sai.** Coluna `pinned` e coluna `is_course`
foram removidas por isso, com migração.

Exceção só quando declarada por escrito, com o motivo. Hoje existe uma família:
as classes de "Próximos eventos", no calendário, que dependem de *dado* e não de
código. Contra o banco vazio some a lista inteira (`event-list`, `event-item`,
`event-date`, `event-body`, `event-title`, `event-meta`, `event-when-text`,
`event-remove`, `upcoming-count`); com a lista cheia some `events-empty`. E
mesmo com dado, `event-desc` só aparece em evento com descrição e
`upcoming-more` só quando há mais de três à frente.

Consequência prática para quem for auditar: rodar o verificador **duas vezes**,
uma com o banco vazio e outra com dado que exercite os dois extremos. Uma
passagem só sempre acusa metade da lista como morta.

`is-evento`/`is-curso` eram a exceção anterior e saíram: a cor da tag virou
`--tag-color` inline, então uma tag criada pelo usuário não precisa (nem
poderia ter) uma regra própria escrita à mão.

---

## 10b. O app Android

O aparelho é **um só: o Galaxy Tab A9+**, deitado — 1920x1200 a 240 dpi, ou seja
uma janela de **800x500 dp**. Não é "um app de celular que também roda em
tablet"; é essa tela, e é por isso que a barra lateral do site cabe inteira. O
emulador de trabalho é esse aparelho.

### A fila de escrita é o coração, e é onde os bugs moram

Escrita nenhuma espera a rede: entra no Room, a tela redesenha no mesmo quadro,
e a subida acontece depois. O preço é a **linha provisória** — id negativo até o
servidor emitir o de verdade — e quase todo defeito sério do app até hoje saiu
dessa troca de identidade. As regras que sobraram dela:

- **Drenar a fila lendo o banco, um item por vez.** Percorrer uma lista é
  percorrer uma fotografia: quando a criação volta com o id verdadeiro e a fila
  é reescrita, os itens que já estavam na mão continuam apontando para o id
  negativo. Custou o texto de todo post-it novo, que subia para `/api/notes/-1`,
  tomava 404 e era descartado em silêncio.
- **Upsert ressuscita linha apagada.** Gravar por id não dá erro quando a linha
  não existe mais — ela volta. Toda escrita pergunta antes se a linha ainda
  está lá. Escrever em algo que foi apagado não é escrita nenhuma.
- **"Obra única" do WorkManager é única POR NOME.** `sync-agora` e
  `sync-periodico` rodam juntas sem nenhum impedimento, leem a mesma fila e
  mandam o mesmo POST. Sincronização é uma de cada vez, com tranca de processo.
- **Trocar id provisório por definitivo é escopo por entidade.** Cada tabela
  conta os próprios negativos, então existe um post-it -1 E uma tarefa -1 ao
  mesmo tempo.

### Compose: o que morre sem avisar

- **`Modifier.pointerInput(chave)` congela a lambda.** Ela é relembrada só
  quando a chave muda, então valor de recomposição capturado ali dentro fica
  velho para sempre. Estado (`var x by remember`) continua certo, porque o que
  se captura é o acessor; valor derivado, não. Calcule no instante do gesto, não
  antes.
- **Trocar o id de um item mata o composable.** O `LaunchedEffect` que gravaria
  ao fechar é CANCELADO, não executado — o que estava só na memória dele some. O
  que a pessoa digitou desce para o banco enquanto ela digita, não só no fim.
- **Campo de texto renascido volta com o cursor no zero.** Onde a identidade do
  item pode trocar durante a edição, o campo guarda `TextFieldValue`, com o
  intervalo junto do texto — senão a continuação entra de trás para a frente.

### O que é da conta e o que é do aparelho

A linha não é de gosto, é de custo e de verdade:

- **Da conta**: o que identifica quem está falando e o que o site também mostra
  — nome de exibição, e-mail, senha. Muda pela API, vale nos dois lados.
- **Do aparelho**: tema, fonte, modo escuro, o estado do pomodoro, a foto de
  perfil. O tema do computador nunca teve de mandar no do celular; a foto não
  sobe porque o banco é cobrado por byte e o disco do Render some a cada deploy.
  Guardá-la lá pediria uma coluna de bytes ou um serviço de arquivos novo, para
  um app de duas pessoas.

O preço de "do aparelho" é reinstalar e escolher de novo, e ele está escrito na
tela. O preço de "da conta" seria infraestrutura nova — e é ele que se recusa.

### Sem conta é um modo, não um erro

Dá para usar o app inteiro sem login e sem rede. Duas regras seguram isso de pé:

- **A barreira da fila fica em um lugar só** — o único ponto por onde toda
  escrita passa. Espalhada por cada método, uma seria esquecida.
- **Entrar numa conta depois não pode perder nada.** Modo local sem caminho de
  volta é armadilha: quem escreveu por um mês veria o próprio conteúdo ficar
  para trás. A adoção enfileira uma criação por linha provisória e reusa a
  máquina que já existia.

---

## 11. Antes de dar por pronto

As ferramentas ficam no scratchpad da sessão e rodam contra o app de verdade:

| Ferramenta | O que garante |
|---|---|
| `devapp.py` | ponto de entrada de todo teste de servidor: crava o Postgres LOCAL antes de importar `app` e devolve um cliente já logado |
| `audit.py` | 12 categorias de código morto: keyframes, variáveis CSS (declaradas sem leitor e lidas sem declaração), ids, `data-*`, membros de `EN`, arquivos órfãos, assets faltando, templates órfãos, funções Python, regras duplicadas, classes sem CSS |
| `verify_coverage.py` | toda classe usada por uma tela tem regra num CSS que aquela tela carrega |
| `treeshake.py` | classe CSS sem uso, import Python sem uso, biblioteca carregada sem ser chamada |
| `verify_css_parse.mjs` | todo CSS passa por um parser de verdade — navegador descarta regra malformada calado |
| `test_*.py` | rotas, API, isolamento entre contas e limites, contra o banco local |
| `test-*.mjs` | comportamento em jsdom, contra o HTML renderizado pelo Flask |
| `verify_csp.mjs` | a CSP num Chrome de verdade, tela por tela: nada bloqueado, e o que tinha de passar passou |
| `verify_confirmar.mjs` | o que saiu de `onsubmit`/`onload` continua funcionando — inclusive o caminho de ACEITAR, porque um ouvinte que sempre cancela "protege" impedindo a pessoa de excluir |
| `auditar_kotlin.py` | o mesmo que o `audit.py`, para o app Android: sete categorias de código morto |

Três lições que valem mais que as ferramentas:

- **Nenhuma ferramenta aponta para produção.** A `.env` do repositório aponta
  para o Neon; um `create_app()` direto num verificador criaria conta de teste e
  escreveria no banco de verdade. Todo script de servidor entra por `devapp.py`,
  que crava a URL local **antes** de `app` ser importado e ainda checa isso de
  novo na subida.
- **Comparar contra o HTML renderizado, não contra o fonte do template.** Classe
  montada por interpolação (`hourglass-{{ size }}`) nunca aparece literal no
  fonte e parece morta sem estar.
- **Verificador que grita à toa não serve.** Falso positivo tem que ser
  eliminado na ferramenta, não ignorado na leitura — senão o relatório inteiro
  vira ruído e para de ser lido.

---

## 12. Comentário

Comentário explica **por que**, nunca **o quê**. Se descreve o que a linha já
diz, sai. Se registra a decisão, o problema que ela resolve ou a alternativa
descartada, fica — é o que impede alguém (inclusive daqui a seis meses) de
"simplificar" de volta para o bug.
