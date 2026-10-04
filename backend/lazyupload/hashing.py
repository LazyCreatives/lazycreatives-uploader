"""Content hashing — the dedupe key that stops a mix being published twice.

We hash the *bytes of the audio file*. If you render "Sunset Dub v3.wav" twice with
no change, the hash is identical and the uploader skips it; re-render with a tweak
and the hash changes, so it's treated as a new mix. This is deliberately filename-
independent — renaming a file doesn't trick it into re-uploading.
"""
import hashlib
from pathlib import Path

_CHUNK = 1024 * 1024  # 1 MiB — stream large WAVs without loading them into memory


def hash_file(path: Path) -> str:
    """SHA-256 of a file's contents, streamed in chunks."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(_CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()
