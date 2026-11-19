// Today, in every sport (alex 2026-11-19: "A Today card in every sport when the app opens ... add that", then picked
// "C. Both": a few places near you first, then a line for each of your saved places). Once a day, the first time the
// app opens in a sport, a card answers "what is it like today?" in that sport's own words:
//  - MTB keeps its own card, Where to ride today (status.js): this file only opens it once a day.
//  - Skiing: Avalanche Canada's rating for today where you are, each band exactly as given (winter.js tfSki.avyToday:
//    nothing shown when there is no bulletin for today), new snow in the last and next 24 h, the nearest backcountry
//    areas (by distance only, never by danger) and your saved tours, each with its new snow and its area's ratings.
//  - Fishing: the bite estimate where you are (fishing.js dayScore), the best waters near you (fishing.js todayTop:
//    fresh stocking and river flow) and your saved fishing spots with their bite estimate and wind.
//  - Hunting: your zone's seasons open today (from the regulations files the spot card reads), legal light, the wind
//    and where your scent drifts, the moon, and the same wind at your saved stands, blinds and cameras. No "good day"
//    score: GPS-collar studies find time of year moves deer far more than the weather.
//  - Hiking: the weather here, the nearest hikes with no snow or closure found first (hike.js todayPicks), and your
//    saved hikes with their weather.
//  - Adventure moto: rain in the last 2 days and today, the nearest adventure routes (moto-routes.json) and your
//    saved routes, with the rain at their start.
// Weather: one call for every place on the card, the middle value of GEM, ECMWF and GFS (wxcheck.js), labelled as an
// estimate with its sources. Wording: facts and sources only; nothing promises conditions, access or safety, and no
// travel advice. "Don't show when the app opens" turns the automatic card off (tf:todayAuto); the More page's Today
// and the map sheet's Today line still open it.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("tf:" + k, JSON.stringify(v)); } catch {} },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const line = (name, size = 18) => (window.tfLineName ? window.tfLineName(name, size) : "");
  const sportNow = () => { const m = /\bsport-(ski|hunt|fish|moto|hike)\b/.exec(document.body.className); return m ? m[1] : "mtb"; };
  const kmTo = (a, b) => Math.hypot((a[1] - b[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180), (a[0] - b[0]) * 110.57);
  const fmtKm = (d) => (d < 1 ? "under 1 km" : `${Math.round(d)} km`);
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const compass = (d) => DIRS[Math.round((((d % 360) + 360) % 360) / 45) % 8];
  const hm = (d) => (d ? new Date(d).toLocaleTimeString(window.tfLang && window.tfLang.lang === "fr" ? "fr-CA" : "en-CA", { hour: "numeric", minute: "2-digit" }) : "–");
  const localDay = () => new Date().toLocaleDateString("en-CA");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Asks again every half second until it answers (a sport's data loads after its file), up to ms.
  async function until(fn, ms = 8000) {
    for (let t = 0; t <= ms; t += 500) { const v = await Promise.resolve().then(fn).catch(() => null); if (v) return v; await wait(500); }
    return null;
  }

  const WORDS = {
    ski: { title: "Skiing today", near: "Backcountry areas near you", saved: "Your saved tours", none: "Save a tour (Plan a tour, then Save) and it shows here with its new snow." },
    fish: { title: "Fishing today", near: "Waters near you", saved: "Your saved fishing spots", none: "Save a fishing spot and it shows here with its bite estimate." },
    hunt: { title: "Hunting today", near: "Your zone today", saved: "Your saved hunting spots", none: "Save a stand, blind or camera and it shows here with its wind." },
    hike: { title: "Hiking today", near: "Hikes near you", saved: "Your saved hikes", none: "Save a hike and it shows here with its weather." },
    moto: { title: "Riding today", near: "Adventure routes near you", saved: "Your saved routes", none: "Save a route and it shows here with its rain." },
  };

  const css = document.createElement("style");
  css.textContent = `
dialog.tdy { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 16px; width: min(520px, calc(100vw - 24px)); max-height: calc(100dvh - 32px); overflow: auto; box-sizing: border-box; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.tdy::backdrop { background: rgba(0,0,0,.45); }
dialog.tdy h2 { margin: 0; font-family: var(--font-display); font-size: 1.3rem; display: flex; align-items: center; gap: 8px; }
dialog.tdy h2 .tdy-x { margin-left: auto; font: inherit; border: 0; background: none; color: var(--muted); cursor: pointer; padding: 4px; display: flex; }
dialog.tdy h2 svg { flex: none; }
dialog.tdy h3 { margin: 16px 0 6px; font-size: .78rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
dialog.tdy .tdy-from { margin: 4px 0 0; color: var(--muted); font-size: .85rem; }
dialog.tdy ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
dialog.tdy .tdy-here { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; font-size: .9rem; }
dialog.tdy .tdy-kv { display: flex; justify-content: space-between; gap: 10px; }
dialog.tdy .tdy-kv > span:first-child { color: var(--muted); }
dialog.tdy .tdy-kv > b { text-align: right; }
dialog.tdy li > button { width: 100%; text-align: left; font: inherit; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--line); background: var(--chip, #fff); color: var(--fg); cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
dialog.tdy li > button > span.tdy-top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
dialog.tdy li b { font-size: .98rem; }
dialog.tdy li em { font-style: normal; color: var(--muted); font-size: .8rem; white-space: nowrap; }
dialog.tdy small { color: var(--muted); font-size: .8rem; }
dialog.tdy .tdy-avy { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: .82rem; }
dialog.tdy .tdy-avy i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; border: 1px solid rgba(0,0,0,.25); }
dialog.tdy .tdy-note { color: var(--muted); font-size: .8rem; margin: 6px 0 0; line-height: 1.35; }
dialog.tdy .tdy-warn { color: #8a5a00; font-size: .82rem; margin: 2px 0 0; }
dialog.tdy .tdy-wait { color: var(--muted); font-size: .9rem; }
dialog.tdy a { color: inherit; }
dialog.tdy .tdy-foot { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
dialog.tdy .tdy-foot button { font: inherit; font-size: .85rem; font-weight: 600; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip, #fff); color: var(--fg); cursor: pointer; }
dialog.tdy .tdy-foot label { display: flex; align-items: center; gap: 6px; font-size: .82rem; color: var(--muted); }`;
  document.head.append(css);

  const dlg = document.createElement("dialog");
  dlg.className = "tdy";
  dlg.innerHTML = `<h2><span id="tdyIcon"></span><span id="tdyTitle">Today</span><button type="button" class="tdy-x" data-x aria-label="Close">${line("plus", 20).replace("<svg", '<svg style="transform:rotate(45deg)"')}</button></h2>
    <p class="tdy-from" id="tdyFrom"></p>
    <div id="tdyHere" class="tdy-here"><span class="tdy-wait">Checking today's weather…</span></div>
    <h3 id="tdyNearH"></h3><ul id="tdyNear"><li class="tdy-wait">Loading…</li></ul>
    <h3 id="tdySavedH"></h3><ul id="tdySaved"><li class="tdy-wait">Loading…</li></ul>
    <div id="tdyNote"></div>
    <div class="tdy-foot"><button type="button" data-more>See more in this sport</button><label><input type="checkbox" id="tdyAuto"> <span>Don't show when the app opens</span></label></div>`;
  document.body.append(dlg);
  const $ = (id) => document.getElementById(id);
  dlg.querySelector("[data-x]").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  $("tdyAuto").addEventListener("change", (e) => store.set("todayAuto", !e.target.checked));
  let cur = "mtb", acts = [];
  dlg.addEventListener("click", (e) => {
    const b = e.target.closest("[data-go]");
    if (b) { const f = acts[+b.dataset.go]; dlg.close(); if (f) try { f(); } catch {} return; }
    if (e.target.closest("[data-more]")) { dlg.close(); more(cur); }
  });
  // "See more": the sport's own Today, on its tab.
  function more(sp) {
    const NOW = { ski: "skNow", hunt: "hnNow", fish: "fsNow", moto: "mtNow", hike: "hkNow" };
    const t = document.querySelector(`#tabbar [data-nav="${{ ski: "ski", hunt: "hunt", fish: "fish", moto: "moto", hike: "hike" }[sp]}"]`);
    if (t && t.getAttribute("aria-current") !== "true") t.click();
    if (sp === "hike" && window.tfHike && window.tfHike.hub) { window.tfHike.hub("today"); return; }
    setTimeout(() => { const b = $(NOW[sp]); if (b && !b.hidden) b.click(); }, 300);
  }

  // Where from: your location if the map has it, else the middle of the map.
  function whereFrom() {
    const T = window.tfToday, you = T && T.you ? T.you() : null;
    if (you) return { ll: [you.lat != null ? you.lat : you[0], you.lng != null ? you.lng : you.lon != null ? you.lon : you[1]], how: "you" };
    const c = map.getCenter();
    return { ll: [c.lat, c.lng], how: "map" };
  }

  // ---------- weather for every place on the card: one call, the middle of three models ----------
  async function weather(pts, fish) {
    if (!pts.length) return [];
    const q = new URLSearchParams({ latitude: pts.map((p) => p[0].toFixed(3)).join(","), longitude: pts.map((p) => p[1].toFixed(3)).join(","),
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset",
      hourly: "snowfall,precipitation" + (fish ? ",temperature_2m,pressure_msl,wind_speed_10m,wind_gusts_10m,cloud_cover" : ""),
      past_days: "2", forecast_days: "2", timezone: "auto", wind_speed_unit: "kmh" });
    const url = `https://api.open-meteo.com/v1/forecast?${q}`;
    let j = await (window.tfWx ? window.tfWx.getChecked(url, 15000) : fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }));
    if (!Array.isArray(j)) j = [j];
    return j.map(sum);
  }
  // One place's numbers: snow and rain in the last and next 24 h (and the last 48 h), today's day values.
  function sum(w) {
    if (!w || !w.hourly || !w.daily) return null;
    const off = (w.utc_offset_seconds || 0) * 1000, now = Date.now(), h = w.hourly, d = w.daily;
    const at = (t) => Date.parse(t + ":00Z") - off;
    const add = (key, from, to) => h.time.reduce((s, t, i) => { const x = at(t); return x > from && x <= to ? s + (h[key][i] || 0) : s; }, 0);
    const today = new Date(now + off).toISOString().slice(0, 10), i = d.time.indexOf(today);
    const day = (k) => (i >= 0 && d[k] ? d[k][i] : null);
    return { w, today, snowPast: add("snowfall", now - 864e5, now), snowNext: add("snowfall", now, now + 864e5), wetPast2: add("precipitation", now - 2 * 864e5, now), wetNext: add("precipitation", now, now + 864e5),
      hi: day("temperature_2m_max"), lo: day("temperature_2m_min"), pop: day("precipitation_probability_max"), wet: day("precipitation_sum"), wind: day("wind_speed_10m_max"), gust: day("wind_gusts_10m_max"),
      dir: day("wind_direction_10m_dominant"), rise: day("sunrise") ? at(day("sunrise")) : null, set: day("sunset") ? at(day("sunset")) : null };
  }
  const cm = (v) => (v == null ? "–" : v < 0.5 ? "0 cm" : `${Math.round(v)} cm`);
  const mm = (v) => (v == null ? "–" : v < 0.5 ? "0 mm" : `${Math.round(v)} mm`);
  const deg = (v) => (v == null ? "–" : `${Math.round(v)}°C`);
  const kv = (k, v) => `<div class="tdy-kv"><span>${esc(k)}</span><b>${[].concat(v).map((x) => `<span>${esc(x)}</span>`).join("")}</b></div>`;   // v: text, or pieces that translate on their own
  const windWord = (s) => (s.wind == null ? "" : s.wind < 5 ? "Wind light" : `Wind from ${compass(s.dir)}, up to ${Math.round(s.wind)} km/h${s.gust >= 40 ? `, gusts ${Math.round(s.gust)}` : ""}`);
  const row = (i, name, why, d, extra = "") => `<li><button type="button" data-go="${i}"><span class="tdy-top"><b>${esc(name)}</b>${d != null ? `<em>${esc(fmtKm(d))}</em>` : ""}</span>${[].concat(why || []).filter(Boolean).map((w) => `<small>${esc(w)}</small>`).join("")}${extra}</button></li>`;
  const go = (f) => { acts.push(f); return acts.length - 1; };

  // ---------- Avalanche Canada, exactly as given ----------
  const avyLine = (a) => {
    if (!a) return "";
    if (a.none) return `<p class="tdy-warn">${esc(NONE[a.none] || NONE.forecast)}</p>`;
    return `<div class="tdy-avy">${a.bands.map((b) => `<span><i style="background:${b.color}"></i><span>${esc(b.name)}</span>: <span>${esc(b.label)}</span></span>`).join("")}</div>`
      + `<small><span>${esc(a.owner)}</span>, <span>${esc(a.area)}</span>. <a href="${esc(a.url)}" target="_blank" rel="noopener">Full forecast</a></small>`
      + (a.stale ? `<p class="tdy-warn">Saved copy: a newer forecast may be out. Check avalanche.ca.</p>` : "");
  };
  const NONE = {
    area: "No avalanche forecast area here, so no danger rating is shown.",
    forecast: "Avalanche Canada has no rating for today here, so none is shown.",
    old: "The last avalanche forecast here has run out, so no rating is shown. Check avalanche.ca.",
    early: "Avalanche Canada's early season bulletin here gives no danger rating.",
    load: "The avalanche forecast didn't load, so no rating is shown. Check avalanche.ca.",
    example: "The example avalanche forecast is on, so no rating is shown here.",
  };
  const avyAt = (ll) => (window.tfSki && window.tfSki.avyToday ? window.tfSki.avyToday(ll[0], ll[1]).catch(() => ({ none: "load" })) : Promise.resolve({ none: "load" }));

  // ---------- each sport ----------
  // Each returns { near: [{ ll, name, why, d, open }], saved: [...same], here: (s) => html, wx: [extra places] }
  // and fills in its lines once the weather is in.
  async function ski(from) {
    let areas = [];
    try { areas = ((await fetch("data/ski-areas.json").then((r) => r.json())).areas || []).filter((a) => a.lat != null); } catch {}
    const near = areas.map((a) => ({ a, d: kmTo(from.ll, [a.lat, a.lon]) })).filter((x) => x.d <= 150).sort((x, y) => x.d - y.d).slice(0, 3)
      .map(({ a, d }) => ({ ll: [a.lat, a.lon], name: a.name, d, open: () => map.setView([a.lat, a.lon], 12) }));
    const saved = store.get("skiTours", []).filter((t) => t.pts && t.pts.length).map((t) => ({ t, ll: [t.pts[0][0], t.pts[0][1]] }))
      .map((x) => ({ ...x, d: kmTo(from.ll, x.ll) })).sort((a, b) => a.d - b.d).slice(0, 5)
      .map(({ t, ll, d }) => ({ ll, name: t.n || "Tour", d, open: () => { if (t.bb) map.fitBounds([[t.bb[0], t.bb[1]], [t.bb[2], t.bb[3]]]); else map.setView(ll, 13); if (window.tfSki && window.tfSki.tours) window.tfSki.tours(); } }));
    const all = [from.ll, ...near.map((x) => x.ll), ...saved.map((x) => x.ll)];
    const avys = await Promise.all(all.map(avyAt));
    const snow = (s) => (s ? `New snow ${cm(s.snowPast)} in the last 24 h, ${cm(s.snowNext)} forecast in the next 24 h` : "");
    return {
      near, saved, fish: false,
      here: (s) => `${s ? kv("New snow, last 24 h", cm(s.snowPast)) + kv("Snow forecast, next 24 h", cm(s.snowNext)) + kv("High and low", `${deg(s.hi)} / ${deg(s.lo)}`) : ""}${avyLine(avys[0])}`,
      why: (x, s, k) => snow(s),
      // A place with the same "no rating" reason as where you are: said once, at the top.
      // Or in the same forecast area as where you are: one short line, the ratings are the ones at the top.
      extra: (x, s, k) => {
        const a = avys[k], h = avys[0];
        if (a && h && a.none && a.none === h.none) return "";
        if (a && h && a.bands && h.bands && a.area === h.area && a.url === h.url) return `<small>Avalanche ratings: the same Avalanche Canada forecast area as at the top.</small>`;
        return avyLine(a);
      },
      note: "New snow: a weather model's estimate at the area or the tour's start, not a snow report. Avalanche ratings: Avalanche Canada, exactly as given for today, by elevation band.",
    };
  }

  async function fish(from) {
    if (window.tfLoadSport) await window.tfLoadSport("fish").catch(() => {});
    const FT = () => (window.tfFish && window.tfFish.trip) || null;   // fishing.js: todayTop and dayScore
    const top = await until(() => (FT() && FT().todayTop ? FT().todayTop(3) : null), 9000);
    const near = top ? top.list.map((x) => ({ ll: [x.lat, x.lon], name: x.name, d: x.d, why0: x.why, open: x.open })) : [];
    const pts = window.tfPoints && window.tfPoints.list ? window.tfPoints.list("fish").filter((p) => !["catch", "truck", "camp"].includes(p.kind)) : [];
    const saved = pts.map((p) => ({ p, d: kmTo(from.ll, [p.lat, p.lon]) })).sort((a, b) => a.d - b.d).slice(0, 5)
      .map(({ p, d }) => ({ ll: [p.lat, p.lon], name: p.name || "Fishing spot", d, open: () => { map.setView([p.lat, p.lon], 14); if (window.tfFish && window.tfFish.spot) window.tfFish.spot(p.lat, p.lon, p.name); } }));
    const bite = (s) => {
      const F = FT();
      if (!s || !F || !F.dayScore || !s.w.hourly.pressure_msl) return null;
      return F.dayScore(s.w.hourly, s.today, null);
    };
    let hereBite = "";
    const biteWord = (b) => (b ? `Bite estimate ${b.s}/5${b.why.length ? `: ${b.why.join(", ")}` : ""}` : "");
    return {
      near, saved, fish: true,
      here: (s) => { const b = bite(s); hereBite = biteWord(b); return s ? (b ? kv("Bite estimate", `${b.s}/5`) + (b.why.length ? `<small>${esc(b.why.join(", "))}</small>` : "") : "") + kv("Sunrise and sunset", `${hm(s.rise)} · ${hm(s.set)}`) + kv("Wind", windWord(s).replace(/^Wind /, "")) + kv("Rain or snow today", mm(s.wet)) : ""; },
      why: (x, s) => [x.why0, ((w) => (w === hereBite ? "" : w))(biteWord(bite(s)))],   // the same as at the top: said once
      extra: () => "",
      note: [top && top.sea, `Waters: ranked by how fresh the stocking is and the river flow, from the province's stocking reports and the river gauges. Bite estimate: a 1 to 5 guide from the weather (pressure, wind, cloud, rain) and the moon, not a promise of fish.`],
    };
  }

  async function hunt(from) {
    if (window.tfLoadSport) await window.tfLoadSport("hunt").catch(() => {});
    const H = await until(() => (window.tfHunt && window.tfHunt.trip ? window.tfHunt.trip : null), 6000);
    let zones = [];
    if (H && H.seasonsAt) try { zones = await H.seasonsAt(from.ll[0], from.ll[1]); } catch {}
    const KEEP = ["truck", "harvest", "camp", "other"];
    const pts = window.tfPoints && window.tfPoints.list ? window.tfPoints.list("hunt").filter((p) => !KEEP.includes(p.kind)) : [];
    const saved = pts.map((p) => ({ p, d: kmTo(from.ll, [p.lat, p.lon]) })).sort((a, b) => a.d - b.d).slice(0, 5)
      .map(({ p, d }) => ({ ll: [p.lat, p.lon], name: p.name || "Hunting spot", d, open: () => { map.setView([p.lat, p.lon], 15); if (window.tfHunt && window.tfHunt.spot) window.tfHunt.spot(p.lat, p.lon); } }));
    // The zone's seasons open today, by species (the same reading as the spot card).
    const near = zones.filter((z) => z.rows).map((z) => {
      const open = [...new Set(z.rows.filter((r) => H.openNow && H.openNow(r[3])).map((r) => r[0]))];
      return { ll: null, name: z.label, why0: open.length ? `In season today (from ${z.src}): ${open.slice(0, 6).join(", ")}${open.length > 6 ? ` +${open.length - 6} more` : ""}` : `Nothing in season today (from ${z.src})`, open: () => { if (H.openAt) H.openAt(from.ll[0], from.ll[1]); } };
    });
    const sky = H && H.skyOn ? H.skyOn(from.ll[0], from.ll[1], localDay()) : null;
    const scent = (s) => (s && s.wind != null && s.wind >= 5 ? `${windWord(s)}: your scent drifts ${compass(s.dir + 180)}` : s ? windWord(s) : "");
    return {
      near, saved, fish: false, noDist: true,
      here: (s) => (sky ? kv("Legal light", `${sky.rise ? hm(sky.rise - 30 * 60000) : "–"} – ${sky.set ? hm(sky.set.valueOf() + 30 * 60000) : "–"}`) + kv("Moon", [sky.moon.name, `, ${sky.moon.pct}%`]) : "")
        + (s ? kv("Wind", scent(s).replace(/^Wind /, "")) + kv("High and low", `${deg(s.hi)} / ${deg(s.lo)}`) + kv("Rain or snow today", mm(s.wet)) : ""),
      why: (x, s) => x.why0 || [scent(s), s && s.wet >= 1 ? `${mm(s.wet)} of rain or snow` : ""],
      extra: () => "",
      note: "Seasons: read from the regulations files; the regulations decide, so check them before you go. Legal light: the usual hours, 30 min before sunrise to 30 min after sunset; some provinces and hunts differ. Wind: a weather model's estimate, it turns with the hills and the hour.",
      nearEmpty: "No season dates read for the zone here yet. Tap the map in Hunting for the zone's rules.",
    };
  }

  async function hike(from) {
    if (window.tfLoadSport) await window.tfLoadSport("hike").catch(() => {});
    const H = await until(() => (window.tfHike && window.tfHike.todayPicks ? window.tfHike : null), 6000);
    let picks = null;
    if (H) picks = await until(async () => { const p = await H.todayPicks(3); return p && p.length ? p : null; }, 8000);
    const near = (picks || []).map((x) => ({ ll: null, name: x.name, d: x.d, why0: x.why, open: x.open }));
    const saved = store.get("hikeSaved", []).filter((h) => h.c).map((h) => ({ h, d: kmTo(from.ll, h.c) })).sort((a, b) => a.d - b.d).slice(0, 5)
      .map(({ h, d }) => ({ ll: h.c, name: h.n || "Hike", d, open: () => { if (window.tfHike && window.tfHike.openSaved) window.tfHike.openSaved(h.id, h.c); else map.setView(h.c, 14); } }));
    return {
      near, saved, fish: false,
      here: (s) => (s ? kv("High and low", `${deg(s.hi)} / ${deg(s.lo)}`) + kv("Chance of rain or snow", s.pop == null ? "–" : `${Math.round(s.pop)}%`) + kv("New snow, next 24 h", cm(s.snowNext)) + kv("Sunset", hm(s.set)) : ""),
      why: (x, s) => x.why0 || (s ? [`${deg(s.hi)} / ${deg(s.lo)}`, s.pop != null ? `rain or snow ${Math.round(s.pop)}%` : "", s.snowNext >= 1 ? `${cm(s.snowNext)} new snow` : "", `sunset ${hm(s.set)}`].filter(Boolean).join(" · ") : ""),
      extra: () => "",
      note: "Hikes near you: no snow or closure found first. Snow and weather: a weather model's estimate (at the top of each nearby hike, at the middle of saved ones); closures, warnings and fires from the feeds the app reads. Not a trail report.",
      nearEmpty: "Zoom the map in to a valley or a town to see hikes near you.",
    };
  }

  async function moto(from) {
    let routes = [];
    try { routes = ((await fetch("data/moto-routes.json").then((r) => r.json())).routes || []).filter((r) => r && r.n && r.start); } catch {}
    const near = routes.map((r) => ({ r, d: kmTo(from.ll, r.start) })).filter((x) => x.d <= 200).sort((a, b) => a.d - b.d).slice(0, 3)
      .map(({ r, d }) => ({ ll: r.start, name: r.n, d, facts: [r.km ? `${r.km} km` : "", r.dirtPct != null ? `${r.dirtPct}% dirt` : "", r.season ? `season ${r.season}` : ""].filter(Boolean).join(" · "),
        open: () => { if (window.tfLoadSport) window.tfLoadSport("moto").then(() => window.tfMoto && window.tfMoto.openTrip && window.tfMoto.openTrip(r.id)).catch(() => {}); } }));
    const saved = store.get("motoRoutes", []).filter((r) => r.pts && r.pts.length).map((r) => ({ r, ll: [r.pts[0][0], r.pts[0][1]] }))
      .map((x) => ({ ...x, d: kmTo(from.ll, x.ll) })).sort((a, b) => a.d - b.d).slice(0, 5)
      .map(({ r, ll, d }) => ({ ll, name: r.name || "Route", d, facts: r.km ? `${r.km} km` : "", open: () => { if (window.tfMoto && window.tfMoto.hub) window.tfMoto.hub("routes"); else map.setView(ll, 11); } }));
    const wet = (s) => (s ? `Rain or snow at the start: ${mm(s.wetPast2)} in the last 2 days, ${mm(s.wetNext)} in the next 24 h` : "");
    return {
      near, saved, fish: false,
      here: (s) => (s ? kv("Rain or snow, last 2 days", mm(s.wetPast2)) + kv("Rain or snow, next 24 h", mm(s.wetNext)) + kv("New snow, next 24 h", cm(s.snowNext)) + kv("High and low", `${deg(s.hi)} / ${deg(s.lo)}`) : ""),
      why: (x, s) => [x.facts, wet(s)],
      extra: () => "",
      note: "Rain and snow: a weather model's estimate at the route's start; dirt roads can stay muddy for days after rain, and passes can hold snow. Routes: the app's list of known adventure routes; check road closures before you go.",
    };
  }
  const BUILD = { ski, fish, hunt, hike, moto };

  // ---------- the card ----------
  let seq = 0;
  async function open(sp = sportNow()) {
    if (sp === "mtb") { if (window.tfTodayOpen0) window.tfTodayOpen0(); return; }
    const W = WORDS[sp];
    if (!W) return;
    cur = sp; acts = [];
    const my = ++seq, from = whereFrom();
    $("tdyIcon").innerHTML = line(sp === "hike" ? "boot" : sp, 22);
    $("tdyTitle").textContent = W.title;
    $("tdyFrom").textContent = from.how === "you" ? "Where you are, and your saved places" : "The middle of the map, and your saved places";
    $("tdyHere").innerHTML = `<span class="tdy-wait">Checking today's weather…</span>`;
    $("tdyNearH").textContent = W.near; $("tdySavedH").textContent = W.saved;
    $("tdyNear").innerHTML = $("tdySaved").innerHTML = `<li class="tdy-wait">Loading…</li>`;
    $("tdyNote").innerHTML = "";
    $("tdyAuto").checked = store.get("todayAuto", true) === false;
    if (!dlg.open) dlg.showModal();
    let S;
    try { S = await BUILD[sp](from); } catch { S = null; }
    if (my !== seq) return;
    if (!S) { $("tdyHere").innerHTML = `<span class="tdy-wait">Today couldn't load. Try again in a minute.</span>`; $("tdyNear").innerHTML = $("tdySaved").innerHTML = ""; return; }
    const places = [from.ll, ...S.near.filter((x) => x.ll).map((x) => x.ll), ...S.saved.map((x) => x.ll)];
    let wx = [], err = "";
    try { wx = await weather(places, S.fish); } catch (e) { err = navigator.onLine ? "The weather service is busy: try again in a minute." : "No signal: the weather needs a connection."; }
    if (my !== seq) return;
    let k = 1;
    const nearS = S.near.map((x) => (x.ll ? wx[k++] : null)), savedS = S.saved.map(() => wx[k++]);
    $("tdyHere").innerHTML = (err ? `<span class="tdy-wait">${esc(err)}</span>` : "") + (S.here(wx[0]) || "");
    // The avalanche line's index: 0 is here, then the near places, then the saved ones (ski only uses it).
    let ai = 1;
    const nearAi = S.near.map((x) => (x.ll ? ai++ : -1)), savedAi = S.saved.map(() => ai++);
    $("tdyNear").innerHTML = S.near.length ? S.near.map((x, i) => row(go(x.open), x.name, S.why(x, nearS[i], nearAi[i]), S.noDist ? null : x.d, S.extra(x, nearS[i], nearAi[i]))).join("")
      : `<li class="tdy-wait">${esc(S.nearEmpty || "Nothing found near here.")}</li>`;
    $("tdySaved").innerHTML = S.saved.length ? S.saved.map((x, i) => row(go(x.open), x.name, S.why(x, savedS[i], savedAi[i]), x.d, S.extra(x, savedS[i], savedAi[i]))).join("")
      : `<li class="tdy-wait">${esc(W.none)}</li>`;
    $("tdyNote").innerHTML = [].concat(S.note).filter(Boolean).map((n) => `<p class="tdy-note">${esc(n)}</p>`).join("") + (wx[0] && window.tfWx ? window.tfWx.noteHtml(wx[0].w, { cls: "tdy-note" }) : "");
  }

  // The More page's Today and the map sheet (index.html) call tfTodayOpen: MTB keeps status.js's card.
  window.tfTodayOpen0 = window.tfTodayOpen0 || window.tfTodayOpen;
  window.tfTodayOpen = () => open(sportNow());
  window.tfTodaySport = { open };

  // ---------- once a day, when the app opens ----------
  // Not on a shared link (#pin=...), not while the welcome or another card is up, not when turned off.
  function auto(tries = 20) {
    if (store.get("todayAuto", true) === false) return;
    if (/^#\w+=/.test(location.hash)) return;   // opened from a shared link (#pin=, #trail=, #route=, #trip=, #live=...): that comes first
    if ((window.tfWelcome && window.tfWelcome.pending && !window.tfWelcome.picked) || document.querySelector(".welc, .nt-ask, .acct-nudge, #tpBackBar:not([hidden]), dialog[open]")) {
      if (tries > 0) setTimeout(() => auto(tries - 1), 1000);
      return;
    }
    const sp = sportNow(), seen = store.get("todaySeen", {});
    if (seen[sp] === localDay()) return;
    seen[sp] = localDay(); store.set("todaySeen", seen);
    if (sp === "mtb") { if (window.tfTodayOpen0) window.tfTodayOpen0(); }
    else open(sp);
  }
  const start = () => setTimeout(() => auto(), 3500);
  if (document.readyState === "complete") start(); else window.addEventListener("load", start, { once: true });
})();
