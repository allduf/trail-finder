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
      const rt = av.r[BAND[b]] || 0, m = av.mask[BAND[b]] || 0, A = m ? (m & (1 << asp[i]) ? 1.6 : 0.6) : 1, w = WD[rt] * A;
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
      return t * (1 + ((sk.risk[a] + sk.risk[b]) / 2) * (dh > 1 ? sk.kUp : sk.kDown));
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
      for (let i = 0; i < s.cells.length; i++) {
        const c = s.cells[i];
        if (i) { const p = s.cells[i - 1], dh = g.h[c] - g.h[p]; m += (Math.abs((c % g.W) - (p % g.W)) + Math.abs(Math.floor(c / g.W) - Math.floor(p / g.W)) > 1 ? Math.SQRT2 : 1) * g.cellM; if (dh === dh) { if (dh > 0) up += dh; else down -= dh; } }
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
    try { const rs = await S.near(c, km); return rs.flatMap((r) => r.lines.map((pts) => ({ pts, name: r.name || "" }))); } catch { return []; }
  }
  function total(legs, av, extra) {
    const runs = legs.flatMap((l) => l.runs), st = { total: 0, ok: 0, mid: 0, steep: 0, under: 0, trap: 0, hit: 0, maxDeg: 0 };
    for (const r of runs) { st.total += r.m; st[r.cls] += r.m; if (r.hit && r.cls === "steep") st.hit += r.m; st.maxDeg = Math.max(st.maxDeg, r.maxDeg); }
    const sl = legs.reduce((s, l) => ({ total: s.total + l.straight.total, steep: s.steep + l.straight.steep, under: s.under + l.straight.under }), { total: 0, steep: 0, under: 0 });
    const line = [];
    for (const r of runs) for (const p of r.pts) { const q = [+p[0].toFixed(6), +p[1].toFixed(6)], l = line[line.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) line.push(q); }
    // Each leg (Point i to Point i+1): its length, climb, the straight line's steep metres, and its steps.
    const legOut = legs.map((l) => ({ m: l.runs.reduce((s, r) => s + r.m, 0), up: l.steps.reduce((s, x) => s + x.up, 0), down: l.steps.reduce((s, x) => s + x.down, 0),
      steep: l.runs.filter((r) => r.cls === "steep").reduce((s, r) => s + r.m, 0), under: l.runs.filter((r) => r.cls === "under" || r.cls === "trap").reduce((s, r) => s + r.m, 0), straight: l.straight, steps: l.steps }));
    return { line, runs, stats: st, straight: sl, av, legs: legOut, level: levelOf(av), ...extra };
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
      const lines = await linesNear(S, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], Math.max(3, window.tfLeaflet.distance(a, b) / 1000 + 2));
      const out = await FR._build(b, { you: a, lines, cost, prep: (g) => prep(g, av), pads: (d) => [Math.max(600, d * 0.4), Math.max(2000, d)] },
        (s) => onStep && onStep(s === "terrain" ? "Getting the terrain…" : "Finding the safest way…"));
      if (out.fail) return { fail: out.fail === "water" ? "water" : "noway", leg: i };
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
      legs.push({ ...pc, straight: straight(FR, out.g, a, b) });
    }
    return total(legs, av, { from: "pts" });
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
  async function fixedLeg(FR, via, av, onStep) {
    const L = window.tfLeaflet, v = via.pts;
    const g = await FR._buildGrid(FR._boxAround(v, 400), (s) => onStep && onStep(s === "terrain" ? "Getting the terrain…" : "Reading the line…"), []);
    await prep(g, av);
    const { cellAt } = FR._grid, cells = [];
    for (let i = 1; i < v.length; i++) {
      const n = Math.max(1, Math.ceil(L.distance(v[i - 1], v[i]) / (g.cellM / 2)));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) {
        const c = cellAt(g, v[i - 1][0] + ((v[i][0] - v[i - 1][0]) * k) / n, v[i - 1][1] + ((v[i][1] - v[i - 1][1]) * k) / n);
        if (c >= 0 && c !== cells[cells.length - 1]) cells.push(c);
      }
    }
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
    onStep && onStep("Looking for the safest way in from a plowed road…");
    const lines = await linesNear(S, spot, 9);
    const out = await FR._build(spot, { lines, radii: [2000, 5000, 9000], winter: true, cost: costFn(FR), prep: (g) => prep(g, av) },
      (s) => onStep && onStep(s === "terrain" ? "Getting the terrain…" : "Finding the safest way…"));
    if (out.fail) return { fail: out.fail === "water" ? "water" : "noroad" };
    const cells = out.res.cells, start = FR._grid.cellLL(out.g, cells[0]);
    const park = out.park ? (out.parkName ? `Park at ${/parking|trailhead|lot\b|stationnement/i.test(out.parkName) ? "" : "the parking for "}${out.parkName}` : `Park at the parking lot${out.roadName ? ` by ${out.roadName}` : ""}`)
      : `Park beside ${out.roadName || "the plowed road"}`;
    return total([{ ...pieces(FR, out.g, cells, av), straight: straight(FR, out.g, start, spot) }], av, { from: "road", start, park });
  }

  window.tfSkiRoute = { route, fromRoad, CLS, ASP, ASP_NAME, BAND_NAME, _prep: prep, _slopeTerm: slopeTerm };
})();
