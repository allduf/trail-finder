// Weekly job (see .github/workflows/forest-roads.yml): the region's dirt and Forest Service roads, with what is known
// about their status, so the site can draw them in light purple under the trails ("Forest roads").
//
// Writes data/roads-<zone>.json for each zone, from two open sources:
//  - ften: BC government Forest Tenure road sections (DataBC layer WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW,
//    Open Government Licence - British Columbia): Forest Service Roads and road permits, each with its tenure
//    status (ACTIVE = held and maintained, RETIRED = tenure ended, often deactivated). Pending sections are left out.
//  - osm: OpenStreetMap dirt roads (highway=track, unpaved unclassified/service roads, roads named FSR and
//    disused/abandoned roads), with the tags that say whether they are gated, private, deactivated or rough.
// Shapes are simplified to about 8 m and rounded to 5 decimals. A source that fails keeps its last good data.
//
// Run: node scripts/build-roads.mjs   (Node 18 or newer, no packages needed; ONLY=ften or ONLY=osm runs one source)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const DATA = new URL("data/", root);
const UA = "trail-finder forest roads data (https://github.com/allduf/trail-finder)";
const OVERPASS = process.env.OVERPASS_URLS ? process.env.OVERPASS_URLS.split(",") : JSON.parse(html.match(/const OVERPASS = (\[[^\]]+\]);/)[1]);
const WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs";
const FTEN_LAYER = "WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW";
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
const ONLY = process.env.ONLY || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---------- BC Forest Tenure roads (WFS) ----------
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
const PAGE = 5000;
async function wfs(box) {
  const params = new URLSearchParams({
    service: "WFS", version: "2.0.0", request: "GetFeature", typeName: `pub:${FTEN_LAYER}`, outputFormat: "application/json",
    srsName: "EPSG:4326", count: String(PAGE), CQL_FILTER: `BBOX(GEOMETRY, ${albersBox(box).join(", ")}, 'EPSG:3005')`,
  });
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${WFS}?${params}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(180000) });
      const text = await res.text();
      if (!res.ok || !text.startsWith("{")) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300).replace(/\s+/g, " ")}`);
      return JSON.parse(text);
    } catch (e) { lastErr = e; log(`    ${e.message}; trying again`); await sleep(10000 * (attempt + 1)); }
  }
  throw lastErr;
}
const quarters = ([s, w, n, e]) => { const cs = (s + n) / 2, cw = (w + e) / 2; return [[s, w, cs, cw], [s, cw, cs, e], [cs, w, n, cw], [cs, cw, n, e]]; };
// A box with more sections than one page is fetched as 4 smaller boxes, so no paging (and no sort order) is needed.
async function fetchFten(box, depth = 0, seen = new Map()) {
  const fc = await wfs(box);
  const feats = fc.features || [];
  if ((fc.numberMatched > feats.length || feats.length >= PAGE) && depth < 5) {
    log(`    ${fc.numberMatched || feats.length}+ sections, splitting in 4`);
    for (const q of quarters(box)) await fetchFten(q, depth + 1, seen);
  } else feats.forEach((f) => seen.set(f.id || JSON.stringify(f.properties), f));
  return seen;
}
// Each section as { n: name, t: type, s: status, p: permit holder, f: file id, d: retired date, g: [lat, lon, ...] }.
// MultiLineStrings become one entry per part. Coordinates come back as lon, lat; flipped if they look the other way.
function ftenRoads(feats, [s, w, n, e]) {
  const out = [];
  let props = null;
  for (const f of feats) {
    const p = f.properties || {};
    props = props || Object.keys(p);
    const status = String(p.LIFE_CYCLE_STATUS_CODE || "").toUpperCase();
    if (!f.geometry || status === "PENDING") continue;
    const parts = f.geometry.type === "MultiLineString" ? f.geometry.coordinates : f.geometry.type === "LineString" ? [f.geometry.coordinates] : [];
    for (const part of parts) {
      let pts = part.map(([x, y]) => ({ lat: y, lon: x }));
      if (pts.length && Math.abs(pts[0].lat) > 90) pts = part.map(([x, y]) => ({ lat: x, lon: y }));
      if (pts.length < 2 || !pts.some((q) => q.lat >= s && q.lat <= n && q.lon >= w && q.lon <= e)) continue;
      const name = [p.MAP_LABEL, p.ROAD_SECTION_NAME].find((v) => v && String(v).trim()) || "";
      out.push({
        n: String(name).trim(), t: p.FILE_TYPE_DESCRIPTION || p.FILE_TYPE_CODE || "", s: status,
        p: p.CLIENT_NAME || "", f: [p.FOREST_FILE_ID, p.ROAD_SECTION_ID].filter(Boolean).join(" "),
        d: (p.RETIREMENT_DATE || "").slice(0, 10), g: simplify(pts).flatMap((q) => [round(q.lat), round(q.lon)]),
      });
    }
  }
  if (props) log(`    fields: ${props.join(", ")}`);
  return out;
}

// ---------- OpenStreetMap dirt roads (Overpass) ----------
const UNPAVED = "unpaved|gravel|fine_gravel|compacted|dirt|earth|ground|grass|mud|rock|pebblestone|sand|wood";
function osmQuery([s, w, n, e]) {
  const bb = [s, w, n, e].map((x) => x.toFixed(5)).join(",");
  return `[out:json][timeout:180];
(
  way["highway"="track"](${bb});
  way["highway"~"^(unclassified|service)$"][!"service"]["surface"~"^(${UNPAVED})$"](${bb});
  way["highway"~"^(unclassified|service|track|road)$"]["name"~"(FSR|Forest Service|Forest Road|Mainline)",i](${bb});
  way["disused:highway"](${bb});
  way["abandoned:highway"](${bb});
);
out tags geom qt;`;
}
const KEEP = /^(name|ref|highway|disused:highway|abandoned:highway|tracktype|surface|smoothness|access|motor_vehicle|motorcar|vehicle|4wd_only|seasonal|operator|note|description|fixme|bridge|ford|width|source)$/;
async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length], host = new URL(url).host;
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(query), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, signal: AbortSignal.timeout(240000) });
      if (res.ok) {
        const json = await res.json();
        if (json.remark && /error/i.test(json.remark)) throw Object.assign(new Error(`${host}: ${json.remark}`), { heavy: true });
        await sleep(2000);
        return json;
      }
      lastErr = new Error(`${host}: HTTP ${res.status}`);
      if (res.status !== 429 && res.status !== 504) throw lastErr;
    } catch (e) {
      if (e.heavy || (/HTTP 4\d\d/.test(e.message) && !/HTTP 429/.test(e.message))) throw e;
      lastErr = e;
    }
    const wait = Math.min(30000 * 2 ** Math.floor(attempt / OVERPASS.length), 240000);
    log(`    ${lastErr.message}; trying again in ${Math.round(wait / 1000)} s`);
    await sleep(wait);
  }
  throw lastErr;
}
async function fetchOsm(box, depth = 0) {
  try { return (await overpass(osmQuery(box))).elements; }
  catch (e) {
    if (!e.heavy || depth >= 2) throw e;
    log(`    too heavy, splitting in 4`);
    const seen = new Map();
    for (const q of quarters(box)) for (const el of await fetchOsm(q, depth + 1)) seen.set(el.id, el);
    return [...seen.values()];
  }
}

// Douglas-Peucker on a local flat projection, keeping points more than tol metres off the line.
function simplify(pts, tol = 8) {
  if (pts.length < 3) return pts;
  const k = Math.cos((pts[0].lat * Math.PI) / 180) * 111320, xy = pts.map((p) => [p.lon * k, p.lat * 110540]);
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
const round = (n) => Math.round(n * 1e5) / 1e5;
const readJson = (name) => { try { return JSON.parse(readFileSync(new URL(name, DATA), "utf8")); } catch { return null; } };
if (!existsSync(DATA)) mkdirSync(DATA);

const started = Date.now(), builtAt = new Date().toISOString().slice(0, 19) + "Z";
let updated = 0, failed = 0;
for (const z of ZONES) {
  const old = readJson(`roads-${z.id}.json`) || {};
  const file = { v: 1, builtAt, ften: old.ften || [], osm: old.osm || {}, ftenAt: old.ftenAt || null, osmAt: old.osmAt || null };
  let changed = false;
  if (ONLY !== "osm") {
    try {
      file.ften = ftenRoads([...(await fetchFten(z.box)).values()], z.box);
      file.ftenAt = builtAt; changed = true;
      const by = {}; file.ften.forEach((r) => { const k = `${r.t || "?"} ${r.s}`; by[k] = (by[k] || 0) + 1; });
      log(`${z.name}: ${file.ften.length} government road sections (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ")})`);
    } catch (e) { failed++; log(`${z.name}: government roads failed (${e.message}), keeping last good data`); }
  }
  if (ONLY !== "ften") {
    try {
      const els = await fetchOsm(z.box);
      file.osm = {};
      els.filter((el) => el.type === "way" && el.geometry && el.geometry.length > 1).forEach((el) => {
        const tags = Object.fromEntries(Object.entries(el.tags || {}).filter(([k]) => KEEP.test(k)));
        file.osm[el.id] = { tags, g: simplify(el.geometry).flatMap((p) => [round(p.lat), round(p.lon)]) };
      });
      file.osmAt = builtAt; changed = true;
      log(`${z.name}: ${Object.keys(file.osm).length} OpenStreetMap dirt roads`);
    } catch (e) { failed++; log(`${z.name}: OpenStreetMap roads failed (${e.message}), keeping last good data`); }
  }
  if (changed) { writeFileSync(new URL(`roads-${z.id}.json`, DATA), JSON.stringify(file)); updated++; }
}
log(`Done in ${Math.round((Date.now() - started) / 60e3)} min: ${updated} zones updated, ${failed} source failures.`);
if (failed && !updated) process.exit(1);
