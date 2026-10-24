"""Cuts build.py's 2048 px blocks (zoom-11 tiles) into data/winter/{z}/{x}/{y}.webp, zooms 6 to 14, and lists the
blocks in data/winter/blocks.json (the 3D map says when a view has no winter photos).
Adds to what's already in data/winter: the top zoom comes from the new blocks, and every tile above them down to
zoom 6 is redrawn from its four children on disk, so new areas join old ones.
TOP=13 QUALITY=55 python3 tiles.py <dir>: blocks away from the riding areas, which only go to zoom 13 (the 3D map
enlarges them up close), so the website stays under GitHub Pages' 1 GB."""
import json, os, sys
from multiprocessing import Pool
from PIL import Image
src = sys.argv[1] if len(sys.argv) > 1 else "winter-blocks"
TOP, QUALITY = int(os.environ.get("TOP", 14)), int(os.environ.get("QUALITY", 70))
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data/winter")

def save(z, x, y, im, quality=70):
    if im.getextrema()[3][1] == 0: return False   # all see-through: leave it out, the summer photos show
    os.makedirs(f"{dst}/{z}/{x}", exist_ok=True)
    im.save(f"{dst}/{z}/{x}/{y}.webp", "WEBP", quality=quality, method=6)
    return True

def cut(f):
    bx, by = map(int, f[:-4].split("_"))
    block, k = Image.open(os.path.join(src, f)).convert("RGBA"), 1 << (TOP - 11)
    if k < 8: block = block.resize((k * 256, k * 256), Image.LANCZOS)
    for i in range(k):
        for j in range(k):
            save(TOP, bx * k + i, by * k + j, block.crop((i * 256, j * 256, i * 256 + 256, j * 256 + 256)), QUALITY)
    return bx, by

def parent(job):
    z, x, y = job
    im, any_ = Image.new("RGBA", (512, 512)), False
    for dx in (0, 1):
        for dy in (0, 1):
            p = f"{dst}/{z + 1}/{2 * x + dx}/{2 * y + dy}.webp"
            if os.path.exists(p): im.paste(Image.open(p).convert("RGBA"), (dx * 256, dy * 256)); any_ = True
    return any_ and save(z, x, y, im.resize((256, 256), Image.LANCZOS))

if __name__ == "__main__":
    files = sorted(f for f in os.listdir(src) if f.endswith(".png"))
    with Pool() as pool:
        blocks = pool.map(cut, files)
        print("zoom", TOP, "from", len(blocks), "blocks")
        k = 1 << (TOP - 11)
        touched = {(x * k + i, y * k + j) for x, y in blocks for i in range(k) for j in range(k)}
        for z in range(TOP - 1, 5, -1):
            touched = {(x >> 1, y >> 1) for x, y in touched}
            pool.map(parent, [(z, x, y) for x, y in touched])
            print("zoom", z, len(touched))
    listed = os.path.join(dst, "blocks.json")
    have = set(map(tuple, json.load(open(listed)))) if os.path.exists(listed) else set()
    have |= set(blocks)
    json.dump(sorted(have), open(listed, "w"), separators=(",", ":"))
