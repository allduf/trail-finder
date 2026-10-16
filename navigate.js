// Ride mode: the main map follows you while you ride, with an arrow for the way you're facing, the screen kept on,
// the ride recorded, and a strip at the bottom saying which trail you're on, how much of it is left, and which
// trails branch off at the next junction (alex, 2026-10-16: "what does my app miss to be a great navigation app").
// The ride is recorded into the same IndexedDB store as ride.html ("trail-finder-rides", "current"), so Stop and
// save hands it to ride.html#save for the title, photos and My rides.
// Needs window.tfNav from index.html: { map, ways(), load(), difficulty(tags), DIFF, diffColor(d), youLayer }.
(() => {
  "use strict";
  const nav = window.tfNav;
  if (!nav) return;
  const map = nav.map;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Same rules as ride.html, so a ride recorded here gives the same numbers there.
  const MAX_ACC_M = 30, MIN_STEP_M = 5, MAX_SPEED_MS = 33;
  const ON_TRAIL_M = 25;      // within this of a trail line counts as on it (GPS under trees is often 10-20 m out)
  const STAY_M = 40;          // keep the trail you're on until you're this far from it, so a side trail doesn't steal it
  const AHEAD_M = 2000;       // look this far ahead for the next junction
  const RIDE_ZOOM = 16;

  // ---------- storage: the ride being recorded, shared with ride.html ----------
  const dbP = new Promise((resolve, reject) => {
    const r = indexedDB.open("trail-finder-rides", 1);
    r.onupgradeneeded = () => {                 // first ride on this device: make ride.html's stores
      const db = r.result;
      db.createObjectStore("rides", { keyPath: "id" });
      db.createObjectStore("photos", { keyPath: "id" }).createIndex("rideId", "rideId");
      db.createObjectStore("current", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const done = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const store = async (mode) => (await dbP).transaction("current", mode).objectStore("current");
  const getCurrent = async () => { try { return await done((await store("readonly")).get("current")); } catch { return null; } };
  const putCurrent = async (v) => { try { await done((await store("readwrite")).put(v)); } catch {} };
  const delCurrent = async () => { try { await done((await store("readwrite")).delete("current")); } catch {} };

  // ---------- geometry: metres on a flat patch around the rider (fine over a few km) ----------
  const R = 6371008.8, RAD = Math.PI / 180;
  function metres(a, b) {
    const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearing(a, b) {
    const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD);
    const x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }
  // Nearest point of a line to p: { d metres, i segment index, t 0-1 along it, along metres from the line's start }.
  function project(geom, p) {
    const kx = Math.cos(p[0] * RAD) * R * RAD, ky = R * RAD;
    let best = { d: Infinity, i: 0, t: 0, along: 0 }, run = 0;
    for (let i = 0; i < geom.length - 1; i++) {
      const ax = (geom[i][1] - p[1]) * kx, ay = (geom[i][0] - p[0]) * ky;
      const bx = (geom[i + 1][1] - p[1]) * kx, by = (geom[i + 1][0] - p[0]) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, len = Math.sqrt(len2);
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best.d) best = { d, i, t, along: run + t * len };
      run += len;
    }
    return best;
  }
  function lengthOf(w) {
    if (w._len == null) { let s = 0; for (let i = 1; i < w.geom.length; i++) s += metres(w.geom[i - 1], w.geom[i]); w._len = s; }
    return w._len;
  }
  function boxOf(w) {
    if (!w._bb) {
      let s = 90, n = -90, west = 180, e = -180;
      w.geom.forEach(([la, lo]) => { if (la < s) s = la; if (la > n) n = la; if (lo < west) west = lo; if (lo > e) e = lo; });
      w._bb = [s, west, n, e];
    }
    return w._bb;
  }
  const key = (p) => p[0].toFixed(5) + "," + p[1].toFixed(5);
  // One-way for bikes: 1 along the line, -1 against it, 0 both ways. oneway:bicycle wins over oneway.
  function onewayOf(tags) {
    const v = tags["oneway:bicycle"] != null ? tags["oneway:bicycle"] : tags["oneway:mtb"] != null ? tags["oneway:mtb"] : tags.oneway;
    return v === "yes" || v === "1" || v === "true" ? 1 : v === "-1" || v === "reverse" ? -1 : 0;
  }
  const nameOf = (w) => (w.tags.name || w.tags["mtb:name"] || "").trim();

  // ---------- the trails around you, with their shared points (junctions) ----------
  // Rebuilt when you've moved 1 km from where it was built, or more trail files have loaded.
  const near = { at: null, n: -1, ways: [], nodes: new Map() };
  function nearby(p) {
    const all = nav.ways();
    if (near.at && metres(near.at, p) < 1000 && all.length === near.n) return near;
    const dLat = 3000 / 111000, dLon = dLat / Math.cos(p[0] * RAD), seen = new Set();
    near.ways = all.filter((w) => {
      if (seen.has(w.id)) return false;
      const b = boxOf(w);
      if (b[0] > p[0] + dLat || b[2] < p[0] - dLat || b[1] > p[1] + dLon || b[3] < p[1] - dLon) return false;
      seen.add(w.id); return true;
    });
    near.nodes = new Map();
    near.ways.forEach((w) => w.geom.forEach((q, i) => {
      const k = key(q);
      if (!near.nodes.has(k)) near.nodes.set(k, []);
      near.nodes.get(k).push({ w, i });
    }));
    near.at = p; near.n = all.length;
    return near;
  }

  // ---------- which trail you're on, which way you're going, and what's ahead ----------
  const ride = { on: null, along: null, dir: 0, last: null };   // on: the way; dir: +1 toward its end, -1 toward its start
  function findTrail(p, acc) {
    const n = nearby(p), reach = Math.max(ON_TRAIL_M, Math.min(acc || 0, 50));
    let best = null;
    n.ways.forEach((w) => {
      const b = boxOf(w), pad = 60 / 111000;
      if (p[0] < b[0] - pad || p[0] > b[2] + pad || p[1] < b[1] - pad / Math.cos(p[0] * RAD) || p[1] > b[3] + pad / Math.cos(p[0] * RAD)) return;
      const pr = project(w.geom, p);
      if (!best || pr.d < best.pr.d) best = { w, pr };
    });
    // Stick with the trail you're on while you're still close to it.
    if (ride.on && n.ways.includes(ride.on)) {
      const pr = project(ride.on.geom, p);
      if (pr.d <= STAY_M && (!best || pr.d <= best.pr.d + 10)) best = { w: ride.on, pr };
    }
    return best && best.pr.d <= (best.w === ride.on ? STAY_M : reach) ? best : { nearest: best };
  }
  // The point of the line at a distance along it.
  function pointAt(w, along) {
    let run = 0;
    for (let i = 1; i < w.geom.length; i++) {
      const s = metres(w.geom[i - 1], w.geom[i]);
      if (run + s >= along) { const t = s ? (along - run) / s : 0; return [w.geom[i - 1][0] + t * (w.geom[i][0] - w.geom[i - 1][0]), w.geom[i - 1][1] + t * (w.geom[i][1] - w.geom[i - 1][1])]; }
      run += s;
    }
    return w.geom[w.geom.length - 1];
  }
  // Walk ahead from where you are: along this way, then on through same-name pieces that carry on from its end.
  // Returns the metres left on the trail and the first junction ahead, with the trails that branch off there.
  function lookAhead(w, along, dir) {
    const name = nameOf(w);
    let left = 0, junction = null, cur = w, pos = along, d = dir, hops = 0, prevPt = pointAt(w, along);
    const visited = new Set([w.id]);
    while (cur && hops < 20) {
      const g = cur.geom, idx = [];
      // the vertices ahead of pos, in riding order
      let run = 0; const at = [0];
      for (let i = 1; i < g.length; i++) { run += metres(g[i - 1], g[i]); at.push(run); }
      if (d > 0) { for (let i = 0; i < g.length; i++) if (at[i] > pos - 5) idx.push(i); }      // from just behind you: a junction you're at
      else { for (let i = g.length - 1; i >= 0; i--) if (at[i] < pos + 5) idx.push(i); }
      for (const i of idx) {
        const gone = left + Math.max(0, d > 0 ? at[i] - pos : pos - at[i]);
        if (!junction && gone <= AHEAD_M) {
          const others = (near.nodes.get(key(g[i])) || []).filter((o) => o.w !== cur);
          const branches = [];
          others.forEach((o) => {
            [-1, 1].forEach((s) => {                  // a way through the junction branches both ways; one ending there, one way
              const j = o.i + s;
              if (j < 0 || j >= o.w.geom.length) return;
              branches.push({ w: o.w, b: bearing(g[i], o.w.geom[j]) });
            });
          });
          const prev = d > 0 ? g[i - 1] : g[i + 1], inB = bearing(prev || prevPt, g[i]);
          const offs = branches.filter((x) => !(name && nameOf(x.w) === name)).map((x) => {
            const turn = ((x.b - inB + 540) % 360) - 180;       // -180..180, negative = left
            return { name: nameOf(x.w) || "unnamed trail", w: x.w, side: Math.abs(turn) < 30 ? "straight" : Math.abs(turn) > 150 ? "back" : turn < 0 ? "left" : "right" };
          });
          if (offs.length) {
            const uniq = new Map();
            offs.forEach((o) => { const k = o.side + "|" + o.name; if (!uniq.has(k)) uniq.set(k, o); });
            junction = { m: gone, at: g[i], offs: [...uniq.values()] };
          }
        }
        prevPt = g[i];
      }
      left += d > 0 ? lengthOf(cur) - pos : pos;
      // carry on into a same-name piece that starts or ends where this one ends
      const endPt = d > 0 ? g[g.length - 1] : g[0];
      if (!name) break;
      const next = (near.nodes.get(key(endPt)) || []).find((o) => !visited.has(o.w.id) && nameOf(o.w) === name && (o.i === 0 || o.i === o.w.geom.length - 1));
      if (!next) break;
      cur = next.w; visited.add(cur.id); hops++;
      d = next.i === 0 ? 1 : -1;
      pos = d > 0 ? 0 : lengthOf(cur);
    }
    return { left, junction };
  }

  // ---------- map pieces ----------
  const layer = L.layerGroup();
  const track = L.polyline([], { color: "#d1245f", weight: 5, opacity: 0.9, interactive: false });
  const onGlow = L.polyline([], { color: "#ffe14d", weight: 11, opacity: 0.55, lineCap: "round", interactive: false });
  const jDot = L.circleMarker([0, 0], { radius: 7, color: "#fff", weight: 3, fillColor: "#ff9f1c", fillOpacity: 1, interactive: false });
  const youIcon = (deg) => L.divIcon({ className: "nav-you", iconSize: [44, 44], iconAnchor: [22, 22],
    html: `<svg viewBox="0 0 44 44" width="44" height="44" aria-hidden="true">${deg == null ? "" : `<g transform="rotate(${Math.round(deg)} 22 22)"><path d="M22 2 31 18 22 14 13 18z" fill="#2b7de9" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></g>`}<circle cx="22" cy="22" r="8" fill="#2b7de9" stroke="#fff" stroke-width="3"/></svg>` });
  let you = null, youDeg = undefined;

  // ---------- the strip and its styles ----------
  const css = document.createElement("style");
  css.textContent = `
.app.riding { grid-template-columns: 1fr !important; grid-template-rows: 1fr !important; }
.app.riding .panel, .app.riding .tabbar, .app.riding .map-actions, .app.riding #locate, .app.riding #fullBtn, .app.riding #navRideBtn, .app.riding .first-tip { display: none !important; }
.app.riding .mapwrap { grid-column: 1; grid-row: 1; }
.nav-strip { position: fixed; z-index: 1200; left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom, 0px)); max-width: 560px; margin: 0 auto; background: var(--panel, #fff); color: var(--fg, #14211a); border-radius: 18px; box-shadow: 0 6px 24px rgba(0,0,0,.28); padding: 12px 14px; font-size: 1rem; }
.nav-strip[hidden] { display: none; }
.nav-row { display: flex; align-items: center; gap: 10px; }
.nav-bar { width: 6px; align-self: stretch; border-radius: 3px; background: #8a8f98; flex: none; }
.nav-main { flex: 1; min-width: 0; }
.nav-name { font-weight: 800; font-size: 1.2rem; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-sub { color: var(--muted, #5b6660); font-size: .92rem; }
.nav-stats { text-align: right; font-variant-numeric: tabular-nums; flex: none; }
.nav-stats b { display: block; font-size: 1.1rem; }
.nav-next { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line, #e3e6e0); font-size: .95rem; }
.nav-next[hidden] { display: none; }
.nav-next .dist { font-weight: 800; color: #c25e00; }
.nav-btns { display: flex; gap: 8px; margin-top: 10px; }
.nav-btns button { flex: 1; font: inherit; font-weight: 700; padding: 11px 10px; border-radius: 12px; border: 1px solid var(--line, #d6dad3); background: var(--bg, #f4f5f0); color: inherit; cursor: pointer; }
.nav-btns .stop { background: #d6202a; border-color: #d6202a; color: #fff; }
.nav-btns .go { background: var(--cta, #c6f05a); border-color: transparent; color: var(--cta-fg, #10230f); }
.nav-btns [hidden] { display: none; }
.nav-gps { position: fixed; z-index: 1200; top: calc(10px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); background: #fff3cd; color: #5c4400; border-radius: 999px; padding: 6px 12px; font-size: .85rem; box-shadow: 0 2px 8px rgba(0,0,0,.18); max-width: calc(100vw - 24px); }
.nav-gps[hidden] { display: none; }
.nav-you, .oneway-arrow { background: none; border: 0; }
.nav-route { margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, #7b2ff7 12%, transparent); font-size: .95rem; }
.nav-route[hidden] { display: none; }
.nav-route.off { background: #d6202a; color: #fff; font-weight: 700; }
.nav-route .x { float: right; font: inherit; font-size: .85rem; border: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; padding: 0 0 0 8px; }
#navRideBtn { font-weight: 700; }
@media (max-width: 760px) { #navRideBtn { display: none; } }
body.sport-ski #navRideBtn { display: none; }
`;
  document.head.appendChild(css);
  const strip = document.createElement("div");
  strip.className = "nav-strip"; strip.hidden = true; strip.setAttribute("role", "region"); strip.setAttribute("aria-label", "Ride");
  strip.innerHTML = `<div class="nav-row"><span class="nav-bar" id="navBar"></span><div class="nav-main"><div class="nav-name" id="navName">Finding you…</div><div class="nav-sub" id="navSub">Waiting for GPS</div></div>
    <div class="nav-stats"><b id="navTime">0:00:00</b><span id="navDist">0.00 km</span></div></div>
    <div class="nav-next" id="navNext" hidden></div>
    <div class="nav-route" id="navRoute" hidden></div>
    <div class="nav-btns" id="navBtns"><button type="button" id="navFollow" hidden>◎ Follow me</button><button type="button" class="stop" id="navStop">■ Stop</button></div>
    <div class="nav-btns" id="navAsk" hidden><button type="button" class="go" id="navSave">Save ride</button><button type="button" id="navKeep">Keep riding</button><button type="button" id="navDrop">Don't save</button></div>`;
  document.body.appendChild(strip);
  const gpsMsg = document.createElement("div");
  gpsMsg.className = "nav-gps"; gpsMsg.hidden = true; gpsMsg.setAttribute("role", "status");
  document.body.appendChild(gpsMsg);

  // ---------- riding ----------
  let rec = null, watchId = null, wakeLock = null, ticker = 0, lastSave = 0, following = true, lastFix = null;
  const pad2 = (n) => String(n).padStart(2, "0");
  const hms = (s) => { s = Math.floor(s); return `${Math.floor(s / 3600)}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`; };
  const fmtM = (m) => (m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km");
  function distOf(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += metres(pts[i - 1], pts[i]); return s; }

  async function keepAwake() {
    try { if (rec && "wakeLock" in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch {}
  }
  function letSleep() { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; }

  // Compass for the arrow when you're standing still (moving, the GPS heading is better).
  let compass = null;
  function onOrient(e) {
    const h = e.webkitCompassHeading != null ? e.webkitCompassHeading : e.absolute && e.alpha != null ? 360 - e.alpha : null;
    if (h != null) { compass = (h + (screen.orientation ? screen.orientation.angle || 0 : 0)) % 360; drawYou(); }
  }
  function startCompass() {
    const D = window.DeviceOrientationEvent;
    if (!D) return;
    const on = () => { window.addEventListener("deviceorientationabsolute", onOrient); window.addEventListener("deviceorientation", onOrient); };
    if (typeof D.requestPermission === "function") D.requestPermission().then((s) => { if (s === "granted") on(); }, () => {});   // iPhone: must be asked from the tap
    else on();
  }
  function stopCompass() { window.removeEventListener("deviceorientationabsolute", onOrient); window.removeEventListener("deviceorientation", onOrient); compass = null; }

  function drawYou() {
    if (!lastFix) return;
    const c = lastFix.c, ll = [c.latitude, c.longitude];
    const deg = c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 1 ? c.heading : compass;
    if (!you) { you = L.marker(ll, { icon: youIcon(deg), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(layer); youDeg = deg; }
    else {
      you.setLatLng(ll);
      if (deg == null ? youDeg != null : youDeg == null || Math.abs(deg - youDeg) > 4) { you.setIcon(youIcon(deg)); youDeg = deg; }
    }
  }

  function onFix(pos) {
    const c = pos.coords, t = pos.timestamp || Date.now(), p = [c.latitude, c.longitude];
    lastFix = { c, t };
    drawYou();
    if (following) map.setView(p, Math.max(map.getZoom(), RIDE_ZOOM), { animate: false });
    if (c.accuracy > MAX_ACC_M) { gpsMsg.textContent = `Weak GPS (±${Math.round(c.accuracy)} m). Waiting for a better fix…`; gpsMsg.hidden = false; }
    else gpsMsg.hidden = true;
    nav.load();
    updateTrail(p, c.accuracy);
    updateRoute(p);
    if (!rec || c.accuracy > MAX_ACC_M) return;
    const q = [+c.latitude.toFixed(6), +c.longitude.toFixed(6), c.altitude == null ? null : +c.altitude.toFixed(1), t, Math.round(c.accuracy)];
    const last = rec.points[rec.points.length - 1];
    if (last) {
      const d = metres(last, q), dt = (t - last[3]) / 1000;
      if (d < MIN_STEP_M) return;
      if (dt > 0 && dt < 10 && d / dt > MAX_SPEED_MS) return;
    }
    rec.points.push(q);
    track.addLatLng([q[0], q[1]]);
    rec.dist = (rec.dist || 0) + (last ? metres(last, q) : 0);
    if (Date.now() - lastSave > 5000) { lastSave = Date.now(); putCurrent(rec); }
  }
  function onGpsError(err) {
    if (err.code === 1) { gpsMsg.textContent = "Location is blocked for this site. Allow location in your browser settings to ride with the map."; gpsMsg.hidden = false; }
    else { gpsMsg.textContent = "Looking for GPS… Being outside with a view of the sky helps."; gpsMsg.hidden = false; }
  }

  function updateTrail(p, acc) {
    const found = findTrail(p, acc);
    if (!found.w) {
      ride.on = null; onGlow.setLatLngs([]); layer.removeLayer(jDot);
      $("navBar").style.background = "#8a8f98";
      $("navName").textContent = "Not on a mapped trail";
      const n = found.nearest;
      $("navSub").textContent = n ? `Nearest: ${nameOf(n.w) || "an unnamed trail"}, ${fmtM(n.pr.d)} away` : nav.ways().length ? "No mapped trails nearby" : "Loading trails…";
      $("navNext").hidden = true;
      return;
    }
    const { w, pr } = found;
    if (ride.on !== w) { ride.on = w; ride.along = null; ride.dir = 0; onGlow.setLatLngs(w.geom); }
    // Which way you're riding: from how your spot along the trail moves (at least 8 m), else your heading.
    if (ride.along != null && Math.abs(pr.along - ride.along) >= 8) { ride.dir = pr.along > ride.along ? 1 : -1; ride.along = pr.along; }
    else if (ride.along == null) ride.along = pr.along;
    if (!ride.dir && lastFix && lastFix.c.heading != null && !isNaN(lastFix.c.heading) && (lastFix.c.speed || 0) > 1) {
      const g = w.geom, b = bearing(g[pr.i], g[pr.i + 1]), diff = Math.abs(((lastFix.c.heading - b + 540) % 360) - 180);
      ride.dir = diff < 90 ? 1 : -1;
    }
    const d = nav.difficulty(w.tags), lvl = d ? nav.DIFF[d] : null;
    $("navBar").style.background = nav.diffColor(d);
    $("navName").textContent = nameOf(w) || "Unnamed trail";
    if (!ride.dir) {
      $("navSub").textContent = `${lvl ? lvl.sym + " " + lvl.label : "Not rated"} · ${fmtM(lengthOf(w))} long`;
      $("navNext").hidden = true; layer.removeLayer(jDot);
      return;
    }
    const ahead = lookAhead(w, pr.along, ride.dir);
    const wrong = onewayOf(w.tags) && onewayOf(w.tags) !== ride.dir;
    $("navSub").textContent = `${lvl ? lvl.sym + " " + lvl.label : "Not rated"} · ${fmtM(ahead.left)} to the end`;
    if (wrong) {
      $("navSub").innerHTML = `<b style="color:#d6202a">⚠ One-way trail: you're going the wrong way</b>`;
      if (ride.warned !== w.id) { ride.warned = w.id; alarm(); }
    }
    const j = ahead.junction;
    if (!j) { $("navNext").hidden = true; layer.removeLayer(jDot); return; }
    const ARROW = { left: "←", right: "→", straight: "↑", back: "↩" };
    $("navNext").innerHTML = (j.m < 15 ? `<span class="dist">Junction here</span>: ` : `Next junction in <span class="dist">${fmtM(j.m)}</span>: `) +
      j.offs.slice(0, 4).map((o) => `${ARROW[o.side]} ${esc(o.name)}`).join(" · ") + (j.offs.length > 4 ? ` · +${j.offs.length - 4} more` : "");
    $("navNext").hidden = false;
    jDot.setLatLng(j.at).addTo(layer);
  }

  // ---------- following a trail or a planned loop ----------
  // route: { name, lines, pts: every point with its length share, done: Set of points passed, total, on: been on it yet,
  // offSince: when you first went off it, alerted }. Points count as ridden when you pass within 30 m of them.
  const OFF_M = 40, OFF_MS = 15000, PASS_M = 30;
  let route = null;
  const routeCase = L.polyline([], { color: "#fff", weight: 12, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false });
  const routeLine = L.polyline([], { color: "#7b2ff7", weight: 7, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false });
  function setRoute(lines, name) {
    const pts = [];
    lines.forEach((g) => g.forEach((q, i) => pts.push({ q, m: i ? metres(g[i - 1], q) : 0 })));
    route = { name, lines, pts, done: new Set(), total: pts.reduce((a, x) => a + x.m, 0), on: false, offSince: 0, alerted: false };
    routeCase.setLatLngs(lines); routeLine.setLatLngs(lines);
    [routeCase, routeLine].forEach((l) => l.addTo(layer));
  }
  function clearRoute() {
    route = null; routeCase.setLatLngs([]); routeLine.setLatLngs([]);
    $("navRoute").hidden = true;
  }
  let audio = null;
  function alarm() {
    try { navigator.vibrate && navigator.vibrate([400, 150, 400, 150, 400]); } catch {}
    try {                                          // two short beeps, for phones that can't vibrate (iPhone)
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.3].forEach((t) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = 880; g.gain.value = 0.25;
        o.connect(g); g.connect(audio.destination);
        o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.18);
      });
    } catch {}
  }
  function updateRoute(p) {
    if (!route) return;
    let best = { d: Infinity }, near = null;
    route.lines.forEach((g) => { const pr = project(g, p); if (pr.d < best.d) best = pr, near = g; });
    route.pts.forEach((x, i) => { if (!route.done.has(i) && metres(x.q, p) <= PASS_M) route.done.add(i); });
    const ridden = [...route.done].reduce((a, i) => a + route.pts[i].m, 0);
    const left = Math.max(0, route.total - ridden), box = $("navRoute"), now = Date.now();
    const x = '<button type="button" class="x" id="navUnfollow">Stop following</button>';
    if (best.d <= OFF_M) {
      if (!route.on && !following) { following = true; $("navFollow").hidden = true; map.setView(p, Math.max(map.getZoom(), RIDE_ZOOM)); }   // reached it: follow you again
      route.on = true; route.offSince = 0; route.alerted = false;
      box.classList.remove("off");
      box.innerHTML = `${x}Following <b>${esc(route.name)}</b> · ${fmtM(left)} left of ${fmtM(route.total)}`;
    } else if (!route.on) {
      // Not there yet: how far to the nearest point of it, and which way.
      const at = near ? pointOnLine(near, best) : null, dirs = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
      box.classList.remove("off");
      box.innerHTML = `${x}<b>${esc(route.name)}</b> is ${fmtM(best.d)} away${at ? `, to the ${dirs[Math.round(bearing(p, at) / 45) % 8]}` : ""}`;
    } else {
      if (!route.offSince) route.offSince = now;
      if (now - route.offSince >= OFF_MS && !route.alerted) { route.alerted = true; alarm(); }
      box.classList.toggle("off", route.alerted);
      box.innerHTML = `${x}${route.alerted ? "Off route" : "Leaving the route?"}: ${fmtM(best.d)} from <b>${esc(route.name)}</b>`;
    }
    box.hidden = false;
    $("navUnfollow").addEventListener("click", clearRoute);
  }
  function pointOnLine(g, pr) {
    const a = g[pr.i], b = g[Math.min(pr.i + 1, g.length - 1)];
    return [a[0] + pr.t * (b[0] - a[0]), a[1] + pr.t * (b[1] - a[1])];
  }
  async function follow(lines, name) {
    if (!lines || !lines.length) return;
    if (!rec) { await start(); if (!rec) return; }
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}   // from the tap, so iPhones allow the beep later
    setRoute(lines, name || "this trail");
    const here = lastFix && [lastFix.c.latitude, lastFix.c.longitude];
    if (!here || Math.min(...lines.map((g) => project(g, here).d)) > 300) {   // far from it: show the whole trail and you
      const b = L.latLngBounds(lines.flat());
      if (here) b.extend(here);
      following = false; $("navFollow").hidden = false;
      map.fitBounds(b, { padding: [40, 40], maxZoom: RIDE_ZOOM });
    }
    if (lastFix) updateRoute([lastFix.c.latitude, lastFix.c.longitude]);
    else { $("navRoute").hidden = false; $("navRoute").innerHTML = `Following <b>${esc(route.name)}</b> · waiting for GPS`; }
  }

  function tick() {
    if (!rec) return;
    $("navTime").textContent = hms((Date.now() - rec.start) / 1000);
    $("navDist").textContent = ((rec.dist || 0) / 1000).toFixed(2) + " km";
  }

  const appEl = () => document.querySelector(".app");
  function setRiding(on) {
    const before = $("map").getBoundingClientRect();
    appEl().classList.toggle("riding", on);
    strip.hidden = !on;
    map.invalidateSize({ pan: false });
    const after = $("map").getBoundingClientRect();
    map.panBy([after.left - before.left, after.top - before.top], { animate: false });
  }

  async function start() {
    if (rec) return;
    if (!navigator.geolocation) { alert("This browser can't share your location, so Ride mode can't follow you."); return; }
    startCompass();                               // first, while the tap still counts (iPhone asks here)
    const cur = await getCurrent();
    const lastT = cur && (cur.points.length ? cur.points[cur.points.length - 1][3] : cur.start);
    if (cur && !cur.end && Date.now() - lastT > 30 * 60000) cur.end = lastT;   // left running long ago: that ride is over
    if (cur && cur.end) {
      if (confirm("You have an earlier ride that isn't saved. Open it to save it now?\n\nCancel starts a new ride and drops the old one.")) { await putCurrent(cur); location.href = "ride.html#save"; return; }
      await delCurrent();
    }
    rec = cur && !cur.end ? cur : { id: "current", start: Date.now(), points: [] };
    rec.dist = distOf(rec.points);
    track.setLatLngs(rec.points.map((q) => [q[0], q[1]]));
    [track, onGlow].forEach((l) => l.addTo(layer));
    layer.addTo(map);
    if (nav.youLayer) map.removeLayer(nav.youLayer);   // the plain blue dot: Ride mode has its own arrow
    following = true; $("navFollow").hidden = true;
    $("navBtns").hidden = false; $("navAsk").hidden = true;
    setRiding(true);
    if (map.getZoom() < RIDE_ZOOM) map.setZoom(RIDE_ZOOM);
    watchId = navigator.geolocation.watchPosition(onFix, onGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    keepAwake();
    ticker = setInterval(tick, 1000); tick();
    putCurrent(rec);
  }
  function stopWatching() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null; clearInterval(ticker); ticker = 0; letSleep(); stopCompass();
  }
  function leave() {
    stopWatching();
    clearRoute();
    rec = null; lastFix = null; ride.on = null;
    layer.clearLayers(); map.removeLayer(layer); you = null;
    track.setLatLngs([]); onGlow.setLatLngs([]);
    gpsMsg.hidden = true;
    if (nav.youLayer) nav.youLayer.addTo(map);
    setRiding(false);
  }
  map.on("dragstart", () => { if (rec) { following = false; $("navFollow").hidden = false; } });
  $("navFollow").addEventListener("click", () => {
    following = true; $("navFollow").hidden = true;
    if (lastFix) map.setView([lastFix.c.latitude, lastFix.c.longitude], Math.max(map.getZoom(), RIDE_ZOOM));
  });
  $("navStop").addEventListener("click", () => { $("navBtns").hidden = true; $("navAsk").hidden = false; });
  $("navKeep").addEventListener("click", () => { $("navBtns").hidden = false; $("navAsk").hidden = true; });
  $("navDrop").addEventListener("click", async () => {
    if (rec && rec.points.length > 1 && !confirm("Drop this ride? It won't be saved.")) return;
    await delCurrent(); leave();
  });
  $("navSave").addEventListener("click", async () => {
    if (!rec) return;
    if (rec.points.length < 2) { alert("Nothing recorded yet: the GPS hasn't had a good fix. Keep riding or choose Don't save."); return; }
    stopWatching();
    rec.end = Date.now();
    await putCurrent(rec);
    location.href = "ride.html#save";            // title, description, photos, My rides
  });
  document.addEventListener("visibilitychange", () => {
    if (!rec) return;
    if (document.visibilityState === "hidden") putCurrent(rec);
    else keepAwake();
  });
  window.addEventListener("pagehide", () => { if (rec) putCurrent(rec); });

  // ---------- one-way arrows on the trails, from zoom 14 ----------
  map.createPane("onewayArrows").style.zIndex = 396;
  map.getPane("onewayArrows").style.pointerEvents = "none";
  const arrows = L.layerGroup().addTo(map);
  const ARROW_ZOOM = 14, ARROW_EVERY_PX = 140, MAX_ARROWS = 400;
  let arrowTimer = 0, arrowN = -1, arrowView = "";
  function drawArrows() {
    const z = map.getZoom(), view = map.getBounds(), all = nav.ways();
    const k = z + "|" + view.toBBoxString() + "|" + all.length;
    if (k === arrowView) return;
    arrowView = k; arrowN = all.length;
    arrows.clearLayers();
    if (z < ARROW_ZOOM || document.body.classList.contains("sport-ski")) return;
    const shown = nav.shown ? new Set(nav.shown()) : null;   // only on trails drawn on the map now
    const seen = new Set(), pad = view.pad(0.1);
    let n = 0;
    for (const w of all) {
      if (n >= MAX_ARROWS) break;
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      const dir = onewayOf(w.tags);
      if (!dir || (shown && !shown.has(w.id))) continue;
      const b = boxOf(w);
      if (!pad.intersects([[b[0], b[1]], [b[2], b[3]]])) continue;
      const color = nav.diffColor(nav.difficulty(w.tags));
      let run = ARROW_EVERY_PX / 2;
      const px = w.geom.map((q) => map.latLngToLayerPoint(q));
      for (let i = 1; i < px.length && n < MAX_ARROWS; i++) {
        const seg = px[i].distanceTo(px[i - 1]);
        while (run <= seg && n < MAX_ARROWS) {
          const t = run / seg, at = map.layerPointToLatLng(L.point(px[i - 1].x + t * (px[i].x - px[i - 1].x), px[i - 1].y + t * (px[i].y - px[i - 1].y)));
          if (pad.contains(at)) {
            const deg = Math.atan2(px[i].y - px[i - 1].y, px[i].x - px[i - 1].x) * 180 / Math.PI + (dir > 0 ? 0 : 180);
            arrows.addLayer(L.marker(at, { pane: "onewayArrows", interactive: false, keyboard: false, icon: L.divIcon({ className: "oneway-arrow", iconSize: [22, 22], iconAnchor: [11, 11],
              html: `<svg viewBox="0 0 22 22" width="22" height="22" style="transform: rotate(${Math.round(deg)}deg)" aria-hidden="true"><path d="M4 3.5 19 11 4 18.5 8.5 11z" fill="${color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>` }) }));
            n++;
          }
          run += ARROW_EVERY_PX;
        }
        run -= seg;
      }
    }
  }
  const queueArrows = () => { clearTimeout(arrowTimer); arrowTimer = setTimeout(drawArrows, 120); };
  map.on("moveend zoomend", queueArrows);
  setInterval(() => { if (nav.ways().length !== arrowN) queueArrows(); }, 3000);   // trail files still loading
  queueArrows();

  const rideBtn = $("navRideBtn");
  if (rideBtn) rideBtn.addEventListener("click", start);
  window.tfRide = { start, follow, riding: () => !!rec };
})();
