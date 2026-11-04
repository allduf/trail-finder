// One set of line icons for the app's frame (interface review 2026-11-02, item 8: "emoji icons mixed with line
// icons"). The map buttons (Layers, 3D, Me) and the tab bar were already thin line drawings, while the Sport button,
// the quick buttons under the map's search box, the 🔔 and 📷 and the cards on Find, Ride, Saved and More were
// colour emoji, which look different on every phone. Here each of those emoji has a line drawing in the same style
// (24 × 24, 2 px stroke, round ends, the text colour).
//  - window.tfLine(emoji, size): the drawing for that emoji (or the emoji itself when there is none).
//  - window.tfLineify(root): swaps the emoji at the start of every text in root for its drawing. index.html runs it
//    on the map's sheet (search row, quick buttons, the Find/Ride/Saved/More pages) whenever they change, so the
//    sports' own files can keep writing "⛽ Fuel & camp" and the French translator still sees "Fuel & camp".
// Text in the middle of a sentence ("tap 📍 Save a spot") is left alone: it reads as the button it names.
(() => {
  "use strict";
  if (window.tfLine) return;
  const P = {
    bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h6l3.5 7.5M9 9l3 7.5h-1.5M15 9l-1.5-3H11"/>',
    ski: '<path d="M3 20 21 8M6 21l2-6"/><circle cx="12" cy="4.5" r="1.6"/><path d="M9 12l4-3 3 3"/>',
    hunt: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
    fish: '<path d="M2.5 12c3-4.5 8.5-6 13-3.5L21 5v14l-5.5-3.5C11 18 5.5 16.5 2.5 12z"/><circle cx="7.5" cy="11" r=".6"/>',
    moto: '<circle cx="5" cy="17" r="3.5"/><circle cx="19" cy="17" r="3.5"/><path d="M5 17 8.5 11H15l2-1M19 17 16.5 6.5H14"/><path d="M10 11.5 11 16h3.5l1.5-4.5"/>',
    boot: '<path d="M7 3h5v8l6 3c1.5.7 2 1.8 2 3v2H4V3z"/><path d="M4 19h16M7 7h3M7 11h4"/>',
    sparkle: '<path d="M10 3l1.8 5.2L17 10l-5.2 1.8L10 17l-1.8-5.2L3 10l5.2-1.8z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    camera: '<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>',
    screen: '<rect x="3" y="5" width="18" height="14" rx="2"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    signal: '<circle cx="12" cy="12" r="2"/><path d="M8 8a5.5 5.5 0 0 0 0 8M16 8a5.5 5.5 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
    chart: '<path d="M3 20h18"/><path d="m4 16 5-5 4 3 7-8"/>',
    star: '<path d="M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.1 5.9L12 16.5l-5.3 2.9 1.1-5.9-4.4-4.1 6-.7z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.5 4.5-6.5 8-6.5s7 2 8 6.5"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c.8-4 3.6-5.5 6.5-5.5s5.7 1.5 6.5 5.5M16 14.5c2.6 0 4.6 1.3 5.5 4.5"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>',
    warn: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/>',
    gondola: '<path d="M2 5l20-3M12 3.5V8"/><rect x="6" y="8" width="12" height="11" rx="2"/><path d="M6 13h12"/>',
    tent: '<path d="M12 4 2 20h20z"/><path d="M12 4v16M9 20l3-6 3 6"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    truck: '<path d="M2 16V8h11v8M13 11h5l3 3v2h-8"/><circle cx="6.5" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    route: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h6"/>',
    fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10"/><path d="M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
    drop: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
    map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z M9 4v13.5 M15 6.5V20"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    snow: '<path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>',
    ticket: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 6v12M12 10h5M12 14h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8v8l6-4z"/>',
    heart: '<path d="M12 20s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.2-8 11-8 11z"/>',
    cam: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="m16 11 5-3v8l-5-3"/>',
    paw: '<circle cx="7" cy="9" r="1.8"/><circle cx="12" cy="6.5" r="1.8"/><circle cx="17" cy="9" r="1.8"/><path d="M12 12c-3 0-5 3.5-5 5.5 0 1.5 1.3 2.2 2.5 2L12 19l2.5.5c1.2.2 2.5-.5 2.5-2 0-2-2-5.5-5-5.5z"/>',
  };
  // Emoji (and the few text symbols used as icons) -> drawing. The tab bar and map buttons draw the sports the same way.
  const E = {
    "🚵": "bike", "🚴": "bike", "🚲": "bike", "⛷": "ski", "🎿": "ski", "🦌": "hunt", "🎣": "fish", "🐟": "fish", "🏍": "moto", "🥾": "boot",
    "✨": "sparkle", "🆕": "sparkle", "◎": "target", "🎯": "target", "☀": "sun", "📷": "camera", "▭": "screen", "✎": "pencil",
    "📂": "folder", "📁": "folder", "⤓": "download", "📡": "signal", "📈": "chart", "★": "star", "⭐": "star", "⚙": "gear",
    "🔔": "bell", "⤢": "expand", "👤": "user", "🤝": "people", "✉": "mail", "🔒": "lock", "📜": "doc", "⚠": "warn",
    "🚡": "gondola", "🏕": "tent", "📍": "pin", "🛻": "truck", "🧭": "compass", "➚": "route", "⛽": "fuel", "💧": "drop",
    "🗺": "map", "📅": "calendar", "❄": "snow", "🎫": "ticket", "➕": "plus", "▶": "play", "📹": "cam", "🐾": "paw",
  };
  const draw = (k, size) => `<svg class="tf-line" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;
  const keyOf = (s) => {
    const t = String(s || "").replace(/^\s+/, "");
    for (const e in E) if (t.startsWith(e)) return [e, E[e], t.slice(e.length).replace(/^[️‍]+/, "")];
    return null;
  };
  window.tfLine = (s, size = 18) => { const k = keyOf(s); return k && !k[2].trim() ? draw(k[1], size) : String(s == null ? "" : s); };
  window.tfLineName = (name, size = 18) => (P[name] ? draw(name, size) : "");
  const SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT|OPTION|svg)$/i;
  window.tfLineify = (root) => {
    if (!root) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), hits = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      if (!p || SKIP.test(p.tagName) || p.closest("svg, [data-no-line]")) continue;
      // Only text that starts its element (a button, a title, an icon box): not mid-sentence.
      if (n.previousSibling && !(n.previousSibling.nodeType === 3 && !n.previousSibling.data.trim())) continue;
      const k = keyOf(n.data);
      if (k) hits.push([n, k]);
    }
    for (const [n, [, name, rest]] of hits) {
      const size = n.parentElement.classList.contains("ic") ? 22 : n.parentElement.classList.contains("spb-i") ? 22 : 17;
      const t = document.createElement("template");
      t.innerHTML = draw(name, size);
      n.parentNode.insertBefore(t.content.firstChild, n);
      // A space after the drawing, unless the button lays its parts out with a gap already (flex).
      const flex = /flex|grid/.test(getComputedStyle(n.parentElement).display);
      n.data = rest.replace(/^\s+/, rest.trim() && !flex ? "\u00a0" : "");
    }
  };
  const css = document.createElement("style");
  css.textContent = `svg.tf-line { flex: none; vertical-align: -3px; }
.spb-i > svg.tf-line, .sport-menu button > span > svg.tf-line { display: block; margin: 0 auto; }
.hub-card .ic svg.tf-line, .hub-tile .ic svg.tf-line { color: var(--accent, #2f9e5b); }`;
  document.head.appendChild(css);
})();
