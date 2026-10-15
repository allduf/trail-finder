// Photo time slider for the trail finder: "Old vs new photos" in Layers shows two dated satellite photos of the
// same spot, split by a handle you drag across the map. The older photo is on the left, the newer one on the
// right, so a freshly cut trail shows up as a line that appears when the handle passes over it.
// The photos are Esri World Imagery Wayback, free and keyless: every release of Esri's photo map since 2014 is
// kept. Most releases change nothing in a given spot, so only the releases where the photo here really changed
// are listed, each with the date the photo was taken (from Esri's photo metadata).
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const CONFIG = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";
  const TILEMAP = "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap";
  const ATTR = 'Photos: <a href="https://livingatlas.arcgis.com/wayback/">Esri World Imagery Wayback</a>, Maxar, Earthstar Geographics, Eagleview';
  const $ = (id) => document.getElementById(id);

  const css = document.createElement("style");
  css.textContent = `
.map-tools #photoBtn.on { background: var(--fg); border-color: var(--fg); color: var(--panel); }
.mapwrap.is3d #photoBtn { display: none; }
.ps-bar { position: absolute; z-index: 600; left: 50%; bottom: 28px; transform: translateX(-50%); display: grid; grid-template-columns: auto auto auto; align-items: end; gap: 6px 10px;
  max-width: calc(100% - 24px); box-sizing: border-box; padding: 8px 10px; border-radius: 12px; background: var(--panel); color: var(--fg); border: 1px solid var(--line); box-shadow: 0 2px 10px rgba(0,0,0,.25); font-size: .85rem; }
.ps-bar[hidden], .ps-handle[hidden], .ps-tag[hidden] { display: none; }
.ps-bar label { display: flex; flex-direction: column; gap: 2px; font-size: .72rem; font-weight: 700; color: var(--muted); min-width: 0; }
.ps-bar select { font: inherit; font-size: 16px; padding: 4px 6px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); min-width: 0; }
.ps-bar .ps-note { grid-column: 1 / -1; text-align: center; color: var(--muted); font-size: .78rem; }
.ps-bar .ps-note:empty { display: none; }
.ps-bar .ps-x { font: inherit; font-weight: 700; padding: 6px 11px; border-radius: 8px; border: 1px solid var(--line); background: var(--chip, transparent); color: var(--fg); cursor: pointer; }
.ps-handle { position: absolute; z-index: 590; top: 0; bottom: 0; width: 44px; margin-left: -22px; cursor: ew-resize; touch-action: none; }
.ps-handle::before { content: ""; position: absolute; left: 21px; top: 0; bottom: 0; width: 3px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.45); }
.ps-handle span { position: absolute; left: 4px; top: 50%; width: 36px; height: 36px; margin-top: -18px; border-radius: 50%; background: #fff; color: #222; display: grid; place-items: center;
  font-size: 15px; font-weight: 700; box-shadow: 0 1px 6px rgba(0,0,0,.5); }
.ps-handle:focus-visible span { outline: 3px solid #2b7de9; }
.ps-tag { position: absolute; z-index: 590; top: calc(50% - 52px); padding: 3px 8px; border-radius: 6px; background: rgba(0,0,0,.65); color: #fff; font-size: .78rem; font-weight: 700; pointer-events: none; white-space: nowrap; }
.mapwrap.ps-on .first-tip { display: none; }
.mapwrap.is3d .ps-bar, .mapwrap.is3d .ps-handle, .mapwrap.is3d .ps-tag { display: none; }
@media (max-width: 760px) { .ps-bar { left: 12px; right: 12px; transform: none; max-width: none; grid-template-columns: 1fr 1fr auto; bottom: calc(var(--sheet-vis, 0px) + 44px); } }
`;
  document.head.append(css);

  // ---------- controls ----------
  const btn = document.createElement("button");
  btn.id = "photoBtn"; btn.type = "button"; btn.setAttribute("aria-pressed", "false");
  btn.title = "Drag between an older and a newer satellite photo of this spot to spot freshly cut trails";
  btn.textContent = "⇆ Old vs new photos";
  const tools = $("offlineBtn")?.parentElement;
  if (!tools) return;
  tools.prepend(btn);

  const wrap = map.getContainer().parentElement;
  const bar = document.createElement("div");
  bar.className = "ps-bar"; bar.hidden = true; bar.setAttribute("role", "group"); bar.setAttribute("aria-label", "Old vs new photos");
  bar.innerHTML = `<label>Old photo <select id="psOld"></select></label>
<label>New photo <select id="psNew"></select></label>
<button class="ps-x" id="psClose" type="button" aria-label="Close old vs new photos">✕</button>
<div class="ps-note" id="psNote" aria-live="polite"></div>`;
  const handle = document.createElement("div");
  handle.className = "ps-handle"; handle.hidden = true; handle.tabIndex = 0;
  handle.setAttribute("role", "slider"); handle.setAttribute("aria-label", "Split between old and new photo");
  handle.setAttribute("aria-valuemin", "0"); handle.setAttribute("aria-valuemax", "100");
  handle.innerHTML = "<span aria-hidden=\"true\">⇆</span>";
  const tagOld = document.createElement("div"), tagNew = document.createElement("div");
  tagOld.className = tagNew.className = "ps-tag"; tagOld.hidden = tagNew.hidden = true;
  wrap.append(bar, handle, tagOld, tagNew);

  // ---------- photo layers ----------
  // Both photos sit above the map style and below the trails. The old one is clipped to the left of the handle.
  for (const [name, z] of [["psNew", 250], ["psOld", 260]]) { const p = map.createPane(name); p.style.zIndex = z; p.style.pointerEvents = "none"; }
  let releases = null;           // releaseNum -> { num, title, url, meta, published }
  let shown = [];                // releases where the photo here changed, newest first: { num, date, label }
  let layerOld = null, layerNew = null, on = false, split = 0.5;

  // Each photo stops at its own zoom (7.5 cm aerials go to 22, old satellite photos to 17 or 18) and shows a grey
  // "not available" tile past that, so ask the tile map how deep this photo goes here and enlarge it from there.
  const deepCache = new Map();
  function deepest(num, ll) {
    const k = `${num}/${Object.values(tileAt(ll, 14)).join("/")}`;
    if (!deepCache.has(k)) deepCache.set(k, (async () => {
      for (const z of [22, 21, 20, 19, 18, 17]) {
        const t = tileAt(ll, z);
        try { const j = await (await fetch(`${TILEMAP}/${num}/${z}/${t.y}/${t.x}`)).json(); if (j.data?.[0] === 1) return z; } catch {}
      }
      return 17;
    })());
    return deepCache.get(k);
  }
  function photoLayer(num, pane, deep) {
    // The archive answers the capitalised address with a redirect to the lower-case one: skip that hop.
    const url = releases[num].url.replace("/World_Imagery/WMTS/1.0.0/default028mm/MapServer/", "/world_imagery/wmts/1.0.0/default028mm/mapserver/").replace("{level}", "{z}").replace("{row}", "{y}").replace("{col}", "{x}");
    return L.tileLayer(url, { pane, maxNativeZoom: deep, maxZoom: 22, attribution: ATTR });
  }
  function clip() {
    if (!on) return;
    const size = map.getSize(), x = Math.round(size.x * split);
    const nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(size);
    map.getPane("psOld").style.clip = `rect(${nw.y}px, ${nw.x + x}px, ${se.y}px, ${nw.x}px)`;
    map.getPane("psNew").style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${nw.x + x}px)`;
    const left = map.getContainer().offsetLeft + x;
    handle.style.left = left + "px";
    handle.setAttribute("aria-valuenow", Math.round(split * 100));
    tagOld.style.left = ""; tagOld.style.right = `calc(100% - ${left - 8}px)`;
    tagNew.style.right = ""; tagNew.style.left = left + 8 + "px";
  }
  map.on("move zoom resize viewreset", clip);

  // ---------- which photos exist here ----------
  async function loadReleases() {
    if (releases) return releases;
    const j = await (await fetch(CONFIG)).json();
    releases = {};
    for (const [k, v] of Object.entries(j)) {
      const m = /(\d{4}-\d{2}-\d{2})/.exec(v.itemTitle || "");
      releases[k] = { num: +k, title: v.itemTitle, url: v.itemURL, meta: v.metadataLayerUrl, published: m ? m[1] : "" };
    }
    return releases;
  }
  const newestFirst = () => Object.values(releases).sort((a, b) => b.published.localeCompare(a.published) || b.num - a.num);
  const tileAt = (ll, z) => { const p = map.project(ll, z).divideBy(256).floor(); return { z, x: p.x, y: p.y }; };
  // Walk back through the releases: each tile map answer names the release whose photo this tile really shows
  // ("select"), so the next one to ask about is the release just before that. One request per real photo.
  const walked = new Map();
  function changesAt(ll, z) {
    const k = Object.values(tileAt(ll, z)).join("/");
    if (!walked.has(k)) walked.set(k, walk(ll, z).then((r) => { if (!r.length) walked.delete(k); return r; }));
    return walked.get(k);
  }
  async function walk(ll, z) {
    const t = tileAt(ll, z), list = newestFirst(), out = [];
    let i = 0;
    while (i < list.length && out.length < 30) {
      const r = list[i];
      let j;
      try { j = await (await fetch(`${TILEMAP}/${r.num}/${t.z}/${t.y}/${t.x}`)).json(); } catch { j = null; }
      if (!j || !j.data || j.data[0] !== 1) break;   // no photo this far back
      const pick = releases[j.select?.[0] ?? r.num] || r;
      if (!out.some((o) => o.num === pick.num)) out.push(pick);
      const at = list.indexOf(pick);
      i = Math.max(i, at) + 1;
    }
    return out;
  }
  // The date the photo was taken, from Esri's photo metadata at this spot (layer 0 is the sharpest zoom level).
  async function photoDate(r, ll, z) {
    if (!r.meta) return null;
    const layer = Math.max(0, Math.min(11, 23 - Math.max(12, z)));
    const q = new URLSearchParams({ f: "json", where: "1=1", outFields: "SRC_DATE2,SRC_DATE,NICE_DESC,SRC_RES", returnGeometry: "false",
      geometryType: "esriGeometryPoint", spatialRel: "esriSpatialRelIntersects", inSR: "4326", geometry: `${ll.lng},${ll.lat}` });
    try {
      const j = await (await fetch(`${r.meta}/${layer}/query?${q}`)).json();
      const a = j.features?.[0]?.attributes;
      if (!a) return null;
      const d = a.SRC_DATE2 ? new Date(a.SRC_DATE2) : null;
      return { date: d && !isNaN(d) ? d.toISOString().slice(0, 10) : "", res: a.SRC_RES, desc: a.NICE_DESC };
    } catch { return null; }
  }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const nice = (iso) => (iso ? `${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : "");

  let look = 0, lookedAt = null;
  async function lookHere(force) {
    if (!on) return;
    const ll = map.getCenter(), z = Math.max(15, Math.min(17, Math.round(map.getZoom())));
    const key = Object.values(tileAt(ll, z)).join("/");
    if (!force && key === lookedAt) return;
    lookedAt = key;
    const id = ++look;
    $("psNote").textContent = "Finding the photos taken here…";
    let list;
    try { await loadReleases(); list = await changesAt(ll, z); } catch { list = null; }
    if (id !== look) return;
    if (!list || !list.length) { $("psNote").textContent = "Couldn't reach the photo archive. Check your connection and try again."; lookedAt = null; return; }
    const dates = await Promise.all(list.map((r) => photoDate(r, ll, z)));
    if (id !== look) return;
    const prevOld = shown.find((s) => s.num === +$("psOld").value), prevNew = shown.find((s) => s.num === +$("psNew").value);
    shown = list.map((r, k) => {
      const d = dates[k], when = nice(d?.date) || nice(r.published);
      return { num: r.num, date: d?.date || r.published, label: d?.date ? when : `${when} (archive)`, res: d?.res };
    });
    // Order by when the photo was taken; drop repeats of the same photo date.
    shown.sort((a, b) => b.date.localeCompare(a.date));
    shown = shown.filter((s, k) => k === 0 || s.date.slice(0, 7) !== shown[k - 1].date.slice(0, 7));
    const opts = shown.map((s) => `<option value="${s.num}">${s.label}</option>`).join("");
    $("psOld").innerHTML = opts; $("psNew").innerHTML = opts;
    // Keep what the rider picked if that photo is here too, else newest vs oldest.
    const keep = (p, fallback) => (p && shown.find((s) => s.date === p.date)) || fallback;
    const n = keep(prevNew, shown[0]), o = keep(prevOld, shown[shown.length - 1]);
    $("psNew").value = n.num; $("psOld").value = o.num;
    $("psNote").textContent = shown.length < 2 ? "Only one photo has been taken here so far. Try another spot." : `${shown.length} photos of this spot. Drag the ⇆ handle across the map.`;
    show();
  }
  let showing = 0;
  async function show() {
    if (!on || !shown.length) return;
    const id = ++showing, o = +$("psOld").value, n = +$("psNew").value, ll = map.getCenter();
    const [dn, dO] = await Promise.all([deepest(n, ll), deepest(o, ll)]);
    if (id !== showing || !on) return;
    const swap = (layer, num, deep, pane) => {
      if (layer && layer.num === num && layer.deep === deep) return layer;
      if (layer) map.removeLayer(layer);
      const l = photoLayer(num, pane, deep).addTo(map); l.num = num; l.deep = deep;
      return l;
    };
    layerNew = swap(layerNew, n, dn, "psNew");
    layerOld = swap(layerOld, o, dO, "psOld");
    const lab = (num) => shown.find((s) => s.num === num)?.label || "";
    tagOld.textContent = "◀ " + lab(o); tagNew.textContent = lab(n) + " ▶";
    tagOld.hidden = tagNew.hidden = false;
    clip();
  }
  $("psOld").addEventListener("change", show);
  $("psNew").addEventListener("change", show);
  let moveTimer = 0;
  map.on("moveend", () => { clearTimeout(moveTimer); moveTimer = setTimeout(() => lookHere(false), 400); });

  // ---------- dragging the handle ----------
  function dragTo(clientX) {
    const r = map.getContainer().getBoundingClientRect();
    split = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    clip();
  }
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    map.dragging.disable();
    const move = (ev) => dragTo(ev.clientX);
    const up = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", up); handle.removeEventListener("pointercancel", up); map.dragging.enable(); };
    handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", up); handle.addEventListener("pointercancel", up);
  });
  handle.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowLeft" ? -0.05 : e.key === "ArrowRight" ? 0.05 : e.key === "Home" ? -1 : e.key === "End" ? 1 : 0;
    if (!d) return;
    e.preventDefault(); split = Math.max(0, Math.min(1, split + d)); clip();
  });
  L.DomEvent.disableClickPropagation(bar); L.DomEvent.disableScrollPropagation(bar);

  // ---------- on / off ----------
  function setOn(v) {
    on = v;
    btn.setAttribute("aria-pressed", v); btn.classList.toggle("on", v);
    bar.hidden = handle.hidden = !v;
    wrap.classList.toggle("ps-on", v);
    if (!v) {
      look++; showing++; lookedAt = null;
      if (layerOld) map.removeLayer(layerOld); if (layerNew) map.removeLayer(layerNew);
      layerOld = layerNew = null; tagOld.hidden = tagNew.hidden = true;
      return;
    }
    split = 0.5;
    if (map.getZoom() < 13) map.setZoom(13);   // fresh trails only show up close in
    clip(); lookHere(true);
  }
  btn.addEventListener("click", () => { setOn(!on); $("layersBtn")?.click(); });
  $("psClose").addEventListener("click", () => setOn(false));
  // The 3D view has its own photos: leave the slider when it opens.
  new MutationObserver(() => { if (on && wrap.classList.contains("is3d")) setOn(false); }).observe(wrap, { attributes: true, attributeFilter: ["class"] });
  window.tfPhotoSlider = { setOn, get on() { return on; } };
})();
