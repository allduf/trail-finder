// Official (sanctioned) trails from government open data, for the "Official" badge across Canada.
// Every week: download each source's trail lines, keep the ones that say whether bikes are allowed, simplify them, and
// write them in half-degree squares to data/official/<lat>_<lon>.json (south-west corner, e.g. 43.5_-80), plus
// data/official/index.json (squares and their sizes, sources).
// The website (official.js) matches OpenStreetMap trails to these lines by shape.
//
// Each line: [status, source, name, note, g], g = the points in 1e-5 degrees (~1 m): lat, lon of the first point, then
// the difference to the previous point (dlat, dlon, dlat, dlon...), which keeps the files small. Status:
//   1 = official trail, bikes allowed      -> "Official" badge
//   2 = official trail, bike use not given  -> "Official" badge only on trails already tagged for MTB
//   3 = official trail, listed for other uses but not bikes -> warning in the trail details (note = the uses)
// Sources (all open licences, attribution in index.json):
//   on  Ontario Trail Network (OGL-Ontario): PERMITTED_USES with "Cycling" -> 1, hiking/walking without cycling -> 3
//   qc  Sépaq summer trails (CC BY 4.0): Usager "Vélo de montagne", "Vélo", "Piste cyclable" -> 1, "Pédestre" -> 3
//       (bikes are allowed only on designated trails in Sépaq parks)
//   bc  Recreation Sites and Trails BC (OGL-BC): active trail lines; "Mountain Biking" among the activities -> 1, else 2
//   ab  Alberta designated and provincial trails (OGL-Alberta) -> 2 (no uses in the data)
//   pc  Parks Canada trails (OGL-Canada): Official_Officiel = 1 -> 2, or 1 when the comment says Bike
//   ott City of Ottawa mountain bike trails (OGL-Ottawa) -> 1
import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";

const OUT = "data/official";
const UA = { "User-Agent": "trail-finder (github.com/allduf/trail-finder)" };

const SOURCES = {
  on: { name: "Ontario Trails (Ontario Trail Network)", licence: "Open Government Licence – Ontario", url: "https://data.ontario.ca/dataset/ontario-trail-network" },
  qc: { name: "Sépaq", licence: "CC BY 4.0", url: "https://www.donneesquebec.ca/recherche/dataset/sentiers-estivaux" },
  bc: { name: "Recreation Sites and Trails BC", licence: "Open Government Licence – British Columbia", url: "https://catalogue.data.gov.bc.ca/dataset/recreation-line" },
  ab: { name: "Alberta designated trails", licence: "Open Government Licence – Alberta", url: "https://open.alberta.ca/opendata/gda-97415cb9-1a6f-4886-9212-d91097c9a23e" },
  pc: { name: "Parks Canada", licence: "Open Government Licence – Canada", url: "https://open.canada.ca/data/en/dataset/64a90e8d-5bc0-4027-8645-b5881b4068d4" },
  ott: { name: "City of Ottawa", licence: "Open Government Licence – City of Ottawa", url: "https://open.ottawa.ca/" },
};

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url.slice(0, 120)}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 5000 * i));
    }
  }
}

// An ArcGIS layer, all features, in lat/lon: [{ a: attributes, paths: [[[lon, lat], ...], ...] }].
async function arcgis(layer, fields, where = "1=1") {
  const out = [];
  for (let offset = 0; ; ) {
    const q = `${layer}/query?where=${encodeURIComponent(where)}&outFields=${fields}&outSR=4326&returnGeometry=true&f=json&resultOffset=${offset}&resultRecordCount=1000&orderByFields=OBJECTID`;
    const j = await get(q);
    if (j.error) throw new Error(`${layer}: ${JSON.stringify(j.error).slice(0, 200)}`);
    const fs = j.features || [];
    fs.forEach((f) => f.geometry && f.geometry.paths && out.push({ a: f.attributes, paths: f.geometry.paths }));
    offset += fs.length;
    if (!fs.length || !j.exceededTransferLimit && fs.length < 1000) break;
  }
  return out;
}

// EPSG:32198 (NAD83 / Québec Lambert) to lat/lon. Lambert conformal conic, 2 standard parallels, GRS80.
function lambertQc(x, y) {
  const a = 6378137, f = 1 / 298.257222101, e = Math.sqrt(2 * f - f * f), rad = Math.PI / 180;
  const p1 = 60 * rad, p2 = 46 * rad, p0 = 44 * rad, l0 = -68.5 * rad;
  const m = (p) => Math.cos(p) / Math.sqrt(1 - e * e * Math.sin(p) ** 2);
  const t = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2);
  const n = (Math.log(m(p1)) - Math.log(m(p2))) / (Math.log(t(p1)) - Math.log(t(p2)));
  const F = m(p1) / (n * t(p1) ** n), r0 = a * F * t(p0) ** n;
  const r = Math.sign(n) * Math.hypot(x, r0 - y), th = Math.atan2(x, r0 - y), tt = (r / (a * F)) ** (1 / n);
  let p = Math.PI / 2 - 2 * Math.atan(tt);
  for (let i = 0; i < 10; i++) p = Math.PI / 2 - 2 * Math.atan(tt * ((1 - e * Math.sin(p)) / (1 + e * Math.sin(p))) ** (e / 2));
  return [p / rad, (th / n + l0) / rad];
}

// Douglas-Peucker in metres (local flat approximation): keeps the shape within ~6 m.
function simplify(pts, tol = 6) {
  if (pts.length < 3) return pts;
  const k = Math.cos(pts[0][0] * Math.PI / 180) * 111320, K = 110540;
  const xy = pts.map(([la, lo]) => [lo * k, la * K]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop(); let best = -1, bd = tol;
    const [ax, ay] = xy[i], [bx, by] = xy[j], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    for (let q = i + 1; q < j; q++) {
      const [px, py] = xy[q]; let u = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; u = Math.max(0, Math.min(1, u));
      const d = Math.hypot(px - ax - u * dx, py - ay - u * dy);
      if (d > bd) { bd = d; best = q; }
    }
    if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, q) => keep[q]);
}

const lines = [];   // [status, src, name, note, [[lat, lon], ...]]
const counts = {};
function add(status, src, name, note, path) {
  const pts = simplify(path.filter((p) => isFinite(p[0]) && isFinite(p[1])));
  if (pts.length < 2) return;
  lines.push([status, src, (name || "").trim(), (note || "").trim(), pts]);
  const c = counts[src] || (counts[src] = { 1: 0, 2: 0, 3: 0 }); c[status]++;
}
const lonlat = (path) => path.map(([lon, lat]) => [lat, lon]);

const jobs = {
  async on() {
    const fs = await arcgis("https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open04/MapServer/19",
      "OBJECTID,TRAIL_NAME,TRAIL_ASSOCIATION,PERMITTED_USES,ON_ROAD_FLG");
    for (const { a, paths } of fs) {
      if (a.ON_ROAD_FLG === "Yes") continue;   // the trail runs on a road there
      const uses = a.PERMITTED_USES || "";
      const status = /cycling/i.test(uses) ? 1 : /hiking|walking/i.test(uses) ? 3 : 0;   // portage, ski-only, ATV...: left out
      if (!status) continue;
      const note = status === 3 ? uses.replace(/Hiking or Walking/i, "hiking").toLowerCase() : a.TRAIL_ASSOCIATION || "";
      paths.forEach((p) => add(status, "on", a.TRAIL_NAME, status === 1 ? a.TRAIL_ASSOCIATION : note, lonlat(p)));
    }
  },
  async qc() {
    const j = await get("https://www.donneesquebec.ca/recherche/dataset/f5c2e540-4416-4e90-9520-7837b8e31346/resource/81d32e61-16b8-4ccd-a0c4-c34e220e4420/download/sentieretel.json");
    const crs = JSON.stringify(j.crs || "");
    if (!/32198/.test(crs)) throw new Error(`Sépaq: unexpected coordinate system ${crs}`);
    for (const f of j.features) {
      const p = f.properties, uses = [p.Usager, p.Usager_2, p.Usager_3].filter((u) => u && u.trim());
      const status = uses.some((u) => /vélo|cyclable|bicyclette/i.test(u)) ? 1 : uses.some((u) => /^pédestre/i.test(u)) ? 3 : 0;
      if (!status || p.Etat !== "Existant") continue;
      const g = f.geometry; if (!g) continue;
      const parts = g.type === "MultiLineString" ? g.coordinates : g.type === "LineString" ? [g.coordinates] : [];
      const name = [p.Toponyme1, p.Toponyme2].map((s) => (s || "").trim()).find((s) => s && s !== "S.I.A.") || "";
      const park = `${p.Reseau === "Parc national" ? "parc national " : ""}${p.Nom_etab || ""}`.trim();
      parts.forEach((c) => add(status, "qc", name, status === 3 ? "hiking" : park, c.map(([x, y]) => lambertQc(x, y))));
    }
  },
  async bc() {
    const wfs = "https://openmaps.gov.bc.ca/geo/pub/wfs?service=WFS&version=2.0.0&request=GetFeature&outputFormat=json&srsName=EPSG:4326&typeName=";
    const acts = new Map();   // forest file id -> activity names
    for (let start = 0; ; start += 5000) {
      const t = await get(`${wfs}pub:WHSE_FOREST_TENURE.FTEN_REC_TRAILS_SVW&count=5000&startIndex=${start}&sortBy=FOREST_FILE_ID`);
      t.features.forEach((f) => { const p = f.properties; acts.set(p.FOREST_FILE_ID, Object.keys(p).filter((k) => /^ACTIVITY_DESC\d+$/.test(k)).map((k) => p[k]).filter(Boolean)); });
      if (t.features.length < 5000) break;
    }
    for (let start = 0; ; start += 5000) {
      const j = await get(`${wfs}pub:WHSE_FOREST_TENURE.FTEN_RECREATION_LINES_SVW&count=5000&startIndex=${start}&sortBy=OBJECTID`
        + "&propertyName=FOREST_FILE_ID,PROJECT_NAME,LIFE_CYCLE_STATUS_CODE,RETIREMENT_DATE,GEOMETRY");
      for (const f of j.features) {
        const p = f.properties, g = f.geometry;
        if (p.LIFE_CYCLE_STATUS_CODE !== "ACTIVE" || p.RETIREMENT_DATE || !g) continue;
        const a = acts.get(p.FOREST_FILE_ID) || [];
        const status = a.some((x) => /mountain biking/i.test(x)) ? 1 : 2;
        const parts = g.type === "MultiLineString" ? g.coordinates : g.type === "LineString" ? [g.coordinates] : [];
        const name = (p.PROJECT_NAME || "").replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase());   // names come in capitals
        parts.forEach((c) => add(status, "bc", name, p.FOREST_FILE_ID, lonlat(c)));
      }
      if (j.features.length < 5000) break;
    }
  },
  async ab() {
    const fs = await arcgis("https://geospatial.alberta.ca/mimas/rest/services/recreation/alberta_designated_and_provincial_trails/MapServer/1", "OBJECTID,name,designation");
    for (const { a, paths } of fs) paths.forEach((p) => add(2, "ab", a.name, a.designation === "designatedProv" ? "provincial trail" : "", lonlat(p)));
  },
  async pc() {
    const fs = await arcgis("https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Trails_Sentiers_APCA_V2_FGP/FeatureServer/0",
      "OBJECTID,Name_Official_e,Label_e_5k_less,Official_Officiel,Comments_Commentaires", "Official_Officiel=1");
    for (const { a, paths } of fs) {
      const status = /\bbike\b|\bbiking\b|cycl/i.test(a.Comments_Commentaires || "") ? 1 : 2;
      paths.forEach((p) => add(status, "pc", a.Label_e_5k_less || a.Name_Official_e, "", lonlat(p)));
    }
  },
  async ott() {
    const fs = await arcgis("https://maps.ottawa.ca/arcgis/rest/services/CyclingMap/MapServer/17", "OBJECTID,TRAILNAME_EN,DATA_SOURCE");
    for (const { a, paths } of fs) paths.forEach((p) => add(1, "ott", a.TRAILNAME_EN, a.DATA_SOURCE || "", lonlat(p)));
  },
};

const failed = [];
for (const [id, job] of Object.entries(jobs)) {
  const t0 = Date.now();
  try { await job(); console.log(`${id}: ${JSON.stringify(counts[id] || {})} in ${((Date.now() - t0) / 1000).toFixed(0)} s`); }
  catch (e) { failed.push(id); console.log(`${id}: FAILED ${e.message}`); }
}
if (failed.length === Object.keys(jobs).length) { console.log("Every source failed; keeping the old files."); process.exit(1); }

// Squares: a line goes in every half-degree square its points touch (and the squares next to a point near the edge).
const sq = (v) => Math.floor(v * 2) / 2;
const squares = new Map();
for (const [status, src, name, note, pts] of lines) {
  const keys = new Set();
  for (const [la, lo] of pts) for (const dl of [-0.002, 0.002]) for (const dn of [-0.003, 0.003]) keys.add(`${sq(la + dl)}_${sq(lo + dn)}`);
  const flat = [];
  let pa = 0, po = 0;
  for (const [la, lo] of pts) { const a = Math.round(la * 1e5), o = Math.round(lo * 1e5); flat.push(a - pa, o - po); pa = a; po = o; }
  for (const k of keys) { if (!squares.has(k)) squares.set(k, []); squares.get(k).push([status, src, name, note, flat]); }
}

// A source that failed this week keeps its lines from the published files (read back from the site).
if (failed.length) {
  const old = await get("https://allduf.github.io/trail-finder/data/official/index.json").catch(() => null);
  for (const k of Object.keys((old && old.squares) || {})) {
    const f = await get(`https://allduf.github.io/trail-finder/data/official/${k}.json`).catch(() => null);
    const keep = ((f && f.lines) || []).filter((l) => failed.includes(l[1]));
    if (keep.length) { if (!squares.has(k)) squares.set(k, []); squares.get(k).push(...keep); }
  }
  console.log(`Kept last week's lines for ${failed.join(", ")}.`);
}

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) unlinkSync(`${OUT}/${f}`);
const builtAt = new Date().toISOString(), index = { v: 2, builtAt, size: 0.5, sources: SOURCES, squares: {} };
let total = 0;
for (const [k, ls] of [...squares].sort()) {
  const body = JSON.stringify({ v: 2, builtAt, lines: ls });
  writeFileSync(`${OUT}/${k}.json`, body);
  index.squares[k] = body.length; total += body.length;
}
writeFileSync(`${OUT}/index.json`, JSON.stringify(index));
console.log(`${lines.length} lines in ${squares.size} squares, ${(total / 1e6).toFixed(1)} MB${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
