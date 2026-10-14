// Mapper watch (see .github/workflows/watch-mapper.yml): tells alex when chosen OpenStreetMap
// mappers save new edits ("changesets").
//
// Each watched mapper gets one GitHub issue, "New OpenStreetMap edits by <name>". When new edits
// show up, the job adds a comment to it that mentions OWNER, so GitHub sends OWNER an email.
// The issue's description remembers the newest edit already reported, so nothing is sent twice.
// For each edit the comment lists what it did to trails (paths, tracks, MTB routes).
//
// Mappers are watched by user number, so the watch keeps working if they rename themselves.
// Find a number at https://api.openstreetmap.org/api/0.6/changesets.json?display_name=<name>&limit=1 ("uid").
//
// Run: WATCH=13073415 OWNER=allduf GITHUB_TOKEN=... GITHUB_REPOSITORY=allduf/trail-finder node scripts/watch-mapper.mjs
// Without GITHUB_TOKEN it only prints what it would post.   (Node 18 or newer, no packages needed)

const OSM_API = process.env.OSM_API || "https://api.openstreetmap.org/api/0.6";
const WATCH = (process.env.WATCH || "").split(",").map((s) => s.trim()).filter(Boolean);
const OWNER = process.env.OWNER || "allduf";
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_API = process.env.GITHUB_API_URL || "https://api.github.com";
const UA = "trail-finder mapper watch (https://github.com/allduf/trail-finder)";
const TZ = "America/Vancouver";
const MAX_DETAIL = 15;           // look inside at most this many new edits per run; the rest are just listed
const MAX_DETAIL_CHANGES = 20000; // skip looking inside giant edits

if (!WATCH.length) throw new Error("Set WATCH to the OpenStreetMap user numbers to watch, e.g. WATCH=13073415");

async function osm(path, asText = false) {
  const res = await fetch(`${OSM_API}${path}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`OpenStreetMap said ${res.status} for ${path}`);
  return asText ? res.text() : res.json();
}

async function github(path, method = "GET", body) {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": UA, ...(body && { "Content-Type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub said ${res.status} for ${method} ${path}: ${await res.text()}`);
  return res.json();
}

const when = (iso) => new Date(iso).toLocaleString("en-CA", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
const md = (s) => String(s).replace(/[\\`*_[\]<>|#]/g, "\\$&").replace(/\s+/g, " ").trim();

// What one edit did to trails: ways that are paths, tracks, cycleways or carry mtb tags, plus trail routes.
const TRAILISH = /^(path|track|footway|cycleway|bridleway)$/;
function trailSummary(osc) {
  const counts = { create: 0, modify: 0, delete: 0 }, names = new Set();
  let deletedWays = 0, decommissioned = 0;
  for (const block of osc.matchAll(/<(create|modify|delete)>([\s\S]*?)<\/\1>/g)) {
    const action = block[1];
    for (const el of block[2].matchAll(/<(way|relation)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
      const tags = Object.fromEntries([...(el[2] || "").matchAll(/<tag k="([^"]*)" v="([^"]*)"/g)].map((t) => [t[1], t[2]]));
      if (action === "delete" && el[1] === "way") { deletedWays++; continue; } // deleted ways come without their tags
      const lifecycle = Object.keys(tags).find((k) => /^(abandoned|disused|razed|demolished|was|removed):highway$/.test(k));
      const trail = el[1] === "way"
        ? TRAILISH.test(tags.highway || "") || Object.keys(tags).some((k) => k.startsWith("mtb")) || lifecycle
        : tags.route === "mtb" || tags.route === "bicycle" || tags.route === "hiking";
      if (!trail) continue;
      counts[action]++;
      if (lifecycle) decommissioned++;
      const name = tags.name || tags["was:name"] || tags["abandoned:name"] || tags["disused:name"];
      if (name) names.add(name);
    }
  }
  const parts = [];
  if (counts.create) parts.push(`${counts.create} trail${counts.create > 1 ? "s" : ""} added`);
  if (counts.modify) parts.push(`${counts.modify} trail${counts.modify > 1 ? "s" : ""} changed`);
  if (decommissioned) parts.push(`${decommissioned} marked decommissioned or removed`);
  if (deletedWays) parts.push(`${deletedWays} way${deletedWays > 1 ? "s" : ""} deleted (could be trails)`);
  if (!parts.length) return "no trail changes";
  const list = [...names].slice(0, 8).map(md).join(", ");
  return parts.join(", ") + (list ? ` (${list}${names.size > 8 ? ", ..." : ""})` : "");
}

async function describe(cs, detail) {
  const comment = cs.tags?.comment ? md(cs.tags.comment) : "_no description_";
  let line = `- **${when(cs.created_at)}** · ${comment} · ${cs.changes_count} change${cs.changes_count === 1 ? "" : "s"}`;
  if (detail && cs.changes_count <= MAX_DETAIL_CHANGES) {
    try { line += `\n  Trails: ${trailSummary(await osm(`/changeset/${cs.id}/download`, true))}`; }
    catch (e) { line += `\n  Trails: couldn't check (${md(e.message)})`; }
  }
  return line + `\n  [See it on OpenStreetMap](https://www.openstreetmap.org/changeset/${cs.id}) · [Before/after map (OSMCha)](https://osmcha.org/changesets/${cs.id})`;
}

const marker = (uid) => `<!-- mapper-watch uid:${uid} -->`;
const lastSeen = (body) => +((body || "").match(/<!-- last:(\d+) -->/) || [])[1] || 0;
function issueBody(uid, name, last) {
  return `${marker(uid)}\n<!-- last:${last} -->\n` +
    `This issue collects new edits by OpenStreetMap mapper **${md(name)}** ([profile](https://www.openstreetmap.org/user/${encodeURIComponent(name)}), ` +
    `[all edits](https://www.openstreetmap.org/user/${encodeURIComponent(name)}/history)).\n\n` +
    `A GitHub job checks every hour and adds a comment here when there are new ones, mentioning @${OWNER} so you get an email. ` +
    `Closing this issue doesn't stop it; to stop or change who is watched, edit \`WATCH\` in \`.github/workflows/watch-mapper.yml\`.\n\n` +
    `_Newest edit already reported: [${last}](https://www.openstreetmap.org/changeset/${last})_`;
}

async function findIssue(uid) {
  for (let page = 1; page <= 10; page++) {
    const issues = await github(`/issues?state=all&creator=${encodeURIComponent("github-actions[bot]")}&per_page=100&page=${page}`);
    const hit = issues.find((i) => !i.pull_request && (i.body || "").includes(marker(uid)));
    if (hit || issues.length < 100) return hit;
  }
}

for (const uid of WATCH) {
  const { changesets } = await osm(`/changesets.json?user=${uid}&limit=100`);
  if (!changesets.length) { console.log(`User ${uid} has no edits yet.`); continue; }
  const name = changesets[0].user;
  const newest = Math.max(...changesets.map((c) => c.id));
  const issue = TOKEN && await findIssue(uid);

  if (!issue) {
    const recent = changesets.slice(0, 5);
    const lines = await Promise.all(recent.map((c) => describe(c, true)));
    const first = `@${OWNER}, you'll get a comment here whenever **${md(name)}** saves new edits. Their latest ones, for reference:\n\n${lines.join("\n")}`;
    if (!TOKEN) { console.log(`Would open an issue for ${name}:\n\n${first}`); continue; }
    const created = await github("/issues", "POST", { title: `New OpenStreetMap edits by ${name}`, body: issueBody(uid, name, newest), assignees: [OWNER] });
    await github(`/issues/${created.number}/comments`, "POST", { body: first });
    console.log(`Opened issue #${created.number} for ${name}.`);
    continue;
  }

  const last = lastSeen(issue.body);
  const fresh = changesets.filter((c) => c.id > last).sort((a, b) => a.id - b.id);
  if (!fresh.length) { console.log(`No new edits by ${name}.`); continue; }
  const lines = [];
  for (const [i, c] of fresh.entries()) lines.push(await describe(c, i >= fresh.length - MAX_DETAIL));
  const body = `@${OWNER}, **${md(name)}** saved ${fresh.length} new edit${fresh.length > 1 ? "s" : ""}:\n\n${lines.join("\n")}` +
    (fresh.length === 100 ? `\n\n_There may be more; see [all edits](https://www.openstreetmap.org/user/${encodeURIComponent(name)}/history)._` : "");
  await github(`/issues/${issue.number}/comments`, "POST", { body });
  await github(`/issues/${issue.number}`, "PATCH", { body: issueBody(uid, name, newest) });
  console.log(`Reported ${fresh.length} new edits by ${name} on issue #${issue.number}.`);
}
