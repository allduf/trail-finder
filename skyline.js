// Skyline match for photo find (photo-find.js): where a picture with mountains against the sky could have been taken.
// read(canvas): the line where the sky meets the mountains, column by column (null when the picture has no clear sky
// over mountains). place(sky, points): for each trail point, the skyline the terrain would show from there (elevation
// tiles, the same ones photo-find.js uses), and how well the picture's skyline fits it at the best heading and lens
// width. The best fits are where the picture may have been taken: an estimate from terrain heights (about 100 m a
// pixel), never proof. 2026-11-19: a Cream Puff (Pemberton) picture the AI placed 3 km off fit best right on its ridge.
(function () {
  "use strict";
  const DEM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const Z = 10;               // about 100 m a pixel: enough for ridges a few km away and more
  const VIEW = 35000;         // how far the skyline is looked for (m)
  const NEAR = 200;           // the nearest ground counted (m): the rider's own rock and trees are not the skyline
  const DS = (() => { const n = 64, out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = NEAR * (VIEW / NEAR) ** (i / (n - 1)); return out; })();
  const DS_FINE = (() => { const n = 160, out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = NEAR * (VIEW / NEAR) ** (i / (n - 1)); return out; })();
  const EARTH = 6371000, REFRACT = 0.87;
  const FOVS = [45, 55, 65, 75, 85, 95];   // lens widths tried (degrees across the picture): phones to action cameras
  const deg = 180 / Math.PI;

  // ---------- the picture's skyline ----------
  // Blue sky only (an overcast sky and snow look alike). Small things in the sky (an app's buttons on a screenshot, a
  // bird, a thin branch) are stepped over; a column with no sky at its top (a tree, a person) is left out.
  function read(canvas) {
    if (!canvas || !canvas.width || !canvas.height) return null;
    const W = 256, H = Math.round(W * canvas.height / canvas.width);
    if (H < 64) return null;
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x2 = c.getContext("2d", { willReadFrequently: true });
    x2.drawImage(canvas, 0, 0, W, H);
    const d = x2.getImageData(0, 0, W, H).data;
    c.width = c.height = 0;
    return readPixels(d, W, H);
  }
  function readPixels(d, W, H) {
    const px = (x, y) => { const i = (y * W + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const isSky = (p) => p[2] > 150 && p[2] - p[0] > 40 && p[2] >= p[1] - 12;
    const diff = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
    const avg = (x, y0, y1) => { const s = [0, 0, 0]; let n = 0; for (let y = Math.max(0, y0); y < Math.min(H, y1); y++, n++) { const p = px(x, y); s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return n ? s.map((v) => v / n) : null; };
    const RUN = Math.max(3, Math.round(H * 0.03)), SKIP = Math.round(H * 0.035), LOW = Math.round(H * 0.8), K = 3, STEP = 40;
    const ys = new Float32Array(W).fill(-1);
    for (let x = 0; x < W; x++) {
      // The first run of sky from the top (a screenshot's darker status bar and its icons are above it).
      let y = 0, run = 0;
      for (; y < H * 0.55; y++) { if (isSky(px(x, y))) { if (++run >= RUN) break; } else run = 0; }
      if (run < RUN) continue;
      // Down to the first sharp change: the 3 pixels above against the 3 below (a sky only shades slowly, and a far,
      // hazy ridge is still a step).
      let edge = -1;
      for (y++; y < LOW; y++) {
        const up = avg(x, y - K, y), dn = avg(x, y, y + K);
        if (diff(up, dn) < STEP) continue;
        // Something small in the sky (an app button, a bird, a thin branch): sky like above it again a little lower down.
        let back = -1;
        for (let k = y + K; k < Math.min(LOW, y + SKIP); k++) { const q = avg(x, k, k + K); if (q && diff(q, up) < STEP * 0.6 && isSky(q)) { back = k; break; } }
        if (back > 0) { y = back + K; continue; }
        edge = y; break;
      }
      if (edge > 0) ys[x] = edge;
    }
    // Trees and poles stick up from the skyline in narrow spikes: a column far from its neighbours' middle value goes.
    // Twice: next to its 9 neighbours, then to the 25 around it (a branch hanging in the sky over several columns).
    let out = [];
    for (let x = 0; x < W; x++) if (ys[x] >= 0) out.push([x, ys[x]]);
    for (const [half, tol] of [[4, 0.015], [12, 0.03]]) {
      out = out.filter(([x, y]) => {
        const nb = out.filter((q) => Math.abs(q[0] - x) <= half).map((q) => q[1]).sort((a, b) => a - b);
        return nb.length >= Math.min(5, half) && Math.abs(y - nb[nb.length >> 1]) <= H * tol;
      });
    }
    if (out.length < W * 0.4 || out[out.length - 1][0] - out[0][0] < W * 0.5) return null;
    const yv = out.map((p) => p[1]), relief = Math.max(...yv) - Math.min(...yv);
    if (relief < W * 0.04) return null;      // a flat line: water, a far plain or a straight crop, not mountains
    // Up to 64 columns, as parts of the picture's width (-0.5 to 0.5), and heights in the same units (down is more).
    const step = Math.max(1, Math.floor(out.length / 64)), pts = out.filter((_, i) => i % step === 0);
    return { xs: Float32Array.from(pts, (p) => p[0] / W - 0.5), ys: Float32Array.from(pts, (p) => p[1] / W), cols: out.length, relief: relief / W };
  }

  // ---------- elevation tiles ----------
  const tiles = new Map(), grid = new Map();   // grid: the loaded ones by number, for elev()
  const n2 = 2 ** Z;
  const tx = (lon) => (lon + 180) / 360 * n2;
  const ty = (lat) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n2; };
  function tile(x, y) {
    const k = x + "/" + y;
    if (!tiles.has(k)) tiles.set(k, new Promise((res) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = c.height = 256;
        const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, 256, 256).data, h = new Float32Array(256 * 256);
        for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
        c.width = c.height = 0;
        tiles.set(k, h); grid.set(x * 4096 + y, h); res(h);
      };
      img.onerror = () => { tiles.set(k, null); res(null); };
      img.src = DEM(Z, x, y);
    }));
    return tiles.get(k);
  }
  async function load(s, w, n, e) {
    const jobs = [];
    for (let x = Math.floor(tx(w)); x <= Math.floor(tx(e)); x++) for (let y = Math.floor(ty(n)); y <= Math.floor(ty(s)); y++) jobs.push(tile(x, y));
    const got = await Promise.all(jobs);
    return got.filter(Boolean).length / Math.max(1, got.length);
  }
  // Height at a spot, between the 4 nearest pixels (null outside the tiles loaded), by world pixel (zoom Z, 256 a tile).
  // The last tile used is kept at hand: a skyline asks for thousands of heights in a row, mostly from the same few tiles.
  let lastK = -1, lastH = null;
  function atPx(gx, gy) {
    const x = Math.floor(gx / 256), y = Math.floor(gy / 256), k = x * 4096 + y;
    let h;
    if (k === lastK) h = lastH;
    else { h = grid.get(k); if (!h) return null; lastK = k; lastH = h; }
    const px = gx - x * 256 - 0.5, py = gy - y * 256 - 0.5;
    const i = px < 0 ? 0 : px > 254 ? 254 : Math.floor(px), j = py < 0 ? 0 : py > 254 ? 254 : Math.floor(py);
    const u = Math.max(0, Math.min(1, px - i)), v = Math.max(0, Math.min(1, py - j)), o = j * 256 + i;
    return h[o] * (1 - u) * (1 - v) + h[o + 1] * u * (1 - v) + h[o + 256] * (1 - u) * v + h[o + 257] * u * v;
  }
  const elev = (lat, lon) => atPx(tx(lon) * 256, ty(lat) * 256);

  // ---------- the terrain's skyline from a spot ----------
  // The highest angle (degrees above level) of the ground in each direction (step degrees), for an eye 2 m up. Within
  // 35 km the map's pixels are as good as square and even: metres to pixels is one number around the spot.
  const trig = new Map();
  function horizon(lat, lon, step, ds) {
    const gx = tx(lon) * 256, gy = ty(lat) * 256, h0 = atPx(gx, gy);
    if (h0 == null) return null;
    const n = Math.round(360 / step), out = new Float32Array(n), k = 256 * n2 / (2 * Math.PI * EARTH * Math.cos(lat * Math.PI / 180));
    if (!trig.has(step)) trig.set(step, Array.from({ length: n }, (_, a) => [Math.sin(a * step / deg), Math.cos(a * step / deg)]));
    const sc = trig.get(step), eye = h0 + 2, m = ds.length, drop = new Float32Array(m), pd = new Float32Array(m);
    for (let i = 0; i < m; i++) { drop[i] = ds[i] * ds[i] / (2 * EARTH) * REFRACT + eye; pd[i] = ds[i] * k; }
    for (let a = 0; a < n; a++) {
      const [sx, cy] = sc[a];
      let best = -1e9;
      for (let i = 0; i < m; i++) {
        const h = atPx(gx + pd[i] * sx, gy - pd[i] * cy);
        if (h == null) continue;
        const t = (h - drop[i]) / ds[i];
        if (t > best) best = t;
      }
      out[a] = Math.atan(best) * deg;
    }
    return { hz: out, step, h0 };
  }
  // How well the picture's skyline fits a terrain skyline: the best heading and lens width. score = the misfit (degrees,
  // after the camera's tilt is taken out) over how much the terrain skyline itself goes up and down there, so a flat
  // stretch of horizon can't fit everything.
  function fit(sky, H, fovs, heads, trim = false) {
    const n = sky.xs.length, hz = H.hz, step = H.step, N = hz.length;
    let best = null;
    const rel = new Float32Array(n), el = new Float32Array(n), hv = new Float32Array(n);
    for (const fov of fovs) {
      const f = 0.5 / Math.tan(fov / 2 / deg);
      const y0 = sky.ys.reduce((a, b) => a + b, 0) / n;
      for (let i = 0; i < n; i++) { rel[i] = Math.atan(sky.xs[i] / f) * deg; el[i] = Math.atan((y0 - sky.ys[i]) / Math.hypot(f, sky.xs[i])) * deg; }
      for (const head of heads) {
        let m = 0;
        for (let i = 0; i < n; i++) {
          let a = (head + rel[i]) / step; a = ((a % N) + N) % N;
          const i0 = Math.floor(a), fr = a - i0, v = hz[i0] * (1 - fr) + hz[(i0 + 1) % N] * fr;
          hv[i] = v; m += v - el[i];
        }
        m /= n;
        let e2 = 0, hm = 0, h2 = 0;
        for (let i = 0; i < n; i++) { const e = hv[i] - el[i] - m; e2 += e * e; hm += hv[i]; h2 += hv[i] * hv[i]; }
        let rms = Math.sqrt(e2 / n);
        // Finer: the worst 15% of the columns left out (a branch or a cloud read as skyline), around the middle tilt.
        if (trim) {
          const ds = Array.from(hv, (v, i) => v - el[i]).sort((a, b) => a - b), mid = ds[n >> 1];
          const r = ds.map((v) => (v - mid) ** 2).sort((a, b) => a - b), k = Math.max(3, Math.floor(n * 0.85));
          rms = Math.sqrt(r.slice(0, k).reduce((a, b) => a + b, 0) / k); m = mid;
        }
        const sd = Math.sqrt(Math.max(0, h2 / n - (hm / n) ** 2)), score = rms / Math.max(sd, 0.3);
        if (!best || score < best.score) best = { score, rms, sd, fov, head, tilt: m };
      }
    }
    return best;
  }
  const range = (a, b, s) => { const out = []; for (let v = a; v <= b + 1e-9; v += s) out.push(v); return out; };

  // points: [{ lat, lon, k }] (k: whatever the caller keys them by). Returns the points sorted best first, each with
  // { score, rms, fov, head }, or null when the tiles can't be had. Yields to the page every few dozen points.
  async function place(sky, points, onStep) {
    if (!sky || !points.length) return null;
    let s = 90, w = 180, n = -90, e = -180;
    for (const p of points) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); }
    const pad = VIEW / 111320, padX = pad / Math.cos(((s + n) / 2) * Math.PI / 180);
    const got = await load(s - pad, w - padX, n + pad, e + padX);
    if (got < 0.8) return null;
    // First every 2nd column, every 2 degrees; then the best 120 spots finer.
    const half = { xs: sky.xs.filter((_, i) => i % 2 === 0), ys: sky.ys.filter((_, i) => i % 2 === 0) };
    const out = [], coarseHeads = range(0, 358, 2);
    for (let i = 0; i < points.length; i++) {
      const p = points[i], H = horizon(p.lat, p.lon, 1, DS);
      if (H) { const b = fit(half, H, FOVS, coarseHeads); if (b) out.push({ ...p, ...b, h: H.h0 }); }
      if (i % 40 === 39) { if (onStep) onStep(i / points.length); await new Promise((r) => setTimeout(r, 0)); }
    }
    out.sort((a, b) => a.score - b.score);
    // The best few looked at again, finer.
    for (const p of out.slice(0, 120)) {
      const H = horizon(p.lat, p.lon, 0.25, DS_FINE);
      if (!H) continue;
      const b = fit(sky, H, range(Math.max(40, p.fov - 9), Math.min(100, p.fov + 9), 3), range(p.head - 4, p.head + 4, 0.5), true);
      if (b) Object.assign(p, b, { fine: true });
    }
    out.sort((a, b) => (b.fine ? 1 : 0) - (a.fine ? 1 : 0) || a.score - b.score);
    return out;
  }

  window.tfSkyline = { read, readPixels, place, elev, horizon, fit, load };
})();
