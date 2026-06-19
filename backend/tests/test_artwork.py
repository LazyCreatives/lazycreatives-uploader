"""Custom cover art: on upload, single set, bulk set, and the default-art config.

The mock client returns the cover as a data: URL (renderable under the packaged CSP), so
we assert the right image was used by checking its base64 appears in artwork_url."""
import base64
from pathlib import Path

from lazyupload import service
from lazyupload.connect import SoundCloudConnectSession
from tests.helpers import make_wav


def _connect_mock(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


def _make_png(path):
    # distinct bytes per file (name-tagged) so different covers get different data URLs
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + path.name.encode() + b"-art" * 4)
    return path


def _b64(path):
    return base64.b64encode(Path(path).read_bytes()).decode()


def _make_db(tmp_path):
    return service.Catalog(tmp_path / "uploads.db")


def test_upload_with_explicit_artwork_sets_cover(tmp_path):
    catalog = _make_db(tmp_path)
    _connect_mock(catalog)
    f = make_wav(tmp_path / "Track A.wav", value=1)
    art = _make_png(tmp_path / "cover.png")
    service.run_upload(catalog, [{"path": str(f), "name": "Track A",
                                  "artwork_path": str(art)}], {"sharing": "public"})
    t = next(t for t in service.list_tracks(catalog) if t["title"] == "Track A")
    assert t["artwork_url"].startswith("data:image") and _b64(art) in t["artwork_url"]


def test_default_artwork_applies_when_item_has_none(tmp_path):
    catalog = _make_db(tmp_path)
    _connect_mock(catalog)
    art = _make_png(tmp_path / "default.png")
    catalog.set_setting("config", {"default_artwork_path": str(art)})
    f = make_wav(tmp_path / "Track B.wav", value=2)
    service.run_upload(catalog, [{"path": str(f), "name": "Track B"}], {"sharing": "public"})
    t = next(t for t in service.list_tracks(catalog) if t["title"] == "Track B")
    assert _b64(art) in (t["artwork_url"] or "")


def test_item_artwork_overrides_default(tmp_path):
    catalog = _make_db(tmp_path)
    _connect_mock(catalog)
    default_art = _make_png(tmp_path / "default.png")
    own_art = _make_png(tmp_path / "own.png")
    catalog.set_setting("config", {"default_artwork_path": str(default_art)})
    f = make_wav(tmp_path / "Track C.wav", value=3)
    service.run_upload(catalog, [{"path": str(f), "name": "Track C",
                                  "artwork_path": str(own_art)}], {"sharing": "public"})
    t = next(t for t in service.list_tracks(catalog) if t["title"] == "Track C")
    assert _b64(own_art) in t["artwork_url"] and _b64(default_art) not in t["artwork_url"]


def test_set_and_bulk_set_artwork(tmp_path):
    catalog = _make_db(tmp_path)
    _connect_mock(catalog)
    for i in (1, 2):
        f = make_wav(tmp_path / f"m{i}.wav", value=i)
        service.run_upload(catalog, [{"path": str(f), "name": f"m{i}"}], {"sharing": "public"})
    ids = [t["id"] for t in service.list_tracks(catalog) if t["title"].startswith("m")]
    art = _make_png(tmp_path / "new.png")

    # single
    updated = service.set_artwork(catalog, ids[0], str(art))
    assert _b64(art) in updated["artwork_url"]
    assert "seo" in updated  # returned track is fully enriched

    # bulk
    res = service.bulk_set_artwork(catalog, ids, str(art))
    assert all(r["ok"] for r in res) and {r["id"] for r in res} == set(ids)
    # each ok ledger item carries the enriched updated track for splicing
    assert all(_b64(art) in r["track"]["artwork_url"] for r in res if r["ok"])
    arted = {t["id"]: t for t in service.list_tracks(catalog)}
    assert all(_b64(art) in arted[i]["artwork_url"] for i in ids)
