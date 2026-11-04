"""Copy a consistent SQLite snapshot to an empty PostgreSQL database."""
import hashlib
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

from .app import store

TABLES = ("departments", "users", "sessions", "datasets", "tasks", "jobs",
          "task_datasets", "hidden_history", "audit")


def digest(rows):
    result = hashlib.sha256()
    encoded = []
    for row in rows:
        values = tuple(bytes(value) if isinstance(value, memoryview) else value for value in row)
        encoded.append(repr(values).encode("utf-8"))
    for value in sorted(encoded):
        result.update(value)
        result.update(b"\n")
    return result.digest()


def migrate():
    load_dotenv(Path(__file__).resolve().parents[1] / ".env.local")
    if not os.environ.get("DATABASE_URL", "").startswith(("postgresql://", "postgres://")):
        raise RuntimeError("DATABASE_URL is missing or invalid.")
    backup = store.DATA / f"before-neon-{datetime.now():%Y%m%d-%H%M%S}.sqlite3"
    with sqlite3.connect(f"{store.DB.as_uri()}?mode=ro", uri=True) as source:
        with sqlite3.connect(backup) as snapshot:
            source.backup(snapshot)
    print(f"SQLite backup saved: {backup.name}", flush=True)
    store.init_db(seed=False, reset_running=False)
    with sqlite3.connect(backup) as source, store.connection() as target:
        target.execute("SELECT pg_advisory_xact_lock(74212026)")
        target.execute("LOCK TABLE " + ", ".join(TABLES) + " IN ACCESS EXCLUSIVE MODE")
        if any(target.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone() for table in TABLES):
            raise RuntimeError("Destination contains data. Migration stopped without overwriting it.")
        for table in TABLES:
            columns = [row[1] for row in source.execute(f"PRAGMA table_info({table})")]
            available = store.table_columns(target, table)
            if set(columns) - available:
                raise RuntimeError(f"Unsupported source columns in {table}.")
            fields = ", ".join(f'"{column}"' for column in columns)
            rows = source.execute(f"SELECT {fields} FROM {table}").fetchall()
            placeholders = ", ".join("?" for _ in columns)
            for offset in range(0, len(rows), 100):
                target.executemany(f"INSERT INTO {table} ({fields}) VALUES ({placeholders})", rows[offset:offset + 100])
            copied = target.execute(f"SELECT {fields} FROM {table}").fetchall()
            # PostgreSQL rows support named access; use positional values for verification.
            values = [tuple(row.values()) for row in copied]
            if len(rows) != len(values) or digest(rows) != digest(values):
                raise RuntimeError(f"Verification failed for {table}; transaction will roll back.")
            print(f"Verified {table}: {len(rows)} records", flush=True)
        for table in ("departments", "users", "audit"):
            target.execute(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE(MAX(id), 1), COUNT(*) > 0) FROM {table}")
    print("Migration committed. Local SQLite was preserved.", flush=True)


if __name__ == "__main__":
    try:
        migrate()
    except Exception as error:
        # Driver connection errors can contain credentials. Report only the error type.
        print(f"Migration failed ({type(error).__name__}). No existing destination records were overwritten.", flush=True)
        raise SystemExit(1)
