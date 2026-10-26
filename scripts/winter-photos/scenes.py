"""Finds the Sentinel-2 passes for new Winter photo blocks and adds them to data/winter-scenes.json:
    python3 scripts/winter-photos/scenes.py blocks.json        (a list of zoom-11 [x, y] blocks)
For each 100 km Sentinel-2 square that the blocks touch, the 8 least cloudy passes of last winter are kept (build.py
takes, pixel by pixel, the middle value of the clear ones). East of the Rockies the snow melts earlier in spring, so
there the passes come from mid-January to mid-March instead of February and March (free search: Earth Search, AWS)."""
import json, math, os, sys, urllib.request
from collections import defaultdict

here = os.path.dirname(os.path.abspath(__file__))
listed = os.path.join(here, "../../data/winter-scenes.json")
SEARCH = "https://earth-search.aws.element84.com/v1/search"
BUCKET = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/"
KEEP = int(os.environ.get("KEEP", 8))

def lnglat(x, y, z=11):
    n = 2 ** z
    return x / n * 360 - 180, math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))

def search(bbox, when):
    body = {"collections": ["sentinel-2-l2a"], "bbox": bbox, "datetime": when, "limit": 100,
            "query": {"eo:cloud_cover": {"lt": 60}},
            "fields": {"include": ["id", "bbox", "properties.eo:cloud_cover", "assets.red.href"], "exclude": ["geometry"]}}
    req = urllib.request.Request(SEARCH, json.dumps(body).encode(), {"Content-Type": "application/json"})
    for _ in range(4):
        try: return json.load(urllib.request.urlopen(req, timeout=60))["features"]
        except Exception as e: err = e
    raise err

if __name__ == "__main__":
    blocks = json.load(open(sys.argv[1]))
    found = defaultdict(dict)
    for k, (x, y) in enumerate(blocks):
        w, n = lnglat(x, y); e, s = lnglat(x + 1, y + 1)
        when = "2026-02-01T00:00:00Z/2026-03-31T23:59:59Z" if w < -110 else "2026-01-15T00:00:00Z/2026-03-15T23:59:59Z"
        for f in search([w, s, e, n], when):
            href = f["assets"]["red"]["href"]
            if not href.startswith(BUCKET): continue
            tile = f["id"].split("_")[1]
            found[tile][f["id"]] = {"id": f["id"], "dir": href[len(BUCKET):-len("B04.tif")], "bbox": [round(v, 6) for v in f["bbox"]],
                                    "cloud": round(f["properties"]["eo:cloud_cover"], 1)}
        if k % 25 == 0: print(k, "of", len(blocks), "blocks,", len(found), "squares", flush=True)
    have = json.load(open(listed)) if os.path.exists(listed) else {}
    known = {s["id"] for v in have.values() for s in v}
    for tile, scenes in found.items():
        best = sorted((s for s in scenes.values() if s["id"] not in known), key=lambda s: s["cloud"])[:KEEP]
        if best and tile not in have: have[tile] = best
    json.dump(have, open(listed, "w"))
    print(len(found), "squares,", sum(len(v) for v in have.values()), "passes listed")
