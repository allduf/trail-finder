// Auto re-run (alex 2026-11-27: "make it fix itself automatically when a test failed").
// Called by .github/workflows/auto-retry.yml when a check run fails. Reads the failed steps' log and decides:
//   - a server or runner hiccup (Maven Central 429, a map or package server 5xx, a dropped connection, a runner that
//     went away, a slow mirror during install): re-run the failed jobs after a pause, once;
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
// Only steps that never run the pull request's own code (npm ci of a changed lock file would be the pull request's fault).
const SETUP_STEP = /^(?:Set up job|Run actions\/(?:checkout|setup-node|setup-java|upload-artifact|download-artifact)@\S+|Install the test browser|Add the data jobs' files)$/;

export const MAX_ATTEMPTS = 2;   // the first run + one re-run (trail-finder-merge-queue skill: infrastructure = re-run once)
// A log that also names a failed test (✗ lines, "N check(s) failed") may hold a real failure next to the hiccup (a
// simulator's log is full of network lines): then one re-run only, and a second failure is treated as real.
const TEST_FAILED = /✗|\d+ check\(s\) failed/;

// Only the end of each failed step's log is searched for a hiccup (a step stops right after the error that failed it;
// a recovered timeout earlier in a long Gradle or simulator log is not the cause). `gh run view --log-failed` starts
// each line with "<job>\t<step>\t".
export function tails(text, n = 60) {
  const by = new Map();
  for (const line of text.split("\n")) {
    const k = line.split("\t", 2).join("\t");
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(line);
  }
  return [...by.values()].map((l) => l.slice(-n).join("\n")).join("\n");
}

// log: text of the failed steps. steps: [{name, conclusion}] of the failed jobs. attempt: the run's attempt number.
export function decide(log, steps, attempt) {
  const hit = (list) => { for (const [re, why, wait] of list) if (re.test(log)) return { why, wait }; return null; };
  let t = null;
  const end = tails(log);
  for (const [re, why, wait] of TRANSIENT) if (re.test(end)) { t = { why, wait }; break; }
  if (!t) {
    const bad = steps.find((s) => s.conclusion === "failure" || s.conclusion === "cancelled" || s.conclusion === "timed_out");
    if (bad && SETUP_STEP.test(bad.name)) t = { why: `the setup step "${bad.name}" failed (runner or network)`, wait: 90 };
  }
  if (t) {
    if (TEST_FAILED.test(log) && attempt >= 2) return { rerun: false, real: true, why: t.why, title: "Real failure: a test failed again after a re-run" };
    if (attempt >= MAX_ATTEMPTS) return { rerun: false, real: true, why: t.why, title: `Failed ${attempt} times: likely a real failure` };
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
    ["> Could not GET 'https://repo.maven.apache.org/x.pom'. Received status code 429 from server: Too Many Requests", [], 2, false],
    ["Error: HTTP 502 from tiles.openfreemap.org", [], 1, true],
    ["npm ERR! code ECONNRESET", [], 1, true],
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
    ["", [{ name: "Install", conclusion: "failure" }], 1, false],
    ["j\tBuild\tRead timed out, retrying\n" + "j\tBuild\tcompiling\n".repeat(80) + "j\tBuild\te: Unresolved reference: foo", [], 1, false],
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
// Re-runs started with the workflow's own token may not start this workflow again when they finish, so after a re-run
// this job watches it (every minute, up to WATCH_MIN) and decides again on its result. DRY_RUN=1: decide and print only.
if (process.argv.includes("--run")) {
  const { REPO, RUN_ID, WORKFLOW, HEAD_SHA } = process.env;
  const WATCH_MIN = Number(process.env.WATCH_MIN) || 150;
  const { appendFile } = await import("node:fs/promises");
  const { execFileSync } = await import("node:child_process");
  const sleep = (s) => new Promise((ok) => setTimeout(ok, s * 1000));
  // Through the gh command (GH_TOKEN in the workflow, the signed-in account by hand).
  const api = async (path, opts = {}) => {
    const args = ["api", "-X", opts.method || "GET", `repos/${REPO}${path}`];
    if (opts.body) args.push("--input", "-");
    const out = execFileSync("gh", args, { input: opts.body || "", maxBuffer: 64 << 20 }).toString();
    return out.trim() ? JSON.parse(out) : null;
  };
  // Heavy runs (scripts/ci/heavy-slot.sh) go again whole, so their "slot" job waits for a free slot again too.
  const slot = await (await import("node:fs/promises")).readFile(new URL("./heavy-slot.sh", import.meta.url), "utf8");
  const HEAVY = JSON.parse((slot.match(/^HEAVY='(.*)'$/m) || [, "[]"])[1]);
  const heavy = HEAVY.includes(WORKFLOW);
  const checkName = `Auto re-run: ${WORKFLOW}`;
  const note = async (title, summary) => {
    console.log(title + "\n" + summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${title}\n\n${summary}\n`);
    if (HEAD_SHA && !process.env.DRY_RUN) await api(`/check-runs`, { method: "POST", body: JSON.stringify({ name: checkName, head_sha: HEAD_SHA, status: "completed", conclusion: "neutral", output: { title: title.slice(0, 200), summary } }) }).catch((e) => console.log("::warning::" + e.message));
  };
  let run = await api(`/actions/runs/${RUN_ID}`);
  if (run.status !== "completed" || run.conclusion !== "failure" || run.run_attempt !== Number(process.env.ATTEMPT)) {
    console.log("This try is already being handled (a newer try started, or another copy of this job watches it): left alone."); process.exit(0);
  }
  for (;;) {
    const attempt = run.run_attempt;
    const jobs = (await api(`/actions/runs/${RUN_ID}/attempts/${attempt}/jobs?per_page=100`)).jobs || [];
    const failed = jobs.filter((j) => j.conclusion === "failure" || j.conclusion === "timed_out");
    const steps = failed.flatMap((j) => (j.steps || []).filter((s) => s.conclusion && s.conclusion !== "success" && s.conclusion !== "skipped"));
    let log = "";
    try { log = execFileSync("gh", ["run", "view", String(RUN_ID), "-R", REPO, "--attempt", String(attempt), "--log-failed"], { maxBuffer: 256 << 20 }).toString(); } catch (e) { console.log("::warning::could not read the log: " + String(e.message).slice(0, 200)); }
    let d = decide(log, steps, attempt);
    // An app build sent to TestFlight or Google Play is never re-run by itself: its build number may already be taken.
    if (d.rerun && failed.some((j) => /testflight|play-build/i.test(j.name))) d = { rerun: false, real: false, why: d.why, title: `Not re-run (app release build): ${d.why}` };
    const jobNames = failed.map((j) => j.name).join(", ") || "none listed";
    await note(d.title, [
      `**${WORKFLOW}** (try ${attempt} of ${MAX_ATTEMPTS}) failed in: ${jobNames}.`,
      d.rerun ? `Looks like ${d.why}, not the app. ${heavy ? "The whole run" : "The failed jobs"} run again in ${Math.round(d.wait / 6) / 10} min.`
        : d.real ? `This looks like a real failure (${d.why}), so it is not re-run again. The thread that owns this pull request fixes it.`
        : `Not re-run: ${d.why}. Start it again by hand.`,
      `Run: https://github.com/${REPO}/actions/runs/${RUN_ID}`,
    ].join("\n\n"));
    if (!d.rerun || process.env.DRY_RUN) break;
    await sleep(d.wait);
    run = await api(`/actions/runs/${RUN_ID}`);
    if (run.status !== "completed" || run.run_attempt !== attempt) { console.log("The run changed meanwhile (started again by hand): left alone."); break; }
    await api(`/actions/runs/${RUN_ID}/${heavy ? "rerun" : "rerun-failed-jobs"}`, { method: "POST", body: "{}" });
    console.log(`Started try ${attempt + 1}.`);
    const until = Date.now() + WATCH_MIN * 60000;
    do { await sleep(60); run = await api(`/actions/runs/${RUN_ID}`).catch(() => run); } while ((run.status !== "completed" || run.run_attempt === attempt) && Date.now() < until);
    if (run.status !== "completed") { await note(`Re-run still going after ${WATCH_MIN} min`, `**${WORKFLOW}** try ${run.run_attempt} is still running; its result shows in the checks.`); break; }
    if (run.conclusion !== "failure") { await note(`Passed on try ${run.run_attempt}`, `**${WORKFLOW}** ${run.conclusion === "success" ? "passed" : "ended (" + run.conclusion + ")"} on try ${run.run_attempt}: the first failure was ${d.why}.`); break; }
  }
}
