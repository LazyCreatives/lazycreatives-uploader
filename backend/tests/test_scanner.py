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


def test_discover_skips_recordings_inside_logic_projects(tmp_path):
    (tmp_path / "Night Drive.logicx" / "Media" / "Audio Files").mkdir(parents=True)
    (tmp_path / "Night Drive.logicx" / "Media" / "Audio Files" / "Vox#01.wav").write_bytes(b"x")
    (tmp_path / "Bounces").mkdir()
    (tmp_path / "Bounces" / "Night Drive.wav").write_bytes(b"x")
    assert [m["name"] for m in discover([tmp_path])] == ["Night Drive"]


def test_discover_skips_audio_inside_bitwig_projects(tmp_path):
    proj = tmp_path / "Night Drive"
    for sub in ("samples", "recordings", "bounce"):
        (proj / sub).mkdir(parents=True)
        (proj / sub / f"{sub}-1.wav").write_bytes(b"x")
    (proj / "Night Drive.bwproject").write_bytes(b"BtWg")
    (proj / "exported" / "2026-10-05 101500").mkdir(parents=True)
    (proj / "exported" / "2026-10-05 101500" / "Night Drive.wav").write_bytes(b"x")
    (tmp_path / "Bounce").mkdir()                       # not a Bitwig project folder
    (tmp_path / "Bounce" / "Sunday Keys.wav").write_bytes(b"x")
    assert sorted(m["name"] for m in discover([tmp_path])) == ["Night Drive", "Sunday Keys"]


def test_discover_reads_length_of_other_formats(tmp_path):
    import numpy as np
    import soundfile
    soundfile.write(str(tmp_path / "Night Drive.flac"), np.zeros(8000 * 3, dtype="int16"), 8000)
    (tmp_path / "Mystery.m4a").write_bytes(b"not really audio")
    found = {m["name"]: m["duration"] for m in discover([tmp_path])}
    assert abs(found["Night Drive"] - 3.0) < 0.01
    assert found["Mystery"] is None  # can't read it, so never counted as short
