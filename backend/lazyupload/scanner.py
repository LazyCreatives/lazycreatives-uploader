"""Discover candidate mixes in the watched folders. Pure filesystem — no network,
no hashing (the service layer adds dedupe on top so scans stay cheap)."""
import contextlib
import wave
from pathlib import Path

from lazyupload.models import AUDIO_EXTS


def discover(sources: list[Path]) -> list[dict]:
    """Every audio file under the given folders, newest first.

    Returns lightweight dicts (path/name/ext/size/mtime/duration); the service adds
    hash + uploaded status. Recurses, but skips hidden/system dirs and the temp
    'render in progress' files some DAWs leave behind.
    """
    out: dict[str, dict] = {}
    for src in sources:
        if not src or not src.is_dir():
            continue
        for p in src.rglob("*"):
            try:
                if not p.is_file():
                    continue
                ext = p.suffix.lower()
                if ext not in AUDIO_EXTS:
                    continue
                if p.name.startswith(".") or p.name.startswith("~"):
                    continue
                st = p.stat()
                key = str(p.resolve())
                out[key] = {
                    "path": key,
                    "name": p.stem,
                    "ext": ext,
                    "size": st.st_size,
                    "mtime": st.st_mtime,
                    "duration": _wav_duration(p) if ext == ".wav" else None,
                }
            except OSError:
                continue  # vanished/locked mid-scan — just skip it
    return sorted(out.values(), key=lambda m: m["mtime"], reverse=True)


def _wav_duration(path: Path) -> float | None:
    """Length in seconds from the WAV header — cheap, header-only, no decode."""
    try:
        with contextlib.closing(wave.open(str(path), "rb")) as w:
            rate = w.getframerate()
            return w.getnframes() / float(rate) if rate else None
    except (wave.Error, OSError, EOFError):
        return None
