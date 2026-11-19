// Sun and shade (alex 2026-11-17: "a layer showing the shades on the mountain based on the time of the day that the
// user selected", "link it with the location of the sun at all different locations and moments in the year").
// The "Sun and shade" button in Layers (every sport) darkens the ground that is out of the sun at the picked date and
// time, on the flat map and on the 3D map. The sun's position comes from the date, the time and the place (the usual
// astronomy formulas, as in SunCalc), worked out for each map tile. The shade is cast by the terrain itself: a slope
// facing away from the sun, and ground in the shadow of a ridge, a peak or a valley wall, even many kilometres away.
// It's an estimate from terrain heights (AWS Terrain Tiles, Mapzen): trees, buildings, clouds and snow aren't counted.
//
// How the shadows are found, for a 256 px tile: the heights of the tile and its 8 neighbours (768 x 768 px), and of the
// same area 3 zooms out (8 times wider, for mountains far away). A "shadow surface" is carried across each grid from
// the sun's side, one row or column at a time: the height of the sun's ray that grazes the highest ground so far. A
// pixel under that surface is in shade. The far grid goes first and hands its shadows to the near one at its edge.
// That's a few million simple steps a tile, done in a background worker so the map stays smooth.

// The engine, self-contained so it can run in the worker (see below).
function shadeEngine() {
  "use strict";
  // ---------- the sun ----------
  // Sun position for a moment (ms) and a place: azimuth (radians, from north, clockwise) and altitude (radians).
  const RAD = Math.PI / 180, DAY = 86400000, J2000 = 2451545, OBL = 23.4397 * RAD;
  function sun(ms, lat, lon) {
    const d = ms / DAY + 2440587.5 - J2000;
    const M = (357.5291 + 0.98560028 * d) * RAD;
    const C = (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) * RAD;
    const L = M + C + 102.9372 * RAD + Math.PI;
    const dec = Math.asin(Math.sin(L) * Math.sin(OBL)), ra = Math.atan2(Math.sin(L) * Math.cos(OBL), Math.cos(L));
    const H = (280.16 + 360.9856235 * d) * RAD + lon * RAD - ra, phi = lat * RAD;
    const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
    // Light bends over the horizon: the sun shows about half a degree higher there than it is.
    const a = alt / RAD, refr = a > -1 ? (1.02 / Math.tan((a + 10.3 / (a + 5.11)) * RAD)) / 60 : 0;
    return { az, alt: alt + refr * RAD };
  }

  // ---------- terrain heights ----------
  const DEM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const cache = new Map();
  async function load(z, x, y) {
    const r = await fetch(DEM(z, x, y));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const bmp = await createImageBitmap(await r.blob());
    const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.imageSmoothingEnabled = false;
    cx.drawImage(bmp, 0, 0, 256, 256);
    bmp.close && bmp.close();
    const px = cx.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
    for (let i = 0; i < 65536; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
    return e;
  }
  function tile(z, x, y) {
    const n = 2 ** z;
    if (y < 0 || y >= n) return Promise.resolve(null);
    x = ((x % n) + n) % n;
    const key = `${z}/${x}/${y}`;
    if (cache.has(key)) { const p = cache.get(key); cache.delete(key); cache.set(key, p); return p; }
    const p = load(z, x, y).catch(() => null);   // no tile (open sea, a failed download): flat ground at sea level
    cache.set(key, p);
    if (cache.size > 90) cache.delete(cache.keys().next().value);
    return p;
  }
  // The 3 x 3 tiles around (x, y) as one 768 x 768 grid. Null when the middle tile has no heights.
  async function grid(z, x, y) {
    const parts = await Promise.all([...Array(9).keys()].map((i) => tile(z, x - 1 + (i % 3), y - 1 + Math.floor(i / 3))));
    if (!parts[4]) return null;
    const G = new Float32Array(768 * 768);
    parts.forEach((P, i) => {
      const ox = (i % 3) * 256, oy = Math.floor(i / 3) * 256;
      for (let r = 0; r < 256; r++) {
        const row = (oy + r) * 768 + ox;
        if (P) G.set(P.subarray(r * 256, r * 256 + 256), row); else G.fill(0, row, row + 256);
      }
    });
    for (let i = 0; i < G.length; i++) if (G[i] < 0) G[i] = 0;   // sea and lakes below 0 m: the water's surface
    return G;
  }

  // ---------- the shadow surface ----------
  // H: heights (W x W), mpp: metres a pixel, (dx, dy): one step toward the sun in pixels (y down = south), tanA: the
  // sun's slope. edge(x, y): the shadow surface from outside the grid at a grid position (or -Infinity). Returns S, the
  // shadow surface: S >= H everywhere, S > H in shade.
  function surface(H, W, mpp, dx, dy, tanA, edge) {
    const S = new Float32Array(W * W);
    const alongX = Math.abs(dx) >= Math.abs(dy);
    // Walk lines across the sun's direction, starting on the sun's side. Each line looks back at the one before it.
    const lines = W, sx = Math.sign(alongX ? dx : dy) || 1, k = alongX ? dy / Math.abs(dx) : dx / Math.abs(dy);
    const drop = mpp * Math.hypot(1, k) * tanA;
    const at = alongX ? (l, p) => p * W + l : (l, p) => l * W + p;
    for (let n = 0; n < lines; n++) {
      const l = sx > 0 ? W - 1 - n : n, prev = l + sx;   // this line, and the one toward the sun
      for (let p = 0; p < W; p++) {
        const i = at(l, p), h = H[i];
        let up;
        const q = p + k;   // where the ray toward the sun crosses the line before
        if (n === 0 || q < 0 || q > W - 1) {
          up = alongX ? edge(prev, q) : edge(q, prev);
        } else {
          const q0 = Math.floor(q), f = q - q0, q1 = Math.min(W - 1, q0 + 1);
          up = S[at(prev, q0)] * (1 - f) + S[at(prev, q1)] * f;
        }
        const ray = up - drop;
        S[i] = ray > h ? ray : h;
      }
    }
    return S;
  }

  // The far grid's shadow surface (nothing known past its edges), with the sun at its middle. The 64 tiles inside one
  // far tile share it, so it's kept for the last few moments and places.
  const farCache = new Map();
  function farSurface(zf, cx, cy, ms) {
    const key = `${zf}/${cx}/${cy}/${ms}`;
    if (farCache.has(key)) return farCache.get(key);
    const p = grid(zf, cx, cy).then((H) => {
      if (!H) return null;
      const n = 2 ** zf, lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (cy + 0.5)) / n))) / RAD, s = sun(ms, lat, ((cx + 0.5) / n) * 360 - 180);
      if (s.alt <= 0) return null;
      const mpp = (40075016.686 * Math.cos(lat * RAD)) / (256 * n);
      return { H, S: surface(H, 768, mpp, Math.sin(s.az), -Math.cos(s.az), Math.tan(s.alt), () => -Infinity) };
    });
    farCache.set(key, p);
    if (farCache.size > 6) farCache.delete(farCache.keys().next().value);
    return p;
  }

  // ---------- one tile ----------
  const FAR = 3;   // zooms out for the far grid: 8 times wider, about +-25 km around a zoom-13 tile
  const SHADE = [24, 32, 58];   // a deep blue-grey
  async function paint(z, x, y, ms) {
    const out = new Uint8ClampedArray(256 * 256 * 4);
    const n = 2 ** z, latOf = (ty) => Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) / RAD;
    const lat = latOf(y + 0.5), lon = ((x + 0.5) / n) * 360 - 180;
    const s = sun(ms, lat, lon);
    if (s.alt <= 0) {   // the sun is down here: all in shade
      for (let i = 0; i < 65536; i++) { const j = i * 4; out[j] = SHADE[0]; out[j + 1] = SHADE[1]; out[j + 2] = SHADE[2]; out[j + 3] = 140; }
      return { px: out, night: true };
    }
    const zf = Math.max(0, z - FAR), sc = 2 ** (z - zf), cx = Math.floor(x / sc), cy = Math.floor(y / sc);
    const [Hn, far] = await Promise.all([grid(z, x, y), farSurface(zf, cx, cy, ms)]);
    if (!Hn) return { px: out };
    const mpp = (40075016.686 * Math.cos(lat * RAD)) / (256 * n);
    const dx = Math.sin(s.az), dy = -Math.cos(s.az), tanA = Math.tan(s.alt);
    const Hf = far && far.H, Sf = far && far.S;
    // Near grid pixel (u, v) in far grid pixels. Its edge takes the far grid's shadows only where the far grid
    // really has shade (its smoothed heights would fill narrow valleys).
    const ou = (x - 1) * 256 / sc - (cx - 1) * 256, ov = (y - 1) * 256 / sc - (cy - 1) * 256;
    const edge = !Sf ? () => -Infinity : (u, v) => {
      const U = ou + (u + 0.5) / sc - 0.5, V = ov + (v + 0.5) / sc - 0.5;
      if (U < 0 || V < 0 || U > 767 || V > 767) return -Infinity;
      const u0 = Math.floor(U), v0 = Math.floor(V), u1 = Math.min(767, u0 + 1), v1 = Math.min(767, v0 + 1), fu = U - u0, fv = V - v0;
      const S = (Sf[v0 * 768 + u0] * (1 - fu) + Sf[v0 * 768 + u1] * fu) * (1 - fv) + (Sf[v1 * 768 + u0] * (1 - fu) + Sf[v1 * 768 + u1] * fu) * fv;
      const h = (Hf[v0 * 768 + u0] * (1 - fu) + Hf[v0 * 768 + u1] * fu) * (1 - fv) + (Hf[v1 * 768 + u0] * (1 - fu) + Hf[v1 * 768 + u1] * fu) * fv;
      return S - h > 15 ? S : -Infinity;
    };
    const S = surface(Hn, 768, mpp, dx, dy, tanA, edge);
    // The middle tile: shade where the ground is under the surface, fading in over the first few metres so the
    // edges aren't jagged.
    const soft = Math.max(2, mpp * 0.25);
    for (let r = 0; r < 256; r++) for (let c = 0; c < 256; c++) {
      const g = (r + 256) * 768 + c + 256, depth = S[g] - Hn[g];
      if (depth <= 0.5) continue;
      const a = Math.min(1, (depth - 0.5) / soft), j = (r * 256 + c) * 4;
      out[j] = SHADE[0]; out[j + 1] = SHADE[1]; out[j + 2] = SHADE[2]; out[j + 3] = Math.round(140 * a);
    }
    return { px: out };
  }
  return { paint, sun };
}

(() => {
  "use strict";
  const map = window.tfLeaflet, btn = document.getElementById("shadeBtn");
  if (!map || !btn || !window.L) return;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const MIN_ZOOM = 9, MAX_NATIVE = 13;
  const ATTR = 'Sun and shade: an estimate from <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a>';
  const engine = shadeEngine();
  const fr = window.tfLang && window.tfLang.lang === "fr", LOC = fr ? "fr-CA" : "en-CA";
  const T = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);

  // ---------- background drawing ----------
  let workers = null, nextId = 0;
  const waiting = new Map();
  try {
    if (window.Worker && window.OffscreenCanvas) {
      const code = `const E = (${shadeEngine.toString()})(), cancelled = new Set();
onmessage = async (e) => {
  const m = e.data;
  if (m.cancel != null) { cancelled.add(m.cancel); return; }
  if (cancelled.delete(m.id)) { postMessage({ id: m.id }); return; }
  let r = null;
  try { r = await E.paint(m.z, m.x, m.y, m.t); } catch {}
  if (cancelled.delete(m.id) || !r) { postMessage({ id: m.id }); return; }
  const cv = new OffscreenCanvas(256, 256); cv.getContext("2d").putImageData(new ImageData(r.px, 256, 256), 0, 0);
  const bmp = cv.transferToImageBitmap(); postMessage({ id: m.id, bmp }, [bmp]);
};`;
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
      workers = [0, 1].map(() => {
        const w = new Worker(url);
        w.onmessage = (e) => { const r = waiting.get(e.data.id); if (r) { waiting.delete(e.data.id); r(e.data); } };
        return w;
      });
    }
  } catch { workers = null; }
  // One tile as a picture: { bmp } (an ImageBitmap), {} when cancelled or no terrain.
  function render(z, x, y, t, signal) {
    if (!workers) {
      return engine.paint(z, x, y, t).then(async (r) => {
        const cv = document.createElement("canvas"); cv.width = cv.height = 256;
        cv.getContext("2d").putImageData(new ImageData(r.px, 256, 256), 0, 0);
        return { bmp: await createImageBitmap(cv) };
      }).catch(() => ({}));
    }
    const id = nextId++, w = workers[id % workers.length];
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      if (signal) signal.addEventListener("abort", () => { if (waiting.has(id)) w.postMessage({ cancel: id }); }, { once: true });
      w.postMessage({ id, z, x, y, t });
    });
  }

  // ---------- the picked moment ----------
  // A day (local midnight, ms) and minutes after midnight, on this phone's clock. Starts at now each time the app opens.
  const now = () => new Date();
  let day = midnight(now()), mins = now().getHours() * 60 + Math.floor(now().getMinutes() / 5) * 5;
  function midnight(d) { const m = new Date(d); m.setHours(0, 0, 0, 0); return m.getTime(); }
  // Minutes after midnight to a moment: through the Date so a time change (DST) day still comes out right.
  const moment = () => { const d = new Date(day); d.setHours(0, mins, 0, 0); return d.getTime(); };
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString(LOC, { hour: "numeric", minute: "2-digit" });
  const fmtDay = (ms) => new Date(ms).toLocaleDateString(LOC, { weekday: "short", month: "short", day: "numeric" });
  // Sunrise and sunset at a place on the picked day: the minutes when the sun crosses the horizon, to the minute.
  function sunTimes(lat, lon) {
    const at = (m) => { const d = new Date(day); d.setHours(0, m, 0, 0); return engine.sun(d.getTime(), lat, lon).alt; };
    let rise = null, set = null, prev = at(0);
    for (let m = 10; m <= 1440; m += 10) {
      const a = at(m);
      if (prev <= 0 && a > 0 && rise == null) rise = edge(m - 10, m);
      if (prev > 0 && a <= 0) set = edge(m - 10, m);
      prev = a;
    }
    function edge(lo, hi) { const up = at(lo) <= 0; for (let m = lo; m <= hi; m++) if ((at(m) > 0) === up) return m; return hi; }
    return { rise, set, up: at(720) > 0 };
  }

  // ---------- 2D map ----------
  map.createPane("sunshade").style.zIndex = 354;   // over the map tiles, under the elevation lines, avalanche shading and trails
  map.getPane("sunshade").style.pointerEvents = "none";
  const Shade = L.GridLayer.extend({
    createTile(c, done) {
      const cv = document.createElement("canvas"), ac = new AbortController();
      cv.width = cv.height = 256;
      cv._abort = ac;
      render(c.z, c.x, c.y, this.options.t, ac.signal).then((r) => {
        cv._abort = null;
        if (r.bmp) { cv.getContext("2d").drawImage(r.bmp, 0, 0); r.bmp.close(); }
        done(null, cv);
      });
      return cv;
    },
  });
  let layer = null, next = null;
  function make(t) {
    const l = new Shade({ pane: "sunshade", minZoom: MIN_ZOOM, maxNativeZoom: MAX_NATIVE, maxZoom: 22, updateWhenZooming: false, keepBuffer: 1, attribution: ATTR, t });
    l.on("tileunload", (e) => e.tile._abort && e.tile._abort.abort());
    return l;
  }
  // A new moment: the new shade is drawn under the old one, which goes once the new one is in (no blank flash).
  function draw2d() {
    if (!on) {
      [layer, next].forEach((l) => l && map.hasLayer(l) && map.removeLayer(l));
      layer = next = null;
      return;
    }
    const t = moment();
    if (layer && layer.options.t === t && map.hasLayer(layer)) return;
    if (!layer) { layer = make(t).addTo(map); return; }
    if (next) map.removeLayer(next);
    const l = next = make(t);
    l.once("load", () => {
      if (next !== l) return;
      if (layer) map.removeLayer(layer);
      layer = l; next = null;
    });
    l.addTo(map);
  }

  // ---------- 3D map ----------
  let protocol = false, last3d = 0, timer3d = 0;
  function sync3d() {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    if (!protocol) {
      protocol = true;
      maplibregl.addProtocol("tfshade", async (params, abort) => {
        const [path, q] = params.url.replace("tfshade://", "").split("?");
        const [z, x, y] = path.split("/").map(Number), t = +new URLSearchParams(q).get("t");
        const r = await render(z, x, y, t, abort && abort.signal);
        if (!r.bmp) throw new Error("no shade");
        return { data: r.bmp };
      });
    }
    const url = `tfshade://{z}/{x}/{y}?t=${moment()}`;
    const apply = () => {
      if (!on) { if (gl.getLayer("sunshade")) gl.removeLayer("sunshade"); if (gl.getSource("sunshade")) gl.removeSource("sunshade"); return; }
      const src = gl.getSource("sunshade");
      if (!src) gl.addSource("sunshade", { type: "raster", tiles: [url], tileSize: 256, minzoom: MIN_ZOOM, maxzoom: MAX_NATIVE, attribution: ATTR });
      else if (src.tiles && src.tiles[0] !== url) src.setTiles([url]);
      const before = ["contours", "avy", "skiheat", "osm-roads"].find((id) => gl.getLayer(id));
      if (!gl.getLayer("sunshade")) gl.addLayer({ id: "sunshade", type: "raster", source: "sunshade", paint: { "raster-fade-duration": 0 } }, before);
    };
    try { apply(); } catch { gl.once("style.load", () => { try { apply(); } catch {} }); }
  }
  // A new moment in 3D reloads every shade tile: at most once a second while the slider moves.
  function later3d() {
    const wait = last3d + 1000 - Date.now();
    if (wait <= 0) { last3d = Date.now(); sync3d(); return; }
    if (!timer3d) timer3d = setTimeout(() => { timer3d = 0; last3d = Date.now(); sync3d(); }, wait);
  }
  window.addEventListener("tf:map3d", () => setTimeout(sync3d, 0));

  // ---------- the time bar on the map ----------
  const css = document.createElement("style");
  css.textContent = `
.map-tools #shadeBtn.on { background: #2f3a5c; border-color: #2f3a5c; color: #fff; }
.sun-bar { position: absolute; z-index: 1001; top: 66px; left: 10px; right: 10px; max-width: 440px; margin: 0 auto; box-sizing: border-box;
  background: var(--card, #fff); color: var(--ink, #1d2433); border-radius: 14px; box-shadow: 0 4px 18px rgba(0,0,0,.18); padding: 8px 10px 6px; font-size: .82rem; }
.sun-bar[hidden] { display: none; }
.sun-bar .sb-row { display: flex; align-items: center; gap: 8px; }
.sun-bar .sb-ic { flex: none; width: 20px; height: 20px; }
.sun-bar .sb-when { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }
.sun-bar .sb-time { font-size: 1.05rem; font-weight: 700; }
.sun-bar .sb-day { border: 1px solid var(--line, #d8dde6); border-radius: 8px; background: none; color: inherit; font: inherit; padding: 2px 6px; position: relative; }
.sun-bar .sb-day input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; border: 0; padding: 0; }
.sun-bar button.sb-b { border: 1px solid var(--line, #d8dde6); background: none; color: inherit; border-radius: 8px; font: inherit; font-weight: 600; padding: 4px 8px; min-height: 32px; }
.sun-bar button.sb-x { border: 0; background: none; color: inherit; width: 32px; height: 32px; display: grid; place-items: center; padding: 0; }
.sun-bar .sb-track { position: relative; margin: 4px 2px 0; }
.sun-bar input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; margin: 0; height: 30px; background: transparent; position: relative; z-index: 1; touch-action: pan-x; }
.sun-bar input[type=range]::-webkit-slider-runnable-track { height: 30px; background: transparent; border: 0; }
.sun-bar input[type=range]::-moz-range-track { height: 30px; background: transparent; border: 0; }
.sun-bar input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 26px; height: 26px; margin-top: 2px; border-radius: 50%; background: #fff; border: 2px solid #2f3a5c; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
.sun-bar input[type=range]::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: #fff; border: 2px solid #2f3a5c; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
.sun-bar .sb-daylight { position: absolute; left: 0; right: 0; top: 12px; height: 6px; border-radius: 3px; background: #2f3a5c; overflow: hidden; }
.sun-bar .sb-daylight i { position: absolute; top: 0; bottom: 0; background: #f6c445; }
.sun-bar .sb-foot { display: flex; justify-content: space-between; gap: 8px; color: var(--muted, #5b6575); font-size: .74rem; }
.sun-bar .sb-key { display: inline-flex; align-items: center; gap: 4px; }
.sun-bar .sb-key i { width: 12px; height: 12px; border-radius: 3px; background: rgba(24,32,58,.55); display: inline-block; }
.sun-bar .sb-note { margin: 2px 0 0; color: var(--muted, #5b6575); font-size: .72rem; }
`;
  document.head.append(css);
  const ICON = '<svg class="sb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 7.5a4.5 4.5 0 0 1 0 9z" fill="currentColor"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const bar = document.createElement("div");
  bar.className = "sun-bar"; bar.id = "sunBar"; bar.hidden = true;
  bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Sun and shade: pick a date and time");
  bar.innerHTML = `<div class="sb-row">${ICON}<div class="sb-when"><span class="sb-time" id="sbTime"></span><label class="sb-day"><span id="sbDay"></span><input type="date" id="sbDate" aria-label="Date"></label></div>`
    + `<button type="button" class="sb-b" id="sbNow">Now</button><button type="button" class="sb-x" id="sbClose" aria-label="Turn off Sun and shade"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`
    + `<div class="sb-track"><div class="sb-daylight" id="sbLight"></div><input type="range" id="sbRange" min="0" max="1435" step="5" aria-label="Time of day"></div>`
    + `<div class="sb-foot"><span id="sbSun"></span><span class="sb-key"><i></i><span>In shade</span></span></div>`
    + `<p class="sb-note">Shade from the terrain, an estimate from terrain heights and the sun's position. Trees, buildings and clouds aren't counted.</p>`;
  (map.getContainer().parentElement || document.body).append(bar);
  // Taps and drags on the bar don't move the map under it.
  L.DomEvent.disableClickPropagation(bar); L.DomEvent.disableScrollPropagation(bar);
  const range = $("sbRange"), dateIn = $("sbDate");
  const iso = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  function labels() {
    const c = map.getCenter(), t = moment(), s = engine.sun(t, c.lat, c.lng), st = sunTimes(c.lat, c.lng);
    $("sbTime").textContent = fmtTime(t);
    $("sbDay").textContent = fmtDay(day);
    dateIn.value = iso(day);
    range.value = String(mins);
    const pct = (m) => `${(m / 1440) * 100}%`;
    const light = $("sbLight");
    if (st.rise == null && st.set == null) light.innerHTML = st.up ? `<i style="left:0;right:0"></i>` : "";
    else light.innerHTML = `<i style="left:${pct(st.rise == null ? 0 : st.rise)};right:${st.set == null ? "0" : `calc(100% - ${pct(st.set)})`}"></i>`;
    const tm = (m) => { const d = new Date(day); d.setHours(0, m, 0, 0); return fmtTime(d.getTime()); };
    const alt = Math.round(s.alt * 180 / Math.PI);
    const parts = [];
    if (alt <= 0) parts.push(T("Sun down here"));
    else parts.push(`${T("Sun")} ${alt}° ${T("high")}`);
    if (st.rise != null) parts.push(`${T("rise")} ${tm(st.rise)}`);
    if (st.set != null) parts.push(`${T("set")} ${tm(st.set)}`);
    if (st.rise == null && st.set == null) parts.push(T(st.up ? "Sun up all day" : "Sun down all day"));
    $("sbSun").textContent = parts.join(" · ");
  }
  let raf = 0;
  function changed(fast) {
    labels();
    if (raf) return;
    // While the finger is on the slider: the flat map at most every 300 ms, 3D once a second.
    raf = setTimeout(() => { raf = 0; draw2d(); later3d(); }, fast ? 300 : 0);
  }
  range.addEventListener("input", () => { mins = +range.value; changed(true); });
  range.addEventListener("change", () => { mins = +range.value; changed(false); });
  dateIn.addEventListener("change", () => {
    const v = dateIn.value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!v) return;
    day = new Date(+v[1], +v[2] - 1, +v[3]).getTime();
    changed(false);
  });
  $("sbNow").addEventListener("click", () => {
    const d = now(); day = midnight(d); mins = d.getHours() * 60 + Math.floor(d.getMinutes() / 5) * 5;
    changed(false);
  });
  $("sbClose").addEventListener("click", () => setOn(false));
  map.on("moveend", () => { if (on) labels(); });

  // ---------- the button ----------
  let on = store.get("sunshade", false);
  function setOn(v) {
    on = v; store.set("sunshade", on);
    if (on && map.getZoom() < MIN_ZOOM) map.setZoom(MIN_ZOOM + 2);
    refresh();
  }
  function refresh() {
    draw2d(); sync3d();
    bar.hidden = !on;
    if (on) labels();
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
  }
  btn.title = "Show where the terrain is in shade at a date and time you pick, on the flat and 3D maps";
  btn.addEventListener("click", () => setOn(!on));
  refresh();
  window.tfSunShade = { setOn, isOn: () => on, at: (ms) => { day = midnight(new Date(ms)); const d = new Date(ms); mins = d.getHours() * 60 + d.getMinutes(); changed(false); } };
})();
