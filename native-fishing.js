// Fishing in the iPhone's native 3D (native-map.js, alex only for now; native 3D parity step 5, alex 2026-11-20: every
// web feature the same on the phone, in native 3D). The fishing dots and the zone outlines already go over with the
// trails; this sends the rest of what the web 3D map draws for Fishing (fishing.js tfFish.native3d): zone, park and
// boating-zone fills and names, the picked spot, the water colours, creeks from further away, Crown land and lake depth
// lines. NativeFishing.swift (ios-app/plugins/TrailMap) draws them. On the website, and in app builds without native
// 3D, this file does nothing.
(() => {
  "use strict";
  const N = window.tfNative;
  if (!N || !N.addLayer) return;   // the website, or an older cached native-map.js
  const PARTS = { fish: "main", "fish-creeks": "creeks", "fish-depth": "depth" };
  const get = (part) => (window.tfFish && window.tfFish.native3d ? window.tfFish.native3d(part) : null);
  const last = {};
  for (const [key, part] of Object.entries(PARTS)) N.addLayer(key, () => (last[key] = get(part)));
  // fishing.js fires tf:fishnative whenever what it draws changes (the hidden flat map follows the native one): once
  // it settles, only the parts that changed are sent again.
  let wait = 0;
  window.addEventListener("tf:fishnative", () => {
    if (!N.isOpen || !N.isOpen()) return;
    clearTimeout(wait);
    wait = setTimeout(() => {
      if (!N.isOpen()) return;
      for (const [key, part] of Object.entries(PARTS)) if (get(part) !== last[key]) N.send(key);
    }, 350);
  });
})();
