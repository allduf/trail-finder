// Adventure moto routes with no signal (alex 2026-10-27, from the competitor review: "do all"). moto.js plans with
// the online Valhalla server; out of signal it asks this file instead. The roads come from the maps already saved in
// Offline maps (offline.js): every saved area keeps OpenFreeMap's vector tiles down to z14, and their
// "transportation" layer holds every road and track with its class, surface and one-way, and
// "transportation_name" the names. So nothing more is downloaded or stored: a route reads the saved tiles around its
// points from the "tf-offline-1" cache, joins them into a road network, and finds the best way for the bike and the
// style (Most dirt, Mix, Paved back roads), with turn-by-turn words like the online router's.
// Phone memory: only the tiles in a box around the points are read (at most MAX_TILES), each tile's bytes are let go
// once read, and only the last network is kept (re-routing on the ride reuses it), in typed arrays.
// Loaded by moto.js (window.tfLoadMotoRoads) the first time a route has to be planned without the server.
(() => {
  "use strict";
  if (window.tfMotoRoads) return;
  const CACHE = "tf-offline-1", KEY = "tf-offline-areas", Z = 14;
  const MAX_TILES = 6000;   // one full saved area: about 15,000 km² of mountains
  const SNAP_M = 1500;      // a point further than this from any saved road can't be routed
  const JOIN_M = 15;        // a road end this close to another road joins it (tiles drop shared points)
  const RAD = Math.PI / 180;

  // ---------- saved areas ----------
  const areas = () => { try { return (JSON.parse(localStorage.getItem(KEY)) || []).filter((a) => !a.missing || a.sources); } catch { return []; } };
  const inBox = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
  const boxesOf = (a) => a.boxes || [a.box];
  const tmplOf = (a) => { const s = (a.sources || []).find((x) => /\.pbf/.test(x.tmpl) && x.maxz >= Z) || (a.sources || []).find((x) => x.maxz >= Z); return s && s.tmpl; };
  // Is the point inside a saved map?
  const covered = (p) => areas().some((a) => tmplOf(a) && boxesOf(a).some((b) => inBox(p, b)));

  // ---------- tile maths (global z14 pixels, 4096 to a tile) ----------
  const tx = (lon) => ((lon + 180) / 360) * 2 ** Z;
  const ty = (lat) => { const r = lat * RAD; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z; };
  const lonOf = (x) => (x / 2 ** Z) * 360 - 180;
  const latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) / RAD;
  const metres = (a, b) => { const kx = Math.cos(((a[0] + b[0]) / 2) * RAD) * 111320; return Math.hypot((b[1] - a[1]) * kx, (b[0] - a[0]) * 110540); };

  // The saved tiles in a box: [{ url, x, y }], from every area that has them, once each.
  function tilesIn(box) {
    const out = new Map(), x0 = Math.floor(tx(box[1])), x1 = Math.floor(tx(box[3])), y0 = Math.floor(ty(box[2])), y1 = Math.floor(ty(box[0]));
    for (const a of areas()) {
      const t = tmplOf(a);
      if (!t) continue;
      for (const b of boxesOf(a)) {
        if (b[0] > box[2] || b[2] < box[0] || b[1] > box[3] || b[3] < box[1]) continue;
        const bx0 = Math.max(x0, Math.floor(tx(b[1]))), bx1 = Math.min(x1, Math.floor(tx(b[3]))), by0 = Math.max(y0, Math.floor(ty(b[2]))), by1 = Math.min(y1, Math.floor(ty(b[0])));
        for (let x = bx0; x <= bx1; x++) for (let y = by0; y <= by1; y++) {
          const k = x + "/" + y;
          if (!out.has(k)) out.set(k, { url: t.replace("{z}", Z).replace("{x}", x).replace("{y}", y), x, y });
          if (out.size > MAX_TILES) return null;
        }
      }
    }
    return [...out.values()];
  }

  // ---------- reading a vector tile (Mapbox Vector Tile, protobuf) ----------
  function reader(buf) {
    let i = 0;
    const v = () => { let r = 0, s = 0, b; do { b = buf[i++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
    return {
      get i() { return i; }, set i(n) { i = n; },
      v,
      skip(w) { if (w === 0) v(); else if (w === 1) i += 8; else if (w === 2) { const n = v(); i += n; } else if (w === 5) i += 4; },
      str(n) { const s = new TextDecoder().decode(buf.subarray(i, i + n)); i += n; return s; },
      packed(n) { const end = i + n, out = []; while (i < end) out.push(v()); return out; },
    };
  }
  const WANT = { transportation: 1, transportation_name: 1 };
  // The road layers of one tile: { transportation: [{ tags, lines }], transportation_name: [...], extent }.
  function decode(buf) {
    const r = reader(buf), out = { transportation: [], transportation_name: [], extent: 4096 };
    while (r.i < buf.length) {
      const k = r.v(), f = k >> 3, w = k & 7;
      if (f !== 3 || w !== 2) { r.skip(w); continue; }
      const len = r.v(), end = r.i + len;
      let name = "", keys = [], vals = [], feats = [], extent = 4096;
      while (r.i < end) {
        const k2 = r.v(), f2 = k2 >> 3, w2 = k2 & 7;
        if (f2 === 1 && w2 === 2) name = r.str(r.v());
        else if (f2 === 3 && w2 === 2) keys.push(r.str(r.v()));
        else if (f2 === 5 && w2 === 0) extent = r.v();
        else if (f2 === 4 && w2 === 2) {
          const vend = r.v() + r.i; let val = null;
          while (r.i < vend) {
            const k3 = r.v(), f3 = k3 >> 3, w3 = k3 & 7;
            if (f3 === 1) val = r.str(r.v());
            else if (f3 === 4 || f3 === 5) val = r.v();
            else if (f3 === 6) { const n = r.v(); val = n % 2 ? -(n + 1) / 2 : n / 2; }
            else if (f3 === 7) val = !!r.v();
            else if (f3 === 2) { val = new DataView(buf.buffer, buf.byteOffset + r.i, 4).getFloat32(0, true); r.i += 4; }
            else if (f3 === 3) { val = new DataView(buf.buffer, buf.byteOffset + r.i, 8).getFloat64(0, true); r.i += 8; }
            else r.skip(w3);
          }
          vals.push(val);
        } else if (f2 === 2 && w2 === 2) {
          const fend = r.v() + r.i; let tags = [], geom = [], type = 0;
          while (r.i < fend) {
            const k3 = r.v(), f3 = k3 >> 3, w3 = k3 & 7;
            if (f3 === 2 && w3 === 2) tags = r.packed(r.v());
            else if (f3 === 4 && w3 === 2) geom = r.packed(r.v());
            else if (f3 === 3) type = r.v();
            else r.skip(w3);
          }
          if (type === 2) feats.push([tags, geom]);
        } else r.skip(w2);
      }
      if (!WANT[name]) continue;
      out.extent = extent;
      for (const [tags, geom] of feats) {
        const t = {};
        for (let j = 0; j + 1 < tags.length; j += 2) t[keys[tags[j]]] = vals[tags[j + 1]];
        out[name].push({ tags: t, lines: lines(geom) });
      }
    }
    return out;
  }
  // Geometry commands to lines of [x, y] (tile pixels).
  function lines(g) {
    const out = []; let x = 0, y = 0, i = 0, cur = null;
    while (i < g.length) {
      const c = g[i++], id = c & 7, n = c >> 3;
      if (id === 7) continue;
      for (let j = 0; j < n; j++) {
        const dx = g[i++], dy = g[i++];
        x += dx % 2 ? -(dx + 1) / 2 : dx / 2; y += dy % 2 ? -(dy + 1) / 2 : dy / 2;
        if (id === 1) { cur = [[x, y]]; out.push(cur); } else if (cur) cur.push([x, y]);
      }
    }
    return out;
  }
  // A line cut to the tile's own square (tiles overlap a little; each road is kept once, by the tile it's in).
  function clip(line, e) {
    const out = []; let cur = null;
    const inside = (p) => p[0] >= 0 && p[0] <= e && p[1] >= 0 && p[1] <= e;
    for (let i = 1; i < line.length; i++) {
      let a = line[i - 1], b = line[i], t0 = 0, t1 = 1;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      let ok = true;
      for (const [p, q] of [[-dx, a[0]], [dx, e - a[0]], [-dy, a[1]], [dy, e - a[1]]]) {
        if (p === 0) { if (q < 0) { ok = false; break; } continue; }
        const t = q / p;
        if (p < 0) { if (t > t1) { ok = false; break; } if (t > t0) t0 = t; } else { if (t < t0) { ok = false; break; } if (t < t1) t1 = t; }
      }
      if (!ok) { cur = null; continue; }
      const A = t0 ? [a[0] + t0 * dx, a[1] + t0 * dy] : a, B = t1 < 1 ? [a[0] + t1 * dx, a[1] + t1 * dy] : b;
      if (!cur || !inside(a) || t0) { cur = [A]; out.push(cur); }
      cur.push(B);
      if (t1 < 1) cur = null;
    }
    return out.filter((l) => l.length > 1);
  }

  // ---------- the road network ----------
  // Roads a plated bike may use. Paths, cycleways, footways, ferries and rail are left out.
  const CLASS = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, minor: 5, service: 6, track: 7 };
  const CLASS_NAME = Object.keys(CLASS);
  const KMH = [100, 90, 80, 70, 60, 45, 25, 22];
  async function bytesOf(cache, url) {
    const res = await cache.match(url);
    if (!res) return null;
    let buf = new Uint8Array(await res.arrayBuffer());
    if (buf[0] === 0x1f && buf[1] === 0x8b && window.DecompressionStream) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    return buf;
  }
  let last = null;   // { key, net, box, n }: the last network built, for re-routing on the same ride
  // Build the network of the saved tiles in a box. onProg(done, total) while reading.
  async function build(box, onProg) {
    if (last && last.n === areas().length && box[0] >= last.box[0] && box[1] >= last.box[1] && box[2] <= last.box[2] && box[3] <= last.box[3]) return last.net;   // a re-route inside the last one
    const tiles = tilesIn(box);
    if (!tiles) throw new Error("big");
    const key = tiles.map((t) => t.url).sort().join("|");
    if (last && last.key === key) return last.net;
    last = null;
    const cache = await caches.open(CACHE);
    // Points: one per distinct global pixel; ids in a Map only while building.
    const ids = new Map(), X = [], Y = [], ea = [], eb = [], ec = [], names = new Map();
    const node = (gx, gy) => { gx = Math.round(gx); gy = Math.round(gy); const k = gx * 67108864 + gy; let id = ids.get(k); if (id === undefined) { id = X.length; ids.set(k, id); X.push(gx); Y.push(gy); } return id; };
    const LINES = [];   // per road line: class*4 + surface (0 unknown, 1 paved, 2 unpaved) + oneway in bit 8/9
    let read = 0, found = 0;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      let d = null;
      try { const b = await bytesOf(cache, t.url); if (b) { d = decode(b); found++; } } catch (e) { /* a broken tile: its roads are missing */ }
      read++;
      if (onProg && (read % 40 === 0 || read === tiles.length)) { onProg(read, tiles.length); await new Promise((ok) => setTimeout(ok, 0)); }
      if (!d) continue;
      const s = 4096 / d.extent, ox = t.x * 4096, oy = t.y * 4096;
      for (const f of d.transportation) {
        const c = CLASS[f.tags.class];
        if (c === undefined || f.tags.access === "no" || f.tags.access === false) continue;
        const sf = f.tags.surface === "paved" ? 1 : f.tags.surface === "unpaved" ? 2 : 0, ow = +f.tags.oneway || 0;
        const li = LINES.length;
        LINES.push(c * 4 + sf + (ow === 1 ? 256 : ow === -1 ? 512 : 0));
        for (const l of f.lines.flatMap((x) => clip(x, d.extent))) {
          let prev = node(ox + l[0][0] * s, oy + l[0][1] * s);
          for (let j = 1; j < l.length; j++) {
            const n = node(ox + l[j][0] * s, oy + l[j][1] * s);
            if (n !== prev) { ea.push(prev); eb.push(n); ec.push(li); }
            prev = n;
          }
        }
      }
      for (const f of d.transportation_name) {
        const nm = f.tags.name || f.tags["name:latin"] || f.tags.name_en || (f.tags.ref ? `Highway ${f.tags.ref}` : "");
        if (!nm) continue;
        for (const l of f.lines) for (const p of l) names.set(Math.round(ox + p[0] * s) * 67108864 + Math.round(oy + p[1] * s), nm);
      }
    }
    if (!found) throw new Error("none");
    // Road ends with nothing there join the nearest road within JOIN_M (a junction point a tile left out).
    const deg = new Uint16Array(X.length), own = new Uint32Array(X.length);   // own: a road end's own road line
    for (let i = 0; i < ea.length; i++) { deg[ea[i]]++; deg[eb[i]]++; own[ea[i]] = own[eb[i]] = ec[i]; }
    const mpp = (40075016 * Math.cos(((box[0] + box[2]) / 2) * RAD)) / (2 ** Z * 4096);   // metres per global pixel
    const C = 64, grid = new Map(), joinPx = JOIN_M / mpp;
    for (let i = 0; i < ea.length; i++) {
      const a = ea[i], b = eb[i];
      for (let cx = Math.floor(Math.min(X[a], X[b]) / C); cx <= Math.floor(Math.max(X[a], X[b]) / C); cx++)
        for (let cy = Math.floor(Math.min(Y[a], Y[b]) / C); cy <= Math.floor(Math.max(Y[a], Y[b]) / C); cy++) { const k = cx * 1e6 + cy; let g = grid.get(k); if (!g) grid.set(k, (g = [])); g.push(i); }
    }
    const dead = new Uint8Array(ea.length), split = [];
    for (let n = 0; n < X.length; n++) {
      if (deg[n] !== 1) continue;
      let best = -1, bd = joinPx, bt = 0;
      const cx = Math.floor(X[n] / C), cy = Math.floor(Y[n] / C);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const e of grid.get((cx + i) * 1e6 + cy + j) || []) {
        const a = ea[e], b = eb[e];
        if (a === n || b === n || dead[e]) continue;
        const dx = X[b] - X[a], dy = Y[b] - Y[a], l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((X[n] - X[a]) * dx + (Y[n] - Y[a]) * dy) / l2)) : 0;
        const d = Math.hypot(X[a] + t * dx - X[n], Y[a] + t * dy - Y[n]);
        if (d < bd) { bd = d; best = e; bt = t; }
      }
      if (best < 0) continue;
      const a = ea[best], b = eb[best];
      let m = bt < 0.05 ? a : bt > 0.95 ? b : -1;
      if (m < 0) {   // split that road at the nearest point
        m = X.length; X.push(Math.round(X[a] + bt * (X[b] - X[a]))); Y.push(Math.round(Y[a] + bt * (Y[b] - Y[a])));
        dead[best] = 1; split.push([a, m, ec[best]], [m, b, ec[best]]);
      }
      if (m !== n) split.push([n, m, own[n]]);
    }
    split.forEach(([a, b, c]) => { ea.push(a); eb.push(b); ec.push(c); });
    ids.clear(); grid.clear();
    // Compact: adjacency (CSR) in typed arrays.
    const N = X.length, nx = Float64Array.from(X), ny = Float64Array.from(Y);
    const lat = new Float64Array(N), lon = new Float64Array(N);
    for (let i = 0; i < N; i++) { lat[i] = latOf(ny[i] / 4096); lon[i] = lonOf(nx[i] / 4096); }
    const start = new Uint32Array(N + 1);
    for (let i = 0; i < ea.length; i++) if (!dead[i]) { start[ea[i] + 1]++; start[eb[i] + 1]++; }
    for (let i = 0; i < N; i++) start[i + 1] += start[i];
    const fill = start.slice(0, N), to = new Uint32Array(start[N]), line = new Uint32Array(start[N]), dir = new Int8Array(start[N]), len = new Float32Array(start[N]);
    for (let i = 0; i < ea.length; i++) {
      if (dead[i]) continue;
      const a = ea[i], b = eb[i], m = metres([lat[a], lon[a]], [lat[b], lon[b]]);
      let k = fill[a]++; to[k] = b; line[k] = ec[i]; dir[k] = 1; len[k] = m;
      k = fill[b]++; to[k] = a; line[k] = ec[i]; dir[k] = -1; len[k] = m;
    }
    // Names per road line: the name most of its pieces carry.
    const lineName = new Array(LINES.length).fill(""), votes = new Map();
    for (let n = 0; n < N; n++) {
      const nm = names.get(nx[n] * 67108864 + ny[n]);
      if (!nm) continue;
      for (let k = start[n]; k < start[n + 1]; k++) {   // only a piece with the name at both ends (not a side road touching it)
        if (names.get(nx[to[k]] * 67108864 + ny[to[k]]) !== nm) continue;
        const vk = line[k] + "\u0000" + nm; votes.set(vk, (votes.get(vk) || 0) + 1);
      }
    }
    const top = new Map();
    votes.forEach((v, k) => { const [li, nm] = k.split("\u0000"); const t = top.get(+li); if (!t || v > t[1]) top.set(+li, [nm, v]); });
    top.forEach(([nm], li) => { lineName[li] = nm; });
    const net = { N, lat, lon, start, to, line, dir, len, LINES: Uint16Array.from(LINES), lineName, tiles: tiles.length, found };
    last = { key, net, box, n: areas().length };
    return net;
  }

  // ---------- costs ----------
  // Grade 1 paved to 5 very rough, as moto.js grades roads; tracks are 3, gravel 2, unknown surface counts as paved
  // on a main road and gravel on a minor road or track.
  const gradeOf = (c, sf) => (c === 7 ? (sf === 1 ? 1 : 3) : sf === 2 ? 2 : sf === 0 && c >= 5 ? 2 : 1);
  function weights(net, o) {
    // o: { style: dirt|mix|paved, cap: 1-5, street: bool }. Returns the cost multiplier per road line (0 = never).
    const w = new Float32Array(net.LINES.length);
    for (let i = 0; i < w.length; i++) {
      const c = net.LINES[i] >> 2 & 63, sf = net.LINES[i] & 3, g = gradeOf(c, sf), dirt = g >= 2;
      let m = 1;
      if (g > o.cap + 1) m = 0; else if (g === o.cap + 1) m = 2.5;
      if (o.style === "dirt") m *= dirt ? 0.5 : c <= 1 ? 2 : 1.6;
      else if (o.style === "mix") m *= dirt ? 0.8 : c <= 1 ? 1.3 : 1;
      else { if (c === 7 || o.street && sf === 2) m = 0; else m *= dirt ? 3 : c <= 1 ? 1.3 : 1; }
      w[i] = m;
    }
    return w;
  }
  // km/h: gravel main roads 50, gravel minor roads 40, tracks and service roads as KMH.
  const speedOf = (net, li) => { const c = net.LINES[li] >> 2 & 63, sf = net.LINES[li] & 3; return sf === 2 ? Math.min(KMH[c], c >= 5 ? 40 : 50) : KMH[c]; };

  // Nearest road point to p (the closer end of the nearest road piece). Returns { n, m } or null.
  function nearest(net, p, w) {
    let best = -1, bd = Infinity;
    const kx = Math.cos(p[0] * RAD) * 111320;
    for (let n = 0; n < net.N; n++) {
      const dy = (net.lat[n] - p[0]) * 110540; if (dy > bd || -dy > bd) continue;
      const d = Math.hypot((net.lon[n] - p[1]) * kx, dy);
      if (d < bd) { let ok = false; for (let k = net.start[n]; k < net.start[n + 1]; k++) if (w[net.line[k]] > 0) { ok = true; break; } if (ok) { bd = d; best = n; } }
    }
    return best < 0 || bd > SNAP_M ? null : { n: best, m: bd };
  }

  // A* from a to b (seconds, times the style's multipliers). blocked: Uint8Array of points not to pass.
  function astar(net, a, b, w, blocked) {
    const N = net.N, g = new Float64Array(N).fill(Infinity), via = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const heap = [], hv = [];
    const push = (n, f) => { heap.push(n); hv.push(f); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (hv[p] <= hv[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; [hv[p], hv[i]] = [hv[i], hv[p]]; i = p; } };
    const pop = () => { const n = heap[0], lastN = heap.pop(), lastV = hv.pop(); if (heap.length) { heap[0] = lastN; hv[0] = lastV; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && hv[l] < hv[m]) m = l; if (r < heap.length && hv[r] < hv[m]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; [hv[m], hv[i]] = [hv[i], hv[m]]; i = m; } } return n; };
    const bp = [net.lat[b], net.lon[b]], H = (n) => (metres([net.lat[n], net.lon[n]], bp) / (KMH[0] / 3.6)) * 0.8;
    g[a] = 0; push(a, H(a));
    while (heap.length) {
      const n = pop();
      if (done[n]) continue;
      done[n] = 1;
      if (n === b) break;
      for (let k = net.start[n]; k < net.start[n + 1]; k++) {
        const li = net.line[k], m = w[li], t = net.to[k];
        if (!m || done[t] || blocked && blocked[t]) continue;
        const ow = net.LINES[li] >> 8;
        if (ow === 1 && net.dir[k] < 0 || ow === 2 && net.dir[k] > 0) continue;
        const c = g[n] + (net.len[k] / (speedOf(net, li) / 3.6)) * m;
        if (c < g[t]) { g[t] = c; via[t] = k; push(t, c + H(t)); }
      }
    }
    if (!done[b]) return null;
    const ks = [];
    for (let n = b; n !== a; ) { const k = via[n]; ks.push(k); n = otherEnd(net, k); }
    return ks.reverse();
  }
  // The point an adjacency entry k starts from (entries are stored under their start point).
  function otherEnd(net, k) { let lo = 0, hi = net.N - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (net.start[mid] <= k) lo = mid; else hi = mid - 1; } return lo; }

  // ---------- turn by turn ----------
  const bearing = (a, b) => { const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD), x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD); return (Math.atan2(y, x) / RAD + 360) % 360; };
  const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  const roadWord = (net, li) => net.lineName[li] || (((net.LINES[li] >> 2) & 63) === 7 ? "a track" : (net.LINES[li] & 3) === 2 ? "a gravel road" : "an unnamed road");
  function turnWord(d) {
    const a = ((d + 540) % 360) - 180, s = Math.abs(a), side = a < 0 ? "left" : "right";
    return s < 25 ? "" : s < 50 ? `Bear ${side}` : s < 130 ? `Turn ${side}` : s < 165 ? `Turn sharp ${side}` : "Make a U-turn";
  }

  // ---------- a route ----------
  // locs: [[lat, lon], ...] (first and last are the ends, the rest points on the way). o: { style, cap, street,
  // excl: [[lat, lon]] roads to leave out, onProg }. Returns the same shape as moto.js's online routeOnce.
  async function route(locs, o = {}) {
    const lats = locs.map((p) => p[0]), lons = locs.map((p) => p[1]);
    const s = Math.min(...lats), n = Math.max(...lats), w0 = Math.min(...lons), e = Math.max(...lons);
    const pad = Math.max(0.05, (n - s) * 0.3, (e - w0) * 0.3);
    const box = [s - pad, w0 - pad * 1.5, n + pad, e + pad * 1.5];
    const net = await build(box, o.onProg);
    const w = weights(net, o);
    let blocked = null;
    if (o.excl && o.excl.length) {
      blocked = new Uint8Array(net.N);
      for (let i = 0; i < net.N; i++) for (const q of o.excl) if (Math.abs(net.lat[i] - q[0]) < 0.0005 && Math.abs(net.lon[i] - q[1]) < 0.0008 && metres([net.lat[i], net.lon[i]], q) < 40) blocked[i] = 1;
    }
    const snaps = locs.map((p) => nearest(net, p, w));
    const far = snaps.findIndex((x) => !x);
    if (far >= 0) throw Object.assign(new Error("far"), { point: far });
    const line = [], legAt = [], ks = [];
    for (let i = 1; i < snaps.length; i++) {
      const path = snaps[i - 1].n === snaps[i].n ? [] : astar(net, snaps[i - 1].n, snaps[i].n, w, blocked);
      if (!path) throw Object.assign(new Error("noway"), { leg: i });
      const base = line.length ? line.length - 1 : 0;
      if (!line.length) line.push([net.lat[snaps[i - 1].n], net.lon[snaps[i - 1].n]]);
      path.forEach((k) => { const t = net.to[k]; line.push([net.lat[t], net.lon[t]]); ks.push(k); });
      legAt.push([base, line.length - base]);
    }
    if (line.length < 2) throw new Error("noway");
    // Edges (for moto.js's surfaces, grades and traffic) and turns.
    const edges = [], parts = [];
    let km = 0, time = 0;
    const ptsOfEdge = [];
    ks.forEach((k, i) => {
      const li = net.line[k], c = (net.LINES[li] >> 2) & 63, sf = net.LINES[li] & 3, l = net.len[k] / 1000, sp = speedOf(net, li);
      km += l; time += (l / sp) * 3600;
      const prev = edges[edges.length - 1];
      if (prev && prev._li === li) { prev.length += l; prev.end_shape_index = i + 1; }
      else edges.push({ _li: li, length: l, surface: sf === 1 ? "paved" : sf === 2 ? (c === 7 ? "dirt" : "gravel") : c === 7 ? "dirt" : undefined, unpaved: sf === 2 || c === 7 && sf !== 1,
        use: c === 7 ? "track" : "road", road_class: CLASS_NAME[c], names: net.lineName[li] ? [net.lineName[li]] : [], begin_shape_index: i, end_shape_index: i + 1, speed: sp });
      ptsOfEdge.push(li);
    });
    // A new turn where the road's name changes or the way bends hard at a junction.
    let cur = null;
    const legEnds = new Set(legAt.slice(0, -1).map(([b, m]) => b + m - 1));
    for (let i = 0; i < ks.length; i++) {
      const li = ptsOfEdge[i], nm = roadWord(net, li);
      const atJunction = i > 0 && (() => { const n = otherEnd(net, ks[i]); return net.start[n + 1] - net.start[n] > 2; })();
      let turn = "";
      if (i > 0) {
        const a = line[Math.max(0, i - 2)], b = line[i], c2 = line[Math.min(line.length - 1, i + 2)];
        turn = turnWord(bearing(b, c2) - bearing(a, b));
      }
      const newName = cur && nm !== cur.name, newLeg = legEnds.has(i);
      if (!cur || newLeg || newName && (atJunction || turn) || atJunction && /Turn|U-turn/.test(turn)) {
        if (cur) cur.b = i;
        const first = !cur, onto = nm;
        const text = first ? `Head ${COMPASS[Math.round(bearing(line[0], line[Math.min(line.length - 1, 3)]) / 45) % 8]} on ${onto}`
          : newLeg && !turn ? `Continue on ${onto}` : turn ? `${turn} onto ${onto}` : `Continue onto ${onto}`;
        cur = { name: nm, kind: "moto", lvl: null, color: o.color || "#d9480f", say: text + ".", text: text + ".", km: 0, a: i, b: i + 1 };
        parts.push(cur);
      }
      cur.km += net.len[ks[i]] / 1000;
      cur.b = i + 1;
    }
    parts.forEach((x) => { x.pts = line.slice(x.a, Math.max(x.a + 2, x.b + 1)); });
    edges.forEach((x) => delete x._li);
    return { pts: locs, line, parts: parts.filter((x) => x.pts.length > 1), km, time, ferry: false, edges, legAt, offline: true, tiles: net.found };
  }

  window.tfMotoRoads = {
    covered,
    route,
    // How many saved areas there are (for the card's note).
    count: () => areas().filter((a) => tmplOf(a)).length,
    forget() { last = null; },
    _decode: decode, _build: build,   // for the tests
  };
})();
