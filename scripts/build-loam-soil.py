# Soil type for the Loam index (data/loam-soil.json). Run by hand: soil types never change, so this is a one-off.
#   pip install eccodes numpy scipy && python3 scripts/build-loam-soil.py
# Open-Meteo's soil moisture (0-1, 1-3 and 3-9 cm) comes from DWD's ICON model, whose soil is one of a few types, each
# holding a different amount of water: sand is full at 0.36 m3/m3, loam at 0.46. So one fixed scale read sandy places
# (around Quebec City, much of the Shield) as "dry and dusty" every day. This saves ICON's soil type on a 0.1 degree
# grid over Canada so index.html, push-loam.mjs and build-loam-tune.mjs put each reading on its own soil's scale.
# Digits: 3 sand, 4 sandy loam, 5 loam, 6 clay loam, 7 clay, 8 peat; 0 ice or rock (no soil numbers: the default scale).
import bz2, json, re, urllib.request
import eccodes, numpy as np
from scipy.spatial import cKDTree

BASE = "https://opendata.dwd.de/weather/nwp/icon/grib/00/"
def grib(var):
    page = urllib.request.urlopen(BASE + var + "/").read().decode()
    name = re.search(r'href="([^"]+\.grib2\.bz2)"', page).group(1)
    data = bz2.decompress(urllib.request.urlopen(BASE + var + "/" + name).read())
    g = eccodes.codes_new_from_message(data)
    v = eccodes.codes_get_values(g)
    eccodes.codes_release(g)
    return v

st, la, lo = grib("soiltyp"), np.radians(grib("clat")), np.radians(grib("clon"))
xyz = lambda a, b: np.c_[np.cos(a) * np.cos(b), np.cos(a) * np.sin(b), np.sin(a)]
land = (st >= 1) & (st <= 8)                      # 9, 10: sea water and sea ice; a lakeside spot takes the nearest land
tree = cKDTree(xyz(la[land], lo[land]))
LAT0, LAT1, LON0, LON1, STEP = 41.5, 70.0, -141.0, -52.0, 0.1
lats = np.arange(LAT0, LAT1 + 1e-9, STEP)
lons = np.arange(LON0, LON1 + 1e-9, STEP)
A, B = np.meshgrid(np.radians(lats), np.radians(lons), indexing="ij")
_, i = tree.query(xyz(A.ravel(), B.ravel()))
g = st[land][i].reshape(len(lats), len(lons)).astype(int)
g[g <= 2] = 0
out = {"v": 1, "src": "DWD ICON global SOILTYP (opendata.dwd.de), nearest land cell", "lat0": LAT0, "lon0": LON0, "step": STEP,
       "rows": ["".join(map(str, r)) for r in g]}
json.dump(out, open("data/loam-soil.json", "w"), separators=(",", ":"))
print("Wrote data/loam-soil.json:", dict(zip(*np.unique(g, return_counts=True))))
