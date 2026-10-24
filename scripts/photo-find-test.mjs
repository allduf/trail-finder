// Photo find accuracy test (see .github/workflows/photo-find-test.yml): runs real pictures through "Which trail is
// this?" in a real browser and checks the app finds the right trail, so every change to photo find can be measured.
//
// The test pictures are the ones riders confirmed with "Yes, that's it" (supabase/trail-matches.sql): the newest
// confirmed picture of each trail (pictures found by their GPS spot only when there aren't enough others, since the
// copy saved has no GPS left in it). Each one runs with its own confirmed match left out everywhere (the app's
// same-picture and similar-words lookups, and the function's confirmed pictures), so the app can't just remember it.
// More "Yes" answers = a bigger test. Results go to the job summary and to a GitHub issue "Photo find accuracy", with
// the past runs; when fewer trails are found than last time, a comment mentions OWNER (GitHub emails them).
//
// Run: SUPABASE_SECRET_KEY=... node scripts/photo-find-test.mjs   (needs the playwright package and its Chromium)
// Optional: CASES (how many pictures, 10), CHROMIUM (a browser to use), GITHUB_TOKEN + GITHUB_REPOSITORY (update the issue), OWNER (allduf).
// The page is served from this checkout on localhost (the function lets localhost in); files it doesn't have
// (nightly data kept elsewhere) come from the live site.

import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fohdmserpbkurcvcrbbb.supabase.co";
const KEY = process.env.SUPABASE_SECRET_KEY;
const LIVE = "https://allduf.github.io/trail-finder/";
const CASES = Math.max(1, +(process.env.CASES || 10));
const WAIT_MS = 200_000;          // one picture: reading words + the AI look (45 s) + the online check (80 s), with room
const GAP_MS = +(process.env.GAP_S || 20) * 1000;   // a pause between pictures: the free AI allows only so many asks a minute
const REPO = process.env.GITHUB_REPOSITORY, TOKEN = process.env.GITHUB_TOKEN, OWNER = process.env.OWNER || "allduf";
const GITHUB_API = process.env.GITHUB_API_URL || "https://api.github.com";
const TITLE = "Photo find accuracy";
if (!KEY) { console.log("No SUPABASE_SECRET_KEY secret: nothing to test."); process.exit(0); }

const headers = { apikey: KEY, ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }) };
async function supa(path) {
  const r = await fetch(SUPABASE_URL + path, { headers });
  if (!r.ok) throw new Error(`Supabase ${path.split("?")[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r;
}
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// ---------- the test pictures ----------
const rows = await (await supa("/rest/v1/trail_matches?select=id,trail_name,zone,lat,lon,method,photo,created_at,hash:details->>hash&photo=not.is.null&order=created_at.desc&limit=500")).json();
// One picture per trail (same name within 5 km: older matches saved the area's name instead of its id).
const km = (a, b) => Math.hypot(a.lat - b.lat, (a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180)) * 111.2;
const perTrail = [];
for (const r of rows) {
  const i = perTrail.findIndex((x) => norm(x.trail_name) === norm(r.trail_name) && (x.lat == null || r.lat == null || km(x, r) < 5));
  if (i < 0) perTrail.push(r);
  else if (perTrail[i].method === "gps" && r.method !== "gps") perTrail[i] = r;
}
const cases = [...perTrail].sort((a, b) => (a.method === "gps") - (b.method === "gps") || b.created_at.localeCompare(a.created_at)).slice(0, CASES);
// The same picture confirmed more than once (resized or recompressed too) is left out with it: only other pictures count.
const bits = (a, b) => { let n = 0; for (let i = 0; i < 16; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { n += x & 1; x >>= 1; } } return n; };
const hashOk = (h) => typeof h === "string" && /^[0-9a-f]{16}$/.test(h);
for (const c of cases) c.skip = [c.id, ...rows.filter((r) => r.id !== c.id && hashOk(c.hash) && hashOk(r.hash) && bits(c.hash, r.hash) <= 10).map((r) => r.id)].slice(0, 20);
console.log(`${rows.length} confirmed pictures, ${perTrail.length} trails; testing ${cases.length}.`);
if (!cases.length) { console.log("No confirmed pictures yet: tap \"Yes, that's it\" after a photo search to add some."); process.exit(0); }
const dir = await mkdtemp(join(tmpdir(), "pf-"));
for (const c of cases) {
  const r = await supa("/storage/v1/object/trail-match-photos/" + c.photo.split("/").map(encodeURIComponent).join("/"));
  c.file = join(dir, c.id + ".jpg");
  await writeFile(c.file, Buffer.from(await r.arrayBuffer()));
}

// ---------- the site, on localhost ----------
const root = fileURLToPath(new URL("../", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = normalize(join(root, path));
  try {
    if (!file.startsWith(root)) throw new Error("outside");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }).end(body);
  } catch {
    try {
      const r = await fetch(LIVE + path);
      res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream" }).end(Buffer.from(await r.arrayBuffer()));
    } catch { res.writeHead(502).end(); }
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const SITE = `http://localhost:${server.address().port}/index.html`;

// ---------- each picture through the app ----------
const { chromium } = await import("playwright");
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const results = [];
for (const [i, c] of cases.entries()) {
  if (i) await new Promise((ok) => setTimeout(ok, GAP_MS));
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await page.addInitScript((skip) => { window.tfPhotoTest = { skip }; }, c.skip);
  const t0 = Date.now();
  let got = null, err = "";
  try {
    await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(() => window.tfPhotoFind && window.tfAccount, null, { timeout: 60_000 });
    await page.evaluate(() => window.tfPhotoFind.open());
    await page.setInputFiles("#pfFile", c.file);
    await page.waitForFunction(() => window.tfPhotoTest.finished, null, { timeout: WAIT_MS, polling: 1000 }).catch(() => { err = "didn't finish in time"; });
    got = await page.evaluate(() => window.tfPhotoTest.result || null);
  } catch (e) { err = String(e.message || e).split("\n")[0].slice(0, 160); }
  await page.close();
  const list = got ? got.rows : [];
  const rank = list.findIndex((r) => norm(r.name) === norm(c.trail_name)) + 1;   // 0 = not in the list
  const r = { id: c.id, trail: c.trail_name, zone: c.zone, method: c.method, rank, top: list.slice(0, 3).map((x) => x.name), s: Math.round((Date.now() - t0) / 1000),
    ai: !!(got && got.diag && got.diag.ai), how: err || how(got && got.diag, c), broken: !got };
  results.push(r);
  console.log(`${r.rank === 1 ? "✓" : r.rank ? "~" : "✗"} ${r.trail} (${r.zone}): ${r.rank ? "#" + r.rank : "not listed"}, top: ${r.top.join(", ") || "nothing"} (${r.s} s)\n    ${r.how}`);
  if (got && got.diag && got.diag.cmp && got.diag.cmp.detail) console.log(`    online check notes: ${got.diag.cmp.detail}`);
}
await browser.close();
server.close();

// What each step found, for working out why a picture failed. Only counts, place and landmark names and distances: the
// pictures' own words stay private (this repository and its logs are public).
function how(d, c) {
  if (!d) return "no search ran";
  const out = [`${d.words} words read`];
  if (!d.ai) out.push(`AI skipped (${d.why || "?"}${d.detail ? ": " + d.detail : ""})`);
  else {
    const a = d.ai, vp = a.vp && c.lat != null ? km({ lat: a.vp.lat, lon: a.vp.lon }, c).toFixed(1) : null;
    out.push(`AI${a.model ? " (" + a.model + ")" : ""}: ${[a.places.length ? "places " + a.places.join(", ") : "", a.landmarks.length ? "landmarks " + a.landmarks.join(", ") : "",
      (a.views || []).length ? "seen across the picture " + a.views.map((v) => `${v.name} ${v.x}`).join(", ") : "",
      a.guesses.length ? "guesses " + a.guesses.join(", ") : "", (a.terrain || []).length ? "terrain " + a.terrain.slice(0, 5).join(", ") : ""].filter(Boolean).join("; ") || "nothing named"}` +
      (vp ? `; placed it ${vp} km from the trail (it said ±${a.vp.km} km${a.vp.alt ? `, ${a.vp.alt} m up` : ""})` : "; no spot"), `reverse search: ${a.rev}`);
  }
  if (d.before) {
    const b = d.before.findIndex((n) => norm(n) === norm(c.trail_name)) + 1;
    // The online check's fit for this trail and its best one; when it had no AI answer, why (each model's note, shortened).
    const fits = (d.cmp && d.cmp.ranks) || [], mine = fits.find(([t]) => norm(t) === norm(c.trail_name)), top = [...fits].sort((x, y) => y[1] - x[1])[0];
    const notes = d.cmp && d.cmp.detail ? ` [${d.cmp.detail.length > 220 ? d.cmp.detail.slice(0, 220) + "…" : d.cmp.detail}]` : "";
    out.push(`online check got ${d.before.length} trails${b ? `, this one ${b}${b === 1 ? "st" : b === 2 ? "nd" : b === 3 ? "rd" : "th"}` : ", not this one"}` +
      (d.cmp ? (d.cmp.ok ? ` → ${d.cmp.searched ? "searched" : "no search (" + d.cmp.noSearch + ")"}, ${d.cmp.photos} photos` +
        (mine ? `, fit ${mine[1]} for this one` : "") + (top && (!mine || top[0] !== mine[0]) ? ` (best: ${top[0]} ${top[1]})` : "") +
        `${d.cmp.close.length ? ", close: " + d.cmp.close.join(", ") : ""}` : ` → skipped (${d.cmp.why || d.cmp.noSearch || "?"})`) + notes : ""));
  }
  return out.join(" · ");
}

// ---------- the report ----------
const n = results.length, first = results.filter((r) => r.rank === 1).length, top3 = results.filter((r) => r.rank && r.rank <= 3).length;
const listed = results.filter((r) => r.rank).length;
const day = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
const withAi = results.filter((r) => r.ai).length;
const run = { at: day + (process.env.LABEL ? " (" + process.env.LABEL + ")" : ""), n, first, top3, listed, ai: withAi };
const pct = (k) => `${Math.round((k / n) * 100)}%`;
const esc = (s) => String(s).replace(/[|\\`*_[\]<>#]/g, "\\$&");
const table = `| Trail | Area | Found at | App's top 3 | What happened | Time |\n|---|---|---|---|---|---|\n` + results.map((r) =>
  `| ${esc(r.trail)} | ${esc(r.zone || "")} | ${r.rank === 1 ? "✅ 1st" : r.rank ? `🟡 ${r.rank}${r.rank === 2 ? "nd" : r.rank === 3 ? "rd" : "th"}` : "❌ not listed"} | ${esc(r.top.join(", ") || "nothing")} | ${esc(r.how)} | ${r.s} s |`).join("\n");
const summary = `**${run.at}**: ${n} confirmed pictures. Right trail first: **${first} (${pct(first)})**, in the top 3: **${top3} (${pct(top3)})**, listed at all: ${listed} (${pct(listed)}).` +
  (withAi < n ? ` The AI answered for ${withAi} of ${n} (the free AI was busy or used up for the others), so this run says less.` : "") + `\n\n${table}\n`;
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## ${TITLE}\n\n${summary}`);

async function github(path, method = "GET", body) {
  const r = await fetch(`${GITHUB_API}/repos/${REPO}${path}`, { method, body: body && JSON.stringify(body),
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "trail-finder photo find test", ...(body && { "Content-Type": "application/json" }) } });
  if (!r.ok) throw new Error(`GitHub said ${r.status} for ${method} ${path}: ${await r.text()}`);
  return r.json();
}
if (TOKEN && REPO) {
  const open = await github(`/issues?state=open&per_page=100`).catch(() => []);
  let issue = open.find((i) => i.title === TITLE);
  const past = issue ? JSON.parse((issue.body || "").match(/<!-- runs:(.*?) -->/)?.[1] || "[]") : [];
  const runs = [...past, run].slice(-30);
  const history = `| Run | Pictures | Right trail first | In the top 3 | Listed | AI answered |\n|---|---|---|---|---|---|\n` +
    [...runs].reverse().map((x) => `| ${x.at} | ${x.n} | ${x.first} (${Math.round(x.first / x.n * 100)}%) | ${x.top3} (${Math.round(x.top3 / x.n * 100)}%) | ${x.listed} | ${x.ai ?? "?"} |`).join("\n");
  const body = `How well "Which trail is this?" finds the trail in pictures riders confirmed (scripts/photo-find-test.mjs). ` +
    `Every "Yes, that's it" in the app adds a test picture.\n\n## Latest run\n\n${summary}\n## All runs\n\n${history}\n\n<!-- runs:${JSON.stringify(runs)} -->`;
  if (issue) await github(`/issues/${issue.number}`, "PATCH", { body });
  else issue = await github(`/issues`, "POST", { title: TITLE, body });
  const prev = past[past.length - 1];
  // Worse than last time on the same number of pictures (or a share drop on a different number): tell OWNER. Only when the
  // AI answered for every picture in both runs: a run where the free AI was used up isn't a step back in the app.
  if (prev && prev.ai === prev.n && withAi === n && (prev.n === n ? top3 < prev.top3 : top3 / n < prev.top3 / prev.n - 0.1))
    await github(`/issues/${issue.number}/comments`, "POST", { body: `@${OWNER} photo find got worse: ${top3} of ${n} pictures had the right trail in the top 3 (last run: ${prev.top3} of ${prev.n}). Details in the description.` });
  console.log(`Issue #${issue.number} updated.`);
}
if (!n || results.every((r) => r.broken)) process.exit(1);   // the app didn't run at all: the job shows red
