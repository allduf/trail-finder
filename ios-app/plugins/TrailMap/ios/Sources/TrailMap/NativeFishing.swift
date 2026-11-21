import CoreLocation
import Foundation
import MapLibre
import UIKit

// Fishing in native 3D (native 3D parity step 5, alex 2026-11-20: every web feature the same on the phone). The page
// side is native-fishing.js, the data comes from fishing.js (tfFish.native3d). The fishing dots and the zone outlines
// come over with the trails (the screen's own dots and lines); these three draw the rest of what the web 3D map draws
// for Fishing, the same way (fishing.js sync3d and overlays3d):
//   "fish": zone, park and boating-zone fills and names, the picked spot, the water colours (OpenFreeMap), Crown land
//           (each province's own server; Quebec through its WMS with our colour, so nothing is repainted here) and
//           the lake depth pictures (Manitoba's tiles, DataBC's few BC lakes);
//   "fish-creeks": creeks from further away (fishing.js farCreeks, the flat map reads them from zoom-13 tiles);
//   "fish-depth": lake depth lines and soundings (Ontario, Quebec, New Brunswick, from data/fishing/depth).
// Bottom to top as on the web: water colours, depth, Crown land, fills, under the trails; names and the spot on top.

// Shared bits for the three.
enum FishStyle {
    static let font = NSExpression(forConstantValue: ["Noto Sans Bold"])
    static func json(_ j: Any) -> NSExpression { NSExpression(mglJSONObject: j) }
    static func shape(_ obj: Any?) -> MLNShape? {
        guard let obj = obj, JSONSerialization.isValidJSONObject(obj), let d = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
        return try? MLNShape(data: d, encoding: String.Encoding.utf8.rawValue)
    }
    static func shape(_ text: String) -> MLNShape? {
        guard !text.isEmpty, let d = text.data(using: .utf8) else { return nil }
        return try? MLNShape(data: d, encoding: String.Encoding.utf8.rawValue)
    }
    static func bounds(_ b: Any?) -> NSValue? {
        guard let b = b as? [Double], b.count == 4 else { return nil }
        return NSValue(mlnCoordinateBounds: MLNCoordinateBounds(sw: CLLocationCoordinate2D(latitude: b[1], longitude: b[0]),
                                                                ne: CLLocationCoordinate2D(latitude: b[3], longitude: b[2])))
    }
    // Under the trails, and under the lowest layer whose id starts with one of `above` (the parts that go over it, so the
    // order stays the web's whichever of the three parts arrives or is rebuilt first).
    static func insert(_ l: MLNStyleLayer, _ style: MLNStyle, screen: TrailMapScreen?, above: [String] = []) {
        if !above.isEmpty, let b = style.layers.first(where: { s in above.contains { s.identifier.hasPrefix($0) } }) { style.insertLayer(l, below: b) }
        else if let b = screen?.trailsBottomLayer() { style.insertLayer(l, below: b) }
        else { style.addLayer(l) }
    }
    // Bottom to top: water colours, far creeks, depth lines, BC depth pictures, Crown land, fills.
    static let overWater = ["fs-creek-far", "fs-mb-line", "fs-q-line", "fs-q-pt", "fs-bcd", "fs-cl-", "fs-fill"]
    static let overCreeks = ["fs-lake", "fs-sea", "fs-mb-line", "fs-q-line", "fs-q-pt", "fs-bcd", "fs-cl-", "fs-fill"]
    static let overDepth = ["fs-bcd", "fs-cl-", "fs-fill"]
    static func remove(_ layers: [String], _ sources: [String], _ style: MLNStyle) {
        for id in layers { if let l = style.layer(withIdentifier: id) { style.removeLayer(l) } }
        for id in sources { if let s = style.source(withIdentifier: id) { style.removeSource(s) } }
    }
    static func label(_ id: String, _ src: MLNSource) -> MLNSymbolStyleLayer {
        let t = MLNSymbolStyleLayer(identifier: id, source: src)
        t.textFontNames = font
        t.textHaloColor = NSExpression(forConstantValue: UIColor.white)
        return t
    }
}

final class NativeFishing: NativeLayer {
    let key = "fish"
    private weak var screen: TrailMapScreen?
    private var data: [String: Any] = [:]
    private var built = ""               // the water / Crown land / depth setup now on the map
    private var round = 0
    private var layers: [String] = []
    private var sources: [String] = []

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        self.screen = screen
        layers = []; sources = []; built = ""
        build(style)
    }

    func setData(_ json: String, style: MLNStyle?) {
        round += 1
        let r = round
        DispatchQueue.global(qos: .userInitiated).async {
            let obj = (json.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any]
            DispatchQueue.main.async {
                guard r == self.round, let obj = obj else { return }
                self.data = obj
                guard let style = self.screen?.readyStyle else { return }
                if self.setup() != self.built || style.source(withIdentifier: "fs-fill") == nil { self.build(style); return }
                (style.source(withIdentifier: "fs-fill") as? MLNShapeSource)?.shape = FishStyle.shape(obj["fills"])
                (style.source(withIdentifier: "fs-names") as? MLNShapeSource)?.shape = FishStyle.shape(obj["names"])
                (style.source(withIdentifier: "fs-pin") as? MLNShapeSource)?.shape = FishStyle.shape(obj["pin"])
            }
        }
    }

    private func setup() -> String {
        let part: [String: Any] = ["w": data["water"] ?? NSNull(), "c": data["crown"] ?? NSNull(), "d": data["depth"] ?? NSNull()]
        guard let d = try? JSONSerialization.data(withJSONObject: part, options: [.sortedKeys]) else { return "" }
        return String(decoding: d, as: UTF8.self)
    }

    private func build(_ style: MLNStyle) {
        FishStyle.remove(layers, sources, style)
        layers = []; sources = []
        guard !data.isEmpty else { built = ""; return }
        built = setup()
        let under = { (l: MLNStyleLayer, above: [String]) in FishStyle.insert(l, style, screen: self.screen, above: above); self.layers.append(l.identifier) }
        let top = { (l: MLNStyleLayer) in style.addLayer(l); self.layers.append(l.identifier) }
        let add = { (s: MLNSource) in style.addSource(s); self.sources.append(s.identifier) }

        // The water colours (fishing.js WATER), from OpenFreeMap's vector tiles.
        let water = data["water"] as? [String: Bool] ?? [:]
        if water.values.contains(true), let url = URL(string: "https://tiles.openfreemap.org/planet") {
            let w = MLNVectorTileSource(identifier: "fs-w", configurationURL: url)
            add(w)
            let fill = { (id: String, filter: [Any], colour: String, opacity: Double) in
                let l = MLNFillStyleLayer(identifier: id, source: w)
                l.sourceLayerIdentifier = "water"
                l.predicate = NSPredicate(mglJSONObject: filter)
                l.fillColor = FishStyle.json(colour)
                l.fillOpacity = NSExpression(forConstantValue: opacity)
                under(l, FishStyle.overWater)
            }
            let line = { (id: String, layer: String, filter: [Any], colour: String, width: Any, dash: [Double]?) -> MLNLineStyleLayer in
                let l = MLNLineStyleLayer(identifier: id, source: w)
                l.sourceLayerIdentifier = layer
                l.predicate = NSPredicate(mglJSONObject: filter)
                l.lineColor = FishStyle.json(colour)
                l.lineWidth = FishStyle.json(width)
                l.lineCap = NSExpression(forConstantValue: "round")
                l.lineJoin = NSExpression(forConstantValue: "round")
                if let dash = dash { l.lineDashPattern = NSExpression(forConstantValue: dash) }
                under(l, FishStyle.overWater)
                return l
            }
            if water["rivers"] == true {
                fill("fs-riv-area", ["==", ["get", "class"], "river"], "#15d1ff", 0.75)
                _ = line("fs-riv-line", "waterway", ["in", ["get", "class"], ["literal", ["river", "canal"]]], "#15d1ff",
                         ["interpolate", ["linear"], ["zoom"], 6, 1.6, 10, 3, 14, 5], nil)
            }
            if water["creeks"] == true {
                // OpenFreeMap has the small creeks from zoom 13 ("fish-creeks" draws them further out); dashed when
                // they dry up in summer.
                let width: [Any] = ["interpolate", ["linear"], ["zoom"], 13, 1.6, 16, 3]
                line("fs-creek", "waterway", ["all", ["==", ["get", "class"], "stream"], ["!=", ["get", "intermittent"], 1]], "#8cf0ff", width, nil).minimumZoomLevel = 13
                line("fs-creek-i", "waterway", ["all", ["==", ["get", "class"], "stream"], ["==", ["get", "intermittent"], 1]], "#8cf0ff", width, [2, 1.5]).minimumZoomLevel = 13
            }
            if water["lakes"] == true {
                fill("fs-lake", ["in", ["get", "class"], ["literal", ["lake", "pond"]]], "#12d6b4", 0.75)
                _ = line("fs-lake-edge", "water", ["in", ["get", "class"], ["literal", ["lake", "pond"]]], "#d9fff7", 0.8, nil)
            }
            if water["ocean"] == true { fill("fs-sea", ["==", ["get", "class"], "ocean"], "#2f7bff", 0.6) }
        }

        // Lake depth pictures: Manitoba's vector tiles and DataBC's few drawn BC lakes ("fish-depth" draws the rest).
        var mbLabel: MLNSymbolStyleLayer?
        if let depth = data["depth"] as? [String: Any] {
            if let mb = depth["mb"] as? [String: Any], let tiles = mb["tiles"] as? String {
                var o: [MLNTileSourceOption: Any] = [.minimumZoomLevel: 0, .maximumZoomLevel: 16]
                if let b = FishStyle.bounds(mb["b"]) { o[.coordinateBounds] = b }
                let s = MLNVectorTileSource(identifier: "fs-mb", tileURLTemplates: [tiles], options: o)
                add(s)
                let colour = FishStyle.json((mb["c"] as? String) ?? "#1e40af")
                let l = MLNLineStyleLayer(identifier: "fs-mb-line", source: s)
                l.sourceLayerIdentifier = "Contours"
                l.lineColor = colour
                l.lineWidth = NSExpression(forConstantValue: 1.1)
                l.lineOpacity = NSExpression(forConstantValue: 0.85)
                l.minimumZoomLevel = 10
                under(l, ["fs-q-line", "fs-q-pt", "fs-bcd", "fs-cl-", "fs-fill"])
                let t = FishStyle.label("fs-mb-label", s)
                t.sourceLayerIdentifier = "Contours/label"
                t.predicate = NSPredicate(mglJSONObject: ["==", ["geometry-type"], "Point"])
                t.text = FishStyle.json(["concat", ["to-string", ["abs", ["to-number", ["get", "_name"], 0]]], " m"])
                t.textFontSize = NSExpression(forConstantValue: 11)
                t.textOptional = NSExpression(forConstantValue: true)
                t.textColor = colour
                t.textHaloWidth = NSExpression(forConstantValue: 1.6)
                t.minimumZoomLevel = 10
                mbLabel = t
            }
            if let bc = depth["bc"] as? [String: Any], let tiles = bc["tiles"] as? String {
                var o: [MLNTileSourceOption: Any] = [.minimumZoomLevel: 11, .maximumZoomLevel: 20, .tileSize: 256]
                if let b = FishStyle.bounds(bc["b"]) { o[.coordinateBounds] = b }
                let s = MLNRasterTileSource(identifier: "fs-bcd", tileURLTemplates: [tiles], options: o)
                add(s)
                let l = MLNRasterStyleLayer(identifier: "fs-bcd", source: s)
                l.rasterOpacity = NSExpression(forConstantValue: 0.85)
                l.minimumZoomLevel = 11
                under(l, ["fs-cl-", "fs-fill"])
            }
        }

        // Crown land: each province's own pictures (crownland.js), see-through as on the web.
        for c in data["crown"] as? [[String: Any]] ?? [] {
            guard let id = c["id"] as? String, let tiles = c["tiles"] as? String else { continue }
            let min = (c["min"] as? NSNumber)?.floatValue ?? 9
            var o: [MLNTileSourceOption: Any] = [.minimumZoomLevel: min, .maximumZoomLevel: 20, .tileSize: 256]
            if let b = FishStyle.bounds(c["b"]) { o[.coordinateBounds] = b }
            let s = MLNRasterTileSource(identifier: "fs-cl-" + id, tileURLTemplates: [tiles], options: o)
            add(s)
            let l = MLNRasterStyleLayer(identifier: "fs-cl-" + id, source: s)
            l.rasterOpacity = NSExpression(forConstantValue: (c["o"] as? NSNumber)?.doubleValue ?? 0.26)
            l.minimumZoomLevel = min
            under(l, ["fs-fill"])
        }

        // Zone, park and boating-zone fills.
        let fills = MLNShapeSource(identifier: "fs-fill", shape: FishStyle.shape(data["fills"]), options: nil)
        add(fills)
        let f = MLNFillStyleLayer(identifier: "fs-fill", source: fills)
        f.fillColor = NSExpression(forKeyPath: "c")
        f.fillOpacity = NSExpression(forKeyPath: "o")
        under(f, [])

        // On top: depth numbers, zone names, the picked spot.
        if let t = mbLabel { top(t) }
        let names = MLNShapeSource(identifier: "fs-names", shape: FishStyle.shape(data["names"]), options: nil)
        add(names)
        let n = FishStyle.label("fs-names", names)
        n.text = NSExpression(forKeyPath: "t")
        n.textFontSize = NSExpression(forConstantValue: 13)
        n.textColor = NSExpression(forKeyPath: "c")
        n.textHaloWidth = NSExpression(forConstantValue: 2)
        top(n)
        // The spot: a ring in the Fishing colour with a dot in the middle (.fs-spot in fishing.js).
        let accent = FishStyle.json((data["accent"] as? String) ?? "#0c8599")
        let pin = MLNShapeSource(identifier: "fs-pin", shape: FishStyle.shape(data["pin"]), options: nil)
        add(pin)
        let ring = { (id: String, r: Double, fill: NSExpression, fillOpacity: Double, stroke: NSExpression, sw: Double) in
            let c = MLNCircleStyleLayer(identifier: id, source: pin)
            c.circleRadius = NSExpression(forConstantValue: r)
            c.circleColor = fill
            c.circleOpacity = NSExpression(forConstantValue: fillOpacity)
            c.circleStrokeColor = stroke
            c.circleStrokeWidth = NSExpression(forConstantValue: sw)
            c.circlePitchAlignment = NSExpression(forConstantValue: "viewport")
            top(c)
        }
        let white = NSExpression(forConstantValue: UIColor.white)
        ring("fs-pin-halo", 12, white, 0, white, 2)
        ring("fs-pin", 10.5, white, 0.4, accent, 3)
        ring("fs-pin-dot", 4, accent, 1, white, 1.5)
    }
}

// Creeks from further away (zooms 10 to 13; OpenFreeMap's own creeks take over from 13).
final class NativeFishCreeks: NativeLayer {
    let key = "fish-creeks"
    private weak var screen: TrailMapScreen?
    private var shape: MLNShape?
    private var round = 0

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        self.screen = screen
        add(style)
    }
    func setData(_ json: String, style: MLNStyle?) {
        round += 1
        let r = round
        DispatchQueue.global(qos: .userInitiated).async {
            let s = FishStyle.shape(json)
            DispatchQueue.main.async {
                guard r == self.round else { return }
                self.shape = s
                guard let style = self.screen?.readyStyle else { return }
                if let src = style.source(withIdentifier: "fs-cf") as? MLNShapeSource { src.shape = s } else { self.add(style) }
            }
        }
    }
    private func add(_ style: MLNStyle) {
        guard shape != nil, style.source(withIdentifier: "fs-cf") == nil else { return }
        let src = MLNShapeSource(identifier: "fs-cf", shape: shape, options: nil)
        style.addSource(src)
        for dashed in [false, true] {
            let l = MLNLineStyleLayer(identifier: dashed ? "fs-creek-far-i" : "fs-creek-far", source: src)
            l.predicate = NSPredicate(mglJSONObject: [dashed ? "==" : "!=", ["get", "i"], 1])
            l.lineColor = FishStyle.json("#8cf0ff")
            l.lineWidth = FishStyle.json(["interpolate", ["linear"], ["zoom"], 10, 1, 13, 1.6])
            l.lineOpacity = FishStyle.json(["interpolate", ["linear"], ["zoom"], 10, 0.85, 12, 1])
            l.lineCap = NSExpression(forConstantValue: "round")
            l.lineJoin = NSExpression(forConstantValue: "round")
            if dashed { l.lineDashPattern = NSExpression(forConstantValue: [2, 1.5]) }
            l.maximumZoomLevel = 13
            FishStyle.insert(l, style, screen: screen, above: FishStyle.overCreeks)
        }
    }
}

// Lake depth lines and soundings (fishing.js depthStyle "q"), from zoom 10 as on the web.
final class NativeFishDepth: NativeLayer {
    let key = "fish-depth"
    private weak var screen: TrailMapScreen?
    private var shape: MLNShape?
    private var round = 0
    // DEPTH_COL in fishing.js: lighter in the shallows, darker deeper down.
    private static let colour: [Any] = ["interpolate", ["linear"], ["get", "d"], 0, "#5fc4f0", 5, "#2b8fd6", 15, "#1d5fb8", 40, "#173a8a"]

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        self.screen = screen
        add(style)
    }
    func setData(_ json: String, style: MLNStyle?) {
        round += 1
        let r = round
        // A view's depth lines can be a few MB: read off the main thread.
        DispatchQueue.global(qos: .userInitiated).async {
            let s = FishStyle.shape(json)
            DispatchQueue.main.async {
                guard r == self.round else { return }
                self.shape = s
                guard let style = self.screen?.readyStyle else { return }
                if let src = style.source(withIdentifier: "fs-q") as? MLNShapeSource { src.shape = s } else { self.add(style) }
            }
        }
    }
    private func add(_ style: MLNStyle) {
        guard shape != nil, style.source(withIdentifier: "fs-q") == nil else { return }
        let src = MLNShapeSource(identifier: "fs-q", shape: shape, options: nil)
        style.addSource(src)
        let isLine: [Any] = ["==", ["geometry-type"], "LineString"], isPoint: [Any] = ["==", ["geometry-type"], "Point"]
        let l = MLNLineStyleLayer(identifier: "fs-q-line", source: src)
        l.predicate = NSPredicate(mglJSONObject: isLine)
        l.lineColor = FishStyle.json(Self.colour)
        l.lineWidth = FishStyle.json(["interpolate", ["linear"], ["zoom"], 12, 0.9, 16, 1.6])
        l.lineOpacity = NSExpression(forConstantValue: 0.9)
        l.lineCap = NSExpression(forConstantValue: "round")
        l.lineJoin = NSExpression(forConstantValue: "round")
        l.minimumZoomLevel = 10
        FishStyle.insert(l, style, screen: screen, above: FishStyle.overDepth)
        let p = MLNCircleStyleLayer(identifier: "fs-q-pt", source: src)
        p.predicate = NSPredicate(mglJSONObject: isPoint)
        p.circleRadius = NSExpression(forConstantValue: 1.6)
        p.circleColor = FishStyle.json(Self.colour)
        p.minimumZoomLevel = 13
        FishStyle.insert(p, style, screen: screen, above: FishStyle.overDepth)
        let dark = FishStyle.json("#173a8a")
        let t = FishStyle.label("fs-q-label", src)
        t.predicate = NSPredicate(mglJSONObject: ["all", isLine, [">", ["get", "d"], 0]])
        t.symbolPlacement = NSExpression(forConstantValue: "line")
        t.symbolSpacing = NSExpression(forConstantValue: 280)
        t.text = FishStyle.json(["concat", ["to-string", ["get", "d"]], " m"])
        t.textFontSize = NSExpression(forConstantValue: 11)
        t.maximumTextAngle = NSExpression(forConstantValue: 30)
        t.textColor = dark
        t.textHaloWidth = NSExpression(forConstantValue: 1.6)
        t.minimumZoomLevel = 13
        style.addLayer(t)
        let n = FishStyle.label("fs-q-ptlabel", src)
        n.predicate = NSPredicate(mglJSONObject: isPoint)
        n.text = FishStyle.json(["to-string", ["get", "d"]])
        n.textFontSize = NSExpression(forConstantValue: 10)
        n.textOffset = NSExpression(forConstantValue: NSValue(cgVector: CGVector(dx: 0, dy: -0.8)))
        n.textPadding = NSExpression(forConstantValue: 1)
        n.textColor = dark
        n.textHaloWidth = NSExpression(forConstantValue: 1.4)
        n.minimumZoomLevel = 14
        style.addLayer(n)
    }
}
