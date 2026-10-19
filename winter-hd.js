// Worker for map3d.js: draws the sharper close-up Winter tiles (zooms 15-16) off the page's main thread, so the
// 3D map keeps moving and loading its terrain while they're drawn (alex, 2026-10-19: "that map is long to load").
// Message in: { id, z, x, y, base } (base = the page address, for data/winter). Out: { id, data } (a WebP or PNG
// tile) or { id, err }. { cancel: id } drops a tile the map no longer needs.
//
// The colours come from last winter's Sentinel-2 photo (data/winter zoom 14, 10 m a pixel). Two real sources add
// the detail it can't hold:
//  - Mapterhorn's 2 m lidar heights: the light on the snow from rolls, bumps and gullies 6 to 10 m across, with
//    the sun where it was for the photos (late morning in February and March: south-south-east, 28° up). Only the
//    part finer than 10 m is added, since the photo already has the bigger shading. Where Mapterhorn has no lidar
//    tile there's nothing to add.
//  - Esri's sharp (summer) photo: the fine detail of trees, rock and buildings, as how much lighter or darker each
//    spot is than the 10 m average around it (Esri's own zoom 13), not its summer colours. Mostly on dark ground
//    (trees, rock): open snow takes only a little, since the summer photo has meadow and scree there.
"use strict";
const ESRI = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const LIDAR = (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`;
const SUN = [Math.sin(160 / 57.3) * Math.cos(28 / 57.3), Math.cos(160 / 57.3) * Math.cos(28 / 57.3), Math.sin(28 / 57.3)];   // east, north, up
const W = 256;
const cancelled = new Set();

// Parent tiles (winter z14, Esri z13, lidar z15) are shared by 4 to 16 close-up tiles: keep the recent ones.
const cache = new Map();
function cached(key, make) {
  if (cache.has(key)) { const p = cache.get(key); cache.delete(key); cache.set(key, p); return p; }
  const p = make(); cache.set(key, p);
  p.catch(() => cache.delete(key));
  if (cache.size > 160) cache.delete(cache.keys().next().value);
  return p;
}
async function pixels(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const img = await createImageBitmap(await r.blob()), cv = new OffscreenCanvas(img.width, img.height), cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(img, 0, 0); img.close();
  return cx.getImageData(0, 0, cv.width, cv.height);
}
// The part of an ancestor tile (zoom pz) that lies under tile z/x/y, as [pixels, left, top, size].
async function under(pz, z, x, y, url, tag) {
  const k = z - pz, px = x >> k, py = y >> k, img = await cached(`${tag}${pz}/${px}/${py}`, () => pixels(url(pz, px, py))), n = 1 << k, size = img.width / n;
  return [img, (x % n) * size, (y % n) * size, size];
}
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
// bilinear sample of channel ch at (fx, fy) in an image's pixels
const at = (img, fx, fy, ch) => {
  const w = img.width, d = img.data, x0 = Math.min(w - 1, Math.max(0, Math.floor(fx - 0.5))), y0 = Math.min(w - 1, Math.max(0, Math.floor(fy - 0.5)));
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(w - 1, y0 + 1), tx = Math.min(1, Math.max(0, fx - 0.5 - x0)), ty = Math.min(1, Math.max(0, fy - 0.5 - y0));
  return (d[(y0 * w + x0) * 4 + ch] * (1 - tx) + d[(y0 * w + x1) * 4 + ch] * tx) * (1 - ty) + (d[(y1 * w + x0) * 4 + ch] * (1 - tx) + d[(y1 * w + x1) * 4 + ch] * tx) * ty;
};
const lum = (img, fx, fy) => 0.3 * at(img, fx, fy, 0) + 0.59 * at(img, fx, fy, 1) + 0.11 * at(img, fx, fy, 2);

async function draw({ id, z, x, y, base }) {
  const keep = (p) => p.catch(() => null);
  const dz = Math.min(z - 1, 15);
  const [win, sharp, soft, dem] = await Promise.all([
    under(14, z, x, y, (a, b, c) => new URL(`data/winter/${a}/${b}/${c}.webp`, base).href, "w"),
    keep(pixels(ESRI(z, x, y))),
    keep(under(13, z, x, y, ESRI, "e")),
    keep(under(dz, z, x, y, LIDAR, "d"))]);
  if (cancelled.delete(id)) return null;
  const out = new ImageData(W, W), O = out.data;
  let light = null;
  if (dem) {
    const [D, dl, dt, ds] = dem, DW = D.width, h0 = (px, py) => {
      px = Math.min(DW - 1, Math.max(0, px)); py = Math.min(DW - 1, Math.max(0, py));
      const i = (py * DW + px) * 4; return D.data[i] * 256 + D.data[i + 1] + D.data[i + 2] / 256 - 32768;
    };
    const h = (fx, fy) => {   // blended between height pixels
      const x0 = Math.floor(fx - 0.5), y0 = Math.floor(fy - 0.5), tx = fx - 0.5 - x0, ty = fy - 0.5 - y0;
      return (h0(x0, y0) * (1 - tx) + h0(x0 + 1, y0) * tx) * (1 - ty) + (h0(x0, y0 + 1) * (1 - tx) + h0(x0 + 1, y0 + 1) * tx) * ty;
    };
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / (1 << z))));
    const mpp = 40075016 * Math.cos(lat) / ((1 << dz) * DW), k = 5 / mpp, k1 = Math.max(1, 3 / mpp);   // 5 m: a 10 m wide slope; 3 m: the finest that shows through snow
    const shade = (hx, hy, r) => {
      const ex = (h(hx + r, hy) - h(hx - r, hy)) / (2 * r * mpp), ny = (h(hx, hy - r) - h(hx, hy + r)) / (2 * r * mpp);
      return Math.max(0.04, (-ex * SUN[0] - ny * SUN[1] + SUN[2]) / Math.hypot(ex, ny, 1));
    };
    light = (px, py) => {
      const hx = dl + (px + 0.5) * ds / W, hy = dt + (py + 0.5) * ds / W;
      const edge = smooth(k, 2 * k + 2, Math.min(hx, hy, DW - hx, DW - hy));   // heights run out at the edge: fade out
      return 1 + (Math.min(1.3, Math.max(0.75, shade(hx, hy, k1) / shade(hx, hy, k))) - 1) * edge;
    };
  }
  const [wi, wl, wt, ws] = win;
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    const fx = wl + (px + 0.5) * ws / W, fy = wt + (py + 0.5) * ws / W, i = (py * W + px) * 4;
    const a = at(wi, fx, fy, 3);
    if (a < 8) continue;   // outside the winter photos: the summer photo underneath shows
    const r = at(wi, fx, fy, 0), g = at(wi, fx, fy, 1), b = at(wi, fx, fy, 2), snow = smooth(140, 215, 0.3 * r + 0.59 * g + 0.11 * b);
    let f = 1;
    if (light) f *= light(px, py) ** (0.3 + 0.4 * snow);
    if (sharp && soft) {
      const [si, sl, st, ss] = soft, e = lum(sharp, px + 0.5, py + 0.5), e0 = lum(si, sl + (px + 0.5) * ss / W, st + (py + 0.5) * ss / W);
      f *= 1 + (Math.min(2.2, Math.max(0.35, (e + 12) / (e0 + 12))) - 1) * (0.9 - 0.82 * snow);
    }
    O[i] = r * f; O[i + 1] = g * f; O[i + 2] = b * f; O[i + 3] = a;
  }
  const cv = new OffscreenCanvas(W, W);
  cv.getContext("2d").putImageData(out, 0, 0);
  return (await cv.convertToBlob({ type: "image/webp", quality: 0.9 })).arrayBuffer();   // PNG where WebP can't be made
}

self.onmessage = async ({ data: m }) => {
  if (m.cancel != null) { cancelled.add(m.cancel); return; }
  try {
    const data = await draw(m);
    cancelled.delete(m.id);
    if (data) self.postMessage({ id: m.id, data }, [data]); else self.postMessage({ id: m.id, err: "cancelled" });
  } catch (e) { cancelled.delete(m.id); self.postMessage({ id: m.id, err: String(e && e.message || e) }); }
};
