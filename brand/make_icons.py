"""Generate the Uploader app icons from the Lazy Creatives sloth tile.

    python brand/make_icons.py        # requires Pillow

brand/sloth-tile.png is the same sloth icon Backups ships (its electron/build/icon.png).
Uploader adds a small upload-arrow badge so the two apps are easy to tell apart in
the Dock and taskbar. Writes electron/build/{icon.png, icon.ico}; the tray icons
(tray.png, tray@2x.png) are copied straight from Backups. Re-run after any logo tweak.
"""
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "electron" / "build"

ACCENT = (134, 179, 211, 255)      # Sloth Blue, --accent
INK = (11, 22, 32, 255)            # --accent-ink
RING = (11, 12, 15, 255)           # matches the tile's dark base
SS = 4                             # supersample for smooth edges


def badge(tile: Image.Image) -> Image.Image:
    size = tile.width
    k = size / 1024 * SS
    big = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    cx = cy = 800 * k
    r, ring = 170 * k, 28 * k
    d.ellipse([cx - r - ring, cy - r - ring, cx + r + ring, cy + r + ring], fill=RING)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ACCENT)

    w = 46 * k
    d.rounded_rectangle([cx - w / 2, cy - 60 * k, cx + w / 2, cy + 95 * k], radius=w / 2, fill=INK)
    tip, arm = (cx, cy - 105 * k), 110 * k * 0.78
    for end in ((cx - arm, tip[1] + arm), (cx + arm, tip[1] + arm)):
        d.line([tip, end], fill=INK, width=int(w))
        for (x, y) in (tip, end):
            d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=INK)

    out = tile.copy()
    out.alpha_composite(big.resize((size, size), Image.LANCZOS))
    return out


def main() -> None:
    tile = Image.open(HERE / "sloth-tile.png").convert("RGBA").resize((1024, 1024), Image.LANCZOS)
    icon = badge(tile)
    OUT.mkdir(parents=True, exist_ok=True)
    icon.save(OUT / "icon.png")
    icon.save(OUT / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"wrote icons to {OUT}")


if __name__ == "__main__":
    main()
