"""The desktop side of the token broker: exchange/refresh go to the broker (which
holds the secret) instead of SoundCloud, and no client secret is sent."""
import responses

from lazyupload import soundcloud


def test_mode_detection(monkeypatch):
    monkeypatch.delenv("LAZYUP_MOCK", raising=False)
    monkeypatch.delenv("LAZYUP_SC_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("LAZYUP_BROKER_URL", raising=False)
    monkeypatch.setenv("LAZYUP_SC_CLIENT_ID", "cid")
    # client id alone isn't enough -> still mock
    assert soundcloud.credentials_configured() is False
    assert soundcloud.use_mock() is True
    # add a broker -> configured, broker mode, not mock
    monkeypatch.setenv("LAZYUP_BROKER_URL", "https://broker.example")
    assert soundcloud.credentials_configured() is True
    assert soundcloud.use_mock() is False
    assert soundcloud._use_broker() is True


@responses.activate
def test_exchange_via_broker_sends_no_secret(monkeypatch):
    monkeypatch.setenv("LAZYUP_SC_CLIENT_ID", "cid")
    monkeypatch.setenv("LAZYUP_BROKER_URL", "https://broker.example")
    monkeypatch.setenv("LAZYUP_BROKER_KEY", "appkey")
    responses.add(responses.POST, "https://broker.example/exchange",
                  json={"access_token": "AT", "refresh_token": "RT", "expires_in": 3600}, status=200)
    body = soundcloud.exchange_code("code", "http://127.0.0.1:8765/callback", "verifier")
    assert body["access_token"] == "AT" and body["refresh_token"] == "RT"
    assert body["expires_at"] > 0
    req = responses.calls[0].request
    assert req.headers["X-App-Key"] == "appkey"
    assert b"client_secret" not in (req.body or b"")  # broker holds the secret, not us


@responses.activate
def test_refresh_via_broker(monkeypatch):
    monkeypatch.setenv("LAZYUP_SC_CLIENT_ID", "cid")
    monkeypatch.setenv("LAZYUP_BROKER_URL", "https://broker.example")
    responses.add(responses.POST, "https://broker.example/refresh",
                  json={"access_token": "AT2", "refresh_token": "RT2", "expires_in": 3600}, status=200)
    body = soundcloud.refresh_tokens("old-refresh")
    assert body["access_token"] == "AT2" and body["refresh_token"] == "RT2"
