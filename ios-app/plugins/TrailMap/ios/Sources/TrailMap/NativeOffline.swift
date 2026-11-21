import Foundation
import MapLibre
import UIKit

// Offline maps in native 3D (alex 2026-11-20: every web feature in native 3D, and "i want everything to work smoothly
// when im not connected"). Works like the web 3D map with no signal (offline.js, map3d.js offGround):
//   - the photos that can't come (Satellite, Topo, Map; Esri's far photo under Winter) are hidden, and the ground is the
//     saved map instead: woods, open ground, rock, ice and water from OpenFreeMap with the hills shaded, under the
//     trails; Skiing's Winter photos saved with an area stay on top of it;
//   - each saved area shows as a green dashed square with "✓ Saved: name" (the page sends the areas and the words);
//   - a small "No signal: the saved map" label says why the map looks different.
// Online none of this is on the map (nothing added, nothing slower).
// The web page keeps its saved files where only the page can read them, so the iPhone keeps its own copy of each area
// saved with "3D map too" (OfflinePacks below): the same files the web saves for 3D (OpenFreeMap map z0-14, Mapterhorn
// heights to z12, Skiing's Winter photos z6-14 plus one tile around at z6-10), in MapLibre's own offline packs. It
// starts once the web save is done (TrailMap.offline from native-offline.js) and only on alex's devices for now
// (tf-admin, like native 3D itself). Deleting the area on the page deletes the copy.
final class NativeOffline: NativeLayer {
    let key = "offline"
    private var online = true
    private var areas: [(box: [Double], label: String)] = []
    private var noSignal = "No signal: the saved map"
    private weak var screen: TrailMapScreen?
    private weak var style: MLNStyle?
    private let tag = UILabel()
    static let green = UIColor(red: 0x14 / 255.0, green: 0x80 / 255.0, blue: 0x4a / 255.0, alpha: 1)

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        self.screen = screen
        self.style = style
        apply(style)
        // Right after the app starts, MapLibre may still be reading its list of saved packs: draw again once it's in.
        if !online && MLNOfflineStorage.shared.packs == nil {
            OfflinePacks.shared.withPacks { [weak self, weak style] _ in
                // Only the style still showing (a new base map may have come meanwhile; it draws this again itself).
                if let s = style, s === self?.screen?.readyStyle { self?.apply(s) }
            }
        }
    }

    func setData(_ json: String, style: MLNStyle?) {
        guard let d = json.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
        online = (o["online"] as? Bool) ?? true
        if let s = o["noSignal"] as? String, !s.isEmpty { noSignal = s }
        areas = ((o["areas"] as? [[String: Any]]) ?? []).compactMap { a in
            let b = ((a["box"] as? [Any]) ?? []).compactMap(num)
            return b.count == 4 ? (b, (a["label"] as? String) ?? "") : nil
        }
        // Only the style showing now, once loaded: while a new base map loads, its added(to:) draws this when it's in.
        if let s = style ?? self.style, s === screen?.readyStyle { apply(s) }
    }

    private func apply(_ style: MLNStyle) {
        let off = !online
        for l in style.layers where l.identifier.hasPrefix("tf-off-") { style.removeLayer(l) }
        for s in style.sources where s.identifier.hasPrefix("tf-off-") { style.removeSource(s) }
        // Hidden, the photos aren't asked for at all (no retries with no signal). Winter's own photos stay.
        for id in ["base", "esri", "sat", "sumhi", "topo", "osm"] { style.layer(withIdentifier: id)?.isVisible = !off }
        showTag(off)
        guard off else { return }

        // The saved ground: under Winter's photos when they're there, else right under the trails.
        // From this same style: a layer from another one can't be inserted below (MapLibre stops the app).
        let under = style.layer(withIdentifier: "wide") ?? style.layer(withIdentifier: "tf-line")
        let put = { (l: MLNStyleLayer) in if let u = under { style.insertLayer(l, below: u) } else { style.addLayer(l) } }
        let bg = MLNBackgroundStyleLayer(identifier: "tf-off-bg")
        bg.backgroundColor = NSExpression(forConstantValue: UIColor(red: 0xdf / 255.0, green: 0xe5 / 255.0, blue: 0xd2 / 255.0, alpha: 1))
        put(bg)
        // One map source per OpenFreeMap edition the copies were saved from (its tile addresses change each week).
        for (i, t) in OfflinePacks.shared.savedTemplates().enumerated() {
            let src = MLNVectorTileSource(identifier: "tf-off-ofm-\(i)", tileURLTemplates: [t],
                                          options: [.minimumZoomLevel: 0, .maximumZoomLevel: 14])
            style.addSource(src)
            let land = MLNFillStyleLayer(identifier: "tf-off-land-\(i)", source: src)
            land.sourceLayerIdentifier = "landcover"
            land.fillColor = NSExpression(mglJSONObject: ["match", ["get", "class"], "wood", "#a7c496", "grass", "#d4e3b5", "rock", "#d3cfc6",
                                                          "ice", "#f3f7fa", "sand", "#ece2c3", "wetland", "#c2dacb", "farmland", "#e3e6c3", "#d6e0c4"])
            put(land)
            let water = MLNFillStyleLayer(identifier: "tf-off-water-\(i)", source: src)
            water.sourceLayerIdentifier = "water"
            water.fillColor = NSExpression(forConstantValue: UIColor(red: 0x98 / 255.0, green: 0xc0 / 255.0, blue: 0xe4 / 255.0, alpha: 1))
            put(water)
        }
        // The hills shaded, from the same saved heights as the 3D ground (same addresses: nothing more to save).
        let dem = MLNRasterDEMSource(identifier: "tf-off-dem", tileURLTemplates: [OfflinePacks.demTiles],
                                     options: [.tileSize: 512, .maximumZoomLevel: 12, .demEncoding: NSNumber(value: MLNDEMEncoding.terrarium.rawValue)])
        style.addSource(dem)
        let shade = MLNHillshadeStyleLayer(identifier: "tf-off-shade", source: dem)
        shade.hillshadeExaggeration = NSExpression(forConstantValue: 0.35)
        shade.hillshadeShadowColor = NSExpression(forConstantValue: UIColor(red: 0x3a / 255.0, green: 0x4a / 255.0, blue: 0x66 / 255.0, alpha: 1))
        shade.hillshadeHighlightColor = NSExpression(forConstantValue: UIColor.white)
        shade.hillshadeAccentColor = NSExpression(forConstantValue: UIColor(red: 0x5a / 255.0, green: 0x6a / 255.0, blue: 0x80 / 255.0, alpha: 1))
        put(shade)

        // The saved areas' edges, on top (as on the web map).
        guard !areas.isEmpty else { return }
        var feats: [MLNShape] = []
        for (i, a) in areas.enumerated() {
            let (s, w, n, e) = (a.box[0], a.box[1], a.box[2], a.box[3])
            var ring = [CLLocationCoordinate2D(latitude: s, longitude: w), CLLocationCoordinate2D(latitude: s, longitude: e),
                        CLLocationCoordinate2D(latitude: n, longitude: e), CLLocationCoordinate2D(latitude: n, longitude: w),
                        CLLocationCoordinate2D(latitude: s, longitude: w)]
            feats.append(MLNPolylineFeature(coordinates: &ring, count: UInt(ring.count)))
            guard !a.label.isEmpty, let img = NativeOffline.labelImage(a.label) else { continue }
            let name = "tf-off-name-\(i)"
            style.setImage(img, forName: name)
            let p = MLNPointFeature()
            p.coordinate = CLLocationCoordinate2D(latitude: n, longitude: (w + e) / 2)
            p.attributes = ["img": name]
            feats.append(p)
        }
        let src = MLNShapeSource(identifier: "tf-off-areas", shapes: feats, options: nil)
        style.addSource(src)
        let lineOnly = NSPredicate(format: "$geometryType == 'LineString'")
        let caseL = MLNLineStyleLayer(identifier: "tf-off-area-case", source: src)
        caseL.predicate = lineOnly
        caseL.lineColor = NSExpression(forConstantValue: UIColor.white)
        caseL.lineWidth = NSExpression(forConstantValue: 6)
        caseL.lineOpacity = NSExpression(forConstantValue: 0.85)
        style.addLayer(caseL)
        let line = MLNLineStyleLayer(identifier: "tf-off-area", source: src)
        line.predicate = lineOnly
        line.lineColor = NSExpression(forConstantValue: NativeOffline.green)
        line.lineWidth = NSExpression(forConstantValue: 3)
        line.lineDashPattern = NSExpression(forConstantValue: [2, 1.5])
        style.addLayer(line)
        let names = MLNSymbolStyleLayer(identifier: "tf-off-name", source: src)
        names.predicate = NSPredicate(format: "$geometryType == 'Point'")
        names.iconImageName = NSExpression(forKeyPath: "img")
        names.iconAnchor = NSExpression(forConstantValue: "bottom")
        names.iconAllowsOverlap = NSExpression(forConstantValue: true)
        style.addLayer(names)
    }

    // The name as a picture (green, white halo), so it needs no font files, which can't come with no signal.
    private static func labelImage(_ text: String) -> UIImage? {
        let font = UIFont.systemFont(ofSize: 13, weight: .bold)
        let ink: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: green]
        let halo: [NSAttributedString.Key: Any] = [.font: font, .strokeColor: UIColor.white, .strokeWidth: 6]
        let size = (text as NSString).size(withAttributes: ink)
        let pad: CGFloat = 4
        let full = CGSize(width: ceil(size.width) + pad * 2, height: ceil(size.height) + pad * 2)
        guard full.width > pad * 2 else { return nil }
        return UIGraphicsImageRenderer(size: full).image { _ in
            let at = CGPoint(x: pad, y: pad)
            (text as NSString).draw(at: at, withAttributes: halo)
            (text as NSString).draw(at: at, withAttributes: ink)
        }
    }

    private func showTag(_ on: Bool) {
        guard let sc = screen, let v = sc.view else { return }
        if tag.superview == nil {
            tag.font = .systemFont(ofSize: 12, weight: .semibold)
            tag.textColor = .white
            tag.backgroundColor = UIColor(red: 0.08, green: 0.12, blue: 0.10, alpha: 0.85)
            tag.layer.cornerRadius = 6
            tag.clipsToBounds = true
            tag.textAlignment = .center
            tag.translatesAutoresizingMaskIntoConstraints = false
            v.addSubview(tag)
            let g = sc.mapArea   // inside the map: clear of a tool's bar from the page (NativeTools.swift)
            NSLayoutConstraint.activate([
                tag.centerXAnchor.constraint(equalTo: g.centerXAnchor),
                tag.topAnchor.constraint(equalTo: g.topAnchor, constant: 44),
                tag.heightAnchor.constraint(equalToConstant: 22)
            ])
        }
        tag.text = "  " + noSignal + "  "
        tag.isHidden = !on
    }
}

// JSON numbers arrive as NSNumber.
private func num(_ v: Any) -> Double? { (v as? NSNumber)?.doubleValue }

// The iPhone's own copy of each saved area, as MapLibre offline packs (see the top). Each pack's context says which
// area and part it is: { tf: "offline", id, part: "main" or "r6"..."r10", box, ski, tmpl }. The page sends the whole
// list each time (TrailMap.offline), and this makes the packs match it: new areas are added, finished ones left alone,
// unfinished ones carry on, deleted ones removed.
final class OfflinePacks: NSObject {
    static let shared = OfflinePacks()
    static let demTiles = "https://tiles.mapterhorn.com/{z}/{x}/{y}.webp"   // TrailMapScreen.demTiles
    private static let tileJSON = URL(string: "https://tiles.openfreemap.org/planet")!
    // A pack's style is made here, not downloaded: it's put in MapLibre's store under this made-up address first.
    private static let styleBase = "https://offline.trailfinder.invalid/"
    var onChange: (([String: Any]) -> Void)?
    private var packsObs: NSKeyValueObservation?
    private var waiting: [([MLNOfflinePack]) -> Void] = []
    private var creating: Set<String> = []
    private var wanted: Set<String> = []       // the areas the page last asked for
    private var observing = false
    private var notifyQueued = false
    private var firstLook: Set<ObjectIdentifier> = []   // copies asked for their state (unknown until MapLibre reports)

    // sharp: saved at full detail on the page (dz 15): the sharpened Winter photos come too.
    struct Area { let id: String; let boxes: [[Double]]; let ski: Bool; let sharp: Bool }

    func withPacks(_ fn: @escaping ([MLNOfflinePack]) -> Void) {
        let st = MLNOfflineStorage.shared
        if let p = st.packs { fn(p); return }
        waiting.append(fn)
        if packsObs != nil { return }
        packsObs = st.observe(\.packs, options: [.initial, .new]) { [weak self] st, _ in
            DispatchQueue.main.async {
                guard let self = self, let p = st.packs, !self.waiting.isEmpty else { return }
                self.packsObs = nil
                let w = self.waiting
                self.waiting = []
                w.forEach { $0(p) }
            }
        }
    }

    private static func ctx(_ p: MLNOfflinePack) -> [String: Any]? {
        guard p.state != .invalid, let o = (try? JSONSerialization.jsonObject(with: p.context)) as? [String: Any],
              o["tf"] as? String == "offline" else { return nil }
        return o
    }
    private var ours: [(pack: MLNOfflinePack, ctx: [String: Any])] {
        (MLNOfflineStorage.shared.packs ?? []).compactMap { p in OfflinePacks.ctx(p).map { (p, $0) } }
    }

    // The OpenFreeMap tile addresses the saved copies use (for the no-signal ground).
    func savedTemplates() -> [String] {
        var seen: [String] = []
        for (_, c) in ours { if let t = c["tmpl"] as? String, !t.isEmpty, !seen.contains(t) { seen.append(t) } }
        return seen
    }

    func sync(_ list: [[String: Any]], done: @escaping ([String: Any]) -> Void) {
        startObserving()
        let want: [Area] = list.compactMap { a in
            guard let id = a["id"] as? String, !id.isEmpty else { return nil }
            var boxes = OfflinePacks.boxes(a["boxes"])
            if boxes.isEmpty { let b = ((a["box"] as? [Any]) ?? []).compactMap(num); if b.count == 4 { boxes = [b] } }
            return boxes.isEmpty ? nil : Area(id: id, boxes: boxes, ski: (a["ski"] as? Bool) ?? false, sharp: (a["sharp"] as? Bool) ?? false)
        }
        withPacks { [weak self] _ in
            guard let self = self else { return }
            let byId = Dictionary(want.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
            self.wanted = Set(byId.keys)
            var have: [String: Set<String>] = [:]
            for (p, c) in self.ours {
                let id = (c["id"] as? String) ?? "", a = byId[id]
                let same = a != nil && OfflinePacks.sameBoxes(OfflinePacks.boxes(c["boxes"]), a!.boxes) && ((c["ski"] as? Bool) ?? false) == a!.ski && ((c["sharp"] as? Bool) ?? false) == a!.sharp
                if !same { self.firstLook.remove(ObjectIdentifier(p)); MLNOfflineStorage.shared.removePack(p, withCompletionHandler: nil); continue }
                let part = (c["part"] as? String) ?? ""
                have[id, default: []].insert(part)
                p.requestProgress()
                // Unfinished copies carry on. One MapLibre hasn't reported on yet (every copy, just after the app starts)
                // waits for that report (changed below): resuming a finished copy walks all of it again, its line
                // reading "saving 0%" on an area already saved, after each start.
                if p.state == .unknown {
                    self.firstLook.insert(ObjectIdentifier(p))
                    // No report within 10 s (MapLibre couldn't read the copy's state): it carries on all the same.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self, weak p] in
                        guard let self = self, let p = p, p.state == .unknown, self.firstLook.remove(ObjectIdentifier(p)) != nil,
                              let c = OfflinePacks.ctx(p), self.wanted.contains((c["id"] as? String) ?? "") else { return }
                        self.resume(p, c)
                    }
                } else if p.state == .inactive { self.resume(p, c) }
            }
            for a in want {
                let parts = ["main"] + (a.ski ? (6...10).map { "r\($0)" } : [])
                let missing = parts.filter { !(have[a.id] ?? []).contains($0) && !self.creating.contains(a.id + "/" + $0) }
                if !missing.isEmpty { self.create(a, missing) }
            }
            done(self.status())
        }
    }

    static func boxes(_ v: Any?) -> [[Double]] {
        ((v as? [Any]) ?? []).map { (($0 as? [Any]) ?? []).compactMap(num) }.filter { $0.count == 4 }
    }
    static func sameBoxes(_ a: [[Double]], _ b: [[Double]]) -> Bool {
        a.count == b.count && zip(a, b).allSatisfy { x, y in zip(x, y).allSatisfy { abs($0 - $1) < 1e-6 } }
    }

    private func resume(_ p: MLNOfflinePack, _ c: [String: Any]) {
        guard let style = OfflinePacks.style(c) else { return }
        let go = {
            // Deleted meanwhile (Winter's lists take a moment to load): any message to a deleted copy stops the app.
            guard p.state != .invalid else { return }
            self.putStyle(style, p.region.styleURL) { ok in if ok && p.state != .invalid { p.resume() } }
        }
        // Winter photo addresses need WinterTiles as MapLibre's URL rewriter (set by its load), fresh from their sites.
        if (c["ski"] as? Bool) ?? false { WinterTiles.shared.load { ok in if ok && WinterTiles.shared.fresh { go() } } } else { go() }
    }

    private func create(_ a: Area, _ parts: [String]) {
        parts.forEach { creating.insert(a.id + "/" + $0) }
        let finish = { [weak self] in parts.forEach { self?.creating.remove(a.id + "/" + $0) } }
        template { [weak self] tmpl in
            guard let self = self, let tmpl = tmpl else { finish(); return }   // no signal: the next sync tries again
            let go = {
                for part in parts {
                    let key = a.id + "/" + part
                    let c: [String: Any] = ["tf": "offline", "id": a.id, "part": part, "boxes": a.boxes, "ski": a.ski, "sharp": a.sharp, "tmpl": tmpl]
                    guard let style = OfflinePacks.style(c), let region = OfflinePacks.region(a, part, styleBase: OfflinePacks.styleBase),
                          let ctxData = try? JSONSerialization.data(withJSONObject: c) else { self.creating.remove(key); continue }
                    self.putStyle(style, region.styleURL) { ok in
                        guard ok else { self.creating.remove(key); return }
                        MLNOfflineStorage.shared.addPack(for: region, withContext: ctxData) { pack, _ in
                            self.creating.remove(key)
                            guard let pack = pack else { return }
                            // Deleted on the page while this was being set up: no copy for it.
                            if !self.wanted.contains(a.id) { MLNOfflineStorage.shared.removePack(pack, withCompletionHandler: nil); return }
                            pack.resume()
                        }
                    }
                }
            }
            if !a.ski { go(); return }
            // Winter photo addresses need WinterTiles' lists (it turns the made-up ones into real ones while saving),
            // fresh from their sites (not the copy kept for no signal, which may lack newer squares).
            WinterTiles.shared.load { ok in if ok && WinterTiles.shared.fresh { go() } else { finish() } }
        }
    }

    // The pack's own style, put in MapLibre's store just before it's needed (the store may let an old copy go).
    private func putStyle(_ style: [String: Any], _ url: URL, then: @escaping (Bool) -> Void) {
        guard let data = try? JSONSerialization.data(withJSONObject: style) else { then(false); return }
        MLNOfflineStorage.shared.preload(data, for: url, modifiedOn: Date(), expiresOn: Date.distantFuture, eTag: nil, mustRevalidate: false)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { then(true) }
    }

    // The newest OpenFreeMap tile address (from its TileJSON), or nil with no signal.
    private func template(_ done: @escaping (String?) -> Void) {
        URLSession.shared.dataTask(with: OfflinePacks.tileJSON) { data, resp, _ in
            var t: String?
            if let data = data, (resp as? HTTPURLResponse)?.statusCode == 200,
               let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] { t = (o["tiles"] as? [String])?.first }
            DispatchQueue.main.async { done(t) }
        }.resume()
    }

    // What one part saves. main: the map, the heights and (Skiing) the Winter photos over the area; rN: Skiing's
    // Winter photos at zoom N one tile wider all around (the blurry photo just past the square, as on the web).
    private static func style(_ c: [String: Any]) -> [String: Any]? {
        let part = (c["part"] as? String) ?? "", ski = (c["ski"] as? Bool) ?? false
        let winter: [String: Any] = ["type": "raster", "tileSize": 256, "minzoom": 6, "maxzoom": 14, "tiles": ["https://\(WinterTiles.host)/w/{z}/{x}/{y}"]]
        var sources: [String: Any] = [:]
        if part == "main" {
            guard let t = c["tmpl"] as? String else { return nil }
            sources["ofm"] = ["type": "vector", "tiles": [t], "minzoom": 0, "maxzoom": 14]
            // Heights to zoom 12, as native 3D asks for them with signal too (NativeBaseStyles.swift "dem"): the copy matches
            // what the screen shows. Deeper heights here wait for native 3D itself to go deeper.
            sources["dem"] = ["type": "raster-dem", "encoding": "terrarium", "tileSize": 512, "maxzoom": 12, "tiles": [demTiles]]
            if ski {
                sources["winter"] = winter
            }
            if ski && ((c["sharp"] as? Bool) ?? false) {
                // Saved at full detail on the page (dz 15): the sharpened Winter photos too (zooms 11-15, ~5 KB each), as native 3D shows them online (WinterTiles
                // "sharp"): close up the saved ground looks as it does with signal (alex 2026-11-21: "same quality off line").
                sources["sharp"] = ["type": "raster", "tileSize": 256, "minzoom": 11, "maxzoom": 15, "tiles": ["https://\(WinterTiles.host)/s/{z}/{x}/{y}"]]
            }
        } else if ski { sources["winter"] = winter } else { return nil }
        var layers: [[String: Any]] = [["id": "bg", "type": "background"]]
        if sources["ofm"] != nil { layers.append(["id": "water", "type": "fill", "source": "ofm", "source-layer": "water"]) }
        if sources["dem"] != nil { layers.append(["id": "shade", "type": "hillshade", "source": "dem"]) }
        if sources["winter"] != nil { layers.append(["id": "winter", "type": "raster", "source": "winter"]) }
        if sources["sharp"] != nil { layers.append(["id": "sharp", "type": "raster", "source": "sharp"]) }
        return ["version": 8, "sources": sources, "layers": layers]
    }

    // MapLibre zooms count 512 px tiles: the 256 px Winter photos at photo zoom N are map zoom N - 1.
    private static func region(_ a: Area, _ part: String, styleBase: String) -> MLNOfflineRegion? {
        guard let url = URL(string: "\(styleBase)\(a.id)-\(part).json") else { return nil }
        if part == "main" {
            let polys = a.boxes.map { b -> MLNPolygon in
                var r = [CLLocationCoordinate2D(latitude: b[0], longitude: b[1]), CLLocationCoordinate2D(latitude: b[0], longitude: b[3]),
                         CLLocationCoordinate2D(latitude: b[2], longitude: b[3]), CLLocationCoordinate2D(latitude: b[2], longitude: b[1]),
                         CLLocationCoordinate2D(latitude: b[0], longitude: b[1])]
                return MLNPolygon(coordinates: &r, count: UInt(r.count))
            }
            return MLNShapeOfflineRegion(styleURL: url, shape: MLNMultiPolygon(polygons: polys), fromZoomLevel: 0, toZoomLevel: 14)
        }
        guard let z = Int(part.dropFirst()), (6...10).contains(z) else { return nil }
        let s = a.boxes.map { $0[0] }.min()!, w = a.boxes.map { $0[1] }.min()!, n = a.boxes.map { $0[2] }.max()!, e = a.boxes.map { $0[3] }.max()!
        let zz = Double(1 << z)
        let tx = { (lon: Double) in floor((lon + 180) / 360 * zz) }
        let ty = { (lat: Double) -> Double in let r = lat * .pi / 180; return floor((1 - log(tan(r) + 1 / cos(r)) / .pi) / 2 * zz) }
        let lon = { (x: Double) in x / zz * 360 - 180 }
        let lat = { (y: Double) in atan(sinh(.pi * (1 - 2 * y / zz))) * 180 / .pi }
        // One tile more on every side, a hair inside its edges so the next tile out isn't counted.
        let x0 = tx(w) - 1, x1 = tx(e) + 1, y0 = ty(n) - 1, y1 = ty(s) + 1, eps = 1e-6
        let bounds = MLNCoordinateBounds(sw: CLLocationCoordinate2D(latitude: lat(y1 + 1) + eps, longitude: lon(x0) + eps),
                                         ne: CLLocationCoordinate2D(latitude: lat(y0) - eps, longitude: lon(x1 + 1) - eps))
        return MLNTilePyramidOfflineRegion(styleURL: url, bounds: bounds, fromZoomLevel: Double(z - 1), toZoomLevel: Double(z - 1))
    }

    // Per area: { id: { pct, saved, active, bytes } }.
    func status() -> [String: Any] {
        var by: [String: (exp: UInt64, done: UInt64, bytes: UInt64, all: Bool, active: Bool)] = [:]
        var unknown: Set<String> = []   // a pack MapLibre hasn't reported on yet (just after the app starts)
        for (p, c) in ours {
            let id = (c["id"] as? String) ?? ""
            if p.state == .unknown { unknown.insert(id) }
            var s = by[id] ?? (0, 0, 0, true, false)
            let g = p.progress
            s.exp += max(g.countOfResourcesExpected, g.countOfResourcesCompleted)
            s.done += g.countOfResourcesCompleted
            s.bytes += g.countOfBytesCompleted
            s.all = s.all && p.state == .complete
            s.active = s.active || p.state == .active
            by[id] = s
        }
        var out: [String: Any] = [:]
        for (id, s) in by where !unknown.contains(id) {
            out[id] = ["pct": s.exp > 0 ? Int(100 * s.done / s.exp) : 0, "saved": s.all, "active": s.active, "bytes": Double(s.bytes)]
        }
        return ["areas": out]
    }

    private func startObserving() {
        if observing { return }
        observing = true
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(changed(_:)), name: NSNotification.Name.MLNOfflinePackProgressChanged, object: nil)
        nc.addObserver(self, selector: #selector(changed(_:)), name: NSNotification.Name.MLNOfflinePackError, object: nil)
    }
    // At most once a second to the page.
    @objc private func changed(_ n: Notification) {
        DispatchQueue.main.async {
            // A copy's first report since sync asked: it carries on if unfinished and still wanted.
            if let p = n.object as? MLNOfflinePack, p.state != .unknown, self.firstLook.remove(ObjectIdentifier(p)) != nil, p.state == .inactive,
               let c = OfflinePacks.ctx(p), self.wanted.contains((c["id"] as? String) ?? "") { self.resume(p, c) }
            if self.notifyQueued { return }
            self.notifyQueued = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                self.notifyQueued = false
                self.onChange?(self.status())
            }
        }
    }
}
