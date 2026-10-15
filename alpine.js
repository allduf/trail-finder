// Alpine rideable: OpenStreetMap paths above the tree line that look doable on a mountain bike, from the weekly
// data/alpine-<zone>.json files (scripts/build-alpine.mjs). alex: "all the alpine trail that you think are doable on a MTB".
// The "Alpine rideable" button in Layers and the matching tick box under the results' type chips (one switch, on by default) draws them in their own blue dash-dot style, with a snowy-peak
// icon at each trail's high point when zoomed in (not ▲, which is the Pro line level), and adds them to the map key. Tapping one opens it like any trail on the map, with
// a box saying how much of it is above the tree line and why it looks rideable. Hidden in Skiing.
// index.html provides window.tfLeaflet, tfZones, tfOpenWay and tfRenderKey.
(() => {
  const map = window.tfLeaflet, btn = document.getElementById("alpineBtn");
  if (!map || !window.L || !btn) return;

  const COLOR = "#0b8fc4", DASH = "10 6 2 6";
  const MIN_ZOOM = 9;     // zoomed out further, the lines would be a blur
  const ICON_ZOOM = 12;   // the peak icon at each trail's high point from here
  const ICON_GAP = 40;    // px: a peak icon this close to one already placed is skipped
  const KEY = "tf:alpine";
  const peak = (px) => `<svg class="alpine-ico" viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#fff" stroke="${COLOR}" stroke-width="1.6"/><path d="M3.5 17.5 9.5 7.5l3.2 5 2.1-2.9 5.7 7.9z" fill="${COLOR}"/><path d="M9.5 7.5 7.6 10.7l1.9-.7 1.5 1z" fill="#fff"/></svg>`;

  const css = document.createElement("style");
  css.textContent = `
label.toggle.t-alpine .sw { background: repeating-linear-gradient(90deg, ${COLOR} 0 6px, transparent 6px 8px, ${COLOR} 8px 10px, transparent 10px 12px); }
.map-tools #alpineBtn.on { background: ${COLOR}; border-color: ${COLOR}; color: #fff; }
.alpine-top { background: none; border: 0; }
.alpine-top span { display: block; transform: translate(-50%, -50%); line-height: 0; cursor: pointer; filter: drop-shadow(0 1px 1px rgba(0,0,0,.35)); }
.alpine-ico { vertical-align: -3px; }
#alpineBtn .alpine-ico { margin-right: 2px; }
.alpine-box { margin: 14px 0 0; padding: 10px 12px; border: 1.5px dashed ${COLOR}; border-radius: 8px; background: var(--chip); }
.alpine-box strong { color: ${COLOR}; }
.alpine-box p { margin: 4px 0 0; font-size: .9rem; }
body.sport-ski .leaflet-alpine-pane, body.sport-ski #alpineBtn, body.sport-ski label.t-alpine { display: none; }`;
  document.head.appendChild(css);

  map.createPane("alpine").style.zIndex = 392;   // over the All trails lines, under the new trails in the list
  const renderer = L.canvas({ pane: "alpine", padding: 0.3, tolerance: L.Browser.touch ? 10 : 5 });
  const layer = L.layerGroup().addTo(map);
  const data = new Map();    // zone id -> [{ id, tags, geom, ... }], [] if the file couldn't be loaded
  const loads = new Map();   // zone id -> promise
  let on = true;
  try { on = localStorage.getItem(KEY) !== "false"; } catch {}

  function load() {
    if (!on || map.getZoom() < MIN_ZOOM) return;
    loadZones([map.getBounds()]);
  }
  function loadZones(boxes) {
    (window.tfZones || []).filter((z) => boxes.some((b) => z.bounds.intersects(b)) && !loads.has(z.id)).forEach((z) => {
      loads.set(z.id, fetch(`data/alpine-${z.id}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((f) => {
        data.set(z.id, f && f.v === 1 ? Object.entries(f.ways).map(([id, w]) => {
          const geom = [];
          for (let i = 0; i < w.g.length; i += 2) geom.push([w.g[i], w.g[i + 1]]);
          return { ...w, id: +id, geom, tl: f.treeline };
        }) : []);
        draw(); showCount();
      }));
    });
  }

  function draw() {
    layer.clearLayers();
    if (!on || map.getZoom() < MIN_ZOOM) return;
    const view = map.getBounds().pad(0.3), icons = map.getZoom() >= ICON_ZOOM, placed = [];
    for (const list of data.values()) for (const w of list) {
      if (!view.intersects(L.latLngBounds(w.geom))) continue;
      const name = w.tags.name || "Alpine path";
      const open = (e) => { L.DomEvent.stop(e); window.tfOpenWay && window.tfOpenWay(w.id, e.latlng); };
      layer.addLayer(L.polyline(w.geom, { renderer, color: "#fff", weight: 6, opacity: 0.75, lineCap: "round", interactive: false }));
      layer.addLayer(L.polyline(w.geom, { renderer, color: COLOR, weight: 3.5, opacity: 1, dashArray: DASH, lineCap: "round", bubblingMouseEvents: false })
        .bindTooltip(esc(name), { sticky: true, direction: "top", offset: [0, -8] }).on("click", open));
      const at = icons && w.top && map.latLngToContainerPoint(w.top);
      if (at && view.contains(w.top) && !placed.some((q) => q.distanceTo(at) < ICON_GAP)) {
        placed.push(at);
        layer.addLayer(L.marker(w.top, { pane: "alpine", title: `${name}: alpine, looks rideable (up to ${w.hi} m)`, keyboard: false,
          icon: L.divIcon({ className: "alpine-top", html: `<span>${peak(20)}</span>`, iconSize: [0, 0] }) }).on("click", open));
      }
    }
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // The tick box's number: alpine trails in the area of the last search (New trails in an area).
  let searched = [];
  function showCount() {
    const n = document.getElementById("nAlpine");
    if (!n) return;
    let c = 0;
    for (const list of data.values()) for (const w of list) {
      if (searched.some((b) => b.intersects(w.bounds || (w.bounds = L.latLngBounds(w.geom))))) c++;
    }
    n.textContent = c;
  }
  const box = document.getElementById("showAlpine");
  function sync() {
    if (box) { box.checked = on; box.closest("label").classList.toggle("off", !on); }
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("on", on);
    btn.title = on ? "Hide the alpine paths that look rideable" : "Show the alpine paths, above the tree line, that look doable on a mountain bike";
  }
  function toggle() {
    on = !on;
    try { localStorage.setItem(KEY, String(on)); } catch {}
    sync(); load(); draw();
    if (window.tfRenderKey) window.tfRenderKey();
  }
  btn.addEventListener("click", toggle);
  if (box) box.addEventListener("change", () => { if (box.checked !== on) toggle(); });
  map.on("moveend", () => { load(); draw(); });

  // For index.html: the key line, and the facts the trail details show (as tf: tags, like the all-trails job's).
  window.tfAlpine = {
    on: () => on,
    count(boxes) { searched = boxes || []; if (searched.length) loadZones(searched); showCount(); },
    keyItem: (sw) => sw(`background: repeating-linear-gradient(90deg, ${COLOR} 0 7px, transparent 7px 10px, ${COLOR} 10px 12px, transparent 12px 15px)`, `${peak(14)} Alpine, looks rideable`),
    icon: peak(16),
    tf(id) {
      for (const list of data.values()) {
        const w = list.find((x) => x.id === id);
        if (w) return { "tf:alpine-lo": w.lo, "tf:alpine-hi": w.hi, "tf:alpine-up": w.up, "tf:alpine-tl": w.tl, "tf:alpine-why": (w.why || []).join("; ") };
      }
      return null;
    },
  };
  btn.innerHTML = `${peak(15)} Alpine rideable`;
  sync(); load();
  if (window.tfRenderKey) window.tfRenderKey();
})();
