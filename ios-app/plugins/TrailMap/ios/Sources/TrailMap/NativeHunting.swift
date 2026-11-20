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
//   - the spot pin.
// The page sends everything near the view as text under the key "hunt" (hunting.js window.tfNative.addLayer), only in
// Hunting and only what's switched on there, so other sports draw nothing from here. Hunting's picture layers (land,
// forest, burns, cut blocks, wetlands, far from roads, property lines) and slope angle and aspect are drawn only by
// the web 3D map: with any of them on, the 3D button opens that one (native-map.js webOnly).
final class NativeHunting: NativeLayer {
    let key = "hunt"
    private static let orange = UIColor(red: 0xd9 / 255, green: 0x48 / 255, blue: 0x0f / 255, alpha: 1)   // ORANGE in hunting.js
    private static let zone = UIColor(red: 0x34 / 255, green: 0x3a / 255, blue: 0x40 / 255, alpha: 1)   // C.zone
    private static let shapes = ["fills", "labels", "cone", "rings", "spot"]

    private var parsed: [String: MLNShape] = [:]
    private var glass: (image: UIImage, quad: MLNCoordinateQuad)?
    private var round = 0
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
    }

    // The page's text: { fills, labels, cone, rings, spot } as GeoJSON, glass: { png (base64), box: [w, s, e, n] } or null.
    // Read off the main thread (a zone-dense view can be a few hundred KB), newest wins.
    func setData(_ json: String, style: MLNStyle?) {
        round += 1
        let mine = round
        DispatchQueue.global(qos: .userInitiated).async {
            guard let d = json.data(using: .utf8), let o = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
            var shapes: [String: MLNShape] = [:]
            for k in NativeHunting.shapes {
                if let fc = o[k], let data = try? JSONSerialization.data(withJSONObject: fc),
                   let s = try? MLNShape(data: data, encoding: String.Encoding.utf8.rawValue) { shapes[k] = s }
            }
            var glass: (image: UIImage, quad: MLNCoordinateQuad)?
            if let g = o["glass"] as? [String: Any], let b64 = g["png"] as? String, let box = g["box"] as? [Double], box.count == 4,
               let bytes = Data(base64Encoded: b64), let img = UIImage(data: bytes) {
                let (w, s, e, n) = (box[0], box[1], box[2], box[3])
                glass = (img, MLNCoordinateQuad(topLeft: CLLocationCoordinate2D(latitude: n, longitude: w),
                                                 bottomLeft: CLLocationCoordinate2D(latitude: s, longitude: w),
                                                 bottomRight: CLLocationCoordinate2D(latitude: s, longitude: e),
                                                 topRight: CLLocationCoordinate2D(latitude: n, longitude: e)))
            }
            DispatchQueue.main.async {
                guard mine == self.round else { return }
                self.parsed = shapes
                self.glass = glass
                guard let style = self.screen?.mapLibreView.style ?? style else { return }
                for k in NativeHunting.shapes { (style.source(withIdentifier: "hn-" + k) as? MLNShapeSource)?.shape = shapes[k] }
                self.showGlass(style)
            }
        }
    }

    // The glassing view: an image on the ground under the fills, put in, moved or taken away.
    private func showGlass(_ style: MLNStyle) {
        let src = style.source(withIdentifier: "hn-glass") as? MLNImageSource
        guard let g = glass else {
            if let l = style.layer(withIdentifier: "hn-glass") { style.removeLayer(l) }
            if let s = src { style.removeSource(s) }
            return
        }
        if let s = src {
            s.image = g.image
            s.coordinates = g.quad
            return
        }
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
