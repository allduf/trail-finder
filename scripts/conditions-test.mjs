// Tough conditions test (alex 2026-11-27: "can we test the app in all different situation ? like low data , off line"):
// the website at iPhone size in WebKit (Safari's engine), every sport, in the conditions phones really meet, with each
// one failing the check when the app breaks in it. Run by the "conditions" job of .github/workflows/phone-test.yml on
// every pull request.
//
//  - Weak signal: every download late (1-3 s), from a brand-new phone with nothing saved: the app opens, each sport's
//    Today card finishes (never "Loading…" for good).
//  - Signal that doesn't answer: outside services (weather, Avalanche Canada, search...) never answer, as on one bar at
//    a trailhead: every Today card ends with words within a minute, and a place search ends too.
//  - Downloads cut: a third of the outside downloads cut off half way: nothing breaks.
//  - Signal dropping in and out every few seconds while switching sports, the Today card and Layers.
//  - Airplane mode mid-use: the Today card says there's no signal (no endless wait), then reads again once the signal
//    is back.
//  - Opened again with no signal: after one visit (the app's offline helper, sw.js, keeps its files), the page is
//    opened with no signal: it opens, every sport opens, and says there's no signal.
//  - Overnight, no signal: Skiing left open, the phone put away for 40 h and taken out with no signal: no avalanche
//    rating from the old bulletin may show as today's (alex's rule: better nothing than a wrong level), the panel says
//    it expired, and the Today card says why no rating shows.
//  - Location off: My location and Near me say so in words, nothing waits for ever.
//  - Background and back: the app put away and taken out again (with the 3D map open), three times: nothing breaks.
//  - 3D map memory dropped: the phone takes the 3D map's graphics away (low memory): it draws again after.
//  - Dark mode: every sport and its Today card: no text too faint to read on its background.
//  - Small screens: iPhone SE size (375 x 667) and a zoomed display (320 x 568): every tab of every sport fits, no
//    sideways scrolling, no button cut off at the screen's edge (except in rows that scroll sideways on purpose).
//  - Phone sideways (the website; the apps stay upright): every map button on the screen.
//
// Run: node scripts/conditions-test.mjs   (needs the playwright package and its WebKit, or BROWSER=chromium)
// Optional: BROWSER (webkit), OUT (conditions-shots), SPORTS (mtb,ski,hunt,fish,moto,hike), ONLY (a comma list of
// the conditions' keys below, to run some).
import { createServer } from "node:http";
import { readFile, mkdir, appendFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const LIVE = "https://allduf.github.io/trail-finder/";
const BROWSER = process.env.BROWSER || "webkit";
const OUT = process.env.OUT || "conditions-shots";
const SPORTS = (process.env.SPORTS || "mtb,ski,hunt,fish,moto,hike").split(",").map((s) => s.trim()).filter(Boolean);
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const NAMES = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", fish: "Fishing", moto: "Adventure moto", hike: "Hiking" };
// As in phone-test.mjs: code libraries, fonts and the map pictures and heights come from outside; nothing else does.
const MAPS = new Set(["unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com",
  "tile.openstreetmap.org", "tiles.openfreemap.org", "tiles.mapterhorn.com", "ibasemaps-api.arcgis.com", "server.arcgisonline.com", "allduf.github.io"]);
const PHONE = {
  viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, hasTouch: true, ...(BROWSER === "chromium" ? { isMobile: true } : {}),
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  geolocation: { latitude: 50.1163, longitude: -122.9574 }, permissions: ["geolocation"], locale: "en-CA", timezoneId: "America/Vancouver",
  serviceWorkers: "block",
};
// Downloads that fail on purpose here (the condition itself), and the browser's own lines about them.
const NETWORK = /Load failed|Failed to fetch|NetworkError|network error|aborted|AbortError|ERR_|access control checks|Access-Control-Allow-Origin|Status code: \d{3}|Importing a module script failed|Could not connect|The Internet connection appears to be offline|The network connection was lost|cancelled|timed out|timeout|signal is aborted|Failed to load resource|AJAXError|tile|status of [45]\d\d|WebGL|GL_|Unrecognized feature|CONTEXT_LOST/i;
// Words a wait shows while it waits.
const WAITING = /Loading…|Loading\.\.\.|Checking today's weather…|Searching…|Looking…|Reading…/;

// ---------- the site, on localhost ----------
const root = fileURLToPath(new URL("../", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".pbf": "application/x-protobuf" };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = normalize(join(root, path));
  try {
    if (!file.startsWith(root) || /^(\.git|\.github|scripts|supabase|ios-app|android-app)\//.test(path)) throw new Error("not served");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    try {
      const r = await fetch(/^trail-finder-winter2?\//.test(path) ? new URL("../" + path, LIVE) : LIVE + path);
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502).end(); }
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const SITE = `http://localhost:${server.address().port}/`;

const pw = await import("playwright");
const browser = await pw[BROWSER].launch(BROWSER === "chromium" && process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
await mkdir(OUT, { recursive: true });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const results = [];   // { cond, step, ok, note, shot }

// A phone in one condition. net(route, url, local): how each download goes (default: the site and map pictures
// answer, other outside services are cut off as in phone-test.mjs).
async function phone({ opts = {}, net = null, init = null, on = browser } = {}) {
  const ctx = await on.newContext({ ...PHONE, ...opts });
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.protocol === "data:" || u.protocol === "blob:") return route.continue().catch(() => {});
    const local = u.hostname === "127.0.0.1" || u.hostname === "localhost";
    const map = MAPS.has(u.hostname);
    if (net) return net(route, u, local, map);
    return local || map ? route.continue().catch(() => {}) : route.abort().catch(() => {});
  });
  await ctx.addInitScript(() => { try { localStorage.setItem("tf:todayAuto", "false"); } catch {} });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { const m = String(e.message || e); if (!NETWORK.test(m)) errors.push(m.split("\n")[0].slice(0, 200) + where(e)); });
  // The 3D map library's own lines (a map picture that didn't come, its error's short minified name) aren't the app's.
  page.on("console", (m) => { if (m.type() === "error" && !NETWORK.test(m.text()) && !/\/vendor\/maplibre/.test((m.location() || {}).url || "")) errors.push("console: " + m.text().split("\n")[0].slice(0, 200)); });
  page.on("crash", () => errors.push("the page crashed (out of memory?)"));
  return { ctx, page, errors };
}
function where(e) {
  const m = String(e.stack || "").match(/([\w.-]+\.(?:js|html))(?:\?[^:]*)?:(\d+)/);
  return m ? ` @${m[1]}:${m[2]}` : "";
}
let cond = "";
async function step(p, name, fn, settle = 1000) {
  const before = p.errors.length;
  let note = "";
  try { const r = await fn(); if (typeof r === "string") note = r; } catch (e) { note = String(e.message || e).split("\n")[0].replace(/\s+/g, " ").slice(0, 200); }
  await wait(settle);
  const wide = await p.page.evaluate(() => { const w = document.documentElement.scrollWidth; return w > innerWidth + 2 ? w - innerWidth : 0; }).catch(() => 0);
  const shot = `${cond}-${String(results.filter((r) => r.cond === cond).length + 1).padStart(2, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 70)}.png`;
  await p.page.screenshot({ path: join(OUT, shot), timeout: 20_000 }).catch(() => {});
  const problems = [note, ...p.errors.slice(before), wide ? `page is ${wide} px wider than the screen (sideways scrolling)` : ""].filter(Boolean);
  results.push({ cond, step: name, ok: !problems.length, note: problems.join(" · "), shot });
  console.log(`${problems.length ? "✗" : "✓"} ${TITLES[cond]}: ${name}${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
}

// ---------- what a rider does ----------
async function open(p, { timeout = 60_000 } = {}) {
  await p.page.goto(SITE + "index.html", { waitUntil: "domcontentloaded", timeout });
  await p.page.waitForSelector("#sportMapBtn", { timeout });
  // The one-time terms (risk.js) and anything shown on a first open, like a rider would.
  if (await p.page.locator("dialog.tf-terms [data-terms=ok]").click({ timeout: 8000 }).then(() => true, () => false))
    await p.page.waitForSelector("dialog.welc[open]", { timeout: 4000 }).catch(() => {});
  await p.page.keyboard.press("Escape").catch(() => {});
}
async function pick(p, sport) {
  await p.page.locator("#sportMapBtn").click({ timeout: 15_000 });
  await p.page.locator(`#sportMenu [data-sport=${sport}]`).click({ timeout: 15_000 });
  await p.page.waitForFunction((s) => (document.getElementById("sport") || {}).value === s, sport, { timeout: 30_000 });
}
// The sport's Today card (MTB: Where to ride today), opened; ms: how long it may wait before it must have words.
const todaySel = (sport) => (sport === "mtb" ? "dialog.today[open]" : `.tdy.open[data-sp=${sport}]`);
async function today(p, sport) {
  await p.page.evaluate(() => window.tfTodayOpen && window.tfTodayOpen());
  await p.page.waitForSelector(todaySel(sport), { timeout: 30_000 });
}
// What the Today card still waits on, after ms: [] when every part has its words.
async function stillWaiting(p, sport, ms) {
  const t = Date.now();
  let left = [];
  do {
    left = await p.page.evaluate(([sel, re]) => {
      const el = document.querySelector(sel);
      if (!el) return ["the card closed"];
      const w = new RegExp(re);
      return [...el.querySelectorAll("*")].filter((e) => e.children.length === 0 && w.test(e.textContent) && e.getClientRects().length).map((e) => e.textContent.trim().slice(0, 60));
    }, [todaySel(sport), WAITING.source]).catch(() => ["the page didn't answer"]);
    if (!left.length) return [];
    await wait(1000);
  } while (Date.now() - t < ms);
  return [...new Set(left)];
}
const closeToday = (p) => p.page.keyboard.press("Escape").catch(() => {});
const text = (p, sel) => p.page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).map((e) => e.innerText.replace(/\s+/g, " ").trim()).join(" | "), sel).catch(() => "");
// The app put away (another app opened, the screen locked) and taken out again.
const away = (p) => p.page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  Object.defineProperty(document, "hidden", { value: true, configurable: true });
  document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("blur"));
  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
});
const back = (p) => p.page.evaluate(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus"));
});

// ---------- the conditions ----------
const TITLES = {
  weak: "Weak signal", dead: "Signal that doesn't answer", cut: "Downloads cut", flaky: "Signal in and out", airplane: "Airplane mode mid-use",
  reopen: "Opened again with no signal", overnight: "Overnight, no signal", location: "Location off", background: "Background and back",
  memory: "3D map memory dropped", dark: "Dark mode", small: "Small screens", sideways: "Phone sideways (website)",
};
const CONDS = {
  // Every download late, outside services cut (as in phone-test.mjs), a brand-new phone.
  async weak() {
    const p = await phone({ net: async (route, u, local, map) => { await wait(local ? rnd(300, 1000) : rnd(1000, 3000)); return local || map ? route.continue().catch(() => {}) : route.abort().catch(() => {}); } });
    const t0 = Date.now();
    await step(p, "Opens on a weak signal", async () => { await open(p, { timeout: 120_000 }); const s = (Date.now() - t0) / 1000; return s > 90 ? `took ${Math.round(s)} s to open` : ""; }, 3000);
    for (const sp of SPORTS) {
      await step(p, `${NAMES[sp]}: Today card finishes`, async () => {
        await pick(p, sp); await today(p, sp);
        const left = await stillWaiting(p, sp, 75_000);
        return left.length ? `still waiting after 75 s: ${left.join(", ")}` : "";
      });
      await closeToday(p);
    }
    await p.ctx.close();
  },
  // Outside services never answer (the map pictures do): every wait must end with words.
  async dead() {
    const p = await phone({ net: (route, u, local, map) => (local || map ? route.continue().catch(() => {}) : undefined) });
    await open(p);
    for (const sp of SPORTS) {
      await step(p, `${NAMES[sp]}: Today card ends with words`, async () => {
        await pick(p, sp); await today(p, sp);
        const left = await stillWaiting(p, sp, 60_000);
        return left.length ? `still waiting after 60 s: ${left.join(", ")}` : "";
      });
      await closeToday(p);
    }
    await step(p, "Search a place ends", async () => {
      await pick(p, "mtb");
      // As a person does: the map sheet's search box opens the Find page with its box ready.
      if (await p.page.locator("#peekSearch").isVisible()) await p.page.locator("#peekSearch").click({ timeout: 15_000 });
      else await p.page.locator('#tabbar [data-nav="new"]').click({ timeout: 15_000 });
      const box = p.page.locator("#trailQ");
      await box.waitFor({ state: "visible", timeout: 15_000 });
      await box.fill("Squamish"); await box.press("Enter");
      await wait(45_000);
      const w = await p.page.evaluate((re) => [...document.querySelectorAll("body *")].filter((e) => e.children.length === 0 && new RegExp(re).test(e.textContent) && e.getClientRects().length).map((e) => e.textContent.trim().slice(0, 60)), WAITING.source);
      return w.length ? `still waiting after 45 s: ${[...new Set(w)].join(", ")}` : "";
    }, 500);
    await p.ctx.close();
  },
  // A third of the outside downloads cut off half way (a connection reset), the rest late.
  async cut() {
    const p = await phone({ net: async (route, u, local, map) => {
      if (local) return route.continue().catch(() => {});
      await wait(rnd(200, 1500));
      if (!map || Math.random() < 0.33) return route.abort("connectionreset").catch(() => {});
      return route.continue().catch(() => {});
    } });
    await open(p);
    for (const sp of SPORTS) {
      await step(p, `${NAMES[sp]}: opens, Today card finishes`, async () => {
        await pick(p, sp); await today(p, sp);
        const left = await stillWaiting(p, sp, 60_000);
        return left.length ? `still waiting after 60 s: ${left.join(", ")}` : "";
      });
      await closeToday(p);
    }
    await p.ctx.close();
  },
  // The signal goes and comes back every 3 s while switching sports, the Today card, Layers and 3D.
  async flaky() {
    const p = await phone();
    await open(p);
    let off = false;
    const flip = setInterval(() => { off = !off; p.ctx.setOffline(off).catch(() => {}); }, 3000);
    for (const sp of SPORTS) {
      await step(p, `${NAMES[sp]}: sport, Today, Layers, 3D`, async () => {
        await pick(p, sp); await today(p, sp); await wait(4000); await closeToday(p);
        await p.page.locator("#layersBtn").click({ timeout: 10_000 }); await wait(1500);
        await p.page.keyboard.press("Escape"); await p.page.evaluate(() => { const c = document.getElementById("lmClose"); if (c && c.offsetParent) c.click(); });
        await p.page.locator("#btn3d").click({ timeout: 10_000 }); await wait(5000);
        await p.page.locator("#btn3d").click({ timeout: 10_000 }); await wait(2000);
      }, 500);
    }
    clearInterval(flip);
    await p.ctx.setOffline(false);
    await step(p, "Signal back: Today card finishes", async () => {
      await pick(p, "hike"); await p.page.evaluate(() => window.tfTodaySport && window.tfTodaySport.fill("hike")); await today(p, "hike");
      const left = await stillWaiting(p, "hike", 60_000);
      return left.length ? `still waiting after 60 s: ${left.join(", ")}` : "";
    });
    await p.ctx.close();
  },
  // Using the app, then airplane mode, then the signal back.
  async airplane() {
    const p = await phone();
    await open(p);
    for (const sp of SPORTS.filter((s) => s !== "mtb")) {
      await step(p, `${NAMES[sp]}: no signal says so`, async () => {
        await p.ctx.setOffline(false);
        await pick(p, sp); await today(p, sp); await stillWaiting(p, sp, 30_000);
        await p.ctx.setOffline(true);
        await p.page.evaluate((s) => window.tfTodaySport && window.tfTodaySport.fill(s), sp);
        const left = await stillWaiting(p, sp, 40_000);
        if (left.length) return `still waiting after 40 s with no signal: ${left.join(", ")}`;
        const t = await text(p, todaySel(sp));
        return /No signal|no connection/i.test(t) ? "" : `no word of the missing signal on the card: "${t.slice(0, 120)}"`;
      });
      await step(p, `${NAMES[sp]}: signal back, reads again`, async () => {
        await p.ctx.setOffline(false);
        const t0 = Date.now();
        let t = "";
        while (Date.now() - t0 < 30_000) { t = await text(p, `${todaySel(sp)} .tdy-here, ${todaySel(sp)} .tdy-sum`); if (!/No signal/.test(t)) return ""; await wait(1000); }
        return `still says "No signal" 30 s after the signal came back`;
      });
      await closeToday(p);
    }
    await step(p, "MTB: Where to ride today with no signal", async () => {
      await pick(p, "mtb"); await p.ctx.setOffline(true);
      await today(p, "mtb");
      const left = await stillWaiting(p, "mtb", 40_000);
      return left.length ? `still waiting after 40 s with no signal: ${left.join(", ")}` : "";
    });
    await closeToday(p);
    await step(p, "3D map with no signal", async () => {
      await pick(p, "ski"); await wait(4000);
      await p.page.locator("#btn3d").click({ timeout: 10_000 }); await wait(6000);
    }, 2000);
    await p.ctx.close();
  },
  // A visit with the offline helper on, then the page opened again with no signal.
  async reopen() {
    // The test browser's Safari engine can't reload a page from its offline helper with the network cut ("internal
    // error"), a limit of the test tool, not of iPhones: this one runs in Chromium when it is there.
    let other = null;
    if (BROWSER === "webkit") other = await pw.chromium.launch().catch(() => null);
    if (BROWSER === "webkit" && !other) { results.push({ cond, step: "Chromium for this check", ok: !process.env.CI, note: process.env.CI ? "Chromium didn't start: the check didn't run" : "", shot: "" }); console.log(`- ${TITLES[cond]}: Chromium isn't installed here, skipped`); return; }
    const p = await phone({ opts: { serviceWorkers: "allow", ...(other ? { isMobile: true } : {}) }, on: other || browser });
    p.ctx.once("close", () => other && other.close().catch(() => {}));
    await open(p);
    const ready = await p.page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 45_000 }).then(() => true, () => false)
      || await p.page.reload().then(() => p.page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 30_000 })).then(() => true, () => false);
    if (!ready) { results.push({ cond, step: "Offline helper", ok: true, note: "", shot: "" }); console.log(`- ${TITLES[cond]}: the offline helper didn't start in this browser, skipped`); await p.ctx.close(); return; }
    for (const sp of SPORTS) { await pick(p, sp).catch(() => {}); await wait(3000); }   // each sport's own scripts, kept
    await pick(p, "mtb");
    await wait(3000);
    await p.ctx.setOffline(true);
    await step(p, "Opens with no signal", async () => {
      await p.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      await p.page.waitForSelector("#sportMapBtn", { timeout: 30_000 });
    }, 3000);
    for (const sp of SPORTS.filter((s) => s !== "mtb")) {
      await step(p, `${NAMES[sp]}: opens, Today says no signal`, async () => {
        await pick(p, sp); await today(p, sp);
        const left = await stillWaiting(p, sp, 40_000);
        if (left.length) return `still waiting after 40 s: ${left.join(", ")}`;
        const t = await text(p, todaySel(sp));
        return /No signal/i.test(t) ? "" : `no word of the missing signal: "${t.slice(0, 120)}"`;
      });
      await closeToday(p);
    }
    await p.ctx.close();
  },
  // Skiing open with a bulletin valid for 3 more hours, then 40 h away with no signal.
  async overnight() {
    let avy = null;
    try { avy = JSON.parse(await readFile(join(root, "data/avalanche.json"), "utf8")); } catch {}
    const p = await phone({ net: async (route, u, local, map) => {
      if (local && /\/data\/avalanche\.json$/.test(u.pathname) && avy) return route.fulfill({ contentType: "application/json", body: JSON.stringify(avy) });
      return local || map ? route.continue().catch(() => {}) : route.abort().catch(() => {});
    } });
    if (!avy) { await step(p, "Avalanche test file", () => "data/avalanche.json missing (bash scripts/site-data.sh get)"); await p.ctx.close(); return; }
    // Today's bulletin where you are (Whistler): the saved copy, as Avalanche Canada would give it today, valid 3 h more.
    const now = Date.now(), day = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
    let found = 0;
    // An area's outline: rings of lat, lon, lat, lon... (winter.js prepAreas).
    const inside = (r, lat, lon) => { let o = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const [ay, ax, by, bx] = [r[i], r[i + 1], r[j], r[j + 1]]; if ((ay > lat) !== (by > lat) && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) o = !o; } return o; };
    for (const a of avy.areas || []) {
      if (!a.forecast || !(a.rings || []).some((r) => inside(r, 50.1163, -122.9574))) continue;
      const d0 = { ...((a.forecast.days || [])[0] || {}), date: day, alp: 3, tln: 3, btl: 2 };
      Object.assign(a.forecast, { issued: new Date(now - 3600e3).toISOString(), validUntil: new Date(now + 3 * 3600e3).toISOString(), days: [d0], early: false });
      found++;
    }
    avy.builtAt = new Date(now).toISOString();
    await p.page.clock.install();
    await open(p);
    await step(p, "Skiing: today's ratings show", async () => {
      await pick(p, "ski"); await wait(6000); await today(p, "ski"); await stillWaiting(p, "ski", 30_000);
      const t = await text(p, `${todaySel("ski")} .tdy-avy`);
      return found && /Considerable/.test(t) ? "" : `the test's bulletin didn't show (${found} area(s) set): "${t.slice(0, 100)}"`;
    });
    await closeToday(p);
    await away(p);
    await p.ctx.setOffline(true);
    await p.page.clock.setSystemTime(now + 40 * 3600e3);
    await wait(500);
    await back(p);
    await step(p, "40 h later, no signal: no old rating as today's", async () => {
      await wait(8000);
      // The ratings may only show under the panel's "expired" warning; the Today card shows none.
      const card = await text(p, ".tdy[data-sp=ski] .tdy-avy");
      const panel = await text(p, "#avCard");
      const bad = [];
      if (/Considerable|Moderate|Low|High|Extreme/.test(card)) bad.push(`the Today card still shows yesterday's ratings: "${card.slice(0, 100)}"`);
      if (/Considerable|Moderate|\bLow\b|\bHigh\b|Extreme/.test(panel) && !/expired/i.test(panel)) bad.push(`the avalanche panel shows ratings without saying they expired: "${panel.slice(0, 100)}"`);
      return bad.join(" · ");
    }, 500);
    await step(p, "40 h later, no signal: Today card", async () => {
      await today(p, "ski");
      const left = await stillWaiting(p, "ski", 30_000);
      if (left.length) return `still waiting: ${left.join(", ")}`;
      const t = await text(p, todaySel("ski"));
      const bad = [];
      if (/\b[1-5] (Low|Moderate|Considerable|High|Extreme)\b/.test(t)) bad.push("an avalanche rating from the old bulletin shows");
      if (!/run out|expired|no rating/i.test(t)) bad.push("no word on why no rating shows");
      if (!/No signal/i.test(t)) bad.push("no word of the missing signal");
      return bad.join(" · ");
    });
    await closeToday(p);
    await p.ctx.close();
  },
  // Location not shared (the phone's setting off, or "Don't allow").
  async location() {
    const p = await phone({ opts: { permissions: [] }, init: () => {
      const err = { code: 1, message: "User denied Geolocation", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
      navigator.geolocation.getCurrentPosition = (ok, bad) => setTimeout(() => bad && bad(err), 100);
      navigator.geolocation.watchPosition = (ok, bad) => { setTimeout(() => bad && bad(err), 100); return 1; };
    } });
    await open(p);
    for (const [name, sel, sp] of [["My location", "#locate", "mtb"], ["Near me (MTB)", "#nearBtn", "mtb"]]) {
      await step(p, `${name} says location is off`, async () => {
        await pick(p, sp);
        const ok = await p.page.evaluate((s) => { const b = document.querySelector(s); if (!b) return false; b.click(); return true; }, sel);
        if (!ok) return `no ${sel} button`;
        await wait(4000);
        const t = await p.page.evaluate(() => document.body.innerText);
        return /Location wasn't shared|location is off|Allow location/i.test(t) ? "" : "no words saying location wasn't shared";
      });
      await p.page.keyboard.press("Escape").catch(() => {});
    }
    for (const sp of SPORTS.filter((s) => s !== "mtb")) {
      await step(p, `${NAMES[sp]}: Today card from the map's middle`, async () => {
        await pick(p, sp); await today(p, sp);
        const left = await stillWaiting(p, sp, 45_000);
        return left.length ? `still waiting after 45 s: ${left.join(", ")}` : "";
      });
      await closeToday(p);
    }
    await p.ctx.close();
  },
  // Put away and taken out, three times, on the 3D map (Skiing) and the flat map (each other sport).
  async background() {
    const p = await phone();
    await open(p);
    for (const sp of SPORTS) {
      await step(p, `${NAMES[sp]}: away and back 3 times`, async () => {
        await pick(p, sp); await wait(sp === "ski" ? 8000 : 3000);
        for (let i = 0; i < 3; i++) { await away(p); await wait(2500); await back(p); await wait(2500); }
        const s = await p.page.evaluate(() => ({ map: !!document.querySelector("#map .leaflet-tile-loaded, #map canvas"), sport: (document.getElementById("sport") || {}).value }));
        return s.sport !== sp ? `came back in ${s.sport}` : s.map ? "" : "the map is empty after coming back";
      });
    }
    await p.ctx.close();
  },
  // The phone takes the 3D map's graphics away (low memory), then gives them back.
  async memory() {
    const p = await phone();
    await open(p);
    await pick(p, "ski"); await wait(10_000);
    await step(p, "Skiing 3D: graphics dropped and back", async () => {
      const lost = await p.page.evaluate(() => {
        const c = document.querySelector(".maplibregl-canvas");
        const gl = c && (c.getContext("webgl2") || c.getContext("webgl"));
        const ext = gl && gl.getExtension("WEBGL_lose_context");
        if (!ext) return "no";
        window.__lose = ext; ext.loseContext(); return "lost";
      });
      if (lost !== "lost") return "";   // this browser can't drop them on purpose: nothing to try
      await wait(3000);
      await p.page.evaluate(() => window.__lose && window.__lose.restoreContext());
      await wait(8000);
      const s = await p.page.evaluate(() => ({ is3d: !!document.querySelector("#map.is3d"), canvas: !!document.querySelector(".maplibregl-canvas") }));
      return s.is3d && !s.canvas ? "the 3D map is gone (no picture) after the graphics came back" : "";
    }, 2000);
    await step(p, "Skiing 3D: put away and back after it", async () => { await away(p); await wait(3000); await back(p); await wait(6000); });
    await p.ctx.close();
  },
  // The phone in dark mode: no text too faint on its background.
  async dark() {
    const p = await phone({ opts: { colorScheme: "dark" } });
    await open(p);
    for (const sp of SPORTS) {
      await step(p, `${NAMES[sp]}: every text readable`, async () => {
        await pick(p, sp); await wait(3000); await today(p, sp); await stillWaiting(p, sp, 30_000);
        const low = await p.page.evaluate(faint);
        return low.length ? `text too faint to read: ${low.join(", ")}` : "";
      });
      await closeToday(p);
      if (sp !== "mtb") {
        await step(p, `${NAMES[sp]}: sport's tab readable`, async () => {
          await p.page.locator(`#tabbar [data-nav=${sp}]`).click({ timeout: 8000 }).catch(() => {});
          await wait(1500);
          const low = await p.page.evaluate(faint);
          return low.length ? `text too faint to read: ${low.join(", ")}` : "";
        });
        await p.page.locator("#tabbar [data-nav=map]").click({ timeout: 5000 }).catch(() => {});
      }
    }
    await p.ctx.close();
  },
  // iPhone SE size, and a zoomed display (Display Zoom, or the smallest phones).
  async small() {
    for (const vp of [{ width: 375, height: 667 }, { width: 320, height: 568 }]) {
      const p = await phone({ opts: { viewport: vp } });
      await open(p);
      for (const sp of SPORTS) {
        await step(p, `${vp.width}×${vp.height} ${NAMES[sp]}: map and every tab fit`, async () => {
          await pick(p, sp); await wait(3000);
          const bad = [];
          const tabs = await p.page.$$eval("#tabbar button[data-nav]", (bs) => bs.filter((b) => b.offsetParent).map((b) => b.dataset.nav));
          if (!tabs.length) bad.push("no bottom bar");
          const cut = async (where) => { const c = await p.page.evaluate(cutOff); if (c.length) bad.push(`${where}: cut off at the edge: ${c.join(", ")}`); };
          await cut("map");
          for (const t of tabs.filter((t) => t !== "map")) {
            await p.page.locator(`#tabbar [data-nav=${t}]`).click({ timeout: 8000 });
            await wait(1200);
            await cut(`tab ${t}`);
            await p.page.locator("#tabbar [data-nav=map]").click({ timeout: 5000 }).catch(() => p.page.keyboard.press("Escape"));
            await wait(400);
          }
          return bad.join(" · ");
        });
      }
      await p.ctx.close();
    }
  },
  // The website on a phone turned sideways (the apps stay upright, alex 2026-11-27): the computer layout, with every
  // map button on the screen (they wrap into a second column), in each sport.
  async sideways() {
    const p = await phone({ opts: { viewport: { width: 932, height: 430 } } });
    await open(p);
    for (const sp of SPORTS) {
      await step(p, `${NAMES[sp]}: every map button on the screen`, async () => {
        await p.page.evaluate((s) => { const e = document.getElementById("sport"); e.value = s; e.dispatchEvent(new Event("change", { bubbles: true })); }, sp);
        await p.page.waitForFunction((s) => document.body.classList.contains(`sport-${s}`) || s === "mtb", sp, { timeout: 15_000 }).catch(() => {});
        await wait(sp === "ski" ? 6000 : 2500);
        const off = await p.page.evaluate(() => [...document.querySelectorAll(".map-tools > *")].filter((e) => e.getClientRects().length && getComputedStyle(e).position !== "absolute")
          .filter((e) => { const r = e.getBoundingClientRect(); return r.bottom > innerHeight - 4 || r.top < 0 || r.left < 0 || r.right > innerWidth; })
          .map((e) => (e.textContent || e.id).trim().slice(0, 20)));
        return off.length ? `map buttons off the screen: ${off.join(", ")}` : "";
      });
    }
    await p.ctx.close();
  },
};

// Text on screen whose colour is too close to the colour behind it (contrast under 2.5 to 1; 4.5 is the usual goal
// for small text, so only what can hardly be read at all fails). Maps, pictures and coloured chips' own colours aside.
function faint() {
  const parse = (c) => { const m = String(c).match(/[\d.]+/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const behind = (el) => { for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage && s.backgroundImage !== "none") return null; const c = parse(s.backgroundColor); if (c && c.a >= 0.6) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (!own || !el.getClientRects().length) continue;
    if (el.closest(".leaflet-pane, .leaflet-control-attribution, .maplibregl-map canvas, svg, [aria-hidden=true], .tf-toast")) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || +s.opacity < 0.3) continue;
    const fg = parse(s.color), bg = behind(el);
    if (!fg || !bg || fg.a < 0.5) continue;
    const a = lum(fg), b = lum(bg), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (ratio < 2.5) out.push(`"${own.slice(0, 30)}" (${ratio.toFixed(1)}:1)`);
  }
  return [...new Set(out)].slice(0, 8);
}
// Buttons and links past the screen's left or right edge, unless inside a row that scrolls sideways.
function cutOff() {
  const out = [];
  for (const el of document.querySelectorAll("button, a[href], input, select")) {
    if (!el.getClientRects().length || el.closest(".leaflet-control-attribution, .maplibregl-ctrl-attrib, [hidden]")) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
    if (r.right <= innerWidth + 1 && r.left >= -1) continue;
    let scrolls = false;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if ((o === "auto" || o === "scroll") && e.scrollWidth > e.clientWidth) { scrolls = true; break; } }
    if (!scrolls) out.push(`${(el.textContent || el.getAttribute("aria-label") || el.id || el.tagName).trim().slice(0, 24)}`);
  }
  return [...new Set(out)].slice(0, 8);
}

for (const key of Object.keys(CONDS)) {
  if (ONLY.length && !ONLY.includes(key)) continue;
  cond = key;
  console.log(`\n== ${TITLES[key]}`);
  const t = Date.now();
  try { await CONDS[key](); } catch (e) { results.push({ cond, step: "Stopped", ok: false, note: String(e.message || e).split("\n")[0].slice(0, 200), shot: "" }); console.log(`✗ ${TITLES[key]} stopped: ${e.message}`); }
  console.log(`   (${Math.round((Date.now() - t) / 1000)} s)`);
}
await browser.close();
server.close();

// ---------- report ----------
const bad = results.filter((r) => !r.ok);
const md = [`## 🌧 Tough conditions (${BROWSER === "webkit" ? "Safari engine" : BROWSER}, iPhone ${PHONE.viewport.width}×${PHONE.viewport.height})`, "",
  bad.length ? `**${bad.length} problem${bad.length > 1 ? "s" : ""}** in ${results.length} steps.` : `**All ${results.length} steps passed.**`, "",
  "| Condition | Step | Result |", "|---|---|---|",
  ...results.map((r) => `| ${TITLES[r.cond]} | ${r.step} | ${r.ok ? "✓" : "✗ " + r.note.replace(/\|/g, "\\|")} |`), "",
  "Screenshots of every step: the **conditions-screenshots** download at the bottom of this run's page."].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n");
console.log(`\n${bad.length ? `${bad.length} problem(s)` : "All passed"} in ${results.length} steps.`);
process.exit(bad.length ? 1 : 0);
