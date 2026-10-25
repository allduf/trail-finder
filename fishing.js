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
//    (BC), fishing zones.
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
  const C = { vlow: "#f59f00", low: "#94d82d", ok: "#2f9e44", high: "#f76707", blown: "#e03131", none: "#868e96", stocked: "#1971c2", fresh: "#e64980",
    access: "#9775fa", launch: "#a0522d", tide: "#0b7285", zone: "#1864ab" };
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
  };

  // ---------- map layers ----------
  const LAYERS = {
    gauges: { g: "Water", label: "River flow gauges", sub: "Live flow, coloured from too low to blown out", on: true, minZoom: 7, icon: [C.ok, "dot"] },
    stocked: { g: "Water", label: "Stocked lakes and rivers", sub: "Pink: stocked in the last 30 days", on: true, minZoom: 6, icon: [C.stocked, "dot"] },
    depth: { g: "Water", label: "Lake depth lines (BC)", sub: "About 2,600 surveyed lakes", minZoom: 12, icon: ["#1c7ed6", "line"] },
    access: { g: "Access", label: "Fishing spots", sub: "Public spots, piers and docks all over Canada", on: true, minZoom: 8, icon: [C.access, "dot"] },
    launch: { g: "Access", label: "Boat launches", sub: "Public ramps all over Canada", on: true, minZoom: 8, icon: [C.launch, "dot"] },
    tides: { g: "Ocean", label: "Tide stations", sub: "Tap one for the next high and low tides", on: true, minZoom: 6, icon: [C.tide, "dot"] },
    zones: { g: "Rules", label: "Fishing zones and regions", sub: "The areas the rules are written for", icon: [C.zone, "dash"] },
  };
  const GROUPS = ["Water", "Access", "Ocean", "Rules"];
  const VIEWS = {
    river: { label: "Rivers", sub: "flow, spots", layers: ["gauges", "access", "launch", "zones"] },
    lake: { label: "Lakes", sub: "stocked, depth", layers: ["stocked", "depth", "access", "launch"] },
    ocean: { label: "Ocean", sub: "tides, areas", layers: ["tides", "access", "launch", "zones"] },
  };
  let shown = new Set(store.get("fishLayers", Object.keys(LAYERS).filter((k) => LAYERS[k].on)));
  if (shown.has("access") && !store.get("fishLaunch", false)) { shown.add("launch"); store.set("fishLaunch", true); }   // launches were part of "access" before they got their own switch

  // ---------- look ----------
  const css = document.createElement("style");
  css.textContent = `
body:not(.sport-fish) #fishPane, body:not(.sport-fish) .lm-fish { display: none !important; }
body.sport-fish .leaflet-allTrails-pane, body.sport-fish .leaflet-boxTrails-pane, body.sport-fish .leaflet-newTrails-pane, body.sport-fish .leaflet-onewayArrows-pane,
body.sport-fish .leaflet-ridesPane-pane { display: none; }
.lm-fish { display: flex; flex-direction: column; }
.lm-fish .fs-group { margin: 0; font-size: .66rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding-top: 6px; }
:is(#fishPane, .lm-fish) .fs-layer { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: center; padding: 5px 0; cursor: pointer; }
:is(#fishPane, .lm-fish) .fs-layer b { display: block; font-size: .86rem; }
:is(#fishPane, .lm-fish) .fs-layer small { display: block; color: var(--muted); font-size: .74rem; line-height: 1.25; }
:is(#fishPane, .lm-fish) .fs-layer small.z { color: ${ACC}; }
:is(#fishPane, .lm-fish) .fs-ic { width: 22px; height: 22px; border-radius: 6px; display: block; box-sizing: border-box; }
:is(#fishPane, .lm-fish) .fs-sw { appearance: none; -webkit-appearance: none; width: 40px; height: 24px; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; margin: 0; flex: none; transition: background .15s; }
:is(#fishPane, .lm-fish) .fs-sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px #0004; transition: left .15s; }
:is(#fishPane, .lm-fish) .fs-sw:checked { background: ${ACC}; }
:is(#fishPane, .lm-fish) .fs-sw:checked::after { left: 19px; }
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
#fishPane .fs-views { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
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
.fs-mapkey .fs-keybox i { display: inline-block; width: 11px; height: 11px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
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
    </div>
    <button type="button" class="fs-now" id="fsNow" hidden></button>
    <div class="fs-card" id="fsSpot" hidden></div>
    <div class="fs-card" id="fsToday"></div>
    <div class="fs-card" id="fsMap"><header>${svg(IC.layers)}<h3>Map</h3></header>
      <div class="fs-views" role="group" aria-label="Map views">${Object.entries(VIEWS).map(([k, v]) => `<button type="button" class="fs-view" data-view="${k}">${esc(v.label)}<small>${esc(v.sub)}</small></button>`).join("")}</div>
      <button type="button" class="fs-pill" id="fsAll">${svg(IC.layers, 16)}All fishing layers</button></div>
    <div class="fs-card" id="fsCond"></div>
    <div class="fs-card" id="fsHatch"></div>
    <details class="fs-safe"><summary>A guide, not the law</summary>Rules, zones, stocking and river flows come from each province's and Canada's open data and can be late or simplified. Always check your province's fishing regulations and any in-season changes before you fish, and buy the licence you need (a tidal licence for the ocean).</details>`;
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
      .then((j) => { for (const z of j.zones || []) z.g = decode(z.g); return j; })
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
  const loadZones = () => (zones ? Promise.resolve(zones) : load("zones").then((j) => (zones = j.zones)).catch(() => []));

  // The province for links when no zone file covers the spot (rough lines, only to pick which rules to point to).
  function provinceAt(lat, lon, zs) {
    const k = zs.find((z) => ["bc", "ab", "on", "qc"].includes(z.k));
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
  const fmtQ = (q) => `${q < 10 ? q.toFixed(1) : Math.round(q)} m³/s`;
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
      for (const [lat, lon, k, name, facts, src] of j.spots || []) access.set(`${lat},${lon},${k}`, { lat, lon, kind: KIND[k] || "fishing", name: name || "", facts: facts || "", src: src === "on" ? "Ontario" : "OpenStreetMap" });
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
    pane: "fishTiles", minZoom: 12, maxZoom: 19, opacity: 0.85, attribution: "Lake depth: DataBC (OGL-BC)" });
  const allFish = [ptLayer, zoneLayer, spotLayer];
  const pts3d = [];   // the same points for the 3D map
  const freshDays = (w) => { const d = w.r.find((r) => /^\d{4}-\d\d-\d\d$/.test(r[0])); return d ? daysAgo(d[0]) : null; };
  function drawPoints() {
    ptLayer.clearLayers(); pts3d.length = 0;
    if (!isFish()) return;
    const z = map.getZoom(), b = map.getBounds().pad(0.4);
    const dot = (lat, lon, color, r, open, label, kind) => {
      const m = L.circleMarker([lat, lon], { renderer, radius: r, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1, bubblingMouseEvents: false }).on("click", (e) => { L.DomEvent.stop(e); open(); });
      if (label) m.bindTooltip(label, { direction: "top", offset: [0, -r], opacity: 0.95 });
      ptLayer.addLayer(m);
      pts3d.push({ lat, lon, color, r, open, label, kind });
    };
    if (shown.has("stocked") && stocked && z >= LAYERS.stocked.minZoom) {
      for (const w of stocked.waters) {
        if (!b.contains([w.c[0], w.c[1]])) continue;
        const d = freshDays(w);
        dot(w.c[0], w.c[1], d != null && d <= 30 ? C.fresh : C.stocked, z >= 11 ? 7 : 5, () => openWater(w), `${w.n}${d != null ? ` · stocked ${d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`}` : ""}`, "stocked");
      }
    }
    if (shown.has("gauges") && gauges && z >= LAYERS.gauges.minZoom) {
      for (const g of gauges) {
        if (!b.contains([g[2], g[3]])) continue;
        const r = readings.get(g[0]), l = lightOf(g, r);
        dot(g[2], g[3], LIGHTS[l][1], z >= 10 ? 8 : 6, () => openGauge(g), `${g[1]} · ${LIGHTS[l][0]}`, "gauge");
      }
    }
    if (shown.has("tides") && tides && z >= LAYERS.tides.minZoom) {
      for (const t of tides) if (b.contains([t[2], t[3]])) dot(t[2], t[3], C.tide, z >= 10 ? 7 : 5, () => openTide(t), `Tides: ${t[1]}`, "tide");
    }
    if ((shown.has("access") || shown.has("launch")) && z >= LAYERS.access.minZoom) {
      for (const a of access.values()) if (shown.has(a.kind === "launch" ? "launch" : "access") && b.contains([a.lat, a.lon])) dot(a.lat, a.lon, a.kind === "launch" ? C.launch : C.access, 6, () => openAccess(a), accessName(a), "access");
    }
    sync3d();
  }
  const accessName = (a) => a.name || (a.kind === "launch" ? "Boat launch" : a.kind === "pier" ? "Fishing pier" : "Fishing spot");
  function drawZones() {
    zoneLayer.clearLayers();
    if (!isFish() || !shown.has("zones")) return;
    loadZones().then((zs) => {
      if (!isFish() || !shown.has("zones")) return;
      zoneLayer.clearLayers();
      for (const z of zs) {
        const ll = z.g.map((r) => { const o = []; for (let i = 0; i < r.length; i += 2) o.push([r[i], r[i + 1]]); return o; });
        L.polygon(ll, { pane: "fishLines", color: z.k === "pfma" ? C.tide : C.zone, weight: 1.6, opacity: 0.75, dashArray: "6 5", fill: false, interactive: false, smoothFactor: 1.5 }).addTo(zoneLayer);
      }
      sync3d();
    });
  }
  function syncTiles() {
    const want = isFish() && shown.has("depth");
    if (want && !map.hasLayer(depthTiles)) depthTiles.addTo(map); else if (!want && map.hasLayer(depthTiles)) map.removeLayer(depthTiles);
  }

  // ---------- layer list ----------
  const icon = ([c, kind]) => kind === "line" ? `<span class="fs-ic" style="border:3px solid ${c};border-radius:50%"></span>` : kind === "dash" ? `<span class="fs-ic" style="border:3px dashed ${c}"></span>`
    : `<span class="fs-ic" style="background:radial-gradient(circle, ${c} 0 45%, transparent 47%)"></span>`;
  function renderLayers() {
    const z = map.getZoom();
    $("fsLayerList").innerHTML = GROUPS.map((g) => `<h4 class="fs-group">${g}</h4>` + Object.entries(LAYERS).filter(([, l]) => l.g === g).map(([k, l]) => {
      const on = shown.has(k), far = on && l.minZoom && z < l.minZoom;
      return `<label class="fs-layer">${icon(l.icon)}<span><b>${esc(l.label)}</b><small${far ? ' class="z"' : ""}>${far ? "Zoom in closer to see it" : esc(l.sub)}</small></span><input type="checkbox" class="fs-sw" role="switch" data-k="${k}"${on ? " checked" : ""} aria-label="${esc(l.label)}"></label>`;
    }).join("")).join("");
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
    shown = new Set(VIEWS[b.dataset.view].layers);
    applyLayers();
    if (hlKind === b.dataset.view) clearWater(); else highlightWater(b.dataset.view);
  });

  // ---------- water highlight ----------
  // Picking Rivers, Lakes or Ocean colours every river, lake or the sea on the map (alex 2026-10-25), from the same
  // OpenFreeMap vector tiles as the Vector base map (OpenStreetMap water, all of Canada). A tap on the map clears it.
  const OFM = { type: "vector", url: "https://tiles.openfreemap.org/planet" };
  const WATER = {
    river: [
      { id: "riv-area", type: "fill", source: "w", "source-layer": "water", filter: ["==", ["get", "class"], "river"], paint: { "fill-color": "#15d1ff", "fill-opacity": 0.75 } },
      { id: "riv-line", type: "line", source: "w", "source-layer": "waterway", filter: ["in", ["get", "class"], ["literal", ["river", "stream", "canal"]]], layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#15d1ff", "line-width": ["interpolate", ["linear"], ["zoom"], 6, ["match", ["get", "class"], "river", 1.6, 0.6], 10, ["match", ["get", "class"], "river", 3, 1.4], 14, ["match", ["get", "class"], "river", 5, 2.6]] } },
    ],
    lake: [
      { id: "lake", type: "fill", source: "w", "source-layer": "water", filter: ["in", ["get", "class"], ["literal", ["lake", "pond"]]], paint: { "fill-color": "#12d6b4", "fill-opacity": 0.8 } },
    ],
    ocean: [
      { id: "sea", type: "fill", source: "w", "source-layer": "water", filter: ["==", ["get", "class"], "ocean"], paint: { "fill-color": "#2f7bff", "fill-opacity": 0.7 } },
    ],
  };
  let hl = null, hlKind = null;
  if (!map.getPane("fishWater")) { map.createPane("fishWater").style.zIndex = 350; map.getPane("fishWater").style.pointerEvents = "none"; }
  async function highlightWater(kind) {
    clearWater();
    hlKind = kind;
    try { await window.tfLoadVectorLib(); } catch { hlKind = null; return; }
    if (hlKind !== kind || !isFish()) return;
    hl = L.maplibreGL({ pane: "fishWater", interactive: false, attributionControl: false,
      style: { version: 8, sources: { w: OFM }, layers: WATER[kind] } }).addTo(map);
  }
  function clearWater() { hlKind = null; if (hl) { map.removeLayer(hl); hl = null; } }
  map.on("click", () => { if (hlKind) clearWater(); });
  function applyLayers() {
    store.set("fishLayers", [...shown]);
    renderLayers(); renderKey(); syncTiles(); drawZones(); drawPoints(); loadReadings(); loadAccess();
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
    const i = (c) => `<i style="background:${c}"></i>`;
    box.innerHTML = (shown.has("gauges") ? `<b>River gauges: flow for the month</b>${["vlow", "low", "ok", "high", "blown", "none"].map((k) => `<div>${i(LIGHTS[k][1])}${LIGHTS[k][0]}</div>`).join("")}` : "")
      + (shown.has("stocked") ? `<b>Stocked waters</b><div>${i(C.fresh)}Stocked in the last 30 days</div><div>${i(C.stocked)}Stocked in the last 3 years</div>` : "")
      + (shown.has("access") || shown.has("launch") ? `<b>Access</b>${shown.has("access") ? `<div>${i(C.access)}Fishing spot, pier or dock</div>` : ""}${shown.has("launch") ? `<div>${i(C.launch)}Boat launch</div>` : ""}` : "")
      + (shown.has("tides") ? `<b>Ocean</b><div>${i(C.tide)}Tide station</div>` : "")
      + (shown.has("zones") ? `<b>Rules</b><div><i style="border:2px dashed ${C.zone};border-radius:2px"></i>Fishing zone or region</div><div><i style="border:2px dashed ${C.tide};border-radius:2px"></i>Pacific tidal area</div>` : "")
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

  // What's at a spot: everything the app knows within reach, each part filled in as it comes.
  let spotSeq = 0;
  async function showSpot(lat, lon, title) {
    const el = $("fsSpot"), seq = ++spotSeq;
    el.hidden = false;
    el.innerHTML = `<header>${svg(IC.pin)}<h3 id="fsSpotName">${esc(title || "This spot")}</h3><button type="button" class="fs-x" aria-label="Close">${svg(IC.x, 16)}</button></header>
      <div id="fsWater"><p class="fs-note fs-look">Looking up this spot…</p></div><div id="fsBait"></div>
      <div id="fsRules"></div><div id="fsStock"></div><div id="fsEat"></div><div id="fsFlow"></div><div id="fsTide"></div><div id="fsAcc"></div>`;
    el.querySelector(".fs-x").addEventListener("click", () => { el.hidden = true; spotSeq++; });
    cardInView(el);
    await ready;
    const zs = await loadZones();
    if (seq !== spotSeq) return;
    const here = zonesAt(zs, lat, lon), prov = provinceAt(lat, lon, here);
    const fill = (id, html) => { if (seq === spotSeq && $(id)) $(id).innerHTML = html; };
    fill("fsRules", secRules(rulesHtml(lat, lon, here, prov)));
    fill("fsStock", stockHtml(lat, lon));
    flowHtml(lat, lon).then((h) => fill("fsFlow", secFlow(h)));
    tideHtml(lat, lon).then((h) => fill("fsTide", secTide(h)));
    fill("fsAcc", secAcc(accessHtml(lat, lon)));
    // What to use: the fish the province lists here, plus what's stocked close by and what the eating guide lists.
    const baitSp = new Set();
    if (stocked) for (const [sw] of near(stocked.waters, lat, lon, 3, (x) => x.c).slice(0, 2)) for (const r of sw.r) if (stocked.sp[r[1]]) baitSp.add(stocked.sp[r[1]]);
    let baitWater = "";
    const bait = () => { if (seq === spotSeq && window.tfFishBait) window.tfFishBait.render($("fsBait"), { lat, lon, month: new Date().getMonth() + 1, region: hatchRegion(lat, lon), water: baitWater, species: [...baitSp], hatch: hatchNow(lat, lon) }, fold, IC.bug); };
    waterAt(lat, lon, prov).then((w) => {
      if (seq !== spotSeq) return;
      if (w && w.sp) w.sp.forEach((x) => baitSp.add(x));
      baitWater = w && w.kind ? (/lake/i.test(w.kind) ? "lake" : "river") : !w && nearestTide(lat, lon, 4) ? "ocean" : "";
      bait();
      if (w && w.name && !title) $("fsSpotName").textContent = w.name;
      fill("fsWater", w ? secFish(w.html) : "");
      if (!w) $("fsSpot").classList.add("fs-nowater");
      if (w && w.rules) fill("fsRules", fold("rules", IC.rules, "Rules", "This water has its own rules", unhead(w.rules) + unhead(rulesHtml(lat, lon, here, prov)), true));
      if (prov === "on" || prov === "qc") eatHtml(lat, lon, prov, (w && w.name) || title).then((h) => {
        fill("fsEat", h.html);
        if (h.sp && h.sp.length) { h.sp.forEach((x) => baitSp.add(x)); bait(); }
        if (seq === spotSeq && h.name && !title && !(w && w.name)) $("fsSpotName").textContent = h.name;   // Quebec's map often has no name for the water
      });
    });
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
    return { sp: [...new Set(ws.flatMap(([w]) => w.f.map((r) => e.sp[r[0]])))], name: ws[0][1] < 1.5 ? ws[0][0].n : "", html: ws.map(([w, d]) => {
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
      return fold("eat", IC.fish, "Safe to eat", `${rows.length} fish`, `<p class="fs-note">${esc(w.n)}${w.d ? ` (${esc(w.d)})` : ""}${d > 0.5 ? `, ${fmtKm(d)} away` : ""}. Meals a month by size; fewer for children and pregnancy.</p>${body}`);
    }).join("") };
  }

  // The water at a spot from each province's own map server: name, fish found there, depth, and (Alberta) its rules.
  async function waterAt(lat, lon, prov) {
    try {
      if (prov === "bc") return await waterBC(lat, lon);
      if (prov === "ab") return await waterAB(lat, lon);
      if (prov === "on") return await waterON(lat, lon);
      if (prov === "qc") return await waterQC(lat, lon);
    } catch {}
    return null;
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
    const depth = lake ? await wfs("WHSE_FISH.BATH_LAKE_BATHYMETRIC_SP", "DEPTH_CONTOUR", `INTERSECTS(GEOMETRY, ${pt})`, 1).then((a) => a.length).catch(() => 0) : 0;
    const facts = [kind, lake && lake.AREA_HA ? `${lake.AREA_HA >= 100 ? Math.round(lake.AREA_HA) : lake.AREA_HA.toFixed(1)} ha` : "", depth ? "depth map on the Lake depth layer" : ""].filter(Boolean);
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
    return { name, html: `<p class="fs-note">${esc(w.FMZ ? `Fish Management Zone ${w.FMZ}` : "")}</p>`, rules };
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
    const p = new URLSearchParams({ geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "NM_ENDRO_FR,VA_TYPE_DESCR_FR", returnGeometry: "false", f: "json" });
    const j = await getJ(`${QC_EXC}/query?${p}`, 9000);
    const a = j.features && j.features[0] && j.features[0].attributes;
    if (!a) return null;
    const name = `${a.VA_TYPE_DESCR_FR ? a.VA_TYPE_DESCR_FR + " " : ""}${a.NM_ENDRO_FR || ""}`.trim();
    return { name, html: `<ul class="fs-list"><li style="--c:${C.high}"><b>This water has its own rules</b>Quebec lists an exception here (season, limits or gear differ from the zone): open the zone's rules below and look for ${esc(name || "this water")}.</li></ul>` };
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
      } else if (z.k === "qc") {
        const news = (z.news || []).slice(0, 3).map(([d, t, u]) => `<br><small>${esc(d)}: ${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t)}</small>`).join("");
        items.push(`<li style="--c:${C.zone}"><b>Quebec fishing ${esc(z.n)}</b>${z.u ? `<a href="${esc(z.u)}" target="_blank" rel="noopener">Seasons, limits and exceptions</a>` : ""}${z.map ? ` · <a href="${esc(z.map)}" target="_blank" rel="noopener">Zone map (PDF)</a>` : ""} · <a href="https://peche.faune.gouv.qc.ca/regpec/carteinteractive/" target="_blank" rel="noopener">Interactive map</a>${news}${z.nw ? `<details><summary>What's new in this zone</summary><p class="fs-note">${esc(z.nw).replace(/\n+/g, "<br>")}</p></details>` : ""}</li>`);
      }
    }
    if (!here.some((z) => z.k !== "pfma") && PROV[prov]) items.push(`<li style="--c:${C.zone}"><b>${esc(PROV[prov][0])}</b><a href="${PROV[prov][1]}" target="_blank" rel="noopener">${esc(PROV[prov][0])} fishing regulations</a></li>`);
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
    const list = near([...access.values()], lat, lon, 5, (a) => [a.lat, a.lon]).slice(0, 4);
    if (!list.length) return shown.has("access") && map.getZoom() < LAYERS.access.minZoom ? `<p class="fs-note">Zoom in to see fishing spots and launches near here.</p>` : "";
    return `<h4>${svg(IC.boat, 14)}Fishing spots and launches</h4><ul class="fs-list">${list.map(([a, d]) => `<li style="--c:${a.kind === "launch" ? C.launch : C.access}"><b>${esc(accessName(a))}</b><small>${fmtKm(d)} · ${esc(accessFacts(a))}</small></li>`).join("")}</ul>`;
  }
  const accessFacts = (a) => [a.kind === "launch" ? "boat launch" : a.kind === "pier" ? "pier or dock" : "fishing spot", a.facts, a.src].filter(Boolean).join(", ");

  // Opening one pin: the spot card for that place, titled with its name.
  function openWater(w) { setSpot(w.c[0], w.c[1], "tap"); showSpot(w.c[0], w.c[1], w.n); }
  function openGauge(g) {
    setSpot(g[2], g[3], "tap");
    const el = $("fsSpot"), seq = ++spotSeq;
    el.hidden = false;
    el.innerHTML = `<header>${svg(IC.gauge)}<h3>${esc(g[1])}</h3><button type="button" class="fs-x" aria-label="Close">${svg(IC.x, 16)}</button></header><div id="fsFlow"><p class="fs-note">Getting the last 7 days…</p></div><div id="fsRules"></div><div id="fsAcc"></div>`;
    el.querySelector(".fs-x").addEventListener("click", () => { el.hidden = true; spotSeq++; });
    cardInView(el);
    flowHtml(g[2], g[3], g).then((h) => { if (seq === spotSeq) { $("fsFlow").innerHTML = h; drawPoints(); } });
    loadZones().then((zs) => { if (seq !== spotSeq) return; const here = zonesAt(zs, g[2], g[3]); $("fsRules").innerHTML = secRules(rulesHtml(g[2], g[3], here, provinceAt(g[2], g[3], here))); $("fsAcc").innerHTML = secAcc(accessHtml(g[2], g[3])); });
  }
  function openTide(t) {
    setSpot(t[2], t[3], "tap");
    const el = $("fsSpot"), seq = ++spotSeq;
    el.hidden = false;
    el.innerHTML = `<header>${svg(IC.wave)}<h3>Tides: ${esc(t[1])}</h3><button type="button" class="fs-x" aria-label="Close">${svg(IC.x, 16)}</button></header><div id="fsTide"><p class="fs-note">Getting the tides…</p></div><div id="fsRules"></div>`;
    el.querySelector(".fs-x").addEventListener("click", () => { el.hidden = true; spotSeq++; });
    cardInView(el);
    tideHtml(t[2], t[3], t).then((h) => { if (seq === spotSeq) $("fsTide").innerHTML = h; });
    loadZones().then((zs) => { if (seq !== spotSeq) return; const here = zonesAt(zs, t[2], t[3]); $("fsRules").innerHTML = secRules(rulesHtml(t[2], t[3], here, provinceAt(t[2], t[3], here))); });
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
      let s = 3; const why = [];
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
  window.addEventListener("tf:map3d", (e) => {
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
  });

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
  map.on("zoomend", () => { if (isFish()) renderLayers(); });
  let started = false;
  function sync() {
    const on = isFish();
    for (const l of allFish) { if (on && !map.hasLayer(l)) l.addTo(map); else if (!on && map.hasLayer(l)) map.removeLayer(l); }
    if (on && !keyCtl._map) keyCtl.addTo(map); else if (!on && keyCtl._map) keyCtl.remove();
    syncTiles();
    if (!on) { drawPoints(); clearWater(); return; }
    if (!started) { started = true; renderLayers(); ready.then(() => { drawPoints(); renderToday(); }); }
    drawZones(); drawPoints(); loadReadings(); loadAccess();
    if (!spot) { const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); } else { loadWeather(); renderToday(); renderHatch(); }
  }
  window.addEventListener("tf:sport", sync);
  sync();

})();
