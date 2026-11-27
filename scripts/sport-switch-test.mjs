// Sport switch test (alex 2026-11-22: "test every sport to switch to other sport to see every mode"): at iPhone size,
// every sport is switched to every other sport (all 30 pairs, in one walk that takes each pair once), on the flat map
// and on the 3D map. After each switch the page must look the way it does when the app is opened in that sport: the
// same map style, the same layers and pins on the map (flat and 3D), the same panels and buttons, and nothing from the
// sport before (Skiing's Winter, its pins, the old sport's panel...). Then each map style picked in a sport is switched
// to every other sport: Skiing always gets Winter, Adventure moto its own style, the others the style picked last in
// them (Map for MTB, Satellite for Hiking, Fishing and Hunting at first).
//
// The page is served from this checkout, like the phone test (scripts/phone-test.mjs), with the same cut-off outside.
// Run: node scripts/sport-switch-test.mjs   (needs the playwright package and its WebKit, or BROWSER=chromium)
// Optional: BROWSER (webkit), OUT (switch-test-shots), MODES (2d,3d,styles,ios,android), WALK (sports to switch through,
// such as mtb,ski,hunt, instead of every pair), DUMP=1 (prints what opening each sport looks like).

import { createServer } from "node:http";
import { readFile, mkdir, appendFile } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchRetry } from "./ci/fetch-retry.mjs";

const LIVE = "https://allduf.github.io/trail-finder/";
const BROWSER = process.env.BROWSER || "webkit";
const OUT = process.env.OUT || "switch-test-shots";
const MODES = (process.env.MODES || "2d,3d,styles,ios,android").split(",").map((s) => s.trim()).filter(Boolean);
const SPORTS = ["mtb", "ski", "hunt", "fish", "moto", "hike"];
const NAMES = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", fish: "Fishing", moto: "Adventure moto", hike: "Hiking" };
const ALLOWED = new Set(["unpkg.com", "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com",
  "tile.openstreetmap.org", "tiles.openfreemap.org", "tiles.mapterhorn.com", "ibasemaps-api.arcgis.com", "server.arcgisonline.com", "allduf.github.io"]);
const PHONE = {
  viewport: { width: 430, height: 932 }, deviceScaleFactor: 1, hasTouch: true, ...(BROWSER === "chromium" ? { isMobile: true } : {}),
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  geolocation: { latitude: 50.1163, longitude: -122.9574 }, permissions: ["geolocation"], locale: "en-CA", timezoneId: "America/Vancouver",
  serviceWorkers: "block",
};
const NETWORK = /Load failed|Failed to fetch|NetworkError|network error|aborted|AbortError|ERR_FAILED|access control checks|Access-Control-Allow-Origin|Status code: \d{3}|Importing a module script failed|Could not connect/i;

// ---------- the site, on localhost (as the phone test) ----------
const root = fileURLToPath(new URL("../", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".pbf": "application/x-protobuf" };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = normalize(join(root, path));
  try {
    if (!file.startsWith(root) || /^(\.git|\.github|scripts|supabase|ios-app)\//.test(path)) throw new Error("not served");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    try {
      const r = await fetchRetry(/^trail-finder-winter2?\//.test(path) ? new URL("../" + path, LIVE) : LIVE + path);
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502).end(); }
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const SITE = `http://localhost:${server.address().port}/`;

const pw = await import("playwright");
const browser = await pw[BROWSER].launch(BROWSER === "chromium" && process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
await mkdir(OUT, { recursive: true });
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const results = [];   // { mode, step, ok, note, shot }

async function phone(init) {
  const ctx = await browser.newContext(PHONE);
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost" || ALLOWED.has(u.hostname) || u.protocol === "data:" || u.protocol === "blob:") return route.continue();
    return route.abort();
  });
  // Set once, before the first page: a device that has agreed to the terms and seen the welcome (nothing over the map).
  await ctx.addInitScript((init) => {
    if (sessionStorage.getItem("tf-switch-init")) return;
    sessionStorage.setItem("tf-switch-init", "1");
    try { for (const [k, v] of Object.entries(init)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)); } catch {}
  }, init);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => { const m = String(e.message || e); if (!NETWORK.test(m)) errors.push(m.split("\n")[0].slice(0, 200)); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (NETWORK.test(t) || /Failed to load resource|AJAXError|tile|status of 4\d\d|status of 5\d\d|WebGL|GL_|Unrecognized feature/i.test(t)) return;
    errors.push("console: " + t.split("\n")[0].slice(0, 200));
  });
  page.on("crash", () => errors.push("the page crashed (out of memory?)"));
  return { ctx, page, errors };
}

// What a person sees: the sport, the map style, 3D or flat and its photos, what's drawn on the flat map and the 3D map
// (by pane and kind, not count: data still arriving changes counts), the panels and buttons showing, the Layers switches on.
async function look() {
  const $ = (id) => document.getElementById(id);
  const shown = (el) => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const s = getComputedStyle(el); return s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.01; };
  const out = { sport: ["mtb", "ski", "hunt", "fish", "moto", "hike"].find((s) => document.body.classList.contains("sport-" + s)) || "?", base: ($("basemap") || {}).value };
  out.is3d = ($("btn3d") || {}).getAttribute ? $("btn3d").getAttribute("aria-pressed") === "true" : false;
  const map = window.tfLeaflet, flat = new Set();
  if (map) map.eachLayer((l) => {
    const o = l.options || {}, paneName = (o.renderer && o.renderer.options.pane) || o.pane || "?";
    const pane = map.getPane(paneName);
    if (pane && getComputedStyle(pane).display === "none") return;
    if (l.getLayers || l._url || paneName === "tilePane" || l instanceof L.Renderer) return;   // groups (their members count), map pictures (the style), canvases (their lines count)
    const cls = String((o.icon && o.icon.options && o.icon.options.className) || o.className || "").split(/\s+/).filter(Boolean).filter((c) => !/\d/.test(c)).slice(0, 2).join(".");
    const kind = l instanceof L.Marker ? "pin" : l instanceof L.CircleMarker ? "dot" : l instanceof L.Polygon ? "area" : l instanceof L.Polyline ? "line" : l.constructor && l.constructor.name || "other";
    flat.add(`${paneName}/${kind}${cls ? "." + cls : ""}${kind === "line" || kind === "dot" || kind === "area" ? "/" + String(o.color || "").toLowerCase() : ""}`);
  });
  out.flat = [...flat].sort();
  const gl = window.tf3dGl && window.tf3dGl();
  out.gl = [];
  if (out.is3d && gl && gl.style) {
    // Layers that draw something: shown, and (GeoJSON) with something in them; a sport's file empties its own instead of hiding them.
    const has = new Map();
    for (const l of gl.getStyle().layers) {
      if ((l.layout || {}).visibility === "none") continue;
      const src = l.source && gl.getSource(l.source);
      if (src && src.type === "geojson") {
        if (!has.has(l.source)) has.set(l.source, await Promise.resolve(src.getData ? src.getData() : src._data).then((d) => typeof d === "string" || !d || (d.features ? d.features.length > 0 : true), () => true));
        if (!has.get(l.source)) continue;
      }
      const id = l.id.replace(/\d+/g, "#");
      if (!out.gl.includes(id)) out.gl.push(id);
    }
    out.gl.sort();
    out.photos = [...document.querySelectorAll(".maplibregl-ctrl-group button[data-on]")].map((b) => b.textContent).join(",");
  }
  // Panels and buttons on screen (with an id), outside the maps.
  out.ui = [...document.querySelectorAll("body [id]")].filter((el) => !el.closest(".leaflet-container, .maplibregl-map, #layersMenu, dialog:not([open])") && shown(el))
    .map((el) => el.id).filter((id) => !/\d{3,}|^tfToast$|^mapStatus$|^mapNote$/.test(id)).sort();
  // Layers: the switches that are on (with the menu closed: hidden ones still count if their row shows for this sport).
  const lm = $("layersMenu");
  out.on = lm ? [...lm.querySelectorAll('button[aria-pressed="true"], [role=switch][aria-checked="true"]')].filter((b) => !b.closest("[hidden]") && getComputedStyle(b).display !== "none")
    .map((b) => b.id || b.dataset.k || b.dataset.layer || b.textContent.trim().slice(0, 30)).sort() : [];
  return out;
}
const diff = (a, b) => ({ extra: a.filter((x) => !b.includes(x)), missing: b.filter((x) => !a.includes(x)) });
function compare(got, want) {
  const p = [];
  if (got.sport !== want.sport) p.push(`sport is ${got.sport}`);
  if (got.base !== want.base) p.push(`map style "${got.base}", opening the app here gives "${want.base}"`);
  if (got.is3d !== want.is3d) p.push(got.is3d ? "3D stayed on" : "3D is off");
  if ((got.photos || "") !== (want.photos || "")) p.push(`3D photos "${got.photos || "none"}", not "${want.photos || "none"}"`);
  for (const [k, what] of [["flat", "flat map"], ["gl", "3D map"], ["ui", "on screen"], ["on", "Layers switches"]]) {
    const d = diff(got[k], want[k]);
    if (d.extra.length) p.push(`${what} has extra: ${d.extra.join(", ")}`);
    if (d.missing.length) p.push(`${what} is missing: ${d.missing.join(", ")}`);
  }
  return p;
}

// Every ordered pair of sports once, in one walk (an Euler circuit of the sports, each pair an edge), from MTB.
function walk() {
  if (process.env.WALK) return process.env.WALK.split(",");
  const left = Object.fromEntries(SPORTS.map((s) => [s, SPORTS.filter((t) => t !== s)]));
  const stack = ["mtb"], path = [];
  while (stack.length) { const v = stack[stack.length - 1]; if (left[v].length) stack.push(left[v].shift()); else path.push(stack.pop()); }
  return path.reverse();
}

const BASE = {   // a device that has used the app: terms agreed, welcome seen, What's new read
  "tf:todayAuto": "false", "tf:appUpdateSeen": "99999:" + Date.now(),
};
async function settle(page, ms) {
  await wait(ms);
  // Whatever pops up by itself (a tip, What's new) is closed as a person would.
  await page.keyboard.press("Escape").catch(() => {});
  await wait(300);
}
async function open(p, sport, threeD) {
  await p.page.evaluate(([s, t]) => {
    localStorage.setItem("tf:sport", JSON.stringify(s));
    localStorage.setItem("tf:map3dBy", JSON.stringify(Object.fromEntries(["mtb", "ski", "hunt", "fish", "moto", "hike"].map((k) => [k, t]))));
    localStorage.removeItem("tf:3dOpen");
  }, [sport, threeD]).catch(() => {});
  await p.page.goto(SITE + "index.html", { waitUntil: "domcontentloaded", timeout: 60_000 });
  await p.page.waitForSelector("#sportMapBtn", { timeout: 30_000 });
  if (await p.page.locator("dialog.tf-terms [data-terms=ok]").click({ timeout: 5000 }).then(() => true, () => false)) await wait(800);
  await settle(p.page, threeD ? 9000 : 4500);
}
async function pick(p, sport, threeD, ms) {
  const { page } = p;
  await page.locator("#sportMapBtn").first().click({ timeout: 8000 });
  await page.locator(`#sportMenu [data-sport=${sport}]`).first().click({ timeout: 8000 });
  await page.waitForFunction((s) => (document.getElementById("sport") || {}).value === s, sport, { timeout: 8000 });
  await settle(page, ms || (threeD ? 7000 : 4000));
}
const shotName = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80) + ".png";
function record(mode, step, problems, shot) {
  results.push({ mode, step, ok: !problems.length, note: problems.join(" · "), shot });
  console.log(`${problems.length ? "✗" : "✓"} ${mode}: ${step}${problems.length ? "\n    " + problems.join("\n    ") : ""}`);
}

// ---------- every pair, flat and 3D ----------
for (const mode of MODES.filter((m) => m === "2d" || m === "3d")) {
  const threeD = mode === "3d";
  const p = await phone({ ...BASE, "tf:sport": JSON.stringify("mtb"), "tf:map3dBy": JSON.stringify(Object.fromEntries(SPORTS.map((s) => [s, threeD]))) });
  // What opening the app in each sport looks like (the same device, the same settings).
  const want = {};
  for (const s of SPORTS) {
    const before = p.errors.length;
    await open(p, s, threeD);
    want[s] = await p.page.evaluate(look);
    if (process.env.DUMP) console.log(JSON.stringify(want[s]));
    const shot = shotName(`${mode}-open-${s}`);
    await p.page.screenshot({ path: join(OUT, shot) }).catch(() => {});
    record(mode, `Open the app in ${NAMES[s]}`, [...(want[s].sport !== s ? [`opened in ${want[s].sport}`] : []), ...(threeD && !want[s].is3d ? ["3D didn't open"] : []), ...p.errors.slice(before)], shot);
  }
  // Then every switch, one after the other, in the same visit.
  const path = walk();
  await open(p, path[0], threeD);
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1], to = path[i], before = p.errors.length;
    let problems = [];
    try {
      await pick(p, to, threeD);
      problems = compare(await p.page.evaluate(look), want[to]);
    } catch (e) { problems = [String(e.message || e).split("\n")[0].slice(0, 200)]; }
    const shot = shotName(`${mode}-${String(i).padStart(2, "0")}-${from}-to-${to}`);
    await p.page.screenshot({ path: join(OUT, shot) }).catch(() => {});
    record(mode, `${NAMES[from]} → ${NAMES[to]}`, [...problems, ...p.errors.slice(before)], shot);
  }
  await p.ctx.close();
}

// ---------- each map style picked in a sport, then every other sport ----------
if (MODES.includes("styles")) {
  const STYLES = { mtb: ["osm", "topo", "sathybrid"], hike: ["osm", "topo", "sathybrid"], fish: ["osm", "topo", "sat"], hunt: ["osm", "topo", "sathybrid"], ski: ["osm", "topo", "sathybrid", "winter"], moto: ["advtopo", "osm", "topo", "sathybrid"] };
  const p = await phone({ ...BASE, "tf:sport": JSON.stringify("mtb"), "tf:map3dBy": JSON.stringify(Object.fromEntries(SPORTS.map((s) => [s, false]))) });
  await open(p, "mtb", false);
  // What each sport should open on: Skiing Winter; Adventure moto its own pick (ADV topo at first); the other four share
  // one pick, Map for MTB and Satellite for the rest until something is picked (index.html savedBase).
  const kept = { shared: null, moto: null };
  const expect = (s) => s === "ski" ? "winter" : s === "moto" ? kept.moto || "advtopo" : kept.shared || (s === "mtb" ? "osm" : "sathybrid");
  let cur = "mtb";
  for (const from of SPORTS) {
    for (const style of STYLES[from]) {
      for (const to of SPORTS.filter((t) => t !== from)) {
        const before = p.errors.length;
        let problems = [];
        try {
          if (cur !== from) { await pick(p, from, false, 1500); cur = from; }
          await p.page.evaluate((k) => { const s = document.getElementById("basemap"); s.value = k; s.dispatchEvent(new Event("change")); }, style);
          await wait(600);
          if (from !== "ski") { if (from === "moto") kept.moto = style; else kept.shared = style; }
          await pick(p, to, false, 1500); cur = to;
          const got = await p.page.evaluate(() => document.getElementById("basemap").value);
          if (got !== expect(to)) problems.push(`opens on "${got}", should be "${expect(to)}"`);
        } catch (e) { problems = [String(e.message || e).split("\n")[0].slice(0, 200)]; }
        record("styles", `${style} in ${NAMES[from]} → ${NAMES[to]}`, [...problems, ...p.errors.slice(before)], "");
      }
    }
  }
  await p.ctx.close();
}

// ---------- the phone apps' native map (iPhone and Android), under the page ----------
// On the apps the native map lies under the page (alex's one-map trial, then everyone): the page's Sport button stays on
// top, so a sport can be switched while native 3D shows. A stand-in for the app (Capacitor's TrailMap, answering as the
// next build does: its keys from NativeLayers.swift / the Android layers) keeps what the native map was last given: the
// style, the trails and dots copied from the flat map, and each native feature's own data. After each switch that must
// be what the native map gets when 3D is opened fresh in that sport: nothing of the sport before left on it.
const APP_DIRS = { ios: "ios-app/plugins/TrailMap/ios/Sources/TrailMap", android: "android-app/plugins/TrailMap/android/src/main/java/com/allduf/trailmap" };
async function appKeys(kind) {
  const { readdir } = await import("node:fs/promises");
  const dir = join(root, APP_DIRS[kind]), keys = new Set();
  for (const f of await readdir(dir)) {
    const t = await readFile(join(dir, f), "utf8");
    if (kind === "ios" && f.endsWith(".swift")) for (const m of t.matchAll(/\b(?:let key = |NativeOverlay\(key:\s*)"([^"]+)"/g)) keys.add(m[1]);
    if (kind === "android" && f.endsWith(".java")) for (const m of t.matchAll(/String key\(\)\s*\{\s*return "([^"]+)";|new NativeOverlay\("([^"]+)"/g)) keys.add(m[1] || m[2]);
  }
  return [...keys];
}
// In the page before its own scripts: the app's stand-in. window.__tm.now: what the native map shows.
function nativeStandIn({ platform, keys }) {
  const tm = (window.__tm = { on: {}, opens: 0, now: null });
  tm.fire = (name, e) => (tm.on[name] || []).forEach((fn) => fn(e));
  const ok = (v) => Promise.resolve(v);
  const TrailMap = {
    features: () => ok({ keys }),
    open: (o) => {
      tm.opens++;
      if (!tm.now) tm.now = { base: o.base, lines: o.lines, dots: o.dots, layers: { ...(o.layers || {}) } };
      else Object.assign(tm.now, { base: o.base, lines: o.lines, dots: o.dots }, { layers: { ...tm.now.layers, ...(o.layers || {}) } });
      tm.now.tilt = !!o.threeD && !o.flat;   // the one map opens seen from above (flat), native 3D tipped up
      return ok(o.under && keys.includes("under") ? { under: true } : undefined);
    },
    update: (o) => { if (tm.now) Object.assign(tm.now, { lines: o.lines, dots: o.dots }); return ok(); },
    layer: (o) => {
      if (tm.now) {
        if (o.key === "base") tm.now.base = o.data;
        else if (o.key === "under") { try { const u = JSON.parse(o.data); if (typeof u.tilt === "boolean") tm.now.tilt = u.tilt; } catch {} }
        else tm.now.layers[o.key] = o.data;
      }
      return ok();
    },
    offline: () => ok({ areas: {} }),
    close: () => { const was = !!tm.now; tm.now = null; if (was) setTimeout(() => { const c = window.tfLeaflet.getCenter(); tm.fire("closed", { lat: c.lat, lon: c.lng, zoom: 12, bearing: 0, details: false, layers: false, open: -1 }); }, 0); return ok(); },
    addListener: (name, fn) => { (tm.on[name] = tm.on[name] || []).push(fn); return ok({ remove() {} }); },
  };
  const other = () => new Proxy({}, { get: (_, k) => (k === "then" ? undefined : () => ok(k === "addListener" ? { remove() {} } : {})) });
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: (n) => n === "TrailMap",
    registerPlugin: (n) => (n === "TrailMap" ? TrailMap : other()), Plugins: { TrailMap } };
}
// What the native map shows, in short: its style; the trails and dots by colour and dash (not count); and for each
// native feature, what kinds of things it draws (GeoJSON features by kind, or "something" / "nothing").
function nativeLook() {
  const n = window.__tm && window.__tm.now;
  if (!n) return null;
  const parse = (t) => { try { return JSON.parse(t); } catch { return null; } };
  const kinds = (fc) => [...new Set(((fc && fc.features) || []).map((f) => `${f.geometry && f.geometry.type}/${String(f.properties && (f.properties.c || f.properties.fc) || "").toLowerCase()}${f.properties && f.properties.d ? "~" : ""}`))].sort();
  // Anything with something in it: a FeatureCollection with features, a non-empty list, true, a non-empty string.
  const some = (v) => v == null ? false : Array.isArray(v) ? v.some(some) : typeof v === "object" ? (v.type === "FeatureCollection" ? v.features.length > 0 : Object.values(v).some(some)) : typeof v === "string" ? v.length > 0 : v === true;
  const layers = {};
  for (const [k, d] of Object.entries(n.layers)) {
    if (/^(fingers|search|flyover|offline|under|tools)$/.test(k)) continue;   // words, answers and tools of the screen itself, not the sport's
    const j = parse(d);
    layers[k] = j && typeof j === "object" ? (some(j) ? "something" : "nothing") : d && String(d).length ? "something" : "nothing";
  }
  // The 3D button over it: "2D map" while native 3D is tipped up, "3D" while it's seen from above.
  const b3 = (document.getElementById("btn3d") || {}).textContent || "";
  return { base: n.base, tilt: !!n.tilt, button: /2D/.test(b3) ? "2D map" : "3D", lines: kinds(parse(n.lines)), dots: kinds(parse(n.dots)), layers };
}
function compareNative(got, want) {
  if (!got) return ["the native map isn't open"];
  const p = [];
  if (got.tilt !== want.tilt) p.push(got.tilt ? "native 3D stayed tipped up" : "native 3D is flat");
  if (got.button !== (got.tilt ? "2D map" : "3D")) p.push(`the 3D button reads "${got.button}" while the native map is ${got.tilt ? "in 3D" : "seen from above"}`);
  if (got.base !== want.base) p.push(`native map style "${got.base}", opening 3D here gives "${want.base}"`);
  for (const k of ["lines", "dots"]) {
    const d = diff(got[k], want[k]);
    if (d.extra.length) p.push(`native ${k} has extra: ${d.extra.join(", ")}`);
    if (d.missing.length) p.push(`native ${k} is missing: ${d.missing.join(", ")}`);
  }
  for (const k of new Set([...Object.keys(got.layers), ...Object.keys(want.layers)])) {
    const g = got.layers[k] || "nothing", w = want.layers[k] || "nothing";
    if (g !== w) p.push(`native "${k}" shows ${g}, opening 3D here shows ${w}`);
  }
  return p;
}
for (const kind of MODES.filter((m) => m === "ios" || m === "android")) {
  const label = kind === "ios" ? "iPhone app" : "Android app";
  const keys = await appKeys(kind);
  const p = await phone({ ...BASE, "tf-admin": "1", "tf:sport": JSON.stringify("mtb"), "tf:map3dBy": JSON.stringify(Object.fromEntries(SPORTS.map((s) => [s, false]))) });
  await p.ctx.addInitScript(nativeStandIn, { platform: kind, keys });
  const open3d = async () => {
    // 3D on, as a person taps it: native 3D opens under the page, tipped up.
    const on = await p.page.evaluate(() => !!window.__tm.now && window.__tm.now.tilt);
    if (!on) await p.page.locator("#btn3d").first().click({ timeout: 8000 });
    await p.page.waitForFunction(() => !!window.__tm.now && window.__tm.now.tilt, null, { timeout: 8000 });
    await settle(p.page, 3500);
  };
  const want = {}, views = {};
  for (const s of SPORTS) {
    const before = p.errors.length;
    let problems = [];
    try {
      await open(p, s, false);
      await open3d();
      want[s] = await p.page.evaluate(nativeLook);
      views[s] = await p.page.evaluate(() => { const c = window.tfLeaflet.getCenter(); return [c.lat, c.lng, window.tfLeaflet.getZoom()]; });
      if (process.env.DUMP) console.log(JSON.stringify(want[s]));
    } catch (e) { problems = [String(e.message || e).split("\n")[0].slice(0, 200)]; }
    record(kind, `${label}: native 3D opened in ${NAMES[s]}`, [...problems, ...p.errors.slice(before)], "");
  }
  const path = walk();
  await open(p, path[0], false);
  await open3d();
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1], to = path[i], before = p.errors.length;
    let problems = [];
    try {
      await pick(p, to, false);
      // The button first, as a person sees it: native 3D still up says "2D map".
      const now = await p.page.evaluate(nativeLook);
      if (now && now.button !== (now.tilt ? "2D map" : "3D")) problems.push(`just after the switch the 3D button reads "${now.button}" while the native map is ${now.tilt ? "in 3D" : "seen from above"}`);
      await open3d();   // a sport whose one map is flat comes back seen from above: 3D again, as a person would
      // The same view as when 3D was opened fresh here (what's drawn depends on where and how close).
      if (views[to]) { await p.page.evaluate((v) => { window.tfLeaflet.setView([v[0], v[1]], v[2], { animate: false }); }, views[to]); await settle(p.page, 3500); }
      problems.push(...(want[to] ? compareNative(await p.page.evaluate(nativeLook), want[to]) : ["no native 3D to compare with"]));
    } catch (e) { problems = [String(e.message || e).split("\n")[0].slice(0, 200)]; }
    const shot = shotName(`${kind}-${String(i).padStart(2, "0")}-${from}-to-${to}`);
    await p.page.screenshot({ path: join(OUT, shot) }).catch(() => {});
    record(kind, `${label}: ${NAMES[from]} → ${NAMES[to]} in native 3D`, [...problems, ...p.errors.slice(before)], shot);
  }
  await p.ctx.close();
}

await browser.close();
server.close();
const bad = results.filter((r) => !r.ok);
const summary = [`## Sport switch test (${BROWSER}, 430 x 932)`, "", `${results.length - bad.length} of ${results.length} checks pass.`, "",
  ...(bad.length ? ["| Mode | Switch | Problem | Screenshot |", "|---|---|---|---|", ...bad.map((r) => `| ${r.mode} | ${r.step} | ${r.note.replace(/\|/g, "\\|")} | ${r.shot} |`)] : [])].join("\n");
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
console.log("\n" + summary);
process.exit(bad.length ? 1 : 0);
