import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from openpyxl import Workbook

from backend.app import main


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db = main.DB
        main.DB = Path(self.temp.name) / "test.sqlite3"
        with main.connection() as db:
            db.execute("CREATE TABLE jobs (id TEXT PRIMARY KEY, filename TEXT, status TEXT, prompt TEXT, summary TEXT, result TEXT, error TEXT, created REAL, updated REAL, raw BLOB, result_html TEXT)")
        main.bridge = main.Bridge()
        self.client = TestClient(main.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        main.DB = self.old_db
        self.temp.cleanup()

    def upload(self, raw=b"region,revenue\nNorth,100\nSouth,200\n", path="/api/preview", filename="sales.csv", **extra):
        return self.client.post(path, files={"file": (filename, raw)}, **extra)

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
        response = self.upload(out.getvalue(), filename="sales.xlsx")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["metrics"]["numeric"]["quantity"]["sum"], "5")

    def test_invalid_files(self):
        for raw in [b"", b"a,b\n", b"a,a\n1,2", b"a,b\n1,2,3", b"a,b\n\xff,3"]:
            with self.subTest(raw=raw):
                self.assertEqual(self.upload(raw).status_code, 422)
        self.assertEqual(self.upload(filename="bad.xls").status_code, 422)
        self.assertEqual(self.upload(b"a" * (4 * 1024 * 1024 + 1)).status_code, 413)

    def test_foreign_origin_blocked(self):
        self.assertEqual(self.client.get("/api/pairing", headers={"Origin": "https://evil.example"}).status_code, 403)

    def test_no_extension(self):
        self.assertEqual(self.upload(path="/api/jobs", data={"prompt": "Analyze"}).status_code, 409)

    def test_simple_question_without_upload(self):
        with self.client.websocket_connect("/api/bridge?token=" + main.BRIDGE_KEY) as ws:
            response = self.client.post("/api/search", json={"prompt": "Thu do Viet Nam?"})
            self.assertEqual(response.status_code, 201)
            message = ws.receive_json()
            self.assertEqual(message["file"], "")
            self.assertEqual(message["mode"], "simple")
            self.assertNotIn("THỐNG KÊ BACKEND", message["prompt"])
            ws.send_json({"type": "result", "id": message["id"], "text": "Ha Noi", "html": "<h2>Ha Noi</h2><table><tr><td>60</td></tr></table><svg viewBox='0 0 100 40'><rect width='60' height='20'/></svg>"})
            self.assertEqual(ws.receive_json()["type"], "saved")
            self.assertEqual(self.client.get("/api/jobs/" + message["id"]).json()["result"], "Ha Noi")
            self.assertIn("<svg", self.client.get("/api/jobs/" + message["id"]).json()["result_html"])

    def test_simple_file_receipt_without_analysis_prompt(self):
        with self.client.websocket_connect("/api/bridge?token=" + main.BRIDGE_KEY) as ws:
            response = self.upload(path="/api/file-question", data={"prompt": "Xac nhan da nhan tep, khong phan tich."})
            self.assertEqual(response.status_code, 201)
            message = ws.receive_json()
            self.assertTrue(message["file"])
            self.assertEqual(message["filename"], "sales.csv")
            self.assertEqual(message["mode"], "simple")
            self.assertNotIn("THỐNG KÊ BACKEND", message["prompt"])
            ws.send_json({"type": "result", "id": message["id"], "text": "Da nhan sales.csv"})
            self.assertEqual(ws.receive_json()["type"], "saved")
            self.assertEqual(self.client.get("/api/jobs/" + message["id"]).json()["status"], "succeeded")

    def test_authenticated_bridge_queue_and_persistence(self):
        with self.client.websocket_connect("/api/bridge?token=" + main.BRIDGE_KEY) as ws:
            self.assertTrue(self.client.get("/api/health").json()["extension_connected"])
            first = self.upload(path="/api/jobs", data={"prompt": "Phân tích dữ liệu"}).json()
            message = ws.receive_json()
            self.assertEqual(message["id"], first["id"])
            self.assertEqual(message["filename"], "sales.csv")
            self.assertIn("THỐNG KÊ BACKEND", message["prompt"])
            ws.send_json({"type": "progress", "id": first["id"], "text": "Nội dung đang được tạo…"})
            ws.send_json({"type": "ping"})
            self.assertEqual(ws.receive_json(), {"type": "pong"})
            partial = self.client.get("/api/jobs/" + first["id"]).json()
            self.assertEqual(partial["result"], "Nội dung đang được tạo…")
            self.assertEqual(partial["status"], "running")
            second = self.upload(path="/api/jobs", data={"prompt": "Lượt thứ hai"}).json()
            self.assertEqual(second["status"], "queued")
            ws.send_json({"type": "result", "id": first["id"], "text": "Tổng doanh thu là 300."})
            self.assertEqual(ws.receive_json(), {"type": "saved", "id": first["id"]})
            self.assertEqual(ws.receive_json()["id"], second["id"])
            stored = self.client.get("/api/jobs/" + first["id"]).json()
            self.assertEqual(stored["status"], "succeeded")
            self.assertNotIn("raw", stored)
            with sqlite3.connect(main.DB) as db:
                self.assertEqual(db.execute("SELECT result FROM jobs WHERE id=?", (first["id"],)).fetchone()[0], "Tổng doanh thu là 300.")
            db.close()
            ws.send_json({"type": "result", "id": second["id"], "error": "Chưa đăng nhập"})
            self.assertEqual(ws.receive_json()["type"], "saved")
            self.assertEqual(self.client.get("/api/jobs/" + second["id"]).json()["status"], "failed")

    def test_bad_bridge_token(self):
        from starlette.websockets import WebSocketDisconnect
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/api/bridge?token=wrong"):
                pass

    def test_sample_revenue_file(self):
        source = Path(r"C:\Users\Admin\Downloads\ok\Du_lieu_mau_T12\01_sales_valid.csv")
        if not source.exists():
            self.skipTest("Tệp mẫu không có trên máy này")
        summary = self.upload(source.read_bytes()).json()
        self.assertEqual(summary["row_count"], 60)
        self.assertEqual(summary["metrics"]["numeric"]["revenue"]["sum"], "5668500000")


if __name__ == "__main__":
    unittest.main()
