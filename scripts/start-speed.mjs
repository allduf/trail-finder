// Opening speed with a big Offline maps save (see .github/workflows/start-speed.yml), in WebKit, the engine of the
// iPhone app. alex's iPhone app took 3-4 s for the page itself on each open after a big offline save (usage Speed rows,
// 2026-11-21), against under 1 s before. This opens the app the way the iPhone app does on each start (a new browser
// with the same saved files), first with nothing saved for offline, then with FILL files in Offline maps' cache, and
// prints how long the page, its first bytes and its scripts took.
//
// Run: node scripts/start-speed.mjs   (needs the playwright package and its WebKit, or BROWSER=chromium)
// Optional: ROOTS (label=folder,... default "this=.": each one served and measured on its own), FILL (20000 files),
//   RUNS (5 opens each), BROWSER (webkit), DATA (folder for data/ files a root doesn't have; else the live site).

import { createServer } from "node:http";
import { readFile, mkdtemp, rm, appendFile } from "node:fs/promises";
import { join, extname, normalize, resolve } from "node:path";
import { tmpdir } from "node:os";

const LIVE = "https://trailfinderapp.ca/";
const BROWSER = process.env.BROWSER || "webkit";
const FILL = +(process.env.FILL || 20000), RUNS = +(process.env.RUNS || 5);
const ROOTS = (process.env.ROOTS || "this=.").split(",").map((r) => { const [label, dir] = r.includes("=") ? r.split("=") : [r, r]; return { label, dir: resolve(dir) + "/" }; });
const DATA = process.env.DATA ? resolve(process.env.DATA) + "/" : null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".webp": "image/webp" };

function serve(root) {
  const server = createServer(async (req, res) => {
    let path;
    try { path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html"; } catch { res.writeHead(400).end(); return; }
    for (const base of [root, path.startsWith("data/") ? DATA : null]) {
      if (!base) continue;
      const file = normalize(join(base, path));
      if (!file.startsWith(base)) continue;
      try { const body = await readFile(file); res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(body); return; } catch {}
    }
    try {
      const r = await fetch(LIVE + path);
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502).end(); }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

const pw = await import("playwright");
const OPTS = { viewport: { width: 430, height: 932 }, hasTouch: true, serviceWorkers: "allow", locale: "en-CA", timezoneId: "America/Vancouver" };
async function open(dir) {
  const ctx = await pw[BROWSER].launchPersistentContext(dir, OPTS);
  // Only this site: nothing outside is asked (weather, Supabase, map pictures).
  await ctx.route("**/*", (r) => { const u = new URL(r.request().url()); return /^(localhost|127\.0\.0\.1)$/.test(u.hostname) || !/^https?:/.test(u.protocol) ? r.continue() : r.abort(); });
  await ctx.addInitScript(() => { try { localStorage.setItem("tf:todayAuto", "false"); } catch {} });
  return ctx;
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const mid = (a) => { const s = a.filter((x) => x >= 0).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : -1; };

const rows = [];
for (const { label, dir: root } of ROOTS) {
  const server = await serve(root);
  const site = `http://127.0.0.1:${server.address().port}/`;
  // FILLS: what to save first, e.g. "0,cache:20000,idb:20000" (idb: the same files in an IndexedDB store instead).
  for (const spec of (process.env.FILLS || `0,cache:${FILL}`).split(",")) {
    const [where, fill] = spec.includes(":") ? [spec.split(":")[0], +spec.split(":")[1]] : ["cache", +spec];
    const dir = await mkdtemp(join(tmpdir(), "tf-start-"));
    // First visit: agree to the terms, let the offline helper save the app's files, then open again under it.
    let ctx = await open(dir), page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(site, { waitUntil: "load", timeout: 120000 });
    await page.locator("dialog.tf-terms [data-terms=ok]").click({ timeout: 10000 }).catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
    await wait(10000);
    await page.reload({ waitUntil: "load" }); await wait(5000);
    if (fill) {
      // Offline maps' cache with FILL saved map files (16 KB each), like a 300 MB save.
      await page.evaluate(async ([n, where]) => {
        const body = new Uint8Array(16384);
        if (where === "idb") {
          const db = await new Promise((ok, no) => { const r = indexedDB.open("tf-test-offline", 1); r.onupgradeneeded = () => r.result.createObjectStore("f"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
          for (let i = 0; i < n; i += 500) await new Promise((ok) => { const t = db.transaction("f", "readwrite"), st = t.objectStore("f"); for (let j = i; j < Math.min(n, i + 500); j++) st.put(new Blob([body]), `https://tiles.openfreemap.org/test/${j}.pbf`); t.oncomplete = ok; t.onerror = ok; });
          return;
        }
        const c = await caches.open(where === "cache" ? "tf-offline-1" : where), pend = [];
        for (let i = 0; i < n; i += 250) await Promise.all(Array.from({ length: Math.min(250, n - i) }, (_, j) => c.put(`https://tiles.openfreemap.org/test/${i + j}.pbf`, new Response(body))));
      }, [fill, where]);
      await wait(2000);
    }
    await ctx.close();
    const t = { sw: [], first: [], html: [], dcl: [], ok: 0 };
    for (let r = 0; r < RUNS; r++) {
      // A new browser each time, like the app starting again: nothing kept in memory, only what's saved.
      ctx = await open(dir); page = ctx.pages()[0] || await ctx.newPage();
      await page.goto(site, { waitUntil: "load", timeout: 120000 });
      const n = await page.evaluate(() => { const e = performance.getEntriesByType("navigation")[0]; return { sw: e.workerStart, first: e.responseStart, html: e.responseEnd, dcl: e.domContentLoadedEventEnd, ctl: !!(navigator.serviceWorker && navigator.serviceWorker.controller) }; });
      for (const k of ["sw", "first", "html", "dcl"]) t[k].push(Math.round(n[k] || -1));
      if (n.ctl) t.ok++;
      await ctx.close();
    }
    await rm(dir, { recursive: true, force: true });
    const row = { label, fill: fill ? `${fill} (${where})` : 0, sw: mid(t.sw), first: mid(t.first), html: mid(t.html), dcl: mid(t.dcl), under: `${t.ok}/${RUNS}`, all: t.html.join(" ") };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  server.close();
}

const md = [`## Opening speed with Offline maps saved (${BROWSER === "webkit" ? "Safari engine" : BROWSER}, middle of ${RUNS} opens, ms)`, "",
  "| Version | Saved offline files | Helper started | Page first bytes | Page arrived | Scripts started | Opened by the helper | Each open: page arrived |",
  "|---|---:|---:|---:|---:|---:|---:|---|",
  ...rows.map((r) => `| ${r.label} | ${r.fill} | ${r.sw} | ${r.first} | ${r.html} | ${r.dcl} | ${r.under} | ${r.all} |`)].join("\n");
console.log("\n" + md);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n");
