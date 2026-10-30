// Japan, for Skiing only (alex 2026-10-30: three weeks this winter in a camper van, Hakuba Valley and Hokkaido, "i still
// want to have acces to the information in other region just in case"; "make sure it only in skiing"; "i dont want to
// use storage or space for sports i wont use there"). Reads Geofabrik's Japan region files in the weekly Japan job
// (.github/workflows/japan-data.yml) and writes only what Skiing shows:
//   out/jp/w/<square>.json  { routes, huts, parking, lifts, resorts }: ski runs, tours, nordic, snowshoe and snowmobile
//                           routes, mountain huts, parking near tours, ski lifts. The data/ski-canada/ square format,
//                           so winter.js loads them like the rest of Canada (CAN_DIRS); lifts go to lifts.js.
//   out/jp/c/<square>.json  { points, closed }: camper van stops for the drive (Michi-no-eki roadside stations,
//                           expressway rest areas, RV parks, campsites, onsen and public baths, gas, coin laundries, dump
//                           stations, ferry terminals) and roads closed in winter. Drawn by camper.js (Skiing only).
// Both with an index.json { tiles: { <square>: { box, kb, ... } } }.
//   node scripts/build-japan.mjs ingest <region> <ski.geojsonseq> <ski.opl> <areas.geojsonseq> <points.geojsonseq> <roads.geojsonseq>
//   node scripts/build-japan.mjs finish
// Names: English (name:en) when mapped, else romaji (name:ja-Latn, name:ja_rm), else the Japanese name; the Japanese
// name is kept as tags["name:ja"] so the card can show both. Run: Node 18 or newer, no packages needed.

import { writeFileSync, mkdirSync, readdirSync, createReadStream, existsSync, rmSync, appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const root = new URL("../", import.meta.url);
const OUT_W = new URL("out/jp/w/", root), OUT_C = new URL("out/jp/c/", root), PART = new URL("out/japan/", root);
const TILE_LAT = 3, TILE_LON = 6;   // ski squares, as data/ski-canada/
const CAMP_DEG = 1;                 // camper squares: 1° (gas stations are many)
const round = (n) => Math.round(n * 1e5) / 1e5;
const log = (...a) => console.log(...a);
const tileOf = (lat, lon) => `${Math.floor(lat / TILE_LAT) * TILE_LAT}_${Math.floor(lon / TILE_LON) * TILE_LON}`;
const campOf = (lat, lon) => `${Math.floor(lat / CAMP_DEG) * CAMP_DEG}_${Math.floor(lon / CAMP_DEG) * CAMP_DEG}`;

function nameOf(t) {
  const en = t["name:en"] || t["name:ja-Latn"] || t["name:ja_rm"] || "";
  return { name: en || t.name || t["piste:name"] || t.ref || "", ja: en && t.name && t.name !== en ? t.name : "" };
}

// The same types as build-winter.mjs's skiType(); downhill ungroomed / freeride runs are tours outside a resort's
// boundary and resort off-piste inside it (finish()).
const SNOWMOBILE_OK = /^(yes|designated|permissive)$/;
function skiType(t) {
  const pt = String(t["piste:type"] || "").split(";")[0], groom = t["piste:grooming"] || "";
  if (pt === "skitour" || (t.route === "ski" && !pt)) return "tour";
  if (pt === "downhill" && (/backcountry|no/.test(groom) || (!groom && t["piste:difficulty"] === "freeride"))) return "freeride";
  if (pt === "nordic") return "nordic";
  if (pt === "hike") return "snowshoe";
  if (pt === "downhill") return "resort";
  if (pt === "snowmobile" || t.route === "snowmobile") return "snowmobile";
  if (pt === "sled") return "";
  if (pt) return "other";
  if (SNOWMOBILE_OK.test(t.snowmobile || "") && !/^(motorway|trunk|primary|secondary|tertiary|residential)/.test(t.highway || "")) return "snowmobile";
  if (t["ski:nordic"] && /^(yes|designated)$/.test(t["ski:nordic"])) return "nordic";
  if (/^(yes|designated)$/.test(t.ski || "") && !/^(motorway|trunk|primary|secondary|tertiary|residential|service)/.test(t.highway || "")) return "access";
  return "";
}
const OSM_KEEP = ["name", "name:ja", "ref", "piste:name", "piste:difficulty", "piste:grooming", "piste:type", "description", "description:en", "note", "website", "operator", "access", "ski", "ele", "fee", "capacity", "reservation", "seasonal", "opening_hours", "snowmobile", "highway", "surface"];
const keepTags = (t, ja) => Object.fromEntries([...OSM_KEEP.filter((k) => t[k] && k !== "name").map((k) => [k, String(t[k]).slice(0, 300)]), ...(ja ? [["name:ja", ja]] : [])]);
const LIFT_KINDS = /^(cable_car|gondola|mixed_lift|chair_lift|drag_lift|t-bar|j-bar|platter|rope_tow|magic_carpet|zip_line)$/;

// Douglas-Peucker on a local flat projection (as build-canada-winter.mjs).
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const k = Math.cos((pts[0][0] * Math.PI) / 180) * 111320, xy = pts.map((p) => [p[1] * k, p[0] * 110540]);
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
const flat = (pts, tol) => simplify(pts, tol).flatMap(([lat, lon]) => [round(lat), round(lon)]);
const metres = (pts) => { let m = 0; for (let i = 1; i < pts.length; i++) m += Math.hypot((pts[i][0] - pts[i - 1][0]) * 110540, (pts[i][1] - pts[i - 1][1]) * 111320 * Math.cos((pts[i][0] * Math.PI) / 180)); return m; };

const unOpl = (s) => s.replace(/%([0-9a-f]+)%/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
function parseRelation(line) {
  const r = { id: 0, tags: {}, ways: [] };
  for (const f of line.split(" ")) {
    if (f[0] === "r") r.id = +f.slice(1);
    else if (f[0] === "T" && f.length > 1) f.slice(1).split(",").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) r.tags[unOpl(kv.slice(0, i))] = unOpl(kv.slice(i + 1)); });
    else if (f[0] === "M" && f.length > 1) f.slice(1).split(",").forEach((m) => { if (m[0] === "w") r.ways.push(+m.slice(1, m.indexOf("@"))); });
  }
  return r;
}
async function* features(file) {
  if (!file || !existsSync(file)) return;
  for await (const raw of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    const s = raw.replace(/^\x1e/, "");
    if (!s) continue;
    try { yield JSON.parse(s); } catch { /* a cut line */ }
  }
}
// A feature's middle point: a node's point, the average of a way's or area's outer ring.
function middle(g) {
  if (!g) return null;
  if (g.type === "Point") return [g.coordinates[1], g.coordinates[0]];
  const ring = g.type === "LineString" ? g.coordinates : g.type === "Polygon" ? g.coordinates[0] : g.type === "MultiPolygon" ? g.coordinates[0][0] : null;
  if (!ring || !ring.length) return null;
  let lat = 0, lon = 0;
  for (const [x, y] of ring) { lat += y; lon += x; }
  return [round(lat / ring.length), round(lon / ring.length)];
}

// ---------- camper points ----------
// Kinds: m Michi-no-eki, sa expressway service/parking area, rv RV park, cs campsite, o onsen or public bath, f gas,
// l coin laundry, d dump station, fe ferry terminal.
function campKind(t) {
  const n = `${t.name || ""} ${t["name:en"] || ""}`;
  if (/道の駅|michi[- ]?no[- ]?eki|roadside station/i.test(n)) return "m";
  if (t.highway === "services" || t.highway === "rest_area") return "sa";
  if (t.tourism === "caravan_site") return "rv";
  if (t.tourism === "camp_site") return "cs";
  if (t.amenity === "public_bath" || (t.leisure === "water_park" && /温泉|onsen/i.test(n))) return "o";
  if (t.amenity === "fuel") return "f";
  if (t.amenity === "sanitary_dump_station") return "d";
  if (t.amenity === "ferry_terminal") return "fe";
  if (t.shop === "laundry" || t.amenity === "laundry") return "l";
  return "";
}
const CAMP_TAGS = ["opening_hours", "website", "phone", "fee", "charge", "brand", "operator", "bath:type", "bath:open_air", "self_service", "power_supply", "toilets", "shower", "drinking_water", "description", "description:en"];
// Winter closures as mappers write them: seasonal=winter|no..., *:conditional "no @ (Nov 15-Apr 30)", winter_road...
const WINTER = /\b(nov|dec|jan|feb|mar|apr|winter)\b|冬/i;
function winterClosed(t) {
  if (!/^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|road|track|service)/.test(t.highway || "")) return "";
  for (const k of ["access:conditional", "motor_vehicle:conditional", "vehicle:conditional", "motorcar:conditional", "highway:conditional"]) {
    const v = t[k] || "";
    if (/\bno\b|closed|private/.test(v) && WINTER.test(v)) return v;
  }
  if (/winter|冬/.test(t.seasonal || "") || /winter|冬期|冬季/.test(t.note || "") && /closed|通行止/.test(t.note || "")) return t.seasonal || t.note;
  if (t.winter_service === "no" || t["winter_road"] === "no") return "No winter service";
  return "";
}

// ---------- ingest: one region -> out/japan/<region>.lines ----------
async function ingest(region, skiFile, relsFile, areasFile, pointsFile, roadsFile) {
  const rels = [];
  if (relsFile && existsSync(relsFile)) for await (const line of createInterface({ input: createReadStream(relsFile) })) {
    if (!line.startsWith("r")) continue;
    const r = parseRelation(line);
    const type = /^(ski|piste|snowmobile)$/.test(r.tags.route || "") || r.tags["piste:type"] ? skiType(r.tags) : "";
    if (type && r.ways.length) rels.push({ ...r, type });
  }
  const member = new Set(rels.flatMap((r) => r.ways));
  const ways = new Map(), out = [];
  const add = (o) => out.push(JSON.stringify(o));
  let nRoutes = 0, nLifts = 0, nHuts = 0, nCamp = 0, nClosed = 0, nResorts = 0;
  const byId = new Map();
  for await (const f of features(skiFile)) {
    const p = f.properties || {};
    if (p["@type"] !== "way" || !f.geometry || f.geometry.type !== "LineString") continue;
    const id = p["@id"], pts = f.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    if (member.has(id)) ways.set(id, pts);
    if (p.aerialway && LIFT_KINDS.test(p.aerialway) && pts.length >= 2) {
      const { name } = nameOf(p);
      add({ k: "lift", id, n: name, kind: p.aerialway, g: pts.map(([a, b]) => [round(a), round(b)]), len: Math.round(metres(pts)),
        seats: p["aerialway:occupancy"] || "", cap: p["aerialway:capacity"] || "", dur: p["aerialway:duration"] || "", heated: p["aerialway:heating"] === "yes" ? 1 : 0, bubble: p["aerialway:bubble"] === "yes" ? 1 : 0 });
      nLifts++;
      continue;
    }
    const type = skiType(p);
    if (!type) continue;
    const g = flat(pts, type === "snowmobile" ? 12 : 6);
    if (g.length < 4) continue;
    const { name, ja } = nameOf(p);
    const r = { id: "w" + id, src: "osm", type, name, diff: p["piste:difficulty"] || "", g: [g], tags: keepTags(p, ja), pv: "JP" };
    if (type === "resort" && g.length >= 8 && Math.hypot((g[0] - g.at(-2)) * 110540, (g[1] - g.at(-1)) * 71000) < 15) r.area = 1;
    byId.set(r.id, r);
  }
  for (const rel of rels) {
    const { name, ja } = nameOf(rel.tags), parts = [];
    for (const w of rel.ways) {
      const drawn = byId.get("w" + w);
      if (drawn) { drawn.routes = [...new Set([...(drawn.routes || []), name || "route " + rel.id])]; if (!drawn.name) drawn.name = name; continue; }
      const pts = ways.get(w);
      if (pts && pts.length >= 2) parts.push(flat(pts, rel.type === "snowmobile" ? 12 : 6));
    }
    if (parts.length) byId.set("r" + rel.id, { id: "r" + rel.id, src: "osm", type: rel.type, name, diff: rel.tags["piste:difficulty"] || "", g: parts, tags: keepTags(rel.tags, ja), pv: "JP" });
  }
  for (const r of byId.values()) { add({ k: "route", ...r }); nRoutes++; }
  // Ski resort boundaries (landuse=winter_sports): outer rings, for off-piste vs tour and the lifts' resort names.
  for await (const f of features(areasFile)) {
    const p = f.properties || {}, g = f.geometry;
    if (p.landuse !== "winter_sports" || !g) continue;
    const polys = g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : [];
    // A closed ring simplified as two halves (Douglas-Peucker between a point and itself keeps nothing).
    const ringFlat = (pts) => { const h = Math.floor(pts.length / 2); return [...flat(pts.slice(0, h + 1), 25), ...flat(pts.slice(h), 25).slice(2)]; };
    const rings = polys.map((poly) => ringFlat(poly[0].map(([x, y]) => [y, x]))).filter((r) => r.length >= 8);
    if (!rings.length) continue;
    const { name, ja } = nameOf(p);
    add({ k: "resort", id: `${p["@type"] || "a"}${p["@id"]}`, name, ja, web: p.website || p["contact:website"] || "", rings });
    nResorts++;
  }
  // Huts, parking, trailheads and camper stops.
  for await (const f of features(pointsFile)) {
    const p = f.properties || {}, at = middle(f.geometry);
    if (!at) continue;
    const id = `${(p["@type"] || "n")[0]}${p["@id"]}`, { name, ja } = nameOf(p);
    if (p.tourism === "alpine_hut" || p.tourism === "wilderness_hut" || (p.amenity === "shelter" && /basic_hut|lean_to/.test(p.shelter_type || ""))) {
      add({ k: "hut", id, src: "osm", name, kind: p.tourism || (p.shelter_type === "basic_hut" ? "basic_hut" : "shelter"), lat: at[0], lon: at[1], tags: keepTags(p, ja), pv: "JP" });
      nHuts++;
    }
    if (p.amenity === "parking" || p.highway === "trailhead") add({ k: "park", id, src: "osm", kind: p.highway === "trailhead" ? "trailhead" : "parking", name, lat: at[0], lon: at[1], tags: keepTags(p, ja) });
    const ck = campKind(p);
    if (ck) {
      const t = Object.fromEntries(CAMP_TAGS.filter((k) => p[k]).map((k) => [k, String(p[k]).slice(0, 200)]));
      if (ja) t["name:ja"] = ja;
      add({ k: "camp", c: ck, id, n: name, lat: at[0], lon: at[1], t });
      nCamp++;
    }
  }
  for await (const f of features(roadsFile)) {
    const p = f.properties || {};
    if (p["@type"] !== "way" || !f.geometry || f.geometry.type !== "LineString") continue;
    const why = winterClosed(p);
    if (!why) continue;
    const { name } = nameOf(p);
    add({ k: "closed", id: p["@id"], n: name || p.ref || "", ref: p.ref || "", why: String(why).slice(0, 120), g: flat(f.geometry.coordinates.map(([lon, lat]) => [lat, lon]), 15) });
    nClosed++;
  }
  mkdirSync(PART, { recursive: true });
  const file = new URL(`${region}.lines`, PART);
  writeFileSync(file, "");
  for (let i = 0; i < out.length; i += 5000) appendFileSync(file, out.slice(i, i + 5000).join("\n") + "\n");
  log(`${region}: ${nRoutes} ski routes, ${nLifts} lifts, ${nResorts} resort areas, ${nHuts} huts, ${nCamp} camper stops, ${nClosed} winter-closed road pieces`);
}

// ---------- finish ----------
function inRing(lat, lon, r) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ay = r[i], ax = r[i + 1], by = r[j], bx = r[j + 1];
    if ((ay > lat) !== (by > lat) && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
const boxOf = (rings) => { let s = 90, w = 180, n = -90, e = -180; for (const r of rings) for (let i = 0; i < r.length; i += 2) { s = Math.min(s, r[i]); n = Math.max(n, r[i]); w = Math.min(w, r[i + 1]); e = Math.max(e, r[i + 1]); } return [s, w, n, e]; };
const PARK_M = 700;   // parking this close to a tour's or approach trail's end is where the tour starts

async function finish() {
  const routes = [], lifts = [], resorts = [], huts = [], parks = [], camp = [], closed = [], seen = new Set();
  if (existsSync(PART)) for (const f of readdirSync(PART).filter((f) => f.endsWith(".lines"))) {
    for await (const line of createInterface({ input: createReadStream(new URL(f, PART)) })) {
      if (!line) continue;
      const o = JSON.parse(line), key = `${o.k}:${o.id}`;
      if (seen.has(key)) continue;   // on a region line, in both files
      seen.add(key);
      ({ route: routes, lift: lifts, resort: resorts, hut: huts, park: parks, camp, closed })[o.k].push(o);
      delete o.k;
    }
  }
  resorts.forEach((r) => { r.box = boxOf(r.rings); });
  const resortAt = (lat, lon) => resorts.find((r) => lat >= r.box[0] && lat <= r.box[2] && lon >= r.box[1] && lon <= r.box[3] && r.rings.some((g) => inRing(lat, lon, g)));
  for (const r of routes) if (r.type === "freeride") { const m = r.g[0]; r.type = resortAt(m[Math.floor(m.length / 4) * 2], m[Math.floor(m.length / 4) * 2 + 1]) ? "offpiste" : "tour"; }
  // Lifts: the resort they're in (or the nearest within 1.5 km), for the lift card's resort name and website.
  const resortOut = {};
  for (const l of lifts) {
    const [lat, lon] = l.g[0];
    let r = resortAt(lat, lon) || resortAt(...l.g.at(-1));
    if (!r) {
      let best = 1500;
      for (const x of resorts) { const c = [(x.box[0] + x.box[2]) / 2, (x.box[1] + x.box[3]) / 2], d = Math.hypot((c[0] - lat) * 110540, (c[1] - lon) * 91000); if (d < best) { best = d; r = x; } }
    }
    l.r = r ? "jp:" + r.id : "jp";
    if (r && !resortOut[l.r]) resortOut[l.r] = { name: r.name, ja: r.ja || "", lat: +((r.box[0] + r.box[2]) / 2).toFixed(4), lon: +((r.box[1] + r.box[3]) / 2).toFixed(4), live: false, page: r.web || "" };
    l.k = l.kind; delete l.kind;
  }
  // Parking near the ends of tours and approach trails (grid of 0.01°).
  const ends = new Map(), cell = (lat, lon) => `${Math.floor(lat * 100)}_${Math.floor(lon * 100)}`;
  for (const r of routes) if (r.type === "tour" || r.type === "access" || r.type === "snowshoe") for (const g of r.g) for (const i of [0, g.length - 2]) {
    const k = cell(g[i], g[i + 1]); (ends.get(k) || ends.set(k, []).get(k)).push([g[i], g[i + 1]]);
  }
  const nearEnd = (lat, lon) => {
    const cy = Math.floor(lat * 100), cx = Math.floor(lon * 100);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) for (const [a, b] of ends.get(`${y}_${x}`) || []) if (Math.hypot((a - lat) * 110540, (b - lon) * 91000) < PARK_M) return true;
    return false;
  };
  const parking = parks.filter((p) => nearEnd(p.lat, p.lon));

  // Ski squares.
  const sq = new Map(), put = (k, key, o) => { const t = sq.get(k) || sq.set(k, { routes: [], huts: [], parking: [], lifts: [], resorts: {} }).get(k); t[key].push(o); return t; };
  for (const r of routes) put(tileOf(r.g[0][0], r.g[0][1]), "routes", r);
  for (const h of huts) put(tileOf(h.lat, h.lon), "huts", h);
  for (const p of parking) put(tileOf(p.lat, p.lon), "parking", p);
  for (const l of lifts) { const t = put(tileOf(l.g[0][0], l.g[0][1]), "lifts", l); if (resortOut[l.r]) t.resorts[l.r] = resortOut[l.r]; }
  const builtAt = new Date().toISOString().slice(0, 19) + "Z";
  const write = (dirUrl, tiles, sum) => {
    if (existsSync(dirUrl)) rmSync(dirUrl, { recursive: true });
    mkdirSync(dirUrl, { recursive: true });
    const index = {}; let bytes = 0;
    for (const [k, t] of [...tiles].sort()) {
      const body = JSON.stringify(t); bytes += body.length;
      writeFileSync(new URL(k + ".json", dirUrl), body);
      index[k] = { ...sum(k, t), kb: Math.ceil(body.length / 1024) };
    }
    return { index, bytes };
  };
  const w = write(OUT_W, sq, (k, t) => {
    const pts = [...t.routes.flatMap((r) => r.g.flatMap((g) => [[g[0], g[1]], [g.at(-2), g.at(-1)]])), ...t.huts.map((h) => [h.lat, h.lon]), ...t.lifts.map((l) => l.g[0])];
    let s = 90, wst = 180, n = -90, e = -180;
    for (const [a, b] of pts) { s = Math.min(s, a); n = Math.max(n, a); wst = Math.min(wst, b); e = Math.max(e, b); }
    return { r: t.routes.length, h: t.huts.length, l: t.lifts.length, box: [s, wst, n, e].map((v) => +v.toFixed(3)) };
  });
  writeFileSync(new URL("index.json", OUT_W), JSON.stringify({ builtAt, tile: [TILE_LAT, TILE_LON], tiles: w.index }));

  // Camper squares.
  const cq = new Map(), cput = (k, key, o) => (cq.get(k) || cq.set(k, { points: [], closed: [] }).get(k))[key].push(o);
  for (const p of camp) cput(campOf(p.lat, p.lon), "points", p);
  for (const c of closed) cput(campOf(c.g[0], c.g[1]), "closed", c);
  const c = write(OUT_C, cq, (k) => { const [a, b] = k.split("_").map(Number); return { box: [a, b, a + CAMP_DEG, b + CAMP_DEG] }; });
  writeFileSync(new URL("index.json", OUT_C), JSON.stringify({ builtAt, tiles: c.index }));

  const count = {}; routes.forEach((r) => { count[r.type] = (count[r.type] || 0) + 1; });
  const kinds = {}; camp.forEach((p) => { kinds[p.c] = (kinds[p.c] || 0) + 1; });
  log(`jp/w: ${routes.length} routes (${Object.entries(count).map(([k, v]) => `${k} ${v}`).join(", ")}), ${lifts.length} lifts at ${Object.keys(resortOut).length} resorts, ${huts.length} huts, ${parking.length} tour parking, in ${sq.size} squares, ${(w.bytes / 1e6).toFixed(1)} MB`);
  log(`jp/c: ${camp.length} camper stops (${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(", ")}), ${closed.length} winter-closed road pieces, in ${cq.size} squares, ${(c.bytes / 1e6).toFixed(1)} MB`);
  if (w.bytes + c.bytes > 40e6) log(`::warning::Japan data is ${((w.bytes + c.bytes) / 1e6).toFixed(0)} MB, more than the 40 MB planned`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "ingest") await ingest(...args);
else if (cmd === "finish") await finish();
else throw new Error("Use: ingest <region> <ski> <ski.opl> <areas> <points> <roads> | finish");
