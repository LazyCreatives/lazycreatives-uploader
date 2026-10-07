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
                    "duration": duration(p, st.st_size, st.st_mtime),
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


# Lengths already read, by (path, size, mtime), so a rescan doesn't reopen every file.
_lengths: dict[tuple[str, int, float], float | None] = {}


def duration(path: Path, size: int, mtime: float) -> float | None:
    """Length in seconds, read from the file's header only (no decoding). WAV uses
    the standard library; FLAC, AIFF, OGG and MP3 go through soundfile. None when the
    length can't be read (M4A, AAC, WMA, or a damaged file)."""
    key = (str(path), size, mtime)
    if key not in _lengths:
        ext = path.suffix.lower()
        secs = _wav_duration(path) if ext == ".wav" else None
        if secs is None and ext in _SOUNDFILE_EXTS:
            secs = _soundfile_duration(path)
        _lengths[key] = secs
    return _lengths[key]


_SOUNDFILE_EXTS = {".wav", ".flac", ".aiff", ".aif", ".ogg", ".mp3"}


def _soundfile_duration(path: Path) -> float | None:
    try:
        import soundfile
        info = soundfile.info(str(path))
        return info.frames / float(info.samplerate) if info.samplerate and info.frames > 0 else None
    except Exception:  # unreadable or unsupported by this libsndfile build
        return None


def _wav_duration(path: Path) -> float | None:
    """Length in seconds from the WAV header — cheap, header-only, no decode."""
    try:
        with contextlib.closing(wave.open(str(path), "rb")) as w:
            rate = w.getframerate()
            return w.getnframes() / float(rate) if rate else None
    except (wave.Error, OSError, EOFError):
        return None
