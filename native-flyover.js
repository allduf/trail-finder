// A ski tour's Flyover in native 3D (iPhone app only, alex only for now; native 3D parity step 3, alex 2026-11-20).
// Where the map's 3D button opens native 3D (native-map.js, "native for viewing"), Flyover on a tour's card
// (winter.js flyover) opens it at the tour's lower end and sends the tour here, once, under the key "flyover"; the
// iPhone flies it as the web 3D map does (ios-app/.../NativeFlyover.swift). Anywhere else the web 3D map flies it.
(() => {
  "use strict";
  const N = window.tfNative;
  if (!N || !N.addLayer || !N.view || !N.isOpen) return;
  const t = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);
  let next = null;
  N.addLayer("flyover", () => { const d = next; next = null; return d; });
  // pts: the tour's points ({ lat, lon, e }), title: its name. A promise of true when native 3D took it; false when
  // the web 3D map should fly it (not where native 3D opens, an app build without the native Flyover, or no screen).
  window.tfNativeFly = async (pts, title) => {
    if (!Array.isArray(pts) || pts.length < 2 || !N.has || !N.has("flyover")) return false;
    const p = pts.slice();
    if ((p[0].e || 0) > (p[p.length - 1].e || 0)) p.reverse();   // from the lower end, as on the web
    next = JSON.stringify({
      pts: p.map((q) => [Math.round(q.lon * 1e5) / 1e5, Math.round(q.lat * 1e5) / 1e5]),
      title: t("Flyover") + ": " + String(title || ""),
      stop: t("Stop"),
    });
    // The camera moves every second while flying: the trails along the way are sent every 2 s meanwhile, not every
    // move (the flight is 5 s a km, 15 to 50 s, as on the web; a touch can end it sooner).
    let km = 0;
    for (let i = 1; i < p.length; i++) km += Math.hypot((p[i].lon - p[i - 1].lon) * Math.cos((p[i].lat * Math.PI) / 180), p[i].lat - p[i - 1].lat) * 111.2;
    const ok = await N.view({ lat: p[0].lat, lon: p[0].lon, zoom: 13 }).catch(() => false);
    next = null;
    if (ok && N.moveWait) {
      N.moveWait(2000);
      setTimeout(() => { if (N.isOpen()) N.moveWait(500); }, (Math.max(15, Math.min(50, km * 5)) + 3) * 1000);
    }
    return !!ok;
  };
})();
