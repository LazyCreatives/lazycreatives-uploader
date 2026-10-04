from pathlib import Path

from lazyupload.scanner import discover


def test_discover_finds_only_audio(mixes_dir):
    found = discover([mixes_dir])
    names = {m["name"] for m in found}
    assert names == {"Sunset Dub", "Midnight Drive", "Warehouse Set"}
    assert all(m["ext"] == ".wav" for m in found)


def test_discover_reads_wav_duration(mixes_dir):
    found = discover([mixes_dir])
    assert all(m["duration"] and m["duration"] > 0 for m in found)


def test_discover_ignores_missing_dir(tmp_path):
    assert discover([tmp_path / "does-not-exist"]) == []
