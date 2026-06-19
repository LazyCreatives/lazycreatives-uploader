"""Browser sign-in for a SoundCloud account (OAuth2 Authorization Code + PKCE).

Flow (real):
  1. start() spins up a tiny localhost HTTP server on the fixed redirect port and
     returns the SoundCloud authorize URL.
  2. The renderer opens that URL in the user's browser; they approve.
  3. SoundCloud redirects to http://127.0.0.1:<port>/callback?code=...&state=...,
     which this server catches: it verifies `state`, exchanges the code for tokens,
     fetches the username, and hands the tokens to `on_connected`.

Flow (mock, no creds): start() connects instantly with a demo account so the UI is
fully exercisable offline — no browser required.

Modelled on Backups' CloudConnectSession (same status machine + single-flight).
"""
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Callable, Optional
from urllib.parse import parse_qs, urlparse

from lazyupload import soundcloud

_SESSION_TIMEOUT = 300  # auto-give-up after 5 min so a stale server can't linger

_DONE_HTML = (
    "<!doctype html><meta charset=utf-8><title>Connected</title>"
    "<body style='font-family:system-ui;background:#0A0B0D;color:#F3F4F6;"
    "display:grid;place-items:center;height:100vh;margin:0'>"
    "<div style='text-align:center'>"
    "<div style='font-size:42px'>✔️</div>"
    "<h2 style='color:#F5C451'>SoundCloud connected</h2>"
    "<p style='color:#9AA1AB'>You can close this tab and return to LazyCreatives Uploader.</p>"
    "</div></body>"
)


def _redirect_uri() -> str:
    port = os.environ.get("LAZYUP_OAUTH_PORT")
    if port:
        return f"http://127.0.0.1:{port}/callback"
    return soundcloud.DEFAULT_REDIRECT_URI


class SoundCloudConnectSession:
    def __init__(self, on_connected: Callable[[dict], None]):
        self._on_connected = on_connected
        self.status = "pending"          # pending | connected | failed
        self.auth_url: Optional[str] = None
        self.error: Optional[str] = None
        self._server: Optional[HTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self._verifier = ""
        self._state = ""

    def start(self) -> None:
        # Mock: no browser round-trip — connect immediately with a demo account.
        if soundcloud.use_mock():
            tokens = {"username": "you (demo)", "access_token": "mock",
                      "expires_at": time.time() + 10 * 365 * 86400}
            try:
                self._on_connected(tokens)
                self.status = "connected"
            except Exception as e:  # pragma: no cover - defensive
                self.status, self.error = "failed", str(e)
            return

        self._verifier, challenge = soundcloud.new_pkce()
        self._state = soundcloud.new_state()
        redirect = _redirect_uri()
        port = urlparse(redirect).port or soundcloud.DEFAULT_REDIRECT_PORT
        try:
            self._server = HTTPServer(("127.0.0.1", port), self._handler_factory())
        except OSError as e:
            self.status = "failed"
            self.error = (f"Couldn't open the sign-in port {port}. Close anything using "
                          f"it and try again. ({e})")
            return
        self.auth_url = soundcloud.authorize_url(redirect, self._state, challenge)
        self._thread = threading.Thread(target=self._serve, name="sc-oauth", daemon=True)
        self._thread.start()

    def _serve(self) -> None:
        self._server.timeout = 1
        deadline = time.time() + _SESSION_TIMEOUT
        while self.status == "pending" and time.time() < deadline:
            self._server.handle_request()  # one request per second tick
        if self.status == "pending":
            self.status = "failed"
            self.error = "Sign-in timed out — please try connecting again."
        self._close_server()

    def _handler_factory(self):
        session = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):  # silence default stderr logging
                pass

            def do_GET(self):
                parsed = urlparse(self.path)
                if not parsed.path.startswith("/callback"):
                    self.send_response(404)
                    self.end_headers()
                    return
                params = parse_qs(parsed.query)
                code = (params.get("code") or [""])[0]
                state = (params.get("state") or [""])[0]
                err = (params.get("error") or [""])[0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(_DONE_HTML.encode())
                session._complete(code, state, err)

        return Handler

    def _complete(self, code: str, state: str, err: str) -> None:
        if err:
            self.status, self.error = "failed", f"SoundCloud declined: {err}"
            return
        if not code or state != self._state:
            self.status, self.error = "failed", "Sign-in response didn't match — try again."
            return
        try:
            tokens = soundcloud.exchange_code(code, _redirect_uri(), self._verifier)
            # Enrich with the username so the UI can show whose account is connected.
            try:
                client = soundcloud.SoundCloudClient(tokens)
                me = client.me()
                tokens["username"] = me.get("username") or me.get("permalink")
                tokens["user_id"] = me.get("id")
                tokens["avatar_url"] = me.get("avatar_url")
            except Exception:
                pass  # the upload still works without the display name
            self._on_connected(tokens)
            self.status = "connected"
        except Exception as e:
            self.status, self.error = "failed", f"Couldn't complete sign-in: {e}"

    def cancel(self) -> None:
        if self.status == "pending":
            self.status = "failed"
            self.error = "Cancelled."
        self._close_server()

    def _close_server(self) -> None:
        srv, self._server = self._server, None
        if srv:
            try:
                srv.server_close()
            except Exception:
                pass

    def wait_for_url(self, timeout: float = 10) -> Optional[str]:
        """The authorize URL is built synchronously in start(); this just returns it
        (kept as a method to mirror the Backups connect API the renderer expects)."""
        return self.auth_url
