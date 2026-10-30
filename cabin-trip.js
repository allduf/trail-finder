// Plan a cabin trip (Skiing). alex 2026-10-30: "we should have feature 'plan a cabin trip' in skiing", then picked
// the core first: the cabin and the dates, the way in, the conditions for each day of the trip, and saving it all for
// when there's no signal.
//  - "🏕 Plan a cabin trip here" on a hut's card (winter.js select) opens the trip card: the night you go in, how many
//    nights, how many people, and what's known about the cabin (its tags: beds, price, booking, who runs it, links;
//    the huts thread fills the same tags from the clubs' own pages).
//  - The way in: the easiest walk from a parking lot (or a road) to the cabin, worked out by fish-route.js (the same
//    search as Fishing's Route, with the ski routes added as trails; a logging road counts as a start but costs more,
//    as most aren't plowed). Then its heights and slopes (ski-terrain.js): km, climb, Munter time in and out, steepest,
//    30°+ slopes, steep slopes above, the terrain class. "Show on map" opens it as a tour, with the route card's
//    Conditions, Avalanche check, Flyover, GPX and Go. "Draw my own" uses Plan a tour.
//  - Each day of the trip: the avalanche danger on the way in (Avalanche Canada, about 3 days ahead) with the
//    Avaluator light for the way in's terrain, and the weather at the cabin (Open-Meteo, about a week ahead); the snow
//    and wind in the 3 days before you go in.
//  - Save offline: the map, ski data and terrain around the cabin and the way in (offline.js), and the forecast as it
//    is now is kept with the trip and shown when there's no signal.
//  - Then (alex picked them 2026-10-30): day tours from the cabin (mapped tours within 1.5 km, ★ the ones you plan),
//    a packing list built from the trip (nights, people, what the cabin has, the coldest night, the way in's slopes),
//    and a trip plan to leave with a friend, with a late alert for their calendar at the "call for help" time.
// Trips are kept in tf:skiTrips, saved to the rider's account when signed in (account.js merges both devices' trips).
(() => {
  "use strict";
  const map = window.tfLeaflet, S = window.tfSki && window.tfSki.trip, T = window.tfTerrain;
  if (!map || !window.L || !S || !T) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isSki = () => document.body.classList.contains("sport-ski");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {   // "tf:setting" tells account.js to save the trips to the rider's account
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const COL = "#7048e8";   // the way in on the map and the trip card's colour
  const localDate = (d) => d.toLocaleDateString("en-CA");
  const addDays = (date, n) => { const d = new Date(date + "T12:00"); d.setDate(d.getDate() + n); return localDate(d); };
  const dayWord = (date) => new Date(date + "T12:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
  const fmtM = (m) => Math.round(m).toLocaleString() + " m";
  const fmtH = (h) => (h < 0.75 ? `${Math.max(15, Math.round((h * 60) / 15) * 15)} min` : `${Math.round(h * 2) / 2} h`);
  const deg = (v) => (v == null ? "–" : `${Math.round(v) === 0 ? 0 : Math.round(v)}°`);

  const css = document.createElement("style");
  css.textContent = `
#skiPane .sk-trip { border: 1.5px solid ${COL}; background: color-mix(in srgb, ${COL} 5%, var(--panel)); }
#skiPane .sk-trip h3 { display: flex; gap: 6px; align-items: baseline; }
#skiPane .sk-trip h3 small { font-weight: 600; color: var(--muted); font-size: .78rem; }
#skiPane .tp-form { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 6px; }
#skiPane .tp-form label { display: flex; flex-direction: column; gap: 2px; font-size: .7rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); min-width: 0; }
#skiPane .tp-form input { font: inherit; font-size: .9rem; padding: 7px 6px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); min-width: 0; width: 100%; box-sizing: border-box; }
#skiPane .tp-step { display: flex; align-items: center; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); overflow: hidden; }
#skiPane .tp-step button { font: inherit; font-size: 1rem; font-weight: 800; border: 0; background: none; color: var(--fg); width: 30px; height: 34px; cursor: pointer; flex: none; }
#skiPane .tp-step b { flex: 1; text-align: center; font-size: .95rem; color: var(--fg); text-transform: none; letter-spacing: 0; }
#skiPane .tp-facts { display: flex; flex-wrap: wrap; gap: 4px; }
#skiPane .tp-facts span, #skiPane .tp-facts a { font-size: .76rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--chip); color: var(--fg); text-decoration: none; border: 1px solid var(--line); }
#skiPane .tp-facts a { color: #1f5fe0; }
#skiPane .tp-facts .warn { background: color-mix(in srgb, #f08c00 18%, var(--panel)); border-color: #f08c00; }
#skiPane .tp-way { display: flex; flex-direction: column; gap: 4px; }
#skiPane .tp-stats { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: .86rem; }
#skiPane .tp-stats b { font-size: 1rem; }
#skiPane .tp-days { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
#skiPane .tp-days li { border: 1px solid var(--line); border-left: 6px solid var(--c, var(--line)); border-radius: 10px; padding: 6px 9px; display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; font-size: .8rem; background: var(--panel); }
#skiPane .tp-days li > b { font-size: .88rem; }
#skiPane .tp-days li > .tp-wx { grid-row: span 2; text-align: right; font-size: .8rem; line-height: 1.35; }
#skiPane .tp-days li > .tp-wx big { font-size: 1.05rem; font-weight: 800; }
#skiPane .tp-days li > span { color: var(--fg); }
#skiPane .tp-days li > small { grid-column: 1 / -1; color: var(--muted); }
#skiPane .tp-btns { display: flex; flex-wrap: wrap; gap: 6px; }
#skiPane .tp-btns > * { font: inherit; font-size: .84rem; font-weight: 800; padding: 9px 12px; border-radius: 11px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; }
#skiPane .tp-btns .go { background: ${COL}; border-color: ${COL}; color: #fff; flex: 1; justify-content: center; }
#skiPane .tp-wait { display: flex; align-items: center; gap: 8px; font-size: .84rem; color: var(--muted); margin: 0; }
#skiPane .tp-wait::before { content: ""; width: 14px; height: 14px; border-radius: 50%; border: 2px solid ${COL}; border-right-color: transparent; animation: tpspin .8s linear infinite; flex: none; }
@keyframes tpspin { to { transform: rotate(360deg); } }
#skiPane .tp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
#skiPane .tp-list button { font: inherit; width: 100%; text-align: left; display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; font-size: .85rem; }
#skiPane .tp-list button small { color: var(--muted); white-space: nowrap; }
#skiPane .sk-tripgo { font: inherit; font-size: .9rem; font-weight: 800; padding: 10px; border-radius: 11px; border: 0; background: ${COL}; color: #fff; cursor: pointer; }
#skiPane .tp-tours li { display: flex; gap: 4px; }
#skiPane .tp-tours li > button:first-child { flex: 1; }
#skiPane .tp-tours small { color: var(--muted); white-space: normal; }
#skiPane .tp-list .tp-star { flex: none; width: 48px; justify-content: center; align-items: center; font-size: 1.3rem; color: #f08c00; }
#skiPane details.tp-pack > summary, #skiPane details.tp-plan > summary { font-size: .92rem; font-weight: 800; padding: 4px 0; }
#skiPane details summary small { font-weight: 600; color: var(--muted); margin-left: 4px; }
#skiPane .tp-pack h5 { margin: 8px 0 2px; font-size: .74rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
#skiPane .tp-check { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; font-size: .86rem; line-height: 1.3; cursor: pointer; }
#skiPane .tp-check input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: ${COL}; }
#skiPane .tp-check input:checked + span { color: var(--muted); text-decoration: line-through; }
#skiPane .tp-pack .tp-btns, #skiPane .tp-plan .tp-btns { margin-top: 8px; }
#skiPane .tp-plan > p, #skiPane .tp-plan-form { margin: 6px 0; }
#skiPane .tp-plan-form { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#skiPane .tp-plan-form .wide { grid-column: 1 / -1; }
#skiPane .tp-plan-form label { display: flex; flex-direction: column; gap: 2px; font-size: .7rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); min-width: 0; }
#skiPane .tp-plan-form input { font: inherit; font-size: 16px; padding: 7px 6px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); min-width: 0; width: 100%; box-sizing: border-box; }
#skiPane .tp-plan .tp-btns > * { flex: 1 1 40%; justify-content: center; text-align: center; }
#skiPane .tp-late { color: #c92a2a; font-weight: 700; }
#skiPane .tp-late-tag { color: #fff !important; background: #c92a2a; border-radius: 6px; padding: 1px 6px; font-weight: 800; }
#skiPane .sk-acts.tp4 { grid-template-columns: repeat(3, 1fr); }`;   /* phones: one row each (theme.css) */
  document.head.append(css);

  // ---------- the card and its button ----------
  const card = document.createElement("div");
  card.className = "sk-card sk-trip";
  card.id = "skTrip";
  card.hidden = true;
  const detail = $("skDetail");
  if (detail) detail.before(card); else return;
  const acts = document.querySelector("#skiPane .sk-acts");
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "sk-act"; btn.id = "skTripBtn"; btn.textContent = "🏕 Cabin trip";
  btn.title = "Plan a trip to a backcountry cabin: the way in, the forecast for each day, offline";
  if (acts) { acts.append(btn); acts.classList.add("tp4"); }
  const layer = L.layerGroup();

  const trips = () => store.get("skiTrips", []);
  const putTrip = (t, snapOnly) => {   // without what's only for now (the way in's heights are big: worked out again when needed)
    if (!snapOnly) t.ed = Date.now();   // the newer edit wins when two devices' trips merge (account.js); a new forecast isn't an edit
    const { wayWait, ...keep } = t, l = trips().filter((x) => x.id !== t.id);
    l.unshift(keep); store.set("skiTrips", l.slice(0, 20));
  };
  const infos = new Map();   // trip id -> the way in's heights and slopes (ski-terrain.js info), for its route card
  let cur = null, seq = 0, view = null;   // cur: the trip on the card; view: its forecast rows as last worked out
  const wayRun = { n: 0 };

  const scrollTo = () => { if (window.tfSnapTo) window.tfSnapTo("half"); setTimeout(() => { if (window.tfPanelScrollTo) window.tfPanelScrollTo(card); else card.scrollIntoView({ block: "start" }); }, 60); };
  function close() {
    seq++; cur = null; view = null; card.hidden = true; card.innerHTML = ""; layer.clearLayers();
    btn.setAttribute("aria-pressed", "false");
  }

  // ---------- trips ----------
  const hutOf = (h) => ({ id: h.id, name: h.name || "", kind: h.kind || "", lat: h.lat, lon: h.lon, tags: h.tags || {} });
  function open(h) {
    if (!h) return;
    const old = trips().find((x) => x.hut.id === h.id);
    const t = old || { id: Date.now().toString(36), hut: hutOf(h), date: addDays(localDate(new Date()), 1), nights: 2, people: 4, way: null, at: Date.now() };
    t.hut = { ...t.hut, ...hutOf(h), tags: { ...(t.hut.tags || {}), ...(h.tags || {}) } };   // newer facts about the cabin win
    start(t);
  }
  function start(t) {
    cur = t; view = null;
    card.hidden = false; btn.setAttribute("aria-pressed", "true");
    render();
    drawWay();
    scrollTo();
    if (t.way && t.way.src === "auto" && t.way.v !== WAY_V) { t.way = null; t.wayFail = ""; }
    if (!t.way && !/^(noroad|water)$/.test(t.wayFail || "")) findWay(t);
    loadDays(t);
    loadTours(t);
  }
  const hutName = (t) => t.hut.name || (S.KIND[t.hut.kind] || "Cabin");

  // ---------- the way in ----------
  // The search from fish-route.js, back from the cabin to the best place to leave the car within 2, 5 or 9 km, with
  // the ski routes as trails. Its line runs from the start to the cabin. In winter the car stays on a plowed road
  // (alex 2026-10-30, Tom's Hut: "most fsr are not plowed during winter so you have to backcountry ski on the fsr"):
  // a paved road or a lot beside one; logging roads and tracks are part of the ski in. A hut's known winter parking
  // (data/huts.json "winter:parking", from the club or a trip report) wins: the way in starts there.
  const WAY_V = 2;   // ways worked out before the winter rule are worked out again
  async function findWay(t) {
    const my = ++wayRun.n;
    t.wayWait = "Looking for the easiest way in from a parking lot…"; render();
    const say = (s) => { if (cur === t && wayRun.n === my) { t.wayWait = s; renderWay(); } };
    try {
      await S.loadJs("fish-route");
      const FR = window.tfFishRoute;
      if (!FR || !FR._build) throw new Error("no route finder");
      const routes = await S.near([t.hut.lat, t.hut.lon], 10);
      const lines = routes.flatMap((r) => r.lines.map((pts) => ({ pts, name: r.name || "" })));
      const wp = String(t.hut.tags["winter:parking"] || "").split(",").map(Number), known = wp.length === 2 && wp.every(isFinite) ? wp : null;
      const out = await FR._build([t.hut.lat, t.hut.lon], known ? { you: known, lines } : { lines, radii: [2000, 5000, 9000], winter: true },
        (s) => say(s === "terrain" ? "Reading the terrain, trails and roads around the cabin…" : "Working out the easiest way in…"));
      if (wayRun.n !== my) return;
      if (out.fail) { t.wayFail = out.fail === "water" ? "water" : "noroad"; t.wayWait = ""; putTrip(t); if (cur === t) { render(); drawWay(); } return; }
      const d = FR._describe(out.g, out.res);
      const line = [];
      for (const r of d.runs) for (const p of r.pts) { const q = [+p[0].toFixed(5), +p[1].toFixed(5)], l = line[line.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) line.push(q); }
      const from = known ? `Park at ${t.hut.tags["winter:parking:name"] || "the winter parking"}` : out.park ? (out.parkName ? `Park at ${/parking|trailhead|lot\b|stationnement/i.test(out.parkName) ? "" : "the parking for "}${out.parkName}` : `Park at the parking lot${out.roadName ? ` by ${out.roadName}` : ""}`)
        : `Park beside ${out.roadName || "the plowed road"}`;
      await setWay(t, line, { src: "auto", v: WAY_V, from, known: !!known, unplowed: Math.round(out.unplowed || 0), offM: Math.round(d.offM), names: [...new Set(d.runs.filter((r) => r.name && r.m >= 300).map((r) => r.name))].slice(0, 4) });
    } catch (e) {
      if (wayRun.n !== my) return;
      t.wayFail = "net"; t.wayWait = "";
      if (cur === t) render();
    }
  }
  // Heights, slopes and times of a way in (line from the start to the cabin).
  async function setWay(t, line, o) {
    t.wayWait = "Working out the heights and slopes…"; if (cur === t) renderWay();
    const info = await S.info([line]);
    const pts = info.pts, flip = map.distance([pts[0].lat, pts[0].lon], line[0]) > map.distance([pts.at(-1).lat, pts.at(-1).lon], line[0]);
    const seq2 = flip ? pts.slice().reverse() : pts;   // from the start to the cabin
    const munter = (ps) => { let h = 0; for (let i = 1; i < ps.length; i++) { const dk = Math.abs(ps[i].d - ps[i - 1].d) / 1000, dz = ps[i].e - ps[i - 1].e; h += dz >= 0 ? (dk + dz / 100) / 4 : (dk - dz / 100) / 10; } return h; };
    const cls = T.terrainClass(info);
    t.way = { ...o, line, km: +(info.total / 1000).toFixed(2), up: Math.round(info.up), down: Math.round(info.down), min: Math.round(info.min), max: Math.round(info.max),
      hut: Math.round(seq2.at(-1).e), park: Math.round(seq2[0].e), hIn: +munter(seq2).toFixed(2), hOut: +munter(seq2.slice().reverse()).toFixed(2),
      steep: Math.round(info.maxSlope), km30: +info.km30.toFixed(2), above: info.above == null ? null : +info.above.toFixed(2), cls: cls.c, why: cls.why };
    infos.set(t.id, info);
    t.wayFail = ""; t.wayWait = "";
    putTrip(t);
    if (cur === t) { render(); drawWay(); loadDays(t); }
  }
  function drawWay() {
    layer.clearLayers();
    const t = cur;
    if (!t || !isSki()) return;
    L.circleMarker([t.hut.lat, t.hut.lon], { pane: "ski", radius: 9, color: "#fff", weight: 3, fillColor: COL, fillOpacity: 1, interactive: false }).addTo(layer);
    if (t.way && t.way.line.length > 1) {
      L.polyline(t.way.line, { pane: "ski", color: "#fff", weight: 8, opacity: 0.9, interactive: false }).addTo(layer);
      L.polyline(t.way.line, { pane: "ski", color: COL, weight: 4.5, opacity: 1, interactive: false }).addTo(layer);
      L.marker(t.way.line[0], { pane: "ski", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<span class="sk-pin park" style="background:#1f5fe0">P</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(layer);
    }
    if (!map.hasLayer(layer)) layer.addTo(map);
    const b = t.way ? L.latLngBounds(t.way.line).extend([t.hut.lat, t.hut.lon]) : L.latLng(t.hut.lat, t.hut.lon).toBounds(3000);
    if (!map.getBounds().contains(b)) map.fitBounds(b, { padding: [30, 30], maxZoom: 14 });
  }
  // Your own way in, drawn with Plan a tour: points from where you park to the cabin.
  let drawing = null;
  window.addEventListener("tf:ski-plan", (e) => {
    if (e.detail.on || !drawing) return;
    const t = drawing; drawing = null;
    let pts = S.planPts();
    if (pts.length < 2 || cur !== t) return;
    if (map.distance(pts[0], [t.hut.lat, t.hut.lon]) < map.distance(pts.at(-1), [t.hut.lat, t.hut.lon])) pts = pts.reverse();   // drawn from the cabin out
    setWay(t, pts.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]), { src: "own", from: "Your own way in", offM: 0, names: [] }).catch(() => {});
    scrollTo();
  });

  // ---------- the days ----------
  // The weather at the cabin's height for each day, and the avalanche danger on the way in (its lowest to highest point;
  // the cabin's height ± 300 m before there is one). Kept with the trip (t.snap) for when there's no signal.
  const tripDates = (t) => Array.from({ length: t.nights + 1 }, (_, i) => addDays(t.date, i));
  async function loadDays(t) {
    const my = ++seq;
    const ele = t.way ? t.way.hut : parseFloat(t.hut.tags.ele) || null;
    let w = null, err = "";
    try { w = await S.weather(t.hut.lat, t.hut.lon, ele); } catch (e) { err = e.message || "no signal"; }
    await S.avy().catch(() => {});
    if (my !== seq || cur !== t) return;
    if (!w) { view = t.snap ? { ...t.snap, old: true, err } : { err }; renderDays(); return; }
    const dd = w.daily, lo = t.way ? t.way.min : (ele || 1500) - 300, hi = t.way ? t.way.max : (ele || 1500) + 300;
    const cls = t.way ? t.way.cls : 0;
    const rows = tripDates(t).map((date, j) => {
      const i = dd.time.indexOf(date), last = j === t.nights;
      const row = { date, tag: j === 0 ? "in" : last ? "out" : "" };
      if (i >= 0) Object.assign(row, { code: dd.weather_code[i], hi: dd.temperature_2m_max[i], lo: dd.temperature_2m_min[i], snow: dd.snowfall_sum[i] || 0,
        rain: Math.max(0, (dd.precipitation_sum[i] || 0) - (dd.snowfall_sum[i] || 0) / 0.7), wind: dd.wind_speed_10m_max[i], gust: dd.wind_gusts_10m_max[i], dir: dd.wind_direction_10m_dominant[i] });
      const dg = S.dangerOn(t.hut.lat, t.hut.lon, lo, hi, date);
      if (dg && dg.r) { row.r = dg.r; row.band = dg.band; if (cls) row.l = T.light(dg.r, cls); }
      else row.avNone = dg ? dg.none || "no rating" : "no forecast here today";
      return row;
    });
    // The 3 days before you go in: snow and the strongest wind (what loads the slopes you'll cross).
    const bi = [-3, -2, -1].map((k) => dd.time.indexOf(addDays(t.date, k))).filter((i) => i >= 0);
    const before = bi.length ? { snow: bi.reduce((s, i) => s + (dd.snowfall_sum[i] || 0), 0), wind: Math.max(...bi.map((i) => dd.wind_speed_10m_max[i] || 0)), n: bi.length } : null;
    const end = dd.time.at(-1);
    view = { at: Date.now(), rows, before, end, ele: Math.round(ele || w.elevation || 0), example: S.example() };
    t.snap = view;
    putTrip(t, true);
    renderDays();
  }

  // ---------- day tours from the cabin ----------
  // The mapped tours and snowshoe routes that pass within 1.5 km of the cabin, for the full days you're there. A ★ puts
  // one in the trip plan you leave with a friend. Kept with the trip (t.tours) so the list shows with no signal.
  async function loadTours(t) {
    if (!window.tfSki || !window.tfSki.near) return;
    try {
      const r = await window.tfSki.near([t.hut.lat, t.hut.lon], 3, ["tour", "snowshoe", "other"]);
      t.tours = r.routes.filter((x) => x.d <= 1500).slice(0, 8).map((x) => ({ id: x.id, name: x.name, label: x.label, km: +x.km.toFixed(1), d: Math.round(x.d), pill: x.pill, c: x.c }));
      putTrip(t, true);   // a fresh list isn't an edit
    } catch { if (!t.tours) t.tours = []; }
    if (cur === t) renderTours();
  }
  function toursHtml(t) {
    const full = t.nights - 1, l = t.tours;
    const lead = `<p class="sk-note">${full > 0 ? `<b>${full} full day${full > 1 ? "s" : ""}</b> at the cabin, plus the afternoon you get in.` : "One night: the afternoon you get in and the morning before you ski out."}</p>`;
    if (!l) return `${lead}<p class="tp-wait">Looking for tours near the cabin…</p>`;
    if (!l.length) return `${lead}<p class="sk-note">No mapped tours start near the cabin. Tap the slopes around it on the map for their angle and avalanche terrain, or draw one with Plan a tour.</p>`;
    const pick = t.pick || [];
    return `${lead}<ul class="tp-list tp-tours">${l.map((x) => `<li><button type="button" data-tour="${esc(x.id)}"><span>${esc(x.name)} <small>${esc(x.label)} · ${x.km.toFixed(1)} km${x.d >= 150 ? ` · starts ${(x.d / 1000).toFixed(1)} km away` : " · from the door"}</small>${x.pill ? `<br>${x.pill}` : ""}</span></button><button type="button" class="tp-star" data-star="${esc(x.id)}" aria-pressed="${pick.includes(x.id)}" aria-label="Plan to do ${esc(x.name)}">${pick.includes(x.id) ? "★" : "☆"}</button></li>`).join("")}</ul>
      <p class="sk-note">Tap one for its slopes and today's avalanche check. ★ the ones you plan to do: they go in your trip plan.</p>`;
  }

  // ---------- packing list ----------
  // Built from the trip: how many nights and people, what the cabin has (heat, water, outhouse, booking, fee), the way
  // in's slopes and the coldest night in the forecast. Ticks stay with the trip (t.packed).
  function packItems(t) {
    const g = t.hut.tags || {}, w = t.way, n = t.nights, p = t.people;
    const rows = view && view.rows ? view.rows.filter((r) => r.code != null) : [];
    const cold = rows.length ? Math.min(...rows.map((r) => r.lo)) : null;
    const noWater = g.drinking_water !== "yes", noHeat = !g.heating || g.heating === "none";
    const fuel = Math.ceil((p * n * (noWater ? 0.2 : 0.1) + 0.1) * 10) / 10;   // litres of white gas: about 200 ml a person a day melting snow
    const bag = cold == null ? "Sleeping bag" : `Sleeping bag rated to ${Math.min(-5, Math.round(cold) - 5)}°C${noHeat ? " (no heat: inside gets near the outside cold)" : ""}`;
    const G = [
      ["Avalanche and safety", [
        ["beacon", `Avalanche beacon each, fresh batteries${p > 1 ? ` (${p})` : ""}`], ["shovel", "Shovel and probe each"],
        ["sat", "Satellite messenger or PLB (inReach, Zoleo): most cabins have no cell signal"], ["aid", "First aid kit"],
        ["repair", "Repair kit: skin glue/straps, binding parts, pole splint, tape"], ["bivy", "Emergency bivy or tarp"],
        ["lamp", "Headlamp and spare batteries"], ["power", "Phone charged + power bank (cold drains it)"]]],
      ["Skiing", [
        ["skis", "Skis or splitboard, skins, poles"],
        ...(w && (w.steep >= 25 || w.km30 > 0) ? [["crampons", `Ski crampons: the way in gets to ${w.steep}°`]] : []),
        ...(rows.some((r) => r.snow >= 10 || r.gust >= 50) ? [["goggles", "Goggles: snow or strong wind in the forecast"]] : [["goggles", "Goggles and sunglasses"]]),
        ["wax", "Skin wax"]]],
      ["Sleeping", [
        ["bag", bag], ["pad", "Sleeping pad (check if the cabin has mattresses)"], ["booties", "Hut booties or down slippers"], ["plugs", "Earplugs"]]],
      ["Cooking and water", [
        ["stove", `Stove and about ${fuel.toFixed(1)} L of fuel${noWater ? (g.drinking_water === "no" ? ": no water, you melt snow" : ": plan to melt snow") : ""}`],
        ["pot", "Pot, lighter × 2, mug, spoon"], ["bottle", "Water bottles + a thermos"],
        ...(/wood|stove/i.test(g.heating || "") ? [["fire", "Fire starter (check if wood is supplied)"]] : [])]],
      ["Food", [
        ["meals", `${n} breakfast${n > 1 ? "s" : ""}, ${n + 1} lunches and ${n} dinner${n > 1 ? "s" : ""}${p > 1 ? ` for ${p}` : ""}`],
        ["snacks", `Snacks for ${n + 1} days`], ["spare", "One spare day of food, in case you're stuck in by weather"]]],
      ["Clothes", [
        ["layers", "Base layers, puffy jacket, shell jacket and pants"], ["hands", "Spare gloves, warm mitts, toque, buff"], ["socks", `Dry socks for ${n} night${n > 1 ? "s" : ""}`]]],
      ["Cabin", [
        ...(/^(required|only|yes)$/.test(g.reservation || "") ? [["booking", "Booking confirmation"]] : []),
        ...(g.charge || g.fee === "yes" ? [["fee", `Cabin fee${g.charge ? `: ${g.charge}` : ""}`]] : []),
        ...(g.toilets === "no" ? [["wag", "Wag bags: there's no outhouse, pack it out"]] : [["tp", "Toilet paper"]]),
        ["trash", "Garbage bag: pack everything out"]]],
      ["Before you go", [["offline", "Trip saved offline (button below)"], ["plan", "Trip plan left with a friend (below)"]]],
    ];
    return G;
  }
  const packDone = (t) => ({ ...(t.packed || {}), ...(t.offAt ? { offline: 1 } : {}), ...(t.plan && t.plan.sent ? { plan: 1 } : {}) });
  function packHtml(t) {
    const G = packItems(t), done = packDone(t), auto = { offline: !!t.offAt, plan: !!(t.plan && t.plan.sent) }, all = G.flatMap((x) => x[1]), n = all.filter((x) => done[x[0]]).length;
    return `<details class="tp-pack" ${t.packOpen ? "open" : ""}><summary>Packing list <small>${n} of ${all.length} packed</small></summary>
      ${G.map(([h, items]) => `<h5>${esc(h)}</h5>${items.map(([k, label]) => `<label class="tp-check"><input type="checkbox" data-pk="${k}" ${done[k] ? "checked" : ""} ${auto[k] ? "disabled" : ""}> <span>${esc(label)}</span></label>`).join("")}`).join("")}
      <div class="tp-btns"><button type="button" data-tp="packshare">📤 Send the list to the group</button>${n ? `<button type="button" data-tp="packclear">Untick all</button>` : ""}</div></details>`;
  }

  // ---------- trip plan for a friend, and the late alert ----------
  // What AdventureSmart asks you to leave with someone: who, where, the way in, when you'll be out and when to call
  // for help. It goes out through the share sheet (text, email...). The late alert is a calendar event for the friend
  // that rings at the "call for help" time, with what to do in it: it works with no signal on your side, and no server.
  // On your phone the trip turns red once your out time has passed, until you tap We're out safe.
  const me = () => store.get("tripMe", {});
  const outDay = (t) => addDays(t.date, t.nights);
  const planOf = (t) => {
    const m = me(), pl = t.plan || {};
    return { who: pl.who != null ? pl.who : m.who || "", car: pl.car != null ? pl.car : m.car || "", friend: pl.friend != null ? pl.friend : m.friend || "",
      out: pl.out || `${outDay(t)}T16:00`, help: pl.help || `${outDay(t)}T20:00`, sent: pl.sent || 0, safe: pl.safe || 0 };
  };
  const when = (v) => new Date(v).toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const late = (t) => { const pl = t.plan; return !!(pl && pl.sent && !pl.safe && Date.now() > new Date(pl.out || `${outDay(t)}T16:00`).getTime()); };
  function planText(t) {
    const pl = planOf(t), w = t.way, ll = (a, b) => `${a.toFixed(5)}, ${b.toFixed(5)}`;
    const tours = (t.tours || []).filter((x) => (t.pick || []).includes(x.id)).map((x) => x.name);
    const hasSat = (t.packed || {}).sat;
    return [`TRIP PLAN: ${hutName(t)} (backcountry ski trip)`,
      `Who: ${pl.who || "me"}${t.people > 1 ? ` (${t.people} people)` : ""}`,
      `Cabin: ${hutName(t)}, ${ll(t.hut.lat, t.hut.lon)} https://www.google.com/maps?q=${t.hut.lat.toFixed(5)},${t.hut.lon.toFixed(5)}`,
      `Going in: ${dayWord(t.date)}${w ? `, ${w.from.replace(/^Park /, "parking ")} (${ll(w.line[0][0], w.line[0][1])}), ${w.km.toFixed(1)} km and ${fmtM(w.up)} up, about ${fmtH(w.hIn)}` : ""}`,
      `Nights: ${t.nights}. Back at the car by ${when(pl.out)}`,
      ...(tours.length ? [`Day tours we may do: ${tours.join(", ")}`] : []),
      ...(pl.car ? [`Car: ${pl.car}${w ? " at the parking above" : ""}`] : []),
      `Gear: avalanche beacons, shovels, probes, first aid${hasSat ? ", satellite messenger" : ""}, ${t.nights + 1} days of food + a spare day`,
      ``, `If you haven't heard from us by ${when(pl.help)}: call 911 (or the RCMP) and say we're overdue on a backcountry ski trip. They call Search and Rescue. Read them this plan.`,
      ...(t.hut.tags.operator ? [`The cabin is run by ${t.hut.tags.operator}${t.hut.tags.website ? ` (${t.hut.tags.website})` : ""}.`] : []),
    ].join("\n");
  }
  const icsEsc = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  function alertIcs(t) {
    const pl = planOf(t), at = new Date(pl.help), who = pl.who || "your friend";
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trail Finder//Cabin trip//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT", `UID:tf-trip-${t.id}@trail-finder`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(at)}`, `DTEND:${stamp(new Date(at.getTime() + 30 * 60000))}`,
      `SUMMARY:${icsEsc(`Heard from ${who}? (${hutName(t)} trip)`)}`, `GEO:${t.hut.lat.toFixed(5)};${t.hut.lon.toFixed(5)}`,
      `DESCRIPTION:${icsEsc(`Not heard from ${who} yet? If they haven't told you they're out safe, call 911 and say they're overdue on a backcountry ski trip.\n\n${planText(t)}`)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(`Not heard from ${who}? Call 911`)}`, "TRIGGER:PT0M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].map((l) => (l.match(/.{1,60}/gu) || [""]).join("\r\n ")).join("\r\n");   // folded: 75 bytes a line at most
  }
  async function shareFile(body, name, type, text) {
    const f = new File([body], name, { type });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: name, text }); return true; } catch (e) { if (e && e.name === "AbortError") return false; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type })); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    if (window.tfToast) window.tfToast(`Saved ${name}: send it to your friend to open.`);
    return true;
  }
  async function shareText(title, text) {
    try {
      if (navigator.share) { await navigator.share({ title, text }); return true; }
      await navigator.clipboard.writeText(text);
      if (window.tfToast) window.tfToast("Copied: paste it in a message.");
      return true;
    } catch (e) { if (e && e.name === "AbortError") return false; try { prompt("Copy this:", text); } catch {} return true; }
  }
  function planHtml(t) {
    const pl = planOf(t), isLate = late(t);
    const status = pl.safe ? `<p class="sk-note">✅ Out safe ${esc(when(pl.safe))}.</p>`
      : isLate ? `<p class="tp-late">Past your out time (${esc(when(pl.out))}). Out safe? Tell ${esc(pl.friend || "your friend")} now${Date.now() > new Date(pl.help).getTime() ? ": their alert has gone off" : `, before the alert goes off at ${esc(when(pl.help))}`}.</p>`
      : pl.sent ? `<p class="sk-note">Sent ${esc(when(pl.sent))}: their alert goes off at ${esc(when(pl.help))} unless you tell them you're out.</p>` : "";
    return `<details class="tp-plan" ${t.planOpen || isLate ? "open" : ""}><summary>Trip plan for a friend${isLate ? ` <small class="tp-late-tag">Overdue</small>` : pl.sent ? " <small>sent</small>" : ""}</summary>
      <p class="sk-note">Leave it with someone at home: if you don't check in, they call for help.</p>
      <div class="tp-plan-form">
        <label>Who's going<input type="text" data-pl="who" value="${esc(pl.who)}" placeholder="Your names" autocomplete="off"></label>
        <label>Friend at home<input type="text" data-pl="friend" value="${esc(pl.friend)}" placeholder="Their name" autocomplete="off"></label>
        <label class="wide">Car<input type="text" data-pl="car" value="${esc(pl.car)}" placeholder="Colour, make, plate" autocomplete="off"></label>
        <label class="wide">Out by<input type="datetime-local" data-pl="out" value="${esc(pl.out)}"></label>
        <label class="wide">Call for help at (if no word from you)<input type="datetime-local" data-pl="help" value="${esc(pl.help)}"></label>
      </div>
      ${status}
      <div class="tp-btns"><button type="button" class="go" data-tp="plansend">📤 Send the trip plan</button><button type="button" data-tp="planics">⏰ Late alert for their calendar</button>
        ${window.tfLive ? `<button type="button" data-tp="live">📍 Live location</button>` : ""}${pl.sent && !pl.safe ? `<button type="button" data-tp="safe">✅ We're out safe</button>` : ""}</div>
      <p class="sk-note">The late alert is a calendar event: it rings on their phone at "Call for help at" with what to do. Live location only sends where you have signal.</p></details>`;
  }

  // ---------- drawing the card ----------
  function factsHtml(t) {
    const g = t.hut.tags || {}, out = [];
    const beds = parseInt(g.capacity, 10);
    if (beds) out.push(`<span class="${t.people > beds ? "warn" : ""}">🛏 Sleeps ${beds}${t.people > beds ? `: you're ${t.people}` : ""}</span>`);
    if (g.charge) out.push(`<span>💲 ${esc(g.charge)}</span>`); else if (g.fee === "yes") out.push(`<span>💲 Fee</span>`); else if (g.fee === "no") out.push(`<span>Free</span>`);
    if (/^(required|only)$/.test(g.reservation)) out.push(`<span class="warn">📅 Booking needed</span>`);
    else if (g.reservation === "yes" || g.reservation === "recommended") out.push(`<span>📅 Booking possible</span>`);
    else if (g.reservation === "no") out.push(`<span>First come, first served</span>`);
    const book = g["reservation:website"] || g["reservation:url"];
    if (book) out.push(`<a href="${esc(book)}" target="_blank" rel="noopener">📅 Book it</a>`);
    if (g.website && g.website !== book) out.push(`<a href="${esc(g.website)}" target="_blank" rel="noopener">ℹ Hut page</a>`);
    if (g.heating) out.push(`<span>🔥 ${esc(g.heating === "none" ? "No heat" : g.heating)}</span>`);
    if (g.drinking_water) out.push(`<span>💧 ${g.drinking_water === "no" ? "No water: melt snow" : esc(g.drinking_water === "yes" ? "Water" : g.drinking_water)}</span>`);
    if (g.toilets) out.push(`<span>${g.toilets === "no" ? "No outhouse" : "🚻 Outhouse"}</span>`);
    return `${out.length ? `<div class="tp-facts">${out.join("")}</div>` : ""}
      ${g.operator ? `<p class="sk-note">Run by ${esc(g.operator)}${book || /^(required|only|yes)$/.test(g.reservation || "") ? "" : ". Check with them before you go: some cabins need booking or a permit."}</p>` : !out.length ? `<p class="sk-note">${esc(S.HUT_ABOUT[t.hut.kind] || S.HUT_ABOUT.basic_hut)} Check who runs it and if it needs booking before you go.</p>` : ""}
      ${g.description ? `<p class="sk-note">${esc(g.description)}</p>` : ""}`;
  }
  function wayHtml(t) {
    const w = t.way;
    if (t.wayWait) return `<p class="tp-wait">${esc(t.wayWait)}</p>`;
    if (!w) {
      const msg = { noroad: "No parking lot or road within 9 km that the map knows of: the way in must start further away (by snowmobile, lift or a long ski).", water: "The cabin sits on the water on the map.", net: "Couldn't get the map data for the way in. Check your connection and try again." }[t.wayFail] || "";
      return `<p class="sk-note">${esc(msg)}</p><div class="tp-btns"><button type="button" data-tp="draw">✎ Draw the way in</button>${t.wayFail === "net" ? `<button type="button" data-tp="again">↻ Try again</button>` : ""}</div>`;
    }
    const C = T.CLASSES[w.cls], a = w.line[0];
    const ios = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
    const drive = ios ? `https://maps.apple.com/?daddr=${a[0]},${a[1]}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${a[0]},${a[1]}&travelmode=driving`;
    return `<p><b>${esc(w.from)}</b>${w.names && w.names.length ? ` <span class="sk-note">· via ${esc(w.names.join(", "))}</span>` : ""}</p>
      <div class="tp-stats"><span><b>${w.km.toFixed(1)}</b> km</span><span>↗ ${fmtM(w.up)}</span><span>↘ ${fmtM(w.down)}</span><span title="Munter estimate: 4 km or 400 m of climb an hour up, 10 km or 1000 m an hour down">⏱ ${fmtH(w.hIn)} in · ${fmtH(w.hOut)} out</span></div>
      <div class="tp-stats"><span>${fmtM(w.park)} at the car → ${fmtM(w.hut)} at the cabin</span><span>steepest ${w.steep}°</span></div>
      <p><span class="sk-ates" style="--c:${C.color}">${C.label}</span> <span class="sk-note">avalanche terrain, estimated: ${esc((w.why || []).join("; "))}</span></p>
      ${w.offM >= 50 ? `<p class="sk-note">${fmtM(w.offM)} of it isn't on a mapped trail or road: it follows the terrain.</p>` : ""}
      ${w.unplowed >= 200 ? `<p class="sk-note"><b>${(w.unplowed / 1000).toFixed(1)} km of it is on gravel or logging roads</b>: not plowed in winter, so you ski it (counted in the km, climb and time).</p>` : ""}
      ${t.hut.tags["winter:access"] ? `<p class="sk-note">${esc(t.hut.tags["winter:access"])}</p>` : ""}
      ${w.src === "auto" && !w.known ? `<p class="sk-note">Starts where the plowed road is: check the pullout is plowed, and the road report, before you drive.</p>` : ""}
      <div class="tp-btns"><button type="button" class="go" data-tp="show">Show the way in + conditions</button><a href="${drive}" target="_blank" rel="noopener">🚗 Drive</a><button type="button" data-tp="draw">✎ Draw my own</button></div>`;
  }
  function daysHtml() {
    const t = cur, v = view;
    if (!v) return `<p class="tp-wait">Loading the forecast for your dates…</p>`;
    if (!v.rows) return `<p class="sk-note">Couldn't load the forecast (${esc(v.err)}).</p>`;
    const today = localDate(new Date());
    const rows = v.rows.map((r) => {
      const DG = r.r ? S.DANGER[r.r] : null, L1 = r.l != null ? T.LIGHTS[r.l] : null;
      const band = r.band ? (S.BANDS.find((b) => b[0] === r.band) || ["", ""])[1].toLowerCase() : "";
      const av = DG ? `<span><b style="color:${DG.color === "#fff300" ? "#b08800" : DG.color}">⚠ ${esc(DG.label.replace(/^\d /, ""))}</b> ${band ? `in the ${band}` : ""}${L1 ? ` · <span class="sk-rc-word" style="--c:${L1.color}">● ${esc(L1.label)}</span>` : ""}</span>`
        : `<span class="sk-note">Avalanche: ${r.date < today ? "past" : r.avNone === "not forecast yet" ? "not forecast yet (about 3 days ahead)" : esc(r.avNone)}</span>`;
      const wx = r.code != null ? `<span class="tp-wx"><big>${S.WICON[r.code] || ""} ${deg(r.hi)}</big><br>low ${deg(r.lo)}</span>` : `<span class="tp-wx sk-note">${r.date > v.end ? "Too far<br>ahead" : "–"}</span>`;
      const bits = r.code != null ? [r.snow >= 0.5 ? `❄ ${Math.round(r.snow)} cm` : r.rain >= 1 ? `🌧 ${Math.round(r.rain)} mm rain` : "Dry",
        `💨 ${Math.round(r.wind || 0)} km/h ${S.COMPASS[Math.round((r.dir || 0) / 45) % 8]}${r.gust >= 50 ? `, gusts ${Math.round(r.gust)}` : ""}`] : [];
      return `<li style="--c:${DG ? DG.color : "var(--line)"}"><b>${esc(dayWord(r.date))}${r.tag ? ` · ${r.tag === "in" ? "ski in" : "ski out"}` : ""}</b>${wx}${av}${bits.length ? `<small>${bits.join(" · ")}</small>` : ""}</li>`;
    }).join("");
    const b = v.before;
    const far = v.rows.some((r) => r.code == null && r.date > v.end);
    return `${b ? `<p class="sk-note">Before you go in (${b.n} days): ${b.snow >= 0.5 ? `<b>${Math.round(b.snow)} cm of new snow</b>` : "no new snow"}, wind up to ${Math.round(b.wind)} km/h.${b.snow >= 30 || b.wind >= 40 ? " Fresh slabs likely on the way in." : ""}</p>` : ""}
      <ul class="tp-days">${rows}</ul>
      <p class="sk-note">${v.old ? `<b>Saved forecast from ${esc(new Date(v.at).toLocaleString("en-CA", { weekday: "short", hour: "numeric", minute: "2-digit" }))}</b> (no signal now). ` : ""}Weather at the cabin (${fmtM(v.ele)}), Open-Meteo${far ? `, about a week ahead: come back from ${esc(dayWord(addDays(t.date, -7)))} for the first day` : ""}. Avalanche danger on the way in, from Avalanche Canada${v.example ? " (example forecast)" : ""}${t.way ? ", with the Avaluator light for its terrain" : ""}. Check avalanche.ca the morning you go.</p>`;
  }
  function render() {
    const t = cur;
    if (!t) return;
    card.innerHTML = `<div><button type="button" class="sk-x" aria-label="Close">✕</button><h3>🏕 ${esc(hutName(t))} <small>cabin trip</small></h3></div>
      <div class="tp-form">
        <label>Go in<input type="date" data-tp="date" value="${esc(t.date)}"></label>
        <label>Nights<span class="tp-step"><button type="button" data-tp="n-" aria-label="One night less">−</button><b>${t.nights}</b><button type="button" data-tp="n+" aria-label="One night more">+</button></span></label>
        <label>People<span class="tp-step"><button type="button" data-tp="p-" aria-label="One person less">−</button><b>${t.people}</b><button type="button" data-tp="p+" aria-label="One person more">+</button></span></label>
      </div>
      <p class="sk-note">${esc(dayWord(t.date))} to ${esc(dayWord(addDays(t.date, t.nights)))}</p>
      ${factsHtml(t)}
      <div class="sk-sec tp-way" id="tpWay"><h4>The way in</h4>${wayHtml(t)}</div>
      <div class="sk-sec" id="tpDays"><h4>Each day</h4>${daysHtml()}</div>
      <div class="sk-sec" id="tpTours"><h4>Day tours from the cabin</h4>${toursHtml(t)}</div>
      <div class="sk-sec" id="tpPack">${packHtml(t)}</div>
      <div class="sk-sec" id="tpPlan">${planHtml(t)}</div>
      <div class="sk-sec"><div class="tp-btns"><button type="button" data-tp="off" ${t.way ? "" : "disabled"}>⤓ Save the trip offline</button><button type="button" data-tp="hut">Cabin details</button><button type="button" data-tp="del">🗑 Delete</button></div>
        <p class="sk-note" id="tpOff">${offHtml(t)}</p></div>`;
  }
  // Where the trip's offline save is, from Offline maps itself (offline.js status, PR #544): saving, saved, or not
  // finished with files missing (alex saw "Saved offline" with 2 files missing). Missing files retry on their own.
  const offName = (t) => `Cabin trip: ${hutName(t)}`;
  const day = (ms) => esc(new Date(ms).toLocaleDateString("en-CA", { month: "short", day: "numeric" }));
  function offHtml(t) {
    const st = window.tfOffline && window.tfOffline.status ? window.tfOffline.status(offName(t)) : null;
    const what = "the map, ski routes, slopes and avalanche forecast around the cabin and the way in";
    if (st && st.state === "saving") return `<b>Saving offline… ${Math.round(st.pct || 0)}%</b> Keep the app open until it's done.`;
    if (st && st.state === "missing") return `<b style="color:#c92a2a">Not finished: ${st.missing} file${st.missing === 1 ? "" : "s"} still missing.</b> They download again by themselves when you have signal; don't count on this trip offline until it says Saved.`;
    if (st && st.state === "saved") return `<b>Saved offline ${day(st.at || t.offAt)}</b>: ${what} work with no signal; the forecast above is kept as it was then. The trip stays on this phone.`;
    if (t.offAt && window.tfOffline && window.tfOffline.status) return `Not saved offline any more (it was deleted from Offline maps). Save it again for no signal.`;
    return `Saves ${what}, and keeps this forecast, for no signal. The trip stays on this phone.`;
  }
  window.addEventListener("tf:offline", (e) => { const el = $("tpOff"); if (el && cur && e.detail && e.detail.name === offName(cur)) el.innerHTML = offHtml(cur); });
  const renderWay = () => { const el = $("tpWay"); if (el && cur) el.innerHTML = `<h4>The way in</h4>${wayHtml(cur)}`; };
  const renderDays = () => { const el = $("tpDays"); if (el && cur) el.innerHTML = `<h4>Each day</h4>${daysHtml()}`; renderPack(); };
  const renderTours = () => { const el = $("tpTours"); if (el && cur) el.innerHTML = `<h4>Day tours from the cabin</h4>${toursHtml(cur)}`; };
  const renderPack = () => { const el = $("tpPack"); if (el && cur) el.innerHTML = packHtml(cur); };
  const renderPlan = () => { const el = $("tpPlan"); if (el && cur) el.innerHTML = planHtml(cur); };
  card.addEventListener("toggle", (e) => {   // keep the packing list / trip plan open across redraws
    if (!cur) return;
    if (e.target.classList.contains("tp-pack")) cur.packOpen = e.target.open;
    else if (e.target.classList.contains("tp-plan")) cur.planOpen = e.target.open;
  }, true);

  card.addEventListener("change", (e) => {
    if (!cur) return;
    const el = e.target;
    if (el.dataset.pk) {
      cur.packed = { ...(cur.packed || {}) };
      if (el.checked) cur.packed[el.dataset.pk] = 1; else delete cur.packed[el.dataset.pk];
      putTrip(cur); renderPack(); return;
    }
    if (el.dataset.pl) {
      const k = el.dataset.pl;
      cur.plan = { ...(cur.plan || {}), [k]: el.value.trim() };
      if (k === "out" && el.value && !(cur.plan.helpSet)) { const d = new Date(el.value); d.setHours(d.getHours() + 4); cur.plan.help = `${localDate(d)}T${d.toTimeString().slice(0, 5)}`; }
      if (k === "help") cur.plan.helpSet = 1;
      if (/^(who|car|friend)$/.test(k)) store.set("tripMe", { ...me(), [k]: el.value.trim() });   // the next trip starts with them
      putTrip(cur); if (k === "out" || k === "help") renderPlan(); return;
    }
    if (el.dataset.tp !== "date" || !el.value) return;
    cur.date = e.target.value; putTrip(cur); render(); loadDays(cur);
  });
  card.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tp], .sk-x");
    if (!b || !cur) return;
    const t = cur, k = b.dataset.tp;
    if (b.classList.contains("sk-x")) { close(); return; }
    if (k === "n-" || k === "n+") { t.nights = Math.max(1, Math.min(10, t.nights + (k === "n+" ? 1 : -1))); putTrip(t); render(); loadDays(t); }
    else if (k === "p-" || k === "p+") { t.people = Math.max(1, Math.min(40, t.people + (k === "p+" ? 1 : -1))); putTrip(t); render(); }
    else if (k === "again") { t.wayFail = ""; findWay(t); }
    else if (k === "packshare") {
      const done = packDone(t), left = packItems(t).map(([h, items]) => [h, items.filter((x) => !done[x[0]] && !/^(offline|plan)$/.test(x[0]))]).filter((x) => x[1].length);
      shareText(`Packing for ${hutName(t)}`, `Packing for ${hutName(t)}, ${dayWord(t.date)}, ${t.nights} night${t.nights > 1 ? "s" : ""}:\n` + left.map(([h, items]) => `\n${h}\n${items.map((x) => `- ${x[1]}`).join("\n")}`).join("\n"));
    } else if (k === "packclear") { t.packed = {}; putTrip(t); renderPack(); }
    else if (k === "plansend" || k === "planics") {
      const pl = planOf(t);
      if (new Date(pl.help) <= new Date(pl.out)) { if (window.tfToast) window.tfToast("Call for help at must be after your out time."); return; }
      const go = k === "plansend" ? shareText(`Trip plan: ${hutName(t)}`, planText(t))
        : shareFile(alertIcs(t), `trip-alert-${hutName(t).replace(/[^\w]+/g, "-").toLowerCase()}.ics`, "text/calendar", `Add this to your calendar: it rings at ${when(pl.help)} if you haven't heard from ${pl.who || "me"}.`);
      go.then((ok) => { if (!ok) return; t.plan = { ...(t.plan || {}), who: pl.who, car: pl.car, friend: pl.friend, out: pl.out, help: pl.help, sent: t.plan && t.plan.sent || Date.now(), safe: 0 }; putTrip(t); renderPlan(); renderPack(); });
    } else if (k === "safe") {
      const pl = planOf(t);
      shareText("Out safe", `${pl.who || "We"}: out safe from ${hutName(t)}, back at the car ${when(Date.now())}. You can delete the late alert.`)
        .then((ok) => { if (!ok) return; t.plan = { ...(t.plan || {}), safe: Date.now() }; putTrip(t); renderPlan(); });
    } else if (k === "live" && window.tfLive) window.tfLive.open();
    else if (k === "show" && t.way) {
      const r = S.route(t.way.line, `Way in to ${hutName(t)}`, infos.get(t.id) || null);
      S.select(r);
      setTimeout(() => { if (window.tfPanelScrollTo && $("skDetail")) window.tfPanelScrollTo($("skDetail")); }, 80);
    } else if (k === "draw") {
      const had = S.planPts();
      if (had.length > 2 && !confirm("Replace your planned tour with the way in to this cabin?")) return;
      drawing = t;
      S.plan(t.way ? [t.way.line[0]] : []);
      if (window.tfToast) window.tfToast("Tap from where you park up to the cabin, then ✓ Done.");
    } else if (k === "hut") {
      S.loadSki().then((ski) => { const h = (ski?.huts || []).find((x) => x.id === t.hut.id) || t.hut; S.selectHut(h); setTimeout(() => window.tfPanelScrollTo && window.tfPanelScrollTo($("skDetail")), 80); });
    } else if (k === "del") {
      if (!confirm(`Delete your trip to ${hutName(t)}?`)) return;
      if (window.tfAccount && window.tfAccount.gone) window.tfAccount.gone("skiTrips", t.id);   // so the account doesn't bring it back
      store.set("skiTrips", trips().filter((x) => x.id !== t.id)); close();
    } else if (k === "off" && t.way) {
      if (!window.tfOffline || !window.tfOffline.saveBox) { if (window.tfToast) window.tfToast("Offline maps aren't available in this browser."); return; }
      const ll = [...t.way.line, [t.hut.lat, t.hut.lon]];
      const box = [Math.min(...ll.map((p) => p[0])), Math.min(...ll.map((p) => p[1])), Math.max(...ll.map((p) => p[0])), Math.max(...ll.map((p) => p[1]))];
      t.offAt = Date.now(); putTrip(t); render();
      window.tfOffline.saveBox(box, offName(t));
    }
  });

  // The trips list (the 🏕 Cabin trip button): your trips, and the cabins near the middle of the map to start one.
  async function showList(quiet) {
    close();
    card.hidden = false; btn.setAttribute("aria-pressed", "true");
    const mine = trips();
    card.innerHTML = `<div><button type="button" class="sk-x" aria-label="Close">✕</button><h3>🏕 Cabin trips</h3></div>
      ${mine.length ? `<ul class="tp-list">${mine.map((t) => `<li><button type="button" data-trip="${esc(t.id)}"><span>${esc(t.hut.name || "Cabin")}</span><small>${late(t) ? `<b class="tp-late-tag">Overdue</b> ` : ""}${esc(dayWord(t.date))} · ${t.nights} night${t.nights > 1 ? "s" : ""}</small></button></li>`).join("")}</ul>` : ""}
      <p class="sk-note">Tap a cabin (the brown dots) on the map, then <b>🏕 Plan a cabin trip here</b>, or pick one near you:</p>
      <ul class="tp-list" id="tpNear"><li><p class="tp-wait">Finding cabins…</p></li></ul>`;
    if (!quiet) scrollTo();
    const c = map.getCenter(), ski = await S.loadSki();
    const near = (ski?.huts || []).filter((h) => h.kind !== "shelter" && h.name).map((h) => ({ h, d: map.distance(c, [h.lat, h.lon]) })).sort((a, b) => a.d - b.d).slice(0, 6);
    const el = $("tpNear");
    if (!el) return;
    el.innerHTML = near.length ? near.map(({ h, d }) => `<li><button type="button" data-hut="${esc(h.id)}"><span>${esc(h.name)}</span><small>${d < 9500 ? (d / 1000).toFixed(1) : Math.round(d / 1000)} km</small></button></li>`).join("")
      : `<li class="sk-note">No cabins on the map near here.</li>`;
  }
  card.addEventListener("click", (e) => {
    const a = e.target.closest("[data-tour], [data-star]");
    if (!a || !cur) return;
    const t = cur, id = a.dataset.tour || a.dataset.star, x = (t.tours || []).find((y) => y.id === id);
    if (a.dataset.star) {
      const p = new Set(t.pick || []); if (p.has(id)) p.delete(id); else p.add(id);
      t.pick = [...p]; putTrip(t); renderTours(); return;
    }
    if (x && window.tfSki.show) window.tfSki.show(x.id, x.c).then(() => setTimeout(() => window.tfPanelScrollTo && $("skDetail") && window.tfPanelScrollTo($("skDetail")), 80));
  });
  card.addEventListener("click", (e) => {
    const a = e.target.closest("[data-trip], [data-hut]");
    if (!a) return;
    if (a.dataset.trip) { const t = trips().find((x) => x.id === a.dataset.trip); if (t) start(t); return; }
    S.loadSki().then((ski) => { const h = (ski?.huts || []).find((x) => x.id === a.dataset.hut); if (h) open(h); });
  });
  card.addEventListener("click", (e) => { if (!cur && e.target.closest(".sk-x")) close(); });
  btn.addEventListener("click", () => { if (btn.getAttribute("aria-pressed") === "true") close(); else showList(); });

  // "🏕 Plan a cabin trip here" on a cabin's details (not shelters you can't sleep in, parking or route starts).
  window.addEventListener("tf:ski-select", (e) => {
    const h = e.detail && e.detail.item, d = $("skDetail");
    if (!h || !d || h.lat == null || h.src === "c2c" || /^(parking|trailhead|shelter)$/.test(h.kind || "")) return;
    const row = document.createElement("button");
    row.type = "button"; row.className = "sk-tripgo"; row.textContent = "🏕 Plan a cabin trip here";
    row.addEventListener("click", () => open(h));
    const head = d.firstElementChild;
    if (head) head.after(row); else d.prepend(row);
  });
  window.addEventListener("tf:sport", () => { if (!isSki()) close(); });
  { const o = trips().find(late); if (o && window.tfToast) setTimeout(() => window.tfToast(`Past your out time from ${hutName(o)}: open 🏕 Cabin trip and tap We're out safe.`), 2500); }
  // Trips from the rider's other devices (account.js): the list shows them, and an open trip changed or deleted there follows.
  window.addEventListener("tf:settings-synced", (e) => {
    if (!e.detail.includes("skiTrips") || card.hidden) return;
    if (!cur) { showList(true); return; }
    const t = trips().find((x) => x.id === cur.id);
    if (!t) close();
    else if ((t.ed || 0) > (cur.ed || 0)) { cur = t; view = null; render(); drawWay(); loadDays(t); }
  });
  window.tfCabinTrip = { open, list: showList, close };
})();
