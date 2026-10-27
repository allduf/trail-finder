// Rain and snow radar for the trail finder: "🌧 Radar" in Layers, in every sport, on the flat and 3D maps. Shows where
// it's raining or snowing right now and the last 3 hours, every 6 minutes, so you can see a shower coming and how fast
// ("do I have time for one more lap?"). From Environment Canada's radar network (the North American 1 km radar
// composite on MSC GeoMet, Open Government Licence - Canada), so it covers the south of every province.
// - The map shows rain in blues and greens, then yellow, red and purple for heavier. Snow uses the same colours with
//   snow rates (cm/h). Rain or Snow is picked for you (Skiing, or the cold months, start on Snow) and the bar switches it.
// - ▶ plays the last 3 hours; the bar says what's falling at the map centre now.
// - Outside radar range (the far north) the map stays clear, and the bar says so when the map centre has no radar.
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
  const STEP_S = 360;                      // a picture every 6 minutes

  const css = document.createElement("style");
  css.textContent = `
.map-tools #radarBtn.on { background: #1971c2; border-color: #1971c2; color: #fff; }
#rdBar input[type=range] { accent-color: #1971c2; }
#rdBar .rd-kind { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; flex: none; }
#rdBar .rd-kind button { border: 0; border-radius: 0; padding: 5px 8px; }
#rdBar .rd-kind button[aria-pressed=true] { background: #1971c2; color: #fff; }
#rdBar .cl-key i { border-color: #0002; }
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
  const label = (f) => {
    if (!span) return "Now";
    const t = frameT(f), ago = Math.round((Date.now() / 1000 - t) / 60);
    const clock = new Date(t * 1000).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }).replace(/\s?([ap])\.?m\.?/i, " $1m");
    return f >= frames() ? (ago <= 15 ? "Latest" : clock) : clock;
  };
  const agoText = () => { if (!span) return ""; const m = Math.round((Date.now() / 1000 - span.t1) / 60); return m <= 1 ? "a minute ago" : `${m} min ago`; };
  const wmsBase = () => `${GEOMET}?service=WMS&version=1.3.0&request=GetMap&layers=${layer()}&styles=&crs=EPSG:3857&format=image/png&transparent=true`;

  // ---------- flat map: one picture of the view ----------
  map.createPane("radar").style.zIndex = 379;   // with the smoke and clouds, over the photos; under trails and pins
  map.getPane("radar").style.pointerEvents = "none";
  let overlay = null, shownUrl = "";
  const is3d = () => map.getContainer().classList.contains("is3d");
  function viewBox() {
    const b = map.getBounds().pad(0.3), crs = L.CRS.EPSG3857;
    const sw = crs.project(L.latLng(clamp(b.getSouth(), -85, 85), clamp(b.getWest(), -180, 180)));
    const ne = crs.project(L.latLng(clamp(b.getNorth(), -85, 85), clamp(b.getEast(), -180, 180)));
    const snap = 2 ** Math.round(Math.log2(Math.max(1000, (ne.x - sw.x) / 16)));
    const x0 = Math.floor(sw.x / snap) * snap, x1 = Math.ceil(ne.x / snap) * snap, y0 = Math.floor(sw.y / snap) * snap, y1 = Math.ceil(ne.y / snap) * snap;
    const k = Math.cos((map.getCenter().lat * Math.PI) / 180), m = M_PER_PX / Math.max(0.2, k);
    const w = clamp(Math.round((x1 - x0) / m), 64, 900), h = clamp(Math.round((y1 - y0) / m), 64, 900);
    return { bbox: `${x0},${y0},${x1},${y1}`, w, h, bounds: L.latLngBounds(crs.unproject(L.point(x0, y0)), crs.unproject(L.point(x1, y1))) };
  }
  const urlFor = (v, f) => `${wmsBase()}&bbox=${v.bbox}&width=${v.w}&height=${v.h}&time=${iso(frameT(f))}`;
  function draw2d() {
    if (!on || is3d() || !span) { if (overlay && map.hasLayer(overlay)) map.removeLayer(overlay); shownUrl = ""; return; }
    const v = viewBox(), url = urlFor(v, frame);
    if (url === shownUrl && overlay && map.hasLayer(overlay)) return;
    const img = new Image();   // loaded first, then swapped in, so the rain doesn't blink while it plays
    img.onload = () => {
      if (!on || is3d() || urlFor(viewBox(), frame) !== url) return;
      shownUrl = url;
      if (!overlay) overlay = L.imageOverlay(url, v.bounds, { pane: "radar", opacity: OPACITY, interactive: false, attribution: ATTR }).addTo(map);
      else { overlay.setUrl(url); overlay.setBounds(v.bounds); if (!map.hasLayer(overlay)) overlay.addTo(map); }
      if (playing && frame < frames()) new Image().src = urlFor(v, frame + 1);
    };
    img.onerror = () => { note = "Couldn't load the radar, try again soon."; here(); };
    img.src = url;
  }

  // ---------- 3D map: the same picture draped on the mountains ----------
  const tilesUrl = () => `${wmsBase()}&bbox={bbox-epsg-3857}&width=256&height=256&time=${iso(frameT(frame))}`;
  function sync3d() {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    const apply = () => {
      if (!on || !span) { if (gl.getLayer("radar")) gl.removeLayer("radar"); if (gl.getSource("radar")) gl.removeSource("radar"); return; }
      const src = gl.getSource("radar"), u = tilesUrl();
      if (src) { if (src._rdUrl !== u) { src._rdUrl = u; src.setTiles([u]); } return; }
      // Zoom 7 at most (about one radar pixel per screen pixel there); closer, the browser smooths it (phone memory).
      gl.addSource("radar", { type: "raster", tiles: [u], tileSize: 256, maxzoom: 7, attribution: ATTR });
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
  bar.innerHTML = `<div class="cl-row"><button type="button" id="rdPlay" aria-label="Play the last 3 hours">▶</button>
<input type="range" id="rdFrame" min="0" max="30" step="1" value="30" aria-label="Radar time">
<span class="cl-when" id="rdWhen">Latest</span>
<span class="rd-kind" role="group" aria-label="Rain or snow"><button type="button" data-k="rain" aria-pressed="false">Rain</button><button type="button" data-k="snow" aria-pressed="false">Snow</button></span>
<button type="button" id="rdClose" aria-label="Turn radar off">✕</button></div>
<p class="cl-here" id="rdHere" aria-live="polite"></p>
<div class="cl-key" id="rdKey"></div>`;
  wrap.append(bar);
  const slider = $("rdFrame"), whenEl = $("rdWhen"), playBtn = $("rdPlay");
  // The radar's own colours (Environment Canada's scale), in words
  const KEYS = {
    rain: [["#5ab4ff", "Light"], ["#00c800", "Moderate"], ["#ffd700", "Heavy"], ["#ff1e00", "Very heavy"], ["#a000c8", "Hail or downpour"]],
    snow: [["#5ab4ff", "Light"], ["#00c800", "Moderate"], ["#ffd700", "Heavy"], ["#ff1e00", "Very heavy"], ["#a000c8", "Extreme"]],
  };
  function syncKind() {
    bar.querySelectorAll(".rd-kind button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === kind)));
    $("rdKey").innerHTML = KEYS[kind].map(([c, w]) => `<span><i style="background:${c}"></i>${w}</span>`).join("");
  }
  bar.querySelector(".rd-kind").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b || b.dataset.k === kind) return;
    kind = b.dataset.k; store.set("radarKind", kind); syncKind();
    shownUrl = ""; span = null;
    getSpan().then(() => { setFrame(frames()); }, (er) => { note = `Couldn't load the radar (${er.message}).`; here(); });
  });
  function setFrame(f, from) {
    frame = clamp(Math.round(f), 0, frames());
    slider.max = String(frames());
    if (from !== "slider") slider.value = String(frame);
    whenEl.textContent = label(frame);
    draw();
  }
  slider.addEventListener("input", () => setFrame(+slider.value, "slider"));
  let playing = 0;
  function stop() { clearInterval(playing); playing = 0; playBtn.textContent = "▶"; playBtn.setAttribute("aria-label", "Play the last 3 hours"); }
  playBtn.addEventListener("click", () => {
    if (playing) return stop();
    if (frame >= frames()) setFrame(0);
    playBtn.textContent = "❚❚"; playBtn.setAttribute("aria-label", "Pause");
    playing = setInterval(() => { if (frame >= frames()) stop(); else setFrame(frame + 1); }, is3d() ? 1000 : 450);
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
  function rateAt(lat, lon, f) {
    const key = `${kind},${lat.toFixed(3)},${lon.toFixed(3)},${frameT(f)}`;
    if (cache.has(key)) return cache.get(key);
    const d = 0.01;
    const p = fetch(`${GEOMET}?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=${layer()}&query_layers=${layer()}&crs=EPSG:4326`
      + `&bbox=${(lat - d).toFixed(4)},${(lon - d).toFixed(4)},${(lat + d).toFixed(4)},${(lon + d).toFixed(4)}&width=3&height=3&i=1&j=1&info_format=application/json&time=${iso(frameT(f))}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { const pr = (j.features || [])[0] && j.features[0].properties; const v = pr ? +pr.value : NaN; return Number.isFinite(v) ? Math.max(0, v) : NaN; });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return p;
  }
  let note = "", hereT = 0, hereN = 0;
  function here() {
    const el = $("rdHere");
    if (!span) { el.textContent = note || "Loading the radar…"; return; }
    clearTimeout(hereT);
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
  btn.title = "Rain and snow radar: where it's falling now and the last 3 hours (Environment Canada), on the flat and 3D maps";
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
      getSpan(true).then(() => { note = ""; setFrame(frames()); }, (e) => { note = `Couldn't load the radar (${e.message}).`; here(); });
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
  // New pictures every 6 minutes: while it shows the latest, it moves on with them.
  setInterval(() => {
    if (!on || playing || document.visibilityState !== "visible") return;
    const atEnd = frame >= frames();
    getSpan(true).then(() => setFrame(atEnd ? frames() : frame), () => {});
  }, STEP_S * 1000);
  document.addEventListener("visibilitychange", () => {
    if (on && document.visibilityState === "visible") getSpan(true).then(() => setFrame(frames()), () => {});
  });
  apply();

  window.tfRadar = { isOn: () => on };
})();
