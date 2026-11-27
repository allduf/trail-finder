// Quick crash and error alert (see .github/workflows/app-alert.yml): every 15 minutes, reads the crashes and errors the
// app sent since the last check (usage.js → supabase/usage.sql, the same data as usage.html's Problems tab) and, when
// there is a crash restart or a kind of error not seen in the 14 days before, sends a notification to alex's own phone
// (alex 2026-11-27: crashes were only found by looking at the usage page; no email, so not through GitHub).
// The phones are the ones in tf_alert_phones (supabase/alert-phones.sql): Trail Finder notifications on and signed in
// with an admin account (notify.js adds them). The daily "App errors" issue (app-errors.mjs) still has the full list.
//
// As on usage.html, test and review devices are left out (scripts/test-devices.mjs) and cancelled downloads aren't
// faults. alex's own phone still alerts (its crashes are real too). Phones by model only, never by name or device code.
// The last event id checked is kept in tf_alert_state, so each crash or error is looked at once, even when it arrives
// late (a phone sends its queue at the next visit). A row whose insert commits after a later id was read can be
// missed here (rare: two phones sending at the same moment); the daily "App errors" issue still lists it.
// The workflow never fails on it (a failed scheduled run would email alex): a problem is a warning on the run.
//
// Run: SUPABASE_SECRET_KEY=... node scripts/app-alert.mjs
// Optional: DRY=1 (print only, no notification, nothing saved), HOURS (on a dry run: look back this many hours, default 24).
// Secrets for sending: see scripts/admin-push.mjs.

import { appendFile } from "node:fs/promises";
import { isTestDevice } from "./test-devices.mjs";
import { adminPush } from "./admin-push.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fohdmserpbkurcvcrbbb.supabase.co";
const KEY = process.env.SUPABASE_SECRET_KEY;
const DRY = !!process.env.DRY;
const HOURS = Math.max(1, +(process.env.HOURS || 24));
const KNOWN_DAYS = 14;
const SPORTS = { mtb: "MTB", ski: "Skiing", hunt: "Hunting", fish: "Fishing", moto: "Adventure moto", hike: "Hiking" };
const warn = (m) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${m}` : m);
if (!KEY) { warn("No SUPABASE_SECRET_KEY secret: nothing to read."); process.exit(0); }


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
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const inList = (xs) => `(${xs.map((x) => `"${String(x).replace(/["\\]/g, "")}"`).join(",")})`;
// The same rules as app-errors.mjs: cancelled downloads aren't faults; an error is the same after a change moves its
// line number or script version.
const real = (e) => e.kind !== "error" || !/aborted|AbortError/i.test(e.what || "");
const key = (w) => String(w || "error").replace(/\?v=\d+/g, "").replace(/:\d+(:\d+)?\b/g, "").replace(/\s+/g, " ").trim();
const cell = (s) => String(s).replace(/https?:\/\/[^\s?#]+[?#]\S*/g, (u) => u.replace(/[?#].*/, "")).replace(/[|`<>@#]/g, " ").replace(/[\r\n]+/g, " ").trim();

// ---------- where the last check stopped ----------
let lastId = null;
if (!DRY) {
  const state = await fetch(`${SUPABASE_URL}/rest/v1/tf_alert_state?select=last_id&id=eq.1`, { headers });
  if (!state.ok) { warn(`tf_alert_state isn't readable (HTTP ${state.status}): paste supabase/alert-phones.sql into the Supabase SQL Editor and run it.`); process.exit(0); }
  lastId = ((await state.json())[0] || {}).last_id ?? null;
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
if (DRY) { console.log("Dry run: no notification, nothing saved."); process.exit(0); }

// ---------- notify, then move the mark ----------
async function db(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...headers, "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${path.split("?")[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 || r.status === 201 ? null : r.json().catch(() => null);
}
if (md) {
  const what = [restarts.length && `${restarts.length} crash${restarts.length > 1 ? "es" : ""}`, newErrLines.length && `${newErrLines.length} new error${newErrLines.length > 1 ? "s" : ""}`].filter(Boolean).join(" and ");
  // The first line of each kind, short: the full list is on the usage page.
  const first = [crashLines[0], newErrLines[0]].filter(Boolean).map((l) => l.replace(/^- [^:]+ UTC: /, "").replace(/`/g, "")).join("\n");
  const r = await adminPush({ title: `Trail Finder: ${what}`, body: `${first}\nMore on the usage page, Problems tab.`, tag: `tf-alert-${top}`, url: "https://trailfinderapp.ca/usage.html" });
  // Nothing got through because of a passing problem (network, Apple or Google busy): keep the mark, so the next check
  // tries again (the 30-line cap keeps it short). A phone that can't get them at all doesn't hold the mark back.
  if (!r.sent && r.retry) process.exit(0);
}
if (top !== lastId)
  await db("tf_alert_state?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ id: 1, last_id: top }) });
