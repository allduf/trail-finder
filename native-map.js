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
// 3D for looking around, unless a layer only the web 3D map draws is on (avalanche, slope angles and the other ground
// layers, elevation lines, sun and shade): then the web 3D map opens as before, so avalanche ratings are only ever
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
  const ll = (p) => [Math.round(p.lng * 1e5) / 1e5, Math.round(p.lat * 1e5) / 1e5];
  // Leaflet dashes are in pixels, MapLibre's in line widths; round-capped dots (unofficial trails) stay dots.
  const dashKey = (d, w) => {
    const n = String(d).trim().split(/[\s,]+/).map(Number);
    if (n.length === 2 && n[0] <= 1) return "0," + Math.max(0.1, (n[0] + n[1]) / Math.max(w, 1)).toFixed(2);
    return n.map((x) => Math.max(0.1, x / Math.max(w, 1)).toFixed(2)).join(",");
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
        properties: { ...props, c: o.color, w: o.weight || 3, o: o.opacity, d } });
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
  TrailMap.addListener("moved", (e) => { if (!open) return; follow(e); later(500); });
  TrailMap.addListener("closed", (e) => {
    open = false; clearTimeout(pending);
    follow(e);
    if (map.setBearing) { map.setBearing(-(e.bearing || 0)); map.fire("rotateend"); }
    if (!e.details) return;
    // "Details" on a trail's card: the trail opens as if tapped there (most trails are found by the map's own tap).
    const latlng = L.latLng(e.tapLat, e.tapLon), l = e.open >= 0 && hits[e.open];
    if (l) l.fire("click", { latlng });
    else map.fire("click", { latlng, layerPoint: map.latLngToLayerPoint(latlng), containerPoint: map.latLngToContainerPoint(latlng) });
  });

  function openNative(threeD) {
    const close = document.getElementById("lmClose");
    if (close) close.click();
    const c = map.getCenter(), sel = (document.getElementById("basemap") || {}).value || "osm", base = sel === "advtopo" ? "vector" : sel;   // the native map has no ADV topo: its closest
    open = true;
    // winter: Skiing's own Winter map in native 3D (alex 2026-11-20), never in other sports. Older app builds ignore it.
    const winter = threeD && document.body.classList.contains("sport-ski");
    TrailMap.open({ lat: c.lat, lon: c.lng, zoom: map.getZoom() - 1, bearing: map.getBearing ? -map.getBearing() : 0, base, threeD, winter, ...snapshot() })
      .catch(() => { open = false; });
  }
  btn.addEventListener("click", () => openNative(false));
  btn3d.addEventListener("click", () => openNative(true));

  // ---------- the map's 3D button opens native 3D (alex only, see the top) ----------
  const tf = (k, d) => { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const pressed = (id) => { const b = document.getElementById(id); return !!b && !b.hidden && b.getAttribute("aria-pressed") === "true"; };
  const GROUND = ["avy", "slope", "aspect", "flats", "elev", "fresh", "snowfc1", "snowfc2", "snowfc"];   // winter.js GROUND
  const webOnly = () => {
    if (tf("avy", false) === true || ["avyBtn", "contourBtn", "shadeBtn"].some(pressed)) return true;
    if (!document.body.classList.contains("sport-ski")) return false;
    const shown = tf("skiLayers2", null);
    return Array.isArray(shown) && shown.some((k) => GROUND.includes(k));
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
