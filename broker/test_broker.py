import responses
from fastapi.testclient import TestClient

from app import SC_TOKEN_URL, create_app


def _client(monkeypatch):
    monkeypatch.setenv("SC_CLIENT_ID", "cid")
    monkeypatch.setenv("SC_CLIENT_SECRET", "secret")
    monkeypatch.setenv("BROKER_APP_KEY", "appkey")
    return TestClient(create_app())


def test_health(monkeypatch):
    c = _client(monkeypatch)
    body = c.get("/health").json()
    assert body["status"] == "ok" and body["configured"] is True


@responses.activate
def test_exchange_adds_secret_and_returns_tokens(monkeypatch):
    c = _client(monkeypatch)
    responses.add(responses.POST, SC_TOKEN_URL,
                  json={"access_token": "AT", "refresh_token": "RT", "expires_in": 3600,
                        "scope": "*", "token_type": "bearer"}, status=200)
    r = c.post("/exchange", headers={"X-App-Key": "appkey"},
               json={"code": "c", "code_verifier": "v", "redirect_uri": "http://127.0.0.1:8765/callback"})
    assert r.status_code == 200
    assert r.json() == {"access_token": "AT", "refresh_token": "RT", "expires_in": 3600,
                        "scope": "*", "token_type": "bearer"}
    # the secret was added server-side and never returned
    sent = responses.calls[0].request.body
    assert "client_secret=secret" in sent and "grant_type=authorization_code" in sent


def test_exchange_rejects_bad_app_key(monkeypatch):
    c = _client(monkeypatch)
    r = c.post("/exchange", headers={"X-App-Key": "wrong"},
               json={"code": "c", "code_verifier": "v", "redirect_uri": "x"})
    assert r.status_code == 401


@responses.activate
def test_refresh(monkeypatch):
    c = _client(monkeypatch)
    responses.add(responses.POST, SC_TOKEN_URL,
                  json={"access_token": "AT2", "refresh_token": "RT2", "expires_in": 3600}, status=200)
    r = c.post("/refresh", headers={"X-App-Key": "appkey"}, json={"refresh_token": "old"})
    assert r.status_code == 200 and r.json()["access_token"] == "AT2"
    assert "grant_type=refresh_token" in responses.calls[0].request.body
