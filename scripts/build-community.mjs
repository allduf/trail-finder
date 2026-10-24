// "Help improve Trail Finder": every night (.github/workflows/community-data.yml) the ride lines riders chose to share
// (share.js -> Supabase table shared_rides, supabase/ride-share.sql) become data/community.json, read by community.js:
//   ways   per trail way of data/mtb-<zone>.json: [riders in the last 12 months, riders in 2 years, passes from its
//          first point to its last, passes the other way]. Only ways that 3 or more different riders rode.
//   finds  stretches 3 or more different riders rode together where nothing is mapped (no trail, path, track or
//          road within 20 m on OpenStreetMap, checked with Overpass), 150 m or longer.
// Nothing about one rider is written: only counts and lines several riders share. Lines older than 2 years are
// deleted from the table here. Needs the SUPABASE_SECRET_KEY secret (the table is closed to the site's public key).
//
// Run: SUPABASE_SECRET_KEY=... node scripts/build-community.mjs   (Node 18 or newer, no packages)
//   ROWS_FROM=file.json   read the shared rows from a file instead of Supabase (testing); NO_OVERPASS=1 skip the map check
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const SUPABASE_URL = "https://fohdmserpbkurcvcrbbb.supabase.co";
const KEY = process.env.SUPABASE_SECRET_KEY;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const OVERPASS = JSON.parse(html.match(/const OVERPASS = (\[[^\]]+\]);/)[1]);
const MIN_RIDERS = 3;          // alex: results only when 3 or more riders back them up
const STEP = 8;                // m between samples along lines
const ON_TRAIL = 20;           // m: a sample this close to a trail is on it
const OFF_MAP = 30;            // m: further than this from every trail, the sample may be on something unmapped
const MAPPED = 20;             // m: a stretch this close to anything on OpenStreetMap follows it
const MIN_FIND = 150;          // m, shortest find
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { v: 1, builtAt: new Date().toISOString(), riders: 0, rides: 0, ways: {}, finds: [] };
const write = () => writeFileSync("data/community.json", JSON.stringify(out));

// ---------- the shared rows ----------
const headers = KEY ? { apikey: KEY, ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }) } : null;
const twoYears = new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10);
const oneYear = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
let rows = [];
if (process.env.ROWS_FROM) rows = JSON.parse(readFileSync(process.env.ROWS_FROM, "utf8"));
else if (!KEY) { console.log("No SUPABASE_SECRET_KEY: writing an empty file."); write(); process.exit(0); }
else {
  const del = await fetch(`${SUPABASE_URL}/rest/v1/shared_rides?month=lt.${twoYears}`, { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } });
  if (!del.ok) console.log(`Couldn't delete old lines: HTTP ${del.status} ${await del.text()}`);
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/shared_rides?select=contributor,month,line&order=contributor,ride`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
    if (r.status === 404 || r.status === 400) { console.log(`shared_rides isn't set up yet (HTTP ${r.status}): writing an empty file.`); write(); process.exit(0); }
    if (!r.ok) throw new Error(`Supabase shared_rides: HTTP ${r.status} ${await r.text()}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
}
out.rides = rows.length;
out.riders = new Set(rows.map((r) => r.contributor)).size;
console.log(`${rows.length} shared rides from ${out.riders} riders`);

// ---------- flat geometry ----------
const K = Math.cos(50 * Math.PI / 180);
const metres = (a, b) => { const dy = (a[0] - b[0]) * 111195, dx = (a[1] - b[1]) * 111195 * Math.cos((a[0] + b[0]) * Math.PI / 360); return Math.sqrt(dx * dx + dy * dy); };
// Points every STEP m along a line, each [lat, lon, metres along]
function resample(line) {
  const s = [];
  let along = 0;
  for (let i = 0; i < line.length; i++) {
    if (i) {
      const a = line[i - 1], b = line[i], d = metres(a, b);
      if (d > 200) { s.push(null); along += d; continue; }   // a gap in the recording
      const n = Math.max(1, Math.floor(d / STEP));
      for (let k = 1; k <= n; k++) s.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, along + d * k / n]);
      along += d;
    } else s.push([line[0][0], line[0][1], 0]);
  }
  return s;
}
const CELL = 0.0004;   // ~44 m of latitude: a 3 x 3 look always sees 30 m
const cellKey = (y, x) => y * 1e6 + x;
const cellOf = (p) => [Math.floor(p[0] / CELL), Math.floor(p[1] * K / CELL)];
function near(grid, p) {
  const [y, x] = cellOf(p), list = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const c = grid.get(cellKey(y + dy, x + dx)); if (c) list.push(c); }
  return list;
}
function put(grid, p, v) { const [y, x] = cellOf(p), k = cellKey(y, x); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(v); }

// The rows as sampled pieces, and the coarse squares they touch (only trails there are loaded).
const pieces = [], touched = new Set(), coarse = (p) => Math.floor(p[0] * 20) + ":" + Math.floor(p[1] * 20);
rows.forEach((r) => {
  const recent = r.month >= oneYear;
  (Array.isArray(r.line) ? r.line : []).forEach((ln) => {
    if (!Array.isArray(ln) || ln.length < 2) return;
    const s = resample(ln.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])));
    s.forEach((p) => { if (p) for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) touched.add(Math.floor(p[0] * 20) + dy + ":" + (Math.floor(p[1] * 20) + dx)); });
    pieces.push({ who: r.contributor, recent, s });
  });
});

// ---------- the trails (data/mtb-<zone>.json), sampled where riders went ----------
const ways = [], trailGrid = new Map();
for (const f of readdirSync("data").filter((n) => /^mtb-\w+\.json$/.test(n)).sort()) {
  const j = JSON.parse(readFileSync(`data/${f}`, "utf8"));
  for (const [id, w] of Object.entries(j.ways || {})) {
    if (!w.g || w.g.length < 4) continue;
    const g = [];
    for (let i = 0; i < w.g.length; i += 2) g.push([w.g[i], w.g[i + 1]]);
    if (!g.some((p) => touched.has(coarse(p)))) continue;
    const wi = ways.length, s = resample(g).filter(Boolean);
    ways.push({ id, len: s.length ? s[s.length - 1][2] : 0, recent: new Set(), all: new Set(), f: 0, b: 0 });
    s.forEach((p) => put(trailGrid, p, [p[0], p[1], wi, p[2]]));
  }
}
console.log(`${ways.length} trail ways near the shared rides`);

// ---------- which trail each sample is on; passes and their direction ----------
const offGrid = new Map();   // samples far from every trail: who rode there
for (const pc of pieces) {
  pc.on = pc.s.map((p) => {
    if (!p) return null;
    let best = null, bd = Infinity;
    for (const c of near(trailGrid, p)) for (const q of c) { const d = metres(p, q); if (d < bd) { bd = d; best = q; } }
    if (bd > OFF_MAP) put(offGrid, p, pc.who);
    return bd <= ON_TRAIL ? best : (bd > OFF_MAP ? -1 : null);
  });
  // runs on one way (short wobbles off it allowed): a pass when it covers half the way or 100 m of it
  let w = -1, a0 = 0, a1 = 0, miss = 0;
  const end = () => {
    if (w < 0) return;
    const W = ways[w], cover = Math.abs(a1 - a0);
    if (cover >= Math.min(100, W.len * 0.5)) {
      W.all.add(pc.who); if (pc.recent) W.recent.add(pc.who);
      if (cover >= 30) { if (a1 > a0) W.f++; else W.b++; }
    }
    w = -1;
  };
  pc.on.forEach((q) => {
    if (q && q !== -1 && q[2] === w) { a1 = q[3]; miss = 0; return; }
    if (q && q !== -1) { end(); w = q[2]; a0 = a1 = q[3]; miss = 0; return; }
    if (++miss > 4) end();
  });
  end();
}
ways.forEach((W) => { if (W.all.size >= MIN_RIDERS) out.ways[W.id] = [W.recent.size, W.all.size, W.f, W.b]; });
console.log(`${Object.keys(out.ways).length} ways ridden by ${MIN_RIDERS}+ riders`);

// ---------- stretches off every trail that several riders share ----------
let cands = [];
for (const pc of pieces) {
  let run = [];
  const flush = () => {
    if (run.length > 2 && run[run.length - 1].p[2] - run[0].p[2] >= MIN_FIND) {
      // riders seen along at least 60% of it
      const cnt = new Map();
      run.forEach((x) => x.who.forEach((h) => cnt.set(h, (cnt.get(h) || 0) + 1)));
      const riders = [...cnt].filter(([, c]) => c >= run.length * 0.6).length;
      if (riders >= MIN_RIDERS) cands.push({ g: run.map((x) => [x.p[0], x.p[1]]), m: run[run.length - 1].p[2] - run[0].p[2], riders });
    }
    run = [];
  };
  pc.s.forEach((p, i) => {
    if (!p || pc.on[i] !== -1) { flush(); return; }
    const who = new Set();
    for (const c of near(offGrid, p)) c.forEach((h) => who.add(h));
    if (who.size >= MIN_RIDERS) run.push({ p, who }); else flush();
  });
  flush();
}
// one line per stretch: the longest, others that mostly follow it are dropped
cands.sort((a, b) => b.m - a.m);
const kept = [], keptGrid = new Map();
for (const c of cands) {
  let hit = 0;
  for (const p of c.g) if (near(keptGrid, p).some((l) => l.some((q) => metres(p, q) < 25))) hit++;
  if (hit >= c.g.length * 0.5) continue;
  kept.push(c);
  c.g.forEach((p) => put(keptGrid, p, p));
}
console.log(`${kept.length} possible new trails before the map check`);

// ---------- the map check: anything on OpenStreetMap near them ----------
async function overpass(q) {
  let last;
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(OVERPASS[i % OVERPASS.length], { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "trail-finder community data (github.com/allduf/trail-finder)" }, signal: AbortSignal.timeout(200000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (j.remark && /error/i.test(j.remark)) throw new Error(j.remark);
      return j.elements;
    } catch (e) { last = e; await sleep(15000 * (i + 1)); }
  }
  throw last;
}
let old = [];
try { old = JSON.parse(readFileSync("data/community.json", "utf8")).finds || []; } catch {}
if (process.env.NO_OVERPASS) out.finds = kept.map((c) => ({ g: thin(c.g), riders: c.riders, m: Math.round(c.m) }));
else {
  try {
    for (let i = 0; i < kept.length; i += 15) {
      const batch = kept.slice(i, i + 15);
      const lines = batch.map((c) => thin(c.g, 25).map((p) => p[0].toFixed(5) + "," + p[1].toFixed(5)).join(","));
      const els = await overpass(`[out:json][timeout:180];(${lines.map((l) => `way[highway](around:40,${l});way["abandoned:highway"](around:40,${l});way[railway](around:40,${l});`).join("")});out geom;`);
      const mg = new Map();
      els.forEach((e) => (e.geometry || []).forEach((p, k, a) => {
        put(mg, [p.lat, p.lon], [p.lat, p.lon]);
        const q = a[k + 1]; if (!q) return;
        const n = Math.floor(metres([p.lat, p.lon], [q.lat, q.lon]) / STEP);
        for (let s = 1; s < n; s++) { const x = [p.lat + (q.lat - p.lat) * s / n, p.lon + (q.lon - p.lon) * s / n]; put(mg, x, x); }
      }));
      for (const c of batch) {
        // keep the runs of it that are clear of everything mapped
        let run = [], along = 0, prev = null;
        const flush = () => { if (run.length > 2 && along >= MIN_FIND) out.finds.push({ g: thin(run), riders: c.riders, m: Math.round(along) }); run = []; along = 0; prev = null; };
        for (const p of c.g) {
          const mapped = near(mg, p).some((l) => l.some((q) => metres(p, q) < MAPPED));
          if (mapped) { flush(); continue; }
          if (prev) along += metres(prev, p);
          run.push(p); prev = p;
        }
        flush();
      }
      await sleep(2000);
    }
  } catch (e) {
    console.log(`OpenStreetMap check failed (${e.message}): keeping last night's possible new trails.`);
    out.finds = old;
  }
}
function thin(g, step = 8) {
  const o = [];
  g.forEach((p, i) => { if (!o.length || i === g.length - 1 || metres(o[o.length - 1], p) >= step) o.push([+p[0].toFixed(5), +p[1].toFixed(5)]); });
  return o;
}
console.log(`${out.finds.length} possible new trails`);
write();
