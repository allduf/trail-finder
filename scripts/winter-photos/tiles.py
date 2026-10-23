"""Cuts build.py's 2048 px blocks (zoom-11 tiles) into data/winter/{z}/{x}/{y}.webp, zooms 8 to 14, and lists the
blocks in data/winter/blocks.json (the 3D map says when a view has no winter photos).
Adds to what's already in data/winter: zoom 14 comes from the new blocks, and every zoom 8-13 tile above them is
redrawn from its four children on disk, so new areas join old ones."""
import json, os, sys
from multiprocessing import Pool
from PIL import Image
src = sys.argv[1] if len(sys.argv) > 1 else "winter-blocks"
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data/winter")

def save(z, x, y, im):
    if im.getextrema()[3][1] == 0: return False   # all see-through: leave it out, the summer photos show
    os.makedirs(f"{dst}/{z}/{x}", exist_ok=True)
    im.save(f"{dst}/{z}/{x}/{y}.webp", "WEBP", quality=70, method=6)
    return True

def cut(f):
    bx, by = map(int, f[:-4].split("_"))
    block = Image.open(os.path.join(src, f)).convert("RGBA")
    for i in range(8):
        for j in range(8):
            save(14, bx * 8 + i, by * 8 + j, block.crop((i * 256, j * 256, i * 256 + 256, j * 256 + 256)))
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
        print("zoom 14 from", len(blocks), "blocks")
        touched = {(x * 8 + i, y * 8 + j) for x, y in blocks for i in range(8) for j in range(8)}
        for z in range(13, 7, -1):
            touched = {(x >> 1, y >> 1) for x, y in touched}
            pool.map(parent, [(z, x, y) for x, y in touched])
            print("zoom", z, len(touched))
    listed = os.path.join(dst, "blocks.json")
    have = set(map(tuple, json.load(open(listed)))) if os.path.exists(listed) else set()
    have |= set(blocks)
    json.dump(sorted(have), open(listed, "w"), separators=(",", ":"))
