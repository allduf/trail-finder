// Winter data job (see .github/workflows/winter-data.yml), for the site's "Winter" mode.
//
// Writes two files:
//  - data/ski.json: backcountry ski routes and huts in the whole region, from every open source found:
//      - osm: OpenStreetMap ski routes (piste:type=skitour, nordic, hike = snowshoe, downhill runs, sled/snowmobile),
//        ski route relations (route=ski / route=piste), ways tagged ski=yes, and alpine / wilderness huts.
//      - bc: BC government Recreation Sites and Trails (DataBC layer WHSE_FOREST_TENURE.FTEN_RECREATION_LINES_SVW,
//        Open Government Licence - British Columbia) whose name or description says ski, snowshoe or nordic.
//  - data/avalanche.json: Avalanche Canada's current avalanche forecasts for the forecast areas that touch the
//    region (Sea to Sky, South Coast, South Coast Inland...), with the area outlines, danger ratings by elevation
//    band for each day and the avalanche problems (aspects, elevations, likelihood, size). From the public
//    Avalanche Canada API (no key). Out of season there are no forecasts and the file says so.
// A source that fails keeps its last good data.
//
// Run: node scripts/build-winter.mjs   (Node 18 or newer, no packages; ONLY=ski or ONLY=avy runs one part)

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
// The whole region, a little wider: the ski terrain goes further up the valleys than the riding areas.
const REGION = [Math.min(...ZONES.map((z) => z.box[0])) - 0.05, Math.min(...ZONES.map((z) => z.box[1])) - 0.1,
  Math.max(...ZONES.map((z) => z.box[2])) + 0.05, Math.max(...ZONES.map((z) => z.box[3])) + 0.1].map((v) => +v.toFixed(2));
const ONLY = process.env.ONLY || "";
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
function skiType(t) {
  const pt = String(t["piste:type"] || "").split(";")[0];
  const groom = t["piste:grooming"] || "";
  if (pt === "skitour" || (pt === "downhill" && /backcountry|no/.test(groom)) || (t.route === "ski" && !pt)) return "tour";
  if (pt === "nordic") return "nordic";
  if (pt === "hike") return "snowshoe";
  if (pt === "downhill") return "resort";
  if (pt === "sled" || pt === "snowmobile" || t.snowmobile === "designated") return "sled";
  if (pt) return "other";
  if (t["ski:nordic"]) return "nordic";
  if (t.ski) return "access";
  return "";
}
const OSM_KEEP = ["name", "ref", "piste:name", "piste:difficulty", "piste:grooming", "piste:type", "description", "note", "website", "operator", "access", "ski", "ele", "fee", "capacity", "reservation", "url", "seasonal", "opening_hours"];
const keepTags = (t) => Object.fromEntries(OSM_KEEP.filter((k) => t[k]).map((k) => [k, String(t[k]).slice(0, 300)]));

async function buildOsm() {
  log(`OpenStreetMap ski routes and huts in ${REGION.join(",")}`);
  const els = await fetchOsm(REGION);
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
  log(`  routes: ${routes.length} (tour ${count("tour")}, nordic ${count("nordic")}, snowshoe ${count("snowshoe")}, resort ${count("resort")}, sled ${count("sled")}, access ${count("access")}, other ${count("other")}); huts: ${huts.length}`);
  return { routes, huts };
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
const WINTER_WORDS = /\b(ski|skiing|skis|nordic|x-?c|cross[- ]country|snowshoe\w*|snow ?shoe\w*|backcountry|touring|winter)\b/i;
async function buildBc() {
  const REC = "WHSE_FOREST_TENURE.FTEN_RECREATION_LINES_SVW";
  log(`BC Recreation Sites and Trails (${REC})`);
  const d = await describe(REC);
  log(`  fields: ${d.fields.join(", ")}`);
  const feats = [...(await wfsAll(REC, REGION, d.geom)).values()];
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
    const type = /nordic|x-?c|cross[- ]country/i.test(text) ? "nordic" : /snowshoe|snow ?shoe/i.test(text) && !/\bski/i.test(text) ? "snowshoe" : "tour";
    routes.push({ id: "bc" + (p.FOREST_FILE_ID || f.id), src: "bc", type, name, diff: "", g,
      tags: Object.fromEntries(Object.entries(p).filter(([k, v]) => v != null && v !== "" && typeof v !== "object" && !/GEOMETRY|SHAPE|OBJECTID|SE_ANNO/.test(k)).slice(0, 14).map(([k, v]) => [k, String(v).slice(0, 300)])) });
  }
  log(`  ${routes.length} winter recreation trails kept`);
  return routes;
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
const touches = (rings) => rings.some((r) => { for (let i = 0; i < r.length; i += 2) if (r[i] >= REGION[0] && r[i] <= REGION[2] && r[i + 1] >= REGION[1] && r[i + 1] <= REGION[3]) return true; return false; });
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

// ---------- write ----------
if (!existsSync(DATA)) mkdirSync(DATA);
const builtAt = new Date().toISOString().slice(0, 19) + "Z";
let failed = 0;

if (!ONLY || ONLY === "ski") {
  const old = readJson("ski.json") || {};
  let osm = null, bc = null;
  try { osm = await buildOsm(); } catch (e) { failed++; log(`  OpenStreetMap failed: ${e.message}; keeping the last data`); }
  try { bc = await buildBc(); } catch (e) { failed++; log(`  DataBC failed: ${e.message}; keeping the last data`); }
  const oldOf = (src) => (old.routes || []).filter((r) => r.src === src);
  const routes = [...(osm ? osm.routes : oldOf("osm")), ...(bc || oldOf("bc"))];
  const huts = osm ? osm.huts : old.huts || [];
  if (routes.length || huts.length) {
    writeFileSync(new URL("ski.json", DATA), JSON.stringify({
      builtAt: osm || bc ? builtAt : old.builtAt, region: REGION,
      sources: { osm: osm ? builtAt : old.sources?.osm || "", bc: bc ? builtAt : old.sources?.bc || "" },
      routes, huts,
    }));
    log(`data/ski.json: ${routes.length} routes, ${huts.length} huts`);
  }
}

if (!ONLY || ONLY === "avy") {
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
if (failed && process.env.STRICT) process.exit(1);
