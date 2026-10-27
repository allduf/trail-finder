// Phone test (see .github/workflows/phone-test.yml): opens the app at iPhone size in a real browser (WebKit, the engine
// Safari and the iPhone app use) and goes through every sport the way a rider would on a phone: pick the sport with the
// map's Sport button, then each tab of the bottom bar, Layers, and the 3D map; then ride.html. It fails when the
// page throws a script error, when a tap does nothing because something is broken, or when the page is wider than the
// phone (sideways scrolling). Screenshots of each step go in OUT, the results in the job summary.
//
// The page is served from this checkout on localhost, with the data jobs' files (scripts/site-data.sh get) when they
// are there; files it doesn't have come from the live site. Outside it, only the code libraries, fonts and the map
// pictures and heights (so the 3D map really draws, the heaviest thing on a phone) are fetched. Weather, Supabase,
// resort and club sites, webcams... are all cut off, so the test asks nobody anything and runs the same every time.
// Errors that only come from those cut-off downloads ("Load failed", "Failed to fetch") don't count.
//
// Run: node scripts/phone-test.mjs   (needs the playwright package and its WebKit, or BROWSER=chromium)
// Optional: BROWSER (webkit), OUT (phone-test-shots), SPORTS (mtb,ski,hunt,fish,moto), CHROMIUM (a Chromium to use).

import { createServer } from "node:http";
import { readFile, mkdir, appendFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const LIVE = "https://allduf.github.io/trail-finder/";
const BROWSER = process.env.BROWSER || "webkit";
const OUT = process.env.OUT || "phone-test-shots";
const SPORTS = (process.env.SPORTS || "mtb,ski,hunt,fish,moto").split(",").map((s) => s.trim()).filter(Boolean);
const NAMES = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", fish: "Fishing", moto: "Adventure moto" };
// Code libraries (the 3D map's MapLibre), fonts, and the map pictures and heights: everything else outside is cut off.
const ALLOWED = new Set(["unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com",
  "tile.openstreetmap.org", "tiles.openfreemap.org", "tiles.mapterhorn.com", "server.arcgisonline.com", "allduf.github.io"]);   // the last: Winter 3D photos
// alex's iPhone: 430 x 932 points (iPhone 15/16 Pro Max size).
const PHONE = {
  viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, hasTouch: true, ...(BROWSER === "chromium" ? { isMobile: true } : {}),
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  geolocation: { latitude: 50.1163, longitude: -122.9574 },   // Whistler village
  permissions: ["geolocation"], locale: "en-CA", timezoneId: "America/Vancouver",
  // The app's offline helper (sw.js) would fetch outside on its own, past the cut-off below (in WebKit).
  serviceWorkers: "block",
};
// A failed download of something cut off on purpose, not a fault of the app.
const NETWORK = /Load failed|Failed to fetch|NetworkError|network error|aborted|AbortError|ERR_FAILED|access control checks|Access-Control-Allow-Origin|Status code: \d{3}|Importing a module script failed|Could not connect/i;

// ---------- the site, on localhost ----------
const root = fileURLToPath(new URL("../", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".pbf": "application/x-protobuf" };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = normalize(join(root, path));
  try {
    if (!file.startsWith(root) || /^(\.git|\.github|scripts|supabase|ios-app)\//.test(path)) throw new Error("not served");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    try {
      // Last winter's photos (Skiing 3D) are their own site, next to this one.
      const r = await fetch(path.startsWith("trail-finder-winter/") ? new URL("../" + path, LIVE) : LIVE + path);
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502).end(); }
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const SITE = `http://localhost:${server.address().port}/`;

// ---------- the phone ----------
const pw = await import("playwright");
const browser = await pw[BROWSER].launch(BROWSER === "chromium" && process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
await mkdir(OUT, { recursive: true });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const results = [];   // { sport, step, ok, note, shot }

async function phone() {
  const ctx = await browser.newContext(PHONE);
  const blocked = new Set();
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost" || ALLOWED.has(u.hostname) || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    blocked.add(u.hostname);
    return route.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { const m = String(e.message || e); if (!NETWORK.test(m)) errors.push(m.split("\n")[0].slice(0, 200) + where(e)); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Uncaught errors also show here in some browsers; downloads that were cut off and the map library's tile errors don't count.
    if (NETWORK.test(t) || /Failed to load resource|AJAXError|tile|status of 4\d\d|status of 5\d\d|WebGL|GL_|Unrecognized feature/i.test(t)) return;
    errors.push("console: " + t.split("\n")[0].slice(0, 200));
  });
  page.on("crash", () => errors.push("the page crashed (out of memory?)"));
  return { ctx, page, errors, blocked };
}
function where(e) {
  const m = String(e.stack || "").match(/([\w.-]+\.(?:js|html))(?:\?[^:]*)?:(\d+)/);
  return m ? ` @${m[1]}:${m[2]}` : "";
}

// One step: run it, wait for the app to settle, screenshot, note the new errors and any sideways scrolling.
async function step(p, sport, name, fn, settle = 1500) {
  const before = p.errors.length;
  let note = "";
  try { await fn(); } catch (e) { note = String(e.message || e).split("\n")[0].replace(/\s+/g, " ").slice(0, 160); }
  await wait(settle);
  const wide = await p.page.evaluate(() => {
    const w = document.documentElement.scrollWidth, v = innerWidth;
    return w > v + 2 ? w - v : 0;
  }).catch(() => 0);
  const shot = `${sport}-${String(results.filter((r) => r.sport === sport).length + 1).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
  await p.page.screenshot({ path: join(OUT, shot) }).catch(() => {});
  const errs = p.errors.slice(before);
  const problems = [note, ...errs, wide ? `page is ${wide} px wider than the phone (sideways scrolling)` : ""].filter(Boolean);
  results.push({ sport, step: name, ok: !problems.length, note: problems.join(" · "), shot });
  console.log(`${problems.length ? "✗" : "✓"} ${NAMES[sport] || sport}: ${name}${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
}

const tap = (page, sel) => page.locator(sel).first().click({ timeout: 8000 });
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
// Closes whatever sheet or card a step opened: the app's own Back / close button, else Escape.
async function back(page) {
  for (const sel of ["#tabbar [data-nav=map]"]) if (await visible(page, sel)) { await tap(page, sel).catch(() => {}); return; }
  await page.keyboard.press("Escape").catch(() => {});
}

for (const sport of SPORTS) {
  const p = await phone();
  const { page } = p;
  await step(p, sport, "Open the app", async () => {
    await page.goto(SITE + "index.html", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("#sportMapBtn", { timeout: 30_000 });
  }, 4000);
  // Anything the app shows on a first open (What's new, tips) is closed like a rider would.
  await page.keyboard.press("Escape").catch(() => {});

  await step(p, sport, `Pick ${NAMES[sport]}`, async () => {
    await tap(page, "#sportMapBtn");
    await tap(page, `#sportMenu [data-sport=${sport}]`);
    await page.waitForFunction((s) => (document.getElementById("sport") || {}).value === s, sport, { timeout: 8000 });
  }, sport === "ski" ? 8000 : 4000);   // Skiing opens on the 3D map

  // The bottom bar's tabs this sport shows (Map, the sport's own Find/Routes/Hunt/Fish/Roads, Ride, Saved, More).
  const tabs = await page.$$eval("#tabbar button[data-nav]", (bs) => bs.filter((b) => b.offsetParent && getComputedStyle(b).display !== "none")
    .map((b) => ({ nav: b.dataset.nav, label: b.textContent.trim() })));
  if (!tabs.length) results.push({ sport, step: "Bottom bar", ok: false, note: "no tabs showing in the bottom bar", shot: "" });
  for (const t of tabs.filter((t) => t.nav !== "map")) {
    await step(p, sport, `Tab ${t.label}`, () => tap(page, `#tabbar [data-nav=${t.nav}]`));
    await back(page);
    await wait(500);
  }

  // Map buttons: Layers, then 3D (on and off).
  if (await visible(page, "#layersBtn")) {
    await step(p, sport, "Layers", () => tap(page, "#layersBtn"));
    await tap(page, "#layersBtn").catch(() => page.keyboard.press("Escape"));
    await wait(500);
  }
  if (await visible(page, "#btn3d")) {
    const on = await page.locator("#btn3d").first().getAttribute("aria-pressed") === "true";
    await step(p, sport, on ? "3D map off" : "3D map", () => tap(page, "#btn3d"), on ? 3000 : 8000);
    await step(p, sport, on ? "3D map back on" : "3D map off", () => tap(page, "#btn3d"), on ? 8000 : 3000);
  } else results.push({ sport, step: "3D button", ok: false, note: "the 3D button isn't showing", shot: "" });
  if (sport === "ski") await groundWhole(p);

  console.log(`    (cut off, as planned: ${[...p.blocked].sort().join(", ") || "nothing"})`);
  await p.ctx.close();
}

// Skiing 3D, Winter, at Kicking Horse's base, where last winter's photos have big cloudy holes (83% of one tile): the
// ground must be whole, never the blue sky showing through (alex's "broken mountains", 2026-10-27). Counts the
// screen pixels of the 3D map's sky colour (#9fb3c8) below the horizon.
async function groundWhole(p) {
  const { page } = p;
  await step(p, "ski", "3D ground has no holes (Kicking Horse)", async () => {
    const ok = await page.evaluate(() => !!(window.trailMap3d && document.querySelector("#btn3d.on")));
    if (!ok) throw new Error("the 3D map isn't on");
    await page.evaluate(() => window.trailMap3d.jumpTo({ center: [-117.06, 51.295], zoom: 13.5, pitch: 60, bearing: 260 }));
    await wait(25_000);
    const shot = (await page.screenshot()).toString("base64");
    const sky = await page.evaluate(async (b64) => {
      const img = await createImageBitmap(await (await fetch("data:image/png;base64," + b64)).blob());
      const cv = new OffscreenCanvas(img.width, img.height), cx = cv.getContext("2d");
      cx.drawImage(img, 0, 0);
      const y0 = Math.round(img.height * 0.3), y1 = Math.round(img.height * 0.65), d = cx.getImageData(0, y0, img.width, y1 - y0).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 159) < 9 && Math.abs(d[i + 1] - 179) < 9 && Math.abs(d[i + 2] - 200) < 9) n++;
      return n / (d.length / 4);
    }, shot);
    if (sky > 0.015) throw new Error(`${Math.round(sky * 100)}% of the ground shows the sky through holes`);
  }, 0);
}

// The ride page (My rides, recording) on its own.
{
  const p = await phone();
  await step(p, "ride", "Open My rides (ride.html)", () => p.page.goto(SITE + "ride.html#rides", { waitUntil: "domcontentloaded", timeout: 60_000 }), 4000);
  await p.ctx.close();
}
await browser.close();
server.close();

// ---------- report ----------
const bad = results.filter((r) => !r.ok);
const md = [`## 📱 Phone test (${BROWSER === "webkit" ? "Safari engine" : BROWSER}, iPhone ${PHONE.viewport.width}×${PHONE.viewport.height})`, "",
  bad.length ? `**${bad.length} problem${bad.length > 1 ? "s" : ""}** in ${results.length} steps.` : `**All ${results.length} steps passed** in ${SPORTS.length} sports and My rides.`, "",
  "| Sport | Step | Result |", "|---|---|---|",
  ...results.map((r) => `| ${NAMES[r.sport] || "My rides"} | ${r.step} | ${r.ok ? "✓" : "✗ " + r.note.replace(/\|/g, "\\|")} |`), "",
  "Screenshots of every step: the **phone-test-screenshots** download at the bottom of this run's page."].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n");
console.log(`\n${bad.length ? `${bad.length} problem(s)` : "All passed"} in ${results.length} steps.`);
process.exit(bad.length ? 1 : 0);
