// Difficulty for trails that have no MTB rating on OpenStreetMap (no mtb:scale or mtb:scale:imba), which the site
// otherwise draws grey "Not rated". alex: "find other sources every time there is a trail Not rated".
// Trailforks has ratings for most of them, but its terms don't allow copying them, so the ratings come from:
//
// 1. Official open data that rates bike trails, written as lines in half-degree squares to data/ratings/<lat>_<lon>.json
//    plus data/ratings/index.json, like data/official/ (ratings.js matches OpenStreetMap trails to them by shape):
//      qc  Sépaq summer trails (CC BY 4.0): Niv_diff of the bike trails
//      ott City of Ottawa mountain bike trails (OGL-Ottawa): DIFFICULTY_EN
//      ut  Utah trails and pathways (UGRC, CC BY 4.0): BikeDifficulty
//      pa  Pennsylvania state park trails (public): Difficulty, on trails where mountain bikes are promoted or permitted
//          (their rating is for every trail user, not only bikes; the site says so)
//    BC and Alberta have no open data with an MTB difficulty (Recreation Sites and Trails BC only has a few
//    descriptions in free text), so near alex this part finds nothing.
// 2. For the unrated ways of the all-trails lists (data/mtb-<zone>.json), data/ratings/osm.json:
//      same  another piece of the same named trail, joined to this one, is rated on OpenStreetMap
//      est   an estimate from the slope (AWS Terrain Tiles, the elevation the 3D view already uses) and a few map tags.
//            Checked against the rated trails of the region (CALIBRATE=1): the exact level 54% of the time,
//            within one level 96% (4,300 trails, 2026-10-16). The site always shows it as "Estimated", never as a rating.
//    Each way: [level, kind, note, shape hash]. level: green, blue, black, dbl. Estimates are kept while the shape is unchanged.
//
// Run: node scripts/build-ratings.mjs   (Node 18 or newer, no packages)
//   ONLY=osm or ONLY=lines runs one part. CALIBRATE=1 fits the estimate's thresholds on the rated trails and prints its accuracy.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";

const OUT = "data/ratings";
const UA = { "User-Agent": "trail-finder (github.com/allduf/trail-finder)" };
const ONLY = process.env.ONLY || "";
const LEVELS = ["green", "blue", "black", "dbl"];

async function get(url, tries = 3, as = "json") {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return as === "json" ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (i >= tries) throw new Error(`${url.slice(0, 120)}: ${e.message}`);
      await new Promise((res) => setTimeout(res, 3000 * i));
    }
  }
}

// ---------- the slope estimate (same numbers as estimate() in ratings.js: change both together) ----------
// Elevation every 10 m along the trail; grades over 30 m stretches. score = 0.3 median grade + 0.3 steepest-10% grade
// + 0.2 overall drop per metre + 0.2 climbing and descending per metre, plus tag hints; then cut into levels.
export const EST = { w: [0.3, 0.3, 0.2, 0.2], cuts: [0.055, 0.175, 0.31] };
export function tagHint(t) {
  let a = 0;
  if (/demanding|alpine/.test(t.sac_scale || "")) a += 0.04;                        // T3 and up hiking scale
  if (/^(bad|horrible|no)$/.test(t.trail_visibility || "")) a += 0.02;
  if (/very_bad|horrible|impassable/.test(t.smoothness || "")) a += 0.04;
  if (/^(gravel|fine_gravel|compacted|asphalt|paved|concrete)$/.test(t.surface || "")) a -= 0.04;
  if (parseFloat(t.width) >= 2) a -= 0.03;
  return a;
}
export function slopeStats(z) {   // z: elevations every 10 m
  const g = [];
  for (let i = 0; i + 3 < z.length; i++) g.push(Math.abs(z[i + 3] - z[i]) / 30);
  g.sort((a, b) => a - b);
  const q = (p) => g[Math.min(g.length - 1, Math.floor(p * g.length))];
  let move = 0;
  for (let i = 1; i < z.length; i++) move += Math.abs(z[i] - z[i - 1]);
  const len = (z.length - 1) * 10;
  return { p50: q(0.5), p90: q(0.9), avg: Math.abs(z[z.length - 1] - z[0]) / len, relief: move / len };
}
export const estScore = (s, tags) => EST.w[0] * s.p50 + EST.w[1] * s.p90 + EST.w[2] * s.avg + EST.w[3] * s.relief + tagHint(tags || {});
export const estLevel = (v) => LEVELS[v < EST.cuts[0] ? 0 : v < EST.cuts[1] ? 1 : v < EST.cuts[2] ? 2 : 3];

// Points every 10 m along a flat [lat, lon, lat, lon...] shape (null when shorter than 60 m).
const metres = (a, b, c, d) => Math.hypot((c - a) * 110540, (d - b) * 111320 * Math.cos(a * Math.PI / 180));
function every10m(g) {
  const out = [[g[0], g[1]]];
  let carry = 0;
  for (let i = 2; i < g.length; i += 2) {
    const a = g[i - 2], b = g[i - 1], c = g[i], d = g[i + 1], L = metres(a, b, c, d);
    let t = 10 - carry;
    for (; t <= L; t += 10) out.push([a + (c - a) * t / L, b + (d - b) * t / L]);
    carry = L - (t - 10);
  }
  return out.length >= 7 ? out : null;
}

// Terrarium PNG tiles (8-bit RGB): a small decoder, so no packages are needed.
function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 2;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[o + x - bpp] : 0, b = y ? px[o - stride + x] : 0, c = x >= bpp && y ? px[o - stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + x] = v & 255;
    }
  }
  const e = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) e[i] = px[i * bpp] * 256 + px[i * bpp + 1] + px[i * bpp + 2] / 256 - 32768;
  return { w, e };
}
const Z = 14, tiles = new Map();
const tile = (x, y) => {
  const k = x + "/" + y;
  if (!tiles.has(k)) tiles.set(k, get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`, 3, "buf").then(decodePng));
  return tiles.get(k);
};
async function elevation(la, lo) {
  const n = 2 ** Z, fx = (lo + 180) / 360 * n, fy = (1 - Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360)) / Math.PI) / 2 * n;
  const x = Math.floor(fx), y = Math.floor(fy), t = await tile(x, y), W = t.w;
  const px = (fx - x) * W - 0.5, py = (fy - y) * W - 0.5;
  const x0 = Math.max(0, Math.min(W - 2, Math.floor(px))), y0 = Math.max(0, Math.min(W - 2, Math.floor(py)));
  const u = Math.max(0, Math.min(1, px - x0)), v = Math.max(0, Math.min(1, py - y0)), E = (i, j) => t.e[j * W + i];
  return E(x0, y0) * (1 - u) * (1 - v) + E(x0 + 1, y0) * u * (1 - v) + E(x0, y0 + 1) * (1 - u) * v + E(x0 + 1, y0 + 1) * u * v;
}
async function slopeOf(g) {
  const pts = every10m(g);
  if (!pts) return null;
  const z = [];
  for (const [la, lo] of pts) z.push(await elevation(la, lo));
  return slopeStats(z);
}

// ---------- OpenStreetMap ratings ----------
function osmLevel(t) {
  const imba = parseFloat(t["mtb:scale:imba"]), sts = parseInt(t["mtb:scale"], 10);
  if (!isNaN(imba)) return imba < 2 ? "green" : imba < 3 ? "blue" : imba < 4 ? "black" : "dbl";
  if (!isNaN(sts)) return sts <= 1 ? "green" : sts === 2 ? "blue" : sts === 3 ? "black" : "dbl";
  return null;
}
const TRAILISH = /^(path|bridleway|footway|cycleway|track)$/;
const hash = (g) => { let h = 0; for (const v of g) h = (h * 31 + Math.round(v * 1e5)) | 0; return (h >>> 0).toString(36); };
const zoneFiles = () => readdirSync("data").filter((f) => /^mtb-\w+\.json$/.test(f)).sort();

async function buildOsm() {
  const old = (existsSync(`${OUT}/osm.json`) && JSON.parse(readFileSync(`${OUT}/osm.json`, "utf8")).ways) || {};
  const ways = {}, count = { same: 0, est: 0, kept: 0, none: 0 };
  for (const f of zoneFiles()) {
    const j = JSON.parse(readFileSync(`data/${f}`, "utf8"));
    const all = Object.entries(j.ways || {}).filter(([, w]) => TRAILISH.test(w.tags.highway || "") && w.g && w.g.length >= 4);
    // Ends of the rated pieces of each named trail, to find the piece joined to an unrated one.
    const rated = new Map();
    for (const [, w] of all) {
      const d = osmLevel(w.tags), name = w.tags.name;
      if (!d || !name) continue;
      if (!rated.has(name)) rated.set(name, []);
      rated.get(name).push({ d, ends: [[w.g[0], w.g[1]], [w.g[w.g.length - 2], w.g[w.g.length - 1]]] });
    }
    for (const [id, w] of all) {
      if (osmLevel(w.tags)) continue;
      const h = hash(w.g), name = w.tags.name;
      const ends = [[w.g[0], w.g[1]], [w.g[w.g.length - 2], w.g[w.g.length - 1]]];
      const joined = (rated.get(name) || []).filter((r) => r.ends.some((p) => ends.some((q) => metres(p[0], p[1], q[0], q[1]) < 30)));
      if (joined.length) {
        // Pieces either side rated differently: the harder one, to be safe.
        const d = LEVELS[Math.max(...joined.map((r) => LEVELS.indexOf(r.d)))];
        ways[id] = [d, "same", name, h]; count.same++;
        continue;
      }
      if (old[id] && old[id][1] === "est" && old[id][3] === h) { ways[id] = old[id]; count.kept++; continue; }
      const s = await slopeOf(w.g).catch((e) => { console.log(`way ${id}: ${e.message}`); return null; });
      if (!s) { count.none++; continue; }
      ways[id] = [estLevel(estScore(s, w.tags)), "est", `${Math.round(s.p90 * 100)},${Math.round(s.avg * 100)}`, h]; count.est++;
    }
    console.log(`${f}: ${Object.keys(ways).length} so far`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/osm.json`, JSON.stringify({ v: 1, builtAt: new Date().toISOString(), ways }));
  console.log(`OpenStreetMap: ${count.same} from the same trail, ${count.est} new estimates, ${count.kept} kept, ${count.none} too short`);
}

// CALIBRATE=1: leave one zone out, fit the cuts on the others, and count how often the estimate matches the real rating.
async function calibrate() {
  const rows = [];
  for (const f of zoneFiles()) {
    const j = JSON.parse(readFileSync(`data/${f}`, "utf8"));
    for (const [, w] of Object.entries(j.ways || {})) {
      const d = osmLevel(w.tags);
      if (!d || !/^(path|bridleway|footway)$/.test(w.tags.highway || "")) continue;
      const s = await slopeOf(w.g).catch(() => null);
      if (s) rows.push({ z: f, d: LEVELS.indexOf(d), v: estScore(s, w.tags) });
    }
    console.log(`${f}: ${rows.length} rated trails`);
  }
  const grid = []; for (let x = 0.02; x < 0.6; x += 0.005) grid.push(+x.toFixed(3));
  const lvl = (v, c) => (v < c[0] ? 0 : v < c[1] ? 1 : v < c[2] ? 2 : 3);
  const fit = (rs) => {
    let best = null;
    for (const a of grid) for (const b of grid) if (b > a) for (const c of grid) if (c > b) {
      let ok = 0; for (const r of rs) if (lvl(r.v, [a, b, c]) === r.d) ok++;
      if (!best || ok > best.ok) best = { ok, cuts: [a, b, c] };
    }
    return best.cuts;
  };
  let ok = 0, near = 0;
  for (const z of new Set(rows.map((r) => r.z))) {
    const cuts = fit(rows.filter((r) => r.z !== z));
    for (const r of rows.filter((r) => r.z === z)) { const p = lvl(r.v, cuts); if (p === r.d) ok++; if (Math.abs(p - r.d) <= 1) near++; }
  }
  console.log(`${rows.length} rated trails. Exact level ${(ok / rows.length * 100).toFixed(1)}%, within one level ${(near / rows.length * 100).toFixed(1)}%`);
  console.log(`Cuts fitted on all of them: ${JSON.stringify(fit(rows))} (now ${JSON.stringify(EST.cuts)})`);
}

// ---------- official ratings ----------
const SOURCES = {
  qc: { name: "Sépaq", licence: "CC BY 4.0", url: "https://www.donneesquebec.ca/recherche/dataset/sentiers-estivaux" },
  ott: { name: "City of Ottawa", licence: "Open Government Licence – City of Ottawa", url: "https://open.ottawa.ca/" },
  ut: { name: "Utah Geospatial Resource Center", licence: "CC BY 4.0", url: "https://gis.utah.gov/products/sgid/recreation/trails-pathways" },
  pa: { name: "Pennsylvania DCNR state parks", licence: "Public", url: "https://gis.dcnr.pa.gov/" },
};
async function arcgis(layer, fields, where = "1=1") {
  const out = [];
  for (let offset = 0; ; ) {
    const j = await get(`${layer}/query?where=${encodeURIComponent(where)}&outFields=${fields}&outSR=4326&returnGeometry=true&f=json&resultOffset=${offset}&resultRecordCount=1000&orderByFields=OBJECTID`);
    if (j.error) throw new Error(`${layer}: ${JSON.stringify(j.error).slice(0, 200)}`);
    const fs = j.features || [];
    fs.forEach((f) => f.geometry && f.geometry.paths && out.push({ a: f.attributes, paths: f.geometry.paths }));
    offset += fs.length;
    if (!fs.length || !j.exceededTransferLimit && fs.length < 1000) break;
  }
  return out;
}
// EPSG:32198 (Québec Lambert) to lat/lon, as in build-official.mjs.
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
const lonlat = (path) => path.map(([lon, lat]) => [lat, lon]);
const levelOfWords = (s) => {
  s = (s || "").toLowerCase();
  if (/très difficile|expert|extreme|extrême|double/.test(s)) return "dbl";
  if (/most difficult|difficile|difficult|advanced|hard|black/.test(s) && !/more difficult/.test(s)) return "black";
  if (/intermédiaire|intermediate|more difficult|moderate|blue/.test(s)) return "blue";
  if (/facile|easy|easiest|begin|green/.test(s)) return "green";
  return null;
};

async function buildLines() {
  const lines = [], counts = {};
  const add = (d, src, name, note, pts) => {
    pts = pts.filter((p) => isFinite(p[0]) && isFinite(p[1]));
    if (!d || pts.length < 2) return;
    lines.push([d, src, (name || "").trim(), (note || "").trim(), pts]);
    const c = counts[src] || (counts[src] = {}); c[d] = (c[d] || 0) + 1;
  };
  const jobs = {
    async qc() {
      const j = await get("https://www.donneesquebec.ca/recherche/dataset/f5c2e540-4416-4e90-9520-7837b8e31346/resource/81d32e61-16b8-4ccd-a0c4-c34e220e4420/download/sentieretel.json");
      if (!/32198/.test(JSON.stringify(j.crs || ""))) throw new Error("Sépaq: unexpected coordinate system");
      for (const f of j.features) {
        const p = f.properties, g = f.geometry;
        if (!g || p.Etat !== "Existant" || ![p.Usager, p.Usager_2, p.Usager_3, p.Usager_4].some((u) => /vélo/i.test(u || ""))) continue;
        const parts = g.type === "MultiLineString" ? g.coordinates : g.type === "LineString" ? [g.coordinates] : [];
        const name = [p.Toponyme1, p.Toponyme2].map((s) => (s || "").trim()).find((s) => s && s !== "S.I.A.") || "";
        parts.forEach((c) => add(levelOfWords(p.Niv_diff), "qc", name, (p.Niv_diff || "").trim(), c.map(([x, y]) => lambertQc(x, y))));
      }
    },
    async ott() {
      const fs = await arcgis("https://maps.ottawa.ca/arcgis/rest/services/CyclingMap/MapServer/17", "OBJECTID,TRAILNAME_EN,DIFFICULTY_EN");
      for (const { a, paths } of fs) paths.forEach((p) => add(levelOfWords(a.DIFFICULTY_EN), "ott", a.TRAILNAME_EN, a.DIFFICULTY_EN, lonlat(p)));
    },
    async ut() {
      const fs = await arcgis("https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/TrailsAndPathways/FeatureServer/0",
        "OBJECTID,PrimaryName,BikeDifficulty,Status", "BikeDifficulty IS NOT NULL AND BikeDifficulty <> ''");
      for (const { a, paths } of fs) if (!/closed/i.test(a.Status || "")) paths.forEach((p) => add(levelOfWords(a.BikeDifficulty), "ut", a.PrimaryName, a.BikeDifficulty, lonlat(p)));
    },
    async pa() {
      const fs = await arcgis("https://gis.dcnr.pa.gov/agsprod/rest/services/Parks/StateParksTrailsSimplifiedPortal/MapServer/0",
        "OBJECTID,Name,Park_ForestName,MtnBike,Difficulty", "MtnBike IN ('Promoted','Permitted')");
      for (const { a, paths } of fs) paths.forEach((p) => add(levelOfWords(a.Difficulty), "pa", a.Name, a.Difficulty, lonlat(p)));
    },
  };
  const failed = [];
  for (const [id, job] of Object.entries(jobs)) {
    try { await job(); console.log(`${id}: ${JSON.stringify(counts[id] || {})}`); }
    catch (e) { failed.push(id); console.log(`${id}: FAILED ${e.message}`); }
  }
  if (failed.length === Object.keys(jobs).length) { console.log("Every rating source failed; keeping the old files."); return false; }
  const sq = (v) => Math.floor(v * 2) / 2, squares = new Map();
  for (const [d, src, name, note, pts] of lines) {
    const keys = new Set(), flat = [];
    for (const [la, lo] of pts) for (const dl of [-0.002, 0.002]) for (const dn of [-0.003, 0.003]) keys.add(`${sq(la + dl)}_${sq(lo + dn)}`);
    let pa = 0, po = 0;
    for (const [la, lo] of pts) { const a = Math.round(la * 1e5), o = Math.round(lo * 1e5); flat.push(a - pa, o - po); pa = a; po = o; }
    for (const k of keys) { if (!squares.has(k)) squares.set(k, []); squares.get(k).push([d, src, name, note, flat]); }
  }
  // A source that failed keeps its lines from the published files.
  if (failed.length) {
    const site = "https://allduf.github.io/trail-finder/data/ratings/", old = await get(site + "index.json").catch(() => null);
    for (const k of Object.keys((old && old.squares) || {})) {
      const f = await get(`${site}${k}.json`).catch(() => null);
      const keep = ((f && f.lines) || []).filter((l) => failed.includes(l[1]));
      if (keep.length) { if (!squares.has(k)) squares.set(k, []); squares.get(k).push(...keep); }
    }
  }
  mkdirSync(OUT, { recursive: true });
  for (const f of readdirSync(OUT)) if (/^-?[\d.]+_-?[\d.]+\.json$/.test(f)) unlinkSync(`${OUT}/${f}`);
  const builtAt = new Date().toISOString(), index = { v: 1, builtAt, size: 0.5, sources: SOURCES, squares: {} };
  for (const [k, ls] of [...squares].sort()) {
    const body = JSON.stringify({ v: 1, lines: ls });
    writeFileSync(`${OUT}/${k}.json`, body);
    index.squares[k] = body.length;
  }
  writeFileSync(`${OUT}/index.json`, JSON.stringify(index));
  console.log(`${lines.length} rated lines in ${squares.size} squares${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
  return true;
}

if (process.env.CALIBRATE) await calibrate();
else {
  if (ONLY !== "osm") await buildLines();
  if (ONLY !== "lines") await buildOsm();
}
