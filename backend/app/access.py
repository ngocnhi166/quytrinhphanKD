import hashlib
import hmac
import json
import secrets
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from .data import MAX_BYTES, parse_file
from .store import connection

ROLES = {"employee": "Nhân viên", "manager": "Trưởng phòng", "admin": "Admin"}
OPEN = ("ready_for_analysis", "in_progress", "needs_revision")  # The assignee may still run AI and change the result.
COOKIE = "t12_session"
SESSION_TTL = 12 * 3600
router = APIRouter(prefix="/api")


def hash_password(password):
    salt = secrets.token_bytes(16)
    return f"scrypt${salt.hex()}${hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1).hex()}"


def verify_password(password, stored):
    _, salt, digest = stored.split("$")
    return hmac.compare_digest(hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1).hex(), digest)


DUMMY_HASH = hash_password(secrets.token_urlsafe(16))  # Unknown usernames cost the same time as wrong passwords.


def session_key(token):
    return hashlib.sha256(token.encode()).hexdigest()


def audit(user, action, target="", detail="", username=None):
    with connection() as db:
        db.execute("INSERT INTO audit (at, user_id, username, action, target, detail) VALUES (?,?,?,?,?,?)",
                   (time.time(), user["id"] if user else None, user["username"] if user else username, action, target, str(detail)[:1000]))


def deny(user, request, reason, message="Bạn không có quyền thực hiện thao tác này."):
    audit(user, "denied", f"{request.method} {request.url.path}", reason)
    raise HTTPException(403, message)


USER_FIELDS = "u.id, u.username, u.full_name, u.role, u.department_id, d.name AS department, u.active, u.created"


def current_user(request: Request):
    token = request.cookies.get(COOKIE)
    if token:
        with connection() as db:
            row = db.execute(f"SELECT {USER_FIELDS} FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN departments d ON d.id = u.department_id WHERE s.token = ? AND s.expires > ? AND u.active = 1", (session_key(token), time.time())).fetchone()
        if row:
            return dict(row)
    raise HTTPException(401, "Vui lòng đăng nhập.")


def allow(*roles):
    def check(request: Request, user=Depends(current_user)):
        if user["role"] not in roles:
            deny(user, request, "cần vai trò " + "/".join(ROLES[role] for role in roles))
        return user
    return check


async def read_upload(file):
    raw = await file.read(MAX_BYTES + 1)
    name = Path((file.filename or "data.csv").replace('\\', '/')).name
    return name, raw, parse_file(name, raw)


class Login(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


@router.post("/auth/login")
def login(body: Login, response: Response):
    username = body.username.strip().lower()
    with connection() as db:
        failures = db.execute("SELECT COUNT(*) FROM audit WHERE action='login_failed' AND target=? AND at>?", (username, time.time() - 900)).fetchone()[0]
        row = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if failures >= 5:
        raise HTTPException(429, "Đăng nhập sai quá 5 lần. Thử lại sau 15 phút.")
    if not verify_password(body.password, row["password"] if row else DUMMY_HASH) or not row:
        audit(None, "login_failed", username, username=username)
        raise HTTPException(401, "Sai tên đăng nhập hoặc mật khẩu.")
    if not row["active"]:
        audit(dict(row), "denied", username, "đăng nhập bằng tài khoản đã khóa")
        raise HTTPException(403, "Tài khoản đã bị khóa. Liên hệ Admin.")
    token, now = secrets.token_urlsafe(32), time.time()
    with connection() as db:
        db.execute("DELETE FROM sessions WHERE expires < ?", (now,))
        db.execute("INSERT INTO sessions (token, user_id, expires) VALUES (?,?,?)", (session_key(token), row["id"], now + SESSION_TTL))
        user = dict(db.execute(f"SELECT {USER_FIELDS} FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id=?", (row["id"],)).fetchone())
    response.set_cookie(COOKIE, token, max_age=SESSION_TTL, httponly=True, samesite="strict", path="/")
    audit(user, "login")
    return user


@router.post("/auth/logout")
def logout(request: Request, response: Response, user=Depends(current_user)):
    with connection() as db:
        db.execute("DELETE FROM sessions WHERE token=?", (session_key(request.cookies.get(COOKIE, "")),))
    response.delete_cookie(COOKIE, path="/")
    audit(user, "logout")
    return {"ok": True}


@router.get("/me")
def me(user=Depends(current_user)):
    return user


# --- Accounts and departments: Admin only -------------------------------------------------

class NewUser(BaseModel):
    username: str = Field(pattern=r"^[a-z0-9._-]{3,32}$")
    full_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["employee", "manager", "admin"]
    department_id: int | None = None


class UserChange(BaseModel):
    full_name: str | None = Field(None, min_length=1, max_length=100)
    password: str | None = Field(None, min_length=8, max_length=128)
    role: Literal["employee", "manager", "admin"] | None = None
    department_id: int | None = None
    active: bool | None = None


def checked_department(db, role, department_id):
    if role == "admin":
        return None
    if not department_id or not db.execute("SELECT 1 FROM departments WHERE id=?", (department_id,)).fetchone():
        raise HTTPException(422, "Nhân viên và Trưởng phòng phải thuộc một phòng ban.")
    return department_id


@router.get("/users")
def users(admin=Depends(allow("admin"))):
    with connection() as db:
        return [dict(r) for r in db.execute(f"SELECT {USER_FIELDS} FROM users u LEFT JOIN departments d ON d.id = u.department_id ORDER BY u.role, u.username")]


@router.post("/users", status_code=201)
def create_user(body: NewUser, admin=Depends(allow("admin"))):
    with connection() as db:
        department = checked_department(db, body.role, body.department_id)
        try:
            db.execute("INSERT INTO users (username, full_name, password, role, department_id, created) VALUES (?,?,?,?,?,?)",
                       (body.username, body.full_name.strip(), hash_password(body.password), body.role, department, time.time()))
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Tên đăng nhập đã tồn tại.")
    audit(admin, "user_create", body.username, f"vai trò {ROLES[body.role]}")
    return {"ok": True}


@router.patch("/users/{user_id}")
def change_user(user_id: int, body: UserChange, request: Request, admin=Depends(allow("admin"))):
    changes = body.model_dump(exclude_unset=True)
    with connection() as db:
        row = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Không tìm thấy tài khoản.")
        role = changes.get("role") or row["role"]
        if user_id == admin["id"] and (role != row["role"] or changes.get("active") is False):
            # An admin cannot widen, drop or lock their own access; another admin must do it.
            deny(admin, request, "tự đổi vai trò hoặc tự khóa", "Không thể tự đổi vai trò hoặc tự khóa tài khoản của mình.")
        if role != "employee" and row["role"] == "employee" and db.execute(f"SELECT 1 FROM tasks WHERE assignee_id=? AND status IN ({','.join('?' * len(OPEN))},'submitted')", (user_id, *OPEN)).fetchone():
            raise HTTPException(409, "Người này còn tác vụ đang thực hiện. Giao lại tác vụ trước khi đổi vai trò.")
        fields = {"role": role, "department_id": checked_department(db, role, changes.get("department_id", row["department_id"]))}
        notes = []
        if role != row["role"]:
            notes.append(f"vai trò {ROLES[row['role']]} → {ROLES[role]}")
        if fields["department_id"] != row["department_id"]:
            notes.append("đổi phòng ban")
        if changes.get("full_name"):
            fields["full_name"] = changes["full_name"].strip()
        if changes.get("active") is not None and int(changes["active"]) != row["active"]:
            fields["active"] = int(changes["active"])
            notes.append("mở khóa" if changes["active"] else "khóa tài khoản")
        if changes.get("password"):
            fields["password"] = hash_password(changes["password"])
            notes.append("đặt lại mật khẩu")
        db.execute(f"UPDATE users SET {','.join(k + '=?' for k in fields)} WHERE id=?", (*fields.values(), user_id))
        if role != row["role"] or "password" in fields or fields.get("active") == 0:
            db.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))  # Changed access applies immediately.
    audit(admin, "user_update", row["username"], ", ".join(notes) or "cập nhật thông tin")
    return {"ok": True}


class NewDepartment(BaseModel):
    name: str = Field(min_length=1, max_length=100)


@router.get("/departments")
def departments(admin=Depends(allow("admin"))):
    with connection() as db:
        return [dict(r) for r in db.execute("SELECT d.id, d.name, COUNT(u.id) AS members FROM departments d LEFT JOIN users u ON u.department_id = d.id GROUP BY d.id ORDER BY d.name")]


@router.post("/departments", status_code=201)
def create_department(body: NewDepartment, admin=Depends(allow("admin"))):
    try:
        with connection() as db:
            db.execute("INSERT INTO departments (name, created) VALUES (?,?)", (body.name.strip(), time.time()))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Phòng ban đã tồn tại.")
    audit(admin, "department_create", body.name.strip())
    return {"ok": True}


# --- Sample data: managed by Admin, used by assigned employees ------------------------------

def dataset_view(row):
    summary = json.loads(row["summary"])
    return {"id": row["id"], "filename": row["filename"], "created": row["created"], "row_count": summary["row_count"], "columns": summary["columns"], "preview": summary["preview"]}


@router.get("/datasets")
def datasets(admin=Depends(allow("admin"))):
    with connection() as db:
        return [dataset_view(r) for r in db.execute("SELECT id, filename, summary, created FROM datasets ORDER BY created DESC")]


@router.post("/datasets", status_code=201)
async def create_dataset(file: UploadFile = File(...), admin=Depends(allow("admin"))):
    name, raw, summary = await read_upload(file)
    with connection() as db:
        db.execute("INSERT INTO datasets (id, filename, summary, raw, created_by, created) VALUES (?,?,?,?,?,?)", (str(uuid.uuid4()), name, json.dumps(summary, ensure_ascii=False), raw, admin["id"], time.time()))
    audit(admin, "dataset_create", name, f"{summary['row_count']} dòng")
    return {"ok": True}


@router.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: str, admin=Depends(allow("admin"))):
    with connection() as db:
        row = db.execute("SELECT filename FROM datasets WHERE id=?", (dataset_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Không tìm thấy dữ liệu mẫu.")
        db.execute("DELETE FROM task_datasets WHERE dataset_id=?", (dataset_id,))
        db.execute("DELETE FROM datasets WHERE id=?", (dataset_id,))
    audit(admin, "dataset_delete", row["filename"])
    return {"ok": True}


# --- Tasks: Admin assigns, the employee performs T12, G11 decisions are recorded by Admin ---

TASK_QUERY = "SELECT t.*, a.full_name AS assignee, d.name AS department, r.full_name AS reviewer FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN departments d ON d.id = t.department_id LEFT JOIN users r ON r.id = t.reviewed_by"


def task_scope(user):
    if user["role"] == "employee":
        return "t.assignee_id = ?", (user["id"],)
    if user["role"] == "manager":
        return "t.department_id = ?", (user["department_id"],)
    return "1 = 1", ()


def visible_task(db, user, task_id, request):
    row = db.execute(f"{TASK_QUERY} WHERE t.id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Không tìm thấy tác vụ.")
    scope, args = task_scope(user)
    if not db.execute(f"SELECT 1 FROM tasks t WHERE t.id = ? AND {scope}", (task_id, *args)).fetchone():
        deny(user, request, "tác vụ ngoài phạm vi được phân công", "Bạn không được phân công hoặc quản lý tác vụ này.")
    return row


def workable_task(db, user, task_id, request):
    row = visible_task(db, user, task_id, request)
    if row["status"] not in OPEN:
        raise HTTPException(409, "Tác vụ đã nộp hoặc đã duyệt; chỉ làm tiếp khi được yêu cầu chỉnh sửa.")
    return row


def task_dataset(db, task_id, dataset_id):
    row = db.execute("SELECT d.* FROM datasets d JOIN task_datasets td ON td.dataset_id = d.id WHERE td.task_id = ? AND d.id = ?", (task_id, dataset_id)).fetchone()
    if not row:
        raise HTTPException(403, "Dữ liệu này không thuộc tác vụ được giao.")
    return row["filename"], row["raw"], json.loads(row["summary"])


@router.get("/tasks")
def tasks(user=Depends(current_user)):
    scope, args = task_scope(user)
    with connection() as db:
        rows = db.execute(f"{TASK_QUERY} WHERE {scope} ORDER BY t.updated DESC", args).fetchall()
    return [{k: v for k, v in dict(r).items() if k != "result"} for r in rows]


@router.get("/tasks/{task_id}")
def task(task_id: str, request: Request, user=Depends(current_user)):
    with connection() as db:
        obj = dict(visible_task(db, user, task_id, request))
        obj["datasets"] = [dataset_view(r) for r in db.execute("SELECT d.id, d.filename, d.summary, d.created FROM datasets d JOIN task_datasets td ON td.dataset_id = d.id WHERE td.task_id = ?", (task_id,))]
        obj["result_html"] = None
        if obj["selected_run_id"]:
            # The task's output is the selected run as it stands now: the edited version when there is one.
            run = db.execute(RUN_OUTPUT, (obj["selected_run_id"],)).fetchone()
            if run:
                obj["result"], obj["result_html"] = run["text"], run["html"]
    return obj


RUN_OUTPUT = "SELECT COALESCE(edited_result, result) AS text, CASE WHEN edited_result IS NOT NULL THEN edited_html ELSE result_html END AS html FROM jobs WHERE id = ?"


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    objective: str = Field(min_length=1, max_length=4000)
    requirements: str = Field(min_length=1, max_length=8000)
    assignee_id: int
    dataset_ids: list[str] = Field(default_factory=list, max_length=20)


def save_task(db, task_id, body):
    assignee = db.execute("SELECT department_id FROM users WHERE id=? AND role='employee' AND active=1", (body.assignee_id,)).fetchone()
    if not assignee or not assignee["department_id"]:
        raise HTTPException(422, "Chỉ giao tác vụ cho nhân viên đang hoạt động và thuộc một phòng ban.")
    ids = list(dict.fromkeys(body.dataset_ids))
    if ids and db.execute(f"SELECT COUNT(*) FROM datasets WHERE id IN ({','.join('?' * len(ids))})", ids).fetchone()[0] != len(ids):
        raise HTTPException(422, "Có dữ liệu mẫu không tồn tại.")
    db.execute("UPDATE tasks SET title=?, objective=?, requirements=?, assignee_id=?, department_id=?, updated=? WHERE id=?",
               (body.title.strip(), body.objective.strip(), body.requirements.strip(), body.assignee_id, assignee["department_id"], time.time(), task_id))
    db.execute("DELETE FROM task_datasets WHERE task_id=?", (task_id,))
    db.executemany("INSERT INTO task_datasets (task_id, dataset_id) VALUES (?,?)", [(task_id, i) for i in ids])


@router.post("/tasks", status_code=201)
def create_task(body: TaskIn, admin=Depends(allow("admin"))):
    task_id, now = str(uuid.uuid4()), time.time()
    with connection() as db:
        db.execute("INSERT INTO tasks (id, status, created_by, created, updated) VALUES (?,?,?,?,?)", (task_id, "ready_for_analysis", admin["id"], now, now))
        save_task(db, task_id, body)
    audit(admin, "task_create", body.title.strip(), f"giao cho tài khoản #{body.assignee_id}")
    return {"id": task_id}


@router.put("/tasks/{task_id}")
def update_task(task_id: str, body: TaskIn, request: Request, admin=Depends(allow("admin"))):
    with connection() as db:
        row = visible_task(db, admin, task_id, request)
        if row["status"] in ("submitted", "approved"):
            raise HTTPException(409, "Tác vụ đã nộp hoặc đã duyệt; không sửa để giữ nguyên căn cứ giải trình.")
        save_task(db, task_id, body)
    audit(admin, "task_update", body.title.strip(), f"giao cho tài khoản #{body.assignee_id}")
    return {"ok": True}


class ResultIn(BaseModel):
    run_id: str


@router.put("/tasks/{task_id}/result")
def select_result(task_id: str, body: ResultIn, request: Request, user=Depends(allow("employee"))):
    # The T12 output is one successful run of this task (design 5.3/5.4), not a separate free-text copy.
    with connection() as db:
        row = workable_task(db, user, task_id, request)
        if not db.execute("SELECT 1 FROM jobs WHERE id=? AND task_id=? AND status='succeeded'", (body.run_id, task_id)).fetchone():
            raise HTTPException(422, "Chỉ chọn được lượt chạy đã hoàn tất của chính tác vụ này.")
        db.execute("UPDATE tasks SET selected_run_id=?, status=?, updated=? WHERE id=?", (body.run_id, "in_progress" if row["status"] == "ready_for_analysis" else row["status"], time.time(), task_id))
    audit(user, "result_select", row["title"], f"lượt chạy {body.run_id[:8]}")
    return {"ok": True}


@router.post("/tasks/{task_id}/submit")
def submit_task(task_id: str, request: Request, user=Depends(allow("employee"))):
    with connection() as db:
        row = workable_task(db, user, task_id, request)
        run = row["selected_run_id"] and db.execute(f"{RUN_OUTPUT} AND task_id = ? AND status = 'succeeded'", (row["selected_run_id"], task_id)).fetchone()
        if not run:
            raise HTTPException(422, "Chọn một lượt chạy thành công làm kết quả tác vụ trước khi Submit.")
        now = time.time()
        # Freeze the output handed to T13: the edited version when there is one, otherwise the AI result.
        db.execute("UPDATE tasks SET status='submitted', result=?, submitted=?, updated=? WHERE id=?", (run["text"], now, now, task_id))
    audit(user, "submit_t12", row["title"], f"lượt chạy {row['selected_run_id'][:8]}")
    return {"ok": True}


class Review(BaseModel):
    status: Literal["approved", "needs_revision"]
    note: str = Field("", max_length=4000)
    confirmed: bool


@router.post("/tasks/{task_id}/review")
def review_task(task_id: str, body: Review, request: Request, admin=Depends(allow("admin"))):
    if not body.confirmed:
        raise HTTPException(422, "Chỉ cập nhật khi Trưởng phòng đã có quyết định tại G11.")
    if body.status == "needs_revision" and not body.note.strip():
        raise HTTPException(422, "Ghi chú nội dung cần chỉnh sửa theo quyết định của Trưởng phòng.")
    with connection() as db:
        row = visible_task(db, admin, task_id, request)
        if row["status"] != "submitted":
            raise HTTPException(409, "Chỉ ghi nhận quyết định G11 cho tác vụ đã Submit.")
        now = time.time()
        db.execute("UPDATE tasks SET status=?, review_note=?, reviewed_by=?, reviewed=?, updated=? WHERE id=?", (body.status, body.note.strip(), admin["id"], now, now, task_id))
    audit(admin, "record_g11", row["title"], f"{body.status}: {body.note.strip()}")
    return {"ok": True}


@router.get("/audit")
def audit_log(admin=Depends(allow("admin"))):
    with connection() as db:
        return [dict(r) for r in db.execute("SELECT * FROM audit ORDER BY id DESC LIMIT 500")]
