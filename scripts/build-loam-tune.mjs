// Loam tuned by rider reports. Run every night by .github/workflows/loam-tune.yml; writes data/loam-tune.json.
// Riders post "Dry", "Tacky, loamy" or "Muddy" on a trail (reports.js, Supabase table trail_reports). For each report
// this reads the Loam index the app would have shown at that spot at that hour (Open-Meteo soil moisture, the same
// 0.02° cell as cellOf() in index.html), then finds, per zone, how far the model's number is off from what riders felt:
//   Dry          should read under 20 (Dry and dusty)
//   Tacky, loamy should read 20 to 59 (Tacky or Damp, prime loam)
//   Muddy        should read 60 or more (Wet and muddy, Saturated)
// The shift is the smallest move (-25 to +25) that puts the most reports in their band. With few reports it leans on
// the region's shift, and the region leans on the whole area's, and that on 0 (no change), so one odd report can't
// swing a zone. index.html adds the zone's shift to every Loam reading there (lmiAt), so the bands stay 40-59 = prime
// everywhere and every list, pin, alert and trail shows the same tuned number. scripts/push-loam.mjs reads it too.
import { readFileSync, writeFileSync } from "node:fs";

const SUPABASE_URL = "https://fohdmserpbkurcvcrbbb.supabase.co";
const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
// Reports are public (anyone can read them), so the site's own public key reads them.
const KEY = process.env.SUPABASE_SECRET_KEY || readFileSync(new URL("account.js", root), "utf8").match(/SUPABASE_ANON_KEY = "([^"]+)"/)[1];

const DAYS = 730;          // reports from the last two years
const LEAN = 8;            // a zone with 8 reports counts half its own fit, half its region's
const MAX = 25;            // never move the number more than this
const BAND = { dry: [0, 19], tacky: [20, 59], muddy: [60, 100] };

const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
const alberta = JSON.parse(html.match(/const ALBERTA_ZONES = (\[[^\]]+\])/)[1]);
const REGIONS = [...html.matchAll(/\{ id: "(\w+)", name: "[^"]+", short: "[^"]+", ids: (\[[^\]]+\]|ALBERTA_ZONES) \}/g)]
  .map((m) => ({ id: m[1], ids: m[2] === "ALBERTA_ZONES" ? alberta : JSON.parse(m[2]) }));
if (ZONES.length < 2 || REGIONS.length < 2) throw new Error("Couldn't read the zones and regions from index.html");
const zoneAt = (lat, lon) => ZONES.find((z) => lat >= z.box[0] && lat <= z.box[2] && lon >= z.box[1] && lon <= z.box[3]);
const regionOf = (zone) => REGIONS.find((r) => r.ids.includes(zone));

// ---------- the reports ----------
const headers = { apikey: KEY, ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }) };
const since = new Date(Date.now() - DAYS * 864e5).toISOString();
const res = await fetch(`${SUPABASE_URL}/rest/v1/trail_reports?select=user_id,lat,lon,condition,note,created_at&condition=in.(dry,tacky,muddy)&created_at=gte.${since}&order=created_at`, { headers });
if (!res.ok) throw new Error(`Supabase trail_reports: HTTP ${res.status} ${await res.text()}`);
const cellOf = (lat, lon) => `${(Math.round(lat * 50) / 50).toFixed(2)},${(Math.round(lon * 50) / 50).toFixed(2)}`;
const seen = new Set(), reports = [];
for (const r of await res.json()) {
  // Posted later from a phone with no signal ("(from Oct 3, 4:10 pm) ..."): the hour it was ridden isn't known for sure.
  if (r.note && r.note.startsWith("(from ")) continue;
  const cell = cellOf(r.lat, r.lon), hour = r.created_at.slice(0, 13) + ":00";
  // One report per rider, spot and day, so posting on five trails of one ride counts once.
  const once = `${r.user_id} ${cell} ${hour.slice(0, 10)}`;
  if (seen.has(once)) continue;
  seen.add(once);
  const z = zoneAt(r.lat, r.lon);
  reports.push({ cell, hour, c: r.condition, zone: z && z.id, region: z && regionOf(z.id) && regionOf(z.id).id });
}
console.log(`${reports.length} dry, tacky or muddy report(s) to compare.`);

// ---------- the Loam index at each report's spot and hour (lmiAt in index.html, before tuning) ----------
// Each soil's own scale (soilScale and soilAt in index.html; data/loam-soil.json from scripts/build-loam-soil.py).
const SOILS = { 3: [0.042, 0.196, 0.364], 4: [0.1, 0.26, 0.445], 5: [0.11, 0.34, 0.455], 6: [0.185, 0.37, 0.475], 7: [0.257, 0.463, 0.507], 8: [0.265, 0.763, 0.863] };
function soilScale(v, soil) {
  const [pwp, fc, full] = SOILS[soil] || SOILS[4], dry = pwp - 0.125 * (fc - pwp), wet = fc + 0.865 * (full - fc);
  return v < fc ? (v - dry) / (fc - dry) * 53 : 53 + (v - fc) / (wet - fc) * 47;
}
const loamSoil = (() => { try { return JSON.parse(readFileSync(new URL("data/loam-soil.json", root), "utf8")); } catch { return null; } })();
const soilAt = (key) => {
  if (!loamSoil || loamSoil.v !== 1 || !key) return 4;
  const [lat, lon] = key.split(",").map(Number), row = loamSoil.rows[Math.round((lat - loamSoil.lat0) / loamSoil.step)];
  return (row && +row[Math.round((lon - loamSoil.lon0) / loamSoil.step)]) || 4;
};
function lmiAt(h, i, key) {
  const a = h.soil_moisture_0_to_1cm[i], b = h.soil_moisture_1_to_3cm[i], c = h.soil_moisture_3_to_9cm[i];
  if (a == null || b == null || c == null) return null;
  const v = 0.5 * a + 0.3 * b + 0.2 * c;
  return Math.round(Math.max(0, Math.min(100, soilScale(v, soilAt(key)))));
}
const SOIL = "&hourly=soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm&timezone=GMT";
const byCell = new Map();
reports.forEach((r) => { if (!byCell.has(r.cell)) byCell.set(r.cell, []); byCell.get(r.cell).push(r); });
const day = (d) => d.toISOString().slice(0, 10);
for (const [cell, list] of byCell) {
  const [lat, lon] = cell.split(","), first = list[0].hour.slice(0, 10), last = list[list.length - 1].hour.slice(0, 10);
  // The model's archive of past forecasts (the same model the app reads), then the last 3 months of the live
  // forecast for the newest hours the archive doesn't have yet.
  const urls = [`https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&start_date=${first}&end_date=${last > day(new Date()) ? day(new Date()) : last}${SOIL}`];
  if (Date.now() - Date.parse(last) < 90 * 864e5) urls.push(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&past_days=92&forecast_days=1${SOIL}`);
  for (const url of urls) {
    if (list.every((r) => r.v != null)) break;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
      const h = (await r.json()).hourly, at = new Map(h.time.map((t, i) => [t, i]));
      list.forEach((x) => { if (x.v == null && at.has(x.hour)) x.v = lmiAt(h, at.get(x.hour), cell); });
    } catch (e) { console.log(`Open-Meteo at ${cell}: ${e.message}`); }
    await new Promise((ok) => setTimeout(ok, 400));
  }
}
const read = reports.filter((r) => r.v != null);
read.forEach((r) => console.log(`  ${r.hour} ${r.cell} ${r.zone || "-"}: rider said ${r.c}, Loam index ${r.v}`));
console.log(`Loam index read for ${read.length} of ${reports.length}.`);

// ---------- the shift per zone ----------
// How far each report is from its band after a shift; the best shift has the least in total, the smallest move on a tie.
const miss = (list, s) => list.reduce((a, r) => { const v = Math.max(0, Math.min(100, r.v + s)), [lo, hi] = BAND[r.c]; return a + Math.max(0, lo - v, v - hi); }, 0);
function fit(list, lean) {
  const n = list.length;
  if (!n) return { shift: lean, n: 0 };
  let best = 0, bestMiss = Infinity;
  for (let s = 0; s <= MAX; s++) for (const t of s ? [s, -s] : [0]) { const m = miss(list, t); if (m < bestMiss) { bestMiss = m; best = t; } }
  const inBand = (s) => list.filter((r) => miss([r], s) === 0).length;
  const shift = Math.round((n * best + LEAN * lean) / (n + LEAN));
  const count = (c) => list.filter((r) => r.c === c).length;
  return { shift, n, own: best, inBandBefore: inBand(0), inBandAfter: inBand(shift), dry: count("dry"), tacky: count("tacky"), muddy: count("muddy") };
}
const all = fit(read, 0), regions = {}, zones = {};
REGIONS.forEach((g) => { regions[g.id] = fit(read.filter((r) => r.region === g.id), all.shift); });
ZONES.forEach((z) => {
  const g = regionOf(z.id);
  zones[z.id] = fit(read.filter((r) => r.zone === z.id), g ? regions[g.id].shift : all.shift);
});
Object.entries(zones).filter(([, z]) => z.n || z.shift).forEach(([id, z]) => console.log(`  ${id}: shift ${z.shift > 0 ? "+" : ""}${z.shift} from ${z.n} report(s)` +
  (z.n ? ` (own fit ${z.own}, in band ${z.inBandBefore} before, ${z.inBandAfter} after)` : " (from its region)")));

const out = { v: 1, builtAt: new Date().toISOString(), reports: read.length, bands: BAND, all, regions, zones };
writeFileSync(new URL("data/loam-tune.json", root), JSON.stringify(out, null, 1) + "\n");
console.log(`Whole area: shift ${all.shift} from ${all.n} report(s). Wrote data/loam-tune.json.`);
