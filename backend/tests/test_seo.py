"""SEO / discoverability scoring for managed tracks."""
from lazyupload import seo, service
from lazyupload.connect import SoundCloudConnectSession
from tests.helpers import make_wav


def _connect_mock(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


def _full_track():
    return {
        "id": 1, "title": "Sunset Drive (Original Mix)", "genre": "House",
        "tags": ["house", "deep", "128 BPM"],
        "description": "A deep house roller. " * 6 + "More at https://soundcloud.com/me",
        "artwork_url": "https://img/x.jpg", "sharing": "public",
    }


def test_well_optimized_track_scores_high():
    r = seo.score_track(_full_track())
    assert r["score"] >= 85 and r["grade"] == "A"
    assert r["suggestions"] == []


def test_bare_track_scores_low_with_suggestions():
    r = seo.score_track({"id": 2, "title": "Untitled", "genre": "", "tags": [],
                         "description": "", "artwork_url": None, "sharing": "public"})
    assert r["score"] <= 20 and r["grade"] == "F"
    # the worst gaps come first; every empty field yields a suggestion
    ids = {c["id"]: c for c in r["checks"]}
    assert ids["title"]["points"] == 0 and ids["genre"]["points"] == 0
    assert ids["tags"]["points"] == 0 and ids["artwork"]["points"] == 0
    assert len(r["suggestions"]) >= 4


def test_wip_tag_in_title_is_penalized():
    base = _full_track()
    base["title"] = "Sunset Drive [WIP]"
    r = seo.score_track(base)
    title = next(c for c in r["checks"] if c["id"] == "title")
    assert title["points"] < 25 and "WIP" in (title["hint"] or "")


def test_tag_tiers():
    def tags_pts(tags):
        t = {"id": 1, "title": "A real title here", "genre": "", "tags": tags,
             "description": "", "artwork_url": None, "sharing": "public"}
        return next(c for c in seo.score_track(t)["checks"] if c["id"] == "tags")["points"]
    assert tags_pts([]) == 0
    assert tags_pts(["one", "two"]) == 12
    assert tags_pts(["a", "b", "c"]) == 20
    assert tags_pts(["a", "b", "150 bpm"]) == 25   # 3+ tags plus a numeric/BPM tag


def test_suggestions_use_backups_project_when_available():
    track = {"id": 1, "title": "Night Drive Extended", "genre": "", "tags": [],
             "description": "", "artwork_url": None, "sharing": "public"}
    meta = {"genre": "Phonk", "bpm": 140.0}
    r = seo.score_track(track, meta)
    joined = " ".join(r["suggestions"])
    assert "Phonk" in joined and "140 BPM" in joined


def test_private_track_gets_informational_note():
    t = _full_track(); t["sharing"] = "private"
    r = seo.score_track(t)
    assert any("Private" in s for s in r["suggestions"])
    # privacy does not reduce the metadata score
    assert r["score"] >= 85


def test_list_tracks_attaches_seo(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    catalog = service.Catalog(tmp_path / "uploads.db")
    _connect_mock(catalog)
    f = tmp_path / "My Mix.wav"
    make_wav(f, value=1)
    service.run_upload(catalog, [{"path": str(f), "name": "My Mix"}], {"sharing": "public"})
    tracks = service.list_tracks(catalog)
    assert tracks and all("seo" in t and 0 <= t["seo"]["score"] <= 100 for t in tracks)
    assert all(t["seo"]["grade"] in {"A", "B", "C", "D", "F"} for t in tracks)
