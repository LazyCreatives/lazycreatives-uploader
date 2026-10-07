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
    assert sent["url"].endswith("/playlists/5")
    assert sent["json"] == {"playlist": {"tracks": [{"id": 2}, {"id": 1}]}}
    assert [t["id"] for t in pl["tracks"]] == [2, 1] and pl["tracks"][0]["user"] == "me"
    assert pl["duration"] == 3 and pl["track_count"] == 2
