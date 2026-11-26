// Trims the website's own scripts before they are published (alex chose 2026-11-26: "Yes, trim at publish"), so phones
// download and read less at startup. Only the published copy is trimmed: the files in the repository stay as they are.
//
// What it does, in every root .js file and every inline <script> of the root .html pages: comments go, and so do the
// spaces at the start of lines and between pieces of code. Nothing else changes:
//  - every piece of code (names, strings, templates, numbers, regular expressions) is copied exactly as it is;
//  - every line stays on its own line number, so error reports still point at the right line of the real file;
//  - before a file is replaced, the trimmed copy is read again and must give the very same pieces of code, with a line
//    break between the same ones (line breaks can matter in JavaScript), and read as the very same program. If anything
//    differs, or a file can't be read, that file is kept as it was (and the run fails with --strict, as in the tests).
// Leaves out vendor/ (libraries, already small), data/ and anything below the root.
//
// Run: node scripts/trim-site.mjs <folder> [--strict]   (folder: the site to trim in place; there is no default)
//   pages.yml runs it on the site it publishes; phone-test.yml runs it before the tests, so they test the trimmed copy.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "../vendor/acorn-8.19.0.mjs";

const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const ROOT = args.find((a) => !a.startsWith("--"));
if (!ROOT) {   // never a default: run in a working copy, it would strip the repository's own files
  console.log("Usage: node scripts/trim-site.mjs <site folder> [--strict]   (trims that folder in place)");
  process.exit(2);
}

// The program read by the parser (so a "/" after await is a regular expression, as the browser reads it), and its
// pieces of code, each with whether a line break comes before it. Comments are gaps like spaces.
function read(src, module) {
  const tokens = [];
  const ast = parse(src, { ecmaVersion: "latest", sourceType: module ? "module" : "script", allowHashBang: true, onToken: tokens });
  const list = [];
  let end = 0;
  for (const t of tokens) {
    if (t.type.label === "eof") break;
    list.push({ s: t.start, e: t.end, nl: /[\n\r\u2028\u2029]/.test(src.slice(end, t.start)) });
    end = t.end;
  }
  return { ast, list, tail: src.slice(end) };
}

// The program without positions: two copies that give the same text here are the same program.
const shape = (ast) => JSON.stringify(ast, (k, v) => (k === "start" || k === "end" ? undefined : v));

// A space stays between two pieces only where taking it out could join them into one (two names or numbers, "+ +",
// "- -", "/ /", "1 .x") or make an old-style HTML comment ("< !", "! -", "- >"). The checks below catch anything else.
const word = (c) => c != null && (/[\w$\\]/.test(c) || c > "\x7f");
function needsSpace(a, b) {
  if (a == null || b == null) return false;
  if (word(a) && word(b)) return true;
  if ((a === "+" || a === "-") && (b === "+" || b === "-")) return true;
  if (a === "/" || b === "/") return true;
  if (b === "." || a === ".") return true;
  if ((a === "<" && b === "!") || (a === "!" && b === "-") || (a === "-" && b === ">")) return true;
  return false;
}

const lines = (s) => s.split(/\r\n|[\n\r\u2028\u2029]/).length - 1;
// "<!--", "-->" and "<script" / "</script" in an inline script change where the page thinks the script ends: the
// trimmed copy must have the same ones in the same order (they only ever sit in strings, templates or comments).
const marks = (s) => (s.match(/<!--|-->|<\/?script/gi) || []).join(" ").toLowerCase();

// One script's text, trimmed. Gaps (spaces and comments) become as many line breaks as they had, else one space
// where needed. A byte order mark at the start stays.
function trimJs(src, module = false) {
  const bom = src.startsWith("\uFEFF") ? "\uFEFF" : "";
  const was = read(src, module);
  let out = bom, end = 0;
  for (const p of was.list) {
    const gap = src.slice(end, p.s).replace(/^\uFEFF/, "");
    const n = lines(gap), code = src.slice(p.s, p.e);
    out += n ? "\n".repeat(n) : gap && needsSpace(out[out.length - 1], code[0]) ? " " : "";
    out += code;
    end = p.e;
  }
  out += "\n".repeat(lines(was.tail));
  // The checks: the same pieces with the same line breaks before them, the same number of lines, the same program,
  // and the same page markers (marks above).
  const now = read(out, module);
  const differs = was.list.length !== now.list.length || lines(src) !== lines(out) || shape(was.ast) !== shape(now.ast)
    || marks(out) !== marks(src)
    || was.list.some((a, i) => src.slice(a.s, a.e) !== out.slice(now.list[i].s, now.list[i].e) || a.nl !== now.list[i].nl);
  if (differs) throw new Error("trimmed copy differs");
  return out;
}

const SCRIPT = /(<script\b(?![^>]*\bsrc=)([^>]*)>)([\s\S]*?)(<\/script>)/gi;

let before = 0, after = 0;
const kept = [];
const files = (await readdir(ROOT, { withFileTypes: true })).filter((d) => d.isFile() && /\.(js|html)$/.test(d.name)).map((d) => d.name).sort();
if (!files.length) { console.log(`No scripts or pages in ${ROOT}: nothing trimmed.`); process.exit(1); }
for (const name of files) {
  const path = join(ROOT, name), src = await readFile(path, "utf8");
  let out = src;
  try {
    if (name.endsWith(".js")) out = trimJs(src);
    else out = src.replace(SCRIPT, (m, open, attrs, body, close) => {
      const type = (attrs.match(/(?:^|\s)type\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
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
