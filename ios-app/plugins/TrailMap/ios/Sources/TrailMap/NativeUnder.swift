import Foundation
import MapLibre

// The page's own buttons over native 3D (alex 2026-11-22: "i want to keep the same interface for both i never want the
// map to switch from web to native map"): from this build on, native 3D opens UNDER the page, which keeps its own top
// buttons, Layers, bottom bar and cards on top, as on the flat map (TrailMapScreen.under, App/TFBridge.swift). This
// entry only tells the page this build can do it (TrailMap.features has "under"); the page's grid of where its buttons
// are comes as layer "under" and the screen itself takes it (TrailMapScreen.applyUnder), as it does "base".
final class NativeUnder: NativeLayer {
    let key = "under"
    func added(to style: MLNStyle, screen: TrailMapScreen) {}
    func setData(_ json: String, style: MLNStyle?) {}
}
