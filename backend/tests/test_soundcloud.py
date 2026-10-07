import base64
import hashlib

from lazyupload import soundcloud
from lazyupload.models import TrackMeta


def test_pkce_challenge_matches_verifier():
    verifier, challenge = soundcloud.new_pkce()
    expected = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert challenge == expected


def test_authorize_url_has_required_params():
    url = soundcloud.authorize_url("http://127.0.0.1:8765/callback", "st8", "chal")
    assert url.startswith("https://secure.soundcloud.com/authorize?")
    for piece in ("response_type=code", "code_challenge=chal",
                  "code_challenge_method=S256", "state=st8"):
        assert piece in url


def test_tag_list_quotes_multiword():
    assert soundcloud._tag_list(["house", "deep house"]) == 'house "deep house"'


def test_mock_client_uploads(tmp_path):
    f = tmp_path / "mix.wav"
    f.write_bytes(b"x" * 2048)
    client = soundcloud.MockSoundCloudClient()
    seen = []
    track = client.upload(str(f), TrackMeta(title="My Mix"),
                          on_progress=lambda s, t: seen.append((s, t)))
    assert track["permalink_url"].startswith("https://soundcloud.com/")
    assert seen and seen[-1][0] == seen[-1][1]  # progress reaches 100%


def test_use_mock_without_credentials():
    assert soundcloud.use_mock() is True  # no LAZYUP_SC_CLIENT_ID configured in tests


def _fake_client():
    return soundcloud.SoundCloudClient({"access_token": "t", "expires_at": 9e12})


class _Resp:
    status_code = 200
    headers: dict = {}

    def __init__(self, body):
        self._body = body

    def json(self):
        return self._body

    def raise_for_status(self):
        pass


def test_upload_reply_lost_finds_the_track_instead_of_failing(tmp_path, monkeypatch):
    """SoundCloud took the mix but the answer timed out: report the track it made, so
    nothing marks it failed and "Try again" never posts it twice."""
    import time
    import requests
    f = tmp_path / "mix.wav"
    f.write_bytes(b"x" * 2048)
    now = time.strftime("%Y/%m/%d %H:%M:%S +0000", time.gmtime())

    def post(*a, **k):
        raise requests.exceptions.ReadTimeout("no answer")

    def get(url, **k):
        return _Resp({"collection": [
            {"id": 7, "title": "Other", "created_at": now},
            {"id": 42, "title": "My Mix", "created_at": now,
             "permalink_url": "https://soundcloud.com/me/my-mix"}]})

    monkeypatch.setattr(soundcloud.requests, "post", post)
    monkeypatch.setattr(soundcloud.requests, "get", get)
    track = _fake_client().upload(str(f), TrackMeta(title="My Mix"))
    assert track["id"] == 42


def test_upload_reply_lost_and_no_track_still_fails(tmp_path, monkeypatch):
    import pytest
    import requests
    f = tmp_path / "mix.wav"
    f.write_bytes(b"x" * 2048)

    def post(*a, **k):
        raise requests.exceptions.ReadTimeout("no answer")

    old = "2020/01/01 00:00:00 +0000"  # an older upload with the same name doesn't count
    monkeypatch.setattr(soundcloud.requests, "post", post)
    monkeypatch.setattr(soundcloud.requests, "get", lambda url, **k: _Resp(
        {"collection": [{"id": 1, "title": "My Mix", "created_at": old}]}))
    with pytest.raises(requests.exceptions.ReadTimeout):
        _fake_client().upload(str(f), TrackMeta(title="My Mix"))
