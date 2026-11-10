"""AI-sharpened Winter photos (alex 2026-11-03, "do that" on the AI sharpening trial, then "Sea to Sky first"):
    python3 scripts/winter-photos/sharpen.py <block-dir> blocks.json        (a list of zoom-11 [x, y] blocks)
    python3 scripts/winter-photos/sharpen.py --tiles <block-dir> <site>     cuts them into <site>/15/{x}/{y}.webp + <site>/sharp.json

Same cloud-free mix of last winter's Sentinel-2 passes as build.py (for each pixel the middle-brightness clear
value), but made on the satellite's own 10 m grid with its near-infrared band too, then 4x sharpened to 2.5 m by
SEN2SR Lite (ESA OpenSR, tacofoundation/sen2sr "SEN2SRLite/NonReference_RGBN_x4", CC0; CPU is fine: ~7 s per
100 km2), then drawn as 4096 px blocks (zoom 15, 16 x 16 tiles of 256 px) with build.py's tone curve.
The model keeps the photo's colours and brightness where they were (a "hard constraint" on the blurry version);
the finer edges of runs, glades and tree patches are its best guess, not new information.
Needs: pip install torch (CPU) sen2sr mlstac rasterio matplotlib einops timm pillow
"""
import json, os, sys
import numpy as np
import rasterio
from rasterio.warp import reproject, transform_bounds, Resampling
from rasterio.transform import from_bounds, from_origin
from rasterio.windows import from_bounds as window_from
from PIL import Image, ImageFilter

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, here)
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("GDAL_HTTP_MULTIRANGE", "YES")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")
from build import merc, tone, scenes, S2, CLOUDY, CLOUD_SWIR
if os.environ.get("SCENES"):   # a longer list of passes for cloudy places (scenes.py OUT=...): more chances of a clear look
    scenes = sorted((s for v in json.load(open(os.environ["SCENES"])).values() for s in v), key=lambda s: s["cloud"])

W = 4096                     # a zoom-11 block at zoom 15
MODEL = os.environ.get("SR_MODEL", os.path.join(here, "sr-model"))
MLM = "https://huggingface.co/tacofoundation/sen2sr/resolve/main/SEN2SRLite/NonReference_RGBN_x4/mlm.json"

def grow(m, r):
    """The mask m made r pixels bigger on every side."""
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r: out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out

def composite(bx, by):
    """RGBN reflectance (4, h, w) on a 10 m UTM grid around the block, how many clear passes each pixel had, the grid."""
    l, t = merc(bx, by, 11); r, b = merc(bx + 1, by + 1, 11)
    ll = transform_bounds("EPSG:3857", "EPSG:4326", l, b, r, t)
    mine = [s for s in scenes if s["bbox"][0] < ll[2] and s["bbox"][2] > ll[0] and s["bbox"][1] < ll[3] and s["bbox"][3] > ll[1]]
    if not mine: return None
    crs = rasterio.crs.CRS.from_epsg(32600 + int(((ll[0] + ll[2]) / 2 + 180) // 6) + 1)   # the block's own UTM zone: its 10 m pixels as they are
    x0, y0, x1, y1 = transform_bounds("EPSG:3857", crs, l, b, r, t)
    x0, y0, x1, y1 = np.floor(x0 / 10) * 10 - 200, np.floor(y0 / 10) * 10 - 200, np.ceil(x1 / 10) * 10 + 200, np.ceil(y1 / 10) * 10 + 200
    w, h = int((x1 - x0) / 10), int((y1 - y0) / 10)
    grid = from_origin(x0, y1, 10, 10)
    passes = []
    for s in mine:
        try:
            bands = []
            for name in ("B04", "B03", "B02", "B08", "SCL", "B11"):
                with rasterio.open(S2 + s["dir"] + name + ".tif") as d:
                    ub = transform_bounds(crs, d.crs, x0, y0, x1, y1)
                    win = window_from(*ub, d.transform).round_offsets().round_lengths()
                    win = win.intersection(rasterio.windows.Window(0, 0, d.width, d.height))
                    a = d.read(1, window=win)
                    o = np.zeros((h, w), np.float32 if name != "SCL" else np.uint8)
                    reproject(a.astype(o.dtype), o, src_transform=d.window_transform(win), src_crs=d.crs, dst_transform=grid,
                              dst_crs=crs, src_nodata=0, dst_nodata=0,
                              resampling=Resampling.nearest if name in ("SCL",) or d.res[0] == 10 and d.crs == crs else Resampling.bilinear)
                    bands.append(o)
            rgbn, scl, swir = np.stack(bands[:4]) / 10000, bands[4], bands[5] / 10000
            ok = (rgbn[:3].min(0) > 0) & ~grow(np.isin(scl, CLOUDY) & (scl > 0), 3)   # 30 m off clouds: their hazy edges
            fog = ok & (rgbn[:3].mean(0) > 0.25) & (swir > CLOUD_SWIR)
            if ok.any(): passes.append((rgbn, ok, fog))
        except Exception as ex:
            print("skip", s["id"], str(ex)[:100], flush=True)
    if not passes: return None
    good = np.stack([ok & ~fog for _, ok, fog in passes]).any(0)
    bright = np.stack([np.where(ok & ~(fog & good), p[:3].sum(0), np.inf) for p, ok, fog in passes])
    n = np.isfinite(bright).sum(0)
    pick = np.take_along_axis(np.argsort(bright, 0), ((np.maximum(n, 1) - 1) // 2)[None], 0)[0]
    out = np.zeros((4, h, w), np.float32)
    for i, (p, _, _) in enumerate(passes):
        m = pick == i
        out[:, m] = p[:, m]
    return out, n, grid, crs, (l, b, r, t)

_model = None
def sharpen(x):
    global _model
    import torch, mlstac, sen2sr
    torch.set_num_threads(int(os.environ.get("SR_THREADS", 1)))
    if _model is None:
        if not os.path.exists(os.path.join(MODEL, "model.safetensor")): mlstac.download(file=MLM, output_dir=MODEL)
        _model = mlstac.load(MODEL).compiled_model(device="cpu")
    c, h, w = x.shape
    side = max(128, int(np.ceil(max(h, w) / 32)) * 32)   # predict_large wants a square
    sq = np.zeros((c, side, side), np.float32); sq[:, :h, :w] = x
    with torch.no_grad(): y = sen2sr.predict_large(torch.from_numpy(sq), _model, overlap=32).numpy()
    return y[:, :h * 4, :w * 4]

def block(bx, by):
    got = composite(bx, by)
    if got is None: return None
    rgbn, n, grid, crs, (l, b, r, t) = got
    sr = sharpen(rgbn)
    fine = rasterio.Affine(grid.a / 4, 0, grid.c, 0, grid.e / 4, grid.f)
    dst_t = from_bounds(l, b, r, t, W, W)
    rgb = np.zeros((3, W, W), np.float32)
    for k in range(3):
        reproject(sr[k], rgb[k], src_transform=fine, src_crs=crs, dst_transform=dst_t, dst_crs="EPSG:3857", resampling=Resampling.bilinear)
    seen = np.zeros((W, W), np.float32)
    reproject((n > 0).astype(np.float32), seen, src_transform=grid, src_crs=crs, dst_transform=dst_t, dst_crs="EPSG:3857", resampling=Resampling.bilinear)
    # Soft edges (~20 m) where the clear photo stops: no saw-tooth of 10 m squares against the filled-in Winter below.
    seen = np.asarray(Image.fromarray((seen * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)), np.float32)
    img = np.zeros((W, W, 4), np.uint8)
    img[..., :3] = tone(rgb).transpose(1, 2, 0)
    img[..., 3] = np.clip((seen - 40) * 255 / 175, 0, 255).astype(np.uint8)
    return img

def one(args):
    out, x, y = args
    for attempt in range(3):   # a failed read (network, a busy model download) once killed a whole GitHub job of squares
        try:
            img = block(x, y); break
        except Exception as ex:
            import traceback; print("block", x, y, "failed, try", attempt + 1, ":", repr(ex)[:300], flush=True); traceback.print_exc()
            if attempt == 2: return x, y
    if img is None: open(f"{out}/{x}_{y}.empty", "w").close()
    else: Image.fromarray(img, "RGBA").save(f"{out}/{x}_{y}.png")
    return x, y

def tiles(src, site, quality=70):
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
    listed = os.path.join(site, "sharp.json")
    have = set(map(tuple, json.load(open(listed)))) if os.path.exists(listed) else set()
    have |= set(map(tuple, done))
    json.dump(sorted(have), open(listed, "w"), separators=(",", ":"))
    print(len(done), "blocks,", len(have), "listed")

if __name__ == "__main__":
    if sys.argv[1] == "--tiles": tiles(sys.argv[2], sys.argv[3]); sys.exit()
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    todo = [(out, *b) for b in json.load(open(sys.argv[2]))
            if not os.path.exists(f"{out}/{b[0]}_{b[1]}.png") and not os.path.exists(f"{out}/{b[0]}_{b[1]}.empty")]
    print("blocks", len(todo), flush=True)
    from multiprocessing import Pool
    with Pool(int(os.environ.get("WORKERS", 4))) as pool:
        for k, (x, y) in enumerate(pool.imap_unordered(one, todo)):
            print("block", x, y, len(todo) - k - 1, "left", flush=True)
