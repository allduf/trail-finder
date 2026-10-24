// "Which trail is this?": find a trail from a photo, a screenshot of a post or a short video.
// 1. A photo or video that kept the spot where it was taken (EXIF GPS in photos, the ISO 6709 location in a video's
//    moov box) is snapped to the MTB trails from the nightly all-trails lists around that spot.
// 2. Without a spot (screenshots, videos saved from online), the words in it are read on the device (Tesseract.js,
//    loaded only when needed, about 7 MB the first time) from the picture or a few frames of the video, together
//    with a caption the rider pastes. Trail names, hashtags and place names in those words are matched against the
//    nightly name lists (data/names-<zone>.json) and the likely trails are listed, best first.
// 3. Landmarks: big mountains, rock walls and lakes named in the words or described by the rider (data/landmarks.json)
//    list the trails that can actually see them (a line-of-sight check on the elevation tiles), nearest first.
// 4. AI (optional, Gemini): when the Supabase function (AI_FN) is set up (supabase/functions/which-trail), a small
//    copy of the picture goes to the AI, which says what it recognises (landmarks, trail names, places, terrain) and
//    where it thinks the camera stood. Once the list is up, the online check searches Google for the likely trails and
//    compares photos of them (from those pages and geotagged ones nearby) with the picture, then reorders the list.
//    Without it everything above still works.
// 5. "Is this the trail?": a Yes saves a small copy of the picture and what led to the match (supabase/trail-matches.sql),
//    quietly, and past matches with similar words lift that trail in later searches.
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
  const VIDEO_FRAMES = 3;
  // Short clips only (alex, 2026-10-22): a big video is slow and heavy on a phone, and 3 frames of 5 seconds are enough.
  const VIDEO_MAX_S = 5, VIDEO_MAX_MB = 60;
  const AREA_M = 3000;        // a riding area named in the words: its trails within this of its centre
  const STRONG = 1.05;        // a match this good in the areas looked at first doesn't need the other regions
  // The Supabase function holding supabase/functions/which-trail (the dashboard deployed it as "smooth-worker").
const AI_FN = "smooth-worker";
const AI_WAIT = 45000;     // ms the AI may take before the search goes on without it
const CMP_WAIT = 80000;    // ms the online check (Google search + photos of the likely trails) may take; the list shows meanwhile
const AI_SIDE = 1024;       // the copy sent to the AI and saved with a confirmed match
  const SEE_M = 12000;        // trails up to this far from a landmark are checked for a view of it
  // The accuracy test (scripts/photo-find-test.mjs) sets window.tfPhotoTest = { skip: [match ids] } before the page loads:
  // that confirmed match (the test's own photo) is left out of every lookup, and each finished search is put in .result.
  const TEST = window.tfPhotoTest && Array.isArray(window.tfPhotoTest.skip) ? window.tfPhotoTest : null;
  const skipIds = TEST ? TEST.skip.filter((n) => Number.isSafeInteger(n)) : [];
  const testDone = (rows) => { if (TEST) TEST.result = { rows: rows.map((r) => ({ name: r.name, zone: r.save ? r.save.zone : r.zone, conf: r.conf })), ai: $("pfAi").textContent, cmp: $("pfCmp").textContent }; };
  const testEnd = (my) => { if (TEST && my === job) { testDone(shown); TEST.finished = Date.now(); } };
  const DEM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

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
.pf .pf-tw { position: relative; flex: none; }
.pf .pf-rm { position: absolute; top: -8px; right: -8px; width: 28px; height: 28px; border-radius: 50%; border: 1px solid var(--line); background: var(--panel); color: var(--fg); font: inherit; font-weight: 700; line-height: 1; cursor: pointer; box-shadow: var(--shadow-sm); }
.pf .pf-res .pv { font-size: .78rem; margin-top: 3px; display: flex; gap: 10px; flex-wrap: wrap; }
.pf .pf-res .pv a { color: var(--accent); text-decoration: none; font-weight: 600; }
.pf .pf-ai { font-size: .85rem; margin: 10px 0 0; padding: 8px 10px; border-radius: 10px; background: var(--chip); }
.pf .pf-ai[hidden] { display: none; }
.pf .pf-ai .src { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; font-size: .78rem; }
.pf .pf-ai .src a, .pf .pf-res .pw a { color: var(--accent); text-decoration: none; font-weight: 600; }
.pf .pf-ai iframe { display: block; width: 100%; height: 44px; border: 0; margin-top: 6px; }
.pf .pf-res .pw { display: flex; gap: 8px; align-items: center; font-size: .78rem; margin-top: 4px; }
.pf .pf-res .pw img { width: 72px; height: 44px; object-fit: cover; border-radius: 6px; flex: none; background: var(--line); }
.pf-ask { position: fixed; z-index: 1000; left: 50%; top: calc(12px + env(safe-area-inset-top)); transform: translateX(-50%); display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px;
  max-width: calc(100% - 24px); box-sizing: border-box; padding: 8px 12px; border-radius: 12px; background: var(--panel); color: var(--fg); border: 1px solid var(--line); box-shadow: var(--shadow); font-size: .9rem; }
.pf-ask[hidden] { display: none; }
.pf-ask .btn { padding: 6px 12px; }
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
  <p class="pf-hint">A photo, a screenshot of a post or a video of up to ${VIDEO_MAX_S} seconds. With the spot where it was taken, you get that trail. Without it, the app reads the words in it (trail names, places, hashtags, Strava or Trailforks labels) and lists the likely trails. The words are read on your device; to place the picture, a copy goes to Google's AI (Gemini) and Google's image search, which may keep it. “Yes, that's it” saves a small copy for Trail Finder to learn from (never shown in the app).</p>
  <div class="pf-drop" id="pfDrop">
    <button type="button" class="btn primary" id="pfPick">Choose a photo or short video</button>
    <button type="button" class="btn" id="pfPaste" hidden>📋 Paste a screenshot</button>
    <span class="pf-or">or drop one here${matchMedia("(pointer: fine)").matches ? ", or press Ctrl+V / ⌘V" : ""}</span>
    <input type="file" id="pfFile" accept="image/*,video/*" hidden>
  </div>
  <div class="pf-prev" id="pfPrev" hidden><span class="pf-tw"><span id="pfThumb"></span><button type="button" class="pf-rm" id="pfRemove" aria-label="Remove this picture to add another" title="Remove this picture" hidden>✕</button></span><div style="flex:1;min-width:0"><div class="pf-status" id="pfStatus" role="status"></div><div class="pf-bar" id="pfBar" hidden><span></span></div></div></div>
  <ul class="pf-res" id="pfRes" role="list"></ul>
  <p class="pf-note" id="pfNote"></p>
  <p class="pf-ai" id="pfAi" hidden></p>
  <div class="pf-ai" id="pfCmp" role="status" hidden></div>
  <label class="pf-l" for="pfArea">Where is it? <small>(optional, helps when the picture has no spot)</small></label>
  <select id="pfArea"></select>
  <label class="pf-l" for="pfCaption">What do you see? <small>(optional: describe it, or paste the post's caption)</small></label>
  <textarea id="pfCaption" placeholder="Like: big granite wall behind (the Chief?), rooty forest, lake below, slabs. Or a trail or place name you saw." spellcheck="false"></textarea>
  <details id="pfReadBox" hidden><summary>Words read from the picture</summary><textarea id="pfRead" spellcheck="false" aria-label="Words read from the picture (you can fix them)"></textarea></details>
  <div class="pf-go"><button type="button" class="btn" id="pfGo">Find the trail</button><button type="button" class="btn" id="pfWords" hidden>Read the words instead</button></div>
</div>`;
  document.body.append(box);
  const ask = document.createElement("div");
  ask.className = "pf-ask"; ask.id = "pfAsk"; ask.hidden = true; ask.setAttribute("role", "status");
  document.body.append(ask);

  F.regions.forEach((r) => { if (!r.zones) r.zones = F.zones.filter((z) => r.ids.includes(z.id)); });
  $("pfArea").innerHTML = `<option value="">Anywhere (I don't know)</option>` + F.regions.map((r) => `<optgroup label="${esc(r.name)}"><option value="r:${r.id}">All of ${esc(r.name)}</option>` +
    r.zones.map((z) => `<option value="${z.id}">${esc(z.name)}</option>`).join("") + `</optgroup>`).join("");

  // ---------- open / close ----------
  let job = 0, file = null, gpsSpot = null, pin = null, thumbUrl = null;
  let lastText = "";        // the words the last search matched, saved with a confirmed match
  let media = null;          // { jpegs: [base64...] } small copies of the picture or frames, for the AI and for saving
  let ai = null, aiKey = "", aiOff = false, aiSlow = 0;   // the AI's answer for this picture; aiOff: the function isn't set up
  let cmp = null, cmpKey = "";                            // the online check's answer for this picture and list
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
    } catch { say("The browser didn't allow pasting. Use Choose a photo or short video instead."); }
  });
  const isMedia = (f) => /^(image|video)\//.test(f.type) || /\.(heic|heif|jpe?g|png|webp|mov|mp4|m4v)$/i.test(f.name || "");
  const isVideo = (f) => /^video\//.test(f.type) || /\.(mov|mp4|m4v)$/i.test(f.name || "");

  function say(msg, frac) {
    $("pfPrev").hidden = false;
    $("pfStatus").textContent = msg;
    $("pfBar").hidden = frac == null;
    if (frac != null) $("pfBar").firstElementChild.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + "%";
  }

  // ✕ on the picture: forget it (and what came from it) to add another one; the description and area stay.
  function reset() {
    job++;
    file = null; gpsSpot = null; media = null; ai = null; aiKey = ""; cmp = null; cmpKey = "";
    box.classList.remove("has-file");
    if (thumbUrl) { URL.revokeObjectURL(thumbUrl); thumbUrl = null; }
    if (pin) { pin.remove(); pin = null; }
    $("pfThumb").innerHTML = ""; $("pfRemove").hidden = true; $("pfPrev").hidden = true;
    $("pfRes").innerHTML = ""; $("pfNote").textContent = ""; $("pfAi").hidden = true; $("pfCmp").hidden = true; $("pfRead").value = ""; $("pfReadBox").hidden = true; $("pfWords").hidden = true;
    shown = [];
  }
  $("pfRemove").addEventListener("click", () => { reset(); $("pfPick").focus(); });

  async function start(f) {
    reset();
    file = f;
    box.classList.add("has-file");
    $("pfRemove").hidden = false;
    const my = job;
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    thumbUrl = URL.createObjectURL(f);
    $("pfThumb").innerHTML = isVideo(f) ? `<video src="${thumbUrl}#t=0.5" muted playsinline preload="metadata"></video>` : `<img src="${thumbUrl}" alt="">`;
    if (isVideo(f)) {
      const long = f.size > VIDEO_MAX_MB * 1e6 ? "too big" : (await videoLength(thumbUrl)) > VIDEO_MAX_S + 0.5 ? "too long" : "";
      if (my !== job) return;
      if (long) {
        say(`This video is ${long}: videos can be up to ${VIDEO_MAX_S} seconds. Trim it, or add a screenshot of the best moment instead.`);
        return;
      }
    }
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
      zone: F.zoneOf(L.latLng(p)),
      save: { name: r.name || "Unnamed trail", type: "way", ids: r.g ? r.g.items.map((i) => i.id) : [r.x.w.id], zone: (F.zones.find((z) => z.bounds.contains(L.latLng(p))) || { id: F.zoneOf(L.latLng(p)) }).id, c: p, method: "gps" },
    }));
    map.setView(p, Math.max(map.getZoom(), 15));
    if (my !== job) return;
    say(rows.length ? "Found from the spot where it was taken." : "No MTB trail near the spot where it was taken.");
    show(res, close.length ? "" : rows.length ? `No MTB trail within ${NEAR_M} m of the spot, so these are the nearest ones. The 📷 pin on the map shows where it was taken.`
      : "The 📷 pin on the map shows where it was taken. It may be on a path the app doesn't count as an MTB trail: tap it on the map.");
    testEnd(my);
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
  // A video's length in seconds (0 when the browser can't tell: then its size limit is enough).
  async function videoLength(src) {
    const v = document.createElement("video");
    v.muted = true; v.preload = "metadata"; v.src = src;
    const d = await new Promise((res) => { const t = setTimeout(() => res(0), 8000); v.addEventListener("loadedmetadata", () => { clearTimeout(t); res(v.duration); }, { once: true }); v.addEventListener("error", () => { clearTimeout(t); res(0); }, { once: true }); });
    v.removeAttribute("src"); v.load();
    return Number.isFinite(d) ? d : 0;
  }
  // A few frames spread through the video (text on a video often shows for only a second or two).
  async function videoFrames(src, my) {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = src;
    const wait = (ev, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error("timeout")), ms); v.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true }); });
    await wait("loadeddata", 15000);
    const dur = v.duration && Number.isFinite(v.duration) ? v.duration : 0;
    const n = dur < 1.5 ? 1 : VIDEO_FRAMES, out = [];
    for (let i = 0; i < n; i++) {
      if (my !== job) break;
      const t = n === 1 ? Math.min(dur / 2, 0.5) : dur * (0.06 + 0.88 * i / (n - 1));
      try { v.currentTime = t; await wait("seeked", 6000); out.push(toCanvas(v, v.videoWidth, v.videoHeight)); } catch {}
    }
    v.removeAttribute("src"); v.load();
    return out;
  }
  // A small JPEG of a picture or frame (base64, no header), for the AI and for a saved match.
  // A 64-bit fingerprint of the picture (difference hash): the same picture, resized or recompressed, gives nearly the
  // same one. Saved with a confirmed match so the same picture later finds that trail.
  function dhash(c) {
    const s = document.createElement("canvas");
    s.width = 9; s.height = 8;
    const x = s.getContext("2d", { willReadFrequently: true });
    x.drawImage(c, 0, 0, 9, 8);
    const d = x.getImageData(0, 0, 9, 8).data, g = (i) => d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
    let out = "";
    for (let y = 0; y < 8; y++) {
      let n = 0;
      for (let i = 0; i < 8; i++) n = (n << 1) | (g(y * 9 + i) > g(y * 9 + i + 1) ? 1 : 0);
      out += n.toString(16).padStart(2, "0");
    }
    s.width = s.height = 0;
    return out;
  }
  const hamming = (a, b) => {
    if (a.length !== b.length) return 99;
    let n = 0;
    for (let i = 0; i < a.length; i += 2) { let v = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16); while (v) { n += v & 1; v >>= 1; } }
    return n;
  };
  function jpeg(c) {
    const k = Math.min(1, AI_SIDE / Math.max(c.width, c.height)), s = document.createElement("canvas");
    s.width = Math.round(c.width * k); s.height = Math.round(c.height * k);
    s.getContext("2d").drawImage(c, 0, 0, s.width, s.height);
    const url = s.toDataURL("image/jpeg", 0.8);
    s.width = s.height = 0;
    return url.slice(url.indexOf(",") + 1);
  }
  async function readWords(my) {
    const canvases = isVideo(file) ? await videoFrames(thumbUrl, my) : [await imageCanvas(thumbUrl)];
    if (!canvases.length) throw new Error("no frames could be taken from the video");
    // Up to 3 frames spread through the video (the middle ones), or the picture.
    const pick = canvases.length <= 3 ? canvases : [canvases[1], canvases[Math.floor(canvases.length / 2)], canvases[canvases.length - 2]];
    media = { jpegs: pick.map(jpeg), hash: dhash(pick[0]) };
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
  // The AI looks at the picture (supabase/functions/which-trail). null when it isn't set up, fails, is too slow or has
  // nothing; aiWhy then says why, shown under the picture so a screenshot tells what went wrong.
  let aiWhy = "";
  async function askAI(my, read) {
    aiWhy = "";
    const acct = window.tfAccount;
    if (aiOff || !media || !media.jpegs.length || !acct || !acct.enabled) return null;
    const area = $("pfArea").selectedOptions[0];
    const key = [$("pfCaption").value.trim(), $("pfArea").value].join("|");
    if (ai && aiKey === key) return ai;      // once per picture and description: the free AI allows only so many a day
    say(`The AI is looking at the picture (mountains, rock, lakes, words)… up to ${AI_WAIT / 1000} s`, 0.9);
    const look = async () => {
      await acct.load();
      if (!acct.client) return null;
      const lm = (await landmarkList()).map((l) => l.name);
      const { data, error } = await acct.client.functions.invoke(AI_FN, { timeout: AI_WAIT, body: {
        images: media.jpegs, text: read.slice(0, 2000), description: $("pfCaption").value.slice(0, 800), area: $("pfArea").value ? area.textContent : "", landmarks: lm } });
      if (error) {
        const st = error.context && error.context.status;
        let msg = "";
        try { msg = (await error.context.json()).error || ""; } catch { /* not JSON */ }
        const plain = { 401: "the function still has Verify JWT on", 404: "not set up yet", 546: "the function ran out of time", 504: "too slow" };
        aiWhy = msg || (st ? plain[st] || "error " + st : error.name === "AbortError" || /abort/i.test(error.message || "") ? "too slow" : error.message || "failed");
        if (st === 404 || st === 503 || /Failed to send/i.test(error.message || "")) aiOff = true;   // not set up (or key refused): don't ask again this visit
        return null;
      }
      if (!data || !data.ok) { aiWhy = "it found nothing it could name"; return null; }
      return data;
    };
    // A hard stop too, in case loading the account library or the network hangs.
    const late = new Promise((res) => setTimeout(() => res("late"), AI_WAIT + 2000));
    const got = await Promise.race([look().catch((e) => { aiWhy = e && e.message || "failed"; return null; }), late]);
    if (my !== job) return null;
    if (got === "late") { aiWhy = "too slow"; aiSlow++; if (aiSlow >= 2) aiOff = true; return null; }
    if (got) { ai = got; aiKey = key; }
    return got;
  }
  async function byWords(my, read) {
    if (pin && !gpsSpot) { pin.remove(); pin = null; }
    // A new search: last search's list, note and AI line go, so nothing stale shows while this one runs.
    shown = []; $("pfRes").innerHTML = ""; $("pfNote").textContent = ""; $("pfAi").hidden = true; $("pfCmp").hidden = true;
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
    const seen = file ? await askAI(my, $("pfRead").value) : null;
    if (my !== job) return;
    // The pages that show the same picture online (reverse image search): their titles and addresses count like a caption.
    const on = seen && seen.online, pages = on && Array.isArray(on.pages) ? on.pages : [];
    const rev = pages.map((p) => { let path = ""; try { const u = new URL(p.url); path = decodeURIComponent(u.pathname + " " + (u.searchParams.get("v") ? "" : u.search)); } catch {} return p.title + "\n" + path.replace(/[-_/.+=&?]+/g, " "); })
      .concat(on ? [...(on.labels || []), ...(on.entities || [])] : []).join("\n");
    $("pfAi").hidden = !seen && !aiWhy;
    $("pfAi").textContent = seen && !seen.scene && pages.length ? "" : seen ? `The AI sees${seen.ms ? ` (${Math.round(seen.ms / 1000)} s)` : ""}: ` + seen.scene + (seen.landmarks.length ? ` Landmarks: ${seen.landmarks.join(", ")}.` : "") + (seen.viewpoint && seen.viewpoint.where ? ` Taken around: ${seen.viewpoint.where}.` : "")
      : aiWhy ? `AI check skipped (${aiWhy}): matching the words, your description and landmarks.` : "";
    // Where the same picture is online: a link to each page (the rider can read the post there).
    if (pages.length || (on && on.error)) {
      const box = document.createElement("div");
      box.className = "src";
      box.innerHTML = pages.length ? `Same picture found online: ` + pages.slice(0, 5).map((p) => { let h = "page"; try { h = new URL(p.url).hostname.replace(/^www\./, ""); } catch {} return `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" title="${esc(p.title)}">${esc(h)}</a>`; }).join(" ")
        : esc(`Reverse image search skipped (${on.error}).`);
      $("pfAi").append(box);
      $("pfAi").hidden = false;
    }
    // The AI's places and landmarks first, then the trail names it read or guessed (so a hit there says "AI named it").
    const aiSaw = seen ? [...seen.places, ...seen.landmarks].join("\n") : "";
    // Only names the AI read in the picture count as named: its own guesses just lift a trail already listed (below).
    const aiNames = seen ? seen.trail_names.join("\n") : "";
    const own = [$("pfCaption").value, $("pfRead").value].join("\n"), text = [own, rev, aiSaw, aiNames].join("\n");
    // Saved with a confirmed match: the rider's and the picture's words, and what the AI saw (not its trail guesses).
    lastText = seen ? [own, ...seen.landmarks, ...seen.places, ...seen.terrain].join("\n") : own;
    if (!text.trim()) {
      say(file ? "No words found in it." : "Add a photo or video, or type what you know.");
      show([], "Paste the post's caption above, or type a trail or place name you saw, then tap Find the trail.");
      testEnd(my);
      return;
    }
    say("Matching the words with the trail names…", 0.95);
    let res;
    try { res = await match(text, my, seen, core(words([own, rev, aiSaw].join("\n"))).length, core(words(own + "\n" + rev)).length, rev.trim() ? core(words(own)).length : Infinity); } catch (e) { if (my === job) say(`Couldn't load the trail names (${e.message}).`); return; }
    if (!res || my !== job) return;
    const n = res.rows.length;
    const sure = n && res.rows[0].conf !== "Possible";
    say(n ? (sure ? "Likely trails, best first." : "Possible trails, best first.") : "No trail name found in the words.");
    const where = res.places.length ? `It mentions ${res.places.slice(0, 3).join(", ")}. ` : "";
    show(res.rows, n ? where + (sure ? "" : "None is a sure match: check the names against the post.")
      : where + "No trail name in the picture or caption matched a trail the app knows. Paste the caption, type a trail name you saw, or pick the area and try again.");
    if (n && seen) await compareOnline(my, res.rows, seen);
    testEnd(my);
  }

  // The online check (the function's "compare"): Google search on the likely trails (what riders and sites say they look
  // like), photos from those pages, geotagged photos near them and pictures riders confirmed, and (when the AI placed
  // the photo) pages, videos and geotagged photos from all around that spot, compared with this picture. The list is
  // already up; it's reordered when the answer comes, and trails where a close-looking photo was taken join it.
  // The AI's spot is often several km off (a slab 5 km from where it put the camera): look wide.
  const vpRadius = (vp) => Math.min(15, Math.max(6, vp.km * 2.5)) * 1000;
  async function compareOnline(my, rows, seen) {
    const acct = window.tfAccount, list = rows.filter((r) => r.save && r.name !== "Unnamed trail").slice(0, 8);
    const vp = seen.viewpoint && seen.viewpoint.km > 0 && seen.viewpoint.km <= 15 ? seen.viewpoint : null;
    if (aiOff || !list.length || !media || !acct || !acct.client) return;
    const out = $("pfCmp"), key = aiKey + "|" + list.map((r) => r.name + "@" + r.save.zone).join(",");
    let got = cmp && cmpKey === key ? cmp : null, why = "";
    if (!got) {
      out.hidden = false;
      out.textContent = `Searching Google for videos, photos and descriptions of ${list.length > 1 ? "these trails" : "this trail"}${vp ? " and of riding around where it seems taken" : ""} to compare with yours… up to ${CMP_WAIT / 1000} s`;
      const look = acct.client.functions.invoke(AI_FN, { timeout: CMP_WAIT, body: { mode: "compare", images: media.jpegs, scene: seen.scene, description: $("pfCaption").value.slice(0, 800),
        trails: list.map((r) => ({ name: r.name, area: r.zone, kind: r.kind, c: r.save.c })), spot: vp || undefined, skip: skipIds.length ? skipIds : undefined } }).then(async ({ data, error }) => {
        if (!error) return data;
        let msg = "";
        try { msg = (await error.context.json()).error || ""; } catch { /* not JSON */ }
        why = msg || (error.context && error.context.status === 546 ? "the function ran out of time" : "it failed");
        return null;
      }).catch(() => { why = "it failed"; return null; });
      got = await Promise.race([look, new Promise((res) => setTimeout(() => { why = "too slow"; res(null); }, CMP_WAIT + 2000))]);
      if (my !== job) return;
      if (got && got.ok) { cmp = got; cmpKey = key; }
    }
    if (!got || !got.ok) {
      out.hidden = false;
      out.textContent = `Online check skipped (${got ? got.why || got.noSearch || "found nothing" : why}).`;
      return;
    }
    // Each trail's fit (0-1) moves it up or down; a found photo of the same place counts extra, a picture a rider
    // confirmed more.
    const fitOf = new Map((got.ranks || []).map((k) => [F.norm(String(k.trail).replace(/^\s*\d+[.)]\s*/, "").replace(/\s*\(.*$/, "")), k]));
    let next = shown.map((r) => {
      const k = fitOf.get(F.norm(r.name));
      return k ? { ...r, s: r.s + 0.4 * (k.fit - 0.5) + (k.photo ? 0.1 : 0) + (k.confirmed && k.fit >= 0.6 ? 0.15 : 0), web: k } : r;
    });
    // Photos from around the spot that look close, even if not the same place: the trails where they were taken (or the
    // one their page is about) go up, or join the list.
    const around = vp && (got.close || []).length ? (await trailsNear([L.latLng(vp.lat, vp.lon)], vpRadius(vp))).list : [];
    const found = [];
    for (const c of got.close || []) {
      let gs = c.trail ? around.filter((g) => F.norm(g.name) === F.norm(c.trail)).slice(0, 1) : [];
      if (!gs.length && c.confirmed && c.trail && c.at) gs = (await trailsNear([L.latLng(c.at[0], c.at[1])], 600)).list.filter((g) => F.norm(g.name) === F.norm(c.trail)).slice(0, 1);
      if (!gs.length && c.at) gs = (await trailsNear([L.latLng(c.at[0], c.at[1])], 600)).list.slice(0, 2);
      if (my !== job) return;
      const why = c.confirmed ? `${c.close >= 0.8 ? "looks like the same place as" : "looks close to"} a picture a rider confirmed on it`
        : `${c.close >= 0.8 ? "an online photo of the same place" : "an online photo that looks close"}${c.at ? " was taken near it" : ""}`;
      for (const [i, g] of gs.entries()) {
        const web = { fit: c.close, why: c.why || why, photo: { img: c.img, page: c.page, title: c.title }, close: true };
        const have = next.find((r) => F.norm(r.name) === F.norm(g.name) && r.save && r.save.zone === g.zone.id);
        // A photo the AI calls the same place puts its trail at the top.
        const top = c.close >= 0.8 ? Math.max(...next.map((r) => r.s), STRONG) + 0.05 - 0.06 * i : 0;   // the nearest trail first
        if (have) { if (!have.closeBy) { have.s = Math.max(have.s + 0.3 * c.close, top); have.closeBy = true; have.meta += " · " + why; if (!have.web || !have.web.photo) have.web = web; } }
        else next.push({ ...rowOf({ g, s: Math.max(0.45 + 0.45 * c.close, top), why: [why] }, "mixed"), web, closeBy: true });
        found.push(g.name);
      }
    }
    next = next.sort((a, b) => b.s - a.s).slice(0, 10);
    const top = next.length ? next[0].s : 0;
    next.forEach((r, i) => {
      r.best = i === 0 && r.s >= STRONG && (next.length === 1 || next[1].s <= r.s - 0.049);
      r.conf = r.best ? "Best match" : r.s >= top - 0.05 && r.s >= STRONG ? "Likely" : "Possible";
    });
    show(next, $("pfNote").textContent);
    say(next[0].best ? "Likely trails, best first (checked online)." : "Possible trails, best first (checked online).");
    const src = (got.sources || []).map((w) => `<a href="${esc(w.uri)}" target="_blank" rel="noopener">${esc(w.title || "page")}</a>`).join("");
    out.innerHTML = `Checked online${got.ms ? ` (${Math.round(got.ms / 1000)} s)` : ""}: ${got.searched ? "Google search" : "no Google search" + (got.noSearch ? ` (${esc(got.noSearch)})` : "")}` +
      `${got.photos ? `, ${got.photos} photo${got.photos > 1 ? "s" : ""} compared with yours${got.area ? ` (${got.area} from around where it seems taken)` : ""}` : ""}.` +
      ` ${found.length ? `Close-looking photos point to: ${esc([...new Set(found)].join(", "))}.` : vp ? "No photo from around there looked close." : ""}` +
      (src ? `<div class="src">${src}</div>` : "") +
      // Google asks for its search suggestions to be shown wherever search results are used.
      (got.suggest ? `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" title="Google searches used" srcdoc="${esc(got.suggest)}"></iframe>` : "");
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
    "wet dry dust dusty mud muddy easy hard green blue black double pro official unofficial new old first last big little long short high low great awesome epic sick " +
    // everyday words in a description ("it looks like ..., we can see ...")
    "look looks looking see seen seeing think maybe there here this that these those with from have picture photo pic pics image behind front just really kind sort " +
    "probably somewhere around where what which could would should they them their your very much also about over under near close far left right").split(" "));
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
  async function match(text, my, aiSeen, aiFrom = Infinity, aiSawFrom = Infinity, revFrom = Infinity) {   // first trail-name word / first word from the AI / first word from pages with the same picture
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
    let hinted = new Set(found.flatMap((p) => p.zones.map((z) => z.id)));
    let spots = found.filter((p) => p.c);
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
      why.unshift(t.hit.at >= aiFrom ? "AI named it" : t.hit.at >= aiSawFrom ? `AI saw “${said}”` : t.hit.at >= revFrom ? "named on a page with the same picture" : t.hit.how === "tag" || t.ws !== g.ws ? `“${said}” is in the words` : t.hit.d ? `read as “${said}”` : `“${g.name}” is in the words`);
      return { g, s, why, said: said.replace(/ /g, "") };
    }).filter((h) => h.s >= 0.7);
    let hits = scored(raw);
    // Nothing sure in the areas looked at first (and no area picked): look through every region too.
    if (!picked.length && !hits.some((h) => h.s >= STRONG)) {
      say("Looking through every region…", 0.97);
      const rest = await textHits(F.zones.filter((z) => !first.includes(z)));
      if (my !== job) return null;
      raw = raw.concat(rest);
      // A trail name found in another region can hold a "place" too ("Nelson" in Squamish's "Half Nelson").
      if (found.some((p) => inName(p, raw))) {
        found = found.filter((p) => !inName(p, raw));
        hinted = new Set(found.flatMap((p) => p.zones.map((z) => z.id)));
        spots = found.filter((p) => p.c);
      }
      hits = scored(raw);
    }
    // Landmarks named in the words (or by the AI), or described ("granite wall") in an area it points to: the trails
    // that can see them. A trail found by name and also seeing the landmark goes up; one only seeing it is "Possible".
    const areaZones = new Set([...pickedIds, ...hinted]);
    const named = [], looked = [];
    // A riding area named in the words ("alice lake trails") means the trails there, not a view of it, unless the AI saw
    // that landmark in the picture.
    const areas = found.filter((p) => p.c), aiLm = new Set(aiSeen ? aiSeen.landmarks.map((n) => F.norm(n)) : []);
    (await landmarkList()).forEach((l) => {
      if (areas.some((p) => F.norm(p.label) === F.norm(l.name)) && !aiLm.has(F.norm(l.name))) return;
      if ([l.ws, ...l.akaWs].some((ws) => findIn(tokens, ws, joins))) named.push(l);
      else if (areaZones.size && l.zones.some((id) => areaZones.has(id))) {
        // Described, not named: the landmark whose description fits best ("big granite wall" beats "granite").
        const fit = l.looksWs.filter((ws) => findIn(tokens, ws, joins)).reduce((m, ws) => Math.max(m, ws.join("").length), 0);
        if (fit) looked.push({ l, fit });
      }
    });
    looked.sort((a, b) => b.fit - a.fit);
    const used = [...named.map((l) => ({ l, base: 0.8 })), ...looked.filter((x) => x.fit === looked[0].fit).slice(0, 2).map((x) => ({ l: x.l, base: 0.6 }))].slice(0, 3);
    // A trail named like a landmark it mentions ("The Chief") is weaker as a trail.
    // Same when only the landmark's name matched in a longer trail name ("Stawamus Chief / Sea to Summit").
    hits.forEach((h) => { if (named.some((l) => [l.ws, ...l.akaWs].some((ws) => ws.join("") === h.g.ws.join("") || ws.join("") === h.said))) h.s -= 0.2; });
    const keyOf = (g) => g.ws.join(" ") + "|" + g.zone.id;
    for (const { l, base } of used) {
      say(`Checking which trails can see ${l.name}…`, 0.98);
      const views = await viewers(l);
      if (my !== job) return null;
      for (const v of views) {
        const have = hits.find((h) => keyOf(h.g) === keyOf(v.g));
        const why = `${v.vis ? "sees" : "near"} ${l.name} (${(v.d / 1000).toFixed(1)} km)`;
        if (have) { have.s += v.vis ? 0.15 : 0.05; have.why.push(why); }
        // In the background: a few hundred metres to several km away reads best; right under it, less so.
        else if (v.vis) hits.push({ g: v.g, s: Math.min(STRONG - 0.06, base + 0.1 * (l.water ? Math.min(1, v.angle * 5) : v.d < 500 ? 0.3 : Math.max(0, 1 - v.d / 8000))), why: [why], lm: true });
      }
    }
    // Where the AI thinks the photo was taken (from the background): the trails around that spot.
    const vp = aiSeen && aiSeen.viewpoint;
    if (vp && vp.km > 0 && vp.km <= 15) {
      // The AI's "how far off" is often too small: look a bit wider.
      const R = vpRadius(vp), spot = L.latLng(vp.lat, vp.lon);
      say("Looking at the trails where the AI places the photo…", 0.985);
      const { list } = await trailsNear([spot], R);
      if (my !== job) return null;
      for (const g of list.slice(0, 60)) {
        const why = `where the AI places the photo${vp.where ? " (" + vp.where + ")" : ""}, ${(g.d / 1000).toFixed(1)} km`;
        const have = hits.find((h) => keyOf(h.g) === keyOf(g)), near = 1 - g.d / R;
        if (have) { have.s += 0.1 + 0.1 * near; have.why.push(why); }
        else hits.push({ g, s: 0.7 + 0.15 * near, why: [why], lm: true });
      }
      // Pictures riders confirmed around there: their trails join the list (or go up), and the online check then
      // compares those pictures with this one.
      for (const m of await pastMatches()) {
        if (typeof m.lat !== "number" || typeof m.lon !== "number" || !Array.isArray(m.osm_ids) || !m.osm_ids.length) continue;
        const d = spot.distanceTo([m.lat, m.lon]);
        if (d > R) continue;
        const g = pastGroup(m), have = hits.find((h) => keyOf(h.g) === keyOf(g)), why = "a rider confirmed a picture of it near there";
        if (have) { if (!have.why.includes(why)) { have.s += 0.1; have.why.push(why); } }
        else hits.push({ g, s: 0.72 + 0.1 * (1 - d / R), why: [why], lm: true });
      }
      if (my !== job) return null;
    }
    // The trails in a riding area named in the words.
    for (const p of areas.slice(0, 2)) {
      const { list } = await trailsNear([p.c], AREA_M);
      if (my !== job) return null;
      for (const g of list.slice(0, 30)) {
        const why = `in the ${p.label} riding area (${(g.d / 1000).toFixed(1)} km)`, have = hits.find((h) => keyOf(h.g) === keyOf(g));
        if (have) { if (!have.why.includes(why)) { have.s += 0.05; have.why.push(why); } }
        else hits.push({ g, s: 0.55 + 0.15 * (1 - g.d / AREA_M), why: [why], lm: true });
      }
    }
    // Slabs or bare rock in the picture: trails mapped on bare rock go up.
    const rockSaid = /\b(slabs?|granite|bare rock|rock face|rock rolls?|rock slabs?)\b/i.test([$("pfCaption").value, $("pfRead").value, ...(aiSeen ? [...aiSeen.terrain, aiSeen.scene] : [])].join(" "));
    if (rockSaid) hits.forEach((h) => {
      if ([h.g.tags, ...h.g.items.map((i) => i.tags)].some((t) => t && /^(bare_)?rock$/.test(t.surface || ""))) { h.s += 0.15; h.why.push("mapped on bare rock"); }
    });
    // The AI's own guesses go up a little.
    if (aiSeen) {
      const guess = new Set([...aiSeen.trail_names, ...aiSeen.guesses.map((g) => g.trail)].map((n) => core(words(n)).join(" ")));
      hits.forEach((h) => { if (guess.has(h.g.ws.join(" ")) && !h.why.includes("AI named it")) { h.s += 0.1; h.why.push("AI thinks so too"); } });
    }
    // Past confirmed matches with similar words (supabase/trail-matches.sql) lift their trail.
    const rare = new Set(tokens.filter((t) => t.length >= 4 && !GENERIC.has(t)));
    const placey = new Set([...found.flatMap((p) => p.ws), ...(await landmarkList()).flatMap((l) => [...l.ws, ...l.akaWs.flat()])]);
    // A plain or nearly plain picture has a fingerprint like any other plain one: not used.
    const picHash = file && media && media.hash && Math.abs(hamming(media.hash, "0".repeat(16)) - 32) <= 24 ? media.hash : null;
    // The same picture (or nearly) was confirmed before: that trail. The function compares the fingerprints (the site
    // can't read them).
    for (const m of picHash ? await samePicture(picHash) : []) {
      if (!Array.isArray(m.osm_ids) || !m.osm_ids.length) continue;
      const g = pastGroup(m);
      const have = hits.find((h) => keyOf(h.g) === keyOf(g)), why = "same picture as one confirmed before";
      if (have) { if (!have.why.includes(why)) { have.s = Math.max(have.s, STRONG + 0.15) + 0.1; have.why.unshift(why); have.past = true; } }
      else hits.push({ g, s: STRONG + 0.25, why: [why], past: true });
    }
    for (const m of rare.size >= 2 ? await pastMatches() : []) {
      const ws = (m.words || "").split(" ").filter((w) => w && !GENERIC.has(w)), both = ws.filter((w) => rare.has(w)), shared = both.length;
      if (shared < 2 || shared / Math.min(ws.length, rare.size) < 0.3) continue;
      const onlyPlaces = both.every((w) => placey.has(w));
      const g = pastGroup(m);
      const have = hits.find((h) => keyOf(h.g) === keyOf(g));
      // Sharing only place or landmark names ("squamish", "howe sound") says nothing: every photo there shares them.
      if (onlyPlaces) continue;
      if (have) { if (!have.past) { have.s += 0.2; have.past = true; have.why.push("picked for similar words before"); } }
      else hits.push({ g, s: 0.85, why: ["picked for similar words before"], past: true });
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
        const best = i === 0 && h.s >= STRONG && (rows.length === 1 || rows[1].s <= h.s - 0.049);
        return { ...rowOf(h, h.lm ? "landmark" : aiSeen ? "mixed" : "words"), best, conf: best ? "Best match" : h.s >= top - 0.05 && h.s >= STRONG ? "Likely" : "Possible" };
      }),
    };
  }
  // A trail group from a confirmed match (trail_matches row).
  // Older matches found by GPS saved the area's name, not its id: both lead to the same zone (so the trail isn't listed twice).
  function pastGroup(m) {
    const named = (z) => z.name === m.zone || z.name.split(" (")[0] === m.zone;
    const zone = F.zoneById(m.zone) || F.zones.find(named) || (typeof m.lat === "number" && F.zones.find((z) => z.bounds.contains([m.lat, m.lon]))) || { id: m.zone || "?", name: m.zone || "" };
    return { name: m.trail_name, type: m.osm_type === "relation" ? "r" : "w", ws: core(words(m.trail_name)), alts: [], tags: { name: m.trail_name }, zone, center: L.latLng(m.lat || 0, m.lon || 0),
      items: m.osm_ids.map((id) => ({ t: m.osm_type === "relation" ? "r" : "w", id, c: [m.lat, m.lon], tags: {} })) };
  }
  // A list row for a found trail group (h: { g, s, why }).
  function rowOf(h, method) {
    const g = h.g, fg = { name: g.name, type: g.type, kind: F.kindOf(g.tags, g.type === "r"), tags: g.tags, zone: g.zone.name.split(" (")[0], center: g.center, items: g.items };
    return { name: g.name, tags: g.tags, s: h.s, kind: fg.kind, why: h.why, meta: [fg.kind, fg.zone, ...h.why].filter(Boolean).join(" · "), open: () => F.show(fg), zone: fg.zone,
      save: { name: g.name, type: g.type === "r" ? "relation" : "way", ids: g.items.map((i) => i.id).slice(0, 60), zone: g.zone.id, c: [g.center.lat, g.center.lng], method } };
  }

  // ---------- landmarks and what can see them ----------
  let landmarks = null;
  const WATER = /\b(lake|inlet|sound|river|strait|arm|canyon|valley|falls|skyline|island)\b/i;
  function landmarkList() {
    if (!landmarks) landmarks = F.nightly("landmarks.json").then((f) => ((f && f.items) || []).map((l) => {
      const c = L.latLng(l.c);
      // A long lake or sound has several spots along it (pts); a peak has one.
      const pts = (l.pts && l.pts.length ? l.pts : [l.c]).map((p) => L.latLng(p));
      return { ...l, pts, ws: core(words(l.name)), akaWs: l.aka.map((a) => core(words(a))).filter((w) => w.join("").length >= 4), looksWs: l.looks.map((a) => core(words(a))),
        zones: F.zones.filter((z) => pts.some((q) => z.bounds.pad(0.3).contains(q)) || z.bounds.pad(0.3).contains(c)).map((z) => z.id), water: WATER.test(l.name) };
    })).catch(() => []);
    return landmarks;
  }
  // Elevation tiles (Terrarium, about 50 m a pixel at zoom 11), kept for the visit.
  const DEM_Z = 11, demTiles = new Map();
  const tileOf = (lat, lon) => {
    const n = 2 ** DEM_Z, r = lat * Math.PI / 180;
    return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n];
  };
  function demTile(x, y) {
    const k = x + "/" + y;
    if (!demTiles.has(k)) demTiles.set(k, new Promise((res) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = c.height = 256;
        const g = c.getContext("2d"); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, 256, 256).data, h = new Float32Array(256 * 256);
        for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        c.width = c.height = 0;
        demTiles.set(k, h); res(h);
      };
      img.onerror = () => { demTiles.set(k, null); res(null); };
      img.src = DEM(DEM_Z, x, y);
    }));
    return demTiles.get(k);
  }
  async function demLoad(b) {
    const [x0, y0] = tileOf(b.getNorth(), b.getWest()), [x1, y1] = tileOf(b.getSouth(), b.getEast()), jobs = [];
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let y = Math.floor(y0); y <= Math.floor(y1); y++) jobs.push(demTile(x, y));
    await Promise.all(jobs);
  }
  function elev(lat, lon) {
    const [fx, fy] = tileOf(lat, lon), x = Math.floor(fx), y = Math.floor(fy), h = demTiles.get(x + "/" + y);
    if (!h || h instanceof Promise) return null;
    return h[Math.min(255, Math.floor((fy - y) * 256)) * 256 + Math.min(255, Math.floor((fx - x) * 256))];
  }
  // The top of a mountain: the highest pixel within about 1 km of its spot (the name's spot is often at its foot).
  function summit(c, water) {
    if (water) { const h = elev(c[0], c[1]); return h == null ? null : [c[0], c[1], h + 2]; }
    let best = null;
    for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
      const lat = c[0] + i * 0.0018, lon = c[1] + j * 0.0028, h = elev(lat, lon);
      if (h != null && (!best || h > best[2])) best = [lat, lon, h];
    }
    return best;
  }
  // Line of sight from a rider (2 m up) at p to the top, over the elevation tiles, with the earth's curve. The last
  // 250 m before the top don't count: seeing the upper part of a big rock or peak is seeing it.
  function sees(p, top) {
    const h0 = elev(p[0], p[1]);
    if (h0 == null) return false;
    const D = L.latLng(p).distanceTo([top[0], top[1]]);
    if (D < 300) return true;
    const a = h0 + 2, n = Math.min(160, Math.ceil(D / 60));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (D * (1 - t) < 250) break;
      const h = elev(p[0] + (top[0] - p[0]) * t, p[1] + (top[1] - p[1]) * t);
      if (h == null) continue;
      const bulge = (D * t) * (D * (1 - t)) / (2 * 6371000 * 1.13);
      if (h + bulge > a + (top[2] - a) * t + 1) return false;
    }
    return true;
  }
  // The named MTB trails within SEE_M of a landmark (of any of its spots), and whether any of their points can see it.
  // Peaks: nearest first. Water (a sound, a lake): the trails looking down on it most steeply first, as a "view over
  // the water" photo is taken from high above it, not from the shore.
  // The named MTB trails within R metres of any of the spots, nearest first (d: metres from the nearest spot).
  async function trailsNear(spots, R) {
    let b = L.latLngBounds(spots);
    b = L.latLngBounds(b.getSouthWest().toBounds(2 * R).getSouthWest(), b.getNorthEast().toBounds(2 * R).getNorthEast());
    const zones = F.zones.filter((z) => z.bounds.intersects(b));
    const lists = await Promise.all(zones.map((z) => F.mtbWays(z).catch(() => null)));
    const groups = new Map();
    lists.forEach((list, i) => (list || []).forEach((w) => {
      const name = w.tags.name || w.tags["mtb:name"];
      if (!name || w.geom.length < 2) return;
      const mid = w.geom[w.geom.length >> 1], d = Math.min(...spots.map((q) => q.distanceTo(mid)));
      if (d > R) return;
      const z = zones[i], key = F.norm(name) + "|" + z.id;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { name, type: "w", ws: core(words(name)), alts: [], items: [], tags: w.tags, zone: z, pts: [], d, mtb: true }));
      g.items.push({ t: "w", id: w.id, c: mid, tags: w.tags });
      g.pts.push(w.geom[0], mid, w.geom[w.geom.length - 1]);
      if (d < g.d) g.d = d;
    }));
    const list = [...groups.values()].sort((a, b) => a.d - b.d).slice(0, 150);
    list.forEach((g) => { g.center = L.latLng(g.items[0].c); });
    return { list, b };
  }
  async function viewers(l) {
    const spots = l.pts || [L.latLng(l.c)];
    const { list, b } = await trailsNear(spots, SEE_M);
    if (!list.length) return [];
    await demLoad(b);
    const tops = spots.map((q) => summit([q.lat, q.lng], l.water)).filter(Boolean);
    let shownVis = 0;
    const out = list.map((g) => {
      let vis = false, angle = 0;
      for (const p of g.pts.slice(0, 12)) for (const top of tops) {
        if (!sees(p, top)) continue;
        vis = true;
        const h = elev(p[0], p[1]), D = L.latLng(p).distanceTo([top[0], top[1]]);
        if (h != null && D > 0) angle = Math.max(angle, (h - top[2]) / D);
      }
      return { g, d: g.d, vis, angle };
    });
    if (l.water) out.sort((a, b) => (b.vis - a.vis) || (b.angle - a.angle));
    return out.filter((v) => !v.vis || shownVis++ < 8);   // the 8 best that see it (and all, to lift name matches)
  }

  // ---------- past confirmed matches, and saving a new one (supabase/trail-matches.sql) ----------
  let past = null;
  function pastMatches() {
    const acct = window.tfAccount;
    if (!acct || !acct.enabled) return Promise.resolve([]);
    if (!past) past = acct.load().then(() => acct.client ? acct.client.from("trail_matches").select("id, trail_name, osm_type, osm_ids, zone, lat, lon, words")
      .order("created_at", { ascending: false }).limit(500) : { data: [] }).then(({ data, error }) => (error ? [] : (data || []).filter((m) => !skipIds.includes(m.id)))).catch(() => []);
    return past;
  }
  async function samePicture(hash) {
    const acct = window.tfAccount;
    if (!acct || !acct.enabled || TEST) return [];   // the test's own photo would always match itself
    try {
      await acct.load();
      if (!acct.client) return [];
      const { data, error } = await acct.client.functions.invoke(AI_FN, { timeout: 8000, body: { mode: "same", hash } });
      return !error && data && Array.isArray(data.same) ? data.same : [];
    } catch { return []; }
  }
  async function ensureMedia() {
    if (media || !file) return media;
    try {
      const cs = isVideo(file) ? (await videoFrames(thumbUrl, job)).slice(0, 1) : [await imageCanvas(thumbUrl)];
      if (cs.length) media = { jpegs: cs.map(jpeg), hash: dhash(cs[0]) };
      cs.forEach((c) => { c.width = c.height = 0; });
    } catch {}
    return media;
  }
  async function saveMatch(r) {
    const acct = window.tfAccount, sv = r.save;
    if (!sv || !acct || !acct.enabled) return false;
    await acct.load();
    if (!acct.client) return false;
    let photo = null;
    const m = await ensureMedia();
    if (m && m.jpegs[0]) {
      const bin = atob(m.jpegs[0]), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const path = `${new Date().toISOString().slice(0, 7)}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error } = await acct.client.storage.from("trail-match-photos").upload(path, new Blob([bytes], { type: "image/jpeg" }), { contentType: "image/jpeg", upsert: false });
      if (!error) photo = path;
    }
    const keep = sv.method === "gps" ? [] : [...new Set(core(words(lastText)).filter((t) => t.length >= 4 && !GENERIC.has(t)))].slice(0, 40);
    const { error } = await acct.client.from("trail_matches").insert({
      trail_name: sv.name.slice(0, 120), osm_type: sv.type, osm_ids: sv.ids, zone: sv.zone ? String(sv.zone).slice(0, 60) : null,
      lat: sv.c ? +sv.c[0] : null, lon: sv.c ? +sv.c[1] : null, words: keep.join(" ").slice(0, 600), method: sv.method, photo,
      details: { hash: m && m.hash, read: $("pfRead").value.slice(0, 2000), said: $("pfCaption").value.slice(0, 800), area: $("pfArea").value, gps: gpsSpot, conf: r.conf, video: !!(file && isVideo(file)),
        ai: ai ? { scene: ai.scene, landmarks: ai.landmarks, places: ai.places, trail_names: ai.trail_names, terrain: ai.terrain, guesses: ai.guesses } : null },
    });
    if (!error) past = null;   // read again next time, with this one
    return !error;
  }

  // ---------- results ----------
  let shown = [];
  const tagOf = (n) => F.norm(n).replace(/ /g, "");
  function links(r) {
    const q = encodeURIComponent(`${r.name} ${r.zone || ""} mtb`.replace(/\s+/g, " ").trim());
    return `<div class="pv" aria-label="Videos and photos of ${esc(r.name)}"><a href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">▶ YouTube</a>` +
      `<a href="https://www.instagram.com/explore/tags/${encodeURIComponent(tagOf(r.name))}/" target="_blank" rel="noopener">Instagram</a>` +
      `<a href="https://www.trailforks.com/search/?q=${encodeURIComponent(r.name)}" target="_blank" rel="noopener">Trailforks</a>` +
      `<a href="https://www.google.com/search?tbm=isch&q=${q}" target="_blank" rel="noopener">Photos</a></div>`;
  }
  // What the online check said about this trail, with the found photo that looks like the same place.
  function online(k) {
    const pic = k.photo && /^https:/.test(k.photo.img) ? `<a href="${esc(k.photo.page)}" target="_blank" rel="noopener" title="${esc(k.photo.title)}"><img src="${esc(k.photo.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></a>` : "";
    return `<div class="pw">${pic}<span>Online (${Math.round(k.fit * 100)}% ${k.close ? "close" : "fit"}): ${esc(k.why)}${k.confirmed && k.fit >= 0.6 ? " · looks like a picture a rider confirmed" : ""}</span></div>`;
  }
  function show(rows, note) {
    shown = rows;
    testDone(rows);
    $("pfRes").innerHTML = rows.map((r, n) => `<li tabindex="0" data-n="${n}" class="${r.best ? "best" : ""}"><span class="bar"></span>
      <div><div class="pn">${esc(r.name)} ${r.tags ? F.diffBadge(r.tags) : ""}</div><div class="pm">${esc(r.meta)}</div>${r.web ? online(r.web) : ""}${r.name !== "Unnamed trail" ? links(r) : ""}</div><span class="pc">${esc(r.conf)}</span></li>`).join("");
    $("pfNote").textContent = note || "";
  }
  // After a pick: "Is this the trail in your picture?" Yes saves it quietly; No brings the list back.
  let asking = null, askTimer = 0;
  function showAsk(r) {
    asking = r; clearTimeout(askTimer);
    ask.innerHTML = `<span>Is <b>${esc(r.name)}</b> the trail in your picture?</span><button type="button" class="btn primary" data-a="yes">Yes, that's it</button>` +
      `<button type="button" class="btn" data-a="no">No, show the list</button><button type="button" class="btn" data-a="unsure">Not sure</button><button type="button" class="btn" data-a="x" aria-label="Close">✕</button>`;
    ask.hidden = false;
  }
  ask.addEventListener("click", (e) => {
    const a = e.target.closest("[data-a]"), r = asking;
    if (!a || !r) return;
    asking = null;
    if (a.dataset.a === "yes") {
      ask.innerHTML = "<span>Thanks! It will help the next searches.</span>";
      saveMatch(r).catch(() => false);
      askTimer = setTimeout(() => { ask.hidden = true; }, 2500);
    } else if (a.dataset.a === "unsure") {
      // Nothing saved: only a sure Yes teaches later searches.
      ask.innerHTML = "<span>OK, nothing saved. The YouTube and Photos links in the list help compare.</span>";
      askTimer = setTimeout(() => { ask.hidden = true; }, 3500);
    } else {
      ask.hidden = true;
      if (a.dataset.a === "no") open();
    }
  });
  const pickRow = (li) => { const r = li && shown[+li.dataset.n]; if (r) { close(); r.open(); if (r.save) showAsk(r); } };
  $("pfRes").addEventListener("click", (e) => { if (!e.target.closest("a")) pickRow(e.target.closest("li")); });
  $("pfRes").addEventListener("keydown", (e) => { if (e.target.matches("li") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pickRow(e.target); } });
})();
