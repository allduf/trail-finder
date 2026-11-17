// Adventure moto's own map style, "ADV topo" (alex 2026-11-17: "can we have a more professional map by default for moto
// mode?", picked "Topo, Night after sunset" from 4 mockups). Drawn by the phone from OpenFreeMap's vector tiles (the same
// tiles as Offline maps and moto-roads.js), with shaded mountains and elevation lines from Mapterhorn's heights (the same
// heights as the 3D map). Highways orange, paved roads white, gravel and dirt roads dashed brown, so the dirt stands
// out; the "Dirt roads for my bike" layer (moto.js) still colours them for your bike on top. After sunset where the
// map is, the same map in dark colours (index.html switches it). Loaded by index.html the first time it's shown.
(() => {
  "use strict";
  if (window.tfAdvMap) return;
  const DEM = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
  const N = ["Noto Sans Regular"], B = ["Noto Sans Bold"], I = ["Noto Sans Italic"];
  const DAY = {
    land: "#f4f1e6", wood: "#cfe0bd", woodOp: 0.8, grass: "#e4ebd0", ice: "#fbfdff", rock: "#e4ded3", town: "#ebe5da", water: "#9cc6e2", river: "#6fa8d4",
    shadow: "#4f4636", shadeX: 0.35, hi: "#ffffff", hwy: "#e8892a", hwyCase: "#9c5a14", paved: "#ffffff", pavedCase: "#8d8579", dirt: "#8a4a1c", dirtHalo: "#fff6e8",
    path: "#6d6458", text: "#262626", halo: "#ffffff", park: "#5c8c48", contour: "#b08a5a", contourText: "#8a6a40", waterText: "#3b6f99", peak: "#5a4a3a",
  };
  const NIGHT = {
    land: "#1c2228", wood: "#213029", woodOp: 1, grass: "#222b26", ice: "#2b333b", rock: "#262b30", town: "#2a3036", water: "#0e2232", river: "#1a3b55",
    shadow: "#000000", shadeX: 0.55, hi: "#56636f", hwy: "#d3a548", hwyCase: "#1c2228", paved: "#cfd6dd", pavedCase: "#1c2228", dirt: "#ff9a3c", dirtHalo: "#1c2228",
    path: "#8b939b", text: "#e9ecef", halo: "#11161b", park: "#5d8f6c", contour: "#55606a", contourText: "#8b96a0", waterText: "#6ea0c6", peak: "#c9cfd4",
  };

  // Gravel and dirt roads for zooms 7 to 12 (13 and closer: OpenFreeMap's own), from every province's OpenStreetMap
  // roads each week (scripts/build-dirt-roads.mjs, .github/workflows/dirt-roads.yml), on four Cloudflare Pages sites
  // picked by the zoom-7 tile, like the Winter far view. A tile that isn't there (no dirt roads) draws as empty.
  const dirtSite = (z, x, y) => (z < 7 ? 0 : ((x >> (z - 7)) * 31 + (y >> (z - 7))) % 4);
  let dirtReady = false;
  function dirtProtocol() {
    if (dirtReady || !window.maplibregl || !window.maplibregl.addProtocol) return dirtReady;
    window.maplibregl.addProtocol("tfdirt", async (params, abort) => {
      const [z, x, y] = params.url.replace("tfdirt://", "").split("/").map(Number);
      try {
        const r = await fetch(`https://trailfinder-dirt-${dirtSite(z, x, y)}.pages.dev/dirt/${z}/${x}/${y}.pbf`, { signal: abort.signal });
        return { data: r.ok ? await r.arrayBuffer() : new ArrayBuffer(0) };
      } catch (e) { if (abort.signal.aborted) throw e; return { data: new ArrayBuffer(0) }; }
    });
    return (dirtReady = true);
  }

  // Elevation lines: maplibre-contour (vendor/, see SOURCES.md) draws them from the height tiles in a worker, once.
  let contourUrl = null;
  function contours() {
    if (contourUrl !== null) return contourUrl;
    contourUrl = "";
    try {
      if (window.mlcontour && window.maplibregl) {
        const dem = new window.mlcontour.DemSource({ url: DEM, encoding: "terrarium", maxzoom: 13, worker: true });
        dem.setupMaplibre(window.maplibregl);
        contourUrl = dem.contourProtocolUrl({ multiplier: 1, thresholds: { 11: [100, 500], 12: [50, 250], 13: [20, 100], 14: [20, 100], 15: [10, 50] },
          elevationKey: "ele", levelKey: "level", contourLayer: "contours" });
      }
    } catch { contourUrl = ""; }
    return contourUrl;
  }

  function style(night) {
    const P = night ? NIGHT : DAY;
    const W = (a, b, c, d) => ["interpolate", ["exponential", 1.4], ["zoom"], a, b, c, d];
    const T = "transportation", isLine = ["match", ["geometry-type"], ["LineString", "MultiLineString"], true, false];
    const cls = (...c) => ["match", ["get", "class"], c, true, false];
    const unpaved = ["any", ["==", ["get", "class"], "track"], ["==", ["get", "surface"], "unpaved"]];
    const paved = ["!", unpaved], notTunnel = ["!=", ["get", "brunnel"], "tunnel"];
    const name = ["coalesce", ["get", "name_en"], ["get", "name"]];
    const sources = {
      omt: { type: "vector", url: "https://tiles.openfreemap.org/planet" },
      dem: { type: "raster-dem", encoding: "terrarium", tileSize: 512, maxzoom: 14, tiles: [DEM] },
    };
    const layers = [
      { id: "bg", type: "background", paint: { "background-color": P.land } },
      { id: "wood", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("wood", "forest"), paint: { "fill-color": P.wood, "fill-opacity": P.woodOp, "fill-antialias": false } },
      { id: "grass", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("grass", "farmland", "wetland"), paint: { "fill-color": P.grass, "fill-antialias": false } },
      { id: "rock", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("rock", "sand"), paint: { "fill-color": P.rock, "fill-antialias": false } },
      { id: "ice", type: "fill", source: "omt", "source-layer": "landcover", filter: cls("ice"), paint: { "fill-color": P.ice, "fill-antialias": false } },
      { id: "town", type: "fill", source: "omt", "source-layer": "landuse", filter: cls("residential", "suburb", "neighbourhood"), paint: { "fill-color": P.town, "fill-opacity": 0.8 } },
      { id: "shade", type: "hillshade", source: "dem", paint: { "hillshade-shadow-color": P.shadow, "hillshade-highlight-color": P.hi, "hillshade-accent-color": P.shadow,
        "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 7, P.shadeX * 0.55, 12, P.shadeX], "hillshade-illumination-direction": 315 } },
      { id: "water", type: "fill", source: "omt", "source-layer": "water", paint: { "fill-color": P.water } },
      { id: "river", type: "line", source: "omt", "source-layer": "waterway", paint: { "line-color": P.river, "line-width": W(8, 0.4, 16, 3) } },
      { id: "park", type: "line", source: "omt", "source-layer": "park", paint: { "line-color": P.park, "line-width": 1.6, "line-opacity": 0.55, "line-dasharray": [4, 2] } },
    ];
    const far = [];
    if (dirtProtocol()) {
      sources.dirt = { type: "vector", minzoom: 7, maxzoom: 11, tiles: ["tfdirt://{z}/{x}/{y}"], attribution: "Dirt roads: OpenStreetMap" };
      // Thin and light far out (a whole region's roads), as wide as the close-up ones by zoom 12.
      const fw = ["interpolate", ["linear"], ["zoom"], 7, 0.5, 10, 1, 12.9, ["case", ["==", ["get", "c"], "t"], 1.4, 1.8]];
      far.push(
        { id: "dirt-far-halo", type: "line", source: "dirt", "source-layer": "dirt", maxzoom: 13, minzoom: 9, layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": P.dirtHalo, "line-opacity": 0.7, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.4, 12.9, 3.6] } },
        { id: "dirt-far", type: "line", source: "dirt", "source-layer": "dirt", maxzoom: 13, layout: { "line-join": "round" },
          paint: { "line-color": P.dirt, "line-opacity": ["interpolate", ["linear"], ["zoom"], 7, 0.55, 10, 0.85, 12, 1], "line-width": fw,
            "line-dasharray": ["step", ["zoom"], ["literal", [1, 0]], 11, ["literal", [2.2, 1.1]]] } });
    }
    const lines = contours();
    if (lines) {
      sources.contours = { type: "vector", minzoom: 11, maxzoom: 15, tiles: [lines] };
      layers.push(
        { id: "contour", type: "line", source: "contours", "source-layer": "contours", minzoom: 11,
          paint: { "line-color": P.contour, "line-opacity": ["match", ["get", "level"], 1, 0.85, 0.45], "line-width": ["match", ["get", "level"], 1, 1.1, 0.5] } },
        { id: "contour-lbl", type: "symbol", source: "contours", "source-layer": "contours", minzoom: 12, filter: [">", ["get", "level"], 0],
          layout: { "symbol-placement": "line", "text-size": 10, "text-field": ["concat", ["number-format", ["get", "ele"], {}], " m"], "text-font": N },
          paint: { "text-color": P.contourText, "text-halo-color": P.halo, "text-halo-width": 1 } });
    }
    const road = (id, f, color, width, extra = {}) => ({ id, type: "line", source: "omt", "source-layer": T, filter: ["all", isLine, notTunnel, ...f],
      layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": width }, ...extra });
    layers.push(...far);   // over the elevation lines, under the paved roads, like the close-up dirt roads
    const dirtCls = cls("minor", "service", "track", "tertiary", "secondary");
    layers.push(
      road("path", [cls("path")], P.path, W(13, 0.6, 18, 2), { minzoom: 13, layout: { "line-join": "round" }, paint: { "line-color": P.path, "line-width": W(13, 0.6, 18, 2), "line-dasharray": [1.5, 1.5], "line-opacity": 0.8 } }),
      road("dirt-halo", [dirtCls, unpaved], P.dirtHalo, W(10, 2.5, 18, 12), { minzoom: dirtReady ? 13 : 0, paint: { "line-color": P.dirtHalo, "line-opacity": 0.85, "line-width": W(10, 2.5, 18, 12) } }),
      road("dirt", [dirtCls, unpaved], P.dirt, W(10, 1.4, 18, 7), { minzoom: dirtReady ? 13 : 0, layout: { "line-join": "round" }, paint: { "line-color": P.dirt, "line-width": W(10, 1.4, 18, 7), "line-dasharray": [2.2, 1.1] } }),
      road("minor-case", [cls("minor", "service"), paved], P.pavedCase, W(11, 1.2, 18, 14), { minzoom: 11 }),
      road("minor", [cls("minor", "service"), paved], P.paved, W(11, 0.6, 18, 11), { minzoom: 11 }),
      road("major-case", [cls("tertiary", "secondary"), paved], P.pavedCase, W(8, 1.5, 18, 20)),
      road("major", [cls("tertiary", "secondary"), paved], P.paved, W(8, 0.8, 18, 16)),
      road("hwy-case", [cls("trunk", "motorway", "primary")], P.hwyCase, W(6, 1.5, 18, 24)),
      road("hwy", [cls("trunk", "motorway", "primary")], P.hwy, W(6, 1, 18, 19)),
      { id: "water-lbl", type: "symbol", source: "omt", "source-layer": "water_name", layout: { "text-field": name, "text-font": I, "text-size": 12 },
        paint: { "text-color": P.waterText, "text-halo-color": P.halo, "text-halo-width": 1 } },
      { id: "road-lbl", type: "symbol", source: "omt", "source-layer": "transportation_name", minzoom: 12, filter: cls("minor", "service", "track", "tertiary", "secondary", "primary"),
        layout: { "symbol-placement": "line", "text-field": name, "text-font": N, "text-size": W(12, 10, 18, 14), "symbol-spacing": 350 },
        paint: { "text-color": P.text, "text-halo-color": P.halo, "text-halo-width": 1.6 } },
      { id: "shield", type: "symbol", source: "omt", "source-layer": "transportation_name", filter: ["all", ["has", "ref"], cls("trunk", "motorway", "primary")],
        layout: { "symbol-placement": "line", "symbol-spacing": 400, "text-field": ["get", "ref"], "text-font": B, "text-size": 11, "text-rotation-alignment": "viewport" },
        paint: { "text-color": "#fff", "text-halo-color": night ? "#7a5a1a" : P.hwyCase, "text-halo-width": 3 } },
      { id: "peak", type: "symbol", source: "omt", "source-layer": "mountain_peak", minzoom: 11, filter: ["has", "name"],
        layout: { "text-field": ["case", ["has", "ele"], ["concat", name, "\n", ["get", "ele"], " m"], name], "text-font": N, "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.4] },
        paint: { "text-color": P.peak, "text-halo-color": P.halo, "text-halo-width": 1.3 } },
      { id: "park-lbl", type: "symbol", source: "omt", "source-layer": "park", minzoom: 10, filter: ["has", "name"], layout: { "text-field": name, "text-font": I, "text-size": 11, "text-max-width": 8 },
        paint: { "text-color": P.park, "text-halo-color": P.halo, "text-halo-width": 1.2 } },
      { id: "place-sm", type: "symbol", source: "omt", "source-layer": "place", minzoom: 11, filter: cls("village", "hamlet", "suburb", "neighbourhood", "locality"),
        layout: { "text-field": name, "text-font": N, "text-size": 12 }, paint: { "text-color": P.text, "text-halo-color": P.halo, "text-halo-width": 1.6 } },
      { id: "place", type: "symbol", source: "omt", "source-layer": "place", filter: cls("city", "town"),
        layout: { "text-field": name, "text-font": B, "text-size": ["interpolate", ["linear"], ["zoom"], 6, 11, 14, 19] }, paint: { "text-color": P.text, "text-halo-color": P.halo, "text-halo-width": 2 } });
    return { version: 8, glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf", sources, layers };
  }

  // Is the sun down here? Below the horizon (about -0.8° with the air's bending), from the date and the place.
  const RAD = Math.PI / 180;
  function night(lat, lon, t = Date.now()) {
    const d = (t / 86400000) - 10957.5, g = (357.529 + 0.98560028 * d) * RAD, q = 280.459 + 0.98564736 * d;
    const L2 = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD, e = (23.439 - 0.00000036 * d) * RAD;
    const dec = Math.asin(Math.sin(e) * Math.sin(L2)), ra = Math.atan2(Math.cos(e) * Math.sin(L2), Math.cos(L2));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24, ha = (gmst * 15 + lon) * RAD - ra;
    const alt = Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha));
    return alt / RAD <= -0.83;
  }

  window.tfAdvMap = { style, night };
})();
