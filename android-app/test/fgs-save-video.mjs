// The video Google Play asks for in the foreground service declaration (FOREGROUND_SERVICE_DATA_SYNC): the real app on
// the phone simulator saving an offline map, started by hand from Layers, the "Saving offline map" notification, the
// app put away while the save keeps going, back in the app until it says Saved. Recorded with screenrecord into
// shots/fgs-save-video.mp4, with the time of each step in shots/fgs-save-video-steps.json (for captions). Run by
// test/phone-check.sh after the phone check; a failure here never fails the check.
import { execSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

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


// Slower downloads for the recording (about a phone on a fair mobile signal), so the save is still running when the
// app is put away. Chrome DevTools' own network throttling, on the app's web page only.
async function slowNet() {
  const id = ++seq;
  await new Promise((r) => { waiting.set(id, r); ws.send(JSON.stringify({ id, method: "Network.enable", params: {} })); });
  const id2 = ++seq;
  await new Promise((r) => { waiting.set(id2, r); ws.send(JSON.stringify({ id: id2, method: "Network.emulateNetworkConditions", params: { offline: false, latency: 60, downloadThroughput: 350000, uploadThroughput: 200000 } })); });
}
const state = () => js(`(() => { const s = document.querySelector(".offline-card [data-state]"); if (!s || s.hidden) return { kind: "", head: "" };
  return { kind: s.className, head: (s.querySelector("[data-st-head]") || {}).textContent || "" }; })()`);
const pct = async () => { const s = await state(); const m = /(\d+)%/.exec(s.head || ""); return m ? +m[1] : (/ok/.test(s.kind) ? 100 : 0); };

(async () => {
  sh("mkdir -p shots");
  try { adb("shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS"); } catch {}
  adb("shell settings put system show_touches 1");
  adb(`shell am force-stop ${APP}`);
  adb(`emu geo fix -122.957 50.116 680`);
  adb(`shell monkey -p ${APP} -c android.intent.category.LAUNCHER 1`);
  await sleep(15000);
  await connect();
  await js(`(() => { const b = [...document.querySelectorAll("button")].find((x) => /^\\s*I agree\\s*$/.test(x.textContent) && x.offsetParent); if (b) b.click(); })()`);
  await sleep(1500);
  await js(`document.querySelectorAll("dialog[open]").forEach((d) => d.close())`);
  // A new save asks for a free account first; the recording shows the save itself, so the sign-in step is skipped.
  await js(`(() => { if (window.tfAccount) window.tfAccount.require = () => Promise.resolve(true); })()`);
  // Whistler, around Lost Lake and the valley: a few thousand files, well under the limit.
  await js(`(() => { const m = window.tfLeaflet; if (m) m.setView([50.118, -122.955], 12, { animate: false }); })()`);
  await slowNet();
  try { adb("shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS"); } catch {}
  await sleep(4000);

  const rec = spawn("adb", ["shell", "screenrecord", "--size", "720x1600", "--bit-rate", "8000000", "--time-limit", "180", "/sdcard/fgs-save.mp4"], { stdio: "ignore" });
  const t0 = Date.now();
  const steps = [];
  const step = (text) => { steps.push({ t: (Date.now() - t0) / 1000, text }); console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${text}`); };
  await sleep(1500);

  step("The user opens Layers and taps Save this area offline");
  await sleep(1500);
  await tap("#layersBtn", "Layers");
  await sleep(1200);
  if (await js(`document.getElementById("layersMenu").hidden`)) { console.log("(Layers tap missed: clicking)"); await js(`document.getElementById("layersBtn").click()`); await sleep(800); }
  await tap("#lmOffline", "Save this area offline");
  await sleep(1500);
  if (await js(`document.querySelector(".offline-card").hidden`)) { console.log("(Offline tap missed: clicking)"); await js(`document.getElementById("lmOffline").click()`); }
  await sleep(2500);
  console.log("estimate: " + await js(`(document.querySelector(".offline-card [data-est]") || {}).textContent`));

  step("The user taps Save this area: the map starts saving");
  await tap(".offline-card [data-save]", "Save this area");
  await sleep(1500);
  if (!(await state()).head) { console.log("(Save tap missed: clicking)"); await js(`document.querySelector(".offline-card [data-save]").click()`); }
  for (let i = 0; i < 20 && (await pct()) < 3; i++) await sleep(1000);
  await sleep(2500);
  console.log(`saving: ${await pct()}%`);

  step("A notification shows the save's progress");
  adb("shell cmd statusbar expand-notifications");
  await sleep(5000);
  adb("shell cmd statusbar collapse");
  await sleep(800);

  step("The app is put away: the save keeps going in the foreground service");
  const away = await pct();
  adb("shell input keyevent KEYCODE_HOME");
  await sleep(6000);
  adb("shell cmd statusbar expand-notifications");
  await sleep(6000);
  adb("shell cmd statusbar collapse");
  await sleep(800);
  try { console.log("notification: " + (adb("shell dumpsys notification --noredact").match(/Saving offline map[^\n]*|android\.text=[^\n]*%[^\n]*/g) || []).slice(0, 3).join(" | ")); } catch {}

  step("Back in the app: the save kept going while it was away");
  adb(`shell monkey -p ${APP} -c android.intent.category.LAUNCHER 1`);
  await sleep(2000);
  const back = await pct();
  console.log(`progress: ${away}% when put away, ${back}% when back`);
  for (let i = 0; i < 150 && !/ok|bad/.test((await state()).kind); i++) await sleep(1000);
  const end = await state();
  console.log(`end state: ${end.kind} / ${end.head}`);

  step("Saved: the notification is gone");
  await sleep(2500);
  adb("shell cmd statusbar expand-notifications");
  await sleep(4000);
  adb("shell cmd statusbar collapse");
  await sleep(1500);
  step("end");

  try { adb("shell pkill -INT screenrecord"); } catch {}
  await new Promise((r) => { rec.on("exit", r); setTimeout(r, 8000); });
  await sleep(1500);
  adb("pull /sdcard/fgs-save.mp4 shots/fgs-save-video.mp4");
  writeFileSync("shots/fgs-save-video-steps.json", JSON.stringify({ steps, away, back, end }, null, 1));
  console.log("video saved: shots/fgs-save-video.mp4");
  ws.close();
  process.exit(0);
})().catch((e) => { console.log(`(no save video: ${e.stack || e})`); process.exit(0); });
