// 3D view for the trail finder: the "⛰ 3D" button swaps the map for satellite photos over real terrain,
// like changing the map layer. Everything else (search panel, tabs, filters, trail details) stays the same,
// because this view draws whatever the 2D map is showing: it copies the Leaflet trail lines, colours and
// dashes, and passes taps back to them. No API key: MapLibre GL, Esri World Imagery, Mapterhorn + AWS terrain, OpenFreeMap names.
(() => {
  "use strict";
  const map = window.tfLeaflet, btn = document.getElementById("btn3d");
  if (!map || !btn || !window.L) return;
  const LIB = "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl";
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {   // "tf:setting" tells account.js (optional sign-in) to save settings to the rider's account
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };

  const LINE_SCALE = 1.15;    // trails a little bolder than in 2D, so they read against the photos
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
      lines.push({ type: "Feature", geometry, properties: { c: o.color, w: o.weight * LINE_SCALE, o: o.opacity, k: order, d: o.dashArray ? dashKey(o.dashArray, o.weight) : "" } });
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

  // ---------- terrain heights ----------
  // Mapterhorn (free, open) has 2 m lidar heights for much of BC and 30 m everywhere else, as 512 px
  // Terrarium tiles. Where it has no tile at a zoom (outside the lidar areas) or can't be reached,
  // the same spot comes from AWS Terrain Tiles (four 256 px tiles one zoom deeper, stitched), or
  // else from the parent tile, enlarged. Both use the Terrarium colour code, so they mix freely.
  const MAPTERHORN = (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`;
  const AWS = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const missing = new Set();    // Mapterhorn tiles that don't exist; their children don't either
  const isMissing = (z, x, y) => { for (; z >= 0; z--, x >>= 1, y >>= 1) if (missing.has(`${z}/${x}/${y}`)) return true; return false; };
  async function image(url, signal) {
    const r = await fetch(url, { signal });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return createImageBitmap(await r.blob());
  }
  async function demTile(z, x, y, signal) {
    if (!isMissing(z, x, y)) {
      try { return await image(MAPTERHORN(z, x, y), signal); }
      catch (e) { if (signal.aborted) throw e; if (e.status === 404 || e.status === 204) missing.add(`${z}/${x}/${y}`); }
    }
    const cv = new OffscreenCanvas(512, 512), cx = cv.getContext("2d");
    cx.imageSmoothingEnabled = false;   // blending pixels would scramble the colour-coded heights
    if (z + 1 <= 15) {
      try {
        const parts = await Promise.all([[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => image(AWS(z + 1, 2 * x + dx, 2 * y + dy), signal)));
        parts.forEach((b, i) => cx.drawImage(b, (i % 2) * 256, (i >> 1) * 256));
        return cv;
      } catch (e) { if (signal.aborted) throw e; }
    }
    if (z === 0) throw new Error("no terrain");
    const parent = await demTile(z - 1, x >> 1, y >> 1, signal), size = parent.width / 2;
    cx.drawImage(parent, (x % 2) * size, (y % 2) * size, size, size, 0, 0, 512, 512);
    return cv;
  }
  let demProtocol = false;
  function addDemProtocol() {
    if (demProtocol) return;
    demProtocol = true;
    maplibregl.addProtocol("tfdem", async (params, abort) => {
      const [z, x, y] = params.url.replace("tfdem://", "").split("/").map(Number);
      if (!isMissing(z, x, y)) {   // the usual case: Mapterhorn's own tile, passed on as it is
        const r = await fetch(MAPTERHORN(z, x, y), { signal: abort.signal }).catch((e) => { if (abort.signal.aborted) throw e; return null; });
        if (r && r.ok) return { data: await r.arrayBuffer() };
        if (r && (r.status === 404 || r.status === 204)) missing.add(`${z}/${x}/${y}`);
      }
      let t = await demTile(z, x, y, abort.signal);
      if (!(t instanceof OffscreenCanvas)) { const cv = new OffscreenCanvas(t.width, t.height); cv.getContext("2d").drawImage(t, 0, 0); t = cv; }
      return { data: await (await t.convertToBlob({ type: "image/png" })).arrayBuffer() };
    });
  }

  // ---------- the 3D map ----------
  function build() {
    box = document.createElement("div");
    box.id = "map3d";
    map.getContainer().append(box);   // inside the Leaflet map, under its controls (map key, clear button)
    // Gestures here belong to the 3D map, not to the Leaflet map underneath.
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    ["pointerdown", "touchstart", "contextmenu", "keydown"].forEach((t) => box.addEventListener(t, (e) => e.stopPropagation()));

    addDemProtocol();
    const c = map.getCenter();
    gl = new maplibregl.Map({
      container: box, antialias: true, center: [c.lng, c.lat], zoom: map.getZoom() - 1, pitch: 60, bearing: -15, maxPitch: 85,
      attributionControl: { compact: true },
      style: {
        version: 8,
        glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
        sources: {
          // Sentinel-2 cloudless (EOX, free): a newer yearly mosaic of the whole region, but 10 m pixels, so blurrier.
          s2: { type: "raster", tileSize: 256, maxzoom: 15, tiles: ["https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg"],
            attribution: "<a href=\"https://s2maps.eu\">Sentinel-2 cloudless 2023</a> by EOX (Copernicus Sentinel data 2023)" },
          // Winter: real snow cover from NASA's daily MODIS satellite (free, no key), two days back because
          // NASA posts it with a delay. 500 m pixels, so it is drawn as a white wash over the sharp photos.
          snow: { type: "raster", tileSize: 256, maxzoom: 8, tiles: ["https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDSI_Snow_Cover/default/"
            + new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10) + "/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png"],
            attribution: "Snow cover: <a href=\"https://earthdata.nasa.gov/gibs\">NASA GIBS</a> MODIS Terra" },
          sat: { type: "raster", tileSize: 256, maxzoom: 19, tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            attribution: "Imagery © Esri, Maxar, Earthstar Geographics" },
          // Sharp place, peak and lake names from OpenFreeMap (free, no key), instead of blurry label pictures.
          names: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "<a href=\"https://openfreemap.org\">OpenFreeMap</a>" },
          dem: { type: "raster-dem", encoding: "terrarium", tileSize: 512, maxzoom: 16, tiles: ["tfdem://{z}/{x}/{y}"],
            attribution: "Terrain: <a href=\"https://mapterhorn.com/attribution\">© Mapterhorn</a>, <a href=\"https://registry.opendata.aws/terrain-tiles/\">Mapzen Terrain Tiles</a>" },
          lines: { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: "Trails © <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors" },
          dots: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          hits: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          { id: "s2", type: "raster", source: "s2", layout: { visibility: "none" } },
          { id: "sat", type: "raster", source: "sat", paint: { "raster-contrast": 0.08, "raster-saturation": 0.12, "raster-brightness-min": 0.02 } },
          // Every road, track and path from the basemap (OpenStreetMap via OpenFreeMap), under the trail lines.
          { id: "snow", type: "raster", source: "snow", layout: { visibility: "none" },
            paint: { "raster-saturation": -1, "raster-brightness-min": 0.9, "raster-opacity": 0.72, "raster-resampling": "linear" } },
          { id: "osm-roads", type: "line", source: "names", "source-layer": "transportation", minzoom: 9,
            filter: ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track"]]],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": ["match", ["get", "class"], "track", "#c9a77a", "#f2efe6"], "line-opacity": 0.8,
              "line-width": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 2, 0.6], 15, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 5, "track", 1.6, 2.2]] } },
          { id: "osm-paths", type: "line", source: "names", "source-layer": "transportation", minzoom: 11.5,
            filter: ["==", ["get", "class"], "path"],
            paint: { "line-color": "#fff6e0", "line-opacity": 0.75, "line-dasharray": [2, 1.5],
              "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 16, 1.6] } },
          { id: "lines", type: "line", source: "lines", filter: ["==", ["get", "d"], ""],
            layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "k"] },
            paint: { "line-color": ["get", "c"], "line-width": ["get", "w"], "line-opacity": ["get", "o"] } },
          { id: "dots", type: "circle", source: "dots",
            paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "f"], "circle-opacity": ["get", "fo"], "circle-stroke-color": ["get", "c"], "circle-stroke-width": ["get", "w"], "circle-pitch-alignment": "viewport" } },
          { id: "hits", type: "line", source: "hits", paint: { "line-color": "#000", "line-opacity": 0, "line-width": ["get", "w"] } },
          { id: "water-names", type: "symbol", source: "names", "source-layer": "water_name", minzoom: 10,
            layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Italic"], "text-size": 12 },
            paint: { "text-color": "#d4ecff", "text-halo-color": "rgba(10,30,50,.8)", "text-halo-width": 1.2 } },
          { id: "peaks", type: "symbol", source: "names", "source-layer": "mountain_peak", minzoom: 10.5, filter: ["has", "name"],
            layout: { "text-field": ["case", ["has", "ele"], ["concat", "▲ ", ["get", "name"], "\n", ["to-string", ["get", "ele"]], " m"], ["concat", "▲ ", ["get", "name"]]],
              "text-font": ["Noto Sans Regular"], "text-size": 11.5, "text-anchor": "bottom", "symbol-sort-key": ["-", 0, ["coalesce", ["get", "ele"], 0]] },
            paint: { "text-color": "#fff", "text-halo-color": "rgba(0,0,0,.75)", "text-halo-width": 1.3 } },
          { id: "towns", type: "symbol", source: "names", "source-layer": "place", filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "hamlet", "suburb", "locality"]]],
            layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"],
              "text-size": ["match", ["get", "class"], "city", 17, "town", 15, "village", 13, 11.5], "symbol-sort-key": ["match", ["get", "class"], "city", 0, "town", 1, "village", 2, 3] },
            paint: { "text-color": "#fff", "text-halo-color": "rgba(0,0,0,.8)", "text-halo-width": 1.5 } },
        ],
        // Close to real heights: more exaggeration stretches the photos on steep slopes.
        terrain: { source: "dem", exaggeration: 1.15 },
        sky: { "sky-color": "#5d9be0", "horizon-color": "#d8e6f2", "fog-color": "#c9d9e8", "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.85, "atmosphere-blend": 0.9 },
      },
    });
    // Sharper far away: keep the photos at one zoom level all the way to the horizon and allow more tiles
    // when tilted (MapLibre's default lets the far half get blurry fast). Costs more photo downloads.
    // Full sharpness only once the camera stops: while moving, a lighter setting keeps it smooth.
    const lod = (levels, ratio) => ["sat", "s2"].forEach((id) => { try { if (gl.getSource(id)) gl.setSourceTileLodParams(levels, ratio, id); } catch {} });
    let still = 0;
    gl.once("load", () => lod(1, 30));
    gl.on("movestart", () => { clearTimeout(still); lod(3, 4); });
    gl.on("moveend", () => { clearTimeout(still); still = setTimeout(() => lod(1, 30), 600); });   // 1 = the same photo detail all the way to the horizon
    window.trailMap3d = gl;   // handy for debugging in the browser console
    window.dispatchEvent(new CustomEvent("tf:map3d", { detail: gl }));   // winter.js adds its avalanche layer
    gl.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    // Summer / Winter: two clear choices. Summer = snow-free photos (tap Summer again for the newer
    // 2023 mosaic), Winter = the sharp photos with NASA's latest real snow cover painted on.
    const mk = (label) => { const el = document.createElement("button"); el.type = "button"; el.textContent = label;
      el.style.cssText = "width:auto;padding:0 10px;font:600 12px var(--font-body, system-ui)"; return el; };
    const sumBtn = mk("Summer"), winBtn = mk("Winter");
    const ski = () => document.body.classList.contains("sport-ski");
    let photos = "sharp";
    const setPhotos = (mode) => {
      photos = ["sharp", "recent", "winter"].includes(mode) ? mode : "sharp";
      const w = photos === "winter";
      gl.setLayoutProperty("s2", "visibility", photos === "recent" ? "visible" : "none");
      gl.setLayoutProperty("sat", "visibility", photos === "recent" ? "none" : "visible");
      gl.setLayoutProperty("snow", "visibility", w ? "visible" : "none");
      gl.setPaintProperty("sat", "raster-saturation", w ? -0.45 : 0.12);   // colder, greyer ground under the snow
      gl.setPaintProperty("sat", "raster-brightness-min", w ? 0.12 : 0.02);
      sumBtn.textContent = photos === "recent" ? "Summer · 2023" : "Summer";
      sumBtn.title = photos === "sharp" ? "Tap again for the newer 2023 mosaic (blurrier)" : "Snow-free sharp photos";
      winBtn.title = "Sharp photos with the latest real snow cover (NASA, 2 days old)";
      for (const [el, on] of [[sumBtn, !w], [winBtn, w]]) { el.style.background = on ? "#2f6f4f" : ""; el.style.color = on ? "#fff" : ""; }
      store.set(ski() ? "3dPhotosSki" : "3dPhotos", photos);
    };
    sumBtn.addEventListener("click", () => setPhotos(photos === "sharp" ? "recent" : "sharp"));
    winBtn.addEventListener("click", () => setPhotos("winter"));
    // MTB opens on Summer and Skiing on Winter, unless the person picked something else in that sport.
    const pick = () => setPhotos(ski() ? store.get("3dPhotosSki", "winter") : store.get("3dPhotos", "sharp"));
    new MutationObserver(pick).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    gl.addControl({ onAdd() { const d = document.createElement("div"); d.className = "maplibregl-ctrl maplibregl-ctrl-group";
      d.style.display = "flex"; d.append(sumBtn, winBtn); return d; }, onRemove() {} }, "bottom-right");
    gl.once("styledata", pick);
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
