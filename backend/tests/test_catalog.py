def test_record_and_dedupe_index(catalog):
    catalog.record_upload(
        title="Sunset Dub", file_path="/x/Sunset Dub.wav", file_hash="abc",
        size=100, sharing="public", status="uploaded", timestamp="2026-06-09 10:00:00",
        sc_track_id=42, permalink_url="https://soundcloud.com/demo/sunset-dub")
    idx = catalog.uploaded_hashes()
    assert "abc" in idx
    assert idx["abc"]["permalink_url"].endswith("sunset-dub")


def test_error_upload_not_in_dedupe_index(catalog):
    catalog.record_upload(
        title="Broken", file_path="/x/Broken.wav", file_hash="zzz", size=1,
        sharing="public", status="error", timestamp="2026-06-09 10:00:00",
        error="boom")
    assert "zzz" not in catalog.uploaded_hashes()


def test_totals(catalog):
    catalog.record_upload(title="A", file_path="/a", file_hash="h1", size=10,
                          sharing="public", status="uploaded", timestamp="t")
    catalog.record_upload(title="B", file_path="/b", file_hash="h2", size=5,
                          sharing="public", status="error", timestamp="t", error="x")
    t = catalog.totals()
    assert t["uploaded_count"] == 1
    assert t["error_count"] == 1
    assert t["uploaded_bytes"] == 10


def test_settings_roundtrip(catalog):
    catalog.set_setting("config", {"sources": ["/m"]})
    assert catalog.get_setting("config") == {"sources": ["/m"]}
    catalog.delete_setting("config")
    assert catalog.get_setting("config") is None
