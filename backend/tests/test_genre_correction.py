"""Genre corrections: a genre the producer set in Backups flows into Uploader (and is
flagged as set by you), and a single mix can carry a genre of its own."""
import sqlite3

from lazyupload import projectmeta, service
from lazyupload.catalog import Catalog
from tests.test_manage_backups import _make_backups_db, _point_at


def _add_by_you(db, pid):
    con = sqlite3.connect(str(db))
    con.execute("ALTER TABLE discovered ADD COLUMN genre_by_you INTEGER DEFAULT 0")
    con.execute("UPDATE discovered SET genre = 'House', genre_by_you = 1 WHERE project_id = ?", (pid,))
    con.commit()
    con.close()


def test_backups_correction_flows_in(tmp_path, monkeypatch):
    db = tmp_path / "catalog.db"
    _make_backups_db(db, [{"project_id": "a", "name": "Glasshouse", "genre": "Phonk", "bpm": 124},
                          {"project_id": "b", "name": "Night Bus", "genre": "DnB", "bpm": 174}])
    _add_by_you(db, "a")
    _point_at(monkeypatch, db)
    mixes = [{"path": "/x/Glasshouse.wav", "name": "Glasshouse"}, {"path": "/x/Night Bus.wav", "name": "Night Bus"}]
    projectmeta.annotate(mixes)
    assert (mixes[0]["genre"], mixes[0]["genre_by_you"], mixes[0]["genre_project"]) == ("House", True, "House")
    assert (mixes[1]["genre"], mixes[1]["genre_by_you"]) == ("DnB", False)


def test_older_backups_without_the_flag_still_work(tmp_path, monkeypatch):
    db = tmp_path / "catalog.db"
    _make_backups_db(db, [{"project_id": "a", "name": "Glasshouse", "genre": "Phonk"}])
    _point_at(monkeypatch, db)
    mixes = [{"path": "/x/Glasshouse.wav", "name": "Glasshouse"}]
    projectmeta.annotate(mixes)
    assert (mixes[0]["genre"], mixes[0]["genre_by_you"]) == ("Phonk", False)


def test_a_mix_can_have_its_own_genre(tmp_path):
    cat = Catalog(tmp_path / "u.db")
    service.set_mix_genre(cat, ["/x/Remix.wav"], "UK garage")
    mixes = [{"path": "/x/Remix.wav", "name": "Remix", "genre": "House", "genre_by_you": False},
             {"path": "/x/Other.wav", "name": "Other", "genre": "House"}]
    service.apply_mix_genres(mixes, cat)
    assert (mixes[0]["genre"], mixes[0]["genre_by_you"], mixes[0]["genre_mix"]) == ("UK garage", True, True)
    assert (mixes[1]["genre"], mixes[1]["genre_mix"]) == ("House", False)

    service.set_mix_genre(cat, ["/x/Remix.wav"], None)  # back to the project's genre
    again = [{"path": "/x/Remix.wav", "name": "Remix", "genre": "House"}]
    service.apply_mix_genres(again, cat)
    assert (again[0]["genre"], again[0]["genre_mix"]) == ("House", False)
