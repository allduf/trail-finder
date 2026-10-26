// Ride mode: the main map follows you while you ride, with an arrow for the way you're facing, the screen kept on,
// the ride recorded, and a strip at the bottom saying which trail you're on, how much of it is left, and which
// trails branch off at the next junction (alex, 2026-10-16: "what does my app miss to be a great navigation app").
// The ride is recorded into the same IndexedDB store as ride.html ("trail-finder-rides", "current"), so Stop and
// save hands it to ride.html#save for the title, photos and My rides.
// Needs window.tfNav from index.html: { map, ways(), load(), difficulty(tags), DIFF, diffColor(d), youLayer }.
(() => {
  "use strict";
  const nav = window.tfNav, STATS = window.tfRideStats;   // STATS: ride-stats.js, the numbers shared with ride.html
  if (!nav || !STATS) return;
  const map = nav.map;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Same rules as ride.html, so a ride recorded here gives the same numbers there.
  const MAX_ACC_M = 30, MIN_STEP_M = 5, MAX_SPEED_MS = 33;
  const ON_TRAIL_M = 25;      // within this of a trail line counts as on it (GPS under trees is often 10-20 m out)
  const STAY_M = 40;          // keep the trail you're on until you're this far from it, so a side trail doesn't steal it
  const AHEAD_M = 2000;       // look this far ahead for the next junction
  const RIDE_ZOOM = 16;
  // The GPS that records: the iPhone app's own (keeps going with the phone locked) or the browser's (native-gps.js).
  const GPS = window.tfGps || { native: false, watch(onFix, onError) {
    const id = navigator.geolocation.watchPosition(onFix, onError, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    return { native: false, stop: () => navigator.geolocation.clearWatch(id), catchUp: async () => {} };
  } };
  const IN_APP = GPS.native;
  const pocketHint = () => (IN_APP ? "" : " Tap 🔒 Pocket instead of locking the phone.");
  const RESUME_MS = 6 * 3600000;   // a ride whose last point is older than this is over: offer to save it, not to carry on

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
  // Writes wait for the whole transaction to be on disk: Safari drops one still in flight when the page moves on to
  // ride.html#save, which then found the ride unfinished and showed the Record screen instead of the save form.
  const commit = (os, req) => new Promise((res, rej) => { const t = os.transaction; req.onerror = () => rej(req.error); t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });
  const putCurrent = async (v) => { try { const os = await store("readwrite"); await commit(os, os.put(v)); } catch {} };
  const delCurrent = async () => { try { const os = await store("readwrite"); await commit(os, os.delete("current")); } catch {} };

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
.nav-nums { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin: 0 0 10px; text-align: center; font-variant-numeric: tabular-nums; }
.nav-nums b { display: block; font-size: 1.25rem; line-height: 1.1; white-space: nowrap; }
.nav-nums span { display: block; font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; color: var(--muted, #5b6660); white-space: nowrap; }
.nav-nums .paused b { color: #c25e00; }
.nav-tip { margin: 0 0 10px; padding: 7px 10px; border-radius: 10px; background: #e8f1ff; color: #123a6b; font-size: .9rem; }
.nav-tip[hidden] { display: none; }
.nav-tip button { font: inherit; font-weight: 700; border: 0; background: none; color: inherit; text-decoration: underline; padding: 0 0 0 6px; cursor: pointer; }
.nav-resume { position: fixed; z-index: 1200; left: 8px; right: 8px; bottom: calc(76px + env(safe-area-inset-bottom, 0px)); max-width: 560px; margin: 0 auto; background: var(--panel, #fff); color: var(--fg, #14211a); border-radius: 18px; box-shadow: 0 6px 24px rgba(0,0,0,.28); padding: 12px 14px; font-size: .98rem; }
.nav-resume[hidden] { display: none; }
.nav-pocket { position: fixed; inset: 0; z-index: 5000; background: #000; color: #8a8a8a; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px; text-align: center; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
.nav-pocket[hidden] { display: none; }
.nav-pocket .big { font-size: 2.4rem; font-weight: 800; color: #bdbdbd; font-variant-numeric: tabular-nums; }
.nav-pocket .unlock { position: relative; overflow: hidden; margin-top: 30px; border: 1px solid #444; border-radius: 999px; padding: 16px 28px; color: #bdbdbd; font-weight: 700; }
.nav-pocket .unlock i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: #2b7de9; opacity: .45; }
.nav-pocket .unlock.hold i { width: 100%; transition: width 1s linear; }
.nav-next { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line, #e3e6e0); font-size: .95rem; }
.nav-next[hidden] { display: none; }
.nav-next .dist { font-weight: 800; color: #c25e00; }
.nav-btns { display: flex; gap: 8px; margin-top: 10px; }
.nav-btns button { flex: 1; font: inherit; font-weight: 700; padding: 11px 6px; white-space: nowrap; border-radius: 12px; border: 1px solid var(--line, #d6dad3); background: var(--bg, #f4f5f0); color: inherit; cursor: pointer; }
.nav-btns .nav-voice { flex: 0 0 auto; padding: 11px 13px; }
.nav-btns .stop { background: #d6202a; border-color: #d6202a; color: #fff; }
.nav-btns .on { background: #ff9f1c; border-color: #ff9f1c; color: #1d1200; }
.nav-btns .nav-cta { background: var(--cta, #c6f05a); border-color: transparent; color: var(--cta-fg, #10230f); }
.nav-btns [hidden] { display: none; }
.nav-gps { position: fixed; z-index: 1200; top: calc(10px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); background: #fff3cd; color: #5c4400; border-radius: 999px; padding: 6px 12px; font-size: .85rem; box-shadow: 0 2px 8px rgba(0,0,0,.18); max-width: calc(100vw - 24px); }
.nav-gps[hidden] { display: none; }
.nav-strip .nav-gps { position: static; transform: none; max-width: none; margin: 0 0 10px; border-radius: 10px; box-shadow: none; padding: 7px 10px; }
.nav-you, .oneway-arrow { background: none; border: 0; }
.nav-route { margin-top: 8px; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, #7b2ff7 12%, transparent); font-size: .95rem; }
.nav-route[hidden] { display: none; }
.nav-route.off { background: #d6202a; color: #fff; font-weight: 700; }
.nav-parts { margin-top: 6px; }
.nav-parts[hidden] { display: none; }
.np-head { display: flex; width: 100%; gap: 8px; align-items: baseline; font: inherit; font-size: .9rem; text-align: left; border: 0; background: none; color: inherit; padding: 2px 2px 4px; cursor: pointer; }
.np-head .np-tog { margin-left: auto; color: var(--muted, #5b6660); white-space: nowrap; }
.np-list { list-style: none; margin: 0; padding: 0; max-height: 7.4em; overflow: auto; font-size: .92rem; position: relative; }
.np-list[hidden] { display: none; }
.np-list li { display: flex; align-items: center; gap: 7px; padding: 3px 4px; border-radius: 8px; cursor: pointer; line-height: 1.25; }
.np-list li i { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.np-n { width: 20px; flex: none; text-align: center; font-weight: 800; font-variant-numeric: tabular-nums; }
.np-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.np-name small { color: var(--muted, #5b6660); }
.np-m { flex: none; font-variant-numeric: tabular-nums; color: var(--muted, #5b6660); font-size: .85rem; }
.np-list li.done { opacity: .5; }
.np-list li.done .np-n { color: #2e8b3d; }
.np-list li.now { background: #7b2ff7; color: #fff; font-weight: 700; }
.np-list li.now .np-m, .np-list li.now small { color: #fff; }
.np-list li.next { background: color-mix(in srgb, #7b2ff7 14%, transparent); font-weight: 700; }
.route-num { box-sizing: border-box; border-radius: 50%; background: #fff; color: #7b2ff7; border: 2px solid #7b2ff7; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.route-num b { display: block; text-align: center; font: 800 11px/18px system-ui, sans-serif; }
.route-num.next { background: #7b2ff7; color: #fff; border-color: #fff; }
.nav-route .x { float: right; font: inherit; font-size: .85rem; border: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; padding: 0 0 0 8px; }
#navRideBtn { font-weight: 700; }
@media (max-width: 760px) { #navRideBtn { display: none; } }
body.sport-hunt #navRideBtn, body.sport-fish #navRideBtn { display: none; }
`;
  document.head.appendChild(css);
  const strip = document.createElement("div");
  strip.className = "nav-strip"; strip.hidden = true; strip.setAttribute("role", "region"); strip.setAttribute("aria-label", "Ride");
  strip.innerHTML = `<div class="nav-tip" id="navTip" hidden></div>
    <div class="nav-nums"><div id="navTimeBox"><b id="navTime">0:00</b><span id="navTimeK">Moving</span></div><div><b id="navDist">0.00</b><span>km</span></div><div><b id="navClimb">0</b><span>m climb</span></div><div><b id="navSpeed">0.0</b><span>km/h</span></div></div>
    <div class="nav-row"><span class="nav-bar" id="navBar"></span><div class="nav-main"><div class="nav-name" id="navName">Finding you…</div><div class="nav-sub" id="navSub">Waiting for GPS</div></div></div>
    <div class="nav-next" id="navNext" hidden></div>
    <div class="nav-route" id="navRoute" hidden></div>
    <div class="nav-parts" id="navParts" hidden><button type="button" class="np-head" id="navPartsHead"></button><ol class="np-list" id="navPartsList"></ol></div>
    <div class="nav-btns" id="navBtns"><button type="button" id="navFollow" hidden>◎ Follow</button><button type="button" id="navPause" title="Pause recording (stops counting time and distance)">Ⅱ Pause</button><button type="button" id="navPocket" title="Black screen that ignores touches, so the phone can go in your pocket without locking it (a locked phone stops the GPS)">🔒 Pocket</button><button type="button" class="nav-voice" id="navVoice" aria-label="Spoken directions" aria-pressed="true">🔊</button><button type="button" class="stop" id="navStop">■ Stop</button></div>
    <div class="nav-btns" id="navAsk" hidden><button type="button" class="nav-cta" id="navSave">Save ride</button><button type="button" id="navKeep">Keep riding</button><button type="button" id="navDrop">Don't save</button></div>`;
  document.body.appendChild(strip);
  const gpsMsg = document.createElement("div");
  gpsMsg.className = "nav-gps"; gpsMsg.hidden = true; gpsMsg.setAttribute("role", "status");
  strip.prepend(gpsMsg);   // at the top of the strip, so it never covers the map buttons

  // A ride left recording when the phone closed the page (it does that to pages in the background): offer to carry
  // on with it, or save it, as soon as the map opens again.
  const resumeBox = document.createElement("div");
  resumeBox.className = "nav-resume"; resumeBox.hidden = true; resumeBox.setAttribute("role", "region"); resumeBox.setAttribute("aria-label", "Unfinished ride");
  resumeBox.innerHTML = `<div id="navResumeText"></div><div class="nav-btns"><button type="button" class="nav-cta" id="navResumeGo">▶ Carry on</button><button type="button" id="navResumeSave">Save it</button><button type="button" id="navResumeDrop">Don't save</button></div>`;
  document.body.appendChild(resumeBox);

  // ---------- riding ----------
  let rec = null, gps = null, wakeLock = null, ticker = 0, lastSave = 0, following = true, lastFix = null;
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
    if (!you) { you = L.marker(ll, { icon: youIcon(deg), interactive: false, keyboard: false, zIndexOffset: 1000, rotateWithView: true }).addTo(layer); youDeg = deg; }
    else {
      you.setLatLng(ll);
      if (deg == null ? youDeg != null : youDeg == null || Math.abs(deg - youDeg) > 4) { you.setIcon(youIcon(deg)); youDeg = deg; }
    }
    faceTo(deg);
  }

  // ---------- which way the map faces: north up, or the way you're going (rotate.js) ----------
  // The compass button switches it while riding; the choice is kept for the next ride. Turning the map by hand
  // goes back to north up... until the button is tapped again.
  const canTurn = !!(map.setBearing && map.compass);
  let faceWay = false, lastFace = 0;
  try { faceWay = localStorage.getItem("tf:rideFace") === "1"; } catch {}
  const turnNorm = (d) => ((d % 360) + 540) % 360 - 180;
  function faceTo(deg) {
    if (!canTurn || !faceWay || !rec || deg == null || isNaN(deg)) return;
    const now = Date.now();
    if (Math.abs(turnNorm(-deg - map.getBearing())) < 3 || now - lastFace < 150) return;   // the compass sends many small changes
    lastFace = now;
    map.setBearing(-deg);
  }
  function syncCompass() {
    if (!canTurn) return;
    if (!rec) { map.compass.setMode(null, false); return; }
    map.compass.setMode(faceWay ? "Map faces the way you're going. Tap for north up" : "North up. Tap to turn the map the way you're going", faceWay);
  }
  function setFace(on, keep = true) {
    faceWay = on;
    if (keep) try { localStorage.setItem("tf:rideFace", on ? "1" : "0"); } catch {}
    syncCompass();
    if (!on) map.turnTo(0);
    else if (lastFix) { lastFace = 0; const c = lastFix.c; faceTo(c.heading != null && !isNaN(c.heading) && (c.speed || 0) > 1 ? c.heading : compass); map.fire("rotateend"); }
  }
  if (canTurn) {
    window.tfRotate.onCompass = () => { if (!rec) return false; setFace(!faceWay); return true; };
    map.on("rotatestart", (e) => { if (rec && faceWay && e.user) { faceWay = false; syncCompass(); } });
  }

  // The map centre that puts p in the middle of the map you can see above the ride strip (it covers the bottom half
  // of a phone), so the way ahead isn't hidden under it.
  function aboveStrip(p) {
    const box = map.getContainer().getBoundingClientRect(), top = strip.hidden ? box.bottom : strip.getBoundingClientRect().top;
    const visH = Math.max(box.height * 0.35, Math.min(box.height, top - box.top));
    const c = map.latLngToContainerPoint(p), want = L.point(box.width / 2, visH / 2);
    return map.containerPointToLatLng(L.point(box.width / 2, box.height / 2).add(c.subtract(want)));
  }
  function onFix(pos) {
    const c = pos.coords, t = pos.timestamp || Date.now(), p = [c.latitude, c.longitude];
    lastFix = { c, t };
    drawYou();
    const g = map.touchGestures || map.touchZoom || {}, busy = map._animatingZoom || g._zooming || g._rotating || L.Draggable._dragging;
    if (following && !busy) {                     // a short slide, not a jump, while the zoom stays put; never mid-pinch
      const z = Math.max(map.getZoom(), RIDE_ZOOM), glide = z === map.getZoom() && !document.hidden;
      map.setView(z === map.getZoom() ? aboveStrip(p) : p, z, glide ? { animate: true, pan: { duration: 0.6, easeLinearity: 1, noMoveStart: true } } : { animate: false });
    }
    if (c.accuracy > MAX_ACC_M) { gpsMsg.textContent = `Weak GPS (±${Math.round(c.accuracy)} m). Waiting for a better fix…`; gpsMsg.hidden = false; }
    else gpsMsg.hidden = true;
    nav.load();
    updateTrail(p, c.accuracy);
    updateRoute(p, c.accuracy);
    if (!rec || rec.paused || c.accuracy > MAX_ACC_M) return;
    const q = [+c.latitude.toFixed(6), +c.longitude.toFixed(6), c.altitude == null ? null : +c.altitude.toFixed(1), t, Math.round(c.accuracy)];
    const last = rec.points[rec.points.length - 1], fresh = (rec.breaks || []).includes(rec.points.length);
    if (last) {
      const d = metres(last, q), dt = (t - last[3]) / 1000;
      if (d < MIN_STEP_M) return;
      if (dt > 0 && dt < 10 && d / dt > MAX_SPEED_MS) return;
      if (!fresh && dt >= STATS.GAP_S && d > 30) fillGap(last, q, dt);   // the phone stopped the GPS (locked, page closed)
    }
    rec.points.push(q);
    rec.lastReal = t;
    if (fresh || !last) drawTrack(); else track.addLatLng([q[0], q[1]], lastRing());
    if (Date.now() - lastSave > 5000) { lastSave = Date.now(); putCurrent(rec); }
  }

  // ---------- the track: one line per piece between pauses ----------
  function pieces() {
    const out = [], brk = new Set(rec ? rec.breaks || [] : []);
    (rec ? rec.points : []).forEach((q, i) => { if (!out.length || brk.has(i)) out.push([]); out[out.length - 1].push([q[0], q[1]]); });
    return out;
  }
  function drawTrack() { const p = pieces(); track.setLatLngs(p.length ? p : []); }
  function lastRing() { const l = track.getLatLngs(); return Array.isArray(l[0]) ? l[l.length - 1] : l; }

  // ---------- gaps: the phone stopped the GPS, so draw the missing stretch along the trails if one fits ----------
  // The shortest way along the mapped trails from a to b, if it's believable: not much longer than the straight
  // line and not faster than riding pace for the time it took. Otherwise the gap stays a straight line.
  function trailPath(a, b, dt) {
    const straight = metres(a, b), pad = 0.01;
    const s = Math.min(a[0], b[0]) - pad, n = Math.max(a[0], b[0]) + pad, wd = pad / Math.cos(a[0] * RAD);
    const west = Math.min(a[1], b[1]) - wd, e = Math.max(a[1], b[1]) + wd;
    const G = new Map(), P = new Map(), seen = new Set();
    const link = (k1, k2, d) => { if (!G.has(k1)) G.set(k1, []); G.get(k1).push([k2, d]); };
    nav.ways().forEach((w) => {
      if (seen.has(w.id)) return;
      seen.add(w.id);
      const bb = boxOf(w);
      if (bb[0] > n || bb[2] < s || bb[1] > e || bb[3] < west) return;
      for (let i = 1; i < w.geom.length; i++) {
        const k1 = key(w.geom[i - 1]), k2 = key(w.geom[i]), d = metres(w.geom[i - 1], w.geom[i]);
        P.set(k1, w.geom[i - 1]); P.set(k2, w.geom[i]);
        link(k1, k2, d); link(k2, k1, d);
      }
    });
    const snapTo = (p) => { let best = null, bd = 80; P.forEach((q, k) => { const d = metres(p, q); if (d < bd) { bd = d; best = k; } }); return best; };
    const from = snapTo(a), to = snapTo(b);
    if (!from || !to) return null;
    // Dijkstra with a small binary heap
    const dist = new Map([[from, 0]]), prev = new Map(), heap = [[0, from]];
    const push = (x) => { heap.push(x); let i = heap.length - 1; while (i) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
    const pop = () => { const top = heap[0], end = heap.pop(); if (heap.length) { heap[0] = end; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
    const limit = Math.max(straight * 2.2, straight + 400);
    while (heap.length) {
      const [d, k] = pop();
      if (d > (dist.get(k) ?? Infinity)) continue;
      if (k === to || d > limit) break;
      (G.get(k) || []).forEach(([k2, w]) => { const nd = d + w; if (nd < (dist.get(k2) ?? Infinity)) { dist.set(k2, nd); prev.set(k2, k); push([nd, k2]); } });
    }
    const len = dist.get(to);
    if (len == null || len > limit || len / dt > 15) return null;
    const path = [];
    for (let k = to; k; k = prev.get(k)) path.unshift(P.get(k));
    return { path, len };
  }
  function fillGap(a, b, dt) {
    let got = null;
    try { if (!document.body.classList.contains("sport-ski")) got = trailPath(a, b, dt); } catch {}   // ski tours don't follow bike trails
    const min = Math.round(dt / 60), when = min >= 1 ? `${min} min` : `${Math.round(dt)} s`;
    if (got && got.path.length > 1) {
      // points along the trail at an even pace, between the two real fixes; heights unknown
      const all = [a, ...got.path, b];
      let run = 0;
      for (let i = 1; i < all.length - 1; i++) {
        run += metres(all[i - 1], all[i]);
        if (metres(rec.points[rec.points.length - 1], all[i]) < MIN_STEP_M) continue;
        const t = Math.round(a[3] + (b[3] - a[3]) * Math.min(1, run / (got.len + metres(all[all.length - 2], b) + metres(a, all[1]))));
        rec.points.push([+all[i][0].toFixed(6), +all[i][1].toFixed(6), null, t, 0, 1]);
      }
      showTip(`GPS stopped for ${when} (${IN_APP ? "no signal?" : "phone locked?"}). I filled in ${fmtM(got.len)} along the trails.${pocketHint()}`, 20000);
    } else showTip(`GPS stopped for ${when} (${IN_APP ? "no signal?" : "phone locked?"}), so that stretch is a straight line.${pocketHint()}`, 20000);
    rec.gaps = (rec.gaps || 0) + 1;
    drawTrack();
  }

  // ---------- tips in the strip ----------
  let tipTimer = 0;
  function showTip(html, ms, onOk) {
    const el = $("navTip");
    clearTimeout(tipTimer);
    el.innerHTML = html + (onOk ? '<button type="button">OK</button>' : "");
    el.hidden = false;
    if (onOk) el.querySelector("button").addEventListener("click", () => { el.hidden = true; onOk(); });
    if (ms) tipTimer = setTimeout(() => { el.hidden = true; }, ms);
  }
  function onGpsError(err) {
    if (err.code === 1) { gpsMsg.textContent = "Location is blocked for this site. Allow location in your browser settings to ride with the map."; gpsMsg.hidden = false; }
    else { gpsMsg.textContent = "Looking for GPS… Being outside with a view of the sky helps."; gpsMsg.hidden = false; }
  }

  // Skiing (winter.js): no bike trails to name. The strip says what you're doing, your height and the slope under
  // you, and warns on avalanche terrain (30° and steeper).
  let skiAt = null;
  function updateSki(p) {
    ride.on = null; onGlow.setLatLngs([]); layer.removeLayer(jDot); $("navNext").hidden = true;
    $("navName").textContent = route ? `Following ${route.name}` : "Recording your ski tour";
    if (skiAt && metres(skiAt, p) < 15) return;
    skiAt = p;
    const S = window.tfSki;
    if (!S) { $("navBar").style.background = "#1f5fe0"; return; }
    S.slopeAt(p[0], p[1]).then(({ slope, e }) => {
      if (!rec || skiAt !== p) return;
      const steep = slope >= 30;
      $("navBar").style.background = steep ? "#e8590c" : "#1f5fe0";
      $("navSub").innerHTML = `${Math.round(e).toLocaleString()} m high · slope here ${Math.round(slope)}°${steep ? ` · <b>avalanche terrain</b>` : ""}`;
    }).catch(() => { $("navSub").textContent = "Heights not available here"; });
  }
  function updateTrail(p, acc) {
    if (document.body.classList.contains("sport-ski")) { updateSki(p); return; }
    const found = findTrail(p, acc);
    if (!found.w) {
      ride.on = null; onGlow.setLatLngs([]); layer.removeLayer(jDot); voice.trail = "";
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
    const ahead = lookAhead(w, pr.along, ride.dir), free = !(route && route.parts), nm = nameOf(w);
    const wrong = onewayOf(w.tags) && onewayOf(w.tags) !== ride.dir;
    if (free && nm && nm !== voice.trail && !wrong) say(`${nm}${lvl ? ", " + lvl.label.toLowerCase() : ""}. ${sayM(ahead.left)} to the end.`, "t" + nm, NAME_AGAIN_MS);
    if (nm) voice.trail = nm;
    $("navSub").textContent = `${lvl ? lvl.sym + " " + lvl.label : "Not rated"} · ${fmtM(ahead.left)} to the end`;
    if (wrong) {
      $("navSub").innerHTML = `<b style="color:#d6202a">⚠ One-way trail: you're going the wrong way</b>`;
      if (ride.warned !== w.id) { ride.warned = w.id; alarm(); say(`Wrong way: ${nm || "this trail"} is one-way.`); }
    }
    const j = ahead.junction;
    if (!j) { $("navNext").hidden = true; layer.removeLayer(jDot); return; }
    const ARROW = { left: "←", right: "→", straight: "↑", back: "↩" };
    $("navNext").innerHTML = (j.m < 15 ? `<span class="dist">Junction here</span>: ` : `Next junction in <span class="dist">${fmtM(j.m)}</span>: `) +
      j.offs.slice(0, 4).map((o) => `${ARROW[o.side]} ${esc(o.name)}`).join(" · ") + (j.offs.length > 4 ? ` · +${j.offs.length - 4} more` : "");
    $("navNext").hidden = false;
    jDot.setLatLng(j.at).addTo(layer);
    if (free && j.m >= JUNC_MIN && j.m <= JUNC_MAX) junctionVoice(j);
  }

  // ---------- following a trail or a planned ride ----------
  // route: { name, lines, total, on: been on it yet, offSince: when you first went off it, alerted }.
  // Ride this trail (no parts): points count as ridden when you pass within 30 m of them (pts, done: Set of points passed).
  // A planned ride comes with its trails in order, parts: [{ name, color, lvl, kind, pts }]. Then the route is one line
  // (seq: [{ q, at metres along, n part }]) and you are route.pos metres along it: the first place past where you were
  // that you're on, so a ride that crosses or rides back over itself doesn't tick off the later pass. The map shows the
  // ridden part faded, the next stretch bold with arrows and numbered trail starts, the rest light; the strip lists the
  // trails in order (alex: "When i start a route I want to see where I'm going").
  const OFF_M = 40, OFF_MS = 15000, PASS_M = 30, BACK_M = 60, JUMP_M = 300, JUMP_FIXES = 3, NEXT_MIN_M = 600, NEXT_MAX_M = 2500;
  const ROUTE_ARROW_PX = 90, MAX_ROUTE_ARROWS = 60, MAX_NUMS = 25;
  let route = null;
  const routeCase = L.polyline([], { color: "#fff", weight: 12, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false });
  const routeLine = L.polyline([], { color: "#7b2ff7", weight: 7, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false });
  const routeDone = L.polyline([], { color: "#5b6068", weight: 4, opacity: 0.6, dashArray: "1 9", lineCap: "round", lineJoin: "round", interactive: false });
  const routeRest = L.polyline([], { color: "#7b2ff7", weight: 4, opacity: 0.35, lineCap: "round", lineJoin: "round", interactive: false });
  const routeMarks = L.layerGroup();
  function setRoute(lines, name, parts) {
    clearRoute();
    parts = (parts || []).filter((x) => x && x.pts && x.pts.length > 1);
    if (parts.length) {
      const seq = [];
      let at = 0;
      parts.forEach((x, n) => {
        x.from = at;
        x.pts.forEach((q, i) => {
          const last = seq[seq.length - 1];
          if (last && metres(last.q, q) < 0.5) return;
          if (last) at += metres(last.q, q);
          seq.push({ q, at, n });
        });
        x.to = at;
      });
      route = { name, lines, parts, seq, total: at, pos: 0, jump: null, on: false, offSince: 0, alerted: false, drawn: null, listN: -1 };
      [routeDone, routeRest, routeCase, routeLine, routeMarks].forEach((l) => l.addTo(layer));
      drawProgress();
      return;
    }
    const pts = [];
    lines.forEach((g) => g.forEach((q, i) => pts.push({ q, m: i ? metres(g[i - 1], q) : 0 })));
    route = { name, lines, pts, done: new Set(), total: pts.reduce((a, x) => a + x.m, 0), on: false, offSince: 0, alerted: false };
    routeCase.setLatLngs(lines); routeLine.setLatLngs(lines);
    [routeCase, routeLine].forEach((l) => l.addTo(layer));
  }
  function clearRoute() {
    route = null;
    [routeCase, routeLine, routeDone, routeRest].forEach((l) => { l.setLatLngs([]); layer.removeLayer(l); });
    routeMarks.clearLayers(); layer.removeLayer(routeMarks);
    $("navRoute").hidden = true; $("navParts").hidden = true;
    ["start", "end"].forEach((k) => voice.said.delete(k));
    sendCues();
  }

  // Where you are along a planned ride: the nearest point of it (near), and the first pass near you that's not behind
  // where you were (hit). Passes come in order along the line, so the first one wins over a later pass on the same spot.
  function locate(p) {
    const s = route.seq, kx = Math.cos(p[0] * RAD) * R * RAD, ky = R * RAD;
    let near = { d: Infinity }, hit = null, ended = false;
    for (let i = 0; i < s.length - 1; i++) {
      const a = s[i].q, b = s[i + 1].q;
      const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * ky, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy), along = s[i].at + t * (s[i + 1].at - s[i].at);
      if (d < near.d) near = { d, i, t, along };
      if (ended) continue;
      if (d <= OFF_M && s[i + 1].at >= route.pos - BACK_M) { if (!hit || d < hit.d) hit = { d, along }; }
      else if (hit) ended = true;   // that pass is over: a later one on the same spot is for later
    }
    return { near, hit };
  }
  // The ride's line from a to b metres along it.
  function sliceSeq(a, b) {
    const s = route.seq, out = [];
    const mid = (x, y, at) => { const t = (at - x.at) / (y.at - x.at || 1); return [x.q[0] + t * (y.q[0] - x.q[0]), x.q[1] + t * (y.q[1] - x.q[1])]; };
    for (let i = 0; i < s.length; i++) {
      const x = s[i];
      if (x.at < a) { const y = s[i + 1]; if (y && y.at > a) out.push(mid(x, y, a)); continue; }
      if (x.at > b) { if (i && s[i - 1].at < b) out.push(mid(s[i - 1], x, b)); break; }
      out.push(x.q);
    }
    return out;
  }
  const partAt = (pos) => { const i = route.parts.findIndex((x) => pos < x.to - 1); return i < 0 ? route.parts.length - 1 : i; };
  // Faded behind you, bold for the rest of this trail and the next one (600 m to 2.5 km), light after that.
  function drawProgress(force) {
    if (!route || !route.parts) return;
    const pos = route.pos, cur = partAt(pos), z = map.getZoom(), d = route.drawn;
    if (!force && d && d.z === z && Math.abs(d.pos - pos) < 15 && d.cur === cur) return;
    route.drawn = { pos, cur, z };
    const nx = route.parts[cur + 1], end = Math.min(route.total, Math.max(pos + NEXT_MIN_M, Math.min(pos + NEXT_MAX_M, nx ? nx.to : route.total)));
    const bold = sliceSeq(pos, end);
    routeDone.setLatLngs(pos > 0 ? sliceSeq(0, pos) : []);
    routeCase.setLatLngs(bold); routeLine.setLatLngs(bold);
    routeRest.setLatLngs(end < route.total ? sliceSeq(end, route.total) : []);
    routeMarks.clearLayers();
    // Arrows along the bold part, the way you ride it.
    const px = bold.map((q) => map.latLngToLayerPoint(q));
    let run = ROUTE_ARROW_PX / 2, n = 0;
    for (let i = 1; i < px.length && n < MAX_ROUTE_ARROWS; i++) {
      const seg = px[i].distanceTo(px[i - 1]);
      while (run <= seg && n < MAX_ROUTE_ARROWS) {
        const t = run / seg, at = map.layerPointToLatLng(L.point(px[i - 1].x + t * (px[i].x - px[i - 1].x), px[i - 1].y + t * (px[i].y - px[i - 1].y)));
        const deg = Math.atan2(px[i].y - px[i - 1].y, px[i].x - px[i - 1].x) * 180 / Math.PI;
        routeMarks.addLayer(L.marker(at, { pane: "onewayArrows", interactive: false, keyboard: false, rotateWithView: true, icon: L.divIcon({ className: "oneway-arrow", iconSize: [20, 20], iconAnchor: [10, 10],
          html: `<svg viewBox="0 0 20 20" width="20" height="20" style="transform: rotate(${Math.round(deg)}deg)" aria-hidden="true"><path d="M4 3 17 10 4 17 7.5 10z" fill="#4b0fb0" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>` }) }));
        n++; run += ROUTE_ARROW_PX;
      }
      run -= seg;
    }
    // Each trail ahead: its number from the list where it starts.
    route.parts.slice(cur + 1, cur + 1 + MAX_NUMS).forEach((x, k) => {
      routeMarks.addLayer(L.marker(x.pts[0], { pane: "onewayArrows", interactive: false, keyboard: false, icon: L.divIcon({ className: "route-num" + (k ? "" : " next"), iconSize: [22, 22], iconAnchor: [11, 11], html: `<b>${cur + 2 + k}</b>` }) }));
    });
  }
  map.on("zoomend", () => drawProgress(true));

  // The trails of a planned ride, in order: done ones ticked, the one you're on, the next one highlighted.
  const listOpen = () => { try { return localStorage.getItem("tf:navParts") !== "0"; } catch { return true; } };
  function renderParts() {
    const box = $("navParts");
    if (!route || !route.parts || route.parts.length < 2) { box.hidden = true; return; }
    const pos = route.pos, cur = partAt(pos), all = route.parts, finished = route.total - pos < 30, open = listOpen();
    const lvl = (x) => (x.lvl ? ` <small>${esc(x.lvl)}</small>` : "");
    $("navPartsHead").innerHTML = finished ? `<b>All ${all.length} done</b>` : (open ? `<b>Trail ${cur + 1} of ${all.length}</b>`
      : `<b>${cur + 1}/${all.length}</b> ${esc(all[cur].name)}${all[cur + 1] ? ` · next <b>${esc(all[cur + 1].name)}</b>` : ""}`) + `<span class="np-tog">${open ? "Hide ▴" : "List ▾"}</span>`;
    const list = $("navPartsList");
    list.hidden = !open;
    if (open) {
      const keep = list.scrollTop;
      list.innerHTML = all.map((x, i) => {
        const st = finished || i < cur ? "done" : i === cur ? "now" : i === cur + 1 ? "next" : "";
        const m = st === "now" && route.on ? `${fmtM(Math.max(0, x.to - pos))} left` : st === "next" ? `in ${fmtM(Math.max(0, x.from - pos))}` : fmtM(x.to - x.from);
        return `<li class="${st}" data-n="${i}"><span class="np-n">${st === "done" ? "✓" : i + 1}</span><i style="background:${x.color || "#7b2ff7"}"></i><span class="np-name">${esc(x.name)}${lvl(x)}</span><span class="np-m">${m}</span></li>`;
      }).join("");
      if (route.listN !== cur) {   // keep the one you're on in sight (the panel itself never scrolls into view)
        route.listN = cur;
        const row = list.children[Math.max(0, cur - 1)];
        list.scrollTop = row ? row.offsetTop : 0;
      } else list.scrollTop = keep;
    }
    box.hidden = false;
  }
  function showPart(n) {
    const x = route && route.parts && route.parts[n];
    if (!x) return;
    following = false; $("navFollow").hidden = false;
    map.fitBounds(L.latLngBounds(x.pts), { padding: [40, 40], maxZoom: 17 });
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

  // ---------- spoken directions (alex, 2026-10-24: "spoken directions in Ride mode") ----------
  // A planned ride's turns ("In 200 metres, turn left onto Crank It Up, blue", then "Turn left onto Crank It Up" at the
  // turn), off the route and back on it, the end. Riding free: the trail you're on and the next junction's branches.
  // Always: a one-way trail ridden the wrong way, and every 5 km the distance, climb and moving time. 🔊 in the strip
  // turns it off (kept on this device). In the iPhone app the phone's own voice speaks, over the music (which dips
  // meanwhile), and a planned ride's turns are handed to the app too, so they're still said with the phone locked and the
  // page asleep (TrailGps cues). Elsewhere the browser's voice.
  const CAP = window.Capacitor;
  const NATIVE_VOICE = !!(IN_APP && CAP && CAP.nativePromise &&
    (CAP.PluginHeaders || []).some((h) => h.name === "TrailGps" && (h.methods || []).some((x) => x.name === "speak")));   // builds before 12 can't
  const PRE_MIN = 100, PRE_MAX = 260, PRE_M = 200, AT_M = 40, JUNC_MIN = 25, JUNC_MAX = 80, SUM_M = 5000, NAME_AGAIN_MS = 180000, JUNC_AGAIN_MS = 600000;
  const voice = { said: new Map(), trail: "", km: null };
  const voiceOn = () => { try { return localStorage.getItem("tf:navVoice") !== "0"; } catch { return true; } };
  function sayNow(text) {
    if (NATIVE_VOICE) { CAP.nativePromise("TrailGps", "speak", { text }).catch(() => {}); return; }
    try { const u = new SpeechSynthesisUtterance(text); u.lang = "en-CA"; window.speechSynthesis.speak(u); } catch {}
  }
  // key: say it once per ride (a turn), or again after again ms (a junction, a trail's name); no key: every time.
  function say(text, key, again) {
    if (!rec || !text || !voiceOn()) return;
    if (key) {
      const at = voice.said.get(key);
      if (at != null && !(again && Date.now() - at > again)) return;
      voice.said.set(key, Date.now());
    }
    sayNow(text);
  }
  // iPhones only let a page speak after a tap: a silent word from the tap that starts the ride.
  function primeVoice() {
    if (NATIVE_VOICE) return;
    try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; window.speechSynthesis.speak(u); } catch {}
  }
  const sayM = (m) => {
    if (m < 950) return `${Math.max(50, Math.round(m / 50) * 50)} metres`;
    const k = (m / 1000).toFixed(1).replace(/\.0$/, "");
    return k === "1" ? "1 kilometre" : `${k} kilometres`;
  };
  const sayTime = (s) => { const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? `${h} hour${h > 1 ? "s" : ""} ` : "") + `${m} minute${m === 1 ? "" : "s"}`; };
  const GENERIC = { "forest road": "the forest road", street: "the street", path: "a path", "unnamed trail": "an unnamed trail", connector: "a connector", trail: "the trail" };
  const generic = (s) => GENERIC[String(s || "").toLowerCase()];
  const spokenPart = (x) => (generic(x.name) || x.name) + (x.lvl && !generic(x.lvl) ? `, ${x.lvl.toLowerCase()}` : "");
  // Which way the ride goes where trail n starts: the line 25 m before it against the line 25 m after it.
  function turnWord(n) {
    const from = route.parts[n].from, a = sliceSeq(Math.max(0, from - 25), from), b = sliceSeq(from, Math.min(route.total, from + 25));
    if (a.length < 2 || b.length < 2) return "Continue";
    const t = ((bearing(b[0], b[b.length - 1]) - bearing(a[0], a[a.length - 1]) + 540) % 360) - 180, s = t < 0 ? "left" : "right", u = Math.abs(t);
    return u < 25 ? "Continue" : u < 60 ? `Bear ${s}` : u < 135 ? `Turn ${s}` : u < 165 ? `Turn sharp ${s}` : "Turn around";
  }
  function turnText(n, pre) {
    const x = route.parts[n];
    const what = x.kind === "drive" ? "the shuttle" : x.kind === "gap" ? "a stretch off the mapped trails" : null;
    const w = what ? "" : turnWord(n);
    if (w === "Continue" && route.parts[n - 1].name === x.name) return "";    // the same trail carries on: nothing to say
    const onto = what ? `${pre ? "" : "Here, "}${what}` : `${w} onto ${spokenPart(x)}`;
    return pre ? `In ${sayM(pre)}, ${onto[0].toLowerCase() + onto.slice(1)}.` : `${onto}.`;
  }
  // A planned ride: the start, each turn (ahead, then at it), the end.
  function routeVoice(left) {
    if (!route.on) return;
    if (!route.parts) { if (left < 30 && route.total > 200) say(`End of ${route.name}.`, "end"); return; }
    if (document.hidden && voice.cues) return;     // the phone is locked: the app says the turns
    const all = route.parts, pos = route.pos, cur = partAt(pos);
    const picked = all.filter((x) => x.kind === "pick").length || all.length;
    if (!voice.said.has("start")) say(pos < 150 ? `Starting your ride: ${picked > 1 ? `${picked} trails, ` : ""}${sayM(route.total)}. First, ${spokenPart(all[0])}.` : `On ${spokenPart(all[cur])}.`, "start");
    if (route.total - pos < 30) { say("End of the route. Nice ride!", "end"); return; }
    for (let n = Math.max(1, cur); n < all.length && n <= cur + 2; n++) {
      const d = all[n].from - pos;
      if (d > PRE_MAX) break;
      if (d >= PRE_MIN) { if (all[n].from - all[n - 1].from > PRE_MAX + 100) say(turnText(n, d), "pre" + n); }
      else if (d <= AT_M && d > -15) say(turnText(n), "at" + n);
    }
  }
  // The planned ride's turns from where you are on, for the app to say with the phone locked (it says them in order).
  let cuesSent = "";
  function sendCues() {
    if (!NATIVE_VOICE) return;
    const list = [];
    if (rec && route && route.parts && voiceOn()) {
      const all = route.parts, pos = route.pos;
      for (let n = 1; n < all.length; n++) {
        const x = all[n];
        if (x.from < pos - 15 || voice.said.has("at" + n)) continue;
        if (x.from - all[n - 1].from > PRE_MAX + 100 && x.from - PRE_M > pos && !voice.said.has("pre" + n)) {
          const q = sliceSeq(x.from - PRE_M, x.from - PRE_M)[0];
          if (q && turnText(n, PRE_M)) list.push([q[0], q[1], 35, turnText(n, PRE_M)]);
        }
        if (turnText(n)) list.push([x.pts[0][0], x.pts[0][1], 30, turnText(n)]);
      }
      const e = route.seq[route.seq.length - 1];
      if (route.total > 500 && !voice.said.has("end")) list.push([e.q[0], e.q[1], 30, "End of the route. Nice ride!"]);
    }
    const k = JSON.stringify(list);
    if (k === cuesSent) return;
    cuesSent = k;
    voice.cues = list.length > 0;
    CAP.nativePromise("TrailGps", "cues", { list }).catch(() => {});
  }
  function junctionVoice(j) {
    const SIDE = { left: "left", right: "right", straight: "straight on", back: "back" };
    const offs = j.offs.slice(0, 3).map((o) => `${SIDE[o.side]}, ${o.name}`).join("; ");
    say(`Junction in ${sayM(j.m)}: ${offs}${j.offs.length > 3 ? `; and ${j.offs.length - 3} more` : ""}.`, "j" + key(j.at), JUNC_AGAIN_MS);
  }
  function setVoice(on) {
    try { localStorage.setItem("tf:navVoice", on ? "1" : "0"); } catch {}
    const b = $("navVoice");
    b.textContent = on ? "🔊" : "🔇"; b.setAttribute("aria-pressed", String(on));
    b.title = on ? "Spoken directions are on (tap to turn off)" : "Spoken directions are off (tap to turn on)";
    if (on) { primeVoice(); sayNow("Voice on."); }
    else { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch {} }
    sendCues();
  }

  function updateRoute(p, acc) {
    if (!route) return;
    let best = { d: Infinity }, aim = null, left;
    if (route.parts) {
      const at = locate(p), h = at.hit;
      if (h && !(acc > MAX_ACC_M * 2)) {
        if (route.on && h.along - route.pos > JUMP_M) {   // well ahead: only after a few fixes there, not a GPS blip or a crossing
          const j = route.jump;
          route.jump = j && h.along >= j.along - BACK_M ? { along: h.along, n: j.n + 1 } : { along: h.along, n: 1 };
          if (route.jump.n >= JUMP_FIXES) { route.pos = h.along; route.jump = null; }
        } else { route.pos = Math.max(route.pos, h.along); route.jump = null; }
      }
      best = at.near;
      aim = best.d < Infinity ? sliceSeq(best.along, best.along)[0] : null;
      left = Math.max(0, route.total - route.pos);
    } else {
      let near = null;
      route.lines.forEach((g) => { const pr = project(g, p); if (pr.d < best.d) best = pr, near = g; });
      aim = near ? pointOnLine(near, best) : null;
      route.pts.forEach((x, i) => { if (!route.done.has(i) && metres(x.q, p) <= PASS_M) route.done.add(i); });
      left = Math.max(0, route.total - [...route.done].reduce((a, i) => a + route.pts[i].m, 0));
    }
    const box = $("navRoute"), now = Date.now();
    const x = '<button type="button" class="x" id="navUnfollow">Stop following</button>';
    if (best.d <= OFF_M) {
      if (route.alerted) say("Back on the route.");
      if (!route.on && !following) { following = true; $("navFollow").hidden = true; map.setView(map.getZoom() >= RIDE_ZOOM ? aboveStrip(p) : p, Math.max(map.getZoom(), RIDE_ZOOM)); }   // reached it: follow you again
      route.on = true; route.offSince = 0; route.alerted = false;
      box.classList.remove("off");
      box.innerHTML = `${x}Following <b>${esc(route.name)}</b> · ${fmtM(left)} left of ${fmtM(route.total)}`;
    } else if (!route.on) {
      // Not there yet: how far to the nearest point of it, and which way.
      const at = aim, dirs = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
      box.classList.remove("off");
      box.innerHTML = `${x}<b>${esc(route.name)}</b> is ${fmtM(best.d)} away${at ? `, to the ${dirs[Math.round(bearing(p, at) / 45) % 8]}` : ""}`;
    } else {
      if (!route.offSince) route.offSince = now;
      if (now - route.offSince >= OFF_MS && !route.alerted) {
        route.alerted = true; alarm();
        const dirs = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
        say(`Off route. The route is ${sayM(best.d)} away${aim ? `, to the ${dirs[Math.round(bearing(p, aim) / 45) % 8]}` : ""}.`);
      }
      box.classList.toggle("off", route.alerted);
      box.innerHTML = `${x}${route.alerted ? "Off route" : "Leaving the route?"}: ${fmtM(best.d)} from <b>${esc(route.name)}</b>`;
    }
    box.hidden = false;
    $("navUnfollow").addEventListener("click", clearRoute);
    drawProgress(); renderParts();
    routeVoice(left);
  }
  function pointOnLine(g, pr) {
    const a = g[pr.i], b = g[Math.min(pr.i + 1, g.length - 1)];
    return [a[0] + pr.t * (b[0] - a[0]), a[1] + pr.t * (b[1] - a[1])];
  }
  // parts (optional, from Plan a route): the ride's trails in order, [{ name, color, lvl, kind, pts }].
  async function follow(lines, name, parts) {
    if (!lines || !lines.length) return;
    if (!rec) { await start(); if (!rec) return; }
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}   // from the tap, so iPhones allow the beep later
    primeVoice();
    setRoute(lines, name || "this trail", parts);
    [...voice.said.keys()].forEach((k) => { if (/^(pre|at)\d/.test(k)) voice.said.delete(k); });
    const here = lastFix && [lastFix.c.latitude, lastFix.c.longitude];
    if (!here || Math.min(...lines.map((g) => project(g, here).d)) > 300) {   // far from it: show the whole trail and you
      const b = L.latLngBounds(lines.flat());
      if (here) b.extend(here);
      following = false; $("navFollow").hidden = false;
      map.fitBounds(b, { padding: [40, 40], maxZoom: RIDE_ZOOM });
    }
    if (lastFix) updateRoute([lastFix.c.latitude, lastFix.c.longitude], lastFix.c.accuracy);
    sendCues();
    if (!lastFix) { $("navRoute").hidden = false; $("navRoute").innerHTML = `Following <b>${esc(route.name)}</b> · waiting for GPS`; renderParts(); }
  }

  // Numbers: moving time (stops don't count), distance, climb, speed now. Paused / Stopped show in place of Moving.
  let lastStats = null, statsAt = 0;
  const mins = (s) => { s = Math.floor(s); return s >= 3600 ? hms(s) : `${Math.floor(s / 60)}:${pad2(s % 60)}`; };
  function speedNow() {
    if (!lastFix || Date.now() - lastFix.t > 10000 || rec.paused) return 0;
    if (lastFix.c.speed != null && lastFix.c.speed >= 0 && !isNaN(lastFix.c.speed)) return lastFix.c.speed;
    const pts = rec.points.filter((q) => !q[5]).slice(-4);
    if (pts.length < 2) return 0;
    const dt = (pts[pts.length - 1][3] - pts[0][3]) / 1000;
    return dt > 0 && Date.now() - pts[pts.length - 1][3] < 10000 ? distOf(pts) / dt : 0;
  }
  function tick() {
    if (!rec) return;
    if (!lastStats || Date.now() - statsAt > 2000) { lastStats = STATS.statsOf(rec.points, rec.start, Date.now(), rec.breaks); statsAt = Date.now(); }
    const st = lastStats, v = speedNow(), stopped = !rec.paused && v < STATS.MOVING_MS && (!rec.lastReal || Date.now() - rec.lastReal > 10000);
    $("navTime").textContent = mins(st.moving);
    $("navTimeK").textContent = rec.paused ? "Paused" : stopped && rec.points.length ? "Stopped" : "Moving";
    $("navTimeBox").classList.toggle("paused", !!rec.paused || (stopped && rec.points.length > 0));
    $("navDist").textContent = (st.dist / 1000).toFixed(2);
    $("navClimb").textContent = st.climb == null ? "–" : Math.round(st.climb);
    $("navSpeed").textContent = (v * 3.6).toFixed(1);
    const k = Math.floor(st.dist / SUM_M);
    if (voice.km == null || k < voice.km) voice.km = k;
    else if (k > voice.km) { voice.km = k; say(`${k * SUM_M / 1000} kilometres. ${st.climb == null ? "" : `${Math.round(st.climb)} metres of climbing. `}${sayTime(st.moving)} riding.`); }
    if (!pocket.hidden) {
      $("pkTime").textContent = mins(st.moving);
      $("pkInfo").textContent = `${(st.dist / 1000).toFixed(2)} km · ${st.climb == null ? "–" : Math.round(st.climb)} m climb · ${rec.paused ? "paused" : lastFix && lastFix.c.accuracy <= MAX_ACC_M && Date.now() - lastFix.t < 15000 ? "recording" : "waiting for GPS"}`;
    }
  }

  // ---------- Pause ----------
  function setPaused(on) {
    if (!rec) return;
    if (!on && rec.paused && rec.points.length) rec.breaks = [...(rec.breaks || []), rec.points.length];   // the next point starts a new piece
    rec.paused = on;
    $("navPause").textContent = on ? "▶ Resume" : "Ⅱ Pause";
    $("navPause").classList.toggle("on", on);
    lastStats = null; tick();
    putCurrent(rec);
  }
  $("navPause").addEventListener("click", () => setPaused(!rec.paused));
  $("navPartsHead").addEventListener("click", () => {
    try { localStorage.setItem("tf:navParts", listOpen() ? "0" : "1"); } catch {}
    if (route) route.listN = -1;
    renderParts();
  });
  $("navPartsList").addEventListener("click", (e) => { const li = e.target.closest("li[data-n]"); if (li) showPart(+li.dataset.n); });

  // ---------- Pocket: a black screen that ignores touches, so the phone stays unlocked (and the GPS on) ----------
  const pocket = document.createElement("div");
  pocket.className = "nav-pocket"; pocket.hidden = true; pocket.setAttribute("role", "dialog"); pocket.setAttribute("aria-label", "Pocket mode");
  pocket.innerHTML = `<div class="big" id="pkTime">0:00</div><div id="pkInfo"></div>
    <div class="unlock" id="pkUnlock"><i></i><span style="position:relative">Hold here to unlock</span></div>
    <div style="font-size:.85rem;max-width:300px">Keeps recording with the screen black. Don't press the phone's lock button: a locked phone stops the GPS.</div>`;
  document.body.appendChild(pocket);
  let holdTimer = 0;
  const stopAll = (e) => { e.preventDefault(); e.stopPropagation(); };
  ["touchstart", "touchmove", "touchend", "click", "contextmenu", "wheel"].forEach((ev) => pocket.addEventListener(ev, (e) => { if (!e.target.closest("#pkUnlock")) stopAll(e); }, { passive: false }));
  const unlockEl = pocket.querySelector("#pkUnlock");
  unlockEl.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    unlockEl.classList.add("hold");
    holdTimer = setTimeout(() => setPocket(false), 1000);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => unlockEl.addEventListener(ev, () => { clearTimeout(holdTimer); unlockEl.classList.remove("hold"); }));
  unlockEl.addEventListener("contextmenu", stopAll);
  function setPocket(on) {
    pocket.hidden = !on;
    if (on) { keepAwake(); tick(); }
  }
  $("navPocket").addEventListener("click", () => setPocket(true));
  $("navVoice").addEventListener("click", () => setVoice(!voiceOn()));
  if (!voiceOn()) { $("navVoice").textContent = "🔇"; $("navVoice").setAttribute("aria-pressed", "false"); }
  $("navVoice").title = voiceOn() ? "Spoken directions are on (tap to turn off)" : "Spoken directions are off (tap to turn on)";

  // In the iPhone app (native-gps.js) the GPS keeps going with the phone locked, so there's no Pocket there.
  $("navPocket").hidden = IN_APP;

  // ---------- coming back: the screen was off, so the phone stopped the GPS ----------
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", async () => {
    if (!rec) return;
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    if (gps) await gps.catchUp();                 // the app's GPS kept going: the fixes the page slept through
    if (!rec) return;
    if (hiddenAt && Date.now() - hiddenAt > 20000 && !rec.paused && !(rec.lastReal > hiddenAt + 15000))   // no fixes came while it was off
      showTip(`The phone stopped the GPS for ${Math.max(1, Math.round((Date.now() - hiddenAt) / 60000))} min while the screen was off. It's back on now.${IN_APP ? "" : " Next time tap 🔒 Pocket instead of locking the phone."}`, 20000);
    hiddenAt = 0;
  });

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
    if (!navigator.geolocation && !IN_APP) { alert("This browser can't share your location, so Ride mode can't follow you."); return; }
    startCompass();                               // first, while the tap still counts (iPhone asks here)
    primeVoice();
    voice.said.clear(); voice.trail = ""; voice.km = null;
    const cur = await getCurrent();
    const lastT = cur && (cur.points.length ? cur.points[cur.points.length - 1][3] : cur.start);
    if (cur && !cur.end && Date.now() - lastT > RESUME_MS) cur.end = lastT;   // left running long ago: that ride is over
    if (cur && cur.end) {
      if (confirm("You have an earlier ride that isn't saved. Open it to save it now?\n\nCancel starts a new ride and drops the old one.")) { await putCurrent(cur); location.href = "ride.html#save"; return; }
      await delCurrent();
    }
    rec = cur && !cur.end ? cur : { id: "current", start: Date.now(), points: [], from: "ride" };
    if (!rec.points.length) { const b = document.body.classList; const sp = b.contains("sport-ski") ? "ski" : b.contains("sport-hunt") ? "hunt" : b.contains("sport-fish") ? "fish" : ""; if (sp) rec.sport = sp; }   // a ski tour, a hunt (My hunts) or a day fishing
    rec.from = "ride";             // ride.html's Keep riding sends it back here
    resumeBox.hidden = true;
    drawTrack();
    lastStats = null; setPaused(!!rec.paused);
    try {
      if (IN_APP) { if (!localStorage.getItem("tf:lockTip")) showTip("You can lock your phone while you ride: the app keeps recording. The blue pill at the top of the screen shows the GPS is on.", 0, () => { try { localStorage.setItem("tf:lockTip", "1"); } catch {} }); }
      else if (!localStorage.getItem("tf:pocketTip")) showTip("Don't lock your phone while you ride: a locked phone stops the GPS for websites. Tap <b>🔒 Pocket</b> to put it away with a black screen.", 0, () => { try { localStorage.setItem("tf:pocketTip", "1"); } catch {} });
    } catch {}
    [track, onGlow].forEach((l) => l.addTo(layer));
    layer.addTo(map);
    if (nav.youLayer) map.removeLayer(nav.youLayer);   // the plain blue dot: Ride mode has its own arrow
    following = true; $("navFollow").hidden = true;
    $("navBtns").hidden = false; $("navAsk").hidden = true;
    setRiding(true);
    syncCompass();
    if (map.getZoom() < RIDE_ZOOM) map.setZoom(RIDE_ZOOM);
    gps = GPS.watch(onFix, onGpsError, { after: rec.points.length ? rec.points[rec.points.length - 1][3] : rec.start });
    keepAwake();
    ticker = setInterval(tick, 1000); tick();
    putCurrent(rec);
  }
  function stopWatching() {
    if (gps) gps.stop();
    gps = null; clearInterval(ticker); ticker = 0; letSleep(); stopCompass();
  }
  function leave() {
    stopWatching();
    clearRoute();
    rec = null; lastFix = null; ride.on = null; lastStats = null;
    setPocket(false); $("navTip").hidden = true;
    layer.clearLayers(); map.removeLayer(layer); you = null;
    track.setLatLngs([]); onGlow.setLatLngs([]);
    gpsMsg.hidden = true;
    if (nav.youLayer) nav.youLayer.addTo(map);
    setRiding(false);
    if (canTurn) { syncCompass(); if (faceWay) map.turnTo(0); }
  }
  map.on("dragstart", () => { if (rec) { following = false; $("navFollow").hidden = false; } });
  $("navFollow").addEventListener("click", () => {
    following = true; $("navFollow").hidden = true;
    if (lastFix) { const p = [lastFix.c.latitude, lastFix.c.longitude]; map.setView(map.getZoom() >= RIDE_ZOOM ? aboveStrip(p) : p, Math.max(map.getZoom(), RIDE_ZOOM)); }
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
    if (document.visibilityState === "hidden") { putCurrent(rec); sendCues(); }
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
    if (z < ARROW_ZOOM || document.body.classList.contains("sport-alt")) return;
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
            arrows.addLayer(L.marker(at, { pane: "onewayArrows", interactive: false, keyboard: false, rotateWithView: true, icon: L.divIcon({ className: "oneway-arrow", iconSize: [22, 22], iconAnchor: [11, 11],
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

  async function offerResume() {
    const cur = await getCurrent();
    if (!cur || rec) return;
    const lastT = cur.points.length ? cur.points[cur.points.length - 1][3] : cur.start;
    if (!cur.points.length && !cur.end && Date.now() - lastT > RESUME_MS) { await delCurrent(); return; }   // nothing recorded, long ago
    const over = !!cur.end || Date.now() - lastT > RESUME_MS;
    const st = STATS.statsOf(cur.points, cur.start, cur.end || lastT, cur.breaks);
    const at = new Date(cur.start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const day = new Date(cur.start).toDateString() === new Date().toDateString() ? "" : new Date(cur.start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " ";
    $("navResumeText").innerHTML = over ? `<b>Your ride from ${esc(day + at)} isn't saved yet</b> (${(st.dist / 1000).toFixed(2)} km).`
      : `<b>You were recording a ride</b> (started ${esc(day + at)}, ${(st.dist / 1000).toFixed(2)} km so far) when the page closed.`;
    $("navResumeGo").hidden = over;
    resumeBox.hidden = false;
    $("navResumeSave").onclick = async () => { if (!cur.end) cur.end = lastT; await putCurrent(cur); location.href = "ride.html#save"; };
    $("navResumeDrop").onclick = async () => { if (!confirm("Drop this ride? It won't be saved.")) return; await delCurrent(); resumeBox.hidden = true; };
    $("navResumeGo").onclick = () => start();
  }
  offerResume();

  const rideBtn = $("navRideBtn");
  if (rideBtn) rideBtn.addEventListener("click", start);
  window.tfRide = { start, follow, riding: () => !!rec };
})();
