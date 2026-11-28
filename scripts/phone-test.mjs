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
// "computer" (PART=computer, alex 2026-11-25: "can we test the same test on the computer test?") goes through the same
// steps on the website at computer size (1440 x 900, mouse, no touch): every sport, the side panel and the ☰ Menu (the
// computer's tabs), Layers, the 3D map, Skiing's 3D ground, the website opening Skiing on Winter, My rides and the sign-in
// check, then turning the 3D map with the mouse. Left to "phone" only, as they test the phone apps and not a page on a
// computer: the iPhone and Android stand-ins ("App builds": native 3D keys, iPhone app, Android app) and the test
// phones' usage check.
//
// Run: node scripts/phone-test.mjs   (needs the playwright package and its WebKit, or BROWSER=chromium)
// Optional: BROWSER (webkit), OUT (phone-test-shots), PART (phone, computer, or both), SPORTS (mtb,ski,hunt,fish,moto,hike),
// CHROMIUM (a Chromium to use).

import { createServer } from "node:http";
import { readFile, readdir, mkdir, appendFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRetry } from "./ci/fetch-retry.mjs";

const LIVE = "https://allduf.github.io/trail-finder/";
const BROWSER = process.env.BROWSER || "webkit";
const OUT = process.env.OUT || "phone-test-shots";
// PART: "phone" (every sport at iPhone size, App builds, My rides, sign-in) or "computer" (the website at computer size);
// both when not given. phone-test.yml runs them as two jobs side by side, "phone" and "computer" (alex 2026-11-25).
const PART = process.env.PART || "all";
const PHONE_PART = PART !== "computer", COMPUTER_PART = PART !== "phone";
const SPORTS = (process.env.SPORTS || "mtb,ski,hunt,fish,moto,hike").split(",").map((s) => s.trim()).filter(Boolean);
// The devices this run goes through: "phone" (iPhone size, touch) and "desk" (a computer: 1440 x 900, mouse).
const DEVICES = [PHONE_PART && "phone", COMPUTER_PART && "desk"].filter(Boolean);
const NAMES = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", fish: "Fishing", moto: "Adventure moto", hike: "Hiking", app: "App builds", signin: "Sign-in check", desk: "Computer", site: "Website" };
// Code libraries (the 3D map's MapLibre) and the map pictures and heights: everything else outside is cut off.
const ALLOWED = new Set(["unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com",
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
// A computer: the same place, language and blocks, a 1440 x 900 window, a mouse and no touch.
const DESK = (() => { const { hasTouch, isMobile, userAgent, viewport, deviceScaleFactor, ...rest } = PHONE; return { ...rest, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }; })();
// A failed download of something cut off on purpose, not a fault of the app.
const NETWORK = /Load failed|Failed to fetch|NetworkError|network error|aborted|AbortError|ERR_FAILED|access control checks|Access-Control-Allow-Origin|Status code: \d{3}|Importing a module script failed|Could not connect/i;

// ---------- the site, on localhost ----------
const root = fileURLToPath(new URL("../", import.meta.url));
const TYPES = { ".woff2": "font/woff2", ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
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
      const r = await fetchRetry(/^trail-finder-winter2?\//.test(path) ? new URL("../" + path, LIVE) : LIVE + path);
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

async function phone(opts = PHONE) {
  const ctx = await browser.newContext(opts);
  const desk = !opts.hasTouch;
  const blocked = new Set();
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost" || ALLOWED.has(u.hostname) || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    blocked.add(u.hostname);
    return route.abort();
  });
  // Older builds opened the Today card by itself once a day: kept off here (today.js now never pops up).
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
  return { ctx, page, errors, blocked, desk };
}
function where(e) {
  const m = String(e.stack || "").match(/([\w.-]+\.(?:js|html))(?:\?[^:]*)?:(\d+)/);
  return m ? ` @${m[1]}:${m[2]}` : "";
}

// One step: run it, wait for the app to settle, screenshot, note the new errors and any sideways scrolling.
async function step(p, sport, name, fn, settle = 1500) {
  // On a run of both parts, the computer's steps say so (their sports are the same as the phone's).
  if (p.desk && PART === "all" && sport !== "desk") name = "Computer: " + name;
  const before = p.errors.length;
  let note = "";
  try { await fn(); } catch (e) { note = String(e.message || e).split("\n")[0].replace(/\s+/g, " ").slice(0, 160); }
  await wait(settle);
  const wide = await p.page.evaluate(() => {
    const w = document.documentElement.scrollWidth, v = innerWidth;
    return w > v + 2 ? w - v : 0;
  }).catch(() => 0);
  const shot = `${sport}-${String(results.filter((r) => r.sport === sport).length + 1).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}.png`;
  await p.page.screenshot({ path: join(OUT, shot) }).catch(() => {});
  const errs = p.errors.slice(before);
  const problems = [note, ...errs, wide ? `page is ${wide} px wider than the ${p.desk ? "window" : "phone"} (sideways scrolling)` : ""].filter(Boolean);
  results.push({ sport, step: name, ok: !problems.length, note: problems.join(" · "), shot });
  console.log(`${problems.length ? "✗" : "✓"} ${NAMES[sport] || sport}: ${name}${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
}

// A result without a step of its own (a check read from the page), named like step()'s.
const note = (p, sport, name, ok, why) => results.push({ sport, step: p.desk && PART === "all" && sport !== "desk" ? "Computer: " + name : name, ok, note: ok ? "" : why, shot: "" });
const tap = (page, sel) => page.locator(sel).first().click({ timeout: 8000 });
const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
// Closes whatever sheet or card a step opened: the app's own Back / close button, else Escape.
async function back(page) {
  for (const sel of ["#tabbar [data-nav=map]"]) if (await visible(page, sel)) { await tap(page, sel).catch(() => {}); return; }
  await page.keyboard.press("Escape").catch(() => {});
}

// Every sport on the phone, then on a computer (the computer has no bottom bar: its side panel and ☰ Menu instead).
async function sportRun(sport, dev) {
  const desk = dev === "desk";
  const p = await phone(desk ? DESK : PHONE);
  const { page } = p;
  await step(p, sport, "Open the app", async () => {
    await page.goto(SITE + "index.html", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("#sportMapBtn", { timeout: 30_000 });
  }, 4000);
  // Each sport's own scripts load only when it's picked (winter.js): MTB opens without them.
  if (sport === "mtb") {
    const extra = await page.evaluate(() => ["tfHunt", "tfFish", "tfWebcams", "tfMoto"].filter((k) => window[k]));
    note(p, sport, "Opens without the other sports' scripts", !extra.length, `loaded anyway: ${extra.join(", ")}`);
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
    if (want) { const ok = await page.evaluate((k) => !!window[k], want); note(p, sport, "Its own scripts loaded", ok, `${want} missing after picking it`); }
  }

  // Today, in this sport's own words (today.js: a card in the sport's panel; MTB: status.js's Where to ride today).
  // The weather is cut off here, so the card says so; it must open and fill its lists.
  await step(p, sport, "Today card", async () => {
    await page.evaluate(() => window.tfTodayOpen && window.tfTodayOpen());
    await page.waitForSelector(sport === "mtb" ? "dialog.today[open]" : `.tdy.open[data-sp=${sport}]`, { timeout: 15000 });
    if (sport !== "mtb") await page.waitForFunction((s) => { const el = document.querySelector(`.tdy[data-sp=${s}] .tdy-saved`); return el && !/Loading/.test(el.textContent); }, sport, { timeout: 30_000 });
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

  if (!desk) {
    // The bottom bar's tabs this sport shows (Map, the sport's own Find/Routes/Hunt/Fish/Roads, Ride, Saved, More).
    const tabs = await page.$$eval("#tabbar button[data-nav]", (bs) => bs.filter((b) => b.offsetParent && getComputedStyle(b).display !== "none")
      .map((b) => ({ nav: b.dataset.nav, label: b.textContent.trim() })));
    if (!tabs.length) note(p, sport, "Bottom bar", false, "no tabs showing in the bottom bar");
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
  } else {
    // A computer: the sport's own page is in the side panel (the phone's sport tab), and ☰ Menu holds the phone's Ride,
    // Saved and More tabs in one list.
    await step(p, sport, "Side panel shows the sport's own page", async () => {
      const sel = sport === "mtb" ? "#trailQ" : `#${{ ski: "ski", hunt: "hunt", fish: "fish", moto: "moto", hike: "hike" }[sport]}Pane`;
      await page.waitForSelector(sel, { state: "visible", timeout: 10_000 });
      const w = await page.evaluate(() => { const a = document.querySelector("aside"); return a ? Math.round(a.getBoundingClientRect().width) : 0; });
      if (w < 200) throw new Error(`the side panel is ${w} px wide`);
    });
    await step(p, sport, "☰ Menu (Ride, Saved, More)", async () => {
      await tap(page, "#deskMenuBtn");
      await page.waitForSelector("#deskMenu:not([hidden]) .hub-card", { state: "visible", timeout: 5000 });
      const n = await page.$$eval("#deskMenu .hub-card", (c) => c.length);
      if (n < 4) throw new Error(`the menu shows only ${n} buttons`);
      // The menu stays inside the window (it opens under its button).
      const off = await page.evaluate(() => { const r = document.getElementById("deskMenu").getBoundingClientRect(); return r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1; });
      if (off) throw new Error("the menu goes past the edge of the window");
    });
    await page.keyboard.press("Escape").catch(() => {});
    await wait(300);
    // Offline maps from ☰ Menu, as from the phone's Saved tab (alex, 2026-10-31).
    await step(p, sport, "☰ Menu → Offline maps", async () => {
      await tap(page, "#deskMenuBtn");
      await tap(page, '#deskMenu [data-hub="offline"]');
      await page.waitForSelector(".offline-card:not([hidden])", { state: "visible", timeout: 5000 });
    });
    await tap(page, ".offline-card [data-x]").catch(() => page.keyboard.press("Escape"));
    await wait(500);
    if (await page.evaluate(() => !!(window.tfTutorials && (window.tfTutorials.hasFor ? window.tfTutorials.hasFor() : window.tfTutorials.list.length)))) {
      await step(p, sport, "☰ Menu → Tutorials", async () => {
        await tap(page, "#deskMenuBtn");
        await tap(page, '#deskMenu [data-hub="tutorials"]');
        await page.waitForSelector("dialog.tut[open] .tut-row", { state: "visible", timeout: 5000 });
      });
      await page.keyboard.press("Escape").catch(() => {});
      await wait(500);
    }
    await step(p, sport, "How it works (opens, Got it closes)", async () => {
      await tap(page, "#aboutBtn");
      await page.waitForSelector("#about:not([hidden])", { state: "visible", timeout: 5000 });
      await tap(page, "#aboutClose");
      await page.waitForSelector("#about", { state: "hidden", timeout: 3000 });
    });
    await page.evaluate(() => { const a = document.getElementById("about"); if (a && !a.hidden) a.hidden = true; });   // so a failure above doesn't fail the next steps too
    await wait(300);
  }

  // Map buttons: Layers, then 3D (on and off).
  if (await visible(page, "#layersBtn")) {
    await step(p, sport, "Layers", () => tap(page, "#layersBtn"));
    await tap(page, "#layersBtn").catch(() => page.keyboard.press("Escape"));
    await wait(500);
    // Offline maps without a route (alex, 2026-10-31): the first row of Layers opens the Offline maps card. Phones only:
    // a computer's Layers has no such row (Offline maps is in ☰ Menu there, tried above).
    if (!desk) await step(p, sport, "Layers → Save this area offline", async () => {
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
  } else note(p, sport, "3D button", false, "the 3D button isn't showing");
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
    // Only the band below the horizon (30% to 65% of the height) is photographed and sent back to the page: a whole
    // 1440 x 900 screenshot as text, twice per run, helped the computer test run out of memory (2 GB) on 2026-11-26.
    const vp = page.viewportSize(), cy0 = Math.round(vp.height * 0.3), cy1 = Math.round(vp.height * 0.65);
    const shot = (await page.screenshot({ clip: { x: 0, y: cy0, width: vp.width, height: cy1 - cy0 } })).toString("base64");
    const sky = await page.evaluate(async (b64) => {
      const img = await createImageBitmap(await (await fetch("data:image/png;base64," + b64)).blob());
      const cv = new OffscreenCanvas(img.width, img.height), cx = cv.getContext("2d");
      cx.drawImage(img, 0, 0);
      const d = cx.getImageData(0, 0, img.width, img.height).data;
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
  const m = (await readFile(join(root, "native-map.js"), "utf8")).match(/const\s*FULL\s*=\s*(\[[^\]]*\]);/);   // spaces optional: the tests run on the trimmed copy (scripts/trim-site.mjs)
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
// Test phones send no usage (alex's Problems list, 2026-11-22): the side-by-side check's iPhone simulator and Android
// emulator open http://localhost:8080 (the Android phone check http://10.0.2.2:8080) and close the app on purpose, so
// usage.js read each restart as a crash: 25 "MTB · flat map" crashes in one day, none a real person's. usage.js runs
// here with a stand-in page, just after a restart: the live site must still report the crash, the test pages nothing.
async function testPhonesCheck() {
  const vm = await import("node:vm");
  const src = await readFile(join(root, "usage.js"), "utf8");
  const run = (url) => {
    const u = new URL(url), store = new Map([["tf:useAlive", String(Date.now() - 2000)], ["tf:useCtx", "mtb · flat map · Map tab"]]);
    const st = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
    const noop = () => {};
    const w = { localStorage: st, sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
      navigator: { webdriver: false, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)", onLine: false, maxTouchPoints: 5 },
      location: { protocol: u.protocol, hostname: u.hostname, pathname: u.pathname, href: url, search: "" },
      document: { currentScript: null, visibilityState: "visible", readyState: "loading", addEventListener: noop, getElementById: () => null, querySelector: () => null, body: { classList: { contains: () => false } } },
      addEventListener: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop, screen: { width: 440, height: 956 },
      crypto: { randomUUID: () => "00000000-0000-0000-0000-000000000000" }, performance: { now: () => 0, getEntriesByType: () => [] },
      fetch: () => Promise.resolve({ ok: true }), tfAccount: { enabled: true, url: "https://x", key: "k" },
      Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: {} } };
    w.window = w;
    vm.runInNewContext(src, w);
    return String(store.get("tf:useQueue") || "").includes('"k":"crash"');
  };
  const problems = [];
  if (!run("https://trailfinderapp.ca/")) problems.push("the app on trailfinderapp.ca no longer reports a crash restart");
  for (const u of ["http://localhost:8080/", "http://127.0.0.1:8080/", "http://10.0.2.2:8080/"]) if (run(u)) problems.push(`a test phone on ${u} sends usage (its restarts read as crashes)`);
  results.push({ sport: "app", step: "Test phones send no usage", ok: !problems.length, note: problems.join(" · "), shot: "" });
  console.log(`${problems.length ? "✗" : "✓"} App builds: test phones send no usage${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
}
// Usage never holds anything personal (2026-11-27: tapping the Account button stored the signed-in person's email,
// its tooltip). usage.js runs with a stand-in page; taps on the Account button, a cabin trip's names, a menu of names
// and a plain button, and an email, phone number and map point passed to tfUse, must reach the queue without them.
async function usagePrivateCheck() {
  const vm = await import("node:vm");
  const src = await readFile(join(root, "usage.js"), "utf8");
  const store = new Map(), clicks = [], noop = () => {};
  const st = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  // A tiny element: tag, attributes, text, children, parent (enough for closest, dataset, title and the text of a tap).
  const el = (tag, { id = "", cls = "", title = "", aria = "", text = "", kids = [] } = {}) => {
    const e = { tagName: tag.toUpperCase(), nodeType: 1, id, title, dataset: {}, parentElement: null,
      classList: { contains: (c) => cls.split(" ").includes(c) },
      getAttribute: (a) => (a === "aria-label" ? aria || null : null),
      childNodes: [...(text ? [{ nodeType: 3, nodeValue: text }] : []), ...kids] };
    kids.forEach((k) => { k.parentElement = e; });
    const all = (x) => [x, ...x.childNodes.filter((n) => n.nodeType === 1).flatMap(all)];
    e.innerText = e.textContent = all(e).map((x) => x.childNodes.filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join("")).join(" ");
    e.querySelector = (q) => all(e).slice(1).find((x) => q.split(",").some((t) => x.tagName === t.trim().toUpperCase())) || null;
    const match = (x, q) => q.split(",").map((t) => t.trim()).some((t) => (t.startsWith("#") ? x.id === t.slice(1)
      : t.startsWith(".") ? x.classList.contains(t.slice(1)) : t === "[id]" ? !!x.id : /^\[id\^=(\w+)\]$/.test(t) ? x.id.startsWith(t.match(/=(\w+)/)[1])
      : t.startsWith("[") ? false : x.tagName === t.toUpperCase()));
    e.closest = (q) => { for (let x = e; x; x = x.parentElement) if (match(x, q)) return x; return null; };
    return e;
  };
  const EMAIL = "someone.42@example.com";
  const acctBtn = el("button", { cls: "linkish acct-btn", title: EMAIL, text: "Account", kids: [el("span", { text: "S" })] });
  const nameBtn = el("button", { text: "Sam Person" });
  const iam = el("label", { text: "You are", kids: [el("select", { aria: "Who you are in this group", kids: [el("option", { text: "Sam Person" })] })] });
  const plain = el("button", { text: "Close" });
  el("div", { id: "panel", kids: [acctBtn, plain] });
  el("div", { id: "tpGroup", kids: [nameBtn] });
  el("div", { id: "skPlan", kids: [iam] });
  const w = { localStorage: st, sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: { webdriver: false, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)", onLine: false, maxTouchPoints: 5 },
    location: { protocol: "https:", hostname: "trailfinderapp.ca", pathname: "/", href: "https://trailfinderapp.ca/", search: "" },
    document: { currentScript: null, visibilityState: "visible", readyState: "loading", addEventListener: (t, f) => { if (t === "click") clicks.push(f); },
      getElementById: () => null, querySelector: () => null, body: { classList: { contains: () => false } } },
    addEventListener: noop, setInterval: noop, setTimeout: noop, clearTimeout: noop, screen: { width: 440, height: 956 },
    crypto: { randomUUID: () => "00000000-0000-0000-0000-000000000000" }, performance: { now: () => 0, getEntriesByType: () => [] },
    fetch: () => Promise.resolve({ ok: true }), tfAccount: { enabled: true, url: "https://x", key: "k" },
    Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios", Plugins: {} } };
  w.window = w;
  vm.runInNewContext(src, w);
  for (const b of [acctBtn, nameBtn, iam, plain]) clicks.forEach((f) => f({ target: { closest: (q) => b.closest(q) } }));
  w.tfUse("pick", `Find: ${EMAIL}`);
  w.tfUse("pick", "Find: call 604 555 1234");
  w.tfUse("pick", "Find: 50.11634, -122.95392");
  const q = JSON.parse(store.get("tf:useQueue") || "[]"), sent = q.map((e) => e.w || "").join(" | ");
  const problems = [];
  for (const [what, re] of [["an email", /@example|someone/], ["a person's name", /Sam|Person/], ["a phone number", /604|555|1234/], ["a map point", /50\.11|122\.95/]])
    if (re.test(sent)) problems.push(`usage holds ${what}: ${sent.slice(0, 200)}`);
  for (const want of ["Account (in #panel)", "Close (in #panel)", "item (in #tpGroup)"]) if (!q.some((e) => e.w === want)) problems.push(`tap "${want}" missing: ${sent.slice(0, 200)}`);
  results.push({ sport: "app", step: "Usage holds nothing personal", ok: !problems.length, note: problems.join(" · "), shot: "" });
  console.log(`${problems.length ? "✗" : "✓"} App builds: usage holds nothing personal${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
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
  // The app's other plugins: every call answers with nothing. App keeps the page's Back button listener (Android's
  // Back, native.js): window.__app.back(), and counts the times the page put the app away (minimizeApp).
  const other = () => new Proxy({}, { get: (_, k) => (k === "then" ? undefined : () => ok(k === "addListener" ? { remove() {} } : {})) });
  const app = (window.__app = { fns: [], minimized: 0, back: () => app.fns.forEach((f) => f({ canGoBack: history.length > 1 })) });
  const App = new Proxy({}, { get: (_, k) => (k === "then" ? undefined
    : k === "addListener" ? (name, fn) => { if (name === "backButton" && typeof fn === "function") app.fns.push(fn); return ok({ remove() {} }); }
    : k === "minimizeApp" ? () => { app.minimized++; return ok(); } : () => ok({})) });
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: (n) => n === "TrailMap",
    registerPlugin: (n) => (n === "TrailMap" ? TrailMap : n === "App" ? App : other()), Plugins: { TrailMap } };
}
// desk: the website (kind "web") at computer size, in the computer's run.
async function appBuild(kind, desk = false) {
  const label = desk ? "Website on a computer" : { ios: "iPhone app", iosu: "iPhone app, page over native 3D", android: "Android app", web: "Website" }[kind];
  const group = desk ? "site" : "app", line = desk ? "Website" : "App builds";
  const p = await phone(desk ? DESK : PHONE), { page } = p;
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
      const shot = `${group}-${kind}-${String(++n).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.png`;
      await page.screenshot({ path: join(OUT, shot) }).catch(() => {});
      results.push({ sport: group, step: `${label}: ${name}`, ok: !note, note, shot });
      console.log(`${note ? "✗" : "✓"} ${line}: ${label}: ${name}${note ? "\n    " + note : ""}`);
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
    // Low Power Mode (alex 2026-11-27, "How can we make sure that things like yesterday never happen again?"): on
    // 2026-11-26 alex's iPhone showed the page's buttons over a black native 3D map in every sport. When the native map
    // has drawn nothing 8 s after opening, the app says "notDrawn" (builds 204 / 141 on) and the page must go back to its
    // own flat map (shown, not hidden under the page), with a note naming Low Power Mode / Battery Saver, never the web
    // 3D map on the iPhone, not open native 3D again by itself, and a tap on 3D must try again. In every sport given.
    // The simulators' own run of this (a real map, power saving on) is .github/workflows/low-power.yml.
    const notDrawn = async (sports, admin = false) => {
      const out = [];
      const NOTE = kind === "android" ? /Battery Saver/ : /Low Power Mode/;
      for (const s of sports) {
        try {
          if (await ev(() => window.__tm.screen)) { await back(); await wait(600); }
          await sport(s);
          await until((s) => document.body.classList.contains("sport-" + s), s, 10_000).catch(() => {});
          await wait(1500);
          if (admin) await ev(() => localStorage.setItem("tf-admin", "1"));
          if (!(await ev(() => window.__tm.screen))) {
            const n0 = await opens();
            await tap3d();
            await until((c) => window.__tm.opens.length > c, n0, 5000).catch(() => {});
          }
          if (!(await ev(() => window.__tm.screen))) { out.push(`${s}: 3D didn't open native 3D`); continue; }
          const c0 = await ev(() => window.__tm.closes);
          await ev(() => { const t = document.getElementById("tfToast"); if (t) t.textContent = ""; window.__tm.fire("notDrawn", { lowPower: true }); });
          await until((c) => window.__tm.closes > c && !window.__tm.screen && !document.documentElement.classList.contains("tf-under"), c0, 5000).catch(() => {});
          const st = await ev(() => {
            const m = document.getElementById("map"), tile = window.tfLeaflet && window.tfLeaflet.getPane("tilePane");
            return { screen: window.__tm.screen, under: document.documentElement.classList.contains("tf-under"),
              mapShown: !!m && m.getClientRects().length > 0 && getComputedStyle(m).visibility !== "hidden" && !!tile && getComputedStyle(tile).visibility !== "hidden",
              note: ((document.getElementById("tfToast") || {}).textContent || "").trim() };
          });
          if (st.screen || st.under) { out.push(`${s}: the native map that drew nothing stayed up`); continue; }
          if (!st.mapShown) out.push(`${s}: the page's own flat map isn't shown`);
          if (!NOTE.test(st.note)) out.push(`${s}: no note naming ${kind === "android" ? "Battery Saver" : "Low Power Mode"} (note: "${st.note || "none"}")`);
          if (await web3d()) out.push(`${s}: the web 3D map opened`);
          const n1 = await opens();
          await wait(2500);
          if (await opens() !== n1) out.push(`${s}: native 3D opened again by itself`);
          await tap3d();
          await until((c) => window.__tm.opens.length > c, n1, 5000).catch(() => {});
          if (await opens() === n1) out.push(`${s}: a tap on 3D didn't try native 3D again`);
          if (await ev(() => window.__tm.screen)) await back();
          await wait(600);
        } catch (e) { out.push(`${s}: ${String(e.message || e).split("\n")[0].slice(0, 160)}`); }
      }
      if (out.length) throw new Error(out.join(" · "));
    };
    const ALL = ["mtb", "ski", "hike", "fish", "hunt", "moto"];

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
      await check("native map draws nothing (Low Power Mode), every sport: flat map back with a note", () => notDrawn(ALL));
      await check("native map draws nothing, power saving off: plain note", async () => {
        if (await ev(() => window.__tm.screen)) await back();
        await sport("mtb"); await wait(1500);
        const n0 = await opens();
        await tap3d();
        await until((c) => window.__tm.opens.length > c, n0, 5000).catch(() => {});
        if (!(await ev(() => window.__tm.screen))) throw new Error("3D didn't open native 3D");
        await ev(() => { const t = document.getElementById("tfToast"); if (t) t.textContent = ""; window.__tm.fire("notDrawn", { lowPower: false }); });
        await until(() => !window.__tm.screen, null, 5000).catch(() => {});
        const note = await ev(() => ((document.getElementById("tfToast") || {}).textContent || "").trim());
        if (!/couldn't draw on this phone/.test(note)) throw new Error(`note: "${note || "none"}"`);
        await sport("ski"); await wait(1500);
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
      // alex 2026-11-22: "I switched from skiing to hiking and still see all the skiing layer plus hiking points". Leaving
      // Skiing never leaves its Winter map on the native map: Hiking on its photos is the one map too (alex 2026-11-22,
      // Summer for Hiking, Fishing and Hunting), on Hiking's style; MTB (not one map) gets the page's own flat map; tipped
      // into 3D, native 3D stays (as in every sport) on the new sport's style.
      await check("Skiing to Hiking or MTB: no Winter left on the native map", async () => {
        // The native map's style now: the last base sent after an open, or that open's own.
        const nativeBase = () => ev(() => {
          const t = window.__tm, o = t.opens[t.opens.length - 1];
          const after = (t.layers || []).slice(o && o.__n != null ? o.__n : 0).filter((x) => x.key === "base");
          return after.length ? after[after.length - 1].data : o ? o.base : null;
        });
        await ev(() => { const t = window.__tm, op = t.open0 || (t.open0 = window.Capacitor.Plugins.TrailMap.open); window.Capacitor.Plugins.TrailMap.open = (o) => { o.__n = (t.layers || []).length; return op(o); }; });
        const check1 = async (what, wantUnder) => {
          await wait(2500);
          const u = await isUnder(), b = await nativeBase();
          if (wantUnder === false && u) throw new Error(`${what}: the native map seen from above stayed (on ${b})`);
          if (wantUnder === true && !u) throw new Error(`${what}: the one map didn't open`);
          if (u && b === "winter" && what !== "back in Skiing") throw new Error(`${what}: the native map is still on Skiing's Winter`);
        };
        await sport("hike"); await check1("Hiking", true);
        await sport("mtb"); await check1("MTB", false);
        await sport("ski"); await check1("back in Skiing", true);
        if ((await nativeBase()) !== "winter") throw new Error(`back in Skiing the native map is on ${await nativeBase()}, not Winter`);
        await tap3d(); await wait(400);
        await sport("hike"); await check1("Hiking from Skiing's 3D", null);
        await sport("ski"); await wait(1500);
        if (await isUnder() && /2D/.test(await b3Text())) { await tap3d(); await wait(400); }
      });
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
        // Counted before the switch goes on: an open of the one map right after it (Hiking's own, a moment after the sport
        // changes) carries the slope angle in its layers, and counts.
        const n0 = await opens(), l0 = await ev(() => (window.__tm.layers || []).length);
        const turned = await ev(() => {
          const i = document.querySelector('#hkLayerList input[data-layer="slope"]');
          if (!i) return false;
          if (!i.checked) { i.checked = true; i.dispatchEvent(new Event("change", { bubbles: true })); }
          return true;
        });
        if (!turned) throw new Error("Hiking's Slope angle switch wasn't found");
        await tap3d();
        await until((c) => window.__tm.opens.length > c, n0, 5000).catch(() => {});
        // Hiking on its photos is the one map (native under the page, seen from above, since #930): 3D tips it up without
        // a new open. The slope angle reaches native 3D either in an open's own layers (read at that open) or in a
        // "ground" change sent to an open map, which can take a few seconds on a busy test machine: every one of those
        // since the switch went on counts, up to 20 s (only the first open's was read before, and a change sent after
        // it was missed: "got: nothing" on two pull requests, 2026-11-26).
        const grounds = ([c, l]) => {
          const t = window.__tm;
          return [...t.opens.slice(c).map((x) => (x.layers || {}).ground || ""), ...(t.layers || []).slice(l).filter((y) => y.key === "ground").map((y) => y.data)];
        };
        const has = (gs) => gs.some((g) => { try { return (JSON.parse(g).layers || []).some((x) => x.id === "hike-slope"); } catch { return false; } });
        await until(new Function("a", `const gs = (${grounds})(a); return (${has})(gs);`), [n0, l0], 20_000).catch(() => {});
        const gs = await ev(grounds, [n0, l0]);
        const under = await ev(() => document.documentElement.classList.contains("tf-under"));
        try {
          if (!gs.length && !under && (await opens()) === n0) throw new Error("3D didn't open native 3D in Hiking");
          const ids = [...new Set(gs.flatMap((g) => { try { return (JSON.parse(g).layers || []).map((x) => x.id); } catch { return []; } }))];
          const seen = `${(await opens()) - n0} open(s), ${gs.length} ground state(s), map ${under ? "under the page" : "not under the page"}`;
          if (!ids.includes("hike-slope")) throw new Error(`native 3D opened without Hiking's slope angle (got: ${ids.join(", ") || "nothing"}; ${seen})`);
        } finally {
          await ev(() => { const i = document.querySelector('#hkLayerList input[data-layer="slope"]'); if (i && i.checked) { i.checked = false; i.dispatchEvent(new Event("change", { bubbles: true })); } });
          if (await ev(() => document.documentElement.classList.contains("tf-under"))) { await tap3d(); await until(() => !document.documentElement.classList.contains("tf-under"), null, 4000).catch(() => {}); }
          else await back();
        }
      });
      await check("the one map draws nothing (Low Power Mode): flat map back with a note", () => notDrawn(["ski", "hike"]));
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
      await check("native map draws nothing (Battery Saver), every sport: flat map back with a note", () => notDrawn(ALL, true));
      // The phone's Back button closes a spot card that shows (Fishing: a tapped spot, a river gauge, a tide station)
      // before it puts the app away (native.js data-back-close; side-by-side test 2026-11-27: Back left the app with
      // Fishing's and Hunting's spot cards open, over the flat map and native 3D).
      await check("Back closes Fishing's spot card first", async () => {
        await ev(() => localStorage.removeItem("tf-admin"));   // a tester: the page's own flat map
        if (await ev(() => window.__tm.screen)) { await back(); await wait(1200); }
        await sport("fish");
        await until(() => document.body.classList.contains("sport-fish") && !!window.tfLeaflet, null, 10_000);
        await wait(1500);
        await ev(() => { const m = window.tfLeaflet, c = m.getCenter(); m.fire("click", { latlng: L.latLng(c.lat + 0.004, c.lng + 0.004), originalEvent: new MouseEvent("click") }); });
        await until(() => { const e = document.getElementById("fsSpot"); return !!e && !e.hidden; }, null, 8000).catch(() => {});
        await wait(800);
        if (!(await ev(() => { const e = document.getElementById("fsSpot"); return !!e && !e.hidden; }))) throw new Error("a tap on the map showed no spot card");
        const m0 = await ev(() => window.__app.minimized);
        await ev(() => window.__app.back());
        await wait(600);
        if (await ev((m) => window.__app.minimized > m, m0)) throw new Error("Back put the app away with the spot card open");
        if (await ev(() => { const e = document.getElementById("fsSpot"); return !!e && !e.hidden; })) throw new Error("Back left the spot card open");
      });
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
    results.push({ sport: group, step: `${label}: the page`, ok: false, note, shot: "" });
    console.log(`✗ ${line}: ${label}: the page\n    ${note}`);
  } finally { await p.ctx.close().catch(() => {}); }
}
// ---------- A new device opens in the season's sport (alex 2026-11-27) ----------
// Skiing from Nov 15 to Apr 30, MTB the rest of the year, only on a device that never used the app (the welcome shows):
// Skiing on Winter and first in the welcome; a device that used the app keeps its last sport. (The other runs never
// get the season default: phone()'s tf:todayAuto makes them a device that used the app before.)
async function seasonCheck() {
  const cases = [
    ["New phone on Jan 15 opens Skiing on Winter", "2027-01-15", null, "ski"],
    ["New phone on Nov 15 opens Skiing", "2026-11-15", null, "ski"],
    ["New phone on Jul 1 opens MTB", "2026-07-01", null, "mtb"],
    ["New phone on Apr 30 opens Skiing", "2027-04-30", null, "ski"],
    ["New phone on May 1 opens MTB", "2027-05-01", null, "mtb"],
    ["New phone on Nov 14 opens MTB", "2026-11-14", null, "mtb"],
    ["Phone that used MTB stays in MTB on Jan 15", "2027-01-15", "mtb", "mtb"],
  ];
  for (const [name, day, before, want] of cases) {
    const p = await phone(), { page } = p;
    let note = "";
    try {
      await p.ctx.addInitScript(([d, b]) => {
        window.tfSeasonDate = d;
        if (!b && !localStorage.getItem("tf:welcomed")) localStorage.removeItem("tf:todayAuto");   // phone()'s own key would make it a used device
        if (b && !localStorage.getItem("tf:welcomed")) { localStorage.setItem("tf:sport", JSON.stringify(b)); localStorage.setItem("tf:welcomed", "true"); }
      }, [day, before]);
      await page.goto(SITE + "index.html", { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector("#sportMapBtn", { timeout: 30_000 });
      if (await page.locator("dialog.tf-terms [data-terms=ok]").click({ timeout: 6000 }).then(() => true, () => false) && !before) {
        await page.waitForSelector("dialog.welc[open]", { timeout: 6000 });
        const first = await page.evaluate(() => (document.querySelector("dialog.welc .welc-sports button") || {}).dataset?.sport);
        if (first !== want) throw new Error(`the welcome lists "${first}" first, not "${want}"`);
        await page.locator("dialog.welc [data-skip]").first().click({ timeout: 4000 });
      }
      await wait(1500);
      const got = await page.evaluate(() => ({ sport: (document.getElementById("sport") || {}).value, body: document.body.classList.contains("sport-" + (document.getElementById("sport") || {}).value) }));
      if (got.sport !== want || !got.body) throw new Error(`opened in "${got.sport}", not "${want}"`);
      if (want === "ski") {
        await page.waitForFunction(() => (document.getElementById("basemap") || {}).value === "winter", null, { timeout: 10_000 }).catch(() => {});
        const b = await page.evaluate(() => (document.getElementById("basemap") || {}).value);
        if (b !== "winter") throw new Error(`Skiing opened on "${b}", not Winter`);
      }
    } catch (e) { note = String(e.message || e).split("\n")[0].slice(0, 200); }
    note = [note, ...p.errors].filter(Boolean).join(" · ");
    const shot = `app-season-${day}-${want}.png`;
    await page.screenshot({ path: join(OUT, shot) }).catch(() => {});
    await p.ctx.close().catch(() => {});
    results.push({ sport: "app", step: `Season: ${name}`, ok: !note, note, shot });
    console.log(`${note ? "✗" : "✓"} App builds: Season: ${name}${note ? "\n    " + note : ""}`);
  }
}
// Fonts come from the site itself (vendor/fonts-<version>), never from Google Fonts or another font host: opening a page
// must send nothing to Google (security and privacy check 2026-11-27). Reads the pages, scripts and stylesheets at the
// site's root for a font host, and each font stylesheet a page links from vendor/ for its font files.
async function fontsCheck() {
  const problems = [], HOSTS = /fonts\.(googleapis|gstatic)\.com|use\.typekit\.net|fonts\.bunny\.net/i;
  for (const f of (await readdir(root)).filter((n) => /\.(html|js|css)$/.test(n) && n !== "i18n-fr.js")) {
    const text = await readFile(join(root, f), "utf8");
    if (HOSTS.test(text)) problems.push(`${f} loads fonts from another site`);
    for (const m of text.matchAll(/href="\/?(vendor\/fonts[\w.-]*\/[\w.-]+\.css)"/g)) {
      const css = await readFile(join(root, m[1]), "utf8").catch(() => null);
      if (css == null) { problems.push(`${f}: ${m[1]} is missing`); continue; }
      for (const u of css.matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/g))
        if (!(await readFile(join(root, m[1], "..", u[1])).catch(() => null))) problems.push(`${m[1]}: ${u[1]} is missing`);
    }
  }
  results.push({ sport: "app", step: "Fonts come from the site", ok: !problems.length, note: problems.join(" · "), shot: "" });
  console.log(`${problems.length ? "✗" : "✓"} App builds: fonts come from the site${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
}

// Trail and place names show without emoji or grade marks (alex 2026-11-25, no emoji in the app): clean-names.js cleans
// every text the app reads from its data files and from OpenStreetMap ("Pettifogger 🟢" shows as "Pettifogger"), in the
// browser engine the iPhone app uses. A data file is answered here with names as some mappers write them;
// a file without map names (What's new) stays as it is.
async function namesCheck() {
  const p = await phone(), { page } = p;
  let note = "";
  try {
    await page.route("**/data/names-tfcheck.json", (r) => r.fulfill({ contentType: "application/json",
      body: JSON.stringify({ items: [["Octane \u25C6", 42.7, -80.3, "M"], ["Howie Down \u25C6\u25C6", 42.7, -80.3, "M"]], tags: { name: "Pettifogger \u{1F7E2}", ref: "13\u{1F7E2}" }, other: "Johnny \u2764\uFE0F Harlow", note: "More \u2192 Settings" }) }));
    await page.goto(SITE + "ride.html", { waitUntil: "domcontentloaded", timeout: 60_000 });
    // What's new keeps its line-drawing marks: only files with map names are cleaned.
    await page.route("**/data/changelog-tfcheck.json", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ text: "Hold \u2630 and drag" }) }));
    const kept = await page.evaluate(() => fetch("data/changelog-tfcheck.json").then((r) => r.json()));
    if (kept.text !== "Hold \u2630 and drag") throw new Error(`a file without map names was changed: ${kept.text}`);
    const got = await page.evaluate(() => fetch("data/names-tfcheck.json").then((r) => r.json()));
    const want = { items: [["Octane", 42.7, -80.3, "M"], ["Howie Down", 42.7, -80.3, "M"]], tags: { name: "Pettifogger", ref: "13" }, other: "Johnny Harlow", note: "More \u2192 Settings" };
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`read as ${JSON.stringify(got).slice(0, 160)}`);
  } catch (e) { note = String(e.message || e).split("\n")[0].slice(0, 200); }
  note = [note, ...p.errors].filter(Boolean).join(" · ");
  await p.ctx.close().catch(() => {});
  results.push({ sport: "app", step: "Names show without emoji", ok: !note, note, shot: "" });
  console.log(`${note ? "✗" : "✓"} App builds: names show without emoji${note ? "\n    " + note : ""}`);
}

async function appBuilds() {
await seasonCheck().catch((e) => results.push({ sport: "app", step: "Season sport", ok: false, note: String(e.message || e).slice(0, 200), shot: "" }));
await fontsCheck().catch((e) => results.push({ sport: "app", step: "Fonts come from the site", ok: false, note: String(e.message || e).slice(0, 200), shot: "" }));
await namesCheck().catch((e) => results.push({ sport: "app", step: "Names show without emoji", ok: false, note: String(e.message || e).slice(0, 200), shot: "" }));
await fullKeysCheck().catch((e) => results.push({ sport: "app", step: `iPhone builds ${FIRST_FULL.build}+ keep native 3D only`, ok: false, note: String(e.message || e).slice(0, 200), shot: "" }));
await testPhonesCheck().catch((e) => results.push({ sport: "app", step: "Test phones send no usage", ok: false, note: String(e.message || e).slice(0, 200), shot: "" }));
await usagePrivateCheck().catch((e) => results.push({ sport: "app", step: "Usage holds nothing personal", ok: false, note: String(e.message || e).slice(0, 200), shot: "" }));
for (const kind of ["ios", "iosu", "android", "web"]) await appBuild(kind);
}

// ---------- Computer: turning the 3D map (alex's recording 2026-11-24) ----------
// The website on a computer stopped 0.3-0.5 s again and again while the 3D map was turned (Skiing, Whistler): each
// piece of far ground turning into view was painted into a 2048 px buffer, 5 to 10 new pieces in one frame. Now the
// ground is painted at 1024 px while the map is moved by hand and sharp again once it stops (map3d.js deskMoving,
// deskStill, deskSize). This turns the map with the mouse at computer size and fails if a frame of the turn paints more
// ground than DESK_TURN_PIXELS (before the fix: up to 12 pieces at 2048 px, ~50 million pixels in one frame; after: at
// most ~12 million), if the buffers stay bigger than 1024 px while turning, if a turn has to make new buffers (a stop at
// its start), or if the ground isn't sharp (bigger than 1024 px) before and after the turn, once the map is still.
async function deskTurn() {
  const DESK_TURN_PIXELS = 20 * 1024 * 1024;
  // Once still: 3 pieces of ground a frame at 2048 px (~12 million pixels) for each layer stack, with room to spare.
  const deskStillPixels = (stacks) => Math.max(1, stacks) * 16 * 1024 * 1024;
  // Sharp again: the map still, painting at more than 1024 px, and every piece in view painted at that size.
  const sharpDone = () => {
    const g = window.tf3dGl(), pool = g.painter.renderToTexture.pool;
    if (g.isMoving() || pool._tileSize <= 1024) return false;
    return g.terrain.tileManager.getRenderableTiles().every((t) => !t || !t.rtt || t.rtt.every((r) => !r || ((pool._objects[r.id] || {}).fbo || {}).width === pool._tileSize));
  };
  const p = await phone(DESK);
  const { page } = p;
  await step(p, "desk", "Open Skiing 3D on a computer", async () => {
    await page.goto(SITE + "index.html", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("#sportMapBtn", { timeout: 30_000 });
    await page.locator("dialog.tf-terms [data-terms=ok]").click({ timeout: 6000 }).catch(() => {});
    await wait(1500); await page.keyboard.press("Escape").catch(() => {});
    await tap(page, "#sportMapBtn"); await tap(page, "#sportMenu [data-sport=ski]");
    await page.waitForFunction(() => (document.getElementById("sport") || {}).value === "ski", null, { timeout: 8000 });
    await wait(6000);
    if (!(await page.evaluate(() => !!(window.tf3dGl && window.tf3dGl())))) { await tap(page, "#btn3d"); await wait(8000); }
    if (!(await page.evaluate(() => !!(window.tf3dGl && window.tf3dGl() && window.tf3dGl().terrain)))) throw new Error("the 3D map didn't open");
    await page.evaluate(() => window.tf3dGl().jumpTo({ center: [-122.93, 50.08], zoom: 12.6, pitch: 62, bearing: 150 }));
    await page.waitForFunction(() => { const g = window.tf3dGl(); return g.loaded() && !g.isMoving() && g.areTilesLoaded(); }, null, { timeout: 60_000 }).catch(() => {});
    await wait(3000);
    const still = await page.waitForFunction(sharpDone, null, { timeout: 30_000 })
      .then(() => 0, () => page.evaluate(() => window.tf3dGl().painter.renderToTexture.pool._tileSize));
    if (still) throw new Error(`the still ground is painted at ${still} px (sharper expected)`);
  }, 0);
  await step(p, "desk", "Turning the 3D map paints little ground per frame", async () => {
    await page.evaluate(() => {
      const g = window.tf3dGl(), pool = g.painter.renderToTexture.pool, stamp = pool.stampObject;
      const s = window.tfTurn = { px: 0, worst: 0, sizes: new Set(), hand: false, made: 0 };
      // Counted at the size of the buffer painted (computers keep buffers of two sizes side by side).
      pool.stampObject = function (o) { const w = (o && o.fbo && o.fbo.width) || pool._tileSize; s.px += w * w; s.w = Math.max(s.w || 0, w); return stamp.apply(this, arguments); };
      const mk = pool._createObject;
      pool._createObject = function () { if (g.isMoving()) s.made++; return mk.apply(this, arguments); };
      g.on("movestart", (e) => { if (e.originalEvent) s.hand = true; });
      // Frames once the map is still count too: the sharp repaint after a pause painted the whole view in one frame
      // (~50 million pixels, alex's recording 2026-11-25), so a turn started right then stopped.
      g.on("render", () => { if (g.isMoving()) { s.worst = Math.max(s.worst, s.px); if (s.w) s.sizes.add(s.w); } else s.still = Math.max(s.still || 0, s.px); s.px = 0; s.w = 0; });
    });
    const r = await page.evaluate(() => { const b = window.tf3dGl().getCanvas().getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    await page.mouse.move(r[0], r[1]);
    await page.mouse.down({ button: "right" });
    for (let i = 1; i <= 40; i++) { await page.mouse.move(r[0] + i * 12, r[1] + Math.sin(i / 6) * 20); await wait(40); }
    await page.mouse.up({ button: "right" });
    await page.waitForFunction(() => !window.tf3dGl().isMoving(), null, { timeout: 20_000 }).catch(() => {});
    await page.waitForFunction(sharpDone, null, { timeout: 30_000 }).catch(() => {});
    await wait(1500);
    const t = await page.evaluate(() => ({ hand: window.tfTurn.hand, worst: window.tfTurn.worst, sizes: [...window.tfTurn.sizes], made: window.tfTurn.made, still: window.tfTurn.still || 0,
      stacks: (window.tf3dGl().painter.renderToTexture._stacks || []).length,
      after: window.tf3dGl().painter.renderToTexture.pool._tileSize }));
    if (!t.hand) throw new Error("the mouse didn't turn the map");
    const mp = (n) => (n / 1048576).toFixed(1) + " million pixels";
    console.log(`    (worst frame of the turn painted ${mp(t.worst)} of ground; buffer sizes while moving: ${t.sizes.join(", ")} px; ` +
      `new buffers while moving: ${t.made}; worst still frame: ${mp(t.still)}; still after: ${t.after} px)`);
    if (t.sizes.some((z) => z > 1024)) throw new Error(`the ground was painted at ${Math.max(...t.sizes)} px while turning (1024 px expected)`);
    if (t.worst > DESK_TURN_PIXELS) throw new Error(`one frame of the turn painted ${mp(t.worst)} of ground (at most ${mp(DESK_TURN_PIXELS)})`);
    if (t.still > deskStillPixels(t.stacks)) throw new Error(`once still, one frame painted ${mp(t.still)} of ground again (at most ${mp(deskStillPixels(t.stacks))}: a few pieces a frame)`);
    if (t.made > 2) throw new Error(`the turn made ${t.made} new paint buffers (they're made ahead while the map is still)`);
    if (t.after <= 1024) throw new Error(`after the turn the still ground stays at ${t.after} px (sharper expected)`);
  }, 0);
  // The mouse on its way to the next drag (alex's recording 2026-11-25: the catches came as a drag began). Each map
  // mouse event read the ground under the mouse back from the graphics card (and waited for it to finish drawing):
  // 25 moves over the still map then a right-drag made ~300 such reads before; a handful now (one when the mouse rests,
  // for the trail-name tip, which still has to come).
  await step(p, "desk", "Moving the mouse to a turn waits little on the graphics card", async () => {
    await page.waitForFunction(() => !window.tf3dGl().isMoving(), null, { timeout: 20_000 }).catch(() => {});
    await page.evaluate(() => {
      const g = window.tf3dGl(), c = g.painter.context.gl, rp = c.readPixels;
      const s = window.tfReads = { n: 0, ev: 0 };
      c.readPixels = function () { s.n++; return rp.apply(this, arguments); };
      g.on("mousemove", () => s.ev++);
    });
    const r = await page.evaluate(() => { const b = window.tf3dGl().getCanvas().getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    for (let i = 0; i < 25; i++) { await page.mouse.move(r[0] - 200 + i * 8, r[1] + 40 + Math.sin(i / 3) * 20); await wait(16); }
    await page.mouse.move(r[0], r[1]);
    await page.mouse.down({ button: "right" });
    for (let i = 1; i <= 8; i++) { await page.mouse.move(r[0] + i * 12, r[1]); await wait(40); }
    await page.mouse.up({ button: "right" });
    await page.waitForFunction(() => !window.tf3dGl().isMoving(), null, { timeout: 20_000 }).catch(() => {});
    const before = await page.evaluate(() => window.tfReads.n), ev0 = await page.evaluate(() => window.tfReads.ev);
    await page.mouse.move(r[0] - 40, r[1] - 30);
    // (A slow test browser can take a few seconds per frame here: wait for the lookup rather than a fixed time.)
    await page.waitForFunction((n) => window.tfReads.ev > n, ev0, { timeout: 10_000 }).catch(() => {});
    const t = await page.evaluate(() => ({ n: window.tfReads.n, ev: window.tfReads.ev }));
    console.log(`    (ground reads from the graphics card: ${before} for 25 mouse moves and a turn; trail-name lookups once still: ${t.ev - ev0})`);
    if (before > 40) throw new Error(`moving the mouse to a turn read the ground back from the graphics card ${before} times (at most 40)`);
    if (t.ev <= ev0) throw new Error("the mouse resting on the still map made no trail-name lookup (the name tip would never show)");
    // A drag is still no click (the skipped button-press event must still note where the button went down).
    await page.evaluate(() => { window.tfReads.click = 0; window.tf3dGl().on("click", () => window.tfReads.click++); });
    await page.mouse.move(r[0], r[1]); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(r[0] + i * 10, r[1] + i * 4); await wait(40); }
    await page.mouse.up();
    await wait(800);
    const clicks = await page.evaluate(() => window.tfReads.click);
    if (clicks) throw new Error("dragging the map with the mouse counted as a click");
  }, 0);
  // Choosing the map pieces in view (alex's ?lagcheck recording 2026-11-27: 90-250 ms of MapLibre's own frame step on
  // the processor while turning, the graphics card done in 2-17 ms). MapLibre looked up each candidate piece's ground
  // height once per map source while picking them, ~3,000 lookups a frame in this turn; now once per piece (map3d.js
  // quickPieces). Fails above DESK_HEIGHT_LOOKUPS a frame.
  await step(p, "desk", "Turning the 3D map looks up each piece's height once a frame", async () => {
    const DESK_HEIGHT_LOOKUPS = 1800;
    await page.waitForFunction(() => !window.tf3dGl().isMoving(), null, { timeout: 20_000 }).catch(() => {});
    await page.evaluate(() => {
      // Counted only while MapLibre picks the pieces of each source (style._updateSources).
      const g = window.tf3dGl(), T = g.terrain, st = g.style, s = window.tfLook = { n: 0, frames: 0 }, get = T.getTerrainData, upd = st._updateSources;
      let picking = false;
      T.getTerrainData = function () { if (picking && g.isMoving()) s.n++; return get.apply(this, arguments); };
      st._updateSources = function () { picking = true; try { return upd.apply(this, arguments); } finally { picking = false; } };
      g.on("render", () => { if (g.isMoving()) s.frames++; });
    });
    const r = await page.evaluate(() => { const b = window.tf3dGl().getCanvas().getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    await page.mouse.move(r[0], r[1]);
    await page.mouse.down({ button: "right" });
    for (let i = 1; i <= 30; i++) { await page.mouse.move(r[0] - i * 12, r[1] + Math.sin(i / 5) * 15); await wait(40); }
    await page.mouse.up({ button: "right" });
    await page.waitForFunction(() => !window.tf3dGl().isMoving(), null, { timeout: 20_000 }).catch(() => {});
    const t = await page.evaluate(() => window.tfLook);
    const per = t.frames ? Math.round(t.n / t.frames) : 0;
    console.log(`    (ground height lookups while picking pieces: ${per} a frame over ${t.frames} frames)`);
    if (!t.frames) throw new Error("the mouse didn't turn the map");
    if (per > DESK_HEIGHT_LOOKUPS) throw new Error(`turning looked up ground heights ${per} times a frame (at most ${DESK_HEIGHT_LOOKUPS}: once per map piece)`);
  }, 0);
  await p.ctx.close();
}

// The ride page (My rides, recording) on its own.
async function ridePage(dev) {
  const p = await phone(dev === "desk" ? DESK : PHONE);
  await step(p, "ride", "Open My rides (ride.html)", () => p.page.goto(SITE + "ride.html#rides", { waitUntil: "domcontentloaded", timeout: 60_000 }), 4000);
  await p.ctx.close();
}

// Sign-in person check (CAPTCHA on in Supabase since 2026-11-21): on every page with a sign-in box, Sign in, Create an
// account and Email me a code each send Cloudflare's answer, and a refused one shows our own words, never Supabase's.
// Cloudflare's script is a stand-in that answers at once; Supabase's sign-in addresses are answered here, nothing is sent.
async function signIn(dev) {
for (const file of ["index.html", "ride.html", "usage.html"]) {
  const p = await phone(dev === "desk" ? DESK : PHONE), { page } = p;
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
}

// The run: the phone, then the computer, each in the same order (every sport, the website's own checks, My rides, the
// sign-in check); the phone adds the phone apps' checks, the computer turning the 3D map with the mouse.
for (const dev of DEVICES) {
  for (const sport of SPORTS) await sportRun(sport, dev);
  if (dev === "phone") await appBuilds();
  else await appBuild("web", true);
  if (dev === "desk") await deskTurn();   // in Skiing, whatever SPORTS has
  await ridePage(dev);
  await signIn(dev);
}
await browser.close();
server.close();

// ---------- report ----------
const bad = results.filter((r) => !r.ok);
const engine = BROWSER === "webkit" ? "Safari engine" : BROWSER;
const passed = PART === "computer" ? `${SPORTS.length} sports, the website opening Skiing on Winter, the 3D turn with the mouse, My rides and the sign-in check`
  : `${SPORTS.length} sports, App builds, ${PART === "all" ? "the same at computer size with a 3D turn, " : ""}My rides and the sign-in check`;
const md = [PART === "computer" ? `## 🖥 Computer test (${engine}, 1440×900)` : `## 📱 Phone test (${engine}, iPhone ${PHONE.viewport.width}×${PHONE.viewport.height}${PART === "all" ? ", then a computer at 1440×900" : ""})`, "",
  bad.length ? `**${bad.length} problem${bad.length > 1 ? "s" : ""}** in ${results.length} steps.` : `**All ${results.length} steps passed**: ${passed}.`, "",
  "| Sport | Step | Result |", "|---|---|---|",
  ...results.map((r) => `| ${NAMES[r.sport] || "My rides"} | ${r.step} | ${r.ok ? "✓" : "✗ " + r.note.replace(/\|/g, "\\|")} |`), "",
  `Screenshots of every step: the **${PART === "computer" ? "computer" : "phone"}-test-screenshots** download at the bottom of this run's page.`].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n");
console.log(`\n${bad.length ? `${bad.length} problem(s)` : "All passed"} in ${results.length} steps.`);
process.exit(bad.length ? 1 : 0);
