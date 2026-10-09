"""Os pomodoros da conta: o principal e até dez outros, uma linha cada.

Até a 1.13 o pomodoro era só do aparelho (localStorage no site, DataStore no
app), e o que se criava no PC nunca aparecia no celular. Agora cada temporizador
é uma linha daqui, e passa pela mesma sincronização de todo o resto: carimbo,
lápide, contador de mudanças.

## O que se guarda é a última AÇÃO, não o relógio

Começar, pausar, retomar, zerar, renomear, trocar o tempo, criar, remover --
cada uma grava o estado que ela deixou. O que acontece sozinho (o descanso que
começa quando o foco acaba, o descanso que acaba) não é gravado: os dois lados
calculam do mesmo jeito, a partir do mesmo `fimEm`. O descanso começa no
INSTANTE em que o foco acabou, e não quando alguém percebeu. Gravar a
transição faria cada aparelho mandar a sua versão dela, com segundos de
diferença, e um sobrescrever o outro.

## O formato

`dados` é um JSON, sempre do mesmo jeito (`normalizar`), com chaves ordenadas:
dois aparelhos que mandam o mesmo estado mandam o mesmo texto, e o UPDATE que
não muda nada não mexe no carimbo nem no contador.

- `fase`: "parado", "foco" ou "descanso".
- `fimEm`: o instante (epoch em ms) em que a fase termina, se ela corre.
- `restanteMs`: o que falta, se ela está pausada (`fimEm` zero).
- `totalMs`: a duração da fase, para a barra de progresso.
- `minutos`: o tempo de foco escolhido.
- `nome` e `posicao`: só nos outros pomodoros.
- `descansoAutomatico`: só no principal; vale para todos.
"""

import json
import re

from app.db.connection import get_connection, utc_now_iso


PRINCIPAL = "principal"
# O principal mais os dez outros. Espelha `MAX_SUBS` em `core/pomodoro.js`.
MAX_POMODOROS = 11
MAX_NOME = 24
MIN_MINUTOS = 1
MAX_MINUTOS = 600
FASES = ("parado", "foco", "descanso")

_ID_VALIDO = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
# Um instante em ms até o ano 2286: o que passa disso não é relógio.
_MAX_INSTANTE = 9_999_999_999_999
_MAX_DURACAO = MAX_MINUTOS * 60_000


def id_valido(timer_id) -> bool:
    return isinstance(timer_id, str) and bool(_ID_VALIDO.match(timer_id))


def _inteiro(valor, minimo: int, maximo: int, padrao: int) -> int:
    # `bool` é `int` em Python: `True` não pode virar 1 minuto.
    if isinstance(valor, bool):
        return padrao
    try:
        numero = int(valor)
    except (TypeError, ValueError, OverflowError):
        return padrao
    return min(max(numero, minimo), maximo)


def normalizar(timer_id: str, dados) -> dict:
    """O estado na forma de sempre. O que não faz sentido vira o padrão."""
    dados = dados if isinstance(dados, dict) else {}
    fase = dados.get("fase") if dados.get("fase") in FASES else "parado"
    limpo = {
        "fase": fase,
        "minutos": _inteiro(dados.get("minutos"), MIN_MINUTOS, MAX_MINUTOS, 25),
        "fimEm": 0,
        "restanteMs": 0,
        "totalMs": 0,
    }
    if fase != "parado":
        limpo["fimEm"] = _inteiro(dados.get("fimEm"), 0, _MAX_INSTANTE, 0)
        limpo["restanteMs"] = 0 if limpo["fimEm"] else _inteiro(dados.get("restanteMs"), 0, _MAX_DURACAO, 0)
        limpo["totalMs"] = _inteiro(dados.get("totalMs"), 0, _MAX_DURACAO, 0)
        # Nem correndo nem pausado com tempo: não há fase nenhuma.
        if not limpo["fimEm"] and not limpo["restanteMs"]:
            limpo.update(fase="parado", totalMs=0)

    if timer_id == PRINCIPAL:
        limpo["descansoAutomatico"] = dados.get("descansoAutomatico") is not False
    else:
        nome = dados.get("nome")
        limpo["nome"] = nome.strip()[:MAX_NOME] if isinstance(nome, str) else ""
        limpo["posicao"] = _inteiro(dados.get("posicao"), 0, MAX_POMODOROS, 0)
    return limpo


def _para_texto(dados: dict) -> str:
    return json.dumps(dados, sort_keys=True, separators=(",", ":"))


def linha_para_dict(row) -> dict:
    """A linha como o cliente a recebe: o estado com o `id` junto."""
    try:
        dados = json.loads(row["dados"])
    except (TypeError, ValueError):
        dados = {}
    return {"id": row["timer_id"], **normalizar(row["timer_id"], dados)}


def listar_pomodoros(user_id: int) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT timer_id, dados FROM pomodoros WHERE user_id = %s ORDER BY timer_id",
            (user_id,),
        ).fetchall()
    return [linha_para_dict(r) for r in rows]


def gravar_pomodoro(user_id: int, timer_id: str, dados) -> dict | None:
    """Grava o estado. `None` se é um temporizador NOVO e a conta já tem onze.

    O teto recusa o novo; não apaga nenhum dos que existem. E o mesmo estado
    gravado de novo não é escrita: o `WHERE ... IS DISTINCT FROM` deixa a
    linha, o carimbo e o contador quietos.
    """
    limpo = normalizar(timer_id, dados)
    texto = _para_texto(limpo)
    with get_connection() as conn:
        existe = conn.execute(
            "SELECT 1 FROM pomodoros WHERE user_id = %s AND timer_id = %s",
            (user_id, timer_id),
        ).fetchone()
        if not existe:
            total = conn.execute(
                "SELECT COUNT(*) AS n FROM pomodoros WHERE user_id = %s", (user_id,)
            ).fetchone()["n"]
            if total >= MAX_POMODOROS:
                return None
        conn.execute(
            """
            INSERT INTO pomodoros (user_id, timer_id, dados, created_at)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (user_id, timer_id) DO UPDATE SET dados = EXCLUDED.dados
            WHERE pomodoros.dados IS DISTINCT FROM EXCLUDED.dados
            """,
            (user_id, timer_id, texto, utc_now_iso()),
        )
    return {"id": timer_id, **limpo}


def apagar_pomodoro(user_id: int, timer_id: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "DELETE FROM pomodoros WHERE user_id = %s AND timer_id = %s",
            (user_id, timer_id),
        )
