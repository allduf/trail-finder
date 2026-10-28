// Coverage check: is every feature as good across Canada as around Whistler? (alex, 2026-10-27: "how do i make sure all
// the feature in the app including the resolution work everywhere as good as in whistler area?")
//
// For each sample spot below (Whistler first, as the yardstick) it reads the same files the app reads on the live site
// and asks the same map servers the app asks, then scores each feature:
//   ok    as good as Whistler            less  there, but thinner or blurrier than Whistler
//   none  the app has nothing there      na    doesn't apply (no avalanche forecasts in Toronto)
// Trails, ratings, trailheads, forest roads, riding areas, loam, summer photo zoom, 3D ground detail, winter photos
// (zoom and holes), ski runs, lift status, webcams, avalanche forecast, snow stations, backcountry areas, hunting zones and
// seasons, fishing zones and rules, logging areas.
//
// Writes coverage.json (OUT, default data/coverage.json) and prints a table. With PREV=<last coverage.json> it lists what
// got worse since then (a feature that dropped a step, or a count that fell by more than a third) in regressions.
// .github/workflows/coverage-check.yml runs it each day and writes the drops on the issue "Coverage check".
//
//   node scripts/coverage-check.mjs                       (SITE=https://allduf.github.io/trail-finder/ by default)
//   ONLY=whistler,bromont node scripts/coverage-check.mjs
import { writeFile, readFile } from "node:fs/promises";

const SITE = (process.env.SITE || "https://allduf.github.io/trail-finder/").replace(/\/?$/, "/");
const WINTER = new URL("../trail-finder-winter/", SITE).href;
const OUT = process.env.OUT || "data/coverage.json";
const R = 15;   // km around each spot for trails, runs, trailheads

// pv: province; mtn: mountains (avalanche forecasts, backcountry skiing expected); ski: a ski hill within ~15 km.
export const SPOTS = [
  { id: "whistler", name: "Whistler", pv: "bc", lat: 50.105, lon: -122.96, mtn: 1, ski: 1 },
  { id: "squamish", name: "Squamish", pv: "bc", lat: 49.715, lon: -123.13, mtn: 1 },
  { id: "cumberland", name: "Cumberland (Vancouver Island)", pv: "bc", lat: 49.6, lon: -125.04, mtn: 1, ski: 0 },
  { id: "mtwashington", name: "Mount Washington (Vancouver Island)", pv: "bc", lat: 49.745, lon: -125.3, mtn: 1, ski: 1 },
  { id: "kamloops", name: "Kamloops", pv: "bc", lat: 50.66, lon: -120.4 },
  { id: "sunpeaks", name: "Sun Peaks", pv: "bc", lat: 50.885, lon: -119.89, mtn: 1, ski: 1 },
  { id: "revelstoke", name: "Revelstoke", pv: "bc", lat: 51.0, lon: -118.18, mtn: 1, ski: 1 },
  { id: "kickinghorse", name: "Kicking Horse (Golden)", pv: "bc", lat: 51.29, lon: -117.05, mtn: 1, ski: 1 },
  { id: "rossland", name: "Rossland (RED Mountain)", pv: "bc", lat: 49.09, lon: -117.81, mtn: 1, ski: 1 },
  { id: "princegeorge", name: "Prince George", pv: "bc", lat: 53.91, lon: -122.78 },
  { id: "smithers", name: "Smithers", pv: "bc", lat: 54.79, lon: -127.2, mtn: 1, ski: 1 },
  { id: "canmore", name: "Canmore", pv: "ab", lat: 51.08, lon: -115.36, mtn: 1 },
  { id: "lakelouise", name: "Lake Louise", pv: "ab", lat: 51.44, lon: -116.16, mtn: 1, ski: 1, park: 1 },
  { id: "whitehorse", name: "Whitehorse", pv: "yt", lat: 60.72, lon: -135.07, mtn: 1 },
  { id: "bromont", name: "Bromont", pv: "qc", lat: 45.3, lon: -72.65, ski: 1 },
  { id: "tremblant", name: "Mont-Tremblant", pv: "qc", lat: 46.2, lon: -74.58, ski: 1 },
  { id: "msa", name: "Mont-Sainte-Anne", pv: "qc", lat: 47.08, lon: -70.9, ski: 1 },
  { id: "chicchocs", name: "Chic-Chocs (Gaspésie)", pv: "qc", lat: 48.95, lon: -66.0, mtn: 1, park: 1 },
  { id: "hardwood", name: "Hardwood Hills (Ontario)", pv: "on", lat: 44.53, lon: -79.55 },
  { id: "bluemtn", name: "Blue Mountain (Ontario)", pv: "on", lat: 44.5, lon: -80.31, ski: 1 },
  { id: "wentworth", name: "Wentworth (Nova Scotia)", pv: "ns", lat: 45.63, lon: -63.56, ski: 1 },
  { id: "sugarloaf", name: "Sugarloaf (New Brunswick)", pv: "nb", lat: 47.98, lon: -66.69, ski: 1 },
  { id: "marble", name: "Marble Mountain (Newfoundland)", pv: "nl", lat: 48.97, lon: -57.83, mtn: 1, ski: 1 },
];

// Which provinces the app has each thing for (from the code, not data files): logging areas (index.html: BC and Alberta
// open data, Quebec's MFFP WMS), hunting seasons (hunting.js seasons-<pv>), fishing rules by zone (fishing.js zones + rules).
const LOGGING = new Set(["bc", "ab", "qc"]);
// The provincial air photos the app uses where Esri has none (index.html LOCAL_PHOTOS), by province.
const mercBox = (z, x, y) => { const R = 20037508.342789244, n = 2 ** z; return [x / n * 2 * R - R, R - (y + 1) / n * 2 * R, (x + 1) / n * 2 * R - R, R - y / n * 2 * R]; };
const LOCAL_PHOTOS = {
  qc: (z, x, y) => `https://servicesmatriciels.mern.gouv.qc.ca/erdas-iws/ogc/wmts/Imagerie_Continue/Imagerie_GQ/default/GoogleMapsCompatibleExt2:epsg:3857/${z}/${y}/${x}.jpg`,
  nb: (z, x, y) => `https://geonb.snb.ca/arcgis/rest/services/GeoNB_Basemap_Imagery/MapServer/export?bbox=${mercBox(z, x, y).map((v) => v.toFixed(2))}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image`,
  on: ["2023to2027", "2018to2022"].map((years) => (z, x, y) => `https://ws.geoservices.lrc.gov.on.ca/arcgis5/rest/services/AerialImagery/GEO_Imagery_Data_Service_${years}/ImageServer/exportImage?bbox=${mercBox(z, x, y).map((v) => v.toFixed(2))}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image`),
};
// Banff National Park's own 15 cm photo (index.html banffTile), read from this one file: its box, roughly.
const BANFF = { box: [50.7, -116.6, 52.25, -114.95], tif: "https://aerial-imagery-canada.s3.ca-central-1.amazonaws.com/national-parks/banff-national-park/Banff-national-park-2025-15cm-RGBN-mosaic.tif" };
const HUNT_SEASONS = new Set(["bc", "ab", "qc", "on", "mb"]);
const FISH_RULES = new Set(["bc", "ab", "qc", "on"]);

// ---------- helpers ----------
const cache = new Map();
let failed = 0;   // requests that failed after retries (a result built on one isn't trusted)
async function get(url, as = "json") {
  const key = as + " " + url;
  if (!cache.has(key)) cache.set(key, (async () => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, { headers: { "User-Agent": "trail-finder-coverage-check" }, signal: AbortSignal.timeout(30000) });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return as === "json" ? await r.json() : as === "status" ? r.status : await r.arrayBuffer();
      } catch (e) { if (i === 2) { console.warn(`! ${url}: ${e.message}`); failed++; return undefined; } await new Promise((ok) => setTimeout(ok, 1500 * (i + 1))); }
    }
  })());
  return cache.get(key);
}
const data = (p) => get(SITE + p);
const km = (a, b, c, d) => {
  const r = Math.PI / 180, x = Math.sin(((c - a) * r) / 2), y = Math.sin(((d - b) * r) / 2);
  return 12742 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c * r) * y * y));
};
const near = (s, lat, lon, d = R) => km(s.lat, s.lon, lat, lon) <= d;
const anyNear = (s, g, d = R) => { for (let i = 0; i + 1 < (g || []).length; i += 2) if (near(s, g[i], g[i + 1], d)) return true; return false; };
const tileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat, z) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
// Ray casting on a flat [lat, lon, ...] ring.
function inRing(lat, lon, g) {
  let inside = false;
  for (let i = 0, j = g.length - 2; i < g.length; j = i, i += 2) {
    const [ay, ax, by, bx] = [g[i], g[i + 1], g[j], g[j + 1]];
    if ((ay > lat) !== (by > lat) && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
// Hunting/fishing outlines: [lat*1e4, lon*1e4, dlat, dlon, ...] per ring.
const unDelta = (r) => { const out = [r[0] / 1e4, r[1] / 1e4]; for (let i = 2; i + 1 < r.length; i += 2) out.push(out[i - 2] + r[i] / 1e4, out[i - 1] + r[i + 1] / 1e4); return out; };
const inShape = (s, z) => (!z.b || (s.lat >= z.b[0] && s.lat <= z.b[2] && s.lon >= z.b[1] && s.lon <= z.b[3])) && (z.g || []).some((r) => inRing(s.lat, s.lon, unDelta(r)));

// ---------- the app's own zones (index.html) and the Canada chunks (ca/) ----------
let zones = null;
async function homeZones() {
  if (zones) return zones;
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8").catch(() => "");
  zones = [...html.matchAll(/\{ id: "(\w+)", name: "[^"]*", box: \[([-\d., ]+)\] \}/g)].map((m) => ({ id: m[1], box: m[2].split(",").map(Number) }));
  return zones;
}
const inBox = (s, b, pad = 0) => s.lat >= b[0] - pad && s.lat <= b[2] + pad && s.lon >= b[1] - pad && s.lon <= b[3] + pad;
// Every MTB way within R km, from the home zones' mtb-<zone>.json and the Canada chunks ca/c/<chunk>.json (as the app does).
async function mtbWays(s) {
  const pad = R / 80, ways = new Map(), from = [];
  for (const z of await homeZones()) if (inBox(s, z.box, pad)) {
    const j = await data(`data/mtb-${z.id}.json`);
    if (j && j.ways) { from.push(z.id); for (const [id, w] of Object.entries(j.ways)) ways.set(id, w); }
  }
  const ca = await get(SITE + "ca/index.json");
  for (const p of (ca && ca.provinces) || []) for (const c of p.chunks) {
    const [la, lo] = c.split("_").map(Number);
    if (!inBox(s, [la, lo, la + ca.chunkLat, lo + ca.chunkLon], pad)) continue;
    const j = await get(`${SITE}ca/c/${c}.json`);
    if (j && j.mtb && j.mtb.ways) { from.push("ca_" + c); for (const [id, w] of Object.entries(j.mtb.ways)) if (!ways.has(id)) ways.set(id, w); }
  }
  const here = [...ways.entries()].filter(([, w]) => anyNear(s, w.g));
  return { here, from };
}
const RATED = (t) => t["mtb:scale:imba"] || t["mtb:scale"] || t["tf:hand"] || t["tf:official"];

// ---------- the checks ----------
// Each returns { s: ok|less|none|na, v: number shown, note }.
const ok = (v, note) => ({ s: "ok", v, note }), less = (v, note) => ({ s: "less", v, note }), none = (note, v = 0) => ({ s: "none", v, note }), na = (note) => ({ s: "na", v: null, note });
// A number compared with Whistler's: ok from `share` of it, else less; 0 is none.
const vsBase = (v, base, share, unit, noneNote) => (!v ? none(noneNote || `no ${unit}`) : base && v < base * share ? less(v, `${v} ${unit} (Whistler ${base})`) : ok(v, `${v} ${unit}`));

const CHECKS = [
  ["trails", "MTB trails", "Riding", async (s) => {
    const { here } = await mtbWays(s);
    return here.length ? ok(here.length, `${here.length} MTB trails within ${R} km`) : none("no MTB trails mapped");
  }],
  ["rated", "Trails with a difficulty", "Riding", async (s, base) => {
    const { here } = await mtbWays(s);
    if (!here.length) return na("no trails");
    const pct = Math.round((100 * here.filter(([, w]) => RATED(w.tags || {})).length) / here.length);
    return vsBase(pct, base, 0.75, "% rated", "no trail has a difficulty");
  }],
  ["official", "Official/club trail data", "Riding", async (s) => {
    const sq = (v) => Math.floor(v * 2) / 2;
    let n = 0;
    for (const dir of ["official", "ratings"]) for (const dl of [-0.5, 0, 0.5]) for (const dn of [-0.5, 0, 0.5]) {
      const j = await data(`data/${dir}/${sq(s.lat + dl)}_${sq(s.lon + dn)}.json`);
      for (const l of (j && j.lines) || []) { const g = l[l.length - 1]; if (Array.isArray(g) && near(s, g[0] / 1e5, g[1] / 1e5)) n++; }
    }
    return n ? ok(n, `${n} official or club trail lines`) : none("no official or club trail data (OSM only)");
  }],
  ["access", "Trailheads & parking", "Riding", async (s) => {
    let n = 0;
    for (const z of await homeZones()) if (inBox(s, z.box, 0.2)) { const j = await data(`data/access-${z.id}.json`); n += ((j && j.osm) || []).filter((p) => near(s, p.lat, p.lon)).length; }
    const idx = await get(SITE + "ca/a/index.json");
    for (const c of (idx && idx.chunks) || []) {
      const [la, lo] = c.split("_").map(Number);
      if (!inBox(s, [la, lo, la + 1, lo + 1.2], 0.2)) continue;
      const j = await get(`${SITE}ca/a/${c}.json`); n += ((j && j.osm) || []).filter((p) => near(s, p.lat, p.lon)).length;
    }
    // Fewer trails, fewer lots: what matters is that the trails have some.
    const { here } = await mtbWays(s);
    if (!here.length) return n ? ok(n, `${n} trailheads, lots and toilets`) : na("no trails");
    return n ? ok(n, `${n} trailheads, lots and toilets`) : none("no trailheads or parking");
  }],
  ["roads", "Forest roads", "Riding", async (s) => {
    let n = 0, src = "";
    for (const z of await homeZones()) if (inBox(s, z.box, 0.1)) {
      const j = await data(`data/roads-${z.id}.json`);
      if (j) { src = "home"; for (const k of ["ften", "osm"]) n += Object.values(j[k] || {}).filter((r) => anyNear(s, r.g)).length; }
    }
    if (!n) {
      const idx = await get(SITE + "ca/r/index.json");
      for (const c of (idx && idx.chunks) || []) {
        const [la, lo] = c.split("_").map(Number);
        if (!inBox(s, [la, lo, la + 1, lo + 1.2], 0.1)) continue;
        const j = await get(`${SITE}ca/r/${c}.json`); src = "osm";
        n += Object.values((j && j.osm) || {}).filter((r) => anyNear(s, r.g)).length;
      }
    }
    if (!n) return s.park ? na("inside a park: no forest roads") : none("no forest roads layer");
    return src === "home" || s.pv === "ab" ? ok(n, `${n} roads`) : less(n, `${n} roads (OpenStreetMap only: no BC road permits or status)`);
  }],
  ["areas", "Riding area names", "Riding", async (s) => {
    const list = JSON.parse(await readFile(new URL("../data/riding-areas.json", import.meta.url), "utf8")).areas;
    const n = list.filter((a) => near(s, a.c[0], a.c[1], 25)).length;
    return n ? ok(n, `${n} riding areas within 25 km`) : none("no riding area within 25 km (Where to ride today, Loops)");
  }],
  ["loam", "Loam index", "Riding", async (s) => {
    const soil = JSON.parse(await readFile(new URL("../data/loam-soil.json", import.meta.url), "utf8"));
    const row = soil.rows[Math.round((s.lat - soil.lat0) / soil.step)], ch = row && row[Math.round((s.lon - soil.lon0) / soil.step)];
    // One request for every spot (Open-Meteo takes lists), so a run doesn't hit its per-minute limit.
    const all = await get(`https://api.open-meteo.com/v1/forecast?latitude=${spots.map((x) => x.lat)}&longitude=${spots.map((x) => x.lon)}&hourly=soil_moisture_3_to_9cm&forecast_days=1`);
    if (!all) return { s: "err", v: null, note: "Open-Meteo didn't answer" };
    const m = [].concat(all)[spots.indexOf(s)];
    const v = m && m.hourly && m.hourly.soil_moisture_3_to_9cm.find((x) => x != null);
    if (v == null) return none("Open-Meteo has no soil moisture here");
    return ch && ch !== "0" ? ok(1, `soil type ${ch}, moisture ${v}`) : less(1, `moisture ${v} but no soil type (wrong scale)`);
  }],
  ["photo", "Summer photo sharpness", "Maps", async (s, base) => {
    // Esri's tilemap says which zooms really have a photo (the app's EsriDeep layer goes to the deepest).
    let deep = 0;
    for (let z = 22; z >= 12 && !deep; z--) {
      const j = await get(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tilemap/${z}/${tileY(s.lat, z)}/${tileX(s.lon, z)}/1/1`);
      if (j && j.data && j.data[0]) deep = z;
    }
    // Where Esri has no air photo (zoom 20), the app shows the province's own (index.html, tfLocalPhoto).
    for (const url of [LOCAL_PHOTOS[s.pv] || []].flat()) {
      if (deep >= 20) break;
      const z = 20, buf = await get(url(z, tileX(s.lon, z), tileY(s.lat, z)), "bytes");
      if (buf && buf.byteLength > 3000) deep = Math.max(deep, base || 21);
    }
    const [b0, b1, b2, b3] = BANFF.box;
    if (deep < 20 && s.lat > b0 && s.lat < b2 && s.lon > b1 && s.lon < b3) {
      const r = await fetch(BANFF.tif, { headers: { Range: "bytes=0-15" } }).catch(() => null);
      if (r && r.status === 206) deep = Math.max(deep, base || 21);
    }
    const m = Math.round(40075000 * Math.cos((s.lat * Math.PI) / 180) / 2 ** (deep + 8) * 100) / 100;
    return vsBase(deep, base, 1, `zoom (${m} m a pixel)`, "no photo");
  }],
  ["dem", "3D ground detail", "Maps", async (s, base) => {
    let deep = 0;
    for (let z = 16; z >= 10 && !deep; z--) if ((await get(`https://tiles.mapterhorn.com/${z}/${tileX(s.lon, z)}/${tileY(s.lat, z)}.webp`, "status")) === 200) deep = z;
    const m = Math.round(40075000 * Math.cos((s.lat * Math.PI) / 180) / 2 ** (deep + 9));
    return vsBase(deep, base, 1, `zoom (~${m} m heights)`, "no terrain heights");
  }],
  ["winter", "Winter photos", "Maps", async (s, base) => {
    const blocks = await get(WINTER + "blocks.json");
    const have = new Set((blocks || []).map(([x, y]) => x + "/" + y));
    if (!have.has(tileX(s.lon, 11) + "/" + tileY(s.lat, 11))) return none("no winter photos (summer photo tinted white)");
    // The deepest zoom with a photo at the spot, and how many of the 5x5 tiles around it are there (holes).
    let deep = 0;
    for (const z of [14, 13, 12]) if (!deep && (await get(`${WINTER}${z}/${tileX(s.lon, z)}/${tileY(s.lat, z)}.webp`, "status")) === 200) deep = z;
    let got = 0, all = 0;
    const z = 13, x0 = tileX(s.lon, z), y0 = tileY(s.lat, z);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      if (!have.has(((x0 + dx) >> 2) + "/" + ((y0 + dy) >> 2))) continue;
      all++; if ((await get(`${WINTER}${z}/${x0 + dx}/${y0 + dy}.webp`, "status")) === 200) got++;
    }
    const holes = all ? Math.round((100 * (all - got)) / all) : 0;
    const note = `to zoom ${deep}, ${holes}% holes at zoom 13`;
    if (!deep) return none("winter square listed but no photo tiles");
    return (base && deep < base) || holes > 10 ? less(deep, note) : ok(deep, note);
  }],
  ["runs", "Ski runs & nordic", "Skiing", async (s) => {
    if (!s.ski) return na("no ski hill");
    let n = 0;
    const ski = await data("data/ski.json");
    if (ski && ski.regions.some((b) => inBox(s, b))) n += ski.routes.filter((r) => r.type !== "tour" && r.g.some((g) => anyNear(s, g))).length;
    const idx = await get(SITE + "ca/w/index.json");
    const key = `${Math.floor(s.lat / 3) * 3}_${Math.floor(s.lon / 6) * 6}`;
    if (idx && idx.tiles && idx.tiles[key]) { const j = await get(`${SITE}ca/w/${key}.json`); n += ((j && j.routes) || []).filter((r) => r.type !== "snowmobile" && r.g.some((g) => anyNear(s, g))).length; }
    return n ? ok(n, `${n} runs and nordic trails`) : none("no runs or nordic trails");
  }],
  ["tours", "Ski tours", "Skiing", async (s) => {
    if (!s.mtn) return na("no mountains");
    let n = 0;
    const ski = await data("data/ski.json");
    if (ski && ski.regions.some((b) => inBox(s, b))) n += ski.routes.filter((r) => r.type === "tour" && r.g.some((g) => anyNear(s, g, 30))).length;
    const j = await data(`data/ski-canada/${Math.floor(s.lat / 3) * 3}_${Math.floor(s.lon / 6) * 6}.json`);
    n += ((j && j.routes) || []).filter((r) => r.type === "tour" && r.g.some((g) => anyNear(s, g, 30))).length;
    return n ? ok(n, `${n} tour lines within 30 km`) : none("no ski tours");
  }],
  ["lifts", "Lift status", "Skiing", async (s) => {
    if (!s.ski) return na("no ski hill");
    const l = JSON.parse(await readFile(new URL("../data/ski-lifts.json", import.meta.url), "utf8"));
    const r = Object.values(l.resorts).find((x) => near(s, x.lat, x.lon, 25));
    if (!r) return none("no lifts or lift status for this resort");
    return r.live ? ok(1, `${r.name}: live lift status`) : less(1, `${r.name}: lifts mapped, status from its page only`);
  }],
  ["webcams", "Webcams", "Skiing", async (s) => {
    if (!s.ski && !s.mtn) return na("no ski hill or mountains");
    const w = JSON.parse(await readFile(new URL("../data/webcams.json", import.meta.url), "utf8"));
    const here = w.cams.filter((c) => near(s, c.lat, c.lon, 40)), live = here.filter((c) => c.img || c.embed).length;
    if (live) return ok(live, `${live} live webcams within 40 km`);
    return here.length ? less(here.length, "a link to the resort's webcam page, no picture in the app") : none("no webcams");
  }],
  ["avalanche", "Avalanche forecast", "Skiing", async (s) => {
    if (!s.mtn) return na("no avalanche terrain");
    const a = await data("data/avalanche.json");
    const hit = ((a && a.areas) || []).find((x) => x.rings.some((g) => inRing(s.lat, s.lon, g)));
    if (hit) return ok(1, hit.name);
    // Out of season the forecasters publish only a few bulletins: what matters is that someone forecasts here.
    const sa = JSON.parse(await readFile(new URL("../data/ski-areas.json", import.meta.url), "utf8"));
    const f = sa.areas.find((x) => x.lat != null && near(s, x.lat, x.lon, 60) && x.forecast && x.forecast !== "none");
    return f ? ok(1, `${(sa.forecasters[f.forecast] || {}).name || f.forecast} (out of season now)`) : a && a.season !== "on" ? na("out of season") : none("no avalanche forecast area");
  }],
  ["snow", "Snow stations", "Skiing", async (s) => {
    const st = await data("data/snow-stations.json");
    const n = ((st && st.stations) || []).filter((x) => near(s, x.lat, x.lon, 100)).length;
    // Outside BC only stations that saw snow this week are kept (build-snow-stations.mjs): none in summer and fall is normal.
    const month = new Date().getUTCMonth() + 1;
    if (!n && s.pv !== "bc" && month >= 5 && month <= 10) return na("no snow yet (stations outside BC show once it snows)");
    return n ? ok(n, `${n} within 100 km`) : none("no snow station within 100 km");
  }],
  ["backcountry", "Backcountry ski areas", "Skiing", async (s) => {
    if (!s.mtn) return na("no mountains");
    const sa = JSON.parse(await readFile(new URL("../data/ski-areas.json", import.meta.url), "utf8"));
    const n = sa.areas.filter((x) => { const c = x.c || (x.lat != null ? [x.lat, x.lon] : null); return c && near(s, c[0], c[1], 60); }).length;
    return n ? ok(n, `${n} areas within 60 km`) : none("no backcountry area card");
  }],
  ["hunt", "Hunting zones", "Hunting", async (s) => {
    const files = s.pv === "bc" || s.pv === "ab" ? ["zones"] : [`zones-${s.pv}`];
    for (const f of files) { const j = await data(`data/hunting/${f}.json`); const z = ((j && j.zones) || []).find((x) => (x.p || s.pv) === s.pv && inShape(s, x)); if (z) return ok(1, `zone ${z.id}${z.zn ? " " + z.zn : ""}`); }
    const fz = await data("data/fishing/zones.json");
    const np = ((fz && fz.zones) || []).find((x) => x.k === "np" && inShape(s, x));
    return np ? ok(1, `${np.n}: no hunting in national parks`) : none("no hunting zone");
  }],
  ["seasons", "Hunting seasons", "Hunting", async (s) => HUNT_SEASONS.has(s.pv) ? ok(1, "open seasons by zone") : less(0, "zone shown, seasons only as a link")],
  ["fish", "Fishing rules", "Fishing", async (s) => {
    const j = await data("data/fishing/zones.json");
    const z = ((j && j.zones) || []).find((x) => x.k === s.pv && inShape(s, x));
    if (z && FISH_RULES.has(s.pv)) return ok(1, `zone ${z.id} ${z.n || ""}`.trim());
    const np = ((j && j.zones) || []).find((x) => x.k === "np" && inShape(s, x));
    if (np) return ok(1, `${np.n}: national park rules`);
    if (FISH_RULES.has(s.pv)) return none("no fishing zone here (the province has zones)");
    return less(0, "province rules link only, no zone rules");
  }],
  // Outside BC, Alberta and Quebec the app shows Global Forest Watch's forest loss since 2010 (index.html lossLayer).
  ["logging", "Logging areas", "Riding", async (s) => LOGGING.has(s.pv) ? ok(1, "cut blocks layer") : ok(1, "forest cut or burned since 2010, from space (30 m)")],
];

// ---------- run ----------
const only = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const spots = SPOTS.filter((s) => !only || only.has(s.id) || s.id === "whistler");
const rows = {};
for (const s of spots) {
  rows[s.id] = {};
  for (const [id, , , fn] of CHECKS) {
    const base = s.id === "whistler" ? null : rows.whistler && rows.whistler[id] && rows.whistler[id].v;
    const f0 = failed;
    try { rows[s.id][id] = await fn(s, base); } catch (e) { rows[s.id][id] = { s: "err", v: null, note: e.message }; }
    if (failed > f0 && rows[s.id][id].s !== "ok") rows[s.id][id] = { s: "err", v: null, note: "a server didn't answer" };
  }
  const r = rows[s.id], c = (k) => Object.values(r).filter((x) => x.s === k).length;
  console.log(`${s.name.padEnd(36)} ok ${c("ok")}  less ${c("less")}  none ${c("none")}${c("err") ? `  err ${c("err")}` : ""}`);
}

// What got worse since the last run: a step down (ok > less > none) or a count down by more than a third.
const RANK = { ok: 2, less: 1, none: 0 };
let regressions = [];
if (process.env.PREV) {
  const prev = JSON.parse(await readFile(process.env.PREV, "utf8").catch(() => "null"));
  for (const s of spots) for (const [id, label] of CHECKS) {
    const a = prev && prev.rows && prev.rows[s.id] && prev.rows[s.id][id], b = rows[s.id][id];
    if (!a || !(a.s in RANK) || !(b.s in RANK)) continue;
    if (RANK[b.s] < RANK[a.s] || (a.v > 3 && b.v != null && b.v < a.v * 0.66 && !["photo", "dem", "winter"].includes(id)) || (["photo", "dem", "winter"].includes(id) && b.v < a.v))
      regressions.push({ spot: s.name, check: label, was: `${a.s}: ${a.note}`, now: `${b.s}: ${b.note}` });
  }
}
const out = {
  builtAt: new Date().toISOString(), site: SITE,
  checks: CHECKS.map(([id, label, group]) => ({ id, label, group })),
  spots: spots.map(({ id, name, pv, lat, lon }) => ({ id, name, pv, lat, lon })),
  rows, regressions,
};
await writeFile(OUT, JSON.stringify(out));
console.log(`\nWrote ${OUT}.`);
if (regressions.length) { console.log(`\n${regressions.length} got worse since the last check:`); for (const r of regressions) console.log(`- ${r.spot}, ${r.check}: ${r.was} -> ${r.now}`); }

// ---------- table (run summary) and the issue ----------
const ICON = { ok: "✅", less: "🟡", none: "❌", na: "·", err: "⚠️" };
const md = [
  `| Spot | ${CHECKS.map(([, label]) => label).join(" | ")} |`,
  `|---|${CHECKS.map(() => ":-:").join("|")}|`,
  ...spots.map((s) => `| ${s.name} | ${CHECKS.map(([id]) => ICON[rows[s.id][id].s] || "?").join(" | ")} |`),
].join("\n");
const drops = regressions.map((r) => `- **${r.spot}**, ${r.check}: ${r.was} → ${r.now}`).join("\n");
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import("node:fs/promises");
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Coverage vs Whistler\n\n✅ as good as Whistler · 🟡 thinner or blurrier · ❌ missing · · not needed there\n\n${md}\n\n${drops ? `### Got worse since last check\n${drops}\n` : ""}`);
}
const TOKEN = process.env.GITHUB_TOKEN, REPO = process.env.GITHUB_REPOSITORY, OWNER = process.env.OWNER || "allduf";
if (TOKEN && REPO && !process.env.DRY) {
  const MARK = "<!-- coverage-check -->", TITLE = "Coverage check";
  const github = async (path, method = "GET", body) => {
    const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
      method, body: body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "trail-finder-coverage-check" },
    });
    if (!r.ok) throw new Error(`GitHub ${method} ${path}: ${r.status} ${await r.text()}`);
    return r.json();
  };
  const issues = await github(`/issues?state=all&creator=${encodeURIComponent("github-actions[bot]")}&per_page=100`);
  let issue = issues.find((i) => !i.pull_request && (i.body || "").includes(MARK));
  const day = out.builtAt.slice(0, 10);
  const body = `${MARK}\nEach day \`.github/workflows/coverage-check.yml\` checks that every feature works across Canada as well as around ` +
    `Whistler (scripts/coverage-check.mjs). Anything that got worse is written below and mentions @${OWNER}.\n\n` +
    `✅ as good as Whistler · 🟡 thinner or blurrier · ❌ missing · · not needed there. Last checked ${day}.\n\n${md}\n`;
  if (!issue) issue = await github("/issues", "POST", { title: TITLE, body, assignees: [OWNER] });
  else await github(`/issues/${issue.number}`, "PATCH", { body, state: "open" });
  if (regressions.length) {
    await github(`/issues/${issue.number}/comments`, "POST", { body: `### ${day}\n@${OWNER} ${regressions.length} thing${regressions.length > 1 ? "s" : ""} got worse since the last check:\n\n${drops}` });
    console.log(`Commented on issue #${issue.number}.`);
  }
}
