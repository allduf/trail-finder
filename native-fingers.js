// Two-finger measure in the iPhone's own 3D map (NativeFingers.swift; the web map's is finger-measure.js): the page
// only sends its words, in the page's language. On the website and in Android tfNative doesn't exist and this file does
// nothing.
(() => {
  "use strict";
  const N = window.tfNative;
  if (!N || !N.addLayer) return;
  const t = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);
  N.addLayer("fingers", () => JSON.stringify({ line: t("straight line") }));
})();
