// Daily app errors (see .github/workflows/app-errors.yml): reads the errors the iPhone app sent in the last day
// (usage.js → supabase/usage.sql, the same data as usage.html's "Errors" list) and writes a short summary on the GitHub
// issue "App errors", so alex sees each morning what broke for testers without opening the usage report.
// Each error is counted once, with how many times it happened, on how many phones, in which sport, and what the
// person tapped just before (that's usually what to try to make it happen again). An error not seen in the 14 days
// before is marked 🆕 and the comment mentions OWNER (GitHub emails them); a day with only known errors still gets
// its comment, without the mention. A day with no errors gets no comment.
//
// Run: SUPABASE_SECRET_KEY=... node scripts/app-errors.mjs
// Optional: HOURS (24), DRY=1 (summary only, no issue comment), GITHUB_TOKEN + GITHUB_REPOSITORY (the issue), OWNER (allduf).

import { appendFile } from "node:fs/promises";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fohdmserpbkurcvcrbbb.supabase.co";
const KEY = process.env.SUPABASE_SECRET_KEY;
const HOURS = Math.max(1, +(process.env.HOURS || 24));
const REPO = process.env.GITHUB_REPOSITORY, TOKEN = process.env.GITHUB_TOKEN, OWNER = process.env.OWNER || "allduf";
const DRY = !!process.env.DRY || !REPO || !TOKEN;
const TITLE = "App errors", MARK = "<!-- trail-finder-app-errors -->";
const SPORTS = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", fish: "Fishing", moto: "Adventure moto" };
if (!KEY) { console.log("No SUPABASE_SECRET_KEY secret: nothing to read."); process.exit(0); }

const headers = { apikey: KEY, ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }) };
// Every row of a query, 1000 at a time (Supabase sends at most 1000 per answer).
async function rows(path) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
    if (!r.ok) {
      const t = (await r.text()).slice(0, 300);
      console.log(`Supabase answered ${r.status}: ${t}`);
      if (/does not exist|Could not find/.test(t)) console.log("supabase/usage.sql hasn't been run yet.");
      process.exit(0);
    }
    const page = await r.json();
    all.push(...page);
    if (page.length < 1000) return all;
  }
}
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const inList = (xs) => `(${xs.map((x) => `"${String(x).replace(/["\\]/g, "")}"`).join(",")})`;
// Cancelled downloads aren't faults (usage.html leaves them out too).
const real = (e) => !/aborted|AbortError/i.test(e.what || "");
// The same error after a change moves its line number: compare without them.
const key = (w) => String(w || "error").replace(/:\d+(:\d+)?\b/g, "").replace(/\s+/g, " ").trim();

const since = ago(HOURS);
const errors = (await rows(`tf_use_events?select=device,session,at,what&kind=eq.error&at=gte.${since}&order=at`)).filter(real);
console.log(`${errors.length} errors in the last ${HOURS} h.`);
const known = new Set((await rows(`tf_use_events?select=what&kind=eq.error&at=gte.${ago(HOURS + 14 * 24)}&at=lt.${since}`)).filter(real).map((e) => key(e.what)));

// What happened around each error: the sport picked before it in that visit, and the last taps.
const sessions = [...new Set(errors.map((e) => e.session))];
const around = new Map();
for (let i = 0; i < sessions.length; i += 50) {
  const part = await rows(`tf_use_events?select=session,at,kind,what&session=in.${inList(sessions.slice(i, i + 50))}&kind=in.(sport,tap,open)&at=gte.${ago(HOURS + 12)}&order=at`);
  for (const e of part) { if (!around.has(e.session)) around.set(e.session, []); around.get(e.session).push(e); }
}
const devices = new Map();
const devList = [...new Set(errors.map((e) => e.device))];
for (let i = 0; i < devList.length; i += 50)
  for (const d of await rows(`tf_use_devices?select=device,label,os&device=in.${inList(devList.slice(i, i + 50))}`)) devices.set(d.device, d);

const groups = new Map();
for (const e of errors) {
  const k = key(e.what);
  if (!groups.has(k)) groups.set(k, { what: e.what, n: 0, phones: new Set(), sports: new Map(), taps: new Map(), last: e.at });
  const g = groups.get(k);
  g.n++; g.phones.add(e.device); g.last = e.at; g.what = e.what;
  const before = (around.get(e.session) || []).filter((x) => x.at <= e.at);
  // The sport picked last in that visit (an "open" carries the sport the app opened on).
  const sp = [...before].reverse().find((x) => (x.kind === "sport" || x.kind === "open") && x.what);
  const s = sp ? (SPORTS[sp.what] || sp.what) : "?";
  g.sports.set(s, (g.sports.get(s) || 0) + 1);
  const taps = before.filter((x) => x.kind === "tap").slice(-2).map((x) => x.what).join(" → ");
  if (taps) g.taps.set(taps, (g.taps.get(taps) || 0) + 1);
}
const top = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k]) => k);
const list = [...groups.values()].sort((a, b) => b.phones.size - a.phones.size || b.n - a.n);
const fresh = list.filter((g) => !known.has(key(g.what)));
const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").replace(/`/g, "'");
const who = (g) => [...g.phones].map((d) => (devices.get(d) || {}).label).filter(Boolean).slice(0, 3).join(", ");

const day = new Date().toISOString().slice(0, 10);
const md = !list.length ? `No app errors in the last ${HOURS} hours 🎉` : [
  `**${errors.length} error${errors.length > 1 ? "s" : ""}** on ${new Set(errors.map((e) => e.device)).size} phone(s) in the last ${HOURS} hours` +
    (fresh.length ? `, **${fresh.length} new** (not seen in the 14 days before).` : ", all seen before."), "",
  "| | Error | Times | Phones | Sport | Tapped just before |", "|---|---|---|---|---|---|",
  ...list.slice(0, 25).map((g) => `| ${known.has(key(g.what)) ? "" : "🆕"} | \`${cell(g.what)}\` | ${g.n} | ${g.phones.size}${who(g) ? ` (${cell(who(g))})` : ""} | ${cell(top(g.sports).join(", "))} | ${cell(top(g.taps)[0] || "")} |`),
  list.length > 25 ? `\n…and ${list.length - 25} more on usage.html.` : "",
].join("\n");
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## App errors, ${day}\n\n${md}\n`);
if (DRY) { console.log("Dry run: no issue comment."); process.exit(0); }

// ---------- the issue ----------
async function github(path, method = "GET", body) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method, body: body && JSON.stringify(body),
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "trail-finder-app-errors" },
  });
  if (!r.ok) throw new Error(`GitHub ${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
const issues = await github(`/issues?state=all&creator=${encodeURIComponent("github-actions[bot]")}&per_page=100`);
let issue = issues.find((i) => !i.pull_request && (i.body || "").includes(MARK));
const body = `${MARK}\nEach morning \`.github/workflows/app-errors.yml\` writes here the errors the iPhone app sent the day before ` +
  `(the same as the Errors list on usage.html), with what testers tapped just before. New errors mention @${OWNER}. ` +
  `Last checked ${day}: ${errors.length} error(s).`;
if (!issue) issue = await github("/issues", "POST", { title: TITLE, body, assignees: [OWNER] });
else await github(`/issues/${issue.number}`, "PATCH", { body, state: "open" });
if (list.length) {
  await github(`/issues/${issue.number}/comments`, "POST", { body: `### ${day}\n${fresh.length ? `@${OWNER} ${fresh.length} new error${fresh.length > 1 ? "s" : ""} in the app.\n\n` : "\n"}${md}` });
  console.log(`Commented on issue #${issue.number}.`);
}
