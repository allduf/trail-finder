// Adventure moto in the iPhone's native 3D map (alex 2026-11-20, native 3D parity: every web feature on the phone,
// drawn by the iPhone). The same Moto layers the web 3D map draws (moto.js sync3d): the dirt roads coloured for your bike
// (OpenStreetMap through OpenFreeMap close in, our own far dirt-road tiles zoomed out, BC's forest roads from DataBC) and
// the stops (gas, campsites, BC rec sites, hot springs, shops, ferries) as dots. Routes, trips and day rides are lines on
// the flat map, so they already come with the trails (native-map.js). Drawn by NativeMoto.swift; tapping a stop shows its
// name there, and "Details" opens its card here. Only in Moto, only what's switched on in Layers, only in app builds
// with native 3D (alex only for now, like the rest of native 3D).
(() => {
  "use strict";
  const N = window.tfNative;
  if (!N || !N.addLayer) return;   // website, or an older cached native-map.js (an Android build without Moto gets nothing: native-map.js draws)
  const t = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);
  N.addLayer("moto", () => {
    const d = window.tfMoto && window.tfMoto.native3d ? window.tfMoto.native3d() : null;
    if (!d) return null;
    d.pts = d.pts.map((p) => [p[0], p[1], p[2], p[3], t(p[4])]);
    return JSON.stringify(d);
  });
  // moto.js sends the stops again (tfNative.send) whenever they change while the native map is open: the page's map
  // follows it out of sight, and new stops load there.
  if (N.onDetails) N.onDetails((e) => document.body.classList.contains("sport-moto") && !!window.tfMoto && !!window.tfMoto.openPointAt && window.tfMoto.openPointAt(e.tapLat, e.tapLon));
})();
