// Browser script used by build.mjs: draws one Winter tile from the Sentinel-2 passes listed in
// data/winter-scenes.json, and registers it as window.renderWinter(z, x, y, size) -> { data: PNG bytes }.
(function () {
  const maplibregl = { addProtocol: (n, f) => { window.renderWinter = (z, x, y, size = 256) => f({ url: `tfs2://${z}/${x}/${y}/${size}` }); } };
  // ---------- last winter's satellite photos ----------
  // tfs2://z/x/y builds Winter from real Sentinel-2 photos taken in February and March 2026 (free,
  // open data on AWS, 10 m pixels, so softer than the summer photos). data/winter-scenes.json lists
  // the clearest few passes over each 110 km Sentinel-2 square; each tile takes the first clear pixel,
  // using the satellite's own cloud map (SCL) to skip clouds and their shadows. Outside those squares
  // the summer photos show through.
  const GEOTIFF = "https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js";
  const S2 = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/";
  let gtLoading = null, sceneList = null;
  const loadGeoTiff = () => gtLoading || (gtLoading = window.GeoTIFF ? Promise.resolve() : new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = GEOTIFF; s.onload = ok; s.onerror = () => { gtLoading = null; fail(new Error("GeoTIFF library didn't load")); };
    document.head.append(s);
  }));
  const scenes = () => sceneList || (sceneList = fetch("data/winter-scenes.json").then((r) => r.json())
    .then((j) => Object.values(j).flat().sort((a, b) => a.cloud - b.cloud)).catch((e) => { sceneList = null; throw e; }));
  const tiffs = new Map();
  const tiff = (url) => { if (!tiffs.has(url)) tiffs.set(url, GeoTIFF.fromUrl(url).catch((e) => { tiffs.delete(url); throw e; })); return tiffs.get(url); };
  // Longitude/latitude to UTM zone 10 (the zone all these Sentinel-2 squares use), in metres.
  function utm10(lon, lat) {
    const a = 6378137, e2 = 0.00669438, ep2 = e2 / (1 - e2), k0 = 0.9996, p = lat * Math.PI / 180;
    const s = Math.sin(p), c = Math.cos(p), t = Math.tan(p), N = a / Math.sqrt(1 - e2 * s * s), T = t * t, C = ep2 * c * c;
    const A = c * (lon + 123) * Math.PI / 180;
    const M = a * ((1 - e2 / 4 - 3 * e2 * e2 / 64) * p - (3 * e2 / 8 + 3 * e2 * e2 / 32) * Math.sin(2 * p) + (15 * e2 * e2 / 256) * Math.sin(4 * p));
    return [500000 + k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120),
      k0 * (M + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720))];
  }
  const CLOUDY = new Set([0, 1, 3, 8, 9, 10]);   // SCL: no data, defective, cloud shadow, cloud (medium, high), cirrus
  let s2Protocol = false;
  function addS2Protocol() {
    if (s2Protocol) return;
    s2Protocol = true;
    maplibregl.addProtocol("tfs2", async (params) => {
      const [z, x, y, size] = params.url.replace("tfs2://", "").split("/").map(Number), W = size || 256, n = 2 ** z;
      const lon = (px) => (x + px / W) / n * 360 - 180, lat = (py) => Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + py / W) / n))) * 180 / Math.PI;
      const box = [lon(0), lat(W), lon(W), lat(0)];
      const out = new ImageData(W, W), O = out.data;
      const list = (await scenes()).filter((s) => s.bbox[0] < box[2] && s.bbox[2] > box[0] && s.bbox[1] < box[3] && s.bbox[3] > box[1]);
      if (list.length) {
        await loadGeoTiff();
        const E = new Float64Array(W * W), Nn = new Float64Array(W * W);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
          const [e, nn] = utm10(lon(px + 0.5), lat(py + 0.5)), i = py * W + px;
          E[i] = e; Nn[i] = nn; x0 = Math.min(x0, e); x1 = Math.max(x1, e); y0 = Math.min(y0, nn); y1 = Math.max(y1, nn);
        }
        // Read every pass at once, then keep, for each pixel, the middle-brightness clear value: a cloud
        // the cloud map missed is brighter than the ground under it, so it loses to the other passes.
        const passes = (await Promise.all(list.map(async (s) => {
          try {
            const [tci, scl] = await Promise.all([tiff(S2 + s.dir + "TCI.tif"), tiff(S2 + s.dir + "SCL.tif")]);
            const img = await tci.getImage(), [ox, oy] = img.getOrigin(), size = img.getWidth() * img.getResolution()[0];
            const b = [Math.max(x0, ox), Math.max(y0, oy - size), Math.min(x1, ox + size), Math.min(y1, oy)];
            if (b[0] >= b[2] || b[1] >= b[3]) return null;
            const RW = Math.max(2, Math.ceil(W * (b[2] - b[0]) / (x1 - x0))), RH = Math.max(2, Math.ceil(W * (b[3] - b[1]) / (y1 - y0)));
            const SW = Math.max(2, RW >> 1), SH = Math.max(2, RH >> 1);
            const [rgb, cls] = await Promise.all([tci.readRasters({ bbox: b, width: RW, height: RH, interleave: true, resampleMethod: "bilinear" }),
              scl.readRasters({ bbox: b, width: SW, height: SH, interleave: true, resampleMethod: "nearest" })]);
            return { b, RW, RH, SW, SH, rgb, cls };
          } catch { return null; }   // a pass that won't load: the others fill in
        }))).filter(Boolean);
        const cand = [];
        for (let i = 0; i < W * W; i++) {
          cand.length = 0;
          for (const { b, RW, RH, SW, SH, rgb, cls } of passes) {
            const fx = (E[i] - b[0]) / (b[2] - b[0]), fy = (b[3] - Nn[i]) / (b[3] - b[1]);
            if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) continue;
            if (CLOUDY.has(cls[((fy * SH) | 0) * SW + ((fx * SW) | 0)])) continue;
            const j = (((fy * RH) | 0) * RW + ((fx * RW) | 0)) * 3;
            if (rgb[j] | rgb[j + 1] | rgb[j + 2]) cand.push(j, rgb);
          }
          if (!cand.length) continue;
          const k = cand.length / 2, order = [...Array(k).keys()].sort((p, q) => {
            const a = cand[p * 2 + 1], ja = cand[p * 2], c = cand[q * 2 + 1], jc = cand[q * 2];
            return (a[ja] + a[ja + 1] + a[ja + 2]) - (c[jc] + c[jc + 1] + c[jc + 2]);
          });
          const m = order[(k - 1) >> 1], j = cand[m * 2], v = cand[m * 2 + 1];
          O[i * 4] = v[j]; O[i * 4 + 1] = v[j + 1]; O[i * 4 + 2] = v[j + 2]; O[i * 4 + 3] = 255;
        }
      }
      const cv = new OffscreenCanvas(W, W);
      cv.getContext("2d").putImageData(out, 0, 0);
      return { data: await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer() };
    });
  }

  addS2Protocol();
})();
