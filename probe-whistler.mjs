import { readFileSync } from "node:fs";
const UA = { "User-Agent": "trail-finder (github.com/allduf/trail-finder)" };
const get = async (u) => { try { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(45000) }); const t = await r.text(); try { return JSON.parse(t); } catch { return { _text: t.slice(0, 300), _status: r.status }; } } catch (e) { return { _err: e.message }; } };
const html = readFileSync("index.html", "utf8");
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
const seen = new Set();
const DIFF = /diff|rating|rate|level|class/i;
async function inspect(url, zone) {
  if (seen.has(url)) return; seen.add(url);
  const s = await get(`${url}?f=json`);
  const layers = (s.layers || []).filter((l) => !l.subLayerIds);
  for (const l of layers.length ? layers : [{ id: null }]) {
    const lu = l.id === null ? url : `${url}/${l.id}`;
    const lj = await get(`${lu}?f=json`);
    if (lj.geometryType !== "esriGeometryPolyline") continue;
    const fields = (lj.fields || []).map((f) => f.name);
    const df = fields.filter((n) => DIFF.test(n) && !/shape|globalid/i.test(n));
    const cnt = await get(`${lu}/query?where=1%3D1&returnCountOnly=true&f=json`);
    let line = `  [${zone}] ${lu} "${lj.name}" n=${cnt.count} fields=${fields.join(",").slice(0, 300)}`;
    for (const fn of df.slice(0, 3)) {
      const st = await get(`${lu}/query?where=1%3D1&groupByFieldsForStatistics=${fn}&outStatistics=${encodeURIComponent(JSON.stringify([{ statisticType: "count", onStatisticField: fields.includes("OBJECTID") ? "OBJECTID" : fields[0], outStatisticFieldName: "n" }]))}&f=json`);
      line += `\n      ${fn}: ` + ((st.features || []).map((f) => `${f.attributes[fn]}=${f.attributes.n}`).join(" | ").slice(0, 400) || JSON.stringify(st).slice(0, 150));
    }
    console.log(line);
  }
}
for (const z of ZONES) {
  const [s, w, n, e] = z.box;
  const town = z.name.split(/[&(,]/)[0].trim();
  const qs = [`trail`, `trails`, `bike`, `mountain bike`, `${town}`];
  const hits = new Map();
  for (const q of qs) {
    const j = await get(`https://www.arcgis.com/sharing/rest/search?q=${encodeURIComponent(q + ' (type:"Feature Service" OR type:"Map Service")')}&bbox=${w},${s},${e},${n}&f=json&num=100`);
    for (const r of j.results || []) {
      const ext = r.extent && r.extent.length === 2 ? (r.extent[1][0] - r.extent[0][0]) : 99;
      if (ext > 6 || !r.url) continue;
      if (!/trail|bike|mtb|path|recreat|park|bike/i.test(r.title + " " + (r.tags || []).join(" ") + " " + (r.snippet || ""))) continue;
      hits.set(r.url, r);
    }
  }
  console.log(`\n=== ${z.id} ${z.name}: ${hits.size} local trail services`);
  for (const r of hits.values()) {
    console.log(` * ${r.title} | owner=${r.owner} | access=${r.access} | ${r.url} | lic=${(r.licenseInfo || "").replace(/<[^>]+>/g, "").slice(0, 100)}`);
  }
  for (const r of [...hits.values()].slice(0, 12)) await inspect(r.url.replace(/\/$/, ""), z.id);
}
