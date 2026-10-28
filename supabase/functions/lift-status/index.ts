// Trail Finder live lift status (lifts.js on the site): reads each ski resort's own lift status, the same one their
// website shows, and gives the app one small list: each lift's name, open / on hold / closed, wait time and hours where
// the resort publishes them. The browser can't read most resort sites itself (they don't allow other websites to), so
// this function reads them and the app reads this function. Nothing is kept: every answer is fresh from the resorts,
// at most once every 3 minutes per resort (answers are reused in between, so riders opening the map don't add load).
// Setup (once): Supabase dashboard → Edge Functions → Deploy a new function → Via Editor, name it "lift-status" (Supabase may give it another name: it is "super-service" on the live project)
// (FN in lifts.js must match), paste this file, Deploy; then in its Details turn "Verify JWT" off (the app asks without
// signing in). No secrets.
// GET /functions/v1/lift-status → { t, resorts: { <id>: { name, page, t, src, lifts: [{ n, s, w?, o?, c?, k? }], err? } } }
// s: "open" | "hold" | "closed" | "scheduled" | "unknown". w: wait in minutes. o / c: opening and closing time. k: kind.

const ORIGINS = [/^https:\/\/allduf\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^capacitor:\/\/localhost$/, /^https?:\/\/localhost$/];
const FRESH_MS = 3 * 60e3;
const UA = "Mozilla/5.0 (compatible; TrailFinder lift status; +https://allduf.github.io/trail-finder/)";

type Lift = { n: string; s: string; w?: number; o?: string; c?: string; k?: string };
type Result = { lifts: Lift[]; t?: string };
type Source = { name: string; page: string; url: string; kind: "vail" | "rcr" | "whitewater" | "sunpeaks" | "bigwhite" | "norquay" | "mtnpowder" | "bromont" };

// The resorts whose lift status could be read (checked 2026-10-25). The id is the resort's id in data/ski-lifts.json.
export const SOURCES: Record<string, Source> = {
  wb: { name: "Whistler Blackcomb", kind: "vail", page: "https://www.whistlerblackcomb.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx", url: "https://www.whistlerblackcomb.com/the-mountain/mountain-conditions/terrain-and-lift-status.aspx" },
  fernie: { name: "Fernie Alpine Resort", kind: "rcr", page: "https://skifernie.com/conditions/snow-report/", url: "https://skifernie.com/wp-content/themes/kallyas-child/reportData/liftReport.json" },
  khmr: { name: "Kicking Horse", kind: "rcr", page: "https://kickinghorseresort.com/conditions/snow-report/", url: "https://kickinghorseresort.com/wp-content/themes/kallyas-child/reportData/liftReport.json" },
  kimberley: { name: "Kimberley Alpine Resort", kind: "rcr", page: "https://skikimberley.com/conditions/snow-report/", url: "https://skikimberley.com/wp-content/themes/kallyas-child/reportData/liftReport.json" },
  nakiska: { name: "Nakiska", kind: "rcr", page: "https://www.skinakiska.com/conditions/snow-report/", url: "https://www.skinakiska.com/wp-content/themes/kallyas-child/reportData/liftReport.json" },
  whitewater: { name: "Whitewater", kind: "whitewater", page: "https://whitewatermountainresort.com/lift-grooming-status/", url: "https://whitewatermountainresort.com/lifts-json/" },
  sunpeaks: { name: "Sun Peaks", kind: "sunpeaks", page: "https://www.sunpeaksresort.com/ski-ride/weather-conditions-cams/lifts-trail-status", url: "https://www.sunpeaksresort.com/ski-ride/weather-conditions-cams/lifts-trail-status" },
  bigwhite: { name: "Big White", kind: "bigwhite", page: "https://www.bigwhite.com/mountain-conditions/lift-status-hours", url: "https://www.bigwhite.com/mountain-conditions/lift-status-hours" },
  norquay: { name: "Mt Norquay", kind: "norquay", page: "https://banffnorquay.com/conditions/", url: "https://banffnorquay.com/conditions/" },
  // Alterra's resorts publish their full mountain report on MtnPowder (resortId); its partner resorts there have weather only.
  tremblant: { name: "Tremblant", kind: "mtnpowder", page: "https://www.tremblant.ca/mountain-village/mountain-report", url: "https://mtnpowder.com/feed?resortId=4" },
  bluemtn: { name: "Blue Mountain", kind: "mtnpowder", page: "https://www.bluemountain.ca/mountain/mountain-report", url: "https://mtnpowder.com/feed?resortId=3" },
  bromont: { name: "Bromont, montagne d'expériences", kind: "bromont", page: "https://www.bromontmontagne.com/conditions-detaillees/", url: "https://www.bromontmontagne.com/conditions-detaillees/" },
};

// Any resort's words for a lift's state, as one of ours.
export function stateOf(x: unknown): string {
  const v = String(x ?? "").toLowerCase();
  if (/hold|standby|stand-by|slow|delay|pause|stopped|wind|weather|mechanical|suspendu|attente|arrêt/.test(v)) return "hold";
  if (/schedul|expected|anticipated|opening (soon|later)|later today|prévu/.test(v)) return "scheduled";
  if (/clos|cross|x-|icon-x|ferm/.test(v)) return "closed";
  if (/open|check|tick|running|operat|ouvert/.test(v)) return "open";
  return "unknown";
}
const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&#8217;|’/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const hhmm = (s?: string | null) => (s && /\d/.test(s) ? s.trim() : undefined);

// Vail Resorts sites (Whistler Blackcomb): the page has FR.TerrainStatusFeed = {...}; with GroomingAreas[].Lifts[]
// { Name, Status 0 closed / 1 open / 2 on hold / 3 scheduled / 4 unknown, Type, WaitTimeInMinutes, OpenTime, CloseTime }.
function vail(html: string): Result {
  const i = html.indexOf("FR.TerrainStatusFeed = ");
  if (i < 0) return { lifts: [] };   // off season the page has no feed
  const start = html.indexOf("{", i), end = html.indexOf("};", start);
  const feed = JSON.parse(html.slice(start, end + 1));
  const VAIL = ["closed", "open", "hold", "scheduled", "unknown"];
  const seen = new Set<string>(), lifts: Lift[] = [];
  for (const area of [feed, ...(feed.GroomingAreas || [])]) for (const l of area.Lifts || []) {
    if (!l || !l.Name || seen.has(l.Name)) continue;
    seen.add(l.Name);
    lifts.push({ n: l.Name, s: VAIL[l.Status] || "unknown", ...(l.WaitTimeInMinutes != null ? { w: +l.WaitTimeInMinutes } : {}), ...(hhmm(l.OpenTime) ? { o: l.OpenTime } : {}), ...(hhmm(l.CloseTime) ? { c: l.CloseTime } : {}), ...(l.Type ? { k: String(l.Type) } : {}) });
  }
  const d = /\/Date\((\d+)\)\//.exec(String(feed.Date || ""));
  return { lifts, t: d ? new Date(+d[1]).toISOString() : feed.Date ? new Date(feed.Date).toISOString() : undefined };
}
// Resorts of the Canadian Rockies (Fernie, Kicking Horse, Kimberley, Nakiska): liftReport.json, flat keys
// liftStatus<Lift>, openTime<Lift>, closeTime<Lift>, URL-encoded text. The lift's name is its key split into words.
function rcr(json: string): Result {
  const d = JSON.parse(json), lifts: Lift[] = [];
  const dec = (s: unknown) => { try { return decodeURIComponent(String(s ?? "")); } catch { return String(s ?? ""); } };
  for (const k of Object.keys(d)) {
    if (!k.startsWith("liftStatus")) continue;
    const key = k.slice(10);
    const n = key.replace(/([a-z])([A-Z0-9])/g, "$1 $2").replace(/([0-9])([A-Za-z])/g, "$1 $2").replace(/T Bar/, "T-Bar");
    const o = dec(d["openTime" + key]).replace(/^Opens at /i, ""), c = dec(d["closeTime" + key]).replace(/^Closes at /i, "");
    lifts.push({ n, s: stateOf(dec(d[k])), ...(hhmm(o) ? { o } : {}), ...(hhmm(c) ? { c } : {}) });
  }
  return { lifts };
}
// Whitewater: /lifts-json/ { update_date, lifts: { silver_king_lift: { key, label } } } (also nordic, terrain, avalanche).
function whitewater(json: string): Result {
  const d = JSON.parse(json), lifts: Lift[] = [];
  for (const [k, v] of Object.entries(d.lifts || {}) as [string, { key?: string; label?: string }][]) {
    if (!v || !v.label || /^(terrain|avalanche|nordic)/.test(k)) continue;
    const n = k.replace(/_lift$/, "").split("_").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    lifts.push({ n: /tow$/i.test(n) ? n : n + " Chair", s: stateOf(v.key || v.label) });
  }
  return { lifts };
}
// Sun Peaks: <article class="node-type-lift ..."> name in .field--name-title, hours in .notes, state as an icon class.
function sunpeaks(html: string): Result {
  const lifts: Lift[] = [];
  for (const m of html.matchAll(/<article[^>]*node-type-lift[\s\S]*?<\/article>/g)) {
    const a = m[0];
    const n = /field--name-title[^>]*>([^<]+)</.exec(a), st = /row-cell status">\s*<span class="([^"]*)"/.exec(a), notes = /class="notes">([\s\S]*?)<\/span>/.exec(a);
    if (!n || !st) continue;
    const hours = notes ? text(notes[1].split(/<br/)[0]) : "";
    const [o, c] = hours.split(/\s+to\s+/);
    lifts.push({ n: text(n[1]), s: stateOf(st[1].replace("icon-", "")), ...(hhmm(o) ? { o } : {}), ...(hhmm(c) ? { c } : {}) });
  }
  return { lifts };
}
// Big White: <div class="small-12 columns open_icon|closed_icon|slow_icon"><strong>Name</strong> - note - hours <i>State</i>.
function bigwhite(html: string): Result {
  const lifts: Lift[] = [];
  for (const m of html.matchAll(/<div class="small-12 columns ([a-z]+)_icon">\s*<strong[^>]*>([^<]+)<\/strong>([\s\S]*?)<\/div>/g)) {
    const words = /<i>([^<]*)<\/i>/.exec(m[3]);
    const hours = /(\d{1,2}:\d\d\s*[ap]m)\s*-\s*(\d{1,2}:\d\d\s*[ap]m)/i.exec(m[3]);
    lifts.push({ n: text(m[2]), s: stateOf(m[1] === "slow" ? "standby" : words ? words[1] : m[1]), ...(hours ? { o: hours[1], c: hours[2] } : {}) });
  }
  return { lifts };
}
// Mt Norquay: <div class="jet-toggle__label-text">Name <span class="lift-status is-closed">Closed</span></div>.
function norquay(html: string): Result {
  const lifts: Lift[] = [];
  for (const m of html.matchAll(/jet-toggle__label-text">([^<]+)<span class="lift-status ([^"]*)">([^<]*)<\/span>/g)) lifts.push({ n: text(m[1]), s: stateOf(m[3] || m[2]) });
  return { lifts };
}
// MtnPowder (Tremblant, Blue Mountain): { LastUpdate, MountainAreas: [{ Lifts: [{ Name, StatusEnglish, LiftType,
// WaitTime, Hours: { Monday: { Open, Close } } }] }] }. Both resorts are on Eastern time, so "today" is Eastern.
function mtnpowder(json: string): Result {
  const d = JSON.parse(json), lifts: Lift[] = [], seen = new Set<string>();
  const day = new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Toronto" });
  for (const a of d.MountainAreas || []) for (const l of a.Lifts || []) {
    if (!l || !l.Name || seen.has(l.Name)) continue;
    seen.add(l.Name);
    const h = (l.Hours && l.Hours[day]) || {}, w = parseInt(l.WaitTime, 10);
    lifts.push({ n: l.Name, s: stateOf(String(l.StatusEnglish || l.Status).replace(/_/g, " ")), ...(Number.isFinite(w) ? { w } : {}), ...(hhmm(h.Open) ? { o: h.Open } : {}), ...(hhmm(h.Close) ? { c: h.Close } : {}), ...(l.LiftType ? { k: String(l.LiftType) } : {}) });
  }
  const t = d.LastUpdate ? new Date(String(d.LastUpdate).replace(/([+-]\d\d)(\d\d)$/, "$1:$2")) : null;
  return { lifts, t: t && !isNaN(+t) ? t.toISOString() : undefined };
}
// Bromont: <span class="nom">#3 Télésiège quadruple - La Directe </span> ... <span class="jour ...">Fermé</span>, the
// same rows as its trails, so only names that are lifts ("Balade en télécabine" is a sightseeing ride, not a lift).
function bromont(html: string): Result {
  const lifts: Lift[] = [], seen = new Set<string>();
  for (const m of html.matchAll(/<span class="nom">([^<]+)<\/span>[\s\S]{0,600}?<span class="jour[^"]*">([^<]*)<\/span>/g)) {
    const n = text(m[1]).replace(/^#\d+\s*/, "");
    if (!/télésiège|télécabine|tapis|téléski|remontée|t-bar|chairlift/i.test(n) || /^balade/i.test(n) || seen.has(n)) continue;
    seen.add(n);
    lifts.push({ n, s: stateOf(text(m[2])) });
  }
  return { lifts };
}
export const PARSE: Record<Source["kind"], (body: string) => Result> = { vail, rcr, whitewater, sunpeaks, bigwhite, norquay, mtnpowder, bromont };

const cache = new Map<string, { at: number; v: Record<string, unknown> }>();
export async function read(id: string): Promise<Record<string, unknown>> {
  const src = SOURCES[id], hit = cache.get(id);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.v;
  let v: Record<string, unknown>;
  try {
    const r = await fetch(src.url, { headers: { "User-Agent": UA, Accept: "text/html,application/json" }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(`the resort's site answered ${r.status}`);
    const res = PARSE[src.kind](await r.text());
    const mod = r.headers.get("last-modified");
    v = { name: src.name, page: src.page, src: src.kind, t: res.t || (mod ? new Date(mod).toISOString() : new Date().toISOString()), lifts: res.lifts };
  } catch (e) {
    v = { name: src.name, page: src.page, src: src.kind, lifts: [], err: String((e as Error)?.message || e).slice(0, 120), ...(hit ? { old: hit.v } : {}) };
  }
  cache.set(id, { at: Date.now(), v });
  return v;
}

function headers(origin: string | null) {
  const ok = origin && ORIGINS.some((r) => r.test(origin));
  return { "Access-Control-Allow-Origin": ok ? origin! : "https://allduf.github.io", "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Content-Type": "application/json", "Cache-Control": "public, max-age=120", Vary: "Origin" };
}

if (typeof Deno !== "undefined") Deno.serve(async (req) => {
  const h = headers(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "GET") return new Response(JSON.stringify({ error: "GET only" }), { status: 405, headers: h });
  // ?r=wb,fernie reads only those resorts (the ones near the map); no r reads them all.
  const want = (new URL(req.url).searchParams.get("r") || "").split(",").filter((x) => SOURCES[x]);
  const ids = want.length ? want : Object.keys(SOURCES);
  const vals = await Promise.all(ids.map(read));
  return new Response(JSON.stringify({ t: new Date().toISOString(), resorts: Object.fromEntries(ids.map((id, i) => [id, vals[i]])) }), { headers: h });
});
