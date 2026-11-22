import Foundation
import MapLibre

// One map on Winter (alex 2026-11-22: "What to do think about having just one map? ... the transition between the 2d
// map and 3d when you tilt is not smooth", then "Can we just do that with the winter map for now?"): from this build on,
// native 3D can open seen straight down under the page (open's flat: true) and tip up into 3D and back down in place
// (layer "under" with tilt: true / false, TrailMapScreen.pitchTo), so the page's 2D on Winter is this same map from
// above. This entry only tells the page this build can (TrailMap.features has "flat"). Same as Android's NativeFlat.java.
final class NativeFlat: NativeLayer {
    let key = "flat"
    func added(to style: MLNStyle, screen: TrailMapScreen) {}
    func setData(_ json: String, style: MLNStyle?) {}
}
