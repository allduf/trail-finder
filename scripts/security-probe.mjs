// Security probe (security check 2026-11-21): asks the live database what a stranger can see, with only the public key
// every visitor has (account.js). Fails if anything private answers. Run weekly and on every change under supabase/ by
// .github/workflows/security-probe.yml (GitHub's machines reach Supabase directly, as a stranger would).
// Run: node scripts/security-probe.mjs
// Private: returns nothing ([]), "permission denied", "not allowed", or "no such table/function" (not set up yet).
// Public on purpose (privacy.html "Things you choose to share"): trail reports, rider photos, grade totals, the
// listed columns of photo-search matches, rider-added trails (through rider_trails_all, without who added them).
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../account.js", import.meta.url), "utf8");
const URL_ = (src.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const KEY = (src.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/) || [])[1];
if (!URL_ || !KEY) { console.log("account.js has no Supabase address or public key: nothing to probe."); process.exit(0); }
// New keys (sb_publishable_...) go in the apikey header only; an old anon key is a JWT and goes in both.
const H = { apikey: KEY, ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }), "Content-Type": "application/json" };

const PRIVATE_TABLES = ["settings", "rides", "ski_points", "shared_rides", "shared_trips", "live_spots", "push_subs", "push_keys",
  "strava_links", "tf_admins", "tf_friends", "tf_join", "tf_feedback", "tf_form_hits", "tf_limit_counts", "tf_agreements",
  "tf_use_events", "tf_use_devices", "tf_use_roster", "tf_visits", "tf_visit_days", "photo_ai_use", "photo_ai_person_use",
  "content_flags", "trail_grades", "rider_trails", "rider_trail_votes"];
// Columns of public tables that must stay hidden.
const HIDDEN_COLUMNS = [["trail_matches", "user_id"], ["trail_matches", "created_at"], ["trail_matches", "details"], ["trail_matches", "photo"]];
// Functions only alex (an admin account) may use: a stranger must get an error.
const ADMIN_RPCS = [["tf_use_report", { days: 1 }], ["tf_use_devices_all", {}], ["tf_use_roster_get", {}], ["tf_visits_by_kind", { days: 1 }],
  ["tf_use_limits", {}], ["tf_flag_list", {}], ["tf_friend_list", {}], ["tf_join_list", {}], ["tf_feedback_list", {}],
  ["tf_is_friend", {}], ["tf_is_admin", {}], ["photo_ai_take", { p_kind: "ask", p_cap: 0 }], ["photo_ai_take_person", { p_who: "probe", p_kind: "ask", p_cap: 0 }],
  ["tf_limit", { k: "probe", per_who: 0 }], ["tf_client_ip", {}]];
// Private photo buckets: listing must return nothing.
const PRIVATE_BUCKETS = ["ride-photos", "point-photos", "trail-match-photos"];

let bad = 0;
const fail = (what, why) => { bad++; console.log(`NOT OK  ${what}: ${why}`); };
const ok = (what, why) => console.log(`ok      ${what}: ${why}`);
// A refusal by the database itself. 401 doesn't count: that means the key itself was refused, and then nothing was
// really asked (the check at the start stops the run).
const closed = (status, body) => status === 403 || status === 404 ||
  /permission denied|not allowed|42501|PGRST205|PGRST202|PGRST204|42883|does not exist|Could not find/i.test(body);

async function get(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(15000) });
  return { status: r.status, body: await r.text() };
}
async function rpc(fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
  return { status: r.status, body: await r.text() };
}

// First: does the database answer this key at all? A public view must answer 200, or every "closed" below means nothing.
{
  const { status, body } = await get("trail_grade_counts?select=grade&limit=1");
  if (status !== 200) { console.log(`NOT OK  the public key got ${status} on a public view (${body.slice(0, 80)}): the probe can't ask anything.`); process.exit(1); }
  ok("public key", "the database answers it");
}
for (const t of PRIVATE_TABLES) {
  const { status, body } = await get(`${t}?select=*&limit=1`);
  if (status === 200 && body.trim() === "[]") ok(t, "nothing visible");
  else if (closed(status, body)) ok(t, `closed (${status})`);
  else fail(t, `answered ${status} ${body.slice(0, 80)}`);
}
for (const [t, c] of HIDDEN_COLUMNS) {
  const { status, body } = await get(`${t}?select=${c}&limit=1`);
  if ((status === 200 && body.trim() === "[]") || closed(status, body)) ok(`${t}.${c}`, "hidden");
  else fail(`${t}.${c}`, `answered ${status} ${body.slice(0, 80)}`);
}
for (const [fn, args] of ADMIN_RPCS) {
  const { status, body } = await rpc(fn, args);
  // tf_is_admin / tf_is_friend may answer false to a stranger: that's closed too.
  if (closed(status, body) || (status === 200 && /^(false|null|\[\])$/.test(body.trim()))) ok(`rpc ${fn}`, `refused (${status})`);
  else fail(`rpc ${fn}`, `answered ${status} ${body.slice(0, 80)}`);
}
for (const b of PRIVATE_BUCKETS) {
  const r = await fetch(`${URL_}/storage/v1/object/list/${b}`, { method: "POST", headers: H, body: JSON.stringify({ prefix: "", limit: 5 }), signal: AbortSignal.timeout(15000) });
  const body = await r.text();
  if ((r.ok && body.trim() === "[]") || r.status === 400 || r.status === 403 || r.status === 404) ok(`bucket ${b}`, "nothing listed");
  else fail(`bucket ${b}`, `listed ${r.status} ${body.slice(0, 80)}`);
}
// A shared trip opens only with its own key.
{
  const { status, body } = await rpc("trip_get", { p_id: "00000000-0000-4000-8000-000000000000", p_key: "00000000-0000-4000-8000-000000000000" });
  if ((status === 200 && /^(null|)$/.test(body.trim())) || closed(status, body)) ok("trip_get without the key", "nothing");
  else fail("trip_get without the key", `answered ${status} ${body.slice(0, 80)}`);
}
console.log(bad ? `\n${bad} thing(s) a stranger can see that should be private.` : "\nEverything private stays private.");
process.exit(bad ? 1 : 0);
