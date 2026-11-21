// TEMP experiment: copies of the site with sw.js changed, to find what slows page arrival with a big offline cache.
import { cpSync, readFileSync, writeFileSync } from "node:fs";
const base = readFileSync("sw.js", "utf8");
const V = {
  // A: the page's fresh copy is saved 4 s later, not while the page streams.
  putlater: (s) => s.replace("await cache.put(req, copy);", "if (req.mode === \"navigate\") await new Promise((ok) => setTimeout(ok, 4000)); await cache.put(req, copy);"),
  // D: the page also kept in IndexedDB (another storage engine) and answered from there first.
  idb: (s) => s.replace("async function networkFirst(req, e) {", `const idb = () => new Promise((ok, no) => { const r = indexedDB.open("tf-page", 1); r.onupgradeneeded = () => r.result.createObjectStore("p"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
const idbGet = async (k) => { const db = await idb(); return new Promise((ok) => { const q = db.transaction("p").objectStore("p").get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); }); };
const idbPut = async (k, v) => { const db = await idb(); return new Promise((ok) => { const t = db.transaction("p", "readwrite"); t.objectStore("p").put(v, k); t.oncomplete = ok; t.onerror = ok; }); };
async function networkFirst(req, e) {
  if (req.mode === "navigate" && /\\/(index\\.html)?$/.test(new URL(req.url).pathname)) {
    const kept = await idbGet("home").catch(() => null);
    const net = fetch(req).then(async (res) => { if (res.ok) { const b = await res.clone().arrayBuffer(); await idbPut("home", b); await (await caches.open(VERSION)).put(req, res); } }).catch(() => null);
    if (kept) { e.waitUntil(net); return new Response(kept, { headers: { "content-type": "text/html; charset=utf-8" } }); }
    await net;
  }`),
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
