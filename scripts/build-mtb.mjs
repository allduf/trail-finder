// Daily job (see .github/workflows/all-trails.yml): every MTB trail in the region, any age, with its shape,
// so the site can draw all of them coloured by difficulty ("All trails"), like Trailforks does.
//
// Writes data/mtb-<zone>.json for each zone: ways with an mtb* tag, bike park paths (bicycle=customers)
// and the ways of MTB route relations. Shapes are simplified to about 2 m and rounded to 5 decimals.
// Lists refreshed in the last FRESH_HOURS are skipped; a zone that fails keeps its last good file.
//
// Run: node scripts/build-mtb.mjs   (Node 18 or newer, no packages needed; FORCE=1 refreshes every zone)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const DATA = new URL("data/", root);
const UA = "trail-finder all-trails data (https://github.com/allduf/trail-finder)";
const OVERPASS = process.env.OVERPASS_URLS ? process.env.OVERPASS_URLS.split(",") : JSON.parse(html.match(/const OVERPASS = (\[[^\]]+\]);/)[1]);
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
const FRESH_HOURS = process.env.FORCE ? 0 : 20, MINUTES = +process.env.MTB_MINUTES || 25;
const started = Date.now(), outOfTime = () => Date.now() - started > MINUTES * 60e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

function mtbQuery([s, w, n, e]) {
  const bb = [s, w, n, e].map((x) => x.toFixed(5)).join(",");
  return `[out:json][timeout:180];
(
  way["highway"]["mtb:scale"](${bb});
  way["highway"]["mtb:scale:imba"](${bb});
  way["highway"]["mtb"](${bb});
  way["highway"]["mtb:type"](${bb});
  way["highway"="path"]["bicycle"="customers"](${bb});
)->.w;
relation["route"="mtb"](${bb})->.r;
way(r.r)["highway"]->.rw;
(.w; .rw;);
out geom qt;
.r out body qt;`;
}

// Overpass, politely: one query at a time, long waits when a server is busy.
async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 6 && !outOfTime(); attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length], host = new URL(url).host;
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(query), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, signal: AbortSignal.timeout(240000) });
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
    log(`    ${lastErr.message}; trying again in ${Math.round(wait / 1000)} s`);
    await sleep(wait);
  }
  throw lastErr || new Error("out of time");
}
// A zone too heavy for the server is fetched as 4 smaller boxes (2 levels at most).
const quarters = ([s, w, n, e]) => { const cs = (s + n) / 2, cw = (w + e) / 2; return [[s, w, cs, cw], [s, cw, cs, e], [cs, w, n, cw], [cs, cw, n, e]]; };
async function fetchBox(box, depth = 0) {
  try { return (await overpass(mtbQuery(box))).elements; }
  catch (e) {
    if (!e.heavy || depth >= 2) throw e;
    log(`    too heavy, splitting in 4`);
    const seen = new Map();
    for (const q of quarters(box)) for (const el of await fetchBox(q, depth + 1)) seen.set(el.type + el.id, el);
    return [...seen.values()];
  }
}

// Douglas-Peucker on a local flat projection, keeping points more than tol metres off the line.
function simplify(pts, tol = 2) {
  if (pts.length < 3) return pts;
  const k = Math.cos((pts[0].lat * Math.PI) / 180) * 111320, xy = pts.map((p) => [p.lon * k, p.lat * 110540]);
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
const round = (n) => Math.round(n * 1e5) / 1e5;
const readJson = (name) => { try { return JSON.parse(readFileSync(new URL(name, DATA), "utf8")); } catch { return null; } };
if (!existsSync(DATA)) mkdirSync(DATA);

const builtAt = new Date().toISOString().slice(0, 19) + "Z";
const lastBuilt = (z) => Date.parse((readJson(`mtb-${z.id}.json`) || {}).builtAt) || 0;
// A list made for a different box (or before boxes were saved) is out of date, however fresh.
const sameBox = (z) => String((readJson(`mtb-${z.id}.json`) || {}).box) === String(z.box);
const order = [...ZONES].sort((a, b) => lastBuilt(a) - lastBuilt(b));   // oldest lists first
let updated = 0, failed = 0;
for (const z of order) {
  if (sameBox(z) && Date.now() - lastBuilt(z) < FRESH_HOURS * 3600e3) { log(`${z.name}: fresh, skipped`); continue; }
  if (outOfTime()) { log(`${z.name}: out of time, keeping last good data`); continue; }
  try {
    const els = await fetchBox(z.box);
    const ways = {}, routes = {};
    els.filter((e) => e.type === "way" && e.geometry && e.geometry.length > 1).forEach((w) => {
      ways[w.id] = { tags: w.tags || {}, g: simplify(w.geometry).flatMap((p) => [round(p.lat), round(p.lon)]) };
    });
    els.filter((e) => e.type === "relation").forEach((r) => {
      const ids = (r.members || []).filter((m) => m.type === "way" && ways[m.ref]).map((m) => m.ref);
      if (ids.length) routes[r.id] = { name: (r.tags && (r.tags.name || r.tags.ref)) || "unnamed", ways: ids };
    });
    writeFileSync(new URL(`mtb-${z.id}.json`, DATA), JSON.stringify({ v: 1, builtAt, box: z.box, ways, routes }));
    updated++;
    log(`${z.name}: ${Object.keys(ways).length} trails, ${Object.keys(routes).length} MTB routes`);
  } catch (e) {
    failed++;
    log(`${z.name}: failed (${e.message}), keeping last good data`);
  }
}
log(`Done in ${Math.round((Date.now() - started) / 60e3)} min: ${updated} updated, ${failed} failed.`);
if (failed && !updated) process.exit(1);
