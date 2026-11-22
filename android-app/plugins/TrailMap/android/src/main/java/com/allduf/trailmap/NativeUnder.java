package com.allduf.trailmap;

import org.maplibre.android.maps.Style;

// The page's own buttons over native 3D (alex 2026-11-22: "i want to keep the same interface for both i never want the
// map to switch from web to native map"): from this build on, native 3D opens UNDER the page, which keeps its own top
// buttons, Layers, bottom bar and cards on top, as on the flat map (TrailMapScreen under, TrailMapPlugin.open). This
// entry only tells the page this build can (TrailMap.features has "under"); the page's grid of where its buttons are
// comes as layer "under" and the screen itself takes it (TrailMapScreen.applyUnder), as it does "base". Same as the
// iPhone's NativeUnder.swift.
final class NativeUnder implements NativeLayer {
    @Override public String key() { return "under"; }
    @Override public void added(Style style, TrailMapScreen screen) {}
    @Override public void setData(String data, Style style) {}
}
