// Tough conditions on the phone apps (alex 2026-11-27: "can we test the app in all different situation ? like low
// data , off line"; the night before, alex's iPhone showed a black 3D map in Low Power Mode, which no test covered).
// Run by .github/workflows/conditions.yml on an iPhone simulator (PLATFORM=ios) and an Android simulator
// (PLATFORM=android), with the app's test build opening this runner's site (http://localhost:8080). The website's own
// conditions (weak signal, airplane mode mid-use, overnight avalanche...) are scripts/conditions-test.mjs; Low Power
// Mode and Battery Saver have their own test. Here, what only the phone itself can do:
//  - Dark mode (the phone's setting): the page readable, the native 3D map draws.
//  - Big text (the phone's text size at its biggest: iPhone Dynamic Type, Android font size 130% and 200%): every tab
//    of every sport fits, no sideways scrolling, the bottom bar's words fit.
//  - Background and back with native 3D open, and the phone's low memory warning: the app stays, the 3D map draws
//    again (never black).
//  - No signal: Android's airplane mode (the page still comes from this runner through adb), the 3D map and the Today
//    card; iPhone: the map servers don't answer (the Mac's firewall).
//  - Location off: My location says so.
//  - Turned sideways: the app stays upright (alex 2026-11-27).
//  - First open with no connection: the app's own "No connection" page, then the app opens by itself once the
//    connection is back.
// Fails on a crash, a black 3D map, a page error, sideways scrolling or a check below. Screenshots in out/conditions-<platform>.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { join, extname, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { inflateSync } from "node:zlib";

const PLATFORM = process.env.PLATFORM === "ios" ? "ios" : "android";
const ios = PLATFORM === "ios";
const APP = "com.allduf.trailfinder";
const SPORTS = (process.env.SPORTS || "mtb,ski,hike,fish,hunt,moto").split(",").map((x) => x.trim()).filter(Boolean);
const NAMES = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", fish: "Fishing", moto: "Adventure moto", hike: "Hiking" };
const OUT = join(process.cwd(), "out", `conditions-${PLATFORM}`);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c, t = 60000) => execSync(c, { encoding: "utf8", shell: "/bin/bash", stdio: ["ignore", "pipe", "pipe"], timeout: t, maxBuffer: 64 << 20 });
const tryp = (c, t) => { try { return sh(c, t); } catch { return ""; } };

// ---------- the site, with a page bridge (as scripts/side-by-side/run.mjs) ----------
const LIVE = "https://trailfinderapp.ca/";
const root = fileURLToPath(new URL("../../", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".pbf": "application/x-protobuf", ".txt": "text/plain" };
const BRIDGE = `(() => {
  if (window.__tc) return; window.__tc = 1;
  const pid = Math.random().toString(36).slice(2), f = window.fetch.bind(window);
  const post = (p, b) => f(p, { method: "POST", body: JSON.stringify(b), keepalive: true }).catch(() => {});
  addEventListener("error", (e) => { if (e.message) post("/__log", { msg: String(e.message).slice(0, 200) + " @" + String(e.filename || "").split("/").pop().split("?")[0] + ":" + e.lineno }); });
  addEventListener("unhandledrejection", (e) => post("/__log", { msg: "promise: " + String(e.reason && (e.reason.message || e.reason) || "").split("\\n")[0].slice(0, 200) }));
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
let current = null, seq = 0, down = false;
const pageErrors = [], queue = [], inflight = new Map(), polls = [];
const body = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => d += c); req.on("end", () => { try { r(JSON.parse(d)); } catch { r({}); } }); });
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
const NETWORK = /Failed to fetch|NetworkError|network error|aborted|AbortError|ERR_|Load failed|status of [45]\d\d|AJAXError|Failed to load resource|tile|WebGL|GL_|Unrecognized feature|Access-Control|CORS|Error injecting safe area CSS|cancelled|The network connection was lost|could not connect|offline|timed out/i;
createServer(async (req, res) => {
  // "Down": the runner's site doesn't answer at all (a phone with no connection opening the app for the first time).
  if (down) { req.socket.destroy(); return; }
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__tc.js") { res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }).end(BRIDGE); return; }
  if (u.pathname === "/__cmd") {
    const pid = u.searchParams.get("pid");
    if (pid !== current) { current = pid; for (const [, w] of inflight) w.done({ error: "page reloaded" }); inflight.clear(); }
    const c = queue.shift();
    if (c) { inflight.set(c.id, c); res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ id: c.id, code: c.code })); return; }
    const p = { res, pid, t: setTimeout(() => { const i = polls.indexOf(p); if (i >= 0) polls.splice(i, 1); res.writeHead(204).end(); }, 15000) };
    polls.push(p); kick(); return;
  }
  if (u.pathname === "/__res") { const b = await body(req); const w = inflight.get(b.id); if (w) { inflight.delete(b.id); w.done(b); } res.writeHead(204).end(); return; }
  if (u.pathname === "/__log") { const b = await body(req); if (b.msg && !NETWORK.test(b.msg)) pageErrors.push(b.msg); res.writeHead(204).end(); return; }
  let path, file;
  try { path = decodeURIComponent(u.pathname).replace(/^\/+/, "") || "index.html"; file = normalize(join(root, path)); } catch { res.writeHead(400).end(); return; }
  if (/^data\//.test(path)) {
    try { const r = await fetch(LIVE + path + (u.search || "")); if (r.ok) { res.writeHead(200, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer())); return; } } catch {}
  }
  try {
    const rel = relative(root, file);
    if (!file.startsWith(root) || /^(\.git|\.github|scripts|supabase|ios-app|android-app|out|node_modules)(\/|$)/.test(rel)) throw new Error("not served");
    let data = await readFile(file);
    if (extname(file) === ".html") data = Buffer.from(String(data).replace(/<head([^>]*)>/i, `<head$1><script src="/__tc.js"></script>`));
    if (path === "sw.js") data = Buffer.from("self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', (e) => e.waitUntil(self.registration.unregister()));");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(data);
  } catch {
    try { const r = await fetch(LIVE + path + (u.search || "")); res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer())); }
    catch { res.writeHead(502).end(); }
  }
}).listen(8080, "127.0.0.1");

function js(code, ms = 45000) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const t = setTimeout(() => { const i = queue.findIndex((c) => c.id === id); if (i >= 0) queue.splice(i, 1); inflight.delete(id); reject(new Error("the page didn't answer")); }, ms);
    queue.push({ id, code, done: (r) => { clearTimeout(t); r.error ? reject(new Error(r.error)) : resolve(r.value); } });
    kick();
  });
}
const jsq = (code, d = null, ms = 20000) => js(code, ms).catch(() => d);
async function pageUp(ms = 60000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await js("document.readyState === 'complete' && !!document.getElementById('map')", 5000).catch(() => false)) return true; await sleep(1000); }
  return false;
}

// ---------- the phone ----------
const phone = {
  shot(f) { ios ? tryp(`xcrun simctl io booted screenshot --type=png "${f}"`, 30000) : tryp(`adb exec-out screencap -p > "${f}"`, 30000); },
  launch() { ios ? tryp(`xcrun simctl launch booted ${APP}`) : tryp(`adb shell am start -W -n ${APP}/.MainActivity`); },
  kill() { ios ? tryp(`xcrun simctl terminate booted ${APP}`) : tryp(`adb shell am force-stop ${APP}`); },
  running() {
    if (ios) return /^\d+$/.test(tryp(`xcrun simctl spawn booted launchctl list | grep UIKitApplication:${APP}`).trim().split(/\s+/)[0] || "");
    return /com\.allduf\.trailfinder/.test(tryp("adb shell \"dumpsys activity activities | grep -E 'ResumedActivity|topResumedActivity'\""));
  },
  crash() { if (ios) return ""; const c = tryp("adb logcat -d -b crash").trim(); if (c && c !== phone._c) { phone._c = c; return "APP CRASHED: " + ((c.match(/(?:Exception|Error|signal)[^\n]*/) || [c.slice(-160)])[0]).slice(0, 200); } return ""; },
  // The phone's own settings.
  dark(on) { ios ? tryp(`xcrun simctl ui booted appearance ${on ? "dark" : "light"}`) : tryp(`adb shell cmd uimode night ${on ? "yes" : "no"}`); },
  text(size) { ios ? tryp(`xcrun simctl ui booted content_size ${size || "large"}`) : tryp(`adb shell settings put system font_scale ${size || "1.0"}`); },
  home() { ios ? tryp("xcrun simctl launch booted com.apple.Preferences") : tryp("adb shell input keyevent KEYCODE_HOME"); },
  memory() { ios ? tryp("xcrun simctl spawn booted notifyutil -p UISimulatedMemoryWarningNotification") : tryp(`adb shell am send-trim-memory ${APP} RUNNING_CRITICAL`); },
};
phone._c = tryp("adb logcat -d -b crash").trim();

// The share of a screenshot that is (nearly) black, in the middle of the screen where the map is: a 3D map that drew
// nothing is black there (alex's iPhone 2026-11-26). Reads the PNG itself (8-bit RGB or RGBA, as the simulators save).
function blackShare(file) {
  try {
    const b = readFileSync(file);
    let w = 0, h = 0, type = 0, depth = 0; const idat = [];
    for (let o = 8; o < b.length;) {
      const len = b.readUInt32BE(o), kind = b.toString("ascii", o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
      if (kind === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; }
      if (kind === "IDAT") idat.push(d);
      o += 12 + len;
    }
    if (depth !== 8 || (type !== 2 && type !== 6)) return null;
    const bpp = type === 6 ? 4 : 3, raw = inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? row[x - bpp] : 0, u = up ? up[x] : 0, c = up && x >= bpp ? up[x - bpp] : 0;
        const p = a + u - c, pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - c);
        row[x] = (src[x] + [0, a, u, (a + u) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? u : c][f]) & 255;
      }
    }
    let dark = 0, n = 0;
    for (let y = Math.floor(h * 0.25); y < h * 0.6; y += 4) for (let x = Math.floor(w * 0.1); x < w * 0.9; x += 4) { const i = y * stride + x * bpp; n++; if (px[i] + px[i + 1] + px[i + 2] < 45) dark++; }
    return n ? dark / n : null;
  } catch { return null; }
}

// ---------- steps ----------
const steps = [];
let cond = "";
async function step(name, fn, settle = 1500) {
  const e0 = pageErrors.length;
  let note = "";
  try { const r = await fn(); if (typeof r === "string") note = r; } catch (e) { note = String(e.message || e).split("\n")[0].slice(0, 200); }
  await sleep(settle);
  const problems = note ? [note] : [];
  const c = phone.crash();
  if (c) problems.push(c);
  if (!phone.running()) { problems.push("the app isn't open any more"); phone.launch(); await pageUp(); }
  const wide = await jsq("document.documentElement.scrollWidth - innerWidth", 0);
  if (wide > 2) problems.push(`page is ${wide} px wider than the screen`);
  problems.push(...pageErrors.slice(e0));
  const file = `${String(steps.length + 1).padStart(3, "0")}-${(cond + "-" + name).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 70)}.png`;
  phone.shot(join(OUT, file));
  steps.push({ cond, name, ok: !problems.length, problems, shot: file });
  writeFileSync(join(OUT, "steps.json"), JSON.stringify(steps, null, 1));
  console.log(`${problems.length ? "✗" : "✓"} ${cond}: ${name}${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
}
const click = (sel) => js(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return "not found: ${sel.replace(/"/g, "'")}"; b.scrollIntoView({ block: "center" }); b.click(); return ""; })()`).catch((e) => `couldn't tap ${sel}: ${e.message}`);
const closeAll = () => jsq(`(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); const l = document.getElementById("lmClose"); if (l && l.offsetParent) l.click(); const m = document.querySelector("#tabbar [data-nav=map]"); if (m) m.click(); })()`);
const isNative = () => jsq("!!(window.tfNative && window.tfNative.isOpen && window.tfNative.isOpen())", false);
async function pick(sp) {
  await click("#sportMapBtn"); await sleep(700);
  await click(`#sportMenu [data-sport=${sp}]`); await sleep(sp === "ski" ? 9000 : 5000);
  const v = await jsq(`document.getElementById("sport").value`);
  return v === sp ? "" : `sport is ${v}, not ${sp}`;
}
// A real finger on Android (native 3D opens for a real tap there), a page click on the iPhone.
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
// Native 3D in the sport picked: open, and it must draw (not black, no "couldn't draw" note).
async function open3d() {
  if (await isNative()) return "";
  const r = await tap("#btn3d"); if (r) return r;
  await sleep(2500);
  if (await jsq(`(() => { const b = document.querySelector("#tfRisk [data-rk=ok]"); if (b && b.getClientRects().length) { b.click(); return true; } return false; })()`, false)) { await sleep(1500); if (!(await isNative())) await tap("#btn3d"); }
  await sleep(12000);
  return (await isNative()) ? "" : "native 3D didn't open";
}
const close3d = async () => { await jsq(`(() => { const T = window.Capacitor && window.Capacitor.Plugins.TrailMap; return T && T.close ? T.close().then(() => true, () => false) : false; })()`); await sleep(2500); };
// The screen now: black where the map is? The page's own note that 3D couldn't draw?
async function drawn(what) {
  const f = join(OUT, `check-${Date.now()}.png`);
  phone.shot(f);
  const k = blackShare(f);
  const toast = await jsq(`(document.getElementById("tfToast") || {}).textContent || ""`, "");
  if (/couldn't draw|may not draw/i.test(toast)) return `${what}: the 3D map didn't draw ("${toast.slice(0, 80)}")`;
  if (k != null && k > 0.6) return `${what}: the map is black (${Math.round(k * 100)}% of the middle of the screen)`;
  return "";
}
// Text too faint on its background, and bottom-bar words cut (as scripts/conditions-test.mjs, run in the page).
const FAINT = `(() => {
  const parse = (c) => { const m = String(c).match(/[\\d.]+/g); if (!m) return null; const [r, g, b, a = 1] = m.map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const behind = (el) => { for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage && s.backgroundImage !== "none") return null; const c = parse(s.backgroundColor); if (c && c.a >= 0.6) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    if (!own || !el.getClientRects().length || el.closest(".leaflet-pane, .leaflet-control-attribution, svg, [aria-hidden=true], .tf-toast")) continue;
    const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) continue;
    const s = getComputedStyle(el); if (s.visibility === "hidden" || +s.opacity < 0.3) continue;
    const fg = parse(s.color), bg = behind(el); if (!fg || !bg || fg.a < 0.5) continue;
    const a = lum(fg), b = lum(bg), k = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    if (k < 2.5) out.push('"' + own.slice(0, 30) + '" ' + k.toFixed(1));
  }
  return [...new Set(out)].slice(0, 8);
})()`;
const FIT = `(() => {
  const out = [];
  document.querySelectorAll("#tabbar button[data-nav]").forEach((b) => { if (b.offsetParent && (b.scrollWidth > b.clientWidth + 2 || b.scrollHeight > b.clientHeight + 2)) out.push("bottom bar: " + b.textContent.trim()); });
  for (const el of document.querySelectorAll("button, a[href], input, select")) {
    if (!el.getClientRects().length || el.closest(".leaflet-control-attribution, [hidden]")) continue;
    const r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight || (r.right <= innerWidth + 1 && r.left >= -1)) continue;
    let s = false; for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if ((o === "auto" || o === "scroll") && e.scrollWidth > e.clientWidth) { s = true; break; } }
    if (!s) out.push("cut off: " + (el.textContent || el.getAttribute("aria-label") || el.id).trim().slice(0, 24));
  }
  return [...new Set(out)].slice(0, 8);
})()`;
async function restart() {
  phone.kill(); await sleep(2000); phone.launch();
  if (!(await pageUp(90000))) { phone.kill(); await sleep(2000); phone.launch(); await pageUp(90000); }
  await sleep(3000);
  await jsq(`(() => { const b = document.querySelector("dialog.tf-terms [data-terms=ok]"); if (b) b.click(); })()`);
  await closeAll();
}

// ---------- the conditions ----------
(async () => {
  phone.launch();
  for (let i = 0; i < 4 && !(await pageUp(i ? 60000 : 120000)); i++) { console.log("  (the app's page didn't answer: opening it again)"); phone.kill(); await sleep(2000); phone.launch(); }
  // As alex's devices: native 3D (tf-admin), the welcome done, the Today card not opening by itself.
  await jsq(`(() => { localStorage.setItem("tf-admin", "1"); localStorage.setItem("tf:welcomed", "true"); localStorage.setItem("tf:todayAuto", "false"); localStorage.setItem("tf:lang", "en"); location.reload(); })()`);
  await sleep(4000); await pageUp();
  await jsq(`(() => { const b = document.querySelector("dialog.tf-terms [data-terms=ok]"); if (b) b.click(); })()`);
  await closeAll();

  // Turned sideways: stays upright.
  cond = "Turned sideways";
  await step("the app stays upright", async () => {
    if (ios) {
      const plist = readFileSync(join(root, "ios-app/ios/App/App/Info.plist"), "utf8");
      const o = (plist.match(/<key>UISupportedInterfaceOrientations<\/key>\s*<array>([\s\S]*?)<\/array>/) || [])[1] || "";
      return /Landscape/.test(o) ? "Info.plist still allows sideways (UISupportedInterfaceOrientations)" : "";
    }
    tryp("adb shell settings put system accelerometer_rotation 0"); tryp("adb shell settings put system user_rotation 1");
    await sleep(4000);
    const s = await jsq("({ w: innerWidth, h: innerHeight })", {});
    tryp("adb shell settings put system user_rotation 0");
    return s.w > s.h ? `the app turned sideways (${s.w} x ${s.h})` : "";
  });

  // Dark mode.
  cond = "Dark mode";
  phone.dark(true); await restart();
  for (const sp of SPORTS) {
    await step(`${NAMES[sp]}: readable`, async () => {
      const r = await pick(sp); if (r) return r;
      await jsq("window.tfTodayOpen && window.tfTodayOpen()"); await sleep(5000);
      const low = await jsq(FAINT, []);
      return low && low.length ? `text too faint to read: ${low.join(", ")}` : "";
    });
    await closeAll();
  }
  await step("Skiing: native 3D draws", async () => { await pick("ski"); return (await open3d()) || (await drawn("dark mode")); });
  await close3d();
  phone.dark(false);

  // Big text.
  cond = "Big text";
  for (const size of ios ? ["accessibility-extra-extra-extra-large"] : ["1.3", "2.0"]) {
    phone.text(size); await restart();
    for (const sp of SPORTS) {
      await step(`${size}: ${NAMES[sp]} fits`, async () => {
        const r = await pick(sp); if (r) return r;
        const bad = [];
        const fit = await jsq(FIT, []); if (fit && fit.length) bad.push(`map: ${fit.join(", ")}`);
        const tabs = await jsq(`[...document.querySelectorAll("#tabbar button[data-nav]")].filter((b) => b.offsetParent).map((b) => b.dataset.nav)`, []);
        for (const t of (tabs || []).filter((t) => t !== "map")) {
          await click(`#tabbar [data-nav=${t}]`); await sleep(1500);
          const f = await jsq(FIT, []); if (f && f.length) bad.push(`tab ${t}: ${f.join(", ")}`);
          const w = await jsq("document.documentElement.scrollWidth - innerWidth", 0); if (w > 2) bad.push(`tab ${t}: ${w} px wider than the screen`);
          await closeAll(); await sleep(500);
        }
        return bad.join(" · ");
      });
    }
  }
  phone.text(null); await restart();

  // Background and back, and the phone's low memory warning, with native 3D open.
  cond = "Background, memory";
  for (const sp of ["ski", "mtb"]) {
    await step(`${NAMES[sp]}: native 3D opens`, async () => { const r = await pick(sp); return r || (await open3d()) || (await drawn("open")); });
    await step(`${NAMES[sp]}: away 20 s and back`, async () => {
      phone.home(); await sleep(20000); phone.launch(); await sleep(6000);
      return await drawn("back from the background");
    });
    await step(`${NAMES[sp]}: low memory warning`, async () => { phone.memory(); await sleep(8000); return await drawn("after the low memory warning"); });
    await step(`${NAMES[sp]}: low memory in the background, then back`, async () => {
      phone.home(); await sleep(3000); phone.memory(); await sleep(10000); phone.launch(); await sleep(8000);
      return await drawn("back after low memory");
    });
    await close3d(); await closeAll();
  }

  // No signal.
  cond = "No signal";
  if (!ios) {
    tryp("adb shell cmd connectivity airplane-mode enable"); await sleep(6000);
    await step("airplane mode: the page knows", async () => ((await jsq("navigator.onLine", true)) ? "navigator.onLine is still true in airplane mode" : ""));
    for (const sp of ["ski", "hike"]) {
      await step(`${NAMES[sp]}: Today card says no signal`, async () => {
        const r = await pick(sp); if (r) return r;
        await jsq("window.tfTodayOpen && window.tfTodayOpen()"); await sleep(25000);
        const t = await jsq(`(document.querySelector(".tdy.open") || {}).innerText || ""`, "");
        if (/Checking today's weather…|Loading…/.test(t)) return "still waiting after 25 s";
        return /No signal/.test(t) ? "" : `no word of the missing signal: "${t.slice(0, 100)}"`;
      });
      await closeAll();
    }
    await step("Skiing: native 3D with no signal", async () => { await pick("ski"); return (await open3d()) || (await drawn("no signal")); });
    await close3d();
    tryp("adb shell cmd connectivity airplane-mode disable"); await sleep(8000);
  } else {
    // The iPhone simulator has no airplane mode: the map servers stop answering instead (the Mac's firewall).
    const hosts = ["tiles.openfreemap.org", "tiles.mapterhorn.com", "api.open-meteo.com", "api.avalanche.ca", "server.arcgisonline.com", "ibasemaps-api.arcgis.com"];
    const ips = [...new Set(hosts.flatMap((h) => tryp(`dig +short ${h} A`).split("\n").filter((x) => /^\d+\.\d+\.\d+\.\d+$/.test(x.trim())).map((x) => x.trim())))];
    const blocked = ips.length && tryp(`echo "block drop out quick proto { tcp udp } to { ${ips.join(" ")} }" | sudo pfctl -a com.apple/tfconditions -f - 2>&1; sudo pfctl -E 2>&1; echo ok`).includes("ok");
    if (blocked) {
      try {
        await step("Skiing: native 3D with the map servers silent", async () => { await pick("ski"); return (await open3d()) || (await drawn("map servers silent")); }, 15000);
        await close3d();
        await step("Hiking: Today card ends with words", async () => {
          await pick("hike"); await jsq("window.tfTodayOpen && window.tfTodayOpen()"); await sleep(40000);
          const t = await jsq(`(document.querySelector(".tdy.open") || {}).innerText || ""`, "");
          return /Checking today's weather…|Loading…/.test(t) ? "still waiting after 40 s" : "";
        });
        await closeAll();
      } finally { tryp("sudo pfctl -a com.apple/tfconditions -F all"); }   // the servers answer again, whatever happened
    } else console.log("- No signal: the firewall couldn't be set here, skipped");
  }

  // Location off.
  cond = "Location off";
  ios ? tryp(`xcrun simctl privacy booted revoke location ${APP}`) : ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"].forEach((p) => tryp(`adb shell pm revoke ${APP} android.permission.${p}`));
  await restart();
  await step("My location says so", async () => {
    await pick("mtb"); await click("#locate"); await sleep(8000);
    // The phone's own question may show first: answered "Don't allow" is the same as off; its words are checked after.
    const t = await jsq("document.body.innerText", "");
    return /Location wasn't shared|Allow location|location is off|Couldn't get your location/i.test(t) ? "" : "no words saying location is off";
  });
  ios ? tryp(`xcrun simctl privacy booted grant location-always ${APP}`) : ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"].forEach((p) => tryp(`adb shell pm grant ${APP} android.permission.${p}`));

  // First open with no connection: the app's own page, then the app by itself once the connection is back.
  cond = "First open, no connection";
  phone.kill(); await sleep(1500);
  down = true;
  phone.launch(); await sleep(15000);
  await step("the app's \"No connection\" page", async () => (phone.running() ? "" : "the app closed"), 500);
  down = false;
  await step("connection back: the app opens by itself", async () => ((await pageUp(60000)) ? "" : "still not open 60 s after the connection came back"));

  const bad = steps.filter((s) => !s.ok);
  const md = `## ${ios ? "iPhone" : "Android"} tough conditions: ${bad.length ? `**${bad.length} problem(s)**` : "all passed"} in ${steps.length} steps\n\n| Condition | Step | Result |\n|---|---|---|\n`
    + steps.map((s) => `| ${s.cond} | ${s.name} | ${s.ok ? "✓" : "✗ " + s.problems.join(" · ").replace(/\|/g, "\\|")} |`).join("\n") + "\n";
  writeFileSync(join(OUT, "summary.md"), md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.log("✗ stopped: " + (e.stack || e)); process.exit(1); });
