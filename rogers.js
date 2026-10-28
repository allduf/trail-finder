// Rogers Pass (Glacier National Park) in Skiing (alex 2026-10-24: "find everything about the backcountry skiing in
// rogers pass"). Rogers Pass has the world's largest mobile avalanche control program: the army fires artillery at the
// slopes above the highway and railway, so Parks Canada's Winter Permit System decides each winter morning which
// Winter Restricted Areas are open. This shows, on the flat map and the 3D map:
//  - the permit areas, coloured by today's status: Restricted open (green) or closed (red), Unrestricted (blue,
//    permit needed), Prohibited all winter (dark red, striped), and special closures inside an open area
//  - the winter parking lots, open or closed today, with what each one needs
//  - Parks Canada's official ATES terrain class for 50 named runs (pins; the OpenStreetMap routes that are those runs
//    get r.ates = { cls, src, url }, which the route details and the go/caution light read)
//  - the four ACC huts (capacity, approach, booking), added to the hut details
//  - a "Rogers Pass today" card when the map is on Rogers Pass: today's status, the permit rules, parking, the
//    official terrain classes, huts and Parks Canada's links (permit, quiz, live map, atlas, access routes)
// Data: data/rogers-pass.json (hand-kept from Parks Canada and the Alpine Club of Canada, in main) and
// data/rogers-status.json (today's status and the area outlines, read from Parks Canada's live map feed by
// .github/workflows/rogers-pass.yml every 15 minutes on winter mornings). A "Rogers Pass permit areas" switch in the
// Skiing part of the Layers menu turns it all off.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const isSki = () => document.body.classList.contains("sport-ski");
  const BOX = L.latLngBounds([51.05, -117.8], [51.48, -117.3]);   // Glacier National Park, roughly
  let on = true;
  try { on = localStorage.getItem("tf:skiRogers") !== "false"; } catch {}

  const C = { open: "#2f9e44", closed: "#e03131", wait: "#f08c00", U: "#1f5fe0", P: "#862e9c", cls: { 1: "#2f9e44", 2: "#1971c2", 3: "#1c1c1e" } };
  const CLS = { 1: "Simple", 2: "Challenging", 3: "Complex" };
  const GROUP = {
    R: "Winter Restricted Area: opens or stays closed each day for artillery fire. Enter only when posted open, with a Winter Permit, photo ID and a park pass.",
    U: "Winter Unrestricted Area: no artillery, but a Winter Permit is still needed (so nobody wanders into a closed area by mistake).",
    P: "Winter Prohibited Area: closed all winter and illegal to enter. Skier avalanches here could reach the highway, or the snow is kept untouched for avalanche forecasting.",
    S: "Special closure inside a Restricted Area: closed today even if the area around it is open.",
  };

  const css = document.createElement("style");
  css.textContent = `
#rpCard .rp-st { display: flex; flex-wrap: wrap; gap: 4px; }
#rpCard .rp-chip { font-size: .76rem; font-weight: 700; padding: 3px 8px; border-radius: 999px; color: #fff; background: var(--c); border: 0; font-family: inherit; cursor: pointer; }
#rpCard .rp-line { margin: 0; font-size: .85rem; }
#rpCard .rp-warn { background: #fff3cd; color: #5c4400; border-radius: 8px; padding: 6px 8px; font-size: .82rem; font-weight: 600; margin: 0; }
#rpCard .rp-sel { position: relative; background: var(--chip); border-radius: 10px; padding: 8px 34px 8px 10px; font-size: .84rem; display: flex; flex-direction: column; gap: 4px; }
#rpCard .rp-sel .sk-x { position: absolute; top: 6px; right: 6px; float: none; width: 28px; height: 28px; }
#rpCard .rp-sel h4 { margin: 0; font-size: .95rem; }
#rpCard .rp-sel p { margin: 0; white-space: pre-line; }
#rpCard ul { margin: 4px 0 0; padding-left: 18px; font-size: .82rem; display: flex; flex-direction: column; gap: 3px; }
#rpCard ul.rp-plain { list-style: none; padding: 0; }
#rpCard .rp-runs button, #rpCard .rp-plain button { font: inherit; font-size: .82rem; border: 0; background: none; color: var(--accent); padding: 0; cursor: pointer; text-align: left; }
.rp-dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; background: var(--c); vertical-align: 0; }
#rpCard .rp-links { display: flex; flex-wrap: wrap; gap: 5px; }
#rpCard .rp-links a { font-size: .76rem; font-weight: 700; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); text-decoration: none; }
#rpCard .rp-key { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; font-size: .78rem; list-style: none; padding: 0; }
#rpCard .rp-key i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; border: 2px solid var(--c); background: color-mix(in srgb, var(--c) 30%, transparent); }
.rp-pin { box-sizing: border-box; display: grid; place-items: center; min-width: 22px; height: 22px; padding: 0 4px; border-radius: 6px; border: 2px solid #fff; box-shadow: 0 1px 3px #0007; color: #fff; font: 700 11px/1 system-ui, sans-serif; cursor: pointer; white-space: nowrap; }
.rp-pin.p { background: var(--c); }
.rp-pin.run { border-radius: 11px; background: var(--c); }
.rp-pin.on { outline: 3px solid #ffe14d; }
`;
  document.head.appendChild(css);

  // ---------- data ----------
  let info = null, status = null, loading = null, err = "";
  const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  function load() {
    if (info || loading) return loading;
    loading = Promise.all([get("data/rogers-pass.json"), get("data/rogers-status.json").catch((e) => { err = e.message; return null; })])
      .then(([i, s]) => { info = i; status = s; prepAreas(); applyAtes(); })
      .catch((e) => { err = e.message; })
      .finally(() => { loading = null; sync(); });
    return loading;
  }
  const areaById = new Map();
  function prepAreas() {
    areaById.clear();
    for (const a of status?.areas || []) {
      a.lines = a.rings.map((r) => { const o = []; for (let i = 0; i < r.length; i += 2) o.push([r[i], r[i + 1]]); return o; });
      areaById.set(a.id, a);
    }
  }
  // Today's status runs out (validUntil) or isn't posted yet: every Restricted Area and its parking counts as closed.
  const live = () => !!(status && status.posted && (!status.validUntil || Date.now() < Date.parse(status.validUntil)));
  function isOpen(a) {
    if (!a) return false;
    if (a.group === "U") return true;
    if (a.group === "P") return false;
    if (!live()) return false;
    if (a.group === "S") { const p = areaById.get(a.parent); return !!(a.open && p && p.open); }
    return !!a.open;
  }
  // Special closures only matter (and are drawn) when they're closed inside an open area.
  const showS = (a) => live() && !a.open && isOpen(areaById.get(a.parent));
  // Before the day's status is posted (and all summer) a Restricted Area is closed but not "closed today": amber.
  const colorOf = (a) => (a.group === "U" ? C.U : a.group === "P" ? C.P : !live() ? C.wait : isOpen(a) ? C.open : C.closed);
  const stateOf = (a) => (a.group === "U" ? "permit needed" : a.group === "P" ? "closed all winter" : status?.summer ? "status posted daily from November 15"
    : !live() ? "closed until today's status is posted" : isOpen(a) ? "open today" : "closed today");

  // Which area a point is in (the first match, special closures first), for route and hut details.
  function inRing(lat, lon, r) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ya, xa] = r[i], [yb, xb] = r[j];
      if ((ya > lat) !== (yb > lat) && lon < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) c = !c;
    }
    return c;
  }
  // Outer rings and holes come in order; a point inside an odd number of rings is inside the area.
  const inArea = (lat, lon, a) => a.lines.reduce((n, r) => n + inRing(lat, lon, r), 0) % 2 === 1;
  function areaAt(lat, lon) {
    const list = [...(status?.areas || [])].sort((a, b) => (a.group === "S" ? 0 : a.group === "P" ? 1 : a.group === "R" ? 2 : 3) - (b.group === "S" ? 0 : b.group === "P" ? 1 : b.group === "R" ? 2 : 3));
    return list.filter((a) => (a.group !== "S" || showS(a)) && inArea(lat, lon, a));
  }

  // ---------- official ATES on the ski routes ----------
  // A route with the same name as one of the run's OpenStreetMap routes, within 4 km of the run, gets its class.
  let skiData = null;
  const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  function applyAtes() {
    if (!info || !skiData) return;
    const runs = info.ates.runs.filter((r) => r.osm && r.lat != null);
    let n = 0;
    for (const r of skiData.routes || []) {
      if (!r.name || r.ates) continue;
      const nm = norm(r.name), p = r.g?.[0];
      if (!p || !BOX.contains([p[0], p[1]])) continue;
      const near = (x) => { for (const part of r.g) for (let i = 0; i < part.length; i += 2) if (map.distance([x.lat, x.lon], [part[i], part[i + 1]]) < 4000) return true; return false; };
      const run = runs.find((x) => x.osm.some((o) => norm(o) === nm) && near(x));
      if (run) { r.ates = { cls: run.cls, src: `Parks Canada: ${run.name}`, url: info.ates.url, run: run.name }; n++; }
    }
    if (n) window.dispatchEvent(new CustomEvent("tf:ski-ates", { detail: { count: n } }));
  }
  window.addEventListener("tf:ski-data", (e) => { skiData = e.detail; if (isSki() && on && map.getBounds().intersects(BOX)) load(); applyAtes(); });

  // ---------- map ----------
  map.createPane("rogers").style.zIndex = 405;   // under the ski routes (420), over the slope shading
  const renderer = L.canvas({ pane: "rogers", padding: 0.3, tolerance: L.Browser.touch ? 8 : 4 });
  const layer = L.layerGroup(), pins = L.layerGroup();
  let sel = null, glMarkers = [];
  const stripes = (() => {   // Prohibited: diagonal stripes (canvas pattern for the 2D map, image for the 3D map)
    const c = document.createElement("canvas"); c.width = c.height = 12;
    const g = c.getContext("2d"); g.strokeStyle = C.P; g.globalAlpha = 0.55; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(-3, 15); g.lineTo(15, -3); g.moveTo(-3, 3); g.lineTo(3, -3); g.moveTo(9, 15); g.lineTo(15, 9); g.stroke();
    return c;
  })();
  function draw() {
    layer.clearLayers(); pins.clearLayers();
    glMarkers.forEach((m) => m.remove()); glMarkers = [];
    if (!shown()) { draw3d(); return; }
    const areas = (status?.areas || []).filter((a) => a.group !== "S" || showS(a));
    // Biggest first, so the small special closures sit on top and can be tapped.
    for (const a of areas.sort((x, y) => (x.group === "S") - (y.group === "S") || (x.group === "U") - (y.group === "U"))) {
      const c = colorOf(a), on1 = sel && sel.area === a;
      const pg = L.polygon(a.lines, { renderer, color: on1 ? "#ffe14d" : c, weight: on1 ? 4 : a.group === "S" ? 2.5 : 2, opacity: 0.95,
        dashArray: a.group === "U" ? "6 5" : a.group === "S" ? "3 4" : null, fillColor: c, fillOpacity: a.group === "U" ? 0.05 : a.group === "P" ? 0.22 : 0.14 });
      pg.bindTooltip(`${esc(a.name)}: ${esc(stateOf(a))}`, { sticky: true });
      pg.on("click", (e) => { if (planning()) return; L.DomEvent.stopPropagation(e); pick({ area: a }); });   // while planning a tour, the tap is the plan's next point
      layer.addLayer(pg);
    }
    const gl = window.trailMap3d && window.maplibregl ? window.trailMap3d : null;
    const add = (lat, lon, html, tip, it) => {
      const m = L.marker([lat, lon], { icon: L.divIcon({ className: "", html, iconSize: null, iconAnchor: [11, 11] }), keyboard: true, title: tip, zIndexOffset: 450 });
      m.bindTooltip(esc(tip), { direction: "top", offset: [0, -11] });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); pick(it); });
      pins.addLayer(m);
      if (gl) {
        const el = document.createElement("div"); el.className = "rp-gl"; el.title = tip; el.innerHTML = html;
        el.addEventListener("click", (e) => { e.stopPropagation(); pick(it); });
        glMarkers.push(new maplibregl.Marker({ element: el, anchor: "center", opacityWhenCovered: 1 }).setLngLat([lon, lat]).addTo(gl));
      }
    };
    const z = map.getZoom();
    for (const l of status?.parking || []) {
      const c = isOpenLot(l) ? C.open : C.closed;
      add(l.lat, l.lon, `<span class="rp-pin p${sel && sel.lot === l ? " on" : ""}" style="--c:${c}">P</span>`, `${l.name}: ${isOpenLot(l) ? "open" : "closed"} today`, { lot: l });
    }
    if (z >= 13) for (const r of info?.ates.runs || []) {
      if (r.lat == null) continue;
      add(r.lat, r.lon, `<span class="rp-pin run${sel && sel.run === r ? " on" : ""}" style="--c:${C.cls[r.cls]}">${r.cls}</span>`, `${r.name}: ATES ${r.cls} ${CLS[r.cls]}`, { run: r });
    }
    draw3d();
  }
  // The Rogers Pass Centre and Illecillewaet lots stay open all winter; the others only when posted open today.
  const ALWAYS = /Rogers Pass Centre|Illecillewaet/;
  const isOpenLot = (l) => (live() ? !!l.open : ALWAYS.test(l.name) && l.open !== false);
  const shown = () => on && isSki() && !!status;
  const planning = () => !!document.querySelector(".sk-planbar:not([hidden])");
  // 3D: the areas as fills and outlines under the routes.
  const glClicks = new WeakSet();
  function draw3d() {
    const gl = window.trailMap3d;
    if (!gl || !gl.getStyle || !gl.getStyle()) return;
    const feats = shown() ? (status.areas || []).filter((a) => a.group !== "S" || showS(a)).map((a) => ({ type: "Feature",
      properties: { c: colorOf(a), g: a.group, n: a.name, id: a.id },
      geometry: { type: "Polygon", coordinates: a.lines.map((r) => r.map(([la, lo]) => [lo, la])) } })) : [];
    const data = { type: "FeatureCollection", features: feats };
    try {
      if (gl.getSource("rp-areas")) gl.getSource("rp-areas").setData(data);
      else gl.addSource("rp-areas", { type: "geojson", data });
      if (!gl.hasImage("rp-stripes")) gl.addImage("rp-stripes", stripes.getContext("2d").getImageData(0, 0, 12, 12));
      const under = gl.getLayer("lines") ? "lines" : undefined;
      if (!gl.getLayer("rp-fill")) gl.addLayer({ id: "rp-fill", type: "fill", source: "rp-areas", filter: ["!=", ["get", "g"], "P"], paint: { "fill-color": ["get", "c"], "fill-opacity": ["case", ["==", ["get", "g"], "U"], 0.06, 0.18] } }, under);
      if (!gl.getLayer("rp-stripe")) gl.addLayer({ id: "rp-stripe", type: "fill", source: "rp-areas", filter: ["==", ["get", "g"], "P"], paint: { "fill-pattern": "rp-stripes" } }, under);
      if (!gl.getLayer("rp-line")) gl.addLayer({ id: "rp-line", type: "line", source: "rp-areas", paint: { "line-color": ["get", "c"], "line-width": 2.5, "line-opacity": 0.9 } }, under);
      if (!glClicks.has(gl)) {
        glClicks.add(gl);
        const tapArea = (e) => { const a = areaById.get(e.features?.[0]?.properties?.id); if (a) pick({ area: a }); };
        gl.on("click", "rp-fill", tapArea); gl.on("click", "rp-stripe", tapArea);
      }
    } catch (e) { /* the style is changing: drawn again on the next tf:map3d */ }
  }
  // Skiing's files load when Skiing is picked (winter.js), often after the 3D map was built: draw on that one too.
  const on3d = () => {
    const gl = window.trailMap3d; if (!gl) return;
    const go = () => draw();
    if (gl.style && (gl.style._loaded || gl.isStyleLoaded())) go(); else { gl.once("style.load", go); gl.once("load", go); }
  };
  window.addEventListener("tf:map3d", on3d);
  let zBand = map.getZoom() >= 13;
  map.on("zoomend", () => { const b = map.getZoom() >= 13; if (b !== zBand) { zBand = b; if (shown()) draw(); } });
  // Panning only redraws the card when it comes into or goes out of view (a redraw would close its open sections).
  let cardWant = null;
  map.on("moveend", () => { if (!isSki() || !on) return; if (!info && !loading && map.getBounds().intersects(BOX)) load(); if (cardWanted() !== cardWant) renderCard(); });

  // ---------- the card ----------
  const card = document.createElement("details");
  card.className = "sk-card"; card.id = "rpCard"; card.hidden = true; card.open = true;
  function placeCard() {
    if (card.isConnected) return true;
    const pane = $("skiPane"), av = $("avCard");
    if (!pane) return false;
    if (av) av.before(card); else pane.prepend(card);
    return true;
  }
  const fmtT = (iso) => { try { return new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }); } catch { return ""; } };
  const blockName = (a) => (a.block || a.name);
  const linkHtml = (l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`;
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  function statusHtml() {
    if (!status) return `<p class="rp-warn">Today's open and closed areas aren't on the site yet${err ? "" : " (loading…)"}. Check <a href="https://www.pc.gc.ca/apps/rogers-pass/" target="_blank" rel="noopener">Parks Canada's live map</a>.</p>`;
    const R = (status.areas || []).filter((a) => a.group === "R");
    const blocks = new Map();   // East Rogers (N) and (S) are one area on Parks Canada's list
    for (const a of R) { const k = blockName(a); if (!blocks.has(k)) blocks.set(k, []); blocks.get(k).push(a); }
    const chips = [...blocks].map(([k, list]) => {
      const open = list.every(isOpen), some = list.some(isOpen);
      return `<button type="button" class="rp-chip" data-area="${esc(list[0].id)}" style="--c:${!live() ? C.wait : open ? C.open : some ? "#e8590c" : C.closed}">${esc(k)} ${!live() ? "" : open ? "open" : some ? "part open" : "closed"}</button>`;
    }).join("");
    const closedS = (status.areas || []).filter(showS);
    const old = status.checkedAt && Date.now() - Date.parse(status.checkedAt) > 3 * 3600e3;
    let line;
    if (status.summer) line = `<p class="rp-line">The Winter Permit System is off for the summer: it starts <b>November 15</b>. From then, Parks Canada posts each morning which areas are open; until it does, every Restricted Area counts as closed.</p>`;
    else if (live()) line = `<p class="rp-line"><b>Posted ${esc(fmtT(status.validFrom) || "today")}</b>${status.validUntil ? `, until ${esc(fmtT(status.validUntil))}` : ""}. Tap an area for its rules.</p>`;
    else line = `<p class="rp-warn">Today's status isn't posted yet (Parks Canada posts it about 7:30 am). Until then, every Winter Restricted Area and its parking is closed.</p>`;
    return line + `<div class="rp-st">${chips}</div>`
      + (closedS.length ? `<p class="rp-line">Closed inside open areas: ${closedS.map((a) => `<button type="button" class="rp-chip" data-area="${esc(a.id)}" style="--c:${C.closed}">${esc(a.name)}</button>`).join(" ")}</p>` : "")
      + (old ? `<p class="sk-note">Last checked ${esc(fmtT(status.checkedAt))}. Check <a href="https://www.pc.gc.ca/apps/rogers-pass/" target="_blank" rel="noopener">Parks Canada's live map</a> before you go.</p>` : "");
  }
  function selHtml() {
    if (!sel) return "";
    let h = "", p = [];
    if (sel.area) {
      const a = sel.area, park = (status.parking || []).filter((l) => a.group === "R" && info?.parking?.[l.name]?.needs?.includes(blockName(a)));
      h = a.name;
      p = [`<p><span class="rp-dot" style="--c:${colorOf(a)}"></span><b>${esc(cap(stateOf(a)))}</b></p>`, `<p>${esc(GROUP[a.group] || "")}</p>`];
      if (a.note) p.push(`<p>${esc(a.note)}</p>`);
      if (a.link) p.push(`<p><a href="${esc(a.link)}" target="_blank" rel="noopener">Designated access route ↗</a></p>`);
      if (park.length) p.push(`<p>Parking: ${park.map((l) => `${esc(l.name)} (${isOpenLot(l) ? "open" : "closed"})`).join(", ")}</p>`);
    } else if (sel.lot) {
      const l = sel.lot, x = info?.parking?.[l.name] || {};
      h = l.name;
      p = [`<p><span class="rp-dot" style="--c:${isOpenLot(l) ? C.open : C.closed}"></span><b>${isOpenLot(l) ? "Open today" : "Closed today"}</b></p>`];
      if (x.needs) p.push(`<p>${esc(x.needs)}</p>`);
      if (x.overnight) p.push(`<p>Overnight: ${esc(x.overnight)}</p>`);
      p.push(`<p class="sk-note">Restricted parking closes at midnight; it's illegal to enter or park until it's posted open. If it's full, change plans: no parking on the highway shoulder.</p>`);
    } else if (sel.run) {
      const r = sel.run, here = r.lat != null ? areaAt(r.lat, r.lon)[0] : null;
      h = r.name;
      p = [`<p><span class="rp-dot" style="--c:${C.cls[r.cls]}"></span><b>ATES class ${r.cls}: ${CLS[r.cls]}</b> (Parks Canada's official rating)</p>`,
        `<p>${r.cls === 1 ? "Low-angle or mostly forested terrain; some exposure to avalanche runouts possible." : r.cls === 2 ? "Exposure to well-defined avalanche paths, start zones or terrain traps; options to reduce or avoid it with careful route-finding." : "Multiple overlapping avalanche paths or large expanses of steep, open terrain, often glaciated: many start zones and terrain traps, little chance to reduce exposure."}</p>`];
      if (here) p.push(`<p>In <b>${esc(here.name)}</b>: ${esc(stateOf(here))}.</p>`);
      if (r.approx) p.push(`<p class="sk-note">Pin placed roughly: see the Winter Terrain Atlas for the exact terrain.</p>`);
      if (r.atlas) p.push(`<p><a href="${esc(r.atlas)}" target="_blank" rel="noopener">Winter Terrain Atlas chapter (PDF) ↗</a></p>`);
    } else if (sel.hut) {
      h = sel.hut.name;
      p = [hutHtml(sel.hut)];
    }
    return `<div class="rp-sel"><button type="button" class="sk-x" aria-label="Close">✕</button><h4>${esc(h)}</h4>${p.join("")}</div>`;
  }
  const cardWanted = () => on && isSki() && map.getBounds().intersects(BOX);
  function renderCard() {
    if (!placeCard()) return;
    const want = (cardWant = cardWanted());
    card.hidden = !want;
    if (!want) return;
    if (!info) { card.innerHTML = `<summary>Rogers Pass today</summary><p class="sk-note">${err ? `Couldn't load the Rogers Pass details (${esc(err)}).` : "Loading…"}</p>`; return; }
    const runs = info.ates.runs, byCls = [3, 2, 1].map((c) => [c, runs.filter((r) => r.cls === c)]);
    const lots = status?.parking || [];
    card.innerHTML = `<summary><b>Rogers Pass today</b></summary>
      ${selHtml()}
      ${statusHtml()}
      <ul class="rp-key">${live() ? `<li><i style="--c:${C.open}"></i>Open today</li><li><i style="--c:${C.closed}"></i>Closed today</li>` : `<li style="grid-column:1/-1"><i style="--c:${C.wait}"></i>Restricted: closed until posted</li>`}<li><i style="--c:${C.U}"></i>Unrestricted (permit)</li><li><i style="--c:${C.P}"></i>Prohibited all winter</li></ul>
      <p class="rp-warn">A Winter Permit is needed for <u>all</u> backcountry here, Unrestricted Areas too.</p>
      ${lots.length ? `<details><summary>Parking (${lots.filter(isOpenLot).length} of ${lots.length} open)</summary><ul class="rp-plain">${lots.map((l, i) => `<li><span class="rp-dot" style="--c:${isOpenLot(l) ? C.open : C.closed}"></span><button type="button" data-lot="${i}">${esc(l.name)}</button></li>`).join("")}</ul></details>` : ""}
      <details><summary>Before you go</summary><ul>${info.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul><p class="sk-note">${esc(info.visit)}</p></details>
      <details><summary>Official terrain classes (ATES), ${runs.length} runs</summary>${byCls.map(([c, list]) => `<p class="rp-line" style="margin-top:6px"><span class="rp-dot" style="--c:${C.cls[c]}"></span><b>${c} ${CLS[c]}</b></p><ul class="rp-plain rp-runs">${list.map((r) => `<li>${r.lat != null ? `<button type="button" data-run="${esc(r.name)}">${esc(r.name)}</button>` : esc(r.name)}</li>`).join("")}</ul>`).join("")}
        <p class="sk-note">From <a href="${esc(info.ates.url)}" target="_blank" rel="noopener">Parks Canada's ATES ratings</a>. Zoom in close to see them as numbered pins.</p></details>
      <details><summary>Huts (Alpine Club of Canada)</summary><ul class="rp-plain">${info.huts.map((h, i) => `<li><button type="button" data-hut="${i}">${esc(h.name)}</button> <span class="sk-note">sleeps ${h.sleeps}, ${h.km} km, ↑ ${h.up} m, ATES ${h.ates}</span></li>`).join("")}</ul><p class="sk-note">An Annual Winter Permit, a hut booking and an overnight parking permit (free, from Summit Station or 250-837-7500) are needed.</p></details>
      <div class="rp-links">${info.links.filter((l) => l.top).map(linkHtml).join("")}</div>
      <details><summary>More from Parks Canada and the ACC</summary><div class="rp-links">${info.links.filter((l) => !l.top).map(linkHtml).join("")}</div></details>
      <p class="sk-note">Backcountry emergency: <a href="tel:${esc(info.emergency.replace(/\D/g, ""))}">${esc(info.emergency)}</a> (Parks Canada dispatch). Cell service is patchy. Areas and status: Parks Canada; the map is a guide, Parks Canada's posted order wins.</p>`;
    const x = card.querySelector(".rp-sel .sk-x");
    if (x) x.onclick = (e) => { e.preventDefault(); sel = null; draw(); renderCard(); };
    card.querySelectorAll("[data-area]").forEach((b) => (b.onclick = () => { const a = areaById.get(b.dataset.area); if (a) pick({ area: a }, true); }));
    card.querySelectorAll("[data-lot]").forEach((b) => (b.onclick = () => pick({ lot: lots[+b.dataset.lot] }, true)));
    card.querySelectorAll("[data-run]").forEach((b) => (b.onclick = () => pick({ run: runs.find((r) => r.name === b.dataset.run) }, true)));
    card.querySelectorAll("[data-hut]").forEach((b) => (b.onclick = () => pick({ hut: info.huts[+b.dataset.hut] }, true)));
  }
  function pick(it, fly) {
    sel = it;
    if (fly) {
      if (it.area) map.fitBounds(L.latLngBounds(it.area.lines.flat()), { padding: [30, 30], maxZoom: 14 });
      else if (it.lot) map.setView([it.lot.lat, it.lot.lon], Math.max(map.getZoom(), 14));
      else if (it.run) map.setView([it.run.lat, it.run.lon], Math.max(map.getZoom(), 14));
      else if (it.hut) map.setView([it.hut.lat, it.hut.lon], Math.max(map.getZoom(), 14));
    }
    draw(); renderCard();
    card.open = true;
    if (window.tfPanelScrollTo) window.tfPanelScrollTo(card, "start", true);
  }
  // A hut: the ACC's details (in the card, and under the hut's details from winter.js).
  function hutHtml(h) {
    return `<div class="sk-sec rp-hut"><h4>Alpine Club of Canada hut</h4>
      <p>Sleeps <b>${h.sleeps}</b> · ${h.ele.toLocaleString()} m · ${h.km} km from ${esc(h.from)}, ↑ ${h.up} m · approach ATES <b>${h.ates} ${CLS[h.ates]}</b></p>
      <p>${esc(h.access)}</p><p>${esc(h.note)}</p>
      <p>Needs an Annual Winter Permit, a booking and a free overnight parking permit.</p>
      <p><a href="${esc(h.url)}" target="_blank" rel="noopener">The ACC's hut page ↗</a> · <a href="https://app.alpineclubofcanada.ca/hut-bookings" target="_blank" rel="noopener">Book ↗</a></p></div>`;
  }

  // ---------- in a route's or hut's details (winter.js sends "tf:ski-select" with an empty #skLocal block) ----------
  window.addEventListener("tf:ski-select", (e) => {
    const { item: r, el } = e.detail || {};
    if (!r || !el) return;
    const at = r.lat != null ? [r.lat, r.lon] : r.lines?.[0]?.[0];
    if (!at || !BOX.contains(at)) return;
    const fill = () => {
      if (!el.isConnected || !info) return;
      const parts = [];
      const pts = r.lat != null ? [[r.lat, r.lon]] : r.lines.flat().filter((_, i, all) => i % Math.max(1, all.length >> 4) === 0 || i === all.length - 1);
      const hit = new Map();
      if (status) for (const [la, lo] of pts) for (const a of areaAt(la, lo)) hit.set(a.id, a);
      if (hit.size) {
        const list = [...hit.values()];
        parts.push(`<p>${list.map((a) => `<span class="rp-dot" style="--c:${colorOf(a)}"></span><b>${esc(a.name)}</b>: ${esc(stateOf(a))}`).join("<br>")}</p>`);
        if (list.some((a) => a.group === "P")) parts.push(`<p class="av-warn">Goes into a Winter Prohibited Area: closed all winter, illegal to enter.</p>`);
        else if (list.some((a) => (a.group === "R" || a.group === "S") && !isOpen(a))) parts.push(`<p class="av-warn">Goes into a Restricted Area that's closed today: artillery avalanche control. Don't go in.</p>`);
      }
      if (r.ates) parts.push(`<p>Official terrain class: <b>ATES ${r.ates.cls} ${CLS[r.ates.cls]}</b> (Parks Canada, “${esc(r.ates.run)}”)</p>`);
      const hut = r.lat != null && info.huts.find((h) => h.match.some((m) => norm(m) === norm(r.name)) || map.distance([h.lat, h.lon], at) < 250);
      if (hut) parts.push(hutHtml(hut));
      parts.push(`<p>A Winter Permit is needed for all backcountry in Glacier National Park. <a href="#" class="rp-open">Rogers Pass today</a></p>`);
      el.innerHTML = `<h4>Rogers Pass</h4>${parts.join("")}`;
      el.hidden = false;
      el.querySelector(".rp-open")?.addEventListener("click", (ev) => { ev.preventDefault(); card.open = true; renderCard(); if (window.tfPanelScrollTo) window.tfPanelScrollTo(card, "start", true); });
    };
    if (info) fill(); else load()?.then(fill);
  });

  // ---------- Layers switch ----------
  const btn = document.createElement("button");
  btn.type = "button"; btn.id = "rogersBtn";
  btn.title = "Rogers Pass Winter Permit areas, open or closed today (Parks Canada), with parking, huts and official terrain classes";
  btn.textContent = "Rogers Pass permit areas";
  function placeBtn() {
    if (btn.isConnected) return true;
    return !!window.tfSkiSlot && window.tfSkiSlot("places", btn, { label: "Rogers Pass permit areas", bg: "linear-gradient(135deg, #2f9e44 50%, #e03131 50%)" });
  }
  btn.addEventListener("click", () => { on = !on; try { localStorage.setItem("tf:skiRogers", String(on)); } catch {} sync(); });
  function sync() {
    placeBtn();
    btn.setAttribute("aria-pressed", String(on)); btn.classList.toggle("on", on);
    if (on && isSki() && map.getBounds().intersects(BOX)) load();
    const want = shown();
    for (const l of [layer, pins]) { if (want && !map.hasLayer(l)) l.addTo(map); if (!want && map.hasLayer(l)) map.removeLayer(l); }
    draw(); renderCard();
  }
  let lastSki = isSki();
  new MutationObserver(() => { if (isSki() !== lastSki) { lastSki = isSki(); sync(); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(() => { if (!btn.isConnected) placeBtn(); }).observe($("layersMenu") || document.body, { childList: true, subtree: true });
  window.tfRogers = { areaAt: (lat, lon) => (status ? areaAt(lat, lon).map((a) => ({ name: a.name, group: a.group, open: isOpen(a) })) : null), load };
  sync();
  on3d();
})();
