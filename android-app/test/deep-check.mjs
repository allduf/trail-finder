// Deep check of the Android app (android-app.yml, "Run workflow" with deep ticked; one simulator per sport): the way a
// rider goes through the app on an Android phone, with the phone's own Back button, the native 3D map and the system
// settings a phone can have. For one sport (SPORT):
//   - every tab of the bottom bar, then every card and button in it, each closed again with the phone's Back button;
//   - every layer in Layers on and off, and Back closes Layers;
//   - the 3D button as a real finger tap (native 3D on alex's devices), every button on the native 3D screen, Back;
//   - the app sent away (Home) and brought back, the screen turned sideways, bigger system text, dark mode;
//   - (mtb only) the sign-in box, saving a spot, the native offline copy of a small area.
// Records script errors, taps that close the app, Back that does nothing or closes the app, sideways scrolling,
// crashes in the phone's log, and a screenshot of each step. Never fails the job: the summary lists what it found.
import { execSync } from "node:child_process";
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";

const APP = "com.allduf.trailfinder";
const SPORT = process.env.SPORT || "mtb";
const NAMES = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", fish: "Fishing", moto: "Adventure moto", hike: "Hiking" };
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
const adb = (c) => sh(`adb ${c}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync("shots", { recursive: true });
const results = [];
let shotN = 0;
function shot(name) {
  const f = `${SPORT}-${String(++shotN).padStart(3, "0")}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}.png`;
  try { execSync(`adb exec-out screencap -p > shots/${f}`, { shell: "/bin/bash", timeout: 20000 }); } catch {}
  return f;
}
// Capacitor's own SystemBars line when the page reloads after a system change (font size, dark mode): not the app's.
const NOISE = /Error injecting safe area CSS/;
const NETWORK = /Failed to fetch|NetworkError|network error|aborted|AbortError|ERR_|Load failed|status of [45]\d\d|AJAXError|Failed to load resource|tile|WebGL|GL_|Unrecognized feature|Access-Control|CORS/i;

// ---------- the page, through Chrome's DevTools ----------
let ws, seq = 0, errors = [];
const waiting = new Map();
async function target() {
  for (let i = 0; i < 30; i++) {
    try {
      const sock = (adb("shell cat /proc/net/unix").match(/@(webview_devtools_remote_\d+)/) || [])[1];
      if (sock) {
        try { adb("forward --remove tcp:9222"); } catch {}
        adb(`forward tcp:9222 localabstract:${sock}`);
        const list = await (await fetch("http://127.0.0.1:9222/json")).json();
        const p = list.find((x) => x.type === "page" && /10\.0\.2\.2/.test(x.url));
        if (p) return p;
      }
    } catch {}
    await sleep(2000);
  }
  throw new Error("the app's web page never showed up");
}
async function connect() {
  if (ws) try { ws.close(); } catch {}
  const p = await target();
  ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); return; }
    if (d.method === "Runtime.exceptionThrown") {
      const x = d.params.exceptionDetails, msg = (x.exception && x.exception.description || x.text || "").split("\n")[0];
      const at = x.url ? ` @${x.url.split("/").pop().split("?")[0]}:${x.lineNumber + 1}` : "";
      if (!NETWORK.test(msg)) errors.push(msg.slice(0, 200) + at);
    } else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
      const t = d.params.args.map((a) => a.value || a.description || "").join(" ").split("\n")[0];
      if (!NETWORK.test(t) && !NOISE.test(t)) errors.push("console: " + t.slice(0, 200));
    }
  };
  ws.onclose = () => { for (const [, f] of waiting) f({ result: { exceptionDetails: { text: "page connection closed" } } }); waiting.clear(); };
  await cdp("Runtime.enable");
}
function cdp(method, params = {}) {
  const id = ++seq;
  return new Promise((r, j) => {
    const t = setTimeout(() => { waiting.delete(id); j(new Error(`the page didn't answer in 60 s (${method})`)); }, 60000);
    waiting.set(id, (d) => { clearTimeout(t); r(d); });
    try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { clearTimeout(t); waiting.delete(id); j(e); }
  });
}
async function js(expr) {
  const res = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.result && res.result.exceptionDetails) throw new Error(String(res.result.exceptionDetails.exception && res.result.exceptionDetails.exception.description || res.result.exceptionDetails.text).split("\n")[0]);
  return res.result && res.result.result && res.result.result.value;
}
// The app is the one on screen: any resumed-activity line names it (the first line can be another display's).
const front = () => {
  try {
    const lines = adb("shell dumpsys activity activities").split("\n").filter((l) => /ResumedActivity/.test(l));
    if (lines.some((l) => l.includes(APP))) return true;
    console.log("    (not in front: " + lines.map((l) => l.trim()).join(" / ").slice(0, 300) + ")");
    return false;
  } catch { return false; }
};
const crashes = () => { try { return adb("logcat -d -b crash").trim(); } catch { return ""; } };
let crashSeen = "";
async function relaunch() {
  try { adb("shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS"); } catch {}
  adb(`shell am start -W -n ${APP}/.MainActivity`);
  await sleep(8000);
  await connect();
}
const key = async (k, ms = 1200) => { adb(`shell input keyevent ${k}`); await sleep(ms); };

// One step: run it, let the app settle, note new script errors, sideways scrolling, a crash, the app gone.
async function step(name, fn, settle = 1500, { shotIt = true } = {}) {
  const before = errors.length;
  let note = "";
  try { const r = await fn(); if (typeof r === "string" && r) note = r; } catch (e) { note = String(e.message || e).split("\n")[0].slice(0, 200); }
  await sleep(settle);
  const problems = [];
  if (note) problems.push(note);
  const c = crashes();
  if (c && c !== crashSeen) { problems.push("APP CRASHED: " + (c.slice(crashSeen.length).match(/(?:Exception|Error|signal)[^\n]*/) || [c.slice(-200)])[0].slice(0, 220)); crashSeen = c; }
  if (!front()) { problems.push("the app isn't on screen any more"); try { await relaunch(); } catch (e) { problems.push("couldn't open it again: " + e.message); } }
  else {
    const wide = await js(`(() => { const w = document.documentElement.scrollWidth, v = innerWidth; return w > v + 2 ? w - v : 0; })()`).catch(() => 0);
    if (wide) problems.push(`page is ${wide} px wider than the screen (sideways scrolling)`);
  }
  problems.push(...errors.slice(before));
  const f = shotIt ? shot(name) : "";
  results.push({ step: name, ok: !problems.length, note: problems.join(" · "), shot: f });
  console.log(`${problems.length ? "✗" : "✓"} ${name}${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
  return !problems.length;
}
const note = (name, ok, more = "") => { results.push({ step: name, ok, note: more, shot: "" }); console.log(`${ok ? "✓" : "✗"} ${name}${more ? ": " + more : ""}`); };

// What's open on the page: dialogs, cards, sheets, menus, the hub.
const OPEN = `(() => {
  const vis = (e) => !!e && !e.hidden && e.offsetParent !== null && getComputedStyle(e).visibility !== "hidden";
  const out = [...document.querySelectorAll("dialog[open]")].map((d) => "dialog." + (d.className || d.id || "?"));
  const hub = document.getElementById("hub"); if (hub && vis(hub)) out.push("hub");
  const lm = document.getElementById("layersMenu"); if (lm && !lm.hidden) out.push("layers");
  const rk = document.getElementById("tfRisk"); if (rk && vis(rk)) out.push("trip sheet");
  document.querySelectorAll(".offline-card, .sheet, .card, [role=dialog]").forEach((e) => { if (vis(e) && !e.closest("dialog")) out.push((e.className || e.getAttribute("role")) + ""); });
  return out;
})()`;

// Back until nothing is open (at most 4 presses); the app must stay on screen with the page.
async function backOut(what) {
  for (let i = 0; i < 4; i++) {
    const open = await js(OPEN).catch(() => []);
    if (!open.length) return "";
    const href = await js("location.href").catch(() => "");
    await key("KEYCODE_BACK", 900);
    if (!front()) return `Back closed the app while ${open.join(", ")} was open (${what})`;
    const after = await js(OPEN).catch(() => []);
    const href2 = await js("location.href").catch(() => "");
    if (JSON.stringify(after) === JSON.stringify(open) && href === href2) return `Back did nothing with ${open.join(", ")} open (${what})`;
  }
  const left = await js(OPEN).catch(() => []);
  return left.length ? `still open after 4 Backs: ${left.join(", ")} (${what})` : "";
}
// Back at the main page, the right page: a link that left index.html comes back.
async function home() {
  const href = await js("location.pathname").catch(() => "");
  if (!/\/(index\.html)?$/.test(href)) { await js(`location.href = "http://10.0.2.2:8080/index.html"`).catch(() => {}); await sleep(6000); await connect(); }
}
const click = (sel, i = 0) => js(`(() => { const b = document.querySelectorAll(${JSON.stringify(sel)})[${i}]; if (!b) return "not found: ${sel.replace(/"/g, "'")}"; b.scrollIntoView({ block: "center" }); b.click(); return ""; })()`);

// A real finger tap on an element (isTrusted: the 3D button only opens native 3D for a real tap).
// The one-time "Your trip, your decisions" sheet (risk.js) before routes and 3D: agreed to like a person would.
const agree = () => js(`(() => { const b = document.querySelector("#tfRisk [data-rk=ok]"); if (b && b.offsetParent) { b.click(); return true; } return false; })()`).catch(() => false);
async function fingerTap(sel) {
  const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, dpr: devicePixelRatio, ih: innerHeight }; })()`);
  if (!r) return `not found: ${sel}`;
  // The web view fills the screen under the status bar or not: its top is the screen height less its own height
  // and the navigation bar, measured once.
  const off = await webTop(r);
  adb(`shell input tap ${Math.round(r.x * r.dpr)} ${Math.round(r.y * r.dpr + off)}`);
  return "";
}
let topPx = null;
// Where the web view's top is on the screen: a tap on the map, and where the page saw it.
async function webTop(r) {
  if (topPx != null) return topPx;
  topPx = 0;
  try {
    // A see-through cover takes the tap, so nothing on the map is tapped.
    await js(`(() => { window.__tapY = null; const d = document.createElement("div"); d.id = "__probe"; d.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:transparent";
      d.addEventListener("touchstart", (e) => { window.__tapY = e.touches[0].clientY; e.preventDefault(); e.stopPropagation(); }, { passive: false });
      d.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); }); document.body.append(d); })()`);
    const y = Math.round(innerMid(r));
    adb(`shell input tap 20 ${y}`);
    await sleep(800);
    const cy = await js("window.__tapY");
    await js(`document.getElementById("__probe")?.remove()`);
    if (cy != null) topPx = Math.round(y - cy * r.dpr);
  } catch {}
  console.log(`    (web view top: ${topPx} px)`);
  return topPx;
}
const innerMid = (r) => r.ih * r.dpr * 0.45;

// Native 3D screen: its own buttons (Android views), from the screen's layout.
function nativeButtons() {
  try {
    adb("shell uiautomator dump /sdcard/ui.xml");
    const x = adb("shell cat /sdcard/ui.xml");
    const out = [];
    for (const m of x.matchAll(/<node [^>]*>/g)) {
      const n = m[0], a = (k) => (n.match(new RegExp(` ${k}="([^"]*)"`)) || [])[1] || "";
      if (a("package") !== APP || a("clickable") !== "true" || /WebView/.test(a("class"))) continue;
      const b = a("bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (!b) continue;
      const label = a("text") || a("content-desc") || a("resource-id") || a("class").split(".").pop();
      out.push({ label, x: (+b[1] + +b[3]) >> 1, y: (+b[2] + +b[4]) >> 1, w: b[3] - b[1], h: b[4] - b[2] });
    }
    return out;
  } catch { return []; }
}
// The top screen's views (the native 3D map is a MapLibre MapView over the web view).
const webViewShows = () => { try { const t = adb(`shell dumpsys activity top`); const i = t.indexOf(APP); return i >= 0 ? t.slice(i) : t; } catch { return ""; } };

(async () => {
  try { adb("logcat -c -b crash"); } catch {}
  await connect();
  // alex's devices (tf-admin): native 3D and its offline copies. The Today card off (it opens by itself once a day).
  await js(`localStorage.setItem("tf-admin", "1"); localStorage.setItem("tf:todayAuto", "false"); location.reload()`).catch(() => {});
  await sleep(9000);
  await connect();
  await step("Open the app", async () => {
    await js(`(() => { const b = document.querySelector("dialog.tf-terms [data-terms=ok]"); if (b) b.click(); })()`);
    await sleep(1500);
    await key("KEYCODE_BACK", 800);   // the welcome, if it opened
    if (!front()) { await relaunch(); return "Back on the welcome closed the app"; }
    return "";
  }, 2000);
  await webTop(await js(`({ dpr: devicePixelRatio, ih: innerHeight })`));
  const info = await js(`({ dpr: devicePixelRatio, w: innerWidth, h: innerHeight, ua: navigator.userAgent, keys: window.tfNative ? "yes" : "no" })`).catch(() => ({}));
  console.log(JSON.stringify(info));

  // ---------- the sport ----------
  await step(`Pick ${NAMES[SPORT]}`, async () => {
    const r = await click("#sportMapBtn");
    if (r) return r;
    await sleep(600);
    const r2 = await click(`#sportMenu [data-sport=${SPORT}]`);
    if (r2) return r2;
    await sleep(SPORT === "ski" ? 9000 : 5000);
    const v = await js(`document.getElementById("sport").value`);
    return v === SPORT ? "" : `sport is ${v}`;
  }, 2000);
  await key("KEYCODE_BACK", 600);   // a first-time tip
  await backOut("after picking the sport").then((p) => p && note("Back after picking the sport", false, p));

  // ---------- tabs and their cards ----------
  const tabs = await js(`[...document.querySelectorAll("#tabbar button[data-nav]")].filter((b) => b.offsetParent && getComputedStyle(b).display !== "none").map((b) => ({ nav: b.dataset.nav, label: b.textContent.trim() }))`);
  // Buttons that leave the app's test state or act on the account for real: not tapped.
  const SKIP = /^(start|signout|delete|deleteAccount|share|rate|store|feedback|photo|camera|import|gpx|strava|email)$/i;
  for (const t of tabs.filter((t) => t.nav !== "map")) {
    let cards = [];
    await step(`Tab ${t.label}`, async () => {
      const r = await click(`#tabbar [data-nav=${t.nav}]`);
      await sleep(1200);
      cards = await js(`[...document.querySelectorAll("#hub [data-hub]")].filter((b) => b.offsetParent).map((b, i) => ({ i, hub: b.dataset.hub, id: b.dataset.id || "", label: (b.querySelector("b") || b).textContent.trim().slice(0, 40) }))`).catch(() => []);
      return r;
    });
    const p = await backOut(`tab ${t.label}`);
    note(`Back closes tab ${t.label}`, !p, p);
    for (const c of cards.slice(0, 30)) {
      if (SKIP.test(c.hub)) continue;
      await step(`${t.label} › ${c.label || c.hub}`, async () => {
        await click(`#tabbar [data-nav=${t.nav}]`);
        await sleep(900);
        const sel = c.id ? `#hub [data-hub="${c.hub}"][data-id="${c.id}"]` : `#hub [data-hub="${c.hub}"]`;
        return click(sel);
      }, 1800);
      const b = await backOut(`${t.label} › ${c.label || c.hub}`);
      if (b) note(`Back after ${t.label} › ${c.label || c.hub}`, false, b);
      await home();
      // A layer chip turned on stays on: off again.
      if (c.hub === "layer") { await click(`#tabbar [data-nav=${t.nav}]`); await sleep(600); await click(`#hub [data-hub="layer"][data-id="${c.id}"]`); await sleep(600); await backOut("layer chip"); }
    }
  }

  // ---------- Layers ----------
  await step("Layers", () => click("#layersBtn"));
  const toggles = await js(`[...document.querySelectorAll("#layersMenu button[aria-pressed]")].filter((b) => b.offsetParent && !b.disabled).map((b) => ({ id: b.id, label: b.textContent.trim().slice(0, 40), on: b.getAttribute("aria-pressed") === "true" }))`).catch(() => []);
  for (const tg of toggles.filter((x) => x.id)) {
    await step(`Layer ${tg.label} ${tg.on ? "off" : "on"}`, async () => {
      if (await js(`document.getElementById("layersMenu").hidden`)) await click("#layersBtn");
      await sleep(300);
      return click(`#${tg.id}`);
    }, 2500, { shotIt: !tg.on });
    // Some layers open their own card or legend: Back closes it, Layers stays.
    await step(`Layer ${tg.label} back as it was`, async () => {
      for (let i = 0; i < 2; i++) { const o = await js(OPEN).catch(() => []); if (o.some((x) => x !== "layers")) await key("KEYCODE_BACK", 700); }
      if (await js(`document.getElementById("layersMenu").hidden`)) await click("#layersBtn");
      await sleep(300);
      const now = await js(`document.getElementById(${JSON.stringify(tg.id)}).getAttribute("aria-pressed") === "true"`);
      if (now !== tg.on) await click(`#${tg.id}`);
      return "";
    }, 1200, { shotIt: false });
  }
  if (await js(`document.getElementById("layersMenu").hidden`).catch(() => true)) await click("#layersBtn");
  await sleep(500);
  await step("Back closes Layers", async () => {
    await key("KEYCODE_BACK");
    return (await js(`document.getElementById("layersMenu").hidden`)) ? "" : "Layers still open";
  });
  await backOut("after Layers");

  // ---------- 3D: a real finger tap ----------
  await js(`window.__tmEv = []; (() => { const C = Capacitor, T = C.registerPlugin ? C.registerPlugin("TrailMap") : C.Plugins.TrailMap; if (T && T.addListener) T.addListener("closed", (e) => window.__tmEv.push(e)); })()`).catch(() => {});
  const was3d = await js(`!!document.querySelector("#btn3d.on, #btn3d[aria-pressed=true]")`).catch(() => false);
  if (was3d) { await click("#btn3d"); await sleep(3000); }   // Skiing opens on web 3D: back to the flat map first
  let native = false;
  await step("3D button (finger tap)", async () => {
    const r = await fingerTap("#btn3d");
    if (r) return r;
    await sleep(2500);
    if (await agree()) { console.log("    (agreed to the trip sheet, tapping 3D again)"); await sleep(1500); if (!/maplibre[\w.]*MapView|TrailMapScreen/.test(webViewShows()) && !(await js(`!!document.querySelector("#btn3d.on")`))) await fingerTap("#btn3d"); }
    await sleep(12000);
    const web = await js(`!!document.querySelector(".is3d") || !!document.querySelector("#btn3d.on")`);
    const ui = webViewShows();
    native = /maplibre[\w.]*MapView|TrailMapScreen/.test(ui) && !web;
    console.log(`    3D opened as: ${native ? "native" : web ? "web 3D" : "nothing?"}`);
    return native || web ? "" : "neither native nor web 3D opened";
  }, 1000);
  if (native) {
    const btns = nativeButtons();
    console.log(`    native buttons: ${btns.map((b) => b.label).join(" | ")}`);
    for (const b of btns.slice(0, 16)) {
      if (/back|close|retour/i.test(b.label)) continue;
      await step(`Native 3D › ${b.label}`, async () => {
        if (!/maplibre[\w.]*MapView|TrailMapScreen/.test(webViewShows())) { await fingerTap("#btn3d"); await sleep(12000); }
        adb(`shell input tap ${b.x} ${b.y}`);
        await sleep(3500);
        return "";
      }, 1000);
      // Back once: a card or dialog closes; if the map closed instead, that's fine too (opened again next button).
      await key("KEYCODE_BACK", 1500);
      if (!front()) { note(`Back after Native 3D › ${b.label}`, false, "Back closed the app"); await relaunch(); }
      await backOut(`after native ${b.label}`);
    }
    await step("Native 3D: fingers (pan, pinch-free zoom tap)", async () => {
      if (!/maplibre[\w.]*MapView|TrailMapScreen/.test(webViewShows())) { await fingerTap("#btn3d"); await sleep(12000); }
      adb("shell input swipe 700 1400 400 1000 600"); await sleep(1500);
      adb("shell input swipe 400 1000 800 1600 600"); await sleep(1500);
      return "";
    }, 3000);
    await step("Back closes native 3D", async () => {
      await js(`window.__tmEv = []`);
      for (let i = 0; i < 3 && /maplibre[\w.]*MapView|TrailMapScreen/.test(webViewShows()); i++) await key("KEYCODE_BACK", 2000);
      if (!front()) return "Back closed the app";
      const ev = await js(`window.__tmEv`).catch(() => []);
      return /maplibre[\w.]*MapView|TrailMapScreen/.test(webViewShows()) ? "native 3D still showing after 3 Backs" : ev.length ? "" : "no 'closed' event to the page";
    });
  } else {
    await step("3D off", async () => { await click("#btn3d"); return ""; }, 3000);
  }
  // "Native 3D (test)" in Layers: on every build, alex only.
  await step("Layers › Native 3D (test)", async () => {
    await click("#layersBtn"); await sleep(500);
    const has = await js(`!!document.getElementById("native3dBtn") && !document.getElementById("native3dBtn").hidden`);
    if (!has) return "no Native 3D (test) button in Layers";
    await click("#native3dBtn");
    await sleep(2500);
    if (await agree()) { await sleep(1000); if (!/maplibre[\w.]*MapView|TrailMapScreen/.test(webViewShows())) { await click("#layersBtn"); await sleep(500); await click("#native3dBtn"); } }
    await sleep(12000);
    return /maplibre[\w.]*MapView|TrailMapScreen/.test(webViewShows()) ? "" : "native 3D didn't open";
  }, 500);
  for (let i = 0; i < 3 && /maplibre[\w.]*MapView|TrailMapScreen/.test(webViewShows()); i++) await key("KEYCODE_BACK", 2000);
  await backOut("after native 3D (test)");

  // ---------- away and back ----------
  await step("Home, then back to the app", async () => {
    const s0 = await js(`document.getElementById("sport").value`);
    await key("KEYCODE_HOME", 3000);
    adb(`shell monkey -p ${APP} -c android.intent.category.LAUNCHER 1`);
    await sleep(4000);
    await connect();
    const s1 = await js(`document.getElementById("sport").value`);
    return s0 === s1 ? "" : `sport changed from ${s0} to ${s1}`;
  }, 1500);

  // ---------- the phone's own settings ----------
  await step("Screen turned sideways", async () => {
    adb("shell settings put system accelerometer_rotation 0");
    adb("shell settings put system user_rotation 1");
    await sleep(4000);
    return "";
  }, 1500);
  for (const t of tabs.filter((t) => t.nav !== "map").slice(0, 3)) {
    await step(`Sideways › ${t.label}`, () => click(`#tabbar [data-nav=${t.nav}]`), 1500);
    await backOut(`sideways ${t.label}`);
  }
  adb("shell settings put system user_rotation 0");
  await sleep(3000);
  await step("Biggest system text (font size 1.3)", async () => {
    adb("shell settings put system font_scale 1.3");
    await sleep(5000);
    await connect();
    return "";
  }, 1500);
  for (const t of tabs.filter((t) => t.nav !== "map")) {
    await step(`Big text › ${t.label}`, () => click(`#tabbar [data-nav=${t.nav}]`), 1500);
    await backOut(`big text ${t.label}`);
  }
  await step("Big text › Layers", () => click("#layersBtn"), 1200);
  await backOut("big text layers");
  adb("shell settings put system font_scale 1.0");
  await sleep(3000);
  await step("Dark mode", async () => {
    adb("shell cmd uimode night yes");
    await sleep(5000);
    await connect();
    return "";
  }, 1500);
  await step("Dark mode › More", () => click(`#tabbar [data-nav=more]`), 1500);
  await backOut("dark more");
  adb("shell cmd uimode night no");
  await sleep(3000);
  await connect().catch(() => {});

  // ---------- MTB run only: account, saving, native offline copy ----------
  if (SPORT === "mtb") {
    await step("Sign-in box", async () => {
      const r = await js(`window.tfAccount && window.tfAccount.open ? (window.tfAccount.open(), "") : "no tfAccount.open"`);
      await sleep(1500);
      return r;
    }, 1000);
    await step("Sign-in box: email field and keyboard", async () => {
      const r = await js(`(() => { const i = [...document.querySelectorAll("dialog[open] input[type=email], dialog[open] input")].find((x) => x.offsetParent); if (!i) return "no email field"; i.focus(); return ""; })()`);
      adb("shell input text test");
      await sleep(1500);
      const v = await js(`(document.activeElement || {}).value || ""`);
      return r || (/test/.test(v) ? "" : `typed text didn't arrive (${v})`);
    }, 1000);
    await step("Back hides the keyboard, then closes the sign-in box", async () => {
      await key("KEYCODE_BACK", 1000);
      await key("KEYCODE_BACK", 1000);
      const o = await js(OPEN);
      if (!front()) return "Back closed the app";
      return o.some((x) => /dialog/.test(x)) ? `still open: ${o.join(", ")}` : "";
    });
    await backOut("sign-in");

    await step("Save a spot (long press on the map)", async () => {
      const r = await js(`(() => { const m = document.getElementById("map"); const b = m.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, dpr: devicePixelRatio, ih: innerHeight }; })()`);
      const off = await webTop(r);
      adb(`shell input swipe ${Math.round(r.x * r.dpr)} ${Math.round(r.y * r.dpr + off)} ${Math.round(r.x * r.dpr)} ${Math.round(r.y * r.dpr + off)} 900`);
      await sleep(2000);
      return "";
    }, 1000);
    await backOut("long press");

    await step("Native offline copy of a small area (2 km, Whistler)", async () => {
      const draws = await js(`window.tfNative && window.tfNative.draws ? window.tfNative.draws("offline") : "no tfNative.draws"`);
      if (draws !== true) return `this build doesn't save native offline copies (${draws})`;
      await js(`window.__off = null; (() => { const T = Capacitor.Plugins.TrailMap; T.addListener("offlinePacks", (r) => { window.__off = r; }); })()`);
      const r = await js(`Capacitor.Plugins.TrailMap.offline({ areas: [{ id: "deeptest", box: [50.10, -122.97, 50.12, -122.94], ski: false, sharp: false }] }).then((r) => JSON.stringify(r))`);
      console.log("    offline answer: " + String(r).slice(0, 300));
      let last = "";
      for (let i = 0; i < 40; i++) {
        await sleep(3000);
        last = await js(`JSON.stringify(window.__off)`).catch(() => "");
        if (/"saved":true/.test(last)) break;
      }
      console.log("    offline state: " + String(last).slice(0, 400));
      return /"saved":true/.test(last) ? "" : `not saved after 2 min: ${String(last).slice(0, 160)}`;
    }, 1000);
    await step("Native 3D with no signal (airplane mode) shows the saved area", async () => {
      adb("shell cmd connectivity airplane-mode enable");
      await sleep(4000);
      await click("#layersBtn"); await sleep(500);
      await click("#native3dBtn");
      await sleep(12000);
      return /maplibre[\w.]*MapView|TrailMapScreen/.test(webViewShows()) ? "" : "native 3D didn't open with no signal";
    }, 1000);
    for (let i = 0; i < 3 && /maplibre[\w.]*MapView|TrailMapScreen/.test(webViewShows()); i++) await key("KEYCODE_BACK", 2000);
    await step("No signal: the page still answers", async () => {
      await backOut("offline");
      await click("#tabbar [data-nav=saved]");
      await sleep(1500);
      return "";
    }, 1000);
    await backOut("offline saved");
    adb("shell cmd connectivity airplane-mode disable");
    await sleep(4000);
    await js(`Capacitor.Plugins.TrailMap.offline({ areas: [] })`).catch(() => {});
  }

  // ---------- the phone's log and memory ----------
  const mem = (() => { try { return (adb(`shell dumpsys meminfo ${APP}`).match(/TOTAL PSS:\s*(\d+)/) || adb(`shell dumpsys meminfo ${APP}`).match(/TOTAL\s+(\d+)/) || [])[1]; } catch { return ""; } })();
  note("Memory at the end", true, mem ? `${Math.round(mem / 1024)} MB` : "?");
  const anr = (() => { try { return (adb("logcat -d -b events").match(/am_anr[^\n]*/g) || []).filter((l) => l.includes(APP)); } catch { return []; } })();
  note("No 'app not responding'", !anr.length, anr.slice(0, 3).join(" | "));
  const c = crashes();
  note("No crash in the phone's log", !c, c.slice(0, 600));

  // ---------- report ----------
  const bad = results.filter((r) => !r.ok);
  const md = [`## Android deep check: ${NAMES[SPORT]}`, "", bad.length ? `**${bad.length} problem(s)** in ${results.length} steps.` : `**All ${results.length} steps passed.**`, "",
    "| Step | Result |", "|---|---|", ...results.map((r) => `| ${r.step.replace(/\|/g, "/")} | ${r.ok ? "✓" + (r.note ? " " + r.note : "") : "✗ " + r.note.replace(/\|/g, "/")} |`), ""].join("\n");
  writeFileSync(`shots/${SPORT}-results.md`, md);
  writeFileSync(`shots/${SPORT}-results.json`, JSON.stringify(results, null, 1));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  console.log(`\n${bad.length} problem(s) in ${results.length} steps`);
  try { ws.close(); } catch {}
  process.exit(0);
})().catch((e) => {
  console.log(`✗ ${e.stack || e}`); shot("error");
  const md = `## Android deep check: ${NAMES[SPORT]}\n\nStopped early: ${e.message}\n\n` + results.map((r) => `- ${r.ok ? "✓" : "✗"} ${r.step} ${r.note}`).join("\n");
  writeFileSync(`shots/${SPORT}-results.md`, md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  process.exit(0);
});
