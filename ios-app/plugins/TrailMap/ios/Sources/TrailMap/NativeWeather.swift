import Foundation
import MapLibre
import UIKit

// Rain and snow radar (radar.js) and wildfire smoke (smoke.js) in native 3D, as on the web 3D map (alex 2026-11-20:
// native 3D parity, step 5). Both are Environment Canada pictures laid on the ground under the trails, so one class
// draws either: the page sends what it shows now (the same hour or frame as its bar) as text under the key "radar" or
// "smoke", and sends it again when that changes:
//   {}                                                       nothing (the layer is off, or no forecast covers that hour)
//   { "tiles": url, "maxzoom": 7, "opacity": 0.7, ... }      ready-made map pictures (url with {bbox-epsg-3857})
//   { "image": "data:image/png;base64,...", "bounds": [s, w, n, e], "opacity": 1, ... }   one picture the page painted
//                                                            (the radar's forecast, in Skiing's colours)
// with "caption" (what it is, the hour and the source, in the page's language) shown at the top of the screen, as the
// page's bar does, and "credit" for the map's credits. Nothing is drawn or loaded while the page sends {}.
final class NativeOverlay: NativeLayer {
    let key: String
    private let row: Int                      // the caption's row at the top (radar 0, smoke 1), so both can show
    private var info: [String: Any] = [:]
    private var shown = ""                    // what's on the map now: the tiles' url, "image", or "" for nothing
    private var gen = 0                       // a tile source can't change its url: a new one replaces it
    private weak var screen: TrailMapScreen?
    private var caption: UILabel?

    init(key: String, row: Int) { self.key = key; self.row = row }

    private var layerId: String { "tf-\(key)-\(gen)" }

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        self.screen = screen
        shown = ""                            // a new style has none of it
        showCaption()
        apply(style)
    }

    func setData(_ json: String, style: MLNStyle?) {
        let o = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] ?? [:]
        info = o
        showCaption()
        if let style = style { apply(style) }
    }

    private func remove(_ style: MLNStyle) {
        if let l = style.layer(withIdentifier: layerId) { style.removeLayer(l) }
        if let s = style.source(withIdentifier: layerId) { style.removeSource(s) }
    }

    private func put(_ layer: MLNStyleLayer, _ style: MLNStyle) {
        // On the ground with the photos, under the trails (as on the web 3D map, under its roads and trail lines).
        if let below = screen?.trailsBottomLayer() { style.insertLayer(layer, below: below) } else { style.addLayer(layer) }
    }

    private func apply(_ style: MLNStyle) {
        let opacity = (info["opacity"] as? NSNumber)?.doubleValue ?? 0.7
        if let tiles = info["tiles"] as? String, !tiles.isEmpty {
            if shown == tiles {
                (style.layer(withIdentifier: layerId) as? MLNRasterStyleLayer)?.rasterOpacity = NSExpression(forConstantValue: opacity)
                return
            }
            remove(style)
            gen += 1
            shown = tiles
            var opts: [MLNTileSourceOption: Any] = [.tileSize: 256, .maximumZoomLevel: (info["maxzoom"] as? NSNumber)?.intValue ?? 7]
            if let credit = info["credit"] as? String, !credit.isEmpty { opts[.attributionHTMLString] = credit }
            let src = MLNRasterTileSource(identifier: layerId, tileURLTemplates: [tiles], options: opts)
            style.addSource(src)
            let l = MLNRasterStyleLayer(identifier: layerId, source: src)
            l.rasterOpacity = NSExpression(forConstantValue: opacity)
            l.rasterFadeDuration = NSExpression(forConstantValue: 0)
            l.rasterResamplingMode = NSExpression(forConstantValue: "linear")
            put(l, style)
            return
        }
        if let url = info["image"] as? String, let b = info["bounds"] as? [NSNumber], b.count == 4,
           let comma = url.firstIndex(of: ","), let bytes = Data(base64Encoded: String(url[url.index(after: comma)...])),
           let img = UIImage(data: bytes) {
            let s = b[0].doubleValue, w = b[1].doubleValue, n = b[2].doubleValue, e = b[3].doubleValue
            let quad = MLNCoordinateQuad(topLeft: CLLocationCoordinate2D(latitude: n, longitude: w),
                                         bottomLeft: CLLocationCoordinate2D(latitude: s, longitude: w),
                                         bottomRight: CLLocationCoordinate2D(latitude: s, longitude: e),
                                         topRight: CLLocationCoordinate2D(latitude: n, longitude: e))
            // The same picture source keeps its layer: a new forecast frame or place swaps in without a blink.
            if shown == "image", let src = style.source(withIdentifier: layerId) as? MLNImageSource {
                src.image = img
                src.coordinates = quad
                (style.layer(withIdentifier: layerId) as? MLNRasterStyleLayer)?.rasterOpacity = NSExpression(forConstantValue: opacity)
                return
            }
            remove(style)
            gen += 1
            shown = "image"
            let src = MLNImageSource(identifier: layerId, coordinateQuad: quad, image: img)
            style.addSource(src)
            let l = MLNRasterStyleLayer(identifier: layerId, source: src)
            l.rasterOpacity = NSExpression(forConstantValue: opacity)
            l.rasterFadeDuration = NSExpression(forConstantValue: 0)
            l.rasterResamplingMode = NSExpression(forConstantValue: "linear")
            put(l, style)
            return
        }
        if info["image"] != nil && shown == "image" { return }   // a picture that didn't decode: keep the last one
        remove(style)
        shown = ""
    }

    // ---------- the caption: what the map shows, which hour, and where it comes from ----------
    private func showCaption() {
        guard let screen = screen, screen.isViewLoaded else { return }
        let text = (info["caption"] as? String) ?? ""
        if caption == nil {
            let c = PaddedLabel()
            c.font = .systemFont(ofSize: 12, weight: .semibold)
            c.textColor = .white
            c.numberOfLines = 2
            c.backgroundColor = UIColor(red: 0.08, green: 0.13, blue: 0.10, alpha: 0.75)
            c.layer.cornerRadius = 10
            c.clipsToBounds = true
            c.isUserInteractionEnabled = false
            c.translatesAutoresizingMaskIntoConstraints = false
            screen.view.addSubview(c)
            let g = screen.view.safeAreaLayoutGuide
            NSLayoutConstraint.activate([
                c.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
                c.trailingAnchor.constraint(lessThanOrEqualTo: g.trailingAnchor, constant: -12),
                c.topAnchor.constraint(equalTo: g.topAnchor, constant: 60 + CGFloat(row) * 44)
            ])
            caption = c
        }
        caption?.text = text
        caption?.isHidden = text.isEmpty
    }
}

private final class PaddedLabel: UILabel {
    private let pad = UIEdgeInsets(top: 4, left: 8, bottom: 4, right: 8)
    override func textRect(forBounds bounds: CGRect, limitedToNumberOfLines n: Int) -> CGRect {
        let r = super.textRect(forBounds: bounds.inset(by: pad), limitedToNumberOfLines: n)
        return r.inset(by: UIEdgeInsets(top: -pad.top, left: -pad.left, bottom: -pad.bottom, right: -pad.right))
    }
    override func drawText(in rect: CGRect) { super.drawText(in: rect.inset(by: pad)) }
}
