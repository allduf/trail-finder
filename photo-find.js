// "Which trail is this?": find a trail from a photo, a screenshot of a post or a short video.
// 1. A photo or video that kept the spot where it was taken (EXIF GPS in photos, the ISO 6709 location in a video's
//    moov box) is snapped to the MTB trails from the nightly all-trails lists around that spot.
// 2. Without a spot (screenshots, videos saved from online), the words in it are read on the device (Tesseract.js,
//    loaded only when needed, about 7 MB the first time) from the picture or a few frames of the video, together
//    with a caption the rider pastes. Trail names, hashtags and place names in those words are matched against the
//    nightly name lists (data/names-<zone>.json) and the likely trails are listed, best first.
// Nothing leaves the device: the picture is read in the browser and only the public trail lists are downloaded.
(() => {
  "use strict";
  const F = window.tfFind, map = window.tfLeaflet;
  if (!F || !map || !window.L) return;
  const $ = (id) => document.getElementById(id);
  const esc = F.esc;

  const EXIFR = "https://unpkg.com/exifr@7.1.3/dist/lite.umd.js";
  const TESS = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
  const TESS_OPTS = {
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
    langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int",
  };
  const NEAR_M = 400;         // trails this close to the photo spot are listed
  const ON_M = 60;            // this close: "taken on" the trail (phone GPS is good to a few tens of metres)
  const FAR_M = 3000;         // nothing within NEAR_M: the nearest trails up to this far
  const MAX_SIDE = 2400;      // pictures are shrunk to this many pixels on the long side before reading (phone memory)
  const VIDEO_FRAMES = 5;
  const STRONG = 1.05;        // a match this good in the areas looked at first doesn't need the other regions

  const css = document.createElement("style");
  css.textContent = `
.tsearch-row .photo-find-btn { padding-left: 10px; padding-right: 10px; display: inline-flex; align-items: center; }
.pf { position: fixed; inset: 0; z-index: 1001; background: rgba(0,0,0,.45); display: grid; place-items: center; padding: 16px; }
.pf[hidden] { display: none; }
.pf .card { background: var(--panel); color: var(--fg); max-width: 560px; width: 100%; max-height: 92%; overflow-y: auto; border-radius: 14px; padding: 18px 20px; box-sizing: border-box; box-shadow: var(--shadow); }
.pf h2 { font-family: var(--font-display); text-transform: uppercase; margin: 0 0 6px; font-size: 1.35rem; display: flex; align-items: center; gap: 8px; }
.pf h2 .pf-x { margin-left: auto; font: inherit; font-size: 1.1rem; line-height: 1; padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: var(--fg); cursor: pointer; }
.pf .pf-hint { color: var(--muted); font-size: .88rem; margin: 0 0 12px; }
.pf.has-file .pf-hint { display: none; }
.pf .pf-drop { border: 2px dashed var(--line); border-radius: 12px; padding: 14px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; text-align: center; }
.pf .pf-drop.over { border-color: var(--accent); background: var(--chip); }
.pf .pf-drop .pf-or { color: var(--muted); font-size: .82rem; flex-basis: 100%; }
.pf .pf-prev { display: flex; gap: 12px; align-items: center; margin-top: 12px; }
.pf .pf-prev[hidden] { display: none; }
.pf .pf-prev img, .pf .pf-prev video { width: 84px; height: 84px; object-fit: cover; border-radius: 10px; background: var(--chip); flex: none; }
.pf .pf-status { font-size: .9rem; }
.pf .pf-bar { height: 4px; border-radius: 2px; background: var(--line); margin-top: 6px; overflow: hidden; }
.pf .pf-bar span { display: block; height: 100%; width: 0; background: var(--accent); transition: width .2s; }
.pf .pf-bar[hidden] { display: none; }
.pf label.pf-l { display: block; font-weight: 700; font-size: .82rem; margin: 12px 0 4px; }
.pf label.pf-l small { font-weight: 400; color: var(--muted); }
.pf select, .pf textarea { width: 100%; box-sizing: border-box; font: inherit; font-size: 16px; padding: 7px 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); }
.pf textarea { min-height: 60px; resize: vertical; }
.pf details { margin-top: 8px; font-size: .85rem; }
.pf details textarea { margin-top: 6px; font-size: 14px; }
.pf .pf-go { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
.pf .pf-res { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; }
.pf .pf-res li { display: grid; grid-template-columns: 4px 1fr auto; gap: 10px; align-items: center; padding: 8px 10px 8px 8px; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; }
.pf .pf-res li:hover, .pf .pf-res li:focus-visible { background: var(--chip); outline: none; }
.pf .pf-res li .bar { align-self: stretch; border-radius: 2px; background: var(--line); }
.pf .pf-res li.best .bar { background: var(--accent); }
.pf .pf-res .pn { font-weight: 600; overflow-wrap: anywhere; }
.pf .pf-res .pm { font-size: .8rem; color: var(--muted); }
.pf .pf-res .pc { font-size: .72rem; font-weight: 700; color: var(--muted); white-space: nowrap; }
.pf .pf-res li.best .pc { color: var(--accent); }
.pf .pf-note { font-size: .85rem; color: var(--muted); margin: 10px 0 0; }
.pf .pf-note:empty { display: none; }
.pf-pin { font-size: 22px; line-height: 30px; text-align: center; filter: drop-shadow(0 1px 2px rgba(0,0,0,.6)); }
@media (max-width: 760px) { .pf { padding: 0; align-items: end; } .pf .card { max-height: 94%; border-radius: 14px 14px 0 0; padding-bottom: calc(18px + env(safe-area-inset-bottom)); } }
`;
  document.head.append(css);

  const box = document.createElement("div");
  box.className = "pf"; box.id = "photoFind"; box.hidden = true;
  box.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-labelledby="pfTitle">
  <h2 id="pfTitle">📷 Which trail is this? <button type="button" class="pf-x" id="pfClose" aria-label="Close">✕</button></h2>
  <p class="pf-hint">A photo, a screenshot of a post or a short video. With the spot where it was taken, you get that trail. Without it, the app reads the words in it (trail names, places, hashtags, Strava or Trailforks labels) and lists the likely trails. It stays on your device.</p>
  <div class="pf-drop" id="pfDrop">
    <button type="button" class="btn primary" id="pfPick">Choose a photo or video</button>
    <button type="button" class="btn" id="pfPaste" hidden>📋 Paste a screenshot</button>
    <span class="pf-or">or drop one here${matchMedia("(pointer: fine)").matches ? ", or press Ctrl+V / ⌘V" : ""}</span>
    <input type="file" id="pfFile" accept="image/*,video/*" hidden>
  </div>
  <div class="pf-prev" id="pfPrev" hidden><span id="pfThumb"></span><div style="flex:1;min-width:0"><div class="pf-status" id="pfStatus" role="status"></div><div class="pf-bar" id="pfBar" hidden><span></span></div></div></div>
  <ul class="pf-res" id="pfRes" role="list"></ul>
  <p class="pf-note" id="pfNote"></p>
  <label class="pf-l" for="pfArea">Where is it? <small>(optional, helps when the picture has no spot)</small></label>
  <select id="pfArea"></select>
  <label class="pf-l" for="pfCaption">The post's caption or anything you know <small>(optional)</small></label>
  <textarea id="pfCaption" placeholder="Paste the caption, or type a trail or place you saw, like “Half Nelson Squamish”" spellcheck="false"></textarea>
  <details id="pfReadBox" hidden><summary>Words read from the picture</summary><textarea id="pfRead" spellcheck="false" aria-label="Words read from the picture (you can fix them)"></textarea></details>
  <div class="pf-go"><button type="button" class="btn" id="pfGo">Find the trail</button><button type="button" class="btn" id="pfWords" hidden>Read the words instead</button></div>
</div>`;
  document.body.append(box);

  F.regions.forEach((r) => { if (!r.zones) r.zones = F.zones.filter((z) => r.ids.includes(z.id)); });
  $("pfArea").innerHTML = `<option value="">Anywhere (I don't know)</option>` + F.regions.map((r) => `<optgroup label="${esc(r.name)}"><option value="r:${r.id}">All of ${esc(r.name)}</option>` +
    r.zones.map((z) => `<option value="${z.id}">${esc(z.name)}</option>`).join("") + `</optgroup>`).join("");

  // ---------- open / close ----------
  let job = 0, file = null, gpsSpot = null, pin = null, thumbUrl = null;
  function open() {
    box.hidden = false;
    $("pfPaste").hidden = !(navigator.clipboard && navigator.clipboard.read);
    setTimeout(() => $("pfPick").focus(), 0);
  }
  function close() { box.hidden = true; }
  window.tfPhotoFind = { open };
  $("photoFindBtn").addEventListener("click", open);
  $("pfClose").addEventListener("click", close);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) { e.stopPropagation(); close(); } }, true);

  // ---------- getting the picture ----------
  $("pfPick").addEventListener("click", () => $("pfFile").click());
  $("pfFile").addEventListener("change", () => { const f = $("pfFile").files[0]; $("pfFile").value = ""; if (f) start(f); });
  const drop = $("pfDrop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, () => drop.classList.remove("over")));
  drop.addEventListener("drop", (e) => { e.preventDefault(); const f = [...(e.dataTransfer.files || [])].find(isMedia); if (f) start(f); });
  document.addEventListener("paste", (e) => {
    if (box.hidden) return;
    const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(isMedia);
    if (f) { e.preventDefault(); start(f); }
  });
  $("pfPaste").addEventListener("click", async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) { const b = await item.getType(type); start(new File([b], "pasted." + type.split("/")[1], { type })); return; }
      }
      say("There's no picture to paste. Take a screenshot (or copy a picture) first.");
    } catch { say("The browser didn't allow pasting. Use Choose a photo or video instead."); }
  });
  const isMedia = (f) => /^(image|video)\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp|mov|mp4|m4v)$/i.test(f.name || "");
  const isVideo = (f) => /^video\//.test(f.type) || /\.(mov|mp4|m4v)$/i.test(f.name || "");

  function say(msg, frac) {
    $("pfPrev").hidden = false;
    $("pfStatus").textContent = msg;
    $("pfBar").hidden = frac == null;
    if (frac != null) $("pfBar").firstElementChild.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + "%";
  }

  async function start(f) {
    file = f; gpsSpot = null;
    box.classList.add("has-file");
    const my = ++job;
    $("pfRes").innerHTML = ""; $("pfNote").textContent = ""; $("pfRead").value = ""; $("pfReadBox").hidden = true; $("pfWords").hidden = true;
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = URL.createObjectURL(f);
    $("pfThumb").innerHTML = isVideo(f) ? `<video src="${thumbUrl}#t=0.5" muted playsinline preload="metadata"></video>` : `<img src="${thumbUrl}" alt="">`;
    say("Looking for the spot where it was taken…");
    let spot = null;
    try { spot = isVideo(f) ? await videoSpot(f) : await photoSpot(f); } catch {}
    if (my !== job) return;
    if (spot) {
      gpsSpot = spot;
      await byGps(my);
    } else {
      say("No spot saved in it. Reading the words in it…");
      await byWords(my, true);
    }
  }
  $("pfGo").addEventListener("click", () => {
    const my = ++job;
    if (gpsSpot) byGps(my);
    else byWords(my, !!file && !$("pfRead").value.trim() && $("pfReadBox").hidden);
  });
  $("pfWords").addEventListener("click", () => { const my = ++job; gpsSpot = null; $("pfWords").hidden = true; byWords(my, true); });

  // ---------- 1. the spot where it was taken ----------
  const scripts = new Map();
  function loadScript(src) {
    if (!scripts.has(src)) scripts.set(src, new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.async = true; s.onload = res; s.onerror = () => { scripts.delete(src); rej(new Error("couldn't load " + src)); };
      document.head.append(s);
    }));
    return scripts.get(src);
  }
  const okSpot = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  // JPEG, HEIC (iPhone) and TIFF photos: the EXIF GPS block, read by exifr.
  async function photoSpot(f) {
    await loadScript(EXIFR);
    const g = await window.exifr.gps(f);
    return g && okSpot(g.latitude, g.longitude) ? [g.latitude, g.longitude] : null;
  }
  // MOV and MP4 videos: phones write the spot as an ISO 6709 string ("+49.7016-123.1558+045.000/") in the moov box:
  // Apple under com.apple.quicktime.location.ISO6709, Android and older iPhones in udta/©xyz. moov is often at the end.
  async function videoSpot(f) {
    let pos = 0;
    while (pos + 8 <= f.size) {
      const h = new DataView(await f.slice(pos, pos + 16).arrayBuffer());
      let size = h.getUint32(0), hdr = 8;
      const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
      if (size === 1 && h.byteLength >= 16) { size = h.getUint32(8) * 2 ** 32 + h.getUint32(12); hdr = 16; }
      else if (size === 0) size = f.size - pos;
      if (size < hdr) return null;
      if (type === "moov") {
        if (size > 64e6) return null;
        const text = new TextDecoder("latin1").decode(await f.slice(pos, pos + size).arrayBuffer());
        const m = text.match(/(?:ISO6709|©xyz)[\s\S]{0,400}?([+-]\d{1,2}\.\d{3,})([+-]\d{1,3}\.\d{3,})/) || text.match(/([+-]\d{1,2}\.\d{4,})([+-]\d{1,3}\.\d{4,})[+-/]/);
        return m && okSpot(+m[1], +m[2]) ? [+m[1], +m[2]] : null;
      }
      pos += size;
    }
    return null;
  }

  // Metres from p to the segment a-b, on a flat map around p (fine at trail scale).
  function segDist(p, a, b, kx) {
    const ax = (a[1] - p[1]) * kx, ay = (a[0] - p[0]) * 111320, bx = (b[1] - p[1]) * kx, by = (b[0] - p[0]) * 111320;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    return Math.hypot(ax + t * dx, ay + t * dy);
  }
  function wayDist(p, geom) {
    const kx = 111320 * Math.cos(p[0] * Math.PI / 180);
    let best = Infinity;
    for (let i = 1; i < geom.length; i++) best = Math.min(best, segDist(p, geom[i - 1], geom[i], kx));
    return geom.length === 1 ? segDist(p, geom[0], geom[0], kx) : best;
  }
  async function zonesAround(p) {
    const b = L.latLng(p).toBounds(2 * FAR_M);
    let zones = F.zones.filter((z) => z.bounds.intersects(b));
    if (!zones.length) { await F.caIndexLoad(); zones = F.caZonesIn([b]); }
    return zones;
  }
  function showPin(p) {
    if (pin) pin.remove();
    pin = L.marker(p, { icon: L.divIcon({ className: "pf-pin", html: "📷", iconSize: [30, 30], iconAnchor: [15, 26] }), title: "Where the photo or video was taken" })
      .bindPopup(`Where the photo or video was taken<br><button type="button" class="linkish" data-pf-unpin>Remove this pin</button>`).addTo(map);
    pin.on("popupopen", (e) => { const b = e.popup.getElement().querySelector("[data-pf-unpin]"); if (b) b.onclick = () => { pin.remove(); pin = null; }; });
  }
  async function byGps(my) {
    const p = gpsSpot;
    say(`Taken at ${p[0].toFixed(5)}, ${p[1].toFixed(5)}. Finding the trail there…`);
    showPin(p);
    $("pfWords").hidden = false;
    const zones = await zonesAround(p);
    if (!zones.length) { if (my === job) show([], "It was taken outside the areas the app has trail lists for. The 📷 pin on the map shows the spot: tap the trail under it."); return; }
    const lists = await Promise.all(zones.map((z) => F.mtbWays(z).catch(() => null)));
    if (my !== job) return;
    const ways = new Map();
    lists.forEach((l) => (l || []).forEach((w) => ways.set(w.id, w)));
    const near = [...ways.values()].map((w) => ({ w, d: wayDist(p, w.geom) })).filter((x) => x.d <= FAR_M).sort((a, b) => a.d - b.d);
    // One row per named trail (its nearest piece), and each unnamed trail on its own.
    const rows = [], seen = new Set();
    const close = near.filter((x) => x.d <= NEAR_M);
    for (const x of (close.length ? close : near.slice(0, 12))) {
      const name = x.w.tags.name || x.w.tags["mtb:name"];
      const key = name ? "n:" + F.norm(name) : "w:" + x.w.id;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ x, name, g: name ? groupFrom(name, x.w, ways) : null });
      if (rows.length >= 6) break;
    }
    const fmt = (d) => d < 15 ? "right on it" : d < 1000 ? `${Math.round(d / 5) * 5} m away` : `${(d / 1000).toFixed(1)} km away`;
    const res = rows.map((r, i) => ({
      name: r.name || "Unnamed trail", tags: r.x.w.tags, best: i === 0 && r.x.d <= ON_M,
      conf: i === 0 && r.x.d <= ON_M ? "Taken on it" : r.x.d <= NEAR_M ? "Nearby" : "Nearest",
      meta: [F.kindOf(r.x.w.tags), F.zoneOf(L.latLng(p)), "taken " + fmt(r.x.d)].filter(Boolean).join(" · "),
      open: r.g ? () => F.show(r.g) : () => F.openWay(r.x.w.id, L.latLng(p)),
    }));
    map.setView(p, Math.max(map.getZoom(), 15));
    if (my !== job) return;
    say(rows.length ? "Found from the spot where it was taken." : "No MTB trail near the spot where it was taken.");
    show(res, close.length ? "" : rows.length ? `No MTB trail within ${NEAR_M} m of the spot, so these are the nearest ones. The 📷 pin on the map shows where it was taken.`
      : "The 📷 pin on the map shows where it was taken. It may be on a path the app doesn't count as an MTB trail: tap it on the map.");
  }
  // The pieces of a named trail around the one found, for opening it whole (like a pick in the name search).
  function groupFrom(name, w, ways) {
    const mid = (x) => x.geom[x.geom.length >> 1];
    const pieces = [...ways.values()].filter((x) => (x.tags.name || x.tags["mtb:name"]) === name && L.latLng(mid(x)).distanceTo(mid(w)) < 4000);
    const c = mid(w);
    return { name, type: "w", kind: F.kindOf(w.tags), tags: w.tags, zone: F.zoneOf(L.latLng(c)), center: L.latLng(c), items: pieces.map((x) => ({ t: "w", id: x.id, c: mid(x), tags: x.tags })) };
  }

  // ---------- 2. no spot: the words in it ----------
  async function imageCanvas(src) {
    const img = new Image();
    img.decoding = "async";
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("this picture can't be opened here")); img.src = src; });
    return toCanvas(img, img.naturalWidth, img.naturalHeight);
  }
  function toCanvas(el, w, h) {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
    return c;
  }
  function inverted(src) {
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    const x = c.getContext("2d");
    x.filter = "grayscale(1) invert(1) contrast(1.6)";
    x.drawImage(src, 0, 0);
    return c;
  }
  // A few frames spread through the video (text on a video often shows for only a second or two).
  async function videoFrames(src, my) {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = src;
    const wait = (ev, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout")), ms); v.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true }); });
    await wait("loadeddata", 15000);
    const dur = v.duration && Number.isFinite(v.duration) ? v.duration : 0;
    const n = dur < 3 ? 1 : VIDEO_FRAMES, out = [];
    for (let i = 0; i < n; i++) {
      if (my !== job) break;
      const t = n === 1 ? Math.min(dur / 2, 0.5) : dur * (0.06 + 0.88 * i / (n - 1));
      try { v.currentTime = t; await wait("seeked", 6000); out.push(toCanvas(v, v.videoWidth, v.videoHeight)); } catch {}
    }
    v.removeAttribute("src"); v.load();
    return out;
  }
  async function readWords(my) {
    const canvases = isVideo(file) ? await videoFrames(thumbUrl, my) : [await imageCanvas(thumbUrl)];
    if (!canvases.length) throw new Error("no frames could be taken from the video");
    say("Getting the word reader ready (about 7 MB the first time)…", 0);
    await loadScript(TESS);
    let part = 0;
    const worker = await window.Tesseract.createWorker("eng", 1, {
      ...TESS_OPTS,
      logger: (m) => {
        if (my !== job) return;
        if (m.status === "recognizing text") say(canvases.length > 1 ? `Reading the words in frame ${part + 1} of ${canvases.length}…` : "Reading the words…", (part + m.progress) / canvases.length);
        else if (/loading|initializ/.test(m.status)) say("Getting the word reader ready (about 7 MB the first time)…", m.progress);
      },
    });
    const lines = [];
    try {
      for (; part < canvases.length && my === job; part++) {
        let { data } = await worker.recognize(canvases[part]);
        // Light words on a dark screen or a busy video: little comes out, so read a dark-on-light copy too.
        if ((data.lines || []).filter((l) => l.confidence >= 45).length < 3 && my === job) {
          const more = (await worker.recognize(inverted(canvases[part]))).data;
          data = { lines: (data.lines || []).concat(more.lines || []), text: (data.text || "") + "\n" + (more.text || "") };
        }
        (data.lines || []).forEach((l) => {
          const words = (l.words || []).filter((w) => w.confidence >= 45).map((w) => w.text);
          const t = words.join(" ").trim();
          if (t && /[a-z]{2}/i.test(t) && !lines.includes(t)) lines.push(t);
        });
        if (!data.lines && data.text) data.text.split("\n").forEach((t) => { t = t.trim(); if (t && !lines.includes(t)) lines.push(t); });
      }
    } finally {
      worker.terminate();            // frees the reader's memory (phones)
      canvases.forEach((c) => { c.width = c.height = 0; });
    }
    return lines.join("\n");
  }
  async function byWords(my, read) {
    if (pin && !gpsSpot) { pin.remove(); pin = null; }
    if (read && file) {
      try {
        const text = await readWords(my);
        if (my !== job) return;
        $("pfRead").value = text;
        $("pfReadBox").hidden = false;
      } catch (e) {
        if (my !== job) return;
        say(`Couldn't read the words in it (${e.message}).`);
      }
    }
    const text = [$("pfCaption").value, $("pfRead").value].join("\n");
    if (!text.trim()) {
      say(file ? "No words found in it." : "Add a photo or video, or type what you know.");
      show([], "Paste the post's caption above, or type a trail or place name you saw, then tap Find the trail.");
      return;
    }
    say("Matching the words with the trail names…", 0.95);
    let res;
    try { res = await match(text, my); } catch (e) { if (my === job) say(`Couldn't load the trail names (${e.message}).`); return; }
    if (!res || my !== job) return;
    const n = res.rows.length;
    const sure = n && res.rows[0].conf !== "Possible";
    say(n ? (sure ? "Likely trails, best first." : "Possible trails, best first.") : "No trail name found in the words.");
    const where = res.places.length ? `It mentions ${res.places.slice(0, 3).join(", ")}. ` : "";
    show(res.rows, n ? where + (sure ? "" : "None is a sure match: check the names against the post.")
      : where + "No trail name in the picture or caption matched a trail the app knows. Paste the caption, type a trail name you saw, or pick the area and try again.");
  }

  // ---------- matching words to trail names ----------
  const STOP = new Set(["trail", "trails", "the", "path", "of", "and"]);
  const SAME = { mt: "mount", mtn: "mountain", st: "saint", rd: "road", fsr: "road", n: "north", s: "south" };
  // One-word trail names that are everyday words (or app buttons in a screenshot) aren't counted on their own.
  const GENERIC = new Set(("upper lower main middle road access connector loop climb climbing descent downhill uphill bridge creek lake river mountain park view ridge summit peak " +
    "north south east west home love life good best nice fun day time ride riding bike biking mtb enduro shred send follow following followers like likes liked comment comments reply " +
    "share save more view views search explore reels video photo story stories post posts message today yesterday week weeks year years ago km mile miles elevation gain moving " +
    "speed avg max time map maps segment segments strava trailforks kudos activity morning afternoon evening night lunch ride rides route routes forest woods dirt loam loamy " +
    "jump jumps drop drops flow fast steep tech gnar rock rocks roots root slab slabs berm berms line lines lap laps spring summer fall autumn winter snow rain sun sunny " +
    "wet dry dust dusty mud muddy easy hard green blue black double pro official unofficial new old first last big little long short high low great awesome epic sick").split(" "));
  const PART = new Set(["upper", "lower", "middle", "top", "bottom"]);
  const words = (s) => F.norm(s).split(" ").filter(Boolean).map((w) => SAME[w] || w);
  const core = (ws) => { const c = ws.filter((w) => !STOP.has(w)); return c.length ? c : ws; };
  const allowed = (len) => (len < 6 ? 0 : len <= 10 ? 1 : 2);

  const nameLists = new Map();      // zone id -> Promise of [{ name, key, ws, join, items, center, tags, zone, mtb }]
  function zoneNames(z) {
    if (!nameLists.has(z.id)) nameLists.set(z.id, F.nightly(`names-${z.id}.json`).then((f) => {
      const groups = [], byKey = new Map();
      ((f && f.items) || []).forEach((i) => {
        const name = i.tags.name || i.tags["mtb:name"];
        if (!name || !i.c) return;
        const ws = core(words(name)), key = i.t + ":" + ws.join(" ");
        if (!ws.length) return;
        const same = byKey.get(key) || [];
        let g = same.find((g) => L.latLng(g.items[0].c).distanceTo(i.c) < 3000);
        if (!g) {
          const alt = ["alt_name", "official_name", "loc_name", "short_name"].flatMap((k) => (i.tags[k] || "").split(";")).map((s) => core(words(s))).filter((a) => a.length);
          if (PART.has(ws[0]) && ws.length > 1) alt.push(Object.assign(ws.slice(1), { part: true }));   // "Lower A-Line" is A-Line to riders
          g = { name, type: i.t, ws, alts: alt, items: [], tags: i.tags, zone: z };
          same.push(g); byKey.set(key, same); groups.push(g);
        }
        g.items.push(i);
        if (Object.keys(i.tags).some((k) => /^mtb(:|$)/.test(k))) g.tags = i.tags;
      });
      groups.forEach((g) => {
        g.center = L.latLng(g.items.reduce((s, i) => s + i.c[0], 0) / g.items.length, g.items.reduce((s, i) => s + i.c[1], 0) / g.items.length);
        g.mtb = g.type === "r" ? g.tags.route === "mtb" : Object.keys(g.tags).some((k) => /^mtb(:|$)/.test(k));
      });
      return groups;
    }));
    return nameLists.get(z.id);
  }

  // Places named in the words: riding areas (data/riding-areas.json), the zones' towns and a few nicknames.
  const ALIASES = [["north shore", "van"], ["north van", "van"], ["north vancouver", "van"], ["vancouver", "van"], ["fromme", "van"], ["seymour", "van"], ["cypress", "van"],
    ["squamish", "sqm"], ["whistler", "wh"], ["pemberton", "pem"], ["pemby", "pem"], ["lillooet", "lil"], ["chilcotin", "chil"], ["chilcotins", "chil"], ["gold bridge", "chil"],
    ["sunshine coast", "sun"], ["gibsons", "sun"], ["sechelt", "sun"], ["powell river", "pr"], ["coquitlam", "fv"], ["burke", "fv"], ["maple ridge", "fv"], ["abbotsford", "fv"],
    ["chilliwack", "fv"], ["princeton", "pri"], ["merritt", "mer"], ["kamloops", "kam"], ["sun peaks", "kam"], ["williams lake", "wl"], ["salmon arm", "shu"], ["vernon", "ver"],
    ["silver star", "ver"], ["kelowna", "kel"], ["west kelowna", "kel"], ["big white", "bwh"], ["penticton", "pen"], ["summerland", "pen"], ["osoyoos", "sok"], ["grand forks", "gfk"],
    ["christina lake", "gfk"], ["rossland", "ros"], ["castlegar", "ros"], ["nelson", "nel"], ["revelstoke", "rev"], ["revy", "rev"], ["golden", "gol"], ["invermere", "inv"],
    ["radium", "inv"], ["cranbrook", "cbk"], ["kimberley", "cbk"], ["fernie", "fer"], ["calgary", "yyc"], ["bragg creek", "brg"], ["canmore", "kan"], ["kananaskis", "kan"],
    ["banff", "bnf"], ["sea to sky", "r:all"], ["okanagan", "r:tok"], ["kootenay", "r:koot"], ["kootenays", "r:koot"]];
  let places = null;
  function placeList() {
    if (!places) places = F.nightly("riding-areas.json").then((f) => {
      const out = ALIASES.map(([n, id]) => ({ ws: words(n), label: n.replace(/\b\w/g, (c) => c.toUpperCase()), zones: zonesOf(id) }));
      ((f && f.areas) || []).forEach((a) => {
        if (!a.name || !a.c) return;
        const c = L.latLng(a.c), zones = F.zones.filter((z) => z.bounds.contains(c));
        const ws = words(a.name);
        out.push({ ws, label: a.name, zones, c });
        if (ws[0] === "mount" && ws.length > 1) out.push({ ws: ws.slice(1), label: a.name, zones, c });
      });
      return out.filter((p) => p.zones.length && p.ws.join("").length >= 4);
    });
    return places;
  }
  function zonesOf(id) {
    if (id.startsWith("r:")) { const r = F.regions.find((r) => r.id === id.slice(2)); return r ? r.zones : []; }
    const z = F.zoneById(id); return z ? [z] : [];
  }

  // Where a run of words (spaces ignored, like "half nelson" / "#halfnelson") matches, with the number of typos.
  function findIn(tokens, ws, joins) {
    const target = ws.join(""), k = ws.length, tol = Math.min(allowed(target.length), 2);
    let best = null;
    for (let i = 0; i < tokens.length; i++) {
      for (const n of [k, k - 1, k + 1]) {
        if (n < 1 || i + n > tokens.length) continue;
        const run = joins(i, n);
        if (Math.abs(run.length - target.length) > tol) continue;
        const d = run === target ? 0 : F.editDist(run, target);
        if (d <= tol && (!best || d < best.d)) best = { d, at: i, n, how: "words" };
      }
      // A hashtag or user name that holds the whole name ("#halfnelsonsquamish").
      if (target.length >= 7 && tokens[i].length > target.length && tokens[i].includes(target) && !best) best = { d: 0, at: i, n: 1, how: "tag" };
    }
    return best;
  }
  async function match(text, my) {
    const tokens = core(words(text));
    const pre = [""];  // pre[i] = tokens[0..i) joined, for quick runs
    tokens.forEach((t, i) => { pre.push(pre[i] + t); });
    const joins = (i, n) => pre[i + n].slice(pre[i].length);
    const tokenSet = new Set(tokens);
    // Places first: they say which areas to look in first, and lift trails there.
    const pl = await placeList();
    let found = pl.map((p) => ({ ...p, hit: findIn(tokens, p.ws, joins) })).filter((p) => p.hit);
    const pick = $("pfArea").value;
    const picked = pick ? zonesOf(pick) : [];
    const here = F.regionHere().zones;
    const pickedIds = new Set(picked.map((z) => z.id)), hereIds = new Set(here.map((z) => z.id));

    // A quick check on a trail's longest word before the full run check: most of the ~15,000 names fail it.
    const keyMemo = new Map();
    const keyHit = (w) => {
      if (keyMemo.has(w)) return keyMemo.get(w);
      let ok = tokenSet.has(w);
      if (!ok) for (const t of tokenSet) {
        if ((w.length >= 4 && t.includes(w)) || (w.length >= 5 && Math.abs(t.length - w.length) <= 1 && F.editDist(t, w) <= 1)) { ok = true; break; }
      }
      keyMemo.set(w, ok); return ok;
    };
    // How well the words hold the trail's name (or another of its names), before any place bonus.
    const textScore = (g) => {
      let best = null;
      for (const ws of [g.ws, ...g.alts]) {
        const key = ws.reduce((a, b) => (b.length > a.length ? b : a), "");
        if (key.length < 3 || !keyHit(key)) continue;
        const join = ws.join("");
        if (join.length < 4 || /^\d+$/.test(join)) continue;
        if (ws.length === 1 && GENERIC.has(join)) continue;
        const hit = findIn(tokens, ws, joins);
        if (!hit) continue;
        let s;
        if (ws.length === 1) { if (hit.d) continue; s = join.length >= 8 ? 0.85 : 0.75; }    // one word: only exact
        else s = hit.how === "tag" ? 0.9 : 1 - 0.08 * hit.d;
        if (hit.how === "tag" && ws.length === 1) s -= 0.1;
        if (ws.part) s -= 0.05;
        if (!best || s > best.s) best = { s, hit, ws };
      }
      return best && { g, ...best };
    };
    const lists = new Map();
    const textHits = async (zones) => {
      const out = [];
      await Promise.all(zones.map((z) => zoneNames(z).catch(() => [])));   // download them side by side
      for (const z of zones) {
        if (!lists.has(z.id)) lists.set(z.id, (await zoneNames(z).catch(() => [])).map(textScore).filter(Boolean));
        out.push(...lists.get(z.id));
      }
      return out;
    };
    // A place inside a longer trail name that's in the words isn't a place ("Nelson" in "Half Nelson").
    const inName = (p, hits) => hits.some((h) => h.hit.how === "words" && h.ws.length > p.ws.length && h.s >= 0.9
      && h.hit.at <= p.hit.at && h.hit.at + h.hit.n >= p.hit.at + p.hit.n);
    const zonesFor = (places) => {
      const ids = new Set(places.flatMap((p) => p.zones.map((z) => z.id)));
      return picked.length ? picked : ids.size ? F.zones.filter((z) => ids.has(z.id)) : here;
    };
    let first = zonesFor(found);
    say(`Matching the words with the trail names${first.length <= 3 ? " in " + first.map((z) => z.name.split(" (")[0]).join(", ") : ""}…`, 0.95);
    let raw = await textHits(first);
    if (my !== job) return null;
    if (found.some((p) => inName(p, raw))) {
      found = found.filter((p) => !inName(p, raw));
      const again = zonesFor(found);
      if (again.some((z) => !first.includes(z))) { raw = await textHits(again); if (my !== job) return null; }
      first = again;
    }
    const hinted = new Set(found.flatMap((p) => p.zones.map((z) => z.id)));
    const spots = found.filter((p) => p.c);
    const scored = (list) => list.map((t) => {
      const g = t.g, why = [];
      let s = t.s;
      if (g.mtb) s += 0.1;
      if (pickedIds.has(g.zone.id)) s += 0.25;
      else if (hinted.has(g.zone.id)) { s += 0.25; why.push(`in ${found.find((p) => p.zones.some((z) => z.id === g.zone.id)).label}, which it mentions`); }
      else if (hinted.size) s -= 0.15;             // it names other places
      else if (hereIds.has(g.zone.id)) s += 0.05;
      if (spots.some((p) => p.c.distanceTo(g.center) < 8000)) s += 0.1;
      // The same words are also a place it names ("Alice Lake"): weaker as a trail.
      if (found.some((p) => p.ws.join("") === t.ws.join(""))) s -= 0.2;
      const said = tokens.slice(t.hit.at, t.hit.at + t.hit.n).join(" ");
      why.unshift(t.hit.how === "tag" || t.ws !== g.ws ? `“${said}” is in the words` : t.hit.d ? `read as “${said}”` : `“${g.name}” is in the words`);
      return { g, s, why };
    }).filter((h) => h.s >= 0.7);
    let hits = scored(raw);
    // Nothing sure in the areas looked at first (and no area picked): look through every region too.
    if (!picked.length && !hits.some((h) => h.s >= STRONG)) {
      say("Looking through every region…", 0.97);
      const rest = await textHits(F.zones.filter((z) => !first.includes(z)));
      if (my !== job) return null;
      hits = hits.concat(scored(rest));
    }
    // One row per trail name and area; the best first.
    hits.sort((a, b) => b.s - a.s || map.getCenter().distanceTo(a.g.center) - map.getCenter().distanceTo(b.g.center));
    const seen = new Set(), rows = [];
    for (const h of hits) {
      const key = h.g.ws.join(" ") + "|" + h.g.zone.id;
      if (seen.has(key)) continue;
      seen.add(key); rows.push(h);
      if (rows.length >= 8) break;
    }
    const top = rows.length ? rows[0].s : 0;
    return {
      places: [...new Set(found.map((p) => p.label))],
      rows: rows.map((h, i) => {
        const g = h.g, best = i === 0 && h.s >= STRONG && (rows.length === 1 || rows[1].s <= h.s - 0.049);
        const conf = best ? "Best match" : h.s >= top - 0.05 && h.s >= STRONG ? "Likely" : "Possible";
        const fg = { name: g.name, type: g.type, kind: F.kindOf(g.tags, g.type === "r"), tags: g.tags, zone: g.zone.name.split(" (")[0], center: g.center, items: g.items };
        return { name: g.name, tags: g.tags, best, conf, meta: [fg.kind, fg.zone, ...h.why].filter(Boolean).join(" · "), open: () => F.show(fg) };
      }),
    };
  }

  // ---------- results ----------
  let shown = [];
  function show(rows, note) {
    shown = rows;
    $("pfRes").innerHTML = rows.map((r, n) => `<li tabindex="0" data-n="${n}" class="${r.best ? "best" : ""}"><span class="bar"></span>
      <div><div class="pn">${esc(r.name)} ${r.tags ? F.diffBadge(r.tags) : ""}</div><div class="pm">${esc(r.meta)}</div></div><span class="pc">${esc(r.conf)}</span></li>`).join("");
    $("pfNote").textContent = note || "";
  }
  const pickRow = (li) => { const r = li && shown[+li.dataset.n]; if (r) { close(); r.open(); } };
  $("pfRes").addEventListener("click", (e) => pickRow(e.target.closest("li")));
  $("pfRes").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickRow(e.target.closest("li")); } });
})();
