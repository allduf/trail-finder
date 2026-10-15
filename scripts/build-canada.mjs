// Nightly job (see .github/workflows/canada-data.yml): trail packs for every province and territory of Canada,
// built from Geofabrik's OpenStreetMap extracts instead of Overpass, so the site works anywhere in Canada.
//
// The workflow downloads each province, keeps the trail ways and route relations with osmium, then runs:
//   node scripts/build-canada.mjs ingest <prov> <ways.geojsonseq> <relations.opl>   once per province
//   node scripts/build-canada.mjs finish                                           once at the end
// and writes, under out/ca/ (published with the website as ca/, never committed to main):
//   ca/c/<chunk>.json   one map chunk (1 deg lat x 1.2 deg lon): new trails, trail names and all MTB trails
//   ca/index.json       provinces, their chunks, and each chunk's size and hash (so devices update only what changed)
// The format is written up in /mnt/project-files/trail-finder/province-packs-format.md.
//
// Geofabrik's public extracts have no mapper names or changesets, and only each way's latest version and date.
// "First mapped" is the date of version 1 when the way was never edited; otherwise it is estimated from the way id:
// OpenStreetMap hands out way ids in order, so the dates of never-edited ways just below an id date it, to within a day or so.
//
// Run: Node 18 or newer, no packages needed.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, createReadStream, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const OUT = new URL("out/ca/", root), PART = new URL("out/parts/", root);
const grab = (re, what) => { const m = html.match(re); if (!m) throw new Error(`Couldn't find ${what} in index.html`); return m; };
const MAX_MONTHS = +grab(/const MAX_MONTHS = (\d+);/, "MAX_MONTHS")[1];
const [, TILE_LAT, TILE_LON] = grab(/const TILE_LAT = ([\d.]+), TILE_LON = ([\d.]+);/, "the map square size").map(Number);
const CHUNK_LAT = 1, CHUNK_LON = 1.2;   // 5 x 4 of the site's map squares
const PROVINCES = {
  ab: "Alberta", bc: "British Columbia", mb: "Manitoba", nb: "New Brunswick", nl: "Newfoundland and Labrador",
  ns: "Nova Scotia", nt: "Northwest Territories", nu: "Nunavut", on: "Ontario", pe: "Prince Edward Island",
  qc: "Quebec", sk: "Saskatchewan", yt: "Yukon",
};
const log = (...a) => console.log(...a);
const round = (n) => Math.round(n * 1e5) / 1e5;
// Same grid and keys as gridTiles()/tileKey() in index.html (floating sums, then toFixed(2)).
const tileKey = (lat, lon) => `${(Math.floor(lat / TILE_LAT) * TILE_LAT).toFixed(2)},${(Math.floor(lon / TILE_LON) * TILE_LON).toFixed(2)}`;
const chunkId = (lat, lon) => `${Math.floor(lat / CHUNK_LAT) * CHUNK_LAT}_${(Math.floor(lon / CHUNK_LON) * CHUNK_LON).toFixed(1)}`;
const chunkBox = (id) => { const [s, w] = id.split("_").map(Number); return [s, w, s + CHUNK_LAT, round(w + CHUNK_LON)]; };

// ---------- which ways count: the same as overpassQuery() and namesQuery() in index.html ----------
const has = (t, k) => t[k] !== undefined;
function isTrail(t) {
  const h = t.highway;
  if (h === "path" || h === "bridleway") return true;
  if (h === "track" && (/^grade[345]$/.test(t.tracktype || "") || has(t, "bicycle") || has(t, "mtb:scale") || has(t, "mtb:scale:imba") || has(t, "mtb"))) return true;
  if ((h === "footway" || h === "cycleway") && (has(t, "mtb") || has(t, "mtb:scale") || has(t, "mtb:scale:imba") || has(t, "mtb:type"))) return true;
  return false;
}
const isNamed = (t) => /^(path|track|bridleway|cycleway|footway)$/.test(t.highway || "") && (t.name || t["mtb:name"]);
const TRAIL_ROUTES = /^(mtb|bicycle|hiking|foot|horse|motorcycle|atv)$/, NAMED_ROUTES = /^(mtb|bicycle|hiking|foot)$/;
// "All trails" (like build-mtb.mjs): any mtb* tag, bike park paths, and ways of MTB routes that aren't long-distance rides.
const isMtb = (t) => Object.keys(t).some((k) => k.startsWith("mtb")) || t.bicycle === "customers";
const longRide = (r) => /^(ncn|rcn|icn)$/.test(r.tags.network || "") || r.ways.length > 400;

// Douglas-Peucker on a local flat projection, keeping points more than tol metres off the line (as in build-mtb.mjs).
function simplify(pts, tol = 2) {
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

// OPL tag/role text: %<hex code point>% escapes.
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

// ---------- ingest: one province's ways and relations -> out/parts/<prov>.json ----------
async function ingest(prov, waysFile, relsFile) {
  if (!PROVINCES[prov]) throw new Error(`Unknown province ${prov}`);
  const rels = new Map();
  for await (const line of createInterface({ input: createReadStream(relsFile) })) {
    if (!line.startsWith("r")) continue;
    const r = parseRelation(line);
    if (TRAIL_ROUTES.test(r.tags.route || "") && r.ways.length) rels.set(r.id, r);
  }
  const relOfWay = new Map();
  rels.forEach((r) => r.ways.forEach((w) => { if (!relOfWay.has(w)) relOfWay.set(w, []); relOfWay.get(w).push(r); }));
  // Ways go to the part file one per line (a big province is too large for one JSON string).
  mkdirSync(PART, { recursive: true });
  const lines = [], v1 = [], kept = new Set();
  let n = 0;
  for await (const line of createInterface({ input: createReadStream(waysFile) })) {
    const s = line.replace(/^\x1e/, "");
    if (!s) continue;
    const f = JSON.parse(s), p = f.properties || {};
    if (p["@type"] !== "way" || !f.geometry || f.geometry.type !== "LineString") continue;
    const id = +p["@id"], tags = {};
    for (const k in p) if (k[0] !== "@") tags[k] = p[k];
    const routes = relOfWay.get(id) || [];
    const trail = isTrail(tags), named = isNamed(tags), mtb = trail && (isMtb(tags) || routes.some((r) => r.tags.route === "mtb" && !longRide(r)));
    // osmium writes the timestamp as seconds since 1970 or as text, depending on its version.
    const ts = typeof p["@timestamp"] === "number" ? new Date(p["@timestamp"] * 1000).toISOString() : String(p["@timestamp"]), ver = +p["@version"];
    if (ver === 1) v1.push([id, Date.parse(ts) / 1000]);
    if (!trail && !named) continue;
    const g = simplify(f.geometry.coordinates.map(([lon, lat]) => [round(lat), round(lon)]));
    lines.push(JSON.stringify([id, ver, ts.slice(0, 19) + "Z", (trail ? 1 : 0) | (named ? 2 : 0) | (mtb ? 4 : 0), tags, g]));
    kept.add(id); n++;
    if (lines.length >= 20000) { appendFileSync(new URL(`${prov}.ways`, PART), lines.join("\n") + "\n"); lines.length = 0; }
  }
  appendFileSync(new URL(`${prov}.ways`, PART), lines.length ? lines.join("\n") + "\n" : "");
  const relOut = {};
  rels.forEach((r) => { const w = r.ways.filter((id) => kept.has(id)); if (w.length) relOut[r.id] = { tags: r.tags, ways: w }; });
  writeFileSync(new URL(`${prov}.json`, PART), JSON.stringify({ prov, rels: relOut, v1 }));
  log(`${PROVINCES[prov]}: ${n} ways kept, ${Object.keys(relOut).length} routes, ${v1.length} never-edited ways for dating.`);
}

// ---------- finish: merge provinces into chunks and the index ----------
async function finish() {
  const builtAt = new Date().toISOString().slice(0, 19) + "Z";
  const cutoff = (() => { const d = new Date(); d.setMonth(d.getMonth() - MAX_MONTHS); return d.toISOString(); })();
  const provs = readdirSync(PART).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(new URL(f, PART), "utf8")));
  // Way id -> date: never-edited ways give exact (id, date) pairs. Running max smooths out the odd import with old dates.
  const pairs = provs.flatMap((p) => p.v1).sort((a, b) => a[0] - b[0]);
  provs.forEach((p) => delete p.v1);
  const ids = new Float64Array(pairs.length), secs = new Float64Array(pairs.length);
  let hi = 0;
  pairs.forEach(([id, t], i) => { hi = Math.max(hi, t); ids[i] = id; secs[i] = hi; });
  pairs.length = 0;
  // The last never-edited way at or below this id was made no later than this one, so its date is a safe lower bound:
  // an old trail is never called new (with thousands of ways mapped a day, it is within a day or so anyway).
  function dateOfId(id) {
    let lo = 0, up = ids.length - 1;
    if (up < 0 || id < ids[0]) return null;
    while (lo < up) { const mid = (lo + up + 1) >> 1; if (ids[mid] <= id) lo = mid; else up = mid - 1; }
    return secs[lo];
  }
  const chunks = new Map(), provChunks = {}, provBox = {};
  const chunk = (id) => {
    if (!chunks.has(id)) chunks.set(id, { v: 1, builtAt, box: chunkBox(id), trails: { v: 1, months: MAX_MONTHS, builtAt, tiles: {}, ways: {}, rels: {} }, names: [], mtb: { ways: {} }, _names: new Set() });
    return chunks.get(id);
  };
  for (const p of provs) {
    const mine = (provChunks[p.prov] = new Set());
    const box = (provBox[p.prov] = [90, 180, -90, -180]);
    const inRoute = new Set(Object.values(p.rels).flatMap((r) => r.ways));
    const wayChunks = new Map(), routeWays = new Map();
    for await (const line of createInterface({ input: createReadStream(new URL(`${p.prov}.ways`, PART)) })) {
      if (!line) continue;
      const [id, v, t, k, tags, pts] = JSON.parse(line);
      const g = pts.flat();
      const cs = new Set(), tiles = new Set();
      for (const [lat, lon] of pts) {
        cs.add(chunkId(lat, lon)); tiles.add(tileKey(lat, lon));
        box[0] = Math.min(box[0], lat); box[1] = Math.min(box[1], lon); box[2] = Math.max(box[2], lat); box[3] = Math.max(box[3], lon);
      }
      if (inRoute.has(id)) { wayChunks.set(id, cs); routeWays.set(id, { tags, g, mid: pts[Math.floor(pts.length / 2)] }); }
      const exact = v === 1, ft = exact ? t : (() => { const s = dateOfId(id); return s ? new Date(s * 1000).toISOString().slice(0, 19) + "Z" : null; })();
      const isNew = (k & 1) && ft && ft >= cutoff;
      for (const cid of cs) {
        const c = chunk(cid); mine.add(cid);
        if (isNew) {
          c.trails.ways[id] = { v, t, tags, g, ft, ...(exact ? {} : { fe: 1 }) };
          for (const key of tiles) {
            const [s, wl] = key.split(",").map(Number);
            if (chunkId(s + TILE_LAT / 2, wl + TILE_LON / 2) !== cid) continue;
            (c.trails.tiles[key] ||= { at: builtAt, ways: [] }).ways.push(id);
          }
        }
        if (k & 4) c.mtb.ways[id] = { tags, g };
        if ((k & 2) && !c._names.has("w" + id)) { c._names.add("w" + id); c.names.push({ t: "w", id, c: pts[Math.floor(pts.length / 2)], tags }); }
      }
    }
    for (const [rid, r] of Object.entries(p.rels)) {
      const cs = new Set(r.ways.flatMap((w) => [...(wayChunks.get(w) || [])]));
      for (const cid of cs) {
        const c = chunk(cid), here = r.ways.filter((w) => c.trails.ways[w]);
        if (here.length) { const o = c.trails.rels[rid]; c.trails.rels[rid] = { tags: r.tags, ways: [...new Set([...(o ? o.ways : []), ...here])] }; }
        if (r.tags.route === "mtb" && !longRide(r)) r.ways.forEach((w) => { const way = routeWays.get(w); if (way && wayChunks.get(w).has(cid) && !c.mtb.ways[w]) c.mtb.ways[w] = { tags: way.tags, g: way.g }; });
        if (NAMED_ROUTES.test(r.tags.route || "") && r.tags.name && !c._names.has("r" + rid)) {
          const w = routeWays.get(r.ways.find((w) => wayChunks.get(w) && wayChunks.get(w).has(cid)));
          if (w) { c._names.add("r" + rid); c.names.push({ t: "r", id: +rid, c: w.mid, tags: r.tags }); }
        }
      }
    }
    log(`${PROVINCES[p.prov]}: ${mine.size} chunks so far.`);
  }
  // Every map square of a chunk gets an entry, even an empty one, so the site knows the square was checked tonight.
  rmSync(new URL("c/", OUT), { recursive: true, force: true });
  mkdirSync(new URL("c/", OUT), { recursive: true });
  const index = { v: 1, builtAt, chunkLat: CHUNK_LAT, chunkLon: CHUNK_LON, provinces: [], chunks: {} };
  let total = 0;
  for (const [cid, c] of chunks) {
    const [s, w, n, e] = c.box;
    for (let lat = s; lat < n - 1e-9; lat += TILE_LAT) for (let lon = w; lon < e - 1e-9; lon += TILE_LON) {
      const key = tileKey(lat + TILE_LAT / 2, lon + TILE_LON / 2);
      c.trails.tiles[key] ||= { at: builtAt, ways: [] };
    }
    delete c._names;
    const body = JSON.stringify(c);
    writeFileSync(new URL(`c/${cid}.json`, OUT), body);
    index.chunks[cid] = { bytes: Buffer.byteLength(body), h: createHash("sha1").update(body).digest("hex").slice(0, 8) };
    total += index.chunks[cid].bytes;
  }
  for (const [prov, set] of Object.entries(provChunks)) {
    const list = [...set].sort();
    index.provinces.push({ id: prov, name: PROVINCES[prov], box: provBox[prov].map(round), chunks: list, bytes: list.reduce((a, c) => a + index.chunks[c].bytes, 0) });
  }
  index.provinces.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(new URL("index.json", OUT), JSON.stringify(index));
  log(`${chunks.size} chunks, ${(total / 1e6).toFixed(1)} MB in all.`);
  index.provinces.forEach((p) => log(`  ${p.name}: ${p.chunks.length} chunks, ${(p.bytes / 1e6).toFixed(1)} MB`));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "ingest") await ingest(...args);
else if (cmd === "finish") await finish();
else { console.error("Usage: build-canada.mjs ingest <prov> <ways.geojsonseq> <relations.opl> | finish"); process.exit(1); }
