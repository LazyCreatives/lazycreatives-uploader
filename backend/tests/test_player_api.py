"""The in-app player only serves mixes from watched folders (or files the app posted)."""
import pytest
from fastapi.testclient import TestClient

from lazyupload.api.app import create_app
from tests.helpers import make_wav


@pytest.fixture
def client(tmp_path, mixes_dir):
    app = create_app(token="secret", db_path=tmp_path / "catalog.db")
    with TestClient(app) as c:
        c.headers["X-Auth-Token"] = "secret"
        c.put("/api/settings", json={"sources": [str(mixes_dir)]})
        c.mixes_dir = mixes_dir
        yield c


def _a_mix(client):
    return str(next(p for p in client.mixes_dir.rglob("*.wav")))


def test_audio_needs_the_token_in_the_query(client):
    path = _a_mix(client)
    assert client.get("/api/audio", params={"path": path}).status_code == 401
    r = client.get("/api/audio", params={"path": path, "t": "secret"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("audio/")


def test_audio_and_peaks_refuse_files_outside_watched_folders(client, tmp_path):
    outside = make_wav(tmp_path / "elsewhere" / "secret.wav", value=7)
    assert client.get("/api/audio", params={"path": str(outside), "t": "secret"}).status_code == 404
    assert client.get("/api/peaks", params={"path": str(outside)}).status_code == 404
    notes = tmp_path / "mixes_notes.txt"
    notes.write_text("hi")
    assert client.get("/api/peaks", params={"path": str(notes)}).status_code == 404


def test_peaks_for_a_watched_mix(client):
    r = client.get("/api/peaks", params={"path": _a_mix(client)})
    assert r.status_code == 200 and len(r.json()["peaks"]) == 120


def test_sc_peaks_only_asks_soundcloud(client):
    r = client.get("/api/sc-peaks", params={"url": "https://example.com/x.png"})
    assert r.status_code == 400
    r = client.get("/api/sc-peaks", params={"url": "http://wave.sndcdn.com/x.png"})
    assert r.status_code == 400


def test_history_rows_carry_their_project(client):
    rows = client.get("/api/history").json()["uploads"]
    assert all("project_match" in r and "project_genre" in r for r in rows)
