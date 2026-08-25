"""Camada de dados.

Cada modulo cuida de uma tabela. Este __init__ reexporta a API publica para
que `from app.db import <funcao>` continue funcionando como antes da divisao.
"""

from app.db.connection import (
    get_connection,
    utc_now_iso,
)
from app.db.schema import (
    init_db,
)
from app.db.events import (
    insert_event,
    delete_event,
    update_event,
    list_events,
    list_due_event_candidates,
)
from app.db.tags import (
    DEFAULT_TAGS,
    FALLBACK_TAG,
    MAX_LABEL_LENGTH,
    REMINDER_RULES,
    SUGGESTED_COLORS,
    count_events_by_tag,
    delete_tag,
    insert_tag,
    list_tags,
    normalize_color,
    slugify,
)
from app.db.reminders import (
    has_successful_dispatch,
    save_dispatch,
)
from app.db.hydration import (
    get_hydration_settings,
    upsert_hydration_settings,
    update_hydration_last_sent,
)
from app.db.push import (
    upsert_push_subscription,
    list_push_subscriptions,
    delete_push_subscription,
)
from app.db.planner import (
    PLANNER_COLORS,
    ROUTINE_DAY,
    list_planner_blocks,
    insert_planner_block,
    update_planner_block,
    delete_planner_block,
)
from app.db.notes import (
    NOTE_COLORS,
    NOTE_BUCKETS,
    NOTE_BOUNDS,
    list_sticky_notes,
    insert_sticky_note,
    update_sticky_note,
    delete_sticky_note,
)

__all__ = [
    "get_connection",
    "utc_now_iso",
    "init_db",
    "delete_event",
    "insert_event",
    "list_due_event_candidates",
    "list_events",
    "update_event",
    "DEFAULT_TAGS",
    "FALLBACK_TAG",
    "MAX_LABEL_LENGTH",
    "REMINDER_RULES",
    "SUGGESTED_COLORS",
    "count_events_by_tag",
    "delete_tag",
    "insert_tag",
    "list_tags",
    "normalize_color",
    "slugify",
    "has_successful_dispatch",
    "save_dispatch",
    "get_hydration_settings",
    "update_hydration_last_sent",
    "upsert_hydration_settings",
    "delete_push_subscription",
    "list_push_subscriptions",
    "upsert_push_subscription",
    "PLANNER_COLORS",
    "ROUTINE_DAY",
    "delete_planner_block",
    "insert_planner_block",
    "list_planner_blocks",
    "update_planner_block",
    "NOTE_BOUNDS",
    "NOTE_BUCKETS",
    "NOTE_COLORS",
    "delete_sticky_note",
    "insert_sticky_note",
    "list_sticky_notes",
    "update_sticky_note",
]
