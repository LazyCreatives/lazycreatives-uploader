"""Generated waveform cover art."""
from PIL import Image

from lazyupload import coverart, service
from lazyupload.connect import SoundCloudConnectSession
from tests.helpers import make_wav


def _connect_mock(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


def test_render_produces_square_png(tmp_path):
    out = coverart.render_waveform_cover([10, 50, 90, 30, 70] * 40, "BigHeck",
                                         "My Track [WIP]", str(tmp_path / "c.png"))
    im = Image.open(out)
    assert im.format == "PNG" and im.size == (1000, 1000)


def test_render_without_watermark(tmp_path):
    out = coverart.render_waveform_cover([1, 2, 3, 4] * 20, "X", "", str(tmp_path / "n.png"),
                                         watermark=False)
    assert Image.open(out).size == (1000, 1000)


def test_render_with_profile_picture_backdrop(tmp_path, monkeypatch):
    fake = Image.new("RGB", (300, 300), (40, 60, 90)).convert("RGBA")
    monkeypatch.setattr(coverart, "fetch_avatar_image", lambda url, timeout=15: fake)
    out = coverart.render_waveform_cover([5, 30, 60] * 30, "BIGHECK", "Track",
                                         str(tmp_path / "a.png"), avatar_url="https://x/av-large.jpg")
    assert Image.open(out).size == (1000, 1000)


def test_bigger_avatar_upscales_soundcloud_url():
    assert coverart._bigger_avatar("https://i1.sndcdn.com/avatars-abc-large.jpg") \
        == "https://i1.sndcdn.com/avatars-abc-t500x500.jpg"


def test_fetch_uses_json_sibling_of_waveform_png(monkeypatch):
    seen = {}

    class _Resp:
        def raise_for_status(self): pass
        def json(self): return {"samples": [1, 2, 3]}

    monkeypatch.setattr(coverart.requests, "get",
                        lambda url, timeout=15: (seen.__setitem__("url", url), _Resp())[1])
    out = coverart.fetch_waveform_samples("https://wave.sndcdn.com/abc.png")
    assert seen["url"] == "https://wave.sndcdn.com/abc.json"
    assert out == [1, 2, 3]


def test_fetch_returns_none_without_url():
    assert coverart.fetch_waveform_samples("") is None
    assert coverart.fetch_waveform_samples(None) is None


def test_generate_waveform_cover_sets_artwork(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    monkeypatch.setattr(service.coverart, "fetch_waveform_samples",
                        lambda url, timeout=15: [10, 40, 80, 20] * 30)
    monkeypatch.setattr(service.coverart, "fetch_avatar_image", lambda url, timeout=15: None)
    catalog = service.Catalog(tmp_path / "u.db")
    _connect_mock(catalog)
    f = make_wav(tmp_path / "Wavy.wav", value=1)
    service.run_upload(catalog, [{"path": str(f), "name": "Wavy"}], {"sharing": "public"})
    tid = next(t["id"] for t in service.list_tracks(catalog) if t["title"] == "Wavy")

    updated = service.generate_waveform_cover(catalog, tid)
    assert updated["artwork_url"]            # cover was set
    assert "seo" in updated                  # returned track is fully enriched


def test_bulk_waveform_covers_report_per_item(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    monkeypatch.setattr(service.coverart, "fetch_waveform_samples",
                        lambda url, timeout=15: [5, 30, 60] * 30)
    monkeypatch.setattr(service.coverart, "fetch_avatar_image", lambda url, timeout=15: None)
    catalog = service.Catalog(tmp_path / "u.db")
    _connect_mock(catalog)
    for i in (1, 2):
        f = make_wav(tmp_path / f"w{i}.wav", value=i)
        service.run_upload(catalog, [{"path": str(f), "name": f"w{i}"}], {"sharing": "public"})
    ids = [t["id"] for t in service.list_tracks(catalog) if t["title"].startswith("w")]
    res = service.bulk_generate_waveform_covers(catalog, ids)
    assert all(r["ok"] for r in res) and {r["id"] for r in res} == set(ids)


def test_prefetched_avatar_image_skips_per_render_fetch(tmp_path, monkeypatch):
    called = {"n": 0}
    def boom(url, timeout=15):
        called["n"] += 1
        return None
    monkeypatch.setattr(coverart, "fetch_avatar_image", boom)
    img = Image.new("RGB", (200, 200), (10, 20, 30)).convert("RGBA")
    out = coverart.render_waveform_cover([1, 2, 3] * 30, "X", "Y", str(tmp_path / "p.png"), avatar_img=img)
    assert Image.open(out).size == (1000, 1000) and called["n"] == 0


def _sine_wav(path, freq, sr=22050, secs=0.6):
    import numpy as np
    import soundfile as sf
    t = np.linspace(0, secs, int(sr * secs), endpoint=False)
    sf.write(str(path), (0.5 * np.sin(2 * np.pi * freq * t)).astype("float32"), sr)
    return path


def test_hex_to_rgb_parses_and_falls_back():
    assert coverart._hex_to_rgb("#FF8800") == (255, 136, 0)
    assert coverart._hex_to_rgb("#f80") == (255, 136, 0)
    assert coverart._hex_to_rgb("garbage") == coverart._ACCENT


def test_analyze_audio_brightness_tracks_frequency(tmp_path):
    import statistics
    bass = coverart.analyze_audio(str(_sine_wav(tmp_path / "bass.wav", 60)))
    treble = coverart.analyze_audio(str(_sine_wav(tmp_path / "treble.wav", 9000)))
    assert bass and treble
    assert all(0.0 <= s["amp"] <= 1.0 for s in bass)
    # a 9 kHz tone reads far brighter than a 60 Hz tone (the rekordbox-style depth)
    assert statistics.mean(s["brightness"] for s in treble) > statistics.mean(s["brightness"] for s in bass)


def test_analyze_audio_none_for_missing_or_tiny():
    assert coverart.analyze_audio("/no/such/file.wav") is None


def test_render_with_analysis_and_custom_color(tmp_path):
    analysis = [{"amp": (i % 10) / 10.0, "brightness": (i % 5) / 5.0} for i in range(440)]
    out = coverart.render_waveform_cover(None, "X", "Y", str(tmp_path / "c.png"),
                                         color="#FF0000", analysis=analysis)
    assert Image.open(out).size == (1000, 1000)


def test_generate_uses_local_audio_analysis(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    monkeypatch.setattr(service.coverart, "fetch_avatar_image", lambda url, timeout=15: None)
    # the SC waveform fallback would FAIL (no waveform_url) — success proves the local
    # audio analysis path ran instead.
    monkeypatch.setattr(service.coverart, "fetch_waveform_samples", lambda url, timeout=15: None)
    catalog = service.Catalog(tmp_path / "u.db")
    _connect_mock(catalog)
    f = _sine_wav(tmp_path / "Real.wav", 200, secs=0.5)
    service.run_upload(catalog, [{"path": str(f), "name": "Real"}], {"sharing": "public"})
    tid = next(t["id"] for t in service.list_tracks(catalog) if t["title"] == "Real")
    updated = service.generate_waveform_cover(catalog, tid)
    assert updated["artwork_url"]
