// Forest and dirt roads near the MTB trails of all of Canada, for "Forest roads", Plan a route's road climbs and the
// trail details' "Getting there" / "Shuttle access" outside the home zones (alex 2026-10-26: "if their is other things
// only available in a region make it available everywhere"). The home zones keep data/roads-<zone>.json
// (scripts/build-roads.mjs, with the BC government's Forest Tenure roads too); this is the same OpenStreetMap part
// (the same roads and tags), for the rest of Canada. Runs inside the nightly Canada job (.github/workflows/canada-data.yml):
//   node scripts/build-canada-roads.mjs ingest <prov> <roads.geojsonseq>   once per province, after build-canada.mjs ingest
//   node scripts/build-canada-roads.mjs finish                            once at the end
// and writes out/ca/r/<chunk>.json ({ v: 1, osm: { <way id>: { tags, g } } }, the roads-<zone>.json format) for each map
// chunk that has some, plus out/ca/r/index.json (the chunks that have a file), published with the website under ca/.
// Only roads within ROAD_M of an MTB trail (the province's MTB ways from build-canada.mjs's part file), so the files stay
// small: a whole province's logging roads would be gigabytes. Roads inside the home zones are left out.
//
// Run: Node 18 or newer, no packages needed.

import { writeFileSync, readFileSync, mkdirSync, readdirSync, createReadStream, existsSync, appendFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";

const root = new URL("../", import.meta.url);
const OUT = new URL("out/ca/", root), PART = new URL("out/roads/", root), TRAILS = new URL("out/parts/", root);
const ROAD_M = 2000;
const round = (n) => Math.round(n * 1e5) / 1e5;
const log = (...a) => console.log(...a);
const html = readFileSync(new URL("index.html", root), "utf8");
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => m[3].split(",").map(Number));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
const inZones = (lat, lon) => ZONES.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e);
const chunkId = (lat, lon) => `${Math.floor(lat)}_${(Math.floor(lon / 1.2) * 1.2).toFixed(1)}`;

// The roads build-roads.mjs asks Overpass for: every track, unpaved unclassified and service roads (not driveways or
// parking aisles), roads named like forest roads (English and French), and disused or abandoned roads.
const UNPAVED = /^(unpaved|gravel|fine_gravel|compacted|dirt|earth|ground|grass|mud|rock|pebblestone|sand|wood)$/;
const FOREST_NAME = /FSR|Forest Service|Forest Road|Mainline|chemin forestier|route forestière|chemin de pénétration/i;
function isRoad(t) {
  const h = t.highway || "";
  if (t["disused:highway"] || t["abandoned:highway"]) return true;
  if (h === "track") return true;
  if (/^(unclassified|service|track|road)$/.test(h) && FOREST_NAME.test(t.name || "")) return true;
  return /^(unclassified|service)$/.test(h) && !t.service && UNPAVED.test(t.surface || "");
}
const KEEP = /^(name|ref|highway|disused:highway|abandoned:highway|tracktype|surface|smoothness|access|motor_vehicle|motorcar|vehicle|4wd_only|seasonal|operator|note|description|fixme|bridge|ford|width|source)$/;

// Douglas-Peucker on a local flat projection, to about 8 m (as build-roads.mjs).
function simplify(pts, tol = 8) {
  if (pts.length < 3) return pts;
  const k = Math.cos((pts[0][0] * Math.PI) / 180) * 111320, xy = pts.map((p) => [p[1] * k, p[0] * 110540]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let far = -1, best = tol;
    const [ax, ay] = xy[a], [bx, by] = xy[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / len; if (d > best) { best = d; far = i; } }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---------- ingest: one province -> out/roads/<prov>.lines ----------
async function ingest(prov, file) {
  // The province's MTB trail points (flag 4 in build-canada.mjs's part file), on a grid of about 1.1 km cells.
  const CELL = 0.01, cells = new Set();
  const trails = new URL(`${prov}.ways`, TRAILS);
  if (!existsSync(trails)) throw new Error(`No ${prov}.ways from build-canada.mjs ingest yet`);
  for await (const line of createInterface({ input: createReadStream(trails) })) {
    if (!line) continue;
    const [, , , flags, , g] = JSON.parse(line);
    if (flags & 4) g.forEach(([lat, lon]) => cells.add(`${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`));
  }
  const r = Math.ceil(ROAD_M / 1000);
  const nearTrail = (lat, lon) => {
    const ci = Math.floor(lat / CELL), cj = Math.floor(lon / CELL);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (cells.has(`${ci + i},${cj + j}`)) return true;
    return false;
  };
  mkdirSync(PART, { recursive: true });
  const out = new URL(`${prov}.lines`, PART), lines = [];
  let n = 0;
  if (cells.size) for await (const raw of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    const s = raw.replace(/^\x1e/, "");
    if (!s) continue;
    const f = JSON.parse(s), p = f.properties || {};
    if (p["@type"] !== "way" || !f.geometry || f.geometry.type !== "LineString" || !isRoad(p)) continue;
    const pts = f.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    if (!pts.some(([lat, lon], i) => i % 4 === 0 && nearTrail(lat, lon))) continue;
    const mid = pts[Math.floor(pts.length / 2)];
    if (inZones(mid[0], mid[1])) continue;
    const tags = {};
    for (const k in p) if (k[0] !== "@" && KEEP.test(k)) tags[k] = String(p[k]).slice(0, 300);
    lines.push(JSON.stringify([chunkId(mid[0], mid[1]), p["@id"], tags, simplify(pts).flatMap(([lat, lon]) => [round(lat), round(lon)])]));
    n++;
    if (lines.length >= 20000) { appendFileSync(out, lines.join("\n") + "\n"); lines.length = 0; }
  }
  appendFileSync(out, lines.length ? lines.join("\n") + "\n" : "");
  log(`${prov}: ${n} forest and dirt roads near MTB trails`);
}

// ---------- finish: one file per chunk ----------
async function finish() {
  const chunks = new Map();
  for (const f of readdirSync(PART).filter((f) => f.endsWith(".lines"))) {
    for await (const line of createInterface({ input: createReadStream(new URL(f, PART)) })) {
      if (!line) continue;
      const [cid, id, tags, g] = JSON.parse(line);
      (chunks.get(cid) || chunks.set(cid, {}).get(cid))[id] = { tags, g };
    }
  }
  mkdirSync(new URL("r/", OUT), { recursive: true });
  const builtAt = new Date().toISOString().slice(0, 19) + "Z";
  let bytes = 0;
  for (const [cid, osm] of chunks) {
    const url = new URL(`r/${cid}.json`, OUT);
    writeFileSync(url, JSON.stringify({ v: 1, builtAt, osm }));
    bytes += statSync(url).size;
  }
  writeFileSync(new URL("r/index.json", OUT), JSON.stringify({ v: 1, builtAt, chunks: [...chunks.keys()].sort() }));
  log(`Forest and dirt roads in ${chunks.size} chunks, ${(bytes / 1e6).toFixed(1)} MB`);
  // The website is capped at 1 GB: say so loudly if this grows past what was planned for it.
  if (bytes > 60e6) log(`::warning::Canada forest roads are ${(bytes / 1e6).toFixed(0)} MB, more than the 60 MB planned; lower ROAD_M in scripts/build-canada-roads.mjs`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "ingest") await ingest(...args);
else if (cmd === "finish") await finish();
else throw new Error("Use: ingest <prov> <roads.geojsonseq> | finish");
