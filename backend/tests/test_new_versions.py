"""Re-export a song that is already up and the new version takes its place: same title,
details, cover and playlist spot. A private song swaps by itself in the automatic
folder check; a public one waits for the producer's Update click. The old upload is
only marked replaced, never deleted."""
import os
import time

from lazyupload import service
from lazyupload.connect import SoundCloudConnectSession
from tests.helpers import make_wav


def _catalog(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    cat = service.Catalog(tmp_path / "u.db")
    cat.set_setting("config", {"min_length_seconds": 0})
    SoundCloudConnectSession(lambda t: service.save_account(cat, t)).start()
    return cat


def _post_then_reexport(cat, tmp_path, sharing):
    d = tmp_path / "Mixes"
    v1 = make_wav(d / "Heavy.wav", value=1, seconds=0.5)
    service.run_upload(cat, [{"path": str(v1), "name": "Heavy", "title": "Heavy",
                              "description": "Late one.", "tags": ["night"]}],
                       {"sharing": sharing})
    old = next(t for t in service.list_tracks(cat) if t["title"] == "Heavy")
    pl = service.create_playlist(cat, "Late night", sharing="private")
    service.add_to_playlist(cat, pl["id"], [old["id"]])
    v2 = make_wav(d / "Heavy v2.wav", value=2, seconds=8.0)  # a longer, newer version
    later = time.time() + 60
    os.utime(v2, (later, later))
    return d, old, pl


def test_a_private_song_swaps_in_its_new_version_by_itself(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    d, old, pl = _post_then_reexport(cat, tmp_path, "private")

    mixes = service.scan_mixes(cat, [d])
    row = next(m for m in mixes if m["name"] == "Heavy v2")
    assert row["on_soundcloud"]["kind"] == "version" and row["on_soundcloud"]["id"] == old["id"]
    assert service.auto_post_picks(mixes) == []  # never posted as a song of its own

    done = service.auto_post_new_versions(cat, mixes)
    assert len(done) == 1 and done[0]["ok"] and done[0]["playlists"] == ["Late night"]

    tracks = {t["id"]: t for t in service.list_tracks(cat)}
    new = tracks[done[0]["new_id"]]
    assert new["title"] == "Heavy" and new["sharing"] == "private"
    assert new["description"] == "Late one." and new["tags"] == ["night"]
    # The old upload is kept, marked replaced, and the playlist holds the new one.
    assert tracks[old["id"]]["replaced_by"]["id"] == new["id"]
    ids = [t["id"] for t in next(p for p in service.list_playlists(cat) if p["id"] == pl["id"])["tracks"]]
    assert ids == [new["id"]]

    # Nothing more to do on the next check.
    assert service.auto_post_new_versions(cat, service.scan_mixes(cat, [d])) == []


def test_a_public_song_waits_for_the_update_click(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    d, old, _ = _post_then_reexport(cat, tmp_path, "public")
    mixes = service.scan_mixes(cat, [d])
    before = {t["id"] for t in service.list_tracks(cat)}
    assert service.auto_post_new_versions(cat, mixes) == []
    assert {t["id"] for t in service.list_tracks(cat)} == before

    row = next(m for m in mixes if m["name"] == "Heavy v2")
    res = service.post_new_version(cat, row)
    assert res["ok"] and res["sharing"] == "public"
    assert {t["id"] for t in service.list_tracks(cat)} == before | {res["new_id"]}
    assert old["id"] in before


def test_the_switch_in_settings_turns_it_off(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    d, _, _ = _post_then_reexport(cat, tmp_path, "private")
    cat.set_setting("config", {"min_length_seconds": 0, "auto_new_versions": False})
    assert service.auto_post_new_versions(cat, service.scan_mixes(cat, [d])) == []


def test_an_older_file_is_never_posted_over_a_newer_upload(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    d = tmp_path / "Mixes"
    v2 = make_wav(d / "Heavy v2.wav", value=2, seconds=8.0)
    service.run_upload(cat, [{"path": str(v2), "name": "Heavy v2", "title": "Heavy"}],
                       {"sharing": "private"})
    v1 = make_wav(d / "Heavy.wav", value=1, seconds=0.5)
    past = time.time() - 3600
    os.utime(v1, (past, past))
    assert service.new_version_picks(service.scan_mixes(cat, [d]), cat) == []
