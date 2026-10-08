"""Albums: one list shared with Backups. Make one, add songs, reorder, mark joins,
and see what each song still needs. The audio files themselves are never changed."""
import hashlib

import pytest
from fastapi.testclient import TestClient

from lazyupload.albums import Albums, file_checks, judge_album
from lazyupload.api.app import create_app
from tests.helpers import make_wav


@pytest.fixture
def mixes_dir(tmp_path):
    d = tmp_path / "Mixes"
    for i, name in enumerate(["Sunset Dub", "Midnight Drive", "Warehouse Set"]):
        make_wav(d / f"{name}.wav", seconds=40, rate=2000, value=i + 1)
    make_wav(d / "Midnight Drive - Kick.wav", seconds=40, rate=2000, value=9)  # a stem stays off
    make_wav(d / "click test.wav", value=8)                                 # so does a test bounce
    return d


@pytest.fixture
def client(tmp_path, mixes_dir):
    app = create_app(token="secret", db_path=tmp_path / "catalog.db")
    with TestClient(app) as c:
        c.headers["X-Auth-Token"] = "secret"
        c.put("/api/settings", json={"sources": [str(mixes_dir)]})
        c.mixes_dir = mixes_dir
        yield c


def _digest(folder):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(folder.rglob("*")) if p.is_file()}


def test_make_fill_reorder_and_read_back(client):
    before = _digest(client.mixes_dir)
    cands = client.get("/api/albums/candidates").json()
    assert {c["title"] for c in cands} == {"Sunset Dub", "Midnight Drive", "Warehouse Set"}

    a = client.post("/api/albums", json={"title": "  Night Drive ", "release_date": "2026-11-14"}).json()
    assert a["title"] == "Night Drive" and a["release_date"] == "2026-11-14" and a["songs"] == []

    a = client.post(f"/api/albums/{a['id']}/songs", json={"songs": [
        {"path": c["path"], "title": c["title"]} for c in sorted(cands, key=lambda c: c["title"])]}).json()
    titles = [s["title"] for s in a["songs"]]
    assert titles == ["Midnight Drive", "Sunset Dub", "Warehouse Set"]
    assert all(s["is_ready"] and s["needs"] == [] for s in a["songs"])

    # adding one twice leaves it where it is
    again = client.post(f"/api/albums/{a['id']}/songs", json={"songs": [{"path": a["songs"][0]["path"]}]}).json()
    assert [s["title"] for s in again["songs"]] == titles

    paths = [s["path"] for s in a["songs"]]
    a = client.put(f"/api/albums/{a['id']}/order", json={"paths": [paths[2], paths[0]]}).json()
    assert [s["title"] for s in a["songs"]] == ["Warehouse Set", "Midnight Drive", "Sunset Dub"]

    a = client.put(f"/api/albums/{a['id']}", json={"crossfade": 6}).json()
    assert a["crossfade"] == 6
    a = client.put(f"/api/albums/{a['id']}/song", json={"path": paths[2], "gapless_after": True}).json()
    assert a["songs"][0]["gapless_after"] is True

    # the album's songs can be played even from outside the watched folders
    assert client.get("/api/audio", params={"path": paths[0], "t": "secret"}).status_code == 200

    listed = client.get("/api/albums").json()
    assert [x["title"] for x in listed["albums"]] == ["Night Drive"] and listed["rev"] > 0
    assert _digest(client.mixes_dir) == before  # nothing written next to the music


def test_both_apps_see_the_same_list(tmp_path):
    """Two stores on one file stand in for Backups and Uploader."""
    db = tmp_path / "albums.db"
    uploader, backups = Albums(db), Albums(db)
    song = make_wav(tmp_path / "Exit 9.wav", value=4)
    a = backups.create("Summer Tapes")
    rev = uploader.rev()
    uploader.add_songs(a["id"], [{"path": str(song)}])
    assert backups.rev() > rev
    assert [s["title"] for s in backups.get(a["id"])["songs"]] == ["Exit 9"]
    backups.delete(a["id"])
    assert uploader.all() == []


def test_what_a_song_still_needs(tmp_path):
    wav = make_wav(tmp_path / "Low Beams.wav")
    mp3 = tmp_path / "Glovebox.mp3"
    mp3.write_bytes(b"ID3")
    assert file_checks({"path": str(wav), "title": "Low Beams"}) == []
    assert file_checks({"path": str(mp3), "title": "Glovebox"}) == ["Needs a WAV"]
    make_wav(tmp_path / "Glovebox.wav")
    assert file_checks({"path": str(mp3), "title": "Glovebox"}) == []
    assert file_checks({"path": str(wav), "title": "Untitled 14"}) == ["Needs a title"]
    assert file_checks({"path": str(tmp_path / "gone.wav"), "title": "Gone"}) == ["File moved or deleted"]


def test_your_own_tick_wins(client, tmp_path):
    mp3 = tmp_path / "elsewhere" / "Glovebox.mp3"
    mp3.parent.mkdir()
    mp3.write_bytes(b"ID3")
    a = client.post("/api/albums", json={"title": "EP"}).json()
    a = client.post(f"/api/albums/{a['id']}/songs", json={"songs": [{"path": str(mp3)}]}).json()
    assert a["songs"][0]["is_ready"] is False and a["songs"][0]["needs"] == ["Needs a WAV"]
    a = client.put(f"/api/albums/{a['id']}/song", json={"path": str(mp3), "ready": True}).json()
    assert a["songs"][0]["is_ready"] is True
    a = client.put(f"/api/albums/{a['id']}/song", json={"path": str(mp3), "clear_ready": True}).json()
    assert a["songs"][0]["is_ready"] is False


def test_missing_album_is_a_plain_404(client):
    assert client.put("/api/albums/nope", json={"title": "x"}).status_code == 404
    assert client.delete("/api/albums/nope").status_code == 404
    assert client.get("/api/albums").status_code == 200
    bad = client.post("/api/albums", json={"title": "x", "release_date": "next week"}).json()
    assert bad["release_date"] == ""


def test_needs_the_token(tmp_path):
    app = create_app(token="secret", db_path=tmp_path / "catalog.db")
    with TestClient(app) as c:
        assert c.get("/api/albums").status_code == 401


def test_project_and_backup_state_come_from_backups(tmp_path):
    """Both apps read the project behind each song from Backups' records, read-only."""
    import sqlite3
    song = make_wav(tmp_path / "Exports" / "Night Drive.wav")
    other = make_wav(tmp_path / "Exports" / "Loose.wav", value=2)
    db = tmp_path / "catalog.db"
    con = sqlite3.connect(db)
    con.executescript("""
        CREATE TABLE discovered (project_id TEXT, name TEXT, daw TEXT, path TEXT, mtime REAL, backed_mtime REAL);
        CREATE TABLE exports (path TEXT, project_id TEXT, mtime REAL, hidden INTEGER);""")
    con.execute("INSERT INTO discovered VALUES ('p1', 'Night Drive v7', 'Ableton', '/nowhere/x.als', 5000, 4000)")
    con.execute("INSERT INTO exports VALUES (?, 'p1', 1000, 0)", (str(song),))
    con.commit()
    con.close()
    album = {"songs": [{"path": str(song), "title": "Night Drive", "project": "", "ready": None},
                       {"path": str(other), "title": "Loose", "project": "", "ready": None}]}
    judge_album(album, db)
    a, b = album["songs"]
    assert a["project"] == "Night Drive v7" and a["daw"] == "Ableton" and a["backup"] == "changed"
    assert a["needs"] == ["Project changed since export"] and a["is_ready"] is False
    assert b["project_id"] is None and b["is_ready"] is True
    judge_album(album, tmp_path / "no-backups.db")  # Backups not installed: no crash


def test_song_keeps_the_genre_it_was_added_with(client):
    """The album's stripe is coloured by its songs' genre, sent along when a song is added."""
    paths = sorted(str(p) for p in client.mixes_dir.glob("*.wav") if " - " not in p.name and "click" not in p.name)
    a = client.post("/api/albums", json={"title": "Tapes"}).json()
    a = client.post(f"/api/albums/{a['id']}/songs", json={"songs": [
        {"path": paths[0], "genre": "Dub"}, {"path": paths[1]}]}).json()
    assert [s["genre"] for s in a["songs"]] == ["Dub", ""]


def test_old_album_list_gains_genre(tmp_path):
    """A list made before songs kept a genre still opens, and its songs have none."""
    import sqlite3
    db = tmp_path / "albums.db"
    con = sqlite3.connect(db)
    con.executescript("""
      CREATE TABLE albums (id TEXT PRIMARY KEY, title TEXT NOT NULL, release_date TEXT NOT NULL DEFAULT '',
        crossfade REAL NOT NULL DEFAULT 0, created_at REAL NOT NULL, updated_at REAL NOT NULL);
      CREATE TABLE album_songs (album_id TEXT NOT NULL, pos INTEGER NOT NULL, path TEXT NOT NULL,
        title TEXT NOT NULL, project TEXT NOT NULL DEFAULT '', gapless_after INTEGER NOT NULL DEFAULT 0,
        ready INTEGER, added_at REAL NOT NULL, PRIMARY KEY (album_id, path));
      INSERT INTO albums VALUES ('a1', 'Old', '', 0, 1, 1);
      INSERT INTO album_songs VALUES ('a1', 0, '/x/Old song.wav', 'Old song', '', 0, NULL, 1);
    """)
    con.commit()
    con.close()
    store = Albums(db)
    assert store.all()[0]["songs"][0]["genre"] == ""
    store.add_songs("a1", [{"path": "/x/New.wav", "genre": "Grime"}])
    assert [s["genre"] for s in store.all()[0]["songs"]] == ["", "Grime"]
