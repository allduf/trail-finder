// A ski tour's Flyover in native 3D (iPhone app only, alex only for now; native 3D parity step 3, alex 2026-11-20).
// Where the map's 3D button opens native 3D (native-map.js, "native for viewing"), Flyover on a tour's card
// (winter.js flyover) opens it at the tour's lower end and sends the tour here, once, under the key "flyover"; the
// iPhone flies it as the web 3D map does (ios-app/.../NativeFlyover.swift). Anywhere else the web 3D map flies it.
(() => {
  "use strict";
  const N = window.tfNative;
  if (!N || !N.addLayer || !N.view) return;
  const t = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);
  let next = null;
  N.addLayer("flyover", () => { const d = next; next = null; return d; });
  // pts: the tour's points ({ lat, lon, e }), title: its name. true when native 3D took it.
  window.tfNativeFly = (pts, title) => {
    if (!Array.isArray(pts) || pts.length < 2) return false;
    const p = pts.slice();
    if ((p[0].e || 0) > (p[p.length - 1].e || 0)) p.reverse();   // from the lower end, as on the web
    next = JSON.stringify({
      pts: p.map((q) => [Math.round(q.lon * 1e5) / 1e5, Math.round(q.lat * 1e5) / 1e5]),
      title: t("Flyover") + ": " + String(title || ""),
      stop: t("Stop"),
    });
    if (N.view({ lat: p[0].lat, lon: p[0].lon, zoom: 13 })) return true;
    next = null;
    return false;
  };
})();
