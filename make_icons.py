# Draws the Atlas app icon: a small treemap in a red ramp on black. Run once; writes static/icons/*.png and atlas.ico.
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "static", "icons")
os.makedirs(OUT, exist_ok=True)
R1, R2, R3, R4 = (122, 22, 24), (160, 32, 34), (200, 54, 52), (232, 120, 112)
# (x0, y0, x1, y1, colour) on a 100 x 100 grid: one big territory, two regions, a few tiles
TILES = [(0, 0, 58, 100, R3), (58, 0, 100, 46, R2), (58, 46, 82, 100, R4), (82, 46, 100, 74, R1), (82, 74, 100, 100, R2),
         (0, 0, 58, 40, R4)]


def icon(size, pad):
    im = Image.new("RGB", (size, size), (0, 0, 0))
    d = ImageDraw.Draw(im)
    inner = size - 2 * pad
    gap = max(2, round(size / 64))
    for x0, y0, x1, y1, c in TILES:
        box = [pad + x0 * inner / 100 + gap / 2, pad + y0 * inner / 100 + gap / 2,
               pad + x1 * inner / 100 - gap / 2, pad + y1 * inner / 100 - gap / 2]
        d.rounded_rectangle(box, radius=max(1, round(size / 96)), fill=c)
    return im


icon(192, 22).save(os.path.join(OUT, "icon-192.png"))
icon(512, 58).save(os.path.join(OUT, "icon-512.png"))
icon(512, 104).save(os.path.join(OUT, "icon-maskable-512.png"))     # safe zone for round phone masks
icon(256, 24).save(os.path.join(HERE, "atlas.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("icons written to", OUT)
