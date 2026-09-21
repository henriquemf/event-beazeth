"""Diário: um ano inteiro em quadradinhos, um por dia.

A navegação entre anos é navegação de verdade (`/diary?ano=2025`), como a das
semanas do to-do: cada ano ganha URL própria, o botão voltar funciona e a tela
chega pintada do servidor. O JS só cuida do que muda sem sair da página —
escolher o humor e escrever.

A grade é montada aqui, e não no Jinja. São 372 células com regra de calendário
dentro (fevereiro tem 28 ou 29, e todo mês menor que 31 tem buracos no fim); um
`{% if %}` no template para cada uma delas seria a mesma conta, escrita no pior
lugar para depurá-la.
"""

from calendar import monthrange
from datetime import date

from flask import Blueprint, jsonify, render_template, request

from app.auth import current_user
from app.db import MAX_NOTE, MOODS, gravar_dia, humor_valido, listar_dias


bp = Blueprint("diary", __name__)

# O ano mais antigo que a navegação alcança. Não é limite de banco: é o que
# impede que segurar "ano anterior" leve a pessoa até 1900 num app que nasceu
# em 2026.
PRIMEIRO_ANO = 2020

LINHAS = 31

MESES_CURTOS = (
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
)

DIA_INVALIDO = "Dia inválido."


def ano_pedido(bruto) -> int:
    """O ano da query, preso entre o primeiro e o que vem depois do atual.

    Aceitar qualquer número deixaria `?ano=999999` renderizar uma grade vazia
    com um título absurdo; recusar com erro seria grosseiro para um parâmetro
    que a própria tela escreve. Fica no intervalo, calado.
    """
    hoje = date.today()
    try:
        ano = int(str(bruto).strip())
    except (TypeError, ValueError):
        return hoje.year
    return max(PRIMEIRO_ANO, min(ano, hoje.year + 1))


def montar_grade(ano: int, registros: dict, hoje: date) -> list[dict]:
    """Os doze meses, cada um com 31 posições — as que não existem ficam vazias.

    As 31 posições são fixas de propósito: a grade é lida em coluna (o mês) e em
    linha (o dia), então o dia 5 precisa ficar na mesma altura em todos os meses.
    Encurtar fevereiro desalinharia a leitura horizontal inteira.
    """
    meses = []
    for numero in range(1, 13):
        ultimo = monthrange(ano, numero)[1]
        dias = []
        for linha in range(1, LINHAS + 1):
            if linha > ultimo:
                dias.append(None)
                continue
            momento = date(ano, numero, linha)
            iso = momento.isoformat()
            registro = registros.get(iso)
            dias.append(
                {
                    "iso": iso,
                    "mood": registro["mood"] if registro else "",
                    # O texto viaja na própria célula (`data-note`), e não num
                    # bloco à parte: o editor abre preenchido sem uma segunda
                    # ida ao servidor, e não existe uma segunda lista para sair
                    # de sincronia com a primeira.
                    "note": registro["note"] if registro else "",
                    "tem_nota": bool(registro and registro["note"]),
                    "hoje": momento == hoje,
                    "futuro": momento > hoje,
                    "rotulo": f"{linha:02d}/{numero:02d}/{ano}",
                }
            )
        meses.append({"nome": MESES_CURTOS[numero - 1], "dias": dias})
    return meses


@bp.get("/diary")
def index():
    ano = ano_pedido(request.args.get("ano"))
    hoje = date.today()

    registros = {
        r["day"]: r
        for r in listar_dias(
            current_user()["id"], f"{ano}-01-01", f"{ano}-12-31"
        )
    }

    return render_template(
        "pages/diary.html",
        active_page="diary",
        ano=ano,
        ano_anterior=ano - 1 if ano > PRIMEIRO_ANO else None,
        ano_seguinte=ano + 1 if ano <= hoje.year else None,
        meses=montar_grade(ano, registros, hoje),
        linhas=range(1, LINHAS + 1),
        moods=[{"slug": s, "rotulo": r} for s, r in MOODS],
        escritos=len(registros),
        # Espelha o limite validado em app/db/diary.py.
        max_note=MAX_NOTE,
    )


@bp.put("/api/diary/<day>")
def salvar(day):
    """Grava (ou limpa) um dia.

    `PUT` e não `PATCH` porque os dois campos são editados no mesmo lugar e
    salvos juntos: não existe, nesta tela, quem escreva só o humor sem ter o
    texto em mãos. Limpar os dois apaga a linha, e a resposta traz `entry: null`
    para o cliente apagar a cor sem uma segunda chamada.
    """
    try:
        date.fromisoformat(str(day))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "message": DIA_INVALIDO}), 400

    payload = request.get_json(silent=True) or {}
    entrada = gravar_dia(
        current_user()["id"],
        day,
        humor_valido(payload.get("mood")),
        payload.get("note") or "",
    )
    return jsonify({"ok": True, "entry": entrada})
