// Rider-added trails (alex, 2026-10-24: "the option for each user to add their own trail"): a rider adds a trail they
// know that isn't on the map, with a name, a level, which way it's ridden and notes, and everyone sees it.
// Three ways to give the line: draw it on the map (tap along it from start to end), a possible new trail saved from one
// of your rides (ride-finds.js, tf:myFinds; ride.html links here with #addtrail=<find id>), or a GPX / TCX / FIT file
// (ride-files.js). Adding one needs the optional sign-in (account.js), to keep spam out; seeing them doesn't.
// On the map they're drawn in their level's colour on a yellow edge with a ➕ badge, under their own switch in Layers
// ("➕ Rider-added trails"), hidden in Skiing and Hunting with the MTB layers. Tapping one shows its details with
// ✓ I rode it and ⚑ Report (or Edit / Delete for your own). 3 or more reports, and more reports than riders who rode it,
// hide a trail (the database decides, see supabase/rider-trails.sql).
// Stored in the Supabase tables rider_trails and rider_trail_votes; everyone reads them through rider_trails_all()
// (no user ids), kept on this device for the next visit.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const CACHE = "tf:riderTrails", ON = "tf:riderTrailsOn", DRAFT = "tf:riderTrailDraft";
  const EDGE = "#ffc61a", UNRATED = "#0b8a8a", MAX_PTS = 1000;
  const LEVELS = [["green", "● Green"], ["blue", "■ Blue"], ["black", "◆ Black"], ["dbl", "◆◆ Double black"], ["pro", "▲ Pro line"], ["unknown", "Not sure"]];
  const DIRS = [["oneway", "One way"], ["both", "Both ways"], ["unknown", "Not sure"]];
  const REASONS = [["not_a_trail", "It isn't a trail"], ["private", "Private land or no bikes"], ["closed", "Closed or gone"],
    ["wrong_place", "In the wrong place"], ["on_map", "It's on the map now"], ["other", "Something else"]];
  const SOURCE = { draw: "drawn on the map", gpx: "from a GPS file", ride: "from a ride" };
  const levelColor = (l) => (window.tfNav && window.tfNav.DIFF[l] ? window.tfNav.DIFF[l].color : UNRATED);
  const levelBadge = (l) => (l && l !== "unknown" ? `<span class="diff d-${l}">${esc(LEVELS.find((x) => x[0] === l)[1])}</span>` : `<span class="muted">Level not given</span>`);
  const isAlt = () => document.body.classList.contains("sport-alt");
  const acct = () => window.tfAccount;

  // ---------- geometry ----------
  const metres = (a, b) => { const k = Math.cos(((a[0] + b[0]) / 2) * Math.PI / 180), dy = (a[0] - b[0]) * 111195, dx = (a[1] - b[1]) * 111195 * k; return Math.sqrt(dx * dx + dy * dy); };
  const lengthOf = (g) => g.reduce((s, p, i) => (i ? s + metres(g[i - 1], p) : 0), 0);
  function segDist(p, a, b) {
    const k = Math.cos(p[0] * Math.PI / 180), ax = a[1] * k * 111195, ay = a[0] * 111195, bx = b[1] * k * 111195 - ax, by = b[0] * 111195 - ay;
    const px = p[1] * k * 111195 - ax, py = p[0] * 111195 - ay, l = bx * bx + by * by;
    const t = l ? Math.max(0, Math.min(1, (px * bx + py * by) / l)) : 0;
    return Math.hypot(px - t * bx, py - t * by);
  }
  function simplify(pts, tol) {   // Douglas-Peucker, keeps the ends
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      let far = -1, at = 0;
      for (let i = s + 1; i < e; i++) { const d = segDist(pts[i], pts[s], pts[e]); if (d > far) { far = d; at = i; } }
      if (far > tol) { keep[at] = 1; stack.push([s, at], [at, e]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  // A line to keep: 5-decimal points (about 1 m), 2 m of wiggle dropped, at most MAX_PTS points.
  function tidy(g) {
    let pts = g.map((p) => [+(+p[0]).toFixed(5), +(+p[1]).toFixed(5)]).filter((p, i, a) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && (!i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]));
    let tol = 2, s = simplify(pts, tol);
    while (s.length > MAX_PTS) s = simplify(pts, tol *= 1.5);
    return s;
  }
  const fmtM = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.round(m / 10) * 10 + " m");
  const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const middle = (g) => g[Math.floor(g.length / 2)];

  // ---------- styles ----------
  const css = document.createElement("style");
  css.textContent = `
.rt-badge { width: 22px; height: 22px; border-radius: 50%; background: ${EDGE}; color: #14211a; font-weight: 900; font-size: 15px; line-height: 20px; text-align: center; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35); }
.rt-arrow { color: #14211a; font-size: 18px; font-weight: 900; text-shadow: 0 0 3px ${EDGE}, 0 0 3px ${EDGE}, 0 0 2px #fff; line-height: 1; }
.rt-tag { display: inline-block; font-size: .72rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: ${EDGE}; color: #14211a; vertical-align: 1px; white-space: nowrap; }
.rt-pop { font-size: .92rem; }
.rt-pop h3 { margin: 0 0 3px; font-size: 1.02rem; }
.rt-pop .rt-facts { margin: 4px 0; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
.rt-pop .rt-notes { margin: 6px 0; white-space: pre-line; overflow-wrap: anywhere; }
.rt-pop .rt-small { margin: 6px 0; color: var(--muted); font-size: .82rem; }
.rt-pop .rt-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.rt-pop .rt-acts button, .rt-pop .rt-acts a { font: inherit; font-size: .88rem; font-weight: 600; min-height: 36px; padding: 6px 10px; border-radius: 9px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
.rt-pop .rt-acts button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg, #fff); border-color: transparent; }
.rt-pop .rt-msg { font-size: .85rem; min-height: 1em; margin-top: 4px; }
#rtBox { margin: 10px 0; padding: 10px 12px; border: 1.5px solid ${EDGE}; border-radius: 12px; background: color-mix(in srgb, ${EDGE} 10%, var(--panel)); }
body.sport-alt #rtBox, body.sport-alt #rtLayerBtn { display: none !important; }
#rtBox .rt-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
#rtBox .rt-head b { font-size: .98rem; }
#rtBox p { margin: 6px 0 0; font-size: .88rem; color: var(--muted); }
#rtBox ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
#rtBox li button { font: inherit; width: 100%; text-align: left; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
#rtBox li .muted { font-size: .82rem; }
.rt-add { font: inherit; font-weight: 700; min-height: 40px; padding: 7px 13px; border-radius: 999px; border: 0; background: ${EDGE}; color: #14211a; cursor: pointer; }
dialog.rt-dlg, dialog.rt-dlg * { box-sizing: border-box; }
dialog.rt-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 16px; width: min(420px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow-y: auto; overflow-x: hidden; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.rt-dlg::backdrop { background: rgba(0,0,0,.4); }
dialog.rt-dlg h2 { margin: 0 0 4px; font-family: var(--font-display); font-size: 1.3rem; text-transform: uppercase; letter-spacing: .02em; }
dialog.rt-dlg p { margin: 0 0 10px; color: var(--muted); font-size: .9rem; }
dialog.rt-dlg label.rt-l { display: block; font-size: .8rem; font-weight: 700; color: var(--muted); margin: 8px 0 4px; }
dialog.rt-dlg input[type=text], dialog.rt-dlg textarea { width: 100%; font: inherit; font-size: 16px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); }
dialog.rt-dlg textarea { min-height: 76px; resize: vertical; }
dialog.rt-dlg .rt-seg { display: flex; flex-wrap: wrap; gap: 6px; }
dialog.rt-dlg .rt-seg button { font: inherit; font-size: .9rem; font-weight: 600; min-height: 38px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
dialog.rt-dlg .rt-seg button[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg, #fff); border-color: transparent; }
dialog.rt-dlg .rt-ok { display: flex; gap: 8px; align-items: flex-start; margin: 12px 0 4px; font-size: .9rem; }
dialog.rt-dlg .rt-ok input { width: 20px; height: 20px; margin: 1px 0 0; flex: 0 0 auto; }
dialog.rt-dlg .rt-row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 10px; }
dialog.rt-dlg .rt-row button, dialog.rt-dlg .rt-pick button { font: inherit; font-weight: 600; padding: 9px 14px; border-radius: 9px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
dialog.rt-dlg button.go { background: ${EDGE}; color: #14211a; border-color: transparent; font-weight: 800; }
dialog.rt-dlg button.danger { color: #c0392b; }
dialog.rt-dlg button:disabled { opacity: .55; cursor: default; }
dialog.rt-dlg .rt-pick { display: flex; flex-direction: column; gap: 8px; margin: 6px 0 4px; }
dialog.rt-dlg .rt-pick button { text-align: left; padding: 12px 14px; font-size: 1rem; display: block; width: 100%; }
dialog.rt-dlg .rt-pick small { display: block; font-weight: 400; color: var(--muted); font-size: .82rem; margin-top: 2px; }
dialog.rt-dlg .rt-finds { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
dialog.rt-dlg .rt-msg { min-height: 1.1em; font-size: .86rem; color: var(--fg); margin: 6px 0 0; }
dialog.rt-dlg .rt-msg.err { color: #c0392b; }
dialog.rt-dlg .rt-reasons { display: flex; flex-direction: column; gap: 6px; margin: 4px 0 8px; }
dialog.rt-dlg .rt-reasons label { display: flex; gap: 8px; align-items: center; font-size: .95rem; padding: 6px 8px; border: 1px solid var(--line); border-radius: 9px; cursor: pointer; }
dialog.rt-dlg .rt-reasons input { width: 18px; height: 18px; margin: 0; }
.rt-bar { position: fixed; z-index: 1200; left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom, 0px)); max-width: 560px; margin: 0 auto; background: var(--panel, #fff); color: var(--fg, #14211a); border-radius: 18px; box-shadow: 0 6px 24px rgba(0,0,0,.28); padding: 12px 14px; border: 2px solid ${EDGE}; }
.rt-bar h3 { margin: 0 0 2px; font-size: 1.02rem; }
.rt-bar p { margin: 0 0 8px; font-size: .88rem; color: var(--muted); }
.rt-bar .rt-stat { font-weight: 700; margin-bottom: 8px; font-size: .92rem; }
.rt-bar .rt-btns { display: flex; gap: 8px; }
.rt-bar .rt-btns button { font: inherit; font-weight: 700; min-height: 44px; padding: 8px 12px; border-radius: 11px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; flex: 1 1 0; }
.rt-bar .rt-btns button.go { background: ${EDGE}; color: #14211a; border-color: transparent; flex: 1.4 1 0; }
.rt-bar .rt-btns button:disabled { opacity: .5; cursor: default; }
.app.rt-drawing .map-actions, .app.rt-drawing .first-tip, body.rt-drawing .leaflet-tooltip { display: none !important; }
.leaflet-riderTrails-pane path:focus { outline: none; }
.app.rt-drawing #map, .app.rt-drawing #map .leaflet-interactive { cursor: crosshair !important; }
body.rt-drawing:has(.app:not(.fullmap)) .rt-bar { left: 396px; }
.rt-dot { width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 3px solid #14211a; box-sizing: border-box; }
.rt-dot.end { background: ${EDGE}; width: 16px; height: 16px; }
@media (max-width: 760px) {
  .app.rt-drawing { grid-template-columns: 1fr !important; grid-template-rows: 1fr !important; }
  .app.rt-drawing .panel, .app.rt-drawing .tabbar { display: none !important; }
  .app.rt-drawing .mapwrap { grid-column: 1; grid-row: 1; }
  body.rt-drawing:has(.app:not(.fullmap)) .rt-bar { left: 8px; }
}`;
  document.head.appendChild(css);

  // ---------- everyone's trails: load, keep, draw ----------
  let all = (lsGet(CACHE) || []).filter((t) => t && t.id && Array.isArray(t.line));
  let mine = new Map();     // id -> this rider's own trail (from the table: shows the ones riders' reports hid too)
  let votes = new Map();    // trail id -> { kind, reason }
  let on = lsGet(ON) !== false;
  if (!map.getPane("riderTrails")) map.createPane("riderTrails").style.zIndex = 453;
  const renderer = L.svg({ pane: "riderTrails", padding: 0.3 });
  const layer = L.layerGroup();
  const arrows = L.layerGroup();
  (window.tfMtbLayers = window.tfMtbLayers || []).push(layer, arrows);   // hidden in Skiing and Hunting
  const lines = new Map();  // id -> polyline (for opening one from the list)

  async function load() {
    const a = acct();
    if (!a || !a.enabled || !navigator.onLine) return;
    const next = [];
    try {
      for (let from = 0; from < 20000; from += 1000) {
        const r = await fetch(`${a.url}/rest/v1/rpc/rider_trails_all`, { method: "POST", body: "{}",
          headers: { apikey: a.key, Authorization: `Bearer ${a.key}`, "Content-Type": "application/json", Range: `${from}-${from + 999}` } });
        if (!r.ok) return;   // not set up yet (supabase/rider-trails.sql), or no signal: keep this device's copy
        const rows = await r.json();
        next.push(...rows);
        if (rows.length < 1000) break;
      }
    } catch { return; }
    const before = JSON.stringify(all);
    all = next.filter((t) => Array.isArray(t.line) && t.line.length > 1);
    if (JSON.stringify(all) !== before) {
      const s = JSON.stringify(all);
      if (s.length < 2e6) lsSet(CACHE, all); else lsSet(CACHE, null);   // too big to keep: load it again next time
      draw(); paintBox();
    }
  }
  async function loadMine() {
    const a = acct();
    mine = new Map(); votes = new Map();
    if (!a || !a.enabled || !a.user || !navigator.onLine) { paintBox(); return; }
    await a.load();
    if (!a.client || !a.user) return;
    const [t, v] = await Promise.all([
      a.client.from("rider_trails").select("id,name,level,direction,notes,line,length_m,lat,lon,source,created_at,updated_at,blocked").eq("user_id", a.user.id).order("created_at", { ascending: false }),
      a.client.from("rider_trail_votes").select("trail_id,kind,reason").eq("user_id", a.user.id),
    ]).catch(() => [{}, {}]);
    (t && t.data || []).forEach((x) => mine.set(x.id, x));
    (v && v.data || []).forEach((x) => votes.set(x.trail_id, x));
    draw(); paintBox();
  }
  // Every trail to draw: everyone's, plus this rider's own ones the reports hid (they still see theirs).
  const everyTrail = () => { const ids = new Set(all.map((t) => t.id)); return [...all, ...[...mine.values()].filter((t) => !ids.has(t.id)).map((t) => ({ ...t, hiddenForOthers: true }))]; };
  function draw() {
    layer.clearLayers(); lines.clear();
    if (!on) return;
    everyTrail().forEach((t) => {
      const c = levelColor(t.level);
      L.polyline(t.line, { renderer, pane: "riderTrails", color: EDGE, weight: 10, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false }).addTo(layer);
      const line = L.polyline(t.line, { renderer, pane: "riderTrails", color: c, weight: 5, opacity: 1, lineCap: "round", lineJoin: "round", dashArray: t.level === "unknown" ? "8 6" : null, label: t.name }).addTo(layer);
      // A wider see-through line on top: an easy target for a finger.
      const hit = L.polyline(t.line, { renderer, pane: "riderTrails", color: "#000", weight: 22, opacity: 0.001 }).addTo(layer);
      const tip = `➕ ${esc(t.name)} · ${fmtM(t.length_m)} · added by a rider`;
      [line, hit].forEach((l) => { l.bindTooltip(tip, { sticky: true, direction: "top", offset: [0, -8] }); l.on("click", (e) => { L.DomEvent.stop(e); openTrail(t, e.latlng); }); });
      L.marker(middle(t.line), { pane: "riderTrails", icon: L.divIcon({ className: "", html: `<div class="rt-badge" aria-hidden="true">+</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
        .on("click", (e) => { L.DomEvent.stop(e); openTrail(t); }).addTo(layer);
      lines.set(t.id, line);
    });
  }
  function setOn(v) {
    on = v; lsSet(ON, v);
    if (layerBtn) layerBtn.setAttribute("aria-pressed", String(v));
    if (!v) { map.closePopup(); arrows.clearLayers(); }
    draw();
  }

  // Arrows along a one-way trail while its details are open, the way it was drawn (start to end).
  function drawArrows(g) {
    arrows.clearLayers();
    const pts = g.map((p) => map.latLngToLayerPoint(p));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += pts[i].distanceTo(pts[i - 1]);
    const n = Math.max(1, Math.min(6, Math.round(len / 110)));
    for (let k = 1; k <= n; k++) {
      let want = len * k / (n + 1), i = 1;
      while (i < pts.length - 1 && want > pts[i].distanceTo(pts[i - 1])) { want -= pts[i].distanceTo(pts[i - 1]); i++; }
      const a = g[i - 1], b = g[i];
      const deg = Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI;
      const f = Math.min(1, want / Math.max(1e-6, pts[i].distanceTo(pts[i - 1])));
      L.marker([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], { pane: "riderTrails", interactive: false, icon: L.divIcon({ className: "", html: `<div class="rt-arrow" style="transform: rotate(${deg - 90}deg)">➤</div>`, iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(arrows);
    }
  }

  // ---------- one trail's details (a popup on the map) ----------
  const signedIn = () => { const a = acct(); return !!(a && a.user); };
  const askSignIn = () => { const a = acct(); if (a && a.open) a.open(); };
  let openId = null;
  function popupHtml(t) {
    const own = mine.has(t.id), v = votes.get(t.id), p = t.line[0];
    const dir = t.direction === "oneway" ? "One way ➤ (see the arrows)" : t.direction === "both" ? "Ridden both ways" : "";
    const rode = t.rode ? `✓ ${t.rode === 1 ? "1 rider says" : `${t.rode} riders say`} they rode it. ` : "";
    return `<div class="rt-pop"><h3>${esc(t.name)}</h3><span class="rt-tag">➕ Added by a rider</span>
<div class="rt-facts">${levelBadge(t.level)}<b>${fmtM(t.length_m)}</b>${dir ? `<span>${esc(dir)}</span>` : ""}</div>
${t.notes ? `<p class="rt-notes">${esc(t.notes)}</p>` : ""}
<p class="rt-small">${rode}Added ${fmtDay(t.created_at)}${t.source && SOURCE[t.source] ? `, ${SOURCE[t.source]}` : ""}. Not on OpenStreetMap and not checked by Trail Finder: it may be private, closed or not quite where it's drawn.${t.hiddenForOthers ? " <b>Hidden from other riders:</b> several riders reported it." : ""}</p>
<div class="rt-acts">${own
  ? `<button type="button" data-edit>✎ Edit</button><button type="button" data-del>Delete</button>`
  : `<button type="button" data-rode aria-pressed="${!!(v && v.kind === "rode")}">✓ I rode it</button><button type="button" data-report aria-pressed="${!!(v && v.kind === "report")}">⚑ Report</button>`}
<a href="https://www.google.com/maps/dir/?api=1&destination=${p[0]},${p[1]}" target="_blank" rel="noopener">Go to the start</a>
<a href="https://www.openstreetmap.org/edit?editor=id#map=18/${middle(t.line)[0]}/${middle(t.line)[1]}" target="_blank" rel="noopener">Add to OpenStreetMap</a></div>
<div class="rt-msg muted" role="status"></div></div>`;
  }
  function openTrail(t, at) {
    if (!on) setOn(true);
    openId = t.id;
    const box = document.createElement("div");
    const paint = (msg) => {
      box.innerHTML = popupHtml(t);
      if (msg) box.querySelector(".rt-msg").textContent = msg;
      const btn = (sel, fn) => { const b = box.querySelector(sel); if (b) b.addEventListener("click", fn); };
      btn("[data-edit]", () => { map.closePopup(); form(mine.get(t.id) || t); });
      btn("[data-del]", async () => {
        if (!confirm(`Delete “${t.name}” for everyone?`)) return;
        const a = acct(); await a.load();
        const { error } = await a.client.from("rider_trails").delete().eq("id", t.id);
        if (error) { paint("Couldn't delete it: " + error.message); return; }
        map.closePopup(); mine.delete(t.id); all = all.filter((x) => x.id !== t.id); lsSet(CACHE, all); draw(); paintBox();
      });
      btn("[data-rode]", async () => {
        if (!signedIn()) { askSignIn(); return; }
        const v = votes.get(t.id), undo = v && v.kind === "rode";
        const e = await vote(t, undo ? null : { kind: "rode" });
        if (e) { paint("Couldn't save that: " + e); return; }
        t.rode = Math.max(0, (t.rode || 0) + (undo ? -1 : 1)); if (!undo && v && v.kind === "report") t.reports = Math.max(0, (t.reports || 0) - 1);
        paint(undo ? "Taken back." : "Thanks! Other riders see that you rode it.");
      });
      btn("[data-report]", () => { if (!signedIn()) { askSignIn(); return; } report(t, () => paint("Thanks: your report is in. Trails several riders report stop showing.")); });
    };
    paint();
    const pop = L.popup({ maxWidth: 300, autoPanPaddingTopLeft: [10, 130], autoPanPaddingBottomRight: [10, 90] }).setLatLng(at || middle(t.line)).setContent(box).openOn(map);
    if (t.direction === "oneway") drawArrows(t.line); else arrows.clearLayers();
    pop.on("remove", () => { if (openId === t.id) { openId = null; arrows.clearLayers(); } });
  }
  async function vote(t, v) {
    const a = acct(); await a.load();
    if (!a.client || !a.user) return "Sign in first";
    const { error } = v
      ? await a.client.from("rider_trail_votes").upsert({ trail_id: t.id, user_id: a.user.id, kind: v.kind, reason: v.reason || null, note: v.note || null, created_at: new Date().toISOString() }, { onConflict: "trail_id,user_id" })
      : await a.client.from("rider_trail_votes").delete().eq("trail_id", t.id).eq("user_id", a.user.id);
    if (error) return error.message;
    if (v) votes.set(t.id, { trail_id: t.id, ...v }); else votes.delete(t.id);
    return null;
  }

  // ---------- dialogs ----------
  const dlg = document.createElement("dialog");
  dlg.className = "rt-dlg";
  document.body.appendChild(dlg);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });   // a tap outside closes it
  const show = (html) => { dlg.innerHTML = html; if (!dlg.open) dlg.showModal(); return dlg; };

  function report(t, done) {
    const v = votes.get(t.id), had = v && v.kind === "report";
    show(`<form method="dialog"><h2>Report this trail</h2><p>“${esc(t.name)}”. What's wrong with it?</p>
<div class="rt-reasons">${REASONS.map(([k, n]) => `<label><input type="radio" name="why" value="${k}"${had && v.reason === k ? " checked" : ""}>${esc(n)}</label>`).join("")}</div>
<label class="rt-l" for="rtRepNote">Anything to add (optional)</label><textarea id="rtRepNote" maxlength="280"></textarea>
<p class="rt-msg" role="status"></p>
<div class="rt-row">${had ? `<button type="button" data-undo>Take back my report</button>` : ""}<button type="button" data-x>Cancel</button><button type="submit" class="go">Send report</button></div></form>`);
    const msg = dlg.querySelector(".rt-msg");
    dlg.querySelector("[data-x]").addEventListener("click", () => dlg.close());
    const undo = dlg.querySelector("[data-undo]");
    if (undo) undo.addEventListener("click", async () => { const e = await vote(t, null); if (e) { msg.textContent = e; return; } t.reports = Math.max(0, (t.reports || 0) - 1); dlg.close(); });
    dlg.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const why = dlg.querySelector("input[name=why]:checked");
      if (!why) { msg.textContent = "Pick what's wrong first."; msg.className = "rt-msg err"; return; }
      const err = await vote(t, { kind: "report", reason: why.value, note: $("rtRepNote").value.trim().slice(0, 280) });
      if (err) { msg.textContent = "Couldn't send it: " + err; msg.className = "rt-msg err"; return; }
      if (!had) t.reports = (t.reports || 0) + 1;
      if (v && v.kind === "rode") t.rode = Math.max(0, (t.rode || 0) - 1);
      dlg.close(); done();
    });
  }

  // "How do you want to add it?"
  const finds = () => (window.tfRideFinds ? window.tfRideFinds.saved() : []);
  function start() {
    if (isAlt()) { const s = $("sport"); if (s) { s.value = "mtb"; s.dispatchEvent(new Event("change", { bubbles: true })); } }
    const f = finds();
    show(`<h2>Add a trail</h2><p>Know a trail that isn't on the map? Add it and every Trail Finder rider sees it, marked “Added by a rider”.${acct() && acct().enabled && !signedIn() ? " You'll need to sign in to share it (free, just an email)." : ""}</p>
<div class="rt-pick">
<button type="button" data-how="draw">✎ Draw it on the map<small>Tap along the trail from its start to its end</small></button>
${f.length ? `<button type="button" data-how="finds">🆕 From one of my rides<small>${f.length === 1 ? "The possible new trail" : `${f.length} possible new trails`} you saved from your rides</small></button>` : `<button type="button" data-how="rides">🆕 From one of my rides<small>Open a ride in My rides: stretches off the map show there, each with “Add for everyone”</small></button>`}
<label class="rt-file"><button type="button" data-how="gpx">📄 From a GPS file<small>GPX, TCX or FIT, from Strava, Garmin, Trailforks…</small></button><input type="file" accept=".gpx,.tcx,.fit,.gz,application/gpx+xml" hidden></label>
</div><p class="rt-msg" role="status"></p><div class="rt-row"><button type="button" data-x>Cancel</button></div>`);
    const msg = dlg.querySelector(".rt-msg"), file = dlg.querySelector("input[type=file]");
    dlg.querySelector("[data-x]").addEventListener("click", () => dlg.close());
    dlg.querySelector("[data-how=draw]").addEventListener("click", () => { dlg.close(); startDraw(); });
    const fb = dlg.querySelector("[data-how=finds]");
    if (fb) fb.addEventListener("click", () => pickFind());
    const rb = dlg.querySelector("[data-how=rides]");
    if (rb) rb.addEventListener("click", () => { location.href = "ride.html#rides"; });
    dlg.querySelector("[data-how=gpx]").addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const fl = file.files && file.files[0];
      if (!fl) return;
      msg.className = "rt-msg"; msg.textContent = "Reading the file…";
      try {
        if (!window.tfRideFiles) throw new Error("the file reader didn't load");
        const r = await window.tfRideFiles.read(fl);
        const g = tidy((r.points || []).filter((p) => p[0] != null && p[1] != null));
        if (g.length < 2) throw new Error("no track in it");
        const m = lengthOf(g);
        if (m > 50000) throw new Error("it's " + fmtM(m) + " long: a trail is one piece of a ride (up to 50 km). Draw it instead, or cut the file down first.");
        dlg.close();
        map.fitBounds(L.latLngBounds(g), { padding: [40, 40], maxZoom: 16 });
        form({ line: g, source: "gpx", name: (r.name || "").slice(0, 80) });
      } catch (e) { msg.className = "rt-msg err"; msg.textContent = "Couldn't use that file: " + (e.message || e); }
    });
  }
  function pickFind() {
    const F = window.tfRideFinds, f = finds();
    show(`<h2>Which one?</h2><p>Possible new trails you saved from your rides.</p><div class="rt-pick">${f.map((x, i) => `<button type="button" data-i="${i}">🆕 ${esc(x.name || "Possible new trail")}<small>${F.facts(x).replace(/<[^>]+>/g, "")}${x.at ? ` · ${fmtDay(x.at)}` : ""}</small></button>`).join("")}</div>
<div class="rt-row"><button type="button" data-x>Back</button></div>`);
    dlg.querySelector("[data-x]").addEventListener("click", start);
    dlg.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => { dlg.close(); fromFind(f[+b.dataset.i]); }));
  }
  function fromFind(f) {
    if (!f || !f.g) return;
    const g = tidy(f.g);
    map.fitBounds(L.latLngBounds(g), { padding: [40, 40], maxZoom: 16 });
    form({ line: g, source: "ride", name: f.name || "", find: f.id });
  }

  // The trail's details: name, level, which way, notes. t: a new one ({ line, source, name }) or one of yours.
  let preview = null;
  function form(t) {
    const edit = !!t.id;
    const g = t.line, m = Math.round(lengthOf(g));
    if (preview) map.removeLayer(preview);
    preview = L.layerGroup([
      L.polyline(g, { pane: "riderTrails", color: EDGE, weight: 10, opacity: 0.9, interactive: false }),
      L.polyline(g, { pane: "riderTrails", color: "#14211a", weight: 4, opacity: 1, interactive: false }),
    ]).addTo(map);
    let level = t.level || "", dir = t.direction || "";
    show(`<form method="dialog" novalidate><h2>${edit ? "Edit trail" : "Add a trail"}</h2>
<p><b>${fmtM(m)}</b>${SOURCE[t.source] ? `, ${SOURCE[t.source]}` : ""}. ${edit ? "Your changes show to everyone." : "It's on the map behind this box."}</p>
<label class="rt-l" for="rtName">Name</label><input type="text" id="rtName" maxlength="80" autocomplete="off" placeholder="What riders call it" value="${esc(t.name || "")}">
<label class="rt-l">Level</label><div class="rt-seg" id="rtLevel">${LEVELS.map(([k, n]) => `<button type="button" data-v="${k}" aria-pressed="${level === k}">${esc(n)}</button>`).join("")}</div>
<label class="rt-l">Which way is it ridden?</label><div class="rt-seg" id="rtDir">${DIRS.map(([k, n]) => `<button type="button" data-v="${k}" aria-pressed="${dir === k}">${esc(n)}${k === "oneway" ? ` <small>(${t.source === "draw" ? "the way you drew it" : "the way you rode it"})</small>` : ""}</button>`).join("")}</div>
<label class="rt-l" for="rtNotes">Notes (optional)</label><textarea id="rtNotes" maxlength="600" placeholder="What it's like, features, where it starts, best season">${esc(t.notes || "")}</textarea>
${edit ? "" : `<label class="rt-ok"><input type="checkbox" id="rtOk"><span>I've ridden it, and as far as I know bikes are allowed (not private land, not closed).</span></label>`}
<p class="rt-small muted" style="font-size:.82rem;margin:6px 0 0">Everyone sees it, marked “Added by a rider”. Your name and email are never shown.</p>
<p class="rt-msg" role="status"></p>
<div class="rt-row">${t.source === "draw" && !edit ? `<button type="button" data-redraw>↶ Change the line</button>` : ""}<button type="button" data-x>Cancel</button><button type="submit" class="go" id="rtSave">${edit ? "Save changes" : signedIn() || !(acct() && acct().enabled) ? "Share it" : "Sign in and share"}</button></div></form>`);
    const msg = dlg.querySelector(".rt-msg");
    const seg = (id, set) => $(id).addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (!b) return; set(b.dataset.v); $(id).querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
    seg("rtLevel", (v) => { level = v; }); seg("rtDir", (v) => { dir = v; });
    const close = () => { dlg.close(); };
    dlg.querySelector("[data-x]").addEventListener("click", () => { if (!edit) lsSet(DRAFT, null); close(); });
    const rd = dlg.querySelector("[data-redraw]");
    if (rd) rd.addEventListener("click", () => { close(); startDraw(g); });
    dlg.addEventListener("close", () => { if (preview) { map.removeLayer(preview); preview = null; } }, { once: true });
    const err = (s) => { msg.className = "rt-msg err"; msg.textContent = s; };
    dlg.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("rtName").value.trim();
      if (!name) { err("Give it a name: what riders call it, or one you make up."); $("rtName").focus(); return; }
      if (!edit && !$("rtOk").checked) { err("Tick the box to say you've ridden it and bikes are allowed."); return; }
      const row = { name: name.slice(0, 80), level: level || "unknown", direction: dir || "unknown", notes: $("rtNotes").value.trim().slice(0, 600) || null };
      const a = acct();
      if (!a || !a.enabled) { err("Sharing trails isn't set up yet."); return; }
      if (!navigator.onLine) { err("No signal: try again when you're back online. It stays here until you close this box."); return; }
      if (!a.user) {   // keep it, sign in, and come back to this box (see tf:account below)
        lsSet(DRAFT, { ...t, ...row, ok: true });
        close(); askSignIn(); return;
      }
      const save = $("rtSave"); save.disabled = true; msg.className = "rt-msg"; msg.textContent = "Sharing…";
      await a.load();
      const mid = middle(g);
      const res = edit
        ? await a.client.from("rider_trails").update(row).eq("id", t.id).select().single()
        : await a.client.from("rider_trails").insert({ ...row, line: g, length_m: Math.max(30, m), lat: mid[0], lon: mid[1], source: t.source || "draw" }).select().single();
      if (res.error) { save.disabled = false; err("Couldn't save it: " + res.error.message); return; }
      lsSet(DRAFT, null);
      const saved = { rode: 0, reports: 0, ...(all.find((x) => x.id === res.data.id) || {}), ...res.data };
      delete saved.user_id;
      mine.set(saved.id, saved);
      all = [saved, ...all.filter((x) => x.id !== saved.id)];
      lsSet(CACHE, all);
      if (t.find && window.tfRideFinds) window.tfRideFinds.remove(t.find);   // it's everyone's now, not only a private find
      close();
      if (!on) setOn(true); else draw();
      paintBox();
      openTrail(saved);
      setTimeout(() => { const b = document.querySelector(".rt-pop .rt-msg"); if (b && !edit) b.textContent = "Shared! Every rider sees it now."; }, 50);
    });
    if (!edit && !t.name) setTimeout(() => $("rtName").focus(), 50);
  }

  // ---------- drawing on the map ----------
  let drawing = null;   // { pts, layer, bar }
  const bar = document.createElement("div");
  bar.className = "rt-bar"; bar.hidden = true;
  bar.innerHTML = `<h3>✎ Draw the trail</h3><p>Tap along the trail from its start to its end, the way it's ridden. Zoom in for a close line; drag to move the map.</p>
<div class="rt-stat" id="rtStat">Tap where the trail starts</div>
<div class="rt-btns"><button type="button" id="rtUndo" disabled>↶ Undo</button><button type="button" id="rtCancel">Cancel</button><button type="button" class="go" id="rtNext" disabled>Next ›</button></div>`;
  document.body.appendChild(bar);
  function paintDraw() {
    const d = drawing; if (!d) return;
    d.layer.clearLayers();
    if (d.pts.length > 1) {
      L.polyline(d.pts, { pane: "riderTrails", color: EDGE, weight: 10, opacity: 0.9, interactive: false }).addTo(d.layer);
      L.polyline(d.pts, { pane: "riderTrails", color: "#14211a", weight: 4, interactive: false }).addTo(d.layer);
    }
    d.pts.forEach((p, i) => L.marker(p, { pane: "riderTrails", interactive: false, icon: L.divIcon({ className: "", html: `<div class="rt-dot${i === d.pts.length - 1 ? " end" : ""}"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(d.layer));
    const m = lengthOf(d.pts);
    $("rtStat").textContent = !d.pts.length ? "Tap where the trail starts" : d.pts.length === 1 ? "Now tap along the trail" : `${d.pts.length} points · ${fmtM(m)}`;
    $("rtUndo").disabled = !d.pts.length;
    $("rtNext").disabled = d.pts.length < 2 || m < 30;
  }
  function setDrawing(v) {
    const app = document.querySelector(".app"), before = $("map").getBoundingClientRect();
    if (app) app.classList.toggle("rt-drawing", v);
    document.body.classList.toggle("rt-drawing", v);
    bar.hidden = !v;
    map.invalidateSize({ pan: false });
    const after = $("map").getBoundingClientRect();
    map.panBy([after.left - before.left, after.top - before.top], { animate: false });
  }
  function startDraw(from) {
    if (drawing) return;
    if (window.tfPlan && window.tfPlan.planning && window.tfPlan.planning()) { const x = document.querySelector(".plan-x"); if (x) x.click(); }
    const b3 = $("btn3d"); if (b3 && b3.getAttribute("aria-pressed") === "true") b3.click();   // drawing works on the flat map
    map.closePopup();
    drawing = { pts: from ? from.slice() : [], layer: L.layerGroup().addTo(map) };
    setDrawing(true);
    if (!from && map.getZoom() < 14) map.setZoom(15);
    paintDraw();
  }
  function stopDraw() {
    if (!drawing) return;
    map.removeLayer(drawing.layer); drawing = null;
    setDrawing(false);
  }
  $("rtUndo").addEventListener("click", () => { if (drawing) { drawing.pts.pop(); paintDraw(); } });
  $("rtCancel").addEventListener("click", stopDraw);
  $("rtNext").addEventListener("click", () => { const g = tidy(drawing.pts); stopDraw(); form({ line: g, source: "draw" }); });
  // A tap places a point, even on a trail line (its own click would open the trail), so listen before Leaflet does.
  // A drag to pan doesn't count.
  let downAt = null;
  const box2d = map.getContainer();
  box2d.addEventListener("pointerdown", (e) => { downAt = drawing && e.isPrimary ? [e.clientX, e.clientY] : null; }, true);
  box2d.addEventListener("click", (e) => {
    if (!drawing || !downAt || e.target.closest(".leaflet-control, .leaflet-popup")) return;
    if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 8) return;
    e.stopPropagation(); e.preventDefault();
    const ll = map.mouseEventToLatLng(e);
    drawing.pts.push([ll.lat, ll.lng]);
    if (window.tfHaptic) window.tfHaptic();
    paintDraw();
  }, true);
  document.addEventListener("keydown", (e) => { if (drawing && e.key === "Escape") stopDraw(); });

  // ---------- Layers switch, and the box under My trails ----------
  let layerBtn = null;
  const park = $("parkBtn");
  if (park) {
    layerBtn = document.createElement("button");
    layerBtn.type = "button"; layerBtn.id = "rtLayerBtn";
    layerBtn.title = "Show trails riders added that aren't on OpenStreetMap yet";
    layerBtn.textContent = "➕ Rider-added trails";
    layerBtn.setAttribute("aria-pressed", String(on));
    park.after(layerBtn);
    layerBtn.addEventListener("click", () => setOn(!on));
  }
  const rtBox = document.createElement("div");
  rtBox.id = "rtBox";
  function placeBox() {
    const w = $("wantList"), at = w && w.closest("#hub") ? w : $("spBox") || w;   // phones' Saved page borrows My trails
    if (at && at.nextElementSibling !== rtBox) at.after(rtBox);
  }
  function paintBox() {
    placeBox();
    const own = [...mine.values()], n = all.length;
    const showing = new Set(all.map((t) => t.id));
    rtBox.innerHTML = `<div class="rt-head"><b>➕ Trails added by riders</b><button type="button" class="rt-add" data-add>➕ Add a trail</button></div>
<p>${n ? `${n === 1 ? "1 trail" : `${n} trails`} riders added that aren't on the map yet, on a yellow edge with a <b>+</b>.` : "Know a trail that isn't on the map? Add it for every rider."}</p>
${own.length ? `<ul>${own.map((t) => `<li><button type="button" data-id="${esc(t.id)}">${levelBadge(t.level)} <b>${esc(t.name)}</b> <span class="muted">${fmtM(t.length_m)}${t.blocked || !showing.has(t.id) ? " · hidden from others" : ""}</span></button></li>`).join("")}</ul>` : ""}`;
    rtBox.querySelector("[data-add]").addEventListener("click", start);
    rtBox.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", () => {
      const t = everyTrail().find((x) => x.id === b.dataset.id);
      if (!t) return;
      if (!on) setOn(true);
      if (window.tfSnapTo && matchMedia("(max-width: 760px)").matches) window.tfSnapTo("peek");   // phones: the map, not the Saved page
      map.fitBounds(L.latLngBounds(t.line), { padding: [40, 40], maxZoom: 16 });
      setTimeout(() => openTrail(t), 350);
    }));
  }
  // My trails moves between pages (Saved on phones): keep the box beside it.
  new MutationObserver(placeBox).observe(document.body, { childList: true, subtree: true });

  // ---------- coming back from sign-in, or from ride.html (#addtrail=<find id>) ----------
  window.addEventListener("tf:account", () => {
    loadMine();
    const d = lsGet(DRAFT);
    if (d && signedIn() && Array.isArray(d.line)) { lsSet(DRAFT, null); setTimeout(() => form(d), 300); }
  });
  function fromHash() {
    const m = location.hash.match(/^#addtrail(?:=(.+))?$/);
    if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    const id = m[1] && decodeURIComponent(m[1]);
    const f = id && finds().find((x) => x.id === id);
    setTimeout(() => (f ? fromFind(f) : start()), 600);
  }
  window.addEventListener("hashchange", fromHash);

  // Search (index.html): a rider-added trail found by name opens like one tapped in the Saved list.
  function openById(id) {
    const t = everyTrail().find((x) => x.id === id);
    if (!t) return;
    if (!on) setOn(true);
    map.fitBounds(L.latLngBounds(t.line), { padding: [40, 40], maxZoom: 16 });
    setTimeout(() => openTrail(t), 350);
  }
  window.tfRiderTrails = { start, fromFind, draw: startDraw, all: () => everyTrail(), open: openById };
  if (!isAlt()) { layer.addTo(map); arrows.addTo(map); }
  draw(); paintBox(); fromHash();
  setTimeout(load, 2000);
  setInterval(() => { if (document.visibilityState === "visible") load(); }, 15 * 60000);
  window.addEventListener("online", load);
  if (acct() && acct().ready) acct().ready.then(() => { if (signedIn()) loadMine(); });
})();
