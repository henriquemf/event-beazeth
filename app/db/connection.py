"""Conexão com o Postgres e utilitários de data.

Postgres e não mais o SQLite em arquivo porque o disco do container no Render é
efêmero: cada build ou restart criava um container novo e levava o `.db` junto.
O banco gerenciado vive fora do ciclo de deploy, então o dado sobrevive.

Um dialeto só, de propósito. Manter SQLite no local e Postgres no deploy
significaria duas versões de cada consulta — e a que não roda no dia a dia é a
que quebra sem ninguém ver. O README mostra como subir um Postgres local.
"""

from contextlib import contextmanager
from datetime import datetime, timezone

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


# O pool é do processo, não da requisição: o banco gerenciado fica fora do
# datacenter do app, e sem pool cada consulta pagaria um handshake TLS.
_pool: ConnectionPool | None = None

# Teto baixo porque o plano gratuito dos bancos gerenciados limita conexões
# simultâneas. O gunicorn roda um worker com algumas threads, mais a thread do
# agendador — folga suficiente para elas não ficarem na fila do pool, e longe
# do limite do banco.
POOL_MIN_SIZE = 1
POOL_MAX_SIZE = 8

# NÃO troque `check` por uma validação preguiçosa ("só valida o que está parado
# há mais de N segundos"). A ideia é tentadora — a validação é uma ida de rede
# inteira em cima de cada consulta, e o banco fica noutro datacenter — mas foi
# medida e reprovada: o pool guarda mais de uma conexão (o agendador é a segunda
# consumidora), e uma delas pode morrer por queda de rede enquanto as outras
# seguem em uso. Nesse caso a janela ainda está aberta, a conexão morta é
# entregue sem validação, e o usuário leva um erro 500 no lugar de 180ms a mais.
#
# O caminho certo para economizar essas idas não é pular a checagem: é encurtar
# a distância. Ver a nota sobre região no README.


def init_pool(database_url: str) -> None:
    """Abre o pool. Idempotente: `create_app` pode rodar mais de uma vez em teste."""
    global _pool
    if _pool is not None:
        return

    _pool = ConnectionPool(
        conninfo=database_url,
        min_size=POOL_MIN_SIZE,
        max_size=POOL_MAX_SIZE,
        kwargs={
            "row_factory": dict_row,
            # Desliga o prepared statement automático do psycopg.
            #
            # Supabase e Neon oferecem, e recomendam, um endpoint "pooler" em
            # modo transação (Supavisor / PgBouncer). Nesse modo a conexão do
            # servidor troca a cada transação, então o prepared statement que o
            # psycopg criou some — ou pior, colide com o de outra sessão, e a
            # consulta falha com "prepared statement already exists". O erro é
            # obscuro e só aparece depois da quinta execução da mesma consulta,
            # que é o limiar do psycopg.
            #
            # O preço é desprezível aqui: as consultas são pequenas e o gargalo
            # é a latência até o banco gerenciado, não o parse. Em troca,
            # qualquer connection string dos dois serviços funciona.
            "prepare_threshold": None,
        },
        # Bancos gerenciados no plano gratuito suspendem a instância ociosa e
        # derrubam o socket. Sem esta checagem, a primeira requisição depois de
        # um período parado receberia uma conexão morta do pool. Ver a nota
        # sobre validação preguiçosa no topo do arquivo antes de mexer aqui.
        check=ConnectionPool.check_connection,
        open=True,
    )


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def get_connection():
    """Conexão do pool, com commit no fim e rollback se algo estourar.

    Mesma forma de uso de antes (`with get_connection() as conn`), sem o
    caminho do arquivo: agora quem sabe onde fica o banco é o pool.
    """
    if _pool is None:
        raise RuntimeError("Pool não inicializado: chame init_pool() na subida do app.")

    with _pool.connection() as conn:
        yield conn


def pool_churn() -> dict:
    """Quantas conexões o pool já abriu e quantas perdeu, desde a subida.

    Serve para separar duas lentidões que se parecem por fora. Se `opened` fica
    perto de `POOL_MAX_SIZE` e `lost` fica em zero, o pool está estável e o que
    demora é a distância até o banco. Se as duas sobem sem parar, as conexões
    estão morrendo e cada consulta paga um handshake TLS novo (e, num banco que
    suspende por ociosidade, também o tempo de a instância acordar) — problema
    diferente, solução diferente.
    """
    if _pool is None:
        return {}
    stats = _pool.get_stats()
    return {
        "opened": stats.get("connections_num", 0),
        "lost": stats.get("connections_lost", 0),
        "size": stats.get("pool_size", 0),
    }


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")
