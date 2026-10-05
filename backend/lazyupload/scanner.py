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
    bitwig_dirs: dict[Path, bool] = {}
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
                if _in_project_package(p, src) or _in_bitwig_project(p, src, bitwig_dirs):
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


# Logic Pro projects are folders Finder shows as one file; the audio inside them is
# the project's own recordings, never a finished mix.
_PACKAGE_SUFFIXES = (".logicx", ".logic")


def _in_project_package(path: Path, src: Path) -> bool:
    try:
        parts = path.relative_to(src).parts[:-1]
    except ValueError:
        parts = path.parent.parts
    return any(part.lower().endswith(_PACKAGE_SUFFIXES) for part in parts)


# A Bitwig project folder keeps the project's own audio in these subfolders: samples,
# recordings and bounced clips, never a finished mix. Only inside a Bitwig project
# folder, since "Bounce" is also a usual name for a folder of finished songs.
_BITWIG_DIRS = {"samples", "recordings", "master-recordings", "bounce", "plugin-states",
                "auto-backups"}


def _is_bitwig_folder(d: Path, cache: dict) -> bool:
    if d not in cache:
        try:
            cache[d] = (d / ".bitwig-project").is_file() or any(d.glob("*.bwproject"))
        except OSError:
            cache[d] = False
    return cache[d]


def _in_bitwig_project(path: Path, src: Path, cache: dict) -> bool:
    try:
        rel = path.relative_to(src).parts[:-1]
    except ValueError:
        return False
    d = src
    for part in rel:
        if part.lower() in _BITWIG_DIRS and _is_bitwig_folder(d, cache):
            return True
        d = d / part
    return False


def _wav_duration(path: Path) -> float | None:
    """Length in seconds from the WAV header — cheap, header-only, no decode."""
    try:
        with contextlib.closing(wave.open(str(path), "rb")) as w:
            rate = w.getframerate()
            return w.getnframes() / float(rate) if rate else None
    except (wave.Error, OSError, EOFError):
        return None
