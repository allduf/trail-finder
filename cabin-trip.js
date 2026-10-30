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
  const renderDays = () => { const el = $("tpDays"); if (el && cur) el.innerHTML = `<h4>Each day</h4>${daysHtml()}`; };

  card.addEventListener("change", (e) => {
    if (!cur || e.target.dataset.tp !== "date" || !e.target.value) return;
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
      ${mine.length ? `<ul class="tp-list">${mine.map((t) => `<li><button type="button" data-trip="${esc(t.id)}"><span>${esc(t.hut.name || "Cabin")}</span><small>${esc(dayWord(t.date))} · ${t.nights} night${t.nights > 1 ? "s" : ""}</small></button></li>`).join("")}</ul>` : ""}
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
