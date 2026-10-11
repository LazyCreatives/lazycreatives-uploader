"""An older Backups misread some FL Studio projects as 3221226 BPM. Uploader reads
Backups' records, so it must never put an impossible tempo on a track or a tag."""
import sqlite3

from lazyupload.projectmeta import _load_full, plausible_bpm


def test_impossible_bpm_from_backups_is_blank():
    con = sqlite3.connect(":memory:")
    con.execute("CREATE TABLE discovered (name TEXT, bpm REAL, genre TEXT, genre_emoji TEXT)")
    con.executemany("INSERT INTO discovered VALUES (?, ?, ?, ?)",
                    [("Im a Raven", 3221226.0, "Dubstep", None), ("Night Drive", 124.0, "House", None),
                     ("Untitled", None, None, None), ("Glitch", 0.0, None, None)])
    bpms = {m["project"]: m["bpm"] for m in _load_full(con)}
    assert bpms == {"Im a Raven": None, "Night Drive": 124.0, "Untitled": None, "Glitch": None}


def test_plausible_bpm_edges():
    assert plausible_bpm(10) == 10.0 and plausible_bpm(999) == 999.0
    assert plausible_bpm(9.9) is None and plausible_bpm(1000) is None
    assert plausible_bpm("abc") is None and plausible_bpm(None) is None
