// Avalanche watch (alex 2026-11-27, after 2026-11-26: Avalanche Canada regrouped its areas at 4 PM and the app kept
// the expired bulletin until PR #957). Every hour (.github/workflows/avalanche-watch.yml) this opens the live app in Skiing,
// in a test browser on Pacific time, and checks that what it shows is exactly what Avalanche Canada gives right now:
//   1. Each bulletin: the app has the same bulletin (id, issued, valid until) for each forecast area, and the same
//      danger rating for every day and band. The ratings are read here on their own (not with the app's code), so a
//      change in how Avalanche Canada writes them shows up too.
//   2. Each area's outline: a point well inside each forecast area (2 km or more from any edge) is looked up in the
//      app as the Today card does (tfSki.avyToday): the app must find that area there and show today's ratings
//      exactly, or nothing when Avalanche Canada has none for today. Never an expired bulletin while a new one is out.
//   3. Avalanche Canada's list and shape of areas: compared with the last run's. A change is written in the run's
//      summary, with whether the app followed it.
//   4. The saved copy (data/avalanche.json, the backup with no signal): how old it is.
// Anything the app shows differently (1, 2), the app not reading Avalanche Canada at all, a rating word this check
// doesn't know, or a saved copy over 12 hours old in season counts as a difference. alex gets a push on their own
// phone (no email, alex 2026-11-27: "i dont want to receive email"): when differences start, every 6 hours while they
// last, and once when all is back in step. The job itself stays green (a failed scheduled job emails), and its
// summary and out/avy-watch/result.json say what was found.
// A difference is checked again 2 minutes later before it counts (a bulletin can come out between the two reads).
// The last run's state (Avalanche Canada's areas, when alex was last told) is kept in STATE (the workflow's cache).
//
// Run: node scripts/avy-watch.mjs   (needs the playwright package and its Chromium)
// Optional: SITE (the site to open, default https://trailfinderapp.ca/), LOCAL=1 (this checkout's scripts, with the
//   live site's data files: how a pull request is checked), DATA (with LOCAL: a folder whose data/ files are used
//   instead of the live site's, to test the check itself), BLOCK (a pattern of addresses the app can't reach, the same),
//   DRY=1 (no push), STATE (state file, default
//   .avy-watch/state.json).
import { createServer } from "node:http";
import { readFile, appendFile, writeFile, mkdir } from "node:fs/promises";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const LIVE = "https://trailfinderapp.ca/";
const API = "https://api.avalanche.ca/forecasts/en/";
const TZ = "America/Vancouver";   // the test phone's time zone (the app's "today" is the phone's own day)
const DRY = !!process.env.DRY, LOCAL = !!process.env.LOCAL;
const DATA = process.env.DATA ? fileURLToPath(new URL(process.env.DATA.replace(/\/?$/, "/"), "file://" + process.cwd() + "/")) : null;   // a folder holding data/ files to use instead of the live site's (tests)
const STATE = process.env.STATE || ".avy-watch/state.json";
const OUT = join(process.cwd(), "out", "avy-watch");
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
await mkdir(OUT, { recursive: true });

// ---------- Avalanche Canada, read on its own ----------
// Danger words: a level, or a known "no level" word. Any other word fails the run (the app may misread it).
const LEVEL = { low: 1, moderate: 2, considerable: 3, high: 4, extreme: 5 };
const NO_LEVEL = new Set(["norating", "earlyseason", "noforecast", "spring", "offseason", "nodata", ""]);
const BANDS = ["alp", "tln", "btl"];
async function getJson(url) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { if (i >= 2) throw new Error(`${url}: ${e.message}`); await wait(5000 * (i + 1)); }
  }
}
// The day a rating is for: its time in the bulletin's own time zone, which must fall on the day it names.
const dayIn = (iso, tz) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });
const weekdayIn = (iso, tz) => new Date(iso).toLocaleDateString("en-US", { timeZone: tz, weekday: "long" }).toLowerCase();
const todayHere = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
async function readAvCan() {
  const all = await getJson(API + "products"), geo = await getJson(API + "areas");
  const list = Array.isArray(all) ? all : all.products || all.data || [];
  const problems = [];   // things that make the check itself unsure (a change in how Avalanche Canada writes things)
  const products = [];
  for (const p of list) {
    if (!p || !p.report || (p.type && !/forecast/i.test(String(p.type.value || p.type)))) continue;
    const r = p.report, tz = r.timezone || TZ, areaId = String(p.area?.id ?? "");
    const days = (r.dangerRatings || []).map((d) => {
      const iso = d.date?.value || d.date, named = String(d.date?.display || "").trim().toLowerCase();
      const date = dayIn(iso, tz);
      if (named && /^[a-z]+day$/.test(named) && weekdayIn(iso, tz) !== named) problems.push(`${short(r.title)}: ${iso} is a ${weekdayIn(iso, tz)} in ${tz}, but Avalanche Canada names it ${named}`);
      const out = { date };
      for (const b of BANDS) {
        const w = String(d.ratings?.[b]?.rating?.value ?? "").toLowerCase();
        if (!(w in LEVEL) && !NO_LEVEL.has(w)) problems.push(`${short(r.title)}: unknown danger word "${w}" (${b})`);
        out[b] = LEVEL[w] || 0;
      }
      return out;
    });
    const early = (r.dangerRatings || []).some((d) => BANDS.some((b) => /^early\s*season$/i.test(String(d.ratings?.[b]?.rating?.value ?? "").trim())));
    products.push({ id: String(p.id || ""), areaId, title: String(r.title || ""), owner: String(p.owner?.value || ""), issued: r.dateIssued || "", validUntil: r.validUntil || "", days, early });
  }
  if (!products.length) problems.push("Avalanche Canada's forecast list came back with no bulletins");
  const areas = (geo.features || []).map((f) => ({ id: String(f.id ?? f.properties?.id ?? ""), geometry: f.geometry })).filter((a) => a.id && a.geometry);
  if (!areas.length) problems.push("Avalanche Canada's area outlines came back empty");
  return { products, areas, problems };
}
const short = (t) => { t = String(t || ""); return t.length > 60 ? t.slice(0, 57) + "..." : t; };

// ---------- a point well inside each area ----------
const ringsOf = (g) => (g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : []);
function inside(lon, lat, polys) {   // even-odd over every ring (holes count)
  let n = false;
  for (const poly of polys) for (const ring of poly)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) n = !n;
    }
  return n;
}
function edgeKm(lon, lat, allPolys) {   // distance to the nearest edge of any area, in km (flat, fine at this size)
  const kx = Math.cos((lat * Math.PI) / 180) * 111.32, ky = 110.54;
  let best = Infinity;
  for (const polys of allPolys) for (const poly of polys) for (const ring of poly)
    for (let i = 1; i < ring.length; i++) {
      const ax = (ring[i - 1][0] - lon) * kx, ay = (ring[i - 1][1] - lat) * ky, bx = (ring[i][0] - lon) * kx, by = (ring[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best) best = d;
    }
  return best;
}
function pointsFor(areas) {
  const all = areas.map((a) => ringsOf(a.geometry));
  return areas.map((a, k) => {
    const polys = all[k], pts = polys.flatMap((p) => p[0] || []);
    if (!pts.length) return null;
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
    let best = null;
    const N = 24;
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const lon = x0 + ((x1 - x0) * i) / N, lat = y0 + ((y1 - y0) * j) / N;
      if (!inside(lon, lat, polys) || all.some((o, m) => m !== k && inside(lon, lat, o))) continue;
      const d = edgeKm(lon, lat, [polys, ...all.filter((_, m) => m !== k)]);
      if (!best || d > best.d) best = { lat: +lat.toFixed(5), lon: +lon.toFixed(5), d };
    }
    return best && best.d >= 2 ? { id: a.id, lat: best.lat, lon: best.lon, km: +best.d.toFixed(1) } : null;
  }).filter(Boolean);
}
// The shape of each area, to see when Avalanche Canada changes them (rounded to ~100 m: a re-save isn't a change).
const shapeOf = (g) => createHash("sha1").update(JSON.stringify(ringsOf(g).map((p) => p.map((r) => r.map(([x, y]) => [Math.round(x * 1e3), Math.round(y * 1e3)]))))).digest("hex").slice(0, 10);

// ---------- this checkout as the site (LOCAL=1) ----------
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".webp": "image/webp", ".txt": "text/plain" };
async function localSite() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const server = createServer(async (req, res) => {
    let path;
    try { path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html"; } catch { res.writeHead(400).end(); return; }
    const base = path.startsWith("data/") ? DATA : root, file = base && normalize(join(base, path));
    if (file && file.startsWith(base)) {
      try { const body = await readFile(file); res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(body); return; } catch {}
    }
    try {
      const r = await fetch(LIVE + path);
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502).end(); }
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

// ---------- the app ----------
async function readApp(site, points) {
  const pw = await import("playwright");
  const browser = await pw.chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  try {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, timezoneId: TZ, locale: "en-CA",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem("avy-watch")) return;
      sessionStorage.setItem("avy-watch", "1");
      for (const [k, v] of Object.entries({ "tf:sport": "ski", "tf:todayAuto": false })) localStorage.setItem(k, JSON.stringify(v));
      localStorage.setItem("tf:appUpdateSeen", "99999:" + Date.now());   // read raw by app-update.js
    });
    if (process.env.BLOCK) await ctx.route(new RegExp(process.env.BLOCK), (r) => r.abort());   // tests of the check itself: a read the app can't make
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e).split("\n")[0].slice(0, 200)));
    await page.goto(site + "index.html?nowelcome", { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => window.tfSki && typeof window.tfSki.avyAreas === "function" && typeof window.tfSki.avyToday === "function", null, { timeout: 90000 });
    // The forecast as the app has it after its live read of Avalanche Canada (null until that read is done).
    const areas = await page.evaluate(async () => {
      for (let i = 0; i < 12; i++) {
        const a = await window.tfSki.avyAreas();
        if (a) return a.map((x) => ({ id: x.id, name: x.name, forecast: x.forecast && { id: x.forecast.id, issued: x.forecast.issued, validUntil: x.forecast.validUntil, live: !!x.forecast.live, early: !!x.forecast.early,
          days: (x.forecast.days || []).map((d) => ({ date: d.date, alp: d.alp || 0, tln: d.tln || 0, btl: d.btl || 0 })) } }));
        await new Promise((ok) => setTimeout(ok, 5000));
      }
      return null;
    });
    // What the app shows at each point (the Today card's reading), and which of its areas holds that point.
    const at = areas ? await page.evaluate(async (pts) => {
      const out = [];
      const areas = await window.tfSki.avyAreas() || [];
      const inPoly = (lat, lon, poly) => { let n = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ay, ax] = poly[i], [by, bx] = poly[j]; if ((ay > lat) !== (by > lat) && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) n = !n; } return n; };
      for (const p of pts) {
        const holder = areas.find((a) => (a.polys || []).some((q) => inPoly(p.lat, p.lon, q)));
        let today;
        try { today = await window.tfSki.avyToday(p.lat, p.lon); } catch (e) { today = { none: "error " + e.message }; }
        out.push({ ...p, appArea: holder ? holder.id : null, today: today && { none: today.none || "", bands: (today.bands || []).map((b) => [b.b, b.r]) } });
      }
      return out;
    }, points) : [];
    await page.screenshot({ path: join(OUT, "app.png") }).catch(() => {});
    return { areas, at, errors };
  } finally { await browser.close(); }
}

// ---------- compare ----------
function compare(av, app) {
  const wrong = [];   // the app shows something Avalanche Canada doesn't (fails the run)
  const today = todayHere(), now = Date.now();
  if (!app.areas) { wrong.push("The app didn't read Avalanche Canada live (tfSki.avyAreas stayed empty for a minute): it may be showing only its saved copy."); return wrong; }
  const appById = new Map(app.areas.map((a) => [a.id, a]));
  const outlined = new Set(av.areas.map((a) => a.id));
  for (const p of av.products) {
    const a = appById.get(p.areaId), f = a && a.forecast;
    const where = short(p.title) || p.areaId;
    if (!a) { if (outlined.has(p.areaId)) wrong.push(`${where}: the app has no area for this bulletin (area ${p.areaId.slice(0, 10)})`); continue; }
    if (!f) { wrong.push(`${where}: the app has the area but no bulletin`); continue; }
    if (f.id !== p.id) wrong.push(`${where}: the app has bulletin ${String(f.id).slice(0, 8)} issued ${f.issued}, Avalanche Canada ${p.id.slice(0, 8)} issued ${p.issued}`);
    if (Date.parse(f.validUntil) !== Date.parse(p.validUntil)) wrong.push(`${where}: valid until ${f.validUntil} in the app, ${p.validUntil} at Avalanche Canada`);
    const want = p.days.filter((d) => d.date >= today);
    for (const d of want) {
      const g = f.days.find((x) => x.date === d.date);
      if (!g) { wrong.push(`${where}: ${d.date} is missing in the app`); continue; }
      const off = BANDS.filter((b) => g[b] !== d[b]);
      if (off.length) wrong.push(`${where}, ${d.date}: ${off.map((b) => `${b} ${g[b]} in the app, ${d[b]} at Avalanche Canada`).join("; ")}`);
    }
    for (const g of f.days) if (!want.some((d) => d.date === g.date)) wrong.push(`${where}: the app has a day (${g.date}) Avalanche Canada doesn't give`);
  }
  const byArea = new Map(av.products.map((p) => [p.areaId, p]));
  for (const pt of app.at) {
    const p = byArea.get(pt.id), where = short(p ? p.title : "") || `area ${pt.id.slice(0, 10)}`, t = pt.today || { none: "nothing" };
    if (pt.appArea !== pt.id) { wrong.push(`${where}: at ${pt.lat}, ${pt.lon} (${pt.km} km inside) the app finds ${pt.appArea ? "another area (" + pt.appArea.slice(0, 10) + ")" : "no area"}`); continue; }
    const d = p && !(p.validUntil && Date.parse(p.validUntil) < now) ? p.days.find((x) => x.date === today) : null;
    const has = d && BANDS.some((b) => d[b]);
    if (t.bands && t.bands.length) {
      if (!d) { wrong.push(`${where}: the Today card shows ratings at ${pt.lat}, ${pt.lon}, Avalanche Canada gives none for today`); continue; }
      const off = t.bands.filter(([b, r]) => d[b] !== r);
      if (off.length) wrong.push(`${where}: the Today card at ${pt.lat}, ${pt.lon} shows ${off.map(([b, r]) => `${b} ${r} (Avalanche Canada ${d[b]})`).join(", ")}`);
    } else if (has && !(p.early && t.none === "early")) {
      // Nothing shown while Avalanche Canada has today's ratings (the early season bulletin's mix of a level and
      // "early season" is left out on purpose: the card says why).
      wrong.push(`${where}: the Today card shows no ratings at ${pt.lat}, ${pt.lon} (${t.none === "old" ? "an expired bulletin" : t.none}) while Avalanche Canada gives ${BANDS.map((b) => d[b]).join("/")} for today`);
    }
  }
  return wrong;
}

// ---------- one run ----------
async function check(site) {
  const av = await readAvCan();
  const points = pointsFor(av.areas.filter((a) => av.products.some((p) => p.areaId === a.id)));
  const app = await readApp(site, points);
  const after = await readAvCan();   // a bulletin out while the app was read: check again
  const moved = JSON.stringify(after.products.map((p) => [p.id, p.validUntil])) !== JSON.stringify(av.products.map((p) => [p.id, p.validUntil]));
  const shown = compare(av, app);
  return { av, app, points, wrong: [...av.problems, ...shown], shown, moved };
}
let site = process.env.SITE || LIVE, local = null;
if (LOCAL) { local = await localSite(); site = local.url; }
// A pull request's run (LOCAL or DRY) fails on a difference, so the change can't merge; the hourly run never does.
// Only what the app shows counts there: Avalanche Canada's wording and the saved copy's age aren't the change's doing.
const done = (bad) => process.exit(bad && (LOCAL || DRY) ? 1 : 0);
const was = await readFile(STATE, "utf8").then(JSON.parse, () => ({}));
const sendAlex = async (msg) => {
  if (DRY) { console.log(`Dry run, no push: ${msg.title}: ${msg.body}`); return false; }
  try {
    const push = await import("./admin-push.mjs").catch(() => null);
    if (!push || !push.adminPush) throw new Error("scripts/admin-push.mjs isn't there");
    const r = await push.adminPush(msg) || {};
    console.log(`Pushed to alex's phone (${r.sent || 0} of ${r.phones || 0}): ${msg.title}`);
    return (r.sent || 0) > 0;
  } catch (e) { console.log(`::warning::Couldn't push to alex's phone: ${e.message}`); return false; }
};
const saveState = async (state) => { await mkdir(dirname(STATE), { recursive: true }); await writeFile(STATE, JSON.stringify(state)); };
let run, first = null, lastErr = "";
try {
  for (let i = 0; i < 2; i++) {
    run = await check(site);
    if (!run.wrong.length) break;
    first = run;
    if (i === 0) { console.log(`${run.wrong.length} difference(s), checking again in 2 minutes:\n  ${run.wrong.join("\n  ")}`); await wait(run.moved ? 30000 : 120000); }
  }
} catch (e) {
  lastErr = String(e && e.message || e);
  if (first) run = first;   // differences found, then the second look failed: they still count
}
if (!run) {
  const e = new Error(lastErr);
  // The watch itself couldn't run (Avalanche Canada or the site didn't answer, the browser failed): alex hears of it
  // after 3 runs in a row, so one slow hour isn't a push.
  const fails = (was.fails || 0) + 1, line = `The avalanche watch couldn't run: ${String(e.message || e).split("\n")[0].slice(0, 200)}`;
  console.log(`::warning::${line} (${fails} run(s) in a row)`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Avalanche watch\n\n${line} (${fails} run(s) in a row)\n`);
  if (fails >= 3 && !was.failTold && await sendAlex({ title: "Avalanche watch couldn't run", body: `3 hours in a row: ${short(line.replace(/^The avalanche watch couldn't run: /, ""))}`, tag: "tf-avy-watch" })) was.failTold = 1;
  await saveState({ ...was, fails });
  local?.close();
  done(true);
}
local?.close();
const { av, app, wrong, points, shown } = run;

// The saved copy (data/avalanche.json on the site): how old it is, and whether its areas are Avalanche Canada's now.
const notes = [];
let saved = null;
try { saved = await getJson(LIVE + "data/avalanche.json"); } catch (e) { notes.push(`The saved copy couldn't be read: ${e.message}`); }
const inSeason = ((m) => m >= 10 || m <= 4)(new Date().getUTCMonth());   // November to May
if (saved) {
  const age = (Date.now() - Date.parse(saved.builtAt || 0)) / 3600e3;
  const ids = new Set((saved.areas || []).map((a) => a.id)), off = av.products.filter((p) => !ids.has(p.areaId)).length;
  const line = `Saved copy: built ${saved.builtAt || "?"} (${age.toFixed(1)} h ago)${off ? `, ${off} of Avalanche Canada's areas not in it yet` : ", same areas as Avalanche Canada"}.`;
  if (inSeason && age > 12) wrong.push(line + " Over 12 hours old: the 2-hourly rebuild (Avalanche and snow data) may have stopped, and phones with no signal show it.");
  else notes.push(line);
}
if (app.errors.length) notes.push(`Page errors: ${[...new Set(app.errors)].slice(0, 5).join(" | ")}`);

// Avalanche Canada's areas, against the last run's.
const shapes = Object.fromEntries(av.areas.map((a) => [a.id, shapeOf(a.geometry)]));
const titleOf = (id) => short(av.products.find((p) => p.areaId === id)?.title) || id.slice(0, 10);
if (was.shapes) {
  const added = Object.keys(shapes).filter((id) => !(id in was.shapes)), gone = Object.keys(was.shapes).filter((id) => !(id in shapes)), reshaped = Object.keys(shapes).filter((id) => id in was.shapes && was.shapes[id] !== shapes[id]);
  if (added.length || gone.length || reshaped.length) notes.unshift(`Avalanche Canada changed its areas since the last run (${[added.length && `${added.length} new: ${added.map(titleOf).join("; ")}`, gone.length && `${gone.length} gone`, reshaped.length && `${reshaped.length} new outline(s): ${reshaped.map(titleOf).join("; ")}`].filter(Boolean).join(", ")}). ` +
    (wrong.length ? "The app does not match yet." : "The app already shows the new areas and their bulletins."));
}
const summary = [
  `Checked ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC against ${LOCAL ? "this branch" : site}: ${av.products.length} bulletins, ${av.areas.length} areas, ${points.length} points looked up in the app.`,
  wrong.length ? `\n**${wrong.length} difference(s):**\n${wrong.map((w) => `- ${w}`).join("\n")}` : "\nThe app shows exactly Avalanche Canada's bulletins and areas.",
  notes.length ? `\n${notes.map((n) => `- ${n}`).join("\n")}` : "",
].join("\n");
console.log(summary);
await writeFile(join(OUT, "result.json"), JSON.stringify({ wrong, notes, points, products: av.products.map((p) => ({ id: p.id, area: p.areaId, title: p.title, days: p.days })) }, null, 1));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Avalanche watch\n\n${summary}\n`);

// ---------- alex's phone ----------
// Started, every 6 hours while it lasts, and once when it's over. scripts/admin-push.mjs adminPush() (alex's own phones, supabase/alert-phones.sql); the same tag replaces the last one.
const now = Date.now(), state = { shapes, wrongSince: wrong.length ? was.wrongSince || now : 0, toldAt: wrong.length ? was.toldAt || 0 : 0 };
let msg = null;
if (wrong.length && now - (was.toldAt || 0) > 6 * 3600e3)
  msg = { title: "Avalanche watch: app differs", body: `${wrong.length} difference${wrong.length > 1 ? "s" : ""} from Avalanche Canada: ${short(wrong[0])}${wrong.length > 1 ? " ..." : ""}`, tag: "tf-avy-watch" };
else if (!wrong.length && (was.toldAt || was.failTold)) msg = { title: "Avalanche watch: back in step", body: "The app shows exactly Avalanche Canada's bulletins again.", tag: "tf-avy-watch" };
const sent = msg ? await sendAlex(msg) : false;
if (wrong.length && sent) state.toldAt = now;
if (!wrong.length && msg && !sent) { state.toldAt = was.toldAt; state.failTold = was.failTold; }   // "back in step" tried again next run
await saveState(state);
done(shown.length);
