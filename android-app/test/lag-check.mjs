// 3D lag on an Android phone simulator (android-app.yml, "Run workflow" with lag ticked): the testers' web 3D map and
// alex's native 3D map, the same place and the same finger moves, in a few sports. Coordinator ask 2026-11-27: is
// native 3D smooth enough for every Android tester? The simulator draws in software (no graphics card), so its numbers
// are far slower than a phone's: compare web with native, and runs with each other, never with a real phone.
// For each sport (LAG_SPORTS, default ski,mtb,hike,fish,hunt,moto: Moto last, its web 3D is the heaviest), each way (web, native):
//   - opens the app at Whistler, picks the sport, taps 3D like a finger (native 3D opens only for a real tap);
//   - starts from a fresh app each time (one that stopped answering never spoils the next run);
//   - waits for the map to settle, then 8 one-finger drags (pan) back to back;
//   - frames: how often the screen showed a new picture while the fingers moved (SurfaceFlinger's frame statistics for
//     the layer that draws the map: the native map's own surface, or the app's window for the web 3D map), and for the
//     web 3D map also the page's own frame gaps (requestAnimationFrame) and long tasks; for native, how often the map
//     said it moved (proof the fingers reached it);
//   - whether Android said the app stopped answering ("isn't responding") during the run;
//   - memory: the app's total (dumpsys meminfo) after the moves.
// Writes shots/lag.md and shots/lag.json (and a screenshot per sport and way). Never fails the job.
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const APP = "com.allduf.trailfinder";
const SPORTS = (process.env.LAG_SPORTS || "ski,mtb,hike,fish,hunt,moto").split(",").map((s) => s.trim()).filter(Boolean);
const NAMES = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", fish: "Fishing", moto: "Adventure moto", hike: "Hiking" };
const sh = (c, t = 60000) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20, timeout: t });
const adb = (c, t) => sh(`adb ${c}`, t);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync("shots", { recursive: true });

// ---------- the page, through Chrome's DevTools (as deep-check.mjs) ----------
let ws, seq = 0;
const waiting = new Map();
async function connect() {
  if (ws) try { ws.close(); } catch {}
  let p = null;
  for (let i = 0; i < 30 && !p; i++) {
    try {
      const sock = (adb("shell cat /proc/net/unix").match(/@(webview_devtools_remote_\d+)/) || [])[1];
      if (sock) {
        try { adb("forward --remove tcp:9222"); } catch {}
        adb(`forward tcp:9222 localabstract:${sock}`);
        const list = await (await fetch("http://127.0.0.1:9222/json")).json();
        p = list.find((x) => x.type === "page" && /10\.0\.2\.2/.test(x.url)) || null;
      }
    } catch {}
    if (!p) await sleep(2000);
  }
  if (!p) throw new Error("the app's web page never showed up");
  ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  ws.onclose = () => { for (const [, f] of waiting) f({ result: { exceptionDetails: { text: "page connection closed" } } }); waiting.clear(); };
}
function cdp(method, params = {}) {
  const id = ++seq;
  return new Promise((r, j) => {
    const t = setTimeout(() => { waiting.delete(id); j(new Error(`the page didn't answer in 90 s (${method})`)); }, 90000);
    waiting.set(id, (d) => { clearTimeout(t); r(d); });
    try { ws.send(JSON.stringify({ id, method, params })); } catch (e) { clearTimeout(t); waiting.delete(id); j(e); }
  });
}
async function js(expr) {
  const res = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.result && res.result.exceptionDetails) throw new Error(String(res.result.exceptionDetails.exception && res.result.exceptionDetails.exception.description || res.result.exceptionDetails.text).split("\n")[0]);
  return res.result && res.result.result && res.result.result.value;
}
const shot = (f) => { try { execSync(`adb exec-out screencap -p > shots/${f}`, { shell: "/bin/bash", timeout: 20000 }); } catch {} };
const nativeShows = () => { try { return /maplibre[\w.]*MapView|TrailMapScreen/.test(adb("shell dumpsys activity top")); } catch { return false; } };

// A real finger tap on an element: where the web view's top is on the screen, measured once with a see-through cover.
let topPx = null;
async function fingerTap(sel) {
  const r = await js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, dpr: devicePixelRatio, ih: innerHeight }; })()`);
  if (!r) return false;
  if (topPx == null) {
    topPx = 0;
    try {
      await js(`(() => { window.__tapY = null; const d = document.createElement("div"); d.id = "__probe"; d.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:transparent";
        d.addEventListener("touchstart", (e) => { window.__tapY = e.touches[0].clientY; e.preventDefault(); e.stopPropagation(); }, { passive: false });
        d.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); }); document.body.append(d); })()`);
      const y = Math.round(r.ih * r.dpr * 0.45);
      adb(`shell input tap 20 ${y}`);
      await sleep(800);
      const cy = await js("window.__tapY");
      await js(`document.getElementById("__probe")?.remove()`);
      if (cy != null) topPx = Math.round(y - cy * r.dpr);
    } catch {}
  }
  adb(`shell input tap ${Math.round(r.x * r.dpr)} ${Math.round(r.y * r.dpr + topPx)}`);
  return true;
}
const agree = () => js(`(() => { const b = document.querySelector("#tfRisk [data-rk=ok], #tfRisk .rk-ok"); if (b && b.offsetParent) { b.click(); return true; } return false; })()`).catch(() => false);

// ---------- frames from SurfaceFlinger ----------
// SurfaceFlinger's frame statistics (--timestats): for every layer, how many pictures it showed and the time between
// one shown picture and the next (present2present, a histogram in ms). --latency gave nothing for the native map's
// SurfaceView on Android 14, so both ways read this. The native map is the app's SurfaceView layer; web 3D is the
// app's window (MainActivity, not a SurfaceView).
const sf = (a) => adb(`shell dumpsys SurfaceFlinger --timestats ${a}`);
function frameGaps(native) {
  let dump = "";
  try { dump = sf("-dump"); } catch { return { gaps: [], layers: [] }; }
  const gaps = [], layers = [];
  for (const blk of dump.split(/\n(?=layerName\s*=)/)) {
    const name = (blk.match(/^layerName\s*=\s*(.+)$/m) || [])[1];
    if (!name || !name.includes(APP) || /Background|Splash/.test(name)) continue;
    if (native ? !/SurfaceView/.test(name) : /SurfaceView/.test(name) || !/MainActivity/.test(name)) continue;
    const h = (blk.match(/present2present histogram[^\n]*\n([^\n]+)/) || [])[1] || "";
    let n = 0;
    for (const [, ms, c] of h.matchAll(/(\d+)ms=(\d+)/g)) for (let i = 0; i < +c && i < 5000; i++) { gaps.push(+ms); n++; }
    layers.push(`${name.trim()} (${n})`);
  }
  return { gaps, layers, dump };
}
const stats = (gaps) => {
  const g = gaps.filter((x) => x > 0).sort((a, b) => a - b);
  if (!g.length) return null;
  const q = (p) => Math.round(g[Math.min(g.length - 1, Math.floor(p * g.length))]);
  return { frames: g.length, median: q(0.5), p95: q(0.95), worst: Math.round(g[g.length - 1]), over100: g.filter((x) => x > 100).length, over250: g.filter((x) => x > 250).length };
};

const report = [];
// How many times Android has said the app stopped answering ("isn't responding") since the simulator started.
const anrs = () => { try { return (adb("logcat -d -s ActivityManager:E").match(/ANR in com\.allduf\.trailfinder/g) || []).length; } catch { return 0; } };
// A fresh app for every run: one that stopped answering (web 3D on a busy simulator can) never spoils the next run.
async function freshApp(sport, native) {
  try { adb(`shell am force-stop ${APP}`); } catch {}
  try { adb("shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS"); } catch {}
  await sleep(8000);   // let the simulator calm down
  try { adb(`shell am start -W -n ${APP}/.MainActivity`, 90000); } catch {}
  await sleep(15000);
  await connect();
  await js(`(() => { ${native ? `localStorage.setItem("tf-admin", "1")` : `localStorage.removeItem("tf-admin")`}; localStorage.setItem("tf:sport", JSON.stringify(${JSON.stringify(sport)}));
    localStorage.setItem("tf:todayAuto", "false"); localStorage.setItem("tfLagCheck", "1"); location.reload(); })()`).catch(() => {});
  await sleep(12000);
  await connect();
}
async function run(sport, native) {
  const way = native ? "native" : "web";
  const r = { sport, way }, anrBefore = anrs();
  console.log(`--- ${NAMES[sport]}, ${native ? "native 3D (alex)" : "web 3D (testers)"}`);
  try {
    try { await freshApp(sport, native); } catch { await freshApp(sport, native); }   // one more try
    await js(`(() => { const b = document.querySelector("dialog.tf-terms [data-terms=ok]"); if (b) b.click(); document.querySelectorAll("dialog[open]").forEach((d) => d.close()); })()`).catch(() => {});
    await js(`window.tfLeaflet && window.tfLeaflet.setView([50.09, -122.95], 13)`).catch(() => {});
    await sleep(4000);
    // Into 3D (Skiing opens on 3D already, and alex's one map can show seen from above: the button says 3D then).
    const in3d = () => js(`({ web: !!document.querySelector("#map.is3d") && !!(window.tf3dGl && window.tf3dGl()), native: !!(window.tfNative && window.tfNative.isOpen && window.tfNative.isOpen()), b: (document.getElementById("btn3d") || {}).textContent || "" })`).catch(() => ({}));
    let s = await in3d();
    const up = () => (native ? s.native && /2D/.test(s.b) : s.web);
    for (let i = 0; i < 3 && !up(); i++) {
      if (!(await fingerTap("#btn3d"))) break;
      await sleep(2500);
      if (await agree()) await sleep(1500);
      s = await in3d();
      if (!up() && i < 2) { await sleep(4000); s = await in3d(); }
    }
    r.opened = native ? (s.native ? (/2D/.test(s.b) ? "native 3D" : "native, seen from above") : s.web ? "web 3D (not native)" : "nothing") : s.web ? "web 3D" : s.native ? "native (not web)" : "nothing";
    console.log(`    opened: ${r.opened}`);
    if (native && !s.native) throw new Error("native 3D didn't open");
    if (!native && !s.web) throw new Error("web 3D didn't open");
    await sleep(25000);   // the ground and photos come in
    if (!native) await js(`(() => { const s = (window.__lag = { gaps: [], lt: 0, on: true }); let last = performance.now();
      const loop = (t) => { if (!s.on) return; s.gaps.push(t - last); last = t; requestAnimationFrame(loop); }; requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) s.lt += e.duration; }).observe({ type: "longtask" }); } catch {} })()`);
    // The native map tells the page each time it moved: proof the fingers reached it.
    else await js(`(() => { window.__moves = 0; const T = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.TrailMap; if (T) T.addListener("moved", () => window.__moves++); })()`).catch(() => {});
    try { sf("-disable"); sf("-clear"); sf("-enable"); } catch {}
    // 8 drags back to back, 1 s each: the map keeps moving the whole time, so every gap is a moving frame.
    const W = 1080, H = 2400;
    for (let k = 0; k < 8; k++) {
      const dx = (k % 2 ? -1 : 1) * 350, dy = (k % 4 < 2 ? 1 : -1) * 220;
      adb(`shell input swipe ${W / 2 - dx / 2} ${H * 0.42 - dy / 2} ${W / 2 + dx / 2} ${H * 0.42 + dy / 2} 1000`, 30000);
    }
    await sleep(1500);
    const fg = frameGaps(native);
    try { sf("-disable"); } catch {}
    r.layers = fg.layers;
    r.screen = stats(fg.gaps.filter((g) => g < 1500));
    if (!r.screen && fg.dump) writeFileSync(`shots/lag-${sport}-${way}-timestats.txt`, fg.dump.slice(0, 200000));
    if (!native) {
      const p = await js(`(() => { const s = window.__lag; s.on = false; return { gaps: s.gaps.slice(2), lt: Math.round(s.lt) }; })()`).catch(() => null);
      if (p) { r.page = stats(p.gaps.filter((g) => g < 1500)); r.longTaskMs = p.lt; }
      r.readout = await js(`(() => { const d = [...document.querySelectorAll("div")].find((e) => /^lag check/.test(e.textContent || "")); return d ? d.textContent : null; })()`).catch(() => null);
    } else r.moves = await js("window.__moves").catch(() => null);
    try { const m = adb(`shell dumpsys meminfo ${APP}`).match(/TOTAL PSS:\s*(\d+)|TOTAL\s+(\d+)/); r.memMB = m ? Math.round(+(m[1] || m[2]) / 1024) : null; } catch {}
    shot(`lag-${sport}-${way}.png`);
    r.native = nativeShows();
  } catch (e) { r.error = String(e.message || e).split("\n")[0].slice(0, 200); shot(`lag-${sport}-${way}-error.png`); }
  r.anr = anrs() > anrBefore;
  console.log("    " + JSON.stringify(r));
  report.push(r);
}

(async () => {
  await connect();
  const info = await js(`({ dpr: devicePixelRatio, w: innerWidth, h: innerHeight })`).catch(() => ({}));
  let cpu = ""; try { cpu = adb("shell nproc").trim() + " cores, " + Math.round(+adb("shell cat /proc/meminfo").match(/MemTotal:\s*(\d+)/)[1] / 1048576) + " GB"; } catch {}
  for (const sport of SPORTS) for (const native of [false, true]) await run(sport, native);
  writeFileSync("shots/lag.json", JSON.stringify({ info, cpu, report }, null, 1));
  const f = (s) => (s ? `${s.frames} frames · median ${s.median} ms · 95% under ${s.p95} ms · worst ${s.worst} ms · ${s.over100} over 100 ms` : "-");
  const md = [`## 3D lag on an Android simulator (${cpu}; page ${info.w}x${info.h} at ${info.dpr}x)`, "",
    "Software drawing (no graphics card): compare web with native, not with a phone.", "",
    "| Sport | Way | Opened | Screen frames while moving | Page frames (web) | Page work | Memory | Not responding |", "|---|---|---|---|---|---|---|---|",
    ...report.map((r) => `| ${NAMES[r.sport]} | ${r.way} | ${r.error ? "✗ " + r.error : r.opened + (r.moves != null ? ` (moved ${r.moves}x)` : "")} | ${f(r.screen)} | ${f(r.page)} | ${r.longTaskMs != null ? r.longTaskMs + " ms" : "-"} | ${r.memMB != null ? r.memMB + " MB" : "-"} | ${r.anr ? "yes" : "no"} |`)];
  writeFileSync("shots/lag.md", md.join("\n") + "\n");
  console.log(md.join("\n"));
  try { writeFileSync(process.env.GITHUB_STEP_SUMMARY || "/dev/null", md.join("\n") + "\n", { flag: "a" }); } catch {}
  try { ws.close(); } catch {}
  process.exit(0);
})().catch((e) => { console.log("lag check stopped: " + e.message); process.exit(0); });
