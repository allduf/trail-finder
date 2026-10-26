// Ski resort runs, groomed cross-country trails and snowmobile trails for all of Canada, for Skiing (Resorts, Nordic,
// Snowmobile) outside the home regions (alex 2026-10-26: "if their is other things only available in a region make it
// available everywhere"). The home regions keep data/ski.json (scripts/build-winter.mjs, from Overpass); the rest of
// Canada's backcountry routes are in data/ski-canada/ (the same script). Those Canada-wide Overpass queries are too slow
// for every resort run and sled trail in the country, so this reads the same OpenStreetMap tags from Geofabrik's
// province files, inside the nightly Canada job (.github/workflows/canada-data.yml):
//   node scripts/build-canada-winter.mjs ingest <prov> <ways.geojsonseq> <relations.opl>   once per province
//   node scripts/build-canada-winter.mjs finish                                         once at the end
// and writes out/ca/w/<square>.json ({ routes: [...] }, the data/ski-canada/ square format, squares of 3° x 6°) plus
// out/ca/w/index.json ({ tiles: { <square>: { r, kb, box } } }), published with the website under ca/. winter.js loads
// the squares the map shows, like data/ski-canada/. Routes inside the home zones are left out (ski.json has them).
// Kept: downhill runs (type "resort"; backcountry and freeride runs are ski tours, in data/ski-canada/), groomed nordic
// (ungroomed nordic is in data/ski-canada/) and snowmobile trails (ways and route=snowmobile relations).
//
// Run: Node 18 or newer, no packages needed.

import { writeFileSync, readFileSync, mkdirSync, readdirSync, createReadStream, existsSync, rmSync, appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const root = new URL("../", import.meta.url);
const OUT = new URL("out/ca/w/", root), PART = new URL("out/winter/", root);
const TILE_LAT = 3, TILE_LON = 6;   // as data/ski-canada/
const round = (n) => Math.round(n * 1e5) / 1e5;
const log = (...a) => console.log(...a);
const html = readFileSync(new URL("index.html", root), "utf8");
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => m[3].split(",").map(Number));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
// The home zones a little wider, as build-winter.mjs looks for ski routes (pad), plus Rogers Pass (its SKI_ONLY).
const HOME = [...ZONES.map(([s, w, n, e]) => [s - 0.05, w - 0.1, n + 0.05, e + 0.1]), [51.05, -117.8, 51.48, -117.3]];
const inHome = (lat, lon) => HOME.some(([s, w, n, e]) => lat >= s && lat <= n && lon >= w && lon <= e);
const tileOf = (lat, lon) => `${Math.floor(lat / TILE_LAT) * TILE_LAT}_${Math.floor(lon / TILE_LON) * TILE_LON}`;

// The same choices as build-winter.mjs's skiType(), for the three kinds this file keeps.
const SNOWMOBILE_OK = /^(yes|designated|permissive)$/;
function typeOf(t) {
  const pt = String(t["piste:type"] || "").split(";")[0], groom = t["piste:grooming"] || "";
  if (pt === "downhill") return /backcountry|no/.test(groom) || (!groom && t["piste:difficulty"] === "freeride") ? "" : "resort";
  if (pt === "nordic") return /backcountry|no/.test(groom) ? "" : "nordic";
  if (pt === "snowmobile" || t.route === "snowmobile") return "snowmobile";
  if (pt) return "";
  if (SNOWMOBILE_OK.test(t.snowmobile || "") && !/^(motorway|trunk|primary|secondary|tertiary|residential)/.test(t.highway || "")) return "snowmobile";
  if (t["ski:nordic"] && /^(yes|designated)$/.test(t["ski:nordic"])) return "nordic";
  return "";
}
const OSM_KEEP = ["name", "ref", "piste:name", "piste:difficulty", "piste:grooming", "piste:type", "description", "note", "website", "operator", "access", "ski", "fee", "seasonal", "opening_hours", "snowmobile", "snowmobile:conditional", "highway", "surface"];
const keepTags = (t) => Object.fromEntries(OSM_KEEP.filter((k) => t[k]).map((k) => [k, String(t[k]).slice(0, 300)]));

// Douglas-Peucker on a local flat projection (as build-winter.mjs's flat()): 6 m for runs and ski trails, 12 m for sled trails.
function simplify(pts, tol) {
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
const flat = (pts, tol) => simplify(pts, tol).flatMap(([lat, lon]) => [round(lat), round(lon)]);

// OPL tag text: %<hex code point>% escapes (as build-canada.mjs).
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

// ---------- ingest: one province -> out/winter/<prov>.lines ----------
async function ingest(prov, waysFile, relsFile) {
  const rels = [];
  if (relsFile && existsSync(relsFile)) for await (const line of createInterface({ input: createReadStream(relsFile) })) {
    if (!line.startsWith("r")) continue;
    const r = parseRelation(line);
    const type = /^(ski|piste|snowmobile)$/.test(r.tags.route || "") || r.tags["piste:type"] ? typeOf(r.tags) : "";
    if (type && r.ways.length) rels.push({ ...r, type });
  }
  const member = new Set(rels.flatMap((r) => r.ways));
  const ways = new Map(), routes = [];
  for await (const raw of createInterface({ input: createReadStream(waysFile), crlfDelay: Infinity })) {
    const s = raw.replace(/^\x1e/, "");
    if (!s) continue;
    let f;
    try { f = JSON.parse(s); } catch { continue; }
    const p = f.properties || {};
    if (p["@type"] !== "way" || !f.geometry || f.geometry.type !== "LineString") continue;
    const id = p["@id"], type = typeOf(p), pts = f.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    if (member.has(id)) ways.set(id, pts);
    if (!type) continue;
    const mid = pts[Math.floor(pts.length / 2)];
    if (inHome(mid[0], mid[1])) continue;
    const g = flat(pts, type === "snowmobile" ? 12 : 6);
    if (g.length < 4) continue;
    const r = { id: "w" + id, src: "osm", type, name: p.name || p["piste:name"] || p.ref || "", diff: p["piste:difficulty"] || "", g: [g], tags: keepTags(p), pv: prov.toUpperCase() };
    // A downhill run drawn as a closed ring is an area (a glade, a bowl), as build-winter.mjs's resortTerrain().
    if (type === "resort" && g.length >= 8 && Math.hypot((g[0] - g.at(-2)) * 110540, (g[1] - g.at(-1)) * 71000) < 15) r.area = 1;
    routes.push(r);
  }
  // Relations: the member ways not drawn already, as one route; drawn members get the route's name.
  const byId = new Map(routes.map((r) => [r.id, r]));
  for (const rel of rels) {
    const name = rel.tags.name || rel.tags["piste:name"] || rel.tags.ref || "", parts = [];
    for (const w of rel.ways) {
      const drawn = byId.get("w" + w);
      if (drawn) { drawn.routes = [...new Set([...(drawn.routes || []), name || "route " + rel.id])]; if (!drawn.name) drawn.name = name; continue; }
      const pts = ways.get(w);
      if (pts && pts.length >= 2) parts.push(flat(pts, rel.type === "snowmobile" ? 12 : 6));
    }
    if (!parts.length) continue;
    const mid = parts[0];
    if (inHome(mid[0], mid[1])) continue;
    routes.push({ id: "r" + rel.id, src: "osm", type: rel.type, name, diff: rel.tags["piste:difficulty"] || "", g: parts, tags: keepTags(rel.tags), pv: prov.toUpperCase() });
  }
  mkdirSync(PART, { recursive: true });
  const out = new URL(`${prov}.lines`, PART);
  writeFileSync(out, "");
  for (let i = 0; i < routes.length; i += 5000) appendFileSync(out, routes.slice(i, i + 5000).map((r) => JSON.stringify(r)).join("\n") + "\n");
  const n = (k) => routes.filter((r) => r.type === k).length;
  log(`${prov}: ${n("resort")} resort runs, ${n("nordic")} groomed nordic, ${n("snowmobile")} snowmobile trails`);
}

// ---------- finish: one file per square ----------
async function finish() {
  const tiles = new Map(), seen = new Set();
  if (existsSync(PART)) for (const f of readdirSync(PART).filter((f) => f.endsWith(".lines"))) {
    for await (const line of createInterface({ input: createReadStream(new URL(f, PART)) })) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (seen.has(r.id)) continue;   // a trail on a province line comes in both files
      seen.add(r.id);
      const k = tileOf(r.g[0][0], r.g[0][1]);
      (tiles.get(k) || tiles.set(k, []).get(k)).push(r);
    }
  }
  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const builtAt = new Date().toISOString().slice(0, 19) + "Z", index = {}, count = {};
  let bytes = 0;
  for (const [k, routes] of [...tiles].sort()) {
    const body = JSON.stringify({ routes });
    writeFileSync(new URL(k + ".json", OUT), body);
    bytes += body.length;
    let s = 90, w = 180, n = -90, e = -180;
    routes.forEach((r) => r.g.forEach((part) => { for (let i = 0; i < part.length; i += 2) { s = Math.min(s, part[i]); n = Math.max(n, part[i]); w = Math.min(w, part[i + 1]); e = Math.max(e, part[i + 1]); } }));
    index[k] = { r: routes.length, h: 0, kb: Math.ceil(body.length / 1024), box: [s, w, n, e].map((v) => +v.toFixed(3)) };
    routes.forEach((r) => { count[r.type] = (count[r.type] || 0) + 1; });
  }
  writeFileSync(new URL("index.json", OUT), JSON.stringify({ builtAt, tile: [TILE_LAT, TILE_LON], tiles: index }));
  log(`ca/w: ${seen.size} routes (${Object.entries(count).map(([k, v]) => `${k} ${v}`).join(", ")}) in ${tiles.size} squares, ${(bytes / 1e6).toFixed(1)} MB`);
  // The website is capped at 1 GB: say so loudly if this grows past what was planned for it.
  if (bytes > 40e6) log(`::warning::Canada resort, nordic and snowmobile trails are ${(bytes / 1e6).toFixed(0)} MB, more than the 40 MB planned`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "ingest") await ingest(...args);
else if (cmd === "finish") await finish();
else throw new Error("Use: ingest <prov> <ways.geojsonseq> <relations.opl> | finish");
