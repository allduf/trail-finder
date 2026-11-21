import Foundation
import MapLibre
import UIKit

// Ground layers in native 3D (step 6 of the native 3D plan, alex 2026-11-20): elevation lines, sun and shade, slope
// angle, slope direction, flats, elevation bands, new snow and the snow forecast (Skiing), Hunting's slope layers.
// The page paints these pictures already, for its own 3D map; here the map asks the page for the very same pictures
// (native-ground.js), so the colours, forecasts and estimates match the web exactly and live in one piece of code.
// The page sends under "ground":
//   - JSON { layers: [{ id, v, min, max, op, z, credit, keep }], keys: [{ t, c: [colours], l: [labels] }] }: the layers
//     that are on (drawn under the trails, lowest z first) and their colour keys;
//   - "T|<request>|<base64 PNG>": a picture asked for ("" when there's nothing there, "!" when it couldn't be painted
//     now, for example with no signal: MapLibre then asks again later).
// MapLibre loads a layer's tiles from a made-up address (GroundTiles.host); GroundTileProtocol answers those requests by
// asking the page ("groundTile" { r, id, z, x, y }) and handing back what it paints. Avalanche is never one of these.
final class NativeGround: NativeLayer {
    let key = "ground"
    private struct Item: Equatable {
        let id: String, v: String, min: Double, max: Double, op: Double, z: Double, credit: String, keep: Bool
        var sourceId: String { "tfg-" + id }
        var url: String { "https://\(GroundTiles.host)/\(id)/{z}/{x}/{y}.png?v=\(v)&k=\(keep ? 1 : 0)" }
    }
    private var items: [Item] = []
    private var onMap: [String: String] = [:]   // source id -> its tile address, on the style now
    private var keys: [(title: String, colours: [String], labels: [String])] = []
    private weak var screen: TrailMapScreen?
    private let keyBox = UIStackView()

    init() { GroundTiles.shared.start() }

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        self.screen = screen
        GroundTiles.shared.screen = screen
        onMap = [:]   // a new style has none of them
        apply(style)
        showKeys()
        screen.onEvent?("groundReady", [:])
    }

    func setData(_ text: String, style: MLNStyle?) {
        if text.hasPrefix("T|") { GroundTiles.shared.answer(text); return }
        guard let d = text.data(using: .utf8), let j = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { return }
        let num = { (v: Any?, d: Double) -> Double in (v as? NSNumber)?.doubleValue ?? d }
        items = ((j["layers"] as? [[String: Any]]) ?? []).compactMap { l in
            guard let id = l["id"] as? String, !id.isEmpty, id.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" }) else { return nil }
            let v = ((l["v"] as? String) ?? "0").filter { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" || $0 == "_" }
            return Item(id: id, v: v, min: num(l["min"], 0), max: num(l["max"], 14), op: num(l["op"], 1), z: num(l["z"], 0),
                        credit: (l["credit"] as? String) ?? "", keep: (l["keep"] as? Bool) ?? false)
        }.sorted { $0.z < $1.z }
        keys = ((j["keys"] as? [[String: Any]]) ?? []).map {
            (title: ($0["t"] as? String) ?? "", colours: ($0["c"] as? [String]) ?? [], labels: ($0["l"] as? [String]) ?? [])
        }
        if let style = style { apply(style) }
        showKeys()
    }

    // Each layer that's on, under the trails, in order; one whose address changed (a new version) is put back fresh.
    private func apply(_ style: MLNStyle) {
        let want = Dictionary(items.map { ($0.sourceId, $0.url) }, uniquingKeysWith: { a, _ in a })
        for (sid, url) in onMap where want[sid] != url {
            if let l = style.layer(withIdentifier: sid) { style.removeLayer(l) }
            if let s = style.source(withIdentifier: sid) { style.removeSource(s) }
            onMap[sid] = nil
        }
        for (n, it) in items.enumerated() where onMap[it.sourceId] == nil {
            var opts: [MLNTileSourceOption: Any] = [.minimumZoomLevel: it.min, .maximumZoomLevel: it.max, .tileSize: 256]
            if !it.credit.isEmpty { opts[.attributionHTMLString] = it.credit }
            let src = MLNRasterTileSource(identifier: it.sourceId, tileURLTemplates: [it.url], options: opts)
            style.addSource(src)
            let layer = MLNRasterStyleLayer(identifier: it.sourceId, source: src)
            layer.rasterOpacity = NSExpression(forConstantValue: it.op)
            layer.rasterFadeDuration = NSExpression(forConstantValue: 0)
            // Under the first of ours above it, else under the trails.
            let above = items[(n + 1)...].lazy.compactMap { self.onMap[$0.sourceId] != nil ? style.layer(withIdentifier: $0.sourceId) : nil }.first
            if let a = above { style.insertLayer(layer, below: a) }
            else if let c = NativeLayers.groundCeiling.lazy.compactMap({ style.layer(withIdentifier: $0) }).first { style.insertLayer(layer, below: c) }
            else if let t = screen?.trailsBottomLayer() { style.insertLayer(layer, below: t) }
            else { style.addLayer(layer) }
            onMap[it.sourceId] = it.url
        }
    }

    // ---------- the colour keys, top left (as on the web map), under the weather captions ----------
    private func showKeys() {
        guard let screen = screen, screen.isViewLoaded else { return }
        if keyBox.superview == nil {
            keyBox.axis = .vertical
            keyBox.spacing = 4
            keyBox.alignment = .leading
            keyBox.isUserInteractionEnabled = false
            keyBox.translatesAutoresizingMaskIntoConstraints = false
            screen.view.addSubview(keyBox)
            let g = screen.mapArea   // inside the map: clear of a tool's bar from the page (NativeTools.swift)
            NSLayoutConstraint.activate([
                keyBox.leadingAnchor.constraint(equalTo: g.leadingAnchor, constant: 12),
                keyBox.topAnchor.constraint(equalTo: g.topAnchor, constant: 148),   // under the radar and smoke captions (NativeWeather.swift rows 0-1)
                keyBox.widthAnchor.constraint(lessThanOrEqualToConstant: 230)
            ])
        }
        keyBox.arrangedSubviews.forEach { $0.removeFromSuperview() }
        for k in keys where !k.colours.isEmpty { keyBox.addArrangedSubview(bar(k.title, k.colours, k.labels)) }
        keyBox.isHidden = keyBox.arrangedSubviews.isEmpty
    }
    private func bar(_ title: String, _ colours: [String], _ labels: [String]) -> UIView {
        let box = UIView()
        box.backgroundColor = UIColor.white.withAlphaComponent(0.94)
        box.layer.cornerRadius = 8
        let t = UILabel()
        t.text = title
        t.font = .systemFont(ofSize: 11, weight: .semibold)
        t.textColor = UIColor(red: 0.11, green: 0.14, blue: 0.2, alpha: 1)
        t.numberOfLines = 2
        let cells = UIStackView()
        cells.axis = .horizontal
        cells.distribution = .fillEqually
        cells.spacing = 2
        for (i, c) in colours.enumerated() {
            let cell = UIStackView()
            cell.axis = .vertical
            cell.spacing = 1
            let sw = UIView()
            sw.backgroundColor = NativeGround.colour(c) ?? .gray
            sw.layer.cornerRadius = 2
            sw.heightAnchor.constraint(equalToConstant: 8).isActive = true
            let l = UILabel()
            l.text = i < labels.count ? labels[i] : ""
            l.font = .systemFont(ofSize: 9, weight: .medium)
            l.textColor = UIColor(red: 0.36, green: 0.4, blue: 0.46, alpha: 1)
            l.textAlignment = .center
            l.adjustsFontSizeToFitWidth = true
            l.minimumScaleFactor = 0.7
            cell.addArrangedSubview(sw)
            cell.addArrangedSubview(l)
            cells.addArrangedSubview(cell)
        }
        let col = UIStackView(arrangedSubviews: [t, cells])
        col.axis = .vertical
        col.spacing = 3
        col.translatesAutoresizingMaskIntoConstraints = false
        box.addSubview(col)
        NSLayoutConstraint.activate([
            col.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 8),
            col.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -8),
            col.topAnchor.constraint(equalTo: box.topAnchor, constant: 5),
            col.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -5),
            cells.widthAnchor.constraint(greaterThanOrEqualToConstant: CGFloat(min(colours.count, 8) * 24))
        ])
        return box
    }
    // "#rgb", "#rrggbb", "rgb(r, g, b)", "rgba(r, g, b, a)": the colours the page's keys use.
    static func colour(_ s: String) -> UIColor? {
        let v = s.trimmingCharacters(in: .whitespaces)
        if v.hasPrefix("#") {
            var h = String(v.dropFirst())
            if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
            guard h.count == 6, let n = UInt32(h, radix: 16) else { return nil }
            return UIColor(red: CGFloat((n >> 16) & 255) / 255, green: CGFloat((n >> 8) & 255) / 255, blue: CGFloat(n & 255) / 255, alpha: 1)
        }
        guard v.hasPrefix("rgb"), let a = v.firstIndex(of: "("), let b = v.firstIndex(of: ")") else { return nil }
        let p = v[v.index(after: a)..<b].split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        guard p.count >= 3 else { return nil }
        return UIColor(red: p[0] / 255, green: p[1] / 255, blue: p[2] / 255, alpha: p.count > 3 ? p[3] : 1)
    }
}

// The made-up address of the ground pictures, and the page's answers. MapLibre's downloads go through this object's
// URL session (MLNNetworkConfiguration's delegate), which knows GroundTileProtocol; every other address goes out as usual.
final class GroundTiles: NSObject, MLNNetworkConfigurationDelegate {
    static let shared = GroundTiles()
    static let host = "ground.trailfinder.invalid"
    weak var screen: TrailMapScreen?           // main thread only

    private let lock = NSLock()
    private var nextRequest = 0
    private var waiting: [Int: (Answer) -> Void] = [:]
    // Made once, before MapLibre can ask for it from its download threads.
    private let urlSession: URLSession
    enum Answer { case picture(Data), nothing, failed }

    private override init() {
        let c = (MLNNetworkConfiguration.sharedManager.sessionConfiguration.copy() as? URLSessionConfiguration) ?? .default
        c.protocolClasses = [GroundTileProtocol.self] + (c.protocolClasses ?? [])
        urlSession = URLSession(configuration: c)
        super.init()
    }

    func start() {
        let net = MLNNetworkConfiguration.sharedManager
        if net.delegate !== self { net.delegate = self }
    }
    // Called by MapLibre for each download, off the main thread.
    @objc(sessionForNetworkConfiguration:)
    func session(for configuration: MLNNetworkConfiguration) -> URLSession { urlSession }

    // A picture asked for: the page paints it. Failed when there's no page or no answer in 30 s (asked again later).
    func ask(_ id: String, _ z: Int, _ x: Int, _ y: Int, done: @escaping (Answer) -> Void) -> Int {
        lock.lock()
        nextRequest += 1
        let r = nextRequest
        waiting[r] = done
        lock.unlock()
        DispatchQueue.main.async {
            guard let send = self.screen?.onEvent else { self.finish(r, .failed); return }
            send("groundTile", ["r": r, "id": id, "z": z, "x": x, "y": y])
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 30) { self.finish(r, .failed) }
        return r
    }
    // MapLibre no longer needs it (it scrolled away, or the map closed).
    func cancel(_ r: Int) {
        lock.lock()
        let had = waiting.removeValue(forKey: r) != nil
        lock.unlock()
        if had { DispatchQueue.main.async { self.screen?.onEvent?("groundStop", ["r": r]) } }
    }
    // "T|<request>|<base64 PNG>" from the page; read off the main thread.
    func answer(_ text: String) {
        DispatchQueue.global(qos: .userInitiated).async {
            let parts = text.split(separator: "|", maxSplits: 2, omittingEmptySubsequences: false)
            guard parts.count == 3, let r = Int(parts[1]) else { return }
            let body = String(parts[2])
            if body.isEmpty { self.finish(r, .nothing); return }
            guard body != "!", let d = Data(base64Encoded: body) else { self.finish(r, .failed); return }
            self.finish(r, .picture(d))
        }
    }
    private func finish(_ r: Int, _ a: Answer) {
        lock.lock()
        let done = waiting.removeValue(forKey: r)
        lock.unlock()
        done?(a)
    }
}

// Answers MapLibre's requests for GroundTiles.host: "/<layer id>/<z>/<x>/<y>.png?v=<version>&k=<1: keep a day>".
final class GroundTileProtocol: URLProtocol {
    private var asked = 0
    private var thread: Thread?
    private var modes: [String] = [RunLoop.Mode.default.rawValue]
    private var stopped = false

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == GroundTiles.host }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        thread = Thread.current
        if let m = RunLoop.current.currentMode { modes = [m.rawValue] }
        let p = (request.url?.path ?? "").split(separator: "/").map(String.init)
        guard p.count == 4, let z = Int(p[1]), let x = Int(p[2]), let y = Int(p[3].replacingOccurrences(of: ".png", with: "")) else {
            reply(.nothing)
            return
        }
        asked = GroundTiles.shared.ask(p[0], z, x, y) { [weak self] a in self?.reply(a) }
    }
    override func stopLoading() {
        stopped = true
        if asked > 0 { GroundTiles.shared.cancel(asked) }
    }

    // Back on the thread that asked, as URLProtocol needs.
    private func reply(_ a: GroundTiles.Answer) {
        guard let t = thread else { return }
        let arg: Any
        switch a {
        case .picture(let d): arg = d as NSData
        case .nothing: arg = NSNull()
        case .failed: arg = NSNumber(value: 0)
        }
        perform(#selector(deliver(_:)), on: t, with: arg, waitUntilDone: false, modes: modes)
    }
    @objc private func deliver(_ arg: Any?) {
        guard !stopped, let url = request.url else { return }
        // Couldn't be painted now (no signal, no answer): an error, so MapLibre asks again later.
        if arg is NSNumber {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotLoadFromNetwork))
            return
        }
        let data = arg as? NSData
        // A picture: kept a day when it only depends on the terrain; nothing there: a real "not found" (MapLibre doesn't
        // retry that, and the map shows the ground under it), never kept.
        let keep = data != nil && url.query?.contains("k=1") == true
        let headers = ["Content-Type": "image/png", "Cache-Control": keep ? "max-age=86400" : "no-cache"]
        let res = HTTPURLResponse(url: url, statusCode: data == nil ? 404 : 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: res, cacheStoragePolicy: .notAllowed)
        if let d = data { client?.urlProtocol(self, didLoad: d as Data) }
        client?.urlProtocolDidFinishLoading(self)
    }
}
