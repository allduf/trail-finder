// Riding area names (Alice Lake, Mount Fromme, Lost Lake...) as labels on the map when zoomed out, so the zone
// views show where the riding is. They hide from zoom 13, where the trails themselves take over, and in Skiing.
// Tapping a name zooms in to that area. The list is hand-picked in data/riding-areas.json; each label sits in the
// middle of that area's MTB trails. Tier 1 names show from zoom 8, tier 2 from zoom 10, and a name that would
// overlap one already placed is skipped, so the region view stays readable.
// index.html provides window.tfLeaflet.
(() => {
  const map = window.tfLeaflet;
  if (!map || !window.L) return;

  const HIDE_FROM = 13;                // zoom where the labels go away
  const SHOW_FROM = { 1: 8, 2: 10 };   // zoom where each tier appears

  const css = document.createElement("style");
  css.textContent = `
.ride-area { background: none; border: 0; }
.ride-area span { display: inline-block; transform: translate(-50%, -50%); white-space: nowrap; cursor: pointer; pointer-events: auto;
  font-family: var(--font-display, system-ui, sans-serif); font-weight: 800; font-size: 12.5px; letter-spacing: .04em; text-transform: uppercase;
  color: #1f4a33; text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 2px #fff, 0 0 1px #fff; }
.ride-area.t2 span { font-size: 11px; font-weight: 700; color: #2f5a42; }
.ride-area span:hover { color: #0d2a1a; text-decoration: underline; }
body.sport-ski .leaflet-rideAreas-pane { display: none; }`;
  document.head.appendChild(css);

  map.createPane("rideAreas").style.zIndex = 395;   // over the trail lines, under pins and popups
  const layer = L.layerGroup().addTo(map);
  let areas = [];

  fetch("data/riding-areas.json").then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d || d.v !== 1 || !Array.isArray(d.areas)) return;
    areas = d.areas.map((a) => {
      const m = L.marker(a.c, {
        pane: "rideAreas", keyboard: false, title: `${a.name}: tap to zoom in`,
        icon: L.divIcon({ className: "ride-area t" + a.tier, html: `<span></span>`, iconSize: [0, 0] }),
      });
      m.on("add", () => { m.getElement().firstChild.textContent = a.name; });
      m.on("click", () => map.flyTo(a.c, HIDE_FROM));
      return { ...a, m };
    }).sort((x, y) => x.tier - y.tier);
    draw();
  }).catch(() => {});

  function draw() {
    const z = map.getZoom(), view = map.getBounds().pad(0.2), placed = [];
    for (const a of areas) {
      let show = z < HIDE_FROM && z >= SHOW_FROM[a.tier] && view.contains(a.c);
      if (show) {
        // Rough label box in screen pixels from the name's length; skip it if it would overlap one already shown.
        const p = map.latLngToContainerPoint(a.c), w = a.name.length * (a.tier === 1 ? 8.5 : 7.5) / 2 + 6, h = 10;
        const box = [p.x - w, p.y - h, p.x + w, p.y + h];
        show = !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
        if (show) placed.push(box);
      }
      if (show && !layer.hasLayer(a.m)) layer.addLayer(a.m);
      else if (!show && layer.hasLayer(a.m)) layer.removeLayer(a.m);
    }
  }
  map.on("zoomend moveend", draw);
})();
