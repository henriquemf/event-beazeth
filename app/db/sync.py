"""Sincronização por diferença, para o app Android.

O aplicativo não pode buscar tudo a cada abertura — é o que faria a tela
esperar a rede, que é justamente o problema que o app nativo existe para
resolver. Então ele guarda o instante da última conversa e pergunta apenas
"o que mudou desde então?".

A resposta tem duas metades, e as duas são necessárias:

* **mudou** — linhas com `updated_at` mais novo que o `since`. Serve tanto para
  criação quanto para edição: o aplicativo grava por cima pelo id, e o efeito
  é o mesmo nos dois casos.
* **sumiu** — as lápides. Sem esta metade o celular ressuscita o que foi
  apagado no site, porque uma linha que sumiu é indistinguível de uma que nunca
  chegou.

Quem preenche `updated_at` e escreve a lápide são gatilhos do Postgres, não
este módulo — ver `schema.py`.
"""

from app.db.connection import get_connection
from app.db.diary import _COLUNAS_DO_DIA, _linha_para_dia
from app.db.events import _EVENT_SELECT
from app.db.notes import _NOTE_COLUMNS, _row_to_note_dict
from app.db.planner import _row_to_planner_dict
from app.db.todo import _ITEM_COLUMNS, _row_to_item


# O piso quando o aplicativo nunca sincronizou.
#
# Um segundo ANTES do DEFAULT das colunas criadas na migração, e não igual a
# ele: a comparação é estrita (`updated_at > since`), e com o piso igual ao
# DEFAULT toda linha que existia antes da migração — e nunca foi tocada desde
# então — ficava de fora da primeira conversa. Foi assim que a configuração de
# água de uma conta antiga nunca chegou ao celular, e sem ela o app não tinha
# de onde tirar o horário do lembrete.
INICIO_DOS_TEMPOS = "1969-12-31T23:59:59"


def _agora(conn) -> str:
    """O relógio do BANCO, não o do processo Python.

    Tem de ser o mesmo relógio que os gatilhos usam para carimbar. Se o app
    guardasse um instante vindo daqui e os carimbos viessem de lá, qualquer
    diferença entre os dois relógios viraria linha perdida — a mais silenciosa
    das falhas, porque só aparece na linha que ficou para trás.
    """
    return conn.execute(
        "SELECT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS') AS agora"
    ).fetchone()["agora"]


def coletar_mudancas(user_id: int, since: str | None) -> dict:
    """O que mudou e o que sumiu, desde `since`.

    Devolve também `now`: o instante que o aplicativo deve guardar para a
    próxima chamada. Ele é lido ANTES das consultas de propósito. Uma linha
    gravada no meio da leitura acaba vindo nesta resposta e na seguinte —
    repetida, o que não faz mal nenhum, porque o aplicativo grava por id. O
    contrário, perder a linha, seria permanente.
    """
    desde = since or INICIO_DOS_TEMPOS

    with get_connection() as conn:
        agora = _agora(conn)

        def mudou(sql, *extra):
            return conn.execute(sql, (user_id, desde, *extra)).fetchall()

        notas = mudou(
            "SELECT " + _NOTE_COLUMNS + " FROM sticky_notes"
            " WHERE user_id = %s AND updated_at > %s ORDER BY updated_at"
        )
        tarefas = mudou(
            "SELECT " + _ITEM_COLUMNS + " FROM todo_items"
            " WHERE user_id = %s AND updated_at > %s ORDER BY updated_at"
        )
        blocos = mudou(
            "SELECT id, title, notes, day_of_week, start_minute, end_minute, color, is_routine"
            " FROM planner_blocks WHERE user_id = %s AND updated_at > %s ORDER BY updated_at"
        )
        # Reaproveita o SELECT que o resto do app usa, para o evento chegar
        # ao celular com a tag ja resolvida -- os mesmos campos que a tela ve.
        eventos = mudou(
            _EVENT_SELECT + " WHERE e.user_id = %s AND e.updated_at > %s ORDER BY e.updated_at"
        )
        tags = mudou(
            "SELECT slug, label, color, reminder_rule FROM event_tags"
            " WHERE user_id = %s AND updated_at > %s ORDER BY updated_at"
        )
        agua = mudou(
            "SELECT day, glasses FROM hydration_intake"
            " WHERE user_id = %s AND updated_at > %s ORDER BY day"
        )
        diario = mudou(
            "SELECT " + _COLUNAS_DO_DIA + " FROM diary_entries"
            " WHERE user_id = %s AND updated_at > %s ORDER BY day"
        )
        config = conn.execute(
            "SELECT enabled, daily_goal, glass_ml, interval_minutes, start_time, end_time"
            " FROM hydration_settings WHERE user_id = %s AND updated_at > %s",
            (user_id, desde),
        ).fetchone()

        apagados = conn.execute(
            "SELECT entity, entity_id FROM deletions"
            " WHERE user_id = %s AND deleted_at > %s ORDER BY deleted_at",
            (user_id, desde),
        ).fetchall()

    return {
        "now": agora,
        "changed": {
            "notes": [_row_to_note_dict(r) for r in notas],
            "todoItems": [_row_to_item(r) for r in tarefas],
            "plannerBlocks": [_row_to_planner_dict(r) for r in blocos],
            # `user_id` sai fora: o cliente ja sabe de quem e a conta, e
            # devolve-lo so daria a impressao de que ha outras.
            "events": [{k: v for k, v in r.items() if k != "user_id"} for r in eventos],
            "tags": [dict(r) for r in tags],
            "hydrationIntake": [dict(r) for r in agua],
            "diaryEntries": [_linha_para_dia(r) for r in diario],
            # Uma linha por conta, então vem como objeto ou `None` — e `None`
            # aqui significa "não mudou", não "não existe".
            "hydrationSettings": dict(config) if config else None,
        },
        "deleted": [{"entity": r["entity"], "id": r["entity_id"]} for r in apagados],
    }
