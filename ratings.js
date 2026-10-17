// Difficulty for trails with no MTB rating on OpenStreetMap (built by scripts/build-ratings.mjs, see there for sources):
//   off   official open data that rates bike trails (Sépaq, City of Ottawa, Whistler, Columbia Shuswap, Utah, Pennsylvania state parks), matched by shape
//   same  another piece of the same named trail is rated on OpenStreetMap (data/ratings/osm.json)
//   hand  a rider who knows the trail rated it here (HAND below), for trails with no rating on OpenStreetMap
//   est   an estimate from the slope and a few map tags (data/ratings/osm.json for the region's all-trails lists, or
//         worked out here from the AWS terrain tiles when a trail's details open). Never shown as a real rating.
// window.tfRatings = { rate(id, geom, tags) -> { d, src, why } | null (sync, from what's loaded), hand(geom, tags) -> { mtb, off } | null, estimate(id, geom, tags) -> Promise,
//   load(bounds) (official squares in view), onChange(fn) }. d: green, blue, black, dbl.
(function () {
  const DIR = "data/ratings/";
  const LEVEL = { green: "green", blue: "blue", black: "black", dbl: "double black" };
  const listeners = [], fire = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } });
  const est = new Map();   // way id -> estimate worked out here

  // ---------- data/ratings/osm.json ----------
  let osm = null;
  fetch(DIR + "osm.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
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
        squares.set(k, null); want.push(p);
      }
      if (want.length) return Promise.all(want).then(fire);
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
  const NAMED = /^(wh|csrd)$/, words = (s) => new Set((s || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const sameName = (a, b) => { const A = words(a), B = words(b); return !A.size || !B.size || [...A].some((w) => B.has(w)); };
  function official(geom, name) {
    if (!squares.size || !geom || geom.length < 2) return null;
    const pts = along(geom, 20), hits = new Map();
    for (const p of pts) {
      const cells = squares.get(`${sq(p[0])}_${sq(p[1])}`), list = cells && cells.get(Math.floor(p[0] / CELL) + "," + Math.floor(p[1] / CELL));
      if (!list) continue;
      const seen = new Set();
      for (const [l, k] of list) if (!seen.has(l) && !(name && NAMED.test(l.src) && !sameName(name, l.name.split(", ")[0])) && segDist(p, l.g[k], l.g[k + 1], l.g[k + 2], l.g[k + 3]) <= NEAR_M) seen.add(l);
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
    fire();
    return r;
  }

  // ---------- rated by hand ----------
  // Trails a local rider rated (alex), matched by name within r metres of c. Remove one once OpenStreetMap has a rating.
  // Every trail listed is an MTB trail (the rider says so). d: their level (leave out to keep the estimate);
  // off: they say it's an official trail (shown as Official).
  const HAND = [
    { name: "Alpine Capone", c: [49.845, -123.092], r: 3000, d: "black", who: "alex", note: "an unsanctioned trail on Brohm Ridge, Squamish" },
    { name: "Just a Cough", c: [49.823, -123.118], r: 2000, d: "black", who: "alex", note: "an unsanctioned trail on Brohm Ridge, Squamish, like Flying Whales" },
    { name: "Trial and Error", c: [50.162, -122.938], r: 2000, d: "black", who: "alex", note: "an official trail at Emerald, Whistler", off: true },
    { name: "Trial and Error (lower)", c: [50.162, -122.938], r: 2000, d: "black", who: "alex", note: "an official trail at Emerald, Whistler", off: true },
    { name: "Pretty Slabs", c: [49.641, -123.170], r: 2000, who: "alex", note: "by the Upper Britannia paragliding launch, Squamish" },
  ];
  function handOf(geom, tags) {
    const name = ((tags && (tags.name || tags["tf:name"])) || "").toLowerCase(), mid = geom && geom[geom.length >> 1];
    if (!name || !mid) return null;
    const h = HAND.find((h) => h.name.toLowerCase() === name
      && Math.hypot((mid[0] - h.c[0]) * 110540, (mid[1] - h.c[1]) * 111320 * Math.cos((h.c[0] * Math.PI) / 180)) <= h.r);
    return h || null;
  }
  // { mtb, off }: why the trail counts as an MTB trail, and as official (null when not), or null when it isn't listed.
  function hand(geom, tags) {
    const h = handOf(geom, tags);
    return h ? { mtb: `${h.who}, who rides it, says it's a mountain bike trail`, off: h.off ? `${h.who}, who rides it, says it's an official trail` : null } : null;
  }

  // Best rating known now: a rider's own rating, official open data, then the same trail, then an estimate.
  function rate(id, geom, tags) {
    const h = handOf(geom, tags);
    if (h && h.d) return { d: h.d, src: "hand", why: `Rated ${LEVEL[h.d]} by ${h.who}, who rides it: ${h.note}. It has no rating on OpenStreetMap yet.` };
    const o = official(geom, tags && (tags.name || tags["tf:name"]));
    if (o) return o;
    const w = osm && id && osm[id];
    if (w && w[1] === "same") return { d: w[0], src: "same", why: `From the rated part of ${w[2] ? `“${w[2]}”` : "the same trail"} it joins on OpenStreetMap; this piece has no rating of its own.` };
    if (id && est.has(id)) return est.get(id);
    if (w && w[1] === "est") return { d: w[0], src: "est", why: estWhy(String(w[2]).split(",")[0]) };
    return null;
  }

  window.tfRatings = { rate, hand, estimate, load, onChange: (fn) => listeners.push(fn) };
})();
