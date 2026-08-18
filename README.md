# Event Notifier (Python + Flask)

Aplicativo simples para cadastrar eventos e enviar notificações em:
- Web Push (notificação do navegador/Windows sem Python local)
- Desktop local opcional (quando rodando no Windows)

Recursos de interface:
- Tag de tipo no cadastro: `Evento` ou `Curso`, cada uma com cor própria
- Sidebar com menu de navegação
- Aba de calendário grande para visualizar eventos e cursos
- Aba **Weekly Planner**: grade semanal de 24 horas com blocos arrastáveis
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

## Otimizações aplicadas

- Fontes: só as duas famílias do tema padrão bloqueiam a renderização; as outras 18 (usadas apenas nos previews) carregam de forma assíncrona
- Estáticos servidos com `?v=<mtime>` e `Cache-Control: immutable` de 1 ano
- Service worker com cache-first para `/static/` (seguro, pois as URLs são versionadas)
- Scripts com `defer` e tema aplicado antes da primeira pintura (sem flash de tema errado)
- SQLite em modo WAL com `busy_timeout`, para o scheduler não travar as requisições
- Índices em `events(event_datetime)`, `reminder_dispatches` e `planner_blocks(day_of_week, start_minute)`
- `preconnect`/`dns-prefetch` para os CDNs usados

## Estrutura

```
event_notifier/
  app/
    __init__.py
    config.py
    db.py
    services/
      notifier.py
      scheduler_service.py
    static/
      sw.js
      manifest.webmanifest
      style.css
      planner-page.js
    templates/
      index.html
      planner.html
  .env.example
  .dockerignore
  Dockerfile
  .gitignore
  requirements.txt
  wsgi.py
  run.py
  README.md
```

## Como rodar

1. Entre na pasta do projeto:

```bash
cd event_notifier
```

2. Crie e ative ambiente virtual (Windows PowerShell):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

3. Instale dependências:

```bash
pip install -r requirements.txt
```

4. Crie o `.env` a partir do exemplo:

```powershell
Copy-Item .env.example .env
```

5. Ajuste apenas variáveis locais do app no `.env` se necessário.

6. Gere chaves VAPID para Web Push:

```bash
python tools/generate_vapid_keys.py
```

Copie os valores para o `.env`:

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:voce@exemplo.com
```

7. Execute:

```bash
python run.py
```

8. Acesse no navegador:

http://127.0.0.1:5000

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
