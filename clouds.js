// Clouds for the trail finder, like Windy's cloud layer: "☁ Clouds" in Layers, in every sport, on the flat and 3D
// maps. A slim slider at the bottom of the map moves through the next 3 days, hour by hour (▶ plays it).
// - Now: the real clouds from the GOES weather satellites (NASA GIBS, infrared, every 10 minutes): white where the
//   cloud tops are cold. GOES-West over the west, GOES-East over the east.
// - Later hours: the forecast as soft white clouds over a slightly dimmed map, with rain in blue and snow in
//   purple, fading from one hour to the next (alex 2026-10-24: "i dont like the cloud layer", make it like Windy).
// - 3D map: the ground that sits inside the cloud at that hour turns foggy white (no view up there), and the ground
//   under cloud gets a soft shadow. Built from the model's cloud cover at heights from about 500 to 4,200 m and the
//   real terrain heights, so "in cloud above 1,800 m" shows on the mountains themselves.
// - "Clouds by height" (in the bar, and in Skiing route and hut details): an hour-by-hour chart of where the cloud
//   sits against the height of the spot (or the route's top and bottom), with the freezing level, and each hour
//   marked clear, under the clouds, in the clouds or above the clouds.
// The forecast is Open-Meteo (free, no key, CC BY 4.0), asked for a grid of points over the map (at most 80 at a time,
// kept for 45 minutes) so the free daily limit goes a long way.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {   // "tf:setting" tells account.js (optional sign-in) to save settings to the rider's account
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtM = (m) => `${Math.round(m).toLocaleString("en-CA")} m`;
  const API = "https://api.open-meteo.com/v1/forecast";
  const ATTR = 'Clouds: <a href="https://open-meteo.com/">Open-Meteo</a> (CC BY 4.0)';
  const HOURS = 72;
  // Canada's own model (HRDPS 2.5 km, then the regional and global GEM). Open-Meteo's automatic choice gave GFS
  // over BC, whose "low cloud 100%" disagreed with its own cloud at each height (0% up to 2,000 m), so the map,
  // the 3D mist and the chart told different stories (alex 2026-10-24, Whistler).
  const MODEL = "gem_seamless";
  // Cloud cover at a height counts as "in the cloud" from this much: the model's cover at a height comes from the
  // humidity there, and 50% is already about 94% humidity, grey and little view.
  const IN_CLOUD = 50;
  // Pressure levels and their usual height (m above sea level). Standard heights are within about 100 m of the real
  // ones, close enough for "is this ridge in the cloud".
  const LEVELS = [[950, 540], [900, 990], [850, 1460], [800, 1950], [700, 3010], [600, 4200]];
  const VARS = ["cloud_cover", "cloud_cover_low", "precipitation", "snowfall", ...LEVELS.map(([p]) => `cloud_cover_${p}hPa`)];   // 10: one call each
  const V = { cc: 0, low: 1, pr: 2, sn: 3, lev: 4 };
  const MAX_PTS = 80, PER_REQ = 20, KEEP_MS = 45 * 60000;
  const STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2];   // degrees of latitude between grid points; longitude 1.5x that
  const LON_K = 1.5;

  const css = document.createElement("style");
  css.textContent = `
.map-tools #cloudBtn.on { background: #4a6fa5; border-color: #4a6fa5; color: #fff; }
.cl-bar { position: absolute; z-index: 610; left: 50%; bottom: 28px; transform: translateX(-50%); width: min(480px, calc(100% - 24px)); box-sizing: border-box;
  padding: 6px 8px; border-radius: 12px; background: var(--panel); color: var(--fg); border: 1px solid var(--line); box-shadow: 0 2px 10px rgba(0,0,0,.25); font-size: .85rem; }
.cl-bar[hidden] { display: none; }
.cl-row { display: flex; align-items: center; gap: 8px; }
.cl-row input[type=range] { flex: 1; min-width: 0; accent-color: #4a6fa5; height: 28px; }
.cl-bar button { font: inherit; font-weight: 700; padding: 5px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--chip, transparent); color: var(--fg); cursor: pointer; flex: none; }
.cl-when { font-weight: 800; min-width: 6.2em; text-align: right; white-space: nowrap; }
.cl-here { margin: 2px 0 0; font-size: .78rem; color: var(--muted); line-height: 1.3; }
.cl-key { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 4px 0 0; color: var(--muted); font-size: .74rem; }
.cl-key i { display: inline-block; width: 12px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; border: 1px solid #0003; }
.cl-bar .cl-ico { padding: 4px 8px; }
.cl-bar .cl-ico[aria-pressed=true] { background: #4a6fa5; border-color: #4a6fa5; color: #fff; }
#clMore { margin-top: 6px; }
.leaflet-clouds-pane img.leaflet-image-layer { transition: opacity .45s ease; }
/* Like Windy: the map a little darker under the clouds, so white cloud stands out on any map style. */
.mapwrap.cl-dim .leaflet-tile-pane { filter: brightness(.78) saturate(.8); }
.mapwrap.cl-dim.cl-photo .leaflet-tile-pane { filter: brightness(.88); }
.cl-chart svg { display: block; width: 100%; height: auto; touch-action: pan-y; cursor: pointer; }
.cl-chart .cl-sum { margin: 4px 0 0; font-size: .8rem; }
.cl-chart .cl-note { color: var(--muted); font-size: .72rem; margin: 4px 0 0; }
.cl-bar .cl-chart { max-height: 40vh; overflow: auto; }
.mapwrap.ps-on .cl-bar { bottom: 120px; }
@media (max-width: 760px) { .cl-bar { left: 12px; right: 12px; transform: none; width: auto; bottom: calc(var(--sheet-vis, 0px) + 44px); } .cl-bar .cl-chart { max-height: 30vh; } }
`;
  document.head.append(css);

  // ---------- the forecast grid ----------
  const pts = new Map();   // "step:i:j" -> { at, t0, e, v: [[72 values] x VARS] }
  let field = null;        // the grid on the map now: { step, i0, j0, nI, nJ, cells: [point or null], ver }
  let ver = 0, loading = null, note = "";
  const keyOf = (step, i, j) => `${step}:${i}:${j}`;
  function pickGrid(b) {
    const s = b.getSouth(), n = b.getNorth(), w = b.getWest(), e = b.getEast();
    for (const step of STEPS) {
      const i0 = Math.floor(s / step), i1 = Math.ceil(n / step), j0 = Math.floor(w / (step * LON_K)), j1 = Math.ceil(e / (step * LON_K));
      if ((i1 - i0 + 1) * (j1 - j0 + 1) <= MAX_PTS || step === STEPS.at(-1)) {
        let nI = i1 - i0 + 1, nJ = j1 - j0 + 1, a = i0, c = j0;
        // Wider than the coarsest grid allows (most of Canada on screen): keep the middle.
        while (nI * nJ > MAX_PTS) { if (nJ >= nI) { nJ--; if (nJ % 2) c++; } else { nI--; if (nI % 2) a++; } }
        return { step, i0: a, j0: c, nI, nJ };
      }
    }
  }
  // Small requests, three at a time, each drawn as it comes in: the weather server is sometimes slow with the
  // height levels, and one stuck request shouldn't hold up the whole map. A failed one is tried once more.
  async function getPoints(list, onPart) {
    const parts = [];
    for (let k = 0; k < list.length; k += PER_REQ) parts.push(list.slice(k, k + PER_REQ));
    let err = null;
    const one = async (part, retry) => {
      const u = `${API}?latitude=${part.map((p) => p.lat.toFixed(3)).join(",")}&longitude=${part.map((p) => p.lon.toFixed(3)).join(",")}`
        + `&hourly=${VARS.join(",")}&forecast_hours=${HOURS + 1}&timeformat=unixtime&timezone=GMT&models=${MODEL}`;
      try {
        const r = await fetch(u, window.AbortSignal && AbortSignal.timeout ? { signal: AbortSignal.timeout(20000) } : undefined);
        if (!r.ok) throw new Error(r.status === 429 ? "too many weather requests for now, try again in a minute" : `HTTP ${r.status}`);
        let d = await r.json();
        if (!Array.isArray(d)) d = [d];
        d.forEach((x, i) => {
          const h = x.hourly || {};
          pts.set(part[i].key, { at: Date.now(), t0: (h.time || [0])[0], e: x.elevation || 0, v: VARS.map((name) => h[name] || []) });
        });
        onPart();
      } catch (e) {
        if (retry && !/too many/.test(e.message)) return one(part, false);
        err = e.name === "TimeoutError" ? new Error("the weather server is slow, try again soon") : e;
      }
    };
    const queue = parts.slice();
    await Promise.all([0, 1, 2].map(async () => { while (queue.length) await one(queue.shift(), true); }));
    if (pts.size > 3000) for (const k of [...pts.keys()].slice(0, pts.size - 3000)) pts.delete(k);
    if (err) throw err;
  }
  function viewBox() {
    const in3d = !!(window.trailMap3d && map.getContainer().classList.contains("is3d"));
    return map.getBounds().pad(in3d ? 1.5 : 0.4);   // a tilted 3D view sees far past the flat map's edges
  }
  // The grid on hand still covers what's on screen (with a margin) at the same spacing: keep it. Building a new
  // one redraws every 3D tile, and the 3D map moves the flat map on every turn (alex 2026-10-24: "my computer was
  // working hard").
  const covers = (f, b) => f.i0 * f.step <= b.getSouth() && (f.i0 + f.nI - 1) * f.step >= b.getNorth()
    && f.j0 * f.step * LON_K <= b.getWest() && (f.j0 + f.nJ - 1) * f.step * LON_K >= b.getEast();
  function refresh() {
    if (!on) return;
    const g = pickGrid(viewBox());
    const in3d = map.getContainer().classList.contains("is3d");
    if (field && !loading && field.step === g.step && Date.now() - field.at < KEEP_MS && covers(field, map.getBounds().pad(in3d ? 0.6 : 0.1))) return;
    const want = [];
    for (let i = g.i0; i < g.i0 + g.nI; i++) for (let j = g.j0; j < g.j0 + g.nJ; j++) {
      const key = keyOf(g.step, i, j), p = pts.get(key);
      if (!p || Date.now() - p.at > KEEP_MS) want.push({ key, lat: i * g.step, lon: j * g.step * LON_K });
    }
    const build = () => {
      const cells = [];
      for (let i = g.i0; i < g.i0 + g.nI; i++) for (let j = g.j0; j < g.j0 + g.nJ; j++) cells.push(pts.get(keyOf(g.step, i, j)) || null);
      field = { ...g, cells, ver: ++ver, at: Math.min(...cells.filter(Boolean).map((c) => c.at), Date.now()) };
      hourCache = null;
      draw();
    };
    if (!want.length) { if (!field || field.step !== g.step || field.i0 !== g.i0 || field.j0 !== g.j0 || field.nI !== g.nI || field.nJ !== g.nJ) build(); return; }
    const mine = (loading = getPoints(want, () => { if (loading === mine && on && (!field || !map.getContainer().classList.contains("is3d"))) build(); }).then(() => { note = ""; }, (e) => { note = `Couldn't load all the clouds (${e.message}).`; }));
    setNote();
    mine.then(() => { if (loading !== mine) return; loading = null; if (on) build(); setNote(); });
  }

  // ---------- one hour of the grid ----------
  let hour = 0, baseT = 0, hourCache = null;
  const nowHour = () => Math.floor(Date.now() / 3600000) * 3600;
  // Every variable at the chosen hour as a flat grid, for fast sampling.
  function gridAt(h) {
    if (!field) return null;
    if (hourCache && hourCache.h === h && hourCache.ver === field.ver) return hourCache;
    const T = baseT + h * 3600, n = field.nI * field.nJ;
    const g = VARS.map(() => new Float32Array(n).fill(NaN)), elev = new Float32Array(n).fill(NaN);
    field.cells.forEach((p, k) => {
      if (!p) return;
      const idx = Math.round((T - p.t0) / 3600);
      elev[k] = p.e;
      VARS.forEach((_, v) => { const x = p.v[v][Math.max(0, Math.min(p.v[v].length - 1, idx))]; g[v][k] = x == null ? NaN : x; });
    });
    return (hourCache = { h, ver: field.ver, g, elev });
  }
  // Bilinear sample of grid array a at lat/lon; NaN outside the grid.
  function sampler(lat, lon) {
    const fi = lat / field.step - field.i0, fj = lon / (field.step * LON_K) - field.j0;
    if (fi < 0 || fj < 0 || fi > field.nI - 1 || fj > field.nJ - 1) return null;
    const i = Math.min(field.nI - 2, Math.floor(fi)), j = Math.min(field.nJ - 2, Math.floor(fj));
    const a = Math.max(0, i), b = Math.max(0, j), u = field.nI > 1 ? fi - a : 0, w = field.nJ > 1 ? fj - b : 0;
    const k00 = a * field.nJ + b, k01 = field.nJ > 1 ? k00 + 1 : k00, k10 = field.nI > 1 ? k00 + field.nJ : k00, k11 = field.nI > 1 ? k01 + field.nJ : k01;
    // Faded over the last bit of the grid, so its edge doesn't show as a hard line.
    const fade = clamp01(Math.min(fi, field.nI - 1 - fi, fj, field.nJ - 1 - fj) / 0.6 + (field.nI < 3 || field.nJ < 3 ? 1 : 0));
    const f = (arr) => {
      const v00 = arr[k00], v01 = arr[k01], v10 = arr[k10], v11 = arr[k11];
      if (Number.isNaN(v00 + v01 + v10 + v11)) { const ok = [v00, v01, v10, v11].filter((x) => !Number.isNaN(x)); return ok.length ? ok.reduce((s, x) => s + x, 0) / ok.length : NaN; }
      return (v00 * (1 - w) + v01 * w) * (1 - u) + (v10 * (1 - w) + v11 * w) * u;
    };
    f.fade = fade;
    return f;
  }
  // A little cloud texture (value noise in map coordinates), so the cover looks like cloud, not smooth blobs.
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const sm = (t) => t * t * (3 - 2 * t);
  function vnoise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = sm(x - ix), fy = sm(y - iy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  const noise = (x, y) => 0.65 * vnoise(x, y) + 0.35 * vnoise(x * 2.3 + 17, y * 2.3 + 5);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const merc = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
  const unmerc = (y) => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;
  // ---------- flat map: cloud cover from above ----------
  map.createPane("clouds").style.zIndex = 380;   // over the photos, elevation lines and shading, under trails and pins
  map.getPane("clouds").style.pointerEvents = "none";
  const basemap = $("basemap");
  const restyle = () => setTimeout(() => { if (on) draw(); }, 0);
  if (basemap) basemap.addEventListener("change", restyle);
  if ($("satBtn")) $("satBtn").addEventListener("click", restyle);
  // Catmull-Rom (bicubic) through the 4 x 4 grid points around a spot: smooth, round shapes instead of the diamonds
  // straight lines between points make. Missing points take the value of the nearest one there is.
  function cubic(arr, fi, fj) {
    const nI = field.nI, nJ = field.nJ, i1 = Math.floor(fi), j1 = Math.floor(fj), u = fi - i1, w = fj - j1;
    const wt = (t) => [((-t + 2) * t - 1) * t / 2, (((3 * t - 5) * t) * t + 2) / 2, ((-3 * t + 4) * t + 1) * t / 2, ((t - 1) * t * t) / 2];
    const wu = wt(u), ww = wt(w);
    let v = 0, sum = 0;
    for (let a = 0; a < 4; a++) {
      const i = Math.max(0, Math.min(nI - 1, i1 - 1 + a));
      let row = 0, rs = 0;
      for (let c = 0; c < 4; c++) {
        const x = arr[i * nJ + Math.max(0, Math.min(nJ - 1, j1 - 1 + c))];
        if (!Number.isNaN(x)) { row += x * ww[c]; rs += ww[c]; }
      }
      if (rs) { v += (row / rs) * wu[a]; sum += wu[a]; }
    }
    return sum ? v / sum : NaN;
  }
  // Puffy cloud texture: a few layers of noise in map coordinates (so it doesn't swim when the map moves).
  const fbm = (x, y) => 0.5 * vnoise(x, y) + 0.27 * vnoise(x * 2.1 + 13, y * 2.1 + 7) + 0.15 * vnoise(x * 4.3 + 31, y * 4.3 + 3) + 0.08 * vnoise(x * 8.7 + 5, y * 8.7 + 29);
  // The forecast for one hour as a picture: soft white cloud, thick where it's overcast and broken into puffs where
  // it's partly cloudy, rain blue and snow purple through it.
  function paint2d(cv) {
    const H = gridAt(hour);
    if (!H) return null;
    const s = field.step, latS = field.i0 * s, latN = (field.i0 + field.nI - 1) * s, lonW = field.j0 * s * LON_K, lonE = (field.j0 + field.nJ - 1) * s * LON_K;
    const yN = merc(latN), yS = merc(latS), xW = (lonW + 180) / 360, xE = (lonE + 180) / 360;
    const W = 360, Hp = Math.max(48, Math.min(480, Math.round((W * (yS - yN)) / Math.max(1e-9, xE - xW))));
    cv.width = W; cv.height = Hp;
    const cx = cv.getContext("2d"), img = cx.createImageData(W, Hp), px = img.data;
    const K = 2.2 / s;   // about two puffs per grid step
    for (let y = 0; y < Hp; y++) {
      const lat = unmerc(yN + ((y + 0.5) / Hp) * (yS - yN)), fi = lat / s - field.i0;
      for (let x = 0; x < W; x++) {
        const lon = lonW + ((x + 0.5) / W) * (lonE - lonW), fj = lon / (s * LON_K) - field.j0, o = (y * W + x) * 4;
        const cc = clamp01(cubic(H.g[V.cc], fi, fj) / 100);
        if (Number.isNaN(cc)) continue;
        const low = clamp01(cubic(H.g[V.low], fi, fj) / 100), pr = Math.max(0, cubic(H.g[V.pr], fi, fj)), sn = Math.max(0, cubic(H.g[V.sn], fi, fj));
        const fade = clamp01(Math.min(fi, field.nI - 1 - fi, fj, field.nJ - 1 - fj) / 0.6 + (field.nI < 3 || field.nJ < 3 ? 1 : 0));
        // Cover plus texture, through a soft edge: 100% is a solid deck, 50% puffs with gaps, 10% a few wisps.
        const d = cc + 0.42 * (fbm((lon * K) / LON_K, lat * K) - 0.5) * (1 - 0.6 * cc);
        let a = sm(clamp01((d - 0.12) / 0.55)) * 0.86;
        const shade = 255 - 38 * low * cc;   // low, thick cloud a little grey underneath
        let r = shade, g = shade, b = Math.min(255, shade + 4);
        const wet = pr >= 0.15 ? Math.pow(clamp01(pr / 4), 0.6) * 0.6 : 0;
        if (wet > 0) {
          const snow = sn > 0.05 && sn * 7 >= pr * 0.5;   // cm of snow vs mm of water
          const [wr, wg, wb] = snow ? [200, 160, 245] : [70, 140, 255];
          const t = wet / Math.max(wet, a + wet * (1 - a));
          r = r * (1 - t) + wr * t; g = g * (1 - t) + wg * t; b = b * (1 - t) + wb * t;
          a = a + wet * (1 - a);
        }
        px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = Math.round(a * fade * 255);
      }
    }
    cx.putImageData(img, 0, 0);
    return { url: cv.toDataURL("image/png"), bounds: [[latS, lonW], [latN, lonE]] };
  }

  // ---------- flat map, now: the satellite ----------
  // GOES infrared (band 13, "clean longwave window") from NASA GIBS, free and public domain. Its colours are a code
  // for the temperature of what the satellite sees (colormaps/v1.3/Clean_Longwave_Infrared_Window_Band.xml): greys
  // from 197 (-19 °C) down to 1 (+57 °C), 0.39 °C a step, and colours (plus a few greys) for colder cloud tops.
  // Cold is cloud: from -15 °C it starts to show, from -45 °C it's solid white (snowy peaks on a cold night stay clear). 2 km pixels (zoom 6), smoothed when
  // closer. The newest picture is found by trying back from now in 10-minute steps (GIBS is 20-60 minutes behind).
  const GIBS = (id, t, z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${id}/default/${t}/GoogleMapsCompatible_Level6/${z}/${y}/${x}.png`;
  const SATS = { west: "GOES-West_ABI_Band13_Clean_Infrared", east: "GOES-East_ABI_Band13_Clean_Infrared" };
  const COLD_GREYS = new Set([255, 230, 204, 177, 155, 129, 102, 76, 54, 27, 5]);
  const satTime = {};   // west/east -> "2026-10-24T16:40:00Z"
  let satAt = 0, satFinding = null;
  function findSatTimes() {
    if (satFinding && Date.now() - satAt < 10 * 60000) return satFinding;
    satAt = Date.now();
    const iso = (ms) => new Date(ms).toISOString().slice(0, 17) + "00Z";
    const probe = async (k, x, y) => {
      const t0 = Math.floor((Date.now() - 15 * 60000) / 600000) * 600000;
      for (let i = 0; i < 10; i++) {
        const t = iso(t0 - i * 600000);
        try { const r = await fetch(GIBS(SATS[k], t, 3, x, y)); if (r.ok) { satTime[k] = t; return; } } catch {}
      }
    };
    return (satFinding = Promise.all([probe("west", 1, 2), probe("east", 2, 2)]));
  }
  // separable box blur, radius 2, on a 256×256 field
  function blur(F) {
    const T = new Float32Array(65536), R = 2, W = 2 * R + 1;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      let s = 0; for (let k = -R; k <= R; k++) s += F[y * 256 + Math.min(255, Math.max(0, x + k))];
      T[y * 256 + x] = s / W;
    }
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      let s = 0; for (let k = -R; k <= R; k++) s += T[Math.min(255, Math.max(0, y + k)) * 256 + x];
      F[y * 256 + x] = s / W;
    }
  }
  const SatLayer = L.GridLayer.extend({
    createTile(c, done) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      const n = 2 ** c.z, lon = ((c.x + 0.5) / n) * 360 - 180;
      let k = lon < -100 ? "west" : "east";
      if (!satTime[k]) k = k === "west" ? "east" : "west";
      const t = satTime[k];
      if (!t) { done(null, cv); return cv; }
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => {
        const cx = cv.getContext("2d", { willReadFrequently: true });
        cx.drawImage(im, 0, 0);
        let d;
        try { d = cx.getImageData(0, 0, 256, 256); } catch { done(null, cv); return; }
        const p = d.data, A = new Float32Array(65536), G = new Float32Array(65536);
        for (let i = 0, j = 0; i < p.length; i += 4, j++) {
          const r = p[i], g = p[i + 1], b = p[i + 2];
          let T;
          if (!p[i + 3]) T = 99;
          else if (r === g && g === b && !COLD_GREYS.has(r)) T = 57.07 - 0.3867 * r;
          else T = -60;
          A[j] = sm(clamp01((-15 - T) / 30)) * 0.85;
          G[j] = 1 - clamp01((-30 - T) / 25);   // thin, warmer cloud a touch grey
        }
        // soft edges like Windy: blur the 2 km pixels (edges clamped so tiles meet without seams)
        blur(A); blur(A); blur(G);
        for (let i = 0, j = 0; i < p.length; i += 4, j++) {
          p[i] = p[i + 1] = p[i + 2] = 255 - Math.round(28 * G[j]);
          p[i + 3] = Math.round(A[j] * 255);
        }
        cx.putImageData(d, 0, 0);
        done(null, cv);
      };
      im.onerror = () => done(null, cv);
      im.src = GIBS(SATS[k], t, c.z, c.x, c.y);
      return cv;
    },
  });
  const satLayer = new SatLayer({ pane: "clouds", maxNativeZoom: 6, minZoom: 1, maxZoom: 22, updateWhenZooming: false,
    attribution: 'Satellite clouds: <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>, NOAA GOES' });
  const useSat = () => hour === 0 && !!(satTime.west || satTime.east);
  const satLabel = () => { const t = satTime.west || satTime.east; return t ? new Date(t).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])\.?m\.?/i, " $1m") : ""; };

  // ---------- 3D map: the ground inside the cloud ----------
  // tfcloud://<field version>/<hour>/z/x/y: a see-through picture draped on the mountains, misty white where the
  // ground is in the cloud and a faint shadow where there's cloud overhead (alex 2026-10-24: the first version was
  // "really heavy"). Terrain heights from AWS Terrain Tiles (Mapzen). The source asks for 512 px tiles but gets
  // 128 px pictures (mist doesn't need detail; the map smooths them) and stops at zoom 11: few, small tiles (phone
  // memory). They're drawn in a background worker, so turning the map and playing the hours stay smooth.
  function fogEngine() {
    "use strict";
    const SIZE = 128;
    const AWS = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
    const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const unmerc = (y) => (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;
    const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const sm = (t) => t * t * (3 - 2 * t);
    const noise = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y), fx = sm(x - ix), fy = sm(y - iy); return (hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx) * (1 - fy) + (hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx) * fy; };
    const dems = new Map();
    // Heights at SIZE x SIZE, every other pixel of the 256 px tile (no smoothing: it would scramble the colour code).
    function dem(z, x, y) {
      const key = `${z}/${x}/${y}`;
      if (dems.has(key)) { const p = dems.get(key); dems.delete(key); dems.set(key, p); return p; }
      const p = fetch(AWS(z, x, y)).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); }).then((b) => createImageBitmap(b)).then((bmp) => {
        const cv = new OffscreenCanvas(256, 256), c = cv.getContext("2d", { willReadFrequently: true });
        c.imageSmoothingEnabled = false;
        c.drawImage(bmp, 0, 0, 256, 256); bmp.close && bmp.close();
        const d = c.getImageData(0, 0, 256, 256).data, e = new Int16Array(SIZE * SIZE), k = 256 / SIZE;
        for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
          const o = ((j * k) * 256 + i * k) * 4;
          e[j * SIZE + i] = Math.max(-32768, Math.min(32767, Math.round(d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768)));
        }
        return e;
      });
      p.catch(() => dems.delete(key));
      dems.set(key, p);
      if (dems.size > 60) dems.delete(dems.keys().next().value);
      return p;
    }
    // g: { step, lonK, i0, j0, nI, nJ, cc: Float32Array, lev: [Float32Array], hts: [m] } for one hour.
    return async function draw(g, z, x, y) {
      const img = new ImageData(SIZE, SIZE), px = img.data, n = 2 ** z, L = g.lev.length, levs = new Array(L);
      const e = await dem(z, x, y).catch(() => null);
      for (let py = 0; py < SIZE; py++) {
        const lat = unmerc((y + (py + 0.5) / SIZE) / n), fi = lat / g.step - g.i0;
        if (fi < 0 || fi > g.nI - 1) continue;
        for (let pq = 0; pq < SIZE; pq++) {
          const lon = ((x + (pq + 0.5) / SIZE) / n) * 360 - 180, fj = lon / (g.step * g.lonK) - g.j0;
          if (fj < 0 || fj > g.nJ - 1) continue;
          const i = Math.max(0, Math.min(g.nI - 2, Math.floor(fi))), j = Math.max(0, Math.min(g.nJ - 2, Math.floor(fj)));
          const u = g.nI > 1 ? fi - i : 0, w = g.nJ > 1 ? fj - j : 0;
          const k00 = i * g.nJ + j, k01 = g.nJ > 1 ? k00 + 1 : k00, k10 = g.nI > 1 ? k00 + g.nJ : k00, k11 = g.nI > 1 ? k01 + g.nJ : k01;
          const at = (a) => { const v = (a[k00] * (1 - w) + a[k01] * w) * (1 - u) + (a[k10] * (1 - w) + a[k11] * w) * u; return Number.isNaN(v) ? 0 : v; };
          const fade = clamp01(Math.min(fi, g.nI - 1 - fi, fj, g.nJ - 1 - fj) / 0.6 + (g.nI < 3 || g.nJ < 3 ? 1 : 0));
          const cc = clamp01(at(g.cc) / 100);
          let a = 0.12 * cc, r = 40, gg = 50, b = 64;   // a faint shade from cloud overhead
          if (e) {
            for (let k = 0; k < L; k++) levs[k] = at(g.lev[k]);
            const h = e[py * SIZE + pq];
            let inC;
            if (h <= g.hts[0]) inC = levs[0];
            else if (h >= g.hts[L - 1]) inC = levs[L - 1] * Math.max(0, 1 - (h - g.hts[L - 1]) / 1500);
            else for (let k = 1; k < L; k++) if (h <= g.hts[k]) { const t = (h - g.hts[k - 1]) / (g.hts[k] - g.hts[k - 1]); inC = levs[k - 1] * (1 - t) + levs[k] * t; break; }
            // Grey mist, not a white sheet (white vanished on snow): at most about 60%, so the ridges still read under it. From 30% cover at that
            // height, full from 60% (50% is already "in the cloud" for the chart and the line in the bar).
            const f = clamp01((inC - 30) / 30) * 0.62 * (0.8 + 0.3 * noise(lon * 60, lat * 90));
            if (f > 0) { const t = Math.min(1, f / Math.max(0.01, f + a * (1 - f))); r = r * (1 - t) + 196 * t; gg = gg * (1 - t) + 204 * t; b = b * (1 - t) + 216 * t; a = f + a * (1 - f); }
          }
          const o = (py * SIZE + pq) * 4;
          px[o] = r; px[o + 1] = gg; px[o + 2] = b; px[o + 3] = Math.round(clamp01(a) * fade * 255);
        }
      }
      return createImageBitmap(img);
    };
  }
  // One worker draws the tiles; the hour's grid is sent to it once. Old browsers draw them here instead.
  let fogWorker = null, fogLocal = null, fogNext = 0, sentKey = "";
  const fogWait = new Map();
  try {
    if (window.Worker && window.OffscreenCanvas) {
      const code = `${fogEngine.toString()}
const draw = fogEngine(), grids = new Map();
onmessage = async (e) => {
  const m = e.data;
  if (m.grid) { grids.set(m.key, m.grid); if (grids.size > 4) grids.delete(grids.keys().next().value); return; }
  const g = grids.get(m.key);
  let bmp = null;
  try { if (g) bmp = await draw(g, m.z, m.x, m.y); } catch {}
  postMessage({ id: m.id, bmp }, bmp ? [bmp] : []);
};`;
      fogWorker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
      fogWorker.onmessage = (e) => { const r = fogWait.get(e.data.id); if (r) { fogWait.delete(e.data.id); r(e.data.bmp); } };
    }
  } catch { fogWorker = null; }
  function hourGrid(h) {
    const H = gridAt(h);
    return H && { step: field.step, lonK: LON_K, i0: field.i0, j0: field.j0, nI: field.nI, nJ: field.nJ, cc: H.g[V.cc], lev: LEVELS.map((_, k) => H.g[V.lev + k]), hts: LEVELS.map(([, m]) => m) };
  }
  async function fogTile(h, z, x, y) {
    const empty = () => createImageBitmap(new ImageData(1, 1));
    if (!field) return empty();
    const key = `${field.ver}/${h}`;
    if (!fogWorker) { fogLocal = fogLocal || fogEngine(); const g = hourGrid(h); return g ? fogLocal(g, z, x, y) : empty(); }
    if (sentKey !== key) { const g = hourGrid(h); if (!g) return empty(); fogWorker.postMessage({ grid: g, key }); sentKey = key; }
    const id = fogNext++;
    const bmp = await new Promise((ok) => { fogWait.set(id, ok); fogWorker.postMessage({ id, key, z, x, y }); });
    return bmp || empty();
  }
  let protocol = false;
  const tilesUrl = () => `tfcloud://${field ? field.ver : 0}/${hour}/{z}/{x}/{y}`;
  function sync3d() {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    if (!protocol) {
      protocol = true;
      maplibregl.addProtocol("tfcloud", async (params) => {
        const [, h, z, x, y] = params.url.replace("tfcloud://", "").split("/").map(Number);
        return { data: await fogTile(h, z, x, y) };
      });
    }
    const apply = () => {
      if (!on || !field) { if (gl.getLayer("clouds")) gl.removeLayer("clouds"); if (gl.getSource("clouds")) gl.removeSource("clouds"); return; }
      const src = gl.getSource("clouds");
      if (src) { if (src._clUrl !== tilesUrl()) { src._clUrl = tilesUrl(); src.setTiles([tilesUrl()]); } return; }
      gl.addSource("clouds", { type: "raster", tiles: [tilesUrl()], tileSize: 512, maxzoom: 11, attribution: ATTR });
      gl.getSource("clouds")._clUrl = tilesUrl();
      // With the other pictures on the ground, before the road and trail lines (one set of paint buffers: phone memory).
      const before = ["osm-roads", "lines"].find((id) => gl.getLayer(id));
      gl.addLayer({ id: "clouds", type: "raster", source: "clouds", paint: { "raster-fade-duration": 0 } }, before);
    };
    try { apply(); } catch { gl.once("style.load", () => { try { apply(); } catch {} }); }
  }
  window.addEventListener("tf:map3d", () => setTimeout(() => { sync3d(); if (on) refresh(); }, 0));
  if ($("btn3d")) $("btn3d").addEventListener("click", () => setTimeout(() => { if (on) { refresh(); draw(); } }, 50));

  // ---------- drawing ----------
  let draw3dTimer = 0;
  // Two pictures take turns, so one hour fades into the next instead of jumping.
  const cvs = [document.createElement("canvas"), document.createElement("canvas")], overlays = [null, null];
  let front = 0;
  function show2d() {
    const flat = !map.getContainer().classList.contains("is3d"), sat = useSat();
    wrap.classList.toggle("cl-dim", on && flat);
    wrap.classList.toggle("cl-photo", !!(basemap && /^sat/.test(basemap.value)));
    if (on && flat && sat) { if (!map.hasLayer(satLayer)) satLayer.addTo(map); }
    else if (map.hasLayer(satLayer)) map.removeLayer(satLayer);
    if (!on || !flat || sat) { overlays.forEach((o) => o && o.setOpacity(0)); return false; }
    return true;
  }
  function draw() {
    if (!on) return;
    if (show2d() && field) {
      const k = front ^ 1, p = paint2d(cvs[k]);
      if (p) {
        let o = overlays[k];
        if (!o) o = overlays[k] = L.imageOverlay(p.url, p.bounds, { pane: "clouds", interactive: false, opacity: 0, attribution: ATTR }).addTo(map);
        else { o.setBounds(L.latLngBounds(p.bounds)); o.setUrl(p.url); if (!map.hasLayer(o)) o.addTo(map); }
        const old = overlays[front];
        const swap = () => { o.setOpacity(1); if (old && old !== o) old.setOpacity(0); };
        const el = o.getElement();
        if (el && !el.complete) el.addEventListener("load", swap, { once: true }); else swap();
        front = k;
      }
    }
    if (!field) { here(); return; }
    // The 3D pictures are slower to make: wait until the slider rests a moment.
    clearTimeout(draw3dTimer);
    draw3dTimer = setTimeout(sync3d, playing ? 0 : 400);
    here();
    window.dispatchEvent(new CustomEvent("tf:cloudhour", { detail: hour }));
  }

  // ---------- the bar ----------
  const wrap = map.getContainer().parentElement;
  const bar = document.createElement("div");
  bar.className = "cl-bar"; bar.hidden = true; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Clouds forecast");
  bar.innerHTML = `<div class="cl-row"><button type="button" id="clPlay" aria-label="Play the next hours">▶</button>
<input type="range" id="clHour" min="0" max="${HOURS}" step="1" value="0" aria-label="Forecast hour">
<span class="cl-when" id="clWhen">Now</span><button type="button" class="cl-ico" id="clChartBtn" aria-pressed="false" aria-label="Clouds by height here, hour by hour" title="Clouds by height here, hour by hour">📈</button><button type="button" class="cl-ico" id="clClose" aria-label="Turn clouds off">✕</button></div>
<p class="cl-here" id="clHere" aria-live="polite"></p>
<div id="clMore" hidden><div class="cl-chart" id="clChart"></div></div>`;
  wrap.append(bar);
  const slider = $("clHour"), whenEl = $("clWhen"), playBtn = $("clPlay");
  const label = (h) => {
    if (h === 0) return "Now";   // the satellite time is in the line under the slider
    const d = new Date((baseT + h * 3600) * 1000), today = new Date().toDateString() === d.toDateString();
    const t = d.toLocaleTimeString("en-CA", { hour: "numeric" }).replace(/\s?([ap])\.?m\.?/i, " $1m");
    return `${today ? "Today" : d.toLocaleDateString("en-CA", { weekday: "short" })} ${t}`;
  };
  function setHour(h, from) {
    hour = Math.max(0, Math.min(HOURS, Math.round(h)));
    if (from !== "slider") slider.value = String(hour);
    whenEl.textContent = label(hour);
    draw();
    if (!field) window.dispatchEvent(new CustomEvent("tf:cloudhour", { detail: hour }));   // smoke.js follows even while the clouds load
  }
  slider.addEventListener("input", () => setHour(+slider.value, "slider"));
  let playing = 0;
  function stop() { clearInterval(playing); playing = 0; playBtn.textContent = "▶"; playBtn.setAttribute("aria-label", "Play the next hours"); }
  playBtn.addEventListener("click", () => {
    if (playing) return stop();
    if (hour >= HOURS) setHour(0);
    playBtn.textContent = "❚❚"; playBtn.setAttribute("aria-label", "Pause");
    const in3d = map.getContainer().classList.contains("is3d");
    playing = setInterval(() => { if (hour >= HOURS) stop(); else setHour(hour + 1); }, in3d ? 1400 : 600);
  });
  $("clClose").addEventListener("click", () => btn.click());

  const coverWord = (c) => (c < 10 ? "clear" : c < 35 ? "a few clouds" : c < 65 ? "partly cloudy" : c < 90 ? "mostly cloudy" : "overcast");
  // One short line under the slider: what you're looking at, and the forecast at the map centre.
  function here() {
    const el = $("clHere");
    const sat = useSat(), in3d = map.getContainer().classList.contains("is3d");
    const lead = sat && !in3d ? `Satellite ${satLabel()}` : hour === 0 ? "Forecast now" : "Forecast";
    const H = gridAt(hour), c = map.getCenter(), at = H && sampler(c.lat, c.lng);
    if (!at) { el.textContent = note || (loading ? `${lead} · loading…` : lead); return; }
    const cc = at(H.g[V.cc]), pr = at(H.g[V.pr]), sn = at(H.g[V.sn]);
    const levs = LEVELS.map((_, k) => at(H.g[V.lev + k]));
    const base = LEVELS.find((_, k) => levs[k] >= IN_CLOUD);
    const bits = [lead, `${Math.round(cc)}% cloud`];
    if (pr >= 0.1) bits.push(sn > 0.05 && sn * 7 >= pr * 0.5 ? `snow ${sn.toFixed(1)} cm/h` : `rain ${pr.toFixed(1)} mm/h`);
    if (base) bits.push(base[1] <= 600 ? "cloud down to the valleys" : `in cloud above ${fmtM(Math.round(base[1] / 100) * 100)}${in3d ? " (grey mist)" : ""}`);
    el.textContent = bits.join(" · ") + (note ? ". " + note : "");
    if (!$("clMore").hidden) chartHere();
  }
  function setNote() { here(); }

  // ---------- clouds by height: the chart ----------
  // One spot, all the levels from the valley up to 5,500 m, plus the freezing level and day or night.
  const CH_LEVELS = [[1000, 110], [975, 320], [950, 540], [925, 760], [900, 990], [850, 1460], [800, 1950], [700, 3010], [600, 4200], [500, 5570]];
  const chCache = new Map();
  function profile(lat, lon) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`, c = chCache.get(key);
    if (c && Date.now() - c.at < KEEP_MS) return c.p;
    const get = (q) => fetch(`${API}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&${q}&forecast_hours=${HOURS + 1}&timeformat=unixtime&timezone=GMT`)
      .then((r) => { if (!r.ok) throw new Error(r.status === 429 ? "too many weather requests for now, try again in a minute" : `HTTP ${r.status}`); return r.json(); });
    // The clouds from the same model as the map; the freezing level from Open-Meteo's usual pick (not every model
    // has it), and the chart simply goes without it if that fails.
    const p = Promise.all([
      get(`hourly=${CH_LEVELS.map(([q]) => `cloud_cover_${q}hPa`).join(",")},is_day&models=${MODEL}`),
      get("hourly=freezing_level_height").catch(() => null),
    ]).then(([d, f]) => {
      const fz = f && f.hourly && f.hourly.freezing_level_height;
      if (fz && f.hourly.time) d.hourly.freezing_level_height = d.hourly.time.map((t) => { const i = f.hourly.time.indexOf(t); return i >= 0 ? fz[i] : null; });
      return d;
    });
    p.catch(() => chCache.delete(key));
    chCache.set(key, { at: Date.now(), p });
    if (chCache.size > 30) chCache.delete(chCache.keys().next().value);
    return p;
  }
  const STATES = {
    clear: ["#ffd43b", "Clear"], under: ["#adb5bd", "Under the clouds"], inside: ["#495057", "In the clouds"], above: ["#7950f2", "Above the clouds"],
  };
  // At height e: in the cloud (60%+ there), above a cloud layer below (with clear sky above), under one, or clear.
  function stateAt(levCov, e, ground) {
    const cAt = (h) => { for (let k = 1; k < CH_LEVELS.length; k++) if (h <= CH_LEVELS[k][1]) { const t = Math.max(0, (h - CH_LEVELS[k - 1][1]) / (CH_LEVELS[k][1] - CH_LEVELS[k - 1][1])); return levCov[k - 1] * (1 - t) + levCov[k] * t; } return levCov.at(-1); };
    if (cAt(e) >= IN_CLOUD) return "inside";
    const below = CH_LEVELS.some(([, h], k) => h < e - 150 && h >= ground - 200 && levCov[k] >= IN_CLOUD);
    const over = CH_LEVELS.some(([, h], k) => h > e + 150 && levCov[k] >= IN_CLOUD);
    return below && !over ? "above" : over ? "under" : "clear";
  }
  function chartSvg(d, lo, hi, opts) {
    const h = d.hourly, n = Math.min(HOURS + 1, (h.time || []).length);
    const T0 = baseT || nowHour(), off = Math.max(0, Math.round((T0 - h.time[0]) / 3600));
    const W = 340, L0 = 34, R0 = 4, top = 6, plotH = 120, stripH = 12, Hh = top + plotH + 6 + stripH + 16;
    const ymin = Math.max(0, Math.floor((lo - 700) / 500) * 500), ymax = Math.min(5600, Math.max(ymin + 2500, Math.ceil((hi + 1500) / 500) * 500));
    const X = (i) => L0 + (i / HOURS) * (W - L0 - R0), Y = (e) => top + plotH - ((e - ymin) / (ymax - ymin)) * plotH;
    const cw = (W - L0 - R0) / HOURS;
    let s = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Clouds by height over the next 3 days">`;
    s += `<rect x="${L0}" y="${top}" width="${W - L0 - R0}" height="${plotH}" fill="#6fa8dc"/>`;
    const edges = CH_LEVELS.map(([, e], k) => [k ? (e + CH_LEVELS[k - 1][1]) / 2 : 0, k < CH_LEVELS.length - 1 ? (e + CH_LEVELS[k + 1][1]) / 2 : 6500]);
    const states = [];
    for (let i = 0; i <= HOURS && off + i < n; i++) {
      const j = off + i, x = X(i) - (i ? cw / 2 : 0), w = i && i < HOURS ? cw : cw / 2;
      if (h.is_day && h.is_day[j] === 0) s += `<rect x="${x.toFixed(1)}" y="${top}" width="${w.toFixed(2)}" height="${plotH}" fill="#3d5a86"/>`;
      const levCov = CH_LEVELS.map(([q]) => (h[`cloud_cover_${q}hPa`] || [])[j] || 0);
      CH_LEVELS.forEach((_, k) => {
        const c = levCov[k];
        if (c < 8) return;
        const y1 = Y(Math.min(ymax, edges[k][1])), y2 = Y(Math.max(ymin, edges[k][0]));
        if (y2 <= y1) return;
        s += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${(w + 0.3).toFixed(2)}" height="${(y2 - y1).toFixed(1)}" fill="#fff" fill-opacity="${(0.15 + 0.8 * c / 100).toFixed(2)}"/>`;
      });
      states.push(stateAt(levCov, hi, lo));
    }
    // Freezing level
    if (h.freezing_level_height) {
      const pl = [];
      for (let i = 0; i <= HOURS && off + i < n; i++) { const f = h.freezing_level_height[off + i]; if (f != null) pl.push(`${X(i).toFixed(1)},${Y(Math.max(ymin, Math.min(ymax, f))).toFixed(1)}`); }
      s += `<polyline points="${pl.join(" ")}" fill="none" stroke="#1971c2" stroke-width="1.6" stroke-dasharray="4 3"/>`;
    }
    // The spot or route
    const line = (e, t) => `<line x1="${L0}" x2="${W - R0}" y1="${Y(e).toFixed(1)}" y2="${Y(e).toFixed(1)}" stroke="#e8590c" stroke-width="1.6"/><text x="${W - R0 - 2}" y="${(Y(e) - 3).toFixed(1)}" text-anchor="end" font-size="9" font-weight="700" fill="#e8590c" stroke="#fff" stroke-width="2.5" paint-order="stroke">${t}</text>`;
    if (hi - lo >= 60) s += `<rect x="${L0}" y="${Y(hi).toFixed(1)}" width="${W - L0 - R0}" height="${(Y(lo) - Y(hi)).toFixed(1)}" fill="#e8590c" fill-opacity=".12"/>` + line(hi, `${opts.topWord} ${fmtM(hi)}`) + line(lo, `${opts.botWord} ${fmtM(lo)}`);
    else s += line(hi, `${opts.oneWord} ${fmtM(hi)}`);
    // Height axis
    for (let e = ymin; e <= ymax; e += ymax - ymin > 3000 ? 1000 : 500) s += `<text x="${L0 - 3}" y="${(Y(e) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="currentColor" opacity=".7">${e >= 1000 ? (e / 1000).toFixed(e % 1000 ? 1 : 0) + " km" : e + " m"}</text>`;
    // State strip and day labels
    const sy = top + plotH + 6;
    states.forEach((st, i) => { s += `<rect x="${(X(i) - (i ? cw / 2 : 0)).toFixed(1)}" y="${sy}" width="${((i && i < HOURS ? cw : cw / 2) + 0.3).toFixed(2)}" height="${stripH}" fill="${STATES[st][0]}"/>`; });
    for (let i = 0; i <= HOURS; i++) {
      const d0 = new Date((T0 + i * 3600) * 1000);
      if (d0.getHours() === 0 || i === 0) {
        const name = i === 0 ? "Now" : d0.toLocaleDateString("en-CA", { weekday: "short" });
        s += `<line x1="${X(i).toFixed(1)}" x2="${X(i).toFixed(1)}" y1="${top}" y2="${sy + stripH}" stroke="#fff" stroke-opacity=".5" stroke-width=".8"/>`
          + `<text x="${(X(i) + 2).toFixed(1)}" y="${sy + stripH + 11}" font-size="9" fill="currentColor">${name}</text>`;
      }
    }
    s += `<line class="cl-cur" x1="${X(hour).toFixed(1)}" x2="${X(hour).toFixed(1)}" y1="${top}" y2="${sy + stripH}" stroke="#e8590c" stroke-width="2"/>`;
    s += "</svg>";
    return { svg: s, states, X, L0, W, R0 };
  }
  // A few words: when the top is clear or above the clouds in daylight.
  function summary(d, states, what) {
    const h = d.hourly, T0 = baseT || nowHour(), off = Math.max(0, Math.round((T0 - h.time[0]) / 3600));
    const spans = [];
    let cur = null;
    states.forEach((st, i) => {
      const good = (st === "clear" || st === "above") && (!h.is_day || h.is_day[off + i] !== 0);
      if (good && cur && cur.st === st && cur.end === i - 1) cur.end = i;
      else if (good) spans.push((cur = { st, start: i, end: i }));
      else cur = null;
    });
    const t = (i) => { const dd = new Date((T0 + i * 3600) * 1000); return dd.toLocaleTimeString("en-CA", { hour: "numeric" }).replace(/\s?([ap])\.?m\.?/i, " $1m"); };
    const day = (i) => (i === 0 ? "now" : new Date((T0 + i * 3600) * 1000).toLocaleDateString("en-CA", { weekday: "short" }));
    const list = spans.filter((x) => x.end - x.start >= 1).slice(0, 4).map((x) => `${x.st === "above" ? "<b>above the clouds</b>" : "clear"} ${day(x.start)} ${t(x.start)} to ${t(x.end + 1)}`);
    if (states[0]) {
      const first = `${what} now: <b>${STATES[states[0]][1].toLowerCase()}</b>.`;
      return list.length ? `${first} Good views in daylight: ${list.join("; ")}.` : `${first} No clear daylight hours ${what === "Here" ? "here" : "at " + what.toLowerCase()} in the next 3 days.`;
    }
    return "";
  }
  async function chart(el, { lat, lon, lo, hi, kind }) {
    if (!el) return;
    el.classList.add("cl-chart");
    el.innerHTML = `<p class="cl-note">Loading clouds by height…</p>`;
    try {
      const d = await profile(lat, lon);
      if (!el.isConnected) return;
      if (lo == null) lo = hi = d.elevation || 0;
      if (hi == null) hi = lo;
      const words = kind === "route" ? { topWord: "Top", botWord: "Bottom", oneWord: "Route", what: "The top" } : { topWord: "Top", botWord: "Bottom", oneWord: "Here", what: "Here" };
      const c = chartSvg(d, lo, hi, words);
      el.innerHTML = `${el.id !== "clChart" ? "<h4>Clouds by height</h4>" : ""}${c.svg}
        <div class="cl-key">${Object.values(STATES).map(([col, name]) => `<span><i style="background:${col}"></i>${name}</span>`).join("")}<span><i style="background:#3d5a86"></i>Night</span><span><i style="background:none;border:0;border-top:2px dashed #1971c2;height:0"></i>Freezing level</span></div>
        <p class="cl-sum">${summary(d, c.states, words.what)}</p>
        <p class="cl-note">White is cloud at each height (more white, thicker). The strip shows ${kind === "route" ? "the top of the route" : "this spot"}. Tap the chart to see that hour on the map${on ? "" : " (with ☁ Clouds on)"}. Model forecast from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.</p>`;
      const svg = el.querySelector("svg");
      const pick = (e) => {
        const b = svg.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * c.W;
        const i = Math.round(((x - c.L0) / (c.W - c.L0 - c.R0)) * HOURS);
        if (!on) { cur(i); return; }
        setHour(i);
      };
      const cur = (i) => { const ln = svg.querySelector(".cl-cur"), x = c.X(Math.max(0, Math.min(HOURS, i))).toFixed(1); ln.setAttribute("x1", x); ln.setAttribute("x2", x); };
      svg.addEventListener("pointerdown", pick);
      const sync = (e) => { if (!el.isConnected) return window.removeEventListener("tf:cloudhour", sync); cur(e.detail); };
      window.addEventListener("tf:cloudhour", sync);
    } catch (e) {
      if (el.isConnected) el.innerHTML = `<p class="cl-note">Couldn't load clouds by height (${esc(e.message)}).</p>`;
    }
  }
  let chartKey = "";
  function chartHere() {
    const c = map.getCenter(), key = `${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
    if (key === chartKey && $("clChart").firstChild) return;
    chartKey = key;
    chart($("clChart"), { lat: c.lat, lon: c.lng, kind: "here" });
  }
  $("clChartBtn").addEventListener("click", () => {
    const open = $("clMore").hidden;
    $("clMore").hidden = !open;
    $("clChartBtn").setAttribute("aria-pressed", String(open));
    if (open) { chartKey = ""; chartHere(); }
  });

  // ---------- the button ----------
  const btn = document.createElement("button");
  btn.id = "cloudBtn"; btn.type = "button"; btn.setAttribute("aria-pressed", "false");
  btn.title = "Clouds, rain and snow now and for the next 3 days, on the flat and 3D maps";
  btn.textContent = "☁ Clouds";
  const list = document.querySelector("#layersMenu .lm-overlays");
  const after = $("firesBtn");
  if (after && after.parentElement === list) after.after(btn); else if (list) list.prepend(btn); else return;
  let on = store.get("clouds", false);
  function apply() {
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
    bar.hidden = !on;
    if (on) {
      if (!baseT || nowHour() !== baseT) { baseT = nowHour(); hourCache = null; }
      whenEl.textContent = label(hour);
      draw();
      refresh();
      findSatTimes().then(() => { if (on) { if (map.hasLayer(satLayer)) satLayer.redraw(); draw(); } });
    } else {
      stop();
      show2d();
      sync3d();
    }
  }
  btn.addEventListener("click", () => { on = !on; store.set("clouds", on); apply(); });
  let moveT = 0;
  map.on("moveend", () => { if (!on) return; clearTimeout(moveT); moveT = setTimeout(() => { refresh(); here(); }, 400); });
  // Back after a while: the forecast moves on with the clock.
  document.addEventListener("visibilitychange", () => { if (on && document.visibilityState === "visible" && nowHour() !== baseT) { baseT = nowHour(); hourCache = null; refresh(); setHour(hour); } });
  // The satellite every 10 minutes while the clouds are on.
  setInterval(() => {
    if (!on || document.visibilityState !== "visible") return;
    const before = JSON.stringify(satTime);
    findSatTimes().then(() => { if (JSON.stringify(satTime) !== before) { if (map.hasLayer(satLayer)) satLayer.redraw(); here(); } });
  }, 10 * 60000);
  apply();

  window.tfClouds = { chart, isOn: () => on, hour: () => hour, setHour: (h) => { if (on) setHour(h); } };   // smoke.js follows this slider
})();
