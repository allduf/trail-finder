import Capacitor
import CoreLocation
import Foundation
import MapLibre
import UIKit

// A trail map drawn by the iPhone itself (MapLibre Native) instead of the web page: a test, to feel whether a native map
// pans and zooms smoother than the web one (alex 2026-10-30, Upgrade 3 of the review: "Native map trial in MTB").
// The website (native-map.js) opens it from Layers > Native map (test) in MTB and hands it what the flat map shows:
// open({ lat, lon, zoom, bearing, base, lines, dots, dashes }) and update({ lines, dots, dashes }) as it moves.
//   lines, dots: GeoJSON FeatureCollections as text. Lines carry c (colour), w (width), o (opacity), d (dash key, "" for
//   solid); dots carry r (radius), c, w, f (fill), fo (fill opacity). A named trail or dot carries n (its name), and
//   i (its number on the page) when it has its own tap handler there.
//   dashes: the dash keys in use, joined by "|", each a dash pattern in line widths ("2.00,1.20"; "0,2.2" is dots).
// Events back to the page: "moved" { lat, lon, zoom, bearing } after each move (the page loads the trails there and
// sends them with update), and "closed" { lat, lon, zoom, bearing, details, open, tapLat, tapLon } when it's left:
// details is true when "Details" was pressed on a trail's card, open is that trail's i (-1 when it has none) and
// tapLat/tapLon where it was tapped (the page opens the trail there). Zoom is MapLibre's (the web map's minus 1).
@objc(TrailMapPlugin)
public class TrailMapPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TrailMapPlugin"
    public let jsName = "TrailMap"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise)
    ]

    private var screen: TrailMapScreen?

    @objc func open(_ call: CAPPluginCall) {
        let center = CLLocationCoordinate2D(latitude: call.getDouble("lat") ?? 50.1, longitude: call.getDouble("lon") ?? -122.95)
        let zoom = call.getDouble("zoom") ?? 12, bearing = call.getDouble("bearing") ?? 0
        let base = call.getString("base") ?? "osm"
        let lines = call.getString("lines") ?? "", dots = call.getString("dots") ?? "", dashes = call.getString("dashes") ?? ""
        DispatchQueue.main.async {
            if let s = self.screen { s.setData(lines: lines, dots: dots, dashes: dashes); call.resolve(); return }
            guard let host = self.bridge?.viewController else { call.reject("No screen to show the map on"); return }
            let s = TrailMapScreen(center: center, zoom: zoom, bearing: bearing, base: base)
            s.onEvent = { [weak self] name, data in
                self?.notifyListeners(name, data: data)
                if name == "closed" { self?.screen = nil }
            }
            s.setData(lines: lines, dots: dots, dashes: dashes)
            s.modalPresentationStyle = .fullScreen
            self.screen = s
            (host.presentedViewController ?? host).present(s, animated: true) { call.resolve() }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        let lines = call.getString("lines") ?? "", dots = call.getString("dots") ?? "", dashes = call.getString("dashes") ?? ""
        DispatchQueue.main.async {
            self.screen?.setData(lines: lines, dots: dots, dashes: dashes)
            call.resolve()
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.screen?.leave(details: false)
            call.resolve()
        }
    }
}

final class TrailMapScreen: UIViewController, MLNMapViewDelegate, UIGestureRecognizerDelegate {
    var onEvent: ((String, [String: Any]) -> Void)?

    // The map styles, in the order the style button goes through them. Raster ones are the web map's own pictures;
    // "vector" is OpenFreeMap's outdoor map, drawn by the phone (sharp at every zoom).
    private static let styles: [(key: String, name: String)] = [("osm", "Map"), ("topo", "Topo"), ("sat", "Satellite"), ("vector", "Sharp")]
    private static let ink = UIColor(red: 0.08, green: 0.13, blue: 0.10, alpha: 1)
    private static let paper = UIColor(red: 0.95, green: 0.94, blue: 0.91, alpha: 1)

    private let start: CLLocationCoordinate2D
    private let startZoom: Double
    private let startBearing: Double
    private var base: String
    private var map: MLNMapView!
    private var lineShape: MLNShape?
    private var dotShape: MLNShape?
    private var dashKeys: [String] = []
    private var dashLayers: [String] = []      // ids of the dashed line layers on the current style
    private var parseRound = 0                 // newest data wins when two arrive close together
    private var picked = -1                    // the card's trail: its i on the page, and where it was tapped
    private var pickedAt = CLLocationCoordinate2D()
    private var left = false

    private let styleBtn = UIButton(type: .system)
    private let card = UIView()
    private let cardName = UILabel()
    private let cardSwatch = UIView()

    init(center: CLLocationCoordinate2D, zoom: Double, bearing: Double, base: String) {
        start = center; startZoom = zoom; startBearing = bearing
        let b = base == "sathybrid" ? "sat" : base
        self.base = TrailMapScreen.styles.contains { $0.key == b } ? b : "osm"
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = TrailMapScreen.paper
        map = MLNMapView(frame: view.bounds, styleURL: styleURL(base))
        map.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        map.delegate = self
        map.isPitchEnabled = false
        map.logoView.isHidden = true
        map.setCenter(start, zoomLevel: startZoom, direction: startBearing, animated: false)
        map.showsUserLocation = true
        view.addSubview(map)

        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        tap.delegate = self
        map.addGestureRecognizer(tap)

        let back = pill("← Back", #selector(backTapped))
        let tag = UILabel()
        tag.text = "  Native map (test)  "
        tag.font = .systemFont(ofSize: 12, weight: .semibold)
        tag.textColor = .white
        tag.backgroundColor = UIColor(red: 0.08, green: 0.13, blue: 0.10, alpha: 0.75)
        tag.layer.cornerRadius = 11
        tag.clipsToBounds = true
        tag.translatesAutoresizingMaskIntoConstraints = false
        let locate = pill("◎ Me", #selector(locateTapped))
        styled(styleBtn, styleTitle(), #selector(styleTapped))
        [back, tag, locate, styleBtn].forEach { view.addSubview($0) }

        // The trail card: name, colour, Details (opens the trail's details on the page) and ✕.
        card.backgroundColor = .white
        card.layer.cornerRadius = 16
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.25
        card.layer.shadowRadius = 10
        card.layer.shadowOffset = CGSize(width: 0, height: 2)
        card.isHidden = true
        card.translatesAutoresizingMaskIntoConstraints = false
        cardSwatch.layer.cornerRadius = 4
        cardSwatch.translatesAutoresizingMaskIntoConstraints = false
        cardName.font = .systemFont(ofSize: 17, weight: .bold)
        cardName.textColor = TrailMapScreen.ink
        cardName.numberOfLines = 2
        cardName.translatesAutoresizingMaskIntoConstraints = false
        let details = pill("Details ›", #selector(detailsTapped))
        let shut = UIButton(type: .system)
        shut.setTitle("✕", for: .normal)
        shut.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        shut.tintColor = TrailMapScreen.ink
        shut.addTarget(self, action: #selector(cardClose), for: .touchUpInside)
        shut.translatesAutoresizingMaskIntoConstraints = false
        [cardSwatch, cardName, details, shut].forEach { card.addSubview($0) }
        view.addSubview(card)

        let g = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            back.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
            back.topAnchor.constraint(equalTo: g.topAnchor, constant: 8),
            tag.centerXAnchor.constraint(equalTo: g.centerXAnchor),
            tag.centerYAnchor.constraint(equalTo: back.centerYAnchor),
            tag.heightAnchor.constraint(equalToConstant: 22),
            locate.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -12),
            locate.bottomAnchor.constraint(equalTo: card.topAnchor, constant: -12),
            styleBtn.trailingAnchor.constraint(equalTo: locate.leadingAnchor, constant: -8),
            styleBtn.centerYAnchor.constraint(equalTo: locate.centerYAnchor),
            card.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
            card.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -12),
            card.bottomAnchor.constraint(equalTo: g.bottomAnchor, constant: -12),
            cardSwatch.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 14),
            cardSwatch.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            cardSwatch.widthAnchor.constraint(equalToConstant: 8),
            cardSwatch.heightAnchor.constraint(equalToConstant: 34),
            cardName.leadingAnchor.constraint(equalTo: cardSwatch.trailingAnchor, constant: 10),
            cardName.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            cardName.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
            details.leadingAnchor.constraint(greaterThanOrEqualTo: cardName.trailingAnchor, constant: 8),
            details.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            shut.leadingAnchor.constraint(equalTo: details.trailingAnchor, constant: 4),
            shut.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -8),
            shut.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            shut.widthAnchor.constraint(equalToConstant: 36)
        ])
        details.setContentCompressionResistancePriority(.required, for: .horizontal)
        cardName.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    }

    // ---------- buttons ----------
    private func styled(_ b: UIButton, _ title: String, _ action: Selector) {
        var c = UIButton.Configuration.filled()
        c.title = title
        c.baseBackgroundColor = UIColor.white.withAlphaComponent(0.96)
        c.baseForegroundColor = TrailMapScreen.ink
        c.cornerStyle = .capsule
        c.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 14)
        b.configuration = c
        b.layer.shadowColor = UIColor.black.cgColor
        b.layer.shadowOpacity = 0.2
        b.layer.shadowRadius = 4
        b.layer.shadowOffset = CGSize(width: 0, height: 1)
        b.addTarget(self, action: action, for: .touchUpInside)
        b.translatesAutoresizingMaskIntoConstraints = false
    }
    private func pill(_ title: String, _ action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        styled(b, title, action)
        return b
    }
    private func styleTitle() -> String {
        "▦ " + (TrailMapScreen.styles.first { $0.key == base }?.name ?? "Map")
    }

    @objc private func backTapped() { leave(details: false) }
    @objc private func detailsTapped() { leave(details: true) }
    @objc private func cardClose() { showCard(nil) }
    @objc private func locateTapped() {
        map.userTrackingMode = map.userTrackingMode == .none ? .follow : .none
    }
    @objc private func styleTapped() {
        let all = TrailMapScreen.styles
        let at = all.firstIndex { $0.key == base } ?? 0
        base = all[(at + 1) % all.count].key
        styleBtn.configuration?.title = styleTitle()
        map.styleURL = styleURL(base)
    }

    func leave(details: Bool) {
        if left { return }
        left = true
        var e = camera()
        e["details"] = details && !card.isHidden
        e["open"] = picked
        e["tapLat"] = pickedAt.latitude
        e["tapLon"] = pickedAt.longitude
        onEvent?("closed", e)
        map.delegate = nil
        dismiss(animated: true)
    }

    private func camera() -> [String: Any] {
        let c = map.centerCoordinate
        return ["lat": c.latitude, "lon": c.longitude, "zoom": map.zoomLevel, "bearing": map.direction]
    }

    // ---------- the map styles ----------
    private func styleURL(_ key: String) -> URL? {
        if key == "vector" { return URL(string: "https://tiles.openfreemap.org/styles/liberty") }
        let osm = "© OpenStreetMap contributors"
        let (tiles, maxzoom, credit): ([String], Int, String) = {
            switch key {
            case "topo": return (["a", "b", "c"].map { "https://\($0).tile.opentopomap.org/{z}/{x}/{y}.png" }, 17, osm + ", SRTM | © OpenTopoMap")
            case "sat": return (["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"], 19, "Esri, Maxar, Earthstar Geographics")
            default: return (["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], 19, osm)
            }
        }()
        let style: [String: Any] = [
            "version": 8,
            "sources": ["base": ["type": "raster", "tiles": tiles, "tileSize": 256, "maxzoom": maxzoom, "attribution": credit]],
            "layers": [["id": "background", "type": "background", "paint": ["background-color": "#f2efe7"]],
                       ["id": "base", "type": "raster", "source": "base"]]
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: style) else { return nil }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("trail-map-\(key).json")
        do { try data.write(to: file, options: .atomic) } catch { return nil }
        return file
    }

    // A new style has no trails: they're added again on top of it.
    func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
        dashLayers = []
        let lines = MLNShapeSource(identifier: "tf-lines", shape: lineShape, options: nil)
        let dots = MLNShapeSource(identifier: "tf-dots", shape: dotShape, options: nil)
        style.addSource(lines)
        style.addSource(dots)
        style.addLayer(lineLayer(id: "tf-line", source: lines, dash: ""))
        let dot = MLNCircleStyleLayer(identifier: "tf-dots", source: dots)
        dot.circleRadius = NSExpression(forKeyPath: "r")
        dot.circleColor = NSExpression(forKeyPath: "f")
        dot.circleOpacity = NSExpression(forKeyPath: "fo")
        dot.circleStrokeColor = NSExpression(forKeyPath: "c")
        dot.circleStrokeWidth = NSExpression(forKeyPath: "w")
        style.addLayer(dot)
        addDashLayers()
    }

    private func lineLayer(id: String, source: MLNSource, dash: String) -> MLNLineStyleLayer {
        let l = MLNLineStyleLayer(identifier: id, source: source)
        l.predicate = NSPredicate(format: "d == %@", dash)
        l.lineColor = NSExpression(forKeyPath: "c")
        l.lineWidth = NSExpression(forKeyPath: "w")
        l.lineOpacity = NSExpression(forKeyPath: "o")
        l.lineCap = NSExpression(forConstantValue: "round")
        l.lineJoin = NSExpression(forConstantValue: "round")
        if !dash.isEmpty {
            let parts = dash.split(separator: ",").compactMap { Double($0) }.map { NSNumber(value: $0) }
            if parts.count >= 2 { l.lineDashPattern = NSExpression(forConstantValue: parts) }
        }
        return l
    }

    // One layer per dash pattern (MapLibre can't take the pattern from each line), under the dots.
    private func addDashLayers() {
        guard let style = map.style, let src = style.source(withIdentifier: "tf-lines"), let dots = style.layer(withIdentifier: "tf-dots") else { return }
        for d in dashKeys where !d.isEmpty {
            let id = "tf-dash:" + d
            if dashLayers.contains(id) { continue }
            dashLayers.append(id)
            style.insertLayer(lineLayer(id: id, source: src, dash: d), below: dots)
        }
    }

    // ---------- the trails ----------
    // The text is read off the main thread (a region's trails can be a few MB), then shown.
    func setData(lines: String, dots: String, dashes: String) {
        parseRound += 1
        let round = parseRound
        DispatchQueue.global(qos: .userInitiated).async {
            let l = TrailMapScreen.shape(lines), d = TrailMapScreen.shape(dots)
            DispatchQueue.main.async {
                guard round == self.parseRound else { return }
                self.lineShape = l
                self.dotShape = d
                self.dashKeys = dashes.split(separator: "|").map(String.init)
                guard self.isViewLoaded, let style = self.map.style else { return }
                (style.source(withIdentifier: "tf-lines") as? MLNShapeSource)?.shape = l
                (style.source(withIdentifier: "tf-dots") as? MLNShapeSource)?.shape = d
                self.addDashLayers()
            }
        }
    }
    private static func shape(_ json: String) -> MLNShape? {
        guard !json.isEmpty, let data = json.data(using: .utf8) else { return nil }
        return try? MLNShape(data: data, encoding: String.Encoding.utf8.rawValue)
    }

    func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
        if !left { onEvent?("moved", camera()) }
    }

    // A tap on a trail or a dot shows its card; a tap anywhere else closes it. Dots win: they sit on the trails.
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    @objc private func tapped(_ g: UITapGestureRecognizer) {
        guard g.state == .ended else { return }
        let p = g.location(in: map)
        let box = CGRect(x: p.x - 22, y: p.y - 22, width: 44, height: 44)
        let layers = Set(["tf-line", "tf-dots"] + dashLayers)
        let named = { (f: MLNFeature) -> Bool in f.attribute(forKey: "i") != nil || !((f.attribute(forKey: "n") as? String) ?? "").isEmpty }
        let found = map.visibleFeatures(in: box, styleLayerIdentifiers: layers).filter(named)
        pickedAt = map.convert(p, toCoordinateFrom: map)
        showCard(found.first { $0 is MLNPointFeature } ?? found.first { $0.attribute(forKey: "i") != nil } ?? found.first)
    }
    private func showCard(_ f: MLNFeature?) {
        guard let f = f else {
            picked = -1
            card.isHidden = true
            return
        }
        picked = (f.attribute(forKey: "i") as? NSNumber)?.intValue ?? -1
        let name = (f.attribute(forKey: "n") as? String) ?? ""
        cardName.text = name.isEmpty ? "Unnamed trail" : name
        let colour = (f is MLNPointFeature ? f.attribute(forKey: "f") : f.attribute(forKey: "c")) as? String
        cardSwatch.backgroundColor = TrailMapScreen.color(colour) ?? .gray
        card.isHidden = false
    }
    // "#rgb", "#rrggbb" (the colours the page uses); anything else shows grey.
    private static func color(_ s: String?) -> UIColor? {
        guard var h = s?.trimmingCharacters(in: .whitespaces), h.hasPrefix("#") else { return nil }
        h.removeFirst()
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        return UIColor(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    }
}
