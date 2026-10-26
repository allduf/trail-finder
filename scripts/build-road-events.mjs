// Road events job (run by .github/workflows/road-events.yml every 15 minutes), for Adventure moto's Plan a route.
//
// What closes or slows a highway in the provinces whose 511 sites the browser can't read (no CORS header): Alberta 511,
// Saskatchewan's Highway Hotline, Manitoba 511, Ontario 511, New Brunswick 511, Nova Scotia 511, PEI 511,
// Newfoundland and Labrador 511 and Yukon 511. They all run on the same 511 platform: /map/mapIcons/<layer> gives each
// event's spot, /List/GetData/<layer> its road, text and whether every lane is closed. BC (DriveBC Open511) and Quebec
// (Québec 511 on the ministry's WFS) are read live by the browser, so they aren't here.
//
// Writes road-events.json to the Supabase Storage bucket "live" (public), so the site reads it right away without
// republishing the website every 15 minutes; also to data/road-events.json for testing.
//   { v, built, ok: {ab: n, ...}, failed: [...], ev: [[lat, lon, prov, kind, closed, road, text, updated], ...] }
// kind: closure / incident / work / weather / event. closed: 1 = every lane closed, 2 = only a ramp or exit is closed,
// 3 = closed at set times only (nightly roadwork), 0 = open (lanes, speed, delays).
//
// Run: node scripts/build-road-events.mjs   (Node 18 or newer, no packages)
//   SUPABASE_SECRET_KEY=...   upload (without it the file is only written locally)   UPLOAD_AS=name.json   test name

import { writeFileSync, mkdirSync } from "node:fs";

const SUPABASE_URL = "https://fohdmserpbkurcvcrbbb.supabase.co";
const KEY = process.env.SUPABASE_SECRET_KEY;
const UA = "trail-finder road events (https://github.com/allduf/trail-finder)";
const SITES = {
  ab: "https://511.alberta.ca", sk: "https://hotline.gov.sk.ca", mb: "https://www.manitoba511.ca", on: "https://511on.ca",
  nb: "https://511.gnb.ca", ns: "https://511.novascotia.ca", pe: "https://511.gov.pe.ca", nl: "https://511nl.ca", yt: "https://511yukon.ca",
};
// The layers that say something about driving a road now (not cameras, rest areas, future roadwork...).
const WANT = /^(Closures|IncidentClosures|SubIncidentClosures|ConstructionClosures|SubCurrentRoadworkClosure|Incidents|Construction|CurrentRoadwork|WeatherIncidents|SpecialEvents|MajorEvents)$/;
const KIND = (l) => /Closure/.test(l) ? "closure" : /Incident/.test(l) && !/Weather/.test(l) ? "incident" : /Weather/.test(l) ? "weather" : /Event/.test(l) ? "event" : "work";

async function get(url, json = true) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: json ? "application/json" : "text/html" }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return json ? r.json() : r.text();
      console.log(`${url}: HTTP ${r.status}`);
      if (r.status === 404) return null;
    } catch (e) { console.log(`${url}: ${e.message}`); }
    await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)));
  }
  throw new Error(`Couldn't read ${url}`);
}
const text = (h) => String(h || "").replace(/<div class='cellSpacer'>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const RAMP = /\b(on-?ramp|off-?ramp|ramp|exit|interchange|collector|transfer|bretelle|sortie)\b/i;

// Each site also shows its neighbours' events (511 Yukon has all of DriveBC): keep the province's own.
const AB = (la, lo) => la > 48.9 && la < 60.1 && lo <= -109.9 && lo > -120.1 && (la >= 53.8 || lo > -114.07 - (la - 49) * 0.7);
const IN = {
  ab: AB, sk: (la, lo) => la > 48.9 && la < 60.1 && lo > -110.1 && lo < -101.3, mb: (la, lo) => la > 48.9 && la < 60.1 && lo > -102.1 && lo < -88.9,
  on: (la, lo) => la > 41.6 && la < 57 && lo > -95.2 && lo < -74.3, nb: (la, lo) => la > 44.5 && la < 48.1 && lo > -69.1 && lo < -63.7,
  ns: (la, lo) => la > 43.3 && la < 47.1 && lo > -66.5 && lo < -59.6, pe: (la, lo) => la > 45.9 && la < 47.1 && lo > -64.5 && lo < -61.9,
  nl: (la, lo) => la > 46.5 && la < 60.5 && lo > -67.9 && lo < -52.5, yt: (la, lo) => la > 59.9 && la < 69.7 && lo < -123.7 && lo > -141.1,
};
async function site(prov, base) {
  const page = await get(`${base}/map`, false);
  const layers = [...new Set([...String(page || "").matchAll(/data-layerid="([^"]+)"/g)].map((m) => m[1]))].filter((l) => WANT.test(l));
  const out = [];
  for (const layer of layers) {
    const icons = await get(`${base}/map/mapIcons/${layer}`).catch(() => null);
    const spots = new Map(((icons && icons.item2) || []).map((x) => [String(x.itemId), x.location]));
    if (!spots.size) continue;
    const q = encodeURIComponent(JSON.stringify({ columns: [], start: 0, length: 2000 }));
    const list = await get(`${base}/List/GetData/${layer}?query=${q}&lang=en`).catch(() => null);
    const rows = new Map(((list && list.data) || []).map((r) => [String(r.id), r]));
    for (const [id, at] of spots) {
      const r = rows.get(id);
      if (!r || !at || r.showOnMap === false || !IN[prov](at[0], at[1])) continue;
      const desc = text(r.description || r.comment || "");
      const lanes = `${r.laneDescription || ""} ${desc}`;
      const all = r.isFullClosure === true || /all lanes (are )?closed|road (is )?closed|closed to (all )?traffic|highway (is )?closed/i.test(lanes);
      // "Road Closed" next to "on site detour" or "one-lane alternating traffic" still lets you through.
      const closed = !all || /single lane|alternating|one lane|lane closed\b|reduced/i.test(r.laneDescription || "") || /on.?site detour|one\s*-?\s*lane (alt|traffic)|alternating traffic|single.?lane|lane direction reversal/i.test(desc) ? 0
        : RAMP.test(`${r.roadwayName || ""} ${desc.slice(0, 120)}`) ? 2 : /\d:\d\d\s*[AP]M/i.test(r.recurrenceDescription || "") || /\b(daily|nightly|overnight|night-?time)\b/i.test(desc.slice(0, 80)) ? 3 : 1;
      out.push([+at[0].toFixed(5), +at[1].toFixed(5), prov, KIND(layer), closed, text(r.roadwayName).slice(0, 60), desc.slice(0, 240), r.lastUpdated || ""]);
    }
  }
  return out;
}

const ok = {}, failed = [], ev = [];
for (const [prov, base] of Object.entries(SITES)) {
  try { const list = await site(prov, base); ok[prov] = list.length; ev.push(...list); console.log(`${prov}: ${list.length} events, ${list.filter((e) => e[4] === 1).length} closed`); }
  catch (e) { failed.push(prov); console.log(`${prov}: failed (${e.message})`); }
}
// Same spot and text twice (an event listed in two layers): keep one, the closed one first.
const seen = new Set(), keep = [];
ev.sort((a, b) => b[4] - a[4]).forEach((e) => { const k = `${e[0].toFixed(3)},${e[1].toFixed(3)},${e[6].slice(0, 60)}`; if (!seen.has(k)) { seen.add(k); keep.push(e); } });
const body = JSON.stringify({ v: 1, built: new Date().toISOString(), ok, failed, ev: keep });
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../data/road-events.json", import.meta.url), body);
console.log(`${keep.length} events, ${(body.length / 1024).toFixed(0)} KB${failed.length ? `; failed: ${failed.join(", ")}` : ""}`);
if (Object.keys(ok).length < 3) { console.log("Fewer than 3 provinces read: not uploading (the last good file stays)."); process.exit(1); }

if (!KEY) { console.log("No SUPABASE_SECRET_KEY: not uploaded."); process.exit(0); }
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
// The public bucket, made on the first run.
const b = await fetch(`${SUPABASE_URL}/storage/v1/bucket/live`, { headers });
if (!b.ok) {
  const mk = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: "live", name: "live", public: true, file_size_limit: 5242880, allowed_mime_types: ["application/json"] }) });
  console.log(`Made the "live" bucket: HTTP ${mk.status} ${mk.ok ? "" : await mk.text()}`);
}
const name = process.env.UPLOAD_AS || "road-events.json";
const up = await fetch(`${SUPABASE_URL}/storage/v1/object/live/${name}`, { method: "POST",
  headers: { ...headers, "Content-Type": "application/json", "x-upsert": "true", "cache-control": "max-age=120" }, body });
if (!up.ok) throw new Error(`Upload: HTTP ${up.status} ${await up.text()}`);
console.log(`Uploaded: ${SUPABASE_URL}/storage/v1/object/public/live/${name}`);
