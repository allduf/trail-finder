// Tries scripts/pr-fix/resolve.mjs on made-up PRs in a throwaway copy of this repo: node scripts/pr-fix/test.mjs
// Two PRs both add a changelog line, a French line (same new fr-N.txt), a rule, and bump ?v= to the same number;
// one more PR has a real code conflict, which must be left alone.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixBranch, git, versionAt } from "./resolve.mjs";

const repo = new URL("../../", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "pr-fix-test-"));
let fails = 0;
const ok = (c, what) => { console.log((c ? "ok   " : "FAIL ") + what); if (!c) fails++; };
try {
  git(tmpdir(), ["clone", "-q", "--no-hardlinks", repo, dir]);
  git(dir, ["checkout", "-q", "-B", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]); git(dir, ["config", "user.name", "test"]);
  const g = (...a) => git(dir, a);
  const read = (f) => readFileSync(join(dir, f), "utf8");
  const write = (f, s) => writeFileSync(join(dir, f), s);
  const v0 = versionAt(dir, "HEAD"), sw0 = +/tf-(\d+)/.exec(read("sw.js"))[1];
  const bump = (to) => {
    for (const f of g("ls-files", "*.html", "*.js").split("\n").filter((f) => f && !f.startsWith("scripts/"))) {
      const s = read(f), t = s.replaceAll(`?v=${v0}`, `?v=${to}`).replace(`"tf-${sw0}"`, `"tf-${sw0 + to - v0}"`);
      if (t !== s) write(f, t);
    }
  };
  const change = (name, text, fr, rule, to, extra) => {
    g("checkout", "-q", "-b", name, "main");
    const c = read("data/changelog.json").replace('"items": [\n', `"items": [\n    {"date": "2026-11-10", "text": "${text}"},\n`);
    write("data/changelog.json", c);
    write("scripts/i18n/fr-99.txt", `${text} ||| ${fr}\n`);
    write("scripts/i18n/rules.js", read("scripts/i18n/rules.js").replace("  var R = [\n", `  var R = [\n    [/^${rule} (\\d+)$/, "${rule} FR $1"],\n`));
    if (to) bump(to);
    if (extra) extra();
    execFileSync("node", ["scripts/i18n/build.mjs"], { cwd: dir, stdio: "ignore" });
    g("add", "-A"); g("commit", "-q", "-m", name);
  };
  // first PR: goes into main
  change("pr-a", "Change A", "Changement A", "Alpha", v0 + 10, () => write("map3d.js", read("map3d.js").replace(/\n/, "\n// change A\n")));
  // second PR: same files, same new number
  change("pr-b", "Change B", "Changement B", "Bravo", v0 + 10, () => write("hike.js", "// change B\n" + read("hike.js")));
  // third PR: changes the very same code line as A differently
  change("pr-c", "Change C", "Changement C", "Charlie", v0 + 10, () => write("map3d.js", read("map3d.js").replace(/\n/, "\n// change C, different\n")));
  // fifth PR: a different number than A, so every ?v= line conflicts
  change("pr-e", "Change E", "Changement E", "Echo", v0 + 30, () => write("ask.js", "// change E\n" + read("ask.js")));
  // sixth PR: only the same number as A, nothing else in common (merges cleanly, but the number must still move up)
  g("checkout", "-q", "-b", "pr-f", "main"); bump(v0 + 10); write("lifts.js", "// change F\n" + read("lifts.js")); g("add", "-A"); g("commit", "-q", "-m", "pr-f");
  // fourth PR: data only, no number
  g("checkout", "-q", "-b", "pr-d", "main"); write("data/x.json", "{}\n"); g("add", "-A"); g("commit", "-q", "-m", "pr-d");
  g("checkout", "-q", "main"); g("merge", "-q", "--no-ff", "pr-a", "-m", "merge A");

  g("checkout", "-q", "pr-b");
  const rb = fixBranch(dir, "main", [v0 + 10]);
  ok(rb.status === "fixed", `PR B fixed (${rb.message})`);
  ok(g("merge-base", "--is-ancestor", "main", "HEAD") === "", "PR B now has main in it");
  const cl = JSON.parse(read("data/changelog.json")).items.slice(0, 2).map((i) => i.text).join(" / ");
  ok(cl === "Change B / Change A", `changelog keeps both, PR on top: ${cl}`);
  ok(/Change A \|\|\| Changement A/.test(read("scripts/i18n/fr-99.txt")) && /Change B \|\|\| Changement B/.test(read("scripts/i18n/fr-99.txt")), "French list keeps both lines");
  ok(read("i18n-fr.js").includes("Changement A") && read("i18n-fr.js").includes("Changement B") && read("i18n-fr.js").includes("Alpha FR") && read("i18n-fr.js").includes("Bravo FR"), "French made again with both sides");
  ok(versionAt(dir, "HEAD") === v0 + 20 && !read("index.html").includes(`?v=${v0 + 10}"`), `one new number above main: ?v=${versionAt(dir, "HEAD")}`);
  ok(read("sw.js").includes(`"tf-${sw0 + 20}"`), "sw.js tf- number moved with it");
  ok(read("map3d.js").includes("// change A") && read("hike.js").startsWith("// change B"), "both sides' code is there");
  let markers = ""; try { markers = g("grep", "-l", "-e", "^<<<<<<< ", "-e", "^>>>>>>> "); } catch { /* none found */ }
  ok(markers === "", "no conflict markers");

  g("checkout", "-q", "pr-c");
  const before = g("rev-parse", "HEAD");
  const rc = fixBranch(dir, "main", []);
  ok(rc.status === "conflict" && rc.files.includes("map3d.js") && rc.files.length === 1, `real code conflict left alone: ${rc.files.join(", ")}`);
  ok(g("rev-parse", "HEAD") === before && g("status", "--porcelain") === "", "PR C untouched and clean");

  g("checkout", "-q", "pr-e");
  const re = fixBranch(dir, "main", [v0 + 10]);   // the other open PRs, not this one
  ok(re.status === "fixed" && versionAt(dir, "HEAD") === v0 + 30 && read("ask.js").startsWith("// change E") && read("map3d.js").includes("// change A"), `?v= lines in conflict: PR keeps its higher number ?v=${versionAt(dir, "HEAD")}`);
  ok(!read("index.html").includes(`?v=${v0 + 10}"`) && read("sw.js").includes(`"tf-${sw0 + 30}"`), "no old number left");

  g("checkout", "-q", "pr-f");
  const rf = fixBranch(dir, "main", [v0 + 10, v0 + 30]);
  ok(rf.status === "fixed" && versionAt(dir, "HEAD") === v0 + 40 && read("lifts.js").startsWith("// change F"), `same number as main, no conflict: moved above every PR to ?v=${versionAt(dir, "HEAD")}`);

  g("checkout", "-q", "pr-d");
  ok(fixBranch(dir, "main", []).status === "skip", "data-only PR that merges cleanly is skipped");
} catch (e) {
  console.error(e); fails++;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
