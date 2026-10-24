// Compass mode for Hunting, like onX Hunt's (alex, 2026-10-24: "research all about the compass mode of onX hunt and I
// want to add the same feature to the hunt mode"). What onX's does, and so this one:
//  - your heading at the top in degrees from true north, with the direction (N, NE...); a tap on it switches to
//    magnetic north, for checking against a hand compass;
//  - the map turns with the phone so the way you face is always up, centred a little below the middle on you (2D and 3D);
//  - a sight line straight ahead of you with distance marks, to judge how far things in view are;
//  - Lock: holds the heading still, and the map stops turning;
//  - Range: a red target on the sight line. Drag up or down anywhere on the map (or type what your rangefinder says)
//    to set how far, then Drop pin saves a point there, for an animal you ranged, where it stood at the shot, a stand...
//  - Go to: tap the map (or drop a pin) and the line to it shows how far and how much to turn left or right.
// The phone's compass points to magnetic north; the World Magnetic Model (WMM2025, NOAA, valid 2025 to 2029) gives the
// difference to true north wherever you are (about 15° east around Squamish, 13° around Calgary).
// A phone with no compass (or a computer): the map is turned by hand (two fingers, or right-drag) and the line follows it.
// iPhone: Safari asks once to use motion and orientation; the iPhone app (Capacitor) is allowed without asking.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const ORANGE = "#d9480f", RED = "#e03131", BLUE = "#1c7ed6", rad = Math.PI / 180;
  const $ = (id) => document.getElementById(id);
  const isHunt = () => document.body.classList.contains("sport-hunt");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("tf:" + k, JSON.stringify(v)); } catch {} },
  };
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const deg360 = (d) => ((d % 360) + 360) % 360;
  const turn = (a, b) => ((a - b + 540) % 360) - 180;   // from b to a, -180..180
  const dirOf = (d) => DIRS[Math.round(deg360(d) / 45) % 8];
  const fmtM = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
  const YD = 0.9144;

  // ---------- true north: the World Magnetic Model ----------
  // Gauss coefficients of WMM2025 (n = 1..12, m = 0..n in order), main field in nT and yearly change.
  const WMM = {
    g: [-29351.8,-1410.8,-2556.6,2951.1,1649.3,1361,-2404.1,1243.8,453.6,895,799.5,55.7,-281.1,12.1,-233.2,368.9,187.2,-138.7,-142,20.9,64.4,63.8,76.9,-115.7,-40.9,14.9,-60.7,79.5,-77,-8.8,59.3,15.8,2.5,-11.1,14.2,23.2,10.8,-17.5,2,-21.7,16.9,15,-16.8,0.9,4.6,7.8,3,-0.2,-2.5,-13.1,2.4,8.6,-8.7,-12.9,-1.3,-6.4,0.2,2,-1,-0.6,-0.9,1.5,0.9,-2.7,-3.9,2.9,-1.5,-2.5,2.4,-0.6,-0.1,-0.6,-0.1,1.1,-1,-0.2,2.6,-2,-0.2,0.3,1.2,-1.3,0.6,0.6,0.5,-0.1,-0.4,-0.2,-1.3,-0.7],
    h: [0,4545.4,0,-3133.6,-815.1,0,-56.6,237.5,-549.5,0,278.6,-133.9,212,-375.6,0,45.4,220.2,-122.9,43,106.1,0,-18.4,16.8,48.8,-59.8,10.9,72.7,0,-48.9,-14.4,-1,23.4,-7.4,-25.1,-2.3,0,7.1,-12.6,11.4,-9.7,12.7,0.7,-5.2,3.9,0,-24.8,12.2,8.3,-3.3,-5.2,7.2,-0.6,0.8,10,0,3.3,0,2.4,5.3,-9.1,0.4,-4.2,-3.8,0.9,-9.1,0,0,2.9,-0.6,0.2,0.5,-0.3,-1.2,-1.7,-2.9,-1.8,-2.3,0,-1.3,0.7,1,-1.4,0,0.6,-0.1,0.8,0.1,-1,0.1,0.2],
    gd: [12,9.7,-11.6,-5.2,-8,-1.3,-4.2,0.4,-15.6,-1.6,-2.4,-6,5.6,-7,0.6,1.4,0,0.6,2.2,0.9,-0.2,-0.4,0.9,1.2,-0.9,0.3,0.9,0,-0.1,-0.1,0.5,-0.1,-0.8,-0.8,0.8,-0.1,0.2,0,0.5,-0.1,0.3,0.2,0,0.2,0,-0.1,0.1,0.3,-0.3,0,0.3,-0.1,0.1,-0.1,0.1,0,0.1,0.1,0,-0.3,0,-0.1,-0.1,0,0,0,0,0,0,0,-0.1,0,0,-0.1,-0.1,-0.1,-0.1,0,0,0,0,0,0,0.1,0,0,0,-0.1,0,-0.1],
    hd: [0,-21.5,0,-27.7,-12.1,0,4,-0.3,-4.1,0,-1.1,4.1,1.6,-4.4,0,-0.5,2.2,0.4,1.7,1.9,0,0.3,-1.6,-0.4,0.9,0.7,0.9,0,0.6,0.5,-0.8,0,-1,0.6,-0.2,0,-0.2,0.5,-0.4,0.4,-0.5,-0.6,0.3,0.2,0,-0.3,0.3,-0.3,0.3,0.2,-0.1,-0.2,0.4,0.1,0,0,0,-0.2,0.1,-0.1,0.1,0,-0.1,0.2,0,0,0,0.1,0,0.1,0,0,0.1,0,0,0,0,0,0,0,-0.1,0.1,0,0,0,0,0,0,0,-0.1],
  };
  function declination(lat, lon, when = Date.now()) {
    const t = Math.max(-1, Math.min(6, (when - Date.UTC(2025, 0, 1)) / 31557600000));
    const A = 6378.137, E2 = 0.00669437999014, R = 6371.2, sp = Math.sin(lat * rad), cp = Math.cos(lat * rad);
    const rc = A / Math.sqrt(1 - E2 * sp * sp), r = Math.hypot(rc * cp, rc * (1 - E2) * sp), pc = Math.asin((rc * (1 - E2) * sp) / r);   // on the ground, geocentric
    const leg = (p) => {   // Schmidt semi-normalised Legendre functions of sin(p)
      const x = Math.sin(p), c = Math.cos(p), P = [[1]];
      for (let n = 1; n <= 12; n++) {
        P[n] = [];
        for (let m = 0; m <= n; m++) {
          if (m === n) P[n][m] = n === 1 ? c : Math.sqrt((2 * n - 1) / (2 * n)) * c * P[n - 1][n - 1];
          else P[n][m] = ((2 * n - 1) * x * P[n - 1][m] - (m <= n - 2 ? Math.sqrt((n - 1) ** 2 - m * m) * P[n - 2][m] : 0)) / Math.sqrt(n * n - m * m);
        }
      }
      return P;
    };
    const P = leg(pc), Pa = leg(pc + 1e-6), Pb = leg(pc - 1e-6);
    let X = 0, Y = 0, Z = 0, i = 0;
    for (let n = 1; n <= 12; n++) {
      const k = (R / r) ** (n + 2);
      for (let m = 0; m <= n; m++, i++) {
        const g = WMM.g[i] + t * WMM.gd[i], h = WMM.h[i] + t * WMM.hd[i], cm = Math.cos(m * lon * rad), sm = Math.sin(m * lon * rad);
        X -= k * (g * cm + h * sm) * ((Pa[n][m] - Pb[n][m]) / 2e-6);
        Y += k * m * (g * sm - h * cm) * P[n][m];
        Z -= (n + 1) * k * (g * cm + h * sm) * P[n][m];
      }
    }
    const d = pc - lat * rad;
    return Math.atan2(Y / Math.cos(pc), X * Math.cos(d) - Z * Math.sin(d)) / rad;
  }
  window.tfDeclination = declination;

  // ---------- on the ground ----------
  function ahead(p, deg, m) {   // the point m metres from p towards deg
    const d = m / 6371008.8, b = deg * rad, la = p.lat * rad, lo = p.lon * rad;
    const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return { lat: la2 / rad, lon: (((lo2 / rad) + 540) % 360) - 180 };
  }
  function bearingTo(a, b) {
    const la1 = a.lat * rad, la2 = b.lat * rad, dl = (b.lon - a.lon) * rad;
    return deg360(Math.atan2(Math.sin(dl) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl)) / rad);
  }
  const dist = (a, b) => map.distance([a.lat, a.lon], [b.lat, b.lon]);

  // ---------- state ----------
  const S = {
    on: false,
    sensor: null,     // the phone compass, smoothed: { x, y } (a unit vector, so 359° and 1° average to 0°), magnetic
    sensorAt: 0,      // when it last spoke
    acc: null,        // iPhone: how far off it may be, in degrees
    manual: false,    // no compass: the heading is the way the map faces
    denied: false,
    locked: null,     // the heading held by Lock
    you: null,        // { lat, lon, acc } from the GPS
    watch: null,
    free: false,      // the person moved the map: stop moving it until Recenter
    range: null,      // metres to the rangefinder target, or null when it's off
    target: null,     // go to: { lat, lon, name }
    wake: null,
  };
  let north = store.get("compassNorth", "true");   // "true" or "mag"
  let unit = store.get("compassUnit", "m");        // the rangefinder's unit: "m" or "yd"

  const is3d = () => !!(window.trailMap3d && map.getContainer().classList.contains("is3d"));
  const gl = () => window.trailMap3d;
  // The compass direction at the top of the screen right now.
  const topHeading = () => (is3d() ? deg360(gl().getBearing()) : deg360(map.getBearing ? -map.getBearing() : 0));
  const here = () => S.you || (() => { const c = is3d() ? gl().getCenter() : map.getCenter(); return { lat: c.lat, lon: c.lng, centre: true }; })();
  const decl = () => { const p = here(); return declination(p.lat, p.lon); };
  // The true heading the line follows.
  function heading() {
    if (S.locked != null) return S.locked;
    if (S.sensor && !S.manual) return deg360(Math.atan2(S.sensor.y, S.sensor.x) / rad + decl());
    return topHeading();
  }

  // ---------- the phone's compass ----------
  function onOrient(e) {
    let h = null;
    if (e.webkitCompassHeading != null && e.webkitCompassHeading >= 0) {   // iPhone: already corrected for tilt
      h = e.webkitCompassHeading; S.acc = e.webkitCompassAccuracy;
    } else if ((e.absolute || e.type === "deviceorientationabsolute") && e.alpha != null) {
      // Android: the way the top of the phone points, flat, plus the way the back points, held up. Tilted in between,
      // both point the same way, so their sum works at every angle.
      const a = e.alpha * rad, b = (e.beta || 0) * rad, g = (e.gamma || 0) * rad;
      const east = -Math.sin(a) * Math.cos(b) + (-Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g));
      const nth = Math.cos(a) * Math.cos(b) + (-Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g));
      if (Math.hypot(east, nth) < 0.2) return;
      h = Math.atan2(east, nth) / rad;
    }
    if (h == null || isNaN(h)) return;
    h = deg360(h + ((screen.orientation && screen.orientation.angle) || window.orientation || 0));
    const v = { x: Math.cos(h * rad), y: Math.sin(h * rad) };
    if (!S.sensor || Date.now() - S.sensorAt > 1000) S.sensor = v;
    else { S.sensor.x += (v.x - S.sensor.x) * 0.3; S.sensor.y += (v.y - S.sensor.y) * 0.3; }
    S.sensorAt = Date.now();
    S.denied = false;
    if (S.manual) { S.manual = false; S.free = false; }
    soon();
  }
  function startSensor() {
    const D = window.DeviceOrientationEvent;
    const listen = () => { window.addEventListener("deviceorientationabsolute", onOrient); window.addEventListener("deviceorientation", onOrient); };
    if (!D) return;
    listen();
    // iPhone: has to be asked from the tap itself (the app allows it without asking). Until it's allowed nothing comes.
    if (typeof D.requestPermission === "function") D.requestPermission().then((s) => { if (s === "denied" && !S.sensor) { S.denied = true; render(); } }, () => {});
    // Nothing from the compass after a moment: turn the map by hand instead.
    setTimeout(() => { if (S.on && !S.sensor) { S.manual = true; render(); } }, 2000);
  }
  function stopSensor() {
    window.removeEventListener("deviceorientationabsolute", onOrient); window.removeEventListener("deviceorientation", onOrient);
    S.sensor = null; S.acc = null; S.manual = false; S.denied = false;
  }

  // ---------- the GPS ----------
  function startGps() {
    if (!navigator.geolocation) return;
    const fix = (p) => { if (!S.on) return; S.you = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }; tellHunt(); soon(true); };
    const opts = { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 };
    // Where the blue dot is (index.html) until a fix comes, then a first fix right away; the watch keeps it moving.
    const dot = window.tfNav && window.tfNav.youLayer && window.tfNav.youLayer.getLayers().find((l) => l instanceof L.CircleMarker);
    if (dot) { const d = dot.getLatLng(); S.you = { lat: d.lat, lon: d.lng, acc: null }; tellHunt(); }
    navigator.geolocation.getCurrentPosition(fix, () => render(), opts);
    S.watch = navigator.geolocation.watchPosition(fix, () => render(), opts);
  }
  // Hunting's spot, scent cone and range rings go with you, as when the map follows you (hunting.js listens).
  const tellHunt = () => window.dispatchEvent(new CustomEvent("tf:you", { detail: { lat: S.you.lat, lon: S.you.lon, follow: true, compass: true } }));
  // The blue dot's fixes (index.html) too: a browser may hold back a second watch's fixes until you move.
  window.addEventListener("tf:you", (e) => { if (S.on && S.watch != null && !e.detail.compass) { S.you = { lat: e.detail.lat, lon: e.detail.lon, acc: null }; soon(true); } });
  function stopGps() { if (S.watch != null) navigator.geolocation.clearWatch(S.watch); S.watch = null; S.you = null; }

  // ---------- the screen ----------
  const css = document.createElement("style");
  css.textContent = `
.map-tools #compassBtn { display: inline-flex; align-items: center; gap: 5px; }
body:not(.sport-hunt) .map-tools #compassBtn { display: none; }
.map-tools #compassBtn.on { background: ${ORANGE}; border-color: ${ORANGE}; color: #fff; }
.cp-card[hidden], .cp-card [hidden] { display: none !important; }
.cp-card { position: absolute; z-index: 660; top: 12px; left: 56px; right: 116px; margin-inline: auto; max-width: 440px; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px;
  padding: 8px 10px; border-radius: 14px; background: var(--panel); color: var(--fg); box-shadow: 0 4px 16px #0005; font-size: .84rem; text-align: center; }
@media (max-width: 760px) { .cp-card { top: 64px; left: 10px; right: 10px; max-width: none; } body.cp-on .rotate-ctl { display: none; } }
.cp-head { font: inherit; display: flex; align-items: baseline; justify-content: center; gap: 8px; border: 0; background: none; color: inherit; cursor: pointer; padding: 0; }
.cp-head b { font-size: 1.9rem; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.cp-head span { font-size: 1.15rem; font-weight: 800; color: ${ORANGE}; min-width: 1.6em; text-align: left; }
.cp-head small { font-size: .7rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.cp-msg { margin: 0; font-size: .8rem; color: var(--muted); }
.cp-msg.warn { color: #c92a2a; font-weight: 600; }
.cp-go { display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; color: ${BLUE}; }
.cp-go button { font: inherit; font-size: .74rem; border: 1px solid var(--line); border-radius: 999px; background: var(--chip); color: var(--muted); padding: 2px 8px; cursor: pointer; }
.cp-btns { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
.cp-btns button, .cp-range button { font: inherit; font-size: .8rem; font-weight: 700; padding: 7px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
.cp-btns button[aria-pressed="true"] { background: ${ORANGE}; border-color: ${ORANGE}; color: #fff; }
.cp-btns button[data-c="range"][aria-pressed="true"], .cp-range .go { background: ${RED}; border-color: ${RED}; color: #fff; }
.cp-range { display: flex; gap: 6px; align-items: center; justify-content: center; flex-wrap: wrap; }
.cp-range input { font: inherit; font-size: 1rem; font-weight: 800; width: 5.2em; padding: 5px 6px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); text-align: center; }
.cp-range small { flex-basis: 100%; color: var(--muted); font-size: .72rem; }
body.cp-on .hn-meas { display: none !important; }
body.cp-ranging #map, body.cp-ranging #map3d canvas { cursor: ns-resize !important; touch-action: none; }
body.cp-ranging { user-select: none; -webkit-user-select: none; }
.cp-you { width: 46px; height: 46px; margin: -23px 0 0 -23px; position: relative; pointer-events: none; }
.cp-you svg { display: block; }
.cp-tick { transform: translate(9px, -50%); font: 800 11px/1 var(--font-body, system-ui); color: #212529; background: #fffd; border-radius: 5px; padding: 2px 4px; white-space: nowrap; width: max-content; box-shadow: 0 1px 2px #0003; pointer-events: none; }
.cp-tgt { width: 34px; height: 34px; margin: -17px 0 0 -17px; pointer-events: none; }
.cp-tgt-lab { transform: translate(22px, -50%); font: 800 12px/1 var(--font-body, system-ui); color: #fff; background: ${RED}; border-radius: 6px; padding: 3px 6px; white-space: nowrap; width: max-content; pointer-events: none; }
.cp-goal-lab { transform: translate(14px, -50%); font: 800 12px/1 var(--font-body, system-ui); color: #fff; background: ${BLUE}; border-radius: 6px; padding: 3px 6px; white-space: nowrap; width: max-content; pointer-events: none; }`;
  document.head.append(css);

  const COMPASS_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>';
  const btn = document.createElement("button");
  btn.id = "compassBtn"; btn.type = "button"; btn.setAttribute("aria-pressed", "false");
  btn.title = "Compass mode: the map turns with your phone, with a sight line, distances and a rangefinder";
  btn.innerHTML = `${COMPASS_SVG} Compass`;
  const locBtn = $("locate");
  if (locBtn) locBtn.after(btn); else document.querySelector(".map-tools")?.append(btn);
  btn.addEventListener("click", () => (S.on ? stop() : start()));

  const card = document.createElement("div");
  card.className = "cp-card"; card.hidden = true; card.setAttribute("role", "region"); card.setAttribute("aria-label", "Compass");
  card.innerHTML = `
    <button type="button" class="cp-head" id="cpHead" title="Tap to switch between true north and magnetic north"><b id="cpDeg">--°</b><span id="cpDir"></span><small id="cpNorth"></small></button>
    <p class="cp-msg" id="cpMsg" role="status"></p>
    <div class="cp-go" id="cpGo" hidden><span id="cpGoTxt"></span><button type="button" data-c="nogo" aria-label="Clear the target">✕</button></div>
    <div class="cp-btns">
      <button type="button" data-c="lock" aria-pressed="false" title="Hold this heading: the map stops turning">🔒 Lock</button>
      <button type="button" data-c="range" aria-pressed="false" title="Rangefinder: a target on the sight line, at the distance you set">◎ Range</button>
      <button type="button" data-c="centre" hidden title="Put the map back on you">➤ Recenter</button>
      <button type="button" data-c="exit">✕ Exit</button>
    </div>
    <div class="cp-range" id="cpRange" hidden>
      <button type="button" data-r="-" aria-label="Closer">−</button>
      <input id="cpDist" type="number" inputmode="numeric" min="1" max="9999" step="1" aria-label="Distance to the target">
      <button type="button" data-r="unit" title="Metres or yards, as your rangefinder shows" id="cpUnit"></button>
      <button type="button" data-r="+" aria-label="Farther">+</button>
      <button type="button" class="go" data-r="pin">📍 Drop pin</button>
      <small>Drag up or down on the map to move the target, or type what your rangefinder says.</small>
    </div>`;
  L.DomEvent.disableClickPropagation(card); L.DomEvent.disableScrollPropagation(card);
  map.getContainer().append(card);

  $("cpHead").addEventListener("click", () => { north = north === "true" ? "mag" : "true"; store.set("compassNorth", north); render(); });
  card.addEventListener("click", (e) => {
    const c = e.target.closest("[data-c]"), r = e.target.closest("[data-r]");
    if (c) {
      const k = c.dataset.c;
      if (k === "exit") stop();
      else if (k === "lock") { S.locked = S.locked == null ? heading() : null; draw(true); }
      else if (k === "range") { S.range = S.range == null ? store.get("compassRange", 200) : null; draw(); }
      else if (k === "centre") { S.free = false; draw(true); }
      else if (k === "nogo") { S.target = null; draw(); }
    } else if (r) {
      const k = r.dataset.r;
      if (k === "unit") { unit = unit === "m" ? "yd" : "m"; store.set("compassUnit", unit); render(); }
      else if (k === "pin") dropPin();
      else setRange(S.range + (k === "+" ? 1 : -1) * stepOf(S.range));
    }
  });
  const stepOf = (m) => (m < 100 ? 5 : m < 500 ? 10 : m < 2000 ? 50 : 100) * (unit === "yd" ? YD : 1);
  function setRange(m) {
    S.range = Math.max(5, Math.min(5000, m));
    store.set("compassRange", Math.round(S.range));
    draw();
  }
  $("cpDist").addEventListener("change", (e) => { const v = parseFloat(e.target.value); if (v > 0) setRange(v * (unit === "yd" ? YD : 1)); });
  $("cpDist").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });

  // ---------- on and off ----------
  function start() {
    if (S.on || !isHunt()) return;
    S.on = true; S.free = false; S.locked = null;
    document.body.classList.add("cp-on");
    btn.classList.add("on"); btn.setAttribute("aria-pressed", "true");
    card.hidden = false;
    startSensor(); startGps();
    keepAwake();
    if (matchMedia("(max-width: 760px)").matches) setTimeout(() => { const b = document.querySelector('#tabbar [data-nav="map"]'); if (b) b.click(); });
    if (map.getZoom() < 14 && !is3d()) map.setZoom(15, { animate: false });
    draw(true);
  }
  function stop() {
    if (!S.on) return;
    S.on = false; S.range = null; S.target = null; S.locked = null;
    document.body.classList.remove("cp-on", "cp-ranging");
    btn.classList.remove("on"); btn.setAttribute("aria-pressed", "false");
    card.hidden = true;
    stopSensor(); stopGps();
    try { S.wake && S.wake.release(); } catch {}
    S.wake = null;
    clear2d(); clear3d();
    // Back to north up, as the map was.
    if (is3d()) gl().easeTo({ bearing: 0, duration: 400 });
    else if (map.setBearing) { map.setBearing(0); map.fire("rotateend"); }
  }
  async function keepAwake() { try { if (S.on && "wakeLock" in navigator && !S.wake) { S.wake = await navigator.wakeLock.request("screen"); S.wake.addEventListener("release", () => { S.wake = null; }); } } catch {} }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepAwake(); });
  window.addEventListener("tf:sport", () => { if (!isHunt()) stop(); });

  // ---------- drawing ----------
  let timer = 0, lastTurnAt = 0, lastMoveAt = 0;
  // Called on every compass reading: the text at once (cheap), the map at most 8 times a second in 2D (turning the flat
  // map redraws it), 16 in 3D.
  let raf = 0;
  function soon(moved) {
    if (!S.on) return;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); });
    if (moved) { draw(true); return; }
    if (timer) return;
    const gap = is3d() ? 60 : 120, wait = Math.max(0, gap - (Date.now() - lastTurnAt));
    timer = setTimeout(() => { timer = 0; draw(true); }, wait);
  }

  function render() {
    if (!S.on) return;
    const h = heading(), dec = decl(), shown = north === "mag" ? deg360(h - dec) : h;
    $("cpDeg").textContent = `${Math.round(shown) % 360}°`;
    $("cpDir").textContent = dirOf(shown);
    $("cpNorth").textContent = `${north === "mag" ? "magnetic" : "true"} north${S.locked != null ? " · locked" : ""}`;
    let msg = "", warn = false;
    if (S.denied && navigator.maxTouchPoints > 0) { msg = "The compass was refused. Reload the page, tap Compass and choose Allow (or turn the map by hand)."; warn = true; }
    else if (S.manual) msg = "No compass on this device: turn the map (two fingers, or right-drag) and the line turns with it.";
    else if (!S.sensor) msg = "Starting the compass…";
    else if (S.acc != null && (S.acc < 0 || S.acc > 25)) { msg = `Compass is rough (±${S.acc < 0 ? "?" : Math.round(S.acc)}°): move the phone in a figure 8, away from metal and magnets.`; warn = true; }
    else if (!S.you) msg = navigator.geolocation ? "Finding you… (the line starts at the middle of the map until then)" : "No location on this device: the line starts at the middle of the map.";
    else msg = `Hold the phone flat, top pointing where you look. ${north === "mag" ? `True north is ${Math.abs(Math.round(dec))}° ${dec >= 0 ? "east" : "west"} of magnetic here.` : ""}`.trim();
    $("cpMsg").textContent = msg; $("cpMsg").classList.toggle("warn", warn);
    const lock = card.querySelector('[data-c="lock"]');
    lock.setAttribute("aria-pressed", String(S.locked != null)); lock.textContent = S.locked != null ? "🔓 Unlock" : "🔒 Lock";
    card.querySelector('[data-c="range"]').setAttribute("aria-pressed", String(S.range != null));
    card.querySelector('[data-c="centre"]').hidden = !S.free;
    $("cpRange").hidden = S.range == null;
    if (S.range != null) {
      const v = Math.round(S.range / (unit === "yd" ? YD : 1));
      if (document.activeElement !== $("cpDist")) $("cpDist").value = v;
      $("cpUnit").textContent = unit;
    }
    document.body.classList.toggle("cp-ranging", S.range != null);
    // Go to: how far, which way, and how much to turn from where you face.
    const tg = S.target || (window.tfPoints && window.tfPoints.guiding && window.tfPoints.guiding());
    $("cpGo").hidden = !tg;
    if (tg) {
      const p = here(), d = dist(p, tg), b = bearingTo(p, tg), t = turn(b, h), bs = north === "mag" ? deg360(b - dec) : b;
      $("cpGoTxt").textContent = d < 15 ? `You're at ${tg.name}` : `${tg.name}: ${fmtM(d)}, ${Math.round(bs) % 360}° ${dirOf(bs)} · ${Math.abs(t) < 8 ? "straight ahead" : `turn ${Math.round(Math.abs(t))}° ${t < 0 ? "left" : "right"}`}`;
      card.querySelector('[data-c="nogo"]').hidden = !S.target;
    }
  }

  // Turns and moves the map, then draws the lines.
  function draw(move) {
    if (!S.on) return;
    lastTurnAt = Date.now();
    const h = heading(), p = here();
    if (move && !S.free) {
      const spin = !S.manual && (S.sensor || S.locked != null);   // with no compass, the map is turned by hand
      // You a fifth of the map below the middle, so there's more map ahead of you than behind. With no GPS yet the line
      // starts at the middle of the map, and the map only turns.
      if (is3d()) {
        const g = gl(), c = g.getContainer(), cam = { bearing: spin ? h : g.getBearing(), duration: 0 };
        if (!p.centre) { cam.center = [p.lon, p.lat]; cam.offset = [0, c.clientHeight * 0.2]; }
        g.easeTo(cam);
      } else {
        if (spin && map.setBearing && Math.abs(turn(-h, map.getBearing())) > 0.5) map.setBearing(-h);
        const mpp = metresPerPx(), c = ahead(p, topHeading(), map.getSize().y * 0.2 * mpp);
        if (!p.centre && map.getCenter().distanceTo([c.lat, c.lon]) > mpp * 2) map.setView([c.lat, c.lon], map.getZoom(), { animate: false });
      }
    }
    if (is3d()) { clear2d(); draw3d(h, p); } else { clear3d(); draw2d(h, p); }
    render();
  }
  const metresPerPx = () => (40075016.7 * Math.cos(map.getCenter().lat * rad)) / (256 * 2 ** map.getZoom());
  const metresPerPx3d = () => { const g = gl(); return (40075016.7 * Math.cos(g.getCenter().lat * rad)) / (512 * 2 ** g.getZoom()); };
  // Distance marks: a round step 70 px or more apart on screen.
  function tickStep(mpp) {
    for (const s of [10, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000]) if (s / mpp >= 70) return s;
    return 10000;
  }
  // The lines, as [points, colour, width, dashed] and the labels, the same for both maps.
  function shapes(h, p, mpp, len) {
    const L1 = [], labels = [], step = tickStep(mpp);
    const end = ahead(p, h, len);
    L1.push({ pts: [p, end], c: ORANGE, w: 3.5 });
    for (let d = step; d < len; d += step) {
      const t = ahead(p, h, d), half = (d % (step * 2) === 0 ? 9 : 6) * mpp;
      L1.push({ pts: [ahead(t, h - 90, half), ahead(t, h + 90, half)], c: ORANGE, w: 2.5 });
      labels.push({ at: t, text: fmtM(d), cls: "cp-tick" });
    }
    let tgt = null;
    if (S.range != null) {
      tgt = ahead(p, h, S.range);
      L1.push({ pts: [p, tgt], c: RED, w: 5 });
      const yd = Math.round(S.range / YD);
      labels.push({ at: tgt, text: unit === "yd" ? `${yd} yd (${Math.round(S.range)} m)` : `${Math.round(S.range)} m (${yd} yd)`, cls: "cp-tgt-lab" });
    }
    const goal = S.target || (window.tfPoints && window.tfPoints.guiding && window.tfPoints.guiding());
    if (goal) {
      L1.push({ pts: [p, goal], c: BLUE, w: 3, dash: true });
      labels.push({ at: goal, text: fmtM(dist(p, goal)), cls: "cp-goal-lab" });
    }
    return { lines: L1, labels, tgt, goal };
  }
  const YOU_SVG = `<svg viewBox="0 0 46 46" width="46" height="46" aria-hidden="true"><path d="M23 2 33 22H13z" fill="${ORANGE}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><circle cx="23" cy="23" r="8" fill="${BLUE}" stroke="#fff" stroke-width="3"/></svg>`;
  const TGT_SVG = `<svg viewBox="0 0 34 34" width="34" height="34" aria-hidden="true"><circle cx="17" cy="17" r="12" fill="none" stroke="#fff" stroke-width="5"/><circle cx="17" cy="17" r="12" fill="none" stroke="${RED}" stroke-width="3"/><path d="M17 1v9M17 24v9M1 17h9M24 17h9" stroke="${RED}" stroke-width="3" stroke-linecap="round"/><circle cx="17" cy="17" r="2.5" fill="${RED}"/></svg>`;

  // 2D: lines in Hunting's "hunt" pane (they turn with the map), the marks and labels upright over them.
  const layer2 = L.layerGroup();
  map.createPane("cpTop").style.zIndex = 645;   // you and the target, over Hunting's spot ring
  map.getPane("cpTop").style.pointerEvents = "none";
  function clear2d() { layer2.clearLayers(); if (map.hasLayer(layer2)) map.removeLayer(layer2); }
  function draw2d(h, p) {
    layer2.clearLayers();
    if (!map.hasLayer(layer2)) layer2.addTo(map);
    const mpp = metresPerPx(), size = map.getSize(), len = Math.hypot(size.x, size.y) * mpp;
    const pane = map.getPane("hunt") ? "hunt" : "overlayPane";
    const { lines, labels, tgt, goal } = shapes(h, p, mpp, len);
    for (const l of lines) {
      const ll = l.pts.map((q) => [q.lat, q.lon]);
      L.polyline(ll, { pane, interactive: false, color: "#fff", weight: l.w + 3, opacity: 0.85, lineCap: "butt" }).addTo(layer2);
      L.polyline(ll, { pane, interactive: false, color: l.c, weight: l.w, dashArray: l.dash ? "8 7" : null, lineCap: "butt" }).addTo(layer2);
    }
    for (const t of labels) L.marker([t.at.lat, t.at.lon], { interactive: false, keyboard: false, zIndexOffset: 900, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="${t.cls}">${t.text}</div>` }) }).addTo(layer2);
    if (goal) L.circleMarker([goal.lat, goal.lon], { pane, radius: 7, color: "#fff", weight: 3, fillColor: BLUE, fillOpacity: 1, interactive: false }).addTo(layer2);
    if (tgt) L.marker([tgt.lat, tgt.lon], { pane: "cpTop", interactive: false, keyboard: false, zIndexOffset: 950, icon: L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="cp-tgt">${TGT_SVG}</div>` }) }).addTo(layer2);
    // You: the dot with an arrow the way the phone points (it turns with the map when the map isn't facing that way).
    const live = S.locked != null && S.sensor && !S.manual ? deg360(Math.atan2(S.sensor.y, S.sensor.x) / rad + decl()) : h;
    L.marker([p.lat, p.lon], { pane: "cpTop", interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: "", iconSize: [0, 0],
      html: `<div class="cp-you" style="transform:rotate(${Math.round(turn(live, topHeading()))}deg)">${YOU_SVG}</div>` }) }).addTo(layer2);
  }

  // 3D: one GeoJSON source for the lines and labels, and markers for you and the target.
  let you3 = null, tgt3 = null;
  function clear3d() {
    const g = gl();
    if (g && g.getSource && g.getSource("cp")) g.getSource("cp").setData({ type: "FeatureCollection", features: [] });
    if (you3) you3.remove(); if (tgt3) tgt3.remove();
  }
  function draw3d(h, p) {
    const g = gl();
    if (!g || !window.maplibregl || !g.getStyle || !g.getStyle()) return;
    const c = g.getContainer(), mpp = metresPerPx3d(), len = Math.min(15000, Math.hypot(c.clientWidth, c.clientHeight) * mpp * 2.5);
    const { lines, labels, tgt } = shapes(h, p, mpp, len);
    const feats = lines.map((l) => ({ type: "Feature", properties: { c: l.c, w: l.w, d: l.dash ? 1 : 0 }, geometry: { type: "LineString", coordinates: l.pts.map((q) => [q.lon, q.lat]) } }))
      .concat(labels.map((t) => ({ type: "Feature", properties: { t: t.text, k: t.cls }, geometry: { type: "Point", coordinates: [t.at.lon, t.at.lat] } })));
    const data = { type: "FeatureCollection", features: feats };
    if (!g.getSource("cp")) {
      g.addSource("cp", { type: "geojson", data });
      const line = ["==", ["geometry-type"], "LineString"];
      g.addLayer({ id: "cp-case", type: "line", source: "cp", filter: line, paint: { "line-color": "#fff", "line-width": ["+", ["get", "w"], 3], "line-opacity": 0.85 } });
      g.addLayer({ id: "cp-line", type: "line", source: "cp", filter: ["all", line, ["==", ["get", "d"], 0]], paint: { "line-color": ["get", "c"], "line-width": ["get", "w"] } });
      g.addLayer({ id: "cp-dash", type: "line", source: "cp", filter: ["all", line, ["==", ["get", "d"], 1]], paint: { "line-color": ["get", "c"], "line-width": ["get", "w"], "line-dasharray": [2, 2] } });
      for (const tick of [true, false]) {   // distance marks give way to each other; the target's and goal's labels always show
        g.addLayer({ id: tick ? "cp-tick" : "cp-lab", type: "symbol", source: "cp", filter: ["all", ["==", ["geometry-type"], "Point"], [tick ? "==" : "!=", ["get", "k"], "cp-tick"]],
          layout: { "text-field": ["get", "t"], "text-font": ["Noto Sans Bold"], "text-size": tick ? 12 : 14, "text-anchor": "left", "text-offset": [tick ? 0.9 : 1.6, 0], "text-allow-overlap": !tick, "text-ignore-placement": !tick, "text-padding": tick ? 10 : 2 },
          paint: { "text-color": ["match", ["get", "k"], "cp-tgt-lab", RED, "cp-goal-lab", BLUE, "#212529"], "text-halo-color": "#fff", "text-halo-width": 2 } });
      }
    } else g.getSource("cp").setData(data);
    if (!you3) { const el = document.createElement("div"); el.innerHTML = YOU_SVG; el.style.pointerEvents = "none"; you3 = new maplibregl.Marker({ element: el, rotationAlignment: "map", pitchAlignment: "map" }); }
    const live = S.locked != null && S.sensor && !S.manual ? deg360(Math.atan2(S.sensor.y, S.sensor.x) / rad + decl()) : h;
    you3.setLngLat([p.lon, p.lat]).setRotation(live).addTo(g);
    if (tgt) {
      if (!tgt3) { const el = document.createElement("div"); el.innerHTML = TGT_SVG; el.style.pointerEvents = "none"; tgt3 = new maplibregl.Marker({ element: el }); }
      tgt3.setLngLat([tgt.lon, tgt.lat]).addTo(g);
    } else if (tgt3) tgt3.remove();
  }

  // ---------- the person moving the maps ----------
  map.on("dragstart", () => { if (S.on && !S.free) { S.free = true; render(); } });
  map.on("rotate", () => { if (S.on && S.manual) soon(); });
  map.on("zoomend", () => { if (S.on && !is3d()) draw(true); });
  map.on("moveend", () => { if (S.on && !is3d() && S.free) draw(); });
  window.addEventListener("tf:map3d", (e) => {
    const g = e.detail;
    g.on("dragstart", (ev) => { if (S.on && ev.originalEvent && !S.free) { S.free = true; render(); } });
    g.on("rotate", (ev) => { if (S.on && S.manual && ev.originalEvent) soon(); });
    g.on("zoomend", (ev) => { if (S.on && ev.originalEvent) draw(true); });
    g.on("moveend", (ev) => { if (S.on && ev.originalEvent && S.free) draw(); });
    g.on("style.load", () => { if (S.on && is3d()) draw(); });
    g.on("click", (ev) => { if (S.on && is3d() && S.range == null) setTarget(ev.lngLat.lat, ev.lngLat.lng); });
  });
  // The 2D or 3D button: draw on the other map.
  const b3 = $("btn3d");
  if (b3) b3.addEventListener("click", () => setTimeout(() => S.on && draw(true), 400));

  // Go to: a tap on the map.
  map.on("click", (e) => { if (S.on && !is3d() && S.range == null) setTarget(e.latlng.lat, e.latlng.lng); });
  function setTarget(lat, lon) { S.target = { lat, lon, name: "Target" }; draw(); }

  // Rangefinder: drag up or down anywhere on the map to push the target out or bring it in.
  let drag = null;
  const mapEl = map.getContainer();
  mapEl.addEventListener("pointerdown", (e) => {
    if (!S.on || S.range == null || card.contains(e.target) || e.target.closest(".leaflet-control, .map-tools")) return;
    if (drag) { endDrag(); return; }   // a second finger: a pinch, not a drag
    drag = { y: e.clientY, from: S.range, id: e.pointerId };
    if (map.dragging) map.dragging.disable();
    const g = gl(); if (g && g.dragPan) g.dragPan.disable();
  }, true);
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag = null;
    if (map.dragging) map.dragging.enable();
    const g = gl(); if (g && g.dragPan) g.dragPan.enable();
  }
  window.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    setRange(drag.from * Math.exp((drag.y - e.clientY) * 0.006));   // up: farther. 115 px doubles it
  }, { passive: false });
  window.addEventListener("pointerup", endDrag); window.addEventListener("pointercancel", endDrag);

  // Drop pin: a saved point (ski-points.js) at the target, named with how far and which way; it becomes the target to go to.
  function dropPin() {
    if (S.range == null) return;
    const h = heading(), t = ahead(here(), h, S.range), P = window.tfPoints, dec = decl();
    const shown = north === "mag" ? deg360(h - dec) : h;
    const m = Math.round(S.range), from = here(), name = `Ranged ${m} m, ${Math.round(shown) % 360}° ${dirOf(shown)}`;
    S.target = { lat: t.lat, lon: t.lon, name: "Pin" };
    S.range = null;
    draw();
    if (P && P.addAt) P.addAt(t.lat, t.lon, { name, kind: "sighting", note: `${m} m (${Math.round(m / YD)} yd) at ${Math.round(h) % 360}° true from ${from.lat.toFixed(5)}, ${from.lon.toFixed(5)}.` });
  }

  window.tfCompass = { start, stop, on: () => S.on, state: () => S };
})();
