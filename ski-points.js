// Saved points in Skiing and Hunting: the skier or hunter drops a pin on the map (a tap, a long press, or their location) and gives it a
// name, a short description and a photo, like "good skin track start" or "wind-loaded bowl, check before dropping".
// Each sport shows only its own pins (points saved before Hunting have no sport and are Skiing's), on the flat map
// and the 3D map; tapping one shows its photo, name and description, with Edit, Delete, Share and Guide me here.
// Hunting points also have a kind (truck, stand, blind, sighting, rub, scrape, trail camera...), shown on the pin,
// and the Hunting panel has "Mark my truck" and "Back to the truck". Guide me here follows your location with a
// line to the point and its distance and direction. Share sends a link that opens the point on another phone, ready
// to save (#pin=lat,lon,sport,kind,name).
// The hunting log (window.tfPoints.openLog, from the Hunting panel's quick actions) lists harvests by season (April to
// March, the licence year) with species, sex, date and zone, as a table that can be saved as CSV, and the trail cameras
// with their checks: each check is a dated photo and a note of what the camera caught, kept on the camera's point.
// Stored in this browser's IndexedDB "trail-finder-points" (one record per point, the photo inside it). Signed in
// (account.js), points are also kept in the Supabase table ski_points with photos in the "point-photos" bucket
// (see supabase/ski-points.sql), so they show up on the skier's other devices, the same way ride.html syncs rides.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L || !document.getElementById("skiPane")) return;
  const sportNow = () => (document.body.classList.contains("sport-ski") ? "ski" : document.body.classList.contains("sport-hunt") ? "hunt" : null);
  const sportOf = (p) => p.sport || "ski";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isSki = () => !!sportNow();   // a sport with saved points (Skiing or Hunting)
  const isHunt = () => sportNow() === "hunt";
  const COLOR = "#0a7d6e", HUNT_COLOR = "#a34f00";
  const KINDS = [["truck", "Truck or parking", "🛻"], ["stand", "Tree stand", "🪜"], ["blind", "Ground blind", "⛺"], ["sighting", "Sighting", "👀"],
    ["sign", "Tracks or droppings", "🐾"], ["rub", "Rub", "🌲"], ["scrape", "Scrape", "🍂"], ["bed", "Bedding area", "🛏"], ["cam", "Trail camera", "📷"],
    ["water", "Water", "💧"], ["food", "Feeding area", "🌾"], ["harvest", "Harvest", "🎯"], ["camp", "Camp", "🏕"], ["other", "Other", "📍"]];
  const kindOf = (p) => KINDS.find((k) => k[0] === p.kind) || null;
  const iconOf = (p) => (sportOf(p) === "hunt" && kindOf(p) ? kindOf(p)[2] : "📍");
  // The map's "📍 Save point" button is also the on/off switch for the pins: on shows them, off hides them.
  let pinsOn = false;
  try { pinsOn = localStorage.getItem("tf:skiPoints") === "true"; } catch {}
  const shown = () => isSki() && pinsOn;

  // ---------- storage ----------
  const dbP = new Promise((resolve, reject) => {
    let r;
    try { r = indexedDB.open("trail-finder-points", 1); } catch (e) { reject(e); return; }
    r.onupgradeneeded = () => r.result.createObjectStore("points", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  dbP.catch(() => {});
  const done = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const os = async (mode = "readonly") => (await dbP).transaction("points", mode).objectStore("points");
  const dbAll = async () => done((await os()).getAll());
  const dbGet = async (id) => done((await os()).get(id));
  const dbPut = async (p) => done((await os("readwrite")).put(p));
  const dbDel = async (id) => done((await os("readwrite")).delete(id));
  const pointAt = (p) => p.edited || p.created;

  // Shrink a photo so many points fit in the browser's storage (same as ride.html). null if it can't be read.
  async function shrink(blob, max, quality) {
    const u = URL.createObjectURL(blob);
    try {
      const img = new Image(); img.src = u; await img.decode();
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res) => c.toBlob((b) => res(b || blob), "image/jpeg", quality));
    } catch { return null; } finally { URL.revokeObjectURL(u); }
  }

  // ---------- look ----------
  const css = document.createElement("style");
  css.textContent = `
body:not(.sport-ski):not(.sport-hunt) #spAdd { display: none !important; }
body.sport-hunt .sp-pin { background: ${HUNT_COLOR}; }
body.sport-hunt #spBox .sp-new { background: ${HUNT_COLOR}; }
body:not(.sport-hunt) dialog.sp-dlg .sp-kind, dialog.sp-dlg .sp-harvest[hidden] { display: none; }
dialog.sp-dlg .sp-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
dialog.sp-dlg input[type=date], dialog.sp-dlg input[type=number] { width: 100%; font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); margin-bottom: 10px; }
dialog.sp-dlg .sp-facts { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; font-size: .86rem; margin: 0 0 10px; }
dialog.sp-dlg .sp-facts dt { color: var(--muted); }
dialog.sp-dlg .sp-facts dd { margin: 0; font-weight: 600; }
dialog.sp-dlg .sp-checks { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
dialog.sp-dlg .sp-checks li { display: grid; grid-template-columns: 64px 1fr auto; gap: 10px; align-items: center; font-size: .84rem; }
dialog.sp-dlg .sp-checks img, dialog.sp-dlg .sp-checks .ph { width: 64px; height: 48px; object-fit: cover; border-radius: 8px; background: var(--chip); display: grid; place-items: center; }
dialog.sp-dlg .sp-checks b { display: block; }
dialog.sp-dlg .sp-checks button { padding: 4px 8px; font-size: .78rem; }
dialog.sp-dlg h3 { margin: 12px 0 6px; font-size: .78rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
dialog.sp-log { width: min(560px, calc(100vw - 24px)); }
dialog.sp-log .sp-tabs { display: flex; gap: 6px; margin: 0 0 12px; }
dialog.sp-log .sp-tabs button { flex: 1; }
dialog.sp-log .sp-tabs button[aria-selected="true"] { background: ${HUNT_COLOR}; color: #fff; border-color: transparent; }
dialog.sp-log table { width: 100%; border-collapse: collapse; font-size: .82rem; }
dialog.sp-log td, dialog.sp-log th { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line); vertical-align: middle; }
dialog.sp-log th { font-size: .72rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
dialog.sp-log td img { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; display: block; }
dialog.sp-log tr[data-id] { cursor: pointer; }
dialog.sp-log .sp-season { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 14px 0 4px; }
dialog.sp-log .sp-season h3 { margin: 0; }
dialog.sp-log .sp-cam { border: 1px solid var(--line); border-radius: 12px; padding: 10px; margin-bottom: 10px; }
dialog.sp-log .sp-cam header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
dialog.sp-log .sp-cam header b { flex: 1; }
dialog.sp-log .sp-shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 6px; }
dialog.sp-log .sp-shots figure { margin: 0; font-size: .7rem; color: var(--muted); }
dialog.sp-log .sp-shots img, dialog.sp-log .sp-shots .ph { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: 8px; background: var(--chip); display: grid; place-items: center; }
dialog.sp-log .sp-empty { color: var(--muted); font-size: .88rem; }
dialog.sp-dlg select { width: 100%; font: inherit; padding: 9px 11px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); margin-bottom: 10px; }
.sp-guide { font-variant-numeric: tabular-nums; }
.map-tools #spAdd.on { background: ${COLOR}; border-color: ${COLOR}; color: #fff; }
#spBox { display: flex; flex-direction: column; gap: 6px; }
#spBox .sp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
#spBox .sp-new { font: inherit; font-size: .82rem; font-weight: 700; padding: 6px 12px; border-radius: 999px; border: 0; background: ${COLOR}; color: #fff; cursor: pointer; }
#spBox .sp-list .sp-th { width: 28px; height: 28px; border-radius: 6px; object-fit: cover; flex: none; background: var(--chip); display: grid; place-items: center; font-size: 14px; }
.sp-pin { position: relative; box-sizing: border-box; width: 34px; height: 34px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); background: ${COLOR}; border: 2px solid #fff; box-shadow: 0 1px 4px #0007; overflow: hidden; }
.sp-pin > span { position: absolute; inset: 0; transform: rotate(45deg); display: grid; place-items: center; color: #fff; font-size: 15px; background-size: cover; background-position: center; }
.sp-pin.on { border-color: #ffe14d; box-shadow: 0 0 0 3px #ffe14d, 0 1px 4px #0007; }
.sp-gl { cursor: pointer; }
.sp-picking .leaflet-container { cursor: crosshair !important; }
.sp-banner { position: absolute; z-index: 650; left: 50%; top: 12px; transform: translateX(-50%); width: max-content; max-width: calc(100% - 24px); box-sizing: border-box;
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px 10px; padding: 8px 12px; border-radius: 12px; background: var(--panel); color: var(--fg); box-shadow: 0 4px 16px #0004; font-size: .88rem; font-weight: 600; }
.sp-banner button { font: inherit; font-size: .82rem; font-weight: 600; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
dialog.sp-dlg, dialog.sp-dlg * { box-sizing: border-box; }
dialog.sp-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 16px; width: min(420px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.sp-dlg::backdrop { background: rgba(0,0,0,.45); }
dialog.sp-dlg h2 { margin: 0 0 10px; font-family: var(--font-display); font-size: 1.3rem; overflow-wrap: anywhere; }
dialog.sp-dlg label { display: block; font-size: .8rem; font-weight: 600; color: var(--muted); margin: 0 0 3px; }
dialog.sp-dlg input[type=text], dialog.sp-dlg textarea { width: 100%; font: inherit; padding: 9px 11px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); margin-bottom: 10px; }
dialog.sp-dlg textarea { min-height: 78px; resize: vertical; }
dialog.sp-dlg .sp-row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; margin-top: 4px; }
dialog.sp-dlg .sp-row .sp-left { margin-right: auto; }
dialog.sp-dlg button { font: inherit; font-weight: 600; padding: 9px 14px; border-radius: 9px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
dialog.sp-dlg button.go { background: ${COLOR}; color: #fff; border-color: transparent; }
dialog.sp-dlg button.danger { color: #c0392b; }
dialog.sp-dlg button:disabled { opacity: .6; cursor: default; }
dialog.sp-dlg .sp-photo { position: relative; margin-bottom: 10px; }
dialog.sp-dlg .sp-photo img { display: block; width: 100%; max-height: 50vh; object-fit: contain; border-radius: 10px; background: var(--chip); }
dialog.sp-dlg .sp-photo .x { position: absolute; top: 6px; right: 6px; width: 30px; height: 30px; padding: 0; border-radius: 50%; border: 0; background: rgba(0,0,0,.6); color: #fff; }
dialog.sp-dlg label.sp-addph { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; height: 96px; border: 1.5px dashed var(--muted); border-radius: 10px; color: var(--muted); font-size: .88rem; cursor: pointer; margin-bottom: 10px; }
dialog.sp-dlg label.sp-addph input { position: absolute; opacity: 0; width: 1px; height: 1px; }
dialog.sp-dlg .sp-desc { white-space: pre-line; margin: 0 0 10px; overflow-wrap: anywhere; }
dialog.sp-dlg .sp-meta { color: var(--muted); font-size: .8rem; margin: 0 0 10px; }
dialog.sp-dlg .sp-msg { min-height: 1.1em; font-size: .85rem; color: var(--muted); margin: 0 0 6px; }`;
  document.head.append(css);

  // ---------- panel section and map button ----------
  const box = document.createElement("div");
  box.id = "spBox";
  box.innerHTML = `<div class="sp-head"><div class="label" id="spCount">Your points</div><button type="button" class="sp-new" id="spNew">📍 Save a point</button></div>
    <ul class="sk-list sp-list" id="spList"></ul>`;
  const skiPane = document.getElementById("skiPane");
  // The list sits under the chips of whichever sport is on (Skiing's or Hunting's panel).
  function placeBox() {
    const at = isHunt() ? document.getElementById("hnLayers") : document.getElementById("skChips");
    if (at) { if (at.nextElementSibling !== box) at.after(box); } else if (!box.parentNode) skiPane.append(box);
  }
  placeBox();
  const addBtn = document.createElement("button");
  addBtn.id = "spAdd"; addBtn.type = "button"; addBtn.textContent = "📍 Save point";
  addBtn.title = "Save a point on the map with a name, a description and a photo";
  const tools = document.querySelector(".map-tools"), locate = document.getElementById("locate");
  if (tools) tools.insertBefore(addBtn, locate && locate.parentNode === tools ? locate : null);
  const $ = (id) => document.getElementById(id);

  // ---------- pins ----------
  let all = [], points = [], selected = null, urls = [];
  const layer = L.layerGroup();
  const thumbUrl = (p) => { const b = p.thumb || p.photo; if (!b) return ""; const u = URL.createObjectURL(b); urls.push(u); return u; };
  function pinHtml(p, url) {
    return `<div class="sp-pin${selected === p.id ? " on" : ""}"><span${url ? ` style="background-image:url('${url}')"` : ""}>${url ? "" : iconOf(p)}</span></div>`;
  }
  let glMarkers = [];
  function draw() {
    urls.forEach((u) => URL.revokeObjectURL(u)); urls = [];
    layer.clearLayers();
    glMarkers.forEach((m) => m.remove()); glMarkers = [];
    const gl = window.trailMap3d;
    for (const p of points) {
      const url = thumbUrl(p);
      const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: "", html: pinHtml(p, url), iconSize: [34, 34], iconAnchor: [17, 41] }), keyboard: true, title: p.name, zIndexOffset: 500 });
      m.bindTooltip(esc(p.name), { direction: "top", offset: [0, -40] });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); view(p.id); });
      layer.addLayer(m);
      if (gl && window.maplibregl && shown()) {   // the 3D map draws Leaflet lines and dots, not markers, so add them there too
        const el = document.createElement("div");
        el.className = "sp-gl"; el.title = p.name; el.innerHTML = pinHtml(p, url);
        el.addEventListener("click", (e) => { e.stopPropagation(); view(p.id); });
        glMarkers.push(new maplibregl.Marker({ element: el, anchor: "top-left", offset: [-17, -41] }).setLngLat([p.lon, p.lat]).addTo(gl));
      }
    }
    renderList();
  }
  window.addEventListener("tf:map3d", draw);
  function renderList() {
    $("spCount").textContent = points.length ? `Your points (${points.length})` : "Your points";
    const list = $("spList");
    if (!points.length) { list.innerHTML = isHunt() ? `<li class="sk-hint">Save your stands, blinds, sightings, rubs, scrapes, trail cameras and where you parked, with a photo and notes. Tap 📍 Save a point, or long-press the map.</li>` : `<li class="sk-hint">Save a spot you want to remember: a skin track start, a good line, a hazard. Tap 📍 Save a point, or long-press the map.</li>`; return; }
    const sorted = [...points].sort((a, b) => b.created - a.created);
    list.innerHTML = sorted.map((p, i) => {
      const u = p.thumb || p.photo ? thumbUrl(p) : "";
      return `<li><button type="button" data-i="${i}"${selected === p.id ? ' aria-current="true"' : ""}>${u ? `<img class="sp-th" alt="" src="${u}">` : `<span class="sp-th">${iconOf(p)}</span>`}<span class="nm">${esc(p.name)}</span><span class="meta">${esc(new Date(p.created).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))}</span></button></li>`;
    }).join("");
    list.querySelectorAll("button[data-i]").forEach((b) => b.addEventListener("click", () => {
      const p = sorted[+b.dataset.i];
      setPins(true);
      map.setView([p.lat, p.lon], Math.max(map.getZoom(), 14));
      view(p.id);
    }));
  }
  async function reload() {
    try { all = await dbAll(); } catch { all = []; }
    points = all.filter((p) => sportOf(p) === sportNow());
    draw();
  }

  // ---------- choosing where ----------
  let picking = false, banner = null;
  function startPick() {
    if (picking) return;
    setPins(true);
    picking = true;
    document.body.classList.add("sp-picking");
    banner = document.createElement("div");
    banner.className = "sp-banner";
    banner.innerHTML = `<span>Tap the map where the point goes</span><button type="button" data-a="me">◎ Use my location</button><button type="button" data-a="x">Cancel</button>`;
    L.DomEvent.disableClickPropagation(banner);
    map.getContainer().append(banner);
    banner.querySelector('[data-a="x"]').addEventListener("click", stopPick);
    banner.querySelector('[data-a="me"]').addEventListener("click", (e) => {
      const b = e.currentTarget;
      if (!navigator.geolocation) { b.textContent = "Location not available"; return; }
      b.disabled = true; b.textContent = "Finding you…";
      navigator.geolocation.getCurrentPosition(
        (pos) => { stopPick(); map.setView([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), 14)); edit(null, { lat: pos.coords.latitude, lon: pos.coords.longitude }); },
        () => { b.disabled = false; b.textContent = "Couldn't find you. Tap the map"; },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }
  function stopPick() {
    picking = false;
    document.body.classList.remove("sp-picking");
    if (banner) { banner.remove(); banner = null; }
  }
  addBtn.addEventListener("click", () => { if (pinsOn) setPins(false); else startPick(); });
  $("spNew").addEventListener("click", startPick);
  // While choosing, a tap anywhere places the point, even on a ski route or hut (their own click handlers would
  // otherwise take it), so listen on the map container before Leaflet does. A drag to pan doesn't count.
  let downAt = null;
  const box2d = map.getContainer();
  box2d.addEventListener("pointerdown", (e) => { downAt = picking ? [e.clientX, e.clientY] : null; }, true);
  box2d.addEventListener("click", (e) => {
    if (!picking || !isSki() || !downAt || banner && banner.contains(e.target) || e.target.closest(".leaflet-control")) return;
    if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    e.stopPropagation(); e.preventDefault();
    const gl = window.trailMap3d, glBox = gl && gl.getContainer();
    let ll;
    if (glBox && glBox.contains(e.target)) {   // on the 3D map: where the tap meets the ground
      const r = glBox.getBoundingClientRect();
      ll = gl.unproject([e.clientX - r.left, e.clientY - r.top]);
    } else ll = map.mouseEventToLatLng(e);
    stopPick(); edit(null, { lat: ll.lat, lon: ll.lng });
  }, true);
  map.on("contextmenu", (e) => { if (isSki()) { stopPick(); setPins(true); edit(null, { lat: e.latlng.lat, lon: e.latlng.lng }); } });   // right-click, or a long press on a phone

  // ---------- add / edit form ----------
  const form = document.createElement("dialog");
  form.className = "sp-dlg";
  form.innerHTML = `<form method="dialog">
    <h2 id="spfTitle">New point</h2>
    <div id="spfPhoto"></div>
    <div class="sp-kind"><label for="spfKind">What's here</label><select id="spfKind">${KINDS.map(([k, n, e]) => `<option value="${k}">${e} ${n}</option>`).join("")}</select></div>
    <div class="sp-harvest" id="spfHarvest" hidden>
      <div class="sp-grid2"><div><label for="spfSpecies">Species</label><input type="text" id="spfSpecies" maxlength="40" list="spfSpeciesList" placeholder="Mule deer"></div>
      <div><label for="spfSex">Animal</label><select id="spfSex"><option value="">Not set</option><option>Antlered / male</option><option>Antlerless / female</option><option>Young of the year</option></select></div></div>
      <div class="sp-grid2"><div><label for="spfDate">Date</label><input type="date" id="spfDate"></div><div><label for="spfZone">Zone</label><input type="text" id="spfZone" maxlength="20" placeholder="Found from the map"></div></div>
      <datalist id="spfSpeciesList">${["Mule deer", "White-tailed deer", "Black-tailed deer", "Elk", "Moose", "Caribou", "Black bear", "Cougar", "Mountain goat", "Bighorn sheep", "Stone sheep", "Pronghorn", "Wolf", "Coyote", "Grouse", "Ptarmigan", "Pheasant", "Duck", "Goose", "Wild turkey"].map((x) => `<option value="${x}">`).join("")}</datalist>
    </div>
    <label for="spfName">Name</label>
    <input type="text" id="spfName" maxlength="80" placeholder="Like “Skin track start”">
    <label for="spfDesc">Description</label>
    <textarea id="spfDesc" maxlength="500" placeholder="Optional: what's here, when it's good, what to watch for"></textarea>
    <p class="sp-msg" id="spfMsg" role="status"></p>
    <div class="sp-row"><button type="button" id="spfCancel">Cancel</button><button type="submit" class="go" id="spfSave">Save point</button></div>
  </form>`;
  document.body.append(form);
  let editing = null, draftPhoto = null, draftUrl = "";   // draftPhoto: undefined = keep, null = none, Blob = new
  function paintPhoto() {
    if (draftUrl) { URL.revokeObjectURL(draftUrl); draftUrl = ""; }
    const blob = draftPhoto === undefined ? editing && (editing.photo || editing.thumb) : draftPhoto;
    const el = $("spfPhoto");
    if (blob) {
      draftUrl = URL.createObjectURL(blob);
      el.innerHTML = `<div class="sp-photo"><img alt="Point photo" src="${draftUrl}"><button type="button" class="x" aria-label="Remove photo">✕</button></div>`;
      el.querySelector(".x").addEventListener("click", () => { draftPhoto = null; paintPhoto(); });
    } else {
      el.innerHTML = `<label class="sp-addph"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5L16 6.5h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>Add a photo<input type="file" accept="image/*" id="spfFile"></label>`;
      $("spfFile").addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) { draftPhoto = f; paintPhoto(); } });
    }
  }
  let where = null;
  function edit(p, at, preset) {
    editing = p; where = p ? { lat: p.lat, lon: p.lon } : at;
    $("spfKind").value = (p && p.kind) || (preset && preset.kind) || "sighting";
    draftPhoto = undefined;
    $("spfTitle").textContent = p ? "Edit point" : "New point";
    $("spfName").value = p ? p.name : (preset && preset.name) || "";
    $("spfDesc").value = p ? p.note || "" : (preset && preset.note) || "";
    $("spfMsg").textContent = p ? "" : `At ${where.lat.toFixed(5)}, ${where.lon.toFixed(5)}`;
    $("spfSave").disabled = false;
    const h = (p && p.harvest) || {};
    $("spfSpecies").value = h.species || ""; $("spfSex").value = h.sex || "";
    $("spfDate").value = h.date || localDay(new Date());
    $("spfZone").value = h.zone || "";
    if (!h.zone && window.tfHunt) window.tfHunt.zoneAt(where.lat, where.lon).then((z) => { if (!$("spfZone").value) $("spfZone").value = z; });
    showHarvest();
    paintPhoto();
    if (!form.open) form.showModal();
    if (!p) $("spfName").focus();
  }
  const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const showHarvest = () => { $("spfHarvest").hidden = !(isHunt() && $("spfKind").value === "harvest"); };
  $("spfKind").addEventListener("change", () => {
    showHarvest();
    const k = kindOf({ kind: $("spfKind").value });
    if (!$("spfName").value && k && ["truck", "cam", "harvest", "stand", "blind"].includes(k[0])) $("spfName").placeholder = k[1];
  });
  $("spfCancel").addEventListener("click", () => form.close());
  form.addEventListener("close", () => { if (draftUrl) { URL.revokeObjectURL(draftUrl); draftUrl = ""; } });
  form.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const kd = isHunt() && kindOf({ kind: $("spfKind").value });
    const name = $("spfName").value.trim() || (kd && $("spfKind").value === "harvest" && $("spfSpecies").value.trim()) || (kd ? kd[1] : "");
    if (!name) { $("spfName").reportValidity(); return; }
    $("spfSave").disabled = true; $("spfMsg").textContent = "Saving…";
    try {
      const now = Date.now();
      const p = editing ? { ...editing, edited: now } : { id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, created: now, lat: where.lat, lon: where.lon, photo: null, thumb: null, sport: sportNow() || "ski" };
      if (sportOf(p) === "hunt") p.kind = $("spfKind").value;
      if (p.kind === "harvest") p.harvest = { species: $("spfSpecies").value.trim().slice(0, 40), sex: $("spfSex").value, date: $("spfDate").value, zone: $("spfZone").value.trim().slice(0, 20) };
      p.name = name.slice(0, 80);
      p.note = $("spfDesc").value.trim().slice(0, 500);
      if (draftPhoto === null) { p.photo = null; p.thumb = null; }
      else if (draftPhoto) {
        p.photo = (await shrink(draftPhoto, 1600, 0.82)) || draftPhoto;
        p.thumb = await shrink(draftPhoto, 240, 0.75);
        p.photoAt = now;
      }
      await dbPut(p);
      try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
      form.close();
      await reload();
      uploadSoon(p.id);
    } catch (err) {
      $("spfSave").disabled = false;
      $("spfMsg").textContent = "Couldn't save the point: " + (err && err.message || err);
    }
  });

  // ---------- viewing a point ----------
  const viewer = document.createElement("dialog");
  viewer.className = "sp-dlg";
  document.body.append(viewer);
  let viewUrl = "";
  viewer.addEventListener("close", () => {
    if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = ""; }
    chkUrls.forEach((u) => URL.revokeObjectURL(u)); chkUrls = [];
    if (selected) { selected = null; draw(); }
  });
  viewer.addEventListener("click", (e) => { if (e.target === viewer) viewer.close(); });
  const fmtDay = (d) => { const m = String(d || "").match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : String(d || ""); };
  let chkUrls = [];
  const chkUrl = (c) => { const b = c.thumb || c.photo; if (!b) return ""; const u = URL.createObjectURL(b); chkUrls.push(u); return u; };
  function checksHtml(p) {
    const list = [...(p.checks || [])].sort((a, b) => b.at - a.at);
    if (!list.length) return `<p class="sp-meta">No checks yet. Each time you pull the card, add a check with the best photo and what the camera caught.</p>`;
    return `<ul class="sp-checks">${list.map((c) => { const u = chkUrl(c); return `<li>${u ? `<img alt="" src="${u}">` : `<span class="ph">📷</span>`}<span><b>${esc(fmtDay(localDay(new Date(c.at))))}${c.count ? ` · ${c.count} seen` : ""}</b>${esc(c.note || "")}</span><button type="button" class="danger" data-chkdel="${esc(c.id)}">Delete</button></li>`; }).join("")}</ul>`;
  }
  // A camera check: a dated photo and a note of what the camera caught.
  const chkForm = document.createElement("dialog");
  chkForm.className = "sp-dlg";
  chkForm.innerHTML = `<form method="dialog"><h2>Camera check</h2><div id="spcPhoto"></div>
    <div class="sp-grid2"><div><label for="spcDate">Date</label><input type="date" id="spcDate"></div><div><label for="spcCount">Animals seen</label><input type="number" id="spcCount" min="0" max="999" placeholder="0"></div></div>
    <label for="spcNote">What it caught</label><textarea id="spcNote" maxlength="300" placeholder="Like “2 bucks, one 4 point, 6:40 AM”"></textarea>
    <p class="sp-msg" id="spcMsg" role="status"></p>
    <div class="sp-row"><button type="button" id="spcCancel">Cancel</button><button type="submit" class="go" id="spcSave">Save check</button></div></form>`;
  document.body.append(chkForm);
  let chkFor = null, chkPhoto = null, chkPhotoUrl = "";
  function paintChk() {
    if (chkPhotoUrl) { URL.revokeObjectURL(chkPhotoUrl); chkPhotoUrl = ""; }
    const el = $("spcPhoto");
    if (chkPhoto) {
      chkPhotoUrl = URL.createObjectURL(chkPhoto);
      el.innerHTML = `<div class="sp-photo"><img alt="Camera photo" src="${chkPhotoUrl}"><button type="button" class="x" aria-label="Remove photo">✕</button></div>`;
      el.querySelector(".x").addEventListener("click", () => { chkPhoto = null; paintChk(); });
    } else {
      el.innerHTML = `<label class="sp-addph">📷 Add the best photo<input type="file" accept="image/*" id="spcFile"></label>`;
      $("spcFile").addEventListener("change", (e) => {
        const f = e.target.files && e.target.files[0]; if (!f) return;
        chkPhoto = f;
        if (f.lastModified && Date.now() - f.lastModified < 400 * 864e5) $("spcDate").value = localDay(new Date(f.lastModified));   // when the picture was taken, roughly
        paintChk();
      });
    }
  }
  function addCheck(id) {
    chkFor = id; chkPhoto = null;
    $("spcDate").value = localDay(new Date()); $("spcCount").value = ""; $("spcNote").value = ""; $("spcMsg").textContent = ""; $("spcSave").disabled = false;
    paintChk();
    chkForm.showModal();
  }
  $("spcCancel").addEventListener("click", () => chkForm.close());
  chkForm.addEventListener("close", () => { if (chkPhotoUrl) { URL.revokeObjectURL(chkPhotoUrl); chkPhotoUrl = ""; } });
  chkForm.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("spcSave").disabled = true; $("spcMsg").textContent = "Saving…";
    try {
      const p = await dbGet(chkFor); if (!p) throw new Error("the camera point is gone");
      const [y, m, d] = ($("spcDate").value || localDay(new Date())).split("-").map(Number);
      const now = Date.now(), c = { id: `c${now.toString(36)}`, at: new Date(y, m - 1, d, 12).valueOf(), count: Math.max(0, Math.min(999, +$("spcCount").value || 0)), note: $("spcNote").value.trim().slice(0, 300) };
      if (chkPhoto) { c.photo = (await shrink(chkPhoto, 1600, 0.82)) || chkPhoto; c.thumb = await shrink(chkPhoto, 240, 0.75); }
      p.checks = [...(p.checks || []), c]; p.edited = now;
      await dbPut(p);
      chkForm.close();
      await reload(); uploadSoon(p.id);
      if (logDlg.open) renderLog(); else view(p.id);
    } catch (err) { $("spcSave").disabled = false; $("spcMsg").textContent = "Couldn't save: " + (err && err.message || err); }
  });

  async function view(id) {
    const p = await dbGet(id).catch(() => null);
    if (!p) return;
    selected = id; draw();
    if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = ""; }
    const blob = p.photo || p.thumb;
    if (blob) viewUrl = URL.createObjectURL(blob);
    const when = new Date(p.created).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    viewer.innerHTML = `${viewUrl ? `<div class="sp-photo"><img alt="${esc(p.name)}" src="${viewUrl}"></div>` : ""}
      <h2>${sportOf(p) === "hunt" ? iconOf(p) + " " : ""}${esc(p.name)}</h2>
      ${sportOf(p) === "hunt" && kindOf(p) ? `<p class="sp-meta">${esc(kindOf(p)[1])}</p>` : ""}
      ${p.kind === "harvest" && p.harvest ? `<dl class="sp-facts">${p.harvest.species ? `<dt>Species</dt><dd>${esc(p.harvest.species)}</dd>` : ""}${p.harvest.sex ? `<dt>Animal</dt><dd>${esc(p.harvest.sex)}</dd>` : ""}${p.harvest.date ? `<dt>Date</dt><dd>${esc(fmtDay(p.harvest.date))}</dd>` : ""}${p.harvest.zone ? `<dt>Zone</dt><dd>${esc(p.harvest.zone)}</dd>` : ""}</dl>` : ""}
      ${p.note ? `<p class="sp-desc">${esc(p.note)}</p>` : ""}
      ${p.kind === "cam" ? `<h3>Camera checks</h3>${checksHtml(p)}<div class="sp-row" style="justify-content:flex-start;margin-bottom:10px"><button type="button" data-a="check">📷 Add a check</button></div>` : ""}
      <p class="sp-meta">Saved ${esc(when)} · ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${p.owner ? " · in your account" : " · on this device"}</p>
      <p class="sp-msg" role="status"></p>
      <div class="sp-row"><button type="button" data-a="guide">🧭 Guide me here</button><button type="button" data-a="share">Share</button></div>
      <div class="sp-row"><button type="button" class="danger sp-left" data-a="del">Delete</button><button type="button" data-a="edit">Edit</button><button type="button" class="go" data-a="close">Close</button></div>`;
    viewer.querySelector('[data-a="guide"]').addEventListener("click", () => { viewer.close(); guide(p); });
    const ck = viewer.querySelector('[data-a="check"]'); if (ck) ck.addEventListener("click", () => { viewer.close(); addCheck(p.id); });
    viewer.querySelectorAll("[data-chkdel]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Sure?"; return; }
      const q = await dbGet(p.id); if (!q) return;
      q.checks = (q.checks || []).filter((c) => c.id !== b.dataset.chkdel); q.edited = Date.now();
      await dbPut(q); await reload(); uploadSoon(q.id); view(q.id);
    }));
    viewer.querySelector('[data-a="share"]').addEventListener("click", () => share(p, viewer.querySelector(".sp-msg")));
    viewer.querySelector('[data-a="close"]').addEventListener("click", () => viewer.close());
    viewer.querySelector('[data-a="edit"]').addEventListener("click", () => { viewer.close(); edit(p); });
    const del = viewer.querySelector('[data-a="del"]');
    del.addEventListener("click", async () => {
      if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = "Tap again to delete"; return; }
      del.disabled = true;
      try {
        await dbDel(p.id);
        if (p.owner && acct.user && p.owner === acct.user.id) deleteRemote(p.id).catch((e) => console.warn("Couldn't delete the point from your account:", e));
        viewer.close();
        await reload();
      } catch (err) { del.disabled = false; viewer.querySelector(".sp-msg").textContent = "Couldn't delete: " + (err && err.message || err); }
    });
    if (!viewer.open) viewer.showModal();
  }

  // ---------- guide me here (and back to the truck) ----------
  // Follows your location: a dashed line from you to the point, and how far and which way it is. In Hunting the
  // line and banner stay until you stop them or switch sport.
  const guideLayer = L.layerGroup().addTo(map);
  let guideWatch = null, guideBanner = null, guideTo = null;
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const bearing = (a, b) => {
    const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
    return ((Math.atan2(y, x) / r) + 360) % 360;
  };
  const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`);
  function guide(p) {
    stopGuide();
    if (!navigator.geolocation) { alert("This browser can't share your location."); return; }
    guideTo = p;
    guideBanner = document.createElement("div");
    guideBanner.className = "sp-banner sp-guide";
    guideBanner.innerHTML = `<span id="spgText">Finding you… (to ${esc(p.name)})</span><button type="button" data-a="x">Stop</button>`;
    L.DomEvent.disableClickPropagation(guideBanner);
    map.getContainer().parentNode.append(guideBanner);
    guideBanner.querySelector('[data-a="x"]').addEventListener("click", stopGuide);
    let first = true;
    const onPos = (pos) => {
      const me = { lat: pos.coords.latitude, lon: pos.coords.longitude }, d = map.distance([me.lat, me.lon], [p.lat, p.lon]), b = bearing(me, p);
      guideLayer.clearLayers();
      L.polyline([[me.lat, me.lon], [p.lat, p.lon]], { color: "#1c7ed6", weight: 4, dashArray: "8 8", interactive: false }).addTo(guideLayer);
      L.circleMarker([me.lat, me.lon], { radius: 7, color: "#fff", weight: 2, fillColor: "#1c7ed6", fillOpacity: 1, interactive: false }).addTo(guideLayer);
      const t = document.getElementById("spgText");
      if (t) t.textContent = d < 15 ? `You're at ${p.name}` : `${p.name}: ${fmtDist(d)} ${DIRS[Math.round(b / 45) % 8]} (${Math.round(b)}°)${pos.coords.accuracy > 50 ? ` · GPS ±${Math.round(pos.coords.accuracy)} m` : ""}`;
      if (first) { first = false; map.fitBounds(L.latLngBounds([[me.lat, me.lon], [p.lat, p.lon]]).pad(0.25), { maxZoom: 16 }); }
    };
    const onErr = (e) => { const t = document.getElementById("spgText"); if (t) t.textContent = e.code === 1 ? "Location is blocked for this site" : "Can't find you yet…"; };
    const opts = { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 };
    navigator.geolocation.getCurrentPosition((pos) => { if (guideTo === p) onPos(pos); }, onErr, opts);   // a first fix right away; the watch keeps it moving
    guideWatch = navigator.geolocation.watchPosition((pos) => { if (guideTo === p) onPos(pos); }, onErr, opts);
  }
  function stopGuide() {
    if (guideWatch != null) navigator.geolocation.clearWatch(guideWatch);
    guideWatch = null; guideTo = null;
    guideLayer.clearLayers();
    if (guideBanner) { guideBanner.remove(); guideBanner = null; }
  }
  // The Hunting panel's quick action buttons (an icon, then their label) say what's happening for a moment.
  function say(b, text, ms = 0) {
    if (!b) return;
    const t = [...b.childNodes].reverse().find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!t) return;
    if (b.dataset.label == null) b.dataset.label = t.textContent;
    t.textContent = text;
    if (ms) setTimeout(() => { t.textContent = b.dataset.label; }, ms);
  }
  function markTruck(b) {
    if (!navigator.geolocation) { say(b, "No location", 3000); return; }
    b && (b.disabled = true); say(b, "Finding you…");
    navigator.geolocation.getCurrentPosition(async (pos) => {
      if (b) b.disabled = false;
      const now = Date.now();
      const p = { id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, created: now, lat: pos.coords.latitude, lon: pos.coords.longitude,
        photo: null, thumb: null, sport: "hunt", kind: "truck", name: `Truck, ${new Date(now).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`, note: "" };
      try { await dbPut(p); setPins(true); await reload(); uploadSoon(p.id); map.setView([p.lat, p.lon], Math.max(map.getZoom(), 15)); say(b, "Truck saved ✓", 3000); }
      catch { say(b, "Couldn't save", 3000); }
    }, () => { if (b) b.disabled = false; say(b, "Can't find you", 3000); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  }
  function backToTruck(b) {
    const truck = all.filter((p) => sportOf(p) === "hunt" && p.kind === "truck").sort((a, b2) => b2.created - a.created)[0];
    if (!truck) { say(b, "Mark it first", 3000); return; }
    setPins(true); guide(truck);
  }

  // ---------- hunting log: harvests by season, trail cameras and their checks ----------
  // A season is the licence year, April 1 to March 31.
  const seasonOf = (d) => { const m = String(d).match(/^(\d{4})-(\d\d)/); const y = m ? +m[1] : new Date(d).getFullYear(), mo = m ? +m[2] : new Date(d).getMonth() + 1; const s = mo >= 4 ? y : y - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };
  const logDlg = document.createElement("dialog");
  logDlg.className = "sp-dlg sp-log";
  document.body.append(logDlg);
  let logTab = "harvest", logUrls = [];
  logDlg.addEventListener("close", () => { logUrls.forEach((u) => URL.revokeObjectURL(u)); logUrls = []; });
  logDlg.addEventListener("click", (e) => { if (e.target === logDlg) logDlg.close(); });
  const logUrl = (b) => { if (!b) return ""; const u = URL.createObjectURL(b); logUrls.push(u); return u; };
  function harvestRows() {
    return all.filter((p) => sportOf(p) === "hunt" && p.kind === "harvest").map((p) => ({ p, h: p.harvest || {}, day: (p.harvest && p.harvest.date) || localDay(new Date(p.created)) }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }
  function renderLog() {
    logUrls.forEach((u) => URL.revokeObjectURL(u)); logUrls = [];
    const hv = harvestRows(), cams = all.filter((p) => sportOf(p) === "hunt" && p.kind === "cam").sort((a, b) => pointAt(b) - pointAt(a));
    let body;
    if (logTab === "harvest") {
      if (!hv.length) body = `<p class="sp-empty">No harvests yet. Save a point with “What's here: 🎯 Harvest” where you took an animal, with the species, date and a photo; the zone fills in from the map.</p>`;
      else {
        const by = new Map();
        for (const r of hv) { const k = seasonOf(r.day); (by.get(k) || by.set(k, []).get(k)).push(r); }
        body = [...by.entries()].map(([season, rows]) => {
          const counts = {};
          for (const r of rows) { const k = r.h.species || "Not set"; counts[k] = (counts[k] || 0) + 1; }
          return `<div class="sp-season"><h3>${season} season</h3><span class="sp-meta">${esc(Object.entries(counts).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(", "))}</span></div>
            <table><thead><tr><th></th><th>Species</th><th>Date</th><th>Zone</th></tr></thead><tbody>${rows.map(({ p, h, day }) => `<tr data-id="${esc(p.id)}"><td>${p.thumb || p.photo ? `<img alt="" src="${logUrl(p.thumb || p.photo)}">` : "🎯"}</td>
              <td><b>${esc(h.species || p.name)}</b>${h.sex ? `<br><span class="sp-meta">${esc(h.sex)}</span>` : ""}</td><td>${esc(fmtDay(day))}</td><td>${esc(h.zone || "")}</td></tr>`).join("")}</tbody></table>`;
        }).join("") + `<div class="sp-row" style="margin-top:12px"><button type="button" data-a="csv">Save as CSV</button></div>`;
      }
    } else {
      if (!cams.length) body = `<p class="sp-empty">No trail cameras yet. Save a point with “What's here: 📷 Trail camera” where it hangs, then add a check each time you pull the card.</p>`;
      else body = cams.map((p) => {
        const list = [...(p.checks || [])].sort((a, b) => b.at - a.at), seen = list.reduce((n, c) => n + (c.count || 0), 0);
        return `<section class="sp-cam"><header><b>📷 ${esc(p.name)}</b><button type="button" data-cam="${esc(p.id)}">Add a check</button><button type="button" data-show="${esc(p.id)}">Map</button></header>
          <p class="sp-meta">${list.length ? `${list.length} check${list.length > 1 ? "s" : ""}, last ${esc(fmtDay(localDay(new Date(list[0].at))))}${seen ? ` · ${seen} animals seen` : ""}` : "No checks yet"}</p>
          ${list.length ? `<div class="sp-shots">${list.map((c) => `<figure>${c.thumb || c.photo ? `<img alt="" src="${logUrl(c.thumb || c.photo)}">` : `<span class="ph">📷</span>`}<figcaption>${esc(fmtDay(localDay(new Date(c.at))))}${c.count ? ` · ${c.count}` : ""}${c.note ? `<br>${esc(c.note)}` : ""}</figcaption></figure>`).join("")}</div>` : ""}</section>`;
      }).join("");
    }
    logDlg.innerHTML = `<h2>Hunting log</h2><div class="sp-tabs" role="tablist"><button type="button" role="tab" data-tab="harvest" aria-selected="${logTab === "harvest"}">🎯 Harvests (${hv.length})</button><button type="button" role="tab" data-tab="cam" aria-selected="${logTab === "cam"}">📷 Trail cameras (${cams.length})</button></div>
      ${body}<div class="sp-row" style="margin-top:12px"><button type="button" class="go" data-a="close">Close</button></div>`;
    logDlg.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { logTab = b.dataset.tab; renderLog(); }));
    logDlg.querySelector('[data-a="close"]').addEventListener("click", () => logDlg.close());
    logDlg.querySelectorAll("tr[data-id]").forEach((r) => r.addEventListener("click", () => { logDlg.close(); showPoint(r.dataset.id); }));
    logDlg.querySelectorAll("[data-cam]").forEach((b) => b.addEventListener("click", () => addCheck(b.dataset.cam)));
    logDlg.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => { logDlg.close(); showPoint(b.dataset.show); }));
    const csv = logDlg.querySelector('[data-a="csv"]');
    if (csv) csv.addEventListener("click", () => {
      const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
      const lines = [["Season", "Date", "Species", "Animal", "Zone", "Latitude", "Longitude", "Name", "Notes"].join(",")]
        .concat(hv.map(({ p, h, day }) => [seasonOf(day), day, h.species, h.sex, h.zone, p.lat.toFixed(5), p.lon.toFixed(5), p.name, p.note].map(q).join(",")));
      const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv" }));
      const a = document.createElement("a"); a.href = url; a.download = "hunting-harvests.csv"; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });
  }
  function showPoint(id) {
    const p = all.find((x) => x.id === id); if (!p) return;
    setPins(true); map.setView([p.lat, p.lon], Math.max(map.getZoom(), 14)); view(id);
  }
  async function openLog(tab) {
    if (tab) logTab = tab;
    await reload();
    renderLog();
    if (!logDlg.open) logDlg.showModal();
  }
  window.tfPoints = { add: startPick, markTruck, backToTruck, openLog };

  // ---------- sharing ----------
  const shareLink = (p) => `${location.origin}${location.pathname}#pin=${p.lat.toFixed(5)},${p.lon.toFixed(5)},${sportOf(p)},${p.kind || ""},${encodeURIComponent(p.name)}`;
  async function share(p, msg) {
    const url = shareLink(p), text = `${p.name}${p.note ? ` - ${p.note}` : ""}\n${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
    const data = { title: p.name, text, url };
    try {
      const photo = p.photo && new File([p.photo], "point.jpg", { type: p.photo.type || "image/jpeg" });
      if (photo && navigator.canShare && navigator.canShare({ ...data, files: [photo] })) { await navigator.share({ ...data, files: [photo] }); return; }
      if (navigator.share) { await navigator.share(data); return; }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      if (msg) msg.textContent = "Link copied: paste it in a message.";
    } catch (e) { if (msg && e && e.name !== "AbortError") msg.textContent = `Couldn't share: ${e.message || e}`; }
  }
  // A shared link (#pin=...) opens that sport at the point with the form ready to save it.
  function openShared() {
    const m = location.hash.match(/^#pin=(-?[\d.]+),(-?[\d.]+),(\w*),(\w*),(.*)$/);
    if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    const [lat, lon] = [+m[1], +m[2]], sport = m[3] === "hunt" ? "hunt" : "ski";
    if (!isFinite(lat) || !isFinite(lon)) return;
    const sel = document.getElementById("sport");
    if (sel && sel.value !== sport) { sel.value = sport; sel.dispatchEvent(new Event("change")); }
    map.setView([lat, lon], Math.max(map.getZoom(), 15));
    setPins(true);
    let name = ""; try { name = decodeURIComponent(m[5]).slice(0, 80); } catch {}
    setTimeout(() => edit(null, { lat, lon }, { kind: m[4], name, note: "Shared with me" }), 300);
  }

  // ---------- account (optional sign-in, see account.js) ----------
  // IndexedDB stays the copy the map shows. Signed in, each point is also kept in the account; points saved
  // before signing in move into it at the next sync. Signed out, points that belong to an account leave this
  // device (they stay in the account), the same as rides.
  const acct = window.tfAccount || { enabled: false };
  const BUCKET = "point-photos";
  const photoPath = (uid, id, thumb) => `${uid}/${id}${thumb ? "-t" : ""}.jpg`;
  async function uploadPoint(p) {
    const c = acct.client, uid = acct.user.id;
    const { data: old, error: e1 } = await c.from("ski_points").select("data").eq("user_id", uid).eq("id", p.id).maybeSingle();
    if (e1) throw e1;
    const oldAt = old && old.data.photoAt;
    if (p.photo && oldAt !== p.photoAt) {
      for (const [blob, thumb] of [[p.photo, false], [p.thumb, true]]) {
        if (!blob) continue;
        const { error } = await c.storage.from(BUCKET).upload(photoPath(uid, p.id, thumb), blob, { upsert: true, contentType: blob.type || "image/jpeg" });
        if (error) throw error;
      }
    } else if (!p.photo && oldAt) await c.storage.from(BUCKET).remove([photoPath(uid, p.id, false), photoPath(uid, p.id, true)]);
    // trail camera checks: each photo once, and the photos of deleted checks go too
    const checks = p.checks || [];
    for (const k of checks) {
      if (!k.photo || k.sent) continue;
      for (const [blob, thumb] of [[k.photo, false], [k.thumb, true]]) {
        if (!blob) continue;
        const { error } = await c.storage.from(BUCKET).upload(photoPath(uid, `${p.id}-${k.id}`, thumb), blob, { upsert: true, contentType: blob.type || "image/jpeg" });
        if (error) throw error;
      }
      k.sent = true;
    }
    const gone = ((old && old.data.checks) || []).filter((o) => o.hasPhoto && !checks.some((k) => k.id === o.id));
    if (gone.length) await c.storage.from(BUCKET).remove(gone.flatMap((o) => [photoPath(uid, `${p.id}-${o.id}`, false), photoPath(uid, `${p.id}-${o.id}`, true)]));
    const { photo, thumb, owner, ...data } = p;
    if (checks.length) data.checks = checks.map(({ photo: ph, thumb: th, sent, ...k }) => ({ ...k, hasPhoto: !!ph, hasThumb: !!th }));
    data.photoAt = p.photo ? p.photoAt || 1 : null;
    data.hasThumb = !!p.thumb;
    const { error } = await c.from("ski_points").upsert({ user_id: uid, id: p.id, data, updated_at: new Date(pointAt(p)).toISOString() });
    if (error) throw error;
    await dbPut({ ...p, photoAt: data.photoAt, owner: uid });
  }
  async function downloadPoint(id) {
    const c = acct.client, uid = acct.user.id;
    const { data: row, error } = await c.from("ski_points").select("data").eq("user_id", uid).eq("id", id).single();
    if (error) throw error;
    const { hasThumb, ...p } = row.data;
    const have = await dbGet(id);
    if (p.photoAt && have && have.photoAt === p.photoAt && have.photo) { p.photo = have.photo; p.thumb = have.thumb; }
    else if (p.photoAt) {
      const get = async (t) => { const r = await c.storage.from(BUCKET).download(photoPath(uid, id, t)); if (r.error) throw r.error; return r.data; };
      p.photo = await get(false); p.thumb = hasThumb ? await get(true) : null;
    } else { p.photo = null; p.thumb = null; }
    if (p.checks) p.checks = await Promise.all(p.checks.map(async ({ hasPhoto, hasThumb: ht, ...k }) => {
      const mine = have && (have.checks || []).find((x) => x.id === k.id);
      if (mine && mine.photo) return { ...k, photo: mine.photo, thumb: mine.thumb, sent: true };
      if (!hasPhoto) return k;
      const get = async (t) => { const r = await c.storage.from(BUCKET).download(photoPath(uid, `${id}-${k.id}`, t)); if (r.error) throw r.error; return r.data; };
      return { ...k, photo: await get(false), thumb: ht ? await get(true) : null, sent: true };
    }));
    await dbPut({ ...p, owner: uid });
  }
  async function deleteRemote(id) {
    const c = acct.client, uid = acct.user.id;
    const { error } = await c.from("ski_points").delete().eq("user_id", uid).eq("id", id);
    if (error) throw error;
    await c.storage.from(BUCKET).remove([photoPath(uid, id, false), photoPath(uid, id, true)]);
    const { data: files } = await c.storage.from(BUCKET).list(uid, { search: `${id}-c` });   // trail camera check photos
    if (files && files.length) await c.storage.from(BUCKET).remove(files.map((f) => `${uid}/${f.name}`));
  }
  let syncing = null;
  function uploadSoon(id) {
    if (!acct.user) return;
    (syncing || Promise.resolve()).then(async () => { const p = await dbGet(id); if (p) await uploadPoint(p); })
      .catch((e) => console.warn("Point saved on this device; it will go to your account next time:", e));
  }
  function sync() {
    if (!syncing) syncing = doSync().finally(() => { syncing = null; });
    return syncing;
  }
  async function doSync() {
    if (!acct.client) return;
    const uid = acct.user ? acct.user.id : null;
    let local = [];
    try { local = await dbAll(); } catch { return; }
    let changed = false;
    for (const p of local) if (p.owner && p.owner !== uid) { await dbDel(p.id); changed = true; }
    if (uid) {
      try {
        const { data: rows, error } = await acct.client.from("ski_points").select("id, updated_at").eq("user_id", uid);
        if (error) throw error;
        const remote = new Map(rows.map((r) => [r.id, Date.parse(r.updated_at)]));
        for (const p of local) {
          if (p.owner && p.owner !== uid) continue;
          const at = remote.get(p.id);
          remote.delete(p.id);
          if (at == null) {
            if (p.owner) { await dbDel(p.id); changed = true; }   // deleted on another device
            else await uploadPoint(p);                             // saved here before signing in
          } else if (at > pointAt(p)) { await downloadPoint(p.id); changed = true; }
          else if (at < pointAt(p) || !p.owner) await uploadPoint(p);
        }
        for (const id of remote.keys()) { await downloadPoint(id); changed = true; }
      } catch (e) { console.warn("Ski point sync failed; points are still saved on this device:", e); }
    }
    if (changed) await reload();
  }
  if (acct.enabled) {
    acct.ready.then(sync);
    window.addEventListener("tf:account", () => sync());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && acct.user && isSki()) sync(); });
  }

  // ---------- only in Skiing ----------
  function setPins(on) {
    if (on === pinsOn) return;
    pinsOn = on;
    try { localStorage.setItem("tf:skiPoints", String(on)); } catch {}
    if (!on) stopPick();
    onSport();
  }
  function onSport() {
    const on = shown();
    if (on && !map.hasLayer(layer)) layer.addTo(map);
    if (!on && map.hasLayer(layer)) map.removeLayer(layer);
    if (!isSki()) stopPick();
    addBtn.classList.toggle("on", pinsOn);
    addBtn.setAttribute("aria-pressed", String(pinsOn));
    addBtn.title = pinsOn ? "Your saved points are on the map. Tap to hide them" : "Show your saved points and add a new one";
    draw();
  }
  let lastSport = sportNow();   // winter.js sets body.sport-ski / sport-hunt when the sport menu changes
  new MutationObserver(() => { if (sportNow() !== lastSport) { lastSport = sportNow(); placeBox(); points = all.filter((p) => sportOf(p) === sportNow()); if (!isSki()) stopGuide(); onSport(); } })
    .observe(document.body, { attributes: true, attributeFilter: ["class"] });
  reload().then(() => { onSport(); openShared(); });
})();
