// Crown land (public land) across Canada, for Hunting (hunting.js "Private and public land"), Adventure moto (moto.js)
// and Fishing (fishing.js). alex approved it from the competitor review (2026-10-27): onX shows public land everywhere,
// the app had BC private parcels and Alberta's Green Area only.
// Each province's own open map server, asked live (nothing stored on the site), as map pictures and as a tap answer:
//  - Ontario: Land Information Ontario, Crown unpatented land, private patents and Crown leases (Open Government
//    Licence - Ontario).
//  - Quebec: the public land use plan (PATP, MERN), which covers exactly the terres du domaine de l'État.
//  - New Brunswick: DNR Crown lands (Open Government Licence - New Brunswick).
//  - Nova Scotia: Natural Resources Crown lands (Open Government Licence - Nova Scotia).
//  - Saskatchewan: provincial forests, Fish and Wildlife Development Fund land and leased agricultural Crown land
//    (Open Government Licence - Saskatchewan).
//  - Manitoba: provincial forests (Manitoba Open Data Licence); the rest of Manitoba's Crown land isn't open data.
//  - Newfoundland and Labrador: Crown titles (land the Crown granted away, so private), from the Land Use Atlas.
//  - British Columbia: private parcels from ParcelMap BC (DataBC); about 94% of BC is Crown land, mostly not parcelled,
//    so only private land is shaded (Hunting draws BC's parcels itself, hunting.js PICS).
//  - Alberta: the Green Area (public forest land, Alberta Environment and Protected Areas); the White Area is mostly
//    private farmland (Hunting draws the Green Area as a line from its own data).
// No open data for PEI (about 90% private) or the territories: the tap answer says what's usual there.
(() => {
  "use strict";
  if (!window.L || window.tfCrown) return;
  const COL = { crown: "#2f9e44", private: "#fab005", lease: "#94a83a" };
  const LIO = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open08/MapServer";
  const PATP = "https://servicescarto.mern.gouv.qc.ca/pes/rest/services/Territoire/PATP_prov_WMS/MapServer";
  const NB = "https://gis-erd-der.gnb.ca/server/rest/services/OpenData/Crown_Lands/MapServer";
  const NS = "https://nsgiwa.novascotia.ca/arcgis/rest/services/PLAN/PLANCrownLandsWM84V1/MapServer";
  const SK = "https://gis.saskatchewan.ca/arcgis/rest/services";
  const MB_PF = "https://services.arcgis.com/mMUesHYPkXjaFGfS/arcgis/rest/services/Manitoba_Provincial_Forests___Version_6/FeatureServer/1";
  const NL = "https://www.gov.nl.ca/landuseatlasmaps/rest/services/LandUseDetails/MapServer";
  const ABG = "https://geospatial.alberta.ca/mimas/rest/services/boundaries/land_green_white_area_public/MapServer";
  const BCW = "https://openmaps.gov.bc.ca/geo/pub", PMBC = "pub:WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW";
  // [s, w, n, e], rough (neighbours overlap; each server only has its own province)
  const BOX = { bc: [48.2, -139.1, 60.01, -114.0], ab: [48.99, -120.01, 60.01, -109.99], on: [41.6, -95.2, 56.9, -74.3], qc: [44.9, -79.8, 62.7, -57.1], nb: [44.5, -69.1, 48.1, -63.7], ns: [43.3, -66.5, 47.1, -59.6],
    sk: [48.9, -110.1, 60.1, -101.3], mb: [48.9, -102.1, 60.1, -88.9], nl: [46.6, -67.9, 60.5, -52.5], pe: [45.9, -64.5, 47.1, -61.9] };
  // Map pictures. kind: the colour. layer: the server's layer id; where: only some of its shapes; tint: a server
  // that can't take our colours (Quebec), so every painted pixel is repainted ours on the phone.
  const SRC = [
    { id: "on", pv: "on", kind: "crown", svc: LIO, layer: 34, min: 9, attr: 'Crown land: <a href="https://geohub.lio.gov.on.ca/">Land Information Ontario</a>' },
    { id: "onp", pv: "on", kind: "private", svc: LIO, layer: 35, where: "TITLE_HOLDER_TYPE='Private'", min: 9, attr: "Private land: Land Information Ontario" },
    { id: "qc", pv: "qc", kind: "crown", svc: PATP, layer: 1, tint: true, min: 9, attr: 'Terres publiques: <a href="https://www.donneesquebec.ca/">Plan d\'affectation du territoire public (MERN)</a>' },
    { id: "nb", pv: "nb", kind: "crown", svc: NB, layer: 0, min: 9, attr: 'Crown land: <a href="https://www.snb.ca/geonb1/e/index-E.asp">GeoNB, NB Natural Resources</a>' },
    { id: "ns", pv: "ns", kind: "crown", svc: NS, layer: 0, min: 9, attr: 'Crown land: <a href="https://novascotia.ca/natr/land/">Nova Scotia Natural Resources</a>' },
    { id: "skpf", pv: "sk", kind: "crown", svc: `${SK}/Forestry/MapServer`, layer: 0, min: 7, attr: 'Crown land: <a href="https://gis.saskatchewan.ca/">Saskatchewan</a> provincial forests' },
    { id: "skfw", pv: "sk", kind: "crown", svc: `${SK}/Planning/MapServer`, layer: 7, min: 9, attr: "Fish and Wildlife Development Fund land: Saskatchewan" },
    { id: "skag", pv: "sk", kind: "lease", svc: `${SK}/Agriculture/CrownLand_AG/MapServer`, layer: 2, min: 10, attr: "Agricultural Crown land: Saskatchewan Lands Branch" },
    { id: "bc", pv: "bc", kind: "private", wms: PMBC, where: "OWNER_TYPE", is: "Private", min: 9, attr: 'Private land: <a href="https://ltsa.ca/property-owners/about-land-records/parcelmap-bc/">ParcelMap BC</a>, DataBC' },
    { id: "ab", pv: "ab", kind: "crown", svc: ABG, layer: 0, where: "GWA_CODE='GLC_G'", min: 7, attr: 'Crown land: <a href="https://www.alberta.ca/green-and-white-areas">Alberta Green Area</a>' },
    { id: "nl", pv: "nl", kind: "private", svc: NL, layer: 3, min: 13, attr: 'Crown titles: <a href="https://www.gov.nl.ca/landuseatlas/">NL Land Use Atlas</a>' },
  ];
  const R = 20037508.342789244;
  const tileBox = (z, x, y) => { const s = (2 * R) / 2 ** z; return [x * s - R, R - (y + 1) * s, (x + 1) * s - R, R - y * s].map((v) => v.toFixed(2)).join(","); };
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  // The picture's address for one 256 px tile (web mercator), solid colour (the map layer sets how see-through).
  const url = (s, z, x, y) => {
    // DataBC's map server (GeoServer): our colour in a style sent with the request
    if (s.wms) return `${BCW}/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${encodeURIComponent(s.wms)}&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=true&SRS=EPSG%3A3857&WIDTH=256&HEIGHT=256&SLD_BODY=${encodeURIComponent(
      `<StyledLayerDescriptor version="1.0.0"><NamedLayer><Name>${s.wms}</Name><UserStyle><FeatureTypeStyle><Rule><Filter><PropertyIsEqualTo><PropertyName>${s.where}</PropertyName><Literal>${s.is}</Literal></PropertyIsEqualTo></Filter><PolygonSymbolizer><Fill><CssParameter name="fill">${COL[s.kind]}</CssParameter></Fill></PolygonSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`)}&bbox=${tileBox(z, x, y)}`;
    const c = rgb(COL[s.kind]);
    const draw = s.tint ? `layers=show%3A${s.layer}` : `dynamicLayers=${encodeURIComponent(JSON.stringify([{ id: s.layer, source: { type: "mapLayer", mapLayerId: s.layer }, ...(s.where ? { definitionExpression: s.where } : {}),
      drawingInfo: { renderer: { type: "simple", symbol: { type: "esriSFS", style: "esriSFSSolid", color: [...c, 255], outline: { type: "esriSLS", style: "esriSLSSolid", color: [...c, 255], width: 0.75 } } } } }]))}`;
    return `${s.svc}/export?bboxSR=3857&imageSR=3857&size=256%2C256&format=png32&transparent=true&f=image&${draw}&bbox=${tileBox(z, x, y)}`;
  };
  // A tinted picture: the server's colours, every painted pixel ours.
  async function tint(s, z, x, y) {
    const r = await fetch(url(s, z, x, y));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const cv = document.createElement("canvas"); cv.width = cv.height = 256;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(await createImageBitmap(await r.blob()), 0, 0, 256, 256);
    const img = cx.getImageData(0, 0, 256, 256), d = img.data, c = rgb(COL[s.kind]);
    for (let i = 0; i < d.length; i += 4) if (d[i + 3]) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }
    return img;
  }
  const bounds = (s) => { const b = BOX[s.pv]; return [[b[0], b[1]], [b[2], b[3]]]; };
  const BoxTiles = L.TileLayer.extend({ getTileUrl(c) { return url(this.options.src, c.z, c.x, c.y); } });
  const TintGrid = L.GridLayer.extend({
    createTile(c, done) {
      const cv = document.createElement("canvas"); cv.width = cv.height = 256;
      tint(this.options.src, c.z, c.x, c.y).then((img) => { cv.getContext("2d").putImageData(img, 0, 0); done(null, cv); }, (e) => done(e, cv));
      return cv;
    },
  });
  // One Leaflet layer per source, for moto.js and fishing.js (hunting.js puts the sources in its own picture layers,
  // so its 3D map and offline saves get them too).
  const leaflet = (pane, opacity = 0.32) => L.layerGroup(SRC.map((s) => {
    const o = { src: s, pane, opacity: s.kind === "private" ? opacity + 0.1 : opacity, minZoom: s.min, maxZoom: 20, bounds: bounds(s), attribution: s.attr };
    return s.tint ? new TintGrid(o) : new BoxTiles("", o);
  }));

  // ---------- what land is at a point ----------
  const get = (u) => fetch(u, { signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).then((j) => (j && !j.error ? j : null)).catch(() => null);
  // the first shape's fields (null: nothing there, undefined: no answer)
  const q = async (layerUrl, lat, lon, fields = "*") => {
    const j = await get(`${layerUrl}/query?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${fields}&returnGeometry=false&resultRecordCount=1&f=json`);
    return j ? j.features?.[0]?.attributes || null : undefined;
  };
  const OPEN = "Public land: usually open to hunting, fishing, hiking and camping, unless a park, lease, closure or sign says otherwise.";
  const ASK = "Ask the owner before you hunt, camp or ride off the road here.";
  const crown = (t, d = OPEN) => ({ k: "crown", t, d });
  const priv = (t, d = ASK) => ({ k: "private", t, d });
  const unknown = (t, d) => ({ k: "unknown", t, d });
  const AT = {
    async bc(lat, lon) {
      const p = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: PMBC, outputFormat: "application/json", count: "1",
        propertyName: "OWNER_TYPE", CQL_FILTER: `INTERSECTS(SHAPE, SRID=4326;POINT(${lon} ${lat}))` });
      const j = await get(`${BCW}/wfs?${p}`);
      if (!j) return null;
      const own = j.features?.[0]?.properties?.OWNER_TYPE || "";
      if (/private/i.test(own)) return priv("Private land");
      if (/municipal|federal|first nation/i.test(own)) return { k: "public", t: `${own} land`, d: "Owned by a town, Canada or a First Nation, not general Crown land: its own rules apply (reserves need permission)." };
      return crown(own ? "Crown land (BC)" : "Most likely Crown land", own ? OPEN : "No private parcel here, and about 94% of BC is Crown land. Parks, reserves and leases still have their own rules: watch for signs.");
    },
    async ab(lat, lon) {
      const a = await q(`${ABG}/0`, lat, lon, "GWA_CODE");
      if (a === undefined) return null;
      if (a && a.GWA_CODE === "GLC_G") return crown("Crown land (Alberta Green Area)", `${OPEN} Leases and dispositions in the Green Area have their own rules.`);
      return unknown("White Area: mostly private", "Alberta's settled farm country: most land is private, so ask the owner first. Public land here (grazing leases, parks) has its own rules.");
    },
    async on(lat, lon) {
      const [c, l, p] = await Promise.all([q(`${LIO}/34`, lat, lon, "OBJECTID"), q(`${LIO}/33`, lat, lon, "PURPOSE_OF_DISPOSITION,LEASE_TYPE,LICENCE_OF_OCCUPATION_TYPE,CLASS_SUBTYPE"), q(`${LIO}/35`, lat, lon, "TITLE_HOLDER_TYPE")]);
      if (l) return { k: "lease", t: "Crown land with a lease or permit", d: `${l.PURPOSE_OF_DISPOSITION ? `${cap(l.PURPOSE_OF_DISPOSITION)}. ` : ""}Someone holds rights here (a camp, cottage, trapline cabin or works): keep clear of buildings and ask before you set up.` };
      if (c) return crown("Crown land (Ontario)");
      if (p) return /private/i.test(p.TITLE_HOLDER_TYPE || "") ? priv("Private land") : { k: "public", t: `${p.TITLE_HOLDER_TYPE || "Government"} land`, d: "Owned by a government or agency, not general Crown land: its own rules apply, ask the owner first." };
      if (c === undefined && p === undefined) return null;
      return unknown("Land owner not mapped here", "Not Crown land on Ontario's map: most likely private land, a park or a town. Ask before you go off the road.");
    },
    async qc(lat, lon) {
      const a = await q(`${PATP}/1`, lat, lon, "NOM_ZONE,NOM_SZONE,VOCATION");
      if (a === undefined) return null;
      if (a) return crown("Public land (terres du domaine de l'État)", `${OPEN}${a.NOM_SZONE || a.NOM_ZONE ? ` Planning zone: ${a.NOM_SZONE || a.NOM_ZONE}.` : ""}`);
      return priv("Not public land: most likely private", "Outside Quebec's public land: most land in southern Quebec is private. " + ASK);
    },
    async nb(lat, lon) {
      const a = await q(`${NB}/0`, lat, lon, "HOLDER");
      if (a === undefined) return null;
      if (a) return +a.HOLDER <= 10 ? crown("Crown land (New Brunswick)") : { k: "public", t: "Public land (government)", d: "Government land outside the Crown forest (often a federal or provincial park or site): check its own rules." };
      return priv("No Crown land here: most likely private", "About half of New Brunswick is private land. " + ASK);
    },
    async ns(lat, lon) {
      const a = await q(`${NS}/0`, lat, lon, "OBJECTID");
      if (a === undefined) return null;
      if (a) return crown("Crown land (Nova Scotia)");
      return priv("No Crown land here: most likely private", "About two thirds of Nova Scotia is private land. " + ASK);
    },
    async sk(lat, lon) {
      const [pf, fw, ag] = await Promise.all([q(`${SK}/Forestry/MapServer/0`, lat, lon, "*"), q(`${SK}/Planning/MapServer/7`, lat, lon, "*"), q(`${SK}/Agriculture/CrownLand_AG/MapServer/2`, lat, lon, "LLD")]);
      if (fw) return crown("Fish and Wildlife Development Fund land", "Public land bought for wildlife: open to hunting and walking in season, no vehicles off the trails.");
      if (ag) return { k: "lease", t: "Agricultural Crown land (leased)", d: "Crown pasture or hay land rented to a farmer or rancher: on foot it's usually open to hunting, but contact the leaseholder first and leave gates as you find them." };
      if (pf) return crown("Crown land (Saskatchewan provincial forest)");
      if (pf === undefined && ag === undefined) return null;
      return unknown("Land owner not mapped here", lat > 55 ? "Northern Saskatchewan is mostly Crown land, but leases, reserves and camps aren't all on this map." : "In farm country most land is private: ask the owner first.");
    },
    async mb(lat, lon) {
      const pf = await q(MB_PF, lat, lon, "PROV_FOREST_NAME");
      if (pf) return crown(`Crown land (${pf.PROV_FOREST_NAME || "Manitoba provincial forest"})`);
      return pf === undefined ? null : unknown("Land owner not mapped here", lat > 53.5 ? "Most of northern Manitoba is Crown land, but only the provincial forests are on this map." : "In southern Manitoba most land is private: ask the owner first. Crown land outside the provincial forests isn't on this map.");
    },
    async nl(lat, lon) {
      const a = await q(`${NL}/3`, lat, lon, "TITLETYPE");
      if (a === undefined) return null;
      if (a) return priv(`Granted land (Crown title${a.TITLETYPE ? `: ${a.TITLETYPE.toLowerCase()}` : ""})`, "The Crown granted this land away, so it's private (or leased). " + ASK);
      return crown("Most likely Crown land", "No Crown title mapped here, and about 95% of Newfoundland and Labrador is Crown land. Old grants near towns can be missing from the map: watch for fences and posted signs.");
    },
    pe: async () => unknown("Most likely private land", "About 90% of Prince Edward Island is private: ask the owner first. Provincial forests and wildlife management areas are public."),
  };
  const cap = (s) => String(s).toLowerCase().replace(/^./, (c) => c.toUpperCase());
  const inBox = (b, lat, lon) => lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];
  // pv: the province when the caller knows it (else the first box the point is in; boxes overlap at the borders).
  // Answers { k: crown | private | lease | public | unknown, t: title, d: what it means, c: colour }, or null.
  async function at(lat, lon, pv) {
    const k = pv && AT[pv] ? pv : Object.keys(AT).find((p) => inBox(BOX[p], lat, lon));
    if (!k) return null;
    const a = await AT[k](lat, lon);
    return a && { ...a, p: k, c: a.k === "crown" ? COL.crown : a.k === "private" ? COL.private : a.k === "lease" ? COL.lease : "#868e96" };
  }
  const has = (pv) => !!AT[pv];

  // ---------- property lines ----------
  // alex 2026-10-28: "les registres fonciers pour avoir les délimitations de terrain" in Hunting. The lines between
  // lots, live from each province's own land registry map (nothing stored on the site). Lot numbers only: no owner
  // names anywhere (none of these servers has them). Where a province's parcels aren't open data, its public survey
  // grid stands in (Ontario's original lots and concessions, Alberta's sections), said so on the map key and tap.
  //  - Quebec: cadastre rénové (MRNF, served by the Environment ministry; every lot, updated every two months).
  //  - British Columbia: ParcelMap BC (LTSA, via DataBC), every titled and Crown parcel.
  //  - New Brunswick: Service New Brunswick property parcels (PID).
  //  - Nova Scotia: Service Nova Scotia property records (NSPRD) boundaries (PID).
  //  - Ontario: original township lots and concessions (LIO Lot Fabric); today's parcels (Teranet) aren't open data.
  //  - Alberta: Alberta Township System legal subdivisions (LSD, 16 to a section); AltaLIS parcels aren't free.
  // Not mapped: Saskatchewan and Manitoba (ISC / TPR parcels are paid), PEI, Newfoundland and Labrador, the territories.
  const LOT = { line: "#e64980", edge: "#ffffff" };
  const LOTS = [
    { pv: "qc", svc: "https://geo.environnement.gouv.qc.ca/donnees/rest/services/Reference/Cadastre_allege/MapServer", layer: 0, scale: 30000, min: 13,
      ask: "NO_LOT", say: (a) => a.NO_LOT && { t: `Lot ${a.NO_LOT}`, d: "Cadastre du Québec (indicative: only a surveyor's plan fixes the real line)." },
      attr: 'Lots: <a href="https://www.quebec.ca/habitation-territoire/information-fonciere/cadastre">Cadastre du Québec</a> (MRNF)' },
    { pv: "bc", wms: PMBC, min: 13, attr: 'Lots: <a href="https://ltsa.ca/property-owners/about-land-records/parcelmap-bc/">ParcelMap BC</a>, DataBC' },
    { pv: "nb", svc: "https://geonb.snb.ca/arcgis/rest/services/GeoNB_SNB_Parcels/MapServer", layer: 0, scale: 40000, min: 13,
      ask: "PID", say: (a) => a.PID && { t: `Property PID ${a.PID}`, d: "Service New Brunswick property map (approximate lines)." },
      attr: 'Lots: <a href="https://www.snb.ca/geonb1/e/DC/propmap.asp">Service New Brunswick</a>' },
    { pv: "ns", svc: "https://nsgiwa2.novascotia.ca/arcgis/rest/services/PLAN/PLAN_NSPRD_UT83/MapServer", layer: 0, scale: 25000, min: 13,
      ask: "PID", say: (a) => a.PID && +a.PID ? { t: `Property PID ${a.PID}`, d: "Nova Scotia Property Records (approximate lines)." } : null,
      attr: 'Lots: <a href="https://novascotia.ca/sns/">Service Nova Scotia</a> property records' },
    { pv: "on", svc: "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open06/MapServer", layer: 2, min: 13, grid: true,
      ask: "LOT_IDENT,CONCESSION_IDENT,GEOGRAPHIC_TOWNSHIP_NAME", say: (a) => a.LOT_IDENT && { t: [cap(a.LOT_IDENT), a.CONCESSION_IDENT && cap(a.CONCESSION_IDENT), a.GEOGRAPHIC_TOWNSHIP_NAME && `${String(a.GEOGRAPHIC_TOWNSHIP_NAME).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())} Township`].filter(Boolean).join(", "),
        d: "Ontario's original survey lot: today's properties are often parts of it (Ontario's parcel map isn't open data)." },
      attr: 'Lots: <a href="https://geohub.lio.gov.on.ca/">Land Information Ontario</a> lot fabric' },
    { pv: "ab", svc: "https://geospatial.alberta.ca/titan/rest/services/cadastre/ct_seamless_legal_subdivision_grid/MapServer", layer: 0, min: 14, grid: true,
      ask: "MER,RGE,TWP,SEC,QTR,LSD", say: (a) => a.SEC && { t: `${a.QTR ? `${a.QTR} ` : ""}${a.SEC}-${a.TWP}-${a.RGE}-W${a.MER}${a.LSD ? ` (LSD ${a.LSD})` : ""}`,
        d: "Alberta legal land description (quarter-section-township-range-meridian): the grid farms and leases follow, not each property line." },
      attr: 'Lots: <a href="https://geospatial.alberta.ca/">Alberta Township System</a> grid' },
  ];
  // Line widths in pixels: thin when zoomed out; a pink line (no other layer's colour) on a white edge, so it reads on
  // the topo map and on photos.
  const lotPx = (z) => (z >= 16 ? [4, 2] : z >= 15 ? [3.4, 1.6] : [3, 1.3]);
  const lotUrl = (s, z, x, y) => {
    const [ew, lw] = lotPx(z);
    if (s.wms) {
      const st = (c, w, o) => `<FeatureTypeStyle><Rule><LineSymbolizer><Stroke><CssParameter name="stroke">${c}</CssParameter><CssParameter name="stroke-opacity">${o}</CssParameter><CssParameter name="stroke-width">${w}</CssParameter></Stroke></LineSymbolizer></Rule></FeatureTypeStyle>`;
      return `${BCW}/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${encodeURIComponent(s.wms)}&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=true&SRS=EPSG%3A3857&WIDTH=256&HEIGHT=256&SLD_BODY=${encodeURIComponent(
        `<StyledLayerDescriptor version="1.0.0"><NamedLayer><Name>${s.wms}</Name><UserStyle>${st(LOT.edge, ew, 0.75)}${st(LOT.line, lw, 1)}</UserStyle></NamedLayer></StyledLayerDescriptor>`)}&bbox=${tileBox(z, x, y)}`;
    }
    // Servers that hide their lots when zoomed out (scale): a lower dpi makes the same tile read as a closer scale.
    const res = (2 * R) / 2 ** z / 256, dpi = s.scale ? Math.max(12, Math.min(96, Math.floor((0.9 * s.scale * 0.0254) / res))) : 96, pt = 72 / dpi;
    const line = (id, c, w) => ({ id, source: { type: "mapLayer", mapLayerId: s.layer },
      drawingInfo: { renderer: { type: "simple", symbol: { type: "esriSFS", style: "esriSFSNull", color: [0, 0, 0, 0], outline: { type: "esriSLS", style: "esriSLSSolid", color: c, width: +(w * pt).toFixed(2) } } } } });
    // the first one is drawn on top
    const dl = [line(901, [...rgb(LOT.line), 255], lw), line(902, [...rgb(LOT.edge), 190], ew)];
    return `${s.svc}/export?bboxSR=3857&imageSR=3857&size=256%2C256&dpi=${dpi}&format=png32&transparent=true&f=image&dynamicLayers=${encodeURIComponent(JSON.stringify(dl))}&bbox=${tileBox(z, x, y)}`;
  };
  // The lot at a point: { t: lot number or survey description, d: what it is, p: province, grid } or null.
  async function lotAt(lat, lon, pv) {
    const s = LOTS.find((l) => l.pv === pv && l.ask);
    if (!s) return null;
    // (no resultRecordCount: Nova Scotia's and Ontario's lot servers answer nothing with it)
    const j = await get(`${s.svc}/${s.layer}/query?geometry=${lon},${lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${s.ask}&returnGeometry=false&f=json`);
    const a = j && j.features?.[0]?.attributes;
    const x = a && s.say(a);
    return x ? { ...x, p: pv, grid: !!s.grid } : null;
  }
  window.tfCrown = { SRC, COL, BOX, url, tint, bounds, leaflet, at, has, LOTS, LOT, lotUrl, lotAt };
})();
