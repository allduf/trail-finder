// Live webcams in Skiing: resort cams (Whistler Peak first, alex 2026-10-24) and backcountry cams (huts, shelters,
// ridges, remote park cameras) and highway cameras at the mountain passes where tours start, pinned where the camera is, on the flat map and the 3D map. Tapping a pin opens the live feed.
// The list is data/webcams.json (hand-edited). Feeds are never copied or kept: "embed" is the owner's own embeddable
// player shown in a frame, "img" is the owner's live picture loaded from their server (reloaded every minute while
// open), and every cam links to the owner's webcam page. A "📷 Webcams" switch in the Skiing part of the Layers menu
// turns the pins on and off (on by default). Below zoom 9 a resort shows one pin; zoom in to see each cam.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const isSki = () => document.body.classList.contains("sport-ski");
  let on = true;
  try { on = localStorage.getItem("tf:skiCams") !== "false"; } catch {}

  const css = document.createElement("style");
  css.textContent = `
.wc-pin { box-sizing: border-box; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: #1c1c1e; color: #fff; border: 2px solid #fff; box-shadow: 0 1px 4px #0008; font-size: 14px; cursor: pointer; }
.wc-pin.bc { background: #0b7285; }
.wc-pin.road { background: #5c677d; }
.wc-pin.on { border-color: #ffe14d; box-shadow: 0 0 0 3px #ffe14d, 0 1px 4px #0008; }
.wc-pin b { position: absolute; top: -7px; right: -9px; min-width: 16px; height: 16px; padding: 0 3px; border-radius: 8px; background: #e03131; color: #fff; font: 700 10px/16px system-ui, sans-serif; text-align: center; }
dialog.wc-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 14px; width: min(720px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.wc-dlg::backdrop { background: rgba(0,0,0,.55); }
dialog.wc-dlg h2 { margin: 0 34px 2px 0; font-family: var(--font-display); font-size: 1.25rem; overflow-wrap: anywhere; }
dialog.wc-dlg .wc-sub { margin: 0 0 10px; color: var(--muted); font-size: .86rem; }
dialog.wc-dlg .wc-x { position: absolute; top: 10px; right: 10px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font-size: 18px; cursor: pointer; }
dialog.wc-dlg .wc-feed { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 10px; overflow: hidden; }
dialog.wc-dlg .wc-feed iframe, dialog.wc-dlg .wc-feed img { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; object-fit: contain; }
dialog.wc-dlg .wc-feed p { position: absolute; inset: 0; margin: 0; display: grid; place-items: center; padding: 16px; text-align: center; color: #ddd; }
dialog.wc-dlg .wc-feed video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: #000; }
dialog.wc-dlg .wc-feed p.wc-wait { inset: auto 0 0 0; display: block; padding: 8px 10px; background: linear-gradient(transparent, #000c); font-size: .85rem; }
dialog.wc-dlg .wc-off { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 8px 10px; background: #000b; color: #fff; font-size: .82rem; line-height: 1.3; }
dialog.wc-dlg .wc-off span { flex: 1 1 180px; }
dialog.wc-dlg .wc-off a, dialog.wc-dlg .wc-off-links a { color: #fff; font-weight: 600; }
dialog.wc-dlg .wc-off-links { display: block; margin-top: 8px; }
dialog.wc-dlg .wc-retry { font: inherit; font-weight: 600; font-size: .82rem; padding: 6px 10px; border-radius: 999px; border: 0; background: #fff; color: #111; cursor: pointer; }
dialog.wc-dlg .wc-links { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }
dialog.wc-dlg .wc-links a { display: inline-flex; align-items: center; justify-content: center; flex: 1 1 auto; min-height: 36px; padding: 6px 10px; white-space: nowrap; border-radius: 999px; border: 1px solid var(--line); color: var(--fg); text-decoration: none; font-size: .82rem; font-weight: 600; }
dialog.wc-dlg .wc-links a.wc-live { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
dialog.wc-dlg .wc-more { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }
dialog.wc-dlg .wc-more button { font: inherit; font-size: .82rem; padding: 6px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
dialog.wc-dlg .wc-more button[aria-current="true"] { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
dialog.wc-dlg .wc-at { margin: 6px 0 0; font-size: .8rem; color: var(--muted); }
dialog.wc-dlg .wc-at:empty { display: none; }
dialog.wc-dlg .wc-foot { margin: 10px 0 0; font-size: .8rem; color: var(--muted); }
dialog.wc-dlg .wc-foot a { color: var(--accent); font-weight: 600; }
`;
  document.head.appendChild(css);

  // ---------- data ----------
  let data = null, cams = [], owners = {};
  const load = () => (data = data || fetch("data/webcams.json?v=1470").then((r) => r.json()).then((d) => {
    owners = d.owners || {};
    cams = (d.cams || []).filter((c) => isFinite(c.lat) && isFinite(c.lon));
    return d;
  }).catch(() => { data = null; return null; }));
  const owner = (c) => owners[c.owner] || {};
  const pageOf = (c) => c.page || owner(c).page || "";
  const groupOf = (c) => c.resort || c.name;

  // ---------- Layers switch ----------
  const btn = document.createElement("button");
  btn.type = "button"; btn.id = "camsBtn";
  btn.title = "Live webcams from ski resorts and the backcountry, where each camera is. Tap a pin for the live feed";
  btn.textContent = "📷 Webcams";
  function placeBtn() {
    if (btn.isConnected) return true;
    return !!window.tfSkiSlot && window.tfSkiSlot("wx", btn, { label: "Webcams", sym: "📷", bg: "#343a40" });   // Skiing layers, Snow and weather
  }
  function setBtn() {
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("on", on);
  }
  btn.addEventListener("click", () => {
    on = !on;
    try { localStorage.setItem("tf:skiCams", String(on)); } catch {}
    sync();
  });

  // ---------- pins ----------
  const layer = L.layerGroup();
  let glMarkers = [], selected = null;
  const pinHtml = (c, n) => `<div class="wc-pin${c.kind === "backcountry" ? " bc" : c.kind === "road" ? " road" : ""}${selected && groupOf(selected) === groupOf(c) && (n > 1 || selected === c) ? " on" : ""}" style="position:relative">📷${n > 1 ? `<b>${n}</b>` : ""}</div>`;
  // Far out, one pin per resort (the first cam in the list, the one that matters most); zoomed in, every cam.
  function visible() {
    if (map.getZoom() >= 9) return cams.map((c) => [c, 1]);
    const seen = new Map();
    for (const c of cams) { const g = groupOf(c); seen.has(g) ? seen.get(g)[1]++ : seen.set(g, [c, 1]); }
    return [...seen.values()];
  }
  function draw() {
    layer.clearLayers();
    glMarkers.forEach((m) => m.remove()); glMarkers = [];
    if (!shown()) return;
    const gl = window.trailMap3d;
    for (const [c, n] of visible()) {
      const tip = n > 1 ? `${c.resort}: ${n} webcams` : c.name;
      const m = L.marker([c.lat, c.lon], { icon: L.divIcon({ className: "", html: pinHtml(c, n), iconSize: [28, 28], iconAnchor: [14, 14] }), keyboard: true, title: tip, zIndexOffset: 400 });
      m.bindTooltip(esc(tip), { direction: "top", offset: [0, -14] });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); open(c); });
      layer.addLayer(m);
      if (gl && window.maplibregl) {   // the 3D map doesn't show Leaflet markers, so add them there too
        const el = document.createElement("div");
        el.className = "wc-gl"; el.title = tip;   // no position style here: it would beat MapLibre's own and stack the pins down the screen
        el.innerHTML = pinHtml(c, n);
        el.addEventListener("click", (e) => { e.stopPropagation(); open(c); });
        // Always solid: MapLibre fades a pin it thinks a ridge hides, and on steep 3D slopes that was most of them
        // (grey, hard to see on alex's phone, 2026-10-24).
        glMarkers.push(new maplibregl.Marker({ element: el, anchor: "center", opacityWhenCovered: 1 }).setLngLat([c.lon, c.lat]).addTo(gl));
      }
    }
  }
  const shown = () => on && isSki() && cams.length > 0;
  let lastZoomBand = map.getZoom() >= 9;
  map.on("zoomend", () => { const b = map.getZoom() >= 9; if (b !== lastZoomBand) { lastZoomBand = b; draw(); } });
  window.addEventListener("tf:map3d", draw);
  async function sync() {
    placeBtn(); setBtn();
    if (on && isSki()) await load();
    const want = shown();
    if (want && !map.hasLayer(layer)) layer.addTo(map);
    if (!want && map.hasLayer(layer)) map.removeLayer(layer);
    draw();
  }

  // ---------- live feed ----------
  const dlg = document.createElement("dialog");
  dlg.className = "wc-dlg";
  dlg.setAttribute("aria-label", "Live webcam");
  document.body.appendChild(dlg);
  let refresh = 0, feedSeq = 0;
  // Live video, alex 2026-10-31 ("the cams are online with live stream" on the resort's site while the app's card said
  // offline): every cam was checked, and the card now plays what can play and says plainly when a camera is off.
  // - Brownrice (Whistler Blackcomb, Lake Louise): on phones the owner's own live stream plays in the card's video player
  //   (the address comes from their player script, open to other sites), with the camera's latest picture as the cover.
  //   If the stream doesn't start, the card shows the camera's last picture and says the live video is off, with a button
  //   for Brownrice's own player. Computers without built-in live video get Brownrice's player, as before.
  // - YouTube (Kicking Horse, Fernie, Kimberley, Nakiska): the player tells the card when a video can't play (an ended
  //   live stream); the card then shows the resort's own still picture of that camera.
  // - IPCamLive (Manning, Apex): their open camera state says when a camera is switched off (Manning's alpine cams in
  //   the off season); the card says so instead of showing their error box.
  // - A highway picture that fails, or Nova Scotia 511's "No live camera feed" picture, says the camera is off.
  // Every card links straight to the camera's own live stream ("Open the live stream") and to the owner's webcam page.
  const BRI = /player\.brownrice\.com\/embed\/([\w-]+)/, YT = /youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/, IPC = /ipcamlive\.com\/player\/player\.php\?alias=([0-9a-f]+)/;
  const canHls = (() => { try { return !!document.createElement("video").canPlayType("application/vnd.apple.mpegurl"); } catch { return false; } })();
  const bust = (u) => u + (u.includes("?") ? "&" : "?") + "t=" + Date.now();
  const briOf = (c) => (c.embed && c.embed.match(BRI) || [])[1] || "";
  const ytOf = (c) => (c.embed && c.embed.match(YT) || [])[1] || "";
  // The camera's latest still picture: Brownrice's snapshot, or the owner's own picture of that camera.
  const stillOf = (c) => (briOf(c) ? `https://player.brownrice.com/snapshot/${briOf(c)}` : c.img || "");
  // Where "Open the live stream" goes: the camera's own player on its own page (YouTube opens in the YouTube app).
  const liveOf = (c) => (ytOf(c) ? `https://www.youtube.com/watch?v=${ytOf(c)}` : c.embed || "");
  const frame = (c, src) => `<iframe src="${esc(src)}" title="${esc(c.name)} live webcam" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="origin" loading="eager"></iframe>`;
  const imgTag = (c, src, alt = "latest picture") => `<img alt="${esc(c.name)}, ${alt}" referrerpolicy="no-referrer" src="${esc(src)}">`;
  function feedHtml(c) {
    if (briOf(c)) return `${imgTag(c, bust(stillOf(c)))}<p class="wc-wait">Starting the live video…</p>`;
    if (c.embed) return frame(c, ytOf(c) ? c.embed + (c.embed.includes("?") ? "&" : "?") + "enablejsapi=1&playsinline=1&origin=" + encodeURIComponent(location.origin) : c.embed);
    if (c.img && !c.feed) return imgTag(c, bust(c.img));
    if (c.feed) return `<p>Finding the latest picture…</p>`;
    return `<p>This camera's picture can only be seen on its own page.<br><a href="${esc(pageOf(c))}" target="_blank" rel="noopener" style="color:#fff">Open the live webcam ↗</a></p>`;
  }
  const boxFor = (c, seq) => (selected === c && seq === feedSeq && dlg.open ? dlg.querySelector(".wc-feed") : null);
  // The camera is off or its video won't start: show its last picture (kept fresh) with a plain note, or just the note.
  function off(c, seq, why, opts = {}) {
    const box = boxFor(c, seq);
    if (!box) return;
    clearInterval(refresh);
    const still = opts.still === undefined ? stillOf(c) : opts.still;
    const links = opts.retry ? `<button type="button" class="wc-retry">${esc(opts.retry)}</button>` : "";   // the card's own links are just below
    box.innerHTML = still ? `${imgTag(c, bust(still), "last picture")}<div class="wc-off"><span>${esc(why)}</span>${links}</div>`
      : `<p>${esc(why)}<span class="wc-off-links">${links}</span></p>`;
    const b = box.querySelector(".wc-retry");
    if (b) b.onclick = () => { if (opts.onRetry) opts.onRetry(); };
    if (still) refresh = setInterval(() => { const im = box.querySelector("img"); if (im && box.isConnected) im.src = bust(still); }, 30000);
  }
  // Brownrice: the stream address their own player would use, from their player script.
  async function briStream(name) {
    const js = await fetch(`https://player.brownrice.com/?sn=${encodeURIComponent(name)}&em=1`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
    const get = (k) => (js.match(new RegExp(`camera\\[['"]${k}['"]\\]\\s*=\\s*['"]([^'"]*)['"]`)) || [])[1] || "";
    const url = get("streamurl"), type = get("serverType"), typeid = get("typeid");
    if (!url || get("offline") === "offline") return "";
    const file = type === "hookerupper" ? ".stream/index.m3u8" : typeid === "20" ? ".stream_360p/playlist.m3u8" : ".stream/main_playlist.m3u8";
    return `${url}/${name}/${name}${file}`;
  }
  function brownricePlayer(c, seq) {
    const box = boxFor(c, seq);
    if (!box) return;
    clearInterval(refresh);
    box.innerHTML = frame(c, c.embed);
  }
  async function playBrownrice(c, seq) {
    if (!canHls) return brownricePlayer(c, seq);   // computers: Brownrice's own player, as before
    let src = "";
    try { src = await briStream(briOf(c)); } catch {}
    let box = boxFor(c, seq);
    if (!box) return;
    const fail = () => off(c, seq, "The live video is off right now. This is the camera's last picture.", { retry: "▶ Try their player", onRetry: () => brownricePlayer(c, seq) });
    if (!src) return fail();
    const v = document.createElement("video");
    Object.assign(v, { muted: true, autoplay: true, playsInline: true, controls: true, poster: bust(stillOf(c)) });
    v.setAttribute("playsinline", ""); v.setAttribute("muted", "");
    let tries = 0, done = false, timer = 0;
    // A stream that was asleep can take a few seconds to wake (Brownrice's player waits up to a minute): try 4 times.
    const again = () => {
      clearTimeout(timer);
      if (done || !boxFor(c, seq)) return;
      if (++tries > 4) { done = true; v.removeAttribute("src"); v.load(); return fail(); }
      v.src = src + (tries > 1 ? "?r=" + tries : "");
      v.play().catch(() => {});
      timer = setTimeout(again, 12000);
    };
    v.addEventListener("playing", () => { done = true; clearTimeout(timer); });
    v.addEventListener("error", () => { if (!done) { clearTimeout(timer); timer = setTimeout(again, 3000); } });
    box.innerHTML = "";
    box.appendChild(v);
    again();
  }
  // YouTube tells the page about its player once asked ("listening"); an error (an ended live stream) shows the still.
  let ytWatch = null;
  window.addEventListener("message", (e) => {
    if (!ytWatch || !/^https:\/\/(www\.)?youtube(-nocookie)?\.com$/.test(e.origin)) return;
    let d; try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
    if (d && d.event === "onError") ytWatch();
  });
  function watchYoutube(c, seq) {
    const f = boxFor(c, seq)?.querySelector("iframe");
    if (!f) return;
    ytWatch = () => { ytWatch = null; off(c, seq, c.img ? "The resort's live video isn't playing right now. This is the camera's latest picture." : "The resort's live video isn't playing right now.", { still: c.img || "" }); };
    const hello = () => { try { f.contentWindow.postMessage(JSON.stringify({ event: "listening", id: c.id, channel: "widget" }), "*"); } catch {} };
    f.addEventListener("load", () => { hello(); setTimeout(hello, 1500); });
  }
  async function checkIpcam(c, seq) {
    const a = (c.embed.match(IPC) || [])[1];
    try {
      const d = await fetch(`https://g1.ipcamlive.com/player/getcamerastreamstate.php?alias=${a}`, { cache: "no-store" }).then((r) => r.json());
      if (d && d.details && String(d.details.streamavailable) === "0") off(c, seq, `This camera is switched off right now${c.season ? ` (${c.season})` : ", often the case out of season"}.`);
    } catch {}
  }
  // Nova Scotia 511 shows a "No live camera feed at this time" picture (540 × 330) when a camera is down.
  function watchImg(c, seq) {
    const im = boxFor(c, seq)?.querySelector("img");
    if (!im) return;
    im.addEventListener("error", () => off(c, seq, "This camera's picture isn't available right now.", { still: "" }), { once: true });
    im.addEventListener("load", () => { if (c.owner === "ns511" && im.naturalWidth === 540 && im.naturalHeight === 330) off(c, seq, "This highway camera is off right now.", { still: "" }); }, { once: true });
  }
  // Cams whose latest picture has a new name each time (alex 2026-10-28: the Brandywine cam), found when the cam opens.
  // "pmsc:<cam>": Powder Mountain Snowmobile Club, one picture every 30 minutes in daylight, named by Whistler time
  // (BB1_20260601120000.jpg); try the newest slots, going back one day at most. "viu:<station>": VIU's alpine weather
  // stations, whose own list of pictures (open to other sites) ends with the newest one. "bigwhite:<cam>": Big White
  // numbers each new picture (gemlake_124.jpg); the lift-status function reads the current names off their webcam page
  // (names only, never the pictures). Until it answers, the cam's own "img" (an older picture) is shown, marked as older.
  const PT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const pacific = (d) => Object.fromEntries(PT.formatToParts(d).map((x) => [x.type, x.value]));
  const tryImg = (u) => new Promise((ok) => { const im = new Image(); im.referrerPolicy = "no-referrer"; im.onload = () => ok(true); im.onerror = () => ok(false); im.src = u; });
  const when = (d) => d.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  let camFiles = null;
  async function latestOf(c) {
    const [kind, id] = c.feed.split(":");
    if (kind === "bigwhite") {
      const acct = window.tfAccount;
      if (!acct || !acct.url) return null;
      camFiles = camFiles || fetch(`${acct.url}/functions/v1/super-service?cams=bigwhite`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const d = await camFiles;
      if (!d || !d.cams || !d.cams.bigwhite) { camFiles = null; return null; }
      const src = d.cams.bigwhite[id];
      return src ? { src, refresh: true } : null;
    }
    if (kind === "viu") {
      const list = await fetch(`https://www.viu-hydromet-wx.ca/webcam_images/get-images-variable.php?stnName=${encodeURIComponent(id)}`).then((r) => r.json());
      const last = [...list].reverse().find((f) => /\d{14}\.jpg$/.test(f));
      if (!last) return null;
      const t = last.match(/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)\.jpg$/);   // UTC
      return { src: "https://www.viu-hydromet-wx.ca/webcam_images/" + last, at: new Date(Date.UTC(+t[1], t[2] - 1, +t[3], +t[4], +t[5])) };
    }
    if (kind === "pmsc") {
      let d = new Date(Date.now() - 2 * 60000);
      d.setUTCMinutes(d.getUTCMinutes() < 30 ? 0 : 30, 0, 0);   // Whistler is a whole number of hours from UTC
      for (let tries = 0; tries < 26 && d > Date.now() - 36 * 3600000; d = new Date(d - 1800000)) {
        const p = pacific(d), h = +p.hour;
        if (h < 8 || h > 19) continue;   // no pictures at night
        tries++;
        const src = `https://pmsccams.com/Images/${id}/${id}_${p.year}${p.month}${p.day}${p.hour}${p.minute}00.jpg`;
        if (await tryImg(src)) return { src, at: d };
      }
    }
    return null;
  }
  async function showLatest(c, seq) {
    let got = null;
    try { got = await latestOf(c); } catch {}
    const box = boxFor(c, seq);
    if (!box) return;   // another cam opened meanwhile
    const page = pageOf(c), at = dlg.querySelector(".wc-at");
    if (got) {
      box.innerHTML = imgTag(c, got.refresh ? bust(got.src) : got.src);
      if (at) at.textContent = got.at ? `Picture from ${when(got.at)}` : "";
    } else if (c.img) {
      box.innerHTML = imgTag(c, bust(c.img), "older picture");
      if (at) at.textContent = "This may be an older picture: the newest is on their webcam page.";
    } else {
      box.innerHTML = `<p>No new picture in the last day.${c.season ? ` ${esc(c.season)}` : ""}${page ? `<br><a href="${esc(page)}" target="_blank" rel="noopener" style="color:#fff">Open their webcam page ↗</a>` : ""}</p>`;
    }
  }
  function open(c) {
    selected = c;
    const seq = ++feedSeq;
    clearInterval(refresh);
    ytWatch = null;
    const same = cams.filter((x) => groupOf(x) === groupOf(c));
    const o = owner(c), page = pageOf(c), live = liveOf(c);
    const sub = [c.resort && !c.name.includes(c.resort) ? c.resort : "", c.view, c.where, c.ele ? `${Math.round(c.ele).toLocaleString()} m` : "", c.kind === "backcountry" ? "Backcountry" : c.kind === "road" ? "Highway camera" : ""].filter(Boolean).map(esc).join(" · ");
    dlg.innerHTML = `<button type="button" class="wc-x" aria-label="Close">✕</button>
      <h2>${esc(c.name)}</h2>
      <p class="wc-sub">${sub}</p>
      <div class="wc-feed">${feedHtml(c)}</div>
      ${c.feed ? `<p class="wc-at"></p>` : ""}
      ${live || page ? `<div class="wc-links">${live ? `<a class="wc-live" href="${esc(live)}" target="_blank" rel="noopener">▶ Open the live stream ↗</a>` : ""}${page ? `<a href="${esc(page)}" target="_blank" rel="noopener">${live ? "Their webcam page ↗" : "Open their webcam page ↗"}</a>` : ""}</div>` : ""}
      ${same.length > 1 ? `<div class="wc-more" role="group" aria-label="Other webcams at ${esc(groupOf(c))}">${same.map((x) => `<button type="button" data-id="${esc(x.id)}" aria-current="${x === c}">${esc(x.name.replace(/,\s*(Whistler|Blackcomb) Mountain$/, ""))}</button>`).join("")}</div>` : ""}
      <p class="wc-foot">From ${esc(o.credit || o.name || c.resort || "the camera's owner")}, shown from their own feed.</p>`;
    dlg.querySelector(".wc-x").onclick = () => dlg.close();
    dlg.querySelectorAll(".wc-more [data-id]").forEach((b) => (b.onclick = () => { const x = cams.find((k) => k.id === b.dataset.id); if (x) open(x); }));
    if (!dlg.open) dlg.showModal();
    if (briOf(c)) playBrownrice(c, seq);
    else if (ytOf(c)) watchYoutube(c, seq);
    else if (c.embed && IPC.test(c.embed)) checkIpcam(c, seq);
    else if (c.feed) showLatest(c, seq);
    else if (c.img) {
      watchImg(c, seq);
      refresh = setInterval(() => { const im = dlg.querySelector(".wc-feed img"); if (im) im.src = bust(c.img); }, 60000);
    }
    draw();
  }
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  // Closing empties the dialog so the stream stops instead of playing on, hidden.
  dlg.addEventListener("close", () => { if (dlg.open) return; clearInterval(refresh); feedSeq++; ytWatch = null; dlg.innerHTML = ""; selected = null; draw(); });   // already reopened on another cam

  let lastSki = isSki();   // winter.js sets body.sport-ski when the sport menu changes
  new MutationObserver(() => { if (isSki() !== lastSki) { lastSki = isSki(); sync(); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  // The Layers menu's Skiing part is rebuilt by winter.js; put the switch back if it goes missing.
  new MutationObserver(() => { if (!btn.isConnected) placeBtn(); }).observe($("layersMenu") || document.body, { childList: true, subtree: true });
  window.tfWebcams = { open: (id) => load().then(() => { const c = cams.find((x) => x.id === id); if (c) open(c); }) };
  sync();
})();
