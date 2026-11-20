# Weather model blend for BC (alex 2026-11-20: "find the best free source for the weather", "find multiple sources and
# make it compare each other to have the best result possible"; picked "own free model blend").
#
# Once a day, after the 00 UTC model runs are out, this reads four independent forecast models straight from their
# makers' free open-data servers (no Open-Meteo, so nothing here is limited to non-commercial use):
#   gem    Environment Canada GEM: HRDPS 2.5 km for the first 48 h, then GDPS 15 km   (ECCC Data Server End-use Licence)
#   ecmwf  ECMWF IFS 9 km (0.1 degree open data, 2 h after the run)                    (CC BY 4.0)
#   gfs    NOAA GFS 0.25 degree                                                         (US government, public domain)
#   icon   DWD ICON global 13 km                                                        (DWD open data, credit DWD)
# and puts each model's own numbers, per day, on one 0.1 degree grid over BC (48-60 N, 139-114 W):
#   p   water that falls (rain + melted snow), mm, x10
#   hi  daily high, degrees C, x10, at that model's own ground height
#   lo  daily low, same
#   z   each model's ground height in that cell, m (the app moves each model's temperature to the spot's height with
#       6.5 C per km, the same rate Open-Meteo uses, before comparing them)
# The app takes the middle value of the models and shows their range. One model alone never decides.
#
# Days: 09 UTC to 09 UTC (1 am to 1 am Pacific standard time), today and the next 5 days. Amounts between two model
# output times are filled in proportionally (an estimate). Highs and lows come from each model's max/min fields (or
# hourly temperatures for HRDPS).
#
# Output: data/wx/blend/<lat>_<lon>.json, one per 1 degree square (10 x 10 cells, row 0 = south edge, west to east),
# plus data/wx/blend/index.json (run, models, credits).
#
# Score: the same models' 12 UTC to 12 UTC amounts for the next two days are kept (data/wx/blend/verify/), and once
# Environment Canada's precipitation analysis (HRDPA 2.5 km, built from rain gauges and radar) for that day is out,
# each model's error is added to data/wx/blend/score.json. After a few weeks this says which model is closest in BC,
# by region, from our own numbers.
#
#   pip install eccodes numpy scipy && python3 scripts/wx-blend/build.py
#   ENV: RUN=YYYYMMDD (default: today UTC)  ONLY=gem,ecmwf,...  OUT=data/wx/blend  QUICK=1 (fewer steps, for tests)
import bz2, datetime as dt, json, math, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import eccodes, numpy as np
from scipy.spatial import cKDTree

LAT0, LAT1, LON0, LON1, STEP = 48.0, 60.0, -139.0, -114.0, 0.1
NY, NX = round((LAT1 - LAT0) / STEP), round((LON1 - LON0) / STEP)
DAYS = 6
B0 = 9                                   # day boundary, hours after the 00 UTC run
BOUND = [B0 + 24 * k for k in range(DAYS + 1)]
LAST = BOUND[-1]
RUN = os.environ.get("RUN") or dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d")
OUT = os.environ.get("OUT", "data/wx/blend")
ONLY = set(filter(None, os.environ.get("ONLY", "").split(",")))
QUICK = os.environ.get("QUICK") == "1"
UA = {"User-Agent": "trail-finder-wx-blend (github.com/allduf/trail-finder)"}
G = 9.80665
LAPSE = 0.0065


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def get(url, rng=None, tries=4):
    for k in range(tries):
        try:
            h = dict(UA)
            if rng:
                h["Range"] = "bytes=%d-%d" % rng
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err = e
        except Exception as e:  # network hiccup: try again
            err = e
        time.sleep(3 * (k + 1))
    log("  failed:", url, err)
    return None


def messages(data):
    """Every GRIB message in these bytes: [(handle info dict, values with NaN for missing)]."""
    out = []
    if not data:
        return out
    if data[:3] == b"BZh":
        data = bz2.decompress(data)
    pos = 0
    while True:
        i = data.find(b"GRIB", pos)
        if i < 0:
            break
        n = int.from_bytes(data[i + 8:i + 16], "big")   # GRIB2 total length
        g = eccodes.codes_new_from_message(data[i:i + n])
        info = {k: eccodes.codes_get(g, k) for k in ("shortName", "stepRange", "units", "gridType")}
        info["handle"] = g
        v = eccodes.codes_get_values(g).astype(np.float64)
        if eccodes.codes_get(g, "bitmapPresent"):
            v[v == eccodes.codes_get(g, "missingValue")] = np.nan
        out.append((info, v))
        pos = i + n
    return out


def latlon(info):
    g = info["handle"]
    return eccodes.codes_get_array(g, "latitudes"), eccodes.codes_get_array(g, "longitudes")


def release(msgs):
    for info, _ in msgs:
        eccodes.codes_release(info["handle"])


def xyz(lat, lon):
    a, b = np.radians(lat), np.radians(lon)
    return np.c_[np.cos(a) * np.cos(b), np.cos(a) * np.sin(b), np.sin(a)]


CLAT = LAT0 + (np.arange(NY) + 0.5) * STEP
CLON = LON0 + (np.arange(NX) + 0.5) * STEP
CA, CB = np.meshgrid(CLAT, CLON, indexing="ij")
CXYZ = xyz(CA.ravel(), CB.ravel())


class Regrid:
    """Model grid -> our 0.1 degree cells. Fine grids (HRDPS 2.5 km, ECMWF 0.1): mean of the model points in each cell.
    Coarse grids: inverse-distance mix of the 4 nearest model points to the cell centre."""

    def __init__(self, lat, lon, fine):
        lon = (np.asarray(lon) + 180) % 360 - 180
        lat = np.asarray(lat)
        m = (lat >= LAT0 - 1) & (lat <= LAT1 + 1) & (lon >= LON0 - 1) & (lon <= LON1 + 1)
        self.m = np.where(m)[0]
        la, lo = lat[self.m], lon[self.m]
        self.fine = fine
        if fine:
            i = np.floor((la - LAT0) / STEP).astype(int)
            j = np.floor((lo - LON0) / STEP).astype(int)
            ok = (i >= 0) & (i < NY) & (j >= 0) & (j < NX)
            self.bsel, self.bidx = np.where(ok)[0], (i * NX + j)[ok]
        d, k = cKDTree(xyz(la, lo)).query(CXYZ, k=4)
        w = 1 / np.maximum(d, 1e-9) ** 2
        self.k, self.w = k, w / w.sum(1, keepdims=True)

    def __call__(self, vals):
        v = np.asarray(vals, dtype=np.float64)[self.m]
        near = self.idw(v)
        if not self.fine:
            return near
        vv = v[self.bsel]
        ok = np.isfinite(vv)
        s = np.bincount(self.bidx[ok], vv[ok], NY * NX)
        c = np.bincount(self.bidx[ok], None, NY * NX)
        out = np.where(c > 0, s / np.maximum(c, 1), near)
        return out

    def idw(self, v):
        x = v[self.k]
        w = np.where(np.isfinite(x), self.w, 0)
        sw = w.sum(1)
        return np.where(sw > 0, np.nansum(np.nan_to_num(x) * w, 1) / np.maximum(sw, 1e-12), np.nan)


class Series:
    """One model's forecast on our grid: accumulated water by hour since the run, max/min temperature windows."""

    def __init__(self):
        self.acc = {0: np.zeros(NY * NX)}
        self.tmax, self.tmin = [], []      # (start h, end h, field C)
        self.z = None

    def acc_at(self, h):
        ks = sorted(self.acc)
        if h in self.acc:
            return self.acc[h]
        lo = [k for k in ks if k < h]
        hi = [k for k in ks if k > h]
        if not lo or not hi:
            return None
        a, b = lo[-1], hi[0]
        f = (h - a) / (b - a)
        return self.acc[a] * (1 - f) + self.acc[b] * f

    def days(self):
        P, HI, LO = [], [], []
        for d in range(DAYS):
            s, e = BOUND[d], BOUND[d + 1]
            a, b = self.acc_at(s), self.acc_at(e)
            P.append(None if a is None or b is None else np.maximum(b - a, 0))
            for wins, out, fn in ((self.tmax, HI, np.fmax), (self.tmin, LO, np.fmin)):
                inw = [w for w in wins if s < (w[0] + w[1]) / 2 <= e]
                cover = sum(w[1] - w[0] for w in inw)
                if cover < 18:
                    out.append(None)
                    continue
                f = inw[0][2]
                for w in inw[1:]:
                    f = fn(f, w[2])
                out.append(f)
        return P, HI, LO


def step_window(sr):
    a, _, b = str(sr).partition("-")
    return (int(a), int(b)) if b else (int(a), int(a))


def kelvin(v, info):
    return v - 273.15 if str(info["units"]).startswith("K") or np.nanmean(v) > 150 else v


def metres_height(v, info):
    u = str(info["units"])
    if info["shortName"] == "z" or "m**2" in u or "m2" in u:
        return v / G
    if "dam" in u:
        return v * 10
    return v


def water_mm(v, info):
    return v * 1000 if str(info["units"]).strip() == "m" else v


def run_date():
    return dt.datetime.strptime(RUN, "%Y%m%d")


def pool_get(urls, n=6):
    with ThreadPoolExecutor(n) as ex:
        return list(ex.map(lambda u: get(*u) if isinstance(u, tuple) else get(u), urls))


# ---------- Environment Canada GEM: HRDPS 2.5 km (0-48 h) then GDPS 15 km ----------
def eccc_url(model, var, h):
    if model == "hrdps":
        return (f"https://dd.weather.gc.ca/{RUN}/WXO-DD/model_hrdps/continental/2.5km/00/{h:03d}/"
                f"{RUN}T00Z_MSC_HRDPS_{var}_RLatLon0.0225_PT{h:03d}H.grib2")
    return (f"https://dd.weather.gc.ca/{RUN}/WXO-DD/model_gdps/15km/00/{h:03d}/"
            f"{RUN}T00Z_MSC_GDPS_{var}_LatLon0.15_PT{h:03d}H.grib2")


def gem():
    S = Series()
    # HRDPS
    msgs = messages(get(eccc_url("hrdps", "HGT_Sfc", 0)))
    if not msgs:
        log("  HRDPS run not found")
        return None
    rg = Regrid(*latlon(msgs[0][0]), fine=True)
    zh = rg(metres_height(msgs[0][1], msgs[0][0]))
    release(msgs)
    S.z = zh
    steps = range(3, 49, 3)
    hours = range(1, 49) if not QUICK else range(3, 49, 3)
    datas = pool_get([eccc_url("hrdps", "APCP_Sfc", h) for h in steps])
    for h, d in zip(steps, datas):
        for info, v in messages(d):
            S.acc[h] = rg(water_mm(v, info))
            eccodes.codes_release(info["handle"])
    datas = pool_get([eccc_url("hrdps", "TMP_AGL-2m", h) for h in hours])
    prev = 0
    for h, d in zip(hours, datas):
        for info, v in messages(d):
            t = rg(kelvin(v, info))
            S.tmax.append((prev, h, t)); S.tmin.append((prev, h, t))
            eccodes.codes_release(info["handle"])
        prev = h
    log("  HRDPS: %d water steps, %d temperature hours" % (len(S.acc) - 1, len(S.tmax)))
    # GDPS from 48 h, joined onto HRDPS: water added from the HRDPS 48 h total, temperatures moved to HRDPS heights.
    msgs = messages(get(eccc_url("gdps", "GeopotentialHeight_Sfc", 0)))
    if not msgs:
        log("  GDPS run not found: GEM stops at 48 h")
        return S
    rgg = Regrid(*latlon(msgs[0][0]), fine=False)
    zg = rgg(metres_height(msgs[0][1], msgs[0][0]))
    release(msgs)
    shift = LAPSE * (zg - zh)              # GDPS temperature at HRDPS ground height
    gsteps = list(range(48, LAST + 4, 3))
    datas = pool_get([eccc_url("gdps", "Precip-Accum_Sfc", h) for h in gsteps])
    base = None
    for h, d in zip(gsteps, datas):
        for info, v in messages(d):
            a = rgg(water_mm(v, info))
            if h == 48:
                base = a
            elif base is not None and 48 in S.acc:
                S.acc[h] = S.acc[48] + np.maximum(a - base, 0)
            eccodes.codes_release(info["handle"])
    for var, wins in (("AirTemp-Max_AGL-2m", S.tmax), ("AirTemp-Min_AGL-2m", S.tmin)):
        datas = pool_get([eccc_url("gdps", var, h) for h in gsteps[1:]])
        for h, d in zip(gsteps[1:], datas):
            for info, v in messages(d):
                a, b = step_window(info["stepRange"])
                if a == b:
                    a = h - 3
                a = max(a, 48)
                wins.append((a, h, rgg(kelvin(v, info)) + shift))
                eccodes.codes_release(info["handle"])
    log("  GDPS: water to %d h" % max(S.acc))
    return S


# ---------- ECMWF IFS 0.1 degree open data ----------
def ecmwf():
    base = f"https://data.ecmwf.int/forecasts/{RUN}/00z/ifs/0p1/oper/{RUN}000000-"
    S = Series()
    steps = list(range(3, 145, 3)) + list(range(150, LAST + 7, 6))
    if QUICK:
        steps = [s for s in steps if s % 6 == 0]

    def index(h):
        raw = get(base + f"{h}h-oper-fc-sfc.index")
        if not raw:
            return {}
        out = {}
        for line in raw.decode().splitlines():
            j = json.loads(line)
            out.setdefault(j["param"], (j["_offset"], j["_offset"] + j["_length"] - 1))
        return out

    i0 = index(0)
    if "z" not in i0:
        log("  ECMWF run not found")
        return None
    msgs = messages(get(base + "0h-oper-fc-sfc.grib2", i0["z"]))
    rg = Regrid(*latlon(msgs[0][0]), fine=True)
    S.z = rg(metres_height(msgs[0][1], msgs[0][0]))
    release(msgs)
    with ThreadPoolExecutor(8) as ex:
        idx = dict(zip(steps, ex.map(index, steps)))
    jobs = []
    for h in steps:
        ix = idx.get(h) or {}
        for p in ("tp", "mx2t3", "mn2t3", "mx2t6", "mn2t6"):
            if p in ix:
                jobs.append((h, p, (base + f"{h}h-oper-fc-sfc.grib2", ix[p])))
    datas = pool_get([j[2] for j in jobs], 8)
    for (h, p, _), d in zip(jobs, datas):
        for info, v in messages(d):
            if p == "tp":
                S.acc[h] = rg(water_mm(v, info))
            else:
                a, b = step_window(info["stepRange"])
                (S.tmax if p.startswith("mx") else S.tmin).append((a, b, rg(kelvin(v, info))))
            eccodes.codes_release(info["handle"])
    log("  ECMWF: water to %d h, %d max windows" % (max(S.acc), len(S.tmax)))
    return S


# ---------- NOAA GFS 0.25 degree (NOAA open data on AWS: only the fields needed, by byte range) ----------
def gfs():
    S = Series()
    base = f"https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{RUN}/00/atmos/gfs.t00z.pgrb2.0p25.f"

    def ranges(h, want):
        raw = get(base + f"{h:03d}.idx")
        if not raw:
            return []
        lines = raw.decode().splitlines()
        out = []
        for k, line in enumerate(lines):
            f = line.split(":")
            if len(f) < 6 or not any(f[3] == v and f[4] == lev and (acc is None or acc in f[5]) for v, lev, acc in want):
                continue
            start = int(f[1])
            end = int(lines[k + 1].split(":")[1]) - 1 if k + 1 < len(lines) else None
            if end is not None:
                out.append((base + f"{h:03d}", (start, end)))
        return out

    r0 = ranges(0, [("HGT", "surface", None)])
    if not r0:
        log("  GFS run not found")
        return None
    msgs = messages(get(*r0[0]))
    rg = Regrid(*latlon(msgs[0][0]), fine=False)
    S.z = rg(msgs[0][1])
    release(msgs)
    steps = list(range(3, LAST + 4, 3))
    want = [("APCP", "surface", "0-"), ("TMAX", "2 m above ground", None), ("TMIN", "2 m above ground", None)]
    with ThreadPoolExecutor(6) as ex:
        jobs = [j for js in ex.map(lambda h: ranges(h, want), steps) for j in js]
    for d in pool_get(jobs, 6):
        for info, v in messages(d):
            a, b = step_window(info["stepRange"])
            if info["shortName"] == "tp":
                if a == 0:
                    S.acc[b] = rg(v)
            elif info["shortName"] in ("tmax", "mx2t"):
                S.tmax.append((a, b, rg(kelvin(v, info))))
            elif info["shortName"] in ("tmin", "mn2t"):
                S.tmin.append((a, b, rg(kelvin(v, info))))
            eccodes.codes_release(info["handle"])
    log("  GFS: water to %d h, %d max windows" % (max(S.acc), len(S.tmax)))
    return S


# ---------- DWD ICON global 13 km ----------
def icon():
    base = "https://opendata.dwd.de/weather/nwp/icon/grib/00/"
    S = Series()
    inv = lambda v: f"{base}{v}/icon_global_icosahedral_time-invariant_{RUN}00_{v.upper()}.grib2.bz2"
    one = lambda v, h: f"{base}{v}/icon_global_icosahedral_single-level_{RUN}00_{h:03d}_{v.upper()}.grib2.bz2"
    la, lo, hs = (messages(d) for d in pool_get([inv("clat"), inv("clon"), inv("hsurf")], 3))
    if not la or not lo or not hs:
        log("  ICON run not found")
        return None
    rg = Regrid(la[0][1], lo[0][1], fine=False)
    S.z = rg(hs[0][1])
    for m in (la, lo, hs):
        release(m)
    psteps = sorted(set(BOUND) | {12, 36, 60})   # day edges + the score's 12 UTC edges
    datas = pool_get([one("tot_prec", h) for h in psteps], 6)
    for h, d in zip(psteps, datas):
        for info, v in messages(d):
            S.acc[h] = rg(v)
            eccodes.codes_release(info["handle"])
    tsteps = list(range(6, LAST + 4, 6))
    for var, wins in (("tmax_2m", S.tmax), ("tmin_2m", S.tmin)):
        datas = pool_get([one(var, h) for h in tsteps], 6)
        for h, d in zip(tsteps, datas):
            for info, v in messages(d):
                a, b = step_window(info["stepRange"])
                wins.append((a, b, rg(kelvin(v, info))))
                eccodes.codes_release(info["handle"])
    log("  ICON: water to %d h, %d max windows" % (max(S.acc), len(S.tmax)))
    return S


MODELS = [
    ("gem", gem, "Environment Canada GEM (HRDPS 2.5 km to 48 h, then GDPS 15 km)",
     "Contains information licenced under the Data Server End-use Licence of Environment and Climate Change Canada"),
    ("ecmwf", ecmwf, "ECMWF IFS 9 km (0.1 degree open data)", "ECMWF open data, CC BY 4.0"),
    ("gfs", gfs, "NOAA GFS 0.25 degree", "NOAA/NCEP GFS via NOAA Open Data Dissemination on AWS (US government work)"),
    ("icon", icon, "DWD ICON global 13 km", "Deutscher Wetterdienst (DWD) open data"),
]


# ---------- Score against Environment Canada's precipitation analysis ----------
REGIONS = {  # rough parts of BC, by cell centre
    "coast": lambda la, lo: (lo < -121.5) & (la < 52),
    "south-interior": lambda la, lo: (lo >= -121.5) & (la < 52),
    "north": lambda la, lo: la >= 52,
}


def hrdpa(end):
    """HRDPA 24 h water ending 12 UTC on date end (YYYYMMDD), on our grid, or None."""
    for kind in ("HRDPA", "HRDPA-Prelim"):
        d = get(f"https://dd.weather.gc.ca/{end}/WXO-DD/model_hrdpa/2.5km/12/{end}T12Z_MSC_{kind}_APCP-Accum24h_Sfc_RLatLon0.0225_PT0H.grib2")
        m = messages(d)
        if m:
            rg = Regrid(*latlon(m[0][0]), fine=True)
            v = rg(m[0][1])
            release(m)
            return v, kind
    return None, None


def score():
    vdir = os.path.join(OUT, "verify")
    os.makedirs(vdir, exist_ok=True)
    path = os.path.join(OUT, "score.json")
    sc = json.load(open(path)) if os.path.exists(path) else {"v": 1, "rows": []}
    have = {(r["date"], r["lead"]) for r in sc["rows"]}
    land = None
    lp = os.path.join(vdir, "land.json")
    if os.path.exists(lp):
        land = np.array(json.load(open(lp))["land"], dtype=bool)
    la, lo = CA.ravel(), CB.ravel()
    for f in sorted(os.listdir(vdir)):
        m = re.match(r"(\d{8})\.json$", f)
        if not m:
            continue
        end = m.group(1)
        if end >= RUN:            # its 12 UTC analysis isn't out yet
            continue
        rec = json.load(open(os.path.join(vdir, f)))
        if all((end, lead) in have for lead in rec):
            os.remove(os.path.join(vdir, f))
            continue
        obs, kind = hrdpa(end)
        if obs is None:
            if end < (run_date() - dt.timedelta(days=4)).strftime("%Y%m%d"):
                os.remove(os.path.join(vdir, f))
            continue
        for lead, per in rec.items():
            if (end, lead) in have:
                continue
            row = {"date": end, "lead": lead, "obs": kind, "regions": {}}
            fc = {k: np.array(v, dtype=np.float64) / 10 for k, v in per.items()}
            fc = {k: np.where(v < 0, np.nan, v) for k, v in fc.items()}
            if len(fc) >= 2:
                fc["middle"] = np.nanmedian(np.vstack(list(fc.values())), 0)
            for rname, fn in REGIONS.items():
                sel = fn(la, lo) & np.isfinite(obs)
                if land is not None:
                    sel &= land
                r = {}
                for k, v in fc.items():
                    s = sel & np.isfinite(v)
                    if s.sum() < 50:
                        continue
                    e = v[s] - obs[s]
                    wet = obs[s] >= 1
                    r[k] = {"mae": round(float(np.abs(e).mean()), 2), "bias": round(float(e.mean()), 2),
                            "wet_mae": round(float(np.abs(e[wet]).mean()), 2) if wet.sum() >= 20 else None,
                            "n": int(s.sum()), "obs_mean": round(float(obs[s].mean()), 2)}
                row["regions"][rname] = r
            sc["rows"].append(row)
            have.add((end, lead))
            log("  score %s lead %s (%s): %s" % (end, lead, kind, {k: v["mae"] for k, v in row["regions"].get("coast", {}).items()}))
        if all((end, lead) in have for lead in rec):
            os.remove(os.path.join(vdir, f))
    sc["rows"] = sorted(sc["rows"], key=lambda r: (r["date"], r["lead"]))[-180:]
    # Summary: mean error per model and region over all scored days, smallest first.
    summ = {}
    for rname in REGIONS:
        acc = {}
        for r in sc["rows"]:
            for k, v in r["regions"].get(rname, {}).items():
                acc.setdefault(k, []).append(v["mae"])
        summ[rname] = sorted(({"model": k, "mae": round(sum(v) / len(v), 2), "days": len(v)} for k, v in acc.items()),
                             key=lambda x: x["mae"])
    sc["summary"] = summ
    json.dump(sc, open(path, "w"), separators=(",", ":"))


def save_verify(series):
    """The next two 12 UTC to 12 UTC amounts of each model, to score once the analysis is out."""
    vdir = os.path.join(OUT, "verify")
    os.makedirs(vdir, exist_ok=True)
    r0 = run_date()
    for lead, (s, e) in (("1", (12, 36)), ("2", (36, 60))):
        end = (r0 + dt.timedelta(hours=e)).strftime("%Y%m%d")
        p = os.path.join(vdir, end + ".json")
        rec = json.load(open(p)) if os.path.exists(p) else {}
        per = {}
        for name, S in series.items():
            a, b = S.acc_at(s), S.acc_at(e)
            if a is None or b is None:
                continue
            per[name] = [int(x) for x in np.nan_to_num(np.round(np.maximum(b - a, 0) * 10), nan=-1)]
        if per:
            rec[lead] = per
            json.dump(rec, open(p, "w"), separators=(",", ":"))


def save_land():
    """Land cells (ECMWF land-sea mask >= 0.5), once: the score leaves out the sea, where the analysis has few gauges."""
    p = os.path.join(OUT, "verify", "land.json")
    if os.path.exists(p):
        return
    base = f"https://data.ecmwf.int/forecasts/{RUN}/00z/ifs/0p1/oper/{RUN}000000-0h-oper-fc-sfc"
    raw = get(base + ".index")
    if not raw:
        return
    for line in raw.decode().splitlines():
        j = json.loads(line)
        if j["param"] == "lsm":
            m = messages(get(base + ".grib2", (j["_offset"], j["_offset"] + j["_length"] - 1)))
            rg = Regrid(*latlon(m[0][0]), fine=True)
            land = rg(m[0][1]) >= 0.5
            release(m)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            json.dump({"land": [int(x) for x in land]}, open(p, "w"), separators=(",", ":"))
            return


def q(a, scale=10):
    if a is None:
        return None
    return [None if not np.isfinite(x) else int(round(x * scale)) for x in a]


def main():
    os.makedirs(OUT, exist_ok=True)
    series, names = {}, []
    for name, fn, label, credit in MODELS:
        if ONLY and name not in ONLY:
            continue
        log("Reading", label)
        try:
            S = fn()
        except Exception as e:  # one model failing never stops the others
            log("  %s failed: %r" % (name, e))
            S = None
        if S is not None and S.z is not None and len(S.acc) > 1:
            series[name] = S
            names.append(name)
    if len(series) < 2:
        log("Fewer than 2 models: keeping the last files")
        sys.exit(1)
    per = {n: series[n].days() for n in names}
    r0 = run_date()
    dates = [(r0 + dt.timedelta(days=d)).strftime("%Y-%m-%d") for d in range(DAYS)]
    tiles = 0
    for ty in range(int(LAT0), int(LAT1)):
        for tx in range(int(LON0), int(LON1)):
            i0, j0 = round((ty - LAT0) / STEP), round((tx - LON0) / STEP)
            cells = np.array([(i0 + a) * NX + (j0 + b) for a in range(10) for b in range(10)])
            t = {"v": 1, "run": RUN + "T00Z", "days": dates, "models": names, "lat0": ty, "lon0": tx, "step": STEP,
                 "z": [q(series[n].z[cells], 1) for n in names],
                 "p": [[q(x[cells]) if x is not None else None for x in per[n][0]] for n in names],
                 "hi": [[q(x[cells]) if x is not None else None for x in per[n][1]] for n in names],
                 "lo": [[q(x[cells]) if x is not None else None for x in per[n][2]] for n in names]}
            json.dump(t, open(os.path.join(OUT, f"{ty}_{tx}.json"), "w"), separators=(",", ":"))
            tiles += 1
    meta = {"v": 1, "run": RUN + "T00Z", "made": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
            "days": dates, "dayStartUTC": B0, "box": [LAT0, LON0, LAT1, LON1], "step": STEP, "lapse": LAPSE,
            "models": [{"id": n, "name": l, "credit": c} for n, f, l, c in MODELS if n in series]}
    json.dump(meta, open(os.path.join(OUT, "index.json"), "w"), indent=1)
    log("Wrote %d squares, models: %s" % (tiles, ", ".join(names)))
    # A quick look at one place, for the log: Whistler village.
    c = int((50.11 - LAT0) / STEP) * NX + int((-122.95 - LON0) / STEP)
    for n in names:
        P, HI, LO = per[n]
        log("  Whistler %-5s z %4.0f m  water %s  high %s" % (n, series[n].z[c], [None if x is None else round(float(x[c]), 1) for x in P],
                                                              [None if x is None else round(float(x[c]), 1) for x in HI]))
    try:
        save_land()
        save_verify(series)
        score()
    except Exception as e:
        log("Score step failed (forecast files are saved): %r" % e)


if __name__ == "__main__":
    main()
