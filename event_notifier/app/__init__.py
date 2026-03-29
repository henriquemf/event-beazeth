from datetime import datetime
import json

from apscheduler.schedulers.background import BackgroundScheduler
from flask import Flask, flash, jsonify, redirect, render_template, request, url_for

from app.config import Config
from app.db import (
    delete_event,
    get_hydration_settings,
    init_db,
    insert_event,
    list_push_subscriptions,
    list_events,
    delete_push_subscription,
    update_event,
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

    @app.after_request
    def add_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
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
