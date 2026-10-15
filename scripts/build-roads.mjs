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
// Also writes data/fires.json (BC Wildfire Service current fires and perimeters), and per zone cut blocks (Forest
// Tenure cut block polygons) and Motor Vehicle Prohibition Regulation closure areas.
//
// Run: node scripts/build-roads.mjs   (Node 18 or newer, no packages needed; ONLY=ften, ONLY=osm or ONLY=fires runs one part)

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
// DataBC and BC Wildfire only cover BC: the zones in ALBERTA_ZONES (index.html) skip them.
const ALBERTA = JSON.parse((html.match(/const ALBERTA_ZONES = (\[[^\]]*\]);/) || [])[1] || "null");
if (!ALBERTA) throw new Error("Couldn't find ALBERTA_ZONES in index.html");
const inBC = (z) => !ALBERTA.includes(z.id);
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
// DataBC layers don't all call their shape column GEOMETRY (some use SHAPE), so ask each layer once.
const geomCols = new Map();
async function geomCol(layer) {
  if (geomCols.has(layer)) return geomCols.get(layer);
  let col = "GEOMETRY";
  try {
    const params = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "DescribeFeatureType", typeName: `pub:${layer}`, outputFormat: "application/json" });
    const res = await fetch(`${WFS}?${params}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
    const text = await res.text();
    if (!res.ok || !text.startsWith("{")) throw new Error(`HTTP ${res.status}: ${wfsError(text)}`);
    const props = (JSON.parse(text).featureTypes || [])[0]?.properties || [];
    const g = props.find((p) => /^gml:/.test(p.type || ""));
    if (g) col = g.name;
    log(`    ${layer}: shape column ${col}; fields ${props.map((p) => p.name).join(", ")}`);
  } catch (e) { log(`    ${layer}: could not describe the layer (${e.message})`); }
  geomCols.set(layer, col);
  return col;
}
// The useful part of a WFS error page is its ExceptionText.
const wfsError = (text) => ((text.match(/<ows:ExceptionText>([\s\S]*?)<\/ows:ExceptionText>/) || [])[1] || text).slice(0, 400).replace(/\s+/g, " ");
async function wfs(box, layer = FTEN_LAYER, where = "") {
  const col = await geomCol(layer);
  const params = new URLSearchParams({
    service: "WFS", version: "2.0.0", request: "GetFeature", typeName: `pub:${layer}`, outputFormat: "application/json",
    srsName: "EPSG:4326", count: String(PAGE), CQL_FILTER: `BBOX(${col}, ${albersBox(box).join(", ")}, 'EPSG:3005')${where ? ` AND (${where})` : ""}`,
  });
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${WFS}?${params}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(180000) });
      const text = await res.text();
      if (!res.ok || !text.startsWith("{")) throw new Error(`HTTP ${res.status}: ${wfsError(text)}`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e; log(`    ${e.message}; trying again`);
      if (/HTTP 400/.test(e.message)) break;   // a bad filter won't get better
      await sleep(10000 * (attempt + 1));
    }
  }
  throw lastErr;
}
const quarters = ([s, w, n, e]) => { const cs = (s + n) / 2, cw = (w + e) / 2; return [[s, w, cs, cw], [s, cw, cs, e], [cs, w, n, cw], [cs, cw, n, e]]; };
// A box with more sections than one page is fetched as 4 smaller boxes, so no paging (and no sort order) is needed.
async function fetchFten(box, layer, where, depth = 0, seen = new Map()) {
  const fc = await wfs(box, layer, where);
  const feats = fc.features || [];
  if ((fc.numberMatched > feats.length || feats.length >= PAGE) && depth < 5) {
    log(`    ${fc.numberMatched || feats.length}+ features, splitting in 4`);
    for (const q of quarters(box)) await fetchFten(q, layer, where, depth + 1, seen);
  } else feats.forEach((f) => seen.set(f.id || JSON.stringify(f.properties), f));
  return seen;
}
// Tries each filter in turn (field names in these layers aren't documented everywhere), logging the fields seen.
async function fetchLayer(box, layer, filters) {
  let lastErr;
  for (const where of filters) {
    try {
      const feats = [...(await fetchFten(box, layer, where)).values()];
      if (feats[0]) log(`    ${layer.split(".")[1]} fields: ${Object.keys(feats[0].properties || {}).join(", ")}`);
      return feats;
    } catch (e) { lastErr = e; log(`    ${layer.split(".")[1]}: filter "${where}" failed`); }
  }
  throw lastErr;
}
// Polygons as rings of [lat, lon, ...], simplified to tol metres; tiny rings dropped.
function polyRings(geom, tol) {
  const polys = geom.type === "MultiPolygon" ? geom.coordinates : geom.type === "Polygon" ? [geom.coordinates] : [];
  return polys.flatMap((poly) => poly.map((ring) => {
    let pts = ring.map(([x, y]) => ({ lat: y, lon: x }));
    if (pts.length && Math.abs(pts[0].lat) > 90) pts = ring.map(([x, y]) => ({ lat: x, lon: y }));
    pts = simplify(pts, tol);
    return pts.length >= 4 ? pts.flatMap((q) => [round(q.lat), round(q.lon)]) : null;
  }).filter(Boolean));
}
const ymd = (v) => (v ? String(v).slice(0, 10) : "");

// Cut blocks: pending, active (recently logged) and retired, from the Forest Tenure cut block layer. Retired blocks
// only from the last 15 years, as older ones have grown back.
const CUT_LAYER = "WHSE_FOREST_TENURE.FTEN_CUT_BLOCK_POLY_SVW";
const OLD = `${new Date().getFullYear() - 15}-01-01`;
async function cutBlocks(box) {
  const feats = await fetchLayer(box, CUT_LAYER, [
    `LIFE_CYCLE_STATUS_CODE IN ('PENDING','ACTIVE') OR DISTURBANCE_END_DATE > '${OLD}'`,
    `LIFE_CYCLE_STATUS_CODE IN ('PENDING','ACTIVE') OR DISTURBANCE_START_DATE > '${OLD}'`,
    `LIFE_CYCLE_STATUS_CODE IN ('PENDING','ACTIVE')`,
    "",
  ]);
  return feats.filter((f) => f.geometry).map((f) => {
    const p = f.properties || {};
    const s = String(p.LIFE_CYCLE_STATUS_CODE || "").toUpperCase();
    const g = polyRings(f.geometry, 12);
    return g.length ? { s, b: p.BLOCK_STATUS_CODE || "", f: [p.FOREST_FILE_ID, p.CUTTING_PERMIT_ID, p.CUT_BLOCK_ID].filter(Boolean).join(" "),
      p: p.CLIENT_NAME || "", d0: ymd(p.DISTURBANCE_START_DATE), d1: ymd(p.DISTURBANCE_END_DATE), g } : null;
  }).filter(Boolean);
}
// Motor Vehicle Prohibition Regulation areas (Wildlife Act motor vehicle closures).
const MV_LAYER = "WHSE_WILDLIFE_MANAGEMENT.WAA_MVPR_AREAS_SP";
async function motorClosures(box) {
  const feats = await fetchLayer(box, MV_LAYER, [""]);
  return feats.filter((f) => f.geometry).map((f) => {
    const p = f.properties || {};
    const txt = (re) => Object.entries(p).filter(([k, v]) => re.test(k) && v && typeof v === "string").map(([, v]) => v.trim().slice(0, 200));
    const g = polyRings(f.geometry, 20);
    return g.length ? { n: txt(/NAME/)[0] || "", d: p.EFFECTIVE_DESCRIPTION || txt(/DESC/)[0] || "", x: txt(/VEHICLE|EXEMPT|PERIOD|DATE|SCHEDULE/).join(" · ").slice(0, 300), g } : null;
  }).filter(Boolean);
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
)->.r;
.r out tags geom qt;
node(w.r)->.rn;
(node.rn["barrier"]; node.rn["ford"="yes"];);
out body qt;
way(bn.rn)["highway"~"^(footway|path|cycleway|bridleway)$"]["bridge"]["bridge"!="no"];
out tags center qt;
nwr["power"="plant"]["plant:source"="hydro"](${bb});
out tags center qt;`;
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
  // A closed ring starts and ends on the same point, which leaves nothing to measure against: split it at its farthest point.
  const [f, l] = [pts[0], pts[pts.length - 1]];
  if (f.lat === l.lat && f.lon === l.lon) {
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
const round = (n) => Math.round(n * 1e5) / 1e5;
const readJson = (name) => { try { return JSON.parse(readFileSync(new URL(name, DATA), "utf8")); } catch { return null; } };
if (!existsSync(DATA)) mkdirSync(DATA);

// ---------- Wildfires outside BC ----------
// - CWFIS (Canadian Wildland Fire Information System, Natural Resources Canada, Open Government Licence - Canada):
//   the fires every agency reports as active today, and the satellite fire area estimates (M3 hotspot polygons) next
//   to them. BC Wildfire Service fires are left out (fires.json has them, in more detail); Parks Canada fires in BC stay.
// - Alberta Wildfire (geospatial.alberta.ca, Open Government Licence - Alberta): Alberta's own active fires and
//   perimeters, and its fire control orders (forest area closures, fire bans, fire restrictions, off-highway vehicle
//   restrictions; fire advisories, the mildest level, are left off).
// - Alberta Emergency Alert: wildfire evacuation orders and alerts that come with a map area.
// Each source is optional: one that fails keeps its part of the last good file.
const CWFIF = "https://geoserver.cwfif.nrcan.gc.ca/geoserver/wfs";
const CWFIS = "https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wfs";
const AB_WILDFIRE = "https://geospatial.alberta.ca/mimas/rest/services/wildfire";
const AEA_FEED = "https://www.emergencyalert.alberta.ca/aeapublic/feed.atom";
async function getText(url, what, tries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${wfsError(text).slice(0, 200)}`);
      return text;
    } catch (e) { lastErr = e; log(`    ${what}: ${e.message}; trying again`); await sleep(5000 * (attempt + 1)); }
  }
  throw lastErr;
}
const getJson = async (url, what) => {
  const j = JSON.parse(await getText(url, what));
  if (j.error) throw new Error(`${what}: ${JSON.stringify(j.error).slice(0, 200)}`);
  return j;
};
const wfsUrl = (base, layer, extra = {}) => `${base}?${new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature",
  typeName: layer, outputFormat: "application/json", srsName: "EPSG:4326", ...extra })}`;
const arcUrl = (layer, extra = {}) => `${AB_WILDFIRE}/${layer}/query?${new URLSearchParams({ where: "1=1", outFields: "*",
  outSR: "4326", geometryPrecision: "5", f: "geojson", ...extra })}`;
const AGENCY = { AB: "Alberta Wildfire", SK: "Saskatchewan Public Safety Agency", MB: "Manitoba Wildfire Service",
  ON: "Ontario Forest Fires", QC: "SOPFEU (Quebec)", NB: "New Brunswick Forest Fire Service", NS: "Nova Scotia Natural Resources",
  PE: "PEI Forests, Fish and Wildlife", NL: "Newfoundland and Labrador Forestry", YT: "Yukon Wildland Fire Management",
  NT: "NWT Forest Management", NU: "Nunavut", PC: "Parks Canada" };
const STAGE = { OC: "Out of Control", BH: "Being Held", UC: "Under Control" };
const CAUSE = { N: "Lightning", H: "Person", U: "", R: "Prescribed" };
const RESPONSE = { MON: "monitored", MOD: "modified response", FUL: "" };
const epochYmd = (v) => (typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : ymd(v));
const near = (a, b, km) => Math.abs(a.lat - b.lat) < km / 111 && Math.abs(a.lon - b.lon) < km / (111 * Math.cos((a.lat * Math.PI) / 180));
// The rough middle of a shape's rings, to match satellite fire areas to reported fires.
const ringsMid = (g) => { let la = 0, lo = 0, n = 0; g.forEach((r) => { for (let i = 0; i < r.length; i += 2) { la += r[i]; lo += r[i + 1]; n++; } }); return { lat: la / n, lon: lo / n }; };
const ringsBox = (g) => { let s = 90, w = 180, n = -90, e = -180; g.forEach((r) => { for (let i = 0; i < r.length; i += 2) { s = Math.min(s, r[i]); n = Math.max(n, r[i]); w = Math.min(w, r[i + 1]); e = Math.max(e, r[i + 1]); } }); return { s, w, n, e }; };

async function canadaFires() {
  const old = readJson("fires-ca.json");
  const keep = (key, src) => ((old && old[key]) || []).filter((x) => x.src === src);
  const part = async (what, fn) => { try { return await fn(); } catch (e) { log(`::warning::${what} failed, keeping its last data (${e.message.slice(0, 200)})`); return null; } };

  // Alberta Wildfire: active fires (their own, mutual aid and municipal) and active perimeters.
  const ab = await part("Alberta Wildfire fires", async () => {
    const pts = [];
    for (const id of [0, 1, 8]) pts.push(...((await getJson(arcUrl(`alberta_fire_status_by_category_group/MapServer/${id}`), `Alberta fires layer ${id}`)).features || []));
    const polys = [];
    for (const id of [4, 5]) polys.push(...((await getJson(arcUrl(`alberta_fire_status_by_category_group/MapServer/${id}`, { maxAllowableOffset: "0.0003" }), `Alberta perimeters layer ${id}`)).features || []));
    if (pts[0]) log(`    Alberta fire fields: ${Object.keys(pts[0].properties || {}).join(", ")}`);
    const fires = pts.filter((f) => f.geometry && f.geometry.type === "Point").map((f) => {
      const p = f.properties || {}, [lon, lat] = f.geometry.coordinates;
      return { src: "ab", ag: "AB", n: p.LABEL || p.FIRE_NUMBER || "", name: p.FIRE_TYPE === "Wildfire" ? "" : p.FIRE_TYPE || "", st: p.FIRE_STATUS || "",
        ha: p.AREA_ESTIMATE ?? null, cause: p.GENERAL_CAUSE || "", d: epochYmd(p.ASSESSMENT_ASSISTANCE_DATE), lat: round(lat), lon: round(lon) };
    });
    const perims = polys.filter((f) => f.geometry).map((f) => {
      const p = f.properties || {}, g = polyRings(f.geometry, 30);
      return g.length ? { src: "ab", n: p.LABEL || p.FIRE_NUMBER || "", st: p.FIRE_STATUS || "", ha: p.AREA_ESTIMATE ?? p.AREA ?? null, g } : null;
    }).filter(Boolean);
    log(`    Alberta Wildfire: ${fires.length} active fires, ${perims.length} perimeters`);
    return { fires, perims };
  });

  // CWFIS: every other agency's active fires, then the satellite fire areas within 10 km of one of them.
  const cw = await part("CWFIS active fires", async () => {
    const fc = await getJson(wfsUrl(CWFIF, "public:cwfif_national_activefires", { CQL_FILTER: "now() >= record_start AND now() <= record_end" }), "CWFIS active fires");
    const skip = new Set(["BC", ...(ab ? ["AB"] : [])]);
    const fires = (fc.features || []).map((f) => f.properties || {}).filter((p) => !skip.has(p.agency_code) && p.latitude && p.longitude && !/^(OUT|EX)$/.test(p.stage_of_control_status || ""))
      .map((p) => ({ src: "cwfis", ag: p.agency_code || "", n: p.agency_fire_id || p.national_fire_id || "", name: "",
        st: [STAGE[p.stage_of_control_status] || p.stage_of_control_status || "", RESPONSE[p.response_type] || ""].filter(Boolean).join(", "),
        ha: p.fire_size >= 0 ? p.fire_size : null, cause: CAUSE[p.national_fire_cause] || "", d: ymd(p.status_date || p.situation_report_date),
        lat: round(p.latitude), lon: round(p.longitude) }));
    const agencies = {};
    fires.forEach((x) => { agencies[x.ag] = (agencies[x.ag] || 0) + 1; });
    log(`    CWFIS: ${(fc.features || []).length} active fires in Canada, ${fires.length} kept (${JSON.stringify(agencies)})`);
    return fires;
  });
  const m3 = await part("CWFIS fire areas", async () => {
    const reported = cw || keep("fires", "cwfis");
    if (!reported.length) return [];
    const fc = await getJson(wfsUrl(CWFIS, "public:m3_polygons_current"), "CWFIS fire areas");
    const perims = (fc.features || []).filter((f) => f.geometry).map((f) => {
      const p = f.properties || {}, g = polyRings(f.geometry, 150);
      if (!g.length) return null;
      const b = ringsBox(g), mid = ringsMid(g);
      const pad = 10 / 111, padLon = pad / Math.cos((mid.lat * Math.PI) / 180);
      if (!reported.some((x) => x.lat > b.s - pad && x.lat < b.n + pad && x.lon > b.w - padLon && x.lon < b.e + padLon)) return null;
      return { src: "m3", n: "", st: "", ha: p.area ? Math.round(p.area) : null, d: ymd(p.lastdate), d0: ymd(p.firstdate), g };
    }).filter(Boolean);
    log(`    CWFIS: ${(fc.features || []).length} satellite fire areas this season, ${perims.length} next to a reported fire`);
    return perims;
  });

  // Alberta fire control orders, most severe first. Fire advisories are left off: they cover most of the prairies.
  const orders = await part("Alberta fire control orders", async () => {
    const fc = await getJson(arcUrl("fire_control_order_data/MapServer/1", { outFields: "name,alert_type,jurisdictions,start_date,description", maxAllowableOffset: "0.001" }), "Alberta fire control orders");
    const ohv = await getJson(arcUrl("fire_control_order_data/MapServer/0", { outFields: "Order_Number,Effective,Website_Name,Website_URL", maxAllowableOffset: "0.001" }), "Alberta OHV restrictions");
    const kindOf = (t) => (/closure/i.test(t) ? "closed" : /ban/i.test(t) ? "ban" : /restriction/i.test(t) ? "frestr" : null);
    const list = (fc.features || []).filter((f) => f.geometry).map((f) => {
      const p = f.properties || {}, kind = kindOf(p.alert_type || "");
      const g = kind ? polyRings(f.geometry, 100) : [];
      return g.length ? { src: "ab", kind, n: (p.name || "").trim(), t: p.alert_type || "", who: (p.jurisdictions || "").trim(),
        d: String(p.description || "").replace(/\s+/g, " ").trim().slice(0, 300), from: epochYmd(p.start_date), g } : null;
    }).filter(Boolean);
    (ohv.features || []).filter((f) => f.geometry).forEach((f) => {
      const p = f.properties || {}, g = polyRings(f.geometry, 100);
      if (g.length) list.push({ src: "ab", kind: "ohv", n: (p.Website_Name || "").trim(), t: "OHV Restriction", who: p.Order_Number || "", d: "", from: epochYmd(p.Effective), url: p.Website_URL || "", g });
    });
    const types = {};
    (fc.features || []).forEach((f) => { const t = (f.properties || {}).alert_type || "?"; types[t] = (types[t] || 0) + 1; });
    log(`    Alberta fire control orders: ${JSON.stringify(types)}, ${(ohv.features || []).length} OHV restrictions; ${list.length} kept`);
    return list;
  });

  // Alberta Emergency Alert: the current alerts feed, keeping wildfire evacuations that have a map area.
  const evac = await part("Alberta Emergency Alert", async () => {
    const feed = await getText(AEA_FEED, "Alberta Emergency Alert feed");
    const entries = [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
    const tag = (x, t) => ((x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\/${t}>`)) || [])[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const out = [];
    for (const e of entries) {
      const text = [tag(e, "title"), tag(e, "summary"), tag(e, "content"), tag(e, "category")].join(" ");
      if (!/fire/i.test(text) || !/evacuat/i.test(text)) continue;
      let polys = [...e.matchAll(/<georss:polygon>([^<]+)<\/georss:polygon>/g)].map((m) => m[1]);
      const link = (e.match(/<link[^>]*href="([^"]+)"/) || [])[1];
      let cap = "";
      if (!polys.length && link) { try { cap = await getText(link.replace(/&amp;/g, "&"), "Alberta Emergency Alert CAP", 2); } catch { /* the alert stays off the map */ } }
      if (!polys.length) polys = [...cap.matchAll(/<polygon>([^<]+)<\/polygon>/g)].map((m) => m[1]);
      // CAP polygons are "lat,lon lat,lon ..."; GeoRSS ones are "lat lon lat lon ...".
      const g = polys.map((s) => {
        const nums = s.trim().split(/[\s,]+/).map(Number).filter((v) => !Number.isNaN(v));
        const pts = []; for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ lat: nums[i], lon: nums[i + 1] });
        const sp = simplify(pts, 25);
        return sp.length >= 4 ? sp.flatMap((q) => [round(q.lat), round(q.lon)]) : null;
      }).filter(Boolean);
      log(`    Alberta Emergency Alert: "${tag(e, "title").slice(0, 120)}" (${g.length} map areas)`);
      if (!g.length) continue;
      const st = tag(e, "title");
      out.push({ src: "ab", kind: /alert|prepare|be ready/i.test(st) && !/order/i.test(st) ? "alert" : "order", st, n: (tag(cap, "areaDesc") || "").slice(0, 200),
        who: tag(cap, "senderName") || "Alberta Emergency Alert", d: ymd(tag(e, "updated")), url: link || "", g });
    }
    log(`    Alberta Emergency Alert: ${entries.length} current alerts, ${out.length} wildfire evacuations with a map area`);
    return out;
  });

  const fires = [...(ab ? ab.fires : keep("fires", "ab")), ...(cw || keep("fires", "cwfis"))];
  const perims = [...(ab ? ab.perims : keep("perims", "ab")), ...(m3 || keep("perims", "m3"))];
  const restr = orders || keep("restr", "ab");
  const ev = evac || keep("evac", "ab");
  writeFileSync(new URL("fires-ca.json", DATA), JSON.stringify({ v: 1, builtAt, fires, perims, restr, evac: ev }));
  log(`Canada wildfires: ${fires.length} fires, ${perims.length} perimeters or fire areas, ${restr.length} Alberta fire orders, ${ev.length} Alberta evacuations`);
}

const started = Date.now(), builtAt = new Date().toISOString().slice(0, 19) + "Z";
let updated = 0, failed = 0;

// Wildfires (BC Wildfire Service, current season): fire points and perimeters for the whole region, in data/fires.json.
// Fires that are out are left out. Run on its own every few hours with ONLY=fires.
if (!ONLY || ONLY === "fires") {
  const all = ZONES.filter(inBC).reduce((b, z) => [Math.min(b[0], z.box[0]), Math.min(b[1], z.box[1]), Math.max(b[2], z.box[2]), Math.max(b[3], z.box[3])], [90, 180, -90, -180]);
  const box = [all[0] - 0.3, all[1] - 0.4, all[2] + 0.3, all[3] + 0.4];
  const notOut = (p) => !/^out$/i.test(String(p.FIRE_STATUS || "").trim());
  try {
    const pts = await fetchLayer(box, "WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_PNTS_SP", [""]);
    const polys = await fetchLayer(box, "WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_POLYS_SP", [""]);
    const fires = pts.filter((f) => f.geometry && f.geometry.type === "Point" && notOut(f.properties || {})).map((f) => {
      const p = f.properties, [x, y] = f.geometry.coordinates, flip = Math.abs(y) > 90;
      return { n: p.FIRE_NUMBER || "", name: p.GEOGRAPHIC_DESCRIPTION || p.INCIDENT_NAME || "", st: p.FIRE_STATUS || "", ha: p.CURRENT_SIZE || null,
        cause: p.FIRE_CAUSE || "", d: ymd(p.IGNITION_DATE), lat: round(flip ? x : y), lon: round(flip ? y : x) };
    });
    const perims = polys.filter((f) => f.geometry && notOut(f.properties || {})).map((f) => {
      const p = f.properties, g = polyRings(f.geometry, 30);
      return g.length ? { n: p.FIRE_NUMBER || "", st: p.FIRE_STATUS || "", ha: p.FIRE_SIZE_HECTARES || p.CURRENT_SIZE || null, g } : null;
    }).filter(Boolean);
    // Areas closed because of fire: BC Wildfire Service area restriction orders, and evacuation orders and alerts
    // (Emergency Management BC). Each is optional: a missing layer only leaves its list empty.
    const text = (p, re) => Object.entries(p).filter(([k, v]) => re.test(k) && v && typeof v === "string").map(([, v]) => v.trim().slice(0, 300));
    const areaList = async (layer, tol) => {
      try {
        const feats = await fetchLayer(box, layer, [""]);
        const list = feats.filter((f) => f.geometry).map((f) => ({ p: f.properties || {}, g: polyRings(f.geometry, tol) })).filter((a) => a.g.length);
        const types = [...new Set(feats.map((f) => (f.geometry ? f.geometry.type : "none")))].join("/");
        log(`    ${layer.split(".")[1]}: ${feats.length} found (${types || "-"}), ${list.length} with a usable shape` +
          (feats[0] ? `; first: ${JSON.stringify(feats[0].properties).slice(0, 300)}` : ""));
        return list;
      }
      catch (e) { log(`    ${layer}: ${e.message.slice(0, 120)}`); return null; }
    };
    const restrRaw = await areaList("WHSE_LAND_AND_NATURAL_RESOURCE.PROT_RESTRICTED_AREAS_SP", 25);
    const evacRaw = await areaList("WHSE_HUMAN_CULTURAL_ECONOMIC.EMRG_ORDER_AND_ALERT_AREAS_SP", 25);
    const restr = (restrRaw || []).map(({ p, g }) => ({ n: text(p, /NAME/)[0] || "", d: text(p, /DESC|COMMENT|TYPE/).join(" · ").slice(0, 300),
      from: ymd(p.ACCESS_STATUS_EFFECTIVE_DATE || p.EFFECTIVE_DATE || p.ORDER_EFFECTIVE_DATE), url: text(p, /URL|LINK/)[0] || "", g }));
    // The evacuation layer covers every hazard (floods, landslides...): keep the fire ones.
    const evac = (evacRaw || []).filter(({ p }) => !p.EVENT_TYPE || /fire/i.test(p.EVENT_TYPE)).map(({ p, g }) => {
      const st = text(p, /STATUS|ORDER_ALERT|TYPE/).join(" ");
      return { kind: /order/i.test(st) ? "order" : /alert/i.test(st) ? "alert" : "other", st, n: text(p, /EVENT_NAME|NAME/)[0] || "",
        who: text(p, /AGENCY|ISSUING/)[0] || "", d: ymd(p.DATE_MODIFIED || p.DATE_ISSUED || p.ISSUED_DATE), g };
    }).filter((a) => a.kind !== "other" || a.st);
    writeFileSync(new URL("fires.json", DATA), JSON.stringify({ v: 1, builtAt, fires, perims, restr, evac }));
    log(`Wildfires: ${fires.length} burning or held, ${perims.length} perimeters (of ${pts.length} fires this season in the area), ` +
      `${restrRaw ? restr.length : "?"} area restrictions, ${evacRaw ? evac.length : "?"} evacuation orders or alerts`);
  } catch (e) { failed++; log(`Wildfires failed (${e.message})`); }
  // The rest of Canada, in data/fires-ca.json. It keeps its last good data when its sources fail, without failing the
  // job, so a national outage never holds back the BC fires.
  try { await canadaFires(); } catch (e) { log(`::warning::Canada wildfires failed (${e.message})`); }
  if (ONLY === "fires") { if (failed) process.exit(1); process.exit(0); }
}

// With many zones, one run can't always do them all before the job's time limit: zones done longest ago go first,
// and no new zone starts after ROADS_MINUTES (the rest keep their last good data and go first next run).
const MINUTES = +process.env.ROADS_MINUTES || 60;
let skipped = 0;
const lastDone = (z) => { const f = readJson(`roads-${z.id}.json`); return f ? Math.min(Date.parse(f.osmAt) || 0, inBC(z) ? Date.parse(f.ftenAt) || 0 : Infinity) : 0; };
for (const z of [...ZONES].sort((a, b) => lastDone(a) - lastDone(b))) {
  if (Date.now() - started > MINUTES * 60e3) { skipped++; continue; }
  const old = readJson(`roads-${z.id}.json`) || {};
  const file = { v: 1, builtAt, ften: old.ften || [], osm: old.osm || {}, feat: old.feat || [], cut: old.cut || [], mv: old.mv || [], ftenAt: old.ftenAt || null, osmAt: old.osmAt || null };
  let changed = false;
  if (ONLY !== "osm" && inBC(z)) {
    try {
      file.ften = ftenRoads([...(await fetchFten(z.box)).values()], z.box);
      file.ftenAt = builtAt; changed = true;
      const by = {}; file.ften.forEach((r) => { const k = `${r.t || "?"} ${r.s}`; by[k] = (by[k] || 0) + 1; });
      log(`${z.name}: ${file.ften.length} government road sections (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ")})`);
    } catch (e) { failed++; log(`${z.name}: government roads failed (${e.message}), keeping last good data`); }
    try {
      file.cut = await cutBlocks(z.box); changed = true;
      const by = {}; file.cut.forEach((c) => { by[c.s || "?"] = (by[c.s || "?"] || 0) + 1; });
      log(`${z.name}: ${file.cut.length} cut blocks (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ")})`);
    } catch (e) { failed++; log(`${z.name}: cut blocks failed (${e.message}), keeping last good data`); }
    try {
      file.mv = await motorClosures(z.box); changed = true;
      log(`${z.name}: ${file.mv.length} motor vehicle closure areas${file.mv[0] ? ` (e.g. ${file.mv[0].n}: ${file.mv[0].d})` : ""}`);
    } catch (e) { failed++; log(`${z.name}: motor vehicle closures failed (${e.message}), keeping last good data`); }
  }
  if (ONLY !== "ften") {
    try {
      const els = await fetchOsm(z.box);
      file.osm = {};
      els.filter((el) => el.type === "way" && el.geometry && el.geometry.length > 1).forEach((el) => {
        const tags = Object.fromEntries(Object.entries(el.tags || {}).filter(([k]) => KEEP.test(k)));
        file.osm[el.id] = { tags, g: simplify(el.geometry).flatMap((p) => [round(p.lat), round(p.lon)]) };
      });
      // Points along the roads: gates and barriers, fords, footbridges joining a road, hydro power plants.
      file.feat = [];
      els.forEach((el) => {
        const t = el.tags || {}, c = el.type === "node" ? el : el.center;
        if (!c || el.geometry) return;
        const keep = Object.fromEntries(Object.entries(t).filter(([k]) => /^(name|barrier|access|motor_vehicle|locked|ford|bridge|highway|operator|note|description|opening_hours|seasonal|power|plant:output:electricity)$/.test(k)));
        file.feat.push({ id: `${el.type[0]}${el.id}`, lat: round(c.lat), lon: round(c.lon), tags: keep });
      });
      file.osmAt = builtAt; changed = true;
      const kinds = {}; file.feat.forEach((f) => { const k = f.tags.barrier || (f.tags.ford ? "ford" : f.tags.power ? "hydro" : "footbridge"); kinds[k] = (kinds[k] || 0) + 1; });
      log(`${z.name}: ${Object.keys(file.osm).length} OpenStreetMap dirt roads, points: ${JSON.stringify(kinds)}`);
    } catch (e) { failed++; log(`${z.name}: OpenStreetMap roads failed (${e.message}), keeping last good data`); }
  }
  if (changed) { writeFileSync(new URL(`roads-${z.id}.json`, DATA), JSON.stringify(file)); updated++; }
}
log(`Done in ${Math.round((Date.now() - started) / 60e3)} min: ${updated} zones updated, ${failed} source failures${skipped ? `, ${skipped} zones left for next time` : ""}.`);
if (failed && !updated) process.exit(1);
