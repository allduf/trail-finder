// Merges main into one PR branch and fixes ONLY the conflicts that come from parallel PRs touching the same shared
// lines (alex, 2026-11-10: "with auto merge I don't see when there is a conflict"):
//   data/changelog.json     both sides' new lines are kept (the PR's on top), lines one side removed stay removed
//   scripts/i18n/fr-*.txt   both sides' French lines are kept
//   scripts/i18n/rules.js   only where BOTH sides just added lines at the same spot (nothing changed or removed)
//   i18n-fr.js              made again from scripts/i18n/ (node scripts/i18n/build.mjs), never merged by hand
//   ?v=N and sw.js tf-N     a spot where the two sides differ ONLY in these numbers takes main's text, then the whole
//                           site gets one new number above main and every open PR
// Anything else that conflicts (real code) is NOT touched: the merge is aborted and the caller comments on the PR.
// Used by scripts/pr-fix/run.mjs (the "Fix PR conflicts" workflow); tested by scripts/pr-fix/test.mjs.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function git(dir, args, opts = {}) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", opts.quiet ? "ignore" : "pipe"], maxBuffer: 1 << 28, ...opts });
}
function tryGit(dir, args) {
  try { return { ok: true, out: git(dir, args, { quiet: true }) }; } catch (e) { return { ok: false, out: String(e.stdout || "") }; }
}
function show(dir, spec) { const r = tryGit(dir, ["show", spec]); return r.ok ? r.out : null; }

// The site's one shared script number: the most common ?v= in index.html (theme.css?v=20 and the like have their own).
export function sharedVersion(indexHtml) {
  if (!indexHtml) return null;
  const n = {};
  for (const m of indexHtml.matchAll(/\?v=(\d+)/g)) n[m[1]] = (n[m[1]] || 0) + 1;
  const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 5 ? +best[0] : null;
}
export function versionAt(dir, rev) { return sharedVersion(show(dir, `${rev}:index.html`)); }
function swAt(dir, rev) { const s = show(dir, `${rev}:sw.js`); const m = s && /const VERSION = "tf-(\d+)"/.exec(s); return m ? +m[1] : null; }

// ---- line merges ----
const norm = (l) => l.trim().replace(/,$/, "");
// Three-way merge of a list of independent lines (order kept from main; the PR's new lines go on top or at the end).
function setMerge(base, ours, theirs, oursOnTop) {
  const B = new Set(base.map(norm)), O = new Set(ours.map(norm)), T = new Set(theirs.map(norm));
  const added = [], seen = new Set();
  for (const l of ours) { const k = norm(l); if (k && !T.has(k) && !B.has(k) && !seen.has(k)) { added.push(l); seen.add(k); } }
  const kept = theirs.filter((l) => { const k = norm(l); return !k || !(B.has(k) && !O.has(k)); });
  return oursOnTop ? [...added, ...kept] : [...kept, ...added];
}
const lines = (s) => (s || "").replace(/\n$/, "").split("\n");

function mergeChangelog(base, ours, theirs) {
  const isItem = (l) => /^\s*\{"date"/.test(l);
  const split = (s) => {
    const L = lines(s), first = L.findIndex(isItem);
    if (first < 0) return null;
    let last = L.length - 1; while (!isItem(L[last])) last--;
    if (!L.slice(first, last + 1).every(isItem)) return null;   // something else between the lines: not ours to fix
    return { head: L.slice(0, first), items: L.slice(first, last + 1), tail: L.slice(last + 1) };
  };
  const o = split(ours), t = split(theirs), b = base ? split(base) : { items: [] };
  if (!o || !t || !b) return null;
  if (o.head.join("\n") !== t.head.join("\n") || o.tail.join("\n") !== t.tail.join("\n")) return null;   // the "about" text itself changed on both
  const items = setMerge(b.items, o.items, t.items, true).map((l) => l.replace(/,\s*$/, ""));
  const out = [...t.head, ...items.map((l, i) => (i < items.length - 1 ? l + "," : l)), ...t.tail].join("\n") + "\n";
  try { JSON.parse(out); } catch { return null; }
  return out;
}

function mergeLinesFile(base, ours, theirs) { return setMerge(lines(base), lines(ours), lines(theirs), false).join("\n") + "\n"; }

// git merge-file with the base shown, so each conflicting spot can be judged on its own.
function hunks(dir, base, ours, theirs) {
  const tmp = join(dir, ".git", "pr-fix-");
  writeFileSync(tmp + "o", ours); writeFileSync(tmp + "b", base ?? ""); writeFileSync(tmp + "t", theirs);
  let out;
  try { out = git(dir, ["merge-file", "-p", "--diff3", tmp + "o", tmp + "b", tmp + "t"], { quiet: true }); }
  catch (e) { out = String(e.stdout || ""); }
  // split into plain lines and conflicting spots {ours, base, theirs} (each a list of whole lines)
  const parts = [];
  let cur = null, mode = null;
  for (const l of out.split("\n")) {
    if (!cur && l.startsWith("<<<<<<< ")) { cur = { ours: [], base: [], theirs: [] }; mode = "ours"; }
    else if (cur && l.startsWith("||||||| ")) mode = "base";
    else if (cur && l === "=======") mode = "theirs";
    else if (cur && l.startsWith(">>>>>>> ")) { parts.push(cur); cur = null; }
    else if (cur) cur[mode].push(l);
    else parts.push(l);
  }
  return cur ? null : parts;
}
function rebuild(parts, pick) {
  if (!parts) return null;
  const L = [];
  for (const p of parts) {
    if (typeof p === "string") { L.push(p); continue; }
    const r = pick(p); if (r === null) return null;
    L.push(...r);
  }
  return L.join("\n");
}

const vnorm = (a) => a.join("\n").replace(/\?v=\d+/g, "?v=#").replace(/\btf-\d+\b/g, "tf-#");
const versionOnly = (h) => (vnorm(h.ours) === vnorm(h.theirs) ? h.theirs : null);
const bothAdded = (h) => (h.base.every((l) => !l.trim()) ? [...h.ours, ...h.theirs.filter((l) => !h.ours.includes(l))] : null);

// Fix one file in conflict; returns the new text, or null when it is a real conflict.
function resolveFile(dir, path) {
  const base = show(dir, `:1:${path}`), ours = show(dir, `:2:${path}`), theirs = show(dir, `:3:${path}`);
  if (path === "i18n-fr.js") return ours !== null && theirs !== null ? "REBUILD" : null;
  if (ours === null || theirs === null) return null;   // deleted on one side
  if (path === "data/changelog.json") return mergeChangelog(base, ours, theirs);
  if (/^scripts\/i18n\/fr-[^/]*\.txt$/.test(path)) return mergeLinesFile(base, ours, theirs);
  const parts = hunks(dir, base, ours, theirs);
  const pick = path === "scripts/i18n/rules.js" ? (h) => versionOnly(h) ?? bothAdded(h) : versionOnly;
  return rebuild(parts, pick);
}

// Every tracked page and script the site loads (the shared ?v= lives in these).
function siteFiles(dir) {
  return git(dir, ["ls-files", "*.html", "*.js"]).split("\n").filter((f) => f && !/^(scripts|ios-app|supabase|node_modules)\//.test(f));
}
function setVersion(dir, from, to, swFrom, swTo) {
  const re = new RegExp(`\\?v=(${from.join("|")})(?!\\d)`, "g"), changed = [];
  for (const f of siteFiles(dir)) {
    const p = join(dir, f), s = readFileSync(p, "utf8");
    let t = s.replace(re, `?v=${to}`);
    if (f === "sw.js") t = t.replace(new RegExp(`const VERSION = "tf-(${swFrom.join("|")})"`), `const VERSION = "tf-${swTo}"`);
    if (t !== s) { writeFileSync(p, t); changed.push(f); }
  }
  return changed;
}

// Main entry. dir: a clean checkout of the PR branch (HEAD). main: e.g. "origin/main". others: the shared ?v= of every
// other open PR (so the new number is above all of them).
// Returns { status: "skip" | "fixed" | "conflict", files: [...], version?, message }
export function fixBranch(dir, main, others = []) {
  const head = git(dir, ["rev-parse", "HEAD"]).trim();
  const mergeBase = tryGit(dir, ["merge-base", "HEAD", main]);
  if (!mergeBase.ok) return { status: "conflict", files: [], message: "no common history with main" };
  const mb = mergeBase.out.trim();
  const vMain = versionAt(dir, main), vHead = versionAt(dir, "HEAD"), vBase = versionAt(dir, mb);
  const swMain = swAt(dir, main), swHead = swAt(dir, "HEAD"), swBase = swAt(dir, mb);
  const prBumped = vHead !== null && vHead !== vBase;
  const upToDate = tryGit(dir, ["merge-base", "--is-ancestor", main, "HEAD"]).ok;
  const versionLow = prBumped && vMain !== null && vHead <= vMain;
  if (upToDate && !versionLow) return { status: "skip", files: [], message: "up to date" };

  const merged = tryGit(dir, ["merge", "--no-ff", "--no-commit", main]);
  const unmerged = git(dir, ["diff", "--name-only", "--diff-filter=U"]).split("\n").filter(Boolean);
  if (merged.ok && unmerged.length === 0 && !versionLow) {
    git(dir, ["merge", "--abort"], { quiet: true });   // GitHub can merge this one by itself
    return { status: "skip", files: [], message: "merges cleanly" };
  }
  const bad = [];
  let rebuildFr = false;
  for (const f of unmerged) {
    const r = resolveFile(dir, f);
    if (r === null) { bad.push(f); continue; }
    if (r === "REBUILD") { rebuildFr = true; continue; }
    writeFileSync(join(dir, f), r);
  }
  if (bad.length) {
    git(dir, ["merge", "--abort"], { quiet: true });
    return { status: "conflict", files: bad, message: "real conflicts" };
  }
  // conflicted files we fixed by hand: mark them resolved (i18n-fr.js is made again below)
  for (const f of unmerged) if (f !== "i18n-fr.js") git(dir, ["add", "--", f]);

  // one shared number for the whole site
  let version = null;
  if (prBumped || unmerged.some((f) => f !== "i18n-fr.js" && !/^data\/|^scripts\/i18n\//.test(f))) {
    if (prBumped) {
      const top = Math.max(vMain ?? 0, ...others.filter((n) => Number.isFinite(n)));
      version = vHead > top ? vHead : top + 10;
    } else version = vMain;   // the PR never bumped: the only numbers in play are main's
    const off = vMain !== null && swMain !== null ? vMain - swMain : vHead - swHead;
    const fromV = [...new Set([vMain, vHead, vBase].filter((n) => n !== null && n !== version))];
    const fromSw = [...new Set([swMain, swHead, swBase].filter((n) => n !== null && n !== version - off))];
    if (fromV.length || fromSw.length) {
      const changed = setVersion(dir, fromV.length ? fromV : [-1], version, fromSw.length ? fromSw : [-1], version - off);
      if (changed.length) git(dir, ["add", "--", ...changed]);
    }
  }
  // French: always made again from the word lists, so it can never be half of each side
  if (existsSync(join(dir, "scripts/i18n/build.mjs"))) {
    execFileSync("node", ["scripts/i18n/build.mjs"], { cwd: dir, stdio: "ignore" });
    execFileSync("node", ["--check", "i18n-fr.js"], { cwd: dir, stdio: "ignore" });
    git(dir, ["add", "--", "i18n-fr.js"]);
  } else if (rebuildFr) {
    git(dir, ["merge", "--abort"], { quiet: true });
    return { status: "conflict", files: ["i18n-fr.js"], message: "no French builder" };
  }
  // last safety net: no conflict markers anywhere we touched, the changelog still reads
  const touched = git(dir, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  for (const f of touched) {
    if (!existsSync(join(dir, f))) continue;
    const s = readFileSync(join(dir, f), "utf8");
    if (/^(<<<<<<<|>>>>>>>) /m.test(s) || /^\|\|\|\|\|\|\| /m.test(s)) {
      git(dir, ["merge", "--abort"], { quiet: true });
      return { status: "conflict", files: [f], message: "conflict marker left" };
    }
  }
  JSON.parse(readFileSync(join(dir, "data/changelog.json"), "utf8"));
  const fixed = unmerged.length ? unmerged.join(", ") : "none";
  const msg = `Merge main into this PR (conflicts fixed automatically: ${fixed}${version !== null ? `; ?v=${version}` : ""})`;
  const merging = tryGit(dir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok;
  if (!merging && !touched.length) return { status: "skip", files: [], message: "nothing to change" };
  git(dir, ["commit", "-q", "--no-verify", "-m", msg]);
  return { status: "fixed", files: unmerged, version, head, message: msg };
}
