from datetime import date, timedelta

from fastapi.testclient import TestClient

from lazyupload import plays, service
from lazyupload.api.app import create_app
from lazyupload.catalog import Catalog

TUE = date(2026, 10, 13)


def test_first_look_says_nothing(catalog):
    assert plays.record(catalog, 7, 100, TUE) is None
    assert catalog.get_setting(plays.PLAYS_KEY) == {"account": 7, "days": {"2026-10-13": 100}}


def test_gain_since_the_oldest_day_in_the_last_six(catalog):
    plays.record(catalog, 7, 100, TUE)
    plays.record(catalog, 7, 120, TUE + timedelta(days=2))
    out = plays.record(catalog, 7, 138, TUE + timedelta(days=4))
    assert out == {"total": 138, "gain": 38, "since": "2026-10-13"}


def test_today_keeps_its_last_total_and_is_not_the_base(catalog):
    plays.record(catalog, 7, 100, TUE)
    plays.record(catalog, 7, 105, TUE)
    assert plays.record(catalog, 7, 110, TUE) is None   # only today kept: nothing to compare
    assert catalog.get_setting(plays.PLAYS_KEY)["days"] == {"2026-10-13": 110}
    assert plays.record(catalog, 7, 111, TUE + timedelta(days=1)) == {"total": 111, "gain": 1, "since": "2026-10-13"}


def test_days_older_than_six_are_not_counted_from(catalog):
    plays.record(catalog, 7, 50, TUE)
    plays.record(catalog, 7, 80, TUE + timedelta(days=3))
    out = plays.record(catalog, 7, 90, TUE + timedelta(days=7))   # TUE is now 7 days back
    assert out == {"total": 90, "gain": 10, "since": "2026-10-16"}


def test_no_gain_or_fewer_plays_says_nothing(catalog):
    plays.record(catalog, 7, 100, TUE)
    assert plays.record(catalog, 7, 100, TUE + timedelta(days=1)) is None
    assert plays.record(catalog, 7, 90, TUE + timedelta(days=2)) is None   # a track was deleted


def test_old_days_are_forgotten(catalog):
    plays.record(catalog, 7, 1, TUE)
    plays.record(catalog, 7, 2, TUE + timedelta(days=31))
    assert list(catalog.get_setting(plays.PLAYS_KEY)["days"]) == ["2026-11-13"]


def test_another_account_starts_again(catalog):
    plays.record(catalog, 7, 100, TUE)
    assert plays.record(catalog, 8, 500, TUE + timedelta(days=1)) is None
    assert catalog.get_setting(plays.PLAYS_KEY) == {"account": 8, "days": {"2026-10-14": 500}}


def test_a_damaged_history_is_started_again(catalog):
    catalog.set_setting(plays.PLAYS_KEY, ["not", "a", "dict"])
    assert plays.record(catalog, 7, 10, TUE) is None
    catalog.set_setting(plays.PLAYS_KEY, {"account": 7, "days": {"2026-10-12": "lots"}})
    assert plays.record(catalog, 7, 10, TUE) is None


def test_tracks_endpoint_carries_the_gain(tmp_path):
    db = tmp_path / "catalog.db"
    with TestClient(create_app(token="", db_path=db)) as client:
        client.post("/api/connect")
        first = client.get("/api/tracks").json()
        assert first["plays"] is None   # nothing remembered yet
        total = sum(t.get("playback_count") or 0 for t in first["tracks"])
        cat = Catalog(db)
        account = (service.active_account(cat) or {}).get("id")
        yesterday = (date.today() - timedelta(days=1)).isoformat()
        cat.set_setting(plays.PLAYS_KEY, {"account": account, "days": {yesterday: total - 38}})
        cat.close()
        again = client.get("/api/tracks").json()
        assert again["plays"] == {"total": total, "gain": 38, "since": yesterday}


def test_overview_counts_the_tracks_seen_on_soundcloud(tmp_path):
    with TestClient(create_app(token="", db_path=tmp_path / "catalog.db")) as client:
        client.post("/api/connect")
        assert client.get("/api/overview").json()["sc_track_count"] is None   # never looked
        n = len(client.get("/api/tracks").json()["tracks"])
        assert client.get("/api/overview").json()["sc_track_count"] == n
