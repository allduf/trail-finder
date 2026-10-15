// Saved points in Skiing: the skier drops a pin on the map (a tap, a long press, or their location) and gives it a
// name, a short description and a photo, like "good skin track start" or "wind-loaded bowl, check before dropping".
// Pins show only in Skiing, on the flat map and the 3D map; tapping one shows its photo, name and description,
// with Edit and Delete.
// Stored in this browser's IndexedDB "trail-finder-points" (one record per point, the photo inside it). Signed in
// (account.js), points are also kept in the Supabase table ski_points with photos in the "point-photos" bucket
// (see supabase/ski-points.sql), so they show up on the skier's other devices, the same way ride.html syncs rides.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L || !document.getElementById("skiPane")) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isSki = () => document.body.classList.contains("sport-ski");
  const COLOR = "#0a7d6e";
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
body:not(.sport-ski) #spAdd { display: none !important; }
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
  const skiPane = document.getElementById("skiPane"), chips = document.getElementById("skChips");
  if (chips) chips.after(box); else skiPane.append(box);
  const addBtn = document.createElement("button");
  addBtn.id = "spAdd"; addBtn.type = "button"; addBtn.textContent = "📍 Save point";
  addBtn.title = "Save a point on the map with a name, a description and a photo";
  const tools = document.querySelector(".map-tools"), locate = document.getElementById("locate");
  if (tools) tools.insertBefore(addBtn, locate && locate.parentNode === tools ? locate : null);
  const $ = (id) => document.getElementById(id);

  // ---------- pins ----------
  let points = [], selected = null, urls = [];
  const layer = L.layerGroup();
  const thumbUrl = (p) => { const b = p.thumb || p.photo; if (!b) return ""; const u = URL.createObjectURL(b); urls.push(u); return u; };
  function pinHtml(p, url) {
    return `<div class="sp-pin${selected === p.id ? " on" : ""}"><span${url ? ` style="background-image:url('${url}')"` : ""}>${url ? "" : "📍"}</span></div>`;
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
    if (!points.length) { list.innerHTML = `<li class="sk-hint">Save a spot you want to remember: a skin track start, a good line, a hazard. Tap 📍 Save a point, or long-press the map.</li>`; return; }
    const sorted = [...points].sort((a, b) => b.created - a.created);
    list.innerHTML = sorted.map((p, i) => {
      const u = p.thumb || p.photo ? thumbUrl(p) : "";
      return `<li><button type="button" data-i="${i}"${selected === p.id ? ' aria-current="true"' : ""}>${u ? `<img class="sp-th" alt="" src="${u}">` : `<span class="sp-th">📍</span>`}<span class="nm">${esc(p.name)}</span><span class="meta">${esc(new Date(p.created).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }))}</span></button></li>`;
    }).join("");
    list.querySelectorAll("button[data-i]").forEach((b) => b.addEventListener("click", () => {
      const p = sorted[+b.dataset.i];
      setPins(true);
      map.setView([p.lat, p.lon], Math.max(map.getZoom(), 14));
      view(p.id);
    }));
  }
  async function reload() {
    try { points = await dbAll(); } catch { points = []; }
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
  map.on("click", (e) => { if (picking && isSki()) { stopPick(); edit(null, { lat: e.latlng.lat, lon: e.latlng.lng }); } });
  map.on("contextmenu", (e) => { if (isSki()) { stopPick(); setPins(true); edit(null, { lat: e.latlng.lat, lon: e.latlng.lng }); } });   // right-click, or a long press on a phone

  // ---------- add / edit form ----------
  const form = document.createElement("dialog");
  form.className = "sp-dlg";
  form.innerHTML = `<form method="dialog">
    <h2 id="spfTitle">New point</h2>
    <div id="spfPhoto"></div>
    <label for="spfName">Name</label>
    <input type="text" id="spfName" maxlength="80" required placeholder="Like “Skin track start”">
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
  function edit(p, at) {
    editing = p; where = p ? { lat: p.lat, lon: p.lon } : at;
    draftPhoto = undefined;
    $("spfTitle").textContent = p ? "Edit point" : "New point";
    $("spfName").value = p ? p.name : "";
    $("spfDesc").value = p ? p.note || "" : "";
    $("spfMsg").textContent = p ? "" : `At ${where.lat.toFixed(5)}, ${where.lon.toFixed(5)}`;
    $("spfSave").disabled = false;
    paintPhoto();
    if (!form.open) form.showModal();
    if (!p) $("spfName").focus();
  }
  $("spfCancel").addEventListener("click", () => form.close());
  form.addEventListener("close", () => { if (draftUrl) { URL.revokeObjectURL(draftUrl); draftUrl = ""; } });
  form.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("spfName").value.trim();
    if (!name) { $("spfName").reportValidity(); return; }
    $("spfSave").disabled = true; $("spfMsg").textContent = "Saving…";
    try {
      const now = Date.now();
      const p = editing ? { ...editing, edited: now } : { id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, created: now, lat: where.lat, lon: where.lon, photo: null, thumb: null };
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
    if (selected) { selected = null; draw(); }
  });
  viewer.addEventListener("click", (e) => { if (e.target === viewer) viewer.close(); });
  async function view(id) {
    const p = await dbGet(id).catch(() => null);
    if (!p) return;
    selected = id; draw();
    if (viewUrl) { URL.revokeObjectURL(viewUrl); viewUrl = ""; }
    const blob = p.photo || p.thumb;
    if (blob) viewUrl = URL.createObjectURL(blob);
    const when = new Date(p.created).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    viewer.innerHTML = `${viewUrl ? `<div class="sp-photo"><img alt="${esc(p.name)}" src="${viewUrl}"></div>` : ""}
      <h2>${esc(p.name)}</h2>
      ${p.note ? `<p class="sp-desc">${esc(p.note)}</p>` : ""}
      <p class="sp-meta">Saved ${esc(when)} · ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}${p.owner ? " · in your account" : " · on this device"}</p>
      <p class="sp-msg" role="status"></p>
      <div class="sp-row"><button type="button" class="danger sp-left" data-a="del">Delete</button><button type="button" data-a="edit">Edit</button><button type="button" class="go" data-a="close">Close</button></div>`;
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
    const { photo, thumb, owner, ...data } = p;
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
    await dbPut({ ...p, owner: uid });
  }
  async function deleteRemote(id) {
    const c = acct.client, uid = acct.user.id;
    const { error } = await c.from("ski_points").delete().eq("user_id", uid).eq("id", id);
    if (error) throw error;
    await c.storage.from(BUCKET).remove([photoPath(uid, id, false), photoPath(uid, id, true)]);
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
  let lastSki = isSki();   // winter.js sets body.sport-ski when the sport menu changes
  new MutationObserver(() => { if (isSki() !== lastSki) { lastSki = isSki(); onSport(); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  reload().then(onSport);
})();
