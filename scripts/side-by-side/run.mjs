// Side-by-side check of the iPhone and Android apps (alex 2026-11-22: "do it": the same steps on an iPhone simulator
// and an Android simulator, in every sport, then matching screenshots and a list of what differs).
// Run by .github/workflows/side-by-side.yml, one job per phone and language:
//   PLATFORM=ios|android  TF_LANG=en|fr  node scripts/side-by-side/run.mjs
// The app's test build opens http://localhost:8080 (iPhone simulator: the Mac's own; Android: adb reverse), which this
// script serves: this checkout, with the live site's data files for anything not in git, and one extra script in every
// page (/__sbs.js) that runs what this script asks and answers (no DevTools needed, so both phones are driven the same
// way). Screenshots come from the simulator itself (simctl / adb), so native screens (3D, system prompts) show too.
// Every step writes a screenshot named by the step (the same name on both phones) and what the page showed then
// (buttons, open cards, script errors, sideways scrolling) to out/<platform>-<lang>/steps-<TAG>.json. pair.py compares them.
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
const OUT = join(process.cwd(), "out", `${PLATFORM}-${LANG}`);
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

// ---------- the walk ----------
(async () => {
  phone.launch();   // the app opens this script's site (started above)
  console.log(`side by side: ${PLATFORM}, ${LANG}`);
  // A cold simulator can take the first launch away (seen on Android): open the app again until the page answers.
  for (let i = 0; i < 4 && !(await pageUp(i ? 60000 : 120000)); i++) { console.log("  (the app's page didn't answer: opening it again)"); phone.kill(); await sleep(2000); phone.launch(); }
  // A brand-new phone: the terms, then the welcome (sport, location, notifications), as a new tester sees them.
  // The app was just installed: a brand-new phone, set to the language itself (workflow), no tf:lang yet (any tf: key
  // means "used before" to the welcome).
  await sleep(4000);
  if (START) {
  await step("First open: terms", () => "", 2500);
  await jsq(`(() => { const b = document.querySelector("dialog.tf-terms [data-terms=ok]"); if (b) b.click(); })()`);
  await step("Welcome 1: pick a sport", () => "", 2000);
  await jsq(`(() => { const b = document.querySelector("dialog.welc [data-sport=mtb]"); if (b) b.click(); })()`);
  await step("Welcome 2: location", () => "", 2000);
  await jsq(`(() => { const b = document.querySelector("dialog.welc [data-next]"); if (b) b.click(); })()`);
  await step("Welcome 3: what you'll see", () => "", 2000);
  await jsq(`(() => { const b = document.querySelector("dialog.welc [data-next2]"); if (b) { b.click(); return; } const d = document.querySelector("dialog.welc [data-done]"); if (d) d.click(); })()`);
  await step("Welcome 4: notifications offer", () => "", 2500);
  // Start again as alex's devices are (tf-admin: native 3D, native offline copies), with the Today card off (it opens
  // by itself once a day). The welcome's "Turn on notifications" is tapped at the very end (the phone's own prompt
  // can't be answered from the page, and on the iPhone it stays over every later screenshot).
  phone.kill(); await sleep(2000); phone.launch(); await pageUp();
  await jsq(`(() => { localStorage.setItem("tf-admin", "1"); localStorage.setItem("tf:welcomed", "true"); localStorage.setItem("tf:todayAuto", "false"); localStorage.setItem("tf:lang", ${JSON.stringify(LANG)}); location.reload(); })()`);
  await sleep(4000); await pageUp();
  await jsq(`(() => { const b = document.querySelector("dialog.tf-terms [data-terms=ok]"); if (b) b.click(); })()`);
  await closeAll("start");

  // Sign-in box (no real sign-in: the person check and a real account are not for a test).
  await step("Sign-in box", async () => { const r = await jsq(`window.tfAccount && window.tfAccount.open ? (window.tfAccount.open(), "") : "no sign-in box (tfAccount.open)"`, "page didn't answer"); await sleep(1500); return r; });
  await step("Sign-in box: email typed", async () => {
    const r = await jsq(`(() => { const i = [...document.querySelectorAll("dialog[open] input[type=email], dialog[open] input")].find((x) => x.offsetParent); if (!i) return "no email field"; i.focus(); i.value = "test" + String.fromCharCode(64) + "example.com"; i.dispatchEvent(new Event("input", { bubbles: true })); return ""; })()`, "page didn't answer");
    return r;
  });
  await closeAll("sign-in");
  } else {
    await jsq(`(() => { localStorage.setItem("tf-admin", "1"); localStorage.setItem("tf:welcomed", "true"); localStorage.setItem("tf:todayAuto", "false"); localStorage.setItem("tf:lang", ${JSON.stringify(LANG)}); location.reload(); })()`);
    await sleep(4000); await pageUp();
    await jsq(`(() => { const b = document.querySelector("dialog.tf-terms [data-terms=ok]"); if (b) b.click(); })()`);
    await closeAll("start");
  }

  for (const sp of SPORTS) {
    sport = sp;
    await closeAll("before sport");
    await step("Map", async () => {
      const r = await click("#sportMapBtn"); if (r) return r;
      await sleep(700);
      const r2 = await click(`#sportMenu [data-sport=${sp}]`); if (r2) return r2;
      await sleep(sp === "ski" ? 9000 : 6000);
      const v = await jsq(`document.getElementById("sport").value`);
      if (v !== sp) return `sport is ${v}`;
      // Skiing always opens on the Winter map (alex 2026-11-21).
      if (sp === "ski") { const b = await jsq(`document.getElementById("basemap").value`); if (b !== "winter") return `Skiing opened on ${b}, not Winter`; }
      return "";
    }, 2500);
    await closeAll("after sport");   // a first-time tip

    // Every tab, and every card in it.
    const tabs = await jsq(`[...document.querySelectorAll("#tabbar button[data-nav]")].filter((b) => b.getClientRects().length && getComputedStyle(b).display !== "none").map((b) => ({ nav: b.dataset.nav, label: b.textContent.trim() }))`, []);
    const SKIP = /^(start|signout|delete|deleteAccount|share|rate|store|feedback|photo|camera|import|gpx|strava|email|lang)$/i;
    for (const t of (tabs || []).filter((x) => x.nav !== "map")) {
      let cards = [];
      await step(`Tab ${t.nav}`, async () => {
        const r = await click(`#tabbar [data-nav=${t.nav}]`);
        await sleep(1200);
        cards = await jsq(`[...document.querySelectorAll("#hub [data-hub]")].filter((b) => b.getClientRects().length).map((b) => ({ hub: b.dataset.hub, id: b.dataset.id || "", label: (b.querySelector("b") || b).textContent.trim().slice(0, 40) }))`, []) || [];
        return r;
      });
      if (!ios) {   // Android's Back closes the tab (the iPhone has no Back button)
        phone.back(); await sleep(1100);
        const o = await jsq(OPEN, []);
        steps.push({ key: `${sp}/back-closes-tab-${t.nav}`, name: `${NAMES[sp]} › Back closes ${t.label}`, ok: !(o || []).includes("hub"), problems: (o || []).includes("hub") ? ["Back left the tab open"] : [], shot: "", state: null, androidOnly: true });
      }
      await closeAll(`tab ${t.nav}`);
      const seen = new Set();
      for (const c of cards.slice(0, 18)) {
        const id = `${c.hub}${c.id ? "-" + c.id : ""}`;
        if (SKIP.test(c.hub) || seen.has(id)) continue;
        seen.add(id);
        await step(`${t.nav} › ${id}`, async () => {
          await click(`#tabbar [data-nav=${t.nav}]`);
          await sleep(900);
          return click(c.id ? `#hub [data-hub="${c.hub}"][data-id="${c.id}"]` : `#hub [data-hub="${c.hub}"]`);
        }, 2000);
        await closeAll(`${t.nav} › ${id}`);
        const p = await jsq("location.pathname", "/");
        if (!/\/(index\.html)?$/.test(p)) { await jsq(`location.href = "/index.html"`); await sleep(4000); await pageUp(); }
        if (c.hub === "layer") { await click(`#tabbar [data-nav=${t.nav}]`); await sleep(600); await click(`#hub [data-hub="layer"][data-id="${c.id}"]`); await sleep(600); await closeAll("layer chip"); }
      }
    }

    // Layers: top and bottom of the list.
    await step("Layers", () => click("#layersBtn"), 1500);
    await step("Layers (bottom)", async () => { await jsq(`(() => { const m = document.getElementById("layersMenu"); const s = [m, ...m.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)); if (s) s.scrollTop = s.scrollHeight; })()`); return ""; }, 1000);
    await closeAll("layers");

    // 3D: the 3D button. Native 3D on both (alex's devices); never the web 3D map on the iPhone.
    const was3d = await jsq(`!!document.querySelector("#map.is3d")`, false);
    if (was3d) { await click("#btn3d"); await sleep(3000); }
    await step("3D button", async () => {
      const r = await tap("#btn3d"); if (r) return r;
      await sleep(2500);
      if (await agree()) { await sleep(1500); if (!(await jsq(`window.tfNative && window.tfNative.isOpen()`, false)) && !(await jsq(`!!document.querySelector("#map.is3d")`, false))) await tap("#btn3d"); }
      await sleep(12000);
      const s = await jsq(`({ n: !!(window.tfNative && window.tfNative.isOpen()), w: !!document.querySelector("#map.is3d") })`, {});
      if (PLATFORM === "ios" && s.w) return "the web 3D map opened on the iPhone";
      return s.n ? "" : s.w ? "web 3D opened (not native 3D)" : "3D didn't open";
    }, 1500);
    await step("3D turned and tilted", async () => {
      if (ios) tryp(`xcrun simctl io booted enumerate >/dev/null`);   // no finger gestures on the iPhone simulator: the screen as it is
      else { tryp("adb shell input swipe 700 1400 400 1000 600"); await sleep(1500); }
      return "";
    }, 2500);
    // Layers over native 3D (the page's own Layers).
    await step("3D › Layers", () => click("#layersBtn"), 2500);
    await closeAll("3d layers");
    await step("Back to the flat map", async () => {
      if (!ios) { for (let i = 0; i < 3 && (await jsq(`window.tfNative && window.tfNative.isOpen()`, false)); i++) { phone.back(); await sleep(2000); } }
      if (await jsq(`window.tfNative && window.tfNative.isOpen()`, false)) await closeNative();
      if (await jsq(`!!document.querySelector("#map.is3d")`, false)) await click("#btn3d");
      await sleep(2500);
      return (await jsq(`window.tfNative && window.tfNative.isOpen()`, false)) ? "native 3D still open" : "";
    }, 1500);
    await closeAll("after 3d");

    // Recording: the Ride / Record tab's Start, then Stop.
    await step("Recording started", async () => {
      await click("#tabbar [data-nav=ride]"); await sleep(1000);
      const r = await click(`#hub [data-hub=start]`); if (r) return r;
      await sleep(2500);
      await agree();
      if (!ios) tryp("adb emu geo fix -122.951 50.111 700");
      else tryp("xcrun simctl location booted set 50.111,-122.951");
      await sleep(6000);
      return (await jsq(`window.tfRide && window.tfRide.riding()`, false)) ? "" : "not recording";
    }, 1500);
    await step("Recording stopped", async () => {
      const r = await click("#navStop"); await sleep(2500);
      return r;
    }, 1500);
    await step("Recording not saved", () => click("#navDrop"), 1500);
    await closeAll("recording");
  }

  // Offline: a small native copy (2 km, Whistler), then native 3D with no signal is not possible on the iPhone
  // simulator (no airplane mode), so only the saving is compared.
  sport = "mtb";
  if (SPORTS.includes("mtb")) {
  await step("Offline copy of a small area (native)", async () => {
    const draws = await jsq(`window.tfNative && window.tfNative.has ? window.tfNative.has("offline") : "no tfNative"`, "page didn't answer");
    if (draws !== true) return `this build doesn't save native offline copies (${draws})`;
    // native-offline.js sends the saved areas (none here) 30 s after a page load: past that first, so it can't drop this one.
    await sleep(35000);
    await jsq(`window.__off = null; (() => { const T = Capacitor.Plugins.TrailMap; T.addListener("offlinePacks", (r) => { window.__off = r; }); })()`);
    await jsq(`Capacitor.Plugins.TrailMap.offline({ areas: [{ id: "sbs", box: [50.10, -122.97, 50.12, -122.94], ski: false, sharp: false }] }).then((r) => JSON.stringify(r))`);
    let last = "";
    for (let i = 0; i < 40; i++) { await sleep(3000); last = await jsq(`JSON.stringify(window.__off)`, ""); if (/"saved":true/.test(last)) break; }
    return /"saved":true/.test(last) ? "" : `not saved after 2 min: ${String(last).slice(0, 160)}`;
  }, 1000);
  await jsq(`Capacitor.Plugins.TrailMap.offline({ areas: [] })`);
  await step("Offline maps card", async () => { await click("#tabbar [data-nav=saved]"); await sleep(1000); const r = await jsq(`(() => { const b = [...document.querySelectorAll("#hub [data-hub]")].find((x) => /offline|hors ligne/i.test(x.textContent)); if (!b) return "no Offline maps in Saved"; b.click(); return ""; })()`, "page didn't answer"); return r; }, 2000);
  await closeAll("offline");
  }

  if (START) {
    sport = "start";
    await jsq(`(() => { localStorage.removeItem("tf:welcomed"); localStorage.removeItem("tf:notifyVisit"); Object.keys(localStorage).filter((k) => k.startsWith("tf:")).forEach((k) => localStorage.removeItem(k)); location.reload(); })()`);
    await sleep(5000); await pageUp();
    await jsq(`(() => { const b = document.querySelector("dialog.tf-terms [data-terms=ok]"); if (b) b.click(); })()`);
    await jsq(`(() => { const b = document.querySelector("dialog.welc [data-sport=mtb]"); if (b) b.click(); })()`); await sleep(1500);
    await jsq(`(() => { const b = document.querySelector("dialog.welc [data-next]"); if (b) b.click(); })()`); await sleep(1500);
    await jsq(`(() => { const b = document.querySelector("dialog.welc [data-next2]"); if (b) b.click(); })()`); await sleep(1500);
    await step("Notifications: Turn on (phone's own prompt)", async () => {
      const r = await jsq(`(() => { const b = document.querySelector("dialog.welc [data-push]"); if (!b) return "no notifications step in the welcome"; b.click(); return ""; })()`, "page didn't answer");
      await sleep(3000);
      return r || "";
    }, 1500);
  }
  if (iosNoClose.length) steps.push({ key: `${TAG}/close-problems`, name: "Cards that would not close (iPhone: no close button; Android: Back left the app)", ok: false, problems: [...new Set(iosNoClose)], shot: "", state: null });
  save();
  const bad = steps.filter((s) => !s.ok);
  const md = `## ${{ ios: "iPhone", android: "Android", web: "Browser" }[PLATFORM]} (${LANG}): ${bad.length} problem(s) in ${steps.length} steps\n\n` + bad.map((s) => `- ${s.name}: ${s.problems.join(" · ")}`).join("\n") + "\n";
  writeFileSync(join(OUT, `summary-${TAG}.md`), md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
  process.exit(0);
})().catch((e) => {
  console.log("✗ stopped: " + (e.stack || e));
  save({ stopped: String(e.message || e) });
  process.exit(0);
});
