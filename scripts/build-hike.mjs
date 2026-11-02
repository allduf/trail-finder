// Weekly job (see .github/workflows/hike-trails.yml): the hiking trails of each home zone, for Hiking (hike.js).
// alex (2026-11-02, after Hiking went live): "where are the hiking trail?" Asked live, OpenStreetMap's trail server
// (Overpass) often takes minutes or refuses a phone's dozens of squares, so the panel sat on "Finding the hiking
// trails here…". The 31 home zones (Vancouver to Calgary) now come ready-made; elsewhere in Canada hike.js still asks
// Overpass, a few squares at a time.
//
// Writes data/hike-<zone>.json in hike.js's own format: { v: 1, builtAt, box, at, w: [{ id, t, g }], r: [{ id, n, t, m }] }
//  - w: hiking trails: named paths, footways and bridleways, any path or track with a hiking grade (sac_scale), and the
//    paths of hiking routes (route=hiking or foot). Paved, lit and sidewalk paths, foot=no and bike-park lines are left
//    out here already (the same rules as hike.js keepWay), t keeps a few tags, g the shape ([lat, lon], 5 decimals).
//  - r: the hiking routes, with their trail ids (m).
//  And data/hike-places-<zone>.json: { v: 1, builtAt, p: [[id, kind, lat, lon, name, extra]] }, the places a hiker
//  looks for: trailheads, parking, huts and shelters, campsites, viewpoints, peaks, waterfalls, drinking water and
//  toilets (Hiking's own layers, alex 2026-11-02: "i want hiking to be as good as all the other sports"). Parking,
//  water, toilets and unnamed campsites only within 400 m of a hiking trail (not every lot in town); extra keeps a few
//  tags (ele, fee, capacity, operator, website, shelter type...).
// Zones refreshed in the last FRESH_HOURS are skipped; a zone that fails keeps its last good file.
//
// Run: node scripts/build-hike.mjs   (Node 18 or newer, no packages; FORCE=1 refreshes every zone, ZONES=wh,sqm some)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const DATA = new URL("data/", root);
const UA = "trail-finder hiking data (https://github.com/allduf/trail-finder)";
const OVERPASS = process.env.OVERPASS_URLS ? process.env.OVERPASS_URLS.split(",") : JSON.parse(html.match(/const OVERPASS = (\[[^\]]+\]);/)[1]);
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
const FRESH_HOURS = process.env.FORCE ? 0 : 6 * 24, MINUTES = +process.env.HIKE_MINUTES || 80;
const ONLY = process.env.ZONES ? process.env.ZONES.split(",") : null;
const started = Date.now(), outOfTime = () => Date.now() - started > MINUTES * 60e3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const readJson = (name) => { try { return JSON.parse(readFileSync(new URL(name, DATA), "utf8")); } catch { return null; } };

const RULES = 1;   // files built with older rules are rebuilt, however fresh
const KEEP = ["name", "highway", "sac_scale", "surface", "trail_visibility", "foot", "access", "bicycle", "mtb:scale", "mtb:scale:imba", "mtb:type", "footway", "lit", "operator", "website", "description", "incline", "ref", "seasonal", "informal"];
const FOOT_OK = /^(yes|designated|permissive)$/;
// The same as keepWay in hike.js: what isn't a hike.
function keepWay(t, inRel) {
  if (/^(no|private)$/.test(t.foot || "")) return false;
  if (/^(no|private)$/.test(t.access || "") && !FOOT_OK.test(t.foot || "")) return false;
  if (/^(sidewalk|crossing|access_aisle|traffic_island)$/.test(t.footway || "")) return false;
  if (inRel || t.sac_scale) return true;
  if (/^(asphalt|concrete|paving_stones|paved|sett|concrete:plates|metal|unhewn_cobblestone|cobblestone)$/.test(t.surface || "")) return false;
  if (t.lit === "yes") return false;
  const bikeHeavy = +t["mtb:scale"] >= 3 || +t["mtb:scale:imba"] >= 3 || /downhill|freeride|bike ?park/i.test(t["mtb:type"] || "");
  if (bikeHeavy && !FOOT_OK.test(t.foot || "")) return false;
  return true;
}

// ---------- Overpass ----------
function query([s, w, n, e]) {
  const bb = [s, w, n, e].map((x) => x.toFixed(5)).join(",");
  return `[out:json][timeout:180];
(
  way["highway"~"^(path|footway|bridleway)$"]["name"](${bb});
  way["highway"~"^(path|footway|bridleway|track)$"]["sac_scale"](${bb});
)->.a;
rel["route"~"^(hiking|foot)$"](${bb})->.r;
way(r.r)["highway"](${bb})->.b;
(.a; .b;);
out tags geom qt;
.r out body qt;`;
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
const quarters = ([s, w, n, e]) => { const cs = (s + n) / 2, cw = (w + e) / 2; return [[s, w, cs, cw], [s, cw, cs, e], [cs, w, n, cw], [cs, cw, n, e]]; };
async function fetchBox(box, depth = 0) {
  try { return (await overpass(query(box))).elements || []; }
  catch (e) {
    if (!e.heavy || depth >= 2) throw e;
    log(`    too heavy, splitting in 4`);
    const out = [];
    for (const q of quarters(box)) out.push(...(await fetchBox(q, depth + 1)));
    return out;
  }
}

// ---------- places ----------
function placeQuery([s, w, n, e]) {
  const bb = [s, w, n, e].map((x) => x.toFixed(5)).join(",");
  return `[out:json][timeout:180];
(
  nwr["highway"="trailhead"](${bb});
  nwr["tourism"~"^(alpine_hut|wilderness_hut|viewpoint|camp_site)$"](${bb});
  nwr["amenity"="shelter"]["shelter_type"~"^(basic_hut|lean_to|weather_shelter|rock_shelter)$"](${bb});
  node["natural"~"^(peak|volcano)$"]["name"](${bb});
  node["waterway"="waterfall"](${bb});
  nwr["amenity"="parking"]["access"!~"^(private|no|customers|permit|delivery)$"](${bb});
  node["amenity"~"^(drinking_water|toilets)$"](${bb});
);
out center tags qt;`;
}
async function fetchPlaces(box, depth = 0) {
  try { return (await overpass(placeQuery(box))).elements || []; }
  catch (e) {
    if (!e.heavy || depth >= 2) throw e;
    const out = [];
    for (const q of quarters(box)) out.push(...(await fetchPlaces(q, depth + 1)));
    return out;
  }
}
const PLACE_EXTRA = ["ele", "fee", "charge", "capacity", "operator", "website", "reservation", "shelter_type", "backcountry", "drinking_water", "opening_hours", "seasonal", "description", "height"];
// One place kind per element (the same as hike.js placeKind).
function placeKind(t) {
  if (t.highway === "trailhead") return "th";
  if (t.amenity === "parking") return "park";
  if (/^(alpine_hut|wilderness_hut)$/.test(t.tourism) || t.amenity === "shelter") return "hut";
  if (t.tourism === "camp_site") return "camp";
  if (t.tourism === "viewpoint") return "view";
  if (/^(peak|volcano)$/.test(t.natural)) return "peak";
  if (t.waterway === "waterfall") return "fall";
  if (t.amenity === "drinking_water") return "water";
  if (t.amenity === "toilets") return "wc";
  return null;
}
const NEAR_TRAIL = new Set(["park", "water", "wc"]);
function buildPlaces(els, trailWays) {
  // A 0.004° grid (about 400 m) of the trails' points: "near a trail" is the place's cell or one next to it.
  const C = 0.004, cells = new Set(), cell = (a, b) => `${Math.floor(a / C)},${Math.floor(b / C)}`;
  for (const w of trailWays) for (const p of w.g) cells.add(cell(p[0], p[1]));
  const near = (lat, lon) => { const y = Math.floor(lat / C), x = Math.floor(lon / C); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (cells.has(`${y + i},${x + j}`)) return true; return false; };
  const out = [], seen = new Set();
  for (const e of els) {
    const t = e.tags || {}, k = placeKind(t), lat = e.lat != null ? e.lat : e.center && e.center.lat, lon = e.lon != null ? e.lon : e.center && e.center.lon;
    if (!k || lat == null) continue;
    const id = e.type[0] + e.id;
    if (seen.has(id)) continue;
    if ((NEAR_TRAIL.has(k) || (k === "camp" && !t.name)) && !near(lat, lon)) continue;
    if (t.access && /^(private|no)$/.test(t.access)) continue;
    seen.add(id);
    const x = {}; PLACE_EXTRA.forEach((key) => { if (t[key] != null) x[key] = String(t[key]).slice(0, 200); });
    out.push([id, k, +lat.toFixed(5), +lon.toFixed(5), t.name || "", x]);
  }
  return { v: 1, builtAt: new Date().toISOString(), at: Date.now(), p: out };
}

// ---------- one zone ----------
function build(els, box) {
  const rels = new Map(), ways = new Map();
  for (const e of els) {
    if (e.type === "relation") {
      const t = e.tags || {}, m = (e.members || []).filter((x) => x.type === "way").map((x) => x.ref);
      const old = rels.get(e.id);
      if (old) { old.m = [...new Set([...old.m, ...m])]; continue; }
      rels.set(e.id, { id: e.id, n: t.name || t.ref || "", t: Object.fromEntries(["network", "operator", "website", "description", "distance", "roundtrip"].filter((k) => t[k] != null).map((k) => [k, t[k]])), m });
    } else if (e.type === "way" && e.geometry && e.geometry.length > 1 && !ways.has(e.id)) {
      const t = {}; KEEP.forEach((k) => { if (e.tags && e.tags[k] != null) t[k] = e.tags[k]; });
      ways.set(e.id, { id: e.id, t, g: e.geometry.filter(Boolean).map((p) => [+p.lat.toFixed(5), +p.lon.toFixed(5)]) });
    }
  }
  const inRel = new Set(); rels.forEach((r) => r.m.forEach((id) => inRel.add(id)));
  const w = [...ways.values()].filter((x) => keepWay(x.t, inRel.has(x.id)) && (x.t.name || x.t.sac_scale || inRel.has(x.id)));
  const kept = new Set(w.map((x) => x.id));
  const r = [...rels.values()].map((x) => ({ ...x, m: x.m.filter((id) => kept.has(id)) })).filter((x) => x.m.length);
  return { v: 1, rules: RULES, builtAt: new Date().toISOString(), at: Date.now(), box, w, r };
}

mkdirSync(DATA, { recursive: true });
const stale = (old) => !old || Date.now() - Date.parse(old.builtAt) > FRESH_HOURS * 3600e3;
const todo = ZONES.filter((z) => !ONLY || ONLY.includes(z.id)).map((z) => ({ z, old: readJson(`hike-${z.id}.json`), oldP: readJson(`hike-places-${z.id}.json`) }))
  .filter(({ old, oldP }) => stale(old) || old.rules !== RULES || stale(oldP))
  .sort((a, b) => (a.old ? Date.parse(a.old.builtAt) : 0) - (b.old ? Date.parse(b.old.builtAt) : 0));
log(`${todo.length} of ${ZONES.length} zones to build`);
let built = 0, failed = 0;
for (const { z, old, oldP } of todo) {
  if (outOfTime()) { log("Out of time: the rest next run."); break; }
  log(`${z.id} (${z.name})`);
  let trails = old;
  try {
    if (stale(old) || old.rules !== RULES) {
      const f = build(await fetchBox(z.box), z.box);
      if (!f.w.length) throw new Error("no trails at all (OpenStreetMap answered empty)");
      writeFileSync(new URL(`hike-${z.id}.json`, DATA), JSON.stringify(f));
      log(`  ${f.w.length} trails, ${f.r.length} hiking routes, ${Math.round(JSON.stringify(f).length / 1024)} KB`);
      trails = f;
    }
    if (trails && (stale(oldP) || trails !== old) && !outOfTime()) {
      const p = buildPlaces(await fetchPlaces(z.box), trails.w);
      writeFileSync(new URL(`hike-places-${z.id}.json`, DATA), JSON.stringify(p));
      const n = {}; p.p.forEach((x) => (n[x[1]] = (n[x[1]] || 0) + 1));
      log(`  places: ${Object.entries(n).map(([k, c]) => `${c} ${k}`).join(", ")}`);
    }
    built++;
  } catch (e) { log(`  failed: ${e.message} (keeping the last file)`); failed++; }
}
log(`Built ${built}, failed ${failed}.`);
if (!built && failed) process.exit(1);
