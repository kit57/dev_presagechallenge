import argparse
import json
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
DATABASE = Path.home() / ".signal-session" / "sessions.sqlite3"
RETENTION_DAYS = 30
MAX_REQUEST_BYTES = 64 * 1024
MAX_NOTES_LENGTH = 5_000
MAX_PROMPTS = 50
MAX_PROMPT_LENGTH = 240


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def timestamp(value: datetime) -> str:
    return value.isoformat(timespec="seconds")


class SessionStore:
    def __init__(self, database: Path = DATABASE) -> None:
        self.database = database
        self.database.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.database)) as connection:
            with connection:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS session (
                        id INTEGER PRIMARY KEY CHECK (id = 1),
                        notes TEXT NOT NULL,
                        prompts_json TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        expires_at TEXT NOT NULL
                    )
                    """
                )
                self._remove_expired(connection)

    def _remove_expired(self, connection: sqlite3.Connection) -> None:
        connection.execute(
            "DELETE FROM session WHERE expires_at <= ?", (timestamp(utc_now()),)
        )

    def get(self) -> dict[str, Any] | None:
        with closing(sqlite3.connect(self.database)) as connection:
            with connection:
                self._remove_expired(connection)
                row = connection.execute(
                    """
                    SELECT notes, prompts_json, created_at, updated_at, expires_at
                    FROM session WHERE id = 1
                    """
                ).fetchone()
        if row is None:
            return None
        return {
            "notes": row[0],
            "prompts": json.loads(row[1]),
            "created_at": row[2],
            "updated_at": row[3],
            "expires_at": row[4],
        }

    def save(self, payload: Any) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")

        notes = payload.get("notes", "")
        prompts = payload.get("prompts")
        if not isinstance(notes, str) or len(notes) > MAX_NOTES_LENGTH:
            raise ValueError(f"Notes must be text of at most {MAX_NOTES_LENGTH} characters.")
        if not isinstance(prompts, list) or len(prompts) > MAX_PROMPTS:
            raise ValueError(f"Prompts must be a list of at most {MAX_PROMPTS} items.")

        clean_prompts = []
        for prompt in prompts:
            if not isinstance(prompt, dict):
                raise ValueError("Each prompt must be an object.")
            prompt_type = prompt.get("type")
            text = prompt.get("text")
            if not isinstance(prompt_type, str) or prompt_type not in {"question", "media"}:
                raise ValueError("Prompt type must be 'question' or 'media'.")
            if not isinstance(text, str) or not text.strip() or len(text) > MAX_PROMPT_LENGTH:
                raise ValueError(
                    f"Prompt text must be non-empty and at most {MAX_PROMPT_LENGTH} characters."
                )
            clean_prompts.append({"type": prompt_type, "text": text.strip()})

        now = utc_now()
        now_text = timestamp(now)
        expires_text = timestamp(now + timedelta(days=RETENTION_DAYS))
        with closing(sqlite3.connect(self.database)) as connection:
            with connection:
                self._remove_expired(connection)
                connection.execute(
                    """
                    INSERT INTO session (id, notes, prompts_json, created_at, updated_at, expires_at)
                    VALUES (1, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        notes = excluded.notes,
                        prompts_json = excluded.prompts_json,
                        updated_at = excluded.updated_at
                    """,
                    (notes, json.dumps(clean_prompts), now_text, now_text, expires_text),
                )
        session = self.get()
        if session is None:
            raise RuntimeError("Saved session could not be read back.")
        return session

    def delete(self) -> bool:
        with closing(sqlite3.connect(self.database)) as connection:
            with connection:
                cursor = connection.execute("DELETE FROM session WHERE id = 1")
        return cursor.rowcount > 0


def make_handler(store: SessionStore) -> type[SimpleHTTPRequestHandler]:
    class RequestHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def _send_json(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _read_json(self) -> Any:
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError as error:
                raise ValueError("Content-Length must be a number.") from error
            if length <= 0:
                raise ValueError("Request body is required.")
            if length > MAX_REQUEST_BYTES:
                raise OverflowError("Request body is too large.")
            if self.headers.get_content_type() != "application/json":
                raise ValueError("Content-Type must be application/json.")
            try:
                return json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError) as error:
                raise ValueError("Request body must contain valid JSON.") from error

        def do_GET(self) -> None:
            path = urlsplit(self.path).path
            if path == "/api/health":
                self._send_json(200, {"ok": True})
            elif path == "/api/session":
                self._send_json(200, {"session": store.get()})
            elif path.startswith("/api/"):
                self._send_json(404, {"error": "API route not found."})
            else:
                super().do_GET()

        def do_PUT(self) -> None:
            if urlsplit(self.path).path != "/api/session":
                self._send_json(404, {"error": "API route not found."})
                return
            try:
                session = store.save(self._read_json())
            except OverflowError as error:
                self._send_json(413, {"error": str(error)})
                return
            except ValueError as error:
                self._send_json(400, {"error": str(error)})
                return
            self._send_json(200, {"session": session})

        def do_DELETE(self) -> None:
            if urlsplit(self.path).path != "/api/session":
                self._send_json(404, {"error": "API route not found."})
                return
            self._send_json(200, {"deleted": store.delete()})

        def log_message(self, format: str, *args: Any) -> None:
            print(f"{self.log_date_time_string()} {format % args}")

    return RequestHandler


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local Signal Session app.")
    parser.add_argument("--port", type=int, default=8000, help="Local port (default: 8000).")
    args = parser.parse_args()

    store = SessionStore()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(store))
    print(f"Signal Session is running at http://127.0.0.1:{args.port}")
    print(f"Session data is stored in {store.database} and expires after {RETENTION_DAYS} days.")
    print("Press Ctrl+C to stop the server.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Signal Session.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
