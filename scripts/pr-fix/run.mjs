// The "Fix PR conflicts" workflow: after main changes, every open PR is checked and the conflicts that only come from
// parallel PRs (changelog lines, French lines, the shared ?v= / tf- number) are fixed and pushed, so auto-merge keeps
// going without alex opening GitHub's conflict page (alex, 2026-11-10). Real code conflicts are never touched: the PR
// gets one comment naming the files, and the thread working on it merges main by hand.
// A PR is left alone if it is a draft, comes from a fork, targets another branch, or has the label "no-auto-fix".
// Needs GH_TOKEN and GITHUB_REPOSITORY. Test without GitHub: node scripts/pr-fix/test.mjs
import { execFileSync } from "node:child_process";
import { fixBranch, git, versionAt } from "./resolve.mjs";

const dir = process.cwd(), repo = process.env.GITHUB_REPOSITORY;
const gh = (args, input) => execFileSync("gh", args, { encoding: "utf8", input, maxBuffer: 1 << 26 });
const MARK = "<!-- pr-fix:conflict:";

git(dir, ["fetch", "-q", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"]);
const prs = JSON.parse(gh(["pr", "list", "--repo", repo, "--state", "open", "--base", "main", "--limit", "100",
  "--json", "number,headRefName,headRefOid,isDraft,isCrossRepository,labels,title"]))
  .filter((p) => !p.isDraft && !p.isCrossRepository && !p.labels.some((l) => l.name === "no-auto-fix"))
  .sort((a, b) => a.number - b.number);   // oldest first: they usually merge first
console.log(`${prs.length} open PRs to check`);

const versions = new Map();
for (const p of prs) { try { versions.set(p.number, versionAt(dir, `origin/${p.headRefName}`)); } catch { /* branch gone */ } }

function commentOnce(p, sha, body) {
  const old = JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/issues/${p.number}/comments?per_page=100`])).flat();
  if (old.some((c) => (c.body || "").includes(`${MARK}${sha} -->`))) return;
  gh(["api", "-X", "POST", `repos/${repo}/issues/${p.number}/comments`, "--input", "-"], JSON.stringify({ body: `${MARK}${sha} -->\n${body}` }));
}

// The required iPhone test on the commit just pushed. GitHub holds the PR's own test run of a push made by this
// workflow as "waiting for approval" (seen on #710, 2026-11-10), and that waiting run can leave the PR "blocked" even
// once another phone run passed. So: start that held run again (it then runs like any PR test); if there is none or
// GitHub refuses, start the test by hand on the branch instead.
function startPhoneTest(p, sha) {
  let held = [];
  for (let i = 0; i < 6 && !held.length; i++) {
    execFileSync("sleep", ["10"]);
    try {
      held = JSON.parse(gh(["api", `repos/${repo}/actions/workflows/phone-test.yml/runs?head_sha=${sha}&event=pull_request&per_page=10`]))
        .workflow_runs.filter((r) => r.conclusion === "action_required");
    } catch { /* try again */ }
  }
  let restarted = false;
  for (const r of held) {
    try { gh(["api", "-X", "POST", `repos/${repo}/actions/runs/${r.id}/rerun`]); restarted = true; console.log(`#${p.number}: started the held phone test again (run ${r.id})`); }
    catch (e) { console.log(`#${p.number}: could not restart held run ${r.id}: ${String(e.stderr || e.message).split("\n")[0]}`); }
  }
  if (restarted) {
    execFileSync("sleep", ["15"]);
    const again = JSON.parse(gh(["api", `repos/${repo}/actions/runs/${held[0].id}`]));
    if (again.status !== "completed" || again.conclusion !== "action_required") return;
    console.log(`#${p.number}: the restarted run is held again`);
  }
  try { gh(["workflow", "run", "phone-test.yml", "--repo", repo, "--ref", p.headRefName]); console.log(`#${p.number}: started the phone test on the branch`); }
  catch (e) { console.log(`#${p.number}: could not start the phone test: ${e.message}`); }
}

let fixed = 0, stuck = 0;
for (const p of prs) {
  const others = [...versions].filter(([n]) => n !== p.number).map(([, v]) => v);
  git(dir, ["checkout", "-q", "-f", "-B", "pr-fix-work", `origin/${p.headRefName}`]);
  git(dir, ["clean", "-qfd"]);
  let r;
  try { r = fixBranch(dir, "origin/main", others); }
  catch (e) {
    try { git(dir, ["merge", "--abort"], { quiet: true }); } catch { /* not merging */ }
    r = { status: "conflict", files: [], message: `the fixer stopped: ${String(e.message).split("\n")[0]}` };
  }
  console.log(`#${p.number} ${p.headRefName}: ${r.status} ${r.message}${r.files.length ? " [" + r.files.join(", ") + "]" : ""}`);
  if (r.status === "fixed") {
    try {
      // a plain push: if the thread pushed in the meantime this fails and the next run tries again
      git(dir, ["push", "-q", "origin", `HEAD:refs/heads/${p.headRefName}`]);
    } catch (e) {
      console.log(`#${p.number}: push refused (${String(e.stderr || e.message).split("\n").find((l) => l.trim()) || ""}); next run tries again`);
      if (/workflow/i.test(String(e.stderr || ""))) {
        commentOnce(p, p.headRefOid, "Main changed and this PR needs main merged in, but the merge brings changes to `.github/workflows/`, which the automatic fixer is not allowed to push. Please merge main into this branch by hand.");
        stuck++;
      }
      continue;
    }
    if (r.version) versions.set(p.number, r.version);
    startPhoneTest(p, git(dir, ["rev-parse", "HEAD"]).trim());
    fixed++;
  } else if (r.status === "conflict") {
    stuck++;
    const files = r.files.length ? r.files.map((f) => "`" + f + "`").join(", ") : "(see the workflow log)";
    commentOnce(p, p.headRefOid, [
      `**Merge conflict that can't be fixed automatically.** Main changed and this PR now conflicts in: ${files}.`,
      "",
      "Changelog lines, French lines and the shared `?v=` / `tf-` number are fixed automatically, but this is a real code conflict, so nothing was changed. Auto-merge is waiting: merge main into this branch and resolve it by hand.",
      r.message && !/^real conflicts$/.test(r.message) ? `\nDetail: ${r.message}` : "",
    ].join("\n"));
  }
}
console.log(`done: ${fixed} fixed, ${stuck} need a hand`);
