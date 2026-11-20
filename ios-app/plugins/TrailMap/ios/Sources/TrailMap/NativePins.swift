import Foundation
import MapLibre
import UIKit

// The map's tap pins in native 3D (alex 2026-11-20, native 3D parity step 2): webcams, huts, parking, saved spots, the
// searched place, tour starts, trailheads and every other pin the page's flat map shows with a tap behind it. The page
// (native-pins.js) sends them as GeoJSON points: i (the pin's number on the page), n (its name), s (what it is, the
// card's second line), k (which picture: cam, hut, park, saved, search, ski, pin) and c (its colour, "#rrggbb"), r (how
// much it matters: a bigger one keeps its place when pins would overlap, as on the web 3D map).
// A tap shows the usual card (name, what it is) with Details: that goes back to the page and opens the pin's own card
// there, the same one a tap on the flat map opens (the live webcam, the hut's facts...).
// Lifts, trails and the dots under the MTB trailheads were already tappable here (TrailMapPlugin's trail card).
final class NativePins: NativeLayer {
    let key = "pins"
    private static let source = "tf-pins"
    private static let layer = "tf-pins"
    private var shape: MLNShape?
    private var round = 0
    private var made = Set<String>()       // pictures already on the current style
    private weak var screen: TrailMapScreen?

    var tapLayers: [String] { [NativePins.layer] }

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        made = []
        self.screen = screen
        let src = MLNShapeSource(identifier: NativePins.source, shape: shape, options: nil)
        style.addSource(src)
        addPictures(style)
        let l = MLNSymbolStyleLayer(identifier: NativePins.layer, source: src)
        l.iconImageName = NSExpression(forKeyPath: "img")
        l.iconAllowsOverlap = NSExpression(forConstantValue: false)
        l.iconPitchAlignment = NSExpression(forConstantValue: "viewport")
        l.iconRotationAlignment = NSExpression(forConstantValue: "viewport")
        l.symbolSortKey = NSExpression(forKeyPath: "r")       // lower first: the page sends minus the rank
        l.text = NSExpression(forKeyPath: "n")
        l.textFontNames = NSExpression(forConstantValue: ["Noto Sans Bold"])
        l.textFontSize = NSExpression(forConstantValue: 12)
        l.textOptional = NSExpression(forConstantValue: true)  // a name that doesn't fit is left out, the pin stays
        l.textAnchor = NSExpression(forConstantValue: "top")
        l.textOffset = NSExpression(forConstantValue: NSValue(cgVector: CGVector(dx: 0, dy: 1.3)))
        l.textColor = NSExpression(forConstantValue: UIColor(red: 0.08, green: 0.13, blue: 0.10, alpha: 1))
        l.textHaloColor = NSExpression(forConstantValue: UIColor.white)
        l.textHaloWidth = NSExpression(forConstantValue: 1.6)
        l.maximumTextWidth = NSExpression(forConstantValue: 9)
        // Names from zoom 13 (the flat map's 14), like the trail names; pins at every zoom the page shows them.
        l.textOpacity = NSExpression(format: "mgl_step:from:stops:($zoomLevel, 0, %@)", [13: 1])
        style.addLayer(l)   // over the trails and names: pins sit on top, as on the web 3D map
    }

    func setData(_ json: String, style: MLNStyle?) {
        round += 1
        let r = round
        DispatchQueue.global(qos: .userInitiated).async {
            var s: MLNShape?
            if let d = json.data(using: .utf8) { s = try? MLNShape(data: d, encoding: String.Encoding.utf8.rawValue) }
            DispatchQueue.main.async {
                guard r == self.round else { return }
                self.shape = s
                // The style showing now (a new base map may have come since the data left).
                guard let style = self.screen?.mapLibreView.style ?? style else { return }
                self.addPictures(style)
                (style.source(withIdentifier: NativePins.source) as? MLNShapeSource)?.shape = s
            }
        }
    }

    func tapped(_ f: MLNFeature, screen: TrailMapScreen) -> Bool {
        guard let i = (f.attribute(forKey: "i") as? NSNumber)?.intValue else { return false }
        let name = (f.attribute(forKey: "n") as? String) ?? ""
        screen.showFeatureCard(name: name.isEmpty ? "Pin" : name, sub: f.attribute(forKey: "s") as? String,
                               colour: f.attribute(forKey: "c") as? String, open: i, at: f.coordinate, key: key)
        return true
    }

    // ---------- the pictures: a rounded square in the pin's colour with a white line icon, as on the page ----------
    // One per kind and colour in use, made once per style ("img" = "tfpin:kind:#rrggbb").
    private func addPictures(_ style: MLNStyle) {
        guard let feats = (shape as? MLNShapeCollectionFeature)?.shapes else { return }
        for f in feats {
            guard let img = f.attribute(forKey: "img") as? String, !made.contains(img) else { continue }
            made.insert(img)
            let parts = img.split(separator: ":", maxSplits: 2).map(String.init)
            guard parts.count == 3 else { continue }
            style.setImage(NativePins.picture(kind: parts[1], colour: parts[2]), forName: img)
        }
    }

    private static let symbols: [String: [String]] = [
        "cam": ["camera"], "hut": ["house"], "saved": ["bookmark"], "search": ["mappin"],
        "ski": ["figure.skiing.downhill", "snowflake"], "pin": ["mappin"]
    ]
    static func picture(kind: String, colour: String) -> UIImage {
        let size: CGFloat = kind == "search" ? 34 : 28
        let fill = color(colour) ?? UIColor(red: 0.11, green: 0.11, blue: 0.12, alpha: 1)
        return UIGraphicsImageRenderer(size: CGSize(width: size + 4, height: size + 4)).image { _ in
            let box = CGRect(x: 2, y: 2, width: size, height: size)
            let path = kind == "search" ? UIBezierPath(ovalIn: box) : UIBezierPath(roundedRect: box, cornerRadius: 8)
            fill.setFill(); path.fill()
            UIColor.white.setStroke(); path.lineWidth = 2; path.stroke()
            if kind == "park" {
                let t = NSAttributedString(string: "P", attributes: [.font: UIFont.systemFont(ofSize: size * 0.55, weight: .heavy), .foregroundColor: UIColor.white])
                let ts = t.size()
                t.draw(at: CGPoint(x: box.midX - ts.width / 2, y: box.midY - ts.height / 2))
                return
            }
            let conf = UIImage.SymbolConfiguration(pointSize: size * 0.5, weight: .semibold)
            let names = symbols[kind] ?? ["mappin"]
            guard let sym = names.lazy.compactMap({ UIImage(systemName: $0, withConfiguration: conf) }).first?
                .withTintColor(.white, renderingMode: .alwaysOriginal) else { return }
            sym.draw(at: CGPoint(x: box.midX - sym.size.width / 2, y: box.midY - sym.size.height / 2))
        }
    }
    private static func color(_ s: String) -> UIColor? {
        var h = s.trimmingCharacters(in: .whitespaces)
        guard h.hasPrefix("#") else { return nil }
        h.removeFirst()
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        return UIColor(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    }
}
