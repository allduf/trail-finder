import Foundation
import MapLibre

// MapLibre has one URL rewriter for the whole app (MLNOfflineStorage's delegate). Features whose tiles are spread over
// several sites (Winter photos, Moto's far dirt roads) give their style a made-up address and register its host here with
// the function that turns it into the real one. Called off the main thread, for every download; other addresses pass.
final class TileRewriter: NSObject, MLNOfflineStorageDelegate {
    static let shared = TileRewriter()
    private let lock = NSLock()
    private var hosts: [String: (URL) -> URL] = [:]

    static func add(host: String, _ rewrite: @escaping (URL) -> URL) {
        shared.lock.lock()
        shared.hosts[host] = rewrite
        shared.lock.unlock()
        if Thread.isMainThread { MLNOfflineStorage.shared.delegate = shared }
        else { DispatchQueue.main.async { MLNOfflineStorage.shared.delegate = shared } }
    }

    func offlineStorage(_ storage: MLNOfflineStorage, urlForResourceOf kind: MLNResourceKind, with url: URL) -> URL {
        guard let h = url.host else { return url }
        lock.lock()
        let f = hosts[h]
        lock.unlock()
        return f?(url) ?? url
    }
}
