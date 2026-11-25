"""Draws the Profile Radar icon at 16, 32, 48 and 128 px into img/.

Requires Pillow (pip install pillow). Run from anywhere: python3 scripts/make_icons.py
Each size is drawn at 8x and downsampled, and the smallest sizes use fewer
details so the mark still reads in the browser toolbar.
"""
import math
import os

from PIL import Image, ImageDraw

BG = (21, 25, 30, 255)          # --head-bg
RING = (60, 207, 180)           # --accent (dark theme)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'img')
SCALE = 8


def draw(size):
    S = size * SCALE
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Full-bleed rounded square.
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.2), fill=BG)

    cx = cy = S / 2
    r_out = S * 0.40
    small = size <= 16
    stroke = max(int(S * (0.075 if small else 0.05)), 1)

    # Sweep wedge: a fan of thin slices fading out behind the leading edge.
    lead = -50  # degrees, PIL angles grow clockwise from 3 o'clock
    span = 80 if small else 100
    steps = 40
    for i in range(steps):
        a0 = lead - span * (i + 1) / steps
        a1 = lead - span * i / steps + 0.6
        alpha = int(170 * (1 - i / steps))
        layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(layer).pieslice([cx - r_out, cy - r_out, cx + r_out, cy + r_out], a0, a1, fill=RING + (alpha,))
        img = Image.alpha_composite(img, layer)
    d = ImageDraw.Draw(img)

    # Rings.
    d.ellipse([cx - r_out, cy - r_out, cx + r_out, cy + r_out], outline=RING + (255,), width=stroke)
    if not small:
        r_mid = r_out * 0.55
        d.ellipse([cx - r_mid, cy - r_mid, cx + r_mid, cy + r_mid], outline=RING + (150,), width=max(stroke * 3 // 4, 1))

    # Leading edge of the sweep.
    ex = cx + r_out * math.cos(math.radians(lead))
    ey = cy + r_out * math.sin(math.radians(lead))
    d.line([cx, cy, ex, ey], fill=RING + (255,), width=stroke)

    # Center and one blip.
    rc = S * (0.07 if small else 0.055)
    d.ellipse([cx - rc, cy - rc, cx + rc, cy + rc], fill=RING + (255,))
    bx = cx + r_out * 0.70 * math.cos(math.radians(lead - 32))
    by = cy + r_out * 0.70 * math.sin(math.radians(lead - 32))
    rb = S * (0.08 if small else 0.058)
    d.ellipse([bx - rb, by - rb, bx + rb, by + rb], fill=(255, 255, 255, 255))

    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = os.path.join(OUT, 'icon%d.png' % size)
        draw(size).save(path, optimize=True)
        print('wrote', os.path.normpath(path))
