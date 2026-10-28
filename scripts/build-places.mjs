// Towns, villages and parks across Canada for the trail name box (index.html, placeHits): typing "Bromont" offers
// the town, not a trail with a similar name. From GeoNames' Canada list (CC BY 4.0, geonames.org). Towns barely
// change, so it is run by hand and data/places.json is kept in main:
//   curl -sSO https://download.geonames.org/export/dump/CA.zip && unzip CA.zip
//   node scripts/build-places.mjs CA.txt
// data/places.json: { v, src, places: [[name, lat, lon, prov, kind, pop]] } where kind is t (town or village),
// l (locality or neighbourhood) or p (park), biggest first.
import { readFileSync, writeFileSync } from "node:fs";

const PROV = { "01": "AB", "02": "BC", "03": "MB", "04": "NB", "05": "NL", "07": "NS", "08": "ON", "09": "PE", "10": "QC",
  "11": "SK", "12": "YT", "13": "NT", "14": "NU" };
const KIND = { PPL: "t", PPLA: "t", PPLA2: "t", PPLA3: "t", PPLA4: "t", PPLC: "t", PPLS: "t", PPLL: "l", PPLX: "l", PRK: "p" };

const rows = readFileSync(process.argv[2] || "CA.txt", "utf8").split("\n");
const seen = new Set(), out = [];
for (const line of rows) {
  const f = line.split("\t");
  if (f.length < 15) continue;
  const kind = KIND[f[7]], prov = PROV[f[10]];
  if (!kind || !prov) continue;
  const name = f[1].trim(), lat = +(+f[4]).toFixed(3), lon = +(+f[5]).toFixed(3), pop = +f[14] || 0;
  const key = name.toLowerCase() + "|" + prov + "|" + Math.round(lat * 10) + "|" + Math.round(lon * 10);   // one per name within ~10 km
  if (seen.has(key)) continue;
  seen.add(key);
  out.push([name, lat, lon, prov, kind, pop]);
}
const rank = { t: 0, p: 1, l: 2 };
out.sort((a, b) => b[5] - a[5] || rank[a[4]] - rank[b[4]]);
writeFileSync("data/places.json", JSON.stringify({ v: 1, src: "GeoNames (CC BY 4.0), " + new Date().toISOString().slice(0, 10), places: out }).replace(/\],\[/g, "],\n["));
console.log(out.length + " places");
