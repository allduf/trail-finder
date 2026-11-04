// Hiking, the sixth sport in the sport menu (MTB / Skiing / Hunting / Fishing / Adventure moto / Hiking).
// alex (2026-11-02): "would it help adding hiking to our app? it will go reach more people?", then picked "Build a lean
// version now": a Hiking mode built on what the app already has, with the Canadian extras the big hiking apps do poorly.
// winter.js owns the sport menu and loads this file the first time Hiking is picked (the other sports never load it).
// It sets body.sport-hike (and body.sport-alt, which hides the MTB parts) and sends "tf:sport".
// The panel, top to bottom (the same order as every sport's tab):
//  - A place search, the Today line (weather here, the snow line, sunset) and four buttons: Hikes here, Snow line,
//    Passes, Saved.
//  - The hike you tapped: grade (the hardest part, from OpenStreetMap's sac_scale), length, loop or one way, heights
//    and time (Open-Meteo elevation), the snow at its highest point today, the park it's in and the pass it needs, and
//    the closures, warnings and wildfires near it (the nightly closures.json and fires files the app already has).
//  - Hikes in view: every named hiking trail and hiking route in view, nearest first, by grade.
// Map: hiking trails coloured by grade (green easy, blue moderate, orange hard, red dashed expert, brown not graded),
// fetched from OpenStreetMap (Overpass) for the squares in view at zoom 11 and up, kept on the phone for a week. They
// are ordinary Leaflet lines, so the 3D map copies them (with their names and taps) by itself (map3d.js).
// Recording a hike: the Hike tab (navigate.js) saves the track with sport "hike"; My hikes lists them.
// Up to the other sports (alex 2026-11-02: "i want hiking to be as good as all the other sports"):
//  - Hiking's own layers in Layers (like Moto and Fishing): trailheads and parking, huts, shelters and campsites,
//    viewpoints and waterfalls, water and toilets, slope angle. The places come with the trails: the weekly job's
//    data/hike-places-<zone>.json for the home zones, the same Overpass ask for the squares elsewhere. They're
//    Leaflet circle dots, so the 3D map shows and taps them too.
//  - Today: where to hike today near the middle of the map: the nearest hikes' highest points (Open-Meteo
//    elevation, a few points each) and the snow there right now (Open-Meteo, all of them in one ask), with the
//    closures and wildfires near each: snow-free first.
//  - The hike card: a height profile, where to start (the nearest trailhead or parking) and what's along it.
//  - Plan a hike: tap points on the map (2D or 3D) and the route follows the footpaths and hiking trails (Valhalla's
//    pedestrian routing, the same server Moto plans on), up to the grade you pick; distance, climb, time, profile and
//    the snow at its top; save it (synced), follow it (navigate.js tfRide.follow) or send it as a GPX file.
(() => {
  "use strict";
  const map = window.tfLeaflet, sel = document.getElementById("sport");
  if (!map || !sel || !window.L || window.tfHike) return;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  const isHike = () => document.body.classList.contains("sport-hike");
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const timeout = (ms) => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
  const getJ = (url, ms = 15000, opt = {}) => fetch(url, { signal: timeout(ms), ...opt }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  const kmTo = (a, b) => Math.hypot((a[1] - b[1]) * 111.32 * Math.cos((a[0] * Math.PI) / 180), (a[0] - b[0]) * 110.57);
  const fmtKm = (k) => (k < 1 ? `${Math.round(k * 1000)} m` : k < 10 ? `${k.toFixed(1)} km` : `${Math.round(k)} km`);
  const fmtM = (m) => `${Math.round(m).toLocaleString()} m`;
  const fmtH = (h) => { const m = Math.max(15, Math.round((h * 60) / 15) * 15); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}`; };
  const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "");
  const ACC = "#2b8a3e";   // the Hiking accent (forest green)
  const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
  const MIN_ZOOM = 11;

  // ---------- grades ----------
  // OpenStreetMap's sac_scale (the Swiss Alpine Club hiking scale), in the words Canadian parks use.
  const GRADES = [
    { k: "none", label: "Not graded", sub: "No grade on the map yet", c: "#8d6e46" },
    { k: "easy", label: "Easy", sub: "A clear path, little climbing", c: "#2f9e44" },
    { k: "moderate", label: "Moderate", sub: "Mountain trail: steep or rough in parts", c: "#1c7ed6" },
    { k: "hard", label: "Hard", sub: "Demanding: exposed bits, sure footing needed", c: "#e8590c" },
    { k: "expert", label: "Expert", sub: "Alpine route or scramble: hands needed, route finding", c: "#c92a2a" },
  ];
  const SAC = { hiking: 1, mountain_hiking: 2, demanding_mountain_hiking: 3, alpine_hiking: 4, demanding_alpine_hiking: 4, difficult_alpine_hiking: 4 };
  const gradeOf = (t) => {
    const s = String(t.sac_scale || "").trim();
    if (SAC[s]) return SAC[s];
    const m = /^T([1-6])/i.exec(s);
    return m ? Math.min(4, Math.max(1, +m[1] === 1 ? 1 : +m[1] === 2 ? 2 : +m[1] === 3 ? 3 : 4)) : 0;
  };

  // ---------- icons ----------
  const svg = (d, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    boot: '<path d="M7 3h5v8l6 3c1.5.7 2 1.8 2 3v2H4V3z"/><path d="M4 19h16M7 7h3M7 11h4"/>',
    snow: '<path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>',
    pass: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 6v12M12 10h5M12 14h3"/>',
    star: '<path d="M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.1 5.9L12 16.5l-5.3 2.9 1.1-5.9-4.4-4.1 6-.7z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    peak: '<path d="m3 20 6-11 4 6 2-3 6 8z"/>',
    warn: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/>',
    car: '<path d="M5 17h14v-5l-2-5H7l-2 5z"/><circle cx="8" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8v8l6-4z"/>',
    zoom: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5M11 8v6M8 11h6"/>',
    log: '<path d="M5 3h14v18H5z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    today: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    hut: '<path d="M3 11 12 4l9 7M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
    plan: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h6"/>',
  };

  // ---------- places along the trails ----------
  // Kinds of place (the weekly job's placeKind, scripts/build-hike.mjs), their dot colours and the layer they're in.
  const PLACES = {
    th: { label: "Trailhead", c: "#7c3aed", layer: "start" },
    park: { label: "Parking", c: "#1d4ed8", layer: "start" },
    hut: { label: "Hut or shelter", c: "#b5651d", layer: "sleep" },
    camp: { label: "Campsite", c: "#2f9e44", layer: "sleep" },
    view: { label: "Viewpoint", c: "#f08c00", layer: "see" },
    fall: { label: "Waterfall", c: "#1098ad", layer: "see" },
    peak: { label: "Summit", c: "#495057", layer: null },   // the base map names the summits already: on the hike card only
    water: { label: "Drinking water", c: "#0284c7", layer: "need" },
    wc: { label: "Toilets", c: "#64748b", layer: "need" },
  };
  function placeKind(t) {
    if (t.highway === "trailhead") return "th";
    if (t.amenity === "parking") return "park";
    if (/^(alpine_hut|wilderness_hut)$/.test(t.tourism || "") || t.amenity === "shelter") return "hut";
    if (t.tourism === "camp_site") return "camp";
    if (t.tourism === "viewpoint") return "view";
    if (/^(peak|volcano)$/.test(t.natural || "")) return "peak";
    if (t.waterway === "waterfall") return "fall";
    if (t.amenity === "drinking_water") return "water";
    if (t.amenity === "toilets") return "wc";
    return null;
  }
  // ---------- Hiking's own layers (in Layers, like Moto's and Fishing's) ----------
  const LAYERS = {
    trails: { g: "Trails", label: "Hiking trails", sub: "Coloured by grade (zoom in)", on: true, icon: ["#1c7ed6", "line"] },
    start: { g: "Places", label: "Trailheads and parking", sub: "Where hikes start", on: true, icon: ["#7c3aed", "dot"] },
    sleep: { g: "Places", label: "Huts, shelters and campsites", sub: "Backcountry huts too, with booking from the clubs", on: true, icon: ["#b5651d", "dot"] },
    see: { g: "Places", label: "Viewpoints and waterfalls", sub: "", on: true, icon: ["#f08c00", "dot"] },
    need: { g: "Places", label: "Drinking water and toilets", sub: "Near the trails", on: false, icon: ["#0284c7", "dot"] },
    slope: { g: "Terrain", label: "Slope angle", sub: "Steep ground: 25-35° yellow, 35-45° orange, over 45° red", on: false, icon: ["#e8590c", "box"] },
  };
  const LAYER_GROUPS = ["Trails", "Places", "Terrain"];
  let shown = new Set(store.get("hikeLayers", Object.keys(LAYERS).filter((k) => LAYERS[k].on)));

  // ---------- look ----------
  const css = document.createElement("style");
  css.textContent = `
body:not(.sport-hike) #hikePane, body:not(.sport-hike) .leaflet-hike-pane { display: none !important; }
#hikePane { display: flex; flex-direction: column; gap: 12px; font-size: .9rem; }
#hikePane a { color: var(--accent); }
#hikePane .hk-note { color: var(--muted); font-size: .76rem; margin: 0; }
#hikePane .hk-actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
#hikePane .hk-act { font: inherit; font-size: .74rem; font-weight: 700; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 58px; padding: 6px 4px;
  border-radius: 12px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; text-align: center; }
#hikePane .hk-act svg { color: ${ACC}; }
#hikePane .hk-act.on { background: ${ACC}; border-color: ${ACC}; color: #fff; }
#hikePane .hk-act.on svg { color: #fff; }
#hikePane .hk-now { font: inherit; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; text-align: left; width: 100%; padding: 9px 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; font-size: .82rem; box-sizing: border-box; }
#hikePane .hk-now span { display: inline-flex; align-items: center; gap: 5px; }
#hikePane .hk-now svg { color: ${ACC}; flex: none; }
#hikePane .hk-card { border: 1px solid var(--line); border-radius: 14px; padding: 12px; background: var(--panel); display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm); }
#hikePane .hk-card header { display: flex; align-items: center; gap: 8px; }
#hikePane .hk-card header svg { color: ${ACC}; flex: none; }
#hikePane .hk-card h3 { margin: 0; font-size: .95rem; font-weight: 800; flex: 1; min-width: 0; }
#hikePane .hk-card h4 { margin: 4px 0 0; font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
#hikePane .hk-card p { margin: 0; font-size: .84rem; }
#hikePane .hk-x { font: inherit; border: 0; background: var(--chip); color: var(--muted); cursor: pointer; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; flex: none; }
#hikePane .hk-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#hikePane .hk-pill { font: inherit; font-size: .78rem; font-weight: 700; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; text-decoration: none; }
#hikePane .hk-pill svg { color: ${ACC}; }
#hikePane .hk-pill.on, #hikePane .hk-pill.go { background: ${ACC}; border-color: ${ACC}; color: #fff; }
#hikePane .hk-pill.on svg, #hikePane .hk-pill.go svg { color: #fff; }
#hikePane .hk-badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; font-size: .8rem; padding: 3px 10px; border-radius: 999px; color: #fff; background: var(--c); }
#hikePane .hk-fact { display: inline-flex; align-items: center; font-weight: 700; font-size: .8rem; padding: 3px 10px; border-radius: 999px; background: var(--chip); }
#hikePane .hk-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--c); flex: none; }
#hikePane .hk-warn { border-left: 4px solid #e8590c; padding: 4px 0 4px 9px; font-size: .82rem; }
#hikePane .hk-warn.bad { border-color: #c92a2a; }
#hikePane .hk-warn.ok { border-color: #2f9e44; }
#hikePane .hk-warn small { display: block; color: var(--muted); }
#hikePane ul.hk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
#hikePane ul.hk-list button { font: inherit; text-align: left; width: 100%; border: 0; border-bottom: 1px solid var(--line); background: none; color: inherit; padding: 9px 2px; cursor: pointer;
  display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 1px 10px; align-items: center; }
#hikePane ul.hk-list b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .88rem; }
#hikePane ul.hk-list small { grid-column: 2; color: var(--muted); font-size: .76rem; }
#hikePane ul.hk-list em { grid-column: 3; grid-row: 1 / span 2; font-style: normal; font-size: .78rem; color: var(--muted); white-space: nowrap; }
#hikePane ul.hk-list .hk-dot { grid-row: 1 / span 2; }
#hikePane .hk-days { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
#hikePane .hk-days div { background: var(--chip); border-radius: 10px; padding: 8px 6px; text-align: center; font-size: .78rem; display: flex; flex-direction: column; gap: 2px; }
#hikePane .hk-days b { font-size: .84rem; }
#hikePane .hk-key { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: .74rem; color: var(--muted); }
#hikePane .hk-key span { display: inline-flex; align-items: center; gap: 5px; }
#hikePane .hk-safe { color: var(--muted); font-size: .76rem; }
#hikePane .hk-safe summary { cursor: pointer; font-weight: 700; }
#hikePane .hk-actions.five { grid-template-columns: repeat(5, 1fr); }
#hikePane .hk-prof { width: 100%; height: auto; max-height: 110px; display: block; }
#hikePane .hk-prof text { font-size: 10px; fill: var(--muted); }
#hikePane .hk-along { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: .82rem; }
#hikePane .hk-along li { display: flex; gap: 8px; align-items: baseline; }
#hikePane .hk-along li .hk-dot { transform: translateY(1px); }
#hikePane .hk-along small { color: var(--muted); }
#hikePane .hk-today-h { margin: 6px 0 0; font-size: .74rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
body:not(.sport-hike) .lm-hike, body.sport-hike #accessBtn, body:not(.hk-planning) #hkPlanBar { display: none !important; }
#hkPlanBar { position: fixed; z-index: 1200; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 72px); width: min(560px, calc(100% - 24px)); box-sizing: border-box;
  display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 14px; border-radius: 14px; background: var(--panel); color: var(--fg); box-shadow: 0 4px 16px #0003; font-size: .84rem; }
#hkPlanBar span { flex: 1; min-width: 0; }
#hkPlanBar button { font: inherit; font-weight: 700; font-size: .8rem; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
#hkPlanBar button.go { background: ${ACC}; border-color: ${ACC}; color: #fff; }
.lm-hike { display: flex; flex-direction: column; }
.lm-hike .hk-group { margin: 0; font-size: .66rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding-top: 6px; }
.lm-hike .hk-layer { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: center; padding: 5px 0; cursor: pointer; }
.lm-hike .hk-layer b { display: block; font-size: .86rem; }
.lm-hike .hk-layer small { display: block; color: var(--muted); font-size: .74rem; line-height: 1.25; }
.lm-hike .hk-ic { width: 22px; height: 22px; border-radius: 6px; display: block; box-sizing: border-box; }
.lm-hike .hk-sw { appearance: none; -webkit-appearance: none; width: 40px; height: 24px; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; margin: 0; flex: none; transition: background .15s; }
.lm-hike .hk-sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px #0004; transition: left .15s; }
.lm-hike .hk-sw:checked { background: ${ACC}; }
.lm-hike .hk-sw:checked::after { left: 19px; }`;
  document.head.append(css);

  // ---------- panel ----------
  const pane = document.createElement("section");
  pane.id = "hikePane";
  pane.setAttribute("aria-label", "Hiking");
  pane.innerHTML = `
    <div class="hk-actions five" role="toolbar" aria-label="Hiking tools">
      <button type="button" class="hk-act" data-act="today">${svg(IC.today)}Today</button>
      <button type="button" class="hk-act" data-act="list">${svg(IC.boot)}Hikes here</button>
      <button type="button" class="hk-act" data-act="snow">${svg(IC.snow)}Snow line</button>
      <button type="button" class="hk-act" data-act="plan">${svg(IC.plan)}Plan</button>
      <button type="button" class="hk-act" data-act="saved">${svg(IC.star)}Saved</button>
    </div>
    <button type="button" class="hk-now" id="hkNow" hidden></button>
    <div class="hk-card" id="hkToday" hidden></div>
    <div class="hk-card" id="hkPlan" hidden></div>
    <div class="hk-card" id="hkPlace" hidden></div>
    <div class="hk-card" id="hkHike" hidden></div>
    <div class="hk-card" id="hkSnow" hidden></div>
    <div class="hk-card" id="hkPasses" hidden></div>
    <div class="hk-card" id="hkSaved" hidden></div>
    <div class="hk-card" id="hkLog" hidden></div>
    <div class="hk-card" id="hkListCard"><header>${svg(IC.boot)}<h3 id="hkCount">Hikes in view</h3></header>
      <div class="hk-row" id="hkGrades" role="group" aria-label="Grade"></div>
      <p class="hk-note" id="hkMsg" role="status"></p>
      <ul class="hk-list" id="hkList"></ul>
      <div class="hk-key">${GRADES.map((g) => `<span><span class="hk-dot" style="--c:${g.c}"></span>${esc(g.label)}</span>`).join("")}</div>
      <div class="hk-row"><button type="button" class="hk-pill" id="hkPassBtn">${svg(IC.pass, 16)}Parks and passes</button></div></div>
    <details class="hk-safe"><summary>A guide, not a guarantee</summary>Trails, grades and heights come from OpenStreetMap and Open-Meteo and can be wrong or out of date. Snow amounts are a weather model's guess. Parks change their passes and closures often: check the park's own page, tell someone your plan, carry the ten essentials and bear spray, and turn back when it doesn't feel right.</details>`;
  if (window.tfPlaceSearch) pane.querySelector(".hk-actions").after(window.tfPlaceSearch.box({ placeholder: "Go to a town, park or mountain", local: (q) => localHits(q),
    onPick: (p) => { if (p.hike && hikes.has(p.hike)) openHike(p.hike, true); else window.tfPlaceSearch.go(p); } }));
  const head = document.querySelector(".panel-head");
  const after = $("motoPane") || $("fishPane") || $("huntPane") || $("skiPane"), modes = head && head.querySelector(".modes");
  if (after) after.after(pane); else if (modes) modes.after(pane); else if (head) head.append(pane);
  const lmHike = document.createElement("div");
  lmHike.className = "lm-hike";
  lmHike.innerHTML = `<div class="lm-head">Hiking layers</div><div id="hkLayerList"></div>`;
  const lmStyle = document.querySelector("#layersMenu .lm-style");
  if (lmStyle) lmStyle.after(lmHike); else pane.append(lmHike);
  // Phones: a card opened from the map lifts the sheet to half when it's down (as Skiing's cardInView does).
  const showCard = (el) => {
    el.hidden = false;
    const p = document.querySelector(".panel"), low = phone() && window.tfSnapTo && p && p.classList.contains("sheet-peek");
    if (low) window.tfSnapTo("half");
    setTimeout(() => { if (window.tfPanelScrollTo) window.tfPanelScrollTo(el); }, low ? 320 : 0);
  };
  const toPanel = () => { const t = document.querySelector('#tabbar [data-nav="hike"]'); if (phone() && t && t.getAttribute("aria-current") !== "true") t.click(); };
  const closeX = (id) => `<button type="button" class="hk-x" data-close="${id}" aria-label="Close">${svg(IC.x, 16)}</button>`;
  pane.addEventListener("click", (e) => {
    const c = e.target.closest("[data-close]");
    if (c) { $(c.dataset.close).hidden = true; if (c.dataset.close === "hkHike") select(null); if (c.dataset.close === "hkPlace") { curPlace = null; drawPlaces(); } if (c.dataset.close === "hkPlan") setPlanning(false); }
  });

  // ---------- the trails from OpenStreetMap ----------
  // Squares of 0.1° by 0.15° (about 11 by 11 km here), fetched two at a time and kept a week in the phone's cache.
  const T_LAT = 0.1, T_LON = 0.15, WEEK = 7 * 864e5;
  const tKey = (s, w) => `${s.toFixed(2)},${w.toFixed(2)}`;
  const tiles = new Map();    // key -> "loading" | "done" | "error"
  const ways = new Map();     // id -> { id, g: [[lat, lon]...], t: tags }
  const rels = new Map();     // id -> { id, n, t, m: [way ids] }
  const relOf = new Map();    // way id -> [rel ids]
  const KEEP_TAGS = ["name", "highway", "sac_scale", "surface", "trail_visibility", "foot", "access", "bicycle", "mtb:scale", "mtb:scale:imba", "mtb:type", "footway", "lit", "operator", "website", "description", "incline", "ref", "seasonal", "informal"];
  function query(b) {
    const bb = b.map((n) => n.toFixed(4)).join(",");
    return `[out:json][timeout:40];
(
  way["highway"~"^(path|footway|bridleway)$"]["name"](${bb});
  way["highway"~"^(path|footway|bridleway|track)$"]["sac_scale"](${bb});
)->.a;
rel["route"~"^(hiking|foot)$"](${bb})->.r;
way(r.r)["highway"](${bb})->.b;
(.a; .b;);
out tags geom qt;
.r out body qt;
(
  nwr["highway"="trailhead"](${bb});
  nwr["tourism"~"^(alpine_hut|wilderness_hut|viewpoint|camp_site)$"](${bb});
  nwr["amenity"="shelter"]["shelter_type"~"^(basic_hut|lean_to|weather_shelter|rock_shelter)$"](${bb});
  node["natural"~"^(peak|volcano)$"]["name"](${bb});
  node["waterway"="waterfall"](${bb});
  nwr["amenity"="parking"]["access"!~"^(private|no|customers|permit|delivery)$"](${bb});
  node["amenity"~"^(drinking_water|toilets)$"](${bb});
);
out center tags qt;`;
  }
  let mirror = 0;
  async function ask(q, ms = 45000) {
    const url = OVERPASS[mirror % OVERPASS.length];
    try {
      const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: timeout(ms) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.remark && /error/i.test(j.remark)) throw new Error(j.remark);
      return j;
    } catch (e) { mirror++; throw e; }   // the other server next time
  }
  const CACHE = "tf-hikes-v2", cacheUrl = (k) => `https://trail-finder.local/hikes/${k}`;
  async function cacheGet(k) {
    try { const c = await caches.open(CACHE), r = await c.match(cacheUrl(k)); if (!r) return null; const j = await r.json(); return Date.now() - j.at < WEEK ? j : null; } catch { return null; }
  }
  async function cachePut(k, j) { try { const c = await caches.open(CACHE); await c.put(cacheUrl(k), new Response(JSON.stringify(j), { headers: { "Content-Type": "application/json" } })); } catch {} }
  const PLACE_EXTRA = ["ele", "fee", "charge", "capacity", "operator", "website", "reservation", "shelter_type", "backcountry", "drinking_water", "opening_hours", "seasonal", "description", "height"];
  // Parking, water, toilets and unnamed campsites only near a hiking trail (about 400 m), as the weekly job does.
  function nearTrails(list, wayList) {
    const C = 0.004, cells = new Set(), cell = (a, b) => `${Math.floor(a / C)},${Math.floor(b / C)}`;
    wayList.forEach((w) => w.g.forEach((p) => cells.add(cell(p[0], p[1]))));
    const near = (lat, lon) => { const y = Math.floor(lat / C), x = Math.floor(lon / C); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (cells.has(`${y + i},${x + j}`)) return true; return false; };
    return list.filter((x) => !(/^(park|water|wc)$/.test(x[1]) || (x[1] === "camp" && !x[4])) || near(x[2], x[3]));
  }
  function compact(json) {
    const out = { at: Date.now(), w: [], r: [], p: [] };
    for (const e of json.elements || []) {
      if (e.center || e.type === "node") {
        const t = e.tags || {}, k = placeKind(t), lat = e.lat != null ? e.lat : e.center.lat, lon = e.lon != null ? e.lon : e.center.lon;
        if (!k || /^(private|no)$/.test(t.access || "")) continue;
        const x = {}; PLACE_EXTRA.forEach((key) => { if (t[key] != null) x[key] = String(t[key]).slice(0, 200); });
        out.p.push([e.type[0] + e.id, k, +lat.toFixed(5), +lon.toFixed(5), t.name || "", x]);
      } else if (e.type === "way" && e.geometry && e.geometry.length > 1) {
        const t = {}; KEEP_TAGS.forEach((k) => { if (e.tags && e.tags[k] != null) t[k] = e.tags[k]; });
        out.w.push({ id: e.id, t, g: e.geometry.map((p) => [+p.lat.toFixed(5), +p.lon.toFixed(5)]) });
      } else if (e.type === "relation") {
        const t = e.tags || {};
        out.r.push({ id: e.id, n: t.name || t.ref || "", t: { network: t.network, operator: t.operator, website: t.website, description: t.description, distance: t.distance, roundtrip: t.roundtrip },
          m: (e.members || []).filter((m) => m.type === "way").map((m) => m.ref) });
      }
    }
    out.p = nearTrails(out.p, out.w);
    return out;
  }
  const places = new Map();   // id -> { id, k, ll: [lat, lon], n, x }
  function absorbPlaces(list) { (list || []).forEach((p) => { if (PLACES[p[1]] && !places.has(p[0])) places.set(p[0], { id: p[0], k: p[1], ll: [p[2], p[3]], n: p[4], x: p[5] || {} }); }); }
  function absorb(j) {
    absorbPlaces(j.p);
    j.w.forEach((w) => ways.set(w.id, w));
    j.r.forEach((r) => {
      if (rels.has(r.id)) { const o = rels.get(r.id); o.m = [...new Set([...o.m, ...r.m])]; return; }
      rels.set(r.id, r);
    });
    relOf.clear();
    rels.forEach((r) => r.m.forEach((id) => { if (!relOf.has(id)) relOf.set(id, []); relOf.get(id).push(r.id); }));
  }
  async function loadTile(k, b) {
    tiles.set(k, "loading");
    let j = await cacheGet(k);
    if (!j) {
      try { j = compact(await ask(query(b))); cachePut(k, j); }
      catch { tiles.set(k, "error"); return false; }
    }
    absorb(j);
    tiles.set(k, "done");
    return true;
  }
  // The home zones (Vancouver to Calgary) come ready-made from the weekly job (data/hike-<zone>.json,
  // scripts/build-hike.mjs). Everywhere else: Overpass, one square at a time (two at most), nearest the middle of the
  // map first, at most MAX_SQ squares for a view, and a pause that grows after each failure (alex 2026-11-02: asked
  // live for dozens of squares at once, the server refused or queued them and the panel sat on "Finding…" for good).
  const MAX_SQ = 9, zoneFiles = new Map();   // zone id -> "loading" | "done" | "none"
  let queue = [], active = 0, fails = 0, pauseUntil = 0, pumpT = 0;
  const zoneAt = (lat, lon) => ((window.tfToday && window.tfToday.zones) || []).find((z) => z.bounds && z.bounds.contains([lat, lon]));
  function loadZone(z) {
    zoneFiles.set(z.id, "loading");
    nightly(`hike-${z.id}.json`).then((j) => {
      if (j && j.v === 1 && Array.isArray(j.w) && j.w.length) { absorb(j); zoneFiles.set(z.id, "done"); }
      else zoneFiles.set(z.id, "none");
    }).catch(() => zoneFiles.set(z.id, "none")).finally(() => { regroup(); loadView(); });
    nightly(`hike-places-${z.id}.json`).then((j) => { if (j && j.v === 1) { absorbPlaces(j.p); drawPlaces(); } }).catch(() => {});
  }
  const pending = () => active + queue.length + [...zoneFiles.values()].filter((v) => v === "loading").length;
  function pump() {
    clearTimeout(pumpT);
    if (!isHike()) return;
    const wait = pauseUntil - Date.now();
    if (wait > 0) { pumpT = setTimeout(pump, wait + 50); return; }
    while (active < 2 && queue.length) {
      const t = queue.shift();
      if (tiles.get(t.k) === "done" || tiles.get(t.k) === "loading") continue;
      active++;
      loadTile(t.k, t.b).then((ok) => {
        active--;
        if (ok) fails = 0;
        else { fails++; pauseUntil = Date.now() + Math.min(60000, 4000 * 2 ** Math.min(fails - 1, 4)); queue.unshift(t); }
        regroup(); pump();
      });
      if (fails) break;   // after a failure, one at a time
    }
  }
  function loadView() {
    if (!isHike()) return;
    if (map.getZoom() < MIN_ZOOM) { queue = []; renderList(); return; }
    const v = map.getBounds(), c = map.getCenter(), want = [];
    for (let s = Math.floor(v.getSouth() / T_LAT) * T_LAT; s < v.getNorth(); s += T_LAT)
      for (let w = Math.floor(v.getWest() / T_LON) * T_LON; w < v.getEast(); w += T_LON) {
        const k = tKey(s, w), mid = [s + T_LAT / 2, w + T_LON / 2];
        if (tiles.get(k) === "done") continue;
        const z = zoneAt(mid[0], mid[1]);
        if (z) {
          const st = zoneFiles.get(z.id);
          if (!st) loadZone(z);
          if (st !== "none") continue;   // the zone's file has it, or is on its way
        }
        want.push({ k, b: [s, w, s + T_LAT, w + T_LON], d: kmTo(mid, [c.lat, c.lng]) });
      }
    queue = want.sort((a, b) => a.d - b.d).slice(0, MAX_SQ);
    pump();
    renderList();
  }
  // ---------- ways into hikes ----------
  // A hike is a hiking route (a route=hiking relation: all its trails together) or the trail pieces that share a name
  // within about 2 km of each other. Paved city paths, sidewalks, lit paths and bike-park lines are left out.
  const FOOT_OK = /^(yes|designated|permissive)$/;
  function keepWay(w, inRel) {
    const t = w.t;
    if (/^(no|private)$/.test(t.foot || "")) return false;
    if (/^(no|private)$/.test(t.access || "") && !FOOT_OK.test(t.foot || "")) return false;
    if (/^(sidewalk|crossing|access_aisle|traffic_island)$/.test(t.footway || "")) return false;
    if (inRel || t.sac_scale) return true;
    if (/^(asphalt|concrete|paving_stones|paved|sett|concrete:plates|metal|unhewn_cobblestone|cobblestone)$/.test(t.surface || "")) return false;
    if (t.lit === "yes") return false;
    const bikeHeavy = +t["mtb:scale"] >= 3 || +t["mtb:scale:imba"] >= 3 || /downhill|freeride|bike ?park/i.test(t["mtb:type"] || "");
    if (bikeHeavy && !FOOT_OK.test(t.foot || "")) return false;
    return true;
  }
  const lenKm = (g) => { let k = 0; for (let i = 1; i < g.length; i++) k += kmTo(g[i - 1], g[i]); return k; };
  const bbOf = (g) => { let s = 90, w = 180, n = -90, e = -180; for (const p of g) { if (p[0] < s) s = p[0]; if (p[0] > n) n = p[0]; if (p[1] < w) w = p[1]; if (p[1] > e) e = p[1]; } return [s, w, n, e]; };
  const bbJoin = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
  const bbNear = (a, b, pad) => !(b[0] > a[2] + pad || b[2] < a[0] - pad || b[1] > a[3] + pad * 1.5 || b[3] < a[1] - pad * 1.5);
  const nameKey = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  let hikes = new Map(), loose = [];
  function regroup() {
    const next = new Map(), byName = new Map(), lo = [];
    const ids = [...ways.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const w = ways.get(id);
      const rs = (relOf.get(id) || []).map((r) => rels.get(r)).filter((r) => r && r.n).sort((a, b) => a.m.length - b.m.length);
      if (!keepWay(w, rs.length > 0)) continue;
      if (!w.km) { w.km = lenKm(w.g); w.bb = bbOf(w.g); }
      let h;
      if (rs.length) {
        const r = rs[0], k = "r" + r.id;
        h = next.get(k) || { id: k, name: r.n, rel: r, ways: [], bb: w.bb };
        next.set(k, h);
      } else if (w.t.name) {
        const nk = nameKey(w.t.name), list = byName.get(nk) || [];
        h = list.find((x) => bbNear(x.bb, w.bb, 0.02));
        if (!h) { h = { id: "w" + id, name: w.t.name, ways: [], bb: w.bb }; list.push(h); byName.set(nk, list); next.set(h.id, h); }
      } else { lo.push(w); continue; }
      h.ways.push(w); h.bb = bbJoin(h.bb, w.bb);
    }
    for (const h of next.values()) {
      h.km = h.ways.reduce((a, w) => a + w.km, 0);
      h.g = Math.max(...h.ways.map((w) => gradeOf(w.t)));
      h.shared = h.ways.some((w) => w.t["mtb:scale"] != null || w.t["mtb:scale:imba"] != null || w.t.bicycle === "designated");
      h.c = [(h.bb[0] + h.bb[2]) / 2, (h.bb[1] + h.bb[3]) / 2];
      const old = hikes.get(h.id);
      if (old && old.info) h.info = old.info;   // heights, snow and park already looked up
    }
    hikes = next; loose = lo;
    draw(); renderList();
    if (cur && hikes.has(cur.id)) { cur = hikes.get(cur.id); select(cur.id, true); }
    if (wantOpen && hikes.has(wantOpen)) { const id = wantOpen; wantOpen = null; openHike(id); }
  }

  // ---------- the map ----------
  map.createPane("hike").style.zIndex = 430;
  const rend = L.canvas({ pane: "hike", padding: 0.3, tolerance: L.Browser.touch ? 10 : 5 });
  const layer = L.layerGroup();
  const lines = new Map();   // hike id -> polyline
  let cur = null, wantOpen = null;
  const styleOf = (h, on, dim) => {
    const g = GRADES[h.g];
    return { color: g.c, weight: on ? 6 : 3.5, opacity: dim ? 0.45 : 0.95, dashArray: h.g === 4 ? "7 6" : null, lineCap: "round" };
  };
  function draw() {
    if (!isHike()) return;
    const seen = new Set();
    for (const h of hikes.values()) {
      seen.add(h.id);
      if (lines.has(h.id)) continue;
      const pl = L.polyline(h.ways.map((w) => w.g), { renderer: rend, pane: "hike", label: h.name, labelZoom: 13, ...styleOf(h, false, false) });
      pl.on("click", (e) => { if (e.originalEvent) L.DomEvent.stop(e); if (plan.on) { planAdd(e.latlng); return; } openHike(h.id); toPanel(); });
      if (!L.Browser.touch) pl.bindTooltip(esc(h.name), { sticky: true, direction: "top", opacity: 0.9 });
      lines.set(h.id, pl); layer.addLayer(pl);
    }
    for (const [id, pl] of lines) if (!seen.has(id)) { layer.removeLayer(pl); lines.delete(id); }
    looseLayer.clearLayers();
    if (loose.length) looseLayer.addLayer(L.polyline(loose.map((w) => w.g), { renderer: rend, pane: "hike", interactive: false, color: "#8d6e46", weight: 2, opacity: 0.6, dashArray: "2 5", lineCap: "round" }));
  }
  const looseLayer = L.layerGroup();
  function select(id, keep) {
    for (const [k, pl] of lines) {
      const h = hikes.get(k); if (!h) continue;
      pl.setStyle(styleOf(h, k === id, !!id && k !== id));
      if (k === id) pl.bringToFront();
    }
    if (!id) { cur = null; return; }
    if (!keep) cur = hikes.get(id) || null;
  }

  // ---------- places on the map ----------
  // Dots (Leaflet circle markers, so map3d.js copies them to 3D, names and taps included) from zoom 12, only in view.
  map.createPane("hikePlaces").style.zIndex = 450;
  const placeRend = L.canvas({ pane: "hikePlaces", padding: 0.3, tolerance: L.Browser.touch ? 12 : 6 });
  const placeLayer = L.layerGroup();
  const PLACE_ZOOM = 12;
  let curPlace = null;
  function drawPlaces() {
    placeLayer.clearLayers();
    if (!isHike() || map.getZoom() < PLACE_ZOOM) return;
    const v = map.getBounds().pad(0.25), z = map.getZoom();
    let n = 0;
    const order = ["need", "start", "see", "sleep"];   // huts drawn last, on top
    const list = [...places.values()].filter((p) => { const L1 = PLACES[p.k].layer; return L1 && shown.has(L1) && (L1 !== "need" || z >= 13) && v.contains(p.ll); })
      .sort((a, b) => order.indexOf(PLACES[a.k].layer) - order.indexOf(PLACES[b.k].layer));
    // Huts the clubs list (data/huts.json) that OpenStreetMap doesn't have: shown as huts of their own.
    if (shown.has("sleep")) {
      const osmHuts = [...places.values()].filter((p) => p.k === "hut" && p.id[0] !== "j");
      for (let i = list.length - 1; i >= 0; i--) if (list[i].id[0] === "j") list.splice(i, 1);
      clubHuts.forEach((c) => {
        if (!v.contains(c.ll) || osmHuts.some((p) => hutFor(p, [c.club]))) return;
        places.set(c.id, c); list.push(c);
      });
    }
    for (const p of list) {
      if (++n > 700) break;
      const k = PLACES[p.k], big = p.k === "hut" || p.k === "th";
      const m = L.circleMarker(p.ll, { renderer: placeRend, pane: "hikePlaces", radius: big ? 7 : 5.5, color: "#fff", weight: 2, fillColor: k.c, fillOpacity: 1,
        label: p.n && p.k !== "park" && p.k !== "wc" && p.k !== "water" ? p.n : undefined, labelZoom: p.k === "hut" ? 12 : 14 });
      m.on("click", (e) => { if (e.originalEvent) L.DomEvent.stop(e); if (plan.on) { planAdd(L.latLng(p.ll)); return; } openPlace(p.id); toPanel(); });
      if (!L.Browser.touch) m.bindTooltip(esc(p.n || k.label), { direction: "top", opacity: 0.9 });
      placeLayer.addLayer(m);
    }
    if (curPlace && v.contains(curPlace.ll)) placeLayer.addLayer(L.circleMarker(curPlace.ll, { renderer: placeRend, pane: "hikePlaces", radius: 11, color: ACC, weight: 3, fill: false, interactive: false }));
  }

  // ---------- hut facts (data/huts.json, the same file Skiing reads) ----------
  // Booking, price, beds, heat and water from the clubs and parks that run the huts.
  let hutsP = null, clubHuts = [];
  const hutKey = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(the|and|hut|huts|cabin|lodge|shelter|refuge|chalet)\b/g, "").replace(/[^a-z0-9]+/g, "");
  function loadHuts() {
    if (!hutsP) hutsP = getJ("data/huts.json").then((d) => {
      const list = (d && d.huts) || [];
      list.forEach((e) => { e.keys = [e.name, ...(e.aka || [])].map(hutKey).filter(Boolean); });
      clubHuts = list.filter((e) => e.lat != null).map((e) => ({ id: "j" + hutKey(e.name), k: "hut", ll: [e.lat, e.lon], n: e.name, x: { ...(e.tags || {}) }, club: e }));
      drawPlaces();
      return list;
    }).catch(() => []);
    return hutsP;
  }
  function hutFor(p, list) {
    const k = hutKey(p.n);
    let best = null, bestM = Infinity;
    for (const e of list) {
      if (e.lat == null) continue;
      const m = kmTo(p.ll, [e.lat, e.lon]) * 1000;
      const named = k && m < 5000 && e.keys.some((n) => n === k || (n.length >= 5 && k.length >= 5 && (n.includes(k) || k.includes(n))));
      if ((named || m < 250) && m < bestM) { best = e; bestM = m; }
    }
    return best;
  }

  // ---------- one place ----------
  const dirUrl = (ll) => `https://maps.apple.com/?daddr=${ll[0].toFixed(5)},${ll[1].toFixed(5)}`;
  // The hikes that pass within m metres of a point, nearest first.
  function hikesNear(ll, m) {
    const pad = m / 111000 + 0.002, out = [];
    for (const h of hikes.values()) {
      if (ll[0] < h.bb[0] - pad || ll[0] > h.bb[2] + pad || ll[1] < h.bb[1] - pad * 1.6 || ll[1] > h.bb[3] + pad * 1.6) continue;
      let d = Infinity;
      for (const w of h.ways) for (const p of w.g) { const k = kmTo(ll, p); if (k < d) d = k; }
      if (d * 1000 <= m) out.push({ h, d });
    }
    return out.sort((a, b) => a.d - b.d).map((x) => x.h);
  }
  function placeFacts(p) {
    const x = p.x || {}, out = [];
    if (x.ele) out.push(`${fmtM(+x.ele)} high`);
    if (x.height && p.k === "fall") out.push(`${x.height} m drop`);
    if (x.shelter_type) out.push(x.shelter_type.replace(/_/g, " "));
    if (x.capacity) out.push(`${x.capacity} ${p.k === "park" ? "spots" : "beds"}`);
    if (x.fee === "no") out.push("free"); else if (x.fee === "yes" || x.charge) out.push(x.charge ? x.charge : "fee");
    if (x.reservation === "required") out.push("must be booked");
    if (x.backcountry === "yes") out.push("backcountry");
    if (x.drinking_water === "no" && p.k !== "water") out.push("no drinking water");
    if (x.seasonal && x.seasonal !== "no") out.push(x.seasonal === "yes" ? "seasonal" : `seasonal (${x.seasonal})`);
    if (x.opening_hours) out.push(`open ${x.opening_hours}`);
    if (x.operator) out.push(x.operator);
    return out;
  }
  async function openPlace(id) {
    const p = places.get(id);
    if (!p) return;
    curPlace = p; drawPlaces();
    const el = $("hkPlace"), k = PLACES[p.k];
    const render = (club) => {
      const facts = placeFacts(p), t = club ? club.tags || {} : {};
      const near = hikesNear(p.ll, p.k === "park" || p.k === "th" ? 600 : 300).slice(0, 6);
      const book = t["reservation:website"] || (club && t.website) || p.x.website;
      el.innerHTML = `<header>${svg(p.k === "hut" ? IC.hut : IC.pin)}<h3>${esc(p.n || k.label)}</h3>${closeX("hkPlace")}</header>
        <div class="hk-row"><span class="hk-badge" style="--c:${k.c}">${esc(k.label)}</span></div>
        ${facts.length ? `<p class="hk-note">${facts.map(esc).join(" · ")}</p>` : ""}
        ${club ? `<div class="hk-warn ${t.reservation === "required" ? "bad" : ""}"><b>${t.reservation === "required" ? "Book before you go" : "Hut facts from the club"}</b><small>${[t.charge, t.capacity && `${t.capacity} beds`, t.heating && `heat: ${t.heating}`, t["drinking_water:note"] || (t.drinking_water === "no" ? "no drinking water" : ""), t["booking:note"], t.season].filter(Boolean).map(esc).join(" · ")}${club.src ? ` · <a href="${esc(club.src)}" target="_blank" rel="noopener">Source</a>` : ""}</small></div>` : ""}
        ${p.x.description ? `<p>${esc(p.x.description.slice(0, 260))}</p>` : ""}
        ${near.length ? `<h4>${p.k === "park" || p.k === "th" ? "Hikes from here" : "On these hikes"}</h4><ul class="hk-list">${near.map((h) => `<li><button type="button" data-hike="${esc(h.id)}"><span class="hk-dot" style="--c:${GRADES[h.g].c}"></span><b>${esc(h.name)}</b><small>${esc(subOf(h))}</small><em>›</em></button></li>`).join("")}</ul>` : ""}
        <div class="hk-row">
          <a class="hk-pill go" href="${dirUrl(p.ll)}" target="_blank" rel="noopener">${svg(IC.car, 16)}Directions</a>
          ${book ? `<a class="hk-pill" href="${esc(book)}" target="_blank" rel="noopener">${t["reservation:website"] ? "Book" : "Website"}</a>` : ""}
        </div>
        ${p.id[0] !== "j" ? `<p class="hk-note">On <a href="https://www.openstreetmap.org/${{ n: "node", w: "way", r: "relation" }[p.id[0]]}/${p.id.slice(1)}" target="_blank" rel="noopener">OpenStreetMap</a>.</p>` : ""}`;
    };
    render(p.club || null);
    showCard(el);
    if (p.k === "hut" && !p.club) { const list = await loadHuts(); const c = hutFor(p, list); if (c && curPlace === p) { p.club = c; render(c); } }
  }
  $("hkPlace").addEventListener("click", (e) => { const b = e.target.closest("[data-hike]"); if (b) openHike(b.dataset.hike, true); });

  // ---------- slope angle (the same terrain tiles as Hunting's) ----------
  const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/";
  const SLOPE_RGB = [[250, 204, 21], [240, 140, 0], [224, 49, 49]];
  const tileLat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  async function paintSlope(z, x, y) {
    const bmp = await fetch(`${DEM}${z}/${x}/${y}.png`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); }).then(createImageBitmap);
    const cv = document.createElement("canvas"); cv.width = cv.height = 256;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0, 256, 256);
    const px = cx.getImageData(0, 0, 256, 256).data, E = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) E[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    const out = new ImageData(256, 256), o = out.data, k = z >= 12 ? 1 : z === 11 ? 1.15 : z === 10 ? 1.4 : 1.8;
    for (let py = 0; py < 256; py++) {
      const lat = tileLat(y + (py + 0.5) / 256, z), m = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
      const y0 = py > 0 ? py - 1 : py, y1 = py < 255 ? py + 1 : py;
      for (let pxx = 0; pxx < 256; pxx++) {
        const i = py * 256 + pxx;
        if (E[i] < 0) continue;
        const x0 = pxx > 0 ? pxx - 1 : pxx, x1 = pxx < 255 ? pxx + 1 : pxx;
        const dzdx = (E[py * 256 + x1] - E[py * 256 + x0]) / ((x1 - x0) * m), dzdy = (E[y1 * 256 + pxx] - E[y0 * 256 + pxx]) / ((y1 - y0) * m);
        const sl = ((Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI) * k;
        const b = sl >= 45 ? 2 : sl >= 35 ? 1 : sl >= 25 ? 0 : -1;
        if (b < 0) continue;
        const c = SLOPE_RGB[b], j = i * 4;
        o[j] = c[0]; o[j + 1] = c[1]; o[j + 2] = c[2]; o[j + 3] = 115;
      }
    }
    return out;
  }
  const SlopeGrid = L.GridLayer.extend({
    createTile(c, done) {
      const cv = document.createElement("canvas"); cv.width = cv.height = 256;
      paintSlope(c.z, c.x, c.y).then((img) => { cv.getContext("2d").putImageData(img, 0, 0); done(null, cv); }, (e) => done(e, cv));
      return cv;
    },
  });
  map.createPane("hikeSlope").style.zIndex = 380;
  const slopeLayer = new SlopeGrid({ pane: "hikeSlope", minZoom: 9, maxNativeZoom: 14, maxZoom: 18, opacity: 1 });

  // ---------- the layers list ----------
  function renderLayers() {
    const z = map.getZoom();
    $("hkLayerList").innerHTML = LAYER_GROUPS.map((g) => `<p class="hk-group">${esc(g)}</p>` + Object.entries(LAYERS).filter(([, l]) => l.g === g).map(([k, l]) => {
      const ic = l.icon[1] === "dot" ? `border-radius:50%;background:${l.icon[0]};width:14px;height:14px;margin:4px;border:2px solid #fff;box-shadow:0 0 0 1px #0002` : l.icon[1] === "line" ? `background:linear-gradient(90deg,#2f9e44 0 33%,#1c7ed6 33% 66%,#e8590c 66%);height:6px;margin:8px 0;border-radius:3px` : `background:linear-gradient(135deg,#facc15,#f08c00,#e03131)`;
      const minZ = k === "trails" ? MIN_ZOOM : k === "slope" ? 9 : PLACE_ZOOM;
      return `<label class="hk-layer"><i class="hk-ic" style="${ic}"></i><span><b>${esc(l.label)}</b><small>${esc(l.sub)}${z < minZ ? `${l.sub ? " · " : ""}zoom in` : ""}</small></span><input type="checkbox" class="hk-sw" data-layer="${k}"${shown.has(k) ? " checked" : ""} aria-label="${esc(l.label)}"></label>`;
    }).join("")).join("");
  }
  $("hkLayerList").addEventListener("change", (e) => {
    const k = e.target.dataset.layer; if (!k) return;
    if (e.target.checked) shown.add(k); else shown.delete(k);
    store.set("hikeLayers", [...shown]);
    applyLayers();
  });
  function applyLayers() {
    const on = isHike();
    const want = (l, yes) => { if (yes && !map.hasLayer(l)) l.addTo(map); else if (!yes && map.hasLayer(l)) map.removeLayer(l); };
    want(layer, on && shown.has("trails")); want(looseLayer, on && shown.has("trails"));
    want(placeLayer, on); want(slopeLayer, on && shown.has("slope")); want(planLayer, on);
    if (!on && plan.on) setPlanning(false);
    if (on && shown.has("sleep")) loadHuts();
    drawPlaces(); renderLayers();
  }

  // ---------- hikes in view ----------
  let gradeOn = store.get("hikeGrades", []);
  function renderGrades() {
    $("hkGrades").innerHTML = `<button type="button" class="hk-pill${gradeOn.length ? "" : " on"}" data-g="all">All</button>` +
      GRADES.slice(1).map((g, i) => `<button type="button" class="hk-pill${gradeOn.includes(i + 1) ? " on" : ""}" data-g="${i + 1}"><span class="hk-dot" style="--c:${g.c}"></span>${esc(g.label)}</button>`).join("");
  }
  $("hkGrades").addEventListener("click", (e) => {
    const b = e.target.closest("[data-g]"); if (!b) return;
    if (b.dataset.g === "all") gradeOn = [];
    else { const g = +b.dataset.g; gradeOn = gradeOn.includes(g) ? gradeOn.filter((x) => x !== g) : [...gradeOn, g]; }
    store.set("hikeGrades", gradeOn);
    renderGrades(); renderList();
  });
  const inView = () => {
    const v = map.getBounds(), c = [map.getCenter().lat, map.getCenter().lng];
    return [...hikes.values()].filter((h) => h.km >= 0.3 && v.intersects(L.latLngBounds([h.bb[0], h.bb[1]], [h.bb[2], h.bb[3]])))
      .map((h) => ({ h, d: kmTo(h.c, c) })).sort((a, b) => a.d - b.d).map((x) => x.h);
  };
  const subOf = (h) => [GRADES[h.g].label, fmtKm(h.km) + " of trail", h.rel ? "hiking route" : "", h.shared ? "shared with bikes" : ""].filter(Boolean).join(" · ");
  function renderList() {
    if (!isHike()) return;
    const msg = $("hkMsg"), ul = $("hkList");
    if (map.getZoom() < MIN_ZOOM) {
      $("hkCount").textContent = "Hikes in view";
      msg.textContent = "Zoom in to a valley or a town to see its hikes.";
      ul.innerHTML = ""; return;
    }
    const all = inView(), list = gradeOn.length ? all.filter((h) => gradeOn.includes(h.g)) : all;
    $("hkCount").textContent = all.length ? `${all.length} hike${all.length > 1 ? "s" : ""} in view` : "Hikes in view";
    const left = pending();
    msg.textContent = left > 0 && fails && !all.length ? "OpenStreetMap's trail server is busy. Trying again…" : left > 0 ? (all.length ? "Finding more hiking trails…" : "Finding the hiking trails here…")
      : !all.length ? "No named hiking trails here on OpenStreetMap." : !list.length ? "None of that grade in view." : list.length > 40 ? "Nearest 40 shown: zoom in for the rest." : "";
    ul.innerHTML = list.slice(0, 40).map((h) => `<li><button type="button" data-hike="${esc(h.id)}"><span class="hk-dot" style="--c:${GRADES[h.g].c}"></span><b>${esc(h.name)}</b><small>${esc(subOf(h))}</small><em>${saved().some((s) => s.id === h.id) ? "★" : ""}</em></button></li>`).join("");
  }
  $("hkList").addEventListener("click", (e) => { const b = e.target.closest("[data-hike]"); if (b) openHike(b.dataset.hike, true); });
  function localHits(q) {
    const k = nameKey(q);
    if (k.length < 2) return [];
    // The name has the letters typed, or is one slip off ("garibaldy"): place-search.js slips.
    const P = window.tfPlaceSearch, slip = (n) => k.length >= 4 && P && P.slips && P.slips(k, n) >= 0;
    const all = [...hikes.values()], exact = all.filter((h) => nameKey(h.name).includes(k));
    return (exact.length ? exact : all.filter((h) => slip(nameKey(h.name)))).slice(0, 4)
      .map((h) => ({ name: h.name, sub: `Hike · ${GRADES[h.g].label} · ${fmtKm(h.km)}`, ic: "🥾", lat: h.c[0], lon: h.c[1], bb: null, zoom: 14, hike: h.id }));
  }

  // ---------- one hike ----------
  const ptKey = (p) => p[0].toFixed(5) + "," + p[1].toFixed(5);
  // Loop, one way or several branches, from how many trail ends are left once the pieces are joined.
  function shapeOf(h) {
    const n = new Map();
    h.ways.forEach((w) => [w.g[0], w.g[w.g.length - 1]].forEach((p) => { const k = ptKey(p); n.set(k, (n.get(k) || 0) + 1); }));
    const ends = [...n.entries()].filter(([, c]) => c % 2 === 1).map(([k]) => k.split(",").map(Number));
    return { kind: ends.length === 0 ? "loop" : ends.length === 2 ? "line" : "network", ends };
  }
  // The pieces in walking order (for the climb), when they join up end to end.
  function chain(h, sh) {
    const left = h.ways.map((w) => w.g.slice());
    let start = sh.kind === "line" ? sh.ends[0] : left[0][0];
    const line = [];
    let at = ptKey(start);
    while (left.length) {
      const i = left.findIndex((g) => ptKey(g[0]) === at || ptKey(g[g.length - 1]) === at);
      if (i < 0) return null;
      let g = left.splice(i, 1)[0];
      if (ptKey(g[0]) !== at) g = g.reverse();
      line.push(...(line.length ? g.slice(1) : g));
      at = ptKey(g[g.length - 1]);
    }
    return line;
  }
  function sample(line, n) {
    const d = [0];
    for (let i = 1; i < line.length; i++) d.push(d[i - 1] + kmTo(line[i - 1], line[i]));
    const tot = d[d.length - 1], out = [];
    for (let k = 0; k < n; k++) {
      const want = (tot * k) / (n - 1);
      let i = d.findIndex((x) => x >= want); if (i < 0) i = line.length - 1;
      out.push(line[i]);
    }
    return out;
  }
  async function heights(h) {
    const sh = shapeOf(h), ordered = sh.kind !== "network" && h.ways.length <= 60 ? chain(h, sh) : null;
    let pts;
    if (ordered && ordered.length > 1) pts = sample(ordered, Math.min(100, Math.max(2, ordered.length)));
    else { const all = h.ways.flatMap((w) => w.g); pts = sample(all, Math.min(100, Math.max(2, all.length))); }
    const q = `latitude=${pts.map((p) => p[0].toFixed(4)).join(",")}&longitude=${pts.map((p) => p[1].toFixed(4)).join(",")}`;
    const j = await getJ(`https://api.open-meteo.com/v1/elevation?${q}`);
    const el = j.elevation || [];
    if (!el.length) return null;
    let lo = Infinity, hi = -Infinity, hiAt = pts[0], loAt = pts[0];
    el.forEach((m, i) => { if (m < lo) { lo = m; loAt = pts[i]; } if (m > hi) { hi = m; hiAt = pts[i]; } });
    const out = { lo, hi, hiAt, loAt, kind: sh.kind, ends: sh.ends };
    if (ordered) {
      let up = 0, down = 0, last = el[0];
      for (let i = 1; i < el.length; i++) { const dd = el[i] - last; if (Math.abs(dd) >= 8) { if (dd > 0) up += dd; else down -= dd; last = el[i]; } }
      // One way: walked from the low end. A loop: walked as drawn.
      if (sh.kind === "line" && el[0] > el[el.length - 1]) [up, down] = [down, up];
      out.up = up; out.down = down;
      // The height profile, walked from the start (the low end of a one-way hike).
      out.prof = sh.kind === "line" && el[0] > el[el.length - 1] ? el.slice().reverse() : el.slice();
      out.start = sh.kind === "line" ? (el[0] <= el[el.length - 1] ? ordered[0] : ordered[ordered.length - 1]) : ordered[0];
    }
    return out;
  }
  async function snowTop(ht) {
    const q = new URLSearchParams({ latitude: ht.hiAt[0].toFixed(3), longitude: ht.hiAt[1].toFixed(3), elevation: Math.round(ht.hi), hourly: "snow_depth,temperature_2m,snowfall", daily: "sunset", forecast_days: "2", timezone: "auto" });
    const j = await getJ(`https://api.open-meteo.com/v1/forecast?${q}`);
    const w = j.hourly; if (!w) return null;
    const now = Date.now();
    let i = w.time.findIndex((x) => new Date(x).getTime() > now) - 1; if (i < 0) i = 0;
    const t24 = w.temperature_2m.slice(i, i + 24).filter((x) => x != null);
    return { snow: w.snow_depth[i] || 0, fall: w.snowfall.slice(i, i + 24).reduce((a, b) => a + (b || 0), 0), low: t24.length ? Math.min(...t24) : null, high: t24.length ? Math.max(...t24) : null, sunset: j.daily && j.daily.sunset && j.daily.sunset[0] };
  }

  // ---------- parks and passes ----------
  // The park a hike is in (OpenStreetMap's park outlines, asked at the hike's middle) and the pass or permit that park
  // asks for. The pass rules are kept short and point to the park's own page: they change every year.
  async function parksAt(ll) {
    const q = `[out:json][timeout:20];is_in(${ll[0].toFixed(5)},${ll[1].toFixed(5)})->.a;(area.a["boundary"~"^(national_park|protected_area)$"];area.a["leisure"="nature_reserve"];area.a["leisure"="park"]["operator"];);out tags;`;
    const j = await ask(q);
    return (j.elements || []).map((e) => e.tags || {}).filter((t) => t.name);
  }
  const PASSES = {
    pc: { name: "Parks Canada pass", what: "A daily admission per person or family, or a yearly Discovery Pass.", url: "https://parks.canada.ca/voyage-travel/admission" },
    bcday: { name: "BC Parks day-use pass", what: "Free, but booked online for some busy parks in summer (Joffre Lakes, Garibaldi, Golden Ears and a few others), from 7 am the day before.", url: "https://bcparks.ca/reservations/day-use-passes/" },
    bc: { name: "BC Parks", what: "No pass for most BC parks. A few busy ones need a free day-use pass in summer: check the park's page.", url: "https://bcparks.ca/reservations/day-use-passes/" },
    kan: { name: "Kananaskis Conservation Pass", what: "Needed for every vehicle parked in Kananaskis Country and the Bow Valley parks: daily or yearly.", url: "https://www.alberta.ca/kananaskis-conservation-pass" },
    sepaq: { name: "Sépaq access fee", what: "Quebec's parcs nationaux charge a daily access fee per person (free for children).", url: "https://www.sepaq.com/en/national-parks/access-fees" },
    on: { name: "Ontario Parks permit", what: "A daily vehicle permit for day use, bought online or at the gate.", url: "https://www.ontarioparks.ca/dayuse" },
    other: { name: "Park rules", what: "Check the park's own page for fees, permits and dogs.", url: "" },
  };
  const BC_DAY = /\b(joffre|garibaldi|golden ears|mount seymour|cypress)\b/i;
  function passFor(parks, ll) {
    for (const t of parks) {
      const n = t.name, op = String(t.operator || "");
      if (/parks canada|parcs canada/i.test(op) || /national park|parc national du canada|national park reserve/i.test(n) && !/^parc national (?!du canada)/i.test(n)) return { park: n, p: PASSES.pc };
      if (/s[ée]paq/i.test(op) || /^parc national (?!du canada)/i.test(n)) return { park: n, p: PASSES.sepaq };
      if (/bc parks/i.test(op) || (/provincial park|ecological reserve|protected area/i.test(n) && ll[1] < -114 && ll[0] > 48.2)) return { park: n, p: BC_DAY.test(n) ? PASSES.bcday : PASSES.bc };
      if (/alberta parks|kananaskis/i.test(op + " " + n) && ll[0] > 50.4 && ll[0] < 51.3 && ll[1] > -115.7 && ll[1] < -114.5) return { park: n, p: PASSES.kan };
      if (/ontario parks/i.test(op) || (/provincial park/i.test(n) && ll[1] > -95.2 && ll[1] < -74.3 && ll[0] > 41.6)) return { park: n, p: PASSES.on };
    }
    if (ll[0] > 50.4 && ll[0] < 51.3 && ll[1] > -115.7 && ll[1] < -114.5 && parks.length) return { park: parks[0].name, p: PASSES.kan };
    return parks.length ? { park: parks[0].name, p: PASSES.other } : null;
  }

  // ---------- closures, warnings and wildfires near a hike ----------
  const nightly = (f) => (window.tfToday && window.tfToday.nightly ? window.tfToday.nightly(f) : getJ(`data/${f}`));
  let closeP = null, firesP = null;
  // BC Parks advisories that matter on a trail (not camping, permits, dogs or surveys).
  const BC_TYPES = /^(wildlife|park access|public safety|trail closure|wildfire|wildfire damage|trail conditions|hazard conditions|bridge outage|winter conditions|access restricted|hazard trees|flood|flood damage|landslide|area closure|rockfall hazard|trail construction|trail maintenance|private land)/i;
  const BC_SKIP = /permit|leash|dogs?\b|commercial|\bbats?\b|survey|monitoring|volunteer|campground|campsite|reservation|drone/i;
  async function warningsNear(h) {
    if (!closeP) closeP = nightly("closures.json").catch(() => { closeP = null; return null; });
    if (!firesP) firesP = Promise.all(["fires.json", "fires-ca.json"].map((f) => nightly(f).catch(() => null))).then((fs) => fs.flatMap((f) => (f && f.fires) || []));
    const [d, fires] = await Promise.all([closeP, firesP]), c = h.c, out = [];
    const mine = new Set(h.ways.map((w) => nameKey(w.t.name)).concat(nameKey(h.name)).filter(Boolean));
    if (d) {
      (d.ab || []).forEach((a) => {
        if (!a.c || kmTo(a.c, c) > 15) return;
        (a.trails || []).filter((r) => mine.has(nameKey(r.n)) && !/^open$/i.test(r.st || "")).forEach((r) => out.push({ bad: /closed/i.test(r.st), text: `${r.n}: ${r.st}`, sub: r.warn ? r.warn.split("\n")[0].slice(0, 160) : "", url: r.url || a.url, src: "Alberta Parks" }));
        (a.closures || []).slice(0, 4).forEach((x) => out.push({ bad: true, text: x, url: a.url, src: `Alberta Parks, ${a.name}` }));
        if (a.note) out.push({ text: `${a.name} trail report`, sub: a.note.slice(0, 220) + (a.note.length > 220 ? "…" : ""), url: a.url, src: a.updated ? `Updated ${a.updated}` : "Alberta Parks" });
      });
      (d.bc || []).forEach((a) => {
        const p = (a.parks || []).find((x) => x.c && kmTo(x.c, c) <= 10);
        if (p && BC_TYPES.test(a.type || "") && !BC_SKIP.test(a.title || "")) out.push({ bad: a.closed || /closure/i.test(a.type), text: a.title, sub: p.name, url: p.url, src: "BC Parks" });
      });
      (d.pc || []).forEach((b) => { if (b.c && kmTo(b.c, c) <= 35 && /closure|closed|warning|restriction|bear|wildlife/i.test(b.title)) out.push({ bad: /closure|closed/i.test(b.title), text: b.title, sub: b.park, url: b.url, src: "Parks Canada" }); });
      (d.on || []).forEach((a) => { if (a.c && kmTo(a.c, c) <= 15) out.push({ bad: a.closed, text: a.title, sub: a.park, url: a.url, src: "Ontario Parks" }); });
    }
    (fires || []).forEach((f) => {
      if (f.lat == null || /^out$/i.test(f.st || "")) return;
      const k = kmTo([f.lat, f.lon], c);
      if (k <= 25) out.push({ bad: /out of control/i.test(f.st || "") && k <= 10, text: `Wildfire ${Math.round(k)} km away${f.name ? `: ${f.name}` : ""}`, sub: [f.st, f.ha ? `${f.ha} ha` : ""].filter(Boolean).join(" · "), src: "Wildfire report" });
    });
    const seen = new Set();
    return out.filter((w) => { const k = w.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (b.bad ? 1 : 0) - (a.bad ? 1 : 0)).slice(0, 8);
  }

  // ---------- what the trail's operator says (data/trail-info.json "hikes") ----------
  // alex 2026-11-03: anything found about a trail beyond OpenStreetMap goes on the trail (the Sea to Sky Gondola's
  // trails: difficulty, length, time, what it's like). An entry fits a hike with one of its names within r metres.
  let tInfo = null;
  const loadTInfo = () => (tInfo = tInfo || fetch("data/trail-info.json?v=2600").then((r) => r.json()).catch(() => { tInfo = null; return null; }));
  const fold = (x) => String(x || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  function operatorFacts(h) {
    const j = tInfo && tInfo.then ? null : tInfo;
    if (!j || !j.hikes) return [];
    const names = new Set([h.name, ...h.ways.map((w) => w.t.name)].filter(Boolean).map(fold));
    const mid = h.c || [(h.bb[0] + h.bb[2]) / 2, (h.bb[1] + h.bb[3]) / 2];
    return j.hikes.filter((e) => { const sr = j.src[e.s] || {}; return e.n.some((n) => names.has(fold(n))) && kmTo(e.c || sr.c, mid) * 1000 <= (e.r || sr.r || 3000); })
      .map((e) => ({ ...e, src: j.src[e.s] }));
  }
  // ---------- the hike card ----------
  function openHike(id, fly) {
    const h = hikes.get(id);
    if (!h) return;
    cur = h; select(id);
    if (fly) map.fitBounds(L.latLngBounds([h.bb[0], h.bb[1]], [h.bb[2], h.bb[3]]), { padding: [30, 30], maxZoom: 15 });
    $("hkSnow").hidden = $("hkPasses").hidden = true;
    renderHike();
    showCard($("hkHike"));
    if (!tInfo || tInfo.then) Promise.resolve(loadTInfo()).then((j) => { tInfo = j; renderHike(h); });
    if (!h.info || (h.info.ht === null && Date.now() - h.info.at > 20000)) {
      h.info = { at: Date.now(), ht: "loading", top: "loading", park: "loading", warn: "loading" };
      heights(h).then((ht) => { h.info.ht = ht; renderHike(h); if (ht) return snowTop(ht).then((s) => { h.info.top = s; }); h.info.top = null; })
        .catch(() => { if (h.info.ht === "loading") h.info.ht = null; h.info.top = null; }).finally(() => renderHike(h));
      parksAt(h.c).then((ps) => { h.info.park = passFor(ps, h.c); }).catch(() => { h.info.park = "error"; }).finally(() => renderHike(h));
      warningsNear(h).then((w) => { h.info.warn = w; }).catch(() => { h.info.warn = []; }).finally(() => renderHike(h));
    }
  }
  function renderHike(only) {
    const h = cur, el = $("hkHike");
    if (!h || (only && only.id !== h.id)) return;
    const g = GRADES[h.g], i = h.info || {}, ht = i.ht, sh = ht && ht.kind ? ht.kind : shapeOf(h).kind, isSaved = saved().some((s) => s.id === h.id);
    const tags = h.ways.map((w) => w.t), first = (k) => (tags.find((t) => t[k]) || {})[k] || (h.rel && h.rel.t[k]) || "";
    const surf = [...new Set(tags.map((t) => t.surface).filter(Boolean))].slice(0, 3).join(", ").replace(/_/g, " ");
    const shapeWord = { loop: "Loop", line: "One way", network: "Several branches" }[sh];
    let heightHtml = "";
    if (ht === "loading") heightHtml = `<p class="hk-note">Working out the heights…</p>`;
    else if (ht === null && i.ht !== undefined) heightHtml = `<p class="hk-note">Heights and the snow at the top aren't available right now${navigator.onLine ? " (the weather service is busy): close and open the hike again in a minute" : " (no signal)"}.</p>`;
    else if (ht) {
      const time = ht.up != null ? h.km / 4 + ht.up / 500 : null;
      heightHtml = `<p>${svg(IC.peak, 14)} From <b>${fmtM(ht.lo)}</b> to <b>${fmtM(ht.hi)}</b>${ht.up != null ? ` · up ${fmtM(ht.up)}${sh === "line" ? " from the low end" : ""}` : ""}</p>
        ${time != null ? `<p>About <b>${fmtH(time)}</b> ${sh === "loop" ? "for the loop" : "one way"} <span class="hk-note">(4 km/h plus 1 h for every 500 m up; add breaks)</span></p>` : `<p class="hk-note">Several branches: pick your way on the map for a time.</p>`}
        ${ht.prof && ht.prof.length > 3 ? profileSvg(ht.prof, h.km) : ""}`;
    }
    let topHtml = "";
    const top = i.top;
    if (ht && top === "loading") topHtml = `<p class="hk-note">Checking the snow at the top…</p>`;
    else if (ht && top) {
      const cm = Math.round(top.snow * 100), cold = top.low != null && top.low <= 0;
      const cls = cm >= 10 || top.fall >= 5 ? "bad" : cm >= 1 || top.fall >= 1 || cold ? "" : "ok";
      const say = cm >= 1 ? `About ${cm} cm of snow at the top (${fmtM(ht.hi)}) now` : top.fall >= 1 ? `${Math.round(top.fall)} cm of snow coming at the top in the next day` : `No snow at the top (${fmtM(ht.hi)})`;
      topHtml = `<div class="hk-warn ${cls}">${svg(IC.snow, 14)} <b>${esc(say)}</b><small>${top.low != null ? `Next 24 h up there: ${Math.round(top.low)} to ${Math.round(top.high)}°C${cold ? ", ice likely in the shade" : ""}` : ""}${top.sunset ? ` · sunset ${hm(top.sunset)}` : ""} · weather model, not a trail report</small></div>`;
    }
    let parkHtml = "";
    const pk = i.park;
    if (pk === "loading") parkHtml = `<p class="hk-note">Checking which park it's in…</p>`;
    else if (pk && pk !== "error") parkHtml = `<div class="hk-warn">${svg(IC.pass, 14)} <b>${esc(pk.park)}</b><small><b>${esc(pk.p.name)}:</b> ${esc(pk.p.what)}${pk.p.url ? ` <a href="${esc(pk.p.url)}" target="_blank" rel="noopener">Check</a>` : ""}</small></div>`;
    else if (pk === null) parkHtml = `<p class="hk-note">Not in a park on the map: no pass needed that we know of. Watch for private land and posted signs.</p>`;
    let warnHtml = "";
    if (i.warn === "loading") warnHtml = `<p class="hk-note">Checking closures and wildfires nearby…</p>`;
    else if (i.warn && i.warn.length) warnHtml = i.warn.map((w) => `<div class="hk-warn ${w.bad ? "bad" : ""}"><b>${esc(w.text)}</b><small>${[w.sub, w.src].filter(Boolean).map(esc).join(" · ")}${w.url ? ` · <a href="${esc(w.url)}" target="_blank" rel="noopener">More</a>` : ""}</small></div>`).join("");
    else if (i.warn) warnHtml = `<p class="hk-note">No closures or wildfires reported near it. Parks post new ones often: check before you go.</p>`;
    const start0 = ht && ht.start ? ht.start : ht && ht.loAt ? ht.loAt : h.ways[0].g[0];
    const st = startPlace(h, start0), start = st ? st.ll : start0;
    const along = alongHike(h);
    const web = first("website");
    el.innerHTML = `<header>${svg(IC.boot)}<h3>${esc(h.name)}</h3><button type="button" class="hk-x" data-save="${esc(h.id)}" aria-label="${isSaved ? "Remove from Saved" : "Save this hike"}" title="${isSaved ? "Saved: tap to remove" : "Save this hike"}" style="${isSaved ? `color:#f59f00` : ""}">${svg(IC.star, 16)}</button>${closeX("hkHike")}</header>
      <div class="hk-row"><span class="hk-badge" style="--c:${g.c}">${esc(g.label)}</span><span class="hk-fact">${fmtKm(h.km)}</span><span class="hk-fact">${esc(shapeWord)}</span>${h.shared ? `<span class="hk-fact">Shared with bikes</span>` : ""}</div>
      <p class="hk-note">${esc(g.sub)}${h.g ? " (the hardest part)" : ""}${surf ? ` · ${esc(surf)}` : ""}${tags.some((t) => /^(bad|horrible|no)$/.test(t.trail_visibility || "")) ? " · path hard to see in places" : ""}</p>
      ${first("description") ? `<p>${esc(String(first("description")).slice(0, 300))}</p>` : ""}
      ${operatorFacts(h).slice(0, 1).map((e) => `<div class="hk-warn">${svg(IC.boot, 14)} <b>${esc([e.level, e.km && `${e.km} km`].filter(Boolean).join(" · ") || "About this trail")}</b><small>${esc(e.text)} <a href="${esc(e.src.url)}" target="_blank" rel="noopener">${esc(e.src.name)}</a></small></div>`).join("")}
      ${heightHtml}${topHtml}
      ${st ? `<p>${svg(IC.pin, 14)} Start at <b>${esc(st.n || PLACES[st.k].label)}</b>${st.n ? ` <span class="hk-note">(${esc(PLACES[st.k].label.toLowerCase())})</span>` : ""}</p>` : ""}
      ${along.length ? `<h4>Along the way</h4><ul class="hk-along">${along.map((p) => `<li><span class="hk-dot" style="--c:${PLACES[p.k].c}"></span><span><b>${esc(p.n || PLACES[p.k].label)}</b> <small>${esc([p.n ? PLACES[p.k].label : "", p.x && p.x.ele ? fmtM(+p.x.ele) : ""].filter(Boolean).join(" · "))}</small></span></li>`).join("")}</ul>` : ""}
      <h4>Park and pass</h4>${parkHtml}
      <h4>Closures and warnings</h4>${warnHtml}
      <div class="hk-row">
        <button type="button" class="hk-pill go" data-hk="start">${svg(IC.play, 16)}Start hike</button>
        <a class="hk-pill" href="${dirUrl(start)}" target="_blank" rel="noopener">${svg(IC.car, 16)}Drive to the start</a>
        <button type="button" class="hk-pill" data-hk="zoom">${svg(IC.zoom, 16)}Show all of it</button>
        ${web ? `<a class="hk-pill" href="${esc(web)}" target="_blank" rel="noopener">Website</a>` : ""}
      </div>
      <p class="hk-note">${h.rel ? "Hiking route" : "Trail"} on <a href="https://www.openstreetmap.org/${h.rel ? "relation/" + h.rel.id : "way/" + h.ways[0].id}" target="_blank" rel="noopener">OpenStreetMap</a>. Wrong or missing? You can fix it there.</p>`;
  }
  // A small height profile (SVG): distance along, height up.
  function profileSvg(el, km) {
    const W = 320, H = 76, lo = Math.min(...el), hi = Math.max(...el), span = Math.max(50, hi - lo);
    const x = (i) => 28 + (i / (el.length - 1)) * (W - 34), y = (m) => 6 + (1 - (m - lo) / span) * (H - 22);
    const pts = el.map((m, i) => `${x(i).toFixed(1)},${y(m).toFixed(1)}`).join(" ");
    return `<svg class="hk-prof" viewBox="0 0 ${W} ${H}" role="img" aria-label="Height profile: ${Math.round(lo)} to ${Math.round(hi)} m">
      <polygon points="${x(0)},${H - 16} ${pts} ${x(el.length - 1)},${H - 16}" fill="${ACC}" opacity=".18"/><polyline points="${pts}" fill="none" stroke="${ACC}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <text x="0" y="12">${Math.round(hi)}</text><text x="0" y="${H - 18}">${Math.round(lo)}</text><text x="28" y="${H - 3}">0</text><text x="${W - 6}" y="${H - 3}" text-anchor="end">${esc(fmtKm(km))}</text></svg>`;
  }
  // The trailhead or parking nearest the hike's start (within 1.5 km), a trailhead winning a near tie.
  function startPlace(h, ll) {
    let best = null, bd = Infinity;
    for (const p of places.values()) {
      if (p.k !== "th" && p.k !== "park") continue;
      if (Math.abs(p.ll[0] - ll[0]) > 0.02 || Math.abs(p.ll[1] - ll[1]) > 0.03) continue;
      const d = kmTo(p.ll, ll) - (p.k === "th" ? 0.15 : 0) - (p.n ? 0.05 : 0);
      if (d < bd && d <= 1.5) { best = p; bd = d; }
    }
    return best;
  }
  // Huts, campsites, viewpoints, waterfalls, summits and water within about 250 m of the hike.
  function alongHike(h) {
    const pad = 0.004, out = [];
    for (const p of places.values()) {
      if (!/^(hut|camp|view|fall|peak|water)$/.test(p.k)) continue;
      if (p.ll[0] < h.bb[0] - pad || p.ll[0] > h.bb[2] + pad || p.ll[1] < h.bb[1] - pad * 1.6 || p.ll[1] > h.bb[3] + pad * 1.6) continue;
      let d = Infinity;
      for (const w of h.ways) { for (const q of w.g) { const k = kmTo(p.ll, q); if (k < d) d = k; } if (d < 0.25) break; }
      if (d < 0.25 && !out.some((o) => o.k === p.k && o.n && o.n === p.n)) out.push(p);
    }
    const rank = { hut: 0, camp: 1, peak: 2, view: 3, fall: 4, water: 5 };
    return out.sort((a, b) => rank[a.k] - rank[b.k]).slice(0, 10);
  }
  $("hkHike").addEventListener("click", (e) => {
    const s = e.target.closest("[data-save]");
    if (s) { toggleSave(cur); renderHike(); renderList(); return; }
    const b = e.target.closest("[data-hk]"); if (!b || !cur) return;
    if (b.dataset.hk === "zoom") map.fitBounds(L.latLngBounds([cur.bb[0], cur.bb[1]], [cur.bb[2], cur.bb[3]]), { padding: [30, 30], maxZoom: 15 });
    else if (b.dataset.hk === "start" && window.tfRide) { if (window.tfRide.follow) window.tfRide.follow(cur.ways.map((w) => w.g), cur.name); else window.tfRide.start(); }
  });

  // ---------- saved hikes ----------
  const saved = () => store.get("hikeSaved", []);
  function toggleSave(h) {
    if (!h) return;
    const list = saved();
    if (list.some((s) => s.id === h.id)) { if (window.tfAccount && window.tfAccount.gone) window.tfAccount.gone("hikeSaved", h.id); store.set("hikeSaved", list.filter((s) => s.id !== h.id)); }
    else store.set("hikeSaved", [{ id: h.id, n: h.name, c: h.c, bb: h.bb, km: +h.km.toFixed(2), g: h.g, at: Date.now() }, ...list].slice(0, 200));
    if (!$("hkSaved").hidden) renderSaved();
  }
  function renderSaved() {
    const list = saved();
    $("hkSaved").innerHTML = `<header>${svg(IC.star)}<h3>Saved hikes</h3>${closeX("hkSaved")}</header>
      ${list.length ? `<ul class="hk-list">${list.map((s) => `<li><button type="button" data-open="${esc(s.id)}"><span class="hk-dot" style="--c:${GRADES[s.g || 0].c}"></span><b>${esc(s.n)}</b><small>${esc(GRADES[s.g || 0].label)} · ${fmtKm(s.km)}</small><em>›</em></button></li>`).join("")}</ul>`
        : `<p class="hk-note">Tap a hike on the map, then ☆ on its card to keep it here for later.</p>`}
      <h4>Planned hikes</h4>
      ${plans().length ? `<ul class="hk-list">${plans().map((r) => `<li><button type="button" data-plan="${esc(r.id)}"><span class="hk-dot" style="--c:${ACC}"></span><b>${esc(r.n)}</b><small>${fmtKm(r.km)}${r.up ? ` · ${fmtM(r.up)} up` : ""} · ${esc(new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</small><em>›</em></button></li>`).join("")}</ul>`
        : `<p class="hk-note">Tap Plan, then points on the map: the route follows the trails. Save it and it's here.</p>`}
      <button type="button" class="hk-pill" data-log="1">${svg(IC.log, 16)}My hikes (recorded)</button>`;
    showCard($("hkSaved"));
  }
  $("hkSaved").addEventListener("click", (e) => {
    if (e.target.closest("[data-log]")) { openLog(); return; }
    const pb = e.target.closest("[data-plan]");
    if (pb) { const r = plans().find((x) => x.id === pb.dataset.plan); if (r) loadPlan(r); return; }
    const b = e.target.closest("[data-open]"); if (!b) return;
    const s = saved().find((x) => x.id === b.dataset.open); if (!s) return;
    map.fitBounds(L.latLngBounds([s.bb[0], s.bb[1]], [s.bb[2], s.bb[3]]), { padding: [30, 30], maxZoom: 15 });
    if (hikes.has(s.id)) openHike(s.id); else wantOpen = s.id;
  });

  // ---------- my hikes (tracks recorded in Hiking, same database as ride.html) ----------
  function loadHikes() {
    return new Promise((resolve) => {
      let r;
      try { r = indexedDB.open("trail-finder-rides", 1); } catch { resolve([]); return; }
      r.onupgradeneeded = () => { const db = r.result; db.createObjectStore("rides", { keyPath: "id" }); db.createObjectStore("photos", { keyPath: "id" }).createIndex("rideId", "rideId"); db.createObjectStore("current", { keyPath: "id" }); };
      r.onerror = () => resolve([]);
      r.onsuccess = () => {
        const db = r.result;
        try {
          const q = db.transaction("rides").objectStore("rides").getAll();
          q.onsuccess = () => { db.close(); resolve((q.result || []).filter((x) => x.sport === "hike").sort((a, b) => b.start - a.start)); };
          q.onerror = () => { db.close(); resolve([]); };
        } catch { db.close(); resolve([]); }
      };
    });
  }
  async function openLog() {
    const el = $("hkLog");
    el.innerHTML = `<header>${svg(IC.log)}<h3>My hikes</h3>${closeX("hkLog")}</header><p class="hk-note">Loading…</p>`;
    toPanel(); showCard(el);
    const list = await loadHikes();
    const tot = list.reduce((a, r) => ({ d: a.d + ((r.stats && r.stats.dist) || 0), c: a.c + ((r.stats && r.stats.climb) || 0) }), { d: 0, c: 0 });
    el.innerHTML = `<header>${svg(IC.log)}<h3>My hikes</h3>${closeX("hkLog")}</header>
      ${list.length ? `<p class="hk-note">${list.length} hike${list.length > 1 ? "s" : ""} · ${fmtKm(tot.d / 1000)} · ${fmtM(tot.c)} up</p>
        <ul class="hk-list">${list.slice(0, 60).map((r) => `<li><button type="button" data-ride="${esc(r.id)}"><span class="hk-dot" style="--c:${ACC}"></span><b>${esc(r.title || "Hike")}</b><small>${esc(new Date(r.start).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))}${r.stats ? ` · ${fmtKm(r.stats.dist / 1000)}${r.stats.climb ? ` · ${fmtM(r.stats.climb)} up` : ""}` : ""}</small><em>›</em></button></li>`).join("")}</ul>`
        : `<p class="hk-note">No hikes yet. Tap Start hike on a hike, or the Hike tab, and the map follows you and records your track.</p>`}
      <div class="hk-row"><button type="button" class="hk-pill go" data-hk="rec">${svg(IC.play, 16)}Start hike</button></div>`;
  }
  $("hkLog").addEventListener("click", (e) => {
    const r = e.target.closest("[data-ride]");
    if (r) { location.href = "ride.html#ride/" + r.dataset.ride; return; }
    if (e.target.closest('[data-hk="rec"]') && window.tfRide) window.tfRide.start();
  });

  // ---------- the weather here, the snow line ----------
  // Open-Meteo at the middle of the map: the next 3 days, with the freezing level at noon. The snow line is about 300 m
  // under the freezing level.
  const wxCache = new Map();
  let wx = null, wxT = 0;
  async function loadWx() {
    if (!isHike()) return;
    const c = map.getCenter(), k = `${c.lat.toFixed(1)},${c.lng.toFixed(1)}`, got = wxCache.get(k);
    if (got && Date.now() - got.at < 30 * 60000) { wx = got; renderNow(); return; }
    try {
      const q = new URLSearchParams({ latitude: c.lat.toFixed(2), longitude: c.lng.toFixed(2), current: "temperature_2m,precipitation,weather_code", hourly: "freezing_level_height",
        daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,snowfall_sum,sunset", forecast_days: "3", timezone: "auto" });
      const j = await getJ(`https://api.open-meteo.com/v1/forecast?${q}`);
      const days = (j.daily.time || []).map((d, i) => {
        const at = j.hourly.time.findIndex((t) => t === `${d}T12:00`);
        const fl = at >= 0 ? j.hourly.freezing_level_height[at] : null;
        return { d, max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i], pop: j.daily.precipitation_probability_max[i], rain: j.daily.precipitation_sum[i], snow: j.daily.snowfall_sum[i], sunset: j.daily.sunset[i], line: fl == null ? null : Math.max(0, Math.round((fl - 300) / 100) * 100) };
      });
      wx = { at: Date.now(), k, cur: j.current, days, elev: j.elevation };
      wxCache.set(k, wx);
    } catch { wx = null; }
    renderNow();
  }
  const lineWord = (m) => (m == null ? "" : m < 200 ? "snow down to the valley" : `snow above about ${m.toLocaleString()} m`);
  function renderNow() {
    const b = $("hkNow");
    if (!wx || !wx.days.length) { b.hidden = true; return; }
    const d = wx.days[0], t = wx.cur ? Math.round(wx.cur.temperature_2m) : Math.round(d.max);
    b.hidden = false;
    b.innerHTML = `<span>${svg(IC.sun, 15)}<b>${t}°C here</b></span>${d.pop != null ? `<span>Rain ${d.pop}%</span>` : ""}${d.line != null ? `<span>${svg(IC.snow, 15)}${esc(lineWord(d.line))}</span>` : ""}${d.sunset ? `<span>Sunset ${hm(d.sunset)}</span>` : ""}`;
    if (!$("hkSnow").hidden) renderSnow();
  }
  function renderSnow() {
    const el = $("hkSnow");
    if (!wx) { el.innerHTML = `<header>${svg(IC.snow)}<h3>Snow line</h3>${closeX("hkSnow")}</header><p class="hk-note">${navigator.onLine ? "Getting the forecast…" : "No signal: the forecast needs a connection."}</p>`; return; }
    const day = (s, i) => (i === 0 ? "Today" : new Date(s + "T12:00:00").toLocaleDateString(undefined, { weekday: "short" }));
    el.innerHTML = `<header>${svg(IC.snow)}<h3>Snow line, next 3 days</h3>${closeX("hkSnow")}</header>
      <div class="hk-days">${wx.days.map((d, i) => `<div><b>${esc(day(d.d, i))}</b><span>${d.line == null ? "–" : d.line < 200 ? "Valley" : `${d.line.toLocaleString()} m`}</span><small>${Math.round(d.min)} to ${Math.round(d.max)}°C</small><small>${d.snow >= 0.5 ? `${Math.round(d.snow)} cm snow` : d.pop != null ? `rain ${d.pop}%` : ""}</small></div>`).join("")}</div>
      <p class="hk-note">Around the middle of the map (the valley here is about ${fmtM(wx.elev || 0)}). Above the snow line, expect snow on the trail and bring microspikes. Snow already on the ground can stay well below it into early summer: tap a hike for the snow at its top. Weather: Open-Meteo.</p>`;
  }

  // ---------- plan a hike ----------
  // Points tapped on the map; the route between them along footpaths and hiking trails (Valhalla pedestrian routing,
  // max_hiking_difficulty from the grade picked: OpenStreetMap's sac_scale 1-6), with heights every 30 m along it.
  const VALHALLA = "https://valhalla1.openstreetmap.de";
  const UPTO = [{ k: 2, label: "Moderate" }, { k: 3, label: "Hard" }, { k: 6, label: "Expert" }];
  const plan = { on: false, pts: [], route: null, busy: false, err: "", seq: 0, name: "", id: null };
  const plans = () => store.get("hikePlans", []);
  map.createPane("hikePlan").style.zIndex = 460;
  const planRend = L.canvas({ pane: "hikePlan", padding: 0.3 });
  const planLayer = L.layerGroup();
  const decode6 = (str) => {
    let i = 0, lat = 0, lon = 0; const out = [];
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b, shift = 0, res = 0;
        do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const d = res & 1 ? ~(res >> 1) : res >> 1;
        if (k === 0) lat += d; else lon += d;
      }
      out.push([lat / 1e6, lon / 1e6]);
    }
    return out;
  };
  function setPlanning(on) {
    plan.on = on;
    document.body.classList.toggle("hk-planning", on);
    if (on) { toPanel(); renderPlan(); showCard($("hkPlan")); if (map.getZoom() < 12) map.setZoom(13); }
    else { $("hkPlan").hidden = true; }
    pane.querySelectorAll('[data-act="plan"]').forEach((b) => b.classList.toggle("on", on));
    drawPlan();
  }
  map.on("click", (e) => { if (isHike() && plan.on) planAdd(e.latlng); });
  // On the map while planning (the phone sheet drops when the map is tapped): the total so far, Undo and Done.
  const planBar = document.createElement("div");
  planBar.id = "hkPlanBar"; planBar.setAttribute("role", "status");
  document.body.append(planBar);
  planBar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pb]"); if (!b) return;
    if (b.dataset.pb === "undo") { plan.pts.pop(); plan.id = null; routePlan(); drawPlan(); }
    else { setPlanning(false); renderPlan(); showCard($("hkPlan")); toPanel(); }
  });
  function renderBar() {
    const r = plan.route;
    planBar.innerHTML = `<span>${plan.busy ? "Finding the way…" : plan.err ? esc(plan.err) : r ? `<b>${fmtKm(r.km)}</b> · up ${fmtM(r.up)} · about ${fmtH(r.km / 4 + r.up / 500)}` : plan.pts.length ? "Now tap where you want to go" : "Tap the map where you start"}</span>
      ${plan.pts.length ? `<button type="button" data-pb="undo">Undo</button>` : ""}<button type="button" class="go" data-pb="done">Done</button>`;
  }
  function planAdd(ll) {
    plan.pts.push([+ll.lat.toFixed(5), +ll.lng.toFixed(5)]);
    plan.id = null;
    drawPlan(); routePlan();
  }
  // When the route server is busy, down or out of reach (go-public checklist item 17: valhalla1.openstreetmap.de is a
  // volunteer server that doesn't allow heavy app traffic), the route is found on the phone along the hiking trails
  // already loaded for the map (the weekly zone files, or the Overpass squares kept a week), shortest way with a small
  // extra cost for climbing, and only on trails up to the grade picked. Heights come from Open-Meteo when there's signal.
  const nodeKey = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  function localRoute(pts, upto) {
    const G = new Map();   // key -> [[key, metres, point]...]
    const at = new Map();  // key -> [lat, lon]
    const link = (a, b) => {
      const ka = nodeKey(a), kb = nodeKey(b), d = kmTo(a, b) * 1000;
      if (ka === kb) return;
      at.set(ka, a); at.set(kb, b);
      if (!G.has(ka)) G.set(ka, []); if (!G.has(kb)) G.set(kb, []);
      G.get(ka).push([kb, d]); G.get(kb).push([ka, d]);
    };
    ways.forEach((w) => {
      if (/^(private|no)$/.test(w.t.access || "") || /^(private|no)$/.test(w.t.foot || "")) return;
      if (upto < 6 && gradeOf(w.t) > upto) return;
      for (let i = 1; i < w.g.length; i++) link(w.g[i - 1], w.g[i]);
    });
    if (!G.size) return null;
    const snapTo = (p) => {
      let best = null, bd = 300;   // within 300 m of a loaded trail
      at.forEach((q, k) => { const d = kmTo(p, q) * 1000; if (d < bd) { bd = d; best = k; } });
      return best;
    };
    const keys = pts.map(snapTo);
    if (keys.some((k) => !k)) return { far: true };
    const line = [];
    for (let i = 1; i < keys.length; i++) {
      const from = keys[i - 1], to = keys[i];
      const dist = new Map([[from, 0]]), prev = new Map(), heap = [[0, from]];
      const push = (x) => { heap.push(x); let j = heap.length - 1; while (j) { const u = (j - 1) >> 1; if (heap[u][0] <= heap[j][0]) break; [heap[j], heap[u]] = [heap[u], heap[j]]; j = u; } };
      const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let j = 0; for (;;) { const l = 2 * j + 1, r = l + 1; let m = j; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === j) break; [heap[j], heap[m]] = [heap[m], heap[j]]; j = m; } } return top; };
      while (heap.length) {
        const [d, k] = pop();
        if (k === to) break;
        if (d > dist.get(k)) continue;
        for (const [n, m] of G.get(k) || []) {
          const nd = d + m;
          if (nd < (dist.has(n) ? dist.get(n) : Infinity)) { dist.set(n, nd); prev.set(n, k); push([nd, n]); }
        }
      }
      if (!dist.has(to)) return { gap: true };
      const leg = [];
      for (let k = to; k; k = prev.get(k)) { leg.push(at.get(k)); if (k === from) break; }
      leg.reverse();
      line.push(...(line.length ? leg.slice(1) : leg));
    }
    if (line.length < 2) return { gap: true };
    let km = 0;
    for (let i = 1; i < line.length; i++) km += kmTo(line[i - 1], line[i]);
    return { line, km };
  }
  // Heights every ~30 m along a line found on the phone (at most 300 points, Open-Meteo's 90 m terrain).
  async function heightsOf(line, km) {
    const n = Math.min(300, Math.max(2, Math.round((km * 1000) / 30))), pts = sample(line, n), el = [];
    for (let k = 0; k < pts.length; k += 100) {
      const part = pts.slice(k, k + 100);
      const j = await getJ(`https://api.open-meteo.com/v1/elevation?latitude=${part.map((p) => p[0].toFixed(4)).join(",")}&longitude=${part.map((p) => p[1].toFixed(4)).join(",")}`);
      el.push(...(j.elevation || []));
    }
    return el.length === pts.length ? el : [];
  }
  async function routePlan() {
    const seq = ++plan.seq;
    plan.err = "";
    if (plan.pts.length < 2) { plan.route = null; renderPlan(); drawPlan(); return; }
    plan.busy = true; renderPlan();
    const upto = store.get("hikeUpto", 3);
    try {
      const r = await fetch(`${VALHALLA}/route`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: timeout(40000),
        body: JSON.stringify({ locations: plan.pts.map((p) => ({ lat: p[0], lon: p[1], radius: 60 })), costing: "pedestrian",
          costing_options: { pedestrian: { max_hiking_difficulty: upto, use_hills: 0.5, walkway_factor: 1.5, sidewalk_factor: 2, use_tracks: 0.6 } },
          elevation_interval: 30, directions_options: { units: "kilometers", language: "en-US" } }) });
      const j = await r.json();
      if (seq !== plan.seq) return;
      if (!r.ok || !j.trip) throw new Error((j && j.error) || `HTTP ${r.status}`);
      const line = [], el = [];
      j.trip.legs.forEach((leg) => { const g = decode6(leg.shape); line.push(...(line.length ? g.slice(1) : g)); (leg.elevation || []).forEach((m) => el.push(m)); });
      let up = 0, down = 0, last = el[0];
      for (let i = 1; i < el.length; i++) { const d = el[i] - last; if (Math.abs(d) >= 8) { if (d > 0) up += d; else down -= d; last = el[i]; } }
      let hi = -Infinity, hiAt = line[0];
      if (el.length) { const k = el.indexOf(Math.max(...el)); hi = el[k]; hiAt = line[Math.min(line.length - 1, Math.round((k / Math.max(1, el.length - 1)) * (line.length - 1)))]; }
      plan.route = { line, el, km: j.trip.summary.length, up, down, hi, hiAt, top: "loading" };
      if (el.length) snowTop({ hi, hiAt }).then((t) => { if (plan.route && plan.route.line === line) { plan.route.top = t; renderPlan(); } }).catch(() => { if (plan.route) plan.route.top = null; renderPlan(); });
    } catch (e) {
      if (seq !== plan.seq) return;
      plan.route = null;
      const noPath = /no path|no suitable edges|unreachable|disconnected/i.test(String(e.message));
      const loc = noPath ? null : localRoute(plan.pts, upto);
      if (loc && loc.line) {
        const { line, km } = loc;
        let el = [];
        try { el = await heightsOf(line, km); } catch {}
        if (seq !== plan.seq) return;
        let up = 0, down = 0, last = el[0];
        for (let i = 1; i < el.length; i++) { const d = el[i] - last; if (Math.abs(d) >= 8) { if (d > 0) up += d; else down -= d; last = el[i]; } }
        let hi = -Infinity, hiAt = line[0];
        if (el.length) { const k = el.indexOf(Math.max(...el)); hi = el[k]; hiAt = line[Math.min(line.length - 1, Math.round((k / Math.max(1, el.length - 1)) * (line.length - 1)))]; }
        plan.route = { line, el, km, up, down, hi, hiAt, top: el.length ? "loading" : null, local: true };
        if (el.length) snowTop({ hi, hiAt }).then((t) => { if (plan.route && plan.route.line === line) { plan.route.top = t; renderPlan(); } }).catch(() => { if (plan.route) plan.route.top = null; renderPlan(); });
      } else {
        plan.err = noPath || (loc && loc.gap) ? "No trail joins those points at this grade: move a point onto a trail, or allow harder trails."
          : loc && loc.far ? "Put each point on or near a trail on the map."
          : !navigator.onLine ? "No signal, and no trails saved here yet: zoom in while you have signal, or save an offline map."
          : "The route server is busy: tap Undo then add the point again in a moment.";
      }
    } finally {
      if (seq === plan.seq) { plan.busy = false; renderPlan(); drawPlan(); }
    }
  }
  function drawPlan() {
    planLayer.clearLayers();
    if (!isHike()) return;
    if (plan.route) {
      planLayer.addLayer(L.polyline(plan.route.line, { renderer: planRend, pane: "hikePlan", color: "#fff", weight: 9, opacity: 0.9, interactive: false }));
      planLayer.addLayer(L.polyline(plan.route.line, { renderer: planRend, pane: "hikePlan", color: "#d6336c", weight: 5, opacity: 1, interactive: false, lineCap: "round" }));
    }
    if (plan.on || plan.route) plan.pts.forEach((p, i) => planLayer.addLayer(L.circleMarker(p, { renderer: planRend, pane: "hikePlan", radius: i === 0 ? 8 : 6, color: "#fff", weight: 2, fillColor: i === 0 ? "#2f9e44" : "#d6336c", fillOpacity: 1, interactive: false })));
  }
  function renderPlan() {
    renderBar();
    const el = $("hkPlan"), r = plan.route, upto = store.get("hikeUpto", 3);
    const head = `<header>${svg(IC.plan)}<h3>Plan a hike</h3>${closeX("hkPlan")}</header>`;
    const chips = `<div class="hk-row" role="group" aria-label="Trails up to">${UPTO.map((u) => `<button type="button" class="hk-pill${u.k === upto ? " on" : ""}" data-upto="${u.k}">Up to ${esc(u.label.toLowerCase())}</button>`).join("")}</div>`;
    let body = "";
    if (!plan.pts.length) body = `<p class="hk-note">${plan.on ? "Tap the map where you start, then where you want to go. The route follows the footpaths and hiking trails." : "Tap Plan to start."}</p>`;
    else if (plan.pts.length === 1) body = `<p class="hk-note">Start set. Now tap where you want to go (a summit, a lake, a hut).</p>`;
    if (plan.busy) body += `<p class="hk-note">Finding the way along the trails…</p>`;
    if (plan.err) body += `<div class="hk-warn bad"><b>${esc(plan.err)}</b></div>`;
    if (r) {
      const time = r.km / 4 + r.up / 500, t = r.top;
      body += `<div class="hk-row"><span class="hk-fact">${fmtKm(r.km)}</span><span class="hk-fact">up ${fmtM(r.up)}</span><span class="hk-fact">down ${fmtM(r.down)}</span><span class="hk-fact">about ${fmtH(time)}</span></div>
        ${r.el.length > 3 ? profileSvg(r.el, r.km) : ""}
        ${r.hi > -Infinity ? `<p class="hk-note">Highest point ${fmtM(r.hi)}. Time: 4 km/h plus 1 h for every 500 m up; add breaks.</p>` : ""}
        ${t === "loading" ? `<p class="hk-note">Checking the snow at the top…</p>` : t ? `<div class="hk-warn ${t.snow >= 0.1 ? "bad" : t.snow > 0 || t.fall >= 1 ? "" : "ok"}">${svg(IC.snow, 14)} <b>${t.snow >= 0.01 ? `About ${Math.round(t.snow * 100)} cm of snow at the top now` : t.fall >= 1 ? `${Math.round(t.fall)} cm of snow coming at the top` : "No snow at the top"}</b>${t.sunset ? `<small>Sunset ${hm(t.sunset)}</small>` : ""}</div>` : ""}
        <label class="hk-note" style="display:flex;gap:6px;align-items:center">Name <input id="hkPlanName" maxlength="60" value="${esc(plan.name)}" placeholder="My hike" style="flex:1;font:inherit;padding:6px 8px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--fg)"></label>`;
    }
    const btns = `<div class="hk-row">
      ${plan.pts.length ? `<button type="button" class="hk-pill" data-pl="undo">Undo</button><button type="button" class="hk-pill" data-pl="loop">Back to the start</button><button type="button" class="hk-pill" data-pl="clear">Clear</button>` : ""}
      ${r ? `<button type="button" class="hk-pill go" data-pl="save">${svg(IC.star, 16)}${plan.id ? "Saved" : "Save"}</button><button type="button" class="hk-pill go" data-pl="follow">${svg(IC.play, 16)}Follow it</button><button type="button" class="hk-pill" data-pl="gpx">GPX file</button>` : ""}
      ${plan.on ? "" : `<button type="button" class="hk-pill" data-pl="edit">Add points</button>`}${plan.id ? `<button type="button" class="hk-pill" data-pl="del">Delete</button>` : ""}</div>`;
    el.innerHTML = head + chips + body + btns + `<p class="hk-note">${r && r.local ? "<span>Found on your phone along the trails on the map (the route server didn't answer).</span> <span>Check the route on the map: a path on the map isn't always a trail on the ground.</span>" : "Routing: Valhalla on OpenStreetMap. Check the route on the map: a path on the map isn't always a trail on the ground."}</p>`;
  }
  $("hkPlan").addEventListener("input", (e) => { if (e.target.id === "hkPlanName") plan.name = e.target.value; });
  $("hkPlan").addEventListener("click", (e) => {
    const u = e.target.closest("[data-upto]");
    if (u) { store.set("hikeUpto", +u.dataset.upto); routePlan(); return; }
    const b = e.target.closest("[data-pl]"); if (!b) return;
    const a = b.dataset.pl;
    if (a === "undo") { plan.pts.pop(); plan.id = null; routePlan(); drawPlan(); }
    else if (a === "clear") { plan.pts = []; plan.route = null; plan.id = null; plan.name = ""; plan.seq++; plan.busy = false; plan.err = ""; renderPlan(); drawPlan(); }
    else if (a === "loop" && plan.pts.length > 1) planAdd(L.latLng(plan.pts[0]));
    else if (a === "edit") setPlanning(true);
    else if (a === "save") savePlan();
    else if (a === "follow" && plan.route && window.tfRide && window.tfRide.follow) { setPlanning(false); window.tfRide.follow([plan.route.line], plan.name || "your hike"); }
    else if (a === "gpx") gpxOut();
    else if (a === "del" && plan.id) {
      if (window.tfAccount && window.tfAccount.gone) window.tfAccount.gone("hikePlans", plan.id);
      store.set("hikePlans", plans().filter((x) => x.id !== plan.id));
      plan.pts = []; plan.route = null; plan.id = null; plan.name = ""; renderPlan(); drawPlan();
      if (!$("hkSaved").hidden) renderSaved();
    }
  });
  function savePlan() {
    const r = plan.route; if (!r) return;
    const id = plan.id || "p" + Date.now().toString(36);
    const n = (plan.name || "").trim() || `Hike of ${fmtKm(r.km)}`;
    const keep = r.line.filter((p, i) => i % 2 === 0 || i === r.line.length - 1).map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]);
    const item = { id, n, pts: plan.pts, line: keep, km: +r.km.toFixed(2), up: Math.round(r.up), at: Date.now() };
    store.set("hikePlans", [item, ...plans().filter((x) => x.id !== id)].slice(0, 100));
    plan.id = id; plan.name = n;
    renderPlan();
    if (!$("hkSaved").hidden) renderSaved();
  }
  function loadPlan(r) {
    plan.pts = r.pts.slice(); plan.name = r.n; plan.err = "";
    plan.route = { line: r.line, el: [], km: r.km, up: r.up || 0, down: 0, hi: -Infinity, hiAt: r.line[0], top: null };
    plan.id = r.id;
    plan.on = false; document.body.classList.remove("hk-planning");
    map.fitBounds(L.latLngBounds(r.line), { padding: [30, 30], maxZoom: 15 });
    renderPlan(); showCard($("hkPlan")); drawPlan();
    routePlan().then(() => { plan.id = r.id; renderPlan(); });   // fresh heights and snow
  }
  function gpxOut() {
    const r = plan.route; if (!r) return;
    const n = plan.name || "Hike";
    const x = (s) => esc(s);
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Trail Finder" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${x(n)}</name></metadata><trk><name>${x(n)}</name><trkseg>${r.line.map((p) => `<trkpt lat="${p[0]}" lon="${p[1]}"/>`).join("")}</trkseg></trk></gpx>`;
    const file = `${n.replace(/[^\w\- ]+/g, "").trim() || "hike"}.gpx`;
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    try {
      const f = new File([blob], file, { type: "application/gpx+xml" });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f], title: n }).catch(() => {}); return; }
    } catch {}
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  // ---------- where to hike today ----------
  // The hikes (1 to 40 km) within 25 km of the middle of the map, nearest 24: the highest point of each (Open-Meteo
  // elevation, 8 points spread along it), the snow on the ground and the weather up there now (Open-Meteo, one ask for
  // all of them) and the closures and wildfires near each (warningsNear). Snow-free and open first, then snow up high,
  // then the ones to check first. Kept 30 minutes.
  let todaySeq = 0;
  const todayCache = new Map();   // hike id -> { at, hi, snow, t, pop, warn }
  async function openToday() {
    const el = $("hkToday"), seq = ++todaySeq;
    const head = `<header>${svg(IC.today)}<h3>Where to hike today</h3>${closeX("hkToday")}</header>`;
    showCard(el);
    if (map.getZoom() < MIN_ZOOM) { el.innerHTML = head + `<p class="hk-note">Zoom in to a valley or a town: Today ranks the hikes around the middle of the map.</p>`; return; }
    const c = [map.getCenter().lat, map.getCenter().lng];
    const list = [...hikes.values()].filter((h) => h.km >= 1 && h.km <= 40).map((h) => ({ h, d: kmTo(h.c, c) })).filter((x) => x.d <= 25)
      .sort((a, b) => a.d - b.d).slice(0, 24).map((x) => x.h);
    if (!list.length) { el.innerHTML = head + `<p class="hk-note">${pending() > 0 ? "Still finding the hikes here: try again in a moment." : "No hikes of 1 km or more near the middle of the map."}</p>`; return; }
    el.innerHTML = head + `<p class="hk-note">Checking the snow and weather at the top of ${list.length} hikes near here…</p>`;
    const todo = list.filter((h) => { const t = todayCache.get(h.id); return !t || Date.now() - t.at > 30 * 60000; });
    try {
      if (todo.length) {
        const pts = [];
        todo.forEach((h, i) => { const all = h.ways.flatMap((w) => w.g); sample(all, Math.min(8, Math.max(2, all.length))).forEach((p) => pts.push({ i, p })); });
        const el2 = [];
        for (let k = 0; k < pts.length; k += 100) {
          const part = pts.slice(k, k + 100);
          const j = await getJ(`https://api.open-meteo.com/v1/elevation?latitude=${part.map((x) => x.p[0].toFixed(4)).join(",")}&longitude=${part.map((x) => x.p[1].toFixed(4)).join(",")}`);
          el2.push(...(j.elevation || []));
        }
        const tops = todo.map(() => ({ hi: -Infinity, at: null }));
        pts.forEach((x, k) => { const m = el2[k]; if (m != null && m > tops[x.i].hi) { tops[x.i].hi = m; tops[x.i].at = x.p; } });
        const ok = tops.map((t, i) => ({ t, h: todo[i] })).filter((x) => x.t.at);
        const q = new URLSearchParams({ latitude: ok.map((x) => x.t.at[0].toFixed(3)).join(","), longitude: ok.map((x) => x.t.at[1].toFixed(3)).join(","), elevation: ok.map((x) => Math.round(x.t.hi)).join(","),
          hourly: "snow_depth,temperature_2m", daily: "precipitation_probability_max", forecast_days: "1", timezone: "auto" });
        let wxs = await getJ(`https://api.open-meteo.com/v1/forecast?${q}`);
        if (!Array.isArray(wxs)) wxs = [wxs];
        const warns = await Promise.all(ok.map((x) => warningsNear(x.h).catch(() => [])));
        ok.forEach((x, i) => {
          const w = wxs[i] || {}, hr = w.hourly || { time: [] };
          let at = hr.time.findIndex((t) => new Date(t).getTime() > Date.now()) - 1; if (at < 0) at = 0;
          todayCache.set(x.h.id, { at: Date.now(), hi: x.t.hi, snow: hr.snow_depth ? hr.snow_depth[at] || 0 : null, t: hr.temperature_2m ? hr.temperature_2m[at] : null,
            pop: w.daily && w.daily.precipitation_probability_max ? w.daily.precipitation_probability_max[0] : null, warn: warns[i] || [] });
        });
      }
    } catch {
      if (seq !== todaySeq) return;
      if (!list.some((h) => todayCache.has(h.id))) { el.innerHTML = head + `<p class="hk-note">${navigator.onLine ? "The weather service is busy: tap Today again in a minute." : "No signal: Today needs a connection."}</p>`; return; }
    }
    if (seq !== todaySeq) return;
    renderToday(list, head);
  }
  function renderToday(list, head) {
    const rows = list.map((h) => ({ h, t: todayCache.get(h.id) })).filter((x) => x.t);
    const state = ({ t }) => (t.warn.some((w) => w.bad) ? "check" : t.snow != null && t.snow >= 0.1 ? "snow" : "good");
    const groups = { good: [], snow: [], check: [] };
    rows.forEach((r) => groups[state(r)].push(r));
    const c = [map.getCenter().lat, map.getCenter().lng];
    Object.values(groups).forEach((g) => g.sort((a, b) => kmTo(a.h.c, c) - kmTo(b.h.c, c)));
    const row = ({ h, t }) => {
      const cm = t.snow != null ? Math.round(t.snow * 100) : null, bad = t.warn.find((w) => w.bad);
      const bits = [GRADES[h.g].label, fmtKm(h.km), `top ${fmtM(t.hi)}`, cm >= 1 ? `${cm} cm snow up top` : cm === 0 ? "no snow" : "", t.t != null ? `${Math.round(t.t)}°C up top` : "", t.pop >= 50 ? `rain ${t.pop}%` : "",
        bad ? bad.text : ""].filter(Boolean);
      return `<li><button type="button" data-hike="${esc(h.id)}"><span class="hk-dot" style="--c:${GRADES[h.g].c}"></span><b>${esc(h.name)}</b><small>${esc(bits.join(" · "))}</small><em>${fmtKm(kmTo(h.c, c))}</em></button></li>`;
    };
    const sec = (k, title, color, sub) => groups[k].length ? `<p class="hk-today-h" style="color:${color}">${esc(title)} (${groups[k].length})</p>${sub ? `<p class="hk-note">${esc(sub)}</p>` : ""}<ul class="hk-list">${groups[k].slice(0, 12).map(row).join("")}</ul>` : "";
    const d = wx && wx.days[0];
    $("hkToday").innerHTML = head
      + (d ? `<p class="hk-note">Here today: ${Math.round(d.min)} to ${Math.round(d.max)}°C${d.pop != null ? `, rain ${d.pop}%` : ""}${d.line != null ? `, ${esc(lineWord(d.line))}` : ""}${d.sunset ? `, sunset ${hm(d.sunset)}` : ""}</p>` : "")
      + sec("good", "Good today: no snow up top, nothing closed", "#2f9e44", "")
      + sec("snow", "Snow up high", "#1c7ed6", "Microspikes and poles, or wait for the melt. Snow from a weather model, not a trail report.")
      + sec("check", "Check first", "#c92a2a", "A closure, warning or wildfire is reported near these: tap one for the details.")
      + `<p class="hk-note">Nearest ${list.length} hikes within 25 km of the middle of the map. Move the map and tap Today again for another area.</p>`;
  }
  $("hkToday").addEventListener("click", (e) => { const b = e.target.closest("[data-hike]"); if (b) openHike(b.dataset.hike, true); });

  // ---------- passes (all of Canada) ----------
  function renderPasses() {
    const list = [PASSES.pc, PASSES.bcday, PASSES.kan, PASSES.sepaq, PASSES.on];
    $("hkPasses").innerHTML = `<header>${svg(IC.pass)}<h3>Parks and passes in Canada</h3>${closeX("hkPasses")}</header>
      ${list.map((p) => `<div class="hk-warn"><b>${esc(p.name)}</b><small>${esc(p.what)} <a href="${esc(p.url)}" target="_blank" rel="noopener">Check</a></small></div>`).join("")}
      <p class="hk-note">Tap a hike and its card says which park it's in and the pass it needs. Rules and prices change every season: the park's own page is the final word.</p>`;
  }

  // ---------- buttons ----------
  pane.querySelector(".hk-actions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const a = b.dataset.act;
    if (a === "today") { if (!wx) loadWx(); openToday(); }
    else if (a === "list") showCard($("hkListCard"));
    else if (a === "snow") { renderSnow(); showCard($("hkSnow")); if (!wx) loadWx(); }
    else if (a === "pass") { renderPasses(); showCard($("hkPasses")); }
    else if (a === "plan") { setPlanning(!plan.on || $("hkPlan").hidden); }
    else if (a === "saved") renderSaved();
  });
  $("hkNow").addEventListener("click", () => { renderSnow(); showCard($("hkSnow")); });
  $("hkPassBtn").addEventListener("click", () => { renderPasses(); showCard($("hkPasses")); });

  // ---------- for other scripts ----------
  window.tfHike = {
    openLog,
    hub(what) {   // index.html's Saved page: My hikes, Saved hikes
      const t = document.querySelector('#tabbar [data-nav="hike"]');
      if (phone() && t && t.getAttribute("aria-current") !== "true") t.click();
      if (what === "log") openLog(); else if (what === "saved") renderSaved(); else if (what === "today") openToday(); else if (what === "plan") setPlanning(true);
    },
  };

  // ---------- switching sport ----------
  let moveT = 0;
  map.on("moveend", () => {
    if (!isHike()) return;
    renderList(); drawPlaces(); renderLayers();
    clearTimeout(moveT);
    moveT = setTimeout(() => { loadView(); loadWx(); }, 600);
  });
  function sync() {
    const on = isHike();
    applyLayers();
    if (!on) return;
    renderGrades(); draw(); renderList(); loadView(); loadWx();
  }
  window.addEventListener("tf:sport", sync);
  sync();
})();
