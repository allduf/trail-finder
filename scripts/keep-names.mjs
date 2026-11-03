// Trail names never get lost (alex, 2026-11-03: "if you see a trail name get deleted keep the last name you had before,
// specially for unofficial trails"). Mappers rename or strip the name of unofficial trails (Mr Pepeninos, Squamish, was
// renamed Mr Pepinillos on 2026-10-21, so a friend searching "pepeninos" found nothing).
//
// Each data job compares tonight's tags of a way with the tags it saved last time (same way id):
//   - the name was removed: the last name is put back, with tf:kept=yes (the site shows it as usual)
//   - the name changed: the old name goes into tf:was ("a;b", newest last, 4 at most); the search finds it, the
//     trail card says "Was called ..."
// tf:was and tf:kept are carried forward from build to build, so a name is remembered for good.
// data/old-names.json (edited by hand, stays in main) holds names lost before this existed: { ways: { id: { n: [names, newest last], c: [lat, lon] } } }.
import { readFileSync } from "node:fs";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const split = (s) => String(s || "").split(";").map((x) => x.trim()).filter(Boolean);

let seed = null;
export function oldNames(root) {
  if (!seed) { try { seed = JSON.parse(readFileSync(new URL("data/old-names.json", root), "utf8")).ways || {}; } catch { seed = {}; } }
  return seed;
}

// The tags saved last time for this way, with the hand list's names added. null when nothing is known.
function before(id, oldTags, root) {
  const s = (oldNames(root)[id] || {}).n;
  if (!s || !s.length) return oldTags || null;
  const t = { ...(oldTags || {}) };
  if (!t.name) t.name = s[s.length - 1];
  t["tf:was"] = [...s, ...split(t["tf:was"])].join(";");
  return t;
}

// Changes tags (tonight's tags of the way) in place. Returns "kept", "renamed" or "".
export function keepName(id, oldTags, tags, root) {
  const old = before(String(id), oldTags, root);
  if (!old) return "";
  const was = split(old["tf:was"]);
  let what = "";
  if (old.name && !tags.name) { tags.name = old.name; tags["tf:kept"] = "yes"; what = "kept"; }
  else if (old.name && norm(old.name) !== norm(tags.name)) { was.push(old.name); what = "renamed"; }
  const seen = new Set([norm(tags.name)]), out = [];
  for (const n of was.reverse()) { const k = norm(n); if (k && !seen.has(k)) { seen.add(k); out.unshift(n); } }
  if (out.length) tags["tf:was"] = out.slice(-4).join(";"); else delete tags["tf:was"];
  return what;
}

// Ways whose saved name is missing tonight: are they still on the map (unnamed now) or deleted?
// Current tags from the OpenStreetMap API, Map(id -> tags) for the ways still there; null when the API couldn't be reached.
export async function stillThere(ids, OSM_API, UA) {
  const out = new Map();
  let down = false;
  async function get(chunk) {
    let res;
    try { res = await fetch(`${OSM_API}/ways.json?ways=${chunk.join(",")}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) }); }
    catch { down = true; return; }
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) { down = true; return; }
      if (chunk.length === 1) return;   // deleted (or the API is down: then the name stays lost only until next run)
      const mid = Math.ceil(chunk.length / 2);
      await get(chunk.slice(0, mid)); await get(chunk.slice(mid));
      return;
    }
    for (const e of (await res.json()).elements || []) if (e.type === "way" && e.visible !== false) out.set(e.id, e.tags || {});
  }
  for (let i = 0; i < ids.length; i += 100) { await get(ids.slice(i, i + 100)); await new Promise((r) => setTimeout(r, 500)); }
  return down ? null : out;
}
