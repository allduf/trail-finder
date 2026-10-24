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
@objc(TrailGpsPlugin)
public class TrailGpsPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate, AVSpeechSynthesizerDelegate {
    public let identifier = "TrailGpsPlugin"
    public let jsName = "TrailGps"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fixes", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cues", returnType: CAPPluginReturnPromise)
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
                self.begin()
                call.resolve(["running": true])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.halt()
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
        if status == .notDetermined || waiting.isEmpty { return }
        let calls = waiting
        waiting = []
        if status == .denied || status == .restricted {
            calls.forEach { $0.reject("Location is turned off for Trail Finder", "DENIED") }
            return
        }
        begin()
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
            keep(fix)
            notifyListeners("fix", data: fix)
            cueAt(l)
        }
    }

    public func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        guard let e = error as? CLError, e.code == .denied else { return }   // .locationUnknown: still looking
        halt()
        notifyListeners("error", data: ["code": "DENIED"])
    }
}
