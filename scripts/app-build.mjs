// Keeps data/app-build.json up to date by asking App Store Connect which TestFlight builds testers can install,
// so app-update.js tells people on an older build without anyone editing the file by hand (alex, 2026-10-30: "im not
// seeing the notification when im not running the latest build"; the file was still on 32 when build 36 was out).
//   build   the newest build the Friends group (external testers) can install: added to Friends and past Apple's review.
//   newest  the newest build internal testers (alex) can install, usually ahead of Friends while alex tests it first.
// Usage: node scripts/app-build.mjs <AuthKey.p8> <out.json>   (ASC_KEY_ID, ASC_ISSUER_ID from the environment)
// Writes nothing and exits 0 when Apple can't be asked, so a bad hour never sends the number back down.
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://api.appstoreconnect.apple.com/v1", BUNDLE = "com.allduf.trailfinder", GROUP = "Friends";
const [keyFile, out] = process.argv.slice(2);

function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "ES256", kid: process.env.ASC_KEY_ID, typ: "JWT" });
  const body = b64({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" });
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: createPrivateKey(readFileSync(keyFile)), dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${sig.toString("base64url")}`;
}

const auth = { Authorization: `Bearer ${token()}` };
async function get(path) {
  const r = await fetch(API + path, { headers: auth });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} on ${path.split("?")[0]}: ${((j.errors || [])[0] || {}).detail || ""}`);
  return j;
}

// Builds that haven't expired, newest first, with their TestFlight state for internal and external testers.
async function builds(filter) {
  const j = await get(`/builds?${filter}&filter[expired]=false&filter[processingState]=VALID&sort=-uploadedDate&limit=50` +
    "&include=buildBetaDetail&fields[buildBetaDetails]=internalBuildState,externalBuildState");
  const detail = new Map((j.included || []).filter((d) => d.type === "buildBetaDetails").map((d) => [d.id, d.attributes || {}]));
  return (j.data || []).map((b) => ({ n: parseInt(b.attributes?.version, 10) || 0, ...detail.get(b.relationships?.buildBetaDetail?.data?.id) }));
}
const top = (list, ok) => Math.max(0, ...list.filter(ok).map((b) => b.n));

try {
  const app = ((await get(`/apps?filter[bundleId]=${BUNDLE}`)).data || [])[0];
  if (!app) throw new Error(`no app ${BUNDLE}`);
  const group = ((await get(`/betaGroups?filter[app]=${app.id}&filter[name]=${GROUP}`)).data || [])[0];
  if (!group) throw new Error(`no ${GROUP} group`);
  const all = await builds(`filter[app]=${app.id}`), friends = await builds(`filter[app]=${app.id}&filter[betaGroups]=${group.id}`);
  const build = top(friends, (b) => b.externalBuildState === "IN_BETA_TESTING" || b.externalBuildState === "BETA_APPROVED");
  const newest = Math.max(build, top(all, (b) => b.internalBuildState === "IN_BETA_TESTING"));
  console.log(`${GROUP} can install build ${build || "none"}; internal testers ${newest || "none"}.`);
  for (const b of all.slice(0, 5)) console.log(`  build ${b.n}: internal ${b.internalBuildState}, external ${b.externalBuildState}${friends.some((f) => f.n === b.n) ? `, in ${GROUP}` : ""}`);
  if (!build) throw new Error(`no installable build in ${GROUP}`);
  writeFileSync(out, JSON.stringify({
    about: `Written every hour by scripts/app-build.mjs from App Store Connect (don't edit). build = newest build the ${GROUP} TestFlight group can install, newest = newest for internal testers. app-update.js shows people on an older build a popup to update.`,
    build, newest,
  }, null, 2) + "\n");
} catch (e) {
  console.log(`::warning::Couldn't ask App Store Connect for the TestFlight builds (${e.message}); app-build.json left as it was.`);
}
