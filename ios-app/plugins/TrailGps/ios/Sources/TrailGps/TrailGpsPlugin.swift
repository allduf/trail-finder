import AVFoundation
import Capacitor
import CoreLocation
import Foundation
import UIKit

// The iPhone app's own GPS for recording rides (the website reaches it through native-gps.js).
// Unlike the web page's GPS it keeps going with the phone locked or the app in the background
// (UIBackgroundModes "location" in the app's Info.plist; iOS shows the blue location pill meanwhile).
// Every fix is also written to a file, so the page can fetch the ones it missed while iOS held it
// asleep, reloaded it, or the app was closed mid-ride.
// Spoken directions (navigate.js): speak(text) says it over the music (which dips meanwhile), and
// cues(list) hands over a planned ride's turns ([lat, lon, metres, text]) so they are still spoken
// with the phone locked, when the page itself is asleep: each one once, when a fix comes that close.
// Speaking in the background needs UIBackgroundModes "audio" in the app's Info.plist.
// Live location (live.js): live(config) sends where the phone is to the live location server every 20 s, from here,
// so it keeps going with the phone locked, ride or no ride. live({ grp: "" }) stops it. While only sharing (not
// recording a ride) the GPS asks for less (10 m), to save battery.
@objc(TrailGpsPlugin)
public class TrailGpsPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate, AVSpeechSynthesizerDelegate {
    public let identifier = "TrailGpsPlugin"
    public let jsName = "TrailGps"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fixes", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cues", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "live", returnType: CAPPluginReturnPromise)
    ]

    private static let keepMs: Double = 12 * 3600 * 1000   // older fixes left in the file are from a ride long over

    private var manager: CLLocationManager?
    private var running = false
    private var waiting: [CAPPluginCall] = []              // start calls waiting for the permission answer
    private var saved: [[String: Any]] = []
    private var file: FileHandle?
    private let voice = AVSpeechSynthesizer()
    private var cueList: [(lat: Double, lon: Double, r: Double, text: String)] = []
    private var cueNext = 0                                 // cues come in riding order: the next one to say
    private var recording = false                           // a ride is recording (start ... stop)
    private var liveCfg: [String: Any]?                     // live location: where and as whom to send, or nil
    private var liveSent: Double = 0                        // when the last one went (ms)
    private var liveBusy = false

    private var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("ride-fixes.jsonl")
    }

    override public func load() {
        DispatchQueue.main.async {
            guard let text = try? String(contentsOf: self.fileURL, encoding: .utf8) else { return }
            let since = Date().timeIntervalSince1970 * 1000 - TrailGpsPlugin.keepMs
            self.saved = text.split(separator: "\n").compactMap { line in
                guard let fix = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
                      (fix["time"] as? Double ?? 0) > since else { return nil }
                return fix
            }
            if self.saved.isEmpty { try? FileManager.default.removeItem(at: self.fileURL) }
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let m = self.manager ?? self.makeManager()
            switch m.authorizationStatus {
            case .notDetermined:
                self.waiting.append(call)
                m.requestWhenInUseAuthorization()
            case .denied, .restricted:
                call.reject("Location is turned off for Trail Finder", "DENIED")
            default:
                self.recording = true
                self.begin()
                self.tune()
                call.resolve(["running": true])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.recording = false
            if self.liveCfg == nil { self.halt() } else { self.cueList = []; self.cueNext = 0; self.tune() }
            self.saved = []
            try? self.file?.close()
            self.file = nil
            try? FileManager.default.removeItem(at: self.fileURL)
            call.resolve()
        }
    }

    // The fixes kept since `after` (ms since 1970), oldest first.
    @objc func fixes(_ call: CAPPluginCall) {
        let after = call.getDouble("after") ?? 0
        DispatchQueue.main.async {
            call.resolve([
                "fixes": self.saved.filter { ($0["time"] as? Double ?? 0) > after },
                "running": self.running
            ])
        }
    }

    @objc func speak(_ call: CAPPluginCall) {
        let text = call.getString("text") ?? ""
        DispatchQueue.main.async {
            if !text.isEmpty { self.say(text) }
            call.resolve()
        }
    }

    // A planned ride's turns, for when the phone is locked. An empty list clears them.
    @objc func cues(_ call: CAPPluginCall) {
        let list = call.getArray("list") ?? []
        DispatchQueue.main.async {
            self.cueList = list.compactMap { item in
                guard let a = item as? [Any], a.count >= 4,
                      let lat = (a[0] as? NSNumber)?.doubleValue, let lon = (a[1] as? NSNumber)?.doubleValue,
                      let r = (a[2] as? NSNumber)?.doubleValue, let text = a[3] as? String else { return nil }
                return (lat: lat, lon: lon, r: r, text: text)
            }
            self.cueNext = 0
            call.resolve(["count": self.cueList.count])
        }
    }

    // Live location on or off. On: the GPS starts (if it wasn't recording already) and each fix may be sent.
    @objc func live(_ call: CAPPluginCall) {
        let grp = call.getString("grp") ?? ""
        let cfg: [String: Any]? = grp.isEmpty ? nil : [
            "url": call.getString("url") ?? "", "key": call.getString("key") ?? "", "grp": grp,
            "id": call.getString("id") ?? "", "secret": call.getString("secret") ?? "",
            "name": call.getString("name") ?? "", "sport": call.getString("sport") ?? "",
            "due": call.getDouble("due") ?? 0, "until": call.getDouble("until") ?? 0
        ]
        DispatchQueue.main.async {
            self.liveCfg = cfg
            self.liveSent = 0
            if cfg == nil {
                if !self.recording { self.halt() } else { self.tune() }
                call.resolve(["live": false])
                return
            }
            let m = self.manager ?? self.makeManager()
            switch m.authorizationStatus {
            case .denied, .restricted:
                self.liveCfg = nil
                call.reject("Location is turned off for Trail Finder", "DENIED")
            case .notDetermined:
                m.requestWhenInUseAuthorization()   // the page's own GPS asks too; fixes start once allowed
                call.resolve(["live": true])
            default:
                self.begin()
                self.tune()
                call.resolve(["live": true])
            }
        }
    }

    // Full accuracy while recording; 10 m steps while only sharing.
    private func tune() {
        guard let m = manager else { return }
        m.desiredAccuracy = recording ? kCLLocationAccuracyBest : kCLLocationAccuracyNearestTenMeters
        m.distanceFilter = recording ? 2 : 10
    }

    private func sendLive(_ l: CLLocation) {
        guard let cfg = liveCfg, !liveBusy, let url = URL(string: cfg["url"] as? String ?? "") else { return }
        let now = Date().timeIntervalSince1970 * 1000
        let until = cfg["until"] as? Double ?? 0
        if until > 0 && now > until {
            liveCfg = nil
            if !recording { halt() }
            return
        }
        if now - liveSent < 20000 { return }
        let iso = ISO8601DateFormatter()
        let due = cfg["due"] as? Double ?? 0
        let body: [String: Any] = [
            "p_grp": cfg["grp"] ?? "", "p_id": cfg["id"] ?? "", "p_secret": cfg["secret"] ?? "",
            "p_name": cfg["name"] ?? "", "p_sport": cfg["sport"] ?? "",
            "p_lat": l.coordinate.latitude, "p_lon": l.coordinate.longitude,
            "p_acc": l.horizontalAccuracy, "p_speed": l.speed >= 0 ? l.speed as Any : NSNull(),
            "p_due": due > 0 ? iso.string(from: Date(timeIntervalSince1970: due / 1000)) as Any : NSNull(),
            "p_until": until > 0 ? iso.string(from: Date(timeIntervalSince1970: until / 1000)) as Any : NSNull()
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        var req = URLRequest(url: url, timeoutInterval: 15)
        req.httpMethod = "POST"
        req.httpBody = data
        let key = cfg["key"] as? String ?? ""
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(key, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        liveBusy = true
        liveSent = now
        URLSession.shared.dataTask(with: req) { _, res, _ in
            DispatchQueue.main.async {
                self.liveBusy = false
                // No signal: try again with the next fix after 5 s instead of 20
                if (res as? HTTPURLResponse)?.statusCode != 200 { self.liveSent = now - 15000 }
            }
        }.resume()
    }

    private func say(_ text: String) {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers])
        try? session.setActive(true)
        voice.delegate = self
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: "en-CA") ?? AVSpeechSynthesisVoice(language: "en-US")
        voice.speak(u)
    }

    public func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        if !s.isSpeaking { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }

    // With the app in the background (phone locked), the page can't speak: say the turns it handed over here.
    // Only the next few count, in order, so a ride that comes back past an earlier spot doesn't say a later turn there.
    private func cueAt(_ l: CLLocation) {
        if cueNext >= cueList.count || UIApplication.shared.applicationState == .active { return }
        for i in cueNext..<min(cueList.count, cueNext + 3) {
            let c = cueList[i]
            if l.distance(from: CLLocation(latitude: c.lat, longitude: c.lon)) <= c.r {
                cueNext = i + 1
                say(c.text)
                return
            }
        }
    }

    private func makeManager() -> CLLocationManager {
        let m = CLLocationManager()
        m.delegate = self
        m.desiredAccuracy = kCLLocationAccuracyBest
        m.distanceFilter = 2
        m.activityType = .fitness
        m.pausesLocationUpdatesAutomatically = false   // iOS would stop it for good during a long stop at the top
        manager = m
        return m
    }

    private func begin() {
        guard let m = manager, !running else { return }
        running = true
        m.allowsBackgroundLocationUpdates = true
        m.showsBackgroundLocationIndicator = true
        m.startUpdatingLocation()
    }

    private func halt() {
        cueList = []
        cueNext = 0
        guard let m = manager else { return }
        m.stopUpdatingLocation()
        m.allowsBackgroundLocationUpdates = false
        running = false
    }

    private func keep(_ fix: [String: Any]) {
        saved.append(fix)
        guard let data = try? JSONSerialization.data(withJSONObject: fix) else { return }
        if file == nil {
            let url = fileURL
            if !FileManager.default.fileExists(atPath: url.path) {
                FileManager.default.createFile(atPath: url.path, contents: nil)
            }
            file = try? FileHandle(forWritingTo: url)
            _ = try? file?.seekToEnd()
        }
        try? file?.write(contentsOf: data + Data("\n".utf8))
    }

    public func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        let status = m.authorizationStatus
        if status == .notDetermined { return }
        if waiting.isEmpty {   // asked for by live location only
            if liveCfg != nil && (status == .authorizedWhenInUse || status == .authorizedAlways) { begin(); tune() }
            return
        }
        let calls = waiting
        waiting = []
        if status == .denied || status == .restricted {
            calls.forEach { $0.reject("Location is turned off for Trail Finder", "DENIED") }
            return
        }
        recording = true
        begin()
        tune()
        calls.forEach { $0.resolve(["running": true]) }
    }

    public func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for l in locations where l.horizontalAccuracy >= 0 {
            var fix: [String: Any] = [
                "lat": l.coordinate.latitude,
                "lon": l.coordinate.longitude,
                "acc": l.horizontalAccuracy,
                "time": (l.timestamp.timeIntervalSince1970 * 1000).rounded()
            ]
            if l.verticalAccuracy >= 0 { fix["alt"] = l.altitude }
            if l.speed >= 0 { fix["speed"] = l.speed }
            if l.course >= 0 { fix["heading"] = l.course }
            if recording { keep(fix) }
            notifyListeners("fix", data: fix)
            cueAt(l)
        }
        if let l = locations.last(where: { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy < 100 }) { sendLive(l) }
    }

    public func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        guard let e = error as? CLError, e.code == .denied else { return }   // .locationUnknown: still looking
        halt()
        liveCfg = nil
        notifyListeners("error", data: ["code": "DENIED"])
    }
}
