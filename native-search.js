// Search a place from native 3D (iPhone app only, alex only for now; native 3D parity step 2, alex 2026-11-20). The
// native screen's Search button (ios-app/.../NativeSearch.swift) sends the words here; the page's own place search
// (place-search.js) looks them up and sends back up to six places; the one picked there is flown to, and here it gets
// the same red pin a search on the web drops, which goes back to the native screen with the other pins (native-pins.js).
(() => {
  "use strict";
  const N = window.tfNative;
  if (!N || !N.addLayer || !N.on || !N.send) return;
  const t = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);
  const WORDS = ["Search", "Search a place", "A town, mountain, lake or region, or a GPS point", "Place name", "Cancel",
    "The search needs a connection.", "No place found.", "Place", "OK"];
  let answer = null, hits = [], latest = "";
  // At open: the words shown on the native screen, in the page's language. After a search: its answer.
  N.addLayer("search", () => {
    if (answer) return answer;
    const labels = {};
    for (const w of WORDS) labels[w] = t(w);
    return JSON.stringify({ labels });
  });
  const reply = (o) => { answer = JSON.stringify(o); N.send("search"); answer = null; };
  N.on("search", async (e) => {
    const q = String(e.q || "").trim(), P = window.tfPlaceSearch;
    if (!q) return;
    latest = q;   // an older search answering late is dropped (here and on the native screen)
    if (!P || !P.search) { reply({ q, hits: [], error: "offline" }); return; }
    try {
      const found = (await P.search(q)) || [];
      if (q !== latest) return;
      hits = found;
      reply({ q, hits: hits.map((h) => ({ name: h.name, sub: h.sub || "", lat: h.lat, lon: h.lon, bb: h.bb || null })) });
    } catch { if (q === latest) { hits = []; reply({ q, hits: [], error: "offline" }); } }
  });
  // The place picked: its pin here (no moving the sheet; the map follows the native one).
  N.on("searchPick", (e) => {
    const h = hits[e.i | 0], P = window.tfPlaceSearch;
    if (h && P && P.go) try { P.go(h, { sheet: false }); } catch {}
  });
})();
