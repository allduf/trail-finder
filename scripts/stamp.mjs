// Gets the website ready to publish, so pull requests never edit shared numbers or shared lines (alex, 2026-11-19:
// "Most merge clashes today came from version numbers. A small script could set them at merge time").
// Run by pages.yml on the copy it publishes, and by phone-test.yml (--test) on the pull request. Never commit what it
// writes: it changes files in place.
//   1. Version: every "?v=__V__" in the site's own pages and scripts, and sw.js's "tf-__V__", become one number.
//      The number is 10000 + the number of changes merged into main (git rev-list --count --first-parent HEAD), so it
//      goes up by one with every merge, stays the same when only the data jobs publish again (their files aren't in
//      main), and is above the old hand-set numbers (last one ?v=5460 / tf-5260). usage.js and notify.js log it.
//   2. What's new: each data/changelog.d/*.json ({ "date": "YYYY-MM-DD", "text": "..." }, or a list of them) is put
//      into data/changelog.json, newest date first; on the same date the most recently added file goes first.
//   3. French: i18n-fr.js is made from scripts/i18n/ (node scripts/i18n/build.mjs). It is no longer kept in git.
// Before any of that it checks that nobody put a number back by hand (?v=5470 in index.html...): that fails.
// Usage: node scripts/stamp.mjs            publish (needs main's history: checkout with fetch-depth 0)
//        node scripts/stamp.mjs --test     pull request test: number 1
//        node scripts/stamp.mjs --check    the checks only, changes nothing
//        node scripts/stamp.mjs --version N
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const args = process.argv.slice(2);
const TOKEN = "__V__", BASE = 10000, LOG_DIR = "data/changelog.d";
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const read = (f) => readFileSync(join(root, f), "utf8");
const fail = (msg) => { console.error(`::error::${msg}`); process.exit(1); };

// The site's own pages and scripts (top level; vendor/ libraries have their own fixed versions).
const siteFiles = readdirSync(root).filter((f) => /\.(html|js)$/.test(f));

// ---- checks ----
const problems = [];
for (const f of siteFiles) {
  const s = read(f);
  for (const m of s.matchAll(/["'(]([\w./-]+\.(?:js|css|json))\?v=(\d+)/g)) {
    if (f === "map3d.js" && /^winter-hd\.js$/.test(m[1])) continue;   // the Winter photos' own tag, not the site's
    if (["index.html", "ride.html", "usage.html", "sw.js"].includes(f)) problems.push(`${f}: ${m[1]}?v=${m[2]} (write ?v=${TOKEN})`);
  }
}
if (!/const VERSION = "tf-__V__"/.test(read("sw.js"))) problems.push(`sw.js: VERSION must be "tf-${TOKEN}"`);
const logFiles = existsSync(join(root, LOG_DIR)) ? readdirSync(join(root, LOG_DIR)).filter((f) => f.endsWith(".json")).sort() : [];
const logItems = new Map();
for (const f of logFiles) {
  let j;
  try { j = JSON.parse(read(`${LOG_DIR}/${f}`)); } catch (e) { problems.push(`${LOG_DIR}/${f}: not valid JSON (${e.message})`); continue; }
  const list = Array.isArray(j) ? j : [j];
  for (const it of list) {
    if (!it || !/^\d{4}-\d{2}-\d{2}$/.test(it.date || "") || typeof it.text !== "string" || !it.text.trim())
      problems.push(`${LOG_DIR}/${f}: each line needs { "date": "YYYY-MM-DD", "text": "..." }`);
  }
  logItems.set(f, list.map((it) => ({ date: it.date, text: it.text })));
}
if (problems.length) fail(`Version numbers and What's new are set when the site is published (scripts/stamp.mjs):\n  ` +
  problems.slice(0, 12).join("\n  ") + (problems.length > 12 ? `\n  ... and ${problems.length - 12} more` : ""));
if (args.includes("--check")) { console.log(`stamp check ok (${logFiles.length} What's new file(s))`); process.exit(0); }

// ---- 1. version ----
let version;
const vi = args.indexOf("--version");
if (vi >= 0) version = parseInt(args[vi + 1], 10);
else if (args.includes("--test")) version = 1;
else {
  if (git("rev-parse", "--is-shallow-repository") === "true") fail("stamp.mjs needs main's history (actions/checkout with fetch-depth: 0).");
  version = BASE + parseInt(git("rev-list", "--count", "--first-parent", "HEAD"), 10);
}
if (!Number.isInteger(version) || version < 1) fail(`bad version: ${version}`);
let stamped = 0;
for (const f of siteFiles) {
  const s = read(f), t = s.replaceAll(`?v=${TOKEN}`, `?v=${version}`).replaceAll(`"tf-${TOKEN}"`, `"tf-${version}"`);
  if (t !== s) { writeFileSync(join(root, f), t); stamped++; }
}
if (!read("index.html").includes(`?v=${version}`) || !read("sw.js").includes(`"tf-${version}"`)) fail("index.html / sw.js weren't stamped");

// ---- 2. What's new ----
let added = 0;
if (logFiles.length) {
  // when each file came into main (newest first); a copy without history keeps them by name
  const when = new Map();
  try {
    let t = 0;
    for (const line of git("log", "--diff-filter=A", "--format=@%ct", "--name-only", "--", LOG_DIR).split("\n")) {
      if (line.startsWith("@")) t = +line.slice(1);
      else if (line.trim()) { const f = line.trim().slice(LOG_DIR.length + 1); if (!when.has(f)) when.set(f, t); }
    }
  } catch { /* no history */ }
  const order = [...logFiles].sort((a, b) => (when.get(b) || 0) - (when.get(a) || 0) || b.localeCompare(a));
  const fresh = order.flatMap((f) => logItems.get(f));
  const log = JSON.parse(read("data/changelog.json"));
  const all = [...fresh, ...log.items].map((it, i) => ({ it, i }));
  all.sort((a, b) => b.it.date.localeCompare(a.it.date) || a.i - b.i);   // newest date first, otherwise as above
  log.items = all.map((x) => x.it);
  added = fresh.length;
  const items = log.items.map((it) => `    {"date": ${JSON.stringify(it.date)}, "text": ${JSON.stringify(it.text)}}`).join(",\n");
  const { items: _, ...head } = log;
  const top = JSON.stringify(head, null, 2).replace(/\n}$/, "");
  writeFileSync(join(root, "data/changelog.json"), `${top},\n  "items": [\n${items}\n  ]\n}\n`);
  JSON.parse(read("data/changelog.json"));
}

// ---- 3. French ----
execFileSync("node", ["scripts/i18n/build.mjs"], { cwd: root, stdio: "inherit" });
execFileSync("node", ["--check", "i18n-fr.js"], { cwd: root });

console.log(`stamped ?v=${version} / tf-${version} in ${stamped} files; What's new: ${added} line(s) from ${LOG_DIR}/`);
