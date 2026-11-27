// "At this spot": the shared part of a tapped point's card in every sport (alex 2026-11-17, "make it so we can click
// on the point and it shows detail. i like how skiing is" and "find useful information for each mode"). Each sport
// keeps its own card (Moto's gas and campsites, Hiking's huts and trailheads, MTB's trailheads and parking...) and
// adds this under its own facts:
//  - The weather at the point for 3 days: high, low, rain or snow, wind, from 3 forecast models checked against each
//    other (wxcheck.js: Environment Canada GEM, ECMWF, NOAA GFS, the middle value), at the point's own height.
//  - Sunrise and sunset there (the same call).
//  - In BC: a BC Wildfire Service fire ban or area restriction that covers the point, and wildfires still burning
//    within 30 km (DataBC, the open data behind BC Wildfire Service's map).
//  - BC recreation sites: the Recreation Sites and Trails BC record (what's there, access road, closures, the site's
//    own description) from DataBC.
// Every line names its source and says "estimate" where it is one (liability rule, alex 2026-11-11). Outside BC the
// fire lines are left out rather than guessed.
(() => {
  "use strict";
  if (window.tfPointInfo) return;
  const WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const timeout = (ms) => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
  const getJ = (url, ms = 12000) => fetch(url, { signal: timeout(ms) }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  // BC, roughly: the Alberta line follows the Rockies from 49° N, 114° W to 53.8° N, 120° W, then 120° W north to 60° N.
  const inBC = (lat, lon) => lat > 48.2 && lat < 60 && lon > -139.1 && lon < (lat < 53.8 ? -114.06 - (Math.max(lat, 49) - 49) * 1.2375 : -120);
  const km = (a, b) => {
    const R = 6371, r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const fmtKm = (k) => (k < 10 ? `${k.toFixed(1)} km` : `${Math.round(k)} km`);

  // Small styles of its own, on each sport's card colours (theme.css variables).
  const css = document.createElement("style");
  css.textContent = `
.pi { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.pi h4 { margin: 4px 0 0; font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted, #5c6862); }
.pi .pi-note { color: var(--muted, #5c6862); font-size: .76rem; margin: 0; line-height: 1.35; }
.pi .pi-note a { color: inherit; }
.pi .pi-days { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.pi .pi-days li { border: 1px solid var(--line, #dfe5e1); border-radius: 10px; padding: 6px 7px; display: flex; flex-direction: column; gap: 1px; font-size: .78rem; line-height: 1.3; min-width: 0; }
.pi .pi-days b { font-size: .8rem; }
.pi .pi-days .t { font-size: .95rem; font-weight: 700; }
.pi .pi-days small { color: var(--muted, #5c6862); font-size: .72rem; overflow-wrap: anywhere; }
.pi .pi-sun { display: flex; gap: 14px; font-size: .8rem; margin: 0; }
.pi .pi-sun svg { vertical-align: -3px; margin-right: 3px; }
.pi .pi-box { border-radius: 10px; padding: 7px 9px; font-size: .8rem; line-height: 1.35; background: color-mix(in srgb, #2b8a3e 9%, transparent); border-left: 3px solid #2b8a3e; }
.pi .pi-box.bad { background: color-mix(in srgb, #e03131 10%, transparent); border-left-color: #e03131; }
.pi .pi-box.warn { background: color-mix(in srgb, #f08c00 12%, transparent); border-left-color: #f08c00; }
.pi .pi-box a { color: inherit; }
.pi .pi-tags { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 0; list-style: none; }
.pi .pi-tags li { font-size: .74rem; border: 1px solid var(--line, #dfe5e1); border-radius: 999px; padding: 2px 8px; }
.pi details { border-top: 1px solid var(--line, #dfe5e1); padding-top: 5px; }
.pi details summary { cursor: pointer; font-weight: 700; font-size: .8rem; }
.pi details p { font-size: .8rem; line-height: 1.4; margin: 6px 0 0; white-space: pre-line; }
`;
  document.head.append(css);

  // Line icons (alex dislikes emoji in the interface).
  const SUNUP = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 4v4M9.5 6.5 12 4l2.5 2.5M4.9 11.9l1.4 1.4M19.1 11.9l-1.4 1.4"/></svg>';
  const SUNDN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 18h16M7 18a5 5 0 0 1 10 0M12 4v4M9.5 5.5 12 8l2.5-2.5M4.9 11.9l1.4 1.4M19.1 11.9l-1.4 1.4"/></svg>';

  // WMO weather codes in words (Open-Meteo).
  const WX = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow",
    75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorms", 96: "Thunderstorms, hail", 99: "Thunderstorms, hail" };
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hhmm = (iso) => {
    const m = /T(\d\d):(\d\d)/.exec(String(iso || ""));
    if (!m) return "";
    const h = +m[1];
    return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
  };

  // ---------- weather and sun at the point ----------
  const wxCache = new Map();   // "lat,lon,ele" -> { at, p }
  function weather(lat, lon, ele) {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)},${ele == null ? "" : Math.round(ele)}`, hit = wxCache.get(key);
    if (hit && Date.now() - hit.at < 30 * 60000) return hit.p;
    const q = new URLSearchParams({ latitude: lat.toFixed(4), longitude: lon.toFixed(4), timezone: "auto", forecast_days: "3",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset" });
    if (ele != null && isFinite(ele)) q.set("elevation", String(Math.round(ele)));
    const url = `https://api.open-meteo.com/v1/forecast?${q}`;
    const p = (window.tfWx ? window.tfWx.getChecked(url, 15000) : getJ(url)).catch((e) => { wxCache.delete(key); throw e; });
    wxCache.set(key, { at: Date.now(), p });
    return p;
  }
  function weatherHtml(w, opts) {
    const d = w && w.daily;
    if (!d || !Array.isArray(d.time) || !d.time.length) return "";
    const r = (v) => (v == null ? "" : Math.round(v));
    const days = d.time.slice(0, 3).map((t, i) => {
      const name = i === 0 ? "Today" : i === 1 ? "Tomorrow" : DAY[new Date(t + "T12:00:00Z").getUTCDay()];
      const rain = d.precipitation_sum && d.precipitation_sum[i], snow = d.snowfall_sum && d.snowfall_sum[i];
      const wet = snow >= 0.5 ? `${Math.round(snow)} cm snow` : rain >= 0.2 ? `${rain < 10 ? Math.round(rain * 10) / 10 : Math.round(rain)} mm rain` : "Little or no rain";
      const wind = d.wind_speed_10m_max && d.wind_speed_10m_max[i], gust = d.wind_gusts_10m_max && d.wind_gusts_10m_max[i];
      return `<li><b>${name}</b><span class="t">${r(d.temperature_2m_max[i])}° / ${r(d.temperature_2m_min[i])}°</span><small>${esc(WX[d.weather_code && d.weather_code[i]] || "")}</small><small>${esc(wet)}</small>${wind != null ? `<small>Wind ${r(wind)}${gust != null && gust > wind + 10 ? `, gusts ${r(gust)}` : ""} km/h</small>` : ""}</li>`;
    }).join("");
    const sun = d.sunrise && d.sunset && d.sunrise[0] ? `<p class="pi-sun"><span>${SUNUP}Sunrise ${esc(hhmm(d.sunrise[0]))}</span><span>${SUNDN}Sunset ${esc(hhmm(d.sunset[0]))}</span></p>` : "";
    const at = opts.ele != null && isFinite(opts.ele) ? ` at about ${Math.round(opts.ele).toLocaleString()} m above sea level` : "";
    return `<h4>Weather here</h4><ul class="pi-days">${days}</ul>${sun}
      <p class="pi-note">High / low, forecast for this point${at}, from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, local time. An estimate: conditions can be different on the ground.</p>${window.tfWx ? window.tfWx.noteHtml(w, { cls: "pi-note" }) : ""}`;
  }

  // ---------- BC fire bans and wildfires near the point ----------
  const wfs = (type, props, cql, count = 10) => `${WFS}?${new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: type, outputFormat: "application/json",
    srsName: "EPSG:4326", count: String(count), propertyName: props, CQL_FILTER: cql })}`;
  const fireCache = new Map();
  function fire(lat, lon) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`, hit = fireCache.get(key);
    if (hit && Date.now() - hit.at < 20 * 60000) return hit.p;
    const pt = `SRID=4326;POINT(${lon.toFixed(5)} ${lat.toFixed(5)})`;
    const p = Promise.all([
      getJ(wfs("pub:WHSE_LAND_AND_NATURAL_RESOURCE.PROT_BANS_AND_PROHIBITIONS_SP", "TYPE,CATEGORY,ACCESS_PROHIBITION_DESCRIPTION,ACCESS_STATUS_EFFECTIVE_DATE,FIRE_CENTRE_NAME,BULLETIN_URL", `INTERSECTS(SHAPE,${pt})`), 12000),
      getJ(wfs("pub:WHSE_LAND_AND_NATURAL_RESOURCE.PROT_CURRENT_FIRE_PNTS_SP", "INCIDENT_NAME,FIRE_NUMBER,FIRE_STATUS,CURRENT_SIZE,GEOGRAPHIC_DESCRIPTION,FIRE_URL,FIRE_OF_NOTE_IND,SHAPE", `FIRE_STATUS<>'Out' AND DWITHIN(SHAPE,${pt},30000,meters)`, 30), 12000),
    ]).then(([b, f]) => ({
      bans: (b.features || []).map((x) => x.properties),
      fires: (f.features || []).filter((x) => x.geometry).map((x) => ({ ...x.properties, d: km([lat, lon], [x.geometry.coordinates[1], x.geometry.coordinates[0]]) })).sort((a, c) => a.d - c.d),
    })).catch((e) => { fireCache.delete(key); throw e; });
    fireCache.set(key, { at: Date.now(), p });
    return p;
  }
  const BANS_URL = "https://www2.gov.bc.ca/gov/content/safety/wildfire-status/fire-bans-and-restrictions";
  const MAP_URL = "https://wildfiresituation.nrs.gov.bc.ca/map";
  function fireHtml(x, opts = {}) {
    const bans = x.bans.map((b) => {
      const what = [b.TYPE, b.CATEGORY].filter(Boolean).join(", ");
      return `<div class="pi-box bad"><b>${esc(what || "Fire ban or restriction")}</b> covers this spot${b.FIRE_CENTRE_NAME ? ` (${esc(b.FIRE_CENTRE_NAME)})` : ""}${b.ACCESS_STATUS_EFFECTIVE_DATE ? `, in effect from ${esc(String(b.ACCESS_STATUS_EFFECTIVE_DATE).slice(0, 10))}` : ""}.${b.ACCESS_PROHIBITION_DESCRIPTION ? `<br>${esc(String(b.ACCESS_PROHIBITION_DESCRIPTION).slice(0, 400))}` : ""}${b.BULLETIN_URL ? ` <a href="${esc(b.BULLETIN_URL)}" target="_blank" rel="noopener">Bulletin</a>` : ""}</div>`;
    }).join("");
    const fires = x.fires.slice(0, 4).map((f) => {
      const name = f.INCIDENT_NAME && f.INCIDENT_NAME !== f.FIRE_NUMBER ? f.INCIDENT_NAME : f.GEOGRAPHIC_DESCRIPTION || f.FIRE_NUMBER;
      const size = f.CURRENT_SIZE != null ? `${f.CURRENT_SIZE < 1 ? f.CURRENT_SIZE : Math.round(f.CURRENT_SIZE).toLocaleString()} ha` : "";
      return `<li>${f.FIRE_URL ? `<a href="${esc(f.FIRE_URL)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name)}: ${esc([String(f.FIRE_STATUS || "").toLowerCase(), size, `${fmtKm(f.d)} away`].filter(Boolean).join(", "))}</li>`;
    }).join("");
    const firesBox = x.fires.length
      ? `<div class="pi-box warn"><b>${x.fires.length === 1 ? "A wildfire" : `${x.fires.length} wildfires`} within 30 km</b><ul style="margin:4px 0 0;padding-left:18px">${fires}</ul></div>`
      : `<p class="pi-note">No wildfire still burning within 30 km on BC Wildfire Service's list.</p>`;
    return `${opts.head === false ? "" : "<h4>Fire</h4>"}${bans || `<p class="pi-note">No fire ban or area restriction from BC Wildfire Service covers this spot on their map right now.</p>`}${firesBox}
      <p class="pi-note">From BC Wildfire Service (DataBC), checked now. Their <a href="${BANS_URL}" target="_blank" rel="noopener">bans page</a> and <a href="${MAP_URL}" target="_blank" rel="noopener">wildfire map</a> are the final word; local parks and sites can have their own rules.</p>`;
  }

  // ---------- BC recreation sites: the full record ----------
  const recCache = new Map();
  function recSite(id) {
    id = String(id || "");
    if (!/^REC[0-9A-Z]+$/i.test(id)) return Promise.resolve(null);
    if (recCache.has(id)) return recCache.get(id);
    const props = ["PROJECT_NAME", "SITE_LOCATION", "NUM_CAMP_SITES", "MAINTAIN_STD_DESC", "DRIVING_DIRECTIONS", "CLOSURE_DESCRIPTION", "PROJECT_DESCRIPTION", "MORE_ACTIVITY_IND", "MORE_STRUCTURE_IND", "REC_DISTRICT_CODE_DESC",
      ...[1, 2, 3].flatMap((i) => [`ACTIVITY_DESC${i}`, `ACCESS_DESC${i}`, `SUB_ACCESS_DESC${i}`]), ...Array.from({ length: 10 }, (_, i) => `STRUCTURE_DESC${i + 1}`)].join(",");
    const p = getJ(`${WFS}?${new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: "pub:WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW", outputFormat: "application/json", count: "1",
      propertyName: props, CQL_FILTER: `FOREST_FILE_ID='${id.toUpperCase()}'` })}`, 12000)
      .then((j) => (j.features && j.features[0] ? j.features[0].properties : null)).catch(() => { recCache.delete(id); return null; });
    recCache.set(id, p);
    return p;
  }
  // The record's text has <br> and stray spaces: plain lines.
  const plain = (s) => String(s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n\n").trim();
  // "Toilet - Wood" -> "Toilet"; one tag per kind of thing.
  const STRUCT = [[/toilet/i, "Toilets"], [/table/i, "Picnic tables"], [/fire ring|fire pit/i, "Fire rings"], [/boat launch/i, "Boat launch"], [/dock|wharf|pier/i, "Dock"], [/shelter|cabin|hut/i, "Shelter"],
    [/tent pad/i, "Tent pads"], [/bear.*(cache|locker|box)|food cache/i, "Food cache"], [/water/i, "Water source"], [/kiosk|info/i, "Info kiosk"], [/corral|hitching/i, "Horse facilities"]];
  function recHtml(r, id) {
    if (!r) return "";
    const tags = new Set();
    for (let i = 1; i <= 10; i++) { const s = r[`STRUCTURE_DESC${i}`]; if (!s) continue; const m = STRUCT.find(([re]) => re.test(s)); if (m) tags.add(m[1]); }
    if (/wheelchair/i.test(Array.from({ length: 10 }, (_, i) => r[`STRUCTURE_DESC${i + 1}`] || "").join(" "))) tags.add("Wheelchair toilet");
    const acts = [1, 2, 3].map((i) => r[`ACTIVITY_DESC${i}`]).filter(Boolean);
    const access = [1, 2, 3].map((i) => [r[`ACCESS_DESC${i}`], r[`SUB_ACCESS_DESC${i}`]].filter(Boolean).join(" · ")).filter(Boolean);
    const closed = plain(r.CLOSURE_DESCRIPTION), desc = plain(r.PROJECT_DESCRIPTION), dir = plain(r.DRIVING_DIRECTIONS);
    const link = `https://www.sitesandtrailsbc.ca/search/search-result.aspx?site=${encodeURIComponent(id)}`;
    return `<h4>Recreation Sites and Trails BC</h4>
      ${closed ? `<div class="pi-box bad"><b>Closure on record</b><br>${esc(closed.slice(0, 400))}</div>` : ""}
      <ul class="pi-tags">${r.NUM_CAMP_SITES ? `<li>${r.NUM_CAMP_SITES} campsites</li>` : ""}${[...tags].map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      ${access.length ? `<p class="pi-note"><b>Access on record:</b> ${esc(access.join("; "))}</p>` : ""}
      ${r.MAINTAIN_STD_DESC ? `<p class="pi-note"><b>Upkeep:</b> ${esc(String(r.MAINTAIN_STD_DESC).toLowerCase())}</p>` : ""}
      ${acts.length ? `<p class="pi-note"><b>Activities:</b> ${esc(acts.join(", "))}${r.MORE_ACTIVITY_IND === "Y" ? " and more" : ""}</p>` : ""}
      ${desc ? `<details><summary>About the site</summary><p>${esc(desc.slice(0, 1200))}</p></details>` : ""}
      ${dir ? `<details><summary>Getting there, as the site record describes it</summary><p>${esc(dir.slice(0, 1200))}</p></details>` : ""}
      <p class="pi-note">From the province's recreation site record (DataBC, ${esc(id)}); roads and sites change. <a href="${link}" target="_blank" rel="noopener">The site's page</a> has fees, closures and updates.</p>`;
  }

  // ---------- the whole section ----------
  // fill(box, lat, lon, { ele, rec, fire: false, weather: false, isCurrent }) fills box with "At this spot" in parts as
  // each answer comes in. isCurrent() false (another point was tapped) stops it.
  async function fill(box, lat, lon, opts = {}) {
    if (!box) return;
    const ok = () => box.isConnected && (!opts.isCurrent || opts.isCurrent());
    box.classList.add("pi");
    box.innerHTML = `<div data-pi-rec></div><div data-pi-wx>${opts.weather === false ? "" : `<h4>Weather here</h4><p class="pi-note">Looking up the forecast for this point…</p>`}</div><div data-pi-fire></div>`;
    const part = (k) => box.querySelector(`[data-pi-${k}]`);
    const jobs = [];
    if (opts.rec) jobs.push(recSite(opts.rec).then((r) => { if (ok() && r) part("rec").innerHTML = recHtml(r, String(opts.rec).toUpperCase()); }));
    if (opts.weather !== false) {
      // Open-Meteo corrects for the ground's height at the point itself (its 90 m terrain), so the card doesn't wait
      // for a height of its own.
      jobs.push(weather(lat, lon, opts.ele).then((w) => { if (ok()) part("wx").innerHTML = weatherHtml(w, { ele: opts.ele != null ? opts.ele : w.elevation }) || ""; })
        .catch((e) => { if (ok()) part("wx").innerHTML = `<h4>Weather here</h4><p class="pi-note">Couldn't get the forecast right now (no signal or the weather service is busy).</p>`; }));
    }
    if (opts.fire !== false && inBC(lat, lon)) {
      jobs.push(fire(lat, lon).then((x) => { if (ok()) part("fire").innerHTML = fireHtml(x); })
        .catch(() => { if (ok()) part("fire").innerHTML = `<h4>Fire</h4><p class="pi-note">Couldn't check BC Wildfire Service right now. Their <a href="${BANS_URL}" target="_blank" rel="noopener">bans page</a> has the current rules.</p>`; }));
    }
    await Promise.all(jobs);
  }

  // Only the fire part, for a sport card that has its own weather (Fishing, Hunting): resolves to a one-line summary
  // ("Fire ban here", "1 wildfire within 30 km", "No ban or wildfire listed") or "" outside BC or with no answer.
  async function fireInto(box, lat, lon, opts = {}) {
    if (!box || !inBC(lat, lon)) return "";
    box.classList.add("pi");
    const x = await fire(lat, lon).catch(() => null);
    if (!x || (opts.isCurrent && !opts.isCurrent())) return "";
    box.innerHTML = fireHtml(x, { head: false });
    return x.bans.length ? "Fire ban or restriction here" : x.fires.length ? `${x.fires.length === 1 ? "A wildfire" : `${x.fires.length} wildfires`} within 30 km` : "No ban or wildfire listed";
  }

  window.tfPointInfo = { fill, fireInto, weather, weatherHtml, fire, fireHtml, recSite, recHtml, inBC };
})();
