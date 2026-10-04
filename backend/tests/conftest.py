import os
import sys
import tempfile
import types

import pytest

# Force the offline mock client + enable dev licence keys for the whole suite,
# before any lazyupload module reads these at call time.
os.environ.setdefault("LAZYUP_MOCK", "1")
os.environ.setdefault("LAZYUP_DEV", "1")
# Tests exercise the real free/Pro/Studio locks, not the free-beta unlock.
os.environ.setdefault("LAZYUP_FREE_BETA", "0")
# Never touch the developer's real Keychain / keyring; tokens use the key-file
# fallback in a throwaway folder (tests that need a keychain fake one).
os.environ["LAZYUP_KEYCHAIN"] = "0"
os.environ["LAZYUP_KEY_DIR"] = tempfile.mkdtemp(prefix="lazyup-keys-")

# Tests must be hermetic: a developer's local, git-ignored _buildsecret.py (real
# SoundCloud / broker creds) must never leak into credential-detection tests.
# Shadow it with an empty stub for the whole suite — the resolvers read env vars
# first, so tests that need creds set their own and are unaffected.
_buildsecret_stub = types.ModuleType("lazyupload._buildsecret")
for _attr in ("SC_CLIENT_ID", "SC_CLIENT_SECRET", "BROKER_URL", "BROKER_KEY", "ENT_SECRET"):
    setattr(_buildsecret_stub, _attr, "")
sys.modules["lazyupload._buildsecret"] = _buildsecret_stub

from lazyupload.catalog import Catalog  # noqa: E402
from tests.helpers import make_wav  # noqa: E402


@pytest.fixture
def catalog(tmp_path):
    cat = Catalog(tmp_path / "catalog.db")
    yield cat
    cat.close()


@pytest.fixture
def mixes_dir(tmp_path):
    d = tmp_path / "Mixes"
    make_wav(d / "Sunset Dub.wav", value=1)
    make_wav(d / "Midnight Drive.wav", value=2)
    make_wav(d / "Warehouse Set.wav", value=3)
    (d / "session.als").write_bytes(b"not audio")  # a project file — ignored by the scanner
    return d
