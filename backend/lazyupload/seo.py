"""Heuristic SEO / discoverability score for a SoundCloud track.

Scores the LIVE SoundCloud metadata (title, genre, tags, description, cover art) on a
0–100 scale with a letter grade and ordered, actionable suggestions. The matched Backups
project (passed as `meta`) is used ONLY to make suggestions specific — e.g. propose the
project's genre or a BPM tag — it never changes the score, which always reflects what is
actually published.

Weights (sum 100): title 25 · genre 20 · tags 25 · description 15 · cover art 15.
"""
import re

from lazyupload.tags import suggest_tags

# Titles that read as a working filename rather than a release name.
_PLACEHOLDER = {
    "", "untitled", "track", "new track", "audio", "mixdown", "master", "bounce",
    "export", "demo", "idea", "loop", "wip", "final", "render", "untitled project",
}
_WIP_RE = re.compile(r"[\[(]\s*wip\s*[\])]", re.I)


def _grade(score: int) -> str:
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    if score >= 50:
        return "C"
    if score >= 30:
        return "D"
    return "F"


def _title_core(title: str) -> str:
    """Lowercased title with bracketed decorations stripped, for placeholder detection."""
    return re.sub(r"[\[(].*?[\])]", "", title or "").strip().lower()


def score_track(track: dict, meta: dict | None = None) -> dict:
    title = (track.get("title") or "").strip()
    genre = (track.get("genre") or "").strip()
    tags = [t for t in (track.get("tags") or []) if t]
    desc = (track.get("description") or "").strip()
    has_art = bool(track.get("artwork_url"))
    public = (track.get("sharing") or "public") != "private"

    proj_genre = (meta or {}).get("genre")
    proj_bpm = (meta or {}).get("bpm")
    # Genre-appropriate tag suggestions — prefer the LIVE SoundCloud genre (what the user
    # actually set), falling back to the Backups-detected one.
    suggested = suggest_tags(genre or proj_genre or "", bpm=proj_bpm, existing=tags, limit=6)
    checks: list[dict] = []

    # -- title (25) --
    tpts, thint = 25, None
    if _title_core(title) in _PLACEHOLDER or len(title) < 3:
        tpts, thint = 0, "Give the track a real, descriptive title."
    else:
        if _WIP_RE.search(title):
            tpts -= 10
            thint = "Remove the [WIP] tag from the title before sharing publicly."
        if len(title) < 8:
            tpts -= 8
            thint = thint or "Title is short — add context (artist · mix type)."
        tpts = max(0, tpts)
    checks.append({"id": "title", "label": "Title", "points": tpts, "max": 25, "hint": thint})

    # -- genre (20) --
    if genre:
        checks.append({"id": "genre", "label": "Genre", "points": 20, "max": 20, "hint": None})
    else:
        hint = "Set a genre — it's SoundCloud's main discovery filter."
        if proj_genre:
            hint = f"Set the genre to “{proj_genre}” (from your project)."
        checks.append({"id": "genre", "label": "Genre", "points": 0, "max": 20, "hint": hint})

    # -- tags (25) --
    if len(tags) >= 3:
        gpts = 20
    elif tags:
        gpts = 12
    else:
        gpts = 0
    has_bpm_tag = any(re.search(r"\d", t) for t in tags)
    has_genre_tag = bool(genre) and any(genre.lower() in t.lower() for t in tags)
    if gpts and (has_bpm_tag or has_genre_tag):
        gpts = min(25, gpts + 5)
    ghint = None
    if gpts < 25:
        extra = (" — try " + ", ".join(suggested[:3])) if suggested else ""
        ghint = f"Add more tags (you have {len(tags)}){extra}."
    checks.append({"id": "tags", "label": "Tags", "points": gpts, "max": 25, "hint": ghint})

    # -- description (15) --
    if len(desc) >= 80:
        dpts = 13
    elif desc:
        dpts = 8
    else:
        dpts = 0
    if dpts and ("http://" in desc or "https://" in desc):
        dpts = min(15, dpts + 2)
    dhint = None
    if dpts < 15:
        dhint = ("Add a link (tracklist, socials) to the description."
                 if desc else "Add a description — even a short one helps discovery.")
    checks.append({"id": "description", "label": "Description", "points": dpts, "max": 15, "hint": dhint})

    # -- cover art (15) --
    if has_art:
        checks.append({"id": "artwork", "label": "Cover art", "points": 15, "max": 15, "hint": None})
    else:
        checks.append({"id": "artwork", "label": "Cover art", "points": 0, "max": 15,
                       "hint": "Upload cover art — tracks with artwork get more plays."})

    score = sum(c["points"] for c in checks)
    # Suggestions ordered by the biggest point gap first, capped to the top few.
    gaps = sorted((c for c in checks if c["hint"]),
                  key=lambda c: c["max"] - c["points"], reverse=True)
    suggestions = [c["hint"] for c in gaps][:4]
    if not public:
        suggestions.append("Private — it won't appear in SoundCloud search (fine for WIPs).")
    return {"score": score, "grade": _grade(score), "checks": checks,
            "suggestions": suggestions, "suggested_tags": suggested}
