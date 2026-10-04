from pathlib import Path

from lazyupload import service
from lazyupload.connect import SoundCloudConnectSession


def _connect_mock(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


def test_scan_flags_uploaded_by_hash(catalog, mixes_dir):
    mixes = service.scan_mixes(catalog, [mixes_dir])
    assert len(mixes) == 3
    assert all(not m["uploaded"] for m in mixes)
    # Mark one as published, by its content hash, and re-scan.
    target = mixes[0]
    catalog.record_upload(title=target["name"], file_path=target["path"],
                          file_hash=target["file_hash"], size=target["size"],
                          sharing="public", status="uploaded", timestamp="t",
                          permalink_url="https://soundcloud.com/demo/x")
    again = service.scan_mixes(catalog, [mixes_dir])
    by_hash = {m["file_hash"]: m for m in again}
    assert by_hash[target["file_hash"]]["uploaded"] is True


def test_run_upload_publishes_and_dedupes(catalog, mixes_dir):
    _connect_mock(catalog)
    mixes = service.scan_mixes(catalog, [mixes_dir])
    summary = service.run_upload(catalog, mixes, {"sharing": "public"})
    assert summary["ok_count"] == 3
    assert summary["error_count"] == 0
    # Re-running with the same mixes uploads nothing new (dedupe by hash).
    mixes2 = service.scan_mixes(catalog, [mixes_dir])
    summary2 = service.run_upload(catalog, mixes2, {"sharing": "public"})
    assert summary2["ok_count"] == 0
    assert summary2["skipped_count"] == 3


def test_run_upload_requires_connection(catalog, mixes_dir):
    mixes = service.scan_mixes(catalog, [mixes_dir])
    summary = service.run_upload(catalog, mixes, {})
    assert summary["error"] == "not_connected"
    assert summary["ok_count"] == 0


def test_meta_uses_title_template(catalog):
    meta = service._meta_for({"path": "/x/Sunset Dub.wav", "name": "Sunset Dub"},
                             {"title_template": "{name} (LazyCreatives)"})
    assert meta.title == "Sunset Dub (LazyCreatives)"


def test_hash_cache_prunes_deleted_files(catalog, mixes_dir):
    service.scan_mixes(catalog, [mixes_dir])
    assert len(catalog.get_setting("hash_cache")) == 3
    next(mixes_dir.glob("*.wav")).unlink()  # remove one render
    service.scan_mixes(catalog, [mixes_dir])
    assert len(catalog.get_setting("hash_cache")) == 2  # stale entry pruned


def test_progress_events_emitted(catalog, mixes_dir):
    _connect_mock(catalog)
    mixes = service.scan_mixes(catalog, [mixes_dir])
    events = []
    service.run_upload(catalog, mixes[:1], {"sharing": "public"},
                       progress=events.append)
    types = [e["type"] for e in events]
    assert "upload_start" in types and "track_done" in types and "upload_done" in types
