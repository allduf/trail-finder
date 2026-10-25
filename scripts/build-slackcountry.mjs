// The terrain numbers of the slackcountry lines (Skiing mode, slackcountry.js): data/slackcountry.json is hand-kept
// (resorts, their backcountry gates and lines). After adding or moving a line, run this once by hand: for each line it
// works out, with ski-terrain.js (the same maths as the ski route details and the nightly terrain classes), from the
// AWS terrain tiles:
//  - the descent (g.ski): top and bottom height, drop, length, steepest slope, which way its steep parts face, and the
//    km on 35°+ ground
//  - the whole trip (gate, climb, descent and way back): length, climb, and the terrain class estimate (1 Simple,
//    2 Challenging, 3 Complex) with the reasons
// and saves them in each line's calc. A line's own cls (set by hand, with clsWhy) wins over the estimate.
// Run: node scripts/build-slackcountry.mjs   (Node 18 or newer, no packages; needs the internet for the tiles)
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const root = new URL("../", import.meta.url);
await import(new URL("ski-terrain.js", root).href);
const T = globalThis.tfTerrain;
const path = new URL("data/slackcountry.json", root);
const doc = JSON.parse(readFileSync(path, "utf8"));

// ---------- terrain tiles: Terrarium PNGs (RGB, 8 bits) decoded with zlib (as in build-ski-terrain.mjs) ----------
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
function dem(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (!cache.has(key)) cache.set(key, fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`, { signal: AbortSignal.timeout(30000) })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status} for ${key}`); return r.arrayBuffer(); })
    .then((b) => { const e = decodePng(Buffer.from(b)); e.z = z; return e; }));
  return cache.get(key);
}

const pairs = (flat) => { const l = []; for (let i = 0; i + 1 < (flat || []).length; i += 2) l.push([flat[i], flat[i + 1]]); return l; };
const r1 = (v) => Math.round(v * 10) / 10;
for (const resort of doc.resorts) {
  for (const line of resort.lines) {
    const ski = pairs(line.g.ski), trip = [pairs(line.g.up), ski, pairs(line.g.out)].filter((l) => l.length > 1);
    const d = await T.info([ski], dem), t = await T.info(trip, dem), c = T.terrainClass(t);
    // The descent runs downhill from where it was drawn (info() turns a line to start at its low end).
    line.calc = { top: Math.round(d.max), bottom: Math.round(d.min), drop: Math.round(d.max - d.min), km: r1(d.total / 1000), maxSlope: Math.round(d.maxSlope),
      faces: d.faces.slice(0, 3), k35: r1(d.km35), tripKm: r1(t.total / 1000), climb: Math.round(t.up), cls: c.c, why: c.why };
    console.log(`${resort.name}: ${line.name}: ${line.calc.drop} m down, ${line.calc.maxSlope}°, ${line.calc.faces.join("/")}, class ${c.c} (${c.why.join("; ")})`);
  }
}
// One line of the file per gate and per line, so a diff shows what changed.
const json = JSON.stringify(doc, null, 1).replace(/\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]/g, (m, inner) => `[${inner.replace(/\s+/g, "")}]`)
  .replace(/\[\s*("[^"\n]*"(?:,\s*"[^"\n]*")*)\s*\]/g, (m, inner) => `[${inner.replace(/,\s+/g, ", ")}]`);
writeFileSync(path, json + "\n");
console.log(`Saved ${path.pathname}`);
