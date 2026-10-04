"""At-rest encryption for sensitive values (SoundCloud OAuth tokens).

On Windows we use **DPAPI** (CryptProtectData) so the ciphertext is bound to the
current user account — another user on the same machine can't read the tokens, and
the key never lives in our code.

On macOS and Linux the tokens are encrypted with AES-GCM under a random 256-bit key
that lives in the computer's own secure storage: the **macOS Keychain**, or the
**Secret Service** keyring on Linux (GNOME Keyring, KWallet). Some Linux desktops
have no keyring running; there the key goes in a file only this user can read
(`token.key`, mode 0600, next to the catalog) so the app still works and the tokens
are still never stored in clear. `storage()` says which one is in use.

Storage format is a self-describing string: `dpapi:<b64>`, `aesgcm:keychain:<b64>`,
`aesgcm:file:<b64>` or `plain:<b64>` (only written if every other option failed).
`decrypt` also accepts a raw legacy plaintext (for catalogs written before
encryption shipped); `needs_upgrade` flags those so callers can re-save them.

Env: LAZYUP_KEYCHAIN=0 skips the OS keychain (tests, headless machines);
LAZYUP_KEY_DIR sets where the fallback key file lives.
"""
import base64
import os
import secrets
import sys
from pathlib import Path

_WIN = sys.platform == "win32"
_DPAPI = "dpapi:"
_AES = "aesgcm:"
_PLAIN = "plain:"

_KEYRING_SERVICE = "LazyCreatives Uploader"
_KEYRING_USER = "soundcloud-token-key"
_KEY_FILE = "token.key"

if _WIN:
    import ctypes
    from ctypes import wintypes

    class _BLOB(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    _crypt32 = ctypes.windll.crypt32
    _kernel32 = ctypes.windll.kernel32

    def _blob_in(data: bytes) -> _BLOB:
        buf = ctypes.create_string_buffer(data, len(data))
        return _BLOB(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))

    def _blob_out(blob: _BLOB) -> bytes:
        return ctypes.string_at(blob.pbData, blob.cbData)

    def _dpapi(fn, data: bytes) -> bytes:
        out = _BLOB()
        din = _blob_in(data)
        if not fn(ctypes.byref(din), None, None, None, None, 0, ctypes.byref(out)):
            raise OSError("DPAPI call failed")
        try:
            return _blob_out(out)
        finally:
            _kernel32.LocalFree(out.pbData)


# ---- macOS / Linux key management -------------------------------------------
_keys: dict[str, bytes] = {}  # "keychain" / "file" -> key, cached per process


def _key_dir() -> Path:
    env = os.environ.get("LAZYUP_KEY_DIR")
    if env:
        return Path(env)
    db = os.environ.get("LAZYUP_DB")
    if db:
        return Path(db).parent
    return Path.home() / ".lazyupload" / "lazyupload"


def _keyring():
    """The OS keyring backend, or None when there isn't a usable one."""
    if os.environ.get("LAZYUP_KEYCHAIN") == "0":
        return None
    try:
        import keyring
        from keyring.backends import fail
        kr = keyring.get_keyring()
        if isinstance(kr, fail.Keyring) or getattr(kr, "priority", 0) <= 0:
            return None
        return kr
    except Exception:
        return None


def _keychain_key(create: bool) -> bytes | None:
    if "keychain" in _keys:
        return _keys["keychain"]
    kr = _keyring()
    if kr is None:
        return None
    try:
        stored = kr.get_password(_KEYRING_SERVICE, _KEYRING_USER)
        if stored:
            key = base64.b64decode(stored)
        elif create:
            key = secrets.token_bytes(32)
            kr.set_password(_KEYRING_SERVICE, _KEYRING_USER, base64.b64encode(key).decode("ascii"))
            if kr.get_password(_KEYRING_SERVICE, _KEYRING_USER) is None:
                return None  # write didn't stick (locked keyring etc.)
        else:
            return None
    except Exception:
        return None
    if len(key) != 32:
        return None
    _keys["keychain"] = key
    return key


def _file_key(create: bool) -> bytes | None:
    if "file" in _keys:
        return _keys["file"]
    path = _key_dir() / _KEY_FILE
    try:
        if path.exists():
            key = base64.b64decode(path.read_text("ascii").strip())
        elif create:
            key = secrets.token_bytes(32)
            path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(base64.b64encode(key).decode("ascii"))
        else:
            return None
    except (OSError, ValueError):
        return None
    if len(key) != 32:
        return None
    _keys["file"] = key
    return key


_KEY_SOURCES = {"keychain": _keychain_key, "file": _file_key}


def _aes_encrypt(key: bytes, raw: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    nonce = secrets.token_bytes(12)
    return nonce + AESGCM(key).encrypt(nonce, raw, None)


def _aes_decrypt(key: bytes, blob: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    return AESGCM(key).decrypt(blob[:12], blob[12:], None)


def storage() -> str:
    """Where tokens get locked away on this machine: "windows" (DPAPI), "keychain"
    (macOS Keychain / Linux keyring), "file" (owner-only key file) or "plain"."""
    if _WIN:
        return "windows"
    for name, get in _KEY_SOURCES.items():
        if get(create=True):
            return name
    return "plain"


# ---- public API -------------------------------------------------------------
def encrypt(plaintext: str) -> str:
    """Encrypt a string for local storage. Never raises — falls back to a marked
    plaintext envelope only if every secure option is unavailable, so token
    storage can't hard-fail."""
    raw = plaintext.encode("utf-8")
    if _WIN:
        try:
            blob = _dpapi(_crypt32.CryptProtectData, raw)
            return _DPAPI + base64.b64encode(blob).decode("ascii")
        except OSError:
            pass
    else:
        for name, get in _KEY_SOURCES.items():
            key = get(create=True)
            if key is None:
                continue
            try:
                blob = _aes_encrypt(key, raw)
            except Exception:
                continue
            return f"{_AES}{name}:" + base64.b64encode(blob).decode("ascii")
    return _PLAIN + base64.b64encode(raw).decode("ascii")


def decrypt(token: str) -> str:
    """Inverse of encrypt. Accepts every envelope above and raw legacy plaintext."""
    if not isinstance(token, str):
        raise ValueError("not an encrypted token")
    if token.startswith(_DPAPI):
        if not _WIN:
            raise OSError("DPAPI ciphertext can't be read off Windows")
        blob = base64.b64decode(token[len(_DPAPI):])
        return _dpapi(_crypt32.CryptUnprotectData, blob).decode("utf-8")
    if token.startswith(_AES):
        name, _, b64 = token[len(_AES):].partition(":")
        get = _KEY_SOURCES.get(name)
        key = get(create=False) if get else None
        if key is None:
            raise OSError(f"the {name} key for this token isn't available")
        return _aes_decrypt(key, base64.b64decode(b64)).decode("utf-8")
    if token.startswith(_PLAIN):
        return base64.b64decode(token[len(_PLAIN):]).decode("utf-8")
    return token  # legacy: stored before encryption existed


def is_encrypted(token: str) -> bool:
    return isinstance(token, str) and token.startswith((_DPAPI, _AES, _PLAIN))


def needs_upgrade(token: str) -> bool:
    """True for values stored readable (`plain:` or legacy) that this machine can
    now lock away properly; re-encrypting them moves them to secure storage."""
    if not isinstance(token, str) or token.startswith((_DPAPI, _AES)):
        return False
    return storage() != "plain"
