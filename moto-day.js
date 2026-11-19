// Day ride (Adventure moto): round-trip loops for one day on the bike, with places to stop on the way.
// alex 2026-11-19: "should show round trip from user location or a start point they chose. propose itinary that you
// can do in a day. maybe ask the user how long he wants to ride and in the ride you propose, propose to go see nice
// spots, hot spring, vue point iconic road/spot."
// The rider picks the start (where they are, the middle of the map, or a place typed in), how long they want to ride
// (2 to 8 hours) and the roads (Most dirt, Mix, Paved, as Plan a route). The app then:
//  1. Gathers places to stop around the start: hot springs (ca/moto/hot.json), named viewpoints, waterfalls and
//     lighthouses (ca/moto/sight.json, built each night from OpenStreetMap by scripts/build-moto.mjs; OpenStreetMap's
//     Overpass when that file isn't there yet) and known scenic roads (data/moto-scenic.json, a hand-made list, each
//     road with its source).
//  2. Makes loops from them that come back to the start: a stretch of a scenic road, or two stops in a triangle, or
//     one stop out and back, about as long as the time asked for (a rough speed for the roads picked).
//  3. Asks the route server (Valhalla, moto.js routeStyled) for each, keeps up to 3 whose riding time is close to the
//     time asked and that head in different directions, and lists every stop the loop passes within 1.5 km.
//  4. For each: the riding time and distance (the router's estimate, without stops), the share of dirt (OpenStreetMap
//     surfaces), closures and road events (moto.js checkLoop: the same check as Plan a route), the rain and snow at
//     points along it and at its highest point (the middle of 3 weather models, wxcheck.js), all as estimates with
//     their sources.
// "Open this loop" hands it to Plan a route (moto.js planAsk with its stops), which has turns, gas for your range,
// high points, cell signal, Ride it, Save, GPX and Save offline. The Today card's Adventure moto section links here.
// Wording: terrain and road facts with their sources, nothing about whether or how to ride; nothing says a road or a
// place is open.
(() => {
  "use strict";
  const map = window.tfLeaflet, H = window.tfMoto && window.tfMoto.trip;
  if (!map || !window.L || !H || !H.routeStyled || window.tfMotoDay) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("tf:" + k, JSON.stringify(v)); } catch {} },
  };
  const svg = H.svg, IC = H.IC, kmB = H.kmBetween, fmtKm = H.fmtKm, fmtH = H.fmtH;
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const HOURS = [2, 3, 4, 6, 8];
  // A rough average speed for each kind of road, only to pick stops at the right distance: the times shown are the
  // router's own.
  const SPEED = { paved: 70, mix: 55, dirt: 40 };
  const KIND = {
    road: { n: "Scenic road", w: 4, d: '<path d="M8 3 4 21M16 3l4 18M12 5v2M12 11v2M12 17v2"/>' },
    hot: { n: "Hot spring", w: 3, d: IC.hot },
    fall: { n: "Waterfall", w: 2, d: '<path d="M4 3h16M7 3v8c0 3 2 5 5 5s5-2 5-5V3"/><path d="M9 21c1-2 5-2 6 0M12 16v5"/>' },
    light: { n: "Lighthouse", w: 2, d: '<path d="M9 21l1.5-13h3L15 21zM8 21h8M10 8l2-4 2 4M5 6l3 1M19 6l-3 1"/>' },
    view: { n: "Viewpoint", w: 1.5, d: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  };
  const FROM = { road: "the app's list of scenic roads", osm: "OpenStreetMap" };
  // The loops' lines on the map: not a road grade colour, an avalanche danger colour or the route's orange.
  const COLS = ["#5f3dc4", "#1098ad", "#a61e4d"];

  const css = document.createElement("style");
  css.textContent = `
#motoPane .md-lab { font-size: .8rem; font-weight: 700; margin: 2px 0 -2px; }
#motoPane .md-hrs { grid-template-columns: repeat(5, 1fr); }
#motoPane .md-loop { border: 1px solid var(--line); border-left: 5px solid var(--c); border-radius: 10px; padding: 9px 10px; display: flex; flex-direction: column; gap: 7px; }
#motoPane .md-loop h4 { margin: 0; font-size: .95rem; }
#motoPane .md-loop .mt-stats { grid-template-columns: repeat(3, 1fr); }
#motoPane .md-kv { display: flex; justify-content: space-between; gap: 10px; font-size: .8rem; }
#motoPane .md-kv > span { color: var(--muted); }
#motoPane .md-kv > b { text-align: right; white-space: nowrap; }
#motoPane .md-stops { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
#motoPane .md-stops li { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: 0 7px; font-size: .82rem; align-items: start; }
#motoPane .md-stops li svg { color: var(--c); margin-top: 1px; }
#motoPane .md-stops small { display: block; color: var(--muted); font-size: .74rem; }
#motoPane .md-stops a { color: inherit; }
#motoPane .md-wait { color: var(--muted); font-size: .82rem; }`;
  document.head.append(css);

  let from = null, hours = store.get("motoDayH", 4), style = null, busy = 0, loops = [], placeBox = null, seq = 0, msg = "";
  const layer = L.layerGroup();
  const styleNow = () => style || (H.planNow ? H.planNow().style : "mix") || "mix";

  // ---------- the card ----------
  function open(o = {}) {
    if (H.toPanel) H.toPanel();
    if (o.from && o.from.ll) from = { ll: [+o.from.ll[0], +o.from.ll[1]], name: o.from.name || "" };
    else if (!from) startHere();
    render();
    const el = $("mtDay");
    if (el && H.showCard) H.showCard(el);
  }
  function startHere() {
    const y = H.you ? H.you() : null;
    if (y) from = { ll: y, name: "Where you are", me: 1 };
    else { const c = map.getCenter(); from = { ll: [c.lat, c.lng], name: "The middle of the map" }; }
  }
  function close() { seq++; busy = 0; loops = []; layer.remove(); layer.clearLayers(); const el = $("mtDay"); if (el) el.hidden = true; }

  function render() {
    const el = $("mtDay");
    if (!el) return;
    el.hidden = false;
    const st = styleNow(), STY = H.STYLES || {};
    el.innerHTML = `<header>${svg(IC.loop)}<h3>Day ride</h3><button type="button" class="mt-x" aria-label="Close">${svg(IC.x, 16)}</button></header>
      <p class="mt-note">Loops that come back to where you start, with places to stop on the way.</p>
      <p class="md-lab">Where you start</p>
      <div class="mt-row"><button type="button" class="mt-pill${from && from.me ? " on" : ""}" data-d="me">${svg(IC.me, 16)}Where I am</button><button type="button" class="mt-pill" data-d="mid">${svg(IC.pin, 16)}Middle of the map</button></div>
      <div class="md-place"></div>
      <p class="mt-note"><span>Starting from</span>: <b>${esc(from ? from.name || "" : "")}</b></p>
      <p class="md-lab">How long do you want to ride?</p>
      <div class="mt-seg md-hrs" role="group" aria-label="Riding time">${HOURS.map((h) => `<button type="button" data-h="${h}" class="${h === hours ? "on" : ""}">${h} h</button>`).join("")}</div>
      <p class="md-lab">Roads</p>
      <div class="mt-seg" role="group" aria-label="Roads">${Object.entries(STY).map(([k, s]) => `<button type="button" data-st="${k}" class="${k === st ? "on" : ""}">${esc(s.label)}<small>${esc(s.sub)}</small></button>`).join("")}</div>
      <div class="mt-row"><button type="button" class="mt-pill go" data-d="find"${busy ? " disabled" : ""}>${svg(IC.loop, 16)}Find loops</button></div>
      <div id="mdOut">${outHtml()}</div>
      <p class="mt-note">Riding times and distances: the route server's estimate (Valhalla, on OpenStreetMap roads), without the stops. Hot springs, viewpoints, waterfalls and lighthouses: OpenStreetMap. Scenic roads: the app's own list, each with its source. A place may be closed, on private land or reached on foot.</p>
      ${window.tfRiskLine ? window.tfRiskLine() : ""}`;
    const slot = el.querySelector(".md-place");
    if (window.tfPlaceSearch) {
      if (!placeBox) placeBox = window.tfPlaceSearch.box({ placeholder: "Or type where you start", label: "Type where you start", button: "Use", onPick: (p) => { from = { ll: [p.lat, p.lon], name: p.name }; loops = []; msg = ""; layer.clearLayers(); render(); } });
      slot.replaceWith(placeBox);
    } else slot.remove();
    el.querySelector(".mt-x").onclick = close;
    el.querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => { hours = +b.dataset.h; store.set("motoDayH", hours); render(); }));
    el.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => { style = b.dataset.st; render(); }));
    el.querySelectorAll("[data-d]").forEach((b) => (b.onclick = () => act(b.dataset.d)));
    wireOut(el);
  }
  function act(a) {
    if (a === "me") {
      const y = H.you ? H.you() : null;
      if (!y) { if (H.hint) H.hint("Turn on your location (◎ on the map) first."); return; }
      from = { ll: y, name: "Where you are", me: 1 }; loops = []; msg = ""; layer.clearLayers(); render();
    } else if (a === "mid") { const c = map.getCenter(); from = { ll: [c.lat, c.lng], name: "The middle of the map" }; loops = []; msg = ""; layer.clearLayers(); render(); }
    else if (a === "find") find();
  }

  // ---------- places to stop ----------
  let scenic = null;
  const scenicRoads = () => (scenic = scenic || H.getJ("data/moto-scenic.json", 15000).then((j) => (j.roads || []).filter((r) => r.pts && r.pts.length > 1)).catch(() => { scenic = null; return []; }));
  let sightAll = null;   // the nightly file, all of Canada
  const sightCells = new Map();   // from Overpass while that file isn't there: by 1° cell
  async function sightsNear(S, R) {
    if (sightAll === null) sightAll = H.getJ("ca/moto/sight.json", 20000).then((j) => (j.list || []).map((p) => ({ ll: [p[0], p[1]], n: H.realName(p[2]), k: KIND[p[3]] ? p[3] : "view", id: "s" + (p[4] || `${p[0]},${p[1]}`) })).filter((p) => p.n)).catch(() => false);
    const all = await sightAll;
    if (all) return all.filter((p) => kmB(S, p.ll) <= R);
    // Overpass: the named ones only, for the box around the start (1° cells, kept for the visit).
    const dLat = R / 111, dLon = R / (111 * Math.cos((S[0] * Math.PI) / 180)), todo = [];
    for (let la = Math.floor(S[0] - dLat); la <= Math.floor(S[0] + dLat); la++) for (let lo = Math.floor(S[1] - dLon); lo <= Math.floor(S[1] + dLon); lo++) if (!sightCells.has(`${la},${lo}`)) todo.push([la, lo]);
    if (todo.length) {
      const s = Math.min(...todo.map((c) => c[0])), w = Math.min(...todo.map((c) => c[1])), n = Math.max(...todo.map((c) => c[0])) + 1, e = Math.max(...todo.map((c) => c[1])) + 1, b = `${s},${w},${n},${e}`;
      const q = `[out:json][timeout:30];(nwr["tourism"="viewpoint"]["name"](${b});nwr["waterway"="waterfall"]["name"](${b});nwr["natural"="waterfall"]["name"](${b});nwr["man_made"="lighthouse"]["name"](${b}););out center tags qt;`;
      let j = null;
      for (const u of H.OVERPASS || []) { try { j = await H.getJ(u, 35000, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } }); break; } catch {} }
      if (j) {
        todo.forEach((c) => sightCells.set(`${c[0]},${c[1]}`, []));
        for (const x of j.elements || []) {
          const g = x.tags || {}, lat = x.lat != null ? x.lat : x.center && x.center.lat, lon = x.lon != null ? x.lon : x.center && x.center.lon, n = H.realName(g.name);
          if (lat == null || !n || /^(private|no)$/.test(g.access || "")) continue;
          const key = `${Math.floor(lat)},${Math.floor(lon)}`;
          if (sightCells.has(key)) sightCells.get(key).push({ ll: [lat, lon], n, k: g.tourism === "viewpoint" ? "view" : g.man_made === "lighthouse" ? "light" : "fall", id: x.type[0] + x.id });
        }
      }
    }
    return [...sightCells.values()].flat().filter((p) => kmB(S, p.ll) <= R);
  }
  async function stopsNear(S, R) {
    const [hot, sights] = await Promise.all([H.ptsOf("hot").catch(() => []), sightsNear(S, R).catch(() => [])]);
    const out = (hot || []).filter((p) => H.realName(p[2])).map((p) => ({ ll: [p[0], p[1]], n: H.realName(p[2]), k: "hot", id: "h" + (p[4] || `${p[0]},${p[1]}`) })).filter((p) => kmB(S, p.ll) <= R).concat(sights);
    // The same name within 1 km is one place (a viewpoint mapped as a point and as an area).
    const keep = [];
    for (const p of out) if (!keep.some((q) => q.n === p.n && kmB(q.ll, p.ll) < 1)) keep.push(p);
    return keep;
  }

  // ---------- loops ----------
  const bearing = (a, b) => { const y = (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), x = b[0] - a[0]; return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360; };
  const angGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
  const mid = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  // T: the length asked for (km). Each idea: { vias: [[lat, lon]...], names, main (what it's built on), est (km), sc }.
  function ideas(S, T, stops, roads) {
    const out = [], WIND = 1.3;   // roads wind about 30% more than a straight line
    for (const r of roads) {
      const P = r.pts;
      if (!P.some((p) => kmB(S, p) <= T * 0.5)) continue;
      const cum = [0];
      for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + kmB(P[i - 1], P[i]));
      let best = null;
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const Lr = (cum[j] - cum[i]) * 1.1;
        if (Lr < Math.min(30, T * 0.2)) continue;
        const est = WIND * (kmB(S, P[i]) + kmB(S, P[j])) + Lr, dev = Math.abs(est - T) / T;
        if (dev > 0.35) continue;
        const sc = KIND.road.w + (2 * Lr) / T - 4 * dev;
        if (!best || sc > best.sc) best = { i, j, est, sc };
      }
      if (!best) continue;
      let { i, j } = best;
      if (kmB(S, P[j]) < kmB(S, P[i])) [i, j] = [j, i];   // ride to its nearer end first
      const m = Math.round((i + j) / 2), vias = [P[i], ...(m !== i && m !== j ? [P[m]] : []), P[j]];
      out.push({ vias, names: vias.map((v, k) => (k === 0 || k === vias.length - 1 ? r.n : "")), main: "r:" + r.n, road: r, est: best.est, sc: best.sc, dir: bearing(S, mid(vias)) });
    }
    const near = stops.map((p) => ({ ...p, d: kmB(S, p.ll) })).filter((p) => p.d >= Math.max(4, T * 0.06) && p.d <= T * 0.45);
    const ideal = T / 3.6, fit = (p) => KIND[p.k].w - Math.abs(p.d - ideal) / ideal;
    const top = near.sort((a, b) => fit(b) - fit(a)).slice(0, 40);
    for (let a = 0; a < top.length; a++) {
      const A = top[a];
      const est1 = 2.6 * A.d, dev1 = Math.abs(est1 - T) / T;   // out and back
      if (dev1 <= 0.3) out.push({ vias: [A.ll], names: [A.n], stops: [A], main: A.id, est: est1, sc: KIND[A.k].w - 1.5 - 4 * dev1, dir: bearing(S, A.ll) });
      for (let b = a + 1; b < top.length; b++) {
        const B = top[b], ab = kmB(A.ll, B.ll);
        if (ab < 5) continue;
        const est = WIND * (A.d + ab + B.d), dev = Math.abs(est - T) / T;
        if (dev > 0.3) continue;
        out.push({ vias: [A.ll, B.ll], names: [A.n, B.n], stops: [A, B], main: A.id + "|" + B.id, ids: [A.id, B.id], est, sc: KIND[A.k].w + KIND[B.k].w - 4 * dev, dir: bearing(S, mid([A.ll, B.ll])) });
      }
    }
    return out.sort((x, y) => y.sc - x.sc);
  }
  // Points about every km along a line (for "what is it near" checks).
  function thin(line, km = 1) { const out = []; let last = null, at = 0; for (let i = 0; i < line.length; i++) { const p = line[i]; if (last) at += kmB(last, p); if (!out.length || at - out[out.length - 1].km >= km) out.push({ p, km: at }); last = p; } return out; }
  const nearLine = (T, ll) => { let best = { d: 1e9, km: 0 }; for (const t of T) { const d = kmB(t.p, ll); if (d < best.d) best = { d, km: t.km }; } return best; };
  // The stops a routed loop goes by (1.5 km), in order along it; the scenic roads it follows for 10 km or more.
  function onTheWay(r, idea, stops, roads) {
    const T = thin(r.line), out = [];
    for (const p of stops) { const n = nearLine(T, p.ll); if (n.d <= 1.5) out.push({ ...p, at: n.km, off: n.d }); }
    // A stop the loop was built on but the road doesn't reach (a hot spring up a trail): listed with how far.
    for (const p of idea.stops || []) if (!out.some((q) => q.id === p.id)) { const n = nearLine(T, p.ll); out.push({ ...p, at: n.km, off: n.d }); }
    for (const rd of roads) {
      const hits = rd.pts.map((p) => nearLine(T, p)).filter((n) => n.d <= 1);
      if (hits.length >= 2 || (idea.road === rd && hits.length)) out.push({ n: rd.n, k: "road", ll: rd.pts[Math.floor(rd.pts.length / 2)], at: Math.min(...hits.map((h) => h.km)), off: 0, road: rd, id: "r:" + rd.n });
    }
    // The same road both ways: how much of the loop.
    let same = 0;
    for (let i = 0; i < T.length; i++) if (T.some((t, j) => Math.abs(j - i) > 8 && kmB(t.p, T[i].p) < 0.15)) same++;
    const list = out.sort((a, b) => a.at - b.at);
    const keep = [];
    for (const s of list) if (!keep.some((k) => k.id === s.id)) keep.push(s);
    return { stops: keep.slice(0, 8), same: T.length ? same / T.length : 0 };
  }
  const titleOf = (st) => { const big = st.filter((s) => s.k === "road" || s.k === "hot"); const pick = (big.length ? big : st).slice(0, 2); return pick.map((s) => s.n); };

  async function find() {
    if (busy) return;
    if (!from) startHere();
    if (window.tfRiskOk && !(await window.tfRiskOk("route"))) return;
    const my = ++seq, S = from.ll.slice(), st = styleNow(), T = hours * SPEED[st];
    busy = 1; loops = []; msg = "Looking for hot springs, viewpoints and scenic roads around the start…"; layer.clearLayers(); render();
    let [stops, roadsAll] = await Promise.all([stopsNear(S, T * 0.5), scenicRoads()]);
    if (my !== seq) return;
    let roads = roadsAll.filter((r) => r.pts.some((p) => kmB(S, p) <= T * 0.6));
    let list = ideas(S, T, stops, roads);
    if (!list.length) { busy = 0; msg = `No hot springs, viewpoints or scenic roads mapped in the right places for a ${hours} h loop from here. Try another riding time, or plan your own in Plan a route.`; render(); return; }
    // Up to 8 asks to the route server, for 3 loops that head different ways and fit the time.
    const tried = [], got = [], speeds = [];
    const tryList = async (L2) => {
      for (const idea of L2) {
        if (got.length >= 3 || tried.length >= 8) return;
        if ([...got, ...tried].some((g) => g.main === idea.main || (idea.ids && g.ids && idea.ids.some((x) => g.ids.includes(x))))) continue;
        if (got.some((g) => angGap(g.idea.dir, idea.dir) < 50)) continue;
        tried.push(idea);
        msg = `Checking loop ideas on the roads (${tried.length})…`; outOnly();
        const locs = [S, ...idea.vias, S];
        let r = null;
        try { r = await H.routeStyled(locs, st); } catch { r = null; }
        if (my !== seq) return;
        if (!r || !r.line || r.line.length < 2 || !r.time) continue;
        speeds.push(r.km / (r.time / 3600));
        const f = r.time / 3600 / hours;
        if (f < 0.6 || f > 1.45) continue;
        const w = onTheWay(r, idea, stops, roads);
        got.push({ idea, main: idea.main, ids: idea.ids, r, locs, f, ...w });
      }
    };
    await tryList(list);
    if (my !== seq) return;
    // The roads here are faster or slower than the rough speed: once more with the speed the router gave.
    if (got.length < 3 && tried.length < 8 && speeds.length) {
      const v = speeds.slice().sort((a, b) => a - b)[speeds.length >> 1], T2 = hours * v;
      if (Math.abs(T2 - T) / T > 0.2) {
        if (T2 > T) { stops = await stopsNear(S, T2 * 0.5); roads = roadsAll.filter((r) => r.pts.some((p) => kmB(S, p) <= T2 * 0.6)); }
        if (my !== seq) return;
        await tryList(ideas(S, T2, stops, roads));
        if (my !== seq) return;
      }
    }
    if (!got.length) { busy = 0; msg = navigator.onLine ? `None of the loop ideas came close to ${hours} h on the roads. Try another riding time or other roads.` : "No signal: Day ride needs the route server."; render(); return; }
    loops = got.sort((a, b) => Math.abs(1 - a.f) - Math.abs(1 - b.f));
    loops.forEach((x, i) => (x.col = COLS[i]));
    msg = ""; draw(); render();
    map.fitBounds(L.latLngBounds(loops.flatMap((x) => x.r.line)).pad(0.1));
    // The facts for each, one at a time (the public route server): surfaces and closures, then heights.
    for (const x of loops) {
      x.check = "wait"; outOnly();
      try { x.check = await H.checkLoop(x.r, x.locs); } catch { x.check = null; }
      if (my !== seq) return;
      try { const h = await H.heightsOf(x.r.line, x.r.km); x.high = h.length ? h.reduce((a, b) => (b.m > a.m ? b : a)) : null; x.heights = h; } catch { x.high = null; }
      if (my !== seq) return;
      outOnly();
    }
    await weather(my);
    if (my !== seq) return;
    busy = 0; render();
  }

  // ---------- rain and snow along each loop: the middle of 3 models (wxcheck.js) ----------
  async function weather(my) {
    const pts = [];
    for (const x of loops) {
      const T = thin(x.r.line, 2), at = (k) => T[Math.min(T.length - 1, Math.round(k * (T.length - 1)))].p;
      const hAt = (p) => { if (!x.heights || !x.heights.length) return null; let b = x.heights[0], bd = 1e9; for (const h of x.heights) { const d = kmB(h.p, p); if (d < bd) { bd = d; b = h; } } return Math.round(b.m); };
      x.wxAt = [at(0), at(1 / 3), at(2 / 3)].map((p) => ({ p, m: hAt(p) }));
      if (x.high) x.wxAt.push({ p: x.high.p, m: Math.round(x.high.m), top: 1 });
      x.wxAt.forEach((w) => { w.i = pts.length; pts.push(w); });
    }
    if (!pts.length) return;
    const q = new URLSearchParams({ latitude: pts.map((w) => w.p[0].toFixed(3)).join(","), longitude: pts.map((w) => w.p[1].toFixed(3)).join(","),
      hourly: "precipitation,snowfall,temperature_2m", past_days: "2", forecast_days: "2", timezone: "GMT" });
    if (pts.every((w) => w.m != null)) q.set("elevation", pts.map((w) => w.m).join(","));
    const url = `https://api.open-meteo.com/v1/forecast?${q}`;
    let j = null;
    try { j = await (window.tfWx ? window.tfWx.getChecked(url, 20000) : H.getJ(url, 20000)); } catch { j = null; }
    if (my !== seq) return;
    const arr = j ? (Array.isArray(j) ? j : [j]) : [];
    const now = Date.now();
    const sum = (w) => {
      const h = w && w.hourly;
      if (!h || !h.time) return null;
      const t = h.time.map((x) => Date.parse(x + ":00Z"));
      const add = (k, a, b) => t.reduce((s, x, i) => (x > a && x <= b ? s + (h[k][i] || 0) : s), 0);
      const nxt = t.map((x, i) => (x > now && x <= now + 864e5 ? h.temperature_2m[i] : null)).filter((v) => v != null);
      return { past: add("precipitation", now - 2 * 864e5, now), next: add("precipitation", now, now + 864e5), snow: add("snowfall", now, now + 864e5), low: nxt.length ? Math.min(...nxt) : null };
    };
    for (const x of loops) {
      const s = x.wxAt.map((w) => ({ ...w, s: sum(arr[w.i]) })).filter((w) => w.s);
      x.wx = s.length ? { past: Math.max(...s.map((w) => w.s.past)), next: Math.max(...s.map((w) => w.s.next)), snow: Math.max(...s.map((w) => w.s.snow)), top: s.find((w) => w.top) || null, w: arr[x.wxAt[0].i] } : null;
    }
    wxNote = arr[0] && window.tfWx ? window.tfWx.noteHtml(arr[0], { cls: "mt-note" }) : "";
    wxErr = !arr.length;
  }
  let wxNote = "", wxErr = false;

  // ---------- drawing ----------
  function draw() {
    layer.clearLayers();
    loops.forEach((x, i) => {
      const pl = L.polyline(x.r.line, { color: x.col, weight: 6, opacity: 0.9 });
      pl.on("click", () => { const el = document.querySelector(`#mtDay [data-loop="${i}"]`); if (el && H.showCard) H.showCard(el); });
      layer.addLayer(pl);
      x.stops.forEach((s) => { if (s.k !== "road") layer.addLayer(L.circleMarker(s.ll, { radius: 6, color: "#fff", weight: 2, fillColor: x.col, fillOpacity: 1 }).bindTooltip(s.n)); });
    });
    layer.addTo(map);
  }

  // ---------- the results ----------
  const mm = (v) => (v == null ? "–" : v < 0.5 ? "0 mm" : `${Math.round(v)} mm`);
  const cm = (v) => (v == null ? "–" : v < 0.5 ? "0 cm" : `${Math.round(v)} cm`);
  const kv = (k, v) => `<div class="md-kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  function stopHtml(s) {
    const K = KIND[s.k] || KIND.view;
    const src = s.road && s.road.src ? ` · <a href="${esc(s.road.src)}" target="_blank" rel="noopener">source</a>` : "";
    const extra = s.road ? [s.road.why, s.road.surf ? `Surface: ${s.road.surf}` : "", s.road.note || ""] : [s.off > 1.5 ? `About ${fmtKm(s.off)} from the road` : ""];
    return `<li>${svg(K.d, 18)}<span><b>${esc(s.n)}</b><small><span>${esc(K.n)}</span> · <span>${esc(s.k === "road" ? FROM.road : FROM.osm)}</span>${src}</small>${extra.filter(Boolean).map((t) => `<small>${esc(t)}</small>`).join("")}</span></li>`;
  }
  function checkHtml(x) {
    if (x.check === "wait" || x.check === undefined) return `<p class="md-wait">Checking surfaces and closures…</p>`;
    const c = x.check;
    if (!c) return `<p class="mt-note">Couldn't check surfaces and closures on this loop: open it to try again.</p>`;
    let h = c.pct == null ? "" : kv("Dirt (OpenStreetMap surfaces)", `${c.pct}%`);
    const cl = c.closures;
    if (!cl) h += `<p class="mt-note">Couldn't check closures: open the loop to try again.</p>`;
    else {
      const stop = cl.items.filter((i) => i.stop), warn = cl.items.filter((i) => !i.stop);
      h += stop.slice(0, 3).map((i) => `<div class="mt-warn"><b>Closed on this loop:</b> ${esc(i.label)}</div>`).join("");
      if (warn.length) h += `<div class="mt-warn hard"><span>Road events and warnings on it</span>: <b>${warn.length}</b>. <span>Open the loop to see them.</span></div>`;
      if (!stop.length && !warn.length) h += `<p class="mt-note">No closures, gates, washouts or fire closures found on it in the sources the app reads${cl.failed && cl.failed.length ? ` (couldn't load ${esc(cl.failed.join(", "))})` : ""}.</p>`;
    }
    return h;
  }
  function wxHtml(x) {
    if (!x.wx) return busy ? `<p class="md-wait">Checking rain and snow along it…</p>` : wxErr ? `<p class="mt-note">The weather didn't load: open the loop for its high points.</p>` : "";
    let h = kv("Rain or snow, last 2 days (most at any point checked)", mm(x.wx.past)) + kv("Rain or snow, next 24 h", mm(x.wx.next));
    const t = x.wx.top;
    if (t && t.m >= 800) h += kv(`Highest point, about ${Math.round(t.m).toLocaleString()} m: new snow next 24 h`, cm(t.s.snow)) + (t.s.low != null ? kv("Lowest temperature there, next 24 h", `${Math.round(t.s.low)}°C`) : "");
    if (x.check && x.check.pct >= 10 && x.wx.past >= 5) h += `<p class="mt-note">Dirt roads can stay muddy for days after rain.</p>`;
    return h;
  }
  function loopHtml(x, i) {
    const names = titleOf(x.stops);
    const title = names.length ? `<span>Via</span> ${names.map((n) => `<span>${esc(n)}</span>`).join(" <span>and</span> ")}` : `<span>Loop</span> ${i + 1}`;
    return `<div class="md-loop" data-loop="${i}" style="--c:${x.col}">
      <h4>${title}</h4>
      <div class="mt-stats"><div><b>${fmtH(x.r.time)}</b><span>riding, estimate</span></div><div><b>${fmtKm(x.r.km)}</b><span>distance</span></div><div><b>${x.stops.length}</b><span>${x.stops.length === 1 ? "stop" : "stops"}</span></div></div>
      ${x.stops.length ? `<ul class="md-stops">${x.stops.map(stopHtml).join("")}</ul>` : ""}
      ${x.same >= 0.3 ? `<p class="mt-note"><span>Same road both ways for about</span> ${Math.round(x.same * 100)}% <span>of it.</span></p>` : ""}
      ${x.r.ferry ? `<p class="mt-note">It uses a ferry: check its schedule.</p>` : ""}
      ${checkHtml(x)}${wxHtml(x)}
      <div class="mt-row"><button type="button" class="mt-pill go" data-open="${i}">${svg(IC.plan, 16)}Open this loop</button><button type="button" class="mt-pill" data-show="${i}">${svg(IC.pin, 16)}Show</button></div></div>`;
  }
  function outHtml() {
    const top = msg ? `<p class="${busy ? "md-wait" : "mt-note"}">${esc(msg)}</p>` : "";
    if (!loops.length) return top;
    return `${top}<p class="mt-note"><span>Loops for about</span> ${hours} h <span>of riding from</span> ${esc(from.name)}:</p>${loops.map(loopHtml).join("")}
      ${wxNote}<p class="mt-note">Rain, snow and temperatures: an estimate for points along each loop and its highest point. Closures: the same check as Plan a route (forest road status, gates, motor vehicle closures, wildfires and each province's 511). Things change faster than any map.</p>`;
  }
  function outOnly() { const o = $("mdOut"); if (o) { o.innerHTML = outHtml(); wireOut(o); } }
  function wireOut(el) {
    el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openLoop(loops[+b.dataset.open])));
    el.querySelectorAll("[data-show]").forEach((b) => (b.onclick = () => { const x = loops[+b.dataset.show]; if (!x) return; const fit = () => map.fitBounds(L.latLngBounds(x.r.line).pad(0.1)); if (phone() && window.tfSnapTo) { window.tfSnapTo("peek"); setTimeout(fit, 400); } else fit(); }));
  }
  // Plan a route takes it from here: the points, the style, back to the start, and the stops for its card.
  function openLoop(x) {
    if (!x || !H.planAsk) return;
    const names = titleOf(x.stops);
    const pts = [{ ll: x.locs[0], name: from.name === "Where you are" || from.name === "The middle of the map" ? "Start" : from.name }, ...x.idea.vias.map((ll, i) => ({ ll, name: x.idea.names[i] || "" }))];
    const stops = x.stops.map((s) => ({ name: s.n, kind: (KIND[s.k] || KIND.view).n, ll: s.ll, src: s.road ? s.road.src : "", from: s.k === "road" ? FROM.road : FROM.osm }));
    seq++; busy = 0; layer.remove(); layer.clearLayers();
    const el = $("mtDay"); if (el) el.hidden = true;
    H.planAsk({ pts, loop: true, style: styleNow(), stops, title: names.length ? `Via ${names.join(" and ")}` : "Day ride" });
  }

  window.tfMotoDay = { open, close };
})();
