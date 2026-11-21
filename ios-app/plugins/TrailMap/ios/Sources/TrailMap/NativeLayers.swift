import CoreLocation
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
//     and returns true when it showed its own card;
//   - a feature with wantsTaps true (a tool that's on: planning, measuring) is asked before all that with
//     mapTapped(_:trail:screen:): where the map was tapped and the trail there (its i on the page, -1 for none); true
//     when it took the tap;
//   - tapBegan(screen:) hears every tap on the map first (a feature's own card that a new tap should close), and
//     emptyTap(_:screen:) is asked for a tap that found no trail, dot or feature: true when it showed its own card there
//     (NativeAvalanche: that slope's avalanche card).
// Rules for every feature (CLAUDE.md): nothing slower than the build before (check-lag), nothing drawn while switched
// off, avalanche only exactly as Avalanche Canada gives it (avalanche-rules), and each sport's own wording.
protocol NativeLayer: AnyObject {
    var key: String { get }
    func added(to style: MLNStyle, screen: TrailMapScreen)
    func setData(_ json: String, style: MLNStyle?)
    var tapLayers: [String] { get }
    func tapped(_ feature: MLNFeature, screen: TrailMapScreen) -> Bool
    var wantsTaps: Bool { get }
    func mapTapped(_ at: CLLocationCoordinate2D, trail: Int, screen: TrailMapScreen) -> Bool
    func tapBegan(screen: TrailMapScreen)
    func emptyTap(_ at: CLLocationCoordinate2D, screen: TrailMapScreen) -> Bool
}

extension NativeLayer {
    var tapLayers: [String] { [] }
    func tapped(_ feature: MLNFeature, screen: TrailMapScreen) -> Bool { false }
    var wantsTaps: Bool { false }
    func mapTapped(_ at: CLLocationCoordinate2D, trail: Int, screen: TrailMapScreen) -> Bool { false }
    func tapBegan(screen: TrailMapScreen) {}
    func emptyTap(_ at: CLLocationCoordinate2D, screen: TrailMapScreen) -> Bool { false }
}

enum NativeLayers {
    // Layers a feature keeps over the ground pictures (NativeGround.swift puts its own under the first one there, else
    // under the trails): Hunting's lowest layer, so its pictures, fills and rings stay over slope and forest colours.
    static let groundCeiling = ["hn-bottom"]
    // One line per feature (keep in alphabetical order: parallel pull requests then add different lines).
    static let all: [() -> NativeLayer] = [
        { NativeAvalanche() },                     // NativeAvalanche.swift: the avalanche card (its colours come through NativeGround)
        { NativeFingers() },        // NativeFingers.swift: two-finger measure
        { NativeFishing() },        // NativeFishing.swift: Fishing fills, names, spot, water colours, Crown land, depth pictures
        { NativeFishCreeks() },     // NativeFishing.swift: creeks from further away
        { NativeFishDepth() },      // NativeFishing.swift: lake depth lines
        { NativeFlyover() },                        // NativeFlyover.swift: a ski tour's Flyover
        { NativeGround() },
        { NativeHunting() },
        { NativeMoto() },
        { NativeOffline() },
        { NativeOverlay(key: "radar", row: 0) },   // NativeWeather.swift: rain and snow radar and forecast
        { NativeOverlay(key: "smoke", row: 1) },   // NativeWeather.swift: wildfire smoke forecast
        { NativePins() },
        { NativeSearch() },
        { NativeTools() },
    ]
}
