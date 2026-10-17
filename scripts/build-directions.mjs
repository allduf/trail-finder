// Which way every trail of the region is ridden (alex: "find trail direction ... if you dont know put bothways"),
// into data/directions.json for directions.js (trail details, Plan a route). Runs the same rules as the site
// (directions.js: the HAND list, OpenStreetMap tags, names) on every way of data/mtb-<zone>.json, and adds:
//   same  a piece with no direction joined (ends within 30 m) to a piece of the same named trail that is a climb or a descent
//   wh    Whistler's open trail data (OGL-RMOW), csrd Columbia Shuswap's (OGL-CSRD), if they carry a direction (LOCAL below)
//   which end is up: heights of the ends (AWS Terrain Tiles, like build-ratings.mjs), so a climb is pointed up, a descent
//   down, and a one-way trail that drops or rises 25 m or more at 3% or more becomes a descent or a climb. The slope never
//   makes a two-way trail one-way.
// Each way: [dir, along, src, note]. dir: climb, down, oneway (both ways is the default and not written).
// along: 1 ridden from the first point of the shape to the last, -1 the other way, 0 not known.
//
// Run: node scripts/build-directions.mjs   (Node 18 or newer, no packages)
//   PROBE=1 also prints the fields of the local open-data layers, to look for a direction field.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import vm from "node:vm";

const UA = { "User-Agent": "trail-finder (github.com/allduf/trail-finder)" };
const box = { window: undefined };
vm.runInNewContext(readFileSync(new URL("../directions.js", import.meta.url), "utf8"), box);
const { rules } = box.tfDir;

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
const metres = (a, b) => Math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180));
const fold = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------- heights (Terrarium PNG tiles, as build-ratings.mjs) ----------
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
async function elevation([la, lo]) {
  const n = 2 ** Z, fx = (lo + 180) / 360 * n, fy = (1 - Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360)) / Math.PI) / 2 * n;
  const x = Math.floor(fx), y = Math.floor(fy), t = await tile(x, y), W = t.w;
  const px = (fx - x) * W - 0.5, py = (fy - y) * W - 0.5;
  const x0 = Math.max(0, Math.min(W - 2, Math.floor(px))), y0 = Math.max(0, Math.min(W - 2, Math.floor(py)));
  const u = Math.max(0, Math.min(1, px - x0)), v = Math.max(0, Math.min(1, py - y0)), E = (i, j) => t.e[j * W + i];
  return E(x0, y0) * (1 - u) * (1 - v) + E(x0 + 1, y0) * u * (1 - v) + E(x0, y0 + 1) * (1 - u) * v + E(x0 + 1, y0 + 1) * u * v;
}
// Rise from the first point to the last (metres), and the length.
async function rise(geom) {
  let len = 0;
  for (let i = 1; i < geom.length; i++) len += metres(geom[i - 1], geom[i]);
  const [a, b] = await Promise.all([elevation(geom[0]), elevation(geom[geom.length - 1])]);
  return { dh: b - a, len };
}

// ---------- local open data with a direction ----------
// Whistler's Multi-Use Trails layer, DIRECTION: Ascent, Descent, One-way, Two-way (and "Difficult", a slip, skipped).
// Columbia Shuswap's Trails layer, Direction: Up Only, Down Only, Both (bike trails only: Cycling not "No").
// A way takes a line's direction when 60% or more of its points lie within 30 m of that line.
// PROBE=1 lists the fields of these layers, to spot new ones.
const LOCAL = {
  wh: "https://webmap.whistler.ca/server/rest/services/OpenData/opParksRecreation/MapServer/13",
  csrd: "https://services5.arcgis.com/wjH30HL7rqC55zVw/arcgis/rest/services",
};
const LOCAL_DIR = { Ascent: "climb", Descent: "down", "One-way": "oneway", "Two-way": "both", "Up Only": "climb", "Down Only": "down", Both: "both" };
async function arcgis(layer, fields) {
  const out = [];
  for (let offset = 0; ; ) {
    const j = await get(`${layer}/query?where=1%3D1&outFields=${fields}&outSR=4326&returnGeometry=true&f=json&resultOffset=${offset}&resultRecordCount=1000&orderByFields=OBJECTID`);
    if (j.error) throw new Error(`${layer}: ${JSON.stringify(j.error).slice(0, 200)}`);
    const fs = j.features || [];
    fs.forEach((f) => f.geometry && f.geometry.paths && out.push({ a: f.attributes, paths: f.geometry.paths }));
    offset += fs.length;
    if (!fs.length || (!j.exceededTransferLimit && fs.length < 1000)) break;
  }
  return out;
}
// Lines with a direction: { src, dir, value, name, g: [[lat, lon], ...] }, in a grid of 0.005 degree cells.
const CELL = 0.005, cells = new Map(), failed = new Set();
async function loadLocal() {
  const lines = [];
  const take = (src, value, name, paths) => {
    const dir = LOCAL_DIR[(value || "").trim()];
    if (dir) paths.forEach((p) => p.length > 1 && lines.push({ src, dir, value: value.trim(), name: (name || "").trim(), g: p.map(([lo, la]) => [la, lo]) }));
  };
  try {
    for (const { a, paths } of await arcgis(LOCAL.wh, "OBJECTID,ASSETNAME,DIRECTION")) take("wh", a.DIRECTION, a.ASSETNAME, paths);
  } catch (e) { console.log(`wh: ${e.message}`); failed.add("wh"); }
  try {
    for (const { a, paths } of await arcgis(`${LOCAL.csrd}/Trails/FeatureServer/0`, "OBJECTID,Trail_Name,Trail_Type,Cycling,Direction,Status_Operational")) {
      if (/^(Snowmobile|Road)$/.test(a.Trail_Type || "") || a.Cycling === "No" || a.Status_Operational === "Closed") continue;
      take("csrd", a.Direction, a.Trail_Name, paths);
    }
  } catch (e) { console.log(`csrd: ${e.message}`); failed.add("csrd"); }
  for (const l of lines) {
    for (let k = 0; k + 1 < l.g.length; k++) {
      const [a, b] = [l.g[k], l.g[k + 1]];
      for (let x = Math.floor((Math.min(a[0], b[0]) - 0.0003) / CELL); x <= Math.floor((Math.max(a[0], b[0]) + 0.0003) / CELL); x++)
        for (let y = Math.floor((Math.min(a[1], b[1]) - 0.0005) / CELL); y <= Math.floor((Math.max(a[1], b[1]) + 0.0005) / CELL); y++) {
          const c = x + "," + y; if (!cells.has(c)) cells.set(c, []); cells.get(c).push([l, k]);
        }
    }
  }
  const n = {}; lines.forEach((l) => (n[`${l.src} ${l.value}`] = (n[`${l.src} ${l.value}`] || 0) + 1));
  console.log(`local lines with a direction: ${JSON.stringify(n)}`);
}
function segDist(p, a, b) {
  const k = Math.cos((p[0] * Math.PI) / 180) * 111320, K = 110540;
  const ax = (a[1] - p[1]) * k, ay = (a[0] - p[0]) * K, bx = (b[1] - p[1]) * k, by = (b[0] - p[0]) * K;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
// The local line most of the way runs along, or null.
function localOf(geom) {
  const hits = new Map();
  for (const p of geom) {
    const near = new Set();
    for (const [l, k] of cells.get(Math.floor(p[0] / CELL) + "," + Math.floor(p[1] / CELL)) || [])
      if (!near.has(l) && segDist(p, l.g[k], l.g[k + 1]) <= 30) near.add(l);
    near.forEach((l) => hits.set(l, (hits.get(l) || 0) + 1));
  }
  let best = null, most = 0;
  hits.forEach((v, l) => { if (v > most) { most = v; best = l; } });
  return best && most >= 0.6 * geom.length ? best : null;
}
async function probe() {
  const layers = [LOCAL.wh];
  try {
    const s = await get(`${LOCAL.csrd}?f=json`);
    (s.services || []).filter((x) => /trail/i.test(x.name)).forEach((x) => layers.push(`${LOCAL.csrd}/${x.name}/${x.type}/0`));
  } catch (e) { console.log(`csrd: ${e.message}`); }
  for (const l of layers) {
    try {
      const m = await get(`${l}?f=json`);
      console.log(`${l}: ${(m.fields || []).map((f) => f.name).join(", ")}`);
      for (const f of (m.fields || []).filter((f) => /dir|way|climb|up|down|flow|use|desc|note|comment/i.test(f.name))) {
        const q = await get(`${l}/query?where=1%3D1&outFields=${f.name}&returnGeometry=false&returnDistinctValues=true&f=json`).catch(() => null);
        const vals = ((q && q.features) || []).map((x) => x.attributes[f.name]).filter((v) => v != null && v !== "");
        console.log(`  ${f.name}: ${vals.length} values: ${vals.slice(0, 40).map(String).map((v) => v.slice(0, 60)).join(" | ")}`);
      }
    } catch (e) { console.log(`${l}: ${e.message}`); }
  }
}

// ---------- build ----------
await loadLocal();
// A source that couldn't be reached tonight keeps its directions from the last build.
let old = {};
try { old = JSON.parse(readFileSync("data/directions.json", "utf8")).ways || {}; } catch {}
const files = readdirSync("data").filter((f) => /^mtb-\w+\.json$/.test(f)).sort();
const out = {}, count = {};
const add = (k) => (count[k] = (count[k] || 0) + 1);
for (const f of files) {
  const j = JSON.parse(readFileSync(`data/${f}`, "utf8"));
  const ways = Object.entries(j.ways || {}).filter(([, w]) => w.g && w.g.length >= 4).map(([id, w]) => {
    const geom = [];
    for (let i = 0; i < w.g.length; i += 2) geom.push([w.g[i], w.g[i + 1]]);
    return { id, tags: w.tags || {}, geom, ends: [geom[0], geom[geom.length - 1]], r: null };
  });
  for (const w of ways) {
    w.r = rules(w.tags, w.geom);
    const o = old[w.id];
    if (o && failed.has(o[2]) && (!w.r || w.r.weak)) { w.r = { dir: o[0], along: o[1], src: o[2], note: o[3] }; continue; }
    // Local open data, where the tags and name say nothing (or only that it's too hard to ride up).
    if (cells.size && (!w.r || w.r.weak)) {
      const l = localOf(w.geom);
      if (l) w.r = { dir: l.dir, along: 0, src: l.src, note: l.value };
    }
  }
  // Same named trail: spread climbs and descents to the joined pieces with no direction, piece by piece.
  const byName = new Map();
  for (const w of ways) { const n = fold(w.tags.name); if (n) { if (!byName.has(n)) byName.set(n, []); byName.get(n).push(w); } }
  for (const list of byName.values()) {
    for (let changed = true, round = 0; changed && round < 50; round++) {
      changed = false;
      for (const w of list) {
        if (w.r) continue;
        const from = list.find((o) => o.r && (o.r.dir === "climb" || o.r.dir === "down") && o.ends.some((p) => w.ends.some((q) => metres(p, q) < 30)));
        if (from) { w.r = { dir: from.r.dir, along: 0, src: "same", note: w.tags.name }; changed = true; }
      }
    }
  }
  // Which end is up.
  let n = 0;
  for (const w of ways) {
    const r = w.r;
    if (!r || (r.dir === "both" && !/^(wh|csrd)$/.test(r.src))) continue;
    let note = r.note || "";
    try {
      const { dh, len } = await rise(w.geom);
      const s = Math.sign(dh), steep = Math.abs(dh) >= 25 && Math.abs(dh) / len >= 0.03;
      // A one-way trail in the local data with no way along it: one that drops steadily is ridden down.
      if (r.dir === "oneway" && !r.along && steep) { r.dir = "down"; r.along = -s; add("local oneway+slope"); }
      else if (r.dir === "oneway" && steep) { r.dir = dh * r.along > 0 ? "climb" : "down"; note = `${r.dir === "climb" ? "up" : "down"} ${Math.round(Math.abs(dh))} m`; add("oneway+slope"); }
      else if ((r.dir === "climb" || r.dir === "down") && !r.along && Math.abs(dh) >= 5) r.along = r.dir === "climb" ? s : -s;
    } catch (e) { console.log(`way ${w.id}: ${e.message}`); }
    out[w.id] = note ? [r.dir, r.along || 0, r.src, note] : [r.dir, r.along || 0, r.src];
    add(`${r.dir} ${r.src}`); n++;
  }
  console.log(`${f}: ${ways.length} ways, ${n} with a direction`);
}
writeFileSync("data/directions.json", JSON.stringify({ v: 1, builtAt: new Date().toISOString(), ways: out }));
console.log(JSON.stringify(count, null, 1));
if (process.env.PROBE) await probe();
