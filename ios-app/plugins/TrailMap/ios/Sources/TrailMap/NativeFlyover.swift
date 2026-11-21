import Foundation
import MapLibre
import UIKit

// A ski tour's Flyover in native 3D (native 3D parity step 3, alex 2026-11-20), as the web 3D map flies it (winter.js
// flyover): the camera follows the tour from its lower end to its top and on to its end, at zoom 13 and a 68° tilt,
// looking 400 m ahead and turning smoothly, 5 s a km (15 to 50 s). Any touch on the map, or Stop, ends it.
// The page (native-flyover.js) opens native 3D at the tour's start and sends, once, under the key "flyover":
//   { "pts": [[lon, lat], ...] (already from the lower end), "title": "Flyover: <tour>", "stop": "Stop" }
// in the page's language. The camera moves in one-second legs (MapLibre eases each one), so the page hears "moved"
// about once a second and loads the trails along the way, instead of 60 times a second.
final class NativeFlyover: NSObject, NativeLayer, UIGestureRecognizerDelegate {
    let key = "flyover"
    private weak var screen: TrailMapScreen?
    private var pending: (pts: [CLLocationCoordinate2D], title: String, stop: String)?
    private var flying = false
    private var waiting = false               // a flight waiting for the screen's tilt-in
    private var pts: [CLLocationCoordinate2D] = []
    private var along: [Double] = []
    private var leg = 0, legs = 0
    private var heading: Double = 0
    private var altitude: CLLocationDistance = 0
    private var pill: UIView?
    private var touch: UILongPressGestureRecognizer?
    private static let zoom = 13.0, pitch: CGFloat = 68, ahead = 400.0

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        self.screen = screen
        // The screen tilts in for 1.2 s when it first opens (TrailMapPlugin.swift): the flight starts after that,
        // unless the map was touched meanwhile (then it doesn't start at all).
        if pending != nil && !waiting {
            waiting = true
            if touch == nil { listenForTouch(screen.mapLibreView) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { [weak self] in
                guard let self = self, self.waiting else { return }
                self.waiting = false
                self.start()
            }
        }
    }

    func setData(_ json: String, style: MLNStyle?) {
        guard let o = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any],
              let raw = o["pts"] as? [[NSNumber]] else { return }
        let p = raw.compactMap { $0.count >= 2 ? CLLocationCoordinate2D(latitude: $0[1].doubleValue, longitude: $0[0].doubleValue) : nil }
            .filter { CLLocationCoordinate2DIsValid($0) }
        guard p.count >= 2 else { return }
        pending = (p, (o["title"] as? String) ?? "Flyover", (o["stop"] as? String) ?? "Stop")
        if style != nil && screen != nil { start() }   // the screen was already open: fly now
    }

    // ---------- the flight ----------
    private func start() {
        guard let f = pending, let screen = screen, screen.isViewLoaded else { return }
        pending = nil
        stop()
        pts = f.pts
        along = [0]
        for i in 1..<pts.count { along.append(along[i - 1] + NativeFlyover.metres(pts[i - 1], pts[i])) }
        let total = max(along.last ?? 0, 1)
        let dur = max(15, min(50, total / 1000 * 5))      // seconds, as on the web
        legs = max(1, Int(dur.rounded()))
        leg = 0
        heading = NativeFlyover.turn(0, toward: NativeFlyover.bearing(at(0), at(NativeFlyover.ahead)), by: 1)
        let map = screen.mapLibreView
        map.userTrackingMode = .none
        // Zoom 13 at this tilt: the camera's height there, kept for the whole flight.
        let cam = map.camera
        cam.centerCoordinate = at(0)
        cam.heading = heading
        cam.pitch = NativeFlyover.pitch
        map.setCamera(cam, animated: false)
        map.zoomLevel = NativeFlyover.zoom
        altitude = map.camera.altitude
        flying = true
        showPill(f.title, f.stop)
        listenForTouch(map)
        next()
    }

    private func next() {
        guard flying, let map = screen?.mapLibreView else { return }
        if leg >= legs { stop(); return }
        leg += 1
        let total = along.last ?? 0, m = total * Double(leg) / Double(legs), here = at(m)
        // Look 400 m ahead, and turn smoothly so a zigzag skin track doesn't swing the camera. Near the end there's
        // nothing ahead to look at: the heading stays.
        let look = at(m + NativeFlyover.ahead)
        if NativeFlyover.metres(here, look) > 20 {
            heading = NativeFlyover.turn(heading, toward: NativeFlyover.bearing(here, look), by: 0.6)
        }
        let cam = MLNMapCamera(lookingAtCenter: here, altitude: altitude, pitch: NativeFlyover.pitch, heading: heading)
        map.setCamera(cam, withDuration: 1.0, animationTimingFunction: CAMediaTimingFunction(name: .linear)) { [weak self] in
            self?.next()
        }
    }

    private func stop() {
        guard flying || pill != nil || touch != nil else { return }
        flying = false
        pill?.removeFromSuperview()
        pill = nil
        if let t = touch { t.view?.removeGestureRecognizer(t) }
        touch = nil
    }

    // The point m metres along the tour.
    private func at(_ m: Double) -> CLLocationCoordinate2D {
        guard pts.count > 1 else { return pts.first ?? CLLocationCoordinate2D() }
        let m = max(0, min(along.last ?? 0, m))
        var i = 1
        while i < along.count - 1 && along[i] < m { i += 1 }
        let span = along[i] - along[i - 1], t = span > 0 ? (m - along[i - 1]) / span : 0
        let p = pts[i - 1], q = pts[i]
        return CLLocationCoordinate2D(latitude: p.latitude + (q.latitude - p.latitude) * t, longitude: p.longitude + (q.longitude - p.longitude) * t)
    }
    private static func metres(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        CLLocation(latitude: a.latitude, longitude: a.longitude).distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude))
    }
    // From a heading part of the way to another, the short way round; the answer is kept within 0 to 360.
    static func turn(_ from: Double, toward to: Double, by f: Double) -> Double {
        let pos = { (x: Double) -> Double in let r = x.truncatingRemainder(dividingBy: 360); return r < 0 ? r + 360 : r }
        let diff = pos(to - from + 180) - 180
        return pos(from + diff * f)
    }
    private static func bearing(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        atan2((b.longitude - a.longitude) * cos(a.latitude * .pi / 180), b.latitude - a.latitude) * 180 / .pi
    }

    // ---------- a touch on the map ends it ----------
    private func listenForTouch(_ map: MLNMapView) {
        let g = UILongPressGestureRecognizer(target: self, action: #selector(touched(_:)))
        g.minimumPressDuration = 0
        g.cancelsTouchesInView = false
        g.delegate = self
        map.addGestureRecognizer(g)
        touch = g
    }
    @objc private func touched(_ g: UIGestureRecognizer) {
        guard g.state == .began else { return }
        if waiting { waiting = false; pending = nil }
        stopTapped()
    }
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    // ---------- "Flyover: <tour>" and Stop, at the bottom (the web's flyover pill) ----------
    private func showPill(_ title: String, _ stopTitle: String) {
        guard let screen = screen else { return }
        let box = UIView()
        box.backgroundColor = UIColor(red: 0.08, green: 0.13, blue: 0.10, alpha: 0.85)
        box.layer.cornerRadius = 20
        box.translatesAutoresizingMaskIntoConstraints = false
        let label = UILabel()
        label.text = title
        label.font = .systemFont(ofSize: 14, weight: .semibold)
        label.textColor = .white
        label.lineBreakMode = .byTruncatingTail
        label.translatesAutoresizingMaskIntoConstraints = false
        var c = UIButton.Configuration.filled()
        c.title = stopTitle
        c.baseBackgroundColor = .white
        c.baseForegroundColor = UIColor(red: 0.08, green: 0.13, blue: 0.10, alpha: 1)
        c.cornerStyle = .capsule
        c.contentInsets = NSDirectionalEdgeInsets(top: 4, leading: 12, bottom: 4, trailing: 12)
        c.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { a in
            var a = a; a.font = UIFont.systemFont(ofSize: 14, weight: .bold); return a
        }
        let b = UIButton(configuration: c)
        b.addTarget(self, action: #selector(stopTapped), for: .touchUpInside)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.setContentCompressionResistancePriority(.required, for: .horizontal)
        box.addSubview(label)
        box.addSubview(b)
        screen.view.addSubview(box)
        let g = screen.view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            box.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            box.leadingAnchor.constraint(greaterThanOrEqualTo: g.leadingAnchor, constant: 12),
            box.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -24),
            box.heightAnchor.constraint(equalToConstant: 40),
            label.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 14),
            label.centerYAnchor.constraint(equalTo: box.centerYAnchor),
            b.leadingAnchor.constraint(equalTo: label.trailingAnchor, constant: 10),
            b.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -6),
            b.centerYAnchor.constraint(equalTo: box.centerYAnchor),
        ])
        pill = box
    }
    @objc private func stopTapped() {
        guard flying else { stop(); return }
        stop()
        if let map = screen?.mapLibreView { map.setCamera(map.camera, animated: false) }   // halts the leg under way
    }
}
