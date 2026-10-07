"""One song, many files: formats are grouped into one row, versions are told apart by
length, and a song already on SoundCloud (in any format or version, posted from here
or elsewhere) is never posted again without the producer saying so."""
from lazyupload import service, songs
from lazyupload.connect import SoundCloudConnectSession
from tests.helpers import make_wav


def _mix(name, ext, dur, size=100, **kw):
    return {"path": f"/m/{name}{ext}", "name": name, "ext": ext, "duration": dur,
            "size": size, "mtime": 1.0, **kw}


def _connect(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


def _catalog(tmp_path, monkeypatch):
    monkeypatch.delenv("LAZYUP_BACKUPS_DB", raising=False)
    cat = service.Catalog(tmp_path / "u.db")
    cat.set_setting("config", {"min_length_seconds": 0})  # test files are a second long
    _connect(cat)
    return cat


# ---- grouping ---------------------------------------------------------------
def test_formats_with_slightly_different_names_are_one_row():
    wav = _mix("Heavy master", ".wav", 180.0, size=900)
    mp3 = _mix("Heavy", ".mp3", 180.3, size=100)
    v2 = _mix("Heavy v2", ".wav", 201.0, size=950)
    mixes = [mp3, wav, v2]
    songs.group_formats(mixes)
    assert wav["superseded_by"] is None and wav["dupe_formats"] == ["MP3"]
    assert [f["format"] for f in wav["formats"]] == ["WAV", "MP3"]
    assert mp3["superseded_by"] == "WAV" and mp3["format_of"] == wav["path"]
    # A different length is another version of the song: its own row.
    assert v2["superseded_by"] is None and "formats" not in v2
    assert wav["song"] == mp3["song"] == v2["song"] == "heavy"


def test_same_name_without_lengths_still_groups_but_two_wavs_do_not():
    a, b = _mix("HEAVY", ".aif", None, size=900), _mix("HEAVY", ".mp3", None)
    c, d = _mix("Song", ".wav", 100.0), _mix("Song final", ".wav", 100.0)
    songs.group_formats([a, b, c, d])
    assert b["superseded_by"] == "AIF"
    assert c["superseded_by"] is None and d["superseded_by"] is None


def test_regrouping_clears_old_flags():
    a, b = _mix("X", ".wav", 10.0, size=9), _mix("X", ".mp3", 10.0)
    songs.group_formats([a, b])
    songs.group_formats([b])
    assert b["superseded_by"] is None and "format_of" not in b


# ---- already on SoundCloud ----------------------------------------------------
def test_wav_exported_after_its_mp3_was_posted_is_not_new(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    d = tmp_path / "Mixes"
    mp3 = make_wav(d / "Heavy.mp3", value=1, seconds=0.5)
    service.run_upload(cat, [{"path": str(mp3), "name": "Heavy"}], {"sharing": "public"})
    make_wav(d / "Heavy master.wav", value=2, seconds=0.6, rate=16000)

    mixes = service.scan_mixes(cat, [d])
    row = next(m for m in mixes if not m["superseded_by"])
    assert row["ext"] == ".wav" and not row["uploaded"]
    assert row["on_soundcloud"]["kind"] == "same" and row["on_soundcloud"]["format"] == "MP3"
    assert not songs.is_new(row)
    assert service.auto_post_picks(mixes) == []

    # Posting it by hand is held back, unless the producer says to post it anyway.
    res = service.run_upload(cat, [{"path": row["path"], "name": row["name"]}], {})
    assert res["skipped_count"] == 1 and res["results"][0]["error"] == "Already on SoundCloud as MP3."
    res = service.run_upload(cat, [{"path": row["path"], "name": row["name"], "allow_double": True}], {})
    assert res["ok_count"] == 1


def test_two_formats_ticked_in_one_post_only_send_one(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    wav = make_wav(tmp_path / "Glow.wav", value=1, seconds=0.5)
    mp3 = make_wav(tmp_path / "Glow.mp3", value=2, seconds=0.5)
    res = service.run_upload(cat, [{"path": str(wav), "name": "Glow"},
                                   {"path": str(mp3), "name": "Glow"}], {})
    assert res["ok_count"] == 1 and res["skipped_count"] == 1


def test_new_version_of_a_posted_song_is_named_and_held(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    d = tmp_path / "Mixes"
    v1 = make_wav(d / "Tide.wav", value=1, seconds=1.0)
    service.run_upload(cat, [{"path": str(v1), "name": "Tide"}], {})
    make_wav(d / "Tide v2.wav", value=2, seconds=4.0)
    mixes = service.scan_mixes(cat, [d])
    v2 = next(m for m in mixes if m["name"] == "Tide v2")
    assert v2["on_soundcloud"]["kind"] == "version"
    res = service.run_upload(cat, [{"path": v2["path"], "name": "Tide v2"}], {})
    assert res["skipped_count"] == 1
    assert res["results"][0]["error"] == "Another version of this song is already on SoundCloud."


def test_song_posted_on_the_website_is_known(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    # The demo account already holds "Rainy Day Beat" (2:22), posted outside the app.
    service.list_tracks(cat)
    d = tmp_path / "Mixes"
    make_wav(d / "Rainy Day Beat_final.wav", value=1, seconds=0.5)
    row = service.scan_mixes(cat, [d])[0]
    assert row["on_soundcloud"]["kind"] == "version"  # lengths differ: another version
    assert row["on_soundcloud"]["title"] == "Rainy Day Beat"


def test_a_double_removed_on_soundcloud_no_longer_counts(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    mp3 = make_wav(tmp_path / "Mixes" / "Gone.mp3", value=1, seconds=0.5)
    tid = service.run_upload(cat, [{"path": str(mp3), "name": "Gone"}], {})["results"][0]["sc_track_id"]
    service.list_tracks(cat)
    service.client_for(cat).delete_track(tid)
    service.list_tracks(cat)  # the account no longer has it
    make_wav(tmp_path / "Mixes2" / "Gone.wav", value=2, seconds=0.5)
    row = service.scan_mixes(cat, [tmp_path / "Mixes2"])[0]
    assert row["on_soundcloud"] is None and songs.is_new(row)


def test_auto_posting_picks_the_newest_version_once():
    a = _mix("Dawn", ".wav", 100.0, mtime=1.0)
    b = _mix("Dawn v2", ".wav", 130.0)
    b["mtime"] = 5.0
    mixes = [a, b]
    songs.group_formats(mixes)
    for m in mixes:
        m.update(uploaded=False, short=False, on_soundcloud=None)
    assert service.auto_post_picks(mixes) == [b]


def test_song_key_takes_render_words_off():
    names = ["Heavy", "Heavy (Master)", "Heavy [Final Mix]", "heavy_final_v2", "Heavy - Master",
             "2026-10-01 Heavy 128bpm", "Heavy (mixdown 3)"]
    assert {songs.song_key(n) for n in names} == {"heavy"}
    assert songs.song_key("Heavy (VIP)") != "heavy" and songs.song_key("Heavy Remix") != "heavy"


# ---- Your tracks ----------------------------------------------------------------
def test_your_tracks_doubles_match_loose_titles_and_keep_the_played_copy():
    tracks = [
        {"id": 1, "title": "Heavy", "duration": 180, "playback_count": 300, "original_format": "mp3"},
        {"id": 2, "title": "Heavy (Master)", "duration": 181, "playback_count": 2, "original_format": "wav"},
        {"id": 3, "title": "Heavy v2", "duration": 210, "playback_count": 0, "original_format": "wav"},
        {"id": 4, "title": "Other", "duration": 180},
    ]
    service._mark_track_dupes(tracks)
    one, two, three, other = tracks
    assert one["dupe_keeper"] is True and two["dupe_keeper"] is False
    assert one["dupe_group"] == two["dupe_group"] == 1 and one["dupe_count"] == 2
    assert "dupe_group" not in three and three["version_count"] == 2
    assert "dupe_group" not in other and "version_count" not in other


def test_a_post_made_after_the_account_was_last_read_still_counts(tmp_path, monkeypatch):
    cat = _catalog(tmp_path, monkeypatch)
    service.list_tracks(cat)  # the account's tracks, read before the post
    mp3 = make_wav(tmp_path / "Mixes" / "Late.mp3", value=1, seconds=0.5)
    service.run_upload(cat, [{"path": str(mp3), "name": "Late"}], {})
    make_wav(tmp_path / "Mixes2" / "Late.wav", value=2, seconds=0.5)
    row = service.scan_mixes(cat, [tmp_path / "Mixes2"])[0]
    assert row["on_soundcloud"]["kind"] == "same"
