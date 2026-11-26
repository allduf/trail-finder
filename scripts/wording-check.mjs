// Liability-safe wording check (alex, 2026-11-11: "make the wording the most liability safe", "it apply to everything we
// add in the future"). Fails when text the app shows promises safety, accuracy or conditions. Runs in the phone test
// (.github/workflows/phone-test.yml) and by hand: node scripts/wording-check.mjs
//
// How to word things instead: say what the map, model or source shows ("the terrain map shows...", "from Avalanche
// Canada", "a weather model's guess"), use "usually", "may", "estimate", and say what it can miss. Never call a place,
// route, slope or ice safe, never promise a road, trail or season is open or allowed, no travel advice on routes.
// A line that only says something is NOT safe or NOT a guarantee is fine (the words just before the match are checked).
//
// Since the wording sweep (2026-11-21) it also reads, besides the app's own pages and scripts:
//  - the hand-written data files on main (data/*.json: huts, heli and cat skiing, ski areas, trail info...) and the
//    What's new lines (data/changelog.d), since the app shows their text as is;
//  - the iPhone and Android apps' own texts (Swift, Java, strings.xml, Info.plist);
// and it fails on a colour emoji in the app's text that line-icons.js has no line drawing for (CLAUDE.md: "No emoji in
// the interface: use the line icons"). Add a drawing there, or mark a line that must keep the emoji (map pin kinds,
// a code test) with // emoji-ok. Plain symbols and arrows (★ ✓ ✕ ↗ ©) are text, not emoji.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const pages = readdirSync(root).filter((f) => (/\.js$/.test(f) && f !== "i18n-fr.js" && f !== "sw.js") || (/\.html$/.test(f) && !/^(terms|privacy)\.html$/.test(f)));   // the legal pages talk about these words
let tracked = [];
try { tracked = execSync("git ls-files", { cwd: new URL(".", root), encoding: "utf8" }).split("\n"); }
catch { console.log("Wording check: git ls-files failed, so the data files and the native apps' texts are not read this time."); }
// Data the app shows as is (the big built lists on the site-data branch aren't in git here, so aren't read).
const data = tracked.filter((f) => /^data\/([^/]+|changelog\.d\/[^/]+|ski-hand\/[^/]+)\.json$/.test(f) && f !== "data/changelog.json" && existsSync(new URL(f, root)));
const native = tracked.filter((f) => /^(ios-app|android-app)\/.*\.(swift|java)$|^android-app\/.*\/res\/values\/strings\.xml$|^ios-app\/.*\/Info\.plist$/.test(f) && !/[Tt]est/.test(f));
const files = [...pages, ...data, ...native];
// Names that hold a risky word (a ski run called Safe Route): the name is fine, it isn't a promise.
// Only in the data files: the app's own pages and scripts stay held to every word.
const NAMES = [/\bSafe Route\b/g, /"name":"Don't Stop"/g];   // wording-ok
// Web addresses aren't our wording, but a Trailforks address still counts (never mention Trailforks).
const URL_RE = /https?:\/\/[^\s"'<>)]+/g;
const BAD = [
  [/\bsafe (route|way|spot|place|ground|terrain|zone|line|ice|area|slope|path|crossing|pullout|parking|campsite|road|trail|bridge|launch|water)s?\b/i, "calls a place or route safe"],
  [/\bsafe to (eat|drink|cross|ride|ski|swim|camp|park|drive|walk|hike|hunt|fish|travel|go|use)\b/i, "promises something is safe to do"],
  [/\b(is|are|it's|looks|stays?|be) (avalanche-)?safe\b/i, "says something is safe"],
  [/\bsafe(st|r)\b/i, "\"safer\"/\"safest\": say \"less exposed\" and what the map shows"],
  [/\bsafely\b/i, "promises it can be done safely"],
  [/\bguarantee[ds]?\b/i, "promises a guarantee"],
  [/\b(avalanche-free|no avalanche (risk|danger|hazard)|can't slide|won't slide|can't avalanche)\b/i, "promises no avalanche"],
  [/\bclean air\b/i, "promises clean air"],
  [/\b(good to go|all clear|no risk|risk-free|nothing to worry)\b/i, "an all-clear"],
  [/\bstill rideable\b/i, "riding advice on conditions"],
  [/\b(one at a time|don't stop|regroup (here|at|point)|spread out|(move|cross|go|ski|travel) (quickly|fast)|avoid stopping|don't linger)\b/i, "travel advice on a route (no-route-advice rule)"],
  [/\b(always|definitely|certainly) (open|safe|dry|passable|rideable|allowed|legal)\b/i, "promises access or conditions"],
  [/\b(terrain traps?|run-?out zones?|bad run-?outs?|above you|slopes? above (the|this|your) (route|spot|line|trail))\b/i, "terrain traps, runouts or what is above you (CLAUDE.md: never shown; Avalanche Canada's own wording may be quoted: mark it // wording-ok)"],
  [/\btrailforks\b/i, "never mention Trailforks in the app"],
];
const NEG = /(\bnot\b|n't\b|\bno\b|\bnever\b|\bnor\b|\bwithout\b|\bpromise|\bguess)[^.]{0,40}$/i;   // "not a guarantee", "doesn't mean the slope is safe"
// Colour emoji: anything pictographic that line-icons.js can't draw, but not the plain symbols and arrows.
const TEXT_SYMBOLS = new Set([..."©®™↔↕↖↗↘↙↩↪⬆⬇⬅➡▶◀‼⁉ℹ〰⤴⤵▪▫◻◼"]);
const DRAWN = new Set([...readFileSync(new URL("line-icons.js", root), "utf8").matchAll(/"([^"\w\s]{1,3})":\s*"\w+"/g)].map((m) => m[1]));
const EMOJI = /\p{Extended_Pictographic}/gu;
let bad = 0;
for (const f of files) {
  const isPage = pages.includes(f);
  readFileSync(new URL(f, root), "utf8").split("\n").forEach((raw, i) => {
    const t = raw.trim();
    if (isPage && f !== "line-icons.js" && f !== "usage.html" && !/emoji-ok/.test(raw) && !t.startsWith("//") && !t.startsWith("*")) {   // usage.html: alex's own page
      const code = raw.replace(/\s\/\/\s.*$/, "").replace(/\/\*.*?\*\//g, "");
      const miss = [...new Set([...code.matchAll(EMOJI)].map((m) => m[0]).filter((c) => !DRAWN.has(c) && !TEXT_SYMBOLS.has(c)))];
      if (miss.length) { console.log(`${f}:${i + 1}: emoji with no line drawing (${miss.join(" ")}): add one to line-icons.js, or use a line icon`); bad++; }
      // A colour emoji in the middle of a sentence ("tap 🔒 Pocket") stays a colour emoji: line-icons.js only draws the
      // one that starts a button or title (alex 2026-11-25: "keep the app professional"). Name the button in words.
      const mid = /^\/\*|\*\/$/.test(t) ? null : /[A-Za-z,.:“] (\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)/u.exec(code);
      if (mid) { console.log(`${f}:${i + 1}: colour emoji in the middle of a sentence (“${code.slice(Math.max(0, mid.index - 30), mid.index + 12).trim()}”): name the button in words`); bad++; }
    }
    if (/wording-ok/.test(raw)) return;   // a line that has to name the word (a word list, a filter): mark it // wording-ok
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("<!--")) return;
    let line = raw.replace(/\s\/\/\s.*$/, "").replace(/\/\*.*?\*\//g, "").replace(/<!--.*?-->/g, "");
    if (data.includes(f)) for (const n of NAMES) line = line.replace(n, "the name");
    line = line.replace(URL_RE, (u) => (/trailforks/i.test(u) ? u : "the address"));
    for (const [re, why] of BAD) {
      const m = re.exec(line);
      if (!m) continue;
      if (NEG.test(line.slice(Math.max(0, m.index - 60), m.index))) continue;
      // only text people see: inside quotes, a template or between tags (skips code like plan.safe)
      const before = line.slice(0, m.index);
      if (!/["'`>][^"'`<]*$/.test(before) && !(/\.plist$/.test(f) && /<string>[^<]*$/.test(before))) continue;
      console.log(`${f}:${i + 1}: ${why}: “${line.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).trim()}”`);
      bad++;
    }
  });
}
if (bad) {
  console.log(`\n${bad} line(s) word things in a way that could promise safety or conditions, or show an emoji. Fix them (see the top of scripts/wording-check.mjs).`);
  process.exit(1);
}
console.log(`Wording check: ${files.length} files (${pages.length} app pages and scripts, ${data.length} data files, ${native.length} native app files), nothing that promises safety or conditions, and no emoji without a line drawing.`);
