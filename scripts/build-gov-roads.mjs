// Government forest road maps for the Canada road chunks (ca/r/<chunk>.json), so "Forest roads" outside the home zones
// shows each road's official status too, not only OpenStreetMap's (Upgrade 6 of the 2026-10-30 review, alex: close the
// free coverage gaps). Runs in the nightly Canada job (.github/workflows/canada-data.yml) right after
// `build-canada-roads.mjs finish`, and adds to each chunk file:
//   ften:  [{ src, n, t, s, p, f, d, k, w, g }]   the government road lines near the chunk's OpenStreetMap roads
//   gov:   ["bc", "on", ...]                     the sources that were asked for this chunk (none found = none there)
//   govAt: when they were asked
// The home zones' BC Forest Tenure entries ({ n, t, s, p, f, d, g }, scripts/build-roads.mjs) have no src; the others
// carry src plus k (one of the app's road states: good, degraded, heavy, closed, impass, unknown) and w (why).
// Sources (all free and open, each only answers inside its own province):
//   bc  DataBC Forest Tenure road sections (WFS), as build-roads.mjs: ACTIVE / RETIRED tenure
//   yt  Yukon GeoYukon "Forest Resource Roads - 50k": built / planned, tenure and road class
//   on  Ontario MNRF Road Segment (LIO open data): open / restricted / closed, maintenance level, gates, owner
//   qc  Québec AQréseau+ multi-use and forest roads: drivable (carrossable) or not, manager
//   ns  Nova Scotia Topographic Database roads: resource access roads, tracks, dry-weather and abandoned roads, owner
//   nb  New Brunswick ForestRoads: forest roads not maintained by the province (no other details published)
// Government maps change slowly: a chunk keeps last night's answer (refs/ca/last, the previous canada-data branch) for
// a week, and at most GOV_MINUTES (default 30) of asking is done a night, oldest chunks first.
//
// Run: node scripts/build-gov-roads.mjs [out/ca/r]   (Node 18 or newer, no packages needed)

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const DIR = new URL(`../${process.argv[2] || "out/ca/r"}/`, import.meta.url);
const UA = "trail-finder forest roads data (https://github.com/allduf/trail-finder)";
const WEEK = 7 * 864e5, BUDGET = (+process.env.GOV_MINUTES || 30) * 60e3, t0 = Date.now();
const CELL = 0.01, TILE = 0.25;
const round = (n) => Math.round(n * 1e5) / 1e5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// Douglas-Peucker on a local flat projection, to about 8 m (as build-canada-roads.mjs).
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

async function getJson(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(90000) });
      const text = await res.text();
      if (!res.ok || !text.startsWith("{")) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, " ")}`);
      const j = JSON.parse(text);
      if (j.error) throw new Error(`${j.error.code}: ${j.error.message}`);
      return j;
    } catch (e) { last = e; await sleep(4000 * (i + 1)); }
  }
  throw last;
}
const quarters = ([s, w, n, e]) => { const cs = (s + n) / 2, cw = (w + e) / 2; return [[s, w, cs, cw], [s, cw, cs, e], [cs, w, n, cw], [cs, cw, n, e]]; };

// ---------- ArcGIS map services: one box at a time, split in 4 when a box has more than one page ----------
async function arcgis(url, where, fields, box, depth = 0, seen = new Map()) {
  const [s, w, n, e] = box;
  const q = new URLSearchParams({ where, outFields: fields, returnGeometry: "true", outSR: "4326", f: "json",
    geometry: `${w},${s},${e},${n}`, geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects" });
  const j = await getJson(`${url}/query?${q}`);
  if (j.exceededTransferLimit && depth < 6) { for (const b of quarters(box)) await arcgis(url, where, fields, b, depth + 1, seen); return seen; }
  for (const f of j.features || []) {
    const a = f.attributes || {}, id = a.OBJECTID ?? a.objectid ?? JSON.stringify(a);
    if (f.geometry && f.geometry.paths) seen.set(id, { a, parts: f.geometry.paths.map((p) => p.map(([x, y]) => [y, x])) });
  }
  return seen;
}
const yes = (v) => /^(y|yes|oui|true|1)$/i.test(String(v ?? "").trim());
const str = (v) => (v == null ? "" : String(v).trim());
const year = (v) => (typeof v === "number" ? new Date(v).getUTCFullYear() + "" : str(v).slice(0, 4));

const SOURCES = {
  yt: {
    box: [60, -141, 69.7, -123.8], label: "Yukon forest resource roads",
    url: "https://mapservices.gov.yk.ca/arcgis/rest/services/GeoYukon/GY_Forestry/MapServer/39",
    where: "ROAD_DEVELOPMENT_STATUS IS NULL OR ROAD_DEVELOPMENT_STATUS NOT IN ('Planned','Proposed')",
    fields: "OBJECTID,LOCAL_ROAD_NAME,ROAD_DEVELOPMENT_STATUS,ROAD_ACT_TENURE,ROAD_CLASS,ROAD_ID,SECTION_ID,ROAD_CONSTRUCTION_DATE",
    road(a) {
      const cls = str(a.ROAD_CLASS), built = str(a.ROAD_DEVELOPMENT_STATUS);
      const haul = /haul|primary|secondary/i.test(cls);
      return { n: str(a.LOCAL_ROAD_NAME), t: cls || "forest road", s: built.toUpperCase(), p: str(a.ROAD_ACT_TENURE), f: [a.ROAD_ID, a.SECTION_ID].filter(Boolean).join(" "),
        d: year(a.ROAD_CONSTRUCTION_DATE), k: haul && built === "Constructed" ? "good" : "unknown",
        w: haul && built === "Constructed" ? `built ${cls.toLowerCase()}` : `${(cls || "road").toLowerCase()}${built ? ", " + built.toLowerCase() : ""}: condition not recorded` };
    },
  },
  on: {
    box: [41.6, -95.2, 56.9, -74.3], label: "Ontario MNRF roads",
    url: "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open09/MapServer/18",
    where: "1=1",
    fields: "OBJECTID,ROAD_NAME,ALTERNATE_NAME,STATUS,CLOSED_STATE,MAINTENANCE_LEVEL,PASSABLE_IND,GATE_IND,ROADBED_DESTROYED_IND,ROAD_AUTHORITY,RESPONSIBILITY_CLASS,SURFACE_TYPE,USE_RESTRICTION_DETAIL,YEAR_DECOMMISSIONED,ROAD_CLOSED_YEAR",
    road(a) {
      const st = str(a.STATUS), mt = str(a.MAINTENANCE_LEVEL), gone = yes(a.ROADBED_DESTROYED_IND) || /^no$/i.test(str(a.PASSABLE_IND));
      const restr = str(a.USE_RESTRICTION_DETAIL);
      let k, w;
      if (gone) { k = "impass"; w = "the road bed is gone or not passable"; }
      else if (/closed/i.test(st) || str(a.CLOSED_STATE)) { k = "closed"; w = `closed${a.ROAD_CLOSED_YEAR ? " since " + a.ROAD_CLOSED_YEAR : ""}`; }
      else if (a.YEAR_DECOMMISSIONED) { k = "heavy"; w = `decommissioned ${a.YEAR_DECOMMISSIONED}`; }
      else if (/restricted/i.test(st)) { k = "closed"; w = `restricted use${restr ? ": " + restr : ""}`; }
      else if (/routine/i.test(mt)) { k = "good"; w = "open, routine maintenance"; }
      else if (/limited/i.test(mt)) { k = "degraded"; w = "open, limited maintenance"; }
      else { k = "unknown"; w = `${st ? st.toLowerCase() : "status unknown"}${mt ? ", " + mt.toLowerCase() : ""}`; }
      if (yes(a.GATE_IND)) w += "; gate";
      return { n: str(a.ROAD_NAME) || str(a.ALTERNATE_NAME), t: [str(a.SURFACE_TYPE), "road"].filter(Boolean).join(" ").toLowerCase(), s: st.toUpperCase(),
        p: [a.ROAD_AUTHORITY, a.RESPONSIBILITY_CLASS].map(str).filter((v, i, l) => v && l.indexOf(v) === i).join(" / "), f: "", d: "", k, w };
    },
  },
  qc: {
    box: [44.9, -79.8, 62.6, -57.1], label: "Québec AQréseau+",
    // Carrossable / Non carrossable / Impraticable / Inconnue: the same roads split by whether a car can drive them.
    url: "https://servicescarto.mrnf.gouv.qc.ca/pes/rest/services/Territoire/AQreseauPlus_WMS/MapServer",
    layers: { 32: "good", 33: "heavy", 34: "impass", 35: "unknown" },
    where: "Che_Multi = 'OUI' OR Gestion = 'FORET' OR Cls_CheFor <> 'NF'",
    fields: "OBJECTID,NomRte,Cls_CheFor,Che_Multi,Gestion,CarRte,No_Chefor",
    road(a, k) {
      const why = { good: "drivable (carrossable)", heavy: "not drivable by car (non carrossable)", impass: "impassable (impraticable)", unknown: "drivability unknown" }[k];
      const c = str(a.Cls_CheFor), cls = /^0?[1-5]$/.test(c) ? `forest road class ${+c}` : { HN: "non-standard forest road", HI: "winter road", NC: "unclassed forest road" }[c] || "multi-use road";
      return { n: str(a.NomRte), t: cls, s: str(a.CarRte).toUpperCase(), p: /^inconnu$/i.test(str(a.Gestion)) ? "" : str(a.Gestion).replace(/^FORET$/, "forest (Québec)"),
        f: str(a.No_Chefor), d: "", k, w: why };
    },
  },
  ns: {
    box: [43.3, -66.4, 47.1, -59.7], label: "Nova Scotia topographic roads",
    url: "https://nsgiwa.novascotia.ca/arcgis/rest/services/BASE/BASE_NSTDB_10k_Roads_UT83/MapServer/8",
    where: "FEAT_DESC LIKE 'TRACK%' OR FEAT_DESC LIKE 'ROAD - Resource Access%' OR FEAT_DESC LIKE 'ROAD - Abandoned%' OR FEAT_DESC LIKE '%Dry Weather%Unpaved'",
    fields: "OBJECTID,FEAT_DESC,STREET,OWNER_DESC,ROADSEGID",
    road(a) {
      const d = str(a.FEAT_DESC);
      const [k, w] = /Abandoned/i.test(d) ? ["heavy", "abandoned road"] : /Dry Weather/i.test(d) ? ["degraded", "dry-weather road: soft when wet"]
        : /^TRACK/i.test(d) ? ["unknown", "track"] : ["unknown", "resource access road"];
      return { n: str(a.STREET), t: d.replace(/^ROAD - /, "").toLowerCase(), s: "", p: str(a.OWNER_DESC), f: str(a.ROADSEGID), d: "", k, w };
    },
  },
  nb: {
    box: [44.5, -69.1, 48.1, -63.7], label: "New Brunswick forest roads",
    url: "https://gis-erd-der.gnb.ca/server/rest/services/OpenData/ForestRoads/MapServer/0",
    where: "1=1", fields: "OBJECTID",
    road() { return { n: "", t: "forest road", s: "", p: "", f: "", d: "", k: "unknown", w: "forest road, not maintained by the province" }; },
  },
};

// ---------- BC: DataBC Forest Tenure road sections (the same layer and record as build-roads.mjs) ----------
const BC_BOX = [48.2, -139.1, 60, -114];
const WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs";
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
async function bcFten(box, depth = 0, seen = new Map()) {
  const params = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: "pub:WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW",
    outputFormat: "application/json", srsName: "EPSG:4326", count: "5000", CQL_FILTER: `BBOX(GEOMETRY, ${albersBox(box).join(", ")}, 'EPSG:3005')` });
  const fc = await getJson(`${WFS}?${params}`);
  const feats = fc.features || [];
  if ((fc.numberMatched > feats.length || feats.length >= 5000) && depth < 5) { for (const q of quarters(box)) await bcFten(q, depth + 1, seen); return seen; }
  for (const f of feats) {
    const p = f.properties || {}, status = str(p.LIFE_CYCLE_STATUS_CODE).toUpperCase();
    if (!f.geometry || status === "PENDING") continue;
    const parts = f.geometry.type === "MultiLineString" ? f.geometry.coordinates : f.geometry.type === "LineString" ? [f.geometry.coordinates] : [];
    seen.set(f.id || JSON.stringify(p), { a: p, parts: parts.map((part) => part.map(([x, y]) => (Math.abs(y) > 90 ? [x, y] : [y, x]))), bc: status });
  }
  return seen;
}
const bcRoad = (p, status) => ({ n: [p.MAP_LABEL, p.ROAD_SECTION_NAME].map(str).find(Boolean) || "", t: p.FILE_TYPE_DESCRIPTION || p.FILE_TYPE_CODE || "", s: status,
  p: p.CLIENT_NAME || "", f: [p.FOREST_FILE_ID, p.ROAD_SECTION_ID].filter(Boolean).join(" "), d: str(p.RETIREMENT_DATE).slice(0, 10) });

// ---------- one chunk ----------
const overlaps = ([s, w, n, e], [S, W, N, E]) => s <= N && n >= S && w <= E && e >= W;
async function chunkGov(file) {
  // Cells (about 1.1 km) with an OpenStreetMap road point, and the 0.25° tiles they fall in.
  const cells = new Set(), tiles = new Map();
  for (const r of Object.values(file.osm || {})) for (let i = 0; i < r.g.length; i += 2) {
    const ci = Math.floor(r.g[i] / CELL), cj = Math.floor(r.g[i + 1] / CELL);
    cells.add(`${ci},${cj}`);
    const tk = `${Math.floor(r.g[i] / TILE)},${Math.floor(r.g[i + 1] / TILE)}`, t = tiles.get(tk) || [Infinity, Infinity, -Infinity, -Infinity];
    tiles.set(tk, [Math.min(t[0], r.g[i]), Math.min(t[1], r.g[i + 1]), Math.max(t[2], r.g[i]), Math.max(t[3], r.g[i + 1])]);
  }
  const near = ([lat, lon]) => {
    const ci = Math.floor(lat / CELL), cj = Math.floor(lon / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (cells.has(`${ci + i},${cj + j}`)) return true;
    return false;
  };
  const boxes = [...tiles.values()].map(([s, w, n, e]) => [s - CELL, w - CELL, n + CELL, e + CELL]);
  if (!boxes.length) return { ften: [], gov: [] };
  const all = boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  const out = [], gov = [];
  const keep = (parts, rec) => {
    for (const part of parts) {
      if (part.length < 2) continue;
      // Long lines: check every point, they're simplified only after.
      if (!part.some(near)) continue;
      out.push({ ...rec, g: simplify(part).flatMap(([la, lo]) => [round(la), round(lo)]) });
    }
  };
  if (overlaps(all, BC_BOX)) {
    const seen = new Map();
    for (const b of boxes) if (overlaps(b, BC_BOX)) await bcFten(b, 0, seen);
    for (const { a, parts, bc } of seen.values()) keep(parts, bcRoad(a, bc));
    gov.push("bc");
  }
  for (const [src, S] of Object.entries(SOURCES)) {
    if (!overlaps(all, S.box)) continue;
    const layers = S.layers || { "": null };
    for (const [layer, k] of Object.entries(layers)) {
      const seen = new Map(), url = layer ? `${S.url}/${layer}` : S.url;
      for (const b of boxes) if (overlaps(b, S.box)) await arcgis(url, S.where, S.fields, b, 0, seen);
      for (const { a, parts } of seen.values()) keep(parts, { src, ...S.road(a, k) });
    }
    gov.push(src);
  }
  return { ften: out, gov };
}

// Last night's chunk (the previous canada-data branch, fetched as refs/ca/last), for its government roads.
function lastNight(name) {
  try { return JSON.parse(execFileSync("git", ["show", `refs/ca/last:ca/r/${name}`], { encoding: "utf8", maxBuffer: 256e6, stdio: ["ignore", "pipe", "ignore"] })); }
  catch { return null; }
}

const names = readdirSync(DIR).filter((f) => /^-?\d+_-?[\d.]+\.json$/.test(f));
const jobs = names.map((name) => {
  const old = lastNight(name);
  return { name, old, at: (old && Date.parse(old.govAt)) || 0 };
}).sort((a, b) => a.at - b.at);
let asked = 0, kept = 0, failed = 0, lines = 0;
for (const j of jobs) {
  const url = new URL(j.name, DIR), file = JSON.parse(readFileSync(url, "utf8"));
  if (Date.now() - j.at < WEEK || Date.now() - t0 > BUDGET) {
    if (j.old && j.old.govAt) { file.ften = j.old.ften || []; file.gov = j.old.gov || []; file.govAt = j.old.govAt; kept++; lines += file.ften.length; writeFileSync(url, JSON.stringify(file)); }
    continue;
  }
  try {
    const { ften, gov } = await chunkGov(file);
    Object.assign(file, { ften, gov, govAt: new Date().toISOString().slice(0, 19) + "Z" });
    asked++; lines += ften.length;
    const by = {}; ften.forEach((r) => { by[r.src || "bc"] = (by[r.src || "bc"] || 0) + 1; });
    log(`${j.name}: ${ften.length} government road lines (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}; asked ${gov.join(", ") || "nobody"})`);
  } catch (e) {
    failed++; log(`${j.name}: ${e.message}; keeping last night's`);
    if (j.old && j.old.govAt) Object.assign(file, { ften: j.old.ften || [], gov: j.old.gov || [], govAt: j.old.govAt });
  }
  writeFileSync(url, JSON.stringify(file));
}
log(`Government roads: ${asked} chunks asked, ${kept} kept from last night, ${failed} failed, ${lines} lines in all`);
if (failed) log(`::warning::Government forest roads failed for ${failed} chunks (kept last night's)`);
