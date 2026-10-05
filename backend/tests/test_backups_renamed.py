"""Backups' "Tidy names" renames a song and its project: Uploader follows the rename,
so a song posted before it stays tied to its file and its project."""
import sqlite3

from lazyupload import projectmeta
from tests.test_backups_exports_link import _add_exports
from tests.test_manage_backups import _make_backups_db, _point_at


def _add_renamed(db, rows):
    con = sqlite3.connect(str(db))
    con.execute("CREATE TABLE renamed (old TEXT, new TEXT, kind TEXT, batch_id TEXT, at TEXT)")
    con.executemany("INSERT INTO renamed VALUES (?, ?, ?, ?, ?)", rows)
    con.commit()
    con.close()


def test_renamed_song_and_project_are_followed(tmp_path, monkeypatch):
    db = tmp_path / "catalog.db"
    _make_backups_db(db, [{"project_id": "new3", "name": "Glasshouse v3", "bpm": 124},
                          {"project_id": "new2", "name": "Glasshouse v2", "bpm": 120}])
    folder = tmp_path / "Glasshouse Project"
    folder.mkdir()
    now = folder / "Glasshouse v3 (master).wav"
    now.write_bytes(b"RIFF")
    old = tmp_path / "glasshouse Project" / "glasshouse final 3 master.wav"
    _add_exports(db, [{"path": str(now.resolve()), "project_id": "new3", "match": "folder"}])
    # one rename: the song, its folder, and two versions swapping ids ("v2"->"v1"-style)
    _add_renamed(db, [
        (str(old), str(now), "file", "b1", "t1"),
        (str(tmp_path / "glasshouse Project"), str(folder), "folder", "b1", "t1"),
        ("old3", "new3", "project", "b1", "t1"),
        ("new3", "new2", "project", "b1", "t1"),
    ])
    _point_at(monkeypatch, db)
    assert projectmeta.current_path(str(old)) == str(now)
    assert projectmeta.lookup_by_path(str(old))["project_id"] == "new3"
    assert projectmeta.resolve(str(old), old.stem)["project"] == "Glasshouse v3"
    # within one rename an id moves once, it doesn't chain
    assert projectmeta.lookup_meta_by_id("old3")["project"] == "Glasshouse v3"
    assert projectmeta.current_path(str(tmp_path / "elsewhere.wav")) == str(tmp_path / "elsewhere.wav")


def test_older_backups_without_renamed_table(tmp_path, monkeypatch):
    db = tmp_path / "catalog.db"
    _make_backups_db(db, [{"project_id": "a", "name": "Night Drive"}])
    _point_at(monkeypatch, db)
    assert projectmeta.current_path("/x/y.wav") == "/x/y.wav"
    assert projectmeta.lookup_meta_by_id("a")["project"] == "Night Drive"
