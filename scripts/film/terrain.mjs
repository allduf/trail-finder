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
    if (extname(file) === ".html") data = Buffer.from(String(data).replace(/<head([^>]*)>/i, `<head$1><script src="/__sbs.js"></script><script>(() => { const at = { coords: { latitude: 50.1135, longitude: -122.954, accuracy: 10, altitude: 670, heading: null, speed: null, altitudeAccuracy: null }, timestamp: Date.now() }; const g = navigator.geolocation; if (g) { g.getCurrentPosition = (ok) => setTimeout(() => ok({ ...at, timestamp: Date.now() }), 50); g.watchPosition = (ok) => { setTimeout(() => ok({ ...at, timestamp: Date.now() }), 50); return 1; }; g.clearWatch = () => {}; } })();</script>`));
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

// ---------- filming: the avalanche map tutorial (branch only) ----------
// Stop-motion: every frame is a simulator screenshot taken once the phone has settled. Page taps are page clicks; the
// native card's own buttons and a slope tap go through the film-only "film" key in NativeAvalanche.swift (this branch).
// out/film/f/NNNNN.png + out/film/avy-log.json { marks, taps } (taps: frame, x, y in points; the finger is drawn later).
const T = () => Date.now();
const note = [];
const log = (s) => { console.log(s); note.push(s); writeFileSync(join(OUT, "notes.txt"), note.join("\n") + "\n"); };
const FD = join(OUT, "f"); mkdirSync(FD, { recursive: true });
const L = { marks: {}, taps: [], rects: {}, drags: [] };
let fi = 0;
const saveL = () => writeFileSync(join(OUT, "avy-log.json"), JSON.stringify(L, null, 1));
const snap = () => { tryp(`xcrun simctl io booted screenshot --type=png "${join(FD, String(fi).padStart(5, "0") + ".png")}"`, 30000); fi++; saveL(); };
const mark = (n) => { L.marks[n] = fi; saveL(); log(`mark ${n} ${fi}`); };
const cam = (c) => jsq(`Capacitor.Plugins.TrailMap.layer({ key: "under", data: ${JSON.stringify(JSON.stringify({ cam: c }))} }).then(() => true, (e) => String(e))`, "no answer");
const film = (o) => jsq(`Capacitor.Plugins.TrailMap.layer({ key: "avy", data: ${JSON.stringify(JSON.stringify({ film: o }))} }).then(() => true, (e) => String(e))`, "no answer");
const rect = (sel) => jsq(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, t: r.top, b: r.bottom }; })()`);
const ease = (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const SET = Number(process.env.SETTLE || 900);
async function ptap(sel, wait = 2500, name = sel) {
  const r = await rect(sel);
  L.taps.push({ f: fi, x: r && r.x, y: r && r.y, name }); snap();
  const c = await click(sel); if (c) log(`tap ${sel}: ${c}`);
  await sleep(wait); snap();
}
async function ntap(name, o, wait = 2500) { L.taps.push({ f: fi, x: null, y: null, name, native: true }); snap(); log(`film ${name}: ${await film(o)}`); await sleep(wait); snap(); }
const scroller = `(() => { let s = document.getElementById("avCard"); while (s && !(s.scrollHeight > s.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement; window.__sc = s; return s ? s.scrollTop : null; })()`;
async function scrollBy(dy, k) {
  const y0 = await jsq(scroller, null); if (y0 == null) { log("no scroller"); return; }
  for (let i = 1; i <= k; i++) { await jsq(`(window.__sc.scrollTop = ${Math.round(y0 + dy * ease(i / k))}, 1)`); await sleep(150); snap(); }
}
async function camSeq(name, n, at, settle = SET, from = 0, to = n) {
  mark(name);
  await cam(at(from / (n - 1))); await sleep(5000);
  const t0 = T();
  for (let i = from; i < to; i++) { await cam(at(i / (n - 1))); await sleep(settle); snap(); }
  log(`${name}: ${n} frames in ${Math.round((T() - t0) / 1000)} s`);
}

// ---------- the terrain layers tutorial (branch only) ----------
// Wedge Mountain backcountry, Skiing, native 3D, Avalanche risk off. Each terrain layer is turned on from Layers (its
// picture tile), the menu closes, then the camera turns slowly while the layer shows. One ground colour at a time: the
// app turns the last one off by itself.
const C0 = { lat: 50.128, lon: -122.812, zoom: 12.55 };
const LAKE = (process.env.LAKE || "50.146,-122.797").split(",").map(Number);
const tileSel = (k) => `#layersMenu .sk-tile:has(.sk-sw[data-k=${k}])`;
async function scrollTo(sel, k = 24) {
  const r = await jsq(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; let s = e.parentElement;
    while (s && !(s.scrollHeight > s.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(s).overflowY))) s = s.parentElement;
    if (!s) return null; window.__sc = s; const a = e.getBoundingClientRect(), b = s.getBoundingClientRect();
    return { y0: s.scrollTop, dy: Math.round(a.top - b.top - (b.height - a.height) / 2) }; })()`, null);
  if (!r) { log("no scroll for " + sel); return; }
  if (Math.abs(r.dy) < 8) return;
  for (let i = 1; i <= k; i++) { await jsq(`(window.__sc.scrollTop = ${Math.round(r.y0 + r.dy * ease(i / k))}, 1)`); await sleep(150); snap(); }
}
async function turnOn(k, name) {
  await ptap("#layersBtn", 2200, "layers_" + name); mark("menu_" + name); snap();
  await scrollTo(tileSel(k)); snap(); mark("tile_" + name);
  const r = await rect(tileSel(k) + " .sk-thumb");
  L.taps.push({ f: fi, x: r && r.x, y: r && r.y, name: "tile_" + name }); snap();
  log(`tap ${k}: ` + (await click(tileSel(k))));
  await sleep(1500); snap(); snap(); mark("on_" + name); await sleep(1200); snap();
  log(`${k} on: ` + (await jsq(`!!document.querySelector(${JSON.stringify(tileSel(k) + " .sk-sw:checked")})`, false)));
  await ptap("#lmClose", 6000, "close_" + name); snap();
  log("bars: " + (await jsq(`(document.getElementById("skBars") || {}).innerText`, "")));
  mark("map_" + name); snap();
}
(async () => {
  phone.launch();
  for (let i = 0; i < 4 && !(await pageUp(i ? 60000 : 120000)); i++) { phone.kill(); await sleep(2000); phone.launch(); }
  await sleep(3000);
  await jsq(`(() => { localStorage.setItem("tf-admin", "1"); localStorage.setItem("tf:welcomed", "true"); localStorage.setItem("tf:todayAuto", "false"); localStorage.setItem("tf:skiGuest", "true"); localStorage.setItem("tf:lang", "en"); localStorage.setItem("tf:avy", "false"); localStorage.removeItem("tf:filmExample"); location.reload(); })()`);
  await sleep(4000); await pageUp();
  await jsq(`(() => { const b = document.querySelector("dialog.tf-terms [data-terms=ok]"); if (b) b.click(); })()`);
  await closeAll("start");
  await click("#sportMapBtn"); await sleep(800); await click("#sportMenu [data-sport=ski]"); await sleep(10000);
  await closeAll("ski");
  await jsq(`window.tfLeaflet.setView([${C0.lat}, ${C0.lon}], 13, { animate: false })`); await sleep(4000);
  await click("#btn3d"); await sleep(2500);
  if (await agree()) { await sleep(1500); if (!(await jsq(`window.tfNative && window.tfNative.isOpen()`, false))) await click("#btn3d"); }
  await sleep(12000);
  log("native open: " + (await jsq(`!!(window.tfNative && window.tfNative.isOpen())`, false)) + ", web 3D: " + (await jsq(`!!document.querySelector("#map.is3d")`, false)));
  await jsq(`(() => { const s = document.createElement("style"); s.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }"; document.head.append(s); return 1; })()`);
  log("sheet: " + JSON.stringify(await jsq(`window.__tfFilmSheet ? window.__tfFilmSheet("mini") : null`, null)));
  await cam({ ...C0, bearing: 160 }); await sleep(12000);

  const PART = process.env.PART || "ui";
  if (PART === "fly") {
    // The hook: an orbit with Slope angle on, the map alone (page buttons hidden).
    await click("#layersBtn"); await sleep(1500); await click(tileSel("slope")); await sleep(1500); await click("#lmClose"); await sleep(3000);
    await jsq(`(() => { const s = document.createElement("style"); s.id = "__clean"; s.textContent = "body > *:not(#map) { visibility: hidden !important; } #map .leaflet-control-container { visibility: hidden !important; }"; document.head.append(s); return 1; })()`);
    await sleep(8000);
    const SP = (process.env.SPEAR || "50.13,-122.80").split(",").map(Number), NF = Number(process.env.NF || 360);
    await camSeq("fly", NF, (u) => ({ lat: SP[0], lon: SP[1], zoom: Number(process.env.FZ || 12.6), bearing: 60 + 100 * ease(u) }), Number(process.env.FSET || 1100), Number(process.env.FROM || 0), Number(process.env.TO || NF));
    mark("END"); log("done, frames " + fi); process.exit(0);
  }
  const NT = Number(process.env.NT || 200);
  const turn = (name, b0, b1, c = C0) => camSeq(name, NT, (u) => ({ ...c, bearing: b0 + (b1 - b0) * ease(u) }));
  mark("map"); snap(); snap();
  // 1. Slope angle.
  await turnOn("slope", "slope"); await turn("turn_slope", 160, 185);
  // 2. Slope direction (Slope angle goes off by itself).
  await turnOn("aspect", "aspect"); await turn("turn_aspect", 185, 210);
  // 3. Elevation bands.
  await turnOn("elev", "elev"); await turn("turn_elev", 210, 180);
  // In towards Wedgemount Lake.
  await camSeq("glide", Number(process.env.NG || 180), (u) => { const e = ease(u); return { lat: C0.lat + (LAKE[0] - C0.lat) * e, lon: C0.lon + (LAKE[1] - C0.lon) * e, zoom: C0.zoom + (13.7 - C0.zoom) * e, bearing: 180 - 30 * e }; }, Number(process.env.GSET || 1300));
  // 4. Flats.
  await turnOn("flats", "flats"); await turn("turn_flats", 150, 125, { lat: LAKE[0], lon: LAKE[1], zoom: 13.7 });
  mark("END");
  log("done, frames " + fi);
  process.exit(0);
})().catch((e) => { log("stopped: " + (e.stack || e)); process.exit(0); });
