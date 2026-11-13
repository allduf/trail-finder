// Soak test (see .github/workflows/soak-test.yml, alex 2026-11-13): the crashes on the usage page are almost all an
// iPhone killing the app for using too much memory, after many minutes in the 3D map, switching sports, or coming back
// to the app. The phone test spends seconds on each step and can't see that. This one uses the app like a long day
// out, for MINUTES (30) at iPhone size, and fails when memory keeps climbing instead of levelling off.
//
// One round, over and over: pick the next sport (Skiing, MTB, Hunting, Hiking), 3D on, fly to the next place
// (Whistler, Squamish, Pemberton, Revelstoke, Rossland, Kicking Horse), turn and tilt there like a thumb would, then
// every third round send the app to the background for 20 s and bring it back (hidden, page frozen, shown again).
// At the end of each round the garbage is collected and memory measured:
//   - JS heap: what the page's scripts hold (Chrome's count).
//   - Total: the browser's processes together (page, GPU, network), Pss from /proc: this includes the 3D map's
//     textures and buffers, the part that grows most on an iPhone.
// The JS heap is capped at HEAP_MB (512) like a phone's tab, so a real leak ends in "out of memory" here too.
//
// It fails when: the page crashes; total memory goes over MAX_MB; or, after WARM minutes (5) to let the caches fill,
// the last third of the rounds sits higher than the first third by more than GROW_MB (250 total / 60 JS heap) and
// GROW_PCT (25%), and the trend line still points up (memory "keeps climbing"). Each sport and place is visited many
// times, so a cache that is full should stay flat.
//
// Chromium, not WebKit: only Chromium lets a test read memory. The page is the same; the numbers are not an iPhone's,
// but what climbs here climbs there.
//
// Run: node scripts/soak-test.mjs   (needs the playwright package and its Chromium)
// Optional: MINUTES (30), WARM (5), SLOW_S (10), MAX_MB (3000), HEAP_MB (512), GROW_MB (250), HEAP_GROW_MB (60), GROW_PCT (25),
//           OUT (soak-test-out), CHROMIUM (a Chromium to use).

import { createServer } from "node:http";
import { readFile, mkdir, appendFile, writeFile, readdir } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
const MINUTES = num("MINUTES", 30), WARM = num("WARM", Math.min(5, MINUTES / 4)), MAX_MB = num("MAX_MB", 3000), HEAP_MB = num("HEAP_MB", 512);
const GROW_MB = num("GROW_MB", 250), HEAP_GROW_MB = num("HEAP_GROW_MB", 60), GROW_PCT = num("GROW_PCT", 25);
const OUT = process.env.OUT || "soak-test-out";
const LIVE = "https://trailfinderapp.ca/";
const SPORTS = ["ski", "mtb", "hunt", "hike"];
const NAMES = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", hike: "Hiking" };
const PLACES = [
  ["Whistler", -122.95, 50.09], ["Squamish", -123.13, 49.72], ["Pemberton", -122.80, 50.32],
  ["Revelstoke", -118.16, 50.96], ["Rossland", -117.82, 49.10], ["Kicking Horse", -117.06, 51.295],
];
// Code libraries, fonts, map pictures and heights only: everything else outside is cut off (as in phone-test.mjs).
const ALLOWED = new Set(["unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com",
  "tile.openstreetmap.org", "tiles.openfreemap.org", "tiles.mapterhorn.com", "ibasemaps-api.arcgis.com", "server.arcgisonline.com",
  "allduf.github.io", "s3.amazonaws.com", "trailfinderapp.ca"]);
const PHONE = {
  viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,   // iPhone 15/16 Pro Max
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  geolocation: { latitude: 50.1163, longitude: -122.9574 }, permissions: ["geolocation"], locale: "en-CA", timezoneId: "America/Vancouver",
  serviceWorkers: "block",
};

// ---------- the site, on localhost (as phone-test.mjs) ----------
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
      const r = await fetch(/^trail-finder-winter2?\//.test(path) ? "https://allduf.github.io/" + path : LIVE + path);
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502).end(); }
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const SITE = `http://localhost:${server.address().port}/`;

// ---------- memory ----------
// All the browser's processes: Pss counts memory shared between them once.
async function pids(top) {
  const kids = new Map();
  for (const d of await readdir("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    const st = await readFile(`/proc/${d}/stat`, "utf8").catch(() => "");
    const ppid = Number(st.slice(st.lastIndexOf(")") + 2).split(" ")[1]);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(Number(d));
  }
  const out = [], todo = [top];
  while (todo.length) { const p = todo.pop(); out.push(p); todo.push(...(kids.get(p) || [])); }
  return out;
}
async function totalMb(top) {
  let kb = 0;
  for (const p of (await pids(top)).filter((p) => p !== process.pid)) {
    const t = await readFile(`/proc/${p}/smaps_rollup`, "utf8").catch(() => "");
    const m = t.match(/^Pss:\s+(\d+)/m);
    if (m) kb += Number(m[1]);
  }
  return Math.round(kb / 1024);
}

// ---------- the phone ----------
const pw = await import("playwright");
const browser = await pw.chromium.launch({
  ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
  args: [`--js-flags=--max-old-space-size=${HEAP_MB}`, "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
// The browser runs as a child of this script: everything under it, minus this script itself.
const top = process.platform === "linux" ? process.pid : null;
await mkdir(OUT, { recursive: true });
const ctx = await browser.newContext(PHONE);
await ctx.route("**/*", (route) => {
  const u = new URL(route.request().url());
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost" || ALLOWED.has(u.hostname) || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
  return route.abort();
});
// The app's own load timings (the usage page's Speed card: map pictures, new trails list, 3D mountains), kept here:
// on the website usage.js sends nothing, so window.tfUse is caught before it.
await ctx.addInitScript(() => {
  const got = (window.__soakSpeed = []);
  const use = (kind, what, ms) => { if (kind === "speed") got.push([what, Math.round(ms)]); };
  Object.defineProperty(window, "tfUse", { configurable: true, get: () => use, set: () => {} });
  try { performance.setResourceTimingBufferSize(20000); } catch {}
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
let crashed = "";
page.on("crash", () => { crashed = "the page crashed (out of memory)"; });
page.on("pageerror", (e) => { if (/out of memory|Maximum call stack/i.test(String(e.message))) crashed = String(e.message).slice(0, 200); });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const tap = (sel) => page.locator(sel).first().click({ timeout: 8000 });

await page.goto(SITE + "index.html", { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector("#sportMapBtn", { timeout: 60_000 });
if (await page.locator("dialog.tf-terms [data-terms=ok]").click({ timeout: 6000 }).then(() => true, () => false))
  await page.waitForSelector("dialog.welc[open]", { timeout: 4000 }).catch(() => {});
await page.keyboard.press("Escape").catch(() => {});
await wait(3000);

async function pickSport(s) {
  if (await page.evaluate(() => (document.getElementById("sport") || {}).value) === s) return;
  await page.keyboard.press("Escape").catch(() => {});
  await tap("#sportMapBtn");
  await tap(`#sportMenu [data-sport=${s}]`);
  await page.waitForFunction((x) => (document.getElementById("sport") || {}).value === x, s, { timeout: 10_000 });
}
async function threeD() {
  if (await page.locator("#btn3d").first().getAttribute("aria-pressed").catch(() => null) !== "true") await tap("#btn3d").catch(() => {});
  await page.waitForFunction(() => !!window.trailMap3d && !!document.querySelector("#btn3d[aria-pressed=true]"), null, { timeout: 30_000 });
}
// How long until the 3D map has the ground of a new view: the same test as the usage page's "3D mountains"
// (map3d.js allIn): the heights and the shown photos of the view all in, the map still (30 s at most).
// Where the wait went: for each server, when its last download for the view ended (s after the start) and how many.
// A wait much longer than the downloads is the phone drawing, not the network.
let lastNet = "";
async function groundReady() {
  const t0 = Date.now();
  const p0 = await page.evaluate(() => { performance.clearResourceTimings(); return performance.now(); });
  await page.waitForFunction(() => {
    const g = window.trailMap3d;
    if (!g || g.isMoving()) return false;
    const photo = ["winter", "live", "sat"].find((id) => g.getLayer(id) && g.getLayoutProperty(id, "visibility") !== "none") || "sat";
    return ["dem", photo].every((id) => !g.getSource(id) || g.isSourceLoaded(id));
  }, null, { timeout: 30_000, polling: 100 }).catch(() => {});
  const ms = Date.now() - t0;
  lastNet = await page.evaluate((p0) => {
    const by = new Map();
    for (const e of performance.getEntriesByType("resource")) {
      const h = new URL(e.name).hostname.replace(/^localhost$|^127\.0\.0\.1$/, "app"), g = by.get(h) || { n: 0, end: 0 };
      g.n++; g.end = Math.max(g.end, e.responseEnd - p0); by.set(h, g);
    }
    return [...by.entries()].sort((a, b) => b[1].end - a[1].end).slice(0, 4).map(([h, g]) => `${h} ${(g.end / 1000).toFixed(1)} s (${g.n})`).join(", ");
  }, p0).catch(() => "");
  return ms;
}
// Flies there, then turns and tilts a few times like a thumb on the screen, waiting for the ground each time.
async function lookAround([, lon, lat], r) {
  let ground = 0;
  await page.evaluate(([lon, lat]) => window.trailMap3d.jumpTo({ center: [lon, lat], zoom: 12.5, pitch: 55, bearing: 0 }), [lon, lat]);
  ground = await groundReady();
  await wait(Math.max(0, 6000 - ground));
  for (let i = 0; i < 4; i++) {
    await page.evaluate(([lon, lat, i, r]) => window.trailMap3d.easeTo({
      center: [lon + 0.03 * Math.cos(i + r), lat + 0.02 * Math.sin(i + r)], zoom: 12 + (i % 3) * 0.8, pitch: 40 + (i % 2) * 25, bearing: (i * 95 + r * 37) % 360, duration: 2500,
    }), [lon, lat, i, r]);
    await wait(4500);
  }
  return ground;
}
// The app goes to the background (hidden, page frozen like iOS does) and comes back 20 s later.
async function background() {
  const flip = (hidden) => page.evaluate((h) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
    if (h) dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); else dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  }, hidden);
  await flip(true);
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" }).catch(() => {});
  await wait(20_000);
  await cdp.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
  await flip(false);
  await wait(5000);
}
async function measure() {
  await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
  await wait(1500);
  const { metrics } = await cdp.send("Performance.getMetrics");
  const heap = Math.round((metrics.find((m) => m.name === "JSHeapUsedSize") || {}).value / 1048576);
  return { heap, total: top ? await totalMb(top) : null };
}

const start = Date.now(), samples = [];
let round = 0, problem = "";
console.log(`Soak test: ${MINUTES} min, JS heap capped at ${HEAP_MB} MB, iPhone ${PHONE.viewport.width}×${PHONE.viewport.height} @${PHONE.deviceScaleFactor}x`);
while (Date.now() - start < MINUTES * 60e3 && !crashed) {
  const sport = SPORTS[round % SPORTS.length], place = PLACES[round % PLACES.length];
  let note = "", sw = null, ground = null, net = "";
  try {
    const t0 = Date.now();
    await pickSport(sport);
    await threeD();
    await groundReady();
    sw = Date.now() - t0;
    ground = await lookAround(place, round);
    net = lastNet;
    if (round % 3 === 2) { await background(); note = "back from background"; }
  } catch (e) { note = "step failed: " + String(e.message || e).split("\n")[0].slice(0, 120); }
  if (crashed) break;
  const m = await measure().catch((e) => { crashed = "the page stopped answering: " + String(e.message || e).slice(0, 120); return null; });
  if (!m) break;
  const min = (Date.now() - start) / 60e3;
  samples.push({ round, min, sport, place: place[0], ...m, sw, ground, net, note });
  const sec = (ms) => (ms == null ? "  ?" : (ms / 1000).toFixed(1).padStart(4)) + " s";
  console.log(`${min.toFixed(1).padStart(5)} min  ${NAMES[sport].padEnd(7)} ${place[0].padEnd(13)} JS heap ${String(m.heap).padStart(4)} MB  total ${String(m.total ?? "?").padStart(5)} MB  switch ${sec(sw)}  new place ${sec(ground)}  ${note}${net ? `\n          downloads: ${net}` : ""}`);
  if (m.total != null && m.total > MAX_MB) { problem = `total memory ${m.total} MB, over the ${MAX_MB} MB limit`; break; }
  round++;
}
const appSpeed = await page.evaluate(() => {
  const out = [...(window.__soakSpeed || [])];
  const n = performance.getEntriesByType("navigation")[0];
  if (n && n.loadEventEnd > 0) out.push(["page", Math.round(n.loadEventEnd)]);
  return out;
}).catch(() => []);
await page.screenshot({ path: join(OUT, "last.png") }).catch(() => {});
await browser.close().catch(() => {});
server.close();

// ---------- verdict ----------
const after = samples.filter((s) => s.min >= WARM);
const slope = (k) => {   // MB per 10 minutes, least squares over the rounds after warm-up
  const xs = after.map((s) => s.min), ys = after.map((s) => s[k]);
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  const d = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return d ? (10 * xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0)) / d : 0;
};
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
const climb = [];
if (after.length >= 6) {
  const third = Math.floor(after.length / 3);
  for (const [k, label, lim] of [["total", "Total memory", GROW_MB], ["heap", "JS heap", HEAP_GROW_MB]]) {
    if (after.some((s) => s[k] == null)) continue;
    const a = median(after.slice(0, third).map((s) => s[k])), b = median(after.slice(-third).map((s) => s[k])), sl = slope(k);
    const line = `${label}: ${a} MB → ${b} MB after warm-up (${sl >= 0 ? "+" : ""}${Math.round(sl)} MB per 10 min)`;
    climb.push(line);
    if (b - a > lim && (b - a) / Math.max(a, 1) * 100 > GROW_PCT && sl > 0) problem = problem || `${line}: keeps climbing`;
  }
} else if (!crashed && !problem) problem = `too few rounds after warm-up (${after.length}) to tell`;
// Speed: the app's own timings (first open) and, every round, how long a sport switch and a new place take to show
// their 3D ground. alex 2026-11-13: every load under 10 s, the slow one in ten too, so it fails when any wait's
// "slow" (1 in 10) is over SLOW_S (10) seconds (first 3D opens excepted, see below).
const SLOW_S = num("SLOW_S", 10);
const app = await Promise.resolve(appSpeed);
const q = (a, p) => { const b = a.filter((x) => x != null).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : null; };
// The first 3D open of each sport is reported but not held to the limit: this computer draws 3D with no graphics chip,
// 300-500 ms a frame (measured 2026-11-13: ~13 s of a 14 s first open was drawing, each download 0.2-0.7 s), and the
// map asks for the next tiles only between frames. A phone's first open is the usage page's "3D mountains".
const firsts = new Set(), first = [], again = [];
for (const x of samples) (firsts.has(x.sport) ? again : first).push(x), firsts.add(x.sport);
const speedRows = [
  ...[["page", "App ready"], ["map", "Map pictures"], ["list", "New trails list"], ["3dshape", "3D mountains shown (first open)", true], ["3d", "3D sharp photos all in (first open)", true]].map(([k, l, free]) => {
    const v = app.filter((x) => x[0] === k).map((x) => x[1]); return [l, q(v, 0.5), q(v, 0.9), v.length, free];
  }),
  ["Sport switch to 3D ground (again)", q(again.map((s) => s.sw), 0.5), q(again.map((s) => s.sw), 0.9), again.filter((s) => s.sw != null).length],
  ["First 3D open of each sport (not held to the limit here)", q(first.map((s) => s.sw), 0.5), q(first.map((s) => s.sw), 0.9), first.filter((s) => s.sw != null).length, true],
  ["New place: 3D ground in", q(samples.map((s) => s.ground), 0.5), q(samples.map((s) => s.ground), 0.9), samples.filter((s) => s.ground != null).length],
];
const tooSlow = speedRows.filter(([, , slow, , free]) => !free && slow != null && slow > SLOW_S * 1000);
if (!problem && tooSlow.length) problem = tooSlow.map(([l, , slow]) => `${l}: 1 in 10 takes ${(slow / 1000).toFixed(1)} s`).join("; ") + ` (limit ${SLOW_S} s)`;
const secs = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)} s`);
const fail = crashed || problem;

await writeFile(join(OUT, "memory.csv"), "minute,round,sport,place,js_heap_mb,total_mb,switch_ms,new_place_ms,note\n" +
  samples.map((s) => [s.min.toFixed(2), s.round, s.sport, s.place, s.heap, s.total ?? "", s.sw ?? "", s.ground ?? "", JSON.stringify(s.note)].join(",")).join("\n") + "\n");
const md = [`## Soak test (${MINUTES} min, iPhone ${PHONE.viewport.width}×${PHONE.viewport.height}, JS heap cap ${HEAP_MB} MB)`, "",
  fail ? `**✗ ${fail}**` : `**✓ Memory levels off**: ${samples.length} rounds of 3D in ${SPORTS.map((s) => NAMES[s]).join(", ")}, with trips to the background.`, "",
  ...climb.map((l) => `- ${l}`), "",
  "| Wait | Usual | Slow (1 in 10) | Times |", "|---|---|---|---|", ...speedRows.map(([l, a, b, n]) => `| ${l} | ${secs(a)} | ${secs(b)} | ${n} |`), "",
  "| Minute | Sport | Place | JS heap MB | Total MB | Switch | New place | Last downloads in | |", "|---|---|---|---|---|---|---|---|---|",
  ...samples.map((s) => `| ${s.min.toFixed(1)} | ${NAMES[s.sport]} | ${s.place} | ${s.heap} | ${s.total ?? "?"} | ${secs(s.sw)} | ${secs(s.ground)} | ${s.net} | ${s.note} |`), "",
  "Every round in the **soak-test** download (memory.csv) with the last screen."].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n");
console.log("\n" + speedRows.map(([l, a, b, n]) => `${l}: usual ${secs(a)}, slow ${secs(b)} (${n}x)`).join("\n") + "\n" + climb.join("\n") + `\n${fail ? "FAILED: " + fail : "Passed: memory levels off."}`);
process.exit(fail ? 1 : 0);
