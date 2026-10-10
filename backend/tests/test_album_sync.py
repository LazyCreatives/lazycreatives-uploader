"""Sync an album to SoundCloud: one private playlist of its Ready songs in album order.
Songs not up yet are posted once; nothing is ever posted twice. Runs against the demo
SoundCloud client; the audio files are never changed."""
import hashlib
import time

from fastapi.testclient import TestClient

from lazyupload import album_sync, service
from lazyupload.albums import Albums
from lazyupload.api.app import create_app
from lazyupload.connect import SoundCloudConnectSession
from tests.helpers import make_wav


def _connect_mock(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


def _digest(folder):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.rglob("*")) if p.is_file()}


def _album(tmp_path, names=("Sunset Dub", "Midnight Drive", "Harbour Lights", "Low Tide")):
    d = tmp_path / "Mixes"
    paths = [make_wav(d / f"{n}.wav", seconds=40 + i, rate=2000, value=i + 1) for i, n in enumerate(names)]
    store = Albums()
    a = store.create("Night Drive EP")
    store.add_songs(a["id"], [{"path": str(p), "title": n.upper()} for p, n in zip(paths, names)])
    return store, a["id"], paths, d


def _playlist(catalog, pid):
    return {p["id"]: p for p in service.list_playlists(catalog)}[pid]


def test_sync_makes_a_private_playlist_in_album_order(catalog, tmp_path):
    _connect_mock(catalog)
    store, aid, paths, d = _album(tmp_path)
    before = _digest(d)
    # one song is already up; one is still being worked on
    service.run_upload(catalog, [{"path": str(paths[1]), "sharing": "public"}])
    store.set_song(aid, str(paths[3]), ready=False)
    tracks_before = len(service.list_tracks(catalog))

    out = album_sync.sync(catalog, store, aid)
    assert out["made"] and out["posted"] == 2 and out["on"] == 3 and out["of"] == 4
    assert out["waiting"] == ["LOW TIDE"]
    pl = _playlist(catalog, out["playlist_id"])
    assert pl["title"] == "Night Drive EP" and pl["sharing"] == "private"
    assert [t["title"] for t in pl["tracks"]] == ["SUNSET DUB", "Midnight Drive", "HARBOUR LIGHTS"]
    assert all(t["sharing"] == "private" for t in pl["tracks"] if t["title"] != "Midnight Drive")
    assert len(service.list_tracks(catalog)) == tracks_before + 2
    assert store.get(aid)["soundcloud"]["playlist_id"] == pl["id"]   # Backups can show it too
    assert _digest(d) == before


def test_sync_again_follows_the_album_and_never_posts_twice(catalog, tmp_path):
    _connect_mock(catalog)
    store, aid, paths, d = _album(tmp_path)
    first = album_sync.sync(catalog, store, aid)
    n = len(service.list_tracks(catalog))

    store.reorder(aid, [str(paths[2]), str(paths[0])])     # new order
    store.remove_song(aid, str(paths[1]))                  # one taken off
    store.update(aid, title="Night Drive")                 # renamed
    again = album_sync.sync(catalog, store, aid)
    assert again["playlist_id"] == first["playlist_id"] and again["posted"] == 0
    pl = _playlist(catalog, first["playlist_id"])
    assert pl["title"] == "Night Drive"
    assert [t["title"] for t in pl["tracks"]] == ["HARBOUR LIGHTS", "SUNSET DUB", "LOW TIDE"]
    # the song taken off left the playlist, but is still on SoundCloud
    assert len(service.list_tracks(catalog)) == n
    assert "MIDNIGHT DRIVE" in {t["title"] for t in service.list_tracks(catalog)}


def test_a_public_playlist_stays_public_and_a_deleted_one_is_made_again(catalog, tmp_path):
    _connect_mock(catalog)
    store, aid, paths, d = _album(tmp_path, names=("Sunset Dub", "Midnight Drive"))
    first = album_sync.sync(catalog, store, aid)
    service.update_playlist(catalog, first["playlist_id"], sharing="public")
    store.add_songs(aid, [{"path": str(make_wav(d / "Low Tide.wav", seconds=50, rate=2000, value=7)), "title": "LOW TIDE"}])
    again = album_sync.sync(catalog, store, aid)
    assert again["sharing"] == "public"
    low = next(t for t in service.list_tracks(catalog) if t["title"] == "LOW TIDE")
    assert low["sharing"] == "public"   # posted the way the playlist is

    service.delete_playlist(catalog, first["playlist_id"])
    third = album_sync.sync(catalog, store, aid)
    assert third["made"] and third["playlist_id"] != first["playlist_id"] and third["posted"] == 0
    assert third["sharing"] == "private" and third["on"] == 3


def test_sync_through_the_app_runs_as_a_job(tmp_path):
    app = create_app(token="secret", db_path=tmp_path / "catalog.db")
    with TestClient(app) as c:
        c.headers["X-Auth-Token"] = "secret"
        store, aid, paths, d = _album(tmp_path, names=("Sunset Dub",))
        assert c.post(f"/api/albums/{aid}/soundcloud", json={}).status_code == 400   # not signed in
        _connect_mock(app.state.catalog)
        assert c.post("/api/albums/nope/soundcloud", json={}).status_code == 404
        job = c.post(f"/api/albums/{aid}/soundcloud", json={}).json()
        for _ in range(100):
            st = c.get(f"/api/jobs/{job['job_id']}").json()
            if st["state"] != "running":
                break
            time.sleep(0.05)
        assert st["state"] == "done" and st["result"]["on"] == 1
        assert c.get("/api/albums").json()["albums"][0]["soundcloud"]["on"] == 1
