"""Sync an album to SoundCloud: one playlist holding the album's Ready songs in album
order. Songs not on SoundCloud yet go up first (private, unless the playlist is
already public). Songs still being worked on wait until they're Ready.

- Never posts a song twice: a song already up (this file, another format of it, or
  another version) uses what is there. Another version stays as it is; the producer
  posts the new one with Update on the Upload page, which swaps it in everywhere.
- The playlist is made private and keeps whatever privacy it is given later.
- A song taken off the album leaves the playlist but stays on SoundCloud.
- Where the playlist is goes into the shared album list, so Backups can show it too.
Audio files are only read (to post them), never changed.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from pathlib import Path

from lazyupload import projectmeta, service
from lazyupload.albums import Albums, judge_album
from lazyupload.catalog import Catalog


class AlbumGone(LookupError):
    pass


def _stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _on_soundcloud(catalog: Catalog, path: str) -> dict | None:
    """What of this song is on SoundCloud: {"kind": "same" | "version", "id", ...} or None."""
    p = Path(path)
    st = p.stat()
    h = service._hashed(catalog, path, st.st_size, st.st_mtime)
    hit = service._song_on_soundcloud(catalog, path, p.stem, st.st_size, h, {})
    return hit if hit and hit.get("id") is not None else None


def _find_playlist(client, link: dict | None) -> dict | None:
    """The album's playlist, if it is still on SoundCloud."""
    pid = (link or {}).get("playlist_id")
    if not pid:
        return None
    if not any(p.get("id") == pid for p in client.list_playlists()):
        return None  # deleted on SoundCloud: a new one is made
    return client.get_playlist(pid)


def sync(catalog: Catalog, store: Albums, album_id: str, artwork_path: str | None = None,
         song_art: dict[str, str] | None = None, progress=None, cancel=None, abort=None) -> dict:
    """Put the album on SoundCloud as a playlist. Returns what happened and keeps it with
    the album (`soundcloud` on the album)."""
    def step(text: str):
        if progress:
            progress({"type": "album_sync", "album_id": album_id, "step": text})

    service._need_connection(catalog)
    try:
        album = judge_album(store.get(album_id), projectmeta.find_backups_db())
    except LookupError:
        raise AlbumGone(album_id) from None
    link = album.get("soundcloud") or {}
    ready = [s for s in album["songs"] if s["is_ready"] and Path(s["path"]).is_file()]
    waiting = [s["title"] for s in album["songs"] if s not in ready]

    step("Checking what's already on SoundCloud")
    service._posted_map(catalog, refresh=True)   # the account's tracks, fresh
    client = service.client_for(catalog)
    playlist = _find_playlist(client, link)
    sharing = (playlist or {}).get("sharing") or "private"

    ids: dict[str, int] = {}
    older: list[str] = []
    to_post: list[dict] = []
    for s in ready:
        hit = _on_soundcloud(catalog, s["path"])
        if hit:
            ids[s["path"]] = int(hit["id"])
            if hit["kind"] == "version":
                older.append(s["title"])
        else:
            to_post.append(s)

    failed: list[str] = []
    stopped = None
    if to_post:
        items = [{"path": s["path"], "name": Path(s["path"]).stem, "title": s["title"],
                  "sharing": sharing, "genre": s.get("genre") or "", "no_auto_playlist": True,
                  **({"artwork_path": song_art[s["path"]]} if song_art and song_art.get(s["path"]) else {})}
                 for s in to_post]
        saved = catalog.get_setting("config") or {}
        defaults = {"sharing": sharing, "genre": saved.get("default_genre", ""),
                    "tags": saved.get("default_tags", []), "title_template": "{name}",
                    "description": saved.get("default_description", ""),
                    "downloadable": saved.get("downloadable", False)}

        def relay(ev):
            if ev.get("type") == "track_start":
                step(f"Posting {ev['index'] + 1} of {len(items)}: {to_post[ev['index']]['title']}")
            if progress:
                progress(ev)

        res = service.run_upload(catalog, items, defaults, relay, cancel, False, None, abort)
        for s, r in zip(to_post, res.get("results") or []):
            if r.get("sc_track_id") is not None:
                ids[s["path"]] = int(r["sc_track_id"])
            elif r.get("status") == "skipped":   # went up meanwhile, or last time
                hit = _on_soundcloud(catalog, s["path"])
                if hit:
                    ids[s["path"]] = int(hit["id"])
                else:
                    failed.append(s["title"])
            else:
                failed.append(s["title"])
        failed += [s["title"] for s in to_post[len(res.get("results") or []):]]
        stopped = res.get("stopped") or ("cancelled" if res.get("cancelled") else None)

    order = [ids[s["path"]] for s in ready if s["path"] in ids]
    order = list(dict.fromkeys(order))   # two album songs that are one track on SoundCloud
    title = album["title"]
    if not order and playlist is None:   # nothing to put in a playlist yet
        return {"ok": False, "stopped": stopped, "failed": failed, "posted": 0, "waiting": waiting, "on": 0}

    step("Saving the playlist")
    made = False
    if playlist is None:
        playlist = client.create_playlist(title, "private", order)
        made = True
    else:
        playlist = client.update_playlist(playlist["id"], title=title if playlist.get("title") != title else None,
                                          track_ids=order)
    cover_for = link.get("cover_for")
    if artwork_path and Path(artwork_path).is_file() and (made or cover_for != title):
        try:
            playlist = client.set_playlist_artwork(playlist["id"], artwork_path)
            cover_for = title
        except Exception:
            pass   # the songs are what matter; the cover can go on next time

    posted = len([s for s in to_post if s["path"] in ids])
    new_link = {
        "playlist_id": playlist["id"], "url": playlist.get("permalink_url"),
        "sharing": playlist.get("sharing") or "private", "synced_at": _stamp(),
        "on": len(order), "of": len(album["songs"]), "cover_for": cover_for,
        "waiting": waiting, "older": older, "failed": failed,
    }
    store.set_soundcloud(album_id, new_link)
    return {"ok": not failed and not stopped, "made": made, "posted": posted, "stopped": stopped,
            **new_link, "at": time.time()}
