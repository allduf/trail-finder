// Ready-made loops for each riding area (alex, 2026-10-24: "ready-made loops for each area, with distance, climb and ride
// time", like Trailforks' ride plans). For a riding area (data/riding-areas.json), up to four loops built from its rated
// trails: an easy one (green and blue), a classic (blue and black, the longest and official trails first), a technical
// one (black and double black) and a big day (five trails). Each is a Pick trails plan (planner.js): opening it builds
// the real ride (the climbs on roads and climbing trails, each trail ridden its way, back to the start) with its exact
// distance, climb, ride time, GPX and Ride it. The list shows an estimate first: each trail's drop from the terrain
// tiles (as the planner reads them), climbed back up at about 7 %, timed like the planner (ride-stats.js).
// Distance and Time (alex, 2026-10-25) grow each loop to the length you want, keeping its level; ↻ Different loop
// starts it from another trail, and ✕ on a trail leaves it out of the area's loops (rebuilt around your length).
// alex (2026-10-26): "when proposing a loop. always start from a parking lot close to those trail. and dont include
// bikepark trail in it. bikepark trails are only accessible by the lifts": each loop starts and ends at the parking lot
// nearest its trails (tfParkingFor, index.html), and bike park trails (tfLiftOnly) are never in one.
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
.lp-list li button.lp-open { width: 100%; text-align: left; font: inherit; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.lp-list b { font-size: .95rem; } .lp-list small { color: var(--muted); font-size: .8rem; }
.lp-lv { display: inline-block; font-weight: 800; margin-right: 3px; }
.lp-note { margin: 6px 0 0; color: var(--muted); font-size: .78rem; }
.lp-list li { border: 1px solid var(--line); border-radius: 10px; background: var(--panel); padding: 0 0 8px; }
.lp-list li button.lp-open { border: 0; background: none; padding: 8px 10px 4px; border-radius: 10px 10px 0 0; }
.lp-short { color: #b45309; }
.lp-lot { margin: 0; padding: 0 10px 4px; font-size: .82rem; color: var(--muted); } .lp-lot b { color: var(--fg); font-weight: 600; }
.lp-trails { display: flex; flex-wrap: wrap; gap: 5px; padding: 2px 10px 0; }
.lp-t { display: inline-flex; align-items: center; gap: 2px; font-size: .82rem; padding: 2px 2px 2px 8px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip, #fff); }
.lp-t button { flex: none; width: 30px; font: inherit; border: 0; background: none; color: var(--muted); cursor: pointer; min-width: 30px; min-height: 30px; padding: 0; font-size: .85rem; }
.lp-row { padding: 6px 10px 0; }
.lp-other, .lp-skip button, .lp-want button { font: inherit; font-size: .82rem; font-weight: 600; padding: 5px 10px; min-height: 32px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip, #fff); color: var(--fg); cursor: pointer; }
.lp-other:disabled { opacity: .5; cursor: default; }
.lp-want { margin: 8px 0 0; display: flex; flex-direction: column; gap: 6px; }
.lp-want p { margin: 0; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.lp-want b { font-size: .8rem; min-width: 62px; }
.lp-want button[aria-pressed="true"] { background: var(--accent, #1c6fe0); border-color: var(--accent, #1c6fe0); color: var(--accent-fg, #fff); }
.lp-skip { margin: 8px 0 0; font-size: .8rem; color: var(--muted); display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }`;
  document.head.append(css);

  // The trails a loop can be made of: named, rated (not a pro line), 300 m or more, not a road, connector, climbing
  // trail or bike park trail (lift access only). A name can have pieces all around the area: the loop takes the ones joined to the longest piece, as a tap on
  // it in Pick trails would (pick, len: their ids and length).
  function candidates(area, trails, withLift) {
    const R = (area.r ? area.r / 1000 : 4) + 1;
    return trails.filter((t) => t.c && kmTo(t.c, area.c) <= R && t.lvl && t.lvl !== "pro" && t.m >= 300 && !ROADISH.test(t.name) && (withLift || !t.lift))
      .map((t) => { const g = t.id != null && window.tfPlan.groupOf ? window.tfPlan.groupOf(t.id, t.ids) : null; return { ...t, pick: g ? g.ids : t.ids, len: g ? g.m : lineM(t.geom) }; })
      .filter((t) => t.len >= 300
      && !(window.tfDir && t.tags && (window.tfDir.of(t.tags, t.geom, t.ids[0]) || {}).dir === "climb"))
      // Official and MTB-tagged trails first, then longer ones (riders' classics are usually both).
      .map((t) => ({ ...t, score: (t.off ? 2 : 0) + (t.cat === "mtb" ? 1 : 0) + Math.min(3, t.len / 1000) }))
      .sort((a, b) => b.score - a.score);
  }
  // How long you want to ride (alex, 2026-10-25: "tell how long distance and time you want the ride to be"), kept
  // between visits: km and hours, either or both (null: any). With both, a loop stops growing at the first one reached.
  const WANT_KEY = "tf:loopWant", SKIP_KEY = "tf:loopSkip", MAX_PICKS = 10;
  const KMS = [10, 15, 20, 30, 40, 60], HOURS = [1, 1.5, 2, 3, 4, 5];
  const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch {} return null; };
  const want = Object.assign({ km: null, h: null }, store(WANT_KEY) || {});
  // Trails you don't want in a loop, per area (✕ on a trail): every loop of the area is rebuilt without them.
  const skipAll = store(SKIP_KEY) || {};
  const skipOf = (area) => new Set(skipAll[area.name] || []);
  const setSkip = (area, set) => { if (set.size) skipAll[area.name] = [...set]; else delete skipAll[area.name]; store(SKIP_KEY, skipAll); };

  // Each trail's drop from the terrain tiles, read once per area for the trails a loop can use (null when unknown).
  const dropsOf = new Map();
  async function withDrops(cand) {
    const need = cand.filter((t) => !dropsOf.has(t.ids[0]));
    if (need.length) {
      const ends = need.flatMap((t) => [t.geom[0], t.geom[t.geom.length - 1]]);
      const hs = window.tfPlan.heights ? await window.tfPlan.heights(ends).catch(() => ends.map(() => null)) : ends.map(() => null);
      need.forEach((t, i) => { const a = hs[2 * i], b = hs[2 * i + 1]; dropsOf.set(t.ids[0], a != null && b != null ? Math.abs(a - b) : null); });
    }
    cand.forEach((t) => { t.drop = dropsOf.get(t.ids[0]); });
  }
  // Distance, climb and time, estimated: each trail's drop, climbed back at GRADE (about 8 % of a trail's length when
  // the tiles didn't answer).
  // lot: the parking lot, ridden to the trails and back.
  function estOf(set, lot) {
    const up = Math.round(set.reduce((s, t) => s + Math.max(20, t.drop != null ? t.drop : t.len * 0.08), 0) / 10) * 10;
    const m = set.reduce((s, t) => s + t.len, 0) + up / GRADE + (lot ? 2 * lot.d : 0);
    const rs = window.tfRideStats, h = rs && rs.timeFor ? rs.timeFor(m, up).h : null;
    return { km: m / 1000, up, h, time: h != null && rs.fmtHours ? rs.fmtHours(h) : null, known: set.some((t) => t.drop != null) };
  }
  // How far a loop is from what you asked: 1 = right on, below 1 = short, above = long (the first limit reached).
  const fill = (e) => Math.max(want.km ? e.km / want.km : 0, want.h && e.h != null ? e.h / want.h : 0);
  const hasWant = () => !!(want.km || (want.h && window.tfRideStats));

  // Grows a loop from a first trail: the nearest trail of the level to any already in it (within spread km), until
  // it's as long as you asked, stopping where adding one more would be further off than leaving it out.
  function grow(first, pool, K) {
    const set = [first], names = new Set([first.name]);
    const near = (t) => Math.min(...set.map((s) => kmTo(s.c, t.c)));
    if (!hasWant()) {
      for (const t of pool) { if (set.length >= K.n) break; if (!names.has(t.name) && kmTo(t.c, first.c) <= K.spread) { set.push(t); names.add(t.name); } }
      return set.length >= Math.min(2, K.n) ? set : null;
    }
    while (set.length < MAX_PICKS) {
      const f = fill(estOf(set));
      if (f >= 1) break;
      let best = null, bd = Infinity;
      for (const t of pool) { if (names.has(t.name)) continue; const d = near(t); if (d <= K.spread && d - t.score * 0.15 < bd) { bd = d - t.score * 0.15; best = t; } }
      if (!best) break;
      const f2 = fill(estOf([...set, best]));
      if (f2 - 1 > 1 - f && set.length >= 2) break;
      set.push(best); names.add(best.name);
    }
    return set.length >= 2 ? set : null;
  }
  const sigOf = (set) => set.map((t) => t.name).sort().join("|");
  // The loops at one level, best first; each "Different loop" moves on to the next one (another first trail).
  function options(cand, K) {
    const pool = cand.filter(K.keep), out = [], seen = new Set();
    for (const first of pool.slice(0, 12)) {
      const set = grow(first, pool, K);
      if (!set) continue;
      const sig = sigOf(set);
      if (!seen.has(sig)) { seen.add(sig); out.push(set); }
      if (out.length >= 6) break;
    }
    return out;
  }
  const KINDS = [
    { k: "easy", name: "Easy loop", keep: (t) => t.lvl === "green" || t.lvl === "blue", n: 2, spread: 2 },
    { k: "classic", name: "Classic loop", keep: (t) => t.lvl === "blue" || t.lvl === "black", n: 3, spread: 2.5 },
    { k: "tech", name: "Technical loop", keep: (t) => t.lvl === "black" || t.lvl === "dbl", n: 3, spread: 2.5 },
    { k: "big", name: "Big day", keep: (t) => t.lvl !== "dbl", n: 5, spread: 4 },
  ];
  // Where a loop starts and ends: the parking lot nearest its trails, within 3 km, else 8 km (null: none mapped).
  const lots = new Map();
  function lotFor(set) {
    const k = sigOf(set);
    if (!lots.has(k)) {
      const lines = set.map((t) => t.geom), find = window.tfParkingFor;
      // A lot with no name on the map is named after the loop trail it's at.
      const named = (o) => {
        if (!o || o.name !== "Parking lot") return o;
        const at = set.map((t) => ({ t, d: Math.min(...t.geom.map((q) => kmTo(q, o.ll))) })).sort((a, b) => a.d - b.d)[0];
        return { ...o, name: `Parking lot by ${at.t.name}` };
      };
      lots.set(k, !find ? Promise.resolve(null) : find(lines, 3000).then((o) => o || find(lines, 8000)).then(named).catch(() => null));
    }
    return lots.get(k);
  }
  // The area's loops: one per level (the Big day becomes a Mixed loop once you set a length). shift[k] is how many
  // times you asked for a different one at that level.
  async function build(area, shift = {}) {
    const trails = await window.tfZoneTrails(area.zone).catch(() => []);
    const skip = skipOf(area);
    // A riding area that is mostly a bike park (Whistler Bike Park) gets no loop: its trails are lift access only.
    // (named one, or most rated trails within 2 km of its middle are bike park trails).
    const all = candidates(area, trails, true), core = all.filter((t) => kmTo(t.c, area.c) <= 2);
    const park = /\bbike ?park\b/i.test(area.name) || (core.length > 0 && core.filter((t) => t.lift).length * 2 > core.length);
    const cand = park ? [] : all.filter((t) => !t.lift && !skip.has(t.name)).slice(0, 80);
    await withDrops(cand);
    const seen = new Set(), out = [];
    for (const K of KINDS) {
      const opts = options(cand, K).filter((s) => !seen.has(sigOf(s)));
      if (!opts.length) continue;
      const i = (shift[K.k] || 0) % opts.length, set = opts[i];
      seen.add(sigOf(set));
      out.push({ ...K, name: K.k === "big" && hasWant() ? "Mixed loop" : K.name, trails: set, alt: opts.length, at: i });
    }
    await Promise.all(out.map(async (l) => { l.lot = await lotFor(l.trails); l.est = estOf(l.trails, l.lot); }));
    out.lift = park;
    return out;
  }
  // Kept for other callers: the estimate of a loop built here.
  async function estimate(loop) { await withDrops(loop.trails); const e = estOf(loop.trails, loop.lot); return e.known ? e : null; }
  function entryOf(area, loop) {
    const pts = loop.trails.flatMap((t) => t.geom).concat(loop.lot ? [loop.lot.ll] : []), lat = pts.map((p) => p[0]), lon = pts.map((p) => p[1]);
    return { name: `${area.name}: ${loop.name}`, mode: "pick", how: "pedal",
      box: [Math.min(...lat), Math.min(...lon), Math.max(...lat), Math.max(...lon)].map((x) => +x.toFixed(5)),
      pick: { picks: loop.trails.map((t) => ({ name: t.name, ids: t.pick, pedal: false })), start: loop.lot ? loop.lot.ll : null, startName: loop.lot ? loop.lot.name : null, back: true, order: "auto", homePedal: false } };
  }
  const lvl = (k) => (LV[k] ? `<span class="lp-lv" style="color:${LV[k][1]}" title="${LV[k][2]}">${LV[k][0]}</span>` : "");
  const fmtM = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
  const hrs = (h) => (h % 1 ? `${Math.floor(h)} h 30` : `${h} h`);
  const chips = (kind, vals, cur, fmt) => `<button type="button" data-${kind}="" aria-pressed="${cur == null}">Any</button>` +
    vals.map((v) => `<button type="button" data-${kind}="${v}" aria-pressed="${cur === v}">${fmt(v)}</button>`).join("");

  // "← Loops" on the planner: the dialog the list sits in opens again as it was left (same area, chips and scroll).
  function backTo(b) {
    const dlg = b.closest("dialog");
    if (!dlg) return null;
    const kept = [];
    for (let x = b.parentElement; x; x = x.parentElement) if (x.scrollTop) kept.push([x, x.scrollTop]);
    return () => {
      if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); } }
      kept.forEach(([x, top]) => { x.scrollTop = top; });
    };
  }
  // Fills el with the area's loops. onOpen runs before the planner opens (status.js closes its dialog).
  async function show(el, area, onOpen) {
    const shift = {};
    let gen = 0;
    const draw = async () => {
      const my = ++gen;
      const box = el.querySelector(".lp-loops") || el;
      box.innerHTML = `<p class="lp-note">Building loops…</p>`;
      const loops = await build(area, shift);
      if (my !== gen) return;
      const skip = skipOf(area), wantEl = el.querySelector(".lp-want");
      if (wantEl) wantEl.hidden = !!loops.lift;   // no length to pick in a bike park
      const skipped = skip.size ? `<p class="lp-skip">Left out: ${[...skip].map((n) => `<button type="button" data-back="${esc(n)}" title="Put it back in the loops">${esc(n)} ↺</button>`).join(" ")}</p>` : "";
      if (!loops.length) { box.innerHTML = `<p class="lp-note">${loops.lift ? `${esc(area.name)} is a bike park: its trails are only reached by the lifts, so no pedal loop here.` : `Not enough rated trails mapped around ${esc(area.name)} to build a loop${skip.size ? " without the ones you left out" : ""}.`}</p>${skipped}`; wire(box, loops); return; }
      box.innerHTML = `<ol class="lp-list">${loops.map((l, i) => {
        const e = l.est, short = hasWant() && fill(e) < 0.8;
        return `<li><button type="button" class="lp-open" data-l="${i}"><b>🔁 ${esc(l.name)}</b>
        <small class="lp-est">${e.known ? "About" : "Roughly"} ${e.km.toFixed(e.km < 10 ? 1 : 0)} km · ↑ ${e.up} m${e.time ? ` · ⏱ ${e.time}` : ""}${short ? ` · <span class="lp-short">shorter than you asked: no more trails of this level close by</span>` : ""}</small></button>
        <p class="lp-lot">${l.lot ? `🅿 Start and finish: <b>${esc(l.lot.name)}</b>${l.lot.d > 150 ? ` · ${fmtM(l.lot.d)} from the trails` : ""}` : "🅿 No parking lot mapped near these trails: starts at their lowest end"}</p>
        <div class="lp-trails">${l.trails.map((t) => `<span class="lp-t">${lvl(t.lvl)}${esc(t.name)}<button type="button" data-skip="${esc(t.name)}" aria-label="Leave out ${esc(t.name)}" title="Leave this trail out: the loops are rebuilt without it">✕</button></span>`).join("")}</div>
        <div class="lp-row"><button type="button" class="lp-other" data-other="${l.k}"${l.alt < 2 ? ` disabled title="No other ${esc(l.name.toLowerCase())} here"` : ""}>↻ Different loop${l.alt > 1 ? ` <small>${l.at + 1} of ${l.alt}</small>` : ""}</button></div></li>`;
      }).join("")}</ol>${skipped}
      <p class="lp-note">Estimates. Each loop starts and ends at the parking lot nearest its trails and leaves out bike park trails (lift access only). ✕ leaves a trail out and rebuilds the loop around your length. Tap a loop for the real ride: the climbs, the order, the exact distance and climb, GPX and ▶ Ride it; ← Loops on it brings you back here.</p>`;
      wire(box, loops);
    };
    const wire = (box, loops) => {
      box.querySelectorAll("[data-l]").forEach((b) => b.addEventListener("click", () => {
        const back = backTo(b);
        if (onOpen) onOpen();
        window.tfPlan.openRoute(entryOf(area, loops[+b.dataset.l]), false, back);
      }));
      box.querySelectorAll("[data-other]").forEach((b) => b.addEventListener("click", () => { shift[b.dataset.other] = (shift[b.dataset.other] || 0) + 1; draw(); }));
      box.querySelectorAll("[data-skip]").forEach((b) => b.addEventListener("click", () => { const s = skipOf(area); s.add(b.dataset.skip); setSkip(area, s); draw(); }));
      box.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => { const s = skipOf(area); s.delete(b.dataset.back); setSkip(area, s); draw(); }));
    };
    const head = () => `<div class="lp-want"><p><b>Distance</b>${chips("km", KMS, want.km, (v) => `${v} km`)}</p>
      ${window.tfRideStats ? `<p><b>Time</b>${chips("h", HOURS, want.h, hrs)}</p>` : ""}</div><div class="lp-loops"></div>`;
    el.innerHTML = head();
    el.querySelector(".lp-want").addEventListener("click", (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      const k = "km" in b.dataset ? "km" : "h" in b.dataset ? "h" : null;
      if (!k) return;
      want[k] = b.dataset[k] === "" ? null : +b.dataset[k];
      store(WANT_KEY, want);
      b.parentNode.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      Object.keys(shift).forEach((x) => delete shift[x]);
      draw();
    });
    draw();
  }
  // Ask in plain words (ask.js): "a 2-hour loop" sets the same length as the Distance and Time chips.
  const setWant = (o) => { want.km = o.km || null; want.h = o.h || null; store(WANT_KEY, want); };
  window.tfLoops = { build, show, estimate, entryOf, setWant, want: () => ({ ...want }) };
})();
