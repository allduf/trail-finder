# Cell signal on roads for Moto mode (moto.js): ISED National Broadband Data, the road pieces with mobile (LTE, LTE-A, 5G)
# service in the MobileCurrent layer, as 0.02° squares, run-length coded per row -> data/moto-cell.json (~420 KB).
# Run by hand when ISED updates it (about twice a year): download NBD_Roads_GPKG.zip (~2.3 GB) from
# https://open.canada.ca/data/en/dataset/00a331db-121b-445d-b119-35dbbe3eedd9 then
#   pip install pyproj && python3 scripts/build-moto-cell.py NBD_Roads_GPKG.zip data/moto-cell.json
import sqlite3, struct, sys, os, json, zipfile, subprocess
from pyproj import CRS, Transformer
src = sys.argv[1]; out = sys.argv[2]; STEP = 0.02
z = zipfile.ZipFile(src)
cells = set(); tr = None
for name in sorted(n for n in z.namelist() if n.endswith('.gpkg')):
    d = os.path.dirname(out) or '.'
    z.extract(name, d); f = os.path.join(d, name)
    c = sqlite3.connect(f)
    if tr is None:
        wkt = c.execute('select definition from gpkg_spatial_ref_sys where srs_id=100000').fetchone()[0]
        tr = Transformer.from_crs(CRS.from_wkt(wkt), CRS.from_epsg(4326), always_xy=True)
    xs, ys = [], []
    for (g,) in c.execute('select geom from MobileCurrent_MobileActuelles'):
        if not g or g[:2] != b'GP' or not (g[3] >> 1) & 7: continue
        x0, x1, y0, y1 = struct.unpack('<4d', g[8:40])
        xs.append((x0 + x1) / 2); ys.append((y0 + y1) / 2)
    n0 = len(cells)
    for i in range(0, len(xs), 200000):
        lo, la = tr.transform(xs[i:i+200000], ys[i:i+200000])
        for a, b in zip(la, lo): cells.add((int(a // STEP), int(b // STEP)))
    print(name, len(xs), 'segments', len(cells) - n0, 'new cells', flush=True)
    c.close(); os.remove(f)
rows = {}
for a, b in cells: rows.setdefault(a, []).append(b)
enc = {}
for a, bs in sorted(rows.items()):
    bs.sort(); runs = []; s = p = bs[0]
    for b in bs[1:]:
        if b == p + 1: p = b; continue
        runs += [s, p - s + 1]; s = p = b
    runs += [s, p - s + 1]
    enc[str(a)] = runs
body = json.dumps({"v": 1, "step": STEP, "src": "ISED National Broadband Data, MobileCurrent (LTE, LTE-A, 5G) road segments, June 2026", "rows": enc}, separators=(',', ':'))
open(out, 'w').write(body)
print('cells', len(cells), 'rows', len(enc), 'bytes', len(body))
