import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
DATA.mkdir(exist_ok=True)
DB = DATA / "studio.sqlite3"
ACCOUNTS_FILE = DATA / "initial-accounts.txt"


@contextmanager
def connection():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, filename TEXT, status TEXT, prompt TEXT, summary TEXT, result TEXT, error TEXT, created REAL, updated REAL, raw BLOB);
CREATE TABLE IF NOT EXISTS departments (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, created REAL);
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL, department_id INTEGER REFERENCES departments(id), active INTEGER NOT NULL DEFAULT 1, created REAL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS datasets (id TEXT PRIMARY KEY, filename TEXT, summary TEXT, raw BLOB, created_by INTEGER, created REAL);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT, objective TEXT, requirements TEXT, department_id INTEGER, assignee_id INTEGER, status TEXT, result TEXT, review_note TEXT, reviewed_by INTEGER, created_by INTEGER, created REAL, updated REAL, submitted REAL, reviewed REAL);
CREATE TABLE IF NOT EXISTS hidden_history (user_id INTEGER NOT NULL, job_id TEXT NOT NULL, PRIMARY KEY(user_id, job_id));
CREATE TABLE IF NOT EXISTS task_datasets (task_id TEXT, dataset_id TEXT, PRIMARY KEY (task_id, dataset_id));
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at REAL, user_id INTEGER, username TEXT, action TEXT, target TEXT, detail TEXT);
"""


def init_db(seed=True):
    from .access import hash_password
    with connection() as db:
        db.executescript(SCHEMA)
        user_columns = {row[1] for row in db.execute("PRAGMA table_info(users)")}
        for column in ("phone", "email"):
            if column not in user_columns:
                db.execute(f"ALTER TABLE users ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        columns = {row[1] for row in db.execute("PRAGMA table_info(jobs)")}
        for column, kind in (("history_removed", "INTEGER NOT NULL DEFAULT 0"), ("result_html", "TEXT"), ("user_id", "INTEGER"), ("task_id", "TEXT"), ("source", "TEXT"), ("edited_result", "TEXT"), ("edited_html", "TEXT"), ("edited", "REAL")):
            if column not in columns:
                db.execute(f"ALTER TABLE jobs ADD COLUMN {column} {kind}")
        if "selected_run_id" not in {row[1] for row in db.execute("PRAGMA table_info(tasks)")}:
            db.execute("ALTER TABLE tasks ADD COLUMN selected_run_id TEXT")
        db.execute("UPDATE jobs SET status='failed', error='Backend khởi động lại. Hãy tạo lượt phân tích mới.' WHERE status IN ('queued','running')")
        db.execute("UPDATE tasks SET status='ready_for_analysis' WHERE status='assigned'")  # Renamed to the T12 design's state.
        if not seed or db.execute("SELECT 1 FROM users").fetchone():
            return
        # First run: one account per role with random passwords, saved only to the local data folder.
        now = time.time()
        department = db.execute("INSERT INTO departments (name, created) VALUES (?, ?)", ("Phòng Kinh doanh", now)).lastrowid
        lines = []
        for username, full_name, role, dept in (("admin", "Quản trị hệ thống", "admin", None), ("truongphong", "Trưởng phòng Kinh doanh", "manager", department), ("nhanvien", "Nhân viên Kinh doanh", "employee", department)):
            password = secrets.token_urlsafe(9)
            db.execute("INSERT INTO users (username, full_name, password, role, department_id, created) VALUES (?, ?, ?, ?, ?, ?)", (username, full_name, hash_password(password), role, dept, now))
            lines.append(f"{role:<9} {username:<12} {password}")
    ACCOUNTS_FILE.write_text("Tài khoản khởi tạo (đổi mật khẩu trong mục Tài khoản sau khi đăng nhập Admin):\n" + "\n".join(lines) + "\n", encoding="utf-8")
    print(f"Da tao tai khoan khoi tao, xem {ACCOUNTS_FILE}")  # ASCII: Windows consoles may not encode Vietnamese.
