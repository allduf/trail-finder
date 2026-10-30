// Heli-skiing and cat skiing across Canada in Skiing (alex 2026-10-26: "add all the heliskiing and cat skiing location
// and put all the information that we need to have about it"). Every operation's lodge or meeting place is a pin on the
// flat map and the 3D map: orange with a helicopter for heli-skiing, blue with a snowcat for cat skiing, half and half
// for both. Tapping a pin opens the operation: what it is, terrain size, vertical, season, trips, group size, level,
// published price, how to get there, its terrain area and the avalanche forecast there, with the website to book.
// In BC the province's Crown land tenures for heli and cat skiing (where each operation is allowed to ski) are drawn as
// shaded areas; the public data has no operator names, so each area's operator is matched by its lodge and name, and an
// area we couldn't match says which operations are based next to it.
// The list is data/helicat.json and the areas data/helicat-areas.json (both hand-edited). "Heli and cat skiing" in the
// Resorts group of the Skiing layers turns it all on and off (on by default), and a panel button lists them all.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const isSki = () => document.body.classList.contains("sport-ski");
  let on = true;
  try { on = localStorage.getItem("tf:skiHeliCat") !== "false"; } catch {}

  const C = { heli: "#e8590c", cat: "#1c7ed6" };
  const TYPE = { heli: "Heli-skiing", cat: "Cat skiing", both: "Heli and cat skiing" };
  const PROV = { BC: "British Columbia", AB: "Alberta", YT: "Yukon", QC: "Quebec", NL: "Newfoundland and Labrador" };
  // A small snowcat: cab and box on a track.
  const catSvg = (px) => `<svg viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true"><path fill="#fff" d="M1 9h2v9H1zM4 10l2-4h5v5H4zM12 5h10v6H12z"/><rect x="3.5" y="11.5" width="19" height="2.5" fill="#fff"/><rect x="3" y="15" width="20" height="5" rx="2.5" fill="#fff"/><path fill="${C.cat}" d="M6.6 7.3h3.2v2.5H5.4zM13.4 6.5h3.6v2.6h-3.6zM18 6.5h2.8v2.6H18z"/><circle cx="5.6" cy="17.5" r="1.1" fill="${C.cat}"/><circle cx="10.4" cy="17.5" r="1.1" fill="${C.cat}"/><circle cx="15.6" cy="17.5" r="1.1" fill="${C.cat}"/><circle cx="20.4" cy="17.5" r="1.1" fill="${C.cat}"/></svg>`;
const sym = (t) => (t === "cat" ? catSvg(15) : `<span>🚁</span>`);

  const css = document.createElement("style");
  css.textContent = `
.hc-pin { box-sizing: border-box; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: ${C.heli}; color: #fff; border: 2px solid #fff; box-shadow: 0 1px 4px #0008; font-size: 14px; line-height: 1; cursor: pointer; }
.hc-pin.cat { background: ${C.cat}; }
.hc-pin.both { background: linear-gradient(135deg, ${C.heli} 50%, ${C.cat} 50%); }
.hc-pin.on { border-color: #ffe14d; box-shadow: 0 0 0 3px #ffe14d, 0 1px 4px #0008; }
.hc-lab { font: 700 11px/1.2 system-ui, sans-serif; color: #fff; background: #000a; border-radius: 6px; padding: 2px 6px; white-space: nowrap; cursor: pointer; transform: translate(-50%, -50%); width: max-content; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.hc-lab.heli { border-left: 4px solid ${C.heli}; }
.hc-lab.cat { border-left: 4px solid ${C.cat}; }
#skiPane .hc-open { font: inherit; font-size: .88rem; font-weight: 700; padding: 10px 8px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; width: 100%; margin-top: 6px; }
dialog.hc-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 16px; width: min(620px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; font-size: .92rem; box-sizing: border-box; }
dialog.hc-dlg::backdrop { background: rgba(0,0,0,.55); }
dialog.hc-dlg h2 { margin: 0 38px 2px 0; font-family: var(--font-display); font-size: 1.25rem; overflow-wrap: anywhere; }
dialog.hc-dlg h3 { margin: 14px 0 4px; font-size: .9rem; }
dialog.hc-dlg p { margin: 0 0 6px; line-height: 1.4; }
dialog.hc-dlg .hc-sub { color: var(--muted); font-size: .84rem; margin-bottom: 10px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
dialog.hc-dlg .hc-type { color: #fff; font-weight: 700; font-size: .76rem; padding: 2px 8px; border-radius: 999px; background: ${C.heli}; }
dialog.hc-dlg .hc-type.cat { background: ${C.cat}; }
dialog.hc-dlg .hc-type.both { background: linear-gradient(90deg, ${C.heli} 50%, ${C.cat} 50%); }
dialog.hc-dlg .hc-x { position: absolute; top: 10px; right: 10px; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font-size: 18px; cursor: pointer; }
dialog.hc-dlg .hc-acts { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 2px; }
dialog.hc-dlg .hc-acts button, dialog.hc-dlg .hc-acts a { font: inherit; min-height: 0; height: auto; line-height: 1.3; font-size: .84rem; font-weight: 700; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; text-decoration: none; }
dialog.hc-dlg .hc-acts .go { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
dialog.hc-dlg dl { display: grid; grid-template-columns: max-content 1fr; gap: 5px 12px; margin: 8px 0 0; font-size: .86rem; }
dialog.hc-dlg dt { color: var(--muted); font-weight: 600; }
dialog.hc-dlg dd { margin: 0; overflow-wrap: anywhere; }
dialog.hc-dlg ul { margin: 0; padding-left: 18px; }
dialog.hc-dlg li { margin: 2px 0; }
dialog.hc-dlg .hc-small { font-size: .78rem; color: var(--muted); }
dialog.hc-dlg a { color: var(--accent); font-weight: 600; }
dialog.hc-dlg .hc-acts a.go { color: #fff; }
dialog.hc-dlg .hc-find { font: inherit; font-size: .9rem; width: 100%; box-sizing: border-box; padding: 9px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); color: var(--fg); margin: 6px 0 4px; }
dialog.hc-dlg .hc-chips { display: flex; gap: 6px; margin: 4px 0; }
dialog.hc-dlg .hc-chips button { font: inherit; font-size: .82rem; font-weight: 700; padding: 6px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
dialog.hc-dlg .hc-chips button[aria-pressed="true"] { background: var(--fg); color: var(--bg); }
dialog.hc-dlg .hc-list h4 { margin: 12px 0 2px; font-size: .8rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
dialog.hc-dlg .hc-list button { all: unset; box-sizing: border-box; width: 100%; display: flex; gap: 10px; align-items: center; padding: 7px 6px; border-radius: 8px; cursor: pointer; }
dialog.hc-dlg .hc-list button:hover, dialog.hc-dlg .hc-list button:focus-visible { background: var(--chip); }
dialog.hc-dlg .hc-list .hc-pin { flex: none; width: 24px; height: 24px; font-size: 12px; box-shadow: none; }
dialog.hc-dlg .hc-list button small { display: block; color: var(--muted); font-size: .76rem; }
dialog.hc-dlg .hc-near button { font: inherit; font-size: .84rem; font-weight: 700; padding: 6px 10px; margin: 2px 4px 2px 0; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
.legend.sk-key .hc-kpin { width: 18px; height: 18px; font-size: 10px; border-width: 1.5px; }
.legend.sk-key .hc-karea { width: 26px; height: 12px; border-radius: 3px; }
`;
  document.head.appendChild(css);

  // ---------- data ----------
  let loading = null, areasLoading = null, ops = [], areas = [], byId = new Map();
  const load = () => (loading = loading || fetch("data/helicat.json?v=1").then((r) => r.json()).then((d) => {
    ops = (d.ops || []).filter((o) => isFinite(o.lat) && isFinite(o.lon));
    byId = new Map(ops.map((o) => [o.id, o]));
    return d;
  }).catch(() => { loading = null; return null; }));
  const loadAreas = () => (areasLoading = areasLoading || fetch("data/helicat-areas.json?v=1").then((r) => r.json()).then((d) => {
    areas = d.areas || [];
    return d;
  }).catch(() => { areasLoading = null; return null; }));
  const areaOf = (file) => areas.find((a) => a.file === file);
  // The province writes most tenure places in capitals ("NORTH CENTRAL MONASHEE MTN"): shown as "North Central Monashee Mtn".
  const placeName = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s/(,-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : s);

  // ---------- Layers switch and the panel button ----------
  const btn = document.createElement("button");
  btn.type = "button"; btn.id = "skiHeliCatBtn";
  btn.title = "Heli-skiing and cat skiing operations across Canada, and their terrain in BC";
  btn.textContent = "🚁 Heli and cat skiing";
  const listBtn = document.createElement("button");
  listBtn.type = "button"; listBtn.className = "hc-open";
  listBtn.textContent = "🚁 Heli and cat skiing across Canada";
  function place() {
    if (!btn.isConnected && window.tfSkiSlot) window.tfSkiSlot("resort", btn, { label: "Heli and cat skiing", sym: "🚁", bg: `linear-gradient(135deg, ${C.heli} 50%, ${C.cat} 50%)` });
    if (!listBtn.isConnected) {
      const after = document.querySelector("#skiPane .sa-open") || document.querySelector("#skiPane .sk-acts");
      if (after) after.after(listBtn);
    }
  }
  // Canada's operators only: hidden while the map is in Japan (alex 2026-10-30).
  const inJapan = () => { const c = map.getCenter(); return c.lat > 24 && c.lat < 46.5 && c.lng > 122 && c.lng < 146.5; };
  const hideInJapan = () => { const jp = inJapan(); listBtn.hidden = jp; btn.hidden = jp; };
  map.on("moveend", hideInJapan); hideInJapan();
  function setBtn() { btn.setAttribute("aria-pressed", String(on)); btn.classList.toggle("on", on); }
  btn.addEventListener("click", () => {
    on = !on;
    try { localStorage.setItem("tf:skiHeliCat", String(on)); } catch {}
    sync();
  });
  listBtn.addEventListener("click", () => load().then(openList));

  // ---------- the map ----------
  // Areas: shaded, under the ski routes (420) so the routes stay on top and keep their taps. They don't take taps
  // themselves (they'd swallow every tap beside a route). An area whose operation has a pin next to it is tapped by its
  // pin; an area we couldn't match to an operation gets a small tappable label instead (from zoom 9).
  map.createPane("helicat").style.zIndex = 405;
  const areaRenderer = L.canvas({ pane: "helicat", padding: 0.3 });
  const areaLayer = L.layerGroup(), pinLayer = L.layerGroup(), labLayer = L.layerGroup();
  let glMarkers = [], glLabels = [], selOp = null;
  const pinHtml = (o) => `<div class="hc-pin ${o.type}${selOp === o ? " on" : ""}">${sym(o.type)}</div>`;
  const areaColor = (a) => (a.kind === "cat" ? C.cat : C.heli);
  const areaName = (a) => {
    const o = a.op.length ? byId.get(a.op[0]) : null;
    return o ? o.name.replace(/ \((Bell 2 Lodge|Ripley Creek, Stewart)\)$/, "") : a.kind === "cat" ? "Cat-ski area" : "Heli-ski area";
  };
  const LABEL_ZOOM = 9;
  function drawAreas() {
    areaLayer.clearLayers();
    for (const a of areas) {
      const mine = selOp && a.op.includes(selOp.id);
      const c = areaColor(a);
      areaLayer.addLayer(L.polygon(a.rings, { renderer: areaRenderer, interactive: false, color: mine ? "#ffe14d" : c, weight: mine ? 3.5 : 1.5,
        opacity: mine ? 1 : 0.6, dashArray: a.stage === "applied" ? "6 5" : null, fillColor: c, fillOpacity: mine ? 0.22 : 0.08 }));
    }
  }
  function drawLabels() {
    labLayer.clearLayers();
    glLabels.forEach((m) => m.remove()); glLabels = [];
    if (!shown() || map.getZoom() < LABEL_ZOOM) return;
    const gl = window.trailMap3d, view = map.getBounds().pad(0.5);
    for (const a of areas) {
      if (a.op.length || !view.contains(a.pt)) continue;
      const html = `<div class="hc-lab ${a.kind === "cat" ? "cat" : "heli"}">${esc(areaName(a))}</div>`;
      const m = L.marker(a.pt, { icon: L.divIcon({ className: "", html, iconSize: [0, 0] }), keyboard: false, zIndexOffset: 200 });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); openArea(a); });
      labLayer.addLayer(m);
      if (gl && window.maplibregl) {
        const el = document.createElement("div");
        el.innerHTML = html;
        el.addEventListener("click", (e) => { e.stopPropagation(); openArea(a); });
        glLabels.push(new maplibregl.Marker({ element: el, anchor: "center", opacityWhenCovered: 1 }).setLngLat([a.pt[1], a.pt[0]]).addTo(gl));
      }
    }
  }
  // Operations based in the same town (four in Revelstoke) would sit on one spot: spread them around it a little.
  function spread() {
    const groups = new Map();
    for (const o of ops) { const k = Math.round(o.lat / 0.02) + "," + Math.round(o.lon / 0.02); groups.set(k, [...(groups.get(k) || []), o]); }
    const off = new Map();
    for (const g of groups.values()) g.forEach((o, i) => {
      const a = (i / g.length) * 2 * Math.PI - Math.PI / 2, r = g.length > 1 ? Math.min(30, 10 + 6 * g.length) : 0;
      off.set(o, [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))]);
    });
    return off;
  }
  function drawPins() {
    pinLayer.clearLayers();
    glMarkers.forEach((m) => m.remove()); glMarkers = [];
    if (!shown()) return;
    const gl = window.trailMap3d, off = spread();
    for (const o of ops) {
      const [dx, dy] = off.get(o);
      const m = L.marker([o.lat, o.lon], { icon: L.divIcon({ className: "", html: pinHtml(o), iconSize: [28, 28], iconAnchor: [14 - dx, 14 - dy] }), keyboard: true, title: o.name, zIndexOffset: 320 });
      m.bindTooltip(esc(o.name), { direction: "top", offset: [dx, dy - 14] });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); open(o); });
      pinLayer.addLayer(m);
      if (gl && window.maplibregl) {   // the 3D map doesn't show Leaflet markers, so add them there too
        const el = document.createElement("div");
        el.title = o.name; el.innerHTML = pinHtml(o);
        el.addEventListener("click", (e) => { e.stopPropagation(); open(o); });
        glMarkers.push(new maplibregl.Marker({ element: el, anchor: "center", offset: [dx, dy], opacityWhenCovered: 1 }).setLngLat([o.lon, o.lat]).addTo(gl));
      }
    }
  }
  const draw = () => { drawPins(); drawLabels(); };
  const shown = () => on && isSki() && ops.length > 0;
  window.addEventListener("tf:map3d", draw);
  let lastZ = map.getZoom();
  map.on("moveend", () => { if (!shown()) return; const z = map.getZoom(); if (z >= LABEL_ZOOM || lastZ >= LABEL_ZOOM) drawLabels(); lastZ = z; });
  async function sync() {
    place(); setBtn();
    if (on && isSki()) { await load(); loadAreas().then(() => { if (shown()) { drawAreas(); drawLabels(); } }); }
    const want = shown();
    for (const l of [areaLayer, pinLayer, labLayer]) {
      if (want && !map.hasLayer(l)) l.addTo(map);
      if (!want && map.hasLayer(l)) map.removeLayer(l);
    }
    draw();
    if (window.tfSkiKeyRender) window.tfSkiKeyRender();
  }

  // ---------- the map key ----------
  (window.tfSkiKeyExtra = window.tfSkiKeyExtra || []).push(() => {
    if (!shown()) return "";
    const pin = (t, label) => `<li><span class="sk-kic"><span class="hc-pin hc-kpin ${t}">${t === "cat" ? catSvg(11) : "🚁"}</span></span>${label}</li>`;
    const area = (c, label, dash) => `<li><span class="sk-kic"><i class="hc-karea" style="background:${c}22;border:2px ${dash ? "dashed" : "solid"} ${c}"></i></span>${label}</li>`;
    return pin("heli", "Heli-skiing operation") + pin("cat", "Cat skiing operation") + pin("both", "Heli and cat skiing")
      + area(C.heli, "Heli-ski terrain (BC tenure)") + area(C.cat, "Cat-ski terrain (BC tenure)") + area("#888888", "Applied for, not granted yet", true);
  });

  // ---------- one operation ----------
  const dlg = document.createElement("dialog");
  dlg.className = "hc-dlg";
  dlg.setAttribute("aria-label", "Heli and cat skiing");
  document.body.appendChild(dlg);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  const typeTag = (t) => `<span class="hc-type ${t}">${TYPE[t]}</span>`;
  function forecastHtml(o) {
    if (o.forecast === "none") return `<p><b>No public avalanche forecast here.</b> The operator's guides run their own snow safety program.</p>`;
    if (o.forecast === "aq") return `<p>Avalanche Québec (Chic-Chocs). <a href="https://www.avalanchequebec.ca" target="_blank" rel="noopener">Today's forecast ↗</a></p>`;
    return `<p>Avalanche Canada. <a href="https://avalanche.ca/map?lat=${o.lat.toFixed(4)}&lng=${o.lon.toFixed(4)}" target="_blank" rel="noopener">Today's forecast here ↗</a></p>`;
  }
  const km2 = (n) => `${Number(n).toLocaleString()} km²`;
  function areasHtml(o) {
    const list = (o.areas || []).map(areaOf).filter(Boolean);
    if (!list.length) return "";
    const total = list.reduce((s, a) => s + a.km2, 0);
    return `<h3>Terrain on the BC tenure map</h3>
      <p>${list.length > 1 ? `${list.length} tenure areas, ` : ""}${km2(total)} in all${list.some((a) => a.stage === "applied") ? " (some still applied for)" : ""}: shaded on the map. Tap "Show its terrain" to see it.</p>`;
  }
  function open(o) {
    selOp = o;
    const f = (k, v) => (v ? `<dt>${k}</dt><dd>${v}</dd>` : "");
    const price = o.price ? `${esc(o.price.t)} <span class="hc-small">(${esc(o.price.yr === "older" ? "older listing" : o.price.yr)}, ${esc(o.price.src)})</span>` : "";
    const hasAreas = (o.areas || []).some((f) => areaOf(f));
    dlg.innerHTML = `<button type="button" class="hc-x" aria-label="Close">✕</button>
      <h2>${esc(o.name)}</h2>
      <div class="hc-sub">${typeTag(o.type)}<span>${esc(o.region)} · ${esc(PROV[o.prov] || o.prov)}</span></div>
      ${o.check ? `<p><b>We couldn't confirm it still operates.</b> Call before you plan a trip.</p>` : ""}
      <p>${esc(o.about || "")}</p>
      <div class="hc-acts">${o.web ? `<a class="go" href="${esc(o.web)}" target="_blank" rel="noopener">Website and booking ↗</a>` : ""}<button type="button" data-act="show">Show on the map</button>${hasAreas ? `<button type="button" data-act="area">Show its terrain</button>` : ""}<button type="button" data-act="list">All operations</button></div>
      <dl>
        ${f("Type", esc(TYPE[o.type]))}
        ${f("Terrain", esc(o.terrain))}
        ${f("Vertical", esc(o.vert))}
        ${f("Season", esc(o.season || (o.prov === "BC" ? "Usually December to April: check the dates" : "")))}
        ${f("Trips", (o.trips || []).map(esc).join("<br>"))}
        ${f("Group size", esc(o.group))}
        ${f("Skill level", esc(o.level))}
        ${f("Lodge", esc(o.lodge))}
        ${f("Price", price)}
      </dl>
      <h3>Getting there</h3><p><b>${esc(o.base)}</b>${o.access ? `. ${esc(o.access)}` : ""}</p>
      ${areasHtml(o)}
      <h3>Avalanche forecast</h3>${forecastHtml(o)}
      <p class="hc-small">Guided trips: the operator's certified guides choose the terrain each day and supply avalanche gear.</p>
      <h3>Sources</h3><ul>${(o.src || []).map((u) => `<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(host(u))} ↗</a></li>`).join("")}</ul>
      <p class="hc-small">${o.approx ? "The pin is placed roughly (the town or lodge area). " : ""}${o.helicat ? "Member of HeliCat Canada. " : ""}Prices, dates and trips change every season: check the operator's website before you book.</p>`;
    dlg.querySelector(".hc-x").onclick = () => dlg.close();
    dlg.querySelector('[data-act="show"]').onclick = () => { dlg.close(); selOp = o; map.flyTo([o.lat, o.lon], Math.max(map.getZoom(), 10)); draw(); drawAreas(); };
    const ab = dlg.querySelector('[data-act="area"]');
    if (ab) ab.onclick = () => { dlg.close(); selOp = o; showAreas((o.areas || []).map(areaOf).filter(Boolean), o); };
    dlg.querySelector('[data-act="list"]').onclick = () => openList();
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    draw(); drawAreas();
  }
  function showAreas(list, o) {
    let bb = o ? L.latLngBounds([[o.lat, o.lon]]) : null;
    for (const a of list) for (const r of a.rings) { const b = L.latLngBounds(r); bb = bb ? bb.extend(b) : b; }
    if (bb) map.flyToBounds(bb, { padding: [30, 30], maxZoom: 11 });
    draw(); drawAreas();
  }

  // ---------- an area on the map ----------
  function openArea(a) {
    if (a.op.length === 1 && byId.get(a.op[0])) { open(byId.get(a.op[0])); return; }
    selOp = null;
    const ops2 = a.op.map((id) => byId.get(id)).filter(Boolean), near = a.near.map((id) => byId.get(id)).filter(Boolean);
    const btns = (l) => l.map((o) => `<button type="button" data-id="${esc(o.id)}">${esc(o.name)}</button>`).join("");
    dlg.innerHTML = `<button type="button" class="hc-x" aria-label="Close">✕</button>
      <h2>${esc(a.kind === "cat" ? "Cat-ski" : "Heli-ski")} tenure area</h2>
      <div class="hc-sub">${typeTag(a.kind === "cat" ? "cat" : "heli")}<span>${esc(placeName(a.loc))} · British Columbia</span></div>
      <p>Crown land where the province allows a commercial ${a.kind === "cat" ? "cat" : "heli"}-skiing operation: about ${km2(a.km2)}. ${a.stage === "applied" ? "<b>Applied for, not granted yet.</b>" : "Granted."}</p>
      ${ops2.length ? `<h3>Operation</h3><div class="hc-near">${btns(ops2)}</div>` : near.length ? `<h3>Operations based next to it</h3><p class="hc-small">The public data doesn't name the operator; one of these is likely.</p><div class="hc-near">${btns(near)}</div>`
        : `<p class="hc-small">The public data doesn't name the operator, and no operation we know of is based next to it.</p>`}
      <p class="hc-small">Skiing inside a tenure isn't closed to the public, but the operator's helicopters or cats may be working there. From DataBC Crown land tenures (file ${esc(a.file)}).</p>`;
    dlg.querySelector(".hc-x").onclick = () => dlg.close();
    dlg.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => open(byId.get(b.dataset.id))));
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }

  // ---------- all operations ----------
  let query = "", filter = "all";
  function openList() {
    selOp = null;
    const nH = ops.filter((o) => o.type !== "cat").length, nC = ops.filter((o) => o.type !== "heli").length;
    dlg.innerHTML = `<button type="button" class="hc-x" aria-label="Close">✕</button>
      <h2>Heli and cat skiing across Canada</h2>
      <p class="hc-sub">${ops.length} operations: ${nH} heli-skiing, ${nC} cat skiing. Tap one for terrain, season, trips, price and booking.</p>
      <input type="search" class="hc-find" placeholder="Search a name, town or mountain range" aria-label="Search the operations" value="${esc(query)}">
      <div class="hc-chips" role="group" aria-label="Show">${[["all", "All"], ["heli", "Heli"], ["cat", "Cat"]].map(([k, t]) => `<button type="button" data-f="${k}" aria-pressed="${filter === k}">${t}</button>`).join("")}</div>
      <div class="hc-list"></div>
      <p class="hc-small">No heli-skiing is allowed in Alberta, and Castle Mountain's cat skiing ended in 2025. From HeliCat Canada, catskiing.ca and each operator's website, checked October 2026.</p>`;
    dlg.querySelector(".hc-x").onclick = () => dlg.close();
    const box = dlg.querySelector(".hc-find"), list = dlg.querySelector(".hc-list");
    const fill = () => {
      const q = query.trim().toLowerCase();
      const hit = (o) => (filter === "all" || o.type === filter || o.type === "both") && (!q || [o.name, o.region, o.base, PROV[o.prov], o.access].join(" ").toLowerCase().includes(q));
      const c = map.getCenter();
      const away = (o) => Math.round(map.distance([o.lat, o.lon], c) / 1000);
      let html = "";
      for (const p of Object.keys(PROV)) {
        const rows = ops.filter((o) => o.prov === p && hit(o)).sort((x, y) => away(x) - away(y));
        if (rows.length) html += `<h4>${esc(PROV[p])}</h4>${rows.map((o) => `<button type="button" data-id="${esc(o.id)}">${pinHtml(o)}<span>${esc(o.name)}<small>${esc(TYPE[o.type])} · ${esc(o.region)} · ${away(o).toLocaleString()} km away</small></span></button>`).join("")}`;
      }
      list.innerHTML = html || `<p class="hc-small">No operation matches.</p>`;
      list.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => open(byId.get(b.dataset.id))));
    };
    box.addEventListener("input", () => { query = box.value; fill(); });
    dlg.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; dlg.querySelectorAll("[data-f]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); fill(); }));
    fill();
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    draw(); drawAreas();
  }
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { if (dlg.open) return; draw(); if (areas.length) drawAreas(); });
  // Tapping beside everything lets go of the selected operation's highlight.
  map.on("click", () => { if (selOp && !dlg.open) { selOp = null; draw(); drawAreas(); } });

  let lastSki = isSki();   // winter.js sets body.sport-ski when the sport menu changes
  new MutationObserver(() => { if (isSki() !== lastSki) { lastSki = isSki(); sync(); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  // The Layers menu's Skiing part is rebuilt by winter.js; put the switch back if it goes missing.
  new MutationObserver(() => { if (!btn.isConnected) place(); }).observe($("layersMenu") || document.body, { childList: true, subtree: true });
  // Skiing's find box (winter.js) shows the operations whose name, region or base match what's typed.
  const match = (q) => {
    q = String(q || "").trim().toLowerCase();
    if (!q) return [];
    return ops.filter((o) => [o.name, o.region, o.base, PROV[o.prov]].join(" ").toLowerCase().includes(q))
      .sort((x, y) => !x.name.toLowerCase().includes(q) - !y.name.toLowerCase().includes(q))
      .map((o) => ({ name: o.name, sub: [TYPE[o.type], o.region].filter(Boolean).join(" · "), ic: o.type === "cat" ? "⛷" : "🚁", lat: o.lat, lon: o.lon, bb: null, zoom: 10, helicat: o.id }));
  };
  window.tfHeliCat = { open: (id) => load().then(() => { const o = byId.get(id); if (o) open(o); }), list: () => load().then(openList), load, match };
  sync();
})();
