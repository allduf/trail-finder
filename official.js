// Official trails from government open data (data/official/, built weekly by scripts/build-official.mjs):
// Ontario Trail Network, Sépaq, Recreation Sites and Trails BC, Alberta designated trails, Parks Canada, City of Ottawa.
// An OpenStreetMap trail counts as one of their trails when most of it runs along that trail's line.
// window.tfOfficial = { load(bounds) -> Promise (loads the squares in view), match(geom) -> { s, why } | null,
//   onChange(fn) (called when new squares arrive) }. s: 1 official + bikes allowed, 2 official, 3 official but not for bikes.
(function () {
  const DIR = "data/official/";
  const CELL = 0.005;                 // index cells, degrees (~550 m north-south)
  const NEAR_M = 60, SHARE = 0.6;     // like the Recreation Sites and Trails BC match in scripts/build-mtb.mjs
  const NO_BIKE_M = 30, NO_BIKE_SHARE = 0.8;   // stricter before warning that bikes aren't listed
  let index = null;                   // Promise of index.json (or null)
  const squares = new Map();          // "lat_lon" -> Promise, then { lines, cells }
  const listeners = [];

  const getIndex = () => index || (index = fetch(DIR + "index.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  const sq = (v) => Math.floor(v * 2) / 2;   // half-degree squares, named by their south-west corner
  const keyOf = (lat, lon) => `${sq(lat)}_${sq(lon)}`;

  function prepare(f) {
    const cells = new Map(), lines = f.lines.map(([s, src, name, note, d]) => {
      const g = new Array(d.length);   // points come as 1e-5 degree differences (see scripts/build-official.mjs)
      for (let k = 0, a = 0, o = 0; k < d.length; k += 2) { a += d[k]; o += d[k + 1]; g[k] = a / 1e5; g[k + 1] = o / 1e5; }
      return { s, src, name, note, g };
    });
    lines.forEach((l) => {
      for (let k = 0; k + 3 < l.g.length; k += 2) {
        const la1 = Math.min(l.g[k], l.g[k + 2]), la2 = Math.max(l.g[k], l.g[k + 2]), lo1 = Math.min(l.g[k + 1], l.g[k + 3]), lo2 = Math.max(l.g[k + 1], l.g[k + 3]);
        for (let a = Math.floor((la1 - 0.001) / CELL); a <= Math.floor((la2 + 0.001) / CELL); a++)
          for (let b = Math.floor((lo1 - 0.0015) / CELL); b <= Math.floor((lo2 + 0.0015) / CELL); b++) {
            const c = a + "," + b; if (!cells.has(c)) cells.set(c, []); cells.get(c).push([l, k]);
          }
      }
    });
    return { lines, cells };
  }

  function load(bounds) {
    return getIndex().then((ix) => {
      if (!ix || ix.v !== 2 || !bounds) return;
      const s = bounds.getSouth(), n = bounds.getNorth(), w = bounds.getWest(), e = bounds.getEast();
      if ((n - s) * (e - w) > 40) return;   // zoomed far out: no single trail to match yet
      const want = [];
      for (let la = sq(s); la <= n; la += 0.5) for (let lo = sq(w); lo <= e; lo += 0.5) {
        const k = la + "_" + lo;
        if (!ix.squares[k] || squares.has(k)) continue;
        const p = fetch(DIR + k + ".json").then((r) => (r.ok ? r.json() : null)).catch(() => null)
          .then((f) => { squares.set(k, f && f.v === 2 ? prepare(f) : { lines: [], cells: new Map() }); });
        squares.set(k, p); want.push(p);
      }
      if (want.length) return Promise.all(want).then(() => listeners.forEach((fn) => { try { fn(); } catch (err) { console.warn(err); } }));
    });
  }

  // Distance in metres from point p to segment a-b (flat approximation, fine at these distances).
  function segDist(p, a0, a1, b0, b1) {
    const k = Math.cos(p[0] * Math.PI / 180) * 111320, K = 110540;
    const ax = (a1 - p[1]) * k, ay = (a0 - p[0]) * K, bx = (b1 - p[1]) * k, by = (b0 - p[0]) * K;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    let u = L2 ? -(ax * dx + ay * dy) / L2 : 0; u = Math.max(0, Math.min(1, u));
    return Math.hypot(ax + u * dx, ay + u * dy);
  }
  // Points along the trail, about every 20 m.
  function samples(geom) {
    const out = [];
    for (let i = 0; i < geom.length; i++) {
      out.push(geom[i]);
      if (i + 1 < geom.length) {
        const a = geom[i], b = geom[i + 1], m = segDist(a, b[0], b[1], b[0], b[1]), n = Math.floor(m / 20);
        for (let j = 1; j < n; j++) out.push([a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n]);
      }
    }
    return out;
  }
  const pt = (p) => (Array.isArray(p) ? p : [p.lat, p.lng]);

  function match(geom) {
    if (!geom || geom.length < 2 || !squares.size) return null;
    const pts = samples(geom.map(pt));
    const hits = new Map();   // line -> [points within NEAR_M, points within NO_BIKE_M]
    for (const p of pts) {
      const sq = squares.get(keyOf(p[0], p[1]));
      if (!sq || !sq.cells) continue;
      const list = sq.cells.get(Math.floor(p[0] / CELL) + "," + Math.floor(p[1] / CELL));
      if (!list) continue;
      const best = new Map();
      for (const [l, k] of list) {
        const d = segDist(p, l.g[k], l.g[k + 1], l.g[k + 2], l.g[k + 3]);
        if (d <= NEAR_M && (!best.has(l) || d < best.get(l))) best.set(l, d);
      }
      best.forEach((d, l) => { const h = hits.get(l) || [0, 0]; h[0]++; if (d <= NO_BIKE_M) h[1]++; hits.set(l, h); });
    }
    // Lines of the same trail (name and source) count together: long trails come in many pieces.
    const byTrail = new Map();
    hits.forEach((h, l) => {
      const k = l.src + "|" + l.name + "|" + l.s, t = byTrail.get(k) || { l, near: 0, close: 0 };
      t.near = Math.max(t.near, h[0]); t.close = Math.max(t.close, h[1]);
      byTrail.set(k, t);
    });
    let pick = null;
    byTrail.forEach((t) => {
      const ok = t.l.s === 3 ? t.close >= NO_BIKE_SHARE * pts.length : t.near >= SHARE * pts.length;
      // Bikes allowed beats official beats not for bikes, when two sources overlap.
      if (ok && (!pick || [0, 3, 1, 2][t.l.s] < [0, 3, 1, 2][pick.s] || t.l.s === pick.s && t.near > pick.near)) pick = { s: t.l.s, l: t.l, near: t.near };
    });
    return pick ? { s: pick.s, why: why(pick.l) } : null;
  }

  function why(l) {
    const src = NAMES[l.src] || l.src, name = l.name ? ` “${l.name}”` : "";
    const extra = !l.note || l.src === "bc" || l.src === "ab" ? "" : l.src === "qc" ? ` in the ${l.note}` : `, run by ${l.note}`;
    if (l.s === 1) return `listed by ${src}${name ? " as" + name : ""}${extra}, with bikes allowed`;
    if (l.s === 2) return `listed by ${src} as an official trail${name}${extra}; it doesn't say whether bikes are allowed`;
    return `${src} lists this trail${name} for ${l.note || "other uses"}, not for bikes.`;
  }
  const NAMES = { on: "Ontario Trails", qc: "Sépaq", bc: "Recreation Sites and Trails BC", ab: "Alberta designated trails", pc: "Parks Canada", ott: "the City of Ottawa" };

  window.tfOfficial = { load, match, onChange: (fn) => listeners.push(fn) };
})();
