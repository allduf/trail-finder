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
  // The app reopens on the map it was closed on, for each sport (alex 2026-10-25: "next time they open it, open with
  // the map style they closed it at"): 3D or flat, and the 3D photos, kept per sport in "map3dBy" and "3dPhotosBy".
  // The sport itself is saved by winter.js; before it has set the body class, the saved one is the sport.
  const sportNow = () => ["mtb", "ski", "hunt", "fish", "moto"].find((s) => document.body.classList.contains("sport-" + s)) || store.get("sport", "mtb");
  const bySport = (k, s, v) => { const o = store.get(k, null) || {}; if (v === undefined) return o[s]; if (o[s] !== v) store.set(k, { ...o, [s]: v }); };

  // Phones have far less memory for the 3D map than a computer, and iPhone Safari kills the whole page when it
  // runs out ("A problem repeatedly occurred", alex 2026-10-19). So on phones: no edge smoothing, the picture
  // drawn at 2x instead of 3x, fewer photos kept in memory and fewer far-away ones.
  const PHONE = matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 600;
  // A finger covers more of the screen than a mouse pointer: trail lines take taps from further away.
  const TOUCH = matchMedia("(pointer: coarse)").matches, TAP = TOUCH ? 18 : 8;
  // Crash guard: "tf:3dOpen" holds the time, renewed every few seconds while the 3D map is on screen, and is cleared
  // when the page is hidden or closed normally. If the page opens on screen less than a minute after it, the page
  // died in 3D (out of memory) and was reloaded, so it opens on the flat map instead of going straight back into 3D
  // and crashing again. An older time is iPhone closing the app in the background, where the clearing doesn't
  // always reach the disk before the app is stopped (alex 2026-10-26: left on 3D, came back on the flat map), so
  // that reopens in 3D as normal. Not a synced setting.
  const OPEN = "tf:3dOpen", CRASH_MS = 60000;
  const mark = (v) => { try { v ? localStorage.setItem(OPEN, String(Date.now())) : localStorage.removeItem(OPEN); } catch {} };
  let crashed = false;
  try { const t = +localStorage.getItem(OPEN); crashed = t > 0 && Date.now() - t < CRASH_MS && document.visibilityState === "visible"; } catch {}
  mark(false);
  setInterval(() => { if (on && document.visibilityState === "visible") mark(true); }, 5000);
  // Where the 3D map was looking, kept while it's open: after a crash the page opens there on the flat map, not on
  // the whole area (alex 2026-10-24: "it lag and jump somewhere in the 2d map"). Not a synced setting either.
  const VIEW = "tf:3dView";
  const keepView = () => { if (!gl) return; const c = gl.getCenter(); try { localStorage.setItem(VIEW, JSON.stringify([c.lat, c.lng, gl.getZoom() + 1])); } catch {} };
  let crashView = null;
  try { crashView = crashed && JSON.parse(localStorage.getItem(VIEW)); } catch {}

  // Photo tiles drawn at 128 px: one zoom deeper, as sharp as the screen up close. Phones too (2026-10-23, alex:
  // "more realistic with a good resolution"): measured in a phone test, the photos are only ~15-60 MB of the
  // 3D map's memory; most of it (~400-500 MB) is the buffers the photos are painted into on the mountains (see
  // trimPaintBuffers). At 256 px the photos were half as sharp as those buffers, so the detail was just lost.
  const PHOTO_TILE = 128;

  const LINE_SCALE = 1.15;    // trails a little bolder than in 2D, so they read against the photos
  let on = false, gl = null, box = null, libLoading = null;
  // Opening 3D starts looking straight down, like the flat map, and tilts up to the mountains and the sky (the way
  // Outmap does it, alex 2026-10-25 "I really like the 3d map like that"): 70 degrees shows the horizon, it was 60.
  // Coming back to 3D tilts to where it was left.
  const TILT = 70, TILT_MS = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900;
  let tilt = TILT, tiltEnd = 0;
  const tiltUp = () => { if (!gl) return; tiltEnd = Date.now() + TILT_MS + 100; gl.easeTo({ pitch: tilt, duration: TILT_MS, easing: (t) => 1 - (1 - t) ** 3 }); };
  let hits = [];              // Leaflet layers that react to clicks, by index (the "id" of the 3D hit lines)
  let hitParts = [];          // their lines as [lng, lat] points, same index (nearestHit)
  let hitDots = [];           // round markers that react to clicks (huts in Skiing...): { l, c: [lng, lat], r }
  let dashLayers = new Set(); // dashed line layers made so far, one per dash pattern
  let drawn = false;          // trails copied at least once
  let last2d = null;          // the flat map's view as the 3D map last set it
  let syncing = 0;            // >0 while one map is moving the other, so the moves don't echo back

  const css = document.createElement("style");
  css.textContent = `
#map3d { position: absolute; inset: 0; z-index: 450; background: #9fb3c8; }
.mapwrap.is3d #basemap, .mapwrap.is3d #mapNote { display: none; }
#map.is3d .leaflet-pane, #map.is3d .leaflet-control-zoom, #map.is3d .leaflet-control-attribution { visibility: hidden; }
.map-tools #btn3d.on { background: var(--fg); border-color: var(--fg); color: var(--panel); }
#map3d .maplibregl-popup-content { background: var(--panel); color: var(--fg); font: 600 .85rem var(--font-body, system-ui); padding: 4px 8px; border-radius: 6px; }
#map3d .maplibregl-popup-tip { display: none; }
#map3d .g3-wait { position: absolute; left: 50%; top: 38%; transform: translateX(-50%); z-index: 2; pointer-events: none; padding: 8px 14px; border-radius: 999px; background: rgba(15,30,25,.78); color: #fff; font: 600 .9rem var(--font-body, system-ui); white-space: nowrap; }
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
  // The 3D library (about 1 MB) is downloaded, not run, once the app has settled, so the first ⛰ 3D tap doesn't wait
  // on the network (alex 2026-10-25: "I want the app go as quick as this", Outmap's 3D comes up at once). The
  // service worker and the browser keep it; running it waits for the tap.
  const prefetch = () => { if (window.maplibregl || libLoading) return; [".js", ".css"].forEach((x) => fetch(LIB + x, { mode: "no-cors" }).catch(() => null)); };
  addEventListener("load", () => setTimeout(() => (window.requestIdleCallback || setTimeout)(prefetch), 8000), { once: true });

  // ---------- copy what the 2D map shows ----------
  const ll = (p) => [p.lng, p.lat];
  function circleRing(c, m) {
    const pts = [], dLat = m / 110540, dLng = m / (111320 * Math.cos((c.lat * Math.PI) / 180));
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2 * Math.PI; pts.push([c.lng + dLng * Math.cos(a), c.lat + dLat * Math.sin(a)]); }
    return pts;
  }
  // Leaflet dashes are in pixels, MapLibre's in line widths.
  const dashKey = (d, w) => String(d).trim().split(/[\s,]+/).map((n) => Math.max(0.1, +n / Math.max(w, 1)).toFixed(2)).join(",");
  // Dotted lines (unofficial trails: round dots in the trail's colour) vanish against the photos at 2D size, so in 3D the
  // dots are bigger and closer together, on a dark see-through band that keeps them reading as one trail.
  const DOT_GROW = 1.3, DOT_STEP = 2.2, DOT_BAND = 2.5;
  const dotKey = (d, w) => { const n = String(d).trim().split(/[\s,]+/).map(Number); return n.length === 2 && n[0] <= 1 ? "dot:" + (n[0] + n[1]) + ":" + w : ""; };

  function snapshot() {
    const lines = [], dots = [], hitLines = [], names = [];
    nameSeen.clear();
    hits = []; hitParts = []; hitDots = [];
    let k = 0;
    // A trail's details are open: the other trail lines fade, as in 2D.
    const focus = map.getContainer().classList.contains("trail-focus");
    const faded = (o) => focus && o.renderer && /^(allTrails|boxTrails)$/.test(o.renderer.options.pane);
    // Phones: only the trails around the view (the whole region is ~10,000 lines and 4-5 MB each copy, which the
    // 3D map keeps a tiled index of); they're copied again after each move.
    const near = PHONE && map.getBounds().pad(2);
    // Lines in a pane the 2D map hides (MTB-only layers like ✓ Ridden in Skiing and Hunting) stay off the 3D map too.
    const hidden = new Map();
    const paneHidden = (o) => {
      const name = (o.renderer && o.renderer.options.pane) || o.pane || "overlayPane";
      if (!hidden.has(name)) { const el = map.getPane(name); hidden.set(name, !!el && getComputedStyle(el).display === "none"); }
      return hidden.get(name);
    };
    map.eachLayer((l) => {
      if (!(l instanceof L.Path) || paneHidden(l.options)) return;
      if (near) { const bb = l.getBounds ? l.getBounds() : L.latLngBounds([l.getLatLng()]); if (!bb.isValid() || !near.intersects(bb)) return; }
      const o = l.options, order = k++;
      if (l instanceof L.CircleMarker && !(l instanceof L.Circle)) {
        // A dot that opens something when tapped in 2D (a hut in Skiing) opens it in 3D too (alex 2026-10-24).
        if (o.interactive !== false && l.listens("click")) hitDots.push({ l, c: ll(l.getLatLng()), r: l.getRadius() + (o.weight || 0) });
        dots.push({ type: "Feature", geometry: { type: "Point", coordinates: ll(l.getLatLng()) },
          properties: { r: l.getRadius(), c: o.color, w: o.stroke === false ? 0 : o.weight,   /* no outline on a shadow dot */ f: o.fillColor || o.color, fo: o.fillOpacity, k: order } });
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
        hits.push(l); hitParts.push(parts);
        hitLines.push({ type: "Feature", geometry, properties: { i: hits.length - 1, w: Math.max(o.weight || 3, TOUCH ? 24 : 14) } });
      }
      if (!o.stroke || !(o.opacity > 0)) return;
      lines.push({ type: "Feature", geometry, properties: { c: o.color, w: o.weight * LINE_SCALE, o: faded(o) ? o.opacity * 0.6 : o.opacity, k: order, d: o.dashArray ? (o.lineCap === "round" && dotKey(o.dashArray, o.weight)) || dashKey(o.dashArray, o.weight) : "",
      } });
      if (o.label) nameSpots(o.label, parts, o.color, faded(o) ? o.opacity * 0.6 : o.opacity, names);
    });
    return { lines, dots, hitLines, names };
  }

  // Trail names (layer "trail-names"): a point every NAME_EVERY metres along each named line, at least
  // NAME_GAP metres from another point of the same name, and one in the middle of a shorter line. Names written
  // along the lines themselves (MapLibre line labels) were mostly left out: a twisty trail, or a short piece of
  // one, has no stretch straight and long enough to hold the name (alex 2026-10-26, Cheakamus: 2 names in 3D, 12 in 2D).
  const NAME_EVERY = 700, NAME_GAP = 450, nameSeen = new Map();
  function nameSpots(n, parts, c, o, out) {
    const seen = nameSeen.get(n) || nameSeen.set(n, []).get(n), kx = Math.cos((parts[0][0][1] * Math.PI) / 180) * 111320;
    const far = (p) => seen.every((q) => ((p[0] - q[0]) * kx) ** 2 + ((p[1] - q[1]) * 110540) ** 2 > NAME_GAP * NAME_GAP);
    const add = (p, len) => { if (!far(p)) return; seen.push(p); out.push({ type: "Feature", geometry: { type: "Point", coordinates: p }, properties: { n, c, o, s: -len } }); };
    for (const pts of parts) {
      const d = [0];
      for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot((pts[i][0] - pts[i - 1][0]) * kx, (pts[i][1] - pts[i - 1][1]) * 110540));
      const len = d[d.length - 1], at = [];
      if (len < NAME_EVERY) at.push(len / 2); else for (let m = NAME_EVERY / 2; m < len; m += NAME_EVERY) at.push(m);
      let i = 1;
      for (const m of at) {
        while (i < d.length - 1 && d[i] < m) i++;
        const t = d[i] > d[i - 1] ? (m - d[i - 1]) / (d[i] - d[i - 1]) : 0;
        add([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t], len);
      }
    }
  }

  function ensureDashLayer(d) {
    const id = "dash:" + d;
    if (dashLayers.has(id)) return;
    dashLayers.add(id);
    if (d.startsWith("dot:")) {
      // A zero-length dash with round caps draws a dot as wide as the line; dashes count in line widths.
      const w = +d.split(":")[2], dot = w * LINE_SCALE * DOT_GROW;
      const line = (lid, paint) => gl.addLayer({ id: lid, type: "line", source: "lines", filter: ["==", ["get", "d"], d],
        layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "k"] }, paint }, "dots");
      line(id + ":band", { "line-color": "#14201a", "line-width": dot + DOT_BAND, "line-opacity": ["*", ["get", "o"], 0.55] });
      line(id, { "line-color": ["get", "c"], "line-width": dot, "line-opacity": ["get", "o"], "line-dasharray": [0, DOT_STEP] });
      return;
    }
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
    gl.getSource("trailNames").setData({ type: "FeatureCollection", features: s.names });
    drawn = true;
  }
  // Only lines and dots are copied: names and pins coming and going (the trail names redraw after every move) don't
  // need the whole region's trails sent to the 3D map again.
  map.on("layeradd layerremove", (e) => { if (e.layer instanceof L.Path) scheduleSync(); });
  map.on("trailfocus", scheduleSync);
  window.addEventListener("tf:sport", scheduleSync);   // panes shown or hidden by sport
  if (PHONE) map.on("moveend", scheduleSync);
  // Selecting a trail restyles lines without adding or removing any.
  const setStyle = L.Path.prototype.setStyle;
  L.Path.prototype.setStyle = function (style) { const r = setStyle.call(this, style); scheduleSync(); return r; };

  // ---------- keep the two cameras together ----------
  // MapLibre zoom levels are one less than Leaflet's (512 px tiles against 256 px).
  function from2d() {
    if (!gl || syncing) return;
    syncing++;
    const c = map.getCenter();
    // The flat map moving because the 3D map just moved it (its zoom rounded to a whole step) is not a new
    // place: flying there would zoom and turn the 3D map again after the person let go.
    if (last2d && map.getZoom() === last2d.zoom && Math.abs(bearing2d() - last2d.bearing) < 0.5 &&
        map.latLngToContainerPoint(c).distanceTo(map.latLngToContainerPoint(last2d.c)) < 2) { syncing--; return; }
    last2d = null;
    // (a move while it tilts up would stop the tilt halfway: this one finishes it)
    gl.flyTo({ center: [c.lng, c.lat], zoom: map.getZoom() - 1, bearing: bearing2d(), duration: 1200, ...(Date.now() < tiltEnd ? { pitch: tilt } : {}) });
    setTimeout(() => syncing--, 1300);
  }
  function to2d() {
    if (!gl || syncing) return;
    syncing++;
    const c = gl.getCenter();
    map.setView([c.lat, c.lng], Math.round(gl.getZoom() + 1), { animate: false });
    if (map.setBearing) { map.setBearing(-gl.getBearing()); map.fire("rotateend"); }
    last2d = { c: map.getCenter(), zoom: map.getZoom(), bearing: bearing2d() };
    setTimeout(() => syncing--, 0);
  }
  map.on("moveend rotateend", () => { if (on) from2d(); });
  // The flat map turned by b degrees (rotate.js) shows the compass direction -b at the top, which is MapLibre's bearing.
  function bearing2d() { return map.getBearing ? -map.getBearing() : 0; }

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
      // Handed over as a picture, not PNG bytes: encoding a canvas on the page waits for the graphics card to finish
      // drawing the 3D map, which froze turning the map for a moment on every new tile (alex, 2026-10-24).
      const t = await demTile(z, x, y, abort.signal);
      return { data: t instanceof OffscreenCanvas ? t.transferToImageBitmap() : t };
    });
  }

  // ---------- winter photos ----------
  // tfwinter://full|live/z/x/y draws snow into the sharp Esri photo itself, pixel by pixel, so the
  // photo's texture stays. Where the snow goes: NASA's latest MODIS snow map. "live" draws it everywhere, "fill"
  // only outside last winter's photos (it lies under them in Winter, so Winter has snow everywhere). Then, like real winter
  // photos: open ground, clearings and alpine go white, dark conifer forest keeps its trees with only a
  // dusting, and cliffs too steep to hold snow stay rock. The hillshade layer adds the relief.
  const ESRI_NOW = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  let summerTiles = ESRI_NOW;   // Esri's newest photos, or an older summer one here (summerHere below)
  const ESRI = (z, x, y) => summerTiles.replace("{z}", z).replace("{y}", y).replace("{x}", x);
  const LIVE_DAY = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);   // NASA posts with a delay
  const NASA_SNOW = (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDSI_Snow_Cover/default/${LIVE_DAY}/GoogleMapsCompatible_Level8/${z}/${y}/${x}.png`;
  const cache = new Map();   // a few recent height / snow-map tiles, shared by neighbouring photo tiles (16 on phones: up to ~1 MB each)
  function cached(key, make) {
    if (!cache.has(key)) { const p = make(); cache.set(key, p); p.catch(() => cache.delete(key)); if (cache.size > (PHONE ? 16 : 48)) cache.delete(cache.keys().next().value); }
    return cache.get(key);
  }
  const pixels = (img) => { const cv = new OffscreenCanvas(img.width, img.height), cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0); return cx.getImageData(0, 0, img.width, img.height); };
  // The part of an ancestor tile (zoom pz) that lies under tile z/x/y, as [data, left, top, size].
  const under = async (pz, z, x, y, get) => {
    const k = z - pz, img = await get(pz, x >> k, y >> k), n = 1 << k, size = img.width / n;
    return [img, (x % n) * size, (y % n) * size, size];
  };
  // NASA's NDSI snow palette (gibs.earthdata.nasa.gov/colormaps/v1.3/MODIS_NDSI_Snow_Cover.xml) back to
  // the index, 1-100: 1-80 step green 240/210/180/150 every 20 with blue 128-147 inside each step, 81-99
  // are about (240,120-133,128-133), 100 is pure red. Clouds, night, water and bare land are transparent.
  const ndsi = (r, g, b) => r === 255 ? (g === 0 && b === 0 ? 100 : 0) : r !== 240 ? 0
    : g >= 150 && b >= 128 && b <= 147 && (240 - g) % 30 === 0 ? (240 - g) / 30 * 20 + b - 127 : g >= 120 && g <= 133 ? 90 : 0;
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  // The summer photo for a snow tile: the picked older summer photo, else (if Esri's archive won't send it) the newest
  // one, so a tile never comes back empty (that left holes in the 3D ground, alex 2026-10-24).
  // A photo that fails to download (a dropped connection, or Esri saying "too many requests" while hundreds of tiles
  // load at once) is asked again twice before giving up: a failed tile stays a blank square in the 3D ground.
  const getBytes = async (url, sig) => {
    for (let n = 0; ; n++) {
      try {
        const r = await fetch(url, { signal: sig });
        if (r.ok) return await r.arrayBuffer();
        if (r.status === 404 || n >= 2) throw new Error(`HTTP ${r.status}`);
      } catch (e) { if (sig.aborted || n >= 2 || /^HTTP/.test(e.message)) throw e; }
      await new Promise((ok) => setTimeout(ok, 600 * (n + 1) ** 2));
    }
  };
  const tileBytes = (z, x, y, sig) => getBytes(ESRI(z, x, y), sig).catch((e) => {
    if (sig.aborted || summerTiles === ESRI_NOW) throw e;
    return getBytes(ESRI_NOW.replace("{z}", z).replace("{y}", y).replace("{x}", x), sig);
  });
  // Esri's photos stop at a different zoom in each place (19 in town, 17-18 around Garibaldi Lake), and past that
  // Esri sends a grey "Map data not yet available" picture: zoomed in, most of the 3D ground was grey there (alex
  // 2026-10-26). Esri's tile map says which tiles exist (32 x 32 at a time, like EsriDeep on the flat map), so a
  // missing tile is cut from the deepest real photo above it and enlarged. The photo downloads while the tile map is
  // asked, so a tile that exists waits no longer than before.
  const ESRI_HAVE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tilemap";
  const haveBlocks = new Map();
  const esriHas = (z, x, y) => {
    const bx = x >> 5, by = y >> 5, k = `${z}/${bx}/${by}`;
    if (!haveBlocks.has(k)) {
      if (haveBlocks.size > 400) haveBlocks.delete(haveBlocks.keys().next().value);
      haveBlocks.set(k, fetch(`${ESRI_HAVE}/${z}/${by * 32}/${bx * 32}/32/32`).then((r) => r.json())
        .then((j) => j.valid === false || !j.data || j.location?.left !== bx * 32 || j.location?.top !== by * 32 ? null : j.data).catch(() => null));
    }
    return haveBlocks.get(k).then((d) => d ? d[(y - by * 32) * 32 + (x - bx * 32)] === 1 : z <= 19);
  };
  async function photoBytes(z, x, y, sig) {
    const own = tileBytes(z, x, y, sig);
    if (z <= 12 || await esriHas(z, x, y)) return own;
    own.catch(() => null);
    let d = z - 1;
    while (d > 0 && d > z - 6 && !(await esriHas(d, x >> (z - d), y >> (z - d)))) d--;
    const k = z - d, n = 1 << k, buf = await tileBytes(d, x >> k, y >> k, sig);
    const big = await createImageBitmap(new Blob([buf]));
    const size = big.width / n, cv = new OffscreenCanvas(256, 256), cx = cv.getContext("2d");
    cx.imageSmoothingQuality = "high";
    cx.drawImage(big, (x % n) * size, (y % n) * size, size, size, 0, 0, 256, 256);
    big.close();
    return (await cv.convertToBlob({ type: "image/jpeg", quality: 0.9 })).arrayBuffer();
  }
  let satProtocol = false;
  function addSatProtocol() {
    if (satProtocol) return;
    satProtocol = true;
    maplibregl.addProtocol("tfsat", async (params, abort) => {
      const [z, x, y] = params.url.replace("tfsat://", "").split("/").map(Number);
      return { data: await photoBytes(z, x, y, abort.signal) };
    });
  }
  let winterProtocol = false;
  function addWinterProtocol() {
    if (winterProtocol) return;
    winterProtocol = true;
    maplibregl.addProtocol("tfwinter", async (params, abort) => {
      const [mode, zs, xs, ys] = params.url.replace("tfwinter://", "").split("/"), z = +zs, x = +xs, y = +ys, sig = abort.signal;
      // Last winter's photos cover it: the plain photo will do. It only shows through their see-through edges, so up
      // close it's a small copy cut from the zoom-13 photo, not a full sharp one: in Skiing at Whistler these hidden
      // photos were ~100 downloads and ~40 MB of the phone's graphics memory for nothing (alex 2026-10-26 recording:
      // ground missing while it loaded, then out of memory).
      if (mode === "fill" && covered(await loadWinterBlocks(), z, x, y)) {
        if (z <= 13) return { data: await photoBytes(z, x, y, sig) };
        const [img, sx, sy, size] = await under(13, z, x, y, (a, b, c) => cached(`p${a}/${b}/${c}`,
          () => photoBytes(a, b, c, new AbortController().signal).then((buf) => createImageBitmap(new Blob([buf])))));
        if (sig.aborted) throw new DOMException("aborted", "AbortError");
        const cv = new OffscreenCanvas(64, 64), cx = cv.getContext("2d");
        cx.imageSmoothingQuality = "high";
        cx.drawImage(img, sx, sy, size, size, 0, 0, 64, 64);
        return { data: cv.transferToImageBitmap() };
      }
      const [raw, live] = await Promise.all([
        photoBytes(z, x, y, sig),
        under(Math.min(z, 8), z, x, y, (a, b, c) => cached(`s${a}/${b}/${c}`, () => image(NASA_SNOW(a, b, c), new AbortController().signal).then(pixels))).catch(() => null)]);
      // How much snow NASA saw at each photo pixel (0 to 1), blended between its 500 m cells so edges
      // aren't blocky. The tile's colour is a code for the snow index (ndsi below), not a picture of snow:
      // pale yellow is the WEAKEST reading, red the strongest. Only a solid reading counts, so the faint
      // readings MODIS makes over bright rock, cloud edges and haze don't paint a mountain white.
      const W = 256, snowAt = new Float32Array(W * W);
      let any = false;
      if (live) {
        const [L, ll, lt, ls] = live, LW = L.width, cell = (cx, cy) => {
          cx = Math.min(LW - 1, Math.max(0, cx)); cy = Math.min(LW - 1, Math.max(0, cy));
          const i = (cy * LW + cx) * 4; if (!L.data[i + 3]) return 0;
          return smooth(35, 70, ndsi(L.data[i], L.data[i + 1], L.data[i + 2]));
        };
        for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
          const fx = ll + (px + 0.5) * ls / W - 0.5, fy = lt + (py + 0.5) * ls / W - 0.5, cx = Math.floor(fx), cy = Math.floor(fy), tx = fx - cx, ty = fy - cy;
          const v = (cell(cx, cy) * (1 - tx) + cell(cx + 1, cy) * tx) * (1 - ty) + (cell(cx, cy + 1) * (1 - tx) + cell(cx + 1, cy + 1) * tx) * ty;
          snowAt[py * W + px] = v; if (v > 0.02) any = true;
        }
      }
      if (mode === "live") { liveTiles++; if (any) liveSnowy++; }
      if (!any) return { data: raw };   // no snow here today: the sharp photo exactly as it is
      const photo = pixels(await createImageBitmap(new Blob([raw]))), P = photo.data;
      const dz = Math.min(z, 13);
      const heights = await under(dz, z, x, y, (a, b, c) => cached(`d${a}/${b}/${c}`, () => demTile(a, b, c, new AbortController().signal).then(pixels))).catch(() => null);
      if (!heights) return { data: raw };   // no heights for the slopes: the photo as it is rather than a hole
      const [dem, dl, dt, ds] = heights;
      const D = dem.data, DW = dem.width, h = (px, py) => {
        px = Math.min(DW - 1, Math.max(0, px | 0)); py = Math.min(DW - 1, Math.max(0, py | 0));
        const i = (py * DW + px) * 4; return D[i] * 256 + D[i + 1] + D[i + 2] / 256 - 32768;
      };
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / (1 << z))));
      const mpp = 40075016 * Math.cos(lat) / ((1 << dz) * DW);   // metres per height pixel
      for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
        const i = (py * W + px) * 4, r = P[i], g = P[i + 1], b = P[i + 2];
        const hx = dl + (px + 0.5) * ds / W, hy = dt + (py + 0.5) * ds / W;
        let s = snowAt[py * W + px];
        if (s <= 0.02) continue;   // bare ground keeps the photo untouched
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
      return { data: await createImageBitmap(photo) };   // a picture, not JPEG bytes (see tfdem above)
    });
  }

  // ---------- summer photos without snow ----------
  // Esri's newest photo isn't always a summer one: at Bromont it's from May, with the ski runs still white, so
  // Summer showed spring snow and looked just like Live (alex, 2026-10-24). Esri keeps its older photos (World
  // Imagery Wayback, as in Old vs new photos): where the newest photo here wasn't taken June to September, the
  // newest older one that was is used instead (else one from October, then May). Picked for the zoom-11 square
  // (about 15 km) in the middle of the view; Live paints today's snow on the same photo. A new pick only changes
  // the tiles that load after it: swapping it into the whole map made every photo tile download again after each
  // move (hundreds at once), and the ones that failed stayed blank (alex, 2026-10-26).
  const WAYBACK = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";
  const WB_TILEMAP = "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap";
  let waybackList = null, liveTiles = 0, liveSnowy = 0;
  const releases = () => waybackList || (waybackList = fetch(WAYBACK).then((r) => r.json()).then((j) => Object.entries(j).map(([k, v]) => ({
    num: +k, meta: v.metadataLayerUrl, pub: (/(\d{4}-\d{2}-\d{2})/.exec(v.itemTitle || "") || [, ""])[1],
    tiles: v.itemURL.replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}") })).sort((a, b) => b.pub.localeCompare(a.pub) || b.num - a.num))
    .catch(() => { waybackList = null; return null; }));
  // The month a release's photo here was taken (1-12), from Esri's photo metadata at zoom 15; 0 if unknown.
  async function photoMonth(r, lng, lat) {
    const q = new URLSearchParams({ f: "json", where: "1=1", outFields: "SRC_DATE2", returnGeometry: "false", geometryType: "esriGeometryPoint",
      spatialRel: "esriSpatialRelIntersects", inSR: "4326", geometry: `${lng},${lat}` });
    try {
      const a = (await (await fetch(`${r.meta}/8/query?${q}`)).json()).features?.[0]?.attributes, d = a && a.SRC_DATE2 ? new Date(a.SRC_DATE2) : null;
      return d && !isNaN(d) ? d.getUTCMonth() + 1 : 0;
    } catch { return 0; }
  }
  const SEASON = (m) => (m >= 6 && m <= 9 ? 3 : m === 10 ? 2 : m === 5 ? 1 : 0);
  // Walks back through the photos really taken here (each tile map answer names the release whose photo the tile
  // shows), at most 8. Resolves to a release, or null where the newest photo is the best one.
  async function findSummer(lng, lat) {
    const list = await releases();
    if (!list) return null;
    const n = 1 << 15, x = Math.floor((lng + 180) / 360 * n), y = Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
    let i = 0, best = null, bestScore = -1;
    for (let k = 0; k < 8 && i < list.length; k++) {
      let j;
      try { j = await (await fetch(`${WB_TILEMAP}/${list[i].num}/15/${y}/${x}`)).json(); } catch { break; }
      if (!j || !j.data || j.data[0] !== 1) break;   // no photo this far back
      const r = list.find((q) => q.num === (j.select?.[0] ?? list[i].num)) || list[i], score = SEASON(await photoMonth(r, lng, lat));
      if (score > bestScore) { best = k ? r : null; bestScore = score; }
      if (score === 3) break;
      i = Math.max(i, list.indexOf(r)) + 1;
    }
    return best;
  }
  const summers = new Map();
  const summerAt = (lng, lat) => {
    const n = 2048, key = Math.floor((lng + 180) / 360 * n) + "/" + Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
    if (!summers.has(key)) summers.set(key, findSummer(lng, lat).catch(() => null));
    return summers.get(key);
  };
  async function summerHere() {
    if (!gl) return;
    const c = gl.getCenter(), r = await summerAt(c.lng, c.lat), tiles = r ? r.tiles : ESRI_NOW;
    if (gl) summerTiles = tiles;
  }

  // Last winter's photos cover the riding areas from the Sunshine Coast to the Rockies, and since 2026-10-26 the
  // ski hills, ski tours and backcountry areas across Canada (alex: "fix winter map all over canada"; the whole
  // country at 10 m would be ~20 GB). blocks.json lists the zoom-11 squares that have them. They're their own site
  // (allduf/trail-finder-winter, same address, so no CORS): at ~590 MB they were most of this site's 1 GB Pages limit.
  const WINTER = "../trail-finder-winter/";
  const WINTER_BOUNDS = [-141, 41.6, -52.6, 70];
  let winterBlocks = null;
  const loadWinterBlocks = () => winterBlocks || (winterBlocks = fetch(WINTER + "blocks.json").then((r) => r.json())
    .then((a) => {
      // Also every zoom 6-10 tile with any of them inside, so tiles with no photos are never asked for.
      const have = new Set(a.map(([x, y]) => x + "/" + y));
      have.some = new Set();
      for (const [x, y] of a) for (let z = 6; z < 11; z++) have.some.add(`${z}/${x >> (11 - z)}/${y >> (11 - z)}`);
      return have;
    }).catch(() => { winterBlocks = null; return null; }));
  // Does tile z/x/y have any winter photo?
  const anyWinter = (have, z, x, y) => !!have && (z >= 11 ? have.has((x >> (z - 11)) + "/" + (y >> (z - 11))) : have.some.has(`${z}/${x}/${y}`));
  // A see-through tile, for places without winter photos: no download, and no 404 for each one.
  const noTile = () => { const c = new OffscreenCanvas(1, 1); c.getContext("2d"); return { data: c.transferToImageBitmap() }; };
  let winterPhotoProtocol = false;
  function addWinterPhotoProtocol() {
    if (winterPhotoProtocol) return;
    winterPhotoProtocol = true;
    maplibregl.addProtocol("tfwinterphoto", async (params, abort) => {
      const [z, x, y] = params.url.replace("tfwinterphoto://", "").split("/").map(Number);
      if (!anyWinter(await loadWinterBlocks(), z, x, y)) return noTile();
      const r = await fetch(`${WINTER}${z}/${x}/${y}.webp`, { signal: abort.signal }).catch((e) => { if (abort.signal.aborted) return null; throw e; });
      if (!r) return noTile();   // scrolled away before it came
      if (r.status === 404) return noTile();   // a square's edge where the photo is all cloud or outside the passes
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { data: await r.arrayBuffer() };
    });
  }
  // Is tile z/x/y all inside the zoom-11 squares that have winter photos?
  const covered = (have, z, x, y) => {
    if (!have) return false;
    if (z >= 11) return have.has((x >> (z - 11)) + "/" + (y >> (z - 11)));
    const n = 1 << (11 - z);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (!have.has((x * n + i) + "/" + (y * n + j))) return false;
    return true;
  };

  // ---------- sharper Winter photos up close ----------
  // tfwinterhd://z/x/y (zooms 15-16): last winter's 10 m Sentinel-2 photos with finer detail added
  // from Mapterhorn's 2 m lidar and Esri's sharp photo (see winter-hd.js). Drawn by workers, so the page stays free
  // to move the map and load its terrain, and drawn as a layer over the plain Winter photos, which show right away
  // and sharpen as these arrive (alex, 2026-10-19: "that map is long to load", "try to not compromize the resolution").
  // Computers only. Phones had them for an hour on 2026-10-26 (2 workers, fewer parent photos, drawn once the map
  // was still): Skiing 3D at Blackcomb still ran the iPhone out of memory, and in a phone test the mountains' heights
  // took over 12 s to arrive with them, against a few seconds without (alex's recording: "it keep doing that,
  // jumping back to 2d map"). PHONE_HD_CACHE stays for a later, lighter try.
  const PHONE_HD_CACHE = 24;   // parent photos kept per worker on phones (computers 160); up to ~1 MB each
  let hdWorkers = null, hdNext = 0, hdId = 0;
  const hdWaiting = new Map();
  const terrainReady = () => new Promise((ok) => {
    const done = () => { if (!gl || !gl.getSource("dem") || gl.isSourceLoaded("dem")) { clearTimeout(t); if (gl) gl.off("sourcedata", done); ok(); } };
    const t = setTimeout(() => { if (gl) gl.off("sourcedata", done); ok(); }, 3000);
    if (gl) gl.on("sourcedata", done);
    done();
  });
  const mapStill = () => new Promise((ok) => {
    if (!PHONE || !gl || !gl.isMoving()) return ok();
    gl.once("moveend", () => setTimeout(() => mapStill().then(ok), 150));   // a short pause, not between two flicks
  });
  function addWinterHdProtocol() {
    if (hdWorkers) return;
    hdWorkers = [...Array(PHONE ? 2 : Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) >> 1)))].map(() => {
      const w = new Worker("winter-hd.js?v=474" + (PHONE ? "&cache=" + PHONE_HD_CACHE : ""));
      w.onmessage = ({ data: m }) => {
        const job = hdWaiting.get(m.id);
        if (!job) return;
        hdWaiting.delete(m.id);
        if (m.data) job.ok({ data: m.data }); else job.no(new Error(m.err || "no tile"));
      };
      return w;
    });
    maplibregl.addProtocol("tfwinterhd", async (params, abort) => {
      const [z, x, y] = params.url.replace("tfwinterhd://", "").split("/").map(Number);
      return anyWinter(await loadWinterBlocks(), z, x, y) ? hdTile(z, x, y, abort) : noTile();
    });
    const hdTile = (z, x, y, abort) => new Promise((ok, no) => {
      const id = ++hdId;
      const w = hdWorkers[hdNext++ % hdWorkers.length];
      hdWaiting.set(id, { ok, no });
      abort.signal.addEventListener("abort", () => {   // scrolled away before it was drawn
        if (!hdWaiting.delete(id)) return;
        w.postMessage({ cancel: id }); no(new DOMException("aborted", "AbortError"));
      });
      // The terrain first: these wait until the ground in view has its heights (at most 3 s), so they don't
      // hold up the mountains, then sharpen the photos already showing. On phones they also wait for the map to
      // stop moving: the ones scrolled past meanwhile are dropped without being drawn.
      terrainReady().then(mapStill).then(() => { if (hdWaiting.has(id)) w.postMessage({ id, z, x, y, base: location.href }); });
    });
  }

  // ---------- phone memory ----------
  // MapLibre paints the photos and lines for each piece of ground in view into a 2048 px buffer (about 32 MB with
  // its depth buffer) and drapes that over the mountains. It keeps every buffer it ever made: one tilted view
  // toward the horizon that needed 14 leaves 14 (~470 MB) for the rest of the visit, the main thing that can run
  // an iPhone out of memory. Once the map is still, the spare ones are let go (they're made again if needed).
  // MapLibre internals (pinned 5.24.0): any surprise just skips it.
  const PHONE_BUFFERS = 12;   // enough for a view tilted to 70-75° (measured)
  // Each buffer is 1024 px on phones instead of 2048: ~8 MB instead of ~32, so 12 are ~100 MB instead of ~380, and
  // the map draws about twice as many frames while moving (phone test at Blackcomb). A little softer right under the
  // camera, the same further off. 2048 and then 1536 px still ran an iPhone out of memory in Skiing 3D at Whistler and
  // Blackcomb (alex's recordings, 2026-10-26).
  const PHONE_RTT = 1024;
  function phoneBuffers() {
    try {
      const pool = gl.painter.renderToTexture && gl.painter.renderToTexture.pool;
      if (!pool) return;
      if (pool._size !== PHONE_BUFFERS) pool._size = PHONE_BUFFERS;
      if (pool._tileSize === PHONE_RTT) return;
      if (gl.terrain) gl.terrain.tileManager.freeRtt();   // every piece of ground paints again, into the smaller buffers
      pool.freeAllObjects();
      for (const o of pool._objects) o.fbo.destroy();   // the colour buffer and depth buffer
      pool._objects = []; pool._recentlyUsed = [];
      pool._tileSize = PHONE_RTT;
      gl.triggerRepaint();
    } catch {}
  }
  function trimPaintBuffers() {
    try {
      const rtt = gl.painter.renderToTexture, pool = rtt && rtt.pool, terrain = gl.terrain;
      if (!pool || !terrain) return;
      const need = new Set(terrain.tileManager.getRenderableTiles().flatMap((t) => (t ? t.rtt : []).filter(Boolean).map((r) => r.id))).size;
      if (pool._objects.length <= need + 1) return;
      terrain.tileManager.freeRtt();   // every piece of ground paints again into the buffers left
      pool.freeAllObjects();
      while (pool._objects.length > need) pool._objects.pop().fbo.destroy();   // the colour buffer and depth buffer
      pool._recentlyUsed = pool._recentlyUsed.filter((id) => id < pool._objects.length);
      gl.triggerRepaint();
    } catch {}
  }

  // ---------- pins on the 3D map ----------
  // MapLibre fades a pin hidden behind a ridge by reading the ground's depth back from the graphics card, one or two
  // read-backs per pin, every 100 ms while the map moves. Each one makes the phone wait for the graphics card to finish
  // drawing. Skiing at Blackcomb has ~140 pins (slackcountry names and gates, resorts, webcams, parking...): ~37,000
  // read-backs in four finger drags, and the map lagged then ran out of memory (alex, 2026-10-25). All our pins stay
  // fully shown behind ridges anyway (opacityWhenCovered 1), so those skip the check. MapLibre internals (pinned
  // 5.24.0): any surprise keeps its own check.
  function quickPins() {
    const M = maplibregl.Marker && maplibregl.Marker.prototype, check = M && M._updateOpacity;
    if (!check || check.quick) return;
    M._updateOpacity = function (force) {
      if (this._opacityWhenCovered !== this._opacity || !this._element) return check.call(this, force);
      if (this._element.style.opacity !== this._opacity) this._element.style.opacity = this._opacity;
    };
    M._updateOpacity.quick = true;
  }

  // ---------- the flat map rests under the 3D map ----------
  // The flat map stays underneath, hidden, and follows every 3D move so its trail lines can be copied and tapped.
  // It used to keep drawing too: each of its line layers is a canvas ~3x the screen (36 MB on an iPhone; 4 of them
  // in Skiing at Blackcomb, ~145 MB) repainted after every 3D move, and its map pictures kept downloading under
  // the 3D photos (~110 per five moves). Measured 2026-10-26 in a phone test. While 3D is on screen, line canvases
  // shrink to 1 px and skip their repaint, and map pictures don't load; trail lines, taps and copying to 3D don't
  // use either. Back on the flat map everything draws again where it is. Leaflet internals (1.9.4): any surprise
  // just draws as before.
  let restFlat = false;
  function rest2d(on) {
    if (restFlat === on) return;
    restFlat = on;
    try {
      if (on) map.eachLayer((l) => { if (l instanceof L.Canvas && l._container) { l._container.width = l._container.height = 1; } });
      else map.eachLayer((l) => {
        if (l instanceof L.Canvas) l._reset ? l._reset() : l._update();
        else if (l instanceof L.GridLayer && l._resetView) l._resetView();
        else if (l._glMap && l._update) l._update();   // the vector flat map (maplibre-gl-leaflet)
      });
    } catch {}
  }
  (() => {
    // A line layer that first appears while 3D is on sets itself up once (its lines need the area it covers).
    const pause = (P, name, also) => {
      const f = P && P[name];
      if (typeof f !== "function" || f.rests) return;
      P[name] = function () {
        if (restFlat && (this._bounds || !(this instanceof L.Renderer))) { if (also) also.call(this); return; }
        const r = f.apply(this, arguments);
        if (restFlat && also) also.call(this);
        return r;
      };
      P[name].rests = true;
    };
    pause(L.Canvas && L.Canvas.prototype, "_update", function () { if (this._container && this._container.width > 1) this._container.width = this._container.height = 1; });
    pause(L.Canvas && L.Canvas.prototype, "_redraw", function () { this._redrawRequest = null; this._redrawBounds = null; });
    pause(L.GridLayer && L.GridLayer.prototype, "_update");
    // The vector flat map loads its library later: pause it once it's there.
    const vec = () => pause(L.MaplibreGL && L.MaplibreGL.prototype, "_update");
    vec(); addEventListener("load", vec);
    map.on("layeradd", (e) => { if (e.layer && e.layer._glMap !== undefined) vec(); });
  })();

  // ---------- the 3D map ----------
  function build() {
    quickPins();
    box = document.createElement("div");
    box.id = "map3d";
    map.getContainer().append(box);   // inside the Leaflet map, under its controls (map key, clear button)
    // Gestures here belong to the 3D map, not to the Leaflet map underneath.
    L.DomEvent.disableClickPropagation(box);
    L.DomEvent.disableScrollPropagation(box);
    ["pointerdown", "touchstart", "contextmenu", "keydown"].forEach((t) => box.addEventListener(t, (e) => e.stopPropagation()));

    addDemProtocol();
    addWinterProtocol();
    addWinterPhotoProtocol();
    addSatProtocol();
    if (!PHONE) addWinterHdProtocol();
    const c = map.getCenter();
    gl = new maplibregl.Map({
      container: box, antialias: !PHONE, pixelRatio: PHONE ? Math.min(devicePixelRatio || 1, 2) : undefined,
      maxTileCacheSize: PHONE ? 12 : null,   // tiles kept per source after they leave the view (24 before 2026-10-26)
      center: [c.lng, c.lat], zoom: map.getZoom() - 1, pitch: 0, bearing: bearing2d(), maxPitch: 85,
      attributionControl: { compact: true },
      style: {
        version: 8,
        glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
        sources: {
          // Winter: last winter's real satellite photos, built once by scripts/winter-photos (Sentinel-2,
          // Feb-Mar 2026, clouds removed). Live: the sharp photos with today's snow drawn in (tfwinter).
          // tileSize 128 like the other photos: one zoom deeper, so the 10 m photos are at full detail up close
          // instead of the half-size zoom 12-13 ones (blurry and stretched on the slopes, alex 2026-10-19).
          winter: { type: "raster", tileSize: PHOTO_TILE, minzoom: 6, maxzoom: 14, bounds: WINTER_BOUNDS, tiles: ["tfwinterphoto://{z}/{x}/{y}"],
            attribution: "Winter: Copernicus Sentinel-2 data 2026 (ESA), via <a href=\"https://registry.opendata.aws/sentinel-2-l2a-cogs/\">AWS Open Data</a>" },
          // Close up, over the Winter photos: the same photos with finer detail (tfwinterhd above). Not on phones.
          ...(PHONE ? {} : { winterhd: { type: "raster", tileSize: 128, minzoom: 15, maxzoom: 16, bounds: WINTER_BOUNDS, tiles: ["tfwinterhd://{z}/{x}/{y}"] } }),
          live: { type: "raster", tileSize: PHOTO_TILE, maxzoom: 19, tiles: ["tfwinter://live/{z}/{x}/{y}"],
            attribution: "Snow cover: <a href=\"https://earthdata.nasa.gov/gibs\">NASA GIBS</a> MODIS Terra" },
          // Under the Winter photos instead of the summer ones: today's snow wherever last winter's photos don't reach.
          fill: { type: "raster", tileSize: PHOTO_TILE, maxzoom: 19, tiles: ["tfwinter://fill/{z}/{x}/{y}"],
            attribution: "Snow cover: <a href=\"https://earthdata.nasa.gov/gibs\">NASA GIBS</a> MODIS Terra" },
          shade: { type: "raster-dem", encoding: "terrarium", tileSize: 512, maxzoom: 14, tiles: ["tfdem://{z}/{x}/{y}"] },
          sat: { type: "raster", tileSize: PHOTO_TILE, maxzoom: 19, tiles: ["tfsat://{z}/{x}/{y}"],
            attribution: "Imagery © Esri, Maxar, Earthstar Geographics" },
          // Sharp place, peak and lake names from OpenFreeMap (free, no key), instead of blurry label pictures.
          names: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: "<a href=\"https://openfreemap.org\">OpenFreeMap</a>" },
          // Heights down to zoom 16 (2 m lidar where Mapterhorn has it): real gullies and rock bands up close, not
          // smoothed 10 m slopes. Only a few MB more on phones (measured), so phones get them too.
          dem: { type: "raster-dem", encoding: "terrarium", tileSize: 512, maxzoom: 16, tiles: ["tfdem://{z}/{x}/{y}"],
            attribution: "Terrain: <a href=\"https://mapterhorn.com/attribution\">© Mapterhorn</a>, <a href=\"https://registry.opendata.aws/terrain-tiles/\">Mapzen Terrain Tiles</a>" },
          lines: { type: "geojson", data: { type: "FeatureCollection", features: [] }, attribution: "Trails © <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors" },
          dots: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          hits: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
          trailNames: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        },
        layers: [
          { id: "sat", type: "raster", source: "sat", paint: { "raster-contrast": 0.08, "raster-saturation": 0.12, "raster-brightness-min": 0.02 } },
          // Every road, track and path from the basemap (OpenStreetMap via OpenFreeMap), under the trail lines.
          { id: "fill", type: "raster", source: "fill", layout: { visibility: "none" } },
          { id: "winter", type: "raster", source: "winter", layout: { visibility: "none" } },
          ...(PHONE ? [] : [{ id: "winterhd", type: "raster", source: "winterhd", layout: { visibility: "none" }, paint: { "raster-fade-duration": 200 } }]),
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
          // The invisible tap lines sit with the other lines, under the dots: after the dots they made a second
          // set of paint buffers per piece of ground, more than MapLibre keeps, so every frame repainted all the
          // photos onto the mountains (2026-10-23).
          { id: "hits", type: "line", source: "hits", paint: { "line-color": "#000", "line-opacity": 0, "line-width": ["get", "w"] } },
          { id: "dots", type: "circle", source: "dots",
            paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "f"], "circle-opacity": ["get", "fo"], "circle-stroke-color": ["get", "c"], "circle-stroke-width": ["get", "w"], "circle-pitch-alignment": "viewport" } },
          // Trail and route names along their lines, in the line's colour, as on the flat map (alex 2026-10-26: "can we
          // see the name like that on the 3d map"), from the same zoom (flat 13 = 3D 12). The lines' "label" option
          // (index.html, winter.js, rider-trails.js; slackcountry lines have their own name pins) is the name. One symbol layer on the lines already
          // copied: MapLibre places them on the ground and leaves out names that would overlap, no HTML markers.
          // Points along the lines (nameSpots), longest trails first; a name that doesn't fit above its point
          // tries below, left and right before it's left out.
          { id: "trail-names", type: "symbol", source: "trailNames", minzoom: 12,
            layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "symbol-sort-key": ["get", "s"],
              "text-size": ["interpolate", ["linear"], ["zoom"], 12, 11.5, 15, 13.5], "text-padding": 2, "text-max-width": 16,
              "text-variable-anchor": ["bottom", "top", "left", "right"], "text-radial-offset": 0.4,
              "text-rotation-alignment": "viewport", "text-pitch-alignment": "viewport" },
            paint: { "text-color": ["get", "c"], "text-opacity": ["get", "o"], "text-halo-color": "#fff", "text-halo-width": 1.8, "text-halo-blur": 0.3 } },
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
        // A light blue haze over the far valleys and ridges, as on a real clear day (and it hides the far photos
        // being softer than the near ones).
        sky: { "sky-color": "#5d9be0", "horizon-color": "#d8e6f2", "fog-color": "#bfd2e4", "sky-horizon-blend": 0.5, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.7, "atmosphere-blend": 0.9 },
      },
    });
    // How sharp the photos are, near and far (alex, 2026-10-18: "it lag" and "i dont like the resolution make it
    // better"). The photos come one zoom deeper than MapLibre would pick for their size (tileSize 128 below), so
    // up close they're as sharp as the screen, and the far ones get a little softer with distance (6 zoom levels
    // at most on screen). One setting all the time: switching to a lighter one while moving and back once still
    // (as before) reloaded every photo after each move, up to 900 tiles each time, and showed blurry ones while
    // moving. Now about 150 to 380 tiles in a tilted view, against 500 to 900.
    // Phones the same since 2026-10-23 (they had 4 levels and fewer far tiles, which made the distance blurry).
    const lod = () => ["sat", "fill", "winter", "winterhd", "live"].forEach((id) => { try { if (gl.getSource(id)) gl.setSourceTileLodParams(6, 3, id); } catch {} });
    gl.once("load", lod);
    gl.once("load", tiltUp);
    // Until the ground first draws the 3D map is only sky (several seconds on a phone with weak signal), which
    // looked broken: say it's coming. Gone at the first full draw, or after 20 s if some imagery never answers.
    const wait = document.createElement("div");
    wait.className = "g3-wait"; wait.setAttribute("role", "status"); wait.textContent = "Loading the mountains…";
    box.append(wait);
    const waited = () => wait.remove();
    gl.once("load", waited); gl.once("idle", waited); setTimeout(waited, 20000);
    if (PHONE) {
      gl.on("idle", trimPaintBuffers);
      // At most PHONE_BUFFERS paint buffers, even while moving: with no limit (30) a long tilted ride across the
      // mountains kept up to 16 (~510 MB, measured) until the map stopped, and the iPhone app ran out of memory and
      // restarted on the flat map. A view that needs more paints its ground in turns: a little slower, never a crash.
      gl.on("render", phoneBuffers);
    }
    gl.on("moveend", keepView);
    window.trailMap3d = gl;   // handy for debugging in the browser console
    window.dispatchEvent(new CustomEvent("tf:map3d", { detail: gl }));   // winter.js adds its avalanche layer
    gl.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    // Summer / Winter / Live: Summer = the sharp snow-free Esri photos, Winter = last winter's real
    // Sentinel-2 photos, Live = NASA's latest snow cover painted on the sharp photos. Skiing has only Winter and
    // Live (alex, 2026-10-23), and MTB only Summer and Live.
    const mk = (label) => { const el = document.createElement("button"); el.type = "button"; el.textContent = label;
      el.style.cssText = "width:auto;padding:0 10px;font:600 12px var(--font-body, system-ui)"; return el; };
    const sumBtn = mk("Summer"), winBtn = mk("Winter"), liveBtn = mk("Live");
    const ski = () => document.body.classList.contains("sport-ski");
    let photos = "sharp";
    const setPhotos = (mode) => {
      photos = ["sharp", "winter", "live"].includes(mode) ? mode : "sharp";   // (an old saved "2023" choice becomes Summer)
      if (photos === "winter" && !ski()) photos = "sharp";   // last winter's snow photos are for Skiing only
      if (photos === "sharp" && ski()) photos = "winter";
      winBtn.style.display = ski() ? "" : "none";
      sumBtn.style.display = ski() ? "none" : "";
      const w = photos === "winter" || photos === "live";
      gl.setLayoutProperty("sat", "visibility", photos === "sharp" ? "visible" : "none");
      gl.setLayoutProperty("fill", "visibility", photos === "winter" ? "visible" : "none");   // under Winter, outside its photos
      for (const id of ["winter", "winterhd"]) if (gl.getLayer(id)) gl.setLayoutProperty(id, "visibility", photos === "winter" ? "visible" : "none");
      gl.setLayoutProperty("live", "visibility", photos === "live" ? "visible" : "none");
      sumBtn.title = "Sharp photos, taken in summer where Esri has one";
      winBtn.title = "Real satellite photos from February and March 2026 (Sentinel-2, 10 m, so softer)";
      liveBtn.title = "Today's real snow (NASA satellite, 2 days old)";
      for (const [el, on] of [[sumBtn, !w], [winBtn, photos === "winter"], [liveBtn, photos === "live"]]) { el.style.background = on ? "#2f6f4f" : ""; el.style.color = on ? "#fff" : ""; }
      bySport("3dPhotosBy", sportNow(), photos);
      winterHere();
    };
    // Winter outside last winter's photos shows today's snow (NASA, as in Live): say so. Live where NASA sees no
    // snow today is the Summer photo as it is: say that too, so it doesn't look like the button did nothing.
    const noWinter = document.createElement("div");
    noWinter.textContent = "No winter photos here yet: today's snow";
    noWinter.style.cssText = "display:none;position:absolute;right:0;bottom:100%;margin-bottom:4px;white-space:nowrap;padding:3px 8px;border-radius:6px;background:rgba(20,30,25,.85);color:#fff;font:600 12px var(--font-body, system-ui)";
    const winterHere = async () => {
      if (photos === "live") {
        if (liveTiles) { noWinter.textContent = "No snow here today: same as Summer"; noWinter.style.display = liveSnowy ? "none" : ""; }
        return;
      }
      noWinter.textContent = "No winter photos here yet: today's snow";
      if (photos !== "winter") { noWinter.style.display = "none"; return; }
      const have = await loadWinterBlocks(), c = gl.getCenter(), n = 2048;
      const x = Math.floor((c.lng + 180) / 360 * n), y = Math.floor((1 - Math.asinh(Math.tan(c.lat * Math.PI / 180)) / Math.PI) / 2 * n);
      noWinter.style.display = photos === "winter" && have && !have.has(x + "/" + y) ? "" : "none";
    };
    gl.on("moveend", winterHere);
    gl.on("movestart", () => { liveTiles = liveSnowy = 0; });
    gl.on("idle", () => { if (photos === "live") winterHere(); });
    gl.on("moveend", summerHere);
    summerHere();
    // A photo tile that still failed (see getBytes) is asked again once the map is still, up to 3 times, instead of
    // staying a flat blue-grey square in the ground (alex, 2026-10-26: big empty squares zoomed out and at Sutton).
    const tileTries = new Map();
    gl.on("idle", () => {
      for (const id of ["sat", "fill", "live"]) {
        const m = gl.style?.tileManagers?.[id], tiles = m?._inViewTiles;
        if (!tiles || typeof m._reloadTile !== "function") continue;
        for (const t of tiles.getAllIds()) {
          if (tiles.getTileById(t)?.state !== "errored") continue;
          const k = id + t, n = tileTries.get(k) || 0;
          if (n >= 3) continue;
          if (tileTries.size > 2000) tileTries.clear();
          tileTries.set(k, n + 1);
          setTimeout(() => { try { if (tiles.getTileById(t)?.state === "errored") m._reloadTile(t, "expired"); } catch {} }, 1000 * (n + 1));
        }
      }
    });
    sumBtn.addEventListener("click", () => setPhotos("sharp"));
    winBtn.addEventListener("click", () => setPhotos("winter"));
    liveBtn.addEventListener("click", () => setPhotos("live"));
    // MTB opens on Summer and Skiing on Winter, unless the person picked something else in that sport (before
    // 2026-10-25 Hunting and Fishing shared MTB's choice: that's where they start).
    const pick = () => { const s = sportNow(), v = bySport("3dPhotosBy", s); setPhotos(v || (s === "ski" ? store.get("3dPhotosSki", "winter") : store.get("3dPhotos", "sharp"))); };
    new MutationObserver(pick).observe(document.body, { attributes: true, attributeFilter: ["class"] });
    gl.addControl({ onAdd() { const d = document.createElement("div"); d.className = "maplibregl-ctrl maplibregl-ctrl-group";
      d.style.cssText += ";display:flex;position:relative;overflow:visible"; d.append(sumBtn, winBtn, liveBtn, noWinter); return d; }, onRemove() {} }, "bottom-right");
    gl.once("styledata", pick);
    // "load" waits for every first tile, and imagery that fails to load can hold it back, so the
    // trails go on as soon as the style itself is ready.
    gl.on("styledata", () => { if (!drawn && gl.getSource("lines")) scheduleSync(); });
    gl.on("moveend", (e) => { if (e.originalEvent) to2d(); });   // the person moved the 3D map
    // A turn or tilt stops where the finger lets go. MapLibre otherwise keeps turning the map (up to 179°)
    // and tilting it after release; a slide still glides on.
    const inertia = gl.handlers && gl.handlers._inertia;
    if (inertia && inertia._onMoveEnd) {
      const onMoveEnd = inertia._onMoveEnd;
      inertia._onMoveEnd = function () {
        const ease = onMoveEnd.apply(this, arguments);
        if (!ease) return ease;
        delete ease.bearing; delete ease.pitch; delete ease.roll;
        return ease.center || ease.zoom !== undefined ? ease : undefined;
      };
    }
    new ResizeObserver(() => gl.resize()).observe(box);

    // Taps go to the same Leaflet trail lines (opening the same details panel); anywhere else is a
    // click on the 2D map at that spot, which looks up the nearest trail just like it does in 2D.
    const near = (p, pad) => gl.queryRenderedFeatures([[p.x - pad, p.y - pad], [p.x + pad, p.y + pad]], { layers: ["hits"] });
    // MapLibre finds what's under a tap on the mountains by reading back a picture of the ground from the graphics
    // card, and on some screens that comes back empty (alex 2026-10-24: ski routes drawn on Blackcomb in 3D, taps did
    // nothing). So when it finds no line, the tap is checked against the lines themselves, put on the screen at their
    // heights: the closest one within TAP px. Only lines whose box is in view are measured.
    function nearestHit(p, pad) {
      const v = gl.getBounds(), w = v.getWest(), e = v.getEast(), s = v.getSouth(), n = v.getNorth();
      let best = -1, bestD = pad * pad;
      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      hits.forEach((l, i) => {
        const bb = l.getBounds && l.getBounds();
        if (!bb || !bb.isValid() || bb.getWest() > e || bb.getEast() < w || bb.getSouth() > n || bb.getNorth() < s) return;
        // Placing a point at its height takes time: first skip lines whose box is nowhere near the tap (its corners
        // can sit at other heights than the line, hence the margin).
        const c = gl.project(bb.getCenter()), half = Math.max(...[bb.getSouthWest(), bb.getNorthEast(), bb.getNorthWest(), bb.getSouthEast()].map((q) => dist(c, gl.project(q))));
        if (dist(c, p) > half + pad + 150) return;
        for (const part of hitParts[i]) {
          let a = gl.project(part[0]);
          for (let j = 1; j < part.length; j++) {
            const b = gl.project(part[j]), dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
            const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
            const ex = a.x + t * dx - p.x, ey = a.y + t * dy - p.y, d = ex * ex + ey * ey;
            if (d < bestD) { bestD = d; best = i; }
            a = b;
          }
        }
      });
      return best;
    }
    // The closest tappable dot within pad px of its edge, placed at its height on the mountains. Dots win over
    // lines: a hut sits on the routes that lead to it.
    function nearestDot(p, pad) {
      const v = gl.getBounds();
      let best = null, bestD = Infinity;
      for (const d of hitDots) {
        if (!v.contains(d.c)) continue;
        const q = gl.project(d.c), dd = Math.hypot(q.x - p.x, q.y - p.y);
        if (dd <= d.r + pad && dd < bestD) { bestD = dd; best = d; }
      }
      return best;
    }
    const toLL = (lngLat) => L.latLng(lngLat.lat, lngLat.lng);
    gl.on("click", (e) => {
      const dot = nearestDot(e.point, TAP);
      if (dot) { dot.l.fire("click", { latlng: dot.l.getLatLng(), originalEvent: e.originalEvent }); return; }
      const f = near(e.point, TAP)[0], latlng = toLL(e.lngLat);
      const layer = f ? hits[f.properties.i] : hits[nearestHit(e.point, TAP + 4)];
      if (layer) layer.fire("click", { latlng, originalEvent: e.originalEvent });
      else {
        to2d();
        map.fire("click", { latlng, layerPoint: map.latLngToLayerPoint(latlng), containerPoint: map.latLngToContainerPoint(latlng), originalEvent: e.originalEvent });
      }
    });
    const tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
    gl.on("movestart", () => tip.remove());
    gl.on("mousemove", (e) => {
      if (gl.isMoving() || (e.originalEvent && e.originalEvent.buttons)) return;   // turning or tilting: no trail names under the mouse
      const dot = nearestDot(e.point, 2), f = !dot && near(e.point, 6)[0], layer = dot ? dot.l : f && hits[f.properties.i], t = layer && layer.getTooltip && layer.getTooltip();
      gl.getCanvas().style.cursor = layer ? "pointer" : "";
      if (t) tip.setLngLat(e.lngLat).setHTML(String(t.getContent())).addTo(gl); else tip.remove();
    });
    gl.getCanvas().addEventListener("mouseleave", () => tip.remove());
  }

  // Each sport opens on the map it was last left on, 3D or flat, also after the app is closed. Skiing starts on 3D
  // (alex 2026-10-24: "when you enter in skiing mode make that the 3d map come up by default"); the other sports start
  // on the old shared "map3d" choice until they're switched once.
  const saved3d = (s) => { const v = bySport("map3dBy", s); return typeof v === "boolean" ? v : s === "ski" ? true : store.get("map3d", false); };
  let want3d = null;   // last asked for, so a switch back to 2D while the 3D library loads isn't undone when it arrives
  function set3d(want, auto) {
    want3d = want;
    if (want === on) { syncBtn(); return; }
    if (want && !window.maplibregl) {
      btn.textContent = "⛰ Loading 3D…";
      loadLib().then(() => { if (want3d) set3d(true, auto); }, () => { btn.textContent = "⛰ 3D unavailable"; setTimeout(syncBtn, 3000); });
      return;
    }
    on = want; mark(on);
    if (!auto) { bySport("map3dBy", sportNow(), on); if (on) crashed = false; }
    map.getContainer().classList.toggle("is3d", on);
    map.getContainer().parentElement.classList.toggle("is3d", on);   // hides the 2D map style menu
    rest2d(on);
    if (on) {
      if (!gl) build();
      else { box.hidden = false; gl.resize(); const c = map.getCenter(); syncing++; gl.jumpTo({ center: [c.lng, c.lat], zoom: map.getZoom() - 1, bearing: bearing2d(), pitch: 0 }); syncing--; tiltUp(); }
      syncData(); keepView();
    } else if (box) { if (gl) tilt = Math.max(gl.getPitch(), 30); box.hidden = true; }
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
  // The crash guard wins: if the page died in 3D, this visit opens every sport flat until ⛰ 3D is tapped.
  let sport = null;
  window.addEventListener("tf:sport", (e) => {
    const s = e.detail, was = sport;
    sport = s;
    if (s === was) return;
    set3d(!crashed && saved3d(s), true);
  });
  // Hidden or closed normally: not a crash. Back on screen in 3D: watch again.
  document.addEventListener("visibilitychange", () => mark(on && document.visibilityState === "visible"));
  addEventListener("pagehide", () => mark(false));
  addEventListener("pageshow", () => mark(on));
  if (crashed) {
    bySport("map3dBy", sportNow(), false);   // the sport it died in reopens flat next time too, until 3D is picked again
    // Back where the 3D map was, once the page has set its first view, and say what happened.
    const back = () => {
      if (Array.isArray(crashView) && crashView.every(Number.isFinite) && !/^#(trail|route|pin)=/.test(location.hash)) map.setView([crashView[0], crashView[1]], Math.round(crashView[2]), { animate: false });
      if (window.tfToast) window.tfToast("3D ran out of memory: back on the flat map here. Tap ⛰ 3D to return.");
    };
    if (document.readyState === "complete") setTimeout(back, 0); else addEventListener("load", () => setTimeout(back, 0), { once: true });
  }
  else if (saved3d(sportNow())) set3d(true, true);
})();
