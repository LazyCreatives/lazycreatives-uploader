"""Orchestration layer: scanning with dedupe, the upload engine, the connected
account, and the dashboard overview. The API and CLI call into here; this module
holds no FastAPI/HTTP concerns so it's trivially unit-testable.
"""
import json
import re
import tempfile
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from lazyupload import coverart, crypto, projectmeta, seo, soundcloud
from lazyupload.catalog import Catalog
from lazyupload.hashing import hash_file
from lazyupload.models import TrackMeta, UploadResult
from lazyupload.scanner import discover

# Module-level "is an upload running" flag so a scheduled tick can stand down while a
# manual upload is in flight (mirrors the Backups scheduler's guard).
_upload_lock = threading.Lock()
_uploading = False

_LEGACY_ACCOUNT_KEY = "sc_account"  # single-account storage from before multi-account
_ACCOUNTS_KEY = "sc_accounts"       # list of stored, encrypted account entries
_ACTIVE_KEY = "sc_active"           # id of the currently active account
_HASH_CACHE_KEY = "hash_cache"      # {path: {size, mtime, hash}} so scans don't re-hash


def default_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def upload_in_progress() -> bool:
    return _uploading


# ---- connected accounts (encrypted, multi-account) --------------------------
# Each account is a full token dict plus an "id". On disk it's an entry of the form
# {"id", "username", "mock", "enc"} where `enc` is the DPAPI-encrypted token JSON;
# id/username/mock are kept in clear for listing without decrypting every account.
def _migrate_legacy(catalog: Catalog) -> None:
    """One-time: fold a pre-multi-account `sc_account` into the new list."""
    legacy = catalog.get_setting(_LEGACY_ACCOUNT_KEY)
    if legacy and not catalog.get_setting(_ACCOUNTS_KEY):
        acct = dict(legacy)
        acct.setdefault("id", uuid.uuid4().hex)
        _write_accounts(catalog, [acct])
        catalog.set_setting(_ACTIVE_KEY, acct["id"])
    if legacy is not None:
        catalog.delete_setting(_LEGACY_ACCOUNT_KEY)


def _write_accounts(catalog: Catalog, accts: list[dict]) -> None:
    stored = [{"id": a["id"], "username": a.get("username"), "mock": a.get("mock", False),
               "enc": crypto.encrypt(json.dumps(a))} for a in accts]
    catalog.set_setting(_ACCOUNTS_KEY, stored)


def get_accounts(catalog: Catalog) -> list[dict]:
    """All connected accounts as full (decrypted) dicts, newest last."""
    _migrate_legacy(catalog)
    out = []
    for s in catalog.get_setting(_ACCOUNTS_KEY) or []:
        try:
            out.append(json.loads(crypto.decrypt(s["enc"])))
        except Exception:
            continue  # unreadable (e.g. DPAPI blob from another user) — skip it
    return out


def active_account(catalog: Catalog) -> dict | None:
    accts = get_accounts(catalog)
    if not accts:
        return None
    aid = catalog.get_setting(_ACTIVE_KEY)
    return next((a for a in accts if a.get("id") == aid), accts[0])


def add_account(catalog: Catalog, tokens: dict, allow_multiple: bool = False) -> dict:
    """Add (or, on Free, replace) a connected account and make it active. Reconnecting
    the same SoundCloud user updates that account rather than duplicating it."""
    acct = dict(tokens)
    acct["id"] = uuid.uuid4().hex
    accts = get_accounts(catalog) if allow_multiple else []
    uid = acct.get("user_id")
    if uid is not None:
        accts = [a for a in accts if a.get("user_id") != uid]  # dedupe same SC user
    accts.append(acct)
    _write_accounts(catalog, accts)
    catalog.set_setting(_ACTIVE_KEY, acct["id"])
    return acct


def set_active(catalog: Catalog, account_id: str) -> bool:
    if any(a.get("id") == account_id for a in get_accounts(catalog)):
        catalog.set_setting(_ACTIVE_KEY, account_id)
        return True
    return False


def remove_account(catalog: Catalog, account_id: str | None = None) -> None:
    accts = get_accounts(catalog)
    target = account_id or (active_account(catalog) or {}).get("id")
    remaining = [a for a in accts if a.get("id") != target]
    _write_accounts(catalog, remaining)
    if catalog.get_setting(_ACTIVE_KEY) == target:
        catalog.set_setting(_ACTIVE_KEY, remaining[0]["id"] if remaining else None)


def _update_active_tokens(catalog: Catalog, new_tokens: dict) -> None:
    """Persist refreshed tokens back onto the active account (refresh tokens rotate)."""
    accts = get_accounts(catalog)
    aid = (active_account(catalog) or {}).get("id")
    for a in accts:
        if a.get("id") == aid:
            a.update(new_tokens)
            a["id"] = aid
    _write_accounts(catalog, accts)


# Back-compat single-account helpers (used by the CLI and tests).
def get_account(catalog: Catalog) -> dict | None:
    return active_account(catalog)


def save_account(catalog: Catalog, tokens: dict) -> None:
    add_account(catalog, tokens, allow_multiple=False)


def clear_account(catalog: Catalog) -> None:
    catalog.set_setting(_ACCOUNTS_KEY, [])
    catalog.set_setting(_ACTIVE_KEY, None)


def connected(catalog: Catalog) -> bool:
    acct = active_account(catalog) or {}
    if soundcloud.use_mock():
        return bool(acct)  # mock still requires an explicit connect
    return bool(acct.get("access_token"))


def account_label(catalog: Catalog) -> str | None:
    acct = active_account(catalog) or {}
    return acct.get("username") or acct.get("permalink") or None


def account_avatar(catalog: Catalog) -> str | None:
    """The active account's SoundCloud avatar URL. Self-heals accounts connected before
    avatars were captured by fetching me() once and persisting it (no reconnect needed)."""
    acct = active_account(catalog)
    if not acct:
        return None
    av = acct.get("avatar_url")
    if av or soundcloud.use_mock():
        return av
    try:
        av = client_for(catalog).me().get("avatar_url")
        if av:
            _update_active_tokens(catalog, {"avatar_url": av})
        return av
    except Exception:
        return None


def accounts_public(catalog: Catalog) -> list[dict]:
    """Account list for the UI — no tokens, just id/username/avatar/active flag."""
    aid = (active_account(catalog) or {}).get("id")
    return [{"id": a.get("id"), "username": a.get("username") or "SoundCloud",
             "avatar_url": a.get("avatar_url"),
             "mock": a.get("mock", False), "active": a.get("id") == aid}
            for a in get_accounts(catalog)]


class _MockStore:
    """Catalog-backed persistence for the mock client's managed library, so demo
    uploads + edits survive restarts. Ignored entirely by the real client."""
    _KEY = "mock_library"

    def __init__(self, catalog: Catalog):
        self._catalog = catalog

    def load(self):
        return self._catalog.get_setting(self._KEY)  # None => client seeds demo tracks

    def save(self, lib):
        self._catalog.set_setting(self._KEY, lib)


def client_for(catalog: Catalog):
    """A SoundCloud client bound to the stored account, persisting refreshed tokens.

    Refresh tokens are single-use, so the on_tokens callback re-saves the account
    every time the access token is renewed."""
    tokens = active_account(catalog) or {}

    def on_tokens(new: dict):
        _update_active_tokens(catalog, new)

    return soundcloud.get_client(tokens, on_tokens, store=_MockStore(catalog))


# ---- manage existing uploads ------------------------------------------------
def _apply_project_meta(track: dict, meta: dict) -> None:
    """Map a projectmeta rich object onto a managed track (the /api/tracks contract)."""
    bpm = meta.get("bpm")
    track["bpm"] = round(float(bpm)) if bpm is not None else None
    track["genre_emoji"] = meta.get("genre_emoji")
    track["daw"] = meta.get("daw")
    track["project_match"] = meta.get("project")
    track["plugin_count"] = meta.get("plugin_count")
    track["track_count"] = meta.get("track_count")
    track["missing_count"] = meta.get("missing_count")
    track["project_size"] = meta.get("project_size")
    track["project_mtime"] = meta.get("project_mtime")
    track["backups"] = meta.get("backups")
    # Only borrow Backups genre when SoundCloud has none — the live SC genre is authoritative.
    if not track.get("genre") and meta.get("genre"):
        track["genre"] = meta["genre"]


def _project_meta_for(catalog: Catalog, track: dict, upload_map: dict | None = None) -> dict | None:
    """Resolve the Backups project for a managed SoundCloud track, in order of trust:
      (a) sc_track_id -> local upload row -> persisted backups_project_id  (collision-proof)
      (b) that row's file_path stem  (hash-anchored to the file, strict name match)
      (c) the SoundCloud title, strict — None on any name collision, so we never guess.
    `upload_map` (sc_track_id -> row) lets the list pass avoid a DB query per track."""
    try:
        rec = upload_map.get(track.get("id")) if upload_map is not None \
            else catalog.upload_by_track_id(track.get("id"))
        if rec:
            if rec.get("backups_project_id"):
                meta = projectmeta.lookup_meta_by_id(rec["backups_project_id"])
                if meta:
                    return meta
            if rec.get("file_path"):
                meta = projectmeta.lookup_meta(Path(rec["file_path"]).stem)
                if meta:
                    return meta
        return projectmeta.lookup_meta(strip_wip_tag(track.get("title") or ""))
    except Exception:
        return None


def _enrich_track(catalog: Catalog, t: dict, upload_map: dict | None = None) -> None:
    """Attach the SEO score and borrowed Backups metadata to ONE managed track. Best-effort
    and independent: a failure (or a missing Backups catalog) never strips the SEO score."""
    meta = _project_meta_for(catalog, t, upload_map)
    # SEO reflects the LIVE SoundCloud metadata — score before borrowing display genre.
    try:
        t["seo"] = seo.score_track(t, meta)
    except Exception:
        pass
    if meta:
        try:
            _apply_project_meta(t, meta)
        except Exception:
            pass


def _enrich_tracks(catalog: Catalog, tracks: list[dict]) -> None:
    upload_map = catalog.uploads_by_sc_track_id()  # one query for the whole list
    for t in tracks:
        _enrich_track(catalog, t, upload_map)


# Formats SoundCloud stores losslessly — preferred over lossy copies of the same title.
_LOSSLESS_FORMATS = {"wav", "wave", "aif", "aiff", "flac", "alac"}


def _dupe_key(title: str) -> str:
    return re.sub(r"\s+", " ", strip_wip_tag(title or "").strip().lower())


def _track_quality(t: dict) -> tuple:
    """Rank within a duplicate group: lossless beats lossy, then larger original, then longer."""
    fmt = (t.get("original_format") or "").lower()
    lossless = 1 if fmt in _LOSSLESS_FORMATS else 0
    return (lossless, t.get("original_content_size") or 0, t.get("duration") or 0)


def _mark_track_dupes(tracks: list[dict]) -> None:
    """Flag tracks that share a title (e.g. the same release uploaded as FLAC + MP3). Each
    member gets dupe_group (the keeper's track id), dupe_count, and dupe_keeper, so Manage
    can group them and offer to delete the lower-quality copies."""
    groups: dict[str, list[dict]] = {}
    for t in tracks:
        k = _dupe_key(t.get("title", ""))
        if k:
            groups.setdefault(k, []).append(t)
    for members in groups.values():
        if len(members) < 2:
            continue
        best = max(members, key=_track_quality)
        for t in members:
            t["dupe_group"] = best.get("id")
            t["dupe_count"] = len(members)
            t["dupe_keeper"] = t is best


def list_tracks(catalog: Catalog) -> list[dict]:
    if not connected(catalog):
        raise RuntimeError("not_connected")
    tracks = client_for(catalog).list_tracks()
    _enrich_tracks(catalog, tracks)
    _mark_track_dupes(tracks)
    return tracks


def update_track(catalog: Catalog, track_id: int, fields: dict) -> dict:
    if not connected(catalog):
        raise RuntimeError("not_connected")
    # Return the fully-enriched track (re-scored SEO + Backups chips) so the Manage UI keeps
    # its chips and shows the freshly-recomputed score without needing a full refresh.
    updated = client_for(catalog).update_track(track_id, fields)
    _enrich_track(catalog, updated)
    return updated


def delete_track(catalog: Catalog, track_id: int) -> None:
    if not connected(catalog):
        raise RuntimeError("not_connected")
    client_for(catalog).delete_track(track_id)


# ---- bulk track operations (Pro) --------------------------------------------
_BULK_FLOOR_DELAY = 0.2   # seconds between sequential SoundCloud writes
_BULK_MAX_BACKOFF = 30.0  # cap on a 429 Retry-After wait


def _retry_delay(retry_after) -> float:
    try:
        return min(float(retry_after), _BULK_MAX_BACKOFF) if retry_after else 2.0
    except (ValueError, TypeError):
        return 2.0


def _bulk(catalog: Catalog, ids: list[int], op) -> list[dict]:
    """Run a per-track SoundCloud write across `ids` sequentially (SC has no batch
    endpoint), returning a per-item ledger [{id, ok, error, track?}]. When `op` returns an
    enriched track dict it's attached as `track` so the UI can splice the fresh row (keeping
    SEO/cover/backups current without a full refetch). Honors 429 Retry-After with one
    backoff+retry, and HARD-STOPS on an auth error (the account is unauthorized, so
    continuing is pointless and risky for a destructive bulk op)."""
    client = client_for(catalog)
    throttle = not getattr(client, "is_mock", False)
    results: list[dict] = []

    def _ok(tid, res):
        item = {"id": tid, "ok": True, "error": None}
        if isinstance(res, dict):
            item["track"] = res
        results.append(item)

    for i, tid in enumerate(ids):
        try:
            _ok(tid, op(client, tid))
        except soundcloud.AuthError as e:
            results.append({"id": tid, "ok": False, "error": str(e)})
            for rest in ids[i + 1:]:
                results.append({"id": rest, "ok": False,
                                "error": "stopped — account needs reconnecting"})
            break
        except soundcloud.RateLimitError as e:
            time.sleep(_retry_delay(e.retry_after))
            try:
                _ok(tid, op(client, tid))
            except Exception as e2:
                results.append({"id": tid, "ok": False, "error": str(e2)[:300]})
        except Exception as e:
            results.append({"id": tid, "ok": False, "error": str(e)[:300]})
        if throttle and i < len(ids) - 1:
            time.sleep(_BULK_FLOOR_DELAY)
    return results


def bulk_update(catalog: Catalog, ids: list[int], patch: dict) -> list[dict]:
    if not connected(catalog):
        raise RuntimeError("not_connected")

    def op(c, tid):  # return the enriched track so SEO/badges refresh client-side
        updated = c.update_track(tid, patch)
        _enrich_track(catalog, updated)
        return updated
    return _bulk(catalog, ids, op)


def bulk_delete(catalog: Catalog, ids: list[int]) -> list[dict]:
    if not connected(catalog):
        raise RuntimeError("not_connected")
    return _bulk(catalog, ids, lambda c, tid: c.delete_track(tid))


def set_artwork(catalog: Catalog, track_id: int, image_path: str) -> dict:
    """Set one track's cover art; returns the fully-enriched track for the UI."""
    if not connected(catalog):
        raise RuntimeError("not_connected")
    updated = client_for(catalog).set_artwork(track_id, image_path)
    _enrich_track(catalog, updated)
    return updated


def bulk_set_artwork(catalog: Catalog, ids: list[int], image_path: str) -> list[dict]:
    """Apply one cover image across many tracks (Pro), with the same rate-limit-aware
    fan-out + per-item ledger as the other bulk ops."""
    if not connected(catalog):
        raise RuntimeError("not_connected")

    def op(c, tid):
        updated = c.set_artwork(tid, image_path)
        _enrich_track(catalog, updated)
        return updated
    return _bulk(catalog, ids, op)


# ---- generated waveform cover art -------------------------------------------
_DEFAULT_WAVEFORM_COLOR = "#86B3D3"  # brand Sloth Blue


def _cover_watermark(catalog: Catalog) -> bool:
    return (catalog.get_setting("config") or {}).get("cover_watermark", True) is not False


def _cover_color(catalog: Catalog) -> str:
    c = (catalog.get_setting("config") or {}).get("cover_waveform_color")
    return c if isinstance(c, str) and c.strip() else _DEFAULT_WAVEFORM_COLOR


def _render_cover(track: dict, name: str, watermark: bool, out_path: str,
                  avatar_url: str | None = None, avatar_img=None,
                  color: str = _DEFAULT_WAVEFORM_COLOR, file_path: str | None = None) -> str:
    # Real audio (the local file we uploaded) gives true dynamics + frequency depth;
    # otherwise fall back to SoundCloud's amplitude-only waveform in the solid colour.
    analysis = coverart.analyze_audio(file_path) if (file_path and Path(file_path).is_file()) else None
    samples = None
    if analysis is None:
        samples = coverart.fetch_waveform_samples(track.get("waveform_url"))
        if not samples:
            raise RuntimeError("No waveform available for this track yet.")
    return coverart.render_waveform_cover(
        samples, name, strip_wip_tag(track.get("title") or ""), out_path,
        watermark=watermark, avatar_url=avatar_url, avatar_img=avatar_img,
        color=color, analysis=analysis)


def generate_waveform_cover(catalog: Catalog, track_id: int) -> dict:
    """Render a waveform cover (artist name + title over the track's waveform, on the
    profile-picture backdrop) and set it as the track's artwork. Returns the enriched track."""
    if not connected(catalog):
        raise RuntimeError("not_connected")
    name = account_label(catalog) or ""
    watermark = _cover_watermark(catalog)
    color = _cover_color(catalog)
    avatar = account_avatar(catalog)
    track = next((t for t in client_for(catalog).list_tracks() if t.get("id") == track_id), None)
    if not track:
        raise RuntimeError("Track not found.")
    rec = catalog.upload_by_track_id(track_id)
    file_path = rec.get("file_path") if rec else None
    with tempfile.TemporaryDirectory() as td:
        png = _render_cover(track, name, watermark, f"{td}/cover.png",
                            avatar_url=avatar, color=color, file_path=file_path)
        updated = client_for(catalog).set_artwork(track_id, png)
    _enrich_track(catalog, updated)
    return updated


def bulk_generate_waveform_covers(catalog: Catalog, ids: list[int]) -> list[dict]:
    """Generate + apply a waveform cover for many tracks (Pro). Fetches the library +
    avatar once, then renders + sets each with the shared rate-limit-aware fan-out."""
    if not connected(catalog):
        raise RuntimeError("not_connected")
    name = account_label(catalog) or ""
    watermark = _cover_watermark(catalog)
    color = _cover_color(catalog)
    # Fetch the profile picture ONCE for the whole batch (else it'd re-download per track).
    avatar_img = coverart.fetch_avatar_image(account_avatar(catalog))
    track_map = {t.get("id"): t for t in client_for(catalog).list_tracks()}
    upload_map = catalog.uploads_by_sc_track_id()  # sc_track_id -> row, for the local file path
    with tempfile.TemporaryDirectory() as td:
        def op(client, tid):
            track = track_map.get(tid)
            if not track:
                raise RuntimeError("Track not found.")
            file_path = (upload_map.get(tid) or {}).get("file_path")
            png = _render_cover(track, name, watermark, f"{td}/cover_{tid}.png",
                                avatar_img=avatar_img, color=color, file_path=file_path)
            updated = client.set_artwork(tid, png)
            _enrich_track(catalog, updated)
            return updated
        return _bulk(catalog, ids, op)


def client_for_account(catalog: Catalog, account_id: str):
    """A client bound to a SPECIFIC account (used to flip scheduled releases on the
    account that originally uploaded them, even if the user has since switched)."""
    accts = get_accounts(catalog)
    acct = next((a for a in accts if a.get("id") == account_id), None)
    if acct is None:
        return None

    def on_tokens(new: dict):
        for a in accts:
            if a.get("id") == account_id:
                a.update(new)
                a["id"] = account_id
        _write_accounts(catalog, accts)

    return soundcloud.get_client(acct, on_tokens, store=_MockStore(catalog))


# ---- scheduled release (upload private now, flip public later) --------------
_RELEASES_KEY = "pending_releases"


def add_pending_release(catalog: Catalog, track_id, release_at: str,
                        account_id: str | None, title: str = "") -> None:
    pending = catalog.get_setting(_RELEASES_KEY) or []
    pending.append({"id": uuid.uuid4().hex, "track_id": track_id,
                    "release_at": release_at, "account_id": account_id, "title": title})
    catalog.set_setting(_RELEASES_KEY, pending)


def pending_releases(catalog: Catalog) -> list[dict]:
    return catalog.get_setting(_RELEASES_KEY) or []


def process_due_releases(catalog: Catalog, now: datetime | None = None) -> list[dict]:
    """Flip any releases whose time has come to public. Returns the ones flipped;
    failures are kept to retry on the next tick."""
    now = now or datetime.now()
    pending = catalog.get_setting(_RELEASES_KEY) or []
    if not pending:
        return []
    remaining, flipped = [], []
    for p in pending:
        try:
            due = datetime.fromisoformat(p["release_at"]) <= now
        except (ValueError, KeyError, TypeError):
            due = True  # malformed -> release now rather than getting stuck
        if not due:
            remaining.append(p)
            continue
        client = client_for_account(catalog, p.get("account_id")) if p.get("account_id") \
            else (client_for(catalog) if connected(catalog) else None)
        if client is None:
            continue  # the account is gone — drop the orphaned release
        try:
            client.update_track(p["track_id"], {"sharing": "public"})
            flipped.append(p)
        except Exception:
            remaining.append(p)  # transient (rate limit / network) — retry next tick
    catalog.set_setting(_RELEASES_KEY, remaining)
    return flipped


# ---- scan with dedupe -------------------------------------------------------
def _hashed(catalog: Catalog, path: str, size: int, mtime: float) -> str:
    """Content hash for a file, cached by (size, mtime) so unchanged files aren't
    re-read on every scan. A render that changes bumps mtime/size -> re-hash."""
    cache = catalog.get_setting(_HASH_CACHE_KEY) or {}
    ent = cache.get(path)
    if ent and ent.get("size") == size and ent.get("mtime") == mtime:
        return ent["hash"]
    h = hash_file(Path(path))
    cache[path] = {"size": size, "mtime": mtime, "hash": h}
    catalog.set_setting(_HASH_CACHE_KEY, cache)
    return h


def _prune_hash_cache(catalog: Catalog, live_paths: set[str]) -> None:
    """Drop cached hashes for files that no longer exist, so the cache can't grow
    without bound over time as renders are renamed/deleted."""
    cache = catalog.get_setting(_HASH_CACHE_KEY) or {}
    pruned = {p: v for p, v in cache.items() if p in live_paths}
    if len(pruned) != len(cache):
        catalog.set_setting(_HASH_CACHE_KEY, pruned)


_LOSSLESS_EXTS = {".wav", ".aiff", ".aif", ".flac"}


def _format_quality(m: dict) -> tuple:
    """Higher is better. Lossless beats lossy; within a tier the bigger file wins
    (a stand-in for bit depth / bitrate)."""
    return (1 if (m.get("ext") or "").lower() in _LOSSLESS_EXTS else 0, m.get("size") or 0)


def mark_format_dupes(mixes: list[dict]) -> None:
    """Collapse exports of the SAME mix in different formats (e.g. an AIF + an MP3 of
    "HEAVY"). The highest-quality file wins; the rest get `superseded_by` = the kept
    format so the UI can hide/deselect them and we never double-post one track. The
    winner lists the alternates it beat in `dupe_formats`. Grouped by exact name
    (case-insensitive) so distinct tracks are never merged. In-place."""
    groups: dict[str, list[dict]] = {}
    for m in mixes:
        groups.setdefault((m.get("name") or "").strip().lower(), []).append(m)
    for grp in groups.values():
        if len(grp) < 2:
            grp[0]["superseded_by"] = None
            continue
        best = max(grp, key=_format_quality)
        best["superseded_by"] = None
        best["dupe_formats"] = sorted({(x.get("ext") or "").lstrip(".").upper()
                                       for x in grp if x is not best})
        for m in grp:
            if m is not best:
                m["superseded_by"] = (best.get("ext") or "").lstrip(".").upper()


def scan_mixes(catalog: Catalog, sources: list[Path], progress=None) -> list[dict]:
    """Discover mixes and mark which are already on SoundCloud (by content hash)."""
    found = discover(sources)
    uploaded = catalog.uploaded_hashes()
    if progress:
        progress({"type": "scan_start", "total": len(found)})
    out = []
    for i, m in enumerate(found):
        try:
            h = _hashed(catalog, m["path"], m["size"], m["mtime"])
        except OSError:
            continue
        m["file_hash"] = h
        prev = uploaded.get(h)
        m["uploaded"] = prev is not None
        m["permalink_url"] = prev["permalink_url"] if prev else None
        out.append(m)
        if progress:
            progress({"type": "scan_progress", "done": i + 1,
                      "total": len(found), "name": m["name"]})
    _prune_hash_cache(catalog, {m["path"] for m in found})
    projectmeta.annotate(out)  # borrow BPM/genre from the sibling Backups catalog by name
    mark_format_dupes(out)     # same track in multiple formats -> keep the best one
    annotate_wip(out, catalog) # flag tracks the user is iterating on (WIP + watched)
    if progress:
        progress({"type": "scan_done", "count": len(out)})
    return out


# ---- upload engine ----------------------------------------------------------
def _meta_for(item: dict, defaults: dict) -> TrackMeta:
    name = item.get("name") or Path(item["path"]).stem
    template = defaults.get("title_template") or "{name}"
    title = (item.get("title") or template.replace("{name}", name)).strip() or name
    tags = item.get("tags")
    if tags is None:
        tags = defaults.get("tags") or []
    return TrackMeta(
        title=title,
        description=item.get("description", defaults.get("description", "")) or "",
        sharing=item.get("sharing") or defaults.get("sharing") or "public",
        genre=item.get("genre", defaults.get("genre", "")) or "",
        tags=list(tags),
        downloadable=bool(item.get("downloadable", defaults.get("downloadable", False))),
    )


def run_upload(catalog: Catalog, items: list[dict], defaults: dict | None = None,
               progress=None, cancel=None, force: bool = False,
               release_at: str | None = None) -> dict:
    """Upload each item to SoundCloud, skipping anything already published (by hash).

    `items`  : [{path, title?, description?, sharing?, genre?, tags?}, ...]
    `defaults`: fallback metadata from config (sharing/genre/tags/title_template).
    `cancel` : a callable returning True to stop between tracks.
    `release_at`: if set, each track is uploaded PRIVATE and a pending release is
                  recorded to flip it public at that ISO time (scheduled release).
    Returns a summary dict; emits live progress events through `progress`.
    """
    global _uploading
    defaults = defaults or {}
    cancel = cancel or (lambda: False)

    def emit(ev):
        if progress:
            progress(ev)

    with _upload_lock:
        _uploading = True
    results: list[UploadResult] = []
    ok = skipped = errors = 0
    cancelled = False
    try:
        if not connected(catalog):
            emit({"type": "upload_error", "error": "not_connected"})
            return {"ok_count": 0, "error_count": 0, "skipped_count": 0,
                    "results": [], "error": "not_connected"}
        client = client_for(catalog)
        uploaded = catalog.uploaded_hashes()
        # A configured default cover is applied to any upload that doesn't carry its own.
        default_art = (catalog.get_setting("config") or {}).get("default_artwork_path") or None
        total = len(items)
        emit({"type": "upload_start", "total": total, "timestamp": default_timestamp()})
        for i, item in enumerate(items):
            if cancel():
                cancelled = True
                break
            path = item["path"]
            name = item.get("name") or Path(path).stem
            emit({"type": "track_start", "index": i, "name": name, "total": total})
            try:
                size = Path(path).stat().st_size
                h = item.get("file_hash") or _hashed(catalog, path, size, Path(path).stat().st_mtime)
                if not force and h in uploaded:
                    skipped += 1
                    results.append(UploadResult(name=name, status="skipped", file_hash=h))
                    emit({"type": "track_skipped", "index": i, "name": name,
                          "reason": "duplicate"})
                    continue
                meta = _meta_for(item, defaults)
                if release_at:
                    meta.sharing = "private"  # publish privately, flip public later

                def on_prog(sent, tot, _i=i, _n=name):
                    emit({"type": "track_progress", "index": _i, "name": _n,
                          "sent": sent, "size": tot})

                art = item.get("artwork_path") or default_art
                if art and not Path(art).is_file():
                    art = None
                track = client.upload(path, meta, on_progress=on_prog, artwork_path=art)
                tid = track.get("id")
                url = track.get("permalink_url")
                if release_at and tid is not None:
                    add_pending_release(catalog, tid, release_at,
                                        (active_account(catalog) or {}).get("id"), meta.title)
                # Persist the resolved Backups link so the Manage join stays collision-proof
                # even if the title is later renamed on SoundCloud. Strict match only — a
                # name shared by >1 project anchors nothing (lookup_meta returns None).
                pm = projectmeta.lookup_meta(name) or {}
                catalog.record_upload(
                    title=meta.title, file_path=path, file_hash=h, size=size,
                    sharing=meta.sharing, status="uploaded", timestamp=default_timestamp(),
                    sc_track_id=tid, permalink_url=url, account=account_label(catalog),
                    backups_project=pm.get("project"),
                    backups_project_id=pm.get("project_id"))
                uploaded[h] = {"permalink_url": url, "title": meta.title}
                ok += 1
                results.append(UploadResult(name=name, status="uploaded", file_hash=h,
                                            sc_track_id=tid, permalink_url=url))
                emit({"type": "track_done", "index": i, "name": name, "permalink_url": url})
            except Exception as e:  # one bad track must not abort the batch
                errors += 1
                msg = str(e)[:300]
                catalog.record_upload(
                    title=name, file_path=path, file_hash=item.get("file_hash"),
                    size=item.get("size", 0), sharing=defaults.get("sharing", "public"),
                    status="error", timestamp=default_timestamp(), error=msg,
                    account=account_label(catalog))
                results.append(UploadResult(name=name, status="error", error=msg))
                emit({"type": "track_error", "index": i, "name": name, "error": msg})
        emit({"type": "upload_done", "ok_count": ok, "error_count": errors,
              "skipped_count": skipped, "cancelled": cancelled})
        return {"ok_count": ok, "error_count": errors, "skipped_count": skipped,
                "cancelled": cancelled, "results": [r.__dict__ for r in results]}
    finally:
        with _upload_lock:
            _uploading = False


# ---- work-in-progress (WIP) tracks ------------------------------------------
# A WIP track is one you're still iterating on. Marking it WIP keeps it private and
# WATCHES it: each new bounce is re-published privately, replacing the previous WIP
# upload so SoundCloud always shows the latest version. Keyed by normalized name so
# the flag survives re-renders (incl. version suffixes like "v2"/"master").
_WIP_KEY = "wip_tracks"
_WIP_TAG = "[WIP]"


def _wip_norm(name: str) -> str:
    return projectmeta.normalize(name)


def wip_tag_title(title: str) -> str:
    """Append the [WIP] marker so the track reads as a work-in-progress on SoundCloud."""
    t = (title or "").strip()
    return t if _WIP_TAG.lower() in t.lower() else f"{t} {_WIP_TAG}".strip()


def strip_wip_tag(title: str) -> str:
    """Remove a trailing [WIP] / (WIP) marker — used when a track is finalized."""
    return re.sub(r"\s*[\[(]\s*wip\s*[\])]\s*$", "", title or "", flags=re.I).strip()


_CHANGELOG_MAX = 12  # most recent versions listed in the SoundCloud changelog comment


def _changelog_comment(history: list[str]) -> str:
    """A single SoundCloud comment recording every re-bounce of a WIP track. SoundCloud
    has no in-place audio replace, so each new bounce is a fresh track — we repost the
    whole history on it so the changelog stays visible."""
    items = [t for t in (history or []) if t]
    shown = items[-_CHANGELOG_MAX:]
    base = len(items) - len(shown)
    lines = ["🔄 Re-bounced — changelog:"]
    if base > 0:
        lines.append(f"  (+{base} earlier version{'s' if base != 1 else ''})")
    for i, ts in enumerate(shown):
        n = base + i + 1
        mark = "  ← current" if i == len(shown) - 1 else ""
        lines.append(f"  v{n} · {ts}{mark}")
    return "\n".join(lines)


def get_wip(catalog: Catalog) -> dict:
    raw = catalog.get_setting(_WIP_KEY) or {}
    return raw if isinstance(raw, dict) else {}


def _save_wip(catalog: Catalog, wip: dict) -> None:
    catalog.set_setting(_WIP_KEY, wip)


def wip_status(catalog: Catalog) -> list[dict]:
    return [{"key": k, "name": e.get("name"), "permalink_url": e.get("permalink_url")}
            for k, e in get_wip(catalog).items()]


def set_wip(catalog: Catalog, name: str, on: bool) -> dict:
    """Mark/unmark a track (by name) as WIP. Unmarking finalizes it: the [WIP] marker
    is stripped from the live SoundCloud title. Returns the updated WIP map."""
    wip = get_wip(catalog)
    key = _wip_norm(name)
    if not key:
        return wip
    if on:
        if key not in wip:
            wip[key] = {"name": name, "sc_track_id": None, "permalink_url": None,
                        "last_hash": None, "title": None, "added": default_timestamp()}
    else:
        entry = wip.pop(key, None)
        title = (entry or {}).get("title") or ""
        if entry and entry.get("sc_track_id") and _WIP_TAG.lower() in title.lower() \
                and connected(catalog):
            try:  # finalize: drop the [WIP] marker from the published title
                update_track(catalog, entry["sc_track_id"], {"title": strip_wip_tag(title)})
            except Exception:
                pass
    _save_wip(catalog, wip)
    return wip


def annotate_wip(mixes: list[dict], catalog: Catalog) -> None:
    """Flag each scanned mix the user marked WIP (matched by normalized name)."""
    keys = set(get_wip(catalog).keys())
    if not keys:
        return
    for m in mixes:
        if _wip_norm(m.get("name", "")) in keys:
            m["wip"] = True


def process_wip(catalog: Catalog, sources: list[Path], progress=None) -> list[dict]:
    """Watch pass: for each WIP track whose best render is a NEW bounce, publish it
    PRIVATE and delete the previous WIP upload (replace mode). Best-effort; no-ops
    when disconnected or an upload is already running."""
    wip = get_wip(catalog)
    if not wip or not connected(catalog) or upload_in_progress():
        return []
    mixes = scan_mixes(catalog, sources)
    best: dict[str, dict] = {}
    for m in mixes:
        if m.get("superseded_by"):
            continue  # only watch the highest-quality render of each track
        k = _wip_norm(m.get("name", ""))
        if k in wip and k not in best:
            best[k] = m
    uploaded = catalog.uploaded_hashes()
    config = catalog.get_setting("config") or {}
    processed: list[dict] = []
    for k, entry in list(wip.items()):
        # (1) Reconcile: make sure an already-published WIP track shows the [WIP] marker
        # in its live title. Idempotent — done once per track (the `marked` flag).
        if entry.get("sc_track_id") and not entry.get("marked"):
            rec = catalog.upload_by_hash(entry.get("last_hash")) if entry.get("last_hash") else None
            cur_title = (rec or {}).get("title") or entry.get("name") or ""
            tagged = wip_tag_title(cur_title)
            if tagged != cur_title:
                try:
                    update_track(catalog, entry["sc_track_id"], {"title": tagged})
                    processed.append({"name": entry.get("name"),
                                      "permalink_url": entry.get("permalink_url")})
                except Exception:
                    pass
            entry.update(title=tagged, marked=True)
            wip[k] = entry

        m = best.get(k)
        if not m:
            continue
        h = m.get("file_hash")
        if not h or h == entry.get("last_hash"):
            continue  # no render, or this exact bounce is already the published one
        if h in uploaded:
            # already on SoundCloud (e.g. a prior manual upload) — adopt + tag it [WIP]
            rec = catalog.upload_by_hash(h) or {}
            tid = rec.get("sc_track_id")
            tagged = wip_tag_title(rec.get("title") or m["name"])
            if tid:
                try:
                    update_track(catalog, tid, {"title": tagged})
                except Exception:
                    pass
            entry.update(sc_track_id=tid, permalink_url=rec.get("permalink_url"),
                         last_hash=h, title=tagged, marked=True,
                         history=entry.get("history") or [default_timestamp()])
            wip[k] = entry
            continue
        base = (config.get("title_template") or "{name}").replace("{name}", m["name"]).strip() or m["name"]
        wip_title = wip_tag_title(base)  # show it as a WIP on SoundCloud
        item = {"path": m["path"], "name": m["name"], "title": wip_title, "file_hash": h,
                "size": m.get("size"), "sharing": "private",
                "genre": m.get("genre") or None,
                "tags": [f"{m['bpm']} BPM"] if m.get("bpm") else None}
        defaults = {"sharing": "private", "genre": config.get("default_genre", ""),
                    "tags": config.get("default_tags", []),
                    "title_template": config.get("title_template", "{name}"),
                    "description": config.get("default_description", "")}
        old_id = entry.get("sc_track_id")
        summary = run_upload(catalog, [item], defaults=defaults, progress=progress)
        up = next((r for r in summary.get("results", []) if r.get("status") == "uploaded"), None)
        if not up:
            continue
        new_id = up.get("sc_track_id")
        history = list(entry.get("history") or [])
        history.append(default_timestamp())
        if old_id and new_id and old_id != new_id:  # replace: drop the prior WIP track
            try:
                client_for(catalog).delete_track(old_id)
            except Exception:
                pass
            # Leave a timestamped changelog comment on the new track (best-effort).
            if config.get("changelog_comments", True) and new_id:
                try:
                    client_for(catalog).add_comment(new_id, _changelog_comment(history))
                except Exception:
                    pass
        entry.update(sc_track_id=new_id, permalink_url=up.get("permalink_url"),
                     last_hash=h, title=wip_title, marked=True, history=history)
        wip[k] = entry
        processed.append({"name": entry.get("name"), "permalink_url": up.get("permalink_url")})
    _save_wip(catalog, wip)
    return processed


# ---- dashboard overview -----------------------------------------------------
def build_overview(catalog: Catalog) -> dict:
    t = catalog.totals()
    recent = catalog.recent_uploads(limit=1)
    last = recent[0] if recent else None
    return {
        "connected": connected(catalog),
        "account": account_label(catalog),
        "mock": soundcloud.use_mock(),
        "uploaded_count": t["uploaded_count"],
        "error_count": t["error_count"],
        "uploaded_bytes": t["uploaded_bytes"],
        "last_upload": (last or {}).get("timestamp"),
        "last_upload_ok": bool(last and last.get("status") == "uploaded"),
        "scheduled_count": len(pending_releases(catalog)),
    }
