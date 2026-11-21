// Two-finger measure (alex 2026-11-21, "small extras"): hold two fingers still on the map for a moment and a line
// joins them, with the straight-line distance between the two spots of ground under them. Slide the fingers to measure
// something else; the map holds still meanwhile. Lift a finger and the result stays a moment, then fades.
// Works on the flat map and the web 3D map, in every sport, on phones and tablets (touch only). The iPhone's own 3D map
// does the same (ios-app/.../NativeFingers.swift; native-fingers.js sends it the words).
// Fingers that move before the moment is up are the map's own (pinch to zoom, twist to turn, slide up to tilt):
// nothing here touches those. Only once two fingers have stayed still does this take their moves.
(() => {
  "use strict";
  const map = window.tfLeaflet, L = window.L;
  if (!map || !L || !("ontouchstart" in window)) return;
  const t = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);
  const HOLD_MS = 550, STILL_PX = 10, SHOW_MS = 2500;

  const css = document.createElement("style");
  css.textContent = `
.fm-layer { position: fixed; inset: 0; z-index: 3000; pointer-events: none; }
.fm-layer[hidden] { display: none; }
.fm-layer svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.fm-layer .fm-label { position: absolute; left: 0; top: 0; white-space: nowrap; padding: 5px 12px; border-radius: 14px; background: rgba(255,255,255,.96);
  color: #14211a; font: 700 14px/18px system-ui, -apple-system, sans-serif; box-shadow: 0 1px 4px rgba(0,0,0,.3); transition: opacity .4s; }
.fm-layer.fm-fade { opacity: 0; transition: opacity .4s; }
`;
  document.head.append(css);
  const box = document.createElement("div");
  box.className = "fm-layer"; box.hidden = true; box.setAttribute("aria-hidden", "true");
  box.innerHTML = '<svg aria-hidden="true"><path class="fm-case" fill="#14211a" stroke="#14211a" stroke-opacity=".85" stroke-width="5" stroke-linecap="round"/>'
    + '<path class="fm-line" fill="#fff" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg><div class="fm-label"></div>';
  document.body.append(box);
  const caseEl = box.querySelector(".fm-case"), lineEl = box.querySelector(".fm-line"), label = box.querySelector(".fm-label");

  // The web 3D map while it's showing (map3d.js), else the flat map.
  const gl = () => {
    const g = window.tf3dGl ? window.tf3dGl() : null;
    return g && map.getContainer().classList.contains("is3d") ? g : null;
  };
  const onMap = (el) => {
    if (!el || !el.closest) return false;
    const g = gl();
    if (g) return g.getCanvasContainer().contains(el);
    return map.getContainer().contains(el) && !el.closest(".leaflet-control-container, .leaflet-popup, .leaflet-marker-pane, .leaflet-tooltip-pane");
  };
  // The spot of ground under a point on the screen (MapLibre reads the mountains' heights under it in 3D).
  function ground(x, y) {
    const g = gl();
    if (g) {
      const r = g.getCanvasContainer().getBoundingClientRect();
      const p = g.unproject([x - r.left, y - r.top]);
      if (!p || !isFinite(p.lat) || !isFinite(p.lng) || Math.abs(p.lat) > 85) return null;
      // A point on the sky comes back as the horizon: only a spot that lands back under the finger is ground.
      const back = g.project(p);
      return back && Math.hypot(back.x - (x - r.left), back.y - (y - r.top)) <= 12 ? L.latLng(p.lat, p.lng) : null;
    }
    const r = map.getContainer().getBoundingClientRect();
    const p = map.containerPointToLatLng(L.point(x - r.left, y - r.top));
    return p && isFinite(p.lat) && isFinite(p.lng) ? p : null;
  }
  // Metres under 1 km (to 10 m past 100 m), then km: the same as NativeFingers.swift.
  const fmt = (m) => (m < 1000 ? `${Math.round(m / (m < 100 ? 1 : 10)) * (m < 100 ? 1 : 10)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`);

  // active: the line shows and follows two fingers; held: this touch keeps its moves from the map until every finger
  // is up (a finger left on the map would otherwise move it from where it went down).
  let start = null, last = null, timer = 0, active = false, held = false, fadeT = 0;
  const pts = (e) => [[e.touches[0].clientX, e.touches[0].clientY], [e.touches[1].clientX, e.touches[1].clientY]];
  function draw(a, b) {
    const dot = (p) => `M${p[0] + 5} ${p[1]}a5 5 0 1 0 -10 0a5 5 0 1 0 10 0`;
    const d = `M${a[0]} ${a[1]}L${b[0]} ${b[1]}${dot(a)}${dot(b)}`;
    caseEl.setAttribute("d", d); lineEl.setAttribute("d", d);
    const ga = ground(a[0], a[1]), gb = ground(b[0], b[1]);
    // A finger on the sky (far tilted 3D views) has no ground under it: the line shows, with no distance.
    label.hidden = !(ga && gb);
    if (label.hidden) return;
    label.textContent = `${fmt(ga.distanceTo(gb))} ${t("straight line")}`;
    const w = label.offsetWidth, h = label.offsetHeight;
    const x = Math.min(Math.max(8, (a[0] + b[0]) / 2 - w / 2), innerWidth - w - 8), y = Math.min(Math.max(8, Math.min(a[1], b[1]) - 70), innerHeight - h - 8);
    label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  const reset = () => { clearTimeout(timer); timer = 0; start = null; };
  function finish() {
    reset();
    if (!active) return;
    active = false;   // held stays until every finger is up
    clearTimeout(fadeT);
    fadeT = setTimeout(() => { box.classList.add("fm-fade"); fadeT = setTimeout(() => { box.hidden = true; box.classList.remove("fm-fade"); }, 400); }, SHOW_MS);
  }

  addEventListener("touchstart", (e) => {
    if (active) { if (e.touches.length > 2) finish(); return; }
    if (held) return;
    reset();
    if (e.touches.length !== 2 || ![...e.touches].every((p) => onMap(p.target))) return;
    start = last = pts(e);
    timer = setTimeout(() => {
      timer = 0;
      if (!start) return;
      active = held = true;
      clearTimeout(fadeT); box.classList.remove("fm-fade"); box.hidden = false;
      draw(last[0], last[1]);
    }, HOLD_MS);
  }, { capture: true, passive: true });

  // Before the moment is up, moving fingers are the map's (left alone); once measuring, the moves are only the line's.
  // Lifting a finger always reaches the map, so its own pinch and twist end cleanly.
  addEventListener("touchmove", (e) => {
    if (held) {
      e.preventDefault(); e.stopPropagation();
      if (!active || e.touches.length < 2) return;
      const p = pts(e);
      draw(p[0], p[1]);
      return;
    }
    if (!start || e.touches.length !== 2) return;
    const p = pts(e);
    if (p.some((q, i) => Math.hypot(q[0] - start[i][0], q[1] - start[i][1]) > STILL_PX)) reset();
    else last = p;
  }, { capture: true, passive: false });
  const up = (e) => {
    const n = e.touches ? e.touches.length : 0;
    if ((active || start) && n < 2) finish();
    if (!n) held = false;
  };
  addEventListener("touchend", up, { capture: true, passive: true });
  addEventListener("touchcancel", up, { capture: true, passive: true });
})();
