// Rogers Pass job (run by .github/workflows/rogers-pass.yml every 15 minutes on winter mornings, every 2 hours the
// rest of the day), for "Rogers Pass" in the site's Skiing mode.
//
// Rogers Pass (Glacier National Park) has the world's largest mobile avalanche control program: the army fires
// artillery at the slopes above the highway and railway. Parks Canada's Winter Permit System keeps skiers out of the
// way: every winter morning (around 7:30) it posts which Winter Restricted Areas and parking lots are open today.
// This reads the same feed as Parks Canada's own "Rogers Pass Backcountry Access" map (www.pc.gc.ca/apps/rogers-pass,
// open JSON, no key; the browser can't read it directly because it has no CORS header) and writes
// data/rogers-status.json:
//  - posted: today's status is posted (false: before ~7:30, or in summer: every Restricted Area counts as closed)
//  - validFrom / validUntil: when the posted status starts and ends (Pacific time, as Parks Canada gives it)
//  - summer: the Winter Permit System is off (it runs from November 15 to the end of avalanche control)
//  - areas: every permit area with its group (R Winter Restricted, U Winter Unrestricted, P Winter Prohibited,
//    S a special closure inside a Restricted Area), open today or not, Parks Canada's note, and the outline
//  - parking: the winter parking lots, open today or not, with their notes
// The outlines are Parks Canada's (the same as their KML), simplified to about 8 m. Only saved when something changed
// (the workflow reads "changed" from GITHUB_OUTPUT), so the site isn't republished every 15 minutes for nothing.
// A failed run keeps the last good file.
//
// Run: node scripts/build-rogers.mjs   (Node 18 or newer, no packages)

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";

const OUT = new URL("../data/rogers-status.json", import.meta.url);
const BASE = process.env.ROGERS_API || "https://www.pc.gc.ca/apps/rogers-pass/data/";
const UA = "trail-finder Rogers Pass status (https://github.com/allduf/trail-finder)";
const TZ = "America/Vancouver";

async function get(path, { optional = false } = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(BASE + path, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(45000) });
      if (r.ok) return r.json();
      if (r.status === 404 && optional) return null;
      console.log(`${path}: HTTP ${r.status}`);
    } catch (e) { console.log(`${path}: ${e.message}`); }
    await new Promise((ok) => setTimeout(ok, 3000 * (i + 1)));
  }
  if (optional) return null;
  throw new Error(`Couldn't get ${BASE}${path}`);
}

// Parks Canada's notes are small bits of HTML: plain text, and the first link (often the designated access route).
const text = (h) => String(h || "").replace(/<\/p>\s*<p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&rsquo;/g, "’").replace(/&eacute;/g, "é").replace(/&agrave;/g, "à").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").trim();
const link = (h) => { const m = String(h || "").match(/href="([^"]+)"/); return m ? m[1].replace(/^http:/, "https:") : undefined; };

// Douglas-Peucker on [lon, lat] points, tol in metres; out is flat [lat, lon, lat, lon, ...] at 5 decimals.
function simplify(pts, tol = 8) {
  if (pts.length < 4) return pts;
  const k = Math.cos((pts[0][1] * Math.PI) / 180) * 111320, xy = pts.map(([lon, lat]) => [lon * k, lat * 110540]);
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = 0, at = -1;
    const [ax, ay] = xy[a], [bx, by] = xy[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = len > 1 ? Math.abs(dy * (xy[i][0] - ax) - dx * (xy[i][1] - ay)) / len : Math.hypot(xy[i][0] - ax, xy[i][1] - ay);
      if (d > best) { best = d; at = i; }
    }
    if (best > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const flat = (ring) => simplify(ring).flatMap(([lon, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]);
function rings(g) {
  if (!g || !g.coordinates) return [];
  const polys = g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : [];
  return polys.flatMap((p) => p.map(flat)).filter((r) => r.length >= 8);   // outer rings and holes, in order
}

// A Pacific time from the feed ("2026-12-01T07:30:00", with or without an offset) as a time in ms.
function parsePT(v) {
  const t = String(v || "");
  if (!t) return NaN;
  if (/(Z|[+-]\d\d:?\d\d)$/.test(t)) return Date.parse(t);
  const asUtc = Date.parse(t + "Z");
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(new Date(asUtc)).map((x) => [x.type, x.value]));
  const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
  return asUtc - (shown - asUtc);   // the Pacific clock reads t at this moment
}
const iso = (t) => (isNaN(t) ? undefined : new Date(t).toISOString());
const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const settings = (await get("settings"))?.obj || {};
const pub = await get(`publish-${day}`, { optional: true });
const from = pub && pub.validFrom ? parsePT(pub.validFrom.UTC || pub.validFrom.PST || pub.validFrom) : NaN;
const posted = !!(pub && Array.isArray(pub.areas) && (isNaN(from) || Date.now() >= from));
const doc = posted ? pub : await get("nopublish");
if (!doc || !Array.isArray(doc.areas) || !doc.areas.length) throw new Error("No permit areas in the Parks Canada feed");
console.log(`${day}: ${posted ? "today's status is posted" : "no status posted for today"}${settings.isSummer ? " (summer)" : ""}, ${doc.areas.length} areas, ${(doc.parkingLots || []).length} parking lots`);

let old = null;
try { old = JSON.parse(readFileSync(OUT, "utf8")); } catch {}
// The outlines hardly ever change: read again only for a new area, or on the first run of the day.
const oldRings = new Map((old?.areas || []).map((a) => [a.id, a.rings]));
const areas = [];
for (const a of doc.areas) {
  const p = a.properties || {};
  let rs = old && old.day === day ? oldRings.get(p.id) : null;
  if (!rs || !rs.length) {
    const geo = typeof a.geometry === "string" ? await get(a.geometry, { optional: true }) : a.geometry;
    rs = rings(geo);
    if (!rs.length) rs = oldRings.get(p.id) || [];
  }
  if (!rs.length) { console.log(`  no outline for ${p.nameEn}`); continue; }
  areas.push({
    id: p.id, name: p.nameEn, block: p.block?.nameEn, group: p.group, open: p.isOpen === true,
    parent: p.parentFeatureId, note: text(p.commentEn) || undefined, link: link(p.commentEn),
    center: p.centerCoordinates ? [p.centerCoordinates[1], p.centerCoordinates[0]] : undefined, rings: rs,
  });
}
const parking = (doc.parkingLots || []).map((l) => ({
  id: l.properties.id, name: l.properties.nameEn, open: l.properties.isOpen === true, note: text(l.properties.commentEn) || undefined,
  lat: l.geometry.coordinates[1], lon: l.geometry.coordinates[0],
}));
const out = {
  source: "Parks Canada, Rogers Pass Backcountry Access (www.pc.gc.ca/apps/rogers-pass)",
  day, posted, summer: !!settings.isSummer,
  // ISO times, so the app can tell when the posted status runs out (validUntil, often the next morning)
  validFrom: posted ? iso(from) : undefined,
  validUntil: posted ? iso(parsePT(pub.validUntil?.UTC || pub.validUntil?.PST || pub.validUntil)) : undefined,
  areas, parking,
};
const same = old && JSON.stringify({ ...old, checkedAt: 0 }) === JSON.stringify({ ...out, checkedAt: 0 });
out.checkedAt = new Date().toISOString();
const open = areas.filter((a) => a.group === "R" && a.open).map((a) => a.name);
console.log(`  Restricted Areas open: ${open.join(", ") || "none"}; parking open: ${parking.filter((l) => l.open).map((l) => l.name).join(", ") || "none"}`);
if (same) console.log("  unchanged since the last run");
else { writeFileSync(OUT, JSON.stringify(out) + "\n"); console.log(`  wrote ${OUT.pathname} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`); }
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${same ? "false" : "true"}\n`);
