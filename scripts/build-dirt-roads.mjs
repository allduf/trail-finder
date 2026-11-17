// Every gravel and dirt road in Canada, for Adventure moto's ADV topo map when zoomed out (alex 2026-11-17: "Yes, build
// it"). OpenFreeMap's tiles (adv-map.js) only carry unpaved roads from zoom 13 and tracks from 14, so from further out
// the map showed almost none outside BC. .github/workflows/dirt-roads.yml runs this:
//   node scripts/build-dirt-roads.mjs keep <osmium geojsonseq> >> dirt.geojsonseq   (once per province)
//   tippecanoe ... dirt.geojsonseq                                                  (vector tiles, zooms 7-11)
//   node scripts/build-dirt-roads.mjs split <tippecanoe dir> <out dir>               (four Cloudflare Pages sites)
// Kept: every highway=track (not paved), and every other road whose surface says it isn't paved. Driveways, parking
// aisles and private roads are left out. Each line keeps only c ("t" track, "r" road) and n (its name, if any).
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const UNPAVED = new Set(["unpaved", "gravel", "fine_gravel", "compacted", "dirt", "earth", "ground", "mud", "sand", "grass", "pebblestone", "rock", "woodchips", "grass_paver", "clay", "stone"]);
const PAVED = new Set(["paved", "asphalt", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "chipseal", "metal", "wood", "bricks"]);
const ROADS = new Set(["unclassified", "tertiary", "secondary", "primary", "road", "residential", "service"]);
// Shard of a tile: the same rule as the client (adv-map.js dirtSite).
export const SITES = 4;
export const site = (z, x, y) => (z < 7 ? 0 : ((x >> (z - 7)) * 31 + (y >> (z - 7))) % SITES);

async function keep(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let n = 0, k = 0;
  for await (let line of rl) {
    line = line.replace(/^\x1e/, "").trim();
    if (!line) continue;
    n++;
    let f;
    try { f = JSON.parse(line); } catch { continue; }
    const t = f.properties || {}, g = f.geometry;
    if (!g || (g.type !== "LineString" && g.type !== "MultiLineString")) continue;
    const surface = String(t.surface || "").split(";")[0];
    if (/^(private|no)$/.test(t.access || "") || /^(driveway|parking_aisle|drive-through|emergency_access)$/.test(t.service || "")) continue;
    if (t.area === "yes") continue;
    let c = null;
    if (t.highway === "track") c = PAVED.has(surface) ? null : "t";
    else if (ROADS.has(t.highway) && UNPAVED.has(surface)) c = "r";
    if (!c) continue;
    const props = { c };
    if (t.name) props.n = String(t.name).slice(0, 80);
    process.stdout.write(JSON.stringify({ type: "Feature", properties: props, geometry: g }) + "\n");
    k++;
  }
  console.error(`${path.basename(file)}: kept ${k} of ${n} roads`);
}

function split(src, out) {
  let total = 0;
  const per = Array(SITES).fill(0);
  for (let s = 0; s < SITES; s++) {
    fs.mkdirSync(path.join(out, `site${s}`, "dirt"), { recursive: true });
    // Cross-site reads from the app; .pbf served as vector tiles, cached a day by the phone.
    fs.writeFileSync(path.join(out, `site${s}`, "_headers"), "/*\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=86400\n/dirt/*\n  Content-Type: application/x-protobuf\n");
    fs.writeFileSync(path.join(out, `site${s}`, "404.html"), "Not found");
  }
  for (const z of fs.readdirSync(src).filter((d) => /^\d+$/.test(d))) {
    for (const x of fs.readdirSync(path.join(src, z))) {
      for (const f of fs.readdirSync(path.join(src, z, x))) {
        const y = parseInt(f, 10), s = site(+z, +x, y);
        const d = path.join(out, `site${s}`, "dirt", z, x);
        fs.mkdirSync(d, { recursive: true });
        fs.renameSync(path.join(src, z, x, f), path.join(d, `${y}.pbf`));
        per[s]++; total++;
      }
    }
  }
  console.log(`${total} tiles: ${per.map((n, s) => `site ${s} ${n}`).join(", ")}`);
  if (per.some((n) => n > 19900)) { console.error("A site has more than Cloudflare Pages' 20,000 files"); process.exit(1); }
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "keep") await keep(a);
else if (cmd === "split") split(a, b);
else { console.error("usage: keep <geojsonseq> | split <tippecanoe dir> <out dir>"); process.exit(2); }
