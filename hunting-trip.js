// Plan a hunting trip (Hunting): a multi-day hunt with a camp, and the log book of what the group saw and took (alex
// 2026-11-16/17: the same trip planner for every sport; Hunting "used like a log book and a planning tool for multi-day
// missions", shared by private link only, never public). Built on trip-core.js, which has every part a trip shares
// (the group, packing with Who brings?, meals, booking, costs, journal, sharing by link, the plan you tell someone,
// offline); this file is Hunting's kit, from what Hunting already has (hunting.js window.tfHunt.trip):
//  - The camp: a spot on the map (Hunting's "This spot" card: Camp here), and the hunting zone it's in.
//  - Each day: the wind (mostly from, and where your scent drifts), the weather, legal light (the usual hours: half an
//    hour before sunrise to half an hour after sunset) and the moon, worked out for the camp. Light and moon are
//    worked out on the phone for every day, even past the forecast; the weather is Open-Meteo (the middle of three
//    models through wxcheck.js), kept with the trip for no signal.
//  - Seasons on your dates: the seasons the app has read for the camp's zone (the same files as the spot card), the
//    ones that fall on at least one day of the trip, with where they were read from. The regulations decide.
//  - Licences and tags: the group's own checklist (who has what). The app doesn't check it.
//  - Hunt log: each day what the group saw, heard or found (sign), shots and harvests, with the species, how many,
//    the time and the spot, and the walks you recorded in Hunting on the trip's days. Shared with the group like the
//    rest of the trip (the private link), never public.
//  - Your lines for this trip: walks in drawn on the map, and walks recorded on past hunts (My hunts).
// Trips are kept in tf:huntTrips, on the account when signed in (account.js). Wording: facts and their source, and
// "estimate" where it is one; nothing here says a hunt, a season or a spot is legal, open or safe.
(() => {
  "use strict";
  const map = window.tfLeaflet, H = window.tfHunt && window.tfHunt.trip;
  if (!map || !window.L || !H || !window.tfTripEngine || (window.tfTrips && window.tfTrips.hunt)) return;
  const isHunt = () => document.body.classList.contains("sport-hunt");
  const COL = H.ORANGE;   // the Hunting accent (blaze orange)
  const LCOL = "#7048e8";   // the trip's lines: a colour the hunting layers' keys don't lean on
  const svg = H.svg, IC = H.IC;
  const I = {   // line icons for this card (one stroke style, like Hunting's)
    trip: '<path d="M3.5 20 12 6l8.5 14"/><path d="M2 20h20M12 6l-2-3M12 6l2-3M12 13l-3 7M12 13l3 7"/>',   // a tent (line-icons.js), not a warning sign
    book: IC.log, wind: IC.wind, sun: IC.sun, pin: IC.pin, x: IC.x, eye: IC.eye,
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
    walk: '<circle cx="13" cy="4" r="2"/><path d="M11 21l2-6-3-3 1-5 4 3 3 1M8 21l2-5M10 7 7 9l-1 4"/>',
  };
  const css = document.createElement("style");
  css.textContent = `#huntPane { --tp: ${COL}; }
#huntPane .tp-card { border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm); }
#huntPane .tp-card h3 { margin: 0; font-size: .95rem; font-weight: 800; align-items: center; }
#huntPane .tp-card h3 svg { color: ${COL}; flex: none; align-self: center; }
#huntPane .tp-card .sk-x { float: right; font: inherit; border: 0; background: var(--chip); color: var(--muted); cursor: pointer; width: 28px; height: 28px; border-radius: 50%; }
#huntPane .tp-card .sk-sec { border-top: 1px solid var(--line); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; font-size: .85rem; }
#huntPane .tp-card .sk-sec h4 { margin: 0; font-size: .92rem; display: flex; align-items: center; gap: 6px; }
#huntPane .tp-card .sk-sec h4 svg { color: ${COL}; }
#huntPane .tp-card .sk-sec h5 { margin: 4px 0 0; font-size: .85rem; }
#huntPane .tp-card .sk-sec p { margin: 0; }
#huntPane .tp-card .sk-note, #huntPane .tp-addto .sk-note { color: var(--muted); font-size: .78rem; font-weight: 400; margin: 0; }
#huntPane .tp-card a { color: #1f5fe0; }
#huntPane .hn-act[aria-pressed="true"] { background: ${COL}; border-color: ${COL}; color: #fff; }
#huntPane .hn-act[aria-pressed="true"] svg { color: #fff; }
#huntPane .ht-days li > span b { font-weight: 800; }
#huntPane .ht-light { display: block; color: var(--fg); }
#huntPane .ht-seas { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
#huntPane .ht-seas li { border-left: 4px solid var(--line); padding-left: 9px; font-size: .84rem; }
#huntPane .ht-seas li.on { border-color: #2f9e44; }
#huntPane .ht-seas li b { display: block; }
#huntPane .ht-seas small { color: var(--muted); }
#huntPane .ht-seas li > small { display: block; }
#huntPane .ht-tags { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
#huntPane .ht-tags li { display: flex; align-items: center; gap: 6px; }
#huntPane .ht-tags .tp-check { flex: 1; min-width: 0; }
#huntPane .ht-tags input[type=checkbox]:checked + span { color: var(--muted); }
#huntPane .ht-tags small { color: var(--muted); }
#huntPane .ht-x { flex: none; width: 34px; height: 34px; border: 0; background: none; color: var(--muted); cursor: pointer; font: inherit; }
#huntPane .ht-form { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px; }
#huntPane .ht-form .wide { grid-column: 1 / -1; }
#huntPane .ht-form label { display: flex; flex-direction: column; gap: 2px; font-size: .7rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); min-width: 0; }
#huntPane .ht-form :is(input, select, textarea) { font: inherit; font-size: 16px; padding: 7px 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); min-width: 0; width: 100%; box-sizing: border-box; text-transform: none; letter-spacing: 0; font-weight: 400; }
#huntPane .ht-form textarea { resize: vertical; min-height: 40px; }
#huntPane .ht-form button.go { grid-column: 1 / -1; font: inherit; font-size: .9rem; font-weight: 800; padding: 10px; border-radius: 11px; border: 0; background: ${COL}; color: #fff; cursor: pointer; }
#huntPane .ht-kinds { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
#huntPane .ht-kinds button { font: inherit; font-size: .8rem; font-weight: 700; padding: 7px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); cursor: pointer; }
#huntPane .ht-kinds button[aria-pressed="true"] { background: ${COL}; border-color: ${COL}; color: #fff; }
#huntPane .ht-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
#huntPane .ht-log li { display: flex; align-items: flex-start; gap: 4px; border-left: 4px solid var(--k, var(--line)); padding: 4px 0 4px 9px; font-size: .84rem; }
#huntPane .ht-log li > span { flex: 1; min-width: 0; }
#huntPane .ht-log li small { display: block; color: var(--muted); font-size: .76rem; }
#huntPane .ht-log li p { margin: 2px 0 0; white-space: pre-wrap; }
#huntPane .ht-log button { flex: none; width: 34px; height: 34px; border: 0; background: none; color: var(--muted); cursor: pointer; font: inherit; display: grid; place-items: center; }
#huntPane .ht-sum { display: flex; flex-wrap: wrap; gap: 4px; }
#huntPane .ht-sum span { font-size: .76rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--chip); border: 1px solid var(--line); }
#huntPane .ht-camp { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.ht-draw { position: fixed; z-index: 3000; left: 50%; top: 14px; transform: translateX(-50%); width: min(420px, calc(100% - 24px)); box-sizing: border-box; background: var(--panel, #fff); color: var(--fg, #212529); border: 2px solid ${COL}; border-radius: 14px; padding: 10px 12px; box-shadow: 0 8px 28px #0005; display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; font-size: .86rem; }
.ht-draw b { flex: 1 1 100%; }
.ht-draw button { font: inherit; font-weight: 800; border: 1px solid var(--line, #ddd); border-radius: 10px; padding: 8px 12px; background: var(--bg, #fff); color: inherit; cursor: pointer; }
.ht-draw button.go { background: ${COL}; border-color: ${COL}; color: #fff; }
.ht-mk { width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; display: grid; place-items: center; background: #fff; border: 2px solid var(--k); box-shadow: 0 1px 3px #0005; }
.ht-mk i { width: 10px; height: 10px; border-radius: 50%; background: var(--k); }
@media (max-width: 760px) {
  html body #huntPane .hn-actions.ht-five { grid-template-columns: repeat(5, 1fr); }
  html body #huntPane #hnTrip { order: 2; }
}`;
  document.head.append(css);

  let E = null, $, esc, toast, when, dayWord, addDays, localDate;   // the engine (trip-core.js) and its helpers
  const cur = () => E.cur();
  const title = (t) => t.name || (t.hut && t.hut.name !== "Camp" ? t.hut.name : t.zone ? `Hunt in ${t.zone}` : "") || "My hunting trip";
  const centre = (t) => {   // where the trip is: its camp, else the middle of its lines and log
    if (t.hut) return [t.hut.lat, t.hut.lon];
    const pts = [...E.linesOf(t).flatMap((x) => x.ls.flat()), ...logOf(t).filter((x) => x.lat != null).map((x) => [x.lat, x.lon])];
    if (!pts.length) return null;
    const b = L.latLngBounds(pts).getCenter();
    return [b.lat, b.lng];
  };
  const logOf = (t) => t.log || [];
  const tagsOf = (t) => t.tags || [];
  const hm = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "–");
  const clock = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ""); return m ? hm(new Date(2000, 0, 1, +m[1], +m[2])) : s || ""; };

  const api = window.tfTripEngine((e) => { E = e; ({ $, esc, toast, when, dayWord, addDays, localDate } = e); return kit(); });
  if (!api) return;

  function kit() {
    return {
      id: "hunt", key: "huntTrips", packKey: "huntPack", color: COL, lineColor: LCOL, pane: "huntLabels", cardId: "hnTrip",
      shared: ["zone", "game", "tags", "log"],
      w: {
        icon: svg(I.trip, 18), trip: "hunting trip", Trips: "Hunting trips", btn: "Trips", btnTitle: "Plan a hunting trip: camp, each day's wind and light, seasons on your dates, licences and tags, and the hunt log",
        addTo: "Add to hunting trip", line: "Walk", lines: "Your walks for this trip", goIn: "First day", first: "first day", last: "last day", prod: "Hunting trip",
        overdue: "a hunting trip", journal: "Where the animals were, what worked, what to bring next time.", finding: "Looking up the zone…",
        updates: "the trip's wind and weather", offPrefix: "Hunting trip: ",
        offWhat: "the map and the hunting zones, seasons and land in the square you pick (it starts around your camp, walks and log)",
        offSaved: "the map and hunting zones", offFresh: "the trip's files", offOut: "a walk or a log entry added since",
      },
      groupGear: new Set(["sat", "aid", "tent", "stove", "pot", "filter", "saw", "tarp", "cart", "cooler", "scope", "food", "trash", "booking", "heater", "rope"]),
      isOn: isHunt,
      mount(card, btn) {
        const pane = $("huntPane"), acts = pane && pane.querySelector(".hn-actions");
        if (!pane || !acts) return false;
        btn.className = "hn-act"; btn.dataset.act = "trip"; btn.id = "hnTripBtn";
        btn.innerHTML = `${svg(I.trip)}Trips`;
        acts.append(btn); acts.classList.add("ht-five");
        const at = $("hnSpot");
        if (at) at.before(card); else pane.append(card);
      },
      title,
      namePh: () => "Like: Moose camp, 4 nights",
      newTrip: () => ({ sport: "hunt", log: [], tags: [] }),
      start(t) {
        if (!t.sport) t.sport = "hunt";
        E.loadDays(t);
        loadSeasons(t);
      },
      close() { drawStop(); },
      hasDays: (t) => !!centre(t),
      keyOf: (t) => JSON.stringify(t.hut ? [t.hut.lat, t.hut.lon] : null),
      snapOf, daysHtml, packItems, planText,
      bookTop: () => ({ tag: "", html: `<p class="sk-note">A cabin, a campsite or an outfitter: the booking and its confirmation here. Draw applications and licence purchases go through the province's own system.</p>` }),
      bookSite: () => "",
      bookWhat: (t) => `Book the camp for ${t.people} ${t.people > 1 ? "people" : "person"}.`,
      costHint: () => "Add the licences and tags, gas, food, the cabin or outfitter, meat processing and anything else the group shares.",
      baseHtml,
      midHtml: (t) => `${centre(t) ? `<div class="sk-sec" id="tpDays"><h4>Each day</h4>${E.daysHtml()}</div>` : ""}
      <div class="sk-sec" id="htSeas"><h4>${svg(I.sun, 16)}Seasons on your dates</h4>${seasHtml(t)}</div>
      <div class="sk-sec" id="htTags"><h4>${svg(I.tag, 16)}Licences and tags</h4>${tagsHtml(t)}</div>
      <div class="sk-sec" id="htLog"><h4>${svg(I.book, 16)}Hunt log</h4>${logHtml(t)}</div>`,
      afterLinesHtml: (t) => `<div class="sk-sec" id="htWalks"><h4>${svg(I.walk, 16)}Walks you recorded</h4>${walksHtml(t)}</div>`,
      afterRender: (t) => { fillWalks(t); },
      baseBtn: (t) => (t.hut ? `<button type="button" data-tp="spotcard">Zone, draws and land at camp</button>` : ""),
      linesEmpty: () => `No walks yet. Draw the way in with <b>Draw a walk</b>, or add a walk you recorded on a past hunt (below).`,
      drawLabel: () => "Draw a walk",
      linesChanged: () => {},
      openLine, drawExtra, extraPts,
      gpxExtra: (t, trk, wpt) => logOf(t).filter((x) => x.lat != null).map((x) => wpt(x.lat, x.lon, `${kindOf(x.k).label}${x.sp ? `: ${x.sp}` : ""} (${dayWord(x.day)})`)).join(""),
      offBase: (t) => t.name || (t.hut && t.hut.name) || t.id,
      onTp, nearList,
      datesChanged: (t) => { renderSeas(t); renderLog(t); fillWalks(t); },
      listNote: () => `Or start from a spot: tap the map where you'll camp, then <b>Plan a hunting trip here</b> on the spot's card, or start at the middle of the map:`,
    };
  }

  // ---------- the camp ----------
  function baseHtml(t) {
    if (!t.hut) return `<div class="ht-camp"><p class="sk-note">Where's camp? Tap the map where you'll camp, then <b>Camp here</b> on the spot's card, or use the middle of the map.</p><div class="tp-btns"><button type="button" data-tp="campcentre">${svg(I.pin, 16)} Camp at the map's middle</button></div></div>`;
    return `<div class="tp-facts"><span>Camp: ${esc(t.hut.lat.toFixed(4))}, ${esc(t.hut.lon.toFixed(4))}</span>${t.zone ? `<span>${esc(t.zone)}</span>` : ""}</div>
      <label class="tp-mine">Hunting for<input type="text" data-htset="game" maxlength="60" value="${esc((t.game || []).join(", "))}" placeholder="Like: moose, mule deer" autocomplete="off"></label>
      <p class="sk-note">Zone from the provinces' open data (as the spot card). The trip and its log are shared only with the people you send its private link to, never public.</p>`;
  }
  async function setCamp(t, lat, lon, name) {
    t.hut = { id: `c${lat.toFixed(4)},${lon.toFixed(4)}`, name: name || "Camp", kind: "camp", lat: +lat.toFixed(5), lon: +lon.toFixed(5) };
    t.snap = null; t.seasSnap = null;
    E.putTrip(t);
    if (cur() === t) { E.setView(null); E.render(); E.drawMap(); E.loadDays(t); }
    const z = await window.tfHunt.zoneAt(lat, lon).catch(() => "");
    const x = E.tripById(t.id) || t;
    x.zone = z || ""; E.putTrip(x);
    if (cur() === x) E.render();
    loadSeasons(x);
  }
  E.card.addEventListener("change", (e) => {
    const el = e.target, t = cur();
    if (!t || el.dataset.htset !== "game") return;
    t.game = el.value.split(/[,;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
    E.putTrip(t); renderSeas(t);
  });

  // ---------- the map: camp, walks and the log's spots ----------
  const KINDS = [["seen", "Seen", "#1971c2"], ["sign", "Sign", "#8d6e3f"], ["heard", "Heard", "#7048e8"], ["shot", "Shot at", "#e8590c"], ["harvest", "Harvest", "#c92a2a"], ["note", "Note", "#495057"]];
  const kindOf = (k) => { const x = KINDS.find((y) => y[0] === k) || KINDS[5]; return { k: x[0], label: x[1], c: x[2] }; };
  function drawExtra(t, layer) {
    for (const x of logOf(t)) {
      if (x.lat == null) continue;
      const k = kindOf(x.k);
      L.marker([x.lat, x.lon], { pane: "huntLabels", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<div class="ht-mk" style="--k:${k.c}" title="${esc(k.label)}"><i></i></div>`, iconSize: [0, 0] }) }).addTo(layer);
    }
  }
  function extraPts(t) { return logOf(t).filter((x) => x.lat != null).map((x) => [x.lat, x.lon]); }

  // ---------- each day: wind, weather, light and moon ----------
  // The forecast at camp (Open-Meteo through wxcheck.js, the middle of three models, about two weeks ahead): the wind
  // it gives most of the day, the strongest wind and gusts, rain and snow. Light and moon are worked out on the phone,
  // so they show for every day of the trip.
  const WX = [[0, "Clear"], [2, "Some cloud"], [3, "Cloudy"], [48, "Fog"], [57, "Drizzle"], [67, "Rain"], [77, "Snow"], [82, "Showers"], [86, "Snow showers"], [99, "Thunderstorms"]];
  const wxWord = (c) => (c == null ? "" : (WX.find((x) => c <= x[0]) || WX.at(-1))[1]);
  async function snapOf(t) {
    const c = centre(t);
    if (!c) return { err: "no camp yet" };
    const q = new URLSearchParams({ latitude: c[0].toFixed(3), longitude: c[1].toFixed(3),
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant", forecast_days: "16", timezone: "auto" });
    let w;
    try { w = await H.wx(`https://api.open-meteo.com/v1/forecast?${q}`); } catch (e) { return { err: e.message || "no signal" }; }
    const dd = w && w.daily;
    if (!dd) return { err: "no forecast" };
    const rows = E.tripDates(t).map((date) => {
      const i = dd.time.indexOf(date);
      if (i < 0) return { date };
      return { date, code: dd.weather_code[i], hi: dd.temperature_2m_max[i], lo: dd.temperature_2m_min[i], rain: dd.precipitation_sum[i] || 0, snow: dd.snowfall_sum[i] || 0,
        wind: dd.wind_speed_10m_max[i], gust: dd.wind_gusts_10m_max[i], dir: dd.wind_direction_10m_dominant[i] };
    });
    return { snap: { at: Date.now(), rows, end: dd.time.at(-1), ll: c } };
  }
  const deg = (v) => (v == null ? "–" : `${Math.round(v) === 0 ? 0 : Math.round(v)}°`);
  function lightOf(t, date) {
    const c = centre(t);
    if (!c) return null;
    const s = H.skyOn(c[0], c[1], date);
    return { ...s, a: s.rise && new Date(s.rise - 30 * 60000), b: s.set && new Date(s.set.valueOf() + 30 * 60000) };
  }
  function daysHtml(t, v) {
    const byDate = Object.fromEntries((v.rows || []).map((r) => [r.date, r]));
    const rows = E.tripDates(t).map((date, j) => {
      const r = byDate[date] || { date }, l = lightOf(t, date), has = r.code != null;
      const c = !has ? "var(--line)" : r.rain >= 5 || r.snow >= 2 || r.code >= 95 ? "#1c7ed6" : r.lo != null && r.lo <= -10 ? "#74c0fc" : COL;
      const wx = has ? `<span class="tp-wx"><big>${deg(r.hi)}</big><br>low ${deg(r.lo)}</span>` : `<span class="tp-wx sk-note">${v.end && date > v.end ? "Too far<br>ahead" : "–"}</span>`;
      const wind = has ? (r.wind < 5 ? "Wind light" : `Wind mostly from <b>${H.compass(r.dir)}</b> ${Math.round(r.wind)} km/h${r.gust >= 40 ? `, gusts ${Math.round(r.gust)}` : ""}: your scent drifts ${H.compass(r.dir + 180)}`) : "";
      const bits = has ? [r.snow >= 0.5 ? `${Math.round(r.snow)} cm of snow` : r.rain >= 1 ? `${Math.round(r.rain)} mm of rain` : "Little or no rain", wxWord(r.code)] : [];
      const light = l ? `Legal light ${l.a ? hm(l.a) : "–"} to ${l.b ? hm(l.b) : "–"} · moon ${esc(l.moon.name.toLowerCase())}, ${l.moon.pct}%` : "";
      return `<li style="--c:${c}"><b>${esc(dayWord(date))}${j === 0 ? " · first day" : j === t.nights ? " · last day" : ""}</b>${wx}<span>${wind || (has ? "" : "Weather: not in the forecast yet")}</span><small>${[...bits].filter(Boolean).map(esc).join(" · ")}${bits.length ? "<br>" : ""}<span class="ht-light">${light}</span></small></li>`;
    }).join("");
    return `<ul class="tp-days ht-days">${rows}</ul>
      <p class="sk-note">${v.old ? `<b>Saved forecast from ${esc(when(v.at))}</b> (no signal now). ` : v.at ? `Checked ${esc(when(v.at)).replace(/\.$/, "")}${t.autoAt && Math.abs(t.autoAt - v.at) < 60000 ? " (updated by itself)" : ""}. ` : ""}Wind and weather at camp: a weather model's estimate (Open-Meteo, the middle of three models), up to about two weeks ahead. Wind turns with the hills and the hour. Legal light: the usual hours, 30 min before sunrise to 30 min after sunset; some provinces and hunts differ, the regulations decide.</p>`;
  }

  // ---------- seasons on your dates ----------
  // The zone's season rows (hunting.js, the same files as the spot card): the ones open on at least one of the trip's
  // days, the species you're after first. Kept with the trip (t.seasSnap) for no signal.
  async function loadSeasons(t) {
    if (!t.hut) return;
    let z = null;
    try { z = await H.seasonsAt(t.hut.lat, t.hut.lon); } catch { z = null; }
    const x = E.tripById(t.id) || t;
    if (z) { x.seasSnap = { at: Date.now(), z, ll: [t.hut.lat, t.hut.lon] }; E.putTrip(x, true); }
    else if (!x.seasSnap) x.seasSnap = { err: 1 };
    if (cur() === x) { renderSeas(x); E.renderPack(); }
  }
  const renderSeas = (t) => { const el = E.part("htSeas"); if (el) el.innerHTML = `<h4>${svg(I.sun, 16)}Seasons on your dates</h4>${seasHtml(t)}`; };
  const wanted = (t, sp) => (t.game || []).some((g) => { const a = g.toLowerCase().replace(/s$/, ""), b = String(sp).toLowerCase(); return a && (b.includes(a) || a.includes(b.replace(/\s*\(.*\)/, ""))); });
  function seasHtml(t) {
    if (!t.hut) return `<p class="sk-note">Pick the camp to see the zone's seasons on your dates.</p>`;
    const s = t.seasSnap;
    if (!s) return `<p class="tp-wait">Reading the seasons for the zone…</p>`;
    if (s.err || !s.z) return `<p class="sk-note">Couldn't read the zone's seasons right now (no signal?). Open <b>Zone, draws and land at camp</b> below with signal.</p>`;
    if (!s.z.length) return `<p class="sk-note">The camp isn't in a hunting zone on the map. The province's or territory's regulations have the seasons there.</p>`;
    const dates = E.tripDates(t), at = (d) => new Date(d + "T12:00");
    return s.z.map((u) => {
      const link = u.link ? `<a href="${esc(u.link)}" target="_blank" rel="noopener">${esc(u.src)}</a>` : esc(u.src);
      if (!u.rows) return `<h5>${esc(u.label)}</h5>${u.mb ? `<ul class="ht-seas">${u.mb.filter(([sp]) => !(t.game || []).length || wanted(t, sp)).slice(0, 8).map(([sp, tx]) => `<li><b>${esc(sp)}</b><small>${esc(tx).replace(/\n/g, "<br>")}</small></li>`).join("")}</ul>` : ""}<p class="sk-note">${u.mb ? "Licence types and season words from Manitoba's GHA Hunting Season Table, no dates." : "No season dates read by the app for this zone yet."} Seasons: ${link}.</p>`;
      const by = new Map();
      for (const r of u.rows) (by.get(r[0]) || by.set(r[0], []).get(r[0])).push(r);
      const open = (r) => dates.filter((d) => H.openNow(r[3], at(d)));
      const items = [...by.entries()].map(([sp, rs]) => {
        const on = rs.filter((r) => open(r).length);
        return { sp, rs, on, want: wanted(t, sp) };
      }).sort((a, b) => b.want - a.want || (b.on.length > 0) - (a.on.length > 0) || a.sp.localeCompare(b.sp));
      // The species you're after first (and the ones with no general season read), then the rest folded away.
      const game = t.game || [], nOn = items.filter((x) => x.on.length).length;
      const shown = game.length ? items.filter((x) => x.want) : items.filter((x) => x.on.length), rest = items.filter((x) => !shown.includes(x));
      const missing = game.filter((g) => !items.some((x) => wanted({ game: [g] }, x.sp)));
      const row = (x) => `<li class="${x.on.length ? "on" : ""}"><b>${esc(x.sp)}</b>${(x.on.length ? x.on : x.rs).map((r) => `${r[1] ? esc(r[1]) + ": " : ""}${r[2] ? esc(r[2]) + ", " : ""}${esc(r[3])}${r[4] ? " †" : ""}${x.on.length ? ` <small>(${open(r).length === dates.length ? "all your days" : open(r).map((d) => esc(dayWord(d))).join(", ")})</small>` : ""}`).join("<br>")}${x.on.length ? "" : `<small>Not on your dates, as read.</small>`}</li>`;
      return `<h5>${esc(u.label)}: ${nOn ? `${nOn} species with a season on your dates, as read` : "no season read on your dates"}</h5>
        ${shown.length || missing.length ? `<ul class="ht-seas">${shown.map(row).join("")}${missing.map((g) => `<li><b>${esc(g[0].toUpperCase() + g.slice(1))}</b><small>No general season read for ${esc(u.label)}. It may be a draw only (limited entry), closed, or not in the app's list: see the regulations.</small></li>`).join("")}</ul>` : ""}
        ${rest.length ? `<details><summary>${shown.length || missing.length ? `The other ${rest.length} species in the zone` : `All ${rest.length} species in the zone`}</summary><ul class="ht-seas">${rest.map(row).join("")}</ul></details>` : ""}
        <p class="sk-note">Read by the app from the ${link}${s.at ? `, checked ${esc(when(s.at)).replace(/\.$/, "")}` : ""}. † part of the zone only or has a footnote. Licences, tags, weapons, bag limits and closures are in the regulations: always check them before you hunt.</p>`;
    }).join("");
  }

  // ---------- licences and tags ----------
  // The group's own list (t.tags [{id, what, who, done}]): what each person has to carry. The app doesn't check it.
  function tagsHtml(t) {
    const l = tagsOf(t), names = (t.group || []).map((g) => g.n).filter(Boolean);
    const who = (x) => `<select data-tagwho="${esc(x ? x.id : "")}" aria-label="Whose"${x ? "" : ' id="htTagWho"'}><option value="">Whose?</option>${names.map((n) => `<option ${x && x.who === n ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
    return `${l.length ? `<ul class="ht-tags">${l.map((x) => `<li><label class="tp-check"><input type="checkbox" data-tagdone="${esc(x.id)}" ${x.done ? "checked" : ""}><span>${esc(x.what)}${x.who ? ` <small>· ${esc(x.who)}</small>` : ""}</span></label><button type="button" class="ht-x" data-tagrm="${esc(x.id)}" aria-label="Delete ${esc(x.what)}">${svg(I.x, 14)}</button></li>`).join("")}</ul>` : ""}
      <div class="tp-addf"><input type="text" id="htTagNew" maxlength="80" placeholder="Like: moose tag, hunting licence, LEH authorization" autocomplete="off">${names.length ? who(null) : ""}<button type="button" data-tp="tagadd">Add</button></div>
      <p class="sk-note">Your group's own checklist: tick what each person has in hand. The app doesn't check licences or tags; what each hunt needs is in the regulations.</p>`;
  }
  const renderTags = (t) => { const el = E.part("htTags"); if (el) el.innerHTML = `<h4>${svg(I.tag, 16)}Licences and tags</h4>${tagsHtml(t)}`; };
  E.card.addEventListener("change", (e) => {
    const t = cur(), el = e.target;
    if (!t) return;
    if (el.dataset.tagdone) { t.tags = tagsOf(t).map((x) => (x.id === el.dataset.tagdone ? { ...x, done: el.checked ? 1 : 0 } : x)); E.putTrip(t); renderTags(t); }
    else if (el.dataset.tagwho) { t.tags = tagsOf(t).map((x) => (x.id === el.dataset.tagwho ? { ...x, who: el.value } : x)); E.putTrip(t); }
  });
  E.card.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "htTagNew") { e.preventDefault(); onTp("tagadd", cur()); } });

  // ---------- the hunt log ----------
  // t.log [{id, day, at, k, sp, n, sex, lat, lon, text, ab}]: what the group saw, found and took, each day. Shared with
  // the group (the private link), never public. The spot is where you are, the camp or the middle of the map.
  let draft = { k: "seen" };
  function logHtml(t) {
    const l = logOf(t), dates = E.tripDates(t), today = localDate(new Date());
    const day0 = draft.day && dates.includes(draft.day) ? draft.day : dates.includes(today) ? today : dates[0];
    const sum = KINDS.map(([k, n]) => [n, l.filter((x) => x.k === k).length]).filter((x) => x[1] && x[0] !== "Note");
    const harvests = l.filter((x) => x.k === "harvest");
    const byDay = dates.map((d) => [d, l.filter((x) => x.day === d).sort((a, b) => (a.at || "").localeCompare(b.at || ""))]).filter((x) => x[1].length);
    const other = l.filter((x) => !dates.includes(x.day));
    const item = (x) => { const k = kindOf(x.k);
      return `<li style="--k:${k.c}"><span><b>${esc(k.label)}${x.sp ? `: ${esc(x.sp)}` : ""}${x.n > 1 ? ` × ${x.n}` : ""}${x.sex ? ` · ${esc(x.sex)}` : ""}</b><small>${x.at ? esc(clock(x.at)) : ""}${x.lat != null ? `${x.at ? " · " : ""}${esc(x.where || "spot")}` : ""}</small>${x.text ? `<p>${esc(x.text)}</p>` : ""}${E.byHtml(t, x)}</span>${x.lat != null ? `<button type="button" data-logmap="${esc(x.id)}" aria-label="Show it on the map">${svg(I.pin, 16)}</button>` : ""}${x.k === "harvest" && window.tfPoints && x.lat != null ? `<button type="button" data-logpin="${esc(x.id)}" aria-label="Save it in My hunts as a harvest">${svg(I.book, 16)}</button>` : ""}<button type="button" data-logrm="${esc(x.id)}" aria-label="Delete">${svg(I.x, 14)}</button></li>`; };
    const species = [...new Set([...(t.game || []), ...((t.seasSnap && t.seasSnap.z) || []).flatMap((u) => (u.rows || []).map((r) => r[0])), ...l.map((x) => x.sp).filter(Boolean)])];
    return `${sum.length ? `<div class="ht-sum">${sum.map(([n, c]) => `<span>${esc(n)}: ${c}</span>`).join("")}</div>` : ""}
      ${byDay.map(([d, xs]) => `<h5>${esc(dayWord(d))}</h5><ul class="ht-log">${xs.map(item).join("")}</ul>`).join("")}
      ${other.length ? `<h5>Other days</h5><ul class="ht-log">${other.map(item).join("")}</ul>` : ""}
      ${l.length ? "" : `<p class="sk-note">Nothing in the log yet. Each day, add what you saw, heard or found, shots and harvests: the whole group's log builds up here.</p>`}
      <details class="tp-pack" id="htLogAdd"${draft.open || !l.length ? " open" : ""}><summary>Add to the log</summary>
      <div class="ht-form">
        <div class="ht-kinds" role="group" aria-label="What">${KINDS.map(([k, n]) => `<button type="button" data-logk="${k}" aria-pressed="${draft.k === k}">${n}</button>`).join("")}</div>
        <label>Species<input type="text" id="htSp" list="htSpList" maxlength="40" value="${esc(draft.sp || "")}" placeholder="Like: moose" autocomplete="off"></label>
        <datalist id="htSpList">${species.slice(0, 40).map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
        <label>How many<input type="number" id="htN" min="1" max="99" inputmode="numeric" value="${esc(draft.n || 1)}"></label>
        <label>Animal<select id="htSex">${["", "Bull / buck / male", "Cow / doe / female", "Young", "Not sure"].map((s) => `<option value="${esc(s)}" ${draft.sex === s ? "selected" : ""}>${s ? esc(s) : "–"}</option>`).join("")}</select></label>
        <label>Day<select id="htDay">${dates.map((d) => `<option value="${d}" ${d === day0 ? "selected" : ""}>${esc(dayWord(d))}</option>`).join("")}</select></label>
        <label>Time<input type="time" id="htAt" value="${esc(draft.at || new Date().toTimeString().slice(0, 5))}"></label>
        <label>Where<select id="htWhere"><option value="me">Where I am</option><option value="map" ${draft.where === "map" ? "selected" : ""}>Middle of the map</option>${t.hut ? `<option value="camp" ${draft.where === "camp" ? "selected" : ""}>At camp</option>` : ""}<option value="" ${draft.where === "" ? "selected" : ""}>No spot</option></select></label>
        <label class="wide">Note<textarea id="htText" maxlength="400" rows="2" placeholder="Like: 2 cows on the cutblock at first light, wind from the north">${esc(draft.text || "")}</textarea></label>
        <button type="button" class="go" data-tp="logadd">Add to the log</button>
      </div></details>
      ${harvests.length ? `<p class="sk-note">${harvests.length} harvest${harvests.length > 1 ? "s" : ""} in the log. Reporting, tagging and inspection rules are in the regulations.</p>` : ""}
      <p class="sk-note">${E.cur() && E.cur().share ? "Shared with the people who have this trip's private link (never public): everyone sees and adds to the log." : "On this phone (and your account when signed in). Share the trip below and the group sees and adds to the same log, by private link only."}</p>`;
  }
  const renderLog = (t) => { const el = E.part("htLog"); if (el) el.innerHTML = `<h4>${svg(I.book, 16)}Hunt log</h4>${logHtml(t)}`; };
  const keepDraft = () => {   // what's typed survives a redraw (a sync, a new day)
    const v = (id) => { const el = $(id); return el && E.card.contains(el) ? el.value : undefined; };
    if (v("htSp") === undefined) return;
    draft = { ...draft, sp: v("htSp"), n: v("htN"), sex: v("htSex"), day: v("htDay"), at: v("htAt"), where: v("htWhere"), text: v("htText") };
  };
  E.card.addEventListener("input", (e) => { if (e.target.closest("#htLogAdd")) keepDraft(); });
  E.card.addEventListener("change", (e) => { if (e.target.closest("#htLogAdd")) keepDraft(); });
  E.card.addEventListener("toggle", (e) => { if (e.target.id === "htLogAdd") draft.open = e.target.open; }, true);
  const here = () => new Promise((ok) => {
    if (!navigator.geolocation) { ok(null); return; }
    navigator.geolocation.getCurrentPosition((p) => ok([p.coords.latitude, p.coords.longitude]), () => ok(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  });
  async function logAdd(t) {
    keepDraft();
    const d = draft;
    if (!d.sp && !d.text && d.k !== "note") { toast("Type the species or a note first."); const i = $("htSp"); if (i) i.focus(); return; }
    let ll = null, where = "";
    if (d.where === "map") { const c = map.getCenter(); ll = [c.lat, c.lng]; where = "middle of the map"; }
    else if (d.where === "camp" && t.hut) { ll = [t.hut.lat, t.hut.lon]; where = "at camp"; }
    else if (d.where !== "") {
      const y = H.spot();   // Hunting's spot follows you while My spot is on
      ll = y && y.how === "you" ? [y.lat, y.lon] : await here();
      where = "where I was";
      if (!ll) { toast("Couldn't find where you are: saved with no spot. Pick Middle of the map to put it on the map."); where = ""; }
    }
    const x = { id: E.uid("g"), day: d.day || E.tripDates(t)[0], at: d.at || "", k: d.k || "seen", sp: String(d.sp || "").trim().slice(0, 40), n: Math.max(1, Math.min(99, +d.n || 1)), sex: d.sex || "", text: String(d.text || "").trim().slice(0, 400) };
    if (ll) { x.lat = +ll[0].toFixed(5); x.lon = +ll[1].toFixed(5); x.where = where; }
    const me = E.meOf(t); if (me) x.ab = me;
    const t2 = E.tripById(t.id) || t;
    t2.log = [...logOf(t2), x];
    E.putTrip(t2);
    draft = { k: d.k, day: x.day, where: d.where, open: true };
    renderLog(t2); E.drawMap();
    toast(`${kindOf(x.k).label}${x.sp ? `: ${x.sp}` : ""} added to the log.`); window.tfHappy && window.tfHappy("hunting log");
  }
  E.card.addEventListener("click", (e) => {
    const t = cur(), b = e.target.closest("[data-logk], [data-logrm], [data-logmap], [data-logpin], [data-tagrm], [data-walkadd]");
    if (!t || !b) return;
    if (b.dataset.logk) { keepDraft(); draft.k = b.dataset.logk; E.card.querySelectorAll("[data-logk]").forEach((x) => x.setAttribute("aria-pressed", x === b)); return; }
    if (b.dataset.tagrm) { t.tags = tagsOf(t).filter((x) => x.id !== b.dataset.tagrm); E.putTrip(t); renderTags(t); return; }
    if (b.dataset.walkadd) { addWalk(t, b.dataset.walkadd); return; }
    const x = logOf(t).find((y) => y.id === (b.dataset.logrm || b.dataset.logmap || b.dataset.logpin));
    if (!x) return;
    if (b.dataset.logrm) {
      if (!confirm(`Delete ${kindOf(x.k).label.toLowerCase()}${x.sp ? `: ${x.sp}` : ""} from the log${t.share ? " for the whole group" : ""}?`)) return;
      keepDraft(); t.log = logOf(t).filter((y) => y.id !== x.id); E.putTrip(t); renderLog(t); E.drawMap();
    } else if (b.dataset.logmap) {
      map.setView([x.lat, x.lon], Math.max(map.getZoom(), 15));
      if (window.tfSnapTo) window.tfSnapTo("peek");
    } else if (b.dataset.logpin && window.tfPoints) {
      window.tfPoints.addAt(x.lat, x.lon, { kind: "harvest", name: x.sp || "Harvest", note: [x.sex, x.text].filter(Boolean).join(". ") });
    }
  });

  // ---------- walks you recorded (My hunts) ----------
  // The walks recorded in Hunting (hunts.js, the same database as My rides) on the trip's days, and older ones near
  // camp, to add to the trip's lines: the way in you walked last year, a loop you know.
  let walks = null, walksBusy = false;
  async function fillWalks(t) {
    const el = E.part("htWalks");
    if (!el) return;
    if (!walks && !walksBusy && window.tfHunts) { walksBusy = true; walks = await window.tfHunts.load().catch(() => []); walksBusy = false; }
    const box = E.part("htWalks");
    if (box && cur() === t) box.innerHTML = `<h4>${svg(I.walk, 16)}Walks you recorded</h4>${walksHtml(t)}`;
  }
  const walkDay = (h) => new Date(h.start).toLocaleDateString("en-CA");
  function walksOf(t) {
    if (!walks) return null;
    const dates = E.tripDates(t), c = centre(t);
    const on = walks.filter((h) => dates.includes(walkDay(h)));
    const near = c ? walks.filter((h) => !on.includes(h) && h.points.some((p, i) => i % 10 === 0 && map.distance(c, [p[0], p[1]]) < 15000)).slice(0, 6) : [];
    return { on, near };
  }
  function walksHtml(t) {
    if (!window.tfHunts) return "";
    const w = walksOf(t);
    if (!w) return `<p class="tp-wait">Looking for your recorded walks…</p>`;
    const inTrip = (h) => E.linesOf(t).some((x) => x.rid === "w" + h.id);
    const row = (h) => `<li><button type="button" data-walkadd="${esc(h.id)}" ${inTrip(h) ? "disabled" : ""}><span>${esc(h.title || "Hunt")} <small>${esc(new Date(h.start).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }))}${h.stats && h.stats.dist ? ` · ${(h.stats.dist / 1000).toFixed(1)} km` : ""}</small></span><small>${inTrip(h) ? "In the trip" : "Add"}</small></button></li>`;
    return `${w.on.length ? `<h5>On the trip's days</h5><ul class="tp-list">${w.on.map(row).join("")}</ul>` : ""}
      ${w.near.length ? `<h5>Near camp, from past hunts</h5><ul class="tp-list">${w.near.map(row).join("")}</ul>` : ""}
      <p class="sk-note">${w.on.length || w.near.length ? "Walks you recorded in Hunting (Record), on this phone." : "No walks recorded on this phone on the trip's days or near camp. Record your walks in Hunting (Record) and they show here."} Add one to put it with the trip's walks (map, offline, GPX).</p>`;
  }
  function addWalk(t, id) {
    const h = (walks || []).find((x) => String(x.id) === id);
    if (!h) return;
    E.addLine(t, { rid: "w" + h.id, name: h.title || `Hunt, ${new Date(h.start).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`, label: "recorded", ls: [h.points.map((p) => [p[0], p[1]])] });
    fillWalks(t);
    toast("Added to the trip's walks.");
  }

  // ---------- packing list ----------
  function packItems(t, view) {
    const n = t.nights, p = t.people, rows = view && view.rows ? view.rows.filter((r) => r.code != null) : [];
    const cold = rows.length ? Math.min(...rows.map((r) => r.lo)) : null, wet = rows.some((r) => r.rain >= 2), snowy = rows.some((r) => r.snow >= 1);
    const big = (t.game || []).some((g) => /moose|elk|caribou|bison/i.test(g));
    const bag = cold == null ? "Sleeping bag" : `Sleeping bag rated to ${Math.min(-5, Math.round(cold) - 5)}°C or warmer`;
    return [
      ["Papers", [["lic", "Hunting licences and tags (your list above), in hand"], ["regs", "The regulations for the zone (saved on the phone or printed)"], ["id", "ID, and the firearms licence (PAL) if you carry a gun"]]],
      ["Hunting", [
        ["weapon", "Rifle or bow, sighted in, and a case"], ["ammo", "Ammunition or arrows, and spares"], ["blaze", "Blaze orange (hat and vest) where the rules ask for it"],
        ["binos", "Binoculars"], ["scope", "Spotting scope and tripod"], ["range", "Rangefinder"], ["calls", "Calls"], ["scent", "Scent eliminator"], ["seat", "Seat pad or a stool"]]],
      ["Meat care", [
        ["knife", "Knife and sharpener"], ["saw", "Bone saw"], ["bags", `Game bags${big ? " (6 or more for a moose or elk)" : ""}`], ["gloves", "Gloves for field dressing"],
        ["rope", "Rope or paracord and a pulley"], ["tarp", "Tarp to keep the meat clean"], ["cart", big ? "Game cart or packs for the meat" : "Game cart or a pack frame"],
        ["cooler", "Coolers and ice, or a plan to get the meat cold"], ["tagkit", "Pen and zip ties for the tags"]]],
      ["Essentials", [
        ["nav", "Map and compass or GPS (this trip saved offline)"], ["lamp", "Headlamp and spare batteries"],
        ["sat", "Satellite messenger or PLB (inReach, Zoleo): much hunting country has no cell signal"], ["aid", "First aid kit, with something for heavy bleeding"],
        ["firekit", "Fire starter and waterproof matches"], ["bivy", "Emergency blanket or bivy"], ["bear", `Bear spray${p > 1 ? " each" : ""}, where you can reach it`], ["power", "Phone charged + power bank"]]],
      ["Camp", [
        ["tent", `Tent${p > 2 ? `s for ${p}` : ""} or wall tent`], ["heater", cold != null && cold < 0 ? `Tent heater: down to ${Math.round(cold)}°C at camp` : "Tent heater or stove"], ["bag", bag], ["pad", "Sleeping pad"],
        ["stove", "Cook stove and fuel"], ["pot", "Pots, lighter × 2, mugs"], ["filter", "Water filter or tablets"], ["food", "Food storage away from bears"],
        ["meals", `${n} breakfast${n > 1 ? "s" : ""}, ${n + 1} lunches and ${n} dinner${n > 1 ? "s" : ""}${p > 1 ? ` for ${p}` : ""}`], ["spare", "A spare day of food"], ["trash", "Garbage bags: pack everything out"]]],
      ["Clothes", [
        ["quiet", "Quiet outer layers"], ["rain", wet ? "Rain jacket and pants: rain in the forecast" : "Rain jacket and pants"],
        ["warm", cold != null && cold < 5 ? `Warm layers, toque and gloves: down to ${Math.round(cold)}°C at camp` : "Warm layers and a toque"],
        ["boots", snowy ? "Insulated boots: snow in the forecast" : "Broken-in boots"], ["socks", `Dry socks for ${n + 1} days`]]],
      ["Before you go", [["offline", "Trip saved offline (button below)"], ["plan", "Trip plan left with someone at home (below)"]]],
    ];
  }

  // ---------- the plan you leave with someone ----------
  function planText(t, pl) {
    const ll = (a, b) => `${a.toFixed(5)}, ${b.toFixed(5)}`, link = (c) => `https://www.google.com/maps?q=${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
    const hasSat = (t.packed || {}).sat;
    return [`TRIP PLAN: ${title(t)} (hunting trip)`,
      `Who: ${pl.who || "me"}${t.people > 1 ? ` (${t.people} people)` : ""}`,
      `First day: ${dayWord(t.date)}. Nights: ${t.nights}. Back at the truck by ${when(pl.out)}`,
      ...(t.hut ? [`Camp: ${ll(t.hut.lat, t.hut.lon)} ${link(t.hut)}`] : []),
      ...(t.zone ? [`Hunting zone: ${t.zone}`] : []),
      ...(E.linesOf(t).length ? [`Walks we plan: ${E.linesOf(t).map((x) => x.name).join(", ")}`] : []),
      ...(pl.car ? [`Truck: ${pl.car}`] : []),
      `Gear: first aid, bear spray, headlamps${hasSat ? ", satellite messenger" : ""}, ${t.nights + 1} days of food + a spare day`,
      ``, `If you haven't heard from us by ${when(pl.help)}: call 911 (or the RCMP) and say we're overdue on a hunting trip. They call Search and Rescue. Read them this plan.`,
    ].join("\n");
  }

  // ---------- your walks ----------
  function openLine(t, x) {
    map.fitBounds(L.latLngBounds(x.ls.flat()), { padding: [30, 30], maxZoom: 16 });
    if (window.tfSnapTo) window.tfSnapTo("peek");
  }
  // Draw a walk: tap the map along it (straight lines between taps, no routing), then Done.
  let drawing = null;
  const drawLayer = L.layerGroup();
  const bar = document.createElement("div");
  bar.className = "ht-draw"; bar.hidden = true; bar.setAttribute("role", "status");
  document.body.append(bar);
  function drawShow() {
    if (!drawing) return;
    drawLayer.clearLayers();
    if (drawing.pts.length > 1) { L.polyline(drawing.pts, { pane: "huntLabels", color: "#fff", weight: 7, interactive: false }).addTo(drawLayer); L.polyline(drawing.pts, { pane: "huntLabels", color: LCOL, weight: 4, dashArray: "8 6", interactive: false }).addTo(drawLayer); }
    drawing.pts.forEach((p) => L.circleMarker(p, { pane: "huntLabels", radius: 5, color: "#fff", weight: 2, fillColor: LCOL, fillOpacity: 1, interactive: false }).addTo(drawLayer));
    const km = drawing.pts.reduce((s, p, i) => (i ? s + map.distance(drawing.pts[i - 1], p) : 0), 0) / 1000;
    bar.innerHTML = `<b>Draw a walk: tap the map along it${drawing.pts.length ? ` · ${km.toFixed(1)} km` : ""}</b><input type="text" id="htDrawName" maxlength="60" placeholder="Name, like: Way in to the meadow" value="${esc(drawing.name || "")}" style="flex:1 1 100%;font:inherit;font-size:16px;padding:7px;border:1px solid var(--line,#ddd);border-radius:9px"><button type="button" data-dr="undo" ${drawing.pts.length ? "" : "disabled"}>Undo</button><button type="button" data-dr="cancel">Cancel</button><button type="button" class="go" data-dr="done" ${drawing.pts.length > 1 ? "" : "disabled"}>Done</button>`;
  }
  function drawStop() { drawing = null; drawLayer.remove(); bar.hidden = true; document.body.classList.remove("ht-drawing"); }
  bar.addEventListener("input", (e) => { if (e.target.id === "htDrawName" && drawing) drawing.name = e.target.value; });
  bar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-dr]");
    if (!b || !drawing) return;
    if (b.dataset.dr === "undo") { drawing.pts.pop(); drawShow(); }
    else if (b.dataset.dr === "cancel") drawStop();
    else if (b.dataset.dr === "done") {
      const t = E.tripById(drawing.id), pts = drawing.pts, name = (drawing.name || "").trim() || `Walk ${E.linesOf(t || {}).length + 1}`;
      drawStop();
      if (!t) return;
      E.addLine(t, { name, label: "drawn", ls: [pts] });
      if (cur() !== t) E.start(t); else E.scrollTo();
      toast(`${name} added to the trip.`);
    }
  });
  map.on("click", (e) => {
    if (!drawing || !isHunt()) return;
    drawing.pts.push([+e.latlng.lat.toFixed(5), +e.latlng.lng.toFixed(5)]);
    drawShow();
  });
  function onTp(k, t) {
    if (k === "drawline") {
      drawing = { id: t.id, pts: t.hut ? [[t.hut.lat, t.hut.lon]] : [], name: "" };
      drawLayer.addTo(map); bar.hidden = false; document.body.classList.add("ht-drawing");
      drawShow();
      if (window.tfSnapTo) window.tfSnapTo("peek");
    } else if (k === "spotcard" && t.hut) {
      H.openAt(t.hut.lat, t.hut.lon);
    } else if (k === "campcentre") {
      const c = map.getCenter(); setCamp(t, c.lat, c.lng);
    } else if (k === "tagadd") {
      const i = $("htTagNew"), w = $("htTagWho"), v = i && i.value.trim();
      if (!v) { if (i) i.focus(); return; }
      const x = { id: E.uid("k"), what: v.slice(0, 80), who: w ? w.value : "", done: 0 };
      t.tags = [...tagsOf(t), x]; E.putTrip(t); renderTags(t);
      const n = $("htTagNew"); if (n) n.focus();
    } else if (k === "logadd") logAdd(t);
  }
  // While drawing, a tap on the map is a point of the walk, not Hunting's spot card (hunting.js checks body.ht-drawing).
  window.addEventListener("tf:sport", () => { if (!isHunt()) drawStop(); });

  // ---------- the spot card on the map: Plan a hunting trip here / Camp here ----------
  window.addEventListener("tf:hunt-spot", (e) => {
    const { el, lat, lon } = e.detail || {};
    if (!el) return;
    el.querySelectorAll(".tp-addto").forEach((x) => x.remove());
    const box = document.createElement("div");
    box.className = "tp-addto";
    const t = cur() && !E.card.hidden ? cur() : null;
    const b = (txt, f) => { const x = document.createElement("button"); x.type = "button"; x.textContent = txt; x.addEventListener("click", f); box.append(x); };
    if (t) b(t.hut ? `Move ${title(t)}'s camp here` : `Camp here: ${title(t)}`, () => { setCamp(t, lat, lon); toast(`Camp for ${title(t)} set here.`); E.scrollTo(); });
    else b("Plan a hunting trip here", () => { const x = E.newTrip(); E.start(x); setCamp(x, lat, lon); });
    const head = el.querySelector(".hn-chips") || el.querySelector(".hn-zone");
    if (head) head.after(box); else el.append(box);
  });

  // ---------- the trips list: start at the middle of the map ----------
  async function nearList() {
    const el = E.part("tpNear");
    if (!el) return;
    const c = map.getCenter(), z = await window.tfHunt.zoneAt(c.lat, c.lng).catch(() => "");
    const box = E.part("tpNear");
    if (!box) return;
    box.innerHTML = `<li><button type="button" data-htnew="1"><span>Camp at the middle of the map${z ? ` <small>${esc(z)}</small>` : ""}</span><small>Start</small></button></li>`;
  }
  E.card.addEventListener("click", (e) => {
    if (!e.target.closest("[data-htnew]")) return;
    const c = map.getCenter(), t = E.newTrip();
    E.start(t); setCamp(t, c.lat, c.lng);
  });
  window.tfHuntTrip = api;
})();
