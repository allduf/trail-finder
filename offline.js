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
  const DATA = ["trails", "names", "mtb", "roads", "unmapped"];
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
  function* tileUrls(src, box) {
    for (const r of tileRanges(box, src.minz, src.maxz))
      for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) yield src.tmpl.replace("{z}", r.z).replace("{x}", x).replace("{y}", y);
  }
  const zonesIn = (box) => (window.tfZones || []).filter((z) => z.box[0] < box[2] && z.box[2] > box[0] && z.box[1] < box[3] && z.box[3] > box[1]);
  const dataUrls = (box) => [...zonesIn(box).flatMap((z) => DATA.map((d) => `data/${d}-${z.id}.json`)), "data/fires.json"]
    .map((u) => new URL(u, location.href).href);
  const viewBox = () => { const b = map.getBounds().pad(0.1);   // a margin, as the vector map draws a little past the screen
    return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((v) => +v.toFixed(5)); };

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
.offline-card .row { display: flex; gap: 8px; align-items: center; }
.offline-card .bar { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; margin: 8px 0 2px; }
.offline-card .bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s; }
.offline-card ul { list-style: none; margin: 8px 0 0; padding: 0; border-top: 1px solid var(--line); }
.offline-card li { display: flex; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line); }
.offline-card li div { flex: 1; min-width: 0; }
.offline-card li b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.offline-card li button { font: inherit; font-size: .8rem; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
.map-tools #offlineBtn.on { background: var(--accent); border-color: var(--accent); color: #fff; }`;
  document.head.append(css);
  const card = document.createElement("div");
  card.className = "offline-card";
  card.hidden = true;
  card.innerHTML = `<h2>Offline maps <button type="button" data-x aria-label="Close">✕</button></h2>
<p class="muted">Save the area on screen to use the map, trails and forest roads with no signal. Saved maps use the Sharp outdoor style, which the map switches to when you're offline.</p>
<div data-new><input data-name maxlength="60" aria-label="Name for this area"><p data-est></p>
<div class="row"><button class="btn primary" type="button" data-save>Save this area</button><button class="btn" type="button" data-stop hidden>Stop</button></div>
<div class="bar" hidden><i></i></div><p class="muted" data-prog></p></div>
<ul data-list></ul><p class="muted" data-use></p>`;
  document.querySelector(".mapwrap").append(card);
  L.DomEvent.disableClickPropagation(card);
  L.DomEvent.disableScrollPropagation(card);
  const $ = (s) => card.querySelector(s);
  const outlines = L.layerGroup();

  let busy = null; // { stop: bool } while saving
  function open(on) {
    card.hidden = !on;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on);
    if (on) { outlines.addTo(map); $("[data-name]").value = suggestName(); renderList(); estimate(); }
    else outlines.remove();
  }
  btn.addEventListener("click", () => open(card.hidden));
  $("[data-x]").addEventListener("click", () => open(false));

  function suggestName() {
    const box = viewBox(), c = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
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
    const box = viewBox(), tiles = countTiles(tileRanges(box, 0, MAX_Z)), my = ++estToken;
    const save = $("[data-save]"), est = $("[data-est]");
    if (tiles > MAX_TILES) {
      save.disabled = true;
      est.textContent = `Zoom in to save: this view needs ${tiles.toLocaleString()} map tiles, and the limit is ${MAX_TILES.toLocaleString()} (about one big valley).`;
      return;
    }
    save.disabled = !navigator.onLine;
    const zones = zonesIn(box);
    est.textContent = `${tiles.toLocaleString()} map tiles${zones.length ? " plus trails and roads for " + zones.map((z) => z.name).join(", ") : ""}…`;
    const data = (await Promise.all(dataUrls(box).map(headSize))).reduce((a, b) => a + b, 0);
    if (my !== estToken) return;
    est.textContent = `About ${mb(tiles * TILE_KB * 1e3 + data)}: ${tiles.toLocaleString()} map tiles` +
      (zones.length ? ` plus trails and forest roads for ${zones.map((z) => z.name).join(", ")}.` : ". This area is outside the trail data region, so only the map is saved.") +
      (navigator.onLine ? "" : " You're offline: connect to save it.");
  }
  map.on("moveend", () => { if (!card.hidden && !busy) { estimate(); if (!$("[data-name]").dataset.typed) $("[data-name]").value = suggestName(); } });
  $("[data-name]").addEventListener("input", (e) => { e.target.dataset.typed = "1"; });

  async function renderList() {
    const areas = load();
    outlines.clearLayers();
    areas.forEach((a) => L.rectangle([[a.box[0], a.box[1]], [a.box[2], a.box[3]]], { color: "#1f6f4a", weight: 2, dashArray: "6 5", fill: false, interactive: false }).addTo(outlines));
    $("[data-list]").innerHTML = areas.map((a) => `<li><div><b>${esc(a.name)}</b><span class="muted">${mb(a.bytes)} · saved ${new Date(a.at).toLocaleDateString()}</span></div>
<button type="button" data-show="${a.id}">Show</button><button type="button" data-del="${a.id}">Delete</button></li>`).join("");
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
    const areas = load(), a = areas.find((x) => x.id === (b.dataset.show || b.dataset.del));
    if (!a) return;
    if (b.dataset.show) map.fitBounds([[a.box[0], a.box[1]], [a.box[2], a.box[3]]]);
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
  // Fetch and keep a list of URLs, a few at a time, skipping ones already saved. Returns the bytes saved.
  async function fetchAll(cache, urls, onDone, optional) {
    let i = 0, bytes = 0, failed = 0;
    async function worker() {
      while (i < urls.length && !busy.stop) {
        const u = urls[i++];
        let res = await cache.match(u);
        if (!res) {
          for (let tries = 0; tries < 3 && !res; tries++) {
            try { const r = await fetch(u); if (r.ok) { await cache.put(u, r.clone()); res = r; } else if (r.status === 404) break; }
            catch { await new Promise((ok) => setTimeout(ok, 800 * (tries + 1))); }
          }
        }
        if (res) bytes += (await res.blob()).size; else if (!optional) failed++;
        onDone();
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    if (failed) throw new Error(`${failed} files didn't download`);
    return bytes;
  }

  $("[data-save]").addEventListener("click", async () => {
    if (busy) return;
    const box = viewBox(), name = $("[data-name]").value.trim() || suggestName();
    const bar = card.querySelector(".bar"), prog = $("[data-prog]");
    busy = { stop: false };
    $("[data-save]").disabled = true; $("[data-stop]").hidden = false; bar.hidden = false;
    prog.textContent = "Getting the map style…";
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    try {
      const cache = await caches.open(CACHE);
      const { sources, extra } = await styleParts(cache);
      const tiles = sources.flatMap((s) => [...tileUrls(s, box)]);
      const data = dataUrls(box);
      const total = tiles.length + data.length + extra.length + LIBS.length;
      let done = 0;
      const tick = () => { done++; bar.firstChild.style.width = (100 * done) / total + "%"; prog.textContent = `${done.toLocaleString()} of ${total.toLocaleString()} files`; };
      let bytes = await fetchAll(cache, [...LIBS, ...extra], tick);
      bytes += await fetchAll(cache, data, tick, true);   // a zone may not have every kind of file
      bytes += await fetchAll(cache, tiles, tick);
      if (busy.stop) throw new Error("Stopped");
      const areas = load();
      areas.push({ id: Date.now().toString(36), name, box, sources, bytes, at: Date.now() });
      save(areas);
      prog.textContent = `Saved ${name} (${mb(bytes)}). It works with no signal now.`;
    } catch (e) {
      prog.textContent = e.message === "Stopped" ? "Stopped. Saving again picks up where it left off." : `Couldn't save the whole area (${e.message}). Try again with signal: what's saved so far is kept.`;
    }
    busy = null;
    $("[data-stop]").hidden = true; bar.hidden = true; bar.firstChild.style.width = "0";
    renderList(); estimate();
  });
  $("[data-stop]").addEventListener("click", () => { if (busy) busy.stop = true; });

  // Delete an area's tiles, except ones another saved area also covers. With no areas left, empty the cache.
  async function remove(a, areas) {
    const rest = areas.filter((x) => x !== a);
    save(rest);
    if (!rest.length) { await caches.delete(CACHE); return; }
    const keep = new Set(rest.flatMap((x) => [...x.sources.flatMap((s) => [...tileUrls(s, x.box)]), ...dataUrls(x.box)]));
    const cache = await caches.open(CACHE);
    const drop = [...a.sources.flatMap((s) => [...tileUrls(s, a.box)]), ...dataUrls(a.box)].filter((u) => !keep.has(u));
    for (let i = 0; i < drop.length; i += 50) await Promise.all(drop.slice(i, i + 50).map((u) => cache.delete(u)));
  }

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
