// Monthly job (see .github/workflows/hunting-data.yml): the map layers for Hunting, the third sport in the sport menu.
//
// Writes these files in data/hunting/, all from free official open data:
//  - zones.json: every Wildlife Management Unit in BC (DataBC WHSE_WILDLIFE_MANAGEMENT.WAA_WILDLIFE_MGMT_UNITS_SVW,
//    with its game management zone and region) and in Alberta (Alberta Environment and Protected Areas,
//    boundaries/fishwild_wildlife_mgmt_unit_public), each with a label point.
//  - leh.json: BC Limited Entry Hunting zones for this year (WAA_LTD_HNT_ZONE_CURR_YEAR_SVW): the hunts that need an LEH draw.
//  - areas.json: places with their own hunting rules: BC parks, protected areas, conservancies and ecological reserves
//    (WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW), BC wildlife management areas (TA_WILDLIFE_MGMT_AREAS_SVW), national parks
//    (CLAB_NATIONAL_PARKS), First Nation reserves (CLAB_INDIAN_RESERVES), BC towns and cities (ABMS_MUNICIPALITIES_SP,
//    where shooting is usually banned by bylaw), motor vehicle closures (WAA_MVPR_AREAS_SP), Alberta parks and
//    protected areas (environment/parks_and_protected_areas_of_alberta_10tm_nad83_aep), Alberta First Nation reserves
//    (federal CLSS Aboriginal Lands) and Metis settlements, and Alberta's Green Area (public forest land).
//  - seasons-bc.json: BC open seasons per management unit, read from the regulations synopsis PDFs (below).
//  - seasons-ab.json: Alberta seasons per WMU (big game, cougar, black bear, game birds) from the Alberta Guide to Hunting
//    Regulations PDFs on albertaregulations.ca.
//  - draws.json: BC limited entry hunts per unit with last year's first-choice odds (LEH synopsis PDF) and Alberta's
//    special licence draw results per hunt (quota, applicants, priority needed; AlbertaRELM draw summaries).
//  - harvest.json: hunters, days and animals taken per BC unit over the last 5 years (Big Game Harvest Statistics) and
//    Alberta's estimated resident harvest and hunter success per WMU (Hunter harvest reports on open.alberta.ca).
//  areas.json also has Alberta's cities, towns and villages and military land (recaccess_military).
// DataBC: Open Government Licence - British Columbia. Alberta: Open Government Licence - Alberta. CLSS: Open Government
// Licence - Canada. A source that fails keeps its last good data.
//
// Run: node scripts/build-hunting.mjs   (Node 18 or newer, no packages needed; pdftotext from poppler-utils for the
// season tables; ONLY=seasons skips the map layers, ONLY=draws also skips the BC season tables)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const OUT = new URL("../data/hunting/", import.meta.url);
const UA = "trail-finder hunting data (https://github.com/allduf/trail-finder)";
const WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs";
const AB = "https://geospatial.alberta.ca";
const CLSS = "https://proxyinternet.nrcan-rncan.gc.ca/arcgis/rest/services/CLSS-SATC/CLSS_Administrative_Boundaries/MapServer/0";
const AB_BOX = [48.99, -120.01, 60.01, -109.99];   // s, w, n, e
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
// Rings are written as whole numbers (degrees x 10,000), each point after the first as the change from the one before:
// about a third of the size of plain coordinates. hunting.js decodes them.
const encode = (g) => g.map((r) => { const out = []; let pa = 0, po = 0; for (let i = 0; i < r.length; i += 2) { const a = Math.round(r[i] * 1e4), o = Math.round(r[i + 1] * 1e4); out.push(a - pa, o - po); pa = a; po = o; } return out; });
const decode = (g) => g.map((r) => { const out = []; let a = 0, o = 0; for (let i = 0; i < r.length; i += 2) { a += r[i]; o += r[i + 1]; out.push(a / 1e4, o / 1e4); } return out; });
const readOld = (name) => {
  try { const j = JSON.parse(readFileSync(new URL(name, OUT), "utf8")); for (const f of j.zones || j.areas || []) f.g = decode(f.g); return j; } catch { return null; }
};

async function getJson(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(240000) });
      const text = await res.text();
      if (!res.ok || !text.startsWith("{")) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300).replace(/\s+/g, " ")}`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e; log(`    ${e.message.slice(0, 120)}; trying again`);
      if (/HTTP 400/.test(e.message)) break;   // a bad request won't get better
      await sleep(8000 * (i + 1));
    }
  }
  throw lastErr;
}
// A whole DataBC layer, page by page (props: the fields used, for the log; the geometry column's name varies, so all fields come).
async function databc(layer, props, where = "") {
  const out = [];
  for (let start = 0; ; start += 2000) {
    const p = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: `pub:${layer}`, outputFormat: "application/json",
      srsName: "EPSG:4326", count: "2000", startIndex: String(start), sortBy: "OBJECTID" });
    if (where) p.set("CQL_FILTER", where);
    const fc = await getJson(`${WFS}?${p}`);
    if (start === 0 && fc.features?.[0]) { const miss = props.filter((k) => !(k in fc.features[0].properties)); if (miss.length) log(`    ${layer}: no field ${miss.join(", ")}`); }
    out.push(...(fc.features || []));
    log(`    ${layer.split(".")[1]}: ${out.length} of ${fc.numberMatched ?? "?"}`);
    if (!fc.features || fc.features.length < 2000) break;
  }
  return out;
}
// A whole ArcGIS layer as GeoJSON in WGS84, simplified on the server (offset in degrees).
async function arcgis(layer, fields, where = "1=1", offset = 0.0005, box = null, orderBy = "OBJECTID") {
  const out = [];
  for (let start = 0; ; start += 500) {
    const p = new URLSearchParams({ where, outFields: fields.join(","), outSR: "4326", f: "geojson", resultOffset: String(start), resultRecordCount: "500",
      maxAllowableOffset: String(offset), orderByFields: orderBy });
    if (box) { p.set("geometry", [box[1], box[0], box[3], box[2]].join(",")); p.set("geometryType", "esriGeometryEnvelope"); p.set("inSR", "4326"); p.set("spatialRel", "esriSpatialRelIntersects"); }
    const fc = await getJson(`${layer}/query?${p}`);
    out.push(...(fc.features || []));
    log(`    ${layer.split("/services/")[1]}: ${out.length}`);
    if (!fc.features || fc.features.length < 500) break;
  }
  return out;
}

// ---------- geometry ----------
// Douglas-Peucker on [lon, lat] points, tolerance in degrees of latitude (longitude scaled by cos(lat)).
function simplify(pts, tol) {
  if (pts.length < 5) return pts;
  const k = Math.cos((pts[0][1] * Math.PI) / 180), keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][0] * k, ay = pts[a][1], bx = pts[b][0] * k, by = pts[b][1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] * k, py = pts[i][1];
      let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r4 = (n) => Math.round(n * 1e4) / 1e4;
// Polygons as a list of rings [lat, lon, lat, lon, ...] (outer rings and holes together; drawn and tested even-odd).
function rings(geom, tol, minPts = 4) {
  if (!geom) return [];
  const polys = geom.type === "MultiPolygon" ? geom.coordinates : geom.type === "Polygon" ? [geom.coordinates] : [];
  return polys.flatMap((poly) => poly.map((ring) => {
    const pts = simplify(ring, tol);
    if (pts.length < minPts) return null;
    const flat = [];
    for (const [x, y] of pts) flat.push(r4(y), r4(x));
    return flat;
  }).filter(Boolean));
}
function bbox(g) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const r of g) for (let i = 0; i < r.length; i += 2) { s = Math.min(s, r[i]); n = Math.max(n, r[i]); w = Math.min(w, r[i + 1]); e = Math.max(e, r[i + 1]); }
  return [s, w, n, e].map(r4);
}
function inside(g, lat, lon) {
  let c = false;
  for (const r of g) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if ((r[i] > lat) !== (r[j] > lat) && lon < ((r[j + 1] - r[i + 1]) * (lat - r[i])) / (r[j] - r[i]) + r[i + 1]) c = !c;
  }
  return c;
}
function edgeDist(g, lat, lon) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const r of g) for (let i = 2; i < r.length; i += 2) {
    const ax = r[i - 1] * k, ay = r[i - 2], bx = r[i + 1] * k, by = r[i], px = lon * k, py = lat, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}
// A label point well inside the shape: the grid point furthest from any edge, refined around the best one twice.
function labelPoint(g) {
  let [s, w, n, e] = bbox(g), best = null, bd = -1;
  for (let round = 0; round < 3; round++) {
    const N = 24;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const lat = s + ((n - s) * i) / N, lon = w + ((e - w) * j) / N;
      if (!inside(g, lat, lon)) continue;
      const d = edgeDist(g, lat, lon);
      if (d > bd) { bd = d; best = [lat, lon]; }
    }
    if (!best) break;
    const hs = (n - s) / 8, hw = (e - w) / 8;
    [s, w, n, e] = [best[0] - hs, best[1] - hw, best[0] + hs, best[1] + hw];
  }
  return best ? best.map(r4) : null;
}
const title = (s) => String(s || "").toLowerCase().replace(/(^|[\s\-/(])([a-z])/g, (m, a, b) => a + b.toUpperCase()).trim();
const date = (v) => (v ? (typeof v === "number" ? new Date(v).toISOString() : String(v)).slice(0, 10) : "");

// ---------- the parts ----------
async function bcZones() {
  const f = await databc("WHSE_WILDLIFE_MANAGEMENT.WAA_WILDLIFE_MGMT_UNITS_SVW",
    ["WILDLIFE_MGMT_UNIT_ID", "REGION_RESPONSIBLE_ID", "REGION_RESPONSIBLE_NAME", "GAME_MANAGEMENT_ZONE_ID", "GAME_MANAGEMENT_ZONE_NAME"]);
  return f.map((x) => {
    const p = x.properties, g = rings(x.geometry, 0.0015);
    return g.length ? { p: "bc", id: p.WILDLIFE_MGMT_UNIT_ID, r: p.REGION_RESPONSIBLE_ID, rn: p.REGION_RESPONSIBLE_NAME, z: p.GAME_MANAGEMENT_ZONE_ID,
      zn: p.GAME_MANAGEMENT_ZONE_NAME, b: bbox(g), c: labelPoint(g), g } : null;
  }).filter(Boolean);
}
async function abZones() {
  const f = await arcgis(`${AB}/mimas/rest/services/boundaries/fishwild_wildlife_mgmt_unit_public/FeatureServer/0`, ["WMUNIT_NAME", "WMUNIT_CODE", "OBJECTID"], "1=1", 0.0008);
  return f.map((x) => {
    const p = x.properties, g = rings(x.geometry, 0.0015);
    return g.length ? { p: "ab", id: String(Number(p.WMUNIT_CODE)), n: p.WMUNIT_NAME, b: bbox(g), c: labelPoint(g), g } : null;
  }).filter(Boolean);
}
async function lehZones() {
  const f = await databc("WHSE_WILDLIFE_MANAGEMENT.WAA_LTD_HNT_ZONE_CURR_YEAR_SVW",
    ["LIMITED_ENTRY_HUNTING_ZONE", "MANAGEMENT_UNITS", "LTD_ENTRY_HUNTING_ZONE_TYPE", "LTD_ENTRY_HUNTING_ZONE_LABEL", "LEH_HUNT_AREA_ID"]);
  return f.map((x) => {
    const p = x.properties, g = rings(x.geometry, 0.0015);
    return g.length ? { id: p.LIMITED_ENTRY_HUNTING_ZONE, s: title(p.LTD_ENTRY_HUNTING_ZONE_TYPE), l: p.LTD_ENTRY_HUNTING_ZONE_LABEL || "", mu: p.MANAGEMENT_UNITS || "", b: bbox(g), g } : null;
  }).filter(Boolean);
}
// k: what kind of place, with its hunting rule worked out on the site (hunting.js AREA_KINDS).
async function bcAreas() {
  const out = [];
  const parks = await databc("WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW", ["PROTECTED_LANDS_NAME", "PROTECTED_LANDS_DESIGNATION", "PARK_CLASS", "ORCS_PRIMARY"]);
  for (const x of parks) {
    const p = x.properties, d = String(p.PROTECTED_LANDS_DESIGNATION || "").toUpperCase(), g = rings(x.geometry, 0.0006);
    if (!g.length) continue;
    const k = /ECOLOGICAL/.test(d) ? "eco" : /CONSERVANCY/.test(d) ? "conservancy" : /RECREATION/.test(d) ? "rec" : /PROTECTED/.test(d) ? "protected" : "park";
    out.push({ k, n: title(p.PROTECTED_LANDS_NAME), o: p.ORCS_PRIMARY || "", b: bbox(g), g });
  }
  const wma = await databc("WHSE_TANTALIS.TA_WILDLIFE_MGMT_AREAS_SVW", ["WILDLIFE_MANAGEMENT_AREA_NAME"]).catch((e) => { log(`    WMA: ${e.message}`); return []; });
  for (const x of wma) {
    const p = x.properties, g = rings(x.geometry, 0.0006);
    if (g.length) out.push({ k: "wma", n: title(p.WILDLIFE_MANAGEMENT_AREA_NAME || "Wildlife Management Area"), b: bbox(g), g });
  }
  const np = await databc("WHSE_ADMIN_BOUNDARIES.CLAB_NATIONAL_PARKS", ["ENGLISH_NAME"]);
  for (const x of np) { const g = rings(x.geometry, 0.0006); if (g.length) out.push({ k: "national", n: x.properties.ENGLISH_NAME, b: bbox(g), g }); }
  const ir = await databc("WHSE_ADMIN_BOUNDARIES.CLAB_INDIAN_RESERVES", ["ENGLISH_NAME"]);
  for (const x of ir) { const g = rings(x.geometry, 0.0002); if (g.length) out.push({ k: "reserve", n: title(x.properties.ENGLISH_NAME), b: bbox(g), g }); }
  const town = await databc("WHSE_LEGAL_ADMIN_BOUNDARIES.ABMS_MUNICIPALITIES_SP", ["ADMIN_AREA_ABBREVIATION", "ADMIN_AREA_NAME"]).catch((e) => { log(`    towns: ${e.message}`); return []; });
  for (const x of town) { const g = rings(x.geometry, 0.0006); if (g.length) out.push({ k: "town", n: x.properties.ADMIN_AREA_ABBREVIATION || x.properties.ADMIN_AREA_NAME, b: bbox(g), g }); }
  const mv = await databc("WHSE_WILDLIFE_MANAGEMENT.WAA_MVPR_AREAS_SP", ["REGULATION_GEOGRAPHIC_NAME", "PROHIBITION_TYPE", "EFFECTIVE_DESCRIPTION", "EXEMPTION", "MU_NUMBER", "PDF_NAME"]);
  for (const x of mv) {
    const p = x.properties, g = rings(x.geometry, 0.0006);
    if (g.length) out.push({ k: "mvpr", n: p.REGULATION_GEOGRAPHIC_NAME || "", t: p.PROHIBITION_TYPE || "", d: p.EFFECTIVE_DESCRIPTION || "", x: p.EXEMPTION || "", mu: p.MU_NUMBER || "", b: bbox(g), g });
  }
  return out;
}
const AB_PARK_LAYERS = [[3, "eco"], [7, "rangeland"], [11, "natural"], [15, "national"], [19, "park"], [23, "pra"], [27, "wilderness"], [31, "wildland"], [35, "wildland"]];
async function abAreas() {
  const out = [];
  const base = `${AB}/titan/rest/services/environment/parks_and_protected_areas_of_alberta_10tm_nad83_aep/MapServer`;
  for (const [layer, k] of AB_PARK_LAYERS) {
    const f = await arcgis(`${base}/${layer}`, ["NAME", "TYPE", "OBJECTID"], "1=1", 0.0003);
    for (const x of f) { const g = rings(x.geometry, 0.0006); if (g.length) out.push({ k, n: title(x.properties.NAME), p: "ab", b: bbox(g), g }); }
  }
  // Alberta only (BC reserves come from DataBC)
  const ir = await arcgis(CLSS, ["adminAreaNameEng", "OBJECTID"], "jurisdictionEng='Alberta'", 0.0002, AB_BOX).catch((e) => { log(`    CLSS: ${e.message}`); return []; });
  for (const x of ir) {
    const g = rings(x.geometry, 0.0002);
    if (g.length) out.push({ k: "reserve", n: title(x.properties.adminAreaNameEng || "First Nation reserve"), p: "ab", b: bbox(g), g });
  }
  const met = await arcgis(`${AB}/mimas/rest/services/boundaries/indigenous_land_public/FeatureServer/0`, ["METIS_NAME", "OBJECTID"], "1=1", 0.0003).catch(() => []);
  for (const x of met) { const g = rings(x.geometry, 0.0006); if (g.length) out.push({ k: "metis", n: `${x.properties.METIS_NAME} Metis Settlement`, p: "ab", b: bbox(g), g }); }
  const gw = await arcgis(`${AB}/mimas/rest/services/boundaries/land_green_white_area_public/FeatureServer/0`, ["GWA_NAME", "GWA_CODE", "OBJECTID"], "GWA_CODE='GLC_G'", 0.001).catch(() => []);
  for (const x of gw) { const g = rings(x.geometry, 0.0015); if (g.length) out.push({ k: "green", n: "Alberta Green Area (public forest land)", p: "ab", b: bbox(g), g }); }
  // Cities, towns, villages and summer villages (shooting is banned by bylaw in most of them).
  const muni = `${AB}/titan/rest/services/boundaries/municipal_communities_public/MapServer`;
  for (const [layer, kind] of [[5, "City"], [3, "Town"], [1, "Village"], [2, "Summer village"], [6, "Settlement"], [4, "Urban service area"]]) {
    const f = await arcgis(`${muni}/${layer}`, ["*"], "1=1", 0.0002, AB_BOX).catch((e) => { log(`    ${kind}: ${e.message}`); return []; });
    for (const x of f) {
      const pr = x.properties || {}, name = pr[Object.keys(pr).find((k) => /(^|_)NAME$/.test(k))] || kind;
      const g = rings(x.geometry, 0.0003); if (g.length) out.push({ k: "town", n: title(name), p: "ab", b: bbox(g), g });
    }
  }
  // Military bases and air weapons ranges: closed except for the special CFB hunts in the guide.
  for (const layer of [1, 3]) {
    const f = await arcgis(`${AB}/titan/rest/services/recaccess/recaccess_military/MapServer/${layer}`, ["*"], "1=1", 0.0005).catch((e) => { log(`    military: ${e.message}`); return []; });
    for (const x of f) {
      const pr = x.properties || {}, name = pr[Object.keys(pr).find((k) => /(^|_)NAME$/.test(k))] || "Military land";
      const g = rings(x.geometry, 0.0006); if (g.length) out.push({ k: "military", n: title(name).replace(/\bC\.f\.b\./i, "CFB"), p: "ab", b: bbox(g), g });
    }
  }
  return out;
}

// ---------- BC open seasons per management unit ----------
// Read from the region PDFs of the BC Hunting and Trapping Regulations Synopsis, turned into text by pdftotext
// (poppler-utils): each region's "General Open Seasons" table, one row per species, management units, class and
// dates. Rows with footnote marks are flagged (last item 1), as the site can't show the footnotes.
const SYN = "https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/hunting/regulations/hunting-trapping-synopsis-";
const SYN_REGIONS = [["1", "region-1-vancouver-island"], ["2", "region-2-lower-mainland"], ["3", "region-3-thompson"], ["4", "region-4-kootenay"], ["5", "region-5-cariboo"],
  ["6", "region-6-skeena"], ["7", "region-7a-omineca"], ["7", "region-7b-peace"], ["8", "region-8-okanagan"]];
function parseSeasons(text) {
  const lines = text.split("\n"), out = {};
  const MON = /(Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s*\d{1,2}/;
  const MU = /(\d{1,2})-(\d{1,2})(?:\s*to\s*(?:(\d{1,2})-)?(\d{1,2}))?/g;
  let inTable = false, misses = 0, species = null, qual = "";
  // A species name is mostly capitals ("MULE DEER (Black-tailed)", "GROUSE: SOOTY (Blue), RUFFED"); a qualifier isn't ("Bow Only").
  const isSpecies = (t) => { const u = t.replace(/\([^)]*\)/g, ""); return /^[A-Z&]/.test(t) && (u.match(/[A-Z]/g) || []).length > (u.match(/[a-z]/g) || []).length; };
  for (const raw of lines) {
    if (/SPECIES\s+MANAGEMENT UNIT/.test(raw)) { inTable = true; misses = 0; continue; }
    if (!inTable) continue;
    const cells = [...raw.matchAll(/\S+(?: \S+)*/g)].map((m) => ({ t: m[0], at: m.index }));
    if (!cells.length) continue;
    const muI = cells.findIndex((c) => /\d{1,2}-\d{1,2}/.test(c.t) && !MON.test(c.t) && c.at > 20);
    const dI = cells.findIndex((c) => MON.test(c.t));
    const first = cells[0];
    if (muI < 0 || dI < 0) {
      // a species name on its own line, or the end of a wrapped one ("& SPRUCE")
      if (first.at < 20 && isSpecies(first.t) && /[A-Z]{3}|^&/.test(first.t) && cells.length <= 2) {
        if ((/^&/.test(first.t) || /&$/.test(species?.n || "")) && species) species.n += " " + first.t; else { species = { n: first.t }; qual = ""; }
      }
      if (++misses > 60) inTable = false;
      continue;
    }
    misses = 0;
    if (muI > 0 && first.at < 20) {
      const t = first.t.replace(/\*+/g, "").trim();
      if (isSpecies(t) && /[A-Z]{3}/.test(t)) {
        if (/&$/.test(species?.n || "")) species.n += " " + t;   // "GROUSE: DUSKY (Blue), RUFFED &" / "SPRUCE"
        else { species = { n: t }; qual = ""; }
      }
      else qual = t;   // Bow Only, Youth Only...
    } else if (muI === 0) qual = "";
    if (!species) continue;
    const muCell = cells[muI].t;
    let between = cells.slice(muI + 1, dI).map((c) => c.t).join(" "), note = /[^\d\s,\-to]/.test(muCell.replace(/to/g, "")) || /\*/.test(first.t);
    // footnote marks stuck to the class or dates ("s4 Point Bucks", "HSpike-fork Bulls", "tAug 1")
    if (/^[sHStu\]n]\s?(?=[\dA-Z])/.test(between) && !/^(Spike|Bulls|Bucks|Bearded)/.test(between)) { between = between.replace(/^[sHStu\]n]\s?/, ""); note = true; }
    let dates = cells[dI].t.replace(/\s+/g, " ");
    if (dates.search(MON) > 0) { dates = dates.slice(dates.search(MON)); note = true; }
    const mus = [];
    for (const m of muCell.matchAll(MU)) {
      const r = m[1], a = +m[2], b = m[4] != null ? +m[4] : a;
      for (let i = a; i <= b && i - a < 60; i++) mus.push(`${r}-${i}`);
    }
    const row = [species, qual, between, dates, note ? 1 : 0];
    for (const mu of mus) (out[mu] = out[mu] || []).push(row);
  }
  for (const mu of Object.keys(out)) out[mu] = out[mu].map(([s, q, c, d, n]) => [s.n, q, c, d, n]);
  return out;
}
const species = (n) => n.toLowerCase().replace(/^./, (c) => c.toUpperCase()).replace(/\(([a-z])/g, (m, c) => "(" + c.toUpperCase());
async function bcSeasons() {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(`${tmpdir()}/syn-`), mu = {};
  for (const [r, name] of SYN_REGIONS) {
    let buf = null;
    for (let i = 0; i < 4 && !buf; i++) {
      try {
        const res = await fetch(`${SYN}${name}.pdf`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120000) });
        if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
      } catch (e) { log(`    ${e.message}; trying again`); if (i === 3) throw e; await sleep(10000 * (i + 1)); }
    }
    writeFileSync(`${dir}/${name}.pdf`, buf);
    execFileSync("pdftotext", ["-layout", `${dir}/${name}.pdf`, `${dir}/${name}.txt`]);
    const got = parseSeasons(readFileSync(`${dir}/${name}.txt`, "utf8"));
    let n = 0;
    for (const [u, rows] of Object.entries(got)) {
      if (!u.startsWith(`${r}-`)) continue;   // a region's PDF can also name units of the regions next to it
      (mu[u] = mu[u] || []).push(...rows.map(([s, q, c, d, f]) => [species(s), q, c, d, f]));
      n++;
    }
    log(`    ${name}: ${n} units`);
  }
  if (Object.keys(mu).length < 150) throw new Error(`only ${Object.keys(mu).length} units read`);
  return mu;
}

// ---------- run ----------
async function part(name, fn) {
  try { const v = await fn(); log(`  ${name}: ${v.length}`); return v; }
  catch (e) { log(`  ${name} failed: ${e.message}`); return null; }
}
const now = new Date().toISOString();
const ONLY = process.env.ONLY || "";   // ONLY=seasons reads just the season tables and draws, ONLY=draws skips BC's season tables too, ONLY=canada only the other provinces
const write = (name, obj) => { for (const f of obj.zones || obj.areas) f.g = encode(f.g); const s = JSON.stringify(obj); writeFileSync(new URL(name, OUT), s); log(`  ${name}: ${(s.length / 1e6).toFixed(2)} MB`); };
if (!ONLY) {
log("Hunting zones");
const old = { zones: readOld("zones.json"), leh: readOld("leh.json"), areas: readOld("areas.json") };
const bcZ = await part("BC WMUs", bcZones), abZ = await part("Alberta WMUs", abZones);
const zones = [...(bcZ || (old.zones?.zones || []).filter((z) => z.p === "bc")), ...(abZ || (old.zones?.zones || []).filter((z) => z.p === "ab"))];
const leh = (await part("LEH zones", lehZones)) || old.leh?.zones || [];
const bcA = await part("BC areas", bcAreas), abA = await part("Alberta areas", abAreas);
const areas = [...(bcA || (old.areas?.areas || []).filter((a) => a.p !== "ab")), ...(abA || (old.areas?.areas || []).filter((a) => a.p === "ab"))];
if (zones.length) write("zones.json", { updated: now, zones });
if (leh.length) write("leh.json", { updated: now, zones: leh });
if (areas.length) write("areas.json", { updated: now, areas });
}
let seasons = null;
if (ONLY !== "draws" && ONLY !== "canada") try { seasons = await bcSeasons(); log(`  BC seasons: ${Object.keys(seasons).length} units`); } catch (e) { log(`  BC seasons failed: ${e.message}`); }
if (seasons) writeFileSync(new URL("seasons-bc.json", OUT), JSON.stringify({ updated: now, src: "BC Hunting and Trapping Regulations Synopsis", mu: seasons }));

// ---------- Alberta seasons, BC limited entry odds, Alberta draw results ----------
const { abSeasons, bcLeh, abDrawPage } = await import("./hunting-parse.mjs");
const { execFileSync } = await import("node:child_process");
const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const tmp = mkdtempSync(`${tmpdir()}/hunt-`);
// albertaregulations.ca and AlbertaRELM answer curl but turn away scripts that don't look like a browser, and limit
// how fast pages can be asked for: curl, a pause between files and a few tries.
function curl(url, file, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      execFileSync("curl", ["-sfL", "-m", "180", "-A", "Mozilla/5.0 (trail-finder hunting data)", "-c", `${tmp}/cj`, "-b", `${tmp}/cj`, "-o", file, url]);
      return file;
    } catch (e) { log(`    ${url.split("/").pop()}: try ${i + 1} failed`); execFileSync("sleep", [String(8 * (i + 1))]); }
  }
  throw new Error(`couldn't download ${url}`);
}
const pdfText = (url, name) => { curl(url, `${tmp}/${name}.pdf`); execFileSync("pdftotext", ["-layout", `${tmp}/${name}.pdf`, `${tmp}/${name}.txt`]); execFileSync("sleep", ["5"]); return readFileSync(`${tmp}/${name}.txt`, "utf8"); };
// ---------- the other provinces and territories (scripts/hunting-canada.mjs) ----------
if (!ONLY || ONLY === "canada") {
  const { canada } = await import("./hunting-canada.mjs");
  const curlText = (url, name) => { const f = curl(url, `${tmp}/${name}`); execFileSync("sleep", ["3"]); return readFileSync(f, "utf8"); };
  const s = await canada({ log, arcgis, getJson, rings, bbox, labelPoint, title, write, readOld, now, curlText });
  for (const [pv, v] of Object.entries(s)) { writeFileSync(new URL(`seasons-${pv}.json`, OUT), JSON.stringify({ updated: now, ...v })); log(`  seasons-${pv}.json`); }
}
if (ONLY === "canada") process.exit(0);
const ABR = "https://www.albertaregulations.ca/pdfs/hunting-regs/";
try {
  const wmu = abSeasons(pdfText(`${ABR}Big-Game-Seasons.pdf`, "ab-big-game"), pdfText(`${ABR}Game-Bird-Seasons.pdf`, "ab-birds"));
  // ranges like "102-402" also make numbers that aren't WMUs: keep the real ones
  const real = new Set((readOld("zones.json")?.zones || []).filter((z) => z.p === "ab").map((z) => String(z.id)));
  if (real.size) for (const k of Object.keys(wmu)) if (!real.has(k)) delete wmu[k];
  if (Object.keys(wmu).length < 120) throw new Error(`only ${Object.keys(wmu).length} WMUs read`);
  writeFileSync(new URL("seasons-ab.json", OUT), JSON.stringify({ updated: now, src: "Alberta Guide to Hunting Regulations", wmu }));
  log(`  Alberta seasons: ${Object.keys(wmu).length} WMUs`);
} catch (e) { log(`  Alberta seasons failed: ${e.message}`); }

// draws.json: { bc: { "2-5": [limited entry hunts with last year's first-choice odds] }, ab: [special licence hunts] }
const oldDraws = (() => { try { return JSON.parse(readFileSync(new URL("draws.json", OUT), "utf8")); } catch { return {}; } })();
let bcDraws = null, abDraws = null;
try {
  bcDraws = bcLeh(pdfText("https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/hunting/limited-entry-hunting/leh-regulations-synopsis.pdf", "bc-leh"));
  if (Object.keys(bcDraws).length < 100) throw new Error(`only ${Object.keys(bcDraws).length} units read`);
  log(`  BC limited entry hunts: ${Object.keys(bcDraws).length} units`);
} catch (e) { bcDraws = null; log(`  BC limited entry hunts failed: ${e.message}`); }
try {
  const RELM = "https://www.albertarelm.com/";
  const index = readFileSync(curl(`${RELM}cust.drawsummary.page`, `${tmp}/relm.html`), "utf8");
  abDraws = [];
  for (const m of index.matchAll(/href="(cust\.drawsummary(\w+?)\d\d\.page)">([^<]+)</g)) {
    execFileSync("sleep", ["3"]);
    const got = abDrawPage(readFileSync(curl(RELM + m[1], `${tmp}/${m[2]}.html`), "utf8"), m[3].trim());
    log(`    ${m[3].trim()}: ${got.length} hunts`);
    abDraws.push(...got);
  }
  if (abDraws.length < 100) throw new Error(`only ${abDraws.length} hunts read`);
  log(`  Alberta draw results: ${abDraws.length} hunts`);
} catch (e) { abDraws = null; log(`  Alberta draw results failed: ${e.message}`); }
if (bcDraws || abDraws) writeFileSync(new URL("draws.json", OUT), JSON.stringify({ updated: now,
  bc: bcDraws || oldDraws.bc || {}, bcSrc: "BC Limited Entry Hunting Regulations Synopsis (last year's first-choice odds)",
  ab: abDraws || oldDraws.ab || [], abSrc: "AlbertaRELM draw summaries" }));

// harvest.json: hunters, days and kills per BC unit (last 5 years) and Alberta's estimated resident harvest and hunter
// success per WMU (latest Hunter harvest reports), for "Harvest here" in the spot card.
const { bcHarvest, abHarvest } = await import("./hunting-parse.mjs");
const oldHarvest = (() => { try { return JSON.parse(readFileSync(new URL("harvest.json", OUT), "utf8")); } catch { return {}; } })();
let bcH = null, abH = null;
try {
  const pkg = JSON.parse(readFileSync(curl("https://catalogue.data.gov.bc.ca/api/3/action/package_show?id=f2303645-5952-4766-bd5c-3b9b50dda1ca", `${tmp}/bch.json`), "utf8"));
  const res = pkg.result.resources.find((r) => /- WMU$/i.test(r.name.trim()) && /\.csv$/i.test(r.url));
  bcH = bcHarvest(readFileSync(curl(res.url, `${tmp}/bch.csv`), "utf8"));
  if (Object.keys(bcH.mu).length < 100) throw new Error(`only ${Object.keys(bcH.mu).length} units read`);
  log(`  BC harvest: ${Object.keys(bcH.mu).length} units, ${bcH.years[0]}-${bcH.years.at(-1)}`);
} catch (e) { bcH = null; log(`  BC harvest failed: ${e.message}`); }
try {
  const AB_HARVEST = { "white-tailed-deer": "White-tailed deer", "mule-deer": "Mule deer", "elk": "Elk", "moose": "Moose", "black-bear": "Black bear", "pronghorn": "Pronghorn" };
  abH = { year: null, wmu: {} };
  for (const [slug, name] of Object.entries(AB_HARVEST)) {
    const pkg = JSON.parse(readFileSync(curl(`https://open.alberta.ca/api/3/action/package_show?id=hunter-harvest-report-${slug}-estimated-resident-harvest-for-${slug}`, `${tmp}/abh.json`), "utf8"));
    const pdfs = pkg.result.resources.filter((r) => /\.pdf$/i.test(r.url)).map((r) => ({ r, y: +((r.name.match(/\b(20\d\d)\b/) || [])[1] || 0) })).sort((a, b) => b.y - a.y);
    if (!pdfs.length) continue;
    const got = abHarvest(pdfText(pdfs[0].r.url, `abh-${slug}`));
    if (Object.keys(got.wmu).length < 20) { log(`    ${name}: only ${Object.keys(got.wmu).length} WMUs`); continue; }
    abH.year = Math.max(abH.year || 0, got.year || pdfs[0].y);
    for (const [w, v] of Object.entries(got.wmu)) (abH.wmu[w] ||= {})[name] = v;
    log(`    ${name} ${got.year || pdfs[0].y}: ${Object.keys(got.wmu).length} WMUs`);
  }
  if (Object.keys(abH.wmu).length < 50) throw new Error(`only ${Object.keys(abH.wmu).length} WMUs read`);
} catch (e) { abH = null; log(`  Alberta harvest failed: ${e.message}`); }
if (bcH || abH) writeFileSync(new URL("harvest.json", OUT), JSON.stringify({ updated: now,
  bc: bcH || oldHarvest.bc || null, bcSrc: "BC Big Game Harvest Statistics (resident + non-resident)",
  ab: abH || oldHarvest.ab || null, abSrc: "Alberta Hunter harvest reports (estimated resident harvest)" }));
