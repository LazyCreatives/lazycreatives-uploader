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
    monkeypatch.setattr(crypto, "_missing", set())
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
def test_keychain_never_used_for_new_logins(fresh_keys, monkeypatch):
    kr = _FakeKeyring()
    monkeypatch.setattr(crypto, "_keyring", lambda: kr)
    enc = crypto.encrypt("secret-token")
    assert enc.startswith("aesgcm:file:")
    assert crypto.storage() == "file"
    assert kr.items == {}                       # nothing put in the keychain



class _CountingKeyring(_FakeKeyring):
    def __init__(self):
        super().__init__()
        self.reads = 0

    def get_password(self, service_name, user):
        self.reads += 1
        return super().get_password(service_name, user)


@posix_only
def test_mac_never_reads_the_keychain(fresh_keys, monkeypatch):
    kr = _CountingKeyring()
    key = b"k" * 32
    kr.items[(crypto._KEYRING_SERVICE, crypto._KEYRING_USER)] = __import__("base64").b64encode(key).decode()
    enc = "aesgcm:keychain:" + __import__("base64").b64encode(crypto._aes_encrypt(key, b"secret-token")).decode()
    monkeypatch.setattr(crypto.sys, "platform", "darwin")
    monkeypatch.delenv("LAZYUP_KEYCHAIN", raising=False)
    import keyring
    monkeypatch.setattr(keyring, "get_keyring", lambda: kr)
    for _ in range(5):
        with pytest.raises(OSError):
            crypto.decrypt(enc)
    assert kr.reads == 0                        # no prompt, ever: user just signs in again


@posix_only
def test_failed_keychain_read_is_not_retried(fresh_keys, monkeypatch):
    kr = _CountingKeyring()                     # empty: the key isn't there / was refused
    monkeypatch.setattr(crypto, "_keyring", lambda: kr)
    monkeypatch.setattr(crypto, "_missing", set())
    enc = "aesgcm:keychain:" + __import__("base64").b64encode(b"x" * 40).decode()
    for _ in range(5):
        with pytest.raises(OSError):
            crypto.decrypt(enc)
    assert kr.reads == 1


@posix_only
def test_old_linux_keyring_login_moves_to_key_file(catalog, fresh_keys, monkeypatch):
    kr = _FakeKeyring()
    monkeypatch.setattr(crypto, "_keyring", lambda: kr)
    monkeypatch.setattr(crypto, "_missing", set())
    key = b"k" * 32
    kr.items[(crypto._KEYRING_SERVICE, crypto._KEYRING_USER)] = __import__("base64").b64encode(key).decode()
    tokens = {"id": "a1", "username": "u", "access_token": "ACCESS123"}
    blob = crypto._aes_encrypt(key, json.dumps(tokens).encode())
    old = "aesgcm:keychain:" + __import__("base64").b64encode(blob).decode()
    catalog.set_setting("sc_accounts", [{"id": "a1", "username": "u", "mock": False, "enc": old}])
    assert service.active_account(catalog)["access_token"] == "ACCESS123"
    assert catalog.get_setting("sc_accounts")[0]["enc"].startswith("aesgcm:file:")
    monkeypatch.setattr(crypto, "_keys", {})
    monkeypatch.setattr(crypto, "_keyring", lambda: None)  # keyring gone: still signed in
    assert service.active_account(catalog)["access_token"] == "ACCESS123"


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
    assert body["login_storage"] in ("windows", "file", "plain")
