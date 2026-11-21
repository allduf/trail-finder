package com.allduf.trailmap;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;

// The native 3D features this Android build draws itself, one line each (keep in alphabetical order: parallel pull
// requests then add different lines). The page asks for their keys (TrailMap.features) and opens the web 3D map
// instead for anything not listed (native-map.js). The iPhone's list is in NativeLayers.swift; each feature comes here
// once its Android side is written.
final class NativeLayers {
    static final List<Supplier<NativeLayer>> ALL = List.of(
        NativeFingers::new,                    // NativeFingers.java: two-finger measure
        NativeFishing::new,                    // NativeFishing.java: Fishing fills, names, spot, water, Crown land, depth pictures
        NativeFishing.Creeks::new,             // NativeFishing.java: Fishing creeks from further away
        NativeFishing.Depth::new,              // NativeFishing.java: Fishing lake depth lines and soundings
        NativeFlyover::new,                    // NativeFlyover.java: a ski tour's Flyover
        NativeHunting::new,                    // NativeHunting.java: Hunting fills, zone names, cone, rings, glassing, pictures
        NativeMoto::new,                       // NativeMoto.java: Adventure moto dirt roads and stops
        () -> new NativeOverlay("radar", 0),   // NativeOverlay.java: rain and snow radar and forecast
        () -> new NativeOverlay("smoke", 1),   // NativeOverlay.java: wildfire smoke forecast
        NativePins::new,                       // NativePins.java: the map's tap pins (webcams, huts, parking, saved spots...)
        NativeSearch::new                      // NativeSearch.java: search a place and fly there
    );

    static List<NativeLayer> make() {
        List<NativeLayer> out = new ArrayList<>();
        for (Supplier<NativeLayer> s : ALL) out.add(s.get());
        return out;
    }
}
