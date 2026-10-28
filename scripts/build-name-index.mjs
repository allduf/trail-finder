// Nightly, after scripts/build-canada.mjs finish (canada-data.yml): every named trail in Canada in one small list,
// so the trail name box finds a trail anywhere, not only in the area the map is on (alex 2026-10-28: "Bromont"
// found the Broomstick trail in North Vancouver). Reads the chunks in out/ca/c/ and writes out/ca/names.json:
//   { v: 1, builtAt, names: [[name, lat, lon, kind, alt?]] }
// kind: M MTB trail, R MTB route, B bike or walking route, P path or trail, C bike path. One entry per name, unless
// pieces with that name lie more than 3 km apart. Unnamed-for-bikes forest roads (tracks with no mtb
// tags) and names that are only a number are left out. Picking an entry loads that chunk's own names (index.html).
// Run: node scripts/build-name-index.mjs [chunk folder] [output file]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const dir = process.argv[2] || "out/ca/c", outFile = process.argv[3] || "out/ca/names.json";
const hasMtb = (t) => Object.keys(t).some((k) => /^mtb(:|$)/.test(k));
const near = (a, b) => Math.abs(a[0] - b[0]) < 0.027 && Math.abs(a[1] - b[1]) < 0.04;   // about 3 km
const r3 = (n) => Math.round(n * 1000) / 1000;
function kindOf(t, rel) {
  if (rel) return t.route === "mtb" ? "R" : "B";
  if (hasMtb(t)) return "M";
  if (t.highway === "track") return null;
  return t.highway === "cycleway" ? "C" : "P";
}
const out = [], byName = new Map();   // across chunks: a trail near a chunk's edge is in both
let chunks = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  let c;
  try { c = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")); } catch { continue; }
  if (!c || c.v !== 1) continue;
  chunks++;
  const items = (c.names || []).map((i) => ({ tags: i.tags || {}, c: i.c, rel: i.t === "r" }));
  for (const w of Object.values((c.mtb && c.mtb.ways) || {})) {
    const g = w.g || [];
    if (g.length < 2) continue;
    const m = (g.length >> 2) << 1;   // a point in the middle of the flat lat,lon list
    items.push({ tags: w.tags || {}, c: [g[m], g[m + 1]], rel: false });
  }
  for (const i of items) {
    const name = (i.tags.name || i.tags["mtb:name"] || "").trim();
    if (name.length < 3 || /^[\d\s.#-]+$/.test(name) || !Array.isArray(i.c)) continue;
    const kind = kindOf(i.tags, i.rel);
    if (!kind) continue;
    const key = name.toLowerCase() + (i.rel ? "|r" : "");
    const list = byName.get(key) || [];
    const same = list.find((e) => near([e[1], e[2]], i.c));
    if (same) { if (kind === "M" && same[3] === "P") same[3] = "M"; continue; }
    const alt = [i.tags["mtb:name"], i.tags.alt_name, i.tags.old_name].filter((a) => a && a.trim() !== name).join(";");
    const e = [name, r3(i.c[0]), r3(i.c[1]), kind];
    if (alt) e.push(alt);
    list.push(e); byName.set(key, list); out.push(e);
  }
}
writeFileSync(outFile, JSON.stringify({ v: 1, builtAt: new Date().toISOString(), names: out }));
console.log(`${out.length} trail names from ${chunks} chunks -> ${outFile}`);
