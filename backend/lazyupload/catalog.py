"""SQLite catalog — upload history, dedupe index, and key/value settings.

Mirrors the Backups catalog's shape (single shared connection guarded by a lock,
JSON settings table, lazy migrations) so the two tools feel the same internally.
The `uploads` table doubles as the dedupe index: a row with status 'uploaded' and a
known file_hash means "this exact audio is already on SoundCloud — don't re-post".
"""
import json
import sqlite3
import threading
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_hash TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    sharing TEXT NOT NULL DEFAULT 'public',
    status TEXT NOT NULL,
    sc_track_id INTEGER,
    permalink_url TEXT,
    account TEXT,
    error TEXT,
    timestamp TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

# file_hash backs the dedupe lookup on every scan; timestamp backs history ordering.
_INDEXES = """
CREATE INDEX IF NOT EXISTS idx_uploads_hash ON uploads(file_hash);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);
"""


class Catalog:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False: the connection is shared across FastAPI's
        # threadpool + the upload worker thread; the lock serializes access.
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self.conn.executescript(_SCHEMA)
        self._migrate()
        self.conn.executescript(_INDEXES)
        self.conn.commit()

    def _migrate(self) -> None:
        # Add columns introduced after the first release to pre-existing catalogs.
        cols = {r["name"] for r in self.conn.execute("PRAGMA table_info(uploads)")}
        new = {"account": "TEXT", "sc_track_id": "INTEGER", "permalink_url": "TEXT"}
        for col, typ in new.items():
            if col not in cols:
                self.conn.execute(f"ALTER TABLE uploads ADD COLUMN {col} {typ}")

    # ---- uploads -------------------------------------------------------------
    def record_upload(self, title, file_path, file_hash, size, sharing, status,
                      timestamp, sc_track_id=None, permalink_url=None,
                      account=None, error=None) -> int:
        with self._lock:
            cur = self.conn.execute(
                "INSERT INTO uploads "
                "(title, file_path, file_hash, size, sharing, status, sc_track_id, "
                " permalink_url, account, error, timestamp) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (title, file_path, file_hash, size, sharing, status, sc_track_id,
                 permalink_url, account, error, timestamp),
            )
            self.conn.commit()
            return cur.lastrowid

    def uploaded_hashes(self) -> dict[str, dict]:
        """{file_hash: {permalink_url, title}} for everything successfully published.

        The scanner uses this to flag already-uploaded mixes, and the engine uses it
        to skip re-posting. Keyed on content hash, so a rename never causes a dupe.
        """
        with self._lock:
            rows = self.conn.execute(
                "SELECT file_hash, permalink_url, title FROM uploads "
                "WHERE status = 'uploaded' AND file_hash IS NOT NULL"
            ).fetchall()
        return {r["file_hash"]: {"permalink_url": r["permalink_url"], "title": r["title"]}
                for r in rows}

    def recent_uploads(self, limit=50) -> list[dict]:
        with self._lock:
            rows = self.conn.execute(
                "SELECT * FROM uploads ORDER BY timestamp DESC, id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]

    def get_upload(self, upload_id) -> dict | None:
        with self._lock:
            row = self.conn.execute(
                "SELECT * FROM uploads WHERE id = ?", (upload_id,)
            ).fetchone()
        return dict(row) if row else None

    def upload_by_hash(self, file_hash) -> dict | None:
        """The most recent successful upload of a given content hash (for WIP replace:
        adopt the SoundCloud track already published for this exact render)."""
        if not file_hash:
            return None
        with self._lock:
            row = self.conn.execute(
                "SELECT * FROM uploads WHERE file_hash = ? AND status = 'uploaded' "
                "ORDER BY id DESC LIMIT 1", (file_hash,)
            ).fetchone()
        return dict(row) if row else None

    def totals(self) -> dict:
        with self._lock:
            row = self.conn.execute(
                "SELECT "
                "  COALESCE(SUM(status='uploaded'), 0) AS uploaded_count, "
                "  COALESCE(SUM(status='error'), 0) AS error_count, "
                "  COALESCE(SUM(CASE WHEN status='uploaded' THEN size ELSE 0 END), 0) AS uploaded_bytes "
                "FROM uploads"
            ).fetchone()
        return dict(row)

    # ---- settings (JSON key/value) ------------------------------------------
    def set_setting(self, key, value) -> None:
        with self._lock:
            self.conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )
            self.conn.commit()

    def get_setting(self, key, default=None):
        with self._lock:
            row = self.conn.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            ).fetchone()
        if row is None:
            return default
        return json.loads(row["value"])

    def delete_setting(self, key) -> None:
        with self._lock:
            self.conn.execute("DELETE FROM settings WHERE key = ?", (key,))
            self.conn.commit()

    def close(self):
        with self._lock:
            self.conn.close()
