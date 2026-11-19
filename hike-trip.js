// Plan a hike trip (Hiking): backpacking, camping and hut trips (alex 2026-11-16: the same trip planner for every
// sport, Hiking first, and "hiking can be a camping trip too"). Built on trip-core.js, which has every part a trip
// shares (the group, packing with Who brings?, meals, booking, costs, journal, sharing by link, the plan you tell
// someone, offline); this file is Hiking's kit, from what Hiking already has (hike.js window.tfHike.trip):
//  - How you sleep: Backpacking (a tent you carry), Car camping (a campsite you drive to) or Huts. The packing list
//    follows it.
//  - Where you sleep: each night's camp, a campsite, hut or shelter from Hiking's places (OpenStreetMap and the clubs'
//    hut facts in data/huts.json), picked from the list near the trip or with 🏕 Sleep here on its card on the map.
//    The same camp every night (a base camp with day hikes) or a new one each night (a backpacking route).
//  - Your lines for this trip: hikes added from their card (🏕 Add to hike trip) and hikes you plan (Plan a hike).
//  - Each day: the weather at that night's camp (Open-Meteo through wxcheck.js, the middle of three models), with the
//    rain, the snow line and sunset, kept with the trip for no signal.
//  - Parks, passes and warnings: the park the trip is in and the pass it asks for (hike.js, linked to the park's own
//    page), and the closures and wildfires near it (the nightly closures and fires files).
//  - Water along your lines: drinking water taps mapped near them (as mapped: may be dry or off for the season).
// Trips are kept in tf:hikeTrips, on the account when signed in (account.js). Wording: facts and their source, and
// "estimate" where it is one; nothing here says a trail, a camp or the weather is safe or open.
(() => {
  "use strict";
  const map = window.tfLeaflet, H = window.tfHike && window.tfHike.trip;
  if (!map || !window.L || !H || !window.tfTripEngine || (window.tfTrips && window.tfTrips.hike)) return;
  const isHike = () => document.body.classList.contains("sport-hike");
  const COL = H.ACC;   // the Hiking accent (forest green)
  const LCOL = "#d6336c";   // the trip's lines: a colour the trail grades don't use
  const SLEEP = ["camp", "hut"], STARTS = ["th", "park"];
  const css = document.createElement("style");
  css.textContent = `#hikePane { --tp: ${COL}; }
#hikePane .hk-actions.five.six { grid-template-columns: repeat(6, 1fr); }
@media (max-width: 760px) { #hikePane .hk-actions.five.six { grid-template-columns: repeat(5, 1fr); } }
#hikePane .hk-act[aria-pressed="true"] { background: ${COL}; border-color: ${COL}; color: #fff; }
#hikePane .hk-act[aria-pressed="true"] svg { color: #fff; }
#hikePane .tp-card { border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm); }
#hikePane .tp-card h3 { margin: 0; font-size: .95rem; font-weight: 800; }
#hikePane .tp-card .sk-x { float: right; font: inherit; border: 0; background: var(--chip); color: var(--muted); cursor: pointer; width: 28px; height: 28px; border-radius: 50%; }
#hikePane .tp-card .sk-sec { border-top: 1px solid var(--line); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; font-size: .85rem; }
#hikePane .tp-card .sk-sec h4 { margin: 0; font-size: .92rem; }
#hikePane .tp-card .sk-sec h5 { margin: 4px 0 0; font-size: .85rem; }
#hikePane .tp-card .sk-sec p { margin: 0; }
#hikePane .tp-card .sk-note, #hikePane .tp-addto .sk-note { color: var(--muted); font-size: .78rem; font-weight: 400; margin: 0; }
#hikePane .tp-style { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
#hikePane .tp-style button { font: inherit; font-size: .8rem; font-weight: 700; padding: 8px 4px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
#hikePane .tp-style button[aria-pressed="true"] { background: ${COL}; border-color: ${COL}; color: #fff; }
#hikePane .tp-night { display: grid; grid-template-columns: 1fr; gap: 3px; margin: 4px 0 6px; font-size: .84rem; }
#hikePane .tp-night b { font-size: .84rem; }
#hikePane .tp-night select { width: 100%; }
#hikePane .tp-warn { border-left: 4px solid #e8590c; padding: 4px 0 4px 9px; font-size: .82rem; }
#hikePane .tp-warn.bad { border-color: #c92a2a; }
#hikePane .tp-warn small { display: block; color: var(--muted); }
#hikePane .tp-warn a { color: #1f5fe0; }
#hikePane .tp-place-go { display: flex; flex-direction: column; gap: 6px; }`;
  document.head.append(css);

  let E = null, $, esc, toast, fmtM, when, dayWord, addDays, localDate;   // the engine (trip-core.js) and its helpers
  const cur = () => E.cur();
  const placeOf = (p) => ({ id: p.id, name: p.n || H.PLACES[p.k].label, kind: p.k, lat: p.ll[0], lon: p.ll[1], tags: { ...(p.x || {}), ...((p.club && p.club.tags) || {}) } });
  const title = (t) => t.name || (t.hut && t.hut.name) || "My hike trip";
  const campsOf = (t) => t.camps || {};
  const campOn = (t, i) => campsOf(t)[i] || null;   // night i's camp (0 = the first night)
  const nightCamps = (t) => Array.from({ length: t.nights }, (_, i) => campOn(t, i));
  const uniq = (l) => { const seen = new Set(); return l.filter((c) => c && !seen.has(c.id) && seen.add(c.id)); };
  const centre = (t) => {   // where the trip is: its first camp, its place, or the middle of its lines
    const c = nightCamps(t).find(Boolean) || t.hut || t.start;
    if (c) return [c.lat, c.lon];
    const pts = E.linesOf(t).flatMap((x) => x.ls.flat());
    if (!pts.length) return null;
    const b = L.latLngBounds(pts).getCenter();
    return [b.lat, b.lng];
  };
  const STYLES = [["back", "Backpacking"], ["car", "Car camping"], ["hut", "Huts"]];
  const styleOf = (t) => t.style || (t.hut && t.hut.kind === "hut" ? "hut" : "back");

  const api = window.tfTripEngine((e) => { E = e; ({ $, esc, toast, fmtM, when, dayWord, addDays, localDate } = e); return kit(); });
  if (!api) return;

  function kit() {
    return {
      id: "hike", key: "hikeTrips", packKey: "hikePack", color: COL, lineColor: LCOL, pane: "hikePlaces", cardId: "hkTrip",
      shared: ["style", "camps", "start"],
      w: {
        icon: "🏕", trip: "hike trip", Trips: "Hike trips", btn: "🏕 Trips", btnTitle: "Plan a hiking, camping or hut trip: where you sleep each night, your hikes, the forecast for each day, offline",
        addTo: "🏕 Add to hike trip", line: "Hike", lines: "Your hikes for this trip", goIn: "First day", first: "first day", last: "last day", prod: "Hike trip",
        overdue: "a hiking trip", journal: "How the trails were, where you camped, what to bring next time.", finding: "Finding campsites and huts…",
        updates: "the trip's weather and snow line", offPrefix: "Hike trip: ",
        offWhat: "the map, hiking trails, campsites and huts in the square you pick (it starts around your camps and hikes)",
        offSaved: "the map, hiking trails and places", offFresh: "the trip's files", offOut: "a hike or a camp added since",
      },
      groupGear: new Set(["sat", "aid", "repair", "tent", "stove", "pot", "filter", "food", "trash", "booking", "fee", "pass", "cooler", "chairs", "trowel", "lantern"]),
      isOn: isHike,
      mount(card, btn) {
        const pane = $("hikePane"), acts = pane && pane.querySelector(".hk-actions");
        if (!pane || !acts) return false;
        btn.className = "hk-act"; btn.dataset.act = "trip"; btn.id = "hkTripBtn";
        btn.innerHTML = `${H.svg('<path d="M3 20 12 4l9 16z"/><path d="M12 4v16M9 20l3-5 3 5"/>')}Trips`;
        acts.append(btn); acts.classList.add("six");
        const at = $("hkPlace");
        if (at) at.before(card); else pane.append(card);
      },
      title,
      namePh: () => "Like: Garibaldi Lake, 2 nights",
      newTrip: () => ({ sport: "hike", camps: {} }),
      start(t) {
        if (!t.sport) t.sport = "hike";
        E.loadDays(t);
        loadParks(t);
      },
      hasDays: (t) => !!centre(t),
      keyOf: (t) => JSON.stringify([t.camps || null, t.hut ? t.hut.id : "", linesKey(t)]),
      snapOf, daysHtml, packItems, planText,
      // Which day each hike is for (alex 2026-11-17), so each day shows the weather at its own hike's high point.
      lineExtra: (t, x) => `<select class="tp-day" data-hday="${esc(x.id)}" aria-label="Which day for ${esc(x.name)}"><option value="">Any day</option>${E.tripDates(t).map((d, j) => `<option value="${j}"${x.day === j ? " selected" : ""}>Day ${j + 1}</option>`).join("")}</select>`,
      bookTop(t) {
        const l = uniq([...nightCamps(t), t.hut && SLEEP.includes(t.hut.kind) ? t.hut : null]);
        const need = l.some((c) => c.tags.reservation === "required");
        const rows = l.map((c) => { const g = c.tags || {}, site = g["reservation:website"] || g.website || "";
          return `<p class="sk-note"><b>${esc(c.name)}</b>: ${g.reservation === "required" ? "must be booked ahead (as mapped)" : g.reservation === "no" ? "first come, first served (as mapped)" : g.reservation ? "can be booked (as mapped)" : "no booking info on the map"}${g.charge ? `, ${esc(g.charge)}` : ""}${site ? ` · <a href="${esc(site)}" target="_blank" rel="noopener">${g["reservation:website"] ? "Book" : "Website"}</a>` : ""}</p>`; }).join("");
        return { tag: need ? "needs booking" : "",
          html: `${rows || `<p class="sk-note">Pick where you sleep (above) to see what's known about booking there.</p>`}<p class="sk-note">Campsites and huts in busy parks often need booking months ahead: check the park's or the club's own page.</p>` };
      },
      bookSite: (t) => { const c = uniq([...nightCamps(t), t.hut]).find((x) => x.tags["reservation:website"] || x.tags.website); return c ? c.tags["reservation:website"] || c.tags.website : ""; },
      bookWhat: (t) => { const l = uniq([...nightCamps(t), t.hut && SLEEP.includes(t.hut.kind) ? t.hut : null]); return `Book ${l.length ? l.map((c) => c.name).join(", ") : "where you sleep"} for ${t.people} people.`; },
      costHint: () => "Add the camp fees, park passes, gas, food and anything else the group shares.",
      baseHtml,
      midHtml: (t) => `<div class="sk-sec" id="tpCamps"><h4>Where you sleep</h4>${campsHtml(t)}</div>
      ${centre(t) ? `<div class="sk-sec" id="tpDays"><h4>Each day</h4>${E.daysHtml()}</div>
      <div class="sk-sec" id="tpPark"><h4>Parks, passes and warnings</h4>${parkHtml(t)}</div>` : ""}`,
      afterLinesHtml: (t) => (E.linesOf(t).length ? `<div class="sk-sec" id="tpWater"><h4>Water along your hikes</h4>${waterHtml(t)}</div>` : ""),
      baseBtn: (t) => (t.hut ? `<button type="button" data-tp="place">${esc(t.hut.kind === "hut" ? "Hut details" : t.hut.kind === "camp" ? "Campsite details" : "Place details")}</button>` : ""),
      linesEmpty: () => `No hikes yet. Tap a hike on the map and then <b>🏕 Add to hike trip</b>, or plan your own with ✏️ Draw a hike.`,
      drawLabel: () => "Draw a hike",
      linesChanged: (t) => { const el = E.part("tpWater"); if (el) el.innerHTML = `<h4>Water along your hikes</h4>${waterHtml(t)}`; else E.render(); if (linesKey(t) !== (t.hp ? t.hp.key : "")) E.loadDays(t); },
      openLine, drawExtra, extraPts,
      gpxExtra: (t, trk, wpt) => uniq(nightCamps(t)).filter((c) => !t.hut || c.id !== t.hut.id).map((c) => wpt(c.lat, c.lon, c.name)).join("") + (t.start ? wpt(t.start.lat, t.start.lon, `Start: ${t.start.name}`) : ""),
      offBase: (t) => (t.hut && t.hut.name) || t.name || t.id,
      onTp, nearList, datesChanged: () => {},
      listNote: () => `Or start from a place: tap a campsite, hut or trailhead (the brown and purple dots) on the map, then <b>🏕 Plan a hike trip here</b>, or pick one near the middle of the map:`,
    };
  }

  // ---------- the trip's place, and how you sleep ----------
  function baseHtml(t) {
    const st = styleOf(t);
    const style = `<div class="tp-style" role="group" aria-label="How you sleep">${STYLES.map(([k, l]) => `<button type="button" data-style="${k}" aria-pressed="${st === k}">${l}</button>`).join("")}</div>`;
    if (!t.hut && !t.start) return style;
    const p = t.hut || t.start, facts = H.placeFacts({ k: p.kind, x: p.tags || {} });
    return `${style}<div class="tp-facts"><span>${esc(H.PLACES[p.kind] ? H.PLACES[p.kind].label : "Place")}</span>${facts.map((f) => `<span>${esc(f)}</span>`).join("")}${p.tags && (p.tags["reservation:website"] || p.tags.website) ? `<a href="${esc(p.tags["reservation:website"] || p.tags.website)}" target="_blank" rel="noopener">${p.tags["reservation:website"] ? "📅 Book it" : "ℹ Website"}</a>` : ""}</div>
      ${p.tags && p.tags.description ? `<p class="sk-note">${esc(String(p.tags.description).slice(0, 260))}</p>` : ""}`;
  }
  E.card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-style]"), t = cur();
    if (!b || !t) return;
    t.style = b.dataset.style; E.putTrip(t); E.render();
  });

  // ---------- where you sleep, each night ----------
  // A campsite, hut or shelter for each night: the places near the trip that the map has loaded (Hiking's places
  // layer), or one picked with 🏕 Sleep here on its card. "Same as the night before" fills the rest of a base camp.
  // One of each name (a club's hut and the same hut on OpenStreetMap are one place).
  // One row per name (a campground mapped twice), and no emergency shelters: they're for emergencies, not for planning a night.
  const oneEach = (l) => { const seen = new Set(); return l.filter((x) => { const k = (x.p.n || "").toLowerCase(); return !/emergency/.test(k) && !seen.has(k) && seen.add(k); }); };
  const nearSleeps = (t) => { const c = centre(t) || [map.getCenter().lat, map.getCenter().lng]; return oneEach(H.placesNear(c, 25, SLEEP)).slice(0, 14).map((x) => x.p); };
  function campsHtml(t) {
    const near = nearSleeps(t), dates = E.tripDates(t);
    const rows = Array.from({ length: t.nights }, (_, i) => {
      const c = campOn(t, i), opts = uniq([c, ...near.map(placeOf)]);
      return `<label class="tp-night"><b>Night ${i + 1} · ${esc(dayWord(dates[i]))}</b><select data-camp="${i}" aria-label="Where you sleep night ${i + 1}"><option value="">${c ? "Not picked" : "Pick where you sleep"}</option>${i > 0 && campOn(t, i - 1) && !(c && c.id === campOn(t, i - 1).id) ? `<option value="=prev">Same as night ${i}: ${esc(campOn(t, i - 1).name)}</option>` : ""}${opts.map((p) => `<option value="${esc(p.id)}" ${c && c.id === p.id ? "selected" : ""}>${esc(p.name)} (${esc(H.PLACES[p.kind] ? H.PLACES[p.kind].label.toLowerCase() : "camp")})</option>`).join("")}</select></label>`;
    }).join("");
    const none = !near.length && !nightCamps(t).some(Boolean);
    return `${rows}<p class="sk-note">${none ? "No campsites or huts loaded near here yet: zoom the map in on where you're going (the brown dots), or " : "Or "}tap a campsite or hut on the map, then <b>🏕 Sleep here</b>. Campsites and huts come from OpenStreetMap and the clubs: check with whoever runs them before you go.</p>`;
  }
  function setCamp(t, i, p) {
    t.camps = { ...campsOf(t) };
    if (p) t.camps[i] = p; else delete t.camps[i];
    // The first camp picked becomes the trip's place when it has none (its name, the booking, the map).
    if (p && !t.hut) t.hut = p;
    if (p && !t.style) t.style = p.kind === "hut" ? "hut" : "back";
    t.snap = null;
    E.putTrip(t);
    if (cur() === t) { E.setView(null); E.render(); E.drawMap(); E.loadDays(t); loadParks(t); }
  }
  E.card.addEventListener("change", (e) => {
    const el = e.target, t = cur();
    if (t && el.dataset.hday) {
      const x = (t.lines || []).find((l) => l.id === el.dataset.hday);
      if (!x) return;
      if (el.value === "") delete x.day; else x.day = +el.value;
      E.putTrip(t); E.loadDays(t);
      return;
    }
    if (!el.dataset.camp || !t) return;
    const i = +el.dataset.camp, v = el.value;
    if (v === "=prev") { setCamp(t, i, campOn(t, i - 1)); return; }
    const c = campOn(t, i), p = v ? (c && c.id === v ? c : H.place(v)) : null;
    setCamp(t, i, p ? (p.ll ? placeOf(p) : p) : null);
    // A base camp: picked for night 1 with the other nights empty, every night gets it.
    if (p && i === 0 && t.nights > 1 && nightCamps(t).slice(1).every((x) => !x)) {
      t.camps = Object.fromEntries(Array.from({ length: t.nights }, (_, k) => [k, t.camps[0]]));
      E.putTrip(t); E.render(); E.drawMap();
      toast(`${t.camps[0].name} for every night: change any night below.`);
    }
  });

  // ---------- the map ----------
  function drawExtra(t, layer) {
    const pane = "hikePlaces";
    uniq(nightCamps(t)).filter((c) => !t.hut || c.id !== t.hut.id).forEach((c) => L.circleMarker([c.lat, c.lon], { pane, radius: 8, color: "#fff", weight: 3, fillColor: COL, fillOpacity: 1, interactive: false }).addTo(layer));
    if (t.start) L.marker([t.start.lat, t.start.lon], { pane, interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<span style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:#7c3aed;color:#fff;font:800 11px/1 system-ui;border:2px solid #fff">S</span>`, iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(layer);
  }
  function extraPts(t) { return [...uniq(nightCamps(t)).map((c) => [c.lat, c.lon]), ...(t.start ? [[t.start.lat, t.start.lon]] : [])]; }

  // ---------- each day ----------
  // The weather where you sleep: day 1 at night 1's camp, each next day at that night's camp, the last day at the last
  // camp (or the trip's place, or the middle of its hikes). Open-Meteo, through wxcheck.js (the middle of Environment
  // Canada's, ECMWF's and NOAA's models), about a week ahead; the snow line from the freezing level at noon.
  const WX = [[0, "Clear"], [2, "Some cloud"], [3, "Cloudy"], [48, "Fog"], [57, "Drizzle"], [67, "Rain"], [77, "Snow"], [82, "Showers"], [86, "Snow showers"], [99, "Thunderstorms"]];
  const wxWord = (c) => (c == null ? "" : (WX.find((x) => c <= x[0]) || WX.at(-1))[1]);
  // The high point of each hike (alex 2026-11-17: the weather up there each day, for that day's hikes): up to 100
  // points spread over the hike, their heights from Open-Meteo's elevation data, kept with the trip (t.hpl, by hike).
  function linesKey(t) { return (t.lines || []).map((l) => l.id + ":" + (l.day == null ? "" : l.day)).sort().join(","); }
  async function lineTop(t, l) {
    t.hpl = t.hpl || {};
    if (t.hpl[l.id]) return t.hpl[l.id];
    const pts = l.ls.flat();
    if (!pts.length) return null;
    const step = Math.max(1, pts.length / 100), pick = [];
    for (let i = 0; i < pts.length && pick.length < 100; i += step) pick.push(pts[Math.floor(i)]);
    pick.push(pts.at(-1));
    const q = `latitude=${pick.map((p) => p[0].toFixed(4)).join(",")}&longitude=${pick.map((p) => p[1].toFixed(4)).join(",")}`;
    const r = await fetch(`https://api.open-meteo.com/v1/elevation?${q}`).then((x) => (x.ok ? x.json() : null), () => null);
    const el = (r && r.elevation) || [];
    let best = -1;
    el.forEach((e, i) => { if (e != null && (best < 0 || e > el[best])) best = i; });
    if (best < 0) return null;
    return (t.hpl[l.id] = { lat: +pick[best][0].toFixed(4), lon: +pick[best][1].toFixed(4), ele: Math.round(el[best]) });
  }
  // Each day's high point: the highest of that day's hikes; a day with none gets the highest of the hikes with no day.
  async function dayTops(t, n) {
    const ls = t.lines || [], tops = [];
    for (const l of ls) { const h = await lineTop(t, l); if (h) tops.push({ ...h, name: l.name, day: l.day }); }
    const hi = (l) => l.reduce((a, b) => (!a || b.ele > a.ele ? b : a), null), loose = hi(tops.filter((x) => x.day == null));
    return Array.from({ length: n }, (_, j) => hi(tops.filter((x) => x.day === j)) || loose);
  }
  async function snapOf(t) {
    const dates = E.tripDates(t), c0 = centre(t);
    if (!c0) return { err: "no place yet" };
    const locOf = (j) => { const c = campOn(t, j) || campOn(t, j - 1) || t.hut; return c ? { ll: [c.lat, c.lon], name: c.name } : { ll: c0, name: "" }; };
    const locs = dates.map((d, j) => locOf(j)), keys = [...new Set(locs.map((l) => l.ll.map((v) => v.toFixed(3)).join(",")))];
    const got = {};
    let err = "";
    for (const k of keys) {
      const [lat, lon] = k.split(",");
      const q = new URLSearchParams({ latitude: lat, longitude: lon, hourly: "freezing_level_height",
        daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunset", forecast_days: "16", timezone: "auto" });
      try { got[k] = await H.wx(`https://api.open-meteo.com/v1/forecast?${q}`); } catch (e) { err = e.message || "no signal"; }
    }
    if (!Object.keys(got).length) return { err: err || "no signal" };
    const tops = await dayTops(t, dates.length).catch(() => dates.map(() => null)), topWx = {};
    for (const h of tops) {
      const k = h && `${h.lat},${h.lon}`;
      if (!h || k in topWx) continue;
      const q = new URLSearchParams({ latitude: h.lat, longitude: h.lon, elevation: h.ele,
        daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max", forecast_days: "16", timezone: "auto" });
      try { topWx[k] = (await H.wx(`https://api.open-meteo.com/v1/forecast?${q}`)).daily || null; } catch { topWx[k] = null; }
    }
    let end = "", ele = 0;
    const rows = dates.map((date, j) => {
      const l = locs[j], w = got[l.ll.map((v) => v.toFixed(3)).join(",")], row = { date, tag: j === 0 ? "first" : j === t.nights ? "last" : "", at: l.name };
      const dd = w && w.daily;
      if (!dd) return row;
      if (!end || dd.time.at(-1) < end) end = dd.time.at(-1);
      ele = ele || w.elevation || 0;
      const i = dd.time.indexOf(date);
      if (i < 0) return row;
      const at = w.hourly ? w.hourly.time.indexOf(`${date}T12:00`) : -1, fl = at >= 0 ? w.hourly.freezing_level_height[at] : null;
      return Object.assign(row, { code: dd.weather_code[i], hi: dd.temperature_2m_max[i], lo: dd.temperature_2m_min[i], rain: dd.precipitation_sum[i] || 0, snow: dd.snowfall_sum[i] || 0,
        pop: dd.precipitation_probability_max ? dd.precipitation_probability_max[i] : null, wind: dd.wind_speed_10m_max[i], gust: dd.wind_gusts_10m_max[i], sunset: dd.sunset[i],
        line: fl == null ? null : Math.max(0, Math.round((fl - 300) / 100) * 100),
        top: (() => { const h = tops[j], top = h && topWx[`${h.lat},${h.lon}`], k = top ? top.time.indexOf(date) : -1;
          return k < 0 ? null : { name: h.name, ele: h.ele, hi: top.temperature_2m_max[k], lo: top.temperature_2m_min[k], rain: top.precipitation_sum[k] || 0,
            snow: top.snowfall_sum[k] || 0, wind: top.wind_speed_10m_max[k], gust: top.wind_gusts_10m_max[k] }; })() });
    });
    return { snap: { at: Date.now(), rows, end, ele: Math.round(ele), hp: rows.some((r) => r.top) } };
  }
  const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  const deg = (v) => (v == null ? "–" : `${Math.round(v) === 0 ? 0 : Math.round(v)}°`);
  // One line under each day: the high point of the hikes, from the same models at that height.
  function topHtml(x) {
    if (!x || x.hi == null) return "";
    const b = [`High point of ${x.name} (${x.ele.toLocaleString()} m): ${deg(x.hi)}, low ${deg(x.lo)}`, x.snow >= 0.5 ? `${Math.round(x.snow)} cm of snow` : x.rain >= 1 ? `${Math.round(x.rain)} mm of rain` : "",
      `wind ${Math.round(x.wind || 0)} km/h${x.gust >= 50 ? `, gusts ${Math.round(x.gust)}` : ""}`].filter(Boolean);
    return `<small class="tp-top">${b.map((y) => `<span>${esc(y)}</span>`).join(" · ")}</small>`;
  }
  function daysHtml(t, v) {
    const rows = v.rows.map((r) => {
      const wet = r.code != null && (r.rain >= 5 || r.snow >= 2 || r.code >= 95), c = r.code == null ? "var(--line)" : wet ? "#1c7ed6" : r.lo != null && r.lo <= 0 ? "#74c0fc" : COL;
      const wx = r.code != null ? `<span class="tp-wx"><big>${deg(r.hi)}</big><br><span>low ${deg(r.lo)}</span></span>` : `<span class="tp-wx sk-note">${v.end && r.date > v.end ? "Too far<br>ahead" : "–"}</span>`;
      const bits = r.code != null ? [r.snow >= 0.5 ? `${Math.round(r.snow)} cm of snow` : r.rain >= 1 ? `${Math.round(r.rain)} mm of rain` : "Dry", ...(r.pop != null && r.rain >= 1 ? [`${r.pop}% chance`] : []),
        `wind ${Math.round(r.wind || 0)} km/h${r.gust >= 50 ? `, gusts ${Math.round(r.gust)}` : ""}`, ...(r.line != null ? [r.line < 200 ? "snow down to the valley" : `snow above about ${r.line.toLocaleString()} m`] : []), ...(r.sunset ? [`sunset ${hm(r.sunset)}`] : [])] : [];
      return `<li style="--c:${c}"><b>${esc(dayWord(r.date))}${r.tag ? ` · ${r.tag === "first" ? "first day" : "last day"}` : ""}</b>${wx}<span>${esc(wxWord(r.code))}${r.at ? ` <span class="sk-note">at ${esc(r.at)}</span>` : ""}</span>${bits.length ? `<small>${bits.map((x) => `<span>${esc(x)}</span>`).join(" · ")}</small>` : ""}${topHtml(r.top)}</li>`;
    }).join("");
    const far = v.rows.some((r) => r.code == null && v.end && r.date > v.end);
    return `<ul class="tp-days">${rows}</ul>
      <p class="sk-note">${v.old ? `<b>Saved forecast from ${esc(when(v.at))}</b> (no signal now). ` : v.at ? `Checked ${esc(when(v.at))}${t.autoAt && Math.abs(t.autoAt - v.at) < 60000 ? " (updated by itself)" : ""}`.replace(/\.$/, "") + ". " : ""}Weather where you sleep, a weather model's estimate (Open-Meteo, the middle of three models)${far ? `, about two weeks ahead at most: come back closer to the trip` : ""}. ${v.hp ? "High point: the highest spot on that day's hikes (pick a day beside each hike in Your hikes; hikes with no day count for every day without one), its height from the map's height data, the same models at that height." : "Add your hikes to also see the weather at their high point. Up high it can be colder, wetter and windier than at camp."}</p>`;
  }

  // ---------- parks, passes and warnings ----------
  // The park the trip is in and its pass (hike.js passFor, which links the park's own page), and the closures and
  // wildfires near it. Kept with the trip (t.parkSnap) for no signal.
  async function loadParks(t) {
    const c = centre(t);
    if (!c) return;
    const names = E.linesOf(t).map((x) => x.name);
    const [pk, warn] = await Promise.all([H.parks(c).catch(() => "error"), H.warnings(c, names).catch(() => null)]);
    const old = t.parkSnap || {};
    t.parkSnap = { at: Date.now(), park: pk === "error" ? old.park : pk, warn: warn || old.warn || null, err: pk === "error" && !warn };
    E.putTrip(t, true);
    if (cur() === t) { const el = E.part("tpPark"); if (el) el.innerHTML = `<h4>Parks, passes and warnings</h4>${parkHtml(t)}`; E.renderPack(); }
  }
  function parkHtml(t) {
    const s = t.parkSnap;
    if (!s) return `<p class="tp-wait">Checking the park and warnings near the trip…</p>`;
    const pk = s.park;
    const park = pk === undefined ? `<p class="sk-note">Couldn't check which park the trip is in right now.</p>` : pk ? `<div class="tp-warn"><b>${esc(pk.park)}</b><small><b>${esc(pk.p.name)}:</b> ${esc(pk.p.what)}${pk.p.url ? ` <a href="${esc(pk.p.url)}" target="_blank" rel="noopener">Check</a>` : ""}</small></div>` : pk === null ? `<p class="sk-note">Not in a park on the map: no pass that we know of. Watch for private land and posted signs.</p>` : "";
    const w = (s.warn || []).map((x) => `<div class="tp-warn ${x.bad ? "bad" : ""}"><b>${esc(x.text)}</b><small>${[x.sub, x.src].filter(Boolean).map(esc).join(" · ")}${x.url ? ` · <a href="${esc(x.url)}" target="_blank" rel="noopener">More</a>` : ""}</small></div>`).join("");
    return `${park}${w || (s.warn ? `<p class="sk-note">No closures or wildfires reported near the trip in the parks' and wildfire services' lists. They post new ones often: check before you go.</p>` : "")}
      <p class="sk-note">${s.err ? "Couldn't check the warnings right now (no signal or the server is busy). " : ""}From OpenStreetMap's park outlines, the parks' own closures pages and the wildfire services, checked ${esc(when(s.at).replace(/\.$/, ""))}. The park's own page is the final word on passes, permits and closures.</p>`;
  }

  // ---------- water along your hikes ----------
  // Drinking water taps and springs mapped within 250 m of the trip's hikes (Hiking's places: zoom in for them).
  function waterHtml(t) {
    const pts = E.linesOf(t).flatMap((x) => x.ls.flat());
    if (!pts.length) return "";
    const b = L.latLngBounds(pts).pad(0.05), near = H.allPlaces().filter((p) => p.k === "water" && b.contains(p.ll) && pts.some((q, i) => i % 3 === 0 && H.kmTo(q, p.ll) <= 0.25));
    return `${near.length ? `<ul class="tp-list">${near.slice(0, 8).map((p) => `<li><button type="button" data-hkp="${esc(p.id)}"><span>${esc(p.n || "Drinking water")}</span><small>${esc(H.placeFacts(p).join(" · ") || "drinking water")}</small></button></li>`).join("")}</ul>` : `<p class="sk-note">No drinking water taps mapped along your hikes (lakes and streams aren't counted: treat that water).</p>`}
      <p class="sk-note">As mapped on OpenStreetMap: a tap or spring may be dry or off for the season. Carry a filter or tablets.</p>`;
  }

  // ---------- packing list ----------
  // Built from the trip: how you sleep, nights and people, the coldest night and the rain in the forecast, the camps'
  // facts (booking, fee, water, toilets), and the park's pass.
  function packItems(t, view) {
    const n = t.nights, p = t.people, st = styleOf(t), camps = uniq(nightCamps(t)), tags = camps.map((c) => c.tags || {});
    const rows = view && view.rows ? view.rows.filter((r) => r.code != null) : [];
    const cold = rows.length ? Math.min(...rows.map((r) => r.lo)) : null, wet = rows.some((r) => r.rain >= 2), snowy = rows.some((r) => r.snow >= 1 || (r.line != null && r.line < 1500));
    const fuel = Math.max(1, Math.ceil((p * n * 30) / 110)) * 110;   // grams: about 30 g of canister fuel a person a day, in 110 g canisters
    const bag = cold == null ? "Sleeping bag" : `Sleeping bag rated to ${Math.min(5, Math.round(cold) - 5)}°C or warmer`;
    const tents = Math.ceil(p / 2), pk = t.parkSnap && t.parkSnap.park;
    return [
      ["Essentials", [
        ["nav", "Map and compass or GPS (this trip saved offline)"], ["lamp", "Headlamp and spare batteries"],
        ["sat", "Satellite messenger or PLB (inReach, Zoleo): many trails have no cell signal"], ["aid", "First aid kit"],
        ["repair", "Knife or multi-tool, repair kit and tape"], ["firekit", "Fire starter and waterproof matches"], ["bivy", "Emergency blanket or bivy"],
        ["sun", "Sunglasses, sunscreen and a hat"], ["bear", `Bear spray${p > 1 ? " each" : ""}, where you can reach it`], ["power", "Phone charged + power bank"]]],
      ["Hiking", [
        ["boots", "Hiking boots or trail shoes, broken in"], ["poles", "Trekking poles"],
        ["pack", st === "back" ? "Backpack big enough for camp (50-70 L) with a rain cover" : "Day pack with a rain cover"],
        ...(snowy ? [["spikes", "Microspikes: snow or ice possible up high in the forecast"]] : [])]],
      ["Sleeping", st === "hut" ? [
        ["bag", bag], ["plugs", "Earplugs"], ["booties", "Hut slippers or camp shoes"]] : [
        ["tent", `Tent${tents > 1 ? `s for ${p} (about ${tents})` : ""}, poles and pegs`], ["bag", bag], ["pad", "Sleeping pad"], ["pillow", "Pillow or a stuff sack of clothes"]]],
      ["Cooking and water", [
        ["stove", `Stove and about ${fuel} g of fuel`], ["pot", "Pot, lighter × 2, mug, spoon"],
        ["filter", "Water filter or tablets: treat water from lakes and streams"], ["bottle", `Water bottles or a bladder: 2 L ${p > 1 ? "each" : ""}`.trim()],
        ...(st !== "hut" ? [["food", "Food storage away from bears: a canister, a bag to hang, or the camp's food locker"]] : [])]],
      ["Food", [
        ["meals", `${n} breakfast${n > 1 ? "s" : ""}, ${n + 1} lunches and ${n} dinner${n > 1 ? "s" : ""}${p > 1 ? ` for ${p}` : ""}`],
        ["snacks", `Snacks for ${n + 1} days`], ["spare", "One spare day of food"]]],
      ["Clothes", [
        ["rain", wet ? "Rain jacket and pants: rain in the forecast" : "Rain jacket"], ["warm", cold != null && cold < 5 ? `Warm layer, toque and gloves: down to ${Math.round(cold)}°C at camp` : "Warm layer and a toque"],
        ["socks", `Dry socks for ${n} night${n > 1 ? "s" : ""}`], ["camp", "Camp shoes"]]],
      ["Camp", [
        ...(tags.some((g) => g.reservation === "required" || g.reservation === "yes") ? [["booking", "Booking confirmation"]] : []),
        ...(tags.some((g) => g.fee === "yes" || g.charge) ? [["fee", "Camp or hut fees"]] : []),
        ...(pk && pk.p && pk.p.name !== "Park rules" ? [["pass", `${pk.p.name} (see Parks, passes and warnings)`]] : []),
        ...(st === "car" ? [["cooler", "Cooler and ice"], ["chairs", "Camp chairs and a table cloth"], ["lantern", "Lantern"]] : []),
        ...(st !== "hut" && (!tags.length || tags.some((g) => g.toilets === "no" || !g.toilets)) ? [["trowel", "Trowel and toilet paper: not every camp has an outhouse"]] : []),
        ["fires", "Campfire rules: check the park or the wildfire service for fire bans"],
        ["trash", "Garbage bag: pack everything out"]]],
      ["Before you go", [["offline", "Trip saved offline (button below)"], ["plan", "Trip plan left with a friend (below)"]]],
    ];
  }

  // ---------- the plan you leave with someone ----------
  function planText(t, pl) {
    const ll = (a, b) => `${a.toFixed(5)}, ${b.toFixed(5)}`, link = (c) => `https://www.google.com/maps?q=${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
    const dates = E.tripDates(t), hikes = E.linesOf(t).map((x) => x.name), st = styleOf(t);
    const kind = st === "car" ? "camping trip" : st === "hut" ? "hut-to-hut hiking trip" : "backpacking trip";
    const camps = nightCamps(t).map((c, i) => (c ? `${dayWord(dates[i])}: ${c.name}, ${ll(c.lat, c.lon)} ${link(c)}` : "")).filter(Boolean);
    const hasSat = (t.packed || {}).sat;
    return [`TRIP PLAN: ${title(t)} (${kind})`,
      `Who: ${pl.who || "me"}${t.people > 1 ? ` (${t.people} people)` : ""}`,
      ...(t.start ? [`Start: ${t.start.name}, ${ll(t.start.lat, t.start.lon)} ${link(t.start)}`] : []),
      `First day: ${dayWord(t.date)}. Nights: ${t.nights}. Back at the car by ${when(pl.out)}`,
      ...(camps.length ? ["Where we sleep:", ...camps.map((x) => `- ${x}`)] : t.hut ? [`Place: ${t.hut.name}, ${ll(t.hut.lat, t.hut.lon)} ${link(t.hut)}`] : []),
      ...(hikes.length ? [`Hikes we plan: ${hikes.join(", ")}`] : []),
      ...(pl.car ? [`Car: ${pl.car}`] : []),
      `Gear: first aid, bear spray, headlamps${hasSat ? ", satellite messenger" : ""}, ${t.nights + 1} days of food + a spare day`,
      ``, `If you haven't heard from us by ${when(pl.help)}: call 911 (or the RCMP) and say we're overdue on a hiking trip. They call Search and Rescue. Read them this plan.`,
    ].join("\n");
  }

  // ---------- your hikes ----------
  function openLine(t, x) {
    if (x.rid && H.openHike(x.rid)) return;
    if (x.tour && H.openPlan(x.tour)) return;
    map.fitBounds(L.latLngBounds(x.ls.flat()), { padding: [30, 30], maxZoom: 15 });
    if (window.tfSnapTo) window.tfSnapTo("peek");
  }
  // ✏️ Draw a hike: Hiking's Plan a hike, from the trip's start or first camp; its card then offers to add it.
  let drawingFor = null;
  function onTp(k, t) {
    if (k === "drawline") {
      drawingFor = t.id;
      const c = t.start || nightCamps(t).find(Boolean) || t.hut;
      H.plan(c ? [c.lat, c.lon] : null);
      toast("Tap the map along your hike, then Done. Then tap 🏕 Add to the trip on the plan's card.");
    } else if (k === "place" && t.hut) {
      if (H.place(t.hut.id)) H.openPlace(t.hut.id); else map.setView([t.hut.lat, t.hut.lon], Math.max(map.getZoom(), 14));
    }
  }

  // ---------- the cards on the map: Plan a hike trip here, Sleep here, Add to hike trip ----------
  window.addEventListener("tf:hike-card", (e) => {
    const { kind, el, item } = e.detail || {};
    if (!el) return;
    el.querySelectorAll(".tp-addto, .tp-place-go").forEach((x) => x.remove());
    const rows = el.querySelectorAll(".hk-row"), after = rows[rows.length - 1] || el.lastElementChild;
    if (kind === "hike") { let it = null; E.offerAdd(after, () => it || (it = H.hikeItem(item))); return; }
    if (kind === "plan") {
      if (!item.route) return;
      const t = drawingFor && E.tripById(drawingFor);
      if (t) {   // drawn for a trip: one tap puts it in that trip
        const box = document.createElement("div");
        box.className = "tp-addto";
        box.innerHTML = `<button type="button">🏕 Add to the trip: ${esc(title(t))}</button>`;
        box.querySelector("button").addEventListener("click", () => {
          const x = H.planItem(); if (!x) return;
          E.addLine(t, x); drawingFor = null;
          toast(`Added to your trip to ${title(t)}.`); window.tfHappy && window.tfHappy("hike trip");
          if (!cur() || cur().id !== t.id) E.start(t); else E.scrollTo();
        });
        after.after(box);
      } else E.offerAdd(after, () => H.planItem());
      return;
    }
    if (kind !== "place" || ![...SLEEP, ...STARTS].includes(item.k)) return;
    const box = document.createElement("div");
    box.className = "tp-place-go";
    const t = cur() && !E.card.hidden ? cur() : null, sleep = SLEEP.includes(item.k);
    const free = t ? nightCamps(t).findIndex((c) => !c) : -1, here = t ? nightCamps(t).findIndex((c) => c && c.id === item.id) : -1;
    const b = (txt, f) => { const x = document.createElement("button"); x.type = "button"; x.className = "sk-tripgo"; x.textContent = txt; x.addEventListener("click", f); box.append(x); };
    if (t && sleep && here >= 0) box.innerHTML = `<p class="sk-note">✓ Night ${here + 1} of ${esc(title(t))}</p>`;
    else if (t && sleep && free >= 0) b(`🏕 Sleep here: night ${free + 1} of ${title(t)}`, () => { setCamp(t, free, placeOf(item)); toast(`${placeOf(item).name}: night ${free + 1}.`); E.scrollTo(); });
    else if (t && !sleep) b(`🏕 Start ${title(t)} here`, () => { t.start = placeOf(item); E.putTrip(t); E.render(); E.drawMap(); E.scrollTo(); toast(`${t.start.name} is where the trip starts.`); });
    else b("🏕 Plan a hike trip here", () => openFrom(item));
    if (box.childNodes.length) after.after(box);
  });
  // A new trip from a place's card: a campsite or hut is every night's camp (change any night after), a trailhead its start.
  function openFrom(p) {
    const pl = placeOf(p), sleep = SLEEP.includes(p.k);
    const old = E.trips().find((x) => x.hut && x.hut.id === pl.id);
    if (old) { E.start(old); return; }
    const t = E.newTrip();
    if (sleep) { t.hut = pl; t.style = p.k === "hut" ? "hut" : "back"; t.camps = Object.fromEntries(Array.from({ length: t.nights }, (_, i) => [i, pl])); }
    else t.start = pl;
    E.start(t);
    // The club's hut facts (booking, beds, price), when it has them.
    if (p.k === "hut" && !p.club) H.club(p).then((c) => { if (!c) return; p.club = c; const x = E.tripById(t.id); if (!x) return; const q = placeOf(p); if (x.hut && x.hut.id === q.id) x.hut = q; for (const i in x.camps || {}) if (x.camps[i].id === q.id) x.camps[i] = q; E.putTrip(x, true); if (cur() === x) E.render(); });
  }

  // ---------- the trips list: places near the middle of the map ----------
  function nearList() {
    const c = map.getCenter(), el = E.part("tpNear");
    if (!el) return;
    const near = oneEach(H.placesNear([c.lat, c.lng], 30, [...SLEEP, "th"])).sort((a, b) => (SLEEP.includes(b.p.k) - SLEEP.includes(a.p.k)) || a.d - b.d).slice(0, 8);
    el.innerHTML = near.length ? near.map(({ p, d }) => `<li><button type="button" data-hkp="${esc(p.id)}" data-go="1"><span>${esc(p.n)} <small>${esc(H.PLACES[p.k].label.toLowerCase())}</small></span><small>${d < 9.5 ? d.toFixed(1) : Math.round(d)} km</small></button></li>`).join("")
      : `<li class="sk-note">No campsites, huts or trailheads loaded near here: zoom the map in on where you're going.</li>`;
  }
  E.card.addEventListener("click", (e) => {
    const a = e.target.closest("[data-hkp]");
    if (!a) return;
    const p = H.place(a.dataset.hkp);
    if (!p) return;
    if (a.dataset.go) openFrom(p); else H.openPlace(p.id);
  });
  window.tfHikeTrip = api;
})();
