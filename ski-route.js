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
//    that band's avalanche problems counts 1.6x, one facing away 0.6x. No forecast: planned as if Considerable.
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
  // Weight of a danger rating (1 Low ... 5 Extreme); 0 = no rating, planned as Considerable.
  const WD = [2.5, 0.6, 1.2, 2.5, 5, 10];
  const slopeTerm = (s) => (s < 20 ? 0 : s < 25 ? 0.2 : s < 30 ? 1 : s < 35 ? 4 : s < 40 ? 7 : s < 45 ? 10 : 14);
  const ALPHA = Math.tan(24 * RAD);   // a slide runs out until the line back up to where it started is under 24°
  const RUN_M = 1500;                 // and never further than this
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

  // The ground on each cell in avalanche terms. av: { r: { alp, tln, btl }, mask: { alp, tln, btl }, bands: { lo, hi } }.
  function prep(g, av) {
    const { W, H } = g, N = W * H, cm = g.cellM, h = g.h;
    const deg = new Float32Array(N), asp = new Uint8Array(N), band = new Uint8Array(N), risk = new Float32Array(N), start = new Float32Array(N);
    const expo = new Float32Array(N), src = new Int32Array(N).fill(-1), trap = new Uint8Array(N), down = new Int32Array(N).fill(-1);
    g.sk = { deg, asp, band, risk, expo, src, trap };
    if (!g.hasH) return;
    const at = (r, c) => { const v = h[Math.min(H - 1, Math.max(0, r)) * W + Math.min(W - 1, Math.max(0, c))]; return v === v ? v : 0; };
    const lo = av.bands.lo, hi = av.bands.hi;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c, dx = (at(r, c + 1) - at(r, c - 1)) / (2 * cm), dyS = (at(r + 1, c) - at(r - 1, c)) / (2 * cm);
      const s = Math.atan(Math.hypot(dx, dyS)) / RAD;
      deg[i] = s;
      asp[i] = Math.round(((Math.atan2(-dx, dyS) / RAD + 360) % 360) / 45) % 8;   // the way the slope faces (downhill)
      const e = at(r, c), b = e >= hi ? 0 : e >= lo ? 1 : 2;
      band[i] = b;
      const rt = av.r[BAND[b]] || 0, m = av.mask[BAND[b]] || 0, A = m ? (m & (1 << asp[i]) ? 1.6 : 0.6) : 1, w = WD[rt] * A;
      risk[i] = w * slopeTerm(s);
      if (s >= 30 && s <= 60) start[i] = w;
    }
    // The fall line from each cell: its lowest neighbour.
    const dirs = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]];
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c; let best = -1, bd = 0;
      for (const [dr, dc, k] of dirs) {
        const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
        const j = rr * W + cc, drop = (h[i] - h[j]) / k;
        if (drop > bd) { bd = drop; best = j; }
      }
      down[i] = best;
    }
    // Avalanche paths: down the fall line from each start cell while the alpha angle holds.
    const maxSteps = Math.ceil(RUN_M / cm);
    for (let i = 0; i < N; i++) {
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
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c; if (!expo[i]) continue;
      const e = h[i], m1 = (at(r - k, c) + at(r + k, c)) / 2 - e, m2 = (at(r, c - k) + at(r, c + k)) / 2 - e;
      if (Math.max(m1, m2) >= 4 || (creek[i] & 3)) trap[i] = 1;
      risk[i] += expo[i] * 1.5 * (trap[i] ? 2 : 1);
    }
  }

  // Seconds (x the risk) to go from cell a to the next cell b, d metres away.
  function costFn(FR) {
    const { blocked } = FR._grid;
    return (g, a, b, d) => {
      if (blocked(g, a) || blocked(g, b)) return Infinity;
      const sk = g.sk, x = g.line[b] ? 1 : SKI_G[g.ground[b]];
      if (x === Infinity) return Infinity;
      let dh = g.hasH ? g.h[b] - g.h[a] : 0;
      if (!(dh === dh)) dh = 0;
      if ((!g.line[a] || !g.line[b]) && Math.abs(dh) / d > 1) return Infinity;   // over 45° straight up or down
      let t = (d * x) / 1.1 + Math.max(0, dh) / 0.12 + Math.max(0, -dh) * 0.4;
      if (!sk.deg.length) return t;
      const dg = Math.max(sk.deg[a], sk.deg[b]);
      if (dg > 35) t *= 1 + (dg - 35) / 6;   // hard to skin up or ski down, avalanche or not
      return t * (1 + (sk.risk[a] + sk.risk[b]) / 2);
    };
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
    for (const r of runs) {
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
    return runs;
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
    try { const rs = await S.near(c, km); return rs.flatMap((r) => r.lines.map((pts) => ({ pts, name: r.name || "" }))); } catch { return []; }
  }
  function total(legs, av, extra) {
    const runs = legs.flatMap((l) => l.runs), st = { total: 0, ok: 0, mid: 0, steep: 0, under: 0, trap: 0, hit: 0, maxDeg: 0 };
    for (const r of runs) { st.total += r.m; st[r.cls] += r.m; if (r.hit && r.cls === "steep") st.hit += r.m; st.maxDeg = Math.max(st.maxDeg, r.maxDeg); }
    const sl = legs.reduce((s, l) => ({ total: s.total + l.straight.total, steep: s.steep + l.straight.steep, under: s.under + l.straight.under }), { total: 0, steep: 0, under: 0 });
    const line = [];
    for (const r of runs) for (const p of r.pts) { const q = [+p[0].toFixed(6), +p[1].toFixed(6)], l = line[line.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) line.push(q); }
    return { line, runs, stats: st, straight: sl, av, ...extra };
  }

  // The safest way through the points you tapped (pts: [[lat, lon], ...], 2 or more), one leg at a time.
  // av: the forecast (winter.js tfSki.avyFor). onStep(text) while it works.
  async function route(pts, av, onStep) {
    const { S, FR } = await finder();
    const cost = costFn(FR), legs = [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      onStep && onStep(pts.length > 2 ? `Leg ${i} of ${pts.length - 1}: reading the terrain…` : "Reading the terrain, slopes and avalanche paths…");
      const lines = await linesNear(S, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], Math.max(3, window.tfLeaflet.distance(a, b) / 1000 + 2));
      const out = await FR._build(b, { you: a, lines, cost, prep: (g) => prep(g, av), pads: (d) => [Math.max(600, d * 0.4), Math.max(2000, d)] },
        (s) => onStep && onStep(s === "terrain" ? "Getting the terrain…" : "Finding the safest way…"));
      if (out.fail) return { fail: out.fail === "water" ? "water" : "noway", leg: i };
      const cells = out.res.cells;   // from a to b
      legs.push({ runs: pieces(FR, out.g, cells, av), straight: straight(FR, out.g, a, b) });
    }
    return total(legs, av, { from: "pts" });
  }
  // From the best plowed parking to a spot (the "This spot" card): the search runs back from the spot to a lot or a
  // paved road (winter: logging roads aren't plowed, they're skied), within 2, 5 or 9 km.
  async function fromRoad(spot, av, onStep) {
    const { S, FR } = await finder();
    onStep && onStep("Looking for the safest way in from a plowed road…");
    const lines = await linesNear(S, spot, 9);
    const out = await FR._build(spot, { lines, radii: [2000, 5000, 9000], winter: true, cost: costFn(FR), prep: (g) => prep(g, av) },
      (s) => onStep && onStep(s === "terrain" ? "Getting the terrain…" : "Finding the safest way…"));
    if (out.fail) return { fail: out.fail === "water" ? "water" : "noroad" };
    const cells = out.res.cells, start = FR._grid.cellLL(out.g, cells[0]);
    const park = out.park ? (out.parkName ? `Park at ${/parking|trailhead|lot\b|stationnement/i.test(out.parkName) ? "" : "the parking for "}${out.parkName}` : `Park at the parking lot${out.roadName ? ` by ${out.roadName}` : ""}`)
      : `Park beside ${out.roadName || "the plowed road"}`;
    return total([{ runs: pieces(FR, out.g, cells, av), straight: straight(FR, out.g, start, spot) }], av, { from: "road", start, park });
  }

  window.tfSkiRoute = { route, fromRoad, CLS, ASP, ASP_NAME, BAND_NAME, _prep: prep, _slopeTerm: slopeTerm };
})();
