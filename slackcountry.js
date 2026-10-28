// Slackcountry in Skiing (alex 2026-10-25: "find all the slack country line on whistler blackcomb and add a layer with
// slack-country in resort", then "find all the slackcountry data that you can for every resort"): the lines skied from the lifts that leave the ski area through a backcountry gate. On the
// flat map and the 3D map (map3d.js copies the lines; the gates and names are 3D markers too):
//  - each descent as a solid red line on a white edge, the way up from the gate dashed, the way back dotted orange
//  - the gates (red), and where a line leaves without a gate (grey)
//  - a line's card: the warning that it's outside ski patrol and avalanche control and needs avalanche gear, the gate,
//    the way up, the descent (drop, steepest slope, which way it faces), the terrain class (estimated from the terrain,
//    like ATES) with today's go/caution light when the avalanche forecast is loaded, the way back, what to watch for,
//    and the sources
//  - zoomed out (zoom 8 to 11), one pin per resort in view that opens its list of lines, by gate (gates with no line
//    drawn yet are listed too, with where they lead)
// Data: data/slackcountry.json, hand-kept, one entry per resort, so other resorts are added there with no code change
// (scripts/build-slackcountry.mjs adds the terrain numbers). A "Slackcountry" switch in the Resorts group of the Skiing
// layers turns it on and off (tf:skiSlack).
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const isSki = () => document.body.classList.contains("sport-ski");
  let on = true;
  try { on = localStorage.getItem("tf:skiSlack") !== "false"; } catch {}

  const C = { ski: "#e8125c", out: "#f08c00", gate: "#e03131", none: "#868e96" };
  const CLS = { 1: { label: "Simple", color: "#2f9e44" }, 2: { label: "Challenging", color: "#1971c2" }, 3: { label: "Complex", color: "#1a1a1a" } };
  const DIFF = { intermediate: "■ Intermediate", advanced: "◆ Advanced", expert: "◆◆ Expert" };
  const FACE = { n: "north", ne: "north-east", e: "east", se: "south-east", s: "south", sw: "south-west", w: "west", nw: "north-west" };
  const NAMES_Z = 13, LINES_Z = 12, RESORT_Z = 8;   // names from zoom 13; the lines from 12 (below that, one pin per resort)

  const css = document.createElement("style");
  css.textContent = `
.sc-pin { box-sizing: border-box; display: inline-block; padding: 3px 8px; border-radius: 999px; background: ${C.ski}; color: #fff; border: 2px solid #fff; box-shadow: 0 1px 4px #0008; font: 700 11px/1.2 system-ui, sans-serif; white-space: nowrap; cursor: pointer; transform: translate(-50%, -50%); }
.sc-pin.on { background: #ffe14d; color: #111; }
.sc-gate { box-sizing: border-box; display: inline-flex; align-items: center; gap: 3px; padding: 3px 7px; border-radius: 6px; background: ${C.gate}; color: #fff; border: 2px solid #fff; box-shadow: 0 1px 4px #0008; font: 800 10px/1.2 system-ui, sans-serif; letter-spacing: .03em; text-transform: uppercase; white-space: nowrap; cursor: pointer; transform: translate(-50%, -50%); }
.sc-gate.none { background: ${C.none}; }
.sc-resort { box-sizing: border-box; display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; background: ${C.ski}; color: #fff; border: 2px solid #fff; box-shadow: 0 1px 4px #0008; font: 700 11px/1.2 system-ui, sans-serif; white-space: nowrap; cursor: pointer; transform: translate(-50%, -50%); }
#skiPane .sc-open { font: inherit; font-size: .88rem; font-weight: 700; padding: 10px 8px; border-radius: 12px; border: 1px solid ${C.ski}; background: color-mix(in srgb, ${C.ski} 10%, var(--chip)); color: var(--fg); cursor: pointer; width: 100%; }
dialog.sc-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 16px; width: min(620px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; font-size: .92rem; box-sizing: border-box; }
dialog.sc-dlg::backdrop { background: rgba(0,0,0,.55); }
dialog.sc-dlg h2 { margin: 0 40px 2px 0; font-family: var(--font-display); font-size: 1.25rem; overflow-wrap: anywhere; }
dialog.sc-dlg h3 { margin: 14px 0 4px; font-size: .9rem; }
dialog.sc-dlg p { margin: 0 0 6px; line-height: 1.4; }
dialog.sc-dlg ul { margin: 0; padding-left: 18px; }
dialog.sc-dlg li { margin: 3px 0; line-height: 1.35; }
dialog.sc-dlg a { color: var(--accent); font-weight: 600; }
dialog.sc-dlg .sc-sub { color: var(--muted); font-size: .84rem; margin-bottom: 10px; }
dialog.sc-dlg .sc-x { position: absolute; top: 10px; right: 10px; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font-size: 18px; cursor: pointer; }
dialog.sc-dlg .sc-warn { background: #ffe3e3; color: #7d0a0a; border: 1px solid #ffa8a8; border-radius: 10px; padding: 9px 11px; margin: 8px 0 10px; font-size: .86rem; line-height: 1.4; }
dialog.sc-dlg .sc-warn b { display: block; font-size: .92rem; margin-bottom: 2px; }
dialog.sc-dlg .sc-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 6px; margin: 8px 0; }
dialog.sc-dlg .sc-facts div { background: var(--chip); border-radius: 10px; padding: 6px 9px; }
dialog.sc-dlg .sc-facts small { display: block; color: var(--muted); font-size: .72rem; }
dialog.sc-dlg .sc-facts b { font-size: .95rem; }
dialog.sc-dlg .sc-cls { display: inline-block; font-weight: 700; font-size: .78rem; padding: 1px 7px; border-radius: 5px; color: #fff; background: var(--c); box-shadow: 0 0 0 1px #fff3; }
dialog.sc-dlg .sc-light { display: flex; gap: 8px; align-items: flex-start; border-radius: 10px; padding: 8px 10px; margin: 6px 0; border: 2px solid var(--c); }
dialog.sc-dlg .sc-light i { flex: none; width: 14px; height: 14px; border-radius: 50%; background: var(--c); margin-top: 3px; }
dialog.sc-dlg .sc-acts { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 2px; }
dialog.sc-dlg .sc-acts button, dialog.sc-dlg .sc-acts a { font: inherit; min-height: 0; height: auto; line-height: 1.3; font-size: .84rem; font-weight: 700; padding: 8px 13px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; text-decoration: none; }
dialog.sc-dlg .sc-acts .go { background: ${C.ski}; border-color: ${C.ski}; color: #fff; }
dialog.sc-dlg .sc-key { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: .78rem; color: var(--muted); margin: 4px 0 8px; }
dialog.sc-dlg .sc-key i { display: inline-block; width: 22px; height: 0; margin-right: 5px; vertical-align: middle; border-top: 4px solid ${C.ski}; }
dialog.sc-dlg .sc-key i.up { border-top: 3px dashed ${C.ski}; }
dialog.sc-dlg .sc-key i.out { border-top: 4px dotted ${C.out}; }
dialog.sc-dlg .sc-small { font-size: .78rem; color: var(--muted); }
dialog.sc-dlg .sc-list h4 { margin: 14px 0 2px; font-size: .8rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }
dialog.sc-dlg .sc-list > p { font-size: .82rem; }
dialog.sc-dlg .sc-list button { all: unset; box-sizing: border-box; width: 100%; display: block; padding: 8px 6px; border-radius: 8px; cursor: pointer; font-weight: 600; }
dialog.sc-dlg .sc-list button:hover, dialog.sc-dlg .sc-list button:focus-visible { background: var(--chip); }
dialog.sc-dlg .sc-list button small { display: block; color: var(--muted); font-size: .76rem; font-weight: 400; margin-top: 1px; }
`;
  document.head.appendChild(css);

  // ---------- data ----------
  let doc = null, loading = null, err = "";
  const pairs = (flat) => { const l = []; for (let i = 0; i + 1 < (flat || []).length; i += 2) l.push([flat[i], flat[i + 1]]); return l; };
  function load() {
    if (doc || loading) return loading || Promise.resolve(doc);
    loading = fetch("data/slackcountry.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => {
        for (const rs of d.resorts || []) {
          rs.bounds = L.latLngBounds([rs.box[0], rs.box[1]], [rs.box[2], rs.box[3]]);
          rs.gateById = new Map((rs.gates || []).map((g) => [g.id, g]));
          for (const l of rs.lines || []) {
            l.resort = rs;
            l.ski = pairs(l.g.ski); l.up = pairs(l.g.up); l.out = pairs(l.g.out);
            l.cls = l.cls || (l.calc && l.calc.cls) || 3;
          }
        }
        doc = d;
        return d;
      })
      .catch((e) => { err = e.message; return null; })
      .finally(() => { loading = null; sync(); });
    return loading;
  }
  const resorts = () => (doc ? doc.resorts || [] : []);
  // The resorts in view, the one nearest the middle of the map first (the panel button opens its list).
  const near = () => {
    const c = map.getCenter();
    return resorts().filter((rs) => map.getBounds().intersects(rs.bounds)).sort((a, b) => c.distanceTo(a.bounds.getCenter()) - c.distanceTo(b.bounds.getCenter()));
  };

  // ---------- map ----------
  map.createPane("slack").style.zIndex = 425;   // over the ski routes (420), so the line that's tapped is this one
  const renderer = L.canvas({ pane: "slack", padding: 0.3, tolerance: L.Browser.touch ? 10 : 5 });
  if (window.tfSkiTapThrough) window.tfSkiTapThrough(renderer);   // so the ski routes below still take taps (winter.js)
  const layer = L.layerGroup(), pins = L.layerGroup();
  let sel = null, glMarkers = [];
  const shown = () => on && isSki() && !!doc;
  const planning = () => !!document.querySelector(".sk-planbar:not([hidden])");
  function draw() {
    layer.clearLayers(); pins.clearLayers();
    glMarkers.forEach((m) => m.remove()); glMarkers = [];
    if (!shown()) return;
    const z = map.getZoom(), gl = window.trailMap3d && window.maplibregl ? window.trailMap3d : null;
    const add = (lat, lon, html, tip, go) => {
      const m = L.marker([lat, lon], { icon: L.divIcon({ className: "", html, iconSize: [0, 0], iconAnchor: [0, 0] }), keyboard: true, title: tip, zIndexOffset: 500 });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); go(); });
      pins.addLayer(m);
      if (gl) {
        const el = document.createElement("div"); el.title = tip; el.innerHTML = html; el.firstElementChild.style.transform = "none";   // MapLibre centres the marker itself
        el.addEventListener("click", (e) => { e.stopPropagation(); go(); });
        glMarkers.push(new maplibregl.Marker({ element: el, anchor: "center", opacityWhenCovered: 1 }).setLngLat([lon, lat]).addTo(gl));
      }
    };
    for (const rs of resorts()) {
      if (z < LINES_Z) {
        // One pin per resort, only once zoomed in to a region (zoomed out to Canada they'd pile up), and only in view.
        if (z < RESORT_Z || !map.getBounds().pad(0.2).contains([rs.lat, rs.lon])) continue;
        add(rs.lat, rs.lon, `<span class="sc-resort">⛷ ${esc(rs.short || rs.name)} · ${nLines(rs)}</span>`, `${rs.name}: slackcountry lines from the lifts`, () => openList(rs));
        continue;
      }
      if (!map.getBounds().pad(0.5).intersects(rs.bounds)) continue;
      // The selected line on top: its way up and back bolder, the others' fainter.
      const order = [...rs.lines].sort((a, b) => (a === sel) - (b === sel));
      for (const l of order) {
        const me = l === sel, dim = sel && !me;
        const tap = (p) => p.on("click", (e) => { if (planning()) return; L.DomEvent.stopPropagation(e); open(l); });
        const tip = `${l.name}: slackcountry, outside ski patrol`;
        // The ways up and back are shared by several lines, so only the descents take taps.
        if (l.out.length > 1) layer.addLayer(L.polyline(l.out, { renderer, color: C.out, weight: me ? 5 : 3.5, opacity: dim ? 0.35 : 0.95, dashArray: "1 7", lineCap: "round", interactive: false }));
        if (l.up.length > 1) layer.addLayer(L.polyline(l.up, { renderer, color: C.ski, weight: me ? 3.5 : 2.5, opacity: dim ? 0.3 : 0.85, dashArray: "7 6", interactive: false }));
        // A dark edge: the red reads on snow (3D winter photos) as well as on the green map.
        layer.addLayer(L.polyline(l.ski, { renderer, color: me ? "#ffe14d" : "#2b0612", weight: me ? 10 : 8, opacity: dim ? 0.3 : me ? 1 : 0.7, interactive: false }));
        layer.addLayer(tap(L.polyline(l.ski, { renderer, color: C.ski, weight: me ? 6 : 5, opacity: dim ? 0.55 : 1 }).bindTooltip(esc(tip), { sticky: true })));
        if (z >= NAMES_Z || me) {
          const at = l.ski[Math.floor((l.ski.length - 1) * 0.4)];   // on the line, clear of the gate pins at the tops
          add(at[0], at[1], `<span class="sc-pin${me ? " on" : ""}">${esc(l.short || l.name)}</span>`, tip, () => open(l));
        }
      }
      for (const g of rs.gates) {
        add(g.lat, g.lon, `<span class="sc-gate${g.none ? " none" : ""}">${g.none ? "No gate" : "Gate"}</span>`, g.name, () => openGate(rs, g));
      }
    }
  }
  // Skiing's files load when Skiing is picked (winter.js), often after the 3D map was built: draw on that one too.
  const on3d = () => {
    const gl = window.trailMap3d; if (!gl) return;
    if (gl.style && (gl.style._loaded || gl.isStyleLoaded())) draw(); else { gl.once("style.load", draw); gl.once("load", draw); }
  };
  window.addEventListener("tf:map3d", on3d);
  let zBand = 0;
  const bandOf = (z) => (z < RESORT_Z ? -1 : z < LINES_Z ? 0 : z < NAMES_Z ? 1 : 2);
  map.on("zoomend", () => { const b = bandOf(map.getZoom()); if (b !== zBand) { zBand = b; if (shown()) draw(); } });
  let nearKey = "";
  map.on("moveend", () => {
    if (!isSki() || !on) return;
    if (!doc && !loading) load();
    const k = near().map((r) => r.id).join();
    if (k !== nearKey) { nearKey = k; placeList(); if (shown()) draw(); }
  });

  // ---------- one line ----------
  const dlg = document.createElement("dialog");
  dlg.className = "sc-dlg";
  dlg.setAttribute("aria-label", "Slackcountry line");
  document.body.appendChild(dlg);
  const linkHtml = (l) => `<a href="${esc(l.u)}" target="_blank" rel="noopener">${esc(l.t)} ↗</a>`;
  const forecastUrl = (p) => `https://avalanche.ca/map?lat=${p[0].toFixed(4)}&lng=${p[1].toFixed(4)}`;
  const warnHtml = (rs) => `<div class="sc-warn" role="note"><b>⚠ Outside the ski area: no ski patrol, no avalanche control</b>Past the gate it's the backcountry. Everyone needs an avalanche transceiver, a probe and a shovel, and the training to use them. Read today's avalanche forecast first.<br><b style="display:inline;font-size:inherit">${esc(rs.emergency || "Emergency: 911.")}</b></div>`;
  const clsPill = (c) => `<span class="sc-cls" style="--c:${CLS[c].color}">${CLS[c].label}</span>`;
  // Today's danger at the top of the line with its terrain class: the Avaluator light (green / yellow / red), when the
  // avalanche forecast has been loaded (winter.js); otherwise only the link to the forecast.
  function lightHtml(l) {
    const T = window.tfTerrain, top = l.ski[0], c = l.calc || {};
    const dg = window.tfSki && window.tfSki.dangerAt ? window.tfSki.dangerAt(top[0], top[1], c.bottom || 0, c.top || 9999) : null;
    if (!T || !dg || !dg.r) return `<p><a href="${forecastUrl(top)}" target="_blank" rel="noopener">Today's avalanche forecast here ↗</a></p>`;
    const k = T.light(dg.r, l.cls), x = T.LIGHTS[k];
    const word = ["", "1 Low", "2 Moderate", "3 Considerable", "4 High", "5 Extreme"][dg.r] || "";
    return `<div class="sc-light" style="--c:${x.color}"><i aria-hidden="true"></i><div><b>${esc(x.label)}</b> today: danger ${esc(word)} on ${CLS[l.cls].label.toLowerCase()} terrain. ${esc(x.what)}<br><a href="${forecastUrl(top)}" target="_blank" rel="noopener">The full forecast ↗</a></div></div>`;
  }
  function open(l) {
    const rs = l.resort, g = rs.gateById.get(l.gate), back = l.ret && rs.gateById.get(l.ret), c = l.calc || {};
    sel = l; draw();
    const faces = (c.faces || []).map((f) => FACE[f] || f);
    const facts = [
      g ? ["Gate", g.none ? "None" : g.name.replace(/ gate.*$/i, "")] : null,
      c.drop ? ["Drop", `${c.drop.toLocaleString()} m`] : null,
      c.maxSlope ? ["Steepest", `about ${c.maxSlope}°`] : null,
      faces.length ? ["Faces", faces.slice(0, 2).join(", ")] : null,
      c.top ? ["Top", `${c.top.toLocaleString()} m`] : null,
      c.tripKm ? ["Whole trip", `${c.tripKm} km${c.climb >= 30 ? `, ↑ ${c.climb.toLocaleString()} m` : ""}`] : null,
    ].filter(Boolean);
    dlg.innerHTML = `<button type="button" class="sc-x" aria-label="Close">✕</button>
      <h2>${esc(l.name)}</h2>
      <p class="sc-sub">Slackcountry · ${esc(rs.name)}, ${esc(l.side)} · ${esc(DIFF[l.diff] || l.diff || "")}${l.kind === "tour" ? " · ski tour" : ""}</p>
      ${warnHtml(rs)}
      <p>${esc(l.about)}</p>
      <div class="sc-facts">${facts.map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join("")}</div>
      <h3>Avalanche terrain: ${clsPill(l.cls)} ${l.clsWhy ? "" : "<span class=\"sc-small\">(estimated)</span>"}</h3>
      <p class="sc-small">${esc(l.clsWhy || `Worked out from the shape of the ground, like the ATES scale: ${(c.why || []).join("; ")}. Forest, cornices and glaciers aren't seen.`)}</p>
      <div class="sc-lt">${lightHtml(l)}</div>
      <div class="sc-acts"><button type="button" class="go" data-act="show">Show on the map</button><button type="button" data-act="list">All lines here</button></div>
      <div class="sc-key"><span><i></i>Descent</span><span><i class="up"></i>Way up from the gate</span><span><i class="out"></i>Way back</span></div>
      <h3>The gate and the way up</h3>
      ${g ? `<p><b>${esc(g.name)}.</b> ${esc(g.note)}</p>` : ""}
      <p>${esc(l.access)}</p>
      <h3>The way back</h3>
      <p>${esc(l.exit)}</p>${back ? `<p class="sc-small">Back in through: ${esc(back.name)}.</p>` : ""}
      <h3>Watch out for</h3>
      <ul>${(l.hazards || []).map((h) => `<li>${esc(h)}</li>`).join("")}</ul>
      <h3>Before you go</h3>
      <ul>${(rs.rules || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      ${(l.src || []).length ? `<h3>Sources</h3><ul>${l.src.map((s) => `<li>${linkHtml(s)}</li>`).join("")}</ul>` : ""}
      <p class="sc-small">${l.approx ? "The line is drawn from the terrain model, not a GPS track: pick your own way. " : ""}Steepness and aspect come from terrain tiles about 30 m apart, so short steeper rolls and cliffs don't show. This map doesn't replace avalanche training, the day's forecast or a guide.</p>`;
    dlg.querySelector(".sc-x").onclick = () => dlg.close();
    dlg.querySelector('[data-act="show"]').onclick = () => { keep = true; dlg.close(); sel = l; map.fitBounds(L.latLngBounds([...l.up, ...l.ski, ...l.out]), { padding: [40, 40], maxZoom: 15 }); draw(); };
    dlg.querySelector('[data-act="list"]').onclick = () => openList(rs);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    // The forecast loads on first use: put the light in once it's there.
    setTimeout(() => { const lt = dlg.querySelector(".sc-lt"); if (lt && sel === l && dlg.open) lt.innerHTML = lightHtml(l); }, 2500);
  }
  function openGate(rs, g) {
    const lines = rs.lines.filter((l) => l.gate === g.id || l.ret === g.id);
    dlg.innerHTML = `<button type="button" class="sc-x" aria-label="Close">✕</button>
      <h2>${esc(g.name)}</h2>
      <p class="sc-sub">${esc(rs.name)}, ${esc(g.side)}${g.approx ? " · placed roughly" : ""}</p>
      ${warnHtml(rs)}
      <p>${esc(g.note)}</p>
      <div class="sc-list">${lines.length ? `<h4>Lines from here</h4>${lines.map(rowHtml).join("")}` : ""}</div>
      <div class="sc-acts"><button type="button" data-act="list">All lines here</button></div>`;
    dlg.querySelector(".sc-x").onclick = () => dlg.close();
    dlg.querySelector('[data-act="list"]').onclick = () => openList(rs);
    wireRows(rs);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }
  const rowHtml = (l) => {
    const c = l.calc || {};
    const bits = [DIFF[l.diff], c.drop ? `${c.drop.toLocaleString()} m down` : "", c.maxSlope ? `up to ${c.maxSlope}°` : "", (c.faces || [])[0] ? `faces ${FACE[c.faces[0]]}` : "", CLS[l.cls].label].filter(Boolean);
    return `<button type="button" data-line="${esc(l.id)}">${esc(l.name)}<small>${esc(bits.join(" · "))}</small></button>`;
  };
  const wireRows = (rs) => dlg.querySelectorAll("[data-line]").forEach((b) => (b.onclick = () => open(rs.lines.find((l) => l.id === b.dataset.line))));

  function nLines(rs) { const n = rs.lines.length, g = rs.gates.length; return n ? `${n} line${n > 1 ? "s" : ""}` : `${g} gate${g > 1 ? "s" : ""}`; }

  // ---------- a resort's lines, by gate ----------
  function openList(rs) {
    dlg.innerHTML = `<button type="button" class="sc-x" aria-label="Close">✕</button>
      <h2>Slackcountry at ${esc(rs.name)}</h2>
      <p class="sc-sub">${rs.lines.length ? `${nLines(rs)} skied from the lifts through the backcountry gates. Tap one for its gate, way up, way back and avalanche terrain.` : "The backcountry gates. No lines drawn yet: we found no reliable description of where they go."}</p>
      ${warnHtml(rs)}
      <div class="sc-list">${rs.gates.map((g) => {
        const ls = rs.lines.filter((l) => l.gate === g.id);
        // A gate with no line drawn yet still shows, with where it leads.
        return `<h4>${esc(g.name)}</h4><p class="sc-small">${esc(g.note)}</p>${ls.map(rowHtml).join("")}`;
      }).join("")}</div>
      <h3>Before you go</h3><ul>${(rs.rules || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      <h3>Links</h3><ul>${(rs.links || []).map((s) => `<li>${linkHtml(s)}</li>`).join("")}</ul>
      <p class="sc-small">Terrain classes are estimated from the terrain (like ATES), not official ratings. Gate spots are placed roughly from the resort's maps and descriptions.</p>`;
    dlg.querySelector(".sc-x").onclick = () => dlg.close();
    wireRows(rs);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  // Closing the card unselects the line, unless it closed to show the line on the map.
  let keep = false;
  dlg.addEventListener("close", () => { if (!keep && sel) { sel = null; draw(); } keep = false; });

  // ---------- in a ski route's details: the OpenStreetMap routes that are one of these lines ----------
  window.addEventListener("tf:ski-select", (e) => {
    const { item: r, el } = e.detail || {};
    if (!r || !el || !r.id) return;
    const fill = () => {
      const l = resorts().flatMap((rs) => rs.lines).find((x) => (x.osm || []).includes(r.id));
      if (!l || !el.isConnected) return;
      el.innerHTML = `<h4>Slackcountry</h4><p class="av-warn">Outside the ski area: no ski patrol, no avalanche control. Avalanche gear and training needed.</p><p>Reached from ${esc(l.resort.name)} through the ${esc((l.resort.gateById.get(l.gate) || {}).name || "backcountry gate")}. <a href="#" class="sc-more">Gate, way back and avalanche terrain</a></p>`;
      el.hidden = false;
      el.querySelector(".sc-more").addEventListener("click", (ev) => { ev.preventDefault(); open(l); });
    };
    if (doc) fill(); else load()?.then(fill);
  });

  // ---------- map key (winter.js's Map key in Skiing) ----------
  function keyItems() {
    const ul = $("skKeyList");
    if (!ul) return;
    ul.querySelectorAll(".sc-k").forEach((x) => x.remove());
    if (!shown()) return;
    ul.insertAdjacentHTML("beforeend", `<li class="sc-k"><span class="sk-kic"><i style="background:${C.ski};height:5px;box-shadow:0 0 0 2px #2b0612b3"></i></span>Slackcountry descent (outside ski patrol)</li>`
      + `<li class="sc-k"><span class="sk-kic"><i style="background:repeating-linear-gradient(90deg, ${C.ski} 0 6px, transparent 6px 10px)"></i></span>Way up from the backcountry gate</li>`
      + `<li class="sc-k"><span class="sk-kic"><i style="background:repeating-linear-gradient(90deg, ${C.out} 0 3px, transparent 3px 7px)"></i></span>Way back to the lifts or the valley</li>`
      + `<li class="sc-k"><span class="sk-kic"><span class="sc-gate" style="transform:none;padding:1px 4px;font-size:8px">Gate</span></span>Backcountry gate (grey: leaves with no gate)</li>`);
  }
  const keyList = () => $("skKeyList");
  let keyObs = null;
  function watchKey() {
    const ul = keyList();
    if (!ul || keyObs) return;
    keyObs = new MutationObserver(() => { if (!ul.querySelector(".sc-k") && shown()) keyItems(); });
    keyObs.observe(ul, { childList: true });
  }

  // ---------- Layers switch (Resorts group) and the panel button ----------
  const btn = document.createElement("button");
  btn.type = "button"; btn.id = "slackBtn";
  btn.title = "Lines skied from the lifts through the backcountry gates (outside ski patrol): gate, way up, way back, avalanche terrain";
  btn.textContent = "Slackcountry";
  const listBtn = document.createElement("button");
  listBtn.type = "button"; listBtn.className = "sc-open"; listBtn.hidden = true;
  function placeBtn() {
    if (!btn.isConnected && window.tfSkiSlot) window.tfSkiSlot("resort", btn, { label: "Slackcountry (gates out of the resort)", sym: "⛷", bg: C.ski });
  }
  function placeList() {
    const rs = on && isSki() ? near()[0] : null;
    listBtn.hidden = !rs;
    if (rs) listBtn.textContent = `⛷ Slackcountry at ${rs.name} (${nLines(rs)})`;
    if (!listBtn.isConnected) { const acts = document.querySelector("#skiPane .sk-acts"); if (acts) acts.after(listBtn); }
  }
  listBtn.addEventListener("click", () => { const rs = near()[0]; if (rs) openList(rs); });
  btn.addEventListener("click", () => { on = !on; try { localStorage.setItem("tf:skiSlack", String(on)); } catch {} sync(); });
  function sync() {
    placeBtn();
    btn.setAttribute("aria-pressed", String(on)); btn.classList.toggle("on", on);
    if (on && isSki() && !doc && !loading) load();
    const want = shown();
    for (const l of [layer, pins]) { if (want && !map.hasLayer(l)) l.addTo(map); if (!want && map.hasLayer(l)) map.removeLayer(l); }
    if (!want) { sel = null; if (dlg.open) dlg.close(); }
    zBand = bandOf(map.getZoom());
    placeList(); draw(); watchKey(); keyItems();
  }
  let lastSki = isSki();
  new MutationObserver(() => { if (isSki() !== lastSki) { lastSki = isSki(); sync(); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(() => { if (!btn.isConnected) placeBtn(); }).observe($("layersMenu") || document.body, { childList: true, subtree: true });
  // Tapping the map away from a line unselects it.
  map.on("click", () => { if (sel) { sel = null; draw(); } });
  window.tfSlack = { load, open: (id) => { const l = resorts().flatMap((r) => r.lines).find((x) => x.id === id); if (l) open(l); }, list: (id) => { const rs = resorts().find((r) => r.id === id) || resorts()[0]; if (rs) openList(rs); } };
  sync();
  on3d();
})();
