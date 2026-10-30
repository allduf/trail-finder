// Route there (Fishing): the most sensible way to walk to a fishing spot (alex 2026-10-25: "if there is trails close
// to it use those and analyse what should be the best path to take regarding the geography, the slope, the ground
// type"). The ↗ Route button on a spot card (fishing.js) builds it:
//  - From you when you're within WALK_KM of the spot, else from the best place to leave the car: the street, forest
//    road or parking lot with the easiest walk in (a 4x4 track counts, but costs a little more than a street).
//  - A grid of about 10 m cells over the area, each with the ground there and its height:
//    ground from OpenStreetMap through OpenFreeMap's vector tiles (the same free tiles as the 3D map's names, all of
//    Canada, cached by the browser): forest, grass and meadow, brush, wetland, rock, scree, ice, sand, fields, water,
//    streams and rivers, and every road, track and path; BC's forest roads when the Forest roads layer has loaded.
//    Heights from AWS Terrain Tiles (as Plan a route and Hunting): slope along each step and across the hillside.
//  - The walk is the fastest one, by time: Tobler's hiking speed for the slope of each step (about 5 km/h on the
//    flat, slower up and steep down), slowed by the ground (twice as slow in forest, 3x in brush, 5x in a swamp),
//    roads and paths at full speed, a creek costs a minute to cross and a river a quarter of an hour, open water and
//    cliffs (over 45°) can't be crossed. So it takes the trails when they help and cuts across when that's quicker.
//  - A spot out on a lake or river ends at the shore that's easiest to reach, not the nearest one.
// The card shows the distance, the time, the climb, how much is off trail and through what, and step by step;
// ▶ Go follows it in Ride mode (navigate.js) with the off-route alert, Drive there opens the phone's maps app.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isFish = () => document.body.classList.contains("sport-fish");
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const R = 6371008.8, RAD = Math.PI / 180, WORLD = 2 * Math.PI * R;
  const metres = (a, b) => map.distance(a, b);
  const fmtM = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);
  const fmtT = (s) => { const m = Math.max(1, Math.round(s / 60 / 5) * 5 || Math.round(s / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
  const WALK_KM = 5;            // closer than this, the walk starts where you are
  const CELL_M = 10;            // grid cell, bigger for a big area (MAX_CELLS)
  const MAX_CELLS = 420000;
  const ACC = "#0c8599", OFF = "#e8590c";

  // ---------- vector tiles (OpenFreeMap, OpenMapTiles layers), zoom 14 ----------
  // A small Mapbox Vector Tile reader: the layers below, each feature's tags and its geometry in tile units.
  const TZ = 14, WANT = new Set(["landcover", "landuse", "park", "water", "waterway", "transportation", "transportation_name", "poi"]);
  function readTile(buf) {
    const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), td = new TextDecoder();
    let p = 0;
    const varint = () => { let v = 0, s = 1, x; do { x = b[p++]; v += (x & 0x7f) * s; s *= 128; } while (x & 0x80); return v; };
    const skip = (w) => { if (w === 0) varint(); else if (w === 1) p += 8; else if (w === 2) { const n = varint(); p += n; } else if (w === 5) p += 4; };
    const zz = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);
    const out = {};
    while (p < b.length) {
      const k = varint();
      if (k >> 3 !== 3 || (k & 7) !== 2) { skip(k & 7); continue; }
      const end = varint() + p;
      let name = "", extent = 4096;
      const keys = [], vals = [], feats = [];
      while (p < end) {
        const t = varint(), f = t >> 3;
        if (f === 1) { const n = varint(); name = td.decode(b.subarray(p, p + n)); p += n; }
        else if (f === 2) { const n = varint(); feats.push([p, p + n]); p += n; }
        else if (f === 3) { const n = varint(); keys.push(td.decode(b.subarray(p, p + n))); p += n; }
        else if (f === 4) {
          const ve = varint() + p; let v = null;
          while (p < ve) {
            const vt = varint(), vf = vt >> 3;
            if (vf === 1) { const n = varint(); v = td.decode(b.subarray(p, p + n)); p += n; }
            else if (vf === 2) { v = dv.getFloat32(p, true); p += 4; }
            else if (vf === 3) { v = dv.getFloat64(p, true); p += 8; }
            else if (vf === 4 || vf === 5) v = varint();
            else if (vf === 6) v = zz(varint());
            else if (vf === 7) v = !!varint();
            else skip(vt & 7);
          }
          vals.push(v);
        } else if (f === 5) extent = varint();
        else skip(t & 7);
      }
      p = end;
      if (!WANT.has(name)) continue;
      const list = (out[name] = []), save = p;
      for (const [fs, fe] of feats) {
        p = fs;
        const tags = {}; let type = 0, geom = [];
        while (p < fe) {
          const t = varint(), f = t >> 3;
          if (f === 2) { const ge = varint() + p; while (p < ge) { const kk = varint(), vv = varint(); tags[keys[kk]] = vals[vv]; } }
          else if (f === 3) type = varint();
          else if (f === 4) {
            const ge = varint() + p; let x = 0, y = 0, cur = null;
            while (p < ge) {
              const c = varint(), id = c & 7, n = c >> 3;
              if (id === 7) { if (cur && cur.length) cur.push(cur[0]); continue; }
              for (let i = 0; i < n; i++) {
                x += zz(varint()); y += zz(varint());
                if (id === 1) { cur = []; geom.push(cur); }
                cur.push([x / extent, y / extent]);
              }
            }
          } else skip(t & 7);
        }
        list.push({ type, tags, geom });
      }
      p = save;
    }
    return out;
  }
  let tileUrl = null;
  const tileCache = new Map();   // "x/y" -> promise of the read tile, or null
  async function tileTemplate() {
    if (!tileUrl) tileUrl = fetch("https://tiles.openfreemap.org/planet").then((r) => r.json()).then((j) => j.tiles[0]).catch(() => { tileUrl = null; return null; });
    return tileUrl;
  }
  function vtile(x, y) {
    const k = `${x}/${y}`;
    if (!tileCache.has(k)) tileCache.set(k, tileTemplate().then((t) => {
      if (!t) return null;
      return fetch(t.replace("{z}", TZ).replace("{x}", x).replace("{y}", y), { signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined })
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))).then(readTile);
    }).catch(() => { tileCache.delete(k); return null; }));
    return tileCache.get(k);
  }

  // ---------- terrain heights (AWS Terrain Tiles, Terrarium colour code) ----------
  const dem = new Map();
  function demTile(z, x, y) {
    const k = `${z}/${x}/${y}`;
    if (!dem.has(k)) dem.set(k, (async () => {
      try {
        const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`);
        if (!r.ok) return null;
        const bm = await createImageBitmap(await r.blob());
        const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
        const cx = cv.getContext("2d", { willReadFrequently: true });
        cx.imageSmoothingEnabled = false;
        cx.drawImage(bm, 0, 0);
        const px = cx.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
        for (let i = 0; i < e.length; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        return e;
      } catch { return null; }
    })().then((e) => { if (e) dem.set(k, e); else dem.delete(k); return e; }));
    return dem.get(k);
  }

  // ---------- the grid ----------
  // Positions are Web Mercator, 0..1 across the world (x east, y south); a cell is cs of that, about CELL_M metres.
  const mx = (lon) => (lon + 180) / 360;
  const my = (lat) => { const s = Math.sin(lat * RAD); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
  const unx = (x) => x * 360 - 180;
  const uny = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD;

  // Ground classes: [name for the steps, how much slower than a path (x), shown colour]
  const G = { unk: 0, forest: 1, grass: 2, brush: 3, wet: 4, rock: 5, scree: 6, ice: 7, sand: 8, field: 9, built: 10, water: 11 };
  // alex (2026-10-26, Lesser Garibaldi Lake): take the trails over walking in the forest. Off trail is several times
  // slower than a path (a BC bushwhack is about 1 km/h), so a long trail from the trailhead beats a short cut through
  // the trees, and the route leaves the trail only for the last bit where no trail goes.
  const GROUND = [["the bush", 6], ["forest", 6], ["open grass", 3], ["brush", 10], ["wetland", 15], ["rock", 4], ["scree", 8], ["snow and ice", 10],
    ["sand", 3], ["fields", 4], ["a built-up area", 3], ["water", Infinity]];
  // Lines: 1 street, 2 track or forest road, 3 path, 4 steps, 5 main road, 6 motorway
  const L_STREET = 1, L_TRACK = 2, L_PATH = 3, L_STEPS = 4, L_MAIN = 5, L_MOTOR = 6;
  const LINE_X = [0, 1.0, 1.05, 1.1, 1.6, 1.15, 25];
  const F_STREAM = 1, F_RIVER = 2, F_BRIDGE = 4, F_PARK = 8;

  function groundOf(layer, t) {
    const c = t.class || "", s = t.subclass || "";
    if (layer === "water") return t.intermittent ? G.wet : G.water;
    if (layer === "landcover") {
      if (c === "wood") return G.forest;
      if (c === "wetland") return G.wet;
      if (c === "ice") return G.ice;
      if (c === "sand") return G.sand;
      if (c === "farmland") return G.field;
      if (c === "rock") return s === "scree" || s === "shingle" ? G.scree : G.rock;
      if (c === "grass") return /^(scrub|heath|shrubbery|fell|tundra)$/.test(s) ? G.brush : G.grass;
    }
    if (layer === "landuse") {
      if (/^(residential|commercial|industrial|retail|railway|military|garages|cemetery|school|university|college|hospital)$/.test(c)) return G.built;
      if (c === "quarry") return G.scree;
    }
    return -1;
  }
  function lineOf(t) {
    const c = t.class || "", s = t.subclass || "";
    if (t.brunnel === "tunnel" || /^(rail|transit|ferry|aerialway|bus_guideway|busway|raceway)$/.test(c) || t.access === "no" || t.indoor) return 0;
    if (/^(motorway|trunk)$/.test(c)) return L_MOTOR;
    if (/^(primary|secondary)$/.test(c)) return L_MAIN;
    if (/^(tertiary|minor|service)$/.test(c)) return L_STREET;
    if (c === "track") return L_TRACK;
    if (c === "path") return s === "steps" ? L_STEPS : L_PATH;
    if (c === "pier") return L_PATH;
    return 0;
  }

  // A grid over the box [west x, north y, east x, south y] (mercator), with the ground, lines and heights painted in.
  // extra: more lines to walk on, [{ pts: [[lat, lon], ...], name }] (Skiing's cabin trips: the ski routes, which the
  // vector tiles don't have).
  async function buildGrid(box, onStep, extra) {
    const latMid = uny((box[1] + box[3]) / 2), mPer = WORLD * Math.cos(latMid * RAD);   // metres per mercator unit here
    let cs = CELL_M / mPer, W = Math.ceil((box[2] - box[0]) / cs), H = Math.ceil((box[3] - box[1]) / cs);
    if (W * H > MAX_CELLS) { const k = Math.sqrt((W * H) / MAX_CELLS); cs *= k; W = Math.ceil((box[2] - box[0]) / cs); H = Math.ceil((box[3] - box[1]) / cs); }
    const N = W * H, g = { W, H, cs, x0: box[0], y0: box[1], cellM: cs * mPer,
      ground: new Uint8Array(N), line: new Uint8Array(N), flag: new Uint8Array(N), name: new Uint16Array(N), names: [""], parks: [], h: new Float32Array(N), grad: new Float32Array(N), hasH: false };
    // Vector tiles over the box.
    const n = 2 ** TZ, tx0 = Math.floor(box[0] * n), tx1 = Math.floor(box[2] * n), ty0 = Math.floor(box[1] * n), ty1 = Math.floor(box[3] * n);
    const jobs = [];
    for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) jobs.push(vtile(x, y).then((t) => ({ x, y, t })));
    // Heights: zoom 14 if that's few enough tiles, else 13 or 12.
    let dz = navigator.onLine ? 14 : 12;   // offline: the zoom Offline maps saves (fishing.js tfFishOffline)
    for (; dz > 11; dz--) { const m = 2 ** dz; if ((Math.floor(box[2] * m) - Math.floor(box[0] * m) + 1) * (Math.floor(box[3] * m) - Math.floor(box[1] * m) + 1) <= 30) break; }
    const dm = 2 ** dz, djobs = [];
    for (let x = Math.floor(box[0] * dm); x <= Math.floor(box[2] * dm); x++) for (let y = Math.floor(box[1] * dm); y <= Math.floor(box[3] * dm); y++) djobs.push(demTile(dz, x, y));
    const tiles = await Promise.all(jobs);
    onStep && onStep("terrain");
    await Promise.all(djobs);
    if (!tiles.some((t) => t.t)) throw new Error("tiles");

    // Painting: polygons by even-odd scanlines, lines by stepping half a cell.
    const toCell = (tx, ty, p) => [((tx + p[0]) / n - g.x0) / cs, ((ty + p[1]) / n - g.y0) / cs];
    function fillPoly(rings, fn) {
      let ymin = Infinity, ymax = -Infinity;
      for (const r of rings) for (const p of r) { if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; }
      const r0 = Math.max(0, Math.ceil(ymin - 0.5)), r1 = Math.min(H - 1, Math.floor(ymax - 0.5));
      const xs = [];
      for (let row = r0; row <= r1; row++) {
        const yc = row + 0.5; xs.length = 0;
        for (const r of rings) for (let i = 1; i < r.length; i++) {
          const a = r[i - 1], b = r[i];
          if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + ((yc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const c0 = Math.max(0, Math.ceil(xs[k] - 0.5)), c1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
          for (let c = c0; c <= c1; c++) fn(row * W + c);
        }
      }
    }
    function strokeLine(pts, fn) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2));
        for (let s = 0; s <= steps; s++) {
          const c = Math.floor(a[0] + ((b[0] - a[0]) * s) / steps), r = Math.floor(a[1] + ((b[1] - a[1]) * s) / steps);
          if (c >= 0 && r >= 0 && c < W && r < H) fn(r * W + c);
        }
      }
    }
    const nameId = new Map();
    const nameOf = (s) => { if (!s) return 0; if (!nameId.has(s)) { if (g.names.length > 65000) return 0; nameId.set(s, g.names.length); g.names.push(s); } return nameId.get(s); };
    // Ground first (landuse under landcover under water), then waterways, then the lines on top.
    for (const layer of ["landuse", "landcover", "water"]) for (const { x, y, t } of tiles) {
      if (!t || !t[layer]) continue;
      for (const f of t[layer]) {
        if (f.type !== 3) continue;
        const v = groundOf(layer, f.tags);
        if (v < 0) continue;
        fillPoly(f.geom.map((r) => r.map((p) => toCell(x, y, p))), (i) => { g.ground[i] = v; });
      }
    }
    for (const { x, y, t } of tiles) {
      if (!t || !t.waterway) continue;
      for (const f of t.waterway) {
        if (f.type !== 2 || f.tags.brunnel === "tunnel") continue;
        const fl = f.tags.class === "river" ? F_RIVER : /^(stream|canal|drain|ditch)$/.test(f.tags.class) ? F_STREAM : 0;
        if (fl) for (const r of f.geom) strokeLine(r.map((p) => toCell(x, y, p)), (i) => { g.flag[i] |= fl; });
      }
    }
    const putLine = (v, bridge, nm) => (i) => { if (!g.line[i] || LINE_X[v] < LINE_X[g.line[i]]) { g.line[i] = v; if (nm) g.name[i] = nm; } if (bridge) g.flag[i] |= F_BRIDGE; };
    for (const { x, y, t } of tiles) {
      if (!t || !t.transportation) continue;
      for (const f of t.transportation) {
        const v = f.type === 2 ? lineOf(f.tags) : 0;
        if (v) for (const r of f.geom) strokeLine(r.map((p) => toCell(x, y, p)), putLine(v, f.tags.brunnel === "bridge", 0));
      }
    }
    for (const { x, y, t } of tiles) {   // names along the lines (the name layer holds the same lines, with names)
      if (!t || !t.transportation_name) continue;
      for (const f of t.transportation_name) {
        if (f.type !== 2 || !f.tags.name) continue;
        const nm = nameOf(f.tags.name);
        for (const r of f.geom) strokeLine(r.map((p) => toCell(x, y, p)), (i) => { if (g.line[i] && !g.name[i]) g.name[i] = nm; });
      }
      for (const f of t.poi || []) {   // parking lots: a good place to leave the car
        if (f.type !== 1 || f.tags.class !== "parking") continue;
        for (const r of f.geom) for (const p of r) { const [c0, r0] = toCell(x, y, p).map(Math.floor), k = Math.max(1, Math.round(25 / g.cellM));   // the lot, not one point
          if (f.tags.name) g.parks.push([c0, r0, f.tags.name]);
          for (let rr = r0 - k; rr <= r0 + k; rr++) for (let c = c0 - k; c <= c0 + k; c++) if (c >= 0 && rr >= 0 && c < W && rr < H) g.flag[rr * W + c] |= F_PARK; }
      }
    }
    // BC forest roads (index.html's Forest roads files) when they've loaded: many aren't in OpenStreetMap.
    const nav = window.tfNav, roads = nav && nav.roads ? nav.roads() : [];
    const ll = (q) => [(mx(q[1]) - g.x0) / cs, (my(q[0]) - g.y0) / cs];
    for (const r of roads) {
      const gm = r.geom; if (!gm || gm.length < 2) continue;
      const b0 = gm[0], b1 = gm[gm.length - 1];
      if (Math.max(my(b0[0]), my(b1[0])) < box[1] - 0.001 && Math.min(my(b0[0]), my(b1[0])) > box[3] + 0.001) continue;
      const shut = /^(closed|impass)$/.test(r.st || "");
      strokeLine(gm.map(ll), putLine(shut ? L_PATH : L_TRACK, false, nameOf(r.name || "")));
    }
    for (const e of extra || []) if (e.pts && e.pts.length > 1) strokeLine(e.pts.map(ll), putLine(L_PATH, false, nameOf(e.name || "")));

    // Heights at each cell's middle, then the steepness of the ground there (for side-hills and cliffs).
    const px = (X, Y) => {
      const tx = Math.floor(X / 256), ty = Math.floor(Y / 256), e = dem.get(`${dz}/${tx}/${ty}`);
      return e instanceof Float32Array ? e[(Y - ty * 256) * 256 + (X - tx * 256)] : NaN;
    };
    let ok = 0;
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const X = (g.x0 + (c + 0.5) * cs) * dm * 256 - 0.5, Y = (g.y0 + (r + 0.5) * cs) * dm * 256 - 0.5, x = Math.floor(X), y = Math.floor(Y), u = X - x, v = Y - y;
      const h = (px(x, y) * (1 - u) + px(x + 1, y) * u) * (1 - v) + (px(x, y + 1) * (1 - u) + px(x + 1, y + 1) * u) * v;
      g.h[r * W + c] = h; if (h === h) ok++;
    }
    g.hasH = ok > N * 0.8;
    if (g.hasH) {
      const at = (r, c) => { const v = g.h[Math.min(H - 1, Math.max(0, r)) * W + Math.min(W - 1, Math.max(0, c))]; return v === v ? v : 0; };
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const dx = (at(r, c + 1) - at(r, c - 1)) / (2 * g.cellM), dy = (at(r + 1, c) - at(r - 1, c)) / (2 * g.cellM);
        g.grad[r * W + c] = Math.hypot(dx, dy);
      }
    }
    return g;
  }

  // ---------- the search ----------
  // Seconds to walk from cell a to the next cell b, d metres away (Infinity: can't).
  // Seconds to walk from cell a to the next cell b, d metres away (Infinity: can't).
  const blocked = (g, i) => !g.line[i] && !(g.flag[i] & F_BRIDGE) && (g.ground[i] === G.water || (g.hasH && g.grad[i] > 1.2));   // open water, a cliff
  function stepCost(g, a, b, d) {
    if (blocked(g, a) || blocked(g, b)) return Infinity;
    const la = g.line[a], lb = g.line[b], on = la && lb;
    let x = on ? (LINE_X[la] + LINE_X[lb]) / 2 : ((la ? 1.1 : GROUND[g.ground[a]][1]) + (lb ? 1.1 : GROUND[g.ground[b]][1])) / 2;
    let s = 0;
    if (g.hasH) {
      const ha = g.h[a], hb = g.h[b];
      if (ha === ha && hb === hb) s = (hb - ha) / d;
      if (on) s = Math.max(-0.35, Math.min(0.35, s));   // a mapped path's switchbacks are finer than the grid
      else {
        if (Math.abs(s) > 1) return Infinity;           // over 45° straight up or down
        const gr = Math.max(la ? 0 : g.grad[a], lb ? 0 : g.grad[b]);
        if (gr > 0.6) x *= 1 + (gr - 0.6) * 4;          // steep side-hill, even walking across it
      }
    }
    const v = (6 * Math.exp(-3.5 * Math.abs(s + 0.05))) / 3.6;   // Tobler's hiking function, m/s
    let t = (d / v) * x;
    if (!lb && !(g.flag[b] & F_BRIDGE)) {
      if ((g.flag[b] & F_RIVER) && !(g.flag[a] & F_RIVER)) t += 900;
      else if ((g.flag[b] & F_STREAM) && !(g.flag[a] & F_STREAM)) t += 60;
    }
    return t;
  }
  // Binary heap of cell numbers by cost.
  function Heap() {
    const k = [], v = [];
    return {
      get size() { return k.length; },
      push(key, val) { let i = k.length; k.push(key); v.push(val); while (i) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = key; v[i] = val; },
      pop() {
        const top = v[0], lk = k.pop(), lv = v.pop(), n = k.length;
        if (n) {
          let i = 0;
          for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; }
          k[i] = lk; v[i] = lv;
        }
        return top;
      },
      peek() { return k[0]; },
    };
  }
  const cellAt = (g, lat, lon) => { const c = Math.floor((mx(lon) - g.x0) / g.cs), r = Math.floor((my(lat) - g.y0) / g.cs); return c >= 0 && r >= 0 && c < g.W && r < g.H ? r * g.W + c : -1; };
  const cellLL = (g, i) => [uny(g.y0 + (Math.floor(i / g.W) + 0.5) * g.cs), unx(g.x0 + ((i % g.W) + 0.5) * g.cs)];
  // Where to leave the car, and what it costs (seconds): a parking lot (trailheads have one) first, then a street, then a
  // 4x4 track (often an old logging road that isn't drivable any more).
  // goal.track: what starting on a track costs instead (Skiing: logging roads aren't plowed in winter).
  const drivable = (g, i, goal) => (g.flag[i] & F_PARK ? 0 : g.line[i] === L_STREET || g.line[i] === L_MAIN ? 300 : g.line[i] === L_TRACK ? (goal && goal.track) || 1200 : -1);

  // The search runs back from the spot, so one search finds the best start of many (roads) as well as one (you).
  // Spot on water: it starts from the shores around it (searched through the water up to SHORE_M), each one costing
  // a little for its distance from the spot, so the easy shore wins over the closest.
  const SHORE_M = 2000;
  function search(g, spotLL, goal) {
    const N = g.W * g.H, cost = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), heap = Heap();
    const s0 = cellAt(g, spotLL[0], spotLL[1]);
    if (s0 < 0) return null;
    const W = g.W, dirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    const onWater = blocked(g, s0);   // water, or a spot on a rock face: the nearest open ground around it
    if (onWater) {
      const seen = new Uint8Array(N), q = [s0]; seen[s0] = 1;
      const lim = (SHORE_M / g.cellM) ** 2, r0 = Math.floor(s0 / W), c0 = s0 % W;
      for (let k = 0; k < q.length; k++) {
        const i = q[k], r = Math.floor(i / W), c = i % W;
        for (const [dr, dc] of dirs.slice(0, 4)) {
          const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= g.H || cc >= W) continue;
          const j = rr * W + cc; if (seen[j]) continue; seen[j] = 1;
          if ((rr - r0) ** 2 + (cc - c0) ** 2 > lim) continue;
          if (blocked(g, j)) q.push(j);
          else { const d = Math.hypot(rr - r0, cc - c0) * g.cellM, t = d * 0.25; if (t < cost[j]) { cost[j] = t; heap.push(t, j); } }
        }
      }
      if (!heap.size) return { water: true };
    } else { cost[s0] = 0; heap.push(0, s0); }
    // A* toward you (the estimate never overstates: 6 km/h is the fastest walk), plain Dijkstra toward the roads.
    // Reaching within 30 m of you counts (a GPS fix can sit in a creek or on a rock face).
    const gc = goal.you ? cellAt(g, goal.you[0], goal.you[1]) : -1, near = Math.max(1, Math.round(30 / g.cellM));
    const gr = gc >= 0 ? Math.floor(gc / W) : 0, gcc = gc >= 0 ? gc % W : 0, vmax = 6 / 3.6;
    const hEst = (i) => (gc < 0 ? 0 : Math.max(0, Math.hypot(Math.floor(i / W) - gr, (i % W) - gcc) - near) * g.cellM / vmax);
    const isGoal = (i) => (gc >= 0 ? Math.abs(Math.floor(i / W) - gr) <= near && Math.abs((i % W) - gcc) <= near : drivable(g, i, goal) >= 0);
    if (goal.you && gc < 0) return null;
    const open = Heap();
    while (heap.size) { const i = heap.pop(); open.push(cost[i] + hEst(i), i); }
    let best = -1, bestCost = Infinity, edge = Infinity;   // edge: the cheapest walk that reached the grid's edge
    const done = new Uint8Array(N);
    while (open.size) {
      if (open.peek() >= bestCost) break;
      const i = open.pop();
      if (done[i]) continue;
      done[i] = 1;
      if (cost[i] < edge) { const r = Math.floor(i / W), c = i % W; if (!r || !c || r === g.H - 1 || c === W - 1) edge = cost[i]; }
      if (isGoal(i)) {
        const tot = cost[i] + (gc >= 0 ? 0 : drivable(g, i, goal));
        if (tot < bestCost) { bestCost = tot; best = i; }
        if (gc >= 0) break;
      }
      const r = Math.floor(i / W), c = i % W;
      for (const [dr, dc] of dirs) {
        const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= g.H || cc >= W) continue;
        const j = rr * W + cc; if (done[j]) continue;
        const t = stepCost(g, j, i, dr && dc ? g.cellM * Math.SQRT2 : g.cellM);   // walking from j toward the spot
        if (t === Infinity) continue;
        const nc = cost[i] + t;
        if (nc < cost[j]) { cost[j] = nc; prev[j] = i; open.push(nc + hEst(j), j); }
      }
    }
    if (best < 0) return null;
    const cells = [];
    for (let i = best; i >= 0; i = prev[i]) cells.push(i);   // from the start to the spot (or its shore)
    return { cells, time: cost[best], shore: onWater && g.ground[s0] === G.water, startCost: bestCost - cost[best], edge: edge < bestCost };
  }

  // ---------- from cells to a route ----------
  // Pieces: runs of the same kind (road / trail / off trail through one ground), simplified, with their names.
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let md = 0, mi = -1;
      const A = pts[a], B = pts[b], dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy;
      for (let i = a + 1; i < b; i++) {
        const P = pts[i], u = L2 ? Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / L2)) : 0;
        const d = Math.hypot(P[0] - A[0] - u * dx, P[1] - A[1] - u * dy);
        if (d > md) { md = d; mi = i; }
      }
      if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function describe(g, res) {
    const kindOf = (i) => (g.line[i] ? (g.line[i] === L_PATH || g.line[i] === L_STEPS ? "path" : "road") : "off");
    // Off-trail runs shorter than 3 cells between two pieces of the same line are the grid missing a corner.
    const k = res.cells.map(kindOf);
    for (let i = 1; i < k.length - 1; i++) if (k[i] === "off") { let j = i; while (j < k.length && k[j] === "off") j++; if (j < k.length && j - i <= 3 && k[i - 1] !== "off") for (let m = i; m < j; m++) k[m] = k[i - 1]; i = j; }
    const runs = [];
    res.cells.forEach((c, i) => {
      const kind = k[i], nm = kind === "off" ? "" : g.names[g.name[c]] || "", last = runs[runs.length - 1];
      if (last && last.kind === kind && (kind === "off" || !nm || !last.name || nm === last.name)) { last.cells.push(c); if (nm && !last.name) last.name = nm; }
      else { if (last) last.cells.push(c); runs.push({ kind, name: nm, cells: [c] }); }
    });
    // Tiny named pieces (< 40 m) fold into the one before.
    for (let i = 1; i < runs.length; i++) if (runs[i].cells.length * g.cellM < 40 && runs[i].kind === runs[i - 1].kind) { runs[i - 1].cells.push(...runs[i].cells.slice(1)); runs.splice(i--, 1); }
    let up = 0, down = 0, ref = null, total = 0, offM = 0, creeks = 0, steep = 0;
    const offBy = new Map();
    for (const r of runs) {
      let m = 0;
      const pts = r.cells.map((c) => cellLL(g, c));
      for (let i = 1; i < r.cells.length; i++) {
        const a = r.cells[i - 1], b = r.cells[i], d = metres(pts[i - 1], pts[i]);
        m += d;
        if (r.kind === "off") {
          const gb = g.ground[b]; offBy.set(gb, (offBy.get(gb) || 0) + d);
          if (g.hasH && d > 0) steep = Math.max(steep, Math.atan(Math.abs(g.h[b] - g.h[a]) / d) / RAD);
          if (!g.line[b] && (g.flag[b] & (F_STREAM | F_RIVER)) && !(g.flag[a] & (F_STREAM | F_RIVER))) creeks++;
        }
      }
      r.m = m; total += m; if (r.kind === "off") offM += m;
      let rUp = 0, rDown = 0;
      for (const c of r.cells) {
        const h = g.h[c]; if (!(h === h)) continue;
        if (ref == null) ref = h;
        if (h - ref >= 4) { up += h - ref; rUp += h - ref; ref = h; } else if (ref - h >= 4) { down += ref - h; rDown += ref - h; ref = h; }
      }
      r.up = Math.round(rUp); r.down = Math.round(rDown);
      r.ground = r.kind === "off" ? [...r.cells.reduce((mm, c) => mm.set(g.ground[c], (mm.get(g.ground[c]) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1])[0][0] : null;
      r.pts = simplify(pts.map((p) => [my(p[0]) / g.cs, mx(p[1]) / g.cs]), 0.7).map(([y, x]) => [uny(y * g.cs), unx(x * g.cs)]);
    }
    return { runs, total, offM, offBy, creeks, steep: Math.round(steep), up: Math.round(up), down: Math.round(down), time: res.time };
  }

  // ---------- building one ----------
  const boxAround = (pts, padM) => {
    let w = 1, e = 0, n = 1, s = 0;
    for (const [lat, lon] of pts) { const x = mx(lon), y = my(lat); w = Math.min(w, x); e = Math.max(e, x); n = Math.min(n, y); s = Math.max(s, y); }
    const pad = padM / (WORLD * Math.cos(pts[0][0] * RAD));
    return [w - pad, n - pad, e + pad, s + pad];
  };
  // A route that reached the grid's edge for less than it cost might do better outside it (a trail that loops out), so
  // the grid grows and it's worked out again: from you, padded more; from the road, 1.5 km round the spot, then 4, then 7
  // (alex's Cheakamus Lake: the trail from the trailhead is 6 km, while a ski-hill road 2 km away sits 1000 m above).
  // from.radii and from.lines (cabin-trip.js): other sizes for the road search, and more lines to walk on.
  async function build(spotLL, from, onStep) {
    let got = null;
    if (from.you) {
      const d = metres(spotLL, from.you);
      for (const pad of [Math.max(400, d * 0.3), Math.max(1500, d * 0.8)]) {
        const g = await buildGrid(boxAround([spotLL, from.you], pad), onStep, from.lines);
        onStep && onStep("route");
        const res = search(g, spotLL, from);
        if (res && res.cells) { got = { g, res, from: "you" }; if (!res.edge) break; }
        else if (res && res.water) return { g, res, fail: "water" };
      }
      return got || { fail: "noway" };
    }
    for (const r of from.radii || [1500, 4000, 7000]) {
      const g = await buildGrid(boxAround([spotLL], r), onStep, from.lines);
      onStep && onStep("route");
      const res = search(g, spotLL, { track: from.track });
      if (res && res.water) return { g, res, fail: "water" };
      if (res && res.cells) {
        const i = res.cells[0];
        const park = !!(g.flag[i] & F_PARK), r0 = Math.floor(i / g.W), c0 = i % g.W;
        const lot = park && g.parks.filter((p) => Math.abs(p[0] - c0) <= 4 && Math.abs(p[1] - r0) <= 4)[0];
        got = { g, res, from: "road", park, parkName: lot ? lot[2] : "", track: g.line[i] === L_TRACK, roadName: g.names[g.name[i]] || "" };
        if (!res.edge) break;
      }
    }
    return got || { fail: "noroad" };
  }

  // ---------- on the map ----------
  map.createPane("fishRoute").style.zIndex = 615;
  map.getPane("fishRoute").style.pointerEvents = "none";
  const layer = L.layerGroup();
  function draw(route) {
    layer.clearLayers();
    for (const r of route.d.runs) L.polyline(r.pts, { pane: "fishRoute", color: "#fff", weight: 8, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false }).addTo(layer);
    for (const r of route.d.runs) L.polyline(r.pts, { pane: "fishRoute", color: r.kind === "off" ? OFF : ACC, weight: 4.5, opacity: 1, lineCap: "round", lineJoin: "round",
      dashArray: r.kind === "off" ? "7 7" : null, interactive: false }).addTo(layer);
    const a = route.d.runs[0].pts[0];
    L.circleMarker(a, { pane: "fishRoute", radius: 7, color: "#fff", weight: 2.5, fillColor: route.from === "you" ? "#1c7ed6" : "#343a40", fillOpacity: 1, interactive: false }).addTo(layer);
    const last = route.d.runs[route.d.runs.length - 1], z = last.pts[last.pts.length - 1];
    L.circleMarker(z, { pane: "fishRoute", radius: 5, color: "#fff", weight: 2, fillColor: ACC, fillOpacity: 1, interactive: false }).addTo(layer);
    if (!map.hasLayer(layer)) layer.addTo(map);
    const b = L.latLngBounds(route.d.runs.flatMap((r) => r.pts));
    if (route.spot) b.extend(route.spot);
    // The route in the map that's left above the phone's sheet (and below the map buttons), worked out by hand: Leaflet's
    // fitBounds padding is off on the rotatable map.
    const [tl, br] = phone() ? [[40, 120], [40, Math.round(map.getSize().y * 0.58)]] : [[60, 60], [60, 60]];
    setTimeout(() => {
      const z = Math.min(17, map.getBoundsZoom(b, false, L.point(tl[0] + br[0], tl[1] + br[1])));
      const c = map.project(b.getCenter(), z).add(L.point((br[0] - tl[0]) / 2, (br[1] - tl[1]) / 2));
      map.setView(map.unproject(c, z), z);
    }, 350);   // after the sheet has settled
  }

  // ---------- the card ----------
  const css = document.createElement("style");
  css.textContent = `
#fishPane .fs-routebtn { font: inherit; font-size: .78rem; font-weight: 800; border: 0; background: ${ACC}; color: #fff; cursor: pointer; height: 30px; padding: 0 11px 0 9px; border-radius: 999px; display: inline-flex; align-items: center; gap: 5px; flex: none; }
#fishPane .fs-routebtn svg { color: #fff !important; }
#fishPane .fs-routebtn:active { transform: scale(.97); }
#fishPane .fs-routebtn[aria-pressed="true"] { background: var(--chip); color: var(--fg); box-shadow: inset 0 0 0 1.5px ${ACC}; }
#fishPane .fs-routebtn[aria-pressed="true"] svg { color: ${ACC} !important; }
#fishPane .fr { border: 1.5px solid ${ACC}; border-radius: 12px; padding: 10px 11px; display: flex; flex-direction: column; gap: 8px; background: color-mix(in srgb, ${ACC} 6%, var(--panel)); }
#fishPane .fr-top { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
#fishPane .fr-top b { font-size: 1.05rem; }
#fishPane .fr-top span { font-size: .84rem; color: var(--muted); font-weight: 600; }
#fishPane .fr-bar { display: flex; height: 8px; border-radius: 99px; overflow: hidden; background: var(--line); }
#fishPane .fr-bar i { display: block; height: 100%; }
#fishPane .fr-legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: .74rem; color: var(--muted); font-weight: 600; }
#fishPane .fr-legend span::before { content: ""; display: inline-block; width: 14px; height: 0; border-top: 3px solid ${ACC}; vertical-align: 3px; margin-right: 5px; }
#fishPane .fr-legend span.off::before { border-top: 3px dashed ${OFF}; }
#fishPane .fr-from { display: flex; gap: 6px; }
#fishPane .fr-from button { font: inherit; font-size: .76rem; font-weight: 700; flex: 1; padding: 7px 6px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
#fishPane .fr-from button.on { background: ${ACC}; border-color: ${ACC}; color: #fff; }
#fishPane ol.fr-steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; counter-reset: fr; }
#fishPane ol.fr-steps li { display: grid; grid-template-columns: 22px 1fr; gap: 0 8px; font-size: .84rem; line-height: 1.3; }
#fishPane ol.fr-steps li::before { counter-increment: fr; content: counter(fr); width: 20px; height: 20px; border-radius: 50%; background: ${ACC}; color: #fff; font-size: .7rem; font-weight: 800; display: grid; place-items: center; }
#fishPane ol.fr-steps li.off::before { background: ${OFF}; }
#fishPane ol.fr-steps li small { grid-column: 2; color: var(--muted); font-size: .74rem; }
#fishPane .fr-btns { display: flex; gap: 6px; flex-wrap: wrap; }
#fishPane .fr-btns > * { font: inherit; font-size: .84rem; font-weight: 800; padding: 10px 14px; border-radius: 12px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
#fishPane .fr-btns .fr-go { background: ${ACC}; border-color: ${ACC}; color: #fff; flex: 1; justify-content: center; }
#fishPane .fr-warn { font-size: .76rem; color: var(--muted); margin: 0; line-height: 1.35; }
#fishPane .fr-wait { display: flex; align-items: center; gap: 8px; font-size: .84rem; color: var(--muted); }
#fishPane .fr-wait::before { content: ""; width: 14px; height: 14px; border-radius: 50%; border: 2px solid ${ACC}; border-right-color: transparent; animation: frspin .8s linear infinite; flex: none; }
@keyframes frspin { to { transform: rotate(360deg); } }`;
  document.head.append(css);
  const ROUTE_ICON = '<circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="5" r="2.2"/><path d="M8 19h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16" stroke-dasharray="3 2.6"/>';
  const svg = (d, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  // For fishing.js: the button on a spot card's header.
  const button = (lat, lon) => `<button type="button" class="fs-routebtn" data-fsroute="${lat.toFixed(6)},${lon.toFixed(6)}" aria-pressed="false" aria-label="Route to this spot">${svg(ROUTE_ICON)}Route</button>`;

  let cur = null, seq = 0;   // cur: { spot, name, from, d, g, ... }
  function clear() {
    seq++; cur = null; layer.clearLayers();
    const b = document.querySelector("#fsSpot [data-fsroute]"); if (b) b.setAttribute("aria-pressed", "false");
    const box = $("fsRoute"); if (box) box.innerHTML = "";
  }
  const here = () => new Promise((ok) => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition((p) => ok([p.coords.latitude, p.coords.longitude]), () => ok(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
  function slot() {
    let box = $("fsRoute");
    const card = $("fsSpot");
    if (!box && card) { box = document.createElement("div"); box.id = "fsRoute"; const h = card.querySelector("header"); if (h) h.after(box); else card.prepend(box); }
    return box;
  }
  async function start(spotLL, name, want) {
    const token = ++seq, box = slot();
    if (!box) return;
    const btn = document.querySelector("#fsSpot [data-fsroute]"); if (btn) btn.setAttribute("aria-pressed", "true");
    const wait = (t) => { if (token === seq) box.innerHTML = `<div class="fr"><div class="fr-wait">${t}</div></div>`; };
    wait("Finding you…");
    const you = want === "road" ? null : await here();
    if (token !== seq) return;
    const near = you && metres(you, spotLL) <= WALK_KM * 1000;
    const from = want === "you" && you ? "you" : want === "road" ? "road" : near ? "you" : "road";
    wait(from === "you" ? "Reading the trails, ground and water between you and the spot…" : "Looking for the easiest place to park and walk in…");
    let out;
    try { out = await build(spotLL, from === "you" ? { you } : {}, (s) => wait(s === "terrain" ? "Getting the terrain…" : "Working out the best way…")); }
    catch { out = { fail: "net" }; }
    if (token !== seq) return;
    if (out.fail) { failed(box, out.fail, from, you, spotLL, name); return; }
    cur = { spot: spotLL, name, from, you, d: describe(out.g, out.res), park: out.park, parkName: out.parkName, track: out.track, roadName: out.roadName, shore: out.res.shore, far: you && !near };
    draw(cur);
    render(box);
  }
  function failed(box, why, from, you, spotLL, name) {
    const msg = { water: "This spot is far out on the water: no shore within 2 km. Use a boat launch nearby.",
      noroad: "No road within 4 km of this spot that the map knows of. Try from your location, or pick a spot closer to a road or trail.",
      noway: "Couldn't find a way on foot from you to this spot (water or cliffs in the way, or it's too far). Try from the road.",
      net: "Couldn't get the map data for this area. Check your connection and try again." }[why];
    box.innerHTML = `<div class="fr"><p>${esc(msg)}</p>${fromHtml(from, you)}</div>`;
    bindFrom(box, spotLL, name);
  }
  const fromHtml = (from, you) => `<div class="fr-from" role="group" aria-label="Start from"><button type="button" data-from="you" class="${from === "you" ? "on" : ""}">From my location</button><button type="button" data-from="road" class="${from === "road" ? "on" : ""}">From the road</button></div>`;
  function bindFrom(box, spotLL, name) {
    box.querySelectorAll("[data-from]").forEach((b) => b.addEventListener("click", () => { if (!b.classList.contains("on")) start(spotLL, name, b.dataset.from); }));
  }
  function steps(c) {
    const d = c.d, out = [];
    const roadWord = (r) => (r.name ? esc(r.name) : r.kind === "road" ? "the road" : "the trail");
    d.runs.forEach((r, i) => {
      if (r.m < 25 && d.runs.length > 1) return;
      if (r.kind !== "off" && !r.name && r.m < 150 && d.runs.length > 2) return;   // short unnamed links between named trails
      const ud = [r.up >= 10 ? `up ${r.up} m` : "", r.down >= 10 ? `down ${r.down} m` : ""].filter(Boolean).join(", ");
      if (r.kind === "off") {
        const g = GROUND[r.ground] ? GROUND[r.ground][0] : "the bush";
        out.push(`<li class="off"><span>${i === d.runs.length - 1 && i ? "Leave the trail: " : i === 0 ? "Head off trail: " : "Cut across: "}<b>${fmtM(r.m)}</b> through ${esc(g)}</span>${ud ? `<small>${ud}</small>` : ""}</li>`);
      } else out.push(`<li><span>${r.kind === "road" ? "Walk" : "Take"} <b>${roadWord(r)}</b> for ${fmtM(r.m)}</span>${ud ? `<small>${ud}</small>` : ""}</li>`);
    });
    out.push(`<li><span>${c.shore ? "You're at the shore by the spot" : "You're at the spot"}</span></li>`);
    return out.join("");
  }
  function render(box) {
    const c = cur, d = c.d, onM = d.total - d.offM;
    const offWhat = [...d.offBy].filter(([, m]) => m >= 20).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => (GROUND[k] ? GROUND[k][0] : "")).filter(Boolean);
    const startTxt = c.from === "you" ? "From your location" : c.park ? (c.parkName ? `Park at ${/parking|trailhead|lot\b|stationnement/i.test(c.parkName) ? "" : "the parking for "}${esc(c.parkName)}` : `Park at the parking lot${c.roadName ? ` on ${esc(c.roadName)}` : ""}`) : `Park on ${c.roadName ? esc(c.roadName) : c.track ? "the track" : "the road"}`;
    const a = d.runs[0].pts[0];
    const ios = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
    const drive = ios ? `https://maps.apple.com/?daddr=${a[0].toFixed(5)},${a[1].toFixed(5)}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${a[0].toFixed(5)},${a[1].toFixed(5)}&travelmode=driving`;
    box.innerHTML = `<div class="fr">
      <div class="fr-top"><b>${fmtM(d.total)}</b><span>about ${fmtT(d.time)} on foot</span>${d.up >= 10 || d.down >= 10 ? `<span>↑${d.up} m ↓${d.down} m</span>` : ""}</div>
      <div class="fr-bar" aria-hidden="true"><i style="width:${(onM / d.total) * 100}%;background:${ACC}"></i><i style="width:${(d.offM / d.total) * 100}%;background:${OFF}"></i></div>
      <div class="fr-legend"><span>${fmtM(onM)} on trails and roads</span>${d.offM >= 10 ? `<span class="off">${fmtM(d.offM)} off trail${offWhat.length ? ` (${esc(offWhat.join(", "))})` : ""}</span>` : ""}</div>
      ${fromHtml(c.from, c.you)}
      <p class="fr-warn">${c.from === "road" ? `<b>${startTxt}.</b>` : ""}${c.from === "road" && c.far ? " You're more than 5 km away: drive there first." : ""}${d.creeks ? ` ${d.creeks === 1 ? "One creek" : `${d.creeks} creeks`} to cross.` : ""}${d.steep >= 25 ? ` Steepest bit off trail about ${d.steep}°.` : ""}</p>
      <ol class="fr-steps">${steps(c)}</ol>
      <div class="fr-btns"><button type="button" class="fr-go" data-fr="go">▶ Go</button>${c.from === "road" ? `<a href="${drive}" target="_blank" rel="noopener">Drive there</a>` : ""}<button type="button" data-fr="x" aria-label="Clear the route">✕</button></div>
      ${d.offM >= 10 ? `<p class="fr-warn">Off-trail parts (dashed) follow the terrain and OpenStreetMap's ground cover: check for private land, cliffs and high water on the way.</p>` : ""}
    </div>`;
    bindFrom(box, c.spot, c.name);
    box.querySelector('[data-fr="x"]').addEventListener("click", clear);
    box.querySelector('[data-fr="go"]').addEventListener("click", () => {
      if (!window.tfRide || !window.tfRide.follow) return;
      const parts = d.runs.filter((r) => r.m >= 25 || d.runs.length === 1).map((r) => ({ name: r.kind === "off" ? `Off trail, ${GROUND[r.ground] ? GROUND[r.ground][0] : "the bush"}` : r.name || (r.kind === "road" ? "Road" : "Trail"),
        color: r.kind === "off" ? OFF : ACC, lvl: "", kind: r.kind === "off" ? "gap" : "pick", pts: r.pts }));
      window.tfRide.follow(d.runs.map((r) => r.pts), c.name && c.name !== "This spot" ? c.name : "the fishing spot", parts);
    });
  }

  // The Route button on the spot card.
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("#fsSpot [data-fsroute]");
    if (!b) return;
    if (b.getAttribute("aria-pressed") === "true") { clear(); return; }
    const [lat, lon] = b.dataset.fsroute.split(",").map(Number), h = $("fsSpotName") || b.parentNode.querySelector("h3");
    start([lat, lon], h ? h.textContent.trim() : "", null);
  });
  window.addEventListener("tf:sport", () => { if (!isFish()) clear(); });
  window.tfFishRoute = { button, clear, start: (lat, lon, name, from) => start([lat, lon], name || "", from || null), _build: build, _describe: describe,
    groundName: (k) => (GROUND[k] ? GROUND[k][0] : "the bush") };   // cabin-trip.js: the way in to a hut
})();
