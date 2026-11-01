import io
import json
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path

from fastapi.testclient import TestClient
from openpyxl import Workbook

from backend.app import access, main, pdf, store

PASSWORD = "password123"
HASH = access.hash_password(PASSWORD)
SALES = b"region,revenue\nNorth,100\nSouth,200\n"


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = store.DB
        store.DB = Path(self.temp.name) / "test.sqlite3"
        store.init_db(seed=False)
        with store.connection() as db:
            sales = db.execute("INSERT INTO departments (name, created) VALUES ('Kinh doanh', 0)").lastrowid
            finance = db.execute("INSERT INTO departments (name, created) VALUES ('Tài chính', 0)").lastrowid
            for username, role, department in (("admin", "admin", None), ("boss", "manager", sales), ("emp", "employee", sales), ("emp2", "employee", sales), ("fin", "manager", finance)):
                db.execute("INSERT INTO users (username, full_name, password, role, department_id, created) VALUES (?,?,?,?,?,0)", (username, username.title(), HASH, role, department))
        main.bridge = main.Bridge()
        self.client = TestClient(main.app)
        self.client.__enter__()
        self.admin, self.emp = self.login("admin"), self.login("emp")
        self.ids = {u["username"]: u["id"] for u in self.admin.get("/api/users").json()}

    def tearDown(self):
        self.client.__exit__(None, None, None)
        store.DB = self.old_db
        self.temp.cleanup()

    def login(self, username, password=PASSWORD):
        client = TestClient(main.app)
        response = client.post("/api/auth/login", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return client

    def make_task(self, assignee="emp", datasets=()):
        response = self.admin.post("/api/tasks", json={"title": "Doanh thu Q2", "objective": "Đánh giá doanh thu", "requirements": "So sánh theo khu vực", "assignee_id": self.ids[assignee], "dataset_ids": list(datasets)})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()["id"]

    def finished_run(self, task, text, user="emp"):
        run_id = str(uuid.uuid4())
        with store.connection() as db:
            db.execute("INSERT INTO jobs (id, filename, status, prompt, summary, result, created, updated, raw, user_id, task_id, source) VALUES (?,?,?,?,?,?,0,0,?,?,?,?)",
                       (run_id, "sales.csv", "succeeded", "Phân tích", json.dumps({"columns": [], "row_count": 0, "preview": [], "metrics": {}}), text, b"", self.ids[user], task, "upload"))
        return run_id

    def upload(self, client=None, raw=SALES, path="/api/preview", filename="sales.csv", **extra):
        return (client or self.emp).post(path, files={"file": (filename, raw)}, **extra)

    def actions(self):
        with store.connection() as db:
            return [r[0] for r in db.execute("SELECT action FROM audit ORDER BY id")]


class AnalysisTests(Base):
    def test_csv_and_metrics(self):
        response = self.upload()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["metrics"]["numeric"]["revenue"]["sum"], "300")
        self.assertEqual(response.json()["row_count"], 2)

    def test_xlsx(self):
        book = Workbook()
        book.active.append(["product", "quantity"])
        book.active.append(["A", 5])
        out = io.BytesIO()
        book.save(out)
        response = self.upload(raw=out.getvalue(), filename="sales.xlsx")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["metrics"]["numeric"]["quantity"]["sum"], "5")

    def test_invalid_files(self):
        for raw in [b"", b"a,b\n", b"a,a\n1,2", b"a,b\n1,2,3", b"a,b\n\xff,3"]:
            with self.subTest(raw=raw):
                self.assertEqual(self.upload(raw=raw).status_code, 422)
        self.assertEqual(self.upload(filename="bad.xls").status_code, 422)
        self.assertEqual(self.upload(raw=b"a" * (4 * 1024 * 1024 + 1)).status_code, 413)

    def test_foreign_origin_blocked(self):
        self.assertEqual(self.client.get("/api/pairing", headers={"Origin": "https://evil.example"}).status_code, 403)

    def test_no_extension(self):
        task = self.make_task()
        self.assertEqual(self.upload(path="/api/jobs", data={"prompt": "Analyze", "task_id": task}).status_code, 409)

    def test_simple_question_without_upload(self):
        task = self.make_task()
        with self.client.websocket_connect("/api/bridge?token=" + main.BRIDGE_KEY) as ws:
            response = self.emp.post("/api/search", json={"prompt": "Thu do Viet Nam?", "task_id": task})
            self.assertEqual(response.status_code, 201)
            message = ws.receive_json()
            self.assertEqual(message["file"], "")
            self.assertEqual(message["mode"], "simple")
            self.assertNotIn("THỐNG KÊ BACKEND", message["prompt"])
            ws.send_json({"type": "result", "id": message["id"], "text": "Ha Noi", "html": "<h2>Ha Noi</h2><table><tr><td>60</td></tr></table><svg viewBox='0 0 100 40'><rect width='60' height='20'/></svg>"})
            self.assertEqual(ws.receive_json()["type"], "saved")
            self.assertEqual(self.emp.get("/api/jobs/" + message["id"]).json()["result"], "Ha Noi")
            self.assertIn("<svg", self.emp.get("/api/jobs/" + message["id"]).json()["result_html"])

    def test_simple_file_receipt_without_analysis_prompt(self):
        task = self.make_task()
        with self.client.websocket_connect("/api/bridge?token=" + main.BRIDGE_KEY) as ws:
            response = self.upload(path="/api/file-question", data={"prompt": "Xac nhan da nhan tep, khong phan tich.", "task_id": task})
            self.assertEqual(response.status_code, 201)
            message = ws.receive_json()
            self.assertTrue(message["file"])
            self.assertEqual(message["filename"], "sales.csv")
            self.assertEqual(message["mode"], "simple")
            self.assertNotIn("THỐNG KÊ BACKEND", message["prompt"])
            ws.send_json({"type": "result", "id": message["id"], "text": "Da nhan sales.csv"})
            self.assertEqual(ws.receive_json()["type"], "saved")
            self.assertEqual(self.emp.get("/api/jobs/" + message["id"]).json()["status"], "succeeded")

    def test_authenticated_bridge_queue_and_persistence(self):
        task = self.make_task()
        with self.client.websocket_connect("/api/bridge?token=" + main.BRIDGE_KEY) as ws:
            self.assertTrue(self.client.get("/api/health").json()["extension_connected"])
            first = self.upload(path="/api/jobs", data={"prompt": "Phân tích dữ liệu", "task_id": task}).json()
            message = ws.receive_json()
            self.assertEqual(message["id"], first["id"])
            self.assertEqual(message["filename"], "sales.csv")
            self.assertIn("THỐNG KÊ BACKEND", message["prompt"])
            ws.send_json({"type": "progress", "id": first["id"], "text": "Nội dung đang được tạo…"})
            ws.send_json({"type": "ping"})
            self.assertEqual(ws.receive_json(), {"type": "pong"})
            partial = self.emp.get("/api/jobs/" + first["id"]).json()
            self.assertEqual(partial["result"], "Nội dung đang được tạo…")
            self.assertEqual(partial["status"], "running")
            second = self.upload(path="/api/jobs", data={"prompt": "Lượt thứ hai", "task_id": task}).json()
            self.assertEqual(second["status"], "queued")
            ws.send_json({"type": "result", "id": first["id"], "text": "Tổng doanh thu là 300."})
            self.assertEqual(ws.receive_json(), {"type": "saved", "id": first["id"]})
            self.assertEqual(ws.receive_json()["id"], second["id"])
            stored = self.emp.get("/api/jobs/" + first["id"]).json()
            self.assertEqual(stored["status"], "succeeded")
            self.assertNotIn("raw", stored)
            with sqlite3.connect(store.DB) as db:
                self.assertEqual(db.execute("SELECT result FROM jobs WHERE id=?", (first["id"],)).fetchone()[0], "Tổng doanh thu là 300.")
            db.close()
            ws.send_json({"type": "result", "id": second["id"], "error": "Chưa đăng nhập"})
            self.assertEqual(ws.receive_json()["type"], "saved")
            self.assertEqual(self.emp.get("/api/jobs/" + second["id"]).json()["status"], "failed")
        self.assertNotIn("result", self.emp.get("/api/jobs").json()[0])

    def test_bad_bridge_token(self):
        from starlette.websockets import WebSocketDisconnect
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/api/bridge?token=wrong"):
                pass

    def test_sample_revenue_file(self):
        source = Path(r"C:\Users\Admin\Downloads\ok\Du_lieu_mau_T12\01_sales_valid.csv")
        if not source.exists():
            self.skipTest("Tệp mẫu không có trên máy này")
        summary = self.upload(raw=source.read_bytes()).json()
        self.assertEqual(summary["row_count"], 60)
        self.assertEqual(summary["metrics"]["numeric"]["revenue"]["sum"], "5668500000")


class AccessTests(Base):
    def test_login_required(self):
        for method, path in (("get", "/api/me"), ("get", "/api/tasks"), ("get", "/api/jobs"), ("get", "/api/users"), ("post", "/api/preview")):
            with self.subTest(path=path):
                self.assertEqual(getattr(self.client, method)(path).status_code, 401)

    def test_each_role_stays_within_its_duties(self):
        task = self.make_task()
        boss = self.login("boss")
        with self.client.websocket_connect("/api/bridge?token=" + main.BRIDGE_KEY):
            # Employee: no account management, task administration or self-approval.
            for method, path, body in (("get", "/api/users", None), ("get", "/api/audit", None), ("post", f"/api/tasks/{task}/review", {"status": "approved", "confirmed": True})):
                self.assertEqual(getattr(self.emp, method)(path, **({"json": body} if body else {})).status_code, 403, path)
            # Manager: follows results, but neither runs AI, uploads data nor edits results on an employee's task.
            self.assertEqual(boss.post("/api/search", json={"prompt": "Hi", "task_id": task}).status_code, 403)
            self.assertEqual(self.upload(boss, path="/api/jobs", data={"prompt": "x", "task_id": task}).status_code, 403)
            self.assertEqual(self.upload(boss).status_code, 403)
            self.assertEqual(boss.put(f"/api/tasks/{task}/result", json={"run_id": "x"}).status_code, 403)
            self.assertEqual(boss.post(f"/api/tasks/{task}/review", json={"status": "approved", "confirmed": True}).status_code, 403)
            # Admin: operates the system and sees all history, never performs the analysis.
            self.assertEqual(self.admin.post("/api/search", json={"prompt": "Hi", "task_id": task}).status_code, 403)
            self.assertEqual(self.admin.put(f"/api/tasks/{task}/result", json={"run_id": "x"}).status_code, 403)
            self.assertEqual(self.admin.post(f"/api/tasks/{task}/submit").status_code, 403)
            self.assertEqual(self.admin.get("/api/jobs").status_code, 200)
        self.assertGreaterEqual(self.actions().count("denied"), 11)

    def test_task_scope_by_assignment_and_department(self):
        task = self.make_task()
        emp2, boss, fin = self.login("emp2"), self.login("boss"), self.login("fin")
        self.assertEqual([t["id"] for t in self.emp.get("/api/tasks").json()], [task])
        self.assertEqual(emp2.get("/api/tasks").json(), [])
        self.assertEqual(emp2.get(f"/api/tasks/{task}").status_code, 403)
        self.assertEqual(emp2.put(f"/api/tasks/{task}/result", json={"run_id": "x"}).status_code, 403)
        self.assertEqual(emp2.post("/api/search", json={"prompt": "x", "task_id": task}).status_code, 409)  # no extension, checked first
        self.assertEqual([t["id"] for t in boss.get("/api/tasks").json()], [task])
        self.assertEqual(fin.get("/api/tasks").json(), [])
        self.assertEqual(fin.get(f"/api/tasks/{task}").status_code, 403)
        self.assertEqual(self.emp.put(f"/api/tasks/{task}/result", json={"run_id": self.finished_run(task, "Kết luận")}).status_code, 200)
        self.assertEqual(boss.get(f"/api/tasks/{task}").json()["result"], "Kết luận")
        self.assertEqual(self.admin.get(f"/api/tasks/{task}").json()["result"], "Kết luận")

    def test_run_history_follows_the_task_assignment(self):
        task = self.make_task()
        emp2, boss, fin = self.login("emp2"), self.login("boss"), self.login("fin")
        with self.client.websocket_connect("/api/bridge?token=" + main.BRIDGE_KEY) as ws:
            self.assertEqual(self.emp.post("/api/jobs", data={"prompt": "x"}, files={"file": ("sales.csv", SALES)}).status_code, 422)  # a run needs a task
            run = self.upload(path="/api/jobs", data={"prompt": "Phân tích", "task_id": task})
            self.assertEqual(run.status_code, 201, run.text)
            ws.send_json({"type": "result", "id": ws.receive_json()["id"], "text": "Tổng 300"})
            self.assertEqual(ws.receive_json()["type"], "saved")
        run = run.json()["id"]
        self.assertEqual(self.emp.get("/api/jobs/" + run).json()["source"], "upload")
        for client in (boss, self.admin):
            self.assertEqual([j["id"] for j in client.get("/api/jobs").json()], [run])
            self.assertEqual(client.get("/api/jobs/" + run).json()["result"], "Tổng 300")
        self.assertEqual((emp2.get("/api/jobs").json(), fin.get("/api/jobs").json()), ([], []))
        self.assertEqual(fin.get("/api/jobs/" + run).status_code, 403)
        # History belongs to the task: after reassignment the new assignee sees it, the former one does not.
        self.admin.put(f"/api/tasks/{task}", json={"title": "Doanh thu Q2", "objective": "x", "requirements": "x", "assignee_id": self.ids["emp2"]})
        self.assertEqual([j["id"] for j in emp2.get("/api/jobs").json()], [run])
        self.assertEqual(self.emp.get("/api/jobs").json(), [])
        self.assertEqual(self.emp.get("/api/jobs/" + run).status_code, 403)

    def test_t12_submission_and_g11_record(self):
        self.assertEqual(self.upload(self.admin, path="/api/datasets").status_code, 201)
        self.assertEqual(self.upload(self.admin, raw=b"a,b\n1,2\n", path="/api/datasets", filename="other.csv").status_code, 201)
        sample, other = sorted(self.admin.get("/api/datasets").json(), key=lambda d: d["filename"] != "sales.csv")
        task = self.make_task(datasets=[sample["id"]])
        brief = self.emp.get(f"/api/tasks/{task}").json()
        self.assertEqual(([d["filename"] for d in brief["datasets"]], brief["status"]), (["sales.csv"], "ready_for_analysis"))
        with self.client.websocket_connect("/api/bridge?token=" + main.BRIDGE_KEY) as ws:
            self.assertEqual(self.emp.post("/api/jobs", data={"prompt": "x", "task_id": task, "dataset_id": other["id"]}).status_code, 403)
            run = self.emp.post("/api/jobs", data={"prompt": "Phân tích", "task_id": task, "dataset_id": sample["id"]})
            self.assertEqual(run.status_code, 201, run.text)
            message = ws.receive_json()
            self.assertEqual(message["filename"], "sales.csv")
            ws.send_json({"type": "result", "id": message["id"], "text": "Doanh thu 300"})
            self.assertEqual(ws.receive_json()["type"], "saved")
        boss, emp2 = self.login("boss"), self.login("emp2")
        self.assertEqual(self.emp.get(f"/api/tasks/{task}").json()["status"], "in_progress")
        self.assertEqual([j["id"] for j in boss.get(f"/api/jobs?task={task}").json()], [message["id"]])
        detail = boss.get("/api/jobs/" + message["id"]).json()
        self.assertEqual((detail["result"], detail["source"], detail["prompt"], detail["task_title"]), ("Doanh thu 300", "dataset", "Phân tích", "Doanh thu Q2"))
        self.assertEqual(emp2.get("/api/jobs/" + message["id"]).status_code, 403)
        # Editing a run keeps the AI draft and stores the assignee's version beside it.
        edit = f"/api/jobs/{message['id']}"
        for client in (boss, emp2, self.admin):
            self.assertEqual(client.patch(edit, json={"result": "sửa"}).status_code, 403)
        self.assertEqual(self.emp.patch(edit, json={"result": "Doanh thu 300 (đã kiểm tra)", "html": "<h2>Doanh thu 300 (đã kiểm tra)</h2>"}).status_code, 200)
        edited = boss.get(edit).json()
        self.assertEqual((edited["result"], edited["edited_result"], edited["edited_html"]), ("Doanh thu 300", "Doanh thu 300 (đã kiểm tra)", "<h2>Doanh thu 300 (đã kiểm tra)</h2>"))
        self.assertIsNotNone(edited["edited"])
        if pdf.browser():
            exported = boss.get(edit + "/pdf")
            self.assertEqual((exported.status_code, exported.content[:4], exported.headers["content-type"]), (200, b"%PDF", "application/pdf"))
            self.assertEqual(self.login("fin").get(edit + "/pdf").status_code, 403)

        # The task's output is a selected successful run of the task itself, edited version included.
        result = f"/api/tasks/{task}/result"
        self.assertEqual(self.emp.post(f"/api/tasks/{task}/submit").status_code, 422)  # no run selected yet
        self.assertEqual(self.emp.put(result, json={"run_id": self.finished_run(self.make_task(), "Tác vụ khác")}).status_code, 422)
        self.assertEqual(self.emp.put(result, json={"run_id": message["id"]}).status_code, 200)
        chosen = boss.get(f"/api/tasks/{task}").json()
        self.assertEqual((chosen["selected_run_id"], chosen["result"], chosen["result_html"]), (message["id"], "Doanh thu 300 (đã kiểm tra)", "<h2>Doanh thu 300 (đã kiểm tra)</h2>"))
        self.assertEqual(self.admin.post(f"/api/tasks/{task}/review", json={"status": "approved", "confirmed": True}).status_code, 409)  # not submitted
        self.assertEqual(self.emp.post(f"/api/tasks/{task}/submit").status_code, 200)
        self.assertEqual(self.emp.put(result, json={"run_id": message["id"]}).status_code, 409)
        self.assertEqual(self.emp.patch(edit, json={"result": "đổi sau khi nộp"}).status_code, 409)
        self.assertEqual(self.admin.put(f"/api/tasks/{task}", json={"title": "x", "objective": "x", "requirements": "x", "assignee_id": self.ids["emp"]}).status_code, 409)
        self.assertEqual(self.admin.post(f"/api/tasks/{task}/review", json={"status": "approved", "confirmed": False}).status_code, 422)
        self.assertEqual(self.admin.post(f"/api/tasks/{task}/review", json={"status": "needs_revision", "confirmed": True}).status_code, 422)
        self.assertEqual(self.admin.post(f"/api/tasks/{task}/review", json={"status": "needs_revision", "note": "Bổ sung miền Trung", "confirmed": True}).status_code, 200)
        revised = self.emp.get(f"/api/tasks/{task}").json()
        self.assertEqual((revised["status"], revised["review_note"], revised["reviewer"]), ("needs_revision", "Bổ sung miền Trung", "Admin"))
        with self.client.websocket_connect("/api/bridge?token=" + main.BRIDGE_KEY) as ws:
            rerun = self.emp.post("/api/search", json={"prompt": "Bổ sung miền Trung", "task_id": task})
            self.assertEqual(rerun.status_code, 201)
            ws.send_json({"type": "result", "id": ws.receive_json()["id"], "text": "Miền Trung 1,666 tỷ"})
            self.assertEqual(ws.receive_json()["type"], "saved")
        self.assertEqual(self.emp.get(f"/api/tasks/{task}").json()["status"], "in_progress")  # a rerun reopens the task
        self.assertEqual(len(self.emp.get(f"/api/jobs?task={task}").json()), 2)  # the first run is kept
        self.assertEqual(self.emp.put(result, json={"run_id": rerun.json()["id"]}).status_code, 200)
        self.assertEqual(self.emp.post(f"/api/tasks/{task}/submit").status_code, 200)
        self.assertEqual(self.admin.post(f"/api/tasks/{task}/review", json={"status": "approved", "confirmed": True}).status_code, 200)
        final = self.emp.get(f"/api/tasks/{task}").json()
        self.assertEqual((final["status"], final["result"]), ("approved", "Miền Trung 1,666 tỷ"))
        self.assertEqual(self.emp.post(f"/api/tasks/{task}/submit").status_code, 409)
        for action in ("dataset_create", "task_create", "ai_run", "run_edit", "result_select", "submit_t12", "record_g11"):
            self.assertIn(action, self.actions())

    def test_account_administration(self):
        new = {"username": "moi", "full_name": "Người mới", "password": "matkhau123", "role": "employee", "department_id": None}
        self.assertEqual(self.admin.post("/api/users", json=new).status_code, 422)  # employee needs a department
        new["department_id"] = self.emp.get("/api/me").json()["department_id"]
        self.assertEqual(self.admin.post("/api/users", json=new).status_code, 201)
        self.assertEqual(self.admin.post("/api/users", json=new).status_code, 409)
        self.assertEqual(self.admin.patch(f"/api/users/{self.ids['admin']}", json={"active": False}).status_code, 403)
        self.assertEqual(self.admin.patch(f"/api/users/{self.ids['admin']}", json={"role": "employee"}).status_code, 403)
        self.assertEqual(self.admin.patch(f"/api/users/{self.ids['admin']}", json={"full_name": "Quản trị"}).status_code, 200)

        self.make_task()
        self.assertEqual(self.admin.patch(f"/api/users/{self.ids['emp']}", json={"role": "manager"}).status_code, 409)
        self.assertEqual(self.admin.patch(f"/api/users/{self.ids['emp']}", json={"active": False}).status_code, 200)
        self.assertEqual(self.emp.get("/api/me").status_code, 401)  # session revoked at once
        self.assertEqual(self.client.post("/api/auth/login", json={"username": "emp", "password": PASSWORD}).status_code, 403)
        self.admin.patch(f"/api/users/{self.ids['emp']}", json={"active": True, "password": "matkhaumoi1"})
        self.assertEqual(self.client.post("/api/auth/login", json={"username": "emp", "password": PASSWORD}).status_code, 401)
        self.login("emp", "matkhaumoi1")
        self.assertIn("user_update", self.actions())

    def test_login_lockout_after_repeated_failures(self):
        for _ in range(5):
            self.assertEqual(self.client.post("/api/auth/login", json={"username": "boss", "password": "sai"}).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={"username": "boss", "password": PASSWORD}).status_code, 429)
        self.assertEqual(self.client.post("/api/auth/logout").status_code, 401)


if __name__ == "__main__":
    unittest.main()
