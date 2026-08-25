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
  assets.py            versionamento de estáticos e cabeçalhos de resposta
  extensions.py        instâncias compartilhadas (scheduler)
  blueprints/          UMA tela ou recurso por módulo
  db/                  UMA tabela por módulo; __init__ reexporta a API pública
  services/            trabalho que não é request (notificações, agendador)
  static/
    css/
      base.css         tokens, reset, layout, sidebar, cartões, forms, botões
      components.css   componentes que existem em TODAS as telas
      components/      componente de 2–3 telas; carregado só por elas
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

**O critério do CSS é o alcance, não o assunto.** Está em toda tela → `components.css`.
Está em duas ou três → `css/components/<nome>.css`, carregado no `head_extra`
delas. Está em uma → `css/pages/<tela>.css`. Foi assim que o modal de evento saiu
do pacote global: cinco telas baixavam 70 linhas de CSS de um modal que nunca
abriria ali.

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
eventos, configuração de lembrete.

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
- Um módulo de `db/` por tabela; migração sempre guardada (`if coluna in
  colunas`), para banco antigo se ajustar sozinho.
- `PATCH` aplica só as chaves presentes no payload. Cliente que salva geometria
  no arrasto e texto no editor, cada um no seu debounce, precisa disso — um `PUT`
  cheio faria um sobrescrever o outro.
- Constante que espelha limite do JS leva comentário dizendo de quem é o espelho.

---

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

## 11. Antes de dar por pronto

As ferramentas ficam no scratchpad da sessão e rodam contra o app de verdade:

| Ferramenta | O que garante |
|---|---|
| `audit.py` | 11 categorias de código morto: keyframes, variáveis CSS, ids, `data-*`, membros de `EN`, arquivos órfãos, assets faltando, templates órfãos, funções Python, regras duplicadas, classes sem CSS |
| `verify_coverage.py` | toda classe usada por uma tela tem regra num CSS que aquela tela carrega |
| `treeshake.py` | classe CSS sem uso, import Python sem uso, biblioteca carregada sem ser chamada |
| `test-*.mjs` | comportamento em jsdom, contra o HTML renderizado pelo Flask |

Duas lições que valem mais que as ferramentas:

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
