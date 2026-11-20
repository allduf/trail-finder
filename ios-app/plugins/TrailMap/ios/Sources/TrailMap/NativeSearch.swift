import Foundation
import MapLibre
import UIKit

// Search a place from native 3D and fly there (alex 2026-11-20, native 3D parity step 2), as the page's search does on
// the web 3D map. A "Search" button under Back asks for a name (or a GPS point); the page (native-search.js) looks it up
// with its own place search (place-search.js: OpenStreetMap's Nominatim, Canada first) and sends back up to six places;
// picking one flies there, a little less tilted so the place fills the screen, and the page drops its red pin there,
// which comes back here with the other pins (NativePins.swift).
// Page -> here (key "search"): { "q": the words, "hits": [{ "name", "sub", "lat", "lon", "bb": [s, n, w, e] or null }],
// "error": "offline" when no answer came }. Here -> page: "search" { q } and "searchPick" { i }.
// At open the page sends { "labels": { English: the page's language } } for the words shown here (French, i18n).
final class NativeSearch: NativeLayer {
    let key = "search"
    private weak var screen: TrailMapScreen?
    private var button = false
    private var asked = ""
    private var hits: [[String: Any]] = []
    private var labels: [String: String] = [:]
    private func t(_ s: String) -> String { labels[s] ?? s }

    func added(to style: MLNStyle, screen: TrailMapScreen) {
        self.screen = screen
        if button { return }
        button = true
        screen.addToolButton(t("Search")) { [weak self] in self?.ask() }
    }

    private func ask() {
        guard let screen = screen else { return }
        let a = UIAlertController(title: t("Search a place"), message: t("A town, mountain, lake or region, or a GPS point"), preferredStyle: .alert)
        a.addTextField { t in
            t.placeholder = self.t("Place name")
            t.text = self.asked
            t.returnKeyType = .search
            t.clearButtonMode = .whileEditing
        }
        a.addAction(UIAlertAction(title: t("Cancel"), style: .cancel))
        a.addAction(UIAlertAction(title: t("Search"), style: .default) { [weak self, weak a] _ in
            let q = (a?.textFields?.first?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard let self = self, !q.isEmpty else { return }
            self.asked = q
            self.screen?.send("search", ["q": q])
        })
        screen.present(a, animated: true)
    }

    func setData(_ json: String, style: MLNStyle?) {
        guard let d = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return }
        if let l = o["labels"] as? [String: String] { labels = l; return }
        guard (o["q"] as? String) == asked else { return }   // an answer to an older search
        hits = (o["hits"] as? [[String: Any]]) ?? []
        show(error: o["error"] as? String)
    }

    private func show(error: String?) {
        guard let screen = screen, screen.presentedViewController == nil else { return }
        if hits.isEmpty {
            let msg = error == "offline" ? t("The search needs a connection.") : t("No place found.")
            let a = UIAlertController(title: asked, message: msg, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "OK", style: .cancel))
            screen.present(a, animated: true)
            return
        }
        let a = UIAlertController(title: asked, message: nil, preferredStyle: .actionSheet)
        for (i, h) in hits.enumerated() {
            let name = (h["name"] as? String) ?? t("Place"), sub = (h["sub"] as? String) ?? ""
            a.addAction(UIAlertAction(title: sub.isEmpty ? name : "\(name) · \(sub)", style: .default) { [weak self] _ in self?.go(i) })
        }
        a.addAction(UIAlertAction(title: t("Cancel"), style: .cancel))
        // iPad: the list comes from the Search button's corner.
        a.popoverPresentationController?.sourceView = screen.view
        a.popoverPresentationController?.sourceRect = CGRect(x: 60, y: 140, width: 1, height: 1)
        screen.present(a, animated: true)
    }

    private func go(_ i: Int) {
        guard i < hits.count, let screen = screen else { return }
        let h = hits[i]
        guard let lat = (h["lat"] as? NSNumber)?.doubleValue, let lon = (h["lon"] as? NSNumber)?.doubleValue else { return }
        // The place's outline when it has a real one, else a square around it (a peak or a point 2 km, as the page does).
        var s = lat - 0.009, n = lat + 0.009, w = lon - 0.014, e = lon + 0.014
        if let bb = h["bb"] as? [NSNumber], bb.count == 4, bb[1].doubleValue - bb[0].doubleValue > 0.004 || bb[3].doubleValue - bb[2].doubleValue > 0.004 {
            s = bb[0].doubleValue; n = bb[1].doubleValue; w = bb[2].doubleValue; e = bb[3].doubleValue
        }
        screen.fly(to: CLLocationCoordinate2D(latitude: s, longitude: w), CLLocationCoordinate2D(latitude: n, longitude: e))
        screen.send("searchPick", ["i": i])
    }
}
