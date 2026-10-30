// Adds the provinces' highway cameras near every eastern ski hill and backcountry area to data/webcams.json (kind "road"),
// so Skiing in Quebec, Ontario and the Maritimes has the drive-in cams the West has from DriveBC. Hand-run:
//   NODE_USE_ENV_PROXY=1 node scripts/build-east-road-cams.mjs
// Sources (all open, no key):
// - Quebec: the transport ministry's camera list (WFS ms:infos_cameras, Données Québec, CC BY 4.0). Québec 511 turns away
//   readers from data centres, so its picture address can't be checked from here: each cam links to Québec 511's own
//   viewer (URL_FLUX_DONNEE), which the app opens.
// - Ontario, New Brunswick, Nova Scotia: 511 sites' camera map (/map/mapIcons/Cameras) and each camera's tooltip, which
//   names it and gives its live picture /map/Cctv/<image id> (one site can have several views; the first is kept).
// Only cams near the hills (data/ski-lifts.json east of Manitoba) and backcountry areas (data/ski-areas.json), the
// nearest few each, plus the mountain highways skiers drive: Route 175 through the Laurentides reserve and Routes 132,
// 198 and 299 in the Chic-Chocs. Earlier cams this script wrote (src "east-road") are replaced; hand-added ones stay.
import fs from "node:fs";

const FILE = new URL("../data/webcams.json", import.meta.url);
const UA = { "User-Agent": "TrailFinder road cams (allduf.github.io/trail-finder)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = 6371, rad = (d) => (d * Math.PI) / 180;
const km = (a, b) => 2 * R * Math.asin(Math.sqrt(Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2));
const get = async (url, kind = "json") => { const r = await fetch(url, { headers: UA }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r[kind](); };

// Where skiers go: hills (live lift status or not) and eastern backcountry areas.
const lifts = JSON.parse(fs.readFileSync(new URL("../data/ski-lifts.json", import.meta.url), "utf8"));
const areas = JSON.parse(fs.readFileSync(new URL("../data/ski-areas.json", import.meta.url), "utf8")).areas;
const SPOTS = [
  ...Object.values(lifts.resorts).filter((r) => r.lon > -95).map((r) => ({ name: r.name, ll: [r.lat, r.lon], max: 20, n: 3 })),
  ...areas.filter((a) => a.lon > -95 && a.lat < 55).map((a) => ({ name: a.name, ll: [a.lat, a.lon], max: 35, n: 2 })),
];

const cams = [];
// Quebec: the WFS gives Web Mercator points.
const qc = await get("https://ws.mapserver.transports.gouv.qc.ca/swtq?service=WFS&version=2.0.0&request=GetFeature&typeName=ms:infos_cameras&outputFormat=geojson");
for (const f of qc.features) {
  const p = f.properties, [x, y] = f.geometry.coordinates;
  const ll = [+(((2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180) / Math.PI).toFixed(6), +((x / 6378137) * 180 / Math.PI).toFixed(6)];
  const route = parseInt(p.NumeroRoute, 10) || 0;
  cams.push({ pv: "qc", site: p.IDEcamera, ll, route, name: p.DescriptionLocalisationEn || p.DescriptionLocalisationFr, page: p.URL_FLUX_DONNEE });
}
console.log("qc", cams.length);
const H511 = { on: ["511on.ca", "on511"], nb: ["511.gnb.ca", "nb511"], ns: ["511.novascotia.ca", "ns511"] };
for (const [pv, [host]] of Object.entries(H511)) {
  const d = await get(`https://${host}/map/mapIcons/Cameras`);
  for (const c of d.item2 || []) cams.push({ pv, site: c.itemId, ll: c.location.map((v) => +(+v).toFixed(6)) });
  console.log(pv, d.item2.length);
}

// The nearest few cams of each spot, plus the mountain highways.
const MOUNTAIN = (c) => c.pv === "qc" && ((c.route === 175 && c.ll[0] > 47.05 && c.ll[0] < 48.3) || ([132, 198, 299].includes(c.route) && c.ll[0] > 48.8 && c.ll[1] > -66.9 && c.ll[1] < -65.3));
const picked = new Map();
for (const s of SPOTS) {
  const near = cams.map((c) => [c, km(s.ll, c.ll)]).filter(([, d]) => d <= s.max).sort((a, b) => a[1] - b[1]);
  // Skip a cam within 300 m of one already taken for this spot (both directions of the same interchange).
  const took = [];
  for (const [c, d] of near) {
    if (took.length >= s.n) break;
    if (took.some((t) => km(t.ll, c.ll) < 0.3)) continue;
    took.push(c);
    const k = c.pv + c.site;
    if (!picked.has(k) || picked.get(k).d > d) picked.set(k, { c, d, spot: s.name });
  }
}
for (const c of cams.filter(MOUNTAIN)) { const k = c.pv + c.site; if (!picked.has(k)) picked.set(k, { c, d: 0, spot: c.route === 175 ? "Route 175, Laurentides" : "Chic-Chocs" }); }
console.log("picked", picked.size);

// Names and pictures from each 511 camera's tooltip.
const attr = (html, k) => [...html.matchAll(new RegExp(`data-${k}="([^"]*)"`, "g"))].map((m) => m[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim());
const out = [];
for (const { c, spot } of [...picked.values()].sort((a, b) => a.spot.localeCompare(b.spot))) {
  if (c.pv === "qc") {
    const name = c.name.trim().replace(/^Aut\./, "Highway").replace(/^Rte\.?/, "Route");
    out.push({ id: `qc-${c.site}`, owner: "qc511", resort: spot, kind: "road", src: "east-road", name, view: `${name}.`, lat: c.ll[0], lon: c.ll[1], page: c.page });
    continue;
  }
  const [host, owner] = H511[c.pv];
  let html = "";
  try { html = await get(`https://${host}/tooltip/Cameras/${c.site}?lang=en`, "text"); } catch (e) { console.log("skip", c.pv, c.site, e.message); continue; }
  await sleep(250);
  const img = attr(html, "lazy")[0], title = attr(html, "fs-title")[0], desc = attr(html, "fs-desc")[0];
  if (!img || !title) continue;
  const look = desc && !/^n\/?a$/i.test(desc) ? desc : "";
  out.push({ id: `${c.pv}-${img.split("/").pop()}`, owner, resort: spot, kind: "road", src: "east-road", name: title.replace(/\s*\(\d+\)$/, ""),
    view: `${title.replace(/\s*\(\d+\)$/, "")}${look ? `, ${look.toLowerCase()}` : ""}.`, lat: c.ll[0], lon: c.ll[1], img: `https://${host}${img}` });
}

const W = JSON.parse(fs.readFileSync(FILE, "utf8"));
const ids = new Set(out.map((c) => c.id));
const keep = W.cams.filter((c) => c.src !== "east-road" && !ids.has(c.id));
// A hand-added cam at the same spot (another view of the same camera) wins.
W.cams = [...keep, ...out.filter((c) => !keep.some((k) => k.kind === "road" && km([k.lat, k.lon], [c.lat, c.lon]) < 0.3))];
W.owners.qc511 = W.owners.qc511 || { name: "Québec 511", page: "https://www.quebec511.info/en/Carte/Default.aspx", credit: "Québec 511, ministère des Transports et de la Mobilité durable" };
fs.writeFileSync(FILE, JSON.stringify(W, null, 1) + "\n");
console.log("road cams written", out.length, "by province", JSON.stringify(out.reduce((a, c) => ((a[c.id.split("-")[0]] = (a[c.id.split("-")[0]] || 0) + 1), a), {})));
