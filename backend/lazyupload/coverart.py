"""Generate square cover art from a track's waveform.

SoundCloud computes a waveform per track and exposes it at `waveform_url` (a PNG); the
same path with a `.json` extension returns the peak samples. We fetch those, draw a
full-width waveform on a dark on-brand canvas, and overlay the artist name + title (plus
an optional LazyCreatives watermark). No local audio file needed — works for any track.
"""
import io
import os
import re

import requests
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Brand palette (matches the renderer's Sloth Blue on near-black surface).
_BG = (11, 14, 19)
_ACCENT = (134, 179, 211)
_TITLE = (200, 210, 220)

# Bold sans candidates, first hit wins; falls back to PIL's bitmap font.
_FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/SFNS.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "C:\\Windows\\Fonts\\arialbd.ttf",
)


def _font(size: int):
    for p in _FONT_CANDIDATES:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _fit_font(text: str, max_size: int, max_w: int, min_size: int = 16):
    """Largest font (from max_size down) at which `text` fits within max_w."""
    s = max_size
    while s > min_size:
        f = _font(s)
        if f.getlength(text) <= max_w:
            return f
        s -= max(2, s // 12)
    return _font(min_size)


def _resample(samples: list, n: int) -> list:
    """Reduce/expand the raw peak list to exactly n bars (max within each bucket)."""
    vals = [abs(float(s)) for s in samples if s is not None]
    if not vals:
        return [0.0] * n
    if len(vals) <= n:
        return vals + [0.0] * (n - len(vals))
    out = []
    step = len(vals) / n
    for i in range(n):
        lo = int(i * step)
        hi = max(lo + 1, int((i + 1) * step))
        out.append(max(vals[lo:hi]))
    return out


def fetch_waveform_samples(waveform_url: str, timeout: int = 15) -> list | None:
    """Peak samples for a track from its SoundCloud waveform_url (the `.json` sibling of
    the PNG). Returns None if unavailable."""
    if not waveform_url:
        return None
    json_url = re.sub(r"\.png(\?.*)?$", ".json", waveform_url)
    if not json_url.endswith(".json"):
        json_url = json_url + ".json"
    try:
        r = requests.get(json_url, timeout=timeout)
        r.raise_for_status()
        data = r.json()
    except Exception:
        return None
    samples = data.get("samples") if isinstance(data, dict) else data
    return samples or None


def _hex_to_rgb(value, fallback=_ACCENT) -> tuple:
    s = (value or "").strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    try:
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except (ValueError, IndexError):
        return fallback


def analyze_audio(path: str, slices: int = 440) -> list | None:
    """Read a local audio file and return per-slice {amp, brightness}: `amp` is the
    peak level (0..1, normalised across the track with headroom + a gentle dynamics
    curve) and `brightness` is the high-vs-low spectral balance (0 = bass-heavy/dark,
    1 = treble-heavy/bright) from a 3-band FFT. Returns None if the file can't be read
    (caller falls back to SoundCloud's amplitude-only waveform). numpy/soundfile are
    imported lazily so the rest of the app doesn't hard-depend on them."""
    try:
        import numpy as np
        import soundfile as sf
    except Exception:
        return None
    try:
        data, sr = sf.read(path, dtype="float32", always_2d=True)
        mono = data.mean(axis=1)
        n = len(mono)
        if n < slices * 4 or sr <= 0:
            return None
        hop = n / slices
        out = []
        for i in range(slices):
            start = int(i * hop)
            seg = mono[start:start + max(1, int(hop))]
            amp = float(np.max(np.abs(seg))) if len(seg) else 0.0
            w = mono[start:start + min(8192, max(256, int(hop)))]
            brightness = 0.0
            if len(w) >= 64:
                spec = np.abs(np.fft.rfft(w * np.hanning(len(w))))
                freqs = np.fft.rfftfreq(len(w), 1.0 / sr)
                low = float(spec[(freqs >= 20) & (freqs < 250)].sum())
                mid = float(spec[(freqs >= 250) & (freqs < 4000)].sum())
                high = float(spec[(freqs >= 4000) & (freqs < 20000)].sum())
                total = low + mid + high + 1e-9
                brightness = max(0.0, min(1.0, (mid * 0.45 + high) / total))
            out.append({"amp": amp, "brightness": brightness})
        mx = max((s["amp"] for s in out), default=0.0) or 1.0
        for s in out:
            s["amp"] = (s["amp"] / mx) ** 0.8  # keep real dynamics, lift the quiet a touch
        return out
    except Exception:
        return None


def _bigger_avatar(url: str) -> str:
    """Swap a SoundCloud avatar URL up to a 500px variant for a usable background."""
    return re.sub(r"-(large|t\d+x\d+|badge|small|tiny|crop|original|t\d+x\d+)\.(jpg|jpeg|png)(\?.*)?$",
                  r"-t500x500.\2", url)


def fetch_avatar_image(url: str, timeout: int = 15):
    """The connected account's profile picture as a PIL image, or None."""
    if not url:
        return None
    for candidate in (_bigger_avatar(url), url):
        try:
            r = requests.get(candidate, timeout=timeout)
            r.raise_for_status()
            return Image.open(io.BytesIO(r.content)).convert("RGBA")
        except Exception:
            continue
    return None


def _cover_fill(im, size: int):
    """Centre-crop to square and resize to `size`."""
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
    return im.resize((size, size), Image.LANCZOS)


def _draw_centered(draw, text, font, cx, cy, fill, stroke=0):
    w = font.getlength(text)
    box = draw.textbbox((0, 0), text, font=font)
    h = box[3] - box[1]
    draw.text((cx - w / 2, cy - h / 2 - box[1]), text, font=font, fill=fill,
              stroke_width=stroke, stroke_fill=(0, 0, 0, 200) if stroke else None)


def render_waveform_cover(samples, name: str, title: str, out_path: str,
                          watermark: bool = True, size: int = 1000, avatar_url: str = None,
                          avatar_img=None, color: str = "#86B3D3", analysis=None) -> str:
    """Draw the cover and save a PNG to out_path. `name` is centered over a full-width
    waveform with `title` beneath; `watermark` adds a small LazyCreatives mark. The profile
    picture (blurred + darkened) is the backdrop: pass a pre-fetched `avatar_img` (PIL image)
    to avoid re-downloading it across a batch, or `avatar_url` to fetch it here.

    `color` is the base waveform hue (hex). When `analysis` (from analyze_audio) is given,
    bars use real per-slice dynamics and are shaded by frequency — bass-heavy slices render
    darker, treble-heavy ones brighter (rekordbox-style depth). Without it, the amplitude-
    only SoundCloud `samples` are drawn in the solid base colour."""
    img = Image.new("RGBA", (size, size), _BG + (255,))
    avatar = avatar_img if avatar_img is not None else (fetch_avatar_image(avatar_url) if avatar_url else None)
    if avatar is not None:
        bg = _cover_fill(avatar, size).convert("RGBA").filter(ImageFilter.GaussianBlur(size * 0.006))
        img = Image.alpha_composite(bg, Image.new("RGBA", (size, size), (8, 10, 14, 175)))
    draw = ImageDraw.Draw(img, "RGBA")

    # full-width waveform, mirrored around the vertical centre
    margin = int(size * 0.07)
    usable_w = size - 2 * margin
    base = _hex_to_rgb(color)
    cy = size / 2
    max_h = size * 0.33

    if analysis:
        # real audio: per-slice dynamics + frequency-driven shading (None = solid hue)
        bars_data = [(max(0.0, min(1.0, s.get("amp", 0.0))), s.get("brightness")) for s in analysis]
    else:
        peaks = _resample(samples or [], 200)
        mx = max(peaks) or 1.0
        bars_data = [(p / mx, None) for p in peaks]

    n = len(bars_data) or 1
    slot = usable_w / n
    bar_w = max(1.5, slot * (0.72 if analysis else 0.66))
    for i, (frac, bright) in enumerate(bars_data):
        h = max(2.0, frac * max_h)
        if bright is None:
            rgb = base
        else:
            f = 0.30 + 0.85 * bright       # bass (dark) -> treble (bright)
            rgb = tuple(min(255, int(c * f)) for c in base)
        x = margin + i * slot + (slot - bar_w) / 2
        draw.rounded_rectangle([x, cy - h, x + bar_w, cy + h], radius=bar_w / 2, fill=rgb + (255,))

    # The name reads over the waveform on its own outline (no dark band — that was
    # flattening the frequency depth through the middle). A slightly heavier stroke keeps
    # it legible over bright/tall sections.
    nm = (name or "").strip().upper() or "UNTITLED ARTIST"
    nf = _fit_font(nm, int(size * 0.13), usable_w)
    _draw_centered(draw, nm, nf, size / 2, cy - size * 0.015, fill=(255, 255, 255), stroke=6)

    ttl = (title or "").strip()
    if ttl:
        tf = _fit_font(ttl, int(size * 0.05), usable_w)
        _draw_centered(draw, ttl, tf, size / 2, cy + size * 0.085, fill=(235, 240, 245), stroke=4)

    # subtle frame around the waveform — soft white outline, low opacity
    fpad = size * 0.04
    draw.rounded_rectangle([size * 0.05, cy - max_h - fpad, size * 0.95, cy + max_h + fpad],
                           radius=size * 0.025, outline=(255, 255, 255, 90),
                           width=max(3, int(size * 0.005)))

    if watermark:
        wf = _font(int(size * 0.027))
        _draw_centered(draw, "lazycreatives · uploader", wf, size / 2, size - size * 0.055,
                       fill=(255, 255, 255, 130))

    img.convert("RGB").save(out_path, "PNG")
    return out_path
