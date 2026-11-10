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
// Some resorts also give their runs (runs: [{ n, s, d?, g? }], d: the resort's level word, g: groomed / moguls...) and
// counts (sum: { runs: [open, total], lifts: [open, total], carpets: [open, total] }) when they don't name each lift.

const ORIGINS = [/^https:\/\/allduf\.github\.io$/, /^https:\/\/(www\.)?trailfinderapp\.ca$/, /^http:\/\/localhost(:\d+)?$/, /^capacitor:\/\/localhost$/, /^https?:\/\/localhost$/];
const FRESH_MS = 3 * 60e3;
const UA = "Mozilla/5.0 (compatible; TrailFinder lift status; +https://allduf.github.io/trail-finder/)";

type Lift = { n: string; s: string; w?: number; o?: string; c?: string; k?: string; down?: string; ski?: string; skiOk?: boolean; rows?: Record<string, string> };
type Run = { n: string; s: string; d?: string; g?: string };
type Result = { lifts: Lift[]; t?: string; runs?: Run[]; sum?: Record<string, [number, number]> };
type Source = { name: string; page: string; url: string; kind: "vail" | "rcr" | "whitewater" | "sunpeaks" | "bigwhite" | "norquay" | "mtnpowder" | "bromont" | "revelstoke" | "louise" | "red" | "msa"
  | "stoneham" | "sutton" | "massif" | "orford" | "vsc" | "msl" | "relais" | "s2sg" | "owlshead" | "horseshoe" | "msm" | "searchmont" | "garceau" };

// The resorts whose lift status could be read (checked 2026-10-25, more 2026-10-28; Mount Washington and Marble Mountain
// turn away readers from data centres, so they stay links; Hudson Bay Mountain's lifts aren't in OpenStreetMap yet). The id is the resort's id in data/ski-lifts.json.
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
  // Added 2026-10-28.
  revelstoke: { name: "Revelstoke Mountain Resort", kind: "revelstoke", page: "https://www.revelstokemountainresort.com/mountain/conditions/lifts-grooming/", url: "https://www.revelstokemountainresort.com/mountain/conditions/lifts-grooming/" },
  // Lake Louise's own Run Status page (linked from skilouise.com) reads this report.
  louise: { name: "Lake Louise", kind: "louise", page: "https://www.skilouise.com/explore-winter/winter-ski-ride/lift-runs-parks-status/", url: "https://ski-louise-status-page.vercel.app/api/ski-data" },
  red: { name: "RED Mountain", kind: "red", page: "https://www.redresort.com/report/", url: "https://api.redresort.com/report/full" },
  msa: { name: "Mont-Sainte-Anne", kind: "msa", page: "https://mont-sainte-anne.com/conditions-de-neige-ski-alpin/", url: "https://mont-sainte-anne.com/refresh/refresh.php?lang=fr" },
  // Added 2026-10-30 (eastern Canada up to Whistler level): each resort's own conditions page.
  stoneham: { name: "Stoneham", kind: "stoneham", page: "https://ski-stoneham.com/", url: "https://ski-stoneham.com/refresh/refresh.php?lang=fr" },
  massif: { name: "Le Massif de Charlevoix", kind: "massif", page: "https://www.lemassif.com/fr/montagne/hiver/remontees-pistes-et-damage", url: "https://www.lemassif.com/fr/montagne/hiver/remontees-pistes-et-damage" },
  sutton: { name: "Mont Sutton", kind: "sutton", page: "https://montsutton.com/la-montagne/conditions-de-ski-2/domaine-skiable-ouvert/", url: "https://montsutton.com/la-montagne/conditions-de-ski-2/domaine-skiable-ouvert/" },
  orford: { name: "Mont Orford", kind: "orford", page: "https://montorford.com/fr-ca/hiver/conditions-ski/", url: "https://montorford.com/fr-ca/hiver/conditions-ski/" },
  vsc: { name: "Val Saint-Côme", kind: "vsc", page: "https://www.valsaintcome.com/conditions-et-horaire", url: "https://www.valsaintcome.com/conditions-et-horaire" },
  relais: { name: "Le Relais", kind: "relais", page: "https://www.skirelais.com/hiver/pistes-conditions-de-neige/", url: "https://www.skirelais.com/hiver/pistes-conditions-de-neige/" },
  owlshead: { name: "Owl's Head", kind: "owlshead", page: "https://owlshead.com/conditions-de-ski/", url: "https://owlshead.com/conditions-de-ski/" },
  horseshoe: { name: "Horseshoe Resort", kind: "horseshoe", page: "https://horseshoeresort.com/ski-report-trails/", url: "https://horseshoeresort.com/ski-report-trails/" },
  msm: { name: "Mont Sainte-Marie", kind: "msm", page: "https://montstemarie.com/pages/conditions", url: "https://montstemarie.com/pages/conditions" },
  searchmont: { name: "Searchmont", kind: "searchmont", page: "https://searchmont.com/snow-report/", url: "https://searchmont.com/snow-report/" },
  // Added 2026-11-10 (alex: "there is no lift status?" on Mont Garceau): its conditions page has every run open or
  // closed, and how many chairlifts and magic carpets run (not which one).
  garceau: { name: "Ski Garceau", kind: "garceau", page: "https://skigarceau.com/conditions-de-ski/", url: "https://skigarceau.com/conditions-de-ski/" },
  msl: { name: "Mount St. Louis Moonstone", kind: "msl", page: "https://www.mountstlouis.com/status/", url: "https://www.mountstlouis.com/status/" },
  // Added 2026-11-03: the Sea to Sky Gondola (Squamish), a sightseeing gondola that is also the way up to the Sky Pilot
  // backcountry (not a ski resort). Its Daily Conditions page says if it's open today, its hours, if skis and
  // snowboards may go up today, and how each trail and the Backcountry Access Road are.
  s2sg: { name: "Sea to Sky Gondola", kind: "s2sg", page: "https://www.seatoskygondola.com/daily-conditions/", url: "https://www.seatoskygondola.com/daily-conditions/" },
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
// "2026-10-28 10:48" read as local time in a time zone (daylight time included), as an ISO time.
const zoned = (s: string, tz: string) => {
  const guess = Date.parse(s.replace(" ", "T") + "Z");
  const there = Date.parse(new Date(guess).toLocaleString("sv-SE", { timeZone: tz }).replace(" ", "T") + "Z");
  return new Date(guess - (there - guess)).toISOString();
};
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
// Revelstoke: <h2>Stoke Chair</h2> <span class="lift-status lift-status--closed">, the time in .lifts-runs__timestamp.
function revelstoke(html: string): Result {
  const lifts: Lift[] = [];
  for (const m of html.matchAll(/<h2>([^<]+)<\/h2>\s*<span class="lift-status lift-status--([a-z-]+)"/g)) lifts.push({ n: text(m[1]), s: stateOf(m[2]) });
  const t = /lifts-runs__timestamp[\s\S]{0,120}?(\d{4}-\d\d-\d\d \d\d:\d\d(?::\d\d)?)/.exec(html);
  return { lifts, t: t ? zoned(t[1], "America/Vancouver") : undefined };
}
// Lake Louise: an XML mountain report, <report updated="..."> ... <lift id name status realtime type/>.
function louise(xml: string): Result {
  const lifts: Lift[] = [], seen = new Set<string>();
  const attr = (tag: string, k: string) => (new RegExp(`\\b${k}="([^"]*)"`).exec(tag) || [])[1];
  for (const m of xml.matchAll(/<lift\b[^>]*>/g)) {
    const n = attr(m[0], "name");
    if (!n || seen.has(n)) continue;
    seen.add(n);
    lifts.push({ n: text(n), s: stateOf(attr(m[0], "realtime") || attr(m[0], "status")) });
  }
  const u = /<report\b[^>]*\bupdated="([^"]+)"/.exec(xml);
  return { lifts, t: u && !isNaN(Date.parse(u[1])) ? new Date(u[1]).toISOString() : undefined };
}
// RED Mountain: { MountainReport: { Lifts: [{ Name, Status, Hours: "9:00 AM - 3:30 pm" }] } }. Off season Status is "".
function red(json: string): Result {
  const d = JSON.parse(json), lifts: Lift[] = [];
  for (const l of (d.MountainReport && d.MountainReport.Lifts) || []) {
    if (!l || !l.Name) continue;
    const [o, c] = String(l.Hours || "").split(/\s+-\s+/);
    lifts.push({ n: text(l.Name), s: l.Status ? stateOf(l.Status) : "closed", ...(hhmm(o) && hhmm(c) ? { o, c } : {}) });
  }
  return { lifts };
}
// Mont-Sainte-Anne: refresh.php fills the conditions page; the day lifts are in 'lifts-day-element-msa' as
// <div class="lift-name-element">Name</div><div class="lift-open-element"><img src=".../conditions/closed.svg">.
function msa(html: string): Result {
  const lifts: Lift[] = [], seen = new Set<string>();
  const i = html.indexOf("'lifts-day-element-msa').innerHTML"), part = i < 0 ? "" : html.slice(i, html.indexOf("\n", i));
  for (const m of part.matchAll(/lift-name-element">([^<]+)<\/div><div class="lift-open-element">\s*<img[^>]*src="[^"]*\/([a-z_-]+)\.(?:svg|png)"[\s\S]*?lift-time-element2">([^<]*)</g)) {
    const n = text(m[1].replace(/\\'/g, "'"));
    if (seen.has(n)) continue;
    seen.add(n);
    const [o, c] = m[3].split(/\s*[-–à]\s*/);
    lifts.push({ n, s: stateOf(m[2]), ...(hhmm(o) && hhmm(c) ? { o, c } : {}) });
  }
  const d = /'applicationDate'\)\.innerHTML= '(\d{4}-\d\d-\d\d \d\d:\d\d)/.exec(html);
  return { lifts, t: d ? zoned(d[1], "America/Toronto") : undefined };
}
// Stoneham (same owner as Mont-Sainte-Anne, older page): 'lifts-day-element' as <div class="lift-name">Name</div>
// <div class="lift-open"><span class="largecheck|largex|largeminus">; minus (off season) is closed.
const iconState = (c: string) => (/minus|\bx\b|largex|close|ferm/.test(c) ? "closed" : stateOf(c));
function stoneham(html: string): Result {
  const lifts: Lift[] = [], seen = new Set<string>();
  const i = html.indexOf("'lifts-day-element').innerHTML"), part = i < 0 ? "" : html.slice(i, html.indexOf("\n", i));
  for (const m of part.matchAll(/lift-name">([^<]+)<\/div><div class="lift-open">\s*<span class="([^"]*)"/g)) {
    const n = text(m[1].replace(/\\'/g, "'"));
    if (!n || seen.has(n)) continue;
    seen.add(n);
    lifts.push({ n, s: iconState(m[2]) });
  }
  const d = /drop_date">(\d{4}-\d\d-\d\d) (\d{1,2}):(\d\d)/.exec(part);
  return { lifts, t: d ? zoned(`${d[1]} ${d[2].padStart(2, "0")}:${d[3]}`, "America/Toronto") : undefined };
}
// Rows of a table: [name cell, state cell]; the state is the cell's words, else its class.
function rows(part: string, re: RegExp, nameAt = 1, stateAt = 2): Lift[] {
  const lifts: Lift[] = [], seen = new Set<string>();
  for (const m of part.matchAll(re)) {
    const n = text(m[nameAt]);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    lifts.push({ n, s: iconState(text(m[stateAt]) || m[stateAt + 1] || "") });
  }
  return lifts;
}
const between = (html: string, a: string, b: string) => { const i = html.indexOf(a); return i < 0 ? "" : html.slice(i, html.indexOf(b, i + a.length) >>> 0); };
// Mont Sutton: <div id="lifts"> table, rows <td>II</td> <td> quadruple détachable </td> <td class="ferme">Fermé</td>.
function sutton(html: string): Result {
  return { lifts: rows(between(html, 'id="lifts"', "</table>"), /<tr>\s*<td>([^<]+)<\/td>\s*<td>[^<]*<\/td>\s*<td class="([^"]*)">([^<]*)<\/td>/g, 1, 3).map((l) => ({ ...l, n: "Télésiège " + l.n })) };
}
// Le Massif: <article class="node--type-lift"> letter + name in .cell.title, state in the .status icon's title.
function massif(html: string): Result {
  const lifts: Lift[] = [];
  for (const m of html.matchAll(/<article[^>]*node--type-lift[\s\S]*?<\/article>/g)) {
    const a = m[0], n = /<div class="m-t-0">([^<]+)<\/div>/.exec(a), st = /status ([a-z-]*)">\s*<div class="icon" title="([^"]*)"/.exec(a);
    if (n && st) lifts.push({ n: text(n[1]), s: iconState(st[2] || st[1]) });
  }
  return { lifts };
}
// Mont Orford: in the Remontées part, each lift is an icon (red #ec1d24 closed, green open, orange on hold) and <span class="name">.
function orford(html: string): Result {
  const lifts: Lift[] = [], seen = new Set<string>(), bits = between(html, "-chairlifts", "Besoin d").split('<span class="name">');
  for (let i = 1; i < bits.length; i++) {
    const n = text(bits[i].slice(0, bits[i].indexOf("<"))), icon = bits[i - 1].slice(bits[i - 1].lastIndexOf("icon status"));
    const c = /fill:#([0-9a-f]{6})/i.exec(icon);
    if (!n || !c || seen.has(n)) continue;
    seen.add(n);
    const [r, g] = [parseInt(c[1].slice(0, 2), 16), parseInt(c[1].slice(2, 4), 16)];
    lifts.push({ n, s: g > r + 40 ? "open" : r > 200 && g > 120 ? "hold" : "closed" });
  }
  return { lifts };
}
// Val Saint-Côme: "Remontées mécaniques" list, <p class="... text-gray-800"> Name </p> ... <span ...> Fermé </span>.
function vsc(html: string): Result {
  return { lifts: rows(between(html, "Remontées mécaniques", "Pistes</"), /<p class="[^"]*text-gray-800">([^<]+)<\/p>\s*<\/div>\s*<span[^>]*>([^<]*)<\/span>/g) };
}
// Le Relais: <table class="lifts-list">, rows <td>Name</td> then the day cell <span class="element-status open|close">.
function relais(html: string): Result {
  return { lifts: rows(between(html, 'class="align-middle lifts-list"', "</table>"), /<td>([^<]+)<\/td>\s*<td[^>]*><span class="element-status ([a-z]+)/g, 1, 2) };
}
// Mount St. Louis Moonstone: a table under each "... Lifts" heading (Moonstone's says Run in the table head), rows
// <td class="title">Name</td> <td class="status">Closed</td>; the runs tables look the same.
function msl(html: string): Result {
  const part = html.split("<table").filter((t, i, all) => i && /Lifts\s*(<[^>]*>\s*)*$/.test(all[i - 1].slice(-300).replace(/<\/?(div|span|h\d)[^>]*>/g, " ").trimEnd() + " ")).join("");
  return { lifts: rows(part, /<td class\s*=\s*"title">([^<]+)<\/td>\s*<td[^>]*class\s*=\s*"status">([^<]*)<\/td>/g) };
}
// Owl's Head: one "section-piste" per lift, <span class="label-title p-small">1. Sommet</span> then
// <span class="section-close">Fermé</span> (section-open when it runs); the snow park and alpine touring sections aren't lifts.
function owlshead(html: string): Result {
  const lifts: Lift[] = [];
  for (const m of html.matchAll(/label-title p-small">\s*\d+\.\s*([^<]+)<\/span>\s*<span class="section-([a-z]+)">([^<]*)</g))
    lifts.push({ n: text(m[1]), s: iconState(text(m[3]) || m[2]) });
  return { lifts };
}
// Horseshoe: the table under "Chair Lifts", rows <td>Name</td> then a day and a night cell <td class="open|closed">; open if either
// runs. "Updated: Sunday, April 5, 2026" above it is the day staff last wrote it.
function horseshoe(html: string): Result {
  const part = between(html, "<h1>Chair Lifts</h1>", "</table>"), lifts: Lift[] = [];
  for (const m of part.matchAll(/<tr>\s*<td>([^<]+)<\/td>\s*<td class="([a-z-]*)"[\s\S]*?<\/td>\s*(?:<td class="([a-z-]*)")?/g)) {
    const day = stateOf(m[2]), night = m[3] ? stateOf(m[3]) : "closed";
    lifts.push({ n: text(m[1]).replace(/ \d Person Chair$/, ""), s: day === "open" || night === "open" ? "open" : day === "hold" || night === "hold" ? "hold" : "closed" });
  }
  const u = /class="updated">Updated:\s*(?:[a-z]+,\s*)?([a-z]+)\s+(\d{1,2}),\s*(\d{4})/i.exec(html);
  const t = u && MONTHS.includes(u[1].toLowerCase()) ? zoned(`${u[3]}-${String(MONTHS.indexOf(u[1].toLowerCase()) + 1).padStart(2, "0")}-${u[2].padStart(2, "0")} 08:00`, "America/Toronto") : undefined;
  return { lifts, t };
}
// Mont Sainte-Marie: <table class="lifts-table">, rows icon cell, <td>Name</td>, <td>🔴 Fermé-Closed</td> (🟢 open).
function msm(html: string): Result {
  return { lifts: rows(between(html, 'class="lifts-table"', "</table>"), /<tr>\s*<td><img[^>]*><\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]*)<\/td>/g)
    .filter((l) => !/^shuttle$/i.test(l.n)) };
}
// Searchmont: <p class="slope-access-name"><strong>Buzzsaw Lift:</strong> <img src=".../green-check-32.png"> Open</p>.
// The page keeps last season's signs all summer and has no date, so outside December to April it says nothing.
function searchmont(html: string): Result {
  const m = new Date().getUTCMonth(), season = m === 11 || m <= 3;
  return { lifts: rows(html, /slope-access-name"><strong>([^<:]+):?<\/strong>\s*<img[^>]*src="[^"]*\/([a-z-]+)-32\.png"[^>]*>\s*([^<]*)/g, 1, 3)
    .map((l) => ({ ...l, s: season ? l.s : "unknown" })) };
}
// Sea to Sky Gondola: the bar at the top of every page says "OPEN 9 AM to 5 PM (Last Ride Down 6 PM)" (or that it's
// closed); the Daily Conditions tables have one row per trail and activity (<tr><td>name<td>today's note), with
// "Ski and Snowboard Touring" saying if backcountry skis and boards may go up today; "Last Updated: Monday, November 2,
// 2026 at 9:00 am." is when staff wrote it (Vancouver time).
// Ski Garceau: counts in <strong class="conditions-ski-value">0/38</strong><span class="conditions-ski-label">Pistes
// ouvertes</span> (also Remontées mécaniques, Tapis magiques); the runs table rows <th>3A</th><td>Chiquita I</td>
// <td><img alt="Intermédiaire"></td><td>Damée</td><td><span class="pistes-etat pistes-etat--fermee">Fermée</span>.
// Lifts aren't named, so lifts is empty and sum says how many run.
export function garceau(html: string): Result {
  const sum: Record<string, [number, number]> = {};
  for (const m of html.matchAll(/conditions-ski-value">\s*(\d+)\s*\/\s*(\d+)\s*<\/strong>\s*<span class="conditions-ski-label">([^<]+)</g)) {
    const k = /piste/i.test(m[3]) ? "runs" : /tapis/i.test(m[3]) ? "carpets" : /remont/i.test(m[3]) ? "lifts" : "";
    if (k && +m[1] <= +m[2]) sum[k] = [+m[1], +m[2]];
  }
  const runs: Run[] = [];
  for (const tr of between(html, "tableau-pistes", "</table>").split(/<tr>/).slice(2)) {
    const td = [...tr.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    const st = /pistes-etat--([a-z]+)/.exec(tr);
    if (td.length < 4 || !st) continue;
    const d = (/alt="([^"]+)"/.exec(td[1]) || [])[1];
    runs.push({ n: text(td[0]), s: /^ouvert/.test(st[1]) ? "open" : /^ferm/.test(st[1]) ? "closed" : stateOf(text(td[3])), ...(d ? { d: text(d) } : {}), ...(text(td[2]) ? { g: text(td[2]) } : {}) });
  }
  return { lifts: [], runs, sum };
}
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export function s2sg(html: string): Result {
  const bar = text((/quick-info__text>([^<]*)</.exec(html) || [])[1] || "");
  const hrs = /(\d{1,2}(?::\d\d)?\s*[ap]\.?m\.?)\s*(?:to|-|–)\s*(\d{1,2}(?::\d\d)?\s*[ap]\.?m\.?)/i.exec(bar);
  const down = /last ride down\s*([0-9:]+\s*[ap]\.?m\.?)/i.exec(bar);
  const rows: Record<string, string> = {};
  for (const tr of html.split(/<tr>/i).slice(1)) {
    const cells = tr.split(/<td[^>]*>/i).slice(1);
    if (cells.length < 2) continue;
    const n = text(cells[0]).replace(/([a-z])(Trail)\b/, "$1 $2"), v = text(cells[1].split(/<\/table>/i)[0]);
    if (n && v && n.length < 60 && !/^(trail|activity)$/i.test(n)) rows[n] = v.slice(0, 400);
  }
  const skiKey = Object.keys(rows).find((k) => /ski and snowboard touring|ski touring/i.test(k));
  const ski = skiKey ? rows[skiKey].split(/ For (some )?information/i)[0].trim() : undefined;
  const skiOk = ski ? !/not|no skis|closed/i.test(ski) && /allowed|permitted|yes|will go up/i.test(ski) : undefined;
  const st = /\bclosed\b/i.test(bar) ? "closed" : /\bopen\b/i.test(bar) ? "open" : "unknown";
  const u = /Last Updated:\s*(?:[a-z]+,\s*)?([a-z]+)\s+(\d{1,2}),\s*(\d{4})(?:\s*at\s*(\d{1,2}):(\d\d)\s*([ap])\.?m)?/i.exec(text(html.slice(0, 200000)));
  let t: string | undefined;
  if (u && MONTHS.includes(u[1].toLowerCase())) {
    const h = u[4] ? (+u[4] % 12) + (u[6].toLowerCase() === "p" ? 12 : 0) : 8;
    const pad = (x: number) => String(x).padStart(2, "0");
    t = zoned(`${u[3]}-${pad(MONTHS.indexOf(u[1].toLowerCase()) + 1)}-${pad(+u[2])} ${pad(h)}:${u[5] || "00"}`, "America/Vancouver");
  }
  return { lifts: [{ n: "Sea to Sky Gondola", s: st, k: "gondola", ...(hrs ? { o: hrs[1], c: hrs[2] } : {}), ...(down ? { down: down[1] } : {}), ...(ski ? { ski, skiOk } : {}), rows }], t };
}
export const PARSE: Record<Source["kind"], (body: string) => Result> = { vail, rcr, whitewater, sunpeaks, bigwhite, norquay, mtnpowder, bromont, revelstoke, louise, red, msa,
  stoneham, sutton, massif, orford, vsc, relais, msl, s2sg, owlshead, horseshoe, msm, searchmont, garceau };

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
    v = { name: src.name, page: src.page, src: src.kind, t: res.t || (mod ? new Date(mod).toISOString() : new Date().toISOString()), lifts: res.lifts, ...(res.t || mod ? {} : { noDate: true }),
      ...(res.runs && res.runs.length ? { runs: res.runs } : {}), ...(res.sum && Object.keys(res.sum).length ? { sum: res.sum } : {}) };
  } catch (e) {
    v = { name: src.name, page: src.page, src: src.kind, lifts: [], err: String((e as Error)?.message || e).slice(0, 120), ...(hit ? { old: hit.v } : {}) };
  }
  cache.set(id, { at: Date.now(), v });
  return v;
}

// Webcam pictures whose file names change (alex 2026-10-31): Big White numbers each new picture (gemlake_124.jpg), so the
// app asks here for the current names: ?cams=bigwhite → { cams: { bigwhite: { gemlake: "https://…/gemlake_124.jpg" } } }.
// Only the names are read off the resort's own webcam page; the pictures still load from their site.
const CAM_PAGES: Record<string, { url: string; re: RegExp; base: string }> = {
  bigwhite: { url: "https://www.bigwhite.com/mountain-conditions/webcams", re: /\/sites\/default\/files\/([a-z0-9]+)_(\d+)\.jpg/g, base: "https://www.bigwhite.com/sites/default/files/" },
};
export function camNames(id: string, html: string): Record<string, string> {
  const P = CAM_PAGES[id], out: Record<string, string> = {};
  for (const m of html.matchAll(P.re)) out[m[1]] = `${P.base}${m[1]}_${m[2]}.jpg`;
  return out;
}
async function readCams(id: string): Promise<Record<string, string>> {
  const key = "cams:" + id, hit = cache.get(key);
  if (hit && Date.now() - hit.at < 4 * 60000) return hit.v as Record<string, string>;
  try {
    const r = await fetch(CAM_PAGES[id].url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(String(r.status));
    const v = camNames(id, await r.text());
    cache.set(key, { at: Date.now(), v });
    return v;
  } catch {
    return (hit?.v as Record<string, string>) || {};
  }
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
  const camIds = (new URL(req.url).searchParams.get("cams") || "").split(",").filter((x) => CAM_PAGES[x]);
  if (camIds.length) {
    const got = await Promise.all(camIds.map(readCams));
    return new Response(JSON.stringify({ t: new Date().toISOString(), cams: Object.fromEntries(camIds.map((id, i) => [id, got[i]])) }), { headers: h });
  }
  // ?r=wb,fernie reads only those resorts (the ones near the map); no r reads them all.
  const want = (new URL(req.url).searchParams.get("r") || "").split(",").filter((x) => SOURCES[x]);
  const ids = want.length ? want : Object.keys(SOURCES);
  const vals = await Promise.all(ids.map(read));
  return new Response(JSON.stringify({ t: new Date().toISOString(), resorts: Object.fromEntries(ids.map((id, i) => [id, vals[i]])) }), { headers: h });
});
