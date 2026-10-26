// Weekly job (see .github/workflows/ski-heat.yml): a winter GPS heatmap for the site's Skiing mode, from the
// public GPS traces people upload to OpenStreetMap.
//
// Writes data/ski-heat.json: for each map square, how many different winter traces pass through each ~33 m cell.
// The site paints it as a heatmap under the ski routes.
//
// Backcountry only, across Canada (alex, 2026-10-26: "i dont care of the heat map in the resorts. i want all the
// data in the backcountry"). The squares done are the ones with a ski touring or off-piste route, an alpine hut
// (data/ski.json, data/ski-canada/) or a backcountry area around them (data/ski-areas.json); ski areas
// (landuse=winter_sports), their runs and lifts are left out.
//
// Why only OpenStreetMap's GPS traces: Strava's and Trailforks' heatmaps don't allow copying or deriving data
// from them. OpenStreetMap's public traces can be used (ODbL, "© OpenStreetMap contributors").
//
// Per map square:
//   1. Download the square's public GPS traces (newest uploads first) from the OpenStreetMap API.
//   2. Keep the points recorded from December to April, and in November and May the ones above the snow line
//      (1400 m, from the Terrarium elevation tiles), cut where the recording jumps or pauses.
//   3. Leave out roads, railways, ferries, lifts and ski areas (Overpass), so driving to the trailhead and the
//      resort runs don't show up, and anything faster than 90 km/h (a plane, a GPS glitch).
//   4. Count, per cell, the different traces that pass through it.
//
// Squares are done in rotation within a page and time budget, never-done and oldest first (the ones with the most
// touring first); squares not done keep their last data. The file is saved after every square, so a run that
// is stopped keeps what it did.
//
// Run: node scripts/build-ski-heat.mjs   (Node 18 or newer, no packages needed)
//   SQUARES=50.00,-123.00;50.20,-123.00   just these squares
//   PAGE_BUDGET=1500    trace pages in this run      MINUTES=200   stop starting new squares after this long
//   TEST_BOX=s,w,n,e TEST_OUT=file.json MAPPED_FROM=api   try one small box, roads from the OSM API instead of Overpass

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { inflateSync } from "node:zlib";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const DATA = new URL("data/", root);
const UA = "trail-finder weekly ski heatmap (https://github.com/allduf/trail-finder)";

function grab(re, what) { const m = html.match(re); if (!m) throw new Error(`Couldn't find ${what} in index.html`); return m; }
const OVERPASS = process.env.OVERPASS_URLS ? process.env.OVERPASS_URLS.split(",") : JSON.parse(grab(/const OVERPASS = (\[[^\]]+\]);/, "the Overpass servers")[1]);
const OSM_API = process.env.OSM_API || grab(/const OSM_API = "([^"]+)";/, "the OSM API address")[1];
const [, TILE_LAT, TILE_LON] = grab(/const TILE_LAT = ([\d.]+), TILE_LON = ([\d.]+);/, "the map square size").map(Number);

// ---------- settings ----------
const CELL_LAT = 0.0003, CELL_LON = 0.00045;   // ~33 m x 32 m at 50° N; the site reads these from the file
const ROAD_BUFFER = 25;      // m around roads, railways, ferries and lifts
const MAX_JUMP = 250;        // m between two GPS points: further apart is a gap in the recording
const MAX_GAP_S = 90;        // s between two GPS points: longer is a gap in the recording
const MAX_KMH = 90;          // faster than this is a plane, a car on an unmapped road, or a GPS glitch
// December to April anywhere; November and May only above the snow line (most touring there is in the alpine).
const SNOW_LINE = 1400;      // m
const season = (t) => { const m = new Date(t).getUTCMonth(); return m === 11 || m <= 3 ? 2 : m === 10 || m === 4 ? 1 : 0; };
const PAGES_PER_SQUARE = +(process.env.PAGES_PER_SQUARE || 200);   // 5000 GPS points per page
const PAGE_BUDGET = +(process.env.PAGE_BUDGET || 1500);            // pages per run, all squares together
const MINUTES = +(process.env.MINUTES || 200);                      // the workflow stops the job at 240
const started = Date.now();

// ---------- small helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const readJson = (name) => { try { return JSON.parse(readFileSync(new URL(name, DATA), "utf8")); } catch { return null; } };
// Same grid as gridTiles() in index.html, so square keys match the other data files.
function gridTiles([S, W, N, E]) {
  const out = [];
  for (let s = Math.floor(S / TILE_LAT) * TILE_LAT; s < N; s += TILE_LAT)
    for (let w = Math.floor(W / TILE_LON) * TILE_LON; w < E; w += TILE_LON)
      out.push({ key: `${s.toFixed(2)},${w.toFixed(2)}`, box: [s, w, s + TILE_LAT, w + TILE_LON] });
  return out;
}
async function get(url, opts = {}, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: { "User-Agent": UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(opts.timeout || 120000) });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status} from ${new URL(url).host}`);
      if (res.status !== 429 && res.status < 500) throw lastErr;
    } catch (e) { lastErr = e; if (/HTTP 4\d\d/.test(e.message) && !/429/.test(e.message)) throw e; }
    await sleep(5000 * 2 ** i);
  }
  throw lastErr;
}

// ---------- 1. GPS traces (same reading as scripts/find-unmapped.mjs) ----------
// The API sends traces newest upload first; points with a time come in recorded order. Points without a time
// (fully private traces) come last and can't be dated, so we stop there.
const attr = (s, k) => { const m = s.match(new RegExp(`${k}="([^"]*)"`)); return m ? m[1] : null; };
let pagesUsed = 0;
async function fetchTraces([s, w, n, e]) {
  const traces = new Map();   // id -> segments of [lat, lon, ms]
  let anon = 0, page = 0, points = 0;
  for (; page < PAGES_PER_SQUARE && pagesUsed < PAGE_BUDGET; page++) {
    const xml = await (await get(`${OSM_API}/trackpoints?bbox=${w},${s},${e},${n}&page=${page}`)).text();
    pagesUsed++;
    let timed = 0;
    for (const trk of xml.split("<trk>").slice(1)) {
      const url = (trk.match(/<url>([^<]*)<\/url>/) || [])[1];
      const id = url ? url.split("/").pop() : `anon-${page}-${anon++}`;
      const segs = traces.get(id) || [];
      for (const seg of trk.split("<trkseg>").slice(1)) {
        const pts = [];
        for (const m of seg.matchAll(/<trkpt ([^>]*)>\s*(?:<time>([^<]*)<\/time>)?/g)) {
          points++;
          if (!m[2]) continue;
          timed++;
          pts.push([+attr(m[1], "lat"), +attr(m[1], "lon"), Date.parse(m[2])]);
        }
        if (pts.length > 1) segs.push(pts);
      }
      if (segs.length) traces.set(id, segs);
    }
    await sleep(1000);
    if (!timed) break;   // only untimed points left
  }
  return { traces: [...traces.values()], pages: page, points };
}

// ---------- heights, for November and May (Terrarium PNG tiles, as build-directions.mjs) ----------
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
// Heights over a square at zoom 11 (about 75 m a pixel, plenty to tell valley from alpine). Returns (lat, lon) => m.
const EZ = 11;
async function heightsFor([s, w, n, e]) {
  const N = 2 ** EZ, tx = (lon) => ((lon + 180) / 360) * N, ty = (lat) => ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * N;
  const tiles = new Map();
  for (let x = Math.floor(tx(w)); x <= Math.floor(tx(e)); x++)
    for (let y = Math.floor(ty(n)); y <= Math.floor(ty(s)); y++)
      tiles.set(`${x}/${y}`, decodePng(Buffer.from(await (await get(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${EZ}/${x}/${y}.png`)).arrayBuffer())));
  return (lat, lon) => {
    const fx = tx(lon), fy = ty(lat), x = Math.floor(fx), y = Math.floor(fy), t = tiles.get(`${x}/${y}`);
    if (!t) return 0;
    return t.e[Math.min(t.w - 1, Math.floor((fy - y) * t.w)) * t.w + Math.min(t.w - 1, Math.floor((fx - x) * t.w))];
  };
}

// ---------- 2. roads, railways, ferries, lifts and ski areas ----------
const ROADS = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link";
async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const res = await get(url, { method: "POST", body: "data=" + encodeURIComponent(query), headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 240000 }, 1);
      const json = await res.json();
      if (json.remark && /error/i.test(json.remark)) throw new Error(json.remark);
      await sleep(2000);
      return json.elements;
    } catch (e) { lastErr = e; }
    await sleep(Math.min(30000 * 2 ** Math.floor(attempt / OVERPASS.length), 240000));
  }
  throw lastErr;
}
// Testing only (Overpass can't be reached from everywhere): the OSM API "map" call, for a small box. Ski area
// relations are left out.
async function mapCall([s, w, n, e]) {
  const xml = await (await get(`${OSM_API}/map?bbox=${w},${s},${e},${n}`)).text();
  const nodes = new Map([...xml.matchAll(/<node id="(\d+)"[^>]*lat="([-\d.]+)" lon="([-\d.]+)"/g)].map((m) => [m[1], [+m[2], +m[3]]]));
  const re = new RegExp(`k="highway" v="(${ROADS})"|k="railway" v="rail"|k="route" v="ferry"|k="aerialway"|k="piste:type" v="downhill"`);
  const ways = [...xml.matchAll(/<way [^>]*>([\s\S]*?)<\/way>/g)], line = (m) => [...m[1].matchAll(/<nd ref="(\d+)"/g)].map((x) => nodes.get(x[1])).filter(Boolean);
  return { lines: ways.filter((m) => re.test(m[1])).map(line), areas: ways.filter((m) => /k="landuse" v="winter_sports"/.test(m[1])).map(line) };
}
// Lines to leave out (roads, railways, ferries, lifts, downhill runs) and ski area outlines.
async function roadLines([s, w, n, e]) {
  if (process.env.MAPPED_FROM === "api") {   // in 8 x 8 pieces, under the API's node limit
    const out = { lines: [], areas: [] }, K = 8;
    for (let i = 0; i < K; i++) for (let j = 0; j < K; j++) {
      const ss = s + ((n - s) * i) / K, ww = w + ((e - w) * j) / K;
      const x = await mapCall([ss, ww, ss + (n - s) / K, ww + (e - w) / K]);
      out.lines.push(...x.lines); out.areas.push(...x.areas);
    }
    return out;
  }
  const b = `${s},${w},${n},${e}`;
  const els = await overpass(`[out:json][timeout:200];(way[highway~"^(${ROADS})$"](${b});way[railway=rail](${b});way[route=ferry](${b});way[aerialway](${b});way["piste:type"=downhill](${b}););out tags geom;(way[landuse=winter_sports](${b});relation[landuse=winter_sports](${b}););out tags geom;`);
  const pts = (g) => g.filter(Boolean).map((p) => [p.lat, p.lon]);
  const lines = [], areas = [];
  for (const x of els) {
    if (x.tags?.landuse === "winter_sports") {
      if (x.geometry) areas.push(pts(x.geometry));
      else areas.push(...joinRings((x.members || []).filter((m) => m.role !== "inner" && m.geometry).map((m) => pts(m.geometry))));
    } else if (x.geometry) lines.push(pts(x.geometry));
  }
  return { lines, areas };
}

// A multipolygon's outer ways joined end to end into rings.
function joinRings(pieces) {
  const same = (a, b) => a[0] === b[0] && a[1] === b[1], rings = [];
  let left = pieces.filter((p) => p.length > 1);
  while (left.length) {
    let ring = left.shift();
    for (let grew = true; grew && !same(ring[0], ring[ring.length - 1]);) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i], end = ring[ring.length - 1];
        if (same(end, p[0])) ring = ring.concat(p.slice(1));
        else if (same(end, p[p.length - 1])) ring = ring.concat(p.slice(0, -1).reverse());
        else continue;
        left.splice(i, 1); grew = true; break;
      }
    }
    rings.push(ring);
  }
  return rings;
}

// Is this trace piece worth fetching heights and roads for: any point in the square in the season?
const anyInSeason = ([s, w, n, e], traces) => {
  let late = false;
  for (const segs of traces) for (const seg of segs) for (const [lat, lon, t] of seg) {
    if (lat < s || lat >= n || lon < w || lon >= e) continue;
    const k = season(t);
    if (k === 2) return 2;
    if (k === 1) late = true;
  }
  return late ? 1 : 0;
};

// ---------- 3 and 4. count traces per cell ----------
function heatSquare([s, w, n, e], traces, { lines: roads, areas }, heightAt) {
  const rows = Math.round((n - s) / CELL_LAT), cols = Math.round((e - w) / CELL_LON);
  const my = 110540, mx = 111320 * Math.cos(((s + n) / 2) * Math.PI / 180);
  const cellOf = (lat, lon) => { const r = Math.floor((lat - s) / CELL_LAT), c = Math.floor((lon - w) / CELL_LON); return r < 0 || c < 0 || r >= rows || c >= cols ? -1 : r * cols + c; };
  // Calls fn(lat, lon) every ~step metres along a line of [lat, lon] points.
  const walk = (pts, step, fn) => {
    for (let i = 1; i < pts.length; i++) {
      const [a0, o0] = pts[i - 1], [a1, o1] = pts[i];
      const d = Math.hypot((a1 - a0) * my, (o1 - o0) * mx), k = Math.max(1, Math.ceil(d / step));
      for (let j = i === 1 ? 0 : 1; j <= k; j++) fn(a0 + (a1 - a0) * j / k, o0 + (o1 - o0) * j / k);
    }
  };
  // Road mask on a finer 8 m grid, so the strip left out is about ROAD_BUFFER wide, not a whole heat cell.
  const F = 8, fr = Math.ceil((n - s) * my / F), fc = Math.ceil((e - w) * mx / F);
  const road = new Uint8Array(fr * fc), R = Math.ceil(ROAD_BUFFER / F);
  for (const l of roads) walk(l, F / 2, (lat, lon) => {
    const r0 = Math.floor((lat - s) * my / F), c0 = Math.floor((lon - w) * mx / F);
    for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
      if (dr * dr + dc * dc > R * R) continue;
      const r = r0 + dr, c = c0 + dc;
      if (r >= 0 && c >= 0 && r < fr && c < fc) road[r * fc + c] = 1;
    }
  });
  // Ski areas filled in, row by row (even-odd rule).
  for (const ring of areas) {
    if (ring.length < 3) continue;
    const P = ring.map(([lat, lon]) => [(lat - s) * my / F, (lon - w) * mx / F]);
    for (let r = Math.max(0, Math.floor(Math.min(...P.map((p) => p[0])))); r < Math.min(fr, Math.ceil(Math.max(...P.map((p) => p[0])))); r++) {
      const y = r + 0.5, xs = [];
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const [y0, x0] = P[j], [y1, x1] = P[i];
        if ((y0 <= y) !== (y1 <= y)) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let c = Math.max(0, Math.ceil(xs[k] - 0.5)); c < Math.min(fc, Math.floor(xs[k + 1] - 0.5) + 1); c++) road[r * fc + c] = 1;
    }
  }
  const onRoad = (lat, lon) => { const r = Math.floor((lat - s) * my / F), c = Math.floor((lon - w) * mx / F); return r >= 0 && c >= 0 && r < fr && c < fc && road[r * fc + c] === 1; };

  const count = new Uint16Array(rows * cols), stamp = new Int32Array(rows * cols).fill(-1);
  let used = 0, pieces = 0;
  traces.forEach((segs, ti) => {
    let any = false;
    for (const seg of segs) {
      let cur = [];
      const flush = () => {
        if (cur.length > 1) {
          pieces++; any = true;
          walk(cur, 10, (lat, lon) => {
            if (onRoad(lat, lon)) return;
            const c = cellOf(lat, lon);
            if (c >= 0 && stamp[c] !== ti) { stamp[c] = ti; if (count[c] < 65535) count[c]++; }
          });
        }
        cur = [];
      };
      for (const p of seg) {
        const [lat, lon, t] = p;
        const k = season(t);
        if (!k || cellOf(lat, lon) < 0 || (k === 1 && !(heightAt && heightAt(lat, lon) >= SNOW_LINE))) { flush(); continue; }
        const q = cur[cur.length - 1];
        if (q) {
          const d = Math.hypot((lat - q[0]) * my, (lon - q[1]) * mx), dt = (t - q[2]) / 1000;
          if (d > MAX_JUMP || dt > MAX_GAP_S || dt <= 0 || (d / dt) * 3.6 > MAX_KMH) { flush(); }
          else if (d < 1) continue;   // standing still
        }
        cur.push(p);
      }
      flush();
    }
    if (any) used++;
  });
  // Cells as [row, col, traces, ...], row by row: the site reads them back the same way.
  const c = [];
  for (let i = 0; i < count.length; i++) if (count[i]) c.push(Math.floor(i / cols), i % cols, count[i]);
  return { c, traces: used, pieces };
}

// ---------- which squares: where people ski tour ----------
// Weight per square: touring/off-piste route points and alpine huts in it, and a backcountry area in it or next to
// it. Squares with more get done first.
function backcountrySquares() {
  const key = (lat, lon) => `${(Math.floor(lat / TILE_LAT + 1e-9) * TILE_LAT).toFixed(2)},${(Math.floor(lon / TILE_LON + 1e-9) * TILE_LON).toFixed(2)}`;
  const weight = new Map(), add = (lat, lon, v) => { const k = key(lat, lon); weight.set(k, (weight.get(k) || 0) + v); };
  const files = ["ski.json", ...(existsSync(new URL("ski-canada/", DATA)) ? readdirSync(new URL("ski-canada/", DATA)).map((f) => "ski-canada/" + f) : [])];
  for (const f of files) {
    const d = readJson(f);
    if (!d) continue;
    for (const r of d.routes || []) {
      if (r.type !== "tour" && r.type !== "offpiste") continue;
      const parts = typeof r.g?.[0] === "number" ? [r.g] : r.g || [];
      for (const g of parts) for (let i = 0; i < g.length; i += 2) add(g[i], g[i + 1], 1);
    }
    for (const h of d.huts || []) if (h.kind === "alpine_hut") add(h.lat, h.lon, 20);
  }
  for (const a of readJson("ski-areas.json")?.areas || [])
    for (const dl of [-TILE_LAT, 0, TILE_LAT]) for (const dn of [-TILE_LON, 0, TILE_LON]) add(a.lat + dl, a.lon + dn, dl || dn ? 10 : 50);
  const out = new Map();
  for (const [k, v] of weight) {
    const [s, w] = k.split(",").map(Number);
    out.set(k, { key: k, box: [s, w, +(s + TILE_LAT).toFixed(2), +(w + TILE_LON).toFixed(2)], weight: v });
  }
  return out;
}

// ---------- run ----------
if (!existsSync(DATA)) mkdirSync(DATA);
const builtAt = new Date().toISOString().slice(0, 19) + "Z";
const before = readJson("ski-heat.json");
const allSquares = backcountrySquares();
if (!allSquares.size) throw new Error("No ski touring data found (data/ski.json, data/ski-canada/): run scripts/site-data.sh get first");
// Squares made before resorts were left out count as never done, so they are redone first.
const doneAt = (key) => (before?.resorts && before.tiles?.[key] ? Date.parse(before.tiles[key].at) : 0);
let order = [...allSquares.values()].sort((a, b) => doneAt(a.key) - doneAt(b.key) || b.weight - a.weight);
if (process.env.SQUARES) { const want = process.env.SQUARES.split(";"); order = want.map((k) => allSquares.get(k) || (([s, w]) => ({ key: k, box: [s, w, s + TILE_LAT, w + TILE_LON] }))(k.split(",").map(Number))); }
const TEST_BOX = process.env.TEST_BOX && process.env.TEST_BOX.split(",").map(Number);
if (TEST_BOX) order = [{ key: "test", box: TEST_BOX }];
log(`Ski heatmap: ${allSquares.size} backcountry squares across Canada, ${order.filter((t) => !doneAt(t.key)).length} never done; up to ${PAGE_BUDGET} pages of traces and ${MINUTES} minutes this run.`);

const results = new Map();
const file = TEST_BOX ? process.env.TEST_OUT || "ski-heat-test.json" : new URL("ski-heat.json", DATA);
function save() {
  const out = { v: 1, builtAt, cell: [CELL_LAT, CELL_LON], months: "Dec-Apr, Nov and May above 1400 m", resorts: "left out", tiles: {} };
  if (TEST_BOX) out.tiles.test = results.get("test") || null;
  else for (const key of new Set([...allSquares.keys(), ...results.keys()])) {
    const r = results.get(key) || before?.tiles?.[key];
    if (r) out.tiles[key] = r;
  }
  writeFileSync(file, JSON.stringify(out));
  return out;
}
for (const sq of order) {
  if (pagesUsed >= PAGE_BUDGET) { log(`Page budget used up; the other squares wait for the next run.`); break; }
  if (Date.now() - started > MINUTES * 60000) { log(`${MINUTES} minutes used up; the other squares wait for the next run.`); break; }
  const t0 = Date.now();
  try {
    const tr = await fetchTraces(sq.box);
    const kind = anyInSeason(sq.box, tr.traces);
    const heightAt = kind ? await heightsFor(sq.box) : null;
    const mask = kind ? await roadLines(sq.box) : { lines: [], areas: [] };
    const h = kind ? heatSquare(sq.box, tr.traces, mask, heightAt) : { c: [], traces: 0 };
    results.set(sq.key, { at: builtAt, box: sq.box, n: h.traces, c: h.c });
    log(`  ${sq.key}: ${tr.pages} pages, ${tr.traces.length} traces, ${h.traces} in the season, ${mask.lines.length} roads/lifts/runs, ${mask.areas.length} ski areas, ${h.c.length / 3} cells. ${Math.round((Date.now() - t0) / 1000)} s`);
    save();
  } catch (e) { log(`  ${sq.key}: failed (${e.message}), keeping last good data`); }
}

const out = save();
const cells = Object.values(out.tiles).reduce((a, t) => a + (t ? t.c.length / 3 : 0), 0);
const left = [...allSquares.keys()].filter((k) => !results.has(k) && !doneAt(k)).length;
log(`Done: ${results.size} squares this run, ${Object.keys(out.tiles).length} in the file (${left} not done yet), ${cells} cells, ${pagesUsed} pages of GPS traces.`);
