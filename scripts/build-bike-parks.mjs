// Bike parks, pump tracks, skills parks, BMX tracks and MTB centres for all of Canada, from OpenStreetMap.
// Runs inside the nightly Canada job (.github/workflows/canada-data.yml), on each province's Geofabrik extract:
//   node scripts/build-bike-parks.mjs ingest <prov> <places.geojsonseq> <trails.geojsonseq>   once per province
//   node scripts/build-bike-parks.mjs finish                                                 once at the end
// and writes out/ca/bike-parks.json (published with the website as ca/bike-parks.json, never committed to main).
//
// <places> is the province filtered to sport/leisure/winter sports/lift features (see the workflow); <trails> is the trail
// export build-canada.mjs reads, used here only for its pay-to-ride paths (bicycle=customers, the way bike parks tag them).
// A ski hill counts as a lift-served bike park when a lift is open to bikes, or when it has pay-to-ride trails and lifts.
//
// Run: Node 18 or newer, no packages needed.

import { writeFileSync, readFileSync, mkdirSync, readdirSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const root = new URL("../", import.meta.url);
const OUT = new URL("out/ca/", root), PART = new URL("out/parks/", root);
const round = (n) => Math.round(n * 1e5) / 1e5;
const log = (...a) => console.log(...a);

// ---------- what a place is, from its tags and name (English and French) ----------
const RE = {
  pump: /pump ?track|pumptrack|pump park|piste (à|a) (rouleaux|bosses)|parcours (à|a) bosses|pumptrack/i,
  bmx: /\bbmx\b/i,
  jumps: /jump ?park|dirt ?jumps?|jump lines?|freeride park|slopestyle|parc (de )?(saut|habilet)|terrain de (bmx|saut)/i,
  skills: /skills?\b/i,
  centre: /(mountain bike|mtb|bike|biking|cycling|v[ée]lo( de montagne)?)( trail| adventure)? (centre|center)|centre (de )?v[ée]lo|trail (centre|center)|ski (and|&|et) (bike|v[ée]lo)|(bike|v[ée]lo) (and|&|et) ski|(montagne|mont) .*v[ée]lo/i,
  park: /bike ?park|bikepark|mtb park|parc (de )?v[ée]lo|v[ée]lo ?parc|parc (de )?v[ée]lo de montagne|freeride area|bike area/i,
  notBike: /velodrome|vélodrome|motocross|\bmx park|moto|dirt ?bike|\batv\b|quad|snowmobile|golf|disc golf|skate ?park(?! .*bike)/i,
};
const BIKE_SPORT = /^(mtb|mountain_biking|bmx|cycling|bicycle|pump_track|dirt_jumping|freeride|downhill)$/;
const sports = (t) => String(t.sport || "").split(";").map((s) => s.trim());
const bikeLift = (t) => /^(yes|designated|permissive|customers|summer)$/.test(t.bicycle || t["aerialway:bicycle"] || "") || /^(yes|designated)$/.test(t.mtb || "");
const pick = (t, ...k) => k.map((x) => t[x]).find((v) => v);

// The kind of a place, or null when it isn't a bike place. Kinds: park, centre, skills, pump (pump, BMX or bike track).
function kindOf(t, point) {
  const name = `${t.name || ""} ${t["name:en"] || ""} ${t["name:fr"] || ""}`;
  if (t.shop || /^bicycle_/.test(t.amenity || "") || t.highway || t.building && !t.leisure) return null;
  if (RE.notBike.test(name) && !RE.park.test(name)) return null;
  const sp = sports(t), bikeSport = sp.some((s) => BIKE_SPORT.test(s));
  if (t.pump_track || /pump/.test(`${t.cycling || ""} ${t.bmx || ""} ${t.track || ""} ${t.sport || ""}`) || RE.pump.test(name)) return "pump";
  if (RE.centre.test(name)) return "centre";
  if (RE.park.test(name)) return "park";
  if (RE.jumps.test(name) || RE.skills.test(name) && (bikeSport || /bike|biking|v[ée]lo|bmx|mtb/i.test(name))) return "skills";
  if (sp.includes("bmx") || t.leisure === "bmx_track" || RE.bmx.test(name)) return "pump";
  // From here on only tags say it's a bike place: a point needs to be a park or track itself (not a jump or drop in one).
  if (point && !/^(park|sports_centre|pitch|track|recreation_ground)$/.test(t.leisure || "") && t.landuse !== "winter_sports") return null;
  if (sp.some((s) => /^(mtb|mountain_biking|dirt_jumping|freeride|downhill)$/.test(s))) return t.leisure === "track" ? "pump" : "park";
  // A cycling track that isn't a velodrome (those are named so, and dropped above): most are pump tracks mapped without saying so.
  if (sp.includes("cycling") && t.leisure === "track") return "pump";
  return null;
}

// What a track is: "pump", "bmx" or "track" (a cycling track not said to be either).
const pumpSub = (t) => (t.pump_track || /pump/.test(`${t.cycling || ""} ${t.bmx || ""} ${t.track || ""} ${t.sport || ""}`) || RE.pump.test(t.name || "") ? "pump"
  : sports(t).includes("bmx") || t.leisure === "bmx_track" || RE.bmx.test(t.name || "") ? "bmx" : "track");

// Bounding box and centre of any GeoJSON geometry.
function bbox(geom) {
  const b = [90, 180, -90, -180];
  const walk = (c) => { if (typeof c[0] === "number") { b[0] = Math.min(b[0], c[1]); b[1] = Math.min(b[1], c[0]); b[2] = Math.max(b[2], c[1]); b[3] = Math.max(b[3], c[0]); } else c.forEach(walk); };
  walk(geom.coordinates);
  return b.map(round);
}
const centre = (b) => [round((b[0] + b[2]) / 2), round((b[1] + b[3]) / 2)];
const metres = (a, b) => { const k = Math.cos((a[0] * Math.PI) / 180) * 111320; return Math.hypot((a[1] - b[1]) * k, (a[0] - b[0]) * 110540); };
const inBox = (p, b, pad = 0) => { const dLat = pad / 110540, dLon = pad / (Math.cos((p[0] * Math.PI) / 180) * 111320);
  return p[0] >= b[0] - dLat && p[0] <= b[2] + dLat && p[1] >= b[1] - dLon && p[1] <= b[3] + dLon; };

// The tags the site shows (kept short: the whole file loads at once).
const KEEP = ["name", "name:en", "name:fr", "operator", "website", "contact:website", "url", "phone", "contact:phone", "email", "contact:email",
  "opening_hours", "seasonal", "fee", "charge", "access", "surface", "lit", "description", "note", "mtb:scale", "mtb:scale:imba", "wheelchair",
  "addr:housenumber", "addr:street", "addr:city", "start_date", "facebook", "contact:facebook", "instagram", "contact:instagram"];
const keep = (t) => Object.fromEntries(KEEP.filter((k) => t[k]).map((k) => [k, String(t[k]).slice(0, 300)]));

// ---------- ingest: one province -> out/parks/<prov>.json ----------
async function ingest(prov, placesFile, trailsFile) {
  const places = [], resorts = [], lifts = [], pay = [], mtb = [], seen = new Set();
  for await (const line of createInterface({ input: createReadStream(placesFile) })) {
    const s = line.replace(/^\x1e/, "");
    if (!s) continue;
    const f = JSON.parse(s), p = f.properties || {};
    if (!f.geometry) continue;
    const id = `${(p["@type"] || "n")[0]}${p["@id"]}`, t = {};
    for (const k in p) if (k[0] !== "@") t[k] = p[k];
    if (seen.has(id)) continue;   // a closed way can come out both as a line and an area
    seen.add(id);
    const b = bbox(f.geometry);
    if (t.aerialway && !/^(station|pylon|goods|zip_line|rope_tow|magic_carpet)$/.test(t.aerialway)) { lifts.push({ c: centre(b), bike: bikeLift(t), n: t.name || "" }); continue; }
    if (t.landuse === "winter_sports" || /skiing/.test(t.sport || "") && t.leisure === "sports_centre") {
      if (t.name) resorts.push({ id, n: t.name, b, t: keep(t), centre: RE.centre.test(t.name) });
      if (!kindOf(t, f.geometry.type === "Point")) continue;
    }
    const k = kindOf(t, f.geometry.type === "Point");
    if (!k) continue;
    places.push({ id, k, c: centre(b), b, t: keep(t), ...(k === "pump" ? { sub: pumpSub(t) } : {}) });
  }
  // Pay-to-ride paths and MTB trails: only lines mentioning customers or mtb are parsed, the rest of the (big) trail file is skipped.
  // Only dirt paths count: in Quebec thousands of paved paths (campuses, golf courses, malls) are tagged bicycle=customers too.
  for await (const line of createInterface({ input: createReadStream(trailsFile) })) {
    if (!line.includes('"customers"') && !line.includes('"mtb')) continue;
    const f = JSON.parse(line.replace(/^\x1e/, "")), p = f.properties || {};
    if (!f.geometry || f.geometry.type !== "LineString" || !/^(path|track|bridleway)$/.test(p.highway || "")) continue;
    if (/^(asphalt|concrete|paved|paving_stones|sett|concrete:plates|wood|metal)$/.test(p.surface || "") || p.golf || p.golf_cart) continue;
    const anyMtb = Object.keys(p).some((k) => k.startsWith("mtb") && p[k] !== "no");
    const g = f.geometry.coordinates, m = g[Math.floor(g.length / 2)];
    if (p.bicycle === "customers" && (anyMtb || p.name || !/^(track)$/.test(p.highway))) pay.push([round(m[1]), round(m[0]), p.name || "", p.operator || ""]);
    // Third field: looks like a gravity trail (downhill or freeride, or rated S2 / IMBA black or harder).
    if (anyMtb) mtb.push([round(m[1]), round(m[0]), /downhill|gravity|freeride/.test(p["mtb:type"] || "") || +String(p["mtb:scale"] || "0")[0] >= 2 || +(p["mtb:scale:imba"] || 0) >= 3 ? 1 : 0]);
  }
  mkdirSync(PART, { recursive: true });
  writeFileSync(new URL(`${prov}.json`, PART), JSON.stringify({ prov, places, resorts, lifts, pay, mtb }));
  log(`${prov}: ${places.length} bike places, ${resorts.length} ski hills, ${lifts.length} lifts (${lifts.filter((l) => l.bike).length} open to bikes), ${pay.length} pay-to-ride paths, ${mtb.length} MTB paths.`);
}

// ---------- finish: lift-served bike parks, merging, one file for Canada ----------
function finish() {
  const builtAt = new Date().toISOString().slice(0, 19) + "Z";
  const out = [];
  for (const f of readdirSync(PART).filter((x) => x.endsWith(".json"))) {
    const { prov, places, resorts, lifts, pay, mtb = [] } = JSON.parse(readFileSync(new URL(f, PART), "utf8"));
    const near = (list, b, pad) => list.filter((x) => inBox(x.c || x, b, pad));
    // Ski hills with a lift open to bikes are lift-served bike parks. Most lifts aren't tagged for bikes, so a ski hill with
    // lifts and pay-to-ride trails, or with lots of MTB trails including downhill ones, is "likely lift-served".
    for (const r of resorts) {
      const ls = near(lifts, r.b, 300), bikeLs = ls.filter((l) => l.bike), paid = pay.filter((q) => inBox(q, r.b, 300));
      const trails = mtb.filter((q) => inBox(q, r.b, 200)), dh = trails.filter((q) => q[2]).length;
      const lift = bikeLs.length ? "yes" : ls.length && (paid.length >= 5 || (trails.length >= 10 && dh >= 3)) ? "likely" : null;
      if (!lift && !r.centre) continue;
      out.push({ id: r.id, k: r.centre && !lift ? "centre" : "park", p: prov, c: centre(r.b), b: r.b, t: r.t, ...(lift ? { lift } : {}), ...(paid.length ? { pay: paid.length } : {}), ...(trails.length ? { mtb: trails.length } : {}),
        ...(bikeLs.length ? { lifts: bikeLs.map((l) => l.n).filter(Boolean).slice(0, 8) } : {}) });
    }
    for (const x of places) {
      // A bike park on a ski hill (or next to a lift open to bikes) is lift-served too.
      const bikeLs = x.k === "park" || x.k === "centre" ? near(lifts.filter((l) => l.bike), x.b, 1500) : [];
      const paid = x.k === "pump" ? [] : pay.filter((q) => inBox(q, x.b, 1000));
      out.push({ ...x, p: prov, ...(bikeLs.length ? { lift: "yes", lifts: bikeLs.map((l) => l.n).filter(Boolean).slice(0, 8) } : {}), ...(paid.length ? { pay: paid.length } : {}) });
    }
    // Pay-to-ride trail networks no place covers (often mapped as trails only): one bike park each, named by their operator.
    const free = pay.filter((q) => !out.some((o) => o.p === prov && o.k !== "pump" && inBox(q, o.b, 2000)));
    const used = new Set();
    free.forEach((q, i) => {
      if (used.has(i)) return;
      const group = free.map((o, j) => [o, j]).filter(([o, j]) => !used.has(j) && metres(q, o) < 2500);
      if (group.length < 8) return;
      group.forEach(([, j]) => used.add(j));
      const pts = group.map(([o]) => o), b = [Math.min(...pts.map((o) => o[0])), Math.min(...pts.map((o) => o[1])), Math.max(...pts.map((o) => o[0])), Math.max(...pts.map((o) => o[1]))];
      const ops = pts.map((o) => o[3]).filter(Boolean), op = ops.sort((a, c) => ops.filter((v) => v === c).length - ops.filter((v) => v === a).length)[0];
      const ls = near(lifts, b, 500), bikeLs = ls.filter((l) => l.bike);
      out.push({ id: `x${round(b[0])}_${round(b[1])}`, k: "park", p: prov, c: centre(b), b, t: op ? { name: op } : {}, pay: pts.length,
        ...(bikeLs.length ? { lift: "yes" } : ls.length ? { lift: "likely" } : {}), trails: [...new Set(pts.map((o) => o[2]).filter(Boolean))].slice(0, 6) });
    });
  }
  // The same place mapped twice (a point and an area, or a ski hill and its bike park): keep one, with both sets of facts.
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, " ").replace(/\b(the|bike|park|mountain|resort|ski|area|le|la|les|de|des|du)\b/g, "").trim();
  const merged = [];
  for (const x of out.sort((a, b) => (b.lift ? 2 : 0) + (b.b[2] - b.b[0]) - ((a.lift ? 2 : 0) + (a.b[2] - a.b[0])))) {
    const same = merged.find((m) => (m.k === x.k || (m.k !== "pump" && x.k !== "pump" && (m.lift || x.lift))) &&
      ((norm(m.t.name) && norm(m.t.name) === norm(x.t.name) && metres(m.c, x.c) < 3000) || (!x.t.name && x.k === m.k && inBox(x.c, m.b, 50)) ||
       (m.lift && x.k === "park" && inBox(x.c, m.b, 500))));
    if (same) {
      same.t = { ...x.t, ...same.t };
      if (x.t.name && same.t.name !== x.t.name && !(same.also || []).includes(x.t.name)) (same.also ||= []).push(x.t.name);
      ["lift", "lifts", "pay", "mtb", "sub", "trails"].forEach((k) => { if (x[k] && !same[k]) same[k] = x[k]; });
      continue;
    }
    merged.push(x);
  }
  merged.forEach((x) => { if (x.b[0] === x.b[2] && x.b[1] === x.b[3]) delete x.b; });
  merged.sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL("bike-parks.json", OUT), JSON.stringify({ v: 1, builtAt, places: merged }));
  const count = (f) => merged.filter(f).length;
  log(`${merged.length} bike places: ${count((x) => x.lift === "yes")} lift-served, ${count((x) => x.lift === "likely")} likely lift-served, ` +
    `${count((x) => x.k === "park" && !x.lift)} other bike parks, ${count((x) => x.k === "centre")} MTB centres, ${count((x) => x.k === "skills")} skills parks, ${count((x) => x.k === "pump")} pump or BMX tracks.`);
  const byProv = {};
  merged.forEach((x) => (byProv[x.p] = (byProv[x.p] || 0) + 1));
  log("By province:", JSON.stringify(byProv));
  merged.filter((x) => x.lift).forEach((x) => log(`  lift ${x.lift}: ${x.t.name || "(unnamed)"} [${x.p}]${x.also ? ` also ${x.also.join(", ")}` : ""}`));
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "ingest") await ingest(...args);
else if (cmd === "finish") finish();
else { console.error("Usage: build-bike-parks.mjs ingest <prov> <places.geojsonseq> <trails.geojsonseq> | finish"); process.exit(1); }
