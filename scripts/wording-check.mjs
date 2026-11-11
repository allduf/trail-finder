// Liability-safe wording check (alex, 2026-11-11: "make the wording the most liability safe", "it apply to everything we
// add in the future"). Fails when text the app shows promises safety, accuracy or conditions. Runs in the phone test
// (.github/workflows/phone-test.yml) and by hand: node scripts/wording-check.mjs
//
// How to word things instead: say what the map, model or source shows ("the terrain map shows...", "from Avalanche
// Canada", "a weather model's guess"), use "usually", "may", "estimate", and say what it can miss. Never call a place,
// route, slope or ice safe, never promise a road, trail or season is open or allowed, no travel advice on routes.
// A line that only says something is NOT safe or NOT a guarantee is fine (the words just before the match are checked).
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const files = readdirSync(root).filter((f) => (/\.js$/.test(f) && f !== "i18n-fr.js" && f !== "sw.js") || (/\.html$/.test(f) && !/^(terms|privacy)\.html$/.test(f)));   // the legal pages talk about these words
const BAD = [
  [/\bsafe (route|way|spot|place|ground|terrain|zone|line|ice|area|slope|path|crossing)s?\b/i, "calls a place or route safe"],
  [/\b(is|are|it's|looks|stays?|be) (avalanche-)?safe\b/i, "says something is safe"],
  [/\bsafe(st|r)\b/i, "\"safer\"/\"safest\": say \"less exposed\" and what the map shows"],
  [/\bsafely\b/i, "promises it can be done safely"],
  [/\bguarantee[ds]?\b/i, "promises a guarantee"],
  [/\b(avalanche-free|no avalanche (risk|danger|hazard)|can't slide|won't slide|can't avalanche)\b/i, "promises no avalanche"],
  [/\bclean air\b/i, "promises clean air"],
  [/\b(good to go|all clear|no risk|risk-free|nothing to worry)\b/i, "an all-clear"],
  [/\bstill rideable\b/i, "riding advice on conditions"],
  [/\b(go one at a time|don't stop|regroup (here|at|point))\b/i, "travel advice on a route (no-route-advice rule)"],
  [/\btrailforks\b/i, "never mention Trailforks in the app"],
];
const NEG = /(\bnot\b|n't\b|\bno\b|\bnever\b|\bnor\b|\bwithout\b|\bpromise|\bguess)[^.]{0,40}$/i;   // "not a guarantee", "doesn't mean the slope is safe"
let bad = 0;
for (const f of files) {
  readFileSync(new URL(f, root), "utf8").split("\n").forEach((raw, i) => {
    const t = raw.trim();
    if (/wording-ok/.test(raw)) return;   // a line that has to name the word (a word list, a filter): mark it // wording-ok
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("<!--")) return;
    const line = raw.replace(/\s\/\/\s.*$/, "").replace(/\/\*.*?\*\//g, "").replace(/<!--.*?-->/g, "");
    for (const [re, why] of BAD) {
      const m = re.exec(line);
      if (!m) continue;
      if (NEG.test(line.slice(Math.max(0, m.index - 60), m.index))) continue;
      // only text people see: inside quotes, a template or between tags (skips code like plan.safe)
      const before = line.slice(0, m.index);
      if (!/["'`>][^"'`<]*$/.test(before)) continue;
      console.log(`${f}:${i + 1}: ${why}: “${line.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).trim()}”`);
      bad++;
    }
  });
}
if (bad) {
  console.log(`\n${bad} line(s) word things in a way that could promise safety or conditions. Reword them (see the top of scripts/wording-check.mjs).`);
  process.exit(1);
}
console.log(`Wording check: ${files.length} files, nothing that promises safety or conditions.`);
