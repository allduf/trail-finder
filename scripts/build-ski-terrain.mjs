// The avalanche terrain class of every backcountry ski route (Skiing mode): data/ski-terrain.json.
// For each ski touring, ski access, snowshoe and other winter route in data/ski.json and data/ski-canada/: an estimate of its terrain class
// (1 Simple, 2 Challenging, 3 Complex, like ATES), its lowest and highest points, and the numbers behind the class,
// worked out by ski-terrain.js (the same file the site uses for a route's details) from the AWS terrain tiles.
// The site uses it for the trip planner light in the route list (Avaluator chart: today's danger rating with the
// terrain class), and the phone alerts for watched tours read the same numbers.
// Terrain doesn't change, so a route whose line hasn't changed keeps last night's numbers (only new or changed routes
// are worked out again).
// Run: node scripts/build-ski-terrain.mjs   (Node 18 or newer, no packages; after build-winter.mjs ONLY=ski)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
await import(new URL("ski-terrain.js", root).href);
const T = globalThis.tfTerrain;
const V = 1;   // bump when ski-terrain.js changes how a class is worked out: every route is done again
const TYPES = new Set(["tour", "access", "other", "snowshoe"]);
const LIMIT_MIN = Number(process.env.LIMIT_MIN || 30);   // stop starting new routes after this many minutes (the rest next night)
const t0 = Date.now();

const ski = JSON.parse(readFileSync(new URL("data/ski.json", root), "utf8"));
// And the backcountry routes in the rest of Canada (data/ski-canada/, one file per map square), after the home region's.
const canDir = new URL("data/ski-canada/", root);
const canTiles = existsSync(new URL("index.json", canDir)) ? Object.keys(JSON.parse(readFileSync(new URL("index.json", canDir), "utf8")).tiles || {}) : [];
const canada = canTiles.flatMap((k) => { try { return JSON.parse(readFileSync(new URL(k + ".json", canDir), "utf8")).routes || []; } catch { return []; } });
const outPath = new URL("data/ski-terrain.json", root);
const old = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
const prev = old && old.v === V ? old.routes || {} : {};

// ---------- terrain tiles: Terrarium PNGs (RGB, 8 bits) decoded with zlib, kept in a small cache ----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let p = 8, w = 0, h = 0, type = 0, depth = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), kind = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; if (data[12]) throw new Error("interlaced PNG"); }
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6)) throw new Error(`PNG type ${type}/${depth}`);
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  const e = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) e[i] = px[i * bpp] * 256 + px[i * bpp + 1] + px[i * bpp + 2] / 256 - 32768;
  return e;
}
const cache = new Map();
let fetched = 0;
function dem(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) { const v = cache.get(key); cache.delete(key); cache.set(key, v); return v; }
  const p = (async () => {
    for (let tries = 0; ; tries++) {
      try {
        const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const e = decodePng(Buffer.from(await r.arrayBuffer()));
        e.z = z; fetched++;
        return e;
      } catch (err) { if (tries >= 2) throw err; await new Promise((ok) => setTimeout(ok, 2000 * (tries + 1))); }
    }
  })();
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  if (cache.size > 400) cache.delete(cache.keys().next().value);   // ~100 MB of heights
  return p;
}

// ---------- each route ----------
const usable = (r) => TYPES.has(r.type) && !r.area && r.g && r.g.length;
const home = (ski.routes || []).filter(usable);
const hashOf = (r) => createHash("sha1").update(JSON.stringify(r.g)).digest("base64").slice(0, 10);
// Routes near each other one after another, so their tiles are still in the cache.
const cellOf = (r) => `${Math.floor(r.g[0][0] * 10)},${Math.floor(r.g[0][1] * 10)}`;
home.sort((a, b) => cellOf(a).localeCompare(cellOf(b)));
const routes = [...home, ...canada.filter(usable).sort((a, b) => cellOf(a).localeCompare(cellOf(b)))];
const out = {};
let kept = 0, done = 0, failed = 0, skipped = 0;
const r1 = (v) => Math.round(v * 10) / 10;
for (const r of routes) {
  const h = hashOf(r);
  if (prev[r.id] && prev[r.id].h === h) { out[r.id] = prev[r.id]; kept++; continue; }
  if ((Date.now() - t0) / 60000 > LIMIT_MIN) { skipped++; continue; }
  try {
    const lines = r.g.map((flat) => { const l = []; for (let i = 0; i < flat.length; i += 2) l.push([flat[i], flat[i + 1]]); return l; });
    const info = await T.info(lines, dem);
    const c = T.terrainClass(info);
    out[r.id] = { h, c: c.c, lo: Math.round(info.min), hi: Math.round(info.max), top: [Math.round(info.top.lat * 1e5) / 1e5, Math.round(info.top.lon * 1e5) / 1e5],
      k30: r1(info.km30), k35: r1(info.km35), ab: info.above == null ? null : r1(info.above), tr: info.traps == null ? null : r1(info.traps) };
    done++;
    if (done % 100 === 0) console.log(`${done} routes worked out, ${fetched} tiles, ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) { failed++; if (prev[r.id]) out[r.id] = prev[r.id]; console.log(`${r.id}: ${e.message}`); }
}
const count = [0, 0, 0, 0];
Object.values(out).forEach((x) => count[x.c]++);
writeFileSync(outPath, JSON.stringify({ v: V, builtAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"), source: "Estimated from AWS Terrain Tiles (Mapzen) by ski-terrain.js; not an official ATES rating", routes: out }));
console.log(`${routes.length} routes: ${kept} kept, ${done} worked out, ${failed} failed, ${skipped} left for next time; ${fetched} tiles in ${Math.round((Date.now() - t0) / 1000)} s.`);
console.log(`Simple ${count[1]}, Challenging ${count[2]}, Complex ${count[3]}.`);
