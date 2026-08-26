import os
from pathlib import Path

from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# Valor do .env.example. Serve para desenvolver, e é justamente por isso que não
# pode passar despercebido em produção: quem conhece a chave forja o cookie de
# sessão e entra como qualquer conta.
PLACEHOLDER_SECRET = "troque-esta-chave"


class MissingSetting(RuntimeError):
    """Configuração obrigatória ausente. Falha na subida, não na primeira query."""


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-key")
    DEBUG = os.getenv("DEBUG", "False").lower() == "true"

    DATABASE_URL = os.getenv("DATABASE_URL", "").strip().strip('"').strip("'")

    # A sessão é a credencial: sem HttpOnly qualquer script na página a lê, e
    # sem SameSite ela viaja em requisição de outro site.
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = not DEBUG
    # Trinta dias para não deslogar a cada fechada de navegador.
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 24 * 30

    ENABLE_DESKTOP_NOTIFICATIONS = os.getenv("ENABLE_DESKTOP_NOTIFICATIONS", "True").lower() == "true"

    VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
    VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
    VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:admin@example.com")

    # Identidade do .apk, para o `/.well-known/assetlinks.json`.
    #
    # Vem do ambiente e não do código porque a impressão digital é derivada da
    # chave que assina o app: quem tiver a chave publica atualizações em nome
    # dele. Fora daqui, só o `.apk` e o keystore sabem esses valores.
    #
    # Vazios, o app funciona igual — só o .apk é que abre com barra de endereço,
    # porque o Android não consegue confirmar que o site e o pacote são da mesma
    # pessoa. Ver "Gerando o .apk" no README.
    ANDROID_PACKAGE_NAME = os.getenv("ANDROID_PACKAGE_NAME", "").strip()
    ANDROID_CERT_FINGERPRINT = os.getenv("ANDROID_CERT_FINGERPRINT", "").strip()


def check_required(config) -> None:
    """Recusa subir mal configurado.

    Antes o banco era um arquivo com caminho padrão e a chave de sessão tinha
    valor de brincadeira: os dois erros só apareceriam em produção, um como
    banco vazio a cada deploy e o outro como sessão forjável. Melhor não subir.
    """
    if not config["DATABASE_URL"]:
        raise MissingSetting(
            "DATABASE_URL não definida. Aponte para o Postgres "
            "(ex.: postgresql://usuario:senha@host/banco?sslmode=require). "
            "Veja a seção 'Como rodar' do README."
        )

    if config["DEBUG"]:
        return

    if config["SECRET_KEY"] in ("", "dev-key", PLACEHOLDER_SECRET):
        raise MissingSetting(
            "SECRET_KEY ausente ou ainda no valor de exemplo. Em produção ela "
            "assina o cookie de sessão: gere uma com "
            "`python -c \"import secrets; print(secrets.token_urlsafe(48))\"`."
        )
