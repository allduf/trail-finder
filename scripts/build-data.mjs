// Nightly job (see .github/workflows/trail-data.yml): pre-builds the region's trail data so
// visitors load small files from the website instead of each asking Overpass, a free shared server.
//
// Writes, for each zone of the region:
//   data/trails-<zone>.json  ways first mapped in the last MAX_MONTHS, per map square, with their first-version dates
//   data/names-<zone>.json   every named path, track and trail route, for the name search
//
// The zones, map-square grid and Overpass queries are read from index.html, so they always match the site.
// The site still classifies the trails itself (MTB tagged, looks like MTB, unofficial...).
// If a square or zone fails tonight, its data from the last good run is kept.
//
// Run: node scripts/build-data.mjs   (Node 18 or newer, no packages needed)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const DATA = new URL("data/", root);
const UA = "trail-finder nightly data (https://github.com/allduf/trail-finder)";

// ---------- settings read from the site ----------
function grab(re, what) { const m = html.match(re); if (!m) throw new Error(`Couldn't find ${what} in index.html`); return m; }
function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Couldn't find function ${name} in index.html`);
  let depth = 0, i = html.indexOf("{", start);
  for (; i < html.length; i++) { if (html[i] === "{") depth++; else if (html[i] === "}" && --depth === 0) break; }
  return html.slice(start, i + 1);
}
const OVERPASS = process.env.OVERPASS_URLS ? process.env.OVERPASS_URLS.split(",") : JSON.parse(grab(/const OVERPASS = (\[[^\]]+\]);/, "the Overpass servers")[1]);
const OSM_API = process.env.OSM_API || grab(/const OSM_API = "([^"]+)";/, "the OSM API address")[1];
const MAX_MONTHS = +grab(/const MAX_MONTHS = (\d+);/, "MAX_MONTHS")[1];
const [, TILE_LAT, TILE_LON] = grab(/const TILE_LAT = ([\d.]+), TILE_LON = ([\d.]+);/, "the map square size").map(Number);
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
const overpassQuery = new Function(`return ${functionSource("overpassQuery")}`)();
const namesQuery = new Function(`return ${functionSource("namesQuery")}`)();

// Stand-in for the Leaflet bounds the site's query functions expect.
const bounds = ([s, w, n, e]) => ({ getSouth: () => s, getWest: () => w, getNorth: () => n, getEast: () => e });
const quarters = ([s, w, n, e]) => { const cs = (s + n) / 2, cw = (w + e) / 2; return [[s, w, cs, cw], [s, cw, cs, e], [cs, w, n, cw], [cs, cw, n, e]]; };
// Same grid as gridTiles() in index.html, so the square keys match.
function gridTiles([S, W, N, E]) {
  const out = [];
  for (let s = Math.floor(S / TILE_LAT) * TILE_LAT; s < N; s += TILE_LAT)
    for (let w = Math.floor(W / TILE_LON) * TILE_LON; w < E; w += TILE_LON)
      out.push({ key: `${s.toFixed(2)},${w.toFixed(2)}`, box: [s, w, s + TILE_LAT, w + TILE_LON] });
  return out;
}
function monthsAgo(n) { const d = new Date(); d.setMonth(d.getMonth() - n); return d; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// GitHub stops the job after timeout-minutes (see the workflow). Stop asking Overpass well before that, so what
// was collected still gets saved: squares and name lists not reached tonight keep their last good data,
// and go first tomorrow night.
const started = Date.now();
const TRAILS_MINUTES = +process.env.TRAILS_MINUTES || 80, NAMES_MINUTES = +process.env.NAMES_MINUTES || 100;
let deadline = started + TRAILS_MINUTES * 60e3;
const outOfTime = () => Date.now() >= deadline;

// ---------- Overpass, politely: one query at a time, long waits when a server is busy ----------
async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (outOfTime()) throw lastErr || new Error("out of time for tonight");
    const url = OVERPASS[attempt % OVERPASS.length];
    const host = new URL(url).host;
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(query), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, signal: AbortSignal.timeout(180000) });
      if (res.ok) {
        const json = await res.json();
        if (json.remark && /error/i.test(json.remark)) throw Object.assign(new Error(`${host}: ${json.remark}`), { heavy: true });
        await sleep(2000);
        return json;
      }
      lastErr = new Error(`${host}: HTTP ${res.status}`);
      if (res.status !== 429 && res.status !== 504) throw lastErr;
    } catch (e) {
      if (e.heavy || /HTTP 4\d\d/.test(e.message) && !/HTTP 429/.test(e.message)) throw e;
      lastErr = e;
    }
    const wait = Math.min(30000 * 2 ** Math.floor(attempt / OVERPASS.length), 240000) * (process.env.FAST_RETRY ? 0.001 : 1);
    if (Date.now() + wait >= deadline) break;   // no time left tonight to wait for a busy server
    log(`    ${lastErr.message}; trying again in ${Math.round(wait / 1000)} s`);
    await sleep(wait);
  }
  throw lastErr;
}
// A square too heavy for the server is fetched as 4 smaller ones (2 levels at most), like the site does.
async function fetchBox(box, makeQuery, depth = 0) {
  try { return (await overpass(makeQuery(bounds(box)))).elements; }
  catch (e) {
    if (!e.heavy || depth >= 2) throw e;
    log(`    too heavy, splitting in 4`);
    const seen = new Map();
    for (const q of quarters(box)) for (const el of await fetchBox(q, makeQuery, depth + 1)) seen.set(el.type + el.id, el);
    return [...seen.values()];
  }
}

// ---------- first-version dates from the OpenStreetMap API ----------
const unxml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
async function fetchV1(ids) {
  const out = new Map();
  async function get(chunk) {
    let res;
    try { res = await fetch(`${OSM_API}/ways?ways=${chunk.map((id) => id + "v1").join(",")}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) }); }
    catch (e) { log(`    first versions: ${e.message}`); return; }
    if (!res.ok) {
      if (chunk.length === 1) return;   // redacted or deleted first version: the site will try again itself
      const mid = Math.ceil(chunk.length / 2);
      await get(chunk.slice(0, mid)); await get(chunk.slice(mid));
      return;
    }
    for (const m of (await res.text()).matchAll(/<way\b([^>]*)>/g)) {
      const a = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], unxml(x[2])]));
      out.set(+a.id, { t: a.timestamp, u: a.user || "", c: +a.changeset });
    }
  }
  for (let i = 0; i < ids.length; i += 100) { await get(ids.slice(i, i + 100)); await sleep(500); }
  return out;
}

// ---------- build ----------
const readJson = (name) => { try { return JSON.parse(readFileSync(new URL(name, DATA), "utf8")); } catch { return null; } };
const round = (n) => Math.round(n * 1e5) / 1e5;
const builtAt = new Date().toISOString().slice(0, 19) + "Z";
const cutoff = monthsAgo(MAX_MONTHS).toISOString();
const since = cutoff.slice(0, 19) + "Z";
if (!existsSync(DATA)) mkdirSync(DATA);

// Data from the last good run: first-version dates never change, and failed squares fall back to it.
const before = new Map(ZONES.map((z) => [z.id, readJson(`trails-${z.id}.json`)]));
const knownV1 = new Map();
for (const f of before.values()) for (const [id, w] of Object.entries((f && f.ways) || {})) if (w.ft) knownV1.set(+id, { t: w.ft, u: w.fu, c: w.fc });

const tiles = new Map();   // key -> { at, ways: Map(id -> way), rels: [] }
const allTiles = new Map();
ZONES.forEach((z) => gridTiles(z.box).forEach((t) => allTiles.set(t.key, t)));
// Squares whose data is oldest (or missing) go first, so a slow night still moves every square forward over a few nights.
const lastAt = (files, key) => { for (const f of files) if (f && f.tiles && f.tiles[key]) return Date.parse(f.tiles[key].at) || 0; return 0; };
const order = [...allTiles.values()].sort((a, b) => lastAt(before.values(), a.key) - lastAt(before.values(), b.key));
log(`Trails: ${allTiles.size} map squares, ways first mapped since ${since.slice(0, 10)}, for up to ${TRAILS_MINUTES} minutes.`);
let failedTiles = 0, skippedTiles = 0, n = 0;
for (const t of order) {
  n++;
  if (outOfTime()) { skippedTiles++; continue; }
  try {
    const els = await fetchBox(t.box, (b) => overpassQuery(b, since));
    const ways = els.filter((e) => e.type === "way" && e.geometry);
    const need = ways.filter((w) => w.version > 1 && !knownV1.has(w.id)).map((w) => w.id);
    if (need.length) (await fetchV1(need)).forEach((v, id) => knownV1.set(id, v));
    const kept = new Map();
    for (const w of ways) {
      const v1 = w.version === 1 ? { t: w.timestamp, u: w.user || "", c: w.changeset } : knownV1.get(w.id);
      if (v1 && v1.t < cutoff) continue;   // an older trail that was only edited
      kept.set(w.id, { v: w.version, t: w.timestamp, u: w.user || "", c: w.changeset, tags: w.tags || {}, g: w.geometry.flatMap((p) => [round(p.lat), round(p.lon)]),
        ...(v1 ? { ft: v1.t, fu: v1.u, fc: v1.c } : {}) });
    }
    const rels = els.filter((e) => e.type === "relation").map((r) => ({ id: r.id, tags: r.tags || {}, ways: (r.members || []).filter((m) => m.type === "way" && kept.has(m.ref)).map((m) => m.ref) })).filter((r) => r.ways.length);
    tiles.set(t.key, { at: builtAt, ways: kept, rels });
    log(`  ${n}/${allTiles.size} ${t.key}: ${ways.length} edited ways, ${kept.size} first mapped since ${since.slice(0, 10)}`);
  } catch (e) {
    failedTiles++;
    log(`  ${n}/${allTiles.size} ${t.key}: failed (${e.message}), keeping last good data`);
  }
}
if (skippedTiles) log(`  Out of time: ${skippedTiles} squares left for tomorrow night, keeping their last good data.`);

let written = 0;
for (const z of ZONES) {
  const old = before.get(z.id);
  const out = { v: 1, builtAt, months: MAX_MONTHS, tiles: {}, ways: {}, rels: {} };
  for (const { key } of gridTiles(z.box)) {
    const t = tiles.get(key);
    if (t) {
      out.tiles[key] = { at: t.at, ways: [...t.ways.keys()] };
      t.ways.forEach((w, id) => { out.ways[id] = w; });
      t.rels.forEach((r) => { const o = out.rels[r.id]; out.rels[r.id] = { tags: r.tags, ways: [...new Set([...(o ? o.ways : []), ...r.ways])] }; });
    } else if (old && old.tiles && old.tiles[key]) {
      const ot = old.tiles[key];
      out.tiles[key] = ot;
      ot.ways.forEach((id) => { if (old.ways[id]) out.ways[id] = old.ways[id]; });
      Object.entries(old.rels || {}).forEach(([id, r]) => { if (r.ways.some((w) => ot.ways.includes(w))) out.rels[id] = out.rels[id] || r; });
    }
  }
  if (!Object.keys(out.tiles).length) { log(`${z.name}: nothing loaded, leaving its file as it was`); continue; }
  writeFileSync(new URL(`trails-${z.id}.json`, DATA), JSON.stringify(out));
  written++;
}

// Trail names, one Overpass query per zone (split if too heavy). Same item format as toItems() in index.html.
// Names get their own time, so a slow trails part doesn't stop the name search from updating. Oldest lists first.
deadline = Math.max(Date.now() + 15 * 60e3, started + NAMES_MINUTES * 60e3);
const namesAt = (z) => (readJson(`names-${z.id}.json`) || {}).builtAt;
const zoneOrder = [...ZONES].sort((a, b) => (Date.parse(namesAt(a)) || 0) - (Date.parse(namesAt(b)) || 0));
log(`Names: ${ZONES.length} zones.`);
let failedNames = 0, skippedNames = 0;
for (const z of zoneOrder) {
  if (outOfTime()) { skippedNames++; log(`  ${z.name}: out of time, keeping last good data`); continue; }
  try {
    const els = await fetchBox(z.box, (b) => namesQuery(b));
    const items = els.filter((e) => e.tags && e.center && (e.tags.name || e.tags["mtb:name"]))
      .map((e) => ({ t: e.type === "relation" ? "r" : "w", id: e.id, c: [round(e.center.lat), round(e.center.lon)], tags: e.tags }));
    writeFileSync(new URL(`names-${z.id}.json`, DATA), JSON.stringify({ v: 1, builtAt, items }));
    log(`  ${z.name}: ${items.length} names`);
  } catch (e) {
    failedNames++;
    log(`  ${z.name}: failed (${e.message}), keeping last good data`);
  }
}

const minutes = Math.round((Date.now() - started) / 60e3);
log(`Done in ${minutes} min: ${allTiles.size - failedTiles - skippedTiles} of ${allTiles.size} squares and ${ZONES.length - failedNames - skippedNames} of ${ZONES.length} name lists updated.`);
// Fail the job only when nothing at all could be updated, so a bad night shows up in GitHub.
if (failedTiles + skippedTiles === allTiles.size && failedNames + skippedNames === ZONES.length) process.exit(1);
