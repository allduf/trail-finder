// Plan a loop: tap the map to add points and the route follows the mapped trails between them (like Komoot or
// Trailforks' route planner), with total distance, climb, the trails it uses, a GPX file, and Ride it (Ride mode,
// navigate.js, follows it with the off-route alert). Routing uses the same trail files as All trails, so it works
// offline in saved areas; a stretch with no mapped trail between two points is drawn as a dashed straight line.
// The plan is kept on this device (tf:plan) until it's cleared.
(() => {
  "use strict";
  const nav = window.tfNav;
  if (!nav) return;
  const map = nav.map;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const R = 6371008.8, RAD = Math.PI / 180;
  function metres(a, b) {
    const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const key = (p) => p[0].toFixed(5) + "," + p[1].toFixed(5);
  const nameOf = (w) => (w.tags.name || w.tags["mtb:name"] || "").trim();
  const fmtM = (m) => (m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km");
  const SNAP_M = 80;              // a tap this close to a trail starts or ends on it
  const PAD_DEG = 0.03;           // route inside the two points' box plus about 3 km

  // ---------- routing on the trail lines ----------
  // Nearest point on any trail: { w, i (segment), q (the point), d }.
  function snap(p) {
    const kx = Math.cos(p[0] * RAD) * R * RAD, ky = R * RAD;
    let best = null;
    const seen = new Set();
    nav.ways().forEach((w) => {
      if (seen.has(w.id)) return;
      seen.add(w.id);
      const g = w.geom;
      for (let i = 0; i < g.length - 1; i++) {
        const ax = (g[i][1] - p[1]) * kx, ay = (g[i][0] - p[0]) * ky, bx = (g[i + 1][1] - p[1]) * kx, by = (g[i + 1][0] - p[0]) * ky;
        if (Math.min(ax, bx) > SNAP_M || Math.max(ax, bx) < -SNAP_M || Math.min(ay, by) > SNAP_M || Math.max(ay, by) < -SNAP_M) continue;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d <= SNAP_M && (!best || d < best.d)) best = { w, i, d, q: [g[i][0] + t * (g[i + 1][0] - g[i][0]), g[i][1] + t * (g[i + 1][1] - g[i][1])] };
      }
    });
    return best;
  }
  // Shortest way along the trails from a to b (snapped points). Returns { pts, ways: [way ids in order] } or null.
  function route(a, b) {
    const s = Math.min(a.q[0], b.q[0]) - PAD_DEG, n = Math.max(a.q[0], b.q[0]) + PAD_DEG;
    const wPad = PAD_DEG / Math.cos(a.q[0] * RAD), w0 = Math.min(a.q[1], b.q[1]) - wPad, e = Math.max(a.q[1], b.q[1]) + wPad;
    const adj = new Map(), pos = new Map();
    const edge = (k1, k2, m, wid) => {
      if (!adj.has(k1)) adj.set(k1, []);
      if (!adj.has(k2)) adj.set(k2, []);
      adj.get(k1).push([k2, m, wid]); adj.get(k2).push([k1, m, wid]);
    };
    const seen = new Set();
    nav.ways().forEach((w) => {
      if (seen.has(w.id)) return;
      seen.add(w.id);
      const g = w.geom;
      if (!g.some((q) => q[0] >= s && q[0] <= n && q[1] >= w0 && q[1] <= e)) return;
      for (let i = 0; i < g.length; i++) {
        const k = key(g[i]); pos.set(k, g[i]);
        if (i) edge(key(g[i - 1]), k, metres(g[i - 1], g[i]), w.id);
      }
    });
    // The two tapped spots, joined into the segments they snapped to.
    [["A", a], ["B", b]].forEach(([k, p]) => {
      const g = p.w.geom, k1 = key(g[p.i]), k2 = key(g[p.i + 1]);
      pos.set(k, p.q);
      edge(k, k1, metres(p.q, g[p.i]), p.w.id); edge(k, k2, metres(p.q, g[p.i + 1]), p.w.id);
    });
    if (a.w === b.w && a.i === b.i) edge("A", "B", metres(a.q, b.q), a.w.id);
    // Dijkstra with a small binary heap.
    const dist = new Map([["A", 0]]), prev = new Map(), heap = [[0, "A"]];
    const push = (x) => { heap.push(x); let i = heap.length - 1; while (i) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } }
      return top;
    };
    while (heap.length) {
      const [d, k] = pop();
      if (k === "B") break;
      if (d > dist.get(k)) continue;
      (adj.get(k) || []).forEach(([k2, m, wid]) => {
        const nd = d + m;
        if (nd < (dist.has(k2) ? dist.get(k2) : Infinity)) { dist.set(k2, nd); prev.set(k2, [k, wid]); push([nd, k2]); }
      });
    }
    if (!dist.has("B")) return null;
    const pts = [], ways = [];
    for (let k = "B"; k; ) {
      pts.push(pos.get(k));
      const pv = prev.get(k);
      if (!pv) break;
      if (ways[ways.length - 1] !== pv[1]) ways.push(pv[1]);
      k = pv[0];
    }
    return { pts: pts.reverse(), ways: ways.reverse() };
  }

  // ---------- the plan ----------
  // stops: [{ ll, snap }], legs[i] joins stops[i] and stops[i+1]: { pts, ways, gap (no trail, straight line) }.
  let planning = false, stops = [], legs = [], elev = null, elevFor = "";
  const layer = L.layerGroup();
  const caseLine = L.polyline([], { color: "#fff", weight: 10, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false });
  const line = L.polyline([], { color: "#7b2ff7", weight: 6, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: false });
  const gapLine = L.polyline([], { color: "#7b2ff7", weight: 4, opacity: 0.9, dashArray: "6 8", interactive: false });
  const dots = L.layerGroup();
  [caseLine, line, gapLine, dots].forEach((l) => l.addTo(layer));
  const allPts = () => legs.flatMap((l, i) => (i ? l.pts.slice(1) : l.pts));
  const total = () => legs.reduce((s, l) => s + l.pts.reduce((a, q, i) => a + (i ? metres(l.pts[i - 1], q) : 0), 0), 0);

  function legFor(a, b) {
    const r = a.snap && b.snap ? route(a.snap, b.snap) : null;
    if (r) return { pts: [a.ll, ...r.pts, b.ll].filter((q, i, arr) => !i || metres(arr[i - 1], q) > 0.5), ways: r.ways, gap: false };
    return { pts: [a.ll, b.ll], ways: [], gap: true };
  }
  function addStop(ll) {
    const sn = snap(ll), stop = { ll: sn ? sn.q : ll, snap: sn };
    if (stops.length) legs.push(legFor(stops[stops.length - 1], stop));
    stops.push(stop);
    draw(); save();
  }
  function undo() { stops.pop(); legs.pop(); draw(); save(); }
  function clear() { stops = []; legs = []; elev = null; draw(); save(); }
  function closeLoop() { if (stops.length >= 2) addStop(stops[0].ll); }

  function draw() {
    caseLine.setLatLngs(legs.filter((l) => !l.gap).map((l) => l.pts));
    line.setLatLngs(legs.filter((l) => !l.gap).map((l) => l.pts));
    gapLine.setLatLngs(legs.filter((l) => l.gap).map((l) => l.pts));
    dots.clearLayers();
    stops.forEach((s, i) => dots.addLayer(L.marker(s.ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: "plan-stop", iconSize: [24, 24], iconAnchor: [12, 12], html: `<span>${i === 0 ? "S" : i}</span>` }) })));
    render();
    loadClimb();
  }
  function trailsUsed() {
    const byId = new Map(nav.ways().map((w) => [w.id, w])), out = [];
    legs.forEach((l) => l.ways.forEach((id) => {
      const w = byId.get(id), name = w ? nameOf(w) || "unnamed trail" : "unnamed trail";
      if (out.length && out[out.length - 1].name === name) return;
      const d = w ? nav.difficulty(w.tags) : null;
      out.push({ name, color: nav.diffColor(d), lvl: d ? nav.DIFF[d].label : "" });
    }));
    return out;
  }
  function render() {
    const m = total(), gaps = legs.filter((l) => l.gap).length;
    $("planStats").innerHTML = stops.length < 2 ? (stops.length ? "Tap the next point. The route follows the trails." : "Tap the map where you start.")
      : `<b>${fmtM(m)}</b>${elev ? ` · ↑ ${elev.up} m · ↓ ${elev.down} m` : ""}${gaps ? ` · <span class="gap-note">${gaps} stretch${gaps > 1 ? "es" : ""} off mapped trails (dashed)</span>` : ""}`;
    const used = trailsUsed();
    $("planTrails").innerHTML = used.length ? used.slice(0, 12).map((t) => `<span class="pt"><i style="background:${t.color}"></i>${esc(t.name)}</span>`).join(" → ") + (used.length > 12 ? ` → +${used.length - 12} more` : "") : "";
    ["planUndo", "planClear"].forEach((id) => { $(id).disabled = !stops.length; });
    ["planLoop", "planGpx", "planRide"].forEach((id) => { $(id).disabled = stops.length < 2; });
  }
  // Climb from Open-Meteo heights at up to 100 points along the plan (one request), counted in 4 m steps.
  let climbTimer = 0;
  function loadClimb() {
    clearTimeout(climbTimer);
    const pts = allPts();
    if (pts.length < 2) { elev = null; return; }
    const k = key(pts[0]) + key(pts[pts.length - 1]) + pts.length;
    if (k === elevFor) return;
    elev = null;
    climbTimer = setTimeout(async () => {
      const step = Math.max(1, (pts.length - 1) / 99), sample = [];
      for (let i = 0; i < pts.length; i += step) sample.push(pts[Math.round(i)]);
      if (sample[sample.length - 1] !== pts[pts.length - 1]) sample.push(pts[pts.length - 1]);
      try {
        const r = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${sample.slice(0, 100).map((q) => q[0].toFixed(5)).join(",")}&longitude=${sample.slice(0, 100).map((q) => q[1].toFixed(5)).join(",")}`);
        const h = (await r.json()).elevation;
        let up = 0, down = 0, ref = h[0];
        h.forEach((x) => { if (x - ref >= 4) { up += x - ref; ref = x; } else if (ref - x >= 4) { down += ref - x; ref = x; } });
        elev = { up: Math.round(up), down: Math.round(down) }; elevFor = k;
        render();
      } catch {}
    }, 600);
  }
  function save() { try { localStorage.setItem("tf:plan", JSON.stringify(stops.map((s) => s.ll))); } catch {} }
  function restore() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem("tf:plan") || "[]") || []; } catch {}
    stops = []; legs = [];
    saved.forEach((ll) => { const sn = snap(ll), stop = { ll: sn ? sn.q : ll, snap: sn }; if (stops.length) legs.push(legFor(stops[stops.length - 1], stop)); stops.push(stop); });
  }
  function gpx() {
    const pts = allPts(), now = new Date().toISOString();
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Trail Finder" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>Trail Finder loop</name><time>${now}</time></metadata>\n<trk><name>Trail Finder loop</name><trkseg>\n${pts.map((q) => `<trkpt lat="${q[0].toFixed(6)}" lon="${q[1].toFixed(6)}"/>`).join("\n")}\n</trkseg></trk>\n</gpx>\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "application/gpx+xml" }));
    a.download = `trail-finder-loop-${now.slice(0, 10)}.gpx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- UI ----------
  const css = document.createElement("style");
  css.textContent = `
.app.planning { grid-template-columns: 1fr !important; grid-template-rows: 1fr !important; }
.app.planning .panel, .app.planning .tabbar, .app.planning .map-actions, .app.planning .first-tip { display: none !important; }
.app.planning .mapwrap { grid-column: 1; grid-row: 1; }
.app.planning #map { cursor: crosshair; }
.plan-bar { position: fixed; z-index: 1200; left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom, 0px)); max-width: 600px; margin: 0 auto; background: var(--panel, #fff); color: var(--fg, #14211a); border-radius: 18px; box-shadow: 0 6px 24px rgba(0,0,0,.28); padding: 12px 14px; }
.plan-bar[hidden] { display: none; }
.plan-bar h3 { margin: 0 0 4px; font-size: 1.05rem; }
.plan-stats { font-size: 1rem; }
.plan-stats .gap-note { color: #c25e00; font-size: .9rem; }
.plan-trails { font-size: .88rem; color: var(--muted, #5b6660); margin-top: 4px; max-height: 3.2em; overflow: auto; }
.plan-trails .pt i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; vertical-align: 0; }
.plan-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.plan-btns button { flex: 1 1 auto; font: inherit; font-size: .92rem; font-weight: 700; padding: 9px 10px; border-radius: 11px; border: 1px solid var(--line, #d6dad3); background: var(--bg, #f4f5f0); color: inherit; cursor: pointer; }
.plan-btns button:disabled { opacity: .45; cursor: default; }
.plan-btns .go { background: var(--cta, #c6f05a); border-color: transparent; color: var(--cta-fg, #10230f); }
.plan-stop { background: none; border: 0; }
.plan-stop span { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: #7b2ff7; color: #fff; font: 700 12px/1 system-ui, sans-serif; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35); box-sizing: border-box; }
body.sport-ski #planBtn { display: none; }
`;
  document.head.appendChild(css);
  const bar = document.createElement("div");
  bar.className = "plan-bar"; bar.hidden = true; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Plan a loop");
  bar.innerHTML = `<h3>Plan a loop</h3><div class="plan-stats" id="planStats"></div><div class="plan-trails" id="planTrails"></div>
    <div class="plan-btns"><button type="button" id="planUndo">↶ Undo</button><button type="button" id="planLoop" title="Add a last point back at the start">↺ Back to start</button><button type="button" id="planClear">Clear</button>
    <button type="button" id="planGpx">⤓ GPX</button><button type="button" class="go" id="planRide">▶ Ride it</button><button type="button" id="planDone">Done</button></div>`;
  document.body.appendChild(bar);

  function setPlanning(on) {
    if (planning === on) return;
    planning = on;
    const before = $("map").getBoundingClientRect();
    document.querySelector(".app").classList.toggle("planning", on);
    document.body.classList.toggle("planning", on);
    bar.hidden = !on;
    map.invalidateSize({ pan: false });
    const after = $("map").getBoundingClientRect();
    map.panBy([after.left - before.left, after.top - before.top], { animate: false });
    if (on) {
      nav.load();
      layer.addTo(map);
      if (!stops.length) restore();
      draw();
      if (stops.length) map.fitBounds(L.latLngBounds(allPts().length ? allPts() : stops.map((s) => s.ll)), { padding: [40, 40], maxZoom: 16 });
      else if (map.getZoom() < 13) map.setZoom(13);
    } else map.removeLayer(layer);
    const b = $("planBtn"); if (b) b.setAttribute("aria-pressed", String(on));
  }
  map.on("click", (e) => { if (planning) addStop([e.latlng.lat, e.latlng.lng]); });
  map.on("moveend", () => { if (planning) nav.load(); });
  $("planUndo").addEventListener("click", undo);
  $("planClear").addEventListener("click", () => { if (stops.length < 3 || confirm("Clear this plan?")) clear(); });
  $("planLoop").addEventListener("click", closeLoop);
  $("planGpx").addEventListener("click", gpx);
  $("planDone").addEventListener("click", () => setPlanning(false));
  $("planRide").addEventListener("click", () => {
    const lines = legs.map((l) => l.pts);
    setPlanning(false);
    if (window.tfRide) window.tfRide.follow(lines, `your loop (${fmtM(total())})`);
  });

  const btn = document.createElement("button");
  btn.id = "planBtn"; btn.type = "button"; btn.setAttribute("aria-pressed", "false");
  btn.title = "Tap points on the map to plan a ride along the trails: distance, climb, GPX, and Ride it";
  btn.textContent = "✎ Plan a loop";
  const tools = $("offlineBtn")?.parentElement;
  if (tools) tools.prepend(btn);
  btn.addEventListener("click", () => { setPlanning(!planning); if ($("layersMenu") && !$("layersMenu").hidden) $("layersBtn").click(); });

  window.tfPlan = { open: () => setPlanning(true), planning: () => planning };
})();
