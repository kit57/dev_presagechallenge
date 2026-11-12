import json
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server import SessionStore, make_handler


class SessionApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        store = SessionStore(Path(self.temp_dir.name) / "sessions.sqlite3")
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(store))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp_dir.cleanup()

    def request(
        self, method: str, path: str, data: bytes | None = None, headers: dict[str, str] | None = None
    ) -> tuple[int, bytes]:
        request_headers = dict(headers or {})
        if data is not None and "Content-Type" not in request_headers:
            request_headers["Content-Type"] = "application/json"
        request = Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers=request_headers,
        )
        try:
            with urlopen(request) as response:
                return response.status, response.read()
        except HTTPError as error:
            return error.code, error.read()

    def request_json(self, method: str, path: str, payload: object = None) -> tuple[int, dict]:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        status, response = self.request(method, path, data)
        return status, json.loads(response)

    def test_save_load_and_delete_session(self) -> None:
        self.assertEqual(self.request_json("GET", "/api/session"), (200, {"session": None}))
        status, response = self.request_json(
            "PUT",
            "/api/session",
            {"notes": "A note", "prompts": [{"type": "question", "text": "What happened?"}]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(response["session"]["notes"], "A note")
        self.assertEqual(response["session"]["prompts"][0]["text"], "What happened?")
        created_at = datetime.fromisoformat(response["session"]["created_at"])
        expires_at = datetime.fromisoformat(response["session"]["expires_at"])
        self.assertEqual(expires_at - created_at, timedelta(days=30))
        status, updated = self.request_json(
            "PUT", "/api/session", {"notes": "Updated", "prompts": [{"type": "question", "text": "Next?"}]}
        )
        self.assertEqual(status, 200)
        self.assertEqual(updated["session"]["created_at"], response["session"]["created_at"])
        self.assertEqual(updated["session"]["expires_at"], response["session"]["expires_at"])
        self.assertEqual(self.request_json("DELETE", "/api/session"), (200, {"deleted": True}))
        self.assertEqual(self.request_json("DELETE", "/api/session"), (200, {"deleted": False}))

    def test_rejects_invalid_prompt(self) -> None:
        for prompt_type in ("unknown", ["question"]):
            with self.subTest(prompt_type=prompt_type):
                status, response = self.request_json(
                    "PUT",
                    "/api/session",
                    {"notes": "", "prompts": [{"type": prompt_type, "text": "x"}]},
                )
                self.assertEqual(status, 400)
                self.assertIn("Prompt type", response["error"])

    def test_validates_session_fields_and_limits(self) -> None:
        valid_payload = {
            "notes": "n" * 5_000,
            "prompts": [{"type": "question", "text": "x" * 240}] * 50,
        }
        status, response = self.request_json("PUT", "/api/session", valid_payload)
        self.assertEqual(status, 200)
        self.assertEqual(len(response["session"]["notes"]), 5_000)
        self.assertEqual(len(response["session"]["prompts"]), 50)
        self.assertEqual(len(response["session"]["prompts"][0]["text"]), 240)

        invalid_payloads = [
            [],
            {},
            {"notes": "", "prompts": "not a list"},
            {"notes": 1, "prompts": []},
            {"notes": "n" * 5_001, "prompts": []},
            {"notes": "", "prompts": None},
            {"notes": "", "prompts": [{}] * 51},
            {"notes": "", "prompts": ["not an object"]},
            {"notes": "", "prompts": [{"type": "question", "text": "  "}]},
            {"notes": "", "prompts": [{"type": "media", "text": "x" * 241}]},
        ]
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                status, response = self.request_json("PUT", "/api/session", payload)
                self.assertEqual(status, 400)
                self.assertIn("error", response)

    def test_rejects_invalid_request_bodies(self) -> None:
        requests = [
            (None, {}),
            (b"{", {"Content-Type": "application/json"}),
            (b"{}", {"Content-Type": "text/plain"}),
            (b"x" * (64 * 1024 + 1), {"Content-Type": "application/json"}),
        ]
        expected_statuses = [400, 400, 400, 413]
        for (body, headers), expected_status in zip(requests, expected_statuses):
            with self.subTest(body_length=None if body is None else len(body)):
                status, response = self.request("PUT", "/api/session", body, headers)
                self.assertEqual(status, expected_status)
                self.assertIn("error", json.loads(response))

    def test_health_and_unknown_api_routes(self) -> None:
        self.assertEqual(self.request_json("GET", "/api/health"), (200, {"ok": True}))
        self.assertEqual(
            self.request_json("GET", "/api/missing"),
            (404, {"error": "API route not found."}),
        )
        self.assertEqual(
            self.request_json("PUT", "/api/missing", {}),
            (404, {"error": "API route not found."}),
        )
        self.assertEqual(
            self.request_json("DELETE", "/api/missing"),
            (404, {"error": "API route not found."}),
        )

    def test_expires_saved_session(self) -> None:
        status, _ = self.request_json(
            "PUT", "/api/session", {"notes": "", "prompts": [{"type": "media", "text": "Show media"}]}
        )
        self.assertEqual(status, 200)
        database = Path(self.temp_dir.name) / "sessions.sqlite3"
        with closing(sqlite3.connect(database)) as connection:
            with connection:
                connection.execute(
                    "UPDATE session SET expires_at = '2000-01-01T00:00:00+00:00' WHERE id = 1"
                )
        self.assertEqual(self.request_json("GET", "/api/session"), (200, {"session": None}))
        with closing(sqlite3.connect(database)) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM session").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
