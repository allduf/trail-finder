"""Winter photos for ALL of Canada, far view (alex 2026-11-11, zoomed out over BC and the Yukon: "can we add winter
map there", then "should we do the same for the rest of Canada?"). The detailed Winter photos (build.py, sharpen.py)
only cover squares around ski spots, so zoomed out they were one block in southern BC and dots elsewhere. This draws
every zoom-7 tile over Canada (south of 70 N) at zoom 10 (about 80 m a pixel at 55 N, like the satellite's own
smaller copies, so little is downloaded), from the same free Sentinel-2 passes on AWS, with build.py's colours and
cloud removal. The 3D map shows them under the detailed photos (map3d.js winwide).
    python3 scripts/winter-photos/wide.py <out-dir> tiles.json        (a list of zoom-7 [x, y] tiles)
writes <out-dir>/{z}/{x}/{y}.webp for zooms 7 to 10, and <out-dir>/done/<x>_<y> (empty file = nothing clear).
python3 wide.py --low <out-dir> then draws zooms 3 to 6 from the zoom-7 tiles."""
import json, math, os, sys, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
import warnings
import numpy as np
import rasterio
from rasterio.warp import reproject, transform_bounds, Resampling
from rasterio.transform import from_bounds
from rasterio.windows import from_bounds as window_from
from PIL import Image

warnings.filterwarnings("ignore", category=rasterio.errors.NotGeoreferencedWarning)
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import tone, CLOUDY, CLOUD_SWIR, merc   # the same colours and cloud rules as the detailed photos

SEARCH = "https://earth-search.aws.element84.com/v1/search"
BUCKET = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/"
S2 = "/vsicurl/" + BUCKET
W = 2048                       # a zoom-7 tile at zoom-10 detail (8 x 8 tiles of 256 px)
KEEP = int(os.environ.get("KEEP", 14))          # least cloudy passes kept per 100 km Sentinel-2 square
QUALITY = int(os.environ.get("QUALITY", 72))

def lnglat(x, y, z):
    n = 2 ** z
    return x / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))

def when(lat):
    """Last winter, while the snow is still down and the sun is high enough to see it (the far north is dark in
    December and January, the south melts first), and the winter before for more chances at a clear day: cloudy
    places like Smithers had only a handful of passes with less than 80% cloud in one winter."""
    a, b = ("01-01", "03-15") if lat < 50 else ("01-15", "04-01") if lat < 56 else ("02-01", "04-15") if lat < 62 else ("03-01", "05-05")
    return [f"{y}-{a}T00:00:00Z/{y}-{b}T23:59:59Z" for y in (2026, 2025)]

def search(bbox, dates):
    body = {"collections": ["sentinel-2-l2a"], "bbox": bbox, "datetime": dates, "limit": 100,
            "query": {"eo:cloud_cover": {"lt": 90}},
            "fields": {"include": ["id", "bbox", "properties.eo:cloud_cover", "assets.red.href"], "exclude": ["geometry"]}}
    out, url = [], SEARCH
    for _ in range(30):   # pages of 100
        req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json"})
        for t in range(5):
            try: r = json.load(urllib.request.urlopen(req, timeout=90)); break
            except Exception:
                if t == 4: raise
        out += r["features"]
        nxt = [l for l in r.get("links", []) if l.get("rel") == "next"]
        if not nxt: break
        url, body = nxt[0].get("href", SEARCH), nxt[0].get("body", body)
    return out

def passes_for(tx, ty):
    w, n = lnglat(tx, ty, 7); e, s = lnglat(tx + 1, ty + 1, 7)
    by_tile = defaultdict(list)
    for f in (f for d in when((n + s) / 2) for f in search([w, s, e, n], d)):
        href = f["assets"]["red"]["href"]
        if not href.startswith(BUCKET): continue
        by_tile[f["id"].split("_")[1]].append({"id": f["id"], "dir": href[len(BUCKET):-len("B04.tif")],
                                                "cloud": f["properties"]["eo:cloud_cover"]})
    # Each Sentinel-2 square's least cloudy passes (one of each day: some days come twice, from two processings).
    keep = []
    for v in by_tile.values():
        seen, best = set(), []
        for p in sorted(v, key=lambda p: p["cloud"]):
            day = p["id"].split("_")[2]
            if day in seen: continue
            seen.add(day); best.append(p)
        keep += best[:KEEP]
    return keep

def read(p, l, b, r, t, dst_t):
    """One pass, drawn on the zoom-7 canvas from the satellite's own smaller copies (80 m), or None."""
    bands = []
    for name in ("B04", "B03", "B02", "SCL", "B11"):
        with rasterio.open(S2 + p["dir"] + name + ".tif") as d:
            ub = transform_bounds("EPSG:3857", d.crs, l, b, r, t)
            win = window_from(*ub, d.transform).round_offsets().round_lengths()
            win = win.intersection(rasterio.windows.Window(0, 0, d.width, d.height))
            f = 8 if d.res[0] < 15 else 4                 # 10 m or 20 m bands -> 80 m
            h, wd = max(1, int(win.height // f)), max(1, int(win.width // f))
            a = d.read(1, window=win, out_shape=(h, wd),
                       resampling=Resampling.nearest if name == "SCL" else Resampling.average)
            st = d.window_transform(win) * rasterio.Affine.scale(win.width / wd, win.height / h)
            o = np.zeros((W, W), np.float32 if name != "SCL" else np.uint8)
            reproject(a.astype(o.dtype), o, src_transform=st, src_crs=d.crs, dst_transform=dst_t, dst_crs="EPSG:3857",
                      src_nodata=0, dst_nodata=0, resampling=Resampling.nearest if name == "SCL" else Resampling.bilinear)
            bands.append(o)
    rgb, scl, swir = np.stack(bands[:3]) / 10000, bands[3], bands[4] / 10000
    ok = (rgb.min(0) > 0) & ~np.isin(scl, CLOUDY)
    if not ok.any(): return None
    fog = ok & (rgb.mean(0) > 0.25) & (swir > CLOUD_SWIR)
    return rgb, ok, fog

def tile7(tx, ty):
    l, t = merc(tx, ty, 7); r, b = merc(tx + 1, ty + 1, 7)
    dst_t = from_bounds(l, b, r, t, W, W)
    ps = passes_for(tx, ty)
    def one(p):
        try: return read(p, l, b, r, t, dst_t)
        except Exception as e: print("skip", p["id"], str(e)[:100], flush=True); return None
    with ThreadPoolExecutor(int(os.environ.get("READERS", 8))) as ex:
        got = [g for g in ex.map(one, ps) if g is not None]
    if not got: return None, len(ps)
    # As build.py: each pixel's middle-brightness clear value, preferring passes without a hidden cloud there.
    # Done in strips, so ~30 passes of 2048 x 2048 don't need several GB at once.
    rgb, n = np.zeros((3, W, W), np.float32), np.zeros((W, W), np.int32)
    for r0 in range(0, W, 256):
        sl = slice(r0, r0 + 256)
        good = np.stack([ok[sl] & ~fog[sl] for _, ok, fog in got]).any(0)
        bright = np.stack([np.where(ok[sl] & ~(fog[sl] & good), p[:, sl].sum(0), np.inf) for p, ok, fog in got])
        cnt = np.isfinite(bright).sum(0)
        pick = np.take_along_axis(np.argsort(bright, 0), ((np.maximum(cnt, 1) - 1) // 2)[None], 0)[0]
        for i, (p, _, _) in enumerate(got):
            m = pick == i
            rgb[:, sl][:, m] = p[:, sl][:, m]
        n[sl] = cnt
    if not n.any(): return None, len(ps)
    img = np.zeros((W, W, 4), np.uint8)
    img[..., :3] = tone(rgb).transpose(1, 2, 0)
    img[..., 3] = np.where(n > 0, 255, 0)
    return Image.fromarray(img, "RGBA"), len(got)

def save(out, z, x, y, im):
    if im.getextrema()[3][1] == 0: return False   # all see-through (sea, or no clear pass): left out
    os.makedirs(f"{out}/{z}/{x}", exist_ok=True)
    im.save(f"{out}/{z}/{x}/{y}.webp", "WEBP", quality=QUALITY, method=6)
    return True

def cut(out, tx, ty, im):
    """Zooms 10 down to 7 from one zoom-7 canvas."""
    for z, k in ((10, 8), (9, 4), (8, 2), (7, 1)):
        a = im if k == 8 else im.resize((256 * k, 256 * k), Image.LANCZOS)
        for i in range(k):
            for j in range(k):
                save(out, z, tx * k + i, ty * k + j, a.crop((i * 256, j * 256, i * 256 + 256, j * 256 + 256)))

def low(out):
    """Zooms 6 to 3, each from the four tiles under it."""
    for z in range(6, 2, -1):
        kids = {(int(x), int(f[:-5])) for x in os.listdir(f"{out}/{z + 1}") for f in os.listdir(f"{out}/{z + 1}/{x}")}
        for x, y in {(x >> 1, y >> 1) for x, y in kids}:
            im = Image.new("RGBA", (512, 512))
            for dx in (0, 1):
                for dy in (0, 1):
                    p = f"{out}/{z + 1}/{2 * x + dx}/{2 * y + dy}.webp"
                    if os.path.exists(p): im.paste(Image.open(p).convert("RGBA"), (dx * 256, dy * 256))
            save(out, z, x, y, im.resize((256, 256), Image.LANCZOS))
        print("zoom", z, flush=True)

if __name__ == "__main__":
    if sys.argv[1] == "--low": low(sys.argv[2]); sys.exit()
    out = sys.argv[1]
    os.makedirs(f"{out}/done", exist_ok=True)
    todo = [tuple(t) for t in json.load(open(sys.argv[2])) if not os.path.exists(f"{out}/done/{t[0]}_{t[1]}")]
    print(len(todo), "zoom-7 tiles", flush=True)
    for k, (tx, ty) in enumerate(todo):
        im, np_ = tile7(tx, ty)
        if im is not None: cut(out, tx, ty, im)
        with open(f"{out}/done/{tx}_{ty}", "w") as f: f.write("" if im is None else "1")
        print("tile", tx, ty, np_, "passes,", len(todo) - k - 1, "left", flush=True)
