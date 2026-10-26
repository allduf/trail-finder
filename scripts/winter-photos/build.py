"""Builds the 3D map's Winter photos once (they're last winter's, so they don't change):
    python3 scripts/winter-photos/build.py <block-dir>     then   python3 scripts/winter-photos/tiles.py <block-dir>
tiles.py writes data/winter (not kept on main): copy it to winter/ on the winter-photos branch, as a single commit
pushed over the old one, then run "Publish winter photos" in allduf/trail-finder-winter (it serves them at
allduf.github.io/trail-finder-winter/, outside this site's 1 GB; it also runs daily).
New places: list their zoom-11 blocks in a JSON file, run scenes.py on it (adds their passes to winter-scenes.json),
then build.py <block-dir> --list <file> and tiles.py with the winter-photos branch's winter/ as data/winter, so
the new tiles join the old ones (2026-10-26: 582 blocks around ski hills, ski tours and backcountry areas across
Canada; the site went from ~640 to ~935 MB of its 1 GB).
Draws 2048 px blocks (one zoom-11 tile each, = 8 x 8 zoom-14 tiles, about 10 m a pixel like the photos) of the
region straight from the Sentinel-2 passes in data/winter-scenes.json (free, open data on AWS). Needs rasterio
(pip install rasterio). Optional: python3 build.py <block-dir> 325 691  draws just that block.

Colours come from the satellite's own blue, green and red bands (B02, B03, B04: how much light each spot
reflects, 0 to 1), not its ready-made true-colour picture (TCI): TCI turns everything brighter than about a
quarter of the light to pure white, which made all the snow one flat white sheet (alex, 2026-10-19). Here
bright snow keeps its shading, sun and shadow sides, wind ridges and tracks, while forest and rock stay
visible."""
import json, math, os, sys
import numpy as np
import rasterio
from rasterio.warp import reproject, transform_bounds, Resampling
from rasterio.transform import from_bounds
from rasterio.windows import from_bounds as window_from
from PIL import Image

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
here = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1] if len(sys.argv) > 1 else "winter-blocks"
X0, Y0, X1, Y1 = 315, 686, 331, 702   # zoom 11: Sunshine Coast and Vancouver to Lillooet (other areas: pass x y)
S2 = "/vsicurl/https://sentinel-cogs.s3.us-west-2.amazonaws.com/"
W = 2048
CLOUD_SWIR = float(os.environ.get("CLOUD_SWIR", 0.2))
CLOUDY = np.array([0, 1, 3, 8, 9, 10])   # SCL: no data, defective, cloud shadow, cloud (medium, high), cirrus
with open(os.path.join(here, "../../data/winter-scenes.json")) as f:
    scenes = sorted((s for v in json.load(f).values() for s in v), key=lambda s: s["cloud"])

def merc(x, y, z):
    n, R = 2 ** z, 20037508.342789244
    return x / n * 2 * R - R, R - y / n * 2 * R

TONE_A, WHITE, TONE_G = float(os.environ.get("TONE_A", 20)), float(os.environ.get("WHITE", 1.4)), float(os.environ.get("TONE_G", 1.1))
def tone(r):
    """Light (0 to about 1.2) to screen brightness. A gentle curve like a camera's: dark forest and rock come up
    so they read, and the top end rolls off softly instead of clipping, so sunlit snow (0.8 to 1.1) and snow in
    shadow (0.3 to 0.6) stay different shades. Sunlit slopes facing the low winter sun reflect up to about 1.4."""
    v = np.log1p(TONE_A * np.clip(r, 0, None)) / np.log1p(TONE_A * WHITE)   # 0.05 -> 0.22, 0.3 -> 0.55, 0.6 -> 0.71, 1.0 -> 0.86
    return np.clip(v ** TONE_G * 255 + 0.5, 0, 255).astype(np.uint8)

def block(bx, by):
    l, t = merc(bx, by, 11); r, b = merc(bx + 1, by + 1, 11)
    dst_t = from_bounds(l, b, r, t, W, W)
    ll = transform_bounds("EPSG:3857", "EPSG:4326", l, b, r, t)
    passes = []
    for s in scenes:
        bb = s["bbox"]
        if not (bb[0] < ll[2] and bb[2] > ll[0] and bb[1] < ll[3] and bb[3] > ll[1]): continue
        try:
            bands = []
            for name in ("B04", "B03", "B02", "SCL", "B11"):
                with rasterio.open(S2 + s["dir"] + name + ".tif") as d:
                    ub = transform_bounds("EPSG:3857", d.crs, l, b, r, t)
                    win = window_from(*ub, d.transform).round_offsets().round_lengths()
                    win = win.intersection(rasterio.windows.Window(0, 0, d.width, d.height))
                    a = d.read(1, window=win)
                    o = np.zeros((W, W), np.float32 if name != "SCL" else np.uint8)
                    reproject(a.astype(o.dtype), o, src_transform=d.window_transform(win), src_crs=d.crs, dst_transform=dst_t,
                              dst_crs="EPSG:3857", src_nodata=0, dst_nodata=0,
                              resampling=Resampling.nearest if name == "SCL" else Resampling.bilinear)
                    bands.append(o)
            rgb, scl, swir = np.stack(bands[:3]) / 10000, bands[3], bands[4] / 10000
            ok = (rgb.min(0) > 0) & ~np.isin(scl, CLOUDY)
            # Snow is dark in short-wave infrared (B11), cloud stays bright: something bright that is also bright
            # there is a cloud the cloud map missed (they showed as smooth white puffs on the snow).
            fog = ok & (rgb.mean(0) > 0.25) & (swir > CLOUD_SWIR)
            if ok.any(): passes.append((rgb, ok, fog))
        except Exception as e:   # a pass that won't load: the others fill in
            print("skip", s["id"], str(e)[:100])
    if not passes: return None
    # For each pixel, the middle-brightness clear value, from the passes without a hidden cloud there if any
    # (else from all clear ones: bright rock can look like cloud in every pass): a cloud the cloud map missed,
    # or its shadow, is brighter or darker than the ground the other passes saw, so it loses to them.
    good = np.stack([ok & ~fog for _, ok, fog in passes]).any(0)
    bright = np.stack([np.where(ok & ~(fog & good), rgb.sum(0), np.inf) for rgb, ok, fog in passes])
    n = np.isfinite(bright).sum(0)
    pick = np.take_along_axis(np.argsort(bright, 0), ((np.maximum(n, 1) - 1) // 2)[None], 0)[0]
    rgb = np.zeros((3, W, W), np.float32)
    for i, (p, _, _) in enumerate(passes):
        m = pick == i
        rgb[:, m] = p[:, m]
    return (rgb, n) if n.any() else None

def picture(rgb, n):
    img = np.zeros((W, W, 4), np.uint8)
    img[..., :3] = tone(rgb).transpose(1, 2, 0)
    img[..., 3] = np.where(n > 0, 255, 0)
    return img

if __name__ == "__main__":
    os.makedirs(out, exist_ok=True)
    # python3 build.py <block-dir> --list blocks.json   draws a list of zoom-11 [x, y] blocks (e.g. around ski hills).
    if len(sys.argv) > 3 and sys.argv[2] == "--list":
        todo = [tuple(b) for b in json.load(open(sys.argv[3]))
                if not os.path.exists(f"{out}/{b[0]}_{b[1]}.png") and not os.path.exists(f"{out}/{b[0]}_{b[1]}.empty")]
    else: todo = [(int(sys.argv[2]), int(sys.argv[3]))] if len(sys.argv) > 3 else \
        [(x, y) for x in range(X0, X1 + 1) for y in range(Y0, Y1 + 1)
         if not os.path.exists(f"{out}/{x}_{y}.png") and not os.path.exists(f"{out}/{x}_{y}.empty")]
    print("blocks", len(todo))
    for k, (x, y) in enumerate(todo):
        got = block(x, y)
        if got is None: open(f"{out}/{x}_{y}.empty", "w").close()
        else: Image.fromarray(picture(*got), "RGBA").save(f"{out}/{x}_{y}.png")
        print("block", x, y, len(todo) - k - 1, "left", flush=True)
