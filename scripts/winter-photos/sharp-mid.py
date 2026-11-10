"""Zooms 11-14 of the AI-sharpened Winter photos, made once from the zoom-15 ones (alex 2026-11-09, iPhone recording
over Brandywine and Mount Fee: "Long time to load when you look at a different zone").
    python3 scripts/winter-photos/sharp-mid.py <trail-finder-winter2 checkout> <out>

Since 2026-11-07 (map3d.js SHARP_MID, winter-fill.js sharpTile) the phone made each zoom-13 tile from 16 zoom-15
sharpened photos and each zoom-14 tile from 4: up to ~230 downloads after every move over the Sea to Sky, ~18 s before
the ground in front was all there on a slow phone connection. These are the same pictures shrunk here once (one
download a tile), and zooms 11 and 12 too (they were the plain Winter photo with Esri's photo filled into its cloudy
holes). Pieces that don't exist (all cloud) stay see-through, like the few cloudy holes: the app fills those with the
filled Winter photo under them, as before.
Writes <out>/trail-finder-winter2/{z}/{x}/{y}.webp + sharp-mid.json (the zoom-11 squares). Published from the
orphan branch sharp-mid-photos by .github/workflows/sharp-mid-photos.yml to trailfinder-sharpmid.pages.dev.
About 11,400 tiles for the 134 squares (Cloudflare Pages takes 20,000 files a project).
"""
import json, os, sys
from concurrent.futures import ProcessPoolExecutor
from PIL import Image

T = 256

def square(args):
    site, out, bx, by = args
    # The square's 16 x 16 zoom-15 tiles as one 4096 px picture (see-through where a tile is missing).
    big = Image.new("RGBA", (16 * T, 16 * T), (0, 0, 0, 0))
    for i in range(16):
        for j in range(16):
            f = f"{site}/15/{bx * 16 + i}/{by * 16 + j}.webp"
            if os.path.exists(f): big.paste(Image.open(f).convert("RGBA"), (i * T, j * T))
    n = 0
    for z in (14, 13, 12, 11):
        k = 1 << (z - 11)            # tiles a side at this zoom
        size = 16 * T // k           # zoom-15 pixels per tile side
        for i in range(k):
            for j in range(k):
                t = big.crop((i * size, j * size, (i + 1) * size, (j + 1) * size))
                if t.getextrema()[3][1] == 0: continue
                # Area average (Pillow mixes RGBA weighted by how solid each pixel is): no ringing on the snow edges.
                t = t.resize((T, T), Image.Resampling.BOX)
                d = f"{out}/trail-finder-winter2/{z}/{bx * k + i}"
                os.makedirs(d, exist_ok=True)
                t.save(f"{d}/{by * k + j}.webp", "WEBP", quality=75, method=6)
                n += 1
    return bx, by, n

if __name__ == "__main__":
    site, out = sys.argv[1], sys.argv[2]
    squares = json.load(open(f"{site}/sharp.json"))
    with ProcessPoolExecutor(int(os.environ.get("WORKERS", os.cpu_count() or 2))) as ex:
        total = sum(n for _, _, n in ex.map(square, [(site, out, x, y) for x, y in squares]))
    os.makedirs(f"{out}/trail-finder-winter2", exist_ok=True)
    json.dump(squares, open(f"{out}/trail-finder-winter2/sharp-mid.json", "w"), separators=(",", ":"))
    print(f"{len(squares)} squares, {total} tiles")
