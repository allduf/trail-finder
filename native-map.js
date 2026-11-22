// Native map (test), inside the phone apps only, in MTB: Layers > "Native map (test)" opens the trail map drawn by the
// phone itself (MapLibre Native, the TrailMap plugin in ios-app/plugins/TrailMap, and in android-app/plugins/TrailMap
// since 2026-11-21: alex wanted native 3D on Android too) instead of this page, to feel whether
// it pans and zooms smoother (alex 2026-10-30, Upgrade 3 of the review). It shows what the flat map shows (trails, their
// colours and dashes, the dots), copied the way map3d.js copies them for 3D. As it moves, this page's map follows out of
// sight so the trails there load, and they're sent again. Tapping a trail shows its name; "Details" comes back here and
// opens that trail, as a tap on it here would. On the website, and in app builds without the plugin, this file does nothing.
// Only alex sees the button (go-public checklist item 25, Apple rule 2.2: no test features for the public). friends.js
// keeps "tf-admin" = "1" on alex's devices and fires "tf:admin" when that changes.
// "Native 3D (test)" next to it (alex 2026-11-16, "Small native 3D trial") opens the same screen in 3D: satellite photos
// over the mountains, tilted, with the same trails, to feel whether a 3D map drawn by the iPhone turns smoother than the
// web one. Photos and trails only, in every sport, also alex only. Needs an app build with the 3D engine (TrailMap's
// MapLibre with terrain); in older builds it opens flat. In Skiing it also has the Winter map (last winter's photos),
// first in its list, and opens on it when the page's map is on Winter (alex 2026-11-20: "can we have the Winter map like
// that?"); app builds before that show Satellite.
// "Native for viewing, web for tools" (alex 2026-11-20): on alex's iPhone, tapping the map's 3D button opens this native
// 3D for looking around, unless a layer only the web 3D map draws is on (avalanche; before a build with native-ground.js's
// layers, also slope angles and the other ground layers, elevation lines, sun and shade): then the web 3D map opens as before, so avalanche ratings are only ever
// drawn by one piece of code (avalanche-exact). The native screen's "Layers" button goes to the web 3D map at the same
// spot with its Layers open, for turning those on. Other ways into 3D (a tour, a plan, the app reopening in 3D) keep
// opening the web 3D map. Only alex for now; the "(test)" label goes once friends have tried it.
// Since 2026-11-21 (alex: the last step of the plan), on an iPhone app build that draws everything natively, native 3D
// is the only 3D map for everyone, with no "(test)" label and no web 3D map (FULL, tfNative3d below).
(() => {
  "use strict";
  const C = window.Capacitor, map = window.tfLeaflet, L = window.L;
  if (!C || !C.isNativePlatform || !C.isNativePlatform() || !map || !L) return;
  if (C.isPluginAvailable && !C.isPluginAvailable("TrailMap")) return;
  const TrailMap = C.registerPlugin ? C.registerPlugin("TrailMap") : (C.Plugins || {}).TrailMap;
  const tools = document.getElementById("offlineBtn");
  if (!TrailMap || !tools) return;

  const btn = document.createElement("button");
  btn.type = "button"; btn.id = "nativeMapBtn";
  btn.title = "Try the map drawn by the phone itself: does it move smoother?";
  btn.textContent = "Native map (test)";
  const btn3d = document.createElement("button");
  btn3d.type = "button"; btn3d.id = "native3dBtn";
  btn3d.title = "Try the 3D map drawn by the phone itself: does it turn and tilt smoother?";
  btn3d.textContent = "Native 3D (test)";
  tools.after(btn, btn3d);
  const isAdmin = () => { try { return localStorage.getItem("tf-admin") === "1"; } catch { return false; } };
  btn.hidden = btn3d.hidden = !isAdmin();
  window.addEventListener("tf:admin", () => { btn.hidden = btn3d.hidden = !isAdmin(); });
  const css = document.createElement("style");
  css.textContent = "body.sport-alt #nativeMapBtn, #nativeMapBtn[hidden], #native3dBtn[hidden] { display: none !important; }";   // 2D: MTB only; both alex only
  document.head.append(css);

  let open = false, hits = [], pending = 0;
  // ---------- native 3D features, one file each (ios-app/.../NativeLayers.swift) ----------
  // A feature's page side (its own native-xxx.js) registers what it sends: window.tfNative.addLayer(key, get), where
  // get() returns its data as text (or null for nothing); it's sent with the 3D screen's opening, and again with
  // window.tfNative.send(key) whenever it changes while the screen is open. Load those files after this one, and guard
  // the call (window.tfNative && window.tfNative.addLayer) so an older cached copy of this file can't break them.
  // A feature's card (showFeatureCard in Swift) with Details pressed comes back as "closed" with feature: key and
  // open: the feature's own number; addLayer's third argument, onDetails(n, latlng), opens it here. tfNative.on(name, fn)
  // listens to a feature's own events from the native screen.
  // tfNative.skip(fn): fn(layer) true for a layer a feature sends itself (a tool's route, track or sight line,
  // native-tools.js): it's left out of the trails here. tfNative.hit(i): the page's trail number i sent last.
  const feats = new Map(), details = new Map(), skips = [];
  // Android (android-app/plugins/TrailMap, since 2026-11-21) gets its native 3D features one at a time: draws(key) says
  // whether this build draws a feature itself (TrailMap.features). On Android, nothing is worked out or sent for a
  // feature it doesn't draw, and what that feature would draw stays in the trails sent here. On the iPhone, always true
  // (as before: an older build ignores keys it doesn't know).
  const android = !!(C.getPlatform && C.getPlatform() === "android");
  const draws = (key) => !android || (!!nativeKeys && nativeKeys.has(String(key)));
  // A skip belongs to the feature that draws those layers itself (native-tools.js: "tools").
  const skipped = (l) => skips.some((s) => { try { return draws(s.key) && s.fn(l); } catch { return false; } });
  // A sport whose data lives inside its own file registers from there instead (hunting.js: "hunt").
  let open3d = false;
  const featureData = (threeD) => {
    const out = {};
    if (!threeD) return out;
    for (const [k, get] of feats) { if (!draws(k)) continue; try { const d = get(); if (d != null) out[k] = String(d); } catch {} }
    return out;
  };
  window.tfNative = {
    addLayer(key, get, onDetails) {
      if (typeof get === "function") feats.set(String(key), get);
      if (typeof onDetails === "function") details.set(String(key), onDetails);
    },
    send(key) {
      const get = feats.get(String(key));
      if (!open || !open3d || !get || !TrailMap.layer || !draws(key)) return;
      let d = null; try { d = get(); } catch {}
      if (d != null) TrailMap.layer({ key: String(key), data: String(d) }).catch(() => {});
    },
    isOpen: () => open && open3d,
    // For a feature that talks with its native side (native-ground.js): its events from the 3D screen, and data sent
    // without waiting for its get().
    on(name, fn) { if (typeof fn === "function") TrailMap.addListener(String(name), (e) => { try { fn(e || {}); } catch {} }); },
    post(key, data) { if (open && open3d && TrailMap.layer && draws(key)) TrailMap.layer({ key: String(key), data: String(data) }).catch(() => {}); },
    // "Details" on a feature's own card (one it showed with open -1, at its own spot): fn({ tapLat, tapLon }) opens
    // it on the page and returns true; otherwise the page opens what's at that spot, as for a trail.
    onDetails(fn) { if (typeof fn === "function") detailFns.push(fn); },
    // has(key): this app build draws that feature itself (TrailMap.features; older builds have no such call).
    has: (key) => !!nativeKeys && nativeKeys.has(String(key)),
    // draws(key): whether to send this feature's data at all (see draws above); a feature's page side checks it before
    // work done only for the native screen.
    draws,
    // full(): this iPhone's app build draws everything natively, so native 3D is its only 3D map (no web 3D on it).
    full: () => fullNative(),
    // moveWait(ms): how long the page waits after the native map moves before sending the trails again (500 ms); a
    // Flyover moves it every second, so it waits longer meanwhile. Nothing: back to 500.
    moveWait(ms) { moveWait = ms > 0 ? ms : 500; },
    skip(fn, key = "tools") { if (typeof fn === "function") skips.push({ fn, key: String(key) }); },
    hit: (i) => hits[i] || null,
    // backOut(): Android's Back with nothing of the page's left to close (native.js): native 3D under the page closes its
    // own card if one shows, else goes back to the flat map (true), as the 2D button does.
    backOut: () => { if (!open || !under) return false; TrailMap.layer({ key: "under", data: JSON.stringify({ back: true }) }).catch(() => {}); return true; },
  };
  const detailFns = [];
  let nativeKeys = null, moveWait = 500, keysWait = [];
  const keysIn = (k) => { nativeKeys = k; const w = keysWait; keysWait = []; w.forEach((f) => { try { f(); } catch {} }); };
  try { Promise.resolve(TrailMap.features()).then((r) => keysIn(new Set((r && r.keys) || [])), () => keysIn(new Set())); } catch { keysIn(new Set()); }
  // Native 3D for every iPhone tester, and no web 3D map on the iPhone (alex 2026-11-21, the last step of the native 3D
  // plan): only on an app build that draws every 3D feature itself (these keys, NativeLayers.all). Older builds keep the
  // web 3D map (and alex's own "native for viewing" as before) until they're updated. Android keeps the web 3D map.
  // Never add a key to FULL: every iPhone build already on phones (150 and later) would lack it and go back to the web
  // 3D map after a website update. A newer native feature shows in native 3D from the build that has it (has(key) tells
  // the page). The phone test fails if FULL asks for more than build 150 has, or if NativeLayers.swift drops one.
  const FULL = ["avy", "fish", "flyover", "ground", "hunt", "moto", "offline", "pins", "radar", "search", "smoke", "tools"];
  const ios = !!(C.getPlatform && C.getPlatform() === "ios");
  const fullNative = () => ios && !!nativeKeys && FULL.every((k) => nativeKeys.has(k));
  const nativeOn = () => isAdmin() || fullNative();
  const ll = (p) => [Math.round(p.lng * 1e5) / 1e5, Math.round(p.lat * 1e5) / 1e5];
  // Leaflet dashes are in pixels, MapLibre's in line widths; round-capped dots (unofficial trails) stay dots.
  // In 3D, lines are a little bolder than on the flat map and dots closer together, as on the web 3D map (map3d.js
  // LINE_SCALE, DOT_STEP), so they read against the photos; the iPhone draws the dots bigger, on a dark band.
  const LINE_SCALE = 1.15, DOT_STEP = 2.2;
  const dashKey = (d, w) => {
    const n = String(d).trim().split(/[\s,]+/).map(Number);
    if (n.length === 2 && n[0] <= 1) return "0," + (open3d ? DOT_STEP : Math.max(0.1, (n[0] + n[1]) / Math.max(w, 1))).toFixed(2);
    return n.map((x) => Math.max(0.1, x / Math.max(w, 1)).toFixed(2)).join(",");
  };
  // The name written along a line in native 3D (lb): only a line's own label, as on the web 3D map (map3d.js), and MTB
  // trail names stay off it in the other sports (alex 2026-11-02: bike trail names over Whistler read as clutter).
  const label = (l) => {
    const o = l.options, pane = o.renderer && o.renderer.options.pane;
    if (!o.label || (document.body.classList.contains("sport-alt") && /^(allTrails|boxTrails|newTrails)$/.test(pane || ""))) return "";
    return String(o.label);
  };
  const nameOf = (l) => {
    if (l.options.label) return String(l.options.label);
    const t = l.getTooltip && l.getTooltip();
    if (!t) return "";
    const d = document.createElement("div"); d.innerHTML = String(t.getContent()); return d.textContent.trim();
  };

  // What the flat map shows around the view (2 screens each way), as GeoJSON text for the native map.
  function snapshot() {
    const lines = [], dots = [], dashes = new Set();
    hits = [];
    const near = map.getBounds().pad(2), hidden = new Map();
    const paneHidden = (o) => {
      const name = (o.renderer && o.renderer.options.pane) || o.pane || "overlayPane";
      if (!hidden.has(name)) { const el = map.getPane(name); hidden.set(name, !!el && getComputedStyle(el).display === "none"); }
      return hidden.get(name);
    };
    map.eachLayer((l) => {
      // tfYou: the flat map's own location dot (index.html). The native map draws yours itself, on the ground and moving
      // smoothly; a copy here was a second dot left behind, and changed the trails each fix (sent again every second).
      if (!(l instanceof L.Path) || l.options.tfYou || paneHidden(l.options) || (skips.length && skipped(l))) return;
      const bb = l.getBounds ? l.getBounds() : L.latLngBounds([l.getLatLng()]);
      if (!bb.isValid() || !near.intersects(bb) || l instanceof L.Circle) return;   // circles (radius rings) aren't trails
      const o = l.options, tap = o.interactive !== false && l.listens("click");
      const props = {}, n = nameOf(l);
      if (n) props.n = n;
      if (tap) { props.i = hits.length; hits.push(l); }
      if (l instanceof L.CircleMarker) {
        dots.push({ type: "Feature", geometry: { type: "Point", coordinates: ll(l.getLatLng()) },
          properties: { ...props, r: l.getRadius(), c: o.color || "#fff", w: o.stroke === false ? 0 : o.weight || 0, f: o.fillColor || o.color || "#fff", fo: o.fill === false ? 0 : o.fillOpacity == null ? 0.2 : o.fillOpacity } });
        return;
      }
      if (!o.stroke || !(o.opacity > 0)) return;
      let lls = l.getLatLngs();
      if (!lls.length) return;
      if (!Array.isArray(lls[0])) lls = [lls];
      else if (Array.isArray(lls[0][0])) lls = lls.flat();
      let parts = lls.map((p) => p.map(ll));
      if (l instanceof L.Polygon) parts.forEach((p) => p.length && p.push(p[0]));
      parts = parts.filter((p) => p.length > 1);
      if (!parts.length) return;
      const d = o.dashArray ? dashKey(o.dashArray, o.weight) : "";
      if (d) dashes.add(d);
      lines.push({ type: "Feature", geometry: { type: "MultiLineString", coordinates: parts },
        properties: { ...props, c: o.color, w: (o.weight || 3) * (open3d ? LINE_SCALE : 1), o: o.opacity, d, ...(label(l) ? { lb: label(l) } : {}) } });
    });
    return {
      lines: JSON.stringify({ type: "FeatureCollection", features: lines }),
      dots: JSON.stringify({ type: "FeatureCollection", features: dots }),
      dashes: [...dashes].join("|"),
    };
  }

  // Trails come and go on the flat map as it follows (zones loading, names redrawn): sent once it settles. Only when
  // they changed: the native map redoes its whole trail index for each one sent (on the iPhone's main thread), and most
  // moves and layer changes leave the trails around the view as they were.
  let sent = "";
  const keyOf = (s) => s.lines + "\n" + s.dots + "\n" + s.dashes;
  function send() {
    pending = 0;
    if (!open) return;
    const s = snapshot(), k = keyOf(s);
    if (k === sent) return;
    sent = k;
    TrailMap.update(s).catch(() => { sent = ""; });
  }
  const later = (ms) => { if (open) { clearTimeout(pending); pending = setTimeout(send, ms); } };
  map.on("layeradd layerremove", (e) => { if (e.layer instanceof L.Path && !(skips.length && skipped(e.layer))) later(400); });

  // MapLibre's zoom is one less than Leaflet's (512 px tiles against 256).
  let following = false, nativeAt = null;
  const follow = (e) => {
    following = true;
    try { map.setView([e.lat, e.lon], Math.max(3, Math.round(e.zoom + 1)), { animate: false }); } finally { following = false; }
    nativeAt = { lat: e.lat, lon: e.lon, zoom: e.zoom, fz: map.getZoom() };   // fz: the zoom the flat map could reach
  };
  TrailMap.addListener("moved", (e) => { if (!open) return; if (under) map.closePopup(); follow(e); later(moveWait); });
  TrailMap.addListener("closed", (e) => {
    open = false; clearTimeout(pending); moveWait = 500; sent = "";
    leaveUnder();
    follow(e);
    if (map.setBearing) { map.setBearing(-(e.bearing || 0)); map.fire("rotateend"); }
    if (e.details) openDetails(e);
  });
  // Under the page (below): Details on a native card opens here while the native map stays; a trail tapped there opens
  // the page's own card, as a tap on the flat map.
  TrailMap.addListener("details", (e) => { if (open && e) openDetails(e); });
  let quietUntil = 0;
  TrailMap.addListener("tap", (e) => {
    if (!open || !e) return;
    const latlng = L.latLng(e.tapLat, e.tapLon), l = e.open >= 0 && hits[e.open];
    // A popup opens where the finger is: the flat map (hidden) is moved so that spot is under it, and its own moves
    // for the next moment (a popup making room for itself) aren't sent back to the native map.
    quietUntil = Date.now() + 1000;
    if (isFinite(e.x) && isFinite(e.y)) {
      const at = map.latLngToContainerPoint(latlng), r = mapEl.getBoundingClientRect();
      following = true;
      try { map.panBy([at.x - (e.x - r.left), at.y - (e.y - r.top)], { animate: false }); } finally { following = false; }
    }
    if (l) l.fire("click", { latlng });
    else map.fire("click", { latlng, layerPoint: map.latLngToLayerPoint(latlng), containerPoint: map.latLngToContainerPoint(latlng) });
  });
  function openDetails(e) {
    if (e.feature) {   // a feature's own card: that feature opens it (native-xxx.js)
      const f = details.get(String(e.feature));
      if (f) try { f(e.open, L.latLng(e.tapLat, e.tapLon)); } catch {}
      return;
    }
    if (!(e.open >= 0)) for (const fn of detailFns) { try { if (fn(e)) return; } catch {} }
    // "Details" on a trail's card: the trail opens as if tapped there (most trails are found by the map's own tap).
    const latlng = L.latLng(e.tapLat, e.tapLon), l = e.open >= 0 && hits[e.open];
    if (l) l.fire("click", { latlng });
    else map.fire("click", { latlng, layerPoint: map.latLngToLayerPoint(latlng), containerPoint: map.latLngToContainerPoint(latlng) });
  }

  // ---------- native 3D under the page (alex 2026-11-22: "i want to keep the same interface for both i never want the
  // map to switch from web to native map") ----------
  // On an app build that can (TrailMap.features has "under": ios-app NativeUnder.swift + App/TFBridge in
  // SceneDelegate.swift, android-app NativeUnder.java), native 3D opens UNDER this page instead of over it: the page
  // keeps its own top buttons, Layers, bottom bar, sheets and cards, as on the flat map, and only the map changes (the
  // flat map's drawing is hidden and the page turns see-through there). The 3D button reads "2D map" and closes it, a
  // trail tapped on the native map opens this page's card, and a move of this page's map (a search, a card) moves the
  // native one. The native side lets through to the page every touch where the page shows something of its own: the page
  // sends a grid of that (1: map), again whenever what shows changes. Older builds keep the native screen over the page.
  const GRID = 12;   // CSS px per cell
  const mapEl = map.getContainer();
  // Something of the page's own at this element: it, or a holder of it up to the page, has a background or is a control.
  // Remembered per element for one grid (most cells hit the same few elements).
  let seen = new Map();
  const solid = (el) => {
    if (!el || el === document.body || el === document.documentElement || el === mapEl) return false;
    if (seen.has(el)) return seen.get(el);
    const cs = getComputedStyle(el);
    const own = cs.backgroundImage !== "none" || !/^(?:transparent|rgba\(\d+,\s*\d+,\s*\d+,\s*0\))$/.test(cs.backgroundColor) ||
      /^(BUTTON|INPUT|SELECT|TEXTAREA|A|LABEL|SVG|IMG|VIDEO|CANVAS)$/i.test(el.tagName);
    const v = own || solid(el.parentElement);
    seen.set(el, v);
    return v;
  };
  // The map at this element: the flat map itself (its drawing is hidden under the page), or a see-through holder.
  const isMap = (el) => !el || el === mapEl || el === document.body || el === document.documentElement || !solid(el);
  function underGrid() {
    seen = new Map();
    const w = innerWidth, h = innerHeight, c = Math.ceil(w / GRID), r = Math.ceil(h / GRID);
    let m = "";
    for (let y = 0; y < r; y++) for (let x = 0; x < c; x++) {
      m += isMap(document.elementFromPoint(Math.min(w - 1, x * GRID + GRID / 2), Math.min(h - 1, y * GRID + GRID / 2))) ? "1" : "0";
    }
    // The page's rows of buttons at the top and bottom, down the middle third: where the native map's own labels stop.
    const col = (x) => (y) => m[y * c + x] === "0";
    const xs = [Math.floor(c / 3), Math.floor(c / 2), Math.floor((2 * c) / 3)];
    const edge = (from, to, dir) => {
      let found = -1, gap = 0;
      for (let y = from; dir > 0 ? y < to : y > to; y += dir) {
        if (xs.some((x) => col(x)(y))) { found = y; gap = 0; } else if (++gap > (found < 0 ? 14 : 3)) break;
      }
      return found;
    };
    const t = edge(0, Math.floor(r * 0.5), 1), b = edge(r - 1, Math.floor(r * 0.3), -1);
    return { s: GRID, c, r, m, t: t < 0 ? 0 : (t + 1) * GRID, b: b < 0 ? 0 : h - b * GRID };
  }
  let under = false, gridKey = "", gridT = 0, gridObs = null, saved = [];
  const sendGrid = () => {
    gridT = 0;
    if (!under || !open) return;
    const g = underGrid(), k = g.m + g.t + "," + g.b;
    if (k === gridKey) return;
    gridKey = k;
    TrailMap.layer({ key: "under", data: JSON.stringify(g) }).catch(() => {});
  };
  let gridAt = 0;
  const gridSoon = () => { if (under && !gridT) gridT = setTimeout(() => { gridAt = Date.now(); sendGrid(); }, Math.max(120, 300 - (Date.now() - gridAt))); };
  const ownMap = (n) => { const el = n && n.nodeType === 1 ? n : n && n.parentElement; return !!el && (el === mapEl || (mapEl.contains(el) && !!el.closest(".leaflet-pane") && !el.closest(".leaflet-popup-pane"))); };
  const b3 = document.getElementById("btn3d");
  let b3Was = null;
  function enterUnder() {
    if (under) return;
    under = true; gridKey = "";
    document.documentElement.classList.add("tf-under");
    // See-through from the flat map up to the page: each holder's own background goes while the native map is under it.
    saved = [];
    for (let e = mapEl; e; e = e.parentElement) { saved.push([e, e.style.background]); e.style.background = "transparent"; }
    if (b3) {
      b3Was = { t: b3.textContent, ti: b3.title, p: b3.getAttribute("aria-pressed"), on: b3.classList.contains("on") };
      b3.textContent = "▭ 2D map"; b3.title = "Back to the flat map"; b3.setAttribute("aria-pressed", "true"); b3.classList.add("on");
    }
    gridObs = new MutationObserver((recs) => { if (recs.some((r) => !ownMap(r.target))) gridSoon(); });
    gridObs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden", "style", "open"] });
    addEventListener("resize", gridSoon);
    map.on("popupopen popupclose", gridSoon);
    document.addEventListener("transitionend", gridSoon, true);
    document.addEventListener("animationend", gridSoon, true);
    sendGrid();
  }
  function leaveUnder() {
    if (!under) return;
    under = false; clearTimeout(gridT); gridT = 0;
    if (gridObs) { gridObs.disconnect(); gridObs = null; }
    removeEventListener("resize", gridSoon);
    map.off("popupopen popupclose", gridSoon);
    document.removeEventListener("transitionend", gridSoon, true);
    document.removeEventListener("animationend", gridSoon, true);
    for (const [e, bg] of saved) e.style.background = bg;
    saved = [];
    document.documentElement.classList.remove("tf-under");
    if (b3 && b3Was) {
      b3.textContent = b3Was.t; b3.title = b3Was.ti; b3.setAttribute("aria-pressed", b3Was.p || "false"); b3.classList.toggle("on", b3Was.on);
      b3Was = null;
    }
  }
  {
    const css = document.createElement("style");
    // The flat map's drawing hides; its popups (a pin's card) stay, opened where the finger tapped (the "tap" event).
    css.textContent = "html.tf-under #map .leaflet-pane:not(.leaflet-map-pane):not(.leaflet-popup-pane), html.tf-under #map .leaflet-control-attribution { visibility: hidden !important; }";
    document.head.append(css);
  }
  // This page's map moved by itself (a search, a card, My location): the native map goes there too.
  map.on("moveend", () => {
    if (!under || !open || following || Date.now() < quietUntil) return;
    const c = map.getCenter();
    // Only a real move: the flat map follows the native one at whole zooms (up to its own deepest), and a resize nudges it.
    if (nativeAt && Math.abs(map.getZoom() - (nativeAt.fz != null ? nativeAt.fz : nativeAt.zoom + 1)) < 0.75 &&
        map.latLngToContainerPoint([nativeAt.lat, nativeAt.lon]).distanceTo(map.latLngToContainerPoint(c)) < 40) return;
    nativeAt = { lat: c.lat, lon: c.lng, zoom: map.getZoom() - 1, fz: map.getZoom() };
    TrailMap.layer({ key: "under", data: JSON.stringify({ cam: { lat: c.lat, lon: c.lng, zoom: map.getZoom() - 1 } }) }).catch(() => {});
  });
  // The map style: Layers' pick, or a new sport's own (Skiing's Winter), goes to the native map.
  const baseFor = (sel) => {
    const winter = document.body.classList.contains("sport-ski");
    return sel === "advtopo" ? "vector" : winter && /^(sat|sathybrid|winter)$/.test(sel) ? "winter" : sel;
  };
  window.addEventListener("tf:sport", () => {
    if (!under || !open) return;
    const sel = (document.getElementById("basemap") || {}).value || "osm";
    setTimeout(() => { if (under && open) TrailMap.layer({ key: "base", data: baseFor((document.getElementById("basemap") || {}).value || sel) }).catch(() => {}); }, 0);
  });

  function openNative(threeD) {
    const close = document.getElementById("lmClose");
    if (close) close.click();
    const c = map.getCenter(), sel = (document.getElementById("basemap") || {}).value || "osm";
    open = true; open3d = threeD; nativeAt = { lat: c.lat, lon: c.lng, zoom: map.getZoom() - 1 };
    // winter: Skiing's own Winter map in native 3D (alex 2026-11-20), never in other sports. Older app builds ignore it.
    const winter = threeD && document.body.classList.contains("sport-ski");
    // Skiing's 3D is always Winter when the flat map shows photos or Winter (alex 2026-11-21: "it should be winter",
    // "winter should always be by default in skiing"), as on the web 3D map, whatever was picked on an earlier visit;
    // Map and Topo picked in Skiing stay those maps. The native map has no ADV topo: its closest is "vector".
    const base = baseFor(sel);
    // The photo address with the app's own Esri key (map3d.js), and the page's language for place names (native 3D).
    const esri = window.tfEsriPhoto ? window.tfEsriPhoto() : null, lang = window.tfLang && window.tfLang.lang === "fr" ? "fr" : "en";
    const snap = snapshot();
    sent = keyOf(snap);
    // Under the page on a build that can (above); older builds don't know "under" and open over the page. alex only for
    // its first build (no iPhone to try it on before): everyone once alex has checked it on the phone.
    const und = threeD && isAdmin() && !!nativeKeys && nativeKeys.has("under") ? JSON.stringify(underGrid()) : undefined;
    return TrailMap.open({ lat: c.lat, lon: c.lng, zoom: map.getZoom() - 1, bearing: map.getBearing ? -map.getBearing() : 0, base, threeD, winter, layers: featureData(threeD), esri, lang, ...(und ? { under: und } : {}), ...snap })
      .then((r) => { if (und && open && r && r.under) enterUnder(); return true; }, () => { open = false; sent = ""; return false; });
  }
  btn.addEventListener("click", () => openNative(false));
  btn3d.addEventListener("click", () => openNative(true));

  // ---------- the map's 3D button opens native 3D (alex only, see the top) ----------
  const tf = (k, d) => { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const pressed = (id) => { const b = document.getElementById(id); return !!b && !b.hidden && b.getAttribute("aria-pressed") === "true"; };
  const GROUND = ["slope", "aspect", "flats", "elev", "fresh", "snowfc1", "snowfc2", "snowfc"];   // winter.js GROUND, but avalanche
  const HUNT_WEB = ["land", "lots", "reach", "forest", "burns", "cut", "wet", "slope", "aspect"];   // a hunting.js from before tfHunt.web3d
  // The ground layers (native-ground.js: elevation lines, sun and shade, Skiing's ground colours, Hunting's slope angle and
  // aspect) open in native 3D once this phone's app build has shown it draws them ("tf-native-ground", set the first
  // time a native 3D map with them opens); older builds keep the web 3D map for them.
  const groundNative = () => { try { return localStorage.getItem("tf-native-ground") === "1"; } catch { return false; } };
  const avyNative = () => { try { return localStorage.getItem("tf-native-avy") === "1"; } catch { return false; } };
  // Hunting's picture layers the same way ("tf-native-huntpics": NativeHunting.swift says "huntPics" in any sport's native 3D).
  const huntPicsNative = () => { try { return localStorage.getItem("tf-native-huntpics") === "1"; } catch { return false; } };
  TrailMap.addListener("huntPics", () => { try { localStorage.setItem("tf-native-huntpics", "1"); } catch {} });   // here: hunting.js may not be loaded yet
  const webOnly = () => {
    if (fullNative()) return false;   // every layer is drawn natively on this build
    // Avalanche: native 3D only once this phone's build has shown its avalanche card (native-avalanche.js, "tf-native-avy").
    if ((tf("avy", false) === true || pressed("avyBtn")) && !(groundNative() && avyNative())) return true;
    const ground = groundNative();
    if (!ground && ["contourBtn", "shadeBtn"].some(pressed)) return true;
    // Hunting: what this build can't draw opens the web 3D map (hunting.js tfHunt.web3d; NativeHunting.swift and
    // native-ground.js draw the rest). Not stored yet = Hunting's first-time set (zones, parks, scent cone): all native.
    if (document.body.classList.contains("sport-hunt")) {
      const hunt = tf("huntLayers2", null);
      if (window.tfHunt && window.tfHunt.web3d) { if (window.tfHunt.web3d(ground, huntPicsNative())) return true; }
      else if (Array.isArray(hunt) && hunt.some((k) => HUNT_WEB.filter((x) => !ground || (x !== "slope" && x !== "aspect")).includes(k))) return true;
    }
    if (ground || !document.body.classList.contains("sport-ski")) return false;
    const shown = tf("skiLayers2", null);
    return Array.isArray(shown) && shown.some((k) => GROUND.includes(k));
  };
  // Another script showing something in 3D (a ski tour's Flyover, native-flyover.js) asks here first: native 3D opens
  // at { lat, lon, zoom } (MapLibre's zoom) where the 3D button would open it, and the answer is a promise of true once
  // it's open; false (now, or if it couldn't open) means the web 3D map is the one (not alex, a web-only layer on,
  // already in 3D).
  // Android (android-app/plugins/TrailMap, alex 2026-11-21): its native 3D is built up feature by feature, so the 3D
  // button opens it only once that build draws every feature this page sends to native 3D (TrailMap.features); until
  // then the web 3D map opens as before and nothing goes missing, and "Native 3D (test)" in Layers opens it to try.
  const drawsAll = () => !android || (!!nativeKeys && [...feats.keys()].every((k) => nativeKeys.has(k)));
  window.tfNative.view = (at) => {
    if (open || !nativeOn() || map.getContainer().classList.contains("is3d") || !drawsAll() || webOnly()) return Promise.resolve(false);
    if (at && isFinite(at.lat) && isFinite(at.lon)) map.setView([at.lat, at.lon], Math.round((at.zoom || 13) + 1), { animate: false });
    return openNative(true);
  };
  // map3d.js asks here before it builds the web 3D map (set3d). On a full native build it never does: a tap on 3D, a
  // tilt, a tour or route that wants 3D, another script clicking 3D all open native 3D instead; the 3D a sport opens on
  // by itself (Skiing, or the app reopening in 3D) stays on the flat map, one tap away (native 3D covers the whole
  // screen). While this build's keys aren't known yet (a moment after the app opens), the 3D a sport opens on waits
  // for them: retry() asks again.
  // Never the web 3D map on a full native build (alex 2026-11-21, after an update seemed to bring back an old version:
  // "I don't want that to happen again"), not even when the native screen can't open: the flat map stays, with a note.
  // The phone test fails if any way into 3D builds the web 3D map here (scripts/phone-test.mjs, "App builds").
  const native3d = () => openNative(true).then((ok) => { if (!ok && window.tfToast) window.tfToast("3D didn't open. Try again in a moment."); return ok; });
  window.tfNative3d = {
    claim(auto, retry) {
      if (!ios) return false;
      if (!nativeKeys) { if (typeof retry === "function") keysWait.push(retry); return true; }
      if (!fullNative() || webOnly()) return false;
      if (!auto && !open) native3d();
      return true;
    },
  };
  const map3d = document.getElementById("btn3d");
  if (map3d) map3d.addEventListener("click", (e) => {
    // Only a real tap, going from the flat map into 3D: another script's click goes to map3d.js's set3d, which asks
    // claim() above (native 3D on a full native build, the web 3D map on older builds).
    if (open && under) {   // "2D map" over native 3D under the page: a tap goes back to the flat map
      e.stopImmediatePropagation(); e.preventDefault();
      if (e.isTrusted) TrailMap.close().catch(() => {});
      return;
    }
    if (!e.isTrusted || open || !nativeOn() || map.getContainer().classList.contains("is3d") || !drawsAll() || webOnly()) return;
    e.stopImmediatePropagation(); e.preventDefault();
    native3d();
  }, true);
  // "Layers" on the native 3D screen (builds from 2026-11-21): the page's own Layers over it; the native screen steps
  // aside while Layers is open (native-tools.js "cover") and comes back as it was, with the map style picked there. If
  // something now on can only be drawn by the web 3D map, the web 3D map takes over (nothing goes missing).
  let toWeb = false, layersWatch = null, layersPick = null;
  const lmenu = document.getElementById("layersMenu");
  TrailMap.addListener("layers", () => {
    const lb = document.getElementById("layersBtn");
    // Only with the page side that steps the screen aside (native-tools.js "tools"); otherwise no answer, and the
    // screen goes the old way after 1.5 s (the web 3D map with its Layers).
    if (!open || !open3d || !lb || !lmenu || !feats.has("tools")) return;
    TrailMap.layer({ key: "layers", data: "ok" }).catch(() => {});   // answered: the screen waits for the step aside
    watchLayers();
    if (lmenu.hidden) lb.click();
    window.tfNative.send("tools");   // steps aside now, not at the next look
  });
  // While Layers is open over native 3D: the style picked there goes to the native map once it closes, and a layer only
  // the web 3D map draws (older builds) hands over to it. Over native 3D under the page (enterUnder), the page's own
  // Layers button opens it, with nothing to step aside.
  function watchLayers() {
    const base0 = (document.getElementById("basemap") || {}).value;
    // A style tapped in Layers goes to the native map even when the flat map was on it already: Skiing's native 3D shows
    // Winter over a Satellite flat map, and Satellite tapped there must show Satellite.
    const tiles = document.getElementById("lmTiles");
    let picked = null;
    if (tiles && layersPick) tiles.removeEventListener("click", layersPick);
    layersPick = (e) => { const b = e.target.closest("[data-base]"); if (b) picked = b.dataset.base; };
    if (tiles) tiles.addEventListener("click", layersPick);
    if (layersWatch) layersWatch.disconnect();
    layersWatch = new MutationObserver(() => {
      if (!lmenu.hidden) return;
      layersWatch.disconnect(); layersWatch = null;
      if (tiles) tiles.removeEventListener("click", layersPick);
      layersPick = null;
      if (!open) return;
      if (webOnly()) { toWeb = true; TrailMap.close().catch(() => { toWeb = false; }); return; }
      const base = (document.getElementById("basemap") || {}).value;
      if (base && (picked || base !== base0)) TrailMap.layer({ key: "base", data: base }).catch(() => {});
    });
    layersWatch.observe(lmenu, { attributes: true, attributeFilter: ["hidden"] });
  }
  // The page's My location over native 3D under it: the native map follows you, as its own Me button did.
  const locBtn = document.getElementById("locate");
  if (locBtn) locBtn.addEventListener("click", (e) => {
    if (!open || !under) return;
    e.stopImmediatePropagation(); e.preventDefault();
    TrailMap.layer({ key: "under", data: JSON.stringify({ me: true }) }).catch(() => {});
  }, true);
  const lbtn = document.getElementById("layersBtn");
  if (lbtn && lmenu) lbtn.addEventListener("click", () => { if (open && under) setTimeout(() => { if (open && under && !lmenu.hidden) watchLayers(); }, 0); });
  // "Layers" on an older native 3D screen: the web 3D map here, with its Layers open.
  TrailMap.addListener("closed", (e) => {
    if (toWeb) { toWeb = false; if (map3d && !map.getContainer().classList.contains("is3d")) map3d.click(); return; }
    if (!e.layers || !map3d) return;
    if (fullNative()) { const lb = document.getElementById("layersBtn"); if (lb && lmenu && lmenu.hidden) lb.click(); return; }   // no web 3D here
    if (!map.getContainer().classList.contains("is3d")) map3d.click();
    const layers = document.getElementById("layersBtn");
    if (layers) setTimeout(() => { if (!lmenu || lmenu.hidden) layers.click(); }, 600);
  });
})();
