// Hunting, the third sport in the header's sport menu (MTB / Skiing / Hunting). winter.js owns the menu: it sets
// body.sport-hunt (and body.sport-alt, the class every non-MTB sport shares) and sends "tf:sport".
// In Hunting the MTB trails make way for:
//  - Hunting zones: every BC and Alberta Wildlife Management Unit, labelled, and BC's Limited Entry Hunting zones.
//  - Rules areas: national parks and ecological reserves (no hunting), provincial parks and recreation areas (rules
//    vary), wildlife management areas, First Nation reserves and Metis settlements, towns (shooting usually banned by
//    bylaw), motor vehicle closures, and Alberta's Green Area (public forest land).
//    These three come from data/hunting/*.json, made monthly by .github/workflows/hunting-data.yml (build-hunting.mjs).
//  - Private land (BC ParcelMap, live map images from DataBC) and Forest types (BC Vegetation Resources Inventory:
//    each stand coloured by its leading tree species), also live DataBC map images, styled here with an SLD.
//  - Slope angle and Aspect, painted from the AWS terrain tiles like Skiing's avalanche shading.
//  - Wind and weather at a spot (your location, a tapped spot or the map centre; Open-Meteo, free, no key), with a
//    scent cone drawn downwind of the spot, and the day's sun, legal light, moon and solunar times (worked out here).
// Tapping the map in Hunting picks a spot and lists everything there: zone, limited entry zones, the rules areas,
// and (when DataBC answers) the land owner type and the forest stand.
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
  const WMS = "https://openmaps.gov.bc.ca/geo/pub/wms", WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs";

  // ---------- what each rules area means for hunting ----------
  // no: hunting is not allowed there. A guide only: the regulations and the park's own rules decide.
  const AREA_KINDS = {
    national: { label: "National park", color: "#c1121f", no: true, rule: "No hunting in national parks." },
    eco: { label: "Ecological reserve", color: "#c1121f", no: true, rule: "No hunting in ecological reserves." },
    wilderness: { label: "Wilderness area (Alberta)", color: "#c1121f", no: true, rule: "No hunting in Alberta's wilderness areas." },
    park: { label: "Provincial park", color: "#e8590c", rule: "BC: hunting is allowed in season in many provincial parks, but not in some parks or near campgrounds and trails, so check the park's page. Alberta: hunting isn't allowed in most provincial parks; the Alberta Guide to Hunting Regulations lists the exceptions." },
    protected: { label: "Protected area", color: "#e8590c", rule: "Hunting is often allowed in season in BC protected areas, with each area's own rules: check BC Parks." },
    conservancy: { label: "Conservancy", color: "#e8590c", rule: "Hunting is often allowed in season in BC conservancies, with each one's own rules: check BC Parks." },
    rec: { label: "Recreation area", color: "#e8590c", rule: "Rules vary: check BC Parks." },
    pra: { label: "Provincial recreation area (Alberta)", color: "#e8590c", rule: "Hunting isn't allowed in most of Alberta's provincial recreation areas; the Alberta Guide to Hunting Regulations lists the exceptions." },
    wildland: { label: "Wildland park (Alberta)", color: "#2b8a3e", rule: "Hunting is allowed in season in Alberta's wildland parks (and Willmore Wilderness Park), with the usual licences." },
    natural: { label: "Natural area (Alberta)", color: "#2b8a3e", rule: "Hunting is usually allowed in Alberta's natural areas, with some closures: check the Alberta Guide to Hunting Regulations." },
    rangeland: { label: "Heritage rangeland (Alberta)", color: "#e8590c", rule: "Grazing land: ask the leaseholder and check the Alberta Guide to Hunting Regulations first." },
    wma: { label: "Wildlife management area", color: "#2b8a3e", rule: "Hunting is usually allowed in BC wildlife management areas, but some have their own closures or rules: check the regulations." },
    reserve: { label: "First Nation reserve", color: "#7b2cbf", no: true, rule: "Reserve land: no hunting without the First Nation's permission." },
    metis: { label: "Metis settlement", color: "#7b2cbf", no: true, rule: "Metis settlement land: no hunting without the settlement's permission." },
    town: { label: "Town or city", color: "#495057", rule: "Most towns and cities ban shooting by bylaw. Check the local bylaw before you hunt inside town limits." },
    mvpr: { label: "Motor vehicle closure", color: "#9c36b5", line: true, rule: "Closed to motor vehicles under BC's Motor Vehicle Prohibition Regulation." },
    green: { label: "Green Area (Alberta public forest)", color: "#2f9e44", line: true, rule: "Alberta's Green Area: mostly public forest land, where you can usually hunt in season without asking a landowner (leases and dispositions still have rules)." },
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
  const LEH_PAGE = "https://www2.gov.bc.ca/gov/content/sports-culture/recreation/fishing-hunting/hunting/limited-entry-hunting";

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
  const SLOPES = [[15, "15-25°", "#f2e14c"], [25, "25-35°", "#f59f00"], [35, "35-45°", "#e03131"], [45, "45° and up", "#862e9c"]];
  const ASPECT_COLORS = ["#1c7ed6", "#22b8cf", "#40c057", "#a9e34b", "#fcc419", "#fd7e14", "#f03e3e", "#ae3ec9"];   // N NE E SE S SW W NW
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  const LAYERS = {
    zones: { label: "Hunting zones", on: true },
    leh: { label: "Limited entry zones", on: false },
    rules: { label: "Parks, reserves and closures", on: true },
    land: { label: "Private and public land", on: true },
    forest: { label: "Forest types", on: false },
    slope: { label: "Slope angle", on: false },
    aspect: { label: "Aspect", on: false },
    wind: { label: "Wind and scent", on: true },
  };
  let shown = new Set(store.get("huntLayers", Object.keys(LAYERS).filter((k) => LAYERS[k].on)));

  const css = document.createElement("style");
  css.textContent = `
body:not(.sport-hunt) #huntPane { display: none !important; }
#huntPane { display: flex; flex-direction: column; gap: 12px; font-size: .9rem; }
#huntPane .hn-hint, #huntPane .hn-safe { color: var(--muted); margin: 0; font-size: .82rem; }
#huntPane .hn-chips { display: flex; flex-wrap: wrap; gap: 6px; }
#huntPane .hn-chip { font: inherit; font-size: .8rem; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
#huntPane .hn-chip[aria-pressed="false"] { opacity: .55; }
#huntPane .hn-card { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: var(--panel); display: flex; flex-direction: column; gap: 6px; }
#huntPane .hn-card h3 { margin: 0; font-size: 1rem; }
#huntPane .hn-card h4 { margin: 4px 0 0; font-size: .88rem; }
#huntPane .hn-card p { margin: 0; font-size: .84rem; }
#huntPane .hn-note { color: var(--muted); font-size: .76rem; }
#huntPane .hn-x { float: right; font: inherit; border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 1rem; }
#huntPane .hn-wind { display: flex; align-items: center; gap: 12px; }
#huntPane .hn-arrow { width: 54px; height: 54px; flex: none; border-radius: 50%; background: var(--chip); display: grid; place-items: center; }
#huntPane .hn-arrow svg { transition: transform .3s; }
#huntPane .hn-big { font-size: 1.05rem; font-weight: 700; }
#huntPane .hn-row { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: .84rem; }
#huntPane .hn-hours { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(46px, 1fr); gap: 4px; overflow-x: auto; padding-bottom: 2px; }
#huntPane .hn-hours div { background: var(--chip); border-radius: 8px; padding: 4px 2px; text-align: center; font-size: .72rem; display: flex; flex-direction: column; align-items: center; gap: 1px; }
#huntPane .hn-hours b { font-size: .74rem; }
#huntPane .hn-sun { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: .82rem; }
#huntPane .hn-sun dt { color: var(--muted); }
#huntPane .hn-sun dd { margin: 0; }
#huntPane .hn-spotbtns { display: flex; flex-wrap: wrap; gap: 6px; }
#huntPane .hn-spotbtns button { font: inherit; font-size: .78rem; font-weight: 600; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
#huntPane ul.hn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
#huntPane ul.hn-list li { border-left: 4px solid var(--line); padding-left: 8px; font-size: .84rem; }
#huntPane ul.hn-list li b { display: block; }
#huntPane .hn-key { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; font-size: .78rem; }
#huntPane .hn-key i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; border: 1px solid #0002; }
#huntPane details summary { cursor: pointer; font-weight: 600; font-size: .85rem; }
.hn-label { background: #fff; color: #7a3300; border: 1.5px solid #e8590c; border-radius: 6px; padding: 1px 5px; font: 700 11px/1.2 var(--font-body, system-ui); white-space: nowrap; box-shadow: 0 1px 2px #0003; transform: translate(-50%, -50%); width: max-content; pointer-events: none; }
.hn-label.ab { color: #0b4a8b; border-color: #1c7ed6; }
.hn-label small { font-weight: 500; color: #555; }
.hn-spot { width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; border: 3px solid #e8590c; background: #fff6; box-shadow: 0 0 0 2px #fff; }
.hn-spot::after { content: ""; position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px; border-radius: 50%; background: #e8590c; }`;
  document.head.append(css);

  // ---------- panel ----------
  const pane = document.createElement("section");
  pane.id = "huntPane";
  pane.setAttribute("aria-label", "Hunting");
  pane.innerHTML = `
    <p class="hn-hint">Hunting zones for all of BC and Alberta, parks, reserves and closures, private land, forest types, slope, and the wind and weather where you are. <strong>Tap the map</strong> to see the zone, rules and wind for that spot.</p>
    <div class="hn-card" id="hnWx"><p class="hn-note">Loading the wind and weather…</p></div>
    <div class="hn-card" id="hnSpot" hidden></div>
    <div><div class="label">Show on the map</div><div class="hn-chips" id="hnChips" role="group" aria-label="Hunting layers"></div></div>
    <div class="hn-card" id="hnKeyCard"><ul class="hn-key" id="hnKey"></ul></div>
    <p class="hn-safe">A guide, not the law: zones, parks and closures come from BC and Alberta open data and can be out of date or simplified at their edges. Always check the <a href="${BC_SYNOPSIS}" target="_blank" rel="noopener">BC Hunting and Trapping Regulations Synopsis</a> or the <a href="${AB_REGS}" target="_blank" rel="noopener">Alberta Guide to Hunting Regulations</a>, and get permission before hunting private land.</p>`;
  const head = document.querySelector(".panel-head");
  const skiPane = $("skiPane"), modes = head && head.querySelector(".modes");
  if (skiPane) skiPane.after(pane); else if (modes) modes.after(pane); else if (head) head.append(pane);

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

  // ---------- map layers ----------
  map.createPane("hunt").style.zIndex = 405;
  map.createPane("huntTiles").style.zIndex = 350;
  map.createPane("huntLabels").style.zIndex = 640;
  map.getPane("huntLabels").style.pointerEvents = "none";
  const renderer = L.canvas({ pane: "hunt", padding: 0.3 });
  const zoneLayer = L.layerGroup(), lehLayer = L.layerGroup(), rulesLayer = L.layerGroup(), labelLayer = L.layerGroup(), windLayer = L.layerGroup();
  const allHunt = [zoneLayer, lehLayer, rulesLayer, labelLayer, windLayer];
  let zones = null, leh = null, areas = null;

  async function drawZones() {
    zoneLayer.clearLayers();
    if (!shown.has("zones")) { labelLayer.clearLayers(); return; }
    try { zones = zones || (await load("zones")).zones; } catch { return; }
    for (const z of zones) {
      L.polygon(ringsLL(z.g), { renderer, interactive: false, color: z.p === "ab" ? "#1c7ed6" : "#e8590c", weight: 2, opacity: 0.85, fill: false }).addTo(zoneLayer);
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
        icon: L.divIcon({ className: "", html: `<div class="hn-label${u.p === "ab" ? " ab" : ""}">${name}</div>`, iconSize: [0, 0] }) }).addTo(labelLayer);
    }
  }
  async function drawLeh() {
    lehLayer.clearLayers();
    if (!shown.has("leh")) return;
    try { leh = leh || (await load("leh")).zones; } catch { return; }
    for (const z of leh) L.polygon(ringsLL(z.g), { renderer, interactive: false, color: "#6741d9", weight: 1.5, dashArray: "6 5", opacity: 0.8, fill: false }).addTo(lehLayer);
  }
  async function drawRules() {
    rulesLayer.clearLayers();
    if (!shown.has("rules") && !shown.has("land")) return;
    try { areas = areas || (await load("areas")).areas; } catch { return; }
    for (const a of areas) {
      const k = AREA_KINDS[a.k];
      if (!k) continue;
      const want = a.k === "green" ? shown.has("land") : shown.has("rules");
      if (!want) continue;
      L.polygon(ringsLL(a.g), { renderer, interactive: false, color: k.color, weight: k.line ? 1.5 : 1, dashArray: a.k === "mvpr" ? "8 4" : null,
        opacity: 0.8, fill: !k.line, fillColor: k.color, fillOpacity: k.no ? 0.2 : a.k === "town" ? 0.12 : 0.1 }).addTo(rulesLayer);
    }
    sync3d();
  }
  // Private land: BC ParcelMap parcels owned privately, orange (live map images from DataBC; BC only).
  const landTiles = L.tileLayer.wms(WMS, { pane: "huntTiles", layers: PMBC, styles: "", format: "image/png", transparent: true, opacity: 0.45, minZoom: 11, maxZoom: 20, uppercase: true,
    SLD_BODY: sld(PMBC, [[`<PropertyIsEqualTo><PropertyName>OWNER_TYPE</PropertyName><Literal>Private</Literal></PropertyIsEqualTo>`, "#ff8c00"]]),
    attribution: 'Land: <a href="https://ltsa.ca/property-owners/about-land-records/parcelmap-bc/">ParcelMap BC</a>, DataBC' });
  const forestTiles = L.tileLayer.wms(WMS, { pane: "huntTiles", layers: VRI, styles: "", format: "image/png", transparent: true, opacity: 0.5, minZoom: 11, maxZoom: 20, uppercase: true,
    SLD_BODY: forestSld(),
    attribution: 'Forest: <a href="https://www2.gov.bc.ca/gov/content/industry/forestry/managing-our-forest-resources/forest-inventory">BC Vegetation Resources Inventory</a>' });

  // Slope angle and aspect from the terrain tiles (Terrarium colour code, 256 px, up to zoom 14).
  const demCache = new Map();
  function dem(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (demCache.has(key)) return demCache.get(key);
    const p = fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
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
  const slopeGrid = new TerrainGrid({ ...terrainOpts, mode: "slope" }), aspectGrid = new TerrainGrid({ ...terrainOpts, mode: "aspect" });
  const tiles = { land: landTiles, forest: forestTiles, slope: slopeGrid, aspect: aspectGrid };

  function syncTiles() {
    for (const [k, l] of Object.entries(tiles)) {
      const want = isHunt() && shown.has(k);
      if (want && !map.hasLayer(l)) l.addTo(map); else if (!want && map.hasLayer(l)) map.removeLayer(l);
    }
  }

  // ---------- chips and key ----------
  function renderChips() {
    $("hnChips").innerHTML = Object.entries(LAYERS).map(([k, l]) => `<button type="button" class="hn-chip" data-k="${k}" aria-pressed="${shown.has(k)}">${esc(l.label)}</button>`).join("");
  }
  $("hnChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]"); if (!b) return;
    const k = b.dataset.k;
    if (shown.has(k)) shown.delete(k); else shown.add(k);
    if (k === "slope" && shown.has("slope")) shown.delete("aspect");   // one terrain shading at a time
    if (k === "aspect" && shown.has("aspect")) shown.delete("slope");
    store.set("huntLayers", [...shown]);
    renderChips(); renderKey(); syncTiles(); sync3d();
    if (k === "zones") drawZones();
    if (k === "leh") drawLeh();
    if (k === "rules" || k === "land") drawRules();
    if (k === "wind") drawWind();
    const z = map.getZoom();
    if ((k === "land" || k === "forest") && shown.has(k) && z < 11) hint("Zoom in closer to see " + (k === "land" ? "private land." : "the forest types."));
    if ((k === "slope" || k === "aspect") && shown.has(k) && z < 9) hint("Zoom in closer to see the " + (k === "slope" ? "slope angles." : "aspects."));
  });
  const sw = (c, dashed) => `<i style="background:${dashed ? "transparent" : c};border:2px ${dashed ? "dashed" : "solid"} ${c}"></i>`;
  function renderKey() {
    const rows = [];
    if (shown.has("zones")) rows.push(`<li>${sw("#e8590c", true)}BC hunting zone (WMU)</li>`, `<li>${sw("#1c7ed6", true)}Alberta WMU</li>`);
    if (shown.has("leh")) rows.push(`<li>${sw("#6741d9", true)}Limited entry zone</li>`);
    if (shown.has("rules")) rows.push(`<li>${sw("#c1121f")}No hunting</li>`, `<li>${sw("#e8590c")}Park: rules vary</li>`, `<li>${sw("#2b8a3e")}Usually open in season</li>`,
      `<li>${sw("#7b2cbf")}Reserve: ask first</li>`, `<li>${sw("#495057")}Town: shooting banned by bylaw</li>`, `<li>${sw("#9c36b5", true)}Motor vehicle closure</li>`);
    if (shown.has("land")) rows.push(`<li>${sw("#ff8c00")}Private land (BC)</li>`, `<li>${sw("#2f9e44", true)}Public forest (Alberta Green Area)</li>`);
    if (shown.has("forest")) rows.push(...FOREST.map(([, n, c]) => `<li>${sw(c)}${esc(n)}</li>`), `<li>${sw("#808080")}Other species</li>`);
    if (shown.has("slope")) rows.push(...SLOPES.map(([, n, c]) => `<li>${sw(c)}${esc(n)}</li>`));
    if (shown.has("aspect")) rows.push(...DIRS.map((d, i) => `<li>${sw(ASPECT_COLORS[i])}Faces ${d}</li>`));
    if (shown.has("wind")) rows.push(`<li>${sw("#f08c00")}Scent cone (downwind)</li>`);
    $("hnKey").innerHTML = rows.join("");
    $("hnKeyCard").hidden = !rows.length;
  }
  let hintTimer = 0;
  function hint(text) {
    let el = $("hnHint");
    if (!el) { el = document.createElement("p"); el.id = "hnHint"; el.className = "hn-note"; $("hnChips").after(el); }
    el.textContent = text;
    clearTimeout(hintTimer); hintTimer = setTimeout(() => el.remove(), 6000);
  }

  // ---------- the spot: your location, a tapped spot or the map centre ----------
  let spot = null;   // { lat, lon, how: "you" | "tap" | "centre" }
  const spotMarker = L.marker([0, 0], { pane: "huntLabels", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: '<div class="hn-spot"></div>', iconSize: [0, 0] }) });
  function setSpot(lat, lon, how) {
    spot = { lat, lon, how };
    if (how === "centre") windLayer.removeLayer(spotMarker); else { spotMarker.setLatLng([lat, lon]); windLayer.addLayer(spotMarker); }
    loadWeather(); sync3d();
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
  // The day's sun and moon events, by sampling every 5 minutes from local midnight.
  // Times show in the spot's own time zone once the weather has loaded (Open-Meteo says it), else this device's.
  const tzOff = () => (wx && wx.utc_offset_seconds != null ? wx.utc_offset_seconds : -new Date().getTimezoneOffset() * 60) * 1000;
  function skyDay(lat, lon) {
    const off = tzOff(), start = new Date(Math.floor((Date.now() + off) / dayMs) * dayMs - off);
    const step = 5 * 60000, out = { rise: null, set: null, moonRise: null, moonSet: null, transit: null, under: null };
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
  const span = (d, mins) => (d ? `${hm(new Date(d - mins * 60000))} to ${hm(new Date(d.valueOf() + mins * 60000))}` : "");
  function skyHtml(lat, lon) {
    const s = skyDay(lat, lon), ph = moonPhase(new Date()), p = PHASES.find((x) => ph.phase < x[0]) || PHASES[0];
    const legal = s.rise && s.set ? `${hm(new Date(s.rise - 30 * 60000))} to ${hm(new Date(s.set.valueOf() + 30 * 60000))}` : "no sunrise or sunset today";
    const major = [s.transit, s.under].filter(Boolean).sort((a, b) => a - b).map((d) => span(d, 60)).join(", ");
    const minor = [s.moonRise, s.moonSet].filter(Boolean).sort((a, b) => a - b).map((d) => span(d, 30)).join(", ");
    return `<h4>Today's light and moon</h4><dl class="hn-sun">
      <dt>Sunrise, sunset</dt><dd>${hm(s.rise)}, ${hm(s.set)}</dd>
      <dt>Legal light</dt><dd>${legal} <span class="hn-note">(half an hour before sunrise to half an hour after sunset, the usual hunting hours in BC and Alberta; some hunts differ)</span></dd>
      <dt>Moon</dt><dd>${p[2]} ${p[1]}, ${Math.round(ph.fraction * 100)}% lit · rises ${hm(s.moonRise)}, sets ${hm(s.moonSet)}</dd>
      <dt>Feeding times</dt><dd>Major ${major || "none"}${minor ? ` · minor ${minor}` : ""} <span class="hn-note">(solunar tables: moon overhead and underfoot, moonrise and moonset; a traditional guide, not a promise)</span></dd>
    </dl><p class="hn-note">${wx && wx.timezone_abbreviation ? `Local time at the spot (${esc(wx.timezone_abbreviation)}).` : "Times on this device's clock."}</p>`;
  }

  // ---------- wind and weather (Open-Meteo) ----------
  const WX = { 0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Cloudy", 45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow",
    75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Heavy snow showers", 95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Thunderstorm, hail" };
  const compass = (deg) => DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  const arrow = (to, size = 34) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="transform:rotate(${to}deg)" aria-hidden="true"><path d="M12 2 18 14h-4v8h-4v-8H6z" fill="#f08c00" stroke="#7a3d00" stroke-width="1"/></svg>`;
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
    renderWx(); drawWind();
    // the spot may have moved while this one loaded
    if (spot && `${spot.lat.toFixed(2)},${spot.lon.toFixed(2)}` !== wxKey && !wxErr) loadWeather();
  }
  function renderWx() {
    const el = $("hnWx");
    if (!spot) { el.innerHTML = `<p class="hn-note">Move the map or tap it to pick a spot.</p>`; return; }
    const where = spot.how === "you" ? "Where you are" : spot.how === "tap" ? "At the spot you tapped" : "At the map centre";
    const btns = `<div class="hn-spotbtns"><button type="button" id="hnMe">📍 Use my location</button>${spot.how !== "centre" ? `<button type="button" id="hnCentre">Follow the map centre</button>` : ""}</div>`;
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
      body = `<div class="hn-wind"><div class="hn-arrow" title="Arrow points where the wind blows to">${arrow(to)}</div><div>
        <div class="hn-big">${calm ? "Light and variable" : `Wind from the ${compass(dir)}`} · ${sp} km/h${g > sp + 3 ? `, gusts ${g}` : ""}</div>
        <p>${calm ? "Little wind: your scent pools and drifts around you, and goes downhill in the evening and uphill as the day warms." : `Your scent drifts ${compass(to)} (the orange cone on the map). Approach from the ${compass(to)} side, into the wind.`}</p></div></div>
        <div class="hn-row"><span>${esc(WX[c.weather_code] || "")}</span><span>${Math.round(c.temperature_2m ?? 0)}° (feels ${Math.round(c.apparent_temperature ?? 0)}°)</span><span>Rain/snow ${c.precipitation ?? 0} mm now</span><span>Cloud ${c.cloud_cover ?? "–"}%</span></div>
        <details><summary>Next 12 hours (wind from, km/h, temperature, chance of rain or snow)</summary><div class="hn-hours">${hourHtml}</div></details>`;
    }
    el.innerHTML = `<h3>${where}</h3><p class="hn-note">${fmtLL(spot.lat, spot.lon)} · weather: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a></p>${btns}${body}${skyHtml(spot.lat, spot.lon)}`;
    $("hnMe").addEventListener("click", locate);
    const cb = $("hnCentre"); if (cb) cb.addEventListener("click", () => { const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); $("hnSpot").hidden = true; });
  }
  function locate() {
    if (!navigator.geolocation) { hint("This browser can't share your location."); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      setSpot(p.coords.latitude, p.coords.longitude, "you");
      map.setView([p.coords.latitude, p.coords.longitude], Math.max(map.getZoom(), 14));
      showSpot(p.coords.latitude, p.coords.longitude);
    }, (e) => hint(e.code === 1 ? "Location is blocked for this site: allow it in the browser's settings." : "Couldn't find your location."), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
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
    L.polygon(ring, { pane: "hunt", interactive: false, color: "#e8590c", weight: 2, fillColor: "#f08c00", fillOpacity: 0.3 }).addTo(windLayer);
    L.polyline([[spot.lat, spot.lon], pt(to, len * 0.9)], { pane: "hunt", interactive: false, color: "#d9480f", weight: 3 }).addTo(windLayer);
    sync3d();
  }

  // ---------- what's at a spot ----------
  async function showSpot(lat, lon) {
    const el = $("hnSpot");
    el.hidden = false;
    el.innerHTML = `<p class="hn-note">Looking up this spot…</p>`;
    let z = [], l = [], a = [];
    try { zones = zones || (await load("zones")).zones; z = at(zones, lat, lon); } catch {}
    try { leh = leh || (await load("leh")).zones; l = at(leh, lat, lon); } catch {}
    try { areas = areas || (await load("areas")).areas; a = at(areas, lat, lon); } catch {}
    const items = [];
    for (const u of z) {
      items.push(u.p === "ab"
        ? `<li style="border-color:#1c7ed6"><b>Alberta Wildlife Management Unit ${esc(u.id)}${u.n ? ` (${esc(u.n)})` : ""}</b>Seasons, licences and weapons for this unit are in the <a href="${AB_REGS}" target="_blank" rel="noopener">Alberta Guide to Hunting Regulations</a> (look up WMU ${esc(u.id)}).</li>`
        : `<li style="border-color:#e8590c"><b>BC Management Unit ${esc(u.id)}</b>Region ${esc(u.r)} ${esc(u.rn || "")}${u.zn ? `, game management zone ${esc(u.z)} ${esc(u.zn)}` : ""}. Seasons, bag limits and closures for MU ${esc(u.id)}: <a href="${regionPdf(u)}" target="_blank" rel="noopener">Region ${esc(u.r)} regulations (PDF)</a>.</li>`);
    }
    if (!z.length) items.push(`<li><b>Outside the BC and Alberta hunting zones</b>Only BC and Alberta zones are on the map so far.</li>`);
    for (const x of l) items.push(`<li style="border-color:#6741d9"><b>Limited entry hunting: ${esc(x.s)}</b>${esc(x.l || x.id)}${x.mu ? ` (MU ${esc(x.mu)})` : ""}. This hunt needs an LEH draw: <a href="${LEH_PAGE}" target="_blank" rel="noopener">BC Limited Entry Hunting</a>.</li>`);
    for (const x of a) {
      const k = AREA_KINDS[x.k]; if (!k) continue;
      const link = ["park", "protected", "conservancy", "rec", "eco"].includes(x.k) && x.p !== "ab" ? ` <a href="https://bcparks.ca/find-a-park/?q=${encodeURIComponent(x.n)}" target="_blank" rel="noopener">BC Parks</a>`
        : x.p === "ab" && ["park", "pra", "wildland", "natural", "rangeland", "wilderness", "eco"].includes(x.k) ? ` <a href="https://www.albertaparks.ca/" target="_blank" rel="noopener">Alberta Parks</a>` : "";
      const extra = x.k === "mvpr" ? `${x.t ? esc(x.t) + ": " : ""}${esc(x.d || "")}${x.x ? ` Exempt: ${esc(x.x)}.` : ""}${x.mu ? ` (MU ${esc(x.mu)})` : ""}` : "";
      items.push(`<li style="border-color:${k.color}"><b>${esc(k.label)}: ${esc(x.n || "")}</b>${extra ? extra + " " : ""}${esc(k.rule)}${link}</li>`);
    }
    el.innerHTML = `<button type="button" class="hn-x" aria-label="Close">✕</button><h3>This spot</h3><p class="hn-note">${fmtLL(lat, lon)}</p><ul class="hn-list">${items.join("")}</ul><div id="hnLive"></div>`;
    el.querySelector(".hn-x").addEventListener("click", () => { el.hidden = true; const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); });
    if (z.some((u) => u.p === "bc") || !z.length) liveSpot(lat, lon);
  }
  // Land owner type and forest stand from DataBC (best effort: answers only when DataBC allows this site to ask).
  let liveSeq = 0;
  async function liveSpot(lat, lon) {
    const seq = ++liveSeq, out = [];
    const q = (layer, geom, props) => {   // (each layer names its shape column differently)
      const p = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: layer, outputFormat: "application/json", count: "1",
        propertyName: props, CQL_FILTER: `INTERSECTS(${geom}, SRID=4326;POINT(${lon} ${lat}))` });
      return fetch(`${WFS}?${p}`, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : undefined)).then((j) => (j ? j.features?.[0]?.properties || null : undefined)).catch(() => undefined);   // null: nothing there, undefined: no answer
    };
    const [parcel, stand] = await Promise.all([
      q(PMBC, "SHAPE", "OWNER_TYPE,PARCEL_CLASS,MUNICIPALITY,PID_FORMATTED"),
      q(VRI, "GEOMETRY", "SPECIES_CD_1,SPECIES_PCT_1,SPECIES_CD_2,SPECIES_PCT_2,PROJ_AGE_1,PROJ_HEIGHT_1,BCLCS_LEVEL_4,HARVEST_DATE"),
    ]);
    if (seq !== liveSeq || !$("hnLive")) return;
    if (parcel) {
      const own = String(parcel.OWNER_TYPE || "");
      out.push(`<li style="border-color:${/private/i.test(own) ? "#ff8c00" : "#2f9e44"}"><b>Land: ${esc(own || "parcel")}</b>${/private/i.test(own) ? "Private land: you need the owner's permission to hunt here." : /crown/i.test(own) ? "Crown land: usually open to hunting in season, unless a park, lease or closure says otherwise." : ""}${parcel.PID_FORMATTED ? ` <span class="hn-note">PID ${esc(parcel.PID_FORMATTED)}</span>` : ""}</li>`);
    }
    else if (parcel === null) out.push(`<li style="border-color:#2f9e44"><b>Land: no titled parcel mapped</b>Most likely Crown land, usually open to hunting in season, unless a park, reserve, lease or closure above says otherwise.</li>`);
    if (stand && stand.SPECIES_CD_1) {
      const sp = (c, p) => (c ? `${esc(SPECIES[c] || c)}${p ? ` ${p}%` : ""}` : "");
      const age = stand.PROJ_AGE_1 != null ? Math.round(stand.PROJ_AGE_1) : null;
      out.push(`<li style="border-color:${(FOREST.find((f) => stand.SPECIES_CD_1.startsWith(f[0])) || [, , "#868e96"])[2]}"><b>Forest: ${sp(stand.SPECIES_CD_1, stand.SPECIES_PCT_1)}${stand.SPECIES_CD_2 ? `, ${sp(stand.SPECIES_CD_2, stand.SPECIES_PCT_2)}` : ""}</b>${age != null ? `About ${age} years old` : ""}${stand.PROJ_HEIGHT_1 ? `, ${Math.round(stand.PROJ_HEIGHT_1)} m tall` : ""}${age != null && age < 25 ? ": young forest, often good browse for deer, elk and moose." : "."}${stand.HARVEST_DATE ? ` Logged ${esc(String(stand.HARVEST_DATE).slice(0, 4))}.` : ""}</li>`);
    }
    if (out.length) $("hnLive").innerHTML = `<ul class="hn-list">${out.join("")}</ul>`;
  }

  // ---------- 3D map (map3d.js) ----------
  // map3d.js copies every line on the flat map (zone, park and closure outlines, the scent cone's edge), but not
  // fills, labels, pins or picture layers, so those are added here: private land, forest types, slope and aspect
  // as picture layers draped on the terrain, the rules areas and scent cone as see-through fills, the zone labels,
  // and the spot pin. A tap on the 3D map picks a spot as on the flat map.
  let gl3 = null, proto3 = false, fillsSet = false, labelsSet = false, spot3 = null;
  const wmsTiles = (layer) => {
    const p = { ...layer.wmsParams, width: 256, height: 256, srs: "EPSG:3857" };
    return `${WMS}${L.Util.getParamString(p, WMS, true)}&BBOX={bbox-epsg-3857}`;
  };
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
      raster("hn-land", want("land"), { type: "raster", tiles: [wmsTiles(landTiles)], tileSize: 256, minzoom: 10, attribution: "Land: ParcelMap BC, DataBC" }, 0.45);
      raster("hn-forest", want("forest"), { type: "raster", tiles: [wmsTiles(forestTiles)], tileSize: 256, minzoom: 10, attribution: "Forest: BC Vegetation Resources Inventory" }, 0.5);
      raster("hn-slope", want("slope"), { type: "raster", tiles: ["tfhunt://slope/{z}/{x}/{y}"], tileSize: 256, minzoom: 8, maxzoom: 14 }, 1);
      raster("hn-aspect", want("aspect"), { type: "raster", tiles: ["tfhunt://aspect/{z}/{x}/{y}"], tileSize: 256, minzoom: 8, maxzoom: 14 }, 1);
      // Rules areas as fills (their outlines come over with the other lines).
      if (want("rules") && areas && !fillsSet) {
        fillsSet = true;
        const feats = areas.filter((a) => AREA_KINDS[a.k] && !AREA_KINDS[a.k].line).map((a) => {
          const k = AREA_KINDS[a.k];
          return { type: "Feature", properties: { c: k.color, o: k.no ? 0.2 : a.k === "town" ? 0.12 : 0.1 },
            geometry: { type: "Polygon", coordinates: a.g.map((r) => { const out = []; for (let i = 0; i < r.length; i += 2) out.push([r[i + 1], r[i]]); return out; }) } };
        });
        gl.addSource("hn-fill", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
        gl.addLayer({ id: "hn-fill", type: "fill", source: "hn-fill", paint: { "fill-color": ["get", "c"], "fill-opacity": ["get", "o"] } }, under);
      }
      vis("hn-fill", want("rules"));
      // Zone labels.
      if (want("zones") && zones && !labelsSet) {
        labelsSet = true;
        const feats = zones.filter((u) => u.c).map((u) => ({ type: "Feature", geometry: { type: "Point", coordinates: [u.c[1], u.c[0]] },
          properties: { t: u.p === "ab" ? `WMU ${u.id}` : u.id, n: (u.p === "ab" ? u.n : u.zn) || "", ab: u.p === "ab" } }));
        gl.addSource("hn-labels", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
        gl.addLayer({ id: "hn-labels", type: "symbol", source: "hn-labels", minzoom: 5,
          layout: { "text-field": ["step", ["zoom"], ["get", "t"], 8, ["concat", ["get", "t"], "\n", ["get", "n"]]], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-allow-overlap": false },
          paint: { "text-color": ["case", ["get", "ab"], "#0b4a8b", "#7a3300"], "text-halo-color": "#fff", "text-halo-width": 2 } });
      }
      vis("hn-labels", want("zones"));
      // Scent cone fill.
      const cone = windLayer.getLayers().find((l) => l instanceof L.Polygon);
      const coneData = { type: "FeatureCollection", features: cone && want("wind") ? [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [cone.getLatLngs()[0].map((p) => [p.lng, p.lat]).concat([[cone.getLatLngs()[0][0].lng, cone.getLatLngs()[0][0].lat]])] } }] : [] };
      if (!gl.getSource("hn-cone")) {
        gl.addSource("hn-cone", { type: "geojson", data: coneData });
        gl.addLayer({ id: "hn-cone", type: "fill", source: "hn-cone", paint: { "fill-color": "#f08c00", "fill-opacity": 0.3 } }, gl.getLayer("lines") ? "lines" : undefined);
      } else gl.getSource("hn-cone").setData(coneData);
      // The spot pin.
      if (isHunt() && spot && spot.how !== "centre") {
        if (!spot3) { const el = document.createElement("div"); el.className = "hn-spot"; el.style.margin = "0"; spot3 = new maplibregl.Marker({ element: el }); }
        spot3.setLngLat([spot.lon, spot.lat]).addTo(gl);
      } else if (spot3) spot3.remove();
    };
    if (gl.isStyleLoaded()) apply(); else gl.once("styledata", apply);
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
    moveTimer = setTimeout(() => { if (!spot || spot.how === "centre") { const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); } }, 600);
  });
  map.on("zoomend", () => { if (isHunt()) drawLabels(); });
  let started = false;
  function sync() {
    const on = isHunt();
    for (const l of allHunt) { if (on && !map.hasLayer(l)) l.addTo(map); else if (!on && map.hasLayer(l)) map.removeLayer(l); }
    syncTiles(); sync3d();
    if (!on) return;
    if (!started) { started = true; renderChips(); renderKey(); drawZones(); drawLeh(); drawRules(); }
    drawLabels();
    if (!spot) { const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); } else loadWeather();
    renderWx();
  }
  window.addEventListener("tf:sport", sync);
  sync();
})();
