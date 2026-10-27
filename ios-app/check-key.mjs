// Signs in to the App Store Connect API with the GitHub secrets and says in plain words what's wrong, if anything.
// Also registers the lock screen extension's bundle ID if it isn't yet (see the end).
// Usage: node check-key.mjs <path to AuthKey.p8>   (ASC_KEY_ID, ASC_ISSUER_ID, APPLE_TEAM_ID from the environment)
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const keyId = process.env.ASC_KEY_ID || "", issuer = process.env.ASC_ISSUER_ID || "", team = process.env.APPLE_TEAM_ID || "";
const problems = [];
if (!/^[A-Z0-9]{10}$/.test(keyId)) problems.push(`ASC_KEY_ID should be the 10-character Key ID (it has ${keyId.length} characters${/[a-z-]/.test(keyId) ? ", with lower-case letters or dashes, so it may be the Issuer ID" : ""}).`);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(issuer)) problems.push(`ASC_ISSUER_ID should be the Issuer ID with dashes, 36 characters (it has ${issuer.length}${/^[A-Z0-9]{10}$/.test(issuer) ? " and looks like a Key ID or Team ID" : ""}).`);
if (!/^[A-Z0-9]{10}$/.test(team)) problems.push(`APPLE_TEAM_ID should be the 10-character Team ID (it has ${team.length} characters).`);
if (keyId && keyId === team) problems.push("ASC_KEY_ID and APPLE_TEAM_ID are the same value; one of them is wrong.");
for (const p of problems) console.log(`::error::${p}`);
if (problems.length) process.exit(1);

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: "ES256", kid: keyId, typ: "JWT" });
const body = b64({ iss: issuer, iat: now, exp: now + 600, aud: "appstoreconnect-v1" });
const key = createPrivateKey(readFileSync(process.argv[2]));
const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");

const res = await fetch("https://api.appstoreconnect.apple.com/v1/apps?filter[bundleId]=com.allduf.trailfinder", {
  headers: { Authorization: `Bearer ${head}.${body}.${sig}` },
});
const json = await res.json().catch(() => ({}));
if (res.status === 401) {
  console.log("::error::Apple refused the key (401). The Key ID, Issuer ID and .p8 file don't belong together, or the key was revoked. Check that ASC_KEY_ID matches the AuthKey_XXXXXXXXXX.p8 file name and ASC_ISSUER_ID is the Issuer ID shown above the Team Keys list.");
  process.exit(1);
}
if (!res.ok) {
  const e = (json.errors || [])[0] || {};
  console.log(`::error::App Store Connect answered ${res.status}: ${e.title || ""} ${e.detail || ""}`);
  process.exit(1);
}
const apps = json.data || [];
if (!apps.length) {
  console.log("::error::The key works, but App Store Connect has no app with bundle ID com.allduf.trailfinder. Create it under Apps > + > New App.");
  process.exit(1);
}
console.log(`Key works; found the app "${apps[0].attributes?.name}" in App Store Connect.`);

// The lock screen ride (RideActivity extension) has its own bundle ID. Signing makes its profile, but the ID itself
// must be registered first: do it here once, so the export below finds it.
const EXT = "com.allduf.trailfinder.RideActivity";
const auth = { Authorization: `Bearer ${head}.${body}.${sig}` };
const ids = await fetch(`https://api.appstoreconnect.apple.com/v1/bundleIds?filter[identifier]=${EXT}`, { headers: auth }).then((r) => r.json()).catch(() => ({}));
if ((ids.data || []).some((d) => d.attributes?.identifier === EXT)) console.log(`Bundle ID ${EXT} is registered.`);
else {
  const made = await fetch("https://api.appstoreconnect.apple.com/v1/bundleIds", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ data: { type: "bundleIds", attributes: { identifier: EXT, name: "Trail Finder lock screen ride", platform: "IOS" } } }),
  });
  if (made.ok) console.log(`Registered bundle ID ${EXT}.`);
  else {
    const e = ((await made.json().catch(() => ({}))).errors || [])[0] || {};
    console.log(`::warning::Couldn't register ${EXT} (${made.status}: ${e.title || ""} ${e.detail || ""}). The export may still create it.`);
  }
}
