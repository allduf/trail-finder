// One set of line icons for the app's frame (interface review 2026-11-02, item 8: "emoji icons mixed with line
// icons"). The map buttons (Layers, 3D, Me) and the tab bar were already thin line drawings, while the Sport button,
// the quick buttons under the map's search box, the 🔔 and 📷 and the cards on Find, Ride, Saved and More were
// colour emoji, which look different on every phone. Here each of those emoji has a line drawing in the same style
// (24 × 24, 2 px stroke, round ends, the text colour).
//  - window.tfLine(emoji, size): the drawing for that emoji (or the emoji itself when there is none).
//  - window.tfLineify(root): swaps the emoji at the start of every text in root for its drawing. index.html runs it
//    on the map's sheet (search row, quick buttons, the Find/Ride/Saved/More pages) whenever they change, so the
//    sports' own files can keep writing "⛽ Fuel & camp" and the French translator still sees "Fuel & camp".
// Text in the middle of a sentence is never drawn here, so the app names the button in words there ("tap Save a spot"):
// scripts/wording-check.mjs fails on a colour emoji mid-sentence (alex 2026-11-25, "keep the app professional").
(() => {
  "use strict";
  if (window.tfLine) return;
  const P = {
    bike: '<circle cx="5.5" cy="16.5" r="3.5"/><circle cx="18.5" cy="16.5" r="3.5"/><path d="M5.5 16.5 9 9h6l3.5 7.5M9 9l3 7.5h-1.5M15 9l-1.5-3H11"/>',
    ski: '<path d="M3 20 21 8M6 21l2-6"/><circle cx="12" cy="4.5" r="1.6"/><path d="M9 12l4-3 3 3"/>',
    hunt: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
    fish: '<path d="M2.5 12c3-4.5 8.5-6 13-3.5L21 5v14l-5.5-3.5C11 18 5.5 16.5 2.5 12z"/><circle cx="7.5" cy="11" r=".6"/>',
    // Adventure moto: a dirt bike (engine, high front fender, long seat) so it can't pass for the MTB bike (alex picked A, 2026-11-08).
    moto: '<circle cx="4.5" cy="17.5" r="3.5"/><circle cx="19.5" cy="17.5" r="3.5"/><path d="M19.5 17.5 16 6.5M14.5 6.5h3M17.5 11.5H21M2.5 10H10l1.5-1.5h3M4.5 17.5 9 15.5"/><rect x="9" y="12" width="5" height="4" rx="1"/>',
    // Skiing's Nordic and Snowmobile buttons, so the four Skiing buttons are all line drawings (2026-11-08).
    nordic: '<circle cx="13.5" cy="4" r="1.6"/><path d="M13 7.5 10.5 13l3 2-1.5 4.5M10.5 13 7 16.5M13 7.5l3 3 3-1M5 9.5l-1.5 9.5M19 9.5 18 19M2 20.5h11M14 20.5h8"/>',
    sled: '<path d="M2 19.5h14.5c2 0 3.5-1 4.5-2.5"/><path d="M4 16.5h13.5l3-3h-6L13 10H8.5L6 13.5H4z"/><path d="M13 10l1.5-3.5H18M7 19.5v-3M15 19.5v-3"/>',
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
    // A tent, not a warning sign (alex 2026-11-11 saw ⚠ on "Cabin trip"): poles crossed at the top, a door, the ground.
    tent: '<path d="M3.5 20 12 6l8.5 14"/><path d="M2 20h20M12 6l-2-3M12 6l2-3M12 13l-3 7M12 13l3 7"/>',
    pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    truck: '<path d="M2 16V8h11v8M13 11h5l3 3v2h-8"/><circle cx="6.5" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    route: '<circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M7 18h6a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h6"/>',
    fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10"/><path d="M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
    drop: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
    map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z M9 4v13.5 M15 6.5V20"/>',
    // Deep phone test 2026-11-21: emoji still showing in Hunting's Drop a pin (Saline, Cache), Skiing's Heli and cat
    // skiing, Where to look, the Notifications box, Loops, E-bikes and Closures.
    salt: '<path d="M8 9h8l1 12H7z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/><path d="M11 4h2"/>',
    heli: '<path d="M4 4h16M12 4v4"/><path d="M5 12a5 4 0 0 1 5-4h4a4 4 0 0 1 4 4v1a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z"/><path d="M8 19h9M10 16v3M15 16v3M18 12h3"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
    loop: '<path d="M4 12a6 6 0 0 1 6-6h8M15 3l3 3-3 3"/><path d="M20 12a6 6 0 0 1-6 6H6M9 21l-3-3 3-3"/>',
    battery: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10.5v3M7 10.5v3M10.5 10.5v3"/>',
    barrier: '<rect x="2.5" y="7" width="19" height="6" rx="1"/><path d="M6 7l-3 6M11 7l-4 6M16 7l-4 6M21 7l-4 6M5 13v8M19 13v8"/>',
    tree: '<path d="M12 2 6 10h3l-4 6h14l-4-6h3z"/><path d="M12 16v6"/>',
    rain: '<path d="M7 15a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.5 1.5A3.75 3.75 0 0 1 17 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
    soil: '<path d="M3 9c3-2 6-2 9 0s6 2 9 0M3 14c3-2 6-2 9 0s6 2 9 0M3 19c3-2 6-2 9 0s6 2 9 0"/>',
    hut: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10M10 20v-5h4v5"/>',
    cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.5 1.5A3.75 3.75 0 0 1 17 18z"/>',
    fog: '<path d="M7 12a4.5 4.5 0 0 1 10-2.5A3.5 3.5 0 0 1 18 12"/><path d="M3 15h18M5 18.5h14M7 22h10"/>',
    snowcloud: '<path d="M7 14a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.5 1.5A3.75 3.75 0 0 1 17 14z"/><path d="M8 18v.5M12 17v.5M16 18v.5M10 21v.5M14 21v.5"/>',
    town: '<path d="M2.5 21V11l5-4 5 4v10M12.5 21v-7l4.5-3.5 4.5 3.5v7M2 21h20M6 21v-4h3v4"/>',
    peak: '<path d="M2 20 9 7l4 6 2.5-3.5L22 20z"/><path d="M7.5 10 9 12l1.5-2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    snow: '<path d="M12 2v20M4.9 6.5l14.2 11M19.1 6.5 4.9 17.5"/><path d="m9 4 3 2 3-2M9 20l3-2 3 2"/>',
    ticket: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 6v12M12 10h5M12 14h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8v8l6-4z"/>',
    heart: '<path d="M12 20s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.2-8 11-8 11z"/>',
    cam: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="m16 11 5-3v8l-5-3"/>',
    paw: '<circle cx="7" cy="9" r="1.8"/><circle cx="12" cy="6.5" r="1.8"/><circle cx="17" cy="9" r="1.8"/><path d="M12 12c-3 0-5 3.5-5 5.5 0 1.5 1.3 2.2 2.5 2L12 19l2.5.5c1.2.2 2.5-.5 2.5-2 0-2-2-5.5-5-5.5z"/>',
    // The cabin trip's sections and buttons (alex 2026-11-11: "i dont really like the emoji", wanted icons like the
    // Touring / Nordic / Snowmobile / Resorts buttons).
    pack: '<path d="M9 6V4.5a3 3 0 0 1 6 0V6"/><rect x="5" y="6" width="14" height="15" rx="3"/><path d="M9 13h6v4H9zM5 11h14"/>',
    pot: '<path d="M4 10h16v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M2 10h2M20 10h2M9.5 6.5c0-1 1-1.2 1-2.5M13.5 6.5c0-1 1-1.2 1-2.5"/>',
    cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v.01M18 14.5v.01"/>',
    buoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/>',
    book: '<path d="M5 5a2 2 0 0 1 2-2h11v15H7a2 2 0 0 0-2 2z"/><path d="M5 20a2 2 0 0 0 2 2h11v-4M9 7.5h5"/>',
    share: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12v8.5h14V12"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    trash: '<path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5"/>',
    alarm: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M3 5.5 5.5 3M21 5.5 18.5 3"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    car: '<path d="M3 17v-5l2.2-5h13.6L21 12v5z"/><path d="M3 12h18M5 17v2.5M19 17v2.5"/><circle cx="7.5" cy="14.5" r=".6"/><circle cx="16.5" cy="14.5" r=".6"/>',
    bed: '<path d="M3 5v15M3 16h18v4M21 16v-3.5a3 3 0 0 0-3-3h-7.5V16"/><circle cx="6.8" cy="12.3" r="1.8"/>',
    fire: '<path d="M12 21c-3.9 0-7-2.6-7-6.4 0-3.4 2.8-5.4 4-9.6 2 1.5 3 3.4 3 5.4.9-.8 1.5-2 1.6-3.2C16 9.2 19 12 19 14.6c0 3.8-3.1 6.4-7 6.4z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l3 2M9 2.5h6"/>',
    // Weather, moon and the last buttons and cards with colour emoji (wording sweep 2026-11-21).
    storm: '<path d="M7 14h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 14z"/><path d="m12.5 15.5-2 3h3l-2 3"/>',
    suncloud: '<path d="M8 2.5V4M2.5 8H4M4.1 4.1l1 1M11.9 4.1l-1 1"/><path d="M5 10.5a3.2 3.2 0 0 1 5.6-3"/><path d="M9.5 20.5h8a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.3 2.9 2.9 0 0 0 1.2 5.7z"/>',
    wind: '<path d="M3 8.5h11a3 3 0 1 0-3-3M3 12.5h15a3 3 0 1 1-3 3M3 16.5h7"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
    save: '<path d="M4 4h12l4 4v12H4z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    parking: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M9.5 17V7.5H13a3 3 0 0 1 0 6H9.5"/>',
    plane: '<path d="M21 3.5 3 10.5l7 2.5 2.5 7.5z"/><path d="m10 13 4.5-4.5"/>',
    boat: '<path d="M3 15h18l-2.5 5h-13z"/><path d="M6 15V9.5h12V15M9.5 9.5V6h5v3.5"/>',
    shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6z"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.8"/>',
    spring: '<path d="M4 17.5c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5S16.4 14 12 14s-8 1.6-8 3.5z"/><path d="M8 11c-1-1.5 1-2.5 0-4.5M12 11c-1-1.5 1-2.5 0-4.5M16 11c-1-1.5 1-2.5 0-4.5"/>',
    sat: '<path d="m9.5 9.5 5 5M8 14l2-2M14 8l2-2"/><path d="m4.5 9.5 5-5 3 3-5 5zM14.5 19.5l5-5-3-3-5 5z"/><path d="M15 21a6 6 0 0 0 6-6"/>',
    // A saved hunting or fishing point's kinds, on its map pin and in its lists (alex 2026-11-21: line icons on pins too).
    ladder: '<path d="M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19 13 11"/>',
    steps: '<path d="M7 4.5c1.7 0 2.5 2 2.5 4s-1 3.5-2.5 3.5S4.5 10.5 4.5 8.5 5.3 4.5 7 4.5zM5 15h4M17 9.5c1.7 0 2.5 2 2.5 4s-1 3.5-2.5 3.5-2.5-1.5-2.5-3.5.8-4 2.5-4zM15 20h4"/>',
    wheat: '<path d="M12 22V8"/><path d="M12 8c-2.5 0-3.5-2-3.5-4.5C11 3.5 12 5.5 12 8zm0 0c2.5 0 3.5-2 3.5-4.5C13 3.5 12 5.5 12 8zM12 13c-2.5 0-4-1.5-4-4 2.5 0 4 1.5 4 4zm0 0c2.5 0 4-1.5 4-4-2.5 0-4 1.5-4 4zM12 18c-2.5 0-4-1.5-4-4 2.5 0 4 1.5 4 4zm0 0c2.5 0 4-1.5 4-4-2.5 0-4 1.5-4 4z"/>',
    apple: '<path d="M12 7.5c-1.5-1.5-6.5-2-7.5 3S6.5 21 9 21c1.2 0 1.8-.6 3-.6s1.8.6 3 .6c2.5 0 5.5-5.5 4.5-10.5s-6-4.5-7.5-3z"/><path d="M12 7.5c0-2 .8-3.5 2.5-4.5"/>',
    antler: '<path d="M8 21v-6c0-4-3-6-4.5-9M8 13 4 11M6.5 8.5 3 7M16 21v-6c0-4 3-6 4.5-9M16 13l4-2M17.5 8.5 21 7"/>',
    bug: '<ellipse cx="12" cy="13.5" rx="4" ry="6"/><path d="M12 7.5V19.5M9.5 5.5 8 3M14.5 5.5 16 3M8 11H3.5M8 15.5 4 18M16 11h4.5M16 15.5l4 2.5"/>',
  };
  // Emoji (and the few text symbols used as icons) -> drawing. The tab bar and map buttons draw the sports the same way.
  const E = {
    "🚵": "bike", "🚴": "bike", "🚲": "bike", "⛷": "ski", "🎿": "nordic", "🛷": "sled", "🦌": "hunt", "🎣": "fish", "🐟": "fish", "🏍": "moto", "🥾": "boot",
    "✨": "sparkle", "🆕": "sparkle", "◎": "target", "🎯": "target", "☀": "sun", "📷": "camera", "▭": "screen", "✎": "pencil",
    "📂": "folder", "📁": "folder", "⤓": "download", "📡": "signal", "📈": "chart", "★": "star", "⭐": "star", "⚙": "gear",
    "🔔": "bell", "⤢": "expand", "👤": "user", "🤝": "people", "✉": "mail", "🔒": "lock", "📜": "doc", "⚠": "warn",
    "🚡": "gondola", "🏕": "tent", "📍": "pin", "🛻": "truck", "🧭": "compass", "➚": "route", "⛽": "fuel", "💧": "drop",
    "🗺": "map", "📅": "calendar", "❄": "snow", "🎫": "ticket", "➕": "plus", "▶": "play", "📹": "cam", "🐾": "paw",
    "🎒": "pack", "🍲": "pot", "💵": "cash", "💲": "cash", "🛟": "buoy", "📓": "book", "📤": "share", "🔗": "link", "🗑": "trash",
    "⏰": "alarm", "✅": "check", "✏": "pencil", "⬇": "download", "👥": "people", "🚗": "car", "🛏": "bed", "🔥": "fire", "⏱": "timer",
    "🎉": "sparkle", "💬": "chat",
    "🧂": "salt", "⛺": "tent", "🚁": "heli", "🔍": "search", "🔎": "search", "📱": "phone", "🔁": "loop", "🔋": "battery", "🚧": "barrier",
    "⛰": "peak", "🏔": "peak", "🌲": "tree", "🌧": "rain", "🤎": "soil", "🛖": "hut",
    "☁": "cloud", "🌫": "fog", "🌨": "snowcloud", "📄": "doc", "🏘": "town",
    "🌥": "cloud", "🌦": "rain", "⛈": "storm", "🌤": "suncloud", "⛅": "suncloud", "💨": "wind", "🌙": "moon", "🌑": "moon", "🌒": "moon", "🌓": "moon",
    "🌔": "moon", "🌕": "moon", "🌖": "moon", "🌗": "moon", "🌘": "moon", "💾": "save", "🔊": "sound", "🔇": "mute", "🅿": "parking", "✈": "plane",
    "🏝": "tree", "🚻": "hut", "⛴": "boat", "🛶": "boat", "🛡": "shield", "🔓": "unlock", "♨": "spring", "🛰": "sat", "🗣": "chat", "🚶": "boot",
    "🚐": "truck", "🗾": "map", "🔧": "gear", "📋": "doc",
    "🪜": "ladder", "👀": "eye", "🍂": "leaf", "👣": "steps", "🌾": "wheat", "🍎": "apple", "🦟": "bug",
  };
  const draw = (k, size) => `<svg class="tf-line" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;
  const keyOf = (s) => {
    const t = String(s || "").replace(/^\s+/, "");
    for (const e in E) if (t.startsWith(e)) return [e, E[e], t.slice(e.length).replace(/^[️‍]+/, "")];
    return null;
  };
  // On a map pin and in a saved point's kind lists (data-pin-line) a few emoji mean something else: 🦌 is shed
  // antlers there, not Hunting.
  const PIN_E = { "🦌": "antler" };
  const keyOfPin = (s) => { const k = keyOf(s); return k && PIN_E[k[0]] ? [k[0], PIN_E[k[0]], k[2]] : k; };
  window.tfLine = (s, size = 18) => { const k = keyOf(s); return k && !k[2].trim() ? draw(k[1], size) : String(s == null ? "" : s); };
  window.tfLineName = (name, size = 18) => (P[name] ? draw(name, size) : "");
  const SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|SELECT|OPTION|svg)$/i;
  // One text node: the drawing goes in front of it and the emoji leaves the text. In two passes over all the text nodes
  // found (plan, then do): every parent's style is read before anything changes, so the browser works out the page's
  // styles once instead of once per drawing (each read after a change forced a full restyle: a long freeze when a
  // sport's panel or a list of pins arrived on a phone).
  let planned = null;   // text node -> [key, pin?], while a sweep is gathering
  const plan = (n, k, pin) => { if (!planned.has(n)) planned.set(n, [k, pin]); };
  const gather = (fn) => {
    const outer = !planned;
    if (outer) planned = new Map();
    try { fn(); } finally { if (outer) { const all = planned; planned = null; doAll(all); } }
  };
  const doAll = (all) => {
    const jobs = [];
    all.forEach(([k, pin], n) => {
      const p = n.parentElement;
      if (!p || !n.data.replace(/^\s+/, "").startsWith(k[0])) return;   // changed since it was found
      const cs = getComputedStyle(p);
      jobs.push([n, k, pin, cs.display, cs.flexDirection]);
    });
    for (const [n, [, name, rest], pin, display, dir] of jobs) {
      const t = document.createElement("template");
      if (pin) {
        t.innerHTML = draw(name, "1.2em");
        t.content.firstChild.classList.add("tf-pin-line");
        n.parentNode.insertBefore(t.content.firstChild, n);
        // A space after the drawing, unless the pin lays its parts out with a gap already (flex or grid: \u26f7 resort label).
        const flex = rest.trim() && /flex|grid/.test(display);
        n.data = rest.replace(/^\s+/, rest.trim() && !flex ? "\u00a0" : "");
        continue;
      }
      const pc = n.parentElement.classList, size = pc.contains("ic") || pc.contains("spb-i") || pc.contains("i") ? 22 : 17;
      t.innerHTML = draw(name, size);
      // A column (Layers' "🔥 Wildfires" over its status line): the drawing and its words stay on one line together.
      const column = /flex/.test(display) && /column/.test(dir);
      if (column) { const row = document.createElement("span"); n.parentNode.insertBefore(row, n); row.append(t.content.firstChild, n); }
      else n.parentNode.insertBefore(t.content.firstChild, n);
      // A space after the drawing, unless the button lays its parts out with a gap already (flex).
      const flex = !column && /flex|grid/.test(display);
      n.data = rest.replace(/^\s+/, rest.trim() && !flex ? "\u00a0" : "");
    }
  };
  window.tfLineify = (root) => { if (root) gather(() => lineify(root)); };
  const lineify = (root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      if (!p || SKIP.test(p.tagName) || p.closest("svg, [data-no-line], [data-pin-line]")) continue;
      // Only text that starts its element (a button, a title, an icon box): not mid-sentence.
      if (n.previousSibling && !(n.previousSibling.nodeType === 3 && !n.previousSibling.data.trim())) continue;
      const k = keyOf(n.data);
      if (k) plan(n, k);
    }
    pinRoots(root);
  };
  // Map pins (Leaflet and the web 3D map's markers) and a saved point's kind lists: every emoji that has a drawing, at
  // the start of the pin's text, sized to the pin's own text (alex 2026-11-21: "Yes, line icons on pins"). The pin
  // keeps its colour and the drawing takes the pin's text colour (white on most). The iPhone's native 3D pins are
  // drawn there already (NativePins.swift); native-pins.js reads the pins' html as written, so nothing changes there.
  const PIN = ".leaflet-marker-icon, .maplibregl-marker, [data-pin-line]";
  const pinify = (el) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      if (!p || SKIP.test(p.tagName) || p.closest("svg, [data-no-line]")) continue;
      if (n.previousSibling && !(n.previousSibling.nodeType === 3 && !n.previousSibling.data.trim())) continue;
      const k = keyOfPin(n.data);
      if (k) plan(n, k, true);
    }
  };
  const pinRoots = (root) => {
    if (!root || root.nodeType !== 1) return false;
    const own = root.closest(PIN);
    if (own) { pinify(own); return true; }
    root.querySelectorAll(PIN).forEach(pinify);
    return false;
  };
  // The sports' own icons, everywhere (alex 2026-11-08, "i like those kind of icon, we should put the same style for
  // all the sport"): the Sport menu's drawings for MTB, Skiing, Hunting, Fishing, Adventure moto and Hiking also replace
  // those emoji at the start of a button or title anywhere else (welcome, How it works, Offline maps, Ask, logs, search
  // lists, desktop panels). Map pins and a point's kind lists (data-pin-line, where 🦌 means shed antlers, not Hunting) go
  // through pinify above; anything under data-no-line is left alone.
  // The sports' own panels (Routes, Hunt, Fish, Roads, Hikes) get every known emoji drawn, like the phone's sheet.
  // Every colour emoji that has a drawing, too (deep phone test 2026-11-21: 🧂 ⛺ 🔒 ⏰ 📱 in cards and boxes outside
  // the panels): only those that show in colour on phones (Emoji_Presentation, or a picture past U+1F000 such as 🗺),
  // so text symbols such as ★ rating stars, ◎, ⚠ or ▶ stay as they are outside the panels.
  const COLOUR = Object.keys(E).filter((e) => /\p{Emoji_Presentation}/u.test(e) || e.codePointAt(0) >= 0x1f000).map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // Symbols that are text by default turn colour on phones when written with VS16 (⚙️ Settings, ☀️ Dry, ❄️ Snow), and
  // ☁ shows in colour on iPhones as it is, and ☀ on Android (the MTB Today line, 2026-11-27) (⛰ stays out: the 3D
  // button draws its own mountain).
  const VS16 = Object.keys(E).filter((e) => !COLOUR.includes(e) && !/^[★◎▭▶➚⤓⤢]$/u.test(e)).map((e) => e + "\uFE0F");
  const ALT = ["🚵", "🚴", "🚲", "⛷", "🎿", "🛷", "🚡", "🦌", "🎣", "🐟", "🏍", "🥾", "☁", "☀", ...VS16, ...COLOUR].filter((e, i, a) => a.indexOf(e) === i).join("|");
  const SPORT_E = new RegExp(`^\\s*(${ALT})`, "u"), HAS = new RegExp(ALT, "u");
  const PANES = "#skiPane, #huntPane, #fishPane, #motoPane, #hikePane";
  const NOT = ".leaflet-pane, .leaflet-marker-icon, .maplibregl-marker, .maplibregl-canvas-container, [data-no-line], [data-pin-line], select, textarea, input";
  const sweep = (root) => {
    if (!root || root.nodeType !== 1 || pinRoots(root) || root.closest(NOT)) return;
    if (root.closest(PANES)) return lineify(root);
    root.querySelectorAll(PANES).forEach((p) => lineify(p));
    if (!HAS.test(root.textContent || "")) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const p = n.parentElement;
      if (!p || !SPORT_E.test(n.data) || SKIP.test(p.tagName) || p.closest(NOT + ", svg")) continue;
      if (n.previousSibling && !(n.previousSibling.nodeType === 3 && !n.previousSibling.data.trim())) continue;
      const k = keyOf(n.data);
      // Only the text that starts with one of them (a "🚵 My rides" button, a ⛺ icon box): a ★ rating or a ◎ next to
      // it stays as it is.
      if (k) plan(n, k);
    }
  };
  const pending = new Set();
  let queued = false;
  const flush = () => { queued = false; const roots = [...pending]; pending.clear(); mo.disconnect(); gather(() => roots.forEach((r) => r.isConnected && sweep(r))); watch(); };
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") { if (m.target.parentElement && (HAS.test(m.target.data) || m.target.parentElement.closest(PIN))) pending.add(m.target.parentElement); continue; }
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) pending.add(n);
        else if (n.nodeType === 3 && n.parentElement && HAS.test(n.data)) pending.add(n.parentElement);
      }
    }
    if (pending.size && !queued) { queued = true; requestAnimationFrame(flush); }
  });
  const watch = () => mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  const start = () => { gather(() => sweep(document.body)); watch(); };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  const css = document.createElement("style");
  css.textContent = `svg.tf-line { flex: none; vertical-align: -3px; }
svg.tf-line.tf-pin-line { vertical-align: -.2em; }
.spb-i > svg.tf-line, .sport-menu button > span > svg.tf-line { display: block; margin: 0 auto; }
.hub-card .ic svg.tf-line, .hub-tile .ic svg.tf-line { color: var(--accent, #2f9e5b); }`;
  document.head.appendChild(css);
})();
