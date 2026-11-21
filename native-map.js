// Native map (test), inside the iPhone app only, in MTB: Layers > "📱 Native map (test)" opens the trail map drawn by the
// iPhone itself (MapLibre Native, the TrailMap plugin in ios-app/plugins/TrailMap) instead of this page, to feel whether
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
  btn.title = "Try the map drawn by the iPhone itself: does it move smoother?";
  btn.textContent = "📱 Native map (test)";
  const btn3d = document.createElement("button");
  btn3d.type = "button"; btn3d.id = "native3dBtn";
  btn3d.title = "Try the 3D map drawn by the iPhone itself (photos and trails only): does it turn and tilt smoother?";
  btn3d.textContent = "Native 3D (test)";
  tools.after(btn, btn3d);
  const adminNow = () => { try { return localStorage.getItem("tf-admin") === "1"; } catch { return false; } };
  btn.hidden = btn3d.hidden = !adminNow();
  window.addEventListener("tf:admin", () => { btn.hidden = btn3d.hidden = !adminNow(); });
  const css = document.createElement("style");
  css.textContent = "body.sport-alt #nativeMapBtn, #nativeMapBtn[hidden], #native3dBtn[hidden] { display: none !important; }";   // 2D: MTB only; both alex only
  document.head.append(css);

  let open = false, hits = [], pending = 0;
  // ---------- native 3D features, one file each (ios-app/.../NativeLayers.swift) ----------
  // A feature's page side (its own native-xxx.js) registers what it sends: window.tfNative.addLayer(key, get), where
  // get() returns its data as text (or null for nothing); it's sent with the 3D screen's opening, and again with
  // window.tfNative.send(key) whenever it changes while the screen is open. Load those files after this one, and guard
  // the call (window.tfNative && window.tfNative.addLayer) so an older cached copy of this file can't break them.
  // A sport whose data lives inside its own file registers from there instead (hunting.js: "hunt").
  const feats = new Map();
  let open3d = false;
  const featureData = (threeD) => {
    const out = {};
    if (!threeD) return out;
    for (const [k, get] of feats) { try { const d = get(); if (d != null) out[k] = String(d); } catch {} }
    return out;
  };
  window.tfNative = {
    addLayer(key, get) { if (typeof get === "function") feats.set(String(key), get); },
    send(key) {
      const get = feats.get(String(key));
      if (!open || !open3d || !get || !TrailMap.layer) return;
      let d = null; try { d = get(); } catch {}
      if (d != null) TrailMap.layer({ key: String(key), data: String(d) }).catch(() => {});
    },
    isOpen: () => open && open3d,
    // For a feature that talks with its native side (native-ground.js): its events from the 3D screen, and data sent
    // without waiting for its get().
    on(name, fn) { TrailMap.addListener(String(name), fn); },
    post(key, data) { if (open && open3d && TrailMap.layer) TrailMap.layer({ key: String(key), data: String(data) }).catch(() => {}); },
    // "Details" on a feature's own card (one it showed with open -1, at its own spot): fn({ tapLat, tapLon }) opens
    // it on the page and returns true; otherwise the page opens what's at that spot, as for a trail.
    onDetails(fn) { if (typeof fn === "function") details.push(fn); },
    // has(key): this app build draws that feature itself (TrailMap.features; older builds have no such call).
    has: (key) => !!nativeKeys && nativeKeys.has(String(key)),
    // moveWait(ms): how long the page waits after the native map moves before sending the trails again (500 ms); a
    // Flyover moves it every second, so it waits longer meanwhile. Nothing: back to 500.
    moveWait(ms) { moveWait = ms > 0 ? ms : 500; },
  };
  const details = [];
  let nativeKeys = null, moveWait = 500;
  try { Promise.resolve(TrailMap.features()).then((r) => { nativeKeys = new Set((r && r.keys) || []); }, () => { nativeKeys = new Set(); }); } catch { nativeKeys = new Set(); }
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
      if (!(l instanceof L.Path) || paneHidden(l.options)) return;
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

  // Trails come and go on the flat map as it follows (zones loading, names redrawn): sent once it settles.
  function send() { pending = 0; if (open) TrailMap.update(snapshot()).catch(() => {}); }
  const later = (ms) => { if (open) { clearTimeout(pending); pending = setTimeout(send, ms); } };
  map.on("layeradd layerremove", (e) => { if (e.layer instanceof L.Path) later(400); });

  // MapLibre's zoom is one less than Leaflet's (512 px tiles against 256).
  const follow = (e) => map.setView([e.lat, e.lon], Math.max(3, Math.round(e.zoom + 1)), { animate: false });
  TrailMap.addListener("moved", (e) => { if (!open) return; follow(e); later(moveWait); });
  TrailMap.addListener("closed", (e) => {
    open = false; clearTimeout(pending); moveWait = 500;
    follow(e);
    if (map.setBearing) { map.setBearing(-(e.bearing || 0)); map.fire("rotateend"); }
    if (!e.details) return;
    if (!(e.open >= 0)) for (const fn of details) { try { if (fn(e)) return; } catch {} }
    // "Details" on a trail's card: the trail opens as if tapped there (most trails are found by the map's own tap).
    const latlng = L.latLng(e.tapLat, e.tapLon), l = e.open >= 0 && hits[e.open];
    if (l) l.fire("click", { latlng });
    else map.fire("click", { latlng, layerPoint: map.latLngToLayerPoint(latlng), containerPoint: map.latLngToContainerPoint(latlng) });
  });

  function openNative(threeD) {
    const close = document.getElementById("lmClose");
    if (close) close.click();
    const c = map.getCenter(), sel = (document.getElementById("basemap") || {}).value || "osm", base = sel === "advtopo" ? "vector" : sel;   // the native map has no ADV topo: its closest
    open = true; open3d = threeD;
    // winter: Skiing's own Winter map in native 3D (alex 2026-11-20), never in other sports. Older app builds ignore it.
    const winter = threeD && document.body.classList.contains("sport-ski");
    // The photo address with the app's own Esri key (map3d.js), and the page's language for place names (native 3D).
    const esri = window.tfEsriPhoto ? window.tfEsriPhoto() : null, lang = window.tfLang && window.tfLang.lang === "fr" ? "fr" : "en";
    return TrailMap.open({ lat: c.lat, lon: c.lng, zoom: map.getZoom() - 1, bearing: map.getBearing ? -map.getBearing() : 0, base, threeD, winter, layers: featureData(threeD), esri, lang, ...snapshot() })
      .then(() => true, () => { open = false; return false; });
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
  // Hunting's picture layers the same way ("tf-native-huntpics": NativeHunting.swift says "huntPics" in any sport's native 3D).
  const huntPicsNative = () => { try { return localStorage.getItem("tf-native-huntpics") === "1"; } catch { return false; } };
  TrailMap.addListener("huntPics", () => { try { localStorage.setItem("tf-native-huntpics", "1"); } catch {} });   // here: hunting.js may not be loaded yet
  const webOnly = () => {
    if (tf("avy", false) === true || pressed("avyBtn")) return true;   // avalanche stays in the web 3D map (its own step)
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
  window.tfNative.view = (at) => {
    if (open || !adminNow() || map.getContainer().classList.contains("is3d") || webOnly()) return Promise.resolve(false);
    if (at && isFinite(at.lat) && isFinite(at.lon)) map.setView([at.lat, at.lon], Math.round((at.zoom || 13) + 1), { animate: false });
    return openNative(true);
  };
  const map3d = document.getElementById("btn3d");
  if (map3d) map3d.addEventListener("click", (e) => {
    // Only a real tap, going from the flat map into 3D: other scripts click this button to open the web 3D map.
    if (!e.isTrusted || open || !adminNow() || map.getContainer().classList.contains("is3d") || webOnly()) return;
    e.stopImmediatePropagation(); e.preventDefault();
    openNative(true);
  }, true);
  // "Layers" on the native 3D screen: the web 3D map here, with its Layers open.
  TrailMap.addListener("closed", (e) => {
    if (!e.layers || !map3d) return;
    if (!map.getContainer().classList.contains("is3d")) map3d.click();
    const layers = document.getElementById("layersBtn");
    if (layers) setTimeout(() => layers.click(), 600);
  });
})();
