"""Rotas de infraestrutura: health check, service worker e favicon."""

from time import perf_counter

from flask import Blueprint, current_app, jsonify

from app.db import get_connection
from app.db.connection import pool_churn
from app.services.scheduler_service import scheduler_status


bp = Blueprint("system", __name__)


@bp.get("/healthz")
def healthz():
    """Saúde do serviço, e o healthCheckPath do Render.

    Toca o banco de propósito: um app que não alcança o Postgres não está
    saudável, e um health check que só responde "de pé" esconderia exatamente
    a falha que mais importa aqui — o banco é externo.

    `lastScanSeconds` diz se o agendador de lembretes está girando. Como ele
    vive dentro deste processo, e o serviço gratuito do Render dorme,
    encontrar `null` ou um número grande é o sintoma esperado de um serviço
    que acabou de acordar.

    Os dois tempos existem para responder "o banco está longe ou está doente?"
    sem chutar. `queryMs` é UMA ida de rede limpa numa conexão já aberta: é a
    distância entre o app e o banco, e nada mais. `poolMs` é o que custou
    conseguir a conexão — que em condição normal é o ping de validação do pool,
    ou seja, mais uma ida de rede. Os dois parecidos é o esperado.

    Como ler:

    * `queryMs` ~1-5   -> app e banco na mesma região; a lentidão está noutro lugar
    * `queryMs` ~150+  -> regiões diferentes. Cada consulta paga isso, e uma tela
                          faz de 2 a 8 consultas, em série
    * `poolMs` muito maior que `queryMs` -> a conexão teve de ser reaberta: TLS
                          novo, mais o tempo de o banco acordar da suspensão.
                          Confirme em `db.lost`, que conta as conexões perdidas
                          desde a subida — se ela sobe a cada visita, o problema
                          é churn de conexão, não distância.

    Repita a chamada 3 ou 4 vezes seguidas: a primeira depois de uma pausa é a
    cara, as seguintes mostram o custo em regime.
    """
    payload = {"ok": True, "database": "ok", **scheduler_status()}

    try:
        antes = perf_counter()
        with get_connection() as conn:
            payload["poolMs"] = round((perf_counter() - antes) * 1000, 1)

            antes = perf_counter()
            conn.execute("SELECT 1")
            payload["queryMs"] = round((perf_counter() - antes) * 1000, 1)
    except Exception:
        current_app.logger.exception("Health check não alcançou o banco.")
        payload["ok"] = False
        payload["database"] = "unreachable"
        return jsonify(payload), 503

    payload["db"] = pool_churn()
    return jsonify(payload)


@bp.get("/sw.js")
def service_worker():
    # Servido da raiz para o escopo do service worker cobrir o site inteiro,
    # e sem cache para uma atualização entrar já no próximo carregamento.
    response = current_app.send_static_file("sw.js")
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


@bp.get("/favicon.ico")
def favicon():
    return current_app.send_static_file("icon.svg")


@bp.get("/.well-known/assetlinks.json")
def assetlinks():
    """Prova ao Android que este site e o .apk são da mesma pessoa.

    Sem este arquivo o app ainda abre e funciona, mas **com barra de endereço**
    no topo — o Android não conseguiu confirmar o vínculo e trata a janela como
    navegador. Com ele, abre em tela cheia, como aplicativo.

    Serve de rota e não de arquivo estático porque a impressão digital sai da
    chave que assina o .apk: ela vive no ambiente, junto com os outros segredos,
    e não no repositório. Enquanto não estiver configurada, responde 404 —
    honesto, e visível no navegador na hora de diagnosticar.

    O caminho é fixado pela especificação do Digital Asset Links; não adianta
    servir noutro lugar.
    """
    package = current_app.config["ANDROID_PACKAGE_NAME"]
    fingerprint = current_app.config["ANDROID_CERT_FINGERPRINT"]

    if not package or not fingerprint:
        return jsonify({
            "ok": False,
            "message": "ANDROID_PACKAGE_NAME e ANDROID_CERT_FINGERPRINT não configurados.",
        }), 404

    return jsonify([
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": package,
                # Aceita mais de uma, separadas por vírgula: é o que permite
                # trocar de chave de assinatura sem quebrar quem já instalou.
                "sha256_cert_fingerprints": [
                    valor.strip() for valor in fingerprint.split(",") if valor.strip()
                ],
            },
        }
    ])
