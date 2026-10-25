// Avalanche terrain maths for Skiing, shared by the site (winter.js) and the nightly job that rates every ski route
// (scripts/build-ski-terrain.mjs, which loads this same file), so a route's terrain class is worked out the same way
// in both places.
//  - info(lines, dem): heights, slopes and aspects every 25 m along a route, the steep ground above it and the terrain
//    traps on it, from the AWS terrain tiles. dem(z, x, y) gives a tile's heights (Float32Array 256 x 256, .z = the
//    zoom they really come from).
//  - terrainClass(info): an estimate of the route's avalanche terrain class, like ATES (Avalanche Terrain Exposure
//    Scale): 1 Simple, 2 Challenging, 3 Complex. Worked out from the terrain only: forest, cornices, glaciers and
//    small features aren't seen, so it's always shown as an estimate, with the official ATES maps linked.
//  - light(danger, cls): the Avaluator trip planner chart (Avalanche Canada): the day's danger rating with the terrain
//    class gives 0 normal caution (green), 1 extra caution (yellow) or 2 not recommended (red).
(function (root) {
  "use strict";
  const RAD = Math.PI / 180;
  // Metres between two [lat, lon] points (the same formula as Leaflet's map.distance).
  const dist = (a, b) => {
    const s1 = Math.sin(((b[0] - a[0]) * RAD) / 2), s2 = Math.sin(((b[1] - a[1]) * RAD) / 2);
    const h = s1 * s1 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * s2 * s2;
    return 2 * 6371000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };
  const ASPECTS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  const SAMPLE_M = 25;   // a height every 25 m along the route
  // Pixels at low zoom are hundreds of metres wide, which flattens slopes: ask for less steepness there.
  const minSlope = (z) => (z >= 12 ? 25 : z === 11 ? 21 : z === 10 ? 17 : z === 9 ? 13 : 10);

  // The route's pieces as one line, each piece joined to the end of the last at its nearer end.
  function chain(lines) {
    const left = lines.filter((l) => l.length > 1).map((l) => l.slice()), out = [];
    if (!left.length) return out;
    out.push(left.shift());
    while (left.length) {
      const end = out[out.length - 1].at(-1), start = out[0][0];
      let best = 0, bestD = Infinity, how = "";
      left.forEach((l, i) => {
        for (const [h, a, b] of [["ae", end, l[0]], ["be", end, l.at(-1)], ["as", start, l.at(-1)], ["bs", start, l[0]]]) {
          const d = dist(a, b);
          if (d < bestD) { bestD = d; best = i; how = h; }
        }
      });
      const l = left.splice(best, 1)[0];
      if (how === "ae") out.push(l); else if (how === "be") out.push(l.reverse());
      else if (how === "as") out.unshift(l); else out.unshift(l.reverse());
    }
    return out;
  }
  // Points every step metres along the pieces; d = distance along the route (gaps between pieces not counted).
  function sampleLine(pieces, step) {
    const pts = [];
    let d0 = 0;
    pieces.forEach((line, seg) => {
      let next = d0;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i], len = dist(a, b);
        for (; next < d0 + len; next += step) { const f = len ? (next - d0) / len : 0; pts.push({ lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f, d: next, seg }); }
        d0 += len;
      }
      const z = line.at(-1);
      pts.push({ lat: z[0], lon: z[1], d: d0, seg });
    });
    return pts;
  }
  // Height, slope and the way the slope faces at each point.
  async function heights(pts, total, dem) {
    const z = total > 80000 ? 11 : total > 40000 ? 12 : 13, n = 2 ** z;
    pts.forEach((p) => {
      const x = ((p.lon + 180) / 360) * n, s = Math.sin(p.lat * RAD), y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
      p.tx = Math.floor(x); p.ty = Math.floor(y); p.px = (x - p.tx) * 256 - 0.5; p.py = (y - p.ty) * 256 - 0.5;
    });
    const keys = [...new Set(pts.map((p) => p.tx + "/" + p.ty))];
    const tiles = new Map(await Promise.all(keys.map(async (key) => { const [x, y] = key.split("/").map(Number); return [key, await dem(z, x, y)]; })));
    for (const p of pts) {
      const E = tiles.get(p.tx + "/" + p.ty), k = 25 / minSlope(E.z), at = (x, y) => E[Math.min(255, Math.max(0, y)) * 256 + Math.min(255, Math.max(0, x))];
      const x0 = Math.floor(p.px), y0 = Math.floor(p.py), fx = p.px - x0, fy = p.py - y0;
      p.e = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      const xi = Math.round(p.px), yi = Math.round(p.py), m = (40075016.686 * Math.cos(p.lat * RAD)) / (256 * n);
      const dzdx = (at(xi + 1, yi) - at(xi - 1, yi)) / (2 * m), dzdy = (at(xi, yi + 1) - at(xi, yi - 1)) / (2 * m);
      p.slope = Math.min(60, (Math.atan(Math.hypot(dzdx, dzdy)) / RAD) * k);
      p.asp = Math.round(((Math.atan2(-dzdx, dzdy) / RAD + 360) % 360) / 45) % 8;
      delete p.tx; delete p.ty; delete p.px; delete p.py;
    }
  }
  // What's above you: stretches of the route under steep ground (30° and more) that could slide down onto it, that
  // is within ABOVE_M, at least 50 m higher (enough slope to bury someone), and seen from the route at least ABOVE_DEG
  // up (a rough "alpha angle": avalanches seldom run out further than a line about 20° down from where they start).
  // And terrain traps: the route in a gully or creek bed (ground higher on most sides within TRAP_M) with steep
  // sides, where even a small slide piles up deep. From the terrain tiles at zoom 13, checking every 4th point (about
  // 100 m apart). Sets p.above and p.trap on the points; returns the km of each.
  const ABOVE_M = 350, ABOVE_DEG = 20, TRAP_M = 60;
  async function overhead(pts, total, dem) {
    if (total > 60000 || !pts.length) return null;
    const z = 13, n = 2 ** z * 256, tanA = Math.tan(ABOVE_DEG * RAD);
    const gxy = (p) => { const s = Math.sin(p.lat * RAD); return [((p.lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; };
    const check = pts.filter((_, i) => i % 4 === 0 || i === pts.length - 1);
    const need = new Set();
    for (const p of check) {
      const [gx, gy] = gxy(p), m = (40075016.686 * Math.cos(p.lat * RAD)) / n, r = Math.ceil(ABOVE_M / m) + 2;
      Object.assign(p, { gx, gy, m, r });
      for (let tx = Math.floor((gx - r) / 256); tx <= Math.floor((gx + r) / 256); tx++) for (let ty = Math.floor((gy - r) / 256); ty <= Math.floor((gy + r) / 256); ty++) need.add(tx + "/" + ty);
    }
    const tiles = new Map(await Promise.all([...need].map(async (key) => { const [x, y] = key.split("/").map(Number); return [key, await dem(z, x, y).catch(() => null)]; })));
    const at = (ix, iy) => { const t = tiles.get((ix >> 8) + "/" + (iy >> 8)); return t ? t[(iy & 255) * 256 + (ix & 255)] : null; };
    const k30 = Math.tan(30 * RAD) / (25 / minSlope(13));
    const steepAt = (ix, iy, m) => {
      const ex = at(ix + 1, iy), wx = at(ix - 1, iy), sy = at(ix, iy + 1), ny = at(ix, iy - 1);
      return ex != null && wx != null && sy != null && ny != null && Math.hypot(ex - wx, sy - ny) / (2 * m) >= k30;
    };
    let km = 0, trapKm = 0;
    check.forEach((p, k) => {
      const cx = Math.round(p.gx), cy = Math.round(p.gy);
      let hit = false;
      for (let dy = -p.r; dy <= p.r && !hit; dy += 2) for (let dx = -p.r; dx <= p.r && !hit; dx += 2) {
        const d = Math.hypot(dx, dy) * p.m;
        if (d < 60 || d > ABOVE_M) continue;
        const e = at(cx + dx, cy + dy);
        if (e == null || e - p.e < 50 || (e - p.e) / d < tanA) continue;
        if (steepAt(cx + dx, cy + dy, p.m)) hit = true;
      }
      // A gully: the ground TRAP_M away is 5 m or more higher in at least 5 of the 8 directions, with a steep side.
      const rr = TRAP_M / p.m;
      let higher = 0, steepSide = false;
      for (let a = 0; a < 8; a++) {
        const ix = Math.round(cx + Math.sin(a * 45 * RAD) * rr), iy = Math.round(cy - Math.cos(a * 45 * RAD) * rr), e = at(ix, iy);
        if (e != null && e - p.e >= 5) { higher++; if (!steepSide && steepAt(ix, iy, p.m)) steepSide = true; }
      }
      p.above = hit;
      p.trap = higher >= 5 && steepSide;
      delete p.gx; delete p.gy; delete p.m; delete p.r;
      if (k) { const seg = (p.d - check[k - 1].d) / 1000; if (hit) km += seg; if (p.trap) trapKm += seg; }
    });
    // The points between the checked ones take the flags of the checked point before them.
    let flag = false, trap = false;
    pts.forEach((p) => { if (p.above != null) { flag = p.above; trap = p.trap; } else { p.above = flag; p.trap = trap; } });
    return { km, trapKm };
  }
  // Everything about the route's shape: heights, climb, slopes, which aspects its steep parts face, what's above it.
  async function info(lines, dem) {
    const pieces = chain(lines);
    let pts = sampleLine(pieces, SAMPLE_M);
    const total = pts.length ? pts.at(-1).d : 0;
    if (pts.length > 1500) { const st = Math.ceil(pts.length / 1500); pts = pts.filter((_, i) => i % st === 0 || i === pts.length - 1); }
    await heights(pts, total, dem);
    // Start from the lower end: a tour climbs from the valley.
    if (pts.at(-1).e < pts[0].e) { pts.reverse(); pts.forEach((p) => { p.d = total - p.d; }); }
    let up = 0, down = 0, ref = pts[0].e;
    for (const p of pts) { if (p.e - ref >= 5) { up += p.e - ref; ref = p.e; } else if (ref - p.e >= 5) { down += ref - p.e; ref = p.e; } }
    const es = pts.map((p) => p.e), top = pts[es.indexOf(Math.max(...es))];
    // Steepness of the ground under the route: the middle of each 3 points, so one odd pixel doesn't count.
    const sl = pts.map((p, i) => [pts[i - 1]?.slope ?? p.slope, p.slope, pts[i + 1]?.slope ?? p.slope].sort((a, b) => a - b)[1]);
    let km30 = 0, km35 = 0, km45 = 0;
    const aspects = new Array(8).fill(0);
    pts.forEach((p, i) => {
      const seg = i ? (p.d - pts[i - 1].d) / 1000 : 0;
      if (sl[i] >= 30) km30 += seg;
      if (sl[i] >= 35) km35 += seg;
      if (sl[i] >= 45) km45 += seg;
      if (sl[i] >= 25) aspects[p.asp] += seg;
    });
    const steepKm = aspects.reduce((s, x) => s + x, 0);
    const faces = steepKm ? ASPECTS.filter((_, i) => aspects[i] >= steepKm * 0.15).sort((a, b) => aspects[ASPECTS.indexOf(b)] - aspects[ASPECTS.indexOf(a)]) : [];
    const oh = await overhead(pts, total, dem).catch(() => null);
    return { pts, sl, total, up, down, top, min: Math.min(...es), max: top.e, maxSlope: Math.max(...sl), km30, km35, km45, faces,
      above: oh ? oh.km : null, traps: oh ? oh.trapKm : null };
  }

  // The terrain class estimate. ATES (Statham and others, v2 2023) rates how much a route is exposed to avalanche
  // terrain: Simple = mostly gentle or forested, little exposure; Challenging = some clear avalanche paths and slopes
  // to manage; Complex = long exposure to steep slopes, overlapping paths, few ways around. Here, from the terrain only:
  //  - Complex: 0.25 km or more on 35°+ ground, or 1 km on 30°+, or 1 km under steep slopes above, or terrain traps
  //    under steep slopes above.
  //  - Challenging: any real stretch (0.1 km) on 30°+, under steep slopes above, or in a terrain trap.
  //  - Simple: none of that.
  const CLASSES = [null,
    { key: "simple", label: "Simple", color: "#2f9e44", what: "Gentle ground or open slopes with little avalanche terrain above or under the route." },
    { key: "challenging", label: "Challenging", color: "#1971c2", what: "Some avalanche paths or steep slopes to cross or pass under: choose the way carefully." },
    { key: "complex", label: "Complex", color: "#1a1a1a", what: "Long stretches on or under steep slopes, with few ways to avoid them." }];
  function terrainClass(i) {
    if (!i) return null;
    const above = i.above || 0, traps = i.traps || 0, why = [];
    if (i.km35 >= 0.05) why.push(`${i.km35.toFixed(1)} km on slopes of 35° or more`);
    else if (i.km30 >= 0.05) why.push(`${i.km30.toFixed(1)} km on slopes of 30° or more`);
    if (above >= 0.05) why.push(`${above.toFixed(1)} km under steep slopes`);
    if (traps >= 0.05) why.push(`${traps.toFixed(1)} km in gullies or creek beds (terrain traps)`);
    const c = i.km35 >= 0.25 || i.km30 >= 1 || above >= 1 || (above >= 0.3 && traps >= 0.2) ? 3
      : i.km30 >= 0.1 || above >= 0.1 || traps >= 0.1 ? 2 : 1;
    if (!why.length) why.push("no slopes of 30° or more on or above the route");
    return { c, ...CLASSES[c], why };
  }
  // Avaluator trip planner chart: rows = danger rating 1 Low to 5 Extreme, columns = Simple, Challenging, Complex.
  const CHART = [null, [0, 0, 1], [0, 0, 1], [0, 1, 2], [1, 2, 2], [2, 2, 2]];
  const LIGHTS = [
    { key: "go", label: "Normal caution", color: "#2f9e44", what: "Accidents are rare in this mix of danger and terrain. Still use your training and watch the conditions." },
    { key: "care", label: "Extra caution", color: "#f2b705", what: "Most accidents happen here. Go only with avalanche skills, pick the safest way and be ready to turn back." },
    { key: "no", label: "Not recommended", color: "#e03131", what: "On Avalanche Canada's Avaluator chart, this terrain at this danger rating is not recommended. Pick simpler terrain or another day." }];
  const light = (danger, cls) => (danger >= 1 && danger <= 5 && cls >= 1 && cls <= 3 ? CHART[danger][cls - 1] : -1);

  // ---------- Avalanche Canada's forecast areas (data/avalanche.json) ----------
  // Where treeline sits, roughly (m): wetter coast ranges lower than the drier inland ranges (Duffey, Lillooet), and
  // highest in the Rockies (Kananaskis, Banff); far lower in the east (Chic-Chocs about 1,000 m, Gros Morne about 600 m).
  // lo = treeline starts, hi = alpine starts.
  const bandsFor = (name) => /chic-chocs|gasp/i.test(name || "") ? { lo: 900, hi: 1100 }
    : /gros morne|corner brook|newfoundland|labrador/i.test(name || "") ? { lo: 450, hi: 650 }
    : /rock|kananaskis|klakes|bow valley|highwood|spray|banff|yoho|jasper|waterton|purcell/i.test(name || "") ? { lo: 1900, hi: 2400 }
    : /inland|duffey|lillooet|chilcotin|cariboo|interior|columbia|selkirk|monashee|kootenay|boundary|glacier|lizard|flathead|okanagan|shuswap|thompson/i.test(name || "")
      ? { lo: 1700, hi: 2200 } : { lo: 1500, hi: 1900 };
  const BAND_IDS = ["alp", "tln", "btl"];
  // Inside a ring of [lat, lon, lat, lon, ...].
  function inRing(lat, lon, r) {
    let inside = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ay = r[i], ax = r[i + 1], by = r[j], bx = r[j + 1];
      if ((ay > lat) !== (by > lat) && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  }
  // The forecast area a point is in (null when none), from the file's areas as they are.
  function areaAt(areas, lat, lon) {
    for (const a of areas || []) {
      if (!a.rings || !a.rings.length) continue;
      if (!a._box) { let s = 90, w = 180, n = -90, e = -180; a.rings.forEach((r) => { for (let i = 0; i < r.length; i += 2) { s = Math.min(s, r[i]); n = Math.max(n, r[i]); w = Math.min(w, r[i + 1]); e = Math.max(e, r[i + 1]); } }); a._box = [s, w, n, e]; }
      const b = a._box;
      if (lat < b[0] || lat > b[2] || lon < b[1] || lon > b[3]) continue;
      if (a.rings.some((r) => inRing(lat, lon, r))) return a;
    }
    return null;
  }
  // The highest danger rating of a forecast day in the bands a route from lo to hi m goes through, and that band.
  function dangerIn(day, bands, lo, hi) {
    let r = 0, band = "";
    if (!day) return { r, band };
    for (const b of BAND_IDS) {
      const [bl, bh] = b === "alp" ? [bands.hi, Infinity] : b === "tln" ? [bands.lo, bands.hi] : [-Infinity, bands.lo];
      if (hi >= bl && lo < bh && (day[b] || 0) > r) { r = day[b]; band = b; }
    }
    return { r, band };
  }

  root.tfTerrain = { dist, chain, sampleLine, heights, overhead, info, terrainClass, light, minSlope, CLASSES, LIGHTS, ASPECTS, SAMPLE_M, ABOVE_M, ABOVE_DEG, TRAP_M,
    bandsFor, inRing, areaAt, dangerIn };
})(typeof window !== "undefined" ? window : globalThis);
