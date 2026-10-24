// Ready-made loops for each riding area (alex, 2026-10-24: "ready-made loops for each area, with distance, climb and ride
// time", like Trailforks' ride plans). For a riding area (data/riding-areas.json), up to four loops built from its rated
// trails: an easy one (green and blue), a classic (blue and black, the longest and official trails first), a technical
// one (black and double black) and a big day (five trails). Each is a Pick trails plan (planner.js): opening it builds
// the real ride (the climbs on roads and climbing trails, each trail ridden its way, back to the start) with its exact
// distance, climb, ride time, GPX and Ride it. The list shows an estimate first: each trail's drop from the terrain
// tiles (as the planner reads them), climbed back up at about 7 %, timed like the planner (ride-stats.js).
// Used by Where to ride today (status.js: tfLoops.show(el, area)).
(() => {
  "use strict";
  if (!window.tfZoneTrails || !window.tfPlan) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const kmTo = (a, b) => Math.hypot((a[1] - b[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180), (a[0] - b[0]) * 110.57);
  const lineM = (g) => { let s = 0; for (let i = 1; i < g.length; i++) s += kmTo(g[i - 1], g[i]) * 1000; return s; };
  const LV = { green: ["●", "#2f9e44", "Green"], blue: ["■", "#1c6fe0", "Blue"], black: ["◆", "#1b1b1b", "Black"], dbl: ["◆◆", "#d6202a", "Double black"], pro: ["▲", "#e8590c", "Pro line"] };
  const ROADISH = /\b(road|fsr|rd|highway|hwy|service|pipeline|powerline|power line|connector|access|climb|uphill|valley trail|greenway|rail trail)\b/i;
  const GRADE = 0.07;   // the climbs back up: about 7 % on average (forest roads and climbing trails)

  const css = document.createElement("style");
  css.textContent = `
.lp-list { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.lp-list li button { width: 100%; text-align: left; font: inherit; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.lp-list b { font-size: .95rem; } .lp-list small { color: var(--muted); font-size: .8rem; }
.lp-lv { display: inline-block; font-weight: 800; margin-right: 3px; }
.lp-note { margin: 6px 0 0; color: var(--muted); font-size: .78rem; }`;
  document.head.append(css);

  // The trails a loop can be made of: named, rated (not a pro line), 300 m or more, not a road, connector or climbing
  // trail. A name can have pieces all around the area: the loop takes the ones joined to the longest piece, as a tap on
  // it in Pick trails would (pick, len: their ids and length).
  function candidates(area, trails) {
    const R = (area.r ? area.r / 1000 : 4) + 1;
    return trails.filter((t) => t.c && kmTo(t.c, area.c) <= R && t.lvl && t.lvl !== "pro" && t.m >= 300 && !ROADISH.test(t.name))
      .map((t) => { const g = t.id != null && window.tfPlan.groupOf ? window.tfPlan.groupOf(t.id, t.ids) : null; return { ...t, pick: g ? g.ids : t.ids, len: g ? g.m : lineM(t.geom) }; })
      .filter((t) => t.len >= 300
      && !(window.tfDir && t.tags && (window.tfDir.of(t.tags, t.geom, t.ids[0]) || {}).dir === "climb"))
      // Official and MTB-tagged trails first, then longer ones (riders' classics are usually both).
      .map((t) => ({ ...t, score: (t.off ? 2 : 0) + (t.cat === "mtb" ? 1 : 0) + Math.min(3, t.len / 1000) }))
      .sort((a, b) => b.score - a.score);
  }
  // n trails near the best one (within spread km), each a different name.
  function cluster(pool, n, spread) {
    if (!pool.length) return null;
    for (const first of pool.slice(0, 4)) {
      const set = [first];
      for (const t of pool) { if (set.length >= n) break; if (!set.includes(t) && kmTo(t.c, first.c) <= spread) set.push(t); }
      if (set.length >= Math.min(2, n)) return set;
    }
    return null;
  }
  const KINDS = [
    { k: "easy", name: "Easy loop", keep: (t) => t.lvl === "green" || t.lvl === "blue", n: 2, spread: 2 },
    { k: "classic", name: "Classic loop", keep: (t) => t.lvl === "blue" || t.lvl === "black", n: 3, spread: 2.5 },
    { k: "tech", name: "Technical loop", keep: (t) => t.lvl === "black" || t.lvl === "dbl", n: 3, spread: 2.5 },
    { k: "big", name: "Big day", keep: (t) => t.lvl !== "dbl", n: 5, spread: 4 },
  ];
  async function build(area) {
    const trails = await window.tfZoneTrails(area.zone).catch(() => []);
    const cand = candidates(area, trails), seen = new Set(), out = [];
    for (const K of KINDS) {
      const set = cluster(cand.filter(K.keep), K.n, K.spread);
      if (!set) continue;
      const sig = set.map((t) => t.name).sort().join("|");
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ ...K, trails: set });
    }
    return out;
  }
  // Distance, climb and time, estimated: each trail's drop (terrain heights at its ends), climbed back at GRADE.
  async function estimate(loop) {
    const ends = loop.trails.flatMap((t) => [t.geom[0], t.geom[t.geom.length - 1]]);
    const hs = await window.tfPlan.heights(ends).catch(() => ends.map(() => null));
    let up = 0, known = 0;
    loop.trails.forEach((t, i) => { const a = hs[2 * i], b = hs[2 * i + 1]; if (a != null && b != null) { up += Math.max(20, Math.abs(a - b)); known++; } });
    if (!known) return null;
    up = Math.round((up * loop.trails.length) / known / 10) * 10;
    const m = loop.trails.reduce((s, t) => s + t.len, 0) + up / GRADE;
    const rs = window.tfRideStats, h = rs && rs.timeFor ? rs.timeFor(m, up).h : null;
    return { km: m / 1000, up, time: h != null && rs.fmtHours ? rs.fmtHours(h) : null };
  }
  function entryOf(area, loop) {
    const pts = loop.trails.flatMap((t) => t.geom), lat = pts.map((p) => p[0]), lon = pts.map((p) => p[1]);
    return { name: `${area.name}: ${loop.name}`, mode: "pick", how: "pedal",
      box: [Math.min(...lat), Math.min(...lon), Math.max(...lat), Math.max(...lon)].map((x) => +x.toFixed(5)),
      pick: { picks: loop.trails.map((t) => ({ name: t.name, ids: t.pick, pedal: false })), start: null, back: true, order: "auto", homePedal: false } };
  }
  const lvl = (k) => (LV[k] ? `<span class="lp-lv" style="color:${LV[k][1]}" title="${LV[k][2]}">${LV[k][0]}</span>` : "");

  // Fills el with the area's loops. onOpen runs before the planner opens (status.js closes its dialog).
  async function show(el, area, onOpen) {
    el.innerHTML = `<p class="lp-note">Building loops…</p>`;
    const loops = await build(area);
    if (!loops.length) { el.innerHTML = `<p class="lp-note">Not enough rated trails mapped around ${esc(area.name)} to build a loop.</p>`; return; }
    el.innerHTML = `<ol class="lp-list">${loops.map((l, i) => `<li><button type="button" data-l="${i}"><b>🔁 ${esc(l.name)}</b>
      <small>${l.trails.map((t) => `${lvl(t.lvl)}${esc(t.name)}`).join(" + ")}</small><small class="lp-est" data-e="${i}">Working out distance and climb…</small></button></li>`).join("")}</ol>
      <p class="lp-note">Estimates. Tap a loop for the real ride: the climbs, the order, the exact distance and climb, GPX and ▶ Ride it.</p>`;
    el.querySelectorAll("[data-l]").forEach((b) => b.addEventListener("click", () => {
      if (onOpen) onOpen();
      window.tfPlan.openRoute(entryOf(area, loops[+b.dataset.l]));
    }));
    for (let i = 0; i < loops.length; i++) {
      const e = await estimate(loops[i]), s = el.querySelector(`[data-e="${i}"]`);
      if (!s) return;
      s.textContent = e ? `About ${e.km.toFixed(e.km < 10 ? 1 : 0)} km · ↑ ${e.up} m${e.time ? ` · ⏱ ${e.time}` : ""}` : `${(loops[i].trails.reduce((a, t) => a + t.len, 0) / 1000).toFixed(1)} km of trails, plus the climbs`;
    }
  }
  window.tfLoops = { build, show, estimate, entryOf };
})();
