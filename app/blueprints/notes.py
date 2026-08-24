"""Post-its do quadro da home: CRUD com atualização parcial."""

from flask import Blueprint, current_app, jsonify, request

from app.db import (
    delete_sticky_note,
    insert_sticky_note,
    list_sticky_notes,
    update_sticky_note,
)


bp = Blueprint("notes", __name__)

# Campos que o cliente pode enviar; qualquer outra chave é ignorada.
INPUT_KEYS = ("content", "bucket", "color", "x", "y", "width", "height", "z", "pinned")

NOT_FOUND = "Post-it nao encontrado."


def read_input(payload):
    return {key: payload[key] for key in INPUT_KEYS if key in payload}


@bp.get("/api/notes")
def notes_list():
    return jsonify({"ok": True, "notes": list_sticky_notes(current_app.config["DB_PATH"])})


@bp.post("/api/notes")
def notes_create():
    payload = request.get_json(silent=True) or {}
    note = insert_sticky_note(current_app.config["DB_PATH"], read_input(payload))
    return jsonify({"ok": True, "note": note}), 201


@bp.patch("/api/notes/<int:note_id>")
def notes_update(note_id: int):
    payload = request.get_json(silent=True) or {}
    note = update_sticky_note(current_app.config["DB_PATH"], note_id, read_input(payload))
    if note is None:
        return jsonify({"ok": False, "message": NOT_FOUND}), 404
    return jsonify({"ok": True, "note": note})


@bp.delete("/api/notes/<int:note_id>")
def notes_delete(note_id: int):
    if not delete_sticky_note(current_app.config["DB_PATH"], note_id):
        return jsonify({"ok": False, "message": NOT_FOUND}), 404
    return jsonify({"ok": True})
