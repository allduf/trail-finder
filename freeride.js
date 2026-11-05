// Freeride lines in Skiing (alex 2026-11-03: "i want to add all the ski lines. downhill lines... im not talking about the
// ski trail im talking about the freeride lines. if you find any anywhere add them on a layer 'freeride lines'", then
// "I want it to be as accurate as possible"): the named off-piste descents (chutes, couloirs, faces, bowls skied as a
// line, glades, cliffs), not the groomed runs. On the flat map and the 3D map (map3d.js copies the lines and writes their
// names).
// Only lines skiers have mapped where they really are: the OpenStreetMap ski routes winter.js already loads (the home
// region, data/ski-canada/ and the nightly Canada squares ca/w/), so they're everywhere in Canada and updated nightly,
// and nothing is drawn from a guess. A route is a freeride line when it's a named downhill line (not an area, a skin
// track, a road or a park) that OpenStreetMap rates freeride or extreme, or expert with no grooming or with a chute,
// couloir, face, bowl... in its name. data/freeride-lines.json (hand-kept) lists resorts whose run descriptions count
// too and the real lines with no such word (Whistler Blackcomb), fixes names, and leaves out the slackcountry lines (their own layer, slackcountry.js).
// A tap opens the route's card (winter.js) with a Freeride line part: rating, in the ski area or outside it, drop,
// steepest slope and which way it faces. A "Freeride lines" switch in the Resorts group of the Skiing layers (tf:skiFree).
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const isSki = () => document.body.classList.contains("sport-ski");
  let on = true;
  try { on = localStorage.getItem("tf:skiFree") !== "false"; } catch {}

  const C = { line: "#9c36b5", extreme: "#5f1a73", edge: "#1d0826", sel: "#ffe14d" };
  const RATE = { freeride: "Freeride", extreme: "Extreme", expert: "◆◆ Expert", advanced: "◆ Advanced" };
  const FACE = { n: "north", ne: "north-east", e: "east", se: "south-east", s: "south", sw: "south-west", w: "west", nw: "north-west" };
  const LINES_Z = 11, NAMES_Z = 14, MAX_NAMES = 45;

  // Not a descent: ways up, roads, links between runs, parks, lifts.
  const NOT = /\b(trail|road|skin|climb|track|uptrack|traverse|access|cutover|connector|exit|park|race|training|school|learning|freestyle|zone|lifts?|chair|chairlift|gondola|t-bar|catwalk|cat ?track|run ?out|green|blue)\b/i;
  const TERRAIN = /chute|couloir|cliff|face|bowl|glade|ridge|gull(e)?y|drop|cirque|wall|cornice|notch|slot|steep|spine|headwall|shoulder|hourglass|nose|trees/i;
  const GROOMED = /^(classic|skating|classic\+skating|classic;skating)$/;

  let hand = null;
  const handLoad = fetch("data/freeride-lines.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((d) => {
      hand = (d && d.resorts || []).map((x) => ({ ...x, bounds: L.latLngBounds([x.box[0], x.box[1]], [x.box[2], x.box[3]]), skip: new Set((x.skip || []).map((n) => n.toLowerCase())), keep: new Set((x.keep || []).map((n) => n.toLowerCase())) }));
      return hand;
    });
  // The slackcountry lines' own OpenStreetMap ways stay on that layer.
  let slackIds = new Set();
  const slackLoad = fetch("data/slackcountry.json").then((r) => (r.ok ? r.json() : null)).then((d) => {
    slackIds = new Set((d && d.resorts || []).flatMap((rs) => (rs.lines || []).flatMap((l) => l.osm || [])));
  }).catch(() => {});
  let ready = false;
  const handReady = Promise.all([handLoad, slackLoad]).then(() => { ready = true; });

  const resortAt = (p) => (hand || []).find((x) => x.bounds.contains(p));
  function isFree(r) {
    if (r._fr !== undefined) return r._fr;
    let ok = false;
    const t = r.tags || {}, n = r.name || "";
    if (n && !/^\d+$/.test(n) && !r.area && r.lines && r.lines.length && /^(resort|offpiste|tour)$/.test(r.type) && !slackIds.has(r.id) && !NOT.test(n)
      && (!t["piste:type"] || t["piste:type"] === "downhill") && !GROOMED.test(t["piste:grooming"] || "")) {
      const p = r.lines[0][0], rs = resortAt(p), d = r.diff;
      if (rs && rs.skip.has(n.toLowerCase())) ok = false;
      else if (d === "freeride" || d === "extreme") ok = true;
      // An expert run alone is not a line: marked trail-map runs cut through the trees (Insanity, Powerline at Whistler
      // Creekside, alex 2026-11-04 "not a freeride line") are rated expert too. It needs a chute, face, bowl... in its name,
      // no grooming, or (resorts with expertWords, where the mapper describes every run) those words in its OpenStreetMap
      // description, or its name in the resort's hand-checked keep list.
      else if (d === "expert") ok = TERRAIN.test(n) || /^(backcountry|no|mogul)$/.test(t["piste:grooming"] || "")
        || (!!rs && r.type !== "tour" && (rs.keep.has(n.toLowerCase()) || (!!rs.expertWords && TERRAIN.test(t.description || ""))));
      else if (d === "advanced" && r.type === "offpiste") ok = TERRAIN.test(n);
      if (ok && rs && rs.rename && rs.rename[n]) r.frName = rs.rename[n];
    }
    if (ready) r._fr = ok;   // decided for good once the hand file and the slackcountry lines are in
    return ok;
  }
  const nameOf = (r) => r.frName || r.name;
  const inBounds = (r) => r.type !== "tour";

  // ---------- map ----------
  map.createPane("freeride").style.zIndex = 423;   // over the ski routes (420), under the slackcountry lines (425)
  const renderer = L.canvas({ pane: "freeride", padding: 0.3, tolerance: L.Browser.touch ? 10 : 5 });
  if (window.tfSkiTapThrough) window.tfSkiTapThrough(renderer);
  const layer = L.layerGroup(), names = L.layerGroup();
  let selId = "", list = [];
  const shown = () => on && isSki();
  const planning = () => !!document.querySelector(".sk-planbar:not([hidden])");
  function collect() {
    if (!window.tfSki || !window.tfSki.routes) return [];
    const b = map.getBounds().pad(0.5);
    return window.tfSki.routes().filter((r) => r.bounds && b.intersects(r.bounds) && isFree(r));
  }
  function draw() {
    layer.clearLayers(); names.clearLayers();
    list = [];
    if (!shown() || map.getZoom() < LINES_Z) { placeList(); return; }
    list = collect();
    const sel = list.find((r) => r.id === selId);
    for (const r of [...list.filter((r) => r !== sel), ...(sel ? [sel] : [])]) {
      const me = r === sel, ex = r.diff === "extreme";
      for (const line of r.lines) {
        layer.addLayer(L.polyline(line, { renderer, color: me ? C.sel : C.edge, weight: me ? 10 : 7, opacity: me ? 1 : 0.55, interactive: false }));
        const l = L.polyline(line, { renderer, color: ex ? C.extreme : C.line, weight: me ? 5.5 : ex ? 4.5 : 4, opacity: 1, label: nameOf(r) });
        l.bindTooltip(esc(`${nameOf(r)}: freeride line`), { sticky: true });
        l.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          // Planning a tour: add the whole line, or just a point there (winter.js asks).
          if (planning()) { window.tfSki.trip.planOffer({ name: nameOf(r), kind: "Freeride line", at: e.latlng, lines: r.lines, add: () => window.tfSki.trip.planRouteLine(r) }); return; }
          selId = r.id; window.tfSki.open(r); draw();
        });
        l.options.planOffer = true;   // map3d.js: in 3D while planning, a tap on it still comes here
        layer.addLayer(l);
      }
    }
    // Names on the flat map up close: each name once, the piece nearest the middle of the screen.
    if (map.getZoom() >= NAMES_Z) {
      const c = map.getCenter(), vb = map.getBounds(), best = new Map();
      for (const r of list) for (const line of r.lines) {
        const p = line[Math.floor(line.length / 2)];
        if (!vb.contains(p)) continue;
        const d = c.distanceTo(p), k = nameOf(r).toLowerCase(), b = best.get(k);
        if (!b || d < b.d) best.set(k, { d, p, r });
      }
      // Names don't pile on each other: a name whose spot is too near one already written waits for a closer zoom.
      const put = [];
      for (const { p, r } of [...best.values()].sort((a, b) => a.d - b.d)) {
        if (put.length >= MAX_NAMES) break;
        const q = map.latLngToContainerPoint(p), w = 12 + nameOf(r).length * 5.7;   // 9.5 px text since 2026-11-05 (was 11)
        if (put.some((o) => Math.abs(o.y - q.y) < 20 && q.x < o.x + o.w && o.x < q.x + w)) continue;
        put.push({ x: q.x, y: q.y, w });
        names.addLayer(L.tooltip({ permanent: true, direction: "right", offset: [6, 0], className: "fr-name", interactive: false }).setLatLng(p).setContent(esc(nameOf(r))));
      }
    }
    placeList();
  }
  const css = document.createElement("style");
  css.textContent = `
.leaflet-tooltip.fr-name { background: ${C.line}; color: #fff; border: 1.5px solid #fff; border-radius: 6px; padding: 1px 5px; font: 700 9.5px/1.25 system-ui, sans-serif; box-shadow: 0 1px 3px #0007; white-space: nowrap; }
.leaflet-tooltip.fr-name::before { display: none; }
#skiPane .fr-open { font: inherit; font-size: .88rem; font-weight: 700; padding: 10px 8px; border-radius: 12px; border: 1px solid ${C.line}; background: color-mix(in srgb, ${C.line} 10%, var(--chip)); color: var(--fg); cursor: pointer; width: 100%; margin-top: 6px; }
.fr-sec { margin: 8px 0; padding: 9px 11px; border-radius: 10px; border: 1px solid color-mix(in srgb, ${C.line} 45%, transparent); background: color-mix(in srgb, ${C.line} 8%, transparent); }
.fr-sec h4 { margin: 0 0 4px; font-size: .86rem; }
.fr-sec p { margin: 4px 0; font-size: .84rem; line-height: 1.4; }
.fr-sec .fr-pill { display: inline-block; padding: 1px 7px; border-radius: 5px; background: ${C.line}; color: #fff; font-weight: 700; font-size: .76rem; margin-right: 4px; }
.fr-sec .fr-pill.ex { background: ${C.extreme}; }
.fr-sec .fr-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 5px; margin: 6px 0; }
.fr-sec .fr-facts div { background: var(--chip); border-radius: 8px; padding: 5px 8px; }
.fr-sec .fr-facts small { display: block; color: var(--muted); font-size: .7rem; }
.fr-sec .fr-facts b { font-size: .9rem; }
.fr-sec .fr-small { font-size: .76rem; color: var(--muted); }
dialog.fr-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 16px; width: min(560px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; font-size: .92rem; box-sizing: border-box; }
dialog.fr-dlg::backdrop { background: rgba(0,0,0,.55); }
dialog.fr-dlg h2 { margin: 0 40px 2px 0; font-family: var(--font-display); font-size: 1.2rem; }
dialog.fr-dlg .fr-x { position: absolute; top: 10px; right: 10px; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font-size: 18px; cursor: pointer; }
dialog.fr-dlg .fr-sub { color: var(--muted); font-size: .84rem; margin: 0 0 10px; }
dialog.fr-dlg h4 { margin: 12px 0 2px; font-size: .78rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
dialog.fr-dlg .fr-row { all: unset; box-sizing: border-box; width: 100%; display: block; padding: 8px 6px; border-radius: 8px; cursor: pointer; font-weight: 600; }
dialog.fr-dlg .fr-row:hover, dialog.fr-dlg .fr-row:focus-visible { background: var(--chip); }
dialog.fr-dlg .fr-row small { display: block; color: var(--muted); font-size: .76rem; font-weight: 400; margin-top: 1px; }
dialog.fr-dlg a { color: var(--accent); font-weight: 600; }
dialog.fr-dlg .fr-small { font-size: .78rem; color: var(--muted); }
`;
  document.head.appendChild(css);

  // ---------- loading ----------
  let busy = false, again = false;
  function refresh() {
    if (!shown()) { draw(); return; }
    if (map.getZoom() < LINES_Z || !window.tfSki || !window.tfSki.loadIn) { draw(); return; }
    if (busy) { again = true; return; }
    busy = true;
    Promise.all([handReady, window.tfSki.loadIn(map.getBounds().pad(0.25))]).catch(() => {}).finally(() => {
      busy = false; draw();
      if (again) { again = false; refresh(); }
    });
  }
  map.on("moveend", () => { if (isSki() && on) refresh(); });
  window.addEventListener("tf:ski-more", () => { if (shown()) draw(); });
  window.addEventListener("tf:ski-data", () => { if (shown()) setTimeout(draw, 0); });

  // ---------- in a route's card ----------
  window.addEventListener("tf:ski-select", (e) => {
    const { item: r, el } = e.detail || {};
    if (!r || !el || !r.lines || r.lat != null) return;
    if (r.id !== selId) { selId = isFree(r) ? r.id : ""; if (shown()) draw(); }
    if (!isFree(r)) return;
    const sec = document.createElement("div");
    sec.className = "fr-sec";
    const rs = resortAt(r.lines[0][0]), ex = r.diff === "extreme";
    const where = inBounds(r)
      ? `<p>In the ski area: skied when ski patrol opens it. Check the resort's terrain status: steep lines close often (wind, avalanche control, thin snow).</p>`
      : `<p class="av-warn">Backcountry line: no ski patrol, no avalanche control. Avalanche transceiver, probe, shovel and the training to use them, and read today's avalanche forecast.</p>`;
    sec.innerHTML = `<h4>Freeride line</h4>
      <p><span class="fr-pill${ex ? " ex" : ""}">${esc(RATE[r.diff] || "Freeride")}</span>${rs ? esc(rs.name) : ""}</p>
      ${where}
      <div class="fr-facts" aria-live="polite"><div><small>Steepest</small><b>…</b></div></div>
      <p class="fr-small">Line mapped on OpenStreetMap by skiers who know it. Steepness and aspect come from terrain tiles about 30 m apart, so short steeper rolls, cliffs and cornices don't show.${rs && rs.guide ? ` More lines and photos: <a href="${esc(rs.guide.u)}" target="_blank" rel="noopener">${esc(rs.guide.t)} ↗</a>` : ""}</p>`;
    // Near the top of the card, above Conditions, so it shows without scrolling on a phone.
    const cond = document.getElementById("skCond");
    (cond && cond.closest("#skDetail") ? cond : el).before(sec);
    const T = window.tfSki && window.tfSki.trip;
    if (!T) return;
    T.info(r.lines).then((d) => {
      if (!sec.isConnected || !d) return;
      const faces = (d.faces || []).slice(0, 2).map((f) => FACE[f] || f);
      const facts = [
        d.maxSlope ? ["Steepest", `about ${Math.round(d.maxSlope)}°`] : null,
        d.max ? ["Drop", `${Math.round(d.max - d.min).toLocaleString()} m`] : null,
        faces.length ? ["Faces", faces.join(", ")] : null,
        d.max ? ["Top", `${Math.round(d.max).toLocaleString()} m`] : null,
      ].filter(Boolean);
      sec.querySelector(".fr-facts").innerHTML = facts.map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join("");
    }, () => { const f = sec.querySelector(".fr-facts"); if (f) f.remove(); });
  });
  // Tapping the map away from the line closes its card (winter.js): unselect it here too.
  map.on("click", () => { if (selId) setTimeout(() => { if (selId && !document.querySelector("#skDetail .fr-sec")) { selId = ""; draw(); } }, 0); });

  // ---------- the list of lines in view ----------
  const dlg = document.createElement("dialog");
  dlg.className = "fr-dlg"; dlg.setAttribute("aria-label", "Freeride lines");
  document.body.appendChild(dlg);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  // Same-name pieces as one line; grouped by the ski area or backcountry.
  function groups() {
    const vb = map.getBounds(), by = new Map();
    for (const r of list) {
      if (!vb.intersects(r.bounds)) continue;
      const k = nameOf(r).toLowerCase() + "|" + inBounds(r);
      if (!by.has(k)) by.set(k, r);
    }
    return [...by.values()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  }
  function openList() {
    const g = groups(), inA = g.filter(inBounds), out = g.filter((r) => !inBounds(r));
    const rs = resortAt(map.getCenter());
    const row = (r) => `<button type="button" class="fr-row" data-id="${esc(r.id)}">${esc(nameOf(r))}<small>${esc(RATE[r.diff] || "Freeride")}</small></button>`;
    dlg.innerHTML = `<button type="button" class="fr-x" aria-label="Close">✕</button>
      <h2>Freeride lines here</h2>
      <p class="fr-sub">${g.length} named off-piste line${g.length === 1 ? "" : "s"} in view, mapped by skiers on OpenStreetMap. Tap one for its steepness, drop and which way it faces.</p>
      ${inA.length ? `<h4>In the ski area (${inA.length})</h4>${inA.map(row).join("")}` : ""}
      ${out.length ? `<h4>Backcountry: no ski patrol (${out.length})</h4>${out.map(row).join("")}` : ""}
      ${rs && rs.guide ? `<p class="fr-small">The guidebook with photos of every line: <a href="${esc(rs.guide.u)}" target="_blank" rel="noopener">${esc(rs.guide.t)} ↗</a></p>` : ""}
      <p class="fr-small">Only lines mapped where they really are. Know a line that's missing? Tell us its name and where it starts.</p>`;
    dlg.querySelector(".fr-x").onclick = () => dlg.close();
    dlg.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => {
      const r = list.find((x) => x.id === b.dataset.id);
      if (!r) return;
      dlg.close(); selId = r.id; window.tfSki.open(r, true); draw();
    }));
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }
  const listBtn = document.createElement("button");
  listBtn.type = "button"; listBtn.className = "fr-open"; listBtn.hidden = true;
  listBtn.addEventListener("click", openList);
  function placeList() {
    const n = shown() && map.getZoom() >= LINES_Z ? groups().length : 0;
    listBtn.hidden = !n;
    if (n) listBtn.textContent = `⛷ Freeride lines here (${n})`;
    if (!listBtn.isConnected) { const after = document.querySelector("#skiPane .sc-open") || document.querySelector("#skiPane .sk-acts"); if (after) after.after(listBtn); }
  }

  // ---------- map key ----------
  function keyItems() {
    const ul = $("skKeyList");
    if (!ul) return;
    ul.querySelectorAll(".fr-k").forEach((x) => x.remove());
    if (!shown()) return;
    ul.insertAdjacentHTML("beforeend", `<li class="fr-k"><span class="sk-kic"><i style="background:${C.line};height:4px;box-shadow:0 0 0 2px ${C.edge}8c"></i></span>Freeride line (darker: extreme)</li>`);
  }
  let keyObs = null;
  function watchKey() {
    const ul = $("skKeyList");
    if (!ul || keyObs) return;
    keyObs = new MutationObserver(() => { if (!ul.querySelector(".fr-k") && shown()) keyItems(); });
    keyObs.observe(ul, { childList: true });
  }

  // ---------- Layers switch (Resorts group) ----------
  const btn = document.createElement("button");
  btn.type = "button"; btn.id = "freeBtn";
  btn.title = "Named off-piste lines: chutes, couloirs, faces, glades. Not the groomed runs";
  btn.textContent = "Freeride lines";
  const placeBtn = () => { if (!btn.isConnected && window.tfSkiSlot) window.tfSkiSlot("resort", btn, { label: "Freeride lines", sym: "⛷", bg: C.line }); };
  btn.addEventListener("click", () => { on = !on; try { localStorage.setItem("tf:skiFree", String(on)); } catch {} sync(); });
  function sync() {
    placeBtn();
    btn.setAttribute("aria-pressed", String(on)); btn.classList.toggle("on", on);
    const want = shown();
    for (const l of [layer, names]) { if (want && !map.hasLayer(l)) l.addTo(map); if (!want && map.hasLayer(l)) map.removeLayer(l); }
    if (!want && dlg.open) dlg.close();
    refresh(); watchKey(); keyItems();
  }
  let lastSki = isSki();
  new MutationObserver(() => { if (isSki() !== lastSki) { lastSki = isSki(); sync(); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(() => { if (!btn.isConnected) placeBtn(); }).observe($("layersMenu") || document.body, { childList: true, subtree: true });
  window.tfFreeride = { list: () => groups().map((r) => ({ id: r.id, name: nameOf(r), diff: r.diff, inBounds: inBounds(r) })), open: openList, isFree };
  sync();
})();
