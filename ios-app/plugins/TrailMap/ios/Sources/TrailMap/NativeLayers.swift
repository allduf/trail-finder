import Foundation
import MapLibre

// Native 3D features, one file each (alex 2026-11-20: native 3D becomes the main 3D on phones, built in parallel).
// A feature is a NativeLayer in its own NativeXxx.swift, listed once in NativeLayers.all below, with its page side in
// its own native-xxx.js (window.tfNative.addLayer). The screen (TrailMapPlugin.swift) knows nothing about any feature:
//   - after every style load (a new base map wipes everything), added(to:screen:) puts the feature's sources and layers
//     back, under the trails (insert below screen.trailsBottomLayer()) or over them;
//   - the page sends the feature's data as text under its key, at open and whenever it changes (TrailMap.layer({ key,
//     data })), and setData(_:style:) gets it, with the style when one is showing;
//   - tapLayers are the feature's layer ids a tap looks at; tapped(_:screen:) is asked first for a feature found there
//     and returns true when it showed its own card.
// Rules for every feature (CLAUDE.md): nothing slower than the build before (check-lag), nothing drawn while switched
// off, avalanche only exactly as Avalanche Canada gives it (avalanche-rules), and each sport's own wording.
protocol NativeLayer: AnyObject {
    var key: String { get }
    func added(to style: MLNStyle, screen: TrailMapScreen)
    func setData(_ json: String, style: MLNStyle?)
    var tapLayers: [String] { get }
    func tapped(_ feature: MLNFeature, screen: TrailMapScreen) -> Bool
}

extension NativeLayer {
    var tapLayers: [String] { [] }
    func tapped(_ feature: MLNFeature, screen: TrailMapScreen) -> Bool { false }
}

enum NativeLayers {
    // One line per feature (keep in alphabetical order: parallel pull requests then add different lines).
    static let all: [() -> NativeLayer] = [
        { NativeGround() },
    ]
}
