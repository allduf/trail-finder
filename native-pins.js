// The map's tap pins in native 3D (iPhone app only, alex only for now; native 3D parity step 2, alex 2026-11-20): the
// webcams, huts, parking, your saved spots, the searched place, tour starts, trailheads and every other pin the flat map
// shows with something behind a tap, sent to the native 3D screen (ios-app/.../NativePins.swift) with the trails.
// Each pin goes as a point with its name, what it is, a picture kind and its colour. Tapping one there shows the usual
// card; its Details comes back here and opens the pin's own card, the one a tap on the flat map opens (the live
// webcam, the hut's facts, the parking's card...), so every pin works as it does on the web without a second copy of
// its card. Nothing to do on the website or in Android (native-map.js makes tfNative only inside the iPhone app).
(() => {
  "use strict";
  const N = window.tfNative, map = window.tfLeaflet, L = window.L;
  if (!N || !N.addLayer || !N.send || !map || !L) return;
  const t = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);

  // Which pin is what, from its picture's class (the first that matches), with what the card says it is, how much it
  // matters when pins would overlap (map3d.js PIN_RANK) and its colour when the picture names none.
  const KINDS = [
    { re: /\bps-pin\b/, k: "search", s: "Searched place", r: 99, c: "#e0262b" },
    { re: /\bsp-pin\b/, k: "saved", s: "Saved spot", r: 90, c: "#2b8a3e" },
    { re: /\bsk-hutpin\b/, k: "hut", s: "Hut or cabin", r: 60, c: "#7a2e10" },
    { re: /\bsk-pin park\b/, k: "park", s: "Parking", r: 30, c: "#1f5fe0" },
    { re: /\bwc-pin bc\b/, k: "cam", s: "Webcam", r: 20, c: "#0b7285" },
    { re: /\bwc-pin road\b/, k: "cam", s: "Highway camera", r: 20, c: "#5c677d" },
    { re: /\bwc-pin\b/, k: "cam", s: "Webcam", r: 20, c: "#1c1c1e" },
    { re: /\bsk-pin\b[^>]*>\s*⛷/, k: "ski", s: "", r: 40, c: "#d9480f" },   // a ski tour start (winter.js)
  ];
  const textOf = (h) => { const d = document.createElement("div"); d.innerHTML = String(h || ""); return d.textContent.replace(/\s+/g, " ").trim(); };
  const colourIn = (h) => { const m = /background(?:-color)?:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/i.exec(h); return m ? m[1] : null; };

  let hits = [];   // the pins sent last, by number (the card's Details)
  const paneHidden = new Map();
  const hiddenPane = (o) => {
    const name = o.pane || "markerPane";
    if (!paneHidden.has(name)) { const el = map.getPane(name); paneHidden.set(name, !el || getComputedStyle(el).display === "none"); }
    return paneHidden.get(name);
  };
  function pins() {
    const out = [], near = map.getBounds().pad(2);
    hits = []; paneHidden.clear();
    map.eachLayer((l) => {
      if (!(l instanceof L.Marker) || !l.options.icon) return;
      const o = l.options;
      if (o.interactive === false || o.draggable || o.opacity === 0 || hiddenPane(o)) return;
      if (!(l.listens("click") || l.getPopup())) return;
      const at = l.getLatLng();
      if (!near.contains(at)) return;
      const io = o.icon.options || {}, h = io.html, html = (io.className || "") + " " + (h && h.outerHTML != null ? h.outerHTML : String(h || ""));
      const kind = KINDS.find((x) => x.re.test(html));
      let name = String(o.title || "").trim(), sub = kind ? t(kind.s) : "";
      if (kind && kind.k === "search") name = textOf((/class="ps-pin-tx">([^<]*)</.exec(html) || [])[1]) || name.replace(/\s*\(.*\)$/, "");
      if (!name) { const tip = l.getTooltip && l.getTooltip(); name = tip ? textOf(tip.getContent()) : ""; }
      // The rest keep their whole title as the name ("Trailhead: Lost Lake", "Oboe, north side: slackcountry, outside
      // ski patrol"): which side of the colon is the name differs from pin to pin.
      if (!name) name = textOf(h).slice(0, 40);
      const c = (kind && kind.k !== "ski" && kind.c) || colourIn(html) || (kind && kind.c) || "#1c1c1e";
      const k = kind ? kind.k : "pin";
      out.push({ type: "Feature", geometry: { type: "Point", coordinates: [Math.round(at.lng * 1e5) / 1e5, Math.round(at.lat * 1e5) / 1e5] },
        properties: { i: hits.length, n: name, s: sub, k, c, img: `tfpin:${k}:${c.toLowerCase()}`, r: -(kind ? kind.r : 10 + Math.min(9, (o.zIndexOffset || 0) / 100)) } });
      hits.push({ l, k });
    });
    return JSON.stringify({ type: "FeatureCollection", features: out });
  }

  // Details on a pin's card: its own card here, as a tap on it would open it. The searched place's pin has none (a tap
  // there takes it away), so the map just stays on the place.
  N.addLayer("pins", pins, (n, latlng) => {
    const h = hits[n];
    if (!h || h.k === "search" || !map.hasLayer(h.l)) return;
    h.l.fire("click", { latlng: h.l.getLatLng() || latlng });
  });

  // Sent again as pins come and go (each move redraws some) and as the map follows the native one, once it settles.
  let later = 0;
  const resend = (ms) => { if (!N.isOpen || !N.isOpen()) return; clearTimeout(later); later = setTimeout(() => N.send("pins"), ms); };
  map.on("layeradd layerremove", (e) => { if (e.layer instanceof L.Marker) resend(400); });
  map.on("moveend", () => resend(600));
})();
