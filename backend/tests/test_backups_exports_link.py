"""Uploader reads Backups' exports table: the exact file -> project link beats any
name guess, and older Backups catalogs without the table still work."""
import sqlite3

from lazyupload import projectmeta
from tests.test_manage_backups import _make_backups_db, _point_at


def _add_exports(db, rows):
    con = sqlite3.connect(str(db))
    con.execute("CREATE TABLE exports (path TEXT, project_id TEXT, name TEXT, size INTEGER, "
                "mtime REAL, match TEXT, hidden INTEGER DEFAULT 0)")
    for r in rows:
        con.execute("INSERT INTO exports (path, project_id, name, match, hidden) "
                    "VALUES (:path, :project_id, 'x', :match, :hidden)",
                    {"match": "name", "hidden": 0, **r})
    con.commit()
    con.close()


def test_exact_export_link_beats_name(tmp_path, monkeypatch):
    db = tmp_path / "catalog.db"
    _make_backups_db(db, [{"project_id": "a", "name": "Night Drive", "bpm": 128},
                          {"project_id": "b", "name": "Club Edit Session", "bpm": 140}])
    wav = tmp_path / "WAVS" / "Night Drive.wav"   # name says "a", Backups says "b"
    wav.parent.mkdir()
    wav.write_bytes(b"RIFF")
    hidden = tmp_path / "WAVS" / "Other.wav"
    _add_exports(db, [{"path": str(wav.resolve()), "project_id": "b", "match": "manual"},
                      {"path": str(hidden.resolve()), "project_id": "a", "hidden": 1}])
    _point_at(monkeypatch, db)
    assert projectmeta.lookup_by_path(wav)["project_id"] == "b"
    assert projectmeta.resolve(str(wav), "Night Drive")["project"] == "Club Edit Session"
    assert projectmeta.lookup_by_path(hidden) is None          # dismissed by the user

    mixes = [{"path": str(wav), "name": "Night Drive"},
             {"path": str(tmp_path / "x" / "Night Drive v2.wav"), "name": "Night Drive v2"}]
    assert projectmeta.annotate(mixes) == 2
    assert mixes[0]["project_match"] == "Club Edit Session" and mixes[0]["project_link"] == "exact"
    assert mixes[0]["bpm"] == 140
    assert mixes[1]["project_match"] == "Night Drive" and mixes[1]["project_link"] == "name"


def test_older_backups_without_exports_table(tmp_path, monkeypatch):
    db = tmp_path / "catalog.db"
    _make_backups_db(db, [{"project_id": "a", "name": "Night Drive"}])
    _point_at(monkeypatch, db)
    assert projectmeta.lookup_by_path(tmp_path / "Night Drive.wav") is None
    assert projectmeta.resolve(str(tmp_path / "Night Drive.wav"), "Night Drive")["project_id"] == "a"
