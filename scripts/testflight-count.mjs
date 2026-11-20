// Daily TestFlight tester count (see .github/workflows/testflight-count.yml). alex 2026-11-20: the public link of the
// external group "Friends" has a 250-tester limit; warn before it fills. Reads the group through the App Store Connect
// API (same key as ios-app.yml) and writes ONLY the numbers (never names or emails: this repository is public) on the
// GitHub issue "TestFlight testers", which the project's Monday report and daily check read.
//
// Run: ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_KEY_P8="$(cat AuthKey.p8)" node scripts/testflight-count.mjs
// Optional: GROUP (Friends), BUNDLE (com.allduf.trailfinder), DRY=1 (print only), GITHUB_TOKEN + GITHUB_REPOSITORY.

import { createSign } from "node:crypto";
import { appendFile } from "node:fs/promises";

const { ASC_KEY_ID, ASC_ISSUER_ID } = process.env;
const GROUP = process.env.GROUP || "Friends", BUNDLE = process.env.BUNDLE || "com.allduf.trailfinder";
const REPO = process.env.GITHUB_REPOSITORY, TOKEN = process.env.GITHUB_TOKEN;
const DRY = !!process.env.DRY || !REPO || !TOKEN;
const TITLE = "TestFlight testers", MARK = "<!-- trail-finder-testflight-count -->";
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !process.env.ASC_KEY_P8) { console.log("No App Store Connect key secrets: nothing to read."); process.exit(0); }

// The .p8 as pasted in the secret, rebuilt into PEM lines (the secret may have lost its line breaks).
const body = process.env.ASC_KEY_P8.replace(/\r/g, "").replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
const pem = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = `${b64({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" })}.${b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" })}`;
const jwt = `${head}.${createSign("SHA256").update(head).sign({ key: pem, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;

async function asc(path) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!r.ok) throw new Error(`App Store Connect ${path.split("?")[0]}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
const app = (await asc(`/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}&limit=1`)).data[0];
if (!app) throw new Error(`No app with bundle id ${BUNDLE}`);
const groups = (await asc(`/v1/apps/${app.id}/betaGroups?limit=200`)).data;
const group = groups.find((g) => g.attributes.name.trim().toLowerCase() === GROUP.toLowerCase());
if (!group) throw new Error(`No TestFlight group named "${GROUP}" (groups: ${groups.map((g) => g.attributes.name).join(", ")})`);
const a = group.attributes;
// Every tester in the group (public link sign-ups and invited ones), 200 per page; only the count is kept.
let count = 0, viaLink = 0;
for (let next = `/v1/betaGroups/${group.id}/betaTesters?limit=200&fields[betaTesters]=inviteType`; next; ) {
  const page = await asc(next);
  count += page.data.length;
  viaLink += page.data.filter((t) => t.attributes && t.attributes.inviteType === "PUBLIC_LINK").length;
  next = page.links && page.links.next ? page.links.next.replace("https://api.appstoreconnect.apple.com", "") : null;
}
const limit = a.publicLinkEnabled && a.publicLinkLimitEnabled ? a.publicLinkLimit : null;
const day = new Date().toISOString().slice(0, 10);
const line = `count: ${count} | limit: ${limit ?? "none"} | via link: ${viaLink} | link on: ${!!a.publicLinkEnabled} | checked: ${day}`;
console.log(`${GROUP}: ${line}`);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## TestFlight "${GROUP}"\n\n${line}\n`);
if (DRY) { console.log("Dry run: issue not updated."); process.exit(0); }

async function github(path, method = "GET", data) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method, body: data && JSON.stringify(data),
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "trail-finder-testflight-count" },
  });
  if (!r.ok) throw new Error(`GitHub ${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}
const issues = await github(`/issues?state=all&creator=${encodeURIComponent("github-actions[bot]")}&per_page=100`);
const issue = issues.find((i) => !i.pull_request && (i.body || "").includes(MARK));
const text = `${MARK}\nEach day \`.github/workflows/testflight-count.yml\` counts the testers in the TestFlight group "${GROUP}" ` +
  `(numbers only). The project's daily check warns alex at 200 and at the limit.\n\n${line}`;
if (!issue) await github("/issues", "POST", { title: TITLE, body: text });
else await github(`/issues/${issue.number}`, "PATCH", { body: text, state: "open" });
console.log("Issue updated.");
