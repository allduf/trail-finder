// Builds data/moto-routes.json from the hand-written list in scripts/moto-routes-spec.mjs.
// Each route is traced on real roads with the public Valhalla router (OSM data),
// dirt % comes from the OSM surface of every edge, fuel stops and camps from OSM
// (Nominatim) within 3 km of the line, and a photo from the route's Wikipedia page.
// Run: node scripts/build-moto-routes.mjs (or pass an id prefix to test one route).
import fs from 'node:fs';

import { REGIONS, ROUTES as R, LINKS } from './moto-routes-spec.mjs';

const UA = { 'user-agent': 'trail-finder-moto/1.0 (github allduf/trail-finder)' };
const V = 'https://valhalla1.openstreetmap.de';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = async (p, b) => { for (let i = 0; i < 4; i++) { try { const r = await fetch(V + p, { method: 'POST', headers: { 'content-type': 'application/json', ...UA }, body: JSON.stringify(b) }); const j = await r.json(); if (j.trip || j.edges || j.error_code) return j; } catch {} await sleep(2000 * 2 ** i); } throw new Error('valhalla ' + p); };
function decode(s, p = 6) { let i = 0, la = 0, lo = 0; const o = []; const f = 10 ** p; while (i < s.length) { for (const k of [0, 1]) { let b, sh = 0, r = 0; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); const d = r & 1 ? ~(r >> 1) : r >> 1; if (k) lo += d; else la += d; } o.push([la / f, lo / f]); } return o; }
const rad = Math.PI / 180;
const dist = (a, b) => { const x = (b[1] - a[1]) * rad * Math.cos((a[0] + b[0]) / 2 * rad), y = (b[0] - a[0]) * rad; return Math.hypot(x, y) * 6371; };
function dp(pts, tol) { const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]]; while (st.length) { const [a, b] = st.pop(); let m = -1, md = tol; const A = pts[a], B = pts[b]; const kx = Math.cos(A[0] * rad); for (let i = a + 1; i < b; i++) { const P = pts[i]; const ax = (B[1] - A[1]) * kx, ay = B[0] - A[0], px = (P[1] - A[1]) * kx, py = P[0] - A[0]; const L = ax * ax + ay * ay; let t = L ? (px * ax + py * ay) / L : 0; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(px - t * ax, py - t * ay); if (d > md) { md = d; m = i; } } if (m > 0) { keep[m] = 1; st.push([a, m], [m, b]); } } return pts.filter((_, i) => keep[i]); }
const simplify = pts => dp(pts, 0.00025); // ~25 m: keeps every bend, far under one point per 100 m
function encode(pts) { let o = '', pa = 0, po = 0; const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let r = ''; while (v >= 32) { r += String.fromCharCode((32 | (v & 31)) + 63); v >>>= 5; } return r + String.fromCharCode(v + 63); };
  for (const [a, b] of pts) { const la = Math.round(a * 1e6), lo = Math.round(b * 1e6); o += enc(la - pa) + enc(lo - po); pa = la; po = lo; } return o; }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BIKES = ['enduro', 'light', 'mid', 'big', 'street'];
const DIRT = new Set(['compacted', 'dirt', 'gravel', 'path', 'impassable']);

const cacheF = process.env.MOTO_POI_CACHE || '/tmp/moto-poi-cache.json';
const poiCache = fs.existsSync(cacheF) ? JSON.parse(fs.readFileSync(cacheF)) : {};
// OSM places of one kind ("fuel" or "camp site") in a 0.25 x 0.5 degree cell: [lat, lon, name, town]
async function poiIn(kind, cell) {
  const key = kind + '|' + cell; if (poiCache[key]) return poiCache[key];
  const [la, lo] = cell.split(',').map(Number);
  const out = []; const boxes = [[lo, la, lo + 0.5, la + 0.25]];
  while (boxes.length) { const [w, s, e, n] = boxes.pop();
    const u = `https://nominatim.openstreetmap.org/search?q=%5B${encodeURIComponent(kind)}%5D&format=jsonv2&addressdetails=1&limit=50&bounded=1&viewbox=${w},${n},${e},${s}`;
    let j = []; for (let i = 0; i < 4; i++) { try { j = await (await fetch(u, { headers: UA })).json(); break; } catch { await sleep(3000 * 2 ** i); } }
    await sleep(1100);
    if (j.length >= 50 && e - w > 0.03) { const mx = (w + e) / 2, my = (s + n) / 2; boxes.push([w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]); continue; }
    for (const x of j) if (x.type === 'fuel' || x.type === 'camp_site') { const a = x.address || {}; out.push([+x.lat, +x.lon, x.name || '', a.city || a.town || a.village || a.hamlet || a.locality || '']); } }
  poiCache[key] = out; fs.writeFileSync(cacheF, JSON.stringify(poiCache)); return out;
}

// One photo per Wikipedia source page (pageimages, 800 px thumbnail).
const photos = {};
{ const titles = [...new Set(R.map(r => r.src).filter(u => u.includes('wikipedia.org/wiki/')).map(u => decodeURIComponent(u.split('/wiki/')[1])))];
  for (let i = 0; i < titles.length; i += 40) {
    const u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages&piprop=thumbnail|name&pithumbsize=800&titles=' + encodeURIComponent(titles.slice(i, i + 40).join('|'));
    let j = null; for (let k = 0; k < 4 && !j; k++) { try { j = await (await fetch(u, { headers: UA })).json(); } catch { await sleep(3000 * 2 ** k); } }
    const back = {}; for (const m of [...(j?.query?.normalized || []), ...(j?.query?.redirects || [])]) back[m.to] = back[m.from] || m.from;
    for (const pg of Object.values(j?.query?.pages || {})) if (pg.thumbnail) { const t = back[pg.title] || pg.title;
      photos[t] = photos[t.replace(/ /g, '_')] = { img: pg.thumbnail.source, page: 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(pg.pageimage) }; }
    await sleep(1000);
  } }

const only = process.argv[2]; const out = [];
for (const r of R) {
  if (only && !r.id.startsWith(only)) continue;
  const locs = r.wp.map(([lat, lon], i) => ({ lat, lon, type: 'break', radius: 300 }));
  const t = await post('/route', { locations: locs, costing: 'auto', costing_options: { auto: { use_ferry: 1 } }, directions_type: 'none' });
  if (!t.trip) { console.error(r.id, 'NO ROUTE', t.error); continue; }
  const pts = t.trip.legs.flatMap(l => decode(l.shape));
  const km = t.trip.summary.length;
  let dirt = 0, all = 0, ferry = false;
  const roads = {};
  for (const l of t.trip.legs) { const q = m => post('/trace_attributes', { encoded_polyline: l.shape, shape_match: m, costing: 'auto', filters: { attributes: ['edge.surface', 'edge.length', 'edge.use', 'edge.names'], action: 'include' } });
    let a = await q('edge_walk'); if (!a.edges) a = await q('walk_or_snap');
    if (!a.edges) console.error(r.id, 'no surface for a leg', a.error);
    for (const e of a.edges || []) { all += e.length; if (e.use === 'ferry') ferry = true; else if (DIRT.has(e.surface)) dirt += e.length; const k = (e.names || ['?'])[0] + '|' + e.surface; roads[k] = (roads[k] || 0) + e.length; } }
  console.error('   ', Object.entries(roads).filter(x => x[1] > 5).sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0] + ' ' + Math.round(x[1])).join('; '));
  // fuel stops and camps within 3 km of the line, as km along it
  const cells = new Set(); for (const p of pts) for (const dy of [-0.03, 0.03]) for (const dx of [-0.05, 0.05]) cells.add(`${Math.floor((p[0] + dy) * 4) / 4},${Math.floor((p[1] + dx) * 2) / 2}`);
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const along = async kind => { const hits = []; for (const c of cells) for (const s of await poiIn(kind, c)) { let best = 9e9, k = 0; for (let i = 0; i < pts.length; i += 3) { const d = dist(s, pts[i]); if (d < best) { best = d; k = i; } } if (best < 3) hits.push({ km: Math.round(cum[k]), n: s[2], at: s[3] }); }
    hits.sort((a, b) => a.km - b.km); return hits.filter((h, i) => !hits.slice(0, i).some(o => Math.abs(o.km - h.km) <= 1 && (o.n === h.n || !h.n))); };
  const fuel = await along('fuel'), camp = await along('camp site');
  const L = cum[cum.length - 1]; const marks = [0, ...fuel.map(f => f.km), L]; let gap = 0; for (let i = 1; i < marks.length; i++) gap = Math.max(gap, marks[i] - marks[i - 1]);
  // one fuel entry per place (a town with 4 stations is one stop)
  const stops = []; for (const f of fuel) { const last = stops[stops.length - 1]; if (last && f.km - last.km <= 3) { last.c = (last.c || 1) + 1; continue; } stops.push({ km: f.km, n: f.n || 'Gas', at: /^Area /.test(f.at) ? '' : f.at }); }
  const camps = camp.filter(c => c.n).slice(0, 30).map(c => ({ km: c.km, n: c.n }));
  const line = simplify(pts).map(([a, b]) => [+a.toFixed(5), +b.toFixed(5)]);
  const fit = BIKES.slice(0, BIKES.indexOf(r.grade === 1 ? 'street' : r.bikes) + 1).reverse();
  const o = { id: r.id, n: r.n, prov: r.prov, km: Math.round(km), dirtPct: all ? Math.round(dirt / all * 100) : 0, grade: r.grade, bikes: fit,
    season: MON[r.season[0] - 1] + '-' + MON[r.season[r.season.length - 1] - 1], fuelGap: Math.round(gap),
    start: line[0], end: line[line.length - 1], line: encode(line), notes: r.notes, src: r.src,
    region: r.region, best: r.best, desc: r.desc, hi: r.hi, hard: r.hard, water: r.water || null, ferries: r.ferries || [], permits: r.permits,
    stops, camps };
  const ph = r.src.includes('/wiki/') && photos[decodeURIComponent(r.src.split('/wiki/')[1])]; if (ph) o.photo = ph;
  if (LINKS[r.id]) o.links = LINKS[r.id];
  if (r.loop) o.loop = true;
  if (ferry) o.ferry = true;
  out.push(o); console.error(r.id.padEnd(26), String(o.km).padStart(5), 'km', String(o.dirtPct).padStart(3) + '% dirt', 'fuelGap', o.fuelGap, 'stops', stops.length, 'camps', camps.length, ferry ? 'FERRY' : '', 'pts', line.length, 'chars', o.line.length);
}
if (only) console.log(JSON.stringify(out.map(o => ({ ...o, line: o.line.length })), null, 1));
if (!only) fs.writeFileSync(new URL('../data/moto-routes.json', import.meta.url), JSON.stringify({ v: 1, built: new Date().toISOString().slice(0, 10), note: 'Traced on OSM roads (Valhalla); dirtPct from OSM surface; fuel stops and camps from OSM within 3 km; photo from the Wikipedia source page. Check closures before riding.', regions: REGIONS, routes: out }));
