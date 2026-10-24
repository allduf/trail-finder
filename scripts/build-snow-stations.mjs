// Snow stations job (run by .github/workflows/winter-data.yml with the avalanche forecasts, every 2 hours), for
// "Snow stations" in the site's Skiing mode: what the snow is really doing, measured, not modelled.
//
// Writes data/snow-stations.json: every active BC Automated Snow Weather Station (the BC River Forecast Centre's snow
// pillows, mostly high in the mountains), with its height and the latest hourly readings:
//  - sd: snow depth now (cm), sd24 / sd72: how much it changed in the last 24 / 72 hours (a rise is new snow,
//    a drop is settling or melt), days: the snow depth at the same hour on each of the last 7 days (oldest first)
//  - swe: snow water equivalent (mm), ta: air temperature now (°C), lo24 / hi24: the last 24 hours' low and high
//  - at: when the latest reading was taken
// Sources (Open Government Licence - British Columbia): station list from DataBC
// (WHSE_WATER_MANAGEMENT.SSL_SNOW_ASWS_STNS_SP), hourly readings from env.gov.bc.ca/wsd/data_searches/snow/asws/data/
// (SD snow depth, SW snow water, TA air temperature; each file has the water year so far, one column per station).
// A failed run keeps the last good file.
//
// Run: node scripts/build-snow-stations.mjs   (Node 18 or newer, no packages)

import { writeFileSync, mkdirSync } from "node:fs";

const OUT = new URL("../data/snow-stations.json", import.meta.url);
const UA = "trail-finder snow stations (https://github.com/allduf/trail-finder)";
const WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs?service=WFS&version=2.0.0&request=GetFeature&outputFormat=json&srsName=EPSG:4326"
  + "&typeName=WHSE_WATER_MANAGEMENT.SSL_SNOW_ASWS_STNS_SP";
const CSV = "https://www.env.gov.bc.ca/wsd/data_searches/snow/asws/data/";
const HOUR = 3600e3;

async function get(url, as = "text") {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
      if (r.ok) return as === "json" ? r.json() : r.text();
      console.log(`${url}: HTTP ${r.status}`);
    } catch (e) { console.log(`${url}: ${e.message}`); }
    await new Promise((ok) => setTimeout(ok, 3000 * (i + 1)));
  }
  throw new Error(`Couldn't get ${url}`);
}

const LIMITS = { SD: [-5, 1500], SW: [-5, 5000], TA: [-55, 45] };
// One CSV: { id: [[time ms, value], ...] } with empty cells left out. Column heads are "1C14P Bralorne".
async function series(code) {
  const lines = (await get(CSV + code + ".csv")).trim().split(/\r?\n/);
  const ids = lines[0].split(",").slice(1).map((h) => h.trim().split(" ")[0]);
  const out = Object.fromEntries(ids.map((id) => [id, []]));
  for (const line of lines.slice(1)) {
    const cells = line.split(","), t = Date.parse(cells[0].replace(" ", "T") + ":00Z");
    if (!t) continue;
    // Sensor errors come through as numbers like 99981 or -9999: keep only readings that can be real.
    cells.slice(1).forEach((c, i) => { if (c !== "" && ids[i] && !isNaN(+c) && +c > LIMITS[code][0] && +c < LIMITS[code][1]) out[ids[i]].push([t, +c]); });
  }
  return out;
}
// The reading nearest a time, within 3 hours.
const at = (s, t) => {
  let best = null;
  for (const p of s) if (Math.abs(p[0] - t) <= 3 * HOUR && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p;
  return best ? best[1] : null;
};
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

const fc = await get(WFS, "json");
const [SD, SW, TA] = await Promise.all(["SD", "SW", "TA"].map(series));
const stations = [];
for (const f of fc.features || []) {
  const p = f.properties || {}, id = p.LOCATION_ID;
  if (!id || (p.STATUS && !/active/i.test(p.STATUS))) continue;
  const [lon, lat] = f.geometry.coordinates;
  const sd = SD[id] || [], sw = SW[id] || [], ta = TA[id] || [];
  const last = [sd.at(-1), sw.at(-1), ta.at(-1)].filter(Boolean).reduce((a, b) => (b[0] > a[0] ? b : a), [0]);
  if (!last[0] || Date.now() - last[0] > 14 * 24 * HOUR) continue;   // no readings in the last 2 weeks: out of service
  const now = sd.at(-1), t = now ? now[0] : last[0];
  const day = ta.filter((x) => x[0] > ta.at(-1)?.[0] - 24 * HOUR).map((x) => x[1]);
  stations.push({
    id, name: p.LOCATION_NAME, lat: +lat.toFixed(5), lon: +lon.toFixed(5), ele: p.ELEVATION,
    at: new Date(last[0]).toISOString(),
    sd: now ? r1(now[1]) : null,
    sd24: now && at(sd, t - 24 * HOUR) != null ? r1(now[1] - at(sd, t - 24 * HOUR)) : null,
    sd72: now && at(sd, t - 72 * HOUR) != null ? r1(now[1] - at(sd, t - 72 * HOUR)) : null,
    days: now ? [6, 5, 4, 3, 2, 1, 0].map((d) => r1(at(sd, t - d * 24 * HOUR))) : [],
    swe: sw.length ? r1(sw.at(-1)[1]) : null,
    ta: ta.length ? r1(ta.at(-1)[1]) : null,
    lo24: day.length ? r1(Math.min(...day)) : null,
    hi24: day.length ? r1(Math.max(...day)) : null,
  });
}
if (stations.length < 20) throw new Error(`Only ${stations.length} stations: keeping the last file`);
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(OUT, JSON.stringify({ builtAt: new Date().toISOString(), source: "BC River Forecast Centre, Automated Snow Weather Stations", stations }));
console.log(`${stations.length} snow stations, ${stations.filter((s) => s.sd > 0).length} with snow`);
