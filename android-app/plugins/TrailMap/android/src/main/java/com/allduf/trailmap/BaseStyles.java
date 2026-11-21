package com.allduf.trailmap;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

// The native map's base maps, the same as the iPhone's (NativeBaseStyles.swift), built like the web 3D map's (map3d.js,
// its style in build()). Every 3D style has, bottom to top: its ground pictures, the roads and paths (OpenFreeMap, the
// web 3D's osm-roads / osm-paths), then the trails (added by the screen just under the names) and the lake, peak and
// town names (water-names / peaks / towns), sharp at any distance and drawn by the phone.
//   sat:    Esri's photo (through the app's own key, handed over by the page), with the late-summer mountains over it in
//           the Sea to Sky (the web's sumhi, through WinterTiles).
//   topo:   OpenTopoMap from zoom 13; further out the ground from OpenFreeMap's data, with the hills shaded.
//   osm:    OpenStreetMap's map, toned down like the flat map's Map style.
//   winter: Skiing only (WinterTiles.java).
// Keep the colours and numbers here in step with NativeBaseStyles.swift and map3d.js.
final class BaseStyles {
    static final String KEYLESS_ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
    static final String ESRI_CREDIT = "Imagery © Esri, Maxar, Earthstar Geographics";
    static final String OSM_CREDIT = "© OpenStreetMap contributors";
    // Heights: Mapterhorn (free, open), Terrarium-coded 512 px tiles, every spot down to zoom 12; deeper ones exist only
    // in some places and a missing one leaves a hole, so the map stops asking at 12.
    static final String DEM_TILES = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp";
    static final String DEM_CREDIT = "© Mapterhorn";
    // The first name layer: the screen puts the trails just under it, so names stay readable over the lines.
    static final String FIRST_NAME_LAYER = "water-names";
    private static final String[] OPENTOPO = {
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png", "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"
    };

    // Small helpers for writing style JSON: o("k", v, "k2", v2...) and a(v, v2...).
    static JSONObject o(Object... kv) {
        JSONObject j = new JSONObject();
        try { for (int i = 0; i + 1 < kv.length; i += 2) j.put((String) kv[i], kv[i + 1]); } catch (JSONException ignored) {}
        return j;
    }
    static JSONArray a(Object... v) {
        JSONArray j = new JSONArray();
        for (Object x : v) j.put(x);
        return j;
    }

    // The flat map's styles (Native map (test), MTB): the web map's own pictures; "vector" is OpenFreeMap's outdoor map.
    static String flat(String key, String esri) {
        String[] tiles; int maxzoom = 19; String credit;
        switch (key) {
            case "topo": tiles = OPENTOPO; maxzoom = 17; credit = OSM_CREDIT + ", SRTM | © OpenTopoMap"; break;
            case "sat": tiles = new String[] { esri != null ? esri : KEYLESS_ESRI }; credit = ESRI_CREDIT; break;
            default: tiles = new String[] { "https://tile.openstreetmap.org/{z}/{x}/{y}.png" }; credit = OSM_CREDIT;
        }
        return o(
            "version", 8,
            "sources", o("base", o("type", "raster", "tiles", a((Object[]) tiles), "tileSize", 256, "maxzoom", maxzoom, "attribution", credit)),
            "layers", a(o("id", "background", "type", "background", "paint", o("background-color", "#f2efe7")),
                        o("id", "base", "type", "raster", "source", "base"))
        ).toString();
    }

    // esri: the page's Esri photo address ({z}/{y}/{x}), or null for the keyless one. fr: names in French when they have one.
    static String threeD(String key, String esri, boolean fr) {
        String photo = esri != null ? esri : KEYLESS_ESRI;
        JSONObject sources = o(
            "dem", o("type", "raster-dem", "encoding", "terrarium", "tiles", a(DEM_TILES), "tileSize", 512, "maxzoom", 12, "attribution", DEM_CREDIT),
            "names", o("type", "vector", "url", "https://tiles.openfreemap.org/planet", "attribution", "OpenFreeMap " + OSM_CREDIT)
        );
        JSONArray ground = new JSONArray();
        try {
            switch (key) {
                case "winter": {
                    JSONObject w = WinterTiles.sources(photo, ESRI_CREDIT);
                    for (java.util.Iterator<String> it = w.keys(); it.hasNext(); ) { String k = it.next(); sources.put(k, w.get(k)); }
                    ground = WinterTiles.layers();
                    break;
                }
                case "topo":
                    sources.put("topo", o("type", "raster", "tileSize", 256, "minzoom", 13, "maxzoom", 17,
                        "attribution", "Topo: © OpenTopoMap (CC-BY-SA), SRTM, " + OSM_CREDIT, "tiles", a((Object[]) OPENTOPO)));
                    sources.put("shade", o("type", "raster-dem", "encoding", "terrarium", "tiles", a(DEM_TILES), "tileSize", 512, "maxzoom", 12));
                    ground = a(
                        o("id", "background", "type", "background", "paint", o("background-color", "#dfe5d2")),
                        o("id", "off-land", "type", "fill", "source", "names", "source-layer", "landcover",
                          "paint", o("fill-color", a("match", a("get", "class"), "wood", "#a7c496", "grass", "#d4e3b5", "rock", "#d3cfc6", "ice", "#f3f7fa",
                                                     "sand", "#ece2c3", "wetland", "#c2dacb", "farmland", "#e3e6c3", "#d6e0c4"))),
                        o("id", "off-water", "type", "fill", "source", "names", "source-layer", "water", "paint", o("fill-color", "#98c0e4")),
                        o("id", "topo-shade", "type", "hillshade", "source", "shade",
                          "paint", o("hillshade-exaggeration", 0.45, "hillshade-shadow-color", "#5b5a45", "hillshade-highlight-color", "#ffffff", "hillshade-accent-color", "#6d6a52")),
                        o("id", "topo", "type", "raster", "source", "topo", "paint", o("raster-fade-duration", 0))
                    );
                    break;
                case "osm":
                    sources.put("osm", o("type", "raster", "tileSize", 256, "maxzoom", 19, "attribution", OSM_CREDIT, "tiles", a("https://tile.openstreetmap.org/{z}/{x}/{y}.png")));
                    ground = a(
                        o("id", "background", "type", "background", "paint", o("background-color", "#f2efe7")),
                        o("id", "osm", "type", "raster", "source", "osm",
                          "paint", o("raster-fade-duration", 0, "raster-saturation", -0.38, "raster-brightness-min", 0.05, "raster-contrast", -0.1))
                    );
                    break;
                default:   // "sat"
                    sources.put("sat", o("type", "raster", "tileSize", 256, "maxzoom", 19, "attribution", ESRI_CREDIT, "tiles", a(photo)));
                    sources.put("sumhi", o("type", "raster", "tileSize", 256, "minzoom", 11, "maxzoom", 15, "bounds", WinterTiles.summerBounds(),
                        "tiles", a("https://" + WinterTiles.HOST + "/sum/{z}/{x}/{y}"), "attribution", "Mountains: Copernicus Sentinel-2 data 2025 (ESA)"));
                    ground = a(
                        o("id", "background", "type", "background", "paint", o("background-color", "#f2efe7")),
                        o("id", "sat", "type", "raster", "source", "sat", "paint", o("raster-contrast", 0.08, "raster-saturation", 0.12, "raster-brightness-min", 0.02)),
                        o("id", "sumhi", "type", "raster", "source", "sumhi", "paint", o("raster-fade-duration", 0))
                    );
            }
        } catch (JSONException ignored) {}
        JSONArray layers = new JSONArray();
        for (JSONArray part : new JSONArray[] { ground, roadLayers(), nameLayers(fr) })
            for (int i = 0; i < part.length(); i++) layers.put(part.opt(i));
        return o(
            "version", 8,
            "glyphs", "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
            "sources", sources,
            "layers", layers
        ).toString();
    }

    private static JSONArray roadLayers() {
        JSONArray big = a("motorway", "trunk", "primary");
        return a(
            o("id", "osm-roads", "type", "line", "source", "names", "source-layer", "transportation", "minzoom", 9,
              "filter", a("in", a("get", "class"), a("literal", a("motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track"))),
              "layout", o("line-cap", "round", "line-join", "round"),
              "paint", o("line-color", a("match", a("get", "class"), "track", "#c9a77a", "#f2efe6"), "line-opacity", 0.8,
                         "line-width", a("interpolate", a("linear"), a("zoom"), 10, a("match", a("get", "class"), big, 2, 0.6),
                                         15, a("match", a("get", "class"), big, 5, "track", 1.6, 2.2)))),
            o("id", "osm-paths", "type", "line", "source", "names", "source-layer", "transportation", "minzoom", 11.5,
              "filter", a("==", a("get", "class"), "path"),
              "paint", o("line-color", "#fff6e0", "line-opacity", 0.75, "line-dasharray", a(2, 1.5),
                         "line-width", a("interpolate", a("linear"), a("zoom"), 12, 0.6, 16, 1.6)))
        );
    }

    private static JSONArray nameLayers(boolean fr) {
        // PLACE_NAME in map3d.js: a place with a non-Latin name shows its English (or French) one.
        JSONArray coalesce = a("coalesce");
        if (fr) coalesce.put(a("get", "name:fr"));
        coalesce.put(a("get", "name:en")); coalesce.put(a("get", "name:latin")); coalesce.put(a("get", "name"));
        JSONArray name = a("case", a("has", "name:nonlatin"), coalesce, a("get", "name"));
        return a(
            o("id", FIRST_NAME_LAYER, "type", "symbol", "source", "names", "source-layer", "water_name", "minzoom", 10,
              "layout", o("text-field", name, "text-font", a("Noto Sans Italic"), "text-size", 12),
              "paint", o("text-color", "#d4ecff", "text-halo-color", "rgba(10,30,50,0.8)", "text-halo-width", 1.2)),
            o("id", "peaks", "type", "symbol", "source", "names", "source-layer", "mountain_peak", "minzoom", 10.5, "filter", a("has", "name"),
              "layout", o("text-field", a("case", a("has", "ele"), a("concat", "▲ ", name, "\n", a("to-string", a("get", "ele")), " m"), a("concat", "▲ ", name)),
                          "text-font", a("Noto Sans Regular"), "text-size", 11.5, "text-anchor", "bottom",
                          "symbol-sort-key", a("-", 0, a("coalesce", a("get", "ele"), 0))),
              "paint", o("text-color", "#ffffff", "text-halo-color", "rgba(0,0,0,0.75)", "text-halo-width", 1.3)),
            o("id", "towns", "type", "symbol", "source", "names", "source-layer", "place",
              "filter", a("in", a("get", "class"), a("literal", a("city", "town", "village", "hamlet", "suburb", "locality"))),
              "layout", o("text-field", name, "text-font", a("Noto Sans Bold"),
                          "text-size", a("match", a("get", "class"), "city", 17, "town", 15, "village", 13, 11.5),
                          "symbol-sort-key", a("match", a("get", "class"), "city", 0, "town", 1, "village", 2, 3)),
              "paint", o("text-color", "#ffffff", "text-halo-color", "rgba(0,0,0,0.8)", "text-halo-width", 1.5))
        );
    }
}
