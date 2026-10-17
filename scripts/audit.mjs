// Weekly data audit (see .github/workflows/data-audit.yml): looks over every zone's data the way a rider would and lists
// what's wrong or missing, so it gets fixed before anyone has to spot it. alex: "make as much research as you are making
// for all the data, and give the best experience to every user ... ask me only if there is an issue you can't solve".
//
// It reads the site's own data files and runs the site's own rules on them (the classification code of index.html,
// ratings.js and official.js, loaded as they are), so what it counts is what riders see. Checks:
//   data         every zone has each data file, and none is older than its job's schedule allows
//   jobs         the scheduled data jobs' last runs (with GITHUB_TOKEN)
//   area-thin    a riding area label (data/riding-areas.json) with few MTB trails around it, or many plain named paths
//   area-new     a cluster of named MTB trails far from any riding area label
//   ratings      a zone where most named MTB trails have no real rating (only the slope estimate, or nothing)
//   official     a zone with many MTB trails and none known to be official; trails flagged closed but listed as official
//   network      named paths among MTB trails that the network rule leaves out (and why)       } need the OpenStreetMap
//   gaps         a trail end 20-50 m from the nearest line: Plan a route can't join it          } extract (below)
//   trailheads   a trailhead or parking spot with no road within 100 m                          }
//   gates        gates of unknown status on the forest roads near trails (Shuttle can't tell if it's open)
//
// Findings listed in scripts/audit-settled.json (researched, with what was found) are reported as settled, not again.
// Writes data/audit.json (every finding, with a stable key) and out/audit.md (the summary for the GitHub issue
// "Trail data audit", which the job keeps up to date without notifying anyone).
//
// Run: node scripts/audit.mjs ingest <ways.geojsonseq>...   (osmium export of the zones' highway ways, one file per province)
//      node scripts/audit.mjs                                (the audit; with out/audit/osm-<zone>.json from ingest if there;
//                                                             ZONES=sqm,wh does only those zones)
//      node scripts/audit.mjs publish                        (out/audit.md into the issue, with GITHUB_TOKEN and GITHUB_REPOSITORY)
// Node 18 or newer, no packages needed.

import { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const readJson = (p) => { try { return JSON.parse(read(p)); } catch { return null; } };
const html = read("index.html");
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
const OSM_DIR = new URL("out/audit/", root);
const log = (...a) => console.log(...a);
const now = Date.now();

// ---------- geometry ----------
const K_LAT = 110540, kLon = (lat) => Math.cos((lat * Math.PI) / 180) * 111320;
const metres = (a, b) => Math.hypot((a[0] - b[0]) * K_LAT, (a[1] - b[1]) * kLon(a[0]));
function segDist(p, a, b) {
  const k = kLon(p[0]);
  const ax = (a[1] - p[1]) * k, ay = (a[0] - p[0]) * K_LAT, bx = (b[1] - p[1]) * k, by = (b[0] - p[0]) * K_LAT;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  let u = L2 ? -(ax * dx + ay * dy) / L2 : 0; u = Math.max(0, Math.min(1, u));
  return Math.hypot(ax + u * dx, ay + u * dy);
}
const pairs = (flat) => { const g = []; for (let i = 0; i + 1 < flat.length; i += 2) g.push([flat[i], flat[i + 1]]); return g; };
const lengthOf = (g) => g.reduce((n, p, i) => (i ? n + metres(g[i - 1], p) : 0), 0);
const mid = (g) => g[g.length >> 1];
const inBox = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const at = (p) => [r5(p[0]), r5(p[1])];

// Segments in cells of about 550 x 400 m, to find the nearest line to a point quickly.
const CELL = 0.005;
function segGrid() {
  const cells = new Map();
  const add = (id, g, info) => {
    for (let i = 0; i + 1 < g.length; i++) {
      const a = g[i], b = g[i + 1];
      for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++)
        for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) {
          const c = x + "," + y; if (!cells.has(c)) cells.set(c, []); cells.get(c).push([id, a, b, info]);
        }
    }
  };
  // Nearest segment within max metres (max up to ~400), skipping ways for which skip(id, info) is true.
  const nearest = (p, max, skip) => {
    let best = null;
    const x0 = Math.floor(p[0] / CELL), y0 = Math.floor(p[1] / CELL);
    for (let x = x0 - 1; x <= x0 + 1; x++) for (let y = y0 - 1; y <= y0 + 1; y++) {
      for (const [id, a, b, info] of cells.get(x + "," + y) || []) {
        if (skip && skip(id, info)) continue;
        const d = segDist(p, a, b);
        if (d <= max && (!best || d < best.d)) best = { d, id, info };
      }
    }
    return best;
  };
  // The infos of every line within max metres.
  const within = (p, max) => {
    const out = new Set(), x0 = Math.floor(p[0] / CELL), y0 = Math.floor(p[1] / CELL);
    for (let x = x0 - 1; x <= x0 + 1; x++) for (let y = y0 - 1; y <= y0 + 1; y++)
      for (const [, a, b, info] of cells.get(x + "," + y) || []) if (!out.has(info) && segDist(p, a, b) <= max) out.add(info);
    return out;
  };
  return { add, nearest, within };
}

// ---------- the site's own rules ----------
// index.html's classification section, ratings.js and official.js run here as they do in the browser, with fetch reading
// the repository's files.
async function appRules() {
  const fetch = async (url) => {
    const p = String(url).split("?")[0], ok = !/^https?:/.test(p) && existsSync(new URL(p, root));
    return { ok, status: ok ? 200 : 404, json: async () => JSON.parse(read(p)) };
  };
  const ctx = vm.createContext({ fetch, console, setTimeout, clearTimeout });
  ctx.window = ctx;
  vm.runInContext(read("official.js"), ctx, { filename: "official.js" });
  vm.runInContext(read("ratings.js"), ctx, { filename: "ratings.js" });
  const a = html.indexOf("// ---------- classification ----------"), b = html.indexOf("// ---------- data ----------");
  if (a < 0 || b < a) throw new Error("Couldn't find the classification section of index.html");
  vm.runInContext(`var state = { show: {}, newPick: [] }; var esc = (s) => String(s);\n${html.slice(a, b)}
    globalThis.__app = { classify, difficulty, withOfficial, rateTags, unofficial, trailUse, netOk, isRoad };`, ctx, { filename: "index.html classification" });
  await new Promise((r) => setTimeout(r, 100));   // ratings.js loads data/ratings/osm.json on start
  const app = ctx.__app;
  const bounds = ([s, w, n, e]) => ({ getSouth: () => s, getNorth: () => n, getWest: () => w, getEast: () => e });
  app.loadZone = (box) => Promise.all([ctx.tfOfficial.load(bounds(box)), ctx.tfRatings.load(bounds(box))]);
  return app;
}

// ---------- ingest: the zones' part of an osmium export ----------
// Keeps, per zone: every highway way (trails, paths, streets, roads) with the tags the checks need.
const KEEP_TAG = /^(name|highway|service|access|bicycle|foot|motor_vehicle|motorcar|mtb.*|sac_scale|surface|smoothness|width|est_width|tracktype|informal|piste:type|golf|lit|wikipedia|wikidata|abandoned:highway|description|note|trail_visibility|incline|operator|motorcycle|atv|ohv|orv|4wd_only|dirtbike:scale|bridge|area)$/;
async function ingest(files) {
  mkdirSync(OSM_DIR, { recursive: true });
  const out = new Map(ZONES.map((z) => [z.id, { ways: {} }]));
  for (const file of files) {
    let n = 0;
    for await (const line of createInterface({ input: createReadStream(file) })) {
      const s = line.replace(/^\x1e/, "");
      if (!s) continue;
      const f = JSON.parse(s), p = f.properties || {};
      const tags = {};
      for (const k in p) if (k[0] !== "@" && KEEP_TAG.test(k)) tags[k] = p[k];
      if (p["@type"] !== "way" || !f.geometry || f.geometry.type !== "LineString" || !tags.highway) continue;
      const g = f.geometry.coordinates.map(([lon, lat]) => [r5(lat), r5(lon)]);
      ZONES.forEach((z) => { if (g.some((q) => inBox(q, z.box))) out.get(z.id).ways[p["@id"]] = { tags, g: g.flat() }; });
      n++;
    }
    log(`${file}: ${n} ways`);
  }
  for (const [id, d] of out) {
    writeFileSync(new URL(`osm-${id}.json`, OSM_DIR), JSON.stringify(d));
    log(`${id}: ${Object.keys(d.ways).length} highway ways`);
  }
}

// ---------- the audit ----------
const AGE_H = { mtb: 30, trails: 12, names: 36, access: 30, roads: 24 * 8, alpine: 24 * 8 };   // twice the job's interval or so
const AREA_M = 3000, THIN = 8, NET_M = 400, BRIDGE_M = 20, GAP_M = 50, TRAILHEAD_ROAD_M = 100, MIN_TRAIL_M = 60;
const DRIVE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|road)(_link)?$/;
const GATE = /^(gate|lift_gate|swing_gate)$/;
const LEVEL_SRC_REAL = new Set(["osm", "hand", "off", "same"]);

function zoneTrails(app, z, file) {
  const routeOf = new Map();
  Object.values(file.routes || {}).forEach((r) => r.ways.forEach((w) => { if (!routeOf.has(w)) routeOf.set(w, []); routeOf.get(w).push(r.name); }));
  const pieces = [];
  for (const [id, w] of Object.entries(file.ways || {})) {
    const geom = pairs(w.g);
    if (geom.length < 2) continue;
    const routes = routeOf.get(+id) || [];
    const real = app.difficulty(w.tags);
    const tags = app.rateTags(app.withOfficial({ ...w.tags }, geom), geom, +id);
    const r = app.classify(tags, routes, routes.length ? ["mtb"] : []);
    if (!r || r.use) continue;
    pieces.push({
      id: +id, name: tags.name || tags["mtb:name"] || tags["tf:name"] || "", cat: r.cat, geom, len: lengthOf(geom),
      d: app.difficulty(tags), src: real ? "osm" : app.difficulty(tags) ? tags["tf:diffsrc"] || "?" : "none",
      official: r.official, unoff: r.unoff, offTag: tags["tf:official"], tags,
    });
  }
  // One trail per name, like the site's list (same-name pieces with ends within 1 km).
  const trails = [], byName = new Map();
  pieces.forEach((p) => {
    if (!p.name) { trails.push(group([p])); return; }
    const k = p.name.toLowerCase().trim();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  });
  for (const list of byName.values()) {
    const groups = [];
    list.forEach((p) => {
      const ends = [p.geom[0], p.geom[p.geom.length - 1]];
      const touch = groups.filter((g) => g.ends.some((e) => ends.some((f) => metres(e, f) <= 1000)));
      const g = touch[0] || { items: [], ends: [] };
      if (!touch.length) groups.push(g);
      touch.slice(1).forEach((o) => { g.items.push(...o.items); g.ends.push(...o.ends); groups.splice(groups.indexOf(o), 1); });
      g.items.push(p); g.ends.push(...ends);
    });
    groups.forEach((g) => trails.push(group(g.items)));
  }
  return { pieces, trails: trails.filter((t) => t.len >= MIN_TRAIL_M) };
}
const RANK = { mtb: 0, looks: 1, other: 2 };
function group(items) {
  const best = Math.min(...items.map((p) => RANK[p.cat] ?? 3));
  const main = items.filter((p) => (RANK[p.cat] ?? 3) === best).sort((a, b) => b.len - a.len)[0];
  const unoff = items.some((p) => p.unoff.length);
  return {
    name: main.name, ids: items.map((p) => p.id), cat: main.cat, len: items.reduce((n, p) => n + p.len, 0), c: at(mid(main.geom)),
    d: main.d, src: main.src, official: unoff ? null : items.map((p) => p.official).find(Boolean) || null, unoff,
  };
}

async function audit() {
  const app = await appRules();
  const settled = readJson("scripts/audit-settled.json") || { settled: {} };
  const areas = (readJson("data/riding-areas.json") || { areas: [] }).areas;
  const findings = [], zones = {};
  const add = (f) => findings.push({ ...f, settled: settled.settled[f.key] || null });
  const hasOsm = ZONES.some((z) => existsSync(new URL(`osm-${z.id}.json`, OSM_DIR)));
  const allClusters = [], thinAreas = [];

  for (const z of ZONES.filter((z) => !process.env.ZONES || process.env.ZONES.split(",").includes(z.id))) {
    const zs = (zones[z.id] = { name: z.name, files: {} });
    // ---- data: every file there and fresh ----
    for (const [kind, maxH] of Object.entries(AGE_H)) {
      const f = readJson(`data/${kind}-${z.id}.json`);
      const t = f && Date.parse(f.builtAt || f.osmAt || "");
      const ageH = t ? Math.round((now - t) / 36e5) : null;
      zs.files[kind] = ageH;
      if (!f) add({ check: "data", zone: z.id, sev: "fix", key: `data:${z.id}:${kind}`, title: `${z.name} has no ${kind} data file`, detail: `data/${kind}-${z.id}.json is missing, so the site has none of that data there.` });
      else if (ageH > maxH) add({ check: "data", zone: z.id, sev: "fix", key: `data:${z.id}:${kind}:old`, title: `${z.name}'s ${kind} data is ${Math.round(ageH / 24)} days old`, detail: `data/${kind}-${z.id}.json was built ${f.builtAt}; its job should refresh it within ${maxH} hours.` });
    }

    const mtb = readJson(`data/mtb-${z.id}.json`);
    if (!mtb) continue;
    await app.loadZone(z.box);
    const { pieces, trails } = zoneTrails(app, z, mtb);
    const named = trails.filter((t) => t.name && (t.cat === "mtb" || t.cat === "looks"));
    const real = named.filter((t) => LEVEL_SRC_REAL.has(t.src));
    const by = (k) => named.reduce((o, t) => ((o[t[k]] = (o[t[k]] || 0) + 1), o), {});
    Object.assign(zs, {
      trails: trails.length, named: named.length, cats: trails.reduce((o, t) => ((o[t.cat] = (o[t.cat] || 0) + 1), o), {}),
      ratings: by("src"), rated: named.length ? Math.round((100 * real.length) / named.length) : null,
      official: named.filter((t) => t.official).length, unofficial: named.filter((t) => t.unoff).length,
    });

    // ---- area-thin: riding areas with few trails ----
    const zAreas = areas.filter((a) => a.zone === z.id);
    const osm = (() => { const o = readJson(`out/audit/osm-${z.id}.json`); return o && Object.keys(o.ways).length ? o : null; })();
    const listIds = new Set(pieces.map((p) => p.id));
    // Named paths the site doesn't list (from the extract), with the site's verdict on them.
    const plain = [];
    if (osm) {
      for (const [id, w] of Object.entries(osm.ways)) {
        const t = w.tags;
        if (listIds.has(+id) || !t.name || !/^(path|bridleway|footway)$/.test(t.highway) || t.area === "yes") continue;
        if (app.isRoad(t) || app.trailUse(t, [])) continue;
        const g = pairs(w.g), len = lengthOf(g);
        if (len < 100) continue;
        plain.push({ id: +id, name: t.name, tags: t, g, len, c: mid(g) });
      }
    }
    for (const a of zAreas) {
      const r = a.r || AREA_M;
      const near = named.filter((t) => metres(t.c, a.c) <= r);
      const plainNear = [...new Set(plain.filter((p) => metres(p.c, a.c) <= r).map((p) => p.name))];
      const area = { trails: near.length, plain: plainNear.length };
      (zs.areas = zs.areas || {})[a.name] = area;
      if (near.length < THIN) thinAreas.push({ ...a, n: near.length });
      if (near.length < THIN)
        add({ check: "area-thin", zone: z.id, sev: "research", key: `area-thin:${a.name}`, where: a.c, title: `${a.name}: only ${near.length} named MTB trails`,
          detail: `Within ${r / 1000} km of the ${a.name} label the site lists ${near.length} named MTB trails${plainNear.length ? ` and leaves out ${plainNear.length} named paths: ${plainNear.slice(0, 12).join(", ")}` : ""}.` });
      else if (plainNear.length >= 5 && plainNear.length >= near.length / 2)
        add({ check: "area-thin", zone: z.id, sev: "research", key: `area-plain:${a.name}`, where: a.c, title: `${a.name}: ${plainNear.length} named paths left out next to ${near.length} MTB trails`,
          detail: `Named paths there that the site shows only as plain paths: ${plainNear.slice(0, 15).join(", ")}${plainNear.length > 15 ? "…" : ""}.` });
    }
    // Trails no label covers, for area-new (a long chain of networks would otherwise cluster around a far-off middle).
    named.filter((t) => t.len >= 200 && !areas.some((a) => metres(a.c, t.c) <= (a.r || 4000))).forEach((t) => allClusters.push({ ...t, zone: z.id }));

    // ---- ratings ----
    if (named.length >= 15 && real.length < named.length * 0.5) {
      const unrated = named.filter((t) => !LEVEL_SRC_REAL.has(t.src)).sort((a, b) => b.len - a.len);
      add({ check: "ratings", zone: z.id, sev: "research", key: `ratings:${z.id}`, title: `${z.name}: ${100 - zs.rated}% of named MTB trails have no real rating`,
        detail: `${unrated.length} of ${named.length} show only the slope estimate or nothing (${Object.entries(zs.ratings).map(([k, v]) => `${v} ${k}`).join(", ")}). Longest: ${unrated.slice(0, 15).map((t) => t.name).join(", ")}.`,
        items: unrated.slice(0, 40).map((t) => ({ name: t.name, c: t.c, km: +(t.len / 1000).toFixed(1), est: t.d })) });
    }

    // ---- official ----
    if (named.length >= 30 && !zs.official)
      add({ check: "official", zone: z.id, sev: "research", key: `official:${z.id}`, title: `${z.name}: none of ${named.length} named MTB trails is known to be official`,
        detail: "No open source or mapper tag marks any trail there as official, so riders can't tell sanctioned trails from the rest." });
    // Mappers flag it closed, informal or no bikes, but an official list has it: the site trusts the mappers (shows it
    // unofficial). Worth a look when the official list is a town's own list of bike trails with the same name.
    const conflicts = pieces.filter((p) => p.unoff.length && p.offTag);
    zs.conflicts = conflicts.length;
    if (conflicts.length)
      add({ check: "official", zone: z.id, sev: "info", key: `official-conflict:${z.id}`, title: `${z.name}: ${conflicts.length} trail pieces flagged closed or informal by mappers but on an official list`,
        detail: `The site shows them unofficial (mappers win). ${[...new Set(conflicts.map((p) => p.name).filter(Boolean))].slice(0, 15).join(", ")}.`,
        items: conflicts.slice(0, 60).map((p) => ({ id: p.id, name: p.name, c: at(mid(p.geom)), why: p.unoff[0], list: p.offTag })) });

    if (!osm) continue;
    // ---- network: named paths among MTB trails left out ----
    const mtbGrid = segGrid();
    pieces.filter((p) => p.cat === "mtb" && p.name).forEach((p) => mtbGrid.add(p.id, p.geom, p.name));
    const seen = new Set();
    for (const p of plain) {
      const names = new Set();
      for (const q of [p.g[0], p.c, p.g[p.g.length - 1]]) mtbGrid.within(q, NET_M).forEach((n) => n !== p.name && names.add(n));
      if (names.size < 2 || seen.has(p.name)) continue;
      seen.add(p.name);
      const t = p.tags, why = [];
      if (t.highway === "footway" && !/^(yes|designated|permissive)$/.test(t.bicycle || "")) why.push("a footway not marked open to bikes");
      if (t.sac_scale) why.push(`hiking grade sac_scale=${t.sac_scale}`);
      if (t.foot === "designated") why.push("signed for walkers (foot=designated)");
      if (t["piste:type"]) why.push(`ski run (piste:type=${t["piste:type"]})`);
      if (t.golf) why.push("golf course path");
      if (t.lit === "yes") why.push("lit (a town path)");
      if (t.wikipedia || t.wikidata) why.push("has a Wikipedia entry (a known hiking trail)");
      if (t.surface && /^(gravel|fine_gravel|compacted|pebblestone|wood|asphalt|paved|concrete)$/.test(t.surface)) why.push(`smooth surface (${t.surface})`);
      if (!why.length) why.push(app.netOk(t) ? "open to motors or wide" : "its name or note says it's not a bike trail");
      // Leave out what is plainly not a bike trail (town walks, ski and golf paths, footways, moto tracks): those would
      // bury the few real bike trails that a hiking grade or a gravel surface keeps out of the list.
      if (why.some((w) => /^(a footway|ski run|golf|lit|has a Wikipedia|open to motors|signed for walkers)/.test(w))
        || /^(asphalt|paved|concrete|wood)$/.test(t.surface || "") || t.sac_scale === "strolling" || /\b(walk|interpretive|nature|heritage|boardwalk|lookout|viewpoint)\b/i.test(p.name)) continue;
      add({ check: "network", zone: z.id, sev: "research", key: `network:${z.id}:${p.name}`, where: at(p.c), title: `${p.name}: plain path among ${[...names].slice(0, 2).join(" and ")}`,
        detail: `Left out of the trail list: ${why.join("; ")}. Way ${p.id}, ${Math.round(p.len)} m.` });
    }

    // ---- gaps: trail ends Plan a route can't join ----
    const all = segGrid();
    for (const [id, w] of Object.entries(osm.ways)) all.add(+id, pairs(w.g), w.tags.name || w.tags.highway);
    pieces.forEach((p) => { if (!osm.ways[p.id]) all.add(p.id, p.geom, p.name || "trail"); });
    const roads = readJson(`data/roads-${z.id}.json`);
    (roads && roads.ften || []).forEach((r, i) => all.add("f" + i, pairs(r.g), r.n || "forest road"));
    let gaps = 0;
    for (const p of pieces.filter((p) => p.cat === "mtb" || p.cat === "looks")) {
      for (const [end, q] of [["start", p.geom[0]], ["end", p.geom[p.geom.length - 1]]]) {
        if (!inBox(q, z.box)) continue;
        const near = all.nearest(q, GAP_M, (id) => id === p.id);
        if (!near || near.d <= BRIDGE_M) continue;
        // A loop's own other end, or the trail's own other piece: fine.
        if (metres(q, end === "start" ? p.geom[p.geom.length - 1] : p.geom[0]) <= BRIDGE_M) continue;
        gaps++;
        add({ check: "gaps", zone: z.id, sev: "fix", key: `gap:${p.id}:${end}`, where: at(q), title: `${p.name || "Unnamed trail " + p.id}: ${end} is ${Math.round(near.d)} m from ${near.info}`,
          detail: `Plan a route joins lines within ${BRIDGE_M} m, so a route can't go from this trail to ${near.info} (way ${near.id}).`, gap: { way: p.id, end, d: Math.round(near.d), to: near.id } });
      }
    }
    zs.gaps = gaps;

    // ---- trailheads with no road ----
    const drive = segGrid();
    for (const [id, w] of Object.entries(osm.ways)) if (DRIVE.test(w.tags.highway) && w.tags.access !== "no" && w.tags.motor_vehicle !== "no") drive.add(+id, pairs(w.g), w.tags.name || w.tags.highway);
    (roads && roads.ften || []).forEach((r, i) => drive.add("f" + i, pairs(r.g), r.n || "forest road"));
    const acc = readJson(`data/access-${z.id}.json`);
    for (const x of (acc && acc.osm) || []) {
      if (x.k !== "th") continue;
      const near = drive.nearest([x.lat, x.lon], TRAILHEAD_ROAD_M);
      if (!near) add({ check: "trailheads", zone: z.id, sev: "research", key: `trailhead:${x.id}`, where: [x.lat, x.lon], title: `${x.t.name || "Trailhead " + x.id}: no road within ${TRAILHEAD_ROAD_M} m`,
        detail: "No road on OpenStreetMap reaches it, so Getting there can't say how to drive there. The road may be missing from the map, or it's a hike-in trailhead." });
    }

    // ---- gates of unknown status near trails ----
    if (roads) {
      const ends = pieces.flatMap((p) => [p.geom[0], p.geom[p.geom.length - 1]]);
      const endGrid = segGrid(); ends.forEach((q, i) => endGrid.add(i, [q, q], ""));
      const unknown = (roads.feat || []).filter((f) => GATE.test(f.tags.barrier || "") && !f.tags.locked && !f.tags.access && !f.tags.motor_vehicle && endGrid.nearest([f.lat, f.lon], 400));
      zs.gatesUnknown = unknown.length;
      if (unknown.length >= 5) add({ check: "gates", zone: z.id, sev: "info", key: `gates:${z.id}`, title: `${z.name}: ${unknown.length} gates near trails with no open/locked status`,
        detail: "Shuttle in Plan a route drives through them as if open.", items: unknown.slice(0, 30).map((f) => ({ id: f.id, c: [f.lat, f.lon], name: f.tags.name || "" })) });
    }
    log(`${z.name}: ${trails.length} trails, ${named.length} named, ${zs.rated}% really rated, ${zs.official} official, ${gaps} gaps`);
  }

  // ---- area-new: clusters of named trails far from every label ----
  const used = new Set(), clusters = [];
  allClusters.forEach((t, i) => {
    if (used.has(i)) return;
    const c = [i]; used.add(i);
    for (let k = 0; k < c.length; k++) allClusters.forEach((u, j) => { if (!used.has(j) && metres(allClusters[c[k]].c, u.c) <= 1500) { used.add(j); c.push(j); } });
    if (c.length >= 10) clusters.push(c.map((j) => allClusters[j]));
  });
  for (const c of clusters) {
    const ctr = at([c.reduce((n, t) => n + t.c[0], 0) / c.length, c.reduce((n, t) => n + t.c[1], 0) / c.length]);
    // A label with few trails nearby may just be in the wrong spot (a few were placed by hand on round numbers).
    const off = thinAreas.filter((a) => a.zone === c[0].zone && metres(a.c, ctr) <= 15000).sort((a, b) => metres(a.c, ctr) - metres(b.c, ctr))[0];
    add({ check: "area-new", zone: c[0].zone, sev: "research", key: `area-new:${c[0].zone}:${ctr.map((v) => v.toFixed(2)).join(",")}`, where: ctr,
      title: `${c.length} named trails with no riding area label near ${ctr.join(", ")}`,
      detail: `Trails: ${c.sort((a, b) => b.len - a.len).slice(0, 12).map((t) => t.name).join(", ")}. A label (data/riding-areas.json) puts the area's name on the map.`
        + (off ? ` The ${off.name} label is ${(metres(off.c, ctr) / 1000).toFixed(1)} km away with only ${off.n} trails around it: it may belong here.` : ""),
      label: off ? off.name : null });
  }

  // ---- jobs: scheduled data jobs' last runs ----
  const jobs = await jobRuns();
  jobs.filter((j) => j.failing).forEach((j) => add({ check: "jobs", zone: "", sev: "fix", key: `job:${j.file}`, title: `The ${j.name} job's last ${j.failing} runs failed`, detail: `Last run ${j.at}: ${j.url}` }));

  const SEV = { fix: 0, ask: 1, research: 2, info: 3 };
  findings.sort((a, b) => SEV[a.sev] - SEV[b.sev] || a.check.localeCompare(b.check) || a.zone.localeCompare(b.zone));
  const builtAt = new Date().toISOString().slice(0, 19) + "Z";
  const file = { v: 1, builtAt, osm: hasOsm, zones, findings };
  writeFileSync(new URL("data/audit.json", root), JSON.stringify(file));
  mkdirSync(new URL("out/", root), { recursive: true });
  writeFileSync(new URL("out/audit.md", root), markdown(file, jobs));
  const open = findings.filter((f) => !f.settled);
  log(`\n${findings.length} findings (${open.length} open): ${Object.entries(open.reduce((o, f) => ((o[f.check] = (o[f.check] || 0) + 1), o), {})).map(([k, v]) => `${v} ${k}`).join(", ")}`);
}

async function jobRuns() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
  if (!token || !repo) return [];
  const api = (p) => fetch(`${process.env.GITHUB_API_URL || "https://api.github.com"}/repos/${repo}${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "trail-finder audit" } }).then((r) => r.json());
  const out = [];
  for (const w of ((await api("/actions/workflows")).workflows || []).filter((w) => w.state === "active")) {
    const runs = ((await api(`/actions/workflows/${w.id}/runs?per_page=5&branch=main&status=completed`)).workflow_runs || []).filter((r) => /schedule|workflow_dispatch|push/.test(r.event));
    if (!runs.length) continue;
    let failing = 0; for (const r of runs) { if (r.conclusion === "failure") failing++; else break; }
    out.push({ name: w.name, file: w.path.split("/").pop(), at: runs[0].created_at, last: runs[0].conclusion, failing: failing >= 2 ? failing : 0, url: runs[0].html_url });
  }
  return out;
}

function markdown(f, jobs) {
  const open = f.findings.filter((x) => !x.settled), done = f.findings.filter((x) => x.settled);
  const map = (c) => (c ? ` ([map](https://www.openstreetmap.org/?mlat=${c[0]}&mlon=${c[1]}#map=16/${c[0]}/${c[1]}))` : "");
  const L = [`Weekly data audit (scripts/audit.mjs), ${f.builtAt}. ${open.length} open findings, ${done.length} settled.${f.osm ? "" : " Ran without the OpenStreetMap extract: network, gaps and trailheads checks skipped."}`, ""];
  L.push("| Zone | Trails | Named MTB | Really rated | Official | Gaps | Oldest file |", "|---|---|---|---|---|---|---|");
  for (const [id, z] of Object.entries(f.zones)) {
    const old = Object.entries(z.files).sort((a, b) => (b[1] ?? 1e9) - (a[1] ?? 1e9))[0];
    L.push(`| ${z.name} | ${z.trails ?? "–"} | ${z.named ?? "–"} | ${z.rated ?? "–"}% | ${z.official ?? "–"} | ${z.gaps ?? "–"} | ${old[0]} ${old[1] == null ? "missing" : Math.round(old[1] / 24) + " d"} |`);
  }
  const TITLE = { fix: "To fix", ask: "Needs alex's decision", research: "To research", info: "For information" };
  for (const sev of ["fix", "ask", "research", "info"]) {
    const list = open.filter((x) => x.sev === sev);
    if (!list.length) continue;
    L.push("", `### ${TITLE[sev]} (${list.length})`);
    const byCheck = {};
    list.forEach((x) => (byCheck[x.check] = byCheck[x.check] || []).push(x));
    for (const [check, xs] of Object.entries(byCheck)) {
      L.push("", `**${check}** (${xs.length})`);
      xs.slice(0, 40).forEach((x) => L.push(`- ${x.title}${map(x.where)}. ${x.detail}`.slice(0, 600)));
      if (xs.length > 40) L.push(`- …and ${xs.length - 40} more in data/audit.json`);
    }
  }
  if (done.length) {
    L.push("", `<details><summary>Settled (${done.length})</summary>`, "");
    done.slice(0, 200).forEach((x) => L.push(`- ${x.title}: ${x.settled.note || ""} (${x.settled.date || ""})`));
    L.push("", "</details>");
  }
  if (jobs.length) L.push("", "<details><summary>Data jobs</summary>", "", ...jobs.map((j) => `- ${j.name}: ${j.last} ${j.at}${j.failing ? ` (last ${j.failing} failed)` : ""}`), "", "</details>");
  let s = L.join("\n");
  if (s.length > 60000) s = s.slice(0, 60000) + "\n\n…cut here; everything is in data/audit.json";
  return s;
}

// ---------- publish: the summary goes in the body of the GitHub issue "Trail data audit" ----------
// Only the body is edited (no comment, no mention), so nobody gets an email: the weekly Claude routine reads it.
async function publish() {
  const { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repo } = process.env;
  if (!token || !repo) { log("No GITHUB_TOKEN or GITHUB_REPOSITORY: not publishing."); return; }
  const api = async (path, method = "GET", body) => {
    const r = await fetch(`${process.env.GITHUB_API_URL || "https://api.github.com"}/repos/${repo}${path}`, {
      method, body: body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "trail-finder audit", ...(body && { "Content-Type": "application/json" }) },
    });
    if (!r.ok) throw new Error(`GitHub said ${r.status} for ${method} ${path}`);
    return r.json();
  };
  const TITLE = "Trail data audit", body = read("out/audit.md");
  const found = (await api(`/issues?state=open&per_page=100`)).find((i) => i.title === TITLE && !i.pull_request);
  if (found) await api(`/issues/${found.number}`, "PATCH", { body });
  else await api("/issues", "POST", { title: TITLE, body });
  log(found ? `Updated issue #${found.number}` : "Opened the issue");
}

if (process.argv[2] === "ingest") await ingest(process.argv.slice(3));
else if (process.argv[2] === "publish") await publish();
else await audit();
