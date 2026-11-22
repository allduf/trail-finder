package com.allduf.trailmap;

import org.maplibre.android.maps.Style;

// One map on Winter (alex 2026-11-22: "Can we just do that with the winter map for now?"): from this build on, native 3D
// can open seen straight down under the page (open's flat: true) and tip up into 3D and back down in place (layer
// "under" with tilt: true / false, TrailMapScreen.pitchTo), so the page's 2D on Winter is this same map from above. This
// entry only tells the page this build can (TrailMap.features has "flat"). Same as the iPhone's NativeFlat.swift.
final class NativeFlat implements NativeLayer {
    @Override public String key() { return "flat"; }
    @Override public void added(Style style, TrailMapScreen screen) {}
    @Override public void setData(String data, Style style) {}
}
