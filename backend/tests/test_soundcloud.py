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
