// The video Google Play asks for in the foreground service declaration (FOREGROUND_SERVICE_LOCATION): the real app on
// the phone simulator, started by hand from the Ride button, the ride notification, the app put away while the GPS
// keeps recording, back in the app, Stop and Save. Recorded with screenrecord into shots/fgs-video.mp4, with the time
// of each step in shots/fgs-video-steps.json (for captions). Run by test/phone-check.sh after the phone check; a
// failure here never fails the check.
import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const APP = "com.allduf.trailfinder";
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const adb = (c) => sh(`adb ${c}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page() {
  for (let i = 0; i < 30; i++) {
    try {
      const sock = (adb("shell cat /proc/net/unix").match(/@(webview_devtools_remote_\d+)/) || [])[1];
      if (sock) {
        try { adb("forward --remove tcp:9222"); } catch {}
        adb(`forward tcp:9222 localabstract:${sock}`);
        const list = await (await fetch("http://127.0.0.1:9222/json")).json();
        const p = list.find((x) => x.type === "page" && /10\.0\.2\.2/.test(x.url) && !/offline/.test(x.url));
        if (p) return p;
      }
    } catch {}
    await sleep(2000);
  }
  throw new Error("the app's web page never showed up");
}
let ws, seq = 0;
const waiting = new Map();
async function connect() {
  const p = await page();
  ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
}
async function js(expr) {
  const id = ++seq;
  const res = await new Promise((r) => { waiting.set(id, r); ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } })); });
  return res.result && res.result.result && res.result.result.value;
}

// A real finger tap (shown by "show touches") on the element's middle: the page's CSS pixels to screen pixels, using
// where the web view sits on the screen (the page's own size against the screen's).
async function tap(selector, what) {
  const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: "nearest" });
    const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, dpr: devicePixelRatio, w: innerWidth, h: innerHeight }; })()`);
  if (!r) { console.log(`(no ${what} on the page)`); return false; }
  console.log(`${what}: css ${r.x.toFixed(0)},${r.y.toFixed(0)} page ${r.w}x${r.h} dpr ${r.dpr}`);
  const size = adb("shell wm size").match(/(\d+)x(\d+)\s*$/m);
  const W = +size[1], H = +size[2];
  const viewH = r.h * r.dpr;
  // The web view is below the status bar and above the gesture bar; it fills the width.
  const nav = 63, top = Math.max(0, Math.round(H - nav - viewH));
  const x = Math.round(r.x * (W / r.w)), y = Math.round(top + r.y * r.dpr);
  console.log(`tap ${what} at ${x},${y}`);
  adb(`shell input tap ${x} ${y}`);
  await sleep(400);
  return true;
}

// The ride follows a real trail at Lost Lake (Whistler), from OpenStreetMap, so the track is drawn along it.
let path = [], step = 0;
async function loadTrail() {
  // phone-check.sh puts the live site's Whistler trail file in data/ (the app reads it too, so it names the trail).
  try {
    const f = JSON.parse(readFileSync("../data/mtb-wh.json", "utf8"));
    const w = f.ways["318391930"] || Object.values(f.ways).find((x) => x.tags && x.tags.name === "Molly Hogan Trail");
    const g = [];
    for (let i = 0; i < w.g.length; i += 2) g.push({ lat: w.g[i], lon: w.g[i + 1] });
    // Points every ~7 m (one GPS fix a second at a riding speed of ~25 km/h)
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1], b = g[i], d = Math.hypot((b.lat - a.lat) * 111000, (b.lon - a.lon) * 71500), n = Math.max(1, Math.round(d / 7));
      for (let k = 0; k < n; k++) path.push([a.lon + (b.lon - a.lon) * k / n, a.lat + (b.lat - a.lat) * k / n]);
    }
    console.log(`ride follows "${w.tags.name}" (${path.length} fixes)`);
    return;
  } catch (e) { console.log(`(no trail file: ${e.message})`); }
  for (let i = 0; i < 200; i++) path.push([-122.957 + i * 0.00012, 50.116 + i * 0.00009]);
}
let alt = 680;
const here = () => path[Math.min(step, path.length - 1)];
async function move(seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    step = (step + 1) % path.length; alt += 0.4;
    const [lo, la] = here();
    adb(`emu geo fix ${lo.toFixed(6)} ${la.toFixed(6)} ${alt.toFixed(1)}`);
    await sleep(1000);
  }
}

(async () => {
  sh("mkdir -p shots");
  // A clean start: the app open on the map, no system popups, terms agreed, touches shown.
  try { adb("shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS"); } catch {}
  adb("shell settings put system show_touches 1");
  adb(`shell am force-stop ${APP}`);
  await loadTrail();
  adb(`emu geo fix ${here()[0]} ${here()[1]} ${alt}`);
  adb(`shell monkey -p ${APP} -c android.intent.category.LAUNCHER 1`);
  await sleep(15000);
  await connect();
  await js(`(() => { const b = [...document.querySelectorAll("button")].find((x) => /^\\s*I agree\\s*$/.test(x.textContent) && x.offsetParent); if (b) b.click(); })()`);
  await js(`document.querySelectorAll("dialog[open]").forEach((d) => d.close())`);
  await js(`try { localStorage.removeItem("tf:lockTip"); } catch {}`);   // the "you can lock your phone" tip shows in the video
  try { adb("shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS"); } catch {}
  await move(4);

  const rec = spawn("adb", ["shell", "screenrecord", "--size", "720x1600", "--bit-rate", "8000000", "--time-limit", "150", "/sdcard/fgs.mp4"], { stdio: "ignore" });
  const t0 = Date.now();
  const steps = [];
  const step = (text) => { steps.push({ t: (Date.now() - t0) / 1000, text }); console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${text}`); };
  await sleep(1500);

  step("The user opens Ride and taps Start riding");
  await sleep(2500);
  await tap('#tabbar [data-nav="ride"]', "Ride tab");
  await sleep(1200);
  if (!(await js(`(() => { const b = document.querySelector('[data-hub="start"]'); return !!(b && b.offsetParent); })()`))) { console.log("(Ride tab tap missed: clicking)"); await js(`document.querySelector('#tabbar [data-nav="ride"]').click()`); }
  await sleep(1800);
  await tap('[data-hub="start"]', "Start riding");
  await sleep(1500);
  if (!(await js(`!!(window.tfRide && tfRide.riding())`))) { console.log("(Start tap missed: clicking)"); await js(`document.querySelector('[data-hub="start"]').click()`); }
  step("Recording: the map follows the GPS and draws the track");
  await move(9);

  step("A notification shows while the ride records");
  adb("shell cmd statusbar expand-notifications");
  await move(5);
  adb("shell cmd statusbar collapse");
  await sleep(800);

  step("The app is put away: the GPS keeps recording in the foreground service");
  adb("shell input keyevent KEYCODE_HOME");
  await move(6);
  adb("shell cmd statusbar expand-notifications");
  await move(4);
  adb("shell cmd statusbar collapse");
  await sleep(600);

  step("Back in the app: the track kept going while it was away");
  adb(`shell monkey -p ${APP} -c android.intent.category.LAUNCHER 1`);
  await move(6);

  step("The user taps Stop and saves: the GPS and the notification stop");
  await tap("#navStop", "Stop");
  await sleep(1000);
  if (await js(`document.getElementById("navAsk").hidden`)) { console.log("(Stop tap missed: clicking)"); await js(`document.getElementById("navStop").click()`); }
  await sleep(1500);
  await tap("#navSave", "Save ride");
  await sleep(1500);
  if (await js(`!!(window.tfRide && tfRide.riding())`)) { console.log("(Save tap missed: clicking)"); await js(`document.getElementById("navSave").click()`); }
  await sleep(3500);
  adb("shell cmd statusbar expand-notifications");
  await sleep(3500);
  adb("shell cmd statusbar collapse");
  await sleep(1500);
  step("end");

  try { adb("shell pkill -INT screenrecord"); } catch {}
  await new Promise((r) => { rec.on("exit", r); setTimeout(r, 8000); });
  await sleep(1500);
  adb("pull /sdcard/fgs.mp4 shots/fgs-video.mp4");
  writeFileSync("shots/fgs-video-steps.json", JSON.stringify(steps, null, 1));
  console.log("video saved: shots/fgs-video.mp4");
  ws.close();
  process.exit(0);
})().catch((e) => { console.log(`(no video: ${e.stack || e})`); process.exit(0); });
