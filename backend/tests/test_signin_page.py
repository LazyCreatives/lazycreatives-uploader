import urllib.request
from http.server import HTTPServer

from lazyupload import connect, soundcloud
from lazyupload.signin_page import connected_page, failed_page


def test_pages_carry_fonts_and_escape_names():
    page = connected_page("<b>dj</b>")
    assert "SoundCloud is connected" in page
    assert "&lt;b&gt;dj&lt;/b&gt;" in page and "<b>dj</b>" not in page
    assert "font/woff2;base64," in page and "image/png;base64," in page
    bad = failed_page("You pressed Cancel on SoundCloud's page.")
    assert "SoundCloud didn't connect" in bad and "Cancel" in bad


def _hit_callback(session, query):
    """Run the real callback handler once and return the page it sends."""
    server = HTTPServer(("127.0.0.1", 0), session._handler_factory())
    port = server.server_address[1]
    import threading
    t = threading.Thread(target=server.handle_request, daemon=True)
    t.start()
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/callback?{query}") as r:
        body = r.read().decode()
    t.join(5)
    server.server_close()
    return body


def test_callback_page_says_failed_when_sign_in_is_cancelled():
    s = connect.SoundCloudConnectSession(lambda t: None)
    s._state = "abc"
    body = _hit_callback(s, "error=access_denied&state=abc")
    assert s.status == "failed"
    assert "SoundCloud didn't connect" in body and "pressed Cancel" in body
    assert "SoundCloud is connected" not in body


def test_callback_page_says_failed_when_state_does_not_match():
    s = connect.SoundCloudConnectSession(lambda t: None)
    s._state = "abc"
    body = _hit_callback(s, "code=xyz&state=other")
    assert s.status == "failed" and "match the one Uploader started" in body


def test_callback_page_names_the_account_when_connected(monkeypatch):
    saved = {}
    monkeypatch.setattr(soundcloud, "exchange_code", lambda *a: {"access_token": "t"})

    class FakeClient:
        def __init__(self, tokens):
            pass

        def me(self):
            return {"username": "night bus", "id": 1}

    monkeypatch.setattr(soundcloud, "SoundCloudClient", FakeClient)
    s = connect.SoundCloudConnectSession(saved.update)
    s._state = "abc"
    body = _hit_callback(s, "code=xyz&state=abc")
    assert s.status == "connected" and saved["username"] == "night bus"
    assert "SoundCloud is connected" in body and "night bus" in body
