// Winter data job (see .github/workflows/winter-data.yml), for the site's "Winter" mode.
//
// Writes two files:
//  - data/ski.json: backcountry ski routes and huts in the whole region, from every open source found:
//      - osm: OpenStreetMap ski routes (piste:type=skitour, nordic, hike = snowshoe, downhill runs, sled/snowmobile),
//        ski route relations (route=ski / route=piste), ways tagged ski=yes, and alpine / wilderness huts.
//      - bc: BC government Recreation Sites and Trails (DataBC layer WHSE_FOREST_TENURE.FTEN_RECREATION_LINES_SVW,
//        Open Government Licence - British Columbia) whose name or description says ski, snowshoe or nordic.
//      - c2c: camptocamp.org ski touring and snowshoe routes (CC BY-SA), from its public API (no key). Mostly the
//        Alps, so only a few here; routes with only a start point (no drawn line) go in "starts" as pins.
//      Unnamed routes get "near": the named OpenStreetMap peak closest to them (within 3 km).
//  - data/avalanche.json: Avalanche Canada's current avalanche forecasts for the forecast areas that touch the
//    region (Sea to Sky, South Coast, South Coast Inland...), with the area outlines, danger ratings by elevation
//    band for each day and the avalanche problems (aspects, elevations, likelihood, size). From the public
//    Avalanche Canada API (no key). Out of season there are no forecasts and the file says so.
//  - data/avalanche-reports.json: the last 14 days of Avalanche Canada Mountain Information Network reports in the
//    region (riders' own avalanche, snowpack and conditions reports, public on avalanche.ca), for "Avalanches
//    reported nearby" in a ski route's details. Made with the forecasts (ONLY=avy).
//  - data/grooming.json: the latest grooming report of each snowmobile club in data/snowmobile-clubs.json (a hand-kept
//    list) whose report is on a public web page ("auto": true), as plain text with when it last changed. Clubs that
//    post only on Facebook or Instagram are not read (their terms forbid it): the site links to them instead.
// A source that fails keeps its last good data.
//
// Run: node scripts/build-winter.mjs   (Node 18 or newer, no packages; ONLY=ski, avy or groom runs one part; ONLY=avy,groom two)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const DATA = new URL("data/", root);
const UA = "trail-finder winter data (https://github.com/allduf/trail-finder)";
const OVERPASS = process.env.OVERPASS_URLS ? process.env.OVERPASS_URLS.split(",") : JSON.parse(html.match(/const OVERPASS = (\[[^\]]+\]);/)[1]);
const WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs";
const AVCAN = process.env.AVCAN_API || "https://api.avalanche.ca";
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
// Where to look for ski routes: each zone, a little wider (the ski terrain goes further up the valleys than the riding areas),
// with nearby zones merged into one box. Not one box around everything, so the empty country between isn't asked for.
const ALBERTA = JSON.parse((html.match(/const ALBERTA_ZONES = (\[[^\]]*\]);/) || [])[1] || "null");
if (!ALBERTA) throw new Error("Couldn't find ALBERTA_ZONES in index.html");
const inBC = (z) => !ALBERTA.includes(z.id);
const pad = ([s, w, n, e]) => [s - 0.05, w - 0.1, n + 0.05, e + 0.1];
const area = ([s, w, n, e]) => (n - s) * (e - w);
const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
// Two boxes merge when the merged box is at most twice the zone area they cover (so mostly riding areas, not empty land between).
function mergeBoxes(boxes) {
  const list = boxes.map((b) => ({ b, covered: area(b) }));
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < list.length && !merged; i++) for (let j = i + 1; j < list.length && !merged; j++) {
      const u = union(list[i].b, list[j].b), covered = list[i].covered + list[j].covered;
      if (area(u) <= 2 * covered) { list[i] = { b: u, covered }; list.splice(j, 1); merged = true; }
    }
  }
  return list.map(({ b }) => b.map((v) => +v.toFixed(2)));
}
const REGIONS = mergeBoxes(ZONES.map((z) => pad(z.box)));
const BC_REGIONS = mergeBoxes(ZONES.filter(inBC).map((z) => pad(z.box)));
const ONLY = (process.env.ONLY || "").split(",").filter(Boolean), runs = (part) => !ONLY.length || ONLY.includes(part);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const round = (n) => Math.round(n * 1e5) / 1e5;
const readJson = (name) => { try { return JSON.parse(readFileSync(new URL(name, DATA), "utf8")); } catch { return null; } };
const quarters = ([s, w, n, e]) => { const cs = (s + n) / 2, cw = (w + e) / 2; return [[s, w, cs, cw], [s, cw, cs, e], [cs, w, n, cw], [cs, cw, n, e]]; };

// Douglas-Peucker on {lat, lon} points, tol in metres.
function simplify(pts, tol = 8) {
  if (pts.length < 3) return pts;
  const [f, l] = [pts[0], pts[pts.length - 1]];
  if (f.lat === l.lat && f.lon === l.lon) {   // a closed ring: split it at its farthest point
    let m = 1, dm = -1;
    pts.forEach((p, i) => { const d = (p.lat - f.lat) ** 2 + ((p.lon - f.lon) * Math.cos((f.lat * Math.PI) / 180)) ** 2; if (d > dm) { dm = d; m = i; } });
    if (m > 0 && m < pts.length - 1) return [...simplify(pts.slice(0, m + 1), tol), ...simplify(pts.slice(m), tol).slice(1)];
  }
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
const flat = (pts, tol) => simplify(pts, tol).flatMap((p) => [round(p.lat), round(p.lon)]);

// ---------- OpenStreetMap (Overpass) ----------
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
const skiQuery = ([s, w, n, e]) => `[out:json][timeout:200][bbox:${s},${w},${n},${e}];
(
  way["piste:type"];
  relation["piste:type"];
  relation["route"~"^(ski|piste)$"];
  way["ski"~"^(yes|designated|permissive)$"];
  way["ski:nordic"~"^(yes|designated)$"];
  nwr["tourism"~"^(alpine_hut|wilderness_hut)$"];
  nwr["amenity"="shelter"]["shelter_type"="basic_hut"];
  way["snowmobile"~"^(yes|designated|permissive)$"]["highway"!~"^(motorway|trunk|primary|secondary|tertiary|residential|motorway_link|trunk_link|primary_link|secondary_link)$"];
  relation["route"="snowmobile"];
);
out tags geom qt;`;
async function fetchOsm(box, depth = 0) {
  try { return (await overpass(skiQuery(box))).elements; }
  catch (e) {
    if (!e.heavy || depth >= 2) throw e;
    log("    too heavy, splitting in 4");
    const seen = new Map();
    for (const q of quarters(box)) for (const el of await fetchOsm(q, depth + 1)) seen.set(el.type + el.id, el);
    return [...seen.values()];
  }
}

// What kind of winter route a set of tags is. Backcountry downhill (piste:grooming=backcountry) is ski touring.
// piste:type=sled is a sledding / tubing hill; snowmobile trails are piste:type=snowmobile, route=snowmobile or
// snowmobile=yes|designated|permissive (often a forest road that is a sled trail in winter).
const SNOWMOBILE_OK = /^(yes|designated|permissive)$/;
function skiType(t) {
  const pt = String(t["piste:type"] || "").split(";")[0];
  const groom = t["piste:grooming"] || "";
  if (pt === "skitour" || (pt === "downhill" && /backcountry|no/.test(groom)) || (t.route === "ski" && !pt)) return "tour";
  if (pt === "nordic") return "nordic";
  if (pt === "hike") return "snowshoe";
  if (pt === "downhill") return "resort";
  if (pt === "snowmobile" || t.route === "snowmobile") return "snowmobile";
  if (pt === "sled") return "sled";
  if (pt) return "other";
  if (SNOWMOBILE_OK.test(t.snowmobile || "")) return "snowmobile";
  if (t["ski:nordic"]) return "nordic";
  if (t.ski) return "access";
  return "";
}
const OSM_KEEP = ["name", "ref", "piste:name", "piste:difficulty", "piste:grooming", "piste:type", "description", "note", "website", "operator", "access", "ski", "ele", "fee", "capacity", "reservation", "url", "seasonal", "opening_hours", "snowmobile", "snowmobile:conditional", "highway", "surface"];
const keepTags = (t) => Object.fromEntries(OSM_KEEP.filter((k) => t[k]).map((k) => [k, String(t[k]).slice(0, 300)]));

async function buildOsm() {
  const seen = new Map();
  for (const box of REGIONS) {
    log(`OpenStreetMap ski routes and huts in ${box.join(",")}`);
    for (const el of await fetchOsm(box)) seen.set(el.type + el.id, el);
  }
  const els = [...seen.values()];
  log(`  ${els.length} elements`);
  const routes = [], huts = [], wayIds = new Set();
  // Ways first, so relation members already drawn on their own aren't drawn twice.
  for (const el of els.filter((e) => e.type === "way" && e.geometry)) {
    const t = el.tags || {};
    if (/hut|shelter/.test(t.tourism || t.amenity || "")) continue;
    const type = skiType(t);
    if (!type) continue;
    const g = flat(el.geometry.map((p) => ({ lat: p.lat, lon: p.lon })), 6);
    if (g.length < 4) continue;
    wayIds.add(el.id);
    routes.push({ id: "w" + el.id, src: "osm", type, name: t.name || t["piste:name"] || t.ref || "", diff: t["piste:difficulty"] || "", g: [g], tags: keepTags(t) });
  }
  for (const el of els.filter((e) => e.type === "relation")) {
    const t = el.tags || {};
    if (/hut|shelter/.test(t.tourism || t.amenity || "")) continue;
    const type = skiType(t) || "tour";
    const name = t.name || t["piste:name"] || t.ref || "";
    const parts = [], memberIds = [];
    for (const m of el.members || []) {
      if (m.type !== "way" || !m.geometry) continue;
      memberIds.push(m.ref);
      if (wayIds.has(m.ref)) {   // already drawn: just give it the route's name
        const r = routes.find((r) => r.id === "w" + m.ref);
        if (r) { r.routes = [...new Set([...(r.routes || []), name || "route " + el.id])]; if (!r.name) r.name = name; }
        continue;
      }
      const g = flat(m.geometry.filter(Boolean).map((p) => ({ lat: p.lat, lon: p.lon })), 6);
      if (g.length >= 4) parts.push(g);
    }
    if (parts.length) routes.push({ id: "r" + el.id, src: "osm", type, name, diff: t["piste:difficulty"] || "", g: parts, tags: keepTags(t) });
  }
  for (const el of els) {
    const t = el.tags || {};
    if (!/alpine_hut|wilderness_hut/.test(t.tourism || "") && t.amenity !== "shelter") continue;
    let lat = el.lat, lon = el.lon;
    const pts = el.geometry || (el.members || []).flatMap((m) => m.geometry || []).filter(Boolean);
    if (lat == null && pts.length) { lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length; lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length; }
    if (lat == null) continue;
    huts.push({ id: el.type[0] + el.id, name: t.name || "", kind: t.tourism || "shelter", lat: round(lat), lon: round(lon), tags: keepTags(t) });
  }
  const count = (k) => routes.filter((r) => r.type === k).length;
  log(`  routes: ${routes.length} (tour ${count("tour")}, nordic ${count("nordic")}, snowshoe ${count("snowshoe")}, resort ${count("resort")}, sled ${count("sled")}, snowmobile ${count("snowmobile")}, access ${count("access")}, other ${count("other")}); huts: ${huts.length}`);
  return { routes, huts };
}

// Named peaks, so an unnamed route can be called after the peak it goes up or passes ("Ski touring near Ipsoot Mountain").
async function buildPeaks() {
  const peaks = new Map();
  for (const [s, w, n, e] of REGIONS) {
    const json = await overpass(`[out:json][timeout:120][bbox:${s},${w},${n},${e}];node["natural"~"^(peak|volcano)$"]["name"];out;`);
    for (const el of json.elements || []) peaks.set(el.id, { name: el.tags.name, lat: el.lat, lon: el.lon, ele: parseFloat(el.tags.ele) || 0 });
  }
  log(`  ${peaks.size} named peaks`);
  return [...peaks.values()];
}
// The named peak closest to any point of the route, within 3 km.
function nameNearPeaks(routes, peaks) {
  const CELL = 0.05, grid = new Map(), key = (a, b) => a + "," + b;
  for (const p of peaks) { const k = key(Math.floor(p.lat / CELL), Math.floor(p.lon / CELL)); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
  let n = 0;
  for (const r of routes) {
    if (r.name || !r.g) continue;
    let best = null, bestD = 3000;
    for (const part of r.g) for (let i = 0; i < part.length; i += 2) {
      const lat = part[i], lon = part[i + 1], cy = Math.floor(lat / CELL), cx = Math.floor(lon / CELL), k = Math.cos((lat * Math.PI) / 180);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const p of grid.get(key(cy + dy, cx + dx)) || []) {
        const d = Math.hypot((p.lat - lat) * 110540, (p.lon - lon) * 111320 * k);
        if (d < bestD) { bestD = d; best = p; }
      }
    }
    if (best) { r.near = best.name; n++; } else delete r.near;
  }
  log(`  ${n} unnamed routes named after a peak within 3 km`);
}

// ---------- BC Recreation Sites and Trails (DataBC WFS) ----------
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
async function wfsGet(params, timeout = 180000) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${WFS}?${new URLSearchParams(params)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeout) });
      const text = await res.text();
      if (!res.ok || !text.startsWith("{")) throw new Error(`HTTP ${res.status}: ${wfsError(text)}`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e; log(`    ${e.message}`);
      if (/HTTP 400/.test(e.message)) break;
      await sleep(10000 * (attempt + 1));
    }
  }
  throw lastErr;
}
async function describe(layer) {
  const fc = await wfsGet({ service: "WFS", version: "2.0.0", request: "DescribeFeatureType", typeName: `pub:${layer}`, outputFormat: "application/json" }, 60000);
  const props = (fc.featureTypes || [])[0]?.properties || [];
  return { geom: (props.find((p) => /^gml:/.test(p.type || "")) || {}).name || "GEOMETRY", fields: props.map((p) => p.name) };
}
async function wfsAll(layer, box, col, depth = 0, seen = new Map()) {
  const fc = await wfsGet({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: `pub:${layer}`, outputFormat: "application/json",
    srsName: "EPSG:4326", count: "5000", CQL_FILTER: `BBOX(${col}, ${albersBox(box).join(", ")}, 'EPSG:3005')` });
  const feats = fc.features || [];
  if ((fc.numberMatched > feats.length || feats.length >= 5000) && depth < 4) for (const q of quarters(box)) await wfsAll(layer, q, col, depth + 1, seen);
  else feats.forEach((f) => seen.set(f.id || JSON.stringify(f.properties), f));
  return seen;
}
const lines = (geom) => {
  const ls = geom.type === "MultiLineString" ? geom.coordinates : geom.type === "LineString" ? [geom.coordinates] : [];
  return ls.map((l) => { let pts = l.map(([x, y]) => ({ lat: y, lon: x })); if (pts.length && Math.abs(pts[0].lat) > 90) pts = l.map(([x, y]) => ({ lat: x, lon: y })); return pts; });
};
const SLED_WORDS = /\b(snowmobil\w*|snow ?machin\w*|sledd?(er|ers|ing)?|skidoo|ski-doo|motori[sz]ed winter)\b/i;
const WINTER_WORDS = new RegExp(`\\b(ski|skiing|skis|nordic|x-?c|cross[- ]country|snowshoe\\w*|snow ?shoe\\w*|backcountry|touring|winter)\\b|${SLED_WORDS.source}`, "i");
async function buildBc() {
  const REC = "WHSE_FOREST_TENURE.FTEN_RECREATION_LINES_SVW";
  log(`BC Recreation Sites and Trails (${REC})`);
  const d = await describe(REC);
  log(`  fields: ${d.fields.join(", ")}`);
  const all = new Map();
  for (const box of BC_REGIONS) for (const [k, f] of await wfsAll(REC, box, d.geom)) all.set(k, f);
  const feats = [...all.values()];
  log(`  ${feats.length} recreation trails in the region`);
  // Optional: a recreation activity table, if DataBC has one, says which sites are for skiing or snowshoeing.
  const skiIds = new Set();
  for (const layer of ["WHSE_FOREST_TENURE.FTEN_REC_ACTIVITY_SVW", "WHSE_FOREST_TENURE.FTEN_RECREATION_ACTIVITY_SVW"]) {
    try {
      const fc = await wfsGet({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: `pub:${layer}`, outputFormat: "application/json", count: "20000" });
      const rows = fc.features || [];
      log(`  ${layer}: ${rows.length} rows; fields ${Object.keys(rows[0]?.properties || {}).join(", ")}`);
      rows.forEach((r) => { const p = r.properties || {}; if (WINTER_WORDS.test(Object.values(p).filter((v) => typeof v === "string").join(" "))) skiIds.add(p.FOREST_FILE_ID); });
      break;
    } catch (e) { log(`  ${layer}: not available (${e.message.slice(0, 120)})`); }
  }
  const routes = [];
  for (const f of feats) {
    const p = f.properties || {};
    const text = Object.entries(p).filter(([k, v]) => typeof v === "string" && !/GEOMETRY|SHAPE/.test(k)).map(([, v]) => v).join(" ");
    if (!WINTER_WORDS.test(text) && !skiIds.has(p.FOREST_FILE_ID)) continue;
    if (/RETIRED|CANCELLED/i.test(p.LIFE_CYCLE_STATUS_CODE || "")) continue;
    const g = lines(f.geometry || { type: "" }).map((l) => flat(l, 8)).filter((l) => l.length >= 4);
    if (!g.length) continue;
    const name = p.PROJECT_NAME || p.SITE_NAME || p.TRAIL_NAME || "";
    const type = SLED_WORDS.test(text) && !/\b(ski|nordic|snowshoe)/i.test(text.replace(/ski-?doo/gi, "")) ? "snowmobile" : /nordic|x-?c|cross[- ]country/i.test(text) ? "nordic" : /snowshoe|snow ?shoe/i.test(text) && !/\bski/i.test(text) ? "snowshoe" : "tour";
    routes.push({ id: "bc" + (p.FOREST_FILE_ID || f.id), src: "bc", type, name, diff: "", g,
      tags: Object.fromEntries(Object.entries(p).filter(([k, v]) => v != null && v !== "" && typeof v !== "object" && !/GEOMETRY|SHAPE|OBJECTID|SE_ANNO/.test(k)).slice(0, 14).map(([k, v]) => [k, String(v).slice(0, 300)])) });
  }
  log(`  ${routes.length} winter recreation trails kept`);
  return routes;
}

// ---------- camptocamp.org ----------
// The API works in Web Mercator (EPSG:3857). List: /routes?bbox=&act=, then each route's own page for its line.
const C2C = process.env.C2C_API || "https://api.camptocamp.org";
const toMerc = (lat, lon) => [lon * 20037508.34 / 180, Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 6378137];
const fromMerc = ([x, y]) => ({ lat: (Math.atan(Math.exp(y / 6378137)) * 360) / Math.PI - 90, lon: (x * 180) / 20037508.34 });
const c2cTitle = (d) => {
  const l = (d.locales || []).find((x) => x.lang === "en") || (d.locales || [])[0] || {};
  return [l.title_prefix, l.title].filter(Boolean).join(" : ");
};
async function buildC2c() {
  const docs = [];
  for (const R of REGIONS) {
    const [x0, y0] = toMerc(R[0], R[1]), [x1, y1] = toMerc(R[2], R[3]);
    const bbox = [x0, y0, x1, y1].map((v) => Math.round(v)).join(",");
    log(`camptocamp.org ski touring and snowshoe routes in ${bbox} (EPSG:3857)`);
    const got = [];
    for (let offset = 0; offset < 2000; offset += 100) {
      const page = await getJson(`${C2C}/routes?bbox=${bbox}&act=skitouring,snowshoeing&limit=100&offset=${offset}&pl=en`);
      const list = page.documents || [];
      if (!offset) log(`  ${page.total} routes; first keys: ${Object.keys(list[0] || {}).join(", ")}`);
      got.push(...list);
      if (list.length < 100 || got.length >= (page.total || 0)) break;
      await sleep(1000);
    }
    got.forEach((d) => { if (!docs.some((x) => x.document_id === d.document_id)) docs.push(d); });   // boxes can overlap
  }
  const routes = [], starts = [];
  for (const d of docs) {
    const id = d.document_id;
    let full;
    try { full = await getJson(`${C2C}/routes/${id}?cook=en`); } catch { continue; }
    await sleep(500);
    let geom = full.geometry?.geom_detail;
    try { if (typeof geom === "string") geom = JSON.parse(geom); } catch { geom = null; }
    const parts = !geom ? [] : geom.type === "LineString" ? [geom.coordinates] : geom.type === "MultiLineString" ? geom.coordinates : [];
    const g = parts.map((l) => flat(l.map(fromMerc), 8)).filter((l) => l.length >= 4);
    const acts = full.activities || d.activities || [];
    const tags = {};
    if (full.ski_rating) tags["ski rating"] = String(full.ski_rating);
    if (full.ski_exposition) tags["ski exposure"] = String(full.ski_exposition);
    if (full.labande_global_rating) tags["overall rating"] = String(full.labande_global_rating);
    if (full.elevation_max) tags["top elevation"] = full.elevation_max + " m";
    if (full.height_diff_up) tags.climb = full.height_diff_up + " m";
    if (full.orientations?.length) tags.aspects = full.orientations.join(", ");
    const type = acts.includes("skitouring") ? "tour" : "snowshoe", name = c2cTitle(full) || c2cTitle(d);
    if (g.length) { routes.push({ id: "c2c" + id, src: "c2c", type, name, diff: full.ski_rating || "", g, tags }); continue; }
    let pt = full.geometry?.geom || d.geometry?.geom;
    try { if (typeof pt === "string") pt = JSON.parse(pt); } catch { pt = null; }
    if (pt?.type !== "Point") continue;
    const { lat, lon } = fromMerc(pt.coordinates);
    starts.push({ id: "c2c" + id, src: "c2c", type, name, diff: full.ski_rating || "", lat: round(lat), lon: round(lon), tags });
  }
  log(`  ${routes.length} routes with a drawn line, ${starts.length} with only a start point (shown as pins)`);
  return { routes, starts };
}

// ---------- Avalanche Canada forecasts ----------
async function getJson(url) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) { lastErr = e; log(`    ${url}: ${e.message}`); await sleep(5000 * (attempt + 1)); }
  }
  throw lastErr;
}
const text = (v) => String(v == null ? "" : typeof v === "object" ? v.display || v.value || "" : v)
  .replace(/<(br|\/p|\/li)\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const val = (v) => (v == null ? "" : typeof v === "object" ? String(v.value ?? v.display ?? "") : String(v));
// "considerable", "3", "3 - Considerable", {value: "considerable"}... -> 0 (no rating) to 5.
const LEVELS = { low: 1, moderate: 2, considerable: 3, high: 4, extreme: 5 };
function level(r) {
  if (r && typeof r === "object" && r.rating) r = r.rating;
  const s = (val(r) + " " + (r && typeof r === "object" ? r.display || "" : "")).toLowerCase();
  const n = s.match(/[1-5]/);
  if (n) return +n[0];
  for (const [k, v] of Object.entries(LEVELS)) if (s.includes(k)) return v;
  return 0;
}
const BAND = (s) => { s = val(s).toLowerCase(); return /alp/.test(s) ? "alp" : /tln|treeline|tl/.test(s) ? "tln" : /btl|below/.test(s) ? "btl" : ""; };
const ASPECTS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
const ASPECT = (s) => { s = val(s).toLowerCase().replace(/[^a-z]/g, ""); const short = { north: "n", northeast: "ne", east: "e", southeast: "se", south: "s", southwest: "sw", west: "w", northwest: "nw" }[s] || s; return ASPECTS.includes(short) ? short : ""; };

// Out of season Avalanche Canada publishes one bulletin for the whole province, titled with every area's name.
const shortTitle = (t) => (t.split("-").length > 8 ? "Avalanche Canada early season bulletin (all of BC)" : t);
function normalizeForecast(p) {
  const r = p.report || p;
  const days = (r.dangerRatings || []).map((d) => {
    const rt = d.ratings || d;
    return { date: val(d.date).slice(0, 10) || val(d.date?.value).slice(0, 10), label: text(d.date?.display || d.date), alp: level(rt.alp), tln: level(rt.tln), btl: level(rt.btl) };
  });
  const problems = (r.problems || []).map((pr) => {
    const d = pr.data || pr;
    const size = d.expectedSize ? [d.expectedSize.min, d.expectedSize.max].filter((x) => x != null).join("-") : "";
    return {
      type: text(pr.type) || text(pr.name), aspects: [...new Set((d.aspects || []).map(ASPECT).filter(Boolean))],
      elevations: [...new Set((d.elevations || []).map(BAND).filter(Boolean))], likelihood: text(d.likelihood), size,
      comment: text(pr.comment).slice(0, 1200),
    };
  });
  const summaries = Object.fromEntries((r.summaries || []).map((s) => [val(s.type).toLowerCase(), text(s.content).slice(0, 1500)]));
  return {
    id: p.id || r.id || "", title: shortTitle(text(r.title) || text(p.area?.name)), url: p.url || (p.slug ? `https://avalanche.ca/forecasts/${p.slug}` : "https://avalanche.ca/map"),
    owner: text(p.owner) || "Avalanche Canada", issued: val(r.dateIssued), validUntil: val(r.validUntil), forecaster: text(r.forecaster),
    highlights: text(r.highlights).slice(0, 1500), confidence: text(r.confidence?.rating), summaries,
    advice: (r.terrainAndTravelAdvice || []).map(text).filter(Boolean).slice(0, 8),
    days, problems,
  };
}
// The API sometimes gives an area's id as its name.
const areaName = (v) => { const s = text(v); return /^[0-9a-f]{24,}$/i.test(s) ? "" : s; };
// Area outlines: GeoJSON (Multi)Polygons -> rings of [lat, lon, ...] simplified to ~150 m.
function areaRings(geom) {
  const polys = geom?.type === "MultiPolygon" ? geom.coordinates : geom?.type === "Polygon" ? [geom.coordinates] : [];
  return polys.map((poly) => flat(poly[0].map(([x, y]) => ({ lat: y, lon: x })), 150)).filter((r) => r.length >= 8);
}
const touches = (rings) => rings.some((r) => { for (let i = 0; i < r.length; i += 2) if (REGIONS.some((b) => r[i] >= b[0] && r[i] <= b[2] && r[i + 1] >= b[1] && r[i + 1] <= b[3])) return true; return false; });
const boxRing = ([w, s, e, n]) => [s, w, s, e, n, e, n, w, s, w].map(round);

async function buildAvalanche() {
  log("Avalanche Canada forecasts");
  const products = [];
  try {
    const all = await getJson(`${AVCAN}/forecasts/en/products`);
    const list = Array.isArray(all) ? all : all.products || all.data || [];
    log(`  ${list.length} products; first keys: ${Object.keys(list[0] || {}).join(", ")}; report keys: ${Object.keys(list[0]?.report || {}).join(", ")}`);
    products.push(...list);
  } catch (e) { log(`  products list failed: ${e.message}`); }
  // Also ask by point (one per riding zone), which works even if the list format changes.
  for (const z of ZONES) {
    const lat = ((z.box[0] + z.box[2]) / 2).toFixed(3), lon = ((z.box[1] + z.box[3]) / 2).toFixed(3);
    try {
      const p = await getJson(`${AVCAN}/forecasts/en/products/point?lat=${lat}&long=${lon}`);
      if (p && (p.report || p.id)) { products.push(Object.assign(p, { _point: true })); log(`  ${z.name}: ${text(p.report?.title).slice(0, 80) || p.area?.id} (${val(p.type)})`); }
      else log(`  ${z.name}: nothing (${JSON.stringify(p).slice(0, 200)})`);
    } catch (e) { log(`  ${z.name}: point forecast failed (${e.message})`); }
  }
  const sample = products.find((p) => p._point && p.report) || products[0];
  if (sample) log(`  sample (${text(sample.report?.title).slice(0, 80)}): dangerRatings[0] ${JSON.stringify(sample.report?.dangerRatings?.[0] || null).slice(0, 900)}; problems[0] ${JSON.stringify(sample.report?.problems?.[0] || null).slice(0, 900)}; message ${JSON.stringify(sample.report?.message || "").slice(0, 300)}`);

  let areas = [];
  try {
    const fc = await getJson(`${AVCAN}/forecasts/en/areas`);
    const feats = fc.features || [];
    log(`  ${feats.length} forecast areas; first: id ${feats[0]?.id}, properties ${JSON.stringify(feats[0]?.properties || {}).slice(0, 300)}`);
    areas = feats.map((f) => ({ id: String(f.id ?? f.properties?.id ?? ""), name: text(f.properties?.name), rings: areaRings(f.geometry) })).filter((a) => a.rings.length && touches(a.rings));
  } catch (e) { log(`  areas failed: ${e.message}`); }

  // Join forecasts to the area outlines (by area id), keeping only areas that touch the region.
  const byArea = new Map();
  for (const p of products) {
    if (!p || !(p.report || p.dangerRatings)) continue;
    const t = val(p.type).toLowerCase();
    if (t && !/forecast/.test(t)) continue;   // skip special public avalanche warnings etc. as areas
    const aid = String(p.area?.id ?? "");
    if (!byArea.has(aid)) byArea.set(aid, { p, aid });
  }
  const out = [];
  for (const a of areas) {
    const hit = byArea.get(a.id);
    out.push({ id: a.id, name: areaName(a.name) || areaName(hit?.p.area?.name) || shortTitle(text(hit?.p.report?.title)), rings: a.rings, forecast: hit ? normalizeForecast(hit.p) : null });
    if (hit) byArea.delete(a.id);
  }
  // Forecasts whose outline we didn't get: use their bounding box, if they are in the region.
  for (const { p, aid } of byArea.values()) {
    const bb = p.area?.bbox;
    const rings = Array.isArray(bb) && bb.length === 4 ? [boxRing(bb)] : [];
    if (rings.length && !touches(rings)) continue;
    if (!rings.length && !p._point) continue;
    out.push({ id: aid, name: areaName(p.area?.name) || shortTitle(text(p.report?.title)), rings, forecast: normalizeForecast(p) });
  }
  for (let i = out.length - 1; i >= 0; i--) if (!out[i].rings.length && !out[i].forecast?.days.length) out.splice(i, 1);   // nothing to draw
  const withForecast = out.filter((a) => a.forecast && a.forecast.days.length);
  log(`  ${out.length} areas in the region, ${withForecast.length} with a forecast:`);
  out.forEach((a) => log(`    ${a.name || a.id}: ${a.rings.length} outline(s); ${a.forecast ? `${a.forecast.days.length} days ${JSON.stringify(a.forecast.days)}, ${a.forecast.problems.length} problems ${JSON.stringify(a.forecast.problems.map((p) => [p.type, p.aspects.join(""), p.elevations.join("")]))}` : "no forecast"}`));
  return { areas: out, products: products.length };
}

// ---------- snowmobile club grooming reports ----------
const htmlText = (h) => h
  .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<(br|\/p|\/li|\/h\d|\/tr|\/div|\/td)\b[^>]*>/gi, "\n").replace(/<li\b[^>]*>/gi, "\n• ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#0?39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
  .replace(/&ndash;|&mdash;/g, "-").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/[ \t\r\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_RE = new RegExp(`\\b(?:(?:${MONTHS})\\.? \\d{1,2}(?:st|nd|rd|th)?,? \\d{4}|\\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS}),? \\d{4}|\\d{4}-\\d{2}-\\d{2}|(?:${MONTHS})\\.? \\d{1,2}(?:st|nd|rd|th)?)\\b`, "i");
// The report part of a page: from the club's "start" words (or the first mention of grooming) to its "end" words.
function reportPart(text, r) {
  let i = -1;
  if (r.start) { const m = new RegExp(r.start, "i").exec(text); if (m) i = m.index; }
  if (i < 0) { const m = /groom|trail (conditions|report)|snow report/i.exec(text); if (m) i = Math.max(0, text.lastIndexOf("\n", m.index)); }
  if (i < 0) return "";
  let part = text.slice(i);
  if (r.end) { const m = new RegExp(r.end, "i").exec(part.slice(20)); if (m) part = part.slice(0, m.index + 20); }
  return part.slice(0, r.max || 1500).trim();
}
// robots.txt: is this path allowed for every robot ("User-agent: *")?
const robotsCache = new Map();
async function robotsOk(url) {
  const u = new URL(url);
  if (!robotsCache.has(u.origin)) {
    let rules = [];
    try {
      const res = await fetch(u.origin + "/robots.txt", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        let mine = false;
        for (const line of (await res.text()).split(/\r?\n/)) {
          const [k, ...v] = line.replace(/#.*/, "").split(":"), val = v.join(":").trim();
          if (/^user-agent$/i.test(k.trim())) mine = val === "*";
          else if (mine && /^(dis)?allow$/i.test(k.trim()) && val) rules.push({ allow: /^allow$/i.test(k.trim()), path: val });
        }
      }
    } catch {}
    robotsCache.set(u.origin, rules);
  }
  const path = u.pathname + u.search;
  const hit = robotsCache.get(u.origin).filter((r) => path.startsWith(r.path.replace(/\*$/, ""))).sort((a, b) => b.path.length - a.path.length)[0];
  return !hit || hit.allow;
}
// Test runs (PROBE=1): what's on a club's pages, to find a report the job could read.
async function probe(url) {
  try {
    const ok = await robotsOk(url);
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
    const body = await res.text();
    const hits = [...body.matchAll(/groom|trail (?:conditions|report)|last updated/gi)].slice(0, 4).map((m) => JSON.stringify(body.slice(Math.max(0, m.index - 100), m.index + 160).replace(/\s+/g, " ")));
    const links = [...new Set([...body.matchAll(/href="([^"#]+)"[^>]*>([^<]{0,60})</gi)].filter((m) => /groom|map|trail|condition|report/i.test(m[1] + m[2])).map((m) => `${m[2].trim()} -> ${m[1]}`))].slice(0, 15);
    log(`    probe ${url}: links ${JSON.stringify(links)}`);
    log(`    probe ${url}: HTTP ${res.status}, ${body.length} bytes, robots ${ok ? "ok" : "DISALLOWED"}, ${hits.length ? "mentions: " + hits.join(" | ") : "no grooming mentions"}; text: ${JSON.stringify(htmlText(body).slice(0, 600))}`);
  } catch (e) { log(`    probe ${url}: ${e.message}`); }
}
async function buildGrooming() {
  const list = readJson("snowmobile-clubs.json")?.clubs || [];
  const old = readJson("grooming.json")?.reports || {};
  log(`Snowmobile club grooming reports (${list.length} clubs)`);
  const reports = {};
  for (const c of list) {
    const r = c.report || {};
    if (!r.auto || !r.url) {
      log(`  ${c.name}: not read automatically (${r.url || "no report link"})`);
      if (process.env.PROBE) for (const u of c.check || []) await probe(u);
      continue;
    }
    const prev = old[c.id] || {};
    if (process.env.PROBE) for (const u of [r.url, ...(c.check || [])].filter(Boolean)) await probe(u);
    try {
      if (!(await robotsOk(r.url))) throw new Error("the page's robots.txt asks robots not to read it");
      const res = await fetch(r.url, { headers: { "User-Agent": UA, Accept: "text/html,application/json,*/*" }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      const part = reportPart(htmlText(body), r);
      if (!part) throw new Error(`no grooming report found on the page (${body.length} bytes)`);
      const date = (part.match(DATE_RE) || [])[0] || "";
      reports[c.id] = { url: r.url, fetchedAt: builtAt, text: part, date, changedAt: prev.text === part ? prev.changedAt || builtAt : builtAt };
      log(`  ${c.name}: ${part.length} characters${date ? `, dated ${date}` : ""}: ${JSON.stringify(part.slice(0, 200))}`);
    } catch (e) {
      log(`  ${c.name}: ${e.message}${prev.text ? "; keeping the last report" : ""}`);
      if (prev.text) reports[c.id] = { ...prev, error: e.message.slice(0, 200) };
    }
    await sleep(1500);
  }
  return reports;
}

// ---------- Mountain Information Network (Avalanche Canada) ----------
// Riders' own reports of avalanches, snowpack and conditions, public on avalanche.ca. The last 14 days in the region,
// so a ski route's details can list the avalanche activity reported near it. The API isn't documented in detail,
// so the fields are read loosely and the first report's shape is logged.
const MIN_APIS = process.env.MIN_API ? [process.env.MIN_API] : ["https://avcan-services-api.prod.avalanche.ca", AVCAN];
const MIN_DAYS = 14;
const num = (v) => (v == null || v === "" ? NaN : +v);
function minLatLon(s) {
  const l = s.latlng || s.location || s.lnglat || s.geometry || s.point || {};
  if (Array.isArray(s.latlng) && s.latlng.length >= 2) return [num(s.latlng[0]), num(s.latlng[1])];
  if (Array.isArray(s.lnglat) && s.lnglat.length >= 2) return [num(s.lnglat[1]), num(s.lnglat[0])];
  if (Array.isArray(l.coordinates)) return [num(l.coordinates[1]), num(l.coordinates[0])];
  const lat = num(l.latitude ?? l.lat ?? s.latitude ?? s.lat), lon = num(l.longitude ?? l.lng ?? l.lon ?? s.longitude ?? s.lng ?? s.lon);
  return [lat, lon];
}
// Each report's observations, as { type: object } (old API: obs: [{ obtype, ob }]; newer: observations: { quick: {...}, ... }).
function minObs(s) {
  const out = {};
  if (Array.isArray(s.obs)) for (const o of s.obs) out[String(o.obtype || o.type || "").toLowerCase()] = o.ob || o;
  const o = s.observations || s.obs;
  if (o && !Array.isArray(o) && typeof o === "object") for (const [k, v] of Object.entries(o)) if (v) out[k.toLowerCase()] = v;
  for (const t of s.obtypes || s.types || []) if (!out[String(t).toLowerCase()]) out[String(t).toLowerCase()] = {};
  return out;
}
// The free-text comments anywhere in a report's observations.
const flatText = (o, depth = 0) => (!o || typeof o !== "object" || depth > 3 ? []
  : Object.entries(o).flatMap(([k, v]) => (typeof v === "string" && /comment|description|narrative|summary/i.test(k) ? [v] : flatText(v, depth + 1))));
function minAvalanche(obs) {
  const a = obs.avalanche, q = obs.quick || {};
  // The submissions list gives only how many of each kind of observation a report has ({ avalanche: 1, quick: 1 }).
  if (typeof a === "number" || typeof obs.incident === "number") {
    if (obs.incident > 0) return { seen: true, what: "avalanche incident" };
    return a > 0 ? { seen: true, what: "avalanche observation" } : null;
  }
  if (a && Object.keys(a).length) {
    const n = val(a.avalancheNumber || a.number), size = val(a.avalancheSize || a.size);
    return { seen: true, what: [n, n === "1" ? "avalanche" : "avalanches", size && `size ${size}`].filter(Boolean).join(" "),
      trigger: val(a.triggerType || a.trigger), aspect: [].concat(a.startZoneAspect || a.aspect || []).map(val).join(" ") };
  }
  if (obs.incident && Object.keys(obs.incident).length) return { seen: true, what: "avalanche incident" };
  const ac = q.avalancheConditions || {};
  const signs = [ac.slab && "recent slab avalanches", ac.sound && "whumpfing or shooting cracks", ac.snow && "30 cm or more of new snow or wind loading", ac.temp && "rapid warming"].filter(Boolean);
  return signs.length ? { seen: !!ac.slab, what: ac.slab ? "recent slab avalanches seen" : "", signs } : null;
}
// The list of reports: the answer itself, or the first array of objects inside it (items, items.data, results...).
function findList(json, depth = 0) {
  if (Array.isArray(json)) return json.length === 0 || typeof json[0] === "object" ? json : null;
  if (!json || typeof json !== "object" || depth > 2) return null;
  for (const k of ["items", "submissions", "data", "results", "features"]) { const l = findList(json[k], depth + 1); if (l) return l; }
  for (const v of Object.values(json)) { const l = findList(v, depth + 1); if (l && l.length) return l; }
  return null;
}
async function buildMin() {
  log("Mountain Information Network reports");
  const to = new Date(), from = new Date(to - MIN_DAYS * 86400e3), d = (x) => x.toISOString().slice(0, 10);
  let list = null, lastErr;
  for (const base of MIN_APIS) {
    for (const path of [`/min/en/submissions?fromdate=${d(from)}&todate=${d(to)}&pagesize=2000`, `/min/en/submissions?fromdate=${d(from)}&todate=${d(to)}`]) {
      try {
        const json = await getJson(base + path);
        list = findList(json);
        if (list) { log(`  ${base}${path}: ${list.length} reports; first: ${JSON.stringify(list[0] || null).slice(0, 1500)}`); break; }
        log(`  ${base}${path}: no list of reports in the answer; keys ${JSON.stringify(Object.keys(json || {}))}: ${JSON.stringify(json).slice(0, 600)}`);
      } catch (e) { lastErr = e; }
    }
    if (list) break;
  }
  if (!list) throw lastErr || new Error("no answer");
  const out = [];
  for (const s of list) {
    const [lat, lon] = minLatLon(s);
    if (!isFinite(lat) || !isFinite(lon) || !REGIONS.some((b) => lat >= b[0] - 0.2 && lat <= b[2] + 0.2 && lon >= b[1] - 0.3 && lon <= b[3] + 0.3)) continue;
    const obs = minObs(s), id = String(s.subid || s.id || s.submissionId || "");
    const comments = [...new Set(flatText(obs).map((t) => text(t)).filter(Boolean))].join(" ").slice(0, 400);
    out.push({
      id, lat: round(lat), lon: round(lon), date: val(s.datetime || s.dateTime || s.date || s.observationDate || s.createdAt || ""),
      title: text(s.title || s.locationName || s.location?.name || "").slice(0, 120), types: Object.keys(obs).filter(Boolean),
      av: minAvalanche(obs), text: comments,
    });
  }
  out.sort((a, b) => (b.date > a.date ? 1 : -1));
  log(`  ${out.length} reports in the region, ${out.filter((r) => r.av?.seen).length} with avalanches seen`);
  return out;
}

// ---------- write ----------
if (!existsSync(DATA)) mkdirSync(DATA);
const builtAt = new Date().toISOString().slice(0, 19) + "Z";
let failed = 0;

if (runs("ski")) {
  const old = readJson("ski.json") || {};
  let osm = null, bc = null, c2c = null;
  try { osm = await buildOsm(); } catch (e) { failed++; log(`  OpenStreetMap failed: ${e.message}; keeping the last data`); }
  try { bc = await buildBc(); } catch (e) { failed++; log(`  DataBC failed: ${e.message}; keeping the last data`); }
  try { c2c = await buildC2c(); } catch (e) { failed++; log(`  camptocamp failed: ${e.message}; keeping the last data`); }
  const oldOf = (src) => (old.routes || []).filter((r) => r.src === src);
  const routes = [...(osm ? osm.routes : oldOf("osm")), ...(bc || oldOf("bc")), ...(c2c ? c2c.routes : oldOf("c2c"))];
  const starts = c2c ? c2c.starts : old.starts || [];
  const huts = osm ? osm.huts : old.huts || [];
  // Peaks come from Overpass too: when it just failed for the routes, don't spend the run's time limit on it again.
  let peaksOk = false;
  if (osm) try { nameNearPeaks(routes, await buildPeaks()); peaksOk = true; } catch (e) { log(`  Peaks failed: ${e.message}`); }
  if (!peaksOk) {
    log("  unnamed routes keep their last peak name");
    const was = new Map((old.routes || []).filter((r) => r.near).map((r) => [r.id, r.near]));
    for (const r of routes) if (!r.name && !r.near && was.has(r.id)) r.near = was.get(r.id);
  }
  if (routes.length || huts.length) {
    writeFileSync(new URL("ski.json", DATA), JSON.stringify({
      builtAt: osm || bc || c2c ? builtAt : old.builtAt, regions: REGIONS,
      sources: { osm: osm ? builtAt : old.sources?.osm || "", bc: bc ? builtAt : old.sources?.bc || "", c2c: c2c ? builtAt : old.sources?.c2c || "" },
      routes, huts, starts,
    }));
    log(`data/ski.json: ${routes.length} routes, ${huts.length} huts`);
  }
}

if (runs("avy")) {
  try {
    const { areas, products } = await buildAvalanche();
    const old = readJson("avalanche.json");
    // Nothing back at all (API down): keep the last file rather than saying there's no forecast.
    if (!areas.length && !products && old) throw new Error("no answer from Avalanche Canada");
    writeFileSync(new URL("avalanche.json", DATA), JSON.stringify({
      builtAt, source: "Avalanche Canada (avalanche.ca)",
      season: areas.some((a) => a.forecast && a.forecast.days.length) ? "on" : "off",
      areas: areas.length ? areas : old?.areas?.map((a) => ({ ...a, forecast: null })) || [],
    }));
    log(`data/avalanche.json written`);
  } catch (e) { failed++; log(`Avalanche forecast failed: ${e.message}; keeping the last data`); }
}
if (runs("avy")) {
  try {
    const reports = await buildMin();
    writeFileSync(new URL("avalanche-reports.json", DATA), JSON.stringify({ builtAt, days: MIN_DAYS, source: "Avalanche Canada Mountain Information Network", reports }));
    log(`data/avalanche-reports.json: ${reports.length} reports`);
  } catch (e) { failed++; log(`Mountain Information Network failed: ${e.message}; keeping the last data`); }
}
if (runs("groom")) {
  try {
    const reports = await buildGrooming();
    writeFileSync(new URL("grooming.json", DATA), JSON.stringify({ builtAt, reports }, null, 1));
    log(`data/grooming.json: ${Object.keys(reports).length} reports`);
  } catch (e) { failed++; log(`Grooming reports failed: ${e.message}; keeping the last data`); }
}
if (failed && process.env.STRICT) process.exit(1);
