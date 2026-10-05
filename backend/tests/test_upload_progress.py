"""Per-mix progress: every track event names the file it is about, and a failed mix
carries a short plain-English reason the Upload page can show (and retry from)."""
from pathlib import Path

import requests

from lazyupload import service, soundcloud
from lazyupload.connect import SoundCloudConnectSession


def _connect_mock(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


def _run(catalog, items):
    events: list[dict] = []
    summary = service.run_upload(catalog, items, {"sharing": "public"}, progress=events.append)
    return summary, events


def test_track_events_carry_the_file_path(catalog, mixes_dir):
    _connect_mock(catalog)
    mixes = service.scan_mixes(catalog, [mixes_dir])
    _, events = _run(catalog, mixes)
    track_events = [e for e in events if e["type"].startswith("track_")]
    assert {e["type"] for e in track_events} >= {"track_start", "track_progress", "track_done"}
    paths = {m["path"] for m in mixes}
    for e in track_events:
        assert e["path"] in paths
    # progress ticks for each mix name its own file
    for m in mixes:
        ticks = [e for e in events if e["type"] == "track_progress" and e["path"] == m["path"]]
        assert ticks and ticks[-1]["sent"] == ticks[-1]["size"]


def test_skipped_mix_names_its_path(catalog, mixes_dir):
    _connect_mock(catalog)
    mixes = service.scan_mixes(catalog, [mixes_dir])
    _run(catalog, mixes[:1])
    _, events = _run(catalog, service.scan_mixes(catalog, [mixes_dir])[:1])
    skipped = [e for e in events if e["type"] == "track_skipped"]
    assert len(skipped) == 1
    assert skipped[0]["path"] == mixes[0]["path"] and skipped[0]["reason"] == "duplicate"


def test_failed_mix_reports_path_and_short_reason_and_batch_continues(catalog, mixes_dir):
    _connect_mock(catalog)
    mixes = service.scan_mixes(catalog, [mixes_dir])
    gone = mixes[0]
    Path(gone["path"]).unlink()  # moved away after the scan
    summary, events = _run(catalog, mixes)
    assert summary["error_count"] == 1 and summary["ok_count"] == len(mixes) - 1
    err = [e for e in events if e["type"] == "track_error"]
    assert len(err) == 1
    assert err[0]["path"] == gone["path"]
    assert err[0]["reason"] == "The file was moved or deleted."
    assert err[0]["error"]  # the full message is still there for History


def test_retrying_just_the_failed_mix_posts_it(catalog, mixes_dir):
    """Try again re-posts one path through the same upload call."""
    _connect_mock(catalog)
    mixes = service.scan_mixes(catalog, [mixes_dir])
    target = mixes[1]
    data = Path(target["path"]).read_bytes()
    Path(target["path"]).unlink()
    first, _ = _run(catalog, mixes)
    assert first["error_count"] == 1
    Path(target["path"]).write_bytes(data)  # the file is back
    again, events = _run(catalog, [target])
    assert again["ok_count"] == 1 and again["error_count"] == 0
    done = [e for e in events if e["type"] == "track_done"]
    assert done[0]["path"] == target["path"] and done[0]["permalink_url"]


class _Resp:
    def __init__(self, code):
        self.status_code = code


def test_short_reason_is_plain_english():
    r = service.short_reason
    assert r(FileNotFoundError("x")) == "The file was moved or deleted."
    assert r(PermissionError("x")) == "Couldn't open the file."
    assert r(soundcloud.RateLimitError("30")).startswith("SoundCloud is busy")
    assert r(soundcloud.AuthError()) == "SoundCloud needs you to reconnect."
    assert r(requests.ConnectionError("boom")) == "Couldn't reach SoundCloud. Check your internet."
    assert r(requests.HTTPError("413", response=_Resp(413))) == "The file is too big for SoundCloud."
    assert r(requests.HTTPError("502", response=_Resp(502))) == "SoundCloud had a problem. Try again soon."
    assert r(requests.HTTPError("422", response=_Resp(422))) == "SoundCloud turned it down."
    assert r(RuntimeError("Image file not found.")) == "Image file not found."
    assert r(RuntimeError("x" * 200)) == "Something went wrong."
    assert r(ValueError("Traceback: internal thing")) == "Something went wrong."
