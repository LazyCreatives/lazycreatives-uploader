"""One song, many files. A producer's export folder often holds the same mix as a WAV
and an MP3 (and a FLAC for a label), plus newer versions ("v2", "final", "master").
This module works out which files are the same song so the Upload page can show
one row per mix with all its formats, and so nothing is posted to SoundCloud twice.

Two words used throughout:
- a SONG is everything sharing a name once version words, dates and tempo are taken
  off (``song_key``): "Heavy", "Heavy v2" and "Heavy_master" are one song, while
  "Episode 100" and "Episode 101" are two.
- a MIX is one render of that song. Files of the same song whose lengths agree are the
  same mix in different formats; a different length means a different version.

Pure functions over the dicts the scanner returns, plus small helpers for what is
already on SoundCloud. Files are only read, never changed.
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from lazyupload import projectmeta

# Two exports of one mix differ by a fraction of a second (MP3 encoders pad the start
# and end). SoundCloud rounds lengths to whole seconds, so its tracks get more room.
SAME_LENGTH = 1.5
SAME_LENGTH_SC = 2.5

_LOSSLESS_EXTS = {".wav", ".aiff", ".aif", ".flac"}
_LOSSLESS_FORMATS = {"wav", "wave", "aif", "aiff", "flac", "alac"}


# Render words in brackets ("Heavy (Master)", "Heavy [Final Mix]") name the same song.
# Taken off here rather than in projectmeta.normalize, which must stay identical to
# Backups' (it matches mixes to Backups projects; song_key only groups songs here).
# Remixes, VIPs and extended mixes stay songs of their own.
_BRACKET_RENDER = re.compile(
    r"[\[(]\s*(?:(?:final|master(?:ed)?|mix(?:down)?|render|bounce|export|wip|draft)\s*)*"
    r"v?\d*\s*[\])]", re.I)


# A number that is a render count, not part of the title: after an underscore
# ("Heavy_2"), after "v" ("Heavy v2") or after a render word ("Heavy final 2").
# A bare number after a space is part of the title: "Episode 101" is not "Episode 100".
_UNDERSCORE_NUM = re.compile(r"_+v?(\d{1,3})(?=(?:\.[a-z0-9]{2,4})?$)", re.I)
_RENDER_WORDS = re.compile(
    r"[\s-]+(?:v\d+|(?:master(?:ed)?|final|mix(?:down)?|render|bounce|export|wip|draft)"
    r"(?:\s*v?\d+)?)\b")


def _fold(s: str) -> str:
    """Accents folded ("Áurea" -> "aurea"), letters of every script kept ("深夜"),
    punctuation, symbols and emoji turned into spaces, leading zeros dropped ("03" -> "3")."""
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    s = re.sub(r"[\W_]+", " ", s.casefold()).strip()
    return re.sub(r"\b0+(\d)", r"\1", s)


def song_key(name: str) -> str:
    """The song a file or title belongs to. Never empty for a non-empty name.

    Like ``projectmeta.normalize`` (dates, tempo, key and render words come off), but a
    number in the title stays: "Episode 100" and "Episode 101" are two songs, while
    "Heavy v2", "Heavy_2" and "Heavy final 2" are versions of "Heavy". Letters of any
    script stay, so "深夜 Tape 814" and "Tape 深夜 930" are two songs too."""
    s = _BRACKET_RENDER.sub(" ", name or "")
    s = _UNDERSCORE_NUM.sub(r" v\1", s)
    s = projectmeta._undecorate(s.lower().strip())
    s = _RENDER_WORDS.sub(" ", s)
    key = _fold(s)
    return key or (name or "").strip().lower()


def fmt(ext: str | None) -> str:
    return (ext or "").lstrip(".").upper()


def format_quality(m: dict) -> tuple:
    """Higher is better. Lossless beats lossy; within a tier the bigger file wins
    (a stand-in for bit depth / bitrate)."""
    return (1 if (m.get("ext") or "").lower() in _LOSSLESS_EXTS else 0, m.get("size") or 0)


def _same_mix(a: dict, b: dict) -> bool:
    """Are two files of one song the same render? Equal content always is. Otherwise
    they must be different formats; with both lengths known the lengths decide, and
    without them only an identical file name counts (HEAVY.wav + HEAVY.mp3)."""
    if a.get("file_hash") and a.get("file_hash") == b.get("file_hash"):
        return True
    if (a.get("ext") or "").lower() == (b.get("ext") or "").lower():
        return False  # two WAVs of one song are two versions, not two formats
    da, db = a.get("duration"), b.get("duration")
    if da is not None and db is not None:
        return abs(da - db) <= SAME_LENGTH
    return (a.get("name") or "").strip().lower() == (b.get("name") or "").strip().lower()


def group_formats(mixes: list[dict]) -> None:
    """In place. Each set of files that are one mix in several formats becomes one row:
    the best-quality file is the row (``superseded_by`` None) and lists every file of
    the mix in ``formats``; the others get ``superseded_by`` = the kept format and
    ``format_of`` = the kept file's path. Every file gets ``song`` (its song key)."""
    by_song: dict[str, list[dict]] = {}
    for m in mixes:
        m["song"] = song_key(m.get("name") or Path(m.get("path") or "").stem)
        m["superseded_by"] = None
        m.pop("dupe_formats", None)
        m.pop("formats", None)
        m.pop("format_of", None)
        by_song.setdefault(m["song"], []).append(m)
    for files in by_song.values():
        clusters: list[list[dict]] = []
        for m in sorted(files, key=format_quality, reverse=True):
            home = next((c for c in clusters if any(_same_mix(m, x) for x in c)), None)
            if home is None:
                clusters.append([m])
            else:
                home.append(m)
        for c in clusters:
            if len(c) < 2:
                continue
            best = c[0]
            best["dupe_formats"] = sorted({fmt(x.get("ext")) for x in c[1:]})
            best["formats"] = [{"path": x["path"], "format": fmt(x.get("ext")),
                                "size": x.get("size"), "uploaded": bool(x.get("uploaded"))}
                               for x in c]
            for x in c[1:]:
                x["superseded_by"] = fmt(best.get("ext"))
                x["format_of"] = best["path"]


# ---- what is already on SoundCloud ------------------------------------------
# Three sources, strongest first: files this app posted (by content), anything this
# app posted (by song name, from History), and the tracks last seen on the account
# (covers songs posted on the SoundCloud website or from another computer).
SC_SEEN_KEY = "sc_tracks_seen"


def remember_sc_tracks(catalog, account_id, tracks: list[dict], when: float) -> None:
    """Keep a light copy of the account's tracks so a folder check can spot songs that
    are already up without asking SoundCloud every time."""
    slim = [{"id": t.get("id"), "title": t.get("title") or "", "duration": t.get("duration"),
             "format": (t.get("original_format") or "").upper() or None,
             "permalink_url": t.get("permalink_url"), "created_at": t.get("created_at")}
            for t in tracks]
    catalog.set_setting(SC_SEEN_KEY, {"account": account_id, "at": when, "tracks": slim})


def add_seen_track(catalog, account_id, track: dict) -> None:
    """A track this app just posted joins the copy of the account's tracks, so it is
    never mistaken for one removed on SoundCloud before the next full look."""
    saved = catalog.get_setting(SC_SEEN_KEY) or {}
    if not isinstance(saved, dict) or saved.get("account") != account_id:
        return
    saved["tracks"] = list(saved.get("tracks") or []) + [{
        "id": track.get("id"), "title": track.get("title") or "", "duration": None,
        "format": None, "permalink_url": track.get("permalink_url"), "created_at": None}]
    catalog.set_setting(SC_SEEN_KEY, saved)


def seen_sc_tracks(catalog, account_id) -> tuple[list[dict], float]:
    """(tracks, when) last seen on this account; ([], 0) if never or another account."""
    saved = catalog.get_setting(SC_SEEN_KEY) or {}
    if not isinstance(saved, dict) or saved.get("account") != account_id:
        return [], 0.0
    return list(saved.get("tracks") or []), float(saved.get("at") or 0)


def posted_songs(uploads: list[dict], sc_tracks: list[dict]) -> dict[str, list[dict]]:
    """{song key: [what is on SoundCloud for it]} from this app's posts and the account.
    Each entry: {title, format, duration, permalink_url, created_at, file_hash, path}."""
    out: dict[str, list[dict]] = {}
    seen_ids: set = set()
    for u in uploads:
        stem = Path(u.get("file_path") or "").stem
        entry = {"title": u.get("title") or stem, "format": fmt(Path(u.get("file_path") or "").suffix) or None,
                 "duration": None, "permalink_url": u.get("permalink_url"),
                 "created_at": u.get("timestamp"), "file_hash": u.get("file_hash"),
                 "path": u.get("file_path"), "id": u.get("sc_track_id")}
        keys = {song_key(stem)} if stem else set()
        if u.get("title"):
            keys.add(song_key(_strip_wip(u["title"])))
        for k in keys - {""}:
            out.setdefault(k, []).append(entry)
        if u.get("sc_track_id") is not None:
            seen_ids.add(u.get("sc_track_id"))
    for t in sc_tracks:
        k = song_key(_strip_wip(t.get("title") or ""))
        if not k:
            continue
        if t.get("id") in seen_ids:
            # Posted by this app: add the length SoundCloud knows to that entry.
            for e in out.get(k, []):
                if e.get("id") == t.get("id"):
                    e["duration"] = t.get("duration")
                    e["format"] = e.get("format") or t.get("format")
            continue
        out.setdefault(k, []).append({"title": t.get("title"), "format": t.get("format"),
                                      "duration": t.get("duration"),
                                      "permalink_url": t.get("permalink_url"),
                                      "created_at": t.get("created_at"), "file_hash": None,
                                      "path": None, "id": t.get("id")})
    return out


def _strip_wip(title: str) -> str:
    return re.sub(r"\s*[\[(]\s*wip\s*[\])]\s*$", "", title or "", flags=re.I).strip()


def match_on_soundcloud(m: dict, posted: list[dict], formats: list[dict] | None = None) -> dict | None:
    """What of this mix's song is on SoundCloud, or None.

    kind "same": this very mix is up (another of its formats, or a track of the same
    length). kind "version": a different version of the song is up."""
    if not posted:
        return None
    hashes = {f.get("file_hash") for f in (formats or [])} | {m.get("file_hash")}
    paths = {f.get("path") for f in (formats or [])} | {m.get("path")}
    hashes.discard(None)
    dur = m.get("duration")
    same = None
    for p in posted:
        if (p.get("file_hash") and p["file_hash"] in hashes) or (p.get("path") and p["path"] in paths):
            same = p
            break
        if dur is not None and p.get("duration") is not None and abs(dur - p["duration"]) <= SAME_LENGTH_SC:
            same = same or p
    pick = same or max(posted, key=lambda p: p.get("created_at") or "")
    return {"kind": "same" if same else "version", "title": pick.get("title"), "id": pick.get("id"),
            "format": pick.get("format"), "permalink_url": pick.get("permalink_url"),
            "posted_at": pick.get("created_at"), "count": len(posted)}


def mark_on_soundcloud(mixes: list[dict], posted: dict[str, list[dict]]) -> None:
    """In place: each row (and its other formats) gets ``on_soundcloud`` when its song
    is already up, unless this exact file is the one posted (``uploaded``)."""
    rows = {m["path"]: m for m in mixes if not m.get("superseded_by")}
    for m in mixes:
        m["on_soundcloud"] = None
    for m in rows.values():
        if m.get("uploaded"):
            continue
        hit = match_on_soundcloud(m, posted.get(m.get("song") or "", []), m.get("formats"))
        m["on_soundcloud"] = hit
    for m in mixes:
        if m.get("superseded_by") and m.get("format_of") in rows:
            m["on_soundcloud"] = rows[m["format_of"]].get("on_soundcloud")


def is_new(m: dict) -> bool:
    """Free to post without asking: not up in any format or version, the best file of
    its mix, and not a short click, test bounce or stem."""
    return not (m.get("uploaded") or m.get("superseded_by") or m.get("short")
                or m.get("stem") or m.get("on_soundcloud"))
