// The Fishing "Highlight on the map" picture tiles (fishing.js, the Layers menu): a small satellite picture of a real
// place with the layer drawn on it, like Skiing's Avalanche and terrain tiles. Run by hand when a tile's look changes:
//
//   node scripts/make-fish-tiles.mjs        writes icons/fish/<layer>.jpg (288 px, about 10 KB each)
//   ONLY=creeks,crown node scripts/...      only these
//
// Needs Playwright with Chromium, and the map servers (Esri imagery, OpenFreeMap, the live site's lake depth files,
// Land Information Ontario). The colours below must match WATER and depthStyle() in fishing.js.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = new URL("../icons/fish/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const SITE = "https://allduf.github.io/trail-finder/";
const LIO = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open08/MapServer";

// [layer, centre lon/lat, zoom]
const TILES = [
  ["rivers", [-123.158, 49.745], 11.4],   // the Squamish, Mamquam and Cheakamus rivers
  ["lakes", [-74.62, 46.21], 10.6],        // the lakes around Mont-Tremblant
  ["creeks", [-123.06, 49.38], 13.2],     // the creeks of the North Shore (OpenFreeMap has creeks from zoom 13)
  ["ocean", [-123.32, 49.5], 9.6],         // Howe Sound
  ["depth", [-74.655, 46.357], 12.8],       // a lake north of Mont-Tremblant
  ["crown", [-77.95, 45.12], 10.6],        // near Bancroft, Ontario: Crown land and private land
];

const page = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css">
<script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
<style>html,body,#m{margin:0;width:192px;height:192px;overflow:hidden}.maplibregl-control-container{display:none}</style></head><body><div id="m"></div></body></html>`;

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 192, height: 192 }, deviceScaleFactor: 1.5 });
const p = await ctx.newPage();
await p.setContent(page);
await p.waitForFunction(() => window.maplibregl);

const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
for (const [k, center, zoom] of TILES.filter(([k]) => !ONLY || ONLY.includes(k))) {
  await p.evaluate(async ({ k, center, zoom, ESRI, SITE, LIO }) => {
    if (window.mp) window.mp.remove();
    const W = { type: "vector", url: "https://tiles.openfreemap.org/planet" };
    const layers = [{ id: "sat", type: "raster", source: "sat", paint: { "raster-brightness-max": 0.85, "raster-saturation": -0.15 } }];
    const sources = { sat: { type: "raster", tiles: [ESRI], tileSize: 256, maxzoom: 19 }, w: W };
    if (k === "rivers") layers.push(
      { id: "a", type: "fill", source: "w", "source-layer": "water", filter: ["==", ["get", "class"], "river"], paint: { "fill-color": "#15d1ff", "fill-opacity": 0.8 } },
      { id: "l", type: "line", source: "w", "source-layer": "waterway", filter: ["in", ["get", "class"], ["literal", ["river", "canal"]]], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#15d1ff", "line-width": 3.2 } });
    if (k === "lakes") layers.push(
      { id: "a", type: "fill", source: "w", "source-layer": "water", filter: ["in", ["get", "class"], ["literal", ["lake", "pond"]]], paint: { "fill-color": "#12d6b4", "fill-opacity": 0.78 } },
      { id: "o", type: "line", source: "w", "source-layer": "water", filter: ["in", ["get", "class"], ["literal", ["lake", "pond"]]], paint: { "line-color": "#d9fff7", "line-width": 0.8 } });
    if (k === "creeks") layers.push(
      { id: "l", type: "line", source: "w", "source-layer": "waterway", filter: ["==", ["get", "class"], "stream"], layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#8cf0ff", "line-width": 2.2, "line-dasharray": ["case", ["==", ["get", "intermittent"], 1], ["literal", [2, 1.5]], ["literal", [1, 0]]] } });
    if (k === "ocean") layers.push({ id: "a", type: "fill", source: "w", "source-layer": "water", filter: ["==", ["get", "class"], "ocean"], paint: { "fill-color": "#2f7bff", "fill-opacity": 0.62 } });
    if (k === "depth") {
      // the same files and colours as the app (data/fishing/depth, encoded polylines lon,lat)
      const f = [];
      for (const sq of ["185_-299", "185_-300"]) {
        const j = await fetch(`${SITE}data/fishing/depth/${sq}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
        for (const [d, g] of j.l || []) {
          const co = []; let x = 0, y = 0, i = 0;
          const num = () => { let r = 0, sh = 0, b; do { b = g.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); return r & 1 ? ~(r >> 1) : r >> 1; };
          while (i < g.length) { x += num(); y += num(); co.push([x / 1e5, y / 1e5]); }
          f.push({ type: "Feature", properties: { d }, geometry: { type: "LineString", coordinates: co } });
        }
      }
      sources.q = { type: "geojson", data: { type: "FeatureCollection", features: f } };
      layers.push({ id: "q", type: "line", source: "q", paint: { "line-color": ["interpolate", ["linear"], ["get", "d"], 0, "#5fc4f0", 5, "#2b8fd6", 15, "#1d5fb8", 40, "#173a8a"], "line-width": 1.4 } });
      layers[0].paint["raster-brightness-max"] = 1;
    }
    if (k === "crown") {
      const dl = (id, c, where) => encodeURIComponent(JSON.stringify([{ id, source: { type: "mapLayer", mapLayerId: id }, ...(where ? { definitionExpression: where } : {}),
        drawingInfo: { renderer: { type: "simple", symbol: { type: "esriSFS", style: "esriSFSSolid", color: [...c, 255], outline: { type: "esriSLS", style: "esriSLSSolid", color: [...c, 255], width: 0.75 } } } } }]));
      const ex = (d) => `${LIO}/export?bboxSR=3857&imageSR=3857&size=256%2C256&format=png32&transparent=true&f=image&dynamicLayers=${d}&bbox={bbox-epsg-3857}`;
      sources.cr = { type: "raster", tiles: [ex(dl(34, [47, 158, 68]))], tileSize: 256 };
      sources.pr = { type: "raster", tiles: [ex(dl(35, [250, 176, 5], "TITLE_HOLDER_TYPE='Private'"))], tileSize: 256 };
      layers.push({ id: "cr", type: "raster", source: "cr", paint: { "raster-opacity": 0.42 } }, { id: "pr", type: "raster", source: "pr", paint: { "raster-opacity": 0.5 } });
    }
    window.mp = new maplibregl.Map({ container: "m", style: { version: 8, sources, layers }, center, zoom, interactive: false, attributionControl: false, fadeDuration: 0 });
    await new Promise((res) => { const t = setTimeout(res, 45000); window.mp.once("idle", () => { clearTimeout(t); res(); }); });
  }, { k, center, zoom, ESRI, SITE, LIO });
  await p.screenshot({ path: new URL(`${k}.jpg`, OUT).pathname, type: "jpeg", quality: 72 });
  console.log("wrote", k);
}
await browser.close();
