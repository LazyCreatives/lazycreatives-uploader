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

Run:  uvicorn broker.app:app --host 0.0.0.0 --port 8080
Deploy anywhere that runs a FastAPI/uvicorn app (Fly.io, Render, Railway, a VPS …).
"""
import os

import requests
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

SC_TOKEN_URL = "https://secure.soundcloud.com/oauth/token"
_TOKEN_FIELDS = ("access_token", "refresh_token", "expires_in", "scope", "token_type")


class ExchangeRequest(BaseModel):
    code: str = Field(..., max_length=4096)
    code_verifier: str = Field(..., max_length=256)
    redirect_uri: str = Field(..., max_length=512)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., max_length=4096)


def create_app() -> FastAPI:
    app = FastAPI(title="lazyupload-broker")
    client_id = os.environ.get("SC_CLIENT_ID", "")
    client_secret = os.environ.get("SC_CLIENT_SECRET", "")
    app_key = os.environ.get("BROKER_APP_KEY", "")

    def _check_key(provided: str) -> None:
        # A shared key keeps the public broker URL from being trivially abused. It's
        # not a true secret (it ships in the desktop), but combined with the need for
        # a valid SoundCloud code/refresh-token it makes the endpoint uninteresting.
        if app_key and provided != app_key:
            raise HTTPException(status_code=401, detail="bad app key")

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


app = create_app()
