// The newest TestFlight crash reports (the "Share" a tester taps on iOS's "Trail Finder Crashed" box), read through the
// App Store Connect API (same key as ios-app.yml), so a crash can be traced without a Mac (alex 2026-11-21: a crash in an
// offline map). Prints only what's needed to find the bug: build, time, exception and the crashed thread's frames.
// Never names, emails or comments (this repository and its Actions logs are public).
//
// Run: ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_KEY_P8="$(cat AuthKey.p8)" node scripts/testflight-crashes.mjs
// Optional: BUNDLE (com.allduf.trailfinder), LIMIT (5).

import { createSign } from "node:crypto";
import { appendFile } from "node:fs/promises";

const { ASC_KEY_ID, ASC_ISSUER_ID } = process.env;
const BUNDLE = process.env.BUNDLE || "com.allduf.trailfinder", LIMIT = Math.min(20, +(process.env.LIMIT || 5));
if (!ASC_KEY_ID || !ASC_ISSUER_ID || !process.env.ASC_KEY_P8) { console.log("No App Store Connect key secrets: nothing to read."); process.exit(0); }
const body = process.env.ASC_KEY_P8.replace(/\r/g, "").replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
const pem = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = `${b64({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" })}.${b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 900, aud: "appstoreconnect-v1" })}`;
const jwt = `${head}.${createSign("SHA256").update(head).sign({ key: pem, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
async function asc(path) {
  const r = await fetch(`https://api.appstoreconnect.apple.com${path}`, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!r.ok) throw new Error(`App Store Connect ${path.split("?")[0]}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}
const app = (await asc(`/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE)}&limit=1`)).data[0];
if (!app) throw new Error(`No app with bundle id ${BUNDLE}`);
const subs = (await asc(`/v1/apps/${app.id}/betaFeedbackCrashSubmissions?limit=${LIMIT}&sort=-createdDate`)).data || [];
const out = [];
const clean = (s) => String(s).replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
for (const s of subs) {
  const a = s.attributes || {};
  out.push(`### ${a.createdDate} · build ${a.buildBundleId || ""} ${a.appUptimeInMilliseconds != null ? `· up ${Math.round(a.appUptimeInMilliseconds / 1000)} s` : ""} · ${a.deviceModel || ""} ${a.osVersion || ""} · ${a.connectionType || ""}`);
  let log = "";
  try { log = ((await asc(`/v1/betaFeedbackCrashSubmissions/${s.id}/crashLog`)).data.attributes.logText) || ""; } catch (e) { out.push(String(e.message)); continue; }
  const lines = log.split("\n");
  // .ips JSON (first line a header) or the classic text report
  let text = [];
  try {
    const j = JSON.parse(lines.slice(1).join("\n")), hdr = JSON.parse(lines[0]);
    text.push(`app ${hdr.app_version} (${hdr.build_version}) · ${j.exception && j.exception.type} ${j.exception && j.exception.signal} ${(j.exception && j.exception.subtype) || ""}`);
    if (j.asi) text.push("asi: " + JSON.stringify(j.asi).slice(0, 600));
    if (j.lastExceptionBacktrace) text.push("last exception backtrace:", ...j.lastExceptionBacktrace.slice(0, 40).map((f) => `  ${(j.usedImages[f.imageIndex] || {}).name || "?"} ${f.symbol || ""}+${f.symbolLocation || ""} (${f.imageOffset})`));
    const t = (j.threads || []).find((x) => x.triggered) || {};
    text.push(`crashed thread ${t.name || t.queue || ""}:`, ...(t.frames || []).slice(0, 40).map((f) => `  ${(j.usedImages[f.imageIndex] || {}).name || "?"} ${f.symbol || ""}+${f.symbolLocation || ""} (${f.imageOffset})`));
  } catch {
    const keep = [];
    let inCrashed = false;
    for (const l of lines) {
      if (/^(Exception Type|Exception Codes|Exception Reason|Termination Reason|Triggered by Thread|Version:|Last Exception Backtrace)/.test(l)) keep.push(l);
      if (/^Thread \d+ Crashed/.test(l) || /^Last Exception Backtrace/.test(l)) inCrashed = true;
      else if (inCrashed && /^\s*$/.test(l)) inCrashed = false;
      else if (inCrashed) keep.push(l);
    }
    text = keep.slice(0, 120);
  }
  out.push("```", ...text.map(clean), "```");
}
const md = out.join("\n") || "No crash reports.";
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `## TestFlight crashes\n\n${md}\n`);
