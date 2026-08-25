"""Criação das tabelas e índices.

Sem as migrações guardadas que existiam antes (`if coluna in colunas`): elas
consertavam um arquivo SQLite que ia sendo carregado de versão em versão. O
Postgres é banco novo e nunca viu aquelas colunas — código que nenhuma linha de
dado alcança.

Toda tabela de conteúdo carrega `user_id` com `ON DELETE CASCADE`: apagar a
conta leva junto tudo que era dela, sem varredura manual tabela por tabela.
"""

from app.db.connection import get_connection


STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
    )
    """,
    # A chave é (user_id, slug) e não só o slug: duas pessoas podem ter uma tag
    # "prova" sem uma esbarrar na da outra.
    """
    CREATE TABLE IF NOT EXISTS event_tags (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        label TEXT NOT NULL,
        color TEXT NOT NULL,
        reminder_rule TEXT NOT NULL DEFAULT 'dia',
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, slug)
    )
    """,
    # `event_datetime` continua TEXT em ISO-8601, e não TIMESTAMP, porque é
    # assim que ele chega do formulário, é assim que o JS o devolve e a
    # comparação lexicográfica de ISO-8601 ordena igual à cronológica. Trocar o
    # tipo mudaria o formato em cinco lugares para ganhar nada aqui.
    """
    CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        event_datetime TEXT NOT NULL,
        tag_type TEXT NOT NULL DEFAULT 'evento',
        created_at TEXT NOT NULL
    )
    """,
    # Sem `user_id` próprio: o dono vem do evento, e o CASCADE daqui já limpa
    # tudo quando o evento (ou a conta) some.
    """
    CREATE TABLE IF NOT EXISTS reminder_dispatches (
        id BIGSERIAL PRIMARY KEY,
        event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        reminder_type TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        sent_at TEXT NOT NULL,
        UNIQUE (event_id, reminder_type, channel, status)
    )
    """,
    # Era uma linha única (`CHECK (id = 1)`); virou uma linha por conta.
    """
    CREATE TABLE IF NOT EXISTS hydration_settings (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        interval_minutes INTEGER NOT NULL DEFAULT 60,
        start_time TEXT NOT NULL DEFAULT '08:00',
        end_time TEXT NOT NULL DEFAULT '22:00',
        last_sent_at TEXT,
        daily_goal INTEGER NOT NULL DEFAULT 8,
        glass_ml INTEGER NOT NULL DEFAULT 250
    )
    """,
    # O endpoint era único no banco inteiro. Com contas, o mesmo navegador pode
    # estar inscrito em duas — e cada conta precisa da sua inscrição para
    # receber os próprios lembretes.
    """
    CREATE TABLE IF NOT EXISTS push_subscriptions (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (user_id, endpoint)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS planner_blocks (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        day_of_week INTEGER NOT NULL,
        start_minute INTEGER NOT NULL,
        end_minute INTEGER NOT NULL,
        color TEXT NOT NULL DEFAULT 'rose',
        is_routine BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sticky_notes (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL DEFAULT '',
        bucket TEXT NOT NULL DEFAULT 'hoje',
        pos_x INTEGER NOT NULL DEFAULT 24,
        pos_y INTEGER NOT NULL DEFAULT 24,
        width INTEGER NOT NULL DEFAULT 224,
        height INTEGER NOT NULL DEFAULT 208,
        color TEXT NOT NULL DEFAULT 'sun',
        z_index INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS todo_items (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        content TEXT NOT NULL,
        done BOOLEAN NOT NULL DEFAULT FALSE,
        position INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
    )
    """,
    # Uma linha por conta e por DIA. Guardar o total do dia, e nao um registro
    # por copo, e o que faz a tela abrir com uma leitura de chave primaria em
    # vez de um COUNT sobre a historia inteira.
    """
    CREATE TABLE IF NOT EXISTS hydration_intake (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        glasses INTEGER NOT NULL DEFAULT 0,
        last_drink_at TEXT,
        PRIMARY KEY (user_id, day)
    )
    """,
    # Contas criadas antes da meta diaria existir. `IF NOT EXISTS` deixa isto
    # rodar em toda subida sem custo e sem quebrar em banco ja migrado -- e o
    # equivalente em Postgres das migracoes guardadas que o SQLite exigia.
    "ALTER TABLE hydration_settings ADD COLUMN IF NOT EXISTS daily_goal INTEGER NOT NULL DEFAULT 8",
    "ALTER TABLE hydration_settings ADD COLUMN IF NOT EXISTS glass_ml INTEGER NOT NULL DEFAULT 250",
    # Todo índice começa por `user_id`: nenhuma consulta do app lê linha de
    # outra conta, então o filtro do dono é sempre o primeiro a ser aplicado.
    "CREATE INDEX IF NOT EXISTS idx_events_user_datetime ON events(user_id, event_datetime)",
    "CREATE INDEX IF NOT EXISTS idx_events_user_tag ON events(user_id, tag_type)",
    # Este é do agendador, que varre a janela de lembretes de todas as contas de
    # uma vez — aqui a data vem primeiro.
    "CREATE INDEX IF NOT EXISTS idx_events_datetime ON events(event_datetime)",
    "CREATE INDEX IF NOT EXISTS idx_dispatches_lookup "
    "ON reminder_dispatches(event_id, reminder_type, channel, status)",
    "CREATE INDEX IF NOT EXISTS idx_planner_user_day ON planner_blocks(user_id, day_of_week, start_minute)",
    "CREATE INDEX IF NOT EXISTS idx_notes_user_bucket ON sticky_notes(user_id, bucket, z_index)",
    "CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id)",
    # A tela sempre pede um intervalo de dias de UMA conta, nesta ordem exata.
    "CREATE INDEX IF NOT EXISTS idx_todo_user_day ON todo_items(user_id, day, position)",
)


def init_db() -> None:
    with get_connection() as conn:
        for statement in STATEMENTS:
            conn.execute(statement)
