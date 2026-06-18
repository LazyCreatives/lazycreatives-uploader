"""Read-only bridge to the sibling **Backups** tool's catalog.

Backups parses real BPM + genre out of DAW project files (.als/.flp/.rpp/…) and
stores them keyed by project name. This module matches a rendered mix to its
project *by normalized name* and borrows that authoritative metadata — no audio
analysis, no tag-reading. It opens the Backups SQLite catalog **read-only** and
never writes to it; if Backups isn't installed it silently no-ops.

Resolution order for the Backups catalog:
  1. LAZYUP_BACKUPS_DB env var (explicit override), then
  2. the per-OS default Electron userData location.
Results are cached and refreshed only when the catalog's mtime changes.
"""
import os
import re
import sqlite3
from pathlib import Path

_RENDER_EXTS = ("wav", "aif", "aiff", "mp3", "flac", "m4a", "ogg", "wma")


def _candidate_db_paths() -> list[Path]:
    out: list[Path] = []
    env = os.environ.get("LAZYUP_BACKUPS_DB")
    if env:
        out.append(Path(env))
    home = Path.home()
    # macOS (Electron userData)
    out.append(home / "Library/Application Support/LazyCreatives Backups/catalog.db")
    out.append(home / "Library/Application Support/ableton-backup-app/catalog.db")
    # Windows
    appdata = os.environ.get("APPDATA")
    local = os.environ.get("LOCALAPPDATA")
    if appdata:
        out.append(Path(appdata) / "LazyCreatives Backups" / "catalog.db")
    if local:
        out.append(Path(local) / "ablebackup" / "catalog.db")
    # Linux
    out.append(home / ".config/LazyCreatives Backups/catalog.db")
    return out


def find_backups_db() -> Path | None:
    for p in _candidate_db_paths():
        try:
            if p and p.is_file():
                return p
        except OSError:
            continue
    return None


def normalize(name: str) -> str:
    """Reduce a render filename or project name to a comparable key: lowercase, drop
    the audio extension and common render/version decorations, collapse punctuation."""
    s = (name or "").lower().strip()
    s = re.sub(rf"\.({'|'.join(_RENDER_EXTS)})$", "", s)
    s = re.sub(r"\(autosaved[^)]*\)", " ", s)          # Ableton autosave tag
    s = re.sub(r"[\[(]\s*\d{1,4}\s*(bpm)?\s*[\])]", " ", s)  # "(128 bpm)" decorations
    # trailing render/version markers: " master", " final v2", " mixdown 3", "_2", …
    s = re.sub(r"[\s_-]+(v?\d+|master(ed)?|final|mix(down)?|render|bounce|export|wip|draft)\b",
               " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


# cache: re-read only when the catalog file changes
_cache: dict = {"path": None, "mtime": None, "map": {}}


def _load_map(db: Path) -> dict:
    """name-key -> {project, bpm, genre, genre_emoji}. Prefers rows that carry genre."""
    out: dict[str, dict] = {}

    def absorb(rows):
        for row in rows:
            name = row[0]
            key = normalize(name)
            if not key:
                continue
            meta = {"project": name, "bpm": row[1], "genre": row[2],
                    "genre_emoji": row[3] if len(row) > 3 else None}
            prev = out.get(key)
            # first writer wins, unless it lacked a genre and this row has one
            if prev is None or (not prev.get("genre") and meta.get("genre")):
                out[key] = meta

    uri = f"file:{db}?mode=ro&immutable=1"
    try:
        con = sqlite3.connect(uri, uri=True, timeout=2)
    except sqlite3.Error:
        return {}
    try:
        for sql in (
            "SELECT name, bpm, genre, genre_emoji FROM discovered",
            "SELECT project_name, bpm, genre, genre_emoji FROM snapshots "
            "WHERE bpm IS NOT NULL OR genre IS NOT NULL",
        ):
            try:
                absorb(con.execute(sql).fetchall())
            except sqlite3.Error:
                continue  # table/column absent in this Backups version
    finally:
        con.close()
    return out


def _meta_map() -> dict:
    db = find_backups_db()
    if not db:
        return {}
    try:
        mtime = db.stat().st_mtime
    except OSError:
        return {}
    if _cache["path"] != str(db) or _cache["mtime"] != mtime:
        _cache.update(path=str(db), mtime=mtime, map=_load_map(db))
    return _cache["map"]


def lookup(name: str) -> dict | None:
    """Matched {project, bpm, genre, genre_emoji} for a mix name, or None."""
    table = _meta_map()
    return table.get(normalize(name)) if table else None


def annotate(mixes: list[dict]) -> int:
    """In-place: attach bpm / genre / genre_emoji / project_match to each mix that
    matches a Backups project by name. Returns how many matched. Best-effort — any
    failure (no Backups install, locked DB, schema drift) leaves mixes untouched."""
    try:
        table = _meta_map()
    except Exception:
        return 0
    if not table:
        return 0
    matched = 0
    for mix in mixes:
        hit = table.get(normalize(mix.get("name", "")))
        if not hit:
            continue
        if hit.get("bpm") is not None:
            mix["bpm"] = round(float(hit["bpm"]))
        if hit.get("genre"):
            mix["genre"] = hit["genre"]
        if hit.get("genre_emoji"):
            mix["genre_emoji"] = hit["genre_emoji"]
        mix["project_match"] = hit.get("project")
        matched += 1
    return matched
