import Capacitor
import CoreLocation
import Foundation
import MapLibre
import UIKit
import WebKit

// A trail map drawn by the iPhone itself (MapLibre Native) instead of the web page: a test, to feel whether a native map
// pans and zooms smoother than the web one (alex 2026-10-30, Upgrade 3 of the review: "Native map trial in MTB").
// The website (native-map.js) opens it from Layers > Native map (test) in MTB and hands it what the flat map shows:
// open({ lat, lon, zoom, bearing, base, lines, dots, dashes }) and update({ lines, dots, dashes }) as it moves.
//   lines, dots: GeoJSON FeatureCollections as text. Lines carry c (colour), w (width), o (opacity), d (dash key, "" for
//   solid); dots carry r (radius), c, w, f (fill), fo (fill opacity). A named trail or dot carries n (its name), and
//   i (its number on the page) when it has its own tap handler there.
//   dashes: the dash keys in use, joined by "|", each a dash pattern in line widths ("2.00,1.20"; "0,2.2" is dots).
// threeD: true opens it in 3D instead (alex 2026-11-16, "Small native 3D trial"): satellite photos draped over the
// mountains (Mapterhorn heights), tilted, with the same trails, to feel whether a 3D map drawn by the iPhone turns and
// tilts smoother than the web one. Since 2026-11-20 it's on its way to being the main 3D on phones (alex): base maps and
// names in NativeBaseStyles.swift, each further feature in its own file (NativeLayers.swift).
// winter: true (Skiing only) adds Skiing's Winter map to 3D, first in the list (WinterTiles below), and opens on it when
// the page's map is on Winter.
// In 3D a "Layers" button closes it with layers: true in "closed": the page opens its own 3D map there, with its Layers
// open, for what only the web map draws (avalanche, slopes, planning...): "native for viewing, web for tools" (alex
// 2026-11-20).
// layer({ key, data }): one feature's data (NativeLayers.swift; open may carry them too as layers: { key: data }).
// offline({ areas }): the iPhone's own copies of the saved offline areas (NativeOffline.swift).
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
        CAPPluginMethod(name: "layer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "offline", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "features", returnType: CAPPluginReturnPromise)
    ]

    private var screen: TrailMapScreen?

    @objc func open(_ call: CAPPluginCall) {
        let center = CLLocationCoordinate2D(latitude: call.getDouble("lat") ?? 50.1, longitude: call.getDouble("lon") ?? -122.95)
        let zoom = call.getDouble("zoom") ?? 12, bearing = call.getDouble("bearing") ?? 0
        let base = call.getString("base") ?? "osm", threeD = call.getBool("threeD") ?? false, winter = call.getBool("winter") ?? false
        let esri = call.getString("esri"), fr = call.getString("lang") == "fr"
        let lines = call.getString("lines") ?? "", dots = call.getString("dots") ?? "", dashes = call.getString("dashes") ?? ""
        // under: the page's buttons, menus and cards stay on top, this map under them (see TrailMapScreen.under). Only
        // with an app whose web view lets touches through to it (App/TFBridge.swift); otherwise the screen goes on top.
        let underData = call.getString("under")
        var extra: [String: String] = [:]
        for (k, v) in call.getObject("layers") ?? [:] { if let t = v as? String { extra[k] = t } }
        DispatchQueue.main.async {
            if let s = self.screen { s.setData(lines: lines, dots: dots, dashes: dashes); extra.forEach { s.setLayer($0.key, $0.value) }; call.resolve(); return }
            guard let host = self.bridge?.viewController else { call.reject("No screen to show the map on"); return }
            let web = self.bridge?.webView
            let under = underData != nil && threeD && web?.responds(to: NSSelectorFromString("setTfUnderlay:")) == true
            let s = TrailMapScreen(center: center, zoom: zoom, bearing: bearing, base: base, threeD: threeD, winter: winter, esri: esri, fr: fr, under: under)
            s.onEvent = { [weak self] name, data in
                self?.notifyListeners(name, data: data)
                if name == "closed" { self?.screen = nil }
            }
            // The page under the map: hidden while the map covers it all (nothing drawn twice, as when this screen was
            // a full-screen modal), shown while a tool's own bar from the page is open above or below the map. Its
            // scroll view (what draws the page), not the web view: in Capacitor the host's view IS the web view, and
            // this screen sits inside it.
            if !under { s.showWeb = { [weak self] on in self?.bridge?.webView?.scrollView.isHidden = !on } }
            s.setData(lines: lines, dots: dots, dashes: dashes)
            extra.forEach { s.setLayer($0.key, $0.value) }
            self.screen = s
            // Over the page as a child screen, not a modal (native 3D parity step 4, alex 2026-11-20): a tool's bar from
            // the page (Plan a route, Record, Compass, Measure) shows and takes taps above or below the map, where the
            // screen lets touches through (TrailMapScreen.setToolInsets).
            host.addChild(s)
            s.view.frame = host.view.bounds
            s.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            if under, let wv = web {
                // Under the page: behind the web view's own drawing, which turns see-through where its map was (the page
                // hides its flat map once open() answers). Touches where the page shows nothing come here (TFWebView).
                s.view.alpha = 1
                s.webWas = (wv.isOpaque, wv.backgroundColor, wv.scrollView.backgroundColor)
                wv.isOpaque = false
                wv.backgroundColor = .clear
                wv.scrollView.backgroundColor = .clear
                wv.insertSubview(s.view, belowSubview: wv.scrollView)
                wv.setValue(s.view, forKey: "tfUnderlay")
                s.web = wv
                if let u = underData { s.setLayer("under", u) }
            } else {
                s.view.alpha = 0.011   // not seen, but it takes the touches (alpha 0 lets them through to the flat map)
                host.view.addSubview(s.view)
            }
            s.didMove(toParent: host)
            // Seamless from the flat map (alex 2026-11-21: "tilt from the 2d directly and it transition seamless to 3d"):
            // the screen stays invisible over the page's flat map until its own map has drawn the same spot, in the same
            // style, then shows in a quick fade and (3D) tilts up from flat. At most 2.5 s (no signal, slow tiles).
            var shown = false
            let show = { [weak s] in
                if shown { return }
                shown = true
                guard let s = s, !s.left else { call.resolve(); return }
                s.onReady = nil
                if s.under {
                    // The page hides its flat map as soon as this answers (under: true); the tilt starts once it has.
                    call.resolve(["under": true])
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak s] in s?.tiltIn() }
                    return
                }
                UIView.animate(withDuration: 0.18, animations: { s.view.alpha = 1 }) { _ in
                    if s.parent != nil && !s.left && !s.toolOpen && !s.aside { s.showWeb?(false) }
                    s.tiltIn()
                    call.resolve()
                }
            }
            s.onReady = show
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5, execute: show)
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        let lines = call.getString("lines") ?? "", dots = call.getString("dots") ?? "", dashes = call.getString("dashes") ?? ""
        DispatchQueue.main.async {
            self.screen?.setData(lines: lines, dots: dots, dashes: dashes)
            call.resolve()
        }
    }

    @objc func layer(_ call: CAPPluginCall) {
        let key = call.getString("key") ?? "", data = call.getString("data") ?? ""
        DispatchQueue.main.async {
            self.screen?.setLayer(key, data)
            call.resolve()
        }
    }

    // The native 3D features this app build has (NativeLayers.all keys): the page asks before relying on one that does
    // something by itself (a Flyover), since an older build quietly ignores keys it doesn't know.
    @objc func features(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["keys": NativeLayers.all.map { $0().key }]) }
    }

    // offline({ areas: [{ id, box, boxes, ski }] }): the saved areas the iPhone keeps its own copy of for native 3D
    // (NativeOffline.swift); answers { areas: { id: { pct, saved, active, bytes } } }, and "offlinePacks" with the same
    // as the copies download.
    @objc func offline(_ call: CAPPluginCall) {
        let areas: [[String: Any]] = (call.getArray("areas") ?? []).compactMap { $0 as? [String: Any] }
        DispatchQueue.main.async {
            OfflinePacks.shared.onChange = { [weak self] s in self?.notifyListeners("offlinePacks", data: s) }
            OfflinePacks.shared.sync(areas) { call.resolve($0) }
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.screen?.leave(details: false)
            call.resolve()
        }
    }
}

// The screen's own view lets touches through where nothing of it is (a tool's bar from the page shows there).
private final class PassView: UIView {
    // Under the page (TrailMapScreen.under): whether a point is the map's, not the page's (its buttons, bars, cards).
    var takes: ((CGPoint) -> Bool)?
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        guard super.point(inside: point, with: event) else { return false }
        return takes?(point) ?? true
    }
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let v = super.hitTest(point, with: event)
        return v === self ? nil : v
    }
}

final class TrailMapScreen: UIViewController, MLNMapViewDelegate, UIGestureRecognizerDelegate {
    var onEvent: ((String, [String: Any]) -> Void)?
    var showWeb: ((Bool) -> Void)?
    // Room left for a tool's bar from the page (points from the top and the bottom of the screen); the map and its
    // buttons fit between (setToolInsets).
    private(set) var toolOpen = false
    private var mapTop: NSLayoutConstraint?
    private var mapBottom: NSLayoutConstraint?
    private var areaTop: NSLayoutConstraint?
    private var areaBottom: NSLayoutConstraint?
    private let area = UILayoutGuide()          // where the map's own buttons go: the map, inside the safe area
    private var insetTop: CGFloat = 0
    private var insetBottom: CGFloat = 0

    // The map styles, in the order the style button goes through them. Raster ones are the web map's own pictures;
    // "vector" is OpenFreeMap's outdoor map, drawn by the phone (sharp at every zoom).
    private static let flatStyles: [(key: String, name: String)] = [("osm", "Map"), ("topo", "Topo"), ("sat", "Satellite"), ("vector", "Sharp")]
    // In 3D the photo comes first; "vector" is left out (its own style has no room for the heights).
    private static let styles3D: [(key: String, name: String)] = [("sat", "Satellite"), ("topo", "Topo"), ("osm", "Map")]
    // Skiing's 3D: its own Winter map first.
    private var styles: [(key: String, name: String)] {
        let own: [(key: String, name: String)] = winter ? [(key: "winter", name: "Winter")] : []
        return threeD ? own + TrailMapScreen.styles3D : TrailMapScreen.flatStyles
    }
    private static let tilt: CGFloat = 65        // the web 3D map eases to 70
    private static let ink = UIColor(red: 0.08, green: 0.13, blue: 0.10, alpha: 1)
    private static let paper = UIColor(red: 0.95, green: 0.94, blue: 0.91, alpha: 1)
    private static let sky = UIColor(red: 0.62, green: 0.70, blue: 0.78, alpha: 1)   // #9fb3c8, the web 3D map's

    private let start: CLLocationCoordinate2D
    private let startZoom: Double
    private let startBearing: Double
    private let threeD: Bool
    private let winter: Bool
    private let esri: String?      // the page's Esri photo address (the app's own key), for the 3D photos
    private let fr: Bool           // names in French
    private var tilted = false
    // ---------- under the page (alex 2026-11-22: "i want to keep the same interface for both i never want the map to
    // switch from web to native map") ----------
    // The page's own buttons, menus, bottom bar and cards stay on top, as on the flat map; this map is drawn under the
    // web view and takes the touches where the page shows nothing (the page sends where that is, "under" below). Its
    // own Back, Layers, style and Me buttons and its trail card don't show: the page's do that (native-map.js). A
    // trail tapped here opens the page's own card ("tap"); Details on a feature's card opens on the page ("details")
    // and this map stays. Only the page closes it (its 2D button, or Android's Back).
    let under: Bool
    weak var web: WKWebView?
    var webWas: (Bool, UIColor?, UIColor?)?
    private var mask: (cell: CGFloat, cols: Int, rows: Int, bits: [UInt8])?
    private var uiTop: CGFloat = 0, uiBottom: CGFloat = 0
    // The first frame of the same spot and style as the page's flat map is drawn (open() then shows this screen).
    var onReady: (() -> Void)?
    private var waitWinter = false   // Skiing's Winter asked for but its lists still coming: not ready on Satellite
    // False from the moment a new map style is asked for until it has loaded. Meanwhile MapLibre swaps the old layers
    // out from under their objects, so a feature touching the style then can crash the app (alex's crash 2026-11-21:
    // Satellite picked in 3D with no signal). Features draw again in didFinishLoading.
    private(set) var styleReady = false
    private var base: String
    private var map: MLNMapView!
    private var lineShape: MLNShape?
    private var dotShape: MLNShape?
    private var dashKeys: [String] = []
    private var dashLayers: [String] = []      // ids of the dashed line layers on the current style
    private var parseRound = 0                 // newest data wins when two arrive close together
    private var picked = -1                    // the card's trail: its i on the page, and where it was tapped
    private var pickedAt = CLLocationCoordinate2D()
    private var pickedFeature: String?         // the card's feature key (NativeLayers.swift), nil for a trail
    private(set) var left = false

    private let styleBtn = UIButton(type: .system)
    private let card = UIView()
    private let cardName = UILabel()
    private let cardSwatch = UIView()
    private var cardDetails: UIButton?
    private let cardSub = UILabel()            // a feature card's second line (what it is: "Webcam", "Hut"...)
    private let toolStack = UIStackView()      // features' own buttons, top right across from Back (addToolButton)
    // The native 3D features (NativeLayers.swift), each with its own sources and layers; 3D only.
    private lazy var features: [NativeLayer] = threeD ? NativeLayers.all.map { $0() } : []

    init(center: CLLocationCoordinate2D, zoom: Double, bearing: Double, base: String, threeD: Bool = false, winter: Bool = false, esri: String? = nil, fr: Bool = false, under: Bool = false) {
        start = center; startZoom = zoom; startBearing = bearing
        self.under = under
        self.esri = esri.flatMap { $0.contains("{z}") && $0.hasPrefix("https://") ? $0 : nil }
        self.fr = fr
        self.threeD = threeD
        let ski = threeD && winter
        self.winter = ski
        let b = base == "sathybrid" ? "sat" : base
        let list = threeD ? TrailMapScreen.styles3D : TrailMapScreen.flatStyles
        // 3D opens in the flat map's style where it has it (Topo, Map), so the change to 3D shows no other map.
        self.base = threeD ? (ski && b == "winter" ? "winter" : list.contains { $0.key == b } ? b : "sat") : (list.contains { $0.key == b } ? b : "osm")
        super.init(nibName: nil, bundle: nil)
        waitWinter = self.base == "winter" && !WinterTiles.shared.ready
        if threeD { WinterTiles.shared.install() }   // the photo address rewriter (Winter photos, late-summer mountains)
        // Names and dots near the camera stay near their size (NativeNearNames.swift). Before the map is made, as MapLibre
        // compiles its shaders when a map first draws; on the flat map too, where nothing changes (no tilt).
        NativeNearNames.install()
        if ski { WinterTiles.shared.load { _ in } }   // the lists of photo squares, ready by the time Winter is picked
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func loadView() {
        let v = PassView()
        if under { v.takes = { [weak self] p in self?.mapTakes(p) ?? true } }
        view = v
    }
    // The page's map at this point (not a button, bar or card of its own): the page's grid of what's where.
    private func mapTakes(_ p: CGPoint) -> Bool {
        guard let m = mask, m.cell > 0 else { return p.y > 110 && p.y < view.bounds.height - 170 }   // until it comes
        let c = Int(p.x / m.cell), r = Int(p.y / m.cell)
        guard c >= 0, r >= 0, c < m.cols, r < m.rows, r * m.cols + c < m.bits.count else { return false }
        return m.bits[r * m.cols + c] == 1
    }
    // { s: cell size (points), c: columns, r: rows, m: "0101…" row by row (1: map), t, b: the page's rows of buttons from
    // the top and bottom (this map's own labels and cards go between), cam: { lat, lon, zoom, bearing } the page moved its
    // map to (a search, a card), me: true (the page's My location: follow you), back: true (Back) }.
    func applyUnder(_ json: String) {
        guard under, let d = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return }
        if let cell = (o["s"] as? NSNumber)?.doubleValue, let cols = (o["c"] as? NSNumber)?.intValue,
           let rows = (o["r"] as? NSNumber)?.intValue, let bits = o["m"] as? String, cols > 0, rows > 0 {
            mask = (CGFloat(cell), cols, rows, bits.utf8.map { $0 == 49 ? 1 : 0 })
        }
        if let t = (o["t"] as? NSNumber)?.doubleValue, let b = (o["b"] as? NSNumber)?.doubleValue,
           abs(CGFloat(t) - uiTop) >= 1 || abs(CGFloat(b) - uiBottom) >= 1 {
            uiTop = max(0, CGFloat(t)); uiBottom = max(0, CGFloat(b))
            if isViewLoaded { layoutArea() }
        }
        if isViewLoaded, let cam = o["cam"] as? [String: Any], let lat = (cam["lat"] as? NSNumber)?.doubleValue,
           let lon = (cam["lon"] as? NSNumber)?.doubleValue, let z = (cam["zoom"] as? NSNumber)?.doubleValue {
            endTilt()
            map.userTrackingMode = .none
            let to = CLLocationCoordinate2D(latitude: lat, longitude: lon)
            let dir = (cam["bearing"] as? NSNumber)?.doubleValue ?? map.direction
            map.setCenter(to, zoomLevel: z, direction: dir, animated: true)
        }
        if isViewLoaded, o["me"] as? Bool == true { locateTapped() }
        // Back with nothing of the page's open (Android's; here for the same page): the card first, else back to 2D.
        if isViewLoaded, o["back"] as? Bool == true { if !card.isHidden { showCard(nil) } else { leave(details: false) } }
    }


    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = threeD ? TrailMapScreen.sky : TrailMapScreen.paper
        // Winter waits for its lists of photo squares (a moment, once a session): Satellite until then.
        map = MLNMapView(frame: view.bounds, styleURL: styleURL(base == "winter" && !WinterTiles.shared.ready ? "sat" : base))
        map.translatesAutoresizingMaskIntoConstraints = false
        map.delegate = self
        map.isPitchEnabled = threeD
        if threeD {
            map.maximumPitch = 80
            map.backgroundColor = TrailMapScreen.sky   // above the far mountains: sky, not a blank page (as the web 3D map)
            // New ground fills in over a few frames instead of all in one (which can stall a frame while turning).
            map.terrainLoadMode = .balanced
            map.isCenterClampedToGround = true
        }
        map.logoView.isHidden = true
        map.setCenter(start, zoomLevel: startZoom, direction: startBearing, animated: false)
        map.showsUserLocation = true
        view.addSubview(map)
        view.addLayoutGuide(area)
        let mt = map.topAnchor.constraint(equalTo: view.topAnchor), mb = map.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        let at = area.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor)
        let ab = area.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        mapTop = mt; mapBottom = mb; areaTop = at; areaBottom = ab
        NSLayoutConstraint.activate([
            mt, mb, at, ab,
            map.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            map.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            area.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            area.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor)
        ])
        if base == "winter" && !WinterTiles.shared.ready { showStyle() }

        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        tap.delegate = self
        map.addGestureRecognizer(tap)

        let back = pill("← Back", #selector(backTapped))
        let tag = UILabel()
        tag.text = "  Native map (test)  "
        tag.isHidden = threeD   // native 3D is the iPhone's 3D map now (alex 2026-11-21): no "(test)" label
        tag.font = .systemFont(ofSize: 12, weight: .semibold)
        tag.textColor = .white
        tag.backgroundColor = UIColor(red: 0.08, green: 0.13, blue: 0.10, alpha: 0.75)
        tag.layer.cornerRadius = 11
        tag.clipsToBounds = true
        tag.translatesAutoresizingMaskIntoConstraints = false
        let locate = pill("◎ Me", #selector(locateTapped))
        styled(styleBtn, styleTitle(), #selector(styleTapped))
        [back, tag, locate, styleBtn].forEach { view.addSubview($0) }
        if under { [back, tag, locate, styleBtn, toolStack].forEach { $0.isHidden = true } }   // the page's own buttons do these (its search bar and Tools too: no Search or Tools pills over the page, alex 2026-11-21 "Why is not the same?")
        if threeD && !under {
            let layers = pill("☰ Layers", #selector(layersTapped))
            view.addSubview(layers)
            NSLayoutConstraint.activate([
                layers.trailingAnchor.constraint(equalTo: styleBtn.leadingAnchor, constant: -8),
                layers.centerYAnchor.constraint(equalTo: locate.centerYAnchor)
            ])
        }

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
        cardSub.font = .systemFont(ofSize: 13, weight: .semibold)
        cardSub.textColor = .darkGray
        cardSub.numberOfLines = 1
        cardSub.isHidden = true
        let cardText = UIStackView(arrangedSubviews: [cardName, cardSub])
        cardText.axis = .vertical
        cardText.spacing = 2
        cardText.translatesAutoresizingMaskIntoConstraints = false
        let details = pill("Details ›", #selector(detailsTapped))
        cardDetails = details
        let shut = UIButton(type: .system)
        shut.setTitle("✕", for: .normal)
        shut.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        shut.tintColor = TrailMapScreen.ink
        shut.addTarget(self, action: #selector(cardClose), for: .touchUpInside)
        shut.translatesAutoresizingMaskIntoConstraints = false
        [cardSwatch, cardText, details, shut].forEach { card.addSubview($0) }
        view.addSubview(card)
        toolStack.axis = .vertical
        toolStack.alignment = .trailing
        toolStack.spacing = 8
        toolStack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toolStack)

        let g = area
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
            cardText.leadingAnchor.constraint(equalTo: cardSwatch.trailingAnchor, constant: 10),
            cardText.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            cardText.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
            details.leadingAnchor.constraint(greaterThanOrEqualTo: cardText.trailingAnchor, constant: 8),
            toolStack.trailingAnchor.constraint(equalTo: g.trailingAnchor, constant: -12),
            toolStack.topAnchor.constraint(equalTo: back.topAnchor),
            details.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            shut.leadingAnchor.constraint(equalTo: details.trailingAnchor, constant: 4),
            shut.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -8),
            shut.centerYAnchor.constraint(equalTo: card.centerYAnchor),
            shut.widthAnchor.constraint(equalToConstant: 36)
        ])
        details.setContentCompressionResistancePriority(.required, for: .horizontal)
        cardName.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        cardText.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
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
        "▦ " + (styles.first { $0.key == base }?.name ?? "Map")
    }

    @objc private func backTapped() { leave(details: false) }
    // Layers (alex 2026-11-21: no jumping to the web 3D map and back): the page opens its own Layers over this screen,
    // which steps aside until Layers closes (NativeTools.swift "cover"), and comes back as it was. A page from before
    // this (no answer within 1.5 s): the old way, the web 3D map with its Layers.
    private var layersAsked = false
    @objc private func layersTapped() {
        layersAsked = true
        send("layers", [:])
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self = self, self.layersAsked, !self.left else { return }
            self.layersAsked = false
            self.leave(details: false, layers: true)
        }
    }
    @objc private func detailsTapped() { leave(details: true) }
    @objc private func cardClose() { showCard(nil) }
    @objc private func locateTapped() {
        endTilt()
        map.userTrackingMode = map.userTrackingMode == .none ? .follow : .none
    }
    @objc private func styleTapped() {
        let all = styles
        let at = all.firstIndex { $0.key == base } ?? 0
        base = all[(at + 1) % all.count].key
        styleBtn.configuration?.title = styleTitle()
        showStyle()
    }
    // The page's map style, picked in its Layers while this screen stepped aside: the same style here when it has it.
    private func setBase(_ b: String) {
        // As open() reads it: ADV topo is "vector" (flat only), the photos with names are the photos; another street
        // map is the Map.
        let k = b == "sathybrid" ? "sat" : b == "advtopo" ? "vector" : ["cyclosm", "hot", "voyager", "osmde", "osmfr"].contains(b) ? "osm" : b
        guard k != base, styles.contains(where: { $0.key == k }) else { return }
        base = k
        styleBtn.configuration?.title = styleTitle()
        showStyle()
    }
    private func showStyle() {
        guard base == "winter", !WinterTiles.shared.ready else { if base == "winter" { waitWinter = false }; styleReady = false; map.styleURL = styleURL(base); return }
        WinterTiles.shared.load { [weak self] ok in
            guard let self = self, !self.left, self.base == "winter" else { return }
            self.waitWinter = false
            self.styleReady = false
            if ok { self.map.styleURL = self.styleURL("winter"); return }
            // The lists couldn't come (no connection): back to Satellite.
            self.base = "sat"
            self.styleBtn.configuration?.title = self.styleTitle()
            self.map.styleURL = self.styleURL("sat")
        }
    }

    // extra: a feature's own keys for the page ("closed"), e.g. avy: true for the avalanche card's "Full forecast".
    func leave(details: Bool, layers: Bool = false, extra: [String: Any] = [:]) {
        if left { return }
        // Under the page, Details (a card's, or a feature's own link such as the avalanche card's full forecast) opens
        // on the page over this map, which stays.
        if under && (details || !extra.isEmpty) {
            var e = camera()
            e["details"] = details && !card.isHidden && cardDetails?.isHidden != true
            extra.forEach { e[$0.key] = $0.value }
            e["open"] = picked
            e["tapLat"] = pickedAt.latitude
            e["tapLon"] = pickedAt.longitude
            if let k = pickedFeature, e["details"] as? Bool == true { e["feature"] = k }
            send("details", e)
            showCard(nil)
            return
        }
        left = true
        var e = camera()
        e["details"] = details && !card.isHidden && cardDetails?.isHidden != true
        e["layers"] = layers
        extra.forEach { e[$0.key] = $0.value }
        e["open"] = picked
        e["tapLat"] = pickedAt.latitude
        e["tapLon"] = pickedAt.longitude
        if let k = pickedFeature, e["details"] as? Bool == true { e["feature"] = k }
        onEvent?("closed", e)
        map.delegate = nil
        showWeb?(true)
        if let wv = web {   // the page's own map is back: the web view as it was
            if (wv.value(forKey: "tfUnderlay") as? UIView) === view { wv.setValue(nil, forKey: "tfUnderlay") }
            if let w = webWas { wv.isOpaque = w.0; wv.backgroundColor = w.1; wv.scrollView.backgroundColor = w.2 }
        }
        UIView.animate(withDuration: 0.2, animations: { self.view.alpha = 0 }) { _ in
            self.willMove(toParent: nil)
            self.view.removeFromSuperview()
            self.removeFromParent()
        }
    }

    // ---------- a tool's bar from the page (NativeTools.swift) ----------
    // top / bottom: how much of the screen, in points from its top and bottom edges, the page's bar takes (0: none).
    // The map shrinks to the space between, its buttons with it, and the page shows and takes taps there.
    func setToolInsets(top: CGFloat, bottom: CGFloat) {
        if under { return }   // the tool's bar is on the page, over this map: nothing to make room for
        let h = view.bounds.height
        let t = max(0, min(top, h * 0.6)), b = max(0, min(bottom, h * 0.75))
        if t + b > h - 160 { return }        // no room left for a map: keep it as it is
        if abs(t - insetTop) < 1 && abs(b - insetBottom) < 1 { return }
        insetTop = t; insetBottom = b
        toolOpen = t > 0 || b > 0
        if toolOpen { showWeb?(true) }
        view.backgroundColor = toolOpen ? .clear : threeD ? TrailMapScreen.sky : TrailMapScreen.paper
        layoutArea()
        UIView.animate(withDuration: 0.2, animations: { self.view.layoutIfNeeded() }) { _ in
            if !self.toolOpen && !self.left && !self.aside { self.showWeb?(false) }
        }
    }
    // A dialog of the page's over everything (the trip terms before a first plan, a Save box): this screen hides and
    // lets every touch through until it's answered, then comes back as it was.
    func stepAside(_ on: Bool) {
        if on { layersAsked = false }
        if under { return }   // the page's dialog is over this map already
        if aside == on { return }
        aside = on
        if on { showWeb?(true) }
        UIView.animate(withDuration: 0.2, animations: { self.view.alpha = on ? 0 : 1 }) { _ in
            self.view.isHidden = self.aside
            if !self.aside && !self.toolOpen && !self.left { self.showWeb?(false) }
        }
        if !on { view.isHidden = false }
    }
    private(set) var aside = false
    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        layoutArea()
    }
    private func layoutArea() {
        let s = view.safeAreaInsets
        mapTop?.constant = insetTop
        mapBottom?.constant = -insetBottom
        // Under the page: this map's own labels and cards go between the page's rows of buttons.
        let t = under ? uiTop : insetTop, b = under ? uiBottom : insetBottom
        areaTop?.constant = max(0, t - s.top)
        areaBottom?.constant = -max(0, b - s.bottom)
    }
    // How the map follows you: "follow" (centred on you), "heading" (also turned the way the phone points, Compass)
    // or "none".
    func followUser(_ how: String) {
        if how != "none" { endTilt() }
        switch how {
        case "heading": map.setUserTrackingMode(.followWithHeading, animated: true, completionHandler: nil)
        case "follow": map.setUserTrackingMode(.follow, animated: true, completionHandler: nil)
        default: if map.userTrackingMode != .none { map.userTrackingMode = .none }
        }
    }
    func hideCard() { showCard(nil) }

    private func camera() -> [String: Any] {
        let c = map.centerCoordinate
        return ["lat": c.latitude, "lon": c.longitude, "zoom": map.zoomLevel, "bearing": map.direction]
    }

    // ---------- the map styles ----------
    private func styleURL(_ key: String) -> URL? {
        if key == "vector" { return URL(string: "https://tiles.openfreemap.org/styles/liberty") }
        if threeD { return save(TrailMapScreen.style3D(key, esri: esri, fr: fr), key + "-3d") }
        let osm = "© OpenStreetMap contributors"
        let (tiles, maxzoom, credit): ([String], Int, String) = {
            switch key {
            case "topo": return (["a", "b", "c"].map { "https://\($0).tile.opentopomap.org/{z}/{x}/{y}.png" }, 17, osm + ", SRTM | © OpenTopoMap")
            case "sat": return ([esri ?? TrailMapScreen.keylessEsri], 19, TrailMapScreen.esriCredit)
            default: return (["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], 19, osm)
            }
        }()
        let sources: [String: Any] = ["base": ["type": "raster", "tiles": tiles, "tileSize": 256, "maxzoom": maxzoom, "attribution": credit]]
        let style: [String: Any] = [
            "version": 8,
            "sources": sources,
            "layers": [["id": "background", "type": "background", "paint": ["background-color": "#f2efe7"]],
                       ["id": "base", "type": "raster", "source": "base"]]
        ]
        return save(style, key)
    }
    private func save(_ style: [String: Any], _ name: String) -> URL? {
        guard let data = try? JSONSerialization.data(withJSONObject: style) else { return nil }
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("trail-map-\(name).json")
        do { try data.write(to: file, options: .atomic) } catch { return nil }
        return file
    }
    // A new style has no trails: they're added again on top of it.
    func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
        styleReady = true
        dashLayers = []
        let lines = MLNShapeSource(identifier: "tf-lines", shape: lineShape, options: nil)
        let dots = MLNShapeSource(identifier: "tf-dots", shape: dotShape, options: nil)
        style.addSource(lines)
        style.addSource(dots)
        if threeD {
            // The ground is draped over the heights (a little taller than life, like the web 3D map).
            style.terrainSourceIdentifier = "dem"
            style.terrainExaggeration = 1.15
        }
        // In 3D the trails go just under the place names (NativeBaseStyles.swift), so names stay readable over them.
        let names = style.layer(withIdentifier: TrailMapScreen.firstNameLayer)
        let put = { (l: MLNStyleLayer) in if let n = names { style.insertLayer(l, below: n) } else { style.addLayer(l) } }
        put(lineLayer(id: "tf-line", source: lines, dash: ""))
        let dot = MLNCircleStyleLayer(identifier: "tf-dots", source: dots)
        dot.circleRadius = NSExpression(forKeyPath: "r")
        dot.circleColor = NSExpression(forKeyPath: "f")
        dot.circleOpacity = NSExpression(forKeyPath: "fo")
        dot.circleStrokeColor = NSExpression(forKeyPath: "c")
        dot.circleStrokeWidth = NSExpression(forKeyPath: "w")
        put(dot)
        if threeD {
            // Trail and route names along their lines, in the line's colour (the web 3D map's trail-names), from the
            // same zoom; MapLibre leaves out names that would overlap.
            let label = MLNSymbolStyleLayer(identifier: "tf-names", source: lines)
            // lb: the line's own label only (native-map.js), never a tooltip like "Unnamed trail".
            label.predicate = NSPredicate(format: "lb != nil AND lb != ''")
            label.minimumZoomLevel = 12
            label.text = NSExpression(forKeyPath: "lb")
            label.textOpacity = NSExpression(forKeyPath: "o")
            label.textFontNames = NSExpression(forConstantValue: ["Noto Sans Bold"])
            label.symbolPlacement = NSExpression(forConstantValue: "line")
            label.textFontSize = NSExpression(format: "mgl_interpolate:withCurveType:parameters:stops:($zoomLevel, 'linear', nil, %@)",
                                              [12: 11.5, 15: 13.5])
            label.textColor = NSExpression(forKeyPath: "c")
            label.textHaloColor = NSExpression(forConstantValue: UIColor.white)
            label.textHaloWidth = NSExpression(forConstantValue: 1.8)
            put(label)
        }
        addDashLayers()
        features.forEach { $0.added(to: style, screen: self) }
    }
    // 3D opens flat where the flat map was, then tilts in (as the web 3D map does), once it shows (open()).
    // Only the tilt changes: the middle of the map, its zoom and its heading stay exactly as on the flat map (alex
    // 2026-11-21: "Why it doesn't stay the same for 2d and 3d?"). A tilted MLNMapCamera, by its height or by its
    // distance, still flew out to the far mountains on the 3D ground (alex's recording 2026-11-21, after #878), so the tilt is stepped
    // frame by frame here and the same middle and zoom are set again at each step (as NativeFlyover sets its zoom).
    // A finger on the map, a Flyover, a search or the Me button stops it where it is; a camera set some other way
    // during those 1.2 s should call endTilt() first.
    private var tiltLink: CADisplayLink?
    private var tiltFrom: (at: CFTimeInterval, pitch: CGFloat, center: CLLocationCoordinate2D, zoom: Double, heading: CLLocationDirection)?
    func tiltIn() {
        guard threeD, !tilted, !left else { return }
        tilted = true
        // Following you (Record, Compass): the middle is yours, so only the tilt is eased, as before.
        if map.userTrackingMode != .none {
            let now = map.camera
            let cam = MLNMapCamera(lookingAtCenter: now.centerCoordinate, fromDistance: now.viewingDistance, pitch: TrailMapScreen.tilt, heading: now.heading)
            map.setCamera(cam, withDuration: 1.2, animationTimingFunction: CAMediaTimingFunction(name: .easeInEaseOut))
            return
        }
        tiltFrom = (CACurrentMediaTime(), map.camera.pitch, map.centerCoordinate, map.zoomLevel, map.direction)
        let link = CADisplayLink(target: TiltStep(self), selector: #selector(TiltStep.step))
        if #available(iOS 15.0, *) { link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60) }
        link.add(to: .main, forMode: .common)
        tiltLink = link
    }
    private var stepping = false
    // Stops the tilt where it is (a Flyover or a search setting the camera itself; a finger on the map).
    // A feature that sets the camera itself as the screen opens (a Flyover): no tilt in at all, now or later.
    func noTiltIn() { tilted = true; endTilt() }
    func endTilt() {
        guard tiltLink != nil else { return }
        tiltLink?.invalidate(); tiltLink = nil; tiltFrom = nil
        if !left { onEvent?("moved", camera()) }   // the page's flat map follows once, where the tilt ended
    }
    func mapView(_ mapView: MLNMapView, regionWillChangeWith reason: MLNCameraChangeReason, animated: Bool) {
        let finger = !reason.isDisjoint(with: TrailMapScreen.byFinger)
        if finger { fingerMoving = true; fingerMovedAt = CACurrentMediaTime() }
        if tiltLink != nil && !stepping && finger { endTilt() }
    }
    // A move by finger, going on or just ended: a tap then is part of moving the map (a short drag also read as a tap,
    // a touch that stops a fling), not a tap on what's there (alex 2026-11-22: "When you navigate on the map often the
    // page pops up").
    private var fingerMoving = false, fingerMovedAt: CFTimeInterval = 0
    private var justMoved: Bool { fingerMoving || CACurrentMediaTime() - fingerMovedAt < 0.3 }
    private static let byFinger: MLNCameraChangeReason = [.gesturePan, .gesturePinch, .gestureRotate, .gestureZoomIn,
                                                          .gestureZoomOut, .gestureOneFingerZoom, .gestureTilt]
    fileprivate func tiltStep() {
        guard let f = tiltFrom, !left else { endTilt(); return }
        let t = min(1, (CACurrentMediaTime() - f.at) / 1.2)
        let e = t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2   // ease in and out
        let cam = map.camera
        cam.pitch = f.pitch + (TrailMapScreen.tilt - f.pitch) * CGFloat(e)
        stepping = true
        map.setCamera(cam, animated: false)
        map.setCenter(f.center, zoomLevel: f.zoom, direction: f.heading, animated: false)   // keeps the new tilt
        stepping = false
        if t >= 1 { endTilt() }
    }
    func mapViewDidFinishRenderingMap(_ mapView: MLNMapView, fullyRendered: Bool) {
        guard fullyRendered, styleReady, !(waitWinter && base == "winter"), let ready = onReady else { return }
        onReady = nil
        ready()
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
    // In 3D, dotted lines ("0,x": approach and uphill routes, unofficial trails) are drawn as the web 3D map draws them
    // (map3d.js DOT_GROW, DOT_BAND): dots 1.3 times wider, on a dark see-through band that keeps them reading as one line
    // against the photos (thin dots all but vanished on the Winter photos). The band isn't tappable: the dots are.
    private static let dotGrow = 1.3, dotBand = 2.5
    private func addDashLayers() {
        guard let style = readyStyle, let src = style.source(withIdentifier: "tf-lines"), let dots = style.layer(withIdentifier: "tf-dots") else { return }
        for d in dashKeys where !d.isEmpty {
            let id = "tf-dash:" + d
            if dashLayers.contains(id) { continue }
            dashLayers.append(id)
            let l = lineLayer(id: id, source: src, dash: d)
            if threeD && d.hasPrefix("0,") {
                let band = MLNLineStyleLayer(identifier: "tf-band:" + d, source: src)
                band.predicate = l.predicate
                band.lineColor = NSExpression(forConstantValue: UIColor(red: 0.08, green: 0.13, blue: 0.10, alpha: 1))   // #14201a
                band.lineWidth = NSExpression(format: "w * %f + %f", TrailMapScreen.dotGrow, TrailMapScreen.dotBand)
                band.lineOpacity = NSExpression(format: "o * 0.55")
                band.lineCap = NSExpression(forConstantValue: "round")
                band.lineJoin = NSExpression(forConstantValue: "round")
                style.insertLayer(band, below: dots)
                l.lineWidth = NSExpression(format: "w * %f", TrailMapScreen.dotGrow)
            }
            style.insertLayer(l, below: dots)
        }
    }

    // ---------- the native 3D features (NativeLayers.swift) ----------
    func setLayer(_ key: String, _ data: String) {
        if key == "base" { setBase(data); return }
        if key == "layers" { layersAsked = false; return }   // the page opens its Layers over this screen (layersTapped)
        if key == "under" { applyUnder(data); return }
        guard let f = features.first(where: { $0.key == key }) else { return }
        f.setData(data, style: isViewLoaded && styleReady ? map.style : nil)
    }
    // The lowest trail layer: a feature drawn under the trails inserts its layers below this one.
    func trailsBottomLayer() -> MLNStyleLayer? { styleReady ? map.style?.layer(withIdentifier: "tf-line") : nil }
    // The style a feature may change now: the one showing, once it has loaded (nil while a new one loads).
    var readyStyle: MLNStyle? { isViewLoaded && styleReady ? map.style : nil }
    var mapLibreView: MLNMapView { map }
    // Where a feature's own labels and buttons go: the map's part of the screen, inside the safe area (it shrinks while a
    // tool's bar from the page is open, setToolInsets).
    var mapArea: UILayoutGuide { area }
    // A feature's own card: the same card as a trail's (name, colour, and a second line saying what it is), with Details
    // coming back to the page: "closed" then carries feature: key and open: the feature's own number, and the feature's
    // page side opens it there (window.tfNative.addLayer's onDetails).
    // details: false for a feature with nothing more to open (the card has no Details then).
    func showFeatureCard(name: String, sub: String? = nil, colour: String?, open: Int, at: CLLocationCoordinate2D, key: String? = nil, details: Bool = true) {
        cardDetails?.isHidden = !details
        picked = open
        pickedAt = at
        pickedFeature = key
        cardName.text = name
        cardSub.text = sub
        cardSub.isHidden = (sub ?? "").isEmpty
        cardSwatch.backgroundColor = TrailMapScreen.color(colour) ?? .gray
        card.isHidden = false
        // Under the page, a tapped webcam, pin or stop opens its page right away, with no small card first (alex
        // 2026-11-22: "We dont need to have that step... Just open the page"). One with no details keeps its card.
        if under && details { leave(details: true) }
    }
    // A feature's own button, top right across from Back (3D only; the weather captions sit under Back); added once, kept across style changes.
    func addToolButton(_ title: String, handler: @escaping () -> Void) {
        let b = pill(title, #selector(noop))
        b.removeTarget(self, action: #selector(noop), for: .touchUpInside)
        b.addAction(UIAction { _ in handler() }, for: .touchUpInside)
        toolStack.addArrangedSubview(b)
    }
    @objc private func noop() {}
    // Events from a feature to the page (its native-xxx.js listens with TrailMap.addListener).
    func send(_ name: String, _ data: [String: Any]) { if !left { onEvent?(name, data) } }
    // The camera flies to a box (a searched place), as the web 3D map looks at a search: a little less tilted.
    func fly(to sw: CLLocationCoordinate2D, _ ne: CLLocationCoordinate2D) {
        let bounds = MLNCoordinateBounds(sw: sw, ne: ne)
        let pad = UIEdgeInsets(top: 90, left: 30, bottom: 110, right: 30)
        let cam = map.cameraThatFitsCoordinateBounds(bounds, edgePadding: pad)
        if threeD { cam.pitch = 55 }
        endTilt()
        map.userTrackingMode = .none
        map.fly(to: cam, withDuration: 1.6, completionHandler: nil)
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
                guard let style = self.readyStyle else { return }
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
        if fingerMoving { fingerMoving = false; fingerMovedAt = CACurrentMediaTime() }
        if !left && tiltLink == nil { onEvent?("moved", camera()) }   // mid-tilt: once at its end (endTilt)
    }

    // A tap on a trail or a dot shows its card; a tap anywhere else closes it. Dots win: they sit on the trails.
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    @objc private func tapped(_ g: UITapGestureRecognizer) {
        guard g.state == .ended, !justMoved else { return }
        let p = g.location(in: map)
        let box = CGRect(x: p.x - 22, y: p.y - 22, width: 44, height: 44)
        pickedAt = map.convert(p, toCoordinateFrom: map)
        for f in features { f.tapBegan(screen: self) }
        // A tool that's on (planning, measuring, the compass's target) takes the tap first, with the trail under it.
        if features.contains(where: { $0.wantsTaps }) {
            let trails = Set(["tf-line"] + dashLayers)
            let trail = map.visibleFeatures(in: box, styleLayerIdentifiers: trails).compactMap { ($0.attribute(forKey: "i") as? NSNumber)?.intValue }.first ?? -1
            for f in features where f.wantsTaps { if f.mapTapped(pickedAt, trail: trail, screen: self) { return } }
        }
        // A feature's own layers first (icons sit over the trails).
        for f in features where !f.tapLayers.isEmpty {
            if let hit = map.visibleFeatures(in: box, styleLayerIdentifiers: Set(f.tapLayers)).first, f.tapped(hit, screen: self) { return }
        }
        let layers = Set(["tf-line", "tf-dots"] + dashLayers)
        let named = { (f: MLNFeature) -> Bool in f.attribute(forKey: "i") != nil || !((f.attribute(forKey: "n") as? String) ?? "").isEmpty }
        let found = map.visibleFeatures(in: box, styleLayerIdentifiers: layers).filter(named)
        // Beside every trail and dot: a feature's own card for that spot (a slope's avalanche card, NativeAvalanche).
        if found.isEmpty { for f in features where f.emptyTap(pickedAt, screen: self) { showCard(nil); return } }
        if under {
            // The page's own card, as a tap on its flat map there (or none: the page closes what it had open).
            showCard(nil)
            let f = found.first { $0 is MLNPointFeature } ?? found.first { $0.attribute(forKey: "i") != nil } ?? found.first
            let at = g.location(in: view)   // where on the screen (the page's CSS pixels): a popup of the page's opens there
            send("tap", ["open": (f?.attribute(forKey: "i") as? NSNumber)?.intValue ?? -1, "tapLat": pickedAt.latitude, "tapLon": pickedAt.longitude, "x": at.x, "y": at.y])
            return
        }
        showCard(found.first { $0 is MLNPointFeature } ?? found.first { $0.attribute(forKey: "i") != nil } ?? found.first)
    }
    private func showCard(_ f: MLNFeature?) {
        pickedFeature = nil
        cardSub.isHidden = true
        cardDetails?.isHidden = false
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

// The tilt's frame-by-frame step (TrailMapScreen.tiltIn). A display link holds its target strongly: this small
// object holds the screen weakly, so a screen that closes mid-tilt is let go.
private final class TiltStep: NSObject {
    private weak var screen: TrailMapScreen?
    init(_ s: TrailMapScreen) { screen = s }
    @objc func step(_ link: CADisplayLink) {
        guard let s = screen else { link.invalidate(); return }
        s.tiltStep()
    }
}
