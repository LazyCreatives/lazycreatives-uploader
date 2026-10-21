"""Only songs and real pictures are ever sent to SoundCloud, whatever path arrives."""
import pytest

from lazyupload.soundcloud import _image, _song


def test_only_audio_files_post(tmp_path):
    song = tmp_path / "Night Drive.wav"
    song.write_bytes(b"RIFF....WAVE")
    assert _song(str(song)) == song
    secret = tmp_path / "id_rsa"
    secret.write_text("private")
    for p in (secret, tmp_path / "missing.wav", tmp_path):
        with pytest.raises(RuntimeError):
            _song(str(p))


def test_only_real_pictures_go_as_covers(tmp_path):
    png = tmp_path / "cover.png"
    png.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 20)
    webp = tmp_path / "cover.webp"
    webp.write_bytes(b"RIFF\x00\x00\x00\x00WEBPVP8 ")
    assert _image(str(png)) == png and _image(str(webp)) == webp
    fake = tmp_path / "notes.jpg"
    fake.write_text("passwords")
    assert _image(str(fake)) is None and _image(str(tmp_path / "gone.png")) is None and _image("") is None
