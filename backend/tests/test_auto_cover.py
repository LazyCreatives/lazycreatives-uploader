"""Automatic posts get a waveform cover only when the producer ticked it in Settings."""
from lazyupload import service
from lazyupload.connect import SoundCloudConnectSession
from tests.helpers import make_wav


def _catalog(tmp_path, monkeypatch, **cfg):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    cat = service.Catalog(tmp_path / "u.db")
    cat.set_setting("config", {"min_length_seconds": 0, **cfg})
    SoundCloudConnectSession(lambda t: service.save_account(cat, t)).start()
    return cat


def _posted(cat, name):
    return next(t for t in service.list_tracks(cat) if t["title"] == name)


def test_off_by_default(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    assert service.auto_cover_on(cat) is False
    wav = make_wav(tmp_path / "Mixes" / "Heavy.wav", value=1, seconds=1.0)
    service.run_upload(cat, [{"path": str(wav), "name": "Heavy"}], {"sharing": "private"})
    assert not _posted(cat, "Heavy")["artwork_url"]


def test_ticked_gives_an_automatic_post_a_cover(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch, auto_cover=True)
    wav = make_wav(tmp_path / "Mixes" / "Heavy.wav", value=1, seconds=1.0)
    service.run_upload(cat, [{"path": str(wav), "name": "Heavy", "auto_cover": True}],
                       {"sharing": "private"})
    assert _posted(cat, "Heavy")["artwork_url"]
    assert wav.read_bytes()  # the song itself is only read


def test_a_cover_the_producer_picked_wins(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch, auto_cover=True)
    wav = make_wav(tmp_path / "Mixes" / "Heavy.wav", value=1, seconds=1.0)
    called = []
    monkeypatch.setattr(service, "auto_cover_file", lambda *a: called.append(a))
    pic = tmp_path / "pic.png"
    from PIL import Image
    Image.new("RGB", (8, 8)).save(pic)
    service.run_upload(cat, [{"path": str(wav), "name": "Heavy", "auto_cover": True,
                              "artwork_path": str(pic)}], {"sharing": "private"})
    assert called == []
