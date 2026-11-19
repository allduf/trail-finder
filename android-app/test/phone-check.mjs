// The Android app on a phone simulator (android-app.yml, pull requests): opens the test build, which loads this
// pull request's own website from the runner (http://10.0.2.2:8080), and checks the app's own parts work:
// the plugins are there, native.js ran, a ride records (also with the app in the background, where the notification
// keeps it going), the ride shows in the notification, Back puts the app away without closing it.
// Run by test/phone-check.sh with the simulator up and the app open. Talks to the page through Chrome's DevTools.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const APP = "com.allduf.trailfinder";
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const adb = (c) => sh(`adb ${c}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (good, what, more = "") => { console.log(`${good ? "✓" : "✗"} ${what}${more ? `: ${more}` : ""}`); if (!good) failed++; };

function shot(name) {
  try {
    execSync(`adb exec-out screencap -p > shots/${name}.png`, { shell: "/bin/bash" });
    // A small copy in the log too, so it can be looked at without downloading the artifact.
    const b64 = sh(`convert shots/${name}.png -resize 300x -quality 55 jpg:- | base64 -w0`);
    console.log(`SHOT ${name} ${b64}`);
  } catch (e) { console.log(`(no screenshot ${name}: ${e.message})`); }
}

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
  console.log(`page: ${p.url}`);
  ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
}
async function js(expr) {
  const id = ++seq;
  const res = await new Promise((r) => { waiting.set(id, r); ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } })); });
  if (res.result && res.result.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails.exception && res.result.exceptionDetails.exception.description || res.result.exceptionDetails.text));
  return res.result && res.result.result && res.result.result.value;
}
const native = (method, args = {}) => js(`Capacitor.nativePromise("TrailGps", ${JSON.stringify(method)}, ${JSON.stringify(args)}).then((r) => r || {})`);

// Move the simulator's GPS along a line near Whistler (geo fix takes lon lat alt).
async function ride(n, from) {
  for (let i = 0; i < n; i++) {
    adb(`emu geo fix ${(-122.95 + (from + i) * 0.0003).toFixed(5)} ${(50.11 + (from + i) * 0.0002).toFixed(5)} ${700 + (from + i) * 3}`);
    await sleep(1500);
  }
}

const front = () => /mResumedActivity|topResumedActivity/.test(adb("shell dumpsys activity activities")) &&
  (adb("shell dumpsys activity activities").match(/(?:mResumedActivity|topResumedActivity)[^\n]*/) || [""])[0].includes(APP);

(async () => {
  sh("mkdir -p shots");
  await connect();
  await sleep(4000);
  shot("1-first-open");

  const info = await js(`(() => { const C = window.Capacitor; return { platform: C && C.getPlatform(), native: C && C.isNativePlatform(),
    plugins: (C.PluginHeaders || []).map((h) => h.name), gps: ((C.PluginHeaders || []).find((h) => h.name === "TrailGps") || { methods: [] }).methods.map((m) => m.name),
    inApp: document.documentElement.classList.contains("in-app"), tfGps: !!(window.tfGps && tfGps.native), haptic: typeof window.tfHaptic,
    share: String(navigator.share).includes("Share.share"), safeTop: getComputedStyle(document.documentElement).getPropertyValue("--safe-area-inset-top") }; })()`);
  console.log(JSON.stringify(info));
  ok(info.platform === "android" && info.native, "Capacitor sees the Android app");
  for (const p of ["TrailGps", "App", "Device", "Haptics", "Share", "KeepAwake", "SplashScreen", "SystemBars"]) ok(info.plugins.includes(p), `plugin ${p}`);
  ok(["start", "stop", "fixes", "speak", "cues", "live", "activity", "turns"].every((m) => info.gps.includes(m)), "TrailGps has every iPhone call", info.gps.join(", "));
  ok(info.inApp, "native.js ran (html.in-app)");
  ok(info.tfGps, "rides record with the app's own GPS (tfGps.native)");
  ok(info.haptic === "function" && info.share, "vibrations and share sheet hooked up");

  // Record a ride
  const st = await native("start");
  ok(st.running === true, "ride recording starts");
  await native("activity", { action: "start", sport: "mtb", title: "Riding", start: Date.now(), km: 0, climb: 0, line: "Test trail" });
  await ride(6, 0);
  let f = await native("fixes", { after: 0 });
  ok((f.fixes || []).length >= 3, "the GPS keeps the ride's fixes", `${(f.fixes || []).length} fixes`);
  await native("activity", { action: "update", km: 1.2, climb: 45, line: "Test trail" });
  await sleep(800);
  const notes = adb("shell dumpsys notification --noredact");
  ok(/1\.2 km · 45 m climb/.test(notes), "the ride shows in the notification (km and climb)");
  shot("2-recording");
  try { adb("shell cmd statusbar expand-notifications"); await sleep(1500); shot("3-notification"); adb("shell cmd statusbar collapse"); } catch {}

  // Background: Home button, keep moving, come back
  const before = (f.fixes || []).length;
  adb("shell input keyevent KEYCODE_HOME");
  await sleep(1500);
  const svc = adb(`shell dumpsys activity services ${APP}`);
  ok(/RideService/.test(svc) && /isForeground=true/.test(svc), "with the app away, the ride keeps going (foreground service)");
  await ride(6, 6);
  adb(`shell monkey -p ${APP} -c android.intent.category.LAUNCHER 1`);
  await sleep(2500);
  f = await native("fixes", { after: 0 });
  ok((f.fixes || []).length >= before + 3, "fixes kept while the app was away", `${before} -> ${(f.fixes || []).length}`);

  // Speaking, turns, live location off
  ok(await native("speak", { text: "In 200 metres, turn left onto Test trail" }).then(() => true, () => false), "speaks directions");
  const tn = await native("turns", { list: [[50.112, -122.948, 300, "Turn left onto Test trail", "left"]], total: 1000, mps: 4, asleep: true });
  ok(tn.count === 1, "takes the turns for the screen-off directions");
  const lv = await native("live", { grp: "" });
  ok(lv.live === false, "live location off answers");

  // Stop
  await native("stop");
  await sleep(1500);
  f = await native("fixes", { after: 0 });
  ok((f.fixes || []).length === 0 && !/RideService/.test(adb(`shell dumpsys activity services ${APP}`).replace(/No services/, "")), "stopping ends the ride and its notification");

  // Back button: a menu open closes first; with nothing open it puts the app away (still running)
  await js(`document.querySelectorAll("dialog[open]").forEach((d) => d.close())`);
  await js(`(() => { const b = document.getElementById("layersBtn"); if (b) b.click(); })()`);
  await sleep(800);
  const menuOpen = await js(`(() => { const m = document.getElementById("layersMenu"); return !!m && !m.hidden; })()`);
  if (menuOpen) {
    adb("shell input keyevent KEYCODE_BACK");
    await sleep(1000);
    ok(await js(`document.getElementById("layersMenu").hidden`), "Back closes an open menu");
    ok(front(), "…and the app stays open");
  }
  shot("4-after-back");
  adb("shell input keyevent KEYCODE_BACK");
  await sleep(1500);
  const pid = adb(`shell pidof ${APP}`).trim();
  ok(!front() && !!pid, "Back on the map puts the app away without closing it");

  writeFileSync("shots/result.txt", failed ? `${failed} failed` : "all passed");
  console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
  ws.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`✗ ${e.stack || e}`); shot("error"); process.exit(1); });
