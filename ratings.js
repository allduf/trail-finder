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
  // off: they say it's an official trail (shown as Official). unoff: why it's not official (shown dotted as Unofficial, even when
  // the map's tags say official). Unnamed trails are listed by OpenStreetMap way id (ids) instead of name;
  // named: the trail the rider says they're part of, so lists, search and details show and group them under that name.
  // Entries with src instead of who come from the weekly data audit's research (scripts/audit.mjs): src names the
  // resort, club or tourism page that gives the level or calls it a bike trail, url is that page. Never Trailforks.
  const HAND = [
    { name: "Alpine Capone", c: [49.845, -123.092], r: 3000, d: "black", who: "alex", note: "an unsanctioned trail on Brohm Ridge, Squamish" },
    { name: "Just a Cough", c: [49.823, -123.118], r: 2000, d: "black", who: "alex", note: "an unsanctioned trail on Brohm Ridge, Squamish, like Flying Whales" },
    // BC's Trail is tagged blue (mtb:scale:imba 2) on OpenStreetMap; a rider's level beats the map's (rateTags in index.html).
    { name: "BC's Trail", c: [50.088, -122.981], r: 1500, d: "dbl", who: "alex", note: "a Whistler Bike Park trail in Creekside, by Kadenwood" },
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
    { name: "Rocket Science", c: [49.724, -118.935], r: 2000, d: "black", src: "Mountain Biking BC, Bike Parks BC road trip part 2", url: "https://www.mountainbikingbc.ca/blog/bike-parks-bc-road-trip-part-2-silverstar-and-big-white/" },
    { name: "Black Mamba", c: [49.725, -118.922], r: 2000, d: "black", src: "Freehub, BC bike parks travel guide", url: "https://freehub.com/features/bc-bike-parks-travel-guide" },
    { name: "Shark Fin Soup", c: [49.725, -118.925], r: 2000, d: "blue", src: "Freehub, BC bike parks travel guide", url: "https://freehub.com/features/bc-bike-parks-travel-guide" },
    { name: "Rock Hammer", c: [49.737, -118.927], r: 2000, d: "dbl", src: "Adventures NW, In Praise of Gravity (2017)", url: "https://www.adventuresnw.com/in-praise-of-gravity-freeriding-the-okanogan/" },
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
  ];
  function handOf(geom, tags, id) {
    const n = Number(String(id || "").replace(/^\D+/, ""));
    if (n) { const h = HAND.find((h) => h.ids && h.ids.includes(n)); if (h) return h; }
    const name = ((tags && (tags.name || tags["tf:name"])) || "").toLowerCase(), mid = geom && geom[geom.length >> 1];
    if (!name || !mid) return null;
    const h = HAND.find((h) => h.name && h.name.toLowerCase() === name
      && Math.hypot((mid[0] - h.c[0]) * 110540, (mid[1] - h.c[1]) * 111320 * Math.cos((h.c[0] * Math.PI) / 180)) <= h.r);
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

  // Best rating known now: a rider's own rating, official open data, then the same trail, then an estimate.
  function rate(id, geom, tags) {
    const h = handOf(geom, tags, id);
    const mapped = tags && (tags["mtb:scale:imba"] != null || tags["mtb:scale"] != null) ? " OpenStreetMap rates it differently." : " It has no rating on OpenStreetMap yet.";
    if (h && h.d) return { d: h.d, src: "hand", why: h.who ? `Rated ${LEVEL[h.d]} by ${h.who}, who rides it: ${h.note}.${mapped}`
      : `Rated ${LEVEL[h.d]} by ${h.src}.${mapped}` };
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
