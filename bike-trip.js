// Plan a bike trip (MTB): bikepacking and base camp trips (alex 2026-11-17: "planing a bike packing camping (not just a
// normal ride)", then picked "Bikepacking + base camp"). Built on trip-core.js, which has every part a trip shares
// (the group, packing with Who brings?, meals, booking, costs, journal, sharing by link, the plan you tell someone,
// offline); this file is MTB's kit:
//  - How you camp: Bikepacking (camp carried on the bike, a new camp each night) or Base camp (one camp, rides from it
//    each day). The packing list and each day follow it.
//  - Where you sleep: each night's campsite, hut or shelter, from the places the weekly job maps for Hiking
//    (data/hike-places-<zone>.json, OpenStreetMap), or OpenStreetMap itself (Overpass) outside the home zones. They
//    show on the map as brown dots while the trip is open: tap one to sleep there.
//  - Your rides for this trip: trails added from their card (Add to bike trip), routes from Plan a route, and which
//    day each one is ridden.
//  - Each day: the weather (Open-Meteo, the middle of three models, wxcheck.js) and the Loam moisture index estimate at
//    1 pm (the same index as a trail's card, index.html window.tfLoam), at that night's camp, kept for no signal.
//  - Closures and warnings near the trip (closures.js, from the land managers), water taps along the rides (as mapped).
//  - Cars and shuttle: who drives, seats and bike spots against the group, where the cars wait at the start and the end.
// Trips are kept in tf:bikeTrips, on the account when signed in (account.js). Share links end in .bike.
// Wording: facts and their source, "estimate" where it is one; nothing here says a trail, a camp or the dirt is safe,
// open or rideable.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L || !window.tfTripEngine || (window.tfTrips && window.tfTrips.bike)) return;
  const isMtb = () => !document.body.classList.contains("sport-alt");
  const COL = "#c2410c";    // the bike trip's colour (burnt orange)
  const LCOL = "#7c3aed";   // its rides on the map: a colour the trail levels don't use
  const CAMP = "#b5651d";   // campsites and huts (the same brown as Hiking's)
  const kmTo = (a, b) => Math.hypot((a[1] - b[1]) * 111.32 * Math.cos((a[0] * Math.PI) / 180), (a[0] - b[0]) * 110.57);
  const css = document.createElement("style");
  css.textContent = `#bkTrip { --tp: ${COL}; margin: 8px 10px; border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm, 0 1px 3px rgba(0,0,0,.12)); }
.panel:has(#bkTrip:not([hidden])):not(.detail-open) :is(#boxRes, #status, #list, #debug) { display: none !important; }
.panel.detail-open #bkTrip { display: none; }
#bkTrip h3 { margin: 0; font-size: .95rem; font-weight: 800; }
#bkTrip .sk-x { float: right; font: inherit; border: 0; background: var(--chip); color: var(--muted); cursor: pointer; width: 28px; height: 28px; border-radius: 50%; }
#bkTrip .sk-sec { border-top: 1px solid var(--line); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; font-size: .85rem; }
#bkTrip .sk-sec h4 { margin: 0; font-size: .92rem; }
#bkTrip .sk-sec h5 { margin: 4px 0 0; font-size: .85rem; }
#bkTrip .sk-sec p { margin: 0; }
:is(#bkTrip, #results .tp-addto, .plan-bar .tp-addto) .sk-note { color: var(--muted); font-size: .78rem; font-weight: 400; margin: 0; }
#bkTrip .tp-style { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#bkTrip .tp-style button { font: inherit; font-size: .82rem; font-weight: 700; padding: 8px 4px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
#bkTrip .tp-style button[aria-pressed="true"] { background: ${COL}; border-color: ${COL}; color: #fff; }
#bkTrip .tp-night { display: grid; grid-template-columns: 1fr; gap: 3px; margin: 4px 0 6px; font-size: .84rem; }
#bkTrip .tp-night select, #bkTrip .bk-day select { width: 100%; }
#bkTrip .tp-warn { border-left: 4px solid #e8590c; padding: 4px 0 4px 9px; font-size: .82rem; }
#bkTrip .tp-warn.bad { border-color: #c92a2a; }
#bkTrip .tp-warn small { display: block; color: var(--muted); }
#bkTrip .tp-warn a { color: #1f5fe0; }
#bkTrip .bk-loam { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; }
#bkTrip .bk-loam i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
#bkTrip .bk-day { display: grid; grid-template-columns: 1fr 130px; gap: 6px; align-items: center; font-size: .84rem; margin: 2px 0; }
#bkTrip .bk-car { display: grid; grid-template-columns: 1fr 64px 64px 34px; gap: 6px; align-items: end; margin: 4px 0; }
#bkTrip .bk-car label { display: flex; flex-direction: column; gap: 2px; font-size: .68rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); min-width: 0; }
#bkTrip .bk-car input, #bkTrip .bk-car select { font: inherit; font-size: 16px; padding: 7px 6px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); min-width: 0; width: 100%; box-sizing: border-box; }
#bkTrip .bk-car > button { font: inherit; border: 0; background: none; color: var(--muted); height: 36px; cursor: pointer; }
#bkTrip .bk-tally { font-weight: 700; }
#bkTrip .bk-tally.short { color: #c92a2a; }
.plan-bar .plan-trip:empty { display: none; }
.plan-bar .plan-trip { --tp: ${COL}; padding: 0 2px 4px; }
#bkTripBtn[aria-pressed="true"] { background: ${COL}; border-color: ${COL}; color: #fff; }
body.sport-alt #bkTripBtn { display: none; }`;
  document.head.append(css);

  let E = null, $, esc, toast, when, dayWord;   // the engine (trip-core.js) and its helpers
  const cur = () => E.cur();
  const title = (t) => t.name || (t.hut && t.hut.name) || "My bike trip";
  const campsOf = (t) => t.camps || {};
  const campOn = (t, i) => campsOf(t)[i] || null;   // night i's camp (0 = the first night)
  const nightCamps = (t) => Array.from({ length: t.nights }, (_, i) => campOn(t, i));
  const uniq = (l) => { const seen = new Set(); return l.filter((c) => c && !seen.has(c.id) && seen.add(c.id)); };
  const STYLES = [["pack", "Bikepacking"], ["base", "Base camp"]];
  const styleOf = (t) => t.style || "pack";
  const linePts = (t) => E.linesOf(t).flatMap((x) => x.ls.flat());
  const centre = (t) => {   // where the trip is: its first camp, its place, or the middle of its rides
    const c = nightCamps(t).find(Boolean) || t.hut;
    if (c) return [c.lat, c.lon];
    const pts = linePts(t);
    if (!pts.length) return null;
    const b = L.latLngBounds(pts).getCenter();
    return [b.lat, b.lng];
  };
  const KIND = { camp: "Campsite", hut: "Hut or shelter", water: "Drinking water", th: "Trailhead", park: "Parking" };

  // ---------- places: campsites, huts, shelters and water (OpenStreetMap) ----------
  // The weekly job's data/hike-places-<zone>.json for the home zones (window.tfZones), and Overpass for a square
  // elsewhere (kept for the session). Each place: { id, k, ll, n, x (its tags) }.
  const places = new Map(), zonesAsked = new Set(), sqAsked = new Set();
  const absorb = (list) => (list || []).forEach((p) => { if (KIND[p[1]] && !places.has(p[0])) places.set(p[0], { id: p[0], k: p[1], ll: [p[2], p[3]], n: p[4], x: p[5] || {} }); });
  const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
  const kindOf = (g) => (g.tourism === "camp_site" ? "camp" : /^(alpine_hut|wilderness_hut)$/.test(g.tourism || "") || g.amenity === "shelter" ? "hut" : g.amenity === "drinking_water" ? "water" : null);
  async function loadPlaces(c) {
    if (!c) return;
    const box = [c[0] - 0.25, c[1] - 0.35, c[0] + 0.25, c[1] + 0.35], jobs = [];
    let home = false;
    for (const z of window.tfZones || []) {
      if (!(z.box[0] < box[2] && z.box[2] > box[0] && z.box[1] < box[3] && z.box[3] > box[1])) continue;
      if (z.box[0] <= c[0] && c[0] <= z.box[2] && z.box[1] <= c[1] && c[1] <= z.box[3]) home = true;
      if (zonesAsked.has(z.id)) continue;
      zonesAsked.add(z.id);
      jobs.push(fetch(`data/hike-places-${z.id}.json`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.v === 1) absorb(j.p); }).catch(() => zonesAsked.delete(z.id)));
    }
    const sq = `${Math.round(c[0] * 4)},${Math.round(c[1] * 4)}`;
    if (!home && !sqAsked.has(sq)) {
      sqAsked.add(sq);
      const bb = box.map((v) => v.toFixed(3)).join(",");
      const q = `[out:json][timeout:40];(nwr["tourism"~"^(camp_site|alpine_hut|wilderness_hut)$"](${bb});nwr["amenity"="shelter"]["shelter_type"~"^(basic_hut|lean_to|weather_shelter)$"](${bb});node["amenity"="drinking_water"](${bb}););out center tags qt;`;
      jobs.push((async () => {
        for (const url of OVERPASS) {
          try {
            const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
            if (!r.ok) continue;
            const j = await r.json();
            absorb((j.elements || []).map((e) => { const g = e.tags || {}, k = kindOf(g), ll = e.center || e; return k && ll.lat != null ? [e.type[0] + e.id, k, ll.lat, ll.lon, g.name || "", g] : null; }).filter(Boolean));
            return;
          } catch {}
        }
        sqAsked.delete(sq);
      })());
    }
    await Promise.all(jobs);
  }
  const placesNear = (c, km, kinds) => [...places.values()].filter((p) => kinds.includes(p.k)).map((p) => ({ p, d: kmTo(c, p.ll) })).filter((x) => x.d <= km).sort((a, b) => a.d - b.d);
  const placeOf = (p) => ({ id: p.id, name: p.n || KIND[p.k], kind: p.k, lat: p.ll[0], lon: p.ll[1], tags: { ...(p.x || {}) } });
  const facts = (g) => [g.fee === "yes" || g.charge ? `fee${g.charge ? ": " + g.charge : ""}` : g.fee === "no" ? "no fee (as mapped)" : "", g.reservation === "required" ? "booking needed (as mapped)" : "",
    g.drinking_water === "yes" ? "water (as mapped)" : "", g.toilets === "yes" ? "toilets" : "", g.operator || ""].filter(Boolean);

  const api = window.tfTripEngine((e) => { E = e; ({ $, esc, toast, when, dayWord } = e); return kit(); });
  if (!api) return;

  function kit() {
    return {
      id: "bike", key: "bikeTrips", packKey: "bikePack", color: COL, lineColor: LCOL, pane: "newTrails", cardId: "bkTrip",
      shared: ["style", "camps", "dayOf", "cars", "carAt", "carEnd"],
      w: {
        icon: "🏕", trip: "bike trip", Trips: "Bike trips", btn: "🏕 Bike trips", btnTitle: "Plan a bikepacking or base camp trip: where you sleep each night, your rides, the weather and loam estimate each day, offline",
        addTo: "🏕 Add to bike trip", line: "Ride", lines: "Your rides for this trip", goIn: "First day", first: "first day", last: "last day", prod: "Bike trip",
        overdue: "a bikepacking trip", journal: "How the trails and the dirt were, where you camped, what to bring next time.", finding: "Finding campsites…",
        updates: "the trip's weather and loam estimate", offPrefix: "Bike trip: ",
        offWhat: "the map, trails and forest roads in the square you pick (it starts around your camps and rides)",
        offSaved: "the map, trails and forest roads", offFresh: "the trip's files", offOut: "a ride or a camp added since",
      },
      groupGear: new Set(["sat", "aid", "pump", "tools", "spares", "stove", "pot", "filter", "food", "tent", "trash", "booking", "fee", "cooler", "chairs", "trowel", "stand", "wash", "racks"]),
      isOn: isMtb,
      mount(card, btn) {
        const res = $("results");
        if (!res) return false;
        res.prepend(card);
        btn.id = "bkTripBtn";
        const plan = $("planBtn"), tools = $("offlineBtn") && $("offlineBtn").parentElement;
        if (plan) plan.after(btn); else if (tools) tools.prepend(btn);
      },
      title,
      namePh: () => "Like: Sunshine Coast, 3 nights",
      newTrip: () => ({ sport: "bike", camps: {} }),
      start(t) {
        if (!t.sport) t.sport = "bike";
        if (window.tfNavTrip) window.tfNavTrip(true);
        E.loadDays(t);
        loadWarn(t);
        const c = centre(t) || [map.getCenter().lat, map.getCenter().lng];
        loadPlaces(c).then(() => { if (cur() !== t) return; refreshCamps(t); drawNear(t); });
        drawNear(t);
      },
      close() { near.clearLayers(); if (window.tfNavTrip) window.tfNavTrip(false); },
      hasDays: (t) => !!centre(t),
      keyOf: (t) => JSON.stringify([t.camps || null, t.style || "", t.hut ? t.hut.id : ""]),
      snapOf, daysHtml, packItems, planText,
      bookTop(t) {
        const l = uniq(nightCamps(t));
        const need = l.some((c) => c.tags.reservation === "required");
        const rows = l.map((c) => { const g = c.tags || {}, site = g["reservation:website"] || g.website || "";
          return `<p class="sk-note"><b>${esc(c.name)}</b>: ${g.reservation === "required" ? "must be booked ahead (as mapped)" : g.reservation === "no" ? "first come, first served (as mapped)" : g.reservation ? "can be booked (as mapped)" : "no booking info on the map"}${g.charge ? `, ${esc(g.charge)}` : ""}${site ? ` · <a href="${esc(site)}" target="_blank" rel="noopener">${g["reservation:website"] ? "Book" : "Website"}</a>` : ""}</p>`; }).join("");
        return { tag: need ? "needs booking" : "",
          html: `${rows || `<p class="sk-note">Pick where you sleep (above) to see what's known about booking there.</p>`}<p class="sk-note">Campsites in busy parks often need booking months ahead: check the park's or the campsite's own page.</p>` };
      },
      bookSite: (t) => { const c = uniq(nightCamps(t)).find((x) => x.tags["reservation:website"] || x.tags.website); return c ? c.tags["reservation:website"] || c.tags.website : ""; },
      bookWhat: (t) => { const l = uniq(nightCamps(t)); return `Book ${l.length ? l.map((c) => c.name).join(", ") : "where you sleep"} for ${t.people} people.`; },
      costHint: () => "Add the camp fees, gas for the shuttle, food, parts and anything else the group shares.",
      baseHtml,
      midHtml: (t) => `<div class="sk-sec" id="tpCamps"><h4>Where you sleep</h4>${campsHtml(t)}</div>
      ${centre(t) ? `<div class="sk-sec" id="tpDays"><h4>Each day</h4>${E.daysHtml()}</div>
      <div class="sk-sec" id="tpPark"><h4>Closures and warnings</h4>${warnHtml(t)}</div>` : ""}`,
      afterLinesHtml: (t) => `${E.linesOf(t).length > 0 && t.nights > 0 ? `<div class="sk-sec" id="bkDays"><h4>Which day you ride each one</h4>${dayPickHtml(t)}</div>` : ""}
      ${E.linesOf(t).length ? `<div class="sk-sec" id="tpWater"><h4>Water along your rides</h4>${waterHtml(t)}</div>` : ""}
      <div class="sk-sec" id="bkCars"><h4>Cars and shuttle</h4>${carsHtml(t)}</div>`,
      baseBtn: () => "",
      linesEmpty: () => `No rides yet. Tap a trail on the map and then <b>🏕 Add to bike trip</b> on its card, or plan a route (✏️ Plan a ride) and add it from Plan a route.`,
      drawLabel: () => "Plan a ride",
      linesChanged: (t) => { E.render(); refreshWarnSoon(t); },
      openLine, drawExtra, extraPts,
      gpxExtra: (t, trk, wpt) => uniq(nightCamps(t)).filter((c) => !t.hut || c.id !== t.hut.id).map((c) => wpt(c.lat, c.lon, c.name)).join(""),
      offBase: (t) => (t.hut && t.hut.name) || t.name || t.id,
      onTp, nearList, datesChanged: (t) => E.render(),
      listNote: () => `Or start from a campsite near the middle of the map (zoom in on where you're going):`,
    };
  }

  // ---------- how you camp ----------
  function baseHtml(t) {
    const st = styleOf(t);
    return `<div class="tp-style" role="group" aria-label="How you camp">${STYLES.map(([k, l]) => `<button type="button" data-style="${k}" aria-pressed="${st === k}">${l}</button>`).join("")}</div>
      <p class="sk-note">${st === "pack" ? "Your camp goes on the bike: a new camp each night, a ride between each." : "One camp for the whole trip, with rides from it each day."}</p>`;
  }
  E.card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-style]"), t = cur();
    if (!b || !t) return;
    t.style = b.dataset.style;
    // A base camp: the first night's camp for every night.
    if (t.style === "base" && campOn(t, 0)) t.camps = Object.fromEntries(Array.from({ length: t.nights }, (_, i) => [i, campOn(t, 0)]));
    t.snap = null; E.setView(null);
    E.putTrip(t); E.render(); E.drawMap(); E.loadDays(t);
  });

  // ---------- where you sleep, each night ----------
  const nearSleeps = (t) => { const c = centre(t) || [map.getCenter().lat, map.getCenter().lng]; const seen = new Set(); return placesNear(c, 40, ["camp", "hut"]).filter((x) => x.p.n && !seen.has(x.p.n.toLowerCase()) && seen.add(x.p.n.toLowerCase())).slice(0, 16).map((x) => x.p); };
  function campsHtml(t) {
    const near = nearSleeps(t), dates = E.tripDates(t), base = styleOf(t) === "base";
    const rows = Array.from({ length: base ? Math.min(1, t.nights) : t.nights }, (_, i) => {
      const c = campOn(t, i), opts = uniq([c, ...near.map(placeOf)]);
      return `<label class="tp-night"><b>${base ? "Base camp, every night" : `Night ${i + 1} · ${esc(dayWord(dates[i]))}`}</b><select data-camp="${i}" aria-label="Where you sleep ${base ? "" : `night ${i + 1}`}"><option value="">${c ? "Not picked" : "Pick where you sleep"}</option>${!base && i > 0 && campOn(t, i - 1) && !(c && c.id === campOn(t, i - 1).id) ? `<option value="=prev">Same as night ${i}: ${esc(campOn(t, i - 1).name)}</option>` : ""}${opts.map((p) => `<option value="${esc(p.id)}" ${c && c.id === p.id ? "selected" : ""}>${esc(p.name)} (${esc((KIND[p.kind] || "camp").toLowerCase())})</option>`).join("")}</select></label>`;
    }).join("");
    const picked = uniq(nightCamps(t)).map((c) => { const f = facts(c.tags || {}); return f.length ? `<p class="sk-note"><b>${esc(c.name)}</b>: ${esc(f.join(" · "))}</p>` : ""; }).join("");
    const none = !near.length && !nightCamps(t).some(Boolean);
    return `${rows}${picked}<p class="sk-note">${none ? "No campsites loaded near here yet: move the map to where you're going, or " : "Or "}tap a brown dot on the map to sleep there. Campsites and huts come from OpenStreetMap, as mapped: check with whoever runs them (fees, booking, bikes allowed) before you go.</p>`;
  }
  function setCamp(t, i, p) {
    t.camps = { ...campsOf(t) };
    if (styleOf(t) === "base") t.camps = p ? Object.fromEntries(Array.from({ length: t.nights }, (_, k) => [k, p])) : {};
    else if (p) t.camps[i] = p; else delete t.camps[i];
    if (p && !t.hut) t.hut = p;   // the first camp picked names the trip and centres it
    if (!p && t.hut && !nightCamps(t).some((c) => c && c.id === t.hut.id)) t.hut = nightCamps(t).find(Boolean) || null;
    t.snap = null;
    E.putTrip(t);
    if (cur() === t) { E.setView(null); E.render(); E.drawMap(); E.loadDays(t); drawNear(t); refreshWarnSoon(t); }
  }
  E.card.addEventListener("change", (e) => {
    const el = e.target, t = cur();
    if (!el.dataset.camp || !t) return;
    const i = +el.dataset.camp, v = el.value;
    if (v === "=prev") { setCamp(t, i, campOn(t, i - 1)); return; }
    const c = campOn(t, i), p = v ? (c && c.id === v ? c : places.get(v)) : null;
    setCamp(t, i, p ? (p.ll ? placeOf(p) : p) : null);
  });
  const refreshCamps = (t) => { const el = E.part("tpCamps"); if (el && !el.contains(document.activeElement)) el.innerHTML = `<h4>Where you sleep</h4>${campsHtml(t)}`; };

  // ---------- the map ----------
  // The trip's camps (numbered) and, while the card is open, the other campsites near it as small brown dots to tap.
  const near = L.layerGroup();
  const numIcon = (n) => L.divIcon({ className: "", html: `<span style="display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:${CAMP};color:#fff;font:800 11px/1 system-ui;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)">${n}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
  function drawExtra(t, layer) {
    const seen = new Map();
    nightCamps(t).forEach((c, i) => { if (c) seen.set(c.id, [...(seen.get(c.id) || []), i + 1]); });
    for (const [id, n] of seen) { const c = nightCamps(t).find((x) => x && x.id === id); L.marker([c.lat, c.lon], { pane: "newTrails", interactive: false, keyboard: false, icon: numIcon(n.length > 2 ? `${n[0]}-${n.at(-1)}` : n.join(",")) }).addTo(layer); }
  }
  function drawNear(t) {
    near.clearLayers();
    if (!t || cur() !== t || !isMtb()) { map.removeLayer(near); return; }
    const mine = new Set(nightCamps(t).filter(Boolean).map((c) => c.id));
    nearSleeps(t).filter((p) => !mine.has(p.id)).forEach((p) => {
      const m = L.circleMarker(p.ll, { radius: 7, color: "#fff", weight: 2, fillColor: CAMP, fillOpacity: 0.95 });
      m.bindTooltip(`${esc(p.n)} (${esc(KIND[p.k].toLowerCase())})`, { direction: "top" });
      m.on("click", (ev) => {
        L.DomEvent.stopPropagation(ev);
        const tt = cur(); if (!tt) return;
        const free = styleOf(tt) === "base" ? 0 : nightCamps(tt).findIndex((c) => !c);
        if (free < 0) { toast("Every night has a camp: change one in Where you sleep."); return; }
        setCamp(tt, free, placeOf(p));
        toast(styleOf(tt) === "base" ? `${p.n || "Campsite"}: your base camp.` : `${p.n || "Campsite"}: night ${free + 1}.`);
      });
      m.addTo(near);
    });
    if (!map.hasLayer(near)) near.addTo(map);
  }
  function extraPts(t) { return uniq(nightCamps(t)).map((c) => [c.lat, c.lon]); }

  // ---------- each day ----------
  // Day i is at night i's camp (the last day at the last camp): the weather from Open-Meteo through wxcheck.js (the
  // middle of three models), and the Loam moisture index at 1 pm from Open-Meteo's soil moisture forecast, read the
  // same way as a trail's card (window.tfLoam). Both are a model's estimate, about a week or two ahead at most.
  const WX = [[0, "Clear"], [2, "Some cloud"], [3, "Cloudy"], [48, "Fog"], [57, "Drizzle"], [67, "Rain"], [77, "Snow"], [82, "Showers"], [86, "Snow showers"], [99, "Thunderstorms"]];
  const wxWord = (c) => (c == null ? "" : (WX.find((x) => c <= x[0]) || WX.at(-1))[1]);
  const getJ = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  async function snapOf(t) {
    const dates = E.tripDates(t), c0 = centre(t), Lm = window.tfLoam;
    if (!c0) return { err: "no place yet" };
    const locOf = (j) => { const c = campOn(t, j) || campOn(t, j - 1) || t.hut; return c ? { ll: [c.lat, c.lon], name: c.name } : { ll: c0, name: "" }; };
    const locs = dates.map((d, j) => locOf(j)), kOf = (ll) => ll.map((v) => v.toFixed(3)).join(","), keys = [...new Set(locs.map((l) => kOf(l.ll)))];
    const got = {}, soil = {};
    let err = "";
    if (Lm) await Lm.ready();
    for (const k of keys) {
      const [lat, lon] = k.split(",");
      const q = new URLSearchParams({ latitude: lat, longitude: lon, daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunset", forecast_days: "16", timezone: "auto" });
      const url = `https://api.open-meteo.com/v1/forecast?${q}`;
      try { got[k] = await (window.tfWx ? window.tfWx.getChecked(url) : getJ(url)); } catch (e) { err = e.message || "no signal"; }
      const qs = new URLSearchParams({ latitude: lat, longitude: lon, hourly: "soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm,snow_depth,soil_temperature_0cm", forecast_days: "16", timezone: "auto" });
      try { soil[k] = await getJ(`https://api.open-meteo.com/v1/forecast?${qs}`); } catch {}
    }
    if (!Object.keys(got).length) return { err: err || "no signal" };
    let end = "";
    const rows = dates.map((date, j) => {
      const l = locs[j], k = kOf(l.ll), w = got[k], s = soil[k], row = { date, tag: j === 0 ? "first" : j === t.nights ? "last" : "", at: l.name };
      const dd = w && w.daily;
      if (s && s.hourly && Lm) {
        const i = s.hourly.time.indexOf(`${date}T13:00`), key = Lm.cell(l.ll[0], l.ll[1]);
        if (i >= 0) { row.lmi = Lm.at(s.hourly, i, key); const sn = Lm.snow(s.hourly, i); if (Lm.isSnowy(sn)) row.snowCm = sn; if (Lm.frost) row.frost = Lm.frost(s.hourly, i); }
      }
      if (!dd) return row;
      if (!end || dd.time.at(-1) < end) end = dd.time.at(-1);
      const i = dd.time.indexOf(date);
      if (i < 0) return row;
      return Object.assign(row, { code: dd.weather_code[i], hi: dd.temperature_2m_max[i], lo: dd.temperature_2m_min[i], rain: dd.precipitation_sum[i] || 0,
        pop: dd.precipitation_probability_max ? dd.precipitation_probability_max[i] : null, wind: dd.wind_speed_10m_max[i], gust: dd.wind_gusts_10m_max[i], sunset: dd.sunset[i] });
    });
    return { snap: { at: Date.now(), rows, end } };
  }
  const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  const deg = (v) => (v == null ? "–" : `${Math.round(v) === 0 ? 0 : Math.round(v)}°`);
  function loamHtml(r) {
    const Lm = window.tfLoam;
    if (r.snowCm != null) return `<span class="bk-loam"><i style="background:#9ec5fe"></i>Snow on the ground, about ${r.snowCm} cm</span>`;
    // Frozen ground at 1 pm (soil surface at or below 0°C, an estimate): frozen water reads as moisture, so no loam word.
    if (r.frost === 2) return `<span class="bk-loam"><i style="background:#8e7cc3"></i>Ground likely frozen (estimate)</span>`;
    if (r.lmi == null || !Lm) return "";
    const lv = Lm.level(r.lmi);
    return lv ? `<span class="bk-loam"><i style="background:${lv.ride[0]}"></i>Loam ${r.lmi}: ${esc(lv.word.toLowerCase())}${r.frost === 1 ? " · froze overnight (estimate)" : ""}</span>` : "";
  }
  const ridesOn = (t, j) => E.linesOf(t).filter((x) => (t.dayOf || {})[x.id] === j);
  function daysHtml(t, v) {
    const rows = v.rows.map((r, j) => {
      const wet = r.code != null && (r.rain >= 5 || r.code >= 95), c = r.code == null ? "var(--line)" : wet ? "#1c7ed6" : r.lmi != null && window.tfLoam && window.tfLoam.level(r.lmi) ? window.tfLoam.level(r.lmi).ride[0] : COL;
      const wx = r.code != null ? `<span class="tp-wx"><big>${deg(r.hi)}</big><br>low ${deg(r.lo)}</span>` : `<span class="tp-wx sk-note">${v.end && r.date > v.end ? "Too far<br>ahead" : "–"}</span>`;
      const bits = r.code != null ? [r.rain >= 1 ? `${Math.round(r.rain)} mm of rain` : "Little or no rain", ...(r.pop != null && r.rain >= 1 ? [`${r.pop}% chance`] : []),
        `wind ${Math.round(r.wind || 0)} km/h${r.gust >= 50 ? `, gusts ${Math.round(r.gust)}` : ""}`, ...(r.sunset ? [`sunset ${hm(r.sunset)}`] : [])] : [];
      const rides = ridesOn(t, j), km = rides.reduce((s, x) => s + x.km, 0);
      return `<li style="--c:${c}"><b>${esc(dayWord(r.date))}${r.tag ? ` · ${r.tag === "first" ? "first day" : "last day"}` : ""}</b>${wx}<span>${esc(wxWord(r.code))}${r.at ? ` <span class="sk-note">at ${esc(r.at)}</span>` : ""}</span>${bits.length || r.lmi != null || r.snowCm != null ? `<small>${loamHtml(r)}${bits.length ? `${loamHtml(r) ? " · " : ""}${bits.map(esc).join(" · ")}` : ""}</small>` : ""}${rides.length ? `<small>Ride: ${rides.map((x) => esc(x.name)).join(", ")} (${km.toFixed(1)} km)</small>` : ""}</li>`;
    }).join("");
    const far = v.rows.some((r) => r.code == null && v.end && r.date > v.end);
    return `<ul class="tp-days">${rows}</ul>
      <p class="sk-note">${v.old ? `<b>Saved forecast from ${esc(when(v.at))}</b> (no signal now). ` : v.at ? `Checked ${esc(when(v.at))}${t.autoAt && Math.abs(t.autoAt - v.at) < 60000 ? " (updated by itself)" : ""}`.replace(/\.$/, "") + ". " : ""}Weather and loam where you sleep each night, a weather model's estimate (Open-Meteo: the weather is the middle of three models; the Loam moisture index is from its soil moisture forecast at 1 pm)${far ? `, about two weeks ahead at most: come back closer to the trip` : ""}. The dirt on a trail can differ from the model's: shade, rock and drainage change it.</p>`;
  }

  // ---------- closures and warnings ----------
  // What the land managers post near the trip (closures.js: Alberta Parks, BC Parks, Parks Canada, Ontario Parks),
  // within 25 km of its camps and rides. Kept with the trip (t.warnSnap) for no signal.
  async function loadWarn(t) {
    const C = window.tfClosures, c = centre(t);
    if (!c || !C || !C.near) return;
    const pts = [c, ...uniq(nightCamps(t)).map((x) => [x.lat, x.lon])], out = [], seen = new Set();
    try {
      for (const p of pts.slice(0, 6)) for (const w of await C.near(p, 25)) if (!seen.has(w.text)) { seen.add(w.text); out.push(w); }
      t.warnSnap = { at: Date.now(), warn: out };
    } catch { t.warnSnap = { ...(t.warnSnap || {}), err: 1 }; }
    E.putTrip(t, true);
    if (cur() === t) { const el = E.part("tpPark"); if (el) el.innerHTML = `<h4>Closures and warnings</h4>${warnHtml(t)}`; }
  }
  let warnT = 0;
  const refreshWarnSoon = (t) => { clearTimeout(warnT); warnT = setTimeout(() => { if (cur() === t) loadWarn(t); }, 1500); };
  function warnHtml(t) {
    const s = t.warnSnap;
    if (!window.tfClosures) return `<p class="sk-note">Check the land manager's and the trail club's pages for closures before you go.</p>`;
    if (!s) return `<p class="tp-wait">Checking closures and warnings near the trip…</p>`;
    const w = (s.warn || []).slice(0, 10).map((x) => `<div class="tp-warn ${x.bad ? "bad" : ""}"><b>${esc(x.text)}</b><small>${[x.sub, x.src].filter(Boolean).map(esc).join(" · ")}${x.url ? ` · <a href="${esc(x.url)}" target="_blank" rel="noopener">More</a>` : ""}</small></div>`).join("");
    return `${w || `<p class="sk-note">Nothing posted near the trip in the land managers' lists we read. They post new ones often, and many trails have none: check with the land manager or trail club before you go.</p>`}
      <p class="sk-note">${s.err ? "Couldn't check right now (no signal or the server is busy). " : ""}From Alberta Parks, BC Parks, Parks Canada and Ontario Parks, checked ${esc(when(s.at || Date.now()).replace(/\.$/, ""))}. The land manager's own page is the final word on closures and fire bans.</p>`;
  }

  // ---------- which day you ride each one ----------
  function dayPickHtml(t) {
    const dates = E.tripDates(t), d = t.dayOf || {};
    return E.linesOf(t).map((x) => `<label class="bk-day"><span>${esc(x.name)} <small class="sk-note">${x.km.toFixed(1)} km</small></span><select data-rday="${esc(x.id)}" aria-label="Which day you ride ${esc(x.name)}"><option value="">Any day</option>${dates.map((dt, j) => `<option value="${j}" ${d[x.id] === j ? "selected" : ""}>Day ${j + 1} · ${esc(dayWord(dt))}</option>`).join("")}</select></label>`).join("")
      + `<p class="sk-note">Each day's rides show under Each day, with the total distance.</p>`;
  }
  E.card.addEventListener("change", (e) => {
    const el = e.target, t = cur();
    if (!el.dataset.rday || !t) return;
    t.dayOf = { ...(t.dayOf || {}) };
    if (el.value === "") delete t.dayOf[el.dataset.rday]; else t.dayOf[el.dataset.rday] = +el.value;
    E.putTrip(t); E.renderDays();
  });

  // ---------- water along your rides ----------
  function waterHtml(t) {
    const pts = linePts(t);
    if (!pts.length) return "";
    const b = L.latLngBounds(pts).pad(0.05), got = [...places.values()].filter((p) => p.k === "water" && b.contains(p.ll) && pts.some((q, i) => i % 3 === 0 && kmTo(q, p.ll) <= 0.25));
    return `${got.length ? `<ul class="tp-list">${got.slice(0, 8).map((p) => `<li><button type="button" data-bkw="${esc(p.ll.join(","))}"><span>${esc(p.n || "Drinking water")}</span><small>${esc(facts(p.x).join(" · ") || "drinking water")}</small></button></li>`).join("")}</ul>` : `<p class="sk-note">No drinking water taps mapped along your rides (lakes and streams aren't counted: treat that water).</p>`}
      <p class="sk-note">As mapped on OpenStreetMap: a tap may be dry or off for the season. Carry a filter or tablets.</p>`;
  }
  E.card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-bkw]");
    if (!b) return;
    map.setView(b.dataset.bkw.split(",").map(Number), Math.max(map.getZoom(), 15));
    if (window.tfSnapTo) window.tfSnapTo("peek");
  });

  // ---------- cars and shuttle ----------
  // The group's cars: who drives, seats and bike spots, against the people going. For a bikepacking trip that ends
  // somewhere else, where a car waits at the end (or who picks you up).
  function carsHtml(t) {
    const cars = t.cars || [], seats = cars.reduce((s, c) => s + (+c.seats || 0), 0), bikes = cars.reduce((s, c) => s + (+c.bikes || 0), 0);
    const who = (t.group || []).map((g) => g.n), pack = styleOf(t) === "pack";
    const sel = (c) => `<select data-car="${esc(c.id)}" data-f="who" aria-label="Driver"><option value="">Driver?</option>${[...who, ...(c.who && !who.includes(c.who) ? [c.who] : [])].map((n) => `<option ${n === c.who ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`;
    const row = (c) => `<div class="bk-car"><label>Driver${sel(c)}</label><label>Seats<input type="number" inputmode="numeric" min="0" max="15" data-car="${esc(c.id)}" data-f="seats" value="${esc(c.seats || "")}"></label><label>Bikes<input type="number" inputmode="numeric" min="0" max="12" data-car="${esc(c.id)}" data-f="bikes" value="${esc(c.bikes || "")}"></label><button type="button" data-carrm="${esc(c.id)}" aria-label="Take this car off">✕</button></div>`;
    const tally = cars.length ? `<p class="bk-tally ${seats < t.people || bikes < t.people ? "short" : ""}">${seats} seat${seats === 1 ? "" : "s"} and ${bikes} bike spot${bikes === 1 ? "" : "s"} for ${t.people} ${t.people > 1 ? "people" : "person"}${seats < t.people ? `: ${t.people - seats} more seat${t.people - seats > 1 ? "s" : ""} needed` : ""}${bikes < t.people ? `${seats < t.people ? ", " : ": "}${t.people - bikes} more bike spot${t.people - bikes > 1 ? "s" : ""} needed` : ""}.</p>` : "";
    return `${cars.map(row).join("")}${tally}
      <div class="tp-btns"><button type="button" data-tp="caradd">＋ Add a car</button></div>
      <div class="tp-plan-form">
        <label class="wide">Cars park at the start<input type="text" maxlength="80" data-set="carAt" value="${esc(t.carAt || "")}" placeholder="Like: Cheakamus Lake trailhead" autocomplete="off"></label>
        ${pack ? `<label class="wide">At the end (a car waiting, or who picks you up)<input type="text" maxlength="80" data-set="carEnd" value="${esc(t.carEnd || "")}" placeholder="Like: Sam's car at Pemberton" autocomplete="off"></label>` : ""}
      </div>
      <p class="sk-note">${pack ? "A trip that ends somewhere else needs a car there first, or a pick-up: plan the drive before day 1." : "Who drives, and how many bikes each car carries."} ${who.length ? "" : "Add names in Your group to pick the drivers."}</p>`;
  }
  const renderCars = (t) => { const el = E.part("bkCars"); if (el) el.innerHTML = `<h4>Cars and shuttle</h4>${carsHtml(t)}`; };
  E.card.addEventListener("change", (e) => {
    const el = e.target, t = cur();
    if (!el.dataset.car || !t) return;
    t.cars = (t.cars || []).map((c) => (c.id !== el.dataset.car ? c : { ...c, [el.dataset.f]: el.dataset.f === "who" ? el.value : Math.max(0, Math.min(15, +el.value || 0)) }));
    E.putTrip(t); renderCars(t);
  });
  E.card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-carrm]"), t = cur();
    if (!b || !t) return;
    t.cars = (t.cars || []).filter((c) => c.id !== b.dataset.carrm);
    E.putTrip(t); renderCars(t);
  });

  // ---------- packing list ----------
  // Built from the trip: bikepacking or base camp, nights and people, the coldest night and the rain in the forecast,
  // and the camps' facts (booking, fee, toilets).
  function packItems(t, view) {
    const n = t.nights, p = t.people, pack = styleOf(t) === "pack", tags = uniq(nightCamps(t)).map((c) => c.tags || {});
    const rows = view && view.rows ? view.rows.filter((r) => r.code != null) : [];
    const cold = rows.length ? Math.min(...rows.map((r) => r.lo)) : null, wet = rows.some((r) => r.rain >= 2), muddy = view && view.rows ? view.rows.some((r) => r.lmi != null && r.lmi >= 60) : false;
    const fuel = Math.max(1, Math.ceil((p * n * 30) / 110)) * 110;   // grams: about 30 g of canister fuel a person a day, in 110 g canisters
    const bag = cold == null ? "Sleeping bag" : `Sleeping bag rated to ${Math.min(5, Math.round(cold) - 5)}°C or warmer`;
    const tents = Math.ceil(p / 2);
    return [
      ["Essentials", [
        ["nav", "Map or GPS with the rides loaded (this trip saved offline)"], ["lamp", "Lights: a headlamp and a bike light"],
        ["sat", "Satellite messenger or PLB (inReach, Zoleo): many trails have no cell signal"], ["aid", "First aid kit"],
        ["bear", `Bear spray${p > 1 ? " each" : ""}, where you can reach it on the bike`], ["power", "Phone charged + power bank"], ["sun", "Sunglasses and sunscreen"]]],
      ["Bike", [
        ["tune", "Bike checked before the trip: brakes, tires, chain, bolts"], ["helmet", "Helmet"], ["shoes", "Riding shoes and gloves"],
        ["pump", "Pump and a shock pump"], ["tools", "Multi-tool with a chain breaker, quick links"],
        ["spares", `Spares: tube, tire plugs, derailleur hanger for each bike, brake pads${n >= 2 ? ", a spoke or two" : ""}`],
        ["lube", `Chain lube${muddy || wet ? " (wet lube: damp or wet days in the forecast)" : ""} and a rag`], ["lock", "Bike lock for camp"],
        ...(pack ? [["bags", "Bikepacking bags: frame, seat and handlebar bags, packed and test-ridden"], ["straps", "Spare straps and zip ties"]] : [["pads", "Knee pads"], ["stand", "Bike stand or a spot to work on bikes"], ["wash", "Water and a brush to wash the bikes"]])]],
      ["Sleeping", [
        ["tent", pack ? `Light tent or bivy${tents > 1 ? ` (about ${tents} for ${p})` : ""}` : `Tent${tents > 1 ? `s for ${p} (about ${tents})` : ""}, poles and pegs`],
        ["bag", bag], ["pad", "Sleeping pad"], ...(pack ? [] : [["pillow", "Pillow"]])]],
      ["Cooking and water", [
        ["stove", `Stove and about ${fuel} g of fuel`], ["pot", "Pot, lighter × 2, mug, spoon"],
        ["filter", "Water filter or tablets: treat water from lakes and streams"], ["bottle", `Bottles or a hydration pack: 2 to 3 L${p > 1 ? " each" : ""}`],
        ["food", "Food storage away from bears: a canister, a bag to hang, or the camp's food locker"]]],
      ["Food", [
        ["meals", `${n} breakfast${n > 1 ? "s" : ""}, ${n + 1} lunches and ${n} dinner${n > 1 ? "s" : ""}${p > 1 ? ` for ${p}` : ""}`],
        ["snacks", `Ride snacks for ${n + 1} days`], ["spare", "One spare day of food"]]],
      ["Clothes", [
        ["rain", wet ? "Rain jacket: rain in the forecast" : "Rain jacket"], ["warm", cold != null && cold < 5 ? `Warm layer, toque and gloves for camp: down to ${Math.round(cold)}°C` : "Warm layer for camp"],
        ["chamois", `Riding shorts (${Math.min(n + 1, 2)}) and chamois cream`], ["camp", "Dry camp clothes and camp shoes"]]],
      ["Camp", [
        ...(tags.some((g) => g.reservation === "required" || g.reservation === "yes") ? [["booking", "Booking confirmation"]] : []),
        ...(tags.some((g) => g.fee === "yes" || g.charge) ? [["fee", "Camp fees"]] : []),
        ...(pack ? [] : [["cooler", "Cooler and ice"], ["chairs", "Camp chairs"]]),
        ...(!tags.length || tags.some((g) => g.toilets === "no" || !g.toilets) ? [["trowel", "Trowel and toilet paper: not every camp has an outhouse"]] : []),
        ["fires", "Campfire rules: check the park or the wildfire service for fire bans"],
        ["trash", "Garbage bag: pack everything out"]]],
      ["Before you go", [["offline", "Trip saved offline (button below)"], ["plan", "Trip plan left with a friend (below)"]]],
    ];
  }

  // ---------- the plan you leave with someone ----------
  function planText(t, pl) {
    const ll = (a, b) => `${a.toFixed(5)}, ${b.toFixed(5)}`, link = (c) => `https://www.google.com/maps?q=${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
    const dates = E.tripDates(t), pack = styleOf(t) === "pack";
    const camps = nightCamps(t).map((c, i) => (c ? `${dayWord(dates[i])}: ${c.name}, ${ll(c.lat, c.lon)} ${link(c)}` : "")).filter(Boolean);
    const rides = dates.map((d, j) => { const r = ridesOn(t, j); return r.length ? `${dayWord(d)}: ${r.map((x) => x.name).join(", ")}` : ""; }).filter(Boolean);
    const free = E.linesOf(t).filter((x) => (t.dayOf || {})[x.id] == null).map((x) => x.name);
    return [`TRIP PLAN: ${title(t)} (${pack ? "bikepacking trip" : "mountain bike trip with a base camp"})`,
      `Who: ${pl.who || "me"}${t.people > 1 ? ` (${t.people} people)` : ""}`,
      ...(t.carAt ? [`Cars park at: ${t.carAt}`] : []),
      ...(pack && t.carEnd ? [`At the end: ${t.carEnd}`] : []),
      `First day: ${dayWord(t.date)}. Nights: ${t.nights}. Back at the car by ${when(pl.out)}`,
      ...(camps.length ? ["Where we sleep:", ...camps.map((x) => `- ${x}`)] : []),
      ...(rides.length ? ["Rides we plan:", ...rides.map((x) => `- ${x}`)] : []),
      ...(free.length ? [`Other rides we may do: ${free.join(", ")}`] : []),
      ...(pl.car ? [`Car: ${pl.car}`] : []),
      `Gear: first aid, bear spray, lights, bike tools and spares${(t.packed || {}).sat ? ", satellite messenger" : ""}, ${t.nights + 1} days of food + a spare day`,
      ``, `If you haven't heard from us by ${when(pl.help)}: call 911 (or the RCMP) and say we're overdue on a mountain bike trip. They call Search and Rescue. Read them this plan.`,
    ].join("\n");
  }

  // ---------- your rides ----------
  function openLine(t, x) {
    if (x.rid && window.tfOpenWay && /^\d+$/.test(x.rid)) { window.tfOpenWay(+x.rid, x.c ? L.latLng(x.c[0], x.c[1]) : null); return; }
    if (x.tour && window.tfPlan && window.tfPlan.openSavedId && window.tfPlan.openSavedId(x.tour)) return;
    map.fitBounds(L.latLngBounds(x.ls.flat()), { padding: [30, 30], maxZoom: 15 });
    if (window.tfSnapTo) window.tfSnapTo("peek");
  }
  let drawingFor = null;   // ✏️ Plan a ride from the trip: the route's "Add to the trip" goes straight into this trip
  function onTp(k, t) {
    if (k === "drawline") {
      if (!window.tfPlan) { toast("Plan a route isn't loaded yet: try again in a moment."); return; }
      drawingFor = t.id;
      const c = nightCamps(t).find(Boolean) || t.hut;
      if (c) map.setView([c.lat, c.lon], Math.max(map.getZoom(), 13));
      window.tfPlan.open();
      toast(`Plan the ride, then tap "Add to the trip" in Plan a route.`);
    } else if (k === "caradd") {
      t.cars = [...(t.cars || []), { id: E.uid("v"), who: "", seats: 4, bikes: 2 }];
      E.putTrip(t); renderCars(t);
    }
  }

  // ---------- "Add to bike trip" on a trail's card and in Plan a route ----------
  window.addEventListener("tf:mtb-card", (e) => {
    const { el, after, item } = e.detail || {};
    if (!el || !item || !isMtb()) return;
    el.querySelectorAll(".tp-addto").forEach((x) => x.remove());
    E.offerAdd(after || el.firstElementChild, () => item);
  });
  window.addEventListener("tf:plan-drawn", (e) => {
    const { el, has } = e.detail || {};
    if (!el) return;
    el.innerHTML = "";
    if (!has || !isMtb()) return;
    const t = drawingFor && E.tripById(drawingFor);
    if (t) {   // planned for a trip: one tap puts it in that trip
      el.innerHTML = `<div class="tp-addto"><button type="button">🏕 Add to the trip: ${esc(title(t))}</button></div>`;
      el.querySelector("button").addEventListener("click", () => {
        const x = window.tfPlan.item(); if (!x) return;
        E.addLine(t, x); drawingFor = null; el.innerHTML = "";
        toast(`Added to your trip to ${title(t)}.`); window.tfHappy && window.tfHappy("bike trip");
        window.tfPlan.close();
        E.start(t);
      });
      return;
    }
    el.innerHTML = "";
    if (!E.trips().length) return;
    const anchor = document.createElement("div"); el.append(anchor);
    E.offerAdd(anchor, () => window.tfPlan.item());
    anchor.remove();
  });

  // ---------- the trips list: campsites near the middle of the map ----------
  function nearList() {
    const c = map.getCenter(), cc = [c.lat, c.lng];
    if (window.tfNavTrip) window.tfNavTrip(true);
    const draw = () => {
      const el = E.part("tpNear");
      if (!el) return;
      const seen = new Set(), l = placesNear(cc, 40, ["camp", "hut"]).filter((x) => x.p.n && !seen.has(x.p.n.toLowerCase()) && seen.add(x.p.n.toLowerCase())).slice(0, 8);
      el.innerHTML = l.length ? l.map(({ p, d }) => `<li><button type="button" data-bkp="${esc(p.id)}"><span>${esc(p.n)} <small>${esc(KIND[p.k].toLowerCase())}</small></span><small>${d < 9.5 ? d.toFixed(1) : Math.round(d)} km</small></button></li>`).join("")
        : `<li class="sk-note">No campsites found near here: move the map to where you're going and open Bike trips again, or start a trip and add your rides first.</li>`;
    };
    draw();
    loadPlaces(cc).then(draw);
  }
  E.card.addEventListener("click", (e) => {
    const a = e.target.closest("[data-bkp]");
    if (!a) return;
    const p = places.get(a.dataset.bkp);
    if (!p) return;
    const pl = placeOf(p), old = E.trips().find((x) => x.hut && x.hut.id === pl.id);
    if (old) { E.start(old); return; }
    const t = E.newTrip();
    t.hut = pl; t.camps = { 0: pl };
    E.start(t);
    toast(`${pl.name}: night 1. Pick base camp to sleep there every night.`);
  });
  window.addEventListener("tf:sport", () => { if (!isMtb()) map.removeLayer(near); });
  window.tfBikeTrip = api;
})();
