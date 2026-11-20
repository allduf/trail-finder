import Foundation
import MapLibre

// Skiing's Winter map in native 3D (alex 2026-11-20, on the Native 3D test: "can we have the Winter map like that?"):
// the same pictures as the web 3D map's Winter, straight from their sites. Bottom to top: last winter's far-view photos
// of all of Canada (zooms 3-10, about 80 m a pixel, enlarged closer in), last winter's 10 m photos around ski spots
// (zooms 6-14) and the AI-sharpened ones (zooms 11-15). The web map also paints the cloudy holes and adds finer close-ups
// in its own workers; here a hole shows the far-view photo under it instead.
// The photos are spread over many sites by zoom-11 square (Cloudflare Pages takes 20,000 files a site), and the site
// is worked out from the square (as tfWinterShard and sharpBase in map3d.js). MapLibre can only fill {z}/{x}/{y} into
// one address, so the style asks a made-up address (Self.host) and this object, as MapLibre's URL rewriter, turns it
// into the real one. Lists of squares (~55 KB) are loaded once, before the Winter style is shown.
final class WinterTiles: NSObject, MLNOfflineStorageDelegate {
    static let shared = WinterTiles()
    static let host = "winter.trailfinder.invalid"
    static let credit = "Winter: Copernicus Sentinel-2 data 2025-2026 (ESA), via AWS Open Data"
    private static let lists = [
        "https://trailfinder-w1-0.pages.dev/trail-finder-winter/blocks.json",
        "https://trailfinder-w2-0.pages.dev/trail-finder-winter2/blocks.json",
        "https://trailfinder-sharp-0.pages.dev/trail-finder-winter2/sharp.json",
        "https://trailfinderapp.ca/data/sharp-canada.json"
    ]
    private static let sharpRev = "?r=3"   // SHARP_REV in map3d.js: bump both when the sharpened squares are rebuilt

    private let lock = NSLock()
    private var have: [Int: Int] = [:]         // zoom-11 square (x * 4096 + y) -> 0 (first site) or 1 (second)
    private var some: [String: (Int, Int)] = [:]   // zoom 6-10 tile "z/x/y" -> how many squares under it on each site
    private var sharpWest: Set<Int> = []       // sharpened squares on trailfinder-sharp-0..9
    private var sharpCa: Set<Int> = []         // sharpened squares on trailfinder-sharpca-0..47
    private var loaded = false
    private var waiting: [(Bool) -> Void] = []

    var ready: Bool { lock.lock(); defer { lock.unlock() }; return loaded }

    // done(true) once the lists are in (on the main thread); done(false) when they couldn't come (offline).
    func load(_ done: @escaping (Bool) -> Void) {
        lock.lock()
        if loaded { lock.unlock(); DispatchQueue.main.async { done(true) }; return }
        waiting.append(done)
        let first = waiting.count == 1
        lock.unlock()
        if !first { return }
        MLNOfflineStorage.shared.delegate = self
        var got = [[[Int]]?](repeating: nil, count: Self.lists.count)
        let gotLock = NSLock(), group = DispatchGroup()
        for (i, s) in Self.lists.enumerated() {
            guard let u = URL(string: s) else { continue }
            group.enter()
            URLSession.shared.dataTask(with: u) { data, resp, _ in
                var list: [[Int]]?
                if let data = data, (resp as? HTTPURLResponse)?.statusCode == 200 {
                    list = (try? JSONSerialization.jsonObject(with: data)) as? [[Int]]
                    if list != nil, let f = Self.kept(i) { try? data.write(to: f, options: .atomic) }
                }
                // No signal: the copy from the last time (offline maps, NativeOffline.swift), so Winter still opens.
                if list == nil, let f = Self.kept(i), let d = try? Data(contentsOf: f) {
                    list = (try? JSONSerialization.jsonObject(with: d)) as? [[Int]]
                }
                gotLock.lock(); got[i] = list; gotLock.unlock()
                group.leave()
            }.resume()
        }
        group.notify(queue: .main) {
            // The two photo lists are needed; a missing sharpened list only leaves those photos out.
            let ok = got[0] != nil || got[1] != nil
            self.lock.lock()
            if ok {
                for (site, list) in [got[0] ?? [], got[1] ?? []].enumerated() {
                    for p in list where p.count == 2 {
                        let k = p[0] * 4096 + p[1]
                        if self.have[k] != nil { continue }
                        self.have[k] = site
                        for z in 6..<11 {
                            let t = "\(z)/\(p[0] >> (11 - z))/\(p[1] >> (11 - z))"
                            var n = self.some[t] ?? (0, 0)
                            if site == 0 { n.0 += 1 } else { n.1 += 1 }
                            self.some[t] = n
                        }
                    }
                }
                let west = (got[2] ?? []).filter { $0.count == 2 }.map { $0[0] * 4096 + $0[1] }
                self.sharpWest = Set(west)
                self.sharpCa = Set((got[3] ?? []).filter { $0.count == 2 }.map { $0[0] * 4096 + $0[1] }).subtracting(self.sharpWest)
                self.loaded = true
            }
            let calls = self.waiting
            self.waiting = []
            self.lock.unlock()
            calls.forEach { $0(ok) }
        }
    }

    // Where each list's last copy is kept on the phone.
    private static func kept(_ i: Int) -> URL? {
        guard let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?
            .appendingPathComponent("trail-map", isDirectory: true) else { return nil }
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("winter-list-\(i).json")
    }

    // MapLibre's URL rewriter (called off the main thread, for every download): only our made-up address is changed.
    func offlineStorage(_ storage: MLNOfflineStorage, urlForResourceOf kind: MLNResourceKind, with url: URL) -> URL {
        guard url.host == Self.host else { return url }
        let p = url.path.split(separator: "/").map(String.init)
        guard p.count == 4, let z = Int(p[1]), let x = Int(p[2]), let y = Int(p[3]) else { return Self.none }
        return real(p[0], z, x, y) ?? Self.none
    }
    // No photo there: a real "not found" (tiny, and MapLibre doesn't ask again), not the made-up address (that
    // would fail to connect, and MapLibre keeps retrying failed downloads).
    private static let none = URL(string: "https://trailfinder-w1-0.pages.dev/none.webp")!

    private func real(_ kind: String, _ z: Int, _ x: Int, _ y: Int) -> URL? {
        let bx = z >= 11 ? x >> (z - 11) : 0, by = z >= 11 ? y >> (z - 11) : 0, sq = bx * 4096 + by
        switch kind {
        case "wide":   // wideSite in map3d.js
            let k = z < 7 ? 0 : ((x >> (z - 7)) * 31 + (y >> (z - 7))) % 3
            return URL(string: "https://trailfinder-wide-\(k).pages.dev/trail-finder-wide/\(z)/\(x)/\(y).webp")
        case "w":      // winterSite + tfWinterShard in map3d.js
            lock.lock(); defer { lock.unlock() }
            var two = false
            if z >= 11 {
                guard let s = have[sq] else { return nil }
                two = s == 1
            } else {
                guard let n = some["\(z)/\(x)/\(y)"] else { return nil }
                two = n.1 > n.0
            }
            let k = z < 11 ? 0 : (bx * 31 + by) % (two ? 4 : 14)
            let site = two ? "trailfinder-w2-\(k).pages.dev/trail-finder-winter2" : "trailfinder-w1-\(k).pages.dev/trail-finder-winter"
            return URL(string: "https://\(site)/\(z)/\(x)/\(y).webp")
        case "s":      // sharpBase in map3d.js
            guard z >= 11 && z <= 15 else { return nil }
            lock.lock(); defer { lock.unlock() }
            let site: String
            if sharpCa.contains(sq) { site = "trailfinder-sharpca-\((bx * 31 + by) % 48)" }
            else if sharpWest.contains(sq) { site = "trailfinder-sharp-\((bx * 31 + by) % 10)" }
            else { return nil }
            return URL(string: "https://\(site).pages.dev/trail-finder-winter2/\(z)/\(x)/\(y).webp\(Self.sharpRev)")
        default: return nil
        }
    }
}
