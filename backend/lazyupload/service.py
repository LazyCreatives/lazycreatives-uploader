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

from lazyupload import coverart, crypto, projectmeta, seo, songs, soundcloud
from lazyupload.catalog import Catalog
from lazyupload.hashing import hash_file
from lazyupload.models import TrackMeta, UploadResult
from lazyupload.scanner import discover, duration as file_duration
from lazyupload.stems import is_stem

# Module-level "is an upload running" flag so a scheduled tick can stand down while a
# manual upload is in flight (mirrors the Backups scheduler's guard).
_upload_lock = threading.Lock()
_uploading = 0  # how many posting runs are going (two can overlap)
# Held while one mix is checked, sent and recorded, by every posting run (Post, the
# automatic folder check, the WIP watch). Two runs that overlap therefore can never
# both send the same mix: the second one waits, then sees it is already posted.
_post_lock = threading.Lock()

_LEGACY_ACCOUNT_KEY = "sc_account"  # single-account storage from before multi-account
_ACCOUNTS_KEY = "sc_accounts"       # list of stored, encrypted account entries
_ACTIVE_KEY = "sc_active"           # id of the currently active account
_HASH_CACHE_KEY = "hash_cache"      # {path: {size, mtime, hash}} so scans don't re-hash


def default_timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def upload_in_progress() -> bool:
    return _uploading > 0


# ---- connected accounts (encrypted, multi-account) --------------------------
# Each account is a full token dict plus an "id". On disk it's an entry of the form
# {"id", "username", "mock", "enc"} where `enc` is the encrypted token JSON (DPAPI on
# Windows, OS keychain-backed AES on macOS/Linux; see crypto.py);
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
    upgrade, skipped = False, False
    for s in catalog.get_setting(_ACCOUNTS_KEY) or []:
        try:
            out.append(json.loads(crypto.decrypt(s["enc"])))
        except Exception:
            skipped = True
            continue  # unreadable (e.g. DPAPI blob from another user) — skip it
        upgrade = upgrade or crypto.needs_upgrade(s["enc"])
    if upgrade and not skipped:
        # Logins saved readable by older builds get locked away. Never rewrite while an
        # entry is unreadable (e.g. keychain locked right now): that would drop it.
        _write_accounts(catalog, out)
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
    if acct.get("signed_out"):
        return False  # SoundCloud refused the saved sign-in: only signing in again helps
    if soundcloud.use_mock():
        return bool(acct)  # mock still requires an explicit connect
    return bool(acct.get("access_token"))


def signed_out(catalog: Catalog) -> bool:
    """The active account's saved sign-in stopped working (expired or revoked)."""
    return bool((active_account(catalog) or {}).get("signed_out"))


def mark_signed_out(catalog: Catalog) -> None:
    """Note that SoundCloud refused the active account's sign-in, so the sidebar stops
    saying "connected" and the app offers "Sign in again". Signing in again replaces
    the account (add_account), which clears this."""
    if active_account(catalog) and not signed_out(catalog):
        _update_active_tokens(catalog, {"signed_out": True})


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
             "mock": a.get("mock", False), "active": a.get("id") == aid,
             "signed_out": bool(a.get("signed_out"))}
            for a in get_accounts(catalog)]


class _MockStore:
    """Catalog-backed persistence for the mock client's managed library, so demo
    uploads + edits survive restarts. Ignored entirely by the real client."""
    _KEY = "mock_library"

    def __init__(self, catalog: Catalog, key: str | None = None):
        self._catalog = catalog
        if key:
            self._KEY = key

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

    client = soundcloud.get_client(tokens, on_tokens, store=_MockStore(catalog),
                                   playlist_store=_MockStore(catalog, "mock_playlists"))
    return _SignInWatch(client, lambda: mark_signed_out(catalog))


class _SignInWatch:
    """Wraps a SoundCloud client. When SoundCloud refuses the sign-in (401), it gets a
    new access token once and tries again; when that fails too, the saved sign-in is
    dead, so the account is marked signed out (the app then asks to sign in again)."""

    def __init__(self, client, on_signed_out):
        self._client = client
        self._on_signed_out = on_signed_out

    def __getattr__(self, name):
        attr = getattr(self._client, name)
        if not callable(attr) or name.startswith("_") or name == "renew":
            return attr

        def call(*a, **kw):
            try:
                return attr(*a, **kw)
            except soundcloud.SignedOutError:
                renew = getattr(self._client, "renew", None)
                if renew is None:
                    self._on_signed_out()
                    raise
                try:
                    renew()
                except soundcloud.SignedOutError:
                    self._on_signed_out()
                    raise
                try:
                    return attr(*a, **kw)
                except soundcloud.SignedOutError:
                    self._on_signed_out()
                    raise
        return call


# ---- manage existing uploads ------------------------------------------------
def _apply_project_meta(track: dict, meta: dict) -> None:
    """Map a projectmeta rich object onto a managed track (the /api/tracks contract)."""
    bpm = meta.get("bpm")
    track["bpm"] = round(float(bpm)) if bpm is not None else None
    track["genre_emoji"] = meta.get("genre_emoji")
    track["project_genre"] = meta.get("genre")  # the project's own genre, for matching cover art
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
      (b) that row's file: Backups' exact export link, else its stem (strict name match)
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
                meta = projectmeta.resolve(rec["file_path"], Path(rec["file_path"]).stem)
                if meta:
                    return meta
        return projectmeta.lookup_meta(strip_wip_tag(track.get("title") or ""))
    except Exception:
        return None


def history_with_projects(catalog: Catalog, limit: int = 50) -> list[dict]:
    """Recent uploads, each with the Backups project its file came from (name + genre)
    when Backups knows it, so the app can draw the same cover art as Backups does."""
    rows = catalog.recent_uploads(limit=limit)
    for r in rows:
        r["project_match"] = r["project_genre"] = None
        try:
            meta = None
            if r.get("backups_project_id"):
                meta = projectmeta.lookup_meta_by_id(r["backups_project_id"])
            if not meta and r.get("file_path"):
                meta = projectmeta.resolve(r["file_path"], Path(r["file_path"]).stem)
            if meta:
                r["project_match"], r["project_genre"] = meta.get("project"), meta.get("genre")
        except Exception:
            pass
    return rows


def _enrich_track(catalog: Catalog, t: dict, upload_map: dict | None = None) -> None:
    """Attach the SEO score and borrowed Backups metadata to ONE managed track. Best-effort
    and independent: a failure (or a missing Backups catalog) never strips the SEO score."""
    meta = _project_meta_for(catalog, t, upload_map)
    # The local file this app posted, so the track can be played and outlined here.
    try:
        row = upload_map.get(t.get("id")) if upload_map is not None else catalog.upload_by_track_id(t.get("id"))
        path = projectmeta.current_path((row or {}).get("file_path"))
        t["local_path"] = path if path and Path(path).is_file() else None
    except Exception:
        t["local_path"] = None
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
    replaced = replaced_tracks(catalog)
    for t in tracks:
        _enrich_track(catalog, t, upload_map)
        r = replaced.get(str(t.get("id")))
        t["replaced_by"] = {"id": r.get("new_id"), "permalink_url": r.get("permalink_url")} if r else None


# Formats SoundCloud stores losslessly — preferred over lossy copies of the same title.
_LOSSLESS_FORMATS = {"wav", "wave", "aif", "aiff", "flac", "alac"}


def _dupe_key(title: str) -> str:
    return songs.song_key(strip_wip_tag(title or ""))


def _track_keep_rank(t: dict) -> tuple:
    """Which copy of a double to keep: the one people have played (its plays, likes and
    comments stay with it), then lossless over lossy, then the bigger original."""
    fmt = (t.get("original_format") or "").lower()
    lossless = 1 if fmt in _LOSSLESS_FORMATS else 0
    return (t.get("playback_count") or 0, lossless, t.get("original_content_size") or 0,
            t.get("duration") or 0)


def _mark_track_dupes(tracks: list[dict]) -> None:
    """Flag the same song posted more than once. Tracks whose titles name the same song
    ("Heavy", "Heavy (Master)", "heavy_final") and whose lengths agree are DOUBLES: each
    gets dupe_group (the keeper's id), dupe_count and dupe_keeper, so Your tracks can
    group them and offer to remove the extra copies. Same song at a different length is
    another VERSION: version_count is set so it can be named, never offered for removal."""
    groups: dict[str, list[dict]] = {}
    for t in tracks:
        k = _dupe_key(t.get("title", ""))
        if k:
            groups.setdefault(k, []).append(t)
    for members in groups.values():
        if len(members) < 2:
            continue
        clusters: list[list[dict]] = []
        for t in sorted(members, key=_track_keep_rank, reverse=True):
            d = t.get("duration")
            home = next((c for c in clusters
                         if d is None or c[0].get("duration") is None
                         or abs(d - c[0]["duration"]) <= songs.SAME_LENGTH_SC), None)
            if home is None:
                clusters.append([t])
            else:
                home.append(t)
        for c in clusters:
            if len(clusters) > 1:
                for t in c:
                    t["version_count"] = len(clusters)
            if len(c) < 2:
                continue
            best = c[0]
            for t in c:
                t["dupe_group"] = best.get("id")
                t["dupe_count"] = len(c)
                t["dupe_keeper"] = t is best


def list_tracks(catalog: Catalog) -> list[dict]:
    if not connected(catalog):
        raise RuntimeError("not_connected")
    tracks = client_for(catalog).list_tracks()
    try:  # so a folder check knows what is up, including songs posted elsewhere
        songs.remember_sc_tracks(catalog, (active_account(catalog) or {}).get("id"),
                                 tracks, time.time())
    except Exception:
        pass
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


def list_comments(catalog: Catalog, track_id: int) -> list[dict]:
    if not connected(catalog):
        raise RuntimeError("not_connected")
    return client_for(catalog).list_comments(track_id)


def delete_track(catalog: Catalog, track_id: int) -> None:
    if not connected(catalog):
        raise RuntimeError("not_connected")
    client_for(catalog).delete_track(track_id)


# ---- playlists ("sets" on SoundCloud) -----------------------------------------
def _need_connection(catalog: Catalog) -> None:
    if not connected(catalog):
        raise RuntimeError("not_connected")


def list_playlists(catalog: Catalog) -> list[dict]:
    _need_connection(catalog)
    return client_for(catalog).list_playlists()


def create_playlist(catalog: Catalog, title: str, sharing: str = "public",
                    track_ids: list[int] | None = None) -> dict:
    _need_connection(catalog)
    ids = list(dict.fromkeys(int(i) for i in (track_ids or [])))  # no repeats, order kept
    return client_for(catalog).create_playlist(title.strip(), sharing, ids)


def update_playlist(catalog: Catalog, playlist_id: int, title: str | None = None,
                    sharing: str | None = None, track_ids: list[int] | None = None,
                    description: str | None = None, genre: str | None = None,
                    tags: list[str] | None = None) -> dict:
    """Change a playlist's details (name, description, genre, tags, privacy) or set the
    whole ordered track list (reorder / remove). None leaves a thing as it is."""
    _need_connection(catalog)
    if track_ids is not None:
        track_ids = list(dict.fromkeys(int(i) for i in track_ids))
    if tags is not None:
        tags = list(dict.fromkeys(t.strip() for t in tags if t.strip()))
    return client_for(catalog).update_playlist(
        playlist_id, title=title.strip() if title is not None else None,
        sharing=sharing, track_ids=track_ids,
        description=description, genre=genre.strip() if genre is not None else None, tags=tags)


def set_playlist_artwork(catalog: Catalog, playlist_id: int, image_path: str) -> dict:
    """Give a playlist its own cover from a picture on this computer (only read, never changed)."""
    _need_connection(catalog)
    return client_for(catalog).set_playlist_artwork(playlist_id, image_path)


class PlaylistIncomplete(RuntimeError):
    """SoundCloud sent fewer of a playlist's tracks than it says it holds."""


def add_to_playlist(catalog: Catalog, playlist_id: int, track_ids: list[int]) -> dict:
    """Add tracks to the end of a playlist, skipping any already in it. Reads the
    playlist first, because SoundCloud replaces the whole list on every change."""
    _need_connection(catalog)
    client = client_for(catalog)
    before = client.get_playlist(playlist_id)
    current = [t["id"] for t in before.get("tracks", [])]
    # Saving a partial list would quietly drop the missing tracks, so stop instead.
    if (before.get("track_count") or 0) > len(current):
        raise PlaylistIncomplete(
            f"playlist {playlist_id}: SoundCloud sent {len(current)} of {before.get('track_count')} tracks")
    fresh = [int(i) for i in dict.fromkeys(track_ids) if int(i) not in current]
    pl = client.update_playlist(playlist_id, track_ids=current + fresh) if fresh \
        else client.get_playlist(playlist_id)
    pl["added"] = len(fresh)
    return pl


# ---- new posts straight into a playlist ----------------------------------------
# Settings "Add new posts to a playlist": off (the default), one playlist the producer
# picked, or a playlist per genre ("House", "Techno"), made the first time a song of
# that genre goes up. Best-effort: a post never fails because its playlist couldn't
# be changed. Only adds; never removes a track from anything.
def auto_playlist(catalog: Catalog) -> dict:
    """{"mode": "off" | "one" | "genre", "playlist_id": int | None}."""
    v = (catalog.get_setting("config") or {}).get("auto_playlist") or {}
    mode = v.get("mode") if v.get("mode") in ("one", "genre") else "off"
    return {"mode": mode, "playlist_id": v.get("playlist_id")}


def file_into_playlist(catalog: Catalog, track_id: int, genre: str, sharing: str) -> str | None:
    """Add a just-posted track to its playlist per Settings. Returns the playlist's
    title, or None when nothing was added."""
    rule = auto_playlist(catalog)
    try:
        if rule["mode"] == "one" and rule["playlist_id"]:
            return add_to_playlist(catalog, int(rule["playlist_id"]), [track_id]).get("title")
        if rule["mode"] == "genre" and (genre or "").strip():
            name = genre.strip()
            pl = next((p for p in list_playlists(catalog)
                       if (p.get("title") or "").strip().lower() == name.lower()), None)
            if pl is None:  # a private song never makes a public playlist
                return create_playlist(catalog, name, sharing or "private", [track_id]).get("title")
            return add_to_playlist(catalog, pl["id"], [track_id]).get("title")
    except Exception:
        return None
    return None


def delete_playlist(catalog: Catalog, playlist_id: int) -> None:
    """Deletes the playlist only; its tracks stay on SoundCloud."""
    _need_connection(catalog)
    client_for(catalog).delete_playlist(playlist_id)


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
                                "error": "Not done: SoundCloud signed you out. Sign in again."})
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


# ---- a cover for automatic posts ---------------------------------------------
# Posts made on the Upload page carry the cover the producer sees. Automatic posts
# (the folder check, drafts) have no page to draw one, so when the producer ticks
# "Give automatic posts a waveform cover" in Settings they get one drawn from the song
# itself. Off unless ticked. The audio is only read.
def auto_cover_on(catalog: Catalog) -> bool:
    return bool((catalog.get_setting("config") or {}).get("auto_cover", False))


def auto_cover_file(catalog: Catalog, path: str, title: str, folder: str) -> str | None:
    """A waveform cover for this song, saved in `folder`; None if it can't be drawn
    (the post still goes up, without one)."""
    try:
        return _render_cover({"title": title}, account_label(catalog) or "",
                             _cover_watermark(catalog), str(Path(folder) / "cover.png"),
                             avatar_url=account_avatar(catalog), color=_cover_color(catalog),
                             file_path=path)
    except Exception:
        return None


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
    file_path = projectmeta.current_path(rec.get("file_path")) if rec else None
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
            file_path = projectmeta.current_path((upload_map.get(tid) or {}).get("file_path"))
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

    return soundcloud.get_client(acct, on_tokens, store=_MockStore(catalog),
                                 playlist_store=_MockStore(catalog, "mock_playlists"))


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


def parse_release_at(value: str) -> datetime:
    """Read a release time as this computer's local time, without a time zone.
    The app sends UTC ("...Z"); older entries and tests are plain local times.
    Raises ValueError when it can't be read."""
    when = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    if when.tzinfo is not None:
        when = when.astimezone().replace(tzinfo=None)
    return when


def process_due_releases(catalog: Catalog, now: datetime | None = None) -> list[dict]:
    """Flip any releases whose time has come to public. Returns the ones flipped;
    failures are kept to retry on the next tick."""
    now = now or datetime.now()
    if now.tzinfo is not None:
        now = now.astimezone().replace(tzinfo=None)
    pending = catalog.get_setting(_RELEASES_KEY) or []
    if not pending:
        return []
    remaining, flipped = [], []
    for p in pending:
        try:
            due = parse_release_at(p["release_at"]) <= now
        except (ValueError, KeyError, TypeError):
            due = False  # unreadable -> stay private; never release early
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


def mark_format_dupes(mixes: list[dict]) -> None:
    """Group files that are one mix in several formats (see songs.group_formats): the
    best one is the row, the rest get `superseded_by`, so one mix never posts twice."""
    songs.group_formats(mixes)


# How long the copy of the account's track list counts as fresh for a folder check.
_SC_SEEN_FRESH = 15 * 60


def _posted_map(catalog: Catalog, refresh: bool = False) -> dict[str, list[dict]]:
    """{song key: what of it is on SoundCloud}: this app's posts plus the tracks last
    seen on the account. With `refresh`, a stale copy of the account's tracks is
    fetched again (best-effort; offline keeps the old copy). A post this app made that
    is no longer on the account (removed on SoundCloud) no longer counts."""
    acct = (active_account(catalog) or {}).get("id")
    seen, at = songs.seen_sc_tracks(catalog, acct)
    if refresh and acct and connected(catalog) and time.time() - at > _SC_SEEN_FRESH:
        try:
            fresh = client_for(catalog).list_tracks()
            songs.remember_sc_tracks(catalog, acct, fresh, time.time())
            seen, at = songs.seen_sc_tracks(catalog, acct)
        except Exception:
            pass
    uploads = catalog.posted_uploads()
    if at:
        live = {t.get("id") for t in seen}
        me = account_label(catalog)
        uploads = [u for u in uploads if u.get("sc_track_id") is None
                   or u.get("account") != me or u["sc_track_id"] in live]
    return songs.posted_songs(uploads, seen)


def auto_post_picks(mixes: list[dict]) -> list[dict]:
    """The mixes an automatic run may post: one file per song (the best format of its
    newest version), never a song already on SoundCloud in any format or version, and
    never a short export or a stem. Without this, a song exported as both WAV and MP3
    went up twice."""
    posted = {m.get("song") for m in mixes if m.get("uploaded")}
    picks: dict[str, dict] = {}
    for m in mixes:
        if not songs.is_new(m) or m.get("song") in posted:
            continue
        k = m.get("song") or (m.get("name") or "").strip().lower()
        if k not in picks or (m.get("mtime") or 0) > (picks[k].get("mtime") or 0):
            picks[k] = m
    return list(picks.values())


# ---- stems -------------------------------------------------------------------
# A stem is one part of a song (the kick, the vocals), exported on its own. They land
# in the same folders as finished songs, so each one is flagged `stem`: the Upload
# page leaves them out (with a way to show them), they are never ticked for you, and
# automatic posting never picks them. The file itself is never touched.
def mark_stems(mixes: list[dict]) -> None:
    """In-place: flag the exports that are one part of a song rather than the song."""
    for m in mixes:
        path = Path(m["path"])
        project = m.get("project_match") or ""
        m["stem"] = is_stem(path, project=project)


# ---- genre the producer set for a single mix -----------------------------------
# Most mixes take their genre from their Backups project (corrected there for the
# whole project). When one mix differs, e.g. a remix, the producer can set its own
# genre here; it is kept by file path in Uploader's settings.
MIX_GENRES = "mix_genres"


def set_mix_genre(catalog: Catalog, paths: list[str], genre: str | None) -> dict:
    """Set (or with genre=None, clear) the genre of these mixes. Returns the map."""
    saved = dict(catalog.get_setting(MIX_GENRES) or {})
    for p in paths:
        if genre:
            saved[p] = genre
        else:
            saved.pop(p, None)
    catalog.set_setting(MIX_GENRES, saved)
    return saved


def apply_mix_genres(mixes: list[dict], catalog: Catalog) -> None:
    """In-place: mixes with a genre of their own show it, flagged as set by you."""
    saved = catalog.get_setting(MIX_GENRES) or {}
    for m in mixes:
        g = saved.get(m.get("path"))
        m["genre_mix"] = bool(g)
        if g:
            m["genre"] = g
            m["genre_by_you"] = True


# ---- short exports -----------------------------------------------------------
# Clicks, test bounces and one-shot renders land in the same folder as finished
# songs. Anything shorter than the Settings minimum is flagged `short`: the Upload
# page hides it (with a way to show it) and automatic posting never picks it. The
# file itself is never touched. A file whose length can't be read is never short.
DEFAULT_MIN_LENGTH = 30


def min_length(catalog: Catalog) -> int:
    """Seconds below which an export counts as short; 0 = off."""
    v = (catalog.get_setting("config") or {}).get("min_length_seconds", DEFAULT_MIN_LENGTH)
    try:
        return max(0, int(v))
    except (TypeError, ValueError):
        return DEFAULT_MIN_LENGTH


def mark_short(mixes: list[dict], seconds: int) -> None:
    """In-place: flag mixes shorter than `seconds` (never when `seconds` is 0)."""
    for m in mixes:
        d = m.get("duration")
        m["short"] = bool(seconds) and d is not None and d < seconds


def watched_sources(config: dict) -> list[Path]:
    """The folders to look in: the ones picked in Settings, plus, when "Also look in
    Backups' export folders" is on, the export folders Backups knows about (any not
    already inside a picked folder). Only ever read."""
    out = [Path(s) for s in config.get("sources", []) if s]
    if config.get("watch_backups_folders"):
        def inside(p: Path, root: Path) -> bool:
            return p == root or root in p.parents
        for s in projectmeta.backups_export_folders() or []:
            p = Path(s)
            if not any(inside(p, r) for r in out):
                out.append(p)
    return out


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
    apply_mix_genres(out, catalog)  # a genre the producer set for one mix wins
    mark_stems(out)            # one part of a song (kick, vocals) is never a song to post
    mark_format_dupes(out)     # same track in multiple formats -> keep the best one
    try:                       # songs already up in another format or version
        posted = {k: [_with_local_length(p) for p in v]
                  for k, v in _posted_map(catalog, refresh=True).items()}
        songs.mark_on_soundcloud(out, posted)
    except Exception:
        pass
    annotate_wip(out, catalog) # flag tracks the user is iterating on (WIP + watched)
    mark_short(out, min_length(catalog))  # clicks and test bounces stay out of the way
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


def short_reason(exc: BaseException) -> str:
    """A few plain words on why one mix didn't post, for its row on the Upload page.
    The full message still goes in the event's `error` and in History."""
    if isinstance(exc, FileNotFoundError):
        return "The file was moved or deleted."
    if isinstance(exc, PermissionError):
        return "Couldn't open the file."
    if isinstance(exc, soundcloud.RateLimitError):
        return str(exc)  # "SoundCloud asked us to wait 3 minutes." with SoundCloud's number
    if isinstance(exc, soundcloud.AuthError):
        return str(exc)  # "SoundCloud signed you out. Sign in again."
    if isinstance(exc, UploadStopped):
        return "Stopped. It wasn't posted."
    try:
        import requests
        if isinstance(exc, (requests.ConnectionError, requests.Timeout)):
            return "Couldn't reach SoundCloud. Check your internet."
        if isinstance(exc, requests.HTTPError):
            code = getattr(getattr(exc, "response", None), "status_code", None)
            if code == 413:
                return "The file is too big for SoundCloud."
            if code and code >= 500:
                return "SoundCloud had a problem. Try again soon."
            return "SoundCloud turned it down."
    except ImportError:  # pragma: no cover
        pass
    if isinstance(exc, OSError):
        return "Couldn't read the file."
    msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    # A short, friendly message from our own code reads fine as is.
    if msg and len(msg) <= 80 and isinstance(exc, (RuntimeError, soundcloud.SoundCloudError)):
        return msg
    return "Something went wrong."


def double_note(hit: dict) -> str:
    """A few plain words on why a mix was held back as a double."""
    where = f" as {hit['format']}" if hit.get("format") else ""
    if hit.get("kind") == "version":
        return "Another version of this song is already on SoundCloud."
    return f"Already on SoundCloud{where}."


def _song_on_soundcloud(catalog: Catalog, path: str, name: str, size: int, h: str,
                        run_songs: dict) -> dict | None:
    """Is this mix's song already up, in any format or version? Read fresh each time
    (inside the post lock) so overlapping runs see each other's posts."""
    key = songs.song_key(name)
    posted = list(_posted_map(catalog).get(key, [])) + list(run_songs.get(key, []))
    if not posted:
        return None
    try:
        st = Path(path).stat()
        dur = file_duration(Path(path), st.st_size, st.st_mtime)
    except OSError:
        dur = None
    me = {"path": path, "file_hash": h, "duration": dur, "song": key}
    return songs.match_on_soundcloud(me, [_with_local_length(p) for p in posted])


def _with_local_length(p: dict) -> dict:
    """SoundCloud rounds lengths to whole seconds; the posted file, when it is still
    on disk, gives the exact one."""
    if not p.get("path"):
        return p
    try:
        f = Path(p["path"])
        st = f.stat()
        d = file_duration(f, st.st_size, st.st_mtime)
    except OSError:
        return p
    return {**p, "duration": d} if d is not None else p


class UploadStopped(Exception):
    """The person pressed Stop while a mix was going up: the transfer is cut off."""


# A post whose answer never came back (the connection dropped as SoundCloud was taking
# the file) may well be on SoundCloud. Each is noted here by the file's hash, and the
# next post of that file first asks SoundCloud whether it already went up.
_UNSURE_KEY = "unsure_posts"


def _unsure(catalog: Catalog) -> dict:
    raw = catalog.get_setting(_UNSURE_KEY) or {}
    return raw if isinstance(raw, dict) else {}


def _note_unsure(catalog: Catalog, h: str, title: str, since: float) -> None:
    saved = _unsure(catalog)
    saved[h] = {"title": title, "since": since,
                "account": (active_account(catalog) or {}).get("id")}
    catalog.set_setting(_UNSURE_KEY, saved)


def _drop_unsure(catalog: Catalog, h: str) -> None:
    saved = _unsure(catalog)
    if saved.pop(h, None) is not None:
        catalog.set_setting(_UNSURE_KEY, saved)


def _went_up_last_time(catalog: Catalog, client, h: str) -> dict | None:
    """The track an earlier, unanswered post of this file made, or None when it never
    arrived. Raises when SoundCloud can't be asked, so the mix is never sent again
    while it might already be there."""
    entry = _unsure(catalog).get(h)
    if not entry or entry.get("account") != (active_account(catalog) or {}).get("id"):
        return None
    finder = getattr(client, "find_posted", None)
    if finder is None:
        return None
    found = finder(entry.get("title") or "", float(entry.get("since") or 0))
    if found is None:
        _drop_unsure(catalog, h)
    return found


def _is_connection_drop(exc: BaseException) -> bool:
    import requests
    return isinstance(exc, (requests.ConnectionError, requests.Timeout))


def run_upload(catalog: Catalog, items: list[dict], defaults: dict | None = None,
               progress=None, cancel=None, force: bool = False,
               release_at: str | None = None, abort=None) -> dict:
    """Upload each item to SoundCloud, skipping anything already published (by hash).

    `items`  : [{path, title?, description?, sharing?, genre?, tags?}, ...]
    `defaults`: fallback metadata from config (sharing/genre/tags/title_template).
    `cancel` : a callable returning True to stop between tracks.
    `abort`  : a callable returning True to stop now, cutting off the mix going up.
    `release_at`: if set, each track is uploaded PRIVATE and a pending release is
                  recorded to flip it public at that ISO time (scheduled release).
    Returns a summary dict; emits live progress events through `progress`.
    """
    global _uploading
    defaults = defaults or {}
    abort = abort or (lambda: False)
    _cancel = cancel or (lambda: False)
    cancel = lambda: _cancel() or abort()  # noqa: E731

    def emit(ev):
        if progress:
            progress(ev)

    with _upload_lock:
        _uploading += 1
    results: list[UploadResult] = []
    ok = skipped = errors = 0
    cancelled = False
    stop: dict | None = None  # SoundCloud refused the sign-in or asked us to wait
    try:
        if not connected(catalog):
            emit({"type": "upload_error", "error": "not_connected"})
            return {"ok_count": 0, "error_count": 0, "skipped_count": 0,
                    "results": [], "error": "not_connected"}
        client = client_for(catalog)
        uploaded = catalog.uploaded_hashes()
        run_songs: dict[str, list[dict]] = {}  # songs posted earlier in this same run
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
            emit({"type": "track_start", "index": i, "name": name, "path": path,
                  "total": total})
            sending = None  # (title, start time) once the file is going to SoundCloud
            h = item.get("file_hash")
            try:
                size = Path(path).stat().st_size
                h = h or _hashed(catalog, path, size, Path(path).stat().st_mtime)
                with _post_lock:
                    # Check the catalog again right before sending: another run may
                    # have posted this mix since this run started.
                    if not force and (h in uploaded or catalog.upload_by_hash(h)):
                        skipped += 1
                        results.append(UploadResult(name=name, status="skipped", file_hash=h))
                        emit({"type": "track_skipped", "index": i, "name": name, "path": path,
                              "reason": "duplicate"})
                        continue
                    # The same song in another format or version: only when the
                    # producer said to post it anyway (the Upload page asks first).
                    hit = None if (force or item.get("allow_double")) else _song_on_soundcloud(
                        catalog, path, name, size, h, run_songs)
                    if hit:
                        skipped += 1
                        note = double_note(hit)
                        results.append(UploadResult(name=name, status="skipped", file_hash=h,
                                                    error=note))
                        emit({"type": "track_skipped", "index": i, "name": name, "path": path,
                              "reason": "same_song", "note": note,
                              "permalink_url": hit.get("permalink_url")})
                        continue
                    meta = _meta_for(item, defaults)
                    if release_at:
                        meta.sharing = "private"  # publish privately, flip public later
                    # The last post of this very file lost its answer: it may be up.
                    earlier = None if force else _went_up_last_time(catalog, client, h)
                    if earlier is not None:
                        url = earlier.get("permalink_url")
                        catalog.record_upload(
                            title=earlier.get("title") or meta.title, file_path=path,
                            file_hash=h, size=size, sharing=earlier.get("sharing") or meta.sharing,
                            status="uploaded", timestamp=default_timestamp(),
                            sc_track_id=earlier.get("id"), permalink_url=url,
                            account=account_label(catalog))
                        _drop_unsure(catalog, h)
                        uploaded[h] = {"permalink_url": url, "title": earlier.get("title")}
                        skipped += 1
                        note = "It went up last time, before the connection dropped."
                        results.append(UploadResult(name=name, status="skipped", file_hash=h,
                                                    sc_track_id=earlier.get("id"),
                                                    permalink_url=url, error=note))
                        emit({"type": "track_skipped", "index": i, "name": name, "path": path,
                              "reason": "already_up", "note": note, "permalink_url": url})
                        continue

                    def on_prog(sent, tot, _i=i, _n=name, _p=path):
                        if abort():
                            raise UploadStopped()
                        emit({"type": "track_progress", "index": _i, "name": _n, "path": _p,
                              "sent": sent, "size": tot})

                    art = item.get("artwork_path") or default_art
                    if art and not Path(art).is_file():
                        art = None
                    with tempfile.TemporaryDirectory(prefix="lazyup-cover-") as tmp:
                        if not art and item.get("auto_cover"):
                            art = auto_cover_file(catalog, path, meta.title, tmp)
                        sending = (meta.title, time.time())
                        track = client.upload(path, meta, on_progress=on_prog, artwork_path=art)
                    if h:
                        _drop_unsure(catalog, h)
                    tid = track.get("id")
                    url = track.get("permalink_url")
                    if release_at and tid is not None:
                        add_pending_release(catalog, tid, release_at,
                                            (active_account(catalog) or {}).get("id"), meta.title)
                    # Persist the resolved Backups link so the Manage join stays collision-proof
                    # even if the title is later renamed on SoundCloud. Backups' exact file
                    # link first; else a strict name match (a shared name anchors nothing).
                    pm = projectmeta.resolve(path, name) or {}
                    catalog.record_upload(
                        title=meta.title, file_path=path, file_hash=h, size=size,
                        sharing=meta.sharing, status="uploaded", timestamp=default_timestamp(),
                        sc_track_id=tid, permalink_url=url, account=account_label(catalog),
                        backups_project=pm.get("project"),
                        backups_project_id=pm.get("project_id"))
                    uploaded[h] = {"permalink_url": url, "title": meta.title}
                    try:
                        songs.add_seen_track(catalog, (active_account(catalog) or {}).get("id"),
                                             {"id": tid, "title": meta.title, "permalink_url": url})
                    except Exception:
                        pass
                    run_songs.setdefault(songs.song_key(name), []).append(
                        {"title": meta.title, "format": songs.fmt(Path(path).suffix),
                         "duration": None, "permalink_url": url, "created_at": default_timestamp(),
                         "file_hash": h, "path": path, "id": tid})
                    ok += 1
                    results.append(UploadResult(name=name, status="uploaded", file_hash=h,
                                                sc_track_id=tid, permalink_url=url))
                    if tid is not None and not item.get("no_auto_playlist"):
                        file_into_playlist(catalog, tid, meta.genre, meta.sharing)
                emit({"type": "track_done", "index": i, "name": name, "path": path,
                      "permalink_url": url})
            except UploadStopped as e:
                # Stopped by hand mid-transfer: not a failure, and nothing is written
                # to History. SoundCloud drops a transfer cut off half-way.
                cancelled = True
                results.append(UploadResult(name=name, status="error", error=str(e) or "stopped"))
                emit({"type": "track_error", "index": i, "name": name, "path": path,
                      "error": "Stopped before it finished.", "reason": short_reason(e),
                      "stopped": True})
                break
            except Exception as e:  # one bad track must not abort the batch
                errors += 1
                msg = str(e)[:300]
                if sending and h and _is_connection_drop(e):
                    _note_unsure(catalog, h, *sending)  # it may be up; check before sending again
                catalog.record_upload(
                    title=name, file_path=path, file_hash=item.get("file_hash"),
                    size=item.get("size", 0), sharing=defaults.get("sharing", "public"),
                    status="error", timestamp=default_timestamp(), error=msg,
                    account=account_label(catalog))
                results.append(UploadResult(name=name, status="error", error=msg))
                emit({"type": "track_error", "index": i, "name": name, "path": path,
                      "error": msg, "reason": short_reason(e)})
                # Signed out or asked to wait: every other mix would be sent in full only
                # to be refused the same way, so stop here (like the bulk edit does).
                if isinstance(e, soundcloud.RateLimitError):
                    stop = {"kind": "rate_limit", "note": short_reason(e),
                            "wait_seconds": e.wait_seconds}
                elif isinstance(e, soundcloud.AuthError):
                    stop = {"kind": "signed_out" if isinstance(e, soundcloud.SignedOutError)
                            else "refused", "note": short_reason(e), "wait_seconds": None}
                if stop:
                    break
        not_sent = len(items) - len(results) if (stop or cancelled) else 0
        done = {"type": "upload_done", "ok_count": ok, "error_count": errors,
                "skipped_count": skipped, "cancelled": cancelled}
        if stop:
            done.update(stopped=stop["kind"], stop_note=stop["note"],
                        wait_seconds=stop["wait_seconds"], not_sent=not_sent)
        emit(done)
        out = {"ok_count": ok, "error_count": errors, "skipped_count": skipped,
               "cancelled": cancelled, "results": [r.__dict__ for r in results]}
        if stop:
            out.update(stopped=stop["kind"], stop_note=stop["note"],
                       wait_seconds=stop["wait_seconds"], not_sent=not_sent)
        return out
    finally:
        with _upload_lock:
            _uploading -= 1


# ---- new versions of songs already on SoundCloud ---------------------------
# Re-export a song that is already up and the new file is a NEW VERSION of it. Posting
# it swaps it in: the new file goes up with the old upload's title, description,
# genre, tags, privacy and cover, and takes the old one's place in every playlist.
# SoundCloud doesn't let an app change the audio inside a track, so the old upload
# stays (with its plays and comments) and is marked "replaced": the producer removes
# it with one click in Your tracks. The app never deletes a track on its own.
# The automatic folder check does this by itself for PRIVATE songs (nobody's plays to
# lose); a public song waits for the producer's Update click on Upload.
REPLACED_KEY = "replaced_tracks"


def auto_new_versions(catalog: Catalog) -> bool:
    """Swap in new versions of private songs during the automatic folder check."""
    return bool((catalog.get_setting("config") or {}).get("auto_new_versions", True))


def replaced_tracks(catalog: Catalog) -> dict:
    """{old track id (str): {new_id, permalink_url, title, at}}."""
    saved = catalog.get_setting(REPLACED_KEY) or {}
    return saved if isinstance(saved, dict) else {}


def _when(stamp) -> float | None:
    """A posted time ("2026-10-07 14:03:00" or ISO) as seconds; None if unknown."""
    if not stamp:
        return None
    for f in ("%Y-%m-%d %H:%M:%S", None):
        try:
            d = datetime.strptime(stamp, f) if f else datetime.fromisoformat(stamp)
            return d.timestamp()
        except (TypeError, ValueError):
            continue
    return None


def new_version_picks(mixes: list[dict], catalog: Catalog | None = None) -> list[dict]:
    """The rows that are a new version of a song already up: the newest file of each
    such song, made after the song was last posted. Never a short export, a stem, a
    lesser format or a draft (drafts have their own watch)."""
    wip = get_wip(catalog) if catalog is not None else {}
    newest: dict[str, dict] = {}
    for m in mixes:
        k = m.get("song") or (m.get("name") or "").strip().lower()
        if k not in newest or (m.get("mtime") or 0) > (newest[k].get("mtime") or 0):
            newest[k] = m
    picks = []
    for m in newest.values():
        on = m.get("on_soundcloud") or {}
        if (on.get("kind") != "version" or on.get("id") is None or m.get("uploaded")
                or m.get("superseded_by") or m.get("short") or m.get("stem") or m.get("wip")
                or _wip_norm(m.get("name", "")) in wip):
            continue
        posted = _when(on.get("posted_at"))
        if posted is not None and (m.get("mtime") or 0) <= posted:
            continue  # the song was posted after this file was made
        picks.append(m)
    return picks


def _cover_file(url: str | None, folder: str) -> str | None:
    """The old upload's cover, saved to a temporary file so the new version carries it.
    Best-effort: None when there is no cover or it can't be fetched."""
    if not url:
        return None
    try:
        if url.startswith("data:"):
            import base64
            head, data = url.split(",", 1)
            raw = base64.b64decode(data) if ";base64" in head else data.encode()
            ext = ".png" if "png" in head else ".jpg"
        elif url.startswith(("http://", "https://")):
            import requests
            r = requests.get(url, timeout=30)
            r.raise_for_status()
            raw = r.content
            ext = ".png" if url.lower().split("?")[0].endswith(".png") else ".jpg"
        else:
            return None
        out = Path(folder) / f"cover{ext}"
        out.write_bytes(raw)
        return str(out)
    except Exception:
        return None


def _swap_in_playlists(client, old_id, new_id) -> tuple[list[str], list[str]]:
    """Put the new version where the old one sits in each of the account's playlists.
    A playlist SoundCloud sent only part of is left alone (sending a short list would
    drop tracks). Returns (playlists changed, playlists left alone)."""
    moved, left = [], []
    for pl in client.list_playlists():
        ids = [t.get("id") for t in pl.get("tracks") or []]
        if old_id not in ids:
            continue
        if len(ids) < (pl.get("track_count") or 0):
            left.append(pl.get("title") or "")
            continue
        try:
            client.update_playlist(pl["id"], track_ids=[new_id if i == old_id else i for i in ids])
            moved.append(pl.get("title") or "")
        except Exception:
            left.append(pl.get("title") or "")
    return moved, left


def post_new_version(catalog: Catalog, mix: dict, progress=None) -> dict:
    """Post `mix` as the new version of its song on SoundCloud (see above). The old
    upload is only marked replaced, never deleted."""
    on = mix.get("on_soundcloud") or {}
    old_id = on.get("id")
    if old_id is None:
        raise RuntimeError("not_a_new_version")
    if not connected(catalog):
        raise RuntimeError("not_connected")
    client = client_for(catalog)
    old = next((t for t in client.list_tracks() if t.get("id") == old_id), None)
    if old is None:
        raise RuntimeError("old_track_gone")
    with tempfile.TemporaryDirectory(prefix="lazyup-cover-") as tmp:
        item = {"path": mix["path"], "name": mix.get("name"), "file_hash": mix.get("file_hash"),
                "title": strip_wip_tag(old.get("title") or "") or mix.get("name"),
                "description": old.get("description") or "", "sharing": old.get("sharing"),
                "genre": old.get("genre") or "", "tags": list(old.get("tags") or []),
                "downloadable": bool(old.get("downloadable")), "allow_double": True,
                # its old playlists are swapped over below, so no auto-playlist add
                "no_auto_playlist": True,
                "artwork_path": _cover_file(old.get("artwork_url"), tmp)}
        res = run_upload(catalog, [item], progress=progress)
    done = next((r for r in res.get("results", []) if r.get("status") == "uploaded"), None)
    if not done:
        r0 = (res.get("results") or [{}])[0]
        return {"ok": False, "error": r0.get("error") or res.get("error") or "not posted"}
    new_id = done.get("sc_track_id")
    moved, left = _swap_in_playlists(client, old_id, new_id) if new_id is not None else ([], [])
    saved = replaced_tracks(catalog)
    saved[str(old_id)] = {"new_id": new_id, "permalink_url": done.get("permalink_url"),
                          "title": item["title"], "at": default_timestamp()}
    catalog.set_setting(REPLACED_KEY, saved)
    return {"ok": True, "old_id": old_id, "new_id": new_id, "sharing": old.get("sharing"),
            "permalink_url": done.get("permalink_url"), "playlists": moved,
            "playlists_left": left}


def auto_post_new_versions(catalog: Catalog, mixes: list[dict], progress=None) -> list[dict]:
    """The automatic folder check's part: swap in new versions of PRIVATE songs only.
    A public song is left for the producer's Update click."""
    if not auto_new_versions(catalog) or not connected(catalog):
        return []
    picks = new_version_picks(mixes, catalog)
    if not picks:
        return []
    try:
        private = {t.get("id") for t in client_for(catalog).list_tracks()
                   if t.get("sharing") == "private"}
    except Exception:
        return []
    out = []
    for m in picks:
        if (m.get("on_soundcloud") or {}).get("id") not in private:
            continue
        try:
            out.append(post_new_version(catalog, m, progress=progress))
        except Exception:
            continue
    return out


# ---- work-in-progress (WIP) tracks ------------------------------------------
# A WIP track is one you're still iterating on. Marking it WIP keeps it private and
# WATCHES it: each new bounce is re-published privately, replacing the previous WIP
# upload so SoundCloud always shows the latest version. Keyed by normalized name so
# the flag survives re-renders (incl. version suffixes like "v2"/"master").
_WIP_KEY = "wip_tracks"
_WIP_TAG = "[WIP]"


def _wip_norm(name: str) -> str:
    # The song key, so "Episode 101" never replaces a WIP "Episode 100".
    return songs.song_key(name)


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
    if not isinstance(raw, dict):
        return {}
    # Keyed by the current song key of the name the user marked, so entries saved by an
    # older version (which dropped trailing numbers) still match the right song.
    out: dict = {}
    for k, e in raw.items():
        name = e.get("name") if isinstance(e, dict) else None
        out.setdefault(_wip_norm(name) if name else k, e)
    return out


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
        if m.get("superseded_by") or m.get("short") or m.get("stem"):
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
                "size": m.get("size"), "sharing": "private", "allow_double": True,
                "genre": m.get("genre") or None,
                "tags": [f"{m['bpm']} BPM"] if m.get("bpm") else None,
                "auto_cover": auto_cover_on(catalog)}
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
