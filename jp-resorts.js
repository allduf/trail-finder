// Ski resort names on the map in Japan (alex 2026-11-14: "add resort name in japan"). In Canada the resorts are
// known places; in Japan nothing on the Skiing map said which ski area a group of lifts was. Each resort gets a name
// tag, in English (romaji when there is no English name), on the flat map and the 3D map, only in Skiing and only while
// the map is in Japan (alex 2026-10-30: Japan things only there). Tapping it opens a short card: the English and
// Japanese names, how many lifts are on the map, a button to show the whole resort, and the resort's own website.
// Data: the resorts and lifts of the Japan squares (jp/w/, scripts/build-japan.mjs, from OpenStreetMap's
// landuse=winter_sports areas; zip lines aren't counted as lifts), handed over by lifts.js (tfLifts.all, "tf:jp-lifts"). The few names OpenStreetMap
// only has in Japanese, or has wrong, are fixed below from the resorts' own websites; Niseko United and Kagura are one
// area in OpenStreetMap but four and three ski areas on the mountain, so they're split by their lifts' names.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const isSki = () => document.body.classList.contains("sport-ski");
  const inJapan = (b) => b.getNorth() > 24 && b.getSouth() < 46.5 && b.getEast() > 122 && b.getWest() < 146.5;
  const MIN_Z = 9, ALL_Z = 11, BIG = 4;   // names from zoom 9 (the resorts with 4+ lifts), every resort from zoom 11

  // ---------- names OpenStreetMap has only in Japanese, or wrong (by the Japanese name, else the English one) ----------
  const FIX = {
    "湯殿山スキー場": { name: "Yudonosan Ski Area" },
    "八甲田ロープウェー": { name: "Hakkoda Ropeway" },
    "夜越山スキー場": { name: "Yogoshiyama Ski Area" },
    "たらのきだいスキー場": { name: "Taranokidai Ski Area" },
    "松山スキー場": { name: "Matsuyama Ski Area" },
    "谷川岳天神平スキー場": { name: "Tanigawadake Tenjindaira" },   // "Mt. T" in OpenStreetMap
    "白馬白馬岩岳": { ja: "白馬岩岳" },
    "Furano ski resort": { name: "Furano Ski Resort" },
    "Santa present park": { name: "Santa Present Park" },
    "St. Mary": { name: "Miyagi Zao St. Mary" },
    "Prince Hotels and Resorts Karuizawa": { name: "Karuizawa Prince Hotel Ski Resort" },
    // Kagura (Prince Hotels) is one resort of three areas joined by lifts.
    "Mitsumata Area": { name: "Kagura · Mitsumata", part: "Kagura", page: "https://www.princehotels.co.jp/ski/kagura/winter/" },
    "Kagura Area": { name: "Kagura", part: "Kagura", page: "https://www.princehotels.co.jp/ski/kagura/winter/" },
    "Tashiro Area": { name: "Kagura · Tashiro", part: "Kagura", page: "https://www.princehotels.co.jp/ski/kagura/winter/" },
  };
  // One OpenStreetMap area, several ski areas: each named by its own lifts (the lift names they're known by). A lift
  // no rule names (a short chair high between two areas) counts in the whole resort but doesn't move any name tag.
  const SPLIT = {
    "Niseko United": [
      { name: "Grand Hirafu", ja: "ニセコグラン・ヒラフ", page: "https://www.grand-hirafu.jp/", re: /^(ace|king|holiday)\b/i },
      { name: "Hanazono", ja: "ニセコHANAZONO", page: "https://hanazononiseko.com/", re: /hanazono/i },
      { name: "Niseko Village", ja: "ニセコビレッジ", page: "https://www.niseko-village.com/", re: /village|^niseko gondola$|^banzai/i },
      { name: "Annupuri", ja: "ニセコアンヌプリ", page: "https://annupuri.info/", re: /annupuri|^jumbo|^dream/i },
    ],
  };
  const latin = (s) => !/[^\u0000-ɏ -⁯·]/.test(s || "");

  // ---------- the resorts, from the lifts lifts.js has ----------
  let list = [], key = "";
  function build() {
    const all = window.tfLifts && window.tfLifts.all ? window.tfLifts.all() : null;
    if (!all) return;
    const byR = {};
    for (const l of all.lifts) if (String(l.r).startsWith("jp:") && l.g && l.g.length && l.k !== "zip_line") (byR[l.r] = byR[l.r] || []).push(l);
    const k = Object.keys(byR).length + ":" + all.lifts.length;
    if (k === key) return;
    key = k;
    const boxOf = (ls) => { const b = L.latLngBounds([]); for (const l of ls) for (const p of l.g) b.extend(p); return b; };
    const out = [];
    for (const [id, ls] of Object.entries(byR)) {
      const r = all.resorts[id];
      if (!r) continue;
      const fix = FIX[r.ja] || FIX[r.name] || {};
      const base = { id, name: fix.name || r.name, ja: fix.ja || r.ja || "", page: fix.page || r.page || "", part: fix.part || "", n: ls.length, box: boxOf(ls) };
      const split = SPLIT[base.name];
      if (split) {
        for (const s of split) {
          const mine = ls.filter((l) => s.re.test(l.n || ""));
          if (mine.length) out.push({ ...base, id: id + ":" + s.name, name: s.name, ja: s.ja, page: s.page, part: base.name, n: mine.length, box: boxOf(mine) });
        }
        continue;
      }
      out.push(base);
    }
    // The same resort twice (two areas with one name): one tag, all its lifts.
    const seen = new Map();
    list = [];
    for (const r of out) {
      const o = seen.get(r.name);
      if (o && o.box.getCenter().distanceTo(r.box.getCenter()) < 4000) { o.n += r.n; o.box.extend(r.box); continue; }
      seen.set(r.name, r); list.push(r);
    }
    for (const r of list) r.at = r.box.getCenter();
    list.sort((a, b) => b.n - a.n);
  }

  // ---------- the map ----------
  const css = document.createElement("style");
  css.textContent = `
.jr-pin { box-sizing: border-box; display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px 2px 6px; border-radius: 999px; background: #1d2b3a; color: #fff; border: 1.5px solid #fff; box-shadow: 0 1px 4px #0008; font: 700 11px/1.25 system-ui, sans-serif; white-space: nowrap; cursor: pointer; transform: translate(-50%, -50%); }
.jr-pin svg { flex: none; }
.jr-pin.small { font-size: 9.5px; padding: 1px 7px 1px 5px; }
.jr-pin.jr-crowd { display: none; }
dialog.jr-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 14px 14px 12px; width: min(420px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; box-sizing: border-box; }
dialog.jr-dlg::backdrop { background: rgba(0,0,0,.45); }
dialog.jr-dlg h2 { margin: 0 40px 2px 0; font-family: var(--font-display); font-size: 1.25rem; overflow-wrap: anywhere; }
dialog.jr-dlg .jr-ja { margin: 0 0 6px; font-size: 1rem; }
dialog.jr-dlg .jr-sub { margin: 0 0 10px; color: var(--muted); font-size: .86rem; }
dialog.jr-dlg .jr-x { position: absolute; top: 10px; right: 10px; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font-size: 18px; cursor: pointer; }
dialog.jr-dlg .jr-btns { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px; }
dialog.jr-dlg .jr-btns button, dialog.jr-dlg .jr-btns a { min-height: 40px; padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); font: inherit; font-size: .88rem; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; }
dialog.jr-dlg .jr-btns .go { background: #1d2b3a; border-color: #1d2b3a; color: #fff; }
dialog.jr-dlg .jr-foot { margin: 6px 0 0; font-size: .8rem; color: var(--muted); line-height: 1.4; }
`;
  document.head.appendChild(css);
  const icon = () => (window.tfLineName && window.tfLineName("ski", 13)) || "";
  const pins = L.layerGroup();
  let glMarkers = [];
  const shown = () => isSki() && map.getZoom() >= MIN_Z && inJapan(map.getBounds()) && list.length > 0;
  function draw() {
    pins.clearLayers();
    glMarkers.forEach((m) => m.remove()); glMarkers = [];
    if (!shown()) { if (map.hasLayer(pins)) map.removeLayer(pins); return; }
    if (!map.hasLayer(pins)) pins.addTo(map);
    const z = map.getZoom(), view = map.getBounds().pad(0.2);
    const gl = window.trailMap3d && window.maplibregl ? window.trailMap3d : null;
    for (const r of list) {
      if (z < ALL_Z && r.n < BIG) continue;
      if (!view.contains(r.at)) continue;
      const html = `<span class="jr-pin${r.n < BIG ? " small" : ""}">${icon()}${esc(r.name)}</span>`;
      const m = L.marker(r.at, { icon: L.divIcon({ className: "", html, iconSize: [0, 0], iconAnchor: [0, 0] }), keyboard: true, title: r.name, zIndexOffset: 450, n: r.n });
      m.on("click", (e) => { if (planning()) return; L.DomEvent.stopPropagation(e); open(r); });   // planning a tour: a point there
      pins.addLayer(m);
      if (gl) {
        const el = document.createElement("div"); el.title = r.name; el.innerHTML = html; el.firstElementChild.style.transform = "none";   // MapLibre centres it
        el.addEventListener("click", (e) => { if (planning()) return; e.stopPropagation(); open(r); });
        glMarkers.push(new maplibregl.Marker({ element: el, anchor: "center", opacityWhenCovered: 1 }).setLngLat([r.at.lng, r.at.lat]).addTo(gl));
      }
    }
    requestAnimationFrame(declutter);
  }
  const planning = () => !!document.querySelector(".sk-planbar:not([hidden])");
  // The flat map: a name that would touch one already placed waits for a closer zoom, the bigger resorts first (the
  // 3D map does its own, map3d.js unclutter).
  function declutter() {
    const all = [];
    pins.eachLayer((m) => { const el = m.getElement && m.getElement(); const s = el && el.firstElementChild; if (!s) return; s.classList.remove("jr-crowd"); all.push({ s, n: m.options.n || 0, r: s.getBoundingClientRect() }); });
    all.sort((a, b) => b.n - a.n);
    const kept = [], gap = 4;
    for (const p of all) {
      if (!p.r.width) continue;
      const hit = kept.some((k) => p.r.left < k.r.right + gap && k.r.left < p.r.right + gap && p.r.top < k.r.bottom + gap && k.r.top < p.r.bottom + gap);
      p.s.classList.toggle("jr-crowd", hit);
      if (!hit) kept.push(p);
    }
  }
  let drawT = 0;
  const later = () => { clearTimeout(drawT); drawT = setTimeout(() => { build(); draw(); }, 60); };
  map.on("moveend zoomend", later);
  window.addEventListener("tf:jp-lifts", later);
  window.addEventListener("tf:sport", later);
  // Skiing's files often load after the 3D map was built: draw on that one too.
  window.addEventListener("tf:map3d", () => {
    const gl = window.trailMap3d; if (!gl) return;
    if (gl.style && (gl.style._loaded || gl.isStyleLoaded())) later(); else { gl.once("style.load", later); gl.once("load", later); }
  });
  let lastSki = isSki();
  new MutationObserver(() => { if (isSki() !== lastSki) { lastSki = isSki(); later(); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });

  // ---------- the resort's card ----------
  const dlg = document.createElement("dialog");
  dlg.className = "jr-dlg";
  dlg.setAttribute("aria-label", "Ski resort");
  document.body.appendChild(dlg);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  function open(r) {
    const ja = r.ja && r.ja !== r.name ? r.ja : "";
    dlg.innerHTML = `<button type="button" class="jr-x" aria-label="Close">✕</button>
      <h2>${esc(r.name)}</h2>
      ${ja ? `<p class="jr-ja" lang="ja" translate="no">${esc(ja)}</p>` : ""}
      <p class="jr-sub">${r.n === 1 ? "Ski resort · 1 lift on the map" : `Ski resort · ${r.n} lifts on the map`}</p>
      ${r.part ? `<p class="jr-sub">Part of ${esc(r.part)}</p>` : ""}
      <div class="jr-btns">
        <button type="button" class="go" data-show>Show the whole resort</button>
        ${r.page ? `<a href="${esc(/^https?:/.test(r.page) ? r.page : "https://" + r.page)}" target="_blank" rel="noopener">Resort website ↗</a>` : ""}
      </div>
      <p class="jr-foot">Opening dates, hours, lift status and tickets: check the resort's own website. Resort name and lifts from OpenStreetMap${r.part || FIXED.has(r.name) ? ", names checked against the resort's website" : ""}.</p>`;
    dlg.querySelector(".jr-x").onclick = () => dlg.close();
    dlg.querySelector("[data-show]").onclick = () => { dlg.close(); map.fitBounds(r.box.pad(0.15), { maxZoom: 15 }); };
    if (!dlg.open) dlg.showModal();
  }
  const FIXED = new Set(Object.values(FIX).map((f) => f.name).filter(Boolean));

  window.tfJpResorts = { list: () => (build(), list.map((r) => ({ name: r.name, ja: r.ja, n: r.n, lat: +r.at.lat.toFixed(4), lon: +r.at.lng.toFixed(4), page: r.page }))), open: (name) => { build(); const r = list.find((x) => x.name === name); if (r) open(r); }, latin };
  later();
})();
