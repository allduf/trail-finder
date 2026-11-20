import Foundation
import MapLibre
import UIKit

// Hunting in native 3D (alex 2026-11-20, native 3D parity step 5): what the web 3D map adds for Hunting (hunting.js
// sync3d), drawn by the iPhone. The zone, park and closure outlines and the scent cone's edge already come with the
// trails (native-map.js copies every line on the flat map); this adds what isn't a line there:
//   - the parks, towns and closures as see-through fills, closed ones hatched red (Hunting's "Parks, towns and closures");
//   - the zone names (Hunting zones);
//   - the scent cone's orange fill (Scent cone);
//   - the range rings round the spot (Range rings) and the glassing view's 5 km circle;
//   - the glassing view (What can I see from here?): the ground hidden from the spot darkened, worked out on the page;
//   - the spot pin;
//   - the picture layers (land, property lines, forest, burns, cut blocks, wetlands, far from roads): raster tiles from
//     the same map servers as the flat map, the addresses worked out on the page (hunting.js nativePics).
// The page sends everything near the view as text under the key "hunt" (hunting.js window.tfNative.addLayer), only in
// Hunting and only what's switched on there, so other sports draw nothing from here.
// Slope angle and aspect, and the pictures the phone repaints (Alberta forest types, Quebec public land), are drawn only
// by the web 3D map: with any of them on, the 3D button opens that one (hunting.js tfHunt.web3d).
final class NativeHunting: NativeLayer {
    let key = "hunt"
    private static let orange = UIColor(red: 0xd9 / 255, green: 0x48 / 255, blue: 0x0f / 255, alpha: 1)   // ORANGE in hunting.js
    private static let zone = UIColor(red: 0x34 / 255, green: 0x3a / 255, blue: 0x40 / 255, alpha: 1)   // C.zone
    private static let shapes = ["fills", "labels", "cone", "rings", "spot"]

    private var parsed: [String: MLNShape] = [:]
    private var glass: (at: String, image: UIImage, quad: MLNCoordinateQuad)?
    private var glassShown: String?   // the glassing view on the current style (its "at"), so a move doesn't reload it
    private var round = 0
    // A picture layer: one raster source + layer per entry ("hn-pic:" + id); its address keyed so a change reloads it.
    private struct Pic: Equatable { let id: String, tiles: String, z: Int, to: Int?, opacity: Double, bounds: [Double], attr: String }
    private var pics: [Pic] = []
    private var picsShown: [String: Pic] = [:]   // on the current style, by id
    private weak var screen: TrailMapScreen?   // its style is the one showing now (a new base map brings a new one)

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        style.setImage(NativeHunting.hatch(), forName: "hn-hatch")
        for k in NativeHunting.shapes where style.source(withIdentifier: "hn-" + k) == nil {
            style.addSource(MLNShapeSource(identifier: "hn-" + k, shape: parsed[k], options: nil))
        }
        self.screen = screen
        let src = { (k: String) in style.source(withIdentifier: "hn-" + k) }
        guard let fills = src("fills"), let labels = src("labels"), let cone = src("cone"), let rings = src("rings"),
              let spot = src("spot"), style.layer(withIdentifier: "hn-fill") == nil else { return }
        glassShown = nil   // a new style has no glassing view or pictures yet
        picsShown = [:]
        let below = screen.trailsBottomLayer()
        let under = { (l: MLNStyleLayer) in if let b = below { style.insertLayer(l, below: b) } else { style.addLayer(l) } }

        // Under the trails, bottom to top: the glassing view (added when there is one), the fills, the cone, the rings.
        let fill = MLNFillStyleLayer(identifier: "hn-fill", source: fills)
        fill.predicate = NSPredicate(format: "h == 0")
        fill.fillColor = NSExpression(forKeyPath: "c")
        fill.fillOpacity = NSExpression(forKeyPath: "o")
        under(fill)
        let hatch = MLNFillStyleLayer(identifier: "hn-hatch", source: fills)
        hatch.predicate = NSPredicate(format: "h == 1")
        hatch.fillPattern = NSExpression(forConstantValue: "hn-hatch")
        under(hatch)
        let coneFill = MLNFillStyleLayer(identifier: "hn-cone", source: cone)
        coneFill.fillColor = NSExpression(forConstantValue: NativeHunting.orange)
        coneFill.fillOpacity = NSExpression(forConstantValue: 0.25)
        under(coneFill)
        // Rings: a white line under dark dashes (as on the page), the glassing circle orange dashes. Dashes in line widths.
        let ring = { (id: String, kind: String, colour: UIColor, width: Double, opacity: Double, dash: [Double]?) in
            let l = MLNLineStyleLayer(identifier: id, source: rings)
            l.predicate = NSPredicate(format: "k == %@", kind)
            l.lineColor = NSExpression(forConstantValue: colour)
            l.lineWidth = NSExpression(forConstantValue: width)
            l.lineOpacity = NSExpression(forConstantValue: opacity)
            if let d = dash { l.lineDashPattern = NSExpression(forConstantValue: d.map { NSNumber(value: $0) }) }
            under(l)
        }
        let dark = UIColor(red: 0x21 / 255, green: 0x25 / 255, blue: 0x29 / 255, alpha: 1)
        ring("hn-ring-w", "w", .white, 3.5, 0.55, nil)
        ring("hn-ring-d", "d", dark, 1.5, 0.8, [3.33, 3.33])
        ring("hn-ring-g", "g", NativeHunting.orange, 2, 0.9, [3, 3])

        // Over the trails: the zone names (a second line with the zone's own name from zoom 8, as on the page), the pin.
        let label = { (id: String, field: String, minZoom: Float, maxZoom: Float?) in
            let l = MLNSymbolStyleLayer(identifier: id, source: labels)
            l.text = NSExpression(forKeyPath: field)
            l.textFontNames = NSExpression(forConstantValue: ["Noto Sans Bold"])
            l.textFontSize = NSExpression(forConstantValue: 13)
            l.textAllowsOverlap = NSExpression(forConstantValue: false)
            l.textColor = NSExpression(forConstantValue: NativeHunting.zone)
            l.textHaloColor = NSExpression(forConstantValue: UIColor.white)
            l.textHaloWidth = NSExpression(forConstantValue: 2)
            l.minimumZoomLevel = minZoom
            if let m = maxZoom { l.maximumZoomLevel = m }
            style.addLayer(l)
        }
        label("hn-labels", "t", 5, 8)
        label("hn-labels-long", "tl", 8, nil)
        let outer = MLNCircleStyleLayer(identifier: "hn-spot", source: spot)
        outer.circleRadius = NSExpression(forConstantValue: 11.5)
        outer.circleColor = NSExpression(forConstantValue: UIColor.white)
        outer.circleOpacity = NSExpression(forConstantValue: 0.4)
        outer.circleStrokeColor = NSExpression(forConstantValue: NativeHunting.orange)
        outer.circleStrokeWidth = NSExpression(forConstantValue: 3)
        style.addLayer(outer)
        let inner = MLNCircleStyleLayer(identifier: "hn-spot-dot", source: spot)
        inner.circleRadius = NSExpression(forConstantValue: 4)
        inner.circleColor = NSExpression(forConstantValue: NativeHunting.orange)
        inner.circleStrokeColor = NSExpression(forConstantValue: UIColor.white)
        inner.circleStrokeWidth = NSExpression(forConstantValue: 1.5)
        style.addLayer(inner)
        showGlass(style)
        showPics(style)
    }

    // The page's text: { fills, labels, cone, rings, spot } as GeoJSON, glass: { at, box: [w, s, e, n], png (base64) } or
    // null. The page sends the picture only when it's new: without png, the same "at" keeps the one there.
    // Read off the main thread (a zone-dense view can be a few hundred KB), newest wins.
    func setData(_ json: String, style: MLNStyle?) {
        round += 1
        let mine = round, prior = glass
        DispatchQueue.global(qos: .userInitiated).async {
            guard let d = json.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
            var shapes: [String: MLNShape] = [:]
            for k in NativeHunting.shapes {
                if let fc = o[k], let data = try? JSONSerialization.data(withJSONObject: fc),
                   let s = try? MLNShape(data: data, encoding: String.Encoding.utf8.rawValue) { shapes[k] = s }
            }
            let g = o["glass"] as? [String: Any], at = (g?["at"] as? String) ?? ""
            var img: UIImage?
            if let b64 = g?["png"] as? String, let bytes = Data(base64Encoded: b64) { img = UIImage(data: bytes) }
            var glass: (at: String, image: UIImage, quad: MLNCoordinateQuad)?
            if let box = g?["box"] as? [Double], box.count == 4, let image = img ?? (prior?.at == at ? prior?.image : nil) {
                let (w, s, e, n) = (box[0], box[1], box[2], box[3])
                glass = (at, image, MLNCoordinateQuad(topLeft: CLLocationCoordinate2D(latitude: n, longitude: w),
                                                 bottomLeft: CLLocationCoordinate2D(latitude: s, longitude: w),
                                                 bottomRight: CLLocationCoordinate2D(latitude: s, longitude: e),
                                                 topRight: CLLocationCoordinate2D(latitude: n, longitude: e)))
            }
            let pics: [Pic] = ((o["pics"] as? [[String: Any]]) ?? []).compactMap { p in
                guard let id = p["id"] as? String, let tiles = p["tiles"] as? String, let z = (p["z"] as? NSNumber)?.intValue else { return nil }
                return Pic(id: id, tiles: tiles, z: z, to: (p["to"] as? NSNumber)?.intValue, opacity: (p["opacity"] as? NSNumber)?.doubleValue ?? 1,
                           bounds: (p["bounds"] as? [Double]) ?? [], attr: (p["attr"] as? String) ?? "")
            }
            DispatchQueue.main.async {
                guard mine == self.round else { return }
                self.parsed = shapes
                self.glass = glass
                self.pics = pics
                // Only a style this feature has set up (added(to:) runs again for a new one, with what's here now).
                guard let style = self.screen?.mapLibreView.style ?? style, style.layer(withIdentifier: "hn-fill") != nil else { return }
                for k in NativeHunting.shapes { (style.source(withIdentifier: "hn-" + k) as? MLNShapeSource)?.shape = shapes[k] }
                self.showGlass(style)
                self.showPics(style)
            }
        }
    }

    // The picture layers: taken away when gone or changed, added under everything else of Hunting's (and the trails).
    // Tile zoom = the page's Leaflet zoom (256 px tiles); the native map's zoom is one less. An entry made for one zoom
    // (its address changes with the zoom) shows only there; the last one also deeper, stretched.
    private func showPics(_ style: MLNStyle) {
        let want = Dictionary(pics.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for (id, p) in picsShown where want[id] != p {
            if let l = style.layer(withIdentifier: "hn-pic:" + id) { style.removeLayer(l) }
            if let s = style.source(withIdentifier: "hn-pic:" + id) { style.removeSource(s) }
            picsShown[id] = nil
        }
        // In the page's order, bottom to top (as the flat map's): each goes under the next one already there.
        for (i, p) in pics.enumerated() where picsShown[p.id] == nil {
            if let l = style.layer(withIdentifier: "hn-pic:" + p.id) { style.removeLayer(l) }   // never two of one id
            if let s = style.source(withIdentifier: "hn-pic:" + p.id) { style.removeSource(s) }
            var opts: [MLNTileSourceOption: Any] = [.tileSize: 256, .minimumZoomLevel: p.z, .maximumZoomLevel: p.to ?? 19]
            if p.bounds.count == 4 {
                opts[.coordinateBounds] = NSValue(mlnCoordinateBounds: MLNCoordinateBounds(
                    sw: CLLocationCoordinate2D(latitude: p.bounds[1], longitude: p.bounds[0]),
                    ne: CLLocationCoordinate2D(latitude: p.bounds[3], longitude: p.bounds[2])))
            }
            if !p.attr.isEmpty { opts[.attributionHTMLString] = p.attr }
            let src = MLNRasterTileSource(identifier: "hn-pic:" + p.id, tileURLTemplates: [p.tiles], options: opts)
            style.addSource(src)
            let l = MLNRasterStyleLayer(identifier: "hn-pic:" + p.id, source: src)
            l.rasterOpacity = NSExpression(forConstantValue: p.opacity)
            l.rasterFadeDuration = NSExpression(forConstantValue: 0)
            l.minimumZoomLevel = Float(p.z - 1)
            if let to = p.to { l.maximumZoomLevel = Float(to) }
            let above = pics[(i + 1)...].lazy.compactMap { self.picsShown[$0.id] != nil ? style.layer(withIdentifier: "hn-pic:" + $0.id) : nil }.first
            if let next = above ?? ["hn-glass", "hn-fill"].lazy.compactMap({ style.layer(withIdentifier: $0) }).first { style.insertLayer(l, below: next) }
            else if let b = screen?.trailsBottomLayer() { style.insertLayer(l, below: b) } else { style.addLayer(l) }
            picsShown[p.id] = p
        }
    }

    // The glassing view: an image on the ground under the fills, put in, moved or taken away.
    private func showGlass(_ style: MLNStyle) {
        let src = style.source(withIdentifier: "hn-glass") as? MLNImageSource
        guard let g = glass else {
            if let l = style.layer(withIdentifier: "hn-glass") { style.removeLayer(l) }
            if let s = src { style.removeSource(s) }
            glassShown = nil
            return
        }
        if let s = src {
            if glassShown != g.at {
                s.image = g.image
                s.coordinates = g.quad
                glassShown = g.at
            }
            return
        }
        glassShown = g.at
        let s = MLNImageSource(identifier: "hn-glass", coordinateQuad: g.quad, image: g.image)
        style.addSource(s)
        let l = MLNRasterStyleLayer(identifier: "hn-glass", source: s)
        l.rasterFadeDuration = NSExpression(forConstantValue: 0)
        if let fill = style.layer(withIdentifier: "hn-fill") { style.insertLayer(l, below: fill) } else { style.addLayer(l) }
    }

    // Closed areas' red stripes, as hunting.js makeHatch(16, 3.5) (bolder on the 3D photos).
    private static func hatch() -> UIImage {
        let n: CGFloat = 16
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: n, height: n), format: format).image { ctx in
            let c = ctx.cgContext
            c.setStrokeColor(UIColor(red: 0xe0 / 255, green: 0x31 / 255, blue: 0x31 / 255, alpha: 1).cgColor)
            c.setLineWidth(3.5)
            c.move(to: CGPoint(x: -1, y: n + 1)); c.addLine(to: CGPoint(x: n + 1, y: -1))
            c.move(to: CGPoint(x: -1, y: 1)); c.addLine(to: CGPoint(x: 1, y: -1))
            c.move(to: CGPoint(x: n - 1, y: n + 1)); c.addLine(to: CGPoint(x: n + 1, y: n - 1))
            c.strokePath()
        }
    }
}
