// The map's tap pins in native 3D (iPhone app only, alex only for now; native 3D parity step 2, alex 2026-11-20): the
// webcams, huts, parking, your saved spots, the searched place, tour starts, trailheads and every other pin the flat map
// shows with something behind a tap, sent to the native 3D screen (ios-app/.../NativePins.swift) with the trails.
// Each pin goes as a point with its name, what it is, a picture kind and its colour. Tapping one there shows the usual
// card; its Details comes back here and opens the pin's own card, the one a tap on the flat map opens (the live
// webcam, the hut's facts, the parking's card...), so every pin works as it does on the web without a second copy of
// its card. Nothing to do on the website (native-map.js makes tfNative only inside the phone apps); an Android build
// without native pins yet ignores them, and its 3D button keeps opening the web 3D map (native-map.js drawsAll).
(() => {
  "use strict";
  const N = window.tfNative, map = window.tfLeaflet, L = window.L;
  if (!N || !N.addLayer || !N.send || !map || !L) return;
  const t = (s) => (window.tfLang && window.tfLang.t ? window.tfLang.t(s) : s);

  // Which pin is what, from its picture's class (the first that matches), with what the card says it is, how much it
  // matters when pins would overlap (map3d.js PIN_RANK) and its colour when the picture names none.
  const KINDS = [
    { re: /\bps-pin\b/, k: "search", s: "Searched place", r: 99, c: "#e0262b" },
    { re: /\bsp-pin\b/, k: "saved", s: "Saved spot", r: 90, c: null },   // its sport's colour (ski-points.js), below
    { re: /\bsk-hutpin\b/, k: "hut", s: "Hut or cabin", r: 60, c: "#7a2e10" },
    { re: /\bsk-pin park\b/, k: "park", s: "Parking", r: 30, c: "#1f5fe0" },
    { re: /\bwc-pin bc\b/, k: "cam", s: "Webcam", r: 20, c: "#0b7285" },
    { re: /\bwc-pin road\b/, k: "cam", s: "Highway camera", r: 20, c: "#5c677d" },
    { re: /\bwc-pin\b/, k: "cam", s: "Webcam", r: 20, c: "#1c1c1e" },
    { re: /\bsk-pin\b[^>]*>\s*⛷/, k: "ski", s: "", r: 40, c: "#d9480f" },   // a ski tour start (winter.js)
  ];
  const textOf = (h) => { const d = document.createElement("div"); d.innerHTML = String(h || ""); return d.textContent.replace(/\s+/g, " ").trim(); };
  const savedColour = () => { const b = document.body.classList; return b.contains("sport-hunt") ? "#a34f00" : b.contains("sport-fish") ? "#0c8599" : "#0a7d6e"; };
  const colourIn = (h) => { const m = /background(?:-color)?:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/i.exec(h); return m ? m[1] : null; };

  // ---------- each pin's own picture (alex 2026-11-22, "What are those point?": the phone map drew every pin as the same
  // dark square with a map pin, so bike parks, jump parks and pump tracks looked alike, and the riding areas' names were
  // pins too) ----------
  // A pin's box (its colour, round or rounded, its white edge) and its line icon or letter, read off the flat map's own
  // pin and drawn once per look as a picture (2x): sent with the pin as pk (its name) and pic (the picture, on the first
  // pin with it in each send). A riding area's name (words on the flat map, no pin) goes as words only (t: 1, lb: the
  // words, tc: their colour, ts: their size). A pin with an emoji or longer words in its box keeps the app's own picture.
  // App builds before 2026-11-22 ignore pk, pic and t, and draw their own square, as before.
  const pics = new Map();   // look -> picture (base64 PNG), "" while it's being drawn, null if it couldn't be
  // Each pin's look is read once per drawing of its icon (moves send the pins again; reading styles each time is slow).
  let looks = new WeakMap();
  const clear = (c) => !c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c);
  const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  // The pin's box: the marker or one of its first children with a colour of its own.
  const boxOf = (el) => {
    const q = [el];
    for (let n = 0; n < q.length && n < 12; n++) {
      const e = q[n], cs = getComputedStyle(e);
      if (!clear(cs.backgroundColor) && e.offsetWidth >= 12) return e;
      q.push(...e.children);
    }
    return null;
  };
  function look(el) {
    const box = boxOf(el);
    if (!box) return null;
    const cs = getComputedStyle(box), w = box.offsetWidth, h = box.offsetHeight, br = parseFloat(cs.borderTopLeftRadius) || 0;
    const svg = box.querySelector("svg"), text = svg ? "" : box.textContent.replace(/\s+/g, "");
    if (!svg && !/^[A-Za-z0-9]{1,3}$/.test(text)) return null;   // an emoji or longer words: the app's own picture, as before
    const o = { bg: cs.backgroundColor, w, h, round: /%/.test(cs.borderTopLeftRadius) ? parseFloat(cs.borderTopLeftRadius) >= 50 : br >= Math.min(w, h) / 2 - 0.5, br,
      bw: parseFloat(cs.borderTopWidth) || 0, bc: cs.borderTopColor, fg: cs.color, font: cs.font, text,
      svg: svg ? svg.outerHTML : "", sw: svg ? svg.getBoundingClientRect().width || 16 : 0, sh: svg ? svg.getBoundingClientRect().height || 16 : 0 };
    o.key = "tfpic:" + hash(JSON.stringify(o));
    return o;
  }
  function draw(o) {
    pics.set(o.key, "");
    const S = 2, pad = 2, c = document.createElement("canvas");
    c.width = (o.w + pad * 2) * S; c.height = (o.h + pad * 2) * S;
    const g = c.getContext("2d");
    g.scale(S, S);
    const shape = () => {
      g.beginPath();
      if (o.round) g.ellipse(pad + o.w / 2, pad + o.h / 2, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
      else if (g.roundRect) g.roundRect(pad, pad, o.w, o.h, Math.min(o.br, o.w / 2));
      else g.rect(pad, pad, o.w, o.h);
    };
    shape(); g.fillStyle = o.bg; g.fill();
    if (o.bw > 0 && !clear(o.bc)) { shape(); g.save(); g.clip(); shape(); g.lineWidth = o.bw * 2; g.strokeStyle = o.bc; g.stroke(); g.restore(); }   // the edge, inside the box as in CSS
    // Sent again once drawn (never from inside pins() itself).
    const done = () => { try { pics.set(o.key, c.toDataURL("image/png").replace(/^data:image\/png;base64,/, "")); } catch { pics.set(o.key, null); } resend(300); };
    if (o.svg) {
      let src = o.svg.replace(/currentColor/g, o.fg).replace(/^<svg\b[^>]*>/, (t) => t.replace(/\s(?:width|height|color)="[^"]*"/g, ""));
      if (!/xmlns=/.test(src)) src = src.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
      src = src.replace(/^<svg/, `<svg width="${o.sw}" height="${o.sh}" color="${o.fg}"`);
      const img = new Image();
      img.onload = () => { g.drawImage(img, pad + (o.w - o.sw) / 2, pad + (o.h - o.sh) / 2, o.sw, o.sh); done(); };
      img.onerror = () => pics.set(o.key, null);
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src);
      return;
    }
    if (o.text) { g.font = o.font; g.fillStyle = o.fg; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(o.text, pad + o.w / 2, pad + o.h / 2 + 0.5); }
    setTimeout(done, 0);
  }

  let hits = [];   // the pins sent last, by number
  const paneHidden = new Map();
  const hiddenPane = (o) => {
    const name = o.pane || "markerPane";
    if (!paneHidden.has(name)) { const el = map.getPane(name); paneHidden.set(name, !el || getComputedStyle(el).display === "none"); }
    return paneHidden.get(name);
  };
  function pins() {
    const out = [], near = map.getBounds().pad(2), given = new Set();
    hits = []; paneHidden.clear();
    map.eachLayer((l) => {
      if (!tappable(l)) return;
      const o = l.options;
      // Moto's stops are drawn by their own native layer (NativeMoto.swift, native-moto.js).
      if (o.opacity === 0 || o.pane === "moto" || hiddenPane(o)) return;
      const at = l.getLatLng();
      if (!near.contains(at)) return;
      const io = o.icon.options || {}, h = io.html, html = (io.className || "") + " " + (h && h.outerHTML != null ? h.outerHTML : String(h || ""));
      const kind = KINDS.find((x) => x.re.test(html));
      let name = String(o.title || "").trim(), sub = kind ? t(kind.s) : "";
      if (kind && kind.k === "search") name = textOf((/class="ps-pin-tx">([^<]*)</.exec(html) || [])[1]) || name.replace(/\s*\(.*\)$/, "");
      if (!name) { const tip = l.getTooltip && l.getTooltip(); name = tip ? textOf(tip.getContent()) : ""; }
      // The rest keep their whole title as the name ("Trailhead: Lost Lake", "Oboe, north side: slackcountry, outside
      // ski patrol"): which side of the colon is the name differs from pin to pin.
      if (!name) name = textOf(h && h.outerHTML != null ? h.outerHTML : h).slice(0, 40) || t(kind && kind.s ? kind.s : "Pin");
      const c = (kind && kind.k === "saved" && savedColour()) || (kind && kind.k !== "ski" && kind.c) || colourIn(html) || (kind && kind.c) || "#1c1c1e";
      const k = kind ? kind.k : "pin";
      const props = { i: hits.length, n: name, s: sub, k, c, nd: k === "search" ? 1 : 0, img: `tfpin:${k}:${c.toLowerCase()}`, r: -(kind ? kind.r : 10 + Math.min(9, (o.zIndexOffset || 0) / 100)) };
      // Its own picture (above), or a name only.
      const el = l._icon;
      if (el && k !== "search") {
        let lk = null;
        const seen = looks.get(el), html = el.className + el.innerHTML;
        if (seen && seen.html === html) lk = seen.lk;
        else { try { lk = look(el); } catch {} looks.set(el, { html, lk }); }
        if (pics.size > 80) pics.clear();
        if (lk) {
          if (!pics.has(lk.key)) { try { draw(lk); } catch { pics.set(lk.key, null); } }
          const pic = pics.get(lk.key);
          if (pic) { props.pk = lk.key; if (!given.has(lk.key)) { props.pic = pic; given.add(lk.key); } }
        } else if (/\bride-area\b/.test(el.className)) {
          const tx = el.querySelector("span") || el, cs = getComputedStyle(tx), words = textOf(tx.innerHTML);
          if (words) {
            props.t = 1;
            props.lb = cs.textTransform === "uppercase" ? words.toUpperCase() : words;
            props.tc = /^(#|rgb)/.test(cs.color) ? cs.color : "#1f4a33";
            props.ts = Math.round((parseFloat(cs.fontSize) || 12) * 10) / 10;
          }
        }
      }
      out.push({ type: "Feature", geometry: { type: "Point", coordinates: [Math.round(at.lng * 1e5) / 1e5, Math.round(at.lat * 1e5) / 1e5] }, properties: props });
      hits.push(l);
    });
    return JSON.stringify({ type: "FeatureCollection", features: out });
  }

  // Details on a pin's card: its own card here, as a tap on it would open it. The pin is found again by where it is
  // (the card gives the pin's own spot), not by its number: the page redraws some pins after every move (huts,
  // webcams), and the numbers sent last may not be the ones the native screen showed. Once the flat map has settled
  // where the native one was. The searched place's pin has no Details (nd): a tap on it here takes it away.
  const tappable = (l) => l instanceof L.Marker && l.options.icon && l.options.interactive !== false && !l.options.draggable && (l.listens("click") || l.getPopup());
  N.addLayer("pins", pins, (n, latlng) => setTimeout(() => {
    let best = null, bd = 3e-5;
    map.eachLayer((l) => {
      if (!tappable(l)) return;
      const p = l.getLatLng(), d = Math.abs(p.lat - latlng.lat) + Math.abs(p.lng - latlng.lng);
      const io = l.options.icon.options || {}, h = io.html;
      if (d < bd && !/\bps-pin\b/.test(h && h.outerHTML != null ? h.outerHTML : String(h || ""))) { best = l; bd = d; }
    });
    if (best) best.fire("click", { latlng: best.getLatLng() });
  }, 350));

  // Sent again as pins come and go (each move redraws some) and as the map follows the native one, once it settles.
  let later = 0;
  const resend = (ms) => { if (!N.isOpen || !N.isOpen()) return; clearTimeout(later); later = setTimeout(() => N.send("pins"), ms); };
  map.on("layeradd layerremove", (e) => { if (e.layer instanceof L.Marker) resend(400); });
  map.on("moveend", () => resend(600));
})();
