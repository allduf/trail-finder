"""Cuts build.py's 2048 px blocks (zoom-11 tiles) into data/winter/{z}/{x}/{y}.webp, zooms 8 to 14."""
import os, sys
from PIL import Image
src = sys.argv[1] if len(sys.argv) > 1 else "winter-blocks"
dst = os.path.join(os.path.dirname(__file__), "../../data/winter")
tiles = {}   # zoom 14 tiles (8 x 8 per block), by (x, y)
def save(z, x, y, im):
    if im.getextrema()[3][1] == 0: return   # all see-through: leave it out, the summer photos show
    os.makedirs(f"{dst}/{z}/{x}", exist_ok=True)
    im.save(f"{dst}/{z}/{x}/{y}.webp", "WEBP", quality=70, method=6)
for f in sorted(os.listdir(src)):
    if not f.endswith(".png"): continue
    bx, by = map(int, f[:-4].split("_"))
    block = Image.open(os.path.join(src, f)).convert("RGBA")
    for i in range(8):
        for j in range(8):
            t = block.crop((i * 256, j * 256, i * 256 + 256, j * 256 + 256))
            tiles[(bx * 8 + i, by * 8 + j)] = t
            save(14, bx * 8 + i, by * 8 + j, t)
for z in range(13, 7, -1):
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
