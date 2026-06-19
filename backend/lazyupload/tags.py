"""Curated SoundCloud tag suggestions per genre.

SoundCloud has no tag-suggestion API, so discovery tags are a hand-curated map. The
strategy (per common SoundCloud SEO guidance + scene knowledge): for each genre offer a
mix of the broad genre tag, its short form (e.g. dnb), a couple of niche sub-genres, and
a mood/use-case or technical tag (BPM). Multi-word tags are fine — soundcloud._tag_list
quotes them on save.
"""
import re

# canonical genre key -> ordered, highest-discovery-first tags
_GENRE_TAGS: dict[str, list[str]] = {
    "dubstep":   ["dubstep", "riddim", "bass music", "dub", "140", "heavy dubstep", "brostep", "bass"],
    "trap":      ["trap", "808", "trap beat", "type beat", "hard", "rap", "bass", "banger"],
    "grime":     ["grime", "140", "grime instrumental", "uk grime", "instrumental", "eskibeat", "road rap", "mc"],
    "dnb":       ["drum and bass", "dnb", "jungle", "174", "neurofunk", "liquid", "rollers", "breakbeat"],
    "hiphop":    ["hip hop", "rap", "boom bap", "type beat", "instrumental", "beats", "freestyle", "underground"],
    "ukg":       ["uk garage", "ukg", "2step", "garage", "speed garage", "bassline", "4x4", "london"],
    "phonk":     ["phonk", "drift phonk", "memphis", "brazilian phonk", "aggressive", "cowbell", "gym", "slowed"],
    "rnb":       ["rnb", "soul", "neo soul", "smooth", "slow jam", "vibes", "vocals", "chill"],
    "jazz":      ["jazz", "blues", "soul", "smooth jazz", "instrumental", "lounge", "improvisation", "live"],
    "house":     ["house", "deep house", "tech house", "dance", "club", "groove", "4x4", "electronic"],
    "techno":    ["techno", "melodic techno", "dark techno", "rave", "warehouse", "club", "peak time", "electronic"],
    "lofi":      ["lofi", "lo-fi", "chillhop", "study beats", "chill", "relax", "instrumental", "beats"],
    "electronic": ["electronic", "edm", "electro", "dance", "synth", "producer", "bass", "club"],
}

# normalized genre label (or alias) -> canonical key
_ALIASES: dict[str, str] = {
    "drum and bass": "dnb", "drum bass": "dnb", "d b": "dnb", "jungle": "dnb", "neurofunk": "dnb",
    "hip hop": "hiphop", "hip hop rap": "hiphop", "rap": "hiphop", "boom bap": "hiphop", "trap rap": "hiphop",
    "uk garage": "ukg", "garage": "ukg", "2 step": "ukg", "2step": "ukg", "speed garage": "ukg", "bassline": "ukg",
    "r b": "rnb", "r b soul": "rnb", "rhythm and blues": "rnb", "soul": "rnb", "neo soul": "rnb",
    "jazz blues": "jazz", "blues": "jazz",
    "lo fi": "lofi", "lofi hip hop": "lofi", "chillhop": "lofi", "chill hop": "lofi",
    "deep house": "house", "tech house": "house",
    "melodic techno": "techno",
    "edm": "electronic", "electro": "electronic", "dance": "electronic",
    "riddim": "dubstep", "brostep": "dubstep",
}

_GENERIC = ["new music", "producer", "beats", "instrumental", "independent"]


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", (s or "").lower())).strip()


def _resolve(genre: str) -> str | None:
    g = _norm(genre)
    if not g:
        return None
    if g in _GENRE_TAGS:
        return g
    if g in _ALIASES:
        return _ALIASES[g]
    for tok in g.split():  # fall back to a recognised word (e.g. "deep house" -> house)
        if tok in _GENRE_TAGS:
            return tok
        if tok in _ALIASES:
            return _ALIASES[tok]
    return None


def tags_for_genre(genre: str) -> list[str]:
    """The curated tag list for a genre, or a generic set (prefixed with the raw genre)
    when the genre is unknown."""
    key = _resolve(genre)
    if key:
        return list(_GENRE_TAGS[key])
    g = _norm(genre)
    return ([g] if g else []) + list(_GENERIC)


def suggest_tags(genre: str, bpm=None, existing=None, limit: int = 6) -> list[str]:
    """Recommended SoundCloud tags for a track: a BPM tag (if known) then the genre's
    curated tags, skipping any already present, capped to `limit`."""
    existing_lower = {(e or "").strip().lower() for e in (existing or []) if (e or "").strip()}
    out: list[str] = []

    def add(tag: str) -> None:
        t = (tag or "").strip()
        if t and t.lower() not in existing_lower and t.lower() not in {o.lower() for o in out}:
            out.append(t)

    if bpm:
        try:
            add(f"{round(float(bpm))} BPM")
        except (ValueError, TypeError):
            pass
    for t in tags_for_genre(genre):
        if len(out) >= limit:
            break
        add(t)
    return out[:limit]
