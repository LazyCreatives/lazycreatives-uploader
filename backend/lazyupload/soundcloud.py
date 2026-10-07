"""SoundCloud API client — OAuth2 (Authorization Code + PKCE) and track upload.

Reference: https://developers.soundcloud.com/docs/api/guide

Auth model
  - The *developer* (you) registers ONE API app (requires a SoundCloud Artist Pro
    subscription) and bakes its client_id/client_secret into the build via
    LAZYUP_SC_CLIENT_ID / LAZYUP_SC_CLIENT_SECRET (or a git-ignored _buildsecret.py).
  - Each *end user* signs in once via the browser (Authorization Code + PKCE). We
    store their access+refresh tokens locally and refresh as needed.

Token lifetime
  - Access tokens last ~1 hour. Refresh tokens are SINGLE-USE: every refresh returns
    a new refresh_token, so we MUST persist the new one each time (handled by the
    `on_tokens` save callback) or the next refresh fails.

If no client credentials are configured (dev, or before your app is approved),
`get_client` returns a MockSoundCloudClient that simulates connect + upload end to
end so the whole app is runnable offline.
"""
import base64
import hashlib
import mimetypes
import os
import re
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

import requests

AUTH_BASE = "https://secure.soundcloud.com"
API_BASE = "https://api.soundcloud.com"

# A fixed loopback redirect so it can be registered once in the SoundCloud app
# dashboard (SoundCloud requires redirect URIs to be pre-registered exactly).
DEFAULT_REDIRECT_PORT = 8765
DEFAULT_REDIRECT_URI = f"http://127.0.0.1:{DEFAULT_REDIRECT_PORT}/callback"

# Upload: cap the time spent connecting / waiting on the server so a stalled socket
# can't hang the worker forever. The read timeout is per-read, not total, so it
# tolerates a long large-file transfer while still failing a dead connection.
_UPLOAD_TIMEOUT = (15, 900)


class SoundCloudError(Exception):
    """Base for friendly, user-facing SoundCloud failures."""


class RateLimitError(SoundCloudError):
    def __init__(self, retry_after: str | None = None):
        self.retry_after = retry_after
        hint = f" Try again in {retry_after}s." if retry_after else " Try again shortly."
        super().__init__("SoundCloud is rate-limiting uploads." + hint)


class AuthError(SoundCloudError):
    """The account's authorization was rejected — it needs reconnecting."""
    def __init__(self):
        super().__init__("SoundCloud rejected the account — please reconnect it.")


def _raise_for_status(r) -> None:
    """Turn HTTP errors into friendly, typed exceptions (esp. 429 / auth). Surfaces
    the provider's error_description so OAuth failures are diagnosable, not opaque."""
    if r.status_code == 429:
        raise RateLimitError(r.headers.get("Retry-After"))
    if r.status_code in (401, 403):
        raise AuthError()
    if r.status_code >= 400:
        detail = ""
        try:
            j = r.json()
            detail = j.get("error_description") or j.get("error") or ""
        except Exception:
            detail = (r.text or "").strip()[:300]
        msg = f"{r.status_code} {r.reason}"
        raise requests.HTTPError(f"{msg} — {detail}" if detail else msg, response=r)
    r.raise_for_status()


# ---- credentials ------------------------------------------------------------
def _client_id() -> str:
    cid = os.environ.get("LAZYUP_SC_CLIENT_ID")
    if cid:
        return cid
    try:
        from lazyupload._buildsecret import SC_CLIENT_ID  # type: ignore
        return SC_CLIENT_ID or ""
    except Exception:
        return ""


def _client_secret() -> str:
    cs = os.environ.get("LAZYUP_SC_CLIENT_SECRET")
    if cs:
        return cs
    try:
        from lazyupload._buildsecret import SC_CLIENT_SECRET  # type: ignore
        return SC_CLIENT_SECRET or ""
    except Exception:
        return ""


def _broker_url() -> str:
    url = os.environ.get("LAZYUP_BROKER_URL")
    if url:
        return url
    try:
        from lazyupload._buildsecret import BROKER_URL  # type: ignore
        return BROKER_URL or ""
    except Exception:
        return ""


def _broker_key() -> str:
    key = os.environ.get("LAZYUP_BROKER_KEY")
    if key:
        return key
    try:
        from lazyupload._buildsecret import BROKER_KEY  # type: ignore
        return BROKER_KEY or ""
    except Exception:
        return ""


def _use_broker() -> bool:
    """Prefer the token broker when configured — it mints tokens without shipping the
    client secret in the desktop build (see broker/)."""
    return bool(_client_id() and _broker_url())


def credentials_configured() -> bool:
    # Real auth needs the (public) client id plus EITHER a broker to mint tokens OR a
    # local client secret (dev / non-distributed).
    return bool(_client_id() and (_broker_url() or _client_secret()))


def use_mock() -> bool:
    """Force the mock with LAZYUP_MOCK=1, or fall back to it when no creds exist."""
    if os.environ.get("LAZYUP_MOCK") == "1":
        return True
    return not credentials_configured()


# ---- PKCE -------------------------------------------------------------------
def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def new_pkce() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for the S256 PKCE flow."""
    verifier = _b64url(secrets.token_bytes(48))
    challenge = _b64url(hashlib.sha256(verifier.encode()).digest())
    return verifier, challenge


def new_state() -> str:
    return secrets.token_urlsafe(24)


def authorize_url(redirect_uri: str, state: str, code_challenge: str) -> str:
    from urllib.parse import urlencode
    q = urlencode({
        "client_id": _client_id(),
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "state": state,
    })
    return f"{AUTH_BASE}/authorize?{q}"


# ---- token exchange ---------------------------------------------------------
def _normalize(body: dict) -> dict:
    # Absolute expiry so callers don't have to track request time. 60s skew.
    body["expires_at"] = time.time() + int(body.get("expires_in", 3600)) - 60
    return body


def _direct_token(payload: dict) -> dict:
    """Talk to SoundCloud's token endpoint directly (needs the client secret).

    SoundCloud's `authorization_code` / `refresh_token` grants expect the client
    credentials in the FORM BODY (their `client_credentials` grant, by contrast, wants
    HTTP Basic — but the desktop app never uses that grant). Sending Basic here is
    rejected with `invalid_request` because SoundCloud can't find the client_id it needs
    to match the authorization code, so callers put client_id/client_secret in `payload`."""
    r = requests.post(f"{AUTH_BASE}/oauth/token", data=payload, timeout=20,
                      headers={"Accept": "application/json"})
    if r.status_code >= 400:  # log the raw provider response for diagnosis
        import sys
        print(f"[oauth] token grant={payload.get('grant_type')} -> {r.status_code}: "
              f"{(r.text or '')[:500]}", file=sys.stderr)
    _raise_for_status(r)
    return r.json()


def _broker_post(path: str, payload: dict) -> dict:
    """Mint tokens via the broker, which holds the client secret server-side."""
    headers = {"Accept": "application/json"}
    if _broker_key():
        headers["X-App-Key"] = _broker_key()
    # Generous timeout: a free-tier host can take most of a minute to wake up, and a
    # refresh token is single-use, so giving up early can lose the new one.
    r = requests.post(_broker_url().rstrip("/") + path, json=payload, timeout=90, headers=headers)
    _raise_for_status(r)
    return r.json()


def exchange_code(code: str, redirect_uri: str, code_verifier: str) -> dict:
    if _use_broker():
        return _normalize(_broker_post("/exchange", {
            "code": code, "redirect_uri": redirect_uri, "code_verifier": code_verifier}))
    return _normalize(_direct_token({
        "grant_type": "authorization_code",
        "client_id": _client_id(),
        "client_secret": _client_secret(),
        "redirect_uri": redirect_uri,
        "code_verifier": code_verifier,
        "code": code,
    }))


def refresh_tokens(refresh_token: str) -> dict:
    if _use_broker():
        return _normalize(_broker_post("/refresh", {"refresh_token": refresh_token}))
    return _normalize(_direct_token({
        "grant_type": "refresh_token",
        "client_id": _client_id(),
        "client_secret": _client_secret(),
        "refresh_token": refresh_token,
    }))


# ---- file wrapper for real upload progress ----------------------------------
class _ProgressFile:
    """Wrap a file so requests streams it while we report bytes-sent progress."""
    def __init__(self, path: Path, on_progress: Optional[Callable[[int, int], None]]):
        self._f = open(path, "rb")
        self._total = path.stat().st_size
        self._sent = 0
        self._cb = on_progress

    def read(self, size=-1):
        chunk = self._f.read(size)
        if chunk and self._cb:
            self._sent += len(chunk)
            self._cb(self._sent, self._total)
        return chunk

    # urllib3 inspects these to compute Content-Length and to rewind on retry.
    def __len__(self):
        return self._total

    def seek(self, *a):
        self._sent = 0
        return self._f.seek(*a)

    def tell(self):
        return self._f.tell()

    def fileno(self):
        return self._f.fileno()

    def close(self):
        self._f.close()


def _tag_list(tags: list[str]) -> str:
    # SoundCloud tag_list is space-separated; multi-word tags must be quoted.
    return " ".join(f'"{t}"' if " " in t else t for t in tags if t)


def _parse_tag_list(raw: str) -> list[str]:
    """Inverse of _tag_list — split a SoundCloud tag_list back into tags, honouring
    the quoting of multi-word tags."""
    import shlex
    try:
        return [t for t in shlex.split(raw or "") if t]
    except ValueError:
        return [t for t in (raw or "").split() if t]


def _iso_created_at(raw) -> str | None:
    """SoundCloud returns created_at as 'YYYY/MM/DD HH:MM:SS +0000' (not ISO). Convert to
    ISO so the Manage UI can sort/format it; empty/unparseable values become None (which
    sorts last) — the mock writes '' for freshly uploaded tracks."""
    s = (raw or "").strip() if isinstance(raw, str) else (raw or "")
    if not s:
        return None
    for fmt in ("%Y/%m/%d %H:%M:%S %z", "%Y/%m/%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).isoformat()
        except (ValueError, TypeError):
            continue
    return s  # already ISO-ish or unknown — leave for the UI to handle


def _hires_artwork(url):
    """SoundCloud returns artwork as a ~100px '-large.jpg'. Bump it to the 500px variant
    so Manage thumbnails aren't blurry (mirrors the avatar upgrade in coverart)."""
    if not url:
        return url
    return re.sub(r"-(large|t\d+x\d+|badge|small|tiny|crop|original)\.(jpg|jpeg|png)(\?.*)?$",
                  r"-t500x500.\2", url)


def normalize_comment(raw: dict) -> dict:
    """A comment as the app uses it: where it sits in the track (seconds; None when it
    isn't pinned to a moment), the text, who left it and when."""
    user = raw.get("user") or {}
    ts = raw.get("timestamp")
    try:
        at = round(int(ts) / 1000, 2) if ts is not None and int(ts) >= 0 else None
    except (TypeError, ValueError):
        at = None
    return {"t": at, "body": str(raw.get("body") or ""),
            "user": user.get("username") or raw.get("username") or "",
            "avatar_url": user.get("avatar_url"),
            "created_at": _iso_created_at(raw.get("created_at"))}


def _num_id(raw: dict):
    """The number SoundCloud knows an item by. Newer replies may carry only the
    "urn" label ("soundcloud:tracks:123"), so fall back to the number at its end."""
    if raw.get("id") is not None:
        return raw.get("id")
    m = re.search(r":(\d+)$", str(raw.get("urn") or ""))
    return int(m.group(1)) if m else None


def _urn(kind: str, item_id) -> str:
    """SoundCloud's label for an item, e.g. soundcloud:tracks:123. Playlist changes
    must name their tracks this way; the old {"id": 123} form is refused."""
    return f"soundcloud:{kind}:{int(item_id)}"


def normalize_track(raw: dict) -> dict:
    """Flatten a SoundCloud (or mock) track into the shape the UI manages."""
    dur_ms = raw.get("duration") or 0
    return {
        "id": _num_id(raw),
        "title": raw.get("title") or "",
        "description": raw.get("description") or "",
        "sharing": raw.get("sharing") or "public",
        "genre": raw.get("genre") or "",
        "tags": raw.get("tags") if isinstance(raw.get("tags"), list)
                else _parse_tag_list(raw.get("tag_list", "")),
        "permalink_url": raw.get("permalink_url"),
        "artwork_url": _hires_artwork(raw.get("artwork_url")),
        "duration": round(dur_ms / 1000) or None,
        "playback_count": raw.get("playback_count"),
        "downloadable": raw.get("downloadable"),
        "created_at": _iso_created_at(raw.get("created_at")),
        # Surfaced for Manage-side de-dupe (same title uploaded as e.g. FLAC + MP3).
        "original_format": (raw.get("original_format") or None),
        "original_content_size": raw.get("original_content_size"),
        # Peak data source for generated waveform cover art.
        "waveform_url": raw.get("waveform_url"),
    }


def normalize_playlist(raw: dict) -> dict:
    """Flatten a SoundCloud (or mock) playlist ("set") into the shape the UI shows.
    Its tracks keep their order; tracks by other people are kept (with `user`), since
    a set can hold anyone's tracks."""
    tracks = []
    for t in raw.get("tracks") or []:
        if not isinstance(t, dict) or _num_id(t) is None:
            continue
        nt = normalize_track(t)
        nt["user"] = (t.get("user") or {}).get("username") or ""
        tracks.append(nt)
    dur_ms = raw.get("duration")
    if dur_ms is None:
        dur_ms = sum(int(t.get("duration") or 0) for t in raw.get("tracks") or [] if isinstance(t, dict))
    return {
        "id": _num_id(raw),
        "title": raw.get("title") or "",
        "description": raw.get("description") or "",
        "sharing": raw.get("sharing") or "public",
        "permalink_url": raw.get("permalink_url"),
        "artwork_url": _hires_artwork(raw.get("artwork_url")),
        "duration": round(int(dur_ms or 0) / 1000) or None,
        # SoundCloud's own count leaves out private tracks, so a set holding private
        # tracks says too few; count what it sent when that is more.
        "track_count": max(raw.get("track_count") or 0, len(tracks)),
        "created_at": _iso_created_at(raw.get("created_at")),
        "last_modified": _iso_created_at(raw.get("last_modified")),
        "tracks": tracks,
    }


def _playlist_body(title=None, sharing=None, track_ids=None, description=None) -> dict:
    """The JSON body SoundCloud's /playlists endpoints take. `track_ids` is the whole,
    ordered list (SoundCloud replaces the set's tracks with it)."""
    body: dict = {}
    if title is not None:
        body["title"] = title
    if sharing is not None:
        body["sharing"] = sharing
    if description is not None:
        body["description"] = description
    if track_ids is not None:
        body["tracks"] = [{"urn": _urn("tracks", i)} for i in track_ids]
    return {"playlist": body}


# ---- the real client --------------------------------------------------------
class SoundCloudClient:
    """Holds tokens for one connected account and talks to the SoundCloud API.

    `tokens` is the persisted dict ({access_token, refresh_token, expires_at, ...}).
    `on_tokens` is called whenever tokens change so the caller can re-persist them
    (critical: refresh tokens are single-use).
    """
    is_mock = False

    def __init__(self, tokens: dict, on_tokens: Optional[Callable[[dict], None]] = None):
        self.tokens = dict(tokens or {})
        self._on_tokens = on_tokens

    def _save(self) -> None:
        if self._on_tokens:
            self._on_tokens(self.tokens)

    def _access_token(self) -> str:
        if time.time() >= float(self.tokens.get("expires_at", 0)):
            rt = self.tokens.get("refresh_token")
            if not rt:
                raise RuntimeError("SoundCloud session expired — reconnect your account.")
            fresh = refresh_tokens(rt)
            # Keep any fields the refresh response omits (e.g. username we stored).
            self.tokens = {**self.tokens, **fresh}
            self._save()
        return self.tokens["access_token"]

    def _headers(self) -> dict:
        return {"Authorization": f"OAuth {self._access_token()}", "Accept": "application/json"}

    def me(self) -> dict:
        r = requests.get(f"{API_BASE}/me", headers=self._headers(), timeout=20)
        _raise_for_status(r)
        return r.json()

    def upload(self, file_path: str, meta, on_progress=None, artwork_path=None) -> dict:
        """Upload one audio file. `meta` is a models.TrackMeta. `artwork_path` optionally
        sets the cover art in the same request. Returns the track dict."""
        path = Path(file_path)
        data = {
            "track[title]": meta.title,
            "track[sharing]": meta.sharing,
            "track[description]": meta.description or "",
            "track[downloadable]": "true" if meta.downloadable else "false",
        }
        if meta.genre:
            data["track[genre]"] = meta.genre
        if meta.tags:
            data["track[tag_list]"] = _tag_list(meta.tags)
        pf = _ProgressFile(path, on_progress)
        art_fh = None
        try:
            files = {"track[asset_data]": (path.name, pf, "application/octet-stream")}
            ap = Path(artwork_path) if artwork_path else None
            if ap and ap.is_file():
                art_fh = open(ap, "rb")
                ctype = mimetypes.guess_type(ap.name)[0] or "image/jpeg"
                files["track[artwork_data]"] = (ap.name, art_fh, ctype)
            started = time.time()
            try:
                r = requests.post(f"{API_BASE}/tracks", headers=self._headers(),
                                  data=data, files=files, timeout=_UPLOAD_TIMEOUT)
            except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError):
                # The answer never came back, but SoundCloud may well have the track:
                # look for it rather than report a failure, or "Try again" would post
                # the mix a second time.
                found = self._just_posted(meta.title, started)
                if found is None:
                    raise
                return found
            _raise_for_status(r)
            return r.json()
        finally:
            pf.close()
            if art_fh:
                art_fh.close()

    def _just_posted(self, title: str, since: float) -> dict | None:
        """The newest track on the account with this title, created since `since`
        (a few minutes' slack for clock drift), or None."""
        try:
            r = requests.get(f"{API_BASE}/me/tracks", headers=self._headers(),
                             params={"limit": 20}, timeout=30)
            _raise_for_status(r)
            body = r.json()
        except Exception:
            return None
        items = body.get("collection", []) if isinstance(body, dict) else body
        for raw in items or []:
            if (raw.get("title") or "") != title:
                continue
            when = _iso_created_at(raw.get("created_at"))
            try:
                ts = datetime.fromisoformat(when).timestamp() if when else None
            except ValueError:
                ts = None
            if ts is not None and ts >= since - 300:
                return raw
        return None

    def set_artwork(self, track_id: int, image_path: str) -> dict:
        """Replace a track's cover art (PUT track[artwork_data]). Returns the updated track."""
        ap = Path(image_path)
        if not ap.is_file():
            raise RuntimeError("Image file not found.")
        ctype = mimetypes.guess_type(ap.name)[0] or "image/jpeg"
        with open(ap, "rb") as fh:
            files = {"track[artwork_data]": (ap.name, fh, ctype)}
            r = requests.put(f"{API_BASE}/tracks/{track_id}", headers=self._headers(),
                             files=files, timeout=_UPLOAD_TIMEOUT)
        _raise_for_status(r)
        return normalize_track(r.json())

    # ---- manage existing uploads -------------------------------------------
    def list_tracks(self, page: int = 50, max_total: int = 2000) -> list[dict]:
        """Every track on the connected account (normalized), paginated so large
        libraries aren't silently truncated. Follows SoundCloud's next_href, bounded
        by max_total so a huge account can't stall the UI."""
        out: list[dict] = []
        url = f"{API_BASE}/me/tracks"
        params: dict | None = {"limit": page, "linked_partitioning": "true"}
        while url and len(out) < max_total:
            r = requests.get(url, headers=self._headers(), params=params, timeout=30)
            _raise_for_status(r)
            body = r.json()
            items = body.get("collection", []) if isinstance(body, dict) else body
            out.extend(normalize_track(t) for t in items)
            url = body.get("next_href") if isinstance(body, dict) else None
            params = None  # next_href already carries the cursor + params
        return out[:max_total]

    def update_track(self, track_id: int, fields: dict) -> dict:
        """Edit metadata / privacy on an existing track. `fields` may contain
        title, description, sharing, genre, tags."""
        data = {}
        for k in ("title", "description", "sharing", "genre"):
            if fields.get(k) is not None:
                data[f"track[{k}]"] = fields[k]
        if fields.get("tags") is not None:
            data["track[tag_list]"] = _tag_list(fields["tags"])
        if fields.get("downloadable") is not None:
            data["track[downloadable]"] = "true" if fields["downloadable"] else "false"
        r = requests.put(f"{API_BASE}/tracks/{track_id}", headers=self._headers(),
                         data=data, timeout=30)
        _raise_for_status(r)
        return normalize_track(r.json())

    def delete_track(self, track_id: int) -> None:
        r = requests.delete(f"{API_BASE}/tracks/{track_id}", headers=self._headers(), timeout=30)
        _raise_for_status(r)

    def list_comments(self, track_id: int, max_total: int = 200) -> list[dict]:
        """The comments left on a track, normalized (see normalize_comment), following
        next_href up to max_total."""
        out: list[dict] = []
        url = f"{API_BASE}/tracks/{track_id}/comments"
        params: dict | None = {"limit": 100, "linked_partitioning": "true"}
        while url and len(out) < max_total:
            r = requests.get(url, headers=self._headers(), params=params, timeout=30)
            _raise_for_status(r)
            body = r.json()
            items = body.get("collection", []) if isinstance(body, dict) else body
            out.extend(normalize_comment(c) for c in items if isinstance(c, dict))
            url = body.get("next_href") if isinstance(body, dict) else None
            params = None
        return out[:max_total]

    def add_comment(self, track_id: int, body: str, timestamp_ms: int = 0) -> dict:
        """Post a comment on a track. `timestamp_ms` anchors it to a playback position
        (0 = the very start). Used to leave a changelog when a WIP track is re-bounced."""
        payload = {"comment": {"body": body, "timestamp": int(timestamp_ms or 0)}}
        r = requests.post(f"{API_BASE}/tracks/{track_id}/comments",
                          headers=self._headers(), json=payload, timeout=30)
        _raise_for_status(r)
        return r.json()


    # ---- playlists ("sets") -------------------------------------------------
    def list_playlists(self, page: int = 50, max_total: int = 500) -> list[dict]:
        """Every playlist on the connected account, with its tracks in order."""
        out: list[dict] = []
        url = f"{API_BASE}/me/playlists"
        params: dict | None = {"limit": page, "linked_partitioning": "true", "show_tracks": "true"}
        while url and len(out) < max_total:
            r = requests.get(url, headers=self._headers(), params=params, timeout=30)
            _raise_for_status(r)
            body = r.json()
            items = body.get("collection", []) if isinstance(body, dict) else body
            out.extend(normalize_playlist(p) for p in items if isinstance(p, dict))
            url = body.get("next_href") if isinstance(body, dict) else None
            params = None
        return out[:max_total]

    def get_playlist(self, playlist_id: int) -> dict:
        r = requests.get(f"{API_BASE}/playlists/{_urn('playlists', playlist_id)}", headers=self._headers(),
                         params={"show_tracks": "true"}, timeout=30)
        _raise_for_status(r)
        return normalize_playlist(r.json())

    def create_playlist(self, title: str, sharing: str = "public", track_ids=None) -> dict:
        r = requests.post(f"{API_BASE}/playlists", headers=self._headers(),
                          json=_playlist_body(title, sharing, list(track_ids or [])), timeout=30)
        _raise_for_status(r)
        return normalize_playlist(r.json())

    def update_playlist(self, playlist_id: int, title=None, sharing=None, track_ids=None) -> dict:
        r = requests.put(f"{API_BASE}/playlists/{_urn('playlists', playlist_id)}", headers=self._headers(),
                         json=_playlist_body(title, sharing, track_ids), timeout=30)
        _raise_for_status(r)
        return normalize_playlist(r.json())

    def delete_playlist(self, playlist_id: int) -> None:
        r = requests.delete(f"{API_BASE}/playlists/{_urn('playlists', playlist_id)}", headers=self._headers(), timeout=30)
        _raise_for_status(r)


# ---- the mock client --------------------------------------------------------
def _slug(title: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in title.lower()).strip("-") or "mix"


def _mock_length_ms(path) -> int:
    """How long a demo upload is, as SoundCloud would report it (WAV only; else 0)."""
    try:
        import wave
        with wave.open(str(path), "rb") as w:
            return int(w.getnframes() * 1000 / max(1, w.getframerate()))
    except Exception:
        return 0


def _img_data_url(path) -> str | None:
    """Encode a local image as a data: URL so the mock's set cover renders under the
    packaged CSP (img-src 'self' data:); file:// would be blocked. Demo-only."""
    try:
        p = Path(path)
        if not p.is_file() or p.stat().st_size > 3_000_000:
            return None
        ctype = mimetypes.guess_type(p.name)[0] or "image/png"
        return f"data:{ctype};base64," + base64.b64encode(p.read_bytes()).decode()
    except Exception:
        return None


_SEED_TRACKS = [
    {"id": 900000001, "title": "Warehouse Set (2024)", "description": "Old live set.",
     "sharing": "public", "genre": "Techno", "tags": ["techno", "live set"],
     "permalink_url": "https://soundcloud.com/demo/warehouse-set", "duration": 3600000,
     "playback_count": 1240, "created_at": "2024/11/02 21:00:00 +0000"},
    {"id": 900000002, "title": "Rainy Day Beat", "description": "",
     "sharing": "private", "genre": "Lo-fi", "tags": ["lofi", "chill"],
     "permalink_url": "https://soundcloud.com/demo/rainy-day-beat", "duration": 142000,
     "playback_count": 0, "created_at": "2025/03/14 09:30:00 +0000"},
]


# Listeners' comments on the demo live set (kept apart from the library, which only
# holds what the app itself posted).
_SEED_COMMENTS = {
    900000001: [
        {"body": "this bassline!!", "timestamp": 412000, "user": {"username": "nightbus"},
         "created_at": "2024/11/03 10:12:00 +0000"},
        {"body": "the switch-up here", "timestamp": 1530000, "user": {"username": "mara.k"},
         "created_at": "2024/11/04 18:40:00 +0000"},
        {"body": "need an ID on this one", "timestamp": 2611000, "user": {"username": "dubplate_dan"},
         "created_at": "2024/11/09 22:05:00 +0000"},
    ],
}


# A demo playlist so the Playlists page has something in it on a fresh demo.
_SEED_PLAYLISTS = [
    {"id": 700000001, "title": "Late night", "sharing": "public",
     "permalink_url": "https://soundcloud.com/demo/sets/late-night",
     "created_at": "2025/03/20 22:00:00 +0000", "track_ids": [900000002, 900000001]},
]


class MockSoundCloudClient:
    """Stand-in used when no SoundCloud credentials are configured.

    Simulates a connected account, uploads, AND a managed library (list/edit/delete),
    persisted via `store` so the whole app is exercisable offline. `store` is any
    object with load()->list[dict] and save(list[dict]); without one it keeps an
    in-process library (handy for unit tests).
    """
    is_mock = True

    def __init__(self, tokens: dict | None = None, on_tokens=None, store=None, playlist_store=None):
        self.tokens = dict(tokens or {"username": "you (demo)", "access_token": "mock"})
        self._store = store
        self._mem: list[dict] | None = None
        self._pl_store = playlist_store
        self._pl_mem: list[dict] | None = None

    def me(self) -> dict:
        return {"username": self.tokens.get("username", "you (demo)"), "id": 0,
                "avatar_url": "https://a1.sndcdn.com/images/default_avatar_large.png"}

    def _load(self) -> list[dict]:
        if self._store is not None:
            lib = self._store.load()
        else:
            lib = self._mem
        if lib is None:  # first access — seed a believable demo library
            lib = [dict(t) for t in _SEED_TRACKS]
            self._save(lib)
        return lib

    def _save(self, lib: list[dict]) -> None:
        if self._store is not None:
            self._store.save(lib)
        else:
            self._mem = lib

    def upload(self, file_path: str, meta, on_progress=None, artwork_path=None) -> dict:
        total = max(1, Path(file_path).stat().st_size)
        sent = 0
        step = max(1, total // 12)
        while sent < total:
            sent = min(total, sent + step)
            if on_progress:
                on_progress(sent, total)
            time.sleep(0.05)  # feel like a real transfer without being slow
        # Real SoundCloud mints a new track id on every (re-)upload, so derive the mock
        # id from the file's content too — re-bouncing the same path yields a NEW track,
        # which is what the WIP replace + changelog flow relies on.
        try:
            with open(file_path, "rb") as fh:
                head = fh.read(65536)
        except OSError:
            head = file_path.encode()
        tid = abs(hash((file_path, total, head))) % 1_000_000_000
        track = {"id": tid, "title": meta.title, "sharing": meta.sharing,
                 "description": meta.description, "genre": meta.genre, "tags": list(meta.tags),
                 "permalink_url": f"https://soundcloud.com/demo/{_slug(meta.title)}",
                 "duration": _mock_length_ms(file_path), "playback_count": 0, "created_at": "",
                 "artwork_url": (_img_data_url(artwork_path) if artwork_path else None),
                 "original_format": (Path(file_path).suffix.lstrip(".").lower() or None),
                 "original_content_size": total}
        lib = self._load()
        lib.insert(0, track)
        self._save(lib)
        return track

    def set_artwork(self, track_id: int, image_path: str) -> dict:
        lib = self._load()
        for t in lib:
            if t.get("id") == track_id:
                t["artwork_url"] = _img_data_url(image_path) or t.get("artwork_url")
                self._save(lib)
                return normalize_track(t)
        raise RuntimeError("Track not found.")

    def list_tracks(self, limit: int = 200) -> list[dict]:
        return [normalize_track(t) for t in self._load()[:limit]]

    def update_track(self, track_id: int, fields: dict) -> dict:
        lib = self._load()
        for t in lib:
            if t.get("id") == track_id:
                for k in ("title", "description", "sharing", "genre", "tags", "downloadable"):
                    if fields.get(k) is not None:
                        t[k] = fields[k]
                self._save(lib)
                return normalize_track(t)
        raise RuntimeError("Track not found.")

    def delete_track(self, track_id: int) -> None:
        lib = self._load()
        kept = [t for t in lib if t.get("id") != track_id]
        if len(kept) == len(lib):
            raise RuntimeError("Track not found.")  # real SC returns 404 for an unknown id
        self._save(kept)

    def list_comments(self, track_id: int, max_total: int = 200) -> list[dict]:
        for t in self._load():
            if t.get("id") == track_id:
                said = t.get("comments") or _SEED_COMMENTS.get(track_id, [])
                return [normalize_comment(c) for c in said][:max_total]
        raise RuntimeError("Track not found.")

    def add_comment(self, track_id: int, body: str, timestamp_ms: int = 0) -> dict:
        comment = {"body": body, "timestamp": int(timestamp_ms or 0)}
        lib = self._load()
        for t in lib:
            if t.get("id") == track_id:
                t.setdefault("comments", []).append(comment)
                self._save(lib)
                break
        return comment


    # ---- playlists: kept as ids pointing into the demo library ----------------
    def _load_pl(self) -> list[dict]:
        pls = self._pl_store.load() if self._pl_store is not None else self._pl_mem
        if pls is None:
            pls = [dict(p, track_ids=list(p["track_ids"])) for p in _SEED_PLAYLISTS]
            self._save_pl(pls)
        return pls

    def _save_pl(self, pls: list[dict]) -> None:
        if self._pl_store is not None:
            self._pl_store.save(pls)
        else:
            self._pl_mem = pls

    def _render_pl(self, p: dict) -> dict:
        # A deleted track drops out of its playlists, as on SoundCloud.
        by_id = {t.get("id"): t for t in self._load()}
        tracks = [dict(by_id[i], user=self.tokens.get("username", "you (demo)"))
                  for i in p.get("track_ids", []) if i in by_id]
        first_art = next((t.get("artwork_url") for t in tracks if t.get("artwork_url")), None)
        return normalize_playlist({**p, "tracks": [dict(t, user={"username": t["user"]}) for t in tracks],
                                   "track_count": len(tracks), "artwork_url": p.get("artwork_url") or first_art})

    def list_playlists(self, page: int = 50, max_total: int = 500) -> list[dict]:
        return [self._render_pl(p) for p in self._load_pl()][:max_total]

    def get_playlist(self, playlist_id: int) -> dict:
        for p in self._load_pl():
            if p.get("id") == playlist_id:
                return self._render_pl(p)
        raise RuntimeError("Playlist not found.")

    def create_playlist(self, title: str, sharing: str = "public", track_ids=None) -> dict:
        pls = self._load_pl()
        pid = 700000000 + abs(hash((title, time.time()))) % 99_999_999
        p = {"id": pid, "title": title, "sharing": sharing,
             "permalink_url": f"https://soundcloud.com/demo/sets/{_slug(title)}",
             "created_at": datetime.now(timezone.utc).strftime("%Y/%m/%d %H:%M:%S +0000"),
             "track_ids": [int(i) for i in (track_ids or [])]}
        pls.insert(0, p)
        self._save_pl(pls)
        return self._render_pl(p)

    def update_playlist(self, playlist_id: int, title=None, sharing=None, track_ids=None) -> dict:
        pls = self._load_pl()
        for p in pls:
            if p.get("id") == playlist_id:
                if title is not None:
                    p["title"] = title
                if sharing is not None:
                    p["sharing"] = sharing
                if track_ids is not None:
                    p["track_ids"] = [int(i) for i in track_ids]
                p["last_modified"] = datetime.now(timezone.utc).strftime("%Y/%m/%d %H:%M:%S +0000")
                self._save_pl(pls)
                return self._render_pl(p)
        raise RuntimeError("Playlist not found.")

    def delete_playlist(self, playlist_id: int) -> None:
        pls = self._load_pl()
        kept = [p for p in pls if p.get("id") != playlist_id]
        if len(kept) == len(pls):
            raise RuntimeError("Playlist not found.")
        self._save_pl(kept)


def get_client(tokens: dict, on_tokens=None, store=None, playlist_store=None):
    """Return a real client when creds are configured, else the mock."""
    if use_mock():
        return MockSoundCloudClient(tokens, on_tokens, store, playlist_store)
    return SoundCloudClient(tokens, on_tokens)
