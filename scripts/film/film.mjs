// Film test (not shipped, branch only): can the real iPhone app be filmed in the iOS simulator, native 3D included,
// at full resolution, with no screen recorder? Built from scripts/side-by-side/run.mjs (same server and page bridge),
// then: Skiing at Whistler, native 3D, and three ways of filming it:
//   1. single screenshots, timed (how fast simctl can take them)
//   2. stop-motion: the camera stepped a little each frame (layer "under" cam), one screenshot per step
//   3. simctl recordVideo while the camera turns and during a native Flyover (how smooth it is live)
// Everything lands in out/film (artifact "film").
// Never fails: what it found is in the steps.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, extname, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// PLATFORM=web: Chromium at iPhone size, to try this script without a simulator (no native parts).
const PLATFORM = ["ios", "web"].includes(process.env.PLATFORM) ? process.env.PLATFORM : "android";
const LANG = process.env.TF_LANG === "fr" ? "fr" : "en";
const APP = "com.allduf.trailfinder";
const SPORTS = (process.env.SPORTS || "mtb,ski,hike,fish,hunt,moto").split(",").map((x) => x.trim()).filter(Boolean);
const NAMES = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", fish: "Fishing", moto: "Adventure moto", hike: "Hiking" };
const OUT = join(process.cwd(), "out", "film");
// One job can walk part of the sports (TAG names its files, so several jobs' results sit side by side); START=0 skips
// the first open and sign-in (done by the job with START=1), and the offline steps run only in the MTB part.
const TAG = (process.env.TAG || "all").replace(/[^a-z0-9-]/gi, "");
const START = process.env.START !== "0";
mkdirSync(join(OUT, "shots"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c, t = 60000) => execSync(c, { encoding: "utf8", shell: "/bin/bash", stdio: ["ignore", "pipe", "pipe"], timeout: t, maxBuffer: 64 << 20 });
const tryp = (c, t) => { try { return sh(c, t); } catch { return ""; } };

// ---------- the site, with the page bridge ----------
const LIVE = "https://trailfinderapp.ca/";
const root = fileURLToPath(new URL("../../", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".pbf": "application/x-protobuf", ".txt": "text/plain" };
const BRIDGE = `(() => {
  if (window.__sbs) return; window.__sbs = 1;
  const pid = Math.random().toString(36).slice(2), f = window.fetch.bind(window);
  const post = (p, b) => f(p, { method: "POST", body: JSON.stringify(b), keepalive: true }).catch(() => {});
  addEventListener("error", (e) => { if (e.message) post("/__log", { pid, msg: String(e.message).slice(0, 200) + " @" + String(e.filename || "").split("/").pop().split("?")[0] + ":" + e.lineno }); });
  addEventListener("unhandledrejection", (e) => post("/__log", { pid, msg: "promise: " + String(e.reason && (e.reason.message || e.reason) || "").split("\\n")[0].slice(0, 200) }));
  // The page's own alert / confirm boxes would stop the phone until tapped: answered yes here, and listed.
  window.alert = (m) => { post("/__box", { pid, msg: "alert: " + String(m).slice(0, 160) }); };
  window.confirm = (m) => { post("/__box", { pid, msg: "confirm: " + String(m).slice(0, 160) }); return true; };
  const ce = console.error; console.error = function (...a) { post("/__log", { pid, msg: "console: " + a.map((x) => String(x && x.message || x)).join(" ").split("\\n")[0].slice(0, 200) }); return ce.apply(this, a); };
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
let current = null, lastPoll = 0, seq = 0, pageErrors = [], boxes = [];
const queue = [], inflight = new Map(), polls = [];
const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => d += c); req.on("end", () => { try { r(JSON.parse(d)); } catch { r({}); } }); });
function serveCmd(res, pid) {
  if (pid !== current) {
    // A new page (load or reload): commands sent to the old one never come back.
    current = pid;
    for (const [, w] of inflight) w.done({ error: "page reloaded" });
    inflight.clear();
  }
  lastPoll = Date.now();
  const c = queue.shift();
  if (c) { inflight.set(c.id, c); res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ id: c.id, code: c.code })); return; }
  const p = { res, pid, t: setTimeout(() => { polls.splice(polls.indexOf(p), 1); res.writeHead(204).end(); }, 15000) };
  polls.push(p);
}
function kick() {
  while (queue.length) {
    const p = polls.find((x) => x.pid === current);
    if (!p) return;
    polls.splice(polls.indexOf(p), 1); clearTimeout(p.t);
    const c = queue.shift();
    inflight.set(c.id, c);
    p.res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ id: c.id, code: c.code }));
  }
}
createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__sbs.js") { res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(BRIDGE); return; }
  if (u.pathname === "/__cmd") { serveCmd(res, u.searchParams.get("pid")); kick(); return; }
  if (u.pathname === "/__res") { const b = await body(req); const w = inflight.get(b.id); if (w) { inflight.delete(b.id); w.done(b); } res.writeHead(204).end(); return; }
  if (u.pathname === "/__box") { const b = await body(req); if (b.msg) boxes.push(b.msg); res.writeHead(204).end(); return; }
  if (u.pathname === "/__log") { const b = await body(req); if (b.msg && !NETWORK.test(b.msg)) pageErrors.push(b.msg); res.writeHead(204).end(); return; }
  let path, file;
  try { path = decodeURIComponent(u.pathname).replace(/^\/+/, "") || "index.html"; file = normalize(join(root, path)); }
  catch { res.writeHead(400).end(); return; }
  // Data files: the live site's (the data jobs keep them on the site-data branch; main's copies can be old, e.g.
  // data/app-build.json said build 32 and showed "New version of the app" on the iPhone simulator).
  if (/^data\//.test(path)) {
    try {
      const r = await fetch(LIVE + path + (u.search || ""));
      if (r.ok) { res.writeHead(200, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer())); return; }
    } catch {}
  }
  try {
    const rel = relative(root, file);
    if (!file.startsWith(root) || /^(\.git|\.github|scripts|supabase|ios-app|android-app|out|node_modules)(\/|$)/.test(rel)) throw new Error("not served");
    let data = await readFile(file);
    if (extname(file) === ".html") data = Buffer.from(String(data).replace(/<head([^>]*)>/i, `<head$1><script src="/__sbs.js"></script>`));
    // The service worker would keep old copies between runs: not in this test.
    if (path === "sw.js") data = Buffer.from("self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()));");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(data);
  } catch {
    try {
      const r = await fetch(LIVE + path + (u.search || ""));
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502).end(); }
  }
}).listen(8080, "127.0.0.1");   // the iPhone simulator and adb reverse both come in on the runner's own loopback
const NETWORK = /Failed to fetch|NetworkError|network error|aborted|AbortError|ERR_|Load failed|status of [45]\d\d|AJAXError|Failed to load resource|tile|WebGL|GL_|Unrecognized feature|Access-Control|CORS|Error injecting safe area CSS|cancelled|The network connection was lost|could not connect/i;

// What this script asks the page: an expression (a promise is waited for).
function js(code, ms = 45000) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const t = setTimeout(() => { const i = queue.findIndex((c) => c.id === id); if (i >= 0) queue.splice(i, 1); inflight.delete(id); reject(new Error("the page didn't answer")); }, ms);
    queue.push({ id, code, done: (r) => { clearTimeout(t); r.error ? reject(new Error(r.error)) : resolve(r.value); } });
    kick();
  });
}
const jsq = (code, d = null) => js(code, 20000).catch(() => d);
async function pageUp(ms = 60000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await js("document.readyState === 'complete' && !!document.getElementById('map')", 5000).catch(() => false)) return true; await sleep(1000); }
  return false;
}

// ---------- the phone ----------
const ios = PLATFORM === "ios" || PLATFORM === "web";
let web = null;
if (PLATFORM === "web") {
  const { chromium } = await import("playwright");
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, serviceWorkers: "block", geolocation: { latitude: 50.11, longitude: -122.95 }, permissions: ["geolocation"] });
  web = { ctx, page: null, open: async () => { web.page = await ctx.newPage(); web.page.goto("http://localhost:8080/").catch(() => {}); } };
}
const phone = {
  shot(f) { if (web) return web.page ? web.page.screenshot({ path: f }).catch(() => {}) : null; ios ? tryp(`xcrun simctl io booted screenshot --type=png "${f}"`, 30000) : tryp(`adb exec-out screencap -p > "${f}"`, 30000); },
  launch() { if (web) { web.open(); return; } ios ? tryp(`xcrun simctl launch booted ${APP}`) : tryp(`adb shell am start -W -n ${APP}/.MainActivity`); },
  kill() { if (web) { if (web.page) web.page.close().catch(() => {}); return; } ios ? tryp(`xcrun simctl terminate booted ${APP}`) : tryp(`adb shell am force-stop ${APP}`); },
  // Android's own Back button (iPhones have none: the page's own close buttons are used there, as a person would).
  back() { if (!ios) tryp("adb shell input keyevent KEYCODE_BACK"); },
  crashed() {
    if (web) return "";
    if (PLATFORM === "ios") { const pid = tryp(`xcrun simctl spawn booted launchctl list | grep UIKitApplication:${APP}`).trim().split(/\s+/)[0]; return /^\d+$/.test(pid || "") ? "" : "the app isn't running"; }
    // Asked twice, a second apart, filtered on the phone: the whole dump can come back cut or empty mid-transition.
    const front = () => /com\.allduf\.trailfinder/.test(tryp("adb shell \"dumpsys activity activities | grep -E 'ResumedActivity|topResumedActivity'\""));
    if (!front() && (execSync("sleep 1"), !front())) return "the app went to the background";
    const c = tryp("adb logcat -d -b crash").trim();
    return c && c !== phone._c ? ((phone._c = c), "APP CRASHED: " + (c.match(/(?:Exception|Error|signal)[^\n]*/) || [c.slice(-160)])[0].slice(0, 200)) : "";
  },
};

// ---------- steps ----------
const steps = [];
const save = (extra = {}) => { try { writeFileSync(join(OUT, `steps-${TAG}.json`), JSON.stringify({ platform: PLATFORM, lang: LANG, steps, ...extra }, null, 1)); } catch {} };
let sport = "start";
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
// Bars and sheets over the map with their own close or Cancel button (Plan a route, a square to pick or save, ...).
const CLOSERS = ".plan-x, #boxCancel, [data-sq-x], [aria-label=Close]:not(#lmClose), [aria-label=Fermer]:not(#lmClose)";
// What the page shows now, the same way on both phones: so pair.py can list what differs.
const STATE = `(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && !e.closest("[hidden]");
  const txt = (e) => (e.getAttribute("aria-label") || e.textContent || e.title || "").replace(/\\s+/g, " ").trim().slice(0, 50);
  const open = [...document.querySelectorAll("dialog[open]")].map((d) => "dialog." + ((d.className || d.id || "?") + "").split(" ")[0]);
  const hub = document.getElementById("hub"); if (hub && !hub.hidden) open.push("hub");
  const lm = document.getElementById("layersMenu"); if (lm && !lm.hidden) open.push("layers");
  const rk = document.getElementById("tfRisk"); if (rk && vis(rk)) open.push("trip sheet");
  document.querySelectorAll(${JSON.stringify(CLOSERS)}).forEach((b) => { if (vis(b) && !b.closest("dialog, #hub, #layersMenu")) open.push("bar:" + (b.id || b.className)); });
  const top = [...document.querySelectorAll("dialog[open]")].pop() || (hub && !hub.hidden ? hub : document.body);
  const buttons = [...top.querySelectorAll("button, a[href], [role=button], input[type=checkbox], select")].filter(vis).map(txt).filter(Boolean);
  const wide = document.documentElement.scrollWidth - innerWidth;
  const C = window.Capacitor, nat = window.tfNative;
  return { open, buttons: [...new Set(buttons)].slice(0, 80), wide: wide > 2 ? wide : 0, sport: (document.getElementById("sport") || {}).value || "",
    base: (document.getElementById("basemap") || {}).value || "", web3d: !!document.querySelector("#map.is3d, .is3d"),
    native3d: !!(nat && nat.isOpen && nat.isOpen()), lang: document.documentElement.lang || "", w: innerWidth, h: innerHeight,
    platform: C && C.getPlatform ? C.getPlatform() : "web", title: (top.querySelector("h1, h2, h3, b") || {}).textContent || "" };
})()`;
async function step(name, fn, settle = 1500) {
  const key = `${sport}/${slug(name)}`;
  const e0 = pageErrors.length, b0 = boxes.length;
  let note = "";
  try { const r = await fn(); if (typeof r === "string") note = r; } catch (e) { note = String(e.message || e).split("\n")[0].slice(0, 200); }
  await sleep(settle);
  const problems = [];
  if (note) problems.push(note);
  const c = phone.crashed();
  if (c) { problems.push(c); phone.launch(); await pageUp(); }
  const state = await jsq(STATE, {});
  if (state && state.wide) problems.push(`page is ${state.wide} px wider than the screen`);
  problems.push(...pageErrors.slice(e0));
  const file = `${TAG}-${String(steps.length + 1).padStart(3, "0")}-${key.replace("/", "-")}.png`;
  await phone.shot(join(OUT, "shots", file));
  if (state && boxes.length > b0) state.boxes = boxes.slice(b0);
  steps.push({ key, name: `${NAMES[sport] || "Start"} › ${name}`, ok: !problems.length, problems, shot: file, state });
  save();   // as it goes: a job stopped at its time limit still leaves what it saw
  console.log(`${problems.length ? "✗" : "✓"} ${key}${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
}
const click = (sel, i = 0) => js(`(() => { const b = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!b) return "not found: ${sel.replace(/"/g, "'")}"; b.scrollIntoView({ block: "center" }); b.click(); return ""; })()`).catch((e) => `couldn't tap ${sel}: ${e.message}`);
// Close what's open, the way each phone does: Android's Back button; on the iPhone the page's own close button (a
// person can't press Back there), else Escape, else the Map tab. Records when an iPhone card had no close button.
const OPEN = `(() => { const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && !e.closest("[hidden], dialog:not([open])");
  const o = [...document.querySelectorAll("dialog[open]")].map((d) => d.className || d.id); const h = document.getElementById("hub"); if (h && !h.hidden) o.push("hub");
  const l = document.getElementById("layersMenu"); if (l && !l.hidden) o.push("layers"); const r = document.getElementById("tfRisk"); if (r && r.getClientRects().length) o.push("trip");
  [...document.querySelectorAll(${JSON.stringify(CLOSERS)})].filter((b) => vis(b) && !b.closest("dialog, #hub, #layersMenu")).forEach((b) => o.push("bar:" + (b.id || b.className)));
  return o; })()`;
const CLOSE_IOS = `(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
  const CL = /^(×|✕|✖|x|close|fermer|done|ok|terminé|back|retour|‹|←|not now|pas maintenant|cancel|annuler|got it|compris|later|plus tard)$/i;
  const pick = (root) => [...root.querySelectorAll("button, [role=button], a")].filter(vis).find((b) => CL.test((b.getAttribute("aria-label") || b.textContent || "").trim()) || /close|dismiss/i.test(b.className + " " + (b.dataset ? Object.keys(b.dataset).join(" ") : "")));
  const dlg = [...document.querySelectorAll("dialog[open]")].pop();
  if (dlg) { const b = pick(dlg); if (b) { b.click(); return "button"; } dlg.close(); return "no close button in " + ((dlg.className || dlg.id) + "").split(" ")[0]; }
  const rk = document.getElementById("tfRisk"); if (rk && rk.getClientRects().length) { const b = pick(rk); if (b) { b.click(); return "button"; } }
  const lm = document.getElementById("layersMenu"); if (lm && !lm.hidden) { const b = document.getElementById("lmClose") || pick(lm); if (b) { b.click(); return "button"; } }
  const bar = [...document.querySelectorAll(${JSON.stringify(CLOSERS)})].filter((b) => vis(b) && !b.closest("dialog, #hub, #layersMenu")).pop();
  if (bar) { bar.click(); return "button"; }
  const hub = document.getElementById("hub");
  if (hub && !hub.hidden) { const m = document.querySelector("#tabbar [data-nav=map]"); if (m) { m.click(); return "map tab"; } }
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
  return "escape";
})()`;
const iosNoClose = [];
async function closeAll(what) {
  for (let i = 0; i < 5; i++) {
    const o = await jsq(OPEN, []);
    if (!o || !o.length) return;
    if (ios) { const r = await jsq(CLOSE_IOS, ""); if (r && /^no close/.test(r)) iosNoClose.push(`${what}: ${r}`); await sleep(900); }
    else { phone.back(); await sleep(1100); if (phone.crashed()) { iosNoClose.push(`${what}: Android Back put the app in the background (still open: ${o.join(", ").slice(0, 80)}; Back pressed ${i + 1}x)`); phone.launch(); await pageUp(); } }
  }
  // Still open: whatever it takes, so the next step starts clean.
  await jsq(`(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); const m = document.querySelector("#tabbar [data-nav=map]"); if (m) m.click(); })()`);
  await sleep(600);
}

// A real finger on Android (the 3D button opens native 3D only for a real tap there); on the iPhone a page click goes the
// same way (native-map.js claim) on a build that draws everything natively.
let topPx = null;
async function tap(sel) {
  if (ios) return click(sel);
  const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, dpr: devicePixelRatio, ih: innerHeight }; })()`);
  if (!r) return `not found: ${sel}`;
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
  return "";
}
const agree = () => jsq(`(() => { const b = document.querySelector("#tfRisk [data-rk=ok]"); if (b && b.getClientRects().length) { b.click(); return true; } return false; })()`, false);
const closeNative = () => jsq(`(() => { const C = window.Capacitor, T = C && (C.Plugins.TrailMap || (C.registerPlugin && C.registerPlugin("TrailMap"))); return T && T.close ? T.close().then(() => true, () => false) : false; })()`, false);

// ---------- filming ----------
import { spawn } from "node:child_process";
const T = () => Date.now();
const note = [];
const log = (s) => { console.log(s); note.push(s); writeFileSync(join(OUT, "notes.txt"), note.join("\n") + "\n"); };
const shotTo = (f) => { const t = T(); tryp(`xcrun simctl io booted screenshot --type=png "${f}"`, 30000); return T() - t; };
const cam = (c) => jsq(`Capacitor.Plugins.TrailMap.layer({ key: "under", data: ${JSON.stringify(JSON.stringify({ cam: c }))} }).then(() => true, (e) => String(e))`, "no answer");
function rec(file) {
  const p = spawn("xcrun", ["simctl", "io", "booted", "recordVideo", "--codec=h264", "--force", file], { stdio: "ignore" });
  return () => new Promise((r) => { p.on("exit", r); p.kill("SIGINT"); setTimeout(r, 15000); });
}

(async () => {
  phone.launch();
  for (let i = 0; i < 4 && !(await pageUp(i ? 60000 : 120000)); i++) { phone.kill(); await sleep(2000); phone.launch(); }
  await sleep(3000);
  await jsq(`(() => { localStorage.setItem("tf-admin", "1"); localStorage.setItem("tf:welcomed", "true"); localStorage.setItem("tf:todayAuto", "false"); localStorage.setItem("tf:skiGuest", "true"); localStorage.setItem("tf:lang", "en"); location.reload(); })()`);
  await sleep(4000); await pageUp();
  await jsq(`(() => { const b = document.querySelector("dialog.tf-terms [data-terms=ok]"); if (b) b.click(); })()`);
  await closeAll("start");
  await click("#sportMapBtn"); await sleep(800); await click("#sportMenu [data-sport=ski]"); await sleep(10000);
  await closeAll("ski");
  await jsq(`window.tfLeaflet.setView([50.09, -122.93], 13, { animate: false })`); await sleep(4000);
  log("sport " + (await jsq(`document.getElementById("sport").value`)) + ", map " + (await jsq(`document.getElementById("basemap").value`)));
  shotTo(join(OUT, "01-flat.png"));

  // Native 3D, as the 3D button opens it.
  await click("#btn3d"); await sleep(2500);
  if (await agree()) { await sleep(1500); if (!(await jsq(`window.tfNative && window.tfNative.isOpen()`, false))) await click("#btn3d"); }
  await sleep(15000);
  log("native open: " + (await jsq(`!!(window.tfNative && window.tfNative.isOpen())`, false)) + ", web 3D: " + (await jsq(`!!document.querySelector("#map.is3d")`, false)));
  shotTo(join(OUT, "02-native3d.png"));
  log("screen size: " + tryp(`sips -g pixelWidth -g pixelHeight "${join(OUT, "02-native3d.png")}"`).replace(/\s+/g, " "));

  // 1. How fast screenshots are.
  const ms = []; for (let i = 0; i < 8; i++) ms.push(shotTo(join(OUT, `t-${i}.png`)));
  log("screenshot ms: " + ms.join(", "));

  // 2. Stop-motion orbit: bearing 0 -> 60 over 90 steps, one screenshot each once the move and tiles settle.
  mkdirSync(join(OUT, "stop"), { recursive: true });
  const C = { lat: 50.075, lon: -122.92, zoom: 12.6 };
  log("cam answer: " + (await cam({ ...C, bearing: 0 })));
  await sleep(6000);
  const t0 = T(), N = Number(process.env.STEPS || 90);
  for (let i = 0; i < N; i++) {
    await cam({ ...C, bearing: (60 * i) / (N - 1) });
    await sleep(Number(process.env.SETTLE || 900));
    shotTo(join(OUT, "stop", `f${String(i).padStart(4, "0")}.png`));
  }
  log(`stop-motion: ${N} frames in ${Math.round((T() - t0) / 1000)} s`);

  // 3a. Live recording while the camera turns (a step every 100 ms).
  let stop = rec(join(OUT, "live-turn.mp4")); await sleep(1500);
  for (let i = 0; i <= 150; i++) { cam({ ...C, bearing: 60 - (60 * i) / 150 }); await sleep(100); }
  await sleep(1500); await stop();
  // 3b. A native Flyover (a made-up line up Whistler Mountain), live.
  const pts = [[50.1145, -122.9545, 680], [50.098, -122.951, 1100], [50.083, -122.945, 1500], [50.071, -122.93, 1850], [50.062, -122.918, 2180]].map(([lat, lon, e]) => ({ lat, lon, e }));
  stop = rec(join(OUT, "live-flyover.mp4")); await sleep(1000);
  log("flyover: " + (await jsq(`window.tfNativeFly ? window.tfNativeFly(${JSON.stringify(pts)}, "Test") : "no tfNativeFly"`, "no answer")));
  await sleep(30000); await stop();
  shotTo(join(OUT, "03-after.png"));
  log("done");
  process.exit(0);
})().catch((e) => { log("stopped: " + (e.stack || e)); process.exit(0); });
