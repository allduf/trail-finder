// Builds i18n-fr.js (the app's French) from the word lists here: node scripts/i18n/build.mjs
// fr-*.txt: one "English ||| French" per line, the English exactly as the app shows it (icons in front and a : after
// are left out: the translator handles those). rules.js: texts with numbers or names in them. engine.js: the translator.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
const here = new URL("./", import.meta.url), root = new URL("../../", import.meta.url);
const D = {};
for (const f of readdirSync(here).filter((f) => /^fr-.*\.txt$/.test(f)).sort())
  for (const line of readFileSync(new URL(f, here), "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [en, fr] = line.split(" ||| ");
    if (fr === undefined) throw new Error(`${f}: no " ||| " in: ${line}`);
    if (!(en.trim() in D)) D[en.trim()] = fr.trim();
  }
const out = `// French for the app (alex, 2026-10-30). Made by scripts/i18n/build.mjs from scripts/i18n/: edit the word lists there,
// not this file. Loaded by i18n.js only when the app is in French.
(function () {
  "use strict";
  if (!window.tfLang) return;
  var D = ${JSON.stringify(D, null, 0).replace(/","/g, '",\n    "')};
${readFileSync(new URL("rules.js", here), "utf8")}
${readFileSync(new URL("engine.js", here), "utf8")}})();
`;
writeFileSync(new URL("i18n-fr.js", root), out);
console.log(`i18n-fr.js: ${Object.keys(D).length} phrases, ${Math.round(out.length / 1024)} KB`);
