import time

import pytest
from fastapi.testclient import TestClient

from lazyupload.api.app import create_app


@pytest.fixture
def client(tmp_path, mixes_dir):
    app = create_app(token="", db_path=tmp_path / "catalog.db")  # token disabled for tests
    with TestClient(app) as c:
        c.mixes_dir = str(mixes_dir)
        yield c


def _poll_job(client, job_id, timeout=8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["state"] in ("done", "error"):
            return job
        time.sleep(0.1)
    raise AssertionError("job did not finish")


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_settings_roundtrip(client):
    cfg = {"sources": [client.mixes_dir], "default_sharing": "private"}
    r = client.put("/api/settings", json=cfg)
    assert r.status_code == 200
    assert r.json()["default_sharing"] == "private"
    assert client.get("/api/settings").json()["sources"] == [client.mixes_dir]


def test_auto_upload_interval_blocked_on_free(client):
    # Free tier can't enable the watch-folder schedule — it's clamped to 0.
    r = client.put("/api/settings", json={"sources": [client.mixes_dir], "interval_minutes": 30})
    assert r.json()["interval_minutes"] == 0


def test_connect_mock_then_account(client):
    r = client.post("/api/connect").json()
    assert r["mock"] is True and r["status"] == "connected"
    assert client.get("/api/account").json()["connected"] is True


def test_scan_lists_mixes(client):
    client.put("/api/settings", json={"sources": [client.mixes_dir]})
    mixes = client.post("/api/scan", json={}).json()["mixes"]
    assert len(mixes) == 3
    assert all(not m["uploaded"] for m in mixes)


def test_upload_requires_connection(client):
    client.put("/api/settings", json={"sources": [client.mixes_dir]})
    mixes = client.post("/api/scan", json={}).json()["mixes"]
    r = client.post("/api/upload", json={"items": [{"path": mixes[0]["path"]}]})
    assert r.status_code == 400  # not connected


def test_single_upload_succeeds(client):
    client.put("/api/settings", json={"sources": [client.mixes_dir]})
    client.post("/api/connect")
    mixes = client.post("/api/scan", json={}).json()["mixes"]
    r = client.post("/api/upload", json={"items": [{"path": mixes[0]["path"]}]})
    assert r.status_code == 200
    job = _poll_job(client, r.json()["job_id"])
    assert job["state"] == "done"
    assert job["result"]["ok_count"] == 1
    # It now shows in history.
    assert len(client.get("/api/history").json()["uploads"]) == 1


def test_batch_upload_gated_on_free_then_allowed_on_pro(client):
    client.put("/api/settings", json={"sources": [client.mixes_dir]})
    client.post("/api/connect")
    mixes = client.post("/api/scan", json={}).json()["mixes"]
    items = [{"path": m["path"]} for m in mixes]  # more than one => batch
    blocked = client.post("/api/upload", json={"items": items})
    assert blocked.status_code == 402  # batch is Pro-only

    client.post("/api/entitlement/activate", json={"key": "LC-PRO-DEMO-2026"})
    ok = client.post("/api/upload", json={"items": items})
    assert ok.status_code == 200
    job = _poll_job(client, ok.json()["job_id"])
    assert job["result"]["ok_count"] == 3


def test_history_everything_joins_the_whole_soundcloud_account(client):
    client.put("/api/settings", json={"sources": [client.mixes_dir]})
    client.post("/api/connect")
    mixes = client.post("/api/scan", json={}).json()["mixes"]
    job = _poll_job(client, client.post("/api/upload", json={"items": [{"path": mixes[0]["path"]}]}).json()["job_id"])
    assert job["result"]["ok_count"] == 1

    # Without the flag: only what this app posted (Home and the phone page use this).
    assert len(client.get("/api/history").json()["uploads"]) == 1

    body = client.get("/api/history?everything=true&limit=100").json()
    assert body["soundcloud"] == "ok"
    rows = body["uploads"]
    mine = [r for r in rows if not r.get("outside")]
    outside = [r for r in rows if r.get("outside")]
    assert len(mine) == 1                       # the app's own post shows once
    assert {r["title"] for r in outside} >= {"Warehouse Set (2024)", "Rainy Day Beat"}
    assert all(r["permalink_url"] and r["file_path"] == "" and r["size"] is None for r in outside)
    assert all(r["id"] < 0 for r in outside)     # never clashes with an upload row's id
    # Newest first, with SoundCloud's times in the app's own "YYYY-MM-DD HH:MM:SS" shape.
    assert [r["timestamp"] for r in rows] == sorted((r["timestamp"] for r in rows), reverse=True)
    assert all(len(r["timestamp"]) == 19 and r["timestamp"][10] == " " for r in outside)
    # The limit still pages.
    assert len(client.get("/api/history?everything=true&limit=1").json()["uploads"]) == 1


def test_history_everything_without_soundcloud_shows_the_apps_posts(client):
    body = client.get("/api/history?everything=true").json()
    assert body == {"uploads": [], "soundcloud": "not_connected"}


def test_history_everything_drops_a_track_deleted_in_the_app(client):
    client.post("/api/connect")
    first = client.get("/api/history?everything=true").json()["uploads"]
    gone = next(r for r in first if r["title"] == "Rainy Day Beat")
    assert client.delete(f"/api/tracks/{gone['sc_track_id']}").status_code in (200, 204)
    titles = {r["title"] for r in client.get("/api/history?everything=true").json()["uploads"]}
    assert "Rainy Day Beat" not in titles
