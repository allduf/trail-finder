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
    // A trail's details are open: the other trail lines fade, as in 2D.
    const focus = map.getContainer().classList.contains("trail-focus");
    const faded = (o) => focus && o.renderer && /^(allTrails|boxTrails)$/.test(o.renderer.options.pane);
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
      lines.push({ type: "Feature", geometry, properties: { c: o.color, w: o.weight * LINE_SCALE, o: faded(o) ? o.opacity * 0.25 : o.opacity, k: order, d: o.dashArray ? dashKey(o.dashArray, o.weight) : "" } });
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
  map.on("layeradd layerremove trailfocus", scheduleSync);
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

  // ---------- winter photos ----------
  // tfwinter://full|live/z/x/y draws snow into the sharp Esri photo itself, pixel by pixel, so the
  // photo's texture stays. Where the snow goes: "full" = everything above a mid-winter snow line
  // (fading in from 300 m to 800 m), "live" = NASA's latest MODIS snow map. Then, like real winter
  // photos: open ground, clearings and alpine go white, dark conifer forest keeps its trees with only a
  // dusting, and cliffs too steep to hold snow stay rock. The hillshade layer adds the relief.
  const ESRI = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  const LIVE_DAY = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);   // NASA posts with a delay
  const NASA_SNOW = (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDSI_Snow_Cover/default/${LIVE_DAY}/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;
  const cache = new Map();   // a few recent height / snow-map tiles, shared by neighbouring photo tiles
  function cached(key, make) {
    if (!cache.has(key)) { const p = make(); cache.set(key, p); p.catch(() => cache.delete(key)); if (cache.size > 48) cache.delete(cache.keys().next().value); }
    return cache.get(key);
  }
  const pixels = (img) => { const cv = new OffscreenCanvas(img.width, img.height), cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0); return cx.getImageData(0, 0, img.width, img.height); };
  // The part of an ancestor tile (zoom pz) that lies under tile z/x/y, as [data, left, top, size].
  const under = async (pz, z, x, y, get) => {
    const k = z - pz, img = await get(pz, x >> k, y >> k), n = 1 << k, size = img.width / n;
    return [img, (x % n) * size, (y % n) * size, size];
  };
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  let winterProtocol = false;
  function addWinterProtocol() {
    if (winterProtocol) return;
    winterProtocol = true;
    maplibregl.addProtocol("tfwinter", async (params, abort) => {
      const [mode, zs, xs, ys] = params.url.replace("tfwinter://", "").split("/"), z = +zs, x = +xs, y = +ys, sig = abort.signal;
      const photo = pixels(await image(ESRI(z, x, y), sig)), W = photo.width, P = photo.data;
      const dz = Math.min(z, 13);
      const [dem, dl, dt, ds] = await under(dz, z, x, y, (a, b, c) => cached(`d${a}/${b}/${c}`, () => demTile(a, b, c, new AbortController().signal).then(pixels)));
      let live = null;
      if (mode === "live") live = await under(Math.min(z, 8), z, x, y, (a, b, c) => cached(`s${a}/${b}/${c}`, () => image(NASA_SNOW(a, b, c), new AbortController().signal).then(pixels))).catch(() => null);
      const D = dem.data, DW = dem.width, h = (px, py) => {
        px = Math.min(DW - 1, Math.max(0, px | 0)); py = Math.min(DW - 1, Math.max(0, py | 0));
        const i = (py * DW + px) * 4; return D[i] * 256 + D[i + 1] + D[i + 2] / 256 - 32768;
      };
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / (1 << z))));
      const mpp = 40075016 * Math.cos(lat) / ((1 << dz) * DW);   // metres per height pixel
      for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
        const i = (py * W + px) * 4, r = P[i], g = P[i + 1], b = P[i + 2];
        const hx = dl + (px + 0.5) * ds / W, hy = dt + (py + 0.5) * ds / W;
        const e = h(hx, hy);
        let s;
        if (live) {
          const [L, ll, lt, ls] = live, sx = Math.min(L.width - 1, (ll + (px + 0.5) * ls / W) | 0), sy = Math.min(L.width - 1, (lt + (py + 0.5) * ls / W) | 0);
          s = L.data[(sy * L.width + sx) * 4 + 3] > 0 ? 1 : 0;
        } else s = smooth(300, 800, e);
        if (s === 0) { P[i] = r * 0.9 + 6; P[i + 1] = g * 0.9 + 6; P[i + 2] = b * 0.9 + 14; continue; }   // cold, grey-blue valley
        const gx = h(hx + 1, hy) - h(hx - 1, hy), gy = h(hx, hy + 1) - h(hx, hy - 1);
        const slope = Math.atan(Math.hypot(gx, gy) / (2 * mpp)) * 57.3;
        s *= 1 - smooth(40, 55, slope);   // cliffs shed their snow
        const lum = 0.3 * r + 0.59 * g + 0.11 * b;
        const water = b > g + 8 && b > r + 15 && lum < 110;
        const forest = smooth(20, 6, lum - 55) * smooth(-4, 10, g - r);   // dark and green: trees
        const a = s * (water ? 0.15 : 0.95 - 0.75 * forest);   // trees keep their dark green, with a dusting
        const snow = 222 + (lum - 110) * 0.22;   // keeps the photo's light and shade in the snow
        P[i] = r + (snow - 6 - r) * a; P[i + 1] = g + (snow - 2 - g) * a; P[i + 2] = b + (snow + 10 - b) * a;
      }
      const out = new OffscreenCanvas(W, W);
      out.getContext("2d").putImageData(photo, 0, 0);
      return { data: await (await out.convertToBlob({ type: "image/jpeg", quality: 0.9 })).arrayBuffer() };
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
    addWinterProtocol();
    const c = map.getCenter();
    gl = new maplibregl.Map({
      container: box, antialias: true, center: [c.lng, c.lat], zoom: map.getZoom() - 1, pitch: 60, bearing: -15, maxPitch: 85,
      attributionControl: { compact: true },
      style: {
        version: 8,
        glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
        sources: {
          // Winter: last winter's real satellite photos, built once by scripts/winter-photos (Sentinel-2,
          // Feb-Mar 2026, clouds removed). Live: the sharp photos with today's snow drawn in (tfwinter).
          winter: { type: "raster", tileSize: 256, minzoom: 8, maxzoom: 14, bounds: [-124.65, 49.1, -121.75, 50.9], tiles: ["data/winter/{z}/{x}/{y}.webp"],
            attribution: "Winter: Copernicus Sentinel-2 data 2026 (ESA), via <a href=\"https://registry.opendata.aws/sentinel-2-l2a-cogs/\">AWS Open Data</a>" },
          live: { type: "raster", tileSize: 256, maxzoom: 19, tiles: ["tfwinter://live/{z}/{x}/{y}"],
            attribution: "Snow cover: <a href=\"https://earthdata.nasa.gov/gibs\">NASA GIBS</a> MODIS Terra" },
          shade: { type: "raster-dem", encoding: "terrarium", tileSize: 512, maxzoom: 14, tiles: ["tfdem://{z}/{x}/{y}"] },
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
          { id: "sat", type: "raster", source: "sat", paint: { "raster-contrast": 0.08, "raster-saturation": 0.12, "raster-brightness-min": 0.02 } },
          // Every road, track and path from the basemap (OpenStreetMap via OpenFreeMap), under the trail lines.
          { id: "winter", type: "raster", source: "winter", layout: { visibility: "none" } },
          { id: "live", type: "raster", source: "live", layout: { visibility: "none" } },
          // Soft sun and shadow on the slopes, so white mountains still read in winter.
          { id: "shade", type: "hillshade", source: "shade", layout: { visibility: "none" },
            paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#3a4a66", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#5a6a80" } },
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
    const lod = (levels, ratio) => ["sat", "winter", "live"].forEach((id) => { try { if (gl.getSource(id)) gl.setSourceTileLodParams(levels, ratio, id); } catch {} });
    let still = 0;
    gl.once("load", () => lod(1, 30));
    gl.on("movestart", () => { clearTimeout(still); lod(3, 4); });
    gl.on("moveend", () => { clearTimeout(still); still = setTimeout(() => lod(1, 30), 600); });   // 1 = the same photo detail all the way to the horizon
    window.trailMap3d = gl;   // handy for debugging in the browser console
    window.dispatchEvent(new CustomEvent("tf:map3d", { detail: gl }));   // winter.js adds its avalanche layer
    gl.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    // Summer / Winter / Live: Summer = the sharp snow-free Esri photos, Winter = last winter's real
    // Sentinel-2 photos, Live = NASA's latest snow cover painted on the sharp photos.
    const mk = (label) => { const el = document.createElement("button"); el.type = "button"; el.textContent = label;
      el.style.cssText = "width:auto;padding:0 10px;font:600 12px var(--font-body, system-ui)"; return el; };
    const sumBtn = mk("Summer"), winBtn = mk("Winter"), liveBtn = mk("Live");
    const ski = () => document.body.classList.contains("sport-ski");
    let photos = "sharp";
    const setPhotos = (mode) => {
      photos = ["sharp", "winter", "live"].includes(mode) ? mode : "sharp";   // (an old saved "2023" choice becomes Summer)
      if (photos === "winter" && !ski()) photos = "sharp";   // last winter's snow photos are for Skiing only
      winBtn.style.display = ski() ? "" : "none";
      const w = photos === "winter" || photos === "live";
      gl.setLayoutProperty("sat", "visibility", photos === "sharp" || photos === "winter" ? "visible" : "none");   // under Winter, outside its photos
      gl.setLayoutProperty("winter", "visibility", photos === "winter" ? "visible" : "none");
      gl.setLayoutProperty("live", "visibility", photos === "live" ? "visible" : "none");
      gl.setLayoutProperty("shade", "visibility", photos === "live" ? "visible" : "none");
      sumBtn.title = "Sharp, snow-free photos";
      winBtn.title = "Real satellite photos from February and March 2026 (Sentinel-2, 10 m, so softer)";
      liveBtn.title = "Today's real snow (NASA satellite, 2 days old)";
      for (const [el, on] of [[sumBtn, !w], [winBtn, photos === "winter"], [liveBtn, photos === "live"]]) { el.style.background = on ? "#2f6f4f" : ""; el.style.color = on ? "#fff" : ""; }
      store.set(ski() ? "3dPhotosSki" : "3dPhotos", photos);
    };
    sumBtn.addEventListener("click", () => setPhotos("sharp"));
    winBtn.addEventListener("click", () => setPhotos("winter"));
    liveBtn.addEventListener("click", () => setPhotos("live"));
    // MTB opens on Summer and Skiing on Winter, unless the person picked something else in that sport.
    const pick = () => setPhotos(ski() ? store.get("3dPhotosSki", "winter") : store.get("3dPhotos", "sharp"));
    new MutationObserver(pick).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    gl.addControl({ onAdd() { const d = document.createElement("div"); d.className = "maplibregl-ctrl maplibregl-ctrl-group";
      d.style.display = "flex"; d.append(sumBtn, winBtn, liveBtn); return d; }, onRemove() {} }, "bottom-right");
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
