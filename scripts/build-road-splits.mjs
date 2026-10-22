// Where a trail crosses a forest road, each side is its own trail (alex 2026-10-22: "when a trail cross an fsr you can
// segment it"). The site groups same-named pieces into one trail (name search, map taps, area lists, new trails), so
// Pseudo-Tsuga in Squamish lit up as one long line running on across the Ring Creek North FSR.
// This job reads data/mtb-<zone>.json (the trails) and data/roads-<zone>.json (OpenStreetMap dirt roads and FSRs, from
// scripts/build-roads.mjs) and writes data/road-splits.json for index.html:
//   ways  { "<way id>": part }                 a named way that lies wholly on one side: its trail is "<name>#<part>"
//         { "<way id>": [cuts, parts, mids] }  a named way that crosses a road itself: cut at each crossing (cuts, in the
//                                              way's own order), one part per piece and the middle of each piece
//   ends  { "<way id>": 1 | 2 | 3 }            unnamed ways whose first (1), last (2) or both (3) ends sit on a road, so the
//                                              area list doesn't join two unnamed pieces meeting there
// Two pieces of a named trail are the same trail unless a road lies between them where they come closest: a road
// crossing the short line from a point ~25 m back along one piece, to its end, to the other piece and ~25 m along it, with
// those two points on opposite sides of the road. Pieces farther than 3 km apart are never joined (like the name search).
// A trail only gets parts when a road splits it; others are left out. Roads: track (not grade4/grade5), service,
// unclassified and road; abandoned and disused ones, tracks that are themselves MTB trails, and tracks named like trails
// (isRoad) don't split.
//
// Run: node scripts/build-road-splits.mjs   (Node 18 or newer, no packages, no network)
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const DATA = new URL("../data/", import.meta.url);
const readJson = (f) => { try { return JSON.parse(readFileSync(new URL(f, DATA), "utf8")); } catch { return null; } };
const fold = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()   // as the site's norm()
  .replace(/&/g, " and ").replace(/['\u2019`]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const JOIN_MAX = 3000, BACK_M = 25, SIDE_M = 3, END_ON_ROAD = 6, CUT_SAME = 15, MIN_PIECE = 100;

// Flat metres around a latitude: plenty for distances of a few km.
const LAT0 = 50, KX = 111320 * Math.cos((LAT0 * Math.PI) / 180), KY = 110540;
const xy = (lat, lon) => [lon * KX, lat * KY];
const ll = (p) => [+(p[1] / KY).toFixed(5), +(p[0] / KX).toFixed(5)];
const pairs = (g) => { const o = []; for (let i = 0; i + 1 < g.length; i += 2) o.push(xy(g[i], g[i + 1])); return o; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function segPoint(p, a, b) {                     // closest point to p on segment ab, and its distance
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  const q = [a[0] + t * dx, a[1] + t * dy];
  return { q, d: dist(p, q), t };
}
function hit(a, b, c, d) {                       // segments ab and cd touch or cross: the point, or null
  const d1 = orient(c, d, a), d2 = orient(c, d, b), d3 = orient(a, b, c), d4 = orient(a, b, d);
  if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0) || (d3 > 0 && d4 > 0) || (d3 < 0 && d4 < 0)) return null;
  const den = d1 - d2;
  if (!den) return null;                         // parallel: running along the road isn't crossing it
  const t = d1 / den;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}
const boxOf = (pts, pad = 0) => pts.reduce((b, p) => [Math.min(b[0], p[0] - pad), Math.min(b[1], p[1] - pad), Math.max(b[2], p[0] + pad), Math.max(b[3], p[1] + pad)], [Infinity, Infinity, -Infinity, -Infinity]);
const meets = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const lengthOf = (pts) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);

// ---------- roads, in a grid so a check only looks at the roads around it ----------
const CELL = 500;
const grid = new Map();
const cellKey = (x, y) => Math.floor(x / CELL) + "," + Math.floor(y / CELL);
function addRoad(pts) {
  for (let i = 1; i < pts.length; i++) {
    const s = [pts[i - 1], pts[i]], b = boxOf(s);
    for (let x = Math.floor(b[0] / CELL); x <= Math.floor(b[2] / CELL); x++)
      for (let y = Math.floor(b[1] / CELL); y <= Math.floor(b[3] / CELL); y++) {
        const k = x + "," + y;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
  }
}
function roadsNear(box) {                        // road segments whose cells meet the box (each once)
  const out = new Set();
  for (let x = Math.floor(box[0] / CELL); x <= Math.floor(box[2] / CELL); x++)
    for (let y = Math.floor(box[1] / CELL); y <= Math.floor(box[3] / CELL); y++) (grid.get(x + "," + y) || []).forEach((s) => out.add(s));
  return [...out];
}
const sideOf = (p, s) => { const { d } = segPoint(p, s[0], s[1]); return d < SIDE_M ? 0 : Math.sign(orient(s[0], s[1], p)); };
// Does a road lie between the two ends of this short line (the line crosses it and its ends are on opposite sides)?
function roadBetween(line) {
  const segs = roadsNear(boxOf(line, 5));
  for (let i = 1; i < line.length; i++) for (const s of segs) {
    if (!hit(line[i - 1], line[i], s[0], s[1])) continue;
    const a = sideOf(line[0], s), b = sideOf(line[line.length - 1], s);
    if (a && b && a !== b) return true;
  }
  return false;
}
function onRoad(p) { return roadsNear(boxOf([p], END_ON_ROAD)).some((s) => segPoint(p, s[0], s[1]).d <= END_ON_ROAD); }

// ---------- along a line ----------
function walk(pts, from, dir, m) {               // point about m metres along pts from index `from`, going dir (+1/-1)
  let left = m, i = from;
  while (i + dir >= 0 && i + dir < pts.length) {
    const d = dist(pts[i], pts[i + dir]);
    if (d >= left) { const t = left / d; return [pts[i][0] + t * (pts[i + dir][0] - pts[i][0]), pts[i][1] + t * (pts[i + dir][1] - pts[i][1])]; }
    left -= d; i += dir;
  }
  return pts[i];
}
function nearestOn(pts, p) {                     // closest point of a line to p: { q, d, i (segment start) }
  let best = { d: Infinity };
  for (let i = 1; i < pts.length; i++) { const r = segPoint(p, pts[i - 1], pts[i]); if (r.d < best.d) best = { ...r, i: i - 1 }; }
  if (pts.length === 1) best = { q: pts[0], d: dist(pts[0], p), i: 0, t: 0 };
  return best;
}
// Cut a way where it crosses a road (points ~25 m before and after on opposite sides), keeping pieces of 100 m or more
// (a few metres past the road at a trailhead stay with the trail).
function cutAtRoads(pts) {
  const segs = roadsNear(boxOf(pts, 5)), cuts = [];
  for (let i = 1; i < pts.length; i++) for (const s of segs) {
    const x = hit(pts[i - 1], pts[i], s[0], s[1]);
    if (!x) continue;
    const before = walk([...pts.slice(0, i), x], i, -1, BACK_M), after = walk([x, ...pts.slice(i)], 0, 1, BACK_M);
    const a = sideOf(before, s), b = sideOf(after, s);
    if (!a || !b || a === b) continue;
    const at = lengthOf(pts.slice(0, i)) + dist(pts[i - 1], x);
    if (!cuts.some((c) => Math.abs(c.at - at) < CUT_SAME)) cuts.push({ i, x, at });
  }
  cuts.sort((a, b) => a.at - b.at);
  const total = lengthOf(pts), kept = [];
  for (const c of cuts) if (c.at - (kept.length ? kept[kept.length - 1].at : 0) >= MIN_PIECE && total - c.at >= MIN_PIECE) kept.push(c);
  if (!kept.length) return null;
  const pieces = [];
  let start = 0, head = [];
  for (const c of kept) { pieces.push([...head, ...pts.slice(start, c.i), c.x]); head = [c.x]; start = c.i; }
  pieces.push([...head, ...pts.slice(start)]);
  return { cuts: kept.map((c) => c.x), pieces };
}

// ---------- read the zones ----------
const zones = readdirSync(DATA).filter((f) => /^mtb-\w+\.json$/.test(f)).map((f) => f.slice(4, -5)).sort();
const ways = new Map(), mtbIds = new Set();
for (const z of zones) {
  const f = readJson(`mtb-${z}.json`);
  if (!f) continue;
  for (const [id, w] of Object.entries(f.ways || {})) { mtbIds.add(id); if (!ways.has(id) && w.g && w.g.length >= 4) ways.set(id, { id, tags: w.tags || {}, pts: pairs(w.g) }); }
}
const ROAD = /^(track|service|unclassified|road)$/;
// Many trails are mapped as highway=track (Canmore Nordic Centre's ski trails, Harper Double Track Climb, Janky Skidder),
// so a named track only counts when its name says road (Road, FSR, Mainline, Spur, a code like SA500 or RO010), and a
// name that says trail never does.
const ROAD_NAME = /\b(road|rd|fsr|f\.s\.r|forest service|forest road|mainline|main|spur|branch|highway|hwy|haul|pipeline|powerline|power line|hydro line|access|service|lane|drive|way|street|avenue|ave)\b|^[a-z]{1,4}[- ]?\d/i;
const TRAIL_NAME = /\b(trail|tr|loop|climb|nordic|ski|double ?track|single ?track|descent|dh|xc|connector|traverse)\b/i;
function isRoad(t, g) {
  if (!ROAD.test(t.highway || "") || /^grade[45]$/.test(t.tracktype || "")) return false;
  if (t.name && TRAIL_NAME.test(t.name)) return false;
  if (t.highway !== "track") return true;
  if (t.name) return ROAD_NAME.test(t.name);
  // An unnamed track is often an old doubletrack inside a trail network: only a graded or gravel one, or a long one.
  return /^grade[123]$/.test(t.tracktype || "") || /^(gravel|fine_gravel|compacted|asphalt|paved)$/.test(t.surface || "") || lengthOf(pairs(g)) >= 800;
}
let roadCount = 0;
const roadSeen = new Set();
for (const z of zones) {
  const f = readJson(`roads-${z}.json`);
  for (const [id, w] of Object.entries((f && f.osm) || {})) {
    const t = w.tags || {};
    if (roadSeen.has(id) || mtbIds.has(id) || !isRoad(t, w.g)) continue;
    roadSeen.add(id); roadCount++;
    addRoad(pairs(w.g));
  }
}

// ---------- named trails ----------
const byName = new Map();
for (const w of ways.values()) {
  const name = w.tags.name || w.tags["mtb:name"] || w.tags["tf:name"];
  if (!name) continue;
  const k = fold(name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(w);
}
const outWays = {};
let splitTrails = 0, cutWays = 0;
for (const list of byName.values()) {
  // Pieces: whole ways, or the bits of a way that crosses a road.
  const pieces = [];
  list.forEach((w) => {
    const c = cutAtRoads(w.pts);
    if (!c) { pieces.push({ w, k: -1, pts: w.pts }); return; }
    w.cut = c;
    c.pieces.forEach((pts, k) => pieces.push({ w, k, pts }));
  });
  pieces.forEach((p) => { p.box = boxOf(p.pts); p.ends = [0, p.pts.length - 1]; });
  // Union the pieces that nothing on the ground keeps apart; count the joins a road stopped.
  const up = pieces.map((_, i) => i), find = (i) => (up[i] === i ? i : (up[i] = find(up[i])));
  const upAll = pieces.map((_, i) => i), findAll = (i) => (upAll[i] === i ? i : (upAll[i] = findAll(upAll[i])));
  for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) {
    const A = pieces[a], B = pieces[b];
    if (!meets(boxOf([[A.box[0], A.box[1]], [A.box[2], A.box[3]]], JOIN_MAX), B.box)) continue;
    // Where they come closest: an end of one to the other line.
    let best = null;
    for (const [P, Q] of [[A, B], [B, A]]) for (const e of P.ends) {
      const r = nearestOn(Q.pts, P.pts[e]);
      if (!best || r.d < best.d) best = { P, Q, e, ...r };
    }
    if (best.d > JOIN_MAX) continue;
    upAll[findAll(a)] = findAll(b);
    if (A.w === B.w) continue;                     // two bits of one way: the road it crosses is between them
    const { P, Q, e, q, i } = best;
    const back = walk(P.pts, e, e ? -1 : 1, BACK_M);
    // Along the other piece: away from where they meet, into it (its end if they meet at an end).
    const qi = q === Q.pts[0] || dist(q, Q.pts[0]) < 1 ? 0 : dist(q, Q.pts[Q.pts.length - 1]) < 1 ? Q.pts.length - 1 : -1;
    const fwd = qi === 0 ? walk(Q.pts, 0, 1, BACK_M) : qi > 0 ? walk(Q.pts, qi, -1, BACK_M) : null;
    const line = [back, P.pts[e], q, ...(fwd ? [fwd] : [])];
    let apart = roadBetween(line);
    if (!apart && !fwd) {                          // into the middle of the other piece: a road on both sides of it counts
      const l = [back, P.pts[e], q, walk([q, ...Q.pts.slice(i + 1)], 0, 1, BACK_M)], r = [back, P.pts[e], q, walk([...Q.pts.slice(0, i + 1), q], i + 1, -1, BACK_M)];
      apart = roadBetween(l) && roadBetween(r);
    }
    if (!apart) up[find(a)] = find(b);
  }
  const parts = new Map(), groups = new Set();
  pieces.forEach((p, i) => { const r = find(i); if (!parts.has(r)) parts.set(r, parts.size); groups.add(findAll(i)); });
  if (parts.size === groups.size) continue;     // no road splits this trail
  splitTrails++;
  list.forEach((w) => {
    if (!w.cut) { outWays[w.id] = parts.get(find(pieces.findIndex((p) => p.w === w))); return; }
    cutWays++;
    const mine = pieces.map((p, i) => [p, i]).filter(([p]) => p.w === w);
    outWays[w.id] = [w.cut.cuts.map(ll), mine.map(([, i]) => parts.get(find(i))), mine.map(([p]) => ll(p.pts[p.pts.length >> 1]))];
  });
}

// ---------- unnamed trails: ends that sit on a road ----------
const outEnds = {};
for (const w of ways.values()) {
  if (w.tags.name || w.tags["mtb:name"] || w.tags["tf:name"]) continue;
  const f = (onRoad(w.pts[0]) ? 1 : 0) | (onRoad(w.pts[w.pts.length - 1]) ? 2 : 0);
  if (f) outEnds[w.id] = f;
}

const file = { v: 1, builtAt: new Date().toISOString(), ways: outWays, ends: outEnds };
const old = readJson("road-splits.json");
const same = old && JSON.stringify({ ...old, builtAt: 0 }) === JSON.stringify({ ...file, builtAt: 0 });
if (!same) writeFileSync(new URL("road-splits.json", DATA), JSON.stringify(file));
console.log(`${zones.length} zones, ${ways.size} trail ways, ${roadCount} roads: ${splitTrails} named trails split at roads (${cutWays} ways cut), ${Object.keys(outEnds).length} unnamed ways ending on a road.${same ? " No changes." : ""}`);
