# Event Notifier (Python + Flask)

Aplicativo simples para cadastrar eventos e enviar notificações em:
- Web Push (notificação do navegador/Windows sem Python local)
- Desktop local opcional (quando rodando no Windows)

Recursos de interface:
- Tag de tipo no cadastro: `Evento` ou `Curso`, cada uma com cor própria
- Sidebar com menu de navegação
- Aba de calendário grande para visualizar eventos e cursos
- Aba de aparência com preview visual
- 10 temas e 10 fontes selecionáveis
- Seleção de tema e fonte por cards de preview (sem dropdown)
- Dark mode no menu lateral, aplicado em toda a interface (inclusive fundo e calendário)
- Nova aba de lembrete de beber água com intervalo e janela de horário
- Microanimações suaves de interface e sons de clique baixos
- Data com horário opcional no cadastro de evento
- PWA (manifest + service worker)
- Inscrição de notificações web direto no menu lateral

Regras de lembrete:
- Todo evento: notificação na hora do evento
- Se tag = curso: também notifica com 15 dias e 7 dias de antecedência

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
    templates/
      index.html
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
