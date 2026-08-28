"""Versionamento de estáticos e cabeçalhos de resposta.

Separado da fábrica para deixar `create_app` legível: aqui mora tudo o que é
infraestrutura de entrega (cache busting, cache longo, headers de segurança).
"""

import secrets
from pathlib import Path

from flask import g, request, url_for


# Content-Security-Policy: a lista do que esta pagina pode carregar.
#
# Vale a pena escrever o porquê de cada origem, porque uma linha a mais aqui é
# uma porta a mais para um XSS entrar por ela:
#
# - `default-src 'self'` fecha tudo o que não estiver dito abaixo;
# - `script-src` leva NONCE em vez de `'unsafe-inline'`. São dois scripts
#   inline no projeto (o bootstrap de tema e as speculation rules), e os dois
#   ganham o nonce do pedido. Com `'unsafe-inline'` a política não valeria
#   quase nada: qualquer `<script>` injetado rodaria igual;
# - `jsdelivr` é de onde vêm flatpickr e FullCalendar, as duas únicas
#   bibliotecas de terceiros do projeto;
# - `style-src` precisa de `'unsafe-inline'` e não tem jeito: a geometria dos
#   post-its e a cor das tags chegam em `style="--n-x: ..."`, atributo de
#   estilo é inline por definição, e o FullCalendar injeta `<style>` sozinho.
#   Perde-se pouco: CSS injetado não executa código;
# - `frame-ancestors 'none'` é o `X-Frame-Options` moderno (o antigo continua
#   junto, para navegador velho);
# - `font-src` aceita `data:` porque o CSS do flatpickr traz o próprio
#   iconefonte embutido em base64. Sem isso o calendário abre sem as setas de
#   mês, e o navegador só reclama no console;
# - `connect-src 'self'` basta porque o service worker só toca em `/static/`
#   da própria origem.
_CSP = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'none'; "
    "form-action 'self'; "
    "img-src 'self' data:; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; "
    "script-src 'self' 'nonce-{nonce}' https://cdn.jsdelivr.net; "
    "connect-src 'self'; "
    "manifest-src 'self'; "
    "worker-src 'self'"
)


def register_asset_helpers(app):
    """Publica `static_url()` nos templates.

    A URL leva `?v=<mtime>`, o que permite cache de um ano sem risco de servir
    arquivo velho: quando o arquivo muda, a URL muda junto.
    """
    static_dir = Path(app.static_folder)
    asset_versions = {}

    def static_url(filename):
        """URL de estático com hash de mtime, para cache longo sem servir arquivo velho."""
        if filename not in asset_versions or app.config["DEBUG"]:
            try:
                asset_versions[filename] = int((static_dir / filename).stat().st_mtime)
            except OSError:
                asset_versions[filename] = 0
        return url_for("static", filename=filename, v=asset_versions[filename])

    app.jinja_env.globals["static_url"] = static_url
    app.jinja_env.trim_blocks = True
    app.jinja_env.lstrip_blocks = True


def register_response_headers(app):
    @app.before_request
    def gerar_nonce():
        """Um nonce por requisição, para os dois scripts inline.

        Precisa ser imprevisível e novo a cada resposta: um valor fixo seria a
        mesma coisa que `'unsafe-inline'` para quem lesse o HTML uma vez.
        """
        g.csp_nonce = secrets.token_urlsafe(16)

    @app.context_processor
    def publicar_nonce():
        return {"csp_nonce": getattr(g, "csp_nonce", "")}

    @app.after_request
    def add_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = _CSP.format(
            nonce=getattr(g, "csp_nonce", "")
        )
        # HSTS: o navegador passa a recusar http para este host por um ano.
        # Fecha a janela do primeiro acesso digitado sem `https://`, em que um
        # intermediário responderia no lugar do site.
        #
        # Fora do DEBUG só: em desenvolvimento o app roda em http, e um HSTS
        # gravado por um `localhost` fica no navegador atrapalhando outros
        # projetos por um ano.
        if not app.config["DEBUG"]:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # Estáticos são versionados por ?v=<mtime>, então podem ficar em cache longo.
        if request.path.startswith("/static/") and request.args.get("v"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response
