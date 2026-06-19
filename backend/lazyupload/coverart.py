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
                          avatar_img=None) -> str:
    """Draw the cover and save a PNG to out_path. `name` is centered over a full-width
    waveform with `title` beneath; `watermark` adds a small LazyCreatives mark. The profile
    picture (blurred + darkened) is the backdrop: pass a pre-fetched `avatar_img` (PIL image)
    to avoid re-downloading it across a batch, or `avatar_url` to fetch it here."""
    img = Image.new("RGBA", (size, size), _BG + (255,))
    avatar = avatar_img if avatar_img is not None else (fetch_avatar_image(avatar_url) if avatar_url else None)
    if avatar is not None:
        bg = _cover_fill(avatar, size).convert("RGBA").filter(ImageFilter.GaussianBlur(size * 0.006))
        img = Image.alpha_composite(bg, Image.new("RGBA", (size, size), (8, 10, 14, 175)))
    draw = ImageDraw.Draw(img, "RGBA")

    # full-width waveform, mirrored around the vertical centre
    margin = int(size * 0.07)
    usable_w = size - 2 * margin
    bars = 200                       # denser = more definition
    peaks = _resample(samples or [], bars)
    mx = max(peaks) or 1.0
    slot = usable_w / bars
    bar_w = max(2.0, slot * 0.66)
    cy = size / 2
    max_h = size * 0.33
    for i, p in enumerate(peaks):
        h = max(3.0, (p / mx) * max_h)
        x = margin + i * slot + (slot - bar_w) / 2
        draw.rounded_rectangle([x, cy - h, x + bar_w, cy + h], radius=bar_w / 2,
                               fill=_ACCENT + (255,))      # full opacity, crisper

    # a lighter central band so the name reads over the waveform without hiding it
    band = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bh = size * 0.30
    ImageDraw.Draw(band).rectangle([0, cy - bh / 2, size, cy + bh / 2], fill=(11, 14, 19, 110))
    img = Image.alpha_composite(img, band)
    draw = ImageDraw.Draw(img, "RGBA")

    nm = (name or "").strip().upper() or "UNTITLED ARTIST"
    nf = _fit_font(nm, int(size * 0.13), usable_w)
    _draw_centered(draw, nm, nf, size / 2, cy - size * 0.015, fill=(255, 255, 255), stroke=5)

    ttl = (title or "").strip()
    if ttl:
        tf = _fit_font(ttl, int(size * 0.05), usable_w)
        _draw_centered(draw, ttl, tf, size / 2, cy + size * 0.085, fill=_TITLE, stroke=3)

    # clear border framing the waveform
    fpad = size * 0.04
    draw.rounded_rectangle([size * 0.05, cy - max_h - fpad, size * 0.95, cy + max_h + fpad],
                           radius=size * 0.025, outline=_ACCENT + (255,),
                           width=max(4, int(size * 0.008)))

    if watermark:
        wf = _font(int(size * 0.027))
        _draw_centered(draw, "lazycreatives · uploader", wf, size / 2, size - size * 0.055,
                       fill=(255, 255, 255, 130))

    img.convert("RGB").save(out_path, "PNG")
    return out_path
