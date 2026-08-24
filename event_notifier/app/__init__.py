from datetime import datetime
from pathlib import Path
import json

from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask, flash, jsonify, redirect, render_template, request, url_for

from app.config import Config
from app.db import (
    delete_event,
    delete_planner_block,
    delete_sticky_note,
    get_hydration_settings,
    init_db,
    insert_event,
    insert_planner_block,
    insert_sticky_note,
    list_planner_blocks,
    list_sticky_notes,
    list_push_subscriptions,
    list_events,
    delete_push_subscription,
    update_event,
    update_planner_block,
    update_sticky_note,
    upsert_push_subscription,
    upsert_hydration_settings,
)
from app.services.scheduler_service import (
    collect_due_live_event_notifications,
    process_due_reminders,
    process_hydration_reminder,
)
from app.services.notifier import send_desktop_notification, send_web_push


scheduler = BackgroundScheduler()


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    init_db(app.config["DB_PATH"])

    static_dir = Path(app.static_folder)
    asset_versions = {}

    def static_url(filename):
        """URL de estático com hash de mtime, para cache longo sem servir arquivo velho."""
        if filename not in asset_versions or app.config["DEBUG"]:
            try:
                asset_versions[filename] = int((static_dir / filename).stat().st_mtime)
            except OSError:
                asset_versions[filename] = 0
        return url_for("static", filename=filename, v=asset_versions[filename])

    app.jinja_env.globals["static_url"] = static_url
    app.jinja_env.trim_blocks = True
    app.jinja_env.lstrip_blocks = True

    @app.after_request
    def add_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # Estáticos são versionados por ?v=<mtime>, então podem ficar em cache longo.
        if request.path.startswith("/static/") and request.args.get("v"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

    @app.get("/healthz")
    def healthz():
        return {"ok": True}

    @app.get("/sw.js")
    def service_worker():
        response = app.send_static_file("sw.js")
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return response

    @app.get("/favicon.ico")
    def favicon():
        return app.send_static_file("icon.svg")

    @app.route("/", methods=["GET", "POST"])
    def home():
        if request.method == "POST":
            title = request.form.get("title", "").strip()
            description = request.form.get("description", "").strip()
            event_datetime = request.form.get("event_datetime", "").strip()
            tag_type = request.form.get("tag_type", "evento").strip().lower()

            if not title:
                flash("Informe o título do evento.", "error")
                return redirect(url_for("home"))

            if not event_datetime:
                flash("Informe a data do evento (horário é opcional).", "error")
                return redirect(url_for("home"))

            try:
                if "T" in event_datetime:
                    dt = datetime.fromisoformat(event_datetime)
                else:
                    dt = datetime.fromisoformat(f"{event_datetime}T09:00")
            except ValueError:
                flash("Data/hora inválida.", "error")
                return redirect(url_for("home"))

            if dt < datetime.now():
                flash("A data/hora precisa estar no futuro.", "error")
                return redirect(url_for("home"))

            insert_event(
                app.config["DB_PATH"],
                title,
                description,
                event_datetime,
                tag_type,
            )
            flash("Evento cadastrado com sucesso.", "success")
            return redirect(url_for("home"))

        events = list_events(app.config["DB_PATH"])
        return render_template("index.html", events=events, active_page="home")

    @app.get("/calendar")
    def calendar_view():
        return render_template("calendar.html", active_page="calendar")

    @app.get("/appearance")
    def appearance_view():
        return render_template("appearance.html", active_page="appearance")

    @app.get("/planner")
    def planner_view():
        return render_template("planner.html", active_page="planner")

    def _parse_planner_payload(payload):
        """Valida e normaliza o corpo de um bloco do planner.

        Retorna (dados, None) em sucesso ou (None, mensagem de erro).
        """
        title = (payload.get("title") or "").strip()
        if not title:
            return None, "Informe o título do bloco."
        if len(title) > 120:
            title = title[:120]

        notes = (payload.get("notes") or "").strip()[:500]

        try:
            start_minute = int(payload.get("startMinute"))
            end_minute = int(payload.get("endMinute"))
        except (TypeError, ValueError):
            return None, "Horário inválido."

        is_routine = bool(payload.get("isRoutine"))

        try:
            day_of_week = int(payload.get("dayOfWeek", 0))
        except (TypeError, ValueError):
            day_of_week = 0

        if not is_routine and not 0 <= day_of_week <= 6:
            return None, "Dia da semana inválido."

        # Grade de 15 minutos, mínimo de um slot, limite no fim do dia.
        start_minute = max(0, min(start_minute, 1425))
        end_minute = max(start_minute + 15, min(end_minute, 1440))

        return (
            {
                "title": title,
                "notes": notes,
                "day_of_week": day_of_week,
                "start_minute": start_minute,
                "end_minute": end_minute,
                "color": payload.get("color") or "rose",
                "is_routine": is_routine,
            },
            None,
        )

    @app.get("/api/planner/blocks")
    def planner_blocks_list():
        return jsonify({"ok": True, "blocks": list_planner_blocks(app.config["DB_PATH"])})

    @app.post("/api/planner/blocks")
    def planner_blocks_create():
        data, error = _parse_planner_payload(request.get_json(silent=True) or {})
        if error:
            return jsonify({"ok": False, "message": error}), 400

        block = insert_planner_block(app.config["DB_PATH"], **data)
        return jsonify({"ok": True, "block": block}), 201

    @app.put("/api/planner/blocks/<int:block_id>")
    def planner_blocks_update(block_id: int):
        data, error = _parse_planner_payload(request.get_json(silent=True) or {})
        if error:
            return jsonify({"ok": False, "message": error}), 400

        block = update_planner_block(app.config["DB_PATH"], block_id, **data)
        if block is None:
            return jsonify({"ok": False, "message": "Bloco não encontrado."}), 404
        return jsonify({"ok": True, "block": block})

    @app.delete("/api/planner/blocks/<int:block_id>")
    def planner_blocks_delete(block_id: int):
        if not delete_planner_block(app.config["DB_PATH"], block_id):
            return jsonify({"ok": False, "message": "Bloco não encontrado."}), 404
        return jsonify({"ok": True})

    # ---------------------------------------------------------- post-its

    # Campos que o cliente pode enviar; qualquer outra chave e ignorada.
    NOTE_INPUT_KEYS = ("content", "bucket", "color", "x", "y", "width", "height", "z", "pinned")

    def _note_input(payload):
        return {key: payload[key] for key in NOTE_INPUT_KEYS if key in payload}

    @app.get("/api/notes")
    def notes_list():
        return jsonify({"ok": True, "notes": list_sticky_notes(app.config["DB_PATH"])})

    @app.post("/api/notes")
    def notes_create():
        payload = request.get_json(silent=True) or {}
        note = insert_sticky_note(app.config["DB_PATH"], _note_input(payload))
        return jsonify({"ok": True, "note": note}), 201

    @app.patch("/api/notes/<int:note_id>")
    def notes_update(note_id: int):
        payload = request.get_json(silent=True) or {}
        note = update_sticky_note(app.config["DB_PATH"], note_id, _note_input(payload))
        if note is None:
            return jsonify({"ok": False, "message": "Post-it nao encontrado."}), 404
        return jsonify({"ok": True, "note": note})

    @app.delete("/api/notes/<int:note_id>")
    def notes_delete(note_id: int):
        if not delete_sticky_note(app.config["DB_PATH"], note_id):
            return jsonify({"ok": False, "message": "Post-it nao encontrado."}), 404
        return jsonify({"ok": True})

    @app.get("/api/events")
    def events_api():
        rows = list_events(app.config["DB_PATH"])
        payload = []
        for event in rows:
            is_course = event["tag_type"] == "curso"
            payload.append(
                {
                    "id": event["id"],
                    "title": event["title"],
                    "start": event["event_datetime"],
                    "allDay": False,
                    "extendedProps": {
                        "description": event["description"] or "-",
                        "tagType": event["tag_type"],
                    },
                    "backgroundColor": "#f38ab7" if is_course else "#7ec8ff",
                    "borderColor": "#e25a95" if is_course else "#4fa5e4",
                    "textColor": "#2b1033",
                }
            )
        return jsonify(payload)

    @app.get("/api/push/public-key")
    def push_public_key():
        return jsonify({"publicKey": app.config.get("VAPID_PUBLIC_KEY", "")})

    @app.post("/api/push/subscribe")
    def push_subscribe():
        payload = request.get_json(silent=True) or {}
        endpoint = (payload.get("endpoint") or "").strip()
        keys = payload.get("keys") or {}
        p256dh = (keys.get("p256dh") or "").strip()
        auth = (keys.get("auth") or "").strip()

        if not endpoint or not p256dh or not auth:
            return jsonify({"ok": False, "message": "Inscrição inválida"}), 400

        upsert_push_subscription(
            app.config["DB_PATH"],
            endpoint,
            p256dh,
            auth,
            request.headers.get("User-Agent", ""),
        )
        return jsonify({"ok": True})

    @app.post("/api/push/unsubscribe")
    def push_unsubscribe():
        payload = request.get_json(silent=True) or {}
        endpoint = (payload.get("endpoint") or "").strip()
        if endpoint:
            delete_push_subscription(app.config["DB_PATH"], endpoint)
        return jsonify({"ok": True})

    @app.post("/api/push/test")
    def push_test():
        subscriptions = list_push_subscriptions(app.config["DB_PATH"])
        if not subscriptions:
            return jsonify({"ok": False, "message": "Nenhuma inscrição ativa"}), 400

        ok_count = 0
        for sub in subscriptions:
            info = {
                "endpoint": sub["endpoint"],
                "keys": {
                    "p256dh": sub["p256dh"],
                    "auth": sub["auth"],
                },
            }
            ok, _ = send_web_push(
                app.config,
                info,
                '{"title":"Teste Web Push 💗","body":"Tudo certo! Notificação web funcionando.","icon":"/static/icon.svg","tag":"push-test"}',
            )
            if ok:
                ok_count += 1

        return jsonify({"ok": ok_count > 0, "sent": ok_count})

    @app.get("/api/live/notifications")
    def live_notifications():
        items = collect_due_live_event_notifications(app)
        return jsonify({"ok": True, "items": items})

    @app.route("/hydration", methods=["GET", "POST"])
    def hydration_view():
        if request.method == "POST":
            enabled = bool(request.form.get("enabled"))
            action = request.form.get("action", "save")

            try:
                interval_minutes = int(request.form.get("interval_minutes", "60"))
                start_time = request.form.get("start_time", "08:00").strip()
                end_time = request.form.get("end_time", "22:00").strip()
                start_t = datetime.strptime(start_time, "%H:%M").time()
                end_t = datetime.strptime(end_time, "%H:%M").time()
            except ValueError:
                flash("Valores inválidos para lembrete de água.", "error")
                return redirect(url_for("hydration_view"))

            interval_minutes = min(max(interval_minutes, 1), 1440)

            if start_t == end_t:
                flash("Início e fim não podem ser iguais.", "error")
                return redirect(url_for("hydration_view"))

            upsert_hydration_settings(
                app.config["DB_PATH"],
                enabled,
                interval_minutes,
                start_time,
                end_time,
            )

            if action == "test":
                if not enabled:
                    flash("Ative o lembrete de água para testar a notificação.", "error")
                    return redirect(url_for("hydration_view"))

                sent_channels = 0

                if app.config.get("ENABLE_DESKTOP_NOTIFICATIONS", False):
                    ok, _ = send_desktop_notification(
                        "MOMO BEBA ÁGUA 💗",
                        "Meu amorzinho, hora de BEBER ÁGUA <3",
                        exact_title=True,
                    )
                    if ok:
                        sent_channels += 1

                subscriptions = list_push_subscriptions(app.config["DB_PATH"])
                if subscriptions:
                    payload = json.dumps(
                        {
                            "title": "MOMO BEBA ÁGUA 💗",
                            "body": "Meu amorzinho, hora de BEBER ÁGUA <3",
                            "icon": "/static/icon.svg",
                            "tag": "hydration-test",
                        }
                    )

                    for sub in subscriptions:
                        info = {
                            "endpoint": sub["endpoint"],
                            "keys": {
                                "p256dh": sub["p256dh"],
                                "auth": sub["auth"],
                            },
                        }
                        ok, _ = send_web_push(app.config, info, payload)
                        if ok:
                            sent_channels += 1

                if sent_channels > 0:
                    flash("Teste de notificação enviado com sucesso.", "success")
                else:
                    flash("Não foi possível enviar o teste. Ative notificações web na lateral e tente novamente.", "error")
            else:
                flash("Lembrete de água atualizado.", "success")
            return redirect(url_for("hydration_view"))

        settings = get_hydration_settings(app.config["DB_PATH"])
        return render_template("hydration.html", active_page="hydration", settings=settings)

    @app.post("/events/<int:event_id>/delete")
    def remove_event(event_id: int):
        delete_event(app.config["DB_PATH"], event_id)
        flash("Evento removido.", "success")
        return redirect(url_for("home"))

    @app.post("/events/<int:event_id>/update")
    def edit_event(event_id: int):
        title = request.form.get("title", "").strip()
        description = request.form.get("description", "").strip()
        event_datetime = request.form.get("event_datetime", "").strip()
        tag_type = request.form.get("tag_type", "evento").strip().lower()

        if not title:
            flash("Informe o título do evento.", "error")
            return redirect(url_for("calendar_view"))

        if not event_datetime:
            flash("Informe a data do evento.", "error")
            return redirect(url_for("calendar_view"))

        try:
            if "T" in event_datetime:
                dt = datetime.fromisoformat(event_datetime)
            else:
                dt = datetime.fromisoformat(f"{event_datetime}T09:00")
        except ValueError:
            flash("Data/hora inválida.", "error")
            return redirect(url_for("calendar_view"))

        if dt < datetime.now():
            flash("A data/hora precisa estar no futuro.", "error")
            return redirect(url_for("calendar_view"))

        updated = update_event(
            app.config["DB_PATH"],
            event_id,
            title,
            description,
            event_datetime,
            tag_type,
        )
        if updated:
            flash("Evento atualizado com sucesso.", "success")
        else:
            flash("Evento não encontrado.", "error")
        return redirect(url_for("calendar_view"))

    if not scheduler.running:
        scheduler.add_job(
            func=lambda: (process_due_reminders(app), process_hydration_reminder(app)),
            trigger="interval",
            seconds=60,
            id="event-reminders",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        scheduler.start()

    return app
