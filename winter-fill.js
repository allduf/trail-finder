// Worker for map3d.js: hands over last winter's photo tiles (Skiing 3D, Winter) with no see-through spots.
// Pixels that were cloudy on every satellite pass are see-through in the photos (about 1 tile in 6; most around
// Vancouver, Revelstoke, Kicking Horse and Golden). The 3D ground showed the sky through them: jagged blue holes and
// stripes, like broken mountains (alex, 2026-10-27). Here each hole is filled before the map ever sees the tile, off
// the page so the map keeps moving: with Esri's sharp photo of the same spot, made wintry (open ground white, dark
// forest keeps its trees with a dusting, like Live), or if that can't come, from the photo around the hole (blended
// in from coarser and coarser averages, "push-pull"). Some valleys were cloudy all winter: at Kicking Horse's base
// 83% of a zoom-14 tile is a hole, too much to smear over.
// Message in: { id, z, x, y, base, skip, whole } (base = the Winter photo site with this tile, trail-finder-winter or -winter2; skip = don't
// ask for this zoom-14 tile, it's known to be missing; whole = the tile is all inside the photo squares, so every
// see-through pixel is a hole: tiles across a square's edge keep their see-through outside part).
// Out: { id, data: ImageBitmap, miss14 } or { id, none: true } (no photo here at all) or { id, err }. { cancel: id } drops one.
"use strict";
const W = 256;
const ESRI = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const cancelled = new Set();
const parents = new Map();   // a few filled parent tiles, for the missing tiles enlarged from them
const keep = (k, p) => { parents.set(k, p); p.catch(() => parents.delete(k)); if (parents.size > 8) parents.delete(parents.keys().next().value); return p; };

const holey = (d) => { for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true; return false; };
// Under the holes: Esri's photo of tile z/x/y with snow, as in map3d.js's tfwinter (no snow map or slopes here:
// the hole was snowy enough to stay cloudy). False if Esri can't send it.
async function underEsri(d, z, x, y) {
  const r = await fetch(ESRI(z, x, y)).catch(() => null);
  if (!r || !r.ok) return false;
  const e = (await decode(await r.blob())).data;
  for (let i = 0; i < d.length; i += 4) {
    const w = d[i + 3] / 255;
    if (w >= 1) continue;
    const R = e[i], G = e[i + 1], B = e[i + 2], lum = 0.3 * R + 0.59 * G + 0.11 * B;
    const water = B > G + 8 && B > R + 15 && lum < 110;
    const forest = smooth(20, 6, lum - 55) * smooth(-4, 10, G - R);
    const a = water ? 0.15 : 0.95 - 0.75 * forest, snow = 222 + (lum - 110) * 0.22;
    const sr = R + (snow - 6 - R) * a, sg = G + (snow - 2 - G) * a, sb = B + (snow + 10 - B) * a;
    d[i] = d[i] * w + sr * (1 - w); d[i + 1] = d[i + 1] * w + sg * (1 - w); d[i + 2] = d[i + 2] * w + sb * (1 - w); d[i + 3] = 255;
  }
  return true;
}
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
// Fills every pixel that isn't fully solid. Returns false if the tile has nothing to fill from.
async function fillHoles(d, z, x, y) {
  if (!holey(d)) return true;
  if (await underEsri(d, z, x, y)) return true;
  return pushPull(d);
}
function pushPull(d) {
  // Down: each level is the average of the one below, colours weighted by how solid each pixel is.
  const levels = [];
  let n = W, c = new Float32Array(n * n * 3), a = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) { const w = d[i * 4 + 3] / 255; a[i] = w; c[i * 3] = d[i * 4] * w; c[i * 3 + 1] = d[i * 4 + 1] * w; c[i * 3 + 2] = d[i * 4 + 2] * w; }
  levels.push([n, c, a]);
  while (n > 1) {
    const m = n >> 1, c2 = new Float32Array(m * m * 3), a2 = new Float32Array(m * m);
    for (let y = 0; y < m; y++) for (let x = 0; x < m; x++) {
      const o = y * m + x;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = (2 * y + dy) * n + 2 * x + dx;
        a2[o] += a[i] / 4; c2[o * 3] += c[i * 3] / 4; c2[o * 3 + 1] += c[i * 3 + 1] / 4; c2[o * 3 + 2] += c[i * 3 + 2] / 4;
      }
    }
    levels.push([m, c2, a2]);
    n = m; c = c2; a = a2;
  }
  if (a[0] < 1e-4) return false;
  // Up: the coarse level, now solid, goes under each finer one (smoothly, so filled spots have no blocks).
  let [pn, pc] = [1, new Float32Array([c[0] / a[0], c[1] / a[0], c[2] / a[0]])];
  for (let l = levels.length - 2; l >= 0; l--) {
    const [n2, c2, a2] = levels[l], out = new Float32Array(n2 * n2 * 3);
    for (let y = 0; y < n2; y++) for (let x = 0; x < n2; x++) {
      const o = y * n2 + x, w = Math.min(1, a2[o]);
      const fx = Math.min(pn - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), fy = Math.min(pn - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(pn - 1, x0 + 1), y1 = Math.min(pn - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      for (let k = 0; k < 3; k++) {
        const under = (pc[(y0 * pn + x0) * 3 + k] * (1 - tx) + pc[(y0 * pn + x1) * 3 + k] * tx) * (1 - ty)
          + (pc[(y1 * pn + x0) * 3 + k] * (1 - tx) + pc[(y1 * pn + x1) * 3 + k] * tx) * ty;
        out[o * 3 + k] = (w >= 1 ? c2[o * 3 + k] / a2[o] : c2[o * 3 + k] + (1 - w) * under);
      }
    }
    pn = n2; pc = out;
  }
  for (let i = 0; i < W * W; i++) { d[i * 4] = pc[i * 3]; d[i * 4 + 1] = pc[i * 3 + 1]; d[i * 4 + 2] = pc[i * 3 + 2]; d[i * 4 + 3] = 255; }
  return true;
}

// One canvas for reading pixels and one for handing tiles over, kept for the worker's life: a new canvas per tile
// (three a tile before) stays in memory until the browser gets round to cleaning up, which an iPhone may not do
// before the 3D map runs it out of memory (alex's recording, 2026-10-28). Each use is done in one go (no waiting in
// between), so tiles being made at the same time can't mix.
const readCv = new OffscreenCanvas(W, W), readCx = readCv.getContext("2d", { willReadFrequently: true });
const outCv = new OffscreenCanvas(W, W), outCx = outCv.getContext("2d");
const decode = async (blob) => {
  const img = await createImageBitmap(blob);
  readCx.clearRect(0, 0, W, W); readCx.drawImage(img, 0, 0, W, W); img.close();
  return readCx.getImageData(0, 0, W, W);
};
// Tile z/x/y's pixels (holes filled if whole), or null where there's no photo. A missing tile past zoom 11 is cut
// from the one above it and enlarged (the newer squares stop at zoom 13, and a few tiles were cloudy every pass).
// A tile scrolled away meanwhile (id cancelled) stops before decoding and filling: those were done for nothing.
async function tile(z, x, y, base, skip, whole, out, id) {
  if (!skip) {
    const r = await fetch(new URL(`${z}/${x}/${y}.webp`, base).href);
    if (cancelled.has(id)) return null;
    if (r.ok) { const px = await decode(await r.blob()); return whole && !cancelled.has(id) && !(await fillHoles(px.data, z, x, y)) ? null : px; }
    if (r.status !== 404) throw new Error(`HTTP ${r.status}`);
    if (z === 14) out.miss14 = true;
  }
  if (z <= 11) return null;
  const pk = `${z - 1}/${x >> 1}/${y >> 1}`;
  const up = await (parents.get(pk) || keep(pk, tile(z - 1, x >> 1, y >> 1, base, false, whole, {})));
  if (!up) return null;
  outCx.putImageData(up, 0, 0);
  readCx.clearRect(0, 0, W, W); readCx.imageSmoothingQuality = "high";
  readCx.drawImage(outCv, (x % 2) * W / 2, (y % 2) * W / 2, W / 2, W / 2, 0, 0, W, W);
  return readCx.getImageData(0, 0, W, W);
}

const busy = new Set();   // tiles being made: a cancel for one already sent is dropped, not kept for ever
self.onmessage = async ({ data: m }) => {
  if (m.cancel) { if (busy.has(m.cancel)) cancelled.add(m.cancel); return; }
  const out = { id: m.id };
  busy.add(m.id);
  try {
    const px = await tile(m.z, m.x, m.y, m.base, m.skip, m.whole, out, m.id);
    if (cancelled.has(m.id)) return;
    if (!px) { out.none = true; self.postMessage(out); return; }
    outCx.putImageData(px, 0, 0);
    out.data = outCv.transferToImageBitmap();
    self.postMessage(out, [out.data]);
  } catch (e) {
    if (cancelled.has(m.id)) return;
    out.err = String(e.message || e);
    self.postMessage(out);
  } finally { busy.delete(m.id); cancelled.delete(m.id); }
};
