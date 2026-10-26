# BC's water-specific fishing regulations, for the Fishing spot card (alex: "the season and limits for each lake").
#
# Reads the "Water-Specific Regulations" tables of each region of the BC Freshwater Fishing Regulations Synopsis
# (the region PDFs on www2.gov.bc.ca) into data/fishing/bcregs.json: {"regions": {"2": [[water, management unit,
# [rule, ...]], ...]}}. The tables have no ruled rows in the text, so each row is read from the PDF's shaded and
# white row boxes in the name column: every word between a row's top and bottom edges belongs to that water (a water's
# name sits in the middle of its row, so reading the text line by line gives the wrong water). A region that fails
# keeps its last good rows.
#
# Run: pip install pdfplumber && python3 scripts/build-bc-regs.py   (monthly, from .github/workflows/fishing-data.yml)
import json, os, re, sys, tempfile, urllib.request

import pdfplumber

BASE = "https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/freshwater-fishing/"
REGIONS = {"1": "region_1_vancouver_island", "2": "region_2_lower_mainland", "3": "region_3_thompson", "4": "region_4_kootenay", "5": "region_5_cariboo",
           "6": "region_6_skeena", "7": "region_7a_omineca", "9": "region_7b_peace", "8": "region_8_okanagan"}   # keys: the region ids in zones.json
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "fishing", "bcregs.json")
MU = re.compile(r"^\d[AB]?-\d+$")


def clean(t):
    return re.sub(r"\s+", " ", t.replace("", " ")).strip()


def rows_of(path):
    rows = []
    with pdfplumber.open(path) as pdf:
        for p in pdf.pages:
            words = p.extract_words()
            hdr = [w for w in words if w["text"] == "EXCEPTIONS"]
            if not hdr:
                continue
            xr = hdr[0]["x0"] - 6               # where the rules column starts
            top0 = hdr[0]["bottom"] + 2
            edges = {top0}
            for r in list(p.rects) + list(p.lines):    # row boxes and the white lines between them, in the name column
                if r["x0"] < 60 and 100 < r["x1"] < xr and r["top"] >= top0 - 1 and r["bottom"] - r["top"] < 300:
                    edges.add(r["top"]); edges.add(r["bottom"])
            below = [w["bottom"] for w in words if w["top"] > top0]
            if not below:
                continue
            edges.add(max(below) + 1)
            E = []
            for e in sorted(edges):
                if not E or e - E[-1] > 2:
                    E.append(e)
            for a, b in zip(E, E[1:]):
                ws = [w for w in words if w["top"] >= a - 1.5 and w["bottom"] <= b + 1.5]
                name = clean(" ".join(w["text"] for w in sorted(ws, key=lambda w: (round(w["top"]), w["x0"])) if w["x1"] < xr - 20 and not MU.match(w["text"])))
                mu = " ".join(w["text"] for w in ws if MU.match(w["text"]) and w["x0"] < xr)
                # Rule lines: words of the rules column grouped by height (2.5 pt), wrapped lines joined back together.
                lines = []
                for w in sorted((w for w in ws if w["x0"] >= xr - 2), key=lambda w: w["top"]):
                    if lines and abs(lines[-1][0] - w["top"]) < 2.5:
                        lines[-1][1].append(w)
                    else:
                        lines.append([w["top"], [w]])
                rule = []
                for _, lw in lines:
                    t = clean(" ".join(x["text"] for x in sorted(lw, key=lambda x: x["x0"])))
                    if rule and (re.match(r"^[a-z0-9(,;]", t) or rule[-1].endswith(("-", ",", "the", "of", "to", "and", "="))):
                        rule[-1] = (rule[-1][:-1] if rule[-1].endswith("-") and re.match(r"^[a-z]", t) else rule[-1] + " ") + t
                    else:
                        rule.append(t)
                if name or rule:
                    rows.append([name, mu, rule])
    out = []
    for n, mu, rule in rows:                     # a row split over two pages continues on the next
        if not n and out:
            out[-1][2] += rule
        elif n and not re.match(r"^(WATER BODY|REGION)", n):
            out.append([n, mu, [r[:300] for r in rule]])
    return out


def main():
    try:
        old = json.load(open(OUT))
    except Exception:
        old = {"regions": {}}
    regions = {}
    for rid, f in REGIONS.items():
        try:
            with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
                req = urllib.request.Request(BASE + f + ".pdf", headers={"User-Agent": "trail-finder fishing data (https://github.com/allduf/trail-finder)"})
                tmp.write(urllib.request.urlopen(req, timeout=120).read()); tmp.flush()
                r = rows_of(tmp.name)
            if len(r) < 30:
                raise ValueError(f"only {len(r)} rows")
            regions[rid] = r
            print(f"  region {rid}: {len(r)} waters")
        except Exception as e:
            print(f"  region {rid}: {e}; keeping the last good rows")
            if rid in old.get("regions", {}):
                regions[rid] = old["regions"][rid]
    if len(regions) < 5:
        print("  too few regions; keeping the last good file")
        return
    import datetime
    json.dump({"updated": datetime.date.today().isoformat(), "src": BASE, "regions": regions}, open(OUT, "w"), separators=(",", ":"))
    print(f"  bcregs.json: {os.path.getsize(OUT) // 1024} KB")


if __name__ == "__main__":
    main()
