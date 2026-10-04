"""Manage page backend: the Backups join (projectmeta widening + hash-anchored
enrichment), bulk track operations, and created_at ISO normalization.

Builds a minimal Backups catalog.db fixture so schema assumptions are exercised in CI
rather than discovered in the wild."""
import json
import sqlite3

from lazyupload import projectmeta, service, soundcloud
from lazyupload.connect import SoundCloudConnectSession
from tests.helpers import make_wav


def _make_backups_db(path, discovered, snapshots=None, with_snapshots_table=True):
    """Write a fixture mirroring the real Backups catalog shape."""
    con = sqlite3.connect(str(path))
    con.execute(
        "CREATE TABLE discovered (project_id TEXT, name TEXT, path TEXT, dir TEXT, "
        "daw TEXT, owner TEXT, size INTEGER, mtime REAL, missing_count INTEGER, "
        "found_at TEXT, genre TEXT, genre_emoji TEXT, bpm REAL, tracks INTEGER, plugins TEXT)")
    for d in discovered:
        con.execute(
            "INSERT INTO discovered (project_id, name, daw, owner, size, mtime, "
            "missing_count, genre, genre_emoji, bpm, tracks, plugins) "
            "VALUES (:project_id,:name,:daw,:owner,:size,:mtime,:missing_count,"
            ":genre,:genre_emoji,:bpm,:tracks,:plugins)",
            {"daw": "ableton", "owner": "rob", "size": 0, "mtime": 0, "missing_count": 0,
             "genre": None, "genre_emoji": None, "bpm": None, "tracks": None,
             "plugins": None, **d})
    if with_snapshots_table:
        con.execute(
            "CREATE TABLE snapshots (id INTEGER PRIMARY KEY, project_name TEXT, "
            "timestamp TEXT, total_size INTEGER, file_count INTEGER, status TEXT, "
            "verified INTEGER, verified_at TEXT, project_id TEXT)")
        for s in (snapshots or []):
            con.execute(
                "INSERT INTO snapshots (project_name, timestamp, total_size, file_count, "
                "status, verified, verified_at, project_id) VALUES "
                "(:project_name,:timestamp,:total_size,:file_count,:status,:verified,"
                ":verified_at,:project_id)",
                {"total_size": 0, "file_count": 0, "status": "ok", "verified": 1,
                 "verified_at": None, **s})
    con.commit()
    con.close()


def _point_at(monkeypatch, path):
    monkeypatch.setenv("LAZYUP_BACKUPS_DB", str(path))
    # bust the mtime cache so the fresh fixture is read
    projectmeta._cache.update(path=None, mtime=None)


def _connect_mock(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


# ---- projectmeta widening ----------------------------------------------------
def test_lookup_meta_returns_rich_object(tmp_path, monkeypatch):
    db = tmp_path / "catalog.db"
    _make_backups_db(
        db,
        [{"project_id": "p1", "name": "Night Drive", "daw": "ableton", "bpm": 128.4,
          "genre": "Phonk", "genre_emoji": "💀", "tracks": 24, "missing_count": 2,
          "size": 5000, "mtime": 1700000000.0,
          "plugins": json.dumps(["Serum 2", "FabFilter Pro-Q 4", "Ozone 11"])}],
        [{"project_id": "p1", "project_name": "Night Drive", "timestamp": "2026-06-09_2235",
          "total_size": 200, "file_count": 12, "verified": 1, "verified_at": "2026-06-10_1000"},
         {"project_id": "p1", "project_name": "Night Drive", "timestamp": "2026-06-11_0900",
          "total_size": 210, "file_count": 13, "verified": 1, "verified_at": "2026-06-11_0905"}])
    _point_at(monkeypatch, db)

    meta = projectmeta.lookup_meta("Night Drive.wav")
    assert meta is not None
    assert meta["project"] == "Night Drive"
    assert meta["bpm"] == 128.4 and meta["genre"] == "Phonk" and meta["genre_emoji"] == "💀"
    assert meta["daw"] == "ableton" and meta["track_count"] == 24 and meta["missing_count"] == 2
    assert meta["plugin_count"] == 3
    b = meta["backups"]
    assert b["count"] == 2 and b["verified"] is True
    assert b["first_backup"] == "2026-06-09T22:35:00"   # custom ts parsed to ISO
    assert b["last_backup"] == "2026-06-11T09:00:00"
    assert b["file_count"] == 13 and b["archived_bytes"] == 410


def test_name_collision_is_ambiguous_but_id_lookup_is_exact(tmp_path, monkeypatch):
    db = tmp_path / "catalog.db"
    _make_backups_db(db, [
        {"project_id": "a", "name": "Untitled", "bpm": 140, "genre": "Trap"},
        {"project_id": "b", "name": "untitled", "bpm": 90, "genre": "Lo-fi"},
    ])
    _point_at(monkeypatch, db)
    # strict Manage lookup refuses to guess between the two same-named projects
    assert projectmeta.lookup_meta("Untitled") is None
    # but a hash-anchored project_id lookup is exact
    assert projectmeta.lookup_meta_by_id("a")["genre"] == "Trap"
    assert projectmeta.lookup_meta_by_id("b")["bpm"] == 90


def test_missing_snapshots_table_still_yields_bpm_genre(tmp_path, monkeypatch):
    db = tmp_path / "catalog.db"
    _make_backups_db(db, [{"project_id": "p1", "name": "Solo Jam", "bpm": 174, "genre": "DnB"}],
                     with_snapshots_table=False)
    _point_at(monkeypatch, db)
    meta = projectmeta.lookup_meta("Solo Jam")
    assert meta is not None and meta["bpm"] == 174 and meta["genre"] == "DnB"
    assert meta["backups"] is None  # no snapshots table -> no history, but enrichment survived


# ---- created_at ISO normalization --------------------------------------------
def test_created_at_normalized_to_iso():
    t = soundcloud.normalize_track({"id": 1, "created_at": "2024/11/02 21:00:00 +0000"})
    assert t["created_at"] == "2024-11-02T21:00:00+00:00"


def test_created_at_empty_becomes_null():
    assert soundcloud.normalize_track({"id": 1, "created_at": ""})["created_at"] is None
    assert soundcloud.normalize_track({"id": 1})["created_at"] is None


# ---- hash-anchored enrichment of the managed list ----------------------------
def test_list_tracks_enriches_uploaded_track(tmp_path, monkeypatch):
    db = tmp_path / "catalog.db"
    _make_backups_db(
        db,
        [{"project_id": "px", "name": "Loop Idea", "bpm": 150, "genre": "Trap",
          "genre_emoji": "🔥", "daw": "ableton"}],
        [{"project_id": "px", "project_name": "Loop Idea", "timestamp": "2026-06-01_1200",
          "verified": 1}])
    _point_at(monkeypatch, db)

    catalog = service.Catalog(tmp_path / "uploads.db")
    _connect_mock(catalog)
    f = tmp_path / "Loop Idea.wav"
    make_wav(f, value=1)
    service.run_upload(catalog, [{"path": str(f), "name": "Loop Idea"}], {"sharing": "public"})

    tracks = service.list_tracks(catalog)
    hit = next((t for t in tracks if t.get("project_match") == "Loop Idea"), None)
    assert hit is not None, "the uploaded track should join to its Backups project"
    assert hit["bpm"] == 150 and hit["genre_emoji"] == "🔥" and hit["daw"] == "ableton"
    assert hit["backups"]["count"] == 1


# ---- bulk operations ---------------------------------------------------------
def test_bulk_update_and_delete_report_per_item(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    catalog = service.Catalog(tmp_path / "uploads.db")
    _connect_mock(catalog)
    for i in (1, 2):
        f = tmp_path / f"mix{i}.wav"
        make_wav(f, value=i)
        service.run_upload(catalog, [{"path": str(f), "name": f"mix{i}"}], {"sharing": "public"})

    tracks = service.list_tracks(catalog)
    ids = [t["id"] for t in tracks if t["title"].startswith("mix")]
    assert len(ids) == 2

    res = service.bulk_update(catalog, ids, {"sharing": "private"})
    assert all(r["ok"] for r in res) and {r["id"] for r in res} == set(ids)
    again = {t["id"]: t for t in service.list_tracks(catalog)}
    assert all(again[i]["sharing"] == "private" for i in ids)

    # delete one real id + one bogus id -> per-item ledger distinguishes them
    res2 = service.bulk_delete(catalog, [ids[0], 999999999])
    by_id = {r["id"]: r for r in res2}
    assert by_id[ids[0]]["ok"] is True
    assert by_id[999999999]["ok"] is False and by_id[999999999]["error"]
    remaining = {t["id"] for t in service.list_tracks(catalog)}
    assert ids[0] not in remaining and ids[1] in remaining


def test_artwork_url_upgraded_to_hi_res():
    from lazyupload import soundcloud
    t = soundcloud.normalize_track(
        {"id": 1, "artwork_url": "https://i1.sndcdn.com/artworks-abc-large.jpg"})
    assert t["artwork_url"] == "https://i1.sndcdn.com/artworks-abc-t500x500.jpg"
    # already hi-res / missing art passes through untouched
    assert soundcloud.normalize_track({"id": 2, "artwork_url": None})["artwork_url"] is None


def test_bulk_update_returns_enriched_tracks(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    catalog = service.Catalog(tmp_path / "u.db")
    _connect_mock(catalog)
    f = tmp_path / "Solo.wav"; make_wav(f, value=1)
    service.run_upload(catalog, [{"path": str(f), "name": "Solo"}], {"sharing": "public"})
    tid = next(t["id"] for t in service.list_tracks(catalog) if t["title"] == "Solo")
    res = service.bulk_update(catalog, [tid], {"genre": "Techno"})
    item = next(r for r in res if r["id"] == tid)
    # ledger item now carries the enriched updated track so the UI can splice it
    assert item["ok"] and item["track"]["genre"] == "Techno" and "seo" in item["track"]


def test_uploads_by_sc_track_id_batches_the_join(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    catalog = service.Catalog(tmp_path / "u.db")
    _connect_mock(catalog)
    f = tmp_path / "X.wav"; make_wav(f, value=1)
    service.run_upload(catalog, [{"path": str(f), "name": "X"}], {"sharing": "public"})
    tid = next(t["id"] for t in service.list_tracks(catalog) if t["title"] == "X")
    m = catalog.uploads_by_sc_track_id()
    assert tid in m and m[tid]["title"] == "X"


def test_update_track_sets_downloadable(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    catalog = service.Catalog(tmp_path / "u.db")
    _connect_mock(catalog)
    f = tmp_path / "D.wav"; make_wav(f, value=1)
    service.run_upload(catalog, [{"path": str(f), "name": "D"}], {"sharing": "public"})
    tid = next(t["id"] for t in service.list_tracks(catalog) if t["title"] == "D")
    service.update_track(catalog, tid, {"downloadable": True})
    t = next(t for t in service.list_tracks(catalog) if t["id"] == tid)
    assert t["downloadable"] is True
