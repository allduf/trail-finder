// Phone notifications. Run by .github/workflows/loam-push.yml a few times a day.
// Each phone that turned them on (notify.js) saved its push address and its 🔔 settings to the Supabase table
// push_subs (supabase/push.sql): { zones, loam, newt, since, ride }.
//  - loam: the trails in its regions (data/mtb-<zone>.json, the All trails list) and its To ride trails (ride) that just
//    turned prime loam (Loam index 40-59). Read the same way as the site: Open-Meteo soil moisture, one reading per
//    0.02° cell, at the middle of each trail's longest piece (tfZoneTrails in index.html). Region trails are grouped
//    by riding area (data/riding-areas.json), so a wet-to-prime day is one line per area, not hundreds of trails.
//  - newt: new trails mapped in its regions (data/new-trails.json), the same ones the 🔔 lists (MTB tagged or Looks
//    like MTB, classified by the site's own classify(), read from index.html).
// Each area or trail is sent once each time it turns prime, like the bell; again after it dries out or gets too wet.
//  - avy: avalanche danger (Skiing), as the bell's "Avalanche danger" list: the Avalanche Canada forecast areas over its
//    regions (data/avalanche.json) when their highest rating for today or tomorrow goes up to Considerable or more, and
//    the ski tours it watches (tours: { k, n, c: top, lo, hi, cls }) when their trip planner light (ski-terrain.js, the
//    Avaluator chart) goes to Extra caution or Not recommended. Sent each time it goes up; again after it comes down.
import webpush from "web-push";
import { readFileSync } from "node:fs";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fohdmserpbkurcvcrbbb.supabase.co";
const KEY = process.env.SUPABASE_SECRET_KEY;
const SITE = "https://allduf.github.io/trail-finder/";
const NEW_DAYS = 3;     // a new trail is sent if it showed up in the feed in the last 3 days (and after the phone signed up)
const AREA_KM = 10;     // a region trail belongs to the nearest riding area within 10 km, else to "Other trails in <region>"
if (!KEY) { console.log("No SUPABASE_SECRET_KEY secret yet: nothing to do."); process.exit(0); }

const root = new URL("../", import.meta.url);
await import(new URL("ski-terrain.js", root).href);
const TT = globalThis.tfTerrain;
const html = readFileSync(new URL("index.html", root), "utf8");
const readJson = (p) => { try { return JSON.parse(readFileSync(new URL(p, root), "utf8")); } catch { return null; } };
const ZONES = new Map([...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => [m[1], m[2]]));
const BOXES = [...html.matchAll(/\{ id: "(\w+)", name: "[^"]+", box: \[([^\]]+)\] \}/g)].map((m) => [m[1], m[2].split(",").map(Number)]);
if (ZONES.size < 2) throw new Error("Couldn't read the zones from index.html");

// New secret keys (sb_secret_...) go in the apikey header only; old service_role keys are JWTs and go in both.
const headers = { apikey: KEY, "Content-Type": "application/json", ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }) };
async function db(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${path.split("?")[0]}: HTTP ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// ---------- the site's push key pair: made once, then kept ----------
let [keys] = await db("push_keys?id=eq.1&select=public_key,private_key");
if (!keys) {
  const k = webpush.generateVAPIDKeys();
  await db("push_keys", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id: 1, public_key: k.publicKey, private_key: k.privateKey }) });
  [keys] = await db("push_keys?id=eq.1&select=public_key,private_key");
  console.log("Made the site's push keys.");
}
webpush.setVapidDetails(SITE, keys.public_key, keys.private_key);

const subs = await db("push_subs?select=id,sub,watch,sent,updated_at");
console.log(`${subs.length} phone(s) signed up.`);
// What each phone asked for (no addresses), so a quiet phone can be told apart from one with nothing picked.
subs.forEach((s, i) => { const w = s.watch || {}; console.log(`  phone ${i + 1}: regions ${JSON.stringify(w.zones || [])}, prime loam ${w.loam ? "on" : "off"}, new trails ${w.newt ? "on" : "off"}, avalanche ${w.avy ? `on, ${(w.tours || []).length} tour(s)` : "off"}, ${(w.ride || []).length} To ride trail(s), app v${w.v || "older than 257"}, ${Object.keys(s.sent || {}).length} already sent, saved ${s.updated_at}`); });
if (!subs.length) process.exit(0);
const zonesOf = (w) => ((w.zones || []).includes("all") ? [...ZONES.keys()] : (w.zones || []).filter((z) => ZONES.has(z)));

// ---------- region trails: named MTB trails per zone, one spot each (as tfZoneTrails in index.html) ----------
const areas = (readJson("data/riding-areas.json") || { areas: [] }).areas;
const km = (a, b) => { const dx = (a[1] - b[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180), dy = (a[0] - b[0]) * 110.57; return Math.hypot(dx, dy); };
function areaOf(c, zone) {
  let best = null, d = AREA_KM;
  areas.forEach((a) => { const k = km(c, a.c); if (k < d) { d = k; best = a.name; } });
  return best || `Other trails in ${ZONES.get(zone)}`;
}
const zoneTrails = new Map();
function trailsOf(zone) {
  if (zoneTrails.has(zone)) return zoneTrails.get(zone);
  const f = readJson(`data/mtb-${zone}.json`), by = new Map();
  Object.entries((f && f.ways) || {}).forEach(([id, w]) => {
    const name = w.tags.name || w.tags["tf:name"];
    if (!name || w.g.length < 4) return;
    let len = 0;
    for (let i = 2; i < w.g.length; i += 2) len += Math.abs(w.g[i] - w.g[i - 2]) + Math.abs(w.g[i + 1] - w.g[i - 1]);
    const g = by.get(name);
    if (!g) by.set(name, { name, len, w });
    else if (len > g.len) { g.len = len; g.w = w; }
  });
  const out = [...by.values()].map((g) => { const m = Math.floor(g.w.g.length / 4) * 2, c = [g.w.g[m], g.w.g[m + 1]]; return { name: g.name, c, area: areaOf(c, zone) }; });
  zoneTrails.set(zone, out);
  return out;
}

// ---------- the Loam index, as in index.html (lmiAt, cellOf, fetchLoamCells, loamTuneAt) ----------
const cellOf = (c) => `${(Math.round(c[0] * 50) / 50).toFixed(2)},${(Math.round(c[1] * 50) / 50).toFixed(2)}`;
// Tuned by rider reports per zone (data/loam-tune.json, scripts/build-loam-tune.mjs), as the site does.
const tune = readJson("data/loam-tune.json");
function shiftAt(key) {
  if (!tune || tune.v !== 1) return 0;
  const [lat, lon] = key.split(",").map(Number), z = BOXES.find(([, b]) => lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3]);
  const t = z ? tune.zones[z[0]] : tune.all;
  return (t && t.shift) || 0;
}
function lmiAt(h, i, key) {
  const a = h.soil_moisture_0_to_1cm[i], b = h.soil_moisture_1_to_3cm[i], c = h.soil_moisture_3_to_9cm[i];
  if (a == null || b == null || c == null) return null;
  const v = 0.5 * a + 0.3 * b + 0.2 * c;
  return Math.round(Math.max(0, Math.min(100, (v - 0.08) / (0.42 - 0.08) * 100 + shiftAt(key))));
}
const isPrime = (v) => v != null && v >= 40 && v < 60;
const rideOf = (w) => (w.ride || []).filter((t) => t && t.k && Array.isArray(t.c));

const cells = new Set();
subs.forEach(({ watch: w = {} }) => {
  if (!w.loam) return;
  zonesOf(w).forEach((z) => trailsOf(z).forEach((t) => cells.add(cellOf(t.c))));
  rideOf(w).forEach((t) => cells.add(cellOf(t.c)));
});
// Loam forecast, as in index.html: the 1 pm reading of each coming day; soon = the first prime one.
const dayName = (d, today) => {
  const n = Math.round((Date.parse(d) - Date.parse(today)) / 86400e3);
  return n === 1 ? "tomorrow" : new Date(d + "T12:00Z").toLocaleDateString("en-CA", { weekday: "long", timeZone: "UTC" });
};
const lmi = new Map(), soonOf = new Map(), cellList = [...cells];
for (let i = 0; i < cellList.length; i += 50) {
  const chunk = cellList.slice(i, i + 50), ll = chunk.map((k) => k.split(","));
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${ll.map((x) => x[0]).join(",")}&longitude=${ll.map((x) => x[1]).join(",")}` +
      "&timezone=auto&past_days=1&forecast_days=4&current=temperature_2m&hourly=soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm,snow_depth");
    if (!r.ok) throw new Error("HTTP " + r.status);
    const json = await r.json();
    (Array.isArray(json) ? json : [json]).forEach((w, k) => {
      let j = w.hourly.time.findIndex((x) => x > w.current.time) - 1;
      if (j < 0) j = w.hourly.time.length - 1;
      // Snow on the ground (5 cm or more, as on the site): the soil under it can read prime, but it isn't, so no reading.
      const snowy = (n) => (w.hourly.snow_depth && w.hourly.snow_depth[n]) >= 0.05;
      lmi.set(chunk[k], snowy(j) ? null : lmiAt(w.hourly, j, chunk[k]));
      const today = w.current.time.slice(0, 10), h = w.hourly;
      const i = h.time.findIndex((x, n) => x.slice(0, 10) > today && x.endsWith("T13:00") && !snowy(n) && isPrime(lmiAt(h, n, chunk[k])));
      if (i >= 0) soonOf.set(chunk[k], { d: h.time[i].slice(0, 10), day: dayName(h.time[i].slice(0, 10), today), v: lmiAt(h, i, chunk[k]) });
    });
  } catch (e) { console.log(`Open-Meteo, spots ${i}-${i + chunk.length}: ${e.message}`); }
}
console.log(`Loam read at ${lmi.size} of ${cellList.length} spots.`);

// ---------- new trails: the 🔔's list, classified with the site's own classify() ----------
const a = html.indexOf("// ---------- classification ----------"), b = html.indexOf("// Difficulty as Trailforks colours it");
if (a < 0 || b < a) throw new Error("Couldn't find classify() in index.html");
const { classify } = new Function("state", "esc", html.slice(a, b) + "\nreturn { classify };")({}, (s) => s);
const feed = ((readJson("data/new-trails.json") || {}).items || []).filter((it) => {
  if (Date.now() - Date.parse(it.at) > NEW_DAYS * 86400e3) return false;
  const c = classify(it.tags || {}, it.routes || [], it.routes && it.routes.length ? ["mtb"] : []);
  return c && (c.cat === "mtb" || c.cat === "looks") && c.use !== "hike";
});

// ---------- avalanche danger: today and tomorrow in each forecast area ----------
const avyData = readJson("data/avalanche.json");
const DANGER = ["No rating", "Low", "Moderate", "Considerable", "High", "Extreme"];
const BAND = { alp: "alpine", tln: "treeline", btl: "below treeline" };
const avyToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
const avyLive = (f) => f && f.days && !(f.validUntil && new Date(f.validUntil) < new Date());
const avySoon = (f) => f.days.filter((x) => x.date >= avyToday).slice(0, 2);
const avyDay = (x) => (x.date === avyToday ? "today" : x.label || x.date);
const avyAreas = ((avyData && avyData.areas) || []).filter((a) => avyLive(a.forecast)).map((a) => {
  let s = 90, w = 180, n = -90, e = -180;
  (a.rings || []).forEach((r) => { for (let i = 0; i < r.length; i += 2) { s = Math.min(s, r[i]); n = Math.max(n, r[i]); w = Math.min(w, r[i + 1]); e = Math.max(e, r[i + 1]); } });
  let best = null;
  for (const x of avySoon(a.forecast)) { const r = Math.max(x.alp || 0, x.tln || 0, x.btl || 0); if (!best || r > best.r) best = { r, x }; }
  return { a, box: [s, w, n, e], best };
});
console.log(`Avalanche forecasts: ${avyAreas.length} live area(s), ${avyAreas.filter((x) => x.best && x.best.r >= 3).length} at Considerable or more today or tomorrow.`);

// ---------- one notification per phone ----------
const range = (vs) => { const lo = Math.min(...vs), hi = Math.max(...vs); return lo === hi ? `Loam ${lo}` : `Loam ${lo} to ${hi}`; };
const list = (xs, n) => xs.slice(0, n).join(", ") + (xs.length > n ? ` and ${xs.length - n} more` : "");
let sent = 0, gone = 0;
for (const s of subs) {
  const w = s.watch || {}, was = s.sent || {}, now = {}, msgs = [];
  // Prime loam: areas of the picked regions and To ride trails.
  if (w.loam) {
    const prime = new Map();   // area key -> { name, vs }
    zonesOf(w).forEach((z) => trailsOf(z).forEach((t) => {
      const cell = cellOf(t.c), key = "a:" + t.area;
      if (!lmi.has(cell)) { if (was[key]) now[key] = 1; return; }   // no reading: leave it as it was
      const v = lmi.get(cell);
      if (!isPrime(v)) return;
      if (!prime.has(key)) prime.set(key, { name: t.area, vs: [] });
      prime.get(key).vs.push(v);
    }));
    const freshAreas = [];
    prime.forEach((p, k) => { now[k] = 1; if (!was[k]) freshAreas.push(p); });
    // Prime soon: areas with nothing prime now, and To ride trails, that turn prime in the next 3 days. Once per streak.
    const soon = new Map();   // "s:" key -> { name, d, day, vs }
    zonesOf(w).forEach((z) => trailsOf(z).forEach((t) => {
      const cell = cellOf(t.c), key = "s:a:" + t.area, f = soonOf.get(cell);
      if (prime.has("a:" + t.area)) return;
      if (!lmi.has(cell)) { if (was[key]) now[key] = 1; return; }
      if (!f || isPrime(lmi.get(cell))) return;
      const o = soon.get(key);
      if (!o || f.d < o.d) soon.set(key, { name: t.area, d: f.d, day: f.day, vs: [f.v] });
      else if (f.d === o.d) o.vs.push(f.v);
    }));
    rideOf(w).forEach((t) => {
      const cell = cellOf(t.c), key = "s:r:" + t.k, f = soonOf.get(cell);
      if (!lmi.has(cell)) { if (was[key]) now[key] = 1; return; }
      if (f && !isPrime(lmi.get(cell))) soon.set(key, { name: t.n, d: f.d, day: f.day, vs: [f.v], ride: true });
    });
    const freshSoon = [];
    soon.forEach((p, k) => { now[k] = 1; if (!was[k]) freshSoon.push({ ...p, key: k }); });
    const freshRide = [];
    rideOf(w).forEach((t) => {
      const cell = cellOf(t.c), key = "r:" + t.k;
      if (!lmi.has(cell)) { if (was[key]) now[key] = 1; return; }
      const v = lmi.get(cell);
      if (!isPrime(v)) return;
      now[key] = 1;
      if (!was[key]) freshRide.push({ ...t, v });
    });
    freshAreas.sort((x, y) => y.vs.length - x.vs.length || x.name.localeCompare(y.name));
    const lines = freshRide.map((t) => `${t.n} (To ride, Loam ${t.v})`).concat(freshAreas.map((p) => `${p.name}: ${p.vs.length} trail${p.vs.length > 1 ? "s" : ""}, ${range(p.vs)}`));
    if (lines.length) {
      const names = freshRide.map((t) => t.n).concat(freshAreas.map((p) => p.name));
      msgs.push({ title: `Prime loam: ${list(names, 2)}`, body: lines.slice(0, 5).join("\n") + (lines.length > 5 ? `\nand ${lines.length - 5} more` : ""), keys: freshRide.map((t) => "r:" + t.k).concat([...prime.keys()].filter((k) => !was[k])) });
    }
    if (freshSoon.length) {
      freshSoon.sort((x, y) => x.d.localeCompare(y.d) || (y.ride ? 1 : 0) - (x.ride ? 1 : 0) || y.vs.length - x.vs.length);
      const lines = freshSoon.map((p) => p.ride ? `${p.name} (To ride): ${p.day}, Loam ${p.vs[0]}` : `${p.name}: ${p.day}, ${p.vs.length} trail${p.vs.length > 1 ? "s" : ""}, ${range(p.vs)}`);
      msgs.push({ title: `Prime loam ${freshSoon[0].day}: ${list(freshSoon.filter((p) => p.d === freshSoon[0].d).map((p) => p.name), 2)}`,
        body: lines.slice(0, 5).join("\n") + (lines.length > 5 ? `\nand ${lines.length - 5} more` : ""), keys: freshSoon.map((p) => p.key) });
    }
  }
  // New trails in the picked regions.
  if (w.newt) {
    const zones = new Set(zonesOf(w)), since = w.since || "";
    Object.keys(was).forEach((k) => { if (k.startsWith("n:")) now[k] = was[k]; });
    const fresh = feed.filter((it) => zones.has(it.z) && it.at > since && !was["n:" + it.ids[0]]);
    fresh.forEach((it) => { now["n:" + it.ids[0]] = Date.parse(it.at); });
    if (fresh.length) {
      // Named trails first, then the unnamed ones counted per region.
      const unnamed = (xs) => {
        const named = xs.filter((it) => it.name).map((it) => `${it.name} (${ZONES.get(it.z)})`), per = new Map();
        xs.filter((it) => !it.name).forEach((it) => per.set(it.z, (per.get(it.z) || 0) + 1));
        return [list(named, 4), ...[...per].map(([z, n]) => `${n} unnamed in ${ZONES.get(z)}`)].filter(Boolean).join("; ");
      };
      msgs.push({ title: fresh.length === 1 ? `New trail: ${fresh[0].name || "Unnamed trail"}` : `${fresh.length} new trails`,
        body: fresh.length === 1 ? `Just mapped in ${ZONES.get(fresh[0].z)}${fresh[0].u ? ` by ${fresh[0].u}` : ""}.` : unnamed(fresh),
        keys: fresh.map((it) => "n:" + it.ids[0]) });
    }
    // Forget new trails that left the feed window, so the row doesn't grow forever.
    Object.keys(now).forEach((k) => { if (k.startsWith("n:") && Date.now() - now[k] > (NEW_DAYS + 1) * 86400e3) delete now[k]; });
  }
  // Avalanche danger up in its regions, or on the tours it watches.
  if (w.avy && avyAreas.length) {
    const lines = [], names = [], keys = [];
    const zb = zonesOf(w).map((z) => BOXES.find(([id]) => id === z)?.[1]).filter(Boolean);
    for (const { a, box: b, best } of avyAreas) {
      if (!best || best.r < 3 || !zb.some((z) => z[0] <= b[2] && z[2] >= b[0] && z[1] <= b[3] && z[3] >= b[1])) continue;
      const key = "v:" + a.id;
      now[key] = best.r;
      if (best.r > (was[key] || 0)) { const nm = a.forecast.title || a.name; names.push(nm); lines.push(`${nm}: ${DANGER[best.r]} ${avyDay(best.x)}`); keys.push(key); }
    }
    for (const t of (w.tours || []).filter((t) => t && t.k && Array.isArray(t.c))) {
      const a = TT.areaAt(avyAreas.map((x) => x.a), t.c[0], t.c[1]);
      if (!a) continue;
      let best = null;
      for (const x of avySoon(a.forecast)) { const dg = TT.dangerIn(x, TT.bandsFor(a.name), t.lo, t.hi), l = TT.light(dg.r, t.cls); if (l >= 0 && (!best || l > best.l)) best = { l, x, dg }; }
      if (!best || best.l < 1) continue;
      const key = "t:" + t.k;
      now[key] = best.l;
      if (best.l > (was[key] || 0)) { names.unshift(t.n); lines.unshift(`${t.n}: ${TT.LIGHTS[best.l].label} ${avyDay(best.x)} (${DANGER[best.dg.r]} in the ${BAND[best.dg.band]})`); keys.push(key); }
    }
    if (lines.length) msgs.unshift({ title: `⚠ Avalanche danger up: ${list(names, 2)}`, body: lines.slice(0, 5).join("\n") + (lines.length > 5 ? `\nand ${lines.length - 5} more` : "") + "\nRead the full forecast before you go.", keys });
  } else if (w.avy) Object.keys(was).forEach((k) => { if (/^[vt]:/.test(k)) now[k] = was[k]; });   // no forecasts read: leave them as they were
  let expired = false;
  for (const m of msgs) {
    try {
      await webpush.sendNotification(s.sub, JSON.stringify({ title: m.title, body: m.body, url: "./#notify", tag: m.keys[0].startsWith("n:") ? "tf-new" : /^[vt]:/.test(m.keys[0]) ? "tf-avy" : m.keys[0].startsWith("s:") ? "tf-loam-soon" : "tf-loam" }), { TTL: 6 * 3600, urgency: "normal" });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { expired = true; break; }   // turned off on the phone, or the address expired
      console.log(`Push failed (HTTP ${e.statusCode || "?"}): ${e.body || e.message}`);
      m.keys.forEach((k) => { delete now[k]; });   // try again next run
    }
  }
  if (expired) { await db(`push_subs?id=eq.${s.id}`, { method: "DELETE" }); gone++; continue; }
  if (JSON.stringify(now) !== JSON.stringify(was)) await db(`push_subs?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ sent: now }) });
}
console.log(`Sent ${sent} notification(s); removed ${gone} expired phone(s).`);
