// Two Japan-only Skiing layers from Japan's government (alex 2026-11-01: "Look for other reference sources for Japan ski
// trip"), shown only while the map is in Japan, like the other Japan features:
//  - ❄ Snow depth (JMA): the Japan Meteorological Agency's AMeDAS stations that measure snow (about 300, many in the
//    ski valleys: Hakuba, Nozawa, Kutchan for Niseko, Furano, Asahikawa), with today's depth and the snow of the last
//    6, 12 and 24 hours, every 10 minutes. Read straight from jma.go.jp (open to other sites; reuse allowed with credit,
//    Government of Japan Standard Terms of Use, compatible with CC BY 4.0). Circle markers, so the 3D map copies them.
//  - 🗾 Japan topo map (GSI): the Geospatial Information Authority of Japan's standard map, Japan's official 1:25,000
//    topo with summer trails, huts, contours and place names, over the photos on the flat map (credit GSI).
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const isSki = () => document.body.classList.contains("sport-ski");
  const inJapan = (b) => b.getNorth() > 24 && b.getSouth() < 46.5 && b.getEast() > 122 && b.getWest() < 146.5;
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v === "true"; } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };
  let snowOn = get("tf:jpSnow", true), topoOn = get("tf:jpTopo", false);
  const JMA = "https://www.jma.go.jp/bosai/amedas/";

  // ---------- switches in Skiing's Layers menu ----------
  const snowBtn = document.createElement("button");
  snowBtn.type = "button"; snowBtn.id = "jpSnowBtn";
  snowBtn.title = "Japan: snow depth now and new snow in the last 24 hours at the weather stations (Japan Meteorological Agency)";
  const topoBtn = document.createElement("button");
  topoBtn.type = "button"; topoBtn.id = "jpTopoBtn";
  topoBtn.title = "Japan: the official topo map (GSI), with summer trails, huts and contours, on the flat map";
  function place() {
    if (window.tfSkiSlot) {
      if (!snowBtn.isConnected) window.tfSkiSlot("wx", snowBtn, { label: "Snow depth (Japan)", sym: "❄", bg: "#1c7ed6" });
      if (!topoBtn.isConnected) window.tfSkiSlot("places", topoBtn, { label: "Japan topo map (GSI)", sym: "🗾", bg: "#c92a2a" });
    }
    const jp = inJapan(map.getBounds());
    snowBtn.hidden = topoBtn.hidden = !jp;
    snowBtn.setAttribute("aria-pressed", String(snowOn)); snowBtn.classList.toggle("on", snowOn);
    topoBtn.setAttribute("aria-pressed", String(topoOn)); topoBtn.classList.toggle("on", topoOn);
  }
  snowBtn.addEventListener("click", () => { snowOn = !snowOn; put("tf:jpSnow", snowOn); sync(); });
  topoBtn.addEventListener("click", () => { topoOn = !topoOn; put("tf:jpTopo", topoOn); sync(); });

  // ---------- GSI topo ----------
  map.createPane("jptopo").style.zIndex = 250;   // over the photos (tile pane 200), under every line and dot
  const topo = L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
    pane: "jptopo", minZoom: 5, maxZoom: 18, maxNativeZoom: 18, bounds: [[20, 122], [46.5, 154]],
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">GSI Japan</a> (国土地理院)',
  });

  // ---------- JMA snow depth ----------
  map.createPane("jpsnow").style.zIndex = 430;
  const renderer = L.canvas({ pane: "jpsnow", padding: 0.3, tolerance: 8 });
  if (window.tfSkiTapThrough) window.tfSkiTapThrough(renderer);
  const layer = L.layerGroup();
  let stations = null, obs = null, obsAt = 0, obsTime = "", loading = null;
  const load = () => {
    if (loading) return loading;
    if (obs && Date.now() - obsAt < 10 * 60e3) return Promise.resolve();
    loading = Promise.all([
      stations ? Promise.resolve(stations) : fetch(JMA + "const/amedastable.json").then((r) => r.json()),
      fetch(JMA + "data/latest_time.txt", { cache: "no-cache" }).then((r) => r.text()),
    ]).then(([st, t]) => {
      stations = st; obsTime = t.trim();
      const d = new Date(obsTime), p = (n) => String(n).padStart(2, "0");
      // The map file is named in Japan time: 2026-11-02T03:10:00+09:00 -> 20261102031000
      const j = new Date(d.getTime() + 9 * 3600e3);
      const name = `${j.getUTCFullYear()}${p(j.getUTCMonth() + 1)}${p(j.getUTCDate())}${p(j.getUTCHours())}${p(j.getUTCMinutes())}00`;
      return fetch(`${JMA}data/map/${name}.json`, { cache: "no-cache" }).then((r) => r.json());
    }).then((o) => { obs = o; obsAt = Date.now(); }).catch(() => {}).finally(() => { loading = null; });
    return loading;
  };
  const deg = (a) => a[0] + a[1] / 60;
  const val = (o, k) => (o && Array.isArray(o[k]) && o[k][1] === 0 && o[k][0] != null ? o[k][0] : null);   // [value, quality flag 0 = good]
  const colour = (cm) => cm >= 200 ? "#5f3dc4" : cm >= 100 ? "#1864ab" : cm >= 50 ? "#1c7ed6" : cm >= 10 ? "#74c0fc" : "#d0ebff";
  let selected = null;
  function draw() {
    layer.clearLayers();
    if (!stations || !obs) return;
    const b = map.getBounds().pad(0.2), z = map.getZoom();
    for (const [id, o] of Object.entries(obs)) {
      const cm = val(o, "snow"), s = stations[id];
      if (cm == null || !s) continue;
      const ll = [deg(s.lat), deg(s.lon)];
      if (!b.contains(ll)) continue;
      const fresh = val(o, "snow24h");
      const m = L.circleMarker(ll, { renderer, radius: z >= 10 ? 9 : 7, color: selected === id ? "#ffe14d" : "#fff", weight: selected === id ? 3 : 2, fillColor: colour(cm), fillOpacity: 1 });
      // Zoomed in, each station keeps a short label (depth, and new snow in 24 h); further out, on hover only.
      m.bindTooltip(z >= 11 ? `${cm} cm${fresh ? ` (+${fresh})` : ""}` : `${esc(s.enName)}: ${cm} cm${fresh ? `, +${fresh} cm in 24 h` : ""}`, { direction: "top", permanent: z >= 11, className: "jp-snow-tip" });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); open(id); });
      layer.addLayer(m);
    }
  }
  const css = document.createElement("style");
  css.textContent = `.leaflet-tooltip.jp-snow-tip { padding: 1px 5px; font-size: .72rem; font-weight: 700; }
dialog.jps-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 16px; width: min(420px, calc(100vw - 24px)); box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; font-size: .92rem; box-sizing: border-box; }
dialog.jps-dlg::backdrop { background: rgba(0,0,0,.55); }
dialog.jps-dlg h2 { margin: 0 38px 2px 0; font-family: var(--font-display); font-size: 1.2rem; }
dialog.jps-dlg .jps-x { position: absolute; top: 10px; right: 10px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font-size: 18px; cursor: pointer; }
dialog.jps-dlg dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 10px 0; }
dialog.jps-dlg dt { color: var(--muted); } dialog.jps-dlg dd { margin: 0; font-weight: 700; }
dialog.jps-dlg .jps-small { font-size: .78rem; color: var(--muted); }
dialog.jps-dlg a { color: var(--accent); font-weight: 600; }`;
  document.head.appendChild(css);
  const dlg = document.createElement("dialog");
  dlg.className = "jps-dlg"; dlg.setAttribute("aria-label", "Snow depth");
  document.body.appendChild(dlg);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { selected = null; draw(); });
  function open(id) {
    const s = stations[id], o = obs[id];
    selected = id; draw();
    const row = (k, n) => { const v = val(o, k); return v == null ? "" : `<dt>${n}</dt><dd>${v} cm</dd>`; };
    const temp = val(o, "temp");
    const at = new Date(obsTime).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    dlg.innerHTML = `<button type="button" class="jps-x" aria-label="Close">✕</button>
      <h2>❄ ${esc(s.enName)}</h2>
      <div class="jps-small"><span lang="ja">${esc(s.kjName)}</span> · weather station at ${esc(s.alt)} m</div>
      <dl>${row("snow", "Snow on the ground")}${row("snow24h", "New snow, 24 h")}${row("snow12h", "New snow, 12 h")}${row("snow6h", "New snow, 6 h")}${temp != null ? `<dt>Temperature</dt><dd>${temp}°C</dd>` : ""}</dl>
      <p class="jps-small">Measured ${esc(at)} (your time), in the valley where the station is: the slopes above usually have more. From the <a href="https://www.jma.go.jp/bosai/amedas/#amdno=${esc(id)}&elem=snow" target="_blank" rel="noopener">Japan Meteorological Agency</a> (AMeDAS).</p>`;
    dlg.querySelector(".jps-x").onclick = () => dlg.close();
    if (!dlg.open) dlg.showModal();
  }

  function sync() {
    place();
    const jp = isSki() && inJapan(map.getBounds());
    const wantTopo = jp && topoOn;
    if (wantTopo && !map.hasLayer(topo)) topo.addTo(map);
    if (!wantTopo && map.hasLayer(topo)) map.removeLayer(topo);
    const wantSnow = jp && snowOn && map.getZoom() >= 6;
    if (wantSnow && !map.hasLayer(layer)) layer.addTo(map);
    if (!wantSnow && map.hasLayer(layer)) map.removeLayer(layer);
    if (wantSnow) load().then(draw); else layer.clearLayers();
  }
  map.on("moveend zoomend", sync);
  new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  setInterval(() => { if (map.hasLayer(layer)) load().then(draw); }, 10 * 60e3);
  sync();
})();
