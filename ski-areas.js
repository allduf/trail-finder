// Backcountry ski areas across Canada in Skiing: about a hundred touring areas, hut-to-hut traverses and expeditions
// (BC, the Rockies and Kananaskis, Yukon, the Chic-Chocs and the rest of Quebec, Newfoundland, the Maritimes and Nunavut;
// and Hakuba, Myoko, Kagura and Hokkaido in Japan for alex's 2026-27 winter trip),
// pinned on the flat map and the 3D map. Tapping a pin opens the area: what it is, how to get there, huts, rules and
// permits, who forecasts avalanches there (with a link to today's forecast at that spot), the officially published
// avalanche terrain ratings (ATES) of its named trips, and the sources. "⛰ Backcountry areas across Canada" in the
// Skiing panel opens a list of them all, by province, with a search box.
// The list is data/ski-areas.json (hand-edited); the text is our own short summary and each area links its sources.
// A "⛰ Ski areas" switch in the Skiing part of the Layers menu turns the pins on and off (on by default).
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const isSki = () => document.body.classList.contains("sport-ski");
  let on = true;
  try { on = localStorage.getItem("tf:skiAreas") !== "false"; } catch {}

  const ATES = { 1: { label: "Simple", color: "#2f9e44" }, 2: { label: "Challenging", color: "#1f5fe0" }, 3: { label: "Complex", color: "#1a1a1a" } };
  const PROV = { BC: "British Columbia", AB: "Alberta", YT: "Yukon", QC: "Quebec", NL: "Newfoundland and Labrador", NB: "New Brunswick", NS: "Nova Scotia", NU: "Nunavut", JP: "Japan" };
  // Japan's areas are listed and searched only while the map is in Japan (alex 2026-10-30: Japan things only there).
  const inJapanNow = () => { const c = map.getCenter(); return c.lat > 24 && c.lat < 46.5 && c.lng > 122 && c.lng < 146.5; };
  const KIND = { traverse: "Traverse", expedition: "Expedition" };

  const css = document.createElement("style");
  css.textContent = `
.sa-pin { box-sizing: border-box; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: #5f3dc4; color: #fff; border: 2px solid #fff; box-shadow: 0 1px 4px #0008; font-size: 13px; cursor: pointer; }
.sa-pin.traverse { background: #9c36b5; }
.sa-pin.expedition { background: #343a40; }
.sa-pin.on { border-color: #ffe14d; box-shadow: 0 0 0 3px #ffe14d, 0 1px 4px #0008; }
#skiPane .sa-open { font: inherit; font-size: .88rem; font-weight: 700; padding: 10px 8px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; width: 100%; }
dialog.sa-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 16px; width: min(620px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; font-size: .92rem; box-sizing: border-box; }
dialog.sa-dlg::backdrop { background: rgba(0,0,0,.55); }
dialog.sa-dlg h2 { margin: 0 38px 2px 0; font-family: var(--font-display); font-size: 1.25rem; overflow-wrap: anywhere; }
dialog.sa-dlg h3 { margin: 14px 0 4px; font-size: .9rem; }
dialog.sa-dlg p { margin: 0 0 6px; line-height: 1.4; }
dialog.sa-dlg .sa-sub { color: var(--muted); font-size: .84rem; margin-bottom: 10px; }
dialog.sa-dlg .sa-x { position: absolute; top: 10px; right: 10px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font-size: 18px; cursor: pointer; }
dialog.sa-dlg .sa-acts { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 2px; }
dialog.sa-dlg .sa-acts button, dialog.sa-dlg .sa-acts a { font: inherit; min-height: 0; height: auto; line-height: 1.3; font-size: .84rem; font-weight: 700; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; text-decoration: none; }
dialog.sa-dlg .sa-acts .go { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
dialog.sa-dlg ul { margin: 0; padding-left: 18px; }
dialog.sa-dlg li { margin: 2px 0; }
dialog.sa-dlg .sa-ates { display: flex; flex-direction: column; gap: 6px; }
dialog.sa-dlg .sa-ates div { display: flex; flex-wrap: wrap; gap: 4px; align-items: baseline; }
dialog.sa-dlg .sa-ates b { flex: none; min-width: 96px; font-size: .8rem; }
dialog.sa-dlg .sa-ates b i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; background: var(--c); vertical-align: -1px; }
dialog.sa-dlg .sa-ates span { font-size: .8rem; background: var(--chip); border-radius: 6px; padding: 2px 6px; }
dialog.sa-dlg .sa-small { font-size: .78rem; color: var(--muted); }
dialog.sa-dlg a { color: var(--accent); font-weight: 600; }
dialog.sa-dlg .sa-find { font: inherit; font-size: .9rem; width: 100%; box-sizing: border-box; padding: 9px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); color: var(--fg); margin: 6px 0 4px; }
dialog.sa-dlg .sa-list h4 { margin: 12px 0 2px; font-size: .8rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
dialog.sa-dlg .sa-list button { all: unset; box-sizing: border-box; width: 100%; display: block; padding: 7px 6px; border-radius: 8px; cursor: pointer; }
dialog.sa-dlg .sa-list button:hover, dialog.sa-dlg .sa-list button:focus-visible { background: var(--chip); }
dialog.sa-dlg .sa-list button small { display: block; color: var(--muted); font-size: .76rem; }
`;
  document.head.appendChild(css);

  // ---------- data ----------
  let loading = null, doc = {}, areas = [];
  const load = () => (loading = loading || fetch("data/ski-areas.json?v=1450").then((r) => r.json()).then((d) => {
    doc = d;
    areas = (d.areas || []).filter((a) => isFinite(a.lat) && isFinite(a.lon));
    return d;
  }).catch(() => { loading = null; return null; }));

  // ---------- Layers switch and the panel button ----------
  const btn = document.createElement("button");
  btn.type = "button"; btn.id = "skiAreasBtn";
  btn.title = "Backcountry ski areas across Canada and in Japan: access, huts, rules, avalanche forecast and terrain ratings";
  btn.textContent = "⛰ Ski areas";
  const listBtn = document.createElement("button");
  listBtn.type = "button"; listBtn.className = "sa-open";
  listBtn.textContent = "⛰ Backcountry areas across Canada";
  // In Japan the list is Japan's areas (alex 2026-10-30: it said "across Canada" on the map at Hakuba).
  const listLabel = () => { listBtn.textContent = inJapanNow() ? "⛰ Backcountry areas in Japan" : "⛰ Backcountry areas across Canada"; };
  map.on("moveend", listLabel); listLabel();
  function place() {
    if (!btn.isConnected && window.tfSkiSlot) window.tfSkiSlot("places", btn, { label: "Ski areas", sym: "⛰", bg: "#5f3dc4" });
    const acts = document.querySelector("#skiPane .sk-acts");
    if (!listBtn.isConnected && acts) acts.after(listBtn);
  }
  function setBtn() { btn.setAttribute("aria-pressed", String(on)); btn.classList.toggle("on", on); }
  btn.addEventListener("click", () => {
    on = !on;
    try { localStorage.setItem("tf:skiAreas", String(on)); } catch {}
    sync();
  });
  listBtn.addEventListener("click", () => load().then(openList));

  // ---------- pins ----------
  const layer = L.layerGroup();
  let glMarkers = [], selected = null;
  const pinHtml = (a) => `<div class="sa-pin${a.kind ? " " + a.kind : ""}${selected === a ? " on" : ""}">⛰</div>`;
  function draw() {
    layer.clearLayers();
    glMarkers.forEach((m) => m.remove()); glMarkers = [];
    if (!shown()) return;
    const gl = window.trailMap3d;
    for (const a of areas) {
      const m = L.marker([a.lat, a.lon], { icon: L.divIcon({ className: "", html: pinHtml(a), iconSize: [26, 26], iconAnchor: [13, 13] }), keyboard: true, title: a.name, zIndexOffset: 300 });
      m.bindTooltip(esc(a.name), { direction: "top", offset: [0, -13] });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); open(a); });
      layer.addLayer(m);
      if (gl && window.maplibregl) {   // the 3D map doesn't show Leaflet markers, so add them there too
        const el = document.createElement("div");
        el.title = a.name; el.innerHTML = pinHtml(a);
        el.addEventListener("click", (e) => { e.stopPropagation(); open(a); });
        glMarkers.push(new maplibregl.Marker({ element: el, anchor: "center", opacityWhenCovered: 1 }).setLngLat([a.lon, a.lat]).addTo(gl));
      }
    }
  }
  const shown = () => on && isSki() && areas.length > 0;
  window.addEventListener("tf:map3d", draw);
  async function sync() {
    place(); setBtn();
    if (on && isSki()) await load();
    const want = shown();
    if (want && !map.hasLayer(layer)) layer.addTo(map);
    if (!want && map.hasLayer(layer)) map.removeLayer(layer);
    draw();
  }

  // ---------- one area ----------
  const dlg = document.createElement("dialog");
  dlg.className = "sa-dlg";
  dlg.setAttribute("aria-label", "Backcountry ski area");
  document.body.appendChild(dlg);
  const linkHtml = (l) => `<a href="${esc(l.u)}" target="_blank" rel="noopener">${esc(l.t)} ↗</a>`;
  function forecastHtml(a) {
    const f = (doc.forecasters || {})[a.forecast] || {};
    if (a.forecast === "jpnone") return `<p><b>No public avalanche bulletin here.</b> The nearest Japan Avalanche Network bulletins are for Niseko (SW Hokkaido) and Central Hokkaido: use them only as a rough guide, and go with a local guide if you can.</p>`;
    if (a.forecast === "none") return `<p><b>No public avalanche forecast here.</b> You have to judge the snowpack yourself: go with someone trained (Avalanche Skills Training 2 or more), or hire a guide.</p>`;
    const url = /^(ac|pc|kc)$/.test(a.forecast) ? `https://avalanche.ca/map?lat=${a.lat.toFixed(4)}&lng=${a.lon.toFixed(4)}` : f.url;
    return `<p>${esc(f.name || "Avalanche Canada")}${a.sub ? ` · ${esc(a.sub)}` : ""}. <a href="${esc(url)}" target="_blank" rel="noopener">Today's forecast here ↗</a></p>`;
  }
  function atesHtml(a) {
    if (!a.ates || !a.ates.length) return "";
    const src = (doc.atesSources || {})[a.atesSrc] || {};
    const rows = [1, 2, 3].map((c) => {
      const trips = a.ates.filter((t) => t[1] === c);
      return trips.length ? `<div><b style="--c:${ATES[c].color}"><i></i>${ATES[c].label}</b>${trips.map((t) => `<span>${esc(t[0])}</span>`).join("")}</div>` : "";
    }).join("");
    return `<h3>Avalanche terrain ratings (ATES, official)</h3><div class="sa-ates">${rows}</div>
      <p class="sa-small">From ${src.url ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">${esc(src.name)}</a>` : esc(src.name || "the park")}. Terrain ratings don't change day to day: use them together with the day's forecast.</p>`;
  }
  function open(a) {
    selected = a;
    const sub = [a.region, PROV[a.prov] || a.prov, KIND[a.kind]].filter(Boolean).map(esc).join(" · ");
    const huts = (a.huts || []).map((h) => `<li><b>${esc(h.name)}</b>${h.by ? `, ${esc(h.by)}` : ""}${h.note ? ` (${esc(h.note)})` : ""}</li>`).join("");
    dlg.innerHTML = `<button type="button" class="sa-x" aria-label="Close">✕</button>
      <h2>${esc(a.name)}</h2>
      <p class="sa-sub">${sub}</p>
      <p>${esc(a.about)}</p>
      <div class="sa-acts"><button type="button" class="go" data-act="show">Show on the map</button><button type="button" data-act="list">All areas</button>${a.prov === "JP" && window.tfJapanese ? `<button type="button" data-act="jp">🗣 Japanese help</button>` : ""}</div>
      ${a.access ? `<h3>Getting there</h3><p>${esc(a.access)}</p>` : ""}
      ${huts ? `<h3>Huts and lodges</h3><ul>${huts}</ul>` : ""}
      ${a.rules ? `<h3>Rules and permits</h3><p>${esc(a.rules)}</p>` : ""}
      <h3>Avalanche forecast</h3>${forecastHtml(a)}
      ${atesHtml(a)}
      ${(a.links || []).length ? `<h3>Sources and more</h3><ul>${a.links.map((l) => `<li>${linkHtml(l)}</li>`).join("")}</ul>` : ""}
      <p class="sa-small">${a.approx ? "The pin is placed roughly. " : ""}Rules, roads and closures change: check the sources before you go. This page doesn't replace avalanche training or the day's forecast.</p>`;
    dlg.querySelector(".sa-x").onclick = () => dlg.close();
    dlg.querySelector('[data-act="show"]').onclick = () => { dlg.close(); map.flyTo([a.lat, a.lon], Math.max(map.getZoom(), a.kind === "expedition" ? 9 : 12)); };
    dlg.querySelector('[data-act="list"]').onclick = () => openList();
    const jpB = dlg.querySelector('[data-act="jp"]'); if (jpB) jpB.onclick = () => { dlg.close(); window.tfJapanese.open(); };
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    draw();
  }

  // ---------- all areas ----------
  let query = "";
  function openList() {
    selected = null;
    const jp = inJapanNow(), shown = areas.filter((a) => (a.prov === "JP") === jp);
    dlg.innerHTML = `<button type="button" class="sa-x" aria-label="Close">✕</button>
      <h2>${jp ? "Backcountry areas in Japan" : "Backcountry areas across Canada"}</h2>
      <p class="sa-sub">${shown.length} touring areas, traverses and expeditions. Tap one for access, huts, rules and avalanche info.</p>
      <input type="search" class="sa-find" placeholder="Search an area, park, hut or region" aria-label="Search the areas" value="${esc(query)}">
      <div class="sa-list"></div>`;
    dlg.querySelector(".sa-x").onclick = () => dlg.close();
    const box = dlg.querySelector(".sa-find"), list = dlg.querySelector(".sa-list");
    const fill = () => {
      const q = query.trim().toLowerCase();
      const hit = (a) => (a.prov === "JP") === jp && (!q || [a.name, a.region, PROV[a.prov], a.about, ...(a.huts || []).map((h) => h.name)].join(" ").toLowerCase().includes(q));
      const c = map.getCenter();
      const away = (a) => Math.round(map.distance([a.lat, a.lon], c) / 1000);
      let html = "";
      for (const p of Object.keys(PROV)) {
        const rows = areas.filter((a) => a.prov === p && hit(a)).sort((x, y) => away(x) - away(y));
        if (rows.length) html += `<h4>${esc(PROV[p])}</h4>${rows.map((a) => `<button type="button" data-id="${esc(a.id)}">${esc(a.name)}<small>${esc(a.region)}${KIND[a.kind] ? " · " + KIND[a.kind] : ""} · ${away(a).toLocaleString()} km away</small></button>`).join("")}`;
      }
      list.innerHTML = html || `<p class="sa-small">No area matches.</p>`;
      list.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => open(areas.find((a) => a.id === b.dataset.id))));
    };
    box.addEventListener("input", () => { query = box.value; fill(); });
    fill();
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    draw();
  }
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { if (dlg.open) return; selected = null; draw(); });

  let lastSki = isSki();   // winter.js sets body.sport-ski when the sport menu changes
  new MutationObserver(() => { if (isSki() !== lastSki) { lastSki = isSki(); sync(); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  // The Layers menu's Skiing part is rebuilt by winter.js; put the switch back if it goes missing.
  new MutationObserver(() => { if (!btn.isConnected) place(); }).observe($("layersMenu") || document.body, { childList: true, subtree: true });
  // Skiing's find box (winter.js) shows the areas whose name, region or huts match what's typed, as places to go to.
  const match = (q) => {
    q = String(q || "").trim().toLowerCase();
    if (!q) return [];
    return areas.filter((a) => (a.prov !== "JP" || inJapanNow()) && [a.name, a.region, PROV[a.prov], ...(a.huts || []).map((h) => h.name)].join(" ").toLowerCase().includes(q))
      .sort((x, y) => !x.name.toLowerCase().includes(q) - !y.name.toLowerCase().includes(q))
      .map((a) => ({ name: a.name, sub: ["Backcountry area", a.region, PROV[a.prov]].filter(Boolean).join(" · "), ic: "⛰", lat: a.lat, lon: a.lon, bb: null, zoom: a.kind === "expedition" ? 9 : 12, area: a.id }));
  };
  window.tfSkiAreas = { open: (id) => load().then(() => { const a = areas.find((x) => x.id === id); if (a) open(a); }), list: () => load().then(openList), load, match };
  sync();
})();
