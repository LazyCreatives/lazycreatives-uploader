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
    assert client.get("/health").json() == {"status": "ok"}


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
