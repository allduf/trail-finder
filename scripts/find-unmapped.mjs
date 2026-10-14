// Weekly job (see .github/workflows/unmapped-trails.yml): looks for trails people ride that aren't on
// OpenStreetMap yet, using the public GPS traces people upload to OpenStreetMap.
//
// Writes data/unmapped-<zone>.json for each zone of the region. The site shows them as "Possible unmapped trail".
//
// Why only OpenStreetMap's GPS traces: Strava's and Trailforks' heatmaps don't allow copying or deriving data
// from them (and OpenStreetMap doesn't allow importing from them either). OSM's public traces can be used.
// The site links each find to the Strava and Trailforks heatmaps so a person can compare by eye.
//
// How a find is made, per map square:
//   1. Download the square's public GPS traces (newest uploads first) from the OpenStreetMap API.
//   2. Download every mapped road, path, railway, lift, ferry and ski run in the square (Overpass), and
//      blank out a 20 m strip around each: traces there follow something already on the map.
//   3. Where 2 or more different traces run together off the map for 100 m or more, that's a find.
//   4. Each trace's speed on it says who uses it: bike speed, walking speed, or a vehicle (dropped).
//   5. Finds that are perfectly flat (boats, a lake in winter) are dropped using Open-Meteo elevation.
//
// Squares are done in rotation within a page budget, so the OpenStreetMap API isn't asked too much in one run.
// Squares not done this run keep their finds from the last run.
//
// Run: node scripts/find-unmapped.mjs   (Node 18 or newer, no packages needed)
//   ONLY=sqm            just one zone            SQUARES=49.60,-123.30   just these squares
//   PAGE_BUDGET=2000    trace pages in this run
//   TEST_BOX=s,w,n,e TEST_OUT=file.json MAPPED_FROM=api   try one small box, mapped ways from the OSM API instead of Overpass

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const DATA = new URL("data/", root);
const UA = "trail-finder weekly unmapped-trail finder (https://github.com/allduf/trail-finder)";

function grab(re, what) { const m = html.match(re); if (!m) throw new Error(`Couldn't find ${what} in index.html`); return m; }
const OVERPASS = process.env.OVERPASS_URLS ? process.env.OVERPASS_URLS.split(",") : JSON.parse(grab(/const OVERPASS = (\[[^\]]+\]);/, "the Overpass servers")[1]);
const OSM_API = process.env.OSM_API || grab(/const OSM_API = "([^"]+)";/, "the OSM API address")[1];
const [, TILE_LAT, TILE_LON] = grab(/const TILE_LAT = ([\d.]+), TILE_LON = ([\d.]+);/, "the map square size").map(Number);
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }))
  .filter((z) => !process.env.ONLY || process.env.ONLY.split(",").includes(z.id));
if (!ZONES.length) throw new Error("Couldn't read the zones from index.html");

// ---------- settings ----------
const CELL = 8;              // m, grid cell size
const MAPPED_BUFFER = 20;    // m around anything mapped: GPS traces wander this far from the real line
const MIN_TRACES = 2;        // different traces needed on the same line
const MIN_LEN = 100;         // m, shortest find
const MAX_JUMP = 60;         // m between two GPS points: further apart is a gap in the recording
const MAX_GAP_S = 30;        // s between two GPS points: longer is a gap in the recording
const SINCE = Date.parse(process.env.TRACES_SINCE || "2012-01-01");   // older recordings are skipped
const PAGES_PER_SQUARE = +(process.env.PAGES_PER_SQUARE || 200);    // 5000 GPS points per page
const PAGE_BUDGET = +(process.env.PAGE_BUDGET || 2000);             // pages per run, all squares together
const WINTER_ZONES = new Set(["wh", "pem", "lil", "chil"]);                  // snow: skiing traces look like riding
const BIKE_KMH = 9, VEHICLE_KMH = 50;

// ---------- small helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const round = (n) => Math.round(n * 1e5) / 1e5;
const readJson = (name) => { try { return JSON.parse(readFileSync(new URL(name, DATA), "utf8")); } catch { return null; } };
// Same grid as gridTiles() in index.html, so square keys match the trail files.
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

// ---------- 1. GPS traces ----------
// The API sends traces newest upload first; points with a time come in recorded order. Points without a time
// (fully private traces) come last, sorted by place, and can't be joined into lines, so we stop there.
const attr = (s, k) => { const m = s.match(new RegExp(`${k}="([^"]*)"`)); return m ? m[1] : null; };
let pagesUsed = 0;
async function fetchTraces([s, w, n, e]) {
  const traces = new Map();  // id -> { id, user, segs: [[lat, lon, ms]...][] }
  let anon = 0, page = 0, points = 0, oldPages = 0;
  for (; page < PAGES_PER_SQUARE && pagesUsed < PAGE_BUDGET; page++) {
    const xml = await (await get(`${OSM_API}/trackpoints?bbox=${w},${s},${e},${n}&page=${page}`)).text();
    pagesUsed++;
    let timed = 0, recent = 0;
    for (const trk of xml.split("<trk>").slice(1)) {
      const url = (trk.match(/<url>([^<]*)<\/url>/) || [])[1];
      const id = url ? url.split("/").pop() : `anon-${page}-${anon++}`;
      const user = url ? decodeURIComponent(url.split("/")[2]) : null;
      const tr = traces.get(id) || { id, url: url || null, user, segs: [] };
      for (const seg of trk.split("<trkseg>").slice(1)) {
        const pts = [];
        for (const m of seg.matchAll(/<trkpt ([^>]*)>\s*(?:<time>([^<]*)<\/time>)?/g)) {
          points++;
          if (!m[2]) continue;
          const t = Date.parse(m[2]);
          timed++; if (t >= SINCE) recent++;
          pts.push([+attr(m[1], "lat"), +attr(m[1], "lon"), t]);
        }
        if (pts.length > 1) tr.segs.push(pts);
      }
      if (tr.segs.length) traces.set(id, tr);
    }
    await sleep(1000);
    if (!timed) break;                        // only untimed points left
    if ((oldPages = recent ? 0 : oldPages + 1) >= 3) break;   // uploads this far back are all old recordings
  }
  return { traces: [...traces.values()], pages: page, points };
}

// ---------- 2. what's already mapped ----------
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
async function mappedLines([s, w, n, e]) {
  if (process.env.MAPPED_FROM === "api") {
    // Testing only: the OSM API "map" call, for a small square.
    const xml = await (await get(`${OSM_API}/map?bbox=${w},${s},${e},${n}`)).text();
    const nodes = new Map([...xml.matchAll(/<node id="(\d+)"[^>]*lat="([-\d.]+)" lon="([-\d.]+)"/g)].map((m) => [m[1], [+m[2], +m[3]]]));
    return [...xml.matchAll(/<way [^>]*>([\s\S]*?)<\/way>/g)]
      .filter((m) => /k="(highway|aerialway|railway|piste:type)"|k="route" v="ferry"/.test(m[1]))
      // TEST_HIDE_TRAILS=1: pretend paths and tracks aren't mapped, to check that the finder finds them.
      .filter((m) => !process.env.TEST_HIDE_TRAILS || !/k="highway" v="(path|track|footway|bridleway|cycleway)"/.test(m[1]))
      .map((m) => [...m[1].matchAll(/<nd ref="(\d+)"/g)].map((x) => nodes.get(x[1])).filter(Boolean));
  }
  const b = `${s},${w},${n},${e}`;
  const els = await overpass(`[out:json][timeout:200];(way[highway](${b});way[aerialway](${b});way[railway](${b});way[route=ferry](${b});way["piste:type"](${b}););out skel geom;`);
  return els.filter((x) => x.geometry).map((x) => x.geometry.map((p) => [p.lat, p.lon]));
}

// ---------- 3. grid ----------
function makeGrid([s, w, n, e]) {
  const pad = 0.002;   // a little extra so lines crossing the edge still count
  const S = s - pad, W = w - pad, N = n + pad, E = e + pad;
  const my = 110540, mx = 111320 * Math.cos(((S + N) / 2) * Math.PI / 180);
  const cols = Math.ceil((E - W) * mx / CELL), rows = Math.ceil((N - S) * my / CELL);
  const xy = (lat, lon) => [(lon - W) * mx, (lat - S) * my];
  const cell = (x, y) => { const c = Math.floor(x / CELL), r = Math.floor(y / CELL); return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c; };
  return { cols, rows, xy, cell, size: cols * rows };
}
function disk(radiusM, cols) {
  const r = Math.ceil(radiusM / CELL), out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if ((dx * dx + dy * dy) * CELL * CELL <= radiusM * radiusM + CELL * CELL / 2) out.push([dx, dy]);
  return out;
}
// Calls fn(x, y) every `step` metres along a polyline given in metres.
function walk(pts, step, fn) {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) fn(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n);
  }
}
function paint(grid, arr, pts, offsets) {
  walk(pts, CELL / 2, (x, y) => {
    const c0 = Math.floor(x / CELL), r0 = Math.floor(y / CELL);
    for (const [dx, dy] of offsets) {
      const c = c0 + dx, r = r0 + dy;
      if (c >= 0 && r >= 0 && c < grid.cols && r < grid.rows) arr[r * grid.cols + c] = 1;
    }
  });
}

// Douglas-Peucker on points with x, y in metres.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = [pts[a].x, pts[a].y], [bx, by] = [pts[b].x, pts[b].y], len = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i].y) - (ax - pts[i].x) * (by - ay)) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const median = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a, p) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

function findInSquare(box, traces, lines, zoneId) {
  const grid = makeGrid(box);
  const mapped = new Uint8Array(grid.size);
  const buf = disk(MAPPED_BUFFER, grid.cols);
  for (const l of lines) paint(grid, mapped, l.map(([lat, lon]) => grid.xy(lat, lon)), buf);

  // Split traces into clean pieces: in the square, in season, no big jumps, with speeds.
  const winter = WINTER_ZONES.has(zoneId);
  const pieces = [];   // { tr: trace index, pts: [{lat, lon, t, x, y, c, v}] }
  traces.forEach((tr, ti) => {
    for (const seg of tr.segs) {
      let cur = [];
      const flush = () => { if (cur.length > 1) pieces.push({ tr: ti, pts: cur }); cur = []; };
      for (const [lat, lon, t] of seg) {
        const month = new Date(t).getUTCMonth();
        if (t < SINCE || (winter && (month === 11 || month <= 2))) { flush(); continue; }
        const [x, y] = grid.xy(lat, lon), c = grid.cell(x, y);
        if (c < 0) { flush(); continue; }
        const p = cur[cur.length - 1];
        if (p) {
          const d = Math.hypot(x - p.x, y - p.y), dt = (t - p.t) / 1000;
          if (d > MAX_JUMP || dt > MAX_GAP_S || dt < 0) flush();
          else if (d < 0.5) continue;   // standing still
        }
        const q = cur[cur.length - 1];
        const v = q && t > q.t ? Math.hypot(x - q.x, y - q.y) / ((t - q.t) / 1000) * 3.6 : NaN;
        cur.push({ lat, lon, t, x, y, c, v });
      }
      flush();
    }
  });

  // Which traces pass each cell off the map (a 3-cell wide brush, so traces a few metres apart still meet).
  const cellTraces = new Map();
  const brush = disk(CELL * 1.5, grid.cols);
  for (const pc of pieces) {
    const seen = new Set();
    walk(pc.pts.map((p) => [p.x, p.y]), CELL / 2, (x, y) => {
      const c0 = Math.floor(x / CELL), r0 = Math.floor(y / CELL);
      for (const [dx, dy] of brush) {
        const c = c0 + dx, r = r0 + dy;
        if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
        const i = r * grid.cols + c;
        if (mapped[i] || seen.has(i)) continue;
        seen.add(i);
        let s = cellTraces.get(i); if (!s) cellTraces.set(i, (s = new Set()));
        s.add(pc.tr);
      }
    });
  }
  const support = (c) => { const s = cellTraces.get(c); return s ? s.size : 0; };
  if (process.env.DEBUG) { let m = 0; mapped.forEach((v) => (m += v)); let s2 = 0; cellTraces.forEach((s) => s.size >= MIN_TRACES && s2++); console.log(`    debug: ${pieces.length} pieces, ${pieces.reduce((a, p) => a + p.pts.length, 0)} points, ${(m / grid.size * 100).toFixed(1)}% mapped, ${cellTraces.size} off-map cells, ${s2} shared`); }

  // Runs: stretches of one trace that stay off the map on cells other traces share.
  const runs = [];
  for (const pc of pieces) {
    let cur = [], gap = 0;
    const flush = () => { if (cur.length > 1 && runLen(cur) >= MIN_LEN) runs.push({ tr: pc.tr, pts: cur }); cur = []; gap = 0; };
    for (const p of pc.pts) {
      if (mapped[p.c]) { flush(); continue; }
      if (support(p.c) >= MIN_TRACES) { cur.push(p); gap = 0; }
      else if (cur.length && (gap += Math.hypot(p.x - cur[cur.length - 1].x, p.y - cur[cur.length - 1].y)) <= 30) cur.push(p);
      else flush();
    }
    flush();
  }

  // Longest runs first; each new find only keeps the part not already covered by an earlier one.
  runs.sort((a, b) => runLen(b.pts) - runLen(a.pts));
  const covered = new Uint8Array(grid.size);
  const cover = disk(24, grid.cols);
  const finds = [];
  for (const run of runs) {
    let cur = [];
    const take = () => {
      while (cur.length && !(support(cur[cur.length - 1].c) >= MIN_TRACES)) cur.pop();
      if (cur.length > 1 && runLen(cur) >= MIN_LEN) {
        const f = describe(cur, run.tr);
        if (f) { finds.push(f); paint(grid, covered, cur.map((p) => [p.x, p.y]), cover); }
      }
      cur = [];
    };
    for (const p of run.pts) { if (covered[p.c]) take(); else cur.push(p); }
    take();
  }
  return { finds, pieces: pieces.length, runs: runs.length };

  // Who rides this stretch, how fast, and since when.
  function describe(pts, own) {
    const tally = new Map();
    for (const p of pts) for (const ti of cellTraces.get(p.c) || []) tally.set(ti, (tally.get(ti) || 0) + 1);
    const riders = [...tally].filter(([, n]) => n >= pts.length * 0.5).map(([ti]) => ti);
    if (!riders.includes(own)) riders.push(own);
    if (riders.length < MIN_TRACES) return null;
    const cells = new Set(pts.map((p) => p.c));
    const kinds = { bike: 0, walk: 0, vehicle: 0 }, bikeSpeeds = [];
    let first = Infinity, last = 0;
    const riderSet = new Set(riders);
    const speeds = new Map(riders.map((ti) => [ti, []]));
    for (const pc of pieces) {
      if (!riderSet.has(pc.tr)) continue;
      for (const p of pc.pts) if (cells.has(p.c)) {
        if (p.v > 0) speeds.get(pc.tr).push(p.v);
        first = Math.min(first, p.t); last = Math.max(last, p.t);
      }
    }
    for (const [ti, v] of speeds) {
      if (v.length < 3) continue;
      const p80 = pct(v, 0.8), med = median(v);
      const k = p80 > VEHICLE_KMH || med > 35 ? "vehicle" : p80 >= BIKE_KMH ? "bike" : "walk";
      kinds[k]++;
      if (k === "bike") bikeSpeeds.push(med);
    }
    const timed = kinds.bike + kinds.walk + kinds.vehicle;
    if (!timed || kinds.vehicle * 2 > timed) return null;   // mostly cars, boats or lifts
    const users = new Set(riders.map((ti) => traces[ti].user || traces[ti].id));
    const line = simplify(pts, 3);
    return {
      g: line.flatMap((p) => [round(p.lat), round(p.lon)]),
      m: Math.round(runLen(pts)),
      n: riders.length,
      u: users.size,
      bike: kinds.bike, walk: kinds.walk,
      k: kinds.bike * 2 >= timed ? "bike" : "walk",
      s: bikeSpeeds.length ? Math.round(median(bikeSpeeds)) : null,
      f: new Date(first).toISOString().slice(0, 10),
      l: new Date(last).toISOString().slice(0, 10),
      tr: riders.map((ti) => traces[ti].url).filter(Boolean).slice(0, 6),
    };
  }
}
function runLen(pts) { let m = 0; for (let i = 1; i < pts.length; i++) m += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return m; }

// ---------- 5. elevation: drop perfectly flat finds (boats on the sea or a lake) ----------
async function addElevation(finds) {
  const todo = finds.filter((f) => f.up == null);
  for (let i = 0; i < todo.length; i += 10) {
    const batch = todo.slice(i, i + 10);
    const pts = batch.flatMap((f) => { const g = f.g, n = g.length / 2, idx = [...new Set([0, Math.floor(n / 4), Math.floor(n / 2), Math.floor(3 * n / 4), n - 1])]; return idx.map((j) => [f, g[j * 2], g[j * 2 + 1]]); });
    try {
      const res = await get(`https://api.open-meteo.com/v1/elevation?latitude=${pts.map((p) => p[1]).join(",")}&longitude=${pts.map((p) => p[2]).join(",")}`, {}, 2);
      const { elevation } = await res.json();
      batch.forEach((f) => { const e = pts.map((p, j) => (p[0] === f ? elevation[j] : null)).filter((x) => x != null); f.lo = Math.round(Math.min(...e)); f.hi = Math.round(Math.max(...e)); f.up = 1; });
    } catch (e) { log(`    elevation: ${e.message}`); return finds; }
    await sleep(300);
  }
  return finds.filter((f) => f.up == null || f.hi - f.lo >= 2 || f.m < 300).map((f) => { delete f.up; return f; });
}

// ---------- run ----------
if (!existsSync(DATA)) mkdirSync(DATA);
const builtAt = new Date().toISOString().slice(0, 19) + "Z";
const before = new Map(ZONES.map((z) => [z.id, readJson(`unmapped-${z.id}.json`)]));
const allSquares = new Map();
ZONES.forEach((z) => gridTiles(z.box).forEach((t) => { if (!allSquares.has(t.key)) allSquares.set(t.key, { ...t, zone: z.id }); }));
// Oldest (or never) done squares first, so the whole region gets refreshed in turn.
const doneAt = (key) => { let at = 0; before.forEach((f) => { if (f && f.tiles && f.tiles[key]) at = Math.max(at, Date.parse(f.tiles[key].at)); }); return at; };
let order = [...allSquares.values()].sort((a, b) => doneAt(a.key) - doneAt(b.key));
if (process.env.SQUARES) { const want = process.env.SQUARES.split(";"); order = order.filter((t) => want.includes(t.key)); }
// Testing: one small box (south,west,north,east), finds written to the file named by TEST_OUT.
const TEST_BOX = process.env.TEST_BOX && process.env.TEST_BOX.split(",").map(Number);
if (TEST_BOX) order = [{ key: "test", box: TEST_BOX, zone: process.env.TEST_ZONE || "sqm" }];
log(`Unmapped trails: ${allSquares.size} squares, up to ${PAGE_BUDGET} pages of traces this run, uploads since ${new Date(SINCE).toISOString().slice(0, 10)}.`);

const results = new Map();
for (const sq of order) {
  if (pagesUsed >= PAGE_BUDGET) { log(`Page budget used up; the other squares wait for the next run.`); break; }
  const t0 = Date.now();
  try {
    const tr = await fetchTraces(sq.box);
    const lines = tr.traces.length ? await mappedLines(sq.box) : [];
    const r = findInSquare(sq.box, tr.traces, lines, sq.zone);
    const [s, w, n, e] = sq.box;
    const inside = (f) => { const i = Math.floor(f.g.length / 4) * 2; return f.g[i] >= s && f.g[i] < n && f.g[i + 1] >= w && f.g[i + 1] < e; };
    const finds = await addElevation(r.finds.filter(inside));
    results.set(sq.key, { at: builtAt, finds });
    log(`  ${sq.key}: ${tr.pages} pages, ${tr.traces.length} traces, ${lines.length} mapped lines, ${r.runs} off-map runs, ${finds.length} finds (${finds.filter((f) => f.k === "bike").length} at bike speed). ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) { log(`  ${sq.key}: failed (${e.message}), keeping last good data`); }
}

if (TEST_BOX) { writeFileSync(process.env.TEST_OUT || "unmapped-test.json", JSON.stringify(results.get("test") || null)); process.exit(0); }
for (const z of ZONES) {
  const old = before.get(z.id);
  const out = { v: 1, builtAt, tiles: {}, items: [] };
  for (const { key } of gridTiles(z.box)) {
    const r = results.get(key) || (old && old.tiles && old.tiles[key] ? { at: old.tiles[key].at, finds: old.items.filter((f) => f.sq === key) } : null);
    if (!r) continue;
    out.tiles[key] = { at: r.at };
    r.finds.forEach((f) => out.items.push({ ...f, sq: key, id: f.id || findId(f) }));
  }
  if (!Object.keys(out.tiles).length) continue;
  writeFileSync(new URL(`unmapped-${z.id}.json`, DATA), JSON.stringify(out));
  log(`${z.name}: ${out.items.length} possible unmapped trails`);
}
// Stable id from the line's ends, above any OpenStreetMap way id, so the site can tell them apart.
function findId(f) {
  let h = 2166136261;
  for (const ch of f.g.slice(0, 2).concat(f.g.slice(-2)).join(",")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return 9e15 + h;
}
log(`Done: ${results.size} squares, ${pagesUsed} pages of GPS traces.`);
