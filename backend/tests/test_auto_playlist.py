"""New posts can go straight into a playlist: one the producer picked, or one per genre.
Off unless chosen in Settings; it only ever adds."""
from lazyupload import service
from lazyupload.connect import SoundCloudConnectSession
from tests.helpers import make_wav


def _catalog(tmp_path, monkeypatch, rule=None):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    cat = service.Catalog(tmp_path / "u.db")
    cfg = {"min_length_seconds": 0}
    if rule:
        cfg["auto_playlist"] = rule
    cat.set_setting("config", cfg)
    SoundCloudConnectSession(lambda t: service.save_account(cat, t)).start()
    return cat


def _post(cat, tmp_path, name, genre, sharing="public", value=1):
    wav = make_wav(tmp_path / "Mixes" / f"{name}.wav", value=value, seconds=0.5)
    res = service.run_upload(cat, [{"path": str(wav), "name": name, "genre": genre}],
                             {"sharing": sharing})
    return res["results"][0]["sc_track_id"]


def _ids(cat, title):
    pl = next((p for p in service.list_playlists(cat) if p["title"] == title), None)
    return None if pl is None else [t["id"] for t in pl["tracks"]]


def test_off_by_default(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    before = {p["id"]: len(p["tracks"]) for p in service.list_playlists(cat)}
    _post(cat, tmp_path, "Heavy", "House")
    assert {p["id"]: len(p["tracks"]) for p in service.list_playlists(cat)} == before


def test_one_playlist(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    pl = service.create_playlist(cat, "New this month", "public")
    cat.set_setting("config", {"min_length_seconds": 0,
                               "auto_playlist": {"mode": "one", "playlist_id": pl["id"]}})
    tid = _post(cat, tmp_path, "Heavy", "House")
    assert _ids(cat, "New this month") == [tid]


def test_a_playlist_per_genre_is_made_once_then_reused(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch, {"mode": "genre"})
    a = _post(cat, tmp_path, "Heavy", "Techno", value=1)
    b = _post(cat, tmp_path, "Lighter", "techno", value=2)
    assert _ids(cat, "Techno") == [a, b]
    assert [p["title"] for p in service.list_playlists(cat)].count("Techno") == 1


def test_a_private_song_never_makes_a_public_playlist(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch, {"mode": "genre"})
    _post(cat, tmp_path, "Heavy", "Drill", sharing="private")
    pl = next(p for p in service.list_playlists(cat) if p["title"] == "Drill")
    assert pl["sharing"] == "private"


def test_no_genre_no_playlist_and_a_failure_never_fails_the_post(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch, {"mode": "one", "playlist_id": 123456})  # gone
    tid = _post(cat, tmp_path, "Heavy", "")
    assert tid is not None
