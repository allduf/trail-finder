// Hunting, the third sport in the header's sport menu (MTB / Skiing / Hunting). winter.js owns the menu: it sets
// body.sport-hunt (and body.sport-alt, the class every non-MTB sport shares) and sends "tf:sport".
// The panel, top to bottom:
//  - Quick actions: my location, save a point, mark the truck, back to the truck, the hunting log, record a walk
//    (the points, truck and log live in ski-points.js).
//  - This spot (after a tap on the map): zone, open seasons today, limited entry and draw hunts with their odds, the
//    parks, towns and closures there, and what DataBC or Alberta's map server say about the land, forest, burns and water.
//  - Conditions: wind and weather at the spot (Open-Meteo), the scent cone, and today's light, moon and feeding times,
//    with alarms for legal light, sunrise and sunset (in the app, or added to the phone's calendar).
//  - Map layers in groups, each with its own key when on: hunting zones (BC and Alberta WMUs, BC limited entry zones),
//    parks, towns, reserves and closures, private and public land, forest types, old burns, wetlands, slope, aspect,
//    the scent cone and range rings.
//  - Offline: saves the hunting layers of the area on screen for use with no signal.
// Zones, areas, seasons and draw results come from data/hunting/*.json, made monthly by .github/workflows/hunting-data.yml
// (scripts/build-hunting.mjs). The picture layers are live map images from DataBC (BC) and Alberta's map server.
(() => {
  "use strict";
  const map = window.tfLeaflet, sel = document.getElementById("sport");
  if (!map || !sel || !window.L) return;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {   // "tf:setting" tells account.js (optional sign-in) to save settings to the rider's account
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  const isHunt = () => document.body.classList.contains("sport-hunt");
  const WMS = "https://openmaps.gov.bc.ca/geo/pub/wms", WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs", AB = "https://geospatial.alberta.ca";
  const ORANGE = "#d9480f";   // the Hunting accent (blaze orange): only you, your spot and your scent
  // One colour family per layer, so layers that are on together never look alike (alex: "a lot of things that are the same color").
  const C = {
    zone: "#343a40", leh: "#c2255c", no: "#e03131", vary: "#1971c2", open: "#2f9e44", reserve: "#7048e8", town: "#868e96",
    closure: "#212529", green: "#0ca678", private: "#fab005", graze: "#94a83a", wet: "#22b8cf", rings: "#212529",
  };

  // ---------- icons (one stroke style everywhere) ----------
  const svg = (d, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    me: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><path d="M12 7v5M9.5 9.5h5"/>',
    truck: '<path d="M3 16V8h10v8M13 11h4l3 3v2h-7"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    back: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    log: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
    rec: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
    wind: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 10v3l2 2M5 3 2 6M19 3l3 3"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
  };

  // ---------- what each rules area means for hunting ----------
  // no: hunting is not allowed there. A guide only: the regulations and the park's own rules decide.
  const AREA_KINDS = {
    national: { label: "National park", color: C.no, no: true, rule: "No hunting in national parks." },
    eco: { label: "Ecological reserve", color: C.no, no: true, rule: "No hunting in ecological reserves." },
    wilderness: { label: "Wilderness area (Alberta)", color: C.no, no: true, rule: "No hunting in Alberta's wilderness areas." },
    military: { label: "Military land (Alberta)", color: C.no, no: true, rule: "Military bases and air weapons ranges are closed to the public, except the special draw hunts at CFB Wainwright and CFB Suffield in the Alberta guide." },
    park: { label: "Provincial park", color: C.vary, rule: "BC: hunting is allowed in season in many provincial parks, but not in some parks or near campgrounds and trails, so check the park's page. Alberta: hunting isn't allowed in most provincial parks; the Alberta Guide to Hunting Regulations lists the exceptions (and a firearm discharge permit is needed where it is)." },
    protected: { label: "Protected area", color: C.vary, rule: "Hunting is often allowed in season in BC protected areas, with each area's own rules: check BC Parks." },
    conservancy: { label: "Conservancy", color: C.vary, rule: "Hunting is often allowed in season in BC conservancies, with each one's own rules: check BC Parks." },
    rec: { label: "Recreation area", color: C.vary, rule: "Rules vary: check BC Parks." },
    pra: { label: "Provincial recreation area (Alberta)", color: C.vary, rule: "Hunting isn't allowed in most of Alberta's provincial recreation areas; the Alberta Guide to Hunting Regulations lists the exceptions." },
    wildland: { label: "Wildland park (Alberta)", color: C.open, rule: "Hunting is allowed in season in Alberta's wildland parks (and Willmore Wilderness Park), with the usual licences." },
    natural: { label: "Natural area (Alberta)", color: C.open, rule: "Hunting is usually allowed in Alberta's natural areas, with some closures: check the Alberta Guide to Hunting Regulations." },
    rangeland: { label: "Heritage rangeland (Alberta)", color: C.vary, rule: "Grazing land: ask the leaseholder and check the Alberta Guide to Hunting Regulations first." },
    wma: { label: "Wildlife management area", color: C.open, rule: "Hunting is usually allowed in BC wildlife management areas, but some have their own closures or rules: check the regulations." },
    reserve: { label: "First Nation reserve", color: C.reserve, no: true, rule: "Reserve land: no hunting without the First Nation's permission." },
    metis: { label: "Metis settlement", color: C.reserve, no: true, rule: "Metis settlement land: no hunting without the settlement's permission." },
    town: { label: "Town or city", color: C.town, rule: "Shooting is banned inside most cities, towns and villages by bylaw, often with a no-shooting buffer around them (BC also has no-shooting areas in the regional synopses). Check the local firearm discharge bylaw before you hunt here." },
    mvpr: { label: "Motor vehicle closure", color: C.closure, line: true, dash: "2 5", rule: "Closed to motor vehicles under BC's Motor Vehicle Prohibition Regulation." },
    green: { label: "Green Area (Alberta public forest)", color: C.green, line: true, dash: "6 4", rule: "Alberta's Green Area: mostly public forest land, where you can usually hunt in season without asking a landowner (leases and dispositions still have rules)." },
  };
  const BC_REGION_PDF = {
    "1": "region-1-vancouver-island", "2": "region-2-lower-mainland", "3": "region-3-thompson", "4": "region-4-kootenay", "5": "region-5-cariboo",
    "6": "region-6-skeena", "7A": "region-7a-omineca", "7B": "region-7b-peace", "8": "region-8-okanagan",
  };
  const BC_SYNOPSIS = "https://www2.gov.bc.ca/gov/content/sports-culture/recreation/fishing-hunting/hunting/regulations-synopsis";
  const regionPdf = (z) => {
    const r = String(z.r || "").toUpperCase(), n = String(z.rn || "");
    const key = BC_REGION_PDF[r] ? r : r === "7" ? (/peace/i.test(n) ? "7B" : "7A") : null;
    return key ? `https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/hunting/regulations/hunting-trapping-synopsis-${BC_REGION_PDF[key]}.pdf` : BC_SYNOPSIS;
  };
  const AB_REGS = "https://www.albertaregulations.ca/huntingregs/";
  const AB_DRAWS = "https://www.albertarelm.com/cust.drawsummary.page";
  const LEH_PAGE = "https://www2.gov.bc.ca/gov/content/sports-culture/recreation/fishing-hunting/hunting/limited-entry-hunting";
  const LEH_PDF = "https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/hunting/limited-entry-hunting/leh-regulations-synopsis.pdf";

  // Forest types: leading species of each stand (BC VRI SPECIES_CD_1 starts with these letters).
  const FOREST = [
    ["F", "Douglas-fir", "#1b5e20"], ["C", "Western redcedar", "#8e24aa"], ["Y", "Yellow-cedar", "#ce93d8"], ["H", "Hemlock", "#00897b"],
    ["S", "Spruce", "#1e88e5"], ["B", "Balsam / true fir", "#7cb342"], ["P", "Pine", "#fbc02d"], ["L", "Larch", "#a0522d"],
    ["A", "Aspen / cottonwood", "#ff7043"], ["E", "Birch", "#f06292"], ["D", "Alder", "#8d6e63"], ["M", "Maple", "#e53935"],
  ];
  const SPECIES = {
    FD: "Douglas-fir", FDC: "Douglas-fir (coast)", FDI: "Douglas-fir (interior)", CW: "Western redcedar", YC: "Yellow-cedar", HW: "Western hemlock",
    HM: "Mountain hemlock", SX: "Hybrid spruce", SE: "Engelmann spruce", SW: "White spruce", SB: "Black spruce", SS: "Sitka spruce", PL: "Lodgepole pine",
    PLI: "Lodgepole pine", PLC: "Shore pine", PY: "Ponderosa pine", PA: "Whitebark pine", PW: "Western white pine", BL: "Subalpine fir",
    BA: "Amabilis fir", BG: "Grand fir", LW: "Western larch", LA: "Alpine larch", AT: "Trembling aspen", AC: "Cottonwood", ACT: "Black cottonwood",
    EP: "Paper birch", DR: "Red alder", MB: "Bigleaf maple",
  };
  const sld = (layer, rules) => `<StyledLayerDescriptor version="1.0.0"><NamedLayer><Name>${layer}</Name><UserStyle><FeatureTypeStyle>${rules.map(([filter, color]) =>
    `<Rule><Filter>${filter}</Filter><PolygonSymbolizer><Fill><CssParameter name="fill">${color}</CssParameter></Fill></PolygonSymbolizer></Rule>`).join("")}</FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
  // One rule that picks the colour from the species code's first letter (Recode), so the style fits in a map tile's
  // web address (12 rules made it too long for DataBC). Other species fall back to grey; stands with no species aren't painted.
  const forestSld = () => sld(VRI, [[`<Not><PropertyIsNull><PropertyName>SPECIES_CD_1</PropertyName></PropertyIsNull></Not>`,
    `<Function name="Recode"><Function name="strSubstring"><PropertyName>SPECIES_CD_1</PropertyName><Literal>0</Literal><Literal>1</Literal></Function>${FOREST.map(([c, , col]) => `<Literal>${c}</Literal><Literal>${col}</Literal>`).join("")}</Function>`]]);
  const VRI = "pub:WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY", PMBC = "pub:WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW";
  const FIRES = "pub:WHSE_LAND_AND_NATURAL_RESOURCE.PROT_HISTORICAL_FIRE_POLYS_SP", WETLANDS = "pub:WHSE_BASEMAPPING.FWA_WETLANDS_POLY";
  // Old burns by age: young burns green up into good feed (browse and berries) for several years.
  const YEAR = new Date().getFullYear();
  const BURNS = [[YEAR - 5, YEAR, "#5c2e0e", "Burned in the last 5 years"], [YEAR - 15, YEAR - 6, "#9c5b28", "Burned 6-15 years ago"], [YEAR - 30, YEAR - 16, "#c9a27a", "Burned 16-30 years ago"]];
  const between = (p, a, b) => `<PropertyIsBetween><PropertyName>${p}</PropertyName><LowerBoundary><Literal>${a}</Literal></LowerBoundary><UpperBoundary><Literal>${b}</Literal></UpperBoundary></PropertyIsBetween>`;
  const SLOPES = [[15, "15-25°", "#f2e14c"], [25, "25-35°", "#f59f00"], [35, "35-45°", "#e03131"], [45, "45° and up", "#862e9c"]];
  const ASPECT_COLORS = ["#1c7ed6", "#22b8cf", "#40c057", "#a9e34b", "#fcc419", "#fd7e14", "#f03e3e", "#ae3ec9"];   // N NE E SE S SW W NW
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  // Alberta grazing and farm dispositions on public land: under the Recreational Access Regulation, contact the leaseholder first.
  const GRAZE = { GRL: "Grazing lease", FGL: "Forest grazing licence", FDL: "Farm development lease", GRP: "Grazing permit", CUP: "Cultivation permit", HAY: "Hay permit" };
  const GRAZE_COLOR = C.graze;

  const LAYERS = {
    zones: { g: "Boundaries", label: "Hunting zones", sub: "BC management units and Alberta WMUs", on: true, sw: [C.zone, "line"] },
    leh: { g: "Boundaries", label: "Limited entry zones", sub: "BC draw-only hunts", on: false, sw: [C.leh, "dash"] },
    rules: { g: "Boundaries", label: "Parks, towns and closures", sub: "Where hunting is banned or has its own rules", on: true, sw: [C.no, "hatch"] },
    land: { g: "Land", label: "Private and public land", sub: "BC private parcels, Alberta Green Area and grazing leases", on: false, sw: [C.private, "fill"], minZoom: 9 },
    forest: { g: "Habitat", label: "Forest types", sub: "Leading tree species (BC), fuel types (Alberta)", on: false, sw: ["#1b5e20", "fill"], minZoom: 8 },
    burns: { g: "Habitat", label: "Old burns", sub: "Fire scars by age: young burns grow feed", on: false, sw: [BURNS[1][2], "fill"], minZoom: 7 },
    wet: { g: "Habitat", label: "Wetlands", sub: "Marshes, fens, bogs and swamps", on: false, sw: [C.wet, "fill"], minZoom: 10 },
    slope: { g: "Terrain", label: "Slope angle", sub: "Steepness in four bands", on: false, sw: ["#e03131", "fill"], minZoom: 9 },
    aspect: { g: "Terrain", label: "Aspect", sub: "Which way each slope faces", on: false, sw: ["#40c057", "fill"], minZoom: 9 },
    wind: { g: "Tools", label: "Scent cone", sub: "Where the wind carries your scent", on: true, sw: [ORANGE, "cone"] },
    rings: { g: "Tools", label: "Range rings", sub: "50 to 400 m around the spot", on: false, sw: [C.rings, "ring"] },
  };
  const GROUPS = ["Boundaries", "Land", "Habitat", "Terrain", "Tools"];
  const RINGS = [50, 100, 200, 300, 400];   // metres around the spot
  // "huntLayers2": the first version turned on more layers at first; everyone starts again from the lighter set.
  let shown = new Set(store.get("huntLayers2", Object.keys(LAYERS).filter((k) => LAYERS[k].on)));

  const css = document.createElement("style");
  css.textContent = `
body:not(.sport-hunt) #huntPane { display: none !important; }
#huntPane { display: flex; flex-direction: column; gap: 12px; font-size: .9rem; }
#huntPane .hn-note { color: var(--muted); font-size: .76rem; margin: 0; }
#huntPane .hn-safe { color: var(--muted); margin: 0; font-size: .76rem; line-height: 1.4; }
#huntPane a { color: var(--accent); }
#huntPane .hn-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
#huntPane .hn-act { font: inherit; font-size: .74rem; font-weight: 700; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 58px; padding: 6px 4px;
  border-radius: 12px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; text-align: center; line-height: 1.15; }
#huntPane .hn-act svg { color: ${ORANGE}; }
#huntPane .hn-act:active { transform: scale(.97); }
#huntPane .hn-act:disabled { opacity: .6; }
#huntPane .hn-act.on { background: ${ORANGE}; border-color: ${ORANGE}; color: #fff; }
#huntPane .hn-act.on svg { color: #fff; }
#huntPane .hn-card { border: 1px solid var(--line); border-radius: 14px; padding: 12px; background: var(--panel); display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm); }
#huntPane .hn-card > header { display: flex; align-items: center; gap: 8px; }
#huntPane .hn-card > header svg { color: ${ORANGE}; flex: none; }
#huntPane .hn-card h3 { margin: 0; font-size: .95rem; font-weight: 800; flex: 1; min-width: 0; }
#huntPane .hn-card h4 { margin: 2px 0 0; font-size: .74rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
#huntPane .hn-card p { margin: 0; font-size: .84rem; }
#huntPane .hn-x { font: inherit; border: 0; background: var(--chip); color: var(--muted); cursor: pointer; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; flex: none; }
#huntPane .hn-wind { display: flex; align-items: center; gap: 12px; }
#huntPane .hn-arrow { width: 56px; height: 56px; flex: none; border-radius: 50%; background: var(--chip); display: grid; place-items: center; }
#huntPane .hn-arrow svg { transition: transform .3s; }
#huntPane .hn-big { font-size: 1.05rem; font-weight: 800; }
#huntPane .hn-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
#huntPane .hn-stats div { background: var(--chip); border-radius: 10px; padding: 6px 4px; text-align: center; display: flex; flex-direction: column; gap: 1px; }
#huntPane .hn-stats b { font-size: .92rem; }
#huntPane .hn-stats span { font-size: .66rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
#huntPane .hn-hours { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(46px, 1fr); gap: 4px; overflow-x: auto; padding-bottom: 2px; }
#huntPane .hn-hours div { background: var(--chip); border-radius: 8px; padding: 4px 2px; text-align: center; font-size: .72rem; display: flex; flex-direction: column; align-items: center; gap: 1px; }
#huntPane .hn-hours b { font-size: .74rem; }
#huntPane .hn-sun { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: .82rem; margin: 0; }
#huntPane .hn-sun dt { color: var(--muted); }
#huntPane .hn-sun dd { margin: 0; font-weight: 600; }
#huntPane .hn-sun dd small { font-weight: 400; color: var(--muted); }
#huntPane .hn-pills { display: flex; flex-wrap: wrap; gap: 6px; }
#huntPane .hn-pill { font: inherit; font-size: .76rem; font-weight: 700; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
#huntPane .hn-pill svg { color: ${ORANGE}; }
#huntPane ul.hn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
#huntPane ul.hn-list li { border-left: 4px solid var(--line); padding-left: 9px; font-size: .84rem; }
#huntPane ul.hn-list li > b { display: block; }
#huntPane details { border-top: 1px solid var(--line); padding-top: 6px; }
#huntPane details summary { cursor: pointer; font-weight: 700; font-size: .82rem; }
#huntPane details[open] summary { margin-bottom: 6px; }
#huntPane .hn-tbl { width: 100%; border-collapse: collapse; font-size: .76rem; }
#huntPane .hn-tbl td { padding: 4px 4px 4px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
#huntPane .hn-tbl tr.here td { background: #fff4e6; }
#huntPane .hn-tbl .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
#huntPane .hn-open { color: #2b8a3e; font-weight: 800; }
#huntPane .hn-group { margin: 0; font-size: .7rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding-top: 4px; }
#huntPane .hn-layer { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: center; padding: 6px 0; cursor: pointer; }
#huntPane .hn-layer b { display: block; font-size: .86rem; }
#huntPane .hn-layer small { display: block; color: var(--muted); font-size: .74rem; line-height: 1.25; }
#huntPane .hn-layer small.z { color: ${ORANGE}; }
#huntPane .hn-ic { width: 22px; height: 22px; border-radius: 6px; display: block; box-sizing: border-box; }
#huntPane .hn-sw-input { appearance: none; -webkit-appearance: none; width: 40px; height: 24px; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; margin: 0; transition: background .15s; flex: none; }
#huntPane .hn-sw-input::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px #0004; transition: left .15s; }
#huntPane .hn-sw-input:checked { background: ${ORANGE}; }
#huntPane .hn-sw-input:checked::after { left: 19px; }
#huntPane .hn-sw-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#huntPane .hn-key { list-style: none; margin: 0 0 4px 32px; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; font-size: .74rem; color: var(--muted); }
#huntPane .hn-key li { display: flex; align-items: center; gap: 6px; min-width: 0; }
#huntPane .hn-key i, #huntPane .hn-key img { display: inline-block; width: 14px; height: 10px; border-radius: 2px; flex: none; box-sizing: border-box; }
#huntPane .hn-key .wide { grid-column: 1 / -1; }
#huntPane .hn-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#huntPane .hn-row select { font: inherit; font-size: .82rem; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); }
#huntPane .hn-checks { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; font-size: .82rem; }
#huntPane .hn-checks label { display: flex; align-items: center; gap: 6px; }
#huntPane .hn-bar { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
#huntPane .hn-bar i { display: block; height: 100%; width: 0; background: ${ORANGE}; transition: width .2s; }
#huntPane .hn-btn { font: inherit; font-size: .82rem; font-weight: 700; padding: 8px 12px; border-radius: 10px; border: 0; background: ${ORANGE}; color: #fff; cursor: pointer; }
#huntPane .hn-btn.ghost { background: var(--chip); color: var(--fg); }
#huntPane .hn-btn:disabled { opacity: .6; cursor: default; }
@media (prefers-color-scheme: dark) { #huntPane .hn-tbl tr.here td { background: #3a2410; } }
:root[data-theme="dark"] #huntPane .hn-tbl tr.here td { background: #3a2410; }
.hn-label { background: #fff; color: ${C.zone}; border: 1.5px solid ${C.zone}; border-radius: 6px; padding: 1px 5px; font: 700 11px/1.2 var(--font-body, system-ui); white-space: nowrap; box-shadow: 0 1px 2px #0003; transform: translate(-50%, -50%); width: max-content; pointer-events: none; }
.hn-label small { font-weight: 500; color: #555; }
.hn-mapkey { font: 600 12px/1.3 var(--font-body, system-ui); color: #212529; }
.mapwrap.is3d .hn-mapkey { margin-bottom: 46px; }   /* clear of the 3D map's credits line */
.hn-keybtn { font: inherit; font-weight: 800; display: inline-flex; align-items: center; gap: 5px; padding: 7px 11px; border-radius: 999px; border: 0; background: #fff; color: #212529; box-shadow: 0 1px 4px #0004; cursor: pointer; }
.hn-keybtn svg { color: ${ORANGE}; }
.hn-keybox { margin-top: 6px; background: #fff; border-radius: 12px; padding: 8px 10px; box-shadow: 0 2px 10px #0004; width: min(250px, calc(100vw - 40px)); max-height: 45vh; overflow: auto; }
.hn-keybox b { display: block; font-size: 11px; margin: 4px 0 2px; }
.hn-keybox p { margin: 0; }
.hn-keybox .hn-key { list-style: none; margin: 0 0 4px; padding: 0; display: grid; grid-template-columns: 1fr; gap: 2px; font-size: 11px; font-weight: 500; color: #444; }
.hn-keybox .hn-key li { display: flex; align-items: center; gap: 6px; }
.hn-keybox .hn-key i, .hn-keybox .hn-key img { display: inline-block; width: 16px; height: 11px; border-radius: 2px; flex: none; box-sizing: border-box; }
.hn-spot { width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; border: 3px solid ${ORANGE}; background: #fff6; box-shadow: 0 0 0 2px #fff; }
.hn-spot::after { content: ""; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px; border-radius: 50%; background: ${ORANGE}; }
.hn-ring { position: fixed; z-index: 3000; left: 50%; top: 14px; transform: translateX(-50%); width: min(420px, calc(100% - 24px)); box-sizing: border-box; background: ${ORANGE}; color: #fff; border-radius: 14px;
  padding: 12px 14px; box-shadow: 0 8px 28px #0006; display: flex; gap: 10px; align-items: center; font-weight: 700; }
.hn-ring button { margin-left: auto; font: inherit; font-weight: 800; border: 0; border-radius: 10px; padding: 8px 12px; background: #fff; color: ${ORANGE}; cursor: pointer; }`;
  document.head.append(css);

  // ---------- panel ----------
  const pane = document.createElement("section");
  pane.id = "huntPane";
  pane.setAttribute("aria-label", "Hunting");
  pane.innerHTML = `
    <div class="hn-actions" role="toolbar" aria-label="Hunting tools">
      <button type="button" class="hn-act" data-act="me">${svg(IC.me)}My spot</button>
      <button type="button" class="hn-act" data-act="point">${svg(IC.pin)}Save a point</button>
      <button type="button" class="hn-act" data-act="log">${svg(IC.log)}Hunting log</button>
      <button type="button" class="hn-act" data-act="truck">${svg(IC.truck)}Mark my truck</button>
      <button type="button" class="hn-act" data-act="back">${svg(IC.back)}Back to truck</button>
      <button type="button" class="hn-act" data-act="rec">${svg(IC.rec)}Record walk</button>
    </div>
    <div class="hn-card" id="hnSpot" hidden></div>
    <div class="hn-card" id="hnLayers"><header>${svg(IC.layers)}<h3>Map layers</h3></header><div id="hnLayerList"></div></div>
    <div class="hn-card" id="hnWx"></div>
    <div class="hn-card" id="hnSky"></div>
    <div class="hn-card" id="hnOff"></div>
    <p class="hn-safe">A guide, not the law: zones, parks, seasons and draw odds come from BC and Alberta open data and regulation booklets, read by the app each month, and can be out of date or simplified. Always check the <a href="${BC_SYNOPSIS}" target="_blank" rel="noopener">BC Hunting and Trapping Regulations Synopsis</a> or the <a href="${AB_REGS}" target="_blank" rel="noopener">Alberta Guide to Hunting Regulations</a>, and get permission before hunting private land or a lease.</p>`;
  const head = document.querySelector(".panel-head");
  const skiPane = $("skiPane"), modes = head && head.querySelector(".modes");
  if (skiPane) skiPane.after(pane); else if (modes) modes.after(pane); else if (head) head.append(pane);
  let hintTimer = 0;
  function hint(text) {
    let el = $("hnHint");
    if (!el) { el = document.createElement("p"); el.id = "hnHint"; el.className = "hn-note"; el.setAttribute("role", "status"); pane.querySelector(".hn-actions").after(el); }
    el.textContent = text;
    clearTimeout(hintTimer); hintTimer = setTimeout(() => el.remove(), 6000);
  }

  // ---------- data ----------
  const files = {};
  // Rings come as whole numbers (degrees x 10,000), each point after the first as the change from the one before.
  const decode = (g) => g.map((r) => { const out = []; let a = 0, o = 0; for (let i = 0; i < r.length; i += 2) { a += r[i]; o += r[i + 1]; out.push(a / 1e4, o / 1e4); } return out; });
  function load(name) {
    if (!files[name]) files[name] = fetch(`data/hunting/${name}.json`, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { for (const f of j.zones || j.areas || []) f.g = decode(f.g); return j; })
      .catch((e) => { delete files[name]; throw e; });
    return files[name];
  }
  const DATA_FILES = ["zones", "leh", "areas", "seasons-bc", "seasons-ab", "draws"];
  const ringsLL = (g) => g.map((r) => { const out = []; for (let i = 0; i < r.length; i += 2) out.push([r[i], r[i + 1]]); return out; });
  function inside(g, lat, lon) {
    let c = false;
    for (const r of g) for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      if ((r[i] > lat) !== (r[j] > lat) && lon < ((r[j + 1] - r[i + 1]) * (lat - r[i])) / (r[j] - r[i]) + r[i + 1]) c = !c;
    }
    return c;
  }
  const inBox = (b, lat, lon) => lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];
  const at = (list, lat, lon) => (list || []).filter((f) => inBox(f.b, lat, lon) && inside(f.g, lat, lon));
  const inAlberta = (lat, lon) => lat > 49 && lat < 60 && (lon > -110 || (lon > -120 && lat > 49 && lon > -114.07 - (lat - 49) * 0.7 && lat < 53.8) || (lon > -120 && lat >= 53.8));

  // ---------- map layers ----------
  map.createPane("hunt").style.zIndex = 405;
  map.createPane("huntTiles").style.zIndex = 350;
  map.createPane("huntLabels").style.zIndex = 640;
  map.getPane("huntLabels").style.pointerEvents = "none";
  const renderer = L.canvas({ pane: "hunt", padding: 0.3 });
  const zoneLayer = L.layerGroup(), lehLayer = L.layerGroup(), rulesLayer = L.layerGroup(), labelLayer = L.layerGroup(), windLayer = L.layerGroup(), ringLayer = L.layerGroup();
  const allHunt = [zoneLayer, lehLayer, rulesLayer, labelLayer, windLayer, ringLayer];
  let zones = null, leh = null, areas = null;

  async function drawZones() {
    zoneLayer.clearLayers();
    if (!shown.has("zones")) { labelLayer.clearLayers(); return; }
    try { zones = zones || (await load("zones")).zones; } catch { return; }
    for (const z of zones) {
      L.polygon(ringsLL(z.g), { renderer, interactive: false, color: "#fff", weight: 4.5, opacity: 0.55, fill: false }).addTo(zoneLayer);   // white edge: reads on photos and dark forest
      L.polygon(ringsLL(z.g), { renderer, interactive: false, color: C.zone, weight: 2, opacity: 0.9, fill: false }).addTo(zoneLayer);
    }
    drawLabels(); sync3d();
  }
  // Labels only for the zones in view, so the map stays light.
  function drawLabels() {
    labelLayer.clearLayers();
    if (!zones || !shown.has("zones") || !isHunt() || map.getZoom() < 6) return;
    const b = map.getBounds().pad(0.2), z = map.getZoom();
    for (const u of zones) {
      if (!u.c || !b.contains(u.c)) continue;
      const name = u.p === "ab" ? `WMU ${u.id}${z >= 9 && u.n ? ` <small>${esc(u.n)}</small>` : ""}` : `${esc(u.id)}${z >= 9 && u.zn ? ` <small>${esc(u.zn)}</small>` : ""}`;
      L.marker(u.c, { pane: "huntLabels", interactive: false, keyboard: false,
        icon: L.divIcon({ className: "", html: `<div class="hn-label">${name}</div>`, iconSize: [0, 0] }) }).addTo(labelLayer);
    }
  }
  async function drawLeh() {
    lehLayer.clearLayers();
    if (!shown.has("leh")) return;
    try { leh = leh || (await load("leh")).zones; } catch { return; }
    for (const z of leh) L.polygon(ringsLL(z.g), { renderer, interactive: false, color: C.leh, weight: 2, dashArray: "7 5", opacity: 0.85, fill: false }).addTo(lehLayer);
  }
  // No-hunting areas are hatched (red stripes), so they never read as just another tint.
  const hatchTile = (() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 10;
    const cx = cv.getContext("2d"); cx.strokeStyle = C.no; cx.lineWidth = 2;
    cx.beginPath(); cx.moveTo(-1, 11); cx.lineTo(11, -1); cx.moveTo(-1, 1); cx.lineTo(1, -1); cx.moveTo(9, 11); cx.lineTo(11, 9); cx.stroke();
    return cv;
  })();
  const HATCH = document.createElement("canvas").getContext("2d").createPattern(hatchTile, "repeat");
  const hatched = (k) => k.color === C.no;   // reserves are "no" too (ask first) but keep their own violet
  const fillOp = (id, k) => (hatched(k) ? 0.6 : id === "town" ? 0.2 : k.color === C.vary ? 0.16 : k.color === C.reserve ? 0.12 : 0.07);
  async function drawRules() {
    rulesLayer.clearLayers();
    if (!shown.has("rules") && !shown.has("land")) return;
    try { areas = areas || (await load("areas")).areas; } catch { return; }
    for (const a of areas) {
      const k = AREA_KINDS[a.k];
      if (!k) continue;
      const want = a.k === "green" ? shown.has("land") : shown.has("rules");
      if (!want) continue;
      L.polygon(ringsLL(a.g), { renderer, interactive: false, color: k.color, weight: k.line || k.color === C.vary || k.color === C.reserve ? 2 : hatched(k) ? 1.5 : 1, dashArray: k.dash || null, lineCap: k.dash ? "round" : "butt",
        opacity: a.k === "town" ? 0.5 : 0.85, fill: !k.line, fillColor: hatched(k) ? HATCH : k.color, fillOpacity: fillOp(a.k, k) }).addTo(rulesLayer);
    }
    sync3d();
  }

  // Picture layers: map images for each 256 px tile, asked for by the tile's box in web mercator metres. Built as
  // plain addresses (not Leaflet's WMS layer) so the 3D map and Offline can ask for exactly the same images.
  const R = 20037508.342789244;
  const tileBox = (z, x, y) => { const s = (2 * R) / 2 ** z; return [x * s - R, R - (y + 1) * s, (x + 1) * s - R, R - y * s].map((v) => v.toFixed(2)).join(","); };
  const BoxTiles = L.TileLayer.extend({
    initialize(tmpl, opts) { this._tmpl = tmpl; L.TileLayer.prototype.initialize.call(this, "", opts); },
    getTileUrl(c) { return this._tmpl.replace("{bbox}", tileBox(c.z, c.x, c.y)); },
  });
  const wms = (layer, style) => `${WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${encodeURIComponent(layer)}&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=true&SRS=EPSG%3A3857&WIDTH=256&HEIGHT=256&SLD_BODY=${encodeURIComponent(style)}&BBOX={bbox}`;
  const arcgis = (service, extra) => `${AB}/${service}/MapServer/export?bboxSR=3857&imageSR=3857&size=256%2C256&format=png32&transparent=true&f=image&${extra}&bbox={bbox}`;
  const dyn = (ids, fill, line) => `dynamicLayers=${encodeURIComponent(JSON.stringify(ids.map((id) => ({ id, source: { type: "mapLayer", mapLayerId: id },
    drawingInfo: { renderer: { type: "simple", symbol: { type: "esriSFS", style: "esriSFSSolid", color: fill, outline: { type: "esriSLS", style: "esriSLSSolid", color: line, width: 1 } } } } }))))}`;
  const rgba = (h, a) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
  const FIRE_SVC = "mimas/rest/services/wildfire/historical_wildfires_data", FUEL_SVC = "mimas/rest/services/wildfire/fbp_fuel_type";
  const GRAZE_SVC = "titan/rest/services/recaccess/recaccess_grazing", WET_SVC = "titan/rest/services/environment/alberta_merged_wetland_inventory";
  // id: the 3D map's layer name; layer: which switch shows it
  const PICS = [
    { id: "hn-land", layer: "land", tmpl: wms(PMBC, sld(PMBC, [[`<PropertyIsEqualTo><PropertyName>OWNER_TYPE</PropertyName><Literal>Private</Literal></PropertyIsEqualTo>`, C.private]])),
      min: 11, opacity: 0.4, attr: 'Land: <a href="https://ltsa.ca/property-owners/about-land-records/parcelmap-bc/">ParcelMap BC</a>, DataBC' },
    { id: "hn-graze", layer: "land", tmpl: arcgis(GRAZE_SVC, dyn([1], rgba(GRAZE_COLOR, 90), rgba("#b07d00", 255))), min: 9, opacity: 0.8, attr: "Leases: Alberta Recreational Access" },
    { id: "hn-forest", layer: "forest", tmpl: wms(VRI, forestSld()), min: 11, opacity: 0.5, attr: 'Forest: <a href="https://www2.gov.bc.ca/gov/content/industry/forestry/managing-our-forest-resources/forest-inventory">BC Vegetation Resources Inventory</a>' },
    { id: "hn-fuel", layer: "forest", tmpl: arcgis(FUEL_SVC, "layers=show%3A1"), min: 8, opacity: 0.5, ab: true, attr: "Forest: Alberta Wildfire fuel types" },
    { id: "hn-burns", layer: "burns", tmpl: wms(FIRES, sld(FIRES, BURNS.map(([a, b, col]) => [between("FIRE_YEAR", a, b), col]))), min: 7, opacity: 0.45, attr: 'Burns: <a href="https://catalogue.data.gov.bc.ca/dataset/fire-perimeters-historical">BC Wildfire Service</a>' },
    { id: "hn-abburn1", layer: "burns", tmpl: arcgis(FIRE_SVC, dyn([11, 12, 13, 14, 15], rgba(BURNS[0][2], 115), rgba(BURNS[0][2], 255))), min: 7, opacity: 1, ab: true, attr: "Burns: Alberta Wildfire" },
    { id: "hn-abburn2", layer: "burns", tmpl: arcgis(FIRE_SVC, dyn([16, 17, 18, 19, 20], rgba(BURNS[1][2], 115), rgba(BURNS[1][2], 255))), min: 7, opacity: 1, ab: true, attr: "Burns: Alberta Wildfire" },
    { id: "hn-wet", layer: "wet", tmpl: wms(WETLANDS, sld(WETLANDS, [[`<Not><PropertyIsNull><PropertyName>WATERBODY_TYPE</PropertyName></PropertyIsNull></Not>`, C.wet]])), min: 10, opacity: 0.55, attr: 'Wetlands: <a href="https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/freshwater">BC Freshwater Atlas</a>' },
    { id: "hn-abwet", layer: "wet", tmpl: arcgis(WET_SVC, "layers=show%3A3"), min: 13, opacity: 0.6, ab: true, attr: "Wetlands: Alberta Merged Wetland Inventory" },
  ];
  // each province's layers only ask for tiles over that province
  const BOUNDS = { bc: [[48.2, -139.1], [60.01, -114.0]], ab: [[48.99, -120.01], [60.01, -109.99]] };
  for (const p of PICS) p.tiles = new BoxTiles(p.tmpl, { pane: "huntTiles", opacity: p.opacity, minZoom: p.min, maxZoom: 20, attribution: p.attr, bounds: BOUNDS[p.ab ? "ab" : "bc"] });

  // Slope angle and aspect from the terrain tiles (Terrarium colour code, 256 px, up to zoom 14).
  const DEM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/";
  const demCache = new Map();
  function dem(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (demCache.has(key)) return demCache.get(key);
    const p = fetch(`${DEM}${z}/${x}/${y}.png`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then(createImageBitmap).then((bmp) => {
        const cv = document.createElement("canvas"); cv.width = cv.height = 256;
        const cx = cv.getContext("2d", { willReadFrequently: true });
        cx.drawImage(bmp, 0, 0, 256, 256);
        const px = cx.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
        for (let i = 0; i < 65536; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        return e;
      });
    p.catch(() => demCache.delete(key));
    demCache.set(key, p);
    if (demCache.size > 60) demCache.delete(demCache.keys().next().value);
    return p;
  }
  const tileLat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const SLOPE_RGB = SLOPES.map((s) => rgb(s[2])), ASPECT_RGB = ASPECT_COLORS.map(rgb);
  async function paintTerrain(mode, z, x, y) {
    const out = new ImageData(256, 256), E = await dem(z, x, y), o = out.data;
    // Pixels at low zoom are hundreds of metres wide, which flattens slopes: scale them up a little there.
    const k = z >= 12 ? 1 : z === 11 ? 1.15 : z === 10 ? 1.4 : 1.8;
    for (let py = 0; py < 256; py++) {
      const lat = tileLat(y + (py + 0.5) / 256, z), m = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
      const y0 = py > 0 ? py - 1 : py, y1 = py < 255 ? py + 1 : py;
      for (let px = 0; px < 256; px++) {
        const i = py * 256 + px;
        if (E[i] < 0) continue;   // sea
        const x0 = px > 0 ? px - 1 : px, x1 = px < 255 ? px + 1 : px;
        const dzdx = (E[py * 256 + x1] - E[py * 256 + x0]) / ((x1 - x0) * m), dzdy = (E[y1 * 256 + px] - E[y0 * 256 + px]) / ((y1 - y0) * m);
        const slope = ((Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI) * k;
        let c, a;
        if (mode === "slope") {
          const s = slope >= 45 ? 3 : slope >= 35 ? 2 : slope >= 25 ? 1 : slope >= 15 ? 0 : -1;
          if (s < 0) continue;
          c = SLOPE_RGB[s]; a = 0.45;
        } else {
          if (slope < 5) continue;   // flat ground has no real aspect
          // Downhill direction: east = -dz/dx, north = +dz/dy (pixel rows run south).
          const asp = ((Math.atan2(-dzdx, dzdy) * 180) / Math.PI + 360) % 360;
          c = ASPECT_RGB[Math.round(asp / 45) % 8]; a = slope < 12 ? 0.25 : 0.42;
        }
        const j = i * 4;
        o[j] = c[0]; o[j + 1] = c[1]; o[j + 2] = c[2]; o[j + 3] = a * 255;
      }
    }
    return out;
  }
  const TerrainGrid = L.GridLayer.extend({
    createTile(c, done) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      paintTerrain(this.options.mode, c.z, c.x, c.y).then((img) => { cv.getContext("2d").putImageData(img, 0, 0); done(null, cv); }, (e) => done(e, cv));
      return cv;
    },
  });
  const terrainOpts = { pane: "huntTiles", minZoom: 9, maxNativeZoom: 14, maxZoom: 20, attribution: 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a>' };
  const terrain = { slope: new TerrainGrid({ ...terrainOpts, mode: "slope" }), aspect: new TerrainGrid({ ...terrainOpts, mode: "aspect" }) };

  function syncTiles() {
    for (const p of PICS) {
      const want = isHunt() && shown.has(p.layer);
      if (want && !map.hasLayer(p.tiles)) p.tiles.addTo(map); else if (!want && map.hasLayer(p.tiles)) map.removeLayer(p.tiles);
    }
    for (const [k, l] of Object.entries(terrain)) {
      const want = isHunt() && shown.has(k);
      if (want && !map.hasLayer(l)) l.addTo(map); else if (!want && map.hasLayer(l)) map.removeLayer(l);
    }
  }

  // ---------- layer list with built-in keys ----------
  // Alberta's fuel type legend comes from its map server (the colours it paints with).
  let fuelLegend = null;
  function loadFuelLegend() {
    if (fuelLegend) return;
    fuelLegend = [];
    fetch(`${AB}/${FUEL_SVC}/MapServer/legend?f=json`).then((r) => r.json()).then((j) => {
      fuelLegend = (j.layers || []).flatMap((l) => l.legend || []).filter((x) => x.imageData && !/^(Water|Non-fuel)$/i.test(x.label)).map((x) => [x.label, `data:${x.contentType || "image/png"};base64,${x.imageData}`]);
      renderLayers();
    }).catch(() => { fuelLegend = null; });
  }
  const hatchCss = (c) => `repeating-linear-gradient(135deg, ${c} 0 2px, transparent 2px 5px)`;
  const sw = (c, kind = "fill") => kind === "line" || kind === "dash" || kind === "dot" ? `<i style="border:2px ${kind === "line" ? "solid" : kind === "dash" ? "dashed" : "dotted"} ${c};background:transparent"></i>`
    : kind === "hatch" ? `<i style="border:1.5px solid ${c};background:${hatchCss(c)}"></i>`
    : kind === "soft" ? `<i style="border:1.5px solid ${c};background:${c}33"></i>`
    : kind === "edge" ? `<i style="border:2px solid ${c};background:${c}14"></i>` : `<i style="background:${c}"></i>`;
  const KEYS = {
    zones: () => [`<li class="wide">${sw(C.zone, "line")}Zone edge (BC MU, Alberta WMU)</li>`],
    leh: () => [`<li>${sw(C.leh, "dash")}Limited entry zone</li>`],
    rules: () => [`<li>${sw(C.no, "hatch")}No hunting</li>`, `<li>${sw(C.vary, "soft")}Park: rules vary</li>`, `<li>${sw(C.open, "edge")}Usually open in season</li>`,
      `<li>${sw(C.reserve, "edge")}Reserve: ask first</li>`, `<li>${sw(C.town)}Town: no shooting</li>`, `<li>${sw(C.closure, "dot")}Vehicle closure</li>`],
    land: () => [`<li>${sw(C.private)}Private land (BC)</li>`, `<li>${sw(GRAZE_COLOR)}Grazing lease (AB): ask</li>`, `<li class="wide">${sw(C.green, "dash")}Alberta Green Area: public forest</li>`],
    forest: () => [...FOREST.map(([, n, c]) => `<li>${sw(c)}${esc(n)}</li>`), `<li>${sw("#808080")}Other species</li>`,
      ...(fuelLegend && fuelLegend.length ? [`<li class="wide"><b>Alberta fuel types</b></li>`, ...fuelLegend.map(([n, src]) => `<li><img alt="" src="${src}">${esc(n.replace(/^[A-Z]-\d(\/[A-Z]-\d)? \((.*)\)$/, "$2"))}</li>`)] : [])],
    burns: () => [...BURNS.map(([, , c, n]) => `<li>${sw(c)}${esc(n)}</li>`), `<li class="wide">Alberta: the last 10 years</li>`],
    wet: () => [`<li>${sw(C.wet)}Wetland (BC)</li>`, `<li>Alberta: from zoom 13</li>`],
    slope: () => SLOPES.map(([, n, c]) => `<li>${sw(c)}${esc(n)}</li>`),
    aspect: () => DIRS.map((d, i) => `<li>${sw(ASPECT_COLORS[i])}Faces ${d}</li>`),
    wind: () => [`<li class="wide">${sw(ORANGE)}Downwind of the spot: game there can smell you</li>`],
    rings: () => [`<li class="wide">${sw(C.rings, "dash")}${RINGS.join(", ")} m</li>`],
  };
  const icon = ([c, kind]) => kind === "hatch" ? `<span class="hn-ic" style="border:2px solid ${c};background:${hatchCss(c)}"></span>` : kind === "line" ? `<span class="hn-ic" style="border:3px solid ${c}"></span>` : kind === "dash" ? `<span class="hn-ic" style="border:3px dashed ${c}"></span>`
    : kind === "cone" ? `<span class="hn-ic" style="background:conic-from 0deg, transparent;background:linear-gradient(135deg, ${c}55, ${c})"></span>` : kind === "ring" ? `<span class="hn-ic" style="border:2px dashed ${c};border-radius:50%"></span>`
    : `<span class="hn-ic" style="background:${c};opacity:.85"></span>`;
  function renderLayers() {
    const z = map.getZoom();
    $("hnLayerList").innerHTML = GROUPS.map((g) => `<h4 class="hn-group">${g}</h4>` + Object.entries(LAYERS).filter(([, l]) => l.g === g).map(([k, l]) => {
      const on = shown.has(k), far = on && l.minZoom && z < l.minZoom;
      return `<label class="hn-layer">${icon(l.sw)}<span><b>${esc(l.label)}</b><small${far ? ' class="z"' : ""}>${far ? "Zoom in closer to see it" : esc(l.sub)}</small></span><input type="checkbox" class="hn-sw-input" role="switch" data-k="${k}"${on ? " checked" : ""} aria-label="${esc(l.label)}"></label>${on ? `<ul class="hn-key">${KEYS[k]().join("")}</ul>` : ""}`;
    }).join("")).join("");
  }
  // Map key: what the colours on the map mean, for the layers that are on (handy on a phone with the sheet down).
  const keyCtl = L.control({ position: "bottomleft" });
  keyCtl.onAdd = () => {
    const d = L.DomUtil.create("div", "hn-mapkey");
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
    d.innerHTML = `<button type="button" class="hn-keybtn" aria-expanded="false">${svg(IC.layers, 16)}Key</button><div class="hn-keybox" hidden></div>`;
    d.querySelector("button").addEventListener("click", (e) => { const box = d.querySelector(".hn-keybox"); box.hidden = !box.hidden; e.currentTarget.setAttribute("aria-expanded", String(!box.hidden)); renderMapKey(); });
    return d;
  };
  function renderMapKey() {
    const box = document.querySelector(".hn-mapkey .hn-keybox");
    if (!box || box.hidden) return;
    const on = Object.keys(LAYERS).filter((k) => shown.has(k));
    box.innerHTML = on.length ? on.map((k) => `<b>${esc(LAYERS[k].label)}</b><ul class="hn-key">${KEYS[k]().join("")}</ul>`).join("") : `<p>No layers on: turn some on in Map layers.</p>`;
  }
  $("hnLayerList").addEventListener("change", (e) => {
    const b = e.target.closest("[data-k]"); if (!b) return;
    const k = b.dataset.k;
    if (b.checked) shown.add(k); else shown.delete(k);
    if (k === "slope" && shown.has("slope")) shown.delete("aspect");   // one terrain shading at a time
    if (k === "aspect" && shown.has("aspect")) shown.delete("slope");
    if (k === "forest" && shown.has("forest")) loadFuelLegend();
    store.set("huntLayers2", [...shown]);
    renderLayers(); renderMapKey(); syncTiles(); sync3d();
    if (k === "zones") drawZones();
    if (k === "leh") drawLeh();
    if (k === "rules" || k === "land") drawRules();
    if (k === "wind") drawWind();
    if (k === "rings") drawRings();
  });

  // ---------- the spot: your location, a tapped spot or the map centre ----------
  let spot = null;   // { lat, lon, how: "you" | "tap" | "centre" }
  const spotMarker = L.marker([0, 0], { pane: "huntLabels", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: '<div class="hn-spot"></div>', iconSize: [0, 0] }) });
  function setSpot(lat, lon, how) {
    spot = { lat, lon, how };
    if (how === "centre") windLayer.removeLayer(spotMarker); else { spotMarker.setLatLng([lat, lon]); windLayer.addLayer(spotMarker); }
    loadWeather(); drawRings(); renderSky(); sync3d();
  }
  // Range rings around the spot, for judging shot distances (tap the map where you'll stand).
  function drawRings() {
    ringLayer.clearLayers();
    if (!shown.has("rings") || !spot) return;
    for (const m of RINGS) {
      L.circle([spot.lat, spot.lon], { radius: m, pane: "hunt", interactive: false, color: "#212529", weight: 1.5, opacity: 0.8, dashArray: "5 5", fill: false }).addTo(ringLayer);
      L.marker([spot.lat + (m * Math.SQRT1_2) / 111320, spot.lon + (m * Math.SQRT1_2) / (111320 * Math.cos(spot.lat * Math.PI / 180))], {   // north-east, so the labels spread out
        pane: "huntLabels", interactive: false, keyboard: false,
        icon: L.divIcon({ className: "", html: `<div class="hn-label" style="color:#212529;border-color:#212529;font-size:10px">${m} m</div>`, iconSize: [0, 0] }) }).addTo(ringLayer);
    }
  }
  const fmtLL = (lat, lon) => `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

  // ---------- sun and moon (after SunCalc by Vladimir Agafonkin, BSD) ----------
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
  // A day's sun and moon events, by sampling every 5 minutes from local midnight (plus days ahead, for alarms).
  // Times show in the spot's own time zone once the weather has loaded (Open-Meteo says it), else this device's.
  const tzOff = () => (wx && wx.utc_offset_seconds != null ? wx.utc_offset_seconds : -new Date().getTimezoneOffset() * 60) * 1000;
  function skyDay(lat, lon, ahead = 0, moon = true) {
    const off = tzOff(), start = new Date(Math.floor((Date.now() + off) / dayMs) * dayMs - off + ahead * dayMs);
    const step = 5 * 60000, out = { day: start, rise: null, set: null, moonRise: null, moonSet: null, transit: null, under: null };
    let ps = sunAlt(start, lat, lon), pm = moon ? moonAlt(start, lat, lon) : 0, maxM = -99, minM = 99;
    for (let t = start.valueOf() + step; t <= start.valueOf() + dayMs; t += step) {
      const dt = new Date(t), s = sunAlt(dt, lat, lon), m = moon ? moonAlt(dt, lat, lon) : 0;
      const cross = (a, b, h) => new Date(t - step + (step * (h - a)) / (b - a));
      if (ps < -0.833 && s >= -0.833 && !out.rise) out.rise = cross(ps, s, -0.833);
      if (ps >= -0.833 && s < -0.833 && !out.set) out.set = cross(ps, s, -0.833);
      if (moon) {
        if (pm < 0.133 && m >= 0.133 && !out.moonRise) out.moonRise = cross(pm, m, 0.133);
        if (pm >= 0.133 && m < 0.133 && !out.moonSet) out.moonSet = cross(pm, m, 0.133);
        if (m > maxM) { maxM = m; out.transit = dt; }
        if (m < minM) { minM = m; out.under = dt; }
      }
      ps = s; pm = m;
    }
    return out;
  }
  const hm = (d) => {
    if (!d) return "none";
    const x = new Date(d.valueOf() + tzOff()), h = x.getUTCHours();
    return `${h % 12 || 12}:${String(x.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  const span = (d, mins) => (d ? `${hm(new Date(d - mins * 60000))} to ${hm(new Date(d.valueOf() + mins * 60000))}` : "");
  // Legal light: half an hour before sunrise to half an hour after sunset (BC and Alberta's usual hunting hours).
  const LIGHT_EVENTS = [["legalStart", "Legal light starts", (s) => s.rise && new Date(s.rise - 30 * 60000)], ["rise", "Sunrise", (s) => s.rise],
    ["set", "Sunset", (s) => s.set], ["legalEnd", "Legal light ends", (s) => s.set && new Date(s.set.valueOf() + 30 * 60000)]];
  function renderSky() {
    const el = $("hnSky");
    if (!spot) { el.hidden = true; return; }
    el.hidden = false;
    const s = skyDay(spot.lat, spot.lon), ph = moonPhase(new Date()), p = PHASES.find((x) => ph.phase < x[0]) || PHASES[0];
    const legal = s.rise && s.set ? `${hm(new Date(s.rise - 30 * 60000))} – ${hm(new Date(s.set.valueOf() + 30 * 60000))}` : "no sunrise or sunset today";
    const major = [s.transit, s.under].filter(Boolean).sort((a, b) => a - b).map((d) => span(d, 60)).join(", ");
    const minor = [s.moonRise, s.moonSet].filter(Boolean).sort((a, b) => a - b).map((d) => span(d, 30)).join(", ");
    const al = alarms();
    el.innerHTML = `<header>${svg(IC.sun)}<h3>Light and moon today</h3></header>
      <dl class="hn-sun">
        <dt>Legal light</dt><dd>${legal}</dd>
        <dt>Sunrise · sunset</dt><dd>${hm(s.rise)} · ${hm(s.set)}</dd>
        <dt>Moon</dt><dd>${p[2]} ${p[1]}, ${Math.round(ph.fraction * 100)}% <small>· rises ${hm(s.moonRise)}, sets ${hm(s.moonSet)}</small></dd>
        <dt>Feeding times</dt><dd>${major || "none"}${minor ? ` <small>· minor ${minor}</small>` : ""}</dd>
      </dl>
      <details><summary>What these times mean</summary><p class="hn-note">Legal light is half an hour before sunrise to half an hour after sunset, the usual hunting hours in BC and Alberta (some hunts differ). Feeding times are solunar: the moon overhead or underfoot (major) and moonrise or moonset (minor), a traditional guide. ${wx && wx.timezone_abbreviation ? `Local time at the spot (${esc(wx.timezone_abbreviation)}).` : "Times on this device's clock."}</p></details>
      <details id="hnAlarms"${al.open ? " open" : ""}><summary>⏰ Alarms${Object.values(al.on).some(Boolean) ? `: ${LIGHT_EVENTS.filter(([k]) => al.on[k]).map(([, n]) => n.toLowerCase()).join(", ")}` : ""}</summary>
        <div class="hn-checks">${LIGHT_EVENTS.map(([k, n]) => `<label><input type="checkbox" data-al="${k}"${al.on[k] ? " checked" : ""}>${n}</label>`).join("")}</div>
        <div class="hn-row" style="margin-top:8px"><label for="hnBefore" class="hn-note">Ring</label><select id="hnBefore">${[0, 5, 10, 15, 30, 45, 60].map((m) => `<option value="${m}"${al.before === m ? " selected" : ""}>${m ? `${m} min before` : "right on time"}</option>`).join("")}</select>
          <button type="button" class="hn-pill" id="hnIcs">${svg(IC.alarm, 16)}Add to my calendar</button></div>
        <p class="hn-note" style="margin-top:6px">While Trail Finder is open it rings and shows a notice. For alarms with the app closed, “Add to my calendar” puts the next 14 days at this spot in your phone's calendar, each with its own alert.</p>
      </details>`;
    el.querySelector("#hnAlarms").addEventListener("toggle", (e) => { const a = alarms(); a.open = e.target.open; store.set("huntAlarms", a); });
    el.querySelectorAll("[data-al]").forEach((c) => c.addEventListener("change", () => {
      const a = alarms(); a.on[c.dataset.al] = c.checked; store.set("huntAlarms", a);
      if (c.checked && "Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
      renderSky(); checkAlarms();
    }));
    $("hnBefore").addEventListener("change", (e) => { const a = alarms(); a.before = +e.target.value; store.set("huntAlarms", a); checkAlarms(); });
    $("hnIcs").addEventListener("click", calendar);
  }

  // ---------- alarms: legal light, sunrise and sunset ----------
  const alarms = () => { const a = store.get("huntAlarms", null) || {}; return { on: a.on || {}, before: a.before ?? 15, open: !!a.open, at: a.at || null }; };
  // Where the alarms are worked out: your last location, else the spot.
  const alarmPlace = () => { const a = alarms(); return a.at || (spot ? { lat: spot.lat, lon: spot.lon } : null); };
  const fired = new Set();
  function nextAlarms(days = 2) {
    const a = alarms(), pl = alarmPlace(), out = [];
    if (!pl || !Object.values(a.on).some(Boolean)) return out;
    for (let d = 0; d < days; d++) {
      const s = skyDay(pl.lat, pl.lon, d, false);
      for (const [k, n, f] of LIGHT_EVENTS) {
        const t = a.on[k] && f(s);
        if (t) out.push({ key: `${k}@${t.toISOString().slice(0, 16)}`, name: n, event: t, ring: new Date(t - a.before * 60000) });
      }
    }
    return out;
  }
  function checkAlarms() {
    const now = Date.now();
    for (const x of nextAlarms()) {
      if (fired.has(x.key) || x.ring > now || now - x.ring > 5 * 60000) continue;
      fired.add(x.key);
      ring(`${x.name} at ${hm(x.event)}${alarms().before ? ` (in ${alarms().before} min)` : ""}`);
    }
  }
  setInterval(checkAlarms, 20000);
  function ring(text) {
    try { navigator.vibrate && navigator.vibrate([400, 200, 400, 200, 400]); } catch {}
    try {   // three short beeps
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < 3; i++) { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(0.25, ac.currentTime + i * 0.5); o.start(ac.currentTime + i * 0.5); o.stop(ac.currentTime + i * 0.5 + 0.25); }
    } catch {}
    if ("Notification" in window && Notification.permission === "granted") {
      const opts = { body: text, tag: "tf-hunt-alarm", icon: "icons/icon-192.png", badge: "icons/icon-192.png" };
      (navigator.serviceWorker ? navigator.serviceWorker.getRegistration().then((r) => (r ? r.showNotification("Trail Finder", opts) : new Notification("Trail Finder", opts))) : Promise.resolve(new Notification("Trail Finder", opts))).catch(() => {});
    }
    const el = document.createElement("div");
    el.className = "hn-ring"; el.setAttribute("role", "alert");
    el.innerHTML = `${svg(IC.alarm, 22)}<span>${esc(text)}</span><button type="button">OK</button>`;
    el.querySelector("button").addEventListener("click", () => el.remove());
    document.body.append(el);
    setTimeout(() => el.remove(), 60000);
  }
  // An .ics file: the next 14 days of the chosen events at the spot, each with an alert, for the phone's calendar.
  function calendar() {
    const a = alarms(), pl = spot ? { lat: spot.lat, lon: spot.lon } : alarmPlace();
    if (!pl) return;
    if (!Object.values(a.on).some(Boolean)) { hint("Tick the alarms you want first."); return; }
    a.at = pl; store.set("huntAlarms", a);
    const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const ev = [];
    for (let d = 0; d < 14; d++) {
      const s = skyDay(pl.lat, pl.lon, d, false);
      for (const [k, n, f] of LIGHT_EVENTS) {
        const t = a.on[k] && f(s);
        if (!t) continue;
        ev.push(["BEGIN:VEVENT", `UID:tf-hunt-${k}-${stamp(t)}@trail-finder`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(t)}`, `DTEND:${stamp(new Date(t.valueOf() + 60000))}`,
          `SUMMARY:${n}`, `GEO:${pl.lat.toFixed(5)};${pl.lon.toFixed(5)}`, `DESCRIPTION:Hunting light at ${fmtLL(pl.lat, pl.lon)} (Trail Finder)`,
          "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${n}`, `TRIGGER:-PT${a.before}M`, "END:VALARM", "END:VEVENT"].join("\r\n"));
      }
    }
    const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trail Finder//Hunting light//EN", "CALSCALE:GREGORIAN", ...ev, "END:VCALENDAR"].join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const link = document.createElement("a");
    link.href = url; link.download = "hunting-light.ics"; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    hint("Open the downloaded hunting-light.ics to add the alarms to your calendar.");
  }

  // ---------- wind and weather (Open-Meteo) ----------
  const WX = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow",
    75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Thunderstorm, hail" };
  const compass = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  const arrow = (to, size = 34) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="transform:rotate(${to}deg)" aria-hidden="true"><path d="M12 2 18 14h-4v8h-4v-8H6z" fill="${ORANGE}" stroke="#7a2a00" stroke-width="1"/></svg>`;
  let wx = null, wxKey = "", wxBusy = false, wxErr = "";
  const wxCache = new Map();
  async function loadWeather() {
    if (!spot || !isHunt()) return;
    const key = `${spot.lat.toFixed(2)},${spot.lon.toFixed(2)}`;
    const hit = wxCache.get(key);
    if (hit && Date.now() - hit.at < 15 * 60000) { wx = hit.d; wxKey = key; renderWx(); drawWind(); return; }
    if (wxBusy) return;
    wxBusy = true; wxErr = "";
    renderWx();
    try {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${spot.lat.toFixed(3)}&longitude=${spot.lon.toFixed(3)}`
        + "&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover"
        + "&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code&forecast_hours=13&timezone=auto";
      const r = await fetch(u);
      if (!r.ok) throw new Error(r.status === 429 ? "the free weather service is busy, try again in a minute" : `HTTP ${r.status}`);
      wx = await r.json(); wxKey = key;
      wxCache.set(key, { at: Date.now(), d: wx });
    } catch (e) { wxErr = e.message || "no connection"; }
    wxBusy = false;
    renderWx(); renderSky(); drawWind();
    // the spot may have moved while this one loaded
    if (spot && `${spot.lat.toFixed(2)},${spot.lon.toFixed(2)}` !== wxKey && !wxErr) loadWeather();
  }
  function renderWx() {
    const el = $("hnWx");
    if (!spot) { el.innerHTML = `<p class="hn-note">Move the map or tap it to pick a spot.</p>`; return; }
    const where = spot.how === "you" ? "Wind where you are" : spot.how === "tap" ? "Wind at your spot" : "Wind at the map centre";
    let body;
    if (wxErr && !wx) body = `<p class="hn-note">Couldn't load the weather: ${esc(wxErr)}.</p>`;
    else if (!wx) body = `<p class="hn-note">Loading the wind and weather…</p>`;
    else {
      const c = wx.current || {}, dir = c.wind_direction_10m ?? 0, to = (dir + 180) % 360, sp = Math.round(c.wind_speed_10m ?? 0), g = Math.round(c.wind_gusts_10m ?? 0);
      const calm = sp < 4;
      const h = wx.hourly || {};
      const hourHtml = (h.time || []).slice(0, 13).map((_, i) => {
        const t = h.time[i].slice(11, 16), hd = h.wind_direction_10m[i];
        return `<div><b>${t}</b>${arrow((hd + 180) % 360, 18)}<span>${compass(hd)} ${Math.round(h.wind_speed_10m[i])}</span><span>${Math.round(h.temperature_2m[i])}°</span><span>${h.precipitation_probability?.[i] ?? "–"}%</span></div>`;
      }).join("");
      body = `<div class="hn-wind"><div class="hn-arrow" title="The arrow points where the wind blows to">${arrow(to)}</div><div>
        <div class="hn-big">${calm ? "Light and variable" : `From the ${compass(dir)}, ${sp} km/h`}</div>
        <p>${calm ? "Little wind: your scent pools around you, sinking downhill in the evening and rising as the day warms." : `Your scent drifts ${compass(to)} (the orange cone). Approach from the ${compass(to)}, into the wind.`}</p></div></div>
        <div class="hn-stats"><div><b>${Math.round(c.temperature_2m ?? 0)}°</b><span>Feels ${Math.round(c.apparent_temperature ?? 0)}°</span></div><div><b>${g || sp}</b><span>Gusts</span></div>
          <div><b>${c.cloud_cover ?? "–"}%</b><span>Cloud</span></div><div><b>${c.precipitation ?? 0}</b><span>mm now</span></div></div>
        <p class="hn-note">${esc(WX[c.weather_code] || "")} · weather from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> · ${fmtLL(spot.lat, spot.lon)}</p>
        <details><summary>Next 12 hours</summary><div class="hn-hours">${hourHtml}</div><p class="hn-note">Hour, wind from (km/h), temperature, chance of rain or snow.</p></details>`;
    }
    el.innerHTML = `<header>${svg(IC.wind)}<h3>${where}</h3>${spot.how !== "centre" ? `<button type="button" class="hn-pill" id="hnCentre">Map centre</button>` : ""}</header>${body}`;
    const cb = $("hnCentre"); if (cb) cb.addEventListener("click", () => { const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); $("hnSpot").hidden = true; });
  }
  function locate(btn) {
    if (!navigator.geolocation) { hint("This browser can't share your location."); return; }
    if (btn) btn.disabled = true;
    navigator.geolocation.getCurrentPosition((p) => {
      if (btn) btn.disabled = false;
      const a = alarms(); a.at = { lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3) }; store.set("huntAlarms", a);
      setSpot(p.coords.latitude, p.coords.longitude, "you");
      map.setView([p.coords.latitude, p.coords.longitude], Math.max(map.getZoom(), 14));
      showSpot(p.coords.latitude, p.coords.longitude);
    }, (e) => { if (btn) btn.disabled = false; hint(e.code === 1 ? "Location is blocked for this site: allow it in the browser's settings." : "Couldn't find your location."); },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
  // Scent cone: a wedge downwind of the spot, wider when the wind is light (scent spreads more).
  function drawWind() {
    for (const l of windLayer.getLayers()) if (l !== spotMarker) windLayer.removeLayer(l);
    if (!shown.has("wind") || !spot || !wx || !wx.current) { sync3d(); return; }
    const dir = wx.current.wind_direction_10m ?? 0, sp = wx.current.wind_speed_10m ?? 0, to = (dir + 180) % 360;
    const len = Math.min(1500, 400 + sp * 60), half = sp < 4 ? 60 : sp < 10 ? 30 : 20;
    const pt = (bearing, d) => {
      const b = bearing * rad, k = Math.cos(spot.lat * rad);
      return [spot.lat + (d * Math.cos(b)) / 111320, spot.lon + (d * Math.sin(b)) / (111320 * k)];
    };
    const ring = [[spot.lat, spot.lon]];
    for (let a = -half; a <= half; a += 5) ring.push(pt(to + a, len));
    L.polygon(ring, { pane: "hunt", interactive: false, color: ORANGE, weight: 2, fillColor: ORANGE, fillOpacity: 0.25 }).addTo(windLayer);
    L.polyline([[spot.lat, spot.lon], pt(to, len * 0.9)], { pane: "hunt", interactive: false, color: ORANGE, weight: 3 }).addTo(windLayer);
    sync3d();
  }

  // ---------- open seasons (data/hunting/seasons-bc.json and seasons-ab.json) ----------
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const MON = "(?:Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\\.?\\s*\\d{1,2}(?:,?\\s*\\d{4})?";
  const RANGE = new RegExp(`(${MON})\\s*[-–]\\s*(${MON})`, "g");
  // "Sept 10 - Nov 30", "Nov 4 - Nov 7, Nov 11 - Nov 14" or "Oct 10, 2026 - Jan 24, 2027": is today inside one of them? null if none can be read.
  function openNow(text, now = new Date()) {
    const read = (t) => { const m = t.match(/([A-Za-z]{3})[a-z]*\.?\s*(\d{1,2})(?:,?\s*(\d{4}))?/); return m && MONTHS[m[1].toLowerCase()] != null ? { m: MONTHS[m[1].toLowerCase()], d: +m[2], y: m[3] ? +m[3] : null } : null; };
    let any = null;
    for (const [, x, y] of String(text).matchAll(RANGE)) {
      const a = read(x), b = read(y);
      if (!a || !b) continue;
      let open;
      if (a.y && b.y) open = now >= new Date(a.y, a.m, a.d) && now < new Date(b.y, b.m, b.d + 1);
      else {
        const k = (v) => v.m * 100 + v.d, t = now.getMonth() * 100 + now.getDate();
        open = k(a) <= k(b) ? t >= k(a) && t <= k(b) : t >= k(a) || t <= k(b);   // seasons can run over New Year
      }
      if (open) return true;
      any = false;
    }
    return any;
  }
  function seasonsHtml(id, rows, ab, link) {
    if (!rows || !rows.length) return "";
    const by = new Map();
    for (const r of rows) (by.get(r[0]) || by.set(r[0], []).get(r[0])).push(r);
    const now = [...by.keys()].filter((sp) => by.get(sp).some((r) => openNow(r[3])));
    const list = [...by.entries()].map(([sp, rs]) => `<li style="border-color:${rs.some((r) => openNow(r[3])) ? "#2f9e44" : "var(--line)"}"><b>${esc(sp)}</b>${rs.map((r) =>
      `${openNow(r[3]) ? '<span class="hn-open">● Open · </span>' : ""}${r[1] ? esc(r[1]) + ": " : ""}${r[2] ? esc(r[2]) + ", " : ""}${esc(r[3])}${r[4] ? " †" : ""}`).join("<br>")}</li>`).join("");
    return `<details class="hn-seasons"><summary>Seasons in ${ab ? "WMU" : "MU"} ${esc(id)}: ${now.length ? `<span class="hn-open">open now for ${esc(now.join(", "))}</span>` : "none open today"}</summary>
      <ul class="hn-list">${list}</ul><p class="hn-note" style="margin-top:6px">${ab ? "Read by the app from the Alberta Guide to Hunting Regulations. “Special licence (draw)” seasons need a drawn licence. † has a footnote" : "General open seasons, read by the app from the BC Hunting and Trapping Regulations Synopsis (limited entry hunts are listed below). † has footnotes or applies to part of the unit only"}: always check <a href="${link}" target="_blank" rel="noopener">${ab ? "the guide" : "the region's synopsis"}</a> before you hunt.</p></details>`;
  }
  // Limited entry (BC) and special licence draws (Alberta) for a unit, with last year's odds.
  const sameSpecies = (a, b) => { a = a.toLowerCase(); b = b.toLowerCase(); return a.includes(b) || b.includes(a) || a.split(" ").pop() === b.split(" ").pop(); };
  function drawsHtml(u, draws, lehHere) {
    if (!draws) return "";
    if (u.p === "bc") {
      const rows = (draws.bc || {})[u.id] || [];
      if (!rows.length) return "";
      const here = (r) => lehHere.some((z) => z.mu === u.id && sameSpecies(z.s, r.s) && (!r.z || new RegExp(`${r.z}$`).test(z.id)));
      const sorted = [...rows].sort((a, b) => here(b) - here(a) || a.s.localeCompare(b.s) || a.c.localeCompare(b.c));
      const best = rows.filter((r) => r.o).sort((a, b) => parseFloat(a.o) - parseFloat(b.o))[0];
      return `<details><summary>Limited entry hunts in MU ${esc(u.id)}: ${rows.length}${best ? ` · best odds ${esc(best.o)}` : ""}</summary>
        <table class="hn-tbl"><tbody>${sorted.map((r) => `<tr${here(r) ? ' class="here" title="This spot is in the hunt\'s zone"' : ""}><td><b>${esc(r.c)}</b></td><td>${esc(r.s)}, ${esc(r.k)}${r.z ? ` · zone ${esc(r.z)}` : ""}<br><span class="hn-note">${esc(r.d || "")}${r.a ? ` · ${esc(r.a)}` : ""}</span></td><td class="num">${r.n} tags<br>${r.o ? esc(r.o) : "new"}</td></tr>`).join("")}</tbody></table>
        <p class="hn-note" style="margin-top:6px">Odds are last year's first-choice odds from the <a href="${LEH_PDF}" target="_blank" rel="noopener">LEH synopsis</a> (shaded rows: this spot is in the hunt's zone). Apply through <a href="${LEH_PAGE}" target="_blank" rel="noopener">BC Limited Entry Hunting</a>.</p></details>`;
    }
    const rows = (draws.ab || []).filter((r) => r.w.includes(String(u.id)));
    if (!rows.length) return "";
    const pct = (r) => (r.a ? Math.min(100, (r.k / r.a) * 100) : 0);
    return `<details><summary>Draws in WMU ${esc(u.id)}: ${rows.length} hunts</summary>
      <table class="hn-tbl"><tbody>${rows.sort((a, b) => a.s.localeCompare(b.s) || pct(b) - pct(a)).map((r) => `<tr><td><b>${esc(r.c)}</b></td><td>${esc(r.d || r.s)}<br><span class="hn-note">${esc(r.t)}${r.n && r.n !== `WMU ${u.id}` ? ` · ${esc(r.n)}` : ""}</span></td><td class="num">${r.q} tags · ${r.a} applied<br>${r.p != null ? `drawn from ${r.p} pts${r.pp < 100 ? ` (${r.pp}%)` : ""}` : "none drawn"}</td></tr>`).join("")}</tbody></table>
      <p class="hn-note" style="margin-top:6px">This year's draw results from <a href="${AB_DRAWS}" target="_blank" rel="noopener">AlbertaRELM</a>: tags, applicants and the lowest priority anyone was drawn at (with the share drawn at that level).</p></details>`;
  }

  // ---------- what's at a spot ----------
  let spotSeq = 0;
  async function showSpot(lat, lon) {
    const el = $("hnSpot"), seq = ++spotSeq;
    el.hidden = false;
    el.innerHTML = `<header>${svg(IC.pin)}<h3>This spot</h3></header><p class="hn-note">Looking up this spot…</p>`;
    let z = [], l = [], a = [];
    try { zones = zones || (await load("zones")).zones; z = at(zones, lat, lon); } catch {}
    try { leh = leh || (await load("leh")).zones; l = at(leh, lat, lon); } catch {}
    try { areas = areas || (await load("areas")).areas; a = at(areas, lat, lon); } catch {}
    const [sbc, sab, draws] = await Promise.all([z.some((u) => u.p === "bc") ? load("seasons-bc").catch(() => null) : null,
      z.some((u) => u.p === "ab") ? load("seasons-ab").catch(() => null) : null, z.length ? load("draws").catch(() => null) : null]);
    if (seq !== spotSeq) return;
    const items = [];
    for (const u of z) {
      items.push(u.p === "ab"
        ? `<li style="border-color:${C.zone}"><b>Alberta WMU ${esc(u.id)}${u.n ? ` · ${esc(u.n)}` : ""}</b>Licences, weapons and bag limits: <a href="${AB_REGS}" target="_blank" rel="noopener">Alberta Guide to Hunting Regulations</a>.${seasonsHtml(u.id, sab && sab.wmu[u.id], true, AB_REGS)}${drawsHtml(u, draws, l)}</li>`
        : `<li style="border-color:${C.zone}"><b>BC MU ${esc(u.id)}${u.zn ? ` · ${esc(u.zn)}` : ""}</b>Region ${esc(u.r)} ${esc(u.rn || "")}${u.z ? `, game management zone ${esc(u.z)}` : ""}. Bag limits and closures: <a href="${regionPdf(u)}" target="_blank" rel="noopener">Region ${esc(u.r)} synopsis (PDF)</a>.${seasonsHtml(u.id, sbc && sbc.mu[u.id], false, regionPdf(u))}${drawsHtml(u, draws, l)}</li>`);
    }
    if (!z.length) items.push(`<li><b>Outside the BC and Alberta hunting zones</b>Only BC and Alberta zones are on the map so far.</li>`);
    for (const x of l) items.push(`<li style="border-color:${C.leh}"><b>Limited entry zone: ${esc(x.s)}</b>${esc(x.l || x.id)}${x.mu ? ` (MU ${esc(x.mu)})` : ""}. Hunting it needs an LEH draw: see the shaded hunts above.</li>`);
    for (const x of a) {
      const k = AREA_KINDS[x.k]; if (!k) continue;
      const link = ["park", "protected", "conservancy", "rec", "eco"].includes(x.k) && x.p !== "ab" ? ` <a href="https://bcparks.ca/find-a-park/?q=${encodeURIComponent(x.n)}" target="_blank" rel="noopener">BC Parks</a>`
        : x.p === "ab" && ["park", "pra", "wildland", "natural", "rangeland", "wilderness", "eco"].includes(x.k) ? ` <a href="https://www.albertaparks.ca/" target="_blank" rel="noopener">Alberta Parks</a>`
        : x.k === "town" ? ` <a href="https://www.google.com/search?q=${encodeURIComponent(`${x.n} ${x.p === "ab" ? "Alberta" : "BC"} firearm discharge bylaw`)}" target="_blank" rel="noopener">Find ${esc(x.n)}'s firearm bylaw</a>` : "";
      const extra = x.k === "mvpr" ? `${x.t ? esc(x.t) + ": " : ""}${esc(x.d || "")}${x.x ? ` Exempt: ${esc(x.x)}.` : ""}${x.mu ? ` (MU ${esc(x.mu)})` : ""}` : "";
      items.push(`<li style="border-color:${k.color}"><b>${esc(k.label)}: ${esc(x.n || "")}</b>${extra ? extra + " " : ""}${esc(k.rule)}${link}</li>`);
    }
    el.innerHTML = `<header>${svg(IC.pin)}<h3>This spot</h3><button type="button" class="hn-x" aria-label="Close">${svg(IC.x, 14)}</button></header><p class="hn-note">${fmtLL(lat, lon)}</p><ul class="hn-list">${items.join("")}</ul><div id="hnLive"></div>`;
    el.querySelector(".hn-x").addEventListener("click", () => { el.hidden = true; const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); });
    if (z.some((u) => u.p === "ab") || (!z.length && inAlberta(lat, lon))) liveAlberta(lat, lon, seq);
    else liveBC(lat, lon, seq);
  }
  const liveOut = (seq, out) => { if (seq === spotSeq && $("hnLive") && out.length) $("hnLive").innerHTML = `<ul class="hn-list">${out.join("")}</ul>`; };
  // Land owner type, forest stand and burns from DataBC (best effort: answers only when DataBC allows this site to ask).
  async function liveBC(lat, lon, seq) {
    const out = [];
    const q = (layer, geom, props, sortBy) => {   // (each layer names its shape column differently)
      const p = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: layer, outputFormat: "application/json", count: "1",
        propertyName: props, CQL_FILTER: `INTERSECTS(${geom}, SRID=4326;POINT(${lon} ${lat}))` });
      if (sortBy) p.set("sortBy", sortBy);
      return fetch(`${WFS}?${p}`, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : undefined)).then((j) => (j ? j.features?.[0]?.properties || null : undefined)).catch(() => undefined);   // null: nothing there, undefined: no answer
    };
    const [parcel, stand, burn] = await Promise.all([
      q(PMBC, "SHAPE", "OWNER_TYPE,PARCEL_CLASS,MUNICIPALITY,PID_FORMATTED"),
      q(VRI, "GEOMETRY", "SPECIES_CD_1,SPECIES_PCT_1,SPECIES_CD_2,SPECIES_PCT_2,PROJ_AGE_1,PROJ_HEIGHT_1,BCLCS_LEVEL_4,HARVEST_DATE"),
      q(FIRES, "SHAPE", "FIRE_YEAR,FIRE_LABEL,FIRE_SIZE_HECTARES", "FIRE_YEAR D"),
    ]);
    if (parcel) {
      const own = String(parcel.OWNER_TYPE || "");
      out.push(`<li style="border-color:${/private/i.test(own) ? C.private : C.open}"><b>Land: ${esc(own || "parcel")}</b>${/private/i.test(own) ? "Private land: you need the owner's permission to hunt here." : /crown/i.test(own) ? "Crown land: usually open to hunting in season, unless a park, lease or closure says otherwise." : ""}${parcel.PID_FORMATTED ? ` <span class="hn-note">PID ${esc(parcel.PID_FORMATTED)}</span>` : ""}</li>`);
    } else if (parcel === null) out.push(`<li style="border-color:#2f9e44"><b>Land: no titled parcel mapped</b>Most likely Crown land, usually open to hunting in season, unless a park, reserve, lease or closure above says otherwise.</li>`);
    if (stand && stand.SPECIES_CD_1) {
      const sp = (c, p) => (c ? `${esc(SPECIES[c] || c)}${p ? ` ${p}%` : ""}` : "");
      const age = stand.PROJ_AGE_1 != null ? Math.round(stand.PROJ_AGE_1) : null;
      out.push(`<li style="border-color:${(FOREST.find((f) => stand.SPECIES_CD_1.startsWith(f[0])) || [, , "#868e96"])[2]}"><b>Forest: ${sp(stand.SPECIES_CD_1, stand.SPECIES_PCT_1)}${stand.SPECIES_CD_2 ? `, ${sp(stand.SPECIES_CD_2, stand.SPECIES_PCT_2)}` : ""}</b>${age != null ? `About ${age} years old` : ""}${stand.PROJ_HEIGHT_1 ? `, ${Math.round(stand.PROJ_HEIGHT_1)} m tall` : ""}${age != null && age < 25 ? ": young forest, often good browse for deer, elk and moose." : "."}${stand.HARVEST_DATE ? ` Logged ${esc(String(stand.HARVEST_DATE).slice(0, 4))}.` : ""}</li>`);
    }
    if (burn && burn.FIRE_YEAR) out.push(burnItem(burn.FIRE_YEAR, burn.FIRE_LABEL, burn.FIRE_SIZE_HECTARES));
    liveOut(seq, out);
  }
  const burnItem = (year, label, ha) => {
    const ago = YEAR - year;
    return `<li style="border-color:${ago <= 5 ? BURNS[0][2] : ago <= 15 ? BURNS[1][2] : BURNS[2][2]}"><b>Burned in ${esc(year)}</b>Fire ${esc(label || "")}${ha ? `, ${Math.round(ha).toLocaleString()} ha` : ""}.${ago <= 20 ? " Young burns grow back as browse and berries that draw deer, elk, moose and bears." : ""}</li>`;
  };
  // Alberta: forest fuel type, grazing leases, burns and wetlands from Alberta's map server.
  async function liveAlberta(lat, lon, seq) {
    const get = (u) => fetch(u, { signal: AbortSignal.timeout(9000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const box = `${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`;
    const ident = (svc, layers) => get(`${AB}/${svc}/MapServer/identify?geometry=${lon},${lat}&geometryType=esriGeometryPoint&sr=4326&layers=all:${layers}&tolerance=1&mapExtent=${box}&imageDisplay=256,256,96&returnGeometry=false&f=json`);
    const query = (svc, layer, fields) => get(`${AB}/${svc}/MapServer/${layer}/query?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${fields}&returnGeometry=false&f=json`);
    const [fuel, graze, fire, wet] = await Promise.all([ident(FUEL_SVC, "1"), query(GRAZE_SVC, 1, "ACTIVITY_TYPE,COMMON_NAME"),
      ident(FIRE_SVC, "11,12,13,14,15,16,17,18,19,20"), query(WET_SVC, 3, "CWCS_Class")]);
    const out = [];
    const g = graze && graze.features && graze.features[0] && graze.features[0].attributes;
    if (g) out.push(`<li style="border-color:${GRAZE_COLOR}"><b>Land: ${esc(GRAZE[g.ACTIVITY_TYPE] || g.ACTIVITY_TYPE || "Agricultural lease")} on public land</b>Under Alberta's Recreational Access Regulation, contact the leaseholder before you hunt here (the lease's contact is on <a href="https://mywildalberta.ca/hunting/land-access.aspx" target="_blank" rel="noopener">My Wild Alberta: land access</a>).</li>`);
    else if (graze) out.push(`<li style="border-color:#2f9e44"><b>Land: no grazing lease here</b>In the Green Area (public forest) you can usually hunt in season. In the White Area (farm country) most land is private: ask the landowner first.</li>`);
    const f = fuel && fuel.results && fuel.results[0] && fuel.results[0].attributes;
    const ft = f && (f["Raster.FUEL_TYPE_LONG"] || f.FUEL_TYPE_LONG);
    if (ft && !/water|non-fuel/i.test(ft)) out.push(`<li style="border-color:#1b5e20"><b>Forest: ${esc(ft.replace(/^([A-Z]-\d(?:\/[A-Z]-\d)?) \((.*)\)$/, "$2 ($1)"))}</b>Alberta Wildfire's fuel type map, a guide to the forest cover.${/aspen|mixedwood|grass/i.test(ft) ? " Aspen, mixed forest and grass edges are good feed for deer, elk and moose." : ""}</li>`);
    const fr = fire && fire.results && fire.results.map((r) => r.attributes).sort((a, b) => (+b.YEAR || 0) - (+a.YEAR || 0))[0];
    if (fr && fr.YEAR) out.push(burnItem(+fr.YEAR, fr.FIRENUMBER || fr.FIRE_NUMBE, +fr.HECTARES_UTM));
    const w = wet && wet.features && wet.features[0] && wet.features[0].attributes;
    if (w && w.CWCS_Class) out.push(`<li style="border-color:${C.wet}"><b>Wetland: ${esc(w.CWCS_Class)}</b>Alberta Merged Wetland Inventory.</li>`);
    liveOut(seq, out);
  }

  // ---------- quick actions ----------
  pane.querySelector(".hn-actions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, P = window.tfPoints;
    if (act === "me") locate(b);
    else if (act === "rec") { if (window.tfRide && !window.tfRide.riding()) window.tfRide.start(); else hint(window.tfRide ? "Already recording: see the bar at the bottom of the map." : "Recording isn't available here."); }
    else if (!P) hint("Points aren't available in this browser.");
    else if (act === "point") P.add();
    else if (act === "truck") P.markTruck(b);
    else if (act === "back") P.backToTruck(b);
    else if (act === "log") P.openLog();
  });

  // ---------- offline: save this area's hunting layers ----------
  // The data files and the picture tiles of the layers that are on (and the terrain for slope and aspect), zoom 10 to 15,
  // go in the same "tf-offline-1" cache as Offline maps; sw.js answers from it when there's no connection.
  const OFF_CACHE = "tf-offline-1", OFF_KEY = "huntOffline", OFF_MAX = 4000;
  const tx = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const ty = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
  function offUrls(box, layers) {
    const urls = DATA_FILES.map((n) => new URL(`data/hunting/${n}.json`, location.href).href);
    const ab = box[3] > -120.1 && box[0] < 60, bc = box[1] < -114;
    for (let z = 10; z <= 15; z++) {
      const x0 = tx(box[1], z), x1 = tx(box[3], z), y0 = ty(box[2], z), y1 = ty(box[0], z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        for (const p of PICS) if (layers.includes(p.layer) && z >= p.min && (p.ab ? ab : bc)) urls.push(p.tmpl.replace("{bbox}", tileBox(z, x, y)));
        if ((layers.includes("slope") || layers.includes("aspect")) && z <= 14) urls.push(`${DEM}${z}/${x}/${y}.png`);
      }
    }
    return [...new Set(urls)];
  }
  const viewBox = () => { const b = map.getBounds(); return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((v) => +v.toFixed(4)); };
  let offBusy = null;
  function renderOffline() {
    const el = $("hnOff"), saved = store.get(OFF_KEY, []);
    const layers = [...shown].filter((k) => PICS.some((p) => p.layer === k) || k === "slope" || k === "aspect");
    const n = offUrls(viewBox(), layers).length;
    el.innerHTML = `<header>${svg(IC.down)}<h3>Hunting maps offline</h3></header>
      <p class="hn-note">Zones, seasons, draws${layers.length ? ` and ${esc(layers.map((k) => LAYERS[k].label.toLowerCase()).join(", "))}` : ""} for the area on screen, for no signal. The base map is saved with Offline maps in the Layers menu.</p>
      ${offBusy ? `<div class="hn-bar"><i style="width:${Math.round(offBusy.pct)}%"></i></div><p class="hn-note">${esc(offBusy.msg)}</p><div class="hn-row"><button type="button" class="hn-btn ghost" id="hnOffStop">Stop</button></div>`
        : `<div class="hn-row"><button type="button" class="hn-btn" id="hnOffSave"${n > OFF_MAX ? " disabled" : ""}>Save this area</button><span class="hn-note">${n > OFF_MAX ? "Too big: zoom in closer" : `About ${Math.max(1, Math.round(n * 0.03))} MB`}</span></div>`}
      ${saved.length ? `<ul class="hn-list">${saved.map((s, i) => `<li><b>${esc(s.name)}</b><span class="hn-note">${esc(new Date(s.at).toLocaleDateString())} · ${s.n} files${s.missing ? ` · ${s.missing} missing` : ""}</span> <button type="button" class="hn-pill" data-off="${i}">Show</button> <button type="button" class="hn-pill" data-offdel="${i}" style="color:#c0392b">Delete</button></li>`).join("")}</ul>` : ""}`;
    const sv = $("hnOffSave"); if (sv) sv.addEventListener("click", () => saveOffline(layers));
    const st = $("hnOffStop"); if (st) st.addEventListener("click", () => { if (offBusy) offBusy.stop = true; });
    el.querySelectorAll("[data-off]").forEach((b) => b.addEventListener("click", () => { const s = store.get(OFF_KEY, [])[+b.dataset.off]; if (s) map.fitBounds([[s.box[0], s.box[1]], [s.box[2], s.box[3]]]); }));
    el.querySelectorAll("[data-offdel]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again"; return; }
      const list = store.get(OFF_KEY, []), s = list.splice(+b.dataset.offdel, 1)[0];
      store.set(OFF_KEY, list);
      if (s) {   // keep files another saved area still uses
        const keep = new Set(list.flatMap((o) => offUrls(o.box, o.layers)));
        const c = await caches.open(OFF_CACHE);
        await Promise.all(offUrls(s.box, s.layers).filter((u) => !keep.has(u) && !/\/data\/hunting\//.test(u)).map((u) => c.delete(u)));
      }
      renderOffline();
    }));
  }
  async function saveOffline(layers) {
    if (!("caches" in window)) { hint("This browser can't save maps offline."); return; }
    const box = viewBox(), urls = offUrls(box, layers);
    const c = await caches.open(OFF_CACHE);
    offBusy = { pct: 0, msg: "Starting…", stop: false };
    renderOffline();
    let done = 0, bad = 0;
    const queue = [...urls];
    const worker = async () => {
      while (queue.length && !offBusy.stop) {
        const u = queue.shift();
        let ok = false;
        for (let i = 0; i < 3 && !ok; i++) {
          try { const r = await fetch(u, { cache: "no-cache" }); if (r.ok) { await c.put(u, r); ok = true; } else if (r.status === 404) break; } catch {}
          if (!ok) await new Promise((res) => setTimeout(res, 800 * (i + 1)));
        }
        if (!ok) bad++;
        done++;
        offBusy.pct = (done / urls.length) * 100; offBusy.msg = `Saved ${done} of ${urls.length} files${bad ? ` (${bad} failed)` : ""}…`;
        if (done % 20 === 0) renderOffline();
      }
    };
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    const stopped = offBusy.stop;
    offBusy = null;
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
    if (!stopped) {
      const near = zones && zones.find((u) => u.c && inBox(u.b, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2) && inside(u.g, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2));
      const list = store.get(OFF_KEY, []);
      list.unshift({ name: near ? (near.p === "ab" ? `WMU ${near.id}${near.n ? ` ${near.n}` : ""}` : `MU ${near.id}${near.zn ? ` ${near.zn}` : ""}`) : `Area at ${fmtLL((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)}`,
        box, layers, n: urls.length - bad, missing: bad, at: Date.now() });
      store.set(OFF_KEY, list.slice(0, 20));
      hint(bad ? `Saved, but ${bad} files didn't download: save it again with signal to finish.` : "Saved: these hunting layers now work with no signal.");
    }
    renderOffline();
  }

  // ---------- 3D map (map3d.js) ----------
  // map3d.js copies every line on the flat map (zone, park and closure outlines, the scent cone's edge), but not
  // fills, labels, pins or picture layers, so those are added here: the picture layers draped on the terrain, the
  // rules areas and scent cone as see-through fills, the zone labels, and the spot pin. A tap on the 3D map picks a
  // spot as on the flat map.
  let gl3 = null, proto3 = false, fillsSet = false, labelsSet = false, spot3 = null;
  let applyWait = false;
  function sync3d() {
    const gl = gl3;
    if (!gl || !window.maplibregl) return;
    if (!proto3) {
      proto3 = true;
      maplibregl.addProtocol("tfhunt", async (params) => {
        const [mode, z, x, y] = params.url.replace("tfhunt://", "").split("?")[0].split("/");
        const img = await paintTerrain(mode, +z, +x, +y);
        const cv = new OffscreenCanvas(256, 256);
        cv.getContext("2d").putImageData(img, 0, 0);
        return { data: await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer() };
      });
    }
    const apply = () => {
      if (!gl.getStyle()) return;
      const want = (k) => isHunt() && shown.has(k);
      const under = gl.getLayer("osm-roads") ? "osm-roads" : undefined;
      const vis = (id, on) => { if (gl.getLayer(id)) gl.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
      const raster = (id, on, src, opacity) => {
        if (on && !gl.getSource(id)) gl.addSource(id, src);
        if (on && !gl.getLayer(id)) gl.addLayer({ id, type: "raster", source: id, paint: { "raster-opacity": opacity, "raster-fade-duration": 0 } }, under);
        vis(id, on);
      };
      for (const p of PICS) raster(p.id, want(p.layer), { type: "raster", tiles: [p.tmpl.replace("{bbox}", "{bbox-epsg-3857}")], tileSize: 256, minzoom: Math.max(0, p.min - 1), bounds: ((b) => [b[0][1], b[0][0], b[1][1], b[1][0]])(BOUNDS[p.ab ? "ab" : "bc"]), attribution: p.attr.replace(/<[^>]+>/g, "") }, p.opacity);
      raster("hn-slope", want("slope"), { type: "raster", tiles: ["tfhunt://slope/{z}/{x}/{y}"], tileSize: 256, minzoom: 8, maxzoom: 14 }, 1);
      raster("hn-aspect", want("aspect"), { type: "raster", tiles: ["tfhunt://aspect/{z}/{x}/{y}"], tileSize: 256, minzoom: 8, maxzoom: 14 }, 1);
      // Rules areas as fills (their outlines come over with the other lines).
      if (want("rules") && areas && !fillsSet) {
        fillsSet = true;
        const feats = areas.filter((a) => AREA_KINDS[a.k] && !AREA_KINDS[a.k].line).map((a) => {
          const k = AREA_KINDS[a.k];
          return { type: "Feature", properties: { c: k.color, o: fillOp(a.k, k), h: hatched(k) },
            geometry: { type: "Polygon", coordinates: a.g.map((r) => { const out = []; for (let i = 0; i < r.length; i += 2) out.push([r[i + 1], r[i]]); return out; }) } };
        });
        gl.addSource("hn-fill", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
        gl.addLayer({ id: "hn-fill", type: "fill", source: "hn-fill", filter: ["!", ["get", "h"]], paint: { "fill-color": ["get", "c"], "fill-opacity": ["get", "o"] } }, under);
        if (!gl.hasImage("hn-hatch")) gl.addImage("hn-hatch", hatchTile.getContext("2d").getImageData(0, 0, 10, 10));
        gl.addLayer({ id: "hn-hatch", type: "fill", source: "hn-fill", filter: ["get", "h"], paint: { "fill-pattern": "hn-hatch", "fill-opacity": 0.75 } }, under);
      }
      vis("hn-fill", want("rules")); vis("hn-hatch", want("rules"));
      // Zone labels.
      if (want("zones") && zones && !labelsSet) {
        labelsSet = true;
        const feats = zones.filter((u) => u.c).map((u) => ({ type: "Feature", geometry: { type: "Point", coordinates: [u.c[1], u.c[0]] },
          properties: { t: u.p === "ab" ? `WMU ${u.id}` : u.id, n: (u.p === "ab" ? u.n : u.zn) || "", ab: u.p === "ab" } }));
        gl.addSource("hn-labels", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
        gl.addLayer({ id: "hn-labels", type: "symbol", source: "hn-labels", minzoom: 5,
          layout: { "text-field": ["step", ["zoom"], ["get", "t"], 8, ["concat", ["get", "t"], "\n", ["get", "n"]]], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-allow-overlap": false },
          paint: { "text-color": C.zone, "text-halo-color": "#fff", "text-halo-width": 2 } });
      }
      vis("hn-labels", want("zones"));
      // Scent cone fill.
      const cone = windLayer.getLayers().find((l) => l instanceof L.Polygon);
      const coneData = { type: "FeatureCollection", features: cone && want("wind") ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [cone.getLatLngs()[0].map((p) => [p.lng, p.lat]).concat([[cone.getLatLngs()[0][0].lng, cone.getLatLngs()[0][0].lat]])] } }] : [] };
      if (!gl.getSource("hn-cone")) {
        gl.addSource("hn-cone", { type: "geojson", data: coneData });
        gl.addLayer({ id: "hn-cone", type: "fill", source: "hn-cone", paint: { "fill-color": ORANGE, "fill-opacity": 0.25 } }, gl.getLayer("lines") ? "lines" : undefined);
      } else gl.getSource("hn-cone").setData(coneData);
      // The spot pin.
      if (isHunt() && spot && spot.how !== "centre") {
        if (!spot3) { const el = document.createElement("div"); el.className = "hn-spot"; el.style.margin = "0"; spot3 = new maplibregl.Marker({ element: el }); }
        spot3.setLngLat([spot.lon, spot.lat]).addTo(gl);
      } else if (spot3) spot3.remove();
    };
    // isStyleLoaded() is also false while tiles are loading (every tap and move), and "styledata" may not come again:
    // the style itself being ready is enough (alex lost the spot circle in 3D).
    if (gl.style && (gl.style._loaded || gl.isStyleLoaded())) apply();
    else if (!applyWait) { applyWait = true; gl.once("idle", () => { applyWait = false; apply(); }); }
  }
  window.addEventListener("tf:map3d", (e) => {
    gl3 = e.detail;
    fillsSet = labelsSet = false;
    gl3.on("click", (ev) => {
      if (!isHunt() || document.querySelector(".app.riding, .app.planning")) return;
      if (gl3.getLayer("hits") && gl3.queryRenderedFeatures(ev.point, { layers: ["hits"] }).length) return;   // a trail or road line took the tap
      setSpot(ev.lngLat.lat, ev.lngLat.lng, "tap");
      showSpot(ev.lngLat.lat, ev.lngLat.lng);
    });
    sync3d();
  });

  // For ski-points.js: the hunting zone at a point, for the harvest log.
  window.tfHunt = {
    async zoneAt(lat, lon) {
      try { zones = zones || (await load("zones")).zones; } catch { return ""; }
      const u = at(zones, lat, lon)[0];
      return u ? (u.p === "ab" ? `WMU ${u.id}` : `MU ${u.id}`) : "";
    },
  };

  // ---------- switching sport ----------
  map.on("click", (e) => {
    if (!isHunt() || document.querySelector(".app.riding, .app.planning")) return;
    setSpot(e.latlng.lat, e.latlng.lng, "tap");
    showSpot(e.latlng.lat, e.latlng.lng);
    if (window.tfRoadAt) try { window.tfRoadAt(e.latlng); } catch {}   // forest roads, logging areas and fires keep their popups
  });
  let moveTimer = 0;
  map.on("moveend", () => {
    if (!isHunt()) return;
    drawLabels();
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { if (!spot || spot.how === "centre") { const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); } if (!offBusy) renderOffline(); }, 600);
  });
  map.on("zoomend", () => { if (isHunt()) { drawLabels(); renderLayers(); } });
  let started = false;
  function sync() {
    const on = isHunt();
    for (const l of allHunt) { if (on && !map.hasLayer(l)) l.addTo(map); else if (!on && map.hasLayer(l)) map.removeLayer(l); }
    if (on && !keyCtl._map) keyCtl.addTo(map); else if (!on && keyCtl._map) keyCtl.remove();
    syncTiles(); sync3d();
    if (!on) return;
    if (!started) { started = true; if (shown.has("forest")) loadFuelLegend(); renderLayers(); drawZones(); drawLeh(); drawRules(); }
    drawLabels();
    if (!spot) { const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); } else loadWeather();
    renderWx(); renderSky(); renderOffline();
  }
  window.addEventListener("tf:sport", sync);
  sync();
})();
