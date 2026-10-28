// Hunting outside BC and Alberta (alex 2026-10-26: "is hunting mode available everywhere in canada?" "yes"), used by
// build-hunting.mjs. One set of files per province or territory, so a phone only loads the ones near the map:
//  - zones-<pv>.json: the hunting zones (Quebec zones and parts of zones, Ontario WMUs, Manitoba GHAs, Saskatchewan
//    WMZs, New Brunswick WMZs, Nova Scotia deer management zones, Newfoundland and Labrador moose management areas,
//    Yukon game management areas), each with a label point.
//  - areas-<pv>.json: places with their own hunting rules (parks, reserves, refuges, preserves, ZECs, wildlife
//    reserves, outfitters with exclusive rights, wildlife management areas, First Nation reserves).
//  - seasons-qc.json, seasons-on.json, seasons-nl.json: open seasons per zone, read from the regulation pages on
//    quebec.ca, ontario.ca and gov.nl.ca; seasons-mb.json: Manitoba's season table per GHA; seasons-nb.json and
//    seasons-ns.json: typed in from the provinces' PDF summaries (NB_SEASONS, NS_SEASONS); seasons-yt.json the same
//    from the Yukon Hunting Regulations Summary, per game management subzone (YT_SEASONS).
// Sources (all free official data):
//  Quebec: the wildlife ministry's public map server (servicesvecto3.mern.gouv.qc.ca SmartFaunePub: hunting zones and
//    "hunting not allowed" areas, MFFP licence) and the Territoires récréatifs du Québec layer (MRNF, CC BY 4.0).
//  Ontario: Land Information Ontario open data (Open Government Licence - Ontario).
//  Manitoba: Manitoba geoportal (Manitoba Open Data Licence). Saskatchewan: gis.saskatchewan.ca (Open Government
//    Licence - Saskatchewan). New Brunswick: GeoNB (Open Government Licence - New Brunswick). Nova Scotia: Nova Scotia
//    open data (Open Government Licence - Nova Scotia). Newfoundland and Labrador: Wildlife Division map service.
//    Yukon: GeoYukon (Open Government Licence - Yukon).
//  Everywhere: the Canadian Protected and Conserved Areas Database (ECCC) and CLSS First Nation reserves (NRCan),
//    Open Government Licence - Canada.
// A source that fails keeps its last good data (each file is only written when its zones came in).

const QC_WFS = "https://servicesvecto3.mern.gouv.qc.ca/geoserver/SmartFaunePub/ows";
const TRQ = "https://servicescarto.mrnf.gouv.qc.ca/pes/rest/services/Territoire/TRQ_WMS/MapServer";
const LIO = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA";
const MB = "https://services.arcgis.com/mMUesHYPkXjaFGfS/arcgis/rest/services";
const SK = "https://gis.saskatchewan.ca/arcgis/rest/services/WildlifeManagement/MapServer";
const NB = "https://gis-erd-der.gnb.ca/server/rest/services/OpenData/WMZ/MapServer/0";
const NS = "https://data.novascotia.ca/api/geospatial/m6qa-i3w9?method=export&format=GeoJSON";
const NL = "https://services8.arcgis.com/aCyQID5qQcyrJMm2/ArcGIS/rest/services/WLD_BigGameManagementArea/FeatureServer/0";
const YT = "https://mapservices.gov.yk.ca/arcgis/rest/services/GeoYukon/GY_AdministrativeBoundaries/MapServer/7";
const CPCAD = "https://maps-cartes.ec.gc.ca/arcgis/rest/services/CWS_SCF/CPCAD/MapServer/0";
const CLSS = "https://proxyinternet.nrcan-rncan.gc.ca/arcgis/rest/services/CLSS-SATC/CLSS_Administrative_Boundaries/MapServer/0";

// CPCAD's LOC codes and CLSS's jurisdiction names.
const PROV = {
  qc: { loc: 11, name: "Quebec" }, on: { loc: 9, name: "Ontario" }, mb: { loc: 3, name: "Manitoba" }, sk: { loc: 12, name: "Saskatchewan" },
  nb: { loc: 4, name: "New Brunswick" }, ns: { loc: 7, name: "Nova Scotia" }, pe: { loc: 10, name: "Prince Edward Island" },
  nl: { loc: 5, name: "Newfoundland and Labrador" }, yt: { loc: 13, name: "Yukon" }, nt: { loc: 6, name: "Northwest Territories" }, nu: { loc: 8, name: "Nunavut" },
};

// CPCAD designation types with a hunting rule (hunting.js AREA_KINDS); private and NGO land, habitat designations and
// planning areas are left out (the land owner's or the zone's rules apply there).
const CPCAD_KIND = [
  [/^national park|park reserve|national marine|national urban park/i, "national"],
  [/ecological reserve|^nature reserve|^nature preserve/i, "eco"],
  [/migratory bird sanctuary/i, "mbs"],
  [/national wildlife area/i, "nwa"],
  [/wildlife refuge|game preserve|wildlife sanctuary|wildlife preserve|^wildlife reserve/i, "refuge"],
  [/wildlife management area|fish and wildlife development fund/i, "wmaopen"],
  [/^conservation reserve$/i, "consres"],
  [/^conservation area$/i, "consarea"],
  [/wilderness area|wilderness reserve|biodiversity reserve|wilderness park/i, "wild"],
  [/protected natural area|^protected area|provincially owned natural area|provincially owned conservation area|special management area|habitat protection area/i, "protected"],
  [/provincial park|territorial park|natural environment park|recreation park|historic park|recreation site|wildlife park/i, "park"],
  [/provincial pasture/i, "pasture"],
];
const cpcadKind = (t) => (CPCAD_KIND.find(([re]) => re.test(t || "")) || [])[1];

export async function canada(h) {
  const { log, arcgis, getJson, rings, bbox, labelPoint, title, write, readOld, now, curlText } = h;
  const zoneOf = (p, id, g, extra = {}) => (g.length ? { p, id: String(id), ...extra, b: bbox(g), c: labelPoint(g), g } : null);
  // ArcGIS layers on servers that can't page (the Quebec ones): the whole layer at once.
  const whole = async (layer, fields, where = "1=1", offset = 0.0005) => {
    const p = new URLSearchParams({ where, outFields: fields.join(","), outSR: "4326", f: "geojson", maxAllowableOffset: String(offset) });
    let fc;
    try { fc = await getJson(`${layer}/query?${p}`); } catch { p.delete("maxAllowableOffset"); fc = await getJson(`${layer}/query?${p}`); }
    return fc.features || [];
  };
  // Quebec's WFS, 1000 features a page.
  const wfs = async (type, props) => {
    const out = [];
    for (let start = 0; ; start += 1000) {
      const p = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeNames: `SmartFaunePub:${type}`, outputFormat: "application/json",
        srsName: "EPSG:4326", count: "1000", startIndex: String(start), sortBy: props[0] });
      const fc = await getJson(`${QC_WFS}?${p}`);
      out.push(...(fc.features || []));
      log(`    ${type}: ${out.length} of ${fc.numberMatched ?? "?"}`);
      if (!fc.features || fc.features.length < 1000) break;
    }
    return out;
  };
  // Several pieces of one zone (islands, a zone in two parts) become one zone with all their rings.
  const group = (feats, key, tol = 0.0015) => {
    const by = new Map();
    for (const x of feats) {
      const k = key(x.properties); if (k == null) continue;
      const e = by.get(k) || by.set(k, { p: x.properties, g: [] }).get(k);
      e.g.push(...rings(x.geometry, tol));
    }
    return by;
  };

  // ---------- zones ----------
  const fixQc = (s) => String(s || "").replace(/[\x80-\x9f]/g, "").replace(/×le/g, "Île").replace(/Beaupr\b/g, "Beaupré").replace(/\bZSR\b/, "").trim();
  const PART = { Nord: "nord", Sud: "sud", Est: "est", Ouest: "ouest", "Sud-ouest": "sud-ouest", "Sud-Ouest": "sud-ouest", "Sud-Est": "sud-est", "Sud-Nord-Ouest": "sud-nord-ouest" };
  const ZONES = {
    async qc() {
      const by = group(await wfs("Zone_chasse_da3_sefaq", ["Zone", "No_zone", "Partie_zon"]), (p) => p.Zone);
      return [...by].map(([code, { p, g }]) => {
        const no = String(+p.No_zone), raw = fixQc(p.Partie_zon), base = raw.split(" ")[0], part = PART[base] || base.toLowerCase();
        const island = /Île/.test(raw), extra = /\(([^)]+)\)/.exec(raw)?.[1] || "";
        const cwd = /Z$/.test(code);   // ZSR: the chronic wasting disease enhanced surveillance zone (deer and moose must be registered and tested)
        const n = `${no}${part ? ` ${part}` : ""}${island ? " (islands)" : ""}${extra && !island ? ` (${extra})` : ""}`;
        return zoneOf("qc", code, g, { no, part, n, ...(island ? { isl: 1 } : {}), ...(cwd ? { cwd: 1 } : {}), ...(/Rigaud/.test(raw) ? { sp: "rigaud" } : {}) });
      }).filter(Boolean);
    },
    async on() {
      const f = await arcgis(`${LIO}/LIO_Open05/MapServer/5`, ["OFFICIAL_NAME", "OBJECTID"], "1=1", 0.0008);
      return [...group(f, (p) => p.OFFICIAL_NAME)].map(([id, { g }]) => zoneOf("on", id, g)).filter(Boolean);
    },
    async mb() {
      const f = await arcgis(`${MB}/Manitoba_Game_Hunting_Areas/FeatureServer/0`, ["GHA", "OBJECTID"], "1=1", 0.0008);
      return [...group(f, (p) => p.GHA)].map(([id, { g }]) => zoneOf("mb", id, g)).filter(Boolean);
    },
    async sk() {
      const f = await arcgis(`${SK}/0`, ["ZONE_NUM", "DA_NAME", "OBJECTID"], "1=1", 0.0008);
      return [...group(f, (p) => p.ZONE_NUM)].map(([id, { g }]) => zoneOf("sk", id, g)).filter(Boolean);
    },
    async nb() {
      const f = await arcgis(NB, ["WMZ", "OBJECTID_1"], "1=1", 0.0008, null, "OBJECTID_1");
      return [...group(f, (p) => p.WMZ)].map(([id, { g }]) => zoneOf("nb", id, g)).filter(Boolean);
    },
    async ns() {
      const fc = await getJson(NS);
      return [...group(fc.features || [], (p) => String(Math.round(+p.deer_zone)))].map(([id, { g }]) => zoneOf("ns", id, g)).filter(Boolean);
    },
    async nl() {
      const f = await arcgis(NL, ["mmu", "mma_name", "objectid"], "1=1", 0.0008, null, "objectid");
      return [...group(f, (p) => p.mmu)].map(([id, { p, g }]) => zoneOf("nl", id, g, { n: p.mma_name || "" })).filter(Boolean);
    },
    async yt() {
      const f = await arcgis(YT, ["GAME_MGMT_AREA_ID", "OBJECTID"], "1=1", 0.0008);
      // 909 = zone 9, subzone 09 ("GMA 9-09" in the regulations)
      return [...group(f, (p) => p.GAME_MGMT_AREA_ID)].map(([id, { g }]) => zoneOf("yt", `${Math.floor(id / 100)}-${String(id % 100).padStart(2, "0")}`, g)).filter(Boolean);
    },
  };

  // ---------- areas ----------
  const area = (p, k, n, geom, tol = 0.0006, extra = {}) => { const g = rings(geom, tol); return g.length ? { k, n, p, ...extra, b: bbox(g), g } : null; };
  async function cpcad(pv, skip = () => false) {
    const f = await arcgis(CPCAD, ["NAME_E", "TYPE_E", "OBJECTID"], `LOC=${PROV[pv].loc}`, 0.0003);
    const out = [];
    for (const x of f) {
      const t = x.properties.TYPE_E, k = cpcadKind(t);
      if (!k || skip(k, t)) continue;
      const a = area(pv, k, x.properties.NAME_E || t, x.geometry, 0.0006, { t });
      if (a) out.push(a);
    }
    return out;
  }
  async function reserves(pv) {
    const f = await arcgis(CLSS, ["adminAreaNameEng", "OBJECTID"], `jurisdictionEng='${PROV[pv].name}'`, 0.0002).catch((e) => { log(`    CLSS ${pv}: ${e.message}`); return []; });
    return f.map((x) => area(pv, "reserve", title(x.properties.adminAreaNameEng || "First Nation reserve"), x.geometry, 0.0002)).filter(Boolean);
  }
  const AREAS = {
    async qc() {
      const out = [];
      // "Hunting not allowed": ecological reserves, Quebec's national parks and other closed territory.
      for (const x of await wfs("Chasse_Interdite", ["OBJECTID"])) {
        const p = x.properties, d = p.DESIG_GR || "";
        const k = /écologique/i.test(d) ? "eco" : /Parc national du Québec/i.test(d) ? "qcpark" : /Canada/i.test(d) ? "national" : "qcclosed";
        const a = area("qc", k, p.TOPONYME || p.NOM || d, x.geometry, 0.0006, { ...(p.LIEN ? { u: p.LIEN } : {}), ...(/restreinte/i.test(d) ? { t: "restricted" } : {}) });
        if (a) out.push(a);
      }
      for (const [layer, k] of [[16, "zec"], [11, "qcwres"], [8, "outfit"], [15, "outfit"], [10, "refuge"], [9, "mbs"], [12, "nwa"], [6, "park"], [0, "afc"]]) {
        const f = await whole(`${TRQ}/${layer}`, ["NOM_OFFICIEL", "NATURE_DU_DROIT_OCTROYÉ", "CODE_ADMINISTRATIF"]).catch((e) => { log(`    TRQ ${layer}: ${e.message}`); return []; });
        let n = 0;
        for (const x of f) {
          const p = x.properties, right = p["NATURE_DU_DROIT_OCTROYÉ"] || "";
          if (k === "zec" && !/chasse/i.test(right)) continue;   // salmon river ZECs: fishing only, the zone's rules apply
          const a = area("qc", k, p.NOM_OFFICIEL || "", x.geometry, 0.0006, right ? { t: right } : {});
          if (a) { out.push(a); n++; }
        }
        log(`    TRQ ${layer} (${k}): ${n}`);
      }
      out.push(...await reserves("qc"));
      return out;
    },
    async on() {
      const out = [];
      for (const [svc, layer, k, name] of [["LIO_Open05", 7, "preserve", "OFFICIAL_NAME"], ["LIO_Open03", 4, "park", "PROTECTED_AREA_NAME_ENG"], ["LIO_Open03", 2, "consres", "PROTECTED_AREA_NAME_ENG"],
        ["LIO_Open03", 9, "nwa", "OFFICIAL_NAME"]]) {
        const f = await arcgis(`${LIO}/${svc}/MapServer/${layer}`, ["*"], "1=1", 0.0003).catch((e) => { log(`    LIO ${layer}: ${e.message}`); return []; });
        for (const x of f) {
          const p = x.properties || {}, n = p[name] || p.OFFICIAL_NAME || p[Object.keys(p).find((q) => /NAME/.test(q))] || "";
          const a = area("on", k, title(n), x.geometry); if (a) out.push(a);
        }
        log(`    LIO ${svc}/${layer} (${k}): ${f.length}`);
      }
      // CPCAD for what LIO doesn't have here: national parks, bird sanctuaries, conservation areas, wilderness.
      out.push(...await cpcad("on", (k) => ["park", "consres", "nwa"].includes(k)));
      out.push(...await reserves("on"));
      return out;
    },
    async mb() {
      const out = [];
      for (const [svc, k, name] of [["Lands_Closed_to_Hunting", "closed", "Name"], ["Manitoba_Wildlife_Lands", "refuge", "NAME"], ["bdy_wildlife_mgmt_areas_py_shp", "wmaopen", "NAME_E"], ["Manitoba_Parks", "park", "NAME_E"]]) {
        const f = await arcgis(`${MB}/${svc}/FeatureServer/0`, ["*"], "1=1", 0.0003, null, /_shp$/.test(svc) ? "FID" : "OBJECTID").catch((e) => { log(`    ${svc}: ${e.message}`); return []; });
        for (const x of f) {
          const p = x.properties || {};
          const a = area("mb", k, title(p[name] || ""), x.geometry, 0.0006, p.Restric || p.HUNTING_RESTRICTIONS ? { d: String(p.Restric || p.HUNTING_RESTRICTIONS).slice(0, 400) } : {});
          if (a) out.push(a);
        }
        log(`    ${svc} (${k}): ${f.length}`);
      }
      // Provincial forests: Crown forest land, shown with the "Private and public land" layer (crownland.js has the rest).
      const pf = await arcgis(`${MB}/Manitoba_Provincial_Forests___Version_6/FeatureServer/1`, ["PROV_FOREST_NAME", "OBJECTID"], "1=1", 0.0005).catch((e) => { log(`    provincial forests: ${e.message}`); return []; });
      for (const x of pf) { const a = area("mb", "provforest", title(x.properties.PROV_FOREST_NAME || "Provincial forest"), x.geometry, 0.001); if (a) out.push(a); }
      log(`    provincial forests (provforest): ${pf.length}`);
      out.push(...await cpcad("mb", (k) => ["park", "wmaopen", "refuge"].includes(k)));
      out.push(...await reserves("mb"));
      return out;
    },
    async sk() {
      const out = [];
      const f = await arcgis(`${SK}/1`, ["RCGP_NAME", "OBJECTID"], "1=1", 0.0003).catch(() => []);
      for (const x of f) { const a = area("sk", "rcgp", `${x.properties.RCGP_NAME} road corridor game preserve`, x.geometry); if (a) out.push(a); }
      out.push(...await cpcad("sk"), ...await reserves("sk"));
      return out;
    },
    nb: async () => [...await cpcad("nb"), ...await reserves("nb")],
    ns: async () => [...await cpcad("ns"), ...await reserves("ns")],
    pe: async () => [...await cpcad("pe"), ...await reserves("pe")],
    nl: async () => [...await cpcad("nl"), ...await reserves("nl")],
    yt: async () => [...await cpcad("yt"), ...await reserves("yt")],
    nt: async () => [...await cpcad("nt"), ...await reserves("nt")],
    nu: async () => [...await cpcad("nu")],
  };

  const ONLY_PV = (process.env.PROV || "").split(",").filter(Boolean);
  for (const pv of Object.keys(PROV)) {
    if (ONLY_PV.length && !ONLY_PV.includes(pv)) continue;
    log(`${PROV[pv].name}`);
    if (ZONES[pv]) {
      try {
        const z = await ZONES[pv]();
        if (z.length < 5) throw new Error(`only ${z.length} zones`);
        write(`zones-${pv}.json`, { updated: now, zones: z });
      } catch (e) { log(`  ${pv} zones failed: ${e.message}`); }
    }
    try {
      const a = await AREAS[pv]();
      const old = readOld(`areas-${pv}.json`)?.areas || [];
      if (a.length < Math.min(5, old.length * 0.5)) throw new Error(`only ${a.length} areas (had ${old.length})`);
      write(`areas-${pv}.json`, { updated: now, areas: a });
    } catch (e) { log(`  ${pv} areas failed: ${e.message}`); }
  }

  // ---------- seasons ----------
  const seasons = {};
  if (!ONLY_PV.length || ONLY_PV.includes("qc")) try { seasons.qc = await qcSeasons(curlText); } catch (e) { log(`  Quebec seasons failed: ${e.message}`); }
  if (!ONLY_PV.length || ONLY_PV.includes("on")) try { seasons.on = await onSeasons(curlText); } catch (e) { log(`  Ontario seasons failed: ${e.message}`); }
  if (!ONLY_PV.length || ONLY_PV.includes("mb")) try {
    const f = await getJson(`${MB}/Manitoba_Game_Hunting_Areas/FeatureServer/1/query?where=1%3D1&outFields=*&f=json`);
    const gha = {};
    for (const { attributes: a } of f.features || []) {
      const rows = [];
      for (const [k, v] of Object.entries(a)) {
        if (["OBJECTID", "GHA", "Disclaimer"].includes(k) || !v || /^none$/i.test(String(v).trim())) continue;
        rows.push([k.replace(/_/g, " ").replace("Gray Wolf and Coyote", "Gray wolf and coyote").replace(/^(\w)(.*)$/, (m, a, b) => a + b.toLowerCase()).replace("White tailed", "White-tailed"),
          String(v).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim()]);
      }
      if (a.GHA != null) gha[String(a.GHA)] = rows;
    }
    if (Object.keys(gha).length < 30) throw new Error(`only ${Object.keys(gha).length} GHAs`);
    seasons.mb = { src: "Manitoba GHA Hunting Season Table", gha };
    log(`  Manitoba seasons: ${Object.keys(gha).length} GHAs`);
  } catch (e) { log(`  Manitoba seasons failed: ${e.message}`); }
  if (!ONLY_PV.length || ONLY_PV.includes("nl")) try { seasons.nl = nlSeasons(curlText, log); } catch (e) { log(`  Newfoundland and Labrador seasons failed: ${e.message}`); }
  // New Brunswick and Nova Scotia publish their seasons only in PDFs: typed in from this year's summaries (below).
  if (!ONLY_PV.length || ONLY_PV.includes("nb")) seasons.nb = handSeasons(NB_SEASONS, 27);
  if (!ONLY_PV.length || ONLY_PV.includes("ns")) seasons.ns = handSeasons(NS_SEASONS, 112, 101);
  if (!ONLY_PV.length || ONLY_PV.includes("yt")) seasons.yt = ytSeasons(log);
  return seasons;
}

// Newfoundland and Labrador: the 2026-27 Hunting and Trapping Guide's pages (gov.nl.ca), one table per species. Moose
// seasons and licences per moose management area (the zones on the map), and black bear seasons, which the island
// gives per group of moose areas and Labrador as one area.
const NL_GUIDE = "https://www.gov.nl.ca/hunting-trapping-guide/2026-27/hunting-seasons-and-zones/";
const nlDates = (t) => String(t).replace(/\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,?\s*/g, "").replace(/\s+to\s+/g, " - ").replace(/(\d)\.(?=\s)/g, "$1").replace(/\b([A-Z][a-z]{2,4})\./g, "$1").replace(/\s*[–-]\s*/g, " - ").replace(/\s+/g, " ").trim();
const isDate = (t) => /\b(Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s*\d/.test(t);
function nlSeasons(curlText, log) {
  const wmu = {}, add = (id, row) => (wmu[id] = wmu[id] || []).push(row);
  for (const part of ["island", "labrador"]) {
    const html = curlText(`${NL_GUIDE}${part}/moose/`, `nl-${part}-moose.html`), bow = (unhtml(html).match(/Bow hunting (?:season )?begins (\w+ \d{1,2}), (\d{4})/i) || []);
    let n = 0;
    for (const { rows } of tables(html)) for (const r of rows) {
      const m = String(r[0] || "").match(/^(\d{1,3}[A-Z]?)\s+\S/);
      if (!m || !isDate(r[1] || "")) continue;
      const nums = r.slice(2).map((c) => c.replace(/,/g, "")), lic = part === "island"
        ? [nums[0] && +nums[0] ? `${nums[0]} either-sex` : "", nums[1] && +nums[1] ? `${nums[1]} male-only` : ""].filter(Boolean).join(" and ")
        : nums[0] && +nums[0] ? `${nums[0]} either-sex` : "";
      const success = part === "island" && /^\d+(\.\d+)?$/.test(nums[5] || "") ? `, ${Math.round(+nums[5])}% success in 2024` : "";
      add(m[1], ["Moose", "Licence by draw", `${lic ? `${lic} resident licences` : ""}${success}`.replace(/^, /, ""), nlDates(r[1]), 0]);
      const start = nlDates(r[1]).match(/^([A-Z][a-z]+) (\d{1,2})\b/), mon = start && EN_MON.findIndex((x) => x.slice(0, 3) === start[1].slice(0, 3));
      if (bow[1] && start && mon >= 0) { const d = new Date(Date.UTC(2026, mon, +start[2] - 1)); add(m[1], ["Moose", "Bow only (no crossbows)", "", `${bow[1].slice(0, 3)} ${bow[1].replace(/\D+/, "")} - ${EN_MON[d.getUTCMonth()]} ${d.getUTCDate()}`, 0]); }
      n++;
    }
    if (n < (part === "island" ? 30 : 10)) throw new Error(`only ${n} ${part} moose areas`);
  }
  // Island black bear: a row per moose area, the group's dates on its first row; closed areas have their own.
  const html = curlText(`${NL_GUIDE}island/black-bear/`, "nl-island-bear.html");
  let cur = null, n = 0;
  for (const { rows } of tables(html)) for (const r of rows) {
    const dates = r.filter((c) => isDate(c) || /^closed$/i.test(c));
    if (/^20\d\s*[–-]/.test(r[0] || "")) cur = dates;
    const own = dates.length ? dates : cur;
    for (let i = 0; i < r.length; i++) {
      if (!/^\d{1,2}[A-Z]?$/.test(r[i]) || !/[A-Z]/.test(r[i + 1] || "") || !own || own.length < 2) continue;
      const shut = own.every((d) => /closed/i.test(d));
      if (shut) add(r[i], ["Black bear", "", "", "Closed", 0]);
      else { add(r[i], ["Black bear", "Spring", "", nlDates(own[0]), 0]); add(r[i], ["Black bear", "Fall", "", nlDates(own[1]), 0]); }
      n++;
    }
  }
  if (n < 30) throw new Error(`only ${n} island bear areas`);
  const lab = tables(curlText(`${NL_GUIDE}labrador/black-bear/`, "nl-labrador-bear.html")).flatMap((t) => t.rows).find((r) => /^200\b/.test(r[0] || ""));
  if (lab) for (const id of Object.keys(wmu)) if (+id >= 48 && +id < 100) {
    add(id, ["Black bear", "Spring", "", nlDates(lab[1]).replace(/ to /, " - "), 0]);
    add(id, ["Black bear", "Fall", "", nlDates(lab[2]).replace(/ to /, " - "), 0]);
  }
  log(`  Newfoundland and Labrador seasons: ${Object.keys(wmu).length} moose areas`);
  return { src: "Newfoundland and Labrador Hunting and Trapping Guide 2026-27", url: NL_GUIDE, wmu };
}

// Typed in from the provinces' 2026-27 summaries (PDF only): [species, how, note, dates, zones] with zones a list of
// zone numbers, or null for every zone. Check them each spring against the new summary and change the year.
const NB_SEASONS = { year: "2026-27", src: "New Brunswick Hunt & Trap Regulations Summary 2026-2027", url: "https://www2.gnb.ca/content/dam/gnb/Departments/nr-rn/pdf/en/Wildlife/HuntTrap.pdf", rows: [
  ["White-tailed deer", "", "no deer hunting in WMZ 4, 5 and 9", "Closed", [4, 5, 9]],
  ["White-tailed deer", "Archery only", "antlered only", "Oct 5 - Oct 25", [1, 2, 3]],
  ["White-tailed deer", "Firearm", "antlered only", "Oct 26 - Nov 8", [1, 2, 3]],
  ["White-tailed deer", "Archery only", "antlerless needs a drawn authorization", "Oct 5 - Oct 25", [6, 7, 8, ...range(10, 27)]],
  ["White-tailed deer", "Firearm", "antlerless needs a drawn authorization", "Oct 26 - Nov 22", [6, 7, 8, ...range(10, 27)]],
  ["White-tailed deer", "Muzzleloader", "authorization needed, unfilled deer tag", "Nov 23 - Nov 29", [6, 10, ...range(15, 27)]],
  ["Moose", "Licence by draw", "for the one WMZ on the licence (not every WMZ has licences)", "Sept 22 - Sept 26", null],
  ["Black bear", "Spring", "", "Apr 20 - June 30", range(1, 25)],
  ["Black bear", "Fall", "bow or crossbow only Sept 21 - 26", "Sept 1 - Nov 22", range(1, 25)],
  ["Black bear", "", "no bear hunting in WMZ 26 and 27", "Closed", [26, 27]],
  ["Ruffed and spruce grouse", "", "6 a day, 12 in possession", "Oct 1 - Dec 31", null],
  ["Varying hare", "", "10 a day, 20 in possession", "Oct 1, 2026 - Feb 27, 2027", null],
  ["Ring-necked pheasant", "", "2 males a day", "Oct 26 - Nov 8", null],
  ["Coyote", "", "no limit", "Sept 1 - Sept 19, Oct 1, 2026 - Feb 27, 2027", null],
  ["Wild turkey", "Licence", "1 bearded turkey", "May 3, 2027 - May 22, 2027", null],
] };
const NS_ANTLERLESS = [103, 104, 106, 108, 110, 111, 112];
const NS_SEASONS = { year: "2026", src: "Nova Scotia Hunting and Furharvesting Summary of Regulations 2026", url: "https://novascotia.ca/natr/hunt/pdf/hunting-and-furharvesting-summary-of-regulations.pdf", rows: [
  ["White-tailed deer", "Archery and muzzleloader", "bow only Sept 14 - 26", "Sept 14 - Dec 12", null],
  ["White-tailed deer", "Youth (12-17)", "", "Oct 16 - Oct 24", null],
  ["White-tailed deer", "General", "either sex: no antlerless stamp needed in this zone", "Oct 30 - Dec 12", range(101, 112).filter((z) => !NS_ANTLERLESS.includes(z))],
  ["White-tailed deer", "General", "antlered only, unless you drew an antlerless stamp for this zone", "Oct 30 - Dec 12", NS_ANTLERLESS],
  ["Moose", "", "Cape Breton's moose hunt is suspended in 2026", "Closed", [111, 112]],
  ["Black bear", "Hunting", "", "Sept 14 - Dec 5", null],
  ["Black bear", "Snaring", "residents with a bear snaring stamp", "Oct 1 - Dec 5", null],
  ["Ruffed grouse", "", "5 a day", "Oct 1 - Dec 31", null],
  ["Snowshoe hare", "", "no dogs Nov 1 - 15", "Nov 1, 2026 - Feb 27, 2027", null],
  ["Ring-necked pheasant", "", "males, 2 a day: from Nov 1 in Annapolis, Kings and Hants", "Oct 1 - Dec 15", null],
] };
// Yukon: the 2026-27 Hunting Regulations Summary's "Season dates and bag limits" pages, one table per game management
// zone, by subzone. Rows are [species, how, note, dates, subzones]: subzones like "4-01 4-02 4-04..50" (a range within a
// zone), "5" for the whole zone, "*" for all of the Yukon; "~5-44" is part of a subzone only (shown with a †), "!6" leaves
// out a zone or subzone. Bag limits are for the whole territory, not per zone.
const YT_MAX = { 1: 72, 2: 93, 3: 20, 4: 52, 5: 51, 6: 13, 7: 36, 8: 27, 9: 11, 10: 32, 11: 46 };   // highest subzone of each zone
const YT_LOTTERY = "Permit by lottery (PHA)", YT_PERMIT = "Permit needed", YT_BLACK = "2 a year in total, spring and fall", YT_GRIZ = "1 every 3 years in total";
// Bears, wolverine, wolf and coyote: the same in most zones (open is where they're open, shut where they're closed).
const ytCommon = (open, shut) => [
  ["Black bear", "Spring", YT_BLACK, "Apr 15 - June 21", open], ["Black bear", "Fall", YT_BLACK, "Aug 1 - Nov 15", open],
  ["Grizzly bear", "Spring", YT_GRIZ, "Apr 15 - June 21", open], ["Grizzly bear", "Fall", YT_GRIZ, "Aug 1 - Nov 15", open],
  ["Wolverine", "", "1", "Aug 1 - Oct 31", open], ["Wolf", "", "7", "Aug 1 - Mar 31", open], ["Coyote", "", "no limit", "Aug 1 - Mar 31", open],
  ...(shut ? ["Black bear", "Grizzly bear", "Wolverine", "Wolf", "Coyote"].map((sp) => [sp, "", "", "Closed", shut]) : []),
];
const YT_1 = "1-04 1-05 1-12..15 1-17..19 1-21..72", YT_1G = "1-15 1-17..19 1-21..38 1-40..52 1-55..72", YT_1W = "1-15 1-17..19 1-21..72";
const YT_4 = "4-01 4-02 4-04..50 4-52";
const YT_SEASONS = { year: "2026-27", src: "Yukon Hunting Regulations Summary 2026-27", url: "https://yukon.ca/hunting-regulations", rows: [
  // Small game and game birds: everywhere but Zone 6 (Kluane Game Sanctuary) and 4-03 (Ddhaw Ghro).
  ["Snowshoe hare, ground squirrel, porcupine", "", "no limit", "Apr 1 - Mar 31", "* !6 !4-03"],
  ["Spruce and ruffed grouse", "", "10 a day, 30 in possession", "Sept 1 - Nov 30", "* !6 !4-03"],
  ["Dusky (blue) grouse", "", "5 a day, 15 in possession", "Sept 1 - Nov 30", "* !6 !4-03"],
  ["Sharp-tailed grouse", "", "5 a day, 15 in possession", "Sept 1 - Nov 30", "* !5 !6 !4-03"],
  ["Sharp-tailed grouse", "", "2 a day, 6 in possession", "Sept 1 - Nov 30", "5"],
  ["Ptarmigan", "", "10 a day, 30 in possession", "Sept 1 - Mar 15", "* !6 !4-03"],
  // Zone 1 (North Slope and the Dempster corridor)
  ["Moose", "", "males, 1", "Aug 1 - Oct 31", YT_1], ["Moose", "", "", "Closed", "1-01"],
  ["Caribou", "", "males, 2 (area limits apply)", "Aug 1 - Jan 31", YT_1], ["Caribou", "", "", "Closed", "1-01"],
  ["Wood bison", "", "", "Closed", "1"], ["Muskox", "", "", "Closed", "1"],
  ["Sheep", YT_LOTTERY, "males, 1", "Aug 1 - Sept 15", "~1-25 1-28"], ["Sheep", "", "", "Closed", "1-01 1-04 1-05 1-12..15 1-17..19 1-21..24 1-26 1-27 1-29..72"],
  ["Deer", YT_LOTTERY, "males, 1", "Aug 1 - Nov 30", "1-15 1-17..19 1-21..72"], ["Deer", "", "", "Closed", "1-01..14"],
  ["Elk", YT_PERMIT, "1", "Apr 1 - Mar 31", "1 !1-01"],
  ["Black bear", "Spring", YT_BLACK, "Apr 15 - June 21", YT_1], ["Black bear", "Fall", YT_BLACK, "Aug 1 - Nov 15", YT_1], ["Black bear", "", "", "Closed", "1-01"],
  ["Grizzly bear", "Spring", YT_GRIZ, "Apr 15 - June 21", YT_1G], ["Grizzly bear", "Fall", YT_GRIZ, "Aug 1 - Nov 15", YT_1G], ["Grizzly bear", "", "", "Closed", "1-01 1-04 1-05 1-12..14 1-39 1-53 1-54"],
  ["Wolverine", "", "1", "Aug 1 - Oct 31", YT_1W], ["Wolf", "", "7", "Aug 1 - Mar 31", YT_1W], ["Coyote", "", "no limit", "Aug 1 - Mar 31", YT_1W],
  ...["Wolverine", "Wolf", "Coyote"].map((sp) => [sp, "", "", "Closed", "1-01 1-04 1-05 1-12..14"]),
  // Zone 2 (Dawson, Mayo, the Dempster)
  ["Moose", "", "males, 1", "Aug 1 - Oct 31", "2-01..55 2-57 2-60 2-61 2-64..93"],
  ["Moose", "Mayo threshold hunt", "males, 1: closes early once enough are taken", "Sept 1 - Oct 31", "2-56 2-58 2-59 2-62 2-63"],
  ["Caribou", "Woodland caribou", "males, 1", "Aug 1 - Oct 31", "2-45 2-52..59 2-62..65 2-70..93"],
  ["Caribou", "Hart River herd", "males, 1", "Aug 1 - Oct 31", "2-16 2-23 2-25 2-27..29 2-39..41 2-46..51 2-60 2-61"],
  ["Caribou", "Porcupine herd", "males, 2", "Aug 1 - Jan 31", "2-01..15 2-17 2-18 2-22 2-26 2-30..38 2-42..44 2-66..69"],
  ["Caribou", "Porcupine herd", "only if the herd is in the area", "Nov 1 - Jan 31", "2-16 2-23 2-27 2-28 2-39"],
  ["Caribou", "Fortymile herd (threshold hunt)", "males, 1: closes early once enough are taken", "Dec 1 - Mar 31", "2-19..21 2-24"],
  ["Wood bison", "", "", "Closed", "2"], ["Sheep", "", "males, 1", "Aug 1 - Oct 31", "2"],
  ["Deer", YT_LOTTERY, "males, 1", "Aug 1 - Nov 30", "2"], ["Elk", YT_PERMIT, "1", "Apr 1 - Mar 31", "2"],
  ...ytCommon("2", null).filter((r) => r[0] !== "Grizzly bear"),
  ["Grizzly bear", "Spring", YT_GRIZ, "Apr 15 - June 21", "2 !2-26 !2-27 !2-28"], ["Grizzly bear", "Fall", YT_GRIZ, "Aug 1 - Nov 15", "2 !2-26 !2-27 !2-28"], ["Grizzly bear", "", "", "Closed", "2-26..28"],
  // Zone 3 (west of Dawson, the Fortymile)
  ["Moose", "", "males, 1", "Aug 1 - Oct 31", "3"],
  ["Caribou", "Fortymile herd, summer (permit)", "males, 1: closes early once enough are taken", "Aug 1 - Sept 9", "3-01 3-04 ~3-02"],
  ["Caribou", "Fortymile herd, winter", "males, 1: closes early once enough are taken", "Dec 1 - Mar 31", "3-01..04 3-06 ~3-07 ~3-10 ~3-12"],
  ["Caribou", "", "", "Closed", "3-05 3-08 3-09 3-11 3-13..20"],
  ["Wood bison", YT_PERMIT, "1", "Sept 1 - Mar 24", "3"], ["Sheep", "", "", "Closed", "3"],
  ["Deer", YT_LOTTERY, "males, 1", "Aug 1 - Nov 30", "3"], ["Elk", YT_PERMIT, "1", "Apr 1 - Mar 31", "3"],
  ...ytCommon("3", null),
  // Zone 4 (Mayo, Faro, Pelly; Ddhaw Ghro 4-03 and 4-51 are closed to big game)
  ["Moose", "", "males, 1", "Aug 1 - Oct 31", "4-01 4-02 4-07..43 4-47..50 4-52"],
  ["Moose", "Mayo threshold hunt", "males, 1: closes early once enough are taken", "Sept 1 - Oct 31", "4-04..06"],
  ["Moose", "Faro threshold hunt", "males, 1: closes early once enough are taken", "Aug 1 - Oct 31", "4-44..46"],
  ["Caribou", "", "males, 1 (please leave the Ethel Lake herd, 4-01 to 4-04, 4-09, 4-10)", "Aug 1 - Oct 31", YT_4],
  ["Wood bison", YT_PERMIT, "1", "Sept 1 - Mar 24", YT_4],
  ["Sheep", "", "males, 1", "Aug 1 - Oct 31", "4-01 4-02 4-04..45 4-48..50"], ["Sheep", "", "", "Closed", "4-46 4-47 4-52"],
  ["Goat", "", "", "Closed", "4"], ["Deer", YT_LOTTERY, "males, 1", "Aug 1 - Nov 30", YT_4], ["Elk", YT_PERMIT, "1", "Apr 1 - Mar 31", YT_4],
  ...ytCommon(YT_4, null),
  ["All hunting", "", "Ddhaw Ghro Habitat Protection Area: closed to all hunting", "Closed", "4-03"], ["All big game", "", "closed to all big game hunting", "Closed", "4-51"],
  // Zone 5 (Whitehorse north and west, Haines Junction, Kluane east)
  ["Moose", "", "males, 1", "Aug 1 - Oct 31", "5-01..21 5-25 5-27 5-29 5-43 5-44 5-51"],
  ["Moose", YT_LOTTERY, "males, 1", "Aug 1 - Oct 31", "5-28 5-30..42 5-45..50"], ["Moose", "", "", "Closed", "5-22..24 5-26"],
  ["Caribou", "Nelchina herd", "males, 1: until closed by public notice", "Dec 1 - Mar 31", "5-04 5-05 ~5-06"],
  ["Caribou", YT_LOTTERY, "males, 1", "Aug 1 - Oct 31", "5-11 5-13 5-22..27 5-29..48"],
  ["Caribou", "", "", "Closed", "5-01..03 ~5-06 5-07..10 5-12 5-14..21 5-28 5-49..51"],
  ["Wood bison", YT_PERMIT, "1", "Sept 1 - Mar 24", "5-01 5-04..07"],
  ["Wood bison", "Fall corridors (permit)", "along the Alaska Hwy (Whitehorse to Slims River) and North Klondike Hwy (Whitehorse to Braeburn)", "Sept 1 - Oct 31", "~5-02 ~5-03 ~5-08..51"],
  ["Wood bison", YT_PERMIT, "1", "Nov 1 - Mar 24", "5-02 5-03 5-08..51"],
  ["Sheep", "", "males, 1", "Aug 1 - Oct 31", "5-01..16 5-18..49 5-51"], ["Sheep", YT_LOTTERY, "males, 1", "Aug 1 - Oct 31", "5-50"],
  ["Sheep", "", "Donjek sheep closure until Oct 31, 2026", "Closed", "5-17"], ["Sheep", "", "between Slims River Bridge and Congdon Creek", "Closed", "~5-21"],
  ["Goat", "", "", "Closed", "5"], ["Deer", YT_LOTTERY, "males, 1", "Aug 1 - Nov 30", "5"],
  ["Elk", YT_PERMIT, "1", "Apr 1 - Mar 31", "5-01..43 ~5-44 ~5-45 5-46 5-51"], ["Elk", YT_LOTTERY, "1: dates on the permit", "See permit", "~5-44 ~5-45 5-47 5-48 5-50"],
  ...ytCommon("5", null),
  // Zone 6: Kluane Game Sanctuary, closed to licensed hunters.
  ["All hunting", "", "Kluane Game Sanctuary: closed to licensed hunters", "Closed", "6"],
  // Zone 7 (Whitehorse south, Carcross, the Southern Lakes)
  ["Moose", YT_LOTTERY, "males, 1", "Aug 1 - Oct 31", "7"], ["Caribou", "", "", "Closed", "7"], ["Wood bison", YT_PERMIT, "1", "Sept 1 - Mar 24", "7"],
  ["Sheep", "", "males, 1", "Aug 1 - Oct 31", "7-01..12 7-28 7-29 7-33"], ["Sheep", YT_LOTTERY, "males, 1", "Aug 1 - Oct 31", "7-13 7-14 7-16 7-17 7-20..27 7-30..32"],
  ["Sheep", "", "", "Closed", "7-15 7-18 7-19 7-34..36"],
  ["Goat", YT_LOTTERY, "1", "Aug 1 - Oct 31", "7-34 7-35"], ["Goat", "", "", "Closed", "7-01..33 7-36"],
  ["Deer", YT_LOTTERY, "males, 1", "Aug 1 - Nov 30", "7"],
  ["Elk", YT_PERMIT, "1", "Apr 1 - Mar 31", "7-01 ~7-02 ~7-03 ~7-04 7-06..12 7-16 7-17 7-19..36"], ["Elk", YT_LOTTERY, "1: dates on the permit", "See permit", "~7-04 ~7-05 ~7-13 ~7-14 ~7-15 ~7-18"],
  ...ytCommon("7", null),
  // Zone 8 (Teslin River, Big Salmon Range, Johnsons Crossing)
  ["Moose", "", "males, 1", "Aug 1 - Oct 31", "8-01..18 8-21 8-23..27"], ["Moose", YT_LOTTERY, "males, 1", "Aug 1 - Oct 31", "8-19 8-20 8-22"],
  ["Caribou", "", "males, 1", "Aug 1 - Oct 31", "8-01..11 8-18..25"], ["Caribou", "", "", "Closed", "8-12..17 8-26 8-27"],
  ["Wood bison", YT_PERMIT, "1", "Sept 1 - Mar 24", "8"], ["Sheep", "", "males, 1", "Aug 1 - Oct 31", "8"], ["Goat", "", "", "Closed", "8"],
  ["Deer", YT_LOTTERY, "males, 1", "Aug 1 - Nov 30", "8"],
  ["Elk", YT_PERMIT, "1", "Apr 1 - Mar 31", "~8-01 8-02 8-03 ~8-04 8-05..27"], ["Elk", YT_LOTTERY, "1: dates on the permit", "See permit", "~8-01 ~8-04"],
  ...ytCommon("8", null),
  // Zone 9 (Mount Lorne, Carcross west, Annie Lake)
  ["Moose", YT_LOTTERY, "males, 1", "Aug 1 - Oct 31", "9-01..07"], ["Moose", "", "males, 1", "Aug 1 - Oct 31", "9-08..11"],
  ["Caribou", "", "", "Closed", "9"], ["Wood bison", YT_PERMIT, "1", "Sept 1 - Mar 24", "9"],
  ["Sheep", "Bow only, permit by lottery (PHA)", "males, 1", "Aug 1 - Oct 31", "9-03"], ["Sheep", "", "", "Closed", "9 !9-03"],
  ["Goat", "", "", "Closed", "9"], ["Deer", YT_LOTTERY, "males, 1", "Aug 1 - Nov 30", "9"], ["Elk", YT_PERMIT, "1", "Apr 1 - Mar 31", "9"],
  ...ytCommon("9", null),
  // Zone 10 (Teslin, Nisutlin)
  ["Moose", "", "males, 1", "Aug 1 - Oct 31", "10-04..32"], ["Moose", YT_LOTTERY, "males, 1", "Aug 1 - Oct 31", "10-01..03"],
  ["Caribou", "", "males, 1", "Aug 1 - Oct 31", "10-01..04 10-10..16 10-20..32"], ["Caribou", "", "lottery only, no permits this year", "Closed", "10-05..09 10-17..19"],
  ["Wood bison", "", "", "Closed", "10"], ["Sheep", "", "males, 1", "Aug 1 - Oct 31", "10 !10-22 !10-28"], ["Sheep", "", "", "Closed", "10-22 10-28"],
  ["Goat", "", "", "Closed", "10"], ["Deer", YT_LOTTERY, "males, 1", "Aug 1 - Nov 30", "10"], ["Elk", "", "", "Closed", "10"],
  ...ytCommon("10", null),
  // Zone 11 (Watson Lake, the Liard)
  ["Moose", "", "males, 1", "Aug 1 - Oct 31", "11"],
  ["Caribou", "", "males, 1", "Aug 1 - Oct 31", "11-01 11-19 11-24..46"], ["Caribou", "", "lottery only, no permits this year", "Closed", "11-02..18 11-20..23"],
  ["Wood bison", "", "", "Closed", "11"], ["Sheep", "", "males, 1", "Aug 1 - Oct 31", "11"],
  ["Goat", "", "1", "Aug 1 - Oct 31", "11-04..24 11-26..46"], ["Goat", "", "", "Closed", "11-01..03 11-25"],
  ["Deer", YT_LOTTERY, "males, 1", "Aug 1 - Nov 30", "11"], ["Elk", "", "", "Closed", "11"],
  ...ytCommon("11", null),
] };
// "4-01 4-04..50 ~5-44 !6": the subzone ids ("4-01") a row is for, and which of them only in part.
function ytZones(spec) {
  const id = (z, n) => `${z}-${String(n).padStart(2, "0")}`, all = new Map(), out = [];
  const each = (t, f) => {
    if (t === "*") { for (const z of Object.keys(YT_MAX)) for (let n = 1; n <= YT_MAX[z]; n++) f(id(z, n)); return; }
    const m = t.match(/^(\d+)(?:-(\d+)(?:\.\.(?:\d+-)?(\d+))?)?$/);
    if (!m || !YT_MAX[m[1]]) throw new Error(`Yukon season subzones: can't read "${t}"`);
    const [a, b] = m[2] ? [+m[2], m[3] ? +m[3] : +m[2]] : [1, YT_MAX[m[1]]];
    for (let n = a; n <= b; n++) f(id(m[1], n));
  };
  for (const t of spec.split(/\s+/).filter(Boolean)) {
    if (t[0] === "!") each(t.slice(1), (k) => all.delete(k));
    else each(t.replace(/^~/, ""), (k) => all.set(k, t[0] === "~" ? 1 : all.get(k) || 0));
  }
  for (const [k, part] of all) out.push([k, part]);
  return out;
}
// Most subzones share most rows, so the file lists each row once (rows) and each subzone its row numbers (wmu), a
// negative number for a row that applies to part of the subzone only. hunting.js turns them back into rows.
function ytSeasons(log) {
  const wmu = {}, rows = [], at = new Map();
  for (const r of YT_SEASONS.rows) {
    const key = JSON.stringify(r.slice(0, 4));
    if (!at.has(key)) at.set(key, rows.push(r.slice(0, 4)) - 1);
    const i = at.get(key);
    for (const [k, part] of ytZones(r[4])) (wmu[k] = wmu[k] || []).push(part ? -i - 1 : i);
  }
  log(`  Yukon seasons: ${Object.keys(wmu).length} subzones`);
  return { src: YT_SEASONS.src, url: YT_SEASONS.url, year: YT_SEASONS.year, rows, wmu };
}
function range(a, b) { return Array.from({ length: b - a + 1 }, (_, i) => a + i); }
function handSeasons(h, last, first = 1) {
  const wmu = {};
  for (let id = first; id <= last; id++) wmu[id] = h.rows.filter((r) => !r[4] || r[4].includes(id)).map((r) => [r[0], r[1], r[2], r[3], 0]);
  return { src: h.src, url: h.url, year: h.year, wmu };
}

// ---------- season tables on quebec.ca and ontario.ca ----------
const unhtml = (s) => String(s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&rsquo;|&#8217;/g, "’")
  .replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&eacute;/g, "é").replace(/&egrave;/g, "è")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/\s+/g, " ").trim();
// Every table on a page, with the headings above it (nearest last) and its rows as plain text cells.
export function tables(html) {
  const out = [];
  for (const m of html.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const heads = [...html.slice(0, m.index).matchAll(/<(h[2-5])[^>]*>([\s\S]*?)<\/\1>/g)].map((x) => unhtml(x[2])).filter((t) => t && !/^notes?\s*:?$/i.test(t));
    const rows = [...m[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => unhtml(c[1])));
    out.push({ heads, rows });
  }
  return out;
}
const EN_MON = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
const FR_MON = { janvier: 0, février: 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, août: 7, aout: 7, septembre: 8, octobre: 9, novembre: 10, décembre: 11, decembre: 11 };
// "Du 3 octobre au 16 octobre 2026", "Du 26 septembre 2026 au 4 octobre 2026", "Du 1er au 31 août 2026",
// "Du 20 septembre 2026 au 31 mars 2027": "Oct 3, 2026 - Oct 16, 2026" (the format hunting.js reads).
export function frDates(t) {
  const s = String(t).replace(/(\d)\s*er\b/g, "$1");
  const out = [];
  for (const m of s.matchAll(/[Dd]u\s+(\d{1,2})(?:\s+([a-zéèûô]+))?(?:\s+(\d{4}))?\s+au\s+(\d{1,2})\s+([a-zéèûô]+)(?:\s+(\d{4}))?/g)) {
    const m2 = FR_MON[m[5]], m1 = m[2] && FR_MON[m[2]] != null ? FR_MON[m[2]] : m2;
    if (m2 == null) continue;
    const y2 = m[6] ? +m[6] : null, y1 = m[3] ? +m[3] : y2 != null ? (m1 > m2 ? y2 - 1 : y2) : null;
    out.push(`${EN_MON[m1]} ${+m[1]}${y1 ? `, ${y1}` : ""} - ${EN_MON[m2]} ${+m[4]}${y2 ? `, ${y2}` : ""}`);
  }
  return out.join(", ");
}
// "September 19 to December 15", "October 3 to 9", "September 15, 2026 to March 31, 2027" -> "Sept 19 - Dec 15".
export function enDates(t) {
  const M = "(January|February|March|April|May|June|July|August|September|October|November|December)";
  const out = [];
  for (const m of String(t).matchAll(new RegExp(`${M}\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?\\s+to\\s+(?:${M}\\s+)?(\\d{1,2})(?:,?\\s*(\\d{4}))?`, "g"))) {
    const i = (n) => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(n);
    const a = i(m[1]), b = m[4] ? i(m[4]) : a;
    out.push(`${EN_MON[a]} ${+m[2]}${m[3] ? `, ${m[3]}` : ""} - ${EN_MON[b]} ${+m[5]}${m[6] ? `, ${m[6]}` : ""}`);
  }
  return out.join(", ");
}
// Weapons in Quebec's headings ("Périodes de chasse à l’arbalète et à l’arc").
const qcWeapon = (h) => {
  const t = h.toLowerCase();
  if (/relève/.test(t)) return "Youth and new hunters";
  if (/armes à feu/.test(t)) return "Firearms, crossbow and bow";
  if (/fusil/.test(t)) return "Shotgun, muzzleloader, crossbow and bow";
  if (/chargement par la bouche/.test(t)) return "Muzzleloader, crossbow and bow";
  if (/arbalète/.test(t)) return "Crossbow and bow";
  if (/à l’arc|à l'arc/.test(t)) return "Bow only";
  if (/piège|collet/.test(t)) return "Snares and traps";
  return "";
};
const QC_WORDS = [[/avec ou sans barbe/i, "Bearded or beardless"], [/porteur d.une barbe|barbu/i, "Bearded"], [/orignal avec bois/i, "Antlered moose"], [/orignal sans bois/i, "Antlerless moose"], [/^orignal$/i, "Any moose"], [/veau/i, "Calf"],
  [/cerf de virginie avec ou sans bois/i, "Antlered or antlerless deer"], [/cerf de virginie avec bois/i, "Antlered deer"], [/cerf de virginie sans bois/i, "Antlerless deer"],
  [/femelle ou mâle avec bois de moins de 7 cm/i, "Antlerless deer (or antlers under 7 cm)"], [/norme RTLB/i, "Antler restriction (RTLB)"], [/mâle/i, "Male"], [/barbu/i, "Bearded"]];
// Small game tables put the weapons in the second column: "Armes à feu et à air comprimé, arbalète et arc L’utilisation
// de l’arbalète est interdite dans la zone 17." (the sentence after it is a footnote: flagged, left to the link).
const QC_GEAR = [[/^armes à feu et à air comprimé, arbalète et arc/i, "Firearms, air guns, crossbow and bow"], [/^armes à feu, arbalète et arc/i, "Firearms, crossbow and bow"],
  [/^collet/i, "Snares"], [/^carabine \.22.*nuit.*chiens/i, ".22 rimfire at night, with dogs"], [/^arc et arbalète|^arbalète et arc/i, "Crossbow and bow"], [/^arc\b/i, "Bow only"]];
export const qcGear = (t) => { const hit = QC_GEAR.find(([re]) => re.test(String(t).trim())); return hit ? { g: hit[1], more: String(t).trim().replace(hit[0], "").trim().length > 2 } : null; };
const qcClass = (s) => {
  const t = String(s).replace(/^20\d\d\s+/, "").replace(/\s+/g, " ").trim(), hit = QC_WORDS.find(([re]) => re.test(t));
  return hit ? hit[1] + (/7 cm ou plus/.test(t) && !/7 cm/.test(hit[1]) ? " (7 cm or more)" : "") : t;
};
const QC_SPECIES = { orignal: "Moose", "cerf-virginie": "White-tailed deer", "ours-noir": "Black bear", "dindon-sauvage": "Wild turkey" };
const QC_SMALL_EN = [[/gélinotte huppée/i, "Ruffed grouse"], [/tétras du canada/i, "Spruce grouse"], [/tétras à queue fine/i, "Sharp-tailed grouse"], [/lagopède/i, "Ptarmigan"],
  [/perdrix grise/i, "Gray partridge"], [/lièvre/i, "Snowshoe hare"], [/lapin/i, "Cottontail rabbit"], [/coyote/i, "Coyote"], [/loup/i, "Wolf"], [/renard/i, "Red fox"],
  [/marmotte/i, "Woodchuck"], [/raton/i, "Raccoon"], [/écureuil/i, "Squirrel"], [/corneille/i, "Crow"], [/étourneau/i, "Starling"], [/vacher/i, "Cowbird"], [/carouge/i, "Red-winged blackbird"],
  [/caribou/i, "Caribou"], [/bœuf musqué|boeuf musqué/i, "Muskox"], [/dindon/i, "Wild turkey"]];
// Quebec zone list in a table cell: "1, 2, 10 ouest, 11 ouest, 15", "8 est, 8 nord (excluant le territoire de la
// montagne de Rigaud)", "Ensemble des îles et îlots ... compris dans les zones 2 est, 2 ouest", "13 sud-ouest et 15 ouest".
// Keys: "8" (all of zone 8), "8 nord", "2 est île" (islands only), "8 nord rigaud". note: a "sauf"/"excluant" part.
export function qcZones(cell) {
  const t = String(cell);
  const islands = /^ensemble des îles/i.test(t), rigaud = /^territoire de la montagne de rigaud/i.test(t);
  const note = /sauf|excluant|partie/i.test(t);
  const body = t.replace(/\((?:[^()]|\([^)]*\))*\)/g, " ").replace(/^.*?compris dans (?:les zones|la zone|cette zone)/i, "").replace(/^territoire de la montagne de rigaud dans la zone/i, "");
  const keys = [];
  for (const m of body.matchAll(/\b(\d{1,2})(?:\s+(sud-ouest|sud-est|sud-nord-ouest|nord|sud|est|ouest))?\b/gi)) {
    if (+m[1] < 1 || +m[1] > 29) continue;
    const k = `${+m[1]}${m[2] ? ` ${m[2].toLowerCase()}` : ""}`;
    // "Territoire de la montagne de Rigaud dans la zone 8 nord, 15 est, 18...": only the first is the Rigaud part
    keys.push(islands ? `${k} île` : rigaud && !keys.length ? `${k} rigaud` : k);
  }
  return { keys: [...new Set(keys)], note };
}
async function qcSeasons(curlText) {
  const B = "https://www.quebec.ca/tourisme-loisirs-sport/activites-sportives-et-de-plein-air/chasse-sportive/periodes-limites/";
  const zone = {}, zec = {};
  const add = (map, k, row) => (map[k] = map[k] || []).push(row);
  for (const slug of ["orignal", "cerf-virginie", "ours-noir", "dindon-sauvage", "petit-gibier"]) {
    const html = curlText(B + slug, `qc-${slug}.html`);
    let n = 0;
    for (const { heads, rows } of tables(html)) {
      const hd = rows[0] || [];
      if (!/zone|zec/i.test(hd[0] || "")) continue;
      const isZec = /^zec/i.test(hd[0]);
      const last = heads[heads.length - 1] || "", weapon = qcWeapon(last) || qcWeapon(heads[heads.length - 2] || "");
      // which columns: the class/segment (if any) and this year's period (the first column with "Période ... 20xx", or the last)
      const yi = hd.findIndex((c) => /période/i.test(c) && /20\d\d/.test(c)), ci = hd.findIndex((c, i) => i > 0 && i !== yi && !/période/i.test(c));
      let sp = QC_SPECIES[slug];
      if (!sp) { const h = [...heads].reverse().find((x) => QC_SMALL_EN.some(([re]) => re.test(x))) || ""; sp = (QC_SMALL_EN.find(([re]) => re.test(h)) || [, h || "Small game"])[1]; }
      for (const r of rows.slice(1)) {
        if (r.length < 2) continue;
        const dates = frDates(r[yi >= 0 ? yi : r.length - 1] || r[r.length - 1]);
        if (!dates) continue;
        const gear = ci > 0 && r[ci] ? qcGear(r[ci]) : null, cls = gear ? "" : ci > 0 && r[ci] ? qcClass(r[ci]) : "", w = gear ? gear.g : weapon;
        if (isZec) { add(zec, r[0].trim(), [sp, w, cls, dates, 0]); n++; continue; }
        const { keys, note } = qcZones(r[0]);
        for (const k of keys) add(zone, k, [sp, w, cls, dates, note || (gear && gear.more) ? 1 : 0]);
        if (keys.length) n++;
      }
    }
    // small game pages also have tables by species without a zone column ("Partout au Québec"): left to the link
    if (!n) throw new Error(`${slug}: no rows read`);
  }
  if (Object.keys(zone).length < 20) throw new Error(`only ${Object.keys(zone).length} zones read`);
  return { src: "Québec.ca: Périodes et limites de chasse", url: B, zone, zec };
}
async function onSeasons(curlText) {
  const B = "https://www.ontario.ca/document/ontario-hunting-regulations-summary/";
  const SP = { "white-tailed-deer": "White-tailed deer", moose: "Moose", "black-bear": "Black bear", elk: "Elk", "wild-turkey": "Wild turkey", "wolf-and-coyote": "Wolf and coyote", "small-game-and-furbearing-mammals": "" };
  const wmu = {};
  for (const [slug, name] of Object.entries(SP)) {
    const html = curlText(B + slug, `on-${slug}.html`);
    let n = 0;
    for (const { heads, rows } of tables(html)) {
      const hd = rows[0] || [];
      const wi = hd.findIndex((c) => /wildlife management unit/i.test(c));
      if (wi < 0) continue;
      const di = hd.findIndex((c) => /resident/i.test(c) && !/non-resident/i.test(c)) >= 0 ? hd.findIndex((c) => /resident/i.test(c) && !/non-resident/i.test(c)) : hd.findIndex((c, i) => i !== wi && /season/i.test(c));
      if (di < 0) continue;
      const last = heads[heads.length - 1] || "";
      if (/draw results|validation/i.test(last)) continue;
      const sp = name || last.replace(/\s+(seasons?|open seasons?)$/i, "") || "Small game";
      const qual = name ? (/season map|seasons$/i.test(last) ? "" : last) : "";
      const ci = hd.findIndex((c, i) => i !== wi && i !== di && !/non-resident|season/i.test(c));
      for (const r of rows.slice(1)) {
        const dates = enDates(r[di] || "");
        if (!dates) continue;
        const note = /except|portion|part of|north of|south of|east of|west of/i.test(r[wi]);
        const units = [...String(r[wi]).matchAll(/\b(\d{1,2}[A-E]?(?:-\d)?)\b/g)].map((m) => m[1]);
        const cls = ci >= 0 ? r[ci] || "" : "";
        for (const u of new Set(units)) (wmu[u] = wmu[u] || []).push([sp, qual.replace(/^(rifles|muzzle|bows)/i, (m) => m[0].toUpperCase() + m.slice(1)), cls, dates, note ? 1 : 0]);
        if (units.length) n++;
      }
    }
    if (!n) throw new Error(`${slug}: no rows read`);
  }
  if (Object.keys(wmu).length < 60) throw new Error(`only ${Object.keys(wmu).length} WMUs read`);
  return { src: "Ontario Hunting Regulations Summary (resident seasons)", url: B, wmu };
}
