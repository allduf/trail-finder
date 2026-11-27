// Auto re-run (alex 2026-11-27: "make it fix itself automatically when a test failed").
// Called by .github/workflows/auto-retry.yml when a check run fails. Reads the failed steps' log and decides:
//   - a server or runner hiccup (Maven Central 429, a map or package server 5xx, a dropped connection, a runner that
//     went away, a slow mirror during install): re-run the failed jobs after a pause, at most twice;
//   - one of the few tests known to be flaky on a cold simulator: re-run once;
//   - anything else is a real failure: never re-run, so the thread that owns the pull request sees it and fixes it.
// It never touches the tests themselves: a real app error, wording or avalanche check failure fails every attempt.
// Each decision is written as a neutral "Auto re-run" check on the commit, so whoever looks at the pull request can
// tell a hiccup being re-run from a real failure. Run `node scripts/ci/auto-retry.mjs --test` for its own checks.

// Server and runner hiccups: nothing in the app or its tests can cause these.
export const TRANSIENT = [
  [/\b429\b[^\n]*Too Many Requests|Too Many Requests[^\n]*\b429\b|status code 429/i, "a download server's rate limit (429)", 180],
  [/(?:status code|HTTP\/[\d.]+|HTTP|returned|error:?)\s*50[234]\b|\b50[234] (?:Bad Gateway|Service Unavailable|Gateway Time-?out)/i, "a server error (502, 503 or 504)", 90],
  [/\b(?:ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|ERR_SOCKET_TIMEOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)\b|socket hang up|Could not resolve host|Temporary failure in name resolution|Connection (?:timed out|reset by peer)|Read timed out|connect timed out/i, "a dropped or slow connection", 90],
  [/Failed to fetch https?:\S*(?:ubuntu|debian)|Hash Sum mismatch|Unable to fetch some archives|Some index files failed to download|E: Failed to fetch/i, "the Ubuntu package mirror", 90],
  [/received a shutdown signal|lost communication with the server/i, "the GitHub runner stopped", 60],
  [/Timeout waiting for emulator to boot|emulator: ERROR|adb: device offline|device '[^']*' not found/i, "the Android simulator did not start", 60],
  [/Unable to boot (?:the )?Simulator|CoreSimulatorService connection (?:became invalid|interrupted)|simctl[^\n]*(?:timed out|failed to boot)/i, "the iPhone simulator did not start", 60],
  [/Error: Failed to download action|Unable to resolve action|Couldn't connect to server/i, "GitHub could not download a build tool", 60],
];
// Tests seen to fail once on a cold simulator and pass on the next try (see memory: Android check "GPS keeps the ride's
// fixes"). Re-run once only: if it fails twice it is treated as real.
export const FLAKY = [
  [/✗ the GPS keeps the ride's fixes/, "the Android GPS check (known to miss once on a cold simulator)", 30],
];
// Step names that only set up the runner: a timeout or failure there is the network, not the app.
const SETUP_STEP = /^(?:Set up job|Run actions\/checkout|Run actions\/setup-|Install the test browser|Install|Add the data jobs' files|Post )/i;

export const MAX_ATTEMPTS = 3;   // the first run + two re-runs
// A log that also names a failed test (✗ lines, "N check(s) failed") may hold a real failure next to the hiccup (a
// simulator's log is full of network lines): then one re-run only, and a second failure is treated as real.
const TEST_FAILED = /✗|\d+ check\(s\) failed/;

// log: text of the failed steps. steps: [{name, conclusion}] of the failed jobs. attempt: the run's attempt number.
export function decide(log, steps, attempt) {
  const hit = (list) => { for (const [re, why, wait] of list) if (re.test(log)) return { why, wait }; return null; };
  let t = hit(TRANSIENT);
  if (!t) {
    const bad = steps.find((s) => s.conclusion === "failure" || s.conclusion === "cancelled" || s.conclusion === "timed_out");
    if (bad && SETUP_STEP.test(bad.name)) t = { why: `the setup step "${bad.name}" failed (runner or network)`, wait: 90 };
  }
  if (t) {
    if (TEST_FAILED.test(log) && attempt >= 2) return { rerun: false, real: true, why: t.why, title: "Real failure: a test failed again after a re-run" };
    if (attempt >= MAX_ATTEMPTS) return { rerun: false, real: false, why: t.why, title: `Still failing after ${attempt} tries: ${t.why}` };
    return { rerun: true, why: t.why, wait: t.wait * attempt, title: `Re-running: ${t.why}` };
  }
  const f = hit(FLAKY);
  if (f) {
    if (attempt >= 2) return { rerun: false, real: true, why: f.why, title: `Failed twice: ${f.why}` };
    return { rerun: true, why: f.why, wait: f.wait, title: `Re-running once: ${f.why}` };
  }
  return { rerun: false, real: true, why: "a test or build step failed", title: "Real failure: not re-run" };
}

// ---------- self test ----------
if (process.argv.includes("--test")) {
  const cases = [
    ["> Could not GET 'https://repo.maven.apache.org/x.pom'. Received status code 429 from server: Too Many Requests", [], 1, true],
    ["> Could not GET 'https://repo.maven.apache.org/x.pom'. Received status code 429 from server: Too Many Requests", [], 3, false],
    ["Error: HTTP 502 from tiles.openfreemap.org", [], 1, true],
    ["npm ERR! code ECONNRESET", [], 2, true],
    ["E: Failed to fetch http://archive.ubuntu.com/ubuntu/pool/main/m/mesa/libgbm1.deb  404  Not Found", [], 1, true],
    ["", [{ name: "Install the test browser", conclusion: "cancelled" }], 1, true],
    ["✗ the GPS keeps the ride's fixes: 2 fixes", [], 1, true],
    ["✗ the GPS keeps the ride's fixes: 2 fixes", [], 2, false],
    ["✗ Skiing: 3D map\n    TypeError: x is undefined @map3d.js:12", [{ name: "Test every sport at iPhone size", conclusion: "failure" }], 1, false],
    ["wording-check: \"safe\" in today.js:40", [{ name: "Wording check (nothing that promises safety or conditions)", conclusion: "failure" }], 1, false],
    ["✗ Avalanche: rating differs from Avalanche Canada", [], 1, false],
    ["✗ MTB: 3D map · status 5023 points", [], 1, false],
    ["2 check(s) failed\nW/Mbgl ECONNREFUSED", [], 1, true],
    ["2 check(s) failed\nW/Mbgl ECONNREFUSED", [], 2, false],
  ];
  let bad = 0;
  for (const [log, steps, attempt, want] of cases) {
    const d = decide(log, steps, attempt);
    if (d.rerun !== want) { bad++; console.log(`✗ ${JSON.stringify(log.slice(0, 70))} attempt ${attempt}: got rerun=${d.rerun}, want ${want}`); }
    else console.log(`✓ ${d.title}`);
  }
  process.exit(bad ? 1 : 0);
}

// ---------- the workflow's run ----------
if (process.argv.includes("--run")) {
  const { GH_TOKEN, REPO, RUN_ID, ATTEMPT, WORKFLOW, EVENT, HEAD_SHA, LOG_FILE } = process.env;
  const { readFile, appendFile } = await import("node:fs/promises");
  const api = async (path, opts = {}) => {
    const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, { ...opts, headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`GitHub ${opts.method || "GET"} ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  };
  const attempt = Number(ATTEMPT) || 1;
  const jobs = (await api(`/actions/runs/${RUN_ID}/attempts/${attempt}/jobs?per_page=100`)).jobs || [];
  const failed = jobs.filter((j) => j.conclusion === "failure" || j.conclusion === "timed_out");
  const steps = failed.flatMap((j) => (j.steps || []).filter((s) => s.conclusion && s.conclusion !== "success" && s.conclusion !== "skipped"));
  const log = await readFile(LOG_FILE, "utf8").catch(() => "");
  let d = decide(log, steps, attempt);
  // An app build sent to TestFlight or Google Play is never re-run by itself: its build number may already be taken.
  if (d.rerun && EVENT !== "pull_request" && /^(iPhone app|Android app)$/.test(WORKFLOW)) d = { rerun: false, real: false, why: d.why, title: `Not re-run (app release build): ${d.why}` };
  const jobNames = failed.map((j) => j.name).join(", ") || "none listed";
  const summary = [
    `**${WORKFLOW}** (try ${attempt} of ${MAX_ATTEMPTS}) failed in: ${jobNames}.`,
    d.rerun ? `Looks like ${d.why}, not the app. The failed jobs run again in ${Math.round(d.wait / 60 * 10) / 10} min.`
      : d.real ? `This looks like a real failure (${d.why}), so it is not re-run. The thread that owns this pull request fixes it.`
      : `Not re-run again: ${d.why}. Re-run it by hand once the server is back.`,
    `Run: https://github.com/${REPO}/actions/runs/${RUN_ID}`,
  ].join("\n\n");
  console.log(d.title + "\n" + summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${d.title}\n\n${summary}\n`);
  if (HEAD_SHA) await api(`/check-runs`, { method: "POST", body: JSON.stringify({ name: `Auto re-run: ${WORKFLOW}`, head_sha: HEAD_SHA, status: "completed", conclusion: "neutral", output: { title: d.title.slice(0, 200), summary } }) }).catch((e) => console.log("::warning::" + e.message));
  if (d.rerun) {
    await new Promise((ok) => setTimeout(ok, d.wait * 1000));
    // A newer push may have replaced this run in the meantime: then there's nothing to re-run.
    const run = await api(`/actions/runs/${RUN_ID}`);
    if (run.status !== "completed" || run.run_attempt !== attempt) { console.log("The run changed meanwhile (re-run by hand or a newer try): left alone."); process.exit(0); }
    await api(`/actions/runs/${RUN_ID}/rerun-failed-jobs`, { method: "POST", body: "{}" });
    console.log("Failed jobs started again.");
  }
}
