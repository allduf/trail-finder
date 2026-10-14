// 3D view for the trail finder: the "⛰ 3D" button swaps the map for satellite photos over real terrain,
// like changing the map layer. Everything else (search panel, tabs, filters, trail details) stays the same,
// because this view draws whatever the 2D map is showing: it copies the Leaflet trail lines, colours and
// dashes, and passes taps back to them. No API key: MapLibre GL, Esri World Imagery, AWS Terrain Tiles.
(() => {
  "use strict";
  const map = window.tfLeaflet, btn = document.getElementById("btn3d");
  if (!map || !btn || !window.L) return;
  const LIB = "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl";
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("tf:" + k, JSON.stringify(v)); } catch {} },
  };

  let on = false, gl = null, box = null, libLoading = null;
  let hits = [];              // Leaflet layers that react to clicks, by index (the "id" of the 3D hit lines)
  let dashLayers = new Set(); // dashed line layers made so far, one per dash pattern
  let drawn = false;          // trails copied at least once
  let syncing = 0;            // >0 while one map is moving the other, so the moves don't echo back

  const css = document.createElement("style");
  css.textContent = `
#map3d { position: absolute; inset: 0; z-index: 450; background: #9fb3c8; }
.mapwrap.is3d #basemap, .mapwrap.is3d #mapNote { display: none; }
#map.is3d .leaflet-pane, #map.is3d .leaflet-control-zoom, #map.is3d .leaflet-control-attribution { visibility: hidden; }
.map-tools #btn3d.on { background: var(--fg); border-color: var(--fg); color: var(--panel); }
#map3d .maplibregl-popup-content { background: var(--panel); color: var(--fg); font: 600 .85rem var(--font-body, system-ui); padding: 4px 8px; border-radius: 6px; }
#map3d .maplibregl-popup-tip { display: none; }
#map3d .maplibregl-ctrl-bottom-right { margin-bottom: 6px; }`;
  document.head.append(css);

  function loadLib() {
    if (window.maplibregl) return Promise.resolve();
    if (libLoading) return libLoading;
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = LIB + ".css";
    document.head.append(link);
    libLoading = new Promise((ok, fail) => {
      const s = document.createElement("script");
      s.src = LIB + ".js"; s.onload = ok; s.onerror = () => { libLoading = null; fail(new Error("3D map library didn't load")); };
      document.head.append(s);
    });
    return libLoading;
  }

  // ---------- copy what the 2D map shows ----------
  const ll = (p) => [p.lng, p.lat];
  function circleRing(c, m) {
    const pts = [], dLat = m / 110540, dLng = m / (111320 * Math.cos((c.lat * Math.PI) / 180));
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2 * Math.PI; pts.push([c.lng + dLng * Math.cos(a), c.lat + dLat * Math.sin(a)]); }
    return pts;
  }
  // Leaflet dashes are in pixels, MapLibre's in line widths.
  const dashKey = (d, w) => String(d).trim().split(/[\s,]+/).map((n) => Math.max(0.1, +n / Math.max(w, 1)).toFixed(2)).join(",");

  function snapshot() {
    const lines = [], dots = [], hitLines = [];
    hits = [];
    let k = 0;
    map.eachLayer((l) => {
      if (!(l instanceof L.Path)) return;
      const o = l.options, order = k++;
      if (l instanceof L.CircleMarker && !(l instanceof L.Circle)) {
        dots.push({ type: "Feature", geometry: { type: "Point", coordinates: ll(l.getLatLng()) },
          properties: { r: l.getRadius(), c: o.color, w: o.weight, f: o.fillColor || o.color, fo: o.fillOpacity, k: order } });
        return;
      }
      let parts;
      if (l instanceof L.Circle) parts = [circleRing(l.getLatLng(), l.getRadius())];
      else {
        let lls = l.getLatLngs();
        if (!lls.length) return;
        if (!Array.isArray(lls[0])) lls = [lls];
        else if (Array.isArray(lls[0][0])) lls = lls.flat();   // multi-polygons
        parts = lls.map((p) => p.map(ll));
        if (l instanceof L.Polygon) parts.forEach((p) => p.length && p.push(p[0]));
      }
      parts = parts.filter((p) => p.length > 1);
      if (!parts.length) return;
      const geometry = { type: "MultiLineString", coordinates: parts };
      if (o.interactive !== false && l.listens("click")) {
        hits.push(l);
        hitLines.push({ type: "Feature", geometry, properties: { i: hits.length - 1, w: Math.max(o.weight || 3, 14) } });
      }
      if (!o.stroke || !(o.opacity > 0)) return;
      lines.push({ type: "Feature", geometry, properties: { c: o.color, w: o.weight, o: o.opacity, k: order, d: o.dashArray ? dashKey(o.dashArray, o.weight) : "" } });
    });
    return { lines, dots, hitLines };
  }

  function ensureDashLayer(d) {
    const id = "dash:" + d;
    if (dashLayers.has(id)) return;
    dashLayers.add(id);
    gl.addLayer({ id, type: "line", source: "lines", filter: ["==", ["get", "d"], d],
      layout: { "line-sort-key": ["get", "k"] },
      paint: { "line-color": ["get", "c"], "line-width": ["get", "w"], "line-opacity": ["get", "o"], "line-dasharray": d.split(",").map(Number) } }, "dots");
  }

  let pending = 0;
  function scheduleSync() { if (on && !pending) pending = setTimeout(syncData, 80); }
  function syncData() {
    pending = 0;
    if (!on || !gl || !gl.getSource("lines")) return;
    const s = snapshot();
    new Set(s.lines.map((f) => f.properties.d).filter(Boolean)).forEach(ensureDashLayer);
    gl.getSource("lines").setData({ type: "FeatureCollection", features: s.lines });
    gl.getSource("dots").setData({ type: "FeatureCollection", features: s.dots });
    gl.getSource("hits").setData({ type: "FeatureCollection", features: s.hitLines });
    drawn = true;
  }
  map.on("layeradd layerremove", scheduleSync);
  // Selecting a trail restyles lines without adding or removing any.
  const setStyle = L.Path.prototype.setStyle;
  L.Path.prototype.setStyle = function (style) { const r = setStyle.call(this, style); scheduleSync(); return r; };

  // ---------- keep the two cameras together ----------
  // MapLibre zoom levels are one less than Leaflet's (512 px tiles against 256 px).
  function from2d() {
    if (!gl || syncing) return;
    syncing++;
    const c = map.getCenter();
    gl.flyTo({ center: [c.lng, c.lat], zoom: map.getZoom() - 1, duration: 1200 });
    setTimeout(() => syncing--, 1300);
  }
  function to2d() {
    if (!gl || syncing) return;
    syncing++;
    const c = gl.getCenter();
    map.setView([c.lat, c.lng], Math.round(gl.getZoom() + 1), { animate: false });
    setTimeout(() => syncing--, 0);
  }
  map.on("moveend", () => { if (on) from2d(); });

  // ---------- the 3D map ----------
  function build() {
    box = document.createElement("div");
    box.id = "map3d";
    map.getContainer().append(box);   // inside the Leaflet map, under its controls (map key, clear button)
    // Gestures here belong to the 3D map, not to the Leaflet map underneath.
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    ["pointerdown", "touchstart", "contextmenu", "keydown"].forEach((t) => box.addEventListener(t, (e) => e.stopPropagation()));

    const c = map.getCenter();
    gl = new maplibregl.Map({
      container: box, center: [c.lng, c.lat], zoom: map.getZoom() - 1, pitch: 60, bearing: -15, maxPitch: 85,
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          sat: { type: "raster", tileSize: 256, maxzoom: 19, tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            attribution: "Imagery © Esri, Maxar, Earthstar Geographics" },
          places: { type: "raster", tileSize: 256, maxzoom: 19, tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"] },
          dem: { type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 15, tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
            attribution: "Terrain: <a href=\"https://registry.opendata.aws/terrain-tiles/\">Mapzen Terrain Tiles</a>" },
          lines: { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: "Trails © <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors" },
          dots: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          hits: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          { id: "sat", type: "raster", source: "sat" },
          { id: "places", type: "raster", source: "places" },
          { id: "lines", type: "line", source: "lines", filter: ["==", ["get", "d"], ""],
            layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "k"] },
            paint: { "line-color": ["get", "c"], "line-width": ["get", "w"], "line-opacity": ["get", "o"] } },
          { id: "dots", type: "circle", source: "dots",
            paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "f"], "circle-opacity": ["get", "fo"], "circle-stroke-color": ["get", "c"], "circle-stroke-width": ["get", "w"], "circle-pitch-alignment": "viewport" } },
          { id: "hits", type: "line", source: "hits", paint: { "line-color": "#000", "line-opacity": 0, "line-width": ["get", "w"] } },
        ],
        terrain: { source: "dem", exaggeration: 1.5 },
        sky: { "sky-color": "#7fb2e6", "horizon-color": "#dfeaf3", "fog-color": "#dfeaf3", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.75, "atmosphere-blend": 0.8 },
      },
    });
    window.trailMap3d = gl;   // handy for debugging in the browser console
    gl.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    // "load" waits for every first tile, and imagery that fails to load can hold it back, so the
    // trails go on as soon as the style itself is ready.
    gl.on("styledata", () => { if (!drawn && gl.getSource("lines")) scheduleSync(); });
    gl.on("moveend", (e) => { if (e.originalEvent) to2d(); });   // the person moved the 3D map
    new ResizeObserver(() => gl.resize()).observe(box);

    // Taps go to the same Leaflet trail lines (opening the same details panel); anywhere else is a
    // click on the 2D map at that spot, which looks up the nearest trail just like it does in 2D.
    const near = (p, pad) => gl.queryRenderedFeatures([[p.x - pad, p.y - pad], [p.x + pad, p.y + pad]], { layers: ["hits"] });
    const toLL = (lngLat) => L.latLng(lngLat.lat, lngLat.lng);
    gl.on("click", (e) => {
      const f = near(e.point, 8)[0], latlng = toLL(e.lngLat);
      const layer = f && hits[f.properties.i];
      if (layer) layer.fire("click", { latlng, originalEvent: e.originalEvent });
      else {
        to2d();
        map.fire("click", { latlng, layerPoint: map.latLngToLayerPoint(latlng), containerPoint: map.latLngToContainerPoint(latlng), originalEvent: e.originalEvent });
      }
    });
    const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    gl.on("mousemove", (e) => {
      const f = near(e.point, 6)[0], layer = f && hits[f.properties.i], t = layer && layer.getTooltip && layer.getTooltip();
      gl.getCanvas().style.cursor = f ? "pointer" : "";
      if (t) tip.setLngLat(e.lngLat).setHTML(String(t.getContent())).addTo(gl); else tip.remove();
    });
    gl.getCanvas().addEventListener("mouseleave", () => tip.remove());
  }

  function set3d(want) {
    if (want === on) return;
    if (want && !window.maplibregl) {
      btn.textContent = "⛰ Loading 3D…";
      loadLib().then(() => set3d(true), () => { btn.textContent = "⛰ 3D unavailable"; setTimeout(syncBtn, 3000); });
      return;
    }
    on = want; store.set("map3d", on);
    map.getContainer().classList.toggle("is3d", on);
    map.getContainer().parentElement.classList.toggle("is3d", on);   // hides the 2D map style menu
    if (on) {
      if (!gl) build();
      else { box.hidden = false; gl.resize(); const c = map.getCenter(); syncing++; gl.jumpTo({ center: [c.lng, c.lat], zoom: map.getZoom() - 1 }); syncing--; }
      syncData();
    } else if (box) box.hidden = true;
    syncBtn();
  }
  function syncBtn() {
    btn.textContent = on ? "▭ 2D map" : "⛰ 3D";
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.title = on ? "Back to the flat map" : "Satellite photos over the real mountains, with the same trails";
  }
  btn.addEventListener("click", () => set3d(!on));
  syncBtn();
  if (store.get("map3d", false)) set3d(true);
})();
