// Daily job (see .github/workflows/all-trails.yml): every MTB trail in the region, any age, with its shape,
// so the site can draw all of them coloured by difficulty ("All trails"), like Trailforks does.
//
// Writes data/mtb-<zone>.json for each zone: ways with an mtb* tag, bike park paths (bicycle=customers)
// and the ways of MTB route relations. Shapes are simplified to about 2 m and rounded to 5 decimals.
// Long-distance bikepacking routes (BC Epic 1000, Great Divide...) are left out: they're mostly roads.
// In riding areas where mappers seldom tag bike trails (fewer than SPARSE MTB-tagged ways within AREA_M of a
// data/riding-areas.json label, e.g. Three Blind Mice, Fox Mountain), the area's named paths are added too,
// marked with the made-up tag tf:area=<area name> so the site can say why it shows them. An area with its own radius r
// (metres, e.g. South Chilcotin) is backcountry where every named path within r counts, however many have bike tags,
// and so does every named path inside the area's park (park: the park's name; REC_ZONES only, where parks are loaded).
// An area with an official reason marks its named paths tf:official=<reason> (not ones named like roads), and in the
// OFFICIAL_ZONES (Williams Lake) every trail of the list is marked so.
// In the REC_ZONES (Gold Bridge & South Chilcotin), the BC government's Recreation Sites and Trails BC trails fill the gaps
// (see recData below): paths along them count too, named after them when OpenStreetMap has no name, and park trails say so.
// A zone whose riding areas change is rebuilt on the next run.
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

const RULES = 2;                      // files built with older rules are rebuilt, however fresh
const LONG_ROUTE = 150;               // MTB route relations with more ways than this are long-distance routes
const AREA_M = 3000, SPARSE = 20;
const AREAS = (readJsonAt(new URL("data/riding-areas.json", root)) || { areas: [] }).areas;
function readJsonAt(url) { try { return JSON.parse(readFileSync(url, "utf8")); } catch { return null; } }

const radius = (a) => a.r || AREA_M;

// Backcountry zones where alex says the trails are bike trails, so the Recreation Sites and Trails BC trails (DataBC layer
// WHSE_FOREST_TENURE.FTEN_RECREATION_LINES_SVW, Open Government Licence - British Columbia) count as MTB trails there.
// A path or bridleway with REC_SHARE of its length within REC_M of one gets tf:rec=<trail name> and tf:rec-id=<REC file
// id>, is official (tf:official), and is named after the trail when OpenStreetMap has no name (tf:name). Its uses and
// description come along when DataBC's trail details layer (FTEN_REC_TRAILS_SVW) has them (tf:rec-use, tf:rec-about).
// Every trail of the zone inside a provincial park or protected area (WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW, same licence)
// gets tf:park=<park name>. If DataBC can't be reached, the zone keeps its last good list.
const REC_ZONES = ["chil"];
// Zones where every trail in the list is official (alex: "make all mtb tagged trail in williams lake official trail"):
// each way gets tf:official=<reason>, unless it already has a reason or is named like a road.
const OFFICIAL_ZONES = { wl: "an established Williams Lake mountain bike trail (Fox Mountain, Desous Mountain and around town)" };
const REC_M = 60, REC_SHARE = 0.6;
const WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs";
const WINTER = /\b(winter|snowmobile|sled|ski|snowshoe|nordic)\b/i;

function mtbQuery([s, w, n, e], areas = [], rec = false) {
  const bb = [s, w, n, e].map((x) => x.toFixed(5)).join(",");
  const named = areas.map((a) => `  way["highway"~"^(path|bridleway)$"]["name"](around:${radius(a)},${a.c[0]},${a.c[1]});\n`).join("");
  return `[out:json][timeout:180];
(
  way["highway"]["mtb:scale"](${bb});
  way["highway"]["mtb:scale:imba"](${bb});
  way["highway"]["mtb"](${bb});
  way["highway"]["mtb:type"](${bb});
  way["highway"="path"]["bicycle"="customers"](${bb});
${named}${rec ? `  way["highway"~"^(path|bridleway)$"](${bb});\n` : ""})->.w;
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
async function fetchBox(box, areas, rec, depth = 0) {
  try { return (await overpass(mtbQuery(box, areas, rec))).elements; }
  catch (e) {
    if (!e.heavy || depth >= 2) throw e;
    log(`    too heavy, splitting in 4`);
    const seen = new Map();
    for (const q of quarters(box)) for (const el of await fetchBox(q, areas, rec, depth + 1)) seen.set(el.type + el.id, el);
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
const areasOf = (z) => AREAS.filter((a) => a.zone === z.id);
const zoneRules = (z) => (REC_ZONES.includes(z.id) ? [["rec", REC_M, REC_SHARE]] : []).concat(OFFICIAL_ZONES[z.id] ? [["official", OFFICIAL_ZONES[z.id]]] : []);
const areasKey = (z) => JSON.stringify(areasOf(z).map((a) => [a.name, a.c, radius(a), a.official || ""].concat(a.park ? [a.park] : [])).concat(zoneRules(z)));
// A list made for a different box (or before boxes were saved), older rules or other riding areas is out of date, however fresh.
// Files from before areas were saved count as up to date unless the zone has a backcountry area (radius r) or a zone rule.
const sameAreas = (z, f) => (f.areas === undefined ? !areasOf(z).some((a) => a.r) && !zoneRules(z).length : f.areas === areasKey(z));
const sameBox = (z) => { const f = readJson(`mtb-${z.id}.json`) || {}; return String(f.box) === String(z.box) && f.rules === RULES && sameAreas(z, f); };
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180));
const ownMtb = (t) => Object.keys(t).some((k) => /^mtb(:|$)/.test(k) && !(k === "mtb" && t.mtb === "no")) || t.bicycle === "customers";

// ---------- Recreation Sites and Trails BC trails and parks, from DataBC (REC_ZONES only) ----------
// The query box is in BC Albers (EPSG:3005), which has no axis-order surprises.
function albers(lat, lon) {
  const a = 6378137, f = 1 / 298.257222101, e2 = 2 * f - f * f, e = Math.sqrt(e2), rad = Math.PI / 180;
  const m = (p) => Math.cos(p) / Math.sqrt(1 - e2 * Math.sin(p) ** 2);
  const q = (p) => { const s = Math.sin(p); return (1 - e2) * (s / (1 - e2 * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s))); };
  const p1 = 50 * rad, p2 = 58.5 * rad, p0 = 45 * rad, l0 = -126 * rad;
  const n = (m(p1) ** 2 - m(p2) ** 2) / (q(p2) - q(p1)), C = m(p1) ** 2 + n * q(p1);
  const rho0 = (a * Math.sqrt(C - n * q(p0))) / n, rho = (a * Math.sqrt(C - n * q(lat * rad))) / n, th = n * (lon * rad - l0);
  return [1000000 + rho * Math.sin(th), rho0 - rho * Math.cos(th)];
}
function albersBox([s, w, n, e]) {
  const pts = [];
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) pts.push(albers(s + ((n - s) * i) / 4, w + ((e - w) * j) / 4));
  return [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))].map((v) => v.toFixed(1));
}
async function wfsGet(params) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${WFS}?${new URLSearchParams(params)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120000) });
      const text = await res.text();
      if (!res.ok || !text.startsWith("{")) throw new Error(`DataBC HTTP ${res.status}: ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160)}`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (/HTTP 400/.test(e.message)) break;
      await sleep(10000 * (attempt + 1) * (process.env.FAST_RETRY ? 0.001 : 1));
    }
  }
  throw lastErr;
}
async function bcLayer(layer, box) {
  const d = await wfsGet({ service: "WFS", version: "2.0.0", request: "DescribeFeatureType", typeName: `pub:${layer}`, outputFormat: "application/json" });
  const props = (d.featureTypes || [])[0]?.properties || [];
  const geom = (props.find((p) => /^gml:/.test(p.type || "")) || {}).name || "GEOMETRY";
  const fc = await wfsGet({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: `pub:${layer}`, outputFormat: "application/json",
    srsName: "EPSG:4326", count: "5000", CQL_FILTER: `BBOX(${geom}, ${albersBox(box).join(", ")}, 'EPSG:3005')` });
  return fc.features || [];
}
// [lat, lon], whichever axis order the server used (in BC, longitudes are beyond ±90).
const latLon = ([x, y]) => (Math.abs(x) > 90 ? [y, x] : [x, y]);
const geoLines = (g) => (g.type === "MultiLineString" ? g.coordinates : g.type === "LineString" ? [g.coordinates] : []).map((l) => l.map(latLon));
const geoPolys = (g) => (g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : []).map((p) => p.map((r) => r.map(latLon)));
// "MCGILLIVRAY PASS RECREATION TRAIL" -> "McGillivray Pass Recreation Trail"; "Taylor Creek" -> "Taylor Creek Trail".
const titleCase = (s) => (/[a-z]/.test(s) ? s : s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bMc(\w)/g, (_, c) => "Mc" + c.toUpperCase())
  .replace(/(?<=.)\b(And|Of|To|The)\b/g, (w) => w.toLowerCase())).trim();
const trailTitle = (s) => { const t = titleCase(s); return /\b(trails?|route|loop|path)\b/i.test(t) ? t : t + " Trail"; };

async function recData(box) {
  const feats = (await bcLayer("WHSE_FOREST_TENURE.FTEN_RECREATION_LINES_SVW", box)).filter((f) => {
    const p = f.properties || {};
    return /trail/i.test(p.PROJECT_TYPE || "") && (p.LIFE_CYCLE_STATUS_CODE || "ACTIVE") === "ACTIVE" && !WINTER.test(p.PROJECT_NAME || "");
  });
  // Uses and description, for the trails the Recreation Sites and Trails BC website describes. Optional.
  const info = new Map();
  try {
    for (const f of await bcLayer("WHSE_FOREST_TENURE.FTEN_REC_TRAILS_SVW", box)) {
      const p = f.properties || {};
      const use = Array.from({ length: 10 }, (_, i) => p[`ACTIVITY_DESC${i + 1}`]).filter(Boolean).join(", ");
      const about = (p.PROJECT_DESCRIPTION || "").split(/\r?\n\s*\r?\n/).filter((x) => x.trim() && !/\*\*NOTICE\*\*/i.test(x))   // fire and closure notices go stale
        .join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      info.set(p.FOREST_FILE_ID, { use, about: about.length > 300 ? about.slice(0, 297).replace(/\s+\S*$/, "") + "…" : about });
    }
  } catch (e) { log(`    Recreation Sites and Trails BC trail details not available (${e.message.slice(0, 120)})`); }
  const byId = new Map();
  for (const f of feats) {
    const p = f.properties, id = p.FOREST_FILE_ID || String(f.id);
    if (!byId.has(id)) byId.set(id, { id, name: trailTitle(p.PROJECT_NAME || p.MAP_LABEL || id), ...(info.get(id) || {}), lines: [] });
    byId.get(id).lines.push(...geoLines(f.geometry || {}));
  }
  const trails = [...byId.values()];
  // Points every 20 m along the trails, in cells of about 100 m, to find the paths that run along them.
  const index = new Map();
  for (const t of trails) for (const l of t.lines) for (let i = 1; i < l.length; i++) {
    const n = Math.max(1, Math.ceil(metres(l[i - 1], l[i]) / 20));
    for (let k = 0; k <= n; k++) {
      const p = [l[i - 1][0] + ((l[i][0] - l[i - 1][0]) * k) / n, l[i - 1][1] + ((l[i][1] - l[i - 1][1]) * k) / n], key = cellOf(p).join(",");
      if (!index.has(key)) index.set(key, []);
      index.get(key).push([p, t]);
    }
  }
  const parks = (await bcLayer("WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW", box)).map((f) => {
    const polys = geoPolys(f.geometry || {}), pts = polys.flat(2);
    return { name: titleCase(f.properties.PROTECTED_LANDS_NAME || ""), polys,
      box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] };
  }).filter((p) => p.name && p.polys.length);
  log(`  ${trails.length} Recreation Sites and Trails BC trails (${info.size} with details), ${parks.length} parks`);
  return { trails, index, parks };
}
const cellOf = ([lat, lon]) => [Math.floor(lat * 1100), Math.floor(lon * 700)];
// The Recreation Sites and Trails BC trail a way runs along (REC_SHARE of its points within REC_M of it), or null.
function recMatch(geometry, index) {
  const pts = [];
  for (let i = 1; i < geometry.length; i++) {
    const a = [geometry[i - 1].lat, geometry[i - 1].lon], b = [geometry[i].lat, geometry[i].lon], n = Math.max(1, Math.ceil(metres(a, b) / 25));
    for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  pts.push([geometry[geometry.length - 1].lat, geometry[geometry.length - 1].lon]);
  const hits = new Map();
  for (const p of pts) {
    const [i, j] = cellOf(p);
    let best = null, bestM = REC_M;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const [q, t] of index.get(`${i + di},${j + dj}`) || []) {
      const d = metres(p, q);
      if (d <= bestM) { bestM = d; best = t; }
    }
    if (best) hits.set(best, (hits.get(best) || 0) + 1);
  }
  const [t, n] = [...hits].sort((a, b) => b[1] - a[1])[0] || [];
  return t && n / pts.length >= REC_SHARE ? t : null;
}
function inPark([lat, lon], park) {
  const [s, w, n, e] = park.box;
  if (lat < s || lat > n || lon < w || lon > e) return false;
  return park.polys.some((rings) => {
    let inside = false;   // even-odd over all rings, so holes count as outside
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [yi, xi] = r[i], [yj, xj] = r[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}
const order = [...ZONES].sort((a, b) => lastBuilt(a) - lastBuilt(b));   // oldest lists first
let updated = 0, failed = 0;
for (const z of order) {
  if (sameBox(z) && Date.now() - lastBuilt(z) < FRESH_HOURS * 3600e3) { log(`${z.name}: fresh, skipped`); continue; }
  if (outOfTime()) { log(`${z.name}: out of time, keeping last good data`); continue; }
  try {
    const areas = areasOf(z);
    const rec = REC_ZONES.includes(z.id) ? await recData(z.box) : null;
    const els = await fetchBox(z.box, areas, !!rec);
    const all = new Map(els.filter((e) => e.type === "way" && e.geometry && e.geometry.length > 1).map((w) => [w.id, w]));
    const rels = els.filter((e) => e.type === "relation");
    const longRoutes = rels.filter((r) => (r.members || []).filter((m) => m.type === "way").length > LONG_ROUTE);
    const routeWays = new Set(rels.filter((r) => !longRoutes.includes(r)).flatMap((r) => (r.members || []).filter((m) => m.type === "way").map((m) => m.ref)));
    // Riding areas with few MTB-tagged ways around them, and backcountry areas (own radius): their named paths count too.
    const tagged = [...all.values()].filter((w) => ownMtb(w.tags || {}) || routeWays.has(w.id));
    const sparse = areas.filter((a) => a.r || tagged.filter((w) => w.geometry.some((p) => metres([p.lat, p.lon], a.c) <= AREA_M)).length < SPARSE);
    const ways = {}, routes = {};
    let fromAreas = 0, fromRec = 0;
    for (const w of all.values()) {
      const tags = { ...(w.tags || {}) };
      const mid = w.geometry[w.geometry.length >> 1];
      const t = rec && /^(path|bridleway)$/.test(tags.highway || "") && !/^(no|private)$/.test(tags.access || "") ? recMatch(w.geometry, rec.index) : null;
      const park = rec && rec.parks.find((p) => inPark([mid.lat, mid.lon], p));
      if (!ownMtb(tags) && !routeWays.has(w.id) && !t) {
        const a = sparse.find((a) => metres([mid.lat, mid.lon], a.c) <= radius(a) || (a.park && park && park.name === a.park));
        if (!a || !tags.name || /^(no|private)$/.test(tags.access || "")) continue;
        tags["tf:area"] = a.name; fromAreas++;
        if (a.official && !/\b(road|rd)\b/i.test(tags.name)) tags["tf:official"] = a.official;
      }
      if (t) {
        tags["tf:rec"] = t.name; tags["tf:rec-id"] = t.id; fromRec++;
        tags["tf:official"] = `part of the ${t.name}, listed by Recreation Sites and Trails BC`;
        if (!tags.name) tags["tf:name"] = t.name;
        if (t.use) tags["tf:rec-use"] = t.use;
        if (t.about) tags["tf:rec-about"] = t.about;
      }
      if (park) tags["tf:park"] = park.name;
      if (OFFICIAL_ZONES[z.id] && !tags["tf:official"] && !/\b(road|rd)\b/i.test(tags.name || "")) tags["tf:official"] = OFFICIAL_ZONES[z.id];
      ways[w.id] = { tags, g: simplify(w.geometry).flatMap((p) => [round(p.lat), round(p.lon)]) };
    }
    rels.filter((r) => !longRoutes.includes(r)).forEach((r) => {
      const ids = (r.members || []).filter((m) => m.type === "way" && ways[m.ref]).map((m) => m.ref);
      if (ids.length) routes[r.id] = { name: (r.tags && (r.tags.name || r.tags.ref)) || "unnamed", ways: ids };
    });
    writeFileSync(new URL(`mtb-${z.id}.json`, DATA), JSON.stringify({ v: 1, rules: RULES, areas: areasKey(z), builtAt, box: z.box, ways, routes }));
    updated++;
    log(`${z.name}: ${Object.keys(ways).length} trails, ${Object.keys(routes).length} MTB routes` +
      (longRoutes.length ? `; left out long-distance routes ${longRoutes.map((r) => (r.tags && r.tags.name) || r.id).join(", ")}` : "") +
      (sparse.length ? `; ${fromAreas} named paths added in ${sparse.map((a) => a.name).join(", ")} (few bike tags there)` : "") +
      (rec ? `; ${fromRec} paths along Recreation Sites and Trails BC trails` : ""));
  } catch (e) {
    failed++;
    log(`${z.name}: failed (${e.message}), keeping last good data`);
  }
}
log(`Done in ${Math.round((Date.now() - started) / 60e3)} min: ${updated} updated, ${failed} failed.`);
if (failed && !updated) process.exit(1);
