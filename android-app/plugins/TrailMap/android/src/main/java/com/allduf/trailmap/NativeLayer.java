package com.allduf.trailmap;

import java.util.Collections;
import java.util.List;
import org.maplibre.android.geometry.LatLng;
import org.maplibre.android.maps.Style;
import org.maplibre.geojson.Feature;

// A native 3D feature, as NativeLayers.swift on the iPhone: one class in its own NativeXxx.java, listed once in
// NativeLayers.ALL, with its page side in its own native-xxx.js (window.tfNative.addLayer). The screen
// (TrailMapScreen.java) knows nothing about any feature:
//   - after every style load (a new base map wipes everything), added(style, screen) puts the feature's sources and
//     layers back, under the trails (style.addLayerBelow(l, screen.trailsBottomLayer())) or over them;
//   - the page sends the feature's data as text under its key, at open and whenever it changes, and setData(data, style)
//     gets it, with the style when one is showing (null otherwise);
//   - tapLayers() are the feature's layer ids a tap looks at; tapped(feature, screen) is asked first for a feature found
//     there and returns true when it showed its own card;
//   - a feature with wantsTaps() true (a tool that's on) is asked before all that with mapTapped(at, trail, screen).
// Rules for every feature (CLAUDE.md): nothing slower than the build before, nothing drawn while switched off, avalanche
// only exactly as Avalanche Canada gives it, and each sport's own wording.
interface NativeLayer {
    String key();
    void added(Style style, TrailMapScreen screen);
    void setData(String data, Style style);
    default List<String> tapLayers() { return Collections.emptyList(); }
    default boolean tapped(Feature f, TrailMapScreen screen) { return false; }
    default boolean wantsTaps() { return false; }
    default boolean mapTapped(LatLng at, int trail, TrailMapScreen screen) { return false; }
}
