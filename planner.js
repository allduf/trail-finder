// Plan a route, two ways (like Komoot or Trailforks' route planner):
// - Tap points: tap where you start, then each next point, and the route between them takes the trails and forest
//   roads that make the most sense on a bike: one-way trails only their way, climbs on roads and climbing trails,
//   descents on the downhill trails.
// - Pick trails: tap the trails you want to ride and the app builds the ride: the order and direction that make
//   sense (climb the climbing trails, descend the downhill ones, follow one-way tags) joined by the easiest climbs
//   and links, from a start (the lowest end of the picked trails, or one you set) and back to it.
// Pedal or Shuttle (a 4x4 drives the open forest roads up; the ride starts where it stops).
// Both show distance, climb, the trails used, a GPX file, and Ride it (Ride mode, navigate.js, follows it with the
// off-route alert). Routing uses the all-trails and forest-road files (window.tfNav), so it works offline in saved
// areas; heights come from free terrain tiles (AWS Terrain Tiles, as Elevation lines), and without them the route
// goes by distance. A stretch with no mapped trail is drawn as a dashed straight line. The plan is kept on this
// device (tf:plan, tf:planPicks, tf:planMode) until it's cleared.
(() => {
  "use strict";
  const nav = window.tfNav;
  if (!nav) return;
  const map = nav.map;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const R = 6371008.8, RAD = Math.PI / 180;
  function metres(a, b) {
    const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const key = (p) => p[0].toFixed(5) + "," + p[1].toFixed(5);
  const nameOf = (w) => (w.road ? w.name : (w.tags.name || w.tags["mtb:name"] || "")).trim();
  const fmtM = (m) => (m < 1000 ? Math.round(m / 10) * 10 + " m" : (m / 1000).toFixed(1) + " km");
  const SNAP_M = 80;              // a tap this close to a trail starts or ends on it
  const PAD_DEG = 0.03;           // route inside the two points' box plus about 3 km
  const BRIDGE_M = 20;            // a trail end this close to another line, with no shared point, joins it
  const MAX_PICKS = 12;

  // ---------- terrain heights ----------
  // Terrarium tiles (256 px), decoded once and kept. Zoom 13 (about 13 m a pixel here), or wider for a big box.
  const TERRAIN = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const tiles = new Map();        // "z/x/y" -> Float32Array(256 * 256), null (failed), or a promise while loading
  function tileXY(p, z) {
    const n = 2 ** z, s = Math.sin(p[0] * RAD);
    return [((p[1] + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  }
  function loadTile(z, x, y) {
    const k = `${z}/${x}/${y}`;
    if (!tiles.has(k)) tiles.set(k, (async () => {
      try {
        const r = await fetch(TERRAIN(z, x, y));
        if (!r.ok) return null;
        const bm = await createImageBitmap(await r.blob());
        const cv = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
        const cx = cv.getContext("2d", { willReadFrequently: true });
        cx.imageSmoothingEnabled = false;   // blending pixels would scramble the colour-coded heights
        cx.drawImage(bm, 0, 0);
        const px = cx.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
        for (let i = 0; i < e.length; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
        return e;
      } catch { return null; }
    })().then((e) => { tiles.set(k, e); return e; }));
    return tiles.get(k);
  }
  // Height function for a box [s, w, n, e]: metres, or null where there's no tile (offline).
  async function terrain(box) {
    let z = 13, a, b;
    for (; z > 9; z--) {
      a = tileXY([box[2], box[1]], z).map(Math.floor); b = tileXY([box[0], box[3]], z).map(Math.floor);
      if ((b[0] - a[0] + 1) * (b[1] - a[1] + 1) <= 36) break;
    }
    const jobs = [];
    for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) jobs.push(loadTile(z, x, y));
    await Promise.all(jobs);
    const px = (x, y) => {   // one pixel, across tile edges
      const tx = Math.floor(x / 256), ty = Math.floor(y / 256), e = tiles.get(`${z}/${tx}/${ty}`);
      return e instanceof Float32Array ? e[(y - ty * 256) * 256 + (x - tx * 256)] : null;
    };
    return (p) => {
      const [fx, fy] = tileXY(p, z), X = fx * 256 - 0.5, Y = fy * 256 - 0.5, x = Math.floor(X), y = Math.floor(Y), u = X - x, v = Y - y;
      const h00 = px(x, y), h10 = px(x + 1, y), h01 = px(x, y + 1), h11 = px(x + 1, y + 1);
      if (h00 == null || h10 == null || h01 == null || h11 == null) return h00;
      return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
    };
  }
  const noHeights = () => null;
  const terrainOr = (box) => terrain(box).catch(() => noHeights);
  function boxOf(pts, pad) {
    let s = 90, n = -90, w = 180, e = -180;
    pts.forEach((p) => { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); });
    const wPad = pad / Math.cos(((s + n) / 2) * RAD);
    return [s - pad, w - wPad, n + pad, e + wPad];
  }
  // Up and down along a line, from heights every 25 m, counted in 4 m steps (like a GPS unit).
  function climbOf(pts, ht) {
    const hs = [];
    for (let i = 0; i < pts.length; i++) {
      if (i) {
        const d = metres(pts[i - 1], pts[i]), n = Math.floor(d / 25);
        for (let j = 1; j <= n; j++) hs.push(ht([pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * j) / (n + 1), pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * j) / (n + 1)]));
      }
      hs.push(ht(pts[i]));
    }
    const ok = hs.filter((x) => x != null);
    if (ok.length < 2 || ok.length < hs.length / 2) return null;
    let up = 0, down = 0, ref = ok[0];
    ok.forEach((x) => { if (x - ref >= 4) { up += x - ref; ref = x; } else if (ref - x >= 4) { down += ref - x; ref = x; } });
    return { up: Math.round(up), down: Math.round(down) };
  }

  // ---------- the lines a bike can use: trails and forest roads ----------
  // Streets, paths and bridges, fetched from OpenStreetMap only where a leg found no way along the trails and forest
  // roads (a town, a footbridge across a creek): the trail files hold bike trails and the road files dirt roads only.
  // Kept in memory, in 0.02 degree squares.
  const connectors = new Map();   // square -> [ways]
  let connN = 0;
  const CONN_HW = "primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian|footway|path|cycleway|steps|track|bridleway|road";
  const CONN_OK = new RegExp(`^(${CONN_HW})$`);
  async function connectorSquare(sq) {
    const [i, j] = sq.split(":").map(Number), s = i * 0.02, w = j * 0.02, n = s + 0.02, e = w + 0.02;
    const keep = (tags) => tags && CONN_OK.test(tags.highway || "") && !/^(no|private|dismount)$/.test(tags.bicycle || "") && !/^(private|no)$/.test(tags.access || "");
    const make = (id, tags, geom) => ({ id: "c" + id, osm: id, conn: true, tags, name: tags.name || "", geom });
    const q = `[out:json][timeout:10];way["highway"~"^(${CONN_HW})$"](${s},${w},${n},${e});out tags geom;`;
    for (const url of ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]) {
      try {
        const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(12000) });
        if (!r.ok) continue;
        return (await r.json()).elements.filter((x) => x.type === "way" && x.geometry && keep(x.tags))
          .map((x) => make(x.id, x.tags, x.geometry.map((g) => [+g.lat.toFixed(5), +g.lon.toFixed(5)])));
      } catch {}
    }
    try {   // Overpass busy: the OpenStreetMap map call for the same square
      const r = await fetch(`https://api.openstreetmap.org/api/0.6/map.json?bbox=${w},${s},${e},${n}`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) return null;
      const els = (await r.json()).elements, nodes = new Map();
      els.forEach((x) => { if (x.type === "node") nodes.set(x.id, [+x.lat.toFixed(5), +x.lon.toFixed(5)]); });
      return els.filter((x) => x.type === "way" && keep(x.tags)).map((x) => make(x.id, x.tags, x.nodes.map((id) => nodes.get(id)).filter(Boolean)))
        .filter((x) => x.geom.length > 1);
    } catch { return null; }
  }
  // Loads the squares around stretches with no mapped way (their ends first, then along them; up to 12).
  // True when new lines came in.
  async function loadConnectors(lines) {
    const sqs = [], add = (p) => {
      const b = boxOf([p], 0.006);
      for (let i = Math.floor(b[0] / 0.02); i <= Math.floor(b[2] / 0.02); i++)
        for (let j = Math.floor(b[1] / 0.02); j <= Math.floor(b[3] / 0.02); j++) { const sq = i + ":" + j; if (!connectors.has(sq) && !sqs.includes(sq)) sqs.push(sq); }
    };
    lines.forEach((l) => { add(l[0]); add(l[l.length - 1]); });
    lines.forEach((l) => l.forEach((p, i) => { if (!i) return;
      const q = l[i - 1], n = Math.floor(Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])) / 0.01);
      for (let k = 1; k <= n; k++) add([q[0] + ((p[0] - q[0]) * k) / (n + 1), q[1] + ((p[1] - q[1]) * k) / (n + 1)]); }));
    if (!sqs.length) return false;
    sqs.splice(12);
    const got = await Promise.all(sqs.map(connectorSquare));
    let added = false;
    sqs.forEach((sq, k) => { if (got[k]) { connectors.set(sq, got[k]); added = added || got[k].length > 0; } });
    if (added) connN++;
    return added;
  }
  const roadWays = new WeakMap();
  let roadN = 0;
  const cache = { n: -1, r: -1, list: [], byId: new Map() };
  function allWays() {
    const trails = nav.ways(), roads = nav.roads ? nav.roads() : [];
    if (cache.n === trails.length && cache.r === roads.length && cache.c === connN) return cache.list;
    const byId = new Map();
    trails.forEach((w) => { if (!byId.has(w.id)) byId.set(w.id, w); });
    roads.forEach((r) => {
      if (r.src === "osm" && byId.has(r.id)) return;   // a track that is also a trail
      let w = roadWays.get(r);
      if (!w) {
        w = { id: r.src === "osm" ? "r" + r.id : "f" + ++roadN, road: true, name: r.name || "", st: r.st, geom: r.geom,
          tags: r.tags || { highway: "track", name: r.name || "" } };
        roadWays.set(r, w);
      }
      if (!byId.has(w.id)) byId.set(w.id, w);
    });
    const osmIds = new Set([...byId.values()].map((w) => (w.road ? (String(w.id)[0] === "r" ? +String(w.id).slice(1) : null) : w.id)));
    connectors.forEach((list) => list.forEach((w) => { if (!osmIds.has(w.osm) && !byId.has(w.id)) byId.set(w.id, w); }));
    Object.assign(cache, { n: trails.length, r: roads.length, c: connN, list: [...byId.values()], byId });
    return cache.list;
  }
  const bbs = new WeakMap();
  function bbOf(w) {
    if (!bbs.has(w)) {
      let s = 90, n = -90, west = 180, e = -180;
      w.geom.forEach((p) => { s = Math.min(s, p[0]); n = Math.max(n, p[0]); west = Math.min(west, p[1]); e = Math.max(e, p[1]); });
      bbs.set(w, [s, west, n, e]);
    }
    return bbs.get(w);
  }
  const inBox = (w, b) => { const bb = bbOf(w); return !(bb[0] > b[2] || bb[2] < b[0] || bb[1] > b[3] || bb[3] < b[1]); };
  // One-way for bikes: 1 along the line, -1 against it, 0 both ways (as navigate.js).
  function onewayOf(w) {
    if (w.road) return 0;
    const t = w.tags, v = t["oneway:bicycle"] != null ? t["oneway:bicycle"] : t["oneway:mtb"] != null ? t["oneway:mtb"] : t.oneway;
    return v === "yes" || v === "1" || v === "true" ? 1 : v === "-1" || v === "reverse" ? -1 : 0;
  }
  // What a line is for, which sets how it costs to ride up or down it:
  // road (forest and dirt roads), climb (climbing trails), down (downhill and harder trails), trail (the rest).
  const kinds = new WeakMap();
  function kindOf(w) {
    if (!kinds.has(w)) {
      const t = w.tags, name = nameOf(w), d = nav.difficulty(t), type = (t["mtb:type"] || "") + " " + (t.mtb || "");
      let k = "trail";
      if (w.conn && !/^(path|track|bridleway)$/.test(t.highway)) k = t.highway === "steps" ? "steps" : /^(footway|pedestrian)$/.test(t.highway) ? "path" : "street";
      else if (w.conn) k = t.highway === "track" ? "road" : "path";
      else if (w.road || (/^(track|service|unclassified|residential|tertiary|secondary)$/.test(t.highway || "") && !(d && d !== "green"))) k = "road";
      else if (/\b(climb|climbing|uphill|ascent|up ?track)\b/i.test(name) || /uphill|climb/.test(type) || (t.incline === "up" && onewayOf(w) === 1)
        || (t["mtb:scale:uphill"] != null && +t["mtb:scale:uphill"] <= 2 && !(parseInt(t["mtb:scale"], 10) >= 2))) k = "climb";
      else if (/downhill|gravity|freeride/.test(type) || t.downhill === "yes" || /\b(dh|downhill)\b/i.test(name) || d === "black" || d === "dbl" || d === "pro"
        || (t.incline === "down" && onewayOf(w) === 1)) k = "down";
      kinds.set(w, k);
    }
    return kinds.get(w);
  }
  // Effort of a stretch: [per metre, per metre climbed, per metre dropped]. Climbing costs about like riding 7 to 14 m
  // on the flat, and much more up a downhill trail (pushing, and riders coming down); descending a road or a climbing
  // trail costs a little (the fun is on the trails); downhill trails ride a bit cheaper.
  const COST = { street: [1.3, 9, 1.5], path: [1.4, 12, 1], steps: [4, 30, 4], road: [1.15, 7, 1.5], climb: [1, 7, 3], down: [0.85, 60, 0], trail: [1, 14, 0], link: [1.5, 12, 1] };
  const edgeCost = (d, dh, kind) => { const c = COST[kind]; return d * c[0] + (dh > 0 ? dh * c[1] : -dh * c[2]); };

  // ---------- shuttle: drive up, ride down ----------
  // Shuttle (alex): a 4x4 pickup drives you up the forest roads as close to the trails as it gets, and you ride from
  // there. It drives forest and dirt roads that are good, degraded or of unknown condition (not heavily degraded,
  // closed to vehicles or impassable: alex) and streets; never past a locked gate, a barrier or a bridge that's out; and only on road
  // networks of 2 km or more (a bit of road cut off from the rest can't be reached by car). Driving costs about a
  // tenth of riding the same stretch on the flat, and climbing costs nothing.
  let how = "pedal";
  const DRIVE = { good: 0.1, degraded: 0.12, heavy: 0.16, unknown: 0.14, street: 0.08 };
  const CAR_HW = /^(primary|secondary|tertiary|unclassified|residential|living_street|service|road|track)$/;
  const NO_CAR = /^(no|private|forestry|agricultural|delivery)$/;
  function driveRate(w) {
    if (!w) return 0;
    if (w.road) return w.st === "heavy" || w.st === "closed" || w.st === "impass" ? 0 : DRIVE[w.st] || DRIVE.unknown;
    if (!w.conn || !CAR_HW.test(w.tags.highway || "") || ["access", "vehicle", "motor_vehicle", "motorcar"].some((k) => NO_CAR.test(w.tags[k] || ""))) return 0;
    return w.tags.highway === "track" ? DRIVE.unknown : DRIVE.street;
  }
  // Locked gates, barriers and bridges out on the forest roads (window.tfNav.roadFeats), in 0.002 degree cells.
  let stopFeatN = -1, stopGrid = new Map();
  const cellKey = (lat, lon) => Math.floor(lat / 0.002) + ":" + Math.floor(lon / 0.002);
  function carStops() {
    const feats = nav.roadFeats ? nav.roadFeats() : [];
    if (feats.length !== stopFeatN) {
      stopFeatN = feats.length; stopGrid = new Map();
      feats.filter((f) => /^(gate_locked|impasse|bridge_out)$/.test(f.kind)).forEach((f) => {
        const c = cellKey(f.lat, f.lon);
        if (!stopGrid.has(c)) stopGrid.set(c, []);
        stopGrid.get(c).push([f.lat, f.lon]);
      });
    }
    return stopGrid;
  }
  function blocked(p1, p2) {   // one of them within 15 m of this stretch
    const g = carStops();
    if (!g.size || !p1 || !p2) return false;
    const ci = Math.floor((p1[0] + p2[0]) / 2 / 0.002), cj = Math.floor((p1[1] + p2[1]) / 2 / 0.002);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const f of g.get(i + ":" + j) || []) {
      const kx = Math.cos(f[0] * RAD) * R * RAD, ky = R * RAD;
      const ax = (p1[1] - f[1]) * kx, ay = (p1[0] - f[0]) * ky, bx = (p2[1] - f[1]) * kx, by = (p2[0] - f[0]) * ky;
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
      if (Math.hypot(ax + t * dx, ay + t * dy) < 15) return true;
    }
    return false;
  }
  // Can the shuttle drive this stretch of graph G? A short join between two drivable lines counts too.
  function carOk(G, k1, k2, w, d) {
    if (!G.car) G.car = new Map();
    const id = k1 < k2 ? k1 + "|" + k2 : k2 + "|" + k1;
    if (!G.car.has(id)) {
      const hasCar = (k) => (G.adj.get(k) || []).some(([, , w2]) => driveRate(w2) > 0);
      G.car.set(id, (w ? driveRate(w) > 0 : d <= BRIDGE_M && hasCar(k1) && hasCar(k2)) && !blocked(G.pos.get(k1), G.pos.get(k2)));
    }
    return G.car.get(id);
  }
  function carReach(G) {   // points on drivable networks of 2 km or more
    if (G.reach) return G.reach;
    const seen = new Set(), ok = new Set();
    G.adj.forEach((_, k0) => {
      if (seen.has(k0)) return;
      seen.add(k0);
      const comp = [k0];
      let len = 0;
      for (let i = 0; i < comp.length; i++) (G.adj.get(comp[i]) || []).forEach(([k2, m, w]) => {
        if (!carOk(G, comp[i], k2, w, m)) return;
        len += m / 2;   // each stretch is counted from both ends
        if (!seen.has(k2)) { seen.add(k2); comp.push(k2); }
      });
      if (len >= 2000) comp.forEach((k) => ok.add(k));
    });
    return (G.reach = ok);
  }
  const drives = (G, k1, k2, w, d) => carOk(G, k1, k2, w, d) && (carReach(G).has(k1) || carReach(G).has(k2));

  // Nearest point on any line: { w, i (segment), q (the point), d }.
  function snap(p, max = SNAP_M, ways = allWays()) {
    const kx = Math.cos(p[0] * RAD) * R * RAD, ky = R * RAD, dLat = max / ky, dLon = max / kx;
    let best = null;
    ways.forEach((w) => {
      const bb = bbOf(w);
      if (bb[0] > p[0] + dLat || bb[2] < p[0] - dLat || bb[1] > p[1] + dLon || bb[3] < p[1] - dLon) return;
      const g = w.geom;
      for (let i = 0; i < g.length - 1; i++) {
        const ax = (g[i][1] - p[1]) * kx, ay = (g[i][0] - p[0]) * ky, bx = (g[i + 1][1] - p[1]) * kx, by = (g[i + 1][0] - p[0]) * ky;
        if (Math.min(ax, bx) > max || Math.max(ax, bx) < -max || Math.min(ay, by) > max || Math.max(ay, by) < -max) continue;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        // A trail wins over a road a few metres closer, so a tap on a trail by a road picks the trail.
        const score = d + (w.road ? 8 : w.conn ? 15 : 0);
        if (d <= max && (!best || score < best.score)) best = { w, i, d, score, q: [g[i][0] + t * (g[i + 1][0] - g[i][0]), g[i][1] + t * (g[i + 1][1] - g[i][1])] };
      }
    });
    return best;
  }

  // ---------- the graph: points shared by lines are junctions ----------
  // adj: key -> [[key2, metres, way, dir (1 along the way, -1 against, 0 a link)]]. ht: height function.
  // The data files simplify every line (trails to about 2 m, roads to 8 m), which can drop the point two lines
  // share, and mappers often stop a trail a few metres short of the road it meets. So a point of one line within
  // NEAR_M of another line (an end within opts.bridge) is joined to it, splitting that line's stretch there.
  const NEAR_M = 8;
  function graph(ways, ht, opts = {}) {
    const adj = new Map(), pos = new Map(), owner = new Map(), h = new Map();
    const add = (k1, k2, d, w, dir) => { if (!adj.has(k1)) adj.set(k1, []); adj.get(k1).push([k2, d, w, dir]); };
    ways.forEach((w) => w.geom.forEach((p) => {
      const k = key(p);
      if (!pos.has(k)) pos.set(k, p);
      if (!owner.has(k)) owner.set(k, w); else if (owner.get(k) !== w) owner.set(k, null);   // null: already a junction
    }));
    // Every stretch in a grid of about 100 m cells.
    const CY = 0.0009, CX = 0.0013, grid = new Map(), cellOf = (p) => [Math.floor(p[0] / CY), Math.floor(p[1] / CX)];
    ways.forEach((w) => {
      const g = w.geom;
      for (let i = 0; i < g.length - 1; i++) {
        const [a0, a1] = cellOf(g[i]), [b0, b1] = cellOf(g[i + 1]);
        for (let y = Math.min(a0, b0); y <= Math.max(a0, b0); y++) for (let x = Math.min(a1, b1); x <= Math.max(a1, b1); x++) {
          const c = y + ":" + x;
          if (!grid.has(c)) grid.set(c, []);
          grid.get(c).push([w, i]);
        }
      }
    });
    const splits = new Map();   // way -> Map(segment -> [[t, key]])
    const bridgeEnd = opts.bridge || BRIDGE_M;
    ways.forEach((w) => w.geom.forEach((p, vi) => {
      const k = key(p);
      if (owner.get(k) === null) return;
      const end = vi === 0 || vi === w.geom.length - 1;
      if (!end && w.road) return;   // roads join at trails' points, and at their own ends
      const max = end ? bridgeEnd : NEAR_M, kx = Math.cos(p[0] * RAD) * R * RAD, ky = R * RAD, [cy, cx] = cellOf(p);
      let best = null;
      for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) (grid.get(y + ":" + x) || []).forEach(([w2, i]) => {
        if (w2 === w) return;
        const g = w2.geom, ax = (g[i][1] - p[1]) * kx, ay = (g[i][0] - p[0]) * ky, bx = (g[i + 1][1] - p[1]) * kx, by = (g[i + 1][0] - p[0]) * ky;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d < max && (!best || d < best.d)) best = { w2, i, t, d, len: Math.sqrt(l2) };
      });
      if (!best) return;
      const g = best.w2.geom, along = best.t * best.len;
      let k2;
      if (along < 2) k2 = key(g[best.i]);
      else if (best.len - along < 2) k2 = key(g[best.i + 1]);
      else {
        const q = [g[best.i][0] + best.t * (g[best.i + 1][0] - g[best.i][0]), g[best.i][1] + best.t * (g[best.i + 1][1] - g[best.i][1])];
        k2 = key(q);
        if (!pos.has(k2)) pos.set(k2, q);
        if (!splits.has(best.w2)) splits.set(best.w2, new Map());
        const m = splits.get(best.w2);
        if (!m.has(best.i)) m.set(best.i, []);
        m.get(best.i).push([best.t, k2]);
      }
      if (k2 !== k) { const d = Math.max(1, best.d); add(k, k2, d, null, 0); add(k2, k, d, null, 0); }
    }));
    ways.forEach((w) => {
      const g = w.geom, one = opts.anyWay ? 0 : onewayOf(w), sp = splits.get(w);
      for (let i = 0; i < g.length - 1; i++) {
        const chain = [key(g[i]), ...(sp && sp.has(i) ? sp.get(i).sort((x, y) => x[0] - y[0]).map((x) => x[1]) : []), key(g[i + 1])];
        for (let j = 1; j < chain.length; j++) {
          const k0 = chain[j - 1], k = chain[j];
          if (k0 === k) continue;
          const d = metres(pos.get(k0), pos.get(k));
          if (one >= 0) add(k0, k, d, w, 1);
          if (one <= 0) add(k, k0, d, w, -1);
        }
      }
    });
    pos.forEach((p, k) => h.set(k, ht(p)));
    return { adj, pos, h, ht };
  }
  function cost(G, k1, k2, d, w, car = how === "shuttle") {
    if (car && drives(G, k1, k2, w, d)) return d * (w ? driveRate(w) : DRIVE.street);
    const h1 = G.h.get(k1), h2 = G.h.get(k2), dh = h1 != null && h2 != null ? h2 - h1 : 0;
    // Up a one-way trail (the only way the graph lets you ride it) is a climbing trail, like Stl'lhalem Sintl'.
    return edgeCost(d, dh, w ? (dh > 0 && kindOf(w) !== "road" && onewayOf(w) ? "climb" : kindOf(w)) : "link");
  }
  // A tapped spot joined into the segment it snapped to, as node `name`.
  function addPoint(G, name, sn) {
    const g = sn.w.geom, k1 = key(g[sn.i]), k2 = key(g[sn.i + 1]), one = onewayOf(sn.w);
    const add = (a, b, d, dir) => { if (!G.adj.has(a)) G.adj.set(a, []); G.adj.get(a).push([b, d, sn.w, dir]); };
    G.pos.set(name, sn.q); G.h.set(name, G.ht(sn.q));
    [[k1, -1], [k2, 1]].forEach(([k, dir]) => {
      const d = metres(sn.q, G.pos.get(k) || (k === k1 ? g[sn.i] : g[sn.i + 1]));
      if (one === 0 || one === dir) add(name, k, d, dir);
      if (one === 0 || one === -dir) add(k, name, d, -dir);
    });
  }
  // Dijkstra with a small binary heap. weigh(k1, k2, metres, way) -> cost. Stops early at `to` if given.
  function dijkstra(G, from, to, weigh) {
    const dist = new Map([[from, 0]]), prev = new Map(), heap = [[0, from]];
    const push = (x) => { heap.push(x); let i = heap.length - 1; while (i) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } }
      return top;
    };
    while (heap.length) {
      const [d, k] = pop();
      if (k === to) break;
      if (d > dist.get(k)) continue;
      (G.adj.get(k) || []).forEach(([k2, m, w, dir]) => {
        const nd = d + weigh(k, k2, m, w, dir);
        if (nd < (dist.has(k2) ? dist.get(k2) : Infinity)) { dist.set(k2, nd); prev.set(k2, [k, w, dir]); push([nd, k2]); }
      });
    }
    return { dist, prev, from };
  }
  // The way to `to`: { pts, ways (in order), segs: [[way, dir] per stretch] } or null.
  function pathTo(G, D, to) {
    if (!D.dist.has(to)) return null;
    const pts = [], segs = [], keys = [];
    for (let k = to; ; ) {
      pts.push(G.pos.get(k)); keys.push(k);
      const pv = D.prev.get(k);
      if (!pv) break;
      segs.push([pv[1], pv[2]]);
      k = pv[0];
    }
    pts.reverse(); segs.reverse(); keys.reverse();
    const ways = [];
    segs.forEach(([w]) => { if (w && ways[ways.length - 1] !== w) ways.push(w); });
    return { pts, ways, segs, keys, cost: D.dist.get(to) };
  }
  // Shuttle: a way split into what's driven and what's ridden, [{ drive, pts, segs }], or null if nothing is driven.
  // One shuttle is one drive; a drive under 300 m is just riding across a road.
  function runsOf(G, p, car = how === "shuttle") {
    if (!car || !p || p.segs.length < 1) return null;
    const merge = (runs) => runs.reduce((out, r) => {
      const last = out[out.length - 1];
      if (last && last.drive === r.drive) { last.pts.push(...r.pts.slice(1)); last.segs.push(...r.segs); } else out.push({ drive: r.drive, pts: [...r.pts], segs: [...r.segs] });
      return out;
    }, []);
    let runs = merge(p.segs.map((sg, i) => ({ drive: drives(G, p.keys[i], p.keys[i + 1], sg[0], metres(p.pts[i], p.pts[i + 1])), pts: [p.pts[i], p.pts[i + 1]], segs: [sg] })));
    // You stay in the truck between two drives (a short link the data doesn't show as drivable)...
    const noCar = (r) => r.segs.some(([w]) => w && w.road && !driveRate(w));   // a road the truck can't take
    runs.forEach((r, i) => { if (!r.drive && i > 0 && i < runs.length - 1 && lengthOf(r.pts) < 500 && !noCar(r)) r.drive = true; });
    runs = merge(runs);
    runs.forEach((r) => { if (r.drive && lengthOf(r.pts) < 300) r.drive = false; });   // ...and get out for less than 300 m
    runs = merge(runs);
    runs.forEach((r, i) => {
      r.raw = r.pts; r.pick = -1;
      const w = !r.drive && i && runs[i - 1].drive && r.segs.map(([x]) => x).find((x) => x && x.road);   // why the truck stopped
      if (w && !driveRate(w)) r.stop = { heavy: "heavily degraded", closed: "closed to vehicles", impass: "impassable" }[w.st];
    });
    return runs.some((r) => r.drive) ? runs : null;
  }
  const effort = (G, car) => (k1, k2, m, w) => cost(G, k1, k2, m, w, car);

  // ---------- the plan ----------
  // Tap points: stops [{ ll, snap }], legs[i] joins stops[i] and stops[i+1].
  // Pick trails: picks [{ name, ways }], start (a spot or null: the lowest trail end), back (end at the start);
  //   legs alternate links and the picked trails.
  // A leg: { pts, ways, gap (no trail, straight line), pick (index of the picked trail it rides, or -1), up, down }.
  let planning = false, mode = "tap", stops = [], legs = [], elev = null, picks = [], pickStart = null, pickBack = true, pickManual = true, pickHomePedal = false, settingStart = false;
  let busy = 0, gen = 0, note = "", noteWarn = true;
  const layer = L.layerGroup();
  const pickCase = L.polyline([], { color: "#ffd43b", weight: 13, opacity: 0.85, lineCap: "round", lineJoin: "round", interactive: false });
  const caseLine = L.polyline([], { color: "#fff", weight: 10, opacity: 0.9, lineCap: "round", lineJoin: "round", interactive: false });
  const linkLine = L.polyline([], { color: "#a77bf3", weight: 5, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: false });
  const line = L.polyline([], { color: "#7b2ff7", weight: 6, opacity: 0.95, lineCap: "round", lineJoin: "round", interactive: false });
  const gapLine = L.polyline([], { color: "#7b2ff7", weight: 4, opacity: 0.9, dashArray: "6 8", interactive: false });
  const driveLine = L.polyline([], { color: "#37474f", weight: 6, opacity: 0.95, dashArray: "12 6", lineCap: "butt", interactive: false });   // shuttle
  const arrows = L.layerGroup(), dots = L.layerGroup();
  [pickCase, caseLine, linkLine, line, driveLine, gapLine, arrows, dots].forEach((l) => l.addTo(layer));
  const allPts = () => legs.flatMap((l, i) => (i ? l.pts.slice(1) : l.pts));
  const lengthOf = (pts) => pts.reduce((a, q, i) => a + (i ? metres(pts[i - 1], q) : 0), 0);
  const total = () => legs.reduce((s, l) => s + lengthOf(l.pts), 0);
  // Shuttle: the driven stretches, and the climb of the ridden ones only.
  const driven = () => legs.flatMap((l) => (l.runs || []).filter((r) => r.drive));
  function rideClimb(ht) {
    if (!driven().length) return climbOf(allPts(), ht);
    const parts = legs.flatMap((l) => (l.runs ? l.runs.filter((r) => !r.drive).map((r) => r.pts) : [l.pts])).map((p) => climbOf(p, ht));
    return parts.some((c) => !c) ? null : { up: parts.reduce((a, c) => a + c.up, 0), down: parts.reduce((a, c) => a + c.down, 0) };
  }
  const clean = (pts) => pts.filter((q, i, arr) => !i || metres(arr[i - 1], q) > 0.5);

  // A leg; if nothing joins the two points along trails and roads, the streets and paths around them are loaded and
  // it is tried again, so the straight dash is left only where nothing at all is mapped.
  async function legFor(a, b) {
    const l = await legOn(a, b);
    if (!l.gap || !(await loadConnectors([[a.tap || a.ll, b.tap || b.ll]]))) return l;
    [a, b].forEach((s) => { if (!s.snap && s.tap) { const sn = snap(s.tap); if (sn) Object.assign(s, { ll: sn.q, snap: sn }); } });
    return legOn(a, b);
  }
  async function legOn(a, b) {
    if (!a.snap || !b.snap) return { pts: [a.ll, b.ll], ways: [], gap: true, pick: -1 };
    const box = boxOf([a.ll, b.ll], PAD_DEG), ht = await terrainOr(box);
    const G = graph(allWays().filter((w) => inBox(w, box)), ht);
    addPoint(G, "A", a.snap); addPoint(G, "B", b.snap);
    if (a.snap.w === b.snap.w && a.snap.i === b.snap.i) {   // both on one stretch
      const g = a.snap.w.geom, along = metres(g[a.snap.i], a.snap.q) <= metres(g[a.snap.i], b.snap.q) ? 1 : -1, one = onewayOf(a.snap.w);
      if (one === 0 || one === along) G.adj.get("A").push(["B", metres(a.snap.q, b.snap.q), a.snap.w, along]);
    }
    const p = pathTo(G, dijkstra(G, "A", "B", effort(G)), "B");
    if (!p) return { pts: [a.ll, b.ll], ways: [], gap: true, pick: -1 };
    return { pts: clean([a.ll, ...p.pts, b.ll]), raw: p.pts, segs: p.segs, ways: p.ways, gap: false, pick: -1, runs: runsOf(G, p) };
  }
  const makeStop = (ll) => { const sn = snap(ll); return { ll: sn ? sn.q : ll, tap: ll, snap: sn }; };
  let queue = Promise.resolve();
  const later = (fn) => (queue = queue.then(fn).catch((e) => console.warn("planner", e)));
  function addStop(ll) {
    later(async () => {
      const stop = makeStop(ll);
      busy++; render();
      try { if (stops.length) legs.push(await legFor(stops[stops.length - 1], stop)); } finally { busy--; }
      stops.push(stop);
      draw(); save();
    });
  }
  function undo() {
    if (mode === "pick") { picks.pop(); changedPicks(); return; }
    later(() => { stops.pop(); legs.pop(); draw(); save(); });
  }
  function clear() {
    if (mode === "pick") { picks = []; pickStart = null; pickManual = true; pickHomePedal = false; changedPicks(); return; }
    later(() => { stops = []; legs = []; elev = null; draw(); save(); });
  }
  function closeLoop() {
    if (mode === "pick") { pickBack = !pickBack; changedPicks(); return; }
    if (stops.length >= 2) addStop(stops[0].ll);
  }

  // ---------- pick trails ----------
  // The trail at a tap: every same-name piece joined end to end with it (within 60 m), or the one line if unnamed.
  function trailAt(ll) {
    const z = map.getZoom(), tol = Math.max(15, Math.min(150, (26 * 156543 * Math.cos(ll[0] * RAD)) / 2 ** z));
    const sn = snap(ll, tol);
    if (!sn) return null;
    const w0 = sn.w, name = nameOf(w0);
    if (!name) return { name: w0.road ? "Forest road" : "Unnamed trail", ways: [w0] };
    const near = boxOf([w0.geom[0]], 0.08), cands = allWays().filter((w) => w !== w0 && nameOf(w) === name && inBox(w, near));
    const touches = (a, b) => [b.geom[0], b.geom[b.geom.length - 1]].some((e) => a.geom.some((p) => metres(p, e) < 60))
      || [a.geom[0], a.geom[a.geom.length - 1]].some((e) => b.geom.some((p) => metres(p, e) < 60));
    const group = [w0], todo = [w0];
    while (todo.length) {
      const c = todo.pop();
      cands.forEach((w) => { if (!group.includes(w) && touches(c, w)) { group.push(w); todo.push(w); } });
    }
    return { name, ways: group };
  }
  function togglePick(ll) {
    const t = trailAt(ll);
    if (!t) { flash("No trail there. Tap right on a trail line."); return; }
    const ids = new Set(t.ways.map((w) => w.id)), at = picks.findIndex((p) => p.ways.some((w) => ids.has(w.id)));
    if (at >= 0) { picks.splice(at, 1); flash(`Took out ${t.name}`, false); }
    else if (picks.length >= MAX_PICKS) { flash(`Up to ${MAX_PICKS} trails in one ride.`); return; }
    else { picks.push(t); flash(`Added ${t.name}`, false); }
    changedPicks();
  }
  let flashTimer = 0;
  function flash(text, warn = true) { note = text; noteWarn = warn; render(); clearTimeout(flashTimer); flashTimer = setTimeout(() => { note = ""; render(); }, 2600); }

  // A picked trail's line from one end to the other: in the pieces' own little graph, the two ends farthest apart.
  function through(t) {
    const G = graph(t.ways, noHeights, { anyWay: true, bridge: 60 });
    // Its ends: piece ends that no other piece reaches (within 15 m).
    const tips = t.ways.flatMap((w) => [w.geom[0], w.geom[w.geom.length - 1]]);
    const ends = t.ways.flatMap((w) => [w.geom[0], w.geom[w.geom.length - 1]].filter((e) =>
      !t.ways.some((o) => o !== w && o.geom.some((p) => metres(p, e) < 15)))).map(key);
    const cand = [...new Set(ends.length >= 2 ? ends : tips.map(key))].slice(0, 60);
    let a = cand[0], b = cand[cand.length - 1], far = -1;
    cand.forEach((k1, i) => cand.slice(i + 1).forEach((k2) => { const d = metres(G.pos.get(k1), G.pos.get(k2)); if (d > far) { far = d; a = k1; b = k2; } }));
    const p = a !== b && pathTo(G, dijkstra(G, a, b, (k1, k2, m) => m), b);
    if (p) return { a, b, pts: p.pts, segs: p.segs };
    const w = t.ways.reduce((x, y) => (lengthOf(y.geom) > lengthOf(x.geom) ? y : x));   // pieces that don't join: the longest one
    return { a: key(w.geom[0]), b: key(w.geom[w.geom.length - 1]), pts: w.geom, segs: w.geom.slice(1).map(() => [w, 1]) };
  }
  // Build the ride: every picked trail in the order and direction that cost the least effort in all, from the start
  // and (if asked) back to it. Exact (Held-Karp) for up to 12 trails.
  async function buildRide(retried) {
    const my = ++gen;
    if (!picks.length) { legs = []; elev = null; draw(); return; }
    busy++; render();
    try {
      const T = picks.map(through);
      const box = boxOf([...T.flatMap((t) => t.pts), ...(pickStart ? [pickStart] : [])], 0.05);   // room for a climb that goes around (about 5 km)
      const ht = await terrainOr(box);
      if (my !== gen) return;
      const G = graph(allWays().filter((w) => inBox(w, box)), ht);
      // How each trail can be ridden: o = 0 from a to b, 1 from b to a. Infinity: not that way.
      const tc = T.map((t, j) => {
        let len = 0; const byKind = {};
        t.segs.forEach(([w], i) => { const d = metres(t.pts[i], t.pts[i + 1]); len += d; if (w) byKind[kindOf(w)] = (byKind[kindOf(w)] || 0) + d; });
        const kind = Object.keys(byKind).sort((x, y) => byKind[y] - byKind[x])[0] || "trail";
        const ha = ht(t.pts[0]), hb = ht(t.pts[t.pts.length - 1]), dh = ha != null && hb != null ? hb - ha : 0;
        let ow = 0;   // one-way stretches with (+) or against (-) a to b
        t.segs.forEach(([w, dir], i) => { const one = w ? onewayOf(w) : 0; if (one) ow += one * dir * metres(t.pts[i], t.pts[i + 1]); });
        const ok = [true, true];
        if (Math.abs(ow) > len * 0.3) ok[ow > 0 ? 1 : 0] = false;            // follows its one-way tags
        else if (kind === "climb" && Math.abs(dh) >= 15) ok[dh > 0 ? 1 : 0] = false;   // climbing trails go up
        else if (kind !== "road" && kind !== "climb" && Math.abs(dh) >= 40) ok[dh < 0 ? 1 : 0] = false;   // the rest go down
        const run = (o) => {   // effort along the trail ridden that way, point by point
          const pts = o ? [...t.pts].reverse() : t.pts, segs = o ? [...t.segs].reverse() : t.segs, cum = [0];
          segs.forEach(([w], i) => {
            const h1 = ht(pts[i]), h2 = ht(pts[i + 1]);
            cum.push(cum[i] + edgeCost(metres(pts[i], pts[i + 1]), h1 != null && h2 != null ? h2 - h1 : 0, w ? kindOf(w) : "link"));
          });
          return { pts, segs, cum };
        };
        T[j].dh = dh; T[j].kind = kind; T[j].run = [run(0), run(1)];
        return [0, 1].map((o) => (ok[o] ? T[j].run[o].cum[T[j].run[o].cum.length - 1] : Infinity));
      });
      const entry = (j, o) => (o ? T[j].b : T[j].a), exit = (j, o) => (o ? T[j].a : T[j].b);
      // The start: a spot you set, else the lowest end you can start a trail from (park at the bottom, ride up).
      let S = "S", sKey = null;
      if (pickStart) {
        const sn = snap(pickStart, 300);
        if (sn) addPoint(G, "S", sn); else { G.pos.set("S", pickStart); G.h.set("S", ht(pickStart)); }
      } else {
        let low = Infinity;
        T.forEach((t) => [[t.a, t.pts[0]], [t.b, t.pts[t.pts.length - 1]]].forEach(([k, p]) => {
          const h = ht(p);
          if (!sKey || (h != null && h < low)) { low = h != null ? h : Infinity; sKey = k; }
        }));
        S = sKey || T[0].a;
        if (!G.pos.has(S)) { G.pos.set(S, T[0].pts[0]); G.h.set(S, ht(T[0].pts[0])); }
      }
      // Effort between every pair of points that matter (start, trail ends): one Dijkstra from each.
      // Shuttle: each way into a trail goes by truck unless you took that shuttle out (pick.pedal; home: pickHomePedal).
      const shuttle = how === "shuttle", carInto = (j) => shuttle && !picks[j].pedal, carHome = shuttle && !pickHomePedal;
      const runs = new Map();
      const from = (k, car = shuttle) => { const id = (car ? "c" : "p") + k; if (!runs.has(id)) runs.set(id, dijkstra(G, k, null, effort(G, car))); return runs.get(id); };
      const posOf = (k) => G.pos.get(k) || T.flatMap((t) => [[t.a, t.pts[0]], [t.b, t.pts[t.pts.length - 1]]]).find((x) => x[0] === k)[1];
      const C = (k1, k2, car) => {
        if (k1 === k2) return 0;
        const d = from(k1, car).dist.get(k2);
        return d != null ? d : metres(posOf(k1), posOf(k2)) * 6 + 500;   // no way along lines: a straight dash, costly
      };
      // Branching off (alex): where the next trail starts partway along this one, leave it there instead of riding
      // to its end and coming back. cut(j, o, k, o2): { i (point on trail j), key, cost of trail j up to there } or null.
      const cuts = new Map();
      const cut = (j, o, k, o2) => {
        const id = [j, o, k, o2].join();
        if (!cuts.has(id)) {
          const r = T[j].run[o], to = posOf(entry(k, o2));
          let best = null;
          for (let i = 1; i < r.pts.length - 1; i++) {
            const d = metres(r.pts[i], to), kk = key(r.pts[i]);
            if (d < 40 && G.adj.has(kk) && (!best || d < best.d)) best = { i, d, key: kk, cost: r.cum[i] };
          }
          cuts.set(id, best && lengthOf(r.pts.slice(best.i)) > 100 ? best : null);   // not for the last few metres
        }
        return cuts.get(id);
      };
      // Effort from the start of trail j to the start of trail k: all of j and the link, or j up to where k branches off.
      const step = (j, o, k, o2) => {
        const full = tc[j][o] + C(exit(j, o), entry(k, o2), carInto(k)), c = tc[j][o] < Infinity && cut(j, o, k, o2);
        return c ? Math.min(full, c.cost + C(c.key, entry(k, o2), carInto(k))) : full;
      };
      const N = T.length;
      let order;
      const CS = (j, o) => C(S, entry(j, o), carInto(j)), CH = (j, o) => (pickBack ? C(exit(j, o), S, carHome) : 0);
      if (pickManual) order = fixedOrder(N, tc, CS, CH, step);   // your order: only the directions are chosen
      else {
      const full = (1 << N) - 1, idx = (m, j, o) => (m * N + j) * 2 + o;
      const dp = new Float64Array((full + 1) * N * 2).fill(Infinity), par = new Int32Array((full + 1) * N * 2).fill(-1);
      for (let j = 0; j < N; j++) for (let o = 0; o < 2; o++) if (tc[j][o] < Infinity) dp[idx(1 << j, j, o)] = CS(j, o) + tc[j][o];
      for (let m = 1; m <= full; m++) for (let j = 0; j < N; j++) for (let o = 0; o < 2; o++) {
        const v = dp[idx(m, j, o)];
        if (v === Infinity) continue;
        for (let k = 0; k < N; k++) {
          if (m & (1 << k)) continue;
          for (let o2 = 0; o2 < 2; o2++) {
            if (tc[k][o2] === Infinity) continue;
            const nv = v - tc[j][o] + step(j, o, k, o2) + tc[k][o2], at = idx(m | (1 << k), k, o2);
            if (nv < dp[at]) { dp[at] = nv; par[at] = j * 2 + o; }
          }
        }
      }
      let best = Infinity, end = -1;
      for (let j = 0; j < N; j++) for (let o = 0; o < 2; o++) {
        const v = dp[idx(full, j, o)] + CH(j, o);
        if (v < best) { best = v; end = j * 2 + o; }
      }
      if (end < 0) { legs = []; flash("Couldn't build a ride with those trails."); draw(); return; }
      order = [];
      for (let m = full, cur = end; cur >= 0; ) { order.unshift(cur); const p = par[idx(m, cur >> 1, cur & 1)]; m &= ~(1 << (cur >> 1)); cur = p; }
      }
      // The legs: link to the trail, the trail, ..., and the link home.
      const out = [];
      const link = (k1, k2, car, into) => {   // into: the trail it leads to (-1: home)
        if (k1 === k2) return;
        const p = pathTo(G, from(k1, car), k2), runs = runsOf(G, p, car);
        (runs || []).forEach((r) => { r.into = into; });
        if (p && p.pts.length > 1) out.push({ pts: clean(p.pts), raw: p.pts, segs: p.segs, ways: p.ways, gap: false, pick: -1, runs, into, pedalled: shuttle && !car });
        else out.push({ pts: [posOf(k1), posOf(k2)], ways: [], gap: true, pick: -1 });
      };
      let at = S;
      order.forEach((x, n) => {
        const j = x >> 1, o = x & 1, r = T[j].run[o], nx = order[n + 1];
        link(at, entry(j, o), carInto(j), j);
        let pts = r.pts, segs = r.segs, to = -1;
        at = exit(j, o);
        if (nx != null) {   // the next trail branches off this one: leave it there
          const k = nx >> 1, o2 = nx & 1, c = cut(j, o, k, o2);
          if (c && c.cost + C(c.key, entry(k, o2), carInto(k)) < tc[j][o] + C(exit(j, o), entry(k, o2), carInto(k))) {
            pts = pts.slice(0, c.i + 1); segs = segs.slice(0, c.i); at = c.key; to = k;
          }
        }
        const ways = [];
        segs.forEach(([w]) => { if (w && ways[ways.length - 1] !== w) ways.push(w); });
        out.push({ pts: clean(pts), ways, gap: false, pick: j, to });
      });
      if (pickBack) link(at, S, carHome, -1);
      if (!pickManual) {   // the list shows the trails in the order chosen
        const posOfPick = new Map(order.map((x, i) => [x >> 1, i]));
        picks = order.map((x) => picks[x >> 1]);
        const re = (l) => { if (l.pick >= 0) l.pick = posOfPick.get(l.pick); if (l.to >= 0) l.to = posOfPick.get(l.to); if (l.into >= 0) l.into = posOfPick.get(l.into); };
        out.forEach((l) => { re(l); (l.runs || []).forEach(re); });
        savePicks();
      }
      out.forEach((l) => { Object.assign(l, climbOf(l.pts, ht) || {}); (l.runs || []).forEach((r) => Object.assign(r, climbOf(r.pts, ht) || {})); });
      const gaps = out.filter((l) => l.gap);
      if (gaps.length && !retried && (await loadConnectors(gaps.map((l) => l.pts)))) {
        if (my === gen) later(() => buildRide(true));   // again, with the streets and paths there
        return;
      }
      if (my !== gen) return;
      legs = out;
      elev = rideClimb(ht);
    } finally { busy--; }
    if (my === gen) { draw(); fitRoute(); }
  }
  // Show the whole ride above the bar, if part of it is out of sight.
  function fitRoute() {
    const pts = allPts();
    if (pts.length < 2) return;
    const b = L.latLngBounds(pts), size = map.getSize(), top = map.containerPointToLatLng([0, 0]), bottom = map.containerPointToLatLng([size.x, size.y - bar.offsetHeight - 12]);
    if (L.latLngBounds(top, bottom).contains(b)) return;
    map.fitBounds(b, { paddingTopLeft: [30, 60], paddingBottomRight: [30, bar.offsetHeight + 24], maxZoom: 16 });
  }
  // The trails in the order of the list: the best direction for each, start to finish (and back).
  function fixedOrder(N, tc, CS, CH, step) {
    const best = [], from = [];
    for (let j = 0; j < N; j++) {
      best.push([Infinity, Infinity]); from.push([-1, -1]);
      for (let o = 0; o < 2; o++) {
        if (tc[j][o] === Infinity) continue;
        if (!j) { best[0][o] = CS(0, o) + tc[0][o]; continue; }
        for (let p = 0; p < 2; p++) {
          const v = best[j - 1][p] - tc[j - 1][p] + step(j - 1, p, j, o) + tc[j][o];
          if (v < best[j][o]) { best[j][o] = v; from[j][o] = p; }
        }
      }
    }
    const last = [0, 1].map((o) => best[N - 1][o] + CH(N - 1, o));
    let o = last[1] < last[0] ? 1 : 0;
    const order = [];
    for (let j = N - 1; j >= 0; j--) { order.unshift(j * 2 + o); o = from[j][o]; }
    return order;
  }
  let buildTimer = 0;
  function changedPicks() {
    clearTimeout(buildTimer);
    gen++;   // a ride still being built is for the old list
    savePicks();
    legs = []; elev = null; draw();
    buildTimer = setTimeout(() => later(buildRide), 250);
  }

  // ---------- drawing ----------
  function bearing(a, b) {
    const y = Math.sin((b[1] - a[1]) * RAD) * Math.cos(b[0] * RAD);
    const x = Math.cos(a[0] * RAD) * Math.sin(b[0] * RAD) - Math.sin(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.cos((b[1] - a[1]) * RAD);
    return Math.atan2(y, x) / RAD;
  }
  function drawArrows() {   // which way to ride, about every 400 m (more when zoomed in)
    arrows.clearLayers();
    if (!planning || !legs.length) return;
    const every = Math.max(120, 400 * 2 ** (14 - map.getZoom())), pts = allPts(), view = map.getBounds().pad(0.2);
    let run = every / 2, n = 0;
    for (let i = 1; i < pts.length && n < 80; i++) {
      const d = metres(pts[i - 1], pts[i]);
      run += d;
      if (run >= every && d > 3) {
        run = 0;
        const at = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
        if (!view.contains(at)) continue;
        n++;
        arrows.addLayer(L.marker(at, { interactive: false, keyboard: false, icon: L.divIcon({ className: "plan-arrow", iconSize: [16, 16], iconAnchor: [8, 8],
          html: `<span style="transform:rotate(${Math.round(bearing(pts[i - 1], pts[i]))}deg)">▲</span>` }) }));
      }
    }
  }
  const stopIcon = (text, cls = "") => L.divIcon({ className: "plan-stop " + cls, iconSize: [24, 24], iconAnchor: [12, 12], html: `<span>${text}</span>` });
  function draw() {
    const real = legs.filter((l) => !l.gap);
    caseLine.setLatLngs(real.map((l) => l.pts));
    line.setLatLngs(real.filter((l) => mode === "tap" || l.pick >= 0).map((l) => l.pts));
    linkLine.setLatLngs(mode === "pick" ? real.filter((l) => l.pick < 0).map((l) => l.pts) : []);
    gapLine.setLatLngs(legs.filter((l) => l.gap).map((l) => l.pts));
    driveLine.setLatLngs(driven().map((r) => r.pts));
    // Yellow under your trails: just the part ridden once the ride is built (a trail can be left where the next starts).
    pickCase.setLatLngs(mode !== "pick" ? [] : legs.length ? legs.filter((l) => l.pick >= 0).map((l) => l.pts) : picks.flatMap((p) => p.ways.map((w) => w.geom)));
    dots.clearLayers();
    const mk = (ll, icon) => dots.addLayer(L.marker(ll, { interactive: false, keyboard: false, icon }));
    if (mode === "tap") stops.forEach((s, i) => mk(s.ll, stopIcon(i === 0 ? "S" : i)));
    else {
      if (legs.length) mk(legs[0].pts[0], stopIcon("S"));
      else if (pickStart) mk(pickStart, stopIcon("S"));
      legs.forEach((l) => { if (l.pick >= 0) mk(l.pts[0], stopIcon(l.pick + 1, "pick")); });
    }
    drawArrows();
    render();
    if (mode === "tap") loadClimb();
  }
  const levelOf = (w) => {
    if (w.road) return { color: "#8d6e63", lvl: "forest road" };
    if (w.conn) return { color: "#9aa0a6", lvl: kindOf(w) === "street" ? "street" : "path" };
    const d = nav.difficulty(w.tags);
    return { color: nav.diffColor(d), lvl: d ? nav.DIFF[d].label : "" };
  };
  function namesOf(ways) {
    const out = [];
    ways.forEach((w) => {
      const name = nameOf(w) || (w.road ? "forest road" : w.conn ? (kindOf(w) === "street" ? "street" : "path") : "unnamed trail");
      if (out.length && out[out.length - 1].name === name) return;
      out.push({ name, ...levelOf(w) });
    });
    return out;
  }
  const chip = (t) => `<span class="pt"><i style="background:${t.color}"></i>${esc(t.name)}</span>`;
  // A link's main lines: the named ones by the length ridden on them, for "Climb on Mashiter FSR".
  function mainNames(l) {
    const by = new Map();
    (l.segs || []).forEach(([w], i) => { const n = w && nameOf(w); if (n) by.set(n, (by.get(n) || 0) + metres(l.raw[i], l.raw[i + 1])); });
    return [...by.entries()].filter((x) => x[1] >= 150).sort((a, b) => b[1] - a[1]).slice(0, 2).map((x) => x[0]);
  }
  // One row of the ride: a picked trail (its yellow number, as on the map) or a link between them.
  // A picked trail in the list: its number (as its pin on the map), and buttons to move it or take it out.
  // Rows can also be dragged (with a mouse).
  function pickRow(i, body) {
    const n = picks.length;
    return `<li class="ps-trail" draggable="true" data-i="${i}"><span class="ps-n">${i + 1}</span><span class="ps-body">${body}</span>
      <span class="ps-ctl"><button type="button" data-act="up" data-i="${i}" title="Ride it earlier" aria-label="Move up"${i ? "" : " disabled"}>▲</button><button type="button" data-act="down" data-i="${i}" title="Ride it later" aria-label="Move down"${i < n - 1 ? "" : " disabled"}>▼</button><button type="button" data-act="x" data-i="${i}" title="Take it out" aria-label="Take it out">✕</button></span></li>`;
  }
  function stepHtml(l) {
    if (l.runs) return l.runs.map(stepHtml).join("");
    if (l.pedalled && l.into != null) {   // a shuttle you took out: ride it, with a way to put the truck back
      const back = `<button type="button" class="ps-car" data-act="car" data-i="${l.into}" title="Take the truck up here again">🛻 Shuttle here</button>`;
      return stepHtml({ ...l, pedalled: false, into: null }).replace(/<\/span><\/li>$/, ` ${back}</span></li>`);
    }
    const len = lengthOf(l.pts), up = l.up || 0, down = l.down || 0;
    const verb = up > 25 && up > down * 1.5 ? "Climb" : down > 25 && down > up * 1.5 ? "Descend" : "Ride";
    const m = `<span class="m">${fmtM(len)}${up >= 10 ? ` ↑ ${up} m` : ""}${down >= 10 ? ` ↓ ${down} m` : ""}</span>`;
    if (l.pick >= 0) {
      const p = picks[l.pick], lv = p && p.ways[0] ? levelOf(p.ways[0]) : { color: "#8a8f98" };
      const to = l.to >= 0 && picks[l.to] ? ` <span class="ps-to">to where ${esc(picks[l.to].name)} starts</span>` : "";
      return pickRow(l.pick, `<b>${verb}</b> ${chip({ name: p ? p.name : "trail", color: lv.color })}${to} ${m}`);
    }
    if (!l.gap && len < 25) return "";   // a few metres between two trails
    if (l.drive) {
      const names = mainNames(l);
      const x = l.into != null ? `<span class="ps-ctl"><button type="button" data-act="nocar" data-i="${l.into}" title="No shuttle here: ride it, one big run" aria-label="Take out this shuttle">✕</button></span>` : "";
      return `<li class="ps-link ps-drive"><span class="ps-n">🛻</span><span class="ps-body"><b>${up > down ? "Shuttle up" : "Shuttle"}</b>${names.length ? " via " + names.map(esc).join(", ") : ""} ${m}</span>${x}</li>`;
    }
    if (l.gap) return `<li class="ps-link"><span class="ps-n">↝</span><span><b>Cross</b> <span class="gap-note">off mapped trails</span> ${m}</span></li>`;
    const names = mainNames(l), picked = new Set(picks.map((p) => p.name));
    const onlyWay = verb === "Climb" && names.some((n) => picked.has(n)) ? ` <span class="gap-note">no other mapped way up</span>` : "";
    const stop = l.stop ? ` <span class="gap-note">road ahead ${l.stop}, ride from here</span>` : "";
    return `<li class="ps-link"><span class="ps-n">${verb === "Climb" ? "↗" : verb === "Descend" ? "↘" : "→"}</span><span><b>${verb}</b>${names.length ? " on " + names.map(esc).join(", ") : ""} ${m}${onlyWay}${stop}</span></li>`;
  }
  function render() {
    const gaps = legs.filter((l) => l.gap).length, climb = elev ? ` · ↑ ${elev.up} m · ↓ ${elev.down} m` : "";
    const car = driven().reduce((a, r) => a + lengthOf(r.pts), 0), m = total() - car;
    const ride = (s) => (car ? `<b>Ride ${s}</b>` : `<b>${s}</b>`), drive = car ? ` · 🛻 Drive ${fmtM(car)}` : "";
    document.querySelectorAll(".plan-how button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.how === how)));
    document.querySelectorAll(".plan-modes button[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    bar.classList.toggle("pick", mode === "pick");
    let stats;
    if (note) stats = noteWarn ? `<span class="gap-note">${esc(note)}</span>` : `<b>${esc(note)}</b>`;
    else if (mode === "tap") stats = stops.length < 2 ? (busy ? "Finding the way…" : stops.length ? "Tap the next point. The route takes the trails that make sense." : "Tap the map where you start.")
      : `${ride(fmtM(m))}${climb}${drive}${gaps ? ` · <span class="gap-note">${gaps} stretch${gaps > 1 ? "es" : ""} off mapped trails (dashed)</span>` : ""}${busy ? " · finding the way…" : ""}`;
    else if (settingStart) stats = "Tap the map where you start.";
    else if (!picks.length) stats = "Tap the trails you want to ride. The app puts them in a logical order and direction, and you can change the order.";
    else if (busy || !legs.length) stats = `${picks.length} trail${picks.length > 1 ? "s" : ""} picked · building the ride…`;
    else stats = `${ride(fmtM(m))}${climb}${drive} · ${picks.length} trail${picks.length > 1 ? "s" : ""}${gaps ? ` · <span class="gap-note">${gaps} stretch${gaps > 1 ? "es" : ""} off mapped trails</span>` : ""}`;
    $("planStats").innerHTML = stats;
    if (mode === "tap") {
      const used = namesOf(legs.flatMap((l) => l.ways));
      $("planTrails").innerHTML = used.length ? used.slice(0, 12).map(chip).join(" → ") + (used.length > 12 ? ` → +${used.length - 12} more` : "") : "";
      $("planSteps").innerHTML = "";
    } else {
      $("planTrails").innerHTML = picks.length < 2 ? "" : pickManual
        ? `In the order you tapped them (▲ ▼ or drag to change it). <button type="button" class="ps-auto" data-act="auto">↻ Let the app choose</button>`
        : "The app chose the order. Use ▲ ▼ (or drag) to set your own.";
      $("planSteps").innerHTML = !picks.length ? `<li class="ps-empty">Your trails will show here. Tap a trail on the map to add it.</li>` : !legs.length ? picks.map((p, i) => pickRow(i, chip({ name: p.name, ...levelOf(p.ways[0]) }))).join("")
        : `<li class="ps-start"><span class="ps-n">S</span><span><b>Start</b>${pickStart ? "" : " at the lowest end of your trails"}</span></li>`
          + legs.map(stepHtml).join("") + (pickBack ? `<li class="ps-start"><span class="ps-n">S</span><span><b>Back at the start</b></span></li>` : "");
    }
    const has = mode === "tap" ? stops.length : picks.length, ready = mode === "tap" ? stops.length >= 2 : legs.length > 0;
    $("planUndo").disabled = !has; $("planClear").disabled = !has && !(mode === "pick" && pickStart);
    $("planLoop").disabled = mode === "tap" && stops.length < 2;
    $("planLoop").textContent = mode === "tap" ? "↺ Back to start" : pickBack ? "↺ Loop: on" : "↺ Loop: off";
    $("planLoop").setAttribute("aria-pressed", String(mode === "pick" && pickBack));
    $("planStart").hidden = mode !== "pick";
    $("planStart").setAttribute("aria-pressed", String(settingStart));
    $("planStart").textContent = settingStart ? "Tap the start…" : pickStart ? "📍 Move start" : "📍 Set start";
    ["planGpx", "planRide"].forEach((id) => { $(id).disabled = !ready || busy > 0; });
  }
  // Climb for Tap points, from the same terrain heights.
  let climbGen = 0;
  function loadClimb() {
    const pts = allPts(), my = ++climbGen;
    if (pts.length < 2) { elev = null; return; }
    terrainOr(boxOf(pts, 0.005)).then((ht) => {
      if (my !== climbGen) return;
      legs.forEach((l) => { Object.assign(l, climbOf(l.pts, ht) || {}); (l.runs || []).forEach((r) => Object.assign(r, climbOf(r.pts, ht) || {})); });
      elev = rideClimb(ht);
      render();
    });
  }
  function save() { try { localStorage.setItem("tf:plan", JSON.stringify(stops.map((s) => s.ll))); } catch {} }
  function savePicks() {
    if (pending) return;   // still waiting for the saved picks' trails to load
    try { localStorage.setItem("tf:planPicks", JSON.stringify({ picks: picks.map((p) => ({ name: p.name, ids: p.ways.map((w) => w.id), pedal: !!p.pedal })), start: pickStart, back: pickBack, order: pickManual ? "tap" : "auto", homePedal: pickHomePedal })); } catch {}
  }
  function restore() {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem("tf:plan") || "[]") || []; } catch {}
    later(async () => {
      stops = []; legs = [];
      for (const ll of saved) {
        const stop = makeStop(ll);
        if (stops.length) legs.push(await legFor(stops[stops.length - 1], stop));
        stops.push(stop);
      }
      draw();
    });
  }
  // The trail and road files load in the background (a zone's forest roads are several MB), so a leg planned before
  // they arrived may be a straight dash or miss a road. When more have loaded, plan again with them.
  let dataKey = "", replanTimer = 0;
  setInterval(() => {
    if (!planning) return;
    const k = nav.ways().length + ":" + (nav.roads ? nav.roads().length : 0);
    if (k === dataKey) return;
    dataKey = k;
    clearTimeout(replanTimer);
    replanTimer = setTimeout(replan, 600);
  }, 1500);
  function replan() {
    if (mode === "pick") { if (picks.length && !pending) later(buildRide); return; }
    if (stops.length < 2) return;
    later(async () => {
      const taps = stops.map((s) => s.tap || s.ll), next = [], nextLegs = [];
      for (const ll of taps) {
        const stop = makeStop(ll);
        if (next.length) nextLegs.push(await legFor(next[next.length - 1], stop));
        next.push(stop);
      }
      if (mode !== "tap" || next.length !== stops.length) return;   // changed meanwhile
      stops = next; legs = nextLegs; draw();
    });
  }
  // Saved picks come back once their trail files have loaded (tried for a little while after opening).
  let pending = null, pendingTries = 0;
  function restorePicks() {
    try { const s = JSON.parse(localStorage.getItem("tf:planPicks") || "null"); if (s) { pending = s.picks || []; pickStart = s.start || null; pickBack = s.back !== false; pickManual = s.order !== "auto"; pickHomePedal = !!s.homePedal; } } catch {}
    pendingTries = 0; resolvePicks();
  }
  function resolvePicks() {
    if (!pending || !pending.length) { pending = null; return; }
    allWays();
    const got = pending.map((p) => ({ name: p.name, ways: p.ids.map((id) => cache.byId.get(id)).filter(Boolean), pedal: !!p.pedal }));
    if (got.every((p) => p.ways.length) || ++pendingTries > 15) {
      picks = got.filter((p) => p.ways.length); pending = null;
      if (mode === "pick") changedPicks();
    } else setTimeout(() => { if (planning) resolvePicks(); }, 1500);
  }
  // The route as a GPX track, with each point's height (from the same terrain tiles; left out where there are none).
  async function gpx() {
    const pts = allPts(), now = new Date().toISOString(), name = mode === "pick" ? "Trail Finder ride" : "Trail Finder route";
    const ht = await terrainOr(boxOf(pts, 0.005));
    const pt = (q) => { const h = ht(q); return `<trkpt lat="${q[0].toFixed(6)}" lon="${q[1].toFixed(6)}">${h != null ? `<ele>${h.toFixed(1)}</ele>` : ""}</trkpt>`; };
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Trail Finder" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${name}</name><time>${now}</time></metadata>\n<trk><name>${name}</name><trkseg>\n${pts.map(pt).join("\n")}\n</trkseg></trk>\n</gpx>\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type: "application/gpx+xml" }));
    a.download = `trail-finder-route-${now.slice(0, 10)}.gpx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- UI ----------
  const css = document.createElement("style");
  css.textContent = `
.app.planning { grid-template-columns: 1fr !important; grid-template-rows: 1fr !important; }
.app.planning .panel, .app.planning .tabbar, .app.planning .map-actions, .app.planning .first-tip { display: none !important; }
.app.planning .mapwrap { grid-column: 1; grid-row: 1; }
.app.planning #map { cursor: crosshair; }
.plan-bar { position: fixed; z-index: 1200; left: 8px; right: 8px; bottom: calc(8px + env(safe-area-inset-bottom, 0px)); max-width: 600px; margin: 0 auto; background: var(--panel, #fff); color: var(--fg, #14211a); border-radius: 18px; box-shadow: 0 6px 24px rgba(0,0,0,.28); padding: 12px 14px; }
.plan-bar[hidden] { display: none; }
.plan-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
.plan-head h3 { margin: 0; font-size: 1.05rem; flex: 1 1 auto; }
.plan-modes { display: flex; border: 1px solid var(--line, #d6dad3); border-radius: 11px; overflow: hidden; }
.plan-modes button { font: inherit; font-size: .88rem; font-weight: 700; padding: 6px 10px; border: 0; background: var(--bg, #f4f5f0); color: inherit; cursor: pointer; }
.plan-modes button[aria-pressed="true"] { background: #7b2ff7; color: #fff; }
.plan-how button[aria-pressed="true"] { background: #37474f; }
.plan-steps .ps-drive .ps-n { font-size: 13px; }
.plan-stats { font-size: 1rem; }
.plan-stats .gap-note, .plan-steps .gap-note { color: #c25e00; font-size: .9rem; }
.plan-trails { font-size: .88rem; color: var(--muted, #5b6660); margin-top: 4px; max-height: 3.2em; overflow: auto; }
.plan-bar.pick .plan-trails { max-height: 5em; color: inherit; }
.plan-trails .pt i, .plan-steps .pt i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 4px; vertical-align: 0; }
.plan-steps { list-style: none; margin: 6px 0 0; padding: 0; max-height: 13em; overflow: auto; font-size: .9rem; }
.plan-steps li { display: flex; gap: 8px; align-items: baseline; margin: 3px 0; }
.plan-steps .ps-n { flex: 0 0 20px; height: 20px; border-radius: 50%; display: inline-grid; place-items: center; font: 700 11px/1 system-ui, sans-serif; align-self: center; }
.plan-steps .ps-trail { cursor: grab; }
.plan-steps .ps-empty { color: var(--muted, #5b6660); border: 1px dashed var(--line, #d6dad3); border-radius: 10px; padding: 8px 10px; }
.plan-steps .ps-body { flex: 1 1 auto; }
.plan-steps .ps-ctl { display: inline-flex; gap: 2px; flex: 0 0 auto; align-self: center; }
.plan-steps .ps-ctl button { font: 700 11px/1 system-ui, sans-serif; width: 26px; height: 24px; padding: 0; border-radius: 7px; border: 1px solid var(--line, #d6dad3); background: var(--bg, #f4f5f0); color: inherit; cursor: pointer; }
.plan-steps .ps-ctl button:disabled { opacity: .3; cursor: default; }
.ps-car { font: inherit; font-size: .8rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; border: 1px solid #37474f; background: none; color: inherit; cursor: pointer; }
.ps-auto { font: inherit; font-size: .85rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid #7b2ff7; background: none; color: #7b2ff7; cursor: pointer; }
.plan-steps .ps-trail .ps-n { background: #ffd43b; color: #2b2100; }
.plan-steps .ps-start .ps-n { background: #7b2ff7; color: #fff; }
.plan-steps .ps-link { color: var(--muted, #5b6660); }
.plan-steps .ps-link .ps-n { color: #7b2ff7; font-size: 15px; }
.plan-steps .pt { font-weight: 700; }
.plan-steps .ps-to { font-size: .88rem; }
.plan-steps .m { color: var(--muted, #5b6660); white-space: nowrap; }
.plan-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.plan-btns button { flex: 1 1 auto; font: inherit; font-size: .92rem; font-weight: 700; padding: 9px 10px; border-radius: 11px; border: 1px solid var(--line, #d6dad3); background: var(--bg, #f4f5f0); color: inherit; cursor: pointer; }
.plan-btns button:disabled { opacity: .45; cursor: default; }
.plan-btns button[aria-pressed="true"] { border-color: #7b2ff7; }
.plan-btns .go { background: var(--cta, #c6f05a); border-color: transparent; color: var(--cta-fg, #10230f); }
.plan-stop, .plan-arrow { background: none; border: 0; }
.plan-stop span { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: #7b2ff7; color: #fff; font: 700 12px/1 system-ui, sans-serif; border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.35); box-sizing: border-box; }
.plan-stop.pick span { background: #ffd43b; color: #2b2100; }
.plan-arrow span { display: block; width: 16px; height: 16px; color: #fff; font: 700 11px/16px system-ui, sans-serif; text-align: center; text-shadow: 0 0 2px #4b1aa0, 0 0 2px #4b1aa0; }
body.sport-ski #planBtn, body.sport-ski #planMapBtn, .app.riding #planMapBtn, .app.planning #planMapBtn { display: none; }
#planMapBtn { font-weight: 700; }
@media (max-width: 760px) { #planMapBtn { display: none; } }
`;
  document.head.appendChild(css);
  const bar = document.createElement("div");
  bar.className = "plan-bar"; bar.hidden = true; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Plan a route");
  bar.innerHTML = `<div class="plan-head"><h3>Plan a route</h3><div class="plan-modes" role="group" aria-label="How to make the route">
      <button type="button" data-mode="tap" title="Tap points on the map; the route follows the trails between them">Tap points</button>
      <button type="button" data-mode="pick" title="Tap the trails you want to ride; the app builds the ride through them">Pick trails</button></div>
      <div class="plan-modes plan-how" role="group" aria-label="Pedal or shuttle">
      <button type="button" data-how="pedal" title="Ride all of it, climbs included">🚲 Pedal</button>
      <button type="button" data-how="shuttle" title="A 4x4 pickup drives you up the open forest roads; you ride from where it stops">🛻 Shuttle</button></div></div>
    <div class="plan-stats" id="planStats" aria-live="polite"></div><div class="plan-trails" id="planTrails"></div><ol class="plan-steps" id="planSteps"></ol>
    <div class="plan-btns"><button type="button" id="planUndo">↶ Undo</button><button type="button" id="planStart" hidden>📍 Set start</button><button type="button" id="planLoop" title="End the ride back at the start">↺ Back to start</button><button type="button" id="planClear">Clear</button>
    <button type="button" id="planGpx">⤓ GPX</button><button type="button" class="go" id="planRide">▶ Ride it</button><button type="button" id="planDone">Done</button></div>`;
  document.body.appendChild(bar);

  function setMode(m) {
    if (m === mode) return;
    mode = m; settingStart = false; note = "";
    try { localStorage.setItem("tf:planMode", m); } catch {}
    legs = []; elev = null;
    if (m === "tap") restore();
    else if (!picks.length && !pending) restorePicks();
    else if (!pending) changedPicks();
    draw();
  }
  function setPlanning(on) {
    if (planning === on) return;
    planning = on;
    const before = $("map").getBoundingClientRect();
    document.querySelector(".app").classList.toggle("planning", on);
    document.body.classList.toggle("planning", on);
    bar.hidden = !on;
    map.invalidateSize({ pan: false });
    const after = $("map").getBoundingClientRect();
    map.panBy([after.left - before.left, after.top - before.top], { animate: false });
    if (on) {
      nav.load();
      layer.addTo(map);
      try { mode = localStorage.getItem("tf:planMode") === "pick" ? "pick" : "tap"; } catch {}
      if (mode === "tap") { if (!stops.length) restore(); }
      else if (!picks.length) restorePicks();
      draw();
      const pts = allPts().length ? allPts() : mode === "tap" ? stops.map((s) => s.ll) : picks.flatMap((p) => p.ways.flatMap((w) => w.geom));
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
      else if (map.getZoom() < 13) map.setZoom(13);
    } else { map.removeLayer(layer); settingStart = false; }
    const b = $("planBtn"); if (b) b.setAttribute("aria-pressed", String(on));
  }
  function onTap(latlng) {
    const ll = [latlng.lat, latlng.lng];
    if (mode === "tap") addStop(ll);
    else if (settingStart) { settingStart = false; pickStart = ll; changedPicks(); }
    else togglePick(ll);
  }
  // Taps on the map come here before any map layer sees them: search results, Near me and New trails lines open
  // their trail details on a tap and stop it there, which swallowed taps on those trails while planning.
  map.getContainer().addEventListener("click", (e) => {
    if (!planning || !e.target.closest || !e.target.closest(".leaflet-map-pane")) return;   // not the zoom buttons
    if (map.dragging && map.dragging.moved()) return;   // the end of a pan
    e.stopPropagation();
    onTap(map.mouseEventToLatLng(e));
  }, true);
  map.on("click", (e) => { if (planning && !e.originalEvent) onTap(e.latlng); });   // a click fired from code
  map.on("moveend", () => { if (planning) { nav.load(); drawArrows(); } });
  bar.querySelectorAll(".plan-modes button[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  bar.querySelectorAll(".plan-how button").forEach((b) => b.addEventListener("click", () => setHow(b.dataset.how)));
  function setHow(h) {
    if (h === how) return;
    how = h;
    try { localStorage.setItem("tf:planHow", h); } catch {}
    if (mode === "pick") { if (picks.length) changedPicks(); } else { replan(); }
    render();
  }
  try { if (localStorage.getItem("tf:planHow") === "shuttle") how = "shuttle"; } catch {}
  function movePick(i, j) {
    if (i === j || j < 0 || j >= picks.length) return;
    const [p] = picks.splice(i, 1);
    picks.splice(j, 0, p);
    pickManual = true; changedPicks();
  }
  $("planTrails").addEventListener("click", (e) => { if (e.target.closest('[data-act="auto"]')) { pickManual = false; changedPicks(); } });
  $("planSteps").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const i = +b.dataset.i;
    if (b.dataset.act === "up") movePick(i, i - 1);
    else if (b.dataset.act === "down") movePick(i, i + 1);
    else if (b.dataset.act === "nocar" || b.dataset.act === "car") {   // take a shuttle out, or put it back
      const ride = b.dataset.act === "nocar";
      if (i < 0) pickHomePedal = ride; else if (picks[i]) picks[i].pedal = ride;
      if (ride && picks.length > 1) pickManual = true;   // keep the order you see, so the trails stay back to back
      changedPicks();
    }
    else if (b.dataset.act === "x") { picks.splice(i, 1); changedPicks(); }
  });
  let dragI = -1;
  $("planSteps").addEventListener("dragstart", (e) => { const li = e.target.closest(".ps-trail"); if (li) { dragI = +li.dataset.i; e.dataTransfer.effectAllowed = "move"; } });
  $("planSteps").addEventListener("dragover", (e) => { if (dragI >= 0 && e.target.closest(".ps-trail")) e.preventDefault(); });
  $("planSteps").addEventListener("drop", (e) => { const li = e.target.closest(".ps-trail"); if (li && dragI >= 0) { e.preventDefault(); movePick(dragI, +li.dataset.i); } dragI = -1; });
  $("planSteps").addEventListener("dragend", () => { dragI = -1; });
  $("planUndo").addEventListener("click", undo);
  $("planClear").addEventListener("click", () => { if ((mode === "tap" ? stops.length : picks.length) < 3 || confirm("Clear this plan?")) clear(); });
  $("planLoop").addEventListener("click", closeLoop);
  $("planStart").addEventListener("click", () => { settingStart = !settingStart; render(); });
  $("planGpx").addEventListener("click", gpx);
  $("planDone").addEventListener("click", () => setPlanning(false));
  $("planRide").addEventListener("click", () => {
    const lines = legs.map((l) => l.pts), name = mode === "pick" ? `your ride (${fmtM(total())})` : `your route (${fmtM(total())})`;
    setPlanning(false);
    if (window.tfRide) window.tfRide.follow(lines, name);
  });

  const btn = document.createElement("button");
  btn.id = "planBtn"; btn.type = "button"; btn.setAttribute("aria-pressed", "false");
  btn.title = "Plan a route: tap points on the map, or pick the trails you want and the app builds the ride. Distance, climb, GPX, and Ride it";
  btn.textContent = "✎ Plan a route";
  const tools = $("offlineBtn")?.parentElement;
  if (tools) tools.prepend(btn);
  btn.addEventListener("click", () => { setPlanning(!planning); if ($("layersMenu") && !$("layersMenu").hidden) $("layersBtn").click(); });

  if ($("planMapBtn")) $("planMapBtn").addEventListener("click", () => setPlanning(true));   // on the map, under ▶ Ride (desktop)

  window.tfPlan = { open: () => setPlanning(true), planning: () => planning,
    // For trail details or the To ride list later: open Pick trails with these way ids added.
    pick: (ids, name) => {
      allWays();
      const ways = ids.map((id) => cache.byId.get(id)).filter(Boolean);
      if (!ways.length) return;
      setPlanning(true); setMode("pick");
      if (!picks.some((p) => p.ways.some((w) => ids.includes(w.id)))) { picks.push({ name: name || nameOf(ways[0]) || "Unnamed trail", ways }); changedPicks(); }
    } };
})();
