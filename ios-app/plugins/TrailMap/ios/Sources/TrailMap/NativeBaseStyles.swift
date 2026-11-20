import Foundation

// The native 3D map's base maps, built like the web 3D map's (map3d.js, its style in build()): step 1 of making native 3D
// the main 3D on phones (alex 2026-11-20). Every 3D style has, bottom to top: its ground pictures, the roads and paths
// (OpenFreeMap, the web 3D's osm-roads / osm-paths), then the trails (added by the screen just under the names) and
// the lake, peak and town names (water-names / peaks / towns), sharp at any distance and drawn by the phone.
//   sat:    Esri's photo (through the app's own key, handed over by the page: the keyless address isn't licensed for
//           apps), with the late-summer mountains over it in the Sea to Sky (the web's sumhi, through WinterTiles).
//   topo:   OpenTopoMap from zoom 13 (blurry, blocky further out); further out the ground from OpenFreeMap's data,
//           woods, open ground, rock, ice and water, with the hills shaded (the web's off-land / topo-shade).
//   osm:    OpenStreetMap's map, toned down like the flat map's Map style.
//   winter: Skiing only (WinterTiles.swift).
// Keep the colours and numbers here in step with map3d.js.
extension TrailMapScreen {
    static let keylessEsri = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
    static let esriCredit = "Imagery © Esri, Maxar, Earthstar Geographics"
    static let osmCredit = "© OpenStreetMap contributors"
    // Heights: Mapterhorn (free, open), Terrarium-coded 512 px tiles, every spot down to zoom 12 (~12 m a pixel here).
    // Deeper ones exist only in some places, and a missing one leaves a hole, so the map stops asking at 12.
    static let demTiles = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"
    static let demCredit = "© Mapterhorn"

    // esri: the page's Esri photo address ({z}/{y}/{x}), or nil for the keyless one. fr: names in French when they have one.
    static func style3D(_ key: String, esri: String?, fr: Bool) -> [String: Any] {
        let photo = esri ?? keylessEsri
        var sources: [String: Any] = [
            "dem": ["type": "raster-dem", "encoding": "terrarium", "tiles": [demTiles], "tileSize": 512, "maxzoom": 12, "attribution": demCredit],
            // Sharp place, peak and lake names, roads and paths (and Topo's far ground) from OpenFreeMap (free, no key).
            "names": ["type": "vector", "url": "https://tiles.openfreemap.org/planet", "attribution": "OpenFreeMap " + osmCredit]
        ]
        var ground: [[String: Any]] = []
        switch key {
        case "winter":
            let w = WinterTiles.style(esri: photo, credit: esriCredit)
            sources.merge(w.sources) { a, _ in a }
            ground = w.layers
        case "topo":
            sources["topo"] = ["type": "raster", "tileSize": 256, "minzoom": 13, "maxzoom": 17, "attribution": "Topo: © OpenTopoMap (CC-BY-SA), SRTM, " + osmCredit,
                               "tiles": ["a", "b", "c"].map { "https://\($0).tile.opentopomap.org/{z}/{x}/{y}.png" }]
            sources["shade"] = ["type": "raster-dem", "encoding": "terrarium", "tiles": [demTiles], "tileSize": 512, "maxzoom": 12]
            ground = [
                ["id": "background", "type": "background", "paint": ["background-color": "#dfe5d2"]],
                ["id": "off-land", "type": "fill", "source": "names", "source-layer": "landcover",
                 "paint": ["fill-color": ["match", ["get", "class"], "wood", "#a7c496", "grass", "#d4e3b5", "rock", "#d3cfc6", "ice", "#f3f7fa",
                                          "sand", "#ece2c3", "wetland", "#c2dacb", "farmland", "#e3e6c3", "#d6e0c4"] as [Any]]],
                ["id": "off-water", "type": "fill", "source": "names", "source-layer": "water", "paint": ["fill-color": "#98c0e4"]],
                ["id": "topo-shade", "type": "hillshade", "source": "shade",
                 "paint": ["hillshade-exaggeration": 0.45, "hillshade-shadow-color": "#5b5a45", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#6d6a52"]],
                ["id": "topo", "type": "raster", "source": "topo", "paint": ["raster-fade-duration": 0]]
            ]
        case "osm":
            sources["osm"] = ["type": "raster", "tileSize": 256, "maxzoom": 19, "attribution": osmCredit, "tiles": ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"]]
            ground = [
                ["id": "background", "type": "background", "paint": ["background-color": "#f2efe7"]],
                ["id": "osm", "type": "raster", "source": "osm",
                 "paint": ["raster-fade-duration": 0, "raster-saturation": -0.38, "raster-brightness-min": 0.05, "raster-contrast": -0.1]]
            ]
        default:   // "sat"
            sources["sat"] = ["type": "raster", "tileSize": 256, "maxzoom": 19, "attribution": esriCredit, "tiles": [photo]]
            sources["sumhi"] = ["type": "raster", "tileSize": 256, "minzoom": 11, "maxzoom": 15, "bounds": WinterTiles.summerBounds,
                                "tiles": ["https://\(WinterTiles.host)/sum/{z}/{x}/{y}"], "attribution": "Mountains: Copernicus Sentinel-2 data 2025 (ESA)"]
            ground = [
                ["id": "background", "type": "background", "paint": ["background-color": "#f2efe7"]],
                ["id": "sat", "type": "raster", "source": "sat", "paint": ["raster-contrast": 0.08, "raster-saturation": 0.12, "raster-brightness-min": 0.02]],
                ["id": "sumhi", "type": "raster", "source": "sumhi", "paint": ["raster-fade-duration": 0]]
            ]
        }
        return [
            "version": 8,
            "glyphs": "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
            "sources": sources,
            "layers": ground + roadLayers() + nameLayers(fr: fr)
        ]
    }

    // The first name layer: the screen puts the trails just under it, so names stay readable over the lines.
    static let firstNameLayer = "water-names"

    private static func roadLayers() -> [[String: Any]] {
        let big: [Any] = ["motorway", "trunk", "primary"]
        return [
            ["id": "osm-roads", "type": "line", "source": "names", "source-layer": "transportation", "minzoom": 9,
             "filter": ["in", ["get", "class"], ["literal", ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track"]]] as [Any],
             "layout": ["line-cap": "round", "line-join": "round"],
             "paint": ["line-color": ["match", ["get", "class"], "track", "#c9a77a", "#f2efe6"] as [Any], "line-opacity": 0.8,
                       "line-width": ["interpolate", ["linear"], ["zoom"], 10, ["match", ["get", "class"], big, 2, 0.6] as [Any],
                                      15, ["match", ["get", "class"], big, 5, "track", 1.6, 2.2] as [Any]] as [Any]]],
            ["id": "osm-paths", "type": "line", "source": "names", "source-layer": "transportation", "minzoom": 11.5,
             "filter": ["==", ["get", "class"], "path"] as [Any],
             "paint": ["line-color": "#fff6e0", "line-opacity": 0.75, "line-dasharray": [2, 1.5],
                       "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 16, 1.6] as [Any]]]
        ]
    }

    private static func nameLayers(fr: Bool) -> [[String: Any]] {
        // PLACE_NAME in map3d.js: a place with a non-Latin name shows its English (or French) one.
        var coalesce: [Any] = ["coalesce"]
        if fr { coalesce.append(["get", "name:fr"]) }
        coalesce.append(["get", "name:en"]); coalesce.append(["get", "name:latin"]); coalesce.append(["get", "name"])
        let name: [Any] = ["case", ["has", "name:nonlatin"], coalesce, ["get", "name"]]
        return [
            ["id": firstNameLayer, "type": "symbol", "source": "names", "source-layer": "water_name", "minzoom": 10,
             "layout": ["text-field": name, "text-font": ["Noto Sans Italic"], "text-size": 12],
             "paint": ["text-color": "#d4ecff", "text-halo-color": "rgba(10,30,50,0.8)", "text-halo-width": 1.2]],
            ["id": "peaks", "type": "symbol", "source": "names", "source-layer": "mountain_peak", "minzoom": 10.5, "filter": ["has", "name"],
             "layout": ["text-field": ["case", ["has", "ele"], ["concat", "▲ ", name, "\n", ["to-string", ["get", "ele"]], " m"], ["concat", "▲ ", name]] as [Any],
                        "text-font": ["Noto Sans Regular"], "text-size": 11.5, "text-anchor": "bottom",
                        "symbol-sort-key": ["-", 0, ["coalesce", ["get", "ele"], 0]] as [Any]],
             "paint": ["text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.3]],
            ["id": "towns", "type": "symbol", "source": "names", "source-layer": "place",
             "filter": ["in", ["get", "class"], ["literal", ["city", "town", "village", "hamlet", "suburb", "locality"]]] as [Any],
             "layout": ["text-field": name, "text-font": ["Noto Sans Bold"],
                        "text-size": ["match", ["get", "class"], "city", 17, "town", 15, "village", 13, 11.5] as [Any],
                        "symbol-sort-key": ["match", ["get", "class"], "city", 0, "town", 1, "village", 2, 3] as [Any]],
             "paint": ["text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.8)", "text-halo-width": 1.5]]
        ]
    }
}
