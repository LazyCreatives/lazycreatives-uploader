"""LazyCreatives token broker — keeps the SoundCloud client_secret off user machines.

SoundCloud requires the client secret for the authorization-code exchange AND for
refreshing tokens, even with PKCE. In a desktop app that means the secret would ship
inside the binary and be extractable. This tiny service holds the secret instead:

  desktop  --(code + PKCE verifier)-->  broker  --(+secret)-->  SoundCloud
  desktop  <--------(access + refresh tokens)-------  broker

The desktop never sees the secret; it only ever holds the user's own tokens. The
SoundCloud access token is used directly by the desktop for API calls — only the
token *minting* (exchange/refresh) is brokered.

Env:
  SC_CLIENT_ID, SC_CLIENT_SECRET  — your SoundCloud app credentials (server-side only)
  BROKER_APP_KEY                  — shared key the desktop must send as X-App-Key
  BROKER_PER_IP_PER_MIN           — token requests one address may make a minute (default 20)
  BROKER_TOTAL_PER_MIN            — token requests for everyone together a minute (default 300)

Every request is logged as one line (path, status, time taken and a short hash of the
caller's address); codes, tokens and the secret are never logged.

Run:  uvicorn broker.app:app --host 0.0.0.0 --port 8080
Deploy anywhere that runs a FastAPI/uvicorn app (Fly.io, Render, Railway, a VPS …).
"""
import hashlib
import logging
import os
import threading
import time
from collections import deque

import requests
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

SC_TOKEN_URL = "https://secure.soundcloud.com/oauth/token"
_TOKEN_FIELDS = ("access_token", "refresh_token", "expires_in", "scope", "token_type")


class ExchangeRequest(BaseModel):
    code: str = Field(..., max_length=4096)
    code_verifier: str = Field(..., max_length=256)
    redirect_uri: str = Field(..., max_length=512)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., max_length=4096)


log = logging.getLogger("lazyupload.broker")
_LIMITED_PATHS = ("/exchange", "/refresh")
_WINDOW = 60.0


class RateLimiter:
    """Sliding one-minute window, per caller address and for everyone together.

    A normal user signs in once and refreshes about once an hour, so the limits only
    bite on scripted abuse. In memory: the free host runs a single process, and a
    restart simply starts the count again."""

    def __init__(self, per_ip: int, total: int, clock=time.monotonic):
        self.per_ip, self.total, self.clock = per_ip, total, clock
        self._hits: dict[str, deque] = {}
        self._all: deque = deque()
        self._lock = threading.Lock()

    @staticmethod
    def _trim(q: deque, now: float) -> None:
        while q and now - q[0] >= _WINDOW:
            q.popleft()

    def check(self, key: str) -> float:
        """Count one request; return 0 if allowed, else seconds until it would be."""
        with self._lock:
            now = self.clock()
            self._trim(self._all, now)
            q = self._hits.setdefault(key, deque())
            self._trim(q, now)
            if len(q) >= self.per_ip:
                return _WINDOW - (now - q[0])
            if len(self._all) >= self.total:
                return _WINDOW - (now - self._all[0])
            q.append(now)
            self._all.append(now)
            if len(self._hits) > 10_000:  # forget idle addresses so memory stays small
                for k in [k for k, v in self._hits.items() if not v]:
                    del self._hits[k]
            return 0.0


def _caller(request: Request) -> str:
    # Behind the host's proxy the caller is the first X-Forwarded-For entry. It can be
    # faked, which only dodges the per-address limit; the overall limit still holds.
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "?")


def _short_hash(addr: str) -> str:
    return hashlib.sha256(addr.encode()).hexdigest()[:10]


def create_app() -> FastAPI:
    app = FastAPI(title="lazyupload-broker")
    client_id = os.environ.get("SC_CLIENT_ID", "")
    client_secret = os.environ.get("SC_CLIENT_SECRET", "")
    app_key = os.environ.get("BROKER_APP_KEY", "")
    limiter = RateLimiter(int(os.environ.get("BROKER_PER_IP_PER_MIN", "20")),
                          int(os.environ.get("BROKER_TOTAL_PER_MIN", "300")))

    @app.middleware("http")
    async def limit_and_log(request: Request, call_next):
        start = time.monotonic()
        who = _caller(request)
        wait = limiter.check(who) if request.url.path in _LIMITED_PATHS else 0.0
        if wait:
            response = JSONResponse({"detail": "too many requests, try again shortly"},
                                    status_code=429,
                                    headers={"Retry-After": str(max(1, int(wait + 0.999)))})
        else:
            response = await call_next(request)
        log.info("%s %s %d %dms caller=%s", request.method, request.url.path,
                 response.status_code, (time.monotonic() - start) * 1000, _short_hash(who))
        return response

    def _check_key(provided: str) -> None:
        # A shared key keeps the public broker URL from being trivially abused. It's
        # not a true secret (it ships in the desktop), but combined with the need for
        # a valid SoundCloud code/refresh-token it makes the endpoint uninteresting.
        if app_key and provided != app_key:
            raise HTTPException(status_code=401, detail="bad app key")

    def _oauth_error(r) -> str:
        try:
            return str((r.json() or {}).get("error") or "")
        except Exception:
            return ""

    def _mint(payload: dict) -> dict:
        if not (client_id and client_secret):
            raise HTTPException(status_code=503, detail="broker not configured")
        body = {**payload, "client_id": client_id, "client_secret": client_secret}
        try:
            r = requests.post(SC_TOKEN_URL, data=body, timeout=20,
                              headers={"Accept": "application/json"})
        except requests.RequestException:
            raise HTTPException(status_code=502, detail="could not reach SoundCloud")
        if r.status_code == 401:
            raise HTTPException(status_code=401, detail="SoundCloud rejected the request")
        if r.status_code == 400 and _oauth_error(r) == "invalid_grant":
            # The refresh token (or code) is expired, revoked or already used: the app
            # must ask the person to sign in again, not report a SoundCloud outage.
            raise HTTPException(status_code=401, detail="sign-in expired")
        if r.status_code == 429:
            raise HTTPException(status_code=429, detail="SoundCloud asked us to wait",
                                headers={"Retry-After": r.headers.get("Retry-After", "60")})
        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail="SoundCloud token request failed")
        data = r.json()
        return {k: data[k] for k in _TOKEN_FIELDS if k in data}  # never echo the secret

    @app.get("/health")
    def health():
        return {"status": "ok", "configured": bool(client_id and client_secret)}

    @app.post("/exchange")
    def exchange(req: ExchangeRequest, x_app_key: str = Header(default="")):
        _check_key(x_app_key)
        return _mint({"grant_type": "authorization_code", "redirect_uri": req.redirect_uri,
                      "code_verifier": req.code_verifier, "code": req.code})

    @app.post("/refresh")
    def refresh(req: RefreshRequest, x_app_key: str = Header(default="")):
        _check_key(x_app_key)
        return _mint({"grant_type": "refresh_token", "refresh_token": req.refresh_token})

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
app = create_app()
