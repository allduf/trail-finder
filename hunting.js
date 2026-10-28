// Hunting, the third sport in the header's sport menu (MTB / Skiing / Hunting). winter.js owns the menu: it sets
// body.sport-hunt (and body.sport-alt, the class every non-MTB sport shares) and sends "tf:sport".
// The panel, top to bottom:
//  - Quick actions: my location, save a point, mark the truck, back to the truck, the hunting log, record a walk
//    (the points, truck and log live in ski-points.js).
//  - This spot (after a tap on the map): zone, open seasons today, limited entry and draw hunts with their odds, the
//    parks, towns and closures there, and what DataBC or Alberta's map server say about the land, forest, burns and water.
//  - Conditions: wind and weather at the spot (Open-Meteo), the scent cone, and today's light, moon and feeding times,
//    with alarms for legal light, sunrise and sunset (in the app, or added to the phone's calendar).
//  - Map layers in groups, each with its own key when on: hunting zones (BC and Alberta WMUs, BC limited entry zones,
//    and the other provinces' zones: Quebec zones, Ontario WMUs, Manitoba GHAs... loaded only near the map),
//    parks, towns, reserves and closures, private and public land, forest types, old burns, wetlands, slope, aspect,
//    the scent cone and range rings.
//  - Offline: saves the hunting layers of the area on screen for use with no signal.
// Zones, areas, seasons and draw results come from data/hunting/*.json, made monthly by .github/workflows/hunting-data.yml
// (scripts/build-hunting.mjs; the other provinces and territories: scripts/hunting-canada.mjs). The picture layers are live map images from DataBC (BC) and Alberta's map server.
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
    zone: "#343a40", leh: "#c2255c", no: "#e03131", vary: "#1971c2", open: "#2f9e44", reserve: "#7048e8", town: "#f03e3e",
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
    wind: '<path d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 10v3l2 2M5 3 2 6M19 3l3 3"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    square: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M10 4h4M20 10v4M10 20h4M4 10v4"/>',
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
    provforest: { label: "Provincial forest (Manitoba)", color: C.green, line: true, dash: "6 4", rule: "Crown forest land: usually open to hunting in season without asking a landowner (cottage lots, leases and closures still have rules)." },
    // the other provinces and territories (data/hunting/areas-<pv>.json)
    qcpark: { label: "Quebec national park", color: C.no, no: true, rule: "No hunting in Quebec's national parks (Sépaq)." },
    qcclosed: { label: "Hunting not allowed", color: C.no, no: true, rule: "Quebec's wildlife ministry lists this as territory where hunting isn't allowed (or only some hunting is)." },
    refuge: { label: "Wildlife refuge or preserve", color: C.no, no: true, rule: "Wildlife refuges, sanctuaries and game preserves: hunting isn't allowed, or only for some species or seasons. Check the province's rules for this one." },
    preserve: { label: "Crown game preserve (Ontario)", color: C.no, no: true, rule: "No hunting or trapping in Ontario's Crown game preserves, except where the regulations allow it." },
    closed: { label: "Closed to hunting (Manitoba)", color: C.no, no: true, rule: "Manitoba closes this land to hunting, or to some hunting, under the Wildlife Act." },
    mbs: { label: "Migratory bird sanctuary", color: C.vary, rule: "No hunting of migratory birds in a migratory bird sanctuary (and often no firearms in season). Other hunting depends on the land's own rules." },
    nwa: { label: "National wildlife area", color: C.vary, rule: "Hunting only where the area's notice allows it, often with a permit from the Canadian Wildlife Service." },
    zec: { label: "ZEC (controlled harvesting zone)", color: C.open, rule: "Public land run by a local association: you can hunt in season, but you must register at the ZEC's entry station and pay the daily fee. Some ZECs have their own seasons (see Seasons)." },
    qcwres: { label: "Wildlife reserve (Quebec)", color: C.vary, rule: "Big game hunting in wildlife reserves is mostly by Sépaq draw or hunting package; small game with a Sépaq day pass. Check the reserve's page on sepaq.com." },
    outfit: { label: "Outfitter with exclusive rights", color: C.vary, rule: "An outfitter holds the hunting rights here: you can only hunt as the outfitter's client." },
    afc: { label: "Community wildlife area (Quebec)", color: C.vary, rule: "Run by a local organisation, mostly for fishing: check its rules before you hunt." },
    wmaopen: { label: "Wildlife management area", color: C.open, rule: "Public land kept for wildlife: hunting is usually allowed in season, but some areas have their own rules or closures." },
    consres: { label: "Conservation reserve (Ontario)", color: C.open, rule: "Hunting is allowed in most of Ontario's conservation reserves, in season, with the usual licences." },
    consarea: { label: "Conservation area", color: C.vary, rule: "Conservation authority land: hunting only where the authority allows it, often with a permit." },
    wild: { label: "Wilderness area", color: C.open, rule: "Hunting is usually allowed in season in wilderness areas and biodiversity reserves (vehicles only on open roads)." },
    pasture: { label: "Provincial pasture (Saskatchewan)", color: C.vary, rule: "Grazing land: ask the pasture manager before you hunt." },
    rcgp: { label: "Road corridor game preserve (Saskatchewan)", color: C.vary, rule: "Big game hunting is limited along this road: check the Saskatchewan Hunters' and Trappers' Guide." },
  };
  // The same kind of place reads differently outside BC and Alberta.
  const RULE_PV = {
    park: "Rules vary from park to park: many parks don't allow hunting, some allow it in season outside campgrounds and trails. Check the park's own rules.",
    protected: "Hunting rules depend on the area's class: some ban it, many allow it in season. Check the province's rules for it.",
    national: "No hunting in national parks (land claim beneficiaries may harvest in some northern parks).",
  };
  const ruleOf = (x, k) => (x.p && x.p !== "ab" && x.p !== "bc" && RULE_PV[x.k]) || k.rule;
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
  // The other provinces and territories (alex 2026-10-26: hunting everywhere in Canada): their files load only when
  // the map or the spot is near them. box [s, w, n, e] (rough, may overlap a neighbour), unit: what a zone is called.
  const QC_REGS = "https://www.quebec.ca/tourisme-loisirs-sport/activites-sportives-et-de-plein-air/chasse-sportive";
  const PV = {
    qc: { box: [44.9, -79.8, 62.7, -57.1], name: "Quebec", unit: "Zone", zones: 1, regs: QC_REGS, regsName: "Québec.ca: chasse sportive" },
    on: { box: [41.6, -95.2, 56.9, -74.3], name: "Ontario", unit: "WMU", zones: 1, regs: "https://www.ontario.ca/document/ontario-hunting-regulations-summary", regsName: "Ontario Hunting Regulations Summary" },
    mb: { box: [48.9, -102.1, 60.1, -88.9], name: "Manitoba", unit: "GHA", zones: 1, regs: "https://www.gov.mb.ca/nrnd/fish-wildlife/hunting/guide.html", regsName: "Manitoba Hunting Guide" },
    sk: { box: [48.9, -110.1, 60.1, -101.3], name: "Saskatchewan", unit: "WMZ", zones: 1, regs: "https://www.saskatchewan.ca/hunting", regsName: "Saskatchewan Hunters' and Trappers' Guide" },
    nb: { box: [44.5, -69.1, 48.1, -63.7], name: "New Brunswick", unit: "WMZ", zones: 1, regs: "https://www2.gnb.ca/content/gnb/en/services/services_renderer.201244.Hunting_and_Trapping_Guide.html", regsName: "New Brunswick Hunting and Trapping Guide" },
    ns: { box: [43.3, -66.5, 47.1, -59.6], name: "Nova Scotia", unit: "Deer zone", zones: 1, regs: "https://novascotia.ca/natr/hunt/", regsName: "Nova Scotia Hunting and Trapping Guide" },
    pe: { box: [45.9, -64.5, 47.1, -61.9], name: "Prince Edward Island", unit: "", regs: "https://www.princeedwardisland.ca/en/topic/hunting-angling-and-trapping", regsName: "PEI Hunting Summary" },
    nl: { box: [46.6, -67.9, 60.5, -52.5], name: "Newfoundland and Labrador", unit: "Moose area", zones: 1, regs: "https://www.gov.nl.ca/hunting-trapping-guide/", regsName: "NL Hunting and Trapping Guide" },
    yt: { box: [59.9, -141.1, 69.7, -123.7], name: "Yukon", unit: "GMA", zones: 1, regs: "https://yukon.ca/en/outdoor-recreation-and-wildlife/hunting-and-trapping", regsName: "Yukon Hunting Regulations Summary" },
    nt: { box: [59.9, -136.5, 78.9, -101.9], name: "Northwest Territories", unit: "", regs: "https://www.gov.nt.ca/ecc/en/services/hunting", regsName: "NWT hunting regulations" },
    nu: { box: [51.6, -121.1, 83.2, -61.1], name: "Nunavut", unit: "", regs: "https://www.gov.nu.ca/en/environment-and-wildlife/wildlife-regulations", regsName: "Nunavut Hunting Regulations" },
  };
  // A zone's name: short on the map ("WMU 65"), long in the spot card ("Ontario WMU 65").
  const zoneName = (u, long) => {
    if (u.p === "ab") return `${long ? "Alberta " : ""}WMU ${u.id}`;
    if (u.p === "bc") return long ? `BC MU ${u.id}` : u.id;
    const pv = PV[u.p] || {}, id = u.p === "qc" ? u.n : u.id;
    // Quebec on the map: the official short code ("27O" = 27 ouest, "8N" = 8 nord), the full name under it zoomed in
    if (u.p === "qc" && !long) return String(u.id).replace(/^0/, "").replace(/(Z|I|MR|SB)$/, "");
    if (u.p === "on" && !long) return u.id;   // southern Ontario's WMUs are small: the number alone, like BC's
    return `${long ? `${pv.name} ` : ""}${long ? pv.unit.toLowerCase().replace(/^(wmu|gha|wmz|gma)$/, (m) => m.toUpperCase()) : pv.unit} ${id}`.replace(/^ +/, "");
  };
  const zoneSub = (u) => (u.p === "ab" || u.p === "nl" ? u.n : u.p === "bc" ? u.zn : u.p === "qc" ? `Zone ${u.n}` : "") || "";
  // Quebec's islands, Rigaud and Seigneurie de Beaupré pieces and CWD parts: no label of their own (their zone has one)
  const labelled = (u) => u.c && !(u.p === "qc" && (u.isl || u.sp || u.cwd || /SB$/.test(u.id)));
  // Quebec's zone maps (one PDF per zone, a few zones share one).
  const QC_MAP = { 5: "carte-zone-chasse-05-06-en", 6: "carte-zone-chasse-05-06-en", 10: "10-11", 11: "10-11", 12: "12-13", 13: "12-13", 16: "16-17", 17: "16-17", 20: "20-21", 21: "20-21", 23: "23-24", 24: "23-24" };
  const qcMap = (no) => { const m = QC_MAP[+no]; return /^carte/.test(m || "") ? `https://cdn-contenu.quebec.ca/cdn-contenu/chasse/Documents/${m}.pdf` : `https://cdn-contenu.quebec.ca/cdn-contenu/chasse/Documents/Anglais/CA_hunting-map-zone-${m || String(no).padStart(2, "0")}_MFFP.pdf`; };

  // Forest types, simplified for hunters (alex: "what the hunters really need"): what each stand gives game, not its
  // tree species. Hunters read cover (where game beds and hides), feed (browse, grass, berries) and the edges between.
  // BC VRI: BCLCS_LEVEL_4 = TC conifer, TB broadleaf, TM mixed, ST/SL shrubs, HE/HF/HG herbs and grass; CROWN_CLOSURE %
  // (onX's thermal cover uses 70%+ canopy; 60% here keeps the class useful on BC's thinner interior stands); PROJ_AGE_1 years.
  // [id, colour, name, why it matters]
  const FOREST = [
    ["thick", "#0b5d1e", "Thick timber", "Bedding, shade, escape and winter cover. Game beds here by day, often near the edges."],
    ["open", "#69db7c", "Open timber", "Thinner conifer forest: travel routes, some grass and shrubs underneath, easier to see through."],
    ["leafy", "#ffd43b", "Aspen, birch and mixed", "Leafy forest with lots of browse: deer, elk, moose and grouse feed here."],
    ["young", "#e64980", "Young forest and brush", "Regrowth under 25 years old and shrubs: the best browse and berries, thick enough to hide in."],
    ["grass", "#a87b4f", "Meadow and grass", "Open feeding ground for elk, deer and sheep: glass it at first and last light."],
  ];
  const FOREST_BY = Object.fromEntries(FOREST.map((f) => [f[0], f]));
  // Which class a VRI stand is in (the same rules as the map tiles below).
  const standClass = (s) => {
    const l4 = String(s.BCLCS_LEVEL_4 || ""), age = s.PROJ_AGE_1;
    if ((l4[0] === "T" && age != null && age < 25) || l4 === "ST" || l4 === "SL") return "young";
    if (l4 === "TC") return s.CROWN_CLOSURE >= 60 ? "thick" : "open";
    if (l4 === "TB" || l4 === "TM") return "leafy";
    if (l4[0] === "H") return "grass";
    return null;
  };
  const SPECIES = {
    FD: "Douglas-fir", FDC: "Douglas-fir (coast)", FDI: "Douglas-fir (interior)", CW: "Western redcedar", YC: "Yellow-cedar", HW: "Western hemlock",
    HM: "Mountain hemlock", SX: "Hybrid spruce", SE: "Engelmann spruce", SW: "White spruce", SB: "Black spruce", SS: "Sitka spruce", PL: "Lodgepole pine",
    PLI: "Lodgepole pine", PLC: "Shore pine", PY: "Ponderosa pine", PA: "Whitebark pine", PW: "Western white pine", BL: "Subalpine fir",
    BA: "Amabilis fir", BG: "Grand fir", LW: "Western larch", LA: "Alpine larch", AT: "Trembling aspen", AC: "Cottonwood", ACT: "Black cottonwood",
    EP: "Paper birch", DR: "Red alder", MB: "Bigleaf maple",
  };
  const sld = (layer, rules) => `<StyledLayerDescriptor version="1.0.0"><NamedLayer><Name>${layer}</Name><UserStyle><FeatureTypeStyle>${rules.map(([filter, color]) =>
    `<Rule><Filter>${filter}</Filter>${color.startsWith("<PolygonSymbolizer") ? color : `<PolygonSymbolizer><Fill><CssParameter name="fill">${color}</CssParameter></Fill></PolygonSymbolizer>`}</Rule>`).join("")}</FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
  // Five rules, kept short so the style fits in a map tile's web address (DataBC refuses ~4 KB): instead of "and not
  // young" on every rule, later rules paint over earlier ones on the same stand (thick over open, young over everything).
  const forestSld = () => {
    const P = (n) => `<PropertyName>${n}</PropertyName>`, L = (v) => `<Literal>${v}</Literal>`;
    const is = (n, v) => `<PropertyIsEqualTo>${P(n)}${L(v)}</PropertyIsEqualTo>`, any = (vs) => `<Or>${vs.map((v) => is("BCLCS_LEVEL_4", v)).join("")}</Or>`;
    return sld(VRI, [
      [is("BCLCS_LEVEL_4", "TC"), FOREST_BY.open[1]],
      [`<And>${is("BCLCS_LEVEL_4", "TC")}<PropertyIsGreaterThanOrEqualTo>${P("CROWN_CLOSURE")}${L(60)}</PropertyIsGreaterThanOrEqualTo></And>`, FOREST_BY.thick[1]],
      [any(["TB", "TM"]), FOREST_BY.leafy[1]],
      [any(["HE", "HF", "HG"]), FOREST_BY.grass[1]],
      [`<Or><And>${is("BCLCS_LEVEL_2", "T")}<PropertyIsLessThan>${P("PROJ_AGE_1")}${L(25)}</PropertyIsLessThan></And>${is("BCLCS_LEVEL_4", "ST")}${is("BCLCS_LEVEL_4", "SL")}</Or>`, FOREST_BY.young[1]],
    ]);
  };
  // Alberta's fuel type map uses its own colours: each fuel type sorted into the same five classes for the key.
  const fuelClass = (label) => {
    const m = String(label).match(/^([A-Z])-(\d)/), code = m ? m[1] + m[2] : "";
    if (code === "C2") return "thick";                                   // boreal spruce
    if (code === "C4" || code === "C6" || m?.[1] === "S") return "young";  // young pine, plantations, logging slash
    if (/^C[1357]$/.test(code)) return "open";                           // lichen woodland, mature pine, ponderosa / fir
    if (m && /[DM]/.test(m[1])) return "leafy";                          // aspen and mixedwood
    if (m?.[1] === "O" || /grass/i.test(label)) return "grass";
    return null;
  };
  // The fuel map's own colours (its legend, 2023 grid), repainted on the phone in the five classes above, so both
  // provinces read the same. A colour not listed (water, rock, a new legend) is left clear.
  const FUEL_RGB = {
    "226633": "thick", d1ff73: "open", "83c795": "open", dfb8e6: "open", "700cf2": "open", "70a800": "young", ac66ed: "young",
    fbbeb9: "young", f768a1: "young", "897044": "leafy", ffd37f: "leafy", ffaa00: "leafy", ffffbe: "grass",
  };
  const VRI = "pub:WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY", PMBC = "pub:WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW";
  const FIRES = "pub:WHSE_LAND_AND_NATURAL_RESOURCE.PROT_HISTORICAL_FIRE_POLYS_SP", WETLANDS = "pub:WHSE_BASEMAPPING.FWA_WETLANDS_POLY";
  // Old burns by age: young burns green up into good feed (browse and berries) for several years.
  const YEAR = new Date().getFullYear();
  // Charred black stripes over a light wash, closer for younger burns (alex: "make that layer easier to see"): brown
  // fills vanished into the forest types and the 3D photos; stripes read over any colour. [from, to, stripe gap px, name]
  const BURNS = [[YEAR - 5, YEAR, 5, "Burned in the last 5 years"], [YEAR - 15, YEAR - 6, 9, "Burned 6-15 years ago"], [YEAR - 30, YEAR - 16, 15, "Burned 16-30 years ago"]];
  const BURN = "#111111";
  // GeoServer hatch: a white wash, black diagonal stripes every gap px and a black edge.
  const burnSym = (gap) => `<PolygonSymbolizer><Fill><CssParameter name="fill">#ffffff</CssParameter><CssParameter name="fill-opacity">0.3</CssParameter></Fill></PolygonSymbolizer>`
    + `<PolygonSymbolizer><Fill><GraphicFill><Graphic><Mark><WellKnownName>shape://slash</WellKnownName><Stroke><CssParameter name="stroke">${BURN}</CssParameter><CssParameter name="stroke-width">1.5</CssParameter></Stroke></Mark><Size>${gap}</Size></Graphic></GraphicFill></Fill><Stroke><CssParameter name="stroke">${BURN}</CssParameter><CssParameter name="stroke-width">2</CssParameter></Stroke></PolygonSymbolizer>`;
  const burnCss = (gap) => `background:#fff repeating-linear-gradient(135deg, ${BURN} 0 1.5px, transparent 1.5px ${Math.max(3, gap / 2)}px);border:1.5px solid ${BURN}`;
  const between = (p, a, b) => `<PropertyIsBetween><PropertyName>${p}</PropertyName><LowerBoundary><Literal>${a}</Literal></LowerBoundary><UpperBoundary><Literal>${b}</Literal></UpperBoundary></PropertyIsBetween>`;
  const SLOPES = [[15, "15-25°", "#f2e14c"], [25, "25-35°", "#f59f00"], [35, "35-45°", "#e03131"], [45, "45° and up", "#862e9c"]];
  const ASPECT_COLORS = ["#1c7ed6", "#22b8cf", "#40c057", "#a9e34b", "#fcc419", "#fd7e14", "#f03e3e", "#ae3ec9"];   // N NE E SE S SW W NW
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  // Alberta grazing and farm dispositions on public land: under the Recreational Access Regulation, contact the leaseholder first.
  const GRAZE = { GRL: "Grazing lease", FGL: "Forest grazing licence", FDL: "Farm development lease", GRP: "Grazing permit", CUP: "Cultivation permit", HAY: "Hay permit" };
  const GRAZE_COLOR = C.graze;
  // Far from roads (alex: "add it all"): every drivable road drawn as a band 500 m and 1.5 km wide on each side, grey,
  // so the country past them, where few hunters walk to, stays clear. [metres each side, colour, label]
  const REACH = [[1500, "#ced4da", "0.5 to 1.5 km from a road"], [500, "#868e96", "Within 500 m of a road"]];
  // Cut blocks by age (BC's consolidated cut blocks, by harvest year): dots in a wash, the colour by age.
  // [newest age, oldest age, colour, dot px, label]
  const CUTS = [[0, 4, "#f59f00", 4, "Logged 0-4 years ago: open, little cover yet"], [5, 20, "#2b8a3e", 5, "Logged 5-20 years ago: thick browse, prime feed"], [21, 40, "#868e96", 4, "Logged 21-40 years ago: closing in"]];
  const cutSym = (c, size) => `<PolygonSymbolizer><Fill><CssParameter name="fill">#ffffff</CssParameter><CssParameter name="fill-opacity">0.3</CssParameter></Fill></PolygonSymbolizer>`
    + `<PolygonSymbolizer><Fill><GraphicFill><Graphic><Mark><WellKnownName>circle</WellKnownName><Fill><CssParameter name="fill">${c}</CssParameter></Fill></Mark><Size>${size}</Size></Graphic></GraphicFill></Fill><Stroke><CssParameter name="stroke">${c}</CssParameter><CssParameter name="stroke-width">1.5</CssParameter></Stroke><VendorOption name="graphic-margin">3</VendorOption></PolygonSymbolizer>`;
  const cutCss = (c) => `background:#fff radial-gradient(${c} 1.6px, transparent 1.9px) 0 0 / 5px 5px;border:1.5px solid ${c}`;

  const LAYERS = {
    zones: { g: "Boundaries", label: "Hunting zones", sub: "Management units and zones across Canada", on: true, sw: [C.zone, "line"] },
    leh: { g: "Boundaries", label: "Limited entry zones", sub: "BC draw-only hunts", on: false, sw: [C.leh, "dash"] },
    rules: { g: "Boundaries", label: "Parks, towns and closures", sub: "Where hunting is banned or has its own rules (ZECs and outfitters in Quebec)", on: true, sw: [C.no, "hatch"] },
    land: { g: "Land", label: "Private and public land", sub: "Crown land and private land from each province's map (BC private parcels, Alberta Green Area)", on: false, sw: [C.open, "fill"], minZoom: 9 },
    reach: { g: "Land", label: "Far from roads", sub: "Clear where you're over 1.5 km from any road: few hunters walk that far", on: false, sw: [REACH[1][1], "fill"], minZoom: 9 },
    forest: { g: "Habitat", label: "Forest types", sub: "Thick timber, open timber, aspen, young forest and brush, meadows", on: false, sw: ["#1b5e20", "fill"], minZoom: 8 },
    burns: { g: "Habitat", label: "Old burns", sub: "Fire scars by age: young burns grow feed", on: false, sw: [BURN, "burn"], minZoom: 7 },
    cut: { g: "Habitat", label: "Cut blocks by age", sub: "Logged areas (BC): 5-20 year old ones are prime browse", on: false, sw: [CUTS[1][2], "cut"], minZoom: 10 },
    wet: { g: "Habitat", label: "Wetlands", sub: "Marshes, fens, bogs and swamps", on: false, sw: [C.wet, "fill"], minZoom: 10 },
    slope: { g: "Terrain", label: "Slope angle", sub: "Steepness in four bands", on: false, sw: ["#e03131", "fill"], minZoom: 9 },
    aspect: { g: "Terrain", label: "Aspect", sub: "Which way each slope faces", on: false, sw: ["#40c057", "fill"], minZoom: 9 },
    wind: { g: "Tools", label: "Scent cone", sub: "Where the wind carries your scent", on: true, sw: [ORANGE, "cone"] },
    rings: { g: "Tools", label: "Range rings", sub: "50 to 400 m around the spot", on: false, sw: [C.rings, "ring"] },
  };
  const GROUPS = ["Boundaries", "Land", "Habitat", "Terrain", "Tools"];
  // Map views (alex: "make it more simple"): one tap sets the layers for a job; All layers still has every switch.
  const VIEWS = {
    rules: { label: "Rules", sub: "where to hunt", layers: ["zones", "rules", "land"] },
    scout: { label: "Scouting", sub: "feed, far from roads", layers: ["zones", "burns", "cut", "reach"] },
    hunt: { label: "On the hunt", sub: "wind and range", layers: ["zones", "wind", "rings"] },
  };
  const RINGS = [50, 100, 200, 300, 400];   // metres around the spot
  // "huntLayers2": the first version turned on more layers at first; everyone starts again from the lighter set.
  let shown = new Set(store.get("huntLayers2", Object.keys(LAYERS).filter((k) => LAYERS[k].on)));
  let glass = null;   // the glassing view on the map: { at: "lat,lon", url, box: [w, s, e, n] }
  let meas = null;    // the measure tool's points while it's on
  // Glassing: the ground within GLASS_M you can see from a spot. Dark is hidden; trees aren't in the terrain tiles.
  const GLASS_M = 5000, GLASS_DARK = "rgba(15,20,30,.53)";
  const GLASS_NOTE = "Clear ground is in sight from here, or a few steps to the edge (up to 100 m), as far as 5 km. Dark ground is hidden behind a ridge or a rise. Trees aren't counted, so look for openings and cut blocks.";

  const css = document.createElement("style");
  css.textContent = `
body:not(.sport-hunt) #huntPane, body:not(.sport-hunt) .lm-hunt { display: none !important; }
.lm-hunt { display: flex; flex-direction: column; gap: 0; }
.lm-hunt .hn-note { color: var(--muted); font-size: .74rem; margin: 2px 0 4px; }
.lm-hunt .hn-group { margin: 0; font-size: .66rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding-top: 6px; }
.lm-hunt .hn-layer { padding: 4px 0; }
#huntPane #hnAll { align-self: flex-start; }
#huntPane { display: flex; flex-direction: column; gap: 12px; font-size: .9rem; }
#huntPane .hn-note { color: var(--muted); font-size: .76rem; margin: 0; }
#huntPane .hn-safe { color: var(--muted); margin: 0; font-size: .76rem; line-height: 1.4; }
#huntPane .hn-safe summary { font-size: .78rem; }
#huntPane #hnOffBox { display: block; }
#huntPane #hnOffBox > summary { display: flex; align-items: center; gap: 8px; font-size: .95rem; font-weight: 800; }
#huntPane #hnOffBox > summary svg { color: ${ORANGE}; }
#huntPane #hnOff { display: flex; flex-direction: column; gap: 8px; }
#huntPane a { color: var(--accent); }
#huntPane .hn-actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
#huntPane .hn-now { font: inherit; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; text-align: left; width: 100%; padding: 9px 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; font-size: .82rem; }
#huntPane .hn-now b { font-weight: 800; }
#huntPane .hn-now span { display: inline-flex; align-items: center; gap: 5px; }
#huntPane .hn-now svg { color: ${ORANGE}; flex: none; }
#huntPane .hn-hour { display: flex; flex-direction: column; gap: 2px; font-size: .8rem; margin-top: 8px; }
#huntPane .hn-hour input { width: 100%; accent-color: ${ORANGE}; }
#huntPane .hn-therm { font-size: .82rem; margin: 4px 0 0; font-weight: 600; }
#huntPane ul.hn-cast { list-style: none; margin: 4px 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
#huntPane ul.hn-cast li { display: grid; grid-template-columns: 5.5em auto 1fr; gap: 0 8px; align-items: baseline; font-size: .84rem; }
#huntPane ul.hn-cast small { grid-column: 1 / -1; color: var(--muted); font-size: .74rem; }
#huntPane .hn-stars { color: #f59f00; letter-spacing: 1px; }
#huntPane .hn-stars i { color: var(--line); font-style: normal; }
#huntPane .hn-tmenu { display: flex; gap: 6px; flex-wrap: wrap; }
#huntPane .hn-views { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
#huntPane .hn-view { font: inherit; font-size: .8rem; font-weight: 700; padding: 8px 4px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 1px; }
#huntPane .hn-view small { font-weight: 500; font-size: .68rem; color: var(--muted); }
#huntPane .hn-view.on { background: ${ORANGE}; border-color: ${ORANGE}; color: #fff; }
#huntPane .hn-view.on small { color: #fff; }
#huntPane details > summary { cursor: pointer; font-weight: 700; font-size: .84rem; padding: 2px 0; }
#huntPane .hn-fold { border-top: 1px solid var(--line); padding-top: 6px; }
#huntPane .hn-zone { font-size: 1rem; font-weight: 800; margin: 0; }
#huntPane .hn-chips { display: flex; flex-wrap: wrap; gap: 5px; }
#huntPane .hn-chip { font-size: .74rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; border: 1.5px solid var(--c, var(--line)); background: color-mix(in srgb, var(--c, transparent) 12%, var(--panel)); color: var(--fg); }
#huntPane .hn-sub { display: flex; align-items: center; gap: 6px; margin: 4px 0 0; font-size: .84rem; font-weight: 800; }
#huntPane .hn-sub svg { color: ${ORANGE}; }
#huntPane .hn-act { font: inherit; font-size: .74rem; font-weight: 700; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 58px; padding: 6px 4px;
  border-radius: 12px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; text-align: center; line-height: 1.15; }
#huntPane .hn-act svg { color: ${ORANGE}; }
#huntPane .hn-act:active { transform: scale(.97); }
#huntPane .hn-act:disabled { opacity: .6; }
#huntPane .hn-act.on { background: ${ORANGE}; border-color: ${ORANGE}; color: #fff; }
#huntPane .hn-act.on svg { color: #fff; }
#huntPane .hn-card { border: 1px solid var(--line); border-radius: 14px; padding: 12px; background: var(--panel); display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm); }
#huntPane .hn-card header { display: flex; align-items: center; gap: 8px; }
#huntPane .hn-card header svg { color: ${ORANGE}; flex: none; }
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
#huntPane .hn-tbl tr.hd td { font-weight: 700; white-space: normal; vertical-align: bottom; }
#huntPane .hn-open { color: #2b8a3e; font-weight: 800; }
:is(#huntPane, .lm-hunt) .hn-group { margin: 0; font-size: .7rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding-top: 4px; }
:is(#huntPane, .lm-hunt) .hn-layer { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: center; padding: 6px 0; cursor: pointer; }
:is(#huntPane, .lm-hunt) .hn-layer b { display: block; font-size: .86rem; }
:is(#huntPane, .lm-hunt) .hn-layer small { display: block; color: var(--muted); font-size: .74rem; line-height: 1.25; }
:is(#huntPane, .lm-hunt) .hn-layer small.z { color: ${ORANGE}; }
:is(#huntPane, .lm-hunt) .hn-ic { width: 22px; height: 22px; border-radius: 6px; display: block; box-sizing: border-box; }
:is(#huntPane, .lm-hunt) .hn-sw-input { appearance: none; -webkit-appearance: none; width: 40px; height: 24px; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; margin: 0; transition: background .15s; flex: none; }
:is(#huntPane, .lm-hunt) .hn-sw-input::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px #0004; transition: left .15s; }
:is(#huntPane, .lm-hunt) .hn-sw-input:checked { background: ${ORANGE}; }
:is(#huntPane, .lm-hunt) .hn-sw-input:checked::after { left: 19px; }
:is(#huntPane, .lm-hunt) .hn-sw-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
/* the map credits get long with several layers on: one line (tap to read it all), clear of the Key button */
body.sport-hunt .leaflet-bottom.leaflet-right { max-width: calc(100% - 120px); }
body.sport-hunt .leaflet-container .leaflet-control-attribution:not(.open) { max-width: 100%; box-sizing: border-box; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
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
.hn-spot::after { content: ""; position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; margin: -4px; border-radius: 50%; background: ${ORANGE}; box-shadow: 0 0 0 1.5px #fff; }
.hn-ring { position: fixed; z-index: 3000; left: 50%; top: 14px; transform: translateX(-50%); width: min(420px, calc(100% - 24px)); box-sizing: border-box; background: ${ORANGE}; color: #fff; border-radius: 14px;
  padding: 12px 14px; box-shadow: 0 8px 28px #0006; display: flex; gap: 10px; align-items: center; font-weight: 700; }
.sp-banner.hn-meas[hidden] { display: none; }
.sp-banner.hn-meas { z-index: 660; left: 56px; right: 116px; transform: none; margin-inline: auto; max-width: calc(100% - 172px); }
@media (max-width: 760px) { .sp-banner.hn-meas { top: 64px; left: 10px; right: 10px; width: auto; max-width: none; gap: 6px 8px; padding: 8px 10px; font-size: .84rem; } }
.hn-meas svg { flex: none; color: ${ORANGE}; }
.hn-meas button:disabled { opacity: .45; }
.hn-measuring .leaflet-container, .hn-measuring .maplibregl-canvas { cursor: crosshair !important; }
#huntPane #hnMeasure[aria-pressed="true"], #huntPane #hnMeasure[aria-pressed="true"] svg { background: ${ORANGE}; color: #fff; border-color: ${ORANGE}; }
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
      <button type="button" class="hn-act" data-act="truck">${svg(IC.truck)}Truck</button>
      <button type="button" class="hn-act" data-act="log">${svg(IC.log)}My hunts</button>
      <button type="button" class="hn-act tf-phone" data-act="measure">${svg(IC.ruler)}Measure</button>
      <button type="button" class="hn-act tf-phone" data-act="compass">${svg(IC.compass)}Compass</button>
    </div>
    <button type="button" class="hn-now" id="hnNow" hidden></button>
    <div class="hn-card" id="hnSpot" hidden></div>
    <div class="hn-card" id="hnLayers"><header>${svg(IC.layers)}<h3>On the map</h3></header>
      <div class="hn-views" role="group" aria-label="Map views">${Object.entries(VIEWS).map(([k, v]) => `<button type="button" class="hn-view" data-view="${k}">${esc(v.label)}<small>${esc(v.sub)}</small></button>`).join("")}</div>
      <div class="hn-row"><button type="button" class="hn-pill" id="hnAll">${svg(IC.layers, 16)}All hunting layers</button><button type="button" class="hn-pill" id="hnMeasure">${svg(IC.ruler, 16)}Measure</button><button type="button" class="hn-pill" id="hnCompass">${svg(IC.compass, 16)}Compass</button></div></div>
    <div class="hn-card" id="hnCond"><div id="hnWx"></div><div id="hnCast"></div><div id="hnSky"></div></div>
    <details class="hn-card" id="hnOffBox"><summary>${svg(IC.down, 16)} Hunting maps offline</summary><div id="hnOff"></div></details>
    <details class="hn-safe"><summary>A guide, not the law</summary>Zones, parks, seasons and draw odds come from each province's open data and regulation pages (and the federal protected areas database), read by the app each month, and can be out of date or simplified. Always check the regulations where you hunt (the spot card links them: <a href="${BC_SYNOPSIS}" target="_blank" rel="noopener">BC</a>, <a href="${AB_REGS}" target="_blank" rel="noopener">Alberta</a>, <a href="${QC_REGS}" target="_blank" rel="noopener">Quebec</a>, <a href="${PV.on.regs}" target="_blank" rel="noopener">Ontario</a>...), and get permission before hunting private land, a lease or an outfitter's territory.</details>`;
  // Go to a place (place-search.js): a town, mountain, lake or region, and the map jumps there (alex 2026-10-26).
  if (window.tfPlaceSearch) pane.querySelector(".hn-actions").after(window.tfPlaceSearch.box({ placeholder: "Go to a town, mountain, lake or region" }));
  // Every hunting layer switch lives in the map's Layers menu (alex: "should we put that here?"), shown only in Hunting.
  const lmHunt = document.createElement("div");
  lmHunt.className = "lm-hunt";
  lmHunt.innerHTML = `<div class="lm-head">Hunting layers</div><div id="hnLayerList"></div><p class="hn-note">What the colours mean: tap Key on the map.</p>`;
  const lmStyle = document.querySelector("#layersMenu .lm-style");
  if (lmStyle) lmStyle.after(lmHunt); else pane.append(lmHunt);
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
  const DATA_FILES = ["zones", "leh", "areas", "seasons-bc", "seasons-ab", "draws", "harvest"];
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
  // Alberta: 49-60° N, from 110° W (Saskatchewan) to the Rockies' divide (120° W north of 53.8° N). Not Quebec or
  // Saskatchewan, which an open east side used to count as Alberta.
  const inAlberta = (lat, lon) => lat > 49 && lat < 60 && lon <= -110 && lon > -120 && (lat >= 53.8 || lon > -114.07 - (lat - 49) * 0.7);
  const inBC = (lat, lon) => lat > 48.2 && lat < 60 && lon > -139.1 && lon < -114 && !inAlberta(lat, lon);

  // ---------- map layers ----------
  map.createPane("hunt").style.zIndex = 405;
  map.createPane("huntTiles").style.zIndex = 350;
  map.createPane("huntLabels").style.zIndex = 640;
  map.getPane("huntLabels").style.pointerEvents = "none";
  const renderer = L.canvas({ pane: "hunt", padding: 0.3 });
  const zoneLayer = L.layerGroup(), lehLayer = L.layerGroup(), rulesLayer = L.layerGroup(), labelLayer = L.layerGroup(), windLayer = L.layerGroup(), ringLayer = L.layerGroup();
  const glassLayer = L.layerGroup(), measureLayer = L.layerGroup();
  const squareLayer = L.layerGroup();   // the square drawn for Hunting maps offline
  const allHunt = [zoneLayer, lehLayer, rulesLayer, labelLayer, windLayer, ringLayer, glassLayer, measureLayer, squareLayer];
  let zones = null, leh = null, areas = null;
  // The other provinces' zones and areas, added as their files come in (pvZones/pvAreas), and all of them together.
  const pvZones = [], pvAreas = [], pvGot = {};
  let pvVer = 0;   // goes up when a province's files come in (the 3D map's fills and labels are made again)
  const Z = () => (pvZones.length ? (zones || []).concat(pvZones) : zones || []), A = () => (pvAreas.length ? (areas || []).concat(pvAreas) : areas || []);
  const boxHits = (b, s, w, n, e) => !(b[2] < s || b[0] > n || b[3] < w || b[1] > e);
  // smallest box first: at a point, the first one is the likeliest province (PEI's box is inside Quebec's)
  const pvArea = (k) => (PV[k].box[2] - PV[k].box[0]) * (PV[k].box[3] - PV[k].box[1]);
  const pvsIn = (s, w, n, e) => Object.keys(PV).filter((k) => boxHits(PV[k].box, s, w, n, e)).sort((a, b) => pvArea(a) - pvArea(b));
  // Loads the files of these provinces (once each); true when something new came in.
  async function loadPv(list) {
    const fresh = list.filter((k) => !pvGot[k]);
    for (const k of fresh) pvGot[k] = Promise.all([PV[k].zones ? load(`zones-${k}`).then((j) => j.zones).catch(() => null) : [], load(`areas-${k}`).then((j) => j.areas).catch(() => null)])
      .then(([z, a]) => { if (z) pvZones.push(...z); if (a) pvAreas.push(...a); if (z == null || a == null) delete pvGot[k]; if ((z && z.length) || (a && a.length)) pvVer++; return true; });
    await Promise.all(list.map((k) => pvGot[k]));
    return fresh.length > 0;
  }
  // The provinces in view (only the one under the centre when zoomed far out, so Canada isn't loaded at once).
  const pvsView = () => {
    if (map.getZoom() < 5) { const c = map.getCenter(); return pvsIn(c.lat, c.lng, c.lat, c.lng); }
    const b = map.getBounds(); return pvsIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
  };
  async function viewPv() {
    if (!isHunt()) return;
    if (await loadPv(pvsView())) { if (shown.has("zones")) drawZones(); if (shown.has("rules") || shown.has("land")) drawRules(); }
  }
  map.on("moveend", () => { if (isHunt()) viewPv(); });

  // Only the outlines near the view are on the map, and fewer points when zoomed out (alex 2026-10-24: "the map is
  // lagging in hunting mode too"). With every zone and park outline on, each zoom placed ~570,000 points again:
  // about a second on a phone (measured), with the map stuck. [up to zoom, points closer than this many degrees skipped]
  const THIN = [[6, 0.05], [7, 0.025], [8, 0.012], [9, 0.006], [10, 0.003], [11, 0.0015], [12, 0.0008], [13, 0.0004]];   // 2-3 pixels
  const thin = (g, d) => g.map((r) => {
    if (r.length <= 8) return r;
    const out = [r[0], r[1]];
    for (let i = 2; i < r.length - 2; i += 2) {
      const a = out[out.length - 2], o = out[out.length - 1];
      if (Math.abs(r[i] - a) > d || Math.abs(r[i + 1] - o) > d) out.push(r[i], r[i + 1]);
    }
    out.push(r[r.length - 2], r[r.length - 1]);
    if (out.length >= 8) return out;
    if (g.length > 1) return null;   // a piece too small to see at this zoom
    const q = r.length / 2, pick = [0, Math.floor(q / 3), Math.floor((2 * q) / 3), q - 1];   // four of its points
    return pick.flatMap((i) => [r[2 * i], r[2 * i + 1]]);
  });
  const culls = [];   // [layer group, [{ f, make, on: [polygons], lod }]]
  function cullSet(group) { group.clearLayers(); const items = []; culls.push([group, items]); for (let i = culls.length - 2; i >= 0; i--) if (culls[i][0] === group) culls.splice(i, 1); return items; }
  function cull() {
    const v = map.getBounds().pad(1), s = v.getSouth(), w = v.getWest(), n = v.getNorth(), e = v.getEast(), z = map.getZoom();
    const lod = THIN.findIndex(([m]) => z <= m);
    const out = (b) => b[2] < s || b[0] > n || b[3] < w || b[1] > e;
    for (const [group, items] of culls) for (const it of items) {
      const f = it.f;
      // Too small to see at this zoom (a reserve zoomed out to the province): left off.
      const tiny = lod >= 0 && f.b[2] - f.b[0] < THIN[lod][1] * 2 && f.b[3] - f.b[1] < THIN[lod][1] * 2;
      let key = tiny || out(f.b) ? "" : "all";
      // An area made of many pieces (one park covers half of BC in 644 pieces): only its pieces near the view.
      if (key && f.g.length > 8) {
        f.rb = f.rb || f.g.map((r) => { const b = [90, 180, -90, -180]; for (let i = 0; i < r.length; i += 2) { b[0] = Math.min(b[0], r[i]); b[1] = Math.min(b[1], r[i + 1]); b[2] = Math.max(b[2], r[i]); b[3] = Math.max(b[3], r[i + 1]); } return b; });
        key = f.rb.map((b, i) => (out(b) ? "" : i)).filter((i) => i !== "").join(",");
      }
      if (key && it.on && it.lod === lod && it.key === key) continue;
      if (it.on) { for (const l of it.on) group.removeLayer(l); it.on = null; }
      if (!key) continue;
      let g = lod < 0 ? f.g : ((f.thin = f.thin || [])[lod] = f.thin[lod] || thin(f.g, THIN[lod][1]));
      if (key !== "all") { const keep = new Set(key.split(",").map(Number)); g = g.filter((r, i) => keep.has(i)); }
      g = g.filter(Boolean);
      if (!g.length) continue;
      it.on = it.make(ringsLL(g), lod); it.lod = lod; it.key = key;
      for (const l of it.on) group.addLayer(l);
    }
  }
  map.on("moveend", () => { if (isHunt()) cull(); });

  async function drawZones() {
    const items = cullSet(zoneLayer);
    if (!shown.has("zones")) { labelLayer.clearLayers(); return; }
    try { zones = zones || (await load("zones")).zones; } catch {}
    for (const f of Z()) items.push({ f, make: (ll, lod) => [
      ...(lod >= 0 && lod <= 2 ? [] : [L.polygon(ll, { renderer, interactive: false, color: "#fff", weight: 4.5, opacity: 0.55, fill: false })]),   // white edge: reads on photos and dark forest (not needed zoomed out)
      L.polygon(ll, { renderer, interactive: false, color: C.zone, weight: 2, opacity: 0.9, fill: false })] });
    cull(); drawLabels(); sync3d();
  }
  // Labels only for the zones in view, so the map stays light.
  function drawLabels() {
    labelLayer.clearLayers();
    if (!Z().length || !shown.has("zones") || !isHunt() || map.getZoom() < 6) return;
    const b = map.getBounds().pad(0.2), z = map.getZoom();
    for (const u of Z()) {
      if (!labelled(u) || !b.contains(u.c)) continue;
      const sub = zoneSub(u), name = `${esc(zoneName(u))}${z >= 9 && sub ? ` <small>${esc(sub)}</small>` : ""}`;
      L.marker(u.c, { pane: "huntLabels", interactive: false, keyboard: false,
        icon: L.divIcon({ className: "", html: `<div class="hn-label">${name}</div>`, iconSize: [0, 0] }) }).addTo(labelLayer);
    }
  }
  async function drawLeh() {
    const items = cullSet(lehLayer);
    if (!shown.has("leh")) return;
    try { leh = leh || (await load("leh")).zones; } catch { return; }
    for (const f of leh) items.push({ f, make: (ll) => [L.polygon(ll, { renderer, interactive: false, color: C.leh, weight: 2, dashArray: "7 5", opacity: 0.85, fill: false })] });
    cull();
  }
  // No-hunting areas are hatched (red stripes), so they never read as just another tint.
  const makeHatch = (n, w) => {   // n px square, w px stripes
    const cv = document.createElement("canvas"); cv.width = cv.height = n;
    const cx = cv.getContext("2d"); cx.strokeStyle = C.no; cx.lineWidth = w;
    cx.beginPath(); cx.moveTo(-1, n + 1); cx.lineTo(n + 1, -1); cx.moveTo(-1, 1); cx.lineTo(1, -1); cx.moveTo(n - 1, n + 1); cx.lineTo(n + 1, n - 1); cx.stroke();
    return cv;
  };
  const hatchTile = makeHatch(10, 2), hatch3d = makeHatch(16, 3.5);   // bolder on the 3D photos
  const HATCH = document.createElement("canvas").getContext("2d").createPattern(hatchTile, "repeat");
  const hatched = (k) => k.color === C.no;   // reserves are "no" too (ask first) but keep their own violet
  const fillOp = (id, k) => (hatched(k) ? 0.6 : id === "town" ? 0.2 : k.color === C.vary ? 0.16 : k.color === C.reserve ? 0.12 : 0.07);
  async function drawRules() {
    const items = cullSet(rulesLayer);
    if (!shown.has("rules") && !shown.has("land")) return;
    try { areas = areas || (await load("areas")).areas; } catch {}
    for (const a of A()) {
      const k = AREA_KINDS[a.k];
      if (!k) continue;
      const want = a.k === "green" || a.k === "provforest" ? shown.has("land") : shown.has("rules");
      if (!want) continue;
      items.push({ f: a, make: (ll) => [L.polygon(ll, { renderer, interactive: false, color: k.color, weight: k.line || k.color === C.vary || k.color === C.reserve ? 2 : hatched(k) || a.k === "town" ? 1.5 : 1, dashArray: k.dash || null, lineCap: k.dash ? "round" : "butt",
        opacity: 0.85, fill: !k.line, fillColor: hatched(k) ? HATCH : k.color, fillOpacity: fillOp(a.k, k) })] });
    }
    cull(); sync3d();
  }

  // Picture layers: map images for each 256 px tile, asked for by the tile's box in web mercator metres. Built as
  // plain addresses (not Leaflet's WMS layer) so the 3D map and Offline can ask for exactly the same images.
  const R = 20037508.342789244;
  const tileBox = (z, x, y) => { const s = (2 * R) / 2 ** z; return [x * s - R, R - (y + 1) * s, (x + 1) * s - R, R - y * s].map((v) => v.toFixed(2)).join(","); };
  const BoxTiles = L.TileLayer.extend({
    initialize(tmpl, opts) { this._tmpl = tmpl; L.TileLayer.prototype.initialize.call(this, "", opts); },
    getTileUrl(c) { return picUrl(this.options.pic, c.z, c.x, c.y); },
  });
  // A picture layer's address for one tile: most fill a fixed address in; "url" ones work theirs out per tile.
  const picUrl = (p, z, x, y) => (p.url ? p.url(z, x, y) : p.tmpl.replace("{bbox}", tileBox(z, x, y)));
  // Pixels across `m` metres on the ground at a tile (web mercator stretches by 1 / cos(latitude)).
  const pxFor = (m, z, y) => m / ((40075016.686 * Math.cos((tileLat(y + 0.5, z) * Math.PI) / 180)) / (256 * 2 ** z));
  // BC roads: the Digital Road Atlas (every road, resource roads too), minus trails, ferries and roads not built yet.
  const DRA = "pub:WHSE_BASEMAPPING.DRA_DGTL_ROAD_ATLAS_MPAR_SP";
  const reachBC = (z, x, y) => {
    const notIn = ["trail", "ferry", "proposed"].map((c) => `<PropertyIsEqualTo><PropertyName>ROAD_CLASS</PropertyName><Literal>${c}</Literal></PropertyIsEqualTo>`).join("");
    // one style per band, the wide one first, so a narrow band is never painted over by a neighbour's wide one
    const band = ([m, c]) => `<FeatureTypeStyle><Rule><Filter><Not><Or>${notIn}</Or></Not></Filter><LineSymbolizer><Stroke><CssParameter name="stroke">${c}</CssParameter><CssParameter name="stroke-width">${Math.max(1, Math.round(pxFor(2 * m, z, y)))}</CssParameter><CssParameter name="stroke-linecap">round</CssParameter><CssParameter name="stroke-linejoin">round</CssParameter></Stroke></LineSymbolizer></Rule></FeatureTypeStyle>`;
    return wms(DRA, `<StyledLayerDescriptor version="1.0.0"><NamedLayer><Name>${DRA}</Name><UserStyle>${REACH.map(band).join("")}</UserStyle></NamedLayer></StyledLayerDescriptor>`).replace("{bbox}", tileBox(z, x, y));
  };
  // Alberta roads: Alberta Base Features access roads, minus ferries, fords and winter roads (widths in points).
  const reachAB = (z, x, y) => `${AB}/titan/rest/services/transportation/access_facility_roads/MapServer/export?bboxSR=3857&imageSR=3857&size=256%2C256&format=png32&transparent=true&f=image&dpi=96&dynamicLayers=${encodeURIComponent(JSON.stringify(
    [...REACH].reverse().map(([m, c], i) => ({ id: 101 + i, source: { type: "mapLayer", mapLayerId: 0 }, definitionExpression: "FEATURE_TYPE NOT IN (1,2,12)",
      drawingInfo: { renderer: { type: "simple", symbol: { type: "esriSLS", style: "esriSLSSolid", color: rgba(c, 255), width: Math.max(0.75, +(pxFor(2 * m, z, y) * 0.75).toFixed(1)) } } } }))))}&bbox=${tileBox(z, x, y)}`;
  const CUTBLOCKS = "pub:WHSE_FOREST_VEGETATION.VEG_CONSOLIDATED_CUT_BLOCKS_SP";
  const wms = (layer, style) => `${WMS}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${encodeURIComponent(layer)}&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=true&SRS=EPSG%3A3857&WIDTH=256&HEIGHT=256&SLD_BODY=${encodeURIComponent(style)}&BBOX={bbox}`;
  const arcgis = (service, extra) => `${AB}/${service}/MapServer/export?bboxSR=3857&imageSR=3857&size=256%2C256&format=png32&transparent=true&f=image&${extra}&bbox={bbox}`;
  const dyn = (ids, fill, line, style = "esriSFSSolid") => `dynamicLayers=${encodeURIComponent(JSON.stringify(ids.map((id) => ({ id, source: { type: "mapLayer", mapLayerId: id },
    drawingInfo: { renderer: { type: "simple", symbol: { type: "esriSFS", style, color: fill, outline: { type: "esriSLS", style: "esriSLSSolid", color: line, width: style === "esriSFSSolid" ? 1 : 1.5 } } } } }))))}`;
  const rgba = (h, a) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
  const FIRE_SVC = "mimas/rest/services/wildfire/historical_wildfires_data", FUEL_SVC = "mimas/rest/services/wildfire/fbp_fuel_type";
  const GRAZE_SVC = "titan/rest/services/recaccess/recaccess_grazing", WET_SVC = "titan/rest/services/environment/alberta_merged_wetland_inventory";
  // id: the 3D map's layer name; layer: which switch shows it
  const PICS = [
    { id: "hn-land", layer: "land", tmpl: wms(PMBC, sld(PMBC, [[`<PropertyIsEqualTo><PropertyName>OWNER_TYPE</PropertyName><Literal>Private</Literal></PropertyIsEqualTo>`, C.private]])),
      min: 11, opacity: 0.4, attr: 'Land: <a href="https://ltsa.ca/property-owners/about-land-records/parcelmap-bc/">ParcelMap BC</a>, DataBC' },
    { id: "hn-graze", layer: "land", tmpl: arcgis(GRAZE_SVC, dyn([1], rgba(GRAZE_COLOR, 90), rgba("#b07d00", 255))), min: 9, opacity: 0.8, attr: "Leases: Alberta Recreational Access" },
    { id: "hn-forest", layer: "forest", tmpl: wms(VRI, forestSld()), min: 11, opacity: 0.5, attr: 'Forest: <a href="https://www2.gov.bc.ca/gov/content/industry/forestry/managing-our-forest-resources/forest-inventory">BC Vegetation Resources Inventory</a>' },
    { id: "hn-fuel", layer: "forest", tmpl: arcgis(FUEL_SVC, "layers=show%3A1"), recolor: FUEL_RGB, min: 8, opacity: 0.5, ab: true, attr: "Forest: Alberta Wildfire fuel types" },
    { id: "hn-burns", layer: "burns", tmpl: wms(FIRES, sld(FIRES, BURNS.map(([a, b, gap]) => [between("FIRE_YEAR", a, b), burnSym(gap)]))), min: 7, opacity: 1, attr: 'Burns: <a href="https://catalogue.data.gov.bc.ca/dataset/fire-perimeters-historical">BC Wildfire Service</a>' },
    { id: "hn-abburn1", layer: "burns", tmpl: arcgis(FIRE_SVC, dyn([11, 12, 13, 14, 15], rgba(BURN, 255), rgba(BURN, 255), "esriSFSDiagonalCross")), min: 7, opacity: 1, ab: true, attr: "Burns: Alberta Wildfire" },
    { id: "hn-abburn2", layer: "burns", tmpl: arcgis(FIRE_SVC, dyn([16, 17, 18, 19, 20], rgba(BURN, 255), rgba(BURN, 255), "esriSFSBackwardDiagonal")), min: 7, opacity: 1, ab: true, attr: "Burns: Alberta Wildfire" },
    { id: "hn-reach", layer: "reach", url: reachBC, min: 9, opacity: 0.55, attr: 'Roads: <a href="https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/roads">BC Digital Road Atlas</a>' },
    { id: "hn-abreach", layer: "reach", url: reachAB, min: 9, opacity: 0.55, ab: true, attr: "Roads: Alberta Base Features" },
    { id: "hn-cut", layer: "cut", tmpl: wms(CUTBLOCKS, sld(CUTBLOCKS, CUTS.map(([a, b, c, size]) => [between("HARVEST_MID_YEAR_CALENDAR", YEAR - b, YEAR - a), cutSym(c, size)]))), min: 10, opacity: 1, attr: 'Cut blocks: <a href="https://catalogue.data.gov.bc.ca/dataset/harvested-areas-of-bc-consolidated-cutblocks-">BC consolidated cut blocks</a>' },
    { id: "hn-wet", layer: "wet", tmpl: wms(WETLANDS, sld(WETLANDS, [[`<Not><PropertyIsNull><PropertyName>WATERBODY_TYPE</PropertyName></PropertyIsNull></Not>`, C.wet]])), min: 10, opacity: 0.55, attr: 'Wetlands: <a href="https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/freshwater">BC Freshwater Atlas</a>' },
    { id: "hn-abwet", layer: "wet", tmpl: arcgis(WET_SVC, "layers=show%3A3"), min: 13, opacity: 0.6, ab: true, attr: "Wetlands: Alberta Merged Wetland Inventory" },
    // Crown and private land in the other provinces (crownland.js: each province's own map server)
    ...(window.tfCrown ? window.tfCrown.SRC.map((s) => ({ id: `hn-cl-${s.id}`, layer: "land", src: s, url: (z, x, y) => window.tfCrown.url(s, z, x, y), min: s.min,
      opacity: s.kind === "private" ? 0.4 : 0.3, attr: s.attr })) : []),
  ];
  // each province's layers only ask for tiles over that province
  const BOUNDS = { bc: [[48.2, -139.1], [60.01, -114.0]], ab: [[48.99, -120.01], [60.01, -109.99]] };
  const picBounds = (p) => (p.src ? window.tfCrown.bounds(p.src) : BOUNDS[p.ab ? "ab" : "bc"]);
  // "recolor" layers: the server's picture, each colour swapped for ours (the saved-offline copy is the server's picture too).
  const CLASS_RGB = Object.fromEntries(FOREST.map(([id, c]) => [id, [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]]));
  async function recolorTile(p, z, x, y) {
    if (p.src) return window.tfCrown.tint(p.src, z, x, y);   // Quebec's public land: one colour
    const r = await fetch(picUrl(p, z, x, y));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const cv = document.createElement("canvas"); cv.width = cv.height = 256;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(await createImageBitmap(await r.blob()), 0, 0, 256, 256);
    const img = cx.getImageData(0, 0, 256, 256), d = img.data, hex = (n) => n.toString(16).padStart(2, "0");
    const seen = new Map();   // a tile has a dozen colours at most
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (!seen.has(k)) seen.set(k, CLASS_RGB[p.recolor[hex(d[i]) + hex(d[i + 1]) + hex(d[i + 2])]] || null);
      const c = seen.get(k);
      if (c) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; } else d[i + 3] = 0;
    }
    return img;
  }
  const RecolorGrid = L.GridLayer.extend({
    createTile(c, done) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      recolorTile(this.options.pic, c.z, c.x, c.y).then((img) => { cv.getContext("2d").putImageData(img, 0, 0); done(null, cv); }, (e) => done(e, cv));
      return cv;
    },
  });
  for (const p of PICS) {
    if (p.src && p.src.tint) p.recolor = true;
    const opts = { pic: p, pane: "huntTiles", opacity: p.opacity, minZoom: p.min, maxZoom: 20, attribution: p.attr, bounds: picBounds(p) };
    p.tiles = p.recolor ? new RecolorGrid(opts) : new BoxTiles(p.tmpl, opts);
  }

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
  const hatchCss = (c) => `repeating-linear-gradient(135deg, ${c} 0 2px, transparent 2px 5px)`;
  const sw = (c, kind = "fill") => kind === "line" || kind === "dash" || kind === "dot" ? `<i style="border:2px ${kind === "line" ? "solid" : kind === "dash" ? "dashed" : "dotted"} ${c};background:transparent"></i>`
    : kind === "hatch" ? `<i style="border:1.5px solid ${c};background:${hatchCss(c)}"></i>`
    : kind === "soft" ? `<i style="border:1.5px solid ${c};background:${c}33"></i>`
    : kind === "edge" ? `<i style="border:2px solid ${c};background:${c}14"></i>` : `<i style="background:${c}"></i>`;
  const KEYS = {
    zones: () => [`<li class="wide">${sw(C.zone, "line")}Hunting zone edge (MU, WMU, zone, GHA...)</li>`],
    leh: () => [`<li>${sw(C.leh, "dash")}Limited entry zone</li>`],
    rules: () => [`<li>${sw(C.no, "hatch")}No hunting</li>`, `<li>${sw(C.vary, "soft")}Park: rules vary</li>`, `<li>${sw(C.open, "edge")}Usually open in season (ZEC: register)</li>`,
      `<li>${sw(C.reserve, "edge")}Reserve: ask first</li>`, `<li>${sw(C.town, "soft")}Town: no shooting</li>`, `<li>${sw(C.closure, "dot")}Vehicle closure</li>`],
    land: () => [`<li>${sw(C.open)}Crown land: public</li>`, `<li>${sw(C.private)}Private land: ask</li>`, `<li>${sw(GRAZE_COLOR)}Grazing lease: ask</li>`, `<li class="wide">${sw(C.green, "dash")}Alberta Green Area: public forest</li>`,
      `<li class="wide hn-tip">BC and Newfoundland: private land shaded, the rest is mostly Crown. Manitoba: provincial forests only. PEI and the territories: not mapped.</li>`],
    forest: () => [...FOREST.map(([, c, n]) => `<li class="wide">${sw(c)}${esc(n)}</li>`), `<li class="wide hn-tip">Game beds in thick timber and feeds in the rest: hunt the edges between them.</li>`],
    burns: () => [...BURNS.map(([, , gap, n]) => `<li><i style="${burnCss(gap)}"></i>${esc(n)}</li>`), `<li class="wide">Alberta: the last 10 years</li>`],
    reach: () => [...[...REACH].reverse().map(([, c, n]) => `<li class="wide"><i style="background:${c};opacity:.8"></i>${esc(n)}</li>`), `<li class="wide"><i style="background:#fff;border:1px solid #adb5bd"></i>Clear: over 1.5 km from any road</li>`],
    cut: () => [...CUTS.map(([, , c, , n]) => `<li class="wide"><i style="${cutCss(c)}"></i>${esc(n)}</li>`), `<li class="wide">Alberta: not on the map yet</li>`],
    wet: () => [`<li>${sw(C.wet)}Wetland (BC)</li>`, `<li>Alberta: from zoom 13</li>`],
    slope: () => SLOPES.map(([, n, c]) => `<li>${sw(c)}${esc(n)}</li>`),
    aspect: () => DIRS.map((d, i) => `<li>${sw(ASPECT_COLORS[i])}Faces ${d}</li>`),
    wind: () => [`<li class="wide">${sw(ORANGE)}Downwind of the spot: game there can smell you</li>`],
    rings: () => [`<li class="wide">${sw(C.rings, "dash")}${RINGS.join(", ")} m</li>`],
  };
  const icon = ([c, kind]) => kind === "cut" ? `<span class="hn-ic" style="${cutCss(c)}"></span>` : kind === "burn" ? `<span class="hn-ic" style="${burnCss(9)}"></span>` : kind === "hatch" ? `<span class="hn-ic" style="border:2px solid ${c};background:${hatchCss(c)}"></span>` : kind === "line" ? `<span class="hn-ic" style="border:3px solid ${c}"></span>` : kind === "dash" ? `<span class="hn-ic" style="border:3px dashed ${c}"></span>`
    : kind === "cone" ? `<span class="hn-ic" style="background:conic-from 0deg, transparent;background:linear-gradient(135deg, ${c}55, ${c})"></span>` : kind === "ring" ? `<span class="hn-ic" style="border:2px dashed ${c};border-radius:50%"></span>`
    : `<span class="hn-ic" style="background:${c};opacity:.85"></span>`;
  function renderLayers() {
    const z = map.getZoom();
    $("hnLayerList").innerHTML = GROUPS.map((g) => `<h4 class="hn-group">${g}</h4>` + Object.entries(LAYERS).filter(([, l]) => l.g === g).map(([k, l]) => {
      const on = shown.has(k), far = on && l.minZoom && z < l.minZoom;
      return `<label class="hn-layer">${icon(l.sw)}<span><b>${esc(l.label)}</b>${far ? '<small class="z">Zoom in closer to see it</small>' : ""}</span><input type="checkbox" class="hn-sw-input" role="switch" data-k="${k}"${on ? " checked" : ""} aria-label="${esc(l.label)}"></label>`;
    }).join("")).join("");
    // the view whose layers are exactly the ones on lights up
    pane.querySelectorAll("[data-view]").forEach((b) => { const v = VIEWS[b.dataset.view].layers; b.classList.toggle("on", v.length === shown.size && v.every((k) => shown.has(k))); });
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
    box.innerHTML = (glass ? `<b>What you can see</b><ul class="hn-key"><li><i style="background:${GLASS_DARK}"></i>Hidden from the spot</li><li><i style="background:#fff8;border:1px solid var(--line)"></i>In sight (bare ground: trees not counted)</li><li><i style="border:2px dashed ${ORANGE}"></i>${GLASS_M / 1000} km around the spot</li></ul>` : "")
      + (on.length ? on.map((k) => `<b>${esc(LAYERS[k].label)}</b><ul class="hn-key">${KEYS[k]().join("")}</ul>`).join("") : `<p>No layers on: turn some on in Map layers.</p>`);
  }
  $("hnLayerList").addEventListener("change", (e) => {
    const b = e.target.closest("[data-k]"); if (!b) return;
    const k = b.dataset.k;
    if (b.checked) shown.add(k); else shown.delete(k);
    if (k === "slope" && shown.has("slope")) shown.delete("aspect");   // one terrain shading at a time
    if (k === "aspect" && shown.has("aspect")) shown.delete("slope");
    applyLayers([k]);
  });
  $("hnAll").addEventListener("click", (e) => {
    e.stopPropagation();   // or the page's click-outside closes the menu again at once
    const b = $("layersBtn"); if (!b) return;
    if ($("layersMenu").hidden) b.click();
    lmHunt.scrollIntoView({ block: "nearest" });
  });
  pane.querySelector(".hn-views").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]"); if (!b) return;
    const before = new Set(shown);
    shown = new Set(VIEWS[b.dataset.view].layers);
    applyLayers(Object.keys(LAYERS).filter((k) => before.has(k) !== shown.has(k)));
  });
  // Saves the switches and redraws the layers in "changed".
  function applyLayers(changed) {
    store.set("huntLayers2", [...shown]);
    renderLayers(); renderMapKey(); syncTiles(); sync3d();
    const has = (...k) => k.some((x) => changed.includes(x));
    if (has("zones")) drawZones();
    if (has("leh")) drawLeh();
    if (has("rules", "land")) drawRules();
    if (has("wind")) drawWind();
    if (has("rings")) drawRings();
  }

  // ---------- the spot: your location, a tapped spot or the map centre ----------
  let spot = null;   // { lat, lon, how: "you" | "tap" | "centre" }
  const spotMarker = L.marker([0, 0], { pane: "huntLabels", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: '<div class="hn-spot"></div>', iconSize: [0, 0] }) });
  let skyAt = null;   // where the light times were last worked out
  function setSpot(lat, lon, how, moving) {
    spot = { lat, lon, how };
    if (how === "centre") windLayer.removeLayer(spotMarker); else { spotMarker.setLatLng([lat, lon]); windLayer.addLayer(spotMarker); }
    loadWeather(); drawRings(); sync3d();
    // Walking with the map following you: the light times barely change, so they're redone every 2 km, not every step.
    if (!moving || !skyAt || map.distance(skyAt, [lat, lon]) > 2000) { skyAt = [lat, lon]; renderSky(); }
  }
  // "My location" following you (alex: "I want the circle and the scent cone following me"): the spot, the scent
  // cone and the range rings move with you, on the 2D and 3D maps. A tapped spot stays put when you aren't followed.
  window.addEventListener("tf:you", (e) => {
    const { lat, lon, follow } = e.detail;
    if (!follow || !isHunt()) return;
    if (spot && spot.how === "you" && map.distance([spot.lat, spot.lon], [lat, lon]) < 8) return;   // GPS jitter
    const fresh = !spot || spot.how !== "you";
    setSpot(lat, lon, "you", true);
    // The spot card (zone, seasons, land) follows too: at once, then every 500 m, since it asks the map services.
    if (fresh || !cardAt || map.distance(cardAt, [lat, lon]) > 500) { cardAt = [lat, lon]; showSpot(lat, lon); }
  });
  let cardAt = null;
  // Range rings around the spot, for judging shot distances (tap the map where you'll stand).
  function drawRings() {
    ringLayer.clearLayers();
    if (!shown.has("rings") || !spot) return;
    for (const m of RINGS) {   // a white line under the dark dashes, so the rings show on the photos (2D and 3D) too
      L.circle([spot.lat, spot.lon], { radius: m, pane: "hunt", interactive: false, color: "#fff", weight: 3.5, opacity: 0.55, fill: false }).addTo(ringLayer);
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
    // The sunset is the one after the sunrise: when the day is counted on a clock far from the spot's (the weather
    // didn't answer and the phone is in another time zone), the sun is already up at the start and the first sunset
    // found was the evening before, so in the morning it said "Legal light over for today" (2026-10-26). So the
    // search goes up to 12 h past the day for that sunset; everything else stays inside the day.
    const end = start.valueOf() + dayMs;
    for (let t = start.valueOf() + step; t <= end + 12 * 3600000; t += step) {
      const inDay = t <= end;
      if (!inDay && (out.set || !out.rise)) break;
      const dt = new Date(t), s = sunAlt(dt, lat, lon), m = moon && inDay ? moonAlt(dt, lat, lon) : 0;
      const cross = (a, b, h) => new Date(t - step + (step * (h - a)) / (b - a));
      if (inDay && ps < -0.833 && s >= -0.833 && !out.rise) out.rise = cross(ps, s, -0.833);
      if (out.rise && ps >= -0.833 && s < -0.833 && !out.set) out.set = cross(ps, s, -0.833);
      if (moon && inDay) {
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
  // Legal light: half an hour before sunrise to half an hour after sunset (the usual hunting hours in most provinces).
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
    el.innerHTML = `<p class="hn-sub">${svg(IC.sun, 16)}Light and moon today</p>
      <dl class="hn-sun">
        <dt>Legal light</dt><dd>${legal}</dd>
        <dt>Sunrise · sunset</dt><dd>${hm(s.rise)} · ${hm(s.set)}</dd>
        <dt>Moon</dt><dd>${p[2]} ${p[1]}, ${Math.round(ph.fraction * 100)}% <small>· rises ${hm(s.moonRise)}, sets ${hm(s.moonSet)}</small></dd>
        <dt>Feeding times</dt><dd>${major || "none"}${minor ? ` <small>· minor ${minor}</small>` : ""}</dd>
      </dl>
      <details><summary>What these times mean</summary><p class="hn-note">Legal light is half an hour before sunrise to half an hour after sunset, the usual hunting hours in most provinces (some hunts and provinces differ). Feeding times are solunar: the moon overhead or underfoot (major) and moonrise or moonset (minor), a traditional guide. ${wx && wx.timezone_abbreviation ? `Local time at the spot (${esc(wx.timezone_abbreviation)}).` : "Times on this device's clock."}</p></details>
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
    renderNow();
  }

  // ---------- "right now": legal light, wind and what's open, on one line at the top ----------
  let spotOpen = null;   // species open today at the spot card's place, once it has loaded
  function renderNow() {
    const el = $("hnNow"); if (!el) return;
    if (!spot) { el.hidden = true; return; }
    const parts = [], s = skyDay(spot.lat, spot.lon, 0, false), now = Date.now();
    if (s.rise && s.set) {
      const a = s.rise - 30 * 60000, b = s.set.valueOf() + 30 * 60000;
      parts.push([IC.sun, now < a ? `Legal light from <b>${hm(new Date(a))}</b>` : now < b ? `Legal light until <b>${hm(new Date(b))}</b>` : "Legal light over for today"]);
    }
    if (wx && wx.current) {
      const sp = Math.round(wx.current.wind_speed_10m ?? 0);
      parts.push([IC.wind, sp < 4 ? "Wind <b>light</b>" : `Wind from <b>${compass(wx.current.wind_direction_10m ?? 0)} ${sp}</b> km/h`]);
    }
    const today = castDays()[0];
    if (today) parts.push([IC.star, `Today: <b>${SCORE[today.n]}</b>`]);
    if (spotOpen) parts.push([IC.pin, spotOpen.length ? `Open: <b>${esc(spotOpen.slice(0, 3).join(", "))}${spotOpen.length > 3 ? ` +${spotOpen.length - 3}` : ""}</b>` : "Nothing open here today"]);
    el.innerHTML = parts.map(([ic, t]) => `<span>${svg(ic, 15)}${t}</span>`).join("");
    el.hidden = !parts.length;
  }
  const scrollPanel = (el) => { const p = el && window.tfPanelScroller ? window.tfPanelScroller(el) : $("panel"); if (!p || !el) return; p.scrollTo({ top: Math.max(0, p.scrollTop + el.getBoundingClientRect().top - p.getBoundingClientRect().top - 8), behavior: "smooth" }); };
  $("hnNow").addEventListener("click", () => scrollPanel($("hnSpot").hidden ? $("hnCond") : $("hnSpot")));

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
  // Wind through the day (alex: "add it all"): 0 is now, 1 to 12 the hours ahead; the cone and arrow follow the slider.
  let windHour = 0;
  function windAt() {
    if (!wx) return null;
    const h = wx.hourly || {}, c = wx.current || {};
    if (windHour && h.time && h.time[windHour] != null) return { dir: h.wind_direction_10m[windHour] ?? 0, sp: h.wind_speed_10m[windHour] ?? 0, g: h.wind_gusts_10m?.[windHour], t: h.time[windHour] };
    return { dir: c.wind_direction_10m ?? 0, sp: c.wind_speed_10m ?? 0, g: c.wind_gusts_10m, t: null };
  }
  const hourLabel = (t) => { const h = +t.slice(11, 13); return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`; };
  // Thermals: on calm days air sinks downhill while it's cool (night, dawn, dusk) and rises once the sun warms the slopes,
  // from about 2 hours after sunrise to an hour before sunset. Hours here are the spot's own clock.
  function thermals(t) {
    if (!spot) return "";
    const s = skyDay(spot.lat, spot.lon, 0, false);
    if (!s.rise || !s.set) return "";
    const local = (d) => { const x = new Date(d.valueOf() + tzOff()); return x.getUTCHours() + x.getUTCMinutes() / 60; };
    const h = t ? +t.slice(11, 13) + 0.5 : local(new Date());
    return h >= local(s.rise) + 2 && h < local(s.set) - 1
      ? "⬆ Thermals rising: your scent drifts uphill, so stay above the animals."
      : "⬇ Thermals sinking: your scent drifts downhill, so stay below the animals.";
  }
  const wxCache = new Map();
  async function loadWeather() {
    if (!spot || !isHunt()) return;
    const key = `${spot.lat.toFixed(2)},${spot.lon.toFixed(2)}`;
    const hit = wxCache.get(key);
    if (hit && Date.now() - hit.at < 15 * 60000) { wx = hit.d; wxKey = key; renderWx(); drawWind(); loadCast(); return; }
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
    renderWx(); renderSky(); drawWind(); loadCast();
    // the spot may have moved while this one loaded
    if (spot && `${spot.lat.toFixed(2)},${spot.lon.toFixed(2)}` !== wxKey && !wxErr) loadWeather();
  }
  function renderWx() {
    const el = $("hnWx");
    if (!spot) { el.innerHTML = `<p class="hn-note">Move the map or tap it to pick a spot.</p>`; renderNow(); return; }
    const where = spot.how === "you" ? "Where you are" : spot.how === "tap" ? "At your spot" : "At the map centre";
    let body;
    if (wxErr && !wx) body = `<p class="hn-note">Couldn't load the weather: ${esc(wxErr)}.</p>`;
    else if (!wx) body = `<p class="hn-note">Loading the wind and weather…</p>`;
    else {
      const c = wx.current || {}, w = windAt(), g = Math.round(c.wind_gusts_10m ?? 0), sp = Math.round(c.wind_speed_10m ?? 0);
      const h = wx.hourly || {}, hours = Math.min(12, (h.time || []).length - 1);
      const hourHtml = (h.time || []).slice(0, 13).map((_, i) => {
        const t = h.time[i].slice(11, 16), hd = h.wind_direction_10m[i];
        return `<div><b>${t}</b>${arrow((hd + 180) % 360, 18)}<span>${compass(hd)} ${Math.round(h.wind_speed_10m[i])}</span><span>${Math.round(h.temperature_2m[i])}°</span><span>${h.precipitation_probability?.[i] ?? "–"}%</span></div>`;
      }).join("");
      body = `<div class="hn-wind"><div class="hn-arrow" id="hnArrow" title="The arrow points where the wind blows to">${arrow((w.dir + 180) % 360)}</div><div>
        <div class="hn-big" id="hnWindBig"></div><p id="hnWindTxt"></p></div></div>
        ${hours > 0 ? `<label class="hn-hour"><span id="hnHourLbl"></span><input type="range" id="hnHour" min="0" max="${hours}" step="1" value="${Math.min(windHour, hours)}" aria-label="Wind at this hour"></label>` : ""}
        <p class="hn-therm" id="hnTherm"></p>
        <div class="hn-stats" style="margin-top:8px"><div><b>${Math.round(c.temperature_2m ?? 0)}°</b><span>Feels ${Math.round(c.apparent_temperature ?? 0)}°</span></div><div><b>${g || sp}</b><span>Gusts</span></div>
          <div><b>${c.cloud_cover ?? "–"}%</b><span>Cloud</span></div><div><b>${c.precipitation ?? 0}</b><span>mm now</span></div></div>
        <p class="hn-note">${esc(WX[c.weather_code] || "")} · weather from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> · ${fmtLL(spot.lat, spot.lon)}</p>
        <details><summary>Next 12 hours</summary><div class="hn-hours">${hourHtml}</div><p class="hn-note">Hour, wind from (km/h), temperature, chance of rain or snow.</p></details>`;
    }
    el.innerHTML = `<header style="margin-bottom:8px">${svg(IC.wind)}<h3>Conditions <small class="hn-note">${where}</small></h3>${spot.how !== "centre" ? `<button type="button" class="hn-pill" id="hnCentre">Map centre</button>` : ""}</header>${body}`;
    if (wx) fillWind();
    const hr = $("hnHour"); if (hr) hr.addEventListener("input", () => { windHour = +hr.value; fillWind(); drawWind(); });
    const cb = $("hnCentre"); if (cb) cb.addEventListener("click", () => { const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); $("hnSpot").hidden = true; spotOpen = null; renderNow(); });
    renderNow();
  }
  // ---------- hunt forecast: a 1 to 5 score for today and the next two days ----------
  // Hunters' rules of thumb, not science: animals move more when the pressure swings (a front coming or clearing), on a
  // cold snap, with light wind and no heavy rain, and in daylight more around the new moon than the full moon.
  let cast = null, castKey = "", castBusy = false;
  const castCache = new Map();
  async function loadCast() {
    if (!spot || !isHunt() || castBusy) return;
    const key = `${spot.lat.toFixed(1)},${spot.lon.toFixed(1)}`, hit = castCache.get(key);
    if (hit && Date.now() - hit.at < 60 * 60000) { if (castKey !== key) { cast = hit.d; castKey = key; renderCast(); } return; }
    castBusy = true;
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${spot.lat.toFixed(2)}&longitude=${spot.lon.toFixed(2)}`
        + "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&hourly=surface_pressure&past_days=1&forecast_days=3&timezone=auto");
      if (r.ok) { cast = await r.json(); castKey = key; castCache.set(key, { at: Date.now(), d: cast }); }
    } catch {}
    castBusy = false;
    renderCast();
  }
  const SCORE = ["", "Poor", "Fair", "Okay", "Good", "Great"];
  function castDays() {
    const d = cast && cast.daily, p = cast && cast.hourly && cast.hourly.surface_pressure;
    if (!d || !d.time || d.time.length < 2) return [];
    const mean = (i) => { const v = (p || []).slice(i * 24, i * 24 + 24).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const out = [];
    const first = Math.max(1, d.time.indexOf(new Date().toLocaleDateString("en-CA")));   // today (the forecast starts yesterday)
    for (let i = first; i < d.time.length && out.length < 3; i++) {
      let n = 3; const why = [];
      const p0 = mean(i - 1), p1 = mean(i), dp = p0 != null && p1 != null ? p1 - p0 : 0;
      if (dp <= -4) { n += 1; why.push("pressure falling fast: feeding before the storm"); }
      else if (dp <= -2) { n += 0.5; why.push("pressure falling"); }
      else if (dp >= 2) { n += 1; why.push("pressure rising after a front"); }
      const t0 = d.temperature_2m_max[i - 1], t1 = d.temperature_2m_max[i];
      if (t0 != null && t1 != null && t0 - t1 >= 5) { n += 1; why.push("cold snap"); }
      if (t1 >= 20) { n -= 1; why.push("warm: they bed down"); }
      if (d.wind_speed_10m_max[i] >= 35) { n -= 1; why.push("strong wind"); }
      if (d.precipitation_sum[i] >= 10) { n -= 1; why.push("heavy rain or snow"); }
      else if (d.precipitation_sum[i] > 0 && d.precipitation_sum[i] < 3 && t1 < 5) { n += 0.5; why.push("light snow: fresh tracks"); }
      const m = moonPhase(new Date(`${d.time[i]}T12:00:00`)).fraction;
      if (m >= 0.85) { n -= 0.5; why.push("bright moon: more feeding at night"); }
      else if (m <= 0.15) { n += 0.5; why.push("dark moon: more moving by day"); }
      out.push({ day: d.time[i], n: Math.max(1, Math.min(5, Math.round(n))), why });
    }
    return out;
  }
  function renderCast() {
    const el = $("hnCast"); if (!el) return;
    const days = castDays();
    if (!days.length) { el.innerHTML = ""; renderNow(); return; }
    const today = new Date(), next = new Date(Date.now() + 864e5), ymd = (t) => t.toLocaleDateString("en-CA");
    const name = (d) => (d === ymd(today) ? "Today" : d === ymd(next) ? "Tomorrow" : new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" }));
    el.innerHTML = `<p class="hn-sub">${svg(IC.star, 16)}Hunt forecast</p><ul class="hn-cast">${days.map((x) => `<li><b>${name(x.day)}</b><span class="hn-stars" aria-label="${x.n} out of 5">${"★".repeat(x.n)}<i>${"★".repeat(5 - x.n)}</i></span><span>${SCORE[x.n]}</span><small>${esc(x.why.join(" · ") || "an ordinary day")}</small></li>`).join("")}</ul>
      <p class="hn-note">Rules of thumb hunters use (pressure, cold snaps, wind, rain, moon), not a promise.</p>`;
    renderNow();
  }
  // The wind lines for the slider's hour, changed in place so the slider keeps working while it's dragged.
  function fillWind() {
    const w = windAt(); if (!w || !$("hnWindBig")) return;
    const sp = Math.round(w.sp), to = (w.dir + 180) % 360, calm = sp < 4;
    $("hnArrow").innerHTML = arrow(to);
    $("hnWindBig").textContent = calm ? "Light and variable" : `From the ${compass(w.dir)}, ${sp} km/h`;
    $("hnWindTxt").textContent = calm ? "Little wind: your scent follows the thermals (below)." : `Your scent drifts ${compass(to)} (the orange cone). Approach from the ${compass(to)}, into the wind.`;
    if ($("hnHourLbl")) $("hnHourLbl").innerHTML = w.t ? `Wind at <b>${hourLabel(w.t)}</b>` : "Wind <b>now</b> · slide for later";
    $("hnTherm").textContent = thermals(w.t);
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
    const { dir, sp } = windAt(), to = (dir + 180) % 360;
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
  // foot: where the seasons were read from (the note under the list).
  function seasonsHtml(label, rows, foot) {
    if (!rows || !rows.length) return "";
    const by = new Map();
    for (const r of rows) (by.get(r[0]) || by.set(r[0], []).get(r[0])).push(r);
    const now = [...by.keys()].filter((sp) => by.get(sp).some((r) => openNow(r[3])));
    const list = [...by.entries()].map(([sp, rs]) => `<li style="border-color:${rs.some((r) => openNow(r[3])) ? "#2f9e44" : "var(--line)"}"><b>${esc(sp)}</b>${rs.map((r) =>
      `${openNow(r[3]) ? '<span class="hn-open">● Open · </span>' : ""}${r[1] ? esc(r[1]) + ": " : ""}${r[2] ? esc(r[2]) + ", " : ""}${esc(r[3])}${r[4] ? " †" : ""}`).join("<br>")}</li>`).join("");
    return `<details class="hn-seasons"><summary>Seasons in ${esc(label)}: ${now.length ? `<span class="hn-open">${now.length} open now</span>` : "none open today"}</summary>
      <ul class="hn-list">${list}</ul><p class="hn-note" style="margin-top:6px">${foot}</p></details>`;
  }
  const seasonFoot = (u, link, sf) => sf ? `${u.p === "nl" ? "Read by the app from" : "Typed in from"} the <a href="${esc(link)}" target="_blank" rel="noopener">${esc(sf.src)}</a>. Licences, tags and the exact rules are in the summary: always check it before you hunt.`
    : u.p === "ab" ? `Read by the app from the Alberta Guide to Hunting Regulations. “Special licence (draw)” seasons need a drawn licence. † has a footnote: always check <a href="${link}" target="_blank" rel="noopener">the guide</a> before you hunt.`
    : u.p === "bc" ? `General open seasons, read by the app from the BC Hunting and Trapping Regulations Synopsis (limited entry hunts are listed below). † has footnotes or applies to part of the unit only: always check <a href="${link}" target="_blank" rel="noopener">the region's synopsis</a> before you hunt.`
    : u.p === "qc" ? `Read by the app from the hunting periods on <a href="${link}" target="_blank" rel="noopener">Québec.ca</a> (this year's dates). † applies to part of the zone only or has an exception, and ZEC seasons can differ: always check the official periods and your zone's map before you hunt.`
    : `Resident seasons, read by the app from the <a href="${link}" target="_blank" rel="noopener">Ontario Hunting Regulations Summary</a>. † applies to part of the WMU only: always check the summary (and your tags) before you hunt.`;
  // Quebec: a zone part reads the whole zone's rows and its own ("8", "8 nord"; "19 sud" for 19 sud-est...).
  const EAST = ["nb", "ns", "nl"];   // season tables like Ontario's: seasons-nb.json, seasons-ns.json, seasons-nl.json
  const qcKeys = (u) => { const k = [u.no]; if (u.part) { k.push(`${u.no} ${u.part}`); if (/^sud-/.test(u.part)) k.push(`${u.no} sud`); if (u.isl) k.push(`${u.no} ${u.part} île`); if (u.sp) k.push(`${u.no} ${u.part} ${u.sp}`); } return k; };
  // Manitoba's season table: licence types and season words per species, not dates.
  function mbHtml(u, sm) {
    const rows = sm && sm.gha[u.id];
    if (!rows || !rows.length) return "";
    return `<details class="hn-seasons"><summary>Seasons in GHA ${esc(u.id)}: ${rows.length} species</summary><ul class="hn-list">${rows.map(([sp, t]) => `<li><b>${esc(sp)}</b>${esc(t).replace(/\n/g, "<br>")}</li>`).join("")}</ul>
      <p class="hn-note" style="margin-top:6px">From Manitoba's GHA Hunting Season Table. Dates and licences: <a href="${PV.mb.regs}" target="_blank" rel="noopener">Manitoba Hunting Guide</a>.</p></details>`;
  }
  // Harvest here (alex: "add it all"): how many hunters went, how many animals were taken and the share who got one.
  const BC_SPECIES = { DEMU: "Mule deer", DEWT: "White-tailed deer", MOOS: "Moose", ELK: "Elk", BEAB: "Black bear", BEAG: "Grizzly bear", CARI: "Caribou",
    GOAT: "Mountain goat", SHEE: "Wild sheep", COUG: "Cougar", WOLF: "Wolf", LYNX: "Lynx", BOBC: "Bobcat" };
  const pct = (k, h) => (h ? `${Math.round((k / h) * 100)}%` : "–");
  function harvestHtml(u, hv) {
    if (!hv) return "";
    if (u.p === "bc") {
      const mu = hv.bc && hv.bc.mu[u.id];
      if (!mu) return "";
      const ys = hv.bc.years, sum = (a, i) => a.reduce((s, r) => s + (r ? r[i] : 0), 0);
      const rows = Object.entries(mu).map(([k, a]) => ({ n: BC_SPECIES[k] || k, h: sum(a, 0), d: sum(a, 1), k: sum(a, 2), last: a[a.length - 1] })).filter((r) => r.h >= 5).sort((a, b) => b.h - a.h);
      if (!rows.length) return "";
      const top = rows.slice(0, 2).map((r) => `${r.n.toLowerCase()} ${pct(r.k, r.h)}`).join(", ");
      return `<details><summary>Harvest in MU ${esc(u.id)}: ${esc(top)} success</summary>
        <table class="hn-tbl"><thead><tr class="hd"><td>Species</td><td class="num">Hunters</td><td class="num">Taken</td><td class="num">Success</td><td class="num">Days per animal</td></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(r.n)}</td><td class="num">${Math.round(r.h / ys.length)}</td><td class="num">${Math.round(r.k / ys.length)}</td><td class="num">${pct(r.k, r.h)}</td><td class="num">${r.k ? Math.round(r.d / r.k) : "–"}</td></tr>`).join("")}</tbody></table>
        <p class="hn-note" style="margin-top:6px">Hunters and animals taken a year, averaged over ${ys[0]}-${ys[ys.length - 1]}, residents and non-residents, from BC's <a href="https://catalogue.data.gov.bc.ca/dataset/big-game-harvest-statistics-1976-to-current" target="_blank" rel="noopener">Big Game Harvest Statistics</a> (hunter survey estimates). Success: the share of hunters who took one.</p></details>`;
    }
    const w = hv.ab && hv.ab.wmu[String(u.id)];
    if (!w) return "";
    const rows = Object.entries(w).sort((a, b) => b[1][0] - a[1][0]);
    const top = rows.slice(0, 2).map(([n, v]) => `${n.toLowerCase()} ${v[1]}%`).join(", ");
    return `<details><summary>Harvest in WMU ${esc(u.id)}: ${esc(top)} success</summary>
      <table class="hn-tbl"><thead><tr class="hd"><td>Species</td><td class="num">Taken</td><td class="num">Success</td></tr></thead>
      <tbody>${rows.map(([n, v]) => `<tr><td>${esc(n)}${v[2] ? `<br><span class="hn-note">WMUs ${esc(v[2])} together</span>` : ""}</td><td class="num">${v[0]}</td><td class="num">${v[1]}%</td></tr>`).join("")}</tbody></table>
      <p class="hn-note" style="margin-top:6px">Estimated resident harvest in ${hv.ab.year || "the last season"} from Alberta's <a href="https://mywildalberta.ca/hunting/hunters-harvest.aspx" target="_blank" rel="noopener">Hunter harvest reports</a>. Success: the share of hunters who took one.</p></details>`;
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
    const pvHere = pvsIn(lat, lon, lat, lon);
    await loadPv(pvHere);
    try { zones = zones || (await load("zones")).zones; } catch {}
    z = at(Z(), lat, lon);
    if (z.some((u) => u.p === "bc")) try { leh = leh || (await load("leh")).zones; l = at(leh, lat, lon); } catch {}
    try { areas = areas || (await load("areas")).areas; } catch {}
    a = at(A(), lat, lon);
    const has = (p) => z.some((u) => u.p === p), bcab = z.some((u) => u.p === "bc" || u.p === "ab");
    const [sbc, sab, draws, sqc, son, smb, ...sEast] = await Promise.all([has("bc") ? load("seasons-bc").catch(() => null) : null,
      has("ab") ? load("seasons-ab").catch(() => null) : null, bcab ? load("draws").catch(() => null) : null,
      has("qc") ? load("seasons-qc").catch(() => null) : null, has("on") ? load("seasons-on").catch(() => null) : null, has("mb") ? load("seasons-mb").catch(() => null) : null,
      ...EAST.map((k) => has(k) ? load(`seasons-${k}`).catch(() => null) : null)]);
    const sx = Object.fromEntries(EAST.map((k, i) => [k, sEast[i]]));
    const harvest = bcab ? await load("harvest").catch(() => null) : null;
    if (seq !== spotSeq) return;
    // Summary first (zone, land, what's open, warnings); the details fold below it.
    const open = new Set(), folds = [], rules = [], warn = [];
    let known = false;   // season dates read for a zone here (not in every province yet)
    const zecRows = (x) => sqc && sqc.zec && sqc.zec[String(x.n).replace(/^Zec\s+(?:de la |de l'|de l’|du |des |de )?/i, "")];
    for (const u of z) {
      let rows = null;
      if (u.p === "ab") rows = sab && sab.wmu[u.id];
      else if (u.p === "bc") rows = sbc && sbc.mu[u.id];
      else if (u.p === "qc" && sqc) rows = [...qcKeys(u).flatMap((k) => sqc.zone[k] || []), ...a.filter((x) => x.k === "zec").flatMap((x) => (zecRows(x) || []).map((r) => [r[0], `ZEC ${x.n.replace(/^Zec\s+/i, "")}: ${r[1]}`, r[2], r[3], r[4]]))];
      else if (u.p === "on" && son) rows = son.wmu[u.id] || son.wmu[String(u.id).replace(/-\d$/, "")];
      else if (sx[u.p]) rows = sx[u.p].wmu[u.id];
      for (const r of rows || []) if (openNow(r[3])) open.add(r[0]);
      if (rows && rows.length) known = true;
      if (u.p === "ab" || u.p === "bc") folds.push(seasonsHtml(`${u.p === "ab" ? "WMU" : "MU"} ${u.id}`, rows, seasonFoot(u, u.p === "ab" ? AB_REGS : regionPdf(u))), drawsHtml(u, draws, l), harvestHtml(u, harvest));
      else if (u.p === "qc" || u.p === "on") folds.push(seasonsHtml(zoneName(u), rows, seasonFoot(u, u.p === "qc" ? (sqc && sqc.url) || QC_REGS : PV.on.regs)));
      else if (u.p === "mb") folds.push(mbHtml(u, smb));
      else if (sx[u.p]) folds.push(seasonsHtml(zoneName(u), rows, seasonFoot(u, sx[u.p].url, sx[u.p])));
      const pv = PV[u.p];
      rules.push(u.p === "ab"
        ? `<li style="border-color:${C.zone}"><b>Alberta WMU ${esc(u.id)}</b>Licences, weapons and bag limits: <a href="${AB_REGS}" target="_blank" rel="noopener">Alberta Guide to Hunting Regulations</a>.</li>`
        : u.p === "bc" ? `<li style="border-color:${C.zone}"><b>BC MU ${esc(u.id)}</b>Region ${esc(u.r)} ${esc(u.rn || "")}${u.z ? `, game management zone ${esc(u.z)}` : ""}. Bag limits and closures: <a href="${regionPdf(u)}" target="_blank" rel="noopener">Region ${esc(u.r)} synopsis (PDF)</a>.</li>`
        : `<li style="border-color:${C.zone}"><b>${esc(zoneName(u, true))}${u.p !== "qc" && zoneSub(u) ? ` · ${esc(zoneSub(u))}` : ""}</b>${u.cwd ? "Chronic wasting disease surveillance: deer and moose taken here must be registered and tested, and some parts can't leave the zone. " : ""}Licences, weapons and bag limits: <a href="${pv.regs}" target="_blank" rel="noopener">${esc(pv.regsName)}</a>${u.p === "qc" ? ` · <a href="${qcMap(u.no)}" target="_blank" rel="noopener">zone ${esc(u.no)} map (PDF)</a>` : ""}.</li>`);
    }
    // A province with no zones on the map (PEI, the NWT, Nunavut): its rules link.
    for (const k of pvHere) if (!PV[k].zones && !z.length) rules.push(`<li style="border-color:${C.zone}"><b>${esc(PV[k].name)}</b>No hunting zone outlines on the map here: seasons, licences and areas are in the <a href="${PV[k].regs}" target="_blank" rel="noopener">${esc(PV[k].regsName)}</a>.</li>`);
    for (const x of l) rules.push(`<li style="border-color:${C.leh}"><b>Limited entry zone: ${esc(x.s)}</b>${esc(x.l || x.id)}${x.mu ? ` (MU ${esc(x.mu)})` : ""}. Hunting it needs an LEH draw: see the shaded hunts in Limited entry.</li>`);
    if (l.length) warn.push(`<span class="hn-chip" style="--c:${C.leh}">Draw only: ${esc([...new Set(l.map((x) => x.s))].join(", "))}</span>`);
    for (const x of a) {
      const k = AREA_KINDS[x.k]; if (!k) continue;
      const link = x.u ? ` <a href="${esc(x.u)}" target="_blank" rel="noopener">More</a>`
        : x.k === "qcwres" || x.k === "qcpark" ? ` <a href="https://www.sepaq.com/" target="_blank" rel="noopener">Sépaq</a>`
        : x.k === "zec" ? ` <a href="https://reseauzec.com/" target="_blank" rel="noopener">Réseau Zec</a>`
        : x.p && PV[x.p] ? ""
        : ["park", "protected", "conservancy", "rec", "eco"].includes(x.k) && x.p !== "ab" ? ` <a href="https://bcparks.ca/find-a-park/?q=${encodeURIComponent(x.n)}" target="_blank" rel="noopener">BC Parks</a>`
        : x.p === "ab" && ["park", "pra", "wildland", "natural", "rangeland", "wilderness", "eco"].includes(x.k) ? ` <a href="https://www.albertaparks.ca/" target="_blank" rel="noopener">Alberta Parks</a>`
        : x.k === "town" ? ` <a href="https://www.google.com/search?q=${encodeURIComponent(`${x.n} ${x.p === "ab" ? "Alberta" : "BC"} firearm discharge bylaw`)}" target="_blank" rel="noopener">Find ${esc(x.n)}'s firearm bylaw</a>` : "";
      const extra = x.k === "mvpr" ? `${x.t ? esc(x.t) + ": " : ""}${esc(x.d || "")}${x.x ? ` Exempt: ${esc(x.x)}.` : ""}${x.mu ? ` (MU ${esc(x.mu)})` : ""}`
        : x.k === "closed" || (x.k === "refuge" && x.d) ? esc(x.d || "") : x.k === "zec" && x.t ? `Rights: ${esc(/chasse et pêche/i.test(x.t) ? "hunting and fishing" : /^chasse/i.test(x.t) ? "hunting" : x.t)}.` : "";
      rules.push(`<li style="border-color:${k.color}"><b>${esc(k.label)}: ${esc(x.n || "")}</b>${extra ? extra + " " : ""}${esc(ruleOf(x, k))}${link}</li>`);
      if (x.k === "green" || x.k === "provforest") continue;
      const say = k.no ? `${x.k === "reserve" || x.k === "metis" ? "Ask first" : "No hunting"}: ${k.label}` : x.k === "town" ? `No shooting: ${x.n || "town"}` : x.k === "mvpr" ? "No motor vehicles"
        : x.k === "zec" ? `ZEC ${x.n.replace(/^Zec\s+/i, "")}: register` : x.k === "outfit" ? "Outfitter only" : k.label;
      warn.push(`<span class="hn-chip" style="--c:${k.color}">${esc(say)}</span>`);
    }
    spotOpen = known ? [...open] : null;
    const name = z.map((u) => `${esc(zoneName(u, true))}${u.p !== "qc" && zoneSub(u) ? ` · ${esc(zoneSub(u))}` : ""}${u.cwd ? " · CWD surveillance zone" : ""}`).join(" / ");
    el.innerHTML = `<header>${svg(IC.pin)}<h3>This spot</h3><button type="button" class="hn-x" aria-label="Close">${svg(IC.x, 14)}</button></header>
      <p class="hn-zone">${name || (pvHere.length ? `${esc(PV[pvHere[0]].name)}: no hunting zone here on the map` : "Outside the hunting zones on the map")}</p>
      <div class="hn-chips">${known ? `<span class="hn-chip" style="--c:${open.size ? "#2f9e44" : "var(--line)"}">${open.size ? `Open now: ${esc([...open].slice(0, 3).join(", "))}${open.size > 3 ? ` +${open.size - 3} more` : ""}` : "No general season open today"}</span>` : ""}<span id="hnLand"></span>${warn.join("")}</div>
      ${folds.join("")}
      <details${z.length ? "" : " open"}><summary>Rules here</summary><ul class="hn-list">${rules.join("") || "<li>No hunting zone found here: check the province's or territory's regulations.</li>"}</ul></details>
      <details id="hnLiveBox" hidden><summary>Land and forest</summary><div id="hnLive"></div></details>
      <div class="hn-row" id="hnGlass" data-at="${lat},${lon}">${glassRow(`${lat},${lon}`)}</div>
      <p class="hn-note" id="hnGlassNote"${glass && glass.at === `${lat},${lon}` ? "" : " hidden"}>${GLASS_NOTE}</p>
      <p class="hn-note">${fmtLL(lat, lon)}</p>`;
    $("hnGlass").addEventListener("click", (e) => { const b = e.target.closest("[data-glass]"); if (b) glassDo(b.dataset.glass, lat, lon, b); });
    el.querySelector(".hn-x").addEventListener("click", () => { el.hidden = true; spotOpen = null; const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); });
    renderNow();
    if (z.some((u) => u.p === "ab") || (!z.length && inAlberta(lat, lon))) liveAlberta(lat, lon, seq);
    else if (z.some((u) => u.p === "bc") || (!z.length && inBC(lat, lon))) liveBC(lat, lon, seq);
    // Elsewhere: the province's own Crown land map (crownland.js), never a guess of Crown land on farmland.
    else {
      // ZECs, wildlife reserves and wildlife management areas are public land (Crown land), whatever the province.
      const pub = a.find((x) => ["zec", "qcwres", "outfit", "wmaopen", "consres", "wild", "afc"].includes(x.k));
      if (pub) liveOut(seq, [`<li style="border-color:${C.open}"><b>Land: public (${esc(AREA_KINDS[pub.k].label)})</b>Crown land managed for wildlife: see its rules above before you hunt.</li>`], ["Public land", C.open]);
      else liveCrown(lat, lon, z.find((u) => window.tfCrown && window.tfCrown.has(u.p))?.p || pvHere.find((k) => window.tfCrown && window.tfCrown.has(k)), seq);
    }
  }
  const LAND_CHIP = { crown: "Crown land", private: "Private land: ask", lease: "Lease: ask first", public: "Government land" };
  async function liveCrown(lat, lon, pv, seq) {
    const x = pv && window.tfCrown ? await window.tfCrown.at(lat, lon, pv).catch(() => null) : null;
    if (x) liveOut(seq, [`<li style="border-color:${x.c}"><b>Land: ${esc(x.t)}</b>${esc(x.d)}</li>`], LAND_CHIP[x.k] ? [LAND_CHIP[x.k], x.c] : ["Land owner not mapped", x.c]);
    else liveOut(seq, [`<li style="border-color:#868e96"><b>Land: owner not known here</b>${pv ? "The province's land map didn't answer: try again with signal. " : ""}Where most land is farmland, most of it is private: ask the owner before you hunt.</li>`], ["Land owner not known", "#868e96"]);
  }
  // land: a chip for the summary line (Crown, private, lease).
  const liveOut = (seq, out, land) => {
    if (seq !== spotSeq || !$("hnLive")) return;
    if (out.length) { $("hnLive").innerHTML = `<ul class="hn-list">${out.join("")}</ul>`; $("hnLiveBox").hidden = false; }
    if (land) $("hnLand").outerHTML = `<span class="hn-chip" style="--c:${land[1]}">${esc(land[0])}</span>`;
  };
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
      q(VRI, "GEOMETRY", "SPECIES_CD_1,SPECIES_PCT_1,SPECIES_CD_2,SPECIES_PCT_2,PROJ_AGE_1,PROJ_HEIGHT_1,BCLCS_LEVEL_4,CROWN_CLOSURE,HARVEST_DATE"),
      q(FIRES, "SHAPE", "FIRE_YEAR,FIRE_LABEL,FIRE_SIZE_HECTARES", "FIRE_YEAR D"),
    ]);
    if (parcel) {
      const own = String(parcel.OWNER_TYPE || "");
      out.push(`<li style="border-color:${/private/i.test(own) ? C.private : C.open}"><b>Land: ${esc(own || "parcel")}</b>${/private/i.test(own) ? "Private land: you need the owner's permission to hunt here." : /crown/i.test(own) ? "Crown land: usually open to hunting in season, unless a park, lease or closure says otherwise." : ""}${parcel.PID_FORMATTED ? ` <span class="hn-note">PID ${esc(parcel.PID_FORMATTED)}</span>` : ""}</li>`);
    } else if (parcel === null) out.push(`<li style="border-color:#2f9e44"><b>Land: no titled parcel mapped</b>Most likely Crown land, usually open to hunting in season, unless a park, reserve, lease or closure above says otherwise.</li>`);
    const fc = stand && FOREST_BY[standClass(stand)];
    if (fc || (stand && stand.SPECIES_CD_1)) {
      const sp = (c, p) => (c ? `${esc(SPECIES[c] || c)}${p ? ` ${p}%` : ""}` : "");
      const age = stand.PROJ_AGE_1 != null ? Math.round(stand.PROJ_AGE_1) : null;
      const facts = [stand.SPECIES_CD_1 && `${stand.BCLCS_LEVEL_4?.[0] === "T" ? "" : "Trees on record: "}${sp(stand.SPECIES_CD_1, stand.SPECIES_PCT_1)}${stand.SPECIES_CD_2 ? `, ${sp(stand.SPECIES_CD_2, stand.SPECIES_PCT_2)}` : ""}`,
        age != null && `about ${age} years old`, stand.PROJ_HEIGHT_1 && `${Math.round(stand.PROJ_HEIGHT_1)} m tall`,
        stand.CROWN_CLOSURE != null && stand.BCLCS_LEVEL_4?.[0] === "T" && `${Math.round(stand.CROWN_CLOSURE)}% canopy`,
        stand.HARVEST_DATE && `logged ${esc(String(stand.HARVEST_DATE).slice(0, 4))}`].filter(Boolean);
      out.push(`<li style="border-color:${fc ? fc[1] : "#868e96"}"><b>${fc ? esc(fc[2]) : "Forest"}</b>${fc ? esc(fc[3]) : ""}${facts.length ? ` <span class="hn-note">${facts.join(", ")}.</span>` : ""}</li>`);
    }
    if (burn && burn.FIRE_YEAR) out.push(burnItem(burn.FIRE_YEAR, burn.FIRE_LABEL, burn.FIRE_SIZE_HECTARES));
    const own = parcel && String(parcel.OWNER_TYPE || "");
    liveOut(seq, out, parcel === null || /crown/i.test(own || "") ? ["Crown land", C.open] : own && /private/i.test(own) ? ["Private land: ask", C.private] : null);
  }
  const burnItem = (year, label, ha) => {
    const ago = YEAR - year;
    return `<li style="border-color:${BURN}"><b>Burned in ${esc(year)}</b>Fire ${esc(label || "")}${ha ? `, ${Math.round(ha).toLocaleString()} ha` : ""}.${ago <= 20 ? " Young burns grow back as browse and berries that draw deer, elk, moose and bears." : ""}</li>`;
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
    const afc = ft && FOREST_BY[fuelClass(ft)];
    if (ft && !/water|non-fuel/i.test(ft)) out.push(`<li style="border-color:${afc ? afc[1] : "#868e96"}"><b>${afc ? esc(afc[2]) : "Forest"}</b>${afc ? esc(afc[3]) : ""} <span class="hn-note">${esc(ft.replace(/^([A-Z]-\d(?:\/[A-Z]-\d)?) \((.*)\)$/, "$2"))} (Alberta Wildfire fuel map).</span></li>`);
    const fr = fire && fire.results && fire.results.map((r) => r.attributes).sort((a, b) => (+b.YEAR || 0) - (+a.YEAR || 0))[0];
    if (fr && fr.YEAR) out.push(burnItem(+fr.YEAR, fr.FIRENUMBER || fr.FIRE_NUMBE, +fr.HECTARES_UTM));
    const w = wet && wet.features && wet.features[0] && wet.features[0].attributes;
    if (w && w.CWCS_Class) out.push(`<li style="border-color:${C.wet}"><b>Wetland: ${esc(w.CWCS_Class)}</b>Alberta Merged Wetland Inventory.</li>`);
    liveOut(seq, out, g ? ["Grazing lease: ask", GRAZE_COLOR] : null);
  }

  // ---------- glassing: what you can see from a spot ----------
  // Worked out from the terrain tiles (zoom 12, about 25 m a pixel): from eyes 2 m off the ground to an animal 1 m
  // tall, along rays round the spot every half pixel, with the earth's curve (less a little for the air bending light).
  const glassRow = (at) => `${glass && glass.at === at ? "" : `<button type="button" class="hn-pill" data-glass="show">${svg(IC.eye, 16)}What can I see from here?</button>`}${glass ? `<button type="button" class="hn-pill" data-glass="hide">${svg(IC.x, 14)}Hide the view</button>` : ""}`;
  let glassBusy = false;
  async function glassDo(what, lat, lon, b) {
    if (what === "hide") glassClear();
    else if (!glassBusy) {
      glassBusy = true; b.disabled = true; b.lastChild.textContent = "Working out the view…";
      try { await glassShow(lat, lon); } catch { hint("Couldn't load the terrain here: try again with signal."); }
      glassBusy = false;
    }
    const row = $("hnGlass");
    if (row) { row.innerHTML = glassRow(row.dataset.at); $("hnGlassNote").hidden = !(glass && glass.at === row.dataset.at); }
  }
  function glassClear() {
    if (glass) URL.revokeObjectURL(glass.url);
    glass = null;
    glassLayer.clearLayers(); renderMapKey(); sync3d();
  }
  async function glassShow(lat, lon) {
    const z = 12, n = 256 * 2 ** z, rad = Math.PI / 180;
    const m = (40075016.686 * Math.cos(lat * rad)) / n;   // metres a pixel here
    const gx0 = ((lon + 180) / 360) * n, sn = Math.sin(lat * rad), gy0 = (0.5 - Math.log((1 + sn) / (1 - sn)) / (4 * Math.PI)) * n;
    const r = GLASS_M / m, W = Math.ceil(2 * r) + 2, left = Math.floor(gx0 - r) - 1, top = Math.floor(gy0 - r) - 1;
    const tx0 = left >> 8, ty0 = top >> 8, cols = ((left + W) >> 8) - tx0 + 1, rows = ((top + W) >> 8) - ty0 + 1;
    const tiles = new Array(cols * rows);
    await Promise.all(tiles.fill(null).map((_, i) => dem(z, tx0 + (i % cols), ty0 + Math.floor(i / cols)).then((e) => { tiles[i] = e; })));
    const px = (x, y) => { const E = tiles[((y >> 8) - ty0) * cols + (x >> 8) - tx0], v = E ? E[(y & 255) * 256 + (x & 255)] : 0; return v > 0 ? v : 0; };
    const h = (gx, gy) => {
      const x = gx - 0.5, y = gy - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      return (px(x0, y0) * (1 - fx) + px(x0 + 1, y0) * fx) * (1 - fy) + (px(x0, y0 + 1) * (1 - fx) + px(x0 + 1, y0 + 1) * fx) * fy;
    };
    // Each way you look, you may also step up to 100 m that way to see over the edge (from one point, a rounded
    // top hides its own slopes). Ground within a pixel of where you stand never blocks: the tiles are too coarse there.
    const seen = new Uint8Array(W * W), K = 0.87 / (2 * 6371000), rays = Math.ceil(4 * Math.PI * r), walk = [0, 50 / m, 100 / m];
    for (let i = 0; i < rays; i++) {
      if (i % 300 === 299) await new Promise((ok) => setTimeout(ok));   // let the page breathe on slow phones
      const a = (i / rays) * 2 * Math.PI, dx = Math.sin(a), dy = -Math.cos(a);
      for (const s0 of walk) {
        const ox = gx0 + dx * s0, oy = gy0 + dy * s0, eye = h(ox, oy) + 2;
        let best = -Infinity;
        for (let d = 0.5; d + s0 <= r; d += 0.5) {
          const gx = ox + dx * d, gy = oy + dy * d, dm = d * m, g = h(gx, gy) - K * dm * dm - eye;
          const c = (Math.floor(gy) - top) * W + Math.floor(gx) - left;
          if ((g + 1) / dm >= best) seen[c] = 1; else if (!seen[c]) seen[c] = 2;
          if (d >= 1 && g / dm > best) best = g / dm;
        }
      }
    }
    const cv = document.createElement("canvas"); cv.width = cv.height = W;
    const cx = cv.getContext("2d"), img = cx.createImageData(W, W), o = img.data;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const c = y * W + x, ddx = x + left + 0.5 - gx0, ddy = y + top + 0.5 - gy0;
      if (seen[c] === 1 || ddx * ddx + ddy * ddy > r * r) continue;
      o[c * 4] = 15; o[c * 4 + 1] = 20; o[c * 4 + 2] = 30; o[c * 4 + 3] = 135;
    }
    cx.putImageData(img, 0, 0);
    const blob = await new Promise((ok) => cv.toBlob(ok, "image/png"));
    const lonAt = (gx) => (gx / n) * 360 - 180, latAt = (gy) => Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / n))) / rad;
    if (glass) URL.revokeObjectURL(glass.url);
    glass = { at: `${lat},${lon}`, url: URL.createObjectURL(blob), box: [lonAt(left), latAt(top + W), lonAt(left + W), latAt(top)] };
    const [w, s, e, nn] = glass.box;
    glassLayer.clearLayers();
    glassLayer.addLayer(L.imageOverlay(glass.url, [[s, w], [nn, e]], { pane: "huntTiles", interactive: false }));
    glassLayer.addLayer(L.circle([lat, lon], { radius: GLASS_M, pane: "hunt", color: ORANGE, weight: 2, opacity: 0.9, dashArray: "6 6", fill: false, interactive: false }));
    renderMapKey(); sync3d();
    if (!map.getBounds().contains(L.latLngBounds([[s, w], [nn, e]]))) map.fitBounds([[s, w], [nn, e]], { padding: [20, 20] });
    if (phone()) showMap();
  }
  const phone = () => matchMedia("(max-width: 760px)").matches;
  // Phones: drop the panel to see the map, once the tap is done (a tap in a lowered panel raises it again).
  const showMap = () => setTimeout(() => { const b = document.querySelector('#tabbar [data-nav="map"]'); if (b) b.click(); });

  // ---------- measure: tap points for the distance, and the area inside three or more ----------
  const measBar = document.createElement("div");
  measBar.className = "sp-banner hn-meas"; measBar.hidden = true; measBar.setAttribute("role", "status");
  measBar.innerHTML = `${svg(IC.ruler, 18)}<span id="hnMeasTxt"></span><button type="button" data-m="undo">Undo</button><button type="button" data-m="done">Done</button>`;
  L.DomEvent.disableClickPropagation(measBar);
  map.getContainer().append(measBar);
  measBar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]"); if (!b) return;
    if (b.dataset.m === "done") measStop(); else { meas.pop(); measDraw(); }
  });
  const fmtDist = (d) => (d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(d < 10000 ? 2 : 1)} km`);
  const fmtArea = (a) => (a >= 1e7 ? `${(a / 1e6).toFixed(1)} km²` : `${a < 1e5 ? (a / 1e4).toFixed(1) : Math.round(a / 1e4)} ha (${Math.round(a / 4046.86)} acres)`);
  function areaOf(p) {   // on the sphere, in m²
    let a = 0;
    for (let i = 0; i < p.length; i++) { const p1 = p[i], p2 = p[(i + 1) % p.length]; a += ((p2.lng - p1.lng) * Math.PI / 180) * (2 + Math.sin(p1.lat * Math.PI / 180) + Math.sin(p2.lat * Math.PI / 180)); }
    return Math.abs((a * 6378137 * 6378137) / 2);
  }
  function measDraw() {
    measureLayer.clearLayers();
    const p = meas || [];
    if (p.length > 2) measureLayer.addLayer(L.polygon(p, { pane: "hunt", stroke: false, fillColor: ORANGE, fillOpacity: 0.12, interactive: false }));
    if (p.length > 1) {
      measureLayer.addLayer(L.polyline(p, { pane: "hunt", color: "#fff", weight: 6, opacity: 0.85, interactive: false }));
      measureLayer.addLayer(L.polyline(p, { pane: "hunt", color: ORANGE, weight: 3, dashArray: "8 6", interactive: false }));
    }
    for (const q of p) measureLayer.addLayer(L.circleMarker(q, { pane: "hunt", radius: 5, color: "#fff", weight: 2, fillColor: ORANGE, fillOpacity: 1, interactive: false }));
    let d = 0;
    for (let i = 1; i < p.length; i++) d += map.distance(p[i - 1], p[i]);
    $("hnMeasTxt").innerHTML = !p.length ? "Tap the map where you start" : p.length === 1 ? "Now tap the next point" : `<b>${fmtDist(d)}</b>${p.length > 2 ? `<span class="hn-note"> · inside: ${fmtArea(areaOf(p))}</span>` : ""}`;
    measBar.querySelector('[data-m="undo"]').disabled = !p.length;
  }
  function measStart() {
    if (sqMode) squareCancel();
    meas = [];
    measBar.hidden = false; document.body.classList.add("hn-measuring"); $("hnMeasure").setAttribute("aria-pressed", "true");
    measDraw();
    if (phone()) showMap();
  }
  function measStop() {
    meas = null;
    measBar.hidden = true; document.body.classList.remove("hn-measuring"); $("hnMeasure").setAttribute("aria-pressed", "false");
    measureLayer.clearLayers();
  }
  $("hnMeasure").addEventListener("click", () => (meas ? measStop() : measStart()));
  // Compass mode lives in compass.js (also the Compass button on the map).
  $("hnCompass").addEventListener("click", () => { if (meas) measStop(); if (window.tfCompass) window.tfCompass.on() ? window.tfCompass.stop() : window.tfCompass.start(); });
  $("hnMeasure").setAttribute("aria-pressed", "false");
  new MutationObserver(() => pane.querySelector('[data-act="measure"]').classList.toggle("on", $("hnMeasure").getAttribute("aria-pressed") === "true"))
    .observe($("hnMeasure"), { attributes: true, attributeFilter: ["aria-pressed"] });
  document.addEventListener("keydown", (e) => { if (meas && e.key === "Escape") measStop(); });

  // ---------- quick actions ----------
  pane.querySelector(".hn-actions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, P = window.tfPoints;
    if (act === "me") locate(b);
    else if (act === "measure" || act === "compass") $(act === "measure" ? "hnMeasure" : "hnCompass").click();   // phones: tiles (Save a point and My hunts live in Saved)
    else if (!P) hint("Points aren't available in this browser.");
    else if (act === "point") P.add();
    else if (act === "truck") truckMenu(b);
    else if (act === "log") P.openLog();
  });
  // One Truck button: marks the truck the first time, then offers the way back (or moving it).
  function truckMenu(b) {
    const P = window.tfPoints, old = $("hnTruck");
    if (old) { old.remove(); return; }
    if (!P.hasTruck || !P.hasTruck()) { P.markTruck(b); return; }
    const m = document.createElement("div");
    m.id = "hnTruck"; m.className = "hn-tmenu";
    m.innerHTML = `<button type="button" class="hn-btn" data-t="back">${svg(IC.back, 16)} Back to truck</button><button type="button" class="hn-btn ghost" data-t="move">Truck is here now</button>`;
    m.addEventListener("click", (e) => {
      const t = e.target.closest("[data-t]"); if (!t) return;
      m.remove();
      if (t.dataset.t === "back") P.backToTruck(b); else P.markTruck(b);
    });
    pane.querySelector(".hn-actions").after(m);
  }

  // ---------- offline: save this area's hunting layers ----------
  // The data files and the picture tiles of the layers that are on (and the terrain for slope and aspect), zoom 10 to 15,
  // go in the same "tf-offline-1" cache as Offline maps; sw.js answers from it when there's no connection.
  const OFF_CACHE = "tf-offline-1", OFF_KEY = "huntOffline", OFF_MAX = 4000;
  const tx = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
  const ty = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
  function offUrls(box, layers) {
    const pvs = pvsIn(box[0], box[1], box[2], box[3]);
    const urls = [...DATA_FILES, ...pvs.flatMap((k) => [...(PV[k].zones ? [`zones-${k}`] : []), `areas-${k}`]), ...pvs.filter((k) => ["qc", "on", "mb", ...EAST].includes(k)).map((k) => `seasons-${k}`)]
      .map((n) => new URL(`data/hunting/${n}.json`, location.href).href);
    const ab = box[3] > -120.1 && box[0] < 60, bc = box[1] < -114;
    const boxIn = (b) => box[0] <= b[1][0] && box[2] >= b[0][0] && box[1] <= b[1][1] && box[3] >= b[0][1];
    for (let z = 10; z <= 15; z++) {
      const x0 = tx(box[1], z), x1 = tx(box[3], z), y0 = ty(box[2], z), y1 = ty(box[0], z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        for (const p of PICS) if (layers.includes(p.layer) && z >= p.min && (p.src ? boxIn(picBounds(p)) : p.ab ? ab : bc)) urls.push(picUrl(p, z, x, y));
        if ((layers.includes("slope") || layers.includes("aspect")) && z <= 14) urls.push(`${DEM}${z}/${x}/${y}.png`);
      }
    }
    return [...new Set(urls)];
  }
  // Offline maps (offline.js) saved in Hunting take the same files with the map: the data, and the tiles of the layers
  // on (kept with the saved area, so deleting it later drops the same tiles). tfHuntOfflineUrls: what this card's own
  // saves use, which Offline maps keeps when it deletes one of its areas.
  window.tfHuntOffline = (box, layers = offLayers()) => {
    const u = offUrls(box, layers), isData = (x) => /\/data\/hunting\//.test(x);
    return { data: u.filter(isData), tiles: u.filter((x) => !isData(x)), layers, label: layers.length ? layers.map((k) => LAYERS[k].label.toLowerCase()) : [] };
  };
  window.tfHuntOfflineUrls = () => store.get(OFF_KEY, []).flatMap((o) => offUrls(o.box, o.layers));
  const viewBox = () => { const b = map.getBounds(); return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((v) => +v.toFixed(4)); };
  const offLayers = () => [...shown].filter((k) => PICS.some((p) => p.layer === k) || k === "slope" || k === "aspect");
  const offSize = (n) => (n > OFF_MAX ? "" : `About ${Math.max(1, Math.round(n * 0.03))} MB`);
  let offBusy = null;
  function renderOffline() {
    const el = $("hnOff"), saved = store.get(OFF_KEY, []), layers = offLayers();
    const n = offUrls(offSquare || viewBox(), layers).length;
    el.innerHTML = `<p class="hn-note" style="margin-top:6px">Zones, seasons, draws${layers.length ? ` and ${esc(layers.map((k) => LAYERS[k].label.toLowerCase()).join(", "))}` : ""} for ${offSquare ? "the square you drew" : "the area on screen, or a square you draw"}, for no signal. Offline maps (${matchMedia("(max-width: 760px)").matches ? "Track tab" : "Layers menu"}) saves them with the base map and the 3D map in one go.</p>
      ${offBusy ? `<div class="hn-bar"><i style="width:${Math.round(offBusy.pct)}%"></i></div><p class="hn-note">${esc(offBusy.msg)}</p><div class="hn-row"><button type="button" class="hn-btn ghost" id="hnOffStop">Stop</button></div>`
        : `<div class="hn-row"><button type="button" class="hn-btn" id="hnOffSave"${n > OFF_MAX ? " disabled" : ""}>${offSquare ? "Save this square" : "Save this area"}</button>${offSquare
          ? `<button type="button" class="hn-pill" id="hnOffClear">${svg(IC.x, 14)}Clear the square</button>` : `<button type="button" class="hn-pill" id="hnOffDraw">${svg(IC.square, 16)}Draw a square</button>`}<span class="hn-note">${n > OFF_MAX ? (offSquare ? "Too big: draw a smaller square" : "Too big: zoom in or draw a square") : offSize(n)}</span></div>`}
      ${saved.length ? `<ul class="hn-list">${saved.map((s, i) => `<li><b>${esc(s.name)}</b><span class="hn-note">${esc(new Date(s.at).toLocaleDateString())} · ${s.n} files${s.missing ? ` · ${s.missing} missing` : ""}</span> <button type="button" class="hn-pill" data-off="${i}">Show</button> <button type="button" class="hn-pill" data-offdel="${i}" style="color:#c0392b">Delete</button></li>`).join("")}</ul>` : ""}`;
    const sv = $("hnOffSave"); if (sv) sv.addEventListener("click", () => saveOffline(layers, offSquare));
    const dr = $("hnOffDraw"); if (dr) dr.addEventListener("click", squareStart);
    const cl = $("hnOffClear"); if (cl) cl.addEventListener("click", squareCancel);
    const st = $("hnOffStop"); if (st) st.addEventListener("click", () => { if (offBusy) offBusy.stop = true; });
    el.querySelectorAll("[data-off]").forEach((b) => b.addEventListener("click", () => { const s = store.get(OFF_KEY, [])[+b.dataset.off]; if (s) map.fitBounds([[s.box[0], s.box[1]], [s.box[2], s.box[3]]]); }));
    el.querySelectorAll("[data-offdel]").forEach((b) => b.addEventListener("click", async () => {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again"; return; }
      const list = store.get(OFF_KEY, []), s = list.splice(+b.dataset.offdel, 1)[0];
      store.set(OFF_KEY, list);
      if (s) {   // keep files another saved area still uses
        const keep = new Set([...list.flatMap((o) => offUrls(o.box, o.layers)), ...(window.tfOfflineUrls ? await window.tfOfflineUrls() : [])]);
        const c = await caches.open(OFF_CACHE);
        await Promise.all(offUrls(s.box, s.layers).filter((u) => !keep.has(u) && !/\/data\/hunting\//.test(u)).map((u) => c.delete(u)));
      }
      renderOffline();
    }));
  }
  async function saveOffline(layers, square) {
    if (!("caches" in window)) { hint("This browser can't save maps offline."); return; }
    const box = square || viewBox(), urls = offUrls(box, layers);
    const c = await caches.open(OFF_CACHE);
    offBusy = { pct: 0, msg: "Starting…", stop: false };
    renderOffline(); if (square) squareBar("saving");
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
        if (done % 20 === 0) { renderOffline(); if (square) squareBar("saving"); }
      }
    };
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    const stopped = offBusy.stop;
    offBusy = null;
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
    let name = "";
    if (!stopped) {
      const near = Z().find((u) => u.c && inBox(u.b, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2) && inside(u.g, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2));
      const list = store.get(OFF_KEY, []);
      name = near ? (near.p === "qc" ? zoneName(near, true) : `${near.p === "bc" ? "MU " : ""}${zoneName(near)}${zoneSub(near) ? ` ${zoneSub(near)}` : ""}`) : `Area at ${fmtLL((box[0] + box[2]) / 2, (box[1] + box[3]) / 2)}`;
      list.unshift({ name, box, layers, n: urls.length - bad, missing: bad, at: Date.now() });
      store.set(OFF_KEY, list.slice(0, 20));
      if (!square) hint(bad ? `Saved, but ${bad} files didn't download: save it again with signal to finish.` : "Saved: these hunting layers now work with no signal.");
    }
    renderOffline();
    if (square && offSquare === square) squareBar(stopped ? "ready" : "done", { bad, name });
  }

  // ---------- offline: draw a square to save instead of the area on screen ----------
  // alex: "add the option draw a square". The same drag as Offline maps' "Draw a square" (the map stops panning and a
  // drag draws it); a bar on the map then saves it, so on a phone there's no going back to the panel.
  const SQUARE = "#1f6f4a";   // Offline maps' square colour
  let offSquare = null, sqMode = "", sqDrag = null;   // the square [s, w, n, e]; "" | "draw" | "ready" | "saving" | "done"
  const sqBar = document.createElement("div");
  sqBar.className = "sp-banner hn-meas"; sqBar.hidden = true; sqBar.setAttribute("role", "status");
  L.DomEvent.disableClickPropagation(sqBar);
  map.getContainer().append(sqBar);
  function squareBar(mode, info = {}) {
    sqMode = mode;
    const n = offSquare ? offUrls(offSquare, offLayers()).length : 0;
    const [text, acts] = mode === "draw" ? ["Drag a square over the area to save", [["cancel", "Cancel"]]]
      : mode === "ready" ? (n > OFF_MAX ? ["Too big: draw a smaller square", [["redraw", "Redraw"], ["cancel", "Cancel"]]]
        : [`Hunting layers for this square, ${offSize(n).replace("About", "about")}`, [["save", "Save"], ["redraw", "Redraw"], ["cancel", "Cancel"]]])
      : mode === "saving" ? [offBusy ? offBusy.msg : "Saving…", [["stop", "Stop"]]]
      : [info.bad ? `Saved, but ${info.bad} files didn't download: save it again with signal.` : "Saved: the hunting layers here work with no signal.",
        window.tfOffline ? [["base", "Save the base map too"], ["cancel", "Done"]] : [["cancel", "Done"]]];
    sqBar.innerHTML = `${svg(IC.square, 18)}<span>${esc(text)}</span>${acts.map(([k, t]) => `<button type="button" data-sq="${k}">${t}</button>`).join("")}`;
    sqBar.dataset.name = info.name || "";
    sqBar.hidden = false;
    const mapEl = map.getContainer();
    mapEl.classList.toggle("drawing", mode === "draw");
    if (mode === "draw") map.dragging.disable(); else map.dragging.enable();
  }
  function squareStart() {
    if (meas) measStop();
    const b3 = $("btn3d");
    if (b3 && b3.getAttribute("aria-pressed") === "true") b3.click();   // the square is drawn on the flat map
    offSquare = null; squareLayer.clearLayers();
    squareBar("draw"); renderOffline();
    if (phone()) showMap();
  }
  function squareCancel() {
    if (sqMode === "saving" && offBusy) offBusy.stop = true;
    sqMode = ""; sqDrag = null; offSquare = null;
    squareLayer.clearLayers(); sqBar.hidden = true;
    map.getContainer().classList.remove("drawing"); map.dragging.enable();
    renderOffline();
  }
  sqBar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sq]"); if (!b) return;
    const k = b.dataset.sq;
    if (k === "cancel") squareCancel();
    else if (k === "redraw") squareStart();
    else if (k === "save") saveOffline(offLayers(), offSquare);
    else if (k === "stop") { if (offBusy) offBusy.stop = true; }
    else if (k === "base") { const box = offSquare, name = sqBar.dataset.name; squareCancel(); window.tfOffline.saveBox(box, name); }
  });
  {
    const mapEl = map.getContainer(), swallow = (c) => c.stopPropagation();
    mapEl.addEventListener("pointerdown", (e) => {
      if (sqMode !== "draw" || e.button > 0 || e.target.closest(".leaflet-control, .sp-banner")) return;
      e.preventDefault(); e.stopPropagation();
      mapEl.setPointerCapture(e.pointerId);
      const ll = map.mouseEventToLatLng(e);
      sqDrag = { start: ll, rect: L.rectangle([ll, ll], { pane: "hunt", color: SQUARE, weight: 2, dashArray: "6 6", fillOpacity: 0.06, interactive: false }).addTo(squareLayer) };
    }, true);
    mapEl.addEventListener("pointermove", (e) => {
      if (sqDrag) { e.stopPropagation(); sqDrag.rect.setBounds(L.latLngBounds(sqDrag.start, map.mouseEventToLatLng(e))); }
    }, true);
    mapEl.addEventListener("pointerup", (e) => {
      if (!sqDrag) return;
      e.stopPropagation();
      const b = L.latLngBounds(sqDrag.start, map.mouseEventToLatLng(e));
      sqDrag = null;
      squareLayer.clearLayers();
      mapEl.addEventListener("click", swallow, true);   // the click that follows the drag isn't a tap on the map
      setTimeout(() => mapEl.removeEventListener("click", swallow, true), 400);
      if (map.latLngToContainerPoint(b.getNorthWest()).distanceTo(map.latLngToContainerPoint(b.getSouthEast())) < 20) return;   // a tap: keep drawing
      offSquare = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((v) => +v.toFixed(4));
      L.rectangle(b, { pane: "hunt", color: SQUARE, weight: 2, fillOpacity: 0.08, interactive: false }).addTo(squareLayer);
      squareBar("ready"); renderOffline();
    }, true);
  }

  // ---------- 3D map (map3d.js) ----------
  // map3d.js copies every line on the flat map (zone, park and closure outlines, the scent cone's edge), but not
  // fills, labels, pins or picture layers, so those are added here: the picture layers draped on the terrain, the
  // rules areas and scent cone as see-through fills, the zone labels, and the spot pin. A tap on the 3D map picks a
  // spot as on the flat map.
  let gl3 = null, proto3 = false, fillsSet = false, labelsSet = false, spot3 = null, glass3 = "";
  let applyWait = false;
  function sync3d() {
    const gl = gl3;
    if (!gl || !window.maplibregl) return;
    if (!proto3) {
      proto3 = true;
      maplibregl.addProtocol("tfhunt", async (params) => {
        const parts = params.url.replace("tfhunt://", "").split("?")[0].split("/");
        if (parts[0] === "recolor") {   // a picture repainted on the phone (Alberta forest)
          const p = PICS.find((q) => q.id === parts[1]);
          return { data: await createImageBitmap(await recolorTile(p, +parts[2], +parts[3], +parts[4])) };
        }
        if (parts[0] === "pic") {   // a picture layer whose address depends on the tile (Far from roads)
          const p = PICS.find((q) => q.id === parts[1]), r = await fetch(picUrl(p, +parts[2], +parts[3], +parts[4]));
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return { data: await r.arrayBuffer() };
        }
        const [mode, z, x, y] = parts;
        // A picture, not PNG bytes: encoding a canvas on the page waits for the 3D map's drawing (see map3d.js tfdem).
        return { data: await createImageBitmap(await paintTerrain(mode, +z, +x, +y)) };
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
      for (const p of PICS) raster(p.id, want(p.layer), { type: "raster", tiles: [p.recolor ? `tfhunt://recolor/${p.id}/{z}/{x}/{y}` : p.url ? `tfhunt://pic/${p.id}/{z}/{x}/{y}` : p.tmpl.replace("{bbox}", "{bbox-epsg-3857}")], tileSize: 256, minzoom: Math.max(0, p.min - 1), bounds: ((b) => [b[0][1], b[0][0], b[1][1], b[1][0]])(picBounds(p)), attribution: p.attr.replace(/<[^>]+>/g, "") }, p.opacity);
      raster("hn-slope", want("slope"), { type: "raster", tiles: ["tfhunt://slope/{z}/{x}/{y}"], tileSize: 256, minzoom: 8, maxzoom: 14 }, 1);
      raster("hn-aspect", want("aspect"), { type: "raster", tiles: ["tfhunt://aspect/{z}/{x}/{y}"], tileSize: 256, minzoom: 8, maxzoom: 14 }, 1);
      // Rules areas as fills (their outlines come over with the other lines).
      if (want("rules") && A().length && fillsSet !== `${pvVer}.${!!areas}`) {
        fillsSet = `${pvVer}.${!!areas}`;
        const feats = A().filter((a) => AREA_KINDS[a.k] && !AREA_KINDS[a.k].line).map((a) => {
          const k = AREA_KINDS[a.k];
          return { type: "Feature", properties: { c: k.color, o: Math.min(0.35, fillOp(a.k, k) * 2.5), h: hatched(k) },   // fills stronger over the photos than over the 2D map
            geometry: { type: "Polygon", coordinates: a.g.map((r) => { const out = []; for (let i = 0; i < r.length; i += 2) out.push([r[i + 1], r[i]]); return out; }) } };
        });
        if (gl.getSource("hn-fill")) gl.getSource("hn-fill").setData({ type: "FeatureCollection", features: feats });
        else {
        gl.addSource("hn-fill", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
        gl.addLayer({ id: "hn-fill", type: "fill", source: "hn-fill", filter: ["!", ["get", "h"]], paint: { "fill-color": ["get", "c"], "fill-opacity": ["get", "o"] } }, under);
        if (!gl.hasImage("hn-hatch")) gl.addImage("hn-hatch", hatch3d.getContext("2d").getImageData(0, 0, 16, 16));
        gl.addLayer({ id: "hn-hatch", type: "fill", source: "hn-fill", filter: ["get", "h"], paint: { "fill-pattern": "hn-hatch", "fill-opacity": 1 } }, under);
        }
      }
      vis("hn-fill", want("rules")); vis("hn-hatch", want("rules"));
      // Zone labels.
      if (want("zones") && Z().length && labelsSet !== `${pvVer}.${!!zones}`) {
        labelsSet = `${pvVer}.${!!zones}`;
        const feats = Z().filter(labelled).map((u) => ({ type: "Feature", geometry: { type: "Point", coordinates: [u.c[1], u.c[0]] },
          properties: { t: zoneName(u), n: zoneSub(u), ab: u.p === "ab" } }));
        if (gl.getSource("hn-labels")) gl.getSource("hn-labels").setData({ type: "FeatureCollection", features: feats });
        else {
          gl.addSource("hn-labels", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
          gl.addLayer({ id: "hn-labels", type: "symbol", source: "hn-labels", minzoom: 5,
            layout: { "text-field": ["step", ["zoom"], ["get", "t"], 8, ["concat", ["get", "t"], "\n", ["get", "n"]]], "text-font": ["Noto Sans Bold"], "text-size": 13, "text-allow-overlap": false },
            paint: { "text-color": C.zone, "text-halo-color": "#fff", "text-halo-width": 2 } });
        }
      }
      vis("hn-labels", want("zones"));
      // The glassing view (the ground hidden from the spot).
      const gUrl = isHunt() && glass ? glass.url : "";
      if (gl.getSource("hn-glass") && glass3 !== gUrl) { if (gl.getLayer("hn-glass")) gl.removeLayer("hn-glass"); gl.removeSource("hn-glass"); }
      if (gUrl && !gl.getSource("hn-glass")) {
        const [w, s, e, n] = glass.box;
        gl.addSource("hn-glass", { type: "image", url: gUrl, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
        gl.addLayer({ id: "hn-glass", type: "raster", source: "hn-glass", paint: { "raster-opacity": 1, "raster-fade-duration": 0 } }, under);
      }
      glass3 = gUrl;
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
    // the style itself being ready is enough (alex lost the spot circle in 3D). A 3D map just opened waits for its
    // style ("style.load", a moment later), not for "idle": that waits for every photo and hunting tile, 30 s or
    // more, and the spot dot and scent cone stayed off until then (alex: "add a dot like we had before").
    if (gl.style && (gl.style._loaded || gl.isStyleLoaded())) apply();
    else if (!applyWait) {
      applyWait = true;
      const go = () => { if (!applyWait) return; applyWait = false; apply(); };
      gl.once("style.load", go); gl.once("load", go); gl.once("idle", go);
    }
  }
  // This file loads the first time Hunting is picked (winter.js), often after the 3D map was built: take that one too.
  const on3d = (e) => {
    gl3 = e.detail;
    fillsSet = labelsSet = false;
    gl3.on("click", (ev) => {
      if (!isHunt() || document.querySelector(".app.riding, .app.planning") || document.body.classList.contains("cp-on")) return;
      if (meas) { meas.push(L.latLng(ev.lngLat.lat, ev.lngLat.lng)); measDraw(); return; }
      if (gl3.getLayer("hits") && gl3.queryRenderedFeatures(ev.point, { layers: ["hits"] }).length) return;   // a trail or road line took the tap
      setSpot(ev.lngLat.lat, ev.lngLat.lng, "tap");
      showSpot(ev.lngLat.lat, ev.lngLat.lng);
    });
    sync3d();
  };
  window.addEventListener("tf:map3d", on3d);

  // For ski-points.js: the hunting zone at a point, for the harvest log.
  window.tfHunt = {
    // moto.js (Can I ride here): the parks, reserves, closures and other land at a point or in a box, the same
    // outlines as the Hunting rules layer ({ k, n, p, b, g } with g as flat [lat, lon, ...] rings).
    async areasAt(lat, lon) {
      try { areas = areas || (await load("areas")).areas; } catch {}
      await loadPv(pvsIn(lat, lon, lat, lon));
      return at(A(), lat, lon);
    },
    async areasIn(s, w, n, e) {
      try { areas = areas || (await load("areas")).areas; } catch {}
      if (n - s < 12 && e - w < 20) await loadPv(pvsIn(s, w, n, e));
      return A().filter((x) => boxHits(x.b, s, w, n, e));
    },
    // Ask in plain words (ask.js): this spot's card (zone, what's open, rules) at a place.
    openAt(lat, lon) {
      map.setView([lat, lon], Math.max(map.getZoom(), 11));
      setSpot(lat, lon, "tap"); showSpot(lat, lon);
    },
    async zoneAt(lat, lon) {
      try { zones = zones || (await load("zones")).zones; } catch {}
      await loadPv(pvsIn(lat, lon, lat, lon));
      const u = at(Z(), lat, lon)[0];
      return u ? (u.p === "bc" ? `MU ${u.id}` : u.p === "qc" ? `Zone ${u.n}` : zoneName(u)) : "";
    },
  };

  // ---------- switching sport ----------
  const compassOn = () => document.body.classList.contains("cp-on");   // compass mode (compass.js) takes taps for its target
  map.on("click", (e) => {
    if (!isHunt() || document.querySelector(".app.riding, .app.planning") || sqMode === "draw" || compassOn()) return;
    if (meas) { meas.push(e.latlng); measDraw(); return; }
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
    if (!on && meas) measStop();
    if (!on && sqMode) squareCancel();
    if (on) cull();   // the outlines near the view now, before they go on the map
    for (const l of allHunt) { if (on && !map.hasLayer(l)) l.addTo(map); else if (!on && map.hasLayer(l)) map.removeLayer(l); }
    if (on && !keyCtl._map) keyCtl.addTo(map); else if (!on && keyCtl._map) keyCtl.remove();
    syncTiles(); sync3d();
    if (!on) return;
    if (!started) { started = true; renderLayers(); drawZones(); drawLeh(); drawRules(); }
    viewPv();
    drawLabels();
    if (!spot) { const c = map.getCenter(); setSpot(c.lat, c.lng, "centre"); } else loadWeather();
    renderWx(); renderSky(); renderOffline();
  }
  window.addEventListener("tf:sport", sync);
  sync();
  if (window.trailMap3d) on3d({ detail: window.trailMap3d });
})();
