// Sending one notification to a phone in the iPhone app (Apple's push service, APNs) or the Android app (Firebase
// Cloud Messaging), shared by the loam alerts (push-loam.mjs) and the crash and error alert (app-alert.mjs).
// Secrets: APNS_KEY_ID, APNS_KEY_P8, APPLE_TEAM_ID (iPhone) and FCM_SERVICE_ACCOUNT (Android). A missing secret leaves
// apnsKey / fcmKey null. msg = { title, body, tag, url }. Call pushClose() at the end so the job can finish.
import { connect } from "node:http2";
import { createPrivateKey, sign } from "node:crypto";

// ---------- Apple's push service, for phones in the iPhone app ----------
export const APP_ID = "com.allduf.trailfinder";
export const apnsKey = (() => {
  const id = (process.env.APNS_KEY_ID || "").trim(), team = (process.env.APPLE_TEAM_ID || "").trim(), p8 = process.env.APNS_KEY_P8 || "";
  if (!id || !team || !p8) return null;
  // Rebuilt from just the key text, so a paste with lost line breaks or extra spaces still works (as ios-app.yml).
  const b = p8.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  try { return { id, team, key: createPrivateKey(`-----BEGIN PRIVATE KEY-----\n${b.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`) }; }
  catch (e) { console.log(`APNS_KEY_P8 isn't a valid key (${e.message}): app phones are skipped.`); return null; }
})();
let apnsJwt = "", apnsAt = 0, apnsConn = null;
function apnsAuth() {
  if (Date.now() - apnsAt > 40 * 60e3) {   // Apple wants a fresh token at most every hour
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "ES256", kid: apnsKey.id })}.${b64({ iss: apnsKey.team, iat: Math.floor(Date.now() / 1000) })}`;
    apnsJwt = `${unsigned}.${sign("sha256", Buffer.from(unsigned), { key: apnsKey.key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
    apnsAt = Date.now();
  }
  return apnsJwt;
}
// Resolves { status, reason }: 200 sent; 410 (or 400 BadDeviceToken) means the app was removed or notifications turned off.
export function apnsSend(token, msg) {
  if (!apnsConn || apnsConn.closed || apnsConn.destroyed) { apnsConn = connect("https://api.push.apple.com"); apnsConn.on("error", () => {}); }
  return new Promise((ok, no) => {
    const req = apnsConn.request({
      ":method": "POST", ":path": `/3/device/${token}`, authorization: `bearer ${apnsAuth()}`,
      "apns-topic": APP_ID, "apns-push-type": "alert", "apns-priority": "5", "apns-collapse-id": msg.tag,
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 6 * 3600), "content-type": "application/json",
    });
    let status = 0, body = "";
    req.on("response", (h) => { status = h[":status"]; });
    req.on("data", (d) => { body += d; });
    req.on("end", () => { let reason = ""; try { reason = JSON.parse(body).reason || ""; } catch {} ok({ status, reason }); });
    req.on("error", no);
    req.setTimeout(20000, () => { req.close(); no(new Error("APNs timeout")); });
    req.end(JSON.stringify({ aps: { alert: { title: msg.title, body: msg.body }, sound: "default", "thread-id": msg.tag }, url: msg.url }));
  });
}

// ---------- Firebase Cloud Messaging, for phones in the Android app ----------
// FCM_SERVICE_ACCOUNT = the Firebase project's service account key (JSON). A short-lived Google token is made from it.
export const fcmKey = (() => {
  const raw = process.env.FCM_SERVICE_ACCOUNT || "";
  if (!raw.trim()) return null;
  try { const j = JSON.parse(raw); return { project: j.project_id, email: j.client_email, key: createPrivateKey(j.private_key) }; }
  catch (e) { console.log(`FCM_SERVICE_ACCOUNT isn't a valid key file (${e.message}): Android app phones are skipped.`); return null; }
})();
let fcmToken = "", fcmAt = 0, fcmDown = "";
async function fcmAuth() {
  if (fcmDown) throw new Error(fcmDown);   // one failed sign-in per run, not one per message
  if (Date.now() - fcmAt < 40 * 60e3) return fcmToken;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"), now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: fcmKey.email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const jwt = `${unsigned}.${sign("sha256", Buffer.from(unsigned), fcmKey.key).toString("base64url")}`;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  if (!r.ok) { fcmDown = `Google sign-in for Firebase failed (HTTP ${r.status}): check FCM_SERVICE_ACCOUNT`; console.log(fcmDown); throw new Error(fcmDown); }
  fcmToken = (await r.json()).access_token; fcmAt = Date.now();
  return fcmToken;
}
// Resolves { status, reason }: 200 sent; UNREGISTERED means the app was removed or notifications turned off.
export async function fcmSend(token, msg) {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmKey.project}/messages:send`, {
    method: "POST", headers: { authorization: `Bearer ${await fcmAuth()}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token, notification: { title: msg.title, body: msg.body }, data: { url: msg.url },
      android: { collapse_key: msg.tag, ttl: "21600s", priority: "normal", notification: { tag: msg.tag } } } }) });
  let reason = "";
  if (!r.ok) { try { const e = (await r.json()).error || {}; reason = ((e.details || []).find((d) => d.errorCode) || {}).errorCode || e.status || e.message || ""; } catch {} }
  return { status: r.status, reason };
}

export function pushClose() { if (apnsConn) apnsConn.close(); }
