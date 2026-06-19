"""Manage-side de-dupe: the same release uploaded as FLAC + MP3 shows up as two tracks
on SoundCloud — list_tracks groups them and marks the lossless one as the keeper."""
from lazyupload import service
from lazyupload.connect import SoundCloudConnectSession
from tests.helpers import make_wav


def _connect_mock(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


def test_format_duplicates_are_grouped_lossless_wins(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    catalog = service.Catalog(tmp_path / "u.db")
    _connect_mock(catalog)
    flac = make_wav(tmp_path / "Song.flac", value=1, seconds=0.2)
    mp3 = make_wav(tmp_path / "Song.mp3", value=2, seconds=0.1)
    service.run_upload(catalog, [{"path": str(flac), "name": "Song"}], {"sharing": "public"})
    service.run_upload(catalog, [{"path": str(mp3), "name": "Song"}], {"sharing": "public"})

    dupes = [t for t in service.list_tracks(catalog) if t["title"] == "Song"]
    assert len(dupes) == 2
    by_fmt = {t["original_format"]: t for t in dupes}
    assert by_fmt["flac"]["dupe_keeper"] is True
    assert by_fmt["mp3"]["dupe_keeper"] is False
    assert by_fmt["mp3"]["dupe_group"] == by_fmt["flac"]["id"]
    assert by_fmt["flac"]["dupe_count"] == 2 and by_fmt["mp3"]["dupe_count"] == 2


def test_wip_tag_does_not_split_a_duplicate_group(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    catalog = service.Catalog(tmp_path / "u.db")
    _connect_mock(catalog)
    a = make_wav(tmp_path / "Beat.flac", value=1, seconds=0.2)
    b = make_wav(tmp_path / "Beat.mp3", value=2, seconds=0.1)
    service.run_upload(catalog, [{"path": str(a), "name": "Beat", "title": "Beat [WIP]"}], {"sharing": "public"})
    service.run_upload(catalog, [{"path": str(b), "name": "Beat", "title": "Beat"}], {"sharing": "public"})
    dupes = [t for t in service.list_tracks(catalog) if t["title"].startswith("Beat")]
    assert len(dupes) == 2 and all(t.get("dupe_count") == 2 for t in dupes)


def test_unique_titles_carry_no_dupe_flags(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    catalog = service.Catalog(tmp_path / "u.db")
    _connect_mock(catalog)
    f = make_wav(tmp_path / "Solo.wav", value=3)
    service.run_upload(catalog, [{"path": str(f), "name": "Solo"}], {"sharing": "public"})
    t = next(t for t in service.list_tracks(catalog) if t["title"] == "Solo")
    assert "dupe_group" not in t
