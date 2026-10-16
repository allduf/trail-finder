const UA = { "User-Agent": "trail-finder (github.com/allduf/trail-finder)" };
const get = async (u) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(60000) }); const t = await r.text(); try { return JSON.parse(t); } catch { return { _text: t.slice(0, 500), _status: r.status }; } } catch (e) { return { _err: e.message }; } };
const RX = /trail|path|bike|mtb|recreat|park|wayfind/i;
async function walk(root, folder = "") {
  const j = await get(`${root}${folder ? "/" + folder : ""}?f=json`);
  if (j._err || j._text) { console.log("ROOT", root, folder, JSON.stringify(j).slice(0, 300)); return; }
  for (const f of j.folders || []) await walk(root, f);
  for (const s of j.services || []) {
    if (!/MapServer|FeatureServer/.test(s.type)) continue;
    const su = `${root}/${s.name}/${s.type}`;
    const sj = await get(`${su}?f=json`);
    for (const l of sj.layers || []) {
      if (!RX.test(l.name) && !RX.test(s.name)) continue;
      const lj = await get(`${su}/${l.id}?f=json`);
      const cnt = await get(`${su}/${l.id}/query?where=1%3D1&returnCountOnly=true&f=json`);
      console.log(`\n### ${su}/${l.id}  "${l.name}"  geom=${lj.geometryType} count=${cnt.count}`);
      console.log("fields:", (lj.fields || []).map((f) => f.name).join(", "));
      if (!lj.fields) continue;
      const s5 = await get(`${su}/${l.id}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=4&f=json`);
      for (const f of s5.features || []) console.log("  ", JSON.stringify(f.attributes).slice(0, 600));
      for (const fn of (lj.fields || []).map((f) => f.name).filter((n) => /diff|rate|rating|level|class|use|activ|bike|status|type|desig|sanction|official|owner|manag/i.test(n))) {
        const st = await get(`${su}/${l.id}/query?where=1%3D1&groupByFieldsForStatistics=${fn}&outStatistics=${encodeURIComponent(JSON.stringify([{ statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" }]))}&f=json`);
        console.log(`   ${fn}:`, (st.features || []).map((f) => `${f.attributes[fn]}=${f.attributes.n}`).join(" | ").slice(0, 900) || JSON.stringify(st).slice(0, 200));
      }
      const t = await get(`${su}/${l.id}/query?where=${encodeURIComponent("UPPER(CAST(OBJECTID AS VARCHAR(20))) IS NOT NULL")}&outFields=*&returnGeometry=false&f=json&resultRecordCount=2000`);
      const hits = (t.features || []).filter((f) => /trial|error|emerald|big kahuna|shit happens|anal/i.test(JSON.stringify(f.attributes)));
      for (const h of hits.slice(0, 10)) console.log("   HIT", JSON.stringify(h.attributes).slice(0, 500));
    }
  }
}
console.log("== RMOW server");
await walk("https://webmap.whistler.ca/server/rest/services");
for (const q of ["owner:RMOW", "whistler trails", "whistler mountain bike", "squamish trails", "pemberton trails", "SLRD trails", "sea to sky trails"]) {
  const j = await get(`https://www.arcgis.com/sharing/rest/search?q=${encodeURIComponent(q)}&f=json&num=100`);
  console.log(`\n== arcgis search "${q}" total=${j.total}`);
  for (const r of j.results || []) if (RX.test(r.title + " " + (r.tags || []).join(" ")) || q === "owner:RMOW") console.log(`  ${r.type} | ${r.title} | ${r.owner} | ${r.url || ""} | id=${r.id} | lic=${(r.licenseInfo || "").replace(/<[^>]+>/g, "").slice(0, 80)}`);
}
const hub = await get("https://portal-rmow.opendata.arcgis.com/api/search/v1/collections/all/items?limit=100");
console.log("\n== RMOW hub", (hub.features || []).map((f) => `${f.properties.title} | ${f.properties.type} | ${f.properties.url || ""}`).join("\n") || JSON.stringify(hub).slice(0, 400));
