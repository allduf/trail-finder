// Difficulty for trails with no MTB rating on OpenStreetMap (built by scripts/build-ratings.mjs, see there for sources):
//   off   official open data that rates bike trails (Sépaq, City of Ottawa, Whistler, Columbia Shuswap, Utah, Pennsylvania state parks), matched by shape
//   same  another piece of the same named trail is rated on OpenStreetMap (data/ratings/osm.json)
//   hand  a rider who knows the trail rated it here (HAND below), for trails with no rating on OpenStreetMap
//   riders  riders' own grades given in the app (grades.js), before same and est
//   est   an estimate from the slope and a few map tags (data/ratings/osm.json for the region's all-trails lists, or
//         worked out here from the AWS terrain tiles when a trail's details open). Never shown as a real rating.
// window.tfRatings = { rate(id, geom, tags) -> { d, src, why } | null (sync, from what's loaded), hand(geom, tags) -> { mtb, off } | null, estimate(id, geom, tags) -> Promise,
//   load(bounds) (official squares in view), onChange(fn) } (fn gets touches(geom, id) when only some trails can change). d: green, blue, black, dbl, pro (pro line: bike park HAND entries only, incl. the Kamloops Bike Ranch).
(function () {
  const DIR = "data/ratings/";
  const LEVEL = { green: "green", blue: "blue", black: "black", dbl: "double black", pro: "pro line" };
  const listeners = [], fire = (touches) => listeners.forEach((fn) => { try { fn(touches); } catch (e) { console.warn(e); } });
  const est = new Map();   // way id -> estimate worked out here

  // ---------- data/ratings/osm.json ----------
  let osm = null;
  const osmReady = fetch(DIR + "osm.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((j) => { if (j && j.v === 1) { osm = j.ways; fire(); } });

  // ---------- official lines (like official.js) ----------
  const CELL = 0.005, NEAR_M = 40, SHARE = 0.6;
  let index = null;
  const squares = new Map();
  const getIndex = () => index || (index = fetch(DIR + "index.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  const sq = (v) => Math.floor(v * 2) / 2;
  function prepare(f) {
    const cells = new Map();
    f.lines.forEach(([d, src, name, note, flat]) => {
      const g = new Array(flat.length);
      for (let k = 0, a = 0, o = 0; k < flat.length; k += 2) { a += flat[k]; o += flat[k + 1]; g[k] = a / 1e5; g[k + 1] = o / 1e5; }
      const l = { d, src, name, note, g };
      for (let k = 0; k + 3 < g.length; k += 2) {
        for (let a = Math.floor((Math.min(g[k], g[k + 2]) - 0.001) / CELL); a <= Math.floor((Math.max(g[k], g[k + 2]) + 0.001) / CELL); a++)
          for (let b = Math.floor((Math.min(g[k + 1], g[k + 3]) - 0.0015) / CELL); b <= Math.floor((Math.max(g[k + 1], g[k + 3]) + 0.0015) / CELL); b++) {
            const c = a + "," + b; if (!cells.has(c)) cells.set(c, []); cells.get(c).push([l, k]);
          }
      }
    });
    return cells;
  }
  function load(bounds) {
    return getIndex().then((ix) => {
      if (!ix || ix.v !== 1 || !bounds) return;
      const s = bounds.getSouth(), n = bounds.getNorth(), w = bounds.getWest(), e = bounds.getEast();
      if ((n - s) * (e - w) > 4) return;
      const want = [];
      for (let la = sq(s); la <= n; la += 0.5) for (let lo = sq(w); lo <= e; lo += 0.5) {
        const k = la + "_" + lo;
        if (!ix.squares[k] || squares.has(k)) continue;
        const p = fetch(DIR + k + ".json").then((r) => (r.ok ? r.json() : null)).catch(() => null)
          .then((f) => squares.set(k, f && f.v === 1 ? prepare(f) : new Map()));
        p.key = k; squares.set(k, null); want.push(p);
      }
      if (!want.length) return;
      // Only trails whose box overlaps a new square can change: rating every loaded trail again froze the map for a
      // moment on each pan into a new square (alex, 2026-10-23).
      const fresh = want.map((p) => p.key.split("_").map(Number));
      const touches = (geom) => {
        let s = 90, n = -90, w = 180, e = -180;
        for (const q of geom || []) { const [a, o] = pt(q); if (a < s) s = a; if (a > n) n = a; if (o < w) w = o; if (o > e) e = o; }
        return fresh.some(([a, o]) => s < a + 0.5 && n >= a && w < o + 0.5 && e >= o);
      };
      return Promise.all(want).then(() => fire(touches));
    });
  }
  function segDist(p, a0, a1, b0, b1) {
    const k = Math.cos(p[0] * Math.PI / 180) * 111320, K = 110540;
    const ax = (a1 - p[1]) * k, ay = (a0 - p[0]) * K, bx = (b1 - p[1]) * k, by = (b0 - p[0]) * K;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let u = L2 ? -(ax * dx + ay * dy) / L2 : 0; u = Math.max(0, Math.min(1, u));
    return Math.hypot(ax + u * dx, ay + u * dy);
  }
  const pt = (p) => (Array.isArray(p) ? p : [p.lat, p.lng]);
  const metres = (a, b) => segDist(a, b[0], b[1], b[0], b[1]);
  function along(geom, step) {   // points every `step` metres
    const g = geom.map(pt), out = [g[0]];
    let carry = 0;
    for (let i = 1; i < g.length; i++) {
      const a = g[i - 1], b = g[i], L = metres(a, b);
      let t = step - carry;
      for (; t <= L; t += step) out.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]);
      carry = L - (t - step);
    }
    return out;
  }
  const SRC = { qc: "Sépaq", ott: "the City of Ottawa", ut: "Utah's trail data (UGRC)", pa: "Pennsylvania state parks", wh: "the Resort Municipality of Whistler", csrd: "the Columbia Shuswap Regional District" };
  // Towns' own trail lists name each trail: a line with another trail's name is a different trail on the same spot.
  // Words are kept per name: the same few names are checked against every point of every trail (a freeze of a second
  // or more on a phone when a new part of the map loaded, alex 2026-10-23).
  const NAMED = /^(wh|csrd)$/, wordsOf = new Map(), words = (s) => {
    s = s || "";
    let w = wordsOf.get(s);
    if (!w) { if (wordsOf.size > 20000) wordsOf.clear(); wordsOf.set(s, (w = new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) || []))); }
    return w;
  };
  const sameName = (a, b) => { const A = words(a), B = words(b); return !A.size || !B.size || [...A].some((w) => B.has(w)); };
  function official(geom, name) {
    if (!squares.size || !geom || geom.length < 2) return null;
    const pts = along(geom, 20), hits = new Map();
    for (const p of pts) {
      const cells = squares.get(`${sq(p[0])}_${sq(p[1])}`), list = cells && cells.get(Math.floor(p[0] / CELL) + "," + Math.floor(p[1] / CELL));
      if (!list) continue;
      const seen = new Set();
      for (const [l, k] of list) if (!seen.has(l) && segDist(p, l.g[k], l.g[k + 1], l.g[k + 2], l.g[k + 3]) <= NEAR_M && !(name && NAMED.test(l.src) && !sameName(name, l.name.split(", ")[0]))) seen.add(l);
      seen.forEach((l) => { const key = l.src + "|" + l.name + "|" + l.d; hits.set(key, { l, n: ((hits.get(key) || {}).n || 0) + 1 }); });
    }
    let pick = null;
    hits.forEach((h) => { if (h.n >= SHARE * pts.length && (!pick || h.n > pick.n)) pick = h; });
    if (!pick) return null;
    const l = pick.l;
    return { d: l.d, src: "off", why: `Rated ${l.note ? `“${l.note}”` : LEVEL[l.d]} by ${SRC[l.src] || l.src}${l.name ? ` (${l.name})` : ""}`
      + (l.src === "pa" ? ". Their rating is for everyone on the trail, not only bikes." : ".") };
  }

  // ---------- the slope estimate (same numbers as scripts/build-ratings.mjs: change both together) ----------
  const W = [0.3, 0.3, 0.2, 0.2], CUTS = [0.055, 0.175, 0.31], LEVELS = ["green", "blue", "black", "dbl"];
  function tagHint(t) {
    let a = 0;
    if (/demanding|alpine/.test(t.sac_scale || "")) a += 0.04;
    if (/^(bad|horrible|no)$/.test(t.trail_visibility || "")) a += 0.02;
    if (/very_bad|horrible|impassable/.test(t.smoothness || "")) a += 0.04;
    if (/^(gravel|fine_gravel|compacted|asphalt|paved|concrete)$/.test(t.surface || "")) a -= 0.04;
    if (parseFloat(t.width) >= 2) a -= 0.03;
    return a;
  }
  function slopeStats(z) {
    const g = [];
    for (let i = 0; i + 3 < z.length; i++) g.push(Math.abs(z[i + 3] - z[i]) / 30);
    g.sort((a, b) => a - b);
    const q = (p) => g[Math.min(g.length - 1, Math.floor(p * g.length))];
    let move = 0;
    for (let i = 1; i < z.length; i++) move += Math.abs(z[i] - z[i - 1]);
    const len = (z.length - 1) * 10;
    return { p50: q(0.5), p90: q(0.9), avg: Math.abs(z[z.length - 1] - z[0]) / len, relief: move / len };
  }
  const Z = 14, tiles = new Map();
  function tile(x, y) {
    const k = x + "/" + y;
    if (!tiles.has(k)) tiles.set(k, fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`)
      .then((r) => { if (!r.ok) throw new Error("elevation " + r.status); return r.blob(); })
      .then((b) => createImageBitmap(b))
      .then((img) => {
        const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
        const ctx = c.getContext("2d", { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data, e = new Float32Array(c.width * c.height);
        for (let i = 0; i < e.length; i++) e[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        return { w: c.width, e };
      })
      .catch((err) => { tiles.delete(k); throw err; }));
    return tiles.get(k);
  }
  async function elevation(la, lo) {
    const n = 2 ** Z, fx = (lo + 180) / 360 * n, fy = (1 - Math.log(Math.tan(Math.PI / 4 + la * Math.PI / 360)) / Math.PI) / 2 * n;
    const x = Math.floor(fx), y = Math.floor(fy), t = await tile(x, y), w = t.w;
    const px = (fx - x) * w - 0.5, py = (fy - y) * w - 0.5;
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(px))), y0 = Math.max(0, Math.min(w - 2, Math.floor(py)));
    const u = Math.max(0, Math.min(1, px - x0)), v = Math.max(0, Math.min(1, py - y0)), E = (i, j) => t.e[j * w + i];
    return E(x0, y0) * (1 - u) * (1 - v) + E(x0 + 1, y0) * u * (1 - v) + E(x0, y0 + 1) * (1 - u) * v + E(x0 + 1, y0 + 1) * u * v;
  }
  const estWhy = (p90) => `Nobody has rated it, so this is a guess from the slope (steepest parts about ${p90}%). Slope can't see rocks,`
    + " roots or drops: the guess is right about half the time and within one level 96% of the time.";
  async function estimate(id, geom, tags) {
    if (id && est.has(id)) return est.get(id);
    const pts = along(geom, 10);
    if (pts.length < 7) return null;
    const z = await Promise.all(pts.map(([la, lo]) => elevation(la, lo)));
    const s = slopeStats(z), v = W[0] * s.p50 + W[1] * s.p90 + W[2] * s.avg + W[3] * s.relief + tagHint(tags || {});
    const r = { d: LEVELS[v < CUTS[0] ? 0 : v < CUTS[1] ? 1 : v < CUTS[2] ? 2 : 3], src: "est", why: estWhy(Math.round(s.p90 * 100)) };
    if (id) est.set(id, r);
    fire(id ? (g, i) => i === id : undefined);
    return r;
  }

  // ---------- rated by hand ----------
  // Trails a local rider rated (alex), matched by name within r metres of c. Remove one once OpenStreetMap has a rating.
  // Every trail listed is an MTB trail (the rider says so). d: their level (leave out to keep the estimate);
  // off: they say it's an official trail (shown as Official). unoff: why it's not official (shown dotted as Unofficial, even when
  // the map's tags say official). Unnamed trails are listed by OpenStreetMap way id (ids) instead of name;
  // named: the trail the rider says they're part of, so lists, search and details show and group them under that name.
  // Entries with src instead of who come from the weekly data audit's research (scripts/audit.mjs): src names the
  // resort, club or tourism page that gives the level or calls it a bike trail, url is that page. Never Trailforks.
  const HAND = [
    // Lift-served bike parks: levels from the resort's own trail list or map (checked 2026-10-22), where OpenStreetMap has none
    // or a different one. Fernie's list marks black and double black the same, so its blacks may include double blacks.
    // Sun Peaks (OpenStreetMap rates every park trail; these four differ from the resort's list)
    { name: "DH", c: [50.895, -119.895], r: 2500, d: "dbl", src: "Sun Peaks Resort, bike trail status", url: "https://www.sunpeaksresort.com/bike-hike/bike/lift-trail-status" },
    { name: "High Octane", c: [50.895, -119.895], r: 2500, d: "black", src: "Sun Peaks Resort, bike trail status", url: "https://www.sunpeaksresort.com/bike-hike/bike/lift-trail-status" },
    { name: "Mach", c: [50.895, -119.895], r: 2500, d: "black", src: "Sun Peaks Resort, bike trail status", url: "https://www.sunpeaksresort.com/bike-hike/bike/lift-trail-status" },
    { name: "Sweet One", c: [50.895, -119.895], r: 2500, d: "black", src: "Sun Peaks Resort, bike trail status", url: "https://www.sunpeaksresort.com/bike-hike/bike/lift-trail-status" },
    // Panorama
    { name: "Let It Ride", c: [50.448, -116.235], r: 2500, d: "green", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Rocking Horse", c: [50.448, -116.235], r: 2500, d: "green", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Mercy Me", c: [50.448, -116.235], r: 2500, d: "blue", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Sanchez", c: [50.448, -116.235], r: 2500, d: "blue", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Bazooka Joe", c: [50.448, -116.235], r: 2500, d: "blue", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Stiffy", c: [50.448, -116.235], r: 2500, d: "blue", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Rusty Cage", c: [50.448, -116.235], r: 2500, d: "blue", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Hell's Bells", c: [50.448, -116.235], r: 2500, d: "black", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Look Out", c: [50.448, -116.235], r: 2500, d: "black", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Quadzilla", c: [50.448, -116.235], r: 2500, d: "black", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Bender", c: [50.448, -116.235], r: 2500, d: "black", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Get In Line", c: [50.448, -116.235], r: 2500, d: "black", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Moose Powder", c: [50.448, -116.235], r: 2500, d: "black", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Crazy Train", c: [50.448, -116.235], r: 2500, d: "dbl", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Insanity", c: [50.448, -116.235], r: 2500, d: "dbl", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    { name: "Punnisher", c: [50.448, -116.235], r: 2500, d: "dbl", src: "Panorama Mountain Resort, 2024 DH trail map", url: "https://www.panoramaresort.com/assets/Maps/2024-BikeMap.pdf" },
    // Revelstoke
    { name: "Big Easy", c: [50.958, -118.15], r: 3000, d: "blue", src: "Revelstoke Mountain Resort, trail report", url: "https://www.revelstokemountainresort.com/mountain/conditions/trail-report/" },
    { name: "Stoke Climb", c: [50.958, -118.15], r: 3000, d: "blue", src: "Revelstoke Mountain Resort, trail report", url: "https://www.revelstokemountainresort.com/mountain/conditions/trail-report/" },
    { name: "Pipe Wrench", c: [50.958, -118.15], r: 3000, d: "dbl", src: "Revelstoke Mountain Resort, trail report", url: "https://www.revelstokemountainresort.com/mountain/conditions/trail-report/" },
    // Big White (more below, from the audit; Rock Hammer and Rocket Science corrected there)
    { name: "Mop Up", c: [49.73, -118.927], r: 2000, d: "blue", src: "Big White Bike Park trail progression chart", url: "https://www.bigwhite.com/summer/bike-park-trail-map" },
    { name: "Knockout", c: [49.73, -118.927], r: 2000, d: "black", src: "Big White Bike Park trail progression chart", url: "https://www.bigwhite.com/summer/bike-park-trail-map" },
    { name: "Catapult Ranch", c: [49.73, -118.927], r: 2000, d: "black", src: "Big White Bike Park trail progression chart", url: "https://www.bigwhite.com/summer/bike-park-trail-map" },
    { name: "Stacked Deck", c: [49.73, -118.927], r: 2000, d: "black", src: "Big White Bike Park trail progression chart", url: "https://www.bigwhite.com/summer/bike-park-trail-map" },
    { name: "Hubba Bubba", c: [49.73, -118.927], r: 2000, d: "black", src: "Big White Bike Park trail progression chart", url: "https://www.bigwhite.com/summer/bike-park-trail-map" },
    { name: "Black Slabbath", c: [49.73, -118.927], r: 2000, d: "black", src: "Big White Bike Park trail progression chart", url: "https://www.bigwhite.com/summer/bike-park-trail-map" },
    { name: "The Joker", c: [49.73, -118.927], r: 2000, d: "dbl", src: "Big White Bike Park trail progression chart", url: "https://www.bigwhite.com/summer/bike-park-trail-map" },
    // Fernie Alpine Resort
    { name: "Ben's Big Rig", c: [49.462, -115.1], r: 3500, d: "green", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Boom Trail", c: [49.462, -115.1], r: 3500, d: "green", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Deer Trail", c: [49.462, -115.1], r: 3500, d: "green", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Duff Dynasty", c: [49.462, -115.1], r: 3500, d: "green", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Eville", c: [49.462, -115.1], r: 3500, d: "green", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Lil' Miss Buffit", c: [49.462, -115.1], r: 3500, d: "green", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "GT Racer", c: [49.462, -115.1], r: 3500, d: "blue", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Holo Bike", c: [49.462, -115.1], r: 3500, d: "blue", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Mr. Berms", c: [49.462, -115.1], r: 3500, d: "blue", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Top Gun", c: [49.462, -115.1], r: 3500, d: "blue", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Aggravated Assault", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Alternate Flight Pattern", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Bicycle Thief", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Case Closed", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Cats Pyjamas", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Kodiak Karnage", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Megasaurus", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Neverland", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Phat Larry's", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Playground", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Rubber Ducky", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Rumplestumpskin", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "TNT Lower", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "TNT Upper", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Trac III", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    { name: "Will Power", c: [49.462, -115.1], r: 3500, d: "black", src: "Fernie Alpine Resort, bike park trail descriptions (2026)", url: "https://skifernie.com/wp-content/uploads/2026/07/Bike-Trail-descriptions-2026.pdf" },
    // SilverStar (the 2022 map; Challenger is both a green and a blue line there, so it's left out)
    { name: "Paradise", c: [50.37, -119.05], r: 2500, d: "green", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "Comet Trail", c: [50.37, -119.05], r: 2500, d: "blue", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "Jedi Mind Trick", c: [50.37, -119.05], r: 2500, d: "blue", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "LTG", c: [50.37, -119.05], r: 2500, d: "blue", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "Shazam", c: [50.37, -119.05], r: 2500, d: "blue", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "Snake Pit", c: [50.37, -119.05], r: 2500, d: "blue", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "Super Star", c: [50.37, -119.05], r: 2500, d: "blue", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "SuperStar", c: [50.37, -119.05], r: 2500, d: "blue", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "Double Dog", c: [50.37, -119.05], r: 2500, d: "black", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "Flow", c: [50.37, -119.05], r: 2500, d: "black", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "Pipe Dream", c: [50.37, -119.05], r: 2500, d: "black", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "Rockstar", c: [50.37, -119.05], r: 2500, d: "black", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "Chainsaw Mullet", c: [50.37, -119.05], r: 2500, d: "dbl", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "Dog's Downhill", c: [50.37, -119.05], r: 2500, d: "dbl", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    { name: "Gnar", c: [50.37, -119.05], r: 2500, d: "dbl", src: "SilverStar Bike Park downhill trail map (2022)", url: "https://gobybikebc.ca/vernon-north-okanagan/wp-content/uploads/sites/56/2022/09/2022SilverStar_bike_downhill.pdf" },
    // Kicking Horse
    { name: "Kranky Pants", c: [51.29, -117.06], r: 3000, d: "blue", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },
    { name: "Devil's Disco", c: [51.29, -117.06], r: 3000, d: "black", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },
    { name: "Alpine Capone", c: [49.845, -123.092], r: 3000, d: "black", who: "alex", note: "an unsanctioned trail on Brohm Ridge, Squamish" },
    { name: "Just a Cough", c: [49.823, -123.118], r: 2000, d: "black", who: "alex", note: "an unsanctioned trail on Brohm Ridge, Squamish, like Flying Whales" },
    // BC's Trail is tagged blue (mtb:scale:imba 2) on OpenStreetMap; a rider's level beats the map's (rateTags in index.html).
    { name: "BC's Trail", c: [50.088, -122.981], r: 1500, d: "dbl", who: "alex", note: "a Whistler Bike Park trail in Creekside, by Kadenwood" },
    // Whistler Bike Park trails whose OpenStreetMap level differs from the park's own 2026 map (or that have none).
    { name: "Dirt Merchant", c: [50.1, -122.958], r: 1500, d: "pro", src: "the Whistler Mountain Bike Park map (2026)", url: "https://cdn.whistler.com/s3/pdf/maps/whistler-mountain-bike-park-trail-map-2026.pdf" },   // Lower Dirt Merchant (alex: the pro line)
    { name: "1199", c: [50.093, -122.971], r: 1500, d: "pro", src: "the Whistler Mountain Bike Park map (2026)", url: "https://cdn.whistler.com/s3/pdf/maps/whistler-mountain-bike-park-trail-map-2026.pdf" },
    { name: "D1", c: [50.096, -122.955], r: 1500, d: "pro", src: "the Whistler Mountain Bike Park map (2026)", url: "https://cdn.whistler.com/s3/pdf/maps/whistler-mountain-bike-park-trail-map-2026.pdf" },
    { name: "Crabapple Hits", c: [50.101, -122.957], r: 1500, d: "pro", src: "the Whistler Mountain Bike Park map (2026)", url: "https://cdn.whistler.com/s3/pdf/maps/whistler-mountain-bike-park-trail-map-2026.pdf" },
    { name: "Dwayne Johnson", c: [50.105, -122.956], r: 1500, d: "pro", src: "the Whistler Mountain Bike Park map (2026)", url: "https://cdn.whistler.com/s3/pdf/maps/whistler-mountain-bike-park-trail-map-2026.pdf" },
    { name: "Drop in Clinic", c: [50.09, -122.965], r: 1500, d: "dbl", src: "the Whistler Mountain Bike Park map (2026)", url: "https://cdn.whistler.com/s3/pdf/maps/whistler-mountain-bike-park-trail-map-2026.pdf" },
    { name: "Miss Fire", c: [50.078, -122.968], r: 1500, d: "dbl", src: "the Whistler Mountain Bike Park map (2026)", url: "https://cdn.whistler.com/s3/pdf/maps/whistler-mountain-bike-park-trail-map-2026.pdf" },
    { name: "No Duff", c: [50.096, -122.963], r: 1500, d: "dbl", src: "the Whistler Mountain Bike Park map (2026)", url: "https://cdn.whistler.com/s3/pdf/maps/whistler-mountain-bike-park-trail-map-2026.pdf" },
    { name: "Too Tight", c: [50.096, -122.954], r: 1500, d: "black", src: "the Whistler Mountain Bike Park map (2026)", url: "https://cdn.whistler.com/s3/pdf/maps/whistler-mountain-bike-park-trail-map-2026.pdf" },
    { name: "Top of the World", c: [50.073, -122.966], r: 1500, d: "black", src: "the Whistler Mountain Bike Park map (2026)", url: "https://cdn.whistler.com/s3/pdf/maps/whistler-mountain-bike-park-trail-map-2026.pdf" },
    { name: "Fantastic", c: [50.101, -122.95], r: 1500, d: "blue", src: "the Whistler Mountain Bike Park map (2026)", url: "https://cdn.whistler.com/s3/pdf/maps/whistler-mountain-bike-park-trail-map-2026.pdf" },
    // RED Mountain (its map ranks Red Riding Hood with the beginner trails; OpenStreetMap says blue)
    { name: "Red Riding Hood", c: [49.099, -117.823], r: 1500, d: "green", src: "RED Mountain Resort, bike park trail map", url: "https://www.redresort.com/wp-content/uploads/2020/09/red-mtn-bike-park-trail-map-website-v12.1.jpg" },
    // Riding hubs and MTB centres: levels from the club's, town's or park's own trail list or map (checked 2026-10-22),
    // where OpenStreetMap has none or a different one. Where the source has four levels (Easiest/Easier/More Difficult/
    // Most Difficult), the two easiest are green. Golden's club map also names unnamed ways it draws (named).
    // Coast Gravity Park
    { name: "Lower Dirt Wave", c: [49.503, -123.724], r: 1500, d: "blue", src: "Coast Gravity Park, trail guide", url: "https://www.coastgravitypark.ca/trails" },
    { name: "Sliver", c: [49.502, -123.724], r: 1500, d: "dbl", src: "Coast Gravity Park, trail guide", url: "https://www.coastgravitypark.ca/trails" },   // they say Expert
    { name: "Doggers", c: [49.502, -123.724], r: 1500, d: "blue", src: "Coast Gravity Park, trail guide", url: "https://www.coastgravitypark.ca/trails" },   // they say Intermediate/Advanced
    { name: "Red Dragon", c: [49.502, -123.717], r: 1500, d: "blue", src: "Coast Gravity Park, trail guide", url: "https://www.coastgravitypark.ca/trails" },   // they say Intermediate/Advanced
    // Lost Lake
    { name: "I'm Not Satisifed", c: [50.134, -122.939], r: 1500, d: "blue", src: "Resort Municipality of Whistler, Lost Lake Park summer trail map (2024)", url: "https://www.whistler.ca/wp-content/uploads/2025/LostLake_Pamphlet-Map_Dec.2024.pdf" },
    { name: "Fountain of Love", c: [50.128, -122.944], r: 1500, d: "blue", src: "Resort Municipality of Whistler, Lost Lake Park summer trail map (2024)", url: "https://www.whistler.ca/wp-content/uploads/2025/LostLake_Pamphlet-Map_Dec.2024.pdf" },
    { name: "Packard Goose", c: [50.135, -122.941], r: 1500, d: "green", src: "Resort Municipality of Whistler, Lost Lake Park summer trail map (2024)", url: "https://www.whistler.ca/wp-content/uploads/2025/LostLake_Pamphlet-Map_Dec.2024.pdf" },
    // Kamloops Bike Ranch
    { name: "Fist Full of Dollars", c: [50.668, -120.264], r: 1500, d: "pro", src: "City of Kamloops, Kamloops Bike Ranch trail map", url: "https://kamloops.ca/sites/default/files/Trail%20Map_Facility%20Overview.pdf" },
    // Kenna Cartwright
    { name: "Prickly Pear Cactus", c: [50.664, -120.403], r: 1500, d: "blue", src: "City of Kamloops, Kenna Cartwright Nature Park map (2025)", url: "https://www.kamloops.ca/sites/default/files/2025-11/OPS_Signage_PKS_Maps_KennaCartwrightTrails_KioskSign_92x43_Aug2025_FINAL-WEB.pdf" },
    { name: "Sage Trail", c: [50.679, -120.39], r: 1500, d: "blue", src: "City of Kamloops, Kenna Cartwright Nature Park map (2025)", url: "https://www.kamloops.ca/sites/default/files/2025-11/OPS_Signage_PKS_Maps_KennaCartwrightTrails_KioskSign_92x43_Aug2025_FINAL-WEB.pdf" },
    { name: "Saskatoon", c: [50.667, -120.397], r: 1500, d: "blue", src: "City of Kamloops, Kenna Cartwright Nature Park map (2025)", url: "https://www.kamloops.ca/sites/default/files/2025-11/OPS_Signage_PKS_Maps_KennaCartwrightTrails_KioskSign_92x43_Aug2025_FINAL-WEB.pdf" },
    { name: "West Vista", c: [50.674, -120.413], r: 1500, d: "blue", src: "City of Kamloops, Kenna Cartwright Nature Park map (2025)", url: "https://www.kamloops.ca/sites/default/files/2025-11/OPS_Signage_PKS_Maps_KennaCartwrightTrails_KioskSign_92x43_Aug2025_FINAL-WEB.pdf" },
    // Canmore Nordic Centre
    { name: "Canmore Trail", c: [51.09, -115.376], r: 1500, d: "green", src: "Alberta Parks, Canmore Nordic Centre summer trail map", url: "https://albertaparks.ca/media/3996277/summer-trails-map.pdf" },
    { name: "Narnia", c: [51.088, -115.374], r: 1500, d: "green", src: "Alberta Parks, Canmore Nordic Centre summer trail map", url: "https://albertaparks.ca/media/3996277/summer-trails-map.pdf" },
    { name: "Orchid Trail", c: [51.092, -115.379], r: 1500, d: "green", src: "Alberta Parks, Canmore Nordic Centre summer trail map", url: "https://albertaparks.ca/media/3996277/summer-trails-map.pdf" },
    { name: "Dipped Cone", c: [51.091, -115.384], r: 1500, d: "blue", src: "Alberta Parks, Canmore Nordic Centre summer trail map", url: "https://albertaparks.ca/media/3996277/summer-trails-map.pdf" },
    { name: "FYI", c: [51.093, -115.388], r: 1500, d: "blue", src: "Alberta Parks, Canmore Nordic Centre summer trail map", url: "https://albertaparks.ca/media/3996277/summer-trails-map.pdf" },
    { name: "Georgetown Climb", c: [51.103, -115.393], r: 1500, d: "black", src: "Alberta Parks, Canmore Nordic Centre summer trail map", url: "https://albertaparks.ca/media/3996277/summer-trails-map.pdf" },
    { name: "No Homers", c: [51.111, -115.398], r: 1500, d: "black", src: "Alberta Parks, Canmore Nordic Centre summer trail map", url: "https://albertaparks.ca/media/3996277/summer-trails-map.pdf" },
    { name: "Oven / Downhill", c: [51.089, -115.398], r: 1500, d: "black", src: "Alberta Parks, Canmore Nordic Centre summer trail map", url: "https://albertaparks.ca/media/3996277/summer-trails-map.pdf" },
    // Banff
    { name: "Fenland Trail", c: [51.184, -115.584], r: 1500, d: "green", src: "Parks Canada, mountain biking trails in the Banff area", url: "https://parks.canada.ca/pn-np/ab/banff/activ/cyclisme-biking/velomontagne-mountainbiking/banff" },
    { name: "Surprise Corner to Hoodoos - Alternate", c: [51.17, -115.552], r: 1500, d: "blue", src: "Parks Canada, mountain biking trails in the Banff area", url: "https://parks.canada.ca/pn-np/ab/banff/activ/cyclisme-biking/velomontagne-mountainbiking/banff" },
    { name: "Surprise Corner to Hoodoos", c: [51.175, -115.546], r: 1500, d: "blue", src: "Parks Canada, mountain biking trails in the Banff area", url: "https://parks.canada.ca/pn-np/ab/banff/activ/cyclisme-biking/velomontagne-mountainbiking/banff" },
    // Golden (club trails, plus Kicking Horse trails the club lists)
    { name: "CBT Mainline", c: [51.268, -116.978], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Gold Rush", c: [51.284, -116.987], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "The Mighty Quinn", c: [51.291, -116.989], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Kobe's", c: [51.277, -116.927], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Bear Claw", c: [51.24, -116.953], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Canyon Creek", c: [51.23, -116.966], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Sternwheeler", c: [51.239, -116.936], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Selkirk Slacker", c: [51.286, -116.94], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Reflection Lake", c: [51.282, -116.937], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Odonata", c: [51.273, -116.997], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Twisted Sister", c: [51.303, -117.03], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Wapiti Ridge", c: [51.243, -116.947], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Klahowya", c: [51.242, -116.948], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "French Connection", c: [51.298, -117.005], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Summit", c: [51.274, -116.89], r: 1500, d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    // Kicking Horse: unnamed ways that lie along one trail of the club's map, graded from the resort's bike trail report
    { ids: [550683444], c: [51.279, -117.08], r: 1000, named: "Dragon Chaser", d: "green", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },
    { ids: [550683470], c: [51.293, -117.05], r: 1000, named: "Easy Rider", d: "green", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },
    { ids: [550683463], c: [51.29, -117.065], r: 1000, named: "Road Runner", d: "blue", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },
    { ids: [550683472, 550683473], c: [51.294, -117.052], r: 1000, named: "Buffalo Jump", d: "blue", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },   // the resort says blue to black
    { ids: [550683475], c: [51.289, -117.054], r: 1000, named: "Superberm", d: "blue", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },
    { ids: [550683483], c: [51.297, -117.053], r: 1000, named: "Claim Jumper", d: "black", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },
    { ids: [550683461, 550683485], c: [51.297, -117.051], r: 1000, named: "It's a 10", d: "blue", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },   // the resort says green to blue
    { ids: [550683471], c: [51.297, -117.053], r: 1000, named: "Hop A Long", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683446], c: [51.282, -117.075], r: 1000, d: "blue", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },   // along It's a 10 and Chute to View, both blue
    // unnamed on OpenStreetMap; the club's map names them (way lies along the club's line)
    { ids: [491189967], c: [51.284, -116.93], r: 1000, named: "Cliff Side", d: "black", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [491189975], c: [51.272, -116.915], r: 1000, named: "Rock About", d: "black", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [491189971, 1210187388], c: [51.286, -116.934], r: 1000, named: "Roller Coaster", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550685730], c: [51.227, -116.981], r: 1000, named: "LSD (Little Sir Donald)", d: "black", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550693956], c: [51.273, -116.993], r: 1000, named: "Hymenoptera", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [491189977, 550667217], c: [51.295, -116.946], r: 1000, named: "Rotary Trail", d: "green", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550667212], c: [51.281, -116.909], r: 1000, named: "B52", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550667215], c: [51.287, -116.941], r: 1000, named: "Rodeo Drive", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550667219], c: [51.29, -116.945], r: 1000, named: "Connector", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683476], c: [51.286, -117.032], r: 1000, named: "Scalli Mag", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550693952], c: [51.236, -116.941], r: 1000, named: "Easy Out", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550693953], c: [51.235, -116.939], r: 1000, named: "Private Lands", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683469], c: [51.292, -117.055], r: 1000, named: "Stump Jumper", d: "black", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683454], c: [51.292, -117.061], r: 1000, named: "L.Y.M", d: "black", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [1562597863], c: [51.276, -117.081], r: 1000, named: "Rock Garden", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683448], c: [51.282, -117.076], r: 1000, named: "Gale Force", d: "blue", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },   // the club says black
    { ids: [550683479], c: [51.281, -117.078], r: 1000, named: "Training Wheels", d: "green", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683455], c: [51.293, -117.07], r: 1000, named: "Blaster", d: "blue", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },   // the club says black
    { ids: [550683453], c: [51.287, -117.062], r: 1000, named: "Rock n Roll", d: "black", src: "Kicking Horse Mountain Resort, bike trail report", url: "https://kickinghorseresort.com/conditions/trail-report/" },   // the club says dbl
    { ids: [550683457, 550683458], c: [51.292, -117.065], r: 1000, named: "Pioneer", d: "dbl", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683466], c: [51.29, -117.053], r: 1000, named: "Super Berm", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683459], c: [51.299, -117.06], r: 1000, named: "Claim Jumper", d: "black", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683474], c: [51.296, -117.05], r: 1000, named: "Easy Rider", d: "green", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683449, 550683450], c: [51.284, -117.071], r: 1000, named: "Magic Carpet Ride", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [170402117, 587796643, 587796644], c: [51.248, -116.951], r: 1000, named: "2% CRL Road", d: "green", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [645185433], c: [51.277, -116.897], r: 1000, named: "10K", d: "black", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [491189972], c: [51.285, -116.939], r: 1000, named: "Snake Hill/Tail Gate", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683441], c: [51.278, -117.084], r: 1000, named: "Excalibur", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683443, 1562597864], c: [51.278, -117.078], r: 1000, named: "Pipestone", d: "blue", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [550683465], c: [51.278, -117.044], r: 1000, named: "Swamp Donkey", d: "black", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { ids: [1562597865], c: [51.28, -117.078], r: 1000, named: "Dragon Chaser", d: "green", src: "Golden Cycling Club, trail list and map", url: "https://goldencyclingclub.com/golden-cycling-club-trails/" },
    { name: "Trial and Error", c: [50.162, -122.938], r: 2000, d: "black", who: "alex", note: "an official trail at Emerald, Whistler", off: true },
    { name: "Trial and Error (lower)", c: [50.162, -122.938], r: 2000, d: "black", who: "alex", note: "an official trail at Emerald, Whistler", off: true },
    { name: "Pretty Slabs", c: [49.641, -123.170], r: 2000, d: "dbl", who: "alex", note: "an unsanctioned trail by the Upper Britannia paragliding launch, Squamish" },
    { name: "Stepping Stones", c: [49.636, -123.177], r: 2000, d: "dbl", who: "alex", note: "an unsanctioned trail below Pretty Slabs, Britannia" },
    { ids: [1055222771, 1065048117, 1283478720, 1285445609, 1285445610, 1285445611, 1285445613], c: [49.6372, -123.1735], r: 1000, who: "alex",
      note: "the unnamed unsanctioned trails between Pretty Slabs, Stepping Stones and Semtex Roll, Britannia" },
    { name: "Leftovers Skid Road", c: [50.103, -123.016], r: 1500, d: "green", who: "alex",
      note: "an old access skid road on the Rainbow-Sproat flank, Whistler, ridden as an easy MTB climbing trail" },
    { name: "electric unicorn", c: [50.31, -122.816], r: 1500, who: "alex", unoff: "alex, who rides it, says it's an unofficial trail",
      note: "an unsanctioned trail by Signal Hill, Pemberton; mapped as a bike path (bicycle=designated) in a 2026-10-14 edit that dropped its informal=yes" },
    { name: "Taste the Candy", c: [50.326, -122.843], r: 1500, who: "alex", unoff: "alex, who rides it, says it's an unofficial trail", note: "an unsanctioned trail off Pemberton Creek, Pemberton" },
    { ids: [1105675082], c: [50.309, -122.942], r: 2000, who: "alex", named: "Hidden Peak Trail",
      note: "the unnamed AlpX black descent, Pemberton (its old_name is Hidden Peak Trail), which joins the Hidden Peak Trail climb" },
    { name: "Taste the Gravy", c: [50.322, -122.83], r: 1500, who: "alex", unoff: "alex, who rides it, says it's an unofficial trail", note: "an unsanctioned trail off Pemberton Creek, Pemberton" },
    // One OpenStreetMap mapper (tresspasserlover69, 2026-10-07 to 14) maps new unsanctioned lines as bike paths (highway=cycleway,
    // bicycle=designated), which reads as official, and removed informal=yes from older ones. Their edits: "added sick new line",
    // "added death line", "fun freeride line built for trolldom".
    { ids: [1228978479, 1568299895, 1565717920, 1565717921, 1565717922], c: [50.315, -122.815], r: 3000, src: "OpenStreetMap edit history",
      url: "https://www.openstreetmap.org/user/tresspasserlover69/history", unoff: "A mapper drew this new, unsanctioned line as a bike path (bicycle=designated), which made it look official; it isn't.", note: "Upper Pacific, KOG and Gnar Log Bridge, Pemberton" },
    { ids: [1568013247, 1568014331, 1568015037, 1568015906, 1568017673, 1568300627, 1568300903, 1565892823], c: [50.09, -122.95], r: 15000, src: "OpenStreetMap edit history",
      url: "https://www.openstreetmap.org/user/tresspasserlover69/history", unoff: "A mapper drew this new, unsanctioned line as a bike path (bicycle=designated), which made it look official; it isn't.", note: "new lines on Whistler and Fitzsimmons" },
    { ids: [1568302348, 1568302185], c: [49.92, -123.28], r: 5000, src: "OpenStreetMap edit history",
      url: "https://www.openstreetmap.org/user/tresspasserlover69/history", unoff: "A mapper drew this new, unsanctioned line as a bike path (bicycle=designated), which made it look official; it isn't.", note: "new lines in Paradise Valley, Squamish" },
    { name: "Bumble Bee", c: [49.731, -118.94], r: 2000, d: "green", src: "Big White Ski Resort, bike school page", url: "https://www.bigwhite.com/summer/mountain-biking/bike-school" },
    { name: "Pry Bar", c: [49.737, -118.928], r: 2000, d: "green", src: "Big White Ski Resort, bike school page", url: "https://www.bigwhite.com/summer/mountain-biking/bike-school" },
    { name: "Nessy", c: [49.732, -118.924], r: 2000, d: "green", src: "Big White Ski Resort, bike school page", url: "https://www.bigwhite.com/summer/mountain-biking/bike-school" },
    { name: "Bermslang", c: [49.73, -118.925], r: 2000, d: "blue", src: "Big White Ski Resort, bike school page", url: "https://www.bigwhite.com/summer/mountain-biking/bike-school" },
    { name: "Lightning Strike", c: [49.73, -118.932], r: 2000, d: "blue", src: "Big White Ski Resort, bike school page", url: "https://www.bigwhite.com/summer/mountain-biking/bike-school" },
    { name: "Ace of Spades", c: [49.733, -118.922], r: 2000, d: "blue", src: "Big White Ski Resort, bike school page", url: "https://www.bigwhite.com/summer/mountain-biking/bike-school" },
    { name: "Gecko", c: [49.737, -118.928], r: 2000, d: "blue", src: "Big White Ski Resort blog, 2024 trail improvements", url: "https://www.bigwhite.com/summer/explore-big-white/blog/mountain-biking/trail-improvements-24" },
    { name: "Squirts", c: [49.729, -118.919], r: 2000, d: "blue", src: "Big White Ski Resort blog, 2024 trail improvements", url: "https://www.bigwhite.com/summer/explore-big-white/blog/mountain-biking/trail-improvements-24" },
    { name: "Home Run", c: [49.725, -118.925], r: 2000, d: "green", src: "Mountain Biking BC, first visit to Big White bike park", url: "https://www.mountainbikingbc.ca/blog/your-first-visit-to-bcs-newest-lift-accessed-bike-park-in-big-white/" },
    { name: "It's So Easy", c: [49.723, -118.924], r: 2000, d: "green", src: "Mountain Biking BC, first visit to Big White bike park", url: "https://www.mountainbikingbc.ca/blog/your-first-visit-to-bcs-newest-lift-accessed-bike-park-in-big-white/" },
    { name: "Easy Steezy", c: [49.723, -118.926], r: 2000, d: "green", src: "Mountain Biking BC, first visit to Big White bike park", url: "https://www.mountainbikingbc.ca/blog/your-first-visit-to-bcs-newest-lift-accessed-bike-park-in-big-white/" },
    { name: "Dark Roast", c: [49.734, -118.926], r: 2000, d: "black", src: "Mountain Biking BC, Bike Parks BC road trip part 2", url: "https://www.mountainbikingbc.ca/blog/bike-parks-bc-road-trip-part-2-silverstar-and-big-white/" },
    { name: "Rocket Science", c: [49.724, -118.935], r: 2000, d: "dbl", src: "Big White Bike Park trail progression chart", url: "https://www.bigwhite.com/summer/bike-park-trail-map" },
    { name: "Black Mamba", c: [49.725, -118.922], r: 2000, d: "black", src: "Freehub, BC bike parks travel guide", url: "https://freehub.com/features/bc-bike-parks-travel-guide" },
    { name: "Shark Fin Soup", c: [49.725, -118.925], r: 2000, d: "blue", src: "Freehub, BC bike parks travel guide", url: "https://freehub.com/features/bc-bike-parks-travel-guide" },
    { name: "Rock Hammer", c: [49.737, -118.927], r: 2000, d: "black", src: "Big White Bike Park trail progression chart", url: "https://www.bigwhite.com/summer/bike-park-trail-map" },
    { name: "Bronco", c: [49.547, -119.533], r: 2000, d: "black", src: "Swagman ride guide on Visit Penticton, Three Blind Mice", url: "https://visitpenticton.com/swagmans-backyard-ride-guide-three-blind-mice-part-1-flow/" },
    { name: "High Pony", c: [49.553, -119.533], r: 2000, d: "blue", src: "Swagman ride guide on Visit Penticton, Three Blind Mice", url: "https://visitpenticton.com/swagmans-backyard-ride-guide-three-blind-mice-part-1-flow/" },
    { name: "Slabs", c: [49.556, -119.547], r: 2000, d: "black", src: "Swagman ride guide on Visit Penticton, Three Blind Mice", url: "https://visitpenticton.com/swagmans-backyard-ride-guide-three-blind-mice-part-1-flow/" },
    { name: "Fred", c: [49.563, -119.549], r: 2000, d: "blue", src: "Mountain Biking BC, something for everyone in Penticton", url: "https://www.mountainbikingbc.ca/blog/theres-something-for-everyone-in-penticton/" },
    { name: "Flow Coaster", c: [49.546, -119.553], r: 2000, d: "blue", src: "Mountain Biking BC, something for everyone in Penticton", url: "https://www.mountainbikingbc.ca/blog/theres-something-for-everyone-in-penticton/" },
    { name: "Test of Humanity", c: [49.597, -119.699], r: 2000, d: "blue", src: "Summerland tourism, best trails for experienced riders", url: "https://summerland.com/articles/biking-bliss-summerlands-best-mountain-trails-for-experienced-riders/" },
    { name: "Chief William XC", c: [52.14, -122.054], r: 2000, d: "blue", src: "First Journey Trails, Chief William XC", url: "https://firstjourneytrails.com/trail/chief-william-xc/" },
    { name: "Fox Fire", c: [52.14, -122.106], r: 2000, d: "green", src: "Explore Cariboo, mountain biking", url: "https://explorecariboo.com/mountain-biking/" },
    { name: "Shuttle Bunny", c: [52.157, -122.132], r: 2000, d: "green", src: "Explore Cariboo, mountain biking", url: "https://explorecariboo.com/mountain-biking/" },
    { name: "Loose Moose", c: [52.133, -122.081], r: 2000, d: "blue", src: "Williams Lake Tribune, 2022 trail opening", url: "https://wltribune.com/2022/06/17/mountain-bike-trail-grand-opening-event-draws-a-crowd-to-williams-lake/" },
    { name: "Westlake Trail", c: [49.045, -118.245], r: 2000, d: "black", src: "Christina Lake tourism, Westlake Trail", url: "https://christinalake.ca/westlake-trail-tnt/" },
    { name: "Upper Harpold", c: [49.049, -118.416], r: 2000, d: "blue", src: "Discover Grand Forks, mountain biking", url: "https://discovergrandforks.ca/news/why-grand-forks-bc-is-the-best-hidden-gem-for-mountain-biking-adventures/" },
    { name: "Lower Harpold", c: [49.044, -118.43], r: 2000, d: "blue", src: "Discover Grand Forks, mountain biking", url: "https://discovergrandforks.ca/news/why-grand-forks-bc-is-the-best-hidden-gem-for-mountain-biking-adventures/" },
    { name: "Phat Bastard", c: [49.511, -115.086], r: 2000, d: "black", src: "Sacred Rides, Fernie top 10 trails", url: "https://sacredrides.com/fernie-mountain-biking-the-top-10-trails/" },
    { name: "Red Sonja", c: [49.51, -115.084], r: 2000, d: "black", src: "Sacred Rides, Fernie top 10 trails", url: "https://sacredrides.com/fernie-mountain-biking-the-top-10-trails/" },
    { name: "Old Goat", c: [49.481, -115.106], r: 2000, d: "blue", src: "Sacred Rides, Fernie top 10 trails", url: "https://sacredrides.com/fernie-mountain-biking-the-top-10-trails/" },
    { name: "Academy Trail", c: [49.325, -122.852], r: 2000, src: "Singletracks, Eagle Mountain trails", url: "https://www.singletracks.com/bike-trails/lower-eagle-bluff/" },
    { name: "Academy Trail Bike Route", c: [49.334, -122.854], r: 2000, src: "Singletracks, Eagle Mountain trails", url: "https://www.singletracks.com/bike-trails/lower-eagle-bluff/" },
    { name: "Eagle Bluff Trail", c: [49.323, -122.849], r: 2000, src: "Singletracks, Eagle Mountain trails", url: "https://www.singletracks.com/bike-trails/lower-eagle-bluff/" },
    { name: "Eagle Bluff North Trail", c: [49.326, -122.846], r: 2000, src: "Singletracks, Eagle Mountain trails", url: "https://www.singletracks.com/bike-trails/lower-eagle-bluff/" },
    { name: "Eagle Bluff South", c: [49.321, -122.843], r: 2000, src: "Singletracks, Eagle Mountain trails", url: "https://www.singletracks.com/bike-trails/lower-eagle-bluff/" },
    { name: "Riders of Rohan", c: [51.072, -115.395], r: 2000, src: "Alberta Parks trail report, Riders of Rohan", url: "https://www.albertaparks.ca/parks/kananaskis/kananaskis-country/advisories-and-public-safety/trail-reports/canmore-and-area/riders-of-rohan/" },
    { name: "Highline Trail", c: [51.06, -115.362], r: 2000, src: "The Banff Blog, Canmore biking", url: "https://thebanffblog.com/canmore-biking/" },
    { name: "Highline East Connector", c: [51.065, -115.362], r: 2000, src: "The Banff Blog, Canmore biking", url: "https://thebanffblog.com/canmore-biking/" },
    { name: "Highline West Connector", c: [51.071, -115.381], r: 2000, src: "The Banff Blog, Canmore biking", url: "https://thebanffblog.com/canmore-biking/" },
    { name: "Highline West End", c: [51.073, -115.394], r: 2000, src: "The Banff Blog, Canmore biking", url: "https://thebanffblog.com/canmore-biking/" },
    { name: "Reclaimer Trail", c: [51.082, -115.402], r: 2000, d: "black", src: "The Banff Blog, Canmore biking", url: "https://thebanffblog.com/canmore-biking/" },
    { name: "Apex Trail", c: [49.906, -119.489], r: 2000, src: "Tourism Kelowna, the Knox network", url: "https://www.tourismkelowna.com/blog/stories/post/mountain-biking-in-kelowna-a-close-look-at-the-knox-network/" },
    { name: "Kathleen Lake Loop Trail", c: [49.905, -119.471], r: 2000, src: "Tourism Kelowna, the Knox network", url: "https://www.tourismkelowna.com/blog/stories/post/mountain-biking-in-kelowna-a-close-look-at-the-knox-network/" },
    { name: "Gear Jammer Connector", c: [49.276, -122.904], r: 2000, src: "Komoot, Burnaby Mountain Gearjammer", url: "https://www.komoot.com/smarttour/31037183" },
    // Roberts Creek (Sunshine Coast)
    { name: "Mach Chicken", c: [49.4475, -123.603], r: 1500, d: "black", src: "MTB Project, Roberts Creek trails (rated Difficult)", url: "https://www.mtbproject.com/directory/8020882/roberts-creek-gibson" },
  ];
  // HAND by way id and by lower-case name (in list order), so each trail is a lookup, not a walk through the whole list:
  // every loaded trail is checked when the app opens.
  let handById = null, handByName = null;
  function handIndex() {
    handById = new Map(); handByName = new Map();
    HAND.forEach((h) => {
      (h.ids || []).forEach((n) => { if (!handById.has(n)) handById.set(n, h); });
      if (h.name) { const k = h.name.toLowerCase(); if (!handByName.has(k)) handByName.set(k, []); handByName.get(k).push(h); }
    });
  }
  function handOf(geom, tags, id) {
    if (!handById) handIndex();
    const n = Number(String(id || "").replace(/^\D+/, ""));
    if (n) { const h = handById.get(n); if (h) return h; }
    const name = ((tags && (tags.name || tags["tf:name"])) || "").toLowerCase(), mid = geom && geom[geom.length >> 1];
    if (!name || !mid) return null;
    const h = (handByName.get(name) || []).find((h) =>
      Math.hypot((mid[0] - h.c[0]) * 110540, (mid[1] - h.c[1]) * 111320 * Math.cos((h.c[0] * Math.PI) / 180)) <= h.r);
    return h || null;
  }
  // { mtb, off, unoff, named }: why the trail counts as an MTB trail, as official and as unofficial (null when not), the trail
  // an unnamed piece belongs to (null when none), or null when it isn't listed.
  function hand(geom, tags, id) {
    const h = handOf(geom, tags, id);
    if (!h) return null;
    const unoff = h.unoff || null, named = h.named || null;
    if (!h.who) return { mtb: h.unoff ? "mapped as a mountain bike line" : `${h.src} calls it a mountain bike trail`, off: null, unoff, named };
    return { mtb: `${h.who}, who rides it, says it's a mountain bike trail`, off: h.off ? `${h.who}, who rides it, says it's an official trail` : null, unoff, named };
  }

  // Best rating known now: a rider's own rating, official open data, riders' grades in the app, then the same trail, then an estimate.
  function rate(id, geom, tags) {
    const h = handOf(geom, tags, id);
    const mapped = tags && (tags["mtb:scale:imba"] != null || tags["mtb:scale"] != null) ? " OpenStreetMap rates it differently." : " It has no rating on OpenStreetMap yet.";
    if (h && h.d) return { d: h.d, src: "hand", why: h.who ? `Rated ${LEVEL[h.d]} by ${h.who}, who rides it: ${h.note}.${mapped}`
      : `Rated ${LEVEL[h.d]} by ${h.src}.${mapped}` };
    const o = official(geom, tags && (tags.name || tags["tf:name"]));
    if (o) return o;
    const g = window.tfGrades ? window.tfGrades.rating(id, mapped) : null;   // what riders say in the app (grades.js)
    if (g) return g;
    const w = osm && id && osm[id];
    if (w && w[1] === "same") return { d: w[0], src: "same", why: `From the rated part of ${w[2] ? `“${w[2]}”` : "the same trail"} it joins on OpenStreetMap; this piece has no rating of its own.` };
    if (id && est.has(id)) return est.get(id);
    if (w && w[1] === "est") return { d: w[0], src: "est", why: estWhy(String(w[2]).split(",")[0]) };
    return null;
  }

  window.tfRatings = { rate, hand, estimate, load, ready: osmReady, onChange: (fn) => listeners.push(fn), changed: () => fire(null) };   // changed(): riders' grades arrived (grades.js)
})();
