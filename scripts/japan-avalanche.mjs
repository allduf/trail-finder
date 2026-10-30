// The Japan Avalanche Network's daily avalanche bulletins (nadare.jp, in English), as data/avalanche.json areas, so
// Skiing in Japan shows the danger, problems and advice like Avalanche Canada's (alex 2026-10-30: three weeks in Hakuba
// and Hokkaido this winter). Used by scripts/build-winter.mjs (avy run); can be run alone to print what it reads:
//   node scripts/japan-avalanche.mjs [html folder]   (a folder of saved pages reads those instead of the website)
// JAN has no feed: the area's bulletin list gives each bulletin's danger by band (img alt "Considerable"...), the
// bulletin page its problems (aspects as info2_<band>_<aspect>_ images, likelihood and size as _on images), travel
// advice and the avalanche/snowpack/weather summaries. robots.txt allows reading it (use=reference, crawl-delay 1).
// JAN publishes no area outlines: the rings below are drawn by hand around the mountains each bulletin names, and the
// elevation bands (ski-terrain.js bandsFor) are estimates. Rated "the current condition, not a forecast".
import { readFileSync, existsSync } from "node:fs";

const BASE = "https://data.nadare.jp";
const UA = "trail-finder winter data (https://github.com/allduf/trail-finder)";
// [JAN area id, name shown, ring as [lat, lon]...] around the ranges each bulletin covers.
export const JAN_AREAS = [
  [2, "Hakuba (Japan)", [[36.92, 137.70], [36.92, 137.93], [36.55, 137.93], [36.55, 137.70]]],
  [3, "Myoko (Japan)", [[37.03, 137.98], [37.03, 138.35], [36.76, 138.35], [36.76, 137.98]]],
  [4, "Kagura Tanigawa Hotaka (Japan)", [[37.00, 138.62], [37.00, 139.20], [36.68, 139.20], [36.68, 138.62]]],
  [1, "Tateyama (Japan)", [[36.68, 137.50], [36.68, 137.70], [36.45, 137.70], [36.45, 137.50]]],
  [7, "Central Hokkaido (Japan)", [[43.82, 142.30], [43.82, 143.05], [43.22, 143.05], [43.22, 142.30]]],
  [6, "SW Hokkaido (Japan)", [[43.00, 140.40], [43.00, 141.02], [42.68, 141.02], [42.68, 140.40]]],
];
const LEVEL = { low: 1, moderate: 2, considerable: 3, high: 4, extreme: 5 };
// A bulletin older than this is last season's (or yesterday's that wasn't replaced): shown as no rating.
const FRESH_H = 36;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const ring = (pts) => [...pts, pts[0]].flatMap(([a, b]) => [a, b]);

// One area's list page: the newest bulletin's id, time (Japan time) and danger by band (alpine, treeline, below).
export function parseList(html) {
  const row = /<a[^>]*href="\/avalanche_informations\/(\d+)"[^>]*>\s*([\d/]+ [\d:]+)\s*<\/a>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/.exec(html);
  if (!row) return null;
  const alts = [...row[4].matchAll(/alt="([^"]*)"/g)].map((m) => LEVEL[m[1].toLowerCase()] || 0);
  const [y, mo, d, h, mi] = row[2].split(/[/ :]/).map(Number);
  return { id: row[1], issued: new Date(Date.UTC(y, mo - 1, d, h - 9, mi)).toISOString(), area: clean(row[3]), alp: alts[0] || 0, tln: alts[1] || 0, btl: alts[2] || 0 };
}

// A bulletin page: problems, advice and summaries.
export function parseBulletin(html) {
  const section = (title) => {
    const i = html.search(new RegExp(`<h2[^>]*>\\s*${title}`));
    return i < 0 ? "" : html.slice(i, i + 20000);
  };
  const para = (s) => clean((/<p[^>]*>([\s\S]*?)<\/p>/.exec(s) || [])[1]);
  const advice = para(section("Travel and Terrain Advice"));
  const probPart = section("Avalanche Problem"), cut = probPart.search(/<h2[^>]*>\s*概要/);
  const probs = (cut > 0 ? probPart.slice(0, cut) : probPart).split("<!--留意する雪崩ブロック-->").slice(1).filter((b) => /<h3/.test(b));
  const problems = probs.map((b) => {
    const type = clean((/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(b) || [])[1]);
    const hits = [...b.matchAll(/info2_(alp|tl|btl)_(n|ne|e|se|s|sw|w|nw)_/g)];
    // As Avalanche Canada's codes ("possible_likely"), which winter.js turns into words.
    const likely = [...b.matchAll(/<img alt="([^"]+)" src="[^"]*info3_graph_[a-z_]+_on/g)].map((m) => m[1].toLowerCase() === "very likely" ? "veryLikely" : m[1].toLowerCase());
    const sizes = [...b.matchAll(/info4_size_(\d+)_on/g)].map((m) => +m[1] / 10).sort((a, c) => a - c);
    return {
      type, aspects: [...new Set(hits.map((m) => m[2]))], elevations: [...new Set(hits.map((m) => (m[1] === "tl" ? "tln" : m[1])))],
      likelihood: likely.join("_"), size: sizes.length ? (sizes[0] === sizes.at(-1) ? `${sizes[0]}` : `${sizes[0]}-${sizes.at(-1)}`) : "",
      comment: para(b.slice(b.lastIndexOf("info4_size"))).slice(0, 1200),
    };
  }).filter((p) => p.type);
  // The summaries (Avalanche, Snowpack, Weather) under the overview ("概要"): each card's heading and paragraph.
  const i = html.search(/<h2[^>]*>\s*概要/), over = i < 0 ? "" : html.slice(i, html.indexOf("data-print", i) >>> 0);
  const summaries = {};
  for (const m of over.matchAll(/<h2 class="[^"]*card-title[^"]*">\s*([^<]+?)\s*<\/h2>([\s\S]*?)(?=<h2|$)/g)) {
    const k = m[1].toLowerCase(), t = para(m[2]);
    if (t && /avalanche|snowpack|weather/.test(k)) summaries[/avalanche/.test(k) ? "avalanche-summary" : /snowpack/.test(k) ? "snowpack-summary" : "weather-summary"] = t.slice(0, 1500);
  }
  return { advice, problems, summaries };
}

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Every JAN area as an avalanche.json area: { id, name, rings, forecast } (forecast null when there's no bulletin today).
export async function buildJapanAvalanche({ log = console.log, dir = "", now = Date.now() } = {}) {
  const read = async (name, url) => {
    if (dir) { const f = `${dir}/${name}.html`; return existsSync(f) ? readFileSync(f, "utf8") : ""; }
    await sleep(1100);   // robots.txt crawl-delay
    return get(url);
  };
  const out = [];
  for (const [aid, name, pts] of JAN_AREAS) {
    const area = { id: `jan-${aid}`, name, rings: [ring(pts)], forecast: null };
    out.push(area);
    try {
      const top = parseList(await read(`list-${aid}`, `${BASE}/avalanche_informations?locale=en&area_id=${aid}`));
      if (!top) { log(`  JAN ${name}: no bulletins listed`); continue; }
      const age = (now - Date.parse(top.issued)) / 36e5;
      if (age > FRESH_H) { log(`  JAN ${name}: last bulletin ${top.issued} (${Math.round(age / 24)} days ago), none today`); continue; }
      const url = `${BASE}/avalanche_informations/${top.id}?locale=en`;
      const b = parseBulletin(await read(`b-${top.id}`, url));
      const date = new Date(Date.parse(top.issued) + 9 * 36e5).toISOString().slice(0, 10);
      area.forecast = {
        id: `jan-${top.id}`, title: name.replace(/ \(Japan\)$/, ""), url: `${BASE}/avalanche_informations/${top.id}?locale=en`,
        owner: "Japan Avalanche Network", issued: top.issued, validUntil: new Date(Date.parse(top.issued) + 24 * 36e5).toISOString(), forecaster: "",
        highlights: "", confidence: "", summaries: b.summaries, advice: b.advice ? [b.advice] : [], current: true,
        days: [{ date, label: "Today (current conditions)", alp: top.alp, tln: top.tln, btl: top.btl }], problems: b.problems,
      };
      log(`  JAN ${name}: ${top.issued} alp ${top.alp} tl ${top.tln} btl ${top.btl}; ${b.problems.map((p) => `${p.type} ${p.elevations.join("")}/${p.aspects.join("")} ${p.likelihood} ${p.size}`).join("; ") || "no problems"}`);
    } catch (e) { log(`  JAN ${name}: failed (${e.message})`); }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || "";
  const areas = await buildJapanAvalanche({ dir, now: process.env.NOW ? Date.parse(process.env.NOW) : Date.now() });
  console.log(JSON.stringify(areas.map((a) => ({ name: a.name, forecast: a.forecast })), null, 1).slice(0, 6000));
}
