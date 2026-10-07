"""The Uploader's core promise: the same mix is never posted to SoundCloud twice,
even when two posting runs overlap (the automatic folder check firing while you press
Post, a double press, or two windows)."""
import threading

from lazyupload import service
from tests.test_service import _connect_mock


def _uploaded_rows(catalog):
    return [r for r in catalog.recent_uploads(limit=100) if r["status"] == "uploaded"]


def _sc_track_count(catalog):
    return len(service.client_for(catalog).list_tracks())


def test_two_overlapping_runs_post_each_mix_once(catalog, mixes_dir):
    _connect_mock(catalog)
    mixes = service.scan_mixes(catalog, [mixes_dir])
    assert len(mixes) == 3
    before = _sc_track_count(catalog)  # the demo account starts with a few tracks
    start = threading.Barrier(2)

    def run():
        start.wait()
        service.run_upload(catalog, mixes, {"sharing": "private"})

    threads = [threading.Thread(target=run) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    assert len(_uploaded_rows(catalog)) == 3
    assert _sc_track_count(catalog) == before + 3


def test_same_mix_listed_twice_in_one_run_posts_once(catalog, mixes_dir):
    _connect_mock(catalog)
    mixes = service.scan_mixes(catalog, [mixes_dir])
    before = _sc_track_count(catalog)
    summary = service.run_upload(catalog, mixes[:1] + mixes[:1], {"sharing": "private"})
    assert summary["ok_count"] == 1 and summary["skipped_count"] == 1
    assert _sc_track_count(catalog) == before + 1


def test_run_started_before_another_finished_skips_what_it_posted(catalog, mixes_dir):
    """A run that read the 'already posted' list before the other run recorded its
    posts must still skip them: the check happens right before each send."""
    _connect_mock(catalog)
    mixes = service.scan_mixes(catalog, [mixes_dir])
    real = service.Catalog.uploaded_hashes
    snapshot = real(catalog)  # stale: taken before anything was posted
    before = _sc_track_count(catalog)
    service.run_upload(catalog, mixes, {"sharing": "private"})
    service.Catalog.uploaded_hashes = lambda self: dict(snapshot)
    try:
        summary = service.run_upload(catalog, mixes, {"sharing": "private"})
    finally:
        service.Catalog.uploaded_hashes = real
    assert summary["ok_count"] == 0 and summary["skipped_count"] == 3
    assert _sc_track_count(catalog) == before + 3


def _auto_run(catalog, folder, monkeypatch):
    from lazyupload import scheduler as sched_mod
    catalog.set_setting("config", {"sources": [str(folder)], "min_length_seconds": 0})
    monkeypatch.setattr(sched_mod.entitlement, "allows", lambda tier, f: True)
    posted = []
    monkeypatch.setattr(sched_mod, "run_upload",
                        lambda cat, items, **kw: posted.extend(m["path"] for m in items))
    sched_mod.UploadScheduler(catalog)._run_once()
    return posted


def test_automatic_posting_sends_one_format_per_song(catalog, tmp_path, monkeypatch):
    """Robert's report: a song exported as WAV and MP3 went up twice on its own."""
    from tests.helpers import make_wav
    wav = make_wav(tmp_path / "Night Drive.wav", value=1)
    (tmp_path / "Night Drive.mp3").write_bytes(b"ID3" + b"\x00" * 4000)
    assert _auto_run(catalog, tmp_path, monkeypatch) == [str(wav)]


def test_automatic_posting_skips_a_song_already_posted_in_another_format(catalog, tmp_path,
                                                                          monkeypatch):
    from tests.helpers import make_wav
    _connect_mock(catalog)
    mp3 = tmp_path / "Night Drive.mp3"
    mp3.write_bytes(b"ID3" + b"\x00" * 4000)
    service.run_upload(catalog, service.scan_mixes(catalog, [tmp_path]), {"sharing": "private"})
    make_wav(tmp_path / "Night Drive.wav", value=1)  # a better export of it turns up later
    assert _auto_run(catalog, tmp_path, monkeypatch) == []
