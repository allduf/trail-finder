// Plan a moto trip (Adventure moto): a multi-day ride with friends (alex 2026-11-16: "plan a moto trip, with the Ask
// search, scenic viewpoints and cool places to see along the way", and "the fuel plan checks EVERY rider's bike in the
// group"). Built on trip-core.js, which has every part a trip shares (the group, packing with Who brings?, meals,
// booking, costs, journal, sharing by link, the plan you tell someone, offline); this file is Moto's kit, from what
// Adventure moto already has (moto.js window.tfMoto.trip):
//  - Your routes for this trip, one for each day: a route planned in Plan a route, a saved route or an ADV route,
//    added from its card (+ Add to moto trip). Tap one to plan it again for turns, surfaces and Ride it.
//  - Riders and bikes: each rider in the group with their own bike (picked from the make and model list, which fills
//    in the tank and fuel use, or typed), and its range on a tank.
//  - Gas for every bike: on each route, the stretches with no gas station mapped near the road, checked against every
//    rider's range (keeping 20% of the tank, as Plan a route does). The shortest range sets the group's stops.
//  - Scenic places along the way: viewpoints, waterfalls, hot springs, historic sites, lighthouses, museums and
//    attractions mapped on OpenStreetMap within 2 km of the routes, in order along each one.
//  - Where you sleep: each night's campsite, BC rec site, motel or hotel, near the end of that day's route.
//  - Each day: the weather where you sleep (Open-Meteo through wxcheck.js, the middle of three models).
//  - Ask: "3-day dirt trip from Kamloops" in Moto's search box starts a trip there (ask.js, tfMotoTrip.startNear).
// Trips are kept in tf:motoTrips, on the account when signed in (account.js). Wording: facts and their source, and
// "estimate" where it is one; nothing here says a road is open, a station has fuel or a bike will make it. No route
// advice: the app shows what's mapped, the riders decide.
(() => {
  "use strict";
  const map = window.tfLeaflet, H = window.tfMoto && window.tfMoto.trip;
  if (!map || !window.L || !H || !window.tfTripEngine || (window.tfTrips && window.tfTrips.moto)) return;
  const isMoto = () => document.body.classList.contains("sport-moto");
  const COL = H.ACC;   // the Moto accent (burnt orange)
  const LCOL = "#7048e8";   // the trip's routes: the ADV routes' purple, not a road grade colour
  const svg = H.svg, IC = H.IC;
  const TENT = '<path d="M3 20 12 4l9 16z"/><path d="M12 4v16M9 20l3-5 3 5"/>';   // the hike trip's tent (Moto's camp icon reads like a warning sign this size)
  const css = document.createElement("style");
  css.textContent = `#motoPane .mt-actions.five { grid-template-columns: repeat(3, 1fr); }   /* six buttons with Day ride (moto.js): two rows of three */
#motoPane .mt-actions.five .mt-act { min-height: 50px; }
#motoPane .mt-act[aria-pressed="true"] { background: ${COL}; border-color: ${COL}; color: #fff; }
#motoPane .mt-act[aria-pressed="true"] svg { color: #fff; }
#motoPane .tp-card { border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm); }
#motoPane .tp-card h3 { margin: 0; font-size: .95rem; font-weight: 800; }
#motoPane .tp-card h3 svg { color: ${COL}; align-self: center; flex: none; }
#motoPane .tp-card .sk-x { float: right; font: inherit; border: 0; background: var(--chip); color: var(--muted); cursor: pointer; width: 28px; height: 28px; border-radius: 50%; }
#motoPane .tp-card .sk-sec { border-top: 1px solid var(--line); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; font-size: .85rem; }
#motoPane .tp-card .sk-sec h4 { margin: 0; font-size: .92rem; display: flex; align-items: center; gap: 6px; }
#motoPane .tp-card .sk-sec h4 svg { color: ${COL}; flex: none; }
#motoPane .tp-card .sk-sec h5 { margin: 4px 0 0; font-size: .85rem; }
#motoPane .tp-card .sk-sec p { margin: 0; }
#motoPane .tp-card .sk-note, #motoPane .tp-addto .sk-note { color: var(--muted); font-size: .78rem; font-weight: 400; margin: 0; }
#motoPane .tp-night { display: grid; grid-template-columns: 1fr; gap: 3px; margin: 4px 0 6px; font-size: .84rem; }
#motoPane .tp-night select { width: 100%; }
#motoPane .tp-warn { border-left: 4px solid #e8590c; padding: 4px 0 4px 9px; font-size: .82rem; }
#motoPane .tp-warn.bad { border-color: #c92a2a; }
#motoPane .tp-warn.ok { border-color: #2f9e44; }
#motoPane .tp-warn small { display: block; color: var(--muted); }
#motoPane .tp-rider { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
#motoPane .tp-rider b { font-size: .88rem; }
#motoPane .tp-rider small { grid-column: 1; color: var(--muted); font-size: .78rem; }
#motoPane .tp-rider > button { grid-column: 2; grid-row: 1 / span 2; font: inherit; font-size: .8rem; font-weight: 700; padding: 7px 11px; border-radius: 9px; border: 1px solid ${COL}; background: var(--panel); color: var(--fg); cursor: pointer; }
#motoPane .tp-rider.none { border-style: dashed; border-color: ${COL}; }
#motoPane .tp-bikef { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 8px 10px; border: 1.5px solid ${COL}; border-radius: 10px; background: color-mix(in srgb, ${COL} 6%, var(--panel)); }
#motoPane .tp-bikef .wide { grid-column: 1 / -1; }
#motoPane .tp-bikef label { display: flex; flex-direction: column; gap: 2px; font-size: .7rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); min-width: 0; }
#motoPane .tp-bikef input, #motoPane .tp-bikef select { font: inherit; font-size: 16px; padding: 7px 6px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); min-width: 0; width: 100%; box-sizing: border-box; text-transform: none; letter-spacing: 0; font-weight: 400; }
#motoPane .tp-bikef .tp-btns { grid-column: 1 / -1; }
#motoPane .tp-mine-bikes { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
#motoPane .tp-mine-bikes button { font: inherit; font-size: .8rem; font-weight: 700; padding: 7px 11px; border-radius: 999px; border: 1px solid ${COL}; background: var(--bg); color: var(--fg); cursor: pointer; }
#motoPane .tp-fuel h5 { display: flex; justify-content: space-between; gap: 8px; }
#motoPane .tp-fuel h5 small { color: var(--muted); font-weight: 600; }
#motoPane .tp-list button.tp-sight { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; gap: 1px 8px; align-items: center; text-align: left; }
#motoPane .tp-sight svg { color: var(--c, ${COL}); grid-row: 1 / span 2; }
#motoPane .tp-list button.tp-sight.ph { grid-template-columns: 56px minmax(0, 1fr) auto; }
#motoPane .tp-sight img { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; display: block; background: var(--chip); }
.tp-sightpop img { width: 220px; max-width: 100%; height: 140px; object-fit: cover; border-radius: 8px; display: block; margin-bottom: 6px; }
#motoPane .tp-sight span { display: flex; flex-direction: column; min-width: 0; }
#motoPane .tp-sight span small { white-space: normal; }
#motoPane .tp-sights h5 { margin: 6px 0 2px; font-size: .74rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
#motoPane .tp-place-go { display: flex; flex-direction: column; gap: 6px; }`;
  document.head.append(css);

  let E = null, $, esc, toast, when, dayWord;   // the engine (trip-core.js) and its helpers
  const cur = () => E.cur();
  const title = (t) => t.name || (t.start && t.start.name ? `From ${t.start.name}` : "") || "My moto trip";
  const stopsOf = (t) => t.stops || {};
  const stopOn = (t, i) => stopsOf(t)[i] || null;   // night i's stop (0 = the first night)
  const nightStops = (t) => Array.from({ length: t.nights }, (_, i) => stopOn(t, i));
  const uniq = (l) => { const seen = new Set(); return l.filter((c) => c && !seen.has(c.id) && seen.add(c.id)); };
  const r5 = (v) => +(+v).toFixed(5);
  const fmtKm = H.fmtKm;
  // Where each day ends: that day's route's last point (the routes in their order are the days), else that night's stop.
  const dayEnd = (t, i) => { const x = E.linesOf(t)[i], l = x && x.ls[x.ls.length - 1]; return l && l.length ? l[l.length - 1] : null; };
  const centre = (t) => {
    const c = nightStops(t).find(Boolean) || t.start;
    if (c) return [c.lat, c.lon];
    const pts = E.linesOf(t).flatMap((x) => x.ls.flat());
    if (!pts.length) return null;
    const b = L.latLngBounds(pts).getCenter();
    return [b.lat, b.lng];
  };

  const api = window.tfTripEngine((e) => { E = e; ({ $, esc, toast, when, dayWord } = e); return kit(); });
  if (!api) return;

  function kit() {
    return {
      id: "moto", key: "motoTrips", packKey: "motoPack", color: COL, lineColor: LCOL, pane: "moto", cardId: "mtTripCard",
      shared: ["start", "stops", "bikes"],
      w: {
        icon: svg(IC.trips, 18), trip: "moto trip", Trips: "Moto trips", btn: "Trips", btnTitle: "Plan a moto trip: a route for each day, every rider's bike and fuel range, scenic places on the way, where you sleep, offline",
        addTo: "+ Add to moto trip", line: "Route", lines: "Your routes, one for each day", goIn: "First day", first: "first day", last: "last day", prod: "Moto trip",
        overdue: "a motorcycle trip", journal: "How the roads were, where you stopped, what to bring next time.", finding: "Finding campsites near here…",
        updates: "the trip's weather", offPrefix: "Moto trip: ",
        offWhat: "the map, roads, gas and campsites in the square you pick (it starts around your routes and stops)",
        offSaved: "the map, roads, gas and campsites", offFresh: "the trip's files", offOut: "a route or a stop added since",
      },
      groupGear: new Set(["tools", "pump", "tube", "strap", "aid", "sat", "tent", "stove", "pot", "filter", "fuelcan", "booking"]),
      isOn: isMoto,
      mount(card, btn) {
        const pane = $("motoPane"), acts = pane && pane.querySelector(".mt-actions");
        if (!pane || !acts) return false;
        btn.className = "mt-act"; btn.dataset.act = "trip"; btn.id = "mtTripBtn";
        btn.innerHTML = `${svg('<path d="M3 20h18M5 20V9l7-5 7 5v11"/><path d="M9 20v-6h6v6"/>')}Trips`;
        acts.append(btn); acts.classList.add("five");
        const at = $("mtTrips");
        if (at) at.before(card); else pane.append(card);
      },
      title,
      namePh: () => "Like: Kootenays, 3 days",
      newTrip: () => ({ sport: "moto", stops: {}, bikes: {} }),
      start(t) {
        if (!t.sport) t.sport = "moto";
        E.loadDays(t);
        loadSights(t);
        waitFuel();
      },
      hasDays: (t) => !!centre(t),
      keyOf: (t) => JSON.stringify([t.stops || null, E.linesOf(t).map((x) => x.id)]),
      snapOf, daysHtml, packItems, planText,
      bookTop(t) {
        const l = uniq(nightStops(t));
        const rows = l.map((c) => `<p class="sk-note"><b>${esc(c.name)}</b>: ${esc(c.info || kindWord(c.kind))}${c.site ? ` · <a href="${esc(c.site)}" target="_blank" rel="noopener">Website</a>` : ""}</p>`).join("");
        return { tag: "", html: `${rows || `<p class="sk-note">Pick where you sleep (above) to see it here.</p>`}<p class="sk-note">Campgrounds and motels on popular routes can fill up in summer: check with them before you go. Many BC rec sites are first come, first served.</p>` };
      },
      bookSite: (t) => { const c = uniq(nightStops(t)).find((x) => x.site); return c ? c.site : ""; },
      bookWhat: (t) => { const l = uniq(nightStops(t)); return `Book ${l.length ? l.map((c) => c.name).join(", ") : "where you sleep"} for ${t.people} people.`; },
      costHint: () => "Add the gas, campsites, motels, ferries, food and anything else the group shares.",
      baseHtml,
      midHtml: (t) => `<div class="sk-sec" id="tpBikes">${bikesHtml(t)}</div>
      <div class="sk-sec" id="tpStops"><h4>${svg(TENT, 18)}Where you sleep</h4>${stopsHtml(t)}</div>
      ${centre(t) ? `<div class="sk-sec" id="tpDays"><h4>Each day</h4>${E.daysHtml()}</div>` : ""}`,
      afterLinesHtml: (t) => (E.linesOf(t).length ? `<div class="sk-sec tp-fuel" id="tpFuel"><h4>${svg(IC.fuel, 18)}Gas for every bike</h4>${fuelHtml(t)}</div>
      <div class="sk-sec tp-sights" id="tpSights"><h4>${svg(IC.peak, 18)}Scenic places along the way</h4>${sightsHtml(t)}</div>` : ""),
      linesEmpty: () => `No routes yet. Tap <b>Plan a route</b>: type the ride you want, like "Squamish to Pemberton, mostly dirt", or tap the map. Or open an ADV route or a saved route and tap <b>+ Add to moto trip</b>. Add them in the order you ride them: the first is day 1.`,
      drawLabel: () => "Plan a route",
      linesFirst: true, drawGo: true,   // alex 2026-11-17: Plan a route more visible, higher up, easier to use
      linesChanged: (t) => { t.sights = null; E.render(); E.drawMap(); loadSights(t); E.loadDays(t); },
      openLine, drawExtra, extraPts,
      gpxExtra: (t, trk, wpt) => uniq(nightStops(t)).map((c) => wpt(c.lat, c.lon, c.name)).join("") + (t.start ? wpt(t.start.lat, t.start.lon, `Start: ${t.start.name}`) : "")
        + ((t.sights && t.sights.list) || []).slice(0, 40).map((s) => wpt(s.lat, s.lon, s.n)).join(""),
      offBase: (t) => t.name || (t.start && t.start.name) || t.id,
      onTp, nearList, datesChanged: () => {},
      listNote: () => `Or start from a campsite near the middle of the map, or ask in the search box, like "3-day dirt trip from Kamloops":`,
    };
  }

  // ---------- the start ----------
  function baseHtml(t) {
    if (!t.start) return `<p class="sk-note">Tip: tap a campsite on the map for <b>Sleep here</b>, or add your first route below.</p>`;
    return `<div class="tp-facts"><span>Start: ${esc(t.start.name)}</span></div>`;
  }

  // ---------- riders and bikes ----------
  // Every rider in Your group with their bike (t.bikes, by the group's key; "me" while the group has no names). The
  // range is the tank over the fuel use (or typed, for an electric bike), the same sum as My bike in Adventure moto.
  const riders = (t) => ((t.group || []).length ? t.group.map((g) => ({ k: g.k, n: g.n })) : [{ k: "me", n: E.meOf(t) || "You" }]);
  const specOf = (b) => ({ n: String(b.name || (H.TYPES[b.type] || {}).label || "Bike").slice(0, 60), type: H.TYPES[b.type] ? b.type : "mid", tank: +b.tank || 0, l100: +b.l100 || 0, ...(b.range ? { range: +b.range } : {}) });
  const rangeKm = (s) => (s.range ? Math.round(+s.range) : s.tank > 0 && s.l100 > 0 ? Math.round((s.tank / s.l100) * 100) : 0);
  const usableKm = (s) => Math.round(rangeKm(s) * (1 - H.RESERVE));
  const bikeOf = (t, k) => { const b = (t.bikes || {})[k]; if (b) return b; if (k === "me" || riders(t)[0].k === k && riders(t).length === 1) { const m = H.myBike(); return m ? specOf(m) : null; } return null; };
  let editing = "", draft = null, makes = null;   // the rider whose bike is being picked, and the form so far
  // Optional (alex 2026-11-17: "add that as an option in the planning but not required"): folded until opened, and the
  // trip works the same without it (Gas for every bike then shows the gaps alone).
  function bikesHtml(t) {
    const rs = riders(t), n = rs.filter((r) => bikeOf(t, r.k)).length;
    return `<details class="tp-pack tp-bikes" ${t.bikesOpen || editing ? "open" : ""}><summary>${svg(IC.moto, 18)} Riders and bikes <small>${n ? `${n} of ${rs.length} bike${rs.length > 1 ? "s" : ""}` : "optional"}</small></summary>
      <p class="sk-note">Optional: add each rider's bike and Gas for every bike checks the gaps between gas stations against each bike's range.</p>${bikesBody(t, rs)}</details>`;
  }
  function bikesBody(t, rs) {
    const rows = rs.map((r) => {
      const b = bikeOf(t, r.k), set = !!(t.bikes || {})[r.k];
      if (editing === r.k) return bikeForm(t, r);
      return `<div class="tp-rider${b ? "" : " none"}"><b>${esc(r.n)}${b ? `: ${esc(b.n)}` : ""}</b><small>${b ? rangeKm(b) ? `about ${rangeKm(b).toLocaleString()} km a ${b.range ? "charge" : "tank"}${b.tank && !b.range ? ` (${b.tank} L, ${b.l100} L/100 km)` : ""}${set ? "" : ", from My bike"}` : "No tank size or fuel use: tap Change." : "No bike picked (optional)."}</small><button type="button" data-bike="${esc(r.k)}">${b ? "Change" : "Pick a bike"}</button></div>`;
    }).join("");
    const known = rs.map((r) => bikeOf(t, r.k)).filter((b) => b && rangeKm(b));
    const low = known.length ? known.reduce((a, b) => (usableKm(b) < usableKm(a) ? b : a)) : null;
    return `${rows}${(t.group || []).length ? "" : `<p class="sk-note">Riding with friends? Add their names in Your group (above) and each gets a bike here.</p>`}
      ${low && known.length > 1 ? `<p class="sk-note">Shortest range in the group: <b>${esc(low.n)}</b>, about ${usableKm(low)} km before it's down to 20% of the tank. The gas check below uses each bike's own range.</p>` : ""}
      <p class="sk-note">Ranges are estimates from the tank and fuel use entered: wind, speed, load and dirt can use a lot more. Check them against your own bikes.</p>`;
  }
  function bikeForm(t, r) {
    const d = draft || {}, mine = H.bikes(), mk = makes ? Object.keys(makes) : [];
    const models = makes && d.make && makes[d.make] ? makes[d.make] : [];
    return `<form class="tp-bikef" data-bikef="${esc(r.k)}"><b class="wide">${r.n === "You" ? "Your bike" : `${esc(r.n)}'s bike`}</b>
      ${mine.length ? `<div class="tp-mine-bikes">${mine.map((b) => `<button type="button" data-minebike="${esc(b.id)}">Use ${esc(b.name || H.TYPES[b.type].label)}</button>`).join("")}</div>` : ""}
      <label>Make<select data-bf="make"><option value="">${makes ? "Pick…" : makes === false ? "Offline: type it" : "Loading…"}</option>${mk.map((n) => `<option ${n === d.make ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
      <label>Model<select data-bf="model" ${models.length ? "" : "disabled"}><option value="">Pick…</option>${models.map((m, i) => `<option value="${i}" ${String(i) === String(d.mi) ? "selected" : ""}>${esc(m[0])} (${m[1]}${m[2] ? `-${m[2]}` : "+"})</option>`).join("")}</select></label>
      <label class="wide">Bike name<input type="text" data-bf="name" maxlength="60" value="${esc(d.name || "")}" placeholder="Like: Ténéré 700" autocomplete="off"></label>
      <label>Tank (L)<input type="number" inputmode="decimal" min="0" step="any" data-bf="tank" value="${esc(d.tank || "")}"></label>
      <label>L/100 km<input type="number" inputmode="decimal" min="0" step="any" data-bf="l100" value="${esc(d.l100 || "")}"></label>
      <label class="wide">Or the range you get (km)<input type="number" inputmode="numeric" min="0" step="1" data-bf="range" value="${esc(d.range || "")}" placeholder="Electric bikes, or your own number"></label>
      <p class="sk-note wide">The list fills in the maker's numbers: check them for your bike (a bigger tank, a thirsty one).</p>
      <div class="tp-btns"><button type="submit" class="go">Save</button><button type="button" data-bikecancel="1">Cancel</button>${(t.bikes || {})[r.k] ? `<button type="button" data-bikerm="${esc(r.k)}">Take off</button>` : ""}</div></form>`;
  }
  const renderBikes = () => { const el = E.part("tpBikes"); if (el) el.innerHTML = bikesHtml(cur()); };
  E.card.addEventListener("toggle", (e) => { if (cur() && e.target.classList && e.target.classList.contains("tp-bikes")) cur().bikesOpen = e.target.open; }, true);
  const renderFuel = () => { const el = E.part("tpFuel"), t = cur(); if (el && t) el.innerHTML = `<h4>${svg(IC.fuel, 18)}Gas for every bike</h4>${fuelHtml(t)}`; };
  E.card.addEventListener("click", (e) => {
    const t = cur(); if (!t) return;
    const b = e.target.closest("[data-bike], [data-bikecancel], [data-bikerm], [data-minebike]");
    if (!b) return;
    if (b.dataset.bike) {
      editing = b.dataset.bike; const have = (t.bikes || {})[editing];
      draft = have ? { name: have.n, tank: have.tank || "", l100: have.l100 || "", range: have.range || "", type: have.type } : {};
      renderBikes();
      if (makes == null) H.loadModels().then((m) => { makes = m || false; if (editing) renderBikes(); });
      return;
    }
    if (b.dataset.bikecancel) { editing = ""; draft = null; renderBikes(); return; }
    if (b.dataset.bikerm) { const x = { ...(t.bikes || {}) }; delete x[b.dataset.bikerm]; t.bikes = x; editing = ""; draft = null; E.putTrip(t); renderBikes(); renderFuel(); return; }
    if (b.dataset.minebike) {
      const m = H.bikes().find((x) => x.id === b.dataset.minebike); if (!m) return;
      t.bikes = { ...(t.bikes || {}), [editing]: specOf(m) }; editing = ""; draft = null;
      E.putTrip(t); renderBikes(); renderFuel(); E.renderPack();
    }
  });
  E.card.addEventListener("change", (e) => {
    const el = e.target, f = el.closest("[data-bikef]");
    if (!f || !draft) return;
    const k = el.dataset.bf;
    if (k === "make") { draft = { ...draft, make: el.value, mi: "" }; renderBikes(); return; }
    if (k === "model") {
      const row = makes && makes[draft.make] && makes[draft.make][+el.value];
      if (!row) return;
      // [model, first year, last year, kind, kg, tank L, L/100 km, range km (electric)]
      draft = { ...draft, mi: el.value, name: `${draft.make} ${row[0]}`, type: row[3], tank: row[5] || "", l100: row[6] || "", range: row[7] || "" };
      renderBikes(); return;
    }
    if (k) draft[k] = el.value;
  });
  E.card.addEventListener("input", (e) => { const k = e.target.dataset && e.target.dataset.bf; if (k && draft && k !== "make" && k !== "model") draft[k] = e.target.value; });
  E.card.addEventListener("submit", (e) => {
    const f = e.target; if (!f.dataset.bikef) return;
    e.preventDefault();
    const t = cur(); if (!t || !draft) return;
    const s = { n: String(draft.name || "").trim().slice(0, 60) || "Bike", type: H.TYPES[draft.type] ? draft.type : "mid", tank: Math.max(0, +draft.tank || 0), l100: Math.max(0, +draft.l100 || 0) };
    if (+draft.range > 0) s.range = Math.round(+draft.range);
    if (!rangeKm(s)) { toast("Add the tank and fuel use, or the range you get."); return; }
    t.bikes = { ...(t.bikes || {}), [f.dataset.bikef]: s }; editing = ""; draft = null;
    E.putTrip(t); renderBikes(); renderFuel(); E.renderPack();
    toast(`${s.n}: about ${rangeKm(s)} km a ${s.range ? "charge" : "tank"}.`);
  });

  // ---------- gas for every bike ----------
  // Each route's gaps between gas stations (moto.js fuelPlan: stations mapped within 1.5 km of the line, the start and
  // the end count), against each rider's range with 20% of the tank kept. An electric bike: chargers aren't mapped here.
  function fuelHtml(t) {
    const lines = E.linesOf(t), rs = riders(t).map((r) => ({ ...r, b: bikeOf(t, r.k) }));
    if (!H.fuelReady()) return `<p class="tp-wait">Loading the gas stations…</p>`;
    const gas = rs.filter((r) => r.b && rangeKm(r.b) && !r.b.range), ev = rs.filter((r) => r.b && r.b.range), none = rs.filter((r) => !r.b || !rangeKm(r.b));
    let over = 0;
    const days = lines.map((x, i) => {
      const fp = H.fuelPlan(x.ls.reduce((a, l) => (l.length > a.length ? l : a), []));
      if (!fp) return `<h5>Day ${i + 1}: ${esc(x.name)}</h5><p class="sk-note">Couldn't check this route.</p>`;
      const rows = gas.map((r) => {
        const u = usableKm(r.b), bad = fp.gaps.filter((g) => g.km > u);
        if (!bad.length) return `<div class="tp-warn ok"><b>${esc(r.n)}</b> (${esc(r.b.n)}, about ${u} km with 20% left): gas mapped at least every ${fmtKm(fp.longest)}.</div>`;
        over++;
        return bad.map((g) => { const L = Math.ceil(((g.km - u) * (r.b.l100 || H.TYPES[r.b.type].l100)) / 100 + 0.01); return `<div class="tp-warn bad"><b>${esc(r.n)}: ${fmtKm(g.km)} with no gas mapped</b><small>From ${esc(g.from.name)} to ${esc(g.to.name)}, more than ${esc(r.b.n)}'s ${u} km with 20% left. About ${L} L more would cover it (estimate).</small></div>`; }).join("");
      }).join("");
      return `<h5>Day ${i + 1}: ${esc(x.name)} <small>${fmtKm(x.km)} · ${fp.stops.length} station${fp.stops.length === 1 ? "" : "s"} · longest gap ${fmtKm(fp.longest)}</small></h5>${rows || `<p class="sk-note">Longest stretch with no gas mapped: ${fmtKm(fp.longest)}.</p>`}`;
    }).join("");
    return `${days}
      ${none.length ? `<p class="sk-note">${gas.length || ev.length ? `<b>${none.map((r) => esc(r.n)).join(", ")}</b>: no bike picked, so not checked against a range.` : "Add your bikes under Riders and bikes (optional) to check these gaps against each bike's range."}</p>` : ""}
      ${ev.length ? `<p class="sk-note">${ev.map((r) => esc(r.n)).join(", ")}: electric, and chargers aren't mapped here: check them yourself.</p>` : ""}
      <p class="sk-note">${over ? "Red: a stretch longer than that bike's range with 20% of the tank left. " : ""}Gas stations as mapped on OpenStreetMap, within 1.5 km of the route: a station can be closed, seasonal, card-only or out of fuel. Ranges and litres are estimates.</p>`;
  }
  // The gas stations come with Moto's data (ca/moto/fuel.json): the check redraws once they're in.
  let fuelWait = 0;
  function waitFuel() {
    clearTimeout(fuelWait);
    if (H.fuelReady()) return;
    let n = 0;
    const go = () => { if (H.fuelReady()) { renderFuel(); E.renderPack(); return; } if (++n < 40 && cur()) fuelWait = setTimeout(go, 750); };
    fuelWait = setTimeout(go, 750);
  }
  // The longest stretch over a rider's range, in litres, for the packing list (the spare fuel to carry).
  function spareFuel(t) {
    if (!H.fuelReady()) return 0;
    let most = 0;
    for (const x of E.linesOf(t)) {
      const fp = H.fuelPlan(x.ls.reduce((a, l) => (l.length > a.length ? l : a), []));
      if (!fp) continue;
      for (const r of riders(t)) { const b = bikeOf(t, r.k); if (!b || !rangeKm(b) || b.range) continue; const u = usableKm(b); for (const g of fp.gaps) if (g.km > u) most = Math.max(most, Math.ceil(((g.km - u) * (b.l100 || 5)) / 100 + 0.01)); }
    }
    return most;
  }

  // ---------- scenic places along the way ----------
  // Asked from OpenStreetMap (Overpass, the same servers Moto's live points use) along the trip's routes: what's mapped
  // within 2 km of the line, in order along each route. Kept with the trip (t.sights) for no signal; asked again when
  // the routes change. Motels and hotels near the end of each day come in the same ask, for Where you sleep.
  const SIGHT = {
    view: { n: "Viewpoint", c: "#1971c2", d: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
    fall: { n: "Waterfall", c: "#1098ad", d: '<path d="M4 3h16M7 3v8c0 3 2 5 5 5s5-2 5-5V3"/><path d="M9 21c1-2 5-2 6 0M12 16v5"/>' },
    hot: { n: "Hot spring", c: "#e64980", d: IC.hot },
    hist: { n: "Historic site", c: "#7950f2", d: '<path d="M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M2 10l10-6 10 6z"/>' },
    light: { n: "Lighthouse", c: "#e8590c", d: '<path d="M9 21l1.5-13h3L15 21zM8 21h8M10 8l2-4 2 4M5 6l3 1M19 6l-3 1"/>' },
    museum: { n: "Museum", c: "#5f3dc4", d: '<path d="M3 21h18M4 10h16L12 4zM6 10v8M10 10v8M14 10v8M18 10v8"/>' },
    see: { n: "Place to see", c: "#2b8a3e", d: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>' },
  };
  const LODGE = /^(motel|hotel|guest_house|hostel|chalet)$/;
  const kindOf = (g) => (g.tourism === "viewpoint" ? "view" : g.natural === "waterfall" ? "fall" : g.natural === "hot_spring" ? "hot" : g.man_made === "lighthouse" ? "light" : g.tourism === "museum" ? "museum" : g.historic ? "hist" : "see");
  const KINDW = { camp: "campground", rec: "BC rec site", motel: "motel", hotel: "hotel", guest_house: "guest house", hostel: "hostel", chalet: "cabin" };
  const kindWord = (k) => KINDW[k] || "place";
  const linesKey = (t) => E.linesOf(t).map((x) => `${x.id}:${x.km}`).join("|");
  // Every ~3 km of each line (a 1,000 km trip: about 330 points), in pieces of 250 points for the server.
  function thinLine(l, km) { const out = []; let last = null; for (const p of l) if (!last || H.kmBetween(last, p) >= km) { out.push(p); last = p; } const end = l[l.length - 1]; if (out[out.length - 1] !== end) out.push(end); return out; }
  async function overpass(q) {
    let err = null;
    for (const u of H.OVERPASS) {
      try { return await H.getJ(u, 40000, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } }); } catch (e) { err = e; }
    }
    throw err || new Error("no answer");
  }
  let sightSeq = 0;
  async function loadSights(t) {
    const lines = E.linesOf(t), key = linesKey(t);
    if (!lines.length) return;
    if (t.sights && t.sights.key === key && t.sights.list) return;
    if (!navigator.onLine) { renderSights(); return; }
    const my = ++sightSeq;
    t.sightWait = 1; renderSights();
    const all = lines.map((x) => x.ls.flatMap((l) => thinLine(l, 3)));
    const pts = all.flat(), ends = lines.map((x, i) => dayEnd(t, i)).filter(Boolean).slice(0, 10);
    const chunks = []; for (let i = 0; i < pts.length; i += 250) chunks.push(pts.slice(Math.max(0, i - 1), i + 250));
    const ll = (c) => c.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(",");
    const els = new Map();
    let err = "";
    for (let ci = 0; ci < chunks.length; ci++) {
      const a = `around:2000,${ll(chunks[ci])}`;
      const lodge = ci === 0 ? ends.map((p) => `nwr(around:4000,${p[0].toFixed(4)},${p[1].toFixed(4)})["tourism"~"^(motel|hotel|guest_house|hostel|chalet)$"]["name"];`).join("") : "";
      const q = `[out:json][timeout:35];(nwr(${a})["tourism"="viewpoint"];nwr(${a})["natural"~"^(waterfall|hot_spring)$"];nwr(${a})["man_made"="lighthouse"];nwr(${a})["tourism"~"^(attraction|museum)$"]["name"];nwr(${a})["historic"~"^(monument|ruins|fort|castle|archaeological_site|ship|locomotive|mine|wreck|building|church|aircraft|aqueduct)$"]["name"];${lodge});out center tags qt;`;
      try { const j = await overpass(q); for (const x of j.elements || []) els.set(x.type[0] + x.id, x); } catch (e) { err = e.message || "no answer"; }
      if (my !== sightSeq) return;
    }
    const tt = E.tripById(t.id) || t;
    delete tt.sightWait; delete t.sightWait;
    if (err && !els.size) { tt.sightErr = err; E.putTrip(tt, true); renderSights(); return; }
    const list = [], lodges = [];
    // Each place's distance along the route it's nearest to (km from that route's start).
    const cums = lines.map((x) => { const l = x.ls.reduce((a, b) => (b.length > a.length ? b : a), []), c = [0]; for (let i = 1; i < l.length; i++) c.push(c[i - 1] + H.kmBetween(l[i - 1], l[i])); return { l, c }; });
    for (const [id, x] of els) {
      const g = x.tags || {}, lat = x.lat != null ? x.lat : x.center && x.center.lat, lon = x.lon != null ? x.lon : x.center && x.center.lon;
      if (lat == null || lon == null) continue;
      const name = H.realName(g.name || "");
      if (LODGE.test(g.tourism || "")) { if (name) lodges.push({ id: "o" + id, name, kind: g.tourism, lat: r5(lat), lon: r5(lon), site: /^https?:\/\//.test(g.website || "") ? g.website : "", info: [kindWord(g.tourism), g.phone ? g.phone : ""].filter(Boolean).join(" · ") }); continue; }
      let best = { d: 1e9, li: 0, km: 0 };
      cums.forEach(({ l, c }, li) => { const step = Math.max(1, Math.floor(l.length / 800)); for (let i = 0; i < l.length; i += step) { const d = Math.abs(l[i][0] - lat) * 111 + Math.abs(l[i][1] - lon) * 75; if (d < best.d) best = { d, li, km: c[i] }; } });
      if (best.d > 4) continue;
      const k = kindOf(g);
      if (k !== "view" && !name) continue;
      const wiki = /^[a-z-]{2,10}:.+/.test(g.wikipedia || "") ? `https://${g.wikipedia.split(":")[0]}.wikipedia.org/wiki/${encodeURIComponent(g.wikipedia.slice(g.wikipedia.indexOf(":") + 1).replace(/ /g, "_"))}` : "";
      list.push({ id, n: name || SIGHT[k].n, k, lat: r5(lat), lon: r5(lon), li: best.li, km: Math.round(best.km), wiki, wd: /^Q\d+$/.test(g.wikidata || "") ? g.wikidata : "", d: String(g.description || "").slice(0, 140) });
    }
    // A viewpoint with no name next to another one is the same view: one each 1 km. The order: by route, then along it.
    const keep = [];
    for (const s of list.sort((a, b) => a.li - b.li || a.km - b.km)) if (!keep.some((o) => o.k === s.k && (s.n === o.n || s.k === "view") && H.kmBetween([o.lat, o.lon], [s.lat, s.lon]) < 1)) keep.push(s);
    tt.sights = { key, at: Date.now(), list: keep.slice(0, 120), lodge: lodges.slice(0, 40), part: err ? 1 : 0 };
    delete tt.sightErr;
    E.putTrip(tt, true);
    if (cur() && cur().id === tt.id) { cur().sights = tt.sights; renderSights(); renderStops(); E.drawMap(); }
    addPhotos(tt);
  }
  // Wikipedia photos (alex 2026-11-17: "yes i like it"): the article's own picture for a place that has an article on
  // OpenStreetMap (its wikipedia tag), else the Wikidata picture (its wikidata tag, Wikimedia Commons). Asked once and
  // kept with the trip (the picture's address only: the phone's browser keeps the picture itself).
  async function addPhotos(t) {
    const s = t.sights; if (!s || !s.list) return;
    const todo = s.list.filter((p) => (p.wiki || p.wd) && p.img === undefined).slice(0, 50);
    if (!todo.length) return;
    const wds = todo.filter((p) => p.wd).map((p) => p.wd);
    const byWd = {};
    for (let i = 0; i < wds.length; i += 50) {
      try {
        const j = await H.getJ(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wds.slice(i, i + 50).join("|")}&props=claims|sitelinks&format=json&origin=*`, 15000);
        for (const [q, e] of Object.entries(j.entities || {})) {
          const f = e.claims && e.claims.P18 && e.claims.P18[0] && e.claims.P18[0].mainsnak.datavalue && e.claims.P18[0].mainsnak.datavalue.value;
          const sl = e.sitelinks || {}, w = sl.enwiki || sl.frwiki;
          byWd[q] = { img: f ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(f).replace(/ /g, "_"))}?width=320` : "", wiki: w ? `https://${w.site.slice(0, 2)}.wikipedia.org/wiki/${encodeURIComponent(w.title.replace(/ /g, "_"))}` : "" };
        }
      } catch (_) {}
    }
    for (const p of todo) {
      const w = p.wd && byWd[p.wd];
      if (w) { if (!p.wiki && w.wiki) p.wiki = w.wiki; if (w.img) { p.img = w.img; continue; } }
      if (p.wiki) {
        const m = p.wiki.match(/^https:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/(.+)$/);
        const j = m && await H.getJ(`https://${m[1]}.wikipedia.org/api/rest_v1/page/summary/${m[2]}`, 12000).catch(() => null);
        p.img = (j && j.thumbnail && j.thumbnail.source) || "";
      } else p.img = "";
    }
    const tt = E.tripById(t.id) || t;
    if (tt.sights === s || (tt.sights && tt.sights.key === s.key)) { tt.sights = s; E.putTrip(tt, true); if (cur() && cur().id === tt.id) { cur().sights = s; renderSights(); } }
  }
  let sightOpen = new Set([0]);   // the routes whose list is open (the first one to start)
  function sightsHtml(t) {
    const s = t.sights, lines = E.linesOf(t);
    if (t.sightWait && !(s && s.list)) return `<p class="tp-wait">Looking for viewpoints and places to see along your routes…</p>`;
    if (!s || !s.list) return t.sightErr ? `<p class="sk-note">Couldn't look them up right now (${esc(t.sightErr)}). <button type="button" class="tp-linkbtn" data-sightre="1">Try again</button></p>` : `<p class="sk-note">${navigator.onLine ? "Looking…" : "Places along the way load when you have signal."}</p>`;
    const by = lines.map((x, i) => ({ x, i, l: s.list.filter((p) => p.li === i) }));
    const row = (p) => `<li><button type="button" class="tp-sight${p.img ? " ph" : ""}" data-sight="${esc(p.id)}" style="--c:${SIGHT[p.k].c}">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : svg(SIGHT[p.k].d, 20)}<span>${esc(p.n)}<small>${esc(SIGHT[p.k].n)}${p.d ? ` · ${esc(p.d)}` : ""}</small></span><small>km ${p.km}</small></button></li>`;
    const old = s.key !== linesKey(t);
    return `${by.map(({ x, i, l }) => `<details class="tp-pack" data-sightday="${i}" ${sightOpen.has(i) ? "open" : ""}><summary>Day ${i + 1}: ${esc(x.name)} <small>${l.length ? `${l.length} place${l.length > 1 ? "s" : ""}` : "none mapped"}</small></summary>
        ${l.length ? `<ul class="tp-list">${l.map(row).join("")}</ul>` : `<p class="sk-note">No viewpoints or places to see mapped within 2 km of this route.</p>`}</details>`).join("")}
      <p class="sk-note">${old ? "<b>From before your last change to the routes</b> (no signal to look again). " : ""}${s.part ? "Some of the route couldn't be checked (the server was busy). " : ""}Mapped on OpenStreetMap within 2 km of your routes, checked ${esc(when(s.at).replace(/\.$/, ""))}. Some are on private land or behind a gate: what's mapped isn't always open to visit.${s.list.some((p) => p.img) ? " Photos from Wikipedia and Wikimedia Commons." : ""}</p>`;
  }
  const renderSights = () => { const el = E.part("tpSights"), t = cur(); if (el && t) el.innerHTML = `<h4>${svg(IC.peak, 18)}Scenic places along the way</h4>${sightsHtml(t)}`; };
  E.card.addEventListener("toggle", (e) => { const d = e.target.closest && e.target.closest("[data-sightday]"); if (d) { if (d.open) sightOpen.add(+d.dataset.sightday); else sightOpen.delete(+d.dataset.sightday); } }, true);
  let sightMark = null;
  E.card.addEventListener("click", (e) => {
    const t = cur(); if (!t) return;
    if (e.target.closest("[data-sightre]")) { delete t.sightErr; t.sights = null; loadSights(t); return; }
    const b = e.target.closest("[data-sight]"); if (!b) return;
    const p = ((t.sights && t.sights.list) || []).find((x) => x.id === b.dataset.sight); if (!p) return;
    if (sightMark) sightMark.remove();
    sightMark = L.circleMarker([p.lat, p.lon], { pane: "moto", radius: 11, color: "#fff", weight: 3, fillColor: SIGHT[p.k].c, fillOpacity: 1, interactive: false }).addTo(E.layer);
    if (window.tfSnapTo) window.tfSnapTo("peek");
    map.setView([p.lat, p.lon], Math.max(map.getZoom(), 13));
    const links = [`<a href="https://www.openstreetmap.org/${{ n: "node", w: "way", r: "relation" }[p.id[0]]}/${p.id.slice(1)}" target="_blank" rel="noopener">OpenStreetMap</a>`, ...(p.wiki ? [`<a href="${esc(p.wiki)}" target="_blank" rel="noopener">Wikipedia</a>`] : [])];
    L.popup({ autoPan: true, closeButton: true }).setLatLng([p.lat, p.lon]).setContent(`<div class="tp-sightpop">${p.img ? `<img src="${esc(p.img)}" alt="${esc(p.n)}" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}<b>${esc(p.n)}</b><br><small>${esc(SIGHT[p.k].n)} · km ${p.km} of day ${p.li + 1}</small><br>${links.join(" · ")}${p.img ? `<br><small>Photo: Wikipedia / Wikimedia Commons</small>` : ""}</div>`).openOn(map);
  });

  // ---------- where you sleep, each night ----------
  // A campsite, BC rec site, motel or hotel for each night: campsites near the end of that day's route (Moto's own data),
  // motels and hotels mapped near it (from the places ask above), or one picked with Sleep here on a campsite's card.
  const placeFromPin = (pin) => { const p = pin.p, rec = !!p.rec || pin.k === "rec"; return { id: `${rec ? "r" : "c"}${p[0].toFixed(4)},${p[1].toFixed(4)}`, name: H.realName(p[2]) || (rec ? "BC rec site" : "Campsite"), kind: rec ? "rec" : "camp", lat: r5(p[0]), lon: r5(p[1]), info: H.kindLine(rec ? "rec" : "camp", p) }; };
  function optionsFor(t, i) {
    const at = dayEnd(t, i) || stopOn(t, i - 1) && [stopOn(t, i - 1).lat, stopOn(t, i - 1).lon] || centre(t);
    if (!at) return [];
    const camps = H.campsNear(at, 40, 10).map(({ p }) => placeFromPin({ k: p.rec ? "rec" : "camp", p }));
    const lodges = ((t.sights && t.sights.lodge) || []).filter((x) => H.kmBetween(at, [x.lat, x.lon]) <= 6);
    return uniq([...lodges, ...camps]).map((p) => ({ ...p, away: H.kmBetween(at, [p.lat, p.lon]) })).sort((a, b) => a.away - b.away).slice(0, 14);
  }
  function stopsHtml(t) {
    const dates = E.tripDates(t);
    const rows = Array.from({ length: t.nights }, (_, i) => {
      const c = stopOn(t, i), opts = uniq([c, ...optionsFor(t, i)]);
      const end = dayEnd(t, i);
      return `<label class="tp-night"><b>Night ${i + 1} · ${esc(dayWord(dates[i]))}</b><select data-stop="${i}" aria-label="Where you sleep night ${i + 1}"><option value="">${c ? "Not picked" : "Pick where you sleep"}</option>${i > 0 && stopOn(t, i - 1) && !(c && c.id === stopOn(t, i - 1).id) ? `<option value="=prev">Same as night ${i}: ${esc(stopOn(t, i - 1).name)}</option>` : ""}${opts.map((p) => `<option value="${esc(p.id)}" ${c && c.id === p.id ? "selected" : ""}>${esc(p.name)} (${esc(kindWord(p.kind))}${p.away != null && end ? `, ${fmtKm(p.away)} from the end of day ${i + 1}` : ""})</option>`).join("")}</select></label>`;
    }).join("");
    return `${rows}<p class="sk-note">${E.linesOf(t).length ? "Near the end of each day's route (the routes in order are the days). " : "Add your routes above for places near the end of each day. "}Or tap a campsite on the map, then <b>Sleep here</b>. Campsites from OpenStreetMap and BC Recreation Sites, motels and hotels from OpenStreetMap: check with them before you go.</p>`;
  }
  const renderStops = () => { const el = E.part("tpStops"), t = cur(); if (el && t) el.innerHTML = `<h4>${svg(TENT, 18)}Where you sleep</h4>${stopsHtml(t)}`; };
  function setStop(t, i, p) {
    t.stops = { ...stopsOf(t) };
    if (p) t.stops[i] = p; else delete t.stops[i];
    t.snap = null;
    E.putTrip(t);
    if (cur() === t) { E.setView(null); E.render(); E.drawMap(); E.loadDays(t); }
  }
  E.card.addEventListener("change", (e) => {
    const el = e.target, t = cur();
    if (!el.dataset.stop || !t) return;
    const i = +el.dataset.stop, v = el.value;
    if (v === "=prev") { setStop(t, i, stopOn(t, i - 1)); return; }
    const c = stopOn(t, i), p = v ? (c && c.id === v ? c : optionsFor(t, i).find((x) => x.id === v)) : null;
    if (p) { const { away, ...keep } = p; setStop(t, i, keep); } else setStop(t, i, null);
  });

  // ---------- the map ----------
  function drawExtra(t, layer) {
    uniq(nightStops(t)).forEach((c) => L.circleMarker([c.lat, c.lon], { pane: "moto", radius: 8, color: "#fff", weight: 3, fillColor: COL, fillOpacity: 1, interactive: false }).addTo(layer));
    if (t.start) L.marker([t.start.lat, t.start.lon], { pane: "moto", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<span style="display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:${COL};color:#fff;font:800 11px/1 system-ui;border:2px solid #fff">S</span>`, iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(layer);
    ((t.sights && t.sights.list) || []).forEach((s) => L.circleMarker([s.lat, s.lon], { pane: "moto", radius: 5, color: "#fff", weight: 2, fillColor: SIGHT[s.k].c, fillOpacity: 1, interactive: false }).addTo(layer));
  }
  function extraPts(t) { return [...uniq(nightStops(t)).map((c) => [c.lat, c.lon]), ...(t.start ? [[t.start.lat, t.start.lon]] : [])]; }

  // ---------- each day ----------
  // The weather where you sleep each night (or where that day's route ends), Open-Meteo through wxcheck.js.
  const WX = [[0, "Clear"], [2, "Some cloud"], [3, "Cloudy"], [48, "Fog"], [57, "Drizzle"], [67, "Rain"], [77, "Snow"], [82, "Showers"], [86, "Snow showers"], [99, "Thunderstorms"]];
  const wxWord = (c) => (c == null ? "" : (WX.find((x) => c <= x[0]) || WX.at(-1))[1]);
  const getWx = (u) => (window.tfWx ? window.tfWx.getChecked(u) : H.getJ(u));
  async function snapOf(t) {
    const dates = E.tripDates(t), c0 = centre(t);
    if (!c0) return { err: "no place yet" };
    const locOf = (j) => { const s = stopOn(t, j) || stopOn(t, j - 1); if (s) return { ll: [s.lat, s.lon], name: s.name }; const e = dayEnd(t, j) || dayEnd(t, j - 1); return e ? { ll: e, name: `end of day ${dayEnd(t, j) ? j + 1 : j}` } : { ll: c0, name: "" }; };
    const locs = dates.map((d, j) => locOf(j)), kk = (l) => l.ll.map((v) => (+v).toFixed(2)).join(","), keys = [...new Set(locs.map(kk))];
    const got = {};
    let err = "";
    for (const k of keys) {
      const [lat, lon] = k.split(",");
      const q = new URLSearchParams({ latitude: lat, longitude: lon, daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunset", forecast_days: "16", timezone: "auto" });
      try { got[k] = await getWx(`https://api.open-meteo.com/v1/forecast?${q}`); } catch (e) { err = e.message || "no signal"; }
    }
    if (!Object.keys(got).length) return { err: err || "no signal" };
    let end = "";
    const rows = dates.map((date, j) => {
      const l = locs[j], w = got[kk(l)], row = { date, tag: j === 0 ? "first" : j === t.nights ? "last" : "", at: l.name };
      const dd = w && w.daily;
      if (!dd) return row;
      if (!end || dd.time.at(-1) < end) end = dd.time.at(-1);
      const i = dd.time.indexOf(date);
      if (i < 0) return row;
      return Object.assign(row, { code: dd.weather_code[i], hi: dd.temperature_2m_max[i], lo: dd.temperature_2m_min[i], rain: dd.precipitation_sum[i] || 0, snow: dd.snowfall_sum[i] || 0,
        pop: dd.precipitation_probability_max ? dd.precipitation_probability_max[i] : null, wind: dd.wind_speed_10m_max[i], gust: dd.wind_gusts_10m_max[i], sunset: dd.sunset[i] });
    });
    return { snap: { at: Date.now(), rows, end } };
  }
  const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  const deg = (v) => (v == null ? "–" : `${Math.round(v) === 0 ? 0 : Math.round(v)}°`);
  function daysHtml(t, v) {
    const rows = v.rows.map((r) => {
      const wet = r.code != null && (r.rain >= 5 || r.snow >= 1 || r.code >= 95), c = r.code == null ? "var(--line)" : wet ? "#1c7ed6" : r.lo != null && r.lo <= 3 ? "#74c0fc" : COL;
      const wx = r.code != null ? `<span class="tp-wx"><big>${deg(r.hi)}</big><br>low ${deg(r.lo)}</span>` : `<span class="tp-wx sk-note">${v.end && r.date > v.end ? "Too far<br>ahead" : "–"}</span>`;
      const bits = r.code != null ? [r.snow >= 0.5 ? `${Math.round(r.snow)} cm of snow` : r.rain >= 1 ? `${Math.round(r.rain)} mm of rain` : "Dry", ...(r.pop != null && r.rain >= 1 ? [`${r.pop}% chance`] : []),
        `wind ${Math.round(r.wind || 0)} km/h${r.gust >= 50 ? `, gusts ${Math.round(r.gust)}` : ""}`, ...(r.sunset ? [`sunset ${hm(r.sunset)}`] : [])] : [];
      return `<li style="--c:${c}"><b>${esc(dayWord(r.date))}${r.tag ? ` · ${r.tag === "first" ? "first day" : "last day"}` : ""}</b>${wx}<span>${esc(wxWord(r.code))}${r.at ? ` <span class="sk-note">at ${esc(r.at)}</span>` : ""}</span>${bits.length ? `<small>${bits.map(esc).join(" · ")}</small>` : ""}</li>`;
    }).join("");
    const far = v.rows.some((r) => r.code == null && v.end && r.date > v.end);
    return `<ul class="tp-days">${rows}</ul>
      <p class="sk-note">${v.old ? `<b>Saved forecast from ${esc(when(v.at))}</b> (no signal now). ` : v.at ? `Checked ${esc(when(v.at).replace(/\.$/, ""))}. ` : ""}Weather where you sleep, a weather model's estimate (Open-Meteo, the middle of three models)${far ? `, about two weeks ahead at most: come back closer to the trip` : ""}. Passes and high roads on the way can be colder, wetter and windier, with snow.</p>`;
  }

  // ---------- packing list ----------
  // Built from the trip: nights and people, the forecast (cold, rain), where you sleep (camping or not), how much dirt,
  // and the spare fuel the gas check asks for.
  function packItems(t, view) {
    const n = t.nights, p = t.people, st = uniq(nightStops(t));
    const camping = !st.length || st.some((c) => c.kind === "camp" || c.kind === "rec");
    const rows = view && view.rows ? view.rows.filter((r) => r.code != null) : [];
    const cold = rows.length ? Math.min(...rows.map((r) => r.lo)) : null, wet = rows.some((r) => r.rain >= 2);
    const spare = spareFuel(t), tents = Math.ceil(p / 2);
    return [
      ["Riding gear", [
        ["helmet", "Helmet (and a visor cleaner)"], ["jacket", "Riding jacket and pants with armour"], ["gloves", cold != null && cold < 8 ? `Gloves, and a warm pair: down to ${Math.round(cold)}°C` : "Gloves"],
        ["boots", "Riding boots"], ["rain", wet ? "Rain suit: rain in the forecast" : "Rain suit"], ["neck", "Neck warmer or buff"], ["earplugs", "Earplugs"]]],
      ["The bike", [
        ["check", "Bike checked: tires, chain, oil, brakes, lights"], ["tools", "Tool kit for your bikes"], ["pump", "Tire repair kit and a pump or CO2"],
        ["tube", "Spare tubes and tire irons (tubed tires)"], ["lube", "Chain lube"], ["zip", "Zip ties, tape and a spare lever"], ["strap", "Tow strap"],
        ...(spare ? [["fuelcan", `Spare fuel: about ${spare} L (see Gas for every bike)`]] : [["fuelcan", "Spare fuel bottle or can"]]), ["keys", "Spare key"]]],
      ["Papers", [
        ["licence", "Licence, registration and insurance"], ["cash", "Cash and a card: some gas stations and ferries are card-only or cash-only"]]],
      ["Essentials", [
        ["sat", "Satellite messenger or PLB (inReach, Zoleo): many back roads have no cell signal"], ["aid", "First aid kit"],
        ["power", "Phone mount, cable and a power bank"], ["nav", "This trip saved offline, and a paper map"], ["water", "Water and snacks for each day"],
        ["lamp", "Headlamp"], ["sun", "Sunglasses and sunscreen"], ...(camping ? [["bear", "Bear spray, where you can reach it"]] : [])]],
      ...(camping ? [["Camping", [
        ["tent", `Tent${tents > 1 ? `s for ${p} (about ${tents})` : ""}`], ["bag", cold == null ? "Sleeping bag" : `Sleeping bag rated to ${Math.min(5, Math.round(cold) - 5)}°C or warmer`], ["pad", "Sleeping pad"],
        ["stove", "Stove and fuel"], ["pot", "Pot, lighter, mug, spoon"], ["filter", "Water filter or tablets"], ["food", "Food storage away from bears"],
        ["meals", `${n} breakfast${n > 1 ? "s" : ""} and ${n} dinner${n > 1 ? "s" : ""}${p > 1 ? ` for ${p}` : ""}`]]]] : []),
      ["Clothes", [["layers", "Warm layer for the evenings"], ["camp", "Camp shoes"], ["socks", `Dry socks for ${n} night${n > 1 ? "s" : ""}`]]],
      ["Before you go", [["offline", "Trip saved offline (button below)"], ["plan", "Trip plan left with a friend (below)"]]],
    ];
  }

  // ---------- the plan you leave with someone ----------
  function planText(t, pl) {
    const ll = (a, b) => `${a.toFixed(5)}, ${b.toFixed(5)}`, link = (c) => `https://www.google.com/maps?q=${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
    const dates = E.tripDates(t), lines = E.linesOf(t);
    const stops = nightStops(t).map((c, i) => (c ? `${dayWord(dates[i])}: ${c.name}, ${ll(c.lat, c.lon)} ${link(c)}` : "")).filter(Boolean);
    const bikes = riders(t).map((r) => { const b = bikeOf(t, r.k); return b ? `${r.n}: ${b.n}` : ""; }).filter(Boolean);
    return [`TRIP PLAN: ${title(t)} (motorcycle trip)`,
      `Who: ${pl.who || "me"}${t.people > 1 ? ` (${t.people} people)` : ""}`,
      ...(bikes.length ? [`Bikes: ${bikes.join("; ")}`] : []),
      ...(pl.car ? [`Plates / vehicle: ${pl.car}`] : []),
      ...(t.start ? [`Start: ${t.start.name}, ${ll(t.start.lat, t.start.lon)} ${link(t.start)}`] : []),
      `First day: ${dayWord(t.date)}. Nights: ${t.nights}. Back by ${when(pl.out)}`,
      ...(lines.length ? ["Routes:", ...lines.map((x, i) => `- Day ${i + 1}: ${x.name} (${Math.round(x.km)} km), from ${ll(x.ls[0][0][0], x.ls[0][0][1])}`)] : []),
      ...(stops.length ? ["Where we sleep:", ...stops.map((x) => `- ${x}`)] : []),
      ``, `If you haven't heard from us by ${when(pl.help)}: call 911 (or the RCMP) and say we're overdue on a motorcycle trip. Read them this plan.`,
    ].join("\n");
  }

  // ---------- your routes ----------
  function openLine(t, x) {
    if (x.rid && x.rid.startsWith("adv:")) { H.openAdv(x.rid.slice(4)); return; }
    H.planLine(x.ls.reduce((a, l) => (l.length > a.length ? l : a), []), x.name);   // planned again: turns, surfaces, closures, Ride it
  }
  // Plan a route: Moto's Plan a route, from the end of the last route (or a stop, or the start); its card then offers
  // to add it to this trip.
  let drawingFor = null;
  function onTp(k, t) {
    if (k !== "drawline") return;
    drawingFor = t.id;
    const last = E.linesOf(t).length ? dayEnd(t, E.linesOf(t).length - 1) : null, c = last || (t.start ? [t.start.lat, t.start.lon] : null);
    H.planFrom(c);
    toast("Tap the map where you're going, or type the ride you want. Then tap + Add to the trip on the route's card.");
  }

  // ---------- the cards: a planned route, an ADV route, a campsite ----------
  window.addEventListener("tf:moto-card", (e) => {
    const { kind, el, item } = e.detail || {};
    if (!el) return;
    el.querySelectorAll(".tp-addto, .tp-place-go").forEach((x) => x.remove());
    if (kind === "route") {
      const ride = el.querySelector('[data-r="ride"]'), after = (ride && ride.closest(".mt-row")) || el.lastElementChild;
      const t = drawingFor && E.tripById(drawingFor);
      if (t) {   // planned for a trip: one tap puts it in that trip
        const box = document.createElement("div");
        box.className = "tp-addto";
        const inT = E.linesOf(t).some((y) => y.name === (H.routeItem() || {}).name && Math.abs(y.km - (H.routeItem() || {}).km) < 1);
        box.innerHTML = inT ? `<p class="sk-note">In your trip: ${esc(title(t))}</p>` : `<button type="button">+ Add to the trip: ${esc(title(t))}</button>`;
        const b = box.querySelector("button");
        if (b) b.addEventListener("click", () => {
          const x = H.routeItem(); if (!x) return;
          E.addLine(t, routeLine(t, x)); drawingFor = null;
          toast(`Added to ${title(t)} as day ${E.linesOf(t).length}.`); window.tfHappy && window.tfHappy("moto trip");
          if (!cur() || cur().id !== t.id) E.start(t); else E.scrollTo();
        });
        after.after(box);
      } else E.offerAdd(after, () => { const x = H.routeItem(); return x && routeLine(null, x); });
      return;
    }
    if (kind === "adv") {
      const pl = el.querySelector('[data-t="plan"]'), after = (pl && pl.closest(".mt-row")) || el.lastElementChild;
      E.offerAdd(after, () => H.advItem(item));
      if (!E.trips().length) {
        const box = document.createElement("div");
        box.className = "tp-place-go";
        box.innerHTML = `<button type="button" class="sk-tripgo">Start a moto trip with this route</button>`;
        box.querySelector("button").addEventListener("click", () => {
          const x = H.advItem(item); if (!x) return;
          const t = E.newTrip(); t.name = item.n; t.nights = Math.max(1, Math.min(10, Math.round((item.km || 300) / 300)));
          E.start(t); E.addLine(t, x);
        });
        after.after(box);
      }
      return;
    }
    if (kind === "pin" && (item.k === "camp" || item.k === "rec")) {
      const t = cur() && !E.card.hidden ? cur() : null;
      if (!t || (H.sleepable && !H.sleepable(item.p))) return;   // no Sleep here on a hut or a walk-in site
      const pl = placeFromPin(item), free = nightStops(t).findIndex((c) => !c), here = nightStops(t).findIndex((c) => c && c.id === pl.id);
      const box = document.createElement("div");
      box.className = "tp-place-go";
      if (here >= 0) box.innerHTML = `<p class="sk-note">Night ${here + 1} of ${esc(title(t))}</p>`;
      else if (free >= 0) {
        box.innerHTML = `<button type="button" class="sk-tripgo">Sleep here: night ${free + 1} of ${esc(title(t))}</button>`;
        box.querySelector("button").addEventListener("click", () => { setStop(t, free, pl); toast(`${pl.name}: night ${free + 1}.`); E.scrollTo(); });
      } else return;
      const row = el.querySelector(".mt-row");
      if (row) row.after(box); else el.append(box);
    }
  });
  // A planned route as a trip line: its own id, so two routes with the same name both stay.
  const routeLine = (t, x) => ({ ...x, name: x.name, label: x.time ? `${Math.round(x.time / 360) / 10} h riding (estimate)` : "" });

  // ---------- the trips list: campsites near the middle of the map ----------
  function nearList() {
    const c = map.getCenter(), el = E.part("tpNear");
    if (!el) return;
    const near = H.campsNear([c.lat, c.lng], 40, 6);
    el.innerHTML = near.length ? near.map(({ p, d }) => `<li><button type="button" data-mtnear="${p[0]},${p[1]}"><span>${esc(H.realName(p[2]) || (p.rec ? "BC rec site" : "Campsite"))} <small>${esc(p.rec ? "BC rec site" : "campsite")}</small></span><small>${d < 9.5 ? d.toFixed(1) : Math.round(d)} km</small></button></li>`).join("")
      : `<li class="sk-note">No campsites loaded near here: zoom the map in on where you're going.</li>`;
  }
  E.card.addEventListener("click", (e) => {
    const a = e.target.closest("[data-mtnear]"); if (!a) return;
    const [la, lo] = a.dataset.mtnear.split(",").map(Number);
    const hit = H.campsNear([la, lo], 0.05, 1)[0];
    if (!hit) return;
    const pl = placeFromPin({ k: hit.p.rec ? "rec" : "camp", p: hit.p });
    const t = E.newTrip(); t.stops = Object.fromEntries(Array.from({ length: t.nights }, (_, i) => [i, pl])); t.name = pl.name;
    E.start(t);
    toast(`${pl.name} for every night: change any night under Where you sleep.`);
  });

  // ---------- Ask (ask.js): "3-day dirt trip from Kamloops" ----------
  // A new trip starting at the place asked about, on the day and for the nights asked; or the open trip, if it has
  // nothing in it yet.
  function startNear(o) {
    const nights = Math.max(1, Math.min(10, Math.round(o.nights || 2)));
    let t = cur();
    if (!t || E.linesOf(t).length || t.start) t = E.newTrip();
    t.nights = nights;
    if (o.date) t.date = o.date;
    if (o.ll) t.start = { name: String(o.name || "Start").slice(0, 60), lat: r5(o.ll[0]), lon: r5(o.ll[1]) };
    if (!t.name && o.name) t.name = `${o.name}, ${nights + 1} days`;
    E.start(t);
    if (o.ll) map.setView(o.ll, Math.max(map.getZoom(), 9));
    return t;
  }
  window.tfMotoTrip = { ...api, startNear };
})();
