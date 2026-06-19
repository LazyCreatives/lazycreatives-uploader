"""Genre-aware SoundCloud tag suggestions."""
from lazyupload import seo, tags


def test_genre_specific_tags():
    dub = tags.suggest_tags("Dubstep", existing=[], limit=6)
    assert "dubstep" in dub and "riddim" in dub
    grime = tags.suggest_tags("Grime", existing=[], limit=6)
    assert "grime" in grime and "140" in grime


def test_aliases_resolve_to_canonical_genre():
    assert "drum and bass" in tags.suggest_tags("Drum & Bass", limit=8)
    assert "drum and bass" in tags.suggest_tags("DnB", limit=8)
    assert "uk garage" in tags.suggest_tags("UK Garage", limit=8)
    # R&B & Soul (SoundCloud's label) → rnb set
    assert "rnb" in tags.suggest_tags("R&B & Soul", limit=8)


def test_bpm_is_first_and_existing_are_skipped():
    out = tags.suggest_tags("Trap", bpm=140, existing=["trap"], limit=6)
    assert out[0] == "140 BPM"          # BPM tag leads
    assert "trap" not in out            # already present → skipped
    assert "808" in out


def test_unknown_genre_falls_back_but_keeps_the_word():
    out = tags.suggest_tags("Spoken Word", limit=5)
    assert "spoken word" in out and "producer" in out


def test_seo_attaches_genre_appropriate_suggested_tags():
    # mirrors the screenshot: Dubstep track with only a BPM tag
    track = {"id": 1, "title": "SIMPLE KEEP IT SIMPLE [WIP]", "genre": "Dubstep",
             "tags": ["150 BPM"], "description": "", "artwork_url": None, "sharing": "public"}
    r = seo.score_track(track)
    assert "riddim" in r["suggested_tags"] or "dubstep" in r["suggested_tags"]
    assert "Ambient" not in " ".join(r["suggested_tags"])  # no wrong-genre noise
    # the tag hint now names real tags
    tag_hint = next(c["hint"] for c in r["checks"] if c["id"] == "tags")
    assert "try" in tag_hint
