// Weekly job (see .github/workflows/ski-heat.yml): a winter GPS heatmap for the site's Skiing mode, from the
// public GPS traces people upload to OpenStreetMap.
//
// Writes data/ski-heat.json: for each map square, how many different winter traces (December to April) pass
// through each ~33 m cell. The site paints it as a heatmap under the ski routes.
//
// Why only OpenStreetMap's GPS traces: Strava's and Trailforks' heatmaps don't allow copying or deriving data
// from them. OpenStreetMap's public traces can be used (ODbL, "© OpenStreetMap contributors").
//
// Per map square:
//   1. Download the square's public GPS traces (newest uploads first) from the OpenStreetMap API.
//   2. Keep the points recorded from December to April, cut where the recording jumps or pauses.
//   3. Leave out roads, railways, ferries and lifts (Overpass), so driving to the trailhead and riding the
//      chairlift don't show up, and anything faster than 90 km/h (a plane, a GPS glitch).
//   4. Count, per cell, the different traces that pass through it.
//
// Squares are done in rotation within a page budget, oldest first; squares not done keep their last data.
//
// Run: node scripts/build-ski-heat.mjs   (Node 18 or newer, no packages needed)
//   ONLY=wh             just one zone            SQUARES=50.00,-123.00   just these squares
//   PAGE_BUDGET=1500    trace pages in this run
//   TEST_BOX=s,w,n,e TEST_OUT=file.json MAPPED_FROM=api   try one small box, roads from the OSM API instead of Overpass

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const DATA = new URL("data/", root);
const UA = "trail-finder weekly ski heatmap (https://github.com/allduf/trail-finder)";

function grab(re, what) { const m = html.match(re); if (!m) throw new Error(`Couldn't find ${what} in index.html`); return m; }
const OVERPASS = process.env.OVERPASS_URLS ? process.env.OVERPASS_URLS.split(",") : JSON.parse(grab(/const OVERPASS = (\[[^\]]+\]);/, "the Overpass servers")[1]);
const OSM_API = process.env.OSM_API || grab(/const OSM_API = "([^"]+)";/, "the OSM API address")[1];
const [, TILE_LAT, TILE_LON] = grab(/const TILE_LAT = ([\d.]+), TILE_LON = ([\d.]+);/, "the map square size").map(Number);
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }))
  .filter((z) => !process.env.ONLY || process.env.ONLY.split(",").includes(z.id));
if (!ZONES.length) throw new Error("Couldn't read the zones from index.html");

// ---------- settings ----------
const CELL_LAT = 0.0003, CELL_LON = 0.00045;   // ~33 m x 32 m at 50° N; the site reads these from the file
const ROAD_BUFFER = 25;      // m around roads, railways, ferries and lifts
const MAX_JUMP = 250;        // m between two GPS points: further apart is a gap in the recording
const MAX_GAP_S = 90;        // s between two GPS points: longer is a gap in the recording
const MAX_KMH = 90;          // faster than this is a plane, a car on an unmapped road, or a GPS glitch
const WINTER = (t) => { const m = new Date(t).getUTCMonth(); return m === 11 || m <= 3; };   // December to April
const PAGES_PER_SQUARE = +(process.env.PAGES_PER_SQUARE || 200);   // 5000 GPS points per page
const PAGE_BUDGET = +(process.env.PAGE_BUDGET || 1500);            // pages per run, all squares together

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

// ---------- 2. roads, railways, ferries and lifts ----------
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
async function roadLines([s, w, n, e]) {
  if (process.env.MAPPED_FROM === "api") {   // testing only: the OSM API "map" call, for a small box
    const xml = await (await get(`${OSM_API}/map?bbox=${w},${s},${e},${n}`)).text();
    const nodes = new Map([...xml.matchAll(/<node id="(\d+)"[^>]*lat="([-\d.]+)" lon="([-\d.]+)"/g)].map((m) => [m[1], [+m[2], +m[3]]]));
    const re = new RegExp(`k="highway" v="(${ROADS})"|k="railway" v="rail"|k="route" v="ferry"|k="aerialway"`);
    return [...xml.matchAll(/<way [^>]*>([\s\S]*?)<\/way>/g)].filter((m) => re.test(m[1]))
      .map((m) => [...m[1].matchAll(/<nd ref="(\d+)"/g)].map((x) => nodes.get(x[1])).filter(Boolean));
  }
  const b = `${s},${w},${n},${e}`;
  const els = await overpass(`[out:json][timeout:200];(way[highway~"^(${ROADS})$"](${b});way[railway=rail](${b});way[route=ferry](${b});way[aerialway](${b}););out skel geom;`);
  return els.filter((x) => x.geometry).map((x) => x.geometry.map((p) => [p.lat, p.lon]));
}

// ---------- 3 and 4. count traces per cell ----------
function heatSquare([s, w, n, e], traces, roads) {
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
        if (!WINTER(t) || cellOf(lat, lon) < 0) { flush(); continue; }
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

// ---------- run ----------
if (!existsSync(DATA)) mkdirSync(DATA);
const builtAt = new Date().toISOString().slice(0, 19) + "Z";
const before = readJson("ski-heat.json");
const allSquares = new Map();
ZONES.forEach((z) => gridTiles(z.box).forEach((t) => { if (!allSquares.has(t.key)) allSquares.set(t.key, t); }));
const doneAt = (key) => (before?.tiles?.[key] ? Date.parse(before.tiles[key].at) : 0);
let order = [...allSquares.values()].sort((a, b) => doneAt(a.key) - doneAt(b.key));
if (process.env.SQUARES) { const want = process.env.SQUARES.split(";"); order = order.filter((t) => want.includes(t.key)); }
const TEST_BOX = process.env.TEST_BOX && process.env.TEST_BOX.split(",").map(Number);
if (TEST_BOX) order = [{ key: "test", box: TEST_BOX }];
log(`Ski heatmap: ${allSquares.size} squares, up to ${PAGE_BUDGET} pages of traces this run.`);

const results = new Map();
for (const sq of order) {
  if (pagesUsed >= PAGE_BUDGET) { log(`Page budget used up; the other squares wait for the next run.`); break; }
  const t0 = Date.now();
  try {
    const tr = await fetchTraces(sq.box);
    const roads = tr.traces.length ? await roadLines(sq.box) : [];
    const h = heatSquare(sq.box, tr.traces, roads);
    results.set(sq.key, { at: builtAt, box: sq.box, n: h.traces, c: h.c });
    log(`  ${sq.key}: ${tr.pages} pages, ${tr.traces.length} traces, ${h.traces} with winter points, ${roads.length} roads/lifts, ${h.c.length / 3} cells. ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) { log(`  ${sq.key}: failed (${e.message}), keeping last good data`); }
}

const out = { v: 1, builtAt, cell: [CELL_LAT, CELL_LON], months: "Dec-Apr", tiles: {} };
if (TEST_BOX) out.tiles.test = results.get("test") || null;
else for (const key of allSquares.keys()) {
  const r = results.get(key) || before?.tiles?.[key];
  if (r) out.tiles[key] = r;
}
const file = TEST_BOX ? process.env.TEST_OUT || "ski-heat-test.json" : new URL("ski-heat.json", DATA);
writeFileSync(file, JSON.stringify(out));
const cells = Object.values(out.tiles).reduce((a, t) => a + (t ? t.c.length / 3 : 0), 0);
log(`Done: ${results.size} squares this run, ${Object.keys(out.tiles).length} in the file, ${cells} cells, ${pagesUsed} pages of GPS traces.`);
