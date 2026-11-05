// Keeps the privacy page's promise (privacy.html "How long we keep it"): how-the-app-is-used events (usage.js) and
// visit-count device codes (visitors.js) older than one year are deleted. Run each morning by app-errors.yml.
// Run: SUPABASE_SECRET_KEY=... node scripts/usage-cleanup.mjs   (DRY=1 only counts)
const SUPABASE_URL = process.env.SUPABASE_URL || "https://fohdmserpbkurcvcrbbb.supabase.co";
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!KEY) { console.log("No SUPABASE_SECRET_KEY secret: nothing to clean."); process.exit(0); }
const headers = { apikey: KEY, ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }) };
const yearAgo = new Date(Date.now() - 365 * 864e5);
const jobs = [
  ["tf_use_events", `at=lt.${yearAgo.toISOString()}`],
  ["tf_visits", `last_seen=lt.${yearAgo.toISOString().slice(0, 10)}`],
];
for (const [table, filter] of jobs) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${filter}`;
  const r = process.env.DRY
    ? await fetch(url, { method: "HEAD", headers: { ...headers, Prefer: "count=exact" } })
    : await fetch(url, { method: "DELETE", headers: { ...headers, Prefer: "return=minimal,count=exact" } });
  const n = (r.headers.get("content-range") || "").split("/")[1] || "?";
  console.log(`${table}: ${r.ok ? `${process.env.DRY ? "would delete" : "deleted"} ${n} rows older than a year` : `Supabase answered ${r.status}`}`);
}
