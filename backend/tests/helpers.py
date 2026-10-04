"""Test helpers — generate tiny, real WAV files so the scanner/duration code runs."""
import struct
import wave
from pathlib import Path


def make_wav(path: Path, seconds: float = 0.1, rate: int = 8000, value: int = 0) -> Path:
    """Write a minimal mono 16-bit WAV. `value` varies the samples so two files have
    different content hashes (the dedupe key)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = int(rate * seconds)
    data = b"".join(struct.pack("<h", value) for _ in range(frames))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(data)
    return path
