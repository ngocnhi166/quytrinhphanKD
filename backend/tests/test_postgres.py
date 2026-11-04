"""Opt-in integration checks against an isolated PostgreSQL schema."""
import json
import os
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch


@unittest.skipUnless(os.environ.get("TEST_DATABASE_URL"), "Set TEST_DATABASE_URL to run PostgreSQL checks.")
class PostgresTests(unittest.TestCase):
    def test_account_task_review_and_exports(self):
        import psycopg
        from psycopg import sql
        from fastapi.testclient import TestClient
        from backend.app import store

        url = os.environ["TEST_DATABASE_URL"]
        schema = "scope_test_" + uuid.uuid4().hex
        with psycopg.connect(url, autocommit=True) as control:
            control.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        original_init = store.PostgresConnection.__init__

        def isolated_init(instance, connection_url):
            original_init(instance, connection_url)
            instance.conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))

        try:
            with tempfile.TemporaryDirectory() as folder, \
                    patch.dict(os.environ, {"DATABASE_URL": url}), \
                    patch.object(store, "DATA", Path(folder)), \
                    patch.object(store, "ACCOUNTS_FILE", Path(folder) / "accounts.txt"), \
                    patch.object(store.PostgresConnection, "__init__", isolated_init):
                from backend.app import access
                store.init_db(seed=False)
                password = "test-password-123"
                with store.connection() as db:
                    department = db.execute("INSERT INTO departments (name,created) VALUES (?,0) RETURNING id", ("Sales",)).fetchone()[0]
                    for name, role in (("Admin", "admin"), ("Manager", "manager"), ("Employee", "employee")):
                        db.execute("INSERT INTO users (username,full_name,password,role,department_id,created) VALUES (?,?,?,?,?,0)",
                                   (name, name, access.hash_password(password), role, department))
                from backend.app import main
                with TestClient(main.app) as lifecycle, TestClient(main.app) as employee, TestClient(main.app) as manager, TestClient(main.app) as admin:
                    for client, name in ((employee, "employee"), (manager, "MANAGER"), (admin, "admin")):
                        response = client.post("/api/auth/login", json={"username": name, "password": password})
                        self.assertEqual(response.status_code, 200)
                    response = admin.post("/api/users", json={"username": "EMPLOYEE", "full_name": "Duplicate", "password": password, "role": "employee", "department_id": department})
                    self.assertEqual(response.status_code, 409)
                    created = employee.post("/api/tasks", json={"title": "PG report", "objective": "Verify persistence", "requirements": ""})
                    self.assertEqual(created.status_code, 201, created.text)
                    task_id = created.json()["id"]
                    user_id = employee.get("/api/me").json()["id"]
                    run_id = str(uuid.uuid4())
                    with store.connection() as db:
                        db.execute("INSERT INTO jobs (id,filename,status,prompt,summary,result,result_html,created,updated,raw,user_id,task_id,source) VALUES (?,?,?,?,?,?,?,0,0,?,?,?,?)",
                                   (run_id, "test.csv", "succeeded", "Analysis", json.dumps({"columns": [], "metrics": {}, "preview": [], "row_count": 0}), "Report", "<h1>Report</h1>", b"test", user_id, task_id, "upload"))
                    self.assertEqual(employee.put(f"/api/tasks/{task_id}/result", json={"run_id": run_id}).status_code, 200)
                    self.assertEqual(employee.post(f"/api/tasks/{task_id}/submit").status_code, 200)
                    self.assertIn(task_id, [task["id"] for task in manager.get("/api/tasks").json()])
                    review = manager.post(f"/api/tasks/{task_id}/review", json={"status": "approved", "note": "Accepted", "confirmed": True})
                    self.assertEqual(review.status_code, 200, review.text)
                    self.assertEqual(employee.get(f"/api/tasks/{task_id}").json()["status"], "approved")
                    exported = manager.get(f"/api/jobs/{run_id}/word")
                    self.assertEqual(exported.status_code, 200, exported.text[:100])
                    self.assertTrue(exported.content.startswith(b"PK"))
                    self.assertEqual(employee.delete(f"/api/history/{run_id}").status_code, 403)
                    self.assertEqual(admin.delete(f"/api/history/{run_id}").status_code, 200)
                    self.assertEqual(admin.get("/api/jobs").json(), [])
                    self.assertEqual(manager.get(f"/api/jobs/{run_id}").status_code, 200)
                    # New connections read the committed report from PostgreSQL.
                    with store.connection() as db:
                        self.assertEqual(db.execute("SELECT result FROM tasks WHERE id=?", (task_id,)).fetchone()[0], "Report")
        finally:
            with psycopg.connect(url, autocommit=True) as control:
                control.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
