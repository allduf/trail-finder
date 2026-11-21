// TEMP experiment: copies of the site with sw.js changed, to find what slows page arrival with a big offline cache.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
const base = readFileSync("sw.js", "utf8");
const V = {
  // A: the page's fresh copy is saved 4 s later, not while the page streams.
  putlater: (s) => s.replace("await cache.put(req, copy);", "if (req.mode === \"navigate\") await new Promise((ok) => setTimeout(ok, 4000)); await cache.put(req, copy);"),
  // B: the page from the cache only, no network at all for it.
  nonet: (s) => s.replace("const net = (req.mode === \"navigate\" ? fetch(req) :", "const net = (req.mode === \"navigate\" ? new Promise(() => {}) :"),
  // C: the saved page read whole first (blob), then answered.
  blob: (s) => s.replace("if (page && hit.ok) return plain(hit);", "if (page && hit.ok) return new Response(await hit.blob(), { status: 200, headers: hit.headers });"),
};
for (const [k, f] of Object.entries(V)) {
  const out = f(base);
  if (out === base) throw new Error("variant " + k + " did not apply");
  cpSync(".", "../v-" + k, { recursive: true, filter: (p) => !/(^|\/)(\.git|base|data|v-[a-z]+|node_modules)(\/|$)/.test(p) || p === "." });
  writeFileSync(`../v-${k}/sw.js`, out);
}
console.log("made", Object.keys(V).join(", "));
