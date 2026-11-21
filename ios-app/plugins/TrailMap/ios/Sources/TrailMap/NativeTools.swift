import CoreLocation
import Foundation
import MapLibre
import UIKit

// The map tools in native 3D (alex 2026-11-20, native 3D parity step 4): Plan a route (each sport's own planner),
// Record (Ride mode), Compass and Measure, working exactly as on the web because they ARE the web's: the page's own
// tool, with its own bar (distance, climb, Undo, Ride it, Pause, Stop...), shows above or below the native map, which
// shrinks to the space between (TrailMapScreen.setToolInsets); a tap on the map goes to the page's tool as a tap on its
// map (a planned point, a measured point, the compass's target, a trail picked), and what the tool draws (the route,
// the recorded track, the sight line, the measured line) comes back here and is drawn over the trails.
// A "Tools" button under Back lists the sport's tools (the page sends them, in its language) and starts the one picked.
// Page -> here (key "tools"): "<state>\u{1}<version>\u{1}<shapes>", where
//   state: { "tool": "" | "plan" | "ride" | "compass" | "measure", "cover": a dialog of the page's is open over
//            everything (the screen steps aside until it's answered), "top", "bottom": the page's bar, in points from the
//            screen's top and bottom edges, "taps": the tool takes map taps, "follow": "heading" | "follow" | "none" |
//            "" (leave it), "menu": [the tools' names], "words": { English: the page's language } }
//   version: the shapes' version; shapes (only read when the version changes, may be empty then):
//            { "lines": GeoJSON (c colour, w width, o opacity, d 1 dashed), "dots": GeoJSON (r, c stroke, w, f fill, fo),
//              "labels": GeoJSON (t text, c colour), "arrows": GeoJSON (b bearing from north, c fill, e edge, img) }
//   A page from before arrows sends none; a build from before them leaves them out.
// Here -> page: "toolStart" { i } (the menu's number), "toolTap" { lat, lon, i } (i: the trail tapped, -1 for none).
// Nothing is drawn while no tool has anything on the map. No travel advice and no new words of our own: the words are
// the page's (CLAUDE.md).
final class NativeTools: NativeLayer {
    let key = "tools"
    private static let lines = "tf-tool-lines", dots = "tf-tool-dots", labels = "tf-tool-labels", arrows = "tf-tool-arrows"
    private weak var screen: TrailMapScreen?
    private var button = false
    private var tool = ""
    private var taps = false
    private var cover = false
    private var follow = ""
    private var top: CGFloat = 0
    private var bottom: CGFloat = 0
    private var menu: [String] = []
    private var words: [String: String] = [:]
    private var version = ""
    private var shapes: (MLNShape?, MLNShape?, MLNShape?) = (nil, nil, nil)
    private var arrowShape: MLNShape?
    private var labelTexts: [(String, String)] = []    // (text, colour) of each label, for its picture
    private var arrowInks: [(String, String)] = []     // (fill, edge) of each direction arrow, for its picture
    private var made = Set<String>()                   // label pictures already on the current style
    private var round = 0
    private func t(_ s: String) -> String { words[s] ?? s }

    var wantsTaps: Bool { taps && !tool.isEmpty && !cover }

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        self.screen = screen
        made = []
        let ls = MLNShapeSource(identifier: NativeTools.lines, shape: shapes.0, options: nil)
        let ds = MLNShapeSource(identifier: NativeTools.dots, shape: shapes.1, options: nil)
        let xs = MLNShapeSource(identifier: NativeTools.labels, shape: shapes.2, options: nil)
        let ars = MLNShapeSource(identifier: NativeTools.arrows, shape: arrowShape, options: nil)
        [ls, ds, xs, ars].forEach { style.addSource($0) }
        for dashed in [false, true] {
            let l = MLNLineStyleLayer(identifier: NativeTools.lines + (dashed ? "-dash" : ""), source: ls)
            l.predicate = NSPredicate(format: "d == %@", NSNumber(value: dashed ? 1 : 0))
            l.lineColor = NSExpression(forKeyPath: "c")
            l.lineWidth = NSExpression(forKeyPath: "w")
            l.lineOpacity = NSExpression(forKeyPath: "o")
            l.lineJoin = NSExpression(forConstantValue: "round")
            l.lineCap = NSExpression(forConstantValue: dashed ? "butt" : "round")
            if dashed { l.lineDashPattern = NSExpression(forConstantValue: [NSNumber(value: 2), NSNumber(value: 1.6)]) }
            style.addLayer(l)
        }
        let d = MLNCircleStyleLayer(identifier: NativeTools.dots, source: ds)
        d.circleRadius = NSExpression(forKeyPath: "r")
        d.circleColor = NSExpression(forKeyPath: "f")
        d.circleOpacity = NSExpression(forKeyPath: "fo")
        d.circleStrokeColor = NSExpression(forKeyPath: "c")
        d.circleStrokeWidth = NSExpression(forKeyPath: "w")
        d.circlePitchAlignment = NSExpression(forConstantValue: "viewport")
        style.addLayer(d)
        // Direction arrows (which way the planned or followed route goes): flat on the ground, turning with the map.
        let a = MLNSymbolStyleLayer(identifier: NativeTools.arrows, source: ars)
        a.iconImageName = NSExpression(forKeyPath: "img")
        a.iconRotation = NSExpression(forKeyPath: "b")
        a.iconAllowsOverlap = NSExpression(forConstantValue: true)
        a.iconIgnoresPlacement = NSExpression(forConstantValue: true)
        a.iconPitchAlignment = NSExpression(forConstantValue: "map")
        a.iconRotationAlignment = NSExpression(forConstantValue: "map")
        style.addLayer(a)
        // Labels (distances, point numbers) as pictures: the 3D styles have no letters of their own to draw text with.
        let x = MLNSymbolStyleLayer(identifier: NativeTools.labels, source: xs)
        x.iconImageName = NSExpression(forKeyPath: "img")
        x.iconAllowsOverlap = NSExpression(forConstantValue: true)
        x.iconPitchAlignment = NSExpression(forConstantValue: "viewport")
        x.iconRotationAlignment = NSExpression(forConstantValue: "viewport")
        style.addLayer(x)
        addPictures(style)
        if !button {
            button = true
            screen.addToolButton(t("Tools")) { [weak self] in self?.pick() }
        }
        apply(screen)
        if !follow.isEmpty && follow != "none" { screen.followUser(follow) }   // a tool already on when the screen opened
    }

    private func pick() {
        guard let screen = screen, !menu.isEmpty, screen.presentedViewController == nil else { return }
        let a = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
        for (i, name) in menu.enumerated() {
            a.addAction(UIAlertAction(title: name, style: .default) { [weak self] _ in self?.screen?.send("toolStart", ["i": i]) })
        }
        a.addAction(UIAlertAction(title: t("Cancel"), style: .cancel))
        a.popoverPresentationController?.sourceView = screen.view
        a.popoverPresentationController?.sourceRect = CGRect(x: 60, y: 190, width: 1, height: 1)
        screen.present(a, animated: true)
    }

    func mapTapped(_ at: CLLocationCoordinate2D, trail: Int, screen: TrailMapScreen) -> Bool {
        guard wantsTaps else { return false }
        screen.send("toolTap", ["lat": at.latitude, "lon": at.longitude, "i": trail])
        return true
    }

    func setData(_ text: String, style: MLNStyle?) {
        let parts = text.components(separatedBy: "\u{1}")
        guard let first = parts.first, let d = first.data(using: .utf8),
              let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return }
        let was = tool
        tool = (o["tool"] as? String) ?? ""
        taps = (o["taps"] as? Bool) ?? false
        cover = (o["cover"] as? Bool) ?? false
        top = CGFloat((o["top"] as? NSNumber)?.doubleValue ?? 0)
        bottom = CGFloat((o["bottom"] as? NSNumber)?.doubleValue ?? 0)
        if let m = o["menu"] as? [String] { menu = m }
        if let w = o["words"] as? [String: String] { words = w }
        let f = (o["follow"] as? String) ?? ""
        let followNow = f != follow ? f : ""
        follow = f
        if let s = screen {
            if !tool.isEmpty && tool != was && tool != "sun" { s.hideCard() }   // the sun's time bar takes no taps
            apply(s)
            if !followNow.isEmpty { s.followUser(followNow) }
        }
        guard parts.count >= 3, parts[1] != version else { return }
        version = parts[1]
        let geo = parts[2]
        round += 1
        let r = round
        DispatchQueue.global(qos: .userInitiated).async {
            var l: MLNShape?, p: MLNShape?, x: MLNShape?, ar: MLNShape?, texts: [(String, String)] = [], inks: [(String, String)] = []
            if let gd = geo.data(using: .utf8), let g = try? JSONSerialization.jsonObject(with: gd) as? [String: Any] {
                let shape = { (k: String) -> MLNShape? in
                    guard let v = g[k], let data = try? JSONSerialization.data(withJSONObject: v) else { return nil }
                    return try? MLNShape(data: data, encoding: String.Encoding.utf8.rawValue)
                }
                l = shape("lines"); p = shape("dots"); x = shape("labels"); ar = shape("arrows")
                for f in ((g["arrows"] as? [String: Any])?["features"] as? [[String: Any]]) ?? [] {
                    let pr = f["properties"] as? [String: Any]
                    if let c = pr?["c"] as? String, let e = pr?["e"] as? String, !inks.contains(where: { $0 == (c, e) }) { inks.append((c, e)) }
                }
                for f in ((g["labels"] as? [String: Any])?["features"] as? [[String: Any]]) ?? [] {
                    let pr = f["properties"] as? [String: Any]
                    if let t = pr?["t"] as? String { texts.append((t, (pr?["c"] as? String) ?? "#14211a")) }
                }
            }
            DispatchQueue.main.async {
                guard r == self.round else { return }
                self.shapes = (l, p, x)
                self.labelTexts = texts
                self.arrowShape = ar
                self.arrowInks = inks
                guard let st = self.screen?.mapLibreView.style else { return }
                self.addPictures(st)
                (st.source(withIdentifier: NativeTools.lines) as? MLNShapeSource)?.shape = l
                (st.source(withIdentifier: NativeTools.dots) as? MLNShapeSource)?.shape = p
                (st.source(withIdentifier: NativeTools.labels) as? MLNShapeSource)?.shape = x
                (st.source(withIdentifier: NativeTools.arrows) as? MLNShapeSource)?.shape = ar
            }
        }
    }

    // No room left for a map between the page's bars (a tall sheet on a small iPhone): the screen steps aside as for a
    // dialog, so the bar's buttons (Stop, Undo...) are never hidden under the map.
    private func apply(_ s: TrailMapScreen) {
        let t = tool.isEmpty ? 0 : top, b = tool.isEmpty ? 0 : bottom
        let full = s.view.bounds.height > 0 && t + b > s.view.bounds.height - 160
        s.stepAside(cover || full)
        if !cover && !full { s.setToolInsets(top: t, bottom: b) }
    }

    // A label's picture: its text on a white rounded box, named by the page as "tftl:<colour>:<text>".
    private func addPictures(_ style: MLNStyle) {
        for (text, colour) in labelTexts {
            let name = "tftl:\(colour):\(text)"
            if made.contains(name) { continue }
            made.insert(name)
            style.setImage(NativeTools.picture(text, colour), forName: name)
        }
        for (fill, edge) in arrowInks {
            let name = "tfta:\(fill):\(edge)"
            if made.contains(name) { continue }
            made.insert(name)
            style.setImage(NativeTools.arrow(fill, edge), forName: name)
        }
    }
    // A direction arrow pointing up (north at bearing 0), its fill with an edge round it, as the flat map draws it.
    private static func arrow(_ fill: String, _ edge: String) -> UIImage {
        let size = CGSize(width: 20, height: 20)
        return UIGraphicsImageRenderer(size: size).image { _ in
            let p = UIBezierPath()
            p.move(to: CGPoint(x: 10, y: 3))
            p.addLine(to: CGPoint(x: 17, y: 16))
            p.addLine(to: CGPoint(x: 10, y: 12.5))
            p.addLine(to: CGPoint(x: 3, y: 16))
            p.close()
            p.lineJoinStyle = .round
            p.lineWidth = 2
            (NativeTools.color(edge) ?? .white).setStroke()
            p.stroke()
            (NativeTools.color(fill) ?? UIColor(red: 0.29, green: 0.06, blue: 0.69, alpha: 1)).setFill()
            p.fill()
        }
    }
    private static func picture(_ text: String, _ colour: String) -> UIImage {
        let font = UIFont.systemFont(ofSize: 12, weight: .bold)
        let ink = NativeTools.color(colour) ?? UIColor(red: 0.08, green: 0.13, blue: 0.10, alpha: 1)
        let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: ink]
        let size = (text as NSString).size(withAttributes: attrs)
        let box = CGSize(width: ceil(size.width) + 12, height: ceil(size.height) + 6)
        return UIGraphicsImageRenderer(size: box).image { _ in
            let r = CGRect(origin: .zero, size: box).insetBy(dx: 0.5, dy: 0.5)
            let path = UIBezierPath(roundedRect: r, cornerRadius: box.height / 2)
            UIColor.white.withAlphaComponent(0.95).setFill()
            path.fill()
            ink.withAlphaComponent(0.5).setStroke()
            path.lineWidth = 1
            path.stroke()
            (text as NSString).draw(at: CGPoint(x: 6, y: 3), withAttributes: attrs)
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
