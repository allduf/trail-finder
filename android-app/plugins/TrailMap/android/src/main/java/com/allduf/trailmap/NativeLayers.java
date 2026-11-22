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
        NativeAvalanche::new,                  // NativeAvalanche.java: the avalanche card (its colours come through NativeGround)
        NativeFingers::new,                    // NativeFingers.java: two-finger measure
        NativeFishing::new,                    // NativeFishing.java: Fishing fills, names, spot, water, Crown land, depth pictures
        NativeFishing.Creeks::new,             // NativeFishing.java: Fishing creeks from further away
        NativeFishing.Depth::new,              // NativeFishing.java: Fishing lake depth lines and soundings
        NativeFlat::new,                       // NativeFlat.java: the one map on Winter (opens flat, tips to 3D and back)
        NativeFlyover::new,                    // NativeFlyover.java: a ski tour's Flyover
        NativeGround::new,                     // NativeGround.java: ground layers the page paints (slope, sun, snow, avalanche colours...)
        NativeHunting::new,                    // NativeHunting.java: Hunting fills, zone names, cone, rings, glassing, pictures
        NativeMoto::new,                       // NativeMoto.java: Adventure moto dirt roads and stops
        NativeOffline::new,                    // NativeOffline.java: the saved map with no signal, and the saved areas
        () -> new NativeOverlay("radar", 0),   // NativeOverlay.java: rain and snow radar and forecast
        () -> new NativeOverlay("smoke", 1),   // NativeOverlay.java: wildfire smoke forecast
        NativePins::new,                       // NativePins.java: the map's tap pins (webcams, huts, parking, saved spots...)
        NativeSearch::new,                     // NativeSearch.java: search a place and fly there
        NativeTools::new,                      // NativeTools.java: the page's map tools (plan, record, compass, measure)
        NativeUnder::new                       // NativeUnder.java: the page's own buttons over native 3D (this build can)
    );

    static List<NativeLayer> make() {
        List<NativeLayer> out = new ArrayList<>();
        for (Supplier<NativeLayer> s : ALL) out.add(s.get());
        return out;
    }
}
