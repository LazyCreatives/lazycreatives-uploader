"""Playlists ("sets" on SoundCloud): make one, add, reorder, remove, rename, delete.
Runs against the demo client, plus checks on what the real client sends."""
import pytest
from fastapi.testclient import TestClient

from lazyupload import service, soundcloud
from lazyupload.api.app import create_app
from lazyupload.connect import SoundCloudConnectSession


def _connect_mock(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


def test_demo_has_a_playlist_in_order(catalog):
    _connect_mock(catalog)
    pls = service.list_playlists(catalog)
    assert [p["title"] for p in pls] == ["Late night"]
    assert [t["title"] for t in pls[0]["tracks"]] == ["Rainy Day Beat", "Warehouse Set (2024)"]
    assert pls[0]["track_count"] == 2
    assert pls[0]["duration"] == 142 + 3600


def test_create_add_reorder_remove(catalog):
    _connect_mock(catalog)
    a, b = [t["id"] for t in service.list_tracks(catalog)]
    pl = service.create_playlist(catalog, "  Warm-up  ", "private", [a, a])
    assert pl["title"] == "Warm-up" and pl["sharing"] == "private"
    assert [t["id"] for t in pl["tracks"]] == [a]  # repeats dropped

    pl = service.add_to_playlist(catalog, pl["id"], [a, b])
    assert pl["added"] == 1 and [t["id"] for t in pl["tracks"]] == [a, b]

    pl = service.update_playlist(catalog, pl["id"], track_ids=[b, a])
    assert [t["id"] for t in pl["tracks"]] == [b, a]

    pl = service.update_playlist(catalog, pl["id"], title="Opening", track_ids=[a])
    assert pl["title"] == "Opening" and [t["id"] for t in pl["tracks"]] == [a]
    # saved: a fresh read agrees
    again = {p["id"]: p for p in service.list_playlists(catalog)}[pl["id"]]
    assert again["title"] == "Opening" and again["track_count"] == 1


def test_deleting_a_track_drops_it_from_playlists(catalog):
    _connect_mock(catalog)
    late = service.list_playlists(catalog)[0]
    gone = late["tracks"][0]["id"]
    service.delete_track(catalog, gone)
    late = service.list_playlists(catalog)[0]
    assert gone not in [t["id"] for t in late["tracks"]]


def test_delete_playlist_keeps_tracks(catalog):
    _connect_mock(catalog)
    n = len(service.list_tracks(catalog))
    service.delete_playlist(catalog, service.list_playlists(catalog)[0]["id"])
    assert service.list_playlists(catalog) == []
    assert len(service.list_tracks(catalog)) == n


def test_playlists_need_connection(catalog):
    with pytest.raises(RuntimeError):
        service.list_playlists(catalog)


@pytest.fixture
def client(tmp_path):
    app = create_app(token="", db_path=tmp_path / "catalog.db")
    with TestClient(app) as c:
        yield c


def test_playlists_over_api(client):
    assert client.get("/api/playlists").status_code == 400
    client.post("/api/connect")
    ids = [t["id"] for t in client.get("/api/tracks").json()["tracks"]]
    assert client.post("/api/playlists", json={"title": "   "}).status_code == 400
    made = client.post("/api/playlists", json={"title": "Sunday", "track_ids": ids[:1]}).json()
    assert made["sharing"] == "public" and len(made["tracks"]) == 1
    added = client.post(f"/api/playlists/{made['id']}/add", json={"track_ids": ids}).json()
    assert added["added"] == 1
    moved = client.put(f"/api/playlists/{made['id']}", json={"track_ids": ids[::-1]}).json()
    assert [t["id"] for t in moved["tracks"]] == ids[::-1]
    assert client.put(f"/api/playlists/{made['id']}", json={}).status_code == 400
    assert client.delete(f"/api/playlists/{made['id']}").status_code == 200
    assert [p["title"] for p in client.get("/api/playlists").json()["playlists"]] == ["Late night"]


def test_real_client_sends_the_whole_ordered_list(monkeypatch):
    sent = {}

    class Resp:
        headers: dict = {}
        def raise_for_status(self):
            pass
        status_code = 200
        def json(self):
            return {"id": 5, "title": "X", "tracks": [{"id": 2, "duration": 1000, "user": {"username": "me"}},
                                                    {"id": 1, "duration": 2000}]}

    def fake_put(url, headers=None, json=None, timeout=None):
        sent["url"], sent["json"] = url, json
        return Resp()

    monkeypatch.setattr(soundcloud.requests, "put", fake_put)
    c = soundcloud.SoundCloudClient({"access_token": "a", "expires_at": 9e12})
    pl = c.update_playlist(5, track_ids=[2, 1])
    assert sent["url"].endswith("/playlists/soundcloud:playlists:5")
    # SoundCloud refuses the old {"id": 2} form: tracks are named by their urn.
    assert sent["json"] == {"playlist": {"tracks": [{"urn": "soundcloud:tracks:2"},
                                                    {"urn": "soundcloud:tracks:1"}]}}
    assert [t["id"] for t in pl["tracks"]] == [2, 1] and pl["tracks"][0]["user"] == "me"
    assert pl["duration"] == 3 and pl["track_count"] == 2


def test_reads_tracks_that_only_carry_a_urn():
    pl = soundcloud.normalize_playlist({"urn": "soundcloud:playlists:7", "title": "140 BREAKS",
                                        "sharing": "private", "track_count": 1,
                                        "tracks": [{"urn": "soundcloud:tracks:42", "duration": 1000}]})
    assert pl["id"] == 7 and [t["id"] for t in pl["tracks"]] == [42]


def test_counts_private_tracks_soundcloud_leaves_out():
    # 140 BREAKS: SoundCloud said 5 (its public tracks) but sent all nine
    pl = soundcloud.normalize_playlist({"id": 7, "title": "140 BREAKS", "track_count": 5,
                                        "tracks": [{"id": i} for i in range(1, 10)]})
    assert pl["track_count"] == 9
    # a bigger count than it sent still stands, so a short read is still caught
    assert soundcloud.normalize_playlist({"id": 8, "track_count": 8, "tracks": [{"id": 1}]})["track_count"] == 8


class _FakeClient:
    def __init__(self, playlist):
        self.playlist, self.saved = playlist, None

    def get_playlist(self, playlist_id):
        return soundcloud.normalize_playlist(self.playlist)

    def update_playlist(self, playlist_id, track_ids=None, **_):
        self.saved = track_ids
        return soundcloud.normalize_playlist({**self.playlist, "track_count": None,
                                              "tracks": [{"id": i} for i in track_ids]})


def test_adding_to_a_private_playlist_keeps_what_is_there(catalog, monkeypatch):
    fake = _FakeClient({"id": 7, "title": "140 BREAKS", "sharing": "private", "track_count": 1,
                        "tracks": [{"urn": "soundcloud:tracks:42"}]})
    monkeypatch.setattr(service, "connected", lambda c: True)
    monkeypatch.setattr(service, "client_for", lambda c: fake)
    pl = service.add_to_playlist(catalog, 7, [99])
    assert fake.saved == [42, 99] and pl["added"] == 1


def test_adding_stops_when_soundcloud_sends_part_of_the_playlist(catalog, monkeypatch):
    fake = _FakeClient({"id": 7, "title": "The Works", "track_count": 8,
                        "tracks": [{"id": 1}, {"id": 2}]})
    monkeypatch.setattr(service, "connected", lambda c: True)
    monkeypatch.setattr(service, "client_for", lambda c: fake)
    with pytest.raises(service.PlaylistIncomplete):
        service.add_to_playlist(catalog, 7, [99])
    assert fake.saved is None  # nothing was overwritten


def test_edit_playlist_details_over_api(client, tmp_path):
    client.post("/api/connect")
    pl = client.get("/api/playlists").json()["playlists"][0]
    tracks_before = [t["id"] for t in pl["tracks"]]
    got = client.put(f"/api/playlists/{pl['id']}", json={
        "title": "Late night drives", "description": "For the M25.", "genre": " Dubstep ",
        "tags": ["140", "bass music", "140", " "], "sharing": "private"}).json()
    assert (got["title"], got["description"], got["genre"], got["sharing"]) == \
        ("Late night drives", "For the M25.", "Dubstep", "private")
    assert got["tags"] == ["140", "bass music"]
    assert [t["id"] for t in got["tracks"]] == tracks_before  # details only: tracks untouched
    again = client.get("/api/playlists").json()["playlists"][0]
    assert again["genre"] == "Dubstep" and again["tags"] == ["140", "bass music"]

    pic = tmp_path / "cover.png"
    pic.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 32)
    before = pic.read_bytes()
    cov = client.post(f"/api/playlists/{pl['id']}/artwork", json={"artwork_path": str(pic)}).json()
    assert cov["artwork_url"].startswith("data:image/png")
    assert pic.read_bytes() == before  # the picture is only read
    assert client.post(f"/api/playlists/{pl['id']}/artwork",
                       json={"artwork_path": str(tmp_path / "gone.png")}).status_code == 400


def test_real_client_sends_playlist_details(monkeypatch):
    sent = {}

    class Resp:
        headers: dict = {}
        status_code = 200
        def raise_for_status(self):
            pass
        def json(self):
            return {"id": 5, "title": "X", "genre": "Dubstep", "tag_list": 'grime "bass music"', "tracks": []}

    def fake_put(url, headers=None, json=None, timeout=None):
        sent["json"] = json
        return Resp()

    monkeypatch.setattr(soundcloud.requests, "put", fake_put)
    c = soundcloud.SoundCloudClient({"access_token": "a", "expires_at": 9e12})
    pl = c.update_playlist(5, description="d", genre="Dubstep", tags=["grime", "bass music"])
    # details only: no "tracks" key, so SoundCloud keeps the playlist's songs as they are
    assert sent["json"] == {"playlist": {"description": "d", "genre": "Dubstep", "tag_list": 'grime "bass music"'}}
    assert pl["genre"] == "Dubstep" and pl["tags"] == ["grime", "bass music"]
