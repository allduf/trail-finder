// Offline maps: save an area's map, trails and forest roads on this device before riding out of signal.
// The map is the "Sharp outdoor (vector)" style from OpenFreeMap, which allows downloading areas (no key, no
// limits). The other styles (OpenStreetMap's own tiles above all) forbid bulk downloads, so they're never saved.
// Everything goes in the "tf-offline-1" cache that sw.js reads from when there's no connection. Trail and road
// data are the nightly data/*-<zone>.json files of every zone the area touches.
(() => {
  "use strict";
  const map = window.tfLeaflet, btn = document.getElementById("offlineBtn");
  if (!map || !btn || !window.L || !("caches" in window)) { if (btn) btn.hidden = true; return; }
  const CACHE = "tf-offline-1", KEY = "tf-offline-areas";
  const STYLE = "https://tiles.openfreemap.org/styles/liberty";
  const MAX_Z = 14;            // OpenFreeMap's deepest tiles; closer zooms are drawn from them
  const MAX_TILES = 6000;      // about 150 MB: a big valley, not the whole Sea to Sky
  const TILE_KB = 25;          // rough average vector tile in the mountains, for the estimate
  const DATA = ["trails", "names", "mtb", "heights", "roads", "unmapped"];
  const LIBS = [
    "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js",
    "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css",
    "https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.1.3/leaflet-maplibre-gl.js",
  ];
  const GLYPH_RANGES = ["0-255", "256-511", "512-767", "768-1023", "8192-8447"]; // Latin, accents, punctuation
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const save = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch {} };
  const mb = (b) => (b < 1e6 ? "under 1 MB" : b < 1e9 ? Math.round(b / 1e6) + " MB" : (b / 1e9).toFixed(1) + " GB");

  // ---------- tile maths ----------
  const tx = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const ty = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
  const clampN = (v, z) => Math.max(0, Math.min(2 ** z - 1, v));
  function tileRanges(box, minz, maxz) { // box = [south, west, north, east]
    const out = [];
    for (let z = minz; z <= maxz; z++)
      out.push({ z, x0: clampN(tx(box[1], z), z), x1: clampN(tx(box[3], z), z), y0: clampN(ty(box[2], z), z), y1: clampN(ty(box[0], z), z) });
    return out;
  }
  const countTiles = (rs) => rs.reduce((n, r) => n + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1), 0);
  function* tileUrls(src, box, boxes) {
    if (boxes) { const seen = new Set(); for (const b of boxes) for (const u of tileUrls(src, b)) if (!seen.has(u)) { seen.add(u); yield u; } return; }
    for (const r of tileRanges(box, src.minz, src.maxz))
      for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) yield src.tmpl.replace("{z}", r.z).replace("{x}", x).replace("{y}", y);
  }
  // A route's corridor (moto.js): small boxes along the line, the tiles they share counted once.
  const corridorCount = (boxes) => { const seen = new Set(); for (const b of boxes) for (const r of tileRanges(b, 0, MAX_Z)) for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) seen.add(r.z + "/" + x + "/" + y); return seen.size; };
  const zonesIn = (box) => (window.tfZones || []).filter((z) => z.box[0] < box[2] && z.box[2] > box[0] && z.box[1] < box[3] && z.box[3] > box[1]);
  const dataUrls = (box) => [...zonesIn(box).flatMap((z) => DATA.map((d) => `data/${d}-${z.id}.json`)), "data/fires.json", "data/motor-closures.json", ...(window.tfMotoOffline ? window.tfMotoOffline() : [])]
    .map((u) => new URL(u, location.href).href);
  // What each sport adds to a saved area (alex 2026-10-27: offline maps for every sport, 3D too): Skiing's routes,
  // forecast and slope terrain (winter.js), Hunting's zones, seasons and the picture layers that are on (hunting.js),
  // Fishing's waters, rules and stocking (fishing.js), Moto's gas and camping lists (dataUrls above), and with "3D map"
  // ticked the 3D map's heights, plus last winter's photos in Skiing (map3d.js). An area remembers its sport, 3D and
  // hunting layers, so Finish and Delete work on the same files whatever sport is on later.
  const SPORTS = ["ski", "hunt", "fish", "moto"];
  const sportNow = () => SPORTS.find((s) => document.body.classList.contains("sport-" + s)) || "mtb";
  const sportOf = (a) => a.sport || (a.ski ? "ski" : "mtb");   // areas saved before 2026-10-27 only had "ski"
  const ICON = { mtb: "🚵", ski: "⛷", hunt: "🦌", fish: "🎣", moto: "🏍" };
  const WHAT = {
    mtb: "the map, trails and forest roads",
    ski: "the map, ski routes, huts, the avalanche forecast, snow stations and slope angles",
    hunt: "the map, hunting zones, seasons, draws and the hunting layers you have on",
    fish: "the map, the lakes and rivers with their fish, rules, stocking, boat launches and hidden spots",
    moto: "the map, roads and tracks (to plan and re-route a ride with no signal), gas, camping and hot springs",
  };
  const none = { data: [], tiles: [] };
  async function extras(box, sport, d3, huntLayers) {
    const parts = [];
    // Hunting's and Fishing's files load with their sport (winter.js): an area saved there, deleted from MTB, needs them.
    if ((sport === "hunt" || sport === "fish") && window.tfLoadSport) await window.tfLoadSport(sport).catch(() => {});
    if (sport === "ski" && window.tfSkiOffline) parts.push(window.tfSkiOffline(box));
    if (sport === "hunt" && window.tfHuntOffline) parts.push(window.tfHuntOffline(box, huntLayers));
    if (sport === "fish" && window.tfFishOffline) parts.push(window.tfFishOffline(box));
    const d = d3 && window.tf3dOffline ? await window.tf3dOffline(box, sport).catch(() => null) : null;
    if (d) parts.push(d);
    return { data: [...new Set(parts.flatMap((p) => p.data))], tiles: [...new Set(parts.flatMap((p) => p.tiles))],
      hunt: parts.find((p) => p.layers) || null, d3: d };
  }
  // Rough sizes for the estimate: one tile of each kind.
  const tileKB = (u) => (/mapterhorn/.test(u) ? 100 : /elevation-tiles/.test(u) ? 60 : /trail-finder-winter/.test(u) ? 7 : 30);
  const D3_KEY = "tf-offline-3d";
  const want3d = () => { try { return localStorage.getItem(D3_KEY) !== "0"; } catch { return true; } };
  const viewBox = () => { const b = map.getBounds().pad(0.1);   // a margin, as the vector map draws a little past the screen
    return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((v) => +v.toFixed(5)); };
  let drawn = null;   // [south, west, north, east] of a square drawn on the map, saved instead of the screen
  const areaBox = () => drawn || viewBox();

  // ---------- panel ----------
  const css = document.createElement("style");
  css.textContent = `
.offline-card { position: absolute; z-index: 1001; left: 56px; top: 12px; width: min(340px, calc(100% - 68px)); max-height: calc(100% - 40px); overflow-y: auto; box-sizing: border-box;
  background: var(--panel); color: var(--fg); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.22); padding: 12px 14px; font-size: .88rem; }
.offline-card h2 { margin: 0 0 4px; font-size: 1rem; display: flex; justify-content: space-between; align-items: center; }
.offline-card h2 button { font: inherit; border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 1.1rem; padding: 0 4px; }
.offline-card p { margin: 6px 0; }
.offline-card .muted { color: var(--muted); font-size: .8rem; }
.offline-card input { width: 100%; box-sizing: border-box; font: inherit; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); margin: 4px 0 8px; }
.offline-card .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.offline-card .bar { height: 12px; border-radius: 6px; background: var(--line); overflow: hidden; margin: 8px 0 4px; }
.offline-card .bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s; }
.offline-card .off-state { margin: 10px 0 4px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--chip); }
.offline-card .off-state > b { display: block; font-size: 1.05rem; }
.offline-card .off-state p { margin: 4px 0 0; }
.offline-card .off-state .row { margin-top: 8px; }
.offline-card .off-state.ok { background: #e3f4ea; border-color: #1f8a4c; color: #0f4d2a; }
.offline-card .off-state.bad { background: #fdf0dc; border-color: #c27309; color: #6b3d00; }
.offline-card .off-state.ok .bar, .offline-card .off-state.bad .bar { display: none; }
.offline-card li .ok { display: block; color: #1f8a4c; font-size: .8rem; font-weight: 600; }
.off-frame .box-bar .btn.primary { flex: 1.8; }
.off-frame .box-tip.too-big { color: #b42318; font-weight: 600; }
.offline-card ul { list-style: none; margin: 8px 0 0; padding: 0; border-top: 1px solid var(--line); }
.offline-card li { display: flex; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line); }
.offline-card li div { flex: 1; min-width: 0; }
.offline-card li b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.offline-card h3 { margin: 12px 0 0; font-size: .9rem; }
.offline-card li .warn { display: block; color: #b45309; font-size: .8rem; font-weight: 600; }
.offline-card li button.del { color: #b42318; }
.offline-card li button { font: inherit; font-size: .8rem; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
.offline-card label.d3 { display: flex; gap: 8px; align-items: center; margin: 0 0 4px; cursor: pointer; }
.offline-card label.d3 input { width: auto; margin: 0; accent-color: var(--accent); }
.offline-card .linkish { font: inherit; border: 0; background: none; padding: 0; color: var(--accent); text-decoration: underline; cursor: pointer; }
.off-area-name span { position: absolute; left: 0; bottom: 4px; transform: translateX(-50%); white-space: nowrap; font: 700 13px var(--font-body, system-ui); color: #14804a;
  text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff, 0 0 4px #fff; pointer-events: none; }
.map-tools #offlineBtn.on { background: var(--accent); border-color: var(--accent); color: #fff; }`;
  document.head.append(css);
  const card = document.createElement("div");
  card.className = "offline-card";
  card.hidden = true;
  card.innerHTML = `<h2>Offline maps <button type="button" data-x aria-label="Close">✕</button></h2>
<p class="muted" data-what></p>
<div data-new><input data-name maxlength="60" aria-label="Name for this area">
<label class="d3"><input type="checkbox" data-3d> <span data-3d-label>3D map too</span></label><p data-est></p>
<div class="row"><button class="btn primary" type="button" data-save>Save this area</button><button class="btn" type="button" data-draw>▭ Pick a square</button></div>
<p class="muted" data-drawn hidden>Saving the square you picked. <button type="button" class="linkish" data-undraw>Use the screen instead</button></p>
<div class="off-state" data-state hidden><b data-st-head></b><div class="bar"><i></i></div><p data-prog></p><div class="row" data-st-acts></div></div></div>
<h3 data-saved-h hidden>Saved areas</h3><ul data-list></ul><p class="muted" data-use></p>`;
  document.querySelector(".mapwrap").append(card);
  L.DomEvent.disableClickPropagation(card);
  L.DomEvent.disableScrollPropagation(card);
  const $ = (s) => card.querySelector(s);
  const outlines = L.layerGroup();
  const drawnLayer = L.layerGroup();
  // Where the saved areas are (alex 2026-10-31, offline in airplane mode: "what regions did it save?"): each one's
  // edge as a green dashed line with its name, on the flat map and the 3D map, whenever there's no signal or
  // Offline maps is open. Outside the line, nothing was saved: the map there is only what the phone still had.
  const OUT_SRC = "tf-offline-areas", OUT_COLOR = "#14804a";
  const outlinesOn = () => !card.hidden || !navigator.onLine;
  function areaRing(a) {
    const [s, w, n, e] = a.box;
    return [[w, s], [e, s], [e, n], [w, n], [w, s]];
  }
  function outlineGeo() {
    const areas = outlinesOn() ? load() : [];
    return { type: "FeatureCollection", features: areas.flatMap((a) => [
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: areaRing(a) } },
      { type: "Feature", properties: { n: `${a.missing ? "⚠ " : "✓ "}Saved: ${a.name}` }, geometry: { type: "Point", coordinates: [(a.box[1] + a.box[3]) / 2, a.box[2]] } },
    ]) };
  }
  function drawOutlines3d() {
    const gl = window.trailMap3d;
    if (!gl || !gl.style || !gl.style._loaded) return;
    try {
      const data = outlineGeo(), src = gl.getSource(OUT_SRC);
      if (src) { src.setData(data); return; }
      if (!data.features.length) return;   // nothing to show: the 3D map gets no extra layers at all
      gl.addSource(OUT_SRC, { type: "geojson", data });
      gl.addLayer({ id: "off-area-case", type: "line", source: OUT_SRC, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#fff", "line-width": 6, "line-opacity": 0.85 } });
      gl.addLayer({ id: "off-area", type: "line", source: OUT_SRC, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": OUT_COLOR, "line-width": 3, "line-dasharray": [2, 1.5] } });
      gl.addLayer({ id: "off-area-name", type: "symbol", source: OUT_SRC, filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": ["get", "n"], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-anchor": "bottom", "text-offset": [0, -0.3], "text-allow-overlap": true },
        paint: { "text-color": OUT_COLOR, "text-halo-color": "#fff", "text-halo-width": 2 } });
    } catch {}
  }
  function drawOutlines() {
    outlines.clearLayers();
    if (outlinesOn()) {
      outlines.addTo(map);
      for (const a of load()) {
        const r = L.rectangle([[a.box[0], a.box[1]], [a.box[2], a.box[3]]], { color: "#fff", weight: 6, opacity: 0.85, fill: false, interactive: false }).addTo(outlines);
        L.rectangle(r.getBounds(), { color: OUT_COLOR, weight: 3, dashArray: "8 6", fill: false, interactive: false }).addTo(outlines);
        L.marker([a.box[2], (a.box[1] + a.box[3]) / 2], { interactive: false, keyboard: false,
          icon: L.divIcon({ className: "off-area-name", html: `<span>${a.missing ? "⚠" : "✓"} Saved: ${esc(a.name)}</span>`, iconSize: [0, 0] }) }).addTo(outlines);
      }
    } else outlines.remove();
    drawOutlines3d();
  }
  window.addEventListener("tf:map3d", (e) => {
    const gl = e.detail || window.trailMap3d;
    setTimeout(drawOutlines3d, 0);
    if (gl && !gl.tfOffOutlines) { gl.tfOffOutlines = true; gl.on("styledata", () => { if (gl === window.trailMap3d && !gl.getSource(OUT_SRC)) drawOutlines3d(); }); }
  });
  window.addEventListener("offline", drawOutlines);
  window.addEventListener("online", drawOutlines);
  setTimeout(drawOutlines, 0);

  let busy = null; // { stop: bool } while saving
  function open(on) {
    card.hidden = !on;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on);
    if (on) {
      drawnLayer.addTo(map); $("[data-name]").value = suggestName(); sportText(); renderList(); estimate();
      if (!busy) $("[data-state]").hidden = true;
      setTimeout(autoFinish, 1500);
    } else { drawnLayer.remove(); setDrawn(null); sqMode(false); }
    drawOutlines();
  }
  btn.addEventListener("click", () => open(card.hidden));
  // The card's words follow the sport, so no bike words in Skiing, Hunting or Fishing.
  function sportText() {
    const s = sportNow();
    $("[data-what]").textContent = `Save the area on screen, or pick a square on the map, to use ${WHAT[s]} with no signal. With no signal, each saved area shows as a green dashed square on the map.` +
      (s === "ski" ? " Inside it the 3D map keeps last winter's photos, like online; the flat map uses the Sharp outdoor style." : " The map uses the Sharp outdoor style there (the photos can't be saved).");
    $("[data-3d-label]").textContent = s === "ski" ? "3D map too (the mountains' shape and last winter's photos)" : "3D map too (the mountains' shape, with the saved map on them)";
    $("[data-3d]").checked = want3d();
  }
  $("[data-3d]").addEventListener("change", (e) => { try { localStorage.setItem(D3_KEY, e.target.checked ? "1" : "0"); } catch {} estimate(); });
  new MutationObserver(() => { if (!card.hidden) { sportText(); estimate(); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  $("[data-x]").addEventListener("click", () => open(false));

  function suggestName() {
    const box = areaBox(), c = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const z = (window.tfZones || []).find((z) => c[0] >= z.box[0] && c[0] <= z.box[2] && c[1] >= z.box[1] && c[1] <= z.box[3]);
    return z ? z.name : `Area near ${c[0].toFixed(3)}, ${c[1].toFixed(3)}`;
  }

  const sizeOf = new Map(); // data file URL -> bytes, from a HEAD request
  const headSize = (u) => {
    if (!sizeOf.has(u)) sizeOf.set(u, fetch(u, { method: "HEAD" }).then((r) => (r.ok ? +r.headers.get("content-length") || 0 : 0)).catch(() => 0));
    return sizeOf.get(u);
  };
  let estToken = 0;
  async function estimate() {
    if (card.hidden || busy) return;
    const box = areaBox(), tiles = countTiles(tileRanges(box, 0, MAX_Z)), my = ++estToken;
    const save = $("[data-save]"), est = $("[data-est]");
    if (tiles > MAX_TILES) {
      save.disabled = true;
      est.textContent = drawn ? `That square is too big: it needs ${tiles.toLocaleString()} map tiles, and the limit is ${MAX_TILES.toLocaleString()} (about one big valley). Draw a smaller one.` : `This view is too big for one save (${tiles.toLocaleString()} map tiles, the limit is ${MAX_TILES.toLocaleString()}, about one big valley). Tap ▭ Pick a square: it starts at the biggest size allowed.`;
      return;
    }
    save.disabled = !navigator.onLine;
    const zones = zonesIn(box);
    est.textContent = `${tiles.toLocaleString()} map tiles${zones.length ? " plus trails and roads for " + zones.map((z) => z.name).join(", ") : ""}…`;
    const sport = sportNow(), x = await extras(box, sport, $("[data-3d]").checked);
    const data = (await Promise.all([...dataUrls(box), ...x.data].map(headSize))).reduce((a, b) => a + b, 0);
    if (my !== estToken) return;
    const more = x.tiles.reduce((n, u) => n + tileKB(u), 0) * 1e3, d = x.d3;
    const kind = { ski: " Skiing: ski routes, the avalanche forecast, snow stations and the terrain for slope angles.",
      hunt: ` Hunting: zones, seasons and draws${x.hunt && x.hunt.label.length ? ` and ${x.hunt.label.join(", ")}` : " (turn on a hunting layer to save it too)"}.`,
      fish: " Fishing: the waters, fish, rules, stocking, launches and hidden spots, and the terrain for Route to a spot.",
      moto: " Moto: gas, camping, hot springs and ferries." }[sport] || "";
    est.textContent = `About ${mb(tiles * TILE_KB * 1e3 + data + more)}: ${tiles.toLocaleString()} map tiles` +
      (zones.length ? ` plus ${sport === "mtb" ? "trails and forest roads" : "trails, roads and tracks"} for ${zones.map((z) => z.name).join(", ")}.` : ". This area is outside the trail data region, so only the map is saved.") + kind +
      (d ? ` 3D: ${d.heights.toLocaleString()} terrain tiles${d.photos ? ` and ${d.photos.toLocaleString()} winter photos` : ""} (about ${mb(d.tiles.reduce((n, u) => n + tileKB(u), 0) * 1e3)}).` : "") +
      (navigator.onLine ? "" : " You're offline: connect to save it.");
  }
  map.on("moveend", () => { if (!card.hidden && !busy) { estimate(); if (!$("[data-name]").dataset.typed) $("[data-name]").value = suggestName(); } });
  $("[data-name]").addEventListener("input", (e) => { e.target.dataset.typed = "1"; });

  async function renderList() {
    const areas = load();
    drawOutlines();
    $("[data-saved-h]").hidden = !areas.length;
    $("[data-list]").innerHTML = areas.map((a) => `<li><div><b>${ICON[sportOf(a)]} ${esc(a.name)}</b><span class="muted">${a.d3 ? "3D · " : ""}${mb(a.bytes)} · ${new Date(a.at).toLocaleDateString()}</span>${a.missing ? `<span class="warn">⚠ Not finished: ${files(a.missing)} missing${a.missingUrls ? ` (${whatsMissing(a.missingUrls)})` : ""}</span>` : `<span class="ok">✓ Works with no signal</span>`}</div>
${a.missing ? `<button type="button" data-finish="${a.id}">Try again</button>` : ""}<button type="button" data-show="${a.id}">Show</button><button type="button" class="del" data-del="${a.id}">Delete</button></li>`).join("");
    const use = $("[data-use]");
    use.textContent = "";
    if (navigator.storage && navigator.storage.estimate) {
      const s = await navigator.storage.estimate().catch(() => null);
      if (s && s.quota) use.textContent = `This site is using ${mb(s.usage)} of the ${mb(s.quota)} your browser allows it.`;
    }
  }
  $("[data-list]").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const areas = load(), a = areas.find((x) => x.id === (b.dataset.show || b.dataset.del || b.dataset.finish));
    if (!a) return;
    if (b.dataset.show) map.fitBounds([[a.box[0], a.box[1]], [a.box[2], a.box[3]]]);
    else if (b.dataset.finish) { map.fitBounds([[a.box[0], a.box[1]], [a.box[2], a.box[3]]]); saveArea(a.box, a.name, a.id, a.boxes); }
    else if (!busy && confirm(`Delete the saved map of ${a.name}?`)) { b.disabled = true; await remove(a, areas); renderList(); estimate(); }
  });

  // ---------- saving ----------
  // The style's own URLs: its tile sources (via their TileJSON), sprites and the fonts for labels.
  async function styleParts(cache) {
    const style = await getJson(cache, STYLE);
    const sources = [], extra = [];
    for (const s of Object.values(style.sources || {})) {
      if (s.type !== "vector" && s.type !== "raster") continue;
      let tj = s;
      if (s.url) tj = await getJson(cache, s.url);
      const tmpl = tj.tiles && tj.tiles[0];
      if (tmpl) sources.push({ tmpl, minz: tj.minzoom || 0, maxz: Math.min(tj.maxzoom == null ? MAX_Z : tj.maxzoom, MAX_Z) });
    }
    const sprites = typeof style.sprite === "string" ? [style.sprite] : (style.sprite || []).map((s) => s.url);
    sprites.forEach((s) => ["", "@2x"].forEach((r) => extra.push(`${s}${r}.json`, `${s}${r}.png`)));
    const stacks = new Set();
    (style.layers || []).forEach((l) => { const f = l.layout && l.layout["text-font"]; if (Array.isArray(f) && f.every((x) => typeof x === "string")) stacks.add(f.join(",")); });
    if (style.glyphs) stacks.forEach((f) => GLYPH_RANGES.forEach((r) => extra.push(new URL(style.glyphs.replace("{fontstack}", f).replace("{range}", r)).href)));
    return { sources, extra };
  }
  async function getJson(cache, url) {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    await cache.put(url, res.clone());
    return res.json();
  }
  // Fetch and keep a list of URLs, a few at a time, skipping ones already saved. Returns the bytes saved and the
  // URLs that still failed after 3 quick tries.
  async function fetchAll(cache, urls, onDone, optional) {
    let i = 0, bytes = 0;
    const failed = [];
    async function worker() {
      while (i < urls.length && !busy.stop) {
        const u = urls[i++];
        let res = await cache.match(u), gone = false;
        if (!res) {
          for (let tries = 0; tries < 3 && !res; tries++) {
            try {
              const r = await fetch(u);
              if (r.ok) { await cache.put(u, r.clone()); res = r; continue; }
              if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) { gone = true; break; }   // not there: asking again won't help
            }
            catch {}
            await wait(800 * (tries + 1));   // dropped connection or a busy server (429, 5xx): give it a moment
          }
        }
        // A file that doesn't exist (404: no winter photo, no fine heights or no map tile there) has nothing to save, so
        // it never counts as missing; before 2026-10-30 only the 3D ones were let off, and an area could stay
        // "Not finished" for good over a file no server has.
        if (res) bytes += (await res.blob()).size; else if (!optional && !gone) failed.push(u);
        if (onDone) onDone();
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    return { bytes, failed };
  }
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  // Files that failed get a few more rounds, slower each time, before the save gives up on them.
  const RETRY_WAIT = [3000, 10000, 30000];
  async function retryFailed(cache, failed, onWait) {
    let bytes = 0;
    for (let r = 0; r < RETRY_WAIT.length && failed.length && !busy.stop; r++) {
      onWait(failed.length, RETRY_WAIT[r], r);
      await wait(RETRY_WAIT[r]);
      if (busy.stop) break;
      const got = await fetchAll(cache, failed);
      bytes += got.bytes; failed = got.failed;
    }
    return { bytes, failed };
  }

  $("[data-save]").addEventListener("click", () => saveArea(areaBox(), $("[data-name]").value.trim() || suggestName()));

  // ---------- the square to save ----------
  // alex 2026-10-30: "hard to draw a square". No more dragging one out with the map frozen (which didn't work at all
  // on the 3D map): the same square as Find's (index.html's .box-frame) shows up at once in the middle of the map, with
  // big round corners to drag. One finger anywhere else still moves and zooms the map under it, 2D or 3D, the bar
  // says how big the square is as it changes, and ✓ Save this square starts saving it.
  const frame = document.createElement("div");
  frame.className = "box-frame off-frame"; frame.hidden = true;
  frame.innerHTML = `<div class="box-sq">${["nw", "ne", "sw", "se"].map((c) => `<button type="button" class="box-h" data-c="${c}" aria-label="Drag this corner to change the square"><i></i></button>`).join("")}</div>
    <div class="box-bar" role="group" aria-label="Square to save"><span class="box-tip" data-sq-tip>Move the map, or drag a corner</span><button type="button" class="btn" data-sq-x>Cancel</button><button type="button" class="btn primary" data-sq-go>✓ Save this square</button></div>`;
  document.querySelector(".mapwrap").append(frame);
  L.DomEvent.disableClickPropagation(frame.querySelector(".box-bar"));
  const sq = frame.querySelector(".box-sq"), sqPos = { l: 0, t: 0, r: 0, b: 0 }, sqTip = frame.querySelector("[data-sq-tip]"), sqGo = frame.querySelector("[data-sq-go]");
  const styleSq = () => Object.assign(sq.style, { left: sqPos.l + "px", top: sqPos.t + "px", width: sqPos.r - sqPos.l + "px", height: sqPos.b - sqPos.t + "px" });
  const placeSq = () => { styleSq(); sqSize(); };
  // The square never gets bigger than one save can hold (alex 2026-10-31: "make so the square can't be bigger"):
  // dragging a corner out stops at the limit, and zooming the map out shrinks the square on screen so it keeps
  // covering no more ground than allowed. anchor: the point that stays put ([x, y] on screen).
  const SQ_MIN = 70;
  let atMax = false;
  const sqTiles = () => countTiles(tileRanges(sqBox(), 0, MAX_Z));
  function fitSq(anchor) {
    atMax = false;
    for (let i = 0; i < 8; i++) {
      const n = sqTiles();
      if (n <= MAX_TILES) break;
      atMax = true;
      const w = sqPos.r - sqPos.l, h = sqPos.b - sqPos.t;
      if (w <= SQ_MIN + 1 && h <= SQ_MIN + 1) break;   // as small as it goes: zoom in to save
      const f = Math.max(Math.sqrt(MAX_TILES / n) * 0.985, SQ_MIN / Math.max(w, h)), [ax, ay] = anchor;
      sqPos.l = ax - (ax - sqPos.l) * f; sqPos.r = ax + (sqPos.r - ax) * f;
      sqPos.t = ay - (ay - sqPos.t) * f; sqPos.b = ay + (sqPos.b - ay) * f;
    }
    styleSq();
  }
  const sqMid = () => [(sqPos.l + sqPos.r) / 2, (sqPos.t + sqPos.b) / 2];
  const phone = () => matchMedia("(max-width: 760px)").matches;
  // The free part of the map: below the buttons at the top, above the bar (and on phones, the sheet).
  function freeArea() {
    const wrap = frame.getBoundingClientRect();
    const tools = Math.max(0, ...[".map-tools", ".leaflet-top.leaflet-left", ".leaflet-top.leaflet-right"].map((q) => document.querySelector(q)).filter((el) => el && el.offsetHeight).map((el) => el.getBoundingClientRect().bottom));
    const bar = frame.querySelector(".box-bar").getBoundingClientRect();
    const top = phone() ? Math.max(24, tools - wrap.top + 12) : 24;
    const bottom = (bar.height ? bar.top : wrap.bottom - 90) - wrap.top - 16;
    return { w: wrap.width, top, bottom: Math.max(top + 120, bottom) };
  }
  let sqShrunk = false;   // made smaller by zooming out: it grows back (to its first size at most) when zooming in
  const sqSide = () => { const a = freeArea(); return Math.min(a.w - 64, a.bottom - a.top - 24, 460); };
  function startSq() {
    const a = freeArea(), side = sqSide();
    const cx = a.w / 2, cy = (a.top + a.bottom) / 2;
    Object.assign(sqPos, { l: cx - side / 2, r: cx + side / 2, t: cy - side / 2, b: cy + side / 2 });
    fitSq([cx, cy]);
    sqShrunk = atMax;
    sqSize();
  }
  const gl3d = () => (map.getContainer().classList.contains("is3d") && window.trailMap3d) || null;
  // The square on the ground: its corners and the middle of each side, from the 3D map when it's on (a tilted view
  // makes the square a wider box on the ground), else the flat map.
  function sqBox() {
    const wrap = frame.getBoundingClientRect(), { l, t, r, b } = sqPos, mx = (l + r) / 2, my = (t + b) / 2;
    const pts = [[l, t], [r, t], [l, b], [r, b], [mx, t], [mx, b], [l, my], [r, my]], gl = gl3d();
    const el = gl ? gl.getContainer() : map.getContainer(), m = el.getBoundingClientRect(), ox = wrap.left - m.left, oy = wrap.top - m.top;
    const lls = pts.map(([x, y]) => (gl ? gl.unproject([x + ox, y + oy]) : map.containerPointToLatLng([x + ox, y + oy])));
    const lat = lls.map((p) => p.lat), lon = lls.map((p) => p.lng);
    return [Math.min(...lat), Math.min(...lon), Math.max(...lat), Math.max(...lon)].map((v) => +v.toFixed(5));
  }
  let sizeQueued = false;
  function sqSize() {
    if (sizeQueued || frame.hidden) return;
    sizeQueued = true;
    requestAnimationFrame(() => {
      sizeQueued = false;
      if (!cornerDrag) {   // zoomed out: the square shrinks to stay within the limit; zoomed back in, it grows again
        const [cx, cy] = sqMid(), w0 = sqPos.r - sqPos.l, h0 = sqPos.b - sqPos.t;
        if (sqShrunk) { const side = sqSide(), f = Math.max(1, side / Math.max(w0, h0)); Object.assign(sqPos, { l: cx - (w0 * f) / 2, r: cx + (w0 * f) / 2, t: cy - (h0 * f) / 2, b: cy + (h0 * f) / 2 }); }
        fitSq([cx, cy]);
        sqShrunk = atMax || (sqShrunk && Math.max(sqPos.r - sqPos.l, sqPos.b - sqPos.t) < sqSide() - 1);
      }
      const tiles = sqTiles(), big = tiles > MAX_TILES;
      sqTip.classList.toggle("too-big", big);
      sqTip.textContent = big ? "Zoom in to save: from this far out, even the smallest square is too much"
        : atMax ? `Biggest square allowed (${mb(tiles * TILE_KB * 1e3).replace(/^(\d)/, "about $1")} of map)`
        : `${mb(tiles * TILE_KB * 1e3).replace(/^u/, "U").replace(/^(\d)/, "About $1")} of map. Move the map, or drag a corner`;
      sqGo.disabled = big || !navigator.onLine;
    });
  }
  function sqMode(on) {
    if (frame.hidden === !on) return;
    frame.hidden = !on;
    document.body.classList.toggle("box-on", on);
    if (!busy) card.hidden = on;   // out of the way while picking, back when done
    const gl = window.trailMap3d;
    if (on) { map.on("move", sqSize); if (gl) gl.on("move", sqSize); requestAnimationFrame(() => requestAnimationFrame(startSq)); }
    else { map.off("move", sqSize); if (gl) gl.off("move", sqSize); }
  }
  // Corners: one finger drags the corner; the map doesn't move meanwhile.
  let cornerDrag = null;
  frame.querySelectorAll(".box-h").forEach((h) => {
    h.addEventListener("pointerdown", (e) => {
      e.preventDefault(); e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      cornerDrag = { c: h.dataset.c, x0: e.clientX, y0: e.clientY, p0: { ...sqPos } };
      sq.classList.add("moving");
    });
    h.addEventListener("pointermove", (e) => {
      if (!cornerDrag) return;
      const a = freeArea(), dx = e.clientX - cornerDrag.x0, dy = e.clientY - cornerDrag.y0, p = cornerDrag.p0, MIN = 70;
      const minTop = Math.min(a.top, p.t) - 40;
      if (cornerDrag.c[1] === "w") sqPos.l = Math.max(4, Math.min(p.r - MIN, p.l + dx)); else sqPos.r = Math.min(a.w - 4, Math.max(p.l + MIN, p.r + dx));
      if (cornerDrag.c[0] === "n") sqPos.t = Math.max(minTop, Math.min(p.b - MIN, p.t + dy)); else sqPos.b = Math.min(Math.max(a.bottom - 4, p.b), Math.max(p.t + MIN, p.b + dy));
      // the opposite corner stays put while the dragged one stops at the limit
      fitSq([cornerDrag.c[1] === "w" ? sqPos.r : sqPos.l, cornerDrag.c[0] === "n" ? sqPos.b : sqPos.t]);
      sqShrunk = false;
      sqSize();
    });
    const end = () => { cornerDrag = null; sq.classList.remove("moving"); };
    h.addEventListener("pointerup", end); h.addEventListener("pointercancel", end);
    h.addEventListener("click", (e) => e.stopPropagation());
  });
  frame.querySelector("[data-sq-x]").addEventListener("click", () => sqMode(false));
  sqGo.addEventListener("click", () => {
    const b = sqBox();
    sqMode(false);
    setDrawn(b);
    saveArea(b, $("[data-name]").value.trim() || suggestName());
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !frame.hidden) sqMode(false); });
  window.addEventListener("resize", () => { if (!frame.hidden) startSq(); });
  function setDrawn(b) {
    drawn = b;
    drawnLayer.clearLayers();
    if (b) L.rectangle([[b[0], b[1]], [b[2], b[3]]], { color: "#1f6f4a", weight: 2, fillOpacity: 0.08, interactive: false }).addTo(drawnLayer);
    $("[data-drawn]").hidden = !b;
    $("[data-save]").textContent = b ? "Save this square" : "Save this area";
    const nm = $("[data-name]");
    if (!nm.dataset.typed) nm.value = suggestName();
    estimate();
  }
  $("[data-draw]").addEventListener("click", () => sqMode(true));
  $("[data-undraw]").addEventListener("click", () => setDrawn(null));

  // ---------- how the save is going ----------
  // alex 2026-10-30: "hard to tell when it saved or not". One box under the buttons says it in big words: Saving
  // with a progress bar, then a green "Saved: works with no signal" or an orange "Not saved yet" with Try again.
  // Files that still don't come are tried again on their own: when the signal comes back, each time Offline maps
  // opens, and once more a couple of minutes after a save that missed some.
  const files = (n) => `${n.toLocaleString()} file${n === 1 ? "" : "s"}`;
  const KINDS = [[/mapterhorn|elevation-tiles/, "3D heights"], [/trail-finder-winter/, "winter photos"], [/openfreemap\.org\/(?!styles|fonts|sprites)/, "map tiles"],
    [/\/data\//, "trail data"], [/unpkg\.com|openfreemap/, "map style"]];
  const whatsMissing = (urls) => [...new Set(urls.map((u) => (KINDS.find(([re]) => re.test(u)) || [0, "other files"])[1]))].join(", ");
  function showState(kind, head, text, pct, acts) {
    const st = $("[data-state]");
    st.hidden = false;
    st.className = "off-state" + (kind ? " " + kind : "");
    $("[data-st-head]").textContent = head;
    $("[data-prog]").textContent = text;
    if (pct != null) st.querySelector(".bar i").style.width = pct + "%";
    $("[data-st-acts]").innerHTML = acts || "";
  }
  $("[data-st-acts]").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.stop != null) { if (busy) busy.stop = true; b.disabled = true; b.textContent = "Stopping…"; }
    else if (b.dataset.retry) { const a = load().find((x) => x.id === b.dataset.retry); if (a) saveArea(a.box, a.name, a.id, a.boxes); }
  });
  // Where each save stands, for other scripts (cabin-trip.js: "Save the trip offline"): "saving", "saved" or "missing".
  let savingName = null;
  const statusOf = (name) => {
    if (busy && savingName === name) return { state: "saving", pct: busy.pct || 0 };
    const a = load().find((x) => x.name === name);
    return a ? { state: a.missing ? "missing" : "saved", missing: a.missing || 0, at: a.at } : null;
  };
  const tell = (name) => window.dispatchEvent(new CustomEvent("tf:offline", { detail: { name, ...statusOf(name) } }));
  // Finish areas that are missing files, one at a time, with no tap. Each area gets a few of these per visit, so a
  // file no server will ever send doesn't make the app ask for it all day.
  const autoTries = new Map();
  async function autoFinish() {
    if (busy || !navigator.onLine) return;
    const a = load().find((x) => (x.missing || needsRing(x)) && (autoTries.get(x.id) || 0) < 3);
    if (!a) return;
    autoTries.set(a.id, (autoTries.get(a.id) || 0) + 1);
    await saveArea(a.box, a.name, a.id, a.boxes, true);
  }
  // Skiing 3D areas saved before 2026-10-31 lack the blurry winter photos around them (map3d.js tf3dOffline): fetched
  // once quietly with signal, like a missing file (only what isn't saved yet is downloaded).
  const needsRing = (x) => x.d3 && sportOf(x) === "ski" && !x.ring;
  let autoTimer = 0;
  const autoLater = (ms) => { clearTimeout(autoTimer); autoTimer = setTimeout(autoFinish, ms); };
  window.addEventListener("online", () => autoLater(3000));
  if (load().some((a) => a.missing || needsRing(a))) autoLater(20000);   // left unfinished last time: try again once the page has settled

  // Save (or finish saving) an area. Anything downloaded goes in the list, even when the save is stopped or some
  // files never come, so it can always be finished or deleted from there. auto: a try no one tapped (autoFinish).
  async function saveArea(box, name, id, boxes, auto) {
    if (busy) return;
    busy = { stop: false, pct: 0 };
    savingName = name;
    $("[data-save]").disabled = true;
    const stop = `<button class="btn" type="button" data-stop>Stop</button>`;
    showState("", `Saving ${name}…`, "Getting the map style…", 0, stop);
    tell(name);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    let sources = null, bytes = 0, failed = [];
    const old0 = id && load().find((x) => x.id === id), sport = old0 ? sportOf(old0) : sportNow(), d3 = old0 ? !!old0.d3 : $("[data-3d]").checked;
    const ext = await extras(box, sport, d3, old0 ? old0.huntLayers : undefined), huntLayers = ext.hunt ? ext.hunt.layers : undefined;
    const record = () => {
      if (!sources) return;
      const areas = load(), old = areas.find((x) => x.id === id);
      const entry = { id: id || Date.now().toString(36), name, box, sources, bytes, at: Date.now(), sport, ski: sport === "ski", d3, ring: 1, ...(huntLayers ? { huntLayers } : {}), ...(boxes ? { boxes } : {}) };
      if (old) { delete old.missing; delete old.missingUrls; }
      if (failed.length || busy.stop) { entry.missing = Math.max(1, failed.length + busy.left); if (failed.length) entry.missingUrls = failed.slice(0, 20); }
      if (old) Object.assign(old, entry); else areas.push(entry);
      id = entry.id;
      save(areas);
    };
    let ok = false;
    try {
      const cache = await caches.open(CACHE);
      const parts = await styleParts(cache);
      sources = parts.sources;
      const tiles = sources.flatMap((s) => [...tileUrls(s, box, boxes)]);
      const data = [...dataUrls(box), ...ext.data];
      const total = tiles.length + data.length + parts.extra.length + LIBS.length + ext.tiles.length;
      let done = 0, shown = 0;
      busy.left = total;
      const tick = () => {
        done++; busy.left = total - done; busy.pct = Math.floor((100 * done) / total);
        if (busy.pct === shown && done < total) return;
        shown = busy.pct;
        showState("", `Saving ${name}… ${busy.pct}%`, `${done.toLocaleString()} of ${total.toLocaleString()} files. Keep the app open until it says Saved.`, busy.pct, stop);
      };
      for (const [urls, optional] of [[[...LIBS, ...parts.extra]], [data, true], [tiles], [ext.tiles]]) {   // a zone may not have every kind of file
        const got = await fetchAll(cache, urls, tick, optional);
        bytes += got.bytes; failed.push(...got.failed);
      }
      if (failed.length && !busy.stop) {
        const got = await retryFailed(cache, failed, (n, ms, r) => showState("", `Almost there: ${files(n)} to go`,
          `${n === 1 ? "It hasn't" : "They haven't"} come yet. Trying again in ${ms / 1000} s (${r + 1} of ${RETRY_WAIT.length})…`, 99, stop));
        bytes += got.bytes; failed = got.failed;
      }
      if (busy.stop) { record(); throw new Error("Stopped"); }
      busy.left = 0;
      record();
      if (failed.length) throw new Error("missing");
      ok = true;
      showState("ok", "✓ Saved: works with no signal", `${name} (${mb(bytes)}) is on this ${phone() ? "phone" : "device"}. Tap Show below to see it on the map.`, 100);
      if (auto && card.hidden && window.tfToast) window.tfToast(`✓ ${name} finished saving: it works with no signal now.`);
    } catch (e) {
      const retry = sources && id ? `<button class="btn primary" type="button" data-retry="${esc(id)}">Try again now</button>` : "";
      if (e.message === "Stopped") showState("bad", "Not saved yet: stopped", `Tap Try again to pick up where it left off, or Delete ${name} below.`, null, retry);
      else if (failed.length) showState("bad", `⚠ Not saved yet: ${files(failed.length)} missing`, `Missing: ${whatsMissing(failed)}. The rest is saved. It tries again by itself when you have signal.`, null, retry);
      else showState("bad", "⚠ Not saved", `${sources ? "The save stopped" : "Couldn't reach the map"} (${e.message}). Try again with signal.`, null, retry);
    }
    busy = null; savingName = null;
    if (drawn) setDrawn(null);   // the square is in the list now (Try again uses its own box)
    tell(name);
    renderList(); estimate();
    if (!ok && navigator.onLine && id && (autoTries.get(id) || 0) < 3) autoLater(120000);
  }

  // Save a given box straight away (alex, from Outmap: "save offline" on a saved route or a riding area, no square to
  // draw). The box gets a margin; too big for one save, the card opens on it and says so.
  window.tfOffline = {
    // { state: "saving" | "saved" | "missing", pct, missing, at } for the area saved under this name, or null.
    // A "tf:offline" event on window ({ detail: { name, state, ... } }) says each time it changes.
    status: statusOf,
    saveBox(box, name) {
      const latM = (box[2] - box[0]) * 0.15 + 0.004, lonM = (box[3] - box[1]) * 0.15 + 0.006;
      const b = [box[0] - latM, box[1] - lonM, box[2] + latM, box[3] + lonM].map((v) => +v.toFixed(5));
      if (card.hidden) open(true);
      map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { animate: false });
      setDrawn(b);
      const nm = $("[data-name]");
      nm.value = name; nm.dataset.typed = "1";
      if (countTiles(tileRanges(b, 0, MAX_Z)) <= MAX_TILES && navigator.onLine) saveArea(b, name);
    },
    // A route and the land either side of it (moto.js: a long ride, where a box around it would be far too big).
    // line: [[lat, lon], ...]. Narrower when the corridor would pass the tile limit. Returns false when it's still too big.
    saveCorridor(line, name) {
      if (!line || line.length < 2) return false;
      let boxes = null;
      for (const km of [5, 3, 1.5]) {
        boxes = [];
        const dy = km / 111, step = km * 0.8;
        let run = Infinity, prev = null;
        for (const p of line) {
          if (prev) run += map.distance(prev, p) / 1000;
          prev = p;
          if (run < step) continue;
          run = 0;
          const dx = km / (111 * Math.cos((p[0] * Math.PI) / 180));
          boxes.push([p[0] - dy, p[1] - dx, p[0] + dy, p[1] + dx].map((v) => +v.toFixed(5)));
        }
        const e = line[line.length - 1], dx = km / (111 * Math.cos((e[0] * Math.PI) / 180));
        boxes.push([e[0] - dy, e[1] - dx, e[0] + dy, e[1] + dx].map((v) => +v.toFixed(5)));
        if (corridorCount(boxes) <= MAX_TILES) break;
        boxes = null;
      }
      if (!boxes) return false;
      const box = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
      if (card.hidden) open(true);
      map.fitBounds([[box[0], box[1]], [box[2], box[3]]], { animate: false });
      const nm = $("[data-name]");
      nm.value = name; nm.dataset.typed = "1";
      if (navigator.onLine) saveArea(box, name, undefined, boxes);
      return true;
    },
  };

  // Delete an area's tiles, except ones another saved area also covers. With no areas left, empty the cache.
  async function remove(a, areas) {
    const rest = areas.filter((x) => x !== a);
    save(rest);
    if (window.tfLoadSport) await window.tfLoadSport("hunt").catch(() => {});
    const hunts = window.tfHuntOfflineUrls ? window.tfHuntOfflineUrls() : [];   // Hunting's own saved layers share the cache
    if (!rest.length && !hunts.length) { await caches.delete(CACHE); return; }
    const keep = new Set([...(await Promise.all(rest.map(urlsOf))).flat(), ...hunts]);
    const cache = await caches.open(CACHE);
    const drop = (await urlsOf(a)).filter((u) => !keep.has(u));
    for (let i = 0; i < drop.length; i += 50) await Promise.all(drop.slice(i, i + 50).map((u) => cache.delete(u)));
  }

  // Every file an area saved, except the sports' data files (small and shared by every area).
  async function urlsOf(x) {
    const k = await extras(x.box, sportOf(x), x.d3, x.huntLayers);
    return [...x.sources.flatMap((s) => [...tileUrls(s, x.box, x.boxes)]), ...dataUrls(x.box), ...k.tiles];
  }
  // hunting.js keeps these when it deletes one of its own saves.
  window.tfOfflineUrls = async () => (await Promise.all(load().map(urlsOf))).flat();

  // ---------- with no connection ----------
  // Open on the saved map style when there's no signal and an area is saved.
  function goOffline() {
    if (!load().length || !window.tfSetBasemap) return;
    const sel = document.getElementById("basemap");
    if (sel && sel.value !== "vector") window.tfSetBasemap("vector", false);
  }
  if (!navigator.onLine) goOffline();
  window.addEventListener("offline", () => { goOffline(); estimate(); });
  window.addEventListener("online", () => estimate());
})();
