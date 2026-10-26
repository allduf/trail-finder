// Gas stations, campsites, hot springs, motorcycle shops and ferry landings across Canada, for Moto adventure mode
// (moto.js: fuel range, Fuel & camp, and fuel stops along a planned route). alex 2026-10-26: "the best app adapted
// for moto adventure ride", all of Canada.
// Runs inside the nightly Canada job (.github/workflows/canada-data.yml), on each province's Geofabrik extract:
//   node scripts/build-moto.mjs ingest <prov> <moto.geojsonseq>   once per province
//   node scripts/build-moto.mjs finish                            once at the end
// and writes out/ca/moto/<kind>.json for each kind ({ v: 1, built, list: [[lat, lon, name, extra, id], ...] }), published
// with the website under ca/moto/. Small enough to load whole (fuel ~0.5 MB): range checks need every station, not
// only the ones on screen.
//
// Run: Node 18 or newer, no packages needed.

import { writeFileSync, mkdirSync, readdirSync, readFileSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const root = new URL("../", import.meta.url);
const OUT = new URL("out/ca/moto/", root), PART = new URL("out/moto/", root);
const round = (n) => Math.round(n * 1e5) / 1e5;

// What each point is, from its tags. Private ones are left out.
const PRIVATE = /^(private|no|customers|permit|employees|members)$/;
function kindOf(t) {
  if (PRIVATE.test(t.access || "")) return null;
  if (t.amenity === "fuel") return /^no$/.test(t.fuel || "") ? null : "fuel";
  if (t.tourism === "camp_site" || t.tourism === "caravan_site") return /^(no|private)$/.test(t.tents || "") && t.tourism === "caravan_site" ? null : "camp";
  if (t.tourism === "wilderness_hut" || t.tourism === "alpine_hut" || (t.amenity === "shelter" && t.shelter_type === "basic_hut")) return "camp";
  if (t.natural === "hot_spring") return "hot";
  if (t.shop === "motorcycle" || t.shop === "motorcycle_repair" || (t.shop === "tyres" && /motorcycle/i.test(t.name || ""))) return "shop";
  if (t.amenity === "ferry_terminal") return "ferry";
  return null;
}
// The one-word extra after the name: the brand for fuel (and 24/7), the kind and fee for camping.
function extraOf(k, t) {
  if (k === "fuel") return [t.brand || "", t.opening_hours === "24/7" ? "24/7" : "", t["fuel:diesel"] === "yes" ? "diesel" : ""].filter(Boolean).join(" ");
  if (k === "camp") {
    const kind = t.tourism === "camp_site" ? (t.backcountry === "yes" || t.camp_site === "basic" ? "basic" : "camp") : t.tourism === "caravan_site" ? "rv" : "hut";
    return [kind, t.fee === "no" ? "free" : t.fee === "yes" ? "fee" : ""].filter(Boolean).join(" ");
  }
  if (k === "shop") return t.shop === "motorcycle_repair" || t["service:vehicle:motorcycle_repair"] === "yes" || t.repair === "yes" ? "repair" : "";
  return "";
}
function centreOf(geom) {
  if (geom.type === "Point") return [geom.coordinates[1], geom.coordinates[0]];
  const b = [90, 180, -90, -180];
  const walk = (c) => { if (typeof c[0] === "number") { b[0] = Math.min(b[0], c[1]); b[1] = Math.min(b[1], c[0]); b[2] = Math.max(b[2], c[1]); b[3] = Math.max(b[3], c[0]); } else c.forEach(walk); };
  walk(geom.coordinates);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

// ---------- ingest: one province -> out/moto/<prov>.json ----------
async function ingest(prov, file) {
  const out = {}, seen = new Set();
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = raw.replace(/^\x1e/, "").trim();
    if (!line) continue;
    let f;
    try { f = JSON.parse(line); } catch { continue; }
    const t = f.properties || {}, k = kindOf(t);
    if (!k || !f.geometry) continue;
    const id = `${t["@type"] || ""}${t["@id"] || ""}`;
    if (id && seen.has(id)) continue;
    seen.add(id);
    const [lat, lon] = centreOf(f.geometry);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const name = String(t.name || t.brand || t.operator || "").slice(0, 60), extra = extraOf(k, t);
    // The OpenStreetMap id ("n", "w" or "r" and the number in base 36), so a tap on the map can fetch all its tags
    // (fee, water, toilets, hours, website...) without making the file bigger with them.
    const osm = t["@id"] ? `${String(t["@type"] || "n")[0]}${Number(t["@id"]).toString(36)}` : "";
    (out[k] || (out[k] = [])).push(osm ? [round(lat), round(lon), name, extra, osm] : extra ? [round(lat), round(lon), name, extra] : [round(lat), round(lon), name]);
  }
  mkdirSync(PART, { recursive: true });
  writeFileSync(new URL(`${prov}.json`, PART), JSON.stringify(out));
  console.log(prov, Object.entries(out).map(([k, v]) => `${k} ${v.length}`).join(", "));
}

// ---------- finish: all provinces -> out/ca/moto/<kind>.json ----------
function finish() {
  const all = {};
  for (const f of readdirSync(PART).filter((n) => n.endsWith(".json"))) {
    const part = JSON.parse(readFileSync(new URL(f, PART), "utf8"));
    for (const [k, list] of Object.entries(part)) (all[k] || (all[k] = [])).push(...list);
  }
  mkdirSync(OUT, { recursive: true });
  const built = new Date().toISOString();
  for (const k of ["fuel", "camp", "hot", "shop", "ferry"]) {
    // the same place twice (a node and the area around it, or a border) is kept once
    const keep = new Map();
    for (const p of all[k] || []) { const key = `${p[0].toFixed(3)},${p[1].toFixed(3)}`; if (!keep.has(key)) keep.set(key, p); }
    const list = [...keep.values()].sort((a, b) => a[0] - b[0]);
    const body = JSON.stringify({ v: 1, built, list });
    writeFileSync(new URL(`${k}.json`, OUT), body);
    console.log(`ca/moto/${k}.json: ${list.length} points, ${(body.length / 1e3).toFixed(0)} KB`);
  }
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "ingest") await ingest(a, b);
else if (cmd === "finish") finish();
else { console.error("Usage: build-moto.mjs ingest <prov> <file> | finish"); process.exit(1); }
