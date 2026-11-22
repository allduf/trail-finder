import CoreLocation
import Foundation
import MapLibre
import UIKit
import UIKit.UIGestureRecognizerSubclass

// Two-finger measure in native 3D (alex 2026-11-21, "small extras"): hold two fingers still on the map for a moment
// and a line joins them, with the straight-line distance between the two spots of ground under them. Slide the fingers
// to measure something else; the map stays still meanwhile. Lift a finger and the result stays a moment, then fades.
// The web map does the same (finger-measure.js), so it works the same in every 3D and on every device.
// Page -> here (key "fingers"): { "line": the page's words for "straight line" }. Nothing is drawn until two fingers
// are held, nothing is sent back, and nothing changes the map's own data.
final class NativeFingers: NSObject, NativeLayer, UIGestureRecognizerDelegate {
    let key = "fingers"
    private weak var map: MLNMapView?
    private var press: UILongPressGestureRecognizer?
    private let overlay = UIView()
    private let casing = CAShapeLayer()
    private let stroke = CAShapeLayer()
    private let label = UILabel()
    private var line = "straight line"
    private var held: (zoom: Bool, rotate: Bool, pitch: Bool, scroll: Bool)?
    private var fade: DispatchWorkItem?

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        let m = screen.mapLibreView
        if map === m && press != nil { return }   // a new base map: the same map view, already set up
        map = m
        overlay.frame = m.bounds
        overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        overlay.isUserInteractionEnabled = false
        overlay.isHidden = true
        for (l, w, c) in [(casing, CGFloat(5), UIColor(red: 0.08, green: 0.13, blue: 0.10, alpha: 0.85)), (stroke, CGFloat(2.5), UIColor.white)] {
            l.lineWidth = w
            l.strokeColor = c.cgColor
            l.fillColor = c.cgColor
            l.lineCap = .round
            overlay.layer.addSublayer(l)
        }
        label.font = .systemFont(ofSize: 14, weight: .bold)
        label.textColor = UIColor(red: 0.08, green: 0.13, blue: 0.10, alpha: 1)
        label.backgroundColor = UIColor.white.withAlphaComponent(0.96)
        label.textAlignment = .center
        label.layer.cornerRadius = 14
        label.clipsToBounds = true
        overlay.addSubview(label)
        m.addSubview(overlay)
        let g = TwoFingerHold(target: self, action: #selector(pressed(_:)))
        g.numberOfTouchesRequired = 2
        // It showed while moving the map (alex 2026-11-22: "it appears when I don't really want to see it"): both
        // fingers must come down together (a second finger added to a pan never counts) and stay still for 1 s (alex: "hold still for 1sec").
        g.minimumPressDuration = 1.0   // alex 2026-11-22: "hold still for 1sec"
        g.allowableMovement = 8       // fingers that move are a pinch, a twist or a tilt: the map's own
        g.delegate = self
        g.cancelsTouchesInView = false   // the map's own gestures end normally; they're switched off while measuring
        g.delaysTouchesEnded = false
        m.addGestureRecognizer(g)
        press = g
    }

    func setData(_ json: String, style: MLNStyle?) {
        guard let d = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return }
        if let w = o["line"] as? String, !w.isEmpty { line = w }
    }

    // Held next to the map's own gestures: it only starts when the fingers stay still, and then the map holds still.
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool { (g as? TwoFingerHold)?.together ?? true }

    @objc private func pressed(_ g: UILongPressGestureRecognizer) {
        guard let m = map else { return }
        switch g.state {
        case .began:
            fade?.cancel()
            if held == nil {
                held = (m.isZoomEnabled, m.isRotateEnabled, m.isPitchEnabled, m.isScrollEnabled)
                m.isZoomEnabled = false; m.isRotateEnabled = false; m.isPitchEnabled = false; m.isScrollEnabled = false
            }
            overlay.layer.removeAllAnimations()
            overlay.alpha = 1
            overlay.isHidden = false
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            draw(g, in: m)
        case .changed:
            draw(g, in: m)
        default:
            if let h = held {
                m.isZoomEnabled = h.zoom; m.isRotateEnabled = h.rotate; m.isPitchEnabled = h.pitch; m.isScrollEnabled = h.scroll
                held = nil
            }
            let f = DispatchWorkItem { [weak self] in
                guard let self = self else { return }
                UIView.animate(withDuration: 0.4, animations: { self.overlay.alpha = 0 }) { done in
                    if done { self.overlay.isHidden = true }
                }
            }
            fade = f
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5, execute: f)
        }
    }

    private func draw(_ g: UILongPressGestureRecognizer, in m: MLNMapView) {
        guard g.numberOfTouches >= 2 else { return }
        let a = g.location(ofTouch: 0, in: m), b = g.location(ofTouch: 1, in: m)
        let path = UIBezierPath()
        path.move(to: a); path.addLine(to: b)
        for p in [a, b] { path.move(to: CGPoint(x: p.x + 5, y: p.y)); path.addArc(withCenter: p, radius: 5, startAngle: 0, endAngle: .pi * 2, clockwise: true) }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        casing.path = path.cgPath
        stroke.path = path.cgPath
        CATransaction.commit()
        let ca = m.convert(a, toCoordinateFrom: m), cb = m.convert(b, toCoordinateFrom: m)
        // A finger on the sky (far tilted views) has no ground under it: the line shows, with no distance. A point on
        // the sky comes back as the horizon, so only a spot that lands back under the finger counts as ground.
        let onGround = { (p: CGPoint, c: CLLocationCoordinate2D) -> Bool in
            guard CLLocationCoordinate2DIsValid(c) else { return false }
            let q = m.convert(c, toPointTo: m)
            return hypot(q.x - p.x, q.y - p.y) <= 12
        }
        guard onGround(a, ca), onGround(b, cb) else { label.isHidden = true; return }
        let metres = CLLocation(latitude: ca.latitude, longitude: ca.longitude).distance(from: CLLocation(latitude: cb.latitude, longitude: cb.longitude))
        label.text = "  \(NativeFingers.format(metres)) \(line)  "
        label.isHidden = false
        label.sizeToFit()
        let w = label.bounds.width, h = max(28, label.bounds.height + 8)
        let mid = CGPoint(x: (a.x + b.x) / 2, y: min(a.y, b.y) - 70)   // above the fingers, so they don't hide it
        let x = min(max(8, mid.x - w / 2), m.bounds.width - w - 8), y = min(max(8, mid.y), m.bounds.height - h - 8)
        label.frame = CGRect(x: x, y: y, width: w, height: h)
    }

    // As the web map writes it (finger-measure.js): metres under 1 km, then km.
    static func format(_ m: Double) -> String {
        if m < 1000 {
            let step: Double = m < 100 ? 1 : 10
            return "\(Int((m / step).rounded() * step)) m"
        }
        return String(format: m < 10000 ? "%.2f km" : "%.1f km", m / 1000)
    }
}

// A two-finger hold that knows whether both fingers came down together (within 0.25 s).
private final class TwoFingerHold: UILongPressGestureRecognizer {
    private var down = 0
    private var firstAt: TimeInterval = 0
    private(set) var together = false
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        for t in touches {
            if down == 0 { firstAt = t.timestamp; together = false }
            else if down == 1 { together = t.timestamp - firstAt <= 0.25 }
            down += 1
        }
        super.touchesBegan(touches, with: event)
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { down = max(0, down - touches.count); super.touchesEnded(touches, with: event) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { down = max(0, down - touches.count); super.touchesCancelled(touches, with: event) }
    override func reset() { super.reset(); down = 0; together = false }
}
