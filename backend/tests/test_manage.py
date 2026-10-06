import time

import pytest
from fastapi.testclient import TestClient

from lazyupload import service
from lazyupload.api.app import create_app
from lazyupload.connect import SoundCloudConnectSession


def _connect_mock(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


# ---- service layer ----------------------------------------------------------
def test_list_seeds_demo_library(catalog):
    _connect_mock(catalog)
    tracks = service.list_tracks(catalog)
    assert len(tracks) == 2
    titles = {t["title"] for t in tracks}
    assert "Warehouse Set (2024)" in titles
    assert tracks[0]["tags"] and isinstance(tracks[0]["tags"], list)


def test_update_changes_metadata_and_privacy(catalog):
    _connect_mock(catalog)
    t = service.list_tracks(catalog)[0]
    updated = service.update_track(catalog, t["id"],
                                   {"sharing": "private", "title": "Renamed", "tags": ["a", "b c"]})
    assert updated["sharing"] == "private"
    assert updated["title"] == "Renamed"
    assert updated["tags"] == ["a", "b c"]
    # persisted
    again = {x["id"]: x for x in service.list_tracks(catalog)}
    assert again[t["id"]]["title"] == "Renamed"


def test_delete_removes_track(catalog):
    _connect_mock(catalog)
    before = service.list_tracks(catalog)
    service.delete_track(catalog, before[0]["id"])
    after = service.list_tracks(catalog)
    assert len(after) == len(before) - 1


def test_uploaded_mix_appears_in_library(catalog, mixes_dir):
    _connect_mock(catalog)
    mixes = service.scan_mixes(catalog, [mixes_dir])
    service.run_upload(catalog, mixes[:1], {"sharing": "public"})
    titles = {t["title"] for t in service.list_tracks(catalog)}
    assert mixes[0]["name"] in titles  # the just-uploaded mix is now manageable


def test_manage_requires_connection(catalog):
    with pytest.raises(RuntimeError):
        service.list_tracks(catalog)


# ---- API layer --------------------------------------------------------------
@pytest.fixture
def client(tmp_path):
    app = create_app(token="", db_path=tmp_path / "catalog.db")
    with TestClient(app) as c:
        yield c


def test_tracks_endpoint_requires_connection(client):
    assert client.get("/api/tracks").status_code == 400


def test_tracks_crud_over_api(client):
    client.post("/api/connect")
    tracks = client.get("/api/tracks").json()["tracks"]
    assert len(tracks) == 2
    tid = tracks[0]["id"]

    upd = client.put(f"/api/tracks/{tid}", json={"sharing": "private"})
    assert upd.status_code == 200 and upd.json()["sharing"] == "private"

    dele = client.delete(f"/api/tracks/{tid}")
    assert dele.status_code == 200
    assert len(client.get("/api/tracks").json()["tracks"]) == 1


def test_comments_come_back_in_seconds(catalog):
    _connect_mock(catalog)
    t = next(x for x in service.list_tracks(catalog) if x["title"].startswith("Warehouse"))
    comments = service.list_comments(catalog, t["id"])
    assert [c["t"] for c in comments] == [412.0, 1530.0, 2611.0]
    assert comments[0]["user"] == "nightbus" and comments[0]["body"] == "this bassline!!"


def test_normalize_comment_without_a_moment():
    from lazyupload.soundcloud import normalize_comment
    c = normalize_comment({"body": "nice", "timestamp": None, "user": {"username": "a"}})
    assert c["t"] is None and c["user"] == "a"
