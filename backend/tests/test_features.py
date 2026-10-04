import json
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from lazyupload import crypto, service
from lazyupload.api.app import create_app
from lazyupload.connect import SoundCloudConnectSession


def _connect_mock(catalog):
    SoundCloudConnectSession(lambda t: service.save_account(catalog, t)).start()


# ---- crypto -----------------------------------------------------------------
def test_crypto_roundtrip():
    enc = crypto.encrypt("super-secret-token")
    assert crypto.is_encrypted(enc)
    assert "super-secret-token" not in enc
    assert crypto.decrypt(enc) == "super-secret-token"


def test_crypto_accepts_legacy_plaintext():
    assert crypto.decrypt("legacy-plain") == "legacy-plain"


# ---- multi-account ----------------------------------------------------------
def test_add_switch_remove_accounts(catalog):
    a1 = service.add_account(catalog, {"username": "alpha", "access_token": "x", "user_id": 1}, allow_multiple=True)
    a2 = service.add_account(catalog, {"username": "beta", "access_token": "y", "user_id": 2}, allow_multiple=True)
    assert len(service.get_accounts(catalog)) == 2
    assert service.active_account(catalog)["username"] == "beta"  # newest is active
    assert service.set_active(catalog, a1["id"]) is True
    assert service.active_account(catalog)["username"] == "alpha"
    pub = service.accounts_public(catalog)
    assert sum(1 for p in pub if p["active"]) == 1
    service.remove_account(catalog, a1["id"])
    names = [a["username"] for a in service.get_accounts(catalog)]
    assert names == ["beta"] and a2["id"]


def test_free_connect_replaces_account(catalog):
    service.add_account(catalog, {"username": "one", "access_token": "x"}, allow_multiple=False)
    service.add_account(catalog, {"username": "two", "access_token": "y"}, allow_multiple=False)
    assert len(service.get_accounts(catalog)) == 1
    assert service.active_account(catalog)["username"] == "two"


def test_same_user_is_deduped(catalog):
    service.add_account(catalog, {"username": "u", "access_token": "a", "user_id": 7}, allow_multiple=True)
    service.add_account(catalog, {"username": "u-renamed", "access_token": "b", "user_id": 7}, allow_multiple=True)
    assert len(service.get_accounts(catalog)) == 1
    assert service.active_account(catalog)["access_token"] == "b"


def test_tokens_encrypted_at_rest(catalog):
    service.add_account(catalog, {"username": "u", "access_token": "ACCESS123", "refresh_token": "REFRESH456"})
    raw = catalog.get_setting("sc_accounts")
    blob = json.dumps(raw)
    assert "ACCESS123" not in blob and "REFRESH456" not in blob  # not stored in clear
    assert crypto.is_encrypted(raw[0]["enc"])
    assert service.active_account(catalog)["access_token"] == "ACCESS123"  # decrypts back


# ---- scheduled release ------------------------------------------------------
def test_scheduled_release_uploads_private_then_flips(catalog, mixes_dir):
    _connect_mock(catalog)
    mixes = service.scan_mixes(catalog, [mixes_dir])
    future = (datetime.now() + timedelta(hours=1)).isoformat()
    service.run_upload(catalog, mixes[:1], {"sharing": "public"}, release_at=future)

    # Uploaded privately, with a pending release queued.
    uploaded = [t for t in service.list_tracks(catalog) if t["title"] == mixes[0]["name"]][0]
    assert uploaded["sharing"] == "private"
    assert len(service.pending_releases(catalog)) == 1

    # Not due yet -> nothing happens.
    assert service.process_due_releases(catalog, now=datetime.now()) == []
    assert len(service.pending_releases(catalog)) == 1

    # Due -> flipped public, queue cleared.
    flipped = service.process_due_releases(catalog, now=datetime.now() + timedelta(hours=2))
    assert len(flipped) == 1
    assert service.pending_releases(catalog) == []
    again = [t for t in service.list_tracks(catalog) if t["title"] == mixes[0]["name"]][0]
    assert again["sharing"] == "public"


# ---- API: gating + validation ----------------------------------------------
@pytest.fixture
def client(tmp_path, mixes_dir):
    app = create_app(token="", db_path=tmp_path / "catalog.db")
    with TestClient(app) as c:
        c.mixes_dir = str(mixes_dir)
        yield c


def test_sharing_enum_rejected(client):
    assert client.put("/api/settings", json={"default_sharing": "banana"}).status_code == 422


def test_templates_gated_free_then_pro(client):
    free = client.put("/api/settings", json={"templates": [{"name": "House night"}]})
    assert free.json()["templates"] == []  # stripped on Free
    client.post("/api/entitlement/activate", json={"key": "LC-PRO-DEMO-2026"})
    pro = client.put("/api/settings", json={"templates": [{"name": "House night", "genre": "House"}]})
    assert len(pro.json()["templates"]) == 1


def test_scheduled_release_gated(client):
    client.put("/api/settings", json={"sources": [client.mixes_dir]})
    client.post("/api/connect")
    mixes = client.post("/api/scan", json={}).json()["mixes"]
    body = {"items": [{"path": mixes[0]["path"]}], "release_at": "2030-01-01T00:00:00"}
    assert client.post("/api/upload", json=body).status_code == 402  # Pro-only
    client.post("/api/entitlement/activate", json={"key": "LC-PRO-DEMO-2026"})
    assert client.post("/api/upload", json=body).status_code == 200


def test_multi_account_api_flow(client):
    client.post("/api/connect")
    acc = client.get("/api/account").json()
    assert acc["multi"] is False and len(acc["accounts"]) == 1

    client.post("/api/entitlement/activate", json={"key": "LC-PRO-DEMO-2026"})
    client.post("/api/connect")  # second account (mock has no user_id -> appended)
    acc2 = client.get("/api/account").json()
    assert acc2["multi"] is True and len(acc2["accounts"]) >= 2

    first = acc2["accounts"][0]["id"]
    assert client.post("/api/accounts/activate", json={"id": first}).status_code == 200
    client.post("/api/disconnect", json={"id": first})
    assert all(a["id"] != first for a in client.get("/api/account").json()["accounts"])
