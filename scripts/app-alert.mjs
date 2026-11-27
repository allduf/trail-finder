// Quick crash and error alert (see .github/workflows/app-alert.yml): every 15 minutes, reads the crashes and errors the
// app sent since the last check (usage.js → supabase/usage.sql, the same data as usage.html's Problems tab) and, when
// there is a crash restart or a kind of error not seen in the 14 days before, comments on the GitHub issue
// "New crash or error alerts" with a mention of OWNER, so GitHub emails alex and its phone app sends a notice within
// minutes (alex 2026-11-27: crashes were only found by looking at the usage page). The daily "App errors" issue
// (app-errors.mjs) still gives the full picture each morning.
//
// As on usage.html, test and review devices are left out (scripts/test-devices.mjs) and cancelled downloads aren't
// faults. alex's own phone still alerts (its crashes are real too). The issue is public: phones by model only, never by name or device code, and no web
// addresses' query strings.
// The last event id checked is kept in the issue's text, so each crash or error is looked at once, even when it
// arrives late (a phone sends its queue at the next visit). A row whose insert commits after a later id was read can be
// missed here (rare: two phones sending at the same moment); the daily "App errors" issue still lists it.
//
// Run: SUPABASE_SECRET_KEY=... node scripts/app-alert.mjs
// Optional: DRY=1 (print only, no issue), HOURS (on a dry run: look back this many hours, default 24),
// GITHUB_TOKEN + GITHUB_REPOSITORY (the issue), OWNER (allduf).

import { appendFile } from "node:fs/promises";
import { isTestDevice } from "./test-devices.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fohdmserpbkurcvcrbbb.supabase.co";
const KEY = process.env.SUPABASE_SECRET_KEY;
const REPO = process.env.GITHUB_REPOSITORY, TOKEN = process.env.GITHUB_TOKEN, OWNER = process.env.OWNER || "allduf";
const DRY = !!process.env.DRY || !REPO || !TOKEN;
const HOURS = Math.max(1, +(process.env.HOURS || 24));
const TITLE = "New crash or error alerts", MARK = "<!-- trail-finder-app-alert -->";
const LAST = /<!-- last-id: (\d+) -->/;
const KNOWN_DAYS = 14;
const SPORTS = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", fish: "Fishing", moto: "Adventure moto", hike: "Hiking" };
if (!KEY) { console.log("No SUPABASE_SECRET_KEY secret: nothing to read."); process.exit(0); }

const headers = { apikey: KEY, ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }) };
async function rows(path) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
    if (!r.ok) throw new Error(`Supabase ${path.split("?")[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    const page = await r.json();
    all.push(...page);
    if (page.length < 1000) return all;
  }
}
async function github(path, method = "GET", body) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method, body: body && JSON.stringify(body),
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "trail-finder-app-alert" },
  });
  if (!r.ok) throw new Error(`GitHub ${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
// The alert issue: the bot's issue that carries MARK, looked for page by page (other workflows open issues too).
async function findIssue() {
  for (let page = 1; page <= 20; page++) {
    const list = await github(`/issues?state=all&creator=${encodeURIComponent("github-actions[bot]")}&per_page=100&page=${page}`);
    const hit = list.find((i) => !i.pull_request && (i.body || "").includes(MARK));
    if (hit || list.length < 100) return hit || null;
  }
  return null;
}
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const inList = (xs) => `(${xs.map((x) => `"${String(x).replace(/["\\]/g, "")}"`).join(",")})`;
// The same rules as app-errors.mjs: cancelled downloads aren't faults; an error is the same after a change moves its
// line number or script version.
const real = (e) => e.kind !== "error" || !/aborted|AbortError/i.test(e.what || "");
const key = (w) => String(w || "error").replace(/\?v=\d+/g, "").replace(/:\d+(:\d+)?\b/g, "").replace(/\s+/g, " ").trim();
const cell = (s) => String(s).replace(/https?:\/\/[^\s?#]+[?#]\S*/g, (u) => u.replace(/[?#].*/, "")).replace(/[|`<>@#]/g, " ").replace(/[\r\n]+/g, " ").trim();

// ---------- where the last check stopped ----------
let issue = null, lastId = null;
if (!DRY) {
  issue = await findIssue();
  const m = issue && LAST.exec(issue.body || "");
  if (m) lastId = +m[1];
}
const newest = (await rows("tf_use_events?select=id&order=id.desc&limit=1"))[0];
const top = newest ? newest.id : 0;
// First run: start from now, so old problems (already on usage.html) don't all alert at once. A dry run looks back HOURS.
const fresh = lastId != null
  ? await rows(`tf_use_events?select=id,device,at,kind,what,ms&kind=in.(crash,error)&id=gt.${lastId}&id=lte.${top}&order=id`)
  : DRY ? await rows(`tf_use_events?select=id,device,at,kind,what,ms&kind=in.(crash,error)&at=gte.${ago(HOURS)}&id=lte.${top}&order=id`) : [];

const devs = new Map();
const devList = [...new Set(fresh.map((e) => e.device))];
for (let i = 0; i < devList.length; i += 50)
  for (const d of await rows(`tf_use_devices?select=device,os,screen&device=in.${inList(devList.slice(i, i + 50))}`)) devs.set(d.device, d);
const people = fresh.filter((e) => real(e) && !isTestDevice(devs.get(e.device) || {}, e.at));

// ---------- crashes: every restart ----------
// One per restart: the app and the 3D map both notice the same one within a few seconds.
const restarts = [];
for (const c of people.filter((e) => e.kind === "crash").sort((a, b) => a.device.localeCompare(b.device) || a.at.localeCompare(b.at))) {
  const prev = restarts[restarts.length - 1];
  if (prev && prev.device === c.device && Date.parse(c.at) - Date.parse(prev.at) < 30e3) { if (/^3d/.test(c.what || "")) prev.what = c.what; continue; }
  restarts.push({ ...c });
}
// The app and the 3D map can send the two notices of one restart in different checks: drop a restart already seen.
if (restarts.length && lastId != null) {
  const from = new Date(Math.min(...restarts.map((c) => Date.parse(c.at))) - 30e3).toISOString();
  const seen = await rows(`tf_use_events?select=device,at&kind=eq.crash&id=lte.${lastId}&at=gte.${from}&order=id`);
  for (let i = restarts.length - 1; i >= 0; i--)
    if (seen.some((x) => x.device === restarts[i].device && Math.abs(Date.parse(x.at) - Date.parse(restarts[i].at)) < 30e3)) restarts.splice(i, 1);
}
restarts.sort((a, b) => a.at.localeCompare(b.at));
// "app · ski · native 3D · Map tab" → "app restart · Skiing · native 3D · Map tab"; "3d · ski · Winter" → "in the 3D map · Skiing · Winter".
const where = (w) => {
  const p = String(w || "").split(" · ");
  const inMap = p[0] === "3d" ? "in the 3D map" : "app restart";
  const rest = p.slice(1).map((x) => SPORTS[x] || x);
  return `${inMap}${rest.length ? ` · ${rest.join(" · ")}` : ""}`;
};
const model = (e) => { const d = devs.get(e.device) || {}; return cell(d.os || "unknown phone"); };
const version = (e) => (e.ms > 0 ? ` · version ${e.ms}` : "");
const time = (at) => `${String(at).slice(0, 16).replace("T", " ")} UTC`;
const crashLines = restarts.map((c) => `- ${time(c.at)}: crash, ${cell(where(c.what))} · ${model(c)}${version(c)}`);

// ---------- errors: only kinds not seen in the 14 days before ----------
const errs = people.filter((e) => e.kind === "error");
let newErrLines = [];
if (errs.length) {
  const firstId = Math.min(...errs.map((e) => e.id));
  const before = await rows(`tf_use_events?select=device,at,what&kind=eq.error&at=gte.${ago(KNOWN_DAYS * 24 + HOURS)}&id=lt.${firstId}&order=id`);
  const beforeDevs = [...new Set(before.map((e) => e.device))].filter((d) => !devs.has(d));
  for (let i = 0; i < beforeDevs.length; i += 50)
    for (const d of await rows(`tf_use_devices?select=device,os,screen&device=in.${inList(beforeDevs.slice(i, i + 50))}`)) devs.set(d.device, d);
  const known = new Set(before.filter((e) => real({ kind: "error", what: e.what }) && !isTestDevice(devs.get(e.device) || {}, e.at)).map((e) => key(e.what)));
  const groups = new Map();
  for (const e of errs) {
    const k = key(e.what);
    if (known.has(k)) continue;
    if (!groups.has(k)) groups.set(k, { e, n: 0, phones: new Set() });
    const g = groups.get(k); g.n++; g.phones.add(e.device);
  }
  newErrLines = [...groups.values()].map((g) => `- ${time(g.e.at)}: new error \`${cell(g.e.what)}\` · ${g.n} time${g.n > 1 ? "s" : ""} on ${g.phones.size} phone${g.phones.size > 1 ? "s" : ""} · ${model(g.e)}${version(g.e)}`);
}

// At most 30 lines each, so a crash wave stays under GitHub's comment size limit.
const MAX = 30;
const some = (xs) => (xs.length > MAX ? [...xs.slice(0, MAX), `- and ${xs.length - MAX} more on usage.html`] : xs);
const parts = [];
if (crashLines.length) parts.push(`**${crashLines.length} crash restart${crashLines.length > 1 ? "s" : ""}**`, ...some(crashLines), "");
if (newErrLines.length) parts.push(`**${newErrLines.length} new kind${newErrLines.length > 1 ? "s" : ""} of error** (not seen in the ${KNOWN_DAYS} days before)`, ...some(newErrLines), "");
const md = parts.join("\n").trim();
console.log(`Checked ${fresh.length} crash and error events${lastId != null ? ` after id ${lastId}` : DRY ? ` from the last ${HOURS} h` : " (first run: starting from now)"}, ` +
  `${fresh.length - people.length} from test devices or cancelled downloads.`);
console.log(md || "Nothing new to alert.");
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## Crash and error alert\n\n${md || "Nothing new to alert."}\n`);
if (DRY) { console.log("Dry run: no issue comment."); process.exit(0); }

// ---------- alert, then move the mark ----------
const body = (id) => `${MARK}\n<!-- last-id: ${id} -->\nEvery 15 minutes \`.github/workflows/app-alert.yml\` checks the crashes and errors the app sent ` +
  `(the Problems tab on usage.html, test devices left out). Each crash restart and each kind of error not seen in the ${KNOWN_DAYS} days before ` +
  `gets a comment here that mentions @${OWNER}. The daily "App errors" issue still has the full list each morning.`;
if (!issue) issue = await github("/issues", "POST", { title: TITLE, body: body(lastId ?? top), assignees: [OWNER] });
if (md) {
  // The comment goes first: if moving the mark then fails, the next check alerts again rather than never.
  await github(`/issues/${issue.number}/comments`, "POST", {
    body: `@${OWNER} ${[crashLines.length && `${crashLines.length} crash${crashLines.length > 1 ? "es" : ""}`, newErrLines.length && `${newErrLines.length} new error${newErrLines.length > 1 ? "s" : ""}`].filter(Boolean).join(" and ")} in the app.\n\n${md}\n\n` +
      `More on the Problems tab of https://trailfinderapp.ca/usage.html`,
  });
  console.log(`Alerted on issue #${issue.number}.`);
}
// Reopened only with a new alert, so a closed issue stays closed on quiet checks.
if (top !== lastId || (md && issue.state !== "open")) await github(`/issues/${issue.number}`, "PATCH", { body: body(top), ...(md ? { state: "open" } : {}) });
