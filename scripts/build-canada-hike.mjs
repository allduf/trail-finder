// Hiking trails and hiking places for all of Canada, for Hiking (hike.js) outside the home zones.
// alex (2026-11-04, Saint-Donat, Quebec): "i though we had all the hiking trail in canada". Outside the 31 home zones
// hike.js asked OpenStreetMap's trail server (Overpass) live, nine squares at most per view, so wide views and 3D sat
// on "Finding more hiking trails…" with only a few hikes drawn. Now every hiking trail in Canada is built each night
// from the same Geofabrik extracts as the MTB data, and hike.js reads it first (Overpass only where no file loads).
// Runs inside the nightly Canada job (.github/workflows/canada-data.yml):
//   node scripts/build-canada-hike.mjs ingest <prov> <ways.geojsonseq> <relations.opl> <places.geojsonseq>   per province
//   node scripts/build-canada-hike.mjs finish                                                             once at the end
// and writes out/ca/h/<chunk>.json for each map chunk (1° x 1.2°, as scripts/build-canada.mjs) that has hiking trails,
// in hike.js's own format (as data/hike-<zone>.json and data/hike-places-<zone>.json together):
//   { v: 1, builtAt, box, w: [{ id, t, e }], r: [{ id, n, t, m }], p: [[id, kind, lat, lon, name, extra]] }
// where e is the trail's shape as an encoded polyline (Google's format, 5 decimals; about a quarter of the size of
// [lat, lon] pairs, hike.js turns it back into g).
// plus out/ca/h/index.json ({ v: 1, builtAt, chunks: [...] }). A trail crossing a chunk edge is in both chunks. Trails
// and places inside the home zones are left out (data/hike-<zone>.json has them).
// Which trails and places: the same rules as scripts/build-hike.mjs (TRAIL_TRACK, keepWay, placeKind, near a trail).
//
// Run: Node 18 or newer, no packages needed.

import { writeFileSync, readFileSync, mkdirSync, readdirSync, createReadStream, appendFileSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
// Places taken off the app by hand (hidden-places.js: Tom's Hut) are left out of the data too.
const hiddenPlace = createRequire(import.meta.url)("../hidden-places.js");

const root = new URL("../", import.meta.url);
const OUT = new URL("out/ca/h/", root), PART = new URL("out/hike/", root);
const log = (...a) => console.log(...a);
const round = (n) => Math.round(n * 1e5) / 1e5;
const html = readFileSync(new URL("index.html", root), "utf8");
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => m[3].split(",").map(Number));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
const inZones = (lat, lon) => ZONES.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e);
const CHUNK_LAT = 1, CHUNK_LON = 1.2;
const chunkId = (lat, lon) => `${Math.floor(lat / CHUNK_LAT) * CHUNK_LAT}_${(Math.floor(lon / CHUNK_LON) * CHUNK_LON).toFixed(1)}`;
const chunkBox = (id) => { const [s, w] = id.split("_").map(Number); return [s, w, s + CHUNK_LAT, round(w + CHUNK_LON)]; };

// ---------- the same rules as scripts/build-hike.mjs ----------
const KEEP = ["name", "highway", "sac_scale", "surface", "trail_visibility", "foot", "access", "bicycle", "mtb:scale", "mtb:scale:imba", "mtb:type", "footway", "lit", "operator", "website", "description", "incline", "ref", "seasonal", "informal", "wikimedia_commons", "image", "wikidata"];
const FOOT_OK = /^(yes|designated|permissive)$/;
// Quebec maps many hiking trails as tracks (Sentier de la Montagne Noire, Saint-Donat): a named track called a trail is one.
const TRAIL_TRACK = /\b(sentier|trail|portage)\b/i;
function keepWay(t, inRel) {
  if (/^(no|private)$/.test(t.foot || "")) return false;
  if (/^(no|private)$/.test(t.access || "") && !FOOT_OK.test(t.foot || "")) return false;
  if (/^(sidewalk|crossing|access_aisle|traffic_island)$/.test(t.footway || "")) return false;
  if (inRel || t.sac_scale) return true;
  if (/^(asphalt|concrete|paving_stones|paved|sett|concrete:plates|metal|unhewn_cobblestone|cobblestone)$/.test(t.surface || "")) return false;
  if (t.lit === "yes") return false;
  const bikeHeavy = +t["mtb:scale"] >= 3 || +t["mtb:scale:imba"] >= 3 || /downhill|freeride|bike ?park/i.test(t["mtb:type"] || "");
  if (bikeHeavy && !FOOT_OK.test(t.foot || "")) return false;
  return true;
}
// What the Overpass query of build-hike.mjs asks for.
const wanted = (t, inRel) => inRel
  || (/^(path|footway|bridleway)$/.test(t.highway || "") && t.name)
  || (/^(path|footway|bridleway|track)$/.test(t.highway || "") && t.sac_scale)
  || (t.highway === "track" && t.name && TRAIL_TRACK.test(t.name));
function placeKind(t) {
  if (t.highway === "trailhead") return "th";
  if (t.amenity === "parking") return /^(private|no|customers|permit|delivery)$/.test(t.access || "") ? null : "park";
  if (/^(alpine_hut|wilderness_hut)$/.test(t.tourism)) return "hut";
  if (t.amenity === "shelter") return /^(basic_hut|lean_to|weather_shelter|rock_shelter)$/.test(t.shelter_type || "") ? "hut" : null;
  if (t.tourism === "camp_site") return "camp";
  if (t.tourism === "viewpoint") return "view";
  if (/^(peak|volcano)$/.test(t.natural)) return t.name ? "peak" : null;
  if (t.waterway === "waterfall") return "fall";
  if (t.amenity === "drinking_water") return "water";
  if (t.amenity === "toilets") return "wc";
  return null;
}
const PLACE_EXTRA = ["ele", "fee", "charge", "capacity", "operator", "website", "reservation", "shelter_type", "backcountry", "drinking_water", "opening_hours", "seasonal", "description", "height"];
const NEAR_TRAIL = new Set(["park", "water", "wc"]);
const REL_TAGS = ["network", "operator", "website", "description", "distance", "roundtrip", "wikimedia_commons", "image", "wikidata"];

// Shapes thinned to about 3 m (Douglas-Peucker), as the MTB chunks are.
function simplify(pts, tol = 0.00003) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = 0, bi = -1;
    const [ay, ax] = pts[a], [by, bx] = pts[b], dy = by - ay, dx = bx - ax, len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dx * (ay - pts[i][0]) - dy * (ax - pts[i][1])) / len; if (d > best) { best = d; bi = i; } }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const unOpl = (s) => s.replace(/%([0-9a-f]+)%/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
function parseRelation(line) {
  const r = { id: 0, tags: {}, ways: [] };
  for (const f of line.split(" ")) {
    if (f[0] === "r") r.id = +f.slice(1);
    else if (f[0] === "T" && f.length > 1) f.slice(1).split(",").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) r.tags[unOpl(kv.slice(0, i))] = unOpl(kv.slice(i + 1)); });
    else if (f[0] === "M" && f.length > 1) f.slice(1).split(",").forEach((m) => { if (m[0] === "w") r.ways.push(+m.slice(1, m.indexOf("@"))); });
  }
  return r;
}
function centreOf(geom) {
  if (geom.type === "Point") return [geom.coordinates[1], geom.coordinates[0]];
  const b = [90, 180, -90, -180];
  const walk = (c) => { if (typeof c[0] === "number") { b[0] = Math.min(b[0], c[1]); b[1] = Math.min(b[1], c[0]); b[2] = Math.max(b[2], c[1]); b[3] = Math.max(b[3], c[0]); } else c.forEach(walk); };
  walk(geom.coordinates);
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}
function encode(pts) {
  let out = "", py = 0, px = 0;
  const num = (v) => { let n = v < 0 ? ~(v << 1) : v << 1; while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; } out += String.fromCharCode(n + 63); };
  for (const [lat, lon] of pts) { const y = Math.round(lat * 1e5), x = Math.round(lon * 1e5); num(y - py); num(x - px); py = y; px = x; }
  return out;
}
async function* jsonLines(file) {
  for await (const raw of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    const s = raw.replace(/^\x1e/, "").trim();
    if (!s) continue;
    try { yield JSON.parse(s); } catch {}
  }
}

// ---------- ingest: one province -> out/hike/<prov>.ways (one way per line), <prov>.json (routes, places) ----------
async function ingest(prov, waysFile, relsFile, placesFile) {
  const rels = new Map();
  for await (const line of createInterface({ input: createReadStream(relsFile) })) {
    if (!line.startsWith("r")) continue;
    const r = parseRelation(line);
    if (/^(hiking|foot)$/.test(r.tags.route || "") && r.ways.length) rels.set(r.id, r);
  }
  const inRel = new Set(); rels.forEach((r) => r.ways.forEach((id) => inRel.add(id)));
  mkdirSync(PART, { recursive: true });
  const waysOut = new URL(`${prov}.ways`, PART);
  rmSync(waysOut, { force: true });
  const lines = [], kept = new Set();
  for await (const f of jsonLines(waysFile)) {
    const p = f.properties || {};
    if (p["@type"] !== "way" || !f.geometry || f.geometry.type !== "LineString") continue;
    const id = +p["@id"], all = {};
    for (const k in p) if (k[0] !== "@") all[k] = p[k];
    const r = inRel.has(id);
    if (!all.highway || !wanted(all, r) || !keepWay(all, r)) continue;
    const g = simplify(f.geometry.coordinates.map(([lon, lat]) => [round(lat), round(lon)]));
    if (g.length < 2) continue;
    const mid = g[g.length >> 1];
    if (inZones(mid[0], mid[1])) continue;
    const t = {}; KEEP.forEach((k) => { if (all[k] != null) t[k] = String(all[k]).slice(0, 300); });
    lines.push(JSON.stringify({ id, t, g }));
    kept.add(id);
    if (lines.length >= 20000) { appendFileSync(waysOut, lines.join("\n") + "\n"); lines.length = 0; }
  }
  if (lines.length) appendFileSync(waysOut, lines.join("\n") + "\n");
  const r = [];
  rels.forEach((x) => {
    const m = x.ways.filter((id) => kept.has(id));
    if (m.length) r.push({ id: x.id, n: x.tags.name || x.tags.ref || "", t: Object.fromEntries(REL_TAGS.filter((k) => x.tags[k] != null).map((k) => [k, x.tags[k]])), m });
  });
  const p = [], seen = new Set();
  if (placesFile) for await (const f of jsonLines(placesFile)) {
    const t = f.properties || {}, k = placeKind(t);
    if (!k || !f.geometry || /^(private|no)$/.test(t.access || "")) continue;
    const id = `${String(t["@type"] || "n")[0]}${t["@id"]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const [lat, lon] = centreOf(f.geometry);
    if (inZones(lat, lon) || hiddenPlace({ id, name: t.name, lat, lon })) continue;
    const x = {}; PLACE_EXTRA.forEach((key) => { if (t[key] != null) x[key] = String(t[key]).slice(0, 200); });
    p.push([id, k, round(lat), round(lon), t.name ? String(t.name) : "", x]);
  }
  writeFileSync(new URL(`${prov}.json`, PART), JSON.stringify({ r, p }));
  log(`${prov}: ${kept.size} hiking trail ways, ${r.length} hiking routes, ${p.length} places`);
}

// ---------- finish: every province into chunks ----------
async function finish() {
  const builtAt = new Date().toISOString().slice(0, 19) + "Z";
  const chunks = new Map(), chunk = (id) => chunks.get(id) || chunks.set(id, { w: [], wid: new Set(), r: new Map(), p: [] }).get(id);
  const wayChunks = new Map();   // way id -> chunk ids
  // "Near a trail" grid (about 400 m cells), as build-hike.mjs: parking, water, toilets and unnamed campsites only there.
  const C = 0.004, cells = new Set(), cell = (a, b) => `${Math.floor(a / C)},${Math.floor(b / C)}`;
  let ways = 0;
  for (const f of readdirSync(PART).filter((f) => f.endsWith(".ways"))) {
    for await (const w of jsonLines(new URL(f, PART))) {
      const ids = new Set();
      for (const p of w.g) { ids.add(chunkId(p[0], p[1])); cells.add(cell(p[0], p[1])); }
      for (const id of ids) { const c = chunk(id); if (!c.wid.has(w.id)) { c.wid.add(w.id); c.w.push(w); } }
      wayChunks.set(w.id, [...ids]);
      ways++;
    }
  }
  const near = (lat, lon) => { const y = Math.floor(lat / C), x = Math.floor(lon / C); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (cells.has(`${y + i},${x + j}`)) return true; return false; };
  let places = 0;
  for (const f of readdirSync(PART).filter((f) => f.endsWith(".json"))) {
    const { r, p } = JSON.parse(readFileSync(new URL(f, PART), "utf8"));
    for (const x of r) {
      for (const id of x.m) for (const cid of wayChunks.get(id) || []) {
        const c = chunk(cid);
        if (!c.r.has(x.id)) c.r.set(x.id, { id: x.id, n: x.n, t: x.t, m: [] });
        c.r.get(x.id).m.push(id);
      }
    }
    for (const x of p) {
      if ((NEAR_TRAIL.has(x[1]) || (x[1] === "camp" && !x[4])) && !near(x[2], x[3])) continue;
      const cid = chunkId(x[2], x[3]);
      if (!chunks.has(cid)) continue;   // no hiking trails in that chunk
      chunk(cid).p.push(x);
      places++;
    }
  }
  mkdirSync(OUT, { recursive: true });
  let bytes = 0;
  for (const [id, c] of chunks) {
    if (!c.w.length) continue;
    const s = JSON.stringify({ v: 1, builtAt, box: chunkBox(id), w: c.w.map((w) => ({ id: w.id, t: w.t, e: encode(w.g) })), r: [...c.r.values()], p: c.p });
    writeFileSync(new URL(`${id}.json`, OUT), s);
    bytes += s.length;
  }
  const list = [...chunks.keys()].filter((id) => chunks.get(id).w.length).sort();
  writeFileSync(new URL("index.json", OUT), JSON.stringify({ v: 1, builtAt, chunks: list }));
  log(`${ways} hiking trail ways and ${places} places in ${list.length} chunks, ${(bytes / 1e6).toFixed(1)} MB`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "ingest") await ingest(...args);
else if (cmd === "finish") await finish();
else throw new Error("Use: ingest <prov> <ways.geojsonseq> <relations.opl> <places.geojsonseq> | finish");
