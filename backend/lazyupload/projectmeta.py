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
import json
import os
import re
import sqlite3
import threading
from pathlib import Path

_RENDER_EXTS = ("wav", "aifc", "aiff", "aif", "mp3", "flac", "m4a", "ogg", "wma", "aac", "opus")


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


# Dates, tempos and keys people put in render names: "2026-10-01 Night Drive",
# "Night Drive 07.10.26", "Night Drive 124bpm Amin", "Sunset (128 BPM) F#m".
_DATES = re.compile(r"\b(?:19|20)\d\d[-_. ]?[01]\d[-_. ]?[0-3]\d\b"
                    r"|\b[0-3]?\d[-_.][01]?\d[-_.](?:19|20)?\d\d\b")
_KEY = r"[a-g](?:#|b|sharp|flat)?\s?(?:maj(?:or)?|min(?:or)?|m)?"
_TEMPO = re.compile(rf"\b\d{{2,3}}\s*bpm\b(?:[\s_-]*{_KEY}\b)?|\bbpm\s*\d{{2,3}}\b"
                    r"|\b[a-g](?:#|b)?\s?(?:maj(?:or)?|min(?:or)?)\s*$|\s[a-g](?:#|b)m\s*$")


def _undecorate(s: str) -> str:
    s = re.sub(rf"\.({'|'.join(_RENDER_EXTS)})$", "", s).replace("_", " ")
    s = re.sub(r"\(autosaved[^)]*\)", " ", s)        # Ableton autosave tag
    s = _DATES.sub(" ", s)
    s = re.sub(r"[\[(]\s*\d{1,4}\s*(bpm)?\s*[\])]", " ", s)  # "(128 bpm)" decorations
    s = _TEMPO.sub(" ", s)
    return _TEMPO.sub(" ", s.strip())


def normalize(name: str) -> str:
    """Reduce a render filename or project name to a comparable key: lowercase, drop
    the audio extension, dates, tempo/key tags and common render/version decorations,
    collapse punctuation. Kept identical to Backups' ``exports.normalize``."""
    s = _undecorate((name or "").lower().strip())
    # trailing render/version markers: " master", " final v2", " mixdown 3", "_2", …
    s = re.sub(r"[\s_-]+(v?\d+|master(ed)?|final|mix(down)?|render|bounce|export|wip|draft)\b",
               " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def _parse_ts(value) -> str | None:
    """Backups snapshot timestamps are a custom 'YYYY-MM-DD_HHMM' string. Convert to
    ISO for the UI; pass anything already ISO-ish (or unrecognised) through unchanged."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})$", s)
    if m:
        y, mo, d, h, mi = m.groups()
        return f"{y}-{mo}-{d}T{h}:{mi}:00"
    return s


def _load_snapshot_aggregates(con) -> tuple[dict, dict]:
    """Per-project backup/version history aggregated from the snapshots table, keyed by
    project_id (preferred) and by project_name (fallback). Best-effort: a missing/older
    snapshots table just yields empty maps, leaving discovered enrichment intact."""
    by_id: dict[str, dict] = {}
    by_name: dict[str, dict] = {}
    sql = (
        "SELECT project_id, project_name, COUNT(*) AS n, MIN(timestamp), MAX(timestamp), "
        "SUM(total_size), MAX(file_count), MAX(verified), MAX(verified_at), MAX(status) "
        "FROM snapshots GROUP BY project_id, project_name"
    )
    try:
        rows = con.execute(sql).fetchall()
    except sqlite3.Error:
        return {}, {}
    for pid, pname, n, first, last, archived, fcount, verified, verified_at, status in rows:
        agg = {
            "count": int(n or 0),
            "first_backup": _parse_ts(first),
            "last_backup": _parse_ts(last),
            "archived_bytes": int(archived) if archived is not None else None,
            "file_count": int(fcount) if fcount is not None else None,
            "verified": bool(verified),
            "verified_at": _parse_ts(verified_at),
            "status": status or None,
        }
        if pid:
            by_id[str(pid)] = agg
        if pname:
            # if two ids share a name, prefer the one with more backups for the fallback
            cur = by_name.get(pname)
            if cur is None or agg["count"] >= cur["count"]:
                by_name[pname] = agg
    return by_id, by_name


def _load_full(con) -> list[dict]:
    """One rich meta dict per discovered project, fault-isolated: try the full row, fall
    back to the minimal columns if a newer/older Backups schema lacks some."""
    cols = ("project_id", "name", "daw", "owner", "bpm", "genre", "genre_emoji",
            "tracks", "plugins", "missing_count", "size", "mtime")
    rows = None
    try:  # Backups 0.1.10+ also records whether the producer set the genre
        rows = con.execute(
            "SELECT project_id, name, daw, owner, bpm, genre, genre_emoji, tracks, "
            "plugins, missing_count, size, mtime, genre_by_you FROM discovered").fetchall()
        cols = (*cols, "genre_by_you")
    except sqlite3.Error:
        try:
            rows = con.execute(
                "SELECT project_id, name, daw, owner, bpm, genre, genre_emoji, tracks, "
                "plugins, missing_count, size, mtime FROM discovered").fetchall()
        except sqlite3.Error:
            rows = None
    if rows is None:
        try:  # degrade to just the essentials so BPM/genre still flow
            rows = con.execute("SELECT name, bpm, genre, genre_emoji FROM discovered").fetchall()
            cols = ("name", "bpm", "genre", "genre_emoji")
        except sqlite3.Error:
            return []
    out: list[dict] = []
    for row in rows:
        r = dict(zip(cols, row))
        plugins: list[str] = []
        raw = r.get("plugins")
        if raw:
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    plugins = [str(p) for p in parsed]
            except (ValueError, TypeError):
                plugins = []
        out.append({
            "project": r.get("name"),
            "project_id": str(r["project_id"]) if r.get("project_id") else None,
            "bpm": r.get("bpm"),
            "genre": r.get("genre"),
            "genre_emoji": r.get("genre_emoji"),
            "genre_by_you": bool(r.get("genre_by_you")),
            "daw": r.get("daw"),
            "track_count": r.get("tracks"),
            "plugins": plugins,
            "plugin_count": len(plugins),
            "missing_count": r.get("missing_count"),
            "project_size": r.get("size"),
            "project_mtime": r.get("mtime"),
            "backups": None,
        })
    return out


def _load_exports(con) -> dict[str, str]:
    """{resolved export path: project_id} from Backups' exports table — the songs
    Backups has linked to their projects (project folder, exports folders, or a
    manual link by the user). Exact, so it beats any name guess. Older Backups
    catalogs have no such table: empty map."""
    try:
        rows = con.execute(
            "SELECT path, project_id FROM exports WHERE hidden = 0 "
            "ORDER BY CASE match WHEN 'manual' THEN 0 WHEN 'folder' THEN 1 ELSE 2 END DESC"
        ).fetchall()
    except sqlite3.Error:
        return {}
    # DESC on the rank => manual rows are written last and win a path shared by two projects
    return {str(path): str(pid) for path, pid in rows if path and pid}


def _load_renamed(con) -> list[dict]:
    """Backups' "Tidy names" record: old -> new for every song file, project folder and
    project id it renamed, oldest first, so a song posted before a rename stays tied
    to its file and project. Older Backups catalogs have no such table: empty."""
    try:
        rows = con.execute("SELECT old, new, kind, batch_id FROM renamed ORDER BY at, rowid").fetchall()
    except sqlite3.Error:
        return []
    return [{"old": o, "new": n, "kind": k, "batch_id": b} for o, n, k, b in rows]


def follow_with(rows: list[dict]):
    """Follow renames batch by batch, oldest first; within one rename each name moves
    once ("v2" -> "v1" alongside "FINAL 3" -> "v2" doesn't chain). Kept identical to
    Backups' ``tidy.follow_with``."""
    batches: list[tuple[dict, list]] = []
    current = None
    for r in rows:
        if current is None or r.get("batch_id") != current:
            current = r.get("batch_id")
            batches.append(({}, []))
        names, folders = batches[-1]
        if r["kind"] == "folder":
            folders.append((r["old"], r["new"]))
        else:
            names[r["old"]] = r["new"]

    def follow(p: str) -> str:
        if not p:
            return p
        for names, folders in batches:
            if p in names:
                p = names[p]
                continue
            for o, n in folders:
                if p.startswith(o + os.sep):
                    p = n + p[len(o):]
                    break
        return p

    return follow


def _norm_path(path) -> str:
    try:
        return str(Path(path).resolve())
    except (OSError, TypeError, ValueError):
        return str(path)


# cache: re-read only when the catalog file changes. Guarded by a lock because the Manage
# join calls lookup_meta from the FastAPI threadpool, not just the single scan thread.
_cache: dict = {"path": None, "mtime": None, "by_name": {}, "by_id": {}, "ambiguous": set(),
                "by_path": {}, "renamed": []}
_cache_lock = threading.Lock()


def _load_map(db: Path) -> dict:
    """Build {by_name, by_id, ambiguous}. by_name maps a normalized key to a rich meta
    dict (back-compat for the scan flow); ambiguous holds keys that >1 distinct project
    normalizes to, so Manage can refuse to assert a guessed match. by_id is the
    collision-proof lookup for hash-anchored joins."""
    empty = {"by_name": {}, "by_id": {}, "ambiguous": set(), "by_path": {}, "renamed": []}
    uri = f"file:{db}?mode=ro&immutable=1"
    try:
        con = sqlite3.connect(uri, uri=True, timeout=2)
    except sqlite3.Error:
        return empty
    try:
        projects = _load_full(con)
        snap_by_id, snap_by_name = _load_snapshot_aggregates(con)
        by_path = _load_exports(con)
        renamed = _load_renamed(con)
    finally:
        con.close()

    by_name: dict[str, dict] = {}
    by_id: dict[str, dict] = {}
    ambiguous: set[str] = set()
    for meta in projects:
        # attach version history (project_id preferred, then name)
        meta["backups"] = (snap_by_id.get(meta["project_id"]) if meta["project_id"] else None) \
            or snap_by_name.get(meta["project"])
        if meta["project_id"]:
            by_id[meta["project_id"]] = meta
        key = normalize(meta["project"] or "")
        if not key:
            continue
        prev = by_name.get(key)
        if prev is None:
            by_name[key] = meta
        else:
            # a second distinct project sharing this key => ambiguous; keep the genre-bearing
            # one for the lenient scan-flow lookup, but Manage will treat it as no-match.
            if (prev.get("project_id") != meta.get("project_id")
                    or prev.get("project") != meta.get("project")):
                ambiguous.add(key)
            if not prev.get("genre") and meta.get("genre"):
                by_name[key] = meta
    return {"by_name": by_name, "by_id": by_id, "ambiguous": ambiguous, "by_path": by_path,
            "renamed": renamed}


def _maps() -> dict:
    empty = {"by_name": {}, "by_id": {}, "ambiguous": set(), "by_path": {}, "renamed": []}
    db = find_backups_db()
    if not db:
        return empty
    try:
        mtime = db.stat().st_mtime
    except OSError:
        return empty
    with _cache_lock:
        if _cache["path"] != str(db) or _cache["mtime"] != mtime:
            loaded = _load_map(db)
            _cache.update(path=str(db), mtime=mtime, **loaded)
        return {"by_name": _cache["by_name"], "by_id": _cache["by_id"],
                "ambiguous": _cache["ambiguous"], "by_path": _cache["by_path"],
                "renamed": _cache["renamed"]}


def current_path(path) -> str | None:
    """Where a song file is now, if Backups' "Tidy names" renamed it (or its folder)
    since; the path itself otherwise."""
    if not path:
        return path
    try:
        rows = [r for r in _maps()["renamed"] if r["kind"] in ("file", "folder")]
    except Exception:
        return path
    if not rows:
        return path
    follow = follow_with(rows)
    now = follow(str(path))
    if now == str(path):
        now = follow(_norm_path(path))
        if now == _norm_path(path):
            return path
    return now


def current_id(project_id):
    """A Backups project id as it is now (an id comes from where the project file is,
    so renaming the file gives it a new one)."""
    if not project_id:
        return project_id
    try:
        rows = [r for r in _maps()["renamed"] if r["kind"] == "project"]
    except Exception:
        return project_id
    return follow_with(rows)(str(project_id)) if rows else project_id


def _meta_map() -> dict:
    """Back-compat: the lenient name->meta map used by the scan/Upload flow."""
    return _maps()["by_name"]


def lookup(name: str) -> dict | None:
    """Lenient name match (scan/Upload flow) — may return a first-writer match even on a
    name collision; that's acceptable for editable Upload prefill."""
    return _meta_map().get(normalize(name))


def lookup_meta(name: str) -> dict | None:
    """Strict name match for Manage: returns the rich meta only when the normalized name
    maps to exactly ONE project. On a collision (ambiguous key) returns None rather than
    assert a guessed project's BPM/genre."""
    maps = _maps()
    key = normalize(name)
    if not key or key in maps["ambiguous"]:
        return None
    return maps["by_name"].get(key)


def lookup_meta_by_id(project_id: str) -> dict | None:
    """Collision-proof lookup by the Backups project_id (used when a track is hash-anchored
    to a project we persisted at upload time)."""
    if not project_id:
        return None
    return _maps()["by_id"].get(str(current_id(project_id)))


def lookup_by_path(path) -> dict | None:
    """The project Backups linked this exact audio file to, if any. This is the
    collision-proof link between the apps: Backups decides which project a render
    came from (it knows the project folders and the user's corrections), Uploader
    just reads it."""
    if not path:
        return None
    maps = _maps()
    path = current_path(path)  # a song renamed by Backups' "Tidy names" since
    pid = maps["by_path"].get(_norm_path(path)) or maps["by_path"].get(str(path))
    return maps["by_id"].get(pid) if pid else None


def resolve(path, name: str) -> dict | None:
    """Best project for a render: Backups' exact file link, else a strict name match
    (by the file's current name, if Backups renamed it)."""
    now = current_path(path)
    if now and now != path:
        name = Path(now).stem
    return lookup_by_path(path) or lookup_meta(name)


def annotate(mixes: list[dict]) -> int:
    """In-place: attach bpm / genre / genre_emoji / project_match to each mix that
    matches a Backups project by name. Returns how many matched. Best-effort — any
    failure (no Backups install, locked DB, schema drift) leaves mixes untouched."""
    try:
        maps = _maps()
    except Exception:
        return 0
    table = maps["by_name"]
    if not table and not maps["by_path"]:
        return 0
    matched = 0
    for mix in mixes:
        pid = maps["by_path"].get(_norm_path(mix["path"])) if mix.get("path") else None
        hit = (maps["by_id"].get(pid) if pid else None) or table.get(normalize(mix.get("name", "")))
        if not hit:
            continue
        if hit.get("bpm") is not None:
            mix["bpm"] = round(float(hit["bpm"]))
        if hit.get("genre"):
            mix["genre"] = hit["genre"]
        if hit.get("genre_emoji"):
            mix["genre_emoji"] = hit["genre_emoji"]
        mix["genre_project"] = hit.get("genre")       # the project's genre in Backups
        mix["genre_by_you"] = bool(hit.get("genre_by_you"))
        mix["project_match"] = hit.get("project")
        mix["project_id"] = hit.get("project_id")
        mix["project_link"] = "exact" if pid and maps["by_id"].get(pid) is hit else "name"
        matched += 1
    return matched
