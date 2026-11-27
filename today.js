// Today, in every sport (alex 2026-11-19: "A Today card in every sport", then picked "C. Both": a few places near you
// first, then a line for each of your saved places). Since 2026-11-22 (alex: "put that here instead of a pop up when you
// open the app", then "Yes, all sports") it is a card in each sport's panel, never a pop-up: a short line with today's
// numbers where you are, and a tap opens the rest. In each sport's own words:
//  - MTB keeps its own card, Where to ride today (status.js), opened from its button in the MTB panel.
//  - Skiing (under Plan a tour ... Cabin trip): Avalanche Canada's rating for today where you are, each band exactly as
//    given (winter.js tfSki.avyToday: nothing shown when there is no bulletin for today), new snow in the last and next
//    24 h, the nearest backcountry areas (by distance only, never by danger) and your saved tours, each with its new
//    snow and its area's ratings.
//  - Fishing: the bite estimate where you are (fishing.js dayScore), the best waters near you (fishing.js todayTop:
//    fresh stocking and river flow) and your saved fishing spots with their bite estimate and wind.
//  - Hunting: your zone's seasons open today (from the regulations files the spot card reads), legal light, the wind
//    and where your scent drifts, the moon, and the same wind at your saved stands, blinds and cameras. No "good day"
//    score: GPS-collar studies find time of year moves deer far more than the weather.
//  - Hiking: the weather here, the nearest hikes with no snow or closure found first (hike.js todayPicks), and your
//    saved hikes with their weather.
//  - Adventure moto: rain in the last 2 days and today, Day ride (moto-day.js: loops from here for the time you want
//    to ride), the nearest adventure routes (moto-routes.json) and your saved routes, with the rain at their start.
// Weather: one call for every place on the card, the middle value of GEM, ECMWF and GFS (wxcheck.js), labelled as an
// estimate with its sources. Wording: facts and sources only; nothing promises conditions, access or safety, and no
// travel advice. The More page's Today and the map sheet's Today line open the card in the sport's panel.
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
  // fn's answer, asked again every half second until it gives one (a sport's data loads after its file), up to ms. A
  // call that hangs (a download that never answers on a weak signal: Hiking's nearby hikes read heights and weather)
  // is given up then too, so the card never waits longer than ms here (2026-11-27 tough conditions test: over a
  // minute before).
  async function until(fn, ms = 8000) {
    const end = Date.now() + ms, late = wait(ms).then(() => undefined);
    let pending = null;   // a call still out is waited for, never asked again on top of it
    for (;;) {
      if (!pending) pending = Promise.resolve().then(fn).catch(() => null).then((v) => { pending = null; return v || null; });
      const v = await Promise.race([pending, late]);
      if (v) return v;
      if (Date.now() >= end) return null;
      if (v === null) await wait(Math.min(500, Math.max(0, end - Date.now())));
    }
  }

  const WORDS = {
    ski: { title: "Skiing today", near: "Backcountry areas near you", saved: "Your saved tours", none: "Save a tour (Plan a tour, then Save) and it shows here with its new snow." },
    fish: { title: "Fishing today", near: "Waters near you", saved: "Your saved fishing spots", none: "Save a fishing spot and it shows here with its bite estimate." },
    hunt: { title: "Hunting today", near: "Your zone today", saved: "Your saved hunting spots", none: "Save a stand, blind or camera and it shows here with its wind." },
    hike: { title: "Hiking today", near: "Hikes near you", saved: "Your saved hikes", none: "Save a hike and it shows here with its weather." },
    moto: { title: "Riding today", near: "Adventure routes near you", saved: "Your saved routes", none: "Save a route and it shows here with its rain." },
  };

  // The card lives in each sport's panel (alex 2026-11-22: "put that here instead of a pop up when you open the app",
  // then "Yes, all sports"): a short line with today's numbers where you are, and a tap opens the places near you and
  // your saved places. It never opens over the map by itself.
  const css = document.createElement("style");
  css.textContent = `
.tdy { border: 1px solid var(--line); border-radius: 12px; background: var(--panel); color: var(--fg); margin: 8px 0; box-sizing: border-box; font: inherit; }
.tdy .tdy-head { width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; font: inherit; color: inherit; background: none; border: 0; padding: 10px 12px; cursor: pointer; }
.tdy .tdy-head > svg, .tdy .tdy-ic svg { flex: none; }
.tdy .tdy-ic { display: flex; flex: none; }
.tdy .tdy-hd { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.tdy .tdy-hd > b { font-size: 1rem; }
.tdy .tdy-sum { color: var(--muted); font-size: .82rem; line-height: 1.35; }
.tdy .tdy-sum b { color: var(--fg); font-weight: 700; }
.tdy .tdy-chev { flex: none; transition: transform .15s; color: var(--muted); }
.tdy.open .tdy-chev { transform: rotate(180deg); }
.tdy .tdy-body { padding: 0 12px 12px; }
.tdy h3 { margin: 14px 0 6px; font-size: .78rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.tdy .tdy-from { margin: 0 0 6px; color: var(--muted); font-size: .85rem; }
.tdy ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.tdy .tdy-here { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; font-size: .9rem; }
.tdy .tdy-kv { display: flex; justify-content: space-between; gap: 10px; }
.tdy .tdy-kv > span:first-child { color: var(--muted); }
.tdy .tdy-kv > b { text-align: right; }
.tdy li > button { width: 100%; text-align: left; font: inherit; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--line); background: var(--chip, #fff); color: var(--fg); cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.tdy li > button > span.tdy-top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.tdy li b { font-size: .98rem; }
.tdy li em { font-style: normal; color: var(--muted); font-size: .8rem; white-space: nowrap; }
.tdy small { color: var(--muted); font-size: .8rem; }
.tdy .tdy-avy { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: .82rem; }
.tdy .tdy-avy i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; border: 1px solid rgba(0,0,0,.25); }
.tdy .tdy-note { color: var(--muted); font-size: .8rem; margin: 6px 0 0; line-height: 1.35; }
.tdy .tdy-warn { color: #8a5a00; font-size: .82rem; margin: 2px 0 0; }
.tdy .tdy-wait { color: var(--muted); font-size: .9rem; }
.tdy a { color: inherit; }
.tdy [hidden] { display: none !important; }
/* phones: the sport panels are ordered (theme.css); the card sits with the sport's buttons, after its tool row */
@media (max-width: 760px) { html body :is(#skiPane, #huntPane, #fishPane, #motoPane, #hikePane) > .tdy { order: 4; } }`;
  document.head.append(css);

  const CHEV = `<svg class="tdy-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
  // Where each sport's card sits in its panel: Skiing right under its buttons (Edit my tour ... Cabin trip), the others
  // under their tool buttons and Today line.
  const SPOT = { ski: "#skiPane .sk-acts", hunt: "#hnNow", fish: "#fsNow", moto: "#mtNow", hike: "#hkNow" };
  const cards = {};   // sport -> { el, acts, at, from, seq }
  const isOpen = () => store.get("todayOpen", false) === true;
  function card(sp) {
    if (cards[sp] && cards[sp].el.isConnected) return cards[sp];
    const a = document.querySelector(SPOT[sp]);
    if (!a) return null;
    const el = document.createElement("section");
    el.className = "tdy" + (isOpen() ? " open" : "");
    el.dataset.sp = sp;
    el.innerHTML = `<button type="button" class="tdy-head" aria-expanded="${isOpen()}"><span class="tdy-ic">${line(sp === "hike" ? "boot" : sp, 22)}</span><span class="tdy-hd"><b>${esc(WORDS[sp].title)}</b><span class="tdy-sum"><span>Checking today's weather…</span></span></span>${CHEV}</button>
      <div class="tdy-body"${isOpen() ? "" : " hidden"}><p class="tdy-from"></p><div class="tdy-here"><span class="tdy-wait">Checking today's weather…</span></div>
      <h3 class="tdy-nearH">${esc(WORDS[sp].near)}</h3><ul class="tdy-near"><li class="tdy-wait">Loading…</li></ul>
      <h3 class="tdy-savedH">${esc(WORDS[sp].saved)}</h3><ul class="tdy-saved"><li class="tdy-wait">Loading…</li></ul><div class="tdy-notes"></div></div>`;
    a.after(el);
    const c = cards[sp] = { el, acts: [], at: 0, from: null, seq: 0 };
    el.querySelector(".tdy-head").addEventListener("click", () => toggle(sp));
    el.addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) { const f = c.acts[+b.dataset.go]; if (f) try { f(); } catch {} } });
    return c;
  }
  // Open or close; the choice is kept for every sport. Opening reads again when the numbers are old or you've moved.
  function toggle(sp, open = !cards[sp].el.classList.contains("open")) {
    const c = cards[sp];
    c.el.classList.toggle("open", open);
    c.el.querySelector(".tdy-head").setAttribute("aria-expanded", String(open));
    c.el.querySelector(".tdy-body").hidden = !open;
    store.set("todayOpen", open);
    if (open) fill(sp);
  }

  // Where from: your location if the map has it, else the middle of the map.
  function whereFrom() {
    const T = window.tfToday, you = T && T.you ? T.you() : null;
    if (you) return { ll: [you.lat != null ? you.lat : you[0], you.lng != null ? you.lng : you.lon != null ? you.lon : you[1]], how: "you" };
    const c = map.getCenter();
    return { ll: [c.lat, c.lng], how: "map" };
  }

  // ---------- weather for every place on the card: one call, the middle of three models ----------
  async function weather(pts, fish, hike) {
    if (!pts.length) return [];
    const q = new URLSearchParams({ latitude: pts.map((p) => p[0].toFixed(3)).join(","), longitude: pts.map((p) => p[1].toFixed(3)).join(","),
      daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset",
      hourly: "snowfall,precipitation" + (fish ? ",temperature_2m,pressure_msl,wind_speed_10m,wind_gusts_10m,cloud_cover" : "")
        + (hike ? ",temperature_2m,snow_depth,soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm" : ""),
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
    // For a hike's trail condition (hike.js trailCond): snow on the ground, the lowest temperature within a day, the
    // soil moisture in the top 9 cm now.
    const nowI = h.time.findIndex((t) => at(t) > now) - 1, hv = (k) => (h[k] && nowI >= 0 ? h[k][nowI] : null);
    const sm = ["soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "soil_moisture_3_to_9cm"].map(hv);
    const lows = h.temperature_2m ? h.time.map((t, k) => (Math.abs(at(t) - now) <= 864e5 ? h.temperature_2m[k] : null)).filter((v) => v != null) : [];
    const ground = { snow: hv("snow_depth"), rain2: add("precipitation", now - 2 * 864e5, now), lo24: lows.length ? Math.min(...lows) : null, soil: sm.every((v) => v != null) ? 0.5 * sm[0] + 0.3 * sm[1] + 0.2 * sm[2] : null };
    return { w, today, ground, snowPast: add("snowfall", now - 864e5, now), snowNext: add("snowfall", now, now + 864e5), wetPast2: add("precipitation", now - 2 * 864e5, now), wetNext: add("precipitation", now, now + 864e5),
      hi: day("temperature_2m_max"), lo: day("temperature_2m_min"), pop: day("precipitation_probability_max"), wet: day("precipitation_sum"), wind: day("wind_speed_10m_max"), gust: day("wind_gusts_10m_max"),
      dir: day("wind_direction_10m_dominant"), rise: day("sunrise") ? at(day("sunrise")) : null, set: day("sunset") ? at(day("sunset")) : null };
  }
  const cm = (v) => (v == null ? "–" : v < 0.5 ? "0 cm" : `${Math.round(v)} cm`);
  const mm = (v) => (v == null ? "–" : v < 0.5 ? "0 mm" : `${Math.round(v)} mm`);
  const deg = (v) => (v == null ? "–" : `${Math.round(v)}°C`);
  const kv = (k, v) => `<div class="tdy-kv"><span>${esc(k)}</span><b>${[].concat(v).map((x) => `<span>${esc(x)}</span>`).join("")}</b></div>`;   // v: text, or pieces that translate on their own
  const windWord = (s) => (s.wind == null ? "" : s.wind < 5 ? "Wind light" : `Wind from ${compass(s.dir)}, up to ${Math.round(s.wind)} km/h${s.gust >= 40 ? `, gusts ${Math.round(s.gust)}` : ""}`);
  const row = (i, name, why, d, extra = "") => `<li><button type="button" data-go="${i}"><span class="tdy-top"><b>${esc(name)}</b>${d != null ? `<em>${esc(fmtKm(d))}</em>` : ""}</span>${[].concat(why || []).filter(Boolean).map((w) => `<small>${esc(w)}</small>`).join("")}${extra}</button></li>`;

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
  async function ski(from, lite) {
    let areas = [];
    try { areas = ((await fetch("data/ski-areas.json").then((r) => r.json())).areas || []).filter((a) => a.lat != null); } catch {}
    const near = areas.map((a) => ({ a, d: kmTo(from.ll, [a.lat, a.lon]) })).filter((x) => x.d <= 150).sort((x, y) => x.d - y.d).slice(0, 3)
      .map(({ a, d }) => ({ ll: [a.lat, a.lon], name: a.name, d, open: () => map.setView([a.lat, a.lon], 12) }));
    const saved = store.get("skiTours", []).filter((t) => t.pts && t.pts.length).map((t) => ({ t, ll: [t.pts[0][0], t.pts[0][1]] }))
      .map((x) => ({ ...x, d: kmTo(from.ll, x.ll) })).sort((a, b) => a.d - b.d).slice(0, 5)
      .map(({ t, ll, d }) => ({ ll, name: t.n || "Tour", d, open: () => { if (t.bb) map.fitBounds([[t.bb[0], t.bb[1]], [t.bb[2], t.bb[3]]]); else map.setView(ll, 13); if (window.tfSki && window.tfSki.tours) window.tfSki.tours(); } }));
    const all = [from.ll, ...near.map((x) => x.ll), ...saved.map((x) => x.ll)];
    const avys = lite ? [] : await Promise.all(all.map(avyAt));   // the short line has no ratings: read them when the card opens
    const snow = (s) => (s ? `New snow ${cm(s.snowPast)} in the last 24 h, ${cm(s.snowNext)} forecast in the next 24 h` : "");
    return {
      near, saved, fish: false,
      // The first bulletin on the card to run out: its ratings come off then (refreshIfOld).
      until: Math.min(Infinity, ...avys.filter((a) => a && a.bands && a.until).map((a) => a.until)),
      brief: (s) => [["New snow, last 24 h", cm(s.snowPast)], ["Snow forecast, next 24 h", cm(s.snowNext)], ["High and low", `${deg(s.hi)} / ${deg(s.lo)}`]],
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
    if (window.tfLoadSport) await Promise.race([window.tfLoadSport("fish").catch(() => {}), wait(8000)]);   // a weak signal: on with what came
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
      brief: (s) => { const b = bite(s); return [["Bite estimate", b ? `${b.s}/5` : null], ["Rain or snow today", mm(s.wet)]]; },
      here: (s) => { const b = bite(s); hereBite = biteWord(b); return s ? (b ? kv("Bite estimate", `${b.s}/5`) + (b.why.length ? `<small>${esc(b.why.join(", "))}</small>` : "") : "") + kv("Sunrise and sunset", `${hm(s.rise)} · ${hm(s.set)}`) + kv("Wind", windWord(s).replace(/^Wind /, "")) + kv("Rain or snow today", mm(s.wet)) : ""; },
      why: (x, s) => [x.why0, ((w) => (w === hereBite ? "" : w))(biteWord(bite(s)))],   // the same as at the top: said once
      extra: () => "",
      note: [top && top.sea, `Waters: ranked by how fresh the stocking is and the river flow, from the province's stocking reports and the river gauges. Bite estimate: a 1 to 5 guide from the weather (pressure, wind, cloud, rain) and the moon, not a promise of fish.`],
    };
  }

  async function hunt(from) {
    if (window.tfLoadSport) await Promise.race([window.tfLoadSport("hunt").catch(() => {}), wait(8000)]);   // a weak signal: on with what came
    const H = await until(() => (window.tfHunt && window.tfHunt.trip ? window.tfHunt.trip : null), 6000);
    let zones = [];
    if (H && H.seasonsAt) try { zones = (await Promise.race([H.seasonsAt(from.ll[0], from.ll[1]), wait(8000).then(() => null)])) || []; } catch {}
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
      brief: (s) => [["Legal light", sky ? `${sky.rise ? hm(sky.rise - 30 * 60000) : "–"} – ${sky.set ? hm(sky.set.valueOf() + 30 * 60000) : "–"}` : null], ["Wind", scent(s).replace(/^Wind /, "")]],
      here: (s) => (sky ? kv("Legal light", `${sky.rise ? hm(sky.rise - 30 * 60000) : "–"} – ${sky.set ? hm(sky.set.valueOf() + 30 * 60000) : "–"}`) + kv("Moon", [sky.moon.name, `, ${sky.moon.pct}%`]) : "")
        + (s ? kv("Wind", scent(s).replace(/^Wind /, "")) + kv("High and low", `${deg(s.hi)} / ${deg(s.lo)}`) + kv("Rain or snow today", mm(s.wet)) : ""),
      why: (x, s) => x.why0 || [scent(s), s && s.wet >= 1 ? `${mm(s.wet)} of rain or snow` : ""],
      extra: () => "",
      note: "Seasons: read from the regulations files; the regulations decide, so check them before you go. Legal light: the usual hours, 30 min before sunrise to 30 min after sunset; some provinces and hunts differ. Wind: a weather model's estimate, it turns with the hills and the hour.",
      nearEmpty: "No season dates read for the zone here yet. Tap the map in Hunting for the zone's rules.",
    };
  }

  async function hike(from) {
    if (window.tfLoadSport) await Promise.race([window.tfLoadSport("hike").catch(() => {}), wait(8000)]);   // a weak signal: on with what came
    const H = await until(() => (window.tfHike && window.tfHike.todayPicks ? window.tfHike : null), 6000);
    let picks = null;
    if (H) picks = await until(async () => { const p = await H.todayPicks(3); return p && p.length ? p : null; }, 8000);
    const near = (picks || []).map((x) => ({ ll: null, name: x.name, d: x.d, why0: x.why, open: x.open }));
    const saved = store.get("hikeSaved", []).filter((h) => h.c).map((h) => ({ h, d: kmTo(from.ll, h.c) })).sort((a, b) => a.d - b.d).slice(0, 5)
      .map(({ h, d }) => ({ ll: h.c, name: h.n || "Hike", d, open: () => { if (window.tfHike && window.tfHike.openSaved) window.tfHike.openSaved(h.id, h.c); else map.setView(h.c, 14); } }));
    return {
      near, saved, fish: false,
      brief: (s) => [["High and low", `${deg(s.hi)} / ${deg(s.lo)}`], ["Chance of rain or snow", s.pop == null ? null : `${Math.round(s.pop)}%`]],
      here: (s) => (s ? kv("High and low", `${deg(s.hi)} / ${deg(s.lo)}`) + kv("Chance of rain or snow", s.pop == null ? "–" : `${Math.round(s.pop)}%`) + kv("New snow, next 24 h", cm(s.snowNext)) + kv("Sunset", hm(s.set)) : ""),
      why: (x, s) => x.why0 || (s ? [window.tfHike && window.tfHike.trailCond ? window.tfHike.trailCond(s.ground) : "", [`${deg(s.hi)} / ${deg(s.lo)}`, s.pop != null ? `rain or snow ${Math.round(s.pop)}%` : "", s.snowNext >= 1 ? `${cm(s.snowNext)} new snow` : "", `sunset ${hm(s.set)}`].filter(Boolean).join(" · ")] : ""),
      extra: () => "",
      note: "Hikes near you: nearest first, ones with a closure, warning or fire near them last. Trail condition (snow, ice, mud, damp or firm, at the top of nearby hikes and the middle of saved ones): an estimate from snow depth, temperature, the last 2 days of rain and soil moisture, the middle of 3 weather models. Closures, warnings and fires from the feeds the app reads. Not a trail report.",
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
    // Day ride (moto-day.js, alex 2026-11-19): round-trip loops from here for the time you want to ride, with stops.
    near.unshift({ ll: null, name: "Day ride: loops from here", d: null, facts: "Pick how long you want to ride: loops that come back here, with hot springs, viewpoints and scenic roads on the way",
      open: () => { if (window.tfLoadSport) window.tfLoadSport("moto").then(() => { if (window.tfMotoDay) window.tfMotoDay.open({ from: { ll: from.ll, name: from.how === "you" ? "Where you are" : "The middle of the map" } }); }).catch(() => {}); } });
    return {
      near, saved, fish: false,
      brief: (s) => [["Rain or snow, last 2 days", mm(s.wetPast2)], ["Rain or snow, next 24 h", mm(s.wetNext)]],
      here: (s) => (s ? kv("Rain or snow, last 2 days", mm(s.wetPast2)) + kv("Rain or snow, next 24 h", mm(s.wetNext)) + kv("New snow, next 24 h", cm(s.snowNext)) + kv("High and low", `${deg(s.hi)} / ${deg(s.lo)}`) : ""),
      why: (x, s) => [x.facts, wet(s)],
      extra: () => "",
      note: "Rain and snow: a weather model's estimate at the route's start; dirt roads can stay muddy for days after rain, and passes can hold snow. Routes: the app's list of known adventure routes; check road closures before you go.",
    };
  }
  const BUILD = { ski, fish, hunt, hike, moto };

  // ---------- the card ----------
  // fill: reads today's numbers for the sport's card, unless they're under 20 minutes old and from the same place.
  // Closed, it reads only the weather where you are, for the short line (one place); open, every place on the card.
  async function fill(sp, force) {
    const W = WORDS[sp], c = card(sp);
    if (!W || !c) return;
    const from = whereFrom(), full = c.el.classList.contains("open");
    if (!force && c.at && (c.full || !full) && Date.now() - c.at < 20 * 60000 && Date.now() < c.until && c.day === localDay() && c.from && c.how === from.how && kmTo(c.from, from.ll) < 5) return;
    c.until = Infinity; c.day = localDay();   // refreshIfOld leaves a read in progress alone
    c.at = Date.now(); c.from = from.ll; c.how = from.how; c.full = full; c.acts = [];
    const my = ++c.seq, el = c.el, q = (s) => el.querySelector(s);
    const go = (f) => { c.acts.push(f); return c.acts.length - 1; };
    q(".tdy-from").textContent = from.how === "you" ? "Where you are, and your saved places" : "The middle of the map, and your saved places";
    q(".tdy-sum").innerHTML = q(".tdy-here").innerHTML = `<span class="tdy-wait">Checking today's weather…</span>`;
    q(".tdy-near").innerHTML = q(".tdy-saved").innerHTML = `<li class="tdy-wait">Loading…</li>`;
    q(".tdy-notes").innerHTML = "";
    let S;
    try { S = await BUILD[sp](from, !full); } catch { S = null; }
    if (my !== c.seq) return;
    // Didn't load, or the weather service busy (it limits calls a minute): read again once, a little later, if this
    // sport is still the one picked.
    const retry = () => { if (!c.retried) { c.retried = true; setTimeout(() => { if (my === c.seq && sportNow() === sp) fill(sp, true); }, 45000); } };
    c.until = (S && S.until) || Infinity;
    if (!S) { retry(); c.at = 0; q(".tdy-sum").innerHTML = q(".tdy-here").innerHTML = `<span class="tdy-wait">Today couldn't load. Try again in a minute.</span>`; q(".tdy-near").innerHTML = q(".tdy-saved").innerHTML = ""; return; }
    const places = full ? [from.ll, ...S.near.filter((x) => x.ll).map((x) => x.ll), ...S.saved.map((x) => x.ll)] : [from.ll];
    let wx = [], err = "";
    try { wx = await weather(places, S.fish, sp === "hike"); } catch (e) { c.at = 0; err = navigator.onLine ? "The weather service is busy: try again in a minute." : "No signal: the weather needs a connection."; }
    if (my !== c.seq) return;
    if (err) retry(); else c.retried = false;
    // The short line under the title: two or three of the same numbers as the top of the card, each with its name
    // (a number the weather didn't give is left out).
    const brief = wx[0] && S.brief ? S.brief(wx[0]).filter((p) => p && p[1] != null && p[1] !== "" && !/^[–\s/°C]*$/.test(p[1])) : [];
    q(".tdy-sum").innerHTML = err ? `<span>${esc(err)}</span>` : brief.length ? brief.map(([k2, v]) => `<span><span>${esc(k2)}</span>: <b>${esc(v)}</b></span>`).join(" · ") : `<span>${esc(W.near)}</span>`;
    if (!full) return;   // the lists fill when the card opens
    let k = 1;
    const nearS = S.near.map((x) => (x.ll ? wx[k++] : null)), savedS = S.saved.map(() => wx[k++]);
    const here = S.here(wx[0]) || "";
    // A weather error already shows in the line under the title: not a second time just below it.
    q(".tdy-here").innerHTML = here;
    q(".tdy-here").hidden = !here;
    // The avalanche line's index: 0 is here, then the near places, then the saved ones (ski only uses it).
    let ai = 1;
    const nearAi = S.near.map((x) => (x.ll ? ai++ : -1)), savedAi = S.saved.map(() => ai++);
    q(".tdy-near").innerHTML = S.near.length ? S.near.map((x, i) => row(go(x.open), x.name, S.why(x, nearS[i], nearAi[i]), S.noDist ? null : x.d, S.extra(x, nearS[i], nearAi[i]))).join("")
      : `<li class="tdy-wait">${esc(S.nearEmpty || "Nothing found near here.")}</li>`;
    q(".tdy-saved").innerHTML = S.saved.length ? S.saved.map((x, i) => row(go(x.open), x.name, S.why(x, savedS[i], savedAi[i]), x.d, S.extra(x, savedS[i], savedAi[i]))).join("")
      : `<li class="tdy-wait">${esc(W.none)}</li>`;
    q(".tdy-notes").innerHTML = [].concat(S.note).filter(Boolean).map((n) => `<p class="tdy-note">${esc(n)}</p>`).join("") + (wx[0] && window.tfWx ? window.tfWx.noteHtml(wx[0].w, { cls: "tdy-note" }) : "");
  }

  // Put the card in the sport's panel when that sport is picked (the other sports' panels arrive with their files),
  // and read its numbers then.
  const TAP = "Tap for today's weather, places near you and your saved places";
  let mountSeq = 0;
  async function mount() {
    const sp = sportNow(), my = ++mountSeq;
    if (!WORDS[sp]) return;
    const c = await until(() => card(sp), 15000);
    if (!c || my !== mountSeq) return;
    // "tf:todayAuto" false (the old pop-up's "Don't show when the app opens", and the test runs): nothing is read
    // until the card is opened.
    if (store.get("todayAuto", true) === false && !c.el.classList.contains("open")) { if (!c.at) c.el.querySelector(".tdy-sum").innerHTML = `<span>${esc(TAP)}</span>`; return; }
    fill(sp);
  }
  window.addEventListener("tf:sport", () => setTimeout(mount, 300));

  // Open the card from elsewhere (the More page's Today, the map sheet's Today line): the sport's tab, the card open,
  // scrolled to. MTB keeps status.js's Where to ride today.
  async function open(sp = sportNow()) {
    if (sp === "mtb") { if (window.tfTodayOpen0) window.tfTodayOpen0(); return; }
    if (!WORDS[sp]) return;
    const t = document.querySelector(`#tabbar [data-nav="${sp}"]`);
    if (t && t.getAttribute("aria-current") !== "true") t.click();
    const c = await until(() => card(sp), 15000);
    if (!c) return;
    if (!c.el.classList.contains("open")) toggle(sp, true); else fill(sp);
    if (window.tfSnapTo) window.tfSnapTo("half");   // phones: the sheet up from the map so the card shows
    setTimeout(() => { if (window.tfPanelScrollTo) window.tfPanelScrollTo(c.el); }, 300);
  }

  // Numbers that are no longer today's (2026-11-27 test: Skiing left open, the phone put away overnight and taken out
  // with no signal still showed yesterday's avalanche ratings and weather as today's): read again when the app comes
  // back to the front and the numbers are over 20 minutes old or the last read failed, when the signal comes back after
  // a failed read, and,
  // checked each minute while on screen, as soon as an avalanche bulletin on the card runs out or the day changes.
  // With no signal the read says so, and an expired bulletin shows no rating (winter.js avyToday).
  function refreshIfOld(e) {
    if (document.hidden) return;
    const sp = sportNow(), c = cards[sp];
    if (!c || !c.seq || !c.el.isConnected) return;
    const now = Date.now();
    if (now >= c.until || c.day !== localDay() || (e && e.type === "visibilitychange" && (!c.at || now - c.at > 20 * 60000))
      || (e && e.type === "online" && !c.at)) fill(sp, true);
  }
  document.addEventListener("visibilitychange", refreshIfOld);
  window.addEventListener("online", refreshIfOld);
  setInterval(refreshIfOld, 60000);

  // The More page's Today and the map sheet (index.html) call tfTodayOpen: MTB keeps status.js's card.
  window.tfTodayOpen0 = window.tfTodayOpen0 || window.tfTodayOpen;
  window.tfTodayOpen = () => open(sportNow());
  window.tfTodaySport = { open, fill: (sp) => fill(sp || sportNow(), true), mount };   // mount: a sport's scripts came late (winter.js)

  // When the app opens: the card in the sport's panel fills in once the map has settled (no pop-up, in any sport).
  const start = () => setTimeout(() => (window.requestIdleCallback ? requestIdleCallback(() => mount(), { timeout: 3000 }) : mount()), 3000);
  if (document.readyState === "complete") start(); else window.addEventListener("load", start, { once: true });
})();
