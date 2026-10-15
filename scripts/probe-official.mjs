// Temporary probe for the official-trails build.
async function get(u) { try { const r = await fetch(u, { headers: { "User-Agent": "trail-finder" } }); return [r.status, await r.text()]; } catch (e) { return [0, String(e)]; } }
async function js(u) { const [s, t] = await get(u); try { return JSON.parse(t); } catch { console.log("!", s, t.slice(0, 300)); return null; } }
const tally = (arr) => { const m = new Map(); arr.forEach((v) => m.set(v, (m.get(v) || 0) + 1)); return [...m].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([v, n]) => `${v}:${n}`).join(" | "); };
// Sepaq
{ const j = await js("https://www.donneesquebec.ca/recherche/dataset/f5c2e540-4416-4e90-9520-7837b8e31346/resource/81d32e61-16b8-4ccd-a0c4-c34e220e4420/download/sentieretel.json");
  if (j) { console.log("SEPAQ crs", JSON.stringify(j.crs), "type", j.features[0].geometry.type, JSON.stringify(j.features[0].geometry.coordinates).slice(0, 200));
    console.log("SEPAQ usager", tally(j.features.map((f) => f.properties.Usager + " / " + f.properties.Usager_2))); } }
// Ottawa
{ const u = "https://maps.ottawa.ca/arcgis/rest/services/CyclingMap/MapServer"; const s = await js(u + "?f=json"); if (s) console.log("OTTAWA layers", (s.layers || []).map((l) => l.id + ":" + l.name).join(" | "));
  const l = await js(u + "/17?f=json"); if (l) console.log("OTTAWA 17", l.name, l.geometryType, (l.fields || []).map((f) => f.name).join(","), "copyright", l.copyrightText, "desc", (l.description || "").slice(0, 300));
  const c = await js(u + "/17/query?where=1%3D1&outFields=*&returnGeometry=false&f=json&resultRecordCount=5"); if (c) console.log("OTTAWA sample", JSON.stringify(c.features && c.features.slice(0, 5).map((f) => f.attributes)).slice(0, 1500));
  const n = await js(u + "/17/query?where=1%3D1&returnCountOnly=true&f=json"); console.log("OTTAWA count", n && n.count); }
// BC lines
{ const wfs = "https://openmaps.gov.bc.ca/geo/pub/wfs?service=WFS&version=2.0.0&request=GetFeature&outputFormat=json&srsName=EPSG:4326&typeName=";
  const j = await js(wfs + "pub:WHSE_FOREST_TENURE.FTEN_RECREATION_LINES_SVW&count=20000&propertyName=FOREST_FILE_ID,PROJECT_TYPE,PROJECT_NAME,RETIREMENT_DATE,LIFE_CYCLE_STATUS_CODE,FILE_STATUS_CODE,RECREATION_FEATURE_CODE,RECREATION_MAP_FEATURE_CODE,FEATURE_LENGTH_M");
  if (j) { const fs = j.features; console.log("BC lines", fs.length, "numberMatched", j.numberMatched, "first coords", JSON.stringify(fs[0].geometry).slice(0, 150));
    for (const k of ["PROJECT_TYPE", "LIFE_CYCLE_STATUS_CODE", "FILE_STATUS_CODE", "RECREATION_FEATURE_CODE", "RECREATION_MAP_FEATURE_CODE"]) console.log("  ", k, tally(fs.map((f) => f.properties[k])));
    console.log("   retired", fs.filter((f) => f.properties.RETIREMENT_DATE).length, "files", new Set(fs.map((f) => f.properties.FOREST_FILE_ID)).size); }
  const t = await js(wfs + "pub:WHSE_FOREST_TENURE.FTEN_REC_TRAILS_SVW&count=3");
  if (t) console.log("BC trails props", JSON.stringify(t.features[0].properties).slice(0, 1200)); }
// AB / ON / PC paging check
for (const u of ["https://geospatial.alberta.ca/mimas/rest/services/recreation/alberta_designated_and_provincial_trails/MapServer/1",
  "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open04/MapServer/19",
  "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Trails_Sentiers_APCA_V2_FGP/FeatureServer/0"]) {
  const q = await js(u + "/query?where=1%3D1&outFields=*&outSR=4326&f=json&resultOffset=0&resultRecordCount=2");
  console.log("PAGE", u.split("/").slice(-3).join("/"), q && (q.error ? JSON.stringify(q.error) : JSON.stringify(q.features[0]).slice(0, 400)), q && q.exceededTransferLimit); }
// ON uses, road flag
{ const st = encodeURIComponent(JSON.stringify([{ statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" }]));
  const j = await js(`https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open04/MapServer/19/query?where=1%3D1&groupByFieldsForStatistics=ON_ROAD_FLG&outStatistics=${st}&f=json`);
  console.log("ON road flag", j && JSON.stringify(j.features)); }
// Manitoba
{ const j = await js("https://open.canada.ca/data/api/3/action/package_show?id=20860245-9be4-3e40-d34f-dbb2e12dcea8");
  if (j) for (const r of j.result.resources) console.log("MB", r.format, JSON.stringify(r.name), r.url); }
