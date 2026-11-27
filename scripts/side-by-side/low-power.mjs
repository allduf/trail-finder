// Low power 3D test (alex 2026-11-27: "How can we make sure that things like yesterday never happen again?"). On
// 2026-11-26 alex's iPhone showed the page's buttons over a black native 3D map in every sport: Low Power Mode was on and
// MapLibre drew nothing. The app now asks for 30 frames a second in Low Power Mode, and when a native map has drawn no
// frame 8 s after opening, the page goes back to its own flat map with a note naming Low Power Mode / Battery Saver
// (PR #956). Run by .github/workflows/low-power.yml through run.mjs (WALK=lowpower), on the iPhone simulator and an
// Android simulator, in every sport, twice:
//   1. power saving on: native 3D opens and draws (not black), and the page doesn't fall back by itself;
//   2. the map draws nothing (the test build's stand-in: black over the map, no frame counted): the screen is black at
//      first, then within 15 s the page's own flat map is back (not black), with the note, never the web 3D map.
// Power saving: Android's real Battery Saver (adb). The iPhone simulator has no Low Power Mode: its app is started with
// TF_TEST_LOW_POWER=1, which takes the app's own Low Power Mode path (30 frames a second, the note's wording), but iOS's
// own slowdown of the phone in Low Power Mode is not there. Fails (exit 1) on any problem.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

// ---------- black or not: the middle of a screenshot ----------
// A PNG from simctl / adb (8 bits, RGB or RGBA, not interlaced).
export function readPng(file) {
  const b = readFileSync(file);
  if (b.toString("latin1", 1, 4) !== "PNG") throw new Error("not a PNG");
  let o = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  while (o < b.length) {
    const len = b.readUInt32BE(o), type = b.toString("latin1", o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; if (d[12]) throw new Error("interlaced PNG"); }
    else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  if (bd !== 8 || (ct !== 2 && ct !== 6)) throw new Error(`PNG colour type ${ct}, ${bd} bits: not read`);
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[dst + x - bpp] : 0, up = y ? px[dst - stride + x] : 0, c = x >= bpp && y ? px[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[dst + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
// The middle of the screen (the page's own buttons sit at the top, bottom and sides): its brightness and how much it
// varies. Black = dark and even (a map, even a dark forest on Satellite, varies; the sky or a blank page is bright).
export function middle(file) {
  const { w, h, bpp, px } = readPng(file);
  let n = 0, s = 0, s2 = 0;
  for (let y = Math.floor(h * 0.3); y < h * 0.7; y += 4) {
    for (let x = Math.floor(w * 0.15); x < w * 0.85; x += 4) {
      const i = (y * w + x) * bpp, l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      n++; s += l; s2 += l * l;
    }
  }
  const mean = s / n, sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
  return { mean: Math.round(mean), sd: Math.round(sd), black: mean < 35 && sd < 12 };
}

// ---------- the walk ----------
export async function lowPowerWalk(h) {
  const { PLATFORM, SPORTS, NAMES, OUT, js, jsq, phone, pageUp, click, tap, agree, closeAll, closeNative, sleep, tryp, setSport } = h;
  const ios = PLATFORM === "ios";
  const results = [];
  const NOTE = ios ? /Low Power Mode/ : /Battery Saver/;
  // What the page shows: native map (3D, or the one map under the page), the web 3D map, the notes shown since the sport.
  const STATE = `({ native: !!(window.tfNative && window.tfNative.isOpen && window.tfNative.isOpen()) || document.documentElement.classList.contains("tf-under"),
    web3d: !!document.querySelector("#map.is3d, .is3d"), toasts: window.__toasts || [] })`;
  // Every note the page shows, kept (a note goes away after a few seconds).
  const RECORD = `(() => { if (!window.tfToast || window.tfToast.__rec) return; const t = window.tfToast; window.__toasts = [];
    const r = function (m, ...a) { window.__toasts.push(String(m)); return t.call(this, m, ...a); }; r.__rec = true; window.tfToast = r; })()`;
  const shot = (name) => {
    const f = join(OUT, "shots", `lowpower-${name}.png`);
    phone.shot(f);
    try { return { file: f, ...middle(f) }; } catch (e) { return { file: f, error: String(e.message || e) }; }
  };
  const record = (run, sp, problems, extra) => {
    results.push({ run: run.name, sport: NAMES[sp] || sp, ok: !problems.length, problems, ...extra });
    console.log(`${problems.length ? "✗" : "✓"} ${run.name} › ${NAMES[sp] || sp}${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
    try { writeFileSync(join(OUT, "low-power.json"), JSON.stringify({ platform: PLATFORM, results }, null, 1)); } catch {}
  };

  // Android: the phone's real Battery Saver, as a tester would have it (on battery, Battery Saver on).
  if (!ios) {
    tryp("adb shell dumpsys battery unplug");
    tryp("adb shell settings put global low_power 1");
    tryp("adb shell cmd power set-mode 1");
    await sleep(2000);
    const on = tryp("adb shell settings get global low_power").trim();
    console.log(`Battery Saver: ${on === "1" ? "on" : `not on (${on || "no answer"})`}`);
    if (on !== "1") results.push({ run: "setup", sport: "-", ok: false, problems: ["Battery Saver didn't turn on in the simulator"] });
  }

  const runs = [
    { id: "power", name: ios ? "Low Power Mode (simulator stand-in)" : "Battery Saver on", noDraw: false },
    { id: "nodraw", name: "Map draws nothing", noDraw: true },
  ];
  try {
    for (const run of runs) {
      phone.test = { lowPower: ios, noDraw: run.noDraw };
      phone.kill(); await sleep(2000); phone.launch();
      for (let i = 0; i < 3 && !(await pageUp(i ? 60000 : 120000)); i++) { phone.kill(); await sleep(2000); phone.launch(); }
      await jsq(`(() => { localStorage.setItem("tf-admin", "1"); localStorage.setItem("tf:welcomed", "true"); localStorage.setItem("tf:todayAuto", "false"); localStorage.setItem("tf:lang", "en"); })()`);
      await jsq(`(() => { const b = document.querySelector("dialog.tf-terms [data-terms=ok]"); if (b) b.click(); })()`);
      await closeAll("start");
      for (const sp of SPORTS) {
        setSport(sp);
        const problems = [];
        let a = {}, b = {};
        try {
          if (await jsq(`window.tfNative && window.tfNative.isOpen && window.tfNative.isOpen()`, false)) { await closeNative(); await sleep(2000); }
          const r = await click("#sportMapBtn"); if (r) throw new Error(r);
          await sleep(700);
          const r2 = await click(`#sportMenu [data-sport=${sp}]`); if (r2) throw new Error(r2);
          await sleep(sp === "ski" ? 9000 : 6000);
          await closeAll("after sport");
          await jsq(RECORD);
          await jsq(`window.__toasts = []`);
          // 3D (the one map seen from above, where there is one, tips up; otherwise native 3D opens).
          const tt = await tap("#btn3d"); if (tt) throw new Error(tt);
          await sleep(2500);
          if (await agree()) { await sleep(1500); const s = await jsq(STATE, {}); if (!s.native && !s.web3d) await tap("#btn3d"); }
          const t0 = Date.now();
          await sleep(3500);
          a = shot(`${run.id}-${sp}-1-open`);
          const sa = await jsq(STATE, {});
          if (a.error) problems.push(`screenshot not read: ${a.error}`);
          if (sa.web3d) problems.push("the web 3D map opened");
          if (run.noDraw) {
            // The stand-in must black out the map, or this run shows nothing (the fallback may already be done on the one
            // map opened with the sport: then the page's own map shows, which is fine).
            if (sa.native && !a.error && !a.black) problems.push(`the test's stand-in didn't black out the map (middle brightness ${a.mean}, spread ${a.sd})`);
          } else {
            if (!sa.native) problems.push("native 3D didn't open");
            if (!a.error && a.black) problems.push(`the map is black (middle brightness ${a.mean}, spread ${a.sd})`);
          }
          // Until 15 s after the tap: the fallback comes 8 s after the native map opened.
          while (Date.now() - t0 < 15000) await sleep(1000);
          b = shot(`${run.id}-${sp}-2-after-15s`);
          const sb = await jsq(STATE, {});
          const crash = phone.crashed();
          if (crash) problems.push(crash);
          if (b.error) problems.push(`screenshot not read: ${b.error}`);
          if (sb.web3d) problems.push("the web 3D map opened");
          if (!b.error && b.black) problems.push(`the screen is black 15 s after 3D (middle brightness ${b.mean}, spread ${b.sd})`);
          const notes = (sb.toasts || []).join(" | ");
          if (run.noDraw) {
            if (sb.native) problems.push("the native map that draws nothing is still up 15 s later (no fallback to the flat map)");
            if (!NOTE.test(notes)) problems.push(`no note naming ${ios ? "Low Power Mode" : "Battery Saver"} (notes: ${notes || "none"})`);
          } else {
            if (!sb.native) problems.push(`native 3D closed by itself${notes ? ` (notes: ${notes})` : ""}`);
            if (/couldn't draw|may not draw/.test(notes)) problems.push(`the "map couldn't draw" note showed on a map that draws (${notes})`);
          }
        } catch (e) { problems.push(String(e.message || e).split("\n")[0].slice(0, 200)); }
        record(run, sp, problems, { open: a, after: b });
        if (await jsq(`window.tfNative && window.tfNative.isOpen && window.tfNative.isOpen()`, false)) await closeNative();
        if (await jsq(`!!document.querySelector("#map.is3d")`, false)) await click("#btn3d");
        await sleep(2000);
        await closeAll("after 3d");
      }
    }
  } catch (e) {
    results.push({ run: "walk", sport: "-", ok: false, problems: ["stopped: " + String(e.message || e).slice(0, 200)] });
  } finally {
    phone.test = {};
    if (!ios) { tryp("adb shell settings put global low_power 0"); tryp("adb shell dumpsys battery reset"); }
  }

  const bad = results.filter((r) => !r.ok);
  const md = `## Low power 3D, ${ios ? "iPhone" : "Android"}: ${bad.length ? `${bad.length} problem(s)` : "all good"} in ${results.length} checks\n\n`
    + results.map((r) => `- ${r.ok ? "✓" : "✗"} ${r.run} › ${r.sport}${r.ok ? "" : ": " + r.problems.join(" · ")}`).join("\n")
    + `\n\n${ios ? "The iPhone simulator has no Low Power Mode: the app took its own Low Power Mode path (30 frames a second, the note's wording) through a simulator-only switch; iOS's own slowdown of the phone is not simulated." : "Android's real Battery Saver was on for both runs."} "Map draws nothing" is the test build's stand-in (black over the map, no frame counted).\n`;
  try { writeFileSync(join(OUT, "low-power.json"), JSON.stringify({ platform: PLATFORM, results }, null, 1)); writeFileSync(join(OUT, "summary-lowpower.md"), md); } catch {}
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
  return bad.length > 0;
}
