// Builds the 3D map's Winter photos once (they're last winter's, so they don't change):
//   node scripts/winter-photos/build.mjs <out-dir>     then   python3 scripts/winter-photos/tiles.py <out-dir>
// Renders 2048 px blocks (one zoom-11 tile each, = 8 x 8 zoom-13 tiles) of the region in headless
// Chromium with render.js, straight from the Sentinel-2 files on AWS. Needs Playwright and geotiff.js
// (npm i geotiff@2.1.3); set GEOTIFF to its dist-browser/geotiff.js.
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
const here = path.dirname(new URL(import.meta.url).pathname), out = process.argv[2] || "winter-blocks";
const [X0, Y0, X1, Y1] = [315, 686, 331, 702];   // zoom 11: Sunshine Coast and Vancouver to Lillooet
fs.mkdirSync(out, { recursive: true });
const jobs = [];
for (let x = X0; x <= X1; x++) for (let y = Y0; y <= Y1; y++) if (!fs.existsSync(`${out}/${x}_${y}.png`) && !fs.existsSync(`${out}/${x}_${y}.empty`)) jobs.push([x, y]);
console.log("blocks", jobs.length);
const b = await chromium.launch(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {});
const ctx = await b.newContext({ ignoreHTTPSErrors: true });
const tries = new Map();
async function worker() {
  const p = await ctx.newPage();
  await p.route("**/*", async (r) => {
    const u = r.request().url();
    if (u === "http://local/") return r.fulfill({ body: "<html></html>", contentType: "text/html" });
    if (u.endsWith("winter-scenes.json")) return r.fulfill({ path: path.join(here, "../../data/winter-scenes.json"), contentType: "application/json" });
    if (u.includes("geotiff.js")) return r.fulfill({ path: process.env.GEOTIFF, contentType: "text/javascript" });
    if (u.includes("sentinel-cogs")) return r.continue();
    return r.fulfill({ status: 404, body: "" });
  });
  await p.goto("http://local/");
  await p.addScriptTag({ path: path.join(here, "render.js") });
  while (jobs.length) {
    const [x, y] = jobs.shift();
    try {
      const png = await p.evaluate(async ([x, y]) => {
        const r = await window.renderWinter(11, x, y, 2048);
        const bm = await createImageBitmap(new Blob([r.data])), c = new OffscreenCanvas(2048, 2048), cx = c.getContext("2d");
        cx.drawImage(bm, 0, 0);
        const d = cx.getImageData(0, 0, 2048, 2048).data;
        for (let i = 3; i < d.length; i += 4) if (d[i]) return Array.from(new Uint8Array(r.data));
        return null;
      }, [x, y]);
      fs.writeFileSync(`${out}/${x}_${y}.${png ? "png" : "empty"}`, png ? Buffer.from(png) : "");
      console.log("block", x, y, jobs.length, "left");
    } catch (e) {
      console.log("failed", x, y, e.message.slice(0, 120));
      const n = (tries.get(`${x}/${y}`) || 0) + 1; tries.set(`${x}/${y}`, n);
      if (n < 3) jobs.push([x, y]);
    }
  }
}
await Promise.all([...Array(8)].map(worker));
await b.close();
