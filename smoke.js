// Wildfire smoke for the trail finder: "🌫 Smoke" in Layers, in every sport, on the flat and 3D maps. Shows the smoke
// from wildfires near the ground (fine particles, PM2.5) now and for the next 3 days, hour by hour, from Environment
// Canada's FireWork smoke forecast (the RAQDPS air quality model with wildfire smoke, 10 km, run twice a day).
// - The map shows the smoke as a haze: pale grey-blue for a little, tan, then red-brown for thick smoke.
// - The bar at the bottom says how smoky the map centre is, in the AQHI+ words Health Canada uses, and what that
//   means for a hard ride. "Smoke here, next 3 days" draws the forecast for the map centre.
// - With ☁ Clouds on too, the two share the clouds slider: one bar, one hour.
// Kept light: the pictures come ready-made from Environment Canada's map server (MSC GeoMet, Open Government Licence -
// Canada), small (about one pixel for 3 km; the browser smooths them), and nothing is drawn pixel by pixel here.
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
  const LAYER = "RAQDPS.Sfc_PM2.5-WildfireSmokePlume";   // surface PM2.5 from wildfire smoke only
  const STYLE = "PM2.5_1e-9to2.5e-7kgm3_RedGrey";
  const ATTR = 'Smoke: <a href="https://eccc-msc.github.io/open-data/msc-data/nwp_raqdps-fw/readme_raqdps-fw_en/">Environment Canada FireWork</a> (OGL-Canada)';
  const HOURS = 72, OPACITY = 0.72;
  const KM_PER_PX = 3;   // the model is 10 km: a small picture, smoothed by the browser, looks better than sharp squares

  const css = document.createElement("style");
  css.textContent = `
.map-tools #smokeBtn.on { background: #8a6d4f; border-color: #8a6d4f; color: #fff; }
#smBar input[type=range] { accent-color: #8a6d4f; }
.sm-info .cl-key i { border-color: #0002; }
.sm-info .sm-fires { font: inherit; font-size: .78rem; font-weight: 700; padding: 3px 8px; margin-left: 6px; }
.sm-chart svg { display: block; width: 100%; height: auto; touch-action: pan-y; cursor: pointer; }
.sm-chart p { margin: 4px 0 0; font-size: .8rem; }
.sm-chart .sm-note { color: var(--muted); font-size: .72rem; }
.cl-bar .sm-info { border-top: 1px solid var(--line); margin-top: 6px; padding-top: 4px; }
`;
  document.head.append(css);

  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const nowHour = () => Math.floor(Date.now() / 3600000) * 3600;
  const iso = (t) => new Date(t * 1000).toISOString().replace(/\.\d+Z$/, "Z");

  // ---------- what the forecast covers ----------
  // The newest run and its hours, from the layer's capabilities (about 20 KB), checked again every half hour.
  let run = null, runAt = 0, runP = null;   // run: { ref: "2026-10-24T00:00:00Z", t0, t1 } in unix seconds
  function getRun() {
    if (run && Date.now() - runAt < 30 * 60000) return Promise.resolve(run);
    if (runP) return runP;
    runP = fetch(`${GEOMET}?service=WMS&version=1.3.0&request=GetCapabilities&layer=${LAYER}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then((x) => {
        const time = (x.match(/<Dimension name="time"[^>]*>([^<]+)</) || [])[1], ref = (x.match(/<Dimension name="reference_time"[^>]*default="([^"]+)"/) || [])[1];
        if (!time) throw new Error("no forecast hours");
        const [a, b] = time.split("/");
        run = { ref: ref || "", t0: Date.parse(a) / 1000, t1: Date.parse(b) / 1000 };
        runAt = Date.now();
        return run;
      })
      .finally(() => { runP = null; });
    return runP;
  }
  const wmsBase = () => `${GEOMET}?service=WMS&version=1.3.0&request=GetMap&layers=${LAYER}&styles=${STYLE}&crs=EPSG:3857&format=image/png&transparent=true`
    + (run && run.ref ? `&dim_reference_time=${run.ref}` : "");
  const hourT = (h) => baseT + h * 3600;
  const covered = (h) => !!run && hourT(h) >= run.t0 && hourT(h) <= run.t1;

  // ---------- the hour ----------
  let hour = 0, baseT = nowHour();
  const follow = () => !!(window.tfClouds && window.tfClouds.isOn && window.tfClouds.isOn());   // ☁ Clouds on: its slider leads
  const label = (h) => {
    if (h === 0) return "Now";
    const d = new Date(hourT(h) * 1000), today = new Date().toDateString() === d.toDateString();
    const t = d.toLocaleTimeString("en-CA", { hour: "numeric" }).replace(/\s?([ap])\.?m\.?/i, " $1m");
    return `${today ? "Today" : d.toLocaleDateString("en-CA", { weekday: "short" })} ${t}`;
  };

  // ---------- flat map: one small picture of the view ----------
  map.createPane("smoke").style.zIndex = 378;   // just under the clouds, over the photos; under trails and pins
  map.getPane("smoke").style.pointerEvents = "none";
  let overlay = null, shownUrl = "";
  const is3d = () => map.getContainer().classList.contains("is3d");
  // The view, padded and snapped to a coarse grid so small moves reuse the same picture (and the browser's copy).
  function viewBox() {
    const b = map.getBounds().pad(0.4), crs = L.CRS.EPSG3857;
    const sw = crs.project(L.latLng(clamp(b.getSouth(), -85, 85), clamp(b.getWest(), -180, 180)));
    const ne = crs.project(L.latLng(clamp(b.getNorth(), -85, 85), clamp(b.getEast(), -180, 180)));
    const snap = 2 ** Math.round(Math.log2(Math.max(2000, (ne.x - sw.x) / 16)));
    const x0 = Math.floor(sw.x / snap) * snap, x1 = Math.ceil(ne.x / snap) * snap, y0 = Math.floor(sw.y / snap) * snap, y1 = Math.ceil(ne.y / snap) * snap;
    // Metres per pixel on the ground, at this latitude
    const k = Math.cos((map.getCenter().lat * Math.PI) / 180), m = (KM_PER_PX * 1000) / Math.max(0.2, k);
    const w = clamp(Math.round((x1 - x0) / m), 48, 640), h = clamp(Math.round((y1 - y0) / m), 48, 640);
    const ll0 = crs.unproject(L.point(x0, y0)), ll1 = crs.unproject(L.point(x1, y1));
    return { bbox: `${x0},${y0},${x1},${y1}`, w, h, bounds: L.latLngBounds(ll0, ll1) };
  }
  const urlFor = (v, h) => `${wmsBase()}&bbox=${v.bbox}&width=${v.w}&height=${v.h}&time=${iso(hourT(h))}`;
  function draw2d() {
    if (!on || is3d() || !run) { if (overlay && map.hasLayer(overlay)) map.removeLayer(overlay); shownUrl = ""; return; }
    if (!covered(hour)) { if (overlay && map.hasLayer(overlay)) map.removeLayer(overlay); shownUrl = ""; return; }
    const v = viewBox(), url = urlFor(v, hour);
    if (url === shownUrl && overlay && map.hasLayer(overlay)) return;
    // Loaded first, then swapped in, so the haze doesn't blink while the slider moves.
    const img = new Image();
    img.onload = () => {
      if (!on || is3d() || urlFor(viewBox(), hour) !== url) return;
      shownUrl = url;
      if (!overlay) overlay = L.imageOverlay(url, v.bounds, { pane: "smoke", opacity: OPACITY, interactive: false, attribution: ATTR }).addTo(map);
      else { overlay.setUrl(url); overlay.setBounds(v.bounds); if (!map.hasLayer(overlay)) overlay.addTo(map); }
      // The next hour too, while the slider plays
      if (playing && covered(hour + 1)) new Image().src = urlFor(v, hour + 1);
    };
    img.onerror = () => { note = "Couldn't load the smoke map, try again soon."; here(); };
    img.src = url;
  }

  // ---------- 3D map: the same haze draped on the mountains ----------
  // Ready-made tiles from the map server; MapLibre decodes them itself (no pictures made on the page). Zoom 4 at
  // most (a pixel is about one model square): two to six tiles for a view, smoothed when closer (phone memory).
  const tilesUrl = () => `${wmsBase()}&bbox={bbox-epsg-3857}&width=256&height=256&time=${iso(hourT(hour))}`;
  function sync3d() {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    const apply = () => {
      if (!on || !run || !covered(hour)) { if (gl.getLayer("smoke")) gl.removeLayer("smoke"); if (gl.getSource("smoke")) gl.removeSource("smoke"); return; }
      const src = gl.getSource("smoke"), u = tilesUrl();
      if (src) { if (src._smUrl !== u) { src._smUrl = u; src.setTiles([u]); } return; }
      gl.addSource("smoke", { type: "raster", tiles: [u], tileSize: 256, maxzoom: 4, attribution: ATTR });
      gl.getSource("smoke")._smUrl = u;
      // With the other pictures on the ground, under the clouds' fog, before the road and trail lines.
      const before = ["clouds", "osm-roads", "lines"].find((id) => gl.getLayer(id));
      gl.addLayer({ id: "smoke", type: "raster", source: "smoke", paint: { "raster-opacity": OPACITY, "raster-fade-duration": 0, "raster-resampling": "linear" } }, before);
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
    chartCursor();
  }

  // ---------- the bar ----------
  const wrap = map.getContainer().parentElement;
  const bar = document.createElement("div");
  bar.className = "cl-bar"; bar.id = "smBar"; bar.hidden = true; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Wildfire smoke forecast");
  bar.innerHTML = `<div class="cl-row" id="smRow"><button type="button" id="smPlay" aria-label="Play the next hours">▶</button>
<input type="range" id="smHour" min="0" max="${HOURS}" step="1" value="0" aria-label="Forecast hour">
<span class="cl-when" id="smWhen">Now</span><button type="button" id="smClose" aria-label="Turn smoke off">✕</button></div>`;
  const info = document.createElement("div");
  info.className = "sm-info";
  info.innerHTML = `<p class="cl-here" id="smHere" aria-live="polite"></p>
<div class="cl-key"><span><i style="background:#c6d3df"></i>A little smoke</span><span><i style="background:#c9a66b"></i>Smoky</span><span><i style="background:#b0563a"></i>Thick</span><span><i style="background:#5c1a23"></i>Very thick</span><button type="button" class="sm-fires" id="smFires" hidden>🔥 Show the fires</button></div>
<details id="smMore"><summary>Smoke here, next 3 days</summary><div class="sm-chart" id="smChart"></div></details>`;
  bar.append(info);
  wrap.append(bar);
  const slider = $("smHour"), whenEl = $("smWhen"), playBtn = $("smPlay");
  function setHour(h, from) {
    hour = clamp(Math.round(h), 0, HOURS);
    if (from !== "slider") slider.value = String(hour);
    whenEl.textContent = label(hour);
    draw();
  }
  slider.addEventListener("input", () => setHour(+slider.value, "slider"));
  let playing = 0;
  function stop() { clearInterval(playing); playing = 0; playBtn.textContent = "▶"; playBtn.setAttribute("aria-label", "Play the next hours"); }
  playBtn.addEventListener("click", () => {
    if (playing) return stop();
    if (hour >= HOURS || !covered(hour + 1)) setHour(0);
    playBtn.textContent = "❚❚"; playBtn.setAttribute("aria-label", "Pause");
    playing = setInterval(() => { if (hour >= HOURS || !covered(hour + 1)) stop(); else setHour(hour + 1); }, is3d() ? 1400 : 600);
  });
  $("smClose").addEventListener("click", () => btn.click());
  // With ☁ Clouds on, the smoke lines sit in the clouds bar and follow its slider.
  window.addEventListener("tf:cloudhour", (e) => { if (on && follow() && e.detail !== hour) { hour = e.detail; slider.value = String(hour); whenEl.textContent = label(hour); draw(); } });
  function place() {
    const cl = document.querySelector(".cl-bar:not(#smBar)");
    if (on && follow() && cl) {
      stop();
      if (info.parentElement !== cl) cl.append(info);
      bar.hidden = true;
      const h = window.tfClouds.hour ? window.tfClouds.hour() : hour;
      if (h !== hour) { hour = h; slider.value = String(hour); whenEl.textContent = label(hour); draw(); }
    } else {
      if (info.parentElement !== bar) bar.append(info);
      bar.hidden = !on;
    }
  }
  const clBar = document.querySelector(".cl-bar:not(#smBar)");
  if (clBar) new MutationObserver(place).observe(clBar, { attributes: true, attributeFilter: ["hidden"] });

  // ---------- smoke at the map centre ----------
  // AQHI+ (Health Canada): one point for each 10 µg/m³ of PM2.5 over an hour; 1-3 low risk, 4-6 moderate, 7-10 high,
  // over 10 very high. The advice is Health Canada's for the general public, said for a ride.
  const RISK = [
    [10, "very little smoke", ""],
    [30, "a little smoke (low risk)", ""],
    [60, "smoky (moderate risk)", " Fine for most riders; ease off a hard ride if you feel it in your chest or throat."],
    [100, "very smoky (high risk)", " Better to ride easy and short, or another day."],
    [Infinity, "thick smoke (very high risk)", " Best to skip a hard ride today."],
  ];
  const riskOf = (ug) => RISK.find(([max]) => ug < max);
  const aqhi = (ug) => Math.max(1, Math.ceil(ug / 10));
  const pmCache = new Map();
  function pmAt(lat, lon, h) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)},${hourT(h)},${run ? run.ref : ""}`;
    if (pmCache.has(key)) return pmCache.get(key);
    const d = 0.05;
    const p = fetch(`${GEOMET}?service=WMS&version=1.3.0&request=GetFeatureInfo&layers=${LAYER}&query_layers=${LAYER}&crs=EPSG:4326`
      + `&bbox=${(lat - d).toFixed(4)},${(lon - d).toFixed(4)},${(lat + d).toFixed(4)},${(lon + d).toFixed(4)}&width=3&height=3&i=1&j=1&info_format=application/json&time=${iso(hourT(h))}`
      + (run && run.ref ? `&dim_reference_time=${run.ref}` : ""))
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { const f = (j.features || [])[0]; const v = f && f.properties ? +f.properties.value : NaN; return Number.isFinite(v) ? Math.max(0, v * 1e9) : NaN; });   // kg/m³ to µg/m³
    p.catch(() => pmCache.delete(key));
    pmCache.set(key, p);
    if (pmCache.size > 400) pmCache.delete(pmCache.keys().next().value);
    return p;
  }
  let note = "", hereT = 0, hereN = 0;
  function here() {
    const el = $("smHere");
    syncFiresLink();
    if (!run) { el.textContent = note || "Loading the smoke forecast…"; return; }
    if (!covered(hour)) { el.textContent = `Smoke: the forecast reaches ${label(Math.round((run.t1 - baseT) / 3600))} for now (Environment Canada runs it twice a day).`; return; }
    clearTimeout(hereT);
    hereT = setTimeout(() => {
      const c = map.getCenter(), h = hour, n = ++hereN;
      pmAt(c.lat, c.lng, h).then((ug) => {
        if (n !== hereN) return;
        if (Number.isNaN(ug)) { el.textContent = "Smoke: no forecast for the map centre (outside the model's area)."; return; }
        const [, words, advice] = riskOf(ug);
        el.textContent = `Wildfire smoke at the map centre: ${words}, ${ug < 1 ? "under 1" : Math.round(ug)} µg/m³${ug >= 10 ? ` (AQHI+ ${aqhi(ug)})` : ""}.${advice}${note ? " " + note : ""}`;
      }, () => { if (n === hereN) el.textContent = "Couldn't read the smoke at the map centre, try again soon."; });
    }, playing ? 0 : 300);
  }
  // Smoke comes from fires: offer the 🔥 Wildfires layer when it's off.
  function syncFiresLink() {
    const f = $("firesBtn"), b = $("smFires");
    b.hidden = !f || f.hidden || f.getAttribute("aria-pressed") === "true";
  }
  $("smFires").addEventListener("click", () => { const f = $("firesBtn"); if (f && f.getAttribute("aria-pressed") !== "true") f.click(); syncFiresLink(); });
  if ($("firesBtn")) new MutationObserver(syncFiresLink).observe($("firesBtn"), { attributes: true, attributeFilter: ["aria-pressed", "hidden"] });

  // ---------- smoke here, next 3 days ----------
  // Every 3 hours (about 24 small questions to the map server, four at a time), only when the chart is opened.
  let chartData = null, chartKey = "";
  async function chartHere() {
    const el = $("smChart"), c = map.getCenter(), key = `${c.lat.toFixed(2)},${c.lng.toFixed(2)},${baseT},${run ? run.ref : ""}`;
    if (key === chartKey && el.firstChild) return;
    chartKey = key;
    el.innerHTML = `<p class="sm-note">Loading the smoke forecast here…</p>`;
    try {
      await getRun();
      const hs = [];
      for (let h = 0; h <= HOURS; h += 3) if (covered(h)) hs.push(h);
      const vals = new Array(hs.length).fill(NaN), queue = hs.map((h, i) => [h, i]);
      await Promise.all([0, 1, 2, 3].map(async () => { while (queue.length) { const [h, i] = queue.shift(); vals[i] = await pmAt(c.lat, c.lng, h).catch(() => NaN); } }));
      if (chartKey !== key) return;
      chartData = { hs, vals };
      el.innerHTML = chartSvg(hs, vals) + summary(hs, vals)
        + `<p class="sm-note">Wildfire smoke near the ground, every 3 hours, for the map centre. Tap the chart to see that hour on the map. Forecast: Environment Canada FireWork (10 km; smoke from fires only, not city haze).</p>`;
      el.querySelector("svg").addEventListener("pointerdown", (e) => {
        const svg = e.currentTarget, b = svg.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * CW;
        const h = clamp(Math.round(((x - CL) / (CW - CL - 4)) * HOURS), 0, HOURS);
        if (follow() && window.tfClouds.setHour) window.tfClouds.setHour(h); else setHour(h);
      });
      chartCursor();
    } catch (e) {
      if (chartKey === key) el.innerHTML = `<p class="sm-note">Couldn't load the smoke forecast here (${String(e.message).replace(/[<>&]/g, "")}).</p>`;
    }
  }
  const CW = 340, CL = 30, CH = 90, CT = 6;
  const colourOf = (ug) => (ug < 10 ? "#c6d3df" : ug < 30 ? "#c9a66b" : ug < 60 ? "#c7783f" : ug < 100 ? "#b0563a" : "#5c1a23");
  function chartSvg(hs, vals) {
    const top = Math.max(30, ...vals.filter(Number.isFinite)) * 1.1;
    const X = (h) => CL + (h / HOURS) * (CW - CL - 4), Y = (v) => CT + CH - (Math.min(v, top) / top) * CH, bw = ((CW - CL - 4) / HOURS) * 3 - 1;
    let s = `<svg viewBox="0 0 ${CW} ${CT + CH + 18}" role="img" aria-label="Wildfire smoke at the map centre over the next 3 days">`;
    [10, 30, 60, 100].filter((v) => v < top).forEach((v) => {
      s += `<line x1="${CL}" x2="${CW - 4}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="currentColor" stroke-opacity=".18" stroke-dasharray="3 3"/>`
        + `<text x="${CL - 3}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="currentColor" opacity=".7">${v}</text>`;
    });
    hs.forEach((h, i) => {
      const v = vals[i];
      if (!Number.isFinite(v)) return;
      const y = Y(Math.max(v, top * 0.015));
      s += `<rect x="${(X(h) - bw / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(CT + CH - y).toFixed(1)}" fill="${colourOf(v)}" stroke="#0003" stroke-width=".5"/>`;
    });
    for (let h = 0; h <= HOURS; h++) {
      const d = new Date(hourT(h) * 1000);
      if (h === 0 || d.getHours() === 0) s += `<text x="${(X(h) + 2).toFixed(1)}" y="${CT + CH + 13}" font-size="9" fill="currentColor">${h === 0 ? "Now" : d.toLocaleDateString("en-CA", { weekday: "short" })}</text>`
        + `<line x1="${X(h).toFixed(1)}" x2="${X(h).toFixed(1)}" y1="${CT}" y2="${CT + CH}" stroke="currentColor" stroke-opacity=".25" stroke-width=".8"/>`;
    }
    s += `<text x="2" y="${CT + CH + 13}" font-size="8" fill="currentColor" opacity=".7">µg/m³</text>`;
    s += `<line class="sm-cur" x1="${X(hour).toFixed(1)}" x2="${X(hour).toFixed(1)}" y1="${CT}" y2="${CT + CH}" stroke="#e8590c" stroke-width="2"/></svg>`;
    return s;
  }
  function summary(hs, vals) {
    const ok = vals.map((v, i) => [hs[i], v]).filter(([, v]) => Number.isFinite(v));
    if (!ok.length) return `<p>No smoke forecast for this spot.</p>`;
    const worst = ok.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (worst[1] < 10) return `<p>Clean air for riding here: very little wildfire smoke in the forecast.</p>`;
    const clean = ok.filter(([, v]) => v < 10).map(([h]) => h);
    const rest = clean.length >= ok.length * 0.7 ? " Clean air the rest of the time." : clean.length ? ` Next clean air: ${label(clean.find((h) => h >= hour) ?? clean[0]).replace(/^Now$/, "now")}.` : " No clean air in the forecast.";
    return `<p>Smokiest ${label(worst[0])}: ${riskOf(worst[1])[1]}, ${Math.round(worst[1])} µg/m³.${rest}</p>`;
  }
  function chartCursor() {
    const ln = document.querySelector("#smChart .sm-cur");
    if (!ln) return;
    const x = (CL + (hour / HOURS) * (CW - CL - 4)).toFixed(1);
    ln.setAttribute("x1", x); ln.setAttribute("x2", x);
  }
  $("smMore").addEventListener("toggle", () => { if ($("smMore").open) { chartKey = ""; chartHere(); } });

  // ---------- the button ----------
  const btn = document.createElement("button");
  btn.id = "smokeBtn"; btn.type = "button"; btn.setAttribute("aria-pressed", "false");
  btn.title = "Wildfire smoke now and for the next 3 days (Environment Canada forecast), on the flat and 3D maps";
  btn.textContent = "🌫 Smoke";
  const list = document.querySelector("#layersMenu .lm-overlays");
  const after = $("cloudBtn") || $("firesBtn");
  if (after && after.parentElement === list) after.after(btn); else if (list) list.prepend(btn); else return;
  let on = store.get("smoke", false);
  function apply() {
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", String(on));
    if (on) {
      if (nowHour() !== baseT) { baseT = nowHour(); }
      whenEl.textContent = label(hour);
      place();
      note = "";
      here();
      getRun().then(() => { note = ""; draw(); }, (e) => { note = `Couldn't load the smoke forecast (${e.message}).`; here(); });
    } else {
      stop();
      place();
      if (overlay && map.hasLayer(overlay)) map.removeLayer(overlay);
      shownUrl = "";
      sync3d();
    }
  }
  btn.addEventListener("click", () => { on = !on; store.set("smoke", on); apply(); });
  let moveT = 0;
  map.on("moveend", () => { if (!on) return; clearTimeout(moveT); moveT = setTimeout(() => { draw(); if ($("smMore").open) chartHere(); }, 400); });
  // Back after a while: the forecast moves on with the clock, and a new run may be out.
  document.addEventListener("visibilitychange", () => {
    if (!on || document.visibilityState !== "visible") return;
    if (nowHour() !== baseT) baseT = nowHour();
    getRun().then(() => setHour(follow() && window.tfClouds.hour ? window.tfClouds.hour() : hour), () => {});
  });
  apply();

  window.tfSmoke = { isOn: () => on };
})();
