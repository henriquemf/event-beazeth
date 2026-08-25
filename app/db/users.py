"""Contas de acesso.

A senha nunca é gravada: o que fica é o hash do `werkzeug.security`, que já vem
com o Flask — nenhuma dependência nova para isso. O algoritmo (scrypt, por
padrão) e o sal ficam embutidos no próprio texto do hash, então trocar de
algoritmo depois não invalida os hashes antigos.
"""

from werkzeug.security import check_password_hash, generate_password_hash

from app.db.connection import get_connection, utc_now_iso
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
    with get_connection() as conn:
        return conn.execute(
            "SELECT id, email, display_name FROM users WHERE id = %s",
            (user_id,),
        ).fetchone()


def create_user(email: str, password: str, display_name: str):
    """Cria a conta com o espaço já montado. Devolve None se o e-mail existir.

    As tabelas do usuário nascem juntas e na MESMA transação: uma conta sem tag
    padrão deixaria o popup de agendamento sem nenhuma opção marcável, e uma
    sem linha de hidratação quebraria a tela de água na primeira visita.
    """
    now = utc_now_iso()
    with get_connection() as conn:
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


def password_matches(user_row, password: str) -> bool:
    return bool(user_row) and check_password_hash(user_row["password_hash"], password or "")


def list_user_ids():
    """Contas existentes, para o agendador varrer uma a uma."""
    with get_connection() as conn:
        rows = conn.execute("SELECT id FROM users ORDER BY id ASC").fetchall()
    return [row["id"] for row in rows]
