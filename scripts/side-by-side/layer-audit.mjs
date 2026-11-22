// Layer audit (alex 2026-11-22: "we lost a lot of things that we work on the web version already and it is not working
// on the phone version"): the website is the reference. For every sport and every switch in Layers, this turns the
// switch on in the page as the iPhone app (native 3D, under the page) and the Android app (alex's native 3D) open it,
// with a stand-in for the app (Capacitor + TrailMap, as scripts/phone-test.mjs "App builds"), and compares:
//   - what the flat map (= the website) gained: lines, dots, pins (markers), pictures (tile and image layers);
//   - what the page sent to the native 3D map: trails (lines, dots), and each native feature's own data (TrailMap.layer).
// A switch that adds something on the website but sends nothing new to native 3D is "missing in native 3D".
//   node scripts/side-by-side/layer-audit.mjs   -> out/layer-audit/{audit.json, audit.md}
// Needs Playwright (Chromium). Data files come from the live site.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, extname, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
const OUT = join(root, "out", "layer-audit");
mkdirSync(OUT, { recursive: true });
const LIVE = "https://trailfinderapp.ca/";
const SPORTS = (process.env.SPORTS || "mtb,ski,hike,fish,hunt,moto").split(",").map((s) => s.trim()).filter(Boolean);
const PLATFORMS = (process.env.PLATFORMS || "ios,android").split(",");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".pbf": "application/x-protobuf" };
const cache = new Map();
createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  let path = decodeURIComponent(u.pathname).replace(/^\/+/, "") || "index.html";
  const file = normalize(join(root, path)), rel = relative(root, file);
  const live = async () => {
    const k = path + u.search;
    if (!cache.has(k)) cache.set(k, fetch(LIVE + k).then(async (r) => ({ s: r.status, t: r.headers.get("content-type"), b: Buffer.from(await r.arrayBuffer()) })).catch(() => ({ s: 502, t: "text/plain", b: Buffer.from("") })));
    const r = await cache.get(k);
    res.writeHead(r.s, { "content-type": r.t || "application/octet-stream" }).end(r.b);
  };
  if (/^data\//.test(path)) return live();
  try {
    if (!file.startsWith(root) || /^(\.git|\.github|scripts|supabase|ios-app|android-app|out|node_modules)(\/|$)/.test(rel)) throw 0;
    let b = await readFile(file);
    if (path === "sw.js") b = Buffer.from("");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(b);
  } catch { return live(); }
}).listen(+(process.env.PORT || 8091), "127.0.0.1");

// The keys each app build reports (as phone-test.mjs reads them from the native sources).
async function iosKeys() {
  const dir = join(root, "ios-app/plugins/TrailMap/ios/Sources/TrailMap"), byClass = new Map();
  let list = "";
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".swift"))) {
    const t = await readFile(join(dir, f), "utf8");
    if (f === "NativeLayers.swift") list = ((t.match(/static let all[^=]*=\s*\[([\s\S]*?)\n\s*\]/) || [])[1] || "").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    const cls = [...t.matchAll(/\bclass (\w+)/g)];
    cls.forEach((c, i) => { const k = t.slice(c.index, i + 1 < cls.length ? cls[i + 1].index : t.length).match(/\blet key = "([^"]+)"/); if (k) byClass.set(c[1], k[1]); });
  }
  return [...new Set([...list.matchAll(/\{\s*(\w+)\((?:key:\s*"([^"]+)")?/g)].map((e) => e[2] || byClass.get(e[1])).filter(Boolean))];
}
async function androidKeys() {
  const dir = join(root, "android-app/plugins/TrailMap/android/src/main/java/com/allduf/trailmap"), keys = new Set();
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".java"))) {
    const t = await readFile(join(dir, f), "utf8");
    for (const m of t.matchAll(/String key\(\)\s*\{\s*return "([^"]+)";/g)) keys.add(m[1]);
    for (const m of t.matchAll(/new NativeOverlay\("([^"]+)"/g)) keys.add(m[1]);
  }
  return [...keys];
}

function standIn({ platform, keys, sport }) {
  try {
    localStorage.setItem("tf:sport", JSON.stringify(sport));
    localStorage.setItem("tf:welcomed", "true"); localStorage.setItem("tf:todayAuto", "false");
    localStorage.setItem("tf:appUpdateSeen", "99999:" + Date.now()); localStorage.setItem("tf-admin", "1");
    localStorage.setItem("tf:terms", JSON.stringify({ v: 99, t: Date.now() }));
  } catch {}
  const tm = (window.__tm = { opens: [], updates: [], layers: {}, on: {} });
  if (platform === "web") return;   // the website itself: the reference
  const ok = (v) => Promise.resolve(v);
  const TrailMap = {
    features: () => ok({ keys }),
    open: (o) => { tm.opens.push(o); for (const [k, v] of Object.entries(o.layers || {})) tm.layers[k] = v; if (o.lines) tm.updates.push({ lines: o.lines, dots: o.dots }); return ok(o.under && keys.includes("under") ? { under: true } : undefined); },
    update: (s) => { tm.updates.push(s); return ok(); },
    offline: () => ok({ areas: {} }),
    layer: (o) => { tm.layers[o.key] = o.data; return ok(); },
    close: () => ok(),
    addListener: (name, fn) => { (tm.on[name] = tm.on[name] || []).push(fn); return ok({ remove() {} }); },
  };
  const other = () => new Proxy({}, { get: (_, k) => (k === "then" ? undefined : () => ok(k === "addListener" ? { remove() {} } : {})) });
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: (n) => n === "TrailMap",
    registerPlugin: (n) => (n === "TrailMap" ? TrailMap : other()), Plugins: { TrailMap } };
}

// What the flat map shows around the view, by kind, and what native 3D was sent.
const INVENTORY = `(() => {
  const map = window.tfLeaflet, L = window.L, b = map.getBounds().pad(0.5);
  const out = { paths: 0, markers: 0, rasters: [], markerKinds: {} };
  const hidden = (l) => { const p = map.getPane((l.options && l.options.pane) || "overlayPane"); return p && getComputedStyle(p).display === "none"; };
  map.eachLayer((l) => {
    if (hidden(l)) return;
    if (l instanceof L.Path) { const bb = l.getBounds ? l.getBounds() : L.latLngBounds([l.getLatLng()]); if (bb.isValid() && b.intersects(bb)) out.paths++; return; }
    if (l instanceof L.Marker) { if (b.contains(l.getLatLng())) { out.markers++; const c = ((l.options.icon && l.options.icon.options.className) || "marker").split(" ")[0]; out.markerKinds[c] = (out.markerKinds[c] || 0) + 1; } return; }
    if (!(l instanceof L.LayerGroup) && !(l instanceof L.GridLayer) && !(l instanceof L.ImageOverlay) && l._map) { out.rasters.push("other:" + ((l.options && (l.options.className || l.options.pane)) || "layer")); return; }
    if (l instanceof L.GridLayer || l instanceof L.ImageOverlay) { if (l === window.tfBase || (l.options && /basemap|base/.test(l.options.className || ""))) return; out.rasters.push((l.options && (l.options.className || l.options.id)) || (l._url ? String(l._url).replace(/\\?.*/, "").slice(-60) : l.constructor.name || "grid")); }
  });
  const tm = window.__tm, u = tm.updates[tm.updates.length - 1] || {};
  const count = (s) => { try { return JSON.parse(s || "{}").features.length; } catch { return 0; } };
  const sig = {};
  for (const [k, v] of Object.entries(tm.layers)) sig[k] = v == null ? 0 : String(v).length;
  return { ...out, nLines: count(u.lines), nDots: count(u.dots), sig, native: !!(window.tfNative && window.tfNative.isOpen && window.tfNative.isOpen()), web3d: !!document.querySelector("#map.is3d") };
})()`;

// ---------- verdicts (written after each sport, so a stopped run keeps what it saw) ----------
function write() {
  const rows = [];
for (const r of report) {
  if (!r.before || !r.after) continue;
  const b = r.before, a = r.after;
  // "other:<pane>" are the canvas renderers the lines are drawn on (their lines are counted): not pictures.
  const web = { paths: a.paths - b.paths, markers: a.markers - b.markers, rasters: a.rasters.filter((x) => !b.rasters.includes(x) && !/^other:/.test(x)) };
  const sent = { lines: a.nLines - b.nLines, dots: a.nDots - b.nDots, feats: Object.keys(a.sig).filter((k) => a.sig[k] !== b.sig[k]) };
  const webGain = web.paths > 0 || web.markers > 0 || web.rasters.length > 0;
  const nativeGain = sent.lines > 0 || sent.dots > 0 || sent.feats.length > 0;
  let verdict = "same";
  if (webGain && !nativeGain) verdict = "MISSING in native 3D";
  else if (web.rasters.length && !sent.feats.length) verdict = "pictures missing in native 3D";
  else if (web.markers > 0 && !sent.feats.includes("pins") && !sent.feats.some((k) => k !== "pins") && sent.dots <= 0) verdict = "pins missing in native 3D";
  else if (!webGain && !nativeGain) verdict = "nothing here (both)";
  rows.push({ platform: r.platform, sport: r.sport, layer: r.layer, id: r.id, verdict, web, sent, errs: r.errs, web3d: a.web3d, native: a.native });
}
writeFileSync(join(OUT, `audit${process.env.PART || ""}.json`), JSON.stringify({ report, rows }, null, 1));
const md = ["# Layer audit: website vs native 3D", ""];
for (const p of PLATFORMS) for (const s of SPORTS) {
  md.push(`## ${p} · ${s}`, "", "| Layer | Verdict | Website gained | Sent to native 3D |", "|---|---|---|---|");
  for (const r of rows.filter((x) => x.platform === p && x.sport === s)) {
    md.push(`| ${r.layer} | ${r.verdict}${r.web3d ? " (web 3D open!)" : ""}${r.errs.length ? " · errors: " + r.errs.join("; ").slice(0, 120) : ""} | ${r.web.paths} lines, ${r.web.markers} pins${r.web.rasters.length ? ", pictures: " + r.web.rasters.join(", ") : ""} | ${r.sent.lines} lines, ${r.sent.dots} dots${r.sent.feats.length ? ", " + r.sent.feats.join(", ") : ""} |`);
  }
  md.push("");
}
writeFileSync(join(OUT, `audit${process.env.PART || ""}.md`), md.join("\n"));

}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];
const browser = await chromium.launch();
for (const platform of PLATFORMS) {
  const keys = platform === "ios" ? await iosKeys() : platform === "android" ? await androidKeys() : [];
  for (const sport of SPORTS) {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1, serviceWorkers: "block", geolocation: { latitude: 50.115, longitude: -122.95 }, permissions: ["geolocation"] });
    await ctx.addInitScript(standIn, { platform, keys, sport });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e.message).split("\n")[0]));
    await page.goto(`http://127.0.0.1:${process.env.PORT || 8091}/index.html`, { waitUntil: "load" }).catch(() => {});
    await sleep(6000);
    await page.evaluate(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); const at = { mtb: [50.105, -122.96, 14], ski: [50.08, -122.88, 13], hike: [50.105, -122.96, 13], fish: [50.12, -122.95, 13], hunt: [50.2, -122.9, 12], moto: [50.0, -123.1, 12] }[document.getElementById("sport").value] || [50.11, -122.95, 13]; window.tfLeaflet.setView([at[0], at[1]], at[2], { animate: false }); }).catch(() => {});
    await sleep(5000);
    // Into 3D as the 3D button does: native 3D on both (the iPhone: every build from 150; Android: alex's).
    await page.evaluate(() => { const ok = document.querySelector("#tfRisk [data-rk=ok]"); if (ok) ok.click(); }).catch(() => {});
    const opened = await page.evaluate(() => (window.tfNative && window.tfNative.view ? window.tfNative.view() : false)).catch(() => false);
    await sleep(3000);
    await page.evaluate(() => { const ok = document.querySelector("#tfRisk [data-rk=ok]"); if (ok) ok.click(); }).catch(() => {});
    if (!opened) await page.evaluate(() => window.tfNative && window.tfNative.view && window.tfNative.view()).catch(() => {});
    await sleep(2500);
    const toggles = await page.evaluate(() => {
      const lb = document.getElementById("layersBtn"); const m = document.getElementById("layersMenu");
      if (m.hidden) lb.click();
      // The map's own switches (buttons with ids) and each sport's own (checkboxes: data-k, data-layer).
      const btns = [...m.querySelectorAll("button[aria-pressed]")].filter((b) => b.getClientRects().length && !b.disabled && b.id)
        .map((b) => ({ id: b.id, sel: "#" + b.id, label: b.textContent.replace(/\s+/g, " ").trim().slice(0, 50), on: b.getAttribute("aria-pressed") === "true" }));
      const boxes = [...m.querySelectorAll("input[type=checkbox]")].filter((b) => !b.disabled && (b.dataset.k || b.dataset.layer)).map((b) => {
        const a = b.dataset.k ? "data-k" : "data-layer", v = b.getAttribute(a);
        return { id: a + "=" + v, sel: `#layersMenu input[${a}="${v}"]`, label: (b.getAttribute("aria-label") || (b.closest("label") || b).textContent).replace(/\s+/g, " ").trim().slice(0, 50), on: b.checked };
      });
      return [...btns, ...boxes];
    }).catch(() => []);
    const base0 = await page.evaluate(INVENTORY).catch((e) => ({ error: e.message }));
    console.log(`${platform} ${sport}: native ${base0.native} web3d ${base0.web3d}, ${toggles.length} switches`);
    report.push({ platform, sport, layer: "(as opened)", on: true, before: null, after: base0, errs: [...errs] });
    for (const t of toggles) {
      if (/^(native3dBtn|nativeMapBtn|tilt3dBtn|fullBtn|offlineBtn|boxBtn|photoBtn)$/.test(t.id)) continue;
      const e0 = errs.length;
      // Off first if it was on (measure it going on).
      if (t.on) { await page.evaluate((sel) => document.querySelector(sel).click(), t.sel).catch(() => {}); await sleep(1500); }
      await page.evaluate(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); const m = document.getElementById("layersMenu"); if (m.hidden) document.getElementById("layersBtn").click(); }).catch(() => {});
      const before = await page.evaluate(INVENTORY).catch(() => null);
      await page.evaluate((sel) => { const m = document.getElementById("layersMenu"); if (m.hidden) document.getElementById("layersBtn").click(); const e = document.querySelector(sel); if (e) e.click(); }, t.sel).catch(() => {});
      await sleep(4500);
      // Trails are sent after the map settles (native-map.js): a tiny move makes sure.
      await page.evaluate(() => { const m = window.tfLeaflet; m.panBy([1, 0], { animate: false }); }).catch(() => {});
      await sleep(1500);
      await page.evaluate(() => { const ok = document.querySelector("#tfRisk [data-rk=ok]"); if (ok) ok.click(); document.querySelectorAll("dialog[open]").forEach((d) => d.close()); }).catch(() => {});
      const after = await page.evaluate(INVENTORY).catch(() => null);
      report.push({ platform, sport, layer: t.label, id: t.id, on: !t.on, before, after, errs: errs.slice(e0) });
      // Back as it was.
      await page.evaluate(() => { const m = document.getElementById("layersMenu"); if (m.hidden) document.getElementById("layersBtn").click(); }).catch(() => {});
      await page.evaluate((sel) => { const m = document.getElementById("layersMenu"); if (m.hidden) document.getElementById("layersBtn").click(); const e = document.querySelector(sel); if (e) e.click(); }, t.sel).catch(() => {});
      if (t.on) { await sleep(800); await page.evaluate((sel) => { const m = document.getElementById("layersMenu"); if (m.hidden) document.getElementById("layersBtn").click(); const e = document.querySelector(sel); if (e) e.click(); }, t.sel).catch(() => {}); }
      await sleep(1200);
    }
    await ctx.close();
    write();
  }
}
await browser.close();

process.exit(0);
