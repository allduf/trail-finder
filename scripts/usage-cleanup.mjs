// Keeps the privacy page's promise (privacy.html "How long we keep it"): how-the-app-is-used events and phones (usage.js)
// and visit-count device codes (visitors.js) older than one year, shared trips two years after their last change, and shared
// ride lines, Join the test emails and feedback notes older than two years are deleted. Run each morning by app-errors.yml.
// Run: SUPABASE_SECRET_KEY=... node scripts/usage-cleanup.mjs   (DRY=1 only counts)
const SUPABASE_URL = process.env.SUPABASE_URL || "https://fohdmserpbkurcvcrbbb.supabase.co";
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!KEY) { console.log("No SUPABASE_SECRET_KEY secret: nothing to clean."); process.exit(0); }
const headers = { apikey: KEY, ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }) };
const yearAgo = new Date(Date.now() - 365 * 864e5), twoYears = new Date(Date.now() - 730 * 864e5);
const day = (d) => d.toISOString().slice(0, 10);
// [table, filter, what the privacy page promises]. Added 2026-11-21 (security check): the rest of the list's limits.
const jobs = [
  ["tf_use_events", `at=lt.${yearAgo.toISOString()}`, "a year"],
  ["tf_use_devices", `last_seen=lt.${yearAgo.toISOString()}`, "a year"],          // phones not seen for a year (their events go with them)
  ["tf_visits", `last_seen=lt.${day(yearAgo)}`, "a year"],
  ["tf_visit_days", `day=lt.${day(yearAgo)}`, "a year"],
  ["shared_trips", `updated_at=lt.${twoYears.toISOString()}`, "2 years"],      // a group's trip, two years after its last change (alex 2026-11-21)
  ["shared_rides", `created_at=lt.${twoYears.toISOString()}`, "2 years"],
  ["tf_join", `created_at=lt.${twoYears.toISOString()}`, "2 years"],
  ["tf_feedback", `created_at=lt.${twoYears.toISOString()}`, "2 years"],
];
for (const [table, filter, age] of jobs) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}`;
  const r = process.env.DRY
    ? await fetch(url, { method: "HEAD", headers: { ...headers, Prefer: "count=exact" } })
    : await fetch(url, { method: "DELETE", headers: { ...headers, Prefer: "return=minimal,count=exact" } });
  const n = (r.headers.get("content-range") || "").split("/")[1] || "?";
  console.log(`${table}: ${r.ok ? `${process.env.DRY ? "would delete" : "deleted"} ${n} rows older than ${age}` : `Supabase answered ${r.status}`}`);
}
