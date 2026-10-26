// Trailheads, parking, drinking water, toilets, bike repair stations and shelters near the MTB trails of all of Canada,
// for "Trailheads and parking" and the trail details' "Getting there" outside the home zones (alex 2026-10-26: "if their
// is other things only available in a region make it available everywhere"). The home zones keep data/access-<zone>.json
// (scripts/build-access.mjs, with BC Rec Sites too); this is the same OpenStreetMap part, for the rest of Canada.
// Runs inside the nightly Canada job (.github/workflows/canada-data.yml), on each province's Geofabrik extract:
//   node scripts/build-canada-access.mjs ingest <prov> <access.geojsonseq>   once per province
//   node scripts/build-canada-access.mjs finish                              once at the end, after build-canada.mjs finish
// and writes out/ca/a/<chunk>.json ({ v: 1, osm: [{ id, k, lat, lon, t }] }, the access-<zone>.json format) for each
// map chunk that has some, plus out/ca/a/index.json (the chunks that have a file), published with the website under ca/.
// Kept as build-access.mjs keeps them: parking within PARK_M of an MTB trail (so town parking is left out), water,
// toilets, repair stations and shelters within NEED_M, every trailhead. Points inside the home zones are left out.
//
// Run: Node 18 or newer, no packages needed.

import { writeFileSync, readFileSync, mkdirSync, readdirSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const root = new URL("../", import.meta.url);
const OUT = new URL("out/ca/", root), PART = new URL("out/access/", root);
const round = (n) => Math.round(n * 1e5) / 1e5;
const log = (...a) => console.log(...a);
const html = readFileSync(new URL("index.html", root), "utf8");
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => m[3].split(",").map(Number));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
const inZones = (lat, lon) => ZONES.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e);
// Same chunks as scripts/build-canada.mjs (1° x 1.2°).
const chunkId = (lat, lon) => `${Math.floor(lat)}_${(Math.floor(lon / 1.2) * 1.2).toFixed(1)}`;

// The same choices as scripts/build-access.mjs (its Overpass query, KEEP and KIND).
const PARK_M = 1500, NEED_M = 600;
const KIND = { drinking_water: "w", toilets: "wc", bicycle_repair_station: "fix", bicycle_wash: "fix", shelter: "sh" };
const NOT = {
  parking: /^(private|no|customers|residents|permit|delivery|employees)$/, drinking_water: /^(private|no|customers)$/,
  toilets: /^(private|no|customers|permit|employees)$/, shelter: /^(private|no)$/,
};
const KEEP = /^(name|ref|highway|amenity|parking|access|fee|charge|surface|capacity|operator|opening_hours|maxstay|toilets|description|note|website|seasonal|drinking_water|shelter_type|toilets:disposal|service:bicycle:(pump|tools|chain_tool|stand))$/;
function kindOf(t) {
  if (t.highway === "trailhead") return "th";
  const a = t.amenity;
  if (a === "parking") return NOT.parking.test(t.access || "") || /^(underground|multi-storey|rooftop|garage_boxes|carports)$/.test(t.parking || "") ? null : "p";
  if (!KIND[a]) return null;
  return NOT[a] && NOT[a].test(t.access || "") ? null : KIND[a];
}
function centreOf(geom) {
  if (geom.type === "Point") return [geom.coordinates[1], geom.coordinates[0]];
  const b = [90, 180, -90, -180];
  const walk = (c) => { if (typeof c[0] === "number") { b[0] = Math.min(b[0], c[1]); b[1] = Math.min(b[1], c[0]); b[2] = Math.max(b[2], c[1]); b[3] = Math.max(b[3], c[0]); } else c.forEach(walk); };
  walk(geom.coordinates);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

// ---------- ingest: one province -> out/access/<prov>.json ----------
async function ingest(prov, file) {
  const out = [], seen = new Set();
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = raw.replace(/^\x1e/, "").trim();
    if (!line) continue;
    let f;
    try { f = JSON.parse(line); } catch { continue; }
    const p = f.properties || {}, k = kindOf(p);
    if (!k || !f.geometry) continue;
    const id = `${String(p["@type"] || "n")[0]}${p["@id"]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const [lat, lon] = centreOf(f.geometry);
    if (inZones(lat, lon)) continue;
    out.push({ id, k, lat: round(lat), lon: round(lon), t: Object.fromEntries(Object.entries(p).filter(([key]) => KEEP.test(key)).map(([key, v]) => [key, String(v).slice(0, 300)])) });
  }
  mkdirSync(PART, { recursive: true });
  writeFileSync(new URL(`${prov}.json`, PART), JSON.stringify(out));
  log(`${prov}: ${out.length} trailheads, parking lots and the like`);
}

// ---------- finish: keep the ones near MTB trails, one file per chunk ----------
function finish() {
  // Every MTB trail point of the chunks (out/ca/c/<chunk>.json "mtb"), on a grid of about 1.1 km cells.
  const CELL = 0.01, grid = new Map();
  for (const f of readdirSync(new URL("c/", OUT)).filter((f) => f.endsWith(".json"))) {
    const c = JSON.parse(readFileSync(new URL(`c/${f}`, OUT), "utf8"));
    for (const w of Object.values((c.mtb && c.mtb.ways) || {})) {
      for (let i = 0; i < w.g.length; i += 2) {
        const k = `${Math.floor(w.g[i] / CELL)},${Math.floor(w.g[i + 1] / CELL)}`;
        (grid.get(k) || grid.set(k, []).get(k)).push(w.g[i], w.g[i + 1]);
      }
    }
  }
  const near = (lat, lon, max) => {
    const ci = Math.floor(lat / CELL), cj = Math.floor(lon / CELL), r = Math.ceil(max / 700), k = Math.cos((lat * Math.PI) / 180);
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const pts = grid.get(`${i},${j}`);
      if (!pts) continue;
      for (let p = 0; p < pts.length; p += 2) if (Math.hypot((pts[p] - lat) * 110540, (pts[p + 1] - lon) * 111320 * k) <= max) return true;
    }
    return false;
  };
  const chunks = new Map();
  let all = 0;
  for (const f of readdirSync(PART).filter((f) => f.endsWith(".json"))) {
    for (const x of JSON.parse(readFileSync(new URL(f, PART), "utf8"))) {
      if (x.k !== "th" && !near(x.lat, x.lon, x.k === "p" ? PARK_M : NEED_M)) continue;
      const id = chunkId(x.lat, x.lon);
      (chunks.get(id) || chunks.set(id, []).get(id)).push(x);
      all++;
    }
  }
  mkdirSync(new URL("a/", OUT), { recursive: true });
  const builtAt = new Date().toISOString().slice(0, 19) + "Z";
  for (const [id, osm] of chunks) writeFileSync(new URL(`a/${id}.json`, OUT), JSON.stringify({ v: 1, builtAt, osm }));
  writeFileSync(new URL("a/index.json", OUT), JSON.stringify({ v: 1, builtAt, chunks: [...chunks.keys()].sort() }));
  log(`${all} trailheads, parking lots and the like in ${chunks.size} chunks`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "ingest") await ingest(...args);
else if (cmd === "finish") finish();
else throw new Error("Use: ingest <prov> <access.geojsonseq> | finish");
