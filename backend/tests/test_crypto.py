import json
import stat
import sys

import pytest
from fastapi.testclient import TestClient

from lazyupload import crypto, service
from lazyupload.api.app import create_app

posix_only = pytest.mark.skipif(sys.platform == "win32", reason="Windows uses DPAPI")


class _FakeKeyring:
    priority = 5

    def __init__(self):
        self.items = {}

    def get_password(self, service_name, user):
        return self.items.get((service_name, user))

    def set_password(self, service_name, user, value):
        self.items[(service_name, user)] = value


@pytest.fixture
def fresh_keys(tmp_path, monkeypatch):
    monkeypatch.setenv("LAZYUP_KEY_DIR", str(tmp_path / "keys"))
    monkeypatch.setattr(crypto, "_keys", {})
    return tmp_path / "keys"


@posix_only
def test_file_key_used_without_keychain(fresh_keys):
    enc = crypto.encrypt("secret-token")
    assert enc.startswith("aesgcm:file:")
    assert "secret-token" not in enc
    assert crypto.decrypt(enc) == "secret-token"
    assert crypto.storage() == "file"
    key_file = fresh_keys / "token.key"
    assert stat.S_IMODE(key_file.stat().st_mode) == 0o600  # only this user can read it


@posix_only
def test_keychain_used_when_available(fresh_keys, monkeypatch):
    kr = _FakeKeyring()
    monkeypatch.setattr(crypto, "_keyring", lambda: kr)
    enc = crypto.encrypt("secret-token")
    assert enc.startswith("aesgcm:keychain:")
    assert crypto.storage() == "keychain"
    assert len(kr.items) == 1                   # one key, stored in the keychain
    assert not (fresh_keys / "token.key").exists()
    monkeypatch.setattr(crypto, "_keys", {})    # new process: key read back from keychain
    assert crypto.decrypt(enc) == "secret-token"


@posix_only
def test_wrong_key_cannot_read(fresh_keys, monkeypatch):
    enc = crypto.encrypt("secret-token")
    monkeypatch.setattr(crypto, "_keys", {"file": b"x" * 32})
    with pytest.raises(Exception):
        crypto.decrypt(enc)


@posix_only
def test_missing_key_is_not_recreated_on_read(fresh_keys, monkeypatch):
    enc = crypto.encrypt("secret-token")
    (fresh_keys / "token.key").unlink()
    monkeypatch.setattr(crypto, "_keys", {})
    with pytest.raises(OSError):
        crypto.decrypt(enc)
    assert not (fresh_keys / "token.key").exists()


@posix_only
def test_readable_logins_from_older_builds_get_locked_away(catalog, fresh_keys):
    tokens = {"id": "a1", "username": "u", "access_token": "ACCESS123"}
    old = "plain:" + __import__("base64").b64encode(json.dumps(tokens).encode()).decode()
    catalog.set_setting("sc_accounts", [{"id": "a1", "username": "u", "mock": False, "enc": old}])
    assert crypto.needs_upgrade(old)
    assert service.active_account(catalog)["access_token"] == "ACCESS123"
    stored = catalog.get_setting("sc_accounts")[0]["enc"]
    assert stored.startswith("aesgcm:")
    assert service.active_account(catalog)["access_token"] == "ACCESS123"


def test_account_endpoint_reports_where_login_is_kept(tmp_path):
    with TestClient(create_app(token="", db_path=tmp_path / "catalog.db")) as client:
        body = client.get("/api/account").json()
    assert body["login_storage"] in ("windows", "keychain", "file", "plain")
