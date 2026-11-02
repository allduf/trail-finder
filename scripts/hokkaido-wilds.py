"""Hokkaido Wilds ski touring routes for Skiing in Japan (alex 2026-11-01: "Did you use Hokkaido wild for backcountry
skiing in Japan?"). hokkaidowilds.org (Rob Thomson and friends) has ~160 Hokkaido ski tour routes, each with a GPX
track, distance, time, ascent, high point, a 1-10 difficulty and A-D grades, the main aspects, the trailhead and
notes on parking and safety. It's all CC BY-SA 4.0 (hokkaidowilds.org/hokkaido-wilds-attribution-guide): free to
use and adapt, crediting the author and hokkaidowilds.org, adaptations under the same licence.
    python3 scripts/hokkaido-wilds.py
reads the route list from the site's sitemap, one page and GPX at a time (1.5 s apart), and writes
data/ski-japan-hw/hw.json (the jp/w square format: { routes }) and its index.json, which winter.js loads like the
other Japan squares (CAN_DIRS). Hand-run, kept in main; run it again before a trip or once a season."""
import html, json, math, os, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

SITE = "https://hokkaidowilds.org"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../data/ski-japan-hw")
UA = {"User-Agent": "Mozilla/5.0 (Trail Finder; ski route import, CC BY-SA credited)"}

def get(url):
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(urllib.parse.quote(url, safe=":/?&=%#"), headers=UA), timeout=60) as r: return r.read().decode("utf8", "ignore")
        except Exception as e:
            err = e; time.sleep(3 * (i + 1))
    raise err

def text(h):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", h, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t))
    t = re.sub(r"[ \t\xa0]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t)

def para(t, head, n=420):
    """The text after a heading line, up to the next short heading-like line, as one paragraph."""
    i = t.find("\n" + head + "\n")
    if i < 0: return ""
    out = []
    for line in t[i + len(head) + 2:].split("\n"):
        s = line.strip()
        if not s: continue
        if out and len(s) < 40 and not re.search(r"[.,;:)]$", s) and s[0].isupper() and len(" ".join(out)) > 60: break
        if s.startswith("TRAILHEAD") or s.startswith("NOTE:"): break
        out.append(s)
        if len(" ".join(out)) > n: break
    p = re.sub(r"\s+([.,;:)])", r"\1", " ".join(out)).strip()
    if len(p) > n: p = p[:n].rsplit(" ", 1)[0] + "…"
    return p

def sentences(s, n):
    """Whole sentences, up to about n characters."""
    s = s.strip()
    if len(s) <= n and s.endswith((".", "!", "?")): return s
    cut = s[:n]
    ends = [m.end() for m in re.finditer(r"(?<!\bMt)(?<!\bSt)(?<!\bapprox)[.!?](?= )", cut)]   # "Mt. Fuppushi" isn't an end
    return cut[:ends[-1]] if ends and ends[-1] > 40 else cut.rsplit(" ", 1)[0] + "…"

def simplify(pts, tol=8):
    """Douglas-Peucker in metres."""
    if len(pts) < 3: return pts
    k = math.cos(math.radians(pts[0][0]))
    def d(p, a, b):
        ax, ay, bx, by, px, py = a[1] * k, a[0], b[1] * k, b[0], p[1] * k, p[0]
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        u = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L))
        return math.hypot(px - ax - u * dx, py - ay - u * dy) * 111320
    keep, stack = {0, len(pts) - 1}, [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        best, bi = 0, None
        for m in range(i + 1, j):
            v = d(pts[m], pts[i], pts[j])
            if v > best: best, bi = v, m
        if bi is not None and best > tol: keep.add(bi); stack += [(i, bi), (bi, j)]
    return [pts[m] for m in sorted(keep)]

def gpx_lines(xml):
    root = ET.fromstring(xml)
    ns = {"g": root.tag[1:].split("}")[0]} if root.tag.startswith("{") else {"g": ""}
    q = (lambda s: s.replace("g:", "")) if not ns["g"] else (lambda s: s)
    lines = []
    for seg in root.findall(q(".//g:trkseg"), ns) + root.findall(q(".//g:rte"), ns):
        pts = [(float(p.get("lat")), float(p.get("lon"))) for p in seg if p.tag.endswith("trkpt") or p.tag.endswith("rtept")]
        pts = simplify(pts)
        if len(pts) >= 2: lines.append([round(v, 5) for p in pts for v in p])
    return lines

def route(url):
    h = get(url); t = text(h)
    slug = url.rstrip("/").rsplit("/", 1)[1]
    title = html.unescape((re.search(r'property="og:title" content="([^"]+)"', h) or re.search(r"<title>([^<]+)", h)).group(1))
    title = re.sub(r"\s*\|\s*HokkaidoWilds\.org$", "", title).strip()
    desc = html.unescape((re.search(r'name="description" content="([^"]*)"', h) or [None, ""])[1]).strip()
    stats = {}
    for val, key in re.findall(r"\n([^\n]{1,24})\n(Distance|Time|Ascent|Highest point|Difficulty|Best season)(?=\n)", t):
        stats.setdefault(key, val.strip())
    by = re.search(r"\nby \n([^\n]+)\n", t)
    grade = re.search(r"\nTotals\n(\d+)/100\n", t)
    asp = re.search(r"main aspect skiers are exposed to on the descent and/or ascent is \n?([A-Za-z\- ,]+?)\n?\.", t)
    other = re.search(r"Other aspects that may also be encountered[^:]*: \n?([A-Za-z\- ,]+?)\n?\.", t)
    gpx = re.search(r'href=["\']?([^"\'\s>]+\.gpx)', h)
    head = re.search(r'href=["\']?https://(?:www\.)?google\.[a-z.]+/maps[^"\'\s>]*?[@=/](-?\d+\.\d+),\s*(-?\d+\.\d+)', h)
    safety = ""
    for k in ["Snow and \nroute safety", "Route safety", "Snow and route safety"]:
        i = t.find(k)
        if i >= 0:
            s = re.sub(r"\s+", " ", t[i + len(k):i + len(k) + 900]).strip()
            s = re.split(r" (?:Notify the police|Furano area avalanche report|[^.]{0,80}Difficulty Rating Category)", s)[0]
            safety = sentences(s, 420)
            break
    lines = []
    if gpx:
        time.sleep(1.5)
        try: lines = gpx_lines(get(gpx.group(1)))
        except Exception as e: print("  gpx failed", e, file=sys.stderr)
    tags = {"hw:about": sentences(desc.replace("…", "").strip(), 400)}
    if stats.get("Difficulty"): tags["hw:difficulty"] = stats["Difficulty"].strip() + (f" (grade score {grade.group(1)}/100)" if grade else "")
    for k, n in [("Distance", "hw:distance"), ("Time", "hw:time"), ("Ascent", "hw:ascent"), ("Highest point", "hw:high"), ("Best season", "hw:season")]:
        if stats.get(k): tags[n] = stats[k]
    if asp: tags["hw:aspect"] = asp.group(1).strip() + (f" (also {other.group(1).strip()})" if other else "")
    loc = para(t, "Location")
    if loc: tags["hw:trailhead"] = sentences(loc, 300)
    if "Parking is" in t:
        i = t.find("Parking is"); tags["hw:parking"] = re.sub(r"\s+", " ", t[i:i + 300]).split(". ")[0].strip() + "."
    if safety: tags["hw:safety"] = safety
    tags["hw:by"] = by.group(1).strip() if by else "Rob Thomson"
    r = {"id": "hw-" + slug, "src": "hw", "type": "tour", "name": title.replace(" Ski Touring", "").replace(" Backcountry Skiing", ""), "diff": "",
         "g": lines, "tags": tags, "pv": "JP", "url": url}
    if head: r["start"] = [round(float(head.group(1)), 5), round(float(head.group(2)), 5)]
    return r

def hut(url):
    """A mountain hut page: its name, where it is (the page's Google Maps link) and its first paragraph (free or not,
    booking, stove, how many it sleeps)."""
    h = get(url); t = text(h)
    title = html.unescape((re.search(r'property="og:title" content="([^"]+)"', h) or re.search(r"<title>([^<]+)", h)).group(1))
    title = re.sub(r"\s*\|\s*HokkaidoWilds\.org$", "", title).strip()
    m = re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", h) or re.search(r"google\.[a-z.]+/maps[^\"'\s>]*?@(-?\d+\.\d+),(-?\d+\.\d+)", h)
    if not m: return None
    lat, lon = float(m.group(1)), float(m.group(2))
    if not (41 < lat < 46 and 139 < lon < 146): return None
    about = ""
    for line in t.split("\n"):
        if len(line) > 120 and not line.startswith("Posted"): about = sentences(line.strip(), 420); break
    by = re.search(r"\nby \n([^\n]+)\n", t)
    return {"id": "hw-hut-" + url.rstrip("/").rsplit("/", 1)[1], "src": "hw", "kind": "alpine_hut", "name": title, "lat": round(lat, 5), "lon": round(lon, 5),
            "tags": {"hw:about": about, "hw:by": by.group(1).strip() if by else "Rob Thomson"}, "url": url}

if __name__ == "__main__":
    xml = get(SITE + "/wp-sitemap-posts-ski_touring-1.xml")
    urls = re.findall(r"<loc>([^<]+)</loc>", xml)
    print(len(urls), "routes listed")
    routes = []
    for k, u in enumerate(urls):
        time.sleep(1.5)
        try:
            r = route(u)
            if r["g"]: routes.append(r)
            print(k, len(r["g"]), r["name"], flush=True)
        except Exception as e:
            print(k, "failed", u, e, file=sys.stderr)
    huts = []
    for u in re.findall(r"<loc>([^<]+)</loc>", get(SITE + "/wp-sitemap-posts-hut-1.xml")):
        time.sleep(1.5)
        try:
            x = hut(u)
            if x: huts.append(x); print("hut", x["name"], flush=True)
        except Exception as e:
            print("hut failed", u, e, file=sys.stderr)
    os.makedirs(OUT, exist_ok=True)
    lats = [v for r in routes for g in r["g"] for v in g[0::2]]; lons = [v for r in routes for g in r["g"] for v in g[1::2]]
    note = "Hokkaido Wilds ski tour routes (hokkaidowilds.org, CC BY-SA 4.0; credit the author and hokkaidowilds.org). Built by scripts/hokkaido-wilds.py."
    json.dump({"note": note, "routes": routes, "huts": huts}, open(os.path.join(OUT, "hw.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    kb = round(os.path.getsize(os.path.join(OUT, "hw.json")) / 1024)
    json.dump({"note": note, "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
               "tiles": {"hw": {"r": len(routes), "h": len(huts), "l": 0, "box": [min(lats), min(lons), max(lats), max(lons)], "kb": kb}}},
              open(os.path.join(OUT, "index.json"), "w"), separators=(",", ":"))
    print(len(routes), "routes with a track,", kb, "KB")
