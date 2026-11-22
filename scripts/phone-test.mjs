// Phone test (see .github/workflows/phone-test.yml): opens the app at iPhone size in a real browser (WebKit, the engine
// Safari and the iPhone app use) and goes through every sport the way a rider would on a phone: pick the sport with the
// map's Sport button, then each tab of the bottom bar, Layers, and the 3D map; then the page as the iPhone and Android
// apps open it ("App builds": no web 3D map on an iPhone build with native 3D only, Skiing on Winter); then ride.html.
// It fails when the page throws a script error, when a tap does nothing because something is broken, or when the page
// is wider than the phone (sideways scrolling). Screenshots of each step go in OUT, the results in the job summary.
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
import { readFile, readdir, mkdir, appendFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const LIVE = "https://allduf.github.io/trail-finder/";
const BROWSER = process.env.BROWSER || "webkit";
const OUT = process.env.OUT || "phone-test-shots";
const SPORTS = (process.env.SPORTS || "mtb,ski,hunt,fish,moto,hike").split(",").map((s) => s.trim()).filter(Boolean);
const NAMES = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", fish: "Fishing", moto: "Adventure moto", hike: "Hiking", app: "App builds", signin: "Sign-in check" };
// Code libraries (the 3D map's MapLibre), fonts, and the map pictures and heights: everything else outside is cut off.
const ALLOWED = new Set(["unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com",
  "tile.openstreetmap.org", "tiles.openfreemap.org", "tiles.mapterhorn.com", "ibasemaps-api.arcgis.com", "server.arcgisonline.com", "allduf.github.io"]);   // the last: Winter 3D photos
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
      const r = await fetch(/^trail-finder-winter2?\//.test(path) ? new URL("../" + path, LIVE) : LIVE + path);
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
  // The Today card opens by itself once a day (today.js): off here, so it can't cover a tap; the test opens it itself.
  await ctx.addInitScript(() => { try { localStorage.setItem("tf:todayAuto", "false"); } catch {} });
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
  // Each sport's own scripts load only when it's picked (winter.js): MTB opens without them.
  if (sport === "mtb") {
    const extra = await page.evaluate(() => ["tfHunt", "tfFish", "tfWebcams", "tfMoto"].filter((k) => window[k]));
    results.push({ sport, step: "Opens without the other sports' scripts", ok: !extra.length, note: extra.length ? `loaded anyway: ${extra.join(", ")}` : "", shot: "" });
  }
  // The one-time terms sheet (risk.js "Before you head out") is agreed to like a person would.
  // On a brand-new device the welcome opens right after I agree: wait for it so Escape below closes it.
  if (await page.locator("dialog.tf-terms [data-terms=ok]").click({ timeout: 6000 }).then(() => true, () => false))
    await page.waitForSelector("dialog.welc[open]", { timeout: 4000 }).catch(() => {});
  // Anything the app shows on a first open (What's new, tips) is closed like a rider would.
  await page.keyboard.press("Escape").catch(() => {});

  await step(p, sport, `Pick ${NAMES[sport]}`, async () => {
    await tap(page, "#sportMapBtn");
    await tap(page, `#sportMenu [data-sport=${sport}]`);
    await page.waitForFunction((s) => (document.getElementById("sport") || {}).value === s, sport, { timeout: 8000 });
  }, sport === "ski" ? 8000 : 4000);   // Skiing opens on the 3D map
  {
    const want = { ski: "tfWebcams", hunt: "tfHunt", fish: "tfFish", moto: "tfMoto", hike: "tfHike" }[sport];
    if (want) { const ok = await page.evaluate((k) => !!window[k], want); results.push({ sport, step: "Its own scripts loaded", ok, note: ok ? "" : `${want} missing after picking it`, shot: "" }); }
  }

  // Today, in this sport's own words (today.js; MTB: status.js's Where to ride today). The weather is cut off here,
  // so the card says so; it must open, fill its lists and close.
  await step(p, sport, "Today card", async () => {
    await page.evaluate(() => window.tfTodayOpen && window.tfTodayOpen());
    await page.waitForSelector(sport === "mtb" ? "dialog.today[open]" : "dialog.tdy[open]", { timeout: 5000 });
    if (sport !== "mtb") await page.waitForFunction(() => !document.querySelector("#tdySaved .tdy-wait") || !/Loading/.test(document.getElementById("tdySaved").textContent), null, { timeout: 30_000 });
  }, 1500);
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);

  // Adventure moto's Day ride (moto-day.js): the card opens, and Find loops answers with the route server cut off.
  if (sport === "moto") {
    await step(p, sport, "Day ride", async () => {
      await page.evaluate(() => window.tfMotoDay && window.tfMotoDay.open());
      await page.waitForSelector("#mtDay:not([hidden]) [data-d=find]", { timeout: 8000 });
      await page.locator("#mtDay [data-d=find]").click({ timeout: 8000 });
      await page.locator("#tfRisk [data-rk=ok]").click({ timeout: 4000 }).catch(() => {});   // the route risk note (risk.js), once
      await page.waitForFunction(() => { const o = document.getElementById("mdOut"); return o && o.textContent.trim() && !document.querySelector("#mdOut .md-wait"); }, null, { timeout: 60_000 });
    }, 1000);
    await page.evaluate(() => window.tfMotoDay && window.tfMotoDay.close());
  }

  // The bottom bar's tabs this sport shows (Map, the sport's own Find/Routes/Hunt/Fish/Roads, Ride, Saved, More).
  const tabs = await page.$$eval("#tabbar button[data-nav]", (bs) => bs.filter((b) => b.offsetParent && getComputedStyle(b).display !== "none")
    .map((b) => ({ nav: b.dataset.nav, label: b.textContent.trim() })));
  if (!tabs.length) results.push({ sport, step: "Bottom bar", ok: false, note: "no tabs showing in the bottom bar", shot: "" });
  for (const t of tabs.filter((t) => t.nav !== "map")) {
    await step(p, sport, `Tab ${t.label}`, () => tap(page, `#tabbar [data-nav=${t.nav}]`));
    await back(page);
    await wait(500);
  }

  // Offline maps from the Saved tab, no route needed (alex, 2026-10-31).
  if (tabs.some((t) => t.nav === "saved")) {
    await step(p, sport, "Saved → Offline maps", async () => {
      await tap(page, "#tabbar [data-nav=saved]");
      await tap(page, '#hub [data-hub="offline"]');
      await page.waitForSelector(".offline-card:not([hidden])", { state: "visible", timeout: 5000 });
    });
    await tap(page, ".offline-card [data-x]").catch(() => page.keyboard.press("Escape"));
    await back(page);
    await wait(500);
  }

  // More › Tutorials (tutorials.js, alex 2026-11-11): the list of videos opens; no video loads until one is tapped.
  // Each sport lists its own videos (2026-11-21), so it's tried in the sports that have one.
  if (tabs.some((t) => t.nav === "more") && await page.evaluate(() => !!(window.tfTutorials && (window.tfTutorials.hasFor ? window.tfTutorials.hasFor() : window.tfTutorials.list.length)))) {
    await step(p, sport, "More → Tutorials", async () => {
      await tap(page, "#tabbar [data-nav=more]");
      await tap(page, '#hub [data-hub="tutorials"]');
      await page.waitForSelector("dialog.tut[open] .tut-row", { state: "visible", timeout: 5000 });
    });
    await page.keyboard.press("Escape").catch(() => {});
    await back(page);
    await wait(500);
  }

  // Map buttons: Layers, then 3D (on and off).
  if (await visible(page, "#layersBtn")) {
    await step(p, sport, "Layers", () => tap(page, "#layersBtn"));
    await tap(page, "#layersBtn").catch(() => page.keyboard.press("Escape"));
    await wait(500);
    // Offline maps without a route (alex, 2026-10-31): the first row of Layers opens the Offline maps card.
    await step(p, sport, "Layers → Save this area offline", async () => {
      await tap(page, "#layersBtn");
      await tap(page, "#lmOffline");
      await page.waitForSelector(".offline-card:not([hidden])", { state: "visible", timeout: 5000 });
    });
    await tap(page, ".offline-card [data-x]").catch(() => page.keyboard.press("Escape"));
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

// ---------- App builds: never the old 3D map, and Skiing on Winter (alex 2026-11-21) ----------
// alex updated the iPhone app, and leaving 3D in Skiing showed summer Satellite, like an old version of the app: "I don't
// want that to happen again", "winter should always be by default in skiing". These checks open the page as the phone
// apps do, with a stand-in for the app (Capacitor and its TrailMap plugin, answering as an app build does), and fail if:
//  - native-map.js's FULL asks for a key the first iPhone builds with native 3D only (FIRST_FULL) don't report, or the
//    next build's NativeLayers.swift drops one of FULL's: those builds would go back to the web 3D map;
//  - on such an iPhone build any way into 3D (the 3D button, a two-finger tilt, another script clicking 3D) builds the
//    web 3D map, also when the native screen can't open, or 3D opens again by itself after Back;
//  - Skiing doesn't open on Winter (the flat map, native 3D, the web 3D photos) though a summer style was picked there
//    before: on the iPhone app, the Android app (alex's native 3D) and the website.
// The keys iPhone build 150 reports (TrailMap.features), the first with native 3D only (#871): never take one out.
const FIRST_FULL = { build: 150, keys: ["avy", "fingers", "fish", "fish-creeks", "fish-depth", "flyover", "ground", "hunt", "moto", "offline", "pins", "radar", "search", "smoke", "tools"] };
const APP_DIRS = { ios: "ios-app/plugins/TrailMap/ios/Sources/TrailMap", android: "android-app/plugins/TrailMap/android/src/main/java/com/allduf/trailmap" };
// The keys the next iPhone build reports: NativeLayers.all, each entry's own key (NativeOverlay(key:)) or its class's.
async function iosKeys() {
  const dir = join(root, APP_DIRS.ios), byClass = new Map();
  let list = "";
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".swift"))) {
    const t = await readFile(join(dir, f), "utf8");
    // A line taken out with a comment isn't in the build.
    if (f === "NativeLayers.swift") list = ((t.match(/static let all[^=]*=\s*\[([\s\S]*?)\n\s*\]/) || [])[1] || "").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const cls = [...t.matchAll(/\bclass (\w+)/g)];
    cls.forEach((c, i) => {
      const k = t.slice(c.index, i + 1 < cls.length ? cls[i + 1].index : t.length).match(/\blet key = "([^"]+)"/);
      if (k) byClass.set(c[1], k[1]);
    });
  }
  return new Set([...list.matchAll(/\{\s*(\w+)\((?:key:\s*"([^"]+)")?/g)].map((e) => e[2] || byClass.get(e[1])).filter(Boolean));
}
// The keys the Android build reports (TrailMapScreen.featureKeys): every layer's key() and the overlays'.
async function androidKeys() {
  const dir = join(root, APP_DIRS.android), keys = new Set();
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".java"))) {
    const t = await readFile(join(dir, f), "utf8");
    for (const m of t.matchAll(/String key\(\)\s*\{\s*return "([^"]+)";/g)) keys.add(m[1]);
    for (const m of t.matchAll(/new NativeOverlay\("([^"]+)"/g)) keys.add(m[1]);
  }
  return [...keys];
}
async function fullKeysCheck() {
  const m = (await readFile(join(root, "native-map.js"), "utf8")).match(/const FULL = (\[[^\]]*\]);/);
  const full = m ? JSON.parse(m[1]) : null, next = await iosKeys(), problems = [];
  if (!full) problems.push("FULL not found in native-map.js");
  else {
    const more = full.filter((k) => !FIRST_FULL.keys.includes(k));
    if (more.length) problems.push(`FULL asks for ${more.join(", ")}, which iPhone builds ${FIRST_FULL.build} and later don't report: they would go back to the web 3D map`);
    const gone = full.filter((k) => !next.has(k));
    if (gone.length) problems.push(`the next iPhone build (NativeLayers.swift) no longer draws ${gone.join(", ")}: it would open the web 3D map`);
  }
  results.push({ sport: "app", step: `iPhone builds ${FIRST_FULL.build}+ keep native 3D only`, ok: !problems.length, note: problems.join(" · "), shot: "" });
  console.log(`${problems.length ? "✗" : "✓"} App builds: iPhone builds ${FIRST_FULL.build}+ keep native 3D only${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
}
// In the page before its own scripts: Satellite picked before (in Skiing, the other sports and the Satellite button's
// "back to"), Summer or Live for Skiing's 3D photos, and (platform) the app's stand-in.
// window.__tm: what the page asked of TrailMap (opens), fail = open() refuses, fire(name, e) = an event from the app.
function appStandIn({ platform, keys, admin, photos }) {
  try {
    localStorage.setItem("tf:sport", JSON.stringify("ski"));
    for (const k of ["basemapSki", "basemap4", "basemapPrev"]) localStorage.setItem("tf:" + k, JSON.stringify("sat"));
    localStorage.setItem("tf:3dPhotosBy", JSON.stringify({ ski: photos }));
    localStorage.setItem("tf:appUpdateSeen", "99999:" + Date.now());   // no "new build" card over the map
    if (admin) localStorage.setItem("tf-admin", "1");
  } catch {}
  if (!platform) return;
  // screen: a native map is open (as TrailMapPlugin's own screen, it outlives a page reload: "tmLeft" in sessionStorage
  // has one left open by the page before).
  const tm = (window.__tm = { opens: [], fail: false, on: {}, closes: 0, screen: sessionStorage.getItem("tmLeft") === "1" });
  sessionStorage.removeItem("tmLeft");
  tm.fire = (name, e) => { if (name === "closed") tm.screen = false; (tm.on[name] || []).forEach((fn) => fn(e)); };
  const ok = (v) => Promise.resolve(v);
  const TrailMap = {
    features: () => ok({ keys }),
    // A build that reports "under" opens under the page when asked (and says so), as TrailMapPlugin does.
    // A screen already open only takes the new data and answers with nothing, as TrailMapPlugin does.
    open: (o) => {
      tm.opens.push(o);
      if (tm.fail) return Promise.reject(new Error("No screen to show the map on"));
      if (tm.screen) return ok(undefined);
      tm.screen = true;
      return ok(o.under && keys.includes("under") ? { under: true } : undefined);
    },
    update: () => ok(), offline: () => ok({ areas: {} }),
    layer: (o) => { (tm.layers = tm.layers || []).push(o); return ok(); },
    // As the app: the screen goes, and says so.
    close: () => { if (!tm.screen) return ok(); tm.closes++; setTimeout(() => { const c = window.tfLeaflet.getCenter(); tm.fire("closed", { lat: c.lat, lon: c.lng, zoom: 12, bearing: 0, details: false, layers: false, open: -1 }); }, 0); return ok(); },
    addListener: (name, fn) => { (tm.on[name] = tm.on[name] || []).push(fn); return ok({ remove() {} }); },
  };
  // The app's other plugins: every call answers with nothing.
  const other = () => new Proxy({}, { get: (_, k) => (k === "then" ? undefined : () => ok(k === "addListener" ? { remove() {} } : {})) });
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: (n) => n === "TrailMap",
    registerPlugin: (n) => (n === "TrailMap" ? TrailMap : other()), Plugins: { TrailMap } };
}
async function appBuild(kind) {
  const label = { ios: "iPhone app", iosu: "iPhone app, page over native 3D", android: "Android app", web: "Website" }[kind];
  const p = await phone(), { page } = p;
  // Anything that breaks outside a check (the page not loading) is one failed line, and the next build still runs.
  try {
    const keys = kind === "ios" ? FIRST_FULL.keys : kind === "iosu" ? [...(await iosKeys())] : kind === "android" ? await androidKeys() : null;
    await p.ctx.addInitScript(appStandIn, { platform: kind === "web" ? null : kind === "iosu" ? "ios" : kind, keys, admin: kind === "android" || kind === "iosu", photos: kind === "web" ? "live" : "sharp" });
    let n = 0;
    const check = async (name, fn) => {
      const before = p.errors.length;
      let note = "";
      try { const r = await fn(); if (typeof r === "string") note = r; } catch (e) { note = String(e.message || e).split("\n")[0].slice(0, 200); }
      note = [note, ...p.errors.slice(before)].filter(Boolean).join(" · ");
      const shot = `app-${kind}-${String(++n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.png`;
      await page.screenshot({ path: join(OUT, shot) }).catch(() => {});
      results.push({ sport: "app", step: `${label}: ${name}`, ok: !note, note, shot });
      console.log(`${note ? "✗" : "✓"} App builds: ${label}: ${name}${note ? "\n    " + note : ""}`);
    };
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const until = (fn, arg, ms = 8000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });
    const base = () => ev(() => (document.getElementById("basemap") || {}).value);
    // The web 3D map on screen; on the iPhone, also ever built (Android's testers check builds it first).
    const web3d = () => ev((ever) => !!((ever && window.tf3dGl && window.tf3dGl()) || document.querySelector(".is3d")), kind === "ios");
    const opens = () => ev(() => window.__tm.opens.length);
    const noWeb3d = async (what) => { await wait(2500); if (await web3d()) throw new Error(`${what} built the web 3D map`); };
    const back = () => ev(() => { const c = window.tfLeaflet.getCenter(); window.__tm.fire("closed", { lat: c.lat, lon: c.lng, zoom: 12, bearing: 0, details: false, layers: false, open: -1 }); });
    // act() must open native 3D, in 3D, on Winter, and not the web 3D map; Back after it either way, so one failure
    // doesn't fail the next checks too.
    const nativeOpen = async (what, act, stay = false) => {
      const before = await opens();
      try {
        await act();
        await until((c) => window.__tm.opens.length > c, before, 5000).catch(() => {});
        const o = await ev((c) => window.__tm.opens[c] || null, before);
        if (!o) throw new Error(`${what} didn't open native 3D`);
        if (!o.threeD || o.base !== "winter" || !o.winter) throw new Error(`${what} opened native 3D on "${o.base}"${o.threeD ? "" : " (flat)"}, not Winter`);
        await noWeb3d(what);
      } finally { if (!stay) await back(); }
    };
    const tap3d = () => page.locator("#btn3d").first().click({ timeout: 8000 });
    const sport = (s) => ev((s) => { const el = document.getElementById("sport"); el.value = s; el.dispatchEvent(new Event("change")); }, s);
    const flatWinter = async (when) => {
      await until(() => document.body.classList.contains("sport-ski") && (document.getElementById("basemap") || {}).value === "winter", null, 10_000).catch(() => {});
      const b = await base();
      if (b !== "winter") throw new Error(`the flat map ${when} is "${b}", not Winter`);
    };
    // The web 3D map's photos: the style button that's on.
    const photos3d = async () => {
      await until(() => [...document.querySelectorAll(".maplibregl-ctrl-group button[data-on]")].length > 0, null, 30_000).catch(() => {});
      return ev(() => [...document.querySelectorAll(".maplibregl-ctrl-group button[data-on]")].map((b) => b.textContent).join(", ") || "none");
    };

    await page.goto(SITE + "index.html", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("#sportMapBtn", { timeout: 30_000 });
    if (await page.locator("dialog.tf-terms [data-terms=ok]").click({ timeout: 6000 }).then(() => true, () => false)) await wait(500);
    await page.keyboard.press("Escape").catch(() => {});
    await check("Skiing opens on Winter (Satellite picked there before)", () => flatWinter("at start"));
    if (kind === "ios") {
      await check("native 3D only on this build", async () => {
        await until(() => window.tfNative && window.tfNative.full && window.tfNative.full(), null, 8000).catch(() => {});
        if (!(await ev(() => !!(window.tfNative && window.tfNative.full && window.tfNative.full())))) throw new Error(`the page doesn't treat iPhone build ${FIRST_FULL.build}'s keys as native 3D only`);
        await noWeb3d("Skiing's own 3D at start");
        if (await opens()) throw new Error("native 3D opened by itself at start (Skiing starts on the flat map)");
      });
      await check("3D button opens native 3D on Winter", () => nativeOpen("the 3D button", tap3d, true));
      await check("Back keeps Winter, nothing reopens by itself", async () => {
        const n0 = await opens();
        await back(); await wait(3000);
        if (await opens() !== n0) throw new Error("3D opened again by itself after Back");
        await flatWinter("after Back"); await noWeb3d("Back");
      });
      await check("two-finger tilt opens native 3D", () => nativeOpen("the tilt", () => ev(() => window.tfTilt3d.go())));
      await check("another script's 3D opens native 3D", () => nativeOpen("a script clicking 3D", () => ev(() => document.getElementById("btn3d").click())));
      await check("native 3D can't open: the flat map stays", async () => {
        const n0 = await opens();
        await ev(() => { window.__tm.fail = true; });
        try {
          await tap3d();
          await until((c) => window.__tm.opens.length > c, n0, 5000).catch(() => {});
          await noWeb3d("a native 3D that couldn't open");
        } finally { await ev(() => { window.__tm.fail = false; }); }
        if (await opens() === n0) throw new Error("the 3D button asked for nothing");
        if (!(await ev(() => /3D didn't open/.test((document.getElementById("tfToast") || {}).textContent || "")))) throw new Error("no note that 3D didn't open");
      });
      await check("Skiing again after another sport: Winter", async () => {
        await ev(() => { const s = document.getElementById("basemap"); s.value = "sat"; s.dispatchEvent(new Event("change")); });
        await sport("mtb"); await wait(2500); await sport("ski");
        await flatWinter("back in Skiing");
        await nativeOpen("the 3D button back in Skiing", tap3d);
      });
    } else if (kind === "iosu") {
      // alex 2026-11-22: "i want to keep the same interface for both i never want the map to switch from web to native
      // map", then one map on Winter ("Can we just do that with the winter map for now?"). On the next iPhone build (it
      // reports "under" and "flat"), Skiing's 2D on Winter is native 3D under the page seen from above: the page's own
      // buttons stay on top, 3D tips it up in place and "2D map" tips it down, a native tap opens the page's card, and
      // another style brings back the page's own flat map (3D there is native 3D under the page, as before).
      const lastTilt = () => ev(() => { const l = (window.__tm.layers || []).filter((x) => x.key === "under" && /"tilt"/.test(x.data)).pop(); return l ? JSON.parse(l.data).tilt : null; });
      const b3Text = () => ev(() => document.getElementById("btn3d").textContent.trim());
      const isUnder = () => ev(() => document.documentElement.classList.contains("tf-under"));
      await check("Winter's 2D is the native map seen from above, under the page's own buttons", async () => {
        await until(() => window.tfNative && window.tfNative.has && window.tfNative.has("flat"), null, 8000).catch(() => {});
        await until(() => window.__tm.opens.length > 0 && document.documentElement.classList.contains("tf-under"), null, 8000).catch(() => {});
        const o = await ev(() => window.__tm.opens[0] || null);
        if (!o) throw new Error("Winter's 2D didn't open the native map");
        if (!o.flat || !o.under || !o.threeD || o.base !== "winter") throw new Error(`the native map opened ${JSON.stringify({ flat: o.flat, under: !!o.under, threeD: o.threeD, base: o.base })}, not flat under the page on Winter`);
        if (!(await isUnder())) throw new Error("the page didn't hide its flat map");
        if (/2D/.test(await b3Text())) throw new Error("the 3D button reads 2D map on the map seen from above");
        const g = JSON.parse(o.under);
        if (!(g.c > 0 && g.r > 0 && g.m.length === g.c * g.r)) throw new Error("the page's grid of its buttons is malformed");
        await noWeb3d("Winter's 2D");
      });
      await check("3D tips the one map up in place, 2D map tips it back down", async () => {
        const n0 = await opens();
        await tap3d(); await wait(400);
        if ((await lastTilt()) !== true) throw new Error("3D didn't tip the native map up");
        if (!/2D/.test(await b3Text())) throw new Error(`the 3D button reads "${await b3Text()}", not 2D map`);
        const r = await ev(() => {
          const out = [], b3 = document.getElementById("btn3d"), lb = document.getElementById("layersBtn");
          for (const el of [b3, lb]) {
            const q = el.getBoundingClientRect(), x = q.left + q.width / 2, y = q.top + q.height / 2;
            if (!el.contains(document.elementFromPoint(x, y))) out.push(`#${el.id} isn't on top`);
          }
          const tile = window.tfLeaflet.getPane("tilePane");
          if (tile && getComputedStyle(tile).visibility !== "hidden") out.push("the flat map's pictures still show over the native map");
          return out.join(" · ");
        });
        if (r) throw new Error(r);
        const g = JSON.parse(await ev(() => { const l = (window.__tm.layers || []).filter((x) => x.key === "under" && /"m"/.test(x.data)).pop(); return l ? l.data : window.__tm.opens[0].under; }));
        const at = await ev(() => { const q = document.getElementById("btn3d").getBoundingClientRect(); return [q.left + q.width / 2, q.top + q.height / 2]; });
        if (g.m[Math.floor(at[1] / g.s) * g.c + Math.floor(at[0] / g.s)] !== "0") throw new Error("the grid gives the 3D button's touches to the native map");
        if (g.m[Math.floor(g.r / 2) * g.c + Math.floor(g.c / 2)] !== "1") throw new Error("the grid keeps the middle of the map from the native map");
        await ev(() => { const c = window.tfLeaflet.getCenter(); window.__tm.fire("tap", { open: -1, tapLat: c.lat, tapLon: c.lng }); });
        await wait(500);
        await tap3d(); await wait(400);
        if ((await lastTilt()) !== false) throw new Error("2D map didn't tip the native map back down");
        if (/2D/.test(await b3Text())) throw new Error("the 3D button didn't come back");
        if (await opens() !== n0 || (await ev(() => window.__tm.closes)) > 0) throw new Error("the map was swapped, not tipped");
        if (!(await isUnder())) throw new Error("the page's own flat map came back");
        await noWeb3d("3D on the one map");
      });
      await check("a tilt by fingers on the native map turns the button", async () => {
        const c = await ev(() => { const c = window.tfLeaflet.getCenter(); return { lat: c.lat, lon: c.lng, zoom: window.tfLeaflet.getZoom() - 1, bearing: 0 }; });
        await ev((c) => window.__tm.fire("moved", { ...c, pitch: 45 }), c); await wait(200);
        if (!/2D/.test(await b3Text())) throw new Error("tilted by fingers, the button doesn't read 2D map");
        await ev((c) => window.__tm.fire("moved", { ...c, pitch: 0 }), c); await wait(200);
        if (/2D/.test(await b3Text())) throw new Error("flat again, the button still reads 2D map");
      });
      await check("another style: the page's own flat map, its 3D native under the page", async () => {
        await ev(() => { const s = document.getElementById("basemap"); s.value = "topo"; s.dispatchEvent(new Event("change")); });
        await until(() => !document.documentElement.classList.contains("tf-under"), null, 5000).catch(() => {});
        if (await isUnder()) throw new Error("Topo picked: the native map seen from above stayed");
        const n0 = await opens();
        await tap3d();
        await until((n) => window.__tm.opens.length > n && document.documentElement.classList.contains("tf-under"), n0, 5000).catch(() => {});
        const o = await ev(() => window.__tm.opens[window.__tm.opens.length - 1]);
        if (await opens() === n0 || o.flat || !o.under) throw new Error("3D on Topo didn't open native 3D under the page");
        const c0 = await ev(() => window.__tm.closes);
        await tap3d();
        await until((c) => window.__tm.closes > c && !document.documentElement.classList.contains("tf-under"), c0, 5000).catch(() => {});
        if (await isUnder()) throw new Error("2D map on Topo didn't go back to the page's flat map");
        await ev(() => { const s = document.getElementById("basemap"); s.value = "winter"; s.dispatchEvent(new Event("change")); });
        await until(() => document.documentElement.classList.contains("tf-under") && window.__tm.opens[window.__tm.opens.length - 1].flat, null, 5000).catch(() => {});
        if (!(await isUnder())) throw new Error("Winter again: the one map didn't come back");
        await noWeb3d("another style");
      });
      // The app's native map outlives a page reload (the language switch reloads): the new page closes the one left
      // open, then Winter's one map opens under it again (alex 2026-11-22: after switching to French, 3D and the tilt did nothing).
      await check("after a reload with the native map left open, it opens under the page again", async () => {
        await ev(() => sessionStorage.setItem("tmLeft", "1"));
        await page.reload();
        await until(() => window.__tm && window.tfLeaflet && document.getElementById("btn3d"), null, 20_000);
        await until(() => window.__tm.closes > 0, null, 5000).catch(() => {});
        if (!(await ev(() => window.__tm.closes > 0))) throw new Error("the new page didn't close the native map left open");
        await until(() => document.documentElement.classList.contains("tf-under"), null, 8000).catch(() => {});
        if (!(await isUnder())) throw new Error("the one map didn't open under the page after the reload");
        await tap3d(); await wait(400);
        if ((await lastTilt()) !== true) throw new Error("3D didn't tip the native map after the reload");
        await tap3d(); await wait(400);   // back to the map seen from above: another sport then brings back the flat map
      });
      // Adventure moto's stops and roads reach native 3D (native-moto.js asks moto.js's tfMoto.native3d). They sat in the
      // wrong object for two days and the native map drew no gas, camps or hot springs (alex 2026-11-22: "Moto mode
      // don't show on map"): the page's pins show, so native 3D must get them too.
      await check("Adventure moto's stops, roads and filled areas go to native 3D", async () => {
        await sport("moto");
        await until(() => window.tfMoto && document.body.classList.contains("sport-moto"), null, 15_000).catch(() => {});
        await ev(() => { window.tfLeaflet.setView([50.0, -123.1], 10, { animate: false }); });
        await until(() => document.querySelectorAll(".mt-pin").length > 0, null, 30_000).catch(() => {});
        const pins = await ev(() => document.querySelectorAll(".mt-pin").length);
        if (!(await ev(() => !!(window.tfMoto && typeof window.tfMoto.native3d === "function")))) throw new Error("tfMoto.native3d is missing: native 3D gets nothing for Moto");
        try {
          // Filled areas (Where you can't ride, red at 12 %) go filled too, as on the flat map (builds from 2026-11-22 draw
          // tf-fill): one such area is put on the flat map here, so the check doesn't wait on the parks data.
          await ev(() => { const c = window.tfLeaflet.getCenter(); window.__tfFillTest = L.polygon([[c.lat - 0.05, c.lng - 0.05], [c.lat - 0.05, c.lng + 0.05], [c.lat + 0.05, c.lng]], { color: "#e03131", weight: 2, fillColor: "#e03131", fillOpacity: 0.12, interactive: false }).addTo(window.tfLeaflet); });
          const n0 = await opens();
          await tap3d();
          await until((c) => window.__tm.opens.length > c, n0, 5000).catch(() => {});
          const o = await ev((c) => { const x = window.__tm.opens[c]; return x ? { moto: (x.layers || {}).moto || null, fills: (JSON.parse(x.lines || "{}").features || []).filter((f) => f.properties.fa === 0.12 && f.properties.fc === "#e03131" && f.geometry.type === "MultiPolygon").length } : null; }, n0);
          if (!o) throw new Error("3D didn't open native 3D in Moto");
          // iPhone builds without "moto-safe" closed on Moto's layer (2026-11-22): they must get none (native-moto.js);
          // the data itself is still checked, as the page would send it to a build that has the fix.
          const safe = await ev(() => window.tfNative.has("moto-safe"));
          if (!safe && o.moto) throw new Error("Moto's layer went to an iPhone build without moto-safe (it closes the app)");
          if (safe && !o.moto) throw new Error("native 3D opened with no Moto layer (no stops, no roads)");
          const d = safe ? JSON.parse(o.moto) : await ev(() => window.tfMoto.native3d());
          if (pins && !(d.pts && d.pts.length)) throw new Error(`the page shows ${pins} stops, native 3D got none`);
          if (!Array.isArray(d.pts)) throw new Error("native 3D got Moto with no list of stops");
          if (!o.fills) throw new Error("a filled area on the flat map (as Where you can't ride) went to native 3D as an outline only");
        } finally {
          await ev(() => { if (window.__tfFillTest) window.__tfFillTest.remove(); });
          if (await ev(() => document.documentElement.classList.contains("tf-under"))) { await tap3d(); await until(() => !document.documentElement.classList.contains("tf-under"), null, 4000).catch(() => {}); }
          else await back();
        }
      });
      // Layers the website's 3D map draws must reach native 3D too (alex 2026-11-22: "we lost a lot of things that work
      // on the web version"): Hiking's slope angle and Skiing's heatmap go as native-ground.js pictures.
      await check("Hiking's slope angle and Skiing's heatmap go to native 3D", async () => {
        if (!(await ev(() => !!(window.tfGround && window.tfGround.skiheat && window.tfGround.skiheat.paint)))) throw new Error("Skiing's heatmap isn't offered to native 3D (tfGround.skiheat)");
        await sport("hike");
        await until(() => document.body.classList.contains("sport-hike") && window.tfGround && window.tfGround["hike-slope"], null, 15_000).catch(() => {});
        await ev(() => { window.tfLeaflet.setView([50.06, -122.95], 12, { animate: false }); });
        const turned = await ev(() => {
          const i = document.querySelector('#hkLayerList input[data-layer="slope"]');
          if (!i) return false;
          if (!i.checked) { i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true })); }
          return true;
        });
        if (!turned) throw new Error("Hiking's Slope angle switch wasn't found");
        const n0 = await opens();
        await tap3d();
        await until((c) => window.__tm.opens.length > c, n0, 5000).catch(() => {});
        const g = await ev((c) => { const x = window.__tm.opens[c]; return x ? (x.layers || {}).ground || "" : null; }, n0);
        try {
          if (g === null) throw new Error("3D didn't open native 3D in Hiking");
          const ids = (g ? JSON.parse(g).layers || [] : []).map((l) => l.id);
          if (!ids.includes("hike-slope")) throw new Error(`native 3D opened without Hiking's slope angle (got: ${ids.join(", ") || "nothing"})`);
        } finally {
          await ev(() => { const i = document.querySelector('#hkLayerList input[data-layer="slope"]'); if (i && i.checked) { i.checked = false; i.dispatchEvent(new Event("change", { bubbles: true })); } });
          if (await ev(() => document.documentElement.classList.contains("tf-under"))) { await tap3d(); await until(() => !document.documentElement.classList.contains("tf-under"), null, 4000).catch(() => {}); }
          else await back();
        }
      });
    } else if (kind === "android") {
      // Testers: the web 3D map (Android's native 3D is alex's only for now). friends.js keeps "tf-admin" for alex's
      // account only, so it's set again just before alex's tap.
      await check("testers' 3D (web) opens on Winter", async () => {
        await ev(() => localStorage.removeItem("tf-admin"));
        // alex's one map on Winter (this stand-in starts as alex) closes first: a tester never has it.
        if (await ev(() => window.__tm.screen)) { await back(); await wait(1200); }
        const n0 = await opens();
        await until(() => !!document.querySelector(".is3d"), null, 15_000).catch(() => {});   // Skiing opens in 3D here
        if (!(await web3d())) { await tap3d(); await until(() => !!document.querySelector(".is3d"), null, 15_000).catch(() => {}); }
        if (await opens() !== n0) { await back(); throw new Error("a tester's 3D opened native 3D"); }
        if (!(await web3d())) throw new Error("3D didn't open");
        const on = await photos3d();
        if (on !== "Winter") throw new Error(`the web 3D map opened on ${on}, not Winter`);
      });
      if (await web3d()) { await tap3d().catch(() => {}); await until(() => !document.querySelector(".is3d"), null, 8000).catch(() => {}); }
      await check("alex's native 3D opens on Winter", () => nativeOpen("the 3D button", async () => { await ev(() => localStorage.setItem("tf-admin", "1")); await tap3d(); }));
      // A fresh install with avalanche on: the build says it draws ground and avalanche, so native 3D opens, not the
      // web 3D map (side-by-side test 2026-11-22: Skiing on alex's Android opened the web 3D map every time).
      await check("alex's native 3D opens with avalanche on, on a fresh install", () => nativeOpen("the 3D button with avalanche on", async () => {
        await ev(() => { localStorage.setItem("tf-admin", "1"); localStorage.removeItem("tf-native-ground"); localStorage.removeItem("tf-native-avy"); localStorage.setItem("tf:avy", "true"); });
        await tap3d();
      }).finally(() => ev(() => localStorage.removeItem("tf:avy")).catch(() => {})));
    } else {
      await check("3D photos are Winter (Live picked there before)", async () => {
        await until(() => !!document.querySelector(".is3d"), null, 15_000).catch(() => {});
        if (!(await web3d())) await page.locator("#btn3d").first().click({ timeout: 8000 });
        const on = await photos3d();
        if (on !== "Winter") throw new Error(`the 3D map opened on ${on}, not Winter`);
      });
    }
  } catch (e) {
    const note = String(e.message || e).split("\n")[0].slice(0, 200);
    results.push({ sport: "app", step: `${label}: the page`, ok: false, note, shot: "" });
    console.log(`✗ App builds: ${label}: the page\n    ${note}`);
  } finally { await p.ctx.close().catch(() => {}); }
}
await fullKeysCheck().catch((e) => results.push({ sport: "app", step: `iPhone builds ${FIRST_FULL.build}+ keep native 3D only`, ok: false, note: String(e.message || e).slice(0, 200), shot: "" }));
for (const kind of ["ios", "iosu", "android", "web"]) await appBuild(kind);

// The ride page (My rides, recording) on its own.
{
  const p = await phone();
  await step(p, "ride", "Open My rides (ride.html)", () => p.page.goto(SITE + "ride.html#rides", { waitUntil: "domcontentloaded", timeout: 60_000 }), 4000);
  await p.ctx.close();
}

// Sign-in person check (CAPTCHA on in Supabase since 2026-11-21): on every page with a sign-in box, Sign in, Create an
// account and Email me a code each send Cloudflare's answer, and a refused one shows our own words, never Supabase's.
// Cloudflare's script is a stand-in that answers at once; Supabase's sign-in addresses are answered here, nothing is sent.
for (const file of ["index.html", "ride.html", "usage.html"]) {
  const p = await phone(), { page } = p;
  const sent = [];
  await page.route("https://challenges.cloudflare.com/**", (r) => r.fulfill({ contentType: "text/javascript", body: `window.turnstile = { n: 0,
    render(el, o) { this.o = o; setTimeout(() => o.callback("stand-in-" + ++this.n), 50); return "w"; },
    reset() { setTimeout(() => this.o.callback("stand-in-" + ++this.n), 50); } };` }));
  await page.route(/supabase\.co\/auth\/v1\/(token|signup|otp)/, (r) => {
    const b = JSON.parse(r.request().postData() || "{}");
    sent.push({ what: new URL(r.request().url()).pathname.split("/").pop(), token: !!(b.gotrue_meta_security && b.gotrue_meta_security.captcha_token) });
    r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: 400, error_code: "captcha_failed", msg: "captcha protection: request disallowed (stand-in)" }) });
  });
  const flow = (name, act) => step(p, "signin", `${file}: ${name} sends the person check`, async () => {
    const n = sent.length;
    await act();
    for (let i = 0; i < 60 && sent.length === n; i++) await wait(250);
    const s = sent[n];
    if (!s) throw new Error("nothing was sent to Supabase");
    if (!s.token) throw new Error(`${s.what} was sent without Cloudflare's answer`);
    await wait(300);
    const msg = await page.textContent("#acctMsg");
    if (/captcha protection|captcha_token/i.test(msg)) throw new Error(`a refused check shows Supabase's own words: "${msg}"`);
  }, 300);
  await step(p, "signin", `${file}: open the sign-in box`, async () => {
    await page.goto(SITE + file, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => window.tfAccount && window.tfAccount.open, null, { timeout: 30_000 });
    await page.locator("dialog.tf-terms [data-terms=ok]").click({ timeout: 3000 }).catch(() => {});
    await page.evaluate(() => window.tfAccount.open());
    await page.waitForSelector("#acctEmail", { state: "visible", timeout: 8000 });
    await page.evaluate(() => { const h = document.getElementById("acctHave"); if (h && !h.hidden) h.click(); });
    await page.fill("#acctEmail", "probe@example.com");
    await page.fill("#acctPass", "probe-password-1");
  });
  await flow("Sign in", () => page.click("#acctSend"));
  await flow("Email me a code", () => page.click("#acctLink"));
  await flow("Create an account", async () => { await page.click("#acctNew"); await page.fill("#acctPass", "probe-password-1"); await page.click("#acctSend"); });
  await p.ctx.close();
}
await browser.close();
server.close();

// ---------- report ----------
const bad = results.filter((r) => !r.ok);
const md = [`## 📱 Phone test (${BROWSER === "webkit" ? "Safari engine" : BROWSER}, iPhone ${PHONE.viewport.width}×${PHONE.viewport.height})`, "",
  bad.length ? `**${bad.length} problem${bad.length > 1 ? "s" : ""}** in ${results.length} steps.` : `**All ${results.length} steps passed** in ${SPORTS.length} sports, App builds, My rides and the sign-in check.`, "",
  "| Sport | Step | Result |", "|---|---|---|",
  ...results.map((r) => `| ${NAMES[r.sport] || "My rides"} | ${r.step} | ${r.ok ? "✓" : "✗ " + r.note.replace(/\|/g, "\\|")} |`), "",
  "Screenshots of every step: the **phone-test-screenshots** download at the bottom of this run's page."].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n");
console.log(`\n${bad.length ? `${bad.length} problem(s)` : "All passed"} in ${results.length} steps.`);
process.exit(bad.length ? 1 : 0);
