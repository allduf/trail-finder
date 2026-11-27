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
// Plain text marks that read as text in a sentence (a ✓ Done, a ★ rating), unlike a colour picture.
const MID_OK = new Set([..."✓✔✕✖✗✘✎★☆☰➤⚠"]);
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
      const mid = /^\/\*|\*\/$/.test(t) ? null : [...code.matchAll(/(\S) (\p{Extended_Pictographic})/gu)].find((m) => !TEXT_SYMBOLS.has(m[2]) && !MID_OK.has(m[2]) && (!/[=(,;{[?:|&+]/.test(m[1]) || (m[1] === ":" && /[A-Za-z]:$/.test(code.slice(0, m.index + 1)))));
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
// Hidden trail names (CLAUDE.md "This repository is public"): alex's unofficial trails are listed by nh, a hash of the
// lower-case name (ratings.js, scripts/build-mtb.mjs), never by name. Fails when any text file in git holds a name that
// hashes to one of them: a quoted string, or a run of 1 to 6 words. The log names only the file, line, place and hash,
// never the name (the log is public too); open the file there to see the words. A 32-bit hash can match an ordinary
// phrase by chance: if the words at that place aren't a trail name, mark the line hidden-name-ok.
const fnv = (h, s) => { for (let i = 0; i < s.length; i++) { const c = s.codePointAt(i); if (c > 0xffff) i++; h = Math.imul(h ^ c, 0x01000193) >>> 0; } return h; };
const HIDDEN = new Set(["ratings.js", "scripts/build-mtb.mjs"].flatMap((f) => (existsSync(new URL(f, root)) ? [...readFileSync(new URL(f, root), "utf8").matchAll(/\bnh:\s*"([0-9a-z]+)"/g)].map((m) => m[1]) : [])));
const HIDDEN_N = new Set([...HIDDEN].map((h) => parseInt(h, 36)));
const TEXT_FILE = /\.(js|mjs|cjs|json|geojson|html|css|md|txt|yml|yaml|sql|swift|java|kt|xml|plist|py|sh|webmanifest|csv|gpx)$|^_headers$|^CLAUDE\.md$/;
const QUOTED = [/"([^"\n]{2,60})"/g, /'([^'\n]{2,60})'/g, /`([^`\n]{2,60})`/g];
// The hashes found in one piece of text, each with where it starts ("character n").
function hiddenIn(text, at) {
  const found = new Map(), low = text.toLowerCase(), hit = (h, pos) => { if (HIDDEN_N.has(h) && !found.has(h)) found.set(h, at + pos); };
  for (const re of QUOTED) for (const m of low.matchAll(re)) hit(fnv(0x811c9dc5, m[1].trim()), m.index);
  // Words lose the marks before them ('name') and are tried with and without the marks after them (Mr. Name, Name!).
  // FNV-1a goes letter by letter, so each run of words carries on from the hash of the run before it.
  const words = [...low.matchAll(/[\p{L}\p{N}'’.&!?-]+/gu)].map((m) => ({ pos: m.index, w: m[0].replace(/^[.'’&!?-]+/, "") })).filter((x) => x.w);
  for (let a = 0; a < words.length; a++) {
    let h = 0x811c9dc5;
    for (let k = 0; k < 6 && a + k < words.length; k++) {
      const { w } = words[a + k], bare = w.replace(/[.'’&!?-]+$/, "");
      if (k) h = fnv(h, " ");
      const end = fnv(h, bare);
      hit(end, words[a].pos);
      h = bare === w ? end : fnv(h, w);
      if (h !== end) hit(h, words[a].pos);
    }
  }
  return found;
}
let hidden = 0;
if (HIDDEN.size) for (const f of tracked.filter((f) => f && TEXT_FILE.test(f) && !f.startsWith("vendor/") && existsSync(new URL(f, root)))) {
  readFileSync(new URL(f, root), "utf8").split("\n").forEach((raw, i) => {
    if (/hidden-name-ok/.test(raw)) return;
    // A whole data file on one line (data/ski.json, 4 MB) is read in pieces, cut between JSON values.
    const pieces = [];
    if (raw.length <= 20000) pieces.push([raw, 0]);
    else for (let at = 0; at < raw.length;) {
      let end = Math.min(raw.length, at + 20000);
      if (end < raw.length) { const cut = raw.lastIndexOf(",", end); if (cut > at + 1000) end = cut + 1; }
      pieces.push([raw.slice(at, end), at]); at = end;
    }
    for (const [text, at] of pieces) for (const [h, pos] of hiddenIn(text, at)) {
      console.log(`${f}:${i + 1}: character ${pos + 1}: holds the name of a hidden trail (nh "${h.toString(36)}") in plain text: take it out, or use its nh`);
      hidden++;
    }
  });
}
if (hidden) { console.log(`\n${hidden} line(s) name a hidden trail in plain text. This repository is public (CLAUDE.md).`); process.exit(1); }

if (bad) {
  console.log(`\n${bad} line(s) word things in a way that could promise safety or conditions, or show an emoji. Fix them (see the top of scripts/wording-check.mjs).`);
  process.exit(1);
}
console.log(`Wording check: ${files.length} files (${pages.length} app pages and scripts, ${data.length} data files, ${native.length} native app files), nothing that promises safety or conditions, and no emoji without a line drawing.`);
