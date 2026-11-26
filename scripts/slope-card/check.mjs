// Slope card check (2026-11-26: on the iPhone the native 3D slope card squeezed most of its rows to nothing, among them
// "Striped because"). In the app's test build (Debug: the iPhone simulator or the Android simulator), Skiing with the
// avalanche shading on, native 3D, then a slope "tapped" (the test-only "check" key in NativeAvalanche.swift / .java,
// as a finger's tap does). The native card then says how its rows came out ("avySpotLaid"): it fails when a row the page
// sent is missing, shows no text, or a line is cut short. Run by .github/workflows/slope-card.yml:
//   PLATFORM=ios|android node scripts/slope-card/check.mjs        (screenshots and result in out/slope-card/)
// The site and the page bridge are the ones of scripts/side-by-side/run.mjs (this checkout on localhost:8080, the live
// site's data files, /__sbs.js runs what this script asks).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, extname, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const PLATFORM = process.env.PLATFORM === "ios" ? "ios" : "android", ios = PLATFORM === "ios";
const APP = "com.allduf.trailfinder";
const OUT = join(process.cwd(), "out", "slope-card");
// A steep slope on Whistler Mountain's west side, in Avalanche Canada's Sea-to-Sky area (the treeline band).
const SLOPE = (process.env.SLOPE || "50.0675,-122.968").split(",").map(Number);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tryp = (c, t = 60000) => { try { return execSync(c, { encoding: "utf8", shell: "/bin/bash", stdio: ["ignore", "pipe", "pipe"], timeout: t }); } catch { return ""; } };

// ---------- the site, with the page bridge (as scripts/side-by-side/run.mjs) ----------
const LIVE = "https://trailfinderapp.ca/";
const root = fileURLToPath(new URL("../../", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".pbf": "application/x-protobuf", ".txt": "text/plain" };
const BRIDGE = `(() => {
  if (window.__sbs) return; window.__sbs = 1;
  const pid = Math.random().toString(36).slice(2), f = window.fetch.bind(window);
  window.alert = () => {}; window.confirm = () => true;
  (async () => {
    for (;;) {
      let c;
      try { const r = await f("/__cmd?pid=" + pid, { cache: "no-store" }); if (r.status !== 200) { await new Promise((z) => setTimeout(z, 300)); continue; } c = await r.json(); }
      catch { await new Promise((z) => setTimeout(z, 1000)); continue; }
      let out;
      try { out = { id: c.id, value: await (0, eval)(c.code) }; } catch (e) { out = { id: c.id, error: String(e && e.message || e) }; }
      try { JSON.stringify(out); } catch { out = { id: c.id, value: null }; }
      await f("/__res", { method: "POST", body: JSON.stringify(out) }).catch(() => {});
    }
  })();
})();`;
// Whistler for the page's location, so the system's "localhost would like to use your location" box can't cover the card.
const GEO = `(() => { const at = { coords: { latitude: 50.1135, longitude: -122.954, accuracy: 10, altitude: 670, heading: null, speed: null, altitudeAccuracy: null } }; const g = navigator.geolocation; if (g) { g.getCurrentPosition = (ok) => setTimeout(() => ok({ ...at, timestamp: Date.now() }), 50); g.watchPosition = (ok) => { setTimeout(() => ok({ ...at, timestamp: Date.now() }), 50); return 1; }; g.clearWatch = () => {}; } })();`;
let current = null, seq = 0;
const queue = [], inflight = new Map(), polls = [];
const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => d += c); req.on("end", () => { try { r(JSON.parse(d)); } catch { r({}); } }); });
const answer = (res, c) => { inflight.set(c.id, c); res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ id: c.id, code: c.code })); };
function serveCmd(res, pid) {
  if (pid !== current) { current = pid; for (const [, w] of inflight) w.done({ error: "page reloaded" }); inflight.clear(); }   // a new page
  const c = queue.shift();
  if (c) { answer(res, c); return; }
  const p = { res, pid, t: setTimeout(() => { polls.splice(polls.indexOf(p), 1); res.writeHead(204).end(); }, 15000) };
  polls.push(p);
}
function kick() {
  while (queue.length) {
    const p = polls.find((x) => x.pid === current);
    if (!p) return;
    polls.splice(polls.indexOf(p), 1); clearTimeout(p.t);
    answer(p.res, queue.shift());
  }
}
const fromLive = async (res, path, search) => {
  const r = await fetch(LIVE + path + (search || ""));
  res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer()));
  return r.ok;
};
createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__sbs.js") { res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(BRIDGE); return; }
  if (u.pathname === "/__cmd") { serveCmd(res, u.searchParams.get("pid")); kick(); return; }
  if (u.pathname === "/__res") { const b = await body(req); const w = inflight.get(b.id); if (w) { inflight.delete(b.id); w.done(b); } res.writeHead(204).end(); return; }
  let path, file;
  try { path = decodeURIComponent(u.pathname).replace(/^\/+/, "") || "index.html"; file = normalize(join(root, path)); }
  catch { res.writeHead(400).end(); return; }
  try {
    if (/^data\//.test(path)) { await fromLive(res, path, u.search); return; }   // the live site's data files (site-data branch)
    if (!file.startsWith(root) || /^(\.git|\.github|scripts|supabase|ios-app|android-app|out|node_modules)(\/|$)/.test(relative(root, file))) throw new Error("not served");
    let data = await readFile(file);
    if (extname(file) === ".html") data = Buffer.from(String(data).replace(/<head([^>]*)>/i, `<head$1><script src="/__sbs.js"></script><script>${GEO}</script>`));
    if (path === "sw.js") data = Buffer.from("self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()));");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(data);
  } catch {
    try { await fromLive(res, path, u.search); } catch { if (!res.headersSent) res.writeHead(502).end(); }
  }
}).listen(8080, "127.0.0.1");

function js(code, ms = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const t = setTimeout(() => { const i = queue.findIndex((c) => c.id === id); if (i >= 0) queue.splice(i, 1); inflight.delete(id); reject(new Error("the page didn't answer")); }, ms);
    queue.push({ id, code, done: (r) => { clearTimeout(t); r.error ? reject(new Error(r.error)) : resolve(r.value); } });
    kick();
  });
}
const jsq = (code, d = null) => js(code, 20000).catch(() => d);
async function pageUp(ms = 90000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await js("document.readyState === 'complete' && !!document.getElementById('map')", 5000).catch(() => false)) return true; await sleep(1000); }
  return false;
}
const launch = () => tryp(ios ? `xcrun simctl launch booted ${APP}` : `adb shell am start -W -n ${APP}/.MainActivity`);
const kill = () => tryp(ios ? `xcrun simctl terminate booted ${APP}` : `adb shell am force-stop ${APP}`);
const shot = (name) => tryp(ios ? `xcrun simctl io booted screenshot --type=png "${join(OUT, name)}"` : `adb exec-out screencap -p > "${join(OUT, name)}"`, 30000);
const click = (sel) => jsq(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`, false);
// A real finger on Android (its 3D button opens native 3D only for a real tap); a page click on the iPhone. Where the
// page starts on the screen is measured once with a tap the page catches (as scripts/side-by-side/run.mjs).
let topPx = null;
async function tap(sel) {
  if (ios) return click(sel);
  const r = await jsq(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, dpr: devicePixelRatio, ih: innerHeight }; })()`);
  if (!r) return false;
  if (topPx == null) {
    topPx = 0;
    await jsq(`(() => { window.__tapY = null; const d = document.createElement("div"); d.id = "__probe"; d.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:transparent";
      d.addEventListener("touchstart", (e) => { window.__tapY = e.touches[0].clientY; e.preventDefault(); e.stopPropagation(); }, { passive: false }); document.body.append(d); })()`);
    const y = Math.round(r.ih * r.dpr * 0.45);
    tryp(`adb shell input tap 20 ${y}`);
    await sleep(800);
    const cy = await jsq("window.__tapY");
    await jsq(`document.getElementById("__probe")?.remove()`);
    if (cy != null) topPx = Math.round(y - cy * r.dpr);
  }
  tryp(`adb shell input tap ${Math.round(r.x * r.dpr)} ${Math.round(r.y * r.dpr + topPx)}`);
  return true;
}
const nativeOpen = () => jsq(`!!(window.tfNative && window.tfNative.isOpen())`, false);
const layer = (key, data) => jsq(`Capacitor.Plugins.TrailMap.layer({ key: ${JSON.stringify(key)}, data: ${JSON.stringify(JSON.stringify(data))} }).then(() => true, (e) => String(e))`, "no answer");

const problems = [], notes = [];
const log = (s) => { console.log(s); notes.push(s); };
(async () => {
  launch();
  for (let i = 0; i < 4 && !(await pageUp()); i++) { kill(); await sleep(2000); launch(); }
  await jsq(`(() => { localStorage.setItem("tf-admin", "1"); localStorage.setItem("tf:welcomed", "true"); localStorage.setItem("tf:todayAuto", "false"); localStorage.setItem("tf:skiGuest", "true"); localStorage.setItem("tf:lang", "en"); localStorage.setItem("tf:avy", "true"); location.reload(); })()`);
  await sleep(4000); await pageUp();
  await click("dialog.tf-terms [data-terms=ok]");
  await jsq(`document.querySelectorAll("dialog[open]").forEach((d) => d.close())`);
  await click("#sportMapBtn"); await sleep(800); await click("#sportMenu [data-sport=ski]"); await sleep(10000);
  await jsq(`document.querySelectorAll("dialog[open]").forEach((d) => d.close())`);
  await jsq(`window.tfLeaflet.setView([${SLOPE[0]}, ${SLOPE[1]}], 14, { animate: false })`); await sleep(5000);
  // Out of season (no forecast): Avalanche Canada's example, so the card still has every kind of row.
  const card = () => jsq(`(() => { const c = document.getElementById("avCard"); return !!c && !c.hidden; })()`, false);
  if (await click("#avEx")) { log("no rated forecast here: the example forecast is used"); await sleep(3000); }
  log(`avalanche card on the page: ${await card()}`);
  // Native 3D, as the 3D button opens it (the trip sheet's OK first, when it asks).
  for (let i = 0; i < 3 && !(await nativeOpen()); i++) {
    await tap("#btn3d"); await sleep(3000);
    await click("#tfRisk [data-rk=ok]"); await sleep(9000);
  }
  if (!(await nativeOpen())) problems.push("native 3D didn't open");
  await layer("under", { cam: { lat: SLOPE[0], lon: SLOPE[1], zoom: 14, bearing: 150 } }); await sleep(8000);
  shot("1-native-3d.png");
  // The slope, "tapped": the page answers with This spot's rows and the native card says how they came out.
  await jsq(`(() => { window.__laid = null; window.tfNative.on("avySpotLaid", (e) => { window.__laid = e; }); return 1; })()`);
  log(`check: ${await layer("avy", { check: { lat: SLOPE[0], lon: SLOPE[1] } })}`);
  let laid = null;
  for (let i = 0; i < 40 && !laid; i++) { await sleep(1000); laid = await jsq(`window.__laid`, null); }
  await sleep(1500);
  shot("2-slope-card.png");
  if (!laid) problems.push("the native slope card didn't report its rows (no card, or not a test build)");
  else {
    // Every row the page sent is drawn (https links only), plus "More about this spot".
    const kinds = laid.kinds || [], want = kinds.length + 1;
    log(`page rows (${kinds.length}): ${kinds.join(", ")}`);
    log(`native rows: ${laid.rows}; card ${Math.round(laid.shown)} of ${Math.round(laid.height)} pt tall (the rest scrolls)`);
    if (!kinds.length) problems.push("the page sent no rows");
    if (laid.rows < want - kinds.filter((k) => k === "link").length || laid.rows > want) problems.push(`${laid.rows} rows drawn for ${kinds.length} sent`);
    if ((laid.empty || []).length) problems.push(`rows with no text showing: ${laid.empty.map((i) => `${i} (${kinds[i] || "more"})`).join(", ")}`);
    if ((laid.clipped || []).length) problems.push(`lines cut short: ${laid.clipped.map((t) => JSON.stringify(String(t).slice(0, 60))).join(", ")}`);
  }
  const md = `## Slope card, ${ios ? "iPhone" : "Android"}: ${problems.length ? "✗ " + problems.length + " problem(s)" : "✓ every row shows"}\n\n` +
    problems.map((p) => `- ${p}`).join("\n") + (problems.length ? "\n\n" : "") + notes.map((n) => `    ${n}`).join("\n") + "\n";
  writeFileSync(join(OUT, `result-${PLATFORM}.md`), md);
  writeFileSync(join(OUT, `laid-${PLATFORM}.json`), JSON.stringify(laid, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
  process.exit(problems.length ? 1 : 0);
})().catch((e) => { console.log("✗ stopped: " + (e.stack || e)); process.exit(1); });
