// Readers for the hunting regulation PDFs (turned into text by pdftotext -layout), used by build-hunting.mjs.
//  - abSeasons(): Alberta big game and game bird seasons per WMU (Alberta Guide to Hunting Regulations).
//  - bcLeh(): BC limited entry hunts with last year's first-choice draw odds (BC Limited Entry Hunting Synopsis).
//  - abDraws(): Alberta special licence draw results per hunt (AlbertaRELM draw summary pages).
// Each row keeps the regulations' own words where it can; the site always links the source to check.

// ---------- Alberta seasons ----------
// The guide writes dates as letter codes: S1 = September 1, N30 = November 30, Ap1 = April 1, Ju15 = June 15...
const AB_MON = { A: "Aug", S: "Sept", O: "Oct", N: "Nov", D: "Dec", J: "Jan", F: "Feb", M: "Mar", Ap: "Apr", Ma: "May", Ju: "June" };
// A footnote mark can stick to the end of a day ("N302" = Nov 30, note 2) or a WMU ("4384" = WMU 438, note 4).
const day = (d) => { let n = +d; while (n > 31) n = Math.floor(n / 10); return n; };
export function abDates(t) {
  let note = false;
  const s = String(t).replace(/\b(Ap|Ma|Ju|[ASONDJFM])(\d{1,3})\b/g, (m, mo, d) => { if (+d > 31) note = true; return `${AB_MON[mo]} ${day(d)}`; })
    .replace(/\bn\s+/g, "").replace(/\s+/g, " ").replace(/(,\s*)+,/g, ",").replace(/\s*,\s*$/, "").trim();
  return { s, note };
}
const wmusOf = (t) => {
  const out = [];
  let note = false;
  for (const m of String(t).matchAll(/\b(\d{3})(\d?)\b(?:\s*-\s*(\d{3})\b)?/g)) {
    if (m[2]) note = true;
    const a = +m[1], b = m[3] ? +m[3] : a;
    for (let i = a; i <= b && i - a < 900; i++) out.push(String(i));
  }
  return { list: out, note };
};
const cellsOf = (line) => [...line.matchAll(/\S+(?: \S+)*/g)].map((m) => ({ t: m[0], at: m.index, end: m.index + m[0].length }));

// Big game tables: Species | Type | Archery-only | General | WMUs, one table per WMU series, and the black bear table
// (Season | Archery-only | General | WMUs). A row starts where a new list of WMUs starts; the lines under it add more
// dates, more WMUs, or the rest of a wrapped species or type name.
function bigGame(text, out) {
  const lines = text.split("\n");
  let cols = null, bear = false, sp = null, ty = null, rec = null;
  const recs = [];
  const flush = () => { if (rec && rec.w.trim()) recs.push(rec); rec = null; };
  const emit = (rec) => {
    const { list, note } = wmusOf(rec.w.replace(/\([^)]*[A-Za-z][^)]*\)/g, (m) => (/\d{3}/.test(m) && !/WMU|only|west|east|north|south|CFB/i.test(m) ? m : "")));
    const extra = /only|west|east|north|south|portion/i.test(rec.w) ? rec.w.match(/\(([^)]*(?:only|west|east|north|south|portion)[^)]*)\)/i)?.[1] || "" : "";
    for (const [kind, raw] of [["Archery only", rec.a], ["General", rec.g]]) {
      if (!raw.trim()) continue;
      const special = /(^|\s)n\s/.test(" " + raw + " ");
      const { s, note: n2 } = abDates(raw);
      if (!/[A-Z][a-z]+\.? \d/.test(s)) continue;
      const row = [rec.sp.n.replace(/\d+$/, ""), special ? `${kind}, special licence (draw)` : kind, rec.ty.t.replace(/(\D)\d$/, "$1").replace(/\s+/g, " ").trim(),
        extra ? `${s} (${extra})` : s, note || n2 ? 1 : 0];
      for (const w of list) (out[w] = out[w] || []).push(row);
    }
  };
  for (const line of lines) {
    if (/Species\s+Type\s+Archery-only\s+General\s+WMUs/.test(line) || /^\s*Season\s+Archery-only\s+General\s+WMUs/.test(line)) {
      flush();
      bear = !/Species/.test(line);
      cols = { type: line.indexOf(bear ? "Season" : "Type"), arch: line.indexOf("Archery-only"), gen: line.indexOf("General"), wmu: line.indexOf("WMUs") };
      if (bear) { sp = { n: "Black bear" }; ty = { t: "" }; }
      continue;
    }
    if (!cols) continue;
    if (/^\s*(\d \S|page \d|\d{4} Alberta Guide|Additional hunting|Cougar|.*Report A Poacher|.*BIG GAME SEASONS|.*continued)/i.test(line)) { flush(); if (!/continued/i.test(line)) cols = null; continue; }
    // "N4 - N7, N11 - N14, 138, 140," can run dates and WMUs together with single spaces: split them
    const cells = cellsOf(line).flatMap((x) => {
      const m = x.t.match(/^(.*\b(?:Ap|Ma|Ju|[ASONDJFM])\d{1,3}\b,?)\s+(\(?\d{3}\b.*)$/);
      return m ? [{ t: m[1], at: x.at }, { t: m[2], at: x.at + m[1].length + 1 }] : [x];
    });
    if (!cells.length) continue;
    const c = { sp: "", ty: "", a: "", g: "", w: "" };
    for (const x of cells) {
      // a cell belongs to the column it starts in (layout text drifts a few characters left of the headings)
      // WMU lists start well left of their centred heading, so they're told apart by what they hold
      const wmu = x.at > cols.arch && (/^\(?\d{3}/.test(x.t) || /WMU|Monday|portion|CFB|west of|east of/.test(x.t));
      const k = wmu ? "w" : x.at >= (cols.arch + cols.gen) / 2 ? "g" : x.at >= cols.arch - 4 ? "a" : x.at >= cols.type - 3 ? "ty" : "sp";
      c[k] += (c[k] ? " " : "") + x.t;
    }
    if (bear) { c.ty = c.sp + (c.sp && c.ty ? " " : "") + c.ty; c.sp = ""; }
    const startsWmu = /^\(?\d{3}/.test(c.w) && !(rec && /[,(–-]\s*$/.test(rec.w));
    if (c.sp) {
      if (/^[a-z(]/.test(c.sp) && sp) sp.n += " " + c.sp;   // "White-tailed" / "deer"
      else sp = { n: c.sp.replace(/\s+\d$/, "") };
    }
    if (c.ty) {
      if (bear) { if (/^(Fall|Spring|Summer|Winter)/.test(c.ty)) ty = { t: c.ty }; }
      else if ((/^[a-z(]/.test(c.ty) || /\b(and|or)$/.test(ty?.t || "")) && ty) ty.t += " " + c.ty;
      else ty = { t: c.ty };
    }
    if (startsWmu) {
      flush();
      if (!sp || !ty) continue;
      rec = { sp, ty, a: c.a, g: c.g, w: c.w };
    } else if (rec) {
      if (c.a) rec.a += (rec.a ? ", " : "") + c.a;
      if (c.g) rec.g += (rec.g ? ", " : "") + c.g;
      if (c.w) rec.w += " " + c.w;
    }
  }
  flush();
  recs.forEach(emit);
}

// Cougar: two side-by-side tables (General Season | WMUs | Archery-only Season | WMUs) with dates over several lines.
function cougar(text, out) {
  const lines = text.split("\n");
  const h = lines.findIndex((l) => /General Season\s+WMUs\s+Archery-only Season\s+WMUs/.test(l));
  if (h < 0) return;
  const half = lines[h].indexOf("Archery-only Season") - 8;
  const side = [{ kind: "General", d: "", w: "" }, { kind: "Archery only", d: "", w: "" }];
  const flush = (x) => {
    const res = /Residents only/i.test(x.d), note = /\d{4}\d/.test(x.d);
    const { s } = abDates(x.d.replace(/Residents only/gi, "").replace(/(\d{4})\d(?:,\d)*/g, "$1").replace(/\b([A-Z][a-z]+ )(\d{2,3})\b/g, (m, mo, d) => mo + day(d)));
    if (x.w && /\d/.test(s)) for (const w of wmusOf(x.w).list) (out[w] = out[w] || []).push(["Cougar", x.kind, res ? "Residents only" : "", s, note ? 1 : 0]);
    x.d = ""; x.w = "";
  };
  for (let i = h + 1; i < lines.length && !/^\s*\d \S/.test(lines[i]); i++) {
    for (const c of cellsOf(lines[i])) {
      const x = side[c.at < half ? 0 : 1];
      if (/^\d{3}/.test(c.t)) x.w += " " + c.t;   // the WMU lists sit left of their heading
      else {
        if (/^(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(c.t) && /–\s*\S/.test(x.d)) flush(x);
        x.d += " " + c.t;
      }
    }
  }
  side.forEach(flush);
}

// Game birds: Species | limits | WMUs | Season date. Species names wrap and sit in the middle of their rows, so each
// row goes to the nearest species name.
function birds(text, out) {
  const lines = text.split("\n");
  const h = lines.findIndex((l) => /Species\s+Daily\s+Possession\s+WMUs\s+Season/.test(l));
  if (h < 0) return;
  const wAt = lines[h].indexOf("Possession") + 12, reqAt = lines[h].indexOf("Requirements") - 2;
  const names = [], rows = [];
  for (let i = h + 2; i < lines.length; i++) {
    const l = lines[i];
    if (/^ATTENTION|^\S/.test(l) && !/^ [A-Z]/.test(l)) break;
    const cells = cellsOf(l);
    const nm = cells.filter((c) => c.at < 22 && !/^\d/.test(c.t)).map((c) => c.t).join(" ");
    const isDate = (t) => /\b(?:Ap|Ma|Ju|[ASONDJFM])\d{1,2}\b/.test(t);
    const w = cells.filter((c) => c.at >= wAt && c.at < reqAt && /\d{3}/.test(c.t) && !isDate(c.t)).map((c) => c.t).join(" ");
    const s = cells.filter((c) => c.at >= wAt && c.at < reqAt && isDate(c.t)).map((c) => c.t).join(" ");
    if (nm) {
      const last = names[names.length - 1];
      if (last && (/^[a-z]/.test(nm) || /\b(or|,)$/.test(last.n) || /,$/.test(last.n)) && i - last.to <= 2) { last.n += " " + nm; last.to = i; }
      else names.push({ n: nm, from: i, to: i });
    }
    if (w) {
      const prev = rows[rows.length - 1];
      if (prev && /[,-]\s*$/.test(prev.w) && i - prev.to <= 2) { prev.w += " " + w; prev.to = i; if (s && !prev.s) prev.s = s; }
      else rows.push({ w, s, from: i, to: i });
    } else if (s) {
      const prev = rows[rows.length - 1];
      if (prev && !prev.s && i - prev.to <= 1) prev.s = s; else rows.push({ w: "", s, from: i, to: i, orphan: true });
    }
  }
  // a date on its own line belongs to the WMU row next to it
  for (const r of rows.filter((x) => x.orphan)) {
    const near = rows.filter((x) => !x.orphan && !x.s).sort((a, b) => Math.abs(a.from - r.from) - Math.abs(b.from - r.from))[0];
    if (near && Math.abs(near.from - r.from) <= 2) near.s = r.s;
  }
  for (const r of rows) {
    if (r.orphan || !r.w || !r.s) continue;
    const dist = (n) => (r.from > n.to ? r.from - n.to : n.from > r.to ? n.from - r.to : 0);
    const n = [...names].sort((a, b) => dist(a) - dist(b) || a.from - b.from)[0];
    if (!n) continue;
    const special = /(^|\s)n\s/.test(" " + r.s);
    for (const part of r.s.split(/\s*\/\s*/)) {
      const { s, note } = abDates(part);
      const name = n.n.replace(/\s+/g, " ").replace(/^(\S)/, (c) => c.toUpperCase());
      for (const x of wmusOf(r.w).list) (out[x] = out[x] || []).push([name, special ? "Special licence (draw)" : "", "", s, note ? 1 : 0]);
    }
  }
}

export function abSeasons(bigGameText, birdText) {
  const out = {};
  bigGame(bigGameText, out);
  cougar(bigGameText, out);
  if (birdText) birds(birdText, out);
  return out;
}

// ---------- BC limited entry hunts ----------
// Two columns of hunts per page: Code | Area | M.U. | Zone | Season Dates | Class of Animal | # of Auth | last year's odds.
// The first digit of the code is the species.
const LEH_SPECIES = { 0: "Bison", 1: "Caribou", 2: "Elk", 4: "Moose", 5: "Mountain goat", 6: "Mountain sheep", 7: "Deer", 8: "Black bear", 9: "Wild turkey" };
const MON = "(?:Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\\.?";
const LEH_ROW = new RegExp(String.raw`(?<!\S)(\d{4})\s{2,}([A-Z][A-Za-z.'’ /&()-]*?)\s{2,}(\d-\d{1,2}[A-Z]?\**(?:\s*[&,]\s*\d-\d{1,2}\**)*)\s+(?:(?!(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))(\S{1,4})\s+)?(?:(${MON} ?\d{1,2} ?- ?${MON} ?\d{1,2})\s+)?(\S.*?)\s{2,}(\d+)\s+([\d.,]+:1|N/A|New|NEW)`, "g");
export function bcLeh(text) {
  const out = {};
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(LEH_ROW)) {
      const [, code, area, mus, zone, dates, animal, auth, odds] = m;
      const sp = LEH_SPECIES[code[0]];
      if (!sp) continue;
      const row = { c: code, s: sp, a: area.trim(), z: zone && !/\d/.test(zone) ? zone.replace(/[^A-Z]/g, "") : "", d: dates ? dates.replace(/\s*-\s*/, " - ") : "", k: animal.replace(/\*+$/, "").trim(), n: +auth, o: /:1/.test(odds) ? odds : "" };
      for (const mu of mus.match(/\d-\d{1,2}/g).map((x) => x.replace(/-0(\d)/, "-$1"))) (out[mu] = out[mu] || []).push(row);
    }
  }
  return out;
}

// ---------- Alberta draw results ----------
// AlbertaRELM's draw summary page for each species lists every hunt: "110 - WMU 110 Nov 01 2026-Nov 30 2026", its quota,
// and, for each priority level, how many were drawn and how many weren't. Kept per hunt: quota, applicants, the lowest
// priority anyone was drawn at and the share drawn at that level.
export function abDrawPage(html, species) {
  const t = html.replace(/<(?!\/?(tr|h3)\b)[^>]*>/g, " ").replace(/&nbsp;/g, " ");
  const hunts = [];
  let draw = "", cur = null;
  for (const part of t.split(/<(?=tr|h3)/)) {
    const txt = part.replace(/^[^>]*>/, "").replace(/<\/?\w+[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (/^h3/.test(part)) { draw = txt; continue; }
    let m = txt.match(/^(\d{2,4}[A-Z]?) - (.+?) ((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2} \d{4}\s*-\s*\w{3} \d{2} \d{4}(?:\s*\(?[A-Za-z ,.-]*\)?)?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)%\s+(\d+)$/);
    if (m) {
      cur = { draw, code: m[1], name: m[2].trim(), season: m[3].trim(), quota: +m[4], levels: [] };
      hunts.push(cur);
      cur.levels.push([+m[5], +m[6], +m[7]]);
      continue;
    }
    m = txt.match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)%\s+(\d+)$/);
    if (m && cur) { cur.levels.push([+m[1], +m[2], +m[3]]); continue; }
    if (/^Subtotal/.test(txt)) cur = null;
  }
  const out = [];
  for (const h of hunts) {
    const apps = h.levels.reduce((s, [, d, u]) => s + d + u, 0), drawn = h.levels.reduce((s, [, d]) => s + d, 0);
    const got = h.levels.filter(([, d]) => d > 0).sort((a, b) => a[0] - b[0])[0];
    const wmus = wmusOf(h.name.replace(/\b\d{3}[A-Z]\b/g, (x) => x.slice(0, 3))).list;
    out.push({ s: species, d: h.draw, c: h.code, n: h.name, t: h.season.replace(/(\w{3}) (\d{2}) \d{4}\s*-\s*(\w{3}) (\d{2}) \d{4}/, (x, a, b, c, d) => `${a} ${+b} - ${c} ${+d}`),
      q: h.quota, a: apps, k: drawn, p: got ? got[0] : null, pp: got ? Math.round((got[1] / (got[1] + got[2])) * 100) : null, w: wmus });
  }
  return out;
}

// ---------- harvest statistics (harvest.json) ----------
// BC Big Game Harvest Statistics, WMU table (CSV, DataBC catalogue): one row per year, species and unit, with resident
// and non-resident hunters, days and kills. WMU "207" is MU 2-7; "200" (region number then 00) is the region's
// unassigned share and "900" the province's, both dropped. Kept: the last `years` years, as [hunters, days, kills].
export function bcHarvest(csv, years = 5) {
  const rows = csv.replace(/^﻿/, "").trim().split(/\r?\n/).map((l) => l.split(","));
  const head = rows.shift().map((h) => h.trim().toUpperCase()), col = (n) => head.indexOf(n);
  const Y = col("HUNT YEAR"), S = col("SPECIES"), W = col("WMU");
  const RH = col("RESIDENT HUNTERS"), RD = col("RESIDENT DAYS"), RK = col("RESIDENT KILLS");
  const NH = col("NON-RESIDENT HUNTERS"), ND = col("NON-RESIDENT DAYS"), NK = col("NON-RESIDENT KILLS");
  const last = Math.max(...rows.map((r) => +r[Y]).filter(Boolean)), from = last - years + 1;
  const n = (v) => (v === "" || v == null || isNaN(+v) ? 0 : +v);
  const mu = {};
  for (const r of rows) {
    const y = +r[Y], w = String(r[W] || "").trim();
    if (!(y >= from) || !/^[1-9]\d\d$/.test(w) || w.endsWith("00")) continue;
    const id = `${w[0]}-${+w.slice(1)}`;
    const sp = ((mu[id] ||= {})[r[S]] ||= Array(years).fill(null));
    sp[y - from] = [n(r[RH]) + n(r[NH]), n(r[RD]) + n(r[ND]), n(r[RK]) + n(r[NK])];
  }
  return { years: Array.from({ length: years }, (_, i) => from + i), mu };
}
// Alberta Hunter harvest report PDFs (one per species, resident harvest from general and special licences), turned
// into text: rows of "WMU  male  female  young  total  success%". Some rows cover several WMUs together ("116/118/119",
// "104,106,112"): each of them gets that row, with the group, unless it has a row of its own.
// Kept per WMU: [total, success %] or [total, success %, "116/118/119"].
export function abHarvest(text) {
  const out = {};
  for (const m of text.matchAll(/^\s*(\d{3}[A-Z]?(?:\s*[/,]\s*\d{3}[A-Z]?)*)\s+(\d[\d,]*)\s+(\d[\d,]*)\s+(\d[\d,]*)\s+(\d[\d,]*)\s+(\d{1,3})%?\s*$/gm)) {
    const list = m[1].split(/\s*[/,]\s*/), v = [+m[5].replace(/,/g, ""), +m[6]];
    if (list.length === 1) out[list[0]] = v;
    else for (const w of list) if (!out[w] || out[w][2]) out[w] = [...v, list.join("/")];
  }
  const y = text.match(/Hunter harvest report (\d{4})/);
  return { year: y ? +y[1] : null, wmu: out };
}
