// Rain and snow radar for the trail finder: "🌧 Radar" in Layers, in every sport, on the flat and 3D maps. Shows where
// it's raining or snowing right now and the last 3 hours, every 6 minutes, so you can see a shower coming and how fast
// ("do I have time for one more lap?"). From Environment Canada's radar network (the North American 1 km radar
// composite on MSC GeoMet, Open Government Licence - Canada), so it covers the south of every province.
// - The map shows rain in blues and greens, then yellow, red and purple for heavier. Snow uses the same colours with
//   snow rates (cm/h). Rain or Snow is picked for you (Skiing, or the cold months, start on Snow) and the bar switches it.
// - ▶ plays the last 3 hours (or, on the forecast, the next 3 days); the bar says what's falling at the map centre.
// - Outside radar range (the far north) the map stays clear, and the bar says so when the map centre has no radar.
// - Next 3 days (alex 2026-11-03, "can it show the next 3 days ... rain or snow", like Skiing's forecast layer): the
//   slider carries on past Latest into Environment Canada's forecast model (RDPS, 10 km, all of Canada), rain or snow
//   fallen in each 3 hours, then a 3-day total. Forecast frames are labelled with the day and time, never "Latest".
// - Painted like Skiing's Snow and rain forecast layer (alex 2026-11-03: "its not as nice as the skiing one", the model's
//   own maps were big dark blocks over the trails): the app asks for the forecast's numbers (WCS grid, small text) and
//   paints them itself: smooth between the 10 km model points, see-through, snow in Skiing's purples and rain in its
//   greens where less snow comes, both on the map at once.
// Kept light like the smoke layer: the pictures come ready-made from the map server, one for the view.
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
  const GEOMET = "https://geo.weather.gc.ca/geomet";
  const LAYERS = { rain: "RADAR_1KM_RRAI", snow: "RADAR_1KM_RSNO" };
  const ATTR = 'Radar: <a href="https://eccc-msc.github.io/open-data/msc-data/obs_radar/readme_radar_geomet_en/">Environment Canada</a> (OGL-Canada)';
  const OPACITY = 0.7, M_PER_PX = 1000;   // 1 km radar: about one pixel per km is all the detail there is
  // Forecast: RDPS model, rain/snow fallen in each 3 hours (a frame every 3 h, ~3.5 days ahead) and the total since
  // the model run, as numbers on a grid (WCS, ASCII grid: a few KB for the view).
  const FC = { rain: "RDPS_10km_Rain-Accum3h", snow: "RDPS_10km_Snow-Accum3h" };
  const FC_TOTAL = { rain: "RDPS_10km_Rain-Accum", snow: "RDPS_10km_Snow-Accum" };
  const FC_STEP_S = 10800, FC_MAX_S = 3.5 * 86400;
  // Exactly Skiing's colours and amounts (winter.js SNOW_CM / RAIN_MM; alex 2026-11-03: "with the same color so it is
  // easier for people to understand"), for the 3-hour frames and the 3-day total alike.
  const SNOW_TOT = [[1, "#d0ebff"], [5, "#91a7ff"], [10, "#748ffc"], [20, "#9775fa"], [30, "#da77f2"], [50, "#f783ac"], [80, "#e64980"]];
  const RAIN_TOT = [[1, "#d3f9d8"], [5, "#8ce99a"], [10, "#51cf66"], [25, "#2f9e44"], [50, "#1b6e30"]];
  const FC_ALPHA = 150;   // like Skiing's: the trails and names show through
  const FC_ATTR = 'Forecast: <a href="https://eccc-msc.github.io/open-data/msc-data/nwp_rdps/readme_rdps_en/">Environment Canada RDPS</a> (OGL-Canada)';
  const STEP_S = 360;                      // a picture every 6 minutes

  const css = document.createElement("style");
  css.textContent = `
.map-tools #radarBtn.on { background: #1971c2; border-color: #1971c2; color: #fff; }
#rdBar input[type=range] { accent-color: #1971c2; }
#rdBar .rd-kind { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; flex: none; }
#rdBar .rd-kind button { border: 0; border-radius: 0; padding: 5px 8px; }
#rdBar .rd-kind button[aria-pressed=true] { background: #1971c2; color: #fff; }
#rdBar .cl-key i { border-color: #0002; }
#rdBar .rd-jump { display: flex; gap: 6px; margin: 6px 0 0; align-items: stretch; }
#rdBar .rd-sec { display: flex; gap: 4px; flex: 1; min-width: 0; }
#rdBar .rd-sec button { flex: 1 1 auto; padding: 5px 4px; font-size: .8rem; white-space: nowrap; min-width: 0; }
#rdBar .rd-sec button[aria-pressed=true] { background: #1971c2; border-color: #1971c2; color: #fff; }
#rdBar .rd-sec button[hidden] { display: none; }
#rdBar .cl-when.fc { color: #1971c2; }
#rdBar.rd-fc .rd-kind { display: none; }
#rdBar .rd-scale { flex-basis: 100%; margin: 0; gap: 2px 8px; }
#rdBar .rd-scale b { flex-basis: 100%; font-weight: 700; }
`;
  document.head.append(css);

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const iso = (t) => new Date(t * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  const sportNow = () => ["ski", "hunt", "fish", "moto"].find((s) => document.body.classList.contains("sport-" + s)) || "mtb";
  const coldMonth = () => [11, 0, 1, 2, 3].includes(new Date().getMonth());   // Dec to Apr
  let kind = store.get("radarKind", null) || (sportNow() === "ski" || coldMonth() ? "snow" : "rain");
  const layer = () => LAYERS[kind];

  // ---------- which pictures exist ----------
  // The newest picture and the 3 hours before it, from the layer's capabilities (small), checked again every 3 minutes.
  let span = null, spanAt = 0, spanP = null;   // { t0, t1 } unix seconds
  function getSpan(force) {
    if (span && !force && Date.now() - spanAt < 180000) return Promise.resolve(span);
    if (spanP) return spanP;
    spanP = fetch(`${GEOMET}?service=WMS&version=1.3.0&request=GetCapabilities&layer=${layer()}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then((x) => {
        const time = (x.match(/<Dimension name="time"[^>]*>([^<]+)</) || [])[1];
        if (!time) throw new Error("no radar times");
        const [a, b] = time.split("/");
        span = { t0: Date.parse(a) / 1000, t1: Date.parse(b) / 1000 };
        spanAt = Date.now();
        return span;
      })
      .finally(() => { spanP = null; });
    return spanP;
  }
  const frames = () => (span ? Math.max(0, Math.round((span.t1 - span.t0) / STEP_S)) : 0);
  let frame = 0;                                   // 0 = the oldest, frames() = the newest
  const frameT = (f) => (span ? span.t0 + f * STEP_S : 0);
  // ---------- the forecast frames, after the radar's ----------
  let fc = null, fcAt = 0, fcP = null;   // { times: [unix s of each 3 h ending], end }
  function getFc(force) {
    if (fc && !force && Date.now() - fcAt < 1800000) return Promise.resolve(fc);
    if (fcP) return fcP;
    const k = kind;
    fcP = fetch(`${GEOMET}?service=WMS&version=1.3.0&request=GetCapabilities&layer=${FC[k]}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then((x) => {
        const time = (x.match(/<Dimension name="time"[^>]*>([^<]+)</) || [])[1];
        if (!time) throw new Error("no forecast times");
        const [a, b] = time.split("/"), t0 = Date.parse(a) / 1000, t1 = Date.parse(b) / 1000, now = Date.now() / 1000;
        const times = [];
        for (let t = t0; t <= t1 && t <= now + FC_MAX_S; t += FC_STEP_S) if (t > now) times.push(t);
        if (k !== kind) return fc;
        fc = times.length ? { times, end: times[times.length - 1] } : null;
        fcAt = Date.now();
        return fc;
      })
      .finally(() => { fcP = null; });
    return fcP;
  }
  const fcN = () => (fc ? fc.times.length : 0);
  const lastF = () => frames() + (fcN() ? fcN() + 1 : 0);        // the 3-day total is the last stop
  const secOf = (f) => (f <= frames() ? "radar" : f <= frames() + fcN() ? "fc" : "total");
  const fcTime = (f) => (secOf(f) === "fc" ? fc.times[f - frames() - 1] : fc ? fc.end : 0);
  const dayTime = (t) => {
    const d = new Date(t * 1000), today = new Date().toDateString() === d.toDateString();
    const clock = d.toLocaleTimeString("en-CA", { hour: "numeric" }).replace(/\s?([ap])\.?m\.?/i, " $1m");
    return `${today ? "Today" : d.toLocaleDateString("en-CA", { weekday: "short" })} ${clock}`;
  };
  const label = (f) => {
    if (fcN() && secOf(f) === "fc") return dayTime(fcTime(f) - FC_STEP_S);   // the start of its 3 hours
    if (fcN() && secOf(f) === "total") return "3-day total";
    if (!span) return "Now";
    const t = frameT(f), ago = Math.round((Date.now() / 1000 - t) / 60);
    const clock = new Date(t * 1000).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])\.?m\.?/i, " $1m");
    return f >= frames() ? (ago <= 15 ? "Latest" : clock) : clock;
  };
  const agoText = () => { if (!span) return ""; const m = Math.round((Date.now() / 1000 - span.t1) / 60); return m <= 1 ? "a minute ago" : `${m} min ago`; };
  const wmsBase = () => `${GEOMET}?service=WMS&version=1.3.0&request=GetMap&layers=${layer()}&styles=&crs=EPSG:3857&format=image/png&transparent=true`;
  const timeOf = (f) => (secOf(f) === "radar" ? frameT(f) : fcTime(f));

  // ---------- the forecast, painted here ----------
  const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const scaleOf = (sc) => sc.map(([v, c]) => [v, ...rgbOf(c)]);
  const SC = { snow: scaleOf(SNOW_TOT), rain: scaleOf(RAIN_TOT) };
  const colorAt = (v, sc) => {   // the same blend as Skiing's snowColor
    if (!(v >= sc[0][0])) return null;
    for (let q = sc.length - 1; q >= 0; q--) if (v >= sc[q][0]) {
      const a = sc[q], b = sc[q + 1];
      if (!b) return a.slice(1);
      const t = (v - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
    return null;
  };
  // The view (flat or 3D), snapped so small moves reuse the same numbers. A grid of at most ~110 points across.
  function fcBox() {
    let s, n, w, e;
    const gl = window.trailMap3d;
    if (is3d() && gl && gl.getBounds) {   // a tilted 3D view sees past its bounds: a wider margin
      const g = gl.getBounds(), dy = (g.getNorth() - g.getSouth()) * 0.5, dx = (g.getEast() - g.getWest()) * 0.5;
      s = g.getSouth() - dy; n = g.getNorth() + dy; w = g.getWest() - dx; e = g.getEast() + dx;
    }
    else { const g = map.getBounds().pad(0.3); s = g.getSouth(); n = g.getNorth(); w = g.getWest(); e = g.getEast(); }
    s = clamp(s, -80, 84); n = clamp(n, -80, 84); w = clamp(w, -179.9, 179.9); e = clamp(e, -179.9, 179.9);
    const cell = Math.max(0.1, Math.ceil((Math.max(n - s, e - w) / 110) * 10) / 10), snap = cell * 5;
    s = Math.floor(s / snap) * snap; n = Math.ceil(n / snap) * snap; w = Math.floor(w / snap) * snap; e = Math.ceil(e / snap) * snap;
    if (n <= s) n = s + snap;
    if (e <= w) e = w + snap;
    const r = (x) => +x.toFixed(2);
    return { s: r(s), n: r(n), w: r(w), e: r(e), cell };
  }
  const grids = new Map();
  function grid(lay, t, b) {
    const key = `${lay},${t},${b.s},${b.n},${b.w},${b.e},${b.cell}`;
    if (grids.has(key)) return grids.get(key);
    const p = fetch(`${GEOMET}?service=WCS&version=2.0.1&request=GetCoverage&coverageid=${lay}&format=image/x-aaigrid`
      + `&subsettingcrs=EPSG:4326&outputcrs=EPSG:4326&subset=lat(${b.s},${b.n})&subset=lon(${b.w},${b.e})`
      + `&resolution=lat(${b.cell})&resolution=lon(${b.cell})&time=${iso(t)}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then((x) => {
        const i = x.indexOf("ncols");
        if (i < 0) throw new Error("no forecast numbers");
        const lines = x.slice(i).split("\n"), h = {};
        let k = 0;
        for (; k < lines.length; k++) {
          const m = lines[k].trim().match(/^([a-z_]+)\s+(\S+)$/i);
          if (!m) break;
          h[m[1].toLowerCase()] = +m[2];
        }
        const nc = h.ncols, nr = h.nrows, cs = h.cellsize, nd = h.nodata_value, v = new Float32Array(nc * nr);
        let q = 0;
        for (; k < lines.length && q < v.length; k++) for (const t of lines[k].trim().split(/\s+/)) {
          if (!t || q >= v.length) continue;
          const n = +t;
          v[q++] = !Number.isFinite(n) || n === nd || n < 0 ? 0 : n;
        }
        return { nc, nr, cs, x0: h.xllcorner, top: h.yllcorner + nr * cs, v };
      });
    p.catch(() => grids.delete(key));
    grids.set(key, p);
    if (grids.size > 120) grids.delete(grids.keys().next().value);
    return p;
  }
  // Total from now: (total since the run at the end) - (total since the run at the first frame) + the first frame's 3 h
  function totalGrid(k, b) {
    const t0 = fc.times[0];
    return Promise.all([grid(FC_TOTAL[k], fc.end, b), grid(FC_TOTAL[k], t0, b), grid(FC[k], t0, b)]).then(([a, c, d]) => {
      const v = new Float32Array(a.v.length);
      for (let i = 0; i < v.length; i++) v[i] = Math.max(0, a.v[i] - (c.v[i] || 0) + (d.v[i] || 0));
      return { ...a, v };
    });
  }
  const sample = (g, lat, lon) => {   // smooth between the model's points (bilinear), like Skiing's tiles
    const fy = clamp((g.top - lat) / g.cs - 0.5, 0, g.nr - 1), fx = clamp((lon - g.x0) / g.cs - 0.5, 0, g.nc - 1);
    const y0 = Math.floor(fy), x0 = Math.floor(fx), y1 = Math.min(y0 + 1, g.nr - 1), x1 = Math.min(x0 + 1, g.nc - 1), ty = fy - y0, tx = fx - x0, v = g.v;
    return (v[y0 * g.nc + x0] * (1 - tx) + v[y0 * g.nc + x1] * tx) * (1 - ty) + (v[y1 * g.nc + x0] * (1 - tx) + v[y1 * g.nc + x1] * tx) * ty;
  };
  const pics = new Map();
  // One picture of the view for a forecast frame: { url, bounds: [s, w, n, e] }
  function fcPicture(f, b) {
    const sec = secOf(f), t = fcTime(f), key = `${sec},${t},${b.s},${b.n},${b.w},${b.e},${b.cell}`;
    if (pics.has(key)) return pics.get(key);
    const tot = sec === "total";
    const p = Promise.all(["snow", "rain"].map((k) => (tot ? totalGrid(k, b) : grid(FC[k], t, b)))).then(([sn, rn]) => {
      const crs = L.CRS.EPSG3857, p0 = crs.project(L.latLng(b.s, b.w)), p1 = crs.project(L.latLng(b.n, b.e));
      const W = clamp(Math.round(sn.nc * 4), 64, 512), H = clamp(Math.round((W * (p1.y - p0.y)) / (p1.x - p0.x)), 32, 768);
      const cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const cx = cv.getContext("2d"), img = cx.createImageData(W, H), o = img.data;
      const ss = SC.snow, rs = SC.rain;
      for (let py = 0; py < H; py++) {
        const lat = crs.unproject(L.point(p0.x, p1.y - ((py + 0.5) / H) * (p1.y - p0.y))).lat;
        for (let px = 0; px < W; px++) {
          const lon = b.w + ((px + 0.5) / W) * (b.e - b.w);
          const col = colorAt(sample(sn, lat, lon), ss) || colorAt(sample(rn, lat, lon), rs);
          if (!col) continue;
          const k = (py * W + px) * 4;
          o[k] = col[0]; o[k + 1] = col[1]; o[k + 2] = col[2]; o[k + 3] = FC_ALPHA;
        }
      }
      cx.putImageData(img, 0, 0);
      return { url: cv.toDataURL("image/png"), bounds: [b.s, b.w, b.n, b.e] };
    });
    p.catch(() => pics.delete(key));
    pics.set(key, p);
    if (pics.size > 40) pics.delete(pics.keys().next().value);
    return p;
  }

  // ---------- flat map: one picture of the view ----------
  map.createPane("radar").style.zIndex = 379;   // with the smoke and clouds, over the photos; under trails and pins
  map.getPane("radar").style.pointerEvents = "none";
  let overlay = null, shownUrl = "";
  const is3d = () => map.getContainer().classList.contains("is3d");
  function viewBox(mpp = M_PER_PX) {
    const b = map.getBounds().pad(0.3), crs = L.CRS.EPSG3857;
    const sw = crs.project(L.latLng(clamp(b.getSouth(), -85, 85), clamp(b.getWest(), -180, 180)));
    const ne = crs.project(L.latLng(clamp(b.getNorth(), -85, 85), clamp(b.getEast(), -180, 180)));
    const snap = 2 ** Math.round(Math.log2(Math.max(1000, (ne.x - sw.x) / 16)));
    const x0 = Math.floor(sw.x / snap) * snap, x1 = Math.ceil(ne.x / snap) * snap, y0 = Math.floor(sw.y / snap) * snap, y1 = Math.ceil(ne.y / snap) * snap;
    const k = Math.cos((map.getCenter().lat * Math.PI) / 180), m = mpp / Math.max(0.2, k);
    const w = clamp(Math.round((x1 - x0) / m), 64, 900), h = clamp(Math.round((y1 - y0) / m), 64, 900);
    return { bbox: `${x0},${y0},${x1},${y1}`, w, h, bounds: L.latLngBounds(crs.unproject(L.point(x0, y0)), crs.unproject(L.point(x1, y1))) };
  }
  const urlFor = (v, f) => `${wmsBase()}&bbox=${v.bbox}&width=${v.w}&height=${v.h}&time=${iso(frameT(f))}`;
  const boxFor = () => viewBox();
  function showPic(url, bounds) {
    if (!overlay) overlay = L.imageOverlay(url, bounds, { pane: "radar", opacity: OPACITY, interactive: false, attribution: `${ATTR}, ${FC_ATTR}` }).addTo(map);
    else { overlay.setUrl(url); overlay.setBounds(bounds); if (!map.hasLayer(overlay)) overlay.addTo(map); }
  }
  function drawFc2d() {
    const f = frame, b = fcBox(), sig = `fc,${secOf(f)},${fcTime(f)},${b.s},${b.n},${b.w},${b.e}`;
    if (sig === shownUrl && overlay && map.hasLayer(overlay)) return;
    fcPicture(f, b).then((pic) => {
      if (!on || is3d() || frame !== f || secOf(frame) === "radar") return;
      shownUrl = sig;
      showPic(pic.url, L.latLngBounds([pic.bounds[0], pic.bounds[1]], [pic.bounds[2], pic.bounds[3]]));
      if (overlay) overlay.setOpacity(1);   // the see-through is in the picture itself
      if (playing && frame < playEnd()) fcPicture(frame + 1, b).catch(() => {});
    }, () => { note = "Couldn't load the forecast, try again soon."; here(); });
  }
  function draw2d() {
    if (!on || is3d() || !span) { if (overlay && map.hasLayer(overlay)) map.removeLayer(overlay); shownUrl = ""; return; }
    if (secOf(frame) !== "radar") return drawFc2d();
    const v = boxFor(frame), url = urlFor(v, frame);
    if (url === shownUrl && overlay && map.hasLayer(overlay)) return;
    const img = new Image();   // loaded first, then swapped in, so the rain doesn't blink while it plays
    img.onload = () => {
      if (!on || is3d() || urlFor(boxFor(frame), frame) !== url) return;
      shownUrl = url;
      showPic(url, v.bounds);
      overlay.setOpacity(OPACITY);
      if (playing && frame < playEnd()) new Image().src = urlFor(boxFor(frame + 1), frame + 1);
    };
    img.onerror = () => { note = "Couldn't load the radar, try again soon."; here(); };
    img.src = url;
  }

  // ---------- 3D map: the same picture draped on the mountains ----------
  const tilesUrl = () => `${wmsBase()}&bbox={bbox-epsg-3857}&width=256&height=256&time=${iso(frameT(frame))}`;
  // Forecast in 3D: the same painted picture of the view, laid on the mountains (MapLibre image source)
  function fc3d(gl) {
    const f = frame, b = fcBox();
    fcPicture(f, b).then((pic) => {
      if (!on || frame !== f || secOf(frame) === "radar" || window.trailMap3d !== gl) return;
      const [s, w, n, e] = pic.bounds, coordinates = [[w, n], [e, n], [e, s], [w, s]];
      const doIt = () => {
        const src = gl.getSource("radarfc");
        if (src) { if (src._rdUrl !== pic.url) { src._rdUrl = pic.url; src.updateImage({ url: pic.url, coordinates }); } return; }
        gl.addSource("radarfc", { type: "image", url: pic.url, coordinates });
        gl.getSource("radarfc")._rdUrl = pic.url;
        const before = ["clouds", "osm-roads", "lines"].find((id) => gl.getLayer(id));
        gl.addLayer({ id: "radarfc", type: "raster", source: "radarfc", paint: { "raster-opacity": 1, "raster-fade-duration": 0, "raster-resampling": "linear" } }, before);
      };
      try { doIt(); } catch { gl.once("style.load", () => { try { doIt(); } catch {} }); }
    }, () => {});
  }
  function sync3d() {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    if (!gl._rdMove) { gl._rdMove = true; gl.on("moveend", () => { if (on && is3d() && span && secOf(frame) !== "radar") { clearTimeout(moveT); moveT = setTimeout(sync3d, 400); } }); }
    const apply = () => {
      const fcNow = on && span && secOf(frame) !== "radar";
      if (!fcNow) { if (gl.getLayer("radarfc")) gl.removeLayer("radarfc"); if (gl.getSource("radarfc")) gl.removeSource("radarfc"); }
      if (!on || !span || fcNow) { if (gl.getLayer("radar")) gl.removeLayer("radar"); if (gl.getSource("radar")) gl.removeSource("radar"); }
      if (fcNow) return fc3d(gl);
      if (!on || !span) return;
      const src = gl.getSource("radar"), u = tilesUrl();
      if (src) { if (src._rdUrl !== u) { src._rdUrl = u; src.setTiles([u]); } return; }
      // Zoom 7 at most (about one radar pixel per screen pixel there); closer, the browser smooths it (phone memory).
      gl.addSource("radar", { type: "raster", tiles: [u], tileSize: 256, maxzoom: 7, attribution: `${ATTR}, ${FC_ATTR}` });
      gl.getSource("radar")._rdUrl = u;
      const before = ["clouds", "osm-roads", "lines"].find((id) => gl.getLayer(id));
      gl.addLayer({ id: "radar", type: "raster", source: "radar", paint: { "raster-opacity": OPACITY, "raster-fade-duration": 0, "raster-resampling": "linear" } }, before);
    };
    try { apply(); } catch { gl.once("style.load", () => { try { apply(); } catch {} }); }
  }
  window.addEventListener("tf:map3d", () => setTimeout(() => { sync3d(); }, 0));
  if ($("btn3d")) $("btn3d").addEventListener("click", () => setTimeout(() => { if (on) draw(); }, 60));

  let draw3dTimer = 0;
  function draw() {
    if (!on) return;
    draw2d();
    clearTimeout(draw3dTimer);
    draw3dTimer = setTimeout(sync3d, playing ? 0 : 250);
    here();
  }

  // ---------- the bar ----------
  const wrap = map.getContainer().parentElement;
  const bar = document.createElement("div");
  bar.className = "cl-bar"; bar.id = "rdBar"; bar.hidden = true; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Rain and snow radar");
  bar.innerHTML = `<div class="cl-row"><button type="button" id="rdPlay" aria-label="Play">▶</button>
<input type="range" id="rdFrame" min="0" max="30" step="1" value="30" aria-label="Radar and forecast time">
<span class="cl-when" id="rdWhen">Latest</span>
<button type="button" id="rdClose" aria-label="Turn radar off">✕</button></div>
<div class="rd-jump"><span class="rd-kind" role="group" aria-label="Rain or snow"><button type="button" data-k="rain" aria-pressed="false">Rain</button><button type="button" data-k="snow" aria-pressed="false">Snow</button></span><span class="rd-sec" role="group" aria-label="Radar or forecast"><button type="button" data-j="radar" aria-pressed="true">Radar</button><button type="button" data-j="fc" id="rdJumpFc" aria-pressed="false">Next 3 days</button><button type="button" data-j="total" id="rdJumpTot" aria-pressed="false">3-day total</button></span></div>
<p class="cl-here" id="rdHere" aria-live="polite"></p>
<div class="cl-key" id="rdKey"></div>`;
  wrap.append(bar);
  const slider = $("rdFrame"), whenEl = $("rdWhen"), playBtn = $("rdPlay");
  // The radar's own colours (Environment Canada's scale), in words
  const KEYS = {
    rain: [["#5ab4ff", "Light"], ["#00c800", "Moderate"], ["#ffd700", "Heavy"], ["#ff1e00", "Very heavy"], ["#a000c8", "Hail or downpour"]],
    snow: [["#5ab4ff", "Light"], ["#00c800", "Moderate"], ["#ffd700", "Heavy"], ["#ff1e00", "Very heavy"], ["#a000c8", "Extreme"]],
  };
  let keyFor = "";
  function syncKind() {
    bar.querySelectorAll(".rd-kind button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === kind)));
    const s = secOf(frame);
    bar.querySelectorAll(".rd-sec button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.j === s)));
    $("rdJumpTot").hidden = !fcN();
    whenEl.classList.toggle("fc", s !== "radar");
    bar.classList.toggle("rd-fc", s !== "radar");
    const k2 = s === "radar" ? `${kind},r` : s;
    if (k2 === keyFor) return;
    keyFor = k2;
    if (s === "radar") { $("rdKey").innerHTML = KEYS[kind].map(([c, w]) => `<span><i style="background:${c}"></i>${w}</span>`).join(""); return; }
    // Forecast: snow and rain together, as in Skiing (rain where less snow comes)
    const row = (title, sc) => `<div class="cl-key rd-scale"><b>${title}</b>${sc.map(([v, c], i) => `<span><i style="background:${c}"></i>${i === sc.length - 1 ? `${v}+` : v}</span>`).join("")}</div>`;
    const when = s === "total" ? "next 3 days" : "these 3 hours";
    $("rdKey").innerHTML = row(`Snow coming, ${when} (cm)`, SNOW_TOT.slice(0, 6)) + row(`Rain instead, ${when} (mm)`, RAIN_TOT);
  }
  bar.querySelector(".rd-kind").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b || b.dataset.k === kind) return;
    const was = secOf(frame), wasT = timeOf(frame);
    kind = b.dataset.k; store.set("radarKind", kind); keyFor = "";
    shownUrl = ""; span = null; fc = null; syncKind();
    getSpan().then(() => { setFrame(frames()); loadFc().then(() => { if (was !== "radar") goTo(was, wasT); }); },
      (er) => { note = `Couldn't load the radar (${er.message}).`; here(); });
  });
  // The forecast's times come in next to the radar's; the slider grows to the right of Latest.
  function loadFc(force) {
    return getFc(force).then(() => { if (span) setFrame(frame); else syncKind(); }, () => { syncKind(); });
  }
  // Back to the same part of the slider (and the same time, if it's still there) after new radar or forecast times
  function goTo(sec, t) {
    if (sec === "radar" || !fcN()) return setFrame(frames());
    if (sec === "total") return setFrame(lastF());
    const i = fc.times.indexOf(t);
    setFrame(frames() + 1 + (i >= 0 ? i : 0));
  }
  bar.querySelector(".rd-sec").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-j]");
    if (!b) return;
    stop();
    const j = b.dataset.j;
    if (j === "radar") return setFrame(frames());
    if (!fcN()) { $("rdHere").textContent = "Loading the forecast…"; return loadFc(true).then(() => { if (fcN()) setFrame(j === "fc" ? frames() + 1 : lastF()); else $("rdHere").textContent = "Couldn't load the forecast, try again soon."; }); }
    setFrame(j === "fc" ? frames() + 1 : lastF());
  });
  function setFrame(f, from) {
    frame = clamp(Math.round(f), 0, lastF());
    slider.max = String(lastF());
    if (from !== "slider") slider.value = String(frame);
    whenEl.textContent = label(frame);
    syncKind();
    draw();
  }
  slider.addEventListener("input", () => setFrame(+slider.value, "slider"));
  let playing = 0;
  // ▶ plays the part you're in: the last 3 hours of radar, or the next 3 days of forecast
  let playFc = false;
  const playEnd = () => (playFc ? frames() + fcN() : frames());
  function stop() { clearInterval(playing); playing = 0; playBtn.textContent = "▶"; playBtn.setAttribute("aria-label", "Play"); }
  playBtn.addEventListener("click", () => {
    if (playing) return stop();
    const s = secOf(frame);
    playFc = fcN() > 0 && s !== "radar";
    if (playFc && (s === "total" || frame >= frames() + fcN())) setFrame(frames() + 1);
    else if (!playFc && frame >= frames()) setFrame(0);
    playBtn.textContent = "❚❚"; playBtn.setAttribute("aria-label", "Pause");
    playing = setInterval(() => { if (frame >= playEnd()) stop(); else setFrame(frame + 1); }, is3d() ? 1000 : playFc ? 700 : 450);
  });
  $("rdClose").addEventListener("click", () => btn.click());
  // Clouds or smoke on too: their bar sits at the bottom, this one just above it.
  function place() {
    bar.hidden = !on;
    const other = [...wrap.querySelectorAll(".cl-bar:not(#rdBar)")].find((b) => !b.hidden);
    bar.style.bottom = "";
    if (on && other) {
      const base = parseFloat(getComputedStyle(bar).bottom) || 0;
      bar.style.bottom = `${base + other.offsetHeight + 8}px`;
    }
  }
  const mo = new MutationObserver(() => { if (on) place(); });
  wrap.querySelectorAll(".cl-bar:not(#rdBar)").forEach((b) => mo.observe(b, { attributes: true, attributeFilter: ["hidden"] }));
  new MutationObserver(() => wrap.querySelectorAll(".cl-bar:not(#rdBar)").forEach((b) => mo.observe(b, { attributes: true, attributeFilter: ["hidden"] }))).observe(wrap, { childList: true });
  window.addEventListener("resize", () => { if (on) place(); });

  // ---------- what's falling at the map centre ----------
  const RATE = {   // mm/h for rain, cm/h for snow (Environment Canada's legend steps)
    rain: [[0.1, "dry"], [2.5, "light rain"], [7.6, "moderate rain"], [50, "heavy rain"], [Infinity, "very heavy rain"]],
    snow: [[0.1, "no snow"], [0.5, "light snow"], [1.5, "moderate snow"], [4, "heavy snow"], [Infinity, "very heavy snow"]],
  };
  const wordOf = (v) => RATE[kind].find(([max]) => v < max)[1];
  const cache = new Map();
  const rateAt = (lat, lon, f) => valAt(layer(), lat, lon, frameT(f));
  function valAt(lay, lat, lon, t) {
    const key = `${lay},${lat.toFixed(3)},${lon.toFixed(3)},${t}`;
    if (cache.has(key)) return cache.get(key);
    const d = 0.01;
    const p = fetch(`${GEOMET}?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=${lay}&query_layers=${lay}&crs=EPSG:4326`
      + `&bbox=${(lat - d).toFixed(4)},${(lon - d).toFixed(4)},${(lat + d).toFixed(4)},${(lon + d).toFixed(4)}&width=3&height=3&i=1&j=1&info_format=application/json&time=${iso(t)}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { const pr = (j.features || [])[0] && j.features[0].properties; const v = pr ? +pr.value : NaN; return Number.isFinite(v) ? Math.max(0, v) : NaN; });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return p;
  }
  // Forecast at the map centre: rain AND snow (whichever the map shows), for the 3 hours or the whole 3 days.
  // The model leaves snow out where none falls, so "nothing" reads as 0 there.
  const z = (p) => p.then((v) => (Number.isNaN(v) ? 0 : v));
  const amt = (v, u) => `${v < 1 ? v.toFixed(1) : Math.round(v)} ${u}`;
  function fcHere(el, c, f, n) {
    const s = secOf(f), t = fcTime(f), get = (k) => {
      if (s === "fc") return z(valAt(FC[k], c.lat, c.lng, t));
      // Total from now: (total since the run at the end) - (total since the run at the first frame) + the first frame
      const t0 = fc.times[0];
      return Promise.all([z(valAt(FC_TOTAL[k], c.lat, c.lng, fc.end)), z(valAt(FC_TOTAL[k], c.lat, c.lng, t0)), z(valAt(FC[k], c.lat, c.lng, t0))])
        .then(([a, b, d]) => Math.max(0, a - b + d));
    };
    Promise.all([get("rain"), get("snow")]).then(([r, sn]) => {
      if (n !== hereN) return;
      const when = s === "fc" ? `${dayTime(t - FC_STEP_S)} to ${dayTime(t).replace(/^\S+ /, "")}` : `Next 3 days, to ${dayTime(fc.end)}`;
      const bits = [];
      if (r >= 0.1) bits.push(`${amt(r, "mm")} rain`);
      if (sn >= 0.1) bits.push(`${amt(sn, "cm")} snow`);
      el.textContent = `Forecast, ${when}, map centre: ${bits.length ? bits.join(", ") : "dry"}.`;
      if (bits.length === 1 && (kind === "rain" ? sn >= 0.1 : r >= 0.1)) el.textContent += ` Tap ${kind === "rain" ? "Snow" : "Rain"} to see it on the map.`;
    }, () => { if (n === hereN) el.textContent = "Couldn't read the forecast at the map centre, try again soon."; });
  }
  let note = "", hereT = 0, hereN = 0;
  function here() {
    const el = $("rdHere");
    if (!span) { el.textContent = note || "Loading the radar…"; return; }
    clearTimeout(hereT);
    if (secOf(frame) !== "radar") {
      hereT = setTimeout(() => { if (note) { el.textContent = note; note = ""; return; } fcHere(el, map.getCenter(), frame, ++hereN); }, playing ? 0 : 300);
      return;
    }
    hereT = setTimeout(() => {
      const c = map.getCenter(), f = frame, n = ++hereN, unit = kind === "rain" ? "mm/h" : "cm/h";
      rateAt(c.lat, c.lng, f).then((v) => {
        if (n !== hereN) return;
        const when = f >= frames() ? `now (radar ${agoText()})` : `at ${label(f)}`;
        if (Number.isNaN(v)) { el.textContent = `Map centre ${when}: no radar here (too far from a radar station), or nothing falling.`; return; }
        const w = wordOf(v);
        el.textContent = v < 0.1 ? `Map centre ${when}: ${w}.` : `Map centre ${when}: ${w}, ${v < 1 ? v.toFixed(1) : Math.round(v)} ${unit}.`;
        if (kind === "rain" && v >= 0.1 && coldMonth()) el.textContent += " Could be snow up high: try Snow.";
      }, () => { if (n === hereN) el.textContent = "Couldn't read the radar at the map centre, try again soon."; });
    }, playing ? 0 : 300);
  }

  // ---------- the button ----------
  const btn = document.createElement("button");
  btn.id = "radarBtn"; btn.type = "button"; btn.setAttribute("aria-pressed", "false");
  btn.title = "Rain and snow radar and forecast: where it's falling now, the last 3 hours and the next 3 days (Environment Canada), on the flat and 3D maps";
  btn.textContent = "🌧 Radar";
  const list = document.querySelector("#layersMenu .lm-overlays");
  const before = $("cloudBtn");
  if (before && before.parentElement === list) before.before(btn); else if (list) list.prepend(btn); else return;
  let on = store.get("radar", false);
  function apply() {
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
    if (on) {
      syncKind();
      place();
      note = "";
      here();
      getSpan(true).then(() => { note = ""; setFrame(frames()); loadFc(); }, (e) => { note = `Couldn't load the radar (${e.message}).`; here(); });
    } else {
      stop();
      place();
      if (overlay && map.hasLayer(overlay)) map.removeLayer(overlay);
      shownUrl = "";
      sync3d();
    }
  }
  btn.addEventListener("click", () => { on = !on; store.set("radar", on); apply(); });
  let moveT = 0;
  map.on("moveend", () => { if (!on) return; clearTimeout(moveT); moveT = setTimeout(draw, 400); });
  // New pictures every 6 minutes: while it shows the latest, it moves on with them. On a forecast frame it stays on
  // the same forecast time (the radar part of the slider may have grown or shrunk; new model runs every 6 hours).
  setInterval(() => {
    if (!on || playing || document.visibilityState !== "visible") return;
    const atEnd = frame === frames(), sec = secOf(frame), t = timeOf(frame), f = frame;
    getSpan(true).then(() => getFc().catch(() => {})).then(() => {
      if (sec !== "radar") goTo(sec, t); else setFrame(atEnd ? frames() : f);
    }, () => {});
  }, STEP_S * 1000);
  document.addEventListener("visibilitychange", () => {
    if (on && document.visibilityState === "visible") getSpan(true).then(() => getFc(true).catch(() => {})).then(() => setFrame(frames()), () => {});
  });
  apply();

  window.tfRadar = { isOn: () => on };
})();
