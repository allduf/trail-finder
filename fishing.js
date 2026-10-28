// Fishing, the fourth sport in the header's sport menu (MTB / Skiing / Hunting / Fishing). winter.js owns the menu: it
// sets body.sport-fish (and body.sport-alt, the class every non-MTB sport shares) and sends "tf:sport".
// alex (2026-10-25): rivers (fly fishing), lakes and the ocean, all over Canada. From what anglers ask for most: the
// rules for the water you're on, stocking, river flow compared to normal, access, conditions, and a private catch log
// (no public catch map: anglers hate apps that give their spots away).
// The panel, top to bottom:
//  - Quick actions: my spot, save a catch, the truck, the fishing log (points, truck and log live in ski-points.js).
//  - Right now: today's bite (1 to 5), the nearest river's flow light, wind and pressure, on one line.
//  - This spot (after a tap on the map or a pin): the water there (name, fish found, depth), the rules for it (the
//    province's zone or region with links, Alberta's own limits for that lake or river, Quebec's zone news and
//    exceptions, the Pacific tidal area), stocking there, the nearest river gauges with their flow against the usual
//    flow for the month and the last 7 days, the next tides, fishing spots and launches close by.
//  - Where to fish today: stocked waters and rivers near the spot, ranked by how fresh the stocking is and how good the
//    flow is.
//  - Conditions: wind, pressure trend, clouds and rain, sea temperature and waves near the coast, sun and moon with
//    feeding times, and a 1 to 5 fishing forecast for today and the next two days.
//  - Hatch chart: what's likely hatching this month in this part of Canada, and flies that match.
//  - Map layers (in the Layers menu): river gauges, stocked waters, public fishing spots and launches (all of Canada), tide stations, lake depth
//    lines (BC, Ontario, Quebec, Manitoba, New Brunswick soundings), fishing zones.
// Built data comes from data/fishing/*.json (scripts/build-fishing.mjs, monthly .github/workflows/fishing-data.yml);
// river readings, tides, weather, Alberta rules and the water at a spot are asked live.
(() => {
  "use strict";
  const map = window.tfLeaflet, sel = document.getElementById("sport");
  if (!map || !sel || !window.L) return;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  const isFish = () => document.body.classList.contains("sport-fish");
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs", WMS = "https://openmaps.gov.bc.ca/geo/pub/wms";
  const ECCC = "https://api.weather.gc.ca/collections", IWLS = "https://api-iwls.dfo-mpo.gc.ca/api/v1";
  const AB_REG = "https://geospatial.alberta.ca/titan/rest/services/fisheries/fisheries_regulations/MapServer", AB_API = "https://geospatial.alberta.ca/services/Fisheries/Regulation";
  const LIO = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open07/MapServer";
  const QC_EXC = "https://peche.faune.gouv.qc.ca/arcgiswa/rest/services/PRODC-E/PlansEauExceptions/MapServer/2";
  const ACC = "#0c8599";   // the Fishing accent (deep teal)
  // Map dot colours (alex 2026-10-26: "more trendy and professional"): flow keeps its traffic-light order, each other
  // layer gets its own hue that reads on satellite and the flat map.
  const C = { vlow: "#f2b33d", low: "#a3c94f", ok: "#22b07d", high: "#f07b3f", blown: "#e5484d", none: "#8a94a6", stocked: "#2563eb", fresh: "#f43f5e",
    access: "#f97316", launch: "#7c3aed", park: "#2f9e44", zec: "#0ca678", fee: "#4263eb", nofish: "#e03131", tide: "#0ea5e9", zone: "#3b82f6", hidden: "#eab308", depth: "#1e40af" };
  // Each layer's own picture (alex 2026-10-26: the spot layers were "almost same colour", "make it more attractive for a
  // fisherman"): drawn white on the layer's colour, in the Layers list, the map key and inside the dots on the map.
  const GLYPH = {
    stocked: "M5 12c3-4 6-6 10-6 3 0 5 3 6 6-1 3-3 6-6 6-4 0-7-2-10-6zM5 12 2 8M5 12l-3 4M16 11h.01",
    hidden: "M2 20 9 7l4 6 3-4 6 11zM9 7l2 4",
    access: "M14 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM14 7.5V15a5 5 0 0 1-10 0v-3l3 2.5",
    launch: "M3 15h18l-3 5H6zM12 4v11M12 4l6 8h-6",
    tides: "M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 15c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2",
    gauges: "M4 20h16M7 20V11M12 20V5M17 20v-6",
    areas: "M12 2.5 18 11h-3l4 6H5l4-6H6zM12 17v4.5",
    depth: "M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z",
    zones: "M4 4h4M12 4h4M20 4v4M20 12v4M20 20h-4M12 20H8M4 20v-4M4 12V8",
    crown: "M3 20h18M6 20l4-9 3 5 2-3 3 7M15 4v6M15 4h4l-1 1.5 1 1.5h-4",
  };
  const timeout = (ms) => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
  const getJ = (url, ms = 12000) => fetch(url, { signal: timeout(ms) }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  const km = (a, b, c, d) => map.distance([a, b], [c, d]) / 1000;
  const fmtKm = (k) => (k < 1 ? `${Math.round(k * 1000)} m` : k < 10 ? `${k.toFixed(1)} km` : `${Math.round(k)} km`);
  const today = () => new Date().toISOString().slice(0, 10);
  const daysAgo = (d) => Math.round((Date.now() - new Date(d + "T12:00:00").getTime()) / 864e5);

  // ---------- icons ----------
  const svg = (d, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    me: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    fish: '<path d="M2 12s4-6 11-6c4 0 7 3 8 6-1 3-4 6-8 6-7 0-11-6-11-6z"/><path d="M2 12 0 9M2 12l-2 3"/><circle cx="16" cy="11" r="1"/>',
    truck: '<path d="M3 16V8h10v8M13 11h4l3 3v2h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    log: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
    wave: '<path d="M2 12c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 17c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 7c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2"/>',
    gauge: '<path d="M4 20h16M7 20V10M12 20V4M17 20v-7"/>',
    rules: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    bug: '<path d="M12 7v13M8 9c0-2 2-4 4-4s4 2 4 4M6 13h12M7 18l-2 2M17 18l2 2M6 9 4 7M18 9l2-2"/><ellipse cx="12" cy="14" rx="5" ry="6"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    boat: '<path d="M3 15h18l-3 5H6z"/><path d="M12 4v11M12 4l6 8h-6"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    depth: '<path d="M3 6c3 0 3-2 6-2s3 2 6 2 3-2 6-2"/><path d="M12 9v11M8 16l4 4 4-4"/>',
  };

  // ---------- map layers ----------
  const LAYERS = {
    gauges: { g: "Water", label: "River flow gauges", sub: "Live flow, coloured from too low to blown out", on: true, minZoom: 7, icon: [C.ok, "dot"] },
    stocked: { g: "Water", label: "Stocked lakes and rivers", sub: "Pink: stocked in the last 30 days", on: true, minZoom: 6, icon: [C.stocked, "dot"] },
    hidden: { g: "Access", label: "Hidden spots", sub: "Walk-in stocked lakes and hike-in waters few people fish", on: true, minZoom: 6, icon: [C.hidden, "dot"] },
    access: { g: "Access", label: "Fishing spots", sub: "Public spots, piers and docks all over Canada", on: true, minZoom: 8, icon: [C.access, "dot"] },
    launch: { g: "Access", label: "Boat launches", sub: "Public ramps all over Canada", on: true, minZoom: 8, icon: [C.launch, "dot"] },
    // Picture tiles (alex 2026-10-28: "all the rivers highlighted, another one all the lakes... in the same style" as
    // Skiing's Avalanche and terrain tiles). Pictures: icons/fish/<key>.jpg, made by scripts/make-fish-tiles.mjs.
    rivers: { g: "Highlight on the map", tile: true, label: "All rivers", sub: "Every river in bright blue, all over Canada" },
    lakes: { g: "Highlight on the map", tile: true, label: "All lakes", sub: "Every lake and pond in green, all over Canada" },
    creeks: { g: "Highlight on the map", tile: true, label: "Creeks and streams", sub: "Small creeks in light blue, dashed when they dry up in summer", minZoom: 13 },
    ocean: { g: "Highlight on the map", tile: true, label: "Ocean and bays", sub: "Salt water in blue, where you need a tidal licence" },
    depth: { g: "Highlight on the map", tile: true, label: "Lake depth lines", sub: "Over 8,000 surveyed lakes in BC, Ontario, Quebec and Manitoba, soundings in New Brunswick: zoom in on a lake", minZoom: 12, icon: [C.depth, "line"] },
    crown: { g: "Highlight on the map", tile: true, label: "Crown land", sub: "Public land you can walk to the water on: green; private: yellow (ON, QC, NB, NS, SK, NL; zoom in)", minZoom: 9, icon: ["#2f9e44", "box"] },
    tides: { g: "Ocean", label: "Tide stations", sub: "Tap one for the next high and low tides", on: true, minZoom: 6, icon: [C.tide, "dot"] },
    zones: { g: "Rules", label: "Fishing zones and regions", sub: "The areas the rules are written for, tap one for its rules", icon: [C.zone, "dash"] },
    areas: { g: "Rules", label: "Parks, zecs and reserves", sub: "Red: ecological reserves, no fishing. National parks (Parks Canada permit), Quebec zecs, wildlife reserves and parks (fishing allowed with an access fee)", on: true, minZoom: 5, icon: [C.park, "dot"] },
  };
  const GROUPS = ["Water", "Highlight on the map", "Access", "Ocean", "Rules"];
  const HL = ["rivers", "lakes", "creeks", "ocean"];   // the water colours (WATER below)
  const VIEWS = {
    rules: { label: "Rules", sub: "where to fish", layers: ["zones", "areas", "access", "launch", "crown"] },
    river: { label: "Rivers", sub: "flow, spots", layers: ["gauges", "access", "launch", "hidden", "rivers", "creeks"] },
    lake: { label: "Lakes", sub: "stocked, depth", layers: ["stocked", "depth", "access", "launch", "hidden", "lakes"] },
    ocean: { label: "Ocean", sub: "tides, areas", layers: ["tides", "access", "launch", "ocean"] },
  };
  let shown = new Set(store.get("fishLayers", Object.keys(LAYERS).filter((k) => LAYERS[k].on)));
  // A layer added since the last visit shows if it's on by default (the saved list only knows the old ones).
  const knownLayers = store.get("fishLayersKnown", ["gauges", "stocked", "depth", "access", "tides", "zones"]);
  for (const k of Object.keys(LAYERS)) if (LAYERS[k].on && !knownLayers.includes(k)) shown.add(k);
  store.set("fishLayersKnown", Object.keys(LAYERS));
  // Zones and regions start off (alex 2026-10-26): turned off once for everyone who had it on; the Rules view or the
  // switch in Layers turns it back on.
  if (!store.get("fishZonesOff", false)) { shown.delete("zones"); store.set("fishLayers", [...shown]); store.set("fishZonesOff", true); }

  // ---------- look ----------
  const css = document.createElement("style");
  css.textContent = `
body:not(.sport-fish) #fishPane, body:not(.sport-fish) .lm-fish { display: none !important; }
body.sport-fish .leaflet-allTrails-pane, body.sport-fish .leaflet-boxTrails-pane, body.sport-fish .leaflet-newTrails-pane, body.sport-fish .leaflet-onewayArrows-pane,
body.sport-fish .leaflet-ridesPane-pane { display: none; }
.lm-fish { display: flex; flex-direction: column; }
.lm-fish .fs-group { margin: 0; font-size: .66rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding-top: 6px; }
:is(#fishPane, .lm-fish) .fs-layer { display: grid; grid-template-columns: 30px 1fr auto; gap: 12px; align-items: center; padding: 5px 0; cursor: pointer; }
:is(#fishPane, .lm-fish) .fs-layer b { display: block; font-size: .86rem; }
:is(#fishPane, .lm-fish) .fs-layer small { display: block; color: var(--muted); font-size: .74rem; line-height: 1.25; }
:is(#fishPane, .lm-fish) .fs-layer small.z { color: var(--muted); font-style: italic; }
:is(#fishPane, .lm-fish) .fs-ic { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; box-sizing: border-box; box-shadow: inset 0 0 0 1px #ffffff2e, 0 1px 3px #0003; }
:is(#fishPane, .lm-fish) .fs-sw { appearance: none; -webkit-appearance: none; width: 40px; height: 24px; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; margin: 0; flex: none; transition: background .15s; }
:is(#fishPane, .lm-fish) .fs-sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px #0004; transition: left .15s; }
:is(#fishPane, .lm-fish) .fs-sw:checked { background: ${ACC}; }
:is(#fishPane, .lm-fish) .fs-sw:checked::after { left: 19px; }
/* Highlight on the map: picture tiles, 3 to a row, like Skiing's Avalanche and terrain */
.lm-fish .fs-tilegrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 8px; padding: 6px 0 4px; }
.lm-fish .fs-tile { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 4px; cursor: pointer; text-align: center; min-width: 0; }
.lm-fish .fs-thumb { position: relative; display: block; width: 100%; aspect-ratio: 1; border-radius: 12px; box-sizing: border-box; border: 2px solid var(--line); background: #1d2b24 center / cover; }
.lm-fish .fs-tcap { display: block; font-size: .74rem; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
:is(#fishPane, .lm-fish) .fs-tile .fs-sw { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.lm-fish .fs-tile:has(.fs-sw:checked) .fs-thumb { border-color: ${ACC}; box-shadow: 0 0 0 2px ${ACC}; }
.lm-fish .fs-tile:has(.fs-sw:checked) .fs-thumb::after { content: "✓"; position: absolute; top: 4px; right: 4px; width: 18px; height: 18px; border-radius: 50%; background: ${ACC}; color: #fff;
  font: 800 11px/18px system-ui, sans-serif; text-align: center; }
.lm-fish .fs-tile:has(.fs-sw:focus-visible) .fs-thumb { outline: 2px solid var(--accent); outline-offset: 2px; }
.lm-fish .fs-tilenote { margin: 0; font-size: .74rem; color: var(--muted); font-style: italic; }
#fishPane { display: flex; flex-direction: column; gap: 12px; font-size: .9rem; }
#fishPane a { color: var(--accent); }
#fishPane .fs-note { color: var(--muted); font-size: .76rem; margin: 0; }
#fishPane details.fs-sec { border-top: 1px solid var(--line); padding: 0; }
#fishPane details.fs-sec > summary { list-style: none; display: grid; grid-template-columns: 16px auto minmax(0, 1fr) 10px; align-items: center; gap: 8px; padding: 10px 0; margin: 0; font-size: .86rem; cursor: pointer; }
#fishPane details.fs-sec > summary::-webkit-details-marker { display: none; }
#fishPane details.fs-sec > summary svg { color: ${ACC}; }
#fishPane details.fs-sec > summary b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 11em; }
#fishPane details.fs-sec > summary span { font-weight: 600; color: var(--fg); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; justify-content: flex-end; gap: 5px; }
#fishPane details.fs-sec > summary::after { content: "›"; color: var(--muted); font-size: 1.1rem; line-height: 1; transition: transform .15s; justify-self: end; }
#fishPane details.fs-sec[open] > summary::after { transform: rotate(90deg); }
#fishPane details.fs-sec[open] > summary { margin: 0; }
#fishPane .fs-secb { display: flex; flex-direction: column; gap: 8px; padding: 0 0 12px; }
#fishPane i.fs-light { margin: 0; }
#fishPane #fsSpot { gap: 0; }
#fishPane #fsSpot > header { margin-bottom: 4px; }
#fishPane .fs-eatbox summary { cursor: pointer; list-style: none; }
#fishPane details.fs-more summary { cursor: pointer; font-size: .78rem; color: var(--muted); margin: 6px 0 4px; }
#fishPane .fs-eatbox summary::-webkit-details-marker { display: none; }
#fishPane .fs-eatbox summary h4::after { content: " ▾"; color: var(--muted); }
#fishPane .fs-eatbox[open] summary h4::after { content: " ▴"; }
#fishPane table.fs-eat { width: 100%; border-collapse: collapse; font-size: .8rem; margin: 4px 0 6px; }
#fishPane table.fs-eat th { text-align: left; font-size: .7rem; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: .04em; padding: 2px 4px; }
#fishPane table.fs-eat td { vertical-align: top; padding: 5px 4px; border-top: 1px solid var(--line); line-height: 1.35; }
#fishPane table.fs-eat td:first-child { width: 34%; }
#fishPane table.fs-eat small { display: block; color: var(--muted); font-size: .72rem; }
#fishPane .fs-actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
#fishPane .fs-act { font: inherit; font-size: .74rem; font-weight: 700; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 58px; padding: 6px 4px;
  border-radius: 12px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; text-align: center; line-height: 1.15; }
#fishPane .fs-act svg { color: ${ACC}; }
#fishPane .fs-act:active { transform: scale(.97); }
#fishPane .fs-act:disabled { opacity: .6; }
#fishPane .fs-now { font: inherit; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; text-align: left; width: 100%; padding: 9px 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; font-size: .82rem; }
#fishPane .fs-now span { display: inline-flex; align-items: center; gap: 5px; }
#fishPane .fs-now svg { color: ${ACC}; flex: none; }
#fishPane .fs-card { border: 1px solid var(--line); border-radius: 14px; padding: 12px; background: var(--panel); display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm); }
#fishPane .fs-card header { display: flex; align-items: center; gap: 8px; }
#fishPane .fs-card header svg { color: ${ACC}; flex: none; }
#fishPane .fs-card h3 { margin: 0; font-size: .95rem; font-weight: 800; flex: 1; min-width: 0; }
#fishPane .fs-card h4 { margin: 4px 0 0; font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 6px; }
#fishPane .fs-card h4 svg { color: ${ACC}; }
#fishPane .fs-card p { margin: 0; font-size: .84rem; }
#fishPane .fs-x { font: inherit; border: 0; background: var(--chip); color: var(--muted); cursor: pointer; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; flex: none; }
.fs-zlabel span { display: inline-block; transform: translate(-50%, -50%); white-space: nowrap; font: 800 11px/1.2 system-ui, sans-serif; color: var(--c); text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 2px #fff; letter-spacing: .02em; }
#fishPane .fs-views { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
#fishPane .fs-view { font: inherit; font-size: .8rem; font-weight: 700; padding: 8px 4px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 1px; }
#fishPane .fs-view small { font-weight: 500; font-size: .68rem; color: var(--muted); }
#fishPane .fs-view.on { background: ${ACC}; border-color: ${ACC}; color: #fff; }
#fishPane .fs-view.on small { color: #fff; }
#fishPane .fs-pill { font: inherit; font-size: .76rem; font-weight: 700; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; align-self: flex-start; }
#fishPane .fs-pill svg { color: ${ACC}; }
#fishPane .fs-chips { display: flex; flex-wrap: wrap; gap: 5px; }
#fishPane .fs-chip { font-size: .74rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; border: 1.5px solid var(--c, var(--line)); background: color-mix(in srgb, var(--c, transparent) 12%, var(--panel)); color: var(--fg); }
#fishPane ul.fs-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
#fishPane ul.fs-list li { border-left: 4px solid var(--c, var(--line)); padding-left: 9px; font-size: .84rem; }
#fishPane ul.fs-list li > b, #fishPane ul.fs-list button.fs-go > b { display: block; }
#fishPane ul.fs-list li small { color: var(--muted); }
#fishPane .fs-st { font-style: normal; font-size: .7rem; font-weight: 700; padding: 1px 7px; margin-left: 4px; border-radius: 999px; background: color-mix(in srgb, var(--c) 16%, var(--panel)); color: color-mix(in srgb, var(--c) 70%, var(--fg)); white-space: nowrap; }
#fishPane .fs-sea-p { display: block; }
#fishPane .fs-short { margin: 0 0 10px; padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, ${ACC} 9%, var(--panel)); }
#fishPane .fs-short h4 { margin: 0 0 4px; }
#fishPane .fs-short ul { margin: 0; padding-left: 18px; }
#fishPane .fs-short li { margin: 3px 0; font-size: .84rem; line-height: 1.35; }
#fishPane .fs-short .fs-note { margin: 6px 0 0; }
#fishPane .fs-sea-p i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; }
#fishPane ul.fs-list button.fs-go { font: inherit; text-align: left; width: 100%; border: 0; background: none; color: inherit; padding: 0; cursor: pointer; }
#fishPane .fs-tbl { width: 100%; border-collapse: collapse; font-size: .76rem; }
#fishPane .fs-tbl td, #fishPane .fs-tbl th { padding: 4px 4px 4px 0; border-bottom: 1px solid var(--line); vertical-align: top; text-align: left; }
#fishPane .fs-tbl th { font-weight: 700; color: var(--muted); font-size: .7rem; }
#fishPane .fs-tbl .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
#fishPane .fs-tbl tr.open td:first-child b { color: ${C.ok}; }
#fishPane .fs-tbl tr.closed td { color: var(--muted); }
#fishPane details { border-top: 1px solid var(--line); padding-top: 6px; }
#fishPane details summary { cursor: pointer; font-weight: 700; font-size: .82rem; }
#fishPane details[open] summary { margin-bottom: 6px; }
#fishPane .fs-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
#fishPane .fs-stats div { background: var(--chip); border-radius: 10px; padding: 6px 4px; text-align: center; display: flex; flex-direction: column; gap: 1px; }
#fishPane .fs-stats b { font-size: .92rem; }
#fishPane .fs-stats span { font-size: .64rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
#fishPane .fs-days { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
#fishPane .fs-days li { display: grid; grid-template-columns: 5.5em auto 1fr; gap: 0 8px; align-items: baseline; font-size: .84rem; }
#fishPane .fs-days small { grid-column: 1 / -1; color: var(--muted); font-size: .74rem; }
#fishPane .fs-stars { color: #f59f00; letter-spacing: 1px; }
#fishPane .fs-stars i { color: var(--line); font-style: normal; }
#fishPane .fs-sun { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: .82rem; margin: 0; }
#fishPane .fs-sun dt { color: var(--muted); }
#fishPane .fs-sun dd { margin: 0; font-weight: 600; }
#fishPane .fs-spark { width: 100%; height: 46px; display: block; }
#fishPane .fs-light { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--c); margin-right: 5px; vertical-align: 0; box-shadow: 0 0 0 1.5px #fff, 0 0 0 2.5px var(--c); }
#fishPane .fs-hatch li { display: grid; grid-template-columns: 1fr; }
#fishPane ul.fs-top button.fs-go { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 8px; }
#fishPane ul.fs-top button.fs-go small { grid-column: 1; }
#fishPane ul.fs-top button.fs-go em { grid-column: 2; grid-row: 1 / span 2; align-self: center; font-style: normal; font-size: .76rem; color: var(--muted); white-space: nowrap; }
#fishPane .fs-style { margin-bottom: 8px; }
#fishPane .fs-style button.fs-chip { cursor: pointer; font: inherit; font-size: .8rem; font-weight: 700; padding: 6px 12px; }
#fishPane .fs-style button.fs-chip.on { background: #0c8599; border-color: #0c8599; color: #fff; }
#fishPane ul.fs-bait { list-style: none; margin: 6px 0; padding: 0; display: grid; gap: 10px; }
#fishPane ul.fs-bait li { border-left: 3px solid #0c8599; padding-left: 9px; }
#fishPane ul.fs-bait b { display: block; }
#fishPane ul.fs-bait span { display: block; font-size: .86rem; line-height: 1.35; }
#fishPane ul.fs-bait small { display: block; color: var(--muted); font-size: .76rem; margin-top: 2px; }
#fishPane .fs-mini { font-size: .74rem; font-weight: 700; color: #f59f00; }
#fishPane .fs-safe { color: var(--muted); margin: 0; font-size: .76rem; line-height: 1.4; }
.fs-mapkey .fs-keybtn { font: inherit; font-weight: 800; display: inline-flex; align-items: center; gap: 5px; padding: 7px 11px; border-radius: 999px; border: 0; background: #fff; color: #212529; box-shadow: 0 1px 4px #0004; cursor: pointer; font-size: 12px; }
.fs-mapkey .fs-keybtn svg { color: ${ACC}; }
.fs-mapkey .fs-keybox { margin-top: 6px; background: #fff; color: #212529; border-radius: 12px; padding: 8px 10px; box-shadow: 0 2px 10px #0004; width: min(240px, calc(100vw - 40px)); max-height: 45vh; overflow: auto; font: 500 11px/1.35 var(--font-body, system-ui); }
.fs-mapkey .fs-keybox b { display: block; margin: 4px 0 2px; font-size: 11px; }
.fs-mapkey .fs-keybox i { display: inline-grid; place-items: center; width: 13px; height: 13px; border-radius: 50%; margin-right: 6px; vertical-align: -2px; }
.mapwrap.is3d .fs-mapkey { margin-bottom: 46px; }
.fs-spot { width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%; border: 3px solid ${ACC}; background: #fff6; box-shadow: 0 0 0 2px #fff; }
.fs-spot::after { content: ""; position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; margin: -4px; border-radius: 50%; background: ${ACC}; box-shadow: 0 0 0 1.5px #fff; }
.fs-pinlabel { font: 700 11px/1.1 var(--font-body, system-ui); color: #102a43; text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff; white-space: nowrap; pointer-events: none; }`;
  document.head.append(css);

  // ---------- panel ----------
  const pane = document.createElement("section");
  pane.id = "fishPane";
  pane.setAttribute("aria-label", "Fishing");
  pane.innerHTML = `
    <div class="fs-actions" role="toolbar" aria-label="Fishing tools">
      <button type="button" class="fs-act" data-act="me">${svg(IC.me)}My spot</button>
      <button type="button" class="fs-act" data-act="catch">${svg(IC.fish)}Save a catch</button>
      <button type="button" class="fs-act" data-act="truck">${svg(IC.truck)}Truck</button>
      <button type="button" class="fs-act" data-act="log">${svg(IC.log)}Fishing log</button>
      <button type="button" class="fs-act tf-phone" data-act="bait">${svg(IC.bug)}Bait</button>
    </div>
    <button type="button" class="fs-now" id="fsNow" hidden></button>
    <div class="fs-card" id="fsSpot" hidden></div>
    <div class="fs-card" id="fsToday"></div>
    <div class="fs-card" id="fsMap"><header>${svg(IC.layers)}<h3>On the map</h3></header>
      <div class="fs-views" role="group" aria-label="Map views">${Object.entries(VIEWS).map(([k, v]) => `<button type="button" class="fs-view" data-view="${k}">${esc(v.label)}<small>${esc(v.sub)}</small></button>`).join("")}</div>
      <button type="button" class="fs-pill" id="fsAll">${svg(IC.layers, 16)}All fishing layers</button></div>
    <div class="fs-card" id="fsCond"></div>
    <div class="fs-card" id="fsHatch"></div>
    <details class="fs-safe"><summary>A guide, not the law</summary>Rules, zones, stocking and river flows come from each province's and Canada's open data and can be late or simplified. Always check your province's fishing regulations and any in-season changes before you fish, and buy the licence you need (a tidal licence for the ocean).</details>`;
  // Go to a place (place-search.js): a town, mountain, lake or region, and the map jumps there (alex 2026-10-26).
  if (window.tfPlaceSearch) pane.querySelector(".fs-actions").after(window.tfPlaceSearch.box({ placeholder: "Go to a lake, river, town or region" }));
  const lmFish = document.createElement("div");
  lmFish.className = "lm-fish";
  lmFish.innerHTML = `<div class="lm-head">Fishing layers</div><div id="fsLayerList"></div>`;
  const lmStyle = document.querySelector("#layersMenu .lm-style");
  if (lmStyle) lmStyle.after(lmFish); else pane.append(lmFish);
  const head = document.querySelector(".panel-head");
  const after = $("huntPane") || $("skiPane"), modes = head && head.querySelector(".modes");
  if (after) after.after(pane); else if (modes) modes.after(pane); else if (head) head.append(pane);
  let hintTimer = 0;
  function hint(text) {
    let el = $("fsHint");
    if (!el) { el = document.createElement("p"); el.id = "fsHint"; el.className = "fs-note"; el.setAttribute("role", "status"); pane.querySelector(".fs-actions").after(el); }
    el.textContent = text;
    clearTimeout(hintTimer); hintTimer = setTimeout(() => el.remove(), 6000);
  }

  // ---------- data ----------
  const files = {};
  const decode = (g) => g.map((r) => { const out = []; let a = 0, o = 0; for (let i = 0; i < r.length; i += 2) { a += r[i]; o += r[i + 1]; out.push(a / 1e4, o / 1e4); } return out; });
  function load(name) {
    if (!files[name]) files[name] = fetch(`data/fishing/${name}.json`, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (Array.isArray(j.zones)) for (const z of j.zones) z.g = decode(z.g); return j; })
      .catch((e) => { delete files[name]; throw e; });
    return files[name];
  }
  function inside(g, lat, lon) {
    let c = false;
    for (const r of g) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if ((r[i] > lat) !== (r[j] > lat) && lon < ((r[j + 1] - r[i + 1]) * (lat - r[i])) / (r[j] - r[i]) + r[i + 1]) c = !c;
    }
    return c;
  }
  const zonesAt = (zs, lat, lon) => (zs || []).filter((z) => lat >= z.b[0] && lat <= z.b[2] && lon >= z.b[1] && lon <= z.b[3] && inside(z.g, lat, lon));
  let stocked = null, zones = null, gauges = null, tides = null;
  const ready = Promise.all([
    load("stocked").then((j) => { stocked = j; }).catch(() => {}),
    load("gauges").then((j) => { gauges = j.gauges; }).catch(() => {}),
    load("tides").then((j) => { tides = j.stations; }).catch(() => {}),
  ]);
  // Hidden spots: stocked lakes with no road near them (data/fishing/walkin.json, built by scripts/build-fishing.mjs)
  // and waters picked by hand from park pages and regulations (data/fishing-hidden.json, edited by hand).
  let hidden = [];
  const hiddenReady = Promise.all([
    load("walkin").then((j) => j.w.map(([lat, lon, n, p, km, ha]) => ({ lat, lon, n, p, km, ha, walk: true }))).catch(() => []),
    fetch("data/fishing-hidden.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : { spots: [] })).then((j) => j.spots.map((x) => ({ ...x, lat: x.c[0], lon: x.c[1] }))).catch(() => []),
  ]).then(([w, h]) => { hidden = [...h, ...w.filter((x) => !h.some((y) => Math.abs(y.lat - x.lat) < 0.01 && Math.abs(y.lon - x.lon) < 0.015))]; drawPoints(); });
  const loadZones = () => (zones ? Promise.resolve(zones) : load("zones").then((j) => (zones = j.zones)).catch(() => []));

  // Offline maps (offline.js) saved in Fishing: every fishing file (fish per water, stocking, rules, launches, hidden
  // spots, gauges, tides; ~5 MB for all of Canada) and the heights the Route to a spot uses (zoom 12, fish-route.js).
  window.tfFishOffline = (box) => {
    const data = [...["boating", "eat", "fishlist", "gauges", "spots", "stocked", "tidal", "tides", "walkin", "zones", "qcrules", "onrules"].map((n) => `data/fishing/${n}.json`),
      "data/fishing-hidden.json", "data/fishing-launches.json", "data/fishing/depth/i.json", ...depthOffline(box)].map((u) => new URL(u, location.href).href);
    const tx = (lon) => Math.floor(((lon + 180) / 360) * 4096), ty = (lat) => Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 4096);
    const tiles = [];
    for (let x = tx(box[1]); x <= tx(box[3]); x++) for (let y = ty(box[2]); y <= ty(box[0]); y++) tiles.push(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/12/${x}/${y}.png`);
    return { data, tiles };
  };

  // The lake depth squares in the box (when the depth index is loaded, i.e. the layer was used or a spot card opened).
  function depthOffline(box) {
    if (!depthIdx) return [];
    const out = [];
    for (let r = Math.floor(box[0] * 4); r <= Math.floor(box[2] * 4); r++) for (let c = Math.floor(box[1] * 4); c <= Math.floor(box[3] * 4); c++) if (depthIdx.t.has(`${r}_${c}`)) out.push(`data/fishing/depth/${r}_${c}.json`);
    return out.slice(0, 400);
  }

  // The province for links when no zone file covers the spot (rough lines, only to pick which rules to point to).
  function provinceAt(lat, lon, zs) {
    const k = zs.find((z) => ["bc", "ab", "on", "qc", "nb", "ns", "nl"].includes(z.k));
    if (k) return k.k;
    if (lat > 60) return lon < -124 ? "yt" : lon < -102 ? "nt" : "nu";
    if (lat > 45.9 && lat < 47.1 && lon > -64.5 && lon < -61.9) return "pe";
    if (lat < 47.1 && lon > -66.4 && lon < -59.6 && !(lat > 45.6 && lon < -64.1)) return "ns";
    if (lon > -69.1 && lon < -63.7 && lat > 44.5 && lat < 48.1) return "nb";
    if (lon > -67.9 && lat > 46.5 && (lon > -59.5 || lat > 51.6)) return "nl";
    if (lon < -120 && lat < 60) return "bc";
    if (lon < -110) return "ab";
    if (lon < -102) return "sk";
    if (lon < -95 || (lat > 52.8 && lon < -88.9)) return "mb";
    return lon < -79.5 ? "on" : "qc";
  }
  const PROV = {
    bc: ["British Columbia", "https://www2.gov.bc.ca/gov/content/sports-culture/recreation/fishing-hunting/fishing/fishing-regulations"],
    ab: ["Alberta", "https://albertaregulations.ca/fishingregs/"],
    sk: ["Saskatchewan", "https://www.saskatchewan.ca/fishing"],
    mb: ["Manitoba", "https://www.gov.mb.ca/fish-wildlife/angling/index.html"],
    on: ["Ontario", "https://www.ontario.ca/document/ontario-fishing-regulations-summary"],
    qc: ["Quebec", "https://www.quebec.ca/en/tourism-and-recreation/sporting-and-outdoor-activities/sport-fishing"],
    nb: ["New Brunswick", "https://www.gnb.ca/en/campaign/fish-nb-days/fish-2026-27.html"],
    ns: ["Nova Scotia", "https://novascotia.ca/fish/sportfishing/"],
    pe: ["Prince Edward Island", "https://www.princeedwardisland.ca/en/topic/fishing"],
    nl: ["Newfoundland and Labrador", "https://www.dfo-mpo.gc.ca/fisheries-peches/recreational-recreative/nl-tnl-eng.html"],
    yt: ["Yukon", "https://yukon.ca/en/outdoor-recreation-and-wildlife/fishing"],
    nt: ["Northwest Territories", "https://www.gov.nt.ca/ecc/en/services/fishing"],
    nu: ["Nunavut", "https://www.gov.nu.ca/en/environment-and-climate-change/sport-fishing"],
  };
  const NS_HANDBOOK = "https://beta.novascotia.ca/sites/default/files/documents/1-2412/anglers-handbook-en.pdf";   // 2026, a page per area
  // Where to buy a licence, by province (alex 2026-10-26: "add a link to buy the appropriate licence for the region").
  const LIC = {
    bc: ["BC freshwater fishing licence", "https://www.fishing.gov.bc.ca/"],
    ab: ["Alberta sportfishing licence (AlbertaRELM)", "https://www.albertarelm.com/"],
    sk: ["Saskatchewan angling licence (HAL)", "https://www.saskatchewanhal.ca/"],
    mb: ["Manitoba angling licence", "https://www.manitobaelicensing.ca/"],
    on: ["Ontario Outdoors Card and fishing licence", "https://www.huntandfishontario.com/"],
    qc: ["Quebec fishing licence (Mon dossier chasse et pêche)", "https://www.quebec.ca/tourisme-loisirs-sport/activites-sportives-et-de-plein-air/mon-dossier-chasse-peche"],
    nb: ["New Brunswick angling licence", "https://www2.gnb.ca/content/gnb/en/services/services_renderer.201035.Fishing_Licence.html"],
    ns: ["Nova Scotia general fishing licence", "https://sportfishing.novascotia.ca/"],
    pe: ["PEI angling licence", "https://www.princeedwardisland.ca/en/service/buy-an-angling-licence-online"],
    nl: ["Newfoundland and Labrador licences", "https://www.gov.nl.ca/ffa/licensing/"],
    yt: ["Yukon fishing licence", "https://yukon.ca/en/buy-fishing-licence"],
    nt: ["NWT sport fishing licence", "https://www.gov.nt.ca/ecc/en/services/get-fishing-licence"],
    nu: ["Nunavut sport fishing licence (sold at Environment offices, lodges and stores)", "https://www.gov.nu.ca/en/environment-and-climate-change/sport-fishing"],
  };
  const PC_PERMIT = "https://parks.canada.ca/voyage-travel/admission";
  const BC_TIDAL = "https://www.pac.dfo-mpo.gc.ca/fm-gp/rec/licence-permis/index-eng.html";
  // Quebec's zecs, wildlife reserves and parks (ID_TYPE_ENDRO): what they are and what you pay or book.
  const QCT = {
    16: ["A zec: open to everyone,", "but you register and pay the zec's daily fishing fee at its entrance, and it has its own quotas."],
    15: ["A wildlife reserve (Sépaq):", "fishing is by reservation and right of access with Sépaq, with its own quotas. <a href=\"https://www.sepaq.com/rf/\" target=\"_blank\" rel=\"noopener\">Sépaq wildlife reserves</a>"],
    14: ["A Quebec national park (Sépaq):", "fishing only in some lakes, with a Sépaq right of access and the park's rules. <a href=\"https://www.sepaq.com/pq/\" target=\"_blank\" rel=\"noopener\">Sépaq parks</a>"],
    5: ["A community wildlife area:", "pay its access fee and follow its own rules."],
    0: ["Its own fishing rules:", "check the zone's exceptions before you fish."],
  };
  function licHtml(lat, lon, here, prov) {
    const L = LIC[prov];
    if (!L) return "";
    const np = here.find((z) => z.k === "np"), qt = here.find((z) => z.k === "qct");
    const tidal = here.some((z) => z.k === "pfma") || (prov === "bc" && nearestTide(lat, lon, 3));
    const rows = [];
    if (np) rows.push(`<li style="--c:${C.park}"><b>Parks Canada fishing permit</b>Needed in ${esc(np.n)} instead of the provincial licence. <a href="${PC_PERMIT}" target="_blank" rel="noopener">Buy or check</a></li>`);
    rows.push(`<li style="--c:${C.zone}"><b>${esc(L[0])}</b><a href="${L[1]}" target="_blank" rel="noopener">Buy online</a>${np ? " (for waters outside the park)" : ""}</li>`);
    if (tidal) rows.push(`<li style="--c:${C.tide}"><b>BC tidal water licence</b>Saltwater needs its own licence from Fisheries and Oceans Canada (plus a salmon stamp to keep salmon). <a href="${BC_TIDAL}" target="_blank" rel="noopener">Buy online</a></li>`);
    if (qt && QCT[qt.t]) rows.push(`<li style="--c:${qt.t === 16 ? C.zec : C.fee}"><b>${esc(qt.n)}</b>${QCT[qt.t][0]} ${QCT[qt.t][1]}</li>`);
    return fold("lic", IC.rules, "Licence", np ? "Parks Canada permit" : tidal ? "Fresh and tidal" : "Buy online", `<ul class="fs-list">${rows.join("")}</ul><p class="fs-note">Licences are for the season you're in; kids and seniors often fish free or at a discount, so check the page.</p>`);
  }

  // ---------- boating rules (data/fishing/boating.json, Transport Canada's Vessel Operation Restriction Regulations) ----------
  let boating = null;
  const loadBoating = () => (boating ? Promise.resolve(boating) : load("boating").then((j) => (boating = j)).catch(() => null));
  const BOAT = { 1: () => "No boats at all", 2: () => "No motors (paddle and row only)", 3: () => "Electric motors only, up to 7.5 kW (10 hp)",
    4: (x) => `Motors up to ${x} kW (${Math.round(x * 1.341)} hp)`, 5: (x) => `Speed limit ${x} km/h`, 6: (x) => `No waterskiing or towing${x ? ` except ${x}` : ""}`,
    7: (x) => `No wake surfing${x ? ` except ${x}` : ""}`, 8: () => "No races or events without a permit" };
  const BOAT_SHORT = { 1: () => "No boats", 2: () => "No motors", 3: () => "Electric only", 4: (x) => `${Math.round(x * 1.341)} hp max`, 5: (x) => `${x} km/h`, 6: () => "No towing", 7: () => "No wake surf", 8: () => "No events" };
  // Motor and speed limits written elsewhere (a hidden spot's notes, the lake's fishing rules): alex 2026-10-26, Callaghan
  // Lake said "motors under 10 hp" in its notes while Boating said "No special limits". Each clause that names one is
  // shown in Boating with where it comes from.
  const BOAT_RE = /\b\d+(?:\.\d+)?\s?(?:hp|horsepower|kw)\b|electric (?:motors?|only|outboards?)|\bno (?:motors?|motori[sz]ed|power ?boats?|gas(?:oline)? motors?|boats?)\b|non-?motori[sz]ed|motors? (?:under|up to|prohibited|not (?:permitted|allowed))|engine power|speed (?:restriction|limit)|\d+\s?km\/h|paddl(?:e|ing) only|moteurs? (?:électrique|interdit)/i;
  const boatBits = (text) => String(text || "").split(/[.;]\s+|\.$/).flatMap((x) => x.split(/,\s+/)).map((x) => x.trim().replace(/[.;,]+$/, "")).filter((x) => BOAT_RE.test(x));
  function boatShort(t) {
    let m;
    if ((m = t.match(/(\d+(?:\.\d+)?)\s?(?:hp|horsepower)\b/i))) return `${m[1]} hp max`;
    if ((m = t.match(/(\d+(?:\.\d+)?)\s?kw\b/i))) return `${Math.round(m[1] * 1.341)} hp max`;
    if (/electric|électrique/i.test(t)) return "Electric only";
    if (/\bno (?:motors?|motori|power|gas)|non-?motori|motors? (?:prohibited|not)|paddl|moteurs? interdit/i.test(t)) return "No motors";
    if ((m = t.match(/(\d+)\s?km\/h/i))) return `${m[1]} km/h`;
    return "Has limits";
  }
  async function boatHtml(lat, lon, name, prov, extra = []) {
    const b = await loadBoating();
    if (!b) return "";
    const nm = plain(name);
    // A water's rule is listed at its middle: the same name within 25 km, or anything listed within 1.5 km of the spot.
    // Alberta's are listed by name only.
    const re = nm ? new RegExp(`(^| )${nm.replace(/[^a-z0-9 ]/g, "")}( |$)`) : null;
    const hit = b.rules.filter((r) => {
      if (r[0] == null) return nm && r[3] === prov && (plain(r[4]) === nm || plain(r[5]) === nm);
      if (Math.abs(r[0] - lat) > 0.25 || Math.abs(r[1] - lon) > 0.4) return false;
      const d = km(lat, lon, r[0], r[1]);
      return d <= 1.5 || (re && re.test(plain(r[4])));   // the water's own name, not its "where" note (Alpha Lake is "near Alta Lake")
    });
    // "That part of …" rules cover a bay or beach only, so they read "in parts" and come after whole-water rules.
    const part = (r) => (/\b(that part|those parts|parts? of|portion|an area|areas? of|within \d+ ?m|adjacent to|swimming area|beach)\b/i.test(r[4]) ? 1 : 0);
    // The schedules describe each part with long coordinate lines; keep the plain-words start ("…, adjacent to Centennial Beach").
    const clean = (t) => { t = String(t || "").split(/,? (?:between the shore|bounded by|from a point|at coordinates|enclosed by|lying (?:north|south|east|west)|described as)| Note:|\s\d{1,3}°/i)[0].replace(/(?:[\s,;(]+|\b(?:at|of|to|from|and|a|the|point|line|beginning|located|upstream|delineated by|by|[A-Z])\b)+$/, "").trim(); return t.length > 140 ? t.slice(0, 137).replace(/\s+\S*$/, "") + "…" : t; };
    const seen = new Set(), rules = hit.filter((r) => { const k = `${r[2]}|${r[6]}|${part(r)}`; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => part(a) - part(b) || a[2] - b[2]);
    const general = `<p class="fs-note">Everywhere: a Pleasure Craft Operator Card to drive anything with a motor, and a life jacket for each person. In Ontario, Quebec, Manitoba, New Brunswick and Nova Scotia, 10 km/h within 30 m of shore unless signs say otherwise. <a href="${esc(b.src)}" target="_blank" rel="noopener">Transport Canada's list of restricted waters</a></p>`;
    const xs = [], xSeen = new Set();
    const tcShort = new Set(rules.map((r) => BOAT_SHORT[r[2]](r[6])));   // already said by Transport Canada's list
    for (const x of extra) for (const t of boatBits(x.t)) { const k = t.toLowerCase(); if (!xSeen.has(k) && !tcShort.has(boatShort(t))) { xSeen.add(k); xs.push({ ...x, t }); } }
    const xli = xs.map((x) => `<li style="--c:${/no motors|electric/i.test(boatShort(x.t)) ? "#e03131" : "#f08c00"}"><b>${esc(x.t[0].toUpperCase() + x.t.slice(1))}</b><small>From ${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.src)}</a>` : esc(x.src)}</small></li>`).join("");
    const xSum = [...new Set(xs.map((x) => boatShort(x.t)))].slice(0, 2).join(", ");
    if (!rules.length && xs.length) return fold("boat", IC.boat, "Boating", esc(xSum), `<ul class="fs-list">${xli}</ul><p class="fs-note">${esc(name || "This water")} isn't on Transport Canada's list of restricted waters, but the sources above give these limits: follow any signs at the launch.</p>${general}`);
    if (!rules.length) return nm || nearestTide(lat, lon, 3) ? fold("boat", IC.boat, "Boating", "No special limits", `<p class="fs-note">${esc(name || "This water")} isn't on Transport Canada's list of restricted waters.</p>${general}`) : "";
    const li = rules.map((r) => `<li style="--c:${r[2] <= 3 ? "#e03131" : "#f08c00"}"><b>${esc(BOAT[r[2]](r[6]))}${part(r) ? " (part of the water)" : ""}</b>${esc(clean(r[4]))}${r[5] ? ` (${esc(clean(r[5]))})` : ""}</li>`).join("");
    const whole = rules.filter((r) => !part(r)), sum = [...new Set((whole.length ? whole : rules).map((r) => BOAT_SHORT[r[2]](r[6])))].slice(0, 2).join(", ");
    return fold("boat", IC.boat, "Boating", esc(whole.length ? sum : `${sum} in parts`), `<ul class="fs-list">${li}${xli}</ul>${general}`);
  }
  const BC_PDF = "https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/freshwater-fishing/";
  const BC_REGION = { 1: ["1", "region_1_vancouver_island"], 2: ["2", "region_2_lower_mainland"], 3: ["3", "region_3_thompson"], 4: ["4", "region_4_kootenay"], 5: ["5", "region_5_cariboo"],
    6: ["6", "region_6_skeena"], 7: ["7A", "region_7a_omineca"], 9: ["7B", "region_7b_peace"], 8: ["8", "region_8_okanagan"] };

  // ---------- river gauges: live flow against the usual flow for the month ----------
  // Each gauge: [id, name, lat, lon, province, usual flow by month (m³/s) or null, usual level by month (m) or null].
  const readings = new Map();   // id -> { t, q, h } the latest reading
  const LIGHTS = {
    vlow: ["Very low", C.vlow, "Warm, skinny water: go early in the day and keep fish in the water."],
    low: ["Low and clear", C.low, "Fish are spooky: long light leaders, small flies, stay back from the bank."],
    ok: ["Normal", C.ok, "Good flow for this time of year."],
    high: ["High", C.high, "Fish the soft edges and slow water; bigger, darker flies."],
    blown: ["Blown out", C.blown, "Too high and dirty to fish well: try a lake, or come back when it drops."],
    none: ["No usual flow known", C.none, ""],
  };
  function lightOf(g, r) {
    if (!g || !r) return "none";
    const m = new Date().getMonth(), qn = g[5] && g[5][m], hn = g[6] && g[6][m];
    if (r.q != null && qn) {
      const x = r.q / qn;
      return x < 0.4 ? "vlow" : x < 0.75 ? "low" : x < 1.5 ? "ok" : x < 2.2 ? "high" : "blown";
    }
    if (r.h != null && hn != null) {
      const d = r.h - hn;
      return d < -0.35 ? "low" : d < 0.3 ? "ok" : d < 0.8 ? "high" : "blown";
    }
    return "none";
  }
  const ratioText = (g, r) => {
    const m = new Date().getMonth(), qn = g[5] && g[5][m], hn = g[6] && g[6][m];
    if (r && r.q != null && qn) return `${fmtQ(r.q)} now, usual for ${MONTHS[m]} ${fmtQ(qn)} (${Math.round((r.q / qn) * 100)}%)`;
    if (r && r.h != null && hn != null) return `Level ${r.h.toFixed(2)} m, usual for ${MONTHS[m]} ${hn.toFixed(2)} m (${r.h - hn >= 0 ? "+" : ""}${Math.round((r.h - hn) * 100)} cm)`;
    if (r && r.q != null) return `${fmtQ(r.q)} now`;
    if (r && r.h != null) return `Level ${r.h.toFixed(2)} m`;
    return "No reading in the last few hours";
  };
  const fmtQ = (q) => `${q < 0.1 ? q.toFixed(2) : q < 10 ? q.toFixed(1) : Math.round(q)} m³/s`;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  let readBox = null, readBusy = false;
  async function loadReadings() {
    if (!isFish() || !shown.has("gauges") || map.getZoom() < LAYERS.gauges.minZoom || readBusy) return;
    const b = map.getBounds().pad(0.3);
    if (readBox && readBox.contains(b) && Date.now() - readBox.at < 10 * 60e3) return;
    const w = Math.max(-141, b.getWest()), e = Math.min(-52, b.getEast()), s = Math.max(41.5, b.getSouth()), n = Math.min(70, b.getNorth());
    if (e - w > 12 || n - s > 8) return;   // too far out to ask for every reading
    readBusy = true;
    try {
      const since = new Date(Date.now() - 4 * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
      const j = await getJ(`${ECCC}/hydrometric-realtime/items?bbox=${w.toFixed(3)},${s.toFixed(3)},${e.toFixed(3)},${n.toFixed(3)}&datetime=${since}/..&limit=10000&properties=STATION_NUMBER,DATETIME,LEVEL,DISCHARGE&f=json`, 20000);
      for (const f of j.features || []) {
        const p = f.properties, o = readings.get(p.STATION_NUMBER);
        if (!o || o.t < p.DATETIME) readings.set(p.STATION_NUMBER, { t: p.DATETIME, q: p.DISCHARGE, h: p.LEVEL });
      }
      readBox = L.latLngBounds([s, w], [n, e]); readBox.at = Date.now();
      drawPoints(); renderNow(); renderToday();
    } catch {} finally { readBusy = false; }
  }
  // The last 7 days at one gauge, for the card's chart and the trend.
  const series = new Map();
  async function gaugeSeries(id) {
    if (series.has(id)) return series.get(id);
    const p = (async () => {
      const since = new Date(Date.now() - 7 * 864e5).toISOString().replace(/\.\d+Z$/, "Z");
      const j = await getJ(`${ECCC}/hydrometric-realtime/items?STATION_NUMBER=${id}&datetime=${since}/..&limit=5000&properties=DATETIME,LEVEL,DISCHARGE&sortby=DATETIME&f=json`, 20000);
      return (j.features || []).map((f) => [Date.parse(f.properties.DATETIME), f.properties.DISCHARGE, f.properties.LEVEL]).sort((a, b) => a[0] - b[0]);
    })().catch(() => { series.delete(id); return []; });
    series.set(id, p);
    return p;
  }
  function trendOf(pts) {
    const k = pts.some((x) => x[1] != null) ? 1 : 2, v = pts.filter((x) => x[k] != null);
    if (v.length < 4) return null;
    const last = v[v.length - 1], t0 = last[0] - 24 * 3600e3;
    let prev = v[0]; for (const x of v) { if (x[0] <= t0) prev = x; else break; }
    if (prev === last) return null;
    const ch = k === 1 ? (last[1] - prev[1]) / Math.max(0.1, prev[1]) : last[2] - prev[2];
    const word = k === 1 ? (ch > 0.15 ? "rising fast" : ch > 0.04 ? "rising" : ch < -0.1 ? "dropping" : ch < -0.03 ? "dropping slowly" : "steady") : (ch > 0.15 ? "rising fast" : ch > 0.04 ? "rising" : ch < -0.08 ? "dropping" : ch < -0.02 ? "dropping slowly" : "steady");
    return { word, ch, k, pct: k === 1 ? Math.round(ch * 100) : Math.round(ch * 100) };
  }
  function sparkline(pts, g) {
    const k = pts.some((x) => x[1] != null) ? 1 : 2, v = pts.filter((x) => x[k] != null);
    if (v.length < 4) return "";
    const W = 300, H = 46, t0 = v[0][0], t1 = v[v.length - 1][0];
    const m = new Date().getMonth(), usual = k === 1 ? g[5] && g[5][m] : g[6] && g[6][m];
    let lo = Math.min(...v.map((x) => x[k])), hi = Math.max(...v.map((x) => x[k]));
    if (usual != null) { lo = Math.min(lo, usual); hi = Math.max(hi, usual); }
    if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
    const X = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W, Y = (y) => H - 3 - ((y - lo) / (hi - lo)) * (H - 8);
    const step = Math.max(1, Math.floor(v.length / 150));
    const d = v.filter((_, i) => i % step === 0 || i === v.length - 1).map((x, i) => `${i ? "L" : "M"}${X(x[0]).toFixed(1)},${Y(x[k]).toFixed(1)}`).join("");
    const u = usual != null ? `<line x1="0" x2="${W}" y1="${Y(usual).toFixed(1)}" y2="${Y(usual).toFixed(1)}" stroke="${C.ok}" stroke-dasharray="4 4" stroke-width="1.5"/><text x="${W - 2}" y="${Math.max(10, Y(usual) - 3).toFixed(1)}" text-anchor="end" font-size="10" fill="${C.ok}">usual</text>` : "";
    return `<svg class="fs-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="The last 7 days">${u}<path d="${d}" fill="none" stroke="${ACC}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><p class="fs-note">The last 7 days${usual != null ? "; dashed: the usual for the month" : ""}.</p>`;
  }

  // ---------- tides (Canadian Hydrographic Service) ----------
  const tideCache = new Map();
  function tidesAt(id) {
    if (tideCache.has(id)) return tideCache.get(id);
    const from = new Date(Date.now() - 3 * 3600e3).toISOString().replace(/\.\d+Z$/, "Z"), to = new Date(Date.now() + 48 * 3600e3).toISOString().replace(/\.\d+Z$/, "Z");
    const p = getJ(`${IWLS}/stations/${id}/data?time-series-code=wlp-hilo&from=${from}&to=${to}`).then((a) => a.map((x) => [Date.parse(x.eventDate), x.value]))
      .catch(() => { tideCache.delete(id); return []; });
    tideCache.set(id, p);
    return p;
  }
  // High or low: each turn compared with its neighbours.
  const tideKinds = (a) => a.map((x, i) => [x[0], x[1], (a[i - 1] ? x[1] > a[i - 1][1] : x[1] > (a[i + 1] || x)[1]) ? "High" : "Low"]);

  // ---------- launches and access: OpenStreetMap (Overpass) and Ontario's fishing access points ----------
  const access = new Map();   // key -> { lat, lon, kind, name, ... }
  const accTiles = new Set();
  let accBusy = false;
  // All of them for Canada in data/fishing/spots.json (scripts/build-fishing.mjs: OpenStreetMap and Ontario's access
  // points), loaded once when the layer first shows.
  async function loadAccess() {
    if (!isFish() || !(shown.has("access") || shown.has("launch")) || map.getZoom() < LAYERS.access.minZoom || accBusy || accTiles.size) return;
    accBusy = true;
    try {
      const j = await load("spots");
      const KIND = ["fishing", "pier", "launch"];
      for (const [lat, lon, k, name, facts, src] of j.spots || []) access.set(`${lat},${lon},${k}`, { lat, lon, kind: KIND[k] || "fishing", name: name || "", facts: facts || "", src: src === "on" ? "Ontario" : src === "bc" ? "BC coastal launches" : "OpenStreetMap" });
      // Launches missing from OpenStreetMap, added by hand (data/fishing-launches.json).
      const hand = await fetch("data/fishing-launches.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : { launches: [] })).catch(() => ({ launches: [] }));
      // A hand-added launch replaces any launch from the data within about 200 m (it was checked on the map).
      for (const [lat, lon, name, facts] of hand.launches || []) {
        for (const [key, a] of access) if (a.kind === "launch" && Math.abs(a.lat - lat) < 0.002 && Math.abs(a.lon - lon) < 0.003) access.delete(key);
        access.set(`${lat},${lon},2`, { lat, lon, kind: "launch", name, facts, src: "added by hand" });
      }
      accTiles.add("all");
      drawPoints();
    } catch {} finally { accBusy = false; }
  }

  // ---------- drawing the points ----------
  map.createPane("fish").style.zIndex = 620;
  map.createPane("fishTiles").style.zIndex = 350;
  map.createPane("fishLines").style.zIndex = 404;
  map.getPane("fishLines").style.pointerEvents = "none";
  const renderer = L.canvas({ pane: "fish", padding: 0.2 });
  const ptLayer = L.layerGroup(), zoneLayer = L.layerGroup(), spotLayer = L.layerGroup();
  const depthTiles = L.tileLayer.wms(WMS, { layers: "pub:WHSE_FISH.BATH_LAKE_BATHYMETRIC_SP", styles: "", format: "image/png", transparent: true, version: "1.1.1",
    pane: "fishTiles", minZoom: 12, maxZoom: 19, opacity: 0.85, bounds: L.latLngBounds([48.2, -139.1], [60, -114]), attribution: "Lake depth: DataBC (OGL-BC)" });
  const allFish = [ptLayer, zoneLayer, spotLayer];
  const pts3d = [];   // the same points for the 3D map
  // A dot with its layer's picture inside (once it's big enough to read), drawn on the same canvas as the plain dots.
  const glyphPaths = {};
  const GlyphDot = L.CircleMarker.extend({
    _updatePath() {
      L.CircleMarker.prototype._updatePath.call(this);
      const g = this.options.glyph, ctx = this._renderer._ctx, p = this._point;
      if (!g || !ctx || !p || this._radius < 7 || this._empty()) return;
      const s = (this._radius * 1.25) / 24;
      ctx.save(); ctx.translate(p.x - 12 * s, p.y - 12 * s); ctx.scale(s, s);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.6; ctx.lineCap = ctx.lineJoin = "round";
      ctx.stroke(glyphPaths[g] || (glyphPaths[g] = new Path2D(GLYPH[g])));
      ctx.restore();
    },
  });
  const freshDays = (w) => { const d = w.r.find((r) => /^\d{4}-\d\d-\d\d$/.test(r[0])); return d ? daysAgo(d[0]) : null; };
  function drawPoints() {
    ptLayer.clearLayers(); pts3d.length = 0;
    if (!isFish()) { sync3d(); return; }   // empty the 3D dots too, or they stay on the 3D map in other sports
    const z = map.getZoom(), b = map.getBounds().pad(0.4);
    const dot = (lat, lon, color, r, open, label, kind, glyph) => {
      // A soft shadow under each dot lifts it off busy satellite pictures.
      ptLayer.addLayer(L.circleMarker([lat, lon], { renderer, radius: r + 2.5, stroke: false, fillColor: "#0b1220", fillOpacity: 0.28, interactive: false }));
      const m = new GlyphDot([lat, lon], { renderer, radius: r, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1, bubblingMouseEvents: false, glyph }).on("click", (e) => { L.DomEvent.stop(e); open(); });
      if (label) m.bindTooltip(label, { direction: "top", offset: [0, -r], opacity: 0.95 });
      ptLayer.addLayer(m);
      pts3d.push({ lat, lon, color, r, open, label, kind });
    };
    if (shown.has("stocked") && stocked && z >= LAYERS.stocked.minZoom) {
      for (const w of stocked.waters) {
        if (!b.contains([w.c[0], w.c[1]])) continue;
        const d = freshDays(w);
        dot(w.c[0], w.c[1], d != null && d <= 30 ? C.fresh : C.stocked, z >= 11 ? 7 : 5, () => openWater(w), `${w.n}${d != null ? ` · stocked ${d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`}` : ""}`, "stocked", z >= 11 && "stocked");
      }
    }
    if (shown.has("hidden") && z >= LAYERS.hidden.minZoom) {
      for (const h of hidden) if (b.contains([h.lat, h.lon])) dot(h.lat, h.lon, C.hidden, z >= 10 ? 10 : 7, () => openHidden(h), `${h.n} · ${hiddenWhy(h)}`, "hidden", "hidden");
    }
    if (shown.has("gauges") && gauges && z >= LAYERS.gauges.minZoom) {
      for (const g of gauges) {
        if (!b.contains([g[2], g[3]])) continue;
        const r = readings.get(g[0]), l = lightOf(g, r);
        dot(g[2], g[3], LIGHTS[l][1], z >= 10 ? 8 : 6, () => openGauge(g), `${g[1]} · ${LIGHTS[l][0]}`, "gauge");
      }
    }
    if (shown.has("tides") && tides && z >= LAYERS.tides.minZoom) {
      for (const t of tides) if (b.contains([t[2], t[3]])) dot(t[2], t[3], C.tide, z >= 10 ? 9 : 7.5, () => openTide(t), `Tides: ${t[1]}`, "tide", "tides");
    }
    if ((shown.has("access") || shown.has("launch")) && z >= LAYERS.access.minZoom) {
      for (const a of access.values()) if (shown.has(a.kind === "launch" ? "launch" : "access") && b.contains([a.lat, a.lon])) dot(a.lat, a.lon, a.kind === "launch" ? C.launch : C.access, z >= 11 ? 9 : 7.5, () => openAccess(a), accessName(a), "access", a.kind === "launch" ? "launch" : "access");
    }
    sync3d();
  }
  const accessName = (a) => a.name || (a.kind === "launch" ? "Boat launch" : a.kind === "pier" ? "Fishing pier" : "Fishing spot");
  // Zones and regions, Hunting style (alex 2026-10-26: "more like the hunting one, all the different regions"): each
  // zone a soft colour with its name on it; parks, zecs and reserves coloured by what they need. A tap anywhere on the
  // map opens the spot card with that place's rules and licence.
  if (!map.getPane("fishLabels")) { map.createPane("fishLabels").style.zIndex = 640; map.getPane("fishLabels").style.pointerEvents = "none"; }
  const labelLayer = L.layerGroup();
  allFish.push(labelLayer);
  const ZONE_TINT = ["#4dabf7", "#69db7c", "#ffd43b", "#da77f2", "#ff8787", "#38d9a9", "#ffa94d", "#748ffc"];
  const AREA_COLOR = (z) => (z.k === "noer" ? C.nofish : z.k === "np" ? C.park : z.t === 16 ? C.zec : C.fee);
  const isArea = (z) => z.k === "np" || z.k === "qct" || z.k === "noer";
  const ll = (z) => z.g.map((r) => { const o = []; for (let i = 0; i < r.length; i += 2) o.push([r[i], r[i + 1]]); return o; });
  function drawZones() {
    zoneLayer.clearLayers(); labelLayer.clearLayers();
    const zOn = shown.has("zones"), aOn = shown.has("areas") && map.getZoom() >= LAYERS.areas.minZoom;
    if (!isFish() || (!zOn && !aOn)) return;
    loadZones().then((zs) => {
      if (!isFish()) return;
      zoneLayer.clearLayers(); labelLayer.clearLayers();
      const z0 = map.getZoom(), view = map.getBounds().pad(0.5);
      zs.forEach((z, i) => {
        const area = isArea(z);
        if (area ? !aOn : !zOn) return;
        if (!view.intersects([[z.b[0], z.b[1]], [z.b[2], z.b[3]]])) return;
        const c = area ? AREA_COLOR(z) : z.k === "pfma" ? C.tide : ZONE_TINT[i % ZONE_TINT.length];
        L.polygon(ll(z), { pane: "fishLines", color: area ? c : z.k === "pfma" ? C.tide : C.zone, weight: z.k === "noer" ? 3 : area ? 2 : 1.6, opacity: 0.8, dashArray: area ? null : "6 5",
          fill: true, fillColor: c, fillOpacity: z.k === "noer" ? 0.38 : area ? 0.22 : z.k === "pfma" ? 0.04 : 0.1, interactive: false, smoothFactor: 1.5 }).addTo(zoneLayer);
        // Names: zones from zoom 5, parks and zecs once they're big enough on screen, Pacific areas from zoom 9.
        const big = (z.b[2] - z.b[0]) * 2 ** z0 > 6;
        if ((z.k === "pfma" && z0 < 9) || (area && !big)) return;
        const name = z.k === "noer" ? `No fishing: ${z.n.replace(/^R[ée]serve [ée]cologique (?:de la |des |du |de l'|de |d')?| Ecological Reserve$/gi, "")}` : z.k === "qc" ? `Zone ${z.id}` : z.k === "bc" ? `Region ${z.id}` : z.k === "ns" ? `Area ${z.id}` : z.k === "nb" ? `${z.id} ${z.n}` : z.n;
        L.marker([(z.b[0] + z.b[2]) / 2, (z.b[1] + z.b[3]) / 2], { pane: "fishLabels", interactive: false, keyboard: false,
          icon: L.divIcon({ className: "fs-zlabel", html: `<span style="--c:${area ? c : C.zone}">${esc(name)}</span>`, iconSize: null }) }).addTo(labelLayer);
      });
      sync3d(); renderLayers();
    });
  }
  map.on("moveend", () => { if (isFish() && (shown.has("zones") || shown.has("areas"))) drawZones(); });
  // Crown land: each province's own map (crownland.js), under the water colours.
  const crownTiles = window.tfCrown ? window.tfCrown.leaflet("fishTiles", 0.26) : null;
  function syncTiles() {
    const want = isFish() && shown.has("depth") && map.getBounds().intersects(depthTiles.options.bounds);   // BC only
    if (want && !map.hasLayer(depthTiles)) depthTiles.addTo(map); else if (!want && map.hasLayer(depthTiles)) map.removeLayer(depthTiles);
    syncDepth();
    const crown = isFish() && shown.has("crown") && crownTiles;
    if (crown && !map.hasLayer(crownTiles)) crownTiles.addTo(map); else if (!crown && crownTiles && map.hasLayer(crownTiles)) map.removeLayer(crownTiles);
  }
  // The land at the spot, for getting to the water.
  const CROWN_SAY = {
    crown: "Public land: you can usually walk in to the shore and fish from it.",
    private: "Private land: ask the owner before you cross it to the water, or use a public access or a boat.",
    lease: "Leased Crown land: keep clear of camps and ask the leaseholder before you cross it.",
  };
  async function landHtml(lat, lon, prov) {
    const x = window.tfCrown && window.tfCrown.has(prov) ? await window.tfCrown.at(lat, lon, prov).catch(() => null) : null;
    return x ? `<p class="fs-note fs-land" style="border-left:4px solid ${x.c};padding-left:8px"><b>Land: ${esc(x.t)}</b><br>${esc(CROWN_SAY[x.k] || x.d)}</p>` : "";
  }

  // ---------- lake depth lines outside BC ----------
  // alex 2026-10-27 "add lake depths across Canada". BC draws from its own map server (depthTiles above). Ontario and
  // Quebec lines and New Brunswick soundings come from data/fishing/depth/ (scripts/build-lake-depth.py: Ontario's map
  // server takes a minute per question, Quebec only offers files), one file per 0.25 degree square; Manitoba from the
  // province's own vector tiles. All drawn by MapLibre (the vector map's library) so the depths can sit along the lines,
  // in one map made only while the layer is on and you're zoomed in on a place that has some (phones: one GL map less).
  const MB_DEPTH = "https://tiles.arcgis.com/tiles/mMUesHYPkXjaFGfS/arcgis/rest/services/Manitoba_Waterbody_Contours_VectorTile/VectorTileServer";
  const MB_BOX = [48.99, -102.1, 60, -88.9];
  const DEPTH_ZOOM = 12;
  const DEPTH_ATTR = "Lake depth: Ontario MNR (OGL-Ontario), Québec MELCCFP (CC-BY 4.0), Manitoba, New Brunswick DNRED";
  let depthIdx = null, depthGL = null, depthMaking = false, depthSeq = 0, depthFeats = [], depthVer = 0;   // depthFeats: for the 3D map
  const depthSq = new Map();   // square -> features (the last 48 kept)
  const loadDepthIdx = () => (depthIdx ? Promise.resolve(depthIdx) : load("depth/i").then((j) => {
    const pre = j.pre || {};
    for (const x of j.lakes) x[5] = x[5].map((u) => (/^https?:/.test(u) ? u : (pre[x[6]] || "") + u));
    return (depthIdx = { t: new Set(j.t), lakes: j.lakes });
  }));
  const DEPTH_COL = ["interpolate", ["linear"], ["get", "d"], 0, "#5fc4f0", 5, "#2b8fd6", 15, "#1d5fb8", 40, "#173a8a"];
  const depthStyle = () => ({
    version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      q: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      mb: { type: "vector", tiles: [`${MB_DEPTH}/tile/{z}/{y}/{x}.pbf`], minzoom: 0, maxzoom: 16, bounds: [MB_BOX[1], MB_BOX[0], MB_BOX[3], MB_BOX[2]],
        attribution: "Lake depth: Government of Manitoba" },
    },
    layers: [
      { id: "mb-line", type: "line", source: "mb", "source-layer": "Contours", paint: { "line-color": C.depth, "line-width": 1.1, "line-opacity": 0.85 } },
      { id: "mb-label", type: "symbol", source: "mb", "source-layer": "Contours/label", filter: ["==", "$type", "Point"],
        layout: { "text-field": ["concat", ["to-string", ["abs", ["to-number", ["get", "_name"], 0]]], " m"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-optional": true }, paint: { "text-color": C.depth, "text-halo-color": "#fff", "text-halo-width": 1.6 } },
      { id: "q-line", type: "line", source: "q", filter: ["==", ["geometry-type"], "LineString"], layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": DEPTH_COL, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.9, 16, 1.6], "line-opacity": 0.9 } },
      { id: "q-label", type: "symbol", source: "q", filter: ["all", ["==", ["geometry-type"], "LineString"], [">", ["get", "d"], 0]], minzoom: 13,
        layout: { "symbol-placement": "line", "symbol-spacing": 280, "text-field": ["concat", ["to-string", ["get", "d"]], " m"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-max-angle": 30 },
        paint: { "text-color": "#173a8a", "text-halo-color": "#fff", "text-halo-width": 1.6 } },
      { id: "q-pt", type: "circle", source: "q", filter: ["==", ["geometry-type"], "Point"], minzoom: 13, paint: { "circle-radius": 1.6, "circle-color": DEPTH_COL } },
      { id: "q-ptlabel", type: "symbol", source: "q", filter: ["==", ["geometry-type"], "Point"], minzoom: 14,
        layout: { "text-field": ["to-string", ["get", "d"]], "text-font": ["Noto Sans Bold"], "text-size": 10, "text-offset": [0, -0.8], "text-padding": 1 },
        paint: { "text-color": "#173a8a", "text-halo-color": "#fff", "text-halo-width": 1.4 } },
    ],
  });
  function depthSquares() {
    const b = map.getBounds(), out = [];
    for (let r = Math.floor(b.getSouth() * 4); r <= Math.floor(b.getNorth() * 4); r++) for (let c = Math.floor(b.getWest() * 4); c <= Math.floor(b.getEast() * 4); c++) out.push(`${r}_${c}`);
    return out.length > 40 ? [] : out;
  }
  function decodeSquare(j) {
    const f = [];
    for (const [d, g] of j.l || []) {   // Google's encoded polyline, lon then lat (scripts/build-lake-depth.py)
      const co = [];
      let x = 0, y = 0, i = 0;
      const num = () => { let r = 0, sh = 0, b; do { b = g.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); return r & 1 ? ~(r >> 1) : r >> 1; };
      while (i < g.length) { x += num(); y += num(); co.push([x / 1e5, y / 1e5]); }
      f.push({ type: "Feature", properties: { d }, geometry: { type: "LineString", coordinates: co } });
    }
    for (const [d, x, y] of j.p || []) f.push({ type: "Feature", properties: { d }, geometry: { type: "Point", coordinates: [x / 1e5, y / 1e5] } });
    return f;
  }
  const getSquare = (k) => {
    if (depthSq.has(k)) { const v = depthSq.get(k); depthSq.delete(k); depthSq.set(k, v); return v; }
    const p = fetch(`data/fishing/depth/${k}.json`).then((r) => (r.ok ? r.json() : {})).then(decodeSquare).catch(() => { depthSq.delete(k); return []; });
    depthSq.set(k, p);
    while (depthSq.size > 48) depthSq.delete(depthSq.keys().next().value);
    return p;
  };
  async function syncDepth() {
    const seq = ++depthSeq;
    const on = isFish() && shown.has("depth") && map.getZoom() >= DEPTH_ZOOM;
    const idx = on ? await loadDepthIdx().catch(() => null) : null;
    if (seq !== depthSeq) return;
    const sq = idx ? depthSquares().filter((k) => idx.t.has(k)) : [];
    const b = map.getBounds(), mb = b.getNorth() > MB_BOX[0] && b.getSouth() < MB_BOX[2] && b.getEast() > MB_BOX[1] && b.getWest() < MB_BOX[3];
    if (!on || (!sq.length && !mb)) { if (depthGL) { map.removeLayer(depthGL); depthGL = null; map.attributionControl?.removeAttribution(DEPTH_ATTR); } return; }
    if (!depthGL) {
      if (depthMaking) return;
      depthMaking = true;
      try { await window.tfLoadVectorLib(); } catch { return; } finally { depthMaking = false; }
      if (seq !== depthSeq || depthGL) return syncDepth();
      depthGL = L.maplibreGL({ pane: "fishTiles", interactive: false, attributionControl: false, style: depthStyle() }).addTo(map);
      map.attributionControl?.addAttribution(DEPTH_ATTR);
    }
    const feats = (await Promise.all(sq.map(getSquare))).flat();
    if (seq !== depthSeq || !depthGL) return;
    if (feats.length !== depthFeats.length || feats[0] !== depthFeats[0]) { depthFeats = feats; depthVer++; sync3d(); }
    const gl = depthGL.getMaplibreMap && depthGL.getMaplibreMap();
    const put = () => { const s = gl && gl.getSource("q"); if (s) s.setData({ type: "FeatureCollection", features: feats }); };
    if (gl && gl.isStyleLoaded()) put(); else if (gl) gl.once("load", put);
  }
  map.on("moveend", () => { if (isFish() && shown.has("depth")) syncTiles(); });

  // ---------- layer list ----------
  const badge = (k, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${GLYPH[k]}"/></svg>`;
  const icon = (k, [c]) => `<span class="fs-ic" style="background:${c}">${badge(k)}</span>`;
  function renderLayers() {
    const z = map.getZoom();
    const tile = ([k, l]) => `<label class="fs-tile" title="${esc(l.sub)}"><span class="fs-thumb" style="background-image:url(icons/fish/${k}.jpg)" aria-hidden="true"></span><span class="fs-tcap">${esc(l.label)}</span><input type="checkbox" class="fs-sw" role="switch" data-k="${k}"${shown.has(k) ? " checked" : ""} aria-label="${esc(l.label)}"></label>`;
    const tiles = (g) => {
      const ls = Object.entries(LAYERS).filter(([, l]) => l.g === g);
      // what an on tile needs to show: zoom in (creeks, depth lines, Crown land)
      const far = ls.filter(([k, l]) => shown.has(k) && l.minZoom && z < l.minZoom).map(([, l]) => `${l.label}: zoom in closer to see ${l === LAYERS.creeks ? "them" : "it"}.`);
      return `<h4 class="fs-group">${g}</h4><div class="fs-tilegrid">${ls.map(tile).join("")}</div>${far.length ? `<p class="fs-tilenote">${esc(far.join(" "))}</p>` : ""}`;
    };
    $("fsLayerList").innerHTML = GROUPS.map((g) => (g === "Highlight on the map" ? tiles(g) : `<h4 class="fs-group">${g}</h4>` + Object.entries(LAYERS).filter(([, l]) => l.g === g).map(([k, l]) => {
      const on = shown.has(k), far = on && l.minZoom && z < l.minZoom;
      // Gauges are only on bigger rivers, so say how many are in view (alex 2026-10-26: "is that supposed to do anything?").
      let sub = l.sub;
      if (k === "gauges" && on && !far && gauges) { const b = map.getBounds(), n = gauges.filter((g) => b.contains([g[2], g[3]])).length; sub = n ? `${n} in view. Green: good flow, light green: low, orange: very low or high, red: blown out, grey: no reading. Tap one for more` : "None in view: government gauges are only on bigger rivers"; }
      if (k === "areas" && on && !far && zones) { const b = map.getBounds(), n = zones.filter((q) => isArea(q) && b.intersects([[q.b[0], q.b[1]], [q.b[2], q.b[3]]])).length; sub = n ? `${n} in view: tap inside one for its rules and fees` : "None in view: this shows national parks, Quebec zecs, wildlife reserves and parks, and ecological reserves (no fishing, in red)"; }
      return `<label class="fs-layer">${icon(k, l.icon)}<span><b>${esc(l.label)}</b><small${far ? ' class="z"' : ""}>${far ? "Zoom in closer to see it" : esc(sub)}</small></span><input type="checkbox" class="fs-sw" role="switch" data-k="${k}"${on ? " checked" : ""} aria-label="${esc(l.label)}"></label>`;
    }).join(""))).join("");
    pane.querySelectorAll("[data-view]").forEach((b) => { const v = VIEWS[b.dataset.view].layers; b.classList.toggle("on", v.length === shown.size && v.every((k) => shown.has(k))); });
  }
  $("fsLayerList").addEventListener("change", (e) => {
    const b = e.target.closest("[data-k]"); if (!b) return;
    if (b.checked) shown.add(b.dataset.k); else shown.delete(b.dataset.k);
    applyLayers();
  });
  $("fsAll").addEventListener("click", (e) => {
    e.stopPropagation();
    const b = $("layersBtn"); if (!b) return;
    if ($("layersMenu").hidden) b.click();
    lmFish.scrollIntoView({ block: "nearest" });
  });
  pane.querySelector(".fs-views").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]"); if (!b) return;
    // A second tap on the view that's on takes its water colours off again.
    const again = b.classList.contains("on");
    shown = new Set(VIEWS[b.dataset.view].layers.filter((k) => !(again && HL.includes(k))));
    applyLayers();
  });

  // ---------- water highlight ----------
  // All rivers, All lakes, Creeks and streams, Ocean and bays (the picture tiles in Layers; the Rivers, Lakes and Ocean
  // views turn theirs on): every river, lake or the sea coloured on the map, from the same OpenFreeMap vector tiles
  // as the Vector base map (OpenStreetMap water, all of Canada). One MapLibre map for all four, made only while one
  // is on (phones: one GL map less); the 3D map gets the same layers (sync3d).
  const OFM = { type: "vector", url: "https://tiles.openfreemap.org/planet" };
  const WATER = [
    { k: "rivers", id: "riv-area", type: "fill", source: "w", "source-layer": "water", filter: ["==", ["get", "class"], "river"], paint: { "fill-color": "#15d1ff", "fill-opacity": 0.75 } },
    { k: "rivers", id: "riv-line", type: "line", source: "w", "source-layer": "waterway", filter: ["in", ["get", "class"], ["literal", ["river", "canal"]]], layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#15d1ff", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.6, 10, 3, 14, 5] } },
    // OpenFreeMap has the small creeks from zoom 13; dashed when they dry up (intermittent)
    { k: "creeks", id: "creek", type: "line", source: "w", "source-layer": "waterway", filter: ["==", ["get", "class"], "stream"], layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#8cf0ff", "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1.6, 16, 3], "line-dasharray": ["case", ["==", ["get", "intermittent"], 1], ["literal", [2, 1.5]], ["literal", [1, 0]]] } },
    { k: "lakes", id: "lake", type: "fill", source: "w", "source-layer": "water", filter: ["in", ["get", "class"], ["literal", ["lake", "pond"]]], paint: { "fill-color": "#12d6b4", "fill-opacity": 0.75 } },
    { k: "lakes", id: "lake-edge", type: "line", source: "w", "source-layer": "water", filter: ["in", ["get", "class"], ["literal", ["lake", "pond"]]], paint: { "line-color": "#d9fff7", "line-width": 0.8 } },
    { k: "ocean", id: "sea", type: "fill", source: "w", "source-layer": "water", filter: ["==", ["get", "class"], "ocean"], paint: { "fill-color": "#2f7bff", "fill-opacity": 0.6 } },
  ];
  const glLayer = ({ k, ...l }, on, pre = "", src) => ({ ...l, id: pre + l.id, ...(src ? { source: src } : {}), layout: { ...(l.layout || {}), visibility: on ? "visible" : "none" } });
  let hl = null, hlMaking = false;
  // under the depth lines and Crown land (fishTiles)
  if (!map.getPane("fishWater")) { map.createPane("fishWater").style.zIndex = 345; map.getPane("fishWater").style.pointerEvents = "none"; }
  async function syncWater() {
    const on = isFish() && HL.some((k) => shown.has(k));
    if (!on) { if (hl) { map.removeLayer(hl); hl = null; } return; }
    if (!hl) {
      if (hlMaking) return;
      hlMaking = true;
      try { await window.tfLoadVectorLib(); } catch { return; } finally { hlMaking = false; }
      if (hl) return;
      if (!isFish() || !HL.some((k) => shown.has(k))) return;
      hl = L.maplibreGL({ pane: "fishWater", interactive: false, attributionControl: false,
        style: { version: 8, sources: { w: OFM }, layers: WATER.map((l) => glLayer(l, shown.has(l.k))) } }).addTo(map);
      return;
    }
    const gl = hl.getMaplibreMap && hl.getMaplibreMap();
    if (gl && gl.getStyle()) for (const l of WATER) if (gl.getLayer(l.id)) gl.setLayoutProperty(l.id, "visibility", shown.has(l.k) ? "visible" : "none");
  }
  function applyLayers() {
    store.set("fishLayers", [...shown]);
    renderLayers(); renderKey(); syncTiles(); syncWater(); drawZones(); drawPoints(); loadReadings(); loadAccess();
  }
  // Map key: what the dot colours mean.
  const keyCtl = L.control({ position: "bottomleft" });
  keyCtl.onAdd = () => {
    const d = L.DomUtil.create("div", "fs-mapkey");
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
    d.innerHTML = `<button type="button" class="fs-keybtn" aria-expanded="false">${svg(IC.layers, 16)}Key</button><div class="fs-keybox" hidden></div>`;
    d.querySelector("button").addEventListener("click", (e) => { const box = d.querySelector(".fs-keybox"); box.hidden = !box.hidden; e.currentTarget.setAttribute("aria-expanded", String(!box.hidden)); renderKey(); });
    return d;
  };
  function renderKey() {
    const box = document.querySelector(".fs-mapkey .fs-keybox");
    if (!box || box.hidden) return;
    const i = (c, g) => `<i style="background:${c}">${g ? badge(g, 9) : ""}</i>`;
    box.innerHTML = (shown.has("gauges") ? `<b>River gauges: flow for the month</b>${["vlow", "low", "ok", "high", "blown", "none"].map((k) => `<div>${i(LIGHTS[k][1])}${LIGHTS[k][0]}</div>`).join("")}` : "")
      + (HL.some((k) => shown.has(k)) ? `<b>Water</b>${shown.has("rivers") ? `<div>${i("#15d1ff")}River</div>` : ""}${shown.has("creeks") ? `<div>${i("#8cf0ff")}Creek or stream</div>` : ""}${shown.has("lakes") ? `<div>${i("#12d6b4")}Lake or pond</div>` : ""}${shown.has("ocean") ? `<div>${i("#2f7bff")}Ocean: tidal licence</div>` : ""}` : "")
      + (shown.has("stocked") ? `<b>Stocked waters</b><div>${i(C.fresh)}Stocked in the last 30 days</div><div>${i(C.stocked)}Stocked in the last 3 years</div>` : "")
      + (shown.has("hidden") ? `<b>Hidden spots</b><div>${i(C.hidden, "hidden")}Walk-in or hike-in water</div>` : "")
      + (shown.has("access") || shown.has("launch") ? `<b>Access</b>${shown.has("access") ? `<div>${i(C.access, "access")}Fishing spot, pier or dock</div>` : ""}${shown.has("launch") ? `<div>${i(C.launch, "launch")}Boat launch</div>` : ""}` : "")
      + (shown.has("crown") && window.tfCrown ? `<b>Crown land</b><div>${i(window.tfCrown.COL.crown)}Crown land: public</div><div>${i(window.tfCrown.COL.private)}Private land</div>` : "")
      + (shown.has("tides") ? `<b>Ocean</b><div>${i(C.tide, "tides")}Tide station</div>` : "")
      + (shown.has("zones") ? `<b>Rules</b><div><i style="border:2px dashed ${C.zone};border-radius:2px"></i>Fishing zone or region</div><div><i style="border:2px dashed ${C.tide};border-radius:2px"></i>Pacific tidal area</div>` : "")
      + (shown.has("areas") ? `<b>Parks and reserves</b><div>${i(C.nofish)}Ecological reserve: no fishing</div><div>${i(C.park, "areas")}National park: Parks Canada permit</div><div>${i(C.zec)}Quebec zec: daily fee</div><div>${i(C.fee)}Wildlife reserve or Quebec park: access fee</div>` : "")
      || "<p>No layers on: turn some on in Layers.</p>";
  }

  // ---------- the spot ----------
  let spot = null;   // { lat, lon, how }
  const spotMarker = L.marker([0, 0], { pane: "fish", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: '<div class="fs-spot"></div>', iconSize: [0, 0] }) });
  function setSpot(lat, lon, how) {
    spot = { lat, lon, how };
    if (how === "centre") spotLayer.removeLayer(spotMarker); else { spotMarker.setLatLng([lat, lon]); spotLayer.addLayer(spotMarker); }
    loadWeather(); renderToday(); renderHatch(); sync3d();
  }
  window.addEventListener("tf:you", (e) => {
    const { lat, lon, follow } = e.detail;
    if (!follow || !isFish()) return;
    if (spot && spot.how === "you" && map.distance([spot.lat, spot.lon], [lat, lon]) < 200) return;
    setSpot(lat, lon, "you");
  });
  function locate(btn) {
    if (!navigator.geolocation) { hint("This browser can't share your location."); return; }
    if (btn) btn.disabled = true;
    navigator.geolocation.getCurrentPosition((p) => {
      if (btn) btn.disabled = false;
      setSpot(p.coords.latitude, p.coords.longitude, "you");
      map.setView([p.coords.latitude, p.coords.longitude], Math.max(map.getZoom(), 13));
      showSpot(p.coords.latitude, p.coords.longitude);
    }, (e) => { if (btn) btn.disabled = false; hint(e.code === 1 ? "Location is blocked for this site: allow it in the browser's settings." : "Couldn't find your location."); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  // Phones: the card in view (the sheet up to half), on the flat or 3D map.
  function cardInView(el) {
    if (phone() && window.tfSnapTo) { const p = document.querySelector(".panel"); if (p && !p.classList.contains("sheet-half")) window.tfSnapTo("half"); }
    setTimeout(() => { if (window.tfPanelScrollTo) window.tfPanelScrollTo(el); }, 60);
  }

  // Each part of a spot card is one folded line: an icon, what it is and the short answer ("Rules · BC Region 2",
  // "River · Very low"); a tap opens the details (alex: "make the fishing mode user friendly", like Hunting's #298).
  const unhead = (h) => String(h || "").replace(/^\s*<h4>[\s\S]*?<\/h4>/, "");
  const textOf = (h) => String(h || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  function fold(key, icon, title, sum, body, open = false) {
    if (!body) return "";
    return `<details class="fs-sec" data-sec="${key}"${open ? " open" : ""}><summary>${svg(icon, 16)}<b>${esc(title)}</b><span>${sum || ""}</span></summary><div class="fs-secb">${body}</div></details>`;
  }
  const secRules = (h) => { const b = (String(h).match(/<b>([\s\S]*?)<\/b>/) || [])[1]; return fold("rules", IC.rules, "Rules", esc(textOf(b)).replace(/^(Quebec fishing |Ontario Fisheries Management |Alberta Fish Management )/, ""), unhead(h)); };
  // Game fish lead the one-line summary, so a lake reads "Walleye, Yellow Perch +60" not "American Eel…".
  const GAME = ["walleye", "brook trout", "rainbow trout", "lake trout", "brown trout", "smallmouth bass", "largemouth bass", "northern pike", "muskellunge", "yellow perch", "atlantic salmon", "chinook salmon", "coho salmon", "steelhead", "bull trout", "cutthroat trout", "lake whitefish", "black crappie"];
  const gameRank = (n) => { const i = GAME.findIndex((g) => n.toLowerCase().includes(g)); return i < 0 ? 99 : i; };
  const secFish = (h) => { const n = [...String(h).matchAll(/class="fs-chip"[^>]*>([^<]*)</g)].map((m) => m[1]).sort((a, b) => gameRank(a) - gameRank(b)); return fold("fish", IC.fish, "Fish here", n.length ? `${n.slice(0, 2).join(", ")}${n.length > 2 ? ` +${n.length - 2}` : ""}` : "", h); };
  const secFlow = (h) => { const m = String(h).match(/fs-light" style="--c:([^"]+)"><\/span><b>([^<]+)<\/b>/); return fold("flow", IC.gauge, "Nearest river", m ? `<i class="fs-light" style="--c:${m[1]}"></i>${m[2]}` : "", h); };
  const secTide = (h) => { const m = String(h).match(/Next: <b>([^<]+)<\/b>/); return fold("tide", IC.wave, "Tides", m ? m[1].replace(/^./, (c) => c.toUpperCase()) : "", h); };
  const secAcc = (h) => { const n = (String(h).match(/<li/g) || []).length; return h && n ? fold("acc", IC.boat, "Fishing spots", `${n} nearby`, unhead(h)) : h; };

  // Route: the walk to the spot (fish-route.js), from the button on each card's header. A new card clears the last route.
  const routeBtn = (lat, lon) => { if (window.tfFishRoute) window.tfFishRoute.clear(); return window.tfFishRoute ? window.tfFishRoute.button(lat, lon) : ""; };

  // What's at a spot: everything the app knows within reach, each part filled in as it comes.
  let spotSeq = 0;
  async function showSpot(lat, lon, title) {
    const el = $("fsSpot"), seq = ++spotSeq;
    el.hidden = false;
    el.innerHTML = `<header>${svg(IC.pin)}<h3 id="fsSpotName">${esc(title || "This spot")}</h3>${routeBtn(lat, lon)}<button type="button" class="fs-x" aria-label="Close">${svg(IC.x, 16)}</button></header><div id="fsRoute"></div>
      <div id="fsHidden"></div><div id="fsWater"><p class="fs-note fs-look">Looking up this spot…</p></div><div id="fsDepth"></div><div id="fsBait"></div>
      <div id="fsSea"></div><div id="fsSeason"></div><div id="fsRules"></div><div id="fsLic"></div><div id="fsBoat"></div><div id="fsStock"></div><div id="fsEat"></div><div id="fsFlow"></div><div id="fsTide"></div><div id="fsLand"></div><div id="fsAcc"></div>`;
    el.querySelector(".fs-x").addEventListener("click", () => { el.hidden = true; spotSeq++; });
    cardInView(el);
    await ready;
    const zs = await loadZones();
    if (seq !== spotSeq) return;
    const here = zonesAt(zs, lat, lon), prov = provinceAt(lat, lon, here);
    const fill = (id, html) => { if (seq === spotSeq && $(id)) $(id).innerHTML = html; };
    fill("fsRules", secRules(rulesHtml(lat, lon, here, prov)));
    fill("fsLic", licHtml(lat, lon, here, prov));
    seaHtml(lat, lon, zs, here, prov).then((h) => fill("fsSea", h));
    // Boating: Transport Canada's list, plus limits a hidden spot's notes or the lake's rules give.
    const boat = { name: title, extra: [], n: 0 };
    const renderBoat = () => { const n = ++boat.n; boatHtml(lat, lon, boat.name, prov, boat.extra).then((h) => { if (n === boat.n) fill("fsBoat", h); }); };
    await hiddenReady;
    const hs = hidden.filter((h) => !h.walk && km(lat, lon, h.lat, h.lon) < 1.5);
    for (const h of hs) boat.extra.push({ t: [h.how, h.tip].filter(Boolean).join(". "), src: `Hidden spot notes (${h.src[0][0]})`, url: h.src[0][1] });
    if (seq !== spotSeq) return;
    renderBoat();
    fill("fsStock", stockHtml(lat, lon));
    flowHtml(lat, lon).then((h) => fill("fsFlow", secFlow(h)));
    tideHtml(lat, lon).then((h) => fill("fsTide", secTide(h)));
    fill("fsAcc", secAcc(accessHtml(lat, lon)));
    landHtml(lat, lon, prov).then((h) => fill("fsLand", h));
    // What to use: the fish the province lists here, plus what's stocked close by and what the eating guide lists.
    const baitSp = new Set();
    if (stocked) for (const [sw] of near(stocked.waters, lat, lon, 3, (x) => x.c).slice(0, 2)) for (const r of sw.r) if (stocked.sp[r[1]]) baitSp.add(stocked.sp[r[1]]);
    let baitWater = "";
    const bait = () => { if (seq === spotSeq && window.tfFishBait) window.tfFishBait.render($("fsBait"), { lat, lon, month: new Date().getMonth() + 1, region: hatchRegion(lat, lon), water: baitWater, species: [...baitSp], hatch: hatchNow(lat, lon) }, fold, IC.bug); };
    waterAt(lat, lon, prov).then((w) => {
      if (seq !== spotSeq) return;
      if (w && w.sp) w.sp.forEach((x) => baitSp.add(x));
      baitWater = w && w.kind ? (/lake/i.test(w.kind) ? "lake" : "river") : (!w || w.listOnly) && nearestTide(lat, lon, 4) ? "ocean" : "";
      bait();
      if (w && w.name && !title) $("fsSpotName").textContent = w.name;
      if (w && w.name) boat.name = w.name;
      fill("fsWater", w && w.html ? secFish(w.html) : "");
      depthHtml(lat, lon, w).then((h) => fill("fsDepth", h)).catch(() => {});
      if (!w) $("fsSpot").classList.add("fs-nowater");
      if (w && w.rules) fill("fsRules", fold("rules", IC.rules, "Rules", "This water has its own rules", unhead(w.rules) + unhead(rulesHtml(lat, lon, here, prov)), true));
      if (w && w.rules) boat.extra.push({ t: w.rules.replace(/<[^>]+>/g, ". ").replace(/&amp;/g, "&"), src: "the water's fishing rules" });
      rulesShort(here, prov, w, lat, lon).then((h) => { const b = seq === spotSeq && document.querySelector("#fsRules .fs-secb"); if (!b || !h) return; b.querySelector(".fs-short")?.remove(); b.insertAdjacentHTML("afterbegin", h); }).catch(() => {});
      const bx = [];
      seasonHtml(here, prov, w, bx).then((h) => { fill("fsSeason", h); boat.extra.push(...bx); renderBoat(); });
      if (prov === "on" || prov === "qc") eatHtml(lat, lon, prov, (w && w.name) || title).then((h) => {
        fill("fsEat", h.html);
        if (h.sp && h.sp.length) { h.sp.forEach((x) => baitSp.add(x)); bait(); }
        if (seq === spotSeq && h.name && !title && !(w && w.name)) $("fsSpotName").textContent = h.name;   // Quebec's map often has no name for the water
      });
    });
  }

  // ---------- depth chart (alex 2026-10-27 "add lake depths across Canada") ----------
  // The lake's own depth map where the province publishes one: Quebec's PDF maps (with the deepest point surveyed),
  // Ontario's scanned historic charts, Saskatchewan's scanned maps, Alberta's surveyed lakes and Nova Scotia's lake
  // inventory maps (data/fishing/depth/i.json), and a button that
  // turns on the depth lines for this lake.
  const PROV_DEPTH = { qc: "Quebec's lake bathymetry geobase (Ministère de l'Environnement)", on: "Ontario's historic bathymetry maps (MNR)", sk: "Saskatchewan's bathymetric maps (Fisheries Branch)", ab: "the Alberta Geological Survey's lake bathymetry", ns: "Nova Scotia's lake inventory maps (Department of Fisheries)" };
  async function depthHtml(lat, lon, w) {
    const idx = await loadDepthIdx().catch(() => null);
    const lake = idx && idx.lakes.map((x) => [x, km(lat, lon, x[0], x[1])]).filter(([x, d]) => d < x[2] + 0.2).sort((a, b) => a[1] - b[1])[0];
    const lines = shown.has("depth") ? "" : `<p><button type="button" class="fs-depthon" data-ll="${lat},${lon}">${svg(IC.layers, 14)}Show depth lines on the map</button></p>`;
    if (!lake) return lines && w && /lake/i.test(w.kind || "lake") && !w.listOnly ? fold("depth", IC.depth, "Depth", "Depth lines", `${lines}<p class="fs-note">Lines show where a province surveyed the lake (BC, Alberta, Ontario, Quebec, Manitoba; New Brunswick soundings).</p>`) : "";
    const [[, , , name, deep, links, prov]] = lake;
    const a = links.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">${/\.pdf$/i.test(u) ? "Depth map (PDF)" : `Depth chart${links.length > 1 ? ` ${i + 1}` : ""} (scan)`}</a>`).join(" · ");
    const sum = [deep != null ? `up to ${deep} m` : "", links.length ? "depth map" : ""].filter(Boolean).join(" · ");
    return fold("depth", IC.depth, "Depth", esc(sum), `<p><b>${esc(name || "This lake")}</b>${deep != null ? `: deepest point surveyed ${esc(deep)} m` : ""}</p>${a ? `<p>${a}</p>` : ""}${lines}<p class="fs-note">From ${esc(PROV_DEPTH[prov] || "the province")}. Old surveys: water levels and shorelines may have changed. Not for navigation.</p>`);
  }
  $("fsSpot").addEventListener("click", (e) => {
    const b = e.target.closest(".fs-depthon"); if (!b) return;
    shown.add("depth"); applyLayers(); b.remove();
    if (map.getZoom() < 14) map.setView(b.dataset.ll.split(",").map(Number), 14);
  });

  // ---------- in the sea here (alex: "ocean spots: the fish you can catch and the openings and closures by area") ----------
  // BC: data/fishing/tidal.json, read every night from Fisheries and Oceans Canada's page for each Pacific Fishery
  // Management Area: each species' status (open, release only, closed), daily limit, size and gear for each subarea,
  // the area's closures and special rules, and the shellfish safety closures. Atlantic and the Arctic: the seasons and
  // limits DFO publishes for each coast (SEA below, read by hand from DFO's pages; dated ones say their year).
  let tidal = null;
  const loadTidal = () => (tidal ? Promise.resolve(tidal) : load("tidal").then((j) => (tidal = j)));
  const ST = { open: [C.ok, "Open"], "non retention": [C.vlow, "Release only"], closed: [C.blown, "Closed"] };
  let bivShut = false;   // every subarea of the area closed to clams, oysters and mussels for toxins
  const stOf = (r) => { const t = String(r[6] || "").toLowerCase(); return ST[t] || (r[0].startsWith("Bivalve") ? (/^0\b/.test(r[5]) ? ST.closed : bivShut ? [C.blown, "Closed: toxins"] : ST.open) : [C.none, r[6] || ""]); };
  // The species people come for, by group; the rest fold into "Other species".
  const SEA_GROUPS = [
    ["Salmon", /salmon/i],
    ["Bottom fish", /^(halibut|lingcod|rockfish|greenling|codfish|sole|sablefish|surfperch|spiny dogfish|tuna - albacore|white sturgeon|trout)/i],
    ["Crab", /^crab - (dungeness|red rock|king|box)$|^crab - dungeness and red rock/i],
    ["Prawns, shrimp and squid", /^(shrimp including prawn|squid - opal|octopus|sea cucumber|sea urchin)/i],
    ["Clams, oysters and mussels", /^(clam - (butter|littleneck|manila|razor)|oyster - all|mussels - all|cockles|geoduck)/i],
  ];
  const PRI = [/chinook/i, /coho/i, /pink/i, /chum/i, /sockeye/i, /halibut/i, /lingcod/i, /rockfish/i, /dungeness$/i, /red rock$/i, /prawn/i, /squid/i, /manila/i, /littleneck/i, /butter/i, /oyster/i];
  const pri = (n) => { const i = PRI.findIndex((re) => re.test(n)); return i < 0 ? 99 : i; };
  const NAMES = [[/^Shrimp including prawn$/i, "Prawns and shrimp"], [/^Oyster - all species except Olympia$/i, "Oysters (not Olympia)"], [/^Mussels - all species combined$/i, "Mussels, all kinds together"],
    [/^Clams? - all species combined( except Cockles)?$/i, (m, x) => `Clams, all kinds together${x ? " (not cockles)" : ""}`], [/^(\w+) - all other species$/i, (m, x) => `Other ${x.toLowerCase()}`], [/^Rockfish - all species except Yelloweye$/i, "Rockfish (not yelloweye)"]];
  const spName = (n) => NAMES.reduce((t, [re, to]) => t.replace(re, to), String(n)).replace(/\s*\(hatchery and wild combined\)/i, "").replace(/^(Crab|Clam|Oyster|Mussels?|Rockfish|Shrimp|Squid|Tuna|Scallop|Shark) - (.+)$/i, (m, a, b) => `${b} ${a.toLowerCase()}`)
    .replace(/^(.+) combined (\w+)$/i, "$1 $2 together").replace(/^(.)/, (c) => c.toUpperCase());
  const limText = (r) => {
    const l = String(r[5] || "").replace(/\s*Combined Total/i, "").trim(), m = l.match(/^(\d+)\D.*?(\d+) - Hatchery.*?(\d+) - Wild/i);
    if (m) return +m[3] === 0 ? `${m[1]} a day, hatchery only (clipped fin)` : `${m[1]} a day, up to ${m[3]} wild`;
    return /^0(kg)?$/.test(l) ? "none to keep" : l ? `${l} a day` : "";
  };
  // A PFMA for a spot on the water, or for one on the shore: the nearest area within about 2 km.
  function pfmaNear(zs, lat, lon, here) {
    const z = here.find((x) => x.k === "pfma");
    if (z) return z;
    for (const d of [0.006, 0.012, 0.02]) for (const [a, b] of [[1, 0], [-1, 0], [0, 1.5], [0, -1.5], [0.7, 1], [0.7, -1], [-0.7, 1], [-0.7, -1]]) {
      const f = zonesAt(zs, lat + a * d, lon + b * d).find((x) => x.k === "pfma");
      if (f) return f;
    }
    return null;
  }
  function seaRow(rows, id) {
    const r0 = rows[0], st = stOf(r0), whole = rows.length === 1 && (r0[2] === String(id) || !/\d+-\d/.test(r0[2]));
    const facts = (r) => [limText(r), r[3] && `min ${r[3]}`].filter(Boolean).join(" · ");
    const parts = whole ? `<small>${esc(facts(r0))}${r0[4] ? `<br>${esc(r0[4])}` : ""}</small>`
      : `<small>${rows.map((r) => `<span class="fs-sea-p"><i style="background:${stOf(r)[0]}"></i>${esc(r[2])}: ${esc(stOf(r)[1].toLowerCase())}${facts(r) ? `, ${esc(facts(r))}` : ""}</span>`).join("")}</small>`;
    const mixed = !whole && rows.some((r) => stOf(r)[1] !== st[1]);
    const c = mixed ? C.vlow : st[0];
    return `<li style="--c:${c}"><b>${esc(spName(r0[1]))} <em class="fs-st" style="--c:${c}">${mixed ? "In parts" : esc(st[1])}</em></b>${parts}</li>`;
  }
  async function seaHtml(lat, lon, zs, here, prov) {
    const z = pfmaNear(zs, lat, lon, here);
    if (z) {
      const j = await loadTidal().catch(() => null), a = j && j.areas[z.id];
      const page = `https://www.pac.dfo-mpo.gc.ca/fm-gp/rec/tidal-maree/a-s${esc(z.id)}-eng.html`;
      if (!a) return fold("sea", IC.wave, "In the sea here", `Area ${esc(z.id)}`, `<p class="fs-note"><a href="${page}" target="_blank" rel="noopener">Area ${esc(z.id)} limits, openings and closures</a> (Fisheries and Oceans Canada)</p>`);
      bivShut = !!(a.b && a.b.length) && a.b.every((x) => /closed to all/i.test(x[1]));
      const bySp = new Map();
      for (const r of a.s) { const k = `${r[0]}|${r[1]}`; if (!bySp.has(k)) bySp.set(k, []); bySp.get(k).push(r); }
      const used = new Set(), groups = [];
      for (const [g, re] of SEA_GROUPS) {
        const li = [...bySp].filter(([k, rows]) => !used.has(k) && re.test(rows[0][1]) && (g !== "Salmon" || rows[0][0] === "Salmon"))
          .sort((x, y) => pri(x[1][0][1]) - pri(y[1][0][1])).map(([k, rows]) => { used.add(k); return seaRow(rows, z.id); });
        if (li.length) groups.push(`<h4>${esc(g)}</h4><ul class="fs-list">${li.join("")}</ul>`);
      }
      const rest = [...bySp].filter(([k]) => !used.has(k));
      const key = (re) => { const rows = [...bySp.values()].find((x) => re.test(x[0][1])); return rows ? [rows, stOf(rows[0])] : null; };
      // The one-line answer: which of the big ones you can keep today ("Chinook, crab open").
      const open = [[/^chinook/i, "Chinook"], [/^coho/i, "coho"], [/^crab - dungeness$/i, "crab"], [/^shrimp including prawn/i, "prawns"], [/^halibut/i, "halibut"], [/^lingcod/i, "lingcod"]]
        .filter(([re]) => { const k = key(re); return k && k[0].some((r) => stOf(r)[1] === "Open"); }).map(([, n]) => n);
      const sum = open.length ? [`${open.slice(0, 2).join(", ")} open`] : ["Mostly closed"];
      const restr = a.r;
      const restrLi = restr.map((r) => `<li style="--c:${/closed/i.test(r[3]) ? C.blown : C.tide}"><b>${esc(r[2] === String(z.id) ? `All of area ${z.id}` : /^\d+-/.test(r[2]) ? `Subareas ${r[2].replace(/,(?=\S)/g, ", ")}` : r[2])}</b><small>${esc(r[1])} · ${esc(r[3].toLowerCase())}: ${esc(r[4])}</small></li>`).join("");
      const biv = (a.b || []).filter((x) => x[1] || x[2]);
      const bivLi = biv.map((x) => `<li style="--c:${/closed to all/i.test(x[1]) ? C.blown : C.vlow}"><b>${esc(x[0])}</b><small>${esc(x[1] || "")}${x[2] ? `${x[1] ? "<br>" : ""}Closed: ${esc(x[2])}` : ""}</small></li>`).join("");
      const old = a.u && (Date.now() - new Date(a.u + "T12:00:00")) / 864e5 > 10;
      const body = `<p class="fs-note">Area ${esc(z.id)}${a.t ? `: ${esc(a.t)}` : ""}. Fisheries and Oceans Canada${a.u ? `, updated ${esc(a.u)}` : ""}${old ? " (may be out of date)" : ""}. Where a row names subareas, see the <a href="${page}#map" target="_blank" rel="noopener">area map</a>.</p>
        ${groups.join("")}
        ${rest.length ? `<details class="fs-more"><summary>Other species (${rest.length})</summary><ul class="fs-list">${rest.map(([, rows]) => seaRow(rows, z.id)).join("")}</ul></details>` : ""}
        ${restrLi ? `<details class="fs-more"><summary>Closures and special rules (${restr.length})</summary><ul class="fs-list">${restrLi}</ul></details>` : ""}
        ${bivLi ? `<details class="fs-more"><summary>Shellfish safety closures (${biv.length} subareas)</summary><p class="fs-note">Toxins and pollution can make clams, oysters and mussels deadly. Check the <a href="https://www.dfo-mpo.gc.ca/shellfish-mollusques/cssp-map-eng.htm" target="_blank" rel="noopener">live shellfish map</a> before you dig.</p><ul class="fs-list">${bivLi}</ul></details>` : ""}
        <p class="fs-note"><a href="${page}" target="_blank" rel="noopener">Area ${esc(z.id)} page</a> · <a href="https://notices.dfo-mpo.gc.ca/fns-sap/index-eng.cfm" target="_blank" rel="noopener">Fishery notices</a> (openings can change any day). Salmon: 4 a day of all species together, tidal and fresh water.</p>`;
      return fold("sea", IC.wave, "In the sea here", esc(sum[0]), body);
    }
    const reg = seaRegion(lat, lon, prov);
    if (!reg || !nearestTide(lat, lon, 6)) return "";
    const R = SEA[reg], dated = R.yr && new Date().getFullYear() > R.yr;
    // Seasons with dates say whether they're open today (the season stays on the line under it).
    const d = new Date(), md = (d.getMonth() + 1) * 100 + d.getDate();
    const openNow = (w) => !w || w.some(([m1, d1, m2, d2]) => md >= m1 * 100 + d1 && md <= m2 * 100 + d2);
    const nowOpen = [];
    const li = R.fish.map(([n, st, t, w]) => {
      const shut = /closed/i.test(st) || (w && !dated && !openNow(w)), chip = w && !dated ? (shut ? "Closed now" : "Open now") : dated && /20\d\d/.test(st) ? "Check this year's dates" : st;
      const c = shut ? C.blown : /release/i.test(st) ? C.vlow : /check/i.test(chip) ? C.none : C.ok;
      if (w && !shut && !dated) nowOpen.push(n.split(/[ ,]/)[0]);
      return `<li style="--c:${c}"><b>${esc(n)} <em class="fs-st" style="--c:${c}">${esc(chip)}</em></b><small>${w && !dated ? `${esc(st)}. ` : ""}${esc(t)}</small></li>`; }).join("");
    const sum = R.fish.some((f) => f[3]) && !dated ? (nowOpen.length ? `${nowOpen.slice(0, 2).join(", ")} open` : "Groundfish closed now") : R.sum;
    return fold("sea", IC.wave, "In the sea here", esc(sum), `<p class="fs-note">${esc(R.n)}. From Fisheries and Oceans Canada${R.yr ? ` (${R.yr})` : ""}.</p><ul class="fs-list">${li}</ul>
      <p class="fs-note">${R.links.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(t)}</a>`).join(" · ")}. Openings and limits can change during the season.</p>`);
  }
  // The coasts DFO manages separately. Lines are rough: they only pick which coast's rules to show.
  function seaRegion(lat, lon, prov) {
    if (prov === "nl") return lat > 51.6 || lon > -56.4 && !(lat < 47.65 && lon < -53.55) ? "nlNE" : "nlSW";
    if (prov === "pe" || (prov === "nb" && lat > 46.0) || (prov === "ns" && ((lat > 45.55 && lon > -64.05 && lon < -61.3) || (lat > 45.9 && lon < -60.95 && lon > -61.7)))) return "gulf";
    if (prov === "ns" || prov === "nb") return lon < -63.45 ? "marW" : "marE";
    if (prov === "qc") return "qc";
    if (["nu", "nt", "yt", "mb", "on"].includes(prov) && lat > 51) return "arctic";
    return "";
  }
  const MAR = "https://www.dfo-mpo.gc.ca/fisheries-peches/recreational-recreative/maritimes/";
  const MAR_FISH = (gf) => [
    ...gf,
    ["Halibut, northern and spotted wolffish", "Closed", "Release them all year. Striped (Atlantic) wolffish counts in the groundfish limit."],
    ["Mackerel", "Apr 1 to Dec 31", "20 a day, any size, one line with up to 3 hooks. No licence.", [[4, 1, 12, 31]]],
    ["Striped bass", "All year in salt water", "1 a day, 68 to 150 cm, angling only. Spring exceptions on the Annapolis, Shubenacadie and Stewiacke rivers."],
    ["Smelt", "Angling Aug 1 to May 31", "60 a day by angling (Nova Scotia dip net 30). No licence in salt water.", [[8, 1, 12, 31], [1, 1, 5, 31]]],
    ["Eel", "All year (angling)", "10 a day, 35 cm or more."],
    ["Atlantic salmon", "Closed", "Except catch and release with single barbless flies on the Middle, Baddeck and North rivers in Cape Breton."],
    ["Sharks and bluefin tuna", "Release only", "Sharks need a DFO licence; bluefin only on licensed charters, from Jul 15."],
  ];
  const MAR_LINKS = [["Maritimes sport fishing", `${MAR}index-eng.html`], ["Orders registry (openings and closures)", "https://www.inter.dfo-mpo.gc.ca/Maritimes/Orders-Registry"]];
  const NL_GF = "https://www.dfo-mpo.gc.ca/fisheries-peches/decisions/fm-2026-gp/atl-21-eng.html";
  const NL_REST = [
    ["Halibut, spotted and northern wolffish, sharks", "Closed", "Release them. Sculpins and cunners may be released; other groundfish you catch must be kept and count in the 5."],
    ["Marine protected areas", "Closed", "No groundfish fishing in Eastport, Gilbert Bay and the Laurentian Channel."],
    ["Atlantic salmon and sea-run trout", "Check river", "Rivers have their own seasons and tag limits: see Newfoundland and Labrador angling."],
  ];
  const SEA = {
    marW: { n: "Nova Scotia's Atlantic coast from Halifax Harbour west, and the Bay of Fundy", sum: "Mackerel open, cod in summer", links: MAR_LINKS, fish: MAR_FISH([
      ["Haddock, pollock, flounder, hake, dogfish", "Feb 1 to Dec 31", "10 groundfish a day in total, handline or rod. No licence.", [[2, 1, 12, 31]]],
      ["Cod", "3rd Sat of June to Labour Day", "Up to 5 a day within the 10. Not kept the rest of the year.", [[6, 15, 9, 7]]]]) },
    marE: { n: "Nova Scotia's Atlantic coast from Hartlen Point east to Cape North, with the Bras d'Or Lakes", sum: "Mackerel open, groundfish in summer", links: MAR_LINKS, fish: MAR_FISH([
      ["Cod, haddock, pollock, flounder, hake", "3rd Sat of June to Labour Day", "5 groundfish a day in total, handline or rod. No licence.", [[6, 15, 9, 7]]]]) },
    gulf: { n: "The southern Gulf of St. Lawrence: PEI, New Brunswick's east coast and Nova Scotia's Northumberland Strait shore", sum: "Mackerel, striped bass", links: [["Southern Gulf sport fishing", "https://www.glf.dfo-mpo.gc.ca/en/recreational-fisheries"], ["DFO sport fishing", "https://www.dfo-mpo.gc.ca/fisheries-peches/recreational-recreative/index-eng.html"]], fish: [
      ["Mackerel", "Check season", "Rod or handline from wharves and boats in summer; the daily limit is set each year."],
      ["Striped bass", "Check season", "The southern Gulf stock has its own retention days, slot size and daily limit, set each year."],
      ["Smelt", "Check season", "Fall and winter through the ice in bays and estuaries."],
      ["Sea-run brook trout", "Check river", "Estuaries in spring; provincial licence above the tide."],
      ["Atlantic salmon", "Check river", "Rivers have their own seasons, often catch and release."],
      ["Clams, oysters and mussels", "Check closures", "Beaches close for pollution and toxins: check the shellfish map before you dig."]] },
    qc: { n: "Quebec's St. Lawrence estuary and Gulf, Gaspésie, the North Shore and the Magdalen Islands", sum: "Mackerel, cod, striped bass", links: [["DFO Quebec sport fishing", "https://www.dfo-mpo.gc.ca/fisheries-peches/recreational-recreative/index-eng.html"], ["Quebec fishing rules", "https://www.quebec.ca/en/tourism-and-recreation/sporting-and-outdoor-activities/sport-fishing/regulations"]], fish: [
      ["Mackerel", "Check season", "Summer from wharves and boats in Gaspésie and the Magdalen Islands."],
      ["Cod and other groundfish", "Check season", "A short recreational season is set each year."],
      ["Striped bass", "Check season", "The St. Lawrence population is managed by Quebec: retention is limited and some areas are release only."],
      ["Capelin and smelt", "Check season", "Capelin roll on beaches in early summer; smelt in fall and winter."],
      ["Atlantic salmon", "Check river", "Salmon rivers are managed by Quebec, with their own seasons and quotas."]] },
    nlNE: { n: "Newfoundland's north and east coasts and Labrador (NAFO 2GHJ3KL)", yr: 2026, sum: "Cod Jul 1 to Sep 7", links: [["Recreational groundfish", NL_GF], ["DFO sport fishing", "https://www.dfo-mpo.gc.ca/fisheries-peches/recreational-recreative/index-eng.html"]], fish: [
      ["Cod and other groundfish", "Jul 1 to Sep 7 and Sep 19 to 27, 2026", "5 a day per person, cod included. Rod or handline with up to 3 hooks; from an hour before sunrise to an hour after sunset. No licence.", [[7, 1, 9, 7], [9, 19, 9, 27]]],
      ...NL_REST] },
    nlSW: { n: "Newfoundland's south and west coasts (NAFO 3Ps and 3Pn4R)", yr: 2026, sum: "Cod on summer weekends", links: [["Recreational groundfish", NL_GF], ["DFO sport fishing", "https://www.dfo-mpo.gc.ca/fisheries-peches/recreational-recreative/index-eng.html"]], fish: [
      ["Cod and other groundfish", "Sat to Mon, Jul 4 to Sep 7, and Sep 19 to 27, 2026", "Open each weekend Saturday to Monday. 5 a day per person, cod included. Rod or handline with up to 3 hooks; from an hour before sunrise to an hour after sunset. No licence.", [[7, 4, 9, 7], [9, 19, 9, 27]]],
      ...NL_REST] },
    arctic: { n: "Hudson Bay and the Arctic coast", sum: "Arctic char", links: [["Arctic sport fishing", "https://www.dfo-mpo.gc.ca/fisheries-peches/recreational-recreative/arctic-arctique/index-eng.html"]], fish: [
      ["Arctic char", "Check limits", "Sea-run char run up the rivers in late summer. The territory's sport fishing licence and limits apply."],
      ["Lake trout and grayling", "Check limits", "In the rivers and lakes near the coast, under the territory's guide."]] },
  };

  // ---------- seasons and limits for the water itself (alex: "the season and limits for each lake on the spot card") ----------
  // Quebec: data/fishing/qcrules.json (its regulations site: each zone's rules and every water with an exception, by the
  // exceptions map's id). Ontario: onrules.json (the zone pages of the regulations summary; a lake's own lines found by
  // name). BC: bcregs.json (the water-specific tables of each region's synopsis, by name). Alberta has its own table per
  // water in the Rules part already. Each line says if it's open or closed today where the dates can be read.
  const MONTHS_LC = MONTHS.map((m) => m.toLowerCase()), MON3 = MONTHS_LC.map((m) => m.slice(0, 3));
  const NTH = { first: 0, second: 1, third: 2, fourth: 3, last: -1 };
  const WDAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  // One date in the year from words: "April 23rd, 2026", "Dec 1", "fourth Saturday in April", "Friday before the second Saturday in May".
  function dayOf(t, y) {
    t = String(t).toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").trim();
    let m = t.match(/^(friday|saturday|sunday) (before|after) (?:the )?(.+)$/);
    if (m) { const d = dayOf(m[3], y); if (!d) return null; const w = WDAY.indexOf(m[1]); const r = new Date(d); do r.setDate(r.getDate() + (m[2] === "before" ? -1 : 1)); while (r.getDay() !== w); return r; }
    m = t.match(/^(first|second|third|fourth|last) (\w+day) (?:in|of) (\w+)/);
    if (m) {
      const mo = MONTHS_LC.indexOf(m[3]), w = WDAY.indexOf(m[2]); if (mo < 0 || w < 0) return null;
      if (NTH[m[1]] < 0) { const r = new Date(y, mo + 1, 0); while (r.getDay() !== w) r.setDate(r.getDate() - 1); return r; }
      const r = new Date(y, mo, 1); while (r.getDay() !== w) r.setDate(r.getDate() + 1); r.setDate(r.getDate() + 7 * NTH[m[1]]); return r;
    }
    m = t.match(/^([a-z]+)\.? (\d{1,2})(?:,? (\d{4}))?/);
    if (m) { const mo = MON3.indexOf(m[1].slice(0, 3)); if (mo < 0) return null; return new Date(m[3] ? +m[3] : y, mo, +m[2]); }
    return null;
  }
  // Open today? true, false, or null when the words can't be read. "A to B and C to D", "open all year", "closed all year".
  function openToday(text) {
    const t = String(text || "").toLowerCase().replace(/^from /, "").replace(/\(.*?\)/g, "").trim();
    if (/closed all year|fishing prohibited/.test(t)) return false;
    if (/^open all year|^all year/.test(t)) return true;
    const now = new Date(); now.setHours(12, 0, 0, 0);
    let any = false;
    for (const part of t.split(/\band\b(?= (?:from )?(?:[a-z]+ \d|\w+ \w+day|friday|saturday))/)) {
      const m = part.replace(/^\s*(?:from|open from|open)\s+/, "").match(/^(.+?)\s+to\s+(.+?)(?:\s*-.*)?$/);
      if (!m) continue;
      const y = now.getFullYear();
      let a = dayOf(m[1], y), b = dayOf(m[2], y);
      if (!a || !b) continue;
      any = true;
      if (b < a && !/\d{4}/.test(m[2])) { if (now >= a || now <= b) return true; continue; }   // over new year: Dec 1 to Mar 31
      b.setHours(23, 59);
      if (now >= a && now <= b) return true;
    }
    return any ? false : null;
  }
  const chipOf = (open) => (open == null ? "" : `<em class="fs-st" style="--c:${open ? C.ok : C.blown}">${open ? "Open now" : "Closed now"}</em>`);
  const qcRow = (r) => { const shut = /prohibited/i.test(r[2]), open = shut ? false : /same as the zone/i.test(r[0]) ? null : openToday(r[0]);
    return `<li style="--c:${open == null ? C.zone : open ? C.ok : C.blown}"><b>${esc(r[1])} ${chipOf(open)}</b><small>${esc([shut ? "No fishing" : r[2] && `${r[2]}${/^\d+$/.test(r[2]) ? " a day" : ""}`, r[3], r[4]].filter(Boolean).join(" · "))}${!shut && r[0] && !/^same/i.test(r[0]) ? `<br>${esc(r[0].replace(/^From /, "").replace(/-\s*Other species$/, ""))}` : ""}${r[5] ? `<br>${esc(r[5])}` : ""}</small></li>`; };
  const nameParts = (n) => String(n || "").replace(/\(.*?\)/g, " ").split(/\s*\/\s*|\s+and\s+|\s+et\s+|,\s*/i).map((x) => plain(x)).filter(Boolean);
  const sameWater = (a, b) => { const p = plain(b); return !!p && nameParts(a).includes(p); };
  const files2 = {};
  const loadOnce = (n) => files2[n] || (files2[n] = load(n).catch(() => { delete files2[n]; return null; }));
  // ---------- rules in short (alex 2026-10-26: "can you do a small summary of the rules here") ----------
  // A few lines at the top of Rules: the water's own rules when they're known, then the zone's or region's main ones.
  // BC's regional rules (the "Regional Regulations" page of each region's 2025-2027 synopsis PDF), written by hand
  // like the Atlantic SEA rules: [text, closure dates or ""]; s: streams only. Check them when the next synopsis comes out.
  const BC_GEN = {
    1: { s: [["Single barbless hook in all streams, all year", ""], ["Bait ban in streams, all year (some exceptions)", ""], ["Release wild trout and char; keep hatchery trout only", ""], ["No fishing in streams of MU 1-1 to 1-6", "Jul 15 to Aug 31"]],
      q: "Trout 4 a day (1 over 50 cm, 2 from streams), kokanee 5, bass and perch unlimited; release all wild steelhead" },
    2: { s: [["Single barbless hook in all streams, all year", ""], ["Release wild trout and char", ""]],
      q: "Trout/char 4 a day (1 over 50 cm, 2 hatchery from streams, 1 char 60 cm+), kokanee 5, bass 20; release all wild steelhead" },
    3: { s: [["No fishing in streams", "Jan 1 to Jun 30"], ["Single barbless hook in all streams, all year", ""]],
      q: "Trout/char 5 a day (4 from streams, 1 over 50 cm), kokanee 5, burbot 2; release all steelhead; bass and perch closed" },
    4: { s: [["No fishing in streams", "Apr 1 to Jun 14"], ["Trout and char catch and release in streams", "Nov 1 to Mar 31"], ["Single barbless hook in all streams, all year", ""]],
      q: "Trout/char 5 a day (2 from streams, 1 over 50 cm, 1 bull trout), kokanee 15; bass, pike, walleye, perch and sturgeon closed" },
    5: { s: [["No fishing in streams of the Fraser watershed (not the Fraser itself)", "Apr 1 to Jun 30"], ["Single barbless hook in all streams, all year", ""]],
      q: "Trout/char 5 a day (2 from streams, 1 over 50 cm, 2 lake trout), kokanee 5, burbot 5; release all steelhead; bass closed" },
    6: { s: [["Single barbless hook in all streams, all year", ""], ["Bait ban in the Skeena and Nass and their tributaries, all year", ""], ["No fishing in streams for steelhead (main rivers excepted)", "May 15 to Jun 15"], ["No fishing in streams of the upper Skeena (above Cedarvale) and upper Nass", "Jan 1 to Jun 15"]],
      q: "Trout/char 5 a day (1 trout from streams, 1 over 50 cm, 3 Dolly Varden/bull trout), kokanee 10, pike 5, grayling 3; release wild steelhead" },
    7: { s: [["No fishing in streams", "Apr 1 to Jun 30"], ["Single barbless hook and bait ban in all streams, all year", ""]],
      q: "Trout/char 5 a day (2 from streams, 1 over 50 cm, 3 lake trout, 1 bull trout from lakes only), kokanee 10, burbot 5; grayling catch and release" },
    9: { s: [["Single barbless hook and bait ban in all streams, all year", ""], ["Rainbow trout catch and release", "May 1 to Jun 15"]],
      q: "Trout/char 5 a day (2 from streams, 1 over 50 cm, 2 lake trout, 1 bull trout), grayling 2 (none under 30 cm)" },
    8: { s: [["No fishing in streams", "Apr 1 to Jun 30"], ["Single barbless hook in all streams, all year", ""]],
      q: "Trout/char 5 a day (4 from streams, only 2 over 30 cm, 1 over 50 cm), kokanee 5, walleye 8, burbot 2; bass and perch closed" },
  };
  const MAIN_SP = /walleye|dor[ée]|brook trout|omble de fontaine|rainbow|lake trout|touladi|pike|brochet|bass|achigan|perch|perchaude|muskellunge|maskinong|salmon|saumon|trout/i;
  // New Brunswick's map of its waters (GeoNB's fishing regulations site, CORS open): what kind of water the spot is on
  // (salmon, trout, bass) and its own rules there: closed, crown reserve or lease, guide needed, restricted gear.
  const NB_REGS = "https://gis-erd-der.gnb.ca/gisserver/rest/services/Fishing_Regs_Site";
  const NB_KIND = [[/Atlantic Salmon/, "Atlantic salmon water: salmon have their own season, tags and hook-and-release rules"], [/LandLocked Salmon/, "Landlocked salmon water"],
    [/Smallmouth Bass/, "Smallmouth bass water"], [/Trout/, "Trout water"]];
  const NB_RULE = [[/Closed to Angling/, "Closed to angling", false], [/Pool Closure/, "A pool closed during warm water", null], [/Crown Reserve/, "Crown reserve water: only with a Crown reserve licence (by draw)", null],
    [/Crown Angling Lease/, "Crown angling lease: only with the leaseholder's permission", null], [/Guide Required/, "Non-residents need a licensed guide here", null],
    [/Restricted Gear/, "Restricted gear water: check which flies, lures and bait are allowed", null], [/Tidal/, "Tidal water: Fisheries and Oceans Canada's rules", null]];
  async function nbWater(lat, lon) {
    const q = (svc) => fetch(`${NB_REGS}/${svc}/MapServer/identify?${new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", sr: "4326", layers: "all", tolerance: "8",
      mapExtent: `${lon - 0.002},${lat - 0.0015},${lon + 0.002},${lat + 0.0015}`, imageDisplay: "100,100,96", returnGeometry: "false", f: "json" })}`).then((r) => r.json()).then((j) => j.results || []).catch(() => []);
    const [kinds, rules] = await Promise.all([q("Rivers_Lakes"), q("Closed_Rivers_Lakes")]);
    const val = (a, k) => (a[k] && a[k] !== "Null" ? String(a[k]) : ""), out = [], seen = new Set();
    for (const r of kinds) {
      const k = NB_KIND.find(([re]) => re.test(r.layerName)), nm = val(r.attributes, "WATER_NAME");
      if (!k || seen.has(k[1])) continue;
      seen.add(k[1]);
      out.push([`${nm ? `${esc(nm)}: ` : ""}${esc(k[1])}`, val(r.attributes, "IS_OPEN") === "No" ? chipOf(false) : ""]);
    }
    for (const r of rules) {
      const k = NB_RULE.find(([re]) => re.test(r.layerName)), d = val(r.attributes, "SECT_DESC");
      if (!k || seen.has(k[1])) continue;
      seen.add(k[1]);
      out.push([`<b>${esc(k[1])}</b>${d ? `<br><small>${esc(d.length > 160 ? d.slice(0, 157).replace(/\s\S*$/, "") + "…" : d)}</small>` : ""}`, k[2] === false ? chipOf(false) : ""]);
    }
    return out.slice(0, 6);
  }
  // Yukon (alex 2026-10-28, from the 2026-27 Fishing Regulations Summary PDF, typed in like BC_GEN): most waters are
  // General Waters, open all year; the summary lists the waters with special limits by group. Check each spring.
  const YT_PDF = "https://yukon.ca/fishing-regulations";
  const YT_GEN = [["Lake trout", "3 a day, only 1 over 65 cm"], ["Arctic grayling", "5 a day, only 1 over 40 cm"], ["Northern pike", "5 a day, only 1 over 75 cm"],
    ["Bull trout", "2 a day, only 1 over 50 cm"], ["Rainbow trout", "5 a day"], ["Kokanee", "5 a day"], ["Arctic char", "2 a day"], ["Dolly Varden", "5 a day"], ["Whitefish", "5 a day"],
    ["Inconnu (sheefish)", "1 a day"], ["Cisco", "5 a day"], ["Burbot", "3 a day (10 in waters over 2,500 ha)"], ["Salmon (chinook, sockeye, coho, chum)", "2 a day together, with a Salmon Conservation Catch Card"], ["Other fish", "5 a day"]];
  const YT_CONS = [["Lake trout", "2 a day: release all 65-100 cm, only 1 over 100 cm"], ["Arctic grayling", "4 a day: release all 40-48 cm, only 1 over 48 cm"],
    ["Northern pike", "4 a day: release all 75-105 cm, only 1 over 105 cm"], ["Burbot", "3 a day (10 in waters over 2,500 ha)"]];
  const YT_SMALL = [["Lake trout", "1 a day, release all over 65 cm"], ["Arctic grayling", "2 a day, release all over 40 cm"], ["Northern pike", "4 a day, release all over 75 cm"]];
  // [group, hook rule, waters, limits [fish, limit, waters it's for or all] (the rest are General Waters'), notes [text, dates "Jul 1 to Nov 30" or "", waters it's for or all]].
  // A water is [name, lat, lon] when the name is common (Long Lake): it's that one within 40 km only.
  const YT_WATERS = [
    ["Conservation Water", "Barbless hooks only", ["Aishihik Lake", "Alligator Lake", "Bennett Lake", "Big Salmon Lake", "Big Salmon River", "Sandy Lake", "Blind Lakes", "Chain Lakes", "Claire Lake",
      "Coghlan Lake", "Drury Lake", "Poison Lake", "Ethel Lake", "Fire Lake", "Frances Lake", "Frank Lake", "Frederick Lake", "Glenlyon Lake", "Grass Lakes", "Jo-Jo Lake", "Kluane Lake", "Kusawa Lake",
      "Lake Laberge", "Little Wolverine Lake", ["Long Lake", 61.35, -137.1], "Marsh Lake", "Mayo Lake", "McEvoy Lake", "Morley Lake", "Morris Lake", "Nares Lake", "Nares River", "North Lakes",
      "Wolverine Lake", "Pleasant Lake", "Quiet Lake", "Sekulmun Lake", "Sekulmun River", "Tagish Lake", "Windy Arm", "Tay Lake", "Tchawsahmon Lake", "Jim Cook Lake", "Tele Lake", "Ten Mile Lake",
      "Tincup Lake", "Whitefish Lakes", "Wolf Lake"], YT_CONS, [["Kluane Lake: barbless hooks recommended, not required", "", ["Kluane Lake"]], ["A Yukon-BC water: in BC waters BC's licence and rules apply", "", ["Bennett Lake", "Tagish Lake"]]]],
    ["Special Management Water (A)", "", ["Laidlaw Lake", "Atlin Lake", "Rancheria River", "Swift River"], [["Arctic grayling", "3 a day"], ["Burbot", "10 a day", ["Atlin Lake"]]], [["A Yukon-BC water: in BC waters BC's licence and rules apply", ""]]],
    ["Special Management Water (B)", "Single-pointed barbless hooks only", ["Dezadeash Lake"], [...YT_CONS.slice(0, 3), ["Burbot", "3 a day"]], [["No fishing in Tower Bay (Gokhtaheen)", "Jul 1 to Aug 15"]]],
    ["Special Management Water (C)", "Barbless hooks only", ["Braeburn Lake", "Caribou Lake", "Chadburn Lake", "Duo Lake", "Ladue Lake", "Little Atlin Lake", "Little Fox Lakes", "Little Fox Lake", "Louise Lake", "Jackson Lake",
      "Minto Lake", "Watson Lake", "Wellesley Lake"], [...YT_SMALL, ["Burbot", "10 a day", ["Little Atlin Lake", "Wellesley Lake"]]],
      [["Lake trout: release all", "Jul 1 to Nov 30", ["Little Atlin Lake"]], ["Single-pointed barbless hooks; keep lake trout 58.5-65 cm only", "", ["Little Atlin Lake"]], ["An extra sport fishing licence is needed here", "", ["Wellesley Lake"]]]],
    ["Special Management Water (D)", "Single-pointed barbless hooks only", ["Kathleen River", "Kathleen Lake", "Lower Kathleen Lake", "Granite Lake", "Granite Creek", "Rainbow Lake", "Crescent Lake", "Quill Creek", "Lubbock River"],
      [...YT_SMALL, ["Rainbow trout", "release all"]], [["Quill Creek: outside Kluane National Park only (Parks Canada's rules inside)", "", ["Quill Creek"]]]],
    ["Special Management Water (E)", "Single-pointed barbless hooks only", ["Aishihik River", "Otter Pond", "McLean Lakes", "McLean Lake"], [["Rainbow trout", "release all"]], [["East Aishihik River: barbless hooks recommended", "", ["Aishihik River"]]]],
    ["Special Management Water (F)", "Barbless hooks only", ["Mandanna Lake"], [["Lake trout", "release all"], ...YT_CONS.slice(1, 3)], []],
    ["Special Management Water (G)", "Barbless hooks only", ["Fish Lake", "Fox Lake", "Little Salmon Lake", "Six Mile River", "Tagish River", "Teslin Lake"],
      [["Lake trout", "1 a day, release all over 65 cm", ["Fish Lake", "Fox Lake", "Little Salmon Lake", "Six Mile River", "Tagish River"]], ["Lake trout", "1 a day: release all 65-100 cm, only 1 over 100 cm", ["Teslin Lake"]],
        ...YT_CONS.slice(1, 3), ["Burbot", "10 a day", ["Little Salmon Lake", "Teslin Lake"]]],
      [["At Tagish Bridge: keep the first lake trout you catch, no size limit", "", ["Six Mile River", "Tagish River"]], ["A Yukon-BC water: in BC waters BC's licence and rules apply", "", ["Teslin Lake"]]]],
    ["Special Management Water (H)", "", ["Tatlmain Lake"], [["Burbot", "20 in possession"]], [["Stop fishing after 5 fish a day, even if you released them", ""], ["An extra sport fishing licence is needed here", ""]]],
    ["Special Management Water (I)", "", ["Tatshenshini River", "Blanchard River", "Klukshu River", "Klukshu Lake", "Nesketahin Lake", "Takhanne River", "Village Creek"], [],
      [["No fishing", "Jun 15 to Nov 30", ["Klukshu River", "Nesketahin Lake", "Village Creek"]], ["Single-pointed barbless hooks, gap under 20 mm", "Jun 1 to Jun 15", ["Klukshu River", "Village Creek"]],
       ["Single-pointed barbless hooks, gap under 20 mm", "Jun 1 to Nov 30", ["Takhanne River", "Blanchard River", "Tatshenshini River"]], ["Below Million Dollar Falls: artificial flies only, all year", "", ["Takhanne River"]],
       ["Salmon have their own limits and closures here: check the summary and DFO's fishery notices", ""]]],
    ["Special Management Water (J)", "", ["Yukon River", "Blind Creek", "Klondike River", "Lapie River", "Morley River", "Smart River", "Takhini River", "Tatchun River", "Tatchun Creek", "Teslin River"], [],
      [["No fishing (also the Yukon River at its mouth)", "Aug 1 to Sep 30", ["Tatchun River", "Tatchun Creek"]], ["Single-pointed barbless hooks, gap under 20 mm", "Jul 1 to Oct 15"],
       ["Artificial flies only", "Aug 20 to Sep 15", ["Takhini River"]], ["Whitehorse dam to the Robert Campbell Bridge: artificial flies only", "Jul 15 to Sep 30", ["Yukon River"]],
       ["No fishing within 23 m downstream of the Whitehorse Rapids Fish Ladder", "", ["Yukon River"]], ["Chinook salmon: no fishing 2024 to 2030 (Canada-Alaska agreement)", ""]]],
    ["Special Management Water (K)", "Barbless hooks only", ["Frenchman Lake", "Pine Lake", "Snafu Lakes", "Snafu Lake", "Tarfu Lakes", "Tarfu Lake", "Twin Lakes"], [["Lake trout", "release all"], ...YT_SMALL.slice(1)], []],
    ["Stocked lake", "", ["Cantlie Lake", "Chadden Lake", "Coffee Lake", "Fisheye Lake", "Gloria Lake", "Haldane Lake", "Hidden Lakes", "Hidden Lake", "Hour Lake", "Judas Lake", ["Long Lake", 60.75, -135.0], "Lucky Lake",
      "Pocket Lake", "Rantin Lake", "Salmo Lake", "Scout Lake", "Veronica Lake", "Whiskers Lake", "Wrong Lake"], [["Rainbow trout", "5 a day"], ["Arctic char", "5 a day"], ["Kokanee", "5 a day"]], []],
  ];
  const ytKey = (n) => String(n || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const ytName = (x) => (Array.isArray(x) ? x[0] : x);
  // The group a water is in (Yukon's map name), with its notes for this water only.
  function ytWater(name, lat, lon) {
    const k = ytKey(name);
    if (!k) return null;
    for (const [g, hook, ws, lim, notes] of YT_WATERS) {
      const hit = ws.find((x) => ytKey(ytName(x)) === k && (!Array.isArray(x) || lat == null || km(lat, lon, x[1], x[2]) < 40));
      const mine = (r) => !r[2] || r[2].some((x) => ytKey(x) === k);
      if (hit) return { g, hook, lim: lim.filter(mine), name: ytName(hit), notes: notes.filter(mine) };
    }
    return null;
  }
  // The water at a spot on Yukon's own base map (GeoYukon: CanVec 1:50,000 lakes and wide rivers, then streams within 150 m).
  const YT_MAP = "https://mapservices.gov.yk.ca/arcgis/rest/services/GeoYukon/GY_Basemap/MapServer";
  async function waterYT(lat, lon) {
    const q = (layer, extra = {}) => getJ(`${YT_MAP}/${layer}/query?${new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      outFields: "NAME_EN,WATER_DEFINITION", returnGeometry: "false", f: "json", ...extra })}`, 9000).then((j) => (j.features || []).map((f) => f.attributes)).catch(() => []);
    let a = (await q(38)).find((x) => x.NAME_EN), river = a && a.WATER_DEFINITION !== 83;
    if (!a) { a = (await q(29, { distance: "150", units: "esriSRUnit_Meter" })).find((x) => x.NAME_EN); river = true; }
    if (!a) return null;
    const own = ytWater(a.NAME_EN, lat, lon);
    return { name: a.NAME_EN, kind: river ? "River" : "Lake", yt: own, html: "" };   // its rules go in Rules and Seasons and limits
  }
  function ytShort(w) {
    const own = w && w.yt, out = [];
    const shut = (d) => { const o = openToday(d); return o == null ? "" : `<em class="fs-st" style="--c:${o ? C.blown : C.none}">${o ? "Now" : "Not now"}</em>`; };
    if (own) {
      out.push([`<b>${esc(own.name)}</b>: a ${esc(own.g)}${own.hook ? `. ${esc(own.hook)}` : ""}`, ""]);
      for (const [t, d] of own.notes) if (out.length < 4) out.push([`${esc(t)}${d ? ` (${esc(d.replace(" to ", "-"))})` : ""}`, d ? shut(d) : ""]);
      if (own.lim.length) out.push([esc(own.lim.slice(0, 3).map(([sp, l]) => `${sp} ${l.replace(/^(\d+) a day/, "$1")}`).join("; ")), ""]);
    } else {
      out.push(["General Waters: open all year, no special rules listed for this water", ""]);
      out.push([esc(YT_GEN.slice(0, 3).map(([sp, l]) => `${sp} ${l.replace(/ a day/, "")}`).join("; ")), ""]);
    }
    return out;
  }
  function ytSeason(w) {
    const own = w && w.yt, mine = new Map((own ? own.lim : []).map((r) => [r[0], r[1]]));
    const rows = [...(own ? own.lim.filter((r) => !YT_GEN.some((g) => g[0] === r[0])) : []), ...YT_GEN].map(([sp]) => [sp, mine.get(sp) || YT_GEN.find((g) => g[0] === sp)[1], mine.has(sp)]);
    const notes = own ? own.notes.map(([t, d]) => { const o = d ? openToday(d) : null; return `<li style="--c:${/^No fishing/.test(t) ? C.blown : C.high}"><b>${esc(t)}${o != null ? ` <em class="fs-st" style="--c:${o ? C.blown : C.none}">${o ? "Now" : "Not now"}</em>` : ""}</b>${d ? `<small>${esc(d)}</small>` : ""}</li>`; }).join("") : "";
    const body = `<p class="fs-note">${own ? `${esc(own.name)} is a ${esc(own.g)}${own.hook ? `: ${esc(own.hook.toLowerCase())}` : ""}. Its own limits are marked; the rest are General Waters' limits.` : `${esc((w && w.name) || "This water")} isn't in Yukon's list of waters with special rules: General Waters' limits apply, and it's open all year.`}</p>
      ${notes ? `<ul class="fs-list">${notes}</ul>` : ""}
      <ul class="fs-list">${rows.map(([sp, l, m]) => `<li style="--c:${m ? C.high : C.zone}"><b>${esc(sp)}</b><small>${esc(l)}</small></li>`).join("")}</ul>
      <p class="fs-note">The possession limit is twice the daily limit in General Waters (the same as the daily limit for trout, grayling and pike in Conservation Waters). Ice fishing: 2 lines, 1 hook each. Typed in from the <a href="${YT_PDF}" target="_blank" rel="noopener">Yukon Fishing Regulations Summary 2026-27</a>: check it, and DFO's salmon notices, before you fish.</p>`;
    return fold("season", IC.sun, "Seasons and limits", own ? esc(own.g) : "General Waters", body);
  }
  async function rulesShort(here, prov, w, lat, lon) {
    const out = here.filter((z) => z.k === "noer").map((z) => [`<b>No fishing here</b>: ${esc(z.n)} is an ecological reserve`, `<em class="fs-st" style="--c:${C.nofish}">Closed</em>`]);   // [text, chip html]
    if (out.length) return `<div class="fs-short"><h4>In short</h4><ul>${out.map(([t, c]) => `<li>${t} ${c}</li>`).join("")}</ul></div>`;
    const name = (w && w.name) || "", river = w && w.kind ? !/lake/i.test(w.kind) : null;
    const shut = (range) => { const o = openToday(range); return o == null ? "" : `<em class="fs-st" style="--c:${o ? C.blown : C.none}">${o ? "Closed now" : "Not now"}</em>`; };
    if (prov === "bc") {
      const z = here.find((x) => x.k === "bc"), g = z && BC_GEN[z.id];
      if (name && z) {
        const j = await loadOnce("bcregs"), rows = j && j.regions[z.id];
        const mine = rows ? rows.filter((r) => sameWater(r[0], name) && !/TRIBUTARIES/i.test(r[0])) : [];
        for (const t of mine.flatMap((r) => r[2]).slice(0, 3)) {
          const m = t.match(/^No Fishing\s+(?:from\s+)?([A-Z][a-z]{2,}\.? \d{1,2})\s*[-–]\s*([A-Z][a-z]{2,}\.? \d{1,2})$/);
          out.push([`${esc(titleCase(mine[0][0]))}: ${esc(t.length > 120 ? t.slice(0, 117).replace(/\s\S*$/, "") + "…" : t)}`, m ? shut(`${m[1]} to ${m[2]}`) : ""]);
        }
      }
      if (g) {
        if (river !== false) for (const [t, d] of g.s) out.push([`${river ? esc(t) : `Streams: ${esc(t.replace(/ in (?:all )?streams\b/, "").replace(/^./, (c) => c.toLowerCase()))}`}${d ? ` (${esc(d.replace(" to ", "-"))})` : ""}`, d ? shut(d) : ""]);
        out.push([esc(g.q), ""]);
      }
    } else if (prov === "qc") {
      const j = await loadOnce("qcrules"), z = here.find((x) => x.k === "qc");
      const own = j && w && w.qcId && j.waters[w.qcId], zone = (j && z && j.zones[z.id] ? j.zones[z.id] : []).filter((r) => !/prohibited/i.test(r[2]) && MAIN_SP.test(r[1]) && !/smelt|[ée]perlan/i.test(r[1])).sort((a, b) => gameRank(a[1]) - gameRank(b[1]));
      // One line per fish: of a fish's rows (walleye has one per season), the one open today.
      const key = (r) => r[1].toLowerCase().split(/[ (,]/)[0];
      const byKey = new Map();
      for (const r of zone) { const k = key(r), o = byKey.get(k); if (!o || (!openToday(o[0]) && openToday(r[0]))) byKey.set(k, r); }
      const rows = (own || []).filter((r) => !/^Other species$/i.test(r[1])).concat([...byKey.values()]);
      const seen = new Set();
      for (const r of rows) {
        if (seen.has(key(r)) || (!MAIN_SP.test(r[1]) && !own) || out.length >= 5) continue;
        seen.add(key(r));
        const no = /prohibited/i.test(r[2]), o = no ? false : openToday(r[0]), len = String(r[3] || "").replace(/\s*Sauger:.*$/i, "").replace(/^Walleye:\s*/i, "").replace(/ inclusively/i, "");
        out.push([`${esc(r[1])}: ${esc(no ? "no fishing" : [r[2] && `${r[2]}${/^\d+$/.test(r[2]) ? " a day" : ""}`, len].filter(Boolean).join(", ") || "see the rules")}`, chipOf(o)]);
      }
    } else if (prov === "on") {
      const j = await loadOnce("onrules"), z = here.find((x) => x.k === "on"), zr = j && z && j.zones[z.id];
      if (zr) {
        const lim = (t) => String(t || "").replace(/\s*(?:and|;|,)?\s*C-\d+.*$/, "").replace(/\bS-(\d+)/g, "$1").trim();
        const spx = name ? zr.spx.filter((x) => sameWater(x[3].split(/\s[-–]\s/)[0], name)) : [];
        for (const x of spx.slice(0, 2)) out.push([`${esc(name)}: ${esc(x[0])}${x[2] ? `, ${esc(lim(x[2]))} a day` : ""}`, chipOf(openToday(x[1]))]);
        if (name && zr.sanct.some((x) => sameWater(x[1].split(/\s[-–]\s/)[0], name))) out.push(["A fish sanctuary on part of this water: see Seasons and limits", ""]);
        for (const r of zr.wide.slice().sort((a, b) => gameRank(a[0]) - gameRank(b[0]))) {
          if (out.length >= 5) break;
          if (!MAIN_SP.test(r[0]) || /aggregate/i.test(r[0]) || out.some((o) => o[0].includes(esc(r[0])))) continue;
          out.push([`${esc(r[0])}${r[2] ? `: ${esc(lim(r[2]))} a day` : ""}`, chipOf(r[1] ? openToday(r[1]) : null)]);
        }
      }
    } else if (prov === "nb" && lat != null) {
      out.push(...await nbWater(lat, lon));
    } else if (prov === "yt") {
      out.push(...ytShort(w));
    }
    return out.length ? `<div class="fs-short"><h4>In short</h4><ul>${out.map(([t, c]) => `<li>${t}${c ? ` ${c}` : ""}</li>`).join("")}</ul><p class="fs-note">The main rules only: the full rules below decide.</p></div>` : "";
  }
  async function seasonHtml(here, prov, w, boatOut = []) {
    const name = (w && w.name) || "";
    if (prov === "yt") return ytSeason(w);
    if (prov === "qc") {
      const j = await loadOnce("qcrules"), z = here.find((x) => x.k === "qc");
      if (!j) return "";
      const own = w && w.qcId && j.waters[w.qcId], zr = z && j.zones[z.id], nm = name.replace(/\s*\(\d.*?\)\s*$/, "");
      if (!own && !zr) return "";
      if (own) for (const r of own) boatOut.push({ t: [r[4], r[5]].filter(Boolean).join(". "), src: "Quebec's fishing regulations" });
      const ownOpen = own && own.filter((r) => !/^Other species$/i.test(r[1])).map((r) => (/prohibited/i.test(r[2]) ? false : openToday(r[0])));
      const body = `${own ? `<h4>${esc(nm || "This water")}: its own rules</h4><ul class="fs-list">${own.map(qcRow).join("")}</ul>` : ""}
        ${zr ? (own ? `<details class="fs-more"><summary>Rest of ${esc(z.n)}</summary><ul class="fs-list">${zr.map(qcRow).join("")}</ul></details>` : `<p class="fs-note">${esc(nm || "This water")} follows the rules of ${esc(z.n)}.</p><ul class="fs-list">${zr.map(qcRow).join("")}</ul>`) : ""}
        <p class="fs-note">From Quebec's fishing regulations (${esc(j.updated)}). <a href="https://peche.faune.gouv.qc.ca/regpec/en/Info/Reglements?id_zone=${esc(z ? z.id : "")}" target="_blank" rel="noopener">Check the official rules</a>.</p>`;
      return fold("season", IC.sun, "Seasons and limits", own ? (ownOpen.some((x) => x) ? "Own rules · open now" : ownOpen.some((x) => x === false) ? "Own rules · closed now" : "Own rules") : esc(z.n), body);
    }
    if (prov === "on") {
      const j = await loadOnce("onrules"), z = here.find((x) => x.k === "on"), zr = j && z && j.zones[z.id];
      if (!zr) return "";
      const wx = name ? zr.wx.filter((x) => sameWater(x[0], name)) : [];
      const spx = name ? zr.spx.filter((x) => sameWater(x[3].split(/\s[-–]\s/)[0], name)) : [];
      const sanct = name ? zr.sanct.filter((x) => sameWater(x[1].split(/\s[-–]\s/)[0], name)) : [];
      for (const x of wx) boatOut.push({ t: [x[1], ...x[2]].join(". "), src: "Ontario's fishing regulations" });
      const lim = (t) => String(t).replace(/\bS-(\d+)/g, "$1 with a sport licence").replace(/\bC-(\d+)/g, "$1 with a conservation licence");
      const own = [
        ...wx.map((x) => `<li style="--c:${C.high}"><b>${esc(x[0].replace(/\s*\([^)]*$/, ""))}</b><small>${x[1] && !/^[A-Z]\W/.test(x[1]) ? `${esc(x[1].length > 110 ? x[1].slice(0, 110).replace(/\s\S*$/, "") + "…" : x[1])}<br>` : ""}${x[2].map((r) => { const [sp, ...rest] = r.split(/\s[-–]\s/), t = rest.join(" - "), o = /open|closed|no fishing/i.test(t) ? openToday(t.replace(/^(open|no fishing)( from)?\s*/i, "")) : null;
          return `<span class="fs-sea-p"><b>${esc(sp)}</b>${t ? `: ${esc(lim(t))}` : ""} ${/no fishing|sanctuary/i.test(r) && o != null ? chipOf(!o) : chipOf(/closed all year/i.test(t) ? false : o)}</span>`; }).join("")}</small></li>`),
        ...spx.map((x) => { const o = openToday(x[1]); return `<li style="--c:${o == null ? C.high : o ? C.ok : C.blown}"><b>${esc(x[0])} ${chipOf(o)}</b><small>${esc(x[1])}${x[2] ? ` · ${esc(lim(x[2]))}` : ""}<br>${esc(x[3])}</small></li>`; }),
        ...sanct.map((x) => `<li style="--c:${C.blown}"><b>Fish sanctuary</b><small>${esc(x[0])}<br>${esc(x[1])}</small></li>`),
      ];
      const wide = zr.wide.map((r) => { const o = r[1] ? openToday(r[1]) : null; return `<li style="--c:${o == null ? C.zone : o ? C.ok : C.blown}"><b>${esc(r[0])} ${chipOf(o)}</b><small>${esc([r[1], lim(r[2])].filter(Boolean).join(" · "))}</small></li>`; }).join("");
      const opens = zr.wide.filter((r) => r[1] && openToday(r[1])).map((r) => r[0]).filter((n) => /walleye|bass|trout|pike|perch|musk/i.test(n));
      const body = `${own.length ? `<h4>${esc(name)}: its own rules</h4><ul class="fs-list">${own.join("")}</ul>` : `<p class="fs-note">${esc(name || "This water")} has no exception in Zone ${esc(z.id)}: the zone's seasons and limits apply.</p>`}
        ${own.length ? `<details class="fs-more"><summary>Zone ${esc(z.id)} seasons and limits</summary><ul class="fs-list">${wide}</ul></details>` : `<ul class="fs-list">${wide}</ul>`}
        <p class="fs-note">From Ontario's fishing regulations summary (${esc(j.updated)}). <a href="https://www.ontario.ca/document/ontario-fishing-regulations-summary/fisheries-management-zone-${esc(z.id)}" target="_blank" rel="noopener">Check the official rules</a>.</p>`;
      return fold("season", IC.sun, "Seasons and limits", own.length ? "This lake has its own rules" : opens.length ? `${esc(opens.slice(0, 2).map((n) => n.replace(/ (combined|and sauger combined)$/i, "")).join(", "))} open` : `Zone ${esc(z.id)}`, body);
    }
    if (prov === "bc") {
      const j = await loadOnce("bcregs"), z = here.find((x) => x.k === "bc"), rows = j && z && j.regions[z.id];
      if (!rows || !name) return "";
      const mine = rows.filter((r) => sameWater(r[0], name) && !/TRIBUTARIES/i.test(r[0]));
      for (const r of mine) boatOut.push({ t: r[2].join("; "), src: "BC Freshwater Fishing Regulations Synopsis" });
      const li = mine.flatMap((r) => r[2].map((t) => { const m = t.match(/^No Fishing\s+(?:from\s+)?([A-Z][a-z]{2,}\.? \d{1,2})\s*[-–]\s*([A-Z][a-z]{2,}\.? \d{1,2})$/); const o = m ? openToday(`${m[1]} to ${m[2]}`) : null;
        const head = t.length > 60 ? t.split(/[;:,]/)[0] : t, rest = t.slice(head.length).replace(/^[;:,]\s*/, "");
        return `<li style="--c:${/^No Fishing/i.test(t) ? C.blown : C.high}"><b>${esc(head)}${m ? ` <em class="fs-st" style="--c:${o ? C.blown : C.none}">${o ? "Closed now" : "Not now"}</em>` : ""}</b>${rest ? `<small>${esc(rest)}</small>` : ""}</li>`; }));
      const body = mine.length ? `<p class="fs-note">${esc(titleCase(mine[0][0]))}${mine.length > 1 ? ` (${mine.length} waters with this name: management units ${esc(mine.map((r) => r[1]).join(", "))})` : ` · management unit ${esc(mine[0][1])}`}: exceptions to Region ${esc((BC_REGION[z.id] || [z.id])[0])}'s rules.</p><ul class="fs-list">${li.join("")}</ul>`
        : `<p class="fs-note">${esc(name)} isn't in Region ${esc((BC_REGION[z.id] || [z.id])[0])}'s list of exceptions: the region's general seasons and quotas apply.</p>`;
      const closed = mine.some((r) => r[2].some((t) => /^No Fishing$/i.test(t)));
      return fold("season", IC.sun, "Seasons and limits", mine.length ? (closed ? "No fishing" : "Own rules") : "Region's rules", `${body}<p class="fs-note">From the BC Freshwater Fishing Regulations Synopsis (${esc(j.updated)}). <a href="${BC_PDF}${(BC_REGION[z.id] || [])[1]}.pdf" target="_blank" rel="noopener">Region PDF</a> · <a href="${PROV.bc[1]}#In-Season-changes" target="_blank" rel="noopener">In-season changes</a></p>`);
    }
    return "";
  }

  // ---------- safe to eat (Ontario and Quebec fish eating guides, data/fishing/eat.json) ----------
  // The guide's water for a spot: the same name within 40 km (a big lake's middle can be far from the shore you're on),
  // else the nearest guide spot within 3 km.
  let eat = null;
  const loadEat = () => (eat ? Promise.resolve(eat) : load("eat").then((j) => (eat = j)));
  const plain = (n) => String(n || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\(.*?\)|\b(lake|lac|river|riviere|the|du|de|des|la|le|l')\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  function eatWaters(e, prov, lat, lon, name) {
    const list = e[prov] || [], nm = plain(name);
    const byName = nm ? near(list, lat, lon, 40, (w) => w.c).filter(([w]) => plain(w.n) === nm) : [];
    return byName.length ? byName.slice(0, 2) : near(list, lat, lon, 3, (w) => w.c).slice(0, 1);
  }
  const mealWord = (n) => (n === 0 ? "don't eat" : n == null ? "" : `${n}${n === 1 ? " meal" : ""}`);
  // Ontario: one advice per 5 cm size class; neighbouring classes with the same advice are joined ("20-55 cm: 4").
  function onSizes(e, codes) {
    const out = [];
    for (let i = 0; i < codes.length; i++) {
      if (codes[i] === ".") continue;
      let j = i; while (codes[j + 1] === codes[i]) j++;
      const from = e.len[i].replace(/[^\d-]/g, "").split("-")[0], to = /^>/.test(e.len[j]) ? "+" : `-${e.len[j].replace(/[^\d-]/g, "").split("-")[1]}`;
      out.push(`${from}${to} cm: <b>${mealWord(e.meals[+codes[i]])}</b>`);
      i = j;
    }
    return out.join(" · ");
  }
  async function eatHtml(lat, lon, prov, name) {
    let e; try { e = await loadEat(); } catch { return { html: "" }; }
    const ws = eatWaters(e, prov, lat, lon, name);
    if (!ws.length) return { html: "" };
    const out = { sp: [...new Set(ws.flatMap(([w]) => w.f.map((r) => e.sp[r[0]])))], name: ws[0][1] < 1.5 ? ws[0][0].n : "" };
    out.html = ws.map(([w, d]) => {
      const rows = w.f.slice().sort((a, b) => e.sp[a[0]].localeCompare(e.sp[b[0]]));
      let body;
      if (prov === "on") body = `<table class="fs-eat"><thead><tr><th>Fish</th><th>Meals a month, by length</th></tr></thead><tbody>${rows.map(([sp, g, sn, why]) =>
        `<tr><td><b>${esc(e.sp[sp])}</b>${why ? `<small>${esc(why)}</small>` : ""}</td><td>${onSizes(e, g) || "No advice"}${sn && sn !== g ? `<small>Children under 15, pregnant or may be: ${onSizes(e, sn)}</small>` : ""}</td></tr>`).join("")}</tbody></table>
        <p class="fs-note">A meal is 227 g (8 oz). From the Guide to Eating Ontario Fish (Ontario's Ministry of the Environment); <a href="https://www.ontario.ca/page/eating-ontario-fish" target="_blank" rel="noopener">more on the guide</a>.</p>`;
      else body = `<table class="fs-eat"><thead><tr><th>Fish</th><th>Meals a month, by size</th></tr></thead><tbody>${rows.map(([sp, m, mins, warn, banned]) => {
        const sizes = ["Small", "Medium", "Large"].map((k, i) => (m[i] == null ? "" : `${k}${mins[i] ? ` (${mins[i]}${mins[i + 1] ? `-${mins[i + 1]}` : "+"} cm)` : ""}: <b>${mealWord(m[i])}</b>`)).filter(Boolean).join(" · ");
        return `<tr><td><b>${esc(e.sp[sp])}</b></td><td>${sizes || "No advice"}${warn === 1 ? `<small>Planning a pregnancy, pregnant or breastfeeding: half as many meals.</small>` : warn === 2 ? `<small>Young children, planning a pregnancy, pregnant or breastfeeding: only now and then.</small>` : ""}${banned ? `<small>Fishing it isn't allowed here.</small>` : ""}</td></tr>`;
      }).join("")}</tbody></table>
        <p class="fs-note">A meal is 230 g of raw fish. From Quebec's Guide de consommation du poisson de pêche sportive en eau douce (Ministère de l'Environnement); <a href="https://geo.environnement.gouv.qc.ca/portail/apps/experiencebuilder/experience/?id=6eead579659d48f6bdcfc015ce55b733" target="_blank" rel="noopener">the guide</a>.</p>`;
      return `<h4>${esc(w.n)}${w.d ? ` <small>(${esc(w.d)})</small>` : ""}${d > 0.5 ? ` <small>${fmtKm(d)} away</small>` : ""}</h4>${body}`;
    });
    // One "Safe to eat" line, with each sampled spot nearby inside it.
    const nFish = new Set(ws.flatMap(([w]) => w.f.map((r) => r[0]))).size;
    out.html = fold("eat", IC.fish, "Safe to eat", `${nFish} fish${ws.length > 1 ? ` · ${ws.length} places` : ""}`, `<p class="fs-note">Meals a month by size; fewer for children and pregnancy.</p>${out.html.join("")}`);
    return out;
  }

  // The water at a spot from each province's own map server: name, fish found there, depth, and (Alberta) its rules.
  async function waterAt(lat, lon, prov) {
    try {
      if (prov === "bc") return await waterBC(lat, lon);
      if (prov === "ab") return await withList(await waterAB(lat, lon).catch(() => null), lat, lon);
      if (prov === "on") return await waterON(lat, lon);
      if (prov === "qc") return await waterQC(lat, lon);
      if (["nb", "ns", "pe", "nl"].includes(prov)) return await withList(null, lat, lon);
      if (prov === "yt") return await waterYT(lat, lon);
    } catch {}
    return null;
  }
  // Fish lists where the province's map has none (alex: "fish lists for Alberta rivers and the Atlantic provinces"):
  // data/fishing/fishlist.json. Nova Scotia's lake surveys for the lake itself, else every fish recorded within about
  // 5 km on GBIF.org (museum collections, government surveys, iNaturalist). Sea fish only near salt water. Alberta adds
  // the fish its regulations name for this water.
  // Big rivers whose fish are well known but thinly recorded online. [lat, lon, km, name, fish]
  const FAMOUS = [
    [46.95, -65.85, 45, "the Miramichi", ["Atlantic Salmon", "Brook Trout", "Striped Bass", "American Shad", "Alewife (Gaspereau)", "Rainbow Smelt"]],
    [47.9, -66.9, 45, "the Restigouche", ["Atlantic Salmon", "Brook Trout"]],
    [45.95, -66.5, 60, "the Saint John River", ["Smallmouth Bass", "Muskellunge", "Chain Pickerel", "Yellow Perch", "Striped Bass", "Brook Trout"]],
    [46.35, -61.05, 20, "the Margaree", ["Atlantic Salmon", "Brook Trout"]],
    [45.15, -61.95, 20, "St. Mary's River", ["Atlantic Salmon", "Brook Trout", "Smallmouth Bass"]],
    [49.0, -57.7, 30, "the Humber", ["Atlantic Salmon", "Brook Trout"]],
    [48.95, -54.65, 35, "the Gander", ["Atlantic Salmon", "Brook Trout"]],
    [49.0, -55.7, 45, "the Exploits", ["Atlantic Salmon", "Brook Trout"]],
    [53.54, -113.49, 35, "the North Saskatchewan", ["Walleye", "Sauger", "Northern Pike", "Goldeye", "Lake Sturgeon", "Mooneye"]],
    [50.95, -113.95, 30, "the Bow below Calgary", ["Rainbow Trout", "Brown Trout", "Mountain Whitefish"]],
  ];
  let fishlist = null;
  const loadFishlist = () => (fishlist ? Promise.resolve(fishlist) : load("fishlist").then((j) => (fishlist = j)));
  async function withList(w, lat, lon) {
    const j = await loadFishlist().catch(() => null);
    const reg = (w && w.regSp) || [];
    if (!j && !reg.length) return w;
    const salt = !!nearestTide(lat, lon, 5), name = (i) => j.sp[i][0], ok = (i) => salt || !j.sp[i][2];
    let lake = null, near = new Set();
    if (j) {
      lake = (j.ns || []).map((x) => [x, km(lat, lon, x[0], x[1])]).filter((x) => x[1] < 1.5).sort((a, b) => a[1] - b[1])[0];
      const r = Math.floor(lat * 20), c = Math.floor(lon * 20);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const i of j.cells[`${r + a}_${c + b}`] || []) if (ok(i)) near.add(name(i));
    }
    const surveyed = lake ? lake[0][3].map(name) : [], lakeName = lake ? titleCase(lake[0][2]) + (/lake|pond|river|brook/i.test(lake[0][2]) ? "" : " Lake") : "";
    const river = FAMOUS.find((f) => km(lat, lon, f[0], f[1]) < f[2]);
    const known = river ? river[4] : [];
    const sp = [...new Set([...reg, ...known, ...surveyed, ...near])].sort();
    if (!sp.length) return w;
    const src = [reg.length && "Alberta's regulations for this water", river && `what ${river[3]} is known for`, lake && `Nova Scotia's survey of ${lakeName}`, near.size && "fish recorded within about 5 km (GBIF.org: museum collections, surveys and iNaturalist)"].filter(Boolean);
    const html = speciesHtml(sp, `From ${src.join(", ")}. Not a guarantee they're there now.`);
    return { ...(w || { listOnly: true }), name: (w && w.name) || lakeName, sp, html: `${(w && w.html) || ""}${html}` };
  }
  const wfs = (layer, props, filter, count = 1) => getJ(`${WFS}?${new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: layer, outputFormat: "application/json", count: String(count), propertyName: props, CQL_FILTER: filter })}`, 9000)
    .then((j) => (j.features || []).map((f) => f.properties));
  // Fish anglers go for first (the rest, minnows, darters and sculpins, behind "more").
  const SPORT_FISH = /trout|salmon|char|steelhead|kokanee|grayling|whitefish|cisco|walleye|sauger|pike|muskellunge|perch|bass|crappie|bluegill|pumpkinseed|sunfish|catfish|bullhead|sturgeon|burbot|carp|drum|eel|smelt|lingcod|halibut|rockfish|cod|goldeye|mooneye|splake|dolly|bowfin|gar/i;
  const speciesHtml = (list, src) => {
    list = list.filter((s) => !/^(unidentifi|carps and|no fish)|\sx\s/i.test(s));
    if (!list.length) return "";
    const top = list.filter((s) => SPORT_FISH.test(s) && !/shiner|dace|minnow|darter|sculpin|stickleback|chub|sucker/i.test(s)), rest = list.filter((s) => !top.includes(s));
    const chips = (a) => a.map((s) => `<span class="fs-chip" style="--c:${ACC}">${esc(s)}</span>`).join("");
    return `<div class="fs-chips">${chips(top.length ? top : rest)}</div>${top.length && rest.length ? `<details class="fs-more"><summary>${rest.length} more (minnows, suckers, darters…)</summary><div class="fs-chips">${chips(rest)}</div></details>` : ""}<p class="fs-note">${esc(src)}</p>`;
  };
  async function waterBC(lat, lon) {
    const pt = `SRID=4326;POINT(${lon} ${lat})`;
    const [lake] = await wfs("WHSE_BASEMAPPING.FWA_LAKES_POLY", "GNIS_NAME_1,AREA_HA,WATERBODY_KEY_GROUP_CODE_50K", `INTERSECTS(GEOMETRY, ${pt})`).catch(() => []);
    let name = lake && lake.GNIS_NAME_1, kind = lake ? "Lake" : "", id = lake && lake.WATERBODY_KEY_GROUP_CODE_50K;
    if (!lake) {
      const [st] = await wfs("WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP", "GNIS_NAME,STREAM_ORDER", `DWITHIN(GEOMETRY, ${pt}, 120, meters) AND GNIS_NAME IS NOT NULL`).catch(() => []);
      if (st) { name = st.GNIS_NAME; kind = "River or creek"; }
    }
    const fish = await wfs("WHSE_FISH.FISS_FISH_OBSRVTN_PNT_SP", "SPECIES_NAME,GAZETTED_NAME", id ? `WATERBODY_IDENTIFIER='${id}'` : `DWITHIN(GEOMETRY, ${pt}, 400, meters)`, 500).catch(() => []);
    const sp = [...new Set(fish.map((f) => f.SPECIES_NAME).filter((s) => s && !/^(No Fish|Unidentified|Unknown)/i.test(s)))].sort();
    if (!name && !sp.length) return null;
    const [bath] = lake ? await wfs("WHSE_FISH.BATH_LAKE_BATHYMETRIC_SP", "LAKE_MAX_DEPTH_M,LAKE_MEAN_DEPTH_M", `DWITHIN(SHAPE, ${pt}, 200, meters)`, 1).catch(() => []) : [];
    const facts = [kind, lake && lake.AREA_HA ? `${lake.AREA_HA >= 100 ? Math.round(lake.AREA_HA) : lake.AREA_HA.toFixed(1)} ha` : "", bath && bath.LAKE_MAX_DEPTH_M ? `up to ${Math.round(bath.LAKE_MAX_DEPTH_M)} m deep${bath.LAKE_MEAN_DEPTH_M ? ` (average ${Math.round(bath.LAKE_MEAN_DEPTH_M)} m)` : ""}` : ""].filter(Boolean);
    return { name: name ? titleCase(name) : "", kind, sp, html: `${facts.length ? `<p class="fs-note">${esc(facts.join(" · "))}</p>` : ""}${speciesHtml(sp, "From BC's fish inventory (surveys and records), not a guarantee they're there now.")}` };
  }
  async function waterAB(lat, lon) {
    const q = (layer, extra) => getJ(`${AB_REG}/${layer}/query?${new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "WB_ID,Official_Name,Common_Name,FMZ", returnGeometry: "false", f: "json", ...extra })}`, 9000).then((j) => (j.features || []).map((f) => f.attributes));
    let [w] = await q(1).catch(() => []);
    if (!w) [w] = await q(0, { distance: "150", units: "esriSRUnit_Meter" }).catch(() => []);
    if (!w) return null;
    const regs = await getJ(`${AB_API}?waterbodyId=${w.WB_ID}`, 9000).catch(() => null);
    const name = titleCase(w.Common_Name || w.Official_Name || "");
    let rules = "";
    if (Array.isArray(regs) && regs.length) {
      rules = regs.map((sec) => {
        const rows = (sec.regulations || []).map((r) => {
          const open = /OPEN/i.test(r.seasonStatus || ""), size = [r.sizeLimitMin ? `over ${r.sizeLimitMin} cm` : "", r.sizeLimitMax ? `under ${r.sizeLimitMax} cm` : ""].filter(Boolean).join(", ");
          return `<tr class="${open ? "open" : "closed"}"><td><b>${esc(titleCase(r.species || ""))}</b><br><small>${esc(r.season || "")}</small></td><td>${esc(r.catchRules || (r.bagLimit != null ? `${r.bagLimit}` : ""))}${size ? `<br><small>${esc(size)}</small>` : ""}</td><td><small>${esc([r.baitType, r.comments].filter(Boolean).join(" "))}</small></td></tr>`;
        }).join("");
        return `${regs.length > 1 ? `<p><b>${esc(titleCase(sec.waterBodyOfficialName || ""))}</b>${sec.waterBodyDescription ? ` <small>${esc(sec.waterBodyDescription)}</small>` : ""}</p>` : sec.waterBodyDescription ? `<p class="fs-note">${esc(sec.waterBodyDescription)}</p>` : ""}
          <table class="fs-tbl"><thead><tr><th>Species and season</th><th>Limit</th><th>Bait, notes</th></tr></thead><tbody>${rows}</tbody></table>`;
      }).join("");
      rules = `<h4>${svg(IC.rules, 14)}Rules for ${esc(name || "this water")}</h4>${rules}<p class="fs-note">From Alberta's sportfishing regulations map (green: open today). Check the <a href="https://albertaregulations.ca/fishingregs/" target="_blank" rel="noopener">Alberta Guide to Sportfishing</a> for corrections.</p>`;
    }
    const regSp = Array.isArray(regs) ? [...new Set(regs.flatMap((sec) => (sec.regulations || []).map((r) => titleCase(r.species || "")).filter((n) => n && !/^all\b|^other|sport ?fish|total/i.test(n))))] : [];
    return { name, html: `<p class="fs-note">${esc(w.FMZ ? `Fish Management Zone ${w.FMZ}` : "")}</p>`, rules, regSp };
  }
  async function waterON(lat, lon) {
    const p = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      outFields: "OFFICIAL_WATERBODY_NAME,FISH_SPECIES_SUMMARY,MAXIMUM_DEPTH,MEAN_DEPTH,THERMAL_REGIME,SURFACE_AREA", returnGeometry: "false", f: "json" });
    const j = await getJ(`${LIO}/2/query?${p}`, 9000);
    const a = j.features && j.features[0] && j.features[0].attributes;
    if (!a) return null;
    const sp = String(a.FISH_SPECIES_SUMMARY || "").split(",").map((s) => s.trim()).filter(Boolean);
    const facts = [a.SURFACE_AREA ? `${Math.round(a.SURFACE_AREA)} ha` : "", a.MAXIMUM_DEPTH ? `up to ${a.MAXIMUM_DEPTH} m deep (average ${a.MEAN_DEPTH || "?"} m)` : "", a.THERMAL_REGIME ? `${a.THERMAL_REGIME.toLowerCase()} water` : ""].filter(Boolean);
    return { name: a.OFFICIAL_WATERBODY_NAME || "", kind: "Lake", sp, html: `${facts.length ? `<p class="fs-note">${esc(facts.join(" · "))}</p>` : ""}${speciesHtml(sp, "From Ontario's aquatic resource inventory.")}` };
  }
  async function waterQC(lat, lon) {
    const p = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "ID_ENDRO,NM_ENDRO_FR,VA_TYPE_DESCR_FR", returnGeometry: "false", f: "json" });
    const j = await getJ(`${QC_EXC}/query?${p}`, 9000);
    const a = j.features && j.features[0] && j.features[0].attributes;
    if (!a) return null;
    const name = `${a.VA_TYPE_DESCR_FR ? a.VA_TYPE_DESCR_FR + " " : ""}${a.NM_ENDRO_FR || ""}`.replace(/\s*\(\d[^)]*\)\s*$/, "").trim();
    return { name, qcId: a.ID_ENDRO, html: `<ul class="fs-list"><li style="--c:${C.high}"><b>This water has its own rules</b>Quebec lists an exception here (season, limits or gear differ from the zone): see Seasons and limits.</li></ul>` };
  }
  const titleCase = (s) => String(s || "").toLowerCase().replace(/(^|[\s\-'(/])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Of|The|And|De|Du|La|Le|Des)\b/g, (w) => w.toLowerCase()).replace(/^./, (c) => c.toUpperCase());

  function rulesHtml(lat, lon, here, prov) {
    const items = [], seen = new Set();
    for (const z of here) {
      if (seen.has(z.k + z.id)) continue;   // a zone drawn in more than one piece
      seen.add(z.k + z.id);
      if (z.k === "bc" && BC_REGION[z.id]) {
        const [n, f] = BC_REGION[z.id];
        items.push(`<li style="--c:${C.zone}"><b>BC Region ${esc(n)}: ${esc(z.n)}</b><a href="${BC_PDF}${f}.pdf" target="_blank" rel="noopener">Region ${esc(n)} regulations (PDF)</a> · <a href="${PROV.bc[1]}#In-Season-changes" target="_blank" rel="noopener">In-season changes</a><br><small>Find the lake or river by name in the region's tables; waters not listed follow the region's general rules.</small></li>`);
      } else if (z.k === "pfma") {
        items.push(`<li style="--c:${C.tide}"><b>Tidal waters: Pacific Fishery Management Area ${esc(z.id)}</b><a href="https://www.pac.dfo-mpo.gc.ca/fm-gp/rec/tidal-maree/a-s${esc(z.id)}-eng.html" target="_blank" rel="noopener">Area ${esc(z.id)} limits, closures and notices</a> (Fisheries and Oceans Canada)<br><small>Saltwater needs a tidal licence. Salmon and groundfish closures change during the season.</small></li>`);
      } else if (z.k === "ab") {
        items.push(`<li style="--c:${C.zone}"><b>Alberta Fish Management Zone ${esc(z.id)}</b><a href="https://albertaregulations.ca/fishingregs/${esc(z.id.toLowerCase())}.html" target="_blank" rel="noopener">Zone ${esc(z.id)} regulations</a> · <a href="https://geospatial.alberta.ca/afr/" target="_blank" rel="noopener">Alberta regulations map</a></li>`);
      } else if (z.k === "on") {
        items.push(`<li style="--c:${C.zone}"><b>Ontario Fisheries Management Zone ${esc(z.id)}</b><a href="https://www.ontario.ca/document/ontario-fishing-regulations-summary/fisheries-management-zone-${esc(z.id)}" target="_blank" rel="noopener">Zone ${esc(z.id)} seasons and limits</a> · <a href="https://www.lioapplications.lrc.gov.on.ca/fishonline/Index.html?viewer=FishONLine.FishONLine&locale=en-CA" target="_blank" rel="noopener">Fish ON-Line</a> (lake exceptions)</li>`);
      } else if (z.k === "nb") {
        items.push(`<li style="--c:${C.zone}"><b>New Brunswick Recreational Fishing Area ${esc(z.id)}: ${esc(z.n)}</b><a href="https://www.gnb.ca/content/dam/GNB3/c/fishnb---pechenb/doc/Fish.pdf" target="_blank" rel="noopener">Fish regulations summary (PDF)</a> · <a href="${PROV.nb[1]}" target="_blank" rel="noopener">Fish 2026-27</a><br><small>Find this area's season tables and the water by name; salmon rivers also follow Fisheries and Oceans Canada's notices.</small></li>`);
      } else if (z.k === "ns") {
        const pg = { 1: 24, 2: 30, 3: 38, 4: 44, 5: 46, 6: 49 }[z.id] || 22;
        items.push(`<li style="--c:${C.zone}"><b>Nova Scotia Recreational Fishing Area ${esc(z.id)}</b>${esc(z.n)}: <a href="${NS_HANDBOOK}#page=${pg}" target="_blank" rel="noopener">Area ${esc(z.id)} seasons, limits and exceptions</a> (Anglers' Handbook, page ${pg})</li>`);
      } else if (z.k === "nl") {
        items.push(`<li style="--c:${C.zone}"><b>${z.id === "1" ? "Newfoundland trout zone 1: the island" : "Labrador: trout zones 2 to 6"}</b><a href="${PROV.nl[1]}" target="_blank" rel="noopener">Angler's guide</a> (Fisheries and Oceans Canada)<br><small>${z.id === "1" ? "Salmon rivers are scheduled waters with their own seasons, tags and closures." : "Each Labrador zone has its own trout season: find this spot on the guide's zone map."}</small></li>`);
      } else if (z.k === "qc") {
        const news = (z.news || []).slice(0, 3).map(([d, t, u]) => `<br><small>${esc(d)}: ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t)}</small>`).join("");
        items.push(`<li style="--c:${C.zone}"><b>Quebec fishing ${esc(z.n)}</b>${z.u ? `<a href="${esc(z.u)}" target="_blank" rel="noopener">Seasons, limits and exceptions</a>` : ""}${z.map ? ` · <a href="${esc(z.map)}" target="_blank" rel="noopener">Zone map (PDF)</a>` : ""} · <a href="https://peche.faune.gouv.qc.ca/regpec/carteinteractive/" target="_blank" rel="noopener">Interactive map</a>${news}${z.nw ? `<details><summary>What's new in this zone</summary><p class="fs-note">${esc(z.nw).replace(/\n+/g, "<br>")}</p></details>` : ""}</li>`);
      }
    }
    for (const z of here) {
      if (z.k === "np") items.unshift(`<li style="--c:${C.park}"><b>${esc(z.n)}</b>A national park: fishing needs a <b>Parks Canada fishing permit</b> (the ${esc((PROV[prov] || ["provincial"])[0])} licence isn't valid here), and the park has its own seasons, limits and closed waters. Most parks ban lead tackle and live bait. <a href="${PC_PERMIT}" target="_blank" rel="noopener">Parks Canada permits</a></li>`);
      if (z.k === "qct") { const [what, how] = QCT[z.t] || QCT[0]; items.unshift(`<li style="--c:${z.t === 16 ? C.zec : C.fee}"><b>${esc(z.n)}</b>${what} ${how}</li>`); }
    }
    // Ecological reserves go first: no fishing at all, whatever the zone allows.
    for (const z of here) if (z.k === "noer") items.unshift(`<li style="--c:${C.nofish}"><b>No fishing: ${esc(z.n)}</b>${z.p === "bc"
      ? `An ecological reserve: BC's Ecological Reserve Regulation bans catching fish here unless you hold a permit. <a href="https://bcparks.ca/about/types-parks-protected-areas/" target="_blank" rel="noopener">BC Parks</a>`
      : `An ecological reserve: Quebec's Natural Heritage Conservation Act bans hunting, trapping and fishing, and you need the ministry's permission even to go in. <a href="https://www.environnement.gouv.qc.ca/biodiversite/reserves/" target="_blank" rel="noopener">Quebec ecological reserves</a>`}</li>`);
    if (!here.some((z) => z.k !== "pfma" && !isArea(z)) && PROV[prov]) items.push(`<li style="--c:${C.zone}"><b>${esc(PROV[prov][0])}</b><a href="${PROV[prov][1]}" target="_blank" rel="noopener">${esc(PROV[prov][0])} fishing regulations</a></li>`);
    if (!here.some((z) => z.k === "pfma") && nearestTide(lat, lon, 15) && !["bc"].includes(prov)) items.push(`<li style="--c:${C.tide}"><b>Near tidal water</b><a href="https://www.dfo-mpo.gc.ca/fisheries-peches/recreational-recreative/index-eng.html" target="_blank" rel="noopener">Fisheries and Oceans Canada recreational fishing rules</a> for the ocean and salmon rivers.</li>`);
    return items.length ? `<h4>${svg(IC.rules, 14)}Rules</h4><ul class="fs-list">${items.join("")}</ul>` : "";
  }

  const nearestTide = (lat, lon, maxKm = 40) => {
    if (!tides) return null;
    let best = null, bd = maxKm;
    for (const t of tides) { if (Math.abs(t[2] - lat) > 0.6 || Math.abs(t[3] - lon) > 1) continue; const d = km(lat, lon, t[2], t[3]); if (d < bd) { bd = d; best = t; } }
    return best ? { t: best, d: bd } : null;
  };
  const near = (list, lat, lon, maxKm, ll) => (list || []).map((x) => { const [a, b] = ll(x); return [x, Math.abs(a - lat) < maxKm / 100 && Math.abs(b - lon) < maxKm / 60 ? km(lat, lon, a, b) : 1e9]; })
    .filter(([, d]) => d <= maxKm).sort((a, b) => a[1] - b[1]);
  function stockHtml(lat, lon) {
    if (!stocked) return "";
    const list = near(stocked.waters, lat, lon, 3, (w) => w.c).slice(0, 2);
    if (!list.length) return "";
    return list.map(([w, d]) => {
      const r = w.r[0], when = /^\d{4}-\d\d-\d\d$/.test(r[0]) ? new Date(r[0] + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : r[0].replace(/ planned.*/, " (planned)");
      return fold("stock", IC.fish, list.length > 1 || d > 0.3 ? `Stocked: ${w.n}` : "Stocked", `${esc(when)}${stocked.sp[r[1]] ? `, ${esc(stocked.sp[r[1]].toLowerCase())}` : ""}`, `${d > 0.3 ? `<p class="fs-note">${esc(w.n)}, ${fmtKm(d)} away.</p>` : ""}${releasesHtml(w)}`);
    }).join("");
  }
  function releasesHtml(w) {
    const sp = stocked.sp, st = stocked.st || [];
    const rows = w.r.slice(0, 8).map((r) => `<tr><td>${esc(/^\d{4}-\d\d-\d\d$/.test(r[0]) ? fmtDay(r[0]) : r[0])}</td><td><b>${esc(sp[r[1]] || "")}</b>${st[r[3]] ? `<br><small>${esc(st[r[3]])}</small>` : ""}</td><td class="num">${r[2] ? r[2].toLocaleString() : ""}</td></tr>`).join("");
    const src = w.p === "bc" ? "Freshwater Fisheries Society of BC stocking report" : w.p === "ab" ? "Alberta stocking reports and this year's planned trout stocking" : "Ontario fish stocking data";
    return `<table class="fs-tbl"><thead><tr><th>When</th><th>What</th><th class="num">Fish</th></tr></thead><tbody>${rows}</tbody></table>${w.r.length > 8 ? `<p class="fs-note">And ${w.r.length - 8} more releases.</p>` : ""}<p class="fs-note">${src}.</p>`;
  }
  const fmtDay = (d) => new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  async function flowHtml(lat, lon, only) {
    const list = only ? [[only, 0]] : near(gauges, lat, lon, 25, (g) => [g[2], g[3]]).slice(0, 2);
    if (!list.length) return "";
    const parts = await Promise.all(list.map(async ([g, d]) => {
      const pts = await gaugeSeries(g[0]);
      const last = pts.filter((x) => x[1] != null || x[2] != null).pop();
      const r = last ? { t: new Date(last[0]).toISOString(), q: last[1], h: last[2] } : readings.get(g[0]);
      if (r) readings.set(g[0], r);
      const l = lightOf(g, r), tr = trendOf(pts), [name, color, tip] = LIGHTS[l];
      const clearing = tr && /dropping/.test(tr.word) && (l === "high" || l === "blown") ? " Dropping: it should clear and fish better soon." : tr && /rising/.test(tr.word) && l === "ok" ? " Rising: it may colour up." : "";
      return `<h4>${svg(IC.gauge, 14)}${esc(g[1])}${d > 0.3 ? ` <small>(${fmtKm(d)})</small>` : ""}</h4>
        <p><span class="fs-light" style="--c:${color}"></span><b>${esc(name)}</b>${tr ? ` · ${esc(tr.word)} (24 h)` : ""}</p>
        <p class="fs-note">${esc(tip + clearing)}</p>${sparkline(pts, g)}
        <p class="fs-note">${esc(ratioText(g, r))}${r && r.t ? ` · ${esc(new Date(r.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}` : ""} · gauge ${esc(g[0])}</p>`;
    }));
    return parts.join("");
  }
  async function tideHtml(lat, lon, only) {
    const n = only ? { t: only, d: 0 } : nearestTide(lat, lon, 30);
    if (!n) return "";
    const a = tideKinds(await tidesAt(n.t[0])).filter((x) => x[0] > Date.now() - 2 * 3600e3).slice(0, 6);
    if (!a.length) return `<h4>${svg(IC.wave, 14)}Tides at ${esc(n.t[1])}</h4><p class="fs-note">No tide predictions came back.</p>`;
    const nextHi = a.find((x) => x[0] > Date.now());
    return `<h4>${svg(IC.wave, 14)}Tides at ${esc(n.t[1])}${n.d > 0.5 ? ` <small>(${fmtKm(n.d)})</small>` : ""}</h4>
      ${nextHi ? `<p>Next: <b>${esc(nextHi[2].toLowerCase())} tide ${esc(hm(new Date(nextHi[0])))}</b>, ${nextHi[1].toFixed(1)} m. ${nextHi[2] === "High" ? "Best: the end of the rising tide and the start of the fall." : "Best: the hour either side of the turn."}</p>` : ""}
      <table class="fs-tbl"><tbody>${a.map((x) => `<tr${x[0] < Date.now() ? ' class="closed"' : ""}><td>${esc(dayName(new Date(x[0])))} ${esc(hm(new Date(x[0])))}</td><td>${x[2]}</td><td class="num">${x[1].toFixed(1)} m</td></tr>`).join("")}</tbody></table>
      <p class="fs-note">Canadian Hydrographic Service. Not for navigation.</p>`;
  }
  function accessHtml(lat, lon) {
    // The same ramp mapped twice shows once; private launches and docks go last.
    const list = near([...access.values()], lat, lon, 5, (a) => [a.lat, a.lon])
      .filter(([a], i, all) => !all.slice(0, i).some(([b]) => b.kind === a.kind && Math.abs(b.lat - a.lat) < 0.0006 && Math.abs(b.lon - a.lon) < 0.0009))
      .sort((x, y) => /private/.test(x[0].facts || "") - /private/.test(y[0].facts || "") || x[1] - y[1]).slice(0, 4);
    if (!list.length) return shown.has("access") && map.getZoom() < LAYERS.access.minZoom ? `<p class="fs-note">Zoom in to see fishing spots and launches near here.</p>` : "";
    return `<h4>${svg(IC.boat, 14)}Fishing spots and launches</h4><ul class="fs-list">${list.map(([a, d]) => `<li style="--c:${a.kind === "launch" ? C.launch : C.access}"><b>${esc(accessName(a))}</b><small>${fmtKm(d)} · ${esc(accessFacts(a))}</small></li>`).join("")}</ul>`;
  }
  const accessFacts = (a) => [a.kind === "launch" ? "boat launch" : a.kind === "pier" ? "pier or dock" : "fishing spot", a.facts, a.src].filter(Boolean).join(", ");

  // Opening one pin: the spot card for that place, titled with its name.
  // A hidden spot: the usual spot card, with why it's quiet, how to get in and where the information comes from on top.
  const hiddenWhy = (h) => (h.walk ? `stocked, no road within ${h.km} km` : h.tag || "hidden spot");
  function openHidden(h) {
    setSpot(h.lat, h.lon, "tap");
    showSpot(h.lat, h.lon, h.n);
    const el = $("fsHidden");
    if (!el) return;
    const body = h.walk
      ? `<p>Stocked, and no road reaches it: the nearest mapped road is more than ${h.km} km from the shore (${h.p === "bc" ? "BC Digital Road Atlas and forest roads" : "Ontario Road Network and MNRF forest roads"}), so few anglers make the walk. Old trails and decommissioned roads may still get you close: check the map and Route there.</p>`
        + `<p class="fs-note">${h.ha < 1 ? "A pond" : `About ${h.ha < 10 ? h.ha : Math.round(h.ha)} ha`}. The stocking is in the Stocked section below.</p>`
      : `${h.fish ? `<p><b>Fish:</b> ${esc(h.fish)}</p>` : ""}${h.how ? `<p><b>Getting there:</b> ${esc(h.how)}</p>` : ""}${h.tip ? `<p>${esc(h.tip)}</p>` : ""}`
        + `<p class="fs-note">From ${h.src.map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`).join(", ")}. Check the rules below before you go.</p>`;
    const qc = h.p === "qc" ? `<p class="fs-note">More quiet brook trout lakes: catch numbers for every lake in Quebec's zecs and wildlife reserves on <a href="https://www.geopratic.com/spoltf/" target="_blank" rel="noopener">SPOLTF</a>.</p>` : "";
    el.innerHTML = fold("hidden", IC.star, "Hidden spot", esc(h.walk ? `no road within ${h.km} km` : [h.tag, h.fish && h.fish.split(/[,(]/)[0].toLowerCase()].filter(Boolean).join(", ")), body + qc, true);
  }
  function openWater(w) { setSpot(w.c[0], w.c[1], "tap"); showSpot(w.c[0], w.c[1], w.n); }
  function openGauge(g) {
    setSpot(g[2], g[3], "tap");
    const el = $("fsSpot"), seq = ++spotSeq;
    el.hidden = false;
    el.innerHTML = `<header>${svg(IC.gauge)}<h3>${esc(g[1])}</h3>${routeBtn(g[2], g[3])}<button type="button" class="fs-x" aria-label="Close">${svg(IC.x, 16)}</button></header><div id="fsRoute"></div><div id="fsFlow"><p class="fs-note">Getting the last 7 days…</p></div><div id="fsRules"></div><div id="fsAcc"></div>`;
    el.querySelector(".fs-x").addEventListener("click", () => { el.hidden = true; spotSeq++; });
    cardInView(el);
    flowHtml(g[2], g[3], g).then((h) => { if (seq === spotSeq) { $("fsFlow").innerHTML = h; drawPoints(); } });
    loadZones().then((zs) => { if (seq !== spotSeq) return; const here = zonesAt(zs, g[2], g[3]); $("fsRules").innerHTML = secRules(rulesHtml(g[2], g[3], here, provinceAt(g[2], g[3], here))); $("fsAcc").innerHTML = secAcc(accessHtml(g[2], g[3])); });
  }
  function openTide(t) {
    setSpot(t[2], t[3], "tap");
    const el = $("fsSpot"), seq = ++spotSeq;
    el.hidden = false;
    el.innerHTML = `<header>${svg(IC.wave)}<h3>Tides: ${esc(t[1])}</h3>${routeBtn(t[2], t[3])}<button type="button" class="fs-x" aria-label="Close">${svg(IC.x, 16)}</button></header><div id="fsRoute"></div><div id="fsTide"><p class="fs-note">Getting the tides…</p></div><div id="fsSea"></div><div id="fsRules"></div>`;
    el.querySelector(".fs-x").addEventListener("click", () => { el.hidden = true; spotSeq++; });
    cardInView(el);
    tideHtml(t[2], t[3], t).then((h) => { if (seq === spotSeq) $("fsTide").innerHTML = h; });
    loadZones().then((zs) => { if (seq !== spotSeq) return; const here = zonesAt(zs, t[2], t[3]), prov = provinceAt(t[2], t[3], here); $("fsRules").innerHTML = secRules(rulesHtml(t[2], t[3], here, prov));
      seaHtml(t[2], t[3], zs, here, prov).then((h) => { if (seq === spotSeq && $("fsSea")) $("fsSea").innerHTML = h; }); });
  }
  function openAccess(a) {
    setSpot(a.lat, a.lon, "tap");
    showSpot(a.lat, a.lon, accessName(a));
  }

  // ---------- weather (Open-Meteo), sea (Open-Meteo marine), sun and moon ----------
  let wx = null, wxKey = "", sea = null;
  async function loadWeather() {
    if (!spot) return;
    const key = `${spot.lat.toFixed(2)},${spot.lon.toFixed(2)}`;
    if (key === wxKey && wx) { renderCond(); return; }
    wxKey = key;
    const p = new URLSearchParams({ latitude: spot.lat.toFixed(3), longitude: spot.lon.toFixed(3), timezone: "auto", past_days: "1", forecast_days: "3", wind_speed_unit: "kmh",
      current: "temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,cloud_cover,precipitation,weather_code",
      hourly: "temperature_2m,pressure_msl,wind_speed_10m,wind_gusts_10m,cloud_cover,precipitation" });
    try {
      const j = await getJ(`https://api.open-meteo.com/v1/forecast?${p}`);
      if (wxKey !== key) return;
      wx = j;
    } catch { wx = null; }
    sea = null;
    if (nearestTide(spot.lat, spot.lon, 40)) {
      try {
        const m = await getJ(`https://marine-api.open-meteo.com/v1/marine?latitude=${spot.lat.toFixed(3)}&longitude=${spot.lon.toFixed(3)}&current=wave_height,wave_period,sea_surface_temperature&timezone=auto`);
        if (wxKey === key && m.current) sea = m.current;
      } catch {}
    }
    renderCond(); renderNow(); renderToday();
  }
  const WX = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow", 80: "Showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Snow showers", 95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm" };
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const compass = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  // Pressure over the last 6 hours: anglers' oldest rule, a falling glass before a front turns fish on, a fast rise after it puts them off.
  function pressureTrend(w = wx) {
    const h = w && w.hourly; if (!h || !h.time) return null;
    const nowIso = w.current && w.current.time, i = Math.max(6, h.time.findIndex((t) => t >= nowIso));
    const a = h.pressure_msl[i - 6], b = h.pressure_msl[i];
    if (a == null || b == null) return null;
    const d = b - a;
    return { d, word: d <= -2.5 ? "falling fast" : d <= -0.8 ? "falling" : d >= 2.5 ? "rising fast" : d >= 0.8 ? "rising" : "steady" };
  }
  // ---------- sun and moon (after SunCalc by Vladimir Agafonkin, BSD; same as Hunting) ----------
  const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, OBL = rad * 23.4397;
  const toDays = (date) => date.valueOf() / dayMs - 0.5 + J1970 - J2000;
  const raOf = (l, b) => Math.atan2(Math.sin(l) * Math.cos(OBL) - Math.tan(b) * Math.sin(OBL), Math.cos(l));
  const decOf = (l, b) => Math.asin(Math.sin(b) * Math.cos(OBL) + Math.cos(b) * Math.sin(OBL) * Math.sin(l));
  const altOf = (H, phi, dec) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const sidereal = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
  function sunCoords(d) {
    const M = rad * (357.5291 + 0.98560028 * d);
    const L2 = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
    return { dec: decOf(L2, 0), ra: raOf(L2, 0) };
  }
  function moonCoords(d) {
    const L2 = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.22935 * d);
    const l = L2 + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F), dt = 385001 - 20905 * Math.cos(M);
    return { ra: raOf(l, b), dec: decOf(l, b), dist: dt };
  }
  const sunAlt = (date, lat, lon) => { const d = toDays(date), c = sunCoords(d); return altOf(sidereal(d, rad * -lon) - c.ra, rad * lat, c.dec) / rad; };
  const moonAlt = (date, lat, lon) => { const d = toDays(date), c = moonCoords(d); return altOf(sidereal(d, rad * -lon) - c.ra, rad * lat, c.dec) / rad; };
  function moonPhase(date) {
    const d = toDays(date), s = sunCoords(d), m = moonCoords(d), sdist = 149598000;
    const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
    const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi));
    const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
    return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI };
  }
  const PHASES = [[0.03, "New moon", "🌑"], [0.22, "Waxing crescent", "🌒"], [0.28, "First quarter", "🌓"], [0.47, "Waxing gibbous", "🌔"], [0.53, "Full moon", "🌕"],
    [0.72, "Waning gibbous", "🌖"], [0.78, "Last quarter", "🌗"], [0.97, "Waning crescent", "🌘"], [1.01, "New moon", "🌑"]];
  const tzOff = () => (wx && wx.utc_offset_seconds != null ? wx.utc_offset_seconds : -new Date().getTimezoneOffset() * 60) * 1000;
  function skyDay(lat, lon, ahead = 0) {
    const off = tzOff(), start = new Date(Math.floor((Date.now() + off) / dayMs) * dayMs - off + ahead * dayMs);
    const step = 5 * 60000, out = { day: start, rise: null, set: null, moonRise: null, moonSet: null, transit: null, under: null };
    let ps = sunAlt(start, lat, lon), pm = moonAlt(start, lat, lon), maxM = -99, minM = 99;
    for (let t = start.valueOf() + step; t <= start.valueOf() + dayMs; t += step) {
      const dt = new Date(t), s = sunAlt(dt, lat, lon), m = moonAlt(dt, lat, lon);
      const cross = (a, b, h) => new Date(t - step + (step * (h - a)) / (b - a));
      if (ps < -0.833 && s >= -0.833 && !out.rise) out.rise = cross(ps, s, -0.833);
      if (ps >= -0.833 && s < -0.833 && !out.set) out.set = cross(ps, s, -0.833);
      if (pm < 0.133 && m >= 0.133 && !out.moonRise) out.moonRise = cross(pm, m, 0.133);
      if (pm >= 0.133 && m < 0.133 && !out.moonSet) out.moonSet = cross(pm, m, 0.133);
      if (m > maxM) { maxM = m; out.transit = dt; }
      if (m < minM) { minM = m; out.under = dt; }
      ps = s; pm = m;
    }
    return out;
  }
  const hm = (d) => {
    if (!d) return "none";
    const x = new Date(d.valueOf() + tzOff()), h = x.getUTCHours();
    return `${h % 12 || 12}:${String(x.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  const dayName = (d) => new Date(d.valueOf() + tzOff()).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" });
  const span = (d, mins) => (d ? `${hm(new Date(d - mins * 60000))} to ${hm(new Date(d.valueOf() + mins * 60000))}` : "");

  // ---------- fishing forecast: 1 to 5 for today and the next two days ----------
  // From what anglers go by: a falling barometer before weather, a light chop, cloud, the moon near new or full, and
  // (for rivers) a normal flow. A guide, not a promise.
  function castDays() {
    const h = wx && wx.hourly; if (!h || !h.time || !spot) return [];
    const out = [];
    const flow = nearFlowLight();
    for (let k = 0; k < 3; k++) {
      const day = h.time.find((t) => t.slice(0, 10) > (k ? out[k - 1].date : "") && t >= (wx.current?.time || "").slice(0, 10)) || "";
      const date = k === 0 ? (wx.current?.time || h.time[24]).slice(0, 10) : (() => { const d = new Date(out[0].date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); })();
      const idx = h.time.map((t, i) => (t.slice(0, 10) === date && +t.slice(11, 13) >= 6 && +t.slice(11, 13) <= 20 ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) break;
      const avg = (a) => a.reduce((s, x) => s + (x || 0), 0) / a.length;
      const wind = avg(idx.map((i) => h.wind_speed_10m[i])), gust = Math.max(...idx.map((i) => h.wind_gusts_10m[i] || 0)), cloud = avg(idx.map((i) => h.cloud_cover[i])), rain = idx.reduce((s, i) => s + (h.precipitation[i] || 0), 0);
      const p0 = h.pressure_msl[idx[0] - 6] ?? h.pressure_msl[idx[0]], p1 = h.pressure_msl[idx[idx.length - 1]], dp = p1 - p0, tmax = Math.max(...idx.map((i) => h.temperature_2m[i]));
      const ph = moonPhase(new Date(date + "T12:00:00Z")).phase, moonNear = Math.min(Math.abs(ph - 0), Math.abs(ph - 0.5), Math.abs(ph - 1)) < 0.06;
      let s = 2.5; const why = [];   // an ordinary day is a 3; it takes several good signs to make a 5
      if (dp <= -1.5) { s += 1; why.push("pressure falling"); } else if (dp >= 3) { s -= 1; why.push("pressure rising fast"); } else if (Math.abs(dp) < 1) why.push("steady pressure");
      if (wind >= 6 && wind <= 18) { s += 0.5; why.push("light chop"); } else if (wind > 28 || gust > 50) { s -= 1.5; why.push("windy"); } else if (wind < 4) why.push("calm (spooky fish)");
      if (cloud > 60) { s += 0.5; why.push("cloudy"); } else if (cloud < 20) { s -= 0.25; why.push("bright sun"); }
      if (rain > 12) { s -= 0.75; why.push("heavy rain"); } else if (rain > 0.5) why.push("some rain");
      if (moonNear) { s += 0.5; why.push(ph > 0.25 && ph < 0.75 ? "full moon" : "new moon"); }
      if (tmax > 27) { s -= 0.5; why.push("hot: fish early"); }
      if (k === 0 && flow) {
        if (flow === "ok") { s += 0.5; why.push("river normal"); } else if (flow === "blown") { s -= 1.5; why.push("river blown out"); } else if (flow === "high") { s -= 0.5; why.push("river high"); } else if (flow === "vlow") { s -= 0.5; why.push("river very low"); }
      }
      out.push({ date, s: Math.max(1, Math.min(5, Math.round(s))), why });
    }
    return out;
  }
  function nearFlowLight() {
    if (!spot || !gauges) return null;
    const [g] = near(gauges, spot.lat, spot.lon, 15, (x) => [x[2], x[3]])[0] || [];
    return g ? lightOf(g, readings.get(g[0])) : null;
  }
  const stars = (n) => `<span class="fs-stars" aria-label="${n} of 5">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>`;
  function renderCond() {
    const el = $("fsCond");
    if (!spot) { el.innerHTML = ""; return; }
    const c = wx && wx.current, pt = pressureTrend(), days = castDays();
    const s = skyDay(spot.lat, spot.lon), ph = moonPhase(new Date()), p = PHASES.find((x) => ph.phase < x[0]) || PHASES[0];
    const major = [s.transit, s.under].filter(Boolean).sort((a, b) => a - b).map((d) => span(d, 60)).join(", ");
    const minor = [s.moonRise, s.moonSet].filter(Boolean).sort((a, b) => a - b).map((d) => span(d, 30)).join(", ");
    el.innerHTML = `<header>${svg(IC.sun)}<h3>Conditions${spot.how === "centre" ? " on the map" : " at the spot"}</h3></header>
      ${c ? `<div class="fs-stats"><div><b>${Math.round(c.temperature_2m)}°</b><span>${esc(WX[c.weather_code] || "Air")}</span></div><div><b>${Math.round(c.wind_speed_10m)}</b><span>km/h ${compass(c.wind_direction_10m)}</span></div>
        <div><b>${Math.round(c.pressure_msl)}</b><span>hPa ${pt ? esc(pt.word) : ""}</span></div><div><b>${sea && sea.sea_surface_temperature != null ? `${Math.round(sea.sea_surface_temperature)}°` : `${Math.round(c.cloud_cover)}%`}</b><span>${sea && sea.sea_surface_temperature != null ? "Sea" : "Cloud"}</span></div></div>
        ${sea && sea.wave_height != null ? `<p class="fs-note">Waves ${sea.wave_height.toFixed(1)} m${sea.wave_period ? ` every ${Math.round(sea.wave_period)} s` : ""} offshore (Open-Meteo marine forecast).</p>` : ""}` : `<p class="fs-note">Getting the weather…</p>`}
      ${fold("days", IC.star, "Next 3 days", days.length ? days.map((d) => `<span class="fs-mini">${d.s}★</span>`).join("") : "", days.length ? `<ul class="fs-days">${days.map((d, i) => `<li><b>${i === 0 ? "Today" : esc(new Date(d.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long" }))}</b>${stars(d.s)}<span></span><small>${esc(d.why.join(", "))}</small></li>`).join("")}</ul>` : "")}
      ${fold("sun", IC.sun, "Sun and moon", `${hm(s.rise)}–${hm(s.set)} · ${p[2]}`, `<dl class="fs-sun"><dt>Sunrise · sunset</dt><dd>${hm(s.rise)} · ${hm(s.set)}</dd><dt>Moon</dt><dd>${p[2]} ${p[1]}, ${Math.round(ph.fraction * 100)}%</dd>
        <dt>Feeding times</dt><dd>${major || "none"}${minor ? ` <small>· minor ${minor}</small>` : ""}</dd></dl>
      <p class="fs-note">The first and last hour of light are often best. Feeding times are solunar, a traditional guide. Weather: Open-Meteo.</p>`)}`;
  }
  function renderNow() {
    const b = $("fsNow");
    if (!spot || !wx) { b.hidden = true; return; }
    const d = castDays()[0], pt = pressureTrend(), c = wx.current, f = nearFlowLight();
    b.hidden = false;
    b.innerHTML = `${d ? `<span>${svg(IC.star, 15)}<b>Bite today ${d.s}/5</b></span>` : ""}${f && f !== "none" ? `<span><span class="fs-light" style="--c:${LIGHTS[f][1]}"></span>River ${esc(LIGHTS[f][0].toLowerCase())}</span>` : ""}${c ? `<span>${Math.round(c.wind_speed_10m)} km/h ${compass(c.wind_direction_10m)}</span>` : ""}${pt ? `<span>Pressure ${esc(pt.word)}</span>` : ""}`;
  }
  $("fsNow").addEventListener("click", () => { if (window.tfPanelScrollTo) window.tfPanelScrollTo($("fsCond")); });

  // ---------- where to fish today ----------
  function renderToday() {
    const el = $("fsToday");
    if (!spot || (!stocked && !gauges)) { el.innerHTML = ""; return; }
    const R = 60, cand = [];
    for (const [w, d] of near(stocked ? stocked.waters : [], spot.lat, spot.lon, R, (x) => x.c)) {
      const fd = freshDays(w), planned = w.r.find((r) => /planned/.test(r[0]) && r[0].startsWith(String(new Date().getFullYear())));
      let s = fd == null ? 0.5 : fd <= 14 ? 3 : fd <= 45 ? 2 : fd <= 365 ? 1 : 0.3;
      if (planned && !fd) s += 0.5;
      const why = fd == null ? (planned ? "Stocking planned this year" : "Stocked in recent years") : `Stocked ${fd <= 0 ? "today" : fd === 1 ? "yesterday" : fd < 60 ? `${fd} days ago` : `${Math.round(fd / 30)} months ago`}${stocked.sp[w.r[0][1]] ? `, ${stocked.sp[w.r[0][1]].toLowerCase()}` : ""}`;
      cand.push({ name: w.n, lat: w.c[0], lon: w.c[1], d, s: s - d / 40, why, c: fd != null && fd <= 30 ? C.fresh : C.stocked, open: () => openWater(w) });
    }
    for (const [g, d] of near(gauges || [], spot.lat, spot.lon, R, (x) => [x[2], x[3]])) {
      const l = lightOf(g, readings.get(g[0]));
      if (l === "none") continue;
      const s = { ok: 2.2, low: 1.4, vlow: 0.3, high: 0.6, blown: -2 }[l];
      cand.push({ name: g[1], lat: g[2], lon: g[3], d, s: s - d / 40, why: `River ${LIGHTS[l][0].toLowerCase()}`, c: LIGHTS[l][1], open: () => openGauge(g) });
    }
    cand.sort((a, b) => b.s - a.s);
    const top = cand.filter((x) => x.s > 0).slice(0, 6), day = castDays()[0];
    const row = (x, i) => `<li style="--c:${x.c}"><button type="button" class="fs-go" data-i="${i}"><b>${esc(x.name)}</b><small>${esc(x.why)}</small><em>${fmtKm(x.d)}</em></button></li>`;
    el.innerHTML = `<header>${svg(IC.star)}<h3>Where to fish today</h3>${day ? stars(day.s) : ""}</header>
      ${top.length ? `<ul class="fs-list fs-top">${top.slice(0, 3).map(row).join("")}</ul>
        ${top.length > 3 ? `<details class="fs-more"><summary>${top.length - 3} more</summary><ul class="fs-list fs-top">${top.slice(3).map((x, i) => row(x, i + 3)).join("")}</ul></details>` : ""}
        <p class="fs-note">Near ${spot.how === "you" ? "you" : spot.how === "tap" ? "the spot" : "the map"}: fresh stocking and good flows first.</p>`
        : `<p class="fs-note">Nothing stocked or with a river reading within ${R} km. Move the map or zoom in.</p>`}`;
    el.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => { const x = top[+b.dataset.i]; map.setView([x.lat, x.lon], Math.max(map.getZoom(), 12)); x.open(); }));
  }

  // ---------- hatch chart ----------
  // What's usually on the water each month, by part of Canada (from the common hatch charts fly shops publish; local
  // timing moves with elevation and the year's weather). [name, first month, last month (1 to 12), flies, where]
  const HATCH = {
    coast: [["Midges and chironomids", 1, 12, "Chironomid pupa under an indicator, Griffith's gnat", "lakes all year, best March to June"],
      ["Blue-winged olives", 2, 5, "Parachute BWO #18-20, pheasant tail nymph", "rivers, cloudy days"], ["Blue-winged olives", 10, 11, "Parachute BWO #18-20", "rivers"],
      ["March browns", 3, 5, "March brown dry #12-14, hare's ear nymph", "rivers, early afternoon"], ["Salmon fry", 3, 5, "Rolled muddler, fry patterns", "rivers and estuaries (cutthroat)"],
      ["Caddis", 5, 9, "Elk hair caddis #14-16, soft hackles", "evenings"], ["Stoneflies (yellow sally)", 6, 8, "Yellow sally #14, stimulator", "rivers"],
      ["Damselflies", 5, 7, "Damsel nymph", "lakes, weed edges"], ["Salmon eggs and flesh", 9, 12, "Egg patterns, flesh flies", "rivers with salmon runs (trout and char behind the spawners)"],
      ["Coho and pinks", 8, 11, "Clouser minnow, pink or chartreuse", "estuaries and beaches"]],
    west: [["Midges and chironomids", 1, 12, "Zebra midge, chironomid pupa", "tailwaters all year; lakes after ice-off"],
      ["Skwala stoneflies", 3, 4, "Skwala dry #8-10", "Bow, Kootenay, Elk"], ["Blue-winged olives", 3, 5, "Parachute BWO #18-22", "rivers"], ["Blue-winged olives", 9, 11, "Parachute BWO #18-22", "rivers, cool afternoons"],
      ["Salmonflies", 6, 6, "Big orange stonefly dry, rubber legs", "freestone rivers, as runoff drops"], ["Golden stoneflies", 6, 8, "Golden stimulator #8-10", "freestone rivers"],
      ["Green drakes", 6, 7, "Green drake #10-12", "Bow, Crowsnest, Elk"], ["Pale morning duns", 6, 8, "PMD parachute #16, sparkle dun", "rivers, late morning"],
      ["Caddis", 5, 9, "Elk hair caddis #14-16", "evenings"], ["Traveller sedges", 6, 7, "Tom Thumb, sedge pupa", "interior BC lakes"],
      ["Damselflies and dragonflies", 5, 8, "Damsel nymph, dragon nymph", "lakes"], ["Callibaetis", 6, 9, "Callibaetis spinner #14-16", "lakes, calm afternoons"],
      ["Hoppers and ants", 7, 9, "Hopper, foam ant, beetle", "grassy banks, windy afternoons"], ["October caddis", 9, 10, "Orange stimulator #8-10", "rivers"]],
    prairie: [["Midges and chironomids", 1, 12, "Chironomid pupa, bloodworm", "lakes and ponds"], ["Leeches and scuds", 4, 10, "Leech, scud", "stocked ponds and lakes"],
      ["Damselflies", 5, 7, "Damsel nymph", "weedy lakes"], ["Caddis", 5, 9, "Elk hair caddis", "evenings"], ["Tricos", 7, 9, "Trico spinner #20-22", "rivers, early morning"],
      ["Hoppers", 7, 9, "Hopper, ant", "rivers and creeks"], ["Pike and walleye baitfish", 5, 10, "Streamers, spoons, jigs", "lakes and rivers"]],
    east: [["Midges", 1, 12, "Midge pupa, Griffith's gnat", "all year"], ["Smelt and baitfish", 4, 5, "Grey ghost, smelt streamers", "after ice-out (brook trout, landlocked salmon)"],
      ["Hendricksons", 4, 5, "Hendrickson #12-14", "rivers, early afternoon"], ["Black caddis (grannom)", 4, 5, "Black caddis #16", "rivers"],
      ["Blue-winged olives", 4, 5, "BWO #18-20", "rivers"], ["Blue-winged olives", 9, 10, "BWO #18-20", "rivers"],
      ["March browns", 5, 6, "March brown #10-12", "rivers"], ["Sulphurs", 5, 7, "Sulphur dun #16, evening"], ["Green drakes (Ephemera)", 6, 6, "Coffin fly, green drake #8-10", "rivers and lakes, evenings"],
      ["Hexagenia (hex)", 6, 7, "Hex dun #4-8", "lakes and slow rivers, after dark"], ["Isonychia", 6, 10, "Isonychia nymph, slate drake", "rivers"],
      ["Tricos", 7, 9, "Trico spinner #22-24", "rivers, early morning"], ["Terrestrials", 7, 9, "Ants, beetles, hoppers", "summer"], ["Bass and pike", 6, 9, "Poppers, frogs, streamers", "warm lakes"]],
    north: [["Midges", 5, 9, "Midge pupa", "lakes"], ["Caddis", 6, 8, "Elk hair caddis", "rivers"], ["Mosquitoes", 6, 7, "Mosquito #14-16", "everywhere"],
      ["Grayling dries", 6, 9, "Parachute Adams, elk hair caddis", "clear rivers"], ["Lake trout and pike", 6, 9, "Spoons, big streamers", "lakes after ice-out"]],
  };
  function hatchRegion(lat, lon) {
    if (lat > 60) return "north";
    if (lon > -95) return "east";
    if (lon < -121 && lat < 55.5) return "coast";
    if (lon > -113.5 || (lon > -116 && lat > 54)) return "prairie";
    return "west";
  }
  // Names of what's hatching this month at a spot (for the fly picks).
  const hatchNow = (lat, lon) => { const m = new Date().getMonth() + 1; return HATCH[hatchRegion(lat, lon)].filter((h) => (h[1] <= h[2] ? m >= h[1] && m <= h[2] : m >= h[1] || m <= h[2])).map((h) => h[0]); };
  function renderHatch() {
    const el = $("fsHatch");
    if (!spot) { el.innerHTML = ""; return; }
    const reg = hatchRegion(spot.lat, spot.lon), m = new Date().getMonth() + 1, nx = (m % 12) + 1;
    const inM = (h, x) => (h[1] <= h[2] ? x >= h[1] && x <= h[2] : x >= h[1] || x <= h[2]);
    const now = HATCH[reg].filter((h) => inM(h, m)), soon = HATCH[reg].filter((h) => inM(h, nx) && !inM(h, m));
    const names = { coast: "the coast", west: "the BC interior and the Rockies", prairie: "the prairies", east: "Ontario, Quebec and the east", north: "the north" };
    el.innerHTML = `<header>${svg(IC.bug)}<h3>Hatch chart: ${esc(MONTHS[m - 1])}</h3></header>
      ${now.length ? `<div class="fs-chips">${now.map((h) => `<span class="fs-chip" style="--c:${ACC}">${esc(h[0])}</span>`).join("")}</div>
        ${fold("flies", IC.bug, "Flies to try", "", `<ul class="fs-list fs-hatch">${now.map((h) => `<li style="--c:${ACC}"><b>${esc(h[0])}</b><small>${esc(h[3])}${h[4] ? ` · ${esc(h[4])}` : ""}</small></li>`).join("")}</ul>
        ${soon.length ? `<p class="fs-note"><b>Coming in ${esc(MONTHS[nx - 1])}:</b> ${esc(soon.map((h) => h[0]).join(", "))}.</p>` : ""}
        <p class="fs-note">The usual timing for ${esc(names[reg])}; it moves with elevation and the weather.</p>`)}` : `<p class="fs-note">Not much hatching this month: try nymphs, streamers or ice fishing.</p>`}`;
  }

  // ---------- quick actions ----------
  pane.querySelector(".fs-actions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, P = window.tfPoints;
    if (act === "me") locate(b);
    else if (act === "bait") { const h = $("fsHatch"); if (h) { h.querySelectorAll("details").forEach((d) => { d.open = true; }); if (window.tfPanelScrollTo) window.tfPanelScrollTo(h); } }   // phones (the log lives in Saved)
    else if (!P) hint("Points aren't available in this browser.");
    else if (act === "catch") { if (P.addCatch) P.addCatch(); else P.add(); }
    else if (act === "truck") truckMenu(b);
    else if (act === "log") P.openLog();
  });
  function truckMenu(b) {
    const P = window.tfPoints, old = $("fsTruck");
    if (old) { old.remove(); return; }
    if (!P.hasTruck || !P.hasTruck()) { P.markTruck(b); return; }
    const m = document.createElement("div");
    m.id = "fsTruck"; m.className = "fs-chips";
    m.innerHTML = `<button type="button" class="fs-pill" data-t="back">${svg(IC.back, 16)} Back to truck</button><button type="button" class="fs-pill" data-t="move">Truck is here now</button>`;
    m.addEventListener("click", (e) => {
      const t = e.target.closest("[data-t]"); if (!t) return;
      m.remove();
      if (t.dataset.t === "back") P.backToTruck(b); else P.markTruck(b);
    });
    pane.querySelector(".fs-actions").after(m);
  }

  // For ski-points.js: what the conditions were when a catch is saved (the catch log keeps them, for patterns later).
  window.tfFish = {
    async snapshot(lat, lon) {
      const out = {};
      try {
        let w = wx && wx.current && spot && km(lat, lon, spot.lat, spot.lon) < 30 ? wx : null, sw = w ? sea : null;
        if (!w) {   // a catch away from the spot on the panel: the weather right there
          const p = new URLSearchParams({ latitude: lat.toFixed(3), longitude: lon.toFixed(3), timezone: "auto", past_days: "1", forecast_days: "1", wind_speed_unit: "kmh",
            current: "temperature_2m,wind_speed_10m,wind_direction_10m,pressure_msl,weather_code", hourly: "pressure_msl" });
          w = await getJ(`https://api.open-meteo.com/v1/forecast?${p}`, 8000).catch(() => null);
          if (w && nearestTide(lat, lon, 40)) sw = await getJ(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=sea_surface_temperature&timezone=auto`, 8000).then((m) => m.current).catch(() => null);
        }
        if (w && w.current) {
          const c = w.current, pt = pressureTrend(w);
          Object.assign(out, { air: Math.round(c.temperature_2m), wind: Math.round(c.wind_speed_10m), dir: compass(c.wind_direction_10m), hpa: Math.round(c.pressure_msl), trend: pt ? pt.word : "", sky: WX[c.weather_code] || "" });
          if (sw && sw.sea_surface_temperature != null) out.sea = Math.round(sw.sea_surface_temperature);
        }
        const ph = moonPhase(new Date()); out.moon = (PHASES.find((x) => ph.phase < x[0]) || PHASES[0])[1];
        const [g] = near(gauges || [], lat, lon, 10, (x) => [x[2], x[3]])[0] || [];
        if (g) { const r = readings.get(g[0]), l = lightOf(g, r); out.river = g[1]; out.flow = LIGHTS[l][0]; if (r && r.q != null) out.q = r.q; }
        const nt = nearestTide(lat, lon, 25);
        if (nt) {   // where the tide is: rising or falling, and how long since the last turn
          const hl = await tidesAt(nt.t[0]), t = Date.now(), prev = hl.filter((x) => x[0] <= t).pop(), next = hl.find((x) => x[0] > t);
          if (prev && next) { const h = Math.round((t - prev[0]) / 36e5 * 2) / 2; out.tide = `${next[1] > prev[1] ? "Rising" : "Falling"}, ${h} h after ${next[1] > prev[1] ? "low" : "high"}`; }
        }
        const s = skyDay(lat, lon), t = Date.now();
        out.light = s.rise && s.set ? (t < s.rise - 3600e3 || t > s.set.valueOf() + 3600e3 ? "Dark" : t < s.rise.valueOf() + 2 * 3600e3 ? "Morning" : t > s.set - 2 * 3600e3 ? "Evening" : "Midday") : "";
      } catch {}
      return out;
    },
    show(lat, lon, name) {   // the 🔔's fresh stocking (notify.js): Fishing, at that water, with its card open
      const sel = document.getElementById("sport");
      if (sel && sel.value !== "fish") { sel.value = "fish"; sel.dispatchEvent(new Event("change")); }
      map.setView([lat, lon], Math.max(map.getZoom(), 12));
      setSpot(lat, lon, "tap"); showSpot(lat, lon, name);
    },
    // Ask in plain words (ask.js): stocked waters within maxKm, nearest first, with what was put in them and when last.
    async stockedNear(lat, lon, maxKm) {
      await ready;
      if (!stocked) return [];
      return near(stocked.waters, lat, lon, maxKm, (w) => w.c).map(([w, d]) => ({ n: w.n, c: w.c, d, last: w.r[0] && w.r[0][0],
        sp: [...new Set(w.r.map((r) => stocked.sp[r[1]]).filter(Boolean))] }));
    },
    species(lat, lon) {   // likely species for the catch form: stocked here, then the usual list
      const list = [];
      if (stocked) for (const [w] of near(stocked.waters, lat, lon, 3, (x) => x.c)) for (const r of w.r) list.push(stocked.sp[r[1]]);
      return [...new Set(list.filter(Boolean))];
    },
  };

  // ---------- 3D map (map3d.js) ----------
  // map3d.js copies Leaflet lines (the zone outlines), not dots: the gauge, stocking, tide and access dots and the spot
  // pin are added here; a tap on a dot opens it, a tap elsewhere picks a spot as on the flat map.
  let gl3 = null, spot3 = null, applyWait = false;
  function sync3d() {
    const gl = gl3;
    if (!gl || !window.maplibregl) return;
    const apply = () => {
      if (!gl.getStyle()) return;
      const data = { type: "FeatureCollection", features: isFish() ? pts3d.map((p, i) => ({ type: "Feature", properties: { i, c: p.color, r: p.r, n: p.label || "" }, geometry: { type: "Point", coordinates: [p.lon, p.lat] } })) : [] };
      if (!gl.getSource("fs-pts")) {
        gl.addSource("fs-pts", { type: "geojson", data });
        gl.addLayer({ id: "fs-pts", type: "circle", source: "fs-pts", paint: { "circle-color": ["get", "c"], "circle-radius": ["get", "r"], "circle-stroke-color": "#fff", "circle-stroke-width": 2, "circle-pitch-alignment": "viewport" } });
      } else gl.getSource("fs-pts").setData(data);
      // Zone and park fills and names (map3d.js brings over only their outlines), from what drawZones put on the flat map.
      const fills = [], names = [];
      if (isFish()) {
        zoneLayer.eachLayer((l) => fills.push({ type: "Feature", properties: { c: l.options.fillColor, o: Math.min(0.35, l.options.fillOpacity * 1.6) },
          geometry: { type: "MultiPolygon", coordinates: ((r) => (Array.isArray(r[0]) ? r : [r]))(l.getLatLngs()).filter((r) => r.length > 2).map((r) => [[...r, r[0]].map((q) => [q.lng, q.lat])]) } }));
        labelLayer.eachLayer((m) => { const sp = m.options.icon.options.html.match(/--c:([^"]+)">([^<]*)</); if (sp) names.push({ type: "Feature", properties: { c: sp[1], t: sp[2].replace(/&amp;/g, "&") }, geometry: { type: "Point", coordinates: [m.getLatLng().lng, m.getLatLng().lat] } }); });
      }
      const under = gl.getLayer("osm-roads") ? "osm-roads" : undefined;
      if (!gl.getSource("fs-fill")) {
        gl.addSource("fs-fill", { type: "geojson", data: { type: "FeatureCollection", features: fills } });
        gl.addLayer({ id: "fs-fill", type: "fill", source: "fs-fill", paint: { "fill-color": ["get", "c"], "fill-opacity": ["get", "o"] } }, under);
        gl.addSource("fs-names", { type: "geojson", data: { type: "FeatureCollection", features: names } });
        gl.addLayer({ id: "fs-names", type: "symbol", source: "fs-names", layout: { "text-field": ["get", "t"], "text-font": ["Noto Sans Bold"], "text-size": 13 },
          paint: { "text-color": ["get", "c"], "text-halo-color": "#fff", "text-halo-width": 2 } });
      } else { gl.getSource("fs-fill").setData({ type: "FeatureCollection", features: fills }); gl.getSource("fs-names").setData({ type: "FeatureCollection", features: names }); }
      overlays3d(gl, gl.getLayer("fs-fill") ? "fs-fill" : under);
      if (isFish() && spot && spot.how !== "centre") {
        if (!spot3) { const el = document.createElement("div"); el.className = "fs-spot"; el.style.margin = "0"; spot3 = new maplibregl.Marker({ element: el }); }
        spot3.setLngLat([spot.lon, spot.lat]).addTo(gl);
      } else if (spot3) spot3.remove();
    };
    if (gl.style && (gl.style._loaded || gl.isStyleLoaded())) apply();
    else if (!applyWait) {
      applyWait = true;
      const go = () => { if (!applyWait) return; applyWait = false; apply(); };
      gl.once("style.load", go); gl.once("load", go); gl.once("idle", go);
    }
  }
  // The water colours, lake depth lines and Crown land on the 3D map: the flat map draws them in MapLibre maps and
  // tiles of its own, which the 3D map doesn't copy. Under the zone fills and the dots.
  let depth3Ver = -1, crownProto = false;
  function overlays3d(gl, before) {
    const fish = isFish();
    const vis = (id, on) => { if (gl.getLayer(id) && gl.getLayoutProperty(id, "visibility") !== (on ? "visible" : "none")) gl.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
    if (fish && HL.some((k) => shown.has(k)) && !gl.getLayer("fs3-" + WATER[0].id)) {
      const src = gl.getSource("names") ? "names" : "fs3-w";   // map3d.js's place names come from the same OpenFreeMap tiles
      if (!gl.getSource(src)) gl.addSource(src, OFM);
      for (const l of WATER) gl.addLayer(glLayer(l, false, "fs3-", src), before);
    }
    for (const l of WATER) vis("fs3-" + l.id, fish && shown.has(l.k));
    const dOn = fish && shown.has("depth");
    if (dOn && !gl.getSource("fs3-q")) {
      const st = depthStyle();
      gl.addSource("fs3-q", st.sources.q); gl.addSource("fs3-mb", st.sources.mb); depth3Ver = -1;
      for (const l of st.layers) gl.addLayer({ ...l, id: "fs3-" + l.id, source: "fs3-" + l.source }, before);
    }
    if (gl.getSource("fs3-q")) {
      if (dOn && depth3Ver !== depthVer) { depth3Ver = depthVer; gl.getSource("fs3-q").setData({ type: "FeatureCollection", features: depthFeats }); }
      for (const l of depthStyle().layers) vis("fs3-" + l.id, dOn && map.getZoom() >= DEPTH_ZOOM - 1);
    }
    const T = window.tfCrown, cOn = fish && shown.has("crown") && T;
    if (cOn && !gl.getSource("fs3-cl-" + T.SRC[0].id)) {
      // Quebec's server can't take our colours: its pictures are repainted ours (tfCrown.tint) through a made-up address.
      if (!crownProto && window.maplibregl.addProtocol) {
        crownProto = true;
        window.maplibregl.addProtocol("fscrown", async (p) => {
          const [, id, z, x, y] = p.url.match(/^fscrown:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)/);
          const img = await T.tint(T.SRC.find((q) => q.id === id), +z, +x, +y);
          const cv = new OffscreenCanvas(256, 256); cv.getContext("2d").putImageData(img, 0, 0);
          return { data: await (await cv.convertToBlob()).arrayBuffer() };
        });
      }
      for (const q of T.SRC) {
        if (q.tint && !crownProto) continue;
        const [[s0, w0], [n0, e0]] = T.bounds(q);
        const tiles = [q.tint ? `fscrown://${q.id}/{z}/{x}/{y}` : T.url(q, 0, 0, 0).replace(/bbox=[^&]*/, "bbox={bbox-epsg-3857}")];
        gl.addSource("fs3-cl-" + q.id, { type: "raster", tiles, tileSize: 256, minzoom: q.min, maxzoom: 20, bounds: [w0, s0, e0, n0] });
        gl.addLayer({ id: "fs3-cl-" + q.id, type: "raster", source: "fs3-cl-" + q.id, minzoom: q.min, paint: { "raster-opacity": q.kind === "private" ? 0.36 : 0.26 } }, before);
      }
    }
    if (T) for (const q of T.SRC) vis("fs3-cl-" + q.id, cOn);
  }
  // This file loads the first time Fishing is picked (winter.js), often after the 3D map was built: take that one too.
  const on3d = (e) => {
    gl3 = e.detail;
    gl3.on("click", (ev) => {
      if (!isFish() || document.querySelector(".app.riding, .app.planning") || document.body.classList.contains("sp-picking")) return;
      const hit = gl3.getLayer("fs-pts") && gl3.queryRenderedFeatures([[ev.point.x - 8, ev.point.y - 8], [ev.point.x + 8, ev.point.y + 8]], { layers: ["fs-pts"] })[0];
      if (hit) { const p = pts3d[hit.properties.i]; if (p) p.open(); return; }
      if (gl3.getLayer("hits") && gl3.queryRenderedFeatures(ev.point, { layers: ["hits"] }).length) return;
      setSpot(ev.lngLat.lat, ev.lngLat.lng, "tap");
      showSpot(ev.lngLat.lat, ev.lngLat.lng);
    });
    sync3d();
  };
  window.addEventListener("tf:map3d", on3d);

  // ---------- switching sport ----------
  map.on("click", (e) => {
    if (!isFish() || document.querySelector(".app.riding, .app.planning") || document.body.classList.contains("sp-picking") || document.body.classList.contains("cp-on")) return;
    setSpot(e.latlng.lat, e.latlng.lng, "tap");
    showSpot(e.latlng.lat, e.latlng.lng);
  });
  let moveTimer = 0;
  map.on("moveend", () => {
    if (!isFish()) return;
    drawPoints();
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      loadReadings(); loadAccess();
      if (!spot || spot.how === "centre") { const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); }
    }, 600);
  });
  map.on("zoomend moveend", () => { if (isFish()) renderLayers(); });
  let started = false;
  function sync() {
    const on = isFish();
    for (const l of allFish) { if (on && !map.hasLayer(l)) l.addTo(map); else if (!on && map.hasLayer(l)) map.removeLayer(l); }
    if (on && !keyCtl._map) keyCtl.addTo(map); else if (!on && keyCtl._map) keyCtl.remove();
    syncTiles(); syncWater();
    if (!on) { drawPoints(); return; }
    if (!started) { started = true; renderLayers(); ready.then(() => { drawPoints(); renderToday(); }); }
    drawZones(); drawPoints(); loadReadings(); loadAccess();
    if (!spot) { const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); } else { loadWeather(); renderToday(); renderHatch(); }
  }
  window.addEventListener("tf:sport", sync);
  sync();

  if (window.trailMap3d) on3d({ detail: window.trailMap3d });
})();
