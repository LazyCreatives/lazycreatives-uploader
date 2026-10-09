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
    "boombap":   ["boom bap", "hip hop", "boombap", "90s hip hop", "sample", "dusty", "jazzy", "instrumental"],
    "drill":     ["drill", "uk drill", "ny drill", "drill beat", "type beat", "sliding 808", "dark", "rap"],
    "deephouse": ["deep house", "house", "deep", "groove", "late night", "soulful", "club", "electronic"],
    "techhouse": ["tech house", "house", "techhouse", "groove", "club", "rolling", "bassline", "electronic"],
    "afrohouse": ["afro house", "afrohouse", "house", "percussion", "tribal", "organic house", "club", "dance"],
    "disco":     ["disco", "nu disco", "funk", "groove", "dance", "house", "boogie", "electronic"],
    "melodictechno": ["melodic techno", "techno", "melodic house", "afterlife", "progressive", "dark", "club", "electronic"],
    "hardtechno": ["hard techno", "techno", "rave", "industrial techno", "schranz", "hard", "warehouse", "club"],
    "trance":    ["trance", "uplifting trance", "progressive trance", "vocal trance", "euphoric", "rave", "edm", "electronic"],
    "psytrance": ["psytrance", "psy", "goa", "full on", "progressive psytrance", "forest", "festival", "trance"],
    "hardstyle": ["hardstyle", "rawstyle", "hard dance", "euphoric", "kick", "rave", "festival", "edm"],
    "breakbeat": ["breakbeat", "breaks", "big beat", "nu skool breaks", "bass", "rave", "electronic", "dance"],
    "futurebass": ["future bass", "edm", "chill", "supersaw", "melodic", "bass", "electronic", "uplifting"],
    "hyperpop":  ["hyperpop", "glitchcore", "pop", "digicore", "experimental", "electronic", "vocals", "underground"],
    "pop":       ["pop", "vocals", "singer", "song", "radio", "catchy", "dance pop", "new music"],
    "indie":     ["indie", "indie pop", "bedroom pop", "alternative", "dream pop", "guitar", "lofi", "new music"],
    "rock":      ["rock", "alternative", "guitar", "band", "punk", "indie rock", "live", "new music"],
    "synthwave": ["synthwave", "retrowave", "80s", "outrun", "synth", "retro", "darksynth", "electronic"],
    "afrobeats": ["afrobeats", "afrobeat", "afro", "afropop", "naija", "amapiano", "dance", "vibes"],
    "amapiano":  ["amapiano", "log drum", "south africa", "afro house", "piano", "groove", "dance", "afro"],
    "reggaeton": ["reggaeton", "latin", "dembow", "perreo", "urbano", "dance", "club", "vibes"],
    "dancehall": ["dancehall", "bashment", "riddim", "reggae", "caribbean", "dance", "vibes", "club"],
    "ambient":   ["ambient", "atmospheric", "drone", "soundscape", "relax", "meditation", "chill", "instrumental"],
    "downtempo": ["downtempo", "chillout", "trip hop", "chill", "relax", "electronic", "instrumental", "mellow"],
    "cinematic": ["cinematic", "soundtrack", "score", "orchestral", "epic", "trailer", "film", "instrumental"],
    "ukdrill": ["uk drill", "drill", "uk rap", "drill beat", "type beat", "sliding 808", "london", "dark"],
    "jerk": ["jerk", "jerk beat", "jerk music", "rap", "underground", "bouncy", "type beat", "new wave"],
    "rage": ["rage", "rage beat", "type beat", "trap", "synth", "hard", "underground", "rap"],
    "plugg": ["plugg", "plugg beat", "type beat", "pluggnb", "melodic", "trap", "underground", "rap"],
    "pluggnb": ["pluggnb", "plugg", "rnb", "melodic", "type beat", "vibes", "underground", "rap"],
    "cloudrap": ["cloud rap", "cloud", "ethereal", "type beat", "dreamy", "underground", "rap", "vibes"],
    "ukrap": ["uk rap", "road rap", "rap", "uk hip hop", "london", "grime", "drill", "instrumental"],
    "neosoul": ["neo soul", "soul", "rnb", "jazz", "smooth", "vibes", "chill", "vocals"],
    "soul": ["soul", "rnb", "classic soul", "funk", "vocals", "smooth", "vintage", "groove"],
    "jerseyclub": ["jersey club", "club", "bouncy", "dance", "bed squeak", "baltimore club", "remix", "party"],
    "basshouse": ["bass house", "house", "bass", "club", "edm", "grime house", "dance", "electronic"],
    "proghouse": ["progressive house", "house", "progressive", "melodic", "edm", "club", "uplifting", "electronic"],
    "acidhouse": ["acid house", "acid", "303", "house", "rave", "club", "chicago house", "electronic"],
    "frenchhouse": ["french house", "filter house", "house", "disco", "funky", "french touch", "dance", "electronic"],
    "futurehouse": ["future house", "house", "edm", "club", "dance", "bass", "festival", "electronic"],
    "nudisco": ["nu disco", "disco", "funk", "groove", "dance", "house", "indie dance", "electronic"],
    "minimal": ["minimal techno", "minimal", "techno", "microhouse", "hypnotic", "club", "deep", "electronic"],
    "electro": ["electro", "electro funk", "breaks", "808", "robot", "club", "dance", "electronic"],
    "riddim": ["riddim", "dubstep", "bass music", "140", "heavy", "dub", "bass", "headbanger"],
    "footwork": ["footwork", "juke", "160", "chicago", "footwork music", "bass", "electronic", "experimental"],
    "indiepop": ["indie pop", "bedroom pop", "dream pop", "indie", "pop", "alternative", "lofi", "new music"],
    "synthpop": ["synth pop", "synthpop", "80s", "pop", "synth", "new wave", "retro", "electronic"],
    "kpop": ["kpop", "k-pop", "korean", "pop", "dance", "idol", "vocals", "new music"],
    "edm": ["edm", "electronic", "dance", "festival", "drop", "club", "big room", "banger"],
    "bigroom": ["big room", "edm", "festival", "mainstage", "drop", "house", "rave", "banger"],
    "chillwave": ["chillwave", "vaporwave", "chill", "dreamy", "retro", "synth", "lofi", "relax"],
    "triphop": ["trip hop", "downtempo", "chill", "dark", "breaks", "moody", "instrumental", "electronic"],
    "idm": ["idm", "electronic", "experimental", "braindance", "glitch", "ambient", "abstract", "instrumental"],
    "experimental": ["experimental", "abstract", "avant garde", "electronic", "sound design", "noise", "weird", "instrumental"],
    "glitch": ["glitch", "glitch hop", "experimental", "electronic", "idm", "bass", "abstract", "beats"],
    "industrial": ["industrial", "ebm", "dark", "techno", "noise", "heavy", "electronic", "underground"],
    "chiptune": ["chiptune", "8bit", "8-bit", "video game", "retro", "gameboy", "electronic", "nostalgia"],
    "metal": ["metal", "heavy metal", "rock", "djent", "metalcore", "guitar", "heavy", "band"],
    "punk": ["punk", "pop punk", "rock", "punk rock", "guitar", "band", "alternative", "diy"],
    "emo": ["emo", "midwest emo", "rock", "alternative", "emotional", "guitar", "sad", "band"],
    "shoegaze": ["shoegaze", "dream pop", "alternative", "guitar", "noise pop", "indie", "dreamy", "band"],
    "funk": ["funk", "groove", "bass", "soul", "disco", "funky", "live", "band"],
    "blues": ["blues", "guitar", "soul", "rock", "jazz", "live", "acoustic", "band"],
    "gospel": ["gospel", "worship", "choir", "soul", "praise", "christian", "vocals", "church"],
    "folk": ["folk", "acoustic", "singer songwriter", "indie folk", "guitar", "americana", "country", "band"],
    "country": ["country", "americana", "country music", "acoustic", "guitar", "folk", "nashville", "band"],
    "classical": ["classical", "orchestral", "piano", "strings", "composer", "instrumental", "neoclassical", "score"],
    "reggae": ["reggae", "roots", "dub", "caribbean", "jamaica", "ska", "vibes", "riddim"],
    "dub": ["dub", "reggae", "dub reggae", "sound system", "bass", "echo", "roots", "caribbean"],
    "moombahton": ["moombahton", "moombah", "latin", "reggaeton", "dance", "club", "tropical", "edm"],
    "bailefunk": ["baile funk", "funk carioca", "brazilian funk", "funk brasileiro", "brazil", "favela", "dance", "bass"],
    "latin": ["latin", "salsa", "cumbia", "reggaeton", "bachata", "latin music", "dance", "tropical"],
    "gamemusic": ["game music", "video game", "soundtrack", "chiptune", "gaming", "ost", "instrumental", "score"],
    "liquiddnb": ["liquid dnb", "liquid", "drum and bass", "dnb", "liquid funk", "soulful", "174", "rollers"],
    "neurofunk": ["neurofunk", "neuro", "drum and bass", "dnb", "dark", "174", "tech", "bass"],
    "jumpup": ["jump up", "jumpup", "drum and bass", "dnb", "wobble", "174", "rave", "bass"],
    "dancefloordnb": ["dancefloor dnb", "drum and bass", "dnb", "dancefloor", "174", "rave", "anthem", "club"],
    "rollers": ["rollers", "drum and bass", "dnb", "rolling", "174", "minimal", "bass", "club"],
    "minimaldnb": ["minimal dnb", "minimal", "drum and bass", "dnb", "rollers", "174", "deep", "bass"],
    "techstep": ["techstep", "darkstep", "drum and bass", "dnb", "dark", "174", "tech", "bass"],
    "halftime": ["halftime", "half time", "drum and bass", "dnb", "bass", "85", "experimental", "beats"],
    "drumstep": ["drumstep", "drum and bass", "dubstep", "dnb", "bass", "174", "heavy", "edm"],
}

# normalized genre label (or alias) -> canonical key
_ALIASES: dict[str, str] = {
    "drum and bass": "dnb", "drum bass": "dnb", "d b": "dnb", "jungle": "dnb", "neurofunk": "dnb",
    "hip hop": "hiphop", "hip hop rap": "hiphop", "rap": "hiphop", "boom bap": "boombap", "trap rap": "hiphop",
    "uk garage": "ukg", "garage": "ukg", "2 step": "ukg", "2step": "ukg", "speed garage": "ukg", 
    "r b": "rnb", "r b soul": "rnb", "rhythm and blues": "rnb", 
    "jazz blues": "jazz", "blues": "jazz",
    "lo fi": "lofi", "lofi hip hop": "lofi", "chillhop": "lofi", "chill hop": "lofi",
    "deep house": "deephouse", "tech house": "techhouse", "afro house": "afrohouse",
    "melodic techno": "melodictechno", "melodic house techno": "melodictechno", "hard techno": "hardtechno",
    "psy": "psytrance", "goa": "psytrance", "rawstyle": "hardstyle", "hard dance": "hardstyle",
    "breaks": "breakbeat", "future bass": "futurebass", "retrowave": "synthwave", "outrun": "synthwave",
    "afrobeat": "afrobeats", "afropop": "afrobeats", "latin": "reggaeton", "bashment": "dancehall",
    "chillout": "downtempo", "chill out": "downtempo", "soundtrack": "cinematic",
    "score": "cinematic", "orchestral": "cinematic", "indie pop": "indie", 
    "alternative rock": "rock", "dance pop": "pop", "electro pop": "pop",
    "edm": "electronic", "electro": "electronic", "dance": "electronic",
    "brostep": "dubstep",
}

_ALIASES.update({"liquid dnb": "liquiddnb", "liquid": "liquiddnb", "liquid funk": "liquiddnb", "jump up": "jumpup", "dancefloor dnb": "dancefloordnb", "minimal dnb": "minimaldnb", "half time": "halftime", "darkstep": "techstep", "uk drill": "ukdrill", "cloud rap": "cloudrap", "uk rap": "ukrap", "road rap": "ukrap", "neo soul": "neosoul", "jersey club": "jerseyclub", "bass house": "basshouse", "progressive house": "proghouse", "prog house": "proghouse", "acid house": "acidhouse", "french house": "frenchhouse", "filter house": "frenchhouse", "future house": "futurehouse", "nu disco": "nudisco", "minimal techno": "minimal", "juke": "footwork", "indie pop": "indiepop", "bedroom pop": "indiepop", "dream pop": "indiepop", "synth pop": "synthpop", "k pop": "kpop", "big room": "bigroom", "vaporwave": "chillwave", "trip hop": "triphop", "heavy metal": "metal", "pop punk": "punk", "midwest emo": "emo", "baile funk": "bailefunk", "funk carioca": "bailefunk", "brazilian funk": "bailefunk", "game music": "gamemusic", "video game": "gamemusic", "8 bit": "chiptune", "riddim dubstep": "riddim", "glitch hop": "glitch", "ebm": "industrial", "ska": "reggae", "salsa": "latin", "cumbia": "latin", "bachata": "latin"})

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
