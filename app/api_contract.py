"""O contrato entre o site e o app Android.

Este arquivo existe para responder "as duas pontas continuam falando a mesma
língua?" sem ninguém precisar lembrar de conferir.

Não dá para manter duas interfaces sincronizadas — o que dá é as duas
consumirem a MESMA API e ter um teste que quebra quando ela muda. É este
arquivo que o teste lê. Mexeu numa rota da API? Mexa aqui também, no mesmo
commit, e o app Android descobre pelo diff em vez de descobrir em produção.

O contrato é deliberadamente raso: caminho, método, se exige credencial e quais
chaves a resposta precisa ter. Não é OpenAPI e não valida tipo aninhado — é uma
rede contra o erro que de fato acontece, que é alguém renomear um campo ou
esquecer de expor uma rota nova.
"""

# (caminho, método, exige credencial, chaves obrigatórias na resposta de sucesso)
ENDPOINTS = (
    # --- entrada -----------------------------------------------------------
    ("/api/auth/login", "POST", False, ("ok", "token", "expiresIn", "user")),
    ("/api/auth/signup", "POST", False, ("ok", "token", "expiresIn", "user")),
    ("/api/me", "GET", True, ("ok", "user")),
    # A espinha dorsal do app offline: o que mudou e o que sumiu.
    ("/api/sync", "GET", True, ("ok", "now", "changed", "deleted")),

    # --- post-its ----------------------------------------------------------
    ("/api/notes", "GET", True, ("ok", "notes")),
    ("/api/notes", "POST", True, ("ok", "note")),
    ("/api/notes/<int:note_id>", "PATCH", True, ("ok", "note")),
    ("/api/notes/<int:note_id>", "DELETE", True, ("ok",)),

    # --- planner -----------------------------------------------------------
    ("/api/planner/blocks", "GET", True, ("ok", "blocks")),
    ("/api/planner/blocks", "POST", True, ("ok", "block")),
    ("/api/planner/blocks/<int:block_id>", "PUT", True, ("ok", "block")),
    ("/api/planner/blocks/<int:block_id>", "DELETE", True, ("ok",)),

    # --- to-do -------------------------------------------------------------
    ("/api/todo", "GET", True, ("ok", "header", "days", "done", "total", "maxContent")),
    ("/api/todo", "POST", True, ("ok", "item")),
    ("/api/todo/<int:item_id>", "PATCH", True, ("ok", "item")),
    ("/api/todo/<int:item_id>", "DELETE", True, ("ok",)),

    # --- água --------------------------------------------------------------
    ("/api/hydration", "GET", True, ("ok", "glasses", "goal", "glassMl", "enabled",
                                     "intervalMinutes", "nextIn", "limits")),
    ("/api/hydration/drink", "POST", True, ("ok", "glasses", "goal", "glassMl", "nextIn")),

    # --- eventos e tags ----------------------------------------------------
    ("/api/events", "GET", True, ()),
    ("/api/tags", "GET", True, ("ok", "tags", "usage", "reminderRules",
                                "fallbackTag", "maxLabelLength")),

    # --- notificações ------------------------------------------------------
    ("/api/push/public-key", "GET", True, ()),
    ("/api/push/subscribe", "POST", True, ("ok",)),
    ("/api/push/unsubscribe", "POST", True, ("ok",)),
)


# Rotas de API que existem no servidor mas ficam FORA do contrato, cada uma com
# o motivo. Sem esta lista, "toda rota /api/ está no contrato?" não teria como
# ser uma verificação automática — e é justamente ela que pega a rota nova que
# alguém esqueceu de publicar para o app.
FORA_DO_CONTRATO = {
    "/api/push/test": "botão de diagnóstico do site; o app nativo usa o canal do Android",
    "/api/live/notifications": "polling do navegador, substituto do Web Push; o app usa FCM",
}
