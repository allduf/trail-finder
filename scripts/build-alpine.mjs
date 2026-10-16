// Weekly job (see .github/workflows/alpine-trails.yml): alpine trails that look doable on a mountain bike, for the
// "Alpine rideable" layer. alex: "all the alpine trails that you think are doable on a MTB".
//
// Writes data/alpine-<zone>.json for each zone: OpenStreetMap paths and bridleways that climb above the zone's tree line
// (heights from AWS Terrain Tiles, no key), whose tags say a bike can go there:
//  - not closed to bikes or people (bicycle=no/dismount, mtb=no, access=no/private), not a moto trail;
//  - hiking grade (sac_scale) at most mountain_hiking (T2), or T3 when bikes are allowed (bicycle=yes/permissive),
//    the same line the site draws for "hiking only";
//  - not mapped as hard to follow or impassable (trail_visibility bad/horrible/no, smoothness very_horrible/impassable),
//    not stairs, not a hiking-route path signed only for walkers;
//  - not inside a national park, provincial park or ecological reserve (boundary=national_park, boundary=protected_area
//    with protect_class 1a, 1b, 2 or 3), where bikes may only use designated trails, or a ski resort (landuse=winter_sports),
//    whose alpine hiking trails are closed to bikes (the bike park trails have MTB tags), unless the path itself allows bikes;
//  - at least MIN_M long (MIN_UNNAMED_M with no name), so platforms, bridges and short connectors stay off.
// Paths already in the all-trails lists (data/mtb-<zone>.json) are left out: they're on the map as MTB trails.
// Each way keeps a few tags, its simplified shape and its heights: lo/hi (lowest and highest point, m), up (metres of the
// path above the tree line), tl (the tree line used).
// Lists refreshed in the last FRESH_HOURS are skipped; a zone that fails keeps its last good file.
//
// Run: node scripts/build-alpine.mjs   (Node 18 or newer, no packages needed; FORCE=1 refreshes every zone)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const DATA = new URL("data/", root);
const UA = "trail-finder alpine data (https://github.com/allduf/trail-finder)";
const OVERPASS = process.env.OVERPASS_URLS ? process.env.OVERPASS_URLS.split(",") : JSON.parse(html.match(/const OVERPASS = (\[[^\]]+\]);/)[1]);
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
const FRESH_HOURS = process.env.FORCE ? 0 : 6 * 24, MINUTES = +process.env.ALPINE_MINUTES || 80;
const ONLY = process.env.ZONES ? process.env.ZONES.split(",") : null;
const started = Date.now(), outOfTime = () => Date.now() - started > MINUTES * 60e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const readJson = (name) => { try { return JSON.parse(readFileSync(new URL(name, DATA), "utf8")); } catch { return null; } };

const RULES = 2;   // files built with older rules are rebuilt, however fresh
// Where the trees give way to alpine meadow and rock, roughly, in metres: lowest on the wet coast, highest in the Rockies.
const TREELINE = {
  van: 1600, sqm: 1600, wh: 1650, sun: 1550, pr: 1550, fv: 1650,
  pem: 1800, lil: 1950, chil: 2000, wl: 2000,
  pri: 1950, mer: 1950, kam: 1950, shu: 1950, ver: 1950, kel: 1950, bwh: 2000, pen: 1950, sok: 2000, gfk: 2000,
  ros: 1950, nel: 1950, rev: 1900, gol: 2050,
  inv: 2200, cbk: 2150, fer: 2100, yyc: 2200, brg: 2150, kan: 2200, bnf: 2250,
};
const ABOVE_M = 250, ABOVE_SHARE = 0.5;   // alpine: this much of the path above the tree line, or this share of it
const MIN_M = 150, MIN_UNNAMED_M = 300;   // shorter bits are left out
const KEEP = ["name", "highway", "sac_scale", "surface", "smoothness", "trail_visibility", "bicycle", "foot", "horse", "width", "incline",
  "informal", "access", "operator", "description", "note", "website", "ref", "mtb:scale"];

// ---------- the rules ----------
const HARD = /^(demanding_mountain_hiking|alpine_hiking|demanding_alpine_hiking|difficult_alpine_hiking)$/;
const BIKES_OK = /^(yes|permissive|designated)$/;
const MOTO_OK = /^(yes|designated|permissive|permit)$/;
const MOTO_NAME = /\b(atvs?|quads?|motocross|mx|dirt ?bikes?|motorbikes?|motorcycles?|orv|ohv|4x4|4wd|jeep)\b/i;
const CLIMB_NAME = /\b(scramble|via ferrata|climbers?'? (route|access)|summit route|glacier)\b/i;
const PAVED = /^(asphalt|concrete|paved|paving_stones|sett|chipseal)$/;
// Why bikes can't or shouldn't go there, or null.
function notRideable(t, routeTypes) {
  const bikesOk = BIKES_OK.test(t.bicycle || "");
  if (/^(no|dismount|private)$/.test(t.bicycle || "")) return `bicycle=${t.bicycle}`;
  if (t.mtb === "no") return "mtb=no";
  if (/^(no|private)$/.test(t.access || "") && !bikesOk) return `access=${t.access}`;
  if (PAVED.test(t.surface || "")) return "paved";
  if (HARD.test(t.sac_scale || "") && !(bikesOk && t.sac_scale === "demanding_mountain_hiking")) return `sac_scale=${t.sac_scale}`;
  if (/^(bad|horrible|no)$/.test(t.trail_visibility || "")) return `trail_visibility=${t.trail_visibility}`;
  if (/^(very_horrible|impassable)$/.test(t.smoothness || "")) return `smoothness=${t.smoothness}`;
  if (t.ladder === "yes" || t.climbing || t.via_ferrata_scale) return "climbing";
  if (CLIMB_NAME.test(t.name || "")) return "name says climbing or glacier";
  if (t.motorcycle === "designated" || MOTO_OK.test(t.motorcycle || "") || MOTO_OK.test(t.atv || "") || MOTO_OK.test(t.motor_vehicle || "") || t["dirtbike:scale"]) return "moto trail";
  if (MOTO_NAME.test(t.name || "")) return "moto name";
  if (!bikesOk && t.foot === "designated" && (routeTypes.includes("hiking") || routeTypes.includes("foot")) && !routeTypes.includes("bicycle") && !routeTypes.includes("mtb")) return "walkers' hiking route";
  return null;
}
// What makes it look doable, in plain words, for the trail details.
function goodSigns(t) {
  const out = [];
  if (BIKES_OK.test(t.bicycle || "")) out.push(`bikes allowed (bicycle=${t.bicycle})`);
  if (t.sac_scale === "hiking") out.push("easy hiking grade (sac_scale=hiking, T1)");
  else if (t.sac_scale === "mountain_hiking") out.push("mountain hiking grade (sac_scale=mountain_hiking, T2)");
  else if (t.sac_scale) out.push(`hiking grade sac_scale=${t.sac_scale}`);
  else out.push("no hard-terrain grade mapped");
  if (/^(excellent|good)$/.test(t.trail_visibility || "")) out.push(`easy to follow (trail_visibility=${t.trail_visibility})`);
  if (/^(dirt|earth|ground|grass|fine_gravel|gravel|compacted|soil|unpaved)$/.test(t.surface || "")) out.push(`rideable surface (${t.surface})`);
  if (/^(rock|stone|pebblestone|scree)$/.test(t.surface || "")) out.push(`rocky surface (${t.surface})`);
  if (/^(good|intermediate|bad|very_bad|horrible)$/.test(t.smoothness || "")) out.push(`smoothness=${t.smoothness}`);
  return out;
}

// ---------- Overpass ----------
function query([s, w, n, e]) {
  const bb = [s, w, n, e].map((x) => x.toFixed(5)).join(",");
  return `[out:json][timeout:180];
way["highway"~"^(path|bridleway)$"]["bicycle"!~"^(no|dismount|private)$"]["mtb"!="no"]["area"!="yes"](${bb})->.p;
.p out geom qt;
rel(bw.p)["route"~"^(hiking|foot|bicycle|mtb)$"]->.r;
.r out body qt;
(wr["boundary"="national_park"](${bb}); wr["boundary"="protected_area"]["protect_class"~"^(1a|1b|1|2|3)$"](${bb}); wr["landuse"="winter_sports"](${bb}););
map_to_area->.a;
way.p(area.a);
out ids qt;`;
}
async function overpass(q) {
  let lastErr;
  for (let attempt = 0; attempt < 6 && !outOfTime(); attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length], host = new URL(url).host;
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA }, signal: AbortSignal.timeout(240000) });
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
    const wait = Math.min(30000 * 2 ** Math.floor(attempt / OVERPASS.length), 240000);
    log(`    ${lastErr.message}; trying again in ${Math.round(wait / 1000)} s`);
    await sleep(wait);
  }
  throw lastErr || new Error("out of time");
}
// The answer comes in three parts: the paths (with geometry), their routes, then the ids of the paths inside a park
// or ski resort (the same paths again, without geometry).
function parts(els) {
  const ways = new Map(), routes = [], inPark = new Set();
  for (const el of els) {
    if (el.type === "relation") routes.push(el);
    else if (el.type === "way" && el.geometry) ways.set(el.id, el);
    else if (el.type === "way") inPark.add(el.id);
  }
  return { ways, routes, inPark };
}
const quarters = ([s, w, n, e]) => { const cs = (s + n) / 2, cw = (w + e) / 2; return [[s, w, cs, cw], [s, cw, cs, e], [cs, w, n, cw], [cs, cw, n, e]]; };
async function fetchBox(box, depth = 0) {
  try { return parts((await overpass(query(box))).elements); }
  catch (e) {
    if (!e.heavy || depth >= 2) throw e;
    log(`    too heavy, splitting in 4`);
    const out = { ways: new Map(), routes: [], inPark: new Set() };
    for (const q of quarters(box)) {
      const p = await fetchBox(q, depth + 1);
      p.ways.forEach((w, id) => out.ways.set(id, w)); out.routes.push(...p.routes); p.inPark.forEach((id) => out.inPark.add(id));
    }
    return out;
  }
}

// ---------- heights: AWS Terrain Tiles (Terrarium PNG, zoom 12, about 25 m a pixel here) ----------
const DEM_Z = 12;
const tiles = new Map();   // "x/y" -> Float32Array(256 * 256) or null, for the zone being built
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8, w = 0, h = 0, depth = 0, type = 0; const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString("ascii", pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; if (body[12]) throw new Error("interlaced PNG"); }
    else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    pos += 12 + len;
  }
  const ch = { 2: 3, 6: 4 }[type];
  if (depth !== 8 || !ch) throw new Error(`PNG type ${type}/${depth}`);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * ch, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride, up = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[row + i - ch] : 0, b = y ? px[up + i] : 0, c = y && i >= ch ? px[up + i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + i] = v & 255;
    }
  }
  const e = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) e[i] = px[i * ch] * 256 + px[i * ch + 1] + px[i * ch + 2] / 256 - 32768;
  return e;
}
async function tile(x, y) {
  const key = `${x}/${y}`;
  if (!tiles.has(key)) {
    let e = null;
    for (let attempt = 0; attempt < 3 && !e; attempt++) {
      try {
        const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${DEM_Z}/${x}/${y}.png`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        e = decodePng(Buffer.from(await res.arrayBuffer()));
      } catch (err) { if (attempt === 2) log(`    height tile ${key}: ${err.message}`); else await sleep(2000); }
    }
    tiles.set(key, e);
  }
  return tiles.get(key);
}
async function height(lat, lon) {
  const n = 2 ** DEM_Z, fx = ((lon + 180) / 360) * n, r = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const x = Math.floor(fx), y = Math.floor(fy), e = await tile(x, y);
  if (!e) return null;
  const px = Math.min(255, Math.floor((fx - x) * 256)), py = Math.min(255, Math.floor((fy - y) * 256));
  return e[py * 256 + px];
}

// ---------- shapes ----------
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180));
function simplify(pts, tol = 3) {
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
// Heights every 40 m along the path: length, lowest, highest and metres above the tree line.
async function profile(geometry, treeline) {
  let len = 0, above = 0, lo = Infinity, hi = -Infinity, top = null;
  let prev = null, prevH = null;
  for (let i = 0; i < geometry.length; i++) {
    const p = [geometry[i].lat, geometry[i].lon];
    const steps = prev ? Math.max(1, Math.ceil(metres(prev, p) / 40)) : 1;
    for (let k = 1; k <= steps; k++) {
      const q = prev ? [prev[0] + ((p[0] - prev[0]) * k) / steps, prev[1] + ((p[1] - prev[1]) * k) / steps] : p;
      const h = await height(q[0], q[1]);
      if (h == null) continue;
      if (h < lo) lo = h;
      if (h > hi) { hi = h; top = q; }
      if (prev) {
        const d = metres(prev, p) / steps;
        len += d;
        if (prevH != null && (h + prevH) / 2 >= treeline) above += d;
      }
      prevH = h;
    }
    prev = p;
  }
  return { len, above, lo, hi, top };
}

if (!existsSync(DATA)) mkdirSync(DATA);
const builtAt = new Date().toISOString().slice(0, 19) + "Z";
const lastBuilt = (z) => { const f = readJson(`alpine-${z.id}.json`); return f && f.rules === RULES && String(f.box) === String(z.box) ? Date.parse(f.builtAt) || 0 : 0; };
const order = [...ZONES].filter((z) => !ONLY || ONLY.includes(z.id)).sort((a, b) => lastBuilt(a) - lastBuilt(b));   // oldest lists first
let updated = 0, failed = 0;
for (const z of order) {
  if (Date.now() - lastBuilt(z) < FRESH_HOURS * 3600e3) { log(`${z.name}: fresh, skipped`); continue; }
  if (outOfTime()) { log(`${z.name}: out of time, keeping last good data`); continue; }
  try {
    const treeline = TREELINE[z.id] || 2000;
    const mtb = new Set(Object.keys((readJson(`mtb-${z.id}.json`) || {}).ways || {}).map(Number));
    const { ways: all, routes, inPark } = await fetchBox(z.box);
    const routeTypes = new Map();
    routes.forEach((r) => (r.members || []).forEach((m) => {
      if (m.type !== "way") return;
      if (!routeTypes.has(m.ref)) routeTypes.set(m.ref, []);
      routeTypes.get(m.ref).push(r.tags.route);
    }));
    tiles.clear();
    const ways = {}, skipped = {};
    const skip = (why) => { skipped[why] = (skipped[why] || 0) + 1; };
    for (const w of all.values()) {
      const t = w.tags || {};
      if (mtb.has(w.id) || Object.keys(t).some((k) => /^mtb(:|$)/.test(k))) { skip("already an MTB trail"); continue; }
      if (w.geometry.length < 2) continue;
      const bad = notRideable(t, routeTypes.get(w.id) || []);
      if (bad) { skip(bad.startsWith("sac_scale") ? "hard hiking grade" : bad); continue; }
      // A quick look at the ends and the middle first: most paths are nowhere near the tree line.
      const probe = [w.geometry[0], w.geometry[w.geometry.length >> 1], w.geometry[w.geometry.length - 1]];
      const probeHi = Math.max(...(await Promise.all(probe.map((p) => height(p.lat, p.lon)))).map((h) => (h == null ? -1e9 : h)));
      if (probeHi < treeline - 400) { skip("below the tree line"); continue; }
      const pr = await profile(w.geometry, treeline);
      if (pr.len < (t.name ? MIN_M : MIN_UNNAMED_M)) { skip("too short"); continue; }
      if (pr.above < ABOVE_M && pr.above < pr.len * ABOVE_SHARE) { skip("below the tree line"); continue; }
      if (inPark.has(w.id) && !BIKES_OK.test(t.bicycle || "")) { skip("in a park or ski resort"); continue; }
      const tags = Object.fromEntries(KEEP.filter((k) => t[k] != null).map((k) => [k, t[k]]));
      ways[w.id] = {
        tags, g: simplify(w.geometry).flatMap((p) => [round(p.lat), round(p.lon)]),
        lo: Math.round(pr.lo), hi: Math.round(pr.hi), up: Math.round(pr.above), m: Math.round(pr.len),
        top: [round(pr.top[0]), round(pr.top[1])], why: goodSigns(t),
      };
    }
    writeFileSync(new URL(`alpine-${z.id}.json`, DATA), JSON.stringify({ v: 1, rules: RULES, builtAt, box: z.box, treeline, ways }));
    updated++;
    log(`${z.name}: ${Object.keys(ways).length} alpine paths that look rideable (tree line ${treeline} m, ${all.size} paths, ${tiles.size} height tiles); left out: ${JSON.stringify(skipped)}`);
  } catch (e) {
    failed++;
    log(`${z.name}: failed (${e.message}), keeping last good data`);
  }
}
log(`Done in ${Math.round((Date.now() - started) / 60e3)} min: ${updated} updated, ${failed} failed.`);
if (failed && !updated) process.exit(1);
