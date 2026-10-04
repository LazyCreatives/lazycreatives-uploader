"""Generate the app icons from the LazyCreatives Uploader shield mark.

    python brand/make_icons.py        # requires Pillow

Writes electron/build/{icon.png, icon.ico, tray.png, tray@2x.png}. Keeping this as
code means the brand mark and the shipped icons can never drift — re-run after any
logo tweak. Mirrors brand/logo-mark.svg (shield + gold waveform + green up-arrow).
"""
from pathlib import Path

from PIL import Image, ImageDraw

GOLD = (245, 196, 81, 255)
GOLD_SOFT = (245, 196, 81, 205)
GREEN = (74, 222, 128, 255)
FILL = (20, 23, 28, 255)

OUT = Path(__file__).resolve().parent.parent / "electron" / "build"
SIZE = 1024
S = 800 / 72                       # scale the 64x72 design space into the canvas
OX = (SIZE - 64 * S) / 2
OY = (SIZE - 72 * S) / 2


def P(x, y):
    return (OX + x * S, OY + y * S)


def bezier(p0, p1, p2, p3, n=14):
    out = []
    for i in range(1, n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1]
        out.append((x, y))
    return out


def round_line(draw, a, b, width, fill):
    """A line with round caps (Pillow lines are otherwise square-capped)."""
    draw.line([a, b], fill=fill, width=width)
    r = width / 2
    for (x, y) in (a, b):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def build() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    shield = [(32, 3), (57, 13), (57, 31)]
    shield += bezier((57, 31), (57, 47), (47.5, 57.5), (32, 61.5))
    shield += bezier((32, 61.5), (16.5, 57.5), (7, 47), (7, 31))
    shield += [(7, 13)]
    poly = [P(*pt) for pt in shield]
    d.polygon(poly, fill=FILL)
    d.line(poly + [poly[0]], fill=GOLD, width=int(2.4 * S), joint="curve")

    wf = int(3.2 * S)
    round_line(d, P(17, 36), P(17, 42), wf, GOLD)
    round_line(d, P(23, 31), P(23, 47), wf, GOLD)
    round_line(d, P(47, 33), P(47, 45), wf, GOLD_SOFT)

    aw = int(4 * S)
    round_line(d, P(32, 47), P(32, 31), aw, GREEN)
    round_line(d, P(25, 38), P(32, 31), aw, GREEN)
    round_line(d, P(32, 31), P(39, 38), aw, GREEN)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    img = build()
    img.resize((512, 512), Image.LANCZOS).save(OUT / "icon.png")
    img.save(OUT / "icon.ico",
             sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    img.resize((32, 32), Image.LANCZOS).save(OUT / "tray.png")
    img.resize((64, 64), Image.LANCZOS).save(OUT / "tray@2x.png")
    print("wrote:", ", ".join(p.name for p in sorted(OUT.glob("*"))))


if __name__ == "__main__":
    main()
