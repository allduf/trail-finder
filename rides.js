// My rides on the main map: the rides saved in Record ride (recorded or imported from Strava / GPX / FIT, see
// ride.html) drawn as thin lime lines, and the trails you've ridden marked: a lime highlighter glow under the trail
// (it keeps its difficulty colour on top) and a "Ridden" tag in the list and the trail details. A trail counts as ridden when one ride passes within 25 m of at
// least 60% of it ("Partly ridden" from 25%), so a GPS track that wanders a little off the mapped line still counts.
// Rides come from this browser's IndexedDB "trail-finder-rides" (ride.html keeps it in sync with the rider's
// account when signed in). Trails come from index.html through window.tfTrails().
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L || !window.tfTrails) return;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {   // "tf:setting" tells account.js (optional sign-in) to save settings to the rider's account
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const NEAR_M = 25, STEP_M = 10, RIDDEN = 0.6, PARTLY = 0.25;
  // Lime, like the "Find new trails" button: the trail and road colours already use the reds, blues and purples.
  const GLOW = "#b8f03a", TRACK = "#6fae00", INK = "#10230f";

  const css = document.createElement("style");
  css.textContent = `
.map-tools #ridesBtn.on { background: ${GLOW}; border-color: ${TRACK}; color: ${INK}; }
body.sport-ski #ridesBtn { display: none !important; }
.ridden-tag { display: inline-block; font-size: .72rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: ${GLOW}; color: ${INK}; vertical-align: 1px; white-space: nowrap; }
.ridden-tag.part { background: transparent; color: var(--fg); border: 1.5px dashed ${TRACK}; }
.ridden-note { margin: 8px 0 0; padding: 8px 10px; border-radius: 8px; border-left: 4px solid ${TRACK}; background: color-mix(in srgb, ${GLOW} 22%, transparent); font-size: .9rem; }
.ridden-note a { color: inherit; }`;
  document.head.appendChild(css);

  // ---------- rides from IndexedDB (same database and stores as ride.html) ----------
  function loadRides() {
    return new Promise((resolve) => {
      let r;
      try { r = indexedDB.open("trail-finder-rides", 1); } catch { resolve([]); return; }
      r.onupgradeneeded = () => {
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

  // ---------- matching: a grid of ride points, each cell listing the rides that pass through it ----------
  const CELL = 0.0003;                                  // ~33 m of latitude
  let K = Math.cos(50 * Math.PI / 180);                 // longitude shrink, set from the rides' latitude
  const cellKey = (lat, lon) => Math.floor(lat / CELL) + ":" + Math.floor(lon * K / CELL);
  let rides = [], grid = new Map(), box = null, cache = new Map();
  const ll = (p) => (Array.isArray(p) ? p : [p.lat, p.lng]);
  const metres = (a, b) => { const dy = (a[0] - b[0]) * 111195, dx = (a[1] - b[1]) * 111195 * K; return Math.sqrt(dx * dx + dy * dy); };

  function buildGrid() {
    grid = new Map(); cache = new Map(); box = null;
    const lats = rides.flatMap((r) => r.points.map((p) => p[0]));
    if (!lats.length) return;
    K = Math.cos((lats.reduce((a, b) => a + b, 0) / lats.length) * Math.PI / 180);
    const put = (lat, lon, i) => {
      const k = cellKey(lat, lon);
      let set = grid.get(k); if (!set) grid.set(k, set = []);
      set.push([lat, lon, i]);
    };
    rides.forEach((r, i) => {
      for (let j = 0; j < r.points.length; j++) {
        const p = r.points[j];
        if (!box) box = [p[0], p[1], p[0], p[1]];
        box = [Math.min(box[0], p[0]), Math.min(box[1], p[1]), Math.max(box[2], p[0]), Math.max(box[3], p[1])];
        put(p[0], p[1], i);
        const q = r.points[j + 1];
        if (!q) continue;
        const d = metres(p, q), n = Math.min(200, Math.floor(d / STEP_M));   // fill gaps (sparse GPX, paused GPS)
        for (let s = 1; s < n; s++) put(p[0] + (q[0] - p[0]) * s / n, p[1] + (q[1] - p[1]) * s / n, i);
      }
    });
  }
  // Which rides are within NEAR_M of the point.
  function ridesNear(lat, lon) {
    const out = new Set(), y = Math.floor(lat / CELL), x = Math.floor(lon * K / CELL);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const pts = grid.get((y + dy) + ":" + (x + dx));
      if (pts) for (const p of pts) if (!out.has(p[2]) && metres(p, [lat, lon]) <= NEAR_M) out.add(p[2]);
    }
    return out;
  }
  // For one trail (a list of lines): { state: "ridden" | "partly", rides: [ride indexes, newest first] } or null.
  function match(key, lines) {
    if (cache.has(key)) return cache.get(key);
    let res = null;
    const pad = 0.0005;
    const hit = box && lines.some((line) => line.some((p) => { p = ll(p); return p[0] >= box[0] - pad && p[0] <= box[2] + pad && p[1] >= box[1] - pad && p[1] <= box[3] + pad; }));
    if (hit) {
      const per = new Map();
      let n = 0;
      const sample = (lat, lon) => { n++; ridesNear(lat, lon).forEach((i) => per.set(i, (per.get(i) || 0) + 1)); };
      lines.forEach((line) => {
        for (let j = 0; j < line.length; j++) {
          const a = ll(line[j]);
          sample(a[0], a[1]);
          if (j + 1 === line.length) continue;
          const b = ll(line[j + 1]), steps = Math.floor(metres(a, b) / STEP_M);
          for (let s = 1; s < steps; s++) sample(a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps);
        }
      });
      const best = Math.max(0, ...per.values()) / Math.max(1, n);
      if (best >= PARTLY) {
        const full = [...per].filter(([, c]) => c / n >= RIDDEN).map(([i]) => i).sort((a, b) => rides[b].start - rides[a].start);
        res = full.length ? { state: "ridden", rides: full } : { state: "partly", rides: [...per].filter(([, c]) => c / n >= PARTLY).map(([i]) => i).sort((a, b) => rides[b].start - rides[a].start) };
      }
    }
    cache.set(key, res);
    return res;
  }
  const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  function summary(m) {
    const n = m.rides.length, last = rides[m.rides[0]];
    return m.state === "ridden"
      ? `${n === 1 ? "Ridden once" : `Ridden on ${n} rides`}, last on ${fmtDay(last.start)}`
      : `Partly ridden${n > 1 ? ` on ${n} rides` : ""}, last on ${fmtDay(last.start)}`;
  }

  // ---------- drawing ----------
  const layer = L.layerGroup();
  // Ride lines and the ridden glow sit under every trail line (the "All trails" pane is 390), above the forest roads (380).
  if (!map.getPane("ridesPane")) map.createPane("ridesPane").style.zIndex = 385;
  const renderer = L.canvas({ padding: 0.3, pane: "ridesPane" });
  (window.tfMtbLayers = window.tfMtbLayers || []).push(layer);     // Skiing (winter.js) hides it with the MTB layers
  let on = store.get("rides", true);
  const byId = new Map();              // trail id -> match, for the list and the details

  function trails() {
    const t = window.tfTrails(), out = [], seen = new Set();
    t.shown.forEach((x) => { if (!x.ghost && x.id > 0) { seen.add(x.id); out.push({ key: "n" + x.id, id: x.id, isNew: true, name: x.tags.name || x.tags["mtb:name"], lines: x.segments || [x.geom] }); } });
    t.all.forEach((list) => list.forEach((w) => { if (!seen.has(w.id)) { seen.add(w.id); out.push({ key: "w" + w.id, id: w.id, name: w.tags.name || w.tags["mtb:name"], lines: [w.geom] }); } }));
    return out;
  }
  function draw() {
    layer.clearLayers();
    byId.clear();
    syncBtn();
    if (!on || !rides.length) { tagList(); tagDetail(); return; }
    rides.forEach((r) => {
      L.polyline(r.points.map((p) => [p[0], p[1]]), { renderer, color: TRACK, weight: 3, opacity: 0.85, interactive: false }).addTo(layer);
    });
    trails().forEach((t) => {
      const m = match(t.key, t.lines);
      if (!m) return;
      byId.set(t.id, m);
      const tip = `${m.state === "ridden" ? "✓ " : ""}${esc(t.name || "Unnamed trail")}<br>${esc(summary(m))}`;
      t.lines.forEach((line) => {
        L.polyline(line, { renderer, color: GLOW, weight: 16, opacity: m.state === "ridden" ? 0.85 : 0.4, lineCap: "round", interactive: false }).addTo(layer);
        // "All trails" lines take no taps, so an invisible line gives them a tooltip. New trails have their own
        // tap target, which opens the details (they say when you rode it).
        if (!t.isNew) L.polyline(line, { weight: 16, opacity: 0, interactive: true }).bindTooltip(tip, { sticky: true, direction: "top", offset: [0, -8] }).addTo(layer);
      });
    });
    tagList(); tagDetail(); syncBtn();
  }
  let drawTimer = null;
  const drawSoon = () => { clearTimeout(drawTimer); drawTimer = setTimeout(draw, 150); };

  // ---------- "Ridden" tags in the results list and the trail details ----------
  function tagList() {
    document.querySelectorAll("#list li.trail[data-id]").forEach((li) => {
      const old = li.querySelector(".ridden-tag"); if (old) old.remove();
      const m = byId.get(+li.dataset.id), name = li.querySelector(".name");
      if (m && name) name.insertAdjacentHTML("beforeend", ` <span class="ridden-tag${m.state === "partly" ? " part" : ""}" title="${esc(summary(m))}">${m.state === "ridden" ? "✓ Ridden" : "Partly ridden"}</span>`);
    });
  }
  function tagDetail() {
    const d = $("detail");
    if (!d) return;
    // Adding the note changes #detail too, which calls this again: leave it alone when it's already right.
    const old = d.querySelector(".ridden-note"), head = d.querySelector(".d-head"), m = byId.get(window.tfTrails().selected);
    const last = m && rides[m.rides[0]];
    const html = head && last ? `${m.state === "ridden" ? "✓ " : ""}${esc(summary(m))}: <a href="ride.html#ride/${encodeURIComponent(last.id)}">${esc(last.title)}</a>` : "";
    if (old && old.dataset.k === html) return;
    if (old) old.remove();
    if (html) { head.insertAdjacentHTML("afterend", `<p class="ridden-note">${html}</p>`); head.nextElementSibling.dataset.k = html; }
  }
  // index.html redraws the list and the details by replacing their contents; tag them again each time.
  [["list", tagList], ["detail", tagDetail]].forEach(([id, fn]) => { const el = $(id); if (el) new MutationObserver(fn).observe(el, { childList: true }); });
  // The new-trails list changes with each search and the "All trails" lines load as the map moves.
  const listEl = $("list");
  if (listEl) new MutationObserver(drawSoon).observe(listEl, { childList: true });
  map.on("layeradd", (e) => { if (e.layer instanceof L.Polyline && !layer.hasLayer(e.layer)) drawSoon(); });
  map.on("moveend", drawSoon);

  // ---------- the "My rides" button ----------
  const btn = document.createElement("button");
  btn.id = "ridesBtn"; btn.type = "button";
  const anchor = $("roadsBtn") || $("allBtn");
  if (anchor) anchor.parentNode.insertBefore(btn, anchor); else return;
  function syncBtn() {
    btn.classList.toggle("on", on && rides.length > 0);
    btn.setAttribute("aria-pressed", String(on && rides.length > 0));
    const ridden = [...byId.values()].filter((m) => m.state === "ridden").length;
    btn.textContent = !rides.length ? "🚵 My rides" : on && ridden ? `🚵 My rides · ${ridden} ridden` : "🚵 My rides";
    btn.title = !rides.length ? "No rides yet: record one, or import rides from Strava or a GPS file" : on ? "Hide your rides and the trails you've ridden" : "Show your rides and mark the trails you've ridden";
  }
  btn.addEventListener("click", () => {
    if (!rides.length) { location.href = "ride.html#rides"; return; }
    on = !on; store.set("rides", on);
    draw();
    if (on && box) {
      const view = map.getBounds(), b = L.latLngBounds([box[0], box[1]], [box[2], box[3]]);
      if (!view.intersects(b)) map.fitBounds(b, { padding: [30, 30], maxZoom: 14 });
    }
  });

  async function refresh() {
    rides = (await loadRides()).filter((r) => r.points && r.points.length > 1);
    buildGrid();
    draw();
  }
  // Rides saved or imported in ride.html (another tab, or coming back to this page) show up when this page is seen again.
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  window.addEventListener("pageshow", (e) => { if (e.persisted) refresh(); });
  if (!document.body.classList.contains("sport-ski")) layer.addTo(map);
  refresh();
})();
