// Nightly job (see .github/workflows/closures-data.yml): closures and warnings from the land managers, for the
// "🚧 Closures and warnings" layer and the trail details (closures.js). alex, 2026-10-24: "closures and warnings from
// clubs and land managers shown on the map".
//
// Writes data/closures.json from three official sources (each that fails keeps its last good part):
//  - Alberta Parks trail reports (Kananaskis Country, Bragg Creek, Canmore, Glenbow Ranch): each area's report (updated
//    date, conditions, closures) and its table of trails, with each trail's status (Open, Closed, Caution...), warning,
//    length and permitted activities (bikes, e-bikes). albertaparks.ca, scraped from the report pages.
//  - BC Parks advisories (bcparks.ca's public API): trail closures, wildlife, hazards, washouts, bridges, road closures...
//    for the parks in or near the app's zones, with the park's centre (BC Parks gives no spot for an advisory).
//  - Parks Canada bulletins (Banff, Yoho, Kootenay, Mount Revelstoke, Glacier): area closures, bear warnings and trail
//    restrictions (the lists on parks.canada.ca; camping, fishing and boating ones are left out).
//
// Run: node scripts/build-closures.mjs   (Node 18 or newer, no packages needed; ONLY=ab|bc|pc runs one part)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const DATA = new URL("data/", root);
const OUT = new URL("closures.json", DATA);
const UA = "Mozilla/5.0 (compatible; trail-finder closures data; https://github.com/allduf/trail-finder)";
const ONLY = process.env.ONLY || "";
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!existsSync(DATA)) mkdirSync(DATA);
const old = (() => { try { return JSON.parse(readFileSync(OUT, "utf8")); } catch { return {}; } })();

async function get(url, type = "text") {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: type === "json" ? "application/json" : "text/html" }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return type === "json" ? await res.json() : await res.text();
    } catch (e) { last = e; await sleep(5000 * (i + 1)); }
  }
  throw new Error(`${url}: ${last.message}`);
}
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);
const text = (h) => decode(String(h || "").replace(/<(br|\/p|\/li|\/div|\/h\d)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

// ---------- Alberta Parks trail reports ----------
const AP = "https://www.albertaparks.ca";
const AP_LIST = "/parks/kananaskis/kananaskis-country/advisories-public-safety/trail-reports/";
// Each report area's rough middle, so the site can pick the right "Loop A" when two areas share a trail name.
const AP_AREAS = {
  "bow-valley": [51.06, -115.1], "brown-lowery": [50.82, -114.53], "canmore-and-area": [51.08, -115.33], "canmore-nordic-centre": [51.09, -115.39],
  "elbow-valley": [50.88, -114.78], "glenbow-ranch": [51.17, -114.42], "kananaskis-valley": [50.93, -115.13], "peter-lougheed": [50.68, -115.17],
  "sandy-mcnabb": [50.63, -114.48], "sheep-and-highwood": [50.62, -114.62], "sibbald-flats": [51.06, -114.87], "spray-valley": [50.88, -115.35],
  "west-bragg-creek": [50.94, -114.6],
};
const ACT = { "Biking/Cycling": "bike", "E-bikes": "ebike", Hiking: "hike", "Horseback Riding": "horse", "Fat Biking": "fatbike", "Cross-country Skiing": "ski", Snowshoeing: "snowshoe", "Off-highway Vehicles": "ohv" };
function apReport(slug, page) {
  const main = page.slice(page.indexOf("Print Report") > 0 ? page.indexOf("Print Report") : 0);
  const updated = (page.match(/Updated:\s*(?:<[^>]+>\s*)*([A-Z][a-z]+ \d{1,2}, \d{4})/) || [])[1] || null;
  const tableAt = main.indexOf('id="exampleTr"');
  const intro = text(tableAt > 0 ? main.slice(0, main.lastIndexOf("<table", tableAt)) : main.slice(0, 20000)).replace(/^Print Report\s*/, "");
  const lines = intro.split("\n").map((l) => l.trim()).filter(Boolean);
  const cut = lines.findIndex((l) => /^(Maps|Trail Name)$/i.test(l));
  const body = (cut > 0 ? lines.slice(0, cut) : lines);
  // "Closures:" is followed by pairs of lines: "<trails>:" then the reason, until "Notes:" or the end.
  const ci = body.findIndex((l) => /^closures:?$/i.test(l)), ni = body.findIndex((l, k) => k > ci && /^(notes|warnings|cautions|advisories):?$/i.test(l));
  const closures = [];
  if (ci >= 0) {
    const part = body.slice(ci + 1, ni > ci ? ni : ci + 12);
    for (let k = 0; k < part.length; k++) {
      if (/:$/.test(part[k]) && part[k + 1] && !/:$/.test(part[k + 1])) { closures.push(clip(`${part[k]} ${part[k + 1]}`, 220)); k++; }
      else if (part[k].length > 3) closures.push(clip(part[k], 220));
    }
  }
  const note = clip(body.slice(0, ci >= 0 ? ci : 3).filter((l) => !/^updated:?$/i.test(l) && !/^[A-Z][a-z]+ \d{1,2}, \d{4}\s*\|?$/.test(l)).join(" "), 600);
  const trails = [];
  const rows = tableAt > 0 ? main.slice(tableAt).split(/<tr[\s>]/).slice(2) : [];
  for (const row of rows) {
    const cells = row.split(/<td/).slice(1);
    if (cells.length < 4) continue;
    const a = cells[0].match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const name = text(a ? a[2] : cells[0].replace(/^[^>]*>/, "")).split("\n")[0].trim();
    if (!name) continue;
    const warn = text((cells[0].match(/<div class="fs15">([\s\S]*?)<\/div>/) || [])[1] || "");
    const acts = [...cells[1].matchAll(/alt="([^"]+)"/g)].map((m) => ACT[m[1]] || m[1].toLowerCase());
    const km = parseFloat(text(cells[2].replace(/^[^>]*>/, ""))) || null;
    const st = text(cells[3].replace(/^[^>]*>/, "")).split("\n")[0].trim() || null;
    trails.push({ n: name, st, ...(warn ? { warn: clip(warn, 300) } : {}), act: [...new Set(acts)], ...(km ? { km } : {}), ...(a ? { url: AP + a[1] } : {}) });
  }
  return { id: slug, name: decode((page.match(/<title>\s*([^|<]+?)\s*\|/) || [])[1] || slug), c: AP_AREAS[slug] || null, url: AP + AP_LIST + slug + "/", updated, note, closures, trails };
}
async function albertaParks() {
  const list = await get(AP + AP_LIST);
  const slugs = [...new Set([...list.matchAll(/href="\/parks\/kananaskis\/kananaskis-country\/advisories-public-safety\/trail-reports\/([a-z0-9-]+)\/"/g)].map((m) => m[1]))];
  if (!slugs.length) throw new Error("no report areas found on the list page");
  const out = [];
  for (const slug of slugs) {
    try {
      const r = apReport(slug, await get(AP + AP_LIST + slug + "/"));
      out.push(r);
      log(`  Alberta Parks ${r.name}: updated ${r.updated || "?"}, ${r.trails.length} trails (${r.trails.filter((t) => !/^open$/i.test(t.st || "")).length} not open), ${r.closures.length} closures`);
    } catch (e) { log(`  Alberta Parks ${slug}: ${e.message}`); }
    await sleep(1500);
  }
  if (!out.some((r) => r.trails.length)) throw new Error("no trail tables read");
  return out;
}

// ---------- BC Parks advisories ----------
const BCP = "https://bcparks.api.gov.bc.ca/api";
// Event types that don't matter on a bike (camping, water, parking...).
const BCP_SKIP = /^(boil water advisory|drinking water|parking|reservations|campfires|pets|cultural|volunteer|thieves|noise|hours of operation|campground|camping|facilities unavailable|facility|boundary adjustment|off-road vehicles|water quality|marine|fishing|swimming|beach|boat launch|anchorage|dock|feedback|regulations|park policy|park management|ecosystem restoration|mooring)/i;
const near = (lat, lon, pad = 0.3) => ZONES.some((z) => lat >= z.box[0] - pad && lat <= z.box[2] + pad && lon >= z.box[1] - pad && lon <= z.box[3] + pad);
async function pages(path) {
  const out = [];
  for (let p = 1; p <= 30; p++) {
    const j = await get(`${BCP}/${path}${path.includes("?") ? "&" : "?"}pagination%5BpageSize%5D=100&pagination%5Bpage%5D=${p}`, "json");
    out.push(...(j.data || []));
    const pg = j.meta && j.meta.pagination;
    if (!pg || p >= pg.pageCount) break;
    await sleep(500);
  }
  return out;
}
async function bcParks() {
  const parks = new Map();
  for (const p of await pages("protected-areas")) if (p.latitude && p.longitude && near(p.latitude, p.longitude)) parks.set(p.orcs, { name: p.protectedAreaName, c: [+p.latitude.toFixed(4), +p.longitude.toFixed(4)], url: p.url });
  log(`  BC Parks: ${parks.size} parks in or near the zones`);
  const out = [];
  for (const a of await pages("public-advisories")) {
    const type = (a.eventType && a.eventType.eventType) || "";
    if (BCP_SKIP.test(type) || (a.advisoryStatus && a.advisoryStatus.code && a.advisoryStatus.code !== "PUB")) continue;
    if (a.endDate && Date.parse(a.endDate) < Date.now()) continue;
    // Ecological reserves need a permit to enter at all: not riding places.
    const ps = (a.protectedAreas || []).filter((p) => !/ecological reserve/i.test(p.type || p.protectedAreaName || "")).map((p) => parks.get(p.orcs)).filter(Boolean);
    if (!ps.length) continue;
    out.push({ id: a.advisoryNumber || a.id, title: clip(text(a.title), 200), type, desc: clip(text(a.description), 360),
      urgency: (a.urgency && a.urgency.urgency) || null, safety: !!a.isSafetyRelated, closed: /closed/i.test((a.accessStatus && a.accessStatus.accessStatus) || ""),
      date: (a.advisoryDate || a.updatedDate || "").slice(0, 10) || null, until: a.endDate ? a.endDate.slice(0, 10) : null,
      ...(a.latitude && a.longitude ? { c: [+(+a.latitude).toFixed(4), +(+a.longitude).toFixed(4)] } : {}),
      parks: ps.map((p) => ({ name: p.name, c: p.c, url: p.url })) });
  }
  log(`  BC Parks: ${out.length} advisories that matter on a bike`);
  return out;
}

// ---------- Parks Canada bulletins ----------
const PC = { "Banff National Park": "ab/banff", "Yoho National Park": "bc/yoho", "Kootenay National Park": "bc/kootenay", "Mount Revelstoke National Park": "bc/revelstoke", "Glacier National Park": "bc/glacier" };
const PC_KEEP = /closure|closed|warning|bear|wildlife|cougar|wolf|bicycl|bike|cycling|trail|hazard|washout|flood|fire/i;
const PC_SKIP = /campground|camping|paddl|angling|fishing|watercraft|scuba|cannabis|smok|vaping|alcohol|generator|quiet hours|firearm|base jump|paraglid|hang glid|horse|equine|equestrian|e-bikes|electric bicycles|no stopping|drone|swimming|motor vehicles is restricted/i;
async function parksCanada() {
  const out = [];
  for (const [park, path] of Object.entries(PC)) {
    try {
      const page = await get(`https://parks.canada.ca/pn-np/${path}/bulletins`);
      const seen = new Set();
      for (const m of page.matchAll(/<a[^>]+href="([^"]*\/bulletins\/[0-9A-Fa-f-]{36})"[^>]*>([\s\S]*?)<\/a>/g)) {
        const title = text(m[2]).replace(/\s+/g, " ");
        if (!title || seen.has(title) || !PC_KEEP.test(title) || PC_SKIP.test(title)) continue;
        seen.add(title);
        out.push({ park, title: clip(title, 200), url: new URL(m[1], "https://parks.canada.ca").href });
      }
      log(`  Parks Canada ${park}: ${out.filter((b) => b.park === park).length} bulletins kept`);
    } catch (e) { log(`  Parks Canada ${park}: ${e.message}`); }
    await sleep(1500);
  }
  if (!out.length) throw new Error("no bulletins read");
  return out;
}

const builtAt = new Date().toISOString().slice(0, 19) + "Z";
const file = { v: 1, builtAt, ab: old.ab || [], abAt: old.abAt || null, bc: old.bc || [], bcAt: old.bcAt || null, pc: old.pc || [], pcAt: old.pcAt || null };
let failed = 0;
for (const [key, fn] of [["ab", albertaParks], ["bc", bcParks], ["pc", parksCanada]]) {
  if (ONLY && ONLY !== key) continue;
  log(`${key}:`);
  try { file[key] = await fn(); file[key + "At"] = builtAt; }
  catch (e) { failed++; log(`  failed (${e.message}), keeping the last good data`); }
}
writeFileSync(OUT, JSON.stringify(file));
log(`Wrote data/closures.json: ${file.ab.length} Alberta Parks areas, ${file.bc.length} BC Parks advisories, ${file.pc.length} Parks Canada bulletins${failed ? `; ${failed} source(s) failed` : ""}.`);
if (failed === 3) process.exit(1);
