// A notification to alex's own phone(s) only: the phones in tf_alert_phones (supabase/alert-phones.sql), which have
// Trail Finder notifications on and are signed in with an admin account (notify.js adds them). For the jobs that warn
// alex (crash and error alert, avalanche watch); alex 2026-11-27: no email, a push to the phone.
// Secrets: SUPABASE_SECRET_KEY, and APNS_KEY_ID, APNS_KEY_P8, APPLE_TEAM_ID (iPhone app) / FCM_SERVICE_ACCOUNT (Android app).
//
// In a script: import { adminPush } from "./admin-push.mjs";
//   const r = await adminPush({ title, body, url, tag });   // → { phones, sent, retry } (retry: a passing problem, try later)
// From a workflow: node scripts/admin-push.mjs "<title>" "<body>" [url] [tag]
//   Never fails the run (GitHub emails failed scheduled runs): a problem is a warning. Same tag = replaces the last one.
import { apnsKey, apnsSend, fcmKey, fcmSend, pushClose } from "./push-send.mjs";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fohdmserpbkurcvcrbbb.supabase.co";
const warn = (m) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${m}` : m);

export async function adminPush({ title, body, url = "https://trailfinderapp.ca/", tag = "tf-admin" }) {
  const KEY = process.env.SUPABASE_SECRET_KEY;
  if (!KEY) { warn("No SUPABASE_SECRET_KEY secret: no notification sent."); return { phones: 0, sent: 0, retry: false }; }
  const headers = { apikey: KEY, ...(KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEY}` }) };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/tf_alert_phones?select=push_subs(id,sub)`, { headers });
  if (!r.ok) { warn(`tf_alert_phones isn't readable (HTTP ${r.status}): paste supabase/alert-phones.sql into the Supabase SQL Editor and run it.`); return { phones: 0, sent: 0, retry: r.status >= 500 }; }
  const subs = (await r.json()).map((p) => p.push_subs).filter((x) => x && x.sub);
  if (!subs.length) warn("No phone gets these yet: turn on Trail Finder notifications on alex's phone while signed in.");
  const msg = { title: String(title).slice(0, 120), body: String(body).slice(0, 900), url, tag };
  let sent = 0, retry = false;
  for (const s of subs) {
    try {
      const x = s.sub.apns ? (apnsKey ? await apnsSend(s.sub.apns, msg) : { status: 0, reason: "no APNS secrets" })
        : s.sub.fcm ? (fcmKey ? await fcmSend(s.sub.fcm, msg) : { status: 0, reason: "no FCM_SERVICE_ACCOUNT secret" })
        : { status: 0, reason: "a web browser, not the app" };
      if (x.status === 200) sent++;
      else { warn(`A phone wasn't reached (${[x.status, x.reason].filter(Boolean).join(" ")}).`); if (x.status === 429 || x.status >= 500) retry = true; }
    } catch (e) { warn(`A phone wasn't reached (${e.message}).`); retry = true; }
  }
  pushClose();
  console.log(`Sent to ${sent} of ${subs.length} phone(s).`);
  return { phones: subs.length, sent, retry };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [title, body, url, tag] = process.argv.slice(2);
  if (!title || !body) { console.log('Use: node scripts/admin-push.mjs "<title>" "<body>" [url] [tag]'); process.exit(0); }
  try { await adminPush({ title, body, ...(url ? { url } : {}), ...(tag ? { tag } : {}) }); }
  catch (e) { warn(`Notification not sent: ${e.message}`); }
}
