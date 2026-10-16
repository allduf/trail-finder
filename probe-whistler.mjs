const UA = { "User-Agent": "trail-finder (github.com/allduf/trail-finder)" };
const get = async (u) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(60000) }); return await r.json(); } catch (e) { return { _err: e.message }; } };
const C = "https://services5.arcgis.com/wjH30HL7rqC55zVw/arcgis/rest/services/Trails/FeatureServer/0";
const lj = await get(`${C}?f=json`);
console.log("FIELDS", (lj.fields || []).map((f) => `${f.name}(${f.alias})${f.domain ? "{" + (f.domain.codedValues || []).map((c) => c.code + "=" + c.name).join(",") + "}" : ""}`).join("; "));
console.log("DESC", (lj.description || "").slice(0, 600), "COPY", lj.copyrightText);
const st = async (fn, where = "1=1") => { const j = await get(`${C}/query?where=${encodeURIComponent(where)}&groupByFieldsForStatistics=${fn}&outStatistics=${encodeURIComponent(JSON.stringify([{ statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" }]))}&f=json`); return (j.features || []).map((f) => `${f.attributes[fn]}=${f.attributes.n}`).join(" | ") || JSON.stringify(j).slice(0, 200); };
for (const fn of (lj.fields || []).map((f) => f.name).filter((n) => !/OBJECTID|GlobalID|Shape|Trail_Name|Description|Distance|Elev_|_ID$|Date|date/i.test(n))) console.log("STAT", fn, ":", (await st(fn)).slice(0, 700));
console.log("SYSTEMS", (await st("System_Name")).slice(0, 4000));
for (const nm of ["Schacher", "B12", "Summit", "Saints", "Dead Dog", "Kobe", "Magic Dragon", "Quinton", "GnR", "Skid Marks", "Cliff Side", "True Value", "5K", "6K"]) {
  const j = await get(`${C}/query?where=${encodeURIComponent(`Trail_Name LIKE '%${nm}%'`)}&outFields=*&returnGeometry=false&outSR=4326&f=json&resultRecordCount=5`);
  for (const f of j.features || []) { const a = { ...f.attributes }; delete a.Description; console.log("ROW", nm, JSON.stringify(a).slice(0, 700)); }
  if (!(j.features || []).length) console.log("ROW", nm, "none", JSON.stringify(j).slice(0, 150));
}
const ext = await get(`${C}/query?where=1%3D1&returnExtentOnly=true&outSR=4326&f=json`); console.log("EXTENT", JSON.stringify(ext));
const sys = "https://services5.arcgis.com/wjH30HL7rqC55zVw/arcgis/rest/services/Trail_Systems/FeatureServer/0";
const sj = await get(`${sys}/query?where=1%3D1&outFields=*&returnGeometry=false&f=json`);
for (const f of (sj.features || []).slice(0, 80)) { const a = { ...f.attributes }; for (const k in a) if (typeof a[k] === "string" && a[k].length > 120) a[k] = a[k].slice(0, 120); console.log("SYS", JSON.stringify(a).slice(0, 500)); }
for (const L of ["https://www.rdcogis.com/arcgis/rest/services/DataDownload/RDCO_Parks_Data_Download/FeatureServer/15", "https://www.rdcogis.com/arcgis/rest/services/DataDownload/RDCO_Parks_Data_Download/FeatureServer/14"]) {
  const j = await get(`${L}?f=json`); console.log("RDCO", j.name, (j.fields || []).map((f) => f.name).join(","));
  const q = await get(`${L}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=6&f=json`);
  for (const f of q.features || []) console.log("  ", JSON.stringify(f.attributes).slice(0, 400));
}
