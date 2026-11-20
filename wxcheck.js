// Weather forecasts checked against each other (alex 2026-11-14: "can you always double check the weather forcast
// with other source to make it as accurate as possible").
// Every weather card asks Open-Meteo for three separate forecast models in the same call, instead of Open-Meteo's
// automatic pick: Environment Canada's GEM (HRDPS 2.5 km for 2 days, then the regional and global GEM), ECMWF (the
// European centre's IFS) and NOAA's GFS (with HRRR near the border). The value shown is the middle one of the three
// (the median), hour by hour and day by day, so one model's odd number can't carry the card on its own. Where the
// three are far apart, the card says so, with the low and high value.
// Why: at Whistler (1,800 m, 2026-11-14) the automatic pick was GFS, and it gave 15 mm and wind to 35 km/h for Monday
// when Environment Canada said 3.8 mm and 7 km/h and ECMWF 2.5 mm and 6 km/h. The snow line in Skiing still follows
// Environment Canada's own snow level (winter.js eccSnowLevels): only GFS of the three has a freezing level here.
// Open-Meteo counts each extra model as more of the free daily allowance, so this is for the cards (one place at a
// time), not for map grids. If the three-model call fails for any reason but a refusal, the old one-model call is
// made instead, and the card says it wasn't checked.
(function () {
  "use strict";
  const MODELS = [
    ["gem_seamless", "Environment Canada (GEM)"],
    ["ecmwf_ifs025", "ECMWF (Europe)"],
    ["gfs_seamless", "NOAA (GFS)"],
  ];
  const IDS = MODELS.map((m) => m[0]);
  // How far apart the models can be before the card calls a day uncertain: a gap this big, and for amounts the high
  // one at least 1.5 times the low one. Small amounts are left alone: 1 mm against 4 mm is "a little", whatever the
  // ratio.
  const SPLIT = {
    rain: { gap: 10, ratio: 1.5, unit: "mm", word: "rain or snow (water)" },
    snow: { gap: 10, ratio: 1.5, unit: "cm", word: "snow" },
    hi: { gap: 5, unit: "°C", word: "high" },
    lo: { gap: 5, unit: "°C", word: "low" },
    wind: { gap: 25, min: 30, unit: "km/h", word: "wind" },
  };
  const median = (a) => {
    const v = a.filter((x) => typeof x === "number" && isFinite(x)).sort((x, y) => x - y);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 100) / 100;
  };
  // The model whose value is the middle one (ties: the first in MODELS, Environment Canada).
  const middleModel = (vals) => {
    const m = median(vals);
    if (m == null) return -1;
    let best = -1, d = Infinity;
    vals.forEach((v, k) => { if (typeof v === "number" && Math.abs(v - m) < d) { d = Math.abs(v - m); best = k; } });
    return best;
  };
  const PRECIP = ["precipitation", "precipitation_sum", "rain", "rain_sum", "showers", "showers_sum"];
  // Turns one block (hourly, daily, current, ...) with keys like temperature_2m_gem_seamless back into plain keys,
  // each the middle value. Keeps each model's own numbers in models[] for the check.
  function blendBlock(b) {
    if (!b || typeof b !== "object") return { out: b, per: null };
    const out = {}, per = IDS.map(() => ({})), base = new Set();
    for (const k of Object.keys(b)) {
      const id = IDS.find((m) => k.endsWith("_" + m));
      if (!id) { out[k] = b[k]; continue; }
      const name = k.slice(0, -id.length - 1);
      base.add(name);
      per[IDS.indexOf(id)][name] = b[k];
    }
    const list = Array.isArray(b.time);
    const pick = (name, i) => per.map((p) => (list ? (p[name] || [])[i] : p[name]));
    const n = list ? b.time.length : 1;
    for (const name of base) {
      const col = [];
      for (let i = 0; i < n; i++) {
        const vals = pick(name, i);
        let v;
        if (name === "weather_code") {
          // The code of the model in the middle on rain (the icon then agrees with the amount); without an amount,
          // the code two models share, else Environment Canada's.
          const pk = PRECIP.find((x) => base.has(x)), k = pk ? middleModel(pick(pk, i)) : -1;
          if (k >= 0 && vals[k] != null) v = vals[k];
          else {
            const c = vals.filter((x) => x != null), two = c.find((x, j) => c.indexOf(x) !== j);
            v = two != null ? two : c.length ? c[0] : null;
          }
        } else if (/direction/.test(name)) {
          // The direction of the model in the middle on wind speed: an average of directions isn't a direction.
          const sp = name.replace("direction", "speed").replace("_dominant", "_max"), k = base.has(sp) ? middleModel(pick(sp, i)) : -1;
          v = k >= 0 && vals[k] != null ? vals[k] : median(vals);
        } else if (/pressure/.test(name)) {
          // Pressure trends (fishing, hunting) need one model all the way: a middle value that hops between models
          // makes up rises and falls. Environment Canada's, else the next that has it.
          const k = per.findIndex((p) => (list ? (p[name] || []).some((x) => x != null) : p[name] != null));
          v = k >= 0 ? vals[k] ?? null : null;
        } else if (vals.some((x) => typeof x === "number")) v = median(vals);
        else v = vals.find((x) => x != null) ?? null;   // sunset, sunrise: the same in each
        col.push(v);
      }
      out[name] = list ? col : col[0];
    }
    return { out, per };
  }
  // Per day: each model's total rain, total snow, high, low and strongest wind, from the daily block where it has them,
  // else added up from the hourly one.
  function dayNumbers(w, perD, perH) {
    const days = new Map();
    const take = (date, k, key, v, how) => {
      if (typeof v !== "number") return;
      if (!days.has(date)) days.set(date, IDS.map(() => ({})));
      const o = days.get(date)[k];
      o[key] = o[key] == null ? v : how === "sum" ? o[key] + v : how === "max" ? Math.max(o[key], v) : Math.min(o[key], v);
    };
    const D = w.daily, H = w.hourly;
    const dHas = (n) => perD && perD.some((p) => p[n]);
    if (D && Array.isArray(D.time) && perD) perD.forEach((p, k) => D.time.forEach((d, i) => {
      if (p.precipitation_sum) take(d, k, "rain", p.precipitation_sum[i], "sum");
      if (p.snowfall_sum) take(d, k, "snow", p.snowfall_sum[i], "sum");
      if (p.temperature_2m_max) take(d, k, "hi", p.temperature_2m_max[i], "max");
      if (p.temperature_2m_min) take(d, k, "lo", p.temperature_2m_min[i], "min");
      if (p.wind_speed_10m_max) take(d, k, "wind", p.wind_speed_10m_max[i], "max");
    }));
    if (H && Array.isArray(H.time) && perH) perH.forEach((p, k) => H.time.forEach((t, i) => {
      const d = String(t).slice(0, 10);
      if (p.precipitation && !dHas("precipitation_sum")) take(d, k, "rain", p.precipitation[i], "sum");
      if (p.snowfall && !dHas("snowfall_sum")) take(d, k, "snow", p.snowfall[i], "sum");
      if (p.temperature_2m && !dHas("temperature_2m_max")) { take(d, k, "hi", p.temperature_2m[i], "max"); take(d, k, "lo", p.temperature_2m[i], "min"); }
      if (p.wind_speed_10m && !dHas("wind_speed_10m_max")) take(d, k, "wind", p.wind_speed_10m[i], "max");
    }));
    return days;
  }
  // Days (from today, at most 7) where the models are far apart: [{ date, what, lo, hi, unit }].
  function splits(days, today) {
    const out = [];
    for (const [date, ms] of [...days].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (date < today || out.length > 20) continue;
      const water = ms.some((m) => m.rain != null);
      for (const [key, s] of Object.entries(SPLIT)) {
        // Snow only where there's no water amount: a card's snow is split at its own height (winter.js), and the
        // models' water already says how much falls.
        if (key === "snow" && water) continue;
        const v = ms.map((m) => m[key]).filter((x) => typeof x === "number");
        if (v.length < 2) continue;
        const lo = Math.min(...v), hi = Math.max(...v);
        if (hi - lo < s.gap || (s.ratio && hi < s.ratio * lo) || (s.min && hi < s.min)) continue;
        out.push({ date, key, what: s.word, lo, hi, unit: s.unit });
      }
    }
    return out.filter((x) => x.date < addDays(today, 7));
  }
  const addDays = (ymd, n) => { const t = new Date(ymd + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  // One place's answer, three models -> plain keys + check.
  function blendOne(j) {
    if (!j || typeof j !== "object" || j.error) return j;
    const w = { ...j }, per = {};
    for (const b of ["current", "hourly", "daily", "minutely_15"]) if (j[b]) { const r = blendBlock(j[b]); w[b] = r.out; per[b] = r.per; }
    for (const u of ["current_units", "hourly_units", "daily_units", "minutely_15_units"]) if (j[u]) w[u] = blendBlock(j[u]).out;
    const off = (j.utc_offset_seconds || 0) * 1000, today = new Date(Date.now() + off).toISOString().slice(0, 10);
    const days = dayNumbers(j, per.daily, per.hourly);
    const have = IDS.filter((id, k) => [per.daily, per.hourly, per.current].some((p) => p && Object.values(p[k]).some((a) => (Array.isArray(a) ? a.some((x) => x != null) : a != null))));
    w.check = { models: have.map((id) => MODELS.find((m) => m[0] === id)[1]), splits: splits(days, today), today };
    return w;
  }
  const withModels = (url) => {
    const u = new URL(url);
    u.searchParams.set("models", IDS.join(","));
    return u.toString();
  };
  const isRefusal = (st) => st === 429;
  // Fetches an Open-Meteo forecast URL (one place or several) checked across the three models. ms: time limit.
  // Same answer shape as the plain call, plus w.check = { models: [names], splits: [...] } (models [] when only the
  // plain call worked).
  // ---- Models read directly from their makers (alex 2026-11-20, "own free model blend") ----
  // scripts/wx-blend/build.py (daily, GitHub Actions) reads Environment Canada GEM (HRDPS 2.5 km, then GDPS), ECMWF
  // 9 km, NOAA GFS and DWD ICON from their free open-data servers and saves each model's daily water, high and low on a
  // 0.1 degree grid over BC (data/wx/blend/<lat>_<lon>.json). For places inside that grid, a card's
  // daily amounts, highs and lows become the middle of those 4 models; the hours are scaled so they add up to the same
  // day total (the snow split by height in winter.js then agrees with it). Hours, wind and everything else stay the
  // middle of Open-Meteo's 3 models. Days are 1 am to 1 am Pacific standard time (the models' 09 UTC), an hour off
  // the card's midnight: fine for a daily estimate. No file, an old file or a place outside: the card is as before.
  const BLEND = "data/wx/blend/";
  const BLEND_NAMES = { gem: "Environment Canada (HRDPS 2.5 km and GDPS)", ecmwf: "ECMWF (9 km)", gfs: "NOAA (GFS)", icon: "DWD (ICON)" };
  const BOX = [48, -139, 60, -114], LAPSE = 0.0065;
  const blendTiles = new Map();   // key -> { at, p }
  const TILE_KEEP_MS = 3 * 3600000, RUN_MAX_AGE_MS = 36 * 3600000;
  const blendTile = (lat, lon) => {
    if (!(lat >= BOX[0] && lat < BOX[2] && lon >= BOX[1] && lon < BOX[3])) return Promise.resolve(null);
    const key = `${Math.floor(lat)}_${Math.floor(lon)}`, c = blendTiles.get(key);
    if (c && Date.now() - c.at < TILE_KEEP_MS) return c.p;
    const p = fetch(`${BLEND}${key}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((t) => { if (!t) blendTiles.set(key, { at: Date.now() - TILE_KEEP_MS + 10 * 60000, p }); return t; });
    blendTiles.set(key, { at: Date.now(), p });
    return p;
  };
  // "20261120T00Z" -> ms. A file from a run more than 36 h old (the daily job failed) is not used.
  const runMs = (r) => { const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})Z$/.exec(String(r || "")); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4]) : NaN; };
  // Each model's day numbers at one place: [{ date, p: [mm by model], hi: [C], lo: [C] }], temperatures moved to the
  // place's height (6.5 C per km, like Open-Meteo) from each model's own ground height in that cell.
  async function blendAt(lat, lon, elev) {
    const t = await blendTile(lat, lon);
    if (!t || !Array.isArray(t.days) || !Array.isArray(t.models)) return null;
    const run = runMs(t.run);
    if (!(Date.now() - run < RUN_MAX_AGE_MS)) return null;
    const per = Math.round(1 / t.step);   // cells per degree; integer maths so 49.3 lands in row 3, not 2
    const i = Math.min(9, Math.max(0, Math.floor((lat - t.lat0) * per + 1e-6))), j = Math.min(9, Math.max(0, Math.floor((lon - t.lon0) * per + 1e-6)));
    const c = i * 10 + j;
    const val = (a, d, k, f) => { const x = a && a[k] && a[k][d]; return x && typeof x[c] === "number" ? f(x[c]) : null; };
    const zAdj = (k) => (typeof elev === "number" && t.z && t.z[k] && typeof t.z[k][c] === "number" ? LAPSE * (t.z[k][c] - elev) : 0);
    return {
      models: t.models,
      days: t.days.map((date, d) => ({
        date,
        p: t.models.map((m, k) => val(t.p, d, k, (x) => x / 10)),
        hi: t.models.map((m, k) => val(t.hi, d, k, (x) => x / 10 + zAdj(k))),
        lo: t.models.map((m, k) => val(t.lo, d, k, (x) => x / 10 + zAdj(k))),
      })),
    };
  }
  const round1 = (v) => Math.round(v * 10) / 10;
  const r2 = (v) => Math.round(v * 100) / 100;
  // Where the models' water has no rain/snow split from Open-Meteo (it had none that day): by the day's blended mean
  // temperature, all snow at 0 C or colder, all rain at 2 C or warmer, in between a share of each. An estimate;
  // Skiing splits again by height from the hours.
  const snowShareOf = (hi, lo) => {
    const t = hi != null && lo != null ? (hi + lo) / 2 : hi != null ? hi - 3 : lo != null ? lo + 3 : null;
    return t == null ? 0.5 : Math.min(1, Math.max(0, (2 - t) / 2));
  };
  const CM_PER_MM = 0.7;   // Open-Meteo's own snowfall (cm) per mm of water
  // Puts the 4 models' middle values into one place's (already checked) answer, only into fields the answer has.
  // Returns it changed in place; w.check.blend is set only if something was replaced.
  function applyBlend(w, b) {
    if (!b || !w || !w.check) return w;
    const today = w.check.today, done = new Map(), splitsB = [];   // date -> Set("rain", "hi", "lo")
    const D = w.daily, H = w.hourly;
    const mark = (date, key) => { if (!done.has(date)) done.set(date, new Set()); done.get(date).add(key); };
    for (const day of b.days) {
      if (day.date < today) continue;
      const P = day.p.filter((x) => x != null), HI = day.hi.filter((x) => x != null), LO = day.lo.filter((x) => x != null);
      const di = D && Array.isArray(D.time) ? D.time.indexOf(day.date) : -1;
      const hiM = HI.length >= 3 ? round1(median(HI)) : null, loM = LO.length >= 3 ? round1(median(LO)) : null;
      for (const [m, key, field] of [[hiM, "hi", "temperature_2m_max"], [loM, "lo", "temperature_2m_min"]]) {
        if (m == null || di < 0 || !Array.isArray(D[field])) continue;
        D[field][di] = m;
        mark(day.date, key);
        const vals = key === "hi" ? HI : LO, lo = Math.min(...vals), hi = Math.max(...vals);
        if (hi - lo >= SPLIT[key].gap) splitsB.push({ date: day.date, key, what: SPLIT[key].word, lo, hi, unit: "°C" });
      }
      if (P.length < 3) continue;
      const m = round1(median(P)), share = snowShareOf(hiM, loM);
      let wrote = false;
      // Hours of that day scaled to the day total. None in the hours but some in the models: spread evenly and split
      // into rain and snow as above.
      if (H && Array.isArray(H.time) && Array.isArray(H.precipitation)) {
        const idx = H.time.map((t, k) => (String(t).slice(0, 10) === day.date ? k : -1)).filter((k) => k >= 0);
        if (idx.length) {
          const sum = idx.reduce((s, k) => s + (H.precipitation[k] || 0), 0);
          if (sum > 0.05) {
            const f = m / sum;
            for (const key of ["precipitation", "rain", "showers", "snowfall"]) if (Array.isArray(H[key])) idx.forEach((k) => { if (typeof H[key][k] === "number") H[key][k] = r2(H[key][k] * f); });
          } else if (m >= 0.5) {
            const each = m / idx.length;
            idx.forEach((k) => {
              H.precipitation[k] = r2(each);
              if (Array.isArray(H.rain)) H.rain[k] = r2(each * (1 - share));
              if (Array.isArray(H.snowfall)) H.snowfall[k] = r2(each * share * CM_PER_MM);
            });
          }
          wrote = true;
        }
      }
      if (di >= 0 && Array.isArray(D.precipitation_sum)) {
        const old = D.precipitation_sum[di];
        if (typeof old === "number" && old > 0.05) {
          for (const key of ["rain_sum", "showers_sum", "snowfall_sum"]) if (Array.isArray(D[key]) && typeof D[key][di] === "number") D[key][di] = r2(D[key][di] * (m / old));
        } else if (m > 0.05) {
          if (Array.isArray(D.rain_sum)) D.rain_sum[di] = r2(m * (1 - share));
          if (Array.isArray(D.showers_sum)) D.showers_sum[di] = 0;
          if (Array.isArray(D.snowfall_sum)) D.snowfall_sum[di] = r2(m * share * CM_PER_MM);
        }
        D.precipitation_sum[di] = m;
        // The day's icon follows the amount: rain or snow where it had none, no rain or snow where the models have
        // almost none (overcast, the nearest code that claims nothing falls).
        if (Array.isArray(D.weather_code) && typeof D.weather_code[di] === "number") {
          const c = D.weather_code[di], wet = c >= 51;
          if (!wet && m >= 1) D.weather_code[di] = share > 0.5 ? (m >= 10 ? 75 : m >= 3 ? 73 : 71) : (m >= 10 ? 65 : m >= 3 ? 63 : 61);
          else if (wet && m < 0.1) D.weather_code[di] = 3;
        }
        wrote = true;
      }
      if (!wrote) continue;
      mark(day.date, "rain");
      const lo = Math.min(...P), hi = Math.max(...P);
      if (hi - lo >= SPLIT.rain.gap && hi >= SPLIT.rain.ratio * lo) splitsB.push({ date: day.date, key: "rain", what: SPLIT.rain.word, lo, hi, unit: "mm" });
    }
    if (!done.size) return w;
    const names = b.models.map((m) => BLEND_NAMES[m] || m);
    w.check = { ...w.check, splits: w.check.splits.filter((s) => !(done.has(s.date) && done.get(s.date).has(s.key))).concat(splitsB),
      blend: names, hourModels: w.check.models };
    return w;
  }
  async function withBlend(w) {
    try {
      // Any place inside the grid (BC and the Rockies' west edge): days run 1 am to 1 am Pacific standard time, an
      // hour or two off midnight for places on Mountain time, fine for a daily estimate.
      if (!w || typeof w !== "object" || !w.check || typeof w.latitude !== "number") return w;
      const b = await blendAt(w.latitude, w.longitude, w.elevation);
      return applyBlend(w, b);
    } catch { return w; }
  }
  async function getChecked(url, ms = 15000) {
    const go = (u) => fetch(u, { signal: AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined }).then((r) => {
      if (!r.ok) { const e = new Error(isRefusal(r.status) ? "too many requests today, try later" : `HTTP ${r.status}`); e.status = r.status; throw e; }
      return r.json();
    });
    try {
      const j = await go(withModels(url));
      return Array.isArray(j) ? Promise.all(j.map((x) => withBlend(blendOne(x)))) : withBlend(blendOne(j));
    } catch (e) {
      if (e && isRefusal(e.status)) throw e;
      const mark = (x) => (x && typeof x === "object" ? { ...x, check: { models: [], splits: [] } } : x);
      const j = await go(url);
      return Array.isArray(j) ? j.map(mark) : mark(j);
    }
  }
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = (ymd, today) => (ymd === today ? "Today" : DAY[new Date(ymd + "T12:00:00Z").getUTCDay()]);
  const num = (v, unit) => (unit === "°C" ? Math.round(v) : unit === "mm" && v < 10 ? Math.round(v * 10) / 10 : Math.round(v));
  // The days the models disagree on, one line per kind.
  function splitList(c, cls) {
    let h = "";
    if (c.splits.length) {
      h += `<p class="${cls} wx-split"><span>The models disagree on these, so treat them as less certain:</span></p><ul class="${cls}">`
        + Object.keys(SPLIT).map((key) => {
          // One line per kind (wind, rain...), with its days and the widest low-high across them, so a phone gets a
          // few short lines.
          const x = c.splits.filter((s) => s.key === key);
          if (!x.length) return "";
          const lo = Math.min(...x.map((s) => s.lo)), hi = Math.max(...x.map((s) => s.hi)), u = x[0].unit, w = x[0].what;
          return `<li>${esc(`${w[0].toUpperCase() + w.slice(1)}: ${x.map((s) => dayName(s.date, c.today)).join(", ")} (${num(lo, u)} to ${num(hi, u)} ${u})`)}</li>`;
        }).join("") + "</ul>";
    }
    return h;
  }
  // The line under a weather card: which models, and the days they disagree on. Liability-safe: estimates, sources
  // named, nothing promised.
  function noteHtml(w, opts = {}) {
    const c = w && w.check;
    if (!c) return "";
    const cls = opts.cls || "wx-check";
    if (c.blend && c.blend.length) {
      const h = `<p class="${cls}"><span>Daily rain and snow (as water), highs and lows: middle value of ${c.blend.length} weather models read directly from their makers:</span> <span>${c.blend.map(esc).join(", ")}</span><span>.</span>`
        + (c.hourModels && c.hourModels.length ? ` <span>Hours and wind: middle of ${c.hourModels.length} models</span> <span>through Open-Meteo.</span>` : "")
        + ` <span>Still an estimate.</span></p>`;
      return h + splitList(c, cls);
    }
    if (!c.models.length) return `<p class="${cls}"><span>Weather from Open-Meteo's automatic model choice, not checked against other models this time. An estimate.</span></p>`;
    let h = `<p class="${cls}"><span>Middle value of ${c.models.length} weather models checked against each other:</span> <span>${c.models.map(esc).join(", ")}</span><span>. Still an estimate.</span></p>`;
    return h + splitList(c, cls);
  }
  window.tfWx = { MODELS, getChecked, blendOne, noteHtml, median, blendAt };
  const st = document.createElement("style");
  st.textContent = ".wx-check{font-size:12px;color:#5d6670;margin:6px 0 0;line-height:1.35}ul.wx-check{padding-left:18px;margin:2px 0 0}.wx-split{color:#8a5a00}";
  (document.head || document.documentElement).appendChild(st);
})();
