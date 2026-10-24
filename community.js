// What riders' shared rides say ("Help improve Trail Finder", share.js), from data/community.json (built every night by
// scripts/build-community.mjs; nothing in it is about one rider, and every result is backed by 3 or more riders):
//   - "Ridden by riders, not on the map": stretches several riders share where OpenStreetMap has nothing, drawn as
//     pink dashed lines with the "Possible unmapped" lines (same switch), with a link to add them to OpenStreetMap.
//   - In a trail's details: how many Trail Finder riders rode it in the last 12 months (Busy / Quiet once there's enough
//     data to compare), and which way most of them ride it, with arrows on the trail.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L || !window.tfTrails) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const COLOR = "#d6338f";   // pink: orange is Pro line, purple the other unmapped lines
  let data = null, busyAt = null, quietAt = null;

  const css = document.createElement("style");
  css.textContent = `
.comm-note { margin: 8px 0 0; padding: 8px 10px; border-radius: 8px; border-left: 4px solid ${COLOR}; background: color-mix(in srgb, ${COLOR} 14%, transparent); font-size: .9rem; }
.comm-tag { display: inline-block; font-size: .72rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: ${COLOR}; color: #fff; margin-left: 4px; vertical-align: 1px; }
.comm-tag.quiet { background: transparent; color: var(--fg); border: 1.5px solid ${COLOR}; }
.comm-arrow { color: ${COLOR}; font-size: 20px; font-weight: 900; text-shadow: 0 0 3px #fff, 0 0 3px #fff; line-height: 1; }`;
  document.head.appendChild(css);

  // ---------- possible new trails from shared rides ----------
  if (!map.getPane("commFinds")) map.createPane("commFinds").style.zIndex = 451;
  const renderer = L.svg({ pane: "commFinds", padding: 0.3 });
  const layer = L.layerGroup();
  (window.tfMtbLayers = window.tfMtbLayers || []).push(layer);   // hidden in Skiing and Hunting with the MTB layers
  const ghostBox = $("showGhost");
  const shown = () => !ghostBox || ghostBox.checked;
  const fmtM = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m / 10) * 10 + " m");
  function drawFinds() {
    layer.clearLayers();
    if (!data || !shown()) return;
    (data.finds || []).forEach((f) => {
      const line = L.polyline(f.g, { renderer, pane: "commFinds", color: COLOR, weight: 6, opacity: 0.9, dashArray: "9 7" }).addTo(layer);
      const p = f.g[Math.floor(f.g.length / 2)];
      line.bindTooltip(`Ridden by ${f.riders} Trail Finder riders · ${fmtM(f.m)} · not on the map`, { sticky: true, direction: "top", offset: [0, -8] });
      line.bindPopup(`<strong>Possible new trail</strong><br>${fmtM(f.m)}, ridden by ${f.riders} riders who share their rides to help improve Trail Finder. Nothing is mapped here on OpenStreetMap yet. Unverified: it may be private or closed.<br><a href="https://www.openstreetmap.org/edit?editor=id#map=18/${p[0]}/${p[1]}" target="_blank" rel="noopener">Add to OpenStreetMap</a>`, { maxWidth: 280 });
    });
  }
  if (ghostBox) ghostBox.addEventListener("change", drawFinds);
  if (!document.body.classList.contains("sport-alt")) layer.addTo(map);

  // ---------- one trail's details ----------
  // The ways of the selected trail (a joined trail is several ways), with their shapes when the map has them.
  function waysOf(id) {
    const t = window.tfTrails(), out = [];
    const x = t.shown.find((s) => s.id === id);
    const ids = x && x.segIds && x.segIds.length ? x.segIds : [id];
    ids.forEach((w, i) => {
      let geom = x && x.segments && x.segIds && x.segments[i] ? x.segments[i] : null;
      if (!geom) for (const list of t.all) { const f = list.find((y) => y.id === w); if (f) { geom = f.geom; break; } }
      out.push({ id: w, geom, c: data.ways[w] });
    });
    return out.filter((w) => w.c);
  }
  const arrows = L.layerGroup().addTo(map);
  function note() {
    const d = $("detail");
    if (!d) return;
    const old = d.querySelector(".comm-note"), head = d.querySelector(".d-head"), sel = window.tfTrails().selected;
    let html = "", arrowsFor = [];
    if (data && head && sel != null) {
      const ws = waysOf(sel);
      if (ws.length) {
        const recent = Math.max(...ws.map((w) => w.c[0])), all = Math.max(...ws.map((w) => w.c[1]));
        const tag = busyAt != null && recent >= busyAt ? `<span class="comm-tag">Busy</span>` : quietAt != null && recent <= quietAt ? `<span class="comm-tag quiet">Quiet</span>` : "";
        // direction: the way with the most passes; shown when 70% or more go one way
        const top = ws.slice().sort((a, b) => (b.c[2] + b.c[3]) - (a.c[2] + a.c[3]))[0], n = top.c[2] + top.c[3];
        const share = n ? Math.round(100 * Math.max(top.c[2], top.c[3]) / n) : 0;
        html = `${recent >= 3 ? `Ridden by ${recent} Trail Finder riders in the last 12 months` : `Ridden by ${all} Trail Finder riders in the last 2 years`}${tag}`;
        if (n >= 5 && share >= 70) { html += `. Riders mostly go one way (${share}% of ${n} passes): see the pink arrows.`; arrowsFor = ws.filter((w) => w.geom && w.c[2] + w.c[3] >= 3 && Math.max(w.c[2], w.c[3]) / (w.c[2] + w.c[3]) >= 0.7).map((w) => [w.geom, w.c[2] >= w.c[3]]); }
        else html += ".";
      }
    }
    if (!old || old.dataset.k !== html) {
      if (old) old.remove();
      arrows.clearLayers();
      if (html) {
        head.insertAdjacentHTML("afterend", `<p class="comm-note">${html}</p>`);
        head.nextElementSibling.dataset.k = html;
        arrowsFor.forEach(([geom, forward]) => drawArrows(geom, forward));
      }
    }
  }
  // Arrows along a way, in the direction most riders go.
  function drawArrows(geom, forward) {
    const g = geom.map((p) => (Array.isArray(p) ? p : [p.lat, p.lng]));
    if (!forward) g.reverse();
    const pts = g.map((p) => map.latLngToLayerPoint(p));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    const n = Math.max(1, Math.min(4, Math.round(len / 120)));
    for (let k = 1; k <= n; k++) {
      let want = len * k / (n + 1), i = 1;
      while (i < pts.length - 1 && want > pts[i].distanceTo(pts[i - 1])) { want -= pts[i].distanceTo(pts[i - 1]); i++; }
      const a = g[i - 1], b = g[i];
      const deg = Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI;
      const f = Math.min(1, want / Math.max(1e-6, pts[i].distanceTo(pts[i - 1])));
      L.marker([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], { interactive: false, icon: L.divIcon({ className: "", html: `<div class="comm-arrow" style="transform: rotate(${deg - 90}deg)">➤</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }) }).addTo(arrows);
    }
  }
  const d = $("detail");
  if (d) new MutationObserver(note).observe(d, { childList: true });

  fetch("data/community.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j || !j.ways) return;
    data = j;
    // Busy / Quiet: the top and bottom quarter of trails, once 20 or more trails have riders to compare
    const r = Object.values(j.ways).map((w) => w[0]).filter((x) => x >= 3).sort((a, b) => a - b);
    if (r.length >= 20) { busyAt = r[Math.floor(r.length * 0.75)]; quietAt = r[Math.floor(r.length * 0.25)]; if (busyAt <= quietAt) busyAt = quietAt = null; }
    drawFinds(); note();
  }).catch(() => {});
})();
