#!/usr/bin/env node
// Runs after Claude edits or writes a file (.claude/settings.json, PostToolUse). For the app's own .js and .html files
// it runs the wording check (scripts/wording-check.mjs) and the hand-set version check (scripts/stamp.mjs --check).
// On a problem it exits 2, so Claude sees the message and fixes it. Anything else: exit 0, quietly.
import { spawnSync } from "node:child_process";
import { relative, resolve } from "node:path";

let input = "";
for await (const chunk of process.stdin) input += chunk;
let file = "";
try { file = JSON.parse(input).tool_input?.file_path || ""; } catch { process.exit(0); }
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const rel = relative(root, resolve(root, file));
// Only top-level app files: the two checks read those (vendor/, scripts/ and data/ are not checked).
if (!/^[^/\\]+\.(js|html)$/.test(rel) || rel === "i18n-fr.js") process.exit(0);

const problems = [];
for (const args of [["scripts/wording-check.mjs"], ["scripts/stamp.mjs", "--check"]]) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 30000 });
  if (r.status !== 0) problems.push(`${args.join(" ")} failed:\n${(r.stdout || "") + (r.stderr || "")}`.trim());
}
if (problems.length) {
  console.error(`After editing ${rel}:\n\n${problems.join("\n\n")}\n\nFix this before going on (rules in CLAUDE.md).`);
  process.exit(2);
}
