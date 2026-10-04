from lazyupload import entitlement


def test_free_blocks_pro_features():
    assert entitlement.allows("free", "auto_upload") is False
    assert entitlement.allows("free", "batch") is False


def test_pro_unlocks_features():
    assert entitlement.allows("pro", "auto_upload") is True
    assert entitlement.allows("pro", "batch") is True


def test_dev_key_activates_pro():
    res = entitlement.activate("LC-PRO-DEMO-2026")
    assert res and res["tier"] == "pro"


def test_unknown_key_rejected():
    assert entitlement.activate("nope") is None


def test_forged_tier_falls_back_to_free():
    # A hand-edited row claiming 'pro' with a bad signature must read back as free.
    forged = {"tier": "pro", "key": "x", "instance_id": None, "sig": "deadbeef"}
    assert entitlement.verify_stored(forged) == "free"


def test_signed_tier_verifies():
    sig = entitlement.sign_tier("pro", "KEY", "iid")
    stored = {"tier": "pro", "key": "KEY", "instance_id": "iid", "sig": sig}
    assert entitlement.verify_stored(stored) == "pro"


def test_free_beta_unlocks_everything(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from lazyupload.api.app import create_app
    monkeypatch.setenv("LAZYUP_FREE_BETA", "1")
    assert all(entitlement.features_for("free").values())
    assert entitlement.allows("free", "batch") is True
    with TestClient(create_app(token="", db_path=tmp_path / "catalog.db")) as c:
        d = c.get("/api/entitlement").json()
        assert d["tier"] == "free" and d["beta"] is True and all(d["features"].values())
        assert c.get("/api/overview").json()["beta"] is True


def test_free_beta_off_keeps_locks(monkeypatch):
    monkeypatch.setenv("LAZYUP_FREE_BETA", "0")
    assert entitlement.free_beta() is False
    assert entitlement.allows("free", "batch") is False
