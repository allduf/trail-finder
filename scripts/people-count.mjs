// Once a day: ask Supabase how many devices used Trail Finder in the last 30 days (supabase/visitors.sql)
// and, when that passes LIMIT, comment on a GitHub issue that mentions OWNER, so GitHub emails them.
// It warns again only when the count grows by another STEP past the last warning, so it doesn't nag.
const { SUPABASE_URL, SUPABASE_KEY, GITHUB_TOKEN: TOKEN, GITHUB_REPOSITORY: REPO, OWNER = "allduf" } = process.env;
const LIMIT = Number(process.env.LIMIT || 50), STEP = Number(process.env.STEP || 25);
const MARK = "<!-- trail-finder-people-count -->";

const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/tf_active_devices`, {
  method: "POST",
  headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  body: JSON.stringify({ days: 30 }),
});
if (!res.ok) {
  console.log(`Supabase answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  console.log("If it says the function doesn't exist, supabase/visitors.sql hasn't been run yet.");
  process.exit(0);
}
const count = Number(await res.json());
console.log(`Devices in the last 30 days: ${count}`);
if (count <= LIMIT) process.exit(0);

async function github(path, method = "GET", body) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method, body: body && JSON.stringify(body),
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "trail-finder-people-count" },
  });
  if (!r.ok) throw new Error(`GitHub ${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const issues = await github(`/issues?state=all&creator=${encodeURIComponent("github-actions[bot]")}&per_page=100`);
let issue = issues.find((i) => !i.pull_request && (i.body || "").includes(MARK));
const warned = issue ? Number((issue.body.match(/last warned at (\d+)/) || [])[1] || 0) : 0;
if (warned && count < warned + STEP) { console.log(`Already warned at ${warned}; next warning at ${warned + STEP}.`); process.exit(0); }

const body = (n) => `${MARK}\nThis issue tells @${OWNER} when Trail Finder gets more than ${LIMIT} people. ` +
  `Counted as devices that opened the site in the last 30 days (one person on a phone and a laptop counts twice). ` +
  `Checked daily by \`.github/workflows/people-count.yml\`; last warned at ${n}.`;
const note = `@${OWNER} Trail Finder was used by **${count} devices** in the last 30 days, more than ${LIMIT}. ` +
  `Time to think about a friends-only login (see the "Keeping Trail Finder private" thread in the project).`;
if (!issue) issue = await github("/issues", "POST", { title: "Trail Finder is getting popular", body: body(count), assignees: [OWNER] });
else await github(`/issues/${issue.number}`, "PATCH", { body: body(count), state: "open" });
await github(`/issues/${issue.number}/comments`, "POST", { body: note });
console.log(`Warned on issue #${issue.number}.`);
