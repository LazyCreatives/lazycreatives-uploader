"""Custom cover art: pictures, the main picture, per-project choices and the image route."""
import base64
import hashlib
import json
import sqlite3

from fastapi.testclient import TestClient

from lazyupload import projectmeta
from lazyupload.api.app import create_app
from tests.test_manage_backups import _make_backups_db, _point_at

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 20


def _url(raw, mime="image/png"):
    return f"data:{mime};base64," + base64.b64encode(raw).decode()


def _client(tmp_path, token=""):
    return TestClient(create_app(token=token, db_path=tmp_path / "c.db"))


def _add(c, raw=PNG, mime="image/png", **kw):
    r = c.post("/api/covers/pictures", json={"data": _url(raw, mime), "w": 800, "h": 600, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_default_state(tmp_path, monkeypatch):
    _point_at(monkeypatch, tmp_path / "no-backups.db")
    assert _client(tmp_path).get("/api/covers").json() == {
        "rule": "genre", "style": "ink", "pictures": [], "projects": {}, "backups": None}


def test_add_pictures_first_is_main(tmp_path, monkeypatch):
    _point_at(monkeypatch, tmp_path / "no-backups.db")
    c = _client(tmp_path)
    s = _add(c, name="  Sunset  ")
    p = s["pictures"][0]
    assert p["name"] == "Sunset" and p["main"] is True and p["use"] == "background"
    assert (p["w"], p["h"], p["genres"]) == (800, 600, [])
    assert p["url"] == f"/api/covers/img/{p['id']}" and "file" not in p and len(p["id"]) == 12
    assert (tmp_path / "covers" / f"{p['id']}.png").read_bytes() == PNG
    s = _add(c, JPEG, "image/jpeg", use="full")
    q = s["pictures"][1]
    assert q["name"] == "Picture 2" and q["main"] is False and q["use"] == "full"
    assert (tmp_path / "covers" / f"{q['id']}.jpg").is_file()
    s = _add(c, WEBP, "image/webp", name="x" * 200)
    assert len(s["pictures"][2]["name"]) == 80
    got = c.get("/api/covers").json()
    assert got.pop("backups") is None and got == s


def test_patch_and_main_is_exclusive(tmp_path):
    c = _client(tmp_path)
    _add(c)
    s = _add(c)
    a, b = (p["id"] for p in s["pictures"])
    s = c.patch(f"/api/covers/pictures/{b}", json={
        "name": " Night ", "use": "full", "main": True,
        "genres": ["Techno", " techno ", "", "y" * 60] + [f"g{i}" for i in range(50)]}).json()
    pa, pb = s["pictures"]
    assert pa["main"] is False and pb["main"] is True
    assert pb["name"] == "Night" and pb["use"] == "full"
    assert pb["genres"][:3] == ["Techno", "techno", "y" * 40] and len(pb["genres"]) == 40
    s = c.patch(f"/api/covers/pictures/{a}", json={"main": True}).json()
    assert [p["main"] for p in s["pictures"]] == [True, False]
    s = c.patch(f"/api/covers/pictures/{a}", json={"main": False}).json()
    assert [p["main"] for p in s["pictures"]] == [False, False]
    assert c.patch("/api/covers/pictures/nope", json={"name": "x"}).status_code == 404
    assert c.patch(f"/api/covers/pictures/{a}", json={"use": "tiled"}).status_code == 422


def test_settings(tmp_path):
    c = _client(tmp_path)
    s = c.put("/api/covers/settings", json={"rule": "one"}).json()
    assert (s["rule"], s["style"]) == ("one", "ink")
    s = c.put("/api/covers/settings", json={"style": "strip"}).json()
    assert (s["rule"], s["style"]) == ("one", "strip")
    assert c.put("/api/covers/settings", json={"rule": "random"}).status_code == 422
    assert c.put("/api/covers/settings", json={"style": "neon"}).status_code == 422


def test_choice(tmp_path):
    c = _client(tmp_path)
    pid = _add(c)["pictures"][0]["id"]
    s = c.put("/api/covers/choice", json={"name": "Night Drive", "choice": {
        "pic": pid, "use": "full", "fx": 3, "fy": -1, "style": "photo"}}).json()
    assert s["projects"]["Night Drive"] == {"pic": pid, "use": "full", "fx": 1.0, "fy": 0.0,
                                            "style": "photo"}
    s = c.put("/api/covers/choice", json={"name": "Drawn", "choice": {"pic": None}}).json()
    assert s["projects"]["Drawn"] == {"pic": None, "use": None, "fx": 0.5, "fy": 0.5,
                                      "style": None}
    assert c.put("/api/covers/choice", json={"name": "X", "choice": {"pic": "nope"}}).status_code == 404
    assert c.put("/api/covers/choice", json={"name": "", "choice": None}).status_code == 422
    assert c.put("/api/covers/choice", json={"name": "y" * 301, "choice": None}).status_code == 422
    assert c.put("/api/covers/choice", json={"name": "X", "choice": {"style": "neon"}}).status_code == 422
    assert c.put("/api/covers/choice", json={"name": "X", "choice": {"use": "tiled"}}).status_code == 422
    s = c.put("/api/covers/choice", json={"name": "Drawn", "choice": None}).json()
    assert "Drawn" not in s["projects"] and "Night Drive" in s["projects"]


def test_delete_removes_file_and_choices(tmp_path):
    c = _client(tmp_path)
    _add(c)
    s = _add(c)
    a, b = (p["id"] for p in s["pictures"])
    c.put("/api/covers/choice", json={"name": "A", "choice": {"pic": a}})
    c.put("/api/covers/choice", json={"name": "B", "choice": {"pic": b}})
    c.put("/api/covers/choice", json={"name": "Drawn", "choice": {"pic": None}})
    s = c.delete(f"/api/covers/pictures/{a}").json()
    assert [p["id"] for p in s["pictures"]] == [b]
    assert set(s["projects"]) == {"B", "Drawn"}
    assert not (tmp_path / "covers" / f"{a}.png").exists()
    assert (tmp_path / "covers" / f"{b}.png").exists()
    assert c.delete(f"/api/covers/pictures/{a}").status_code == 404


def test_bad_data(tmp_path):
    c = _client(tmp_path)
    post = lambda data: c.post("/api/covers/pictures", json={"data": data, "w": 1, "h": 1})
    assert post("data:image/png;base64,@@@not-base64@@@").status_code == 400
    assert post(_url(b"GIF89a" + b"\x00" * 10, "image/gif")).status_code == 400
    assert post(_url(JPEG, "image/png")).status_code == 400   # bytes don't match the type
    assert post(_url(b"RIFF\x00\x00\x00\x00WAVE", "image/webp")).status_code == 400
    assert post("hello").status_code == 400
    assert post(_url(PNG + b"\x00" * (12 * 1024 * 1024))).status_code == 413
    assert c.get("/api/covers").json()["pictures"] == []


def test_img_needs_token(tmp_path):
    c = _client(tmp_path, token="secret")
    h = {"X-Auth-Token": "secret"}
    assert c.get("/api/covers").status_code == 401
    r = c.post("/api/covers/pictures", json={"data": _url(JPEG, "image/jpeg"), "w": 1, "h": 1},
               headers=h)
    pid = r.json()["pictures"][0]["id"]
    assert c.get(f"/api/covers/img/{pid}").status_code == 401
    assert c.get(f"/api/covers/img/{pid}?t=wrong").status_code == 401
    r = c.get(f"/api/covers/img/{pid}?t=secret")
    assert r.status_code == 200 and r.content == JPEG
    assert r.headers["content-type"] == "image/jpeg"
    assert r.headers["cache-control"] == "max-age=31536000, immutable"
    assert c.get("/api/covers/img/nope?t=secret").status_code == 404
    assert c.get("/api/covers/img/..%2Fc.db?t=secret").status_code == 404


# ---- Uploader only: finished covers, and the covers picked in Backups -----------
def test_render_saves_png_once(tmp_path):
    c = _client(tmp_path)
    r = c.post("/api/covers/render", json={"name": "Night Drive", "data": _url(PNG)})
    assert r.status_code == 200
    path = r.json()["path"]
    expect = (tmp_path / "covers" / "rendered" / (hashlib.sha1(PNG).hexdigest() + ".png")).resolve()
    assert path == str(expect) and expect.read_bytes() == PNG
    again = c.post("/api/covers/render", json={"name": "Other", "data": _url(PNG)}).json()
    assert again["path"] == path
    assert len(list((tmp_path / "covers" / "rendered").iterdir())) == 1
    assert c.post("/api/covers/render", json={"name": "x", "data": _url(JPEG, "image/jpeg")}).status_code == 200
    assert c.post("/api/covers/render", json={"name": "x", "data": _url(WEBP, "image/webp")}).status_code == 400
    assert c.post("/api/covers/render", json={"name": "x", "data": "data:image/png;base64,%%"}).status_code == 400
    assert c.post("/api/covers/render", json={"name": "x", "data": _url(JPEG, "image/png")}).status_code == 400


def _fake_backups(tmp_path, monkeypatch, state=None):
    bdir = tmp_path / "Backups"
    bdir.mkdir()
    db = bdir / "catalog.db"
    _make_backups_db(db, [{"project_id": "p1", "name": "Night Drive"}])
    if state is not None:
        con = sqlite3.connect(str(db))
        con.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
        con.execute("INSERT INTO settings VALUES ('covers', ?)", (json.dumps(state),))
        con.commit()
        con.close()
    _point_at(monkeypatch, db)
    return bdir


def test_backups_covers_reader(tmp_path, monkeypatch):
    _point_at(monkeypatch, tmp_path / "missing.db")
    assert projectmeta.backups_covers() is None
    state = {"rule": "one", "pictures": [], "projects": {"Night Drive": {"pic": None}}}
    bdir = _fake_backups(tmp_path, monkeypatch, state)
    found = projectmeta.backups_covers()
    assert found == {"state": state, "folder": str((bdir / "covers").resolve())}


def test_backups_covers_reader_older_backups(tmp_path, monkeypatch):
    bdir = _fake_backups(tmp_path, monkeypatch)  # no settings table at all
    assert projectmeta.backups_covers() == {"state": {}, "folder": str((bdir / "covers").resolve())}


def test_backups_covers_in_api(tmp_path, monkeypatch):
    state = {"rule": "genre", "style": "photo",
             "pictures": [{"id": "abc123abc123", "name": "Sea", "use": "full", "genres": [],
                           "main": True, "w": 10, "h": 10, "file": "abc123abc123.webp"},
                          {"id": "gone00000000", "name": "Gone", "use": "full", "genres": [],
                           "main": False, "w": 1, "h": 1, "file": "gone00000000.png"}],
             "projects": {"Night Drive": {"pic": "abc123abc123", "use": "full", "fx": 0.2, "fy": 0.8}}}
    bdir = _fake_backups(tmp_path, monkeypatch, state)
    (bdir / "covers").mkdir()
    (bdir / "covers" / "abc123abc123.webp").write_bytes(WEBP)
    (bdir / "covers" / "stray.png").write_bytes(PNG)
    own = tmp_path / "Uploader"
    own.mkdir()
    c = _client(own, token="secret")
    h = {"X-Auth-Token": "secret"}
    b = c.get("/api/covers", headers=h).json()["backups"]
    assert b["projects"] == state["projects"]
    assert b["pictures"][0]["url"] == "/api/covers/backups-img/abc123abc123"
    assert all("file" not in p for p in b["pictures"])
    assert c.get("/api/covers/backups-img/abc123abc123").status_code == 401
    r = c.get("/api/covers/backups-img/abc123abc123?t=secret")
    assert r.status_code == 200 and r.content == WEBP
    assert r.headers["content-type"] == "image/webp"
    assert r.headers["cache-control"] == "max-age=31536000, immutable"
    assert c.get("/api/covers/backups-img/gone00000000?t=secret").status_code == 404  # file missing
    assert c.get("/api/covers/backups-img/stray?t=secret").status_code == 404        # not in state
    # Uploader's own pictures are not served from the Backups route, nor the reverse
    pid = c.post("/api/covers/pictures", json={"data": _url(PNG), "w": 1, "h": 1},
                 headers=h).json()["pictures"][0]["id"]
    assert c.get(f"/api/covers/backups-img/{pid}?t=secret").status_code == 404
    assert c.get("/api/covers/img/abc123abc123?t=secret").status_code == 404
