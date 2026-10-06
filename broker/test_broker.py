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


def test_rate_limit_per_address(monkeypatch):
    monkeypatch.setenv("BROKER_PER_IP_PER_MIN", "2")
    c = _client(monkeypatch)
    hdr = {"X-App-Key": "wrong", "X-Forwarded-For": "1.2.3.4"}
    body = {"refresh_token": "x"}
    assert c.post("/refresh", headers=hdr, json=body).status_code == 401
    assert c.post("/refresh", headers=hdr, json=body).status_code == 401
    r = c.post("/refresh", headers=hdr, json=body)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1
    # another address is unaffected, and health checks are never limited
    other = {"X-App-Key": "wrong", "X-Forwarded-For": "5.6.7.8"}
    assert c.post("/refresh", headers=other, json=body).status_code == 401
    assert c.get("/health", headers=hdr).status_code == 200


def test_rate_limit_total_and_window():
    from app import RateLimiter
    now = [0.0]
    rl = RateLimiter(per_ip=10, total=3, clock=lambda: now[0])
    assert [rl.check(ip) for ip in ("a", "b", "c")] == [0.0, 0.0, 0.0]
    assert rl.check("d") > 0          # everyone together is capped
    now[0] = 61.0
    assert rl.check("d") == 0.0       # the window moves on


@responses.activate
def test_requests_logged_without_secrets(monkeypatch, caplog):
    import logging
    c = _client(monkeypatch)
    responses.add(responses.POST, SC_TOKEN_URL, json={"access_token": "AT"}, status=200)
    with caplog.at_level(logging.INFO, logger="lazyupload.broker"):
        c.post("/refresh", headers={"X-App-Key": "appkey", "X-Forwarded-For": "9.9.9.9"},
               json={"refresh_token": "SECRET-RT"})
    line = caplog.text
    assert "POST /refresh 200" in line and "caller=" in line
    assert "SECRET-RT" not in line and "9.9.9.9" not in line
