// Safest way (Skiing): plan a tour the way Fishing's Route finds a walk to a spot off trail (fish-route.js), but
// weighing avalanche danger (alex 2026-11-04: "plan a tour in skiing using the same thinking. base it on the
// avalanche risk, the slope angle, the exposure"). Same grid of ~10 m cells (OpenFreeMap ground cover, AWS terrain
// heights, the ski routes as trails), same search, with a ski cost on each step:
//  - Time: about 4 km/h on the flat, 430 m an hour up (a skin track's switchbacks), quick down. Forest and brush
//    slower than open snow, open water and cliffs can't be crossed.
//  - Slope angle (ATES-style): nothing under 20°, a little at 25°, a lot from 30° to 45° (where most slab avalanches
//    start), more again above.
//  - Today's avalanche forecast (Avalanche Canada, the area and day picked in Skiing): the band's danger rating
//    (alpine / treeline / below treeline from the cell's height) scales it, and a slope facing one of the aspects of
//    that band's avalanche problems counts 1.6x, one facing away 0.6x. No forecast: planned as Moderate (see LEVEL_K).
//  - Exposure: where a slide that starts on 30°+ ground above could run (followed down the fall line until the
//    line back up to its top is under 24°, the alpha angle used for runout), and twice that in a gully or creek bed
//    under it (a terrain trap).
// Every step's cost is its time x (1 + the risk there), so the route goes round avalanche terrain when there's a way
// round, and when there isn't it crosses at the least bad place. The pieces of the route keep why they're there
// (gentle, steep, under steep slopes, terrain trap) for the card and the colours on the map.
(() => {
  "use strict";
  if (!window.tfLeaflet) return;
  const RAD = Math.PI / 180;
  const ASP = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  const ASP_NAME = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  const BAND = ["alp", "tln", "btl"], BAND_NAME = ["alpine", "treeline", "below treeline"];
  // Weight of a danger rating (1 Low ... 5 Extreme); 0 = no rating, planned as Moderate.
  const WD = [1.2, 0.6, 1.2, 2.5, 5, 10];
  // How strict the whole route is, from the worst rating on the forecast (alex 2026-11-04: "you can take a bit steeper
  // route. if the avalanche forecast is red dont take that route, find the safest route"): Low or Moderate (or no rating
  // yet) a direct line that takes slopes up to ~35° rather than a long way round; Considerable the balance in between;
  // High or Extreme (red) the safest way however long. K scales the risk part of every step.
  const LEVEL_K = { direct: 0.3, balanced: 1, strict: 4 };
  const levelOf = (av) => { const r = Math.max(av.r.alp || 0, av.r.tln || 0, av.r.btl || 0); return r >= 4 ? "strict" : r === 3 ? "balanced" : "direct"; };
  const slopeTerm = (s) => (s < 20 ? 0 : s < 25 ? 0.2 : s < 30 ? 1 : s < 35 ? 4 : s < 40 ? 7 : s < 45 ? 10 : 14);
  const ALPHA = Math.tan(24 * RAD);   // a slide runs out until the line back up to where it started is under 24°
  const RUN_M = 1500;                 // and never further than this
  const MAX_LEG_M = 12000;            // a leg longer than this isn't one ski tour (and the grid gets too coarse to see slopes)
  const MIN_DROP = 25;                // m: a slope only a few metres high above you isn't counted (a sluff, not a slide that buries)
  // Ground on skis (fish-route.js G order: unknown, forest, grass, brush, wetland, rock, scree, ice, sand, fields, built, water).
  const SKI_G = [1.3, 1.6, 1, 2.5, 1.4, 1.2, 1.4, 1.1, 1, 1, 1.6, Infinity];
  const CLS = {
    ok: { color: "#2f9e44", label: "Gentle ground" },
    mid: { color: "#f2b705", label: "25° to 30°" },
    steep: { color: "#e03131", label: "30°+ slope" },
    under: { color: "#e8590c", label: "Under steep slopes" },
    trap: { color: "#a61e4d", label: "Terrain trap" },
  };

  // Today's weather signs (winter.js avyWeather, Open-Meteo at the alpine height; alex 2026-11-05: "feed recent snowfall,
  // wind and warming into the risk for that day"): what Avalanche Canada lists for extra caution, on top of the forecast,
  // which was written the evening before and can't see a storm that came in overnight.
  //  - New snow: 10 cm+ in a day or 20 cm+ in 3 days 1.25x on every slope, 25 cm+ / 40 cm+ (a storm slab) 1.6x.
  //  - Wind loading (25 km/h+ with snow to move): the slopes facing away from the wind (lee, wx.lee) 1.5x in the alpine
  //    and at treeline, where wind moves snow.
  //  - Rain on snow: 1.5x below the freezing level (wet slides).
  //  - Warming to 3°C+ at the alpine height: sunny slopes (southeast to southwest) 1.4x, east and west 1.2x.
  // At most 3x in all. wx: { snowF, lee: [aspect index...], rainTo (m), warm (°C) } or none.
  const SUNNY = [1, 1, 1.2, 1.4, 1.4, 1.4, 1.2, 1];
  const wxF = (wx, a, b, e) => {
    if (!wx) return 1;
    let f = wx.snowF || 1;
    if (wx.lee && b < 2 && wx.lee.includes(a)) f *= 1.5;
    if (wx.rainTo && e < wx.rainTo) f *= 1.5;
    if (wx.warm >= 3) f *= SUNNY[a];
    return Math.min(3, f);
  };
  // The ground on each cell in avalanche terms. av: { r: { alp, tln, btl }, mask: { alp, tln, btl }, bands: { lo, hi } }.
  const breathe = () => new Promise((r) => setTimeout(r, 0));
  async function prep(g, av) {
    let t0 = performance.now();
    const rest = async () => { if (performance.now() - t0 > 12) { await breathe(); t0 = performance.now(); } };   // let the map move between rows
    const { W, H } = g, N = W * H, cm = g.cellM, h = g.h;
    const deg = new Float32Array(N), asp = new Uint8Array(N), band = new Uint8Array(N), risk = new Float32Array(N), start = new Float32Array(N);
    const expo = new Float32Array(N), src = new Int32Array(N).fill(-1), trap = new Uint8Array(N), down = new Int32Array(N).fill(-1);
    g.sk = { deg, asp, band, risk, expo, src, trap };
    if (!g.hasH) return;
    const at = (r, c) => { const v = h[Math.min(H - 1, Math.max(0, r)) * W + Math.min(W - 1, Math.max(0, c))]; return v === v ? v : 0; };
    const lo = av.bands.lo, hi = av.bands.hi;
    for (let r = 0; r < H; r++) { if (!(r & 15)) await rest(); for (let c = 0; c < W; c++) {
      const i = r * W + c, dx = (at(r, c + 1) - at(r, c - 1)) / (2 * cm), dyS = (at(r + 1, c) - at(r - 1, c)) / (2 * cm);
      const s = Math.atan(Math.hypot(dx, dyS)) / RAD;
      deg[i] = s;
      asp[i] = Math.round(((Math.atan2(-dx, dyS) / RAD + 360) % 360) / 45) % 8;   // the way the slope faces (downhill)
      const e = at(r, c), b = e >= hi ? 0 : e >= lo ? 1 : 2;
      band[i] = b;
      const rt = av.r[BAND[b]] || 0, m = av.mask[BAND[b]] || 0, A = m ? (m & (1 << asp[i]) ? 1.6 : 0.6) : 1, w = WD[rt] * A * wxF(av.wx, asp[i], b, e);
      risk[i] = w * slopeTerm(s);
      if (s >= 30 && s <= 60) start[i] = w;
    } }
    // The fall line from each cell: its lowest neighbour.
    const dirs = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]];
    for (let r = 0; r < H; r++) { if (!(r & 15)) await rest(); for (let c = 0; c < W; c++) {
      const i = r * W + c; let best = -1, bd = 0;
      for (const [dr, dc, k] of dirs) {
        const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
        const j = rr * W + cc, drop = (h[i] - h[j]) / k;
        if (drop > bd) { bd = drop; best = j; }
      }
      down[i] = best;
    } }
    // Avalanche paths: down the fall line from each start cell while the alpha angle holds.
    const maxSteps = Math.ceil(RUN_M / cm);
    for (let i = 0; i < N; i++) {
      if (!(i & 16383)) await rest();
      const w = start[i]; if (!w) continue;
      const h0 = h[i]; let cur = i, D = 0;
      for (let k = 0; k < maxSteps; k++) {
        const n = down[cur]; if (n < 0) break;
        D += (Math.abs((n % W) - (cur % W)) + Math.abs(Math.floor(n / W) - Math.floor(cur / W)) > 1 ? Math.SQRT2 : 1) * cm;
        if ((h0 - h[n]) / D < ALPHA) break;
        cur = n;
        if (!start[n] && w > expo[n] && h0 - h[n] >= MIN_DROP) { expo[n] = w; src[n] = i; }
      }
    }
    // Terrain traps under a path: a gully (4 m+ below the ground 30 m to each side) or a creek.
    const k = Math.max(1, Math.round(30 / cm)), creek = g.flag;
    for (let r = 0; r < H; r++) { if (!(r & 15)) await rest(); for (let c = 0; c < W; c++) {
      const i = r * W + c; if (!expo[i]) continue;
      const e = h[i], m1 = (at(r - k, c) + at(r + k, c)) / 2 - e, m2 = (at(r, c - k) + at(r, c + k)) / 2 - e;
      if (Math.max(m1, m2) >= 4 || (creek[i] & 3)) trap[i] = 1;
      risk[i] += expo[i] * 1.5 * (trap[i] ? 2 : 1);
    } }
    // The way up is always the safest (alex 2026-11-04: "you can take steeper route when skiing down but take the safest
    // way on the way up"): uphill steps weigh the risk at the strict level, the rest at today's level (costFn).
    g.sk.kDown = LEVEL_K[levelOf(av)]; g.sk.kUp = LEVEL_K.strict;
  }

  // Seconds (x the risk) to go from cell a to the next cell b, d metres away.
  // Exposure time is what the risk multiplies (Avalanche Canada: "minimize exposure time on or under large, complex, steep
  // terrain"): a minute spent on or under a slope that could slide costs many minutes of travel on safe ground, so a way
  // that drops to flat ground, crosses and climbs back wins over a long sidehill whenever it's less time exposed
  // (alex 2026-11-05: "sometime it safer to go down traverse on flat and go up again instead to stay expose on a slope").
  //  - On skins (any step that isn't clearly downhill, so a traverse as well as a climb) the risk weighs at the strict
  //    level: you move at 2 to 4 km/h, can't get out of the way, and a skin track is where groups get caught together.
  //  - A traverse across a 30°+ slope (moving along it, not up or down it) counts 1.5x: the track cuts across the slab in
  //    its start zone, the classic skier trigger, and it keeps you in the start zone the whole way across.
  // These weights (SIDEHILL, kUp, the slope and danger terms) are judgment, set from the AST/ATES rules of thumb and the
  // Munter reduction method's doubling per danger level, not measured odds.
  const SIDEHILL = 1.5, SIDE_GRADE = Math.tan(15 * RAD), SKIN_DOWN = -0.1;
  const mult = (sk, risk, skin, side) => 1 + risk * (skin ? sk.kUp : sk.kDown) * (side ? SIDEHILL : 1);
  function costFn(FR) {
    const { blocked, F_PAVED, L_MOTOR, L_PATH } = FR._grid;
    return (g, a, b, d) => {
      if (blocked(g, a) || blocked(g, b)) return Infinity;
      const sk = g.sk, ln = g.line[b];
      // Plowed (paved) roads and highways aren't skied: crossing one is fine, following it for km is a drive, not a tour.
      // A mapped skin track or trail (the ski routes are drawn in as paths) is taken over open snow beside it when it's no riskier.
      const x = !ln ? SKI_G[g.ground[b]] : ln === L_MOTOR ? 25 : g.flag[b] & F_PAVED ? 4 : ln === L_PATH ? 0.7 : 1;
      if (x === Infinity) return Infinity;
      let dh = g.hasH ? g.h[b] - g.h[a] : 0;
      if (!(dh === dh)) dh = 0;
      if ((!g.line[a] || !g.line[b]) && Math.abs(dh) / d > 1) return Infinity;   // over 45° straight up or down
      let t = (d * x) / 1.1 + Math.max(0, dh) / 0.12 + Math.max(0, -dh) * 0.4;
      if (!sk.deg.length) return t;
      const dg = Math.max(sk.deg[a], sk.deg[b]);
      if (dg > 35) t *= 1 + (dg - 35) / 6;   // hard to skin up or ski down, avalanche or not
      const skin = dh > SKIN_DOWN * d, side = skin && dg >= 30 && Math.abs(dh) < SIDE_GRADE * d;
      return t * mult(sk, (sk.risk[a] + sk.risk[b]) / 2, skin, side);
    };
  }

  // About how long a stretch takes, for the exposure times on the card: skinning 4 km/h on the flat and 430 m an hour up
  // (the cost's pace), skiing down about 11 km/h with stops.
  const travelSec = (d, dh) => (dh < SKIN_DOWN * d ? d / 3 : d / 1.1 + Math.max(0, dh) / 0.12);
  // Is cell c a place to regroup, and what kind: "ridge" (a crest, higher than the ground 30 m to each side, so nothing
  // above it), "trees" (mapped forest: the map can't tell dense trees from open glades) or "flat" (open, gentle, not under
  // anything), or "" (not one). The terrain model is 10 to 30 m: a small slope or a cornice beside it isn't seen.
  function safeKind(g, c) {
    const sk = g.sk;
    if (!sk.deg.length || sk.deg[c] >= 20 || sk.expo[c] > 0 || sk.trap[c]) return "";
    const W = g.W, H = g.H, r = Math.floor(c / W), col = c % W, k = Math.max(1, Math.round(30 / g.cellM)), h = g.h;
    const at = (rr, cc) => { const v = h[Math.min(H - 1, Math.max(0, rr)) * W + Math.min(W - 1, Math.max(0, cc))]; return v === v ? v : h[c]; };
    // Steep ground right beside it (within 30 m) counts as under a slope too: the runout model needs a 25 m drop.
    for (let dr = -k; dr <= k; dr += k) for (let dc = -k; dc <= k; dc += k) { const rr = r + dr, cc = col + dc; if (rr >= 0 && cc >= 0 && rr < H && cc < W && sk.deg[rr * W + cc] >= 30 && at(rr, cc) > h[c] + 5) return ""; }
    const e = h[c], ridge = (at(r - k, col) < e - 3 && at(r + k, col) < e - 3) || (at(r, col - k) < e - 3 && at(r, col + k) < e - 3);
    return ridge ? "ridge" : g.ground[c] === 1 ? "trees" : "flat";
  }
  const clsOf = (sk, c) => (sk.expo[c] > 0 ? (sk.trap[c] ? "trap" : "under") : sk.deg[c] >= 30 ? "steep" : sk.deg[c] >= 25 ? "mid" : "ok");
  // Cells to pieces of one kind, with what's around them.
  function pieces(FR, g, cells, av) {
    const { cellLL, simplify, mx, my, unx, uny } = FR._grid, sk = g.sk;
    const kinds = cells.map((c) => clsOf(sk, c));
    // A run of one or two cells between two runs of another kind is the grid's noise.
    for (let i = 1; i < kinds.length - 1; i++) if (kinds[i] !== kinds[i - 1]) { let j = i; while (j < kinds.length && kinds[j] === kinds[i]) j++; if (j < kinds.length && j - i <= 2 && kinds[j] === kinds[i - 1]) for (let m = i; m < j; m++) kinds[m] = kinds[i - 1]; i = j - 1; }
    const runs = [];
    cells.forEach((c, i) => {
      const last = runs[runs.length - 1];
      if (last && last.cls === kinds[i]) last.cells.push(c);
      else { if (last) last.cells.push(c); runs.push({ cls: kinds[i], cells: [c] }); }
    });
    // Heights averaged over ~70 m of the way (cell-to-cell steps along a sidehill aren't climbs), for the time on each run.
    const hs = new Map();
    cells.forEach((c, i) => { let t = 0, n = 0; for (let k = Math.max(0, i - 3); k <= Math.min(cells.length - 1, i + 3); k++) { const v = g.h[cells[k]]; if (v === v) { t += v; n++; } } hs.set(i, n ? t / n : NaN); });
    let ci = 0;
    for (const r of runs) {
      // How long it takes (see travelSec), and the minutes it's on 30°+ ground or under it: the exposure time.
      r.sec = 0; r.safe = [];
      let off = 0, lastSafe = -1e9;
      for (let k = 1; k < r.cells.length; k++) {
        const p = r.cells[k - 1], c = r.cells[k], d = (Math.abs((c % g.W) - (p % g.W)) + Math.abs(Math.floor(c / g.W) - Math.floor(p / g.W)) > 1 ? Math.SQRT2 : 1) * g.cellM;
        const dh = hs.get(ci + k) - hs.get(ci + k - 1);
        r.sec += travelSec(d, dh === dh ? dh : 0);
        off += d;
        // A place to regroup (Avalanche Canada: "away from start zones, tracks and runout zones, such as dense trees or high
        // ground far from steep slopes"): under 20°, nothing above that could slide, no gully; every 25 m along the way.
        if (off - lastSafe >= 25) { const k2 = safeKind(g, c); if (k2) { r.safe.push({ off: Math.round(off), at: cellLL(g, c), kind: k2 }); lastSafe = off; } }
      }
      ci += r.cells.length - 1;
      const pts = r.cells.map((c) => cellLL(g, c));
      r.m = 0; for (let i = 1; i < pts.length; i++) r.m += window.tfLeaflet.distance(pts[i - 1], pts[i]);
      r.pts = simplify(pts.map((p) => [my(p[0]) / g.cs, mx(p[1]) / g.cs]), 0.7).map(([y, x]) => [uny(y * g.cs), unx(x * g.cs)]);
      r.mid = pts[Math.floor(pts.length / 2)];
      let mx2 = 0, hit = 0, bands = new Set(), asps = new Map(), srcC = -1, srcW = 0;
      for (const c of r.cells) {
        if (sk.deg[c] > mx2) mx2 = sk.deg[c];
        bands.add(sk.band[c]);
        if (sk.deg[c] >= 25) { asps.set(sk.asp[c], (asps.get(sk.asp[c]) || 0) + 1); if ((av.mask[BAND[sk.band[c]]] || 0) & (1 << sk.asp[c])) hit++; }
        if (sk.expo[c] > srcW) { srcW = sk.expo[c]; srcC = sk.src[c]; }
      }
      r.maxDeg = Math.round(mx2);
      r.band = Math.min(...bands);
      r.asp = asps.size ? [...asps].sort((a, b) => b[1] - a[1])[0][0] : -1;
      r.hit = hit > 0;
      if (srcC >= 0) {
        const sp = cellLL(g, srcC);
        r.src = { deg: Math.round(sk.deg[srcC]), asp: sk.asp[srcC], up: Math.round(g.h[srcC] - g.h[r.cells[0]]), m: Math.round(window.tfLeaflet.distance(sp, r.mid)), at: sp,
          hit: !!((av.mask[BAND[sk.band[srcC]]] || 0) & (1 << sk.asp[srcC])) };
      }
      delete r.cells;
    }
    return { runs, steps: steps(FR, g, cells) };
  }
  // The way in plain steps: stretches on one named road or trail, or off trail, with their climb and the worst ground on
  // them (for the list Start, Point 1 ... End).
  function steps(FR, g, cells) {
    const { cellLL, L_PATH, L_STEPS } = FR._grid, sk = g.sk, out = [];
    const kindOf = (c) => (!g.line[c] ? "off" : g.line[c] === L_PATH || g.line[c] === L_STEPS ? "trail" : "road");
    const RANK = { ok: 0, mid: 1, under: 2, steep: 3, trap: 4 };
    let cur = null;
    // A new stretch where the road or trail changes, and where the ground turns from safe (under 30°, nothing above) to
    // steep or exposed and back, so each one has one reason.
    const hz = (c) => { const k = clsOf(sk, c); return k === "steep" || k === "under" || k === "trap"; };
    cells.forEach((c, i) => {
      const kind = kindOf(c), name = kind === "off" ? "" : g.names[g.name[c]] || "", h = hz(c);
      if (!cur || cur.kind !== kind || cur.hz !== h || (name && cur.name && name !== cur.name)) {
        if (cur) cur.cells.push(c);
        cur = { kind, name, hz: h, cells: [c] }; out.push(cur);
      } else { cur.cells.push(c); if (name && !cur.name) cur.name = name; }
    });
    // Bits under 120 m fold into the stretch before (the grid stepping on and off a trail), then the same kind joins up.
    for (let i = 1; i < out.length; i++) if (out[i].cells.length * g.cellM < 120) { out[i - 1].cells.push(...out[i].cells.slice(1)); out.splice(i--, 1); }
    if (out.length > 1 && out[0].cells.length * g.cellM < 120) { out[1].cells.unshift(...out[0].cells.slice(0, -1)); out.shift(); }
    const short = (x) => x.cells.length * g.cellM < 300;
    for (let i = 1; i < out.length; i++) if (out[i].kind === out[i - 1].kind && (out[i].hz === out[i - 1].hz || short(out[i]) || short(out[i - 1])) && (out[i].name === out[i - 1].name || !out[i].name)) {
      if (out[i].cells.length > out[i - 1].cells.length) out[i - 1].hz = out[i].hz;
      out[i - 1].cells.push(...out[i].cells.slice(1)); out.splice(i--, 1);
    }
    return out.map((s) => {
      let m = 0, up = 0, down = 0, worst = "ok", maxDeg = 0, hzM = 0, safeWorst = "ok";
      // Climb from the heights averaged over ~70 m of the way: a line drawn along a side-hill or up a gully steps from
      // cell to cell across the slope, and each little up and down added hundreds of metres that aren't there (alex
      // 2026-11-05: the Stairmaster way read 868 m up for about 500).
      const hs = s.cells.map((c, i) => { let t = 0, n = 0; for (let k = Math.max(0, i - 3); k <= Math.min(s.cells.length - 1, i + 3); k++) { const v = g.h[s.cells[k]]; if (v === v) { t += v; n++; } } return n ? t / n : NaN; });
      for (let i = 0; i < s.cells.length; i++) {
        const c = s.cells[i];
        if (i) { const p = s.cells[i - 1], dh = hs[i] - hs[i - 1]; m += (Math.abs((c % g.W) - (p % g.W)) + Math.abs(Math.floor(c / g.W) - Math.floor(p / g.W)) > 1 ? Math.SQRT2 : 1) * g.cellM; if (dh === dh) { if (dh > 0) up += dh; else down -= dh; } }
        const k = clsOf(sk, c); if (RANK[k] > RANK[worst]) worst = k;
        if (RANK[k] >= 2) hzM += g.cellM; else if (RANK[k] > RANK[safeWorst]) safeWorst = k;
        if (sk.deg[c] > maxDeg) maxDeg = sk.deg[c];
      }
      const a = cellLL(g, s.cells[0]), mid = cellLL(g, s.cells[Math.floor(s.cells.length / 2)]);
      return { kind: s.kind, name: s.name, m: Math.round(m), up: Math.round(up), down: Math.round(down), worst, hzM: Math.round(hzM), safeWorst, maxDeg: Math.round(maxDeg), at: [+a[0].toFixed(6), +a[1].toFixed(6)], mid: [+mid[0].toFixed(6), +mid[1].toFixed(6)] };
    });
  }
  // The straight line between the same points, for "Straight across: x m on 30°+ slopes".
  function straight(FR, g, a, b) {
    const { cellAt } = FR._grid, sk = g.sk, L = window.tfLeaflet.distance(a, b), n = Math.max(2, Math.ceil(L / g.cellM));
    const out = { total: L, steep: 0, under: 0 };
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, c = cellAt(g, a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u);
      if (c < 0) continue;
      const k = clsOf(sk, c);
      if (k === "steep") out.steep += L / n; else if (k === "under" || k === "trap") out.under += L / n;
    }
    return out;
  }

  async function finder() {
    const S = window.tfSki && window.tfSki.trip;
    if (!S) throw new Error("Skiing isn't ready");
    await S.loadJs("fish-route");
    const FR = window.tfFishRoute;
    if (!FR || !FR._grid) throw new Error("no route finder");
    return { S, FR };
  }
  async function linesNear(S, c, km) {
    try {
      // Mapped routes (OpenStreetMap and data/ski-hand/) go in as paths: a little quicker than open snow, weighed for avalanche
      // terrain like any other ground (a documented way's bootpack crux is followed as drawn, see wayOf).
      const rs = await S.near(c, km), out = rs.flatMap((r) => r.lines.map((pts) => ({ pts, name: r.name || "" })));
      // Ground the terrain model makes look easy but isn't (data/ski-hand/ "nogo": Phalanx's pinnacled south ridge): never crossed.
      for (const n of (S.nogo && S.nogo(c, km)) || []) out.push({ pts: n.pts, nogo: true });
      return out;
    } catch { return []; }
  }
  function total(legs, av, extra) {
    // Where each run starts and ends along the whole tour (m), and the regroup places on the way (for the map and the card).
    const safe = [];
    { let D = 0; for (const l of legs) for (const r of l.runs) { r.at0 = Math.round(D); for (const q of r.safe || []) safe.push({ d: Math.round(D + q.off), at: [+q.at[0].toFixed(6), +q.at[1].toFixed(6)], kind: q.kind }); D += r.m; r.at1 = Math.round(D); delete r.safe; } }
    const runs = legs.flatMap((l) => l.runs), st = { total: 0, ok: 0, mid: 0, steep: 0, under: 0, trap: 0, hit: 0, maxDeg: 0, sec: 0, steepSec: 0, underSec: 0 };
    for (const r of runs) {
      st.total += r.m; st[r.cls] += r.m; if (r.hit && r.cls === "steep") st.hit += r.m; st.maxDeg = Math.max(st.maxDeg, r.maxDeg);
      st.sec += r.sec || 0; if (r.cls === "steep") st.steepSec += r.sec || 0; else if (r.cls === "under" || r.cls === "trap") st.underSec += r.sec || 0;
    }
    const sl = legs.reduce((s, l) => ({ total: s.total + l.straight.total, steep: s.steep + l.straight.steep, under: s.under + l.straight.under }), { total: 0, steep: 0, under: 0 });
    const line = [];
    for (const r of runs) for (const p of r.pts) { const q = [+p[0].toFixed(6), +p[1].toFixed(6)], l = line[line.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) line.push(q); }
    // Each leg (Point i to Point i+1): its length, climb, the straight line's steep metres, and its steps.
    const legOut = legs.map((l) => ({ m: l.runs.reduce((s, r) => s + r.m, 0), up: l.steps.reduce((s, x) => s + x.up, 0), down: l.steps.reduce((s, x) => s + x.down, 0),
      steep: l.runs.filter((r) => r.cls === "steep").reduce((s, r) => s + r.m, 0), under: l.runs.filter((r) => r.cls === "under" || r.cls === "trap").reduce((s, r) => s + r.m, 0), straight: l.straight, steps: l.steps }));
    // What a minute in each kind of terrain weighs on the way up today, in minutes on gentle ground (the card's "how it
    // weighs it"): the alpine rating, an aspect that isn't named in the problems.
    const sk = { kUp: LEVEL_K.strict, kDown: LEVEL_K[levelOf(av)] }, w = WD[(av.r && (av.r.alp || av.r.tln || av.r.btl)) || 0];
    const weigh = { s30: mult(sk, w * slopeTerm(32), true, false), s35: mult(sk, w * slopeTerm(37), true, false), side35: mult(sk, w * slopeTerm(37), true, true), under: mult(sk, w * 1.5, true, false) };
    // A documented skin track the search left (wayOf): what it would have been, for "why this way".
    const alts = legs.map((l) => l.alt).filter(Boolean);
    return { line, runs, stats: st, straight: sl, av, legs: legOut, level: levelOf(av), weigh, alts, safe, ...extra };
  }

  // The safest way through the points you tapped (pts: [[lat, lon], ...], 2 or more), one leg at a time.
  // av: the forecast (winter.js tfSki.avyFor). onStep(text) while it works.
  async function route(pts, av, onStep) {
    const { S, FR } = await finder();
    const cost = costFn(FR), legs = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (window.tfLeaflet.distance(a, b) > MAX_LEG_M) return { fail: "far", leg: i, km: Math.round(window.tfLeaflet.distance(a, b) / 1000) };
      onStep && onStep(pts.length > 2 ? `Leg ${i} of ${pts.length - 1}: reading the terrain…` : "Reading the terrain, slopes and avalanche paths…");
      // A line put in the tour (a freeride line or a mapped route, alex 2026-11-04: "make it so you can put line in your
      // tour"): this leg follows it as drawn, with its slopes and exposure read the same way.
      const via = viaOf(a, b);
      if (via) { legs.push(await fixedLeg(FR, via, av, onStep)); continue; }
      // A documented way up between the two points (wayOf): the leg follows it as drawn, and the search only finds the
      // way onto it and from its end to the point.
      // Only its crux (the bootpack or steep climb at the top, cruxOf) is followed as drawn. The way to the crux is
      // searched like any other ground, with the documented track as a path: a skin track is often set across slopes for
      // speed in good conditions (the Stairmaster's GPS track sidehills 2 km of 30-40° slopes in April), and dropping to
      // flatter ground and climbing back can be far less time exposed (alex 2026-11-05).
      const way = await wayOf(S, a, b, av);
      const cx = way && (await cruxOf(FR, way, av, onStep));
      const parts = cx ? [[a, cx.crux.pts[0]], cx.crux, [cx.crux.pts[cx.crux.pts.length - 1], b]] : [[a, b]], got = [];
      for (const p of parts) {
        if (p.pts) { got.push(await fixedLeg(FR, p, av, onStep)); continue; }
        if (window.tfLeaflet.distance(p[0], p[1]) < 25) continue;
        const leg = await searchLeg(S, FR, cost, p[0], p[1], av, onStep);
        if (leg.fail) return { fail: leg.fail, leg: i };
        got.push(leg);
      }
      const one = got.length === 1 ? got[0] : { runs: got.flatMap((l) => l.runs), steps: got.flatMap((l) => l.steps),
        straight: got.reduce((s, l) => ({ total: s.total + l.straight.total, steep: s.steep + l.straight.steep, under: s.under + l.straight.under }), { total: 0, steep: 0, under: 0 }) };
      // The documented approach next to the one found: told on the card when the found one is less time exposed.
      if (cx && cx.app && got[0] && !got[0].line) {
        const me = expoOf(got[0].runs), it = cx.app;
        if (it.expo - me.expo >= 120 && it.steep - me.steep >= 150) one.alt = { name: way.name, mine: me, theirs: it };
      }
      legs.push(one);
    }
    // What still doubles back inside a leg (the points you put in are where a tour may turn round) goes to the app's
    // error list, so it's seen and fixed.
    if (window.tfNoBack) legs.forEach((l) => window.tfNoBack.check("Skiing tour", l.runs.flatMap((r) => r.pts)));
    return total(legs, av, { from: "pts" });
  }
  // The search between two points: { runs, steps, straight } or { fail }.
  async function searchLeg(S, FR, cost, a, b, av, onStep) {
    const lines = await linesNear(S, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], Math.max(3, window.tfLeaflet.distance(a, b) / 1000 + 2));
    const out = await FR._build(b, { you: a, lines, cost, prep: (g) => prep(g, av), pads: (d) => [Math.max(600, d * 0.4), Math.max(2000, d)] },
      (s) => onStep && onStep(s === "terrain" ? "Getting the terrain…" : "Finding a less exposed way…"));
    if (out.fail) return { fail: out.fail === "water" ? "water" : "noway" };
    const cells = out.res.cells;   // from a to b
    const pc = pieces(FR, out.g, cells, av);
    // The search stops within a cell or two of a (and starts from open ground near b when b is on a rock face), so
    // the line is joined to the points themselves: each leg starts and ends exactly on its points, with no gap
    // between one leg and the next (alex 2026-11-04 screenshot: the way broke off before points 4 and 5).
    if (pc.runs.length) {
      const D = (p, q) => window.tfLeaflet.distance([p[0], p[1]], [q[0], q[1]]), f = pc.runs[0], l = pc.runs[pc.runs.length - 1];
      const d0 = D(a, f.pts[0]), d1 = D(b, l.pts[l.pts.length - 1]);
      if (d0 > 2) { f.pts.unshift([+a[0].toFixed(6), +a[1].toFixed(6)]); f.m += d0; if (pc.steps[0]) pc.steps[0].m += Math.round(d0); }
      if (d1 > 2) { l.pts.push([+b[0].toFixed(6), +b[1].toFixed(6)]); l.m += d1; if (pc.steps.length) pc.steps[pc.steps.length - 1].m += Math.round(d1); }
    }
    return { ...pc, straight: straight(FR, out.g, a, b) };
  }
  // A documented way up (data/ski-hand/ route with "way": the skin track and bootpack everyone uses, alex 2026-11-05:
  // "a chute that you need to boot pack call stairs master to go at the top of poop chutes"): taken when it starts
  // near a, ends near b and goes the way of the leg. The search alone weighs every 35°+ slope against a long way
  // round the terrain model thinks is easy (Phalanx: a ridge of pinnacles, or the far side of the mountain), so it never
  // picks the bootpack. Not on a red day (High or Extreme): then the search finds the safest way, as for any tour.
  const WAY_FROM_M = 1500, WAY_TO_M = 800;
  async function wayOf(S, a, b, av) {
    if (levelOf(av) === "strict") return null;
    const L = window.tfLeaflet, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    let rs = [];
    try { rs = await S.near(mid, Math.max(3, L.distance(a, b) / 1000 + 2)); } catch { return null; }
    let best = null;
    for (const r of rs) {
      if (!r.way) continue;   // set only by data/ski-hand/ (a route, or a patch on an OpenStreetMap one)
      for (const v of r.lines) {
        let i = 0, j = 0, di = Infinity, dj = Infinity;
        v.forEach((p, k) => { const x = L.distance(a, p), y = L.distance(b, p); if (x < di) { di = x; i = k; } if (y < dj) { dj = y; j = k; } });
        // Its top must be the bit nearest b (the way is the whole climb, not a piece of it), and it must be the way
        // forward: the walk to it and from it shorter than going straight.
        if (L.distance(v[j], v[v.length - 1]) > 300 || i >= j || di > WAY_FROM_M || dj > WAY_TO_M || di + dj > L.distance(a, b)) continue;
        if (!best || di + dj < best.d) best = { pts: v.slice(i, j + 1), name: r.name || "", d: di + dj };
      }
    }
    return best;
  }
  // The point b carries the line it was added with ({ via: [[lat, lon], ...], name }); it's followed when the leg still
  // runs from that line's one end to its other (after the points are moved round it may not), backwards if reversed.
  const NEAR_M = 60;
  function viaOf(a, b) {
    const o = b[2], v = o && o.via;
    if (!v || v.length < 2) return null;
    const d = (p, q) => window.tfLeaflet.distance([p[0], p[1]], [q[0], q[1]]);
    if (d(a, v[0]) < NEAR_M && d(b, v[v.length - 1]) < NEAR_M) return { pts: v, name: o.name || "" };
    if (d(a, v[v.length - 1]) < NEAR_M && d(b, v[0]) < NEAR_M) return { pts: v.slice().reverse(), name: o.name || "" };
    return null;
  }
  // The cells under a drawn line, in order.
  function lineCells(FR, g, v) {
    const L = window.tfLeaflet, { cellAt } = FR._grid, cells = [];
    for (let i = 1; i < v.length; i++) {
      const n = Math.max(1, Math.ceil(L.distance(v[i - 1], v[i]) / (g.cellM / 2)));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const c = cellAt(g, v[i - 1][0] + ((v[i][0] - v[i - 1][0]) * k) / n, v[i - 1][1] + ((v[i][1] - v[i - 1][1]) * k) / n);
        if (c >= 0 && c !== cells[cells.length - 1]) cells.push(c);
      }
    }
    return cells;
  }
  const lineGrid = async (FR, v, av, onStep) => {
    const g = await FR._buildGrid(FR._boxAround(v, 400), (s) => onStep && onStep(s === "terrain" ? "Getting the terrain…" : "Reading the line…"), []);
    await prep(g, av);
    return g;
  };
  // Time, and time exposed (on 30°+ ground or under it), on some runs; m on 30°+ slopes.
  const expoOf = (runs) => runs.reduce((o, r) => { o.sec += r.sec || 0; o.m += r.m; if (r.cls !== "ok" && r.cls !== "mid") o.expo += r.sec || 0; if (r.cls === "steep") o.steep += r.m; return o; }, { sec: 0, expo: 0, steep: 0, m: 0 });
  // A documented way's crux: from the bottom of its last steep climb to its top (the Stairmaster: the ~180 m bootpack up
  // the couloir), where there's no other way up. The steep climb is the last stretch that gains 60 m+ at 24°+ on
  // average (the alpha-angle steepness of real avalanche terrain); none (a long gentle skin track): null, and the whole
  // leg is searched. Also what the way before the crux is (app), for the card.
  const CRUX_GRADE = Math.tan(24 * RAD), CRUX_MIN_UP = 60;
  async function cruxOf(FR, way, av, onStep) {
    const L = window.tfLeaflet;
    let v = way.pts;
    if (v.length < 2) return null;
    const g = await lineGrid(FR, v, av, onStep);
    if (!g.hasH) return null;
    v = noBack(FR, g, v);
    const { cellAt } = FR._grid, H = v.map((p) => { const c = cellAt(g, p[0], p[1]); return c >= 0 ? g.h[c] : NaN; });
    const top = v.length - 1;
    let k = -1, along = 0;
    for (let i = top - 1; i >= 0; i--) {
      along += L.distance(v[i], v[i + 1]);
      const up = H[top] - H[i];
      if (up === up && up >= CRUX_MIN_UP && up / along >= CRUX_GRADE) k = i;
    }
    if (k < 0) return null;
    const crux = { pts: v.slice(k), name: way.name };
    let app = null;
    if (k > 0) app = expoOf(pieces(FR, g, lineCells(FR, g, v.slice(0, k + 1)), av).runs);
    return { crux, app };
  }
  // A drawn line never doubles back (alex 2026-11-05: the Corona Bowl way up climbed to a high spot near the Spearhead and
  // came back down to the skin track, and the tour followed it as drawn): knots, turns back on itself and climbs to a
  // spot just to come back down are cut (noback.js), with the heights from the terrain under it.
  function noBack(FR, g, v) {
    const NB = window.tfNoBack;
    if (!NB) return v;
    const { cellAt } = FR._grid;
    return NB.clean(v, { loops: true, hAt: g.hasH ? (la, lo) => { const c = cellAt(g, la, lo); return c >= 0 ? g.h[c] : null; } : null });
  }
  async function fixedLeg(FR, via, av, onStep) {
    const g = await lineGrid(FR, via.pts, av, onStep), v = noBack(FR, g, via.pts), cells = lineCells(FR, g, v);
    const leg = pieces(FR, g, cells, av), RANK = { ok: 0, mid: 1, under: 2, steep: 3, trap: 4 }, st = leg.steps;
    // One step for the whole line, under its own name.
    const one = { kind: "trail", name: via.name, m: 0, up: 0, down: 0, worst: "ok", hzM: 0, safeWorst: "ok", maxDeg: 0, at: st[0].at, mid: st[Math.floor(st.length / 2)].mid, line: true };
    for (const x of st) { one.m += x.m; one.up += x.up; one.down += x.down; one.hzM += x.hzM; one.maxDeg = Math.max(one.maxDeg, x.maxDeg); if (RANK[x.worst] > RANK[one.worst]) one.worst = x.worst; if (RANK[x.safeWorst] > RANK[one.safeWorst]) one.safeWorst = x.safeWorst; }
    return { runs: leg.runs, steps: [one], straight: straight(FR, g, v[0], v[v.length - 1]), line: via.name || true };
  }
  // From the best plowed parking to a spot (the "This spot" card): the search runs back from the spot to a lot or a
  // paved road (winter: logging roads aren't plowed, they're skied), within 2, 5 or 9 km.
  async function fromRoad(spot, av, onStep) {
    const { S, FR } = await finder();
    onStep && onStep("Looking for a less exposed way in from a plowed road…");
    const lines = await linesNear(S, spot, 9);
    const out = await FR._build(spot, { lines, radii: [2000, 5000, 9000], winter: true, cost: costFn(FR), prep: (g) => prep(g, av) },
      (s) => onStep && onStep(s === "terrain" ? "Getting the terrain…" : "Finding a less exposed way…"));
    if (out.fail) return { fail: out.fail === "water" ? "water" : "noroad" };
    const cells = out.res.cells, start = FR._grid.cellLL(out.g, cells[0]);
    const park = out.park ? (out.parkName ? `Park at ${/parking|trailhead|lot\b|stationnement/i.test(out.parkName) ? "" : "the parking for "}${out.parkName}` : `Park at the parking lot${out.roadName ? ` by ${out.roadName}` : ""}`)
      : `Park beside ${out.roadName || "the plowed road"}`;
    return total([{ ...pieces(FR, out.g, cells, av), straight: straight(FR, out.g, start, spot) }], av, { from: "road", start, park });
  }

  window.tfSkiRoute = { route, fromRoad, CLS, ASP, ASP_NAME, BAND_NAME, _prep: prep, _slopeTerm: slopeTerm };
})();
