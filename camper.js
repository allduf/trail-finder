// Camper van stops in Japan, in Skiing only (alex 2026-10-30: "we rented a camper van so we will be on the road between
// Hokkaidō and hakuba"; "make sure it only in skiing"). Where to sleep, wash and fill up on the drive: Michi-no-eki
// roadside stations, expressway service and parking areas, RV parks, campsites, onsen and public baths, gas, coin
// laundries, dump stations and ferry terminals, plus the roads mapped as closed in winter. From OpenStreetMap, built
// weekly by scripts/build-japan.mjs into jp/c/<1° square>.json (only the squares the map shows are loaded, from zoom 8).
// Dots are Leaflet circle markers and lines, so the 3D map copies them by itself (map3d.js). A "🚐 Camper stops" switch
// in Skiing's Layers menu (Places and tracks) turns them on and off; they only show in Japan.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const isSki = () => document.body.classList.contains("sport-ski");
  const inJapan = (b) => b.getNorth() > 24 && b.getSouth() < 46.5 && b.getEast() > 122 && b.getWest() < 146.5;
  const MIN_Z = 8;
  let on = true;
  try { on = localStorage.getItem("tf:skiCamper") !== "false"; } catch {}

  // Kinds (build-japan.mjs campKind): colour, name, from which zoom, and what it means for a van.
  const KIND = {
    m: { c: "#2f9e44", n: "Michi-no-eki (roadside station)", z: 8, what: "Free parking and 24 h toilets. They're rest stops: a rest or one night's sleep in the van is what most van travellers do, but camping isn't allowed (no chairs, tables, cooking or idling outside), and some stations forbid overnight stays or have a paid RV park." },
    sa: { c: "#1971c2", n: "Expressway service or parking area", z: 9, what: "Only reachable from the expressway. Toilets 24 h; service areas also have food and often gas. Fine for a rest stop in the van." },
    rv: { c: "#e8590c", n: "RV park", z: 8, what: "A paid overnight spot made for campervans (RVパーク), often with power and toilets. Usually booked ahead." },
    cs: { c: "#a9743b", n: "Campsite", z: 10, what: "Many campsites close for the winter: check before you go." },
    o: { c: "#c2255c", n: "Onsen or public bath", z: 10, what: "A hot spring or bath house: the van life shower. Usually ¥500 to ¥1,500; some don't allow tattoos." },
    f: { c: "#495057", n: "Gas station", z: 12, what: "Many in the countryside close in the evening and on some holidays: fill up in the afternoon." },
    l: { c: "#7048e8", n: "Coin laundry", z: 12, what: "" },
    d: { c: "#5c940d", n: "Dump station", z: 10, what: "To empty a van's toilet or grey water." },
    fe: { c: "#0c8599", n: "Ferry terminal", z: 8, what: "" },
  };
  // The car ferries between Hokkaido and Honshu (operator sites checked 2026-10-30). Niigata–Otaru is the one for Hakuba.
  const FERRIES = [
    ["Shin Nihonkai Ferry", "Niigata–Otaru (overnight, about 16 h; Niigata is about 3 h from Hakuba), also Maizuru/Tsuruga–Otaru and Akita/Niigata–Tomakomai", "https://www.snf.jp/"],
    ["Tsugaru Kaikyo Ferry", "Aomori–Hakodate (about 4 h), Oma–Hakodate, Aomori–Muroran", "https://www.tsugarukaikyo.co.jp/"],
    ["Seikan Ferry", "Aomori–Hakodate", "https://www.seikan-ferry.co.jp/"],
    ["Silver Ferry", "Hachinohe–Tomakomai", "https://www.silverferry.jp/"],
    ["Taiheiyo Ferry", "Nagoya–Sendai–Tomakomai", "https://www.taiheiyo-ferry.co.jp/"],
    ["MOL Sunflower", "Oarai (near Tokyo)–Tomakomai", "https://www.sunflower.co.jp/"],
  ];

  const css = document.createElement("style");
  css.textContent = `
dialog.cv-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 16px; width: min(520px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; font-size: .92rem; box-sizing: border-box; }
dialog.cv-dlg::backdrop { background: rgba(0,0,0,.55); }
dialog.cv-dlg h2 { margin: 0 38px 2px 0; font-family: var(--font-display); font-size: 1.2rem; overflow-wrap: anywhere; }
dialog.cv-dlg p { margin: 0 0 8px; line-height: 1.4; }
dialog.cv-dlg .cv-sub { color: var(--muted); font-size: .84rem; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
dialog.cv-dlg .cv-sub i { width: 12px; height: 12px; border-radius: 50%; background: var(--c); border: 2px solid #fff; box-shadow: 0 0 0 1px #0004; flex: none; }
dialog.cv-dlg .cv-x { position: absolute; top: 10px; right: 10px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font-size: 18px; cursor: pointer; }
dialog.cv-dlg dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 8px 0; font-size: .86rem; }
dialog.cv-dlg dt { color: var(--muted); }
dialog.cv-dlg dd { margin: 0; overflow-wrap: anywhere; }
dialog.cv-dlg .cv-acts { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 4px; }
dialog.cv-dlg .cv-acts a { font-size: .86rem; font-weight: 700; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); text-decoration: none; }
dialog.cv-dlg .cv-acts a.go { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
dialog.cv-dlg ul { margin: 4px 0 8px; padding-left: 18px; font-size: .86rem; }
dialog.cv-dlg li { margin: 3px 0; }
dialog.cv-dlg a { color: var(--accent); font-weight: 600; }
dialog.cv-dlg .cv-small { font-size: .78rem; color: var(--muted); }
`;
  document.head.appendChild(css);

  // ---------- data ----------
  let idx = null, idxLoading = null;
  const got = new Map(), points = [], closed = [];
  const loadIdx = () => idx ? Promise.resolve(idx) : idxLoading || (idxLoading = fetch("jp/c/index.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null)).then((d) => (idx = d)).catch(() => null).finally(() => { idxLoading = null; }));
  function loadView() {
    if (!shownZone()) return;
    loadIdx().then((d) => {
      if (!d) return;
      const b = map.getBounds().pad(0.3);
      for (const [k, t] of Object.entries(d.tiles || {})) {
        if (got.has(k) || !b.intersects(L.latLngBounds([t.box[0], t.box[1]], [t.box[2], t.box[3]]))) continue;
        got.set(k, fetch(`jp/c/${k}.json`, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }).then((t2) => {
          points.push(...(t2.points || []));
          for (const c of t2.closed || []) { c.ll = []; for (let i = 0; i < c.g.length; i += 2) c.ll.push([c.g[i], c.g[i + 1]]); closed.push(c); }
          draw();
        }).catch(() => got.delete(k)));
      }
    });
  }

  // ---------- Layers switch ----------
  const btn = document.createElement("button");
  btn.type = "button"; btn.id = "skiCamperBtn";
  btn.title = "Japan: Michi-no-eki, expressway rest areas, RV parks, onsen, gas, laundries, ferries and roads closed in winter, for a camper van trip";
  const place = () => { if (!btn.isConnected && window.tfSkiSlot) window.tfSkiSlot("places", btn, { label: "Camper stops (Japan)", sym: "🚐", bg: "#2f9e44" }); btn.hidden = !inJapan(map.getBounds()); };
  const setBtn = () => { btn.setAttribute("aria-pressed", String(on)); btn.classList.toggle("on", on); };
  btn.addEventListener("click", () => {
    on = !on;
    try { localStorage.setItem("tf:skiCamper", String(on)); } catch {}
    sync();
  });

  // ---------- drawing ----------
  map.createPane("camper").style.zIndex = 425;
  const renderer = L.canvas({ pane: "camper", padding: 0.3, tolerance: 8 });
  if (window.tfSkiTapThrough) window.tfSkiTapThrough(renderer);
  const layer = L.layerGroup();
  let selected = null;
  const shownZone = () => on && isSki() && map.getZoom() >= MIN_Z && inJapan(map.getBounds());
  function draw() {
    layer.clearLayers();
    if (!shownZone()) return;
    const z = map.getZoom(), b = map.getBounds().pad(0.2);
    for (const c of closed) {
      if (!b.intersects(L.latLngBounds(c.ll))) continue;
      const ln = L.polyline(c.ll, { renderer, color: "#e03131", weight: z >= 11 ? 4 : 3, opacity: 0.9, dashArray: "6 5" });
      ln.bindTooltip(`Closed in winter${c.n ? `: ${esc(c.n)}` : ""}`, { sticky: true });
      ln.on("click", (e) => { L.DomEvent.stopPropagation(e); openRoad(c); });
      layer.addLayer(ln);
    }
    for (const p of points) {
      const k = KIND[p.c];
      if (!k || z < k.z || !b.contains([p.lat, p.lon])) continue;
      const big = p.c === "m" || p.c === "rv" || p.c === "fe";
      const m = L.circleMarker([p.lat, p.lon], { renderer, radius: (big ? 7 : 5) + (z >= 13 ? 1 : 0), color: selected === p ? "#ffe14d" : "#fff", weight: selected === p ? 3 : 2, fillColor: k.c, fillOpacity: 1 });
      m.bindTooltip(esc(p.n || k.n), { direction: "top" });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); open(p); });
      layer.addLayer(m);
    }
  }
  function sync() {
    place(); setBtn();
    const want = shownZone();
    if (want && !map.hasLayer(layer)) layer.addTo(map);
    if (!want && map.hasLayer(layer)) map.removeLayer(layer);
    draw();
    if (want) loadView();
  }
  map.on("moveend", sync);

  // ---------- the stop's box ----------
  const dlg = document.createElement("dialog");
  dlg.className = "cv-dlg";
  dlg.setAttribute("aria-label", "Camper stop");
  document.body.appendChild(dlg);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { selected = null; draw(); });
  const YES = { yes: "Yes", no: "No" };
  function show(html) {
    dlg.innerHTML = `<button type="button" class="cv-x" aria-label="Close">✕</button>${html}`;
    dlg.querySelector(".cv-x").onclick = () => dlg.close();
    const jp = dlg.querySelector("[data-jp]");
    if (jp) jp.onclick = (e) => { e.preventDefault(); dlg.close(); window.tfJapanese.open(); };
    if (!dlg.open) dlg.showModal();
  }
  function open(p) {
    selected = p; draw();
    const k = KIND[p.c], t = p.t || {}, ll = `${p.lat},${p.lon}`;
    const rows = [
      t["name:ja"] && ["Japanese name", t["name:ja"]],
      t.opening_hours && ["Open", t.opening_hours === "24/7" ? "24 hours" : t.opening_hours],
      (t.charge || t.fee) && ["Price", t.charge || YES[t.fee] && (t.fee === "no" ? "Free" : "Paid") || t.fee],
      t["bath:type"] && ["Bath", t["bath:type"] === "onsen" ? "Hot spring (onsen)" : t["bath:type"]],
      t["bath:open_air"] === "yes" && ["Outdoor bath", "Yes (rotenburo)"],
      t.power_supply && ["Power", YES[t.power_supply] || t.power_supply],
      t.shower && ["Shower", YES[t.shower] || t.shower],
      t.toilets && ["Toilets", YES[t.toilets] || t.toilets],
      t.brand && ["Brand", t.brand],
      t.operator && ["Run by", t.operator],
      t.phone && ["Phone", t.phone],
      (t["description:en"] || t.description) && ["Notes", t["description:en"] || t.description],
    ].filter(Boolean);
    const ferries = p.c === "fe" ? `<h3 style="margin:12px 0 4px;font-size:.9rem">Car ferries between Hokkaido and Honshu</h3><ul>${FERRIES.map(([n, r, u]) => `<li><a href="${u}" target="_blank" rel="noopener">${esc(n)} ↗</a>: ${esc(r)}</li>`).join("")}</ul><p class="cv-small">Book a camper van spot ahead in winter; times change with the season.</p>` : "";
    show(`<h2>${esc(p.n || k.n)}</h2>
      <div class="cv-sub" style="--c:${k.c}"><i></i>${esc(k.n)}</div>
      ${k.what ? `<p>${esc(k.what)}</p>` : ""}
      ${rows.length ? `<dl>${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("")}</dl>` : ""}
      <div class="cv-acts">
        <a class="go" href="https://www.google.com/maps/dir/?api=1&destination=${ll}" target="_blank" rel="noopener">Drive here (Google Maps)</a>
        <a href="https://maps.apple.com/?daddr=${ll}" target="_blank" rel="noopener">Apple Maps</a>
        ${t.website ? `<a href="${esc(t.website)}" target="_blank" rel="noopener">Website ↗</a>` : ""}
        ${window.tfJapanese ? `<a href="#" data-jp="1">🗣 Japanese help</a>` : ""}
        ${t["name:ja"] || /[\u3040-\u30ff\u4e00-\u9fff]/.test(p.n || "") ? `<a href="${window.tfJapanese ? window.tfJapanese.url(t["name:ja"] || p.n) : "#"}" target="_blank" rel="noopener">Translate the name ↗</a>` : ""}
      </div>
      ${ferries}
      <p class="cv-small">From OpenStreetMap, updated weekly. Hours and winter closing change: check before you count on it.</p>`);
  }
  function openRoad(c) {
    show(`<h2>${esc(c.n || "Road")}${c.ref && c.ref !== c.n ? ` (${esc(c.ref)})` : ""}</h2>
      <div class="cv-sub" style="--c:#e03131"><i></i>Closed in winter</div>
      <p>Mapped as closed to cars in winter: plan your drive around it.</p>
      ${c.why ? `<p class="cv-small">As mapped: ${esc(c.why)}</p>` : ""}
      <p class="cv-small">From OpenStreetMap. Not every winter closure is mapped: mountain passes like this are often shut from about November to late April or May. Check the road authority or JARTIC (jartic.or.jp) for today's closures.</p>`);
  }

  // ---------- the map key ----------
  (window.tfSkiKeyExtra = window.tfSkiKeyExtra || []).push(() => {
    if (!shownZone()) return "";
    const z = map.getZoom();
    return Object.values(KIND).filter((k) => z >= k.z).map((k) => `<li><span class="sk-kic"><i style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${k.c};box-shadow:0 0 0 2px #fff,0 0 0 3px #0003"></i></span>${esc(k.n)}</li>`).join("")
      + `<li><span class="sk-kic"><i style="display:inline-block;width:22px;border-top:3px dashed #e03131;vertical-align:middle"></i></span>Road closed in winter</li>`;
  });

  new MutationObserver(() => sync()).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  const lm = document.getElementById("layersMenu");
  if (lm) new MutationObserver(() => { if (!btn.isConnected) place(); }).observe(lm, { childList: true, subtree: true });
  window.tfCamper = { open, sync };
  sync();
})();
