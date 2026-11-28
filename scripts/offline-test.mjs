// Offline maps test (Friday test 2026-11-27, "save an area, go to airplane mode, check everything"): the website at
// iPhone size with its offline helper (sw.js) on, an area saved in Offline maps, then no signal. Each check failed on
// the code before that day's fixes:
//  - Opened again with no signal: the app opens on the saved map, with the area's green dashed square.
//  - 3D with no signal: the ground draws the saved map (lakes, roads, forest). It was blank: the 3D map asks
//    OpenFreeMap for "planet" while the saved style uses "backup_planet", and only the saved one was found.
//  - An area saved in an earlier week: OpenFreeMap moves its map to a new address every week, and with no signal the
//    saved tiles are found under the address they were saved with (sw.js ofmElsewhere).
//  - Outside every saved area: one line on the map says the spot isn't saved.
//  - Signal back: the style that was on comes back (it stayed on the offline style until the app was opened again).
//
// Run: node scripts/offline-test.mjs   (needs the playwright package; Chromium, as WebKit's test browser can't open a
// page from its offline helper with the network cut). Optional: OUT (offline-shots), BROWSER (chromium).
// Needs the internet: the map tiles and heights are saved from OpenFreeMap and Mapterhorn as in the app.
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const LIVE = "https://trailfinderapp.ca/";
const OUT = process.env.OUT || "offline-shots";
const BROWSER = process.env.BROWSER || "chromium";
const BOX = [50.105, -122.975, 50.12, -122.95];   // Whistler's Alta Lake and Lost Lake: small, quick to save
const OUTSIDE = [49.70, -123.15];                   // Squamish: not saved
const root = fileURLToPath(new URL("../", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
// The site from this checkout; the data files (on the site-data branch) from the live site.
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = normalize(join(root, path));
  try {
    if (!file.startsWith(root) || /^(\.git|\.github|scripts|supabase|ios-app|android-app)\//.test(path)) throw new Error("not served");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "content-length": body.length }).end(body);
  } catch {
    try {
      const r = await fetch(LIVE + path), b = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream", "content-length": b.length }).end(req.method === "HEAD" ? undefined : b);
    } catch { res.writeHead(502).end(); }
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const SITE = `http://localhost:${server.address().port}/`;

const pw = await import("playwright");
const browser = await pw[BROWSER].launch();
await mkdir(OUT, { recursive: true });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const results = [];
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1, hasTouch: true, isMobile: BROWSER === "chromium",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  geolocation: { latitude: 50.1163, longitude: -122.9574 }, permissions: ["geolocation"], locale: "en-CA", timezoneId: "America/Vancouver", serviceWorkers: "allow" });
// Signed in on this device (saving needs an account; account.js trusts this flag), and no Today card popping up.
await ctx.addInitScript(() => { try { localStorage.setItem("tf:todayAuto", "false"); localStorage.setItem("trailfinder-signed-in", "1"); } catch {} });
const page = await ctx.newPage();
const errors = [];
const NOISE = /Failed to load resource|ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError|AJAXError|^pt$|status of [45]\d\d|no terrain/;
page.on("pageerror", (e) => errors.push(String(e.message).split("\n")[0].slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push("console: " + m.text().split("\n")[0].slice(0, 200)); });
// Saved map tiles inside the box that couldn't be found with no signal.
let offline = false;
const missing = new Set();
const inBox = (z, x, y) => { const n = 2 ** z, lon = (x + 0.5) / n * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n))) * 180 / Math.PI;
  return z >= 12 && lat > BOX[0] && lat < BOX[2] && lon > BOX[1] && lon < BOX[3]; };
page.on("requestfailed", (r) => {
  const m = offline && r.url().match(/tiles\.openfreemap\.org\/.*\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
  if (m && inBox(+m[1], +m[2], +m[3])) missing.add(r.url());
});
let n = 0;
async function check(name, fn, settle = 1000) {
  const e0 = errors.length;
  let note = "";
  try { note = (await fn()) || ""; } catch (e) { note = "✗ " + String(e.message || e).split("\n")[0].slice(0, 200); }
  await wait(settle);
  await page.screenshot({ path: join(OUT, `${String(++n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.png`) }).catch(() => {});
  const problems = [/^✗/.test(note) ? note.slice(2) : "", ...errors.slice(e0)].filter(Boolean);
  results.push({ name, ok: !problems.length });
  console.log(`${problems.length ? "✗" : "✓"} ${name}${problems.length ? "\n    " + problems.join("\n    ") : note ? ": " + note : ""}`);
}
const ev = (fn, arg) => page.evaluate(fn, arg);
const base = () => ev(() => document.getElementById("basemap").value);
const noteText = () => ev(() => { const el = document.querySelector(".off-here-note"); return el && !el.hidden ? el.textContent : ""; });
async function open() {
  await page.waitForSelector("#sportMapBtn", { timeout: 60_000 });
  if (await page.locator("dialog.tf-terms [data-terms=ok]").click({ timeout: 6000 }).then(() => true, () => false)) await page.waitForSelector("dialog.welc[open]", { timeout: 4000 }).catch(() => {});
  await page.keyboard.press("Escape").catch(() => {});
  await page.locator("#firstTip a, #firstTip button").first().click({ timeout: 2000 }).catch(() => {});
}
const fit = () => ev((b) => { window.tfLeaflet.fitBounds([[b[0], b[1]], [b[2], b[3]]], { animate: false }); }, BOX);
// Tiles the 3D map's own OpenFreeMap source (its ground with no signal) has drawn.
const ground3d = () => ev(() => {
  const g = window.trailMap3d, m = g && g.style && (g.style.tileManagers || g.style.sourceCaches || {}).names, t = m && m._inViewTiles;
  return t ? t.getAllIds().filter((id) => t.getTileById(id).state === "loaded").length : -1;
});
// The browser's own download cache can answer map tiles with no signal for a while; a phone's may already have let
// them go, so only what Offline maps saved counts here.
const dropHttpCache = async () => { if (BROWSER !== "chromium") return; const cdp = await ctx.newCDPSession(page); await cdp.send("Network.clearBrowserCache"); await cdp.detach(); };
async function in3d(on) {
  const is = await ev(() => !!document.querySelector(".is3d"));
  if (is !== on) { await page.locator("#btn3d").first().click(); await wait(on ? 10_000 : 3000); }
}

await page.goto(SITE + "index.html", { waitUntil: "domcontentloaded" });
await open();
await fit(); await wait(3000);
await check("Save the area (3D map too)", async () => {
  await ev((b) => { localStorage.setItem("tf-offline-3d", "1"); window.tfOffline.saveBox(b, "Offline test"); }, BOX);
  for (const t0 = Date.now(); Date.now() - t0 < 600_000; await wait(2000)) {
    const st = await ev(() => window.tfOffline.status("Offline test"));
    if (st && st.state === "saved") return "saved";
    if (st && st.state === "missing") throw new Error(`${st.missing} files missing`);
  }
  throw new Error("still saving after 10 min");
});
await page.locator(".offline-card [data-x]").click().catch(() => {});
await page.reload({ waitUntil: "domcontentloaded" }); await open(); await wait(5000);   // the offline helper now runs the page

offline = true;
await dropHttpCache();
await ctx.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await check("Opened again with no signal: the saved map and its square", async () => {
  await open(); await wait(6000); await fit(); await wait(3000);
  const b = await base(), sq = await ev(() => document.querySelectorAll(".off-area-name").length);
  if (b !== "vector") throw new Error(`the map style is ${b}, not the saved map`);
  if (!sq) throw new Error("no saved-area square");
  if (missing.size) throw new Error(`${missing.size} saved map tiles not found, e.g. ${[...missing][0]}`);
});
await check("3D with no signal: the saved map on the ground", async () => {
  await in3d(true);
  await ev((b) => { window.trailMap3d.jumpTo({ center: [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2], zoom: 13.5, pitch: 50 }); }, BOX); await wait(6000);
  const k = await ground3d();
  const tj = await ev(() => fetch("https://tiles.openfreemap.org/planet", { cache: "no-store" }).then((r) => r.ok, () => false));
  if (!tj) throw new Error("the 3D map's list of map addresses (planet) isn't found with no signal");
  if (k <= 0) throw new Error("the 3D ground has no saved map tiles (blank ground)");
  return `${k} map tiles on the ground`;
});
await in3d(false);
await check("Outside every saved area: the map says so", async () => {
  await ev((c) => { window.tfLeaflet.setView(c, 13, { animate: false }); }, OUTSIDE); await wait(1500);
  if (!(await noteText())) throw new Error("no line on the map");
  await fit(); await wait(1500);
  if (await noteText()) throw new Error("the line stays inside the saved area");
});

// An area saved in an earlier week: its tiles moved under another week's address, as if saved then.
offline = false;
await ctx.setOffline(false);
await check("Area saved an earlier week (simulated)", () => ev(async () => {
  const areas = JSON.parse(localStorage.getItem("tf-offline-areas")), src = areas[0].sources.find((s) => /\.pbf$/.test(s.tmpl));
  const pre = src.tmpl.split("{z}")[0], old = pre.replace(/[^/]+\/$/, "20200101_000000_pt/");
  const db = await new Promise((ok, no) => { const r = indexedDB.open("tf-files"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  let moved = 0;
  await new Promise((ok) => { const t = db.transaction("offline", "readwrite"), s = t.objectStore("offline"), c = s.openCursor(IDBKeyRange.bound(pre, pre + "￿"));
    c.onsuccess = () => { const cur = c.result; if (!cur) return; s.put(cur.value, old + cur.key.slice(pre.length)); s.delete(cur.key); moved++; cur.continue(); }; t.oncomplete = ok; });
  src.tmpl = old + "{z}/{x}/{y}.pbf";
  localStorage.setItem("tf-offline-areas", JSON.stringify(areas));
  db.close();
  if (!moved) throw new Error("no saved tiles found to move");
  return `${moved} tiles moved`;
}));
await page.reload({ waitUntil: "domcontentloaded" }); await open(); await wait(20_000);   // offline.js writes its list of addresses after 16 s
offline = true; missing.clear();
await dropHttpCache();
await ctx.setOffline(true);
await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
await check("Earlier week's area with no signal: its map shows", async () => {
  await open(); await wait(6000); await fit(); await wait(4000);
  if (missing.size) throw new Error(`${missing.size} saved map tiles not found, e.g. ${[...missing][0]}`);
  // Asked for under this week's address, as the saved style says, past the browser's own cache (no-store).
  const got = await ev(async (b) => {
    const tj = await (await fetch("https://tiles.openfreemap.org/backup_planet", { cache: "no-store" })).json(), t = tj.tiles[0], z = 14, n = 2 ** z;
    const x = Math.floor(((b[1] + b[3]) / 2 + 180) / 360 * n), r = ((b[0] + b[2]) / 2) * Math.PI / 180, y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
    const res = await fetch(t.replace("{z}", z).replace("{x}", x).replace("{y}", y), { cache: "no-store" }).catch(() => null);
    return res && res.ok ? (await res.arrayBuffer()).byteLength : 0;
  }, BOX);
  if (!got) throw new Error("a saved tile asked for under this week's address isn't found");
});

await check("Signal back: the style that was on comes back", async () => {
  offline = false;
  await ctx.setOffline(false); await wait(1000);
  await ev(() => window.tfSetBasemap("topo", false)); await wait(1500);
  await ctx.setOffline(true); await wait(2500);
  if (await base() !== "vector") throw new Error("no signal didn't open the saved map");
  await ctx.setOffline(false); await wait(2500);
  const b = await base();
  if (b !== "topo") throw new Error(`back online the style is ${b}, not Topo`);
});

await browser.close(); server.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} of ${results.length} offline checks passed. Screenshots in ${OUT}/`);
process.exit(bad.length ? 1 : 0);
