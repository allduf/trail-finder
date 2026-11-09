"""Late-summer mountain photos for the Summer map (alex 2026-11-09: "use some image around september for the summer
map"; picked "AI-sharpened, Sea to Sky first"). Esri's sharp summer photo is from early July in many alpine places
(Brandywine/Metal Dome: 2017-07-05), so the meadows and ridges show melting snow all summer. This draws the same
zoom-11 blocks as sharpen.py from LATE AUGUST / EARLY SEPTEMBER Sentinel-2 passes (snow gone except glaciers),
4x sharpened to 2.5 m by SEN2SR Lite, with a summer tone (like the satellite's true-colour picture, not Winter's
snow curve), and see-through below the trees: only the alpine (fading in from FADE_LO to FADE_HI metres, Mapterhorn
heights) covers Esri, so valleys, towns and forest keep Esri's sharper photo.
    SCENES=summer-scenes.json python3 scripts/winter-photos/summer.py <block-dir> blocks.json
    python3 scripts/winter-photos/summer.py --tiles <block-dir> <site>     (zoom 15 webp + summer.json)
Passes: OUT=summer-scenes.json WHEN=2025-08-15T00:00:00Z/2025-09-20T23:59:59Z MAXCLOUD=30 KEEP=3 scenes.py blocks.json
(the Sea to Sky list is kept next to this file). Needs the same as sharpen.py (torch CPU, sen2sr, mlstac, rasterio).
Published from the orphan branch summer-photos (one commit, trail-finder-summer/ + _headers): its own workflow there
deploys it to the Cloudflare Pages project trailfinder-summer (https://trailfinder-summer.pages.dev/trail-finder-summer/).
After a rebuild, bump SUMMER_REV in map3d.js (phones keep photos 30 days).
"""
import io, json, os, sys, urllib.request
import numpy as np
from PIL import Image, ImageFilter
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
import sharpen
from sharpen import composite, W
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.transform import from_bounds

FADE_LO, FADE_HI = float(os.environ.get("FADE_LO", 1250)), float(os.environ.get("FADE_HI", 1450))
GAIN, GAMMA = float(os.environ.get("GAIN", 0.28)), float(os.environ.get("GAMMA", 1.5))

def tone(r):
    """Reflectance to screen like a summer satellite photo: 0 to GAIN fills the range, a gentle gamma lifts the
    shadows, glaciers and bright rock roll off instead of clipping hard."""
    v = np.clip(r / GAIN, 0, None)
    v = np.where(v > 0.85, 0.85 + (1 - np.exp(-(v - 0.85) * 4)) * 0.15, v)
    return np.clip(v ** (1 / GAMMA) * 255 + 0.5, 0, 255).astype(np.uint8)

def heights(bx, by):
    """Ground height (m) over zoom-11 block bx, by: Mapterhorn's zoom-12 tiles (terrarium), 1024 px."""
    out = np.zeros((1024, 1024), np.float32)
    for i in (0, 1):
        for j in (0, 1):
            url = f"https://tiles.mapterhorn.com/12/{bx * 2 + i}/{by * 2 + j}.webp"
            for _ in range(4):
                try:
                    px = np.asarray(Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "TrailFinder-summer-photos"}), timeout=60).read())).convert("RGB"), np.float32)
                    break
                except Exception as e: err = e
            else: raise err
            out[j * 512:(j + 1) * 512, i * 512:(i + 1) * 512] = px[..., 0] * 256 + px[..., 1] + px[..., 2] / 256 - 32768
    return out

def box(a, r):
    """Mean of a over a (2r+1) square around each pixel (edges clamped)."""
    p = np.pad(a, r, mode="edge").cumsum(0).cumsum(1)
    p = np.pad(p, ((1, 0), (1, 0)))
    k = 2 * r + 1
    return (p[k:, k:] - p[:-k, k:] - p[k:, :-k] + p[:-k, :-k]) / (k * k)

def fill(rgbn, n):
    """Pixels no clear pass saw (n 0) get the clear pixels around them, wider and wider until filled: left as 0 they
    came out as black specks after sharpening (next to glaciers, where the cloud test is unsure)."""
    have = (n > 0).astype(np.float32)
    out = rgbn.copy()
    r = 2
    while (have < 1).any() and r < 256:
        w = box(have, r)
        for c in range(out.shape[0]):
            v = box(out[c] * have, r) / np.maximum(w, 1e-6)
            out[c] = np.where(have > 0, out[c], np.where(w > 0, v, 0))
        have = np.maximum(have, (w > 0).astype(np.float32))
        r *= 2
    return out

def block(bx, by):
    # Heights first: a block with no ground above the trees (sea, valleys) needs no satellite download at all.
    h = heights(bx, by)
    if h.max() <= FADE_LO: return "low"
    up = np.asarray(Image.fromarray(h).resize((W, W), Image.BILINEAR), np.float32)
    fade = np.clip((up - FADE_LO) / (FADE_HI - FADE_LO), 0, 1)
    got = composite(bx, by)
    if got is None: return None
    rgbn, n, grid, crs, (l, b, r, t) = got
    sr = sharpen.sharpen(fill(rgbn, n))
    fine = rasterio.Affine(grid.a / 4, 0, grid.c, 0, grid.e / 4, grid.f)
    dst_t = from_bounds(l, b, r, t, W, W)
    rgb = np.zeros((3, W, W), np.float32)
    for k in range(3):
        reproject(sr[k], rgb[k], src_transform=fine, src_crs=crs, dst_transform=dst_t, dst_crs="EPSG:3857", resampling=Resampling.bilinear)
    seen = np.zeros((W, W), np.float32)
    # Small unseen spots (filled above) count as seen: only big unseen areas let Esri show through.
    reproject((box((n > 0).astype(np.float32), 6) > 0).astype(np.float32), seen, src_transform=grid, src_crs=crs, dst_transform=dst_t, dst_crs="EPSG:3857", resampling=Resampling.bilinear)
    seen = np.asarray(Image.fromarray((seen * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), np.float32) / 255
    fade = fade * fade * (3 - 2 * fade)
    img = np.zeros((W, W, 4), np.uint8)
    img[..., :3] = tone(rgb).transpose(1, 2, 0)
    img[..., 3] = np.clip(np.clip((seen - 0.16) / 0.69, 0, 1) * fade * 255, 0, 255).astype(np.uint8)
    return img

def one(args):
    out, x, y = args
    img = block(x, y)
    if img is None or isinstance(img, str): open(f"{out}/{x}_{y}.empty", "w").close()
    else: Image.fromarray(img, "RGBA").save(f"{out}/{x}_{y}.png")
    return x, y

def tiles(src, site, quality=72):
    done = []
    for f in sorted(os.listdir(src)):
        if not f.endswith(".png"): continue
        bx, by = map(int, f[:-4].split("_"))
        im = Image.open(os.path.join(src, f)).convert("RGBA")
        for i in range(16):
            for j in range(16):
                t = im.crop((i * 256, j * 256, i * 256 + 256, j * 256 + 256))
                if t.getextrema()[3][1] == 0: continue
                os.makedirs(f"{site}/15/{bx * 16 + i}", exist_ok=True)
                t.save(f"{site}/15/{bx * 16 + i}/{by * 16 + j}.webp", "WEBP", quality=quality, method=6)
        done.append([bx, by])
    # Zooms 14 to 11, each from the four tiles under it: far views need no zoom-15 tiles shrunk on the phone.
    for z in range(14, 10, -1):
        kids = {}
        for xs in os.listdir(f"{site}/{z + 1}"):
            for ys in os.listdir(f"{site}/{z + 1}/{xs}"):
                x, y = int(xs), int(ys.split(".")[0])
                kids.setdefault((x >> 1, y >> 1), []).append((x, y))
        for (px, py), ks in kids.items():
            big = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
            for x, y in ks: big.paste(Image.open(f"{site}/{z + 1}/{x}/{y}.webp").convert("RGBA"), ((x & 1) * 256, (y & 1) * 256))
            t = big.resize((256, 256), Image.LANCZOS)
            if t.getextrema()[3][1] == 0: continue
            os.makedirs(f"{site}/{z}/{px}", exist_ok=True)
            t.save(f"{site}/{z}/{px}/{py}.webp", "WEBP", quality=quality, method=6)
    open(os.path.join(os.path.dirname(os.path.abspath(site)), "_headers"), "w").write("/*\n  Access-Control-Allow-Origin: *\n")
    json.dump(sorted(done), open(os.path.join(site, "summer.json"), "w"), separators=(",", ":"))
    print(len(done), "blocks")

if __name__ == "__main__":
    if sys.argv[1] == "--tiles": tiles(sys.argv[2], sys.argv[3]); sys.exit()
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    todo = [(out, *b) for b in json.load(open(sys.argv[2]))
            if not os.path.exists(f"{out}/{b[0]}_{b[1]}.png") and not os.path.exists(f"{out}/{b[0]}_{b[1]}.empty")]
    if len(sys.argv) > 4: todo = [(out, int(sys.argv[3]), int(sys.argv[4]))]
    print("blocks", len(todo), flush=True)
    from multiprocessing import Pool
    with Pool(int(os.environ.get("WORKERS", 4))) as pool:
        for k, (x, y) in enumerate(pool.imap_unordered(one, todo)):
            print("block", x, y, len(todo) - k - 1, "left", flush=True)
