// Skiing, the second sport in the header's sport menu (MTB / Skiing / Hiking later).
// In Skiing the map shows backcountry ski routes and huts instead of the MTB trails, with a list of the routes in
// view, and an "Avalanche risk" button that shades the mountain faces by Avalanche Canada's forecast, on the flat
// map and on the 3D map: each slope steep enough to slide (about 25° and more) gets the danger colour of its
// elevation band, and stripes where its aspect and elevation are named in the day's avalanche problems.
// Also a "Ski heatmap" of winter OpenStreetMap GPS traces, and "Your ski tours" from the rider's own rides.
// Data: data/ski.json and data/avalanche.json, made by .github/workflows/winter-data.yml; data/ski-heat.json, made
// by .github/workflows/ski-heat.yml; your tours from this browser's IndexedDB "trail-finder-rides" (ride.html).
// Terrain heights: AWS Terrain Tiles (Mapzen, open, no key).
(() => {
  "use strict";
  const map = window.tfLeaflet, sel = document.getElementById("sport"), avyBtn = document.getElementById("avyBtn");
  if (!map || !sel || !window.L) return;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {   // "tf:setting" tells account.js (optional sign-in) to save settings to the rider's account
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const TYPES = {
    tour: { label: "Ski touring", color: "#1f5fe0", weight: 3.5 },
    access: { label: "Ski access (ski=yes)", color: "#1f5fe0", weight: 2.5, dashArray: "8 6" },
    nordic: { label: "Nordic / cross-country", color: "#0b9bb5", weight: 3 },
    snowshoe: { label: "Snowshoe", color: "#8b4fe0", weight: 3, dashArray: "6 5" },
    sled: { label: "Snowmobile / sled", color: "#3a3a42", weight: 2.5, dashArray: "2 6" },
    resort: { label: "Ski resort runs", color: "#6b7787", weight: 2 },
    other: { label: "Other winter routes", color: "#8e9aab", weight: 2 },
  };
  const HUT = { label: "Huts and cabins", color: "#7a2e10" };
  const HEAT = { label: "Ski heatmap", ramp: ["#2b59c3", "#00b4d8", "#ffd23f", "#ff6a1a"] };   // 1, 2, 3-5, 6+ traces
  const MINE = { label: "Your ski tours", color: "#e0218a" };
  // Avalanche Canada's danger scale colours.
  const DANGER = [
    { label: "No rating", color: "#9aa3ad" }, { label: "1 Low", color: "#52ba4a" }, { label: "2 Moderate", color: "#fff300" },
    { label: "3 Considerable", color: "#f79218" }, { label: "4 High", color: "#ef1c29" }, { label: "5 Extreme", color: "#1a1a1a" },
  ];
  const BANDS = [["alp", "Alpine"], ["tln", "Treeline"], ["btl", "Below treeline"]];
  const ASPECTS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  // Where treeline sits, roughly (m): wetter coast ranges lower than the drier inland ranges (Duffey, Lillooet).
  const bandsFor = (area) => /inland|duffey|lillooet|chilcotin|cariboo|interior/i.test(area.name || "") ? { lo: 1700, hi: 2200 } : { lo: 1500, hi: 1900 };

  const css = document.createElement("style");
  css.textContent = `
.brand .sport-pick { font: inherit; font-size: .85rem; font-weight: 700; color: #fff; padding: 6px 28px 6px 12px; border-radius: 999px; cursor: pointer;
  background: rgba(255,255,255,.1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23fff' stroke-width='1.6'/%3E%3C/svg%3E") right 11px center no-repeat;
  border: 1px solid rgba(255,255,255,.28); appearance: none; -webkit-appearance: none; }
.brand .sport-pick:hover { background-color: rgba(255,255,255,.18); }
.brand .sport-pick option { color: #15211a; background: #fff; }
body.sport-ski .panel .modes, body.sport-ski .panel .pane, body.sport-ski #boxBtn, body.sport-ski .tap-hint, body.sport-ski #boxRes,
body.sport-ski #status, body.sport-ski #debug, body.sport-ski #list, body.sport-ski #detail, body.sport-ski #allBtn,
body.sport-ski details.legend, body.sport-ski #searchArea { display: none !important; }
body:not(.sport-ski) #avyBtn, body:not(.sport-ski) #skiPane { display: none !important; }
.map-tools #avyBtn.on { background: #f79218; border-color: #f79218; color: #1a1a1a; }
#skiPane { display: flex; flex-direction: column; gap: 12px; font-size: .9rem; }
#skiPane .sk-hint { color: var(--muted); margin: 0; font-size: .85rem; }
#skiPane .sk-chips { display: flex; flex-wrap: wrap; gap: 6px; }
#skiPane .sk-chip { font: inherit; font-size: .8rem; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
#skiPane .sk-chip[aria-pressed="false"] { opacity: .55; }
#skiPane .sk-chip .n { color: var(--muted); font-weight: 500; }
#skiPane .sk-sw { width: 18px; height: 4px; border-radius: 2px; flex: none; display: inline-block; }
#skiPane .sk-dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px #0003; flex: none; display: inline-block; }
#skiPane ul.sk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
#skiPane .sk-list li button { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 8px; cursor: pointer; }
#skiPane .sk-list li button:hover, #skiPane .sk-list li button[aria-current="true"] { background: var(--chip); }
#skiPane .sk-list .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
#skiPane .sk-list .meta { color: var(--muted); font-size: .78rem; white-space: nowrap; }
#skiPane .sk-card { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: var(--panel); display: flex; flex-direction: column; gap: 6px; }
#skiPane .sk-card h3 { margin: 0; font-size: 1rem; }
#skiPane .sk-card dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: .82rem; }
#skiPane .sk-card dt { color: var(--muted); }
#skiPane .sk-card dd { margin: 0; overflow-wrap: anywhere; }
#skiPane .sk-x { float: right; font: inherit; border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 1rem; }
#skiPane .av-days { display: flex; gap: 4px; flex-wrap: wrap; }
#skiPane .av-days button { font: inherit; font-size: .8rem; font-weight: 600; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
#skiPane .av-days button[aria-pressed="true"] { background: var(--fg); color: var(--panel); border-color: var(--fg); }
#skiPane .av-rate { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; font-size: .85rem; }
#skiPane .av-chip { font-weight: 700; font-size: .78rem; padding: 2px 8px; border-radius: 6px; text-align: center; min-width: 108px; }
#skiPane .av-prob { display: grid; grid-template-columns: 74px 1fr; gap: 10px; align-items: start; border-top: 1px solid var(--line); padding-top: 8px; }
#skiPane .av-prob b { display: block; }
#skiPane .av-prob p, #skiPane .av-card p { margin: 2px 0; font-size: .82rem; }
#skiPane .av-warn { background: #fff3cd; color: #5c4400; border-radius: 8px; padding: 6px 8px; font-size: .82rem; font-weight: 600; }
#skiPane .av-legend { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; font-size: .8rem; }
#skiPane .av-legend i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; border: 1px solid #0002; }
#skiPane details summary { cursor: pointer; font-weight: 600; font-size: .85rem; }
#skiPane details p { white-space: pre-line; }
#skiPane .sk-safe { font-size: .78rem; color: var(--muted); margin: 0; }`;
  document.head.append(css);

  // ---------- the sport menu ----------
  const SPORTS = ["mtb", "ski"];
  let sport = SPORTS.includes(store.get("sport", "mtb")) ? store.get("sport", "mtb") : "mtb";
  let avyOn = store.get("avy", false);

  // ---------- panel ----------
  const pane = document.createElement("section");
  pane.id = "skiPane";
  pane.setAttribute("aria-label", "Skiing");
  pane.innerHTML = `
    <p class="sk-hint">Backcountry ski routes and huts from OpenStreetMap, BC Recreation Sites and Trails and camptocamp.org, a heatmap of winter GPS traces, and your own ski tours (<a href="ride.html#rides">import them in My rides</a>). Tap a route for its details. <strong>Avalanche risk</strong> (on the map) shades the slopes by today's avalanche forecast.</p>
    <div class="av-card sk-card" id="avCard" hidden></div>
    <div class="sk-chips" id="skChips" role="group" aria-label="Show these routes"></div>
    <div class="sk-card" id="skDetail" hidden></div>
    <div><div class="label" id="skCount">Routes in view</div><ul class="sk-list" id="skList"></ul></div>
    <p class="sk-safe">Routes on open maps can be wrong, old or missing, and none of them is avalanche-safe on its own. Backcountry travel needs avalanche training (AST 1), a beacon, probe and shovel, and the day's forecast.</p>`;
  const head = document.querySelector(".panel-head");
  const modes = head && head.querySelector(".modes");
  if (modes) modes.after(pane); else if (head) head.append(pane);
  const $ = (id) => document.getElementById(id);

  // ---------- ski routes ----------
  map.createPane("ski").style.zIndex = 420;
  const skiRenderer = L.canvas({ pane: "ski", padding: 0.3, tolerance: L.Browser.touch ? 10 : 5 });
  const skiLayer = L.layerGroup();
  const hutLayer = L.layerGroup();
  let ski = null, skiLoading = null, skiErr = "";
  let shown = new Set(store.get("skiTypes", ["tour", "access", "nordic", "snowshoe", "sled", "other", "hut", "heat", "mine"]));
  if (!store.get("skiHeatChips", false)) { shown.add("heat"); shown.add("mine"); store.set("skiHeatChips", true); store.set("skiTypes", [...shown]); }
  let selected = null;   // route or hut object
  const lineOf = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
  const km = (r) => {
    if (r.km != null) return r.km;
    let m = 0;
    for (const part of r.g) for (let i = 2; i < part.length; i += 2) m += map.distance([part[i - 2], part[i - 1]], [part[i], part[i + 1]]);
    return (r.km = m / 1000);
  };
  function loadSki() {
    if (ski || skiLoading) return skiLoading;
    skiLoading = fetch("data/ski.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => {
        ski = d;
        (d.routes || []).forEach((r) => { r.lines = r.g.map(lineOf); r.bounds = L.latLngBounds(r.lines.flat()); });
        drawSki(); renderChips(); renderList();
      })
      .catch((e) => { skiErr = e.message; renderList(); })
      .finally(() => { skiLoading = null; });
    return skiLoading;
  }
  function drawSki() {
    skiLayer.clearLayers(); hutLayer.clearLayers();
    if (!ski) return;
    for (const r of ski.routes || []) {
      if (!shown.has(r.type)) continue;
      const t = TYPES[r.type] || TYPES.other, sel = selected === r;
      r.layers = [];
      for (const line of r.lines) {
        skiLayer.addLayer(L.polyline(line, { renderer: skiRenderer, color: sel ? "#ffe14d" : "#fff", weight: t.weight + (sel ? 6 : 3), opacity: sel ? 1 : 0.8, interactive: false }));
        const l = L.polyline(line, { renderer: skiRenderer, color: t.color, weight: t.weight + (sel ? 1.5 : 0), opacity: 1, dashArray: t.dashArray });
        l.bindTooltip(esc(r.name || t.label), { sticky: true });
        l.on("click", (e) => { L.DomEvent.stopPropagation(e); select(r); });
        skiLayer.addLayer(l);
      }
    }
    if (shown.has("hut")) for (const h of ski.huts || []) {
      const m = L.circleMarker([h.lat, h.lon], { renderer: skiRenderer, radius: selected === h ? 9 : 6, color: "#fff", weight: 2, fillColor: HUT.color, fillOpacity: 1 });
      m.bindTooltip(esc(h.name || "Hut"));
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); select(h); });
      hutLayer.addLayer(m);
    }
  }
  function counts() {
    const c = {};
    (ski?.routes || []).forEach((r) => { c[r.type] = (c[r.type] || 0) + 1; });
    c.hut = (ski?.huts || []).length;
    c.heat = heat ? heat.traces : 0;
    c.mine = mine.length;
    return c;
  }
  function renderChips() {
    const c = counts();
    const keys = [...Object.keys(TYPES).filter((k) => c[k]), "hut", "heat", ...(mine.length ? ["mine"] : [])];
    $("skChips").innerHTML = keys.map((k) => {
      const t = TYPES[k] || { hut: HUT, heat: HEAT, mine: MINE }[k];
      const sw = k === "hut" ? `<span class="sk-dot" style="background:${HUT.color}"></span>`
        : k === "heat" ? `<span class="sk-sw" style="background:linear-gradient(90deg, ${HEAT.ramp.join(", ")})"></span>`
        : `<span class="sk-sw" style="background:${t.dashArray ? `repeating-linear-gradient(90deg, ${t.color} 0 5px, transparent 5px 8px)` : t.color}"></span>`;
      const n = k === "heat" ? (heat ? `${c.heat} traces` : heatErr ? "not yet" : "…") : c[k] || 0;
      return `<button type="button" class="sk-chip" data-k="${k}" aria-pressed="${shown.has(k)}"${k === "heat" ? ' title="Public OpenStreetMap GPS traces from December to April, roads and lifts left out"' : ""}>${sw}${t.label} <span class="n">${n}</span></button>`;
    }).join("");
    $("skChips").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.k;
      shown.has(k) ? shown.delete(k) : shown.add(k);
      store.set("skiTypes", [...shown]);
      renderChips(); drawSki(); renderList(); refreshHeat(); drawMine();
    }));
  }
  const typeOrder = Object.keys(TYPES);
  function renderList() {
    const list = $("skList");
    if (!ski) { $("skCount").textContent = "Routes in view"; list.innerHTML = `<li class="sk-hint">${skiErr ? "The ski route list isn't on the site yet (it's collected every night). Try again later." : "Loading ski routes…"}</li>`; return; }
    const b = map.getBounds();
    const items = (ski.routes || []).filter((r) => shown.has(r.type) && b.intersects(r.bounds));
    const huts = shown.has("hut") ? (ski.huts || []).filter((h) => b.contains([h.lat, h.lon])) : [];
    // Named routes first, then by type; pieces with the same name and type are one entry.
    const groups = new Map();
    for (const r of items) {
      const key = r.name ? r.type + "|" + r.name.toLowerCase() : r.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const rows = [...groups.values()].sort((a, b2) => (!a[0].name - !b2[0].name) || typeOrder.indexOf(a[0].type) - typeOrder.indexOf(b2[0].type) || (a[0].name || "").localeCompare(b2[0].name || ""));
    $("skCount").textContent = `${rows.length} route${rows.length === 1 ? "" : "s"} and ${huts.length} hut${huts.length === 1 ? "" : "s"} in view`;
    const MAX = 120;
    list.innerHTML = huts.slice(0, 30).map((h, i) => `<li><button type="button" data-h="${i}"${selected === h ? ' aria-current="true"' : ""}><span class="sk-dot" style="background:${HUT.color}"></span><span class="nm">${esc(h.name || "Hut")}</span><span class="meta">${h.tags?.ele ? esc(h.tags.ele) + " m" : "hut"}</span></button></li>`).join("")
      + rows.slice(0, MAX).map((g, i) => {
        const r = g[0], t = TYPES[r.type] || TYPES.other, len = g.reduce((s, x) => s + km(x), 0);
        return `<li><button type="button" data-g="${i}"${g.includes(selected) ? ' aria-current="true"' : ""}><span class="sk-sw" style="background:${t.color}"></span><span class="nm">${esc(r.name || "Unnamed " + t.label.toLowerCase())}</span><span class="meta">${len.toFixed(1)} km${r.diff ? " · " + esc(r.diff) : ""}</span></button></li>`;
      }).join("")
      + (rows.length > MAX ? `<li class="sk-hint">…and ${rows.length - MAX} more: zoom in.</li>` : "")
      + (!rows.length && !huts.length ? `<li class="sk-hint">No ski routes in view. Zoom out or move the map.</li>` : "");
    list.querySelectorAll("button[data-g]").forEach((bt) => bt.addEventListener("click", () => select(rows[+bt.dataset.g], true)));
    list.querySelectorAll("button[data-h]").forEach((bt) => bt.addEventListener("click", () => select(huts[+bt.dataset.h], true)));
  }
  function select(it, fly) {
    const group = Array.isArray(it) ? it : [it];
    const r = group[0];
    selected = r;
    drawSki(); renderList();
    if (fly) {
      if (r.lat != null) map.setView([r.lat, r.lon], Math.max(map.getZoom(), 14));
      else map.fitBounds(group.reduce((b, x) => b.extend(x.bounds), L.latLngBounds(r.bounds.getSouthWest(), r.bounds.getNorthEast())), { padding: [30, 30], maxZoom: 15 });
    }
    const d = $("skDetail");
    const isHut = r.lat != null, t = isHut ? HUT : TYPES[r.type] || TYPES.other;
    const osmType = { w: "way", r: "relation", n: "node" }[r.id[0]];
    const src = r.src === "bc"
      ? `BC Recreation Sites and Trails (<a href="https://www.sitesandtrailsbc.ca/" target="_blank" rel="noopener">sitesandtrailsbc.ca</a>)`
      : r.src === "c2c"
      ? `<a href="https://www.camptocamp.org/routes/${esc(r.id.slice(3))}" target="_blank" rel="noopener">camptocamp.org</a> (CC BY-SA)`
      : `<a href="https://www.openstreetmap.org/${osmType}/${r.id.slice(1)}" target="_blank" rel="noopener">OpenStreetMap</a>`;
    const tags = Object.entries(r.tags || {}).filter(([k]) => !/^(name|piste:name)$/.test(k));
    const area = (avy || example) && areaAt(isHut ? r.lat : r.lines[0][0][0], isHut ? r.lon : r.lines[0][0][1]);
    d.hidden = false;
    d.innerHTML = `<div><button type="button" class="sk-x" aria-label="Close">✕</button><h3>${esc(r.name || (isHut ? "Hut" : "Unnamed route"))}</h3></div>
      <dl><dt>Type</dt><dd>${esc(isHut ? (r.kind || "hut").replace(/_/g, " ") : t.label)}</dd>
      ${isHut ? "" : `<dt>Length</dt><dd>${group.reduce((s, x) => s + km(x), 0).toFixed(1)} km${group.length > 1 ? ` (${group.length} pieces)` : ""}</dd>`}
      ${r.diff ? `<dt>Difficulty</dt><dd>${esc(r.diff)}</dd>` : ""}
      ${r.routes ? `<dt>Part of</dt><dd>${esc(r.routes.join(", "))}</dd>` : ""}
      ${tags.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${/^https?:\/\//.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v)}</dd>`).join("")}
      <dt>Source</dt><dd>${src}</dd>
      ${area && area.forecast ? `<dt>Avalanche</dt><dd>${esc(area.forecast.title || area.name)}: ${dayOf(area.forecast) ? BANDS.map(([b, n]) => `${n} ${DANGER[dayOf(area.forecast)[b]].label}`).join(", ") : "no rating"}</dd>` : ""}</dl>`;
    d.querySelector(".sk-x").addEventListener("click", () => { selected = null; d.hidden = true; drawSki(); renderList(); });
  }
  map.on("moveend", () => { if (sport === "ski") { renderList(); if (avyOn) renderForecast(); } });

  // ---------- avalanche forecast ----------
  let avy = null, avyLoading = null, avyErr = "", example = false, day = 0;
  function prepAreas(d) {
    (d.areas || []).forEach((a) => {
      a.polys = (a.rings || []).map((r) => { const pts = []; for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]); return pts; });
      const all = a.polys.flat();
      a.box = all.length ? [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))] : null;
      a.bands = bandsFor(a);
      // Bit masks of the aspects named in the problems, per elevation band.
      a.mask = { alp: 0, tln: 0, btl: 0 };
      (a.forecast?.problems || []).forEach((p) => (p.elevations || []).forEach((b) => (p.aspects || []).forEach((s) => { if (b in a.mask) a.mask[b] |= 1 << ASPECTS.indexOf(s); })));
    });
    return d;
  }
  function loadAvy() {
    if (avy || avyLoading) return avyLoading;
    avyLoading = fetch("data/avalanche.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { avy = prepAreas(d); refreshAvy(); })
      .catch((e) => { avyErr = e.message; renderForecast(); })
      .finally(() => { avyLoading = null; });
    return avyLoading;
  }
  function inPoly(lat, lon, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ay, ax] = poly[i], [by, bx] = poly[j];
      if ((ay > lat) !== (by > lat) && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  }
  function areaAt(lat, lon) {
    for (const a of (example ? exampleData() : avy)?.areas || []) {
      if (!a.box || lat < a.box[0] || lat > a.box[2] || lon < a.box[1] || lon > a.box[3]) continue;
      if (a.polys.some((p) => inPoly(lat, lon, p))) return a;
    }
    return null;
  }
  const dayOf = (f) => f && f.days && (f.days[Math.min(day, f.days.length - 1)] || null);
  const hasForecasts = () => (avy?.areas || []).some((a) => a.forecast && a.forecast.days?.length);

  // A made-up forecast to try the shading out of season, clearly marked as an example.
  let exampleCache = null;
  function exampleData() {
    if (exampleCache) return exampleCache;
    const box = (s, w, n, e) => [s, w, s, e, n, e, n, w, s, w];
    const today = new Date();
    const dayN = (i) => { const d = new Date(today); d.setDate(d.getDate() + i); return { date: d.toISOString().slice(0, 10), label: d.toLocaleDateString(undefined, { weekday: "long" }) }; };
    const fc = (title, days, problems) => ({ title, url: "https://avalanche.ca/map", issued: today.toISOString(), validUntil: "", highlights: "Example only. This is not a real forecast.", days, problems, summaries: {} });
    return (exampleCache = prepAreas({ example: true, areas: [
      { id: "ex-s2s", name: "Sea to Sky (example)", rings: [box(49.25, -124.0, 50.62, -122.55)], forecast: fc("Sea to Sky (example)",
        [{ ...dayN(0), alp: 3, tln: 3, btl: 2 }, { ...dayN(1), alp: 3, tln: 2, btl: 1 }, { ...dayN(2), alp: 2, tln: 2, btl: 1 }],
        [{ type: "Wind Slab", aspects: ["n", "ne", "e"], elevations: ["alp", "tln"], likelihood: "Likely", size: "1-2", comment: "Example: fresh wind slabs on lee slopes below ridgecrests." },
          { type: "Persistent Slab", aspects: ["n", "ne", "e", "se", "s", "sw", "w", "nw"], elevations: ["alp"], likelihood: "Possible", size: "2-3", comment: "Example: a buried weak layer that can be triggered from thin spots." }]) },
      { id: "ex-sci", name: "South Coast Inland (example)", rings: [box(50.42, -122.55, 51.25, -121.7)], forecast: fc("South Coast Inland (example)",
        [{ ...dayN(0), alp: 2, tln: 2, btl: 1 }, { ...dayN(1), alp: 2, tln: 2, btl: 1 }, { ...dayN(2), alp: 2, tln: 1, btl: 1 }],
        [{ type: "Storm Slab", aspects: ["n", "ne", "e", "se", "s", "sw", "w", "nw"], elevations: ["alp", "tln"], likelihood: "Possible", size: "1-1.5", comment: "Example." }]) },
    ] }));
  }

  // Avalanche Canada's aspect and elevation diagram: rings for alpine (inside), treeline and below treeline (outside).
  function rose(p) {
    const R = [0, 13, 26, 39], cx = 40, cy = 40, pt = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)].map((v) => v.toFixed(1)).join(" ");
    let s = "";
    BANDS.forEach(([b], ring) => ASPECTS.forEach((asp, k) => {
      const a0 = ((k * 45 - 22.5) * Math.PI) / 180, a1 = ((k * 45 + 22.5) * Math.PI) / 180, r0 = R[ring], r1 = R[ring + 1];
      const on = p.elevations.includes(b) && p.aspects.includes(asp);
      const d = r0 ? `M${pt(r0, a0)} L${pt(r1, a0)} A${r1} ${r1} 0 0 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0} ${r0} 0 0 0 ${pt(r0, a0)}Z` : `M${cx} ${cy} L${pt(r1, a0)} A${r1} ${r1} 0 0 1 ${pt(r1, a1)}Z`;
      s += `<path d="${d}" fill="${on ? "#2a3b4c" : "#e8ecef"}" stroke="#fff" stroke-width="1"/>`;
    }));
    return `<svg viewBox="0 0 80 88" width="74" height="81" role="img" aria-label="${esc(p.type)}: ${esc(p.aspects.join(", ").toUpperCase())} aspects, ${esc(p.elevations.join(", "))}">${s}<text x="40" y="86" text-anchor="middle" font-size="8" fill="currentColor">N at top</text></svg>`;
  }
  function renderForecast() {
    const card = $("avCard");
    card.hidden = !(sport === "ski" && avyOn);
    if (card.hidden) return;
    const data = example ? exampleData() : avy;
    if (!data) { card.innerHTML = avyErr ? `<p>The avalanche forecast isn't on the site yet (it's collected every 2 hours). <button type="button" class="linkish" id="avEx">Show an example</button></p>` : "<p>Loading the avalanche forecast…</p>"; bindEx(); return; }
    if (!example && !hasForecasts()) {
      card.innerHTML = `<h3>Avalanche forecast</h3><p>No avalanche forecast right now. Avalanche Canada publishes daily forecasts in winter, usually from late November to April; the site checks every 2 hours${data.builtAt ? ` (last check ${new Date(data.builtAt).toLocaleString()})` : ""}.</p>
        <p><button type="button" class="btn" id="avEx">Show an example forecast</button></p>
        <p><a href="https://avalanche.ca/map" target="_blank" rel="noopener">Avalanche Canada map</a></p>`;
      bindEx(); return;
    }
    const c = map.getCenter();
    const area = (example ? null : areaAt(c.lat, c.lng)) || (data.areas.find((a) => a.polys.some((p) => inPoly(c.lat, c.lng, p))) || data.areas.find((a) => a.forecast?.days?.length));
    const f = area && area.forecast;
    if (!area) { card.innerHTML = "<h3>Avalanche forecast</h3><p>No forecast area here.</p>"; return; }
    if (!f || !f.days?.length) { card.innerHTML = `<h3>${esc(area.name)}</h3><p>No forecast for this area right now.</p>`; return; }
    const d = dayOf(f), expired = !example && f.validUntil && new Date(f.validUntil) < new Date();
    const chip = (r) => `<span class="av-chip" style="background:${DANGER[r].color};color:${r >= 4 ? "#fff" : "#1a1a1a"}">${DANGER[r].label}</span>`;
    card.innerHTML = `${example ? `<div class="av-warn">EXAMPLE, not a real forecast. It only shows how the shading works.</div>` : ""}
      ${expired ? `<div class="av-warn">This forecast has expired. Check avalanche.ca for the latest.</div>` : ""}
      <h3>Avalanche forecast: ${esc(f.title || area.name)}</h3>
      <p class="sk-hint">${f.issued ? "Issued " + esc(new Date(f.issued).toLocaleString()) : ""}${f.owner ? " by " + esc(f.owner) : ""}. For the area in the middle of the map.</p>
      <div class="av-days" role="group" aria-label="Day">${f.days.map((x, i) => `<button type="button" data-d="${i}" aria-pressed="${x === d}">${esc(x.label || x.date)}</button>`).join("")}</div>
      <div class="av-rate">${BANDS.map(([b, n]) => `<span>${n}</span>${chip(d[b])}`).join("")}</div>
      ${!example && f.days.every((x) => !x.alp && !x.tln && !x.btl) ? `<p>No danger ratings yet (early season), so no slopes are shaded. <button type="button" class="linkish" id="avEx">Show an example forecast</button></p>` : ""}
      ${f.highlights ? `<p><strong>${esc(f.highlights)}</strong></p>` : ""}
      ${(f.problems || []).map((p) => `<div class="av-prob">${rose(p)}<div><b>${esc(p.type)}</b><p>${esc(p.aspects.map((s) => s.toUpperCase()).join(" "))} · ${esc(p.elevations.map((b) => BANDS.find((x) => x[0] === b)[1]).join(", "))}</p><p>${p.likelihood ? "Likelihood: " + esc(p.likelihood) : ""}${p.size ? " · Size " + esc(p.size) : ""}</p>${p.comment ? `<details><summary>More</summary><p>${esc(p.comment)}</p></details>` : ""}</div></div>`).join("")}
      ${Object.values(f.summaries || {}).filter(Boolean).length ? `<details><summary>Forecaster's notes</summary>${Object.values(f.summaries).filter(Boolean).map((s) => `<p>${esc(s)}</p>`).join("")}</details>` : ""}
      <details><summary>What the map colours mean</summary>
        <ul class="av-legend">${DANGER.slice(1).map((x) => `<li><i style="background:${x.color}"></i>${x.label}</li>`).join("")}<li><i style="background:repeating-linear-gradient(135deg,#f79218 0 3px,#7a4a0c 3px 5px)"></i>Problem aspect</li></ul>
        <p>Only slopes steeper than about 25° are shaded: that's where avalanches start. Each slope gets the danger rating of its elevation band (below treeline under about ${area.bands.lo} m, alpine above about ${area.bands.hi} m here; the real treeline varies). Stripes and stronger colour mark the aspects and elevations named in the avalanche problems above. Gentle slopes under steep ones are left clear but can still be hit from above. This is an estimate from the forecast and the terrain shape, not a terrain rating.</p></details>
      <p><a href="${esc(f.url || "https://avalanche.ca/map")}" target="_blank" rel="noopener">Full forecast on avalanche.ca</a>${example ? ` · <button type="button" class="linkish" id="avExOff">Hide the example</button>` : ""}</p>`;
    card.querySelectorAll(".av-days button").forEach((b) => b.addEventListener("click", () => { day = +b.dataset.d; refreshAvy(); }));
    const off = $("avExOff"); if (off) off.addEventListener("click", () => { example = false; refreshAvy(); });
    bindEx();
  }
  function bindEx() { const b = $("avEx"); if (b) b.addEventListener("click", () => { example = true; refreshAvy(); }); }

  // ---------- slope shading ----------
  // Terrain heights: AWS Terrain Tiles (Terrarium colour code), 256 px, up to zoom 14 here.
  const DEM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const demCache = new Map();
  function dem(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (demCache.has(key)) { const p = demCache.get(key); demCache.delete(key); demCache.set(key, p); return p; }
    const p = fetch(DEM(z, x, y)).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); }).then(createImageBitmap).then((bmp) => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 256;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0, 256, 256);
      const px = cx.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
      return e;
    });
    p.catch(() => demCache.delete(key));
    demCache.set(key, p);
    if (demCache.size > 80) demCache.delete(demCache.keys().next().value);
    return p;
  }
  const tileLat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  const tileLon = (x, z) => (x / 2 ** z) * 360 - 180;
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const COLORS = DANGER.map((d) => rgb(d.color));
  // Pixels at low zoom are hundreds of metres wide, which flattens slopes: ask for less steepness there.
  const minSlope = (z) => (z >= 12 ? 25 : z === 11 ? 21 : z === 10 ? 17 : z === 9 ? 13 : 10);
  async function paint(z, x, y) {
    const data = example ? exampleData() : avy;
    const out = new ImageData(256, 256);
    if (!data) return out;
    // Which forecast area each 16 px block is in.
    const B = 16, areas = new Array(B * B);
    let any = false;
    for (let by = 0; by < B; by++) for (let bx = 0; bx < B; bx++) {
      const lat = tileLat(y + (by + 0.5) / B, z), lon = tileLon(x + (bx + 0.5) / B, z);
      const a = data.areas.find((a) => a.box && lat >= a.box[0] && lat <= a.box[2] && lon >= a.box[1] && lon <= a.box[3] && a.polys.some((p) => inPoly(lat, lon, p)));
      const d = a && dayOf(a.forecast);
      areas[by * B + bx] = d ? { a, d } : null;
      if (d) any = true;
    }
    if (!any) return out;
    const E = await dem(z, x, y), o = out.data, thr = minSlope(z), k = 25 / thr;
    for (let py = 0; py < 256; py++) {
      const lat = tileLat(y + (py + 0.5) / 256, z), m = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
      const y0 = py > 0 ? py - 1 : py, y1 = py < 255 ? py + 1 : py;
      for (let px = 0; px < 256; px++) {
        const cell = areas[(py >> 4) * B + (px >> 4)];
        if (!cell) continue;
        const i = py * 256 + px, e = E[i];
        if (e < 0) continue;
        const x0 = px > 0 ? px - 1 : px, x1 = px < 255 ? px + 1 : px;
        const dzdx = (E[py * 256 + x1] - E[py * 256 + x0]) / ((x1 - x0) * m), dzdy = (E[y1 * 256 + px] - E[y0 * 256 + px]) / ((y1 - y0) * m);
        const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI * k;
        if (slope < 25) continue;
        const { a, d } = cell;
        const band = e >= a.bands.hi ? "alp" : e >= a.bands.lo ? "tln" : "btl", r = d[band];
        if (!r) continue;
        // Downhill direction: east = -dz/dx, north = +dz/dy (pixel rows run south).
        const asp = ((Math.atan2(-dzdx, dzdy) * 180) / Math.PI + 360) % 360, sector = Math.round(asp / 45) % 8;
        const hit = a.mask[band] & (1 << sector);
        let alpha = slope < 30 ? 0.3 : slope < 45 ? 0.55 : 0.42;
        let [cr, cg, cb] = COLORS[r];
        if (hit) { alpha = Math.min(0.85, alpha + 0.22); if ((px + py) % 7 < 2) { cr *= 0.45; cg *= 0.45; cb *= 0.45; } }
        const j = i * 4;
        o[j] = cr; o[j + 1] = cg; o[j + 2] = cb; o[j + 3] = alpha * 255;
      }
    }
    return out;
  }

  // 2D map layer
  map.createPane("avy").style.zIndex = 360;
  const AvyGrid = L.GridLayer.extend({
    createTile(c, done) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      paint(c.z, c.x, c.y).then((img) => { cv.getContext("2d").putImageData(img, 0, 0); done(null, cv); }, (e) => done(e, cv));
      return cv;
    },
  });
  const avyGrid = new AvyGrid({ pane: "avy", minZoom: 8, maxNativeZoom: 14, maxZoom: 20, attribution: 'Avalanche forecast: <a href="https://avalanche.ca">Avalanche Canada</a> · Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a>' });

  // 3D map layer, through a tile protocol that paints the same tiles as PNGs.
  let ver = 0, protocol = false;
  function sync3d() {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    if (!protocol) {
      protocol = true;
      maplibregl.addProtocol("tfavy", async (params) => {
        const [z, x, y] = params.url.replace("tfavy://", "").split("?")[0].split("/").map(Number);
        const img = await paint(z, x, y);
        const cv = new OffscreenCanvas(256, 256);
        cv.getContext("2d").putImageData(img, 0, 0);
        return { data: await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer() };
      });
    }
    const want = sport === "ski" && avyOn;
    const apply = () => {
      if (!gl.getStyle()) return;
      const has = !!gl.getLayer("avy");
      if (!want) { if (has) gl.removeLayer("avy"); if (gl.getSource("avy")) gl.removeSource("avy"); return; }
      const tiles = [`tfavy://{z}/{x}/{y}?v=${ver}`];
      if (gl.getSource("avy")) gl.getSource("avy").setTiles(tiles);
      else gl.addSource("avy", { type: "raster", tiles, tileSize: 256, minzoom: 8, maxzoom: 14, attribution: "Avalanche forecast: <a href=\"https://avalanche.ca\">Avalanche Canada</a>" });
      if (!has) gl.addLayer({ id: "avy", type: "raster", source: "avy", paint: { "raster-fade-duration": 0 } }, gl.getLayer("osm-roads") ? "osm-roads" : undefined);
    };
    if (gl.isStyleLoaded()) apply(); else gl.once("styledata", apply);
  }
  window.addEventListener("tf:map3d", sync3d);

  function refreshAvy() {
    ver++;
    const want = sport === "ski" && avyOn;
    if (want && !avy && !example) loadAvy();
    if (want) { if (!map.hasLayer(avyGrid)) avyGrid.addTo(map); else avyGrid.redraw(); }
    else if (map.hasLayer(avyGrid)) map.removeLayer(avyGrid);
    sync3d();
    renderForecast();
    if (selected && sport === "ski") { const d = $("skDetail"); if (!d.hidden) select(selected); }
    avyBtn.classList.toggle("on", avyOn);
    avyBtn.setAttribute("aria-pressed", String(avyOn));
  }
  avyBtn.hidden = false;
  avyBtn.title = "Shade the slopes by the avalanche forecast (Avalanche Canada)";
  avyBtn.addEventListener("click", () => {
    avyOn = !avyOn; store.set("avy", avyOn);
    if (avyOn && map.getZoom() < 9) map.setZoom(10);
    refreshAvy();
  });

  // ---------- ski heatmap (data/ski-heat.json) ----------
  // Per map square: cells of CELL_LAT x CELL_LON degrees as [row, col, traces, ...] from the square's south-west corner.
  let heat = null, heatLoading = null, heatErr = "", heatVer = 0;
  function loadHeat() {
    if (heat || heatLoading) return heatLoading;
    heatLoading = fetch("data/ski-heat.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => {
        const squares = Object.values(d.tiles || {}).filter((t) => t && t.box && t.c && t.c.length);
        heat = { cell: d.cell || [0.0003, 0.00045], builtAt: d.builtAt, squares: squares.map((t) => ({ box: t.box, c: Int32Array.from(t.c) })),
          traces: Object.values(d.tiles || {}).reduce((a, t) => a + ((t && t.n) || 0), 0) };
        heatVer++; renderChips(); refreshHeat();
      })
      .catch((e) => { heatErr = e.message; renderChips(); })
      .finally(() => { heatLoading = null; });
    return heatLoading;
  }
  const HEAT_RGB = HEAT.ramp.map(rgb);
  const mercY = (lat) => { const r = (lat * Math.PI) / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; };
  function paintHeat(z, x, y) {
    const out = new ImageData(256, 256);
    if (!heat) return out;
    const n = 2 ** z * 256, top = tileLat(y, z), bottom = tileLat(y + 1, z), left = tileLon(x, z), right = tileLon(x + 1, z);
    const [cl, co] = heat.cell, buf = new Uint16Array(65536);
    const cw = Math.max(1, (co / 360) * n);
    let any = false;
    for (const sq of heat.squares) {
      const [s, w, nn, e] = sq.box;
      if (s > top || nn < bottom || w > right || e < left) continue;
      const c = sq.c;
      for (let i = 0; i < c.length; i += 3) {
        const lat0 = s + c[i] * cl, lon0 = w + c[i + 1] * co;
        if (lat0 > top || lat0 + cl < bottom || lon0 > right || lon0 + co < left) continue;
        const px0 = ((lon0 + 180) / 360) * n - x * 256, py1 = mercY(lat0) * n - y * 256, py0 = mercY(lat0 + cl) * n - y * 256;
        const xa = Math.max(0, Math.floor(px0)), xb = Math.min(256, Math.max(xa + 1, Math.ceil(px0 + cw)));
        const ya = Math.max(0, Math.floor(py0)), yb = Math.min(256, Math.max(ya + 1, Math.ceil(py1)));
        const v = c[i + 2];
        for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) { const j = yy * 256 + xx; if (buf[j] < v) buf[j] = v; }
        any = true;
      }
    }
    if (!any) return out;
    const o = out.data;
    for (let j = 0; j < 65536; j++) {
      const v = buf[j];
      if (!v) continue;
      const k = v === 1 ? 0 : v === 2 ? 1 : v <= 5 ? 2 : 3;
      o[j * 4] = HEAT_RGB[k][0]; o[j * 4 + 1] = HEAT_RGB[k][1]; o[j * 4 + 2] = HEAT_RGB[k][2]; o[j * 4 + 3] = k ? 235 : 190;
    }
    return out;
  }
  map.createPane("skiheat").style.zIndex = 370;
  const HeatGrid = L.GridLayer.extend({
    createTile(c) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      cv.getContext("2d").putImageData(paintHeat(c.z, c.x, c.y), 0, 0);
      return cv;
    },
  });
  const heatGrid = new HeatGrid({ pane: "skiheat", minZoom: 7, maxNativeZoom: 16, maxZoom: 20, opacity: 0.85, attribution: 'Ski heatmap: <a href="https://www.openstreetmap.org/traces">OpenStreetMap public GPS traces</a> © OpenStreetMap contributors' });
  let heatProtocol = false;
  function syncHeat3d() {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    if (!heatProtocol) {
      heatProtocol = true;
      maplibregl.addProtocol("tfheat", async (params) => {
        const [z, x, y] = params.url.replace("tfheat://", "").split("?")[0].split("/").map(Number);
        const cv = new OffscreenCanvas(256, 256);
        cv.getContext("2d").putImageData(paintHeat(z, x, y), 0, 0);
        return { data: await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer() };
      });
    }
    const want = sport === "ski" && shown.has("heat") && !!heat;
    const apply = () => {
      if (!gl.getStyle()) return;
      const has = !!gl.getLayer("skiheat");
      if (!want) { if (has) gl.removeLayer("skiheat"); if (gl.getSource("skiheat")) gl.removeSource("skiheat"); return; }
      const tiles = [`tfheat://{z}/{x}/{y}?v=${heatVer}`];
      if (gl.getSource("skiheat")) gl.getSource("skiheat").setTiles(tiles);
      else gl.addSource("skiheat", { type: "raster", tiles, tileSize: 256, minzoom: 7, maxzoom: 16, attribution: "Ski heatmap: OpenStreetMap public GPS traces" });
      if (!has) gl.addLayer({ id: "skiheat", type: "raster", source: "skiheat", paint: { "raster-fade-duration": 0, "raster-opacity": 0.85 } }, gl.getLayer("osm-roads") ? "osm-roads" : undefined);
    };
    if (gl.isStyleLoaded()) apply(); else gl.once("styledata", apply);
  }
  window.addEventListener("tf:map3d", syncHeat3d);
  function refreshHeat() {
    const want = sport === "ski" && shown.has("heat");
    if (want && !heat && !heatErr) loadHeat();
    if (want && heat) { if (!map.hasLayer(heatGrid)) heatGrid.addTo(map); else heatGrid.redraw(); }
    else if (map.hasLayer(heatGrid)) map.removeLayer(heatGrid);
    syncHeat3d();
  }

  // ---------- your ski tours (rides saved in Record ride, ride.html) ----------
  const mineLayer = L.layerGroup();
  let mine = [];
  function loadRides() {
    return new Promise((resolve) => {
      let r;
      try { r = indexedDB.open("trail-finder-rides", 1); } catch { resolve([]); return; }
      r.onupgradeneeded = () => {   // same stores as ride.html
        const db = r.result;
        db.createObjectStore("rides", { keyPath: "id" });
        db.createObjectStore("photos", { keyPath: "id" }).createIndex("rideId", "rideId");
        db.createObjectStore("current", { keyPath: "id" });
      };
      r.onerror = () => resolve([]);
      r.onsuccess = () => {
        const db = r.result;
        try {
          const q = db.transaction("rides").objectStore("rides").getAll();
          q.onsuccess = () => { db.close(); resolve(q.result || []); };
          q.onerror = () => { db.close(); resolve([]); };
        } catch { db.close(); resolve([]); }
      };
    });
  }
  // A ski tour: the file says so, the name says so, or it was in winter and went high (bike parks and alpine trails are under snow).
  const SKI_SPORT = /ski|snow|board/i, SKI_NAME = /\b(ski\w*|skin\w*|splitboard\w*|snowshoe\w*|backcountry|pow(der)?)\b/i;
  function isSkiTour(r) {
    if (!r || !Array.isArray(r.points) || r.points.length < 2) return false;
    if (SKI_SPORT.test(r.sport || "") || SKI_NAME.test(r.title || "")) return true;
    const m = new Date(r.start).getMonth();
    if (!(m >= 10 || m <= 4)) return false;
    return r.points.some((p) => p[2] != null && p[2] >= 1300);
  }
  function loadMine() {
    return loadRides().then((all) => {
      mine = all.filter(isSkiTour).sort((a, b) => b.start - a.start);
      renderChips(); drawMine();
    });
  }
  function drawMine() {
    mineLayer.clearLayers();
    if (!shown.has("mine")) return;
    for (const r of mine) {
      const line = r.points.map((p) => [p[0], p[1]]);
      const when = new Date(r.start).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
      mineLayer.addLayer(L.polyline(line, { renderer: skiRenderer, color: "#fff", weight: 5, opacity: 0.7, interactive: false }));
      const l = L.polyline(line, { renderer: skiRenderer, color: MINE.color, weight: 2.5, opacity: 1 });
      l.bindTooltip(`${esc(r.title || "Ski tour")} · ${esc(when)}`, { sticky: true });
      l.on("click", (e) => { L.DomEvent.stopPropagation(e); location.href = "ride.html#ride/" + encodeURIComponent(r.id); });
      mineLayer.addLayer(l);
    }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && sport === "ski") loadMine(); });

  // ---------- switching sport ----------
  function setSport(s) {
    sport = SPORTS.includes(s) ? s : "mtb";
    store.set("sport", sport);
    sel.value = sport;
    document.body.classList.toggle("sport-ski", sport === "ski");
    const mtb = window.tfMtbLayers || [];
    if (sport === "ski") {
      mtb.forEach((l) => map.removeLayer(l));
      skiLayer.addTo(map); hutLayer.addTo(map); mineLayer.addTo(map);
      loadSki(); loadMine(); renderList();
    } else {
      mtb.forEach((l) => { if (!map.hasLayer(l)) l.addTo(map); });
      map.removeLayer(skiLayer); map.removeLayer(hutLayer); map.removeLayer(mineLayer);
    }
    refreshAvy(); refreshHeat();
  }
  sel.addEventListener("change", () => setSport(sel.value));
  setSport(sport);
})();
