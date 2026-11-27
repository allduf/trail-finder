// Plan a cabin trip (Skiing). alex 2026-10-30: "we should have feature 'plan a cabin trip' in skiing", then picked
// the core first: the cabin and the dates, the way in, the conditions for each day of the trip, and saving it all for
// when there's no signal.
//  - "Plan a cabin trip here" on a hut's card (winter.js select) opens the trip card: the night you go in, how many
//    nights, how many people, and what's known about the cabin (its tags: beds, price, booking, who runs it, links;
//    the huts thread fills the same tags from the clubs' own pages).
//  - The way in: the easiest walk from a parking lot (or a road) to the cabin, worked out by fish-route.js (the same
//    search as Fishing's Route, with the ski routes added as trails; a logging road counts as a start but costs more,
//    as most aren't plowed). Then its heights and slopes (ski-terrain.js): km, climb, Munter time in and out, steepest,
//    30°+ slopes, the terrain class. "Show on map" opens it as a tour, with the route card's
//    Conditions, Avalanche check, Flyover, GPX and Go. "Draw my own" uses Plan a tour.
//  - Each day of the trip: the avalanche danger on the way in (Avalanche Canada, about 3 days ahead) with the
//    Avaluator light for the way in's terrain, and the weather at the cabin (Open-Meteo, about a week ahead); the snow
//    and wind in the 3 days before you go in.
//  - Save offline: the map, ski data and terrain around the cabin and the way in (offline.js), and the forecast as it
//    is now is kept with the trip and shown when there's no signal.
//  - Then (alex picked them 2026-10-30): day tours from the cabin (mapped tours within 1.5 km, ★ the ones you plan),
//    a packing list built from the trip (nights, people, what the cabin has, the coldest night, the way in's slopes),
//    and a trip plan to leave with a friend, with a late alert for their calendar at the "call for help" time.
//  - Then (alex 2026-11-11: "a folder where you can save the approach route and all the lines that you want to ride on that
//    trip", and a list of what to bring that you tick as it goes in the bag): each trip is a folder. "Your lines for
//    this trip" holds the way in plus any ski line added from its card (🏕 Add to cabin trip), a saved planned tour, or a
//    ★ tour near the cabin; they're kept with the trip (their points, so they show with no signal and go in the offline
//    save) and drawn together on the map. The packing list takes your own items and drops the ones you don't bring;
//    those choices carry over to the next trip (tf:tripPack, on the account when signed in).
// Since 2026-11-16 (alex: the same trip planner for every sport) the parts every trip shares (the group, packing,
// meals, booking, costs, journal, sharing, the plan you tell someone, offline) live in trip-core.js; this file is
// Skiing's kit: the cabin, the way in, the avalanche days, day tours and the ski packing list.
// Trips are kept in tf:skiTrips, saved to the rider's account when signed in (account.js merges both devices' trips).
(() => {
  "use strict";
  const map = window.tfLeaflet, S = window.tfSki && window.tfSki.trip, T = window.tfTerrain;
  if (!map || !window.L || !S || !T || !window.tfTripEngine || window.tfCabinTrip) return;
  const isSki = () => document.body.classList.contains("sport-ski");
  const COL = "#7048e8";   // the way in on the map and the trip card's colour
  const LCOL = "#e8590c";   // the trip's lines
  const css = document.createElement("style");
  css.textContent = `#skiPane { --tp: ${COL}; }
#skiPane .sk-acts.tp4 { grid-template-columns: repeat(3, 1fr); }`;   /* phones: one row each (theme.css) */
  document.head.append(css);

  let E = null, $, esc, toast, fmtM, fmtH, deg, when, dayWord, addDays, localDate;   // the engine (trip-core.js) and its helpers
  const cur = () => E.cur();
  const hutName = (t) => (t.hut ? t.name || t.hut.name || S.KIND[t.hut.kind] || "Cabin" : t.name || "My trip");
  const hutOf = (h) => ({ id: h.id, name: h.name || "", kind: h.kind || "", lat: h.lat, lon: h.lon, tags: h.tags || {} });
  const infos = new Map();   // trip id -> the way in's heights and slopes (ski-terrain.js info), for its route card
  const wayRun = { n: 0 };
  const WAY_V = 3;   // ways worked out before the winter parking and winter routes are worked out again
  const api = window.tfTripEngine((e) => { E = e; ({ $, esc, toast, fmtM, fmtH, deg, when, dayWord, addDays, localDate } = e); return kit(); });
  if (!api) return;

  function kit() {
    return {
      id: "ski", key: "skiTrips", packKey: "tripPack", color: COL, lineColor: LCOL, pane: "ski", cardId: "skTrip", tutorial: "cabin-trip",
      shared: ["way"],
      w: {
        icon: "🏕", trip: "cabin trip", Trips: "Cabin trips", btn: "🏕 Cabin trip", btnTitle: "Plan a trip to a backcountry cabin: the way in, the forecast for each day, offline",
        addTo: "🏕 Add to cabin trip", line: "Ski line", lines: "Your lines for this trip", goIn: "Go in", first: "going in", last: "out", prod: "Cabin trip",
        overdue: "a backcountry ski trip", journal: "How the snow was, what you skied, what to bring next time.", finding: "Finding cabins…",
        updates: "the trip's weather, avalanche danger and offline copy", offPrefix: "Cabin trip: ",
        offWhat: "the map, ski routes, slopes and avalanche forecast in the square you pick (it starts around the cabin, the way in and your lines)",
        offSaved: "the map, ski routes, slopes and avalanche forecast", offFresh: "avalanche, ski and snow files", offOut: "a line or the way in added since",
      },
      groupGear: new Set(["sat", "aid", "repair", "bivy", "stove", "pot", "fire", "booking", "fee", "wag", "tp", "trash"]),
      isOn: isSki,
      mount(card, btn) {
        const detail = $("skDetail");
        if (!detail) return false;
        detail.before(card);
        btn.className = "sk-act"; btn.id = "skTripBtn";
        const acts = document.querySelector("#skiPane .sk-acts");
        if (acts) { acts.append(btn); acts.classList.add("tp4"); }
      },
      title: hutName,
      namePh: (t) => (t.hut ? t.hut.name || "Cabin trip" : "Like: Spearhead hut trip"),
      newTrip: () => ({ way: null }),
      start(t) {
        if (!t.hut) { nearCabins(); return; }
        if (t.way && t.way.src === "auto" && t.way.v !== WAY_V) { t.way = null; t.wayFail = ""; }
        if (!t.way && !/^(noroad|water)$/.test(t.wayFail || "")) findWay(t);
        E.loadDays(t);
        loadTours(t).then(() => movePicks(t));
      },
      hasDays: (t) => !!t.hut,
      snapOf, daysHtml, packItems, planText,
      keyOf: (t) => JSON.stringify(t.way || null),
      bookTop(t) {
        const g = (t.hut && t.hut.tags) || {}, site = g["reservation:website"] || (/^(required|only|yes)$/.test(g.reservation || "") ? g.website : "");
        return { tag: /^(required|only)$/.test(g.reservation || "") ? "needs booking" : "",
          html: `${g.reservation ? `<p class="sk-note">${g.reservation === "no" ? "This cabin takes no bookings: first come, first served." : /^(required|only)$/.test(g.reservation) ? "This cabin must be booked ahead." : "This cabin can be booked."}${g.charge ? ` Fee: ${esc(g.charge)}.` : ""}</p>` : ""}
      ${site ? `<div class="tp-btns"><a href="${esc(site)}" target="_blank" rel="noopener">🔗 Book on their site</a></div>` : ""}` };
      },
      bookSite: (t) => { const g = (t.hut && t.hut.tags) || {}; return g["reservation:website"] || g.website || ""; },
      bookWhat: (t) => `Book the cabin for ${t.people} people.`,
      costHint: (t) => { const g = (t.hut && t.hut.tags) || {}; return `Add the cabin fee, gas, food and anything else the group shares.${g.charge ? ` The cabin's fee: ${esc(g.charge)}.` : ""}`; },
      baseHtml: (t) => (t.hut ? factsHtml(t) : `<div class="sk-sec tp-nohut" id="tpCabin"><h4>The cabin</h4><p class="sk-note">No cabin yet: everything else works without one. Tap a cabin (the brown dots) on the map and then <b>🏕 Use this cabin for ${esc(hutName(t))}</b>, or pick one near the middle of the map:</p><ul class="tp-list" id="tpNear"><li><p class="tp-wait">Finding cabins…</p></li></ul></div>`),
      midHtml: (t) => (t.hut ? `<div class="sk-sec tp-way" id="tpWay"><h4>The way in</h4>${wayHtml(t)}</div>
      <div class="sk-sec" id="tpDays"><h4>Each day</h4>${E.daysHtml()}</div>` : ""),
      afterLinesHtml: (t) => (t.hut ? `<div class="sk-sec" id="tpTours"><h4>Day tours from the cabin</h4>${toursHtml(t)}</div>` : ""),
      afterRender(t) { if (!t.hut) nearCabins(); },
      baseBtn: (t) => (t.hut ? `<button type="button" data-tp="hut">Cabin details</button>` : ""),
      linesTop(t) { const w = t.way; return w ? `<li><button type="button" data-tl="way"><span><i class="tp-sw way"></i>The way in <small>${w.km.toFixed(1)} km · ↑ ${fmtM(w.up)}</small></span></button></li>` : ""; },
      linesEmpty: (t) => `No lines yet. Tap any ski line on the map and then <b>🏕 Add to cabin trip</b>, ${t.hut ? "★ a tour near the cabin below, " : ""}or draw your own.`,
      drawLabel: (t) => (t.hut ? "Draw a tour from the cabin" : "Draw a tour"),
      linesChanged: () => renderTours(),
      canEdit: true, editLine, openWay, openLine, drawExtra, extraPts: (t) => (t.way ? t.way.line : []),
      gpxExtra: (t, trk) => (t.way ? trk(`Way in to ${hutName(t)}`, [t.way.line]) : ""),
      offBase: (t) => (t.hut && t.hut.name) || hutName(t),   // the cabin's name: renaming the trip keeps its offline save
      offUrls: (box) => (window.tfSkiOffline ? window.tfSkiOffline(box).data : []),
      onTp, nearList: nearCabins,
      listNote: () => `Or start from a cabin: tap one (the brown dots) on the map, then <b>Plan a cabin trip here</b>, or pick one near you:`,
    };
  }

  // ---------- trips ----------
  // A trip doesn't need a cabin to start (alex 2026-11-11: "I don't want to be obligated to select a cabin before starting
  // organising the rest"): ＋ Start a new trip opens one with no cabin (t.hut null, named by you), and the cabin comes
  // later, from the card's list or a cabin's 🏕 Use this cabin for… on the map.
  function setHut(t, h) {
    t.hut = hutOf(h); t.way = null; t.wayFail = ""; t.tours = null; t.snap = null;
    E.putTrip(t);
    E.start(t);
    toast(`${hutName(t)} is the cabin for this trip.`);
  }
  function open(h) {
    if (!h) return;
    const c = cur();
    if (c && !c.hut && !E.card.hidden) { setHut(c, h); return; }   // the open trip had no cabin yet
    const old = E.trips().find((x) => x.hut && x.hut.id === h.id);
    const t = old || { ...E.newTrip(), hut: hutOf(h) };
    t.hut = { ...t.hut, ...hutOf(h), tags: { ...(t.hut.tags || {}), ...(h.tags || {}) } };   // newer facts about the cabin win
    E.start(t);
  }

  // ---------- the way in ----------
  // The search from fish-route.js, back from the cabin to the best place to leave the car within 2, 5 or 9 km, with
  // the ski routes as trails. Its line runs from the start to the cabin. In winter the car stays on a plowed road
  // (alex 2026-10-30, Tom's Hut: "most fsr are not plowed during winter so you have to backcountry ski on the fsr"):
  // a paved road or a lot beside one; logging roads and tracks are part of the ski in. A hut's known winter parking
  // (data/huts.json "winter:parking", from the club or a trip report) wins: the way in starts there. And it follows the
  // hut's own winter route (alex 2026-11-06, Keith's Hut: "are you basing ... the route to the cabin on the winter access
  // information?"): the mapped ski routes named in "winter:route" (";" between names), or named after the hut with
  // "winter" in the name ("Keith's Hut Winter Access"), cost half as much as any other trail (fish-route.js WAY_X).
  // A way worked out before 2026-11-11 kept "km under steep slopes" and "terrain traps" in its reasons: not shown any more
  // (alex: "Don't show the terrain traps and what is above you because the data is not accurate enough").
  const whyShown = (why) => {
    const w = (why || []).filter((x) => !/under steep slopes|terrain trap/i.test(x)).map((x) => x.replace(" on or above the route", " on the route"));   // wording-ok: a filter that hides those words
    return (w.length ? w : (why || []).length ? ["the shape of the ground around the route on the terrain map"] : []).join("; ");
  };
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  function winterWay(hut) {
    const named = String(hut.tags["winter:route"] || "").split(";").map(norm).filter(Boolean);
    const base = norm(hut.name).replace(/\b(memorial|hut|cabin|lodge|refuge|shelter|the)\b/g, " ").replace(/\s+/g, " ").trim();
    return (name) => { const n = norm(name); return !!n && (named.includes(n) || (base.length > 2 && /\bwinter\b/.test(n) && n.includes(base))); };
  }
  async function findWay(t) {
    const my = ++wayRun.n;
    t.wayWait = "Looking for the easiest way in from a parking lot…"; E.render();
    const say = (s) => { if (cur() === t && wayRun.n === my) { t.wayWait = s; renderWay(); } };
    try {
      await S.loadJs("fish-route");
      const FR = window.tfFishRoute;
      if (!FR || !FR._build) throw new Error("no route finder");
      const routes = await S.near([t.hut.lat, t.hut.lon], 10);
      const isWay = winterWay(t.hut);
      const lines = routes.flatMap((r) => r.lines.map((pts) => ({ pts, name: r.name || "", way: isWay(r.name) })));
      const wayNames = [...new Set(lines.filter((l) => l.way).map((l) => l.name))];
      const wp = String(t.hut.tags["winter:parking"] || "").split(",").map(Number), known = wp.length === 2 && wp.every(isFinite) ? wp : null;
      const out = await FR._build([t.hut.lat, t.hut.lon], known ? { you: known, lines } : { lines, radii: [2000, 5000, 9000], winter: true },
        (s) => say(s === "terrain" ? "Reading the terrain, trails and roads around the cabin…" : "Working out the easiest way in…"));
      if (wayRun.n !== my) return;
      if (out.fail) { t.wayFail = out.fail === "water" ? "water" : "noroad"; t.wayWait = ""; E.putTrip(t); if (cur() === t) { E.render(); E.drawMap(); } return; }
      const d = FR._describe(out.g, out.res);
      const line = [];
      for (const r of d.runs) for (const p of r.pts) { const q = [+p[0].toFixed(5), +p[1].toFixed(5)], l = line[line.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) line.push(q); }
      const from = known ? `Park at ${t.hut.tags["winter:parking:name"] || "the winter parking"}` : out.park ? (out.parkName ? `Park at ${/parking|trailhead|lot\b|stationnement/i.test(out.parkName) ? "" : "the parking for "}${out.parkName}` : `Park at the parking lot${out.roadName ? ` by ${out.roadName}` : ""}`)
        : `Park beside ${out.roadName || "the paved road"}`;
      await setWay(t, line, { src: "auto", v: WAY_V, from, known: !!known, unplowed: Math.round(out.unplowed || 0), winter: wayNames.filter((n) => d.runs.reduce((m, r) => m + (r.name === n ? r.m : 0), 0) >= 200), offM: Math.round(d.offM), names: [...new Set(d.runs.filter((r) => r.name && r.m >= 300).map((r) => r.name))].slice(0, 4) });
    } catch (e) {
      if (wayRun.n !== my) return;
      t.wayFail = "net"; t.wayWait = "";
      if (cur() === t) E.render();
    }
  }
  // Heights, slopes and times of a way in (line from the start to the cabin).
  async function setWay(t, line, o) {
    t.wayWait = "Working out the heights and slopes…"; if (cur() === t) renderWay();
    const info = await S.info([line]);
    const pts = info.pts, flip = map.distance([pts[0].lat, pts[0].lon], line[0]) > map.distance([pts.at(-1).lat, pts.at(-1).lon], line[0]);
    const seq2 = flip ? pts.slice().reverse() : pts;   // from the start to the cabin
    const munter = (ps) => { let h = 0; for (let i = 1; i < ps.length; i++) { const dk = Math.abs(ps[i].d - ps[i - 1].d) / 1000, dz = ps[i].e - ps[i - 1].e; h += dz >= 0 ? (dk + dz / 100) / 4 : (dk - dz / 100) / 10; } return h; };
    const cls = T.terrainClass(info);
    t.way = { ...o, line, km: +(info.total / 1000).toFixed(2), up: Math.round(info.up), down: Math.round(info.down), min: Math.round(info.min), max: Math.round(info.max),
      hut: Math.round(seq2.at(-1).e), park: Math.round(seq2[0].e), hIn: +munter(seq2).toFixed(2), hOut: +munter(seq2.slice().reverse()).toFixed(2),
      steep: Math.round(info.maxSlope), km30: +info.km30.toFixed(2), above: info.above == null ? null : +info.above.toFixed(2), cls: cls.c, why: cls.why };
    infos.set(t.id, info);
    t.wayFail = ""; t.wayWait = "";
    E.putTrip(t);
    if (cur() === t) { E.render(); E.drawMap(); E.loadDays(t); }
  }
  // The way in on the map: the line and its P at the start.
  function drawExtra(t, layer) {
    if (!(t.way && t.way.line.length > 1)) return;
    L.polyline(t.way.line, { pane: "ski", color: "#fff", weight: 8, opacity: 0.9, interactive: false }).addTo(layer);
    L.polyline(t.way.line, { pane: "ski", color: COL, weight: 4.5, opacity: 1, interactive: false }).addTo(layer);
    L.marker(t.way.line[0], { pane: "ski", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<span class="sk-pin park" style="background:#1f5fe0">P</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(layer);
  }
  // Your own way in, drawn with Plan a tour: points from where you park to the cabin.
  let drawing = null;
  window.addEventListener("tf:ski-plan", (e) => {
    if (e.detail.on || !drawing) return;
    const t = drawing; drawing = null;
    let pts = S.planPts();
    if (pts.length < 2 || cur() !== t) return;
    if (map.distance(pts[0], [t.hut.lat, t.hut.lon]) < map.distance(pts.at(-1), [t.hut.lat, t.hut.lon])) pts = pts.reverse();   // drawn from the cabin out
    setWay(t, pts.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]), { src: "own", from: "Your own way in", offM: 0, names: [] }).catch(() => {});
    E.scrollTo();
  });

  // ---------- the days ----------
  // The weather at the cabin's height for each day, and the avalanche danger on the way in (its lowest to highest point;
  // the cabin's height ± 300 m before there is one). Kept with the trip (t.snap) for when there's no signal.
  async function snapOf(t) {
    const ele = t.way ? t.way.hut : parseFloat(t.hut.tags.ele) || null;
    let w = null, err = "";
    try { w = await S.weather(t.hut.lat, t.hut.lon, ele); } catch (e) { err = e.message || "no signal"; }
    await S.avy().catch(() => {});
    if (!w) return { err: err || "no signal" };
    const dd = w.daily, lo = t.way ? t.way.min : (ele || 1500) - 300, hi = t.way ? t.way.max : (ele || 1500) + 300;
    const cls = t.way ? t.way.cls : 0;
    const rows = E.tripDates(t).map((date, j) => {
      const i = dd.time.indexOf(date), last = j === t.nights;
      const row = { date, tag: j === 0 ? "in" : last ? "out" : "" };
      if (i >= 0) Object.assign(row, { code: dd.weather_code[i], hi: dd.temperature_2m_max[i], lo: dd.temperature_2m_min[i], snow: dd.snowfall_sum[i] || 0,
        rain: Math.max(0, (dd.precipitation_sum[i] || 0) - (dd.snowfall_sum[i] || 0) / 0.7), wind: dd.wind_speed_10m_max[i], gust: dd.wind_gusts_10m_max[i], dir: dd.wind_direction_10m_dominant[i] });
      const dg = S.dangerOn(t.hut.lat, t.hut.lon, lo, hi, date);
      if (dg && dg.r) { row.r = dg.r; row.band = dg.band; if (cls) row.l = T.light(dg.r, cls); }
      else row.avNone = dg ? dg.none || "no rating" : "no forecast here today";
      return row;
    });
    // The 3 days before you go in: snow and the strongest wind (what loads the slopes you'll cross).
    const bi = [-3, -2, -1].map((k) => dd.time.indexOf(addDays(t.date, k))).filter((i) => i >= 0);
    const before = bi.length ? { snow: bi.reduce((s, i) => s + (dd.snowfall_sum[i] || 0), 0), wind: Math.max(...bi.map((i) => dd.wind_speed_10m_max[i] || 0)), n: bi.length } : null;
    const end = dd.time.at(-1);
    return { snap: { at: Date.now(), rows, before, end, ele: Math.round(ele || w.elevation || 0), example: S.example() } };
  }
  function daysHtml(t, v) {
    const today = localDate(new Date());
    const rows = v.rows.map((r) => {
      const DG = r.r ? S.DANGER[r.r] : null, L1 = r.l != null ? T.LIGHTS[r.l] : null;
      const band = r.band ? (S.BANDS.find((b) => b[0] === r.band) || ["", ""])[1].toLowerCase() : "";
      const av = DG ? `<span><b style="color:${DG.color === "#fff300" ? "#b08800" : DG.color}">⚠ ${esc(DG.label.replace(/^\d /, ""))}</b> ${band ? `in the ${band}` : ""}${L1 ? ` · <span class="sk-rc-word" style="--c:${L1.color}">● ${esc(L1.label)}</span>` : ""}</span>`
        : `<span class="sk-note">Avalanche: ${r.date < today ? "past" : r.avNone === "not forecast yet" ? "not forecast yet (about 3 days ahead)" : esc(r.avNone)}</span>`;
      const wx = r.code != null ? `<span class="tp-wx"><big>${S.WICON[r.code] || ""} ${deg(r.hi)}</big><br>low ${deg(r.lo)}</span>` : `<span class="tp-wx sk-note">${r.date > v.end ? "Too far<br>ahead" : "–"}</span>`;
      const bits = r.code != null ? [r.snow >= 0.5 ? `❄ ${Math.round(r.snow)} cm` : r.rain >= 1 ? `🌧 ${Math.round(r.rain)} mm rain` : "Little or no rain or snow",
        `💨 ${Math.round(r.wind || 0)} km/h ${S.COMPASS[Math.round((r.dir || 0) / 45) % 8]}${r.gust >= 50 ? `, gusts ${Math.round(r.gust)}` : ""}`] : [];
      return `<li style="--c:${DG ? DG.color : "var(--line)"}"><b>${esc(dayWord(r.date))}${r.tag ? ` · ${r.tag === "in" ? "ski in" : "ski out"}` : ""}</b>${wx}${av}${bits.length ? `<small>${bits.join(" · ")}</small>` : ""}</li>`;
    }).join("");
    const b = v.before;
    const far = v.rows.some((r) => r.code == null && r.date > v.end);
    return `${b ? `<p class="sk-note">Before you go in (${b.n} days): ${b.snow >= 0.5 ? `<b>${Math.round(b.snow)} cm of new snow</b>` : "no new snow"}, wind up to ${Math.round(b.wind)} km/h.</p>` : ""}
      <ul class="tp-days">${rows}</ul>
      <p class="sk-note">${v.old ? `<b>Saved forecast from ${esc(when(v.at))}</b> (no signal now). ` : v.at ? `Checked ${esc(when(v.at))}${t.autoAt && Math.abs(t.autoAt - v.at) < 60000 ? " (updated by itself)" : ""}`.replace(/\.$/, "") + ". " : ""}Weather forecast at the cabin (${fmtM(v.ele)}), Open-Meteo${far ? `, about a week ahead: come back from ${esc(dayWord(addDays(t.date, -7)))} for the first day` : ""}. Avalanche danger on the way in, from Avalanche Canada${v.example ? " (example forecast)" : ""}${t.way ? ", with the Avaluator light for its terrain" : ""}. Check avalanche.ca the morning you go.</p>`;
  }

  // ---------- day tours from the cabin ----------
  // The mapped tours and snowshoe routes that pass within 1.5 km of the cabin, for the full days you're there. A ★ puts
  // one in the trip's lines. Kept with the trip (t.tours) so the list shows with no signal.
  async function loadTours(t) {
    if (!t.hut || !window.tfSki || !window.tfSki.near) return;
    try {
      const r = await window.tfSki.near([t.hut.lat, t.hut.lon], 3, ["tour", "snowshoe", "other"]);
      const wayR = new Set(((t.way && t.way.winter) || []).map((n) => n.toLowerCase()));   // the way in is already in the lines
      t.tours = r.routes.filter((x) => x.d <= 1500 && !wayR.has((x.name || "").toLowerCase())).slice(0, 8).map((x) => ({ id: x.id, name: x.name, label: x.label, km: +x.km.toFixed(1), d: Math.round(x.d), pill: x.pill, c: x.c }));
      E.putTrip(t, true);   // a fresh list isn't an edit
    } catch { if (!t.tours) t.tours = []; }
    if (cur() === t) renderTours();
  }
  function toursHtml(t) {
    const full = t.nights - 1, l = t.tours;
    const lead = `<p class="sk-note">${full > 0 ? `<b>${full} full day${full > 1 ? "s" : ""}</b> at the cabin, plus the afternoon you get in.` : "One night: the afternoon you get in and the morning before you ski out."}</p>`;
    if (!l) return `${lead}<p class="tp-wait">Looking for tours near the cabin…</p>`;
    if (!l.length) return `${lead}<p class="sk-note">No mapped tours start near the cabin. Tap the slopes around it on the map for their angle and avalanche terrain, or draw one with Plan a tour.</p>`;
    const pick = E.linesOf(t).map((x) => x.rid);
    return `${lead}<ul class="tp-list tp-tours">${l.map((x) => `<li><button type="button" data-tour="${esc(x.id)}"><span>${esc(x.name)} <small>${esc(x.label)} · ${x.km.toFixed(1)} km${x.d >= 150 ? ` · starts ${(x.d / 1000).toFixed(1)} km away` : " · from the door"}</small>${x.pill ? `<br>${x.pill}` : ""}</span></button><button type="button" class="tp-star" data-star="${esc(x.id)}" aria-pressed="${pick.includes(x.id)}" aria-label="Plan to do ${esc(x.name)}">${pick.includes(x.id) ? "★" : "☆"}</button></li>`).join("")}</ul>
      <p class="sk-note">Tap one for its slopes and today's avalanche check. ★ the ones you plan to do: they go in your lines for this trip and in your trip plan.</p>`;
  }
  // A mapped tour near the cabin, all its same-name pieces (the way the tours list shows it).
  async function routeLines(t, id) {
    try {
      const rs = await S.near([t.hut.lat, t.hut.lon], 3), r = rs.find((x) => x.id === id);
      if (!r) return null;
      const nm = (r.name || "").toLowerCase();
      return (nm ? rs.filter((x) => x.type === r.type && (x.name || "").toLowerCase() === nm) : [r]).flatMap((x) => x.lines);
    } catch { return null; }
  }
  // Trips from before the folder: their ★ tours (t.pick) become lines. Ones that can't load yet stay for next time.
  async function movePicks(t) {
    if (!t.pick || !t.pick.length) return;
    const left = [];
    for (const id of t.pick) {
      const x = (t.tours || []).find((y) => y.id === id);
      if (!x || E.linesOf(t).some((y) => y.rid === id)) continue;
      const ls = await routeLines(t, id);
      if (ls) E.addLine(t, { rid: id, name: x.name, label: x.label, ls, c: x.c }); else left.push(id);
    }
    if (left.length) t.pick = left; else delete t.pick;
    E.putTrip(t, true);
  }
  E.card.addEventListener("click", (e) => {
    const a = e.target.closest("[data-tour], [data-star]");
    if (!a || !cur()) return;
    const t = cur(), id = a.dataset.tour || a.dataset.star, x = (t.tours || []).find((y) => y.id === id);
    if (a.dataset.star) {
      if (E.linesOf(t).some((y) => y.rid === id)) { E.dropLine(t, id); return; }
      if (!x) return;
      routeLines(t, id).then((ls) => { if (ls) E.addLine(t, { rid: id, name: x.name, label: x.label, ls, c: x.c }); else toast("Couldn't load that tour's line. Try again with signal."); });
      return;
    }
    if (x && window.tfSki.show) window.tfSki.show(x.id, x.c).then(() => setTimeout(() => window.tfPanelScrollTo && $("skDetail") && window.tfPanelScrollTo($("skDetail")), 80));
  });

  // ---------- your lines: from the ski map ----------
  // A saved planned tour as a line (winter.js planLine: the less exposed way when it's on, its saved name and id).
  const planItem = () => { const p = S.planLine && S.planLine(); return p && p.line.length > 1 ? { tour: p.tour, name: p.name, ls: [p.line] } : null; };
  // A ski line's card: the line with its same-name pieces close by (the way its card counts them).
  function routeItem(r) {
    const all = (window.tfSki.routes && window.tfSki.routes()) || [], nm = (r.name || "").toLowerCase(), near = r.bounds && r.bounds.pad ? r.bounds.pad(3) : null;
    const g = nm && near ? all.filter((x) => x.type === r.type && (x.name || "").toLowerCase() === nm && x.bounds && near.intersects(x.bounds)) : [];
    if (!g.includes(r)) g.push(r);
    const h = document.querySelector("#skDetail h3");
    return { rid: r.id, name: (h && h.textContent.trim()) || r.name || "Ski line", ls: g.flatMap((x) => x.lines), c: r.lines[0][0] };
  }
  window.addEventListener("tf:ski-select", (e) => {
    const r = e.detail && e.detail.item, d = $("skDetail");
    if (!r || !d || r.lat != null || r.area || r.src === "trip" || !r.lines || !r.lines.length) return;
    let item = null;
    E.offerAdd(d.querySelector(".sk-rc-btns"), () => (r.src === "plan" ? planItem() : item || (item = routeItem(r))));
  });
  // A tour drawn from the cabin with Plan a tour (Draw a tour from the cabin) goes in the trip once it's ✓ Done.
  // While drawing, the trip card steps aside so the tour card (its points: move up, down, delete) is right there at the
  // top (alex 2026-11-11 scrolled down past the trip looking for them); it comes back on ✓ Done with the line in it.
  let drawingLine = null;
  const tuckCard = () => { E.card.hidden = true; setTimeout(() => { const p = $("skPlan"); if (p && window.tfPanelScrollTo) window.tfPanelScrollTo(p); }, 120); };
  window.addEventListener("tf:ski-plan", (e) => {
    if (e.detail.on || !drawingLine) return;
    const t = drawingLine; drawingLine = null;
    setTimeout(() => {
      const x = planItem();
      if (x) { E.addLine(t, x); toast(`Added to your trip to ${hutName(t)}.`); window.tfHappy && window.tfHappy("cabin trip"); }
      const c = cur();
      if (c && c.id === t.id) { E.card.hidden = false; E.render(); E.drawMap(); }
      const p = $("skPlan"); if (p && !p.hidden && window.tfPanelScrollTo) setTimeout(() => window.tfPanelScrollTo(p), 120);
    }, 80);
  });
  function editLine(t, id) {   // your own tour: back on the map with its points, then ✓ Done puts the new shape in the trip
    if (!(S.editTour && S.editTour(id))) { toast("That tour isn't in your saved tours any more. Draw it again with Draw a tour."); return; }
    drawingLine = t; tuckCard();
  }
  const toCard = () => setTimeout(() => window.tfPanelScrollTo && $("skDetail") && window.tfPanelScrollTo($("skDetail")), 80);
  function openWay(t) { if (t.way) { S.select(S.route(t.way.line, `Way in to ${hutName(t)}`, infos.get(t.id) || null)); toCard(); } }
  function openLine(t, x) {
    if (x.rid && window.tfSki.show) { window.tfSki.show(x.rid, x.c).then(toCard); return; }
    S.select({ id: "trip", src: "trip", type: "tour", name: x.name, tags: {}, g: x.ls.map((l) => l.flat()), lines: x.ls, bounds: L.latLngBounds(x.ls.flat()) });
    toCard();
  }

  // ---------- packing list ----------
  // Built from the trip: how many nights and people, what the cabin has (heat, water, outhouse, booking, fee), the way
  // in's slopes and the coldest night in the forecast.
  function packItems(t, view) {
    const g = (t.hut && t.hut.tags) || {}, w = t.way, n = t.nights, p = t.people;
    const rows = view && view.rows ? view.rows.filter((r) => r.code != null) : [];
    const cold = rows.length ? Math.min(...rows.map((r) => r.lo)) : null;
    const noWater = g.drinking_water !== "yes", noHeat = !g.heating || g.heating === "none";
    const fuel = Math.ceil((p * n * (noWater ? 0.2 : 0.1) + 0.1) * 10) / 10;   // litres of white gas: about 200 ml a person a day melting snow
    const bag = cold == null ? "Sleeping bag" : `Sleeping bag rated to ${Math.min(-5, Math.round(cold) - 5)}°C${noHeat ? " (no heat: inside gets near the outside cold)" : ""}`;
    return [
      ["Avalanche and safety", [
        ["beacon", `Avalanche beacon each, fresh batteries${p > 1 ? ` (${p})` : ""}`], ["shovel", "Shovel and probe each"],
        ["sat", "Satellite messenger or PLB (inReach, Zoleo): most cabins have no cell signal"], ["aid", "First aid kit"],
        ["repair", "Repair kit: skin glue/straps, binding parts, pole splint, tape"], ["bivy", "Emergency bivy or tarp"],
        ["lamp", "Headlamp and spare batteries"], ["power", "Phone charged + power bank (cold drains it)"]]],
      ["Skiing", [
        ["skis", "Skis or splitboard, skins, poles"],
        ...(w && (w.steep >= 25 || w.km30 > 0) ? [["crampons", `Ski crampons: the way in gets to ${w.steep}°`]] : []),
        ...(rows.some((r) => r.snow >= 10 || r.gust >= 50) ? [["goggles", "Goggles: snow or strong wind in the forecast"]] : [["goggles", "Goggles and sunglasses"]]),
        ["wax", "Skin wax"]]],
      ["Sleeping", [
        ["bag", bag], ["pad", "Sleeping pad (check if the cabin has mattresses)"], ["booties", "Hut booties or down slippers"], ["plugs", "Earplugs"]]],
      ["Cooking and water", [
        ["stove", `Stove and about ${fuel.toFixed(1)} L of fuel${noWater ? (g.drinking_water === "no" ? ": no water, you melt snow" : ": plan to melt snow") : ""}`],
        ["pot", "Pot, lighter × 2, mug, spoon"], ["bottle", "Water bottles + a thermos"],
        ...(/wood|stove/i.test(g.heating || "") ? [["fire", "Fire starter (check if wood is supplied)"]] : [])]],
      ["Food", [
        ["meals", `${n} breakfast${n > 1 ? "s" : ""}, ${n + 1} lunches and ${n} dinner${n > 1 ? "s" : ""}${p > 1 ? ` for ${p}` : ""}`],
        ["snacks", `Snacks for ${n + 1} days`], ["spare", "One spare day of food, in case you're stuck in by weather"]]],
      ["Clothes", [
        ["layers", "Base layers, puffy jacket, shell jacket and pants"], ["hands", "Spare gloves, warm mitts, toque, buff"], ["socks", `Dry socks for ${n} night${n > 1 ? "s" : ""}`]]],
      ["Cabin", [
        ...(/^(required|only|yes)$/.test(g.reservation || "") ? [["booking", "Booking confirmation"]] : []),
        ...(g.charge || g.fee === "yes" ? [["fee", `Cabin fee${g.charge ? `: ${g.charge}` : ""}`]] : []),
        ...(g.toilets === "no" ? [["wag", "Wag bags: there's no outhouse, pack it out"]] : [["tp", "Toilet paper"]]),
        ["trash", "Garbage bag: pack everything out"]]],
      ["Before you go", [["offline", "Trip saved offline (button below)"], ["plan", "Trip plan left with a friend (below)"]]],
    ];
  }

  // ---------- the plan you leave with someone ----------
  function planText(t, pl) {
    const w = t.way, ll = (a, b) => `${a.toFixed(5)}, ${b.toFixed(5)}`;
    const tours = E.linesOf(t).map((x) => x.name);
    const hasSat = (t.packed || {}).sat;
    return [`TRIP PLAN: ${hutName(t)} (backcountry ski trip)`,
      `Who: ${pl.who || "me"}${t.people > 1 ? ` (${t.people} people)` : ""}`,
      ...(t.hut ? [`Cabin: ${t.hut.name || hutName(t)}, ${ll(t.hut.lat, t.hut.lon)} https://www.google.com/maps?q=${t.hut.lat.toFixed(5)},${t.hut.lon.toFixed(5)}`] : []),
      `Going in: ${dayWord(t.date)}${w ? `, ${w.from.replace(/^Park /, "parking ")} (${ll(w.line[0][0], w.line[0][1])}), ${w.km.toFixed(1)} km and ${fmtM(w.up)} up, about ${fmtH(w.hIn)}` : ""}`,
      ...(w && w.names && w.names.length ? [`Way in: via ${w.names.join(", ")}`] : []),
      `Nights: ${t.nights}. Back at the car by ${when(pl.out)}`,
      ...(tours.length ? [`Lines we may ski: ${tours.join(", ")}`] : []),
      ...(pl.car ? [`Car: ${pl.car}${w ? " at the parking above" : ""}`] : []),
      `Gear: avalanche beacons, shovels, probes, first aid${hasSat ? ", satellite messenger" : ""}, ${t.nights + 1} days of food + a spare day`,
      ``, `If you haven't heard from us by ${when(pl.help)}: call 911 (or the RCMP) and say we're overdue on a backcountry ski trip. They call Search and Rescue. Read them this plan.`,
      ...(t.hut && t.hut.tags.operator ? [`The cabin is run by ${t.hut.tags.operator}${t.hut.tags.website ? ` (${t.hut.tags.website})` : ""}.`] : []),
    ].join("\n");
  }

  // ---------- the cabin and the way in on the card ----------
  function factsHtml(t) {
    const g = t.hut.tags || {}, out = [];
    const beds = parseInt(g.capacity, 10);
    if (beds) out.push(`<span class="${t.people > beds ? "warn" : ""}">🛏 Sleeps ${beds}${t.people > beds ? `: you're ${t.people}` : ""}</span>`);
    if (g.charge) out.push(`<span>💲 ${esc(g.charge)}</span>`); else if (g.fee === "yes") out.push(`<span>💲 Fee</span>`); else if (g.fee === "no") out.push(`<span>Free</span>`);
    if (/^(required|only)$/.test(g.reservation)) out.push(`<span class="warn">📅 Booking needed</span>`);
    else if (g.reservation === "yes" || g.reservation === "recommended") out.push(`<span>📅 Booking possible</span>`);
    else if (g.reservation === "no") out.push(`<span>First come, first served</span>`);
    const book = g["reservation:website"] || g["reservation:url"];
    if (book) out.push(`<a href="${esc(book)}" target="_blank" rel="noopener">📅 Book it</a>`);
    if (g.website && g.website !== book) out.push(`<a href="${esc(g.website)}" target="_blank" rel="noopener">ℹ Hut page</a>`);
    if (g.heating) out.push(`<span>🔥 ${esc(g.heating === "none" ? "No heat" : g.heating)}</span>`);
    if (g.drinking_water) out.push(`<span>💧 ${g.drinking_water === "no" ? "No water: melt snow" : esc(g.drinking_water === "yes" ? "Water" : g.drinking_water)}</span>`);
    if (g.toilets) out.push(`<span>${g.toilets === "no" ? "No outhouse" : "🚻 Outhouse"}</span>`);
    return `${out.length ? `<div class="tp-facts">${out.join("")}</div>` : ""}
      ${g.operator ? `<p class="sk-note">Run by ${esc(g.operator)}${book || /^(required|only|yes)$/.test(g.reservation || "") ? "" : ". Check with them before you go: some cabins need booking or a permit."}</p>` : !out.length ? `<p class="sk-note">${esc(S.HUT_ABOUT[t.hut.kind] || S.HUT_ABOUT.basic_hut)} Check who runs it and if it needs booking before you go.</p>` : ""}
      ${g.description ? `<p class="sk-note">${esc(g.description)}</p>` : ""}`;
  }
  // The hut's closure notice (data/huts.json "winter:closure", with "winter:closure:website" for the notices) at the
  // top of the way in, and its winter access (how the club and guides say to get in) under it.
  function closedHtml(t) {
    const g = t.hut.tags || {}, c = g["winter:closure"], u = g["winter:closure:website"];
    return c ? `<p class="tp-closed">⚠️ <b>Closures:</b> ${esc(c)}${u ? ` <a href="${esc(u)}" target="_blank" rel="noopener">Check the notices</a>` : ""}</p>` : "";
  }
  function winterHtml(t) {
    const a = t.hut.tags["winter:access"];
    return a ? `<p class="tp-winter"><b>Winter access</b>${esc(a.replace(/^Winter: /, ""))}</p>` : "";
  }
  function wayHtml(t) {
    return closedHtml(t) + wayBody(t);
  }
  function wayBody(t) {
    const w = t.way;
    if (t.wayWait) return `<p class="tp-wait">${esc(t.wayWait)}</p>${winterHtml(t)}`;
    if (!w) {
      const msg = { noroad: "No parking lot or road within 9 km that the map knows of: the way in must start further away (by snowmobile, lift or a long ski).", water: "The cabin sits on the water on the map.", net: "Couldn't get the map data for the way in. Check your connection and try again." }[t.wayFail] || "";
      return `<p class="sk-note">${esc(msg)}</p>${winterHtml(t)}<div class="tp-btns"><button type="button" data-tp="draw">✎ Draw the way in</button>${t.wayFail === "net" ? `<button type="button" data-tp="again">↻ Try again</button>` : ""}</div>`;
    }
    const C = T.CLASSES[w.cls], a = w.line[0];
    const ios = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
    const drive = ios ? `https://maps.apple.com/?daddr=${a[0]},${a[1]}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${a[0]},${a[1]}&travelmode=driving`;
    return `<p><b>${esc(w.from)}</b>${w.names && w.names.length ? ` <span class="sk-note">· via ${esc(w.names.join(", "))}</span>` : ""}</p>
      <div class="tp-stats"><span><b>${w.km.toFixed(1)}</b> km</span><span>↗ ${fmtM(w.up)}</span><span>↘ ${fmtM(w.down)}</span><span title="Munter estimate: 4 km or 400 m of climb an hour up, 10 km or 1000 m an hour down">⏱ ${fmtH(w.hIn)} in · ${fmtH(w.hOut)} out</span></div>
      <div class="tp-stats"><span>${fmtM(w.park)} at the car → ${fmtM(w.hut)} at the cabin</span><span>steepest ${w.steep}°</span></div>
      <p><span class="sk-ates" style="--c:${C.color}">${C.label}</span> <span class="sk-note">avalanche terrain, estimated: ${esc(whyShown(w.why))}</span></p>
      ${w.offM >= 50 ? `<p class="sk-note">${fmtM(w.offM)} of it isn't on a mapped trail or road: it follows the terrain.</p>` : ""}
      ${w.unplowed >= 200 ? `<p class="sk-note"><b>${(w.unplowed / 1000).toFixed(1)} km of it is on gravel or logging roads</b>: usually not plowed in winter, so you likely ski it (counted in the km, climb and time).</p>` : ""}
      ${w.winter && w.winter.length ? `<p class="sk-note">✓ Starts at the winter parking and follows the mapped winter route (${esc(w.winter.join(", "))}).</p>`
        : w.known ? `<p class="sk-note">✓ Starts at the winter parking from the winter access below.</p>` : ""}
      ${winterHtml(t)}
      ${w.src === "auto" && !w.known ? `<p class="sk-note">Starts at the closest paved road (usually plowed): the map can't tell if it's plowed today or if parking there is allowed.</p>` : ""}
      <div class="tp-btns"><button type="button" class="go" data-tp="show">Show the way in + conditions</button><a href="${drive}" target="_blank" rel="noopener">🚗 Drive</a><button type="button" data-tp="draw">✎ Draw my own</button></div>`;
  }
  const renderWay = () => { const el = E.part("tpWay"); if (el) el.innerHTML = `<h4>The way in</h4>${wayHtml(cur())}`; E.renderLines(); };
  const renderTours = () => { const el = E.part("tpTours"); if (el) el.innerHTML = `<h4>Day tours from the cabin</h4>${toursHtml(cur())}`; };

  // ---------- Skiing's own buttons on the card ----------
  function onTp(k, t) {
    if (k === "again") { t.wayFail = ""; findWay(t); }
    else if (k === "drawline") {
      if (S.planPts().length > 1 && !confirm("Start a new tour from the cabin? The tour on the map now stays in Saved tours.")) return;
      drawingLine = t;
      S.plan(t.hut ? [[t.hut.lat, t.hut.lon]] : []);
      tuckCard();
      toast(t.hut ? "Tap the map along your tour from the cabin, then ✓ Done. It goes in this trip." : "Tap the map along your tour, then ✓ Done. It goes in this trip.");
    } else if (k === "show" && t.way) {
      const r = S.route(t.way.line, `Way in to ${hutName(t)}`, infos.get(t.id) || null);
      S.select(r);
      setTimeout(() => { if (window.tfPanelScrollTo && $("skDetail")) window.tfPanelScrollTo($("skDetail")); }, 80);
    } else if (k === "draw") {
      const had = S.planPts();
      if (had.length > 2 && !confirm("Replace your planned tour with the way in to this cabin?")) return;
      drawing = t;
      S.plan(t.way ? [t.way.line[0]] : []);
      toast("Tap from where you park up to the cabin, then ✓ Done.");
    } else if (k === "hut") {
      S.loadSki().then((ski) => { const h = (ski?.huts || []).find((x) => x.id === t.hut.id) || t.hut; S.selectHut(h); setTimeout(() => window.tfPanelScrollTo && window.tfPanelScrollTo($("skDetail")), 80); });
    }
  }

  // ---------- cabins near the middle of the map (the trips list, and a trip with no cabin yet) ----------
  async function nearCabins() {
    const c = map.getCenter(), ski = await S.loadSki();
    const near = (ski?.huts || []).filter((h) => h.kind !== "shelter" && h.name).map((h) => ({ h, d: map.distance(c, [h.lat, h.lon]) })).sort((a, b) => a.d - b.d).slice(0, 6);
    const el = E.part("tpNear");
    if (!el) return;
    el.innerHTML = near.length ? near.map(({ h, d }) => `<li><button type="button" data-hut="${esc(h.id)}"><span>${esc(h.name)}</span><small>${d < 9500 ? (d / 1000).toFixed(1) : Math.round(d / 1000)} km</small></button></li>`).join("")
      : `<li class="sk-note">No cabins on the map near here.</li>`;
  }
  E.card.addEventListener("click", (e) => {
    const a = e.target.closest("[data-hut]");
    if (!a) return;
    S.loadSki().then((ski) => { const h = (ski?.huts || []).find((x) => x.id === a.dataset.hut); if (h) open(h); });
  });

  // "Plan a cabin trip here" on a cabin's details (not shelters you can't sleep in, parking or route starts).
  window.addEventListener("tf:ski-select", (e) => {
    const h = e.detail && e.detail.item, d = $("skDetail");
    if (!h || !d || h.lat == null || h.src === "c2c" || /^(parking|trailhead|shelter)$/.test(h.kind || "")) return;
    const row = document.createElement("button");
    const c = cur(), pick = c && !c.hut && !E.card.hidden;   // a trip with no cabin yet is open: this cabin goes in it
    row.type = "button"; row.className = "sk-tripgo"; row.textContent = pick ? `🏕 Use this cabin for ${hutName(c)}` : "🏕 Plan a cabin trip here";
    row.addEventListener("click", () => { const c2 = cur(); if (pick && c2 && !c2.hut) setHut(c2, h); else open(h); });
    const head = d.firstElementChild;
    if (head) head.after(row); else d.prepend(row);
  });
  window.tfCabinTrip = { open, list: api.list, close: api.close, count: api.count, join: api.join, addPlan: (el) => E.offerAdd(el, planItem) };
})();
