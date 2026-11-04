// Builds data/on-logging.json: where Ontario's official forest management data says logging is planned this year
// (Annual Work Schedules, "Scheduled Harvest") and where it was done (Annual Reports, "Harvest Operations"), one entry
// per forest management unit, for the "Logging areas" layer (index.html, onLogging). Ontario publishes each unit's
// schedule as its own ArcGIS feature service (owner NRIP_Forestry_Viewer, Open Government Licence - Ontario); the app
// asks those services for the blocks in view, so this file only says which service covers which box.
// Hand-run (new schedules come out each April for the year from April 1, annual reports about a year and a half late):
//   NODE_USE_ENV_PROXY=1 node scripts/build-on-logging.mjs
import fs from "node:fs";

const SEARCH = "https://www.arcgis.com/sharing/rest/search";
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };

const items = [];
for (let start = 1; start > 0;) {
  const q = new URLSearchParams({ q: 'owner:NRIP_Forestry_Viewer type:"Feature Service"', num: "100", start: String(start), f: "json" });
  const d = await get(`${SEARCH}?${q}`);
  items.push(...d.results);
  start = d.nextStart;
}
// "<Unit>_<year>_AWS_<plan> View" or "<Unit>_<year>_AR_<plan>"; the French copies say French and are the same blocks.
const best = new Map();
for (const it of items) {
  const m = /^(.+?)_(\d{4})_(AWS|AR)_\d+/.exec(it.title);
  if (!m || /french/i.test(it.title) || !it.url) continue;
  const [, unit, yr, kind] = m, k = `${unit}/${kind}`, old = best.get(k);
  // The newest year; for the same year the "View" (the public copy) first.
  if (!old || +yr > old.yr || (+yr === old.yr && / View$/.test(it.title) && !/ View$/.test(old.title))) best.set(k, { unit, yr: +yr, kind, url: it.url, title: it.title });
}
const toLL = (x, y) => [(Math.atan(Math.exp((y / 6378137))) * 360) / Math.PI - 90, (x / 6378137) * 180 / Math.PI];
const units = [];
for (const u of [...best.values()].sort((a, b) => a.unit.localeCompare(b.unit) || a.kind.localeCompare(b.kind))) {
  const d = await get(`${u.url}/layers?f=json`);
  const l = (d.layers || []).find((x) => (u.kind === "AWS" ? /^Scheduled Harvest/i : /^Harvest Operations/i).test(x.name));
  if (!l || !l.extent || !isFinite(l.extent.xmin)) { console.log("no harvest layer", u.title); continue; }
  const [s, w] = toLL(l.extent.xmin, l.extent.ymin), [n, e] = toLL(l.extent.xmax, l.extent.ymax);
  units.push({ n: u.unit.replace(/_/g, " "), k: u.kind === "AWS" ? "plan" : "done", yr: u.yr, url: `${u.url}/${l.id}`, b: [s, w, n, e].map((v) => +v.toFixed(3)) });
  console.log(u.kind, u.yr, u.unit, "layer", l.id);
}
const out = {
  note: "Ontario forest management units with their newest official harvest data: k plan = Annual Work Schedule (Scheduled Harvest, for the year from April 1 of yr), k done = Annual Report (Harvest Operations done in the year from April 1 of yr). url is the ArcGIS feature layer the app asks for the blocks in view; b is its box [south, west, north, east]. Built by scripts/build-on-logging.mjs. Ontario Ministry of Natural Resources, Open Government Licence - Ontario.",
  builtAt: new Date().toISOString(),
  units,
};
fs.writeFileSync(new URL("../data/on-logging.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
console.log("wrote data/on-logging.json", units.length, "units");
