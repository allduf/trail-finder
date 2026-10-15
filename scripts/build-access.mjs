// Nightly job (see .github/workflows/access-data.yml): trailheads, parking and recreation sites near the MTB trails,
// so the site can show where to park or get dropped off for each trail ("Getting there") and pin them on the map.
//
// Writes data/access-<zone>.json for each zone, from two open sources:
//  - OpenStreetMap (Overpass): every highway=trailhead, and amenity=parking that the public can use (not private,
//    customers only or a garage) within PARK_M of an MTB trail from data/mtb-<zone>.json, so town parking is left out.
//  - BC Recreation Sites and Trails (DataBC layer WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW, Open Government Licence
//    - British Columbia): recreation trails (their point is usually the trailhead), and sites within PARK_M of a trail.
// The road that reaches each point and its condition are worked out on the site, from the forest roads files.
// A source that fails keeps its last good data.
//
// Run: node scripts/build-access.mjs   (Node 18 or newer, no packages needed; ONLY=osm or ONLY=rec runs one part)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const DATA = new URL("data/", root);
const UA = "trail-finder access data (https://github.com/allduf/trail-finder)";
const OVERPASS = process.env.OVERPASS_URLS ? process.env.OVERPASS_URLS.split(",") : JSON.parse(html.match(/const OVERPASS = (\[[^\]]+\]);/)[1]);
const WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs";
const REC_LAYER = "WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW";
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
// DataBC and BC Wildfire only cover BC: zones east of 116.5° W (Calgary and the Rockies) are in Alberta.
const inBC = (z) => z.box[1] < -116.5;
const ONLY = process.env.ONLY || "";
const PARK_M = 1500;   // parking and rec sites further than this from any MTB trail are left out
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const round = (n) => Math.round(n * 1e5) / 1e5;
const readJson = (name) => { try { return JSON.parse(readFileSync(new URL(name, DATA), "utf8")); } catch { return null; } };
if (!existsSync(DATA)) mkdirSync(DATA);

// ---------- near an MTB trail? (grid of trail points, about 1.1 km cells) ----------
const CELL = 0.01;
function trailGrid(zoneId) {
  const f = readJson(`mtb-${zoneId}.json`), grid = new Map();
  if (!f) return null;
  for (const w of Object.values(f.ways || {})) {
    for (let i = 0; i < w.g.length; i += 2) {
      const k = `${Math.floor(w.g[i] / CELL)},${Math.floor(w.g[i + 1] / CELL)}`;
      (grid.get(k) || grid.set(k, []).get(k)).push(w.g[i], w.g[i + 1]);
    }
  }
  return grid;
}
function nearTrail(grid, lat, lon, max = PARK_M) {
  if (!grid) return true;   // no trail list yet: keep everything rather than nothing
  const ci = Math.floor(lat / CELL), cj = Math.floor(lon / CELL), r = Math.ceil(max / 700), k = Math.cos((lat * Math.PI) / 180);
  for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
    const pts = grid.get(`${i},${j}`);
    if (!pts) continue;
    for (let p = 0; p < pts.length; p += 2) if (Math.hypot((pts[p] - lat) * 110540, (pts[p + 1] - lon) * 111320 * k) <= max) return true;
  }
  return false;
}

// ---------- OpenStreetMap trailheads and parking (Overpass) ----------
function osmQuery([s, w, n, e]) {
  const bb = [s, w, n, e].map((x) => x.toFixed(5)).join(",");
  return `[out:json][timeout:180];
(
  nwr["highway"="trailhead"](${bb});
  nwr["amenity"="parking"]["access"!~"^(private|no|customers|residents|permit|delivery|employees)$"]["parking"!~"^(underground|multi-storey|rooftop|garage_boxes|carports)$"](${bb});
);
out tags center qt;`;
}
const KEEP = /^(name|ref|highway|amenity|parking|access|fee|charge|surface|capacity|operator|opening_hours|maxstay|toilets|description|note|website|seasonal)$/;
async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length], host = new URL(url).host;
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(query), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, signal: AbortSignal.timeout(240000) });
      if (res.ok) {
        const json = await res.json();
        if (json.remark && /error/i.test(json.remark)) throw new Error(`${host}: ${json.remark}`);
        await sleep(2000);
        return json;
      }
      lastErr = new Error(`${host}: HTTP ${res.status}`);
      if (res.status !== 429 && res.status !== 504) throw lastErr;
    } catch (e) {
      if (/HTTP 4\d\d/.test(e.message) && !/HTTP 429/.test(e.message)) throw e;
      lastErr = e;
    }
    const wait = Math.min(30000 * 2 ** Math.floor(attempt / OVERPASS.length), 240000);
    log(`    ${lastErr.message}; trying again in ${Math.round(wait / 1000)} s`);
    await sleep(wait);
  }
  throw lastErr;
}
async function osmPoints(z, grid) {
  const els = (await overpass(osmQuery(z.box))).elements || [];
  const out = [];
  for (const el of els) {
    const c = el.type === "node" ? el : el.center, t = el.tags || {};
    if (!c) continue;
    const k = t.highway === "trailhead" ? "th" : "p";
    if (k === "p" && !nearTrail(grid, c.lat, c.lon)) continue;
    out.push({ id: `${el.type[0]}${el.id}`, k, lat: round(c.lat), lon: round(c.lon), t: Object.fromEntries(Object.entries(t).filter(([key]) => KEEP.test(key))) });
  }
  return out;
}

// ---------- BC Recreation Sites and Trails (WFS) ----------
// The query box is in BC Albers (EPSG:3005), which has no axis-order surprises.
function albers(lat, lon) {
  const a = 6378137, f = 1 / 298.257222101, e2 = 2 * f - f * f, e = Math.sqrt(e2), rad = Math.PI / 180;
  const m = (p) => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const q = (p) => { const s = Math.sin(p); return (1 - e2) * (s / (1 - e2 * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s))); };
  const p1 = 50 * rad, p2 = 58.5 * rad, p0 = 45 * rad, l0 = -126 * rad;
  const n = (m(p1) ** 2 - m(p2) ** 2) / (q(p2) - q(p1)), C = m(p1) ** 2 + n * q(p1);
  const rho0 = (a * Math.sqrt(C - n * q(p0))) / n, rho = (a * Math.sqrt(C - n * q(lat * rad))) / n, th = n * (lon * rad - l0);
  return [1000000 + rho * Math.sin(th), rho0 - rho * Math.cos(th)];
}
function albersBox([s, w, n, e]) {
  const pts = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) pts.push(albers(s + ((n - s) * i) / 4, w + ((e - w) * j) / 4));
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))].map((v) => v.toFixed(1));
}
const wfsError = (text) => ((text.match(/<ows:ExceptionText>([\s\S]*?)<\/ows:ExceptionText>/) || [])[1] || text).slice(0, 400).replace(/\s+/g, " ");
let recCol = null;
async function geomCol() {
  if (recCol) return recCol;
  recCol = "GEOMETRY";
  try {
    const params = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "DescribeFeatureType", typeName: `pub:${REC_LAYER}`, outputFormat: "application/json" });
    const res = await fetch(`${WFS}?${params}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
    const props = (JSON.parse(await res.text()).featureTypes || [])[0]?.properties || [];
    const g = props.find((p) => /^gml:/.test(p.type || ""));
    if (g) recCol = g.name;
    log(`    rec sites: shape column ${recCol}; fields ${props.map((p) => p.name).join(", ")}`);
  } catch (e) { log(`    rec sites: could not describe the layer (${e.message})`); }
  return recCol;
}
async function recSites(box) {
  const col = await geomCol();
  let lastErr;
  for (const where of [""]) {
    const params = new URLSearchParams({
      service: "WFS", version: "2.0.0", request: "GetFeature", typeName: `pub:${REC_LAYER}`, outputFormat: "application/json",
      srsName: "EPSG:4326", count: "5000", CQL_FILTER: `BBOX(${col}, ${albersBox(box).join(", ")}, 'EPSG:3005')${where ? ` AND (${where})` : ""}`,
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${WFS}?${params}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120000) });
        const text = await res.text();
        if (!res.ok || !text.startsWith("{")) throw new Error(`HTTP ${res.status}: ${wfsError(text)}`);
        const feats = JSON.parse(text).features || [];
        if (feats[0]) log(`    rec sites fields: ${Object.keys(feats[0].properties || {}).join(", ")}`);
        return feats;
      } catch (e) {
        lastErr = e; log(`    ${e.message}`);
        if (/HTTP 400/.test(e.message)) break;
        await sleep(10000 * (attempt + 1));
      }
    }
  }
  throw lastErr;
}
function recPoints(feats, grid) {
  const out = [];
  for (const f of feats) {
    const p = f.properties || {}, g = f.geometry;
    const xy = g && (g.type === "Point" ? g.coordinates : g.type === "MultiPoint" ? g.coordinates[0] : null);
    if (!xy) continue;
    const [lat, lon] = Math.abs(xy[1]) > 90 ? [xy[0], xy[1]] : [xy[1], xy[0]];
    // The layer has no type field: a name with "Trail" in it is a recreation trail, its point usually the trailhead.
    const name = String(p.PROJECT_NAME || "").trim(), type = /\btrails?\b/i.test(name) ? "Recreation trail" : "Recreation site";
    const trail = /trail/i.test(type);
    if (!trail && !nearTrail(grid, lat, lon)) continue;
    out.push({ id: String(p.FOREST_FILE_ID || f.id), k: "rec", lat: round(lat), lon: round(lon),
      t: { name, type, loc: String(p.SITE_LOCATION || "").trim().slice(0, 200),
        dir: String(p.DRIVING_DIRECTIONS || "").trim().slice(0, 400), closed: String(p.CLOSURE_DESCRIPTION || "").trim().slice(0, 200) } });
  }
  return out;
}

const started = Date.now(), builtAt = new Date().toISOString().slice(0, 19) + "Z";
let updated = 0, failed = 0;
for (const z of ZONES) {
  const old = readJson(`access-${z.id}.json`) || {};
  const file = { v: 1, builtAt, osm: old.osm || [], rec: old.rec || [], osmAt: old.osmAt || null, recAt: old.recAt || null };
  const grid = trailGrid(z.id);
  let changed = false;
  if (ONLY !== "rec") {
    try {
      file.osm = await osmPoints(z, grid); file.osmAt = builtAt; changed = true;
      log(`${z.name}: ${file.osm.filter((p) => p.k === "th").length} trailheads, ${file.osm.filter((p) => p.k === "p").length} parking near trails`);
    } catch (e) { failed++; log(`${z.name}: OpenStreetMap failed (${e.message}), keeping last good data`); }
  }
  if (ONLY !== "osm" && inBC(z)) {
    try {
      file.rec = recPoints(await recSites(z.box), grid); file.recAt = builtAt; changed = true;
      log(`${z.name}: ${file.rec.length} recreation sites and trails${file.rec[0] ? ` (e.g. ${file.rec[0].t.name}, ${file.rec[0].t.type})` : ""}`);
    } catch (e) { failed++; log(`${z.name}: recreation sites failed (${e.message}), keeping last good data`); }
  }
  if (changed) { writeFileSync(new URL(`access-${z.id}.json`, DATA), JSON.stringify(file)); updated++; }
}
log(`Done in ${Math.round((Date.now() - started) / 60e3)} min: ${updated} zones updated, ${failed} source failures.`);
if (failed && !updated) process.exit(1);
