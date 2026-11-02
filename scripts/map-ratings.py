# Difficulty read off a club's or town's own trail map, for areas with no open data and no ratings on OpenStreetMap.
# Some clubs publish their map as a georeferenced PDF (the kind Avenza Maps opens): the PDF says where each corner is,
# and every trail is drawn in its level's colour. For each MTB way of the zone (data/mtb-<zone>.json), this looks at the
# map's pixels along the way and keeps the colour found along most of it. A way that's off the map, or where the colours
# disagree, is left out. Writes scripts/map-ratings.json, which scripts/build-ratings.mjs adds to the rating lines (as
# source <id>; ratings.js names it in SRC), so the site shows "Rated “Moderate” by <the map>".
#
# Run by hand when a map changes (pip install pymupdf numpy pillow pyproj; needs the site-data branch's data/mtb-*.json, see
# scripts/site-data.sh get):  python3 scripts/map-ratings.py
import json, math, re, collections, urllib.request, io
import numpy as np
import pymupdf

# legend: map colour (RGB) -> [level, the map's own word for it]. Only lines of these colours count.
MAPS = {
    "ccf": {
        "name": "the Cranbrook Community Forest Society trail map",
        "url": "https://www.cranbrookcommunityforest.com/kiosk-map",
        "pdf": "https://www.cranbrookcommunityforest.com/_files/ugd/7e6cfe_6054e66f57e44d7ebf6b40a1201f45a4.pdf",
        "zone": "cbk",
        "legend": {"77,230,0": ["green", "Easy"], "0,170,255": ["blue", "Moderate"], "0,0,0": ["black", "Difficult"],
                   "255,0,0": ["dbl", "Very Difficult"]},
        "dark": "0,0,0",   # also the colour of text and roads: counts only where no trail colour is near
    },
    # A plain picture with a printed UTM grid instead of a georeferenced PDF: "grid" gives two pixel columns with their
    # easting and two pixel rows with their northing (read off the map's 1 km lines), in UTM zone "utm" (NAD83).
    "knps": {
        "name": "the Kimberley Nature Park Society trail guide (2023)",
        "url": "https://www.kimberleynaturepark.ca/trails/maps",
        "img": "https://static.wixstatic.com/media/2e36a1_dc39ad3c37cb43e4987c639f42e358d6~mv2.png",
        # the 1 km lines are at x 82/1456, y 185/1331, but the trails sit 5 px east and 2 px north of where the grid puts
        # them (best fit of all the zone's ways, same in every corner of the map), so the grid is moved by that much
        "utm": 11, "grid": {"x": [[87, 568000], [1461, 574000]], "y": [[183, 5504000], [1329, 5499000]]},
        "zone": "cbk",
        "legend": {"69,110,46": ["green", "Easy"], "3,124,189": ["blue", "Intermediate"], "34,32,32": ["black", "Difficult"]},
        "dark": "34,32,32",
        "tol": 40,   # creeks (9,154,215) and winter ski trails (1,135,121) are close to the trail blue
    },
}
DPI, NEAR_M, STEP_M, TOL = 200, 8, 6, 110

def georef(doc, page):
    """Map PDF corners to lat/lon from the page's /VP /Measure (GPTS/LPTS): returns (lat, lon) -> PDF point (y down)."""
    obj = doc.xref_object(page.xref)
    m = re.search(r"/VP\s*(\d+) 0 R", obj)
    if m: obj = doc.xref_object(int(m.group(1)))
    best = None
    for bb, meas in re.findall(r"/BBox \[\s*([-\d.\s]+)\]\s*/Measure (\d+) 0 R", obj, re.S):
        mo = doc.xref_object(int(meas))
        g = list(map(float, re.search(r"/GPTS \[\s*([-\d.\s]+)\]", mo).group(1).split()))
        l = list(map(float, re.search(r"/LPTS \[\s*([-\d.\s]+)\]", mo).group(1).split()))
        b = list(map(float, bb.split()))
        area = abs((b[2] - b[0]) * (b[3] - b[1]))
        if not best or area > best[0]: best = (area, b, g, l)
    if not best: raise SystemExit("the PDF isn't georeferenced")
    _, b, g, l = best
    H = page.rect.height
    src = [[g[i], g[i + 1], 1] for i in range(0, len(g), 2)]
    dst = [[b[0] + l[i] * (b[2] - b[0]), H - (b[1] + l[i + 1] * (b[3] - b[1]))] for i in range(0, len(l), 2)]
    sol = np.linalg.lstsq(np.array(src), np.array(dst), rcond=None)[0]
    return lambda la, lo: np.array([la, lo, 1]) @ sol

def along(g, step):
    out = []
    for (a, b), (c, d) in zip(g, g[1:]):
        n = max(1, int(math.hypot((c - a) * 110540, (d - b) * 111320 * math.cos(math.radians(a))) / step))
        out += [(a + (c - a) * k / n, b + (d - b) * k / n) for k in range(n)]
    return out + g[-1:]

def utm_grid(m):
    """(lat, lon) -> pixel of a picture with a printed UTM grid (see "grid" in MAPS)."""
    from pyproj import Transformer
    tr = Transformer.from_crs("EPSG:4326", f"EPSG:269{m['utm']:02d}", always_xy=True)
    (x0, e0), (x1, e1) = m["grid"]["x"]; (y0, n0), (y1, n1) = m["grid"]["y"]
    def to_px(la, lo):
        e, n = tr.transform(lo, la)
        return np.array([x0 + (e - e0) * (x1 - x0) / (e1 - e0), y0 + (n - n0) * (y1 - y0) / (n1 - n0)])
    return to_px

def read_map(mid, m):
    if "img" in m:   # a picture: pixels already, no PDF page to render
        from PIL import Image
        req = urllib.request.Request(m["img"], headers={"User-Agent": "trail-finder (github.com/allduf/trail-finder)"})
        img = np.array(Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=120).read())).convert("RGB")).astype(int)
        class P: pass
        pix = P(); pix.h, pix.w = img.shape[:2]
        to_pt, sc = utm_grid(m), 1
    else:
        doc = pymupdf.open(stream=urllib.request.urlopen(m["pdf"], timeout=120).read(), filetype="pdf")
        page = doc[0]
        to_pt = georef(doc, page)
        pix = page.get_pixmap(dpi=DPI, alpha=False)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, 3).astype(int)
        sc = DPI / 72
    cols = {k: np.array(list(map(int, k.split(",")))) for k in m["legend"]}
    ways = json.load(open(f"data/mtb-{m['zone']}.json"))["ways"]
    # search NEAR_M around each point: pixels per metre from two points 100 m apart (north-south) in the zone
    la, lo = (sum(w["g"][i] for w in ways.values()) / len(ways) for i in (0, 1))
    r = max(2, int(NEAR_M * math.dist(to_pt(la, lo), to_pt(la + 100 / 110540, lo)) * sc / 100))
    colour = lambda px: {k: np.abs(px - c).sum(axis=1) for k, c in cols.items()}
    lines = []
    for wid, w in ways.items():
        g = [(w["g"][i], w["g"][i + 1]) for i in range(0, len(w["g"]) - 1, 2)]
        if len(g) < 2: continue
        hits, inside = collections.Counter(), 0
        pts = along(g, STEP_M)
        for la, lo in pts:
            x, y = to_pt(la, lo) * sc
            x, y = int(x), int(y)
            if not (r <= x < pix.w - r and r <= y < pix.h - r): continue
            inside += 1
            win = img[y - r:y + r + 1, x - r:x + r + 1].reshape(-1, 3)
            for k, dist in colour(win).items():
                if (dist < m.get("tol", TOL)).any(): hits[k] += 1
        if inside < max(3, 0.8 * len(pts)): continue
        share = {k: v / inside for k, v in hits.items()}
        coloured = sorted(((v, k) for k, v in share.items() if k != m["dark"]), reverse=True) + [(0, None), (0, None)]
        (top, k), (second, _) = coloured[0], coloured[1]
        if top >= 0.6 and second <= top / 2: pick = k
        elif share.get(m["dark"], 0) >= 0.85 and top <= 0.15: pick = m["dark"]
        else: continue
        d, note = m["legend"][pick]
        lines.append([d, mid, w["tags"].get("name", ""), note, [[round(a, 5), round(b, 5)] for a, b in g]])
    print(f"{mid}: {len(lines)} ways rated", dict(collections.Counter(l[0] for l in lines)))
    return lines

out = {"v": 1, "maps": {k: {"name": m["name"], "url": m["url"]} for k, m in MAPS.items()}, "lines": []}
for k, m in MAPS.items(): out["lines"] += read_map(k, m)
json.dump(out, open("scripts/map-ratings.json", "w"), separators=(",", ":"))
