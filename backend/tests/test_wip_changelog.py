"""WIP re-bounce changelog: when a WIP track's audio is overwritten on SoundCloud
(delete old + upload new), the app posts a timestamped changelog comment on the new
track so there's a visible history of every re-bounce."""
from lazyupload import service
from lazyupload.connect import SoundCloudConnectSession
from tests.helpers import make_wav


def _connect_mock(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


def test_changelog_comment_formats_history():
    body = service._changelog_comment(["2026-06-17 10:00:00", "2026-06-19 14:30:00"])
    assert "changelog" in body.lower()
    assert "v1 · 2026-06-17 10:00:00" in body
    assert "v2 · 2026-06-19 14:30:00" in body
    assert "← current" in body


def test_changelog_comment_caps_and_counts_earlier_versions():
    history = [f"2026-01-{i:02d} 00:00:00" for i in range(1, 21)]  # 20 versions
    body = service._changelog_comment(history)
    assert "(+8 earlier versions)" in body  # 20 - 12 shown
    assert "v20" in body and "v9" in body   # last 12 shown → v9..v20
    assert "v8 " not in body


def test_wip_rebounce_posts_changelog_comment(catalog, tmp_path):
    _connect_mock(catalog)
    d = tmp_path / "wip"
    f = d / "Loop Idea.wav"
    make_wav(f, value=1)
    service.set_wip(catalog, "Loop Idea", True)

    # First bounce: publishes v1. Nothing is overwritten yet, so no comment.
    service.process_wip(catalog, [d])
    store = service._MockStore(catalog)
    assert all(not t.get("comments") for t in store.load())

    # Overwrite the file with new content → its hash changes → replace + changelog.
    make_wav(f, value=2)
    service.process_wip(catalog, [d])

    commented = [t for t in store.load() if t.get("comments")]
    assert len(commented) == 1, "exactly the surviving (new) track gets a changelog comment"
    body = commented[0]["comments"][0]["body"]
    assert "changelog" in body.lower()
    assert "v2" in body and "← current" in body


def test_wip_rebounce_changelog_can_be_disabled(catalog, tmp_path):
    _connect_mock(catalog)
    catalog.set_setting("config", {"changelog_comments": False})
    d = tmp_path / "wip"
    f = d / "Night Drive.wav"
    make_wav(f, value=1)
    service.set_wip(catalog, "Night Drive", True)
    service.process_wip(catalog, [d])
    make_wav(f, value=2)
    service.process_wip(catalog, [d])
    assert all(not t.get("comments") for t in service._MockStore(catalog).load())
