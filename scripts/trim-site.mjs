// Trims the website's own scripts before they are published (alex chose 2026-11-26: "Yes, trim at publish"), so phones
// download and read less at startup. Only the published copy is trimmed: the files in the repository stay as they are.
//
// What it does, in every root .js file and every inline <script> of the root .html pages: comments go, and so do the
// spaces at the start of lines and between pieces of code. Nothing else changes:
//  - every piece of code (names, strings, templates, numbers, regular expressions) is copied exactly as it is;
//  - every line stays on its own line number, so error reports still point at the right line of the real file;
//  - before a file is replaced, the trimmed copy is read again and must give the very same pieces of code, with a line
//    break between the same ones (line breaks can matter in JavaScript). If anything differs, or a file can't be read,
//    that file is kept as it was (and the run fails with --strict, as in the phone test).
// Leaves out vendor/ (libraries, already small), data/ and anything below the root.
//
// Run: node scripts/trim-site.mjs [folder] [--strict]   (folder: the site to trim in place, default ".")
//   pages.yml runs it on the site it publishes; phone-test.yml runs it before the tests, so they test the trimmed copy.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tokenizer } from "../vendor/acorn-8.19.0.mjs";

const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const ROOT = args.find((a) => !a.startsWith("--")) || ".";

// The pieces of code in src, each with whether a line break comes before it. Comments are gaps like spaces.
function pieces(src, module) {
  const out = [];
  let end = 0;
  for (const t of tokenizer(src, { ecmaVersion: "latest", sourceType: module ? "module" : "script", allowHashBang: true,
    allowReturnOutsideFunction: true, onComment: () => {} })) {
    out.push({ s: t.start, e: t.end, nl: /[\n\r\u2028\u2029]/.test(src.slice(end, t.start)), gap: t.start > end });
    end = t.end;
  }
  return { list: out, tail: src.slice(end) };
}

// A space stays between two pieces only where taking it out could join them into one (two names or numbers, "+ +",
// "- -", "/ /", "1 .x") or start an old-style HTML comment ("< !", "- >"). The check below catches anything else.
const word = (c) => c != null && (/[\w$\\]/.test(c) || c > "\x7f");
function needsSpace(a, b) {
  if (a == null || b == null) return false;
  if (word(a) && word(b)) return true;
  if ((a === "+" || a === "-") && (b === "+" || b === "-")) return true;
  if (a === "/" || b === "/") return true;
  if (b === "." || a === ".") return true;
  if ((a === "<" && b === "!") || (a === "-" && b === ">")) return true;
  return false;
}

const lines = (s) => s.split(/\r\n|[\n\r\u2028\u2029]/).length - 1;

// One script's text, trimmed. Gaps (spaces and comments) become as many line breaks as they had, else one space.
function trimJs(src, module = false) {
  const { list, tail } = pieces(src, module);
  let out = "", end = 0;
  for (const p of list) {
    const gap = src.slice(end, p.s);
    const n = lines(gap);
    const code = src.slice(p.s, p.e);
    out += n ? "\n".repeat(n) : gap && needsSpace(out[out.length - 1], code[0]) ? " " : "";
    out += code;
    end = p.e;
  }
  out += "\n".repeat(lines(tail));
  // The check: the same pieces, the same line breaks before them, the same number of lines.
  const a = pieces(src, module).list, b = pieces(out, module).list;
  if (a.length !== b.length || lines(src) !== lines(out)) throw new Error("trimmed copy differs");
  for (let i = 0; i < a.length; i++) {
    if (src.slice(a[i].s, a[i].e) !== out.slice(b[i].s, b[i].e) || a[i].nl !== b[i].nl) throw new Error("trimmed copy differs");
  }
  return out;
}

const SCRIPT = /(<script\b(?![^>]*\bsrc=)([^>]*)>)([\s\S]*?)(<\/script>)/gi;

let before = 0, after = 0, kept = [];
const files = (await readdir(ROOT, { withFileTypes: true })).filter((d) => d.isFile() && /\.(js|html)$/.test(d.name)).map((d) => d.name).sort();
for (const name of files) {
  const path = join(ROOT, name), src = await readFile(path, "utf8");
  let out = src;
  try {
    if (name.endsWith(".js")) out = trimJs(src);
    else out = src.replace(SCRIPT, (m, open, attrs, body, close) => {
      const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
      if (type && !/^(module|text\/javascript|application\/javascript)$/i.test(type)) return m;   // JSON and the like: as is
      return open + trimJs(body, /^module$/i.test(type || "")) + close;
    });
  } catch (e) {
    kept.push(`${name} (${e.message})`);
    out = src;
  }
  before += Buffer.byteLength(src);
  after += Buffer.byteLength(out);
  if (out !== src) await writeFile(path, out);
}
const kb = (n) => `${Math.round(n / 1024).toLocaleString("en-CA")} KB`;
console.log(`Trimmed ${files.length} scripts and pages: ${kb(before)} to ${kb(after)} (${Math.round((1 - after / before) * 100)}% less).`);
if (kept.length) {
  console.log(`Kept as they were: ${kept.join(", ")}`);
  if (STRICT) process.exit(1);
}
