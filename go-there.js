// Directions inside the app, like Google Maps (alex 2026-11-05: "When we click direction can we make it so it stays in
// the app and create a route to that location ... like google map navigation", then "Make the itinerary option similar
// ... how you can add stops"; then "In moto mode only for now"). In Adventure moto, every Directions link opens this sheet instead of leaving the
// app: From (your location) → stops → To, + Add stop (search a place or tap the map), drag-free ▲▼ to reorder, ✕ to
// remove, Drive / Bike / Walk (Moto in Adventure moto), the time, distance and arrival, then ▶ Start, which hands the
// route to Ride mode (navigate.js tfRide.follow) for turn-by-turn: next-turn banner, spoken turns, map following you,
// new route when you leave it, and in the iPhone app the next turn on the lock screen.
// Routes: the Valhalla server (with turn words), else OSRM's demo server for driving, else with no signal the roads of
// the saved Offline maps (moto-roads.js). "Other maps" still opens Google or Apple Maps for anyone who wants them.
//   window.tfGo.to({ lat, lon, name })   // open the sheet with this place as the destination
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L || window.tfGo) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const VALHALLA = "https://valhalla1.openstreetmap.de", OSRM = "https://router.project-osrm.org";
  const BLUE = "#1a73e8";
  const RAD = Math.PI / 180;
  const metres = (a, b) => { const kx = Math.cos(((a[0] + b[0]) / 2) * RAD) * 111320; return Math.hypot((b[1] - a[1]) * kx, (b[0] - a[0]) * 110540); };
  const fmtKm = (m) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`);
  const fmtT = (s) => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const isMoto = () => document.body.classList.contains("sport-moto");
  const isPhone = () => matchMedia("(max-width: 760px)").matches;
  const logUse = (...a) => (window.tfUse ? window.tfUse(...a) : (window.tfUseQ = window.tfUseQ || []).push(a));

  // ---------- look ----------
  const css = document.createElement("style");
  css.textContent = `
.go-sheet { position: fixed; z-index: 1300; left: 0; right: 0; bottom: 0; max-height: 78vh; overflow: auto; overscroll-behavior: contain; background: var(--panel, #fff); color: var(--fg, #14211a);
  border-radius: 20px 20px 0 0; box-shadow: 0 -6px 28px rgba(0,0,0,.25); padding: 8px 14px calc(14px + env(safe-area-inset-bottom, 0px)); font-size: 1rem; }
@media (min-width: 761px) { .go-sheet { left: 12px; right: auto; bottom: 12px; width: 400px; border-radius: 18px; max-height: calc(100vh - 24px); } }
.go-sheet[hidden] { display: none; }
.go-grab { width: 40px; height: 5px; border-radius: 3px; background: var(--line, #d6dad3); margin: 0 auto 6px; }
.go-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.go-head h3 { margin: 0; font-size: 1.15rem; flex: 1; }
.go-x { all: unset; cursor: pointer; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--chip, #eef0ea); font-size: 1.1rem; }
ol.go-stops { list-style: none; margin: 0; padding: 0; position: relative; }
.go-stops li { display: flex; align-items: center; gap: 8px; min-height: 46px; position: relative; }
.go-stops li + li::before { content: ""; position: absolute; left: 10px; top: -14px; height: 22px; border-left: 2px dotted #8a8f98; }
.go-dot { width: 22px; flex: none; display: grid; place-items: center; }
.go-dot i { width: 12px; height: 12px; border-radius: 50%; border: 3px solid ${BLUE}; background: #fff; box-sizing: border-box; }
.go-dot.me i { background: ${BLUE}; border-color: #fff; box-shadow: 0 0 0 2px ${BLUE}; }
.go-dot.end i { width: 14px; height: 14px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background: #d6202a; border: 0; }
.go-dot b { font: 800 .75rem/1 system-ui, sans-serif; color: #fff; background: #5b6068; border-radius: 50%; width: 18px; height: 18px; display: grid; place-items: center; }
.go-place { all: unset; box-sizing: border-box; flex: 1; min-width: 0; cursor: pointer; padding: 10px 12px; border-radius: 12px; background: var(--chip, #eef0ea); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.go-place.empty { color: var(--muted, #5b6660); }
.go-ic { all: unset; cursor: pointer; width: 34px; height: 34px; flex: none; display: grid; place-items: center; border-radius: 10px; color: var(--muted, #5b6660); font-size: 1rem; }
.go-ic:disabled { opacity: .25; cursor: default; }
.go-tools { display: flex; gap: 8px; margin: 8px 0 4px 30px; }
.go-chip { font: inherit; font-size: .92rem; font-weight: 700; padding: 8px 12px; border-radius: 999px; border: 1px solid var(--line, #d6dad3); background: var(--panel, #fff); color: inherit; cursor: pointer; white-space: nowrap; }
.go-chip.on { background: ${BLUE}; border-color: ${BLUE}; color: #fff; }
.go-find { margin: 8px 0; padding: 10px; border-radius: 14px; background: color-mix(in srgb, ${BLUE} 8%, transparent); }
.go-find[hidden] { display: none; }
.go-find p { margin: 6px 0 0; font-size: .88rem; color: var(--muted, #5b6660); }
.go-find .go-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.go-modes { display: flex; gap: 6px; margin: 10px 0 6px; overflow-x: auto; }
.go-sum { margin: 6px 0 2px; }
.go-sum b { font-size: 1.45rem; color: #188038; }
.go-sum .go-km { font-size: 1.1rem; color: var(--muted, #5b6660); margin-left: 6px; }
.go-sub { font-size: .9rem; color: var(--muted, #5b6660); }
.go-err { color: #b3261e; font-size: .92rem; margin: 6px 0; }
.go-acts { display: flex; gap: 8px; margin-top: 12px; align-items: center; }
.go-start { flex: 1; font: inherit; font-size: 1.1rem; font-weight: 800; padding: 13px; border-radius: 999px; border: 0; background: ${BLUE}; color: #fff; cursor: pointer; }
.go-start:disabled { opacity: .45; cursor: default; }
.go-other { font-size: .9rem; color: var(--muted, #5b6660); white-space: nowrap; padding: 0 6px; }
body.go-picking .leaflet-container { cursor: crosshair; }
.go-pin { background: none; border: 0; }
`;
  document.head.appendChild(css);

  const sheet = document.createElement("section");
  sheet.className = "go-sheet"; sheet.hidden = true; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-label", "Directions");
  document.body.appendChild(sheet);

  // ---------- state ----------
  // stops[0] is where you start (me: your location), the last is where you go; between them, the stops on the way.
  const st = { stops: [], mode: "drive", route: null, busy: false, err: "", seq: 0, find: -1, here: null, ext: "" };
  const routeLayer = L.layerGroup();
  const caseLine = L.polyline([], { color: "#0b4fb3", weight: 10, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false });
  const mainLine = L.polyline([], { color: BLUE, weight: 6, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false });
  const pins = L.layerGroup();
  routeLayer.addLayer(caseLine); routeLayer.addLayer(mainLine); routeLayer.addLayer(pins);

  const MODES = () => [
    isMoto() ? { k: "moto", t: "🏍 Moto", costing: "motorcycle" } : { k: "drive", t: "🚗 Drive", costing: "auto" },
    { k: "bike", t: "🚲 Bike", costing: "bicycle" },
    { k: "walk", t: "🚶 Walk", costing: "pedestrian" },
  ];
  const modeOf = () => MODES().find((m) => m.k === st.mode) || MODES()[0];

  // ---------- where you are ----------
  function locate() {
    return new Promise((ok) => {
      if (!navigator.geolocation) { ok(null); return; }
      navigator.geolocation.getCurrentPosition((p) => ok([p.coords.latitude, p.coords.longitude]), () => ok(null), { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 });
    });
  }

  // ---------- routing ----------
  const getJ = async (url, opts, ms) => {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 25000);
    try { const r = await fetch(url, { ...opts, signal: c.signal }); if (!r.ok) throw new Error("HTTP " + r.status); return await r.json(); }
    finally { clearTimeout(t); }
  };
  const decode6 = (str) => {
    let i = 0, lat = 0, lon = 0; const out = [];
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b, s = 0, r = 0;
        do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
        const d = r & 1 ? ~(r >> 1) : r >> 1;
        if (k === 0) lat += d; else lon += d;
      }
      out.push([lat / 1e6, lon / 1e6]);
    }
    return out;
  };
  // Valhalla's maneuver types as arrows (navigate.js and the iPhone lock screen draw them).
  const ARROW = { 1: "straight", 2: "right", 3: "left", 4: "arrive", 5: "arrive", 6: "arrive", 7: "straight", 8: "straight", 9: "slight-right", 10: "right", 11: "sharp-right",
    12: "uturn", 13: "uturn", 14: "sharp-left", 15: "left", 16: "slight-left", 17: "straight", 18: "slight-right", 19: "slight-left", 20: "slight-right", 21: "slight-left",
    22: "straight", 23: "slight-right", 24: "slight-left", 25: "straight", 26: "roundabout", 27: "roundabout", 28: "ferry", 29: "ferry", 37: "slight-right", 38: "slight-left" };
  // The words for a stop on the way or the end, instead of the router's "Your destination is on the right".
  const arriveText = (name, side, last) => `${last ? "You have arrived at" : "Stop:"} ${name || (last ? "your destination" : "your stop")}${side ? `, on the ${side}` : ""}.`;

  async function viaValhalla(locs, names) {
    const m = modeOf();
    const co = m.k === "bike" ? { bicycle: { bicycle_type: "Mountain", use_roads: 0.3 } } : m.k === "moto" ? { motorcycle: { use_highways: 0.5, use_trails: 0.2 } } : {};
    const body = { locations: locs.map((p, i) => ({ lat: p[0], lon: p[1], type: "break" })), costing: m.costing, costing_options: co,
      directions_options: { units: "kilometers", language: "en-US" } };
    const r = await getJ(`${VALHALLA}/route`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, 25000);
    const legs = r.trip.legs, line = [], parts = [], stopAt = [];
    let run = 0;
    legs.forEach((leg, li) => {
      const shape = decode6(leg.shape), base = line.length ? line.length - 1 : 0;
      if (line.length) line.pop();
      line.push(...shape);
      for (const mv of leg.maneuvers) {
        const arrive = mv.type === 4 || mv.type === 5 || mv.type === 6, last = li === legs.length - 1;
        if (arrive && !last) { if (parts.length) parts[parts.length - 1].stopName = names[li + 1]; continue; }
        const side = mv.type === 5 ? "right" : mv.type === 6 ? "left" : "";
        const text = arrive ? arriveText(names[li + 1], side, true) : mv.instruction;
        parts.push({ name: (mv.street_names && mv.street_names[0]) || (arrive ? names[li + 1] || "Destination" : "the road"), kind: "road", lvl: null, color: BLUE,
          say: arrive ? text : mv.verbal_pre_transition_instruction || mv.instruction, text, arrow: ARROW[mv.type] || "straight", sec: mv.time || 0,
          a: base + mv.begin_shape_index, b: base + mv.end_shape_index, leg: li });
      }
      run += leg.summary.length * 1000;
      stopAt.push(run);
    });
    // A stop on the way: the first turn after it says so.
    parts.forEach((x, i) => { if (x.stopName != null && parts[i + 1]) { const n = parts[i + 1]; n.text = `${arriveText(x.stopName, "", false)} Then ${n.text[0].toLowerCase()}${n.text.slice(1)}`; n.say = n.text; } });
    parts.forEach((x) => { x.pts = line.slice(x.a, Math.max(x.a + 2, x.b + 1)); });
    return { line, parts: parts.filter((x) => x.pts.length > 1), m: r.trip.summary.length * 1000, sec: r.trip.summary.time, stopAt, src: "valhalla" };
  }

  // OSRM's demo server (driving only): its steps carry the turn type and the road name, so the words are made here.
  const OSRM_MOD = { left: "left", right: "right", "slight left": "slight-left", "slight right": "slight-right", "sharp left": "sharp-left", "sharp right": "sharp-right", uturn: "uturn", straight: "straight" };
  async function viaOsrm(locs, names) {
    const r = await getJ(`${OSRM}/route/v1/driving/${locs.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(";")}?overview=full&geometries=geojson&steps=true`, {}, 20000);
    const rt = r.routes && r.routes[0];
    if (!rt) throw new Error("none");
    const line = [], parts = [], stopAt = [];
    let run = 0;
    rt.legs.forEach((leg, li) => {
      const last = li === rt.legs.length - 1;
      leg.steps.forEach((s) => {
        const pts = s.geometry.coordinates.map((c) => [c[1], c[0]]);
        if (line.length) pts.shift();
        const a = Math.max(0, line.length - 1);
        line.push(...pts);
        const mt = s.maneuver.type, mod = s.maneuver.modifier || "", road = s.name || s.ref || "";
        if (mt === "arrive") { if (last) parts.push({ name: names[li + 1] || "Destination", text: arriveText(names[li + 1], mod === "left" || mod === "right" ? mod : "", true), arrow: "arrive", sec: 0, a, b: line.length - 1 }); else if (parts.length) parts[parts.length - 1].stopName = names[li + 1]; return; }
        const turn = mt === "depart" ? `Head ${["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round((s.maneuver.bearing_after || 0) / 45) % 8]}`
          : mt === "roundabout" || mt === "rotary" ? `At the roundabout, take exit ${s.maneuver.exit || 1}`
          : /continue|new name/.test(mt) ? "Continue" : mt === "merge" ? "Merge" : /ramp|on ramp/.test(mt) ? "Take the ramp" : mt === "off ramp" ? "Take the exit"
          : mod === "uturn" ? "Make a U-turn" : mod ? `${/slight|sharp/.test(mod) ? "Turn " + mod : mod === "straight" ? "Continue straight" : "Turn " + mod}` : "Continue";
        const text = `${turn[0].toUpperCase()}${turn.slice(1)}${road ? `${mt === "depart" ? " on" : " onto"} ${road}` : ""}.`;
        parts.push({ name: road || "the road", text, arrow: mt === "roundabout" || mt === "rotary" ? "roundabout" : mt === "depart" ? "straight" : OSRM_MOD[mod] || "straight", sec: s.duration || 0, a, b: line.length - 1 });
      });
      run += leg.distance;
      stopAt.push(run);
    });
    parts.forEach((x, i) => { if (x.stopName != null && parts[i + 1]) { const n = parts[i + 1]; n.text = `${arriveText(x.stopName, "", false)} Then ${n.text[0].toLowerCase()}${n.text.slice(1)}`; } });
    parts.forEach((x) => { Object.assign(x, { kind: "road", lvl: null, color: BLUE, say: x.text }); x.pts = line.slice(x.a, Math.max(x.a + 2, x.b + 1)); });
    return { line, parts: parts.filter((x) => x.pts.length > 1), m: rt.distance, sec: rt.duration, stopAt, src: "osrm" };
  }

  // No signal: the roads of the saved Offline maps (moto-roads.js), for driving and moto.
  const loadRoads = () => window.tfMotoRoads ? Promise.resolve(window.tfMotoRoads) : new Promise((ok, no) => {
    const v = (document.querySelector('script[src*="go-there.js"]') || {}).src || "";
    const el = document.createElement("script"); el.src = "moto-roads.js" + (v.includes("?") ? v.slice(v.indexOf("?")) : ""); el.onload = () => ok(window.tfMotoRoads); el.onerror = () => no(new Error("roads"));
    document.head.append(el);
  });
  async function viaSaved(locs, names) {
    const R = await loadRoads();
    if (!R || !locs.every((p) => R.covered(p))) throw new Error("nomap");
    const r = await R.route(locs, { style: "paved", cap: modeOf().k === "moto" ? 3 : 2, street: false, excl: [], color: BLUE });
    const total = r.km * 1000, sec = r.time || (r.km / 50) * 3600;
    const stopAt = (r.legAt || []).map(([b, n]) => { let s = 0; for (let i = 1; i < b + n && i < r.line.length; i++) s += metres(r.line[i - 1], r.line[i]); return s; });
    const parts = r.parts.map((x) => ({ ...x, kind: "road", color: BLUE, sec: total ? ((x.km * 1000) / total) * sec : 0 }));
    const e = r.line[r.line.length - 1];
    parts.push({ name: names[names.length - 1] || "Destination", kind: "road", color: BLUE, text: arriveText(names[names.length - 1], "", true), say: arriveText(names[names.length - 1], "", true), arrow: "arrive", sec: 0, pts: [r.line[r.line.length - 2] || e, e] });
    return { line: r.line, parts, m: total, sec, stopAt, src: "saved" };
  }

  async function routeAll(locs, names) {
    const m = modeOf().k, road = m === "drive" || m === "moto";
    if (navigator.onLine !== false) {
      try { return await viaValhalla(locs, names); } catch (e) { /* busy or out of reach: next */ }
      if (m === "drive") try { return await viaOsrm(locs, names); } catch (e) { /* next */ }
    }
    if (road) return viaSaved(locs, names);
    throw new Error(navigator.onLine === false ? "offline" : "server");
  }
  const errText = (e) => e && e.message === "nomap" ? "No signal, and this trip goes outside your saved offline maps. Save the area in Offline maps first, or try again with signal."
    : e && e.message === "offline" ? "No signal. Driving directions can use your saved offline maps; bike and walk need signal."
    : e && e.message === "noway" ? "No road joins these places in your saved maps."
    : e && e.message === "far" ? "A place is too far from any road in your saved maps."
    : "Couldn't find a way there right now. Check the places, or try again in a minute.";

  // ---------- the sheet ----------
  const placeName = (s, i) => s.me ? "Your location" : s.ll ? s.name || `${s.ll[0].toFixed(4)}, ${s.ll[1].toFixed(4)}` : i === 0 ? "Choose start" : i === st.stops.length - 1 ? "Choose destination" : "Choose stop";
  function render() {
    const n = st.stops.length, r = st.route;
    const rows = st.stops.map((s, i) => {
      const dot = i === 0 ? `<span class="go-dot${s.me ? " me" : ""}"><i></i></span>` : i === n - 1 ? `<span class="go-dot end"><i></i></span>` : `<span class="go-dot"><b>${String.fromCharCode(64 + i)}</b></span>`;
      const mid = i > 0 && i < n - 1;
      return `<li>${dot}<button type="button" class="go-place${s.ll || s.me ? "" : " empty"}" data-find="${i}">${esc(placeName(s, i))}</button>
        ${mid ? `<button type="button" class="go-ic" data-up="${i}" aria-label="Move up"${i <= 1 ? " disabled" : ""}>▲</button><button type="button" class="go-ic" data-down="${i}" aria-label="Move down"${i >= n - 2 ? " disabled" : ""}>▼</button>` : ""}
        ${mid || (n > 2 && i === n - 1) ? `<button type="button" class="go-ic" data-del="${i}" aria-label="Remove this stop">✕</button>` : ""}</li>`;
    }).join("");
    const find = st.find >= 0 ? `<div class="go-find" id="goFind"><b>${st.find === 0 ? "Start from" : st.find === n - 1 ? "Go to" : "Stop on the way"}</b><div id="goFindBox"></div>
      <div class="go-row">${st.find === 0 ? `<button type="button" class="go-chip" data-mine>◎ Your location</button>` : ""}<button type="button" class="go-chip" data-cancel>Cancel</button></div>
      <p>Or tap the map where you want it.</p></div>` : "";
    const sum = st.busy ? `<p class="go-sub">Finding the way…</p>` : st.err ? `<p class="go-err">${esc(st.err)}</p>`
      : r ? `<div class="go-sum"><b>${fmtT(r.sec)}</b><span class="go-km">(${fmtKm(r.m)})</span></div>
        <div class="go-sub">${via(r) ? `via ${esc(via(r))} · ` : ""}arrive about ${clock(Date.now() + r.sec * 1000)}${r.src === "saved" ? " · from your saved offline maps" : ""}</div>` : "";
    sheet.innerHTML = `<div class="go-grab"></div><div class="go-head"><h3>Directions</h3><button type="button" class="go-x" aria-label="Close">✕</button></div>
      <ol class="go-stops">${rows}</ol>
      <div class="go-tools">${n < 10 ? `<button type="button" class="go-chip" data-add>＋ Add stop</button>` : ""}${n === 2 ? `<button type="button" class="go-chip" data-swap aria-label="Swap start and destination">⇅ Swap</button>` : ""}</div>
      ${find}
      <div class="go-modes">${MODES().map((m) => `<button type="button" class="go-chip${m.k === st.mode ? " on" : ""}" data-mode="${m.k}">${m.t}</button>`).join("")}</div>
      ${sum}
      <div class="go-acts"><button type="button" class="go-start" data-start${r && !st.busy ? "" : " disabled"}>▶ Start</button>${st.ext ? `<a class="go-other" href="${esc(st.ext)}" target="_blank" rel="noopener" data-ext>Other maps ↗</a>` : ""}</div>`;
    if (st.find >= 0 && window.tfPlaceSearch) {
      const box = window.tfPlaceSearch.box({ placeholder: "Search a place", button: "Search", onPick: (p) => setStop(st.find, [p.lat, p.lon], p.name) });
      $("goFindBox").appendChild(box);
      if (!isPhone()) setTimeout(() => { const i = box.querySelector("input"); if (i) i.focus(); }, 50);
    }
    document.body.classList.toggle("go-picking", st.find >= 0);
  }
  // The longest named road of the route: "via Sea to Sky Hwy".
  function via(r) {
    const by = new Map();
    r.parts.forEach((x) => { if (x.name && !/^(the road|destination)$/i.test(x.name) && x.arrow !== "arrive") by.set(x.name, (by.get(x.name) || 0) + (x.sec || 0)); });
    let best = "", bs = 0;
    by.forEach((s, k) => { if (s > bs) { bs = s; best = k; } });
    return best;
  }

  sheet.addEventListener("click", (e) => {
    const b = e.target.closest("button, a");
    if (!b) return;
    const d = b.dataset;
    if (b.classList.contains("go-x")) { close(); return; }
    if (d.find != null) { st.find = +d.find; render(); return; }
    if (d.cancel != null) { st.find = -1; render(); return; }
    if (d.mine != null) { st.stops[0] = { me: true, ll: st.here, name: "Your location" }; st.find = -1; replan(); return; }
    if (d.add != null) { st.stops.splice(st.stops.length - 1, 0, { ll: null, name: "" }); st.find = st.stops.length - 2; st.route = null; draw(); render(); return; }
    if (d.swap != null) { st.stops.reverse(); replan(); return; }
    if (d.up != null || d.down != null) { const i = +(d.up || d.down), j = d.up != null ? i - 1 : i + 1; [st.stops[i], st.stops[j]] = [st.stops[j], st.stops[i]]; replan(); return; }
    if (d.del != null) { st.stops.splice(+d.del, 1); if (st.stops.length < 2) st.stops.push({ ll: null, name: "" }); st.find = -1; replan(); return; }
    if (d.mode) { st.mode = d.mode; try { localStorage.setItem("tf:goMode", d.mode); } catch {} replan(); return; }
    if (d.start != null) { start(); return; }
  });
  function setStop(i, ll, name) {
    if (i < 0 || i >= st.stops.length) return;
    st.stops[i] = { ll: [+ll[0].toFixed(6), +ll[1].toFixed(6)], name: name || "" };
    st.find = -1;
    replan();
  }

  // A tap on the map while choosing a place sets it (and nothing else on the map reacts to that tap).
  const mapEl = map.getContainer();
  mapEl.addEventListener("click", (e) => {
    if (sheet.hidden || st.find < 0 || e.target.closest(".leaflet-control")) return;
    e.stopPropagation(); e.preventDefault();
    const ll = map.mouseEventToLatLng(e);
    setStop(st.find, [ll.lat, ll.lng], "Dropped pin");
  }, true);

  // ---------- the route on the map ----------
  const pinIcon = (txt, c) => L.divIcon({ className: "go-pin", iconSize: [26, 26], iconAnchor: [13, 13],
    html: `<svg viewBox="0 0 26 26" width="26" height="26"><circle cx="13" cy="13" r="10" fill="${c}" stroke="#fff" stroke-width="3"/><text x="13" y="17.5" text-anchor="middle" font="800 11px system-ui" font-size="11" font-weight="800" fill="#fff">${txt}</text></svg>` });
  function draw(fit) {
    const r = st.route;
    caseLine.setLatLngs(r ? r.line : []); mainLine.setLatLngs(r ? r.line : []);
    pins.clearLayers();
    st.stops.forEach((s, i) => {
      if (!s.ll || s.me) return;
      const last = i === st.stops.length - 1;
      pins.addLayer(L.marker(s.ll, { interactive: false, keyboard: false, icon: pinIcon(last ? "" : i === 0 ? "" : String.fromCharCode(64 + i), last ? "#d6202a" : i === 0 ? "#188038" : "#5b6068") }));
    });
    if (!map.hasLayer(routeLayer)) routeLayer.addTo(map);
    if (fit) {
      const pts = r ? r.line : st.stops.filter((s) => s.ll).map((s) => s.ll);
      if (pts.length) {
        const pad = isPhone() ? { paddingTopLeft: [30, 70], paddingBottomRight: [30, Math.min(window.innerHeight * 0.55, sheet.offsetHeight + 20)] } : { paddingTopLeft: [430, 40], paddingBottomRight: [40, 40] };
        if (window.tfLowerSheet) window.tfLowerSheet();
        map.fitBounds(L.latLngBounds(pts), { ...pad, maxZoom: 15 });
      }
    }
  }

  async function replan() {
    const my = ++st.seq;
    render();
    if (st.stops[0].me && !st.stops[0].ll) {
      st.busy = true; render();
      st.here = st.here || (await locate());
      if (my !== st.seq) return;
      st.stops[0].ll = st.here;
      if (!st.here) { st.busy = false; st.err = "Couldn't find where you are. Turn on Location for Trail Finder, or tap “Your location” to choose a start."; st.route = null; draw(); render(); return; }
    }
    const ready = st.stops.filter((s) => s.ll);
    if (ready.length < 2) { st.busy = false; st.err = ""; st.route = null; draw(true); render(); return; }
    st.busy = true; st.err = ""; render();
    const names = ready.map((s) => (s.me ? "" : s.name === "Dropped pin" ? "" : s.name));
    try {
      const r = await routeAll(ready.map((s) => s.ll), names);
      if (my !== st.seq) return;
      st.route = r; st.busy = false;
      logUse("go", modeOf().k, Math.round(r.m / 1000));
    } catch (e) {
      if (my !== st.seq) return;
      st.route = null; st.busy = false; st.err = errText(e);
    }
    draw(true); render();
  }

  function close() {
    st.seq++; st.find = -1;
    sheet.hidden = true;
    document.body.classList.remove("go-picking");
    map.removeLayer(routeLayer);
  }

  // ---------- go ----------
  // Ride mode follows the route: next turn on top, the map following you, turns spoken, a new route if you leave it
  // (from where you are, through the stops not reached yet, to the end).
  function start() {
    const r = st.route;
    if (!r || !window.tfRide) return;
    const ready = st.stops.filter((s) => s.ll), dest = ready[ready.length - 1];
    const name = dest.name && dest.name !== "Dropped pin" ? dest.name : "your destination";
    let cur = { r, stops: ready.slice(1).map((s, i) => ({ ll: s.ll, name: s.me ? "" : s.name, at: r.stopAt[i] || 0 })) };
    const reroute = async (p, pos) => {
      const left = cur.stops.filter((s) => s.at > pos + 50);
      if (!left.length) return null;
      const n = await routeAll([p, ...left.map((s) => s.ll)], ["", ...left.map((s) => s.name === "Dropped pin" ? "" : s.name)]);
      cur = { r: n, stops: left.map((s, i) => ({ ...s, at: n.stopAt[i] || 0 })) };
      return { lines: [n.line], name, parts: n.parts.map((x) => ({ ...x })) };
    };
    logUse("go", "start:" + modeOf().k, Math.round(r.m / 1000));
    close();
    window.tfRide.follow([r.line], name, r.parts.map((x) => ({ ...x })), { reroute, drive: true, mode: modeOf().k });
  }

  async function to(o) {
    if (!o || !isFinite(o.lat) || !isFinite(o.lon)) return;
    try { const m = localStorage.getItem("tf:goMode"); st.mode = m === "moto" || m === "drive" ? (isMoto() ? "moto" : "drive") : m || (isMoto() ? "moto" : "drive"); } catch { st.mode = isMoto() ? "moto" : "drive"; }
    if (st.mode === "moto" && !isMoto()) st.mode = "drive";
    st.stops = [{ me: true, ll: st.here, name: "Your location" }, { ll: [o.lat, o.lon], name: o.name || "" }];
    st.route = null; st.err = ""; st.find = -1;
    st.ext = o.ext || `https://www.google.com/maps/dir/?api=1&destination=${o.lat.toFixed(5)},${o.lon.toFixed(5)}`;
    sheet.hidden = false;
    st.here = null;   // a fresh fix each time
    replan();
  }

  // ---------- every Directions link in the app comes here ----------
  // Google Maps (…/maps/dir/?…destination=lat,lon) and Apple Maps (?daddr=lat,lon) links, in any sport, unless marked
  // data-ext. The place's name: data-go-name, else the title of the card the link is in.
  function destOf(a) {
    let u;
    try { u = new URL(a.href); } catch { return null; }
    const q = /google\.[^/]+\/maps\/dir/.test(u.href) ? u.searchParams.get("destination") : /maps\.apple\.com/.test(u.host) ? u.searchParams.get("daddr") : null;
    const m = q && q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    return m ? { lat: +m[1], lon: +m[2], ext: a.href } : null;
  }
  function nameNear(a) {
    if (a.dataset.goName) return a.dataset.goName;
    for (let el = a.parentElement, k = 0; el && el !== document.body && k < 8; el = el.parentElement, k++) {
      const h = el.querySelector("h1, h2, h3, h4, .title, .name");
      if (h && h.textContent.trim() && !/^directions$/i.test(h.textContent.trim())) return h.textContent.trim().slice(0, 60);
    }
    return "";
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a || a.hasAttribute("data-ext") || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (!isMoto()) return;   // Adventure moto only for now (alex 2026-11-05); the other sports still open Google Maps
    const d = destOf(a);
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    to({ ...d, name: nameNear(a) });
  }, true);

  window.tfGo = { to, close };
})();
