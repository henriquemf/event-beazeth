"""Conexao com o SQLite e utilitarios de data."""

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


@contextmanager
def get_connection(db_path: str):
    db_file = Path(db_path)
    db_file.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_file), timeout=10.0)
    conn.row_factory = sqlite3.Row
    # WAL permite leitura concorrente enquanto o scheduler escreve em background.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
