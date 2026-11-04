import os
from unittest.mock import patch

from starlette.websockets import WebSocketDisconnect

from backend.tests.test_api import Base
from backend.app import main, store


class UserBridgeTests(Base):
    def setUp(self):
        super().setUp()
        self.cloud = patch.dict(os.environ, {"SCOPE_PUBLIC_ORIGIN": "https://scope-t12.vercel.app"})
        self.cloud.start()

    def tearDown(self):
        self.cloud.stop()
        super().tearDown()

    def ticket(self, client):
        response = client.post("/api/extension/pairing")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["token"]

    def authenticate(self, socket, token):
        socket.send_json({"type": "authenticate", "token": token})
        self.assertEqual(socket.receive_json(), {"type": "connected"})

    def test_two_users_receive_only_their_jobs_and_logout_revokes_bridge(self):
        second = self.login("emp2")
        task_a, task_b = self.make_task(), self.make_task("emp2")
        token_a = self.ticket(self.emp)
        with self.client.websocket_connect("/api/extension/bridge") as socket_a:
            self.authenticate(socket_a, token_a)
            self.assertTrue(self.emp.get("/api/extension/status").json()["connected"])
            self.assertFalse(second.get("/api/extension/status").json()["connected"])
            self.assertEqual(second.post("/api/search", json={"task_id": task_b, "prompt": "B"}).status_code, 409)
            with self.client.websocket_connect("/api/extension/bridge") as socket_b:
                self.authenticate(socket_b, self.ticket(second))
                with self.assertRaises(WebSocketDisconnect):
                    with self.client.websocket_connect("/api/extension/bridge") as replay:
                        replay.send_json({"type": "authenticate", "token": token_a})
                        replay.receive_json()
                job_a = self.emp.post("/api/search", json={"task_id": task_a, "prompt": "Question A"}).json()["id"]
                job_b = second.post("/api/search", json={"task_id": task_b, "prompt": "Question B"}).json()["id"]
                self.assertEqual(socket_a.receive_json()["id"], job_a)
                self.assertEqual(socket_b.receive_json()["id"], job_b)
                socket_b.send_json({"type": "result", "id": job_a, "text": "Wrong user's answer"})
                socket_b.send_json({"type": "ping"})
                self.assertEqual(socket_b.receive_json(), {"type": "pong"})
                self.assertIsNone(self.emp.get(f"/api/jobs/{job_a}").json()["result"])
                socket_b.send_json({"type": "result", "id": job_b, "text": "Answer B"})
                self.assertEqual(socket_b.receive_json(), {"type": "saved", "id": job_b})
                socket_a.send_json({"type": "result", "id": job_a, "text": "Answer A"})
                self.assertEqual(socket_a.receive_json(), {"type": "saved", "id": job_a})
                self.assertEqual(self.emp.get(f"/api/jobs/{job_a}").json()["result"], "Answer A")
                self.assertEqual(second.get(f"/api/jobs/{job_b}").json()["result"], "Answer B")
                self.emp.post("/api/auth/logout")
                socket_a.send_json({"type": "ping"})
                with self.assertRaises(WebSocketDisconnect):
                    socket_a.receive_json()
                self.assertTrue(second.get("/api/extension/status").json()["connected"])
        self.assertEqual(main.user_bridges, {})

    def test_pairing_requires_employee_and_expired_ticket_is_rejected(self):
        self.assertEqual(self.admin.post("/api/extension/pairing").status_code, 403)
        token = self.ticket(self.emp)
        with store.connection() as db:
            db.execute("UPDATE bridge_tickets SET expires=0")
        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/api/extension/bridge") as socket:
                socket.send_json({"type": "authenticate", "token": token})
                socket.receive_json()

    def test_account_lock_revokes_connection_and_duplicate_does_not_replace_it(self):
        with self.client.websocket_connect("/api/extension/bridge") as first:
            self.authenticate(first, self.ticket(self.emp))
            with self.assertRaises(WebSocketDisconnect):
                with self.client.websocket_connect("/api/extension/bridge") as duplicate:
                    duplicate.send_json({"type": "authenticate", "token": self.ticket(self.emp)})
                    duplicate.receive_json()
            self.assertTrue(self.emp.get("/api/extension/status").json()["connected"])
            self.admin.patch(f"/api/users/{self.ids['emp']}", json={"active": False})
            first.send_json({"type": "ping"})
            with self.assertRaises(WebSocketDisconnect):
                first.receive_json()

    def test_public_backend_rejects_legacy_shared_key(self):
        with patch.object(main, "PUBLIC_ORIGIN", "https://scope-t12.vercel.app"):
            self.assertEqual(self.client.get("/api/pairing").status_code, 403)
            with self.assertRaises(WebSocketDisconnect):
                with self.client.websocket_connect("/api/bridge?token=" + main.BRIDGE_KEY):
                    pass
