"""Objetos de aplicação compartilhados.

Ficam isolados aqui para que blueprints e a fábrica possam importá-los sem
criar import circular com `app/__init__.py`.
"""

from apscheduler.schedulers.background import BackgroundScheduler


scheduler = BackgroundScheduler()
