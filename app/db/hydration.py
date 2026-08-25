"""Água: configuração do lembrete e consumo do dia, uma linha por conta.

O consumo é guardado como TOTAL do dia (`hydration_intake`), e não como um
registro por copo. A tela e o widget só perguntam "quantos hoje?", e essa
pergunta vira uma leitura de chave primária em vez de um COUNT sobre a história
inteira, que cresceria para sempre.
"""

from datetime import date, datetime, timedelta

from app.db.connection import get_connection


MIN_GOAL = 1
MAX_GOAL = 30
MIN_GLASS_ML = 50
MAX_GLASS_ML = 2000
MIN_INTERVAL = 1
MAX_INTERVAL = 1440


_SETTINGS_SELECT = """
    SELECT user_id, enabled, interval_minutes,
           COALESCE(start_time, '08:00') AS start_time,
           COALESCE(end_time, '22:00') AS end_time,
           last_sent_at, daily_goal, glass_ml
    FROM hydration_settings
"""


def clamp(value, low: int, high: int, fallback: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return min(max(number, low), high)


def today_iso() -> str:
    """O dia do consumo é o dia LOCAL do servidor.

    Mesmo relógio que o agendador usa para decidir a janela do lembrete — se um
    usasse UTC e o outro local, o contador zeraria numa hora e o lembrete
    mudaria de janela em outra.
    """
    return date.today().isoformat()


def next_reminder_seconds(settings) -> int | None:
    """Quantos SEGUNDOS faltam para o próximo lembrete poder sair.

    Segundos, e não um horário: o servidor no deploy roda em UTC e o navegador
    da pessoa está em outro fuso. Um ISO sem fuso mandado para o cliente seria
    lido como hora local e a contagem erraria por horas. Uma duração não tem
    esse problema — o cliente conta a partir de quando recebeu.

    `None` quando o lembrete está desligado ou nunca saiu: nesse caso o próximo
    é "assim que entrar na janela", e não uma hora marcada.
    """
    if not settings or not settings["enabled"]:
        return None
    return seconds_until(settings["last_sent_at"], settings["interval_minutes"])


def seconds_until(last_sent_at, interval_minutes) -> int | None:
    """Aritmetica pura do proximo lembrete, sem tocar no banco.

    Existe separado porque a barra lateral precisa do mesmo numero em toda
    pagina, e la os dados ja vieram na consulta do usuario.
    """
    if not last_sent_at:
        return None
    try:
        last = datetime.fromisoformat(last_sent_at)
    except (TypeError, ValueError):
        return None
    due = last + timedelta(minutes=max(1, int(interval_minutes or 60)))
    return max(0, int((due - datetime.now()).total_seconds()))


def get_hydration_settings(user_id: int):
    """A linha é criada junto com a conta, em `create_user`. O upsert aqui é
    rede de segurança para conta que exista de antes desta tabela."""
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO hydration_settings (user_id) VALUES (%s) ON CONFLICT DO NOTHING",
            (user_id,),
        )
        return conn.execute(
            _SETTINGS_SELECT + " WHERE user_id = %s", (user_id,)
        ).fetchone()


def list_enabled_hydration_settings():
    """Contas com o lembrete ligado. Quem chama é o agendador, fora de requisição."""
    with get_connection() as conn:
        return conn.execute(_SETTINGS_SELECT + " WHERE enabled IS TRUE").fetchall()


def upsert_hydration_settings(
    user_id: int,
    enabled: bool,
    interval_minutes: int,
    start_time: str,
    end_time: str,
    daily_goal: int = 8,
    glass_ml: int = 250,
) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO hydration_settings
            (user_id, enabled, interval_minutes, start_time, end_time, daily_goal, glass_ml)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE SET
                enabled = EXCLUDED.enabled,
                interval_minutes = EXCLUDED.interval_minutes,
                start_time = EXCLUDED.start_time,
                end_time = EXCLUDED.end_time,
                daily_goal = EXCLUDED.daily_goal,
                glass_ml = EXCLUDED.glass_ml
            """,
            (
                user_id,
                bool(enabled),
                clamp(interval_minutes, MIN_INTERVAL, MAX_INTERVAL, 60),
                start_time,
                end_time,
                clamp(daily_goal, MIN_GOAL, MAX_GOAL, 8),
                clamp(glass_ml, MIN_GLASS_ML, MAX_GLASS_ML, 250),
            ),
        )


def update_hydration_last_sent(user_id: int, sent_at_iso: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE hydration_settings SET last_sent_at = %s WHERE user_id = %s",
            (sent_at_iso, user_id),
        )


def get_hydration_today(user_id: int) -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT glasses FROM hydration_intake WHERE user_id = %s AND day = %s",
            (user_id, today_iso()),
        ).fetchone()
    return row["glasses"] if row else 0


def change_hydration_glasses(user_id: int, delta: int, drank_at_iso: str) -> int:
    """Soma (ou desconta) copos do dia e devolve o total depois da mudança.

    Um `INSERT ... ON CONFLICT DO UPDATE` só, e não "ler, somar, gravar": dois
    cliques rápidos, ou o botão da tela e o do widget ao mesmo tempo, perderiam
    um copo na leitura obsoleta entre as duas consultas.

    `GREATEST(..., 0)` porque desfazer no zero não pode virar total negativo.
    """
    step = 1 if delta > 0 else -1

    with get_connection() as conn:
        row = conn.execute(
            """
            INSERT INTO hydration_intake (user_id, day, glasses, last_drink_at)
            VALUES (%(user_id)s, %(day)s, GREATEST(%(step)s, 0), %(at)s)
            ON CONFLICT (user_id, day) DO UPDATE SET
                glasses = GREATEST(hydration_intake.glasses + %(step)s, 0),
                last_drink_at = %(at)s
            RETURNING glasses
            """,
            {
                "user_id": user_id,
                "day": today_iso(),
                "step": step,
                "at": drank_at_iso,
            },
        ).fetchone()
    return row["glasses"]
