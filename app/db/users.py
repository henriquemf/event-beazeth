"""Contas de acesso.

A senha nunca é gravada: o que fica é o hash do `werkzeug.security`, que já vem
com o Flask — nenhuma dependência nova para isso. O algoritmo (scrypt, por
padrão) e o sal ficam embutidos no próprio texto do hash, então trocar de
algoritmo depois não invalida os hashes antigos.
"""

from psycopg.errors import UniqueViolation
from werkzeug.security import check_password_hash, generate_password_hash

from app.db.connection import get_connection, utc_now_iso
from app.db.hydration import today_iso
from app.db.tags import DEFAULT_TAGS


MIN_PASSWORD_LENGTH = 8
MAX_EMAIL_LENGTH = 254
MAX_NAME_LENGTH = 40


def normalize_email(email: str) -> str:
    """E-mail é comparado sempre em minúsculas: ninguém deve conseguir criar
    `Ana@x.com` depois de `ana@x.com` existir e achar que é outra conta."""
    return (email or "").strip().lower()[:MAX_EMAIL_LENGTH]


def get_user_by_email(email: str):
    with get_connection() as conn:
        return conn.execute(
            "SELECT id, email, password_hash, display_name FROM users WHERE email = %s",
            (normalize_email(email),),
        ).fetchone()


def get_user(user_id: int):
    """A conta e o que a barra lateral precisa em TODA pagina, numa consulta so.

    O widget de agua vive na sidebar, ou seja, aparece em todas as telas. Buscar
    o consumo do dia num SELECT proprio dobraria as idas ao banco de cada
    carregamento -- e o banco e gerenciado, fora do datacenter do app, onde cada
    ida custa latencia de rede, nao de disco. Os LEFT JOIN aqui viajam de carona
    na consulta que ja acontecia.

    Sao LEFT e nao INNER de proposito: conta sem linha de configuracao (ou sem
    nada bebido hoje) continua entrando, com os padroes do COALESCE.
    """
    with get_connection() as conn:
        return conn.execute(
            """
            SELECT u.id, u.email, u.display_name,
                   COALESCE(h.enabled, FALSE)       AS water_enabled,
                   COALESCE(h.daily_goal, 8)        AS water_goal,
                   COALESCE(h.glass_ml, 250)        AS water_glass_ml,
                   COALESCE(h.interval_minutes, 60) AS water_interval,
                   h.last_sent_at                   AS water_last_sent,
                   COALESCE(i.glasses, 0)           AS water_glasses
            FROM users u
            LEFT JOIN hydration_settings h ON h.user_id = u.id
            LEFT JOIN hydration_intake i ON i.user_id = u.id AND i.day = %s
            WHERE u.id = %s
            """,
            (today_iso(), user_id),
        ).fetchone()


def create_user(email: str, password: str, display_name: str):
    """Cria a conta com o espaço já montado. Devolve None se o e-mail existir.

    As tabelas do usuário nascem juntas e na MESMA transação: uma conta sem tag
    padrão deixaria o popup de agendamento sem nenhuma opção marcável, e uma
    sem linha de hidratação quebraria a tela de água na primeira visita.
    """
    now = utc_now_iso()
    with get_connection() as conn:
        # Transação explícita: o pool roda em autocommit, então cada instrução
        # gravaria sozinha e uma falha no meio deixaria uma conta pela metade.
        with conn.transaction():
            row = conn.execute(
                """
                INSERT INTO users (email, password_hash, display_name, created_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (email) DO NOTHING
                RETURNING id
                """,
                (
                    normalize_email(email),
                    generate_password_hash(password),
                    display_name.strip()[:MAX_NAME_LENGTH],
                    now,
                ),
            ).fetchone()

            if row is None:
                return None

            user_id = row["id"]

            for slug, label, color, rule in DEFAULT_TAGS:
                conn.execute(
                    """
                    INSERT INTO event_tags (user_id, slug, label, color, reminder_rule, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (user_id, slug, label, color, rule, now),
                )

            conn.execute(
                "INSERT INTO hydration_settings (user_id) VALUES (%s)",
                (user_id,),
            )

    return user_id


def update_display_name(user_id: int, display_name: str) -> str:
    """Troca o nome de exibição. Devolve o nome como ficou gravado.

    Devolve em vez de só gravar porque o corte de [MAX_NAME_LENGTH] acontece
    aqui: quem chamou precisa responder ao cliente o nome REAL, e não o que foi
    pedido, senão a tela mostra um nome que o banco não tem.
    """
    nome = (display_name or "").strip()[:MAX_NAME_LENGTH]
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET display_name = %s WHERE id = %s",
            (nome, user_id),
        )
    return nome


def update_email(user_id: int, email: str) -> bool:
    """Troca o e-mail de acesso. `False` se já houver conta com ele.

    O `ON CONFLICT` não serve em UPDATE, então a colisão vem da própria restrição
    UNIQUE da tabela -- e é ela que se confia, não um SELECT antes: entre o
    SELECT e o UPDATE cabe outra requisição gravando o mesmo e-mail, e aí a
    resposta seria "pronto" para uma troca que não aconteceu.
    """
    with get_connection() as conn:
        try:
            conn.execute(
                "UPDATE users SET email = %s WHERE id = %s",
                (normalize_email(email), user_id),
            )
        except UniqueViolation:
            return False
    return True


def update_password(user_id: int, password: str) -> None:
    """Troca a senha.

    Os tokens já emitidos continuam valendo: eles são assinados com a
    SECRET_KEY e carregam só o id da conta, sem nada da senha (ver
    `api_auth.py`). Trocar a senha aqui não desconecta um aparelho perdido --
    para isso o botão é trocar a SECRET_KEY, que derruba todo mundo.
    """
    with get_connection() as conn:
        conn.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s",
            (generate_password_hash(password), user_id),
        )


# Hash descartável, calculado uma vez na subida. Existe só para dar o que
# comparar quando o e-mail não tem conta -- ver `password_matches`.
_HASH_FALSO = generate_password_hash("nao-e-a-senha-de-ninguem")


def password_matches(user_row, password: str) -> bool:
    """Confere a senha gastando o mesmo tempo com e-mail que existe e com o que não existe.

    A resposta da API já é a mesma nos dois casos, de propósito: dizer qual dos
    dois falhou entrega quais e-mails têm conta aqui. Mas o RELÓGIO entregava do
    mesmo jeito. A versão curta era `bool(user_row) and check_password_hash(...)`
    -- e o `and` faz curto-circuito: e-mail sem conta voltava na hora, e-mail com
    conta pagava os ~200 ms do scrypt. Quem cronometrasse as respostas separava
    as duas listas sem precisar acertar uma senha sequer.

    Comparar contra um hash descartável no caminho de "não existe" custa
    exatamente o mesmo scrypt e fecha o vazamento.
    """
    if not user_row:
        check_password_hash(_HASH_FALSO, password or "")
        return False

    return check_password_hash(user_row["password_hash"], password or "")


def list_user_ids():
    """Contas existentes, para o agendador varrer uma a uma."""
    with get_connection() as conn:
        rows = conn.execute("SELECT id FROM users ORDER BY id ASC").fetchall()
    return [row["id"] for row in rows]
