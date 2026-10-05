"""Song-name cleaning, kept identical to Backups' so both apps agree on a song's project."""
from lazyupload.projectmeta import normalize


def test_dates_tempos_and_keys_are_left_out():
    assert normalize("2026-10-01 Night Drive.wav") == "night drive"
    assert normalize("Night Drive 07.10.26.wav") == "night drive"
    assert normalize("Night_Drive_20261001.wav") == "night drive"
    assert normalize("Night Drive 124bpm Amin.wav") == "night drive"
    assert normalize("Sunset (128 BPM) F#m.mp3") == "sunset"
    assert normalize("Night Drive.opus") == "night drive"
    assert normalize("I Am.wav") == "i am"
    assert normalize("Night Drive final v2.wav") == "night drive"
