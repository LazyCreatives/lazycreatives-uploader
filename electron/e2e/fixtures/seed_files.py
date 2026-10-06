"""Make demo content for the Uploader picture tests (run with the backend venv's python;
run for you by e2e/global-setup.ts).

Writes into WORK_DIR:
  Music/Mixdowns/     a watched folder of finished-mix WAVs (real audio, so waveforms draw)
  backups-catalog.db  a fake LazyCreatives Backups catalog, so mixes pick up BPM/genre/DAW
                      (the sidecar reads it read-only via LAZYUP_BACKUPS_DB)

Usage: python seed_files.py WORK_DIR
"""
import json
import os
import sqlite3
import sys
import time
import wave
from pathlib import Path

import numpy as np

# name, genre, bpm, daw, minutes, days ago exported
MIXES = [
    ("Midnight Drive", "House", 124, "Ableton Live", 4.2, 1),
    ("Neon Rain", "Techno", 132, "Ableton Live", 5.6, 3),
    ("Basement Tapes 03", "Boom bap", 90, "FL Studio", 2.9, 4),
    ("Sunday Dub", "Dubstep", 140, "Bitwig Studio", 3.8, 6),
    ("Glass Hours", "Ambient", 72, "Logic Pro", 6.1, 8),
    ("Lowlight", "Lo-fi", 84, "FL Studio", 2.4, 10),
    ("Coastline (Extended Mix)", "Trance", 138, "Ableton Live", 7.3, 12),
    ("Paper Moons", "UK garage", 132, "Ableton Live", 3.5, 15),
    ("Tunnel Vision", "DnB", 174, "FL Studio", 4.6, 18),
    ("Afterglow", "Pop", 104, "Logic Pro", 3.2, 21),
    ("Rooftop Session", "Tech house", 126, "Ableton Live", 5.0, 25),
    ("Static Bloom", "Hyperpop", 160, "FL Studio", 2.7, 29),
    ("Northbound", "Drill", 142, "Reaper", 3.1, 34),
    ("Velvet Room", "Hip hop", 92, "Ableton Live", 3.6, 40),
]

RATE = 4000  # low sample rate keeps files small; still decodes as a normal WAV


def render(path: Path, minutes: float, bpm: int, seed: int) -> None:
    rng = np.random.default_rng(seed)
    n = int(minutes * 60 * RATE)
    t = np.arange(n) / RATE
    beat = 60.0 / bpm
    # song shape: intro, build, drop, break, drop, outro
    sections = rng.uniform(0.35, 1.0, size=12)
    sections[0], sections[-1] = 0.25, 0.2
    shape = np.interp(t / t[-1], np.linspace(0, 1, len(sections)), sections)
    kick = np.exp(-((t % beat) / beat) * 9.0)
    tone = np.sin(2 * np.pi * 55 * t) * kick + 0.35 * rng.standard_normal(n) * (0.4 + 0.6 * kick)
    audio = np.clip(tone * shape * 0.6, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((audio * 32767).astype("<i2").tobytes())


def main() -> None:
    work = Path(sys.argv[1]).resolve()
    mixes = work / "Music" / "Mixdowns"
    mixes.mkdir(parents=True, exist_ok=True)
    now = time.time()
    for i, (name, _genre, bpm, _daw, minutes, days) in enumerate(MIXES):
        p = mixes / f"{name}.wav"
        if not p.exists():
            render(p, minutes, bpm, seed=i)
        ts = now - days * 86400 - i * 3700
        os.utime(p, (ts, ts))

    db = work / "backups-catalog.db"
    if db.exists():
        db.unlink()
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE discovered (project_id TEXT, name TEXT, daw TEXT, owner TEXT, bpm REAL,"
                " genre TEXT, genre_emoji TEXT, tracks INTEGER, plugins TEXT, missing_count INTEGER,"
                " size INTEGER, mtime REAL, genre_by_you INTEGER)")
    con.execute("CREATE TABLE snapshots (project_id TEXT, project_name TEXT, timestamp TEXT,"
                " total_size INTEGER, file_count INTEGER, verified INTEGER, verified_at TEXT, status TEXT)")
    plugin_pool = ["Serum", "Pro-Q 3", "Valhalla VintageVerb", "OTT", "Decapitator", "Kickstart 2",
                   "Diva", "Soothe2", "RC-20 Retro Color", "Ozone 11", "Saturn 2", "Pigments"]
    for i, (name, genre, bpm, daw, _m, days) in enumerate(MIXES):
        pid = f"proj-{i:03d}"
        plugins = plugin_pool[i % 5: i % 5 + 4 + i % 4]
        con.execute("INSERT INTO discovered VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (pid, name, daw, "you", bpm, genre, None, 12 + (i * 7) % 30,
                     json.dumps(plugins), 0, (180 + i * 37) * 1_000_000, now - days * 86400, 1))
        for k in range(2 + i % 5):
            stamp = time.strftime("%Y-%m-%d_%H%M", time.localtime(now - (days + k * 3) * 86400))
            con.execute("INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?)",
                        (pid, name, stamp, (150 + i * 20) * 1_000_000, 40 + i, 1, stamp, "ok"))
    con.commit()
    con.close()
    print(f"seeded {len(MIXES)} mixes in {mixes}")


if __name__ == "__main__":
    main()
