// Bike park map watch (see .github/workflows/watch-park-maps.yml): tells alex when a bike park's
// official trail map or trail list changes, so the grades and directions taken from it
// (the HAND lists in ratings.js and directions.js) can be checked again.
//
// For each source below it reads the map (PDF text, or the page's text plus the class names and
// icon file names that carry grades), and remembers a 5-character fingerprint of every line in the
// issue "Bike park maps changed". When lines appear or vanish it comments on that issue,
// mentioning OWNER so GitHub emails them: the new lines, how many went, the trails graded from
// that source it named last time but not now, and any newer year of a dated map (…-2026.pdf → …-2027.pdf).
// Open/closed words, times and dates are left out, so day-to-day trail reports don't count as changes.
//
// Run: OWNER=allduf GITHUB_TOKEN=... GITHUB_REPOSITORY=allduf/trail-finder node scripts/watch-park-maps.mjs
// Without GITHUB_TOKEN it only prints what it would post (PARK_STATE=file keeps fingerprints between test runs). Needs pdftotext (poppler-utils) for PDFs.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SOURCES = [
  { park: "Whistler Mountain Bike Park", url: "https://cdn.whistler.com/s3/pdf/maps/whistler-mountain-bike-park-trail-map-2026.pdf" },
  { park: "Fernie", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
  { park: "Panorama", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
  { park: "SilverStar", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
  { park: "Big White", url: "https://www.bigwhite.com/summer/bike-park-trail-map" },
  { park: "Big White (progression chart)", url: "https://www.bigwhite.com/sites/default/files/inline-images/BBW-Trail-Progression-350x713px.png" },
  { park: "Sun Peaks", url: "https://www.sunpeaksresort.com/bike-hike/bike/lift-trail-status" },
  { park: "Revelstoke", url: "https://www.revelstokemountainresort.com/mountain/conditions/trail-report/" },
  { park: "Kicking Horse", url: "https://kickinghorseresort.com/conditions/trail-report/", cookie: "oshsSeason=summer" },   // the bike list only shows in summer mode
  { park: "Kicking Horse (bike park map)", url: "https://kickinghorseresort.com/wp-content/uploads/2024/05/6198531806-KHmap-24-brochure.pdf" },
  { park: "WinSport (Calgary)", url: "https://www.winsport.ca/assets/PDFs/Maps/2026/2026-WinSport-Summer-Trail-Map.pdf" },
  { park: "Mount Washington", url: "https://mountwashington.ca/summer/bike-park" },
  { park: "RED Mountain", url: "https://www.redresort.com/wp-content/uploads/2020/09/red-mtn-bike-park-trail-map-website-v12.1.jpg" },
  // Riding hubs and MTB centres
  { park: "Coast Gravity Park", url: "https://www.coastgravitypark.ca/trails" },
  { park: "Golden Cycling Club trails", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
  { park: "Whistler, Lost Lake Park", url: "https://www.whistler.ca/wp-content/uploads/2025/LostLake_Pamphlet-Map_Dec.2024.pdf" },
  { park: "Whistler Interpretive Forest (Cheakamus)", url: "https://www.whistler.ca/wp-content/uploads/2025/Whistler-Interpretive-Forest_Pamphlet-Map_Dec.2024.pdf" },
  { park: "Kamloops Bike Ranch", url: "https://kamloops.ca/sites/default/files/Trail%20Map_Facility%20Overview.pdf" },
  { park: "Kenna Cartwright Nature Park (Kamloops)", url: "https://www.kamloops.ca/sites/default/files/2025-11/OPS_Signage_PKS_Maps_KennaCartwrightTrails_KioskSign_92x43_Aug2025_FINAL-WEB.pdf" },
  { park: "Canmore Nordic Centre", url: "https://albertaparks.ca/media/3996277/summer-trails-map.pdf" },
  { park: "Banff (Parks Canada)", url: "https://parks.canada.ca/pn-np/ab/banff/activ/cyclisme-biking/velomontagne-mountainbiking/banff" },
];

const OWNER = process.env.OWNER || "allduf";
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = process.env.GITHUB_API_URL || "https://api.github.com";
const UA = "Mozilla/5.0 (trail-finder bike park map watch; https://github.com/allduf/trail-finder)";
const TITLE = "Bike park maps changed";
const MARKER = "<!-- park-map-watch -->";
const MAX_NEW = 25; // new lines shown per source

async function github(path, method = "GET", body) {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": UA, ...(body && { "Content-Type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status} for ${method} ${path}: ${await res.text()}`);
  return res.json();
}

const md = (s) => String(s).replace(/[\\`*_[\]<>|#]/g, "\\$&").replace(/\s+/g, " ").trim();
const fp = (s) => createHash("sha1").update(s).digest("base64url").slice(0, 5);
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Words and bits that change from day to day on trail reports, not when the map changes.
const NOISE = /\b(open|opened|opening|closed|closing|on hold|scheduled|pending|groomed|status|updated?|last update|today|yesterday|tomorrow|now)\b|\d{1,2}:\d{2}\s*(am|pm)?|\b\d{1,2}\s*(am|pm)\b|-?\d+(\.\d+)?\s*°\s*[cf]?|\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{1,2}(,\s*\d{4})?|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/gi;
function clean(lines) {
  const out = new Set();
  for (let l of lines) {
    l = l.replace(NOISE, " ").replace(/\s+/g, " ").trim();
    if ((l.match(/[a-z]/gi) || []).length >= 3) out.add(l);
  }
  return [...out];
}

function pageLines(html) {
  // Trail lists some club sites keep in page data: {"name":"Gold Rush","number":12,"difficulty":"blue",...}
  const data = [...html.matchAll(/"name":"([^"]{2,80})"[^{}]{0,60}?"difficulty":"(\w+)"/g)].map((m) => `${m[1]}: ${m[2]}`);
  html = html.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  // Grades often live only in class names (cat-3-level, black-diamond) or icon files: keep those as text.
  html = html.replace(/<img\b[^>]*>/gi, (t) => {
    const src = (t.match(/\bsrc="([^"]+)"/i) || [])[1] || "", alt = (t.match(/\balt="([^"]*)"/i) || [])[1] || "";
    return ` [${alt || src.split("/").pop().split("?")[0]}] `;
  });
  html = html.replace(/<[a-z][^>]*\bclass="([^"]*(?:level|diff|rating|grade|green|blue|black|double|expert|pro)[^"]*)"[^>]*>/gi, " [$1] ");
  const text = html.replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d|\/td|\/th)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&#8217;/g, "'").replace(/&[a-z]+;|&#\d+;/g, " ");
  return [...text.split("\n"), ...data];
}

const dir = mkdtempSync(join(tmpdir(), "parkmaps-"));
function pdfLines(buf) {
  const f = join(dir, "map.pdf");
  writeFileSync(f, buf);
  return execFileSync("pdftotext", ["-layout", f, "-"], { maxBuffer: 64 << 20 }).toString().split("\n")
    .flatMap((l) => l.split(/\s{3,}/)); // layout columns become separate lines
}

async function read(url, cookie) {
  const res = await fetch(url, { headers: { "User-Agent": UA, ...(cookie && { Cookie: cookie }) }, redirect: "follow" });
  if (!res.ok) throw new Error(`the site said ${res.status}`);
  const type = res.headers.get("content-type") || "", buf = Buffer.from(await res.arrayBuffer());
  if (/pdf/i.test(type) || /\.pdf($|\?)/i.test(url)) return { lines: clean(pdfLines(buf)) };
  if (/^image\//i.test(type)) return { lines: [`picture ${fp(buf)}`], picture: true }; // a picture: any change counts
  return { lines: clean(pageLines(buf.toString("utf8"))) };
}

// A dated map (…2026…pdf): is there one for a later year at the same address?
async function newerYear(url) {
  const years = [...new Set(url.match(/20\d\d/g) || [])];
  if (!years.length) return null;
  const now = new Date().getFullYear();
  for (let y = now + 1; y > Math.max(...years); y--) {
    let next = url;
    for (const old of years) next = next.replaceAll(old, String(y + (old - Math.max(...years))));
    try {
      const res = await fetch(next, { method: "HEAD", headers: { "User-Agent": UA }, redirect: "follow" });
      if (res.ok && !/text\/html/i.test(res.headers.get("content-type") || "")) return next;
    } catch {}
  }
  return null;
}

// Trails graded from this source in ratings.js (one entry per line there).
const ratings = readFileSync(new URL("../ratings.js", import.meta.url), "utf8").split("\n");
const gradedFrom = (url) => ratings.filter((l) => l.includes(`url: "${url}"`)).map((l) => (l.match(/name: "([^"]+)"/) || [])[1]).filter(Boolean);

function body(state) {
  return `${MARKER}\nThis issue lists changes to the bike park maps and trail lists that Trail Finder's grades and directions come from ` +
    `(the HAND lists in \`ratings.js\` and \`directions.js\`). A GitHub job reads them every 2 weeks from May to October and on the 1st of ` +
    `each month the rest of the year, and comments here mentioning @${OWNER} when one changes. Sources: \`scripts/watch-park-maps.mjs\`.\n\n` +
    `<!-- state:${JSON.stringify(state)} -->`;
}

async function findIssue() {
  for (let page = 1; page <= 10; page++) {
    const issues = await github(`/issues?state=all&creator=${encodeURIComponent("github-actions[bot]")}&per_page=100&page=${page}`);
    const hit = issues.find((i) => !i.pull_request && (i.body || "").includes(MARKER));
    if (hit || issues.length < 100) return hit;
  }
}

const issue = TOKEN && await findIssue();
const LOCAL = !TOKEN && process.env.PARK_STATE; // test without GitHub: keep the fingerprints in this file
const old = issue ? JSON.parse(((issue.body || "").match(/<!-- state:(.*) -->/) || [])[1] || "{}")
  : LOCAL ? JSON.parse((() => { try { return readFileSync(LOCAL, "utf8"); } catch { return "{}"; } })()) : {};
const state = {}, report = [];

for (const s of SOURCES) {
  const link = `[${md(s.park)}](${s.url})`;
  let got;
  try { got = await read(s.url, s.cookie); }
  catch (e) {
    state[s.url] = old[s.url];
    if (old[s.url]) report.push(`- **${link}**: couldn't read it this time (${md(e.message)}). It may have moved.`);
    console.log(`${s.park}: couldn't read (${e.message})`);
    continue;
  }
  const all = fold(got.lines.join(" "));
  const named = got.picture ? [] : gradedFrom(s.url).filter((n) => all.includes(fold(n)));
  const prints = got.lines.map(fp), before = old[s.url] ? new Set(old[s.url].p) : null;
  state[s.url] = { p: prints, n: named };
  const newer = await newerYear(s.url);
  const parts = [];
  if (newer) parts.push(`a newer map is up: ${newer}`);
  if (before) {
    const now = new Set(prints);
    const added = got.lines.filter((l, i) => !before.has(prints[i]));
    const gone = [...before].filter((p) => !now.has(p)).length;
    if (got.picture && (added.length || gone)) parts.push("the picture changed");
    else if (added.length || gone) {
      parts.push(`${added.length} new line${added.length === 1 ? "" : "s"}, ${gone} gone`);
      if (added.length) parts.push("New:\n" + added.slice(0, MAX_NEW).map((l) => `  - ${md(l)}`).join("\n") + (added.length > MAX_NEW ? `\n  - …and ${added.length - MAX_NEW} more` : ""));
    }
    const missing = (old[s.url].n || []).filter((n) => !named.includes(n));
    if (missing.length) parts.push(`Graded from here, but no longer named in it: ${missing.map(md).join(", ")}`);
  }
  console.log(`${s.park}: ${got.lines.length} lines${before ? "" : " (first look)"}${parts.length ? ` — ${parts[0]}` : ""}`);
  if (parts.length) report.push(`- **${link}**: ` + parts.map((p) => p.startsWith("New:") ? p.replace(/\n {2}- /g, "\n    - ") : p).join("\n  "));
}

if (LOCAL) writeFileSync(LOCAL, JSON.stringify(state));
if (!TOKEN) { console.log(report.length ? `Would post:\n\n${report.join("\n")}` : "Nothing changed."); process.exit(0); }
if (!issue) {
  const created = await github("/issues", "POST", { title: TITLE, body: body(state), assignees: [OWNER] });
  console.log(`Opened issue #${created.number}; the next run compares against today's maps.`);
} else {
  if (report.length) {
    await github(`/issues/${issue.number}/comments`, "POST", {
      body: `@${OWNER}, some bike park maps changed. Check the grades and directions taken from them:\n\n${report.join("\n")}`,
    });
  }
  await github(`/issues/${issue.number}`, "PATCH", { body: body(state) });
  console.log(report.length ? `Reported ${report.length} change(s) on issue #${issue.number}.` : "No changes.");
}
