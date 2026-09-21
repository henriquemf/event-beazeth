"""Diário: o humor e as anotações de cada dia.

Uma linha por conta e por DIA, com chave primária composta — o mesmo desenho de
`hydration_intake`, e pelo mesmo motivo: quem escolhe o identificador é a
pessoa, não o banco. Abrir o ano é uma varredura de faixa sobre a chave, e
gravar duas vezes no mesmo dia é um `ON CONFLICT`, não uma linha repetida.

`day` é TEXT em ISO-8601 (`2026-09-21`) como em todo o resto do projeto: é o que
o formulário manda, e a ordem alfabética é a cronológica.

**Linha vazia não existe.** Apagar o humor e o texto apaga a linha, em vez de
guardar uma com dois campos em branco. Quem lê a grade pergunta "tem linha neste
dia?", e não "tem linha e ela diz alguma coisa?" — e a lápide do gatilho avisa o
celular, que senão continuaria mostrando a cor de um dia que foi limpo no site.
"""

from app.db.connection import get_connection


# Os humores, na ordem em que a tela mostra.
#
# **A cor não está aqui de propósito.** O servidor decide quais humores existem;
# quem sabe pintá-los é cada cliente, porque a tinta é desenho e não dado — no
# site ela sai de `pages/diary.css`, no Android de `Humor.kt`. Guardar um nome
# de cor nesta tabela criaria um terceiro dono da mesma decisão, e é assim que
# a paleta de um lado envelhece sem ninguém notar.
MOODS = (
    ("feliz", "Feliz"),
    ("animada", "Animada"),
    ("calma", "Calma"),
    ("cansada", "Cansada"),
    ("triste", "Triste"),
    ("brava", "Brava"),
)

MOOD_SLUGS = tuple(slug for slug, _ in MOODS)

# Teto do texto de um dia. Não é limite de banco: é o que impede um cliente com
# defeito de despejar um arquivo inteiro numa linha. Espelhado no atributo
# `maxlength` do textarea em `templates/pages/diary.html`.
MAX_NOTE = 2000

_COLUNAS_DO_DIA = "day, mood, note"


def _linha_para_dia(row) -> dict:
    return {
        "day": row["day"],
        "mood": row["mood"] or "",
        "note": row["note"] or "",
    }


def humor_valido(valor) -> str:
    """O humor, se for um dos conhecidos; senão, vazio.

    Vazio é um estado legítimo — uma anotação sem humor escolhido — então um
    slug inventado vira "sem humor" em vez de erro. O que não pode é entrar na
    tabela um valor que a tela não sabe pintar.
    """
    texto = str(valor or "").strip()
    return texto if texto in MOOD_SLUGS else ""


def listar_dias(user_id: int, inicio: str, fim: str) -> list[dict]:
    """Os dias com registro num intervalo fechado, do mais antigo ao mais novo."""
    with get_connection() as conn:
        linhas = conn.execute(
            "SELECT " + _COLUNAS_DO_DIA + " FROM diary_entries"
            " WHERE user_id = %s AND day BETWEEN %s AND %s ORDER BY day",
            (user_id, inicio, fim),
        ).fetchall()
    return [_linha_para_dia(linha) for linha in linhas]


def gravar_dia(user_id: int, day: str, mood: str, note: str) -> dict | None:
    """Grava o dia, ou APAGA a linha se não sobrou nada nela.

    Devolve o dia gravado, ou `None` quando apagou — que é o que o cliente usa
    para tirar a cor do quadradinho sem precisar de uma segunda chamada.
    """
    humor = humor_valido(mood)
    texto = str(note or "").strip()[:MAX_NOTE]

    if not humor and not texto:
        apagar_dia(user_id, day)
        return None

    with get_connection() as conn:
        linha = conn.execute(
            "INSERT INTO diary_entries (user_id, day, mood, note)"
            " VALUES (%s, %s, %s, %s)"
            " ON CONFLICT (user_id, day) DO UPDATE SET mood = EXCLUDED.mood,"
            " note = EXCLUDED.note"
            " RETURNING " + _COLUNAS_DO_DIA,
            (user_id, day, humor, texto),
        ).fetchone()
    return _linha_para_dia(linha)


def apagar_dia(user_id: int, day: str) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            "DELETE FROM diary_entries WHERE user_id = %s AND day = %s",
            (user_id, day),
        )
    return cursor.rowcount > 0
