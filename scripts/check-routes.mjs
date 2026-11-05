// No drawn route doubles back (alex 2026-11-05: "make sure it never does that", "everywhere"). Runs on every pull
// request (.github/workflows/route-check.yml) over the lines the app follows as drawn, the ones nothing re-routes:
//  - Skiing slackcountry lines (data/slackcountry.json): the way up, the line, the way out, and all three joined (Add
//    to tour puts them in a tour as one line: the Corona Bowl way up climbed to a high spot near the Spearhead and came
//    back down to the skin track, and the tour followed it).
//  - Skiing hand-kept routes and patches (data/ski-hand/*.json): documented ways up are followed as drawn.
//  - Adventure moto routes (data/moto-routes.json): listed, not failing yet (see below).
// A line that turns round on itself, or knots back within 15 m of where it was 100 m before, fails the check; the
// message says where. Same rules as the app's (noback.js).
// Run: node scripts/check-routes.mjs
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const nb = createRequire(import.meta.url)("../noback.js");
const pairs = (a) => { const o = []; for (let i = 0; i + 1 < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; };
const decode6 = (s) => {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < s.length) {
    for (const k of [0, 1]) {
      let b, sh = 0, r = 0;
      do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
      const d = r & 1 ? ~(r >> 1) : r >> 1;
      if (k) lon += d; else lat += d;
    }
    out.push([lat / 1e6, lon / 1e6]);
  }
  return out;
};
const bad = [], warn = [];
let n = 0;
function look(what, pts, o, soft) {
  if (!pts || pts.length < 3) return;
  n++;
  for (const h of nb.find(pts, o)) (soft ? warn : bad).push(`${what}: ${h.kind === "back" ? "turns round and comes back on itself" : "loops back to where it was"} (${h.m} m) at ${h.at[0].toFixed(5)}, ${h.at[1].toFixed(5)} (points ${h.i} to ${h.j})`);
}

// Skiing slackcountry
const sc = JSON.parse(readFileSync("data/slackcountry.json", "utf8"));
for (const rs of sc.resorts || []) for (const l of rs.lines || []) {
  const g = l.g || {}, parts = ["up", "ski", "out"].map((k) => (Array.isArray(g[k]) ? pairs(g[k]) : []));
  ["up", "ski", "out"].forEach((k, i) => look(`Slackcountry ${l.name} (${k})`, parts[i], { loops: true }));
  // Joined as Add to tour does: the ends of each part are where it meets the next, so a turn there is the line's own.
  const all = [], keep = [];
  for (const p of parts) { if (!p.length) continue; if (all.length) keep.push(all.length - 1); all.push(...p); }
  look(`Slackcountry ${l.name} (whole trip)`, all, { loops: true, keep });
}
// Skiing hand-kept routes
for (const f of readdirSync("data/ski-hand").filter((x) => x.endsWith(".json") && x !== "index.json")) {
  const d = JSON.parse(readFileSync(`data/ski-hand/${f}`, "utf8"));
  for (const r of d.routes || []) for (const g of r.g || []) look(`Ski route ${r.name || r.id} (${f})`, pairs(g), { loops: true });
  for (const [id, p] of Object.entries(d.patch || {})) for (const g of p.g || []) look(`Ski route patch ${p.name || id} (${f})`, pairs(g), { loops: true });
}
// Adventure moto routes
if (existsSync("data/moto-routes.json")) {
  const m = JSON.parse(readFileSync("data/moto-routes.json", "utf8"));
  // Warnings only for now: many go out and back to a dead end on purpose (Meat Cove, Kegaska, the Fundy Trail Parkway),
  // the rest are the router reaching a waypoint off the road and coming back. To sort out route by route.
  for (const r of m.routes || []) if (typeof r.line === "string") look(`Moto route ${r.n || r.id}`, decode6(r.line), {}, true);
}

console.log(`Checked ${n} drawn lines.`);
if (warn.length) console.log(`\nTo look at (${warn.length}, not failing the check):\n- ${warn.join("\n- ")}`);
if (bad.length) {
  console.log(`\n${bad.length} line(s) double back:\n- ${bad.join("\n- ")}`);
  process.exit(1);
}
console.log("None doubles back.");
