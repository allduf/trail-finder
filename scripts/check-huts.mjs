// Hut check (data/huts.json; alex 2026-10-30: "look for all hut and cabin ... keep it updated"). Run once a month by
// the "Monthly hut check" scheduled task, which then looks up the clubs' and parks' pages and opens a PR with the
// changes (the container and GitHub Actions can't read club sites themselves). It:
//  - fails on a broken huts.json (bad JSON, a hut with no name or spot, a link that isn't https, a bad operator rule),
//  - lists the huts whose facts are older than 90 days (re-check price, booking link, season),
//  - with the job data there (bash scripts/site-data.sh get), lists the map's huts that look bookable or charge a fee
//    but have no booking link and no club rule, biggest first: the next huts to look up,
//  - lists the 'todo' huts still waiting for an exact spot.
// Matching is winter.js's: same name within 5 km, or any hut within 250 m.
// Run: node scripts/check-huts.mjs   (OUT=file also writes the report there)

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";

const info = JSON.parse(readFileSync(new URL("../data/huts.json", import.meta.url), "utf8"));
const bad = [], lines = [];
const say = (s = "") => lines.push(s);
const key = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\b(the|and|hut|huts|cabin|lodge|shelter|refuge|chalet)\b/g, "").replace(/[^a-z0-9]+/g, "");
const metres = (a, b) => Math.hypot((a.lat - b.lat) * 110540, (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180));

// ---------- the file itself ----------
const ops = (info.operators || []).map((o, i) => {
  try { return { ...o, re: new RegExp(o.op, "i") }; } catch (e) { bad.push(`operators[${i}]: bad pattern ${o.op}: ${e.message}`); return null; }
}).filter(Boolean);
const links = (t) => Object.entries(t || {}).filter(([k]) => /website|url/.test(k));
for (const [i, e] of (info.huts || []).entries()) {
  if (!e.name) bad.push(`huts[${i}]: no name`);
  if (!(Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180)) bad.push(`${e.name}: no spot (lat/lon); put it in todo instead`);
  else if (e.lat < 41 || e.lat > 84 || e.lon < -142 || e.lon > -52) bad.push(`${e.name}: ${e.lat}, ${e.lon} is outside Canada`);
  for (const [k, v] of links(e.tags)) if (!/^https?:\/\//.test(v)) bad.push(`${e.name}: ${k} is not a link: ${v}`);
  if (e.src && !/^https:\/\//.test(e.src)) bad.push(`${e.name}: src is not an https link`);
  if (e.tags?.reservation && !/^(required|yes|recommended|no|members_only)$/.test(e.tags.reservation)) bad.push(`${e.name}: reservation=${e.tags.reservation}`);
  e.keys = [e.name, ...(e.aka || [])].map(key).filter(Boolean);
}
for (const o of ops) for (const [k, v] of links(o.tags)) if (!/^https?:\/\//.test(v)) bad.push(`operator ${o.op}: ${k} is not a link`);

const age = Math.round((Date.now() - Date.parse(info.checked || "2000-01-01")) / 864e5);
say(`# Hut check`);
say(`huts.json: ${info.huts.length} huts, ${ops.length} club rules, ${(info.todo || []).length} to place; facts checked ${info.checked} (${age} days ago)`);
if (age > 90) say(`**Older than 90 days: look up every hut's price, booking link and season again, then set "checked".**`);

// ---------- against the map's huts (job data) ----------
const files = [];
if (existsSync(new URL("../data/ski.json", import.meta.url))) files.push(new URL("../data/ski.json", import.meta.url));
const can = new URL("../data/ski-canada/", import.meta.url);
if (existsSync(can)) for (const f of readdirSync(can)) if (f.endsWith(".json") && f !== "index.json") files.push(new URL(f, can));
if (files.length) {
  const seen = new Set(), huts = [];
  for (const f of files) for (const h of JSON.parse(readFileSync(f, "utf8")).huts || []) if (!seen.has(h.id)) { seen.add(h.id); huts.push(h); }
  const entryOf = (h) => {
    const k = key(h.name);
    let best = null, bestM = Infinity;
    for (const e of info.huts) {
      const m = metres(h, e);
      const named = k && m < 5000 && e.keys.some((n) => n === k || (n.length >= 5 && k.length >= 5 && (n.includes(k) || k.includes(n))));
      if ((named || m < 250) && m < bestM) { best = e; bestM = m; }
    }
    return best;
  };
  const found = new Set(), todo = [];
  let covered = 0;
  for (const h of huts) {
    const e = entryOf(h), t = h.tags || {}, o = ops.find((r) => r.re.test(t.operator || ""));
    if (e) found.add(e);
    if (e || o) { covered++; continue; }
    if (!h.name) continue;
    const score = (t.reservation && t.reservation !== "no" ? 3 : 0) + (t.fee === "yes" ? 2 : 0) + (t.operator ? 1 : 0) + (+t.capacity > 0 ? 1 : 0) + (h.kind === "alpine_hut" ? 1 : 0);
    if (score >= 2 && !t["reservation:website"] && !t.website) todo.push({ h, score });   // with a website, the app's Book button goes there
  }
  say(`Map huts: ${huts.length} (${huts.filter((h) => h.name).length} named); ${covered} have club facts.`);
  const added = info.huts.filter((e) => !found.has(e));
  say();
  say(`## On the map only from huts.json (${added.length}): not on OpenStreetMap, or named differently there`);
  for (const e of added) say(`- ${e.name} (${e.lat}, ${e.lon})`);
  todo.sort((a, b) => b.score - a.score || a.h.name.localeCompare(b.h.name));
  say();
  say(`## Look up next (${todo.length}): look bookable or charge a fee, no link at all, no club rule`);
  for (const { h } of todo.slice(0, 60)) {
    const t = h.tags || {};
    say(`- ${h.name} (${h.lat}, ${h.lon}${h.pv ? ", " + h.pv : ""}) ${[t.operator, t.reservation && "reservation=" + t.reservation, t.fee && "fee=" + t.fee, t.website].filter(Boolean).join(", ")}`);
  }
  if (todo.length > 60) say(`- … and ${todo.length - 60} more`);
} else say("(No job data here: run `bash scripts/site-data.sh get` to compare with the map's huts.)");

say();
say(`## Still to place (${(info.todo || []).length}): find the exact spot, then move to huts`);
for (const t of info.todo || []) say(`- ${t.name}: ${t.where || ""}`);

if (bad.length) { say(); say(`## Problems in huts.json (${bad.length})`); bad.forEach((b) => say(`- ${b}`)); }
const out = lines.join("\n");
console.log(out);
if (process.env.OUT) writeFileSync(process.env.OUT, out + "\n");
if (bad.length) process.exit(1);
