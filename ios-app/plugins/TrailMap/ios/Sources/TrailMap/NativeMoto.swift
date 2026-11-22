import Foundation
import MapLibre
import UIKit

// Adventure moto in native 3D (alex 2026-11-20, native 3D parity): what the web 3D map draws for Moto (moto.js sync3d),
// with the page side in native-moto.js. Under the trails, the dirt roads coloured for the rider's bike: BC's forest roads
// (DataBC map images, from zoom 8, BC only), our own far dirt-road tiles up to zoom 13 and OpenFreeMap's roads and tracks
// from 13 (it drops them further out), tracks dashed. Over the trails, the stops (gas, campsites, BC rec sites, hot
// springs, shops, ferries) as the web 3D map's dots; MapLibre leaves out the ones that would sit on each other, gas first.
// A tap on a stop shows its name; "Details" opens its card on the page. Routes, trips and day rides are lines on the flat
// map, so they come with the trails. Data (JSON): { roads, road, track, ften, pts: [[lat, lon, kind, colour, name]] }.
final class NativeMoto: NativeLayer {
    let key = "moto"
    var tapLayers: [String] { ["mt-pts"] }

    private struct Roads: Equatable { var on = false; var road = "#2f9e44"; var track = "#f08c00"; var ften = "" }
    private var roads = Roads()
    private var drawn: Roads?            // what the current style has (nil: nothing yet)
    private var pts: MLNShape?
    private var colours: [String: String] = [:]   // stop kind -> its colour (one dot image each)

    private static let ofm = URL(string: "https://tiles.openfreemap.org/planet")!
    // Far dirt roads (scripts/build-dirt-roads.mjs, zooms 7-11) on four sites picked by the zoom-7 square, as index.html's
    // tfdirt://; a missing tile (no dirt roads there) is a real "not found", which MapLibre draws as empty.
    private static let dirtHost = "dirt.trailfinder.invalid"
    private static var rewriting = false
    private static let order = ["fuel", "camp", "rec", "hot", "shop", "ferry"]   // which dot wins a crowded spot

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        drawn = nil
        draw(style, screen: screen)
    }

    func setData(_ json: String, style: MLNStyle?) {
        guard let data = json.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        roads = Roads(on: o["roads"] as? Bool ?? false, road: o["road"] as? String ?? roads.road,
                      track: o["track"] as? String ?? roads.track, ften: o["ften"] as? String ?? "")
        var feats: [MLNPointFeature] = []
        for case let p as [Any] in (o["pts"] as? [Any]) ?? [] where p.count >= 5 {
            guard let lat = (p[0] as? NSNumber)?.doubleValue, let lon = (p[1] as? NSNumber)?.doubleValue,
                  let k = p[2] as? String, let c = p[3] as? String else { continue }
            let f = MLNPointFeature()
            f.coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lon)
            f.attributes = ["k": k, "c": c, "n": (p[4] as? String) ?? "", "s": Self.order.firstIndex(of: k) ?? 9, "la": lat, "lo": lon]
            colours[k] = c
            feats.append(f)
        }
        pts = MLNShapeCollectionFeature(shapes: feats)
        if let style = style { draw(style, screen: nil) }
    }

    func tapped(_ feature: MLNFeature, screen: TrailMapScreen) -> Bool {
        guard let name = feature.attribute(forKey: "n") as? String, !name.isEmpty else { return false }
        // The stop's own spot (a tapped feature's coordinate is rounded to its tile): the page finds the stop by it.
        let la = (feature.attribute(forKey: "la") as? NSNumber)?.doubleValue, lo = (feature.attribute(forKey: "lo") as? NSNumber)?.doubleValue
        let at = la != nil && lo != nil ? CLLocationCoordinate2D(latitude: la!, longitude: lo!) : feature.coordinate
        screen.showFeatureCard(name: name, colour: feature.attribute(forKey: "c") as? String, open: -1, at: at)
        return true
    }

    // ---------- drawing ----------
    private func draw(_ style: MLNStyle, screen: TrailMapScreen?) {
        let under = screen?.trailsBottomLayer() ?? style.layer(withIdentifier: "tf-line")
        if drawn != roads {
            removeRoads(style)
            if roads.on { addRoads(style, under: under) }
            drawn = roads
        }
        for (k, c) in colours where style.image(forName: "mt-dot-" + k) == nil {
            style.setImage(Self.dot(c), forName: "mt-dot-" + k)
        }
        if let src = style.source(withIdentifier: "mt-pts") as? MLNShapeSource { src.shape = pts; return }
        guard pts != nil else { return }
        let src = MLNShapeSource(identifier: "mt-pts", shape: pts, options: nil)
        style.addSource(src)
        let l = MLNSymbolStyleLayer(identifier: "mt-pts", source: src)
        l.iconImageName = NSExpression(mglJSONObject: ["concat", "mt-dot-", ["get", "k"]])
        l.iconAllowsOverlap = NSExpression(forConstantValue: false)
        l.symbolSortKey = NSExpression(forKeyPath: "s")
        l.iconPitchAlignment = NSExpression(forConstantValue: "viewport")
        style.addLayer(l)   // over the trails, as the web map's pins
    }

    private static let roadIds = ["mt-ften", "mt-far-case", "mt-far-road", "mt-far-track", "mt-case", "mt-road", "mt-track"]
    private func removeRoads(_ style: MLNStyle) {
        for id in Self.roadIds { if let l = style.layer(withIdentifier: id) { style.removeLayer(l) } }
        for id in ["mt-ften", "mt-ofm", "mt-dirt"] { if let s = style.source(withIdentifier: id) { style.removeSource(s) } }
    }

    private func addRoads(_ style: MLNStyle, under: MLNStyleLayer?) {
        let put = { (l: MLNStyleLayer) in if let u = under { style.insertLayer(l, below: u) } else { style.addLayer(l) } }
        let json = { (o: Any) in NSExpression(mglJSONObject: o) }
        // BC forest roads (moto.js ftenTiles): already coloured for the bike by the page's map style.
        if !roads.ften.isEmpty {
            let src = MLNRasterTileSource(identifier: "mt-ften", tileURLTemplates: [roads.ften], options: [
                .minimumZoomLevel: 8, .maximumZoomLevel: 17, .tileSize: 256,
                .coordinateBounds: NSValue(mlnCoordinateBounds: MLNCoordinateBounds(
                    sw: CLLocationCoordinate2D(latitude: 48.2, longitude: -139.1), ne: CLLocationCoordinate2D(latitude: 60, longitude: -114)))
            ])
            style.addSource(src)
            let l = MLNRasterStyleLayer(identifier: "mt-ften", source: src)
            l.minimumZoomLevel = 8
            l.rasterOpacity = json(["interpolate", ["linear"], ["zoom"], 8, 0.6, 11, 0.8, 13, 0.95])
            put(l)
        }
        // Far dirt roads up to zoom 13: "c" is "t" for a track, "r" for a gravel road.
        if !Self.rewriting {
            Self.rewriting = true
            TileRewriter.add(host: Self.dirtHost) { url in
                let p = url.path.split(separator: "/").compactMap { Int($0) }
                guard p.count == 3 else { return url }
                let (z, x, y) = (p[0], p[1], p[2])
                let site = z < 7 ? 0 : ((x >> (z - 7)) * 31 + (y >> (z - 7))) % 4
                return URL(string: "https://trailfinder-dirt-\(site).pages.dev/dirt/\(z)/\(x)/\(y).pbf") ?? url
            }
        }
        let dirt = MLNVectorTileSource(identifier: "mt-dirt", tileURLTemplates: ["https://\(Self.dirtHost)/{z}/{x}/{y}"],
                                       options: [.minimumZoomLevel: 7, .maximumZoomLevel: 11])
        style.addSource(dirt)
        // The two colours as UIColor constants: "to-color" on a text turns into a CAST that NSPredicate rejects, which
        // closed the app on opening 3D in Moto (simulator crash report, 2026-11-22).
        let farColour = NSExpression(format: "TERNARY(c == 't', %@, %@)", Self.colour(roads.track), Self.colour(roads.road))
        let farWidth = json(["interpolate", ["linear"], ["zoom"], 7, 0.6, 10, 1.1, 12.9, 2.5])
        let farCase = MLNLineStyleLayer(identifier: "mt-far-case", source: dirt)
        farCase.sourceLayerIdentifier = "dirt"
        farCase.minimumZoomLevel = 9; farCase.maximumZoomLevel = 13
        farCase.lineColor = NSExpression(forConstantValue: UIColor.white)
        farCase.lineOpacity = NSExpression(forConstantValue: 0.7)
        farCase.lineWidth = json(["interpolate", ["linear"], ["zoom"], 9, 2.2, 12.9, 4.4])
        Self.round(farCase)
        put(farCase)
        for track in [false, true] {
            let l = MLNLineStyleLayer(identifier: track ? "mt-far-track" : "mt-far-road", source: dirt)
            l.sourceLayerIdentifier = "dirt"
            l.maximumZoomLevel = 13
            l.predicate = NSPredicate(mglJSONObject: [track ? "==" : "!=", ["get", "c"], "t"])
            l.lineColor = farColour
            l.lineWidth = farWidth
            Self.round(l, cap: !track)
            if track { l.lineDashPattern = NSExpression(forConstantValue: [2, 1]) }
            put(l)
        }
        // OpenFreeMap's roads and tracks from zoom 13 (moto.js ROAD_FILTER: tracks, and unpaved roads of these classes).
        let ofm = MLNVectorTileSource(identifier: "mt-ofm", configurationURL: Self.ofm)
        style.addSource(ofm)
        let classes = ["track", "minor", "service", "tertiary", "secondary", "primary", "trunk"]
        let filter: [Any] = ["all", ["in", ["get", "class"], ["literal", classes]],
                             ["any", ["==", ["get", "class"], "track"], ["==", ["get", "surface"], "unpaved"]], ["!=", ["get", "brunnel"], "tunnel"]]
        let width = json(["interpolate", ["linear"], ["zoom"], 9, 1.2, 12, 2.6, 15, 4.5])
        let near = MLNLineStyleLayer(identifier: "mt-case", source: ofm)
        near.sourceLayerIdentifier = "transportation"
        near.minimumZoomLevel = 13
        near.predicate = NSPredicate(mglJSONObject: filter)
        near.lineColor = NSExpression(forConstantValue: UIColor.white)
        near.lineOpacity = NSExpression(forConstantValue: 0.85)
        near.lineWidth = json(["interpolate", ["linear"], ["zoom"], 9, 2.6, 12, 4.6, 15, 7])
        Self.round(near)
        put(near)
        for track in [false, true] {
            let l = MLNLineStyleLayer(identifier: track ? "mt-track" : "mt-road", source: ofm)
            l.sourceLayerIdentifier = "transportation"
            l.minimumZoomLevel = 13
            l.predicate = NSPredicate(mglJSONObject: ["all", filter, [track ? "==" : "!=", ["get", "class"], "track"]])
            l.lineColor = NSExpression(forConstantValue: Self.colour(track ? roads.track : roads.road))
            l.lineWidth = width
            Self.round(l, cap: !track)
            if track { l.lineDashPattern = NSExpression(forConstantValue: [2, 1]) }
            put(l)
        }
    }

    private static func round(_ l: MLNLineStyleLayer, cap: Bool = true) {
        if cap { l.lineCap = NSExpression(forConstantValue: "round") }
        l.lineJoin = NSExpression(forConstantValue: "round")
    }

    // The web 3D map's stop dot: 7 pt across the middle, a 2 pt white ring.
    private static func dot(_ hex: String) -> UIImage {
        let size = CGSize(width: 18, height: 18)
        return UIGraphicsImageRenderer(size: size).image { _ in
            UIColor.white.setFill()
            UIBezierPath(ovalIn: CGRect(origin: .zero, size: size)).fill()
            colour(hex).setFill()
            UIBezierPath(ovalIn: CGRect(x: 2, y: 2, width: 14, height: 14)).fill()
        }
    }
    private static func colour(_ s: String) -> UIColor {
        var h = s.trimmingCharacters(in: .whitespaces)
        if h.hasPrefix("#") { h.removeFirst() }
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return .gray }
        return UIColor(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    }
}

// "moto-safe" in this build's features (TrailMap.features): its NativeMoto draws without closing the app (the far
// roads' colours above). native-moto.js sends Moto's layer to an iPhone build only when it reports this; nothing to draw.
final class NativeMotoSafe: NativeLayer {
    let key = "moto-safe"
    func added(to style: MLNStyle, screen: TrailMapScreen) {}
    func setData(_ json: String, style: MLNStyle?) {}
}
