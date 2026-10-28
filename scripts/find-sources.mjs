// Local trail data finder (see .github/workflows/find-sources.yml). alex: "every time there is a trail with the type
// 'Trail', find local maps and local data of the trails in the area; find new sources every time you find nothing".
//
// Towns and regional districts publish their own trail maps as ArcGIS layers (Whistler's bike trails, the Columbia
// Shuswap Regional District's trails with difficulty, used by build-official.mjs and build-ratings.mjs). Every month this
// searches ArcGIS Online for public trail layers inside each zone of index.html, and keeps the line layers that have a
// difficulty-like field with real levels in it (easy, more difficult, black...). New ones (not in KNOWN, not reported
// before) go in a comment on the GitHub issue "Local trail data finder" that mentions OWNER, so GitHub emails them.
// Someone then checks the licence and who made it, and adds it to the build scripts or to KNOWN with the reason.
//
// Run: node scripts/find-sources.mjs   (prints only)   With GITHUB_TOKEN, GITHUB_REPOSITORY and OWNER it posts.
import { readFileSync } from "node:fs";

const UA = { "User-Agent": "trail-finder (github.com/allduf/trail-finder)" };
const OWNER = process.env.OWNER || "allduf", REPO = process.env.GITHUB_REPOSITORY, TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = process.env.GITHUB_API_URL || "https://api.github.com";
const ISSUE = "Local trail data finder";

// Services already looked at (start of the URL): used, or not usable and why.
const KNOWN = {
  "https://webmap.whistler.ca/": "used: Resort Municipality of Whistler bike trails",
  "https://services5.arcgis.com/wjH30HL7rqC55zVw/": "used: Columbia Shuswap Regional District trails",
  "https://www.rdcogis.com/": "Central Okanagan regional parks: walking difficulty, not for bikes",
  "https://services.arcgis.com/xYjDUN35YwdCEcMm/": "a student's copy of Fernie's Trailforks data, can't be used",
  "https://services2.arcgis.com/NlsizNmbMFiinWw4/": "a student project at Big White, no licence",
  "https://services3.arcgis.com/UIDEa9S9iqq5orpE/": "a student project in Banff, hiking times",
  "https://services1.arcgis.com/z1AfLrJFnIYaaSv3/": "Grand Forks area trail plan, no licence, mostly not rated",
  "https://services1.arcgis.com/mg5xPlZs10O6tWPP/": "Bellingham, outside the zones",
  "https://services3.arcgis.com/wTur6nX2hsVkJrqG/": "used: Fernie Trails Alliance trail network in Tourism Fernie's map (build-ratings fta)",
  "https://services.arcgis.com/U7kxTIxKEKeXs30y/": "used: Regional District of Okanagan-Similkameen trails (build-ratings rdos)",
  "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/": "Parks Canada: hiking classification (already in build-official.mjs)",
};
const LEVEL_WORD = /\b(easiest|easy|beginner|green|intermediate|moderate|more difficult|blue|difficult|most difficult|advanced|black|expert|double black)\b/i;
const DIFF_FIELD = /diff|rating|level|grade|skill/i;

async function get(url) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(45000) });
    return await r.json();
  } catch (e) { return { error: e.message }; }
}
async function github(path, method = "GET", body) {
  const r = await fetch(`${GITHUB_API}/repos/${REPO}${path}`, {
    method, body: body && JSON.stringify(body),
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": UA["User-Agent"], ...(body && { "Content-Type": "application/json" }) },
  });
  if (!r.ok) throw new Error(`GitHub said ${r.status} for ${method} ${path}`);
  return r.json();
}

// A line layer with a difficulty field that holds trail levels: { url, name, n, field, levels }.
async function difficultyLayer(url) {
  const lj = await get(`${url}?f=json`);
  if (lj.geometryType !== "esriGeometryPolyline") return null;
  const id = (lj.fields || []).find((f) => f.type === "esriFieldTypeOID") || { name: "OBJECTID" };
  for (const f of (lj.fields || []).filter((f) => DIFF_FIELD.test(f.name) && f.type === "esriFieldTypeString")) {
    const st = await get(`${url}/query?where=1%3D1&groupByFieldsForStatistics=${f.name}&outStatistics=${encodeURIComponent(JSON.stringify([{ statisticType: "count", onStatisticField: id.name, outStatisticFieldName: "n" }]))}&f=json`);
    const vals = (st.features || []).map((x) => [x.attributes[f.name], x.attributes.n]).filter(([v]) => v && LEVEL_WORD.test(v));
    if (new Set(vals.map(([v]) => v.toLowerCase())).size >= 2)
      return { url, name: lj.name, field: f.name, n: vals.reduce((a, [, n]) => a + n, 0), levels: vals.map(([v, n]) => `${v} ${n}`).join(", ") };
  }
  return null;
}

const html = readFileSync("index.html", "utf8");
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
const found = [], checked = new Set();
for (const z of ZONES) {
  const [s, w, n, e] = z.box, town = z.name.split(/[&(,]/)[0].trim(), items = new Map();
  for (const q of ["trail", "trails", "bike", "mountain bike", town]) {
    const j = await get(`https://www.arcgis.com/sharing/rest/search?q=${encodeURIComponent(q + ' (type:"Feature Service" OR type:"Map Service")')}&bbox=${w},${s},${e},${n}&f=json&num=100`);
    for (const r of j.results || []) {
      const wide = r.extent && r.extent.length === 2 ? r.extent[1][0] - r.extent[0][0] : 99;
      if (r.url && wide <= 6 && /trail|bike|mtb|recreat|park/i.test(`${r.title} ${(r.tags || []).join(" ")} ${r.snippet || ""}`)) items.set(r.url.replace(/\/$/, ""), r);
    }
  }
  for (const [url, r] of items) {
    if (checked.has(url) || Object.keys(KNOWN).some((k) => url.startsWith(k))) continue;
    checked.add(url);
    const svc = await get(`${url}?f=json`);
    const layers = /\/\d+$/.test(url) ? [url] : (svc.layers || []).filter((l) => !l.subLayerIds).map((l) => `${url}/${l.id}`);
    for (const lu of layers.slice(0, 25)) {
      const d = await difficultyLayer(lu);
      if (d) found.push({ zone: z.name, title: r.title, owner: r.owner, licence: (r.licenseInfo || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160), ...d });
    }
  }
  console.log(`${z.id}: ${items.size} trail services`);
}
console.log(`\n${found.length} layers with trail difficulty:`);
found.forEach((f) => console.log(`- ${f.zone}: ${f.title} / ${f.name} (${f.owner}) ${f.url} ${f.field}: ${f.levels}${f.licence ? ` | licence: ${f.licence}` : ""}`));

if (TOKEN && REPO) {
  const issues = await github(`/issues?state=all&per_page=100&creator=github-actions%5Bbot%5D`);
  let issue = issues.find((i) => i.title === ISSUE && !i.pull_request);
  if (!issue) issue = await github("/issues", "POST", { title: ISSUE, body: "Trail layers with difficulty that the monthly job found (scripts/find-sources.mjs).\n\n<!-- reported -->" });
  const reported = new Set(((issue.body || "").match(/<!-- reported([\s\S]*?)-->/) || ["", ""])[1].split("\n").map((s) => s.trim()).filter(Boolean));
  const fresh = found.filter((f) => !reported.has(f.url));
  if (fresh.length) {
    const lines = fresh.map((f) => `- **${f.zone}**: ${f.title}, layer “${f.name}” by ${f.owner}: ${f.n} trails rated in \`${f.field}\` (${f.levels}). ${f.url}${f.licence ? `\n  Licence: ${f.licence}` : "\n  No licence given: ask before using it."}`);
    await github(`/issues/${issue.number}/comments`, "POST", { body: `@${OWNER} new local trail data with difficulty ratings:\n\n${lines.join("\n")}\n\nI check the licence and who made it before adding one to the map.` });
    await github(`/issues/${issue.number}`, "PATCH", { body: (issue.body || "").replace(/<!-- reported[\s\S]*?-->/, `<!-- reported\n${[...reported, ...fresh.map((f) => f.url)].join("\n")}\n-->`) });
    console.log(`Posted ${fresh.length} new layers on issue #${issue.number}.`);
  } else console.log("Nothing new to report.");
}
