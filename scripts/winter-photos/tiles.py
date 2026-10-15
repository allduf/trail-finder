"""Cuts build.mjs's 2048 px blocks into data/winter/{z}/{x}/{y}.webp, zooms 7 to 13."""
import os, sys
from PIL import Image
src = sys.argv[1] if len(sys.argv) > 1 else "winter-blocks"
dst = os.path.join(os.path.dirname(__file__), "../../data/winter")
tiles = {}   # zoom 13 tiles, by (x, y)
LIFT = [min(255, round(255 * (v / 255) ** 0.8 * 1.06)) for v in range(256)]
def save(z, x, y, im):
    if im.getextrema()[3][1] == 0: return   # all see-through: leave it out, the summer photos show
    os.makedirs(f"{dst}/{z}/{x}", exist_ok=True)
    im.save(f"{dst}/{z}/{x}/{y}.webp", "WEBP", quality=65, method=6)
for f in sorted(os.listdir(src)):
    if not f.endswith(".png"): continue
    bx, by = map(int, f[:-4].split("_"))
    block = Image.open(os.path.join(src, f)).convert("RGBA")
    r, g, b, a = block.split()   # winter sun is low, so the raw photos are dark: lift the shadows a little
    block = Image.merge("RGBA", [ch.point(LIFT) for ch in (r, g, b)] + [a])
    for i in range(8):
        for j in range(8):
            t = block.crop((i * 256, j * 256, i * 256 + 256, j * 256 + 256))
            tiles[(bx * 8 + i, by * 8 + j)] = t
            save(13, bx * 8 + i, by * 8 + j, t)
for z in range(12, 6, -1):
    up, tiles = tiles, {}
    for (x, y) in {(x >> 1, y >> 1) for (x, y) in up}:
        im = Image.new("RGBA", (512, 512))
        for dx in (0, 1):
            for dy in (0, 1):
                c = up.get((2 * x + dx, 2 * y + dy))
                if c: im.paste(c, (dx * 256, dy * 256))
        t = im.resize((256, 256), Image.LANCZOS)
        tiles[(x, y)] = t
        save(z, x, y, t)
    print("zoom", z, len(tiles))
