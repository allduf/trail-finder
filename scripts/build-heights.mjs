// Trail heights in our own data (fix list 2026-10-28, item 8): the height of every point of every trail in the All
// trails lists (data/mtb-<zone>.json), so the trail card's down/up metres, profile and "which end is higher" don't
// depend on Open-Meteo, whose "too many requests" blanked them together with the weather and loam.
//
// Writes data/heights-<zone>.json: { v: 1, builtAt, ways: { <way id>: [fp, h0, h1, ...] } }, one height (whole metres)
// per point of the way's "g" in the mtb file, in the same order. fp is a fingerprint of the way's shape, so a way that
// didn't change keeps its heights without asking for the tiles again.
// Heights come from AWS Terrain Tiles (Mapzen Terrarium, free, no key) at zoom 13 (about 12 m), the same tiles and
// zoom Plan a route uses, so a trail's card and a route over it agree.
//
// Run: node scripts/build-heights.mjs   (Node 18 or newer, no packages needed; HEIGHTS_MINUTES limits the time)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");
const ZONES = [...html.matchAll(/\{ id: "(\w+)", name: "([^"]+)", box: \[([^\]]+)\] \}/g)].map((m) => ({ id: m[1], name: m[2] }));
if (ZONES.length < 2) throw new Error("Couldn't read the zones from index.html");
const Z = 13, TILE = (x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
const UA = "trail-finder heights data (https://github.com/allduf/trail-finder)";
const MINUTES = +process.env.HEIGHTS_MINUTES || 20, started = Date.now(), outOfTime = () => Date.now() - started > MINUTES * 60e3;
const log = (...a) => console.log(...a);
const read = (name) => { try { return JSON.parse(readFileSync(new URL("data/" + name, root), "utf8")); } catch { return null; } };

// ---------- Terrarium tiles: PNG (8-bit RGB or RGBA) to heights, height = R * 256 + G + B / 256 - 32768 ----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let p = 8, w = 0, h = 0, type = 0, depth = 0, pal = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), kind = buf.toString("ascii", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; if (data[12]) throw new Error("interlaced PNG"); }
    else if (kind === "PLTE") pal = data;
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || ![2, 3, 6].includes(type)) throw new Error(`PNG type ${type}/${depth}`);
  const bpp = type === 2 ? 3 : type === 6 ? 4 : 1, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[row + i - bpp] : 0, b = y ? px[up + i] : 0, c = i >= bpp && y ? px[up + i - bpp] : 0;
      let v = raw[src + i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + i] = v & 255;
    }
  }
  const e = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = type === 3 ? [pal[px[i] * 3], pal[px[i] * 3 + 1], pal[px[i] * 3 + 2]] : [px[i * bpp], px[i * bpp + 1], px[i * bpp + 2]];
    e[i] = r * 256 + g + b / 256 - 32768;
  }
  return e;
}
const tiles = new Map();   // "x/y" -> Promise<Float32Array | null>
let asked = 0;
async function fetchTile(x, y) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(TILE(x, y), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404 || r.status === 403) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      asked++;
      return decodePng(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      if (i === 3) { log(`  tile ${Z}/${x}/${y}: ${e.message}`); return null; }
      await new Promise((ok) => setTimeout(ok, 2000 * 2 ** i));
    }
  }
}
const tile = (x, y) => { const k = x + "/" + y; if (!tiles.has(k)) tiles.set(k, fetchTile(x, y)); return tiles.get(k); };
const pixXY = (lat, lon) => {
  const n = 2 ** Z, s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n * 256 - 0.5, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256 - 0.5];
};
// Every tile a list of points needs (with the next pixel, for the blend at a tile's edge), loaded 8 at a time.
async function loadFor(pts) {
  const need = new Set();
  pts.forEach(([lat, lon]) => {
    const [X, Y] = pixXY(lat, lon), x = Math.floor(X), y = Math.floor(Y);
    [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].forEach(([a, b]) => need.add(Math.floor(a / 256) + "/" + Math.floor(b / 256)));
  });
  const list = [...need].filter((k) => !tiles.has(k));
  for (let i = 0; i < list.length; i += 8) await Promise.all(list.slice(i, i + 8).map((k) => tile(...k.split("/").map(Number))));
}
// The height at a point, blended from the four pixels around it like planner.js does (null where there's no tile).
async function heightAt(lat, lon) {
  const [X, Y] = pixXY(lat, lon), x = Math.floor(X), y = Math.floor(Y), u = X - x, v = Y - y;
  const px = async (a, b) => { const t = await tile(Math.floor(a / 256), Math.floor(b / 256)); return t ? t[(b & 255) * 256 + (a & 255)] : null; };
  const [h00, h10, h01, h11] = await Promise.all([px(x, y), px(x + 1, y), px(x, y + 1), px(x + 1, y + 1)]);
  if (h00 == null || h10 == null || h01 == null || h11 == null) return h00;
  return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
}
// FNV-1a of the shape, base 36.
function fp(g) {
  let h = 0x811c9dc5;
  const s = g.join(",");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// ---------- each zone ----------
// Zones whose file is oldest (or missing) go first, so a run that runs out of time catches up on the next one.
const order = ZONES.map((z) => ({ ...z, at: (read(`heights-${z.id}.json`) || {}).builtAt || "" })).sort((a, b) => a.at.localeCompare(b.at));
let done = 0;
for (const z of order) {
  if (outOfTime()) { log(`Out of time: ${order.length - done} zone(s) wait for the next run.`); break; }
  const mtb = read(`mtb-${z.id}.json`);
  if (!mtb || mtb.v !== 1) { log(`${z.name}: no trail list, skipped`); done++; continue; }
  const old = (read(`heights-${z.id}.json`) || { ways: {} }).ways || {}, ways = {};
  let kept = 0, fresh = 0, missing = 0;
  const todo = [];
  for (const [id, w] of Object.entries(mtb.ways)) {
    const f = fp(w.g), o = old[id];
    if (o && o[0] === f && o.length === w.g.length / 2 + 1) { ways[id] = o; kept++; } else todo.push([id, w, f]);
  }
  // A few hundred ways at a time, so the tiles in memory stay few.
  for (let i = 0; i < todo.length; i += 300) {
    const part = todo.slice(i, i + 300), pts = [];
    part.forEach(([, w]) => { for (let j = 0; j < w.g.length; j += 2) pts.push([w.g[j], w.g[j + 1]]); });
    await loadFor(pts);
    for (const [id, w, f] of part) {
      const hs = [];
      for (let j = 0; j < w.g.length; j += 2) hs.push(await heightAt(w.g[j], w.g[j + 1]));
      if (hs.some((h) => h == null || h < -500)) { missing++; continue; }
      ways[id] = [f, ...hs.map(Math.round)];
      fresh++;
    }
    if (tiles.size > 400) tiles.clear();
  }
  const out = { v: 1, builtAt: new Date().toISOString().slice(0, 19) + "Z", src: `AWS Terrain Tiles (Terrarium) zoom ${Z}`, ways };
  writeFileSync(new URL(`data/heights-${z.id}.json`, root), JSON.stringify(out));
  log(`${z.name}: ${kept} kept, ${fresh} new${missing ? `, ${missing} with no terrain` : ""} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
  done++;
}
log(`${asked} tiles fetched in ${Math.round((Date.now() - started) / 1000)} s.`);
if (!existsSync(new URL("data/", root))) process.exit(1);
