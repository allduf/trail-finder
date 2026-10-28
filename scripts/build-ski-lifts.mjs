// Builds data/ski-lifts.json: every ski lift of the resorts in the app, from OpenStreetMap (aerialway lines), for the
// live lift status in Skiing (lifts.js). Hand-run (lifts rarely change), the file is kept in main:
//   NODE_USE_ENV_PROXY=1 node --experimental-strip-types scripts/build-ski-lifts.mjs [path/to/ski.json]
// For each lift: name, kind (gondola, chair_lift, t-bar...), seats and people an hour when mapped, the line, length,
// bottom and top heights (Open-Meteo elevation), the runs that start at its top (the resort runs in ski.json, from the
// site-data branch: git fetch origin site-data && git archive FETCH_HEAD data/ski.json | tar -x -C /tmp/x), and "st",
// the name the resort's own lift status uses for it (matched now against the live status, read with the same code as
// the Supabase function supabase/functions/lift-status, so the app only has to look the name up).
// Reads the OpenStreetMap API in small squares around each resort (the cloud container can't reach Overpass).
import fs from "node:fs";
import { SOURCES, read } from "../supabase/functions/lift-status/index.ts";

// The resorts (same ids as data/webcams.json owners and the function's SOURCES); centre and half size of the box in
// degrees (lat, lon), from the resort's lift stations.
const RESORTS = [
  ["wb", "Whistler Blackcomb", 50.085, -122.925, 0.07, 0.11],
  ["grouse", "Grouse Mountain", 49.38, -123.08, 0.02, 0.025],
  ["cypress", "Cypress Mountain", 49.398, -123.2, 0.03, 0.04],
  ["mtwash", "Mount Washington", 49.745, -125.3, 0.025, 0.035],
  ["manning", "Manning Park", 49.075, -120.91, 0.02, 0.025],
  ["sunpeaks", "Sun Peaks", 50.885, -119.9, 0.04, 0.055],
  ["bigwhite", "Big White", 49.725, -118.94, 0.035, 0.06],
  ["silverstar", "SilverStar", 50.36, -119.06, 0.03, 0.04],
  ["apex", "Apex Mountain", 49.385, -119.91, 0.02, 0.03],
  ["revelstoke", "Revelstoke Mountain Resort", 50.96, -118.13, 0.035, 0.06],
  ["khmr", "Kicking Horse", 51.285, -117.07, 0.03, 0.045],
  ["fernie", "Fernie Alpine Resort", 49.455, -115.1, 0.03, 0.045],
  ["kimberley", "Kimberley Alpine Resort", 49.685, -116.03, 0.02, 0.04],
  ["nakiska", "Nakiska", 50.945, -115.165, 0.02, 0.035],
  ["panorama", "Panorama", 50.45, -116.21, 0.03, 0.06],
  ["red", "RED Mountain", 49.105, -117.84, 0.03, 0.045],
  ["whitewater", "Whitewater", 49.445, -117.15, 0.02, 0.03],
  ["louise", "Lake Louise", 51.455, -116.135, 0.035, 0.05],
  ["sunshine", "Sunshine Village", 51.08, -115.77, 0.03, 0.04],
  ["norquay", "Mt Norquay", 51.2, -115.605, 0.02, 0.025],
  ["castle", "Castle Mountain", 49.31, -114.42, 0.02, 0.03],
  ["tremblant", "Tremblant", 46.212, -74.585, 0.03, 0.05],
  ["bluemtn", "Blue Mountain", 44.503, -80.312, 0.02, 0.03],
  ["bromont", "Bromont, montagne d'expériences", 45.305, -72.648, 0.02, 0.03],
  ["msa", "Mont-Sainte-Anne", 47.075, -70.905, 0.025, 0.035],
];
// ONLY=id,id rebuilds just those resorts and keeps the others as they are in data/ski-lifts.json (off season most
// resorts' status lists are empty, so a full rebuild then would lose their matched status names).
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const OLD = ONLY ? JSON.parse(fs.readFileSync(new URL("../data/ski-lifts.json", import.meta.url), "utf8")) : null;
const SKIP = /^(station|pylon|goods|zip_line|canopy)$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "TrailFinder ski lifts (allduf.github.io/trail-finder)" } });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) { if (i >= tries) throw e; await sleep(2000 * (i + 1)); }
  }
}
const R = 6371e3, rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => 2 * R * Math.asin(Math.sqrt(Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2));

const ways = new Map(), nodes = new Map();
for (const [id, , la, lo, hla, hlo] of RESORTS) {
  if (ONLY && !ONLY.has(id)) continue;
  const S = 0.04;
  for (let y = la - hla; y < la + hla; y += S) for (let x = lo - hlo; x < lo + hlo; x += S) {
    const bb = [x, y, Math.min(x + S, lo + hlo), Math.min(y + S, la + hla)].map((v) => v.toFixed(5)).join(",");
    const d = await json(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${bb}`);
    for (const e of d.elements) {
      if (e.type === "node") nodes.set(e.id, [e.lat, e.lon]);
      else if (e.type === "way" && e.tags && e.tags.aerialway && !SKIP.test(e.tags.aerialway)) ways.set(e.id, e);
    }
    await sleep(400);
  }
  console.log(id, "ways so far", ways.size);
}

// Each lift goes to the nearest resort centre (Grouse and Cypress boxes touch).
const lifts = [];
for (const w of ways.values()) {
  const g = w.nodes.map((n) => nodes.get(n)).filter(Boolean);
  if (g.length < 2) continue;
  const mid = g[g.length >> 1];
  const res = RESORTS.map((r) => [r, dist(mid, [r[2], r[3]])]).sort((a, b) => a[1] - b[1])[0];
  if (res[1] > 15000) continue;
  const t = w.tags;
  let len = 0; for (let i = 1; i < g.length; i++) len += dist(g[i - 1], g[i]);
  lifts.push({ id: w.id, r: res[0][0], n: t.name || t["name:en"] || "", k: t.aerialway, g: g.map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]), len: Math.round(len),
    ...(t["aerialway:occupancy"] ? { seats: +t["aerialway:occupancy"] || t["aerialway:occupancy"] } : {}),
    ...(t["aerialway:capacity"] ? { cap: +t["aerialway:capacity"] || t["aerialway:capacity"] } : {}),
    ...(t["aerialway:duration"] ? { dur: t["aerialway:duration"] } : {}),
    ...(t["aerialway:detachable"] === "yes" ? { fast: 1 } : {}), ...(t["aerialway:bubble"] === "yes" ? { bubble: 1 } : {}), ...(t["aerialway:heating"] === "yes" ? { heated: 1 } : {}) });
}
console.log("lifts", lifts.length);

// Bottom and top heights, 100 points a call.
const ends = lifts.flatMap((l) => [l.g[0], l.g[l.g.length - 1]]);
const ele = [];
for (let i = 0; i < ends.length; i += 100) {
  const part = ends.slice(i, i + 100);
  const d = await json(`https://api.open-meteo.com/v1/elevation?latitude=${part.map((p) => p[0]).join(",")}&longitude=${part.map((p) => p[1]).join(",")}`);
  ele.push(...d.elevation);
  await sleep(500);
}
lifts.forEach((l, i) => {
  let a = ele[2 * i], b = ele[2 * i + 1];
  if (a > b) { l.g.reverse(); [a, b] = [b, a]; }   // drawn bottom to top
  l.lo = Math.round(a); l.hi = Math.round(b);
});

// Runs that start near the top of each lift (within 250 m of its top, or 150 m of the line's top half for mid stations).
const skiPath = process.argv[2] || "/tmp/claude-0/sd/data/ski.json";
if (fs.existsSync(skiPath)) {
  // Not runs: lift lines, parking lots, gondola walkways mapped as pistes.
  const NOT_RUN = /gondola|carpet|chair|express|t-bar|\blot \d|upload|download|\bexit\b|parking/i;
  const runs = JSON.parse(fs.readFileSync(skiPath, "utf8")).routes.filter((r) => r.type === "resort" && r.name && !NOT_RUN.test(r.name));
  for (const l of lifts) {
    const top = l.g[l.g.length - 1], names = new Map();
    for (const r of runs) for (const part of r.g) {
      const p = [part[0], part[1]], q = [part[part.length - 2], part[part.length - 1]];
      const s = Math.min(dist(p, top), dist(q, top));
      if (s < 250 && !(names.get(r.name)?.[0] <= s)) names.set(r.name, [s, r.diff || ""]);
    }
    if (l.k === "magic_carpet" || l.k === "rope_tow") continue;
    // [name, difficulty], nearest the top first.
    const list = [...names].sort((a, b) => a[1][0] - b[1][0]).map(([n, [, d]]) => (d ? [n, d] : [n])).slice(0, 14);
    if (list.length) l.runs = list;
  }
} else console.log("no ski.json, runs left out");

// The resort's own status name for each lift. Off season Whistler Blackcomb's page has no feed, so its names are the
// ones its lift status uses (as whistlerpeak.com lists them, 2026-10-25).
const WB_NAMES = ["Creekside Gondola", "Whistler Village Gondola Lower", "Fitzsimmons Express", "Whistler Village Gondola Upper", "Garbanzo Express", "Olympic Chair",
  "Big Red Express", "Franz's Chair", "Emerald 6 Express", "Peak 2 Peak Gondola", "Harmony 6 Express", "Peak Express", "Symphony Express", "T-Bars",
  "Excalibur Gondola Lower", "Blackcomb Gondola Lower", "Magic Chair", "Excalibur Gondola Upper", "Excelerator Express", "Blackcomb Gondola Upper",
  "Catskinner Express", "Jersey Cream Express", "Crystal Ridge Express", "Glacier Express", "7th Heaven Express", "Showcase T-Bar"];
const DROP = /\b(express|high speed|detachable|chair ?lift|chair|lift|quad|triple|double|six|6|pack|8|the|free access|#\d+|telesiege|telecabine|quadruple|hybride|tapis magique|versant|de|du|des|la|le|l)\b/g;
// Accents off first ("Télésiège" and "Equilibre" match), French lift words dropped like the English ones.
const norm = (s, drop) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^[0-9a-z]{1,3} \((.+)\)$/i, "$1").toLowerCase().replace(/['’]/g, "").replace(/\(.*?\)/g, " ").replace(/t[- ]?bar/g, "tbar").replace(/peak 2 peak|p2p/g, "peak2peak").replace(/whistler village/g, "whistler").replace(/\bii\b/g, "2").replace(/\bi\b/g, "1").replace(drop ? DROP : /$^/g, " ").split(/[^a-z0-9]+/).filter(Boolean);
// A name that is only lift words ("Télécabine Express") keeps them.
const words = (s) => { const w = norm(s, true); return new Set(w.length ? w : norm(s, false)); };
// Shared words over the longer name's; a name whose words are all in the other ("Stairway" for "Stairway to Heaven") counts.
const score = (a, b) => { const A = words(a), B = words(b); if (!A.size || !B.size) return 0; let n = 0; for (const x of A) if (B.has(x)) n++; return n === Math.min(A.size, B.size) ? Math.max(0.6, n / Math.max(A.size, B.size)) : n / Math.max(A.size, B.size); };
const unmatched = {};
for (const [id] of RESORTS) {
  if (!SOURCES[id] || (ONLY && !ONLY.has(id))) continue;
  const v = await read(id);
  const names = id === "wb" && !v.lifts.length ? WB_NAMES : v.lifts.map((x) => x.n);
  const mine = lifts.filter((l) => l.r === id);
  for (const n of names) {
    // One status line for several lifts ("T-Bars"): every T-bar of the resort.
    if (/^t-bars$/i.test(n)) { const tb = mine.filter((l) => l.k === "t-bar" && !l.st); tb.forEach((l) => (l.st = n)); if (tb.length) continue; }
    const best = mine.map((l) => [l, score(n, l.n)]).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] >= 0.5 && !best[0].st) best[0].st = n;
    else (unmatched[id] = unmatched[id] || []).push(n);
  }
  console.log(id, "status names matched", names.length - (unmatched[id] || []).length, "of", names.length, "| lifts without:", mine.filter((l) => !l.st && l.n).map((l) => l.n).join("; "));
}
for (const l of lifts) if (l.st && l.st !== l.n) console.log("  matched", l.r, JSON.stringify(l.st), "=", JSON.stringify(l.n));
console.log("status names with no lift:", JSON.stringify(unmatched));

const out = {
  note: "Ski lifts of the resorts in the app, for the live lift status in Skiing (lifts.js). Built by scripts/build-ski-lifts.mjs from OpenStreetMap (ODbL) with heights from Open-Meteo; st is the resort's own name for the lift in its lift status. Hand-run, kept in main.",
  builtAt: new Date().toISOString(),
  resorts: Object.fromEntries(RESORTS.map(([id, name, la, lo]) => [id, { name, lat: la, lon: lo, live: !!SOURCES[id], ...(SOURCES[id] ? { page: SOURCES[id].page } : {}) }])),
  lifts: [...(OLD ? OLD.lifts.filter((l) => !ONLY.has(l.r)) : []), ...lifts].sort((a, b) => a.r.localeCompare(b.r) || a.n.localeCompare(b.n)),
};
fs.writeFileSync(new URL("../data/ski-lifts.json", import.meta.url), JSON.stringify(out));
console.log("wrote data/ski-lifts.json", lifts.length, "lifts", (JSON.stringify(out).length / 1024).toFixed(0), "KB");
