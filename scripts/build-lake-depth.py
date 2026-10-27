#!/usr/bin/env python3
# Lake depth lines and depth charts for Fishing, outside BC (BC's own map server draws its lines live): alex
# 2026-10-27 "add lake depths across Canada". Writes data/fishing/depth/:
#  - <r>_<c>.json, one per 0.25 degree square (r = floor(lat*4), c = floor(lon*4)):
#      {"l": [[depth m, "line"], ...], "p": [[depth m, lon, lat], ...]}
#    coordinates in 1e-5 degrees; a line is Google's encoded polyline format (lon then lat in each pair, the first point
#    as is, then steps from the point before), half the size of number lists. Lines are cut where they leave the
#    square, so a square only needs itself.
#  - i.json: {"t": [the squares that have a file], "lakes": [[lat, lon, radius km, name, deepest m or null, [map links], prov]],
#    "pre": {prov: the start every map link of that province shares, left off the links}}: the lakes with a depth chart
#    (PDF or scanned map) for the spot card.
# Sources (all open data):
#  - Quebec: Geobase des bathymetries de lacs du Quebec (GBLQ), Ministere de l'Environnement, CC-BY 4.0, Donnees Quebec
#    dataset "bathymetries-lacs": isobaths (about 2,200 lakes, EPSG:32198), deepest points, PDF maps (about 2,100 lakes).
#  - Ontario: Bathymetry Line (LIO, Open Government Licence - Ontario), the GeoHub download of LIO_Open01 layer 30 (the
#    live map server takes a minute per query, too slow to ask from the app), and the Historic Bathymetry Index
#    (scanned depth charts for about 11,000 lakes).
#  - New Brunswick: Lake Depth Bathymetry Points (DNRED open data), drawn as soundings.
#  - Saskatchewan: the Fisheries Branch bathymetric map index (945 scanned maps).
# Manitoba draws live from the province's own vector tiles (in fishing.js), nothing to build.
# Needs: pip install pyproj shapely ijson. Monthly (with the full fishing run) and when this script changes.
import collections, csv, io, json, math, os, re, shutil, sys, tempfile, time, urllib.parse, urllib.request, zipfile

import ijson
from pyproj import Transformer
from shapely.geometry import LineString

OUT = "data/fishing/depth"
QC = "https://stqc380donopppdtce01.blob.core.windows.net/donnees-ouvertes/Bathymetrie/Lacs/DQ/"
ON_LINES = "https://geohub.lio.gov.on.ca/api/download/v1/items/8c66fb7f8be242f38fa11c096bd04da8/geojson?layers=30"
ON_HIST = "https://services1.arcgis.com/TJH5KDher0W13Kgo/arcgis/rest/services/Historic_Bathymetry_Index/FeatureServer/0/query"
NB_PTS = "https://gis-erd-der.gnb.ca/server/rest/services/OpenData/Lake_Depth_Bathymetry_Points/MapServer/0/query"
SK_IDX = "https://gis.saskatchewan.ca/arcgis/rest/services/Bathymetric/MapServer/0/query"
SK_MAPS = "https://gisappl.saskatchewan.ca/BathyMaps/"
TOL = float(os.environ.get("DEPTH_TOL", 6))   # metres: lines are simplified this much (still smooth at zoom 16; 3 m doubles the size)

tmp = tempfile.mkdtemp(prefix="depth-")
squares = collections.defaultdict(lambda: {"l": [], "p": []})
lakes = []
count = collections.Counter()


def get(url, path=None, tries=4):
    cache = os.environ.get("DEPTH_CACHE")   # a folder with the big downloads already in it (local runs)
    if path and cache and os.path.exists(f"{cache}/{os.path.basename(path)}"):
        return f"{cache}/{os.path.basename(path)}"
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "trail-finder fishing depth (github.com/allduf/trail-finder)"})
            with urllib.request.urlopen(req, timeout=600) as r:
                if not path:
                    return r.read()
                with open(path, "wb") as f:
                    shutil.copyfileobj(r, f, 1 << 20)
                return path
        except Exception as e:
            print(f"  {url[:90]}: {e}", file=sys.stderr)
            if i == tries - 1:
                raise
            time.sleep(5 * 2 ** i)


def arcgis(url, params, page=1000):
    out, off = [], 0
    while True:
        q = {"where": "1=1", "f": "json", "resultOffset": off, "resultRecordCount": page, **params}
        j = json.loads(get(url + "?" + urllib.parse.urlencode(q)))
        feats = j.get("features", [])
        out += feats
        if not feats or not (j.get("exceededTransferLimit") or len(feats) == page):
            return out
        off += len(feats)


def key(lon, lat):
    return f"{math.floor(lat / 25000)}_{math.floor(lon / 25000)}"   # 1e-5 degrees -> 0.25 degree squares


def add_line(depth, lonlat):
    """lonlat: [(lon, lat)] in degrees, already simplified. Cut where it leaves a square."""
    q = []
    for lon, lat in lonlat:
        p = (round(lon * 1e5), round(lat * 1e5))
        if not q or p != q[-1]:
            q.append(p)
    if len(q) < 2:
        return
    seg, k = [q[0]], key(*q[0])
    for p in q[1:]:
        kp = key(*p)
        seg.append(p)
        if kp != k:
            emit(depth, k, seg)
            seg, k = [seg[-2], p], kp
    emit(depth, k, seg)


def enc(v):
    v = ~(v << 1) if v < 0 else v << 1
    out = ""
    while v >= 0x20:
        out += chr((0x20 | (v & 0x1F)) + 63)
        v >>= 5
    return out + chr(v + 63)


def emit(depth, k, seg):
    if len(seg) < 2:
        return
    s, px, py = "", 0, 0
    for x, y in seg:
        s += enc(x - px) + enc(y - py)
        px, py = x, y
    squares[k]["l"].append([depth, s])


def depth_num(d):
    d = round(abs(float(d)), 1)
    return int(d) if d == int(d) else d


def bbox_lake(coords_iter):
    xs, ys = [], []
    for x, y in coords_iter:
        xs.append(x); ys.append(y)
    if not xs:
        return None
    lat, lon = (min(ys) + max(ys)) / 2, (min(xs) + max(xs)) / 2
    r = max((max(ys) - min(ys)) * 111.2, (max(xs) - min(xs)) * 111.2 * math.cos(math.radians(lat))) / 2
    return round(lat, 5), round(lon, 5), round(max(r, 0.3), 2)


def rings(g):
    if g["type"] == "Polygon":
        return g["coordinates"]
    if g["type"] == "MultiPolygon":
        return [r for p in g["coordinates"] for r in p]
    return []


def nice_name(n):
    # "Bob, Lac" -> "Lac Bob"; "Brome, Lac de" -> "Lac de Brome"
    m = re.match(r"^(.*?),\s*(.+)$", n or "")
    return f"{m.group(2)} {m.group(1)}".replace("' ", "'") if m else (n or "")


def simplify_metres(lonlat, tol):
    """Simplify a lon/lat line by tol metres (local flat projection)."""
    if len(lonlat) < 3:
        return lonlat
    lat0 = lonlat[0][1]
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    ls = LineString([(x * kx, y * ky) for x, y in lonlat]).simplify(tol)
    return [(x / kx, y / ky) for x, y in ls.coords]


# ---------- Quebec ----------
def quebec():
    print("Quebec: downloading the GBLQ (about 800 MB)")
    z = zipfile.ZipFile(get(QC + "GBLQ_json.zip", f"{tmp}/gblq.zip"))
    tr = Transformer.from_crs(32198, 4326, always_xy=True)
    for ft in ijson.items(z.open("isobathes_l.geojson"), "features.item"):
        g, d = ft["geometry"], ft["properties"].get("PROFONDEUR_M")
        if d is None or not g:
            continue
        for c in [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]:
            if len(c) < 2:
                continue
            ls = LineString([(float(p[0]), float(p[1])) for p in c]).simplify(TOL)
            xs, ys = zip(*ls.coords)
            lon, lat = tr.transform(xs, ys)
            add_line(depth_num(d), list(zip(lon, lat)))
            count["qc lines"] += 1
    deep = {}
    for ft in ijson.items(z.open("fosses_p.geojson"), "features.item"):
        p = ft["properties"]
        if p.get("PROFONDEUR_M") is not None:
            deep[p["NO_LCE_L"]] = max(deep.get(p["NO_LCE_L"], 0), depth_num(p["PROFONDEUR_M"]))
    pdf = {}
    zc = zipfile.ZipFile(get(QC + "Index_bathymetries_csv.zip", f"{tmp}/qcidx.zip"))
    name = next(n for n in zc.namelist() if n.endswith(".csv"))
    for r in csv.DictReader(io.TextIOWrapper(zc.open(name), encoding="utf-8-sig")):
        if r.get("URL_PDF"):
            pdf[r["NO_LCE_L"]] = r["URL_PDF"]
    for ft in ijson.items(z.open("index_s.geojson"), "features.item"):
        p, g = ft["properties"], ft["geometry"]
        if not g:
            continue
        pts = [pt for ring in rings(g) for pt in ring]
        xs, ys = tr.transform([float(pt[0]) for pt in pts], [float(pt[1]) for pt in pts])
        b = bbox_lake(zip(xs, ys))
        if not b:
            continue
        lid = p["NO_LCE_L"]
        links = [pdf[lid]] if lid in pdf else []
        if not links and lid not in deep:
            continue
        lakes.append([*b, nice_name(p.get("HYDRONYME")), deep.get(lid), links, "qc"])
        count["qc lakes"] += 1


# ---------- Ontario ----------
def ontario():
    print("Ontario: downloading Bathymetry Line (about 2 GB)")
    path = get(ON_LINES, f"{tmp}/on.geojson")
    with open(path, "rb") as f:
        for ft in ijson.items(f, "features.item"):
            g, d = ft["geometry"], ft["properties"].get("DEPTH")
            if d is None or not g:
                continue
            for c in [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]:
                if len(c) >= 2:
                    add_line(depth_num(d), simplify_metres([(float(p[0]), float(p[1])) for p in c], TOL))
                    count["on lines"] += 1
    for ft in arcgis(ON_HIST, {"outFields": "PROJECT_NAME,HISTORIC_MAP_DOWNLOAD", "outSR": 4326, "maxAllowableOffset": 0.001, "geometryPrecision": 4}, 2000):
        a, g = ft["attributes"], ft.get("geometry") or {}
        links = re.findall(r'href="([^"]+)"', a.get("HISTORIC_MAP_DOWNLOAD") or "")
        b = bbox_lake((x, y) for ring in g.get("rings", []) for x, y in ring)
        if not links or not b:
            continue
        name = re.sub(r"\s+\d+$", "", (a.get("PROJECT_NAME") or "").strip())
        lakes.append([*b, name, None, [l.replace(" ", "%20") for l in links], "on"])
        count["on lakes"] += 1


# ---------- New Brunswick ----------
def new_brunswick():
    for ft in arcgis(NB_PTS, {"outFields": "DEPTH_M", "outSR": 4326, "geometryPrecision": 5}, 2000):
        d, g = ft["attributes"].get("DEPTH_M"), ft.get("geometry")
        if d is None or not g:
            continue
        lon, lat = round(g["x"] * 1e5), round(g["y"] * 1e5)
        squares[key(lon, lat)]["p"].append([depth_num(d), lon, lat])
        count["nb points"] += 1


# ---------- Saskatchewan ----------
def saskatchewan():
    for ft in arcgis(SK_IDX, {"outFields": "MAP_NAME,SCAN_LINK", "outSR": 4326, "geometryPrecision": 5}):
        a, g = ft["attributes"], ft.get("geometry")
        if not a.get("SCAN_LINK") or not g or not all(isinstance(g.get(k), (int, float)) for k in "xy"):
            continue
        lakes.append([round(g["y"], 5), round(g["x"], 5), 1.5, (a.get("MAP_NAME") or "").strip(), None, [SK_MAPS + urllib.parse.quote(a["SCAN_LINK"])], "sk"])
        count["sk lakes"] += 1


for step in (quebec, ontario, new_brunswick, saskatchewan):
    try:
        step()
    except Exception as e:   # one province failing keeps the others (and last month's files for it are lost: warn loudly)
        print(f"::warning::{step.__name__} failed: {e}")

if count["qc lines"] + count["on lines"] < 1000:
    sys.exit("Too few depth lines, keeping the old files")
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
total = 0
for k, v in squares.items():
    s = json.dumps({x: v[x] for x in ("l", "p") if v[x]}, separators=(",", ":"))
    with open(f"{OUT}/{k}.json", "w") as f:
        f.write(s)
    total += len(s)
lakes.sort(key=lambda x: (x[0], x[1]))
PRE = {"qc": QC.replace("/DQ/", "/PDF/"), "on": "https://www.publicdocs.mnr.gov.on.ca/mirb/Bathymetry/", "sk": SK_MAPS}
for x in lakes:
    x[5] = [u[len(PRE[x[6]]):] if u.startswith(PRE[x[6]]) else u for u in x[5]]
with open(f"{OUT}/i.json", "w") as f:
    json.dump({"t": sorted(squares), "lakes": lakes, "pre": PRE}, f, separators=(",", ":"), ensure_ascii=False)
shutil.rmtree(tmp, ignore_errors=True)
print(dict(count), f"{len(squares)} squares, {total / 1e6:.1f} MB")
