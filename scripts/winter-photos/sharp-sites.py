"""Splits the AI-sharpened Winter photos over the Cloudflare Pages sites trailfinder-sharp-0..9 (2026-11-10, alex: "Make
all the map you see ai resolution. I want the same resolution as Whistler"): with Whistler to Lillooet and Gold Bridge
plus Revelstoke to Banff there are ~390 zoom-11 squares, ~130,000 tiles with zooms 11-14, and Pages takes 20,000 files a site.
    python3 scripts/winter-photos/sharp-sites.py <trail-finder-winter2 checkout> <sharp-mid.py out> <out>
Each square's zooms 11-15 go on site ((x * 31 + y) % 10) of its zoom-11 x, y (map3d.js tfSharpSite, same in winter-hd.js
and winter-fill.js); sharp.json on -0. Writes <out>/sharp-{k}/trail-finder-winter2/... plus _headers (CORS) and 404.html
(without one, Pages answers a missing tile with a page instead of a 404).
"""
import json, os, shutil, sys

SITES = 10

def put(src, out, rel, k):
    dst = f"{out}/sharp-{k}/trail-finder-winter2/{rel}"
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    try: os.link(src, dst)
    except OSError: shutil.copyfile(src, dst)

if __name__ == "__main__":
    w2, mid, out = sys.argv[1:4]
    count = [0] * SITES
    for root in (w2, f"{mid}/trail-finder-winter2"):
        for z in range(11, 16):
            zd = f"{root}/{z}"
            if not os.path.isdir(zd): continue
            for x in os.listdir(zd):
                for f in os.listdir(f"{zd}/{x}"):
                    if not f.endswith(".webp"): continue
                    y = int(f[:-5]); k = ((int(x) >> (z - 11)) * 31 + (y >> (z - 11))) % SITES
                    put(f"{zd}/{x}/{f}", out, f"{z}/{x}/{f}", k); count[k] += 1
    put(f"{w2}/sharp.json", out, "sharp.json", 0)
    for k in range(SITES):
        os.makedirs(f"{out}/sharp-{k}", exist_ok=True)
        open(f"{out}/sharp-{k}/_headers", "w").write("/*\n  Access-Control-Allow-Origin: *\n")
        open(f"{out}/sharp-{k}/404.html", "w").write("Not found\n")
    print("tiles a site:", count)
    if max(count) > 19900: sys.exit("a site has more than Cloudflare Pages' 20,000 files: raise SITES (and tfSharpSite in the app)")
