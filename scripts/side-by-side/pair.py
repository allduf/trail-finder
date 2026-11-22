"""Side-by-side pairs (side-by-side.yml): the iPhone and Android screenshots of the same step next to each other, and a
plain list of what differs between the two phones.
  python3 scripts/side-by-side/pair.py out en   -> out/side-by-side-en/{differences.md, index.html, pairs/*.jpg}
Reads out/ios-<lang>/steps.json and out/android-<lang>/steps.json (run.mjs)."""
import json, os, sys, html
from PIL import Image, ImageDraw, ImageFont

root, lang = sys.argv[1], sys.argv[2]
dest = os.path.join(root, f"side-by-side-{lang}")
os.makedirs(os.path.join(dest, "pairs"), exist_ok=True)


def load(p):
    # Every job's part (steps-<TAG>.json): the part with the first open first, then the sports in their usual order.
    import glob
    files = glob.glob(os.path.join(root, f"{p}-{lang}", "steps*.json"))
    if not files:
        return None
    order = ["all", "mtb", "ski", "hike", "fish", "hunt", "moto"]
    files.sort(key=lambda f: order.index(os.path.basename(f)[6:-5]) if os.path.basename(f)[6:-5] in order else 99)
    steps = []
    for f in files:
        with open(f) as fh:
            steps += json.load(fh).get("steps", [])
    return {"steps": steps}


ios, andr = load("ios"), load("android")
if not ios and not andr:
    sys.exit(0)
I = {s["key"]: s for s in (ios or {}).get("steps", [])}
A = {s["key"]: s for s in (andr or {}).get("steps", [])}
order = [s["key"] for s in (ios or {}).get("steps", [])] + [k for k in A if k not in I]
try:
    font = ImageFont.truetype("DejaVuSans-Bold.ttf", 34)
except Exception:
    font = ImageFont.load_default()
H = 1400


def img(p, s):
    if not s or not s.get("shot"):
        return None
    f = os.path.join(root, f"{p}-{lang}", "shots", s["shot"])
    try:
        im = Image.open(f).convert("RGB")
        return im.resize((round(im.width * H / im.height), H))
    except Exception:
        return None


diffs, cards = [], []
for n, k in enumerate(order, 1):
    i, a = I.get(k), A.get(k)
    name = (i or a)["name"]
    d = []
    if not i and not (a or {}).get("androidOnly"):
        d.append("only on Android")
    if not a:
        d.append("only on iPhone")
    if i and not i["ok"]:
        d.append("iPhone: " + " · ".join(i["problems"]))
    if a and not a["ok"]:
        d.append("Android: " + " · ".join(a["problems"]))
    si, sa = (i or {}).get("state") or {}, (a or {}).get("state") or {}
    if si and sa:
        for f, label in (("open", "open on screen"), ("base", "map style"), ("native3d", "native 3D open"), ("web3d", "web 3D open"), ("sport", "sport")):
            if si.get(f) != sa.get(f):
                d.append(f"{label}: iPhone {si.get(f)!r}, Android {sa.get(f)!r}")
        bi, ba = set(si.get("buttons") or []), set(sa.get("buttons") or [])
        if bi - ba:
            d.append("buttons only on iPhone: " + ", ".join(sorted(bi - ba))[:300])
        if ba - bi:
            d.append("buttons only on Android: " + ", ".join(sorted(ba - bi))[:300])
    if d:
        diffs.append((name, d))
    ii, ai = img("ios", i), img("android", a)
    pic = ""
    if ii or ai:
        w = (ii.width if ii else 650) + (ai.width if ai else 650) + 30
        c = Image.new("RGB", (w, H + 60), "white")
        dr = ImageDraw.Draw(c)
        x = 0
        for label, im in (("iPhone", ii), ("Android", ai)):
            dr.text((x + 10, 10), label, fill="black", font=font)
            if im:
                c.paste(im, (x, 60))
                x += im.width + 30
            else:
                dr.text((x + 10, 300), "(no screenshot)", fill="gray", font=font)
                x += 680
        pic = f"pairs/{n:03d}-{k.replace('/', '-')}.jpg"
        c.save(os.path.join(dest, pic), quality=72)
    cards.append((name, pic, d))

head = f"## iPhone vs Android ({lang}): {len(diffs)} step(s) differ of {len(order)}\n\n"
md = head + "\n".join(f"- **{html.escape(n)}**: " + "; ".join(d) for n, d in diffs) + "\n"
with open(os.path.join(dest, "differences.md"), "w") as fh:
    fh.write(md)
rows = "\n".join(
    f"<section><h3>{html.escape(n)}</h3>{'<ul>' + ''.join(f'<li>{html.escape(x)}</li>' for x in d) + '</ul>' if d else '<p>same</p>'}"
    + (f'<img loading="lazy" src="{p}">' if p else "") + "</section>" for n, p, d in cards)
with open(os.path.join(dest, "index.html"), "w") as fh:
    fh.write(f"""<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>iPhone vs Android ({lang})</title><style>body{{font:15px system-ui;margin:12px}}img{{max-width:100%;border:1px solid #ccc}}li{{color:#b00}}section{{margin:0 0 28px}}</style>
<h1>iPhone vs Android ({lang})</h1>{rows}""")
print(md)
