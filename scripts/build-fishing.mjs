// Monthly job (see .github/workflows/fishing-data.yml): the data files for Fishing, the fourth sport in the sport menu.
//
// Writes these files in data/fishing/, all from free official open data:
//  - stocked.json: lakes, ponds and rivers stocked with fish in the last 3 years, with each release (date or year,
//    species, number, size). BC: the Freshwater Fisheries Society of BC's stocking report (gofishbc.com), placed on the
//    BC Freshwater Atlas lake with the same waterbody id (DataBC FWA_LAKES_POLY) or the fish records for that id
//    (FISS_FISH_OBSRVTN_PNT_SP). Alberta: the fish stocking reports and this year's planned trout stocking
//    (open.alberta.ca). Ontario: Fish Stocking Data for Recreational Purposes (Ontario GeoHub). Quebec doesn't publish
//    its stocking as open data.
//  - zones.json: the areas fishing rules are written for, as simplified outlines: BC's fishing regions (DataBC
//    EADM_WLAP_REGION_BND_AREA_SVW), BC's tidal Pacific Fishery Management Areas (DFO_PFMA_STAT_AREA_BDRY_SP),
//    Alberta's Fish Management Zones (fisheries/fisheries_regulations), Ontario's Fisheries Management Zones (LIO) and
//    Quebec's fishing zones with their latest news (peche.faune.gouv.qc.ca).
//  - gauges.json: every active real-time river and lake gauge in Canada (Environment and Climate Change Canada's
//    hydrometric network, api.weather.gc.ca) with its usual flow and water level for each month: the middle of all the
//    monthly means on record, so the app can say if a river is low, normal or high for the time of year.
//  - tides.json: every Canadian Hydrographic Service station with high and low tide predictions (IWLS API).
//  - spots.json: every known public fishing spot in Canada (alex: "add a layer with all the fishing spots"): OpenStreetMap's
//    fishing spots, fishing piers and boat launches (leisure=fishing, fishing=yes/designated, leisure=slipway, read with
//    Overpass for all of Canada) and Ontario's fishing access points (LIO). [lat, lon, kind (0 spot, 1 pier or dock,
//    2 launch), name, facts]. Anglers' own catches and spots are never in it.
//  - eat.json: how many meals a month of each fish are safe, by size, for each lake and river in the provinces' fish
//    eating guides: Ontario's Guide to Eating Ontario Fish (data.ontario.ca, for everyone and for the sensitive
//    population: children under 15 and people who are or may become pregnant or are breastfeeding) and Quebec's Guide
//    de consommation du poisson de pêche sportive en eau douce (donneesquebec.ca, CC-BY 4.0).
// DataBC: Open Government Licence - British Columbia. Alberta: Open Government Licence - Alberta. Ontario: Open
// Government Licence - Ontario. Quebec and DFO: Open Government Licence - Canada / Quebec. FFSBC stocking report: public
// report, credited in the app. A source that fails keeps its last good data.
//
// Run: node scripts/build-fishing.mjs   (Node 18 or newer, no packages needed; ONLY=stocked|zones|tides|gauges|eat|spots for one file)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const OUT = new URL("../data/fishing/", import.meta.url);
const UA = "trail-finder fishing data (https://github.com/allduf/trail-finder)";
const WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs";
const ONLY = process.env.ONLY || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
const encode = (g) => g.map((r) => { const out = []; let pa = 0, po = 0; for (let i = 0; i < r.length; i += 2) { const a = Math.round(r[i] * 1e4), o = Math.round(r[i + 1] * 1e4); out.push(a - pa, o - po); pa = a; po = o; } return out; });
const readOld = (name) => { try { return JSON.parse(readFileSync(new URL(name, OUT), "utf8")); } catch { return null; } };
const save = (name, j) => { const s = JSON.stringify(j); writeFileSync(new URL(name, OUT), s); log(`  ${name}: ${(s.length / 1024).toFixed(0)} KB`); };

async function get(url, { json = true, tries = 4, body } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: json ? "application/json" : "*/*" }, signal: AbortSignal.timeout(240000), ...(body ? { method: "POST", body } : {}) });
      if (!json) { if (!res.ok) throw new Error(`HTTP ${res.status}`); return Buffer.from(await res.arrayBuffer()); }
      const text = await res.text();
      if (!res.ok || !/^\s*[[{]/.test(text)) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, " ")}`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e; log(`    ${String(e.message).slice(0, 120)}; trying again`);
      if (/HTTP 4\d\d/.test(e.message)) break;
      await sleep(6000 * (i + 1));
    }
  }
  throw lastErr;
}
async function databc(layer, props, where = "") {
  const out = [];
  for (let start = 0; ; start += 2000) {
    const p = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: `pub:${layer}`, outputFormat: "application/json",
      srsName: "EPSG:4326", count: "2000", startIndex: String(start), sortBy: "OBJECTID" });
    if (props) p.set("propertyName", props);
    if (where) p.set("CQL_FILTER", where);
    const fc = await get(`${WFS}?${p}`);
    out.push(...(fc.features || []));
    if (!fc.features || fc.features.length < 2000) break;
  }
  return out;
}
async function arcgis(layer, fields, where = "1=1", offset = 0.002, oid = null) {
  const out = [];
  for (let start = 0; ; start += 500) {
    const p = new URLSearchParams({ where, outFields: fields.join(","), outSR: "4326", f: "geojson", resultOffset: String(start), resultRecordCount: "500", returnGeometry: "true" });
    if (oid != null) { p.delete("where"); p.delete("resultOffset"); p.delete("resultRecordCount"); p.set("objectIds", String(oid)); }
    if (offset) { p.set("maxAllowableOffset", String(offset)); p.set("geometryPrecision", "4"); }
    const fc = await get(`${layer}/query?${p}`);
    out.push(...(fc.features || []));
    if (oid != null || !fc.features || fc.features.length < 500) break;
  }
  return out;
}

// ---------- geometry ----------
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
function rings(geom, tol, minArea = 0) {
  if (!geom) return [];
  const polys = geom.type === "MultiPolygon" ? geom.coordinates : geom.type === "Polygon" ? [geom.coordinates] : [];
  return polys.flatMap((poly) => poly.map((ring) => {
    const pts = simplify(ring, tol);
    if (pts.length < 4) return null;
    if (minArea) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); if (Math.abs(a / 2) < minArea) return null; }
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
// A label point well inside a polygon's biggest ring: its vertices' middle, or the ring's first point.
function centre(geom) {
  const polys = geom.type === "MultiPolygon" ? geom.coordinates : geom.type === "Polygon" ? [geom.coordinates] : [];
  let best = null, bestN = 0;
  for (const p of polys) if (p[0] && p[0].length > bestN) { best = p[0]; bestN = p[0].length; }
  if (!best) return null;
  let x = 0, y = 0; for (const [a, b] of best) { x += a; y += b; }
  return [r4(y / best.length), r4(x / best.length)];
}

const now = new Date(), since = new Date(now.getFullYear() - 3, now.getMonth(), 1);
const iso = (d) => d.toISOString().slice(0, 10);
const title = (s) => String(s || "").toLowerCase().replace(/(^|[\s\-'(/])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Of|The|And|De|Du|La|Le|Des)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase());

// ---------- stocking ----------
const SPN = [], STN = [];   // species and size names; each release names them by their place in these lists
const SAME = { "Westslope Cutthroat": "Westslope Cutthroat Trout", "Eastern Brook Trout": "Brook Trout", "Coastal Cutthroat (Anadromous)": "Coastal Cutthroat Trout (sea-run)" };
const stCode = (s) => { s = String(s || "").trim(); let i = STN.indexOf(s); if (i < 0) { i = STN.length; STN.push(s); } return i; };
function spCode(name) {
  let n = title(name).replace(/\s+/g, " ").trim();
  n = SAME[n] || n;
  let i = SPN.indexOf(n);
  if (i < 0) { i = SPN.length; SPN.push(n); }
  return i;
}

async function stockBC() {
  const url = `https://www.gofishbc.com/wp-json/ffsbc-stocking/v1/releases?start=${iso(since)}&end=${iso(now)}&sort=date&dir=desc&page=1&per_page=all`;
  const j = await get(url);
  const rows = j.rows || [];
  log(`  BC releases: ${rows.length}`);
  const by = new Map();
  for (const r of rows) {
    if (!r.wbid) continue;
    const w = by.get(r.wbid) || by.set(r.wbid, { name: title(r.water), town: title(r.town), rel: [] }).get(r.wbid);
    w.rel.push([r.date, spCode(r.species), r.qty || 0, [r.stage, r.strain, r.ploidy].filter(Boolean).join(", ")]);
  }
  // Where each one is: the Freshwater Atlas lake with that id, else the middle of the fish records for it.
  const ids = [...by.keys()], at = new Map();
  for (let i = 0; i < ids.length; i += 60) {
    const list = ids.slice(i, i + 60).map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
    try {
      const lakes = await databc("WHSE_BASEMAPPING.FWA_LAKES_POLY", "WATERBODY_KEY_GROUP_CODE_50K,GNIS_NAME_1,AREA_HA,GEOMETRY", `WATERBODY_KEY_GROUP_CODE_50K IN (${list})`);
      for (const f of lakes) {
        const k = f.properties.WATERBODY_KEY_GROUP_CODE_50K, c = f.geometry && centre(f.geometry), a = f.properties.AREA_HA || 0;
        if (c && (!at.has(k) || at.get(k).a < a)) at.set(k, { c, a, n: f.properties.GNIS_NAME_1 });
      }
    } catch (e) { log(`    lakes: ${e.message}`); }
  }
  const missing = ids.filter((k) => !at.has(k));
  for (let i = 0; i < missing.length; i += 40) {
    const list = missing.slice(i, i + 40).map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
    try {
      const pts = await databc("WHSE_FISH.FISS_FISH_OBSRVTN_PNT_SP", "WATERBODY_IDENTIFIER,GEOMETRY", `WATERBODY_IDENTIFIER IN (${list})`);
      const g = new Map();
      for (const f of pts) { const k = f.properties.WATERBODY_IDENTIFIER, c = f.geometry?.coordinates; if (!c) continue; (g.get(k) || g.set(k, []).get(k)).push(c); }
      for (const [k, cs] of g) { cs.sort((a, b) => a[0] - b[0]); const x = cs[cs.length >> 1][0]; cs.sort((a, b) => a[1] - b[1]); const y = cs[cs.length >> 1][1]; at.set(k, { c: [r4(y), r4(x)] }); }
    } catch (e) { log(`    fish records: ${e.message}`); }
  }
  // Last resort: the FFSBC "where to fish" map pins, by name.
  const still = ids.filter((k) => !at.has(k));
  if (still.length) {
    try {
      const pins = await get("https://www.gofishbc.com/wp-json/wpgmza/v1/markers");
      const byName = new Map(); for (const p of pins) byName.set(String(p.title).toUpperCase().replace(/ (LAKE|POND)$/, ""), [r4(+p.lat), r4(+p.lng)]);
      for (const k of still) { const n = by.get(k).name.toUpperCase().replace(/ (LAKE|POND)$/, ""); if (byName.has(n)) at.set(k, { c: byName.get(n) }); }
    } catch (e) { log(`    map pins: ${e.message}`); }
  }
  const out = [];
  for (const [k, w] of by) {
    const p = at.get(k); if (!p) continue;
    const name = /\b(lake|pond|river|creek|reservoir|slough|marsh)\b/i.test(w.name) ? w.name : `${w.name} Lake`;
    out.push({ n: name, p: "bc", c: p.c, id: k, t: w.town, r: w.rel });
  }
  log(`  BC waters: ${out.length} of ${by.size} placed`);
  return out;
}

// A small .zip reader (no packages): every file in it, by name.
async function unzip(buf) {
  const { inflateRawSync } = await import("node:zlib");
  const files = {};
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) {
    let p = buf.readUInt32LE(i + 16); const n = buf.readUInt16LE(i + 10);
    for (let k = 0; k < n; k++) {
      const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
      const name = buf.slice(p + 46, p + 46 + nl).toString();
      const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28), data = buf.slice(off + 30 + lnl + lel, off + 30 + lnl + lel + csize);
      files[name] = method === 8 ? inflateRawSync(data) : data;
      p += 46 + nl + el + cl;
    }
    break;
  }
  return files;
}
// A small .xlsx reader: the first sheet's rows as arrays of cell values.
async function xlsxRows(buf) {
  const files = await unzip(buf);
  const xml = (n) => (files[n] ? files[n].toString("utf8") : "");
  const unx = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const shared = [...xml("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unx([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const sheet = xml("xl/worksheets/sheet1.xml");
  const col = (ref) => { let c = 0; for (const ch of ref.replace(/\d+/g, "")) c = c * 26 + ch.charCodeAt(0) - 64; return c - 1; };
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((m) => {
    const row = [];
    for (const c of m[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = (c[3] || "").match(/<v>([\s\S]*?)<\/v>/), is = (c[3] || "").match(/<t[^>]*>([\s\S]*?)<\/t>/);
      row[col(c[1])] = /t="s"/.test(c[2]) && v ? shared[+v[1]] : /t="inlineStr"/.test(c[2]) && is ? unx(is[1]) : v ? (isNaN(+v[1]) ? unx(v[1]) : +v[1]) : null;
    }
    return row;
  });
}
const excelDay = (n) => (typeof n === "number" ? iso(new Date(Date.UTC(1899, 11, 30) + n * 864e5)) : String(n || "").slice(0, 10));

async function stockAB() {
  const ckan = (id) => get(`https://open.alberta.ca/api/3/action/package_show?id=${id}`).then((j) => j.result.resources);
  const by = new Map();
  const add = (name, lat, lon, rel) => {
    if (!isFinite(lat) || !isFinite(lon) || !name) return;
    const k = `${title(name)}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
    (by.get(k) || by.set(k, { n: title(name), p: "ab", c: [r4(lat), r4(lon)], r: [] }).get(k)).r.push(rel);
  };
  // Actual releases: the newest report files (XLSX or CSV).
  try {
    const res = (await ckan("fish-stocking-report")).filter((r) => /xlsx|csv/i.test(r.format)).sort((a, b) => String(b.name).localeCompare(String(a.name)));
    const recent = res.filter((r) => { const y = +(String(r.name).match(/20\d\d/) || [0])[0]; return y >= now.getFullYear() - 5; }).slice(0, 3);
    for (const r of recent) {
      const buf = await get(r.url, { json: false });
      let rows;
      if (/xlsx/i.test(r.format)) rows = await xlsxRows(buf);
      else rows = buf.toString("utf8").split(/\r?\n/).map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')));
      const head = rows.findIndex((x) => x && x.some((c) => /latitude/i.test(String(c))));
      if (head < 0) continue;
      const h = rows[head].map((c) => String(c || "").toLowerCase());
      const ix = (re) => h.findIndex((c) => re.test(c));
      const iD = ix(/stocking date|^date/), iN = ix(/official name/), iC = ix(/common name/), iLa = ix(/latitude/), iLo = ix(/longitude/), iS = ix(/species common/), iQ = ix(/^number/), iL = ix(/average length/), iG = ix(/genotype/);
      let n = 0;
      for (const row of rows.slice(head + 1)) {
        if (!row || row[iLa] == null) continue;
        const sp = row[iS]; if (!sp) continue;
        add(row[iC] || row[iN], +row[iLa], +row[iLo], [excelDay(row[iD]), spCode(sp), +row[iQ] || 0, [row[iL] ? `${row[iL]} cm` : "", row[iG] || ""].filter(Boolean).join(", ")]);
        n++;
      }
      log(`  Alberta ${r.name}: ${n} releases`);
    }
  } catch (e) { log(`  Alberta report: ${e.message}`); }
  // This year's planned trout stocking (lake, species, size, number and the planned week).
  try {
    const res = (await ckan("planned-trout-stocking")).filter((r) => /xlsx/i.test(r.format)).sort((a, b) => String(b.name).localeCompare(String(a.name)));
    const r = res[0];
    if (r) {
      const year = (String(r.name).match(/20\d\d/) || [now.getFullYear()])[0];
      const rows = await xlsxRows(await get(r.url, { json: false }));
      const head = rows.findIndex((x) => x && x.some((c) => /latitude/i.test(String(c))));
      let n = 0;
      const AB_SP = { RNTR: "Rainbow Trout", WSCT: "Westslope Cutthroat Trout", BKTR: "Brook Trout", BNTR: "Brown Trout", TGTR: "Tiger Trout", CTTR: "Cutthroat Trout", LKTR: "Lake Trout", ARGR: "Arctic Grayling", GOLD: "Golden Trout", BLTR: "Bull Trout", WALL: "Walleye" };
      for (const row of rows.slice(head + 1)) {
        if (!row || row[2] == null || !row[1]) continue;
        const sp = AB_SP[String(row[4]).trim()] || String(row[4] || "").trim();
        add(row[1], +row[2], +row[3], [`${year} planned${row[7] ? ": " + String(row[7]).trim() : ""}`, spCode(sp), +row[6] || 0, String(row[5] || "").trim()]);
        n++;
      }
      log(`  Alberta planned ${year}: ${n}`);
    }
  } catch (e) { log(`  Alberta planned: ${e.message}`); }
  return [...by.values()];
}

async function stockON() {
  const S = "https://services1.arcgis.com/TJH5KDher0W13Kgo/arcgis/rest/services/FishStockingDataForRecreationalPurposes/FeatureServer/0";
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const p = new URLSearchParams({ where: `Stocking_Year>=${since.getFullYear()}`, outFields: "Stocking_Year,Species,Official_Waterbody_Name,Unoffcial_Waterbody_Name,Developmental_Stage,Number_of_Fish_Stocked,Latitude,Longitude,Geographic_Township", f: "json", resultOffset: String(start), resultRecordCount: "1000", returnGeometry: "false", orderByFields: "ObjectId" });
    const j = await get(`${S}/query?${p}`);
    rows.push(...(j.features || []).map((f) => f.attributes));
    if (!j.features || !j.features.length || (!j.exceededTransferLimit && j.features.length < 1000)) break;
  }
  log(`  Ontario releases: ${rows.length}`);
  const by = new Map();
  for (const a of rows) {
    if (a.Latitude == null || a.Longitude == null) continue;
    const name = a.Official_Waterbody_Name || a.Unoffcial_Waterbody_Name || "Unnamed water";
    const k = `${name}|${(+a.Latitude).toFixed(3)}|${(+a.Longitude).toFixed(3)}`;
    const w = by.get(k) || by.set(k, { n: name, p: "on", c: [r4(+a.Latitude), r4(+a.Longitude)], t: title(a.Geographic_Township || ""), r: [] }).get(k);
    w.r.push([String(a.Stocking_Year), spCode(a.Species), a.Number_of_Fish_Stocked || 0, a.Developmental_Stage || ""]);
  }
  return [...by.values()];
}

async function buildStocked() {
  log("Stocked waters");
  const old = readOld("stocked.json");
  const parts = { bc: stockBC, ab: stockAB, on: stockON };
  const waters = [];
  for (const [p, fn] of Object.entries(parts)) {
    try {
      const got = await fn();
      if (!got.length) throw new Error("nothing came back");
      waters.push(...got);
    } catch (e) {
      log(`  ${p}: ${e.message}; keeping the last good data`);
      for (const w of (old?.waters || []).filter((x) => x.p === p)) waters.push({ ...w, r: w.r.map((r) => [r[0], spCode(old.sp[r[1]] || "Fish"), r[2], (old.st || [])[r[3]] || ""]) });
    }
  }
  // Newest first, the last 15 releases of each water, the size text by its place in "st".
  for (const w of waters) w.r = w.r.sort((a, b) => String(b[0]).localeCompare(String(a[0]))).slice(0, 15).map((r) => [r[0], r[1], r[2], typeof r[3] === "number" ? r[3] : stCode(r[3])]);
  save("stocked.json", { updated: iso(now), sp: SPN, st: STN, waters });
}

// ---------- zones ----------
async function buildZones() {
  log("Rules zones");
  const old = readOld("zones.json");
  const out = [];
  const keep = (k) => { const z = (old?.zones || []).filter((x) => x.k === k); log(`  ${k}: keeping ${z.length} from last time`); out.push(...z); };
  const push = (k, id, name, geom, tol, extra = {}) => {
    const g = rings(geom, tol, tol * tol * 4);
    if (!g.length) return;
    out.push({ k, id: String(id), n: name, b: bbox(g), g: encode(g), ...extra });
  };
  try {
    const regs = await databc("WHSE_ADMIN_BOUNDARIES.EADM_WLAP_REGION_BND_AREA_SVW", "REGION_NUMBER,REGION_NAME,GEOMETRY");
    for (const f of regs) push("bc", f.properties.REGION_NUMBER, f.properties.REGION_NAME, f.geometry, 0.004);
    log(`  BC regions: ${regs.length}`);
  } catch (e) { log(`  BC regions: ${e.message}`); keep("bc"); }
  try {
    const areas = await databc("WHSE_ADMIN_BOUNDARIES.DFO_PFMA_STAT_AREA_BDRY_SP", "MANAGEMENT_AREA,GEOMETRY");
    for (const f of areas) if (f.properties.MANAGEMENT_AREA) push("pfma", f.properties.MANAGEMENT_AREA, `Area ${f.properties.MANAGEMENT_AREA}`, f.geometry, 0.003);
    log(`  Pacific areas: ${areas.length}`);
  } catch (e) { log(`  Pacific areas: ${e.message}`); keep("pfma"); }
  try {
    const fmz = await arcgis("https://geospatial.alberta.ca/titan/rest/services/fisheries/fisheries_regulations/MapServer/4", ["FISHUNIT_NAME"], "1=1", 0.004);
    for (const f of fmz) push("ab", f.properties.FISHUNIT_NAME, f.properties.FISHUNIT_NAME, f.geometry, 0.004);
    log(`  Alberta zones: ${fmz.length}`);
  } catch (e) { log(`  Alberta zones: ${e.message}`); keep("ab"); }
  try {
    const fmz = await arcgis("https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open07/MapServer/14", ["FISHERIES_MANAGEMENT_ZONE_ID"], "1=1", 0.005);
    for (const f of fmz) push("on", f.properties.FISHERIES_MANAGEMENT_ZONE_ID, `Zone ${f.properties.FISHERIES_MANAGEMENT_ZONE_ID}`, f.geometry, 0.005);
    log(`  Ontario zones: ${fmz.length}`);
  } catch (e) { log(`  Ontario zones: ${e.message}`); keep("on"); }
  try {
    const QC = "https://peche.faune.gouv.qc.ca/arcgiswa/rest/services/PRODC-E/ZonesPeche/MapServer/0";
    // This server fails a query for many outlines at once: one zone per request.
    const ids = (await get(`${QC}/query?where=1%3D1&returnIdsOnly=true&f=json`)).objectIds || [];
    const z = [];
    for (const id of ids) z.push(...await arcgis(QC, ["NM_ENDRO_EN", "NM_ENDRO_FR", "VA_HYPRL_REGLE_EN", "VA_DESCR_NOUVT_EN", "VA_DOCMN_EN", ...[1, 2, 3, 4, 5].flatMap((i) => [`VA_ACTUA_${i}`, `VA_DESCR_ACTUA_${i}`, `VA_HYPRL_ACTUA_${i}`])], "1=1", 0.005, id));
    for (const f of z) {
      const a = f.properties, id = String(a.NM_ENDRO_FR || "").replace(/^Zone\s*/i, "");
      const news = [1, 2, 3, 4, 5].map((i) => a[`VA_ACTUA_${i}`] && a[`VA_DESCR_ACTUA_${i}`] ? [a[`VA_ACTUA_${i}`], a[`VA_DESCR_ACTUA_${i}`], a[`VA_HYPRL_ACTUA_${i}`] || ""] : null).filter(Boolean);
      push("qc", id, a.NM_ENDRO_EN || a.NM_ENDRO_FR, f.geometry, 0.005, { u: String(a.VA_HYPRL_REGLE_EN || "").trim(), map: a.VA_DOCMN_EN || "", nw: String(a.VA_DESCR_NOUVT_EN || "").trim(), news });
    }
    log(`  Quebec zones: ${z.length}`);
  } catch (e) { log(`  Quebec zones: ${e.message}`); keep("qc"); }
  save("zones.json", { updated: iso(now), zones: out });
}

// ---------- river gauges ----------
async function buildGauges() {
  log("River gauges");
  const API = "https://api.weather.gc.ca/collections";
  const st = [];
  try {
    for (let off = 0; ; off += 1000) {
      const j = await get(`${API}/hydrometric-stations/items?STATUS_EN=Active&REAL_TIME=1&limit=1000&offset=${off}&properties=STATION_NUMBER,STATION_NAME,PROV_TERR_STATE_LOC&f=json`);
      st.push(...j.features);
      if (j.features.length < 1000) break;
    }
  } catch (e) { log(`  stations: ${e.message}; keeping the last good file`); return; }
  log(`  stations: ${st.length}`);
  const old = new Map(((readOld("gauges.json") || {}).gauges || []).map((g) => [g[0], g]));
  const med = (a) => { if (!a.length) return null; a.sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const sig = (v) => (v == null ? null : +v.toPrecision(3));
  const out = [];
  let i = 0, failed = 0;
  async function worker() {
    while (i < st.length) {
      const f = st[i++], p = f.properties, id = p.STATION_NUMBER, [lon, lat] = f.geometry.coordinates;
      let flow = null, level = null;
      try {
        const j = await get(`${API}/hydrometric-monthly-mean/items?STATION_NUMBER=${id}&limit=3000&properties=DATE,MONTHLY_MEAN_DISCHARGE,MONTHLY_MEAN_LEVEL&f=json`, { tries: 2 });
        const q = Array.from({ length: 12 }, () => []), l = Array.from({ length: 12 }, () => []);
        for (const x of j.features || []) {
          const m = +String(x.properties.DATE).slice(5, 7) - 1; if (!(m >= 0)) continue;
          if (x.properties.MONTHLY_MEAN_DISCHARGE != null) q[m].push(x.properties.MONTHLY_MEAN_DISCHARGE);
          if (x.properties.MONTHLY_MEAN_LEVEL != null) l[m].push(x.properties.MONTHLY_MEAN_LEVEL);
        }
        if (q.some((a) => a.length >= 3)) flow = q.map((a) => (a.length >= 3 ? sig(med(a)) : null));
        if (l.some((a) => a.length >= 3)) level = l.map((a) => (a.length >= 3 ? +med(a).toFixed(3) : null));
      } catch { failed++; const o = old.get(id); if (o) { flow = o[5]; level = o[6]; } }
      out.push([id, title(p.STATION_NAME), r4(lat), r4(lon), p.PROV_TERR_STATE_LOC || "", flow, level]);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  out.sort((a, b) => a[0].localeCompare(b[0]));
  log(`  normals: ${out.filter((g) => g[5] || g[6]).length} with a usual flow or level, ${failed} failed`);
  save("gauges.json", { updated: iso(now), gauges: out });
}

// ---------- tides ----------
async function buildTides() {
  log("Tide stations");
  try {
    const st = await get("https://api-iwls.dfo-mpo.gc.ca/api/v1/stations");
    const out = st.filter((s) => (s.timeSeries || []).some((t) => t.code === "wlp-hilo")).map((s) => [s.id, s.officialName, r4(s.latitude), r4(s.longitude), s.provinceCode || ""]);
    save("tides.json", { updated: iso(now), stations: out });
  } catch (e) { log(`  tides: ${e.message}; keeping the last good file`); }
}

// ---------- safe to eat (Ontario and Quebec fish eating guides) ----------
// Rows of a CSV with quoted fields, as objects by header.
function csvRows(text, sep = ",") {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.length > 1 || row[0]) rows.push(row); row = []; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift().map((h) => h.replace(/^\uFEFF/, "").trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? "" : r[i].trim()])));
}
const EAT_SP = [], eatSp = (n) => { let i = EAT_SP.indexOf(n); if (i < 0) { i = EAT_SP.length; EAT_SP.push(n); } return i; };
// Quebec's names in English (the guide is in French)
const QC_EN = { "Grand brochet": "Northern Pike", "Doré jaune": "Walleye", "Omble de fontaine": "Brook Trout", "Touladi": "Lake Trout", "Meunier noir": "White Sucker",
  "Perchaude": "Yellow Perch", "Grand corégone": "Lake Whitefish", "Achigan": "Bass", "Barbotte brune": "Brown Bullhead", "Meunier rouge": "Longnose Sucker", "Lotte": "Burbot (Ling)",
  "Doré noir": "Sauger", "Cisco de lac": "Cisco (Lake Herring)", "Barbue de rivière": "Channel Catfish", "Omble chevalier": "Arctic Char", "Ouananiche": "Landlocked Salmon",
  "Laquaiche": "Mooneye", "Maskinongé": "Muskellunge", "Éperlan arc-en-ciel": "Rainbow Smelt", "Esturgeon jaune": "Lake Sturgeon", "Truite arc-en-ciel": "Rainbow Trout",
  "Truite brune": "Brown Trout", "Baret": "White Perch", "Brochet maillé": "Chain Pickerel", "Anguille d'Amérique": "American Eel", "Hybride Omble de fontaine et touladi": "Splake",
  "Ménomini rond": "Round Whitefish", "Carpe commune": "Common Carp", "Chevalier rouge": "Redhorse Sucker", "Tanche": "Tench", "Saumon atlantique": "Atlantic Salmon",
  "Malachigan": "Freshwater Drum", "Bar rayé": "Striped Bass", "Esturgeon noir": "Atlantic Sturgeon", "Ouitouche": "Fallfish", "Flétan du Groenland": "Greenland Halibut",
  "Morue ogac": "Greenland Cod", "Sébaste d'Acadie": "Acadian Redfish", "Poulamon atlantique": "Atlantic Tomcod", "Marigane noire": "Black Crappie", "Chevalier sp.": "Redhorse Sucker",
  "Chevalier blanc": "Redhorse Sucker", "Crapet de roche": "Rock Bass" };
const EAT_LEN = ["15-20 cm", "20-25 cm", "25-30 cm", "30-35 cm", "35-40 cm", "40-45 cm", "45-50 cm", "50-55 cm", "55-60 cm", "60-65 cm", "65-70 cm", "70-75 cm", ">75 cm"];
const EAT_MEALS = [0, 1, 2, 4, 8, 12, 16, 32];   // meals a month; Ontario's levels, coded by place ("0".."7", "." for no advice)
async function eatON() {
  const pkg = await get("https://data.ontario.ca/api/3/action/package_show?id=guide-to-eating-ontario-fish-advisory-database");
  const res = pkg.result.resources.filter((r) => /csv/i.test(r.format) && /\.csv$/i.test(r.url)).sort((a, b) => b.url.localeCompare(a.url))[0];
  if (!res) throw new Error("no CSV in the Ontario fish guide");
  const rows = csvRows((await get(res.url, { json: false })).toString("utf8"));
  const dms = (v) => { const n = Math.abs(+v); return Math.floor(n / 10000) + (Math.floor(n / 100) % 100) / 60 + (n % 100) / 3600; };
  const waters = new Map();
  for (const r of rows) {
    const id = r["Waterbody Group"]; if (!id) continue;
    let w = waters.get(id);
    if (!w) {
      const desc = (r["Guide Locdesc"] || "").split("|")[0].trim();
      w = { n: r["Guide Locname Eng"], d: desc.slice(0, 90), c: [r4(dms(r.Latitude)), r4(-dms(r.Longitude))], sp: new Map() };
      waters.set(id, w);
    }
    const sp = eatSp(r.Specname), li = EAT_LEN.indexOf(r["Length Category Label"]), lv = EAT_MEALS.indexOf(+r["Adv Level"]);
    if (li < 0 || lv < 0) continue;
    let e = w.sp.get(sp); if (!e) { e = { g: Array(13).fill("."), s: Array(13).fill("."), why: {} }; w.sp.set(sp, e); }
    (r["Population Type Desc"] === "Sensitive" ? e.s : e.g)[li] = String(lv);
    for (const k of (r["Adv Cause Multiple Name"] || "").split(/,\s*/)) if (k) e.why[k] = 1;
  }
  const trim = (a) => a.join("").replace(/\.+$/, "");
  const out = [...waters.values()].filter((w) => isFinite(w.c[0]) && w.c[0] > 40).map((w) => {
    const o = { n: w.n, c: w.c, f: [...w.sp.entries()].map(([sp, e]) => [sp, trim(e.g), trim(e.s), Object.keys(e.why).join(", ")]) };
    if (w.d) o.d = w.d;
    return o;
  });
  log(`  Ontario: ${out.length} lakes and rivers (${res.name || res.url.split("/").pop()})`);
  return { waters: out, from: res.url };
}
async function eatQC() {
  const pkg = await get("https://www.donneesquebec.ca/recherche/api/3/action/package_show?id=e9a065a3-977a-479a-b935-dbfcd78347b6");
  const res = pkg.result.resources.find((r) => /csv/i.test(r.format));
  if (!res) throw new Error("no CSV in the Quebec fish guide");
  const files = await unzip(await get(res.url, { json: false }));
  const name = Object.keys(files).find((n) => /\.csv$/i.test(n));
  const rows = csvRows(files[name].toString("utf8"), ";");
  const waters = new Map(), num = (v) => (v === "" || v == null ? null : +v);
  for (const r of rows) {
    const id = r.NO_BQMA; if (!id) continue;
    let w = waters.get(id);
    if (!w) {   // "Sept Îles, Lac des" -> "Lac des Sept Îles"
      const m = r.HYDRONYME.match(/^(.*), ((?:Lac|Rivière|Réservoir|Fleuve|Petit lac|Grand lac|Étang|Ruisseau|Baie|Bassin)[^,]*)$/i);
      w = { n: m ? `${m[2]}${/'$/.test(m[2]) ? "" : " "}${m[1]}` : r.HYDRONYME, c: [r4(+r.LATITUDE), r4(+r.LONGITUDE)], f: [] };
      waters.set(id, w);
    }
    const en = QC_EN[r.NOM_COMMUN] || r.NOM_COMMUN;
    const e = [eatSp(en), [num(r.P_NB_REPAS), num(r.M_NB_REPAS), num(r.G_NB_REPAS)], [num(r.P_TAILLE_MIN_CM), num(r.M_TAILLE_MIN_CM), num(r.G_TAILLE_MIN_CM)], +r.AVERTISSEMENT || 0];
    if (/interdite/i.test(r.STATUT_PECHE)) e.push(1);
    w.f.push(e);
  }
  const out = [...waters.values()].filter((w) => isFinite(w.c[0]) && w.c[0] > 40);
  log(`  Quebec: ${out.length} lakes and rivers`);
  return { waters: out, from: res.url };
}
async function buildEat() {
  log("Safe to eat");
  const old = readOld("eat.json");
  let on, qc;
  try { on = await eatON(); } catch (e) { log(`  Ontario: ${e.message}; keeping the last good data`); }
  try { qc = await eatQC(); } catch (e) { log(`  Quebec: ${e.message}; keeping the last good data`); }
  if (!on && !qc && old) return;
  // a province that failed keeps its old waters, named with the old species list
  const keep = (w) => (old ? old[w].map((x) => ({ ...x, f: x.f.map((e) => [eatSp(old.sp[e[0]]), ...e.slice(1)]) })) : []);
  save("eat.json", { updated: iso(now), len: EAT_LEN, meals: EAT_MEALS, sp: EAT_SP, on: on ? on.waters : keep("on"), qc: qc ? qc.waters : keep("qc") });
}

// ---------- public fishing spots ----------
const INDEX_HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const OVERPASS = process.env.OVERPASS_URLS ? process.env.OVERPASS_URLS.split(",") : JSON.parse(INDEX_HTML.match(/const OVERPASS = (\[[^\]]+\]);/)[1]);
async function overpass(q) {
  let last;
  for (let round = 0; round < 2; round++) for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(660000) });
      const t = await r.text();
      if (!r.ok || !t.startsWith("{")) throw new Error(`HTTP ${r.status}: ${t.slice(0, 160).replace(/\s+/g, " ")}`);
      const j = JSON.parse(t);
      if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) throw new Error(j.remark.slice(0, 160));
      return j.elements || [];
    } catch (e) { last = e; log(`    ${url}: ${String(e.message).slice(0, 140)}`); await sleep(20000); }
  }
  throw last;
}
async function buildSpots() {
  log("Fishing spots");
  const old = readOld("spots.json");
  const out = new Map(), facts = (t) => [t.fee === "yes" ? "fee" : t.fee === "no" ? "free" : "", t.trailer === "yes" ? "trailers" : "", t.parking ? "parking" : "", t.surface && /concrete|asphalt|gravel|paved/.test(t.surface) ? t.surface : "", t.access === "private" || t.access === "customers" || t.access === "members" ? "private" : ""].filter(Boolean).join(", ");
  let osmOk = false;
  try {
    // One kind at a time, for all of Canada (a big query is more likely to time out).
    const parts = [['nwr["leisure"="fishing"]', 0], ['nwr["fishing"~"^(yes|designated)$"]["leisure"!="fishing"]', 0], ['nwr["leisure"="slipway"]', 2]];
    for (const [sel, kind] of parts) {
      const els = await overpass(`[out:json][timeout:600];area["ISO3166-1"="CA"][admin_level=2]->.ca;(${sel}(area.ca););out center tags;`);
      for (const el of els) {
        const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon, t = el.tags || {};
        if (lat == null || t.access === "no") continue;
        const k = kind === 2 ? 2 : t.man_made === "pier" || /pier|dock|wharf/i.test(t.fishing || "") ? 1 : 0;
        out.set(`o${el.type[0]}${el.id}`, [r4(lat), r4(lon), k, (t.name || "").slice(0, 60), facts(t)]);
      }
      log(`  OpenStreetMap ${sel}: ${els.length}`);
    }
    osmOk = true;
  } catch (e) { log(`  OpenStreetMap: ${e.message}; keeping the last good spots`); }
  if (!osmOk && old) for (const x of old.spots) if (x[5] !== "on") out.set(`old${x[0]},${x[1]}`, x.slice(0, 5));
  try {
    const LIO15 = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open07/MapServer/15/query";
    let n = 0;
    for (let off = 0; ; off += 1000) {
      const j = await get(`${LIO15}?${new URLSearchParams({ where: "1=1", outFields: "FISHING_ACCESS_POINT_TYPE,SITE_NAME,PARKING_PRESENCE_FLG,ACCESSIBILITY_FLG,USER_FEE_FLG", outSR: "4326", f: "json", resultOffset: String(off), resultRecordCount: "1000", orderByFields: "OBJECTID" })}`);
      for (const f of j.features || []) {
        const a = f.attributes, g = f.geometry; if (!g) continue;
        const k = /launch/i.test(a.FISHING_ACCESS_POINT_TYPE || "") ? 2 : 0;
        const fx = [a.FISHING_ACCESS_POINT_TYPE && !/launch/i.test(a.FISHING_ACCESS_POINT_TYPE) ? a.FISHING_ACCESS_POINT_TYPE.toLowerCase() : "", a.PARKING_PRESENCE_FLG === "Y" ? "parking" : "", a.ACCESSIBILITY_FLG === "Y" ? "accessible" : "", a.USER_FEE_FLG === "Y" ? "fee" : a.USER_FEE_FLG === "N" ? "free" : ""].filter(Boolean).join(", ");
        // the same place in both: Ontario's says more
        for (const [key, x] of out) if (x[2] === k && Math.abs(x[0] - g.y) < 0.0008 && Math.abs(x[1] - g.x) < 0.0011) out.delete(key);
        out.set(`on${a.SITE_NAME}|${g.y.toFixed(4)}`, [r4(g.y), r4(g.x), k, String(a.SITE_NAME || "").slice(0, 60), fx, "on"]);
        n++;
      }
      if (!j.exceededTransferLimit && (j.features || []).length < 1000) break;
    }
    log(`  Ontario access points: ${n}`);
  } catch (e) {
    log(`  Ontario: ${e.message}; keeping the last good access points`);
    if (old) for (const x of old.spots) if (x[5] === "on") out.set(`old${x[0]},${x[1]}`, x);
  }
  if (!out.size) { log("  no spots: keeping the last good file"); return; }
  const spots = [...out.values()].map((x) => { while (x.length > 3 && !x[x.length - 1]) x.pop(); return x; }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  save("spots.json", { updated: iso(now), spots });
}

if (!ONLY || ONLY === "stocked") await buildStocked();
if (!ONLY || ONLY === "zones") await buildZones();
if (!ONLY || ONLY === "tides") await buildTides();
if (!ONLY || ONLY === "gauges") await buildGauges();
if (!ONLY || ONLY === "eat") await buildEat();
if (!ONLY || ONLY === "spots") await buildSpots();
