"""Posting on bad days: a sign-in SoundCloud no longer accepts, SoundCloud asking us
to wait, the connection dropping just as a mix arrives, Stop in the middle of a mix,
and tags with apostrophes or quote marks."""
import requests
import responses

from lazyupload import service, soundcloud
from tests.helpers import make_wav
from tests.test_service import _connect_mock


def _mixes(tmp_path, n):
    return [{"path": str(make_wav(tmp_path / "Mixes" / f"Mix {i}.wav", value=i + 1)),
             "name": f"Mix {i}"} for i in range(n)]


class _Refusing(soundcloud.MockSoundCloudClient):
    """A demo client whose uploads SoundCloud refuses with `exc`, counting the bytes."""
    exc: Exception = soundcloud.SignedOutError()
    calls = 0

    def upload(self, file_path, meta, on_progress=None, artwork_path=None):
        type(self).calls += 1
        raise self.exc

    def renew(self):
        raise soundcloud.SignedOutError()


def _use_client(monkeypatch, cls):
    cls.calls = 0
    monkeypatch.setattr(soundcloud, "get_client",
                        lambda tokens, on_tokens=None, store=None, playlist_store=None:
                        cls(tokens, on_tokens, store, playlist_store))


# ---- signed out --------------------------------------------------------------
def test_a_refused_sign_in_stops_the_batch_and_marks_the_account(catalog, tmp_path, monkeypatch):
    _connect_mock(catalog)
    _use_client(monkeypatch, _Refusing)
    _Refusing.exc = soundcloud.SignedOutError()
    events = []
    res = service.run_upload(catalog, _mixes(tmp_path, 5), {}, events.append)
    assert _Refusing.calls == 1  # the other four were never sent
    assert res["stopped"] == "signed_out" and res["not_sent"] == 4
    err = next(e for e in events if e["type"] == "track_error")
    assert err["reason"] == "SoundCloud signed you out. Sign in again."
    done = events[-1]
    assert done["type"] == "upload_done" and done["stopped"] == "signed_out"
    # the sidebar stops saying "connected", and the app knows to offer "Sign in again"
    assert service.signed_out(catalog) and not service.connected(catalog)
    assert service.accounts_public(catalog)[0]["signed_out"] is True


def test_signing_in_again_clears_signed_out(catalog, monkeypatch):
    _connect_mock(catalog)
    service.mark_signed_out(catalog)
    assert not service.connected(catalog)
    _connect_mock(catalog)
    assert service.connected(catalog) and not service.signed_out(catalog)


def test_a_401_gets_a_new_token_once_before_giving_up(catalog, monkeypatch):
    class _Expired(soundcloud.MockSoundCloudClient):
        renewed = 0
        tries = 0

        def list_tracks(self, limit=200):
            type(self).tries += 1
            if not type(self).renewed:
                raise soundcloud.SignedOutError()
            return []

        def renew(self):
            type(self).renewed += 1

    _connect_mock(catalog)
    _use_client(monkeypatch, _Expired)
    assert service.client_for(catalog).list_tracks() == []
    assert _Expired.renewed == 1 and _Expired.tries == 2
    assert service.connected(catalog)  # a fresh token worked: still signed in


@responses.activate
def test_a_dead_refresh_token_means_signed_out_with_the_current_broker(monkeypatch):
    monkeypatch.setenv("LAZYUP_SC_CLIENT_ID", "cid")
    monkeypatch.setenv("LAZYUP_BROKER_URL", "https://broker.example")
    # the broker on Render today turns SoundCloud's 400 invalid_grant into this 502
    responses.add(responses.POST, "https://broker.example/refresh",
                  json={"detail": "SoundCloud token request failed"}, status=502)
    try:
        soundcloud.refresh_tokens("used-already")
        raise AssertionError("expected SignedOutError")
    except soundcloud.SignedOutError as e:
        assert str(e) == "SoundCloud signed you out. Sign in again."


@responses.activate
def test_a_broker_that_cannot_reach_soundcloud_is_not_a_sign_out(monkeypatch):
    monkeypatch.setenv("LAZYUP_SC_CLIENT_ID", "cid")
    monkeypatch.setenv("LAZYUP_BROKER_URL", "https://broker.example")
    responses.add(responses.POST, "https://broker.example/refresh",
                  json={"detail": "could not reach SoundCloud"}, status=502)
    try:
        soundcloud.refresh_tokens("rt")
        raise AssertionError("expected HTTPError")
    except soundcloud.SignedOutError:
        raise AssertionError("an outage is not a sign-out")
    except requests.HTTPError:
        pass


@responses.activate
def test_direct_invalid_grant_and_newer_broker_401_mean_signed_out(monkeypatch):
    monkeypatch.setenv("LAZYUP_SC_CLIENT_ID", "cid")
    monkeypatch.setenv("LAZYUP_BROKER_URL", "https://broker.example")
    responses.add(responses.POST, "https://broker.example/refresh",
                  json={"detail": "sign-in expired"}, status=401)
    try:
        soundcloud.refresh_tokens("rt")
        raise AssertionError("expected SignedOutError")
    except soundcloud.SignedOutError:
        pass
    monkeypatch.delenv("LAZYUP_BROKER_URL")
    monkeypatch.setenv("LAZYUP_SC_CLIENT_SECRET", "secret")
    responses.add(responses.POST, f"{soundcloud.AUTH_BASE}/oauth/token",
                  json={"error": "invalid_grant"}, status=400)
    try:
        soundcloud.refresh_tokens("rt")
        raise AssertionError("expected SignedOutError")
    except soundcloud.SignedOutError:
        pass


# ---- asked to wait -------------------------------------------------------------
def test_a_rate_limit_stops_the_batch_and_keeps_soundclouds_wait(catalog, tmp_path, monkeypatch):
    _connect_mock(catalog)
    _use_client(monkeypatch, _Refusing)
    _Refusing.exc = soundcloud.RateLimitError("180")
    events = []
    res = service.run_upload(catalog, _mixes(tmp_path, 4), {}, events.append)
    assert _Refusing.calls == 1
    assert res["stopped"] == "rate_limit" and res["wait_seconds"] == 180
    assert res["stop_note"] == "SoundCloud asked us to wait 3 minutes."
    assert next(e for e in events if e["type"] == "track_error")["reason"] == res["stop_note"]
    assert service.connected(catalog)  # waiting is not signing out


def test_wait_words_use_the_real_number():
    assert soundcloud.RateLimitError("60").args[0] == "SoundCloud asked us to wait 1 minute."
    assert soundcloud.RateLimitError("3600").args[0] == "SoundCloud asked us to wait 60 minutes."
    assert soundcloud.RateLimitError("86400").args[0] == "SoundCloud asked us to wait about 24 hours."
    assert soundcloud.RateLimitError(None).args[0].startswith("SoundCloud asked us to slow down")
    assert soundcloud.wait_seconds("Wed, 21 Oct 2015 07:28:00 GMT") == 0  # a date in the past


# ---- the connection drops as the mix arrives -----------------------------------------
class _Flaky(soundcloud.MockSoundCloudClient):
    """The first upload reaches SoundCloud but the answer is lost; the track list can
    be read afterwards (or not, with `offline`)."""
    calls = 0
    offline = False

    def upload(self, file_path, meta, on_progress=None, artwork_path=None):
        type(self).calls += 1
        track = super().upload(file_path, meta, on_progress, artwork_path)
        if type(self).calls == 1:
            raise requests.ConnectionError("connection reset")
        return track

    def find_posted(self, title, since):
        if type(self).offline:
            raise requests.ConnectionError("still offline")
        return super().find_posted(title, since)


def test_try_again_after_a_dropped_answer_does_not_post_twice(catalog, tmp_path, monkeypatch):
    _connect_mock(catalog)
    _use_client(monkeypatch, _Flaky)
    _Flaky.offline = False
    mix = _mixes(tmp_path, 1)
    first = service.run_upload(catalog, mix, {})
    assert first["error_count"] == 1
    before = len(service.client_for(catalog).list_tracks())
    again = service.run_upload(catalog, mix, {})  # Try again
    assert _Flaky.calls == 1  # never sent a second time
    assert again["skipped_count"] == 1 and again["error_count"] == 0
    assert len(service.client_for(catalog).list_tracks()) == before
    assert any(r["status"] == "uploaded" for r in catalog.recent_uploads(limit=10))


def test_try_again_while_still_offline_does_not_risk_a_double(catalog, tmp_path, monkeypatch):
    _connect_mock(catalog)
    _use_client(monkeypatch, _Flaky)
    _Flaky.offline = True
    mix = _mixes(tmp_path, 1)
    service.run_upload(catalog, mix, {})
    again = service.run_upload(catalog, mix, {})
    assert _Flaky.calls == 1 and again["error_count"] == 1


# ---- Stop in the middle of a mix -------------------------------------------------------
def test_stop_now_cuts_off_the_mix_going_up(catalog, tmp_path, monkeypatch):
    _connect_mock(catalog)
    before = len(service.client_for(catalog).list_tracks())
    stop = {"now": False}

    def progress(ev):
        if ev["type"] == "track_progress":
            stop["now"] = True  # pressed Stop once the mix started going up

    res = service.run_upload(catalog, _mixes(tmp_path, 2), {}, progress, abort=lambda: stop["now"])
    assert res["cancelled"] and res["ok_count"] == 0 and res["error_count"] == 0
    assert len(service.client_for(catalog).list_tracks()) == before
    assert not [r for r in catalog.recent_uploads(limit=10)]  # nothing written to History


# ---- tags --------------------------------------------------------------------------
def test_tags_with_apostrophes_and_quotes_round_trip():
    for tags in (["80's", "lo fi"], ["rock'n'roll"], ["deep house", "2024"]):
        assert soundcloud._parse_tag_list(soundcloud._tag_list(tags)) == tags
    assert soundcloud._parse_tag_list(soundcloud._tag_list(['12" vinyl'])) == ["12 vinyl"]
