// Elevation lines (contours) for the trail finder: the "Elevation lines" button in Layers draws contour lines with
// height labels on the flat map and drapes the same lines over the 3D map. They are drawn in the browser from free
// terrain heights, no key: Mapterhorn (2 m lidar for much of BC, 30 m elsewhere) and AWS Terrain Tiles (Mapzen)
// where Mapterhorn has no tile, both in the Terrarium colour code. The spacing follows the zoom: 100 m when zoomed
// out down to 10 m close in, with every fifth line bold and labelled.
// The drawing engine, kept self-contained so it can run in a background worker (see below) and keep the map smooth.
function contourEngine() {
  "use strict";
  const MIN_ZOOM = 10;
  // [line every, bold and labelled every] in metres, by zoom (Leaflet zoom of a 256 px tile).
  const step = (z) => (z <= 11 ? [100, 500] : z === 12 ? [50, 250] : z <= 14 ? [20, 100] : [10, 50]);

  // ---------- terrain heights ----------
  // Source tiles are 512 px Terrarium tiles at level s: Mapterhorn's own, else four AWS 256 px tiles one level
  // deeper stitched together, else the parent tile enlarged. Heights are kept as Float32Array(512 * 512).
  const MAPTERHORN = (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`;
  const AWS = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const MAX_SRC = 16;
  const missing = new Set();    // Mapterhorn tiles that don't exist; their children don't either
  const isMissing = (z, x, y) => { for (; z >= 0; z--, x >>= 1, y >>= 1) if (missing.has(`${z}/${x}/${y}`)) return true; return false; };
  async function image(url) {
    const r = await fetch(url);
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return createImageBitmap(await r.blob());
  }
  function heights(cv) {
    const px = cv.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, 512, 512).data, e = new Float32Array(512 * 512);
    for (let i = 0; i < e.length; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    return e;
  }
  async function load(s, x, y) {
    const cv = new OffscreenCanvas(512, 512), cx = cv.getContext("2d", { willReadFrequently: true });
    cx.imageSmoothingEnabled = false;   // blending pixels would scramble the colour-coded heights
    if (!isMissing(s, x, y)) {
      try { cx.drawImage(await image(MAPTERHORN(s, x, y)), 0, 0, 512, 512); return heights(cv); }
      catch (e) { if (e.status === 404 || e.status === 204) missing.add(`${s}/${x}/${y}`); }
    }
    if (s + 1 <= 15) {
      try {
        const parts = await Promise.all([[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => image(AWS(s + 1, 2 * x + dx, 2 * y + dy))));
        parts.forEach((b, i) => cx.drawImage(b, (i % 2) * 256, (i >> 1) * 256));
        return heights(cv);
      } catch {}
    }
    if (s === 0) throw new Error("no terrain");
    // Enlarge a quarter of the parent, smoothly, so the lines don't come out in steps.
    const P = await src(s - 1, x >> 1, y >> 1), ox = (x % 2) * 256, oy = (y % 2) * 256, e = new Float32Array(512 * 512);
    for (let j = 0; j < 512; j++) {
      const v = Math.min(511, Math.max(0, oy + (j + 0.5) / 2 - 0.5)), v0 = Math.floor(v), v1 = Math.min(511, v0 + 1), fv = v - v0;
      for (let i = 0; i < 512; i++) {
        const u = Math.min(511, Math.max(0, ox + (i + 0.5) / 2 - 0.5)), u0 = Math.floor(u), u1 = Math.min(511, u0 + 1), fu = u - u0;
        e[j * 512 + i] = (P[v0 * 512 + u0] * (1 - fu) + P[v0 * 512 + u1] * fu) * (1 - fv) + (P[v1 * 512 + u0] * (1 - fu) + P[v1 * 512 + u1] * fu) * fv;
      }
    }
    return e;
  }
  const cache = new Map();
  function src(s, x, y) {
    const n = 2 ** s, key = `${s}/${x}/${y}`;
    y = Math.min(n - 1, Math.max(0, y)); x = ((x % n) + n) % n;
    if (cache.has(key)) { const p = cache.get(key); cache.delete(key); cache.set(key, p); return p; }
    const p = load(s, x, y);
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 24) cache.delete(cache.keys().next().value);
    return p;
  }

  // Heights at the 257 x 257 pixel corners of a 256 px map tile, so neighbouring tiles share their edge
  // values and the lines join up.
  async function grid(z, x, y) {
    const s = Math.min(z - 1, MAX_SRC), k = 2 ** (s - z) * 2;   // source pixels per tile pixel
    const U0 = x * 256 * k - 0.5, V0 = y * 256 * k - 0.5;       // source pixel centres sit at +0.5
    const tx0 = Math.floor(Math.floor(U0) / 512), tx1 = Math.floor((Math.floor(U0 + 256 * k) + 1) / 512);
    const ty0 = Math.floor(Math.floor(V0) / 512), ty1 = Math.floor((Math.floor(V0 + 256 * k) + 1) / 512);
    const tiles = {};
    await Promise.all([...Array((tx1 - tx0 + 1) * (ty1 - ty0 + 1)).keys()].map(async (i) => {
      const tx = tx0 + (i % (tx1 - tx0 + 1)), ty = ty0 + Math.floor(i / (tx1 - tx0 + 1));
      tiles[`${tx}/${ty}`] = await src(s, tx, ty);
    }));
    const at = (U, V) => { const tx = Math.floor(U / 512), ty = Math.floor(V / 512); return tiles[`${tx}/${ty}`][(V - ty * 512) * 512 + (U - tx * 512)]; };
    const G = new Float32Array(257 * 257);
    for (let j = 0; j <= 256; j++) {
      const V = V0 + j * k, v0 = Math.floor(V), fv = V - v0;
      for (let i = 0; i <= 256; i++) {
        const U = U0 + i * k, u0 = Math.floor(U), fu = U - u0;
        G[j * 257 + i] = (at(u0, v0) * (1 - fu) + at(u0 + 1, v0) * fu) * (1 - fv) + (at(u0, v0 + 1) * (1 - fu) + at(u0 + 1, v0 + 1) * fu) * fv;
      }
    }
    return G;
  }

  // ---------- drawing ----------
  // Brown lines like a paper topo map; pale ones over satellite photos and on the 3D map.
  const LOOK = {
    map: { line: "rgba(150,95,40,.55)", bold: "rgba(125,72,22,.85)", text: "#6b3d12", halo: "rgba(255,255,255,.85)" },
    photo: { line: "rgba(255,238,205,.5)", bold: "rgba(255,232,190,.85)", text: "#fff3dc", halo: "rgba(40,25,10,.8)" },
    // 3D: one step wider apart and fainter, since the tilted view packs many tiles toward the horizon.
    "3d": { line: "rgba(255,238,205,.38)", bold: "rgba(255,232,190,.75)", text: "#fff3dc", halo: "rgba(40,25,10,.8)", coarse: true },
  };
  async function draw(cv, z, x, y, look) {
    const cx = cv.getContext("2d"), S = cv.width / 256, c = LOOK[look];
    cx.clearRect(0, 0, cv.width, cv.height);
    if (z < MIN_ZOOM) return;
    const G = await grid(z, x, y), [every, bold] = step(c.coarse ? z - 1 : z);
    const thin = new Path2D(), thick = new Path2D(), best = new Map();
    // Marching squares: for each cell, every line level between its lowest and highest corner.
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const a = G[j * 257 + i], b = G[j * 257 + i + 1], c2 = G[(j + 1) * 257 + i + 1], d = G[(j + 1) * 257 + i];
      const lo = Math.min(a, b, c2, d), hi = Math.max(a, b, c2, d);
      for (let L = Math.max(every, Math.ceil(lo / every) * every); L < hi; L += every) {
        if (L < lo) continue;
        // Where the level crosses each edge: top (a-b), right (b-c), bottom (d-c), left (a-d).
        const pts = [];
        if ((a < L) !== (b < L)) pts.push([i + (L - a) / (b - a), j]);
        if ((b < L) !== (c2 < L)) pts.push([i + 1, j + (L - b) / (c2 - b)]);
        if ((d < L) !== (c2 < L)) pts.push([i + (L - d) / (c2 - d), j + 1]);
        if ((a < L) !== (d < L)) pts.push([i, j + (L - a) / (d - a)]);
        if (pts.length < 2) continue;
        const segs = pts.length === 4
          ? ((a + b + c2 + d) / 4 < L) === (a < L) ? [[pts[0], pts[1]], [pts[2], pts[3]]] : [[pts[0], pts[3]], [pts[1], pts[2]]]
          : [[pts[0], pts[1]]];
        const isBold = L % bold === 0, path = isBold ? thick : thin;
        for (const [p, q] of segs) {
          path.moveTo(p[0] * S, p[1] * S); path.lineTo(q[0] * S, q[1] * S);
          if (!isBold) continue;
          // Label spot: the piece of this line nearest the middle of the tile, away from the edges.
          const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
          if (mx < 36 || mx > 220 || my < 20 || my > 236) continue;
          const dist = Math.hypot(mx - 128, my - 128), cur = best.get(L);
          if (!cur || dist < cur.dist) best.set(L, { dist, mx, my, ang: Math.atan2(q[1] - p[1], q[0] - p[0]) });
        }
      }
    }
    cx.lineJoin = cx.lineCap = "round";
    cx.strokeStyle = c.line; cx.lineWidth = 0.8 * S; cx.stroke(thin);
    cx.strokeStyle = c.bold; cx.lineWidth = 1.5 * S; cx.stroke(thick);
    // Height labels, never upside down, with a gap cut in the line.
    const placed = [];
    cx.font = `600 ${10 * S}px system-ui, sans-serif`;
    cx.textAlign = "center"; cx.textBaseline = "middle";
    for (const [L, b] of [...best].sort((p, q) => p[1].dist - q[1].dist)) {
      if (placed.some(([px, py]) => Math.hypot(px - b.mx, py - b.my) < 48)) continue;
      placed.push([b.mx, b.my]);
      let ang = b.ang;
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      const text = String(L), w = cx.measureText(text).width + 4 * S;
      cx.save();
      cx.translate(b.mx * S, b.my * S); cx.rotate(ang);
      cx.globalCompositeOperation = "destination-out"; cx.fillRect(-w / 2, -6 * S, w, 12 * S);
      cx.globalCompositeOperation = "source-over";
      cx.lineWidth = 2.5 * S; cx.strokeStyle = c.halo; cx.strokeText(text, 0, 0.5 * S);
      cx.fillStyle = c.text; cx.fillText(text, 0, 0.5 * S);
      cx.restore();
    }
  }
  return draw;
}

(() => {
  "use strict";
  const map = window.tfLeaflet, btn = document.getElementById("contourBtn");
  if (!map || !btn || !window.L) return;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {   // "tf:setting" tells account.js (optional sign-in) to save settings to the rider's account
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const MIN_ZOOM = 10;
  const ATTR = 'Elevation lines: <a href="https://mapterhorn.com/attribution">© Mapterhorn</a>, <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a>';

  const css = document.createElement("style");
  css.textContent = ".map-tools #contourBtn.on { background: #8a5a2b; border-color: #8a5a2b; color: #fff; }";
  document.head.append(css);

  // ---------- background drawing ----------
  // Two workers do the decoding and drawing off the main thread, so panning and the 3D view stay smooth. Each
  // request can be cancelled (tiles that scrolled away before they were drawn). Old browsers draw here instead.
  let workers = null, nextId = 0;
  const waiting = new Map();
  try {
    if (window.Worker && window.OffscreenCanvas) {
      const code = `${contourEngine.toString()}
const draw = contourEngine(), cancelled = new Set();
onmessage = async (e) => {
  const m = e.data;
  if (m.cancel != null) { cancelled.add(m.cancel); return; }
  if (cancelled.delete(m.id)) { postMessage({ id: m.id }); return; }
  const cv = new OffscreenCanvas(m.size, m.size);
  try { await draw(cv, m.z, m.x, m.y, m.look); } catch {}
  if (cancelled.delete(m.id)) { postMessage({ id: m.id }); return; }
  if (m.png) { const buf = await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer(); postMessage({ id: m.id, buf }, [buf]); }
  else { const bmp = cv.transferToImageBitmap(); postMessage({ id: m.id, bmp }, [bmp]); }
};`;
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      workers = [0, 1].map(() => {
        const w = new Worker(url);
        w.onmessage = (e) => { const r = waiting.get(e.data.id); if (r) { waiting.delete(e.data.id); r(e.data); } };
        return w;
      });
    }
  } catch { workers = null; }
  let localDraw = null;
  // Draws one tile; resolves to { bmp } (an ImageBitmap) or, with png, { buf } (PNG bytes); {} when cancelled.
  function render(z, x, y, look, size, png, signal) {
    if (!workers) {
      localDraw = localDraw || contourEngine();
      const cv = new OffscreenCanvas(size, size);
      return localDraw(cv, z, x, y, look).catch(() => {}).then(async () => (png
        ? { buf: await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer() } : { bmp: cv.transferToImageBitmap() }));
    }
    const id = nextId++, w = workers[id % workers.length];
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      if (signal) signal.addEventListener("abort", () => { if (waiting.has(id)) w.postMessage({ cancel: id }); }, { once: true });
      w.postMessage({ id, z, x, y, look, size, png });
    });
  }

  // ---------- 2D map ----------
  map.createPane("contours").style.zIndex = 355;   // over the map tiles, under the avalanche shading and trails
  map.getPane("contours").style.pointerEvents = "none";
  const basemap = document.getElementById("basemap");
  const look2d = () => (basemap && /^sat/.test(basemap.value) ? "photo" : "map");
  const Contours = L.GridLayer.extend({
    createTile(c, done) {
      const cv = document.createElement("canvas"), ac = new AbortController();
      cv.width = cv.height = window.devicePixelRatio > 1 ? 512 : 256;   // sharp lines on phone screens
      cv._abort = ac;
      render(c.z, c.x, c.y, look2d(), cv.width, false, ac.signal).then((r) => {
        cv._abort = null;
        if (r.bmp) { cv.getContext("2d").drawImage(r.bmp, 0, 0); r.bmp.close(); }
        done(null, cv);   // no terrain: leave it blank
      });
      return cv;
    },
  });
  const layer = new Contours({ pane: "contours", minZoom: MIN_ZOOM, maxZoom: 22, updateWhenZooming: false, attribution: ATTR });
  layer.on("tileunload", (e) => e.tile._abort && e.tile._abort.abort());
  if (basemap) basemap.addEventListener("change", () => { if (map.hasLayer(layer)) setTimeout(() => layer.redraw(), 0); });

  // ---------- 3D map ----------
  // The same lines as picture tiles through a tile protocol, draped over the terrain. 256 px pictures here (the
  // 3D view asks for many tiles toward the horizon) and only from zoom 11, where the lines start to mean something.
  let protocol = false;
  function sync3d() {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    if (!protocol) {
      protocol = true;
      maplibregl.addProtocol("tfcontour", async (params, abort) => {
        const [z, x, y] = params.url.replace("tfcontour://", "").split("/").map(Number);
        const r = await render(z, x, y, "3d", 256, true, abort && abort.signal);
        if (!r.buf) throw new Error("cancelled");
        return { data: r.buf };
      });
    }
    const apply = () => {
      if (!on) { if (gl.getLayer("contours")) gl.removeLayer("contours"); if (gl.getSource("contours")) gl.removeSource("contours"); return; }
      if (!gl.getSource("contours")) gl.addSource("contours", { type: "raster", tiles: ["tfcontour://{z}/{x}/{y}"], tileSize: 256, minzoom: MIN_ZOOM + 1, maxzoom: 16, attribution: ATTR });
      const before = ["avy", "skiheat", "osm-roads"].find((id) => gl.getLayer(id));
      if (!gl.getLayer("contours")) gl.addLayer({ id: "contours", type: "raster", source: "contours", paint: { "raster-fade-duration": 0 } }, before);
    };
    // isStyleLoaded() stays false while any tile is still loading, which on the 3D map can be most of the time,
    // so waiting for it could leave the lines on after the switch went off. Layers can be changed as soon as
    // the style itself has loaded.
    try { apply(); } catch { gl.once("style.load", () => { try { apply(); } catch {} }); }
  }
  window.addEventListener("tf:map3d", () => setTimeout(sync3d, 0));

  // ---------- the button ----------
  let on = store.get("contours", false);
  function refresh() {
    if (on) { if (!map.hasLayer(layer)) layer.addTo(map); } else if (map.hasLayer(layer)) map.removeLayer(layer);
    sync3d();
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
  }
  btn.title = "Show elevation lines (contours) with heights in metres, on the flat and 3D maps";
  btn.addEventListener("click", () => {
    on = !on; store.set("contours", on);
    if (on && map.getZoom() < MIN_ZOOM) map.setZoom(MIN_ZOOM + 2);
    refresh();
  });
  refresh();
})();
