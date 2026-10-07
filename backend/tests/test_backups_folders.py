"""Uploader can also look in the export folders Backups knows about, when asked to.
Off by default; Backups' catalog is only ever read."""
import json
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from lazyupload import projectmeta, service
from lazyupload.api.app import create_app
from tests.test_manage_backups import _make_backups_db, _point_at


def _backups_with_folders(tmp_path, monkeypatch, added, found):
    db = tmp_path / "backups" / "catalog.db"
    db.parent.mkdir()
    _make_backups_db(db, [])
    con = sqlite3.connect(str(db))
    con.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
    con.execute("INSERT INTO settings VALUES ('export_folders', ?)", (json.dumps(added),))
    con.execute("INSERT INTO settings VALUES ('found_export_folders', ?)", (json.dumps(found),))
    con.commit()
    con.close()
    _point_at(monkeypatch, db)
    return db


def test_backups_export_folders_are_read(tmp_path, monkeypatch):
    a, b = tmp_path / "Bounces", tmp_path / "Renders"
    a.mkdir(), b.mkdir()
    _backups_with_folders(tmp_path, monkeypatch, [str(a)], [str(b), str(a), str(tmp_path / "gone")])
    assert projectmeta.backups_export_folders() == [str(a), str(b)]  # gone ones left out


def test_no_backups_means_none(tmp_path, monkeypatch):
    _point_at(monkeypatch, tmp_path / "nothing.db")
    monkeypatch.setattr(projectmeta, "find_backups_db", lambda: None)
    assert projectmeta.backups_export_folders() is None
    assert service.watched_sources({"sources": ["/m"], "watch_backups_folders": True}) == [Path("/m")]


def test_only_when_switched_on(tmp_path, monkeypatch):
    mine = tmp_path / "Mixdowns"
    inside = mine / "Bounces"
    other = tmp_path / "Renders"
    inside.mkdir(parents=True), other.mkdir()
    _backups_with_folders(tmp_path, monkeypatch, [str(inside)], [str(other)])
    cfg = {"sources": [str(mine)]}
    assert service.watched_sources(cfg) == [mine]
    # on: Backups' folders join, except one already inside a watched folder
    assert service.watched_sources({**cfg, "watch_backups_folders": True}) == [mine, other]


def test_scan_looks_in_backups_folders(tmp_path, monkeypatch, mixes_dir):
    other = tmp_path / "Renders"
    other.mkdir()
    (other / "From Backups.wav").write_bytes((mixes_dir / next(
        p.name for p in mixes_dir.iterdir() if p.suffix == ".wav")).read_bytes())
    db = _backups_with_folders(tmp_path, monkeypatch, [], [str(other)])
    app = create_app(token="", db_path=tmp_path / "catalog.db")
    with TestClient(app) as c:
        assert c.get("/api/backups-folders").json() == {"installed": True, "folders": [str(other)]}
        cfg = c.get("/api/settings").json()
        cfg["sources"] = [str(mixes_dir)]
        assert c.put("/api/settings", json=cfg).status_code == 200
        names = lambda: {m["name"] for m in c.post("/api/scan", json={}).json()["mixes"]}
        assert "From Backups" not in names()
        cfg["watch_backups_folders"] = True
        assert c.put("/api/settings", json=cfg).status_code == 200
        assert "From Backups" in names()
    assert db.exists()
