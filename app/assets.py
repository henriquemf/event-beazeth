"""Versionamento de estáticos e cabeçalhos de resposta.

Separado da fábrica para deixar `create_app` legível: aqui mora tudo o que é
infraestrutura de entrega (cache busting, cache longo, headers de segurança).
"""

from pathlib import Path

from flask import request, url_for


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
    @app.after_request
    def add_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # Estáticos são versionados por ?v=<mtime>, então podem ficar em cache longo.
        if request.path.startswith("/static/") and request.args.get("v"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response
