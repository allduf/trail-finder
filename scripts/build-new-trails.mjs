// Nightly, after build-data.mjs (see .github/workflows/trail-data.yml): finds the trails that appeared
// since the last build and adds them to data/new-trails.json, the feed behind the app's 🔔 notifications.
//
// A trail is new when tonight's data/trails-<zone>.json has a way that last night's (the committed file,
// read with git) didn't, and the way was first mapped in the last FRESH_DAYS. Ways that only continue a
// trail the map already had (same name as an older way in the zone, e.g. an OSM split) don't count.
// Ways of one new trail are grouped: by name, or for unnamed ways, when they touch.
// The app classifies each item itself (MTB tagged, looks like MTB...) and shows only the ones it would map.
//
// With no feed yet, it starts one from the trails first mapped in the last FRESH_DAYS.
// Run: node scripts/build-new-trails.mjs   (Node 18 or newer, no packages needed)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const DATA = new URL("data/", root);
const FEED = new URL("new-trails.json", DATA);
const FRESH_DAYS = 30;       // first mapped this recently to count as a new trail
const KEEP_DAYS = 90;        // items stay in the feed this long
const MAX_ITEMS = 500;

const html = readFileSync(new URL("index.html", root), "utf8");
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2], box: m[3].split(",").map(Number) }));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");

const now = Date.now();
const fresh = now - FRESH_DAYS * 864e5;
const readJson = (url) => { try { return JSON.parse(readFileSync(url, "utf8")); } catch { return null; } };
const lastNight = (name) => {   // the committed copy, before tonight's build overwrote it
  try { return JSON.parse(execFileSync("git", ["show", `HEAD:data/${name}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] })); }
  catch { return null; }
};
const firstMapped = (w) => w.ft || (w.v === 1 ? w.t : null);
const isFresh = (w) => { const t = Date.parse(firstMapped(w)); return t >= fresh; };
const nameOf = (tags) => (tags.name || tags["mtb:name"] || "").trim();

const old = readJson(FEED);
const seeding = !old;
const feed = old || { v: 1, items: [] };
const inFeed = new Set(feed.items.flatMap((i) => i.ids));
const builtAt = new Date(now).toISOString().slice(0, 19) + "Z";
let added = 0;

for (const z of ZONES) {
  const cur = readJson(new URL(`trails-${z.id}.json`, DATA));
  if (!cur || !cur.ways) continue;
  const prev = seeding ? { ways: {} } : lastNight(`trails-${z.id}.json`);
  if (!prev || !prev.ways) { console.log(`${z.name}: no file from last night, skipping`); continue; }

  // Only squares last night's file already had: a zone that's still filling in (squares built for the first time)
  // would otherwise count every recent trail in those squares as new today.
  const seen = new Set(Object.entries(cur.tiles || {}).filter(([k]) => prev.tiles && prev.tiles[k]).flatMap(([, t]) => t.ways.map(String)));
  const newWays = Object.entries(cur.ways).filter(([id, w]) => (seeding || seen.has(id)) && !prev.ways[id] && !inFeed.has(+id) && isFresh(w));
  if (!newWays.length) { console.log(`${z.name}: nothing new`); continue; }
  const freshIds = new Set(newWays.map(([id]) => id));

  // Names the map already had: older ways in the zone's new-trail file (2 years) or all-MTB file (any age).
  const known = new Set();
  Object.entries(cur.ways).forEach(([id, w]) => { if (!isFresh(w) && nameOf(w.tags)) known.add(nameOf(w.tags).toLowerCase()); });
  const mtb = readJson(new URL(`mtb-${z.id}.json`, DATA));
  Object.entries((mtb && mtb.ways) || {}).forEach(([id, w]) => { if (!freshIds.has(id) && !cur.ways[id] && nameOf(w.tags || {})) known.add(nameOf(w.tags).toLowerCase()); });

  // MTB routes each way is in.
  const routes = new Map();
  Object.values(cur.rels || {}).forEach((r) => { if ((r.tags || {}).route === "mtb") r.ways.forEach((id) => { if (!routes.has(id)) routes.set(id, []); routes.get(id).push(r.tags.name || r.tags.ref || "unnamed"); }); });

  // Group: same name, or unnamed ways sharing an end point.
  const parent = new Map(newWays.map(([id]) => [id, id]));
  const find = (x) => { while (parent.get(x) !== x) x = parent.set(x, parent.get(parent.get(x))).get(x); return x; };
  const join = (a, b) => parent.set(find(a), find(b));
  const byName = new Map(), byEnd = new Map();
  for (const [id, w] of newWays) {
    const n = nameOf(w.tags).toLowerCase();
    if (n) { if (byName.has(n)) join(id, byName.get(n)); else byName.set(n, id); continue; }
    const g = w.g, ends = [`${g[0]},${g[1]}`, `${g[g.length - 2]},${g[g.length - 1]}`];
    ends.forEach((e) => { if (byEnd.has(e)) join(id, byEnd.get(e)); else byEnd.set(e, id); });
  }
  const groups = new Map();
  for (const [id, w] of newWays) { const r = find(id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push([id, w]); }

  for (const ways of groups.values()) {
    const name = nameOf(ways[0][1].tags);
    if (name && known.has(name.toLowerCase())) continue;   // more of a trail the map already had
    ways.sort((a, b) => b[1].g.length - a[1].g.length);    // longest first: its tags speak for the trail
    const [, main] = ways[0];
    const ft = ways.map(([, w]) => firstMapped(w)).sort()[0];
    const mid = Math.floor(main.g.length / 4) * 2, c = [main.g[mid], main.g[mid + 1]];
    // The data squares reach past the zone's edges, so a trail can turn up in two zones: it belongs where it lies.
    const home = ZONES.find(({ box: [s, w, n, e] }) => c[0] >= s && c[0] <= n && c[1] >= w && c[1] <= e) || z;
    ways.forEach(([id]) => inFeed.add(+id));
    feed.items.push({
      ids: ways.map(([id]) => +id), z: home.id, at: seeding ? ft : builtAt, ft, u: main.fu || main.u || "", name,
      tags: main.tags, routes: [...new Set(ways.flatMap(([id]) => routes.get(+id) || []))],
      c,
    });
    added++;
  }
  console.log(`${z.name}: ${newWays.length} new ways`);
}

const keepAfter = new Date(now - KEEP_DAYS * 864e5).toISOString();
feed.items = feed.items.filter((i) => i.at >= keepAfter).sort((a, b) => (b.at > a.at ? 1 : b.at < a.at ? -1 : 0)).slice(0, MAX_ITEMS);
feed.builtAt = builtAt;
writeFileSync(FEED, JSON.stringify(feed));
console.log(`${seeding ? "Started" : "Updated"} data/new-trails.json: ${added} new trails, ${feed.items.length} in the feed.`);
