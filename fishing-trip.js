// Plan a fishing trip (Fishing), and keep its catches like a log book (alex 2026-11-16: the same trip planner for every
// sport, and for Fishing "used like a log book maybe?"). Built on trip-core.js, which has every part a trip shares (the
// group, packing with Who brings?, meals, booking, costs, journal, sharing by link, the plan you tell someone,
// offline); this file is Fishing's kit, from what Fishing already has (fishing.js window.tfFish.trip):
//  - The water: a lake, river or spot, from its spot card (Plan a fishing trip here) or the stocked waters near the
//    middle of the map. How you fish (Shore, Boat, Fly, Ice) sets the packing list.
//  - Each day: the fishing estimate (1 to 5, the same one as the spot card's: pressure, wind, cloud, rain, moon), the
//    weather (Open-Meteo, the middle of three models), wind, sunrise and sunset, the moon, and the tides when the water
//    is near the coast (Canadian Hydrographic Service). The river's flow right now against the usual for the month.
//    Kept with the trip for no signal. A day trip (0 nights) is allowed: many fishing trips are one day.
//  - Rules and licence: the official rules for the place (the same links as the spot card's Rules) and the licences
//    it needs, with a link to buy each, and a tick for each person once they have theirs. Nothing here says fishing
//    is allowed: the province's rules are the final word.
//  - Boat launches near the water (as mapped), one picked as the trip's launch; stocking near the water.
//  - Your lines: the walk in (the spot card's Route, then Add to fishing trip).
//  - Catch log: the trip's log book. Catches are added on the card (fish, size, fly or lure, kept or released, who) or
//    brought in from your private Fishing log (the catches you saved during the trip's dates near the water). No spot
//    or position goes in the trip: only the fish. Private by default (alex 2026-11-17 picked "Both"): your catches stay
//    yours (t.mine, never sent to the group) until you tap Share on one, which moves it to the group's log (t.catches).
// Trips are kept in tf:fishingTrips, on the account when signed in (account.js).
(() => {
  "use strict";
  const map = window.tfLeaflet, F = window.tfFish && window.tfFish.trip;
  if (!map || !window.L || !F || !window.tfTripEngine || (window.tfTrips && window.tfTrips.fish)) return;
  const isFish = () => document.body.classList.contains("sport-fish");
  const COL = F.ACC;   // the Fishing accent (deep teal)
  const LCOL = "#e8590c";   // the trip's lines (the walk in)
  const css = document.createElement("style");
  css.textContent = `#fishPane { --tp: ${COL}; }
html body #fishPane .fs-actions.trips { grid-template-columns: repeat(5, 1fr); }
#fishPane .fs-act[aria-pressed="true"] { background: ${COL}; border-color: ${COL}; color: #fff; }
#fishPane .fs-act[aria-pressed="true"] svg { color: #fff; }
#fishPane .tp-card { border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm); }
#fishPane .tp-card h3 { margin: 0; font-size: .95rem; font-weight: 800; }
#fishPane .tp-card .sk-x { float: right; font: inherit; border: 0; background: var(--chip); color: var(--muted); cursor: pointer; width: 28px; height: 28px; border-radius: 50%; }
#fishPane .tp-card .sk-sec { border-top: 1px solid var(--line); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; font-size: .85rem; }
#fishPane .tp-card .sk-sec h4 { margin: 0; font-size: .92rem; }
#fishPane .tp-card .sk-sec h5 { margin: 4px 0 0; font-size: .85rem; }
#fishPane .tp-card .sk-sec p { margin: 0; }
#fishPane .tp-card .sk-note, #fishPane .tp-addto .sk-note, #fishPane .tp-place-go .sk-note { color: var(--muted); font-size: .78rem; font-weight: 400; margin: 0; }
#fishPane .tp-style { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
#fishPane .tp-style button { font: inherit; font-size: .8rem; font-weight: 700; padding: 8px 4px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
#fishPane .tp-style button[aria-pressed="true"] { background: ${COL}; border-color: ${COL}; color: #fff; }
#fishPane .tp-warn { border-left: 4px solid ${COL}; padding: 4px 0 4px 9px; font-size: .82rem; }
#fishPane .tp-warn.bad { border-color: #c92a2a; }
#fishPane .tp-warn small { display: block; color: var(--muted); }
#fishPane .tp-warn a, #fishPane .tp-lic a { color: #1f5fe0; font-weight: 700; }
#fishPane .tp-lic { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
#fishPane .tp-lic li { border: 1px solid var(--line); border-radius: 10px; padding: 7px 10px; background: var(--panel); font-size: .84rem; }
#fishPane .tp-lic li small { display: block; color: var(--muted); }
#fishPane .tp-rules ul.fs-list { gap: 6px; }
#fishPane .tp-rules ul.fs-list li a { display: inline; color: #1f5fe0; font-weight: 700; }
#fishPane .tp-days .fs-stars { font-size: .95rem; }
#fishPane .tp-catchf { display: grid; grid-template-columns: 1fr 72px; gap: 6px; margin-top: 6px; }
#fishPane .tp-catchf input, #fishPane .tp-catchf select { font: inherit; font-size: 16px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); min-width: 0; box-sizing: border-box; width: 100%; }
#fishPane .tp-catchf .wide { grid-column: 1 / -1; }
#fishPane .tp-catchf .two { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#fishPane .tp-catchf button { grid-column: 1 / -1; font: inherit; font-size: .9rem; font-weight: 800; padding: 10px; border-radius: 11px; border: 0; background: ${COL}; color: #fff; cursor: pointer; }
#fishPane .tp-catches { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
#fishPane .tp-catches li { display: flex; align-items: center; gap: 8px; padding: 6px 4px 6px 10px; border: 1px solid var(--line); border-left: 4px solid ${COL}; border-radius: 10px; background: var(--panel); font-size: .86rem; }
#fishPane .tp-catches li > span { flex: 1; display: flex; flex-direction: column; min-width: 0; }
#fishPane .tp-catches li small { color: var(--muted); font-size: .76rem; }
#fishPane .tp-catches li button { font: inherit; border: 0; background: none; color: var(--muted); min-width: 34px; height: 34px; cursor: pointer; }
#fishPane .tp-catches li button.add { color: #fff; background: ${COL}; border-radius: 9px; font-weight: 800; font-size: .8rem; padding: 0 10px; }
#fishPane .tp-tally { margin: 2px 0; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, ${COL} 10%, var(--panel)); font-size: .86rem; line-height: 1.4; }
#fishPane .tp-place-go { display: flex; flex-direction: column; gap: 6px; margin: 2px 0 4px; }`;
  document.head.append(css);

  let E = null, $, esc, toast, when, dayWord, addDays, localDate;   // the engine (trip-core.js) and its helpers
  const cur = () => E.cur();
  const title = (t) => t.name || (t.hut && t.hut.name) || "My fishing trip";
  const STYLES = [["shore", "Shore"], ["boat", "Boat"], ["fly", "Fly"], ["ice", "Ice"]];
  const styleOf = (t) => t.style || (new Date(t.date + "T12:00").getMonth() <= 1 ? "ice" : "shore");
  const placeId = (lat, lon) => `w${(+lat).toFixed(4)},${(+lon).toFixed(4)}`;
  const at = (t) => (t.hut ? [t.hut.lat, t.hut.lon] : null);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const api = window.tfTripEngine((e) => { E = e; ({ $, esc, toast, when, dayWord, addDays, localDate } = e); return kit(); });
  if (!api) return;

  function kit() {
    return {
      id: "fish", key: "fishingTrips", packKey: "fishingPack", color: COL, lineColor: LCOL, pane: "fish", cardId: "fsTrip",
      shared: ["style", "launch", "lic", "catches"],
      minNights: 0,
      w: {
        icon: "🎣", trip: "fishing trip", Trips: "Fishing trips", btn: "🎣 Trips", btnTitle: "Plan a fishing trip: the water, each day's fishing estimate and weather, the rules and licences, launches, and a log of your catches",
        addTo: "🎣 Add to fishing trip", line: "Walk in", lines: "Your lines for this trip", goIn: "First day", first: "first day", last: "last day", prod: "Fishing trip",
        overdue: "a fishing trip", journal: "What worked, where the fish were, what to bring next time.", finding: "Finding stocked waters near here…",
        updates: "the trip's weather, fishing estimate and tides", offPrefix: "Fishing trip: ",
        offWhat: "the map and the fishing layers in the square you pick (it starts around the water and your lines)",
        offSaved: "the map and fishing layers", offFresh: "the trip's files", offOut: "a line added since",
      },
      groupGear: new Set(["aid", "sat", "net", "cooler", "boat", "anchor", "pump", "auger", "shelter", "heater", "stove", "tent", "bait", "launchfee", "fuel"]),
      isOn: isFish,
      mount(card, btn) {
        const pane = $("fishPane"), acts = pane && pane.querySelector(".fs-actions");
        if (!pane || !acts) return false;
        btn.className = "fs-act"; btn.dataset.act = "trip"; btn.id = "fsTripBtn";
        btn.innerHTML = `${F.svg('<path d="M3 20 12 4l9 16z"/><path d="M12 4v16M9 20l3-5 3 5"/>')}Trips`;
        acts.append(btn); acts.classList.add("trips");
        const spot = $("fsSpot");
        if (spot) spot.before(card); else pane.append(card);
      },
      title,
      namePh: () => "Like: Green Lake, Saturday",
      newTrip: () => ({ sport: "fish", nights: 0, people: 2, catches: [] }),
      start(t) {
        if (!t.sport) t.sport = "fish";
        E.loadDays(t);
        loadFacts(t);
      },
      hasDays: (t) => !!t.hut,
      keyOf: (t) => (t.hut ? t.hut.id : ""),
      snapOf, daysHtml, packItems, planText,
      bookTop: (t) => ({ tag: "", html: `<p class="sk-note">For a lodge, a campsite, a boat rental or a guide${t.hut ? ` near ${esc(t.hut.name)}` : ""}: keep the confirmation here.</p>` }),
      bookSite: () => "",
      bookWhat: (t) => `Book what the trip needs (lodge, campsite, boat or guide) for ${t.people} people.`,
      costHint: () => "Add the licences, launch fees, gas, bait, food and anything else the group shares.",
      baseHtml,
      midHtml: (t) => (t.hut ? `<div class="sk-sec" id="tpDays"><h4>Each day</h4>${E.daysHtml()}</div>
      <div class="sk-sec tp-rules" id="tpRules"><h4>Rules and licence</h4>${rulesHtml(t)}</div>
      <div class="sk-sec" id="tpWater"><h4>Launches and stocking</h4>${waterHtml(t)}</div>` : `<div class="sk-sec"><p class="sk-note">Pick the water: tap a lake or river on the map, then <b>Plan a fishing trip here</b> on its card (or <b>Fish here on this trip</b>), or pick a stocked water from the list.</p><ul class="tp-list" id="tpNear"></ul></div>`),
      afterLinesHtml: (t) => `<div class="sk-sec" id="tpCatch"><h4>Catch log</h4>${catchHtml(t)}</div>`,
      afterRender: (t) => { if (!t.hut) nearList(); },
      baseBtn: (t) => (t.hut ? `<button type="button" data-tp="water">The water's card</button>` : ""),
      linesEmpty: () => `No lines yet. On the water's card, tap <b>Route</b> for the walk in, then <b>🎣 Add to fishing trip</b>.`,
      drawLabel: () => "Route to the water",
      openLine, drawExtra, extraPts,
      gpxExtra: (t, trk, wpt) => (t.launch ? wpt(t.launch.lat, t.launch.lon, `Launch: ${t.launch.name}`) : ""),
      offBase: (t) => (t.hut && t.hut.name) || t.name || t.id,
      offUrls: () => [],
      onTp, nearList, datesChanged: () => {},
      listInfo: (t) => { const n = allCatches(t).length; return n ? ` · ${n} fish` : ""; },
      listNote: () => `Or start from the water: tap a lake or river on the map, then <b>🎣 Plan a fishing trip here</b> on its card, or pick a stocked water near the middle of the map:`,
    };
  }

  // ---------- the water, and how you fish ----------
  function baseHtml(t) {
    const st = styleOf(t);
    const style = `<div class="tp-style" role="group" aria-label="How you fish">${STYLES.map(([k, l]) => `<button type="button" data-fstyle="${k}" aria-pressed="${st === k}">${l}</button>`).join("")}</div>`;
    if (!t.hut) return style;
    const sp = F.species(t.hut.lat, t.hut.lon).slice(0, 6);
    return `${style}<div class="tp-facts"><span>${esc(t.hut.name)}</span>${sp.map((x) => `<span>${esc(x)}</span>`).join("")}${t.launch ? `<span>Launch: ${esc(t.launch.name)}</span>` : ""}</div>
      ${sp.length ? `<p class="sk-note">Fish listed: stocked in this water or close by (the stocking reports).</p>` : ""}`;
  }
  E.card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fstyle]"), t = cur();
    if (!b || !t) return;
    t.style = b.dataset.fstyle; E.putTrip(t); E.render();
  });
  function setWater(t, p) {
    t.hut = { id: placeId(p.lat, p.lon), name: String(p.name || "This spot").slice(0, 60), kind: "water", lat: +(+p.lat).toFixed(5), lon: +(+p.lon).toFixed(5) };
    if (!t.name && p.name && p.name !== "This spot") t.name = "";
    t.snap = null; delete t.rulesSnap; delete t.stockSnap; delete t.flowSnap;
    E.putTrip(t);
    if (cur() === t) { E.setView(null); E.render(); E.drawMap(); E.loadDays(t); loadFacts(t); }
  }

  // ---------- the map ----------
  function drawExtra(t, layer) {
    if (t.launch) L.circleMarker([t.launch.lat, t.launch.lon], { pane: "fish", radius: 7, color: "#fff", weight: 2.5, fillColor: F.C.launch, fillOpacity: 1, interactive: false }).addTo(layer);
  }
  function extraPts(t) { return t.launch ? [[t.launch.lat, t.launch.lon]] : []; }

  // ---------- each day ----------
  // The weather at the water (Open-Meteo through wxcheck.js: the middle of Environment Canada's, ECMWF's and NOAA's
  // models), about two weeks ahead, each day's fishing estimate from it (fishing.js dayScore), and the tides.
  const WX = [[0, "Clear"], [2, "Some cloud"], [3, "Cloudy"], [48, "Fog"], [57, "Drizzle"], [67, "Rain"], [77, "Snow"], [82, "Showers"], [86, "Snow showers"], [99, "Thunderstorms"]];
  const wxWord = (c) => (c == null ? "" : (WX.find((x) => c <= x[0]) || WX.at(-1))[1]);
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const compass = (d) => (d == null ? "" : DIRS[Math.round((((d % 360) + 360) % 360) / 45) % 8]);
  const hmIso = (iso) => { if (!iso) return ""; const [h, m] = iso.slice(11, 16).split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
  const hmMs = (ms) => new Date(ms).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
  async function snapOf(t) {
    const c = at(t);
    if (!c) return { err: "no water yet" };
    const dates = E.tripDates(t);
    const q = new URLSearchParams({ latitude: c[0].toFixed(3), longitude: c[1].toFixed(3), timezone: "auto", past_days: "1", forecast_days: "16", wind_speed_unit: "kmh",
      hourly: "temperature_2m,pressure_msl,wind_speed_10m,wind_gusts_10m,cloud_cover,precipitation",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset" });
    const url = `https://api.open-meteo.com/v1/forecast?${q}`;
    let w;
    try { w = window.tfWx ? await window.tfWx.getChecked(url) : await fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }); }
    catch (e) { return { err: e.message || "no signal" }; }
    const today = localDate(new Date());
    // The river's flow counts in the estimate only for today and tomorrow: it's a reading from now, not a forecast.
    const flow = await F.flowAt(c[0], c[1]).catch(() => null);
    let tides = null;
    if (F.nearTide(c[0], c[1])) tides = await F.tides(c[0], c[1], new Date(dates[0] + "T00:00"), new Date(addDays(dates.at(-1), 1) + "T00:00")).catch(() => null);
    const dd = w.daily || {}, end = dd.time ? dd.time.at(-1) : "";
    const rows = dates.map((date, j) => {
      const row = { date, tag: dates.length > 1 ? (j === 0 ? "first" : j === dates.length - 1 ? "last" : "") : "", moon: F.moon(date) };
      const i = dd.time ? dd.time.indexOf(date) : -1;
      if (i < 0) return row;
      const sc = w.hourly ? F.dayScore(w.hourly, date, flow && (date === today || date === addDays(today, 1)) ? flow.light : null) : null;
      if (tides) row.tides = tides.list.filter((x) => localDate(new Date(x[0])) === date).map((x) => [x[0], Math.round(x[1] * 10) / 10, x[2]]);
      return Object.assign(row, { code: dd.weather_code[i], hi: dd.temperature_2m_max[i], lo: dd.temperature_2m_min[i], rain: dd.precipitation_sum[i] || 0, snow: dd.snowfall_sum[i] || 0,
        pop: dd.precipitation_probability_max ? dd.precipitation_probability_max[i] : null, wind: dd.wind_speed_10m_max[i], gust: dd.wind_gusts_10m_max[i],
        dir: compass(dd.wind_direction_10m_dominant ? dd.wind_direction_10m_dominant[i] : null), rise: dd.sunrise[i], set: dd.sunset[i], s: sc ? sc.s : null, why: sc ? sc.why : [] });
    });
    return { snap: { at: Date.now(), rows, end, models: (w.check && w.check.models) || [], tideAt: tides ? tides.name : "",
      flow: flow ? { name: flow.name, word: flow.word, color: flow.color, tip: flow.tip, ratio: flow.ratio, light: flow.light } : null } };
  }
  const stars = (n) => `<span class="fs-stars" data-no-line aria-label="${n} of 5">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>`;
  const deg = (v) => (v == null ? "–" : `${Math.round(v) === 0 ? 0 : Math.round(v)}°`);
  function daysHtml(t, v) {
    const rows = v.rows.map((r) => {
      const c = r.s == null ? "var(--line)" : ["#e5484d", "#f07b3f", "#f2b33d", "#a3c94f", "#22b07d"][r.s - 1];
      const wx = r.code != null ? `<span class="tp-wx"><big>${deg(r.hi)}</big><br><span>low ${deg(r.lo)}</span></span>` : `<span class="tp-wx sk-note">${v.end && r.date > v.end ? "Too far<br>ahead" : "–"}</span>`;
      const bits = r.code != null ? [r.snow >= 0.5 ? `${Math.round(r.snow)} cm of snow` : r.rain >= 1 ? `${Math.round(r.rain)} mm of rain${r.pop != null ? ` (${r.pop}% chance)` : ""}` : "Dry",
        `wind ${Math.round(r.wind || 0)} km/h${r.dir ? ` ${r.dir}` : ""}${r.gust >= 40 ? `, gusts ${Math.round(r.gust)}` : ""}`, ...(r.why || []).filter((x) => !/^(windy|light chop|calm)/.test(x)), r.moon && !(r.why || []).some((x) => /moon/.test(x)) ? r.moon : "",
        r.rise ? `sun ${hmIso(r.rise)} to ${hmIso(r.set)}` : ""].filter(Boolean) : [r.moon || ""].filter(Boolean);
      const tide = (r.tides || []).length ? `<small>${r.tides.map((x) => `<span>${x[2] === "High" ? "high tide" : "low tide"} ${esc(hmMs(x[0]))}, ${x[1]} m</span>`).join(" · ")}</small>` : "";
      return `<li style="--c:${c}"><b>${esc(dayWord(r.date))}${r.tag ? ` · ${r.tag === "first" ? "first day" : "last day"}` : ""}</b>${wx}<span>${r.s != null ? `${stars(r.s)} <span class="sk-note">fishing estimate</span>` : ""}${r.code != null ? ` <span>${esc(wxWord(r.code))}</span>` : ""}</span>${bits.length ? `<small>${bits.map((x) => `<span>${esc(x)}</span>`).join(" · ")}</small>` : ""}${tide}</li>`;
    }).join("");
    const far = v.rows.some((r) => r.code == null && v.end && r.date > v.end), f = v.flow;
    return `${f ? `<div class="tp-warn" style="border-color:${esc(f.color)}"><b>River now: ${esc(f.name)}, ${esc(f.word)}</b><small>${esc([f.ratio, f.tip].filter(Boolean).join(". "))}. Environment Canada river gauge, read ${esc(when(v.at))}: a reading from now, not a forecast for your dates.</small></div>` : ""}
      <ul class="tp-days">${rows}</ul>
      <p class="sk-note">${v.old ? `<b>Saved forecast from ${esc(when(v.at))}</b> (no signal now). ` : v.at ? `Checked ${esc(when(v.at).replace(/\.$/, ""))}${t.autoAt && Math.abs(t.autoAt - v.at) < 60000 ? " (updated by itself)" : ""}. ` : ""}The fishing estimate (1 to 5) comes from the pressure, wind, cloud, rain and moon${f ? ", and the river's flow for today and tomorrow" : ""}: what many anglers go by, not a promise of fish. Weather at the water: ${v.models && v.models.length ? `the middle of ${v.models.length} weather models` : "Open-Meteo"}, an estimate${far ? `, about two weeks ahead at most: come back closer to the trip` : ""}.${v.tideAt ? ` Tides at ${esc(v.tideAt)}: Canadian Hydrographic Service predictions, not for navigation.` : ""}</p>`;
  }

  // ---------- rules and licence, launches and stocking ----------
  // From fishing.js: the rules for the place (the zones file, the same links as the spot card), the licences it needs,
  // launches near the water and stocking. Kept with the trip (t.rulesSnap, t.stockSnap) for no signal.
  async function loadFacts(t) {
    const c = at(t);
    if (!c) return;
    const [r, st] = await Promise.all([F.rules(c[0], c[1]).catch(() => null), F.stockedNear(c[0], c[1], 5).catch(() => null)]);
    const x = E.tripById(t.id) || t;
    if (r) x.rulesSnap = { at: Date.now(), ...r };
    if (st) x.stockSnap = st.slice(0, 4).map((s) => ({ n: s.n, d: Math.round(s.d * 10) / 10, last: s.last || "", sp: (s.sp || []).slice(0, 4) }));
    E.putTrip(x, true);
    if (cur() === x) { renderPart("tpRules", "Rules and licence", rulesHtml); renderPart("tpWater", "Launches and stocking", waterHtml); E.renderPack(); }
  }
  const renderPart = (id, h, f) => { const el = E.part(id), t = cur(); if (el && t) el.innerHTML = `<h4>${h}</h4>${f(t)}`; };
  function rulesHtml(t) {
    const r = t.rulesSnap;
    if (!r) return `<p class="tp-wait">Looking up the rules and licences for this water…</p>`;
    const who = E.names(t), has = t.lic || {};
    const lic = r.lic.length ? `<ul class="tp-lic">${r.lic.map((l) => `<li><b>${esc(l.n)}</b>${l.url ? ` · <a href="${esc(l.url)}" target="_blank" rel="noopener">Buy or check</a>` : ""}${l.why ? `<small>${esc(l.why)}</small>` : ""}</li>`).join("")}</ul>` : "";
    const ticks = who.length ? `<p class="sk-note">Tap each person once they have their licence for these dates:</p><div class="tp-split" role="group" aria-label="Who has a licence">${who.map((n) => `<button type="button" class="tp-chip" data-lic="${esc(n)}" aria-pressed="${!!has[n]}">${esc(n)}</button>`).join("")}</div>`
      : `<label class="tp-check"><input type="checkbox" data-licme="1" ${has.me ? "checked" : ""}> <span>I have my licence for these dates</span></label>`;
    return `${r.nofish ? `<div class="tp-warn bad"><b>Part of this place is an ecological reserve</b><small>Fishing there needs a permit: see the rules below.</small></div>` : ""}
      ${lic}${ticks}
      ${r.html ? `<details class="tp-pack"><summary>Official rules for ${esc(r.provName || "this place")}</summary>${r.html.replace(/^<h4>[\s\S]*?<\/h4>/, "")}</details>` : r.regs ? `<p><a href="${esc(r.regs)}" target="_blank" rel="noopener">${esc(r.provName)} fishing regulations</a></p>` : ""}
      <p class="sk-note">A guide, not the law: links to each province's and Canada's own rules, from their open data, which can be late or simplified. Check the regulations and any in-season changes for this water before you fish. Each person's tick is the group's own note; the app doesn't check licences.</p>`;
  }
  E.card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-lic]"), t = cur();
    if (!b || !t) return;
    const n = b.dataset.lic, l = { ...(t.lic || {}) };
    if (l[n]) delete l[n]; else l[n] = 1;
    t.lic = l; E.putTrip(t); renderPart("tpRules", "Rules and licence", rulesHtml); E.renderPack();
  });
  E.card.addEventListener("change", (e) => {
    const t = cur();
    if (!t || !e.target.dataset.licme) return;
    const l = { ...(t.lic || {}) };
    if (e.target.checked) l.me = 1; else delete l.me;
    t.lic = l; E.putTrip(t); E.renderPack();
  });
  function waterHtml(t) {
    const c = at(t);
    if (!c) return "";
    const ls = F.launchesNear(c[0], c[1], 8).slice(0, 5), mine = t.launch;
    const opts = [...(mine && !ls.some((x) => x.id === mine.id) ? [{ ...mine, d: F.km(c[0], c[1], mine.lat, mine.lon) }] : []), ...ls];
    const launches = opts.length ? `<ul class="tp-list">${opts.map((x) => `<li><button type="button" data-launch="${esc(x.id)}"><span>${mine && mine.id === x.id ? "✓ " : ""}${esc(x.name)} <small>${esc(x.facts || "boat launch")}</small></span><small>${esc(F.fmtKm(x.d))}</small></button></li>`).join("")}</ul>
      <p class="sk-note">${mine ? "Tap another to change the trip's launch, or the same one to take it off." : "Tap one to make it the trip's launch (on the map, the GPX and the plan)."} As mapped on OpenStreetMap and the provinces' access data: check access, fees and the ramp's state locally.</p>`
      : `<p class="sk-note">No boat launches loaded near this water: zoom the map in on it (launches show from closer in), then come back here.</p>`;
    const st = t.stockSnap || [];
    const stock = st.length ? `<h5>Stocked near here</h5><ul class="tp-list">${st.map((s) => `<li><button type="button" data-stock="${esc(s.n)}"><span>${esc(s.n)} <small>${esc([s.sp.join(", "), s.last ? `last ${s.last}` : ""].filter(Boolean).join(" · "))}</small></span><small>${esc(F.fmtKm(s.d))}</small></button></li>`).join("")}</ul><p class="sk-note">From the provinces' stocking reports.</p>` : "";
    return `${launches}${stock}`;
  }
  E.card.addEventListener("click", (e) => {
    const t = cur(), b = e.target.closest("[data-launch]");
    if (!b || !t) return;
    const c = at(t), x = F.launchesNear(c[0], c[1], 8).find((y) => y.id === b.dataset.launch) || (t.launch && t.launch.id === b.dataset.launch ? t.launch : null);
    if (!x) return;
    if (t.launch && t.launch.id === x.id) delete t.launch;
    else t.launch = { id: x.id, name: x.name, lat: +x.lat.toFixed(5), lon: +x.lon.toFixed(5) };
    E.putTrip(t); E.render(); E.drawMap();
  });

  // ---------- catch log ----------
  // The trip's log book: each catch's fish, size, fly or lure, kept or released, who and when. No position: anglers
  // keep their spots. Your catches are private (t.mine: on this phone and your account, never in the group's copy)
  // until you tap Share on one: then it moves to the group's log (t.catches), which everyone with the link sees.
  // "From your Fishing log": your private catches saved during the trip's dates within 30 km of the water.
  const groupOf = (t) => t.catches || [];
  const mineOf = (t) => t.mine || [];
  const allCatches = (t) => [...mineOf(t), ...groupOf(t)];
  const fromLog = (t) => {
    const P = window.tfPoints, c = at(t);
    if (!P || !P.catches || !c) return [];
    const dates = new Set(E.tripDates(t)), have = new Set(allCatches(t).map((x) => x.from).filter(Boolean));
    return P.catches().filter((p) => dates.has(p.day) && !have.has(p.id) && F.km(c[0], c[1], p.lat, p.lon) <= 30);
  };
  const catchLine = (x) => [x.len ? `${x.len} cm` : "", x.fly, x.kept === "kept" ? "kept" : "released"].filter(Boolean).join(", ");
  function tally(t) {
    const l = allCatches(t);
    if (!l.length) return "";
    const by = {}, who = {};
    l.forEach((x) => { const k = x.sp || "Not set"; by[k] = (by[k] || 0) + 1; if (x.by) who[x.by] = (who[x.by] || 0) + 1; });
    const big = l.filter((x) => x.len).sort((a, b) => b.len - a.len)[0], kept = l.filter((x) => x.kept === "kept").length;
    return `<div class="tp-tally"><b>${l.length} fish</b>: ${esc(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", "))}${big ? `<br>Biggest: ${esc(big.sp || "fish")}, ${big.len} cm${big.by ? ` (${esc(big.by)})` : ""}` : ""}<br>${kept} kept, ${l.length - kept} released${Object.keys(who).length > 1 ? `<br>${esc(Object.entries(who).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(" · "))}` : ""}</div>`;
  }
  let catchDraft = {};
  function catchHtml(t) {
    const sorted = (l) => l.slice().sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
    const logs = fromLog(t), dates = E.tripDates(t), today = localDate(new Date()), d0 = catchDraft.date || (dates.includes(today) ? today : dates[0]);
    const sp = t.hut ? F.species(t.hut.lat, t.hut.lon) : [], me = E.meOf(t), who = E.names(t), sh = !!t.share;
    const row = (x, mine) => `<li><span><b>${esc(x.sp || "Fish")}</b><small>${esc([catchLine(x), dates.length > 1 ? dayWord(x.date) : "", x.time, x.by].filter(Boolean).join(" · "))}</small>${mine ? "" : E.byHtml(t, x.ab && x.ab !== x.by ? x : null)}</span>${sh && mine ? `<button type="button" class="add" data-cxshare1="${esc(x.id)}">Share</button>` : sh && !mine && (!x.ab || x.ab === me) ? `<button type="button" data-cxunshare="${esc(x.id)}" aria-label="Take it back: only you see it">Only me</button>` : ""}<button type="button" data-cxrm="${esc(x.id)}" aria-label="Delete this catch">✕</button></li>`;
    const mine = sorted(mineOf(t)), group = sorted(groupOf(t));
    const lists = sh ? `${mine.length ? `<h5>Only you see these</h5><ul class="tp-catches">${mine.map((x) => row(x, true)).join("")}</ul>` : ""}${group.length ? `<h5>The group's log</h5><ul class="tp-catches">${group.map((x) => row(x, false)).join("")}</ul>` : ""}`
      : `<ul class="tp-catches">${sorted(allCatches(t)).map((x) => row(x, mineOf(t).includes(x))).join("")}</ul>`;
    return `${tally(t)}
      ${mine.length || group.length ? lists : `<p class="sk-note">No catches yet. Add each fish here as you go (or after), and the trip keeps its own log book: what you caught, how big, on what, and who.</p>`}
      ${logs.length ? `<h5>From your Fishing log</h5><ul class="tp-catches">${logs.map((p) => `<li><span><b>${esc(p.c.species || p.name || "Fish")}</b><small>${esc([catchLine({ len: p.c.len, fly: p.c.fly, kept: p.c.kept }), dayWord(p.day), p.c.time].filter(Boolean).join(" · "))}</small></span><button type="button" class="add" data-cxlog="${esc(p.id)}">Add</button></li>`).join("")}</ul>
        <p class="sk-note">Catches you saved with Save a catch during these dates near this water. Adding one copies the fish into this trip, not where you caught it${sh ? ", and only you see it until you tap Share" : ""}.</p>${logs.length > 1 ? `<div class="tp-btns"><button type="button" data-cxlogall="1">Add all ${logs.length}</button></div>` : ""}` : ""}
      <form class="tp-catchf" data-cxadd="1">
        <input type="text" name="sp" maxlength="40" list="tpFishList" placeholder="Fish (like rainbow trout)" aria-label="Fish" value="${esc(catchDraft.sp || "")}" autocomplete="off">
        <input type="number" name="len" min="0" max="300" step="0.5" inputmode="decimal" placeholder="cm" aria-label="Length in cm" value="${esc(catchDraft.len || "")}">
        <input class="wide" type="text" name="fly" maxlength="60" placeholder="Fly, lure or bait" aria-label="Fly, lure or bait" value="${esc(catchDraft.fly || "")}" autocomplete="off">
        <div class="two"><select name="kept" aria-label="Kept or released"><option value="released">Released</option><option value="kept" ${catchDraft.kept === "kept" ? "selected" : ""}>Kept</option></select>
          ${who.length ? `<select name="by" aria-label="Who caught it"><option value="">Who caught it?</option>${who.map((n) => `<option ${n === (catchDraft.by || me) ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>` : `<input type="text" name="by" maxlength="30" placeholder="Who caught it?" aria-label="Who caught it" value="${esc(catchDraft.by || me || "")}">`}</div>
        ${dates.length > 1 ? `<select class="wide" name="date" aria-label="Which day">${dates.map((d) => `<option value="${d}" ${d === d0 ? "selected" : ""}>${esc(dayWord(d))}</option>`).join("")}</select>` : ""}
        ${sh ? `<label class="tp-check wide"><input type="checkbox" name="share" ${catchDraft.share ? "checked" : ""}> <span>Share it with the group</span></label>` : ""}
        <button type="submit">Add the catch</button>
        <datalist id="tpFishList">${[...new Set([...sp, "Rainbow trout", "Cutthroat trout", "Brook trout", "Brown trout", "Bull trout", "Lake trout", "Kokanee", "Walleye", "Northern pike", "Yellow perch", "Smallmouth bass", "Largemouth bass", "Coho salmon", "Chinook salmon", "Steelhead", "Arctic grayling", "Lake whitefish"])].map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
      </form>
      ${allCatches(t).length ? `<div class="tp-btns"><button type="button" data-cxshare="1">📤 Send the catch list</button></div>` : ""}
      <p class="sk-note">${sh ? "Your catches stay private until you tap Share on one: then everyone with the trip's link sees it. " : "Only you see your catches. If you share the trip, they stay private until you tap Share on one. "}Only the fish go in the trip, never where you caught them. Save a catch on the map keeps the spot in your private Fishing log.</p>`;
  }
  const renderCatch = () => renderPart("tpCatch", "Catch log", catchHtml);
  E.card.addEventListener("input", (e) => {
    const f = e.target.closest("[data-cxadd]");
    if (f && e.target.name) catchDraft[e.target.name] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  });
  E.card.addEventListener("change", (e) => {
    const f = e.target.closest("[data-cxadd]");
    if (f && e.target.name) catchDraft[e.target.name] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  });
  E.card.addEventListener("submit", (e) => {
    const f = e.target, t = cur();
    if (!f.dataset.cxadd || !t) return;
    e.preventDefault();
    const v = (n) => { const el = f.elements[n]; return el ? String(el.value || "").trim() : ""; };
    const sp = v("sp").replace(/\s+/g, " ").slice(0, 40);
    if (!sp) { toast("Add which fish it was."); const i = f.elements.sp; if (i) i.focus(); return; }
    const dates = E.tripDates(t), today = localDate(new Date()), len = Math.max(0, Math.min(300, parseFloat(v("len")) || 0));
    const date = v("date") || (dates.includes(today) ? today : dates[0]), share = !!(t.share && f.elements.share && f.elements.share.checked);
    const x = { id: E.uid("f"), sp, date, kept: v("kept") === "kept" ? "kept" : "released", ...(len ? { len: Math.round(len * 2) / 2 } : {}), ...(v("fly") ? { fly: v("fly").slice(0, 60) } : {}),
      ...(v("by") ? { by: v("by").slice(0, 30) } : {}), ...(date === today ? { time: new Date().toTimeString().slice(0, 5) } : {}), ...(E.meOf(t) ? { ab: E.meOf(t) } : {}) };
    if (share) t.catches = [...groupOf(t), x]; else t.mine = [...mineOf(t), x];
    catchDraft = { by: x.by, fly: x.fly, date: v("date"), share };   // the next fish is often the same person on the same fly
    E.putTrip(t); renderCatch();
    toast(share ? `${sp} added to the group's log.` : `${sp} added to the trip's log.`); window.tfHappy && window.tfHappy("fish catch");
  });
  function addFromLog(t, list) {
    const me = E.meOf(t);
    t.mine = [...mineOf(t), ...list.map((p) => ({ id: E.uid("f"), from: p.id, sp: (p.c.species || p.name || "Fish").slice(0, 40), date: p.day, kept: p.c.kept === "kept" ? "kept" : "released",
      ...(p.c.len ? { len: p.c.len } : {}), ...(p.c.fly ? { fly: p.c.fly } : {}), ...(p.c.time ? { time: p.c.time } : {}), ...(me ? { by: me, ab: me } : {}) }))];
    E.putTrip(t); renderCatch();
  }
  E.card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cxrm], [data-cxlog], [data-cxlogall], [data-cxshare], [data-cxshare1], [data-cxunshare]"), t = cur();
    if (!b || !t) return;
    if (b.dataset.cxrm) {
      if (!confirm("Delete this catch from the trip's log?")) return;
      t.mine = mineOf(t).filter((x) => x.id !== b.dataset.cxrm); t.catches = groupOf(t).filter((x) => x.id !== b.dataset.cxrm); E.putTrip(t); renderCatch(); return;
    }
    if (b.dataset.cxshare1) {   // one of yours, into the group's log
      const x = mineOf(t).find((y) => y.id === b.dataset.cxshare1); if (!x) return;
      t.mine = mineOf(t).filter((y) => y !== x); t.catches = [...groupOf(t), x]; E.putTrip(t); renderCatch(); toast("Shared: the group sees it now."); return;
    }
    if (b.dataset.cxunshare) {   // back to only you
      const x = groupOf(t).find((y) => y.id === b.dataset.cxunshare); if (!x) return;
      t.catches = groupOf(t).filter((y) => y !== x); t.mine = [...mineOf(t), x]; E.putTrip(t); renderCatch(); toast("Only you see it now."); return;
    }
    if (b.dataset.cxlog) { const p = fromLog(t).find((y) => y.id === b.dataset.cxlog); if (p) addFromLog(t, [p]); return; }
    if (b.dataset.cxlogall) { addFromLog(t, fromLog(t)); return; }
    const l = allCatches(t).slice().sort((a, c) => (a.date + (a.time || "")).localeCompare(c.date + (c.time || "")));
    E.shareText(`Catches: ${title(t)}`, `Catches on our ${title(t)} trip (${dayWord(t.date)}, ${E.nightsW(t)}): ${l.length} fish\n` + l.map((x) => `- ${x.sp}${catchLine(x) ? `, ${catchLine(x)}` : ""}${x.by ? ` (${x.by})` : ""}${E.tripDates(t).length > 1 ? `, ${dayWord(x.date)}` : ""}`).join("\n"));
  });
  // A catch saved in the Fishing log while the trip is open: it shows under From your Fishing log right away.
  window.addEventListener("tf:points", () => { if (cur() && !E.card.hidden && E.part("tpCatch")) { const a = document.activeElement; if (!(a && E.card.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) renderCatch(); } });

  // ---------- packing list ----------
  // Built from the trip: how you fish, nights and people, the coldest and wettest day in the forecast, the licences
  // the place needs, the trip's launch, and what usually hatches that month there.
  function packItems(t, view) {
    const n = t.nights, p = t.people, st = styleOf(t), r = t.rulesSnap, c = at(t);
    const rows = view && view.rows ? view.rows.filter((x) => x.code != null) : [];
    const cold = rows.length ? Math.min(...rows.map((x) => x.lo)) : null, wet = rows.some((x) => x.rain >= 2), windy = rows.some((x) => x.gust >= 40);
    const month = new Date(t.date + "T12:00").getMonth() + 1, hatch = c ? F.hatch(c[0], c[1], month).slice(0, 3) : [];
    const lic = r ? r.lic.filter((l) => l.url) : [];
    return [
      ["Licence and rules", [
        ...(lic.length ? lic.map((l) => [`lic_${l.k}`, `${l.n}${p > 1 ? " for each person who fishes" : ""}: on your phone or printed`]) : [["lic", `Fishing licence${p > 1 ? " for each person who fishes" : ""}: on your phone or printed`]]),
        ["regs", "This water's rules saved or printed (limits, sizes, tackle, closed times)"],
        ["tape", "Measuring tape or a marked rod: size limits"]]],
      ["Fishing gear", [
        ["rod", st === "fly" ? "Fly rod, reel and spare spool (floating and sinking line)" : st === "ice" ? "Ice rods and reels" : "Rod and reel, and a spare rod"],
        ["line", st === "fly" ? "Leaders and tippet" : "Spare line, leaders, swivels and snaps"],
        ...(st === "fly" ? [["flies", hatch.length ? `Flies for ${MONTHS[month - 1]}: ${hatch.map((h) => h.flies).join("; ")}` : "Flies: nymphs, streamers and a few dries"]]
          : [["tackle", "Tackle box: hooks, weights, lures"], ["bait", "Bait (check the rules: some waters ban live bait)"]]),
        ["net", "Landing net (a rubber one is easier on fish you release)"], ["pliers", "Pliers or forceps, line clippers"],
        ...(st !== "fly" && st !== "ice" ? [["rodholder", "Rod holder or sand spike"]] : []),
        ["cooler", "Cooler and ice for fish you keep"], ["knife", "Fillet knife and a bag for fish"]]],
      ...(st === "boat" ? [["Boat", [
        ["pfd", `Life jacket or PFD for each person on board (${p})`], ["boat", "Boat, canoe or kayak, paddles or oars"],
        ["boatkit", "Bailer, whistle or horn, buoyant heaving line (Transport Canada's small boat list)"], ["anchor", "Anchor and rope"],
        ["fuel", "Fuel and the boat's licence or registration"], ["launchfee", t.launch ? `Launch fee or pass for ${t.launch.name}, if it has one` : "Launch fee or pass, if the launch has one"],
        ...(windy ? [["wind", "Plan for wind: gusts of 40 km/h or more in the forecast"]] : [])]]] : []),
      ...(st === "fly" ? [["Wading", [["waders", "Waders and wading boots"], ["staff", "Wading staff"], ["polar", "Polarized sunglasses"]]]] : []),
      ...(st === "ice" ? [["On the ice", [
        ["auger", "Ice auger (and spare blades or battery)"], ["picks", "Ice picks around your neck"], ["cleats", "Ice cleats"], ["spud", "Spud bar or chisel to test the ice"],
        ["shelter", "Ice shelter"], ["heater", "Heater and its fuel (keep the shelter vented)"], ["skimmer", "Skimmer and a sled to haul gear"],
        ["icecheck", "Check the ice thickness yourself as you go: the app doesn't know it"]]]] : []),
      ["Essentials", [
        ["aid", "First aid kit"], ["sun", "Hat, sunscreen and polarized sunglasses"], ["bugs", "Bug spray"], ["lamp", "Headlamp"],
        ["power", "Phone charged + power bank"], ["sat", "Satellite messenger or PLB: many lakes and rivers have no cell signal"],
        ["bear", "Bear spray, where you can reach it"], ["water", "Water and snacks"]]],
      ["Clothes", [
        ["rain", wet ? "Rain jacket and pants: rain in the forecast" : "Rain jacket"],
        ["warm", cold != null && cold < 5 ? `Warm layer, toque and gloves: down to ${Math.round(cold)}°C` : "Warm layer"],
        ["boots", st === "ice" ? "Warm waterproof boots and dry socks" : "Boots or shoes that can get wet, dry socks"]]],
      ...(n > 0 ? [["Where you sleep", [["tent", "Tent, sleeping bags and pads, or your lodge or cabin booking"], ["stove", "Stove, fuel and a pot"], ["food", `Food for ${n + 1} days${p > 1 ? ` for ${p}` : ""}`]]]] : []),
      ["Before you go", [["offline", "Trip saved offline (button below)"], ["plan", "Trip plan left with a friend (below)"]]],
    ];
  }

  // ---------- the plan you leave with someone ----------
  function planText(t, pl) {
    const ll = (a) => `${a.lat.toFixed(5)}, ${a.lon.toFixed(5)} https://www.google.com/maps?q=${a.lat.toFixed(5)},${a.lon.toFixed(5)}`;
    const st = styleOf(t), how = { shore: "from shore", boat: "from a boat", fly: "fly fishing (wading)", ice: "ice fishing" }[st];
    return [`TRIP PLAN: ${title(t)} (fishing, ${how})`,
      `Who: ${pl.who || "me"}${t.people > 1 ? ` (${t.people} people)` : ""}`,
      ...(t.hut ? [`Water: ${t.hut.name}, ${ll(t.hut)}`] : []),
      ...(t.launch ? [`Boat launch: ${t.launch.name}, ${ll(t.launch)}`] : []),
      `${t.nights ? `First day: ${dayWord(t.date)}. Nights: ${t.nights}` : `Day: ${dayWord(t.date)}`}. Back at the car by ${when(pl.out)}`,
      ...(E.linesOf(t).length ? [`Lines: ${E.linesOf(t).map((x) => x.name).join(", ")}`] : []),
      ...(pl.car ? [`Car: ${pl.car}`] : []),
      ...(st === "boat" ? [`Boat: describe it here (colour, size, motor)`] : []),
      ``, `If you haven't heard from us by ${when(pl.help)}: call 911 (or the RCMP) and say we're overdue on a fishing trip${st === "boat" ? " on the water" : st === "ice" ? " on the ice" : ""}. Read them this plan.`,
    ].join("\n");
  }

  // ---------- lines: the walk in, from the spot card's Route ----------
  function openLine(t, x) {
    map.fitBounds(L.latLngBounds(x.ls.flat()), { padding: [30, 30], maxZoom: 15 });
    if (window.tfSnapTo) window.tfSnapTo("peek");
  }
  function onTp(k, t) {
    if (!t.hut) { toast("Pick the water first."); return; }
    if (k === "water") { F.show(t.hut.lat, t.hut.lon, t.hut.name); return; }
    if (k === "drawline") {
      F.show(t.hut.lat, t.hut.lon, t.hut.name);
      setTimeout(() => { if (window.tfFishRoute) window.tfFishRoute.start(t.hut.lat, t.hut.lon, t.hut.name); }, 400);
      toast("Working out the walk in: then tap 🎣 Add to fishing trip under the route.");
    }
  }
  window.addEventListener("tf:fish-route", (e) => {
    const { box, item } = e.detail || {};
    if (!box || !item) return;
    box.querySelectorAll(".tp-addto").forEach((x) => x.remove());
    const end = document.createElement("div");
    box.append(end);
    E.offerAdd(end, () => item);
    end.remove();
  });

  // ---------- the spot card: Plan a fishing trip here ----------
  window.addEventListener("tf:fish-spot", (e) => {
    const { el, lat, lon, name } = e.detail || {};
    if (!el) return;
    el.querySelectorAll(".tp-place-go").forEach((x) => x.remove());
    const head = el.querySelector("header");
    if (!head) return;
    const box = document.createElement("div");
    box.className = "tp-place-go";
    const t = cur() && !E.card.hidden ? cur() : null, id = placeId(lat, lon);
    const nm = () => F.spotName() || name || "This spot";
    const b = (txt, f) => { const x = document.createElement("button"); x.type = "button"; x.className = "sk-tripgo"; x.textContent = txt; x.addEventListener("click", f); box.append(x); };
    if (t && t.hut && t.hut.id === id) box.innerHTML = `<p class="sk-note">✓ The water of your trip: ${esc(title(t))}</p>`;
    else if (t) b(`🎣 Fish here on ${title(t)}`, () => { setWater(t, { lat, lon, name: nm() }); toast(`${t.hut.name} is the trip's water.`); E.scrollTo(); });
    else b("🎣 Plan a fishing trip here", () => openFrom({ lat, lon, name: nm() }));
    const route = el.querySelector("#fsRoute");
    (route || head).after(box);
  });
  function openFrom(p) {
    const id = placeId(p.lat, p.lon), old = E.trips().find((x) => x.hut && x.hut.id === id && x.date >= localDate(new Date()));
    if (old) { E.start(old); return; }
    const t = E.newTrip();
    setWater(t, p);
    E.start(t);
  }

  // ---------- the trips list: stocked waters near the middle of the map ----------
  async function nearList() {
    const el = E.part("tpNear");
    if (!el) return;
    const c = map.getCenter(), list = await F.stockedNear(c.lat, c.lng, 30).catch(() => []);
    const el2 = E.part("tpNear");
    if (!el2) return;
    const seen = new Set(), l = list.filter((x) => !seen.has(x.n) && seen.add(x.n)).slice(0, 8);
    el2.innerHTML = l.length ? l.map((x) => `<li><button type="button" data-fsw="${esc(x.c.join(","))}" data-n="${esc(x.n)}"><span>${esc(x.n)} <small>${esc((x.sp || []).slice(0, 2).join(", ").toLowerCase())}</small></span><small>${esc(F.fmtKm(x.d))}</small></button></li>`).join("")
      : `<li class="sk-note">No stocked waters near the middle of the map: tap the water you want on the map instead.</li>`;
  }
  E.card.addEventListener("click", (e) => {
    const a = e.target.closest("[data-fsw]");
    if (!a) return;
    const [lat, lon] = a.dataset.fsw.split(",").map(Number), t = cur();
    if (t && !t.hut) setWater(t, { lat, lon, name: a.dataset.n });
    else openFrom({ lat, lon, name: a.dataset.n });
  });
  window.tfFishTrip = api;
})();
