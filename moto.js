// Moto adventure (ADV and dual sport), the fifth sport in the sport menu (MTB / Skiing / Hunting / Fishing / Moto).
// winter.js owns the menu and loads this file the first time Moto is picked (the other sports never load it). It
// sets body.sport-moto (and body.sport-alt, which hides the MTB parts) and sends "tf:sport".
// alex (2026-10-26): "the best app adapted for moto adventure ride", all of Canada, every kind of bike, the rider
// enters their own bike. From the forums (ADVrider, Reddit dual sport, reviews of REVER, Gaia, onX Offroad, Calimoto,
// Kurviger): before a ride riders ask four things, can my bike get through, am I allowed to ride there, will I have
// fuel, and where do I sleep. The panel, top to bottom:
//  - Four buttons: Plan a route, Fuel & camp, Mud today, Ride.
//  - My bike: the model (weight and tank filled in from a list, or typed), tires and dirt skill. The roads, the
//    routes and the fuel range all follow it: a road's grade (1 paved to 5 very rough) against what the bike and
//    rider can do gives "good for your bike", "hard for your bike" or "too hard".
//  - Dirt today: dry, dusty, slick, muddy or snow at the spot, from the rain of the last days, the soil moisture and
//    the snow on the ground (Open-Meteo), and tomorrow's.
//  - The road you tapped: its name, surface and grade for your bike, the BC Forest Service Road record, whether you
//    can ride there (national and provincial parks, reserves, BC motor vehicle closures, Quebec zecs, First Nation
//    land, from the Hunting rules outlines), the province's rules for a plated bike, the dirt today, and the nearest
//    gas and camping.
//  - A planned route: tap points; Most dirt, Mix or Paved back roads, for your bike; distance, time, km of dirt, the
//    hardest bits for your bike, gas stops and gaps longer than your range, camping near the end; save, GPX, save
//    the route's corridor offline, and Ride it with spoken turns.
// Map: dirt roads and tracks coloured for your bike (OpenFreeMap vector tiles, streamed, so nothing big is stored
// on the site), mud and dust today, gas stations with your fuel range ring, campsites and BC rec sites, hot springs,
// moto shops, ferries, and where you can't ride. The same on the 3D map.
// Routes and turn-by-turn words: Valhalla (the FOSSGIS server behind openstreetmap.org's directions), motorcycle
// costing. Points: ca/moto/*.json (scripts/build-moto.mjs in the nightly Canada job), else OpenStreetMap live.
(() => {
  "use strict";
  const map = window.tfLeaflet, sel = document.getElementById("sport");
  if (!map || !sel || !window.L || window.tfMoto) return;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (id) => document.getElementById(id);
  const isMoto = () => document.body.classList.contains("sport-moto");
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const timeout = (ms) => (AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
  const getJ = (url, ms = 12000, opt = {}) => fetch(url, { signal: timeout(ms), ...opt }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
  const postJ = (url, body, ms = 30000) => getJ(url, ms, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const kmBetween = (a, b) => map.distance(a, b) / 1000;
  const fmtKm = (k) => (k < 1 ? `${Math.round(k * 1000)} m` : k < 10 ? `${k.toFixed(1)} km` : `${Math.round(k).toLocaleString()} km`);
  const fmtH = (s) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`; };
  const ACC = "#d9480f";   // the Moto accent (burnt orange)
  const VALHALLA = "https://valhalla1.openstreetmap.de";
  const OFM = { type: "vector", url: "https://tiles.openfreemap.org/planet" };
  const WFS = "https://openmaps.gov.bc.ca/geo/pub/wfs";
  const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

  // ---------- icons ----------
  const svg = (d, size = 20) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const IC = {
    moto: '<circle cx="5" cy="17" r="3.5"/><circle cx="19" cy="17" r="3.5"/><path d="M5 17 8.5 11H15l2-1M19 17 16.5 6.5H14"/><path d="M8 11c.5-2 2-2.5 3.5-2.5H15l1 2.5"/><path d="M10 11.5 11 16h3.5l1.5-4.5"/>',
    plan: '<path d="M4 20c4 0 4-6 8-6s4 6 8 6"/><circle cx="4" cy="20" r="1.5"/><circle cx="20" cy="20" r="1.5"/><path d="M12 3v7M9 6l3-3 3 3"/>',
    fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M6 9h6"/><path d="M14 11h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
    camp: '<path d="M3 20 12 4l9 16z"/><path d="M12 20l-3-6h6z"/>',
    drop: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
    ride: '<circle cx="12" cy="12" r="9"/><path d="M10 8v8l6-4z"/>',
    road: '<path d="M8 3 4 21M16 3l4 18M12 5v2M12 11v2M12 17v2"/>',
    rules: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    warn: '<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18v.5"/>',
    hot: '<path d="M8 4c-1 2 1 3 0 5M12 3c-1 2 1 3 0 5M16 4c-1 2 1 3 0 5"/><path d="M3 14h18c0 4-4 7-9 7s-9-3-9-7z"/>',
    save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>',
    dl: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    loop: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    me: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
    safe: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    pin: '<path d="M12 21s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    peak: '<path d="m3 20 6-11 4 6 2-3 6 8z"/><path d="m8 11 1.5 1.5L11 11"/>',
    log: '<path d="M5 3h14v18H5z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    trips: '<path d="M4 19c3-6 6 2 9-4s5-6 7-10"/><circle cx="4" cy="19" r="1.6"/><circle cx="20" cy="5" r="1.6"/>',
    cell: '<path d="M5 20v-3M9 20v-6M13 20v-9M17 20V8M21 20V4"/>',
    fly: '<path d="M2 16 22 6l-6 14-3-6z"/><path d="m13 14 9-8"/>',
  };

  // ---------- bikes ----------
  // The kind of bike sets what it can ride: base = the roughest grade (1 to 5, below) it rides well with 50/50 tires
  // and some dirt experience. Skill and tires move it one up or down.
  const TYPES = {
    street: { label: "Street or touring", sub: "Paved roads, easy gravel", base: 1, l100: 5.5 },
    big: { label: "Big ADV", sub: "Over 220 kg: R 1300 GS, 1290 Super Adventure, Africa Twin AS", base: 2, l100: 5.5 },
    mid: { label: "Mid ADV", sub: "170 to 220 kg: Ténéré 700, 890 Adventure, KLR650", base: 3, l100: 4.6 },
    light: { label: "Light dual sport", sub: "Under 170 kg: DR650, CRF300L, XR650L", base: 4, l100: 3.6 },
    enduro: { label: "Plated enduro", sub: "Under 130 kg: EXC, FE, WR, plated dirt bikes", base: 5, l100: 4.2 },
  };
  const SKILL = { new: [-1, "New to dirt"], some: [0, "Some dirt"], expert: [1, "Lots of dirt"] };
  const TIRES = { street: [-1, "Street"], "5050": [0, "50/50"], knobby: [1, "Knobby"] };
  // Common ADV and dual-sport bikes: [name, type, kg ready to ride (about), tank litres, litres per 100 km (about)].
  // Approximate makers' numbers: the rider can change any of them for their own bike.
  const MODELS = [
    ["BMW R 1300 GS", "big", 237, 19, 4.8], ["BMW R 1300 GS Adventure", "big", 269, 30, 5.0], ["BMW R 1250 GS", "big", 249, 20, 4.9], ["BMW R 1250 GS Adventure", "big", 268, 30, 5.1],
    ["BMW F 900 GS", "mid", 219, 14.5, 4.4], ["BMW F 900 GS Adventure", "big", 227, 23, 4.5], ["BMW F 850 GS", "big", 229, 15, 4.6], ["BMW F 800 GS", "mid", 214, 16, 4.3], ["BMW G 310 GS", "light", 175, 11, 3.3],
    ["KTM 1290 Super Adventure R", "big", 240, 23, 6.0], ["KTM 890 Adventure R", "mid", 210, 20, 4.6], ["KTM 890 Adventure", "mid", 211, 20, 4.6], ["KTM 790 Adventure", "mid", 209, 20, 4.5],
    ["KTM 390 Adventure", "light", 172, 14.5, 3.4], ["KTM 690 Enduro R", "light", 160, 13.5, 4.2], ["KTM 500 EXC-F (plated)", "enduro", 115, 8.5, 4.5], ["KTM 350 EXC-F (plated)", "enduro", 112, 8.5, 4.3],
    ["Husqvarna Norden 901", "mid", 204, 19, 4.5], ["Husqvarna 701 Enduro", "light", 160, 13, 4.2], ["Husqvarna FE 501s", "enduro", 115, 8.5, 4.5],
    ["Honda Africa Twin CRF1100L", "big", 226, 18.8, 5.0], ["Honda Africa Twin Adventure Sports", "big", 250, 24.8, 5.1], ["Honda Transalp XL750", "mid", 208, 16.9, 4.3],
    ["Honda XR650L", "light", 157, 10.5, 5.0], ["Honda CRF300L", "light", 140, 7.8, 2.9], ["Honda CRF300L Rally", "light", 153, 12.8, 2.9], ["Honda CB500X / NX500", "mid", 196, 17.7, 3.6],
    ["Yamaha Ténéré 700", "mid", 204, 16, 4.3], ["Yamaha Ténéré 700 World Raid", "mid", 220, 23, 4.4], ["Yamaha WR250R", "light", 134, 7.6, 3.2], ["Yamaha XT250", "light", 131, 9.8, 2.6],
    ["Suzuki DR650S", "light", 166, 13, 4.5], ["Suzuki DR-Z400S", "light", 144, 10, 4.0], ["Suzuki V-Strom 650XT", "mid", 216, 20, 4.4], ["Suzuki V-Strom 800DE", "big", 230, 20, 4.5], ["Suzuki V-Strom 1050DE", "big", 252, 20, 5.3],
    ["Kawasaki KLR650", "mid", 209, 23, 4.6], ["Kawasaki KLX300", "light", 136, 7.6, 3.0], ["Kawasaki Versys-X 300", "light", 175, 17, 3.4],
    ["Triumph Tiger 900 Rally Pro", "big", 228, 20, 5.0], ["Triumph Tiger 1200 Rally Explorer", "big", 261, 30, 5.6], ["Triumph Scrambler 1200 X", "big", 228, 15, 5.0],
    ["Ducati DesertX", "big", 223, 21, 5.6], ["Ducati Multistrada V4 Rally", "big", 260, 30, 6.4],
    ["Royal Enfield Himalayan 450", "mid", 196, 17, 3.4], ["Royal Enfield Himalayan 411", "mid", 199, 15, 3.3], ["Aprilia Tuareg 660", "mid", 204, 18, 4.5],
    ["Harley-Davidson Pan America 1250", "big", 258, 21.2, 5.8], ["CFMoto 450MT", "mid", 190, 17.5, 3.8], ["CFMoto 800MT", "big", 231, 19, 4.9], ["Moto Guzzi Stelvio", "big", 246, 21, 5.3],
    ["Beta 500 RR-S (plated)", "enduro", 118, 8, 4.5], ["Sherco 500 SEF Factory (plated)", "enduro", 112, 9.7, 4.5], ["GasGas ES 700", "light", 158, 13.5, 4.2],
  ];
  // Year, make and model (alex 2026-10-26: "make the search by year, mark, model"): every motorcycle sold in North
  // America since 1981, from NHTSA's free vehicle database (vPIC, open to browsers). It has names only, so the numbers
  // come from MODELS above when the bike is one of them, else from the kind of bike its name says (ADV words, dual
  // sport and enduro names, the cc in the name), and the rider checks them.
  const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles";
  const MAKES = ["Aprilia", "Benelli", "Beta", "BMW", "Buell", "Can-Am", "CFMoto", "Ducati", "Fantic", "GasGas", "Harley-Davidson", "Honda", "Husaberg", "Husqvarna", "Hyosung", "Indian",
    "Kawasaki", "Kove", "KTM", "Kymco", "Moto Guzzi", "MV Agusta", "Piaggio", "Rieju", "Royal Enfield", "Sherco", "Suzuki", "SWM", "Triumph", "Ural", "Vespa", "Victory", "Voge", "Yamaha", "Zero"];
  const NOT_BIKE = /\b(raptor|grizzly|kodiak|wolverine|viking|yxz|yfz|rhino|teryx|brute force|kfx|mule|pioneer|talon|rancher|foreman|trx|rubicon|sportsman|outlander|renegade|maverick|commander|defender|spyder|ryker|rzr|ranger|cforce|zforce|uforce|atv|utv|side by side|quad)\b/i;
  const MODEL_CACHE = new Map();
  const modelsFor = (make, year) => {
    const k = `${make}|${year}`;
    if (!MODEL_CACHE.has(k)) MODEL_CACHE.set(k, getJ(`${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(make)}/modelyear/${year}/vehicletype/motorcycle?format=json`, 15000)
      .then((j) => [...new Set((j.Results || []).map((x) => String(x.Model_Name || "").trim()).filter((n) => n && !NOT_BIKE.test(n)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
      .catch(() => { MODEL_CACHE.delete(k); return null; }));
    return MODEL_CACHE.get(k);
  };
  const norm = (t) => String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
  const SPEC = { street: [230, 18, 5.5], big: [245, 21, 5.4], mid: [205, 17, 4.5], light: [150, 10, 3.6], enduro: [115, 8.5, 4.4] };
  // [type, kg, tank, l100, known] for a make and model name.
  function specsOf(make, model) {
    const full = norm(`${make} ${model}`), m = norm(model);
    const hit = MODELS.filter((x) => { const n = norm(x[0]); return n === full || (m.length >= 3 && n.includes(m)) || full.includes(n); }).sort((a, b) => (norm(b[0]) === full) - (norm(a[0]) === full) || norm(a[0]).length - norm(b[0]).length)[0];
    if (hit) return [hit[1], hit[2], hit[3], hit[4], true];
    const t = `${make} ${model}`, cc = +((t.match(/(\d{3,4})/) || [])[1] || 0);
    let type = "street";
    if (/\b(exc|xc-?w|fe ?\d|te ?\d|rr-?s|sef|ser|wr ?\d{3}f|yz ?\d{3}fx?|crf ?\d{3}(rx|x)\b|kx ?\d|rm-?z|mc ?\d|ec ?\d)/i.test(t)) type = "enduro";
    else if (/\b(klr|klx|dr-?z?\s?\d|xr\s?\d|crf\s?\d+\s?l|wr\s?\d+r|xt\s?\d|tw\s?200|dual|enduro|690|701|sxt|ttr|tt-r|super ?sherpa|serow|xchallenge|scrambler 400)/i.test(t)) type = cc >= 600 && /klr/i.test(t) ? "mid" : "light";
    else if (/(adventure|\bgs\b|gs\b|tenere|ténéré|tiger|africa|transalp|v-?strom|versys|multistrada|norden|desert ?x|tuareg|pan america|stelvio|himalayan|\bmt\b|tracer|scrambler|rally|\bx\b|nx\s?\d|cb ?500 ?x|g ?310 ?gs)/i.test(t)) type = cc >= 1000 ? "big" : cc && cc < 450 ? "light" : "mid";
    const [kg, tank, l100] = SPEC[type];
    const kgCc = type === "street" && cc ? Math.round(Math.min(380, Math.max(110, 120 + cc * 0.1))) : kg;
    return [type, kgCc, tank, l100, false];
  }
  const typeOfKg = (kg) => (kg > 220 ? "big" : kg >= 170 ? "mid" : kg >= 130 ? "light" : "enduro");
  let bikes = store.get("motoBikes", []);
  let bikeId = store.get("motoBike", bikes[0] && bikes[0].id);
  const bike = () => bikes.find((b) => b.id === bikeId) || bikes[0] || null;
  const DEFAULT = { id: "", name: "", type: "mid", kg: 200, tank: 16, l100: 4.6, tires: "5050", skill: "some" };
  const cur = () => bike() || DEFAULT;
  const capOf = (b) => Math.max(1, Math.min(5, TYPES[b.type].base + SKILL[b.skill][0] + TIRES[b.tires][0]));
  const rangeOf = (b) => (b.range ? +b.range : Math.round(((+b.tank || 0) / (+b.l100 || TYPES[b.type].l100)) * 100));
  const RESERVE = 0.2;   // plan to have this much of the tank left when you reach gas
  const usable = (b) => Math.round(rangeOf(b) * (1 - RESERVE));
  const bikeLine = (b) => `${esc(TYPES[b.type].label)} · ${esc(TIRES[b.tires][1])} tires · about ${rangeOf(b).toLocaleString()} km a tank`;

  // ---------- grades ----------
  // How rough a road is, 1 to 5 (after OpenStreetMap's motorcycle:scale and riders' own scales: a route is as hard as
  // its hardest part you can't go around, and rain can make it a grade or two harder).
  const GRADES = {
    1: ["Paved", "Any bike"],
    2: ["Good gravel", "Graded gravel or packed dirt: fine on any ADV bike"],
    3: ["Rough gravel or two-track", "Loose gravel, potholes, a rough track: easy on a light bike, careful on a big one"],
    4: ["Rough two-track", "Rocks, ruts, sand or mud: for light bikes and good riders"],
    5: ["Very rough", "Big rocks, steep, washed out or deactivated: plated dirt bikes and experts"],
  };
  const FIT = { ok: ["Good for your bike", "#2f9e44"], hard: ["Hard for your bike", "#f08c00"], no: ["Too hard for your bike", "#e03131"] };
  const fitOf = (g, cap = capOf(cur())) => (g <= cap ? "ok" : g === cap + 1 ? "hard" : "no");
  // From the full OpenStreetMap tags of a road. Returns [grade, reasons].
  function gradeOfTags(t) {
    const why = [], sf = t.surface || "", sm = t.smoothness || "", tt = t.tracktype || "", hw = t.highway || "";
    let g = /^(asphalt|paved|concrete|chipseal|paving_stones)/.test(sf) ? 1 : /^(compacted|fine_gravel)$/.test(sf) ? 2 : /^(gravel|unpaved|pebblestone)$/.test(sf) ? 2 : /^(dirt|ground|earth|grass)$/.test(sf) ? 3 : /^(sand|mud|rock|stone)$/.test(sf) ? 4 : hw === "track" ? 3 : 2;
    if (sf) why.push(`surface ${sf.replace(/_/g, " ")}`);
    if (tt) { const n = +tt.slice(5); if (n) { g = Math.max(g, n <= 2 ? 2 : n === 3 ? 3 : 4); why.push(`track grade ${n} of 5`); } }
    if (sm) {
      const s = { excellent: 1, good: 1, intermediate: 2, bad: 3, very_bad: 4, horrible: 5, very_horrible: 5, impassable: 5 }[sm];
      if (s) { g = s >= 3 ? Math.max(g, s) : Math.min(g, Math.max(s, g === 1 ? 1 : 2)); why.push(`smoothness ${sm.replace(/_/g, " ")}`); }
    }
    if (t["4wd_only"] === "yes") { g = Math.max(g, 4); why.push("marked 4x4 only"); }
    const ms = t["motorcycle:scale"];
    if (ms != null && ms !== "" && !isNaN(+ms)) { g = Math.max(1, Math.min(5, Math.round(+ms) + 1)); why.push(`motorcycle scale ${ms}`); }
    if (t["disused:highway"] || t["abandoned:highway"]) { g = 5; why.push("mapped as disused or abandoned"); }
    if (/deactivat|washed? ?out|impassable/i.test([t.note, t.description].filter(Boolean).join(" "))) { g = 5; why.push("a note says it's deactivated or washed out"); }
    return [g, why];
  }
  // From the vector map tiles, which only say paved or unpaved and the road class.
  const gradeOfTile = (p) => (p.surface === "paved" ? 1 : p.class === "track" ? 3 : 2);
  // From Valhalla's trace attributes (a planned route).
  function gradeOfEdge(e) {
    let g = { paved_smooth: 1, paved: 1, paved_rough: 1, compacted: 2, gravel: 2, dirt: 3, path: 4, impassable: 5 }[e.surface] || (e.unpaved ? 2 : 1);
    if (e.use === "track") g = Math.max(g, 3);
    if (e.max_upward_grade >= 15 && g > 1) g = Math.min(5, g + 1);
    return g;
  }

  // ---------- map layers ----------
  const LAYERS = {
    roads: { g: "Roads", label: "Dirt roads for my bike", sub: "Gravel roads and tracks coloured for your bike (zoom in)", on: true, icon: ["#2f9e44", "line"] },
    mud: { g: "Roads", label: "Mud and dust today", sub: "Rain, soil moisture and snow, in squares", icon: ["#8b5a2b", "box"] },
    rules: { g: "Roads", label: "Where you can't ride", sub: "Parks, reserves and motor vehicle closures", on: true, minZoom: 7, icon: ["#e03131", "box"] },
    fuel: { g: "Stops", label: "Gas stations", sub: "All of Canada", on: true, minZoom: 7, icon: ["#1971c2", "dot"] },
    range: { g: "Stops", label: "My fuel range", sub: "How far a tank takes you from here (with 20% left)", on: true, icon: ["#1971c2", "ring"] },
    camp: { g: "Stops", label: "Campsites, huts and rec sites", sub: "Free BC rec sites marked", on: true, minZoom: 8, icon: ["#2b8a3e", "dot"] },
    hot: { g: "Stops", label: "Hot springs", sub: "", on: true, minZoom: 7, icon: ["#e64980", "dot"] },
    shop: { g: "Stops", label: "Moto shops", sub: "Dealers and repair", minZoom: 8, icon: ["#5f3dc4", "dot"] },
    ferry: { g: "Stops", label: "Ferries", sub: "Landings, inland ferries too", on: true, minZoom: 7, icon: ["#0b7285", "dot"] },
    cell: { g: "Safety", label: "Cell signal on roads", sub: "LTE or 5G from any carrier (ISED). No shading: likely no signal", minZoom: 8, icon: ["#4c6ef5", "box"] },
  };
  const GROUPS = ["Roads", "Stops", "Safety"];
  const VIEWS = {
    roads: { label: "Roads", sub: "for my bike", layers: ["roads", "rules", "fuel", "ferry"] },
    mud: { label: "Mud", sub: "today", layers: ["roads", "mud"] },
    stops: { label: "Fuel & camp", sub: "range, sleep", layers: ["roads", "fuel", "range", "camp", "hot", "ferry"] },
    rules: { label: "Rules", sub: "can I ride", layers: ["roads", "rules"] },
  };
  let shown = new Set(store.get("motoLayers", Object.keys(LAYERS).filter((k) => LAYERS[k].on)));

  // ---------- look ----------
  const css = document.createElement("style");
  css.textContent = `
body:not(.sport-moto) #motoPane, body:not(.sport-moto) .lm-moto, body:not(.sport-moto) .mt-mapkey, body:not(.sport-moto) .mt-planbar { display: none !important; }
body.sport-moto .leaflet-allTrails-pane, body.sport-moto .leaflet-boxTrails-pane, body.sport-moto .leaflet-newTrails-pane, body.sport-moto .leaflet-onewayArrows-pane,
body.sport-moto .leaflet-ridesPane-pane { display: none; }
.lm-moto { display: flex; flex-direction: column; }
.lm-moto .mt-group { margin: 0; font-size: .66rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding-top: 6px; }
:is(#motoPane, .lm-moto) .mt-layer { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: center; padding: 5px 0; cursor: pointer; }
:is(#motoPane, .lm-moto) .mt-layer b { display: block; font-size: .86rem; }
:is(#motoPane, .lm-moto) .mt-layer small { display: block; color: var(--muted); font-size: .74rem; line-height: 1.25; }
:is(#motoPane, .lm-moto) .mt-ic { width: 22px; height: 22px; border-radius: 6px; display: block; box-sizing: border-box; }
:is(#motoPane, .lm-moto) .mt-sw { appearance: none; -webkit-appearance: none; width: 40px; height: 24px; border-radius: 999px; background: var(--line); position: relative; cursor: pointer; margin: 0; flex: none; transition: background .15s; }
:is(#motoPane, .lm-moto) .mt-sw::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px #0004; transition: left .15s; }
:is(#motoPane, .lm-moto) .mt-sw:checked { background: ${ACC}; }
:is(#motoPane, .lm-moto) .mt-sw:checked::after { left: 19px; }
#motoPane { display: flex; flex-direction: column; gap: 12px; font-size: .9rem; }
#motoPane a { color: var(--accent); }
#motoPane .mt-note { color: var(--muted); font-size: .76rem; margin: 0; }
#motoPane .mt-actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
#motoPane .mt-act { font: inherit; font-size: .74rem; font-weight: 700; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; min-height: 58px; padding: 6px 4px;
  border-radius: 12px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; text-align: center; line-height: 1.15; }
#motoPane .mt-act svg { color: ${ACC}; }
#motoPane .mt-act.on { background: ${ACC}; border-color: ${ACC}; color: #fff; }
#motoPane .mt-act.on svg { color: #fff; }
#motoPane .mt-act:active { transform: scale(.97); }
#motoPane .mt-bike { font: inherit; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 2px 10px; align-items: center; text-align: left; width: 100%; padding: 10px 12px; border-radius: 12px;
  border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
#motoPane .mt-bike svg { color: ${ACC}; grid-row: 1 / span 2; }
#motoPane .mt-bike b { font-size: .9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#motoPane .mt-bike small { grid-column: 2; color: var(--muted); font-size: .76rem; }
#motoPane .mt-bike em { grid-column: 3; grid-row: 1 / span 2; font-style: normal; font-size: .78rem; font-weight: 700; color: ${ACC}; }
#motoPane .mt-bike.setup { border: 2px dashed ${ACC}; background: color-mix(in srgb, ${ACC} 8%, var(--panel)); }
#motoPane .mt-now { font: inherit; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; text-align: left; width: 100%; padding: 9px 12px; border-radius: 12px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); font-size: .82rem; box-sizing: border-box; }
#motoPane .mt-now span { display: inline-flex; align-items: center; gap: 5px; }
#motoPane .mt-card { border: 1px solid var(--line); border-radius: 14px; padding: 12px; background: var(--panel); display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm); }
#motoPane .mt-card header { display: flex; align-items: center; gap: 8px; }
#motoPane .mt-card header svg { color: ${ACC}; flex: none; }
#motoPane .mt-card h3 { margin: 0; font-size: .95rem; font-weight: 800; flex: 1; min-width: 0; }
#motoPane .mt-card h4 { margin: 4px 0 0; font-size: .72rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
#motoPane .mt-card p { margin: 0; font-size: .84rem; }
#motoPane .mt-x { font: inherit; border: 0; background: var(--chip); color: var(--muted); cursor: pointer; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; flex: none; }
#motoPane .mt-views { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
#motoPane .mt-view { font: inherit; font-size: .8rem; font-weight: 700; padding: 8px 4px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 1px; }
#motoPane .mt-view small { font-weight: 500; font-size: .68rem; color: var(--muted); }
#motoPane .mt-view.on { background: ${ACC}; border-color: ${ACC}; color: #fff; }
#motoPane .mt-view.on small { color: #fff; }
#motoPane .mt-pill { font: inherit; font-size: .78rem; font-weight: 700; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
#motoPane .mt-pill svg { color: ${ACC}; }
#motoPane .mt-pill.on { background: ${ACC}; border-color: ${ACC}; color: #fff; }
#motoPane .mt-pill.on svg { color: #fff; }
#motoPane .mt-pill.go { background: ${ACC}; border-color: ${ACC}; color: #fff; }
#motoPane .mt-pill.go svg { color: #fff; }
#motoPane .mt-pill:disabled { opacity: .5; cursor: default; }
#motoPane .mt-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#motoPane .mt-badge { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; font-size: .84rem; padding: 4px 10px; border-radius: 999px; color: #fff; background: var(--c); }
#motoPane .mt-light { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 1.5px #fff, 0 0 0 2.5px var(--c); flex: none; }
#motoPane ul.mt-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
#motoPane ul.mt-list li { border-left: 4px solid var(--c, var(--line)); padding-left: 9px; font-size: .84rem; }
#motoPane ul.mt-list li > b { display: block; }
#motoPane ul.mt-list li small { color: var(--muted); display: block; }
#motoPane ul.mt-list button.mt-go { font: inherit; text-align: left; width: 100%; border: 0; background: none; color: inherit; padding: 0; cursor: pointer; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 8px; }
#motoPane ul.mt-list button.mt-go b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#motoPane ul.mt-list button.mt-go small { grid-column: 1; }
#motoPane ul.mt-list button.mt-go em { grid-column: 2; grid-row: 1 / span 2; align-self: center; font-style: normal; font-size: .78rem; color: var(--muted); white-space: nowrap; }
#motoPane .mt-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
#motoPane .mt-stats div { background: var(--chip); border-radius: 10px; padding: 6px 4px; text-align: center; display: flex; flex-direction: column; gap: 1px; }
#motoPane .mt-stats b { font-size: .92rem; }
#motoPane .mt-stats span { font-size: .64rem; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
#motoPane .mt-bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--line); }
#motoPane .mt-bar i { display: block; height: 100%; }
#motoPane .mt-warn { border-left: 4px solid #e03131; background: color-mix(in srgb, #e03131 8%, var(--panel)); padding: 6px 9px; border-radius: 0 8px 8px 0; font-size: .82rem; }
#motoPane .mt-warn.hard { border-left-color: #f08c00; background: color-mix(in srgb, #f08c00 9%, var(--panel)); }
#motoPane .mt-warn.ok { border-left-color: #2f9e44; background: color-mix(in srgb, #2f9e44 8%, var(--panel)); }
#motoPane .mt-warn button { font: inherit; border: 0; background: none; color: var(--accent); text-decoration: underline; padding: 0; cursor: pointer; }
#motoPane details.mt-fold { border-top: 1px solid var(--line); padding-top: 6px; }
#motoPane details.mt-fold summary { cursor: pointer; font-weight: 700; font-size: .82rem; }
#motoPane details.mt-fold[open] summary { margin-bottom: 6px; }
#motoPane .mt-seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
#motoPane .mt-seg button { font: inherit; font-size: .78rem; font-weight: 700; padding: 7px 4px; border-radius: 9px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; line-height: 1.15; }
#motoPane .mt-seg button small { display: block; font-weight: 500; font-size: .66rem; color: var(--muted); }
#motoPane .mt-seg button.on { background: ${ACC}; border-color: ${ACC}; color: #fff; }
#motoPane .mt-seg button.on small { color: #fff; }
#motoPane .mt-safe { color: var(--muted); margin: 0; font-size: .76rem; line-height: 1.4; }
#motoPane .mt-safe summary { cursor: pointer; }
dialog.mt-dlg { border: 0; border-radius: 16px; padding: 0; width: min(440px, calc(100vw - 24px)); max-height: calc(100dvh - 40px); background: var(--panel); color: var(--fg); box-shadow: 0 12px 40px #0006; }
dialog.mt-dlg::backdrop { background: #0007; }
dialog.mt-dlg form { display: flex; flex-direction: column; gap: 10px; padding: 16px; font-size: .9rem; }
dialog.mt-dlg h2 { margin: 0; font-size: 1.05rem; display: flex; justify-content: space-between; align-items: center; }
dialog.mt-dlg label { display: flex; flex-direction: column; gap: 3px; font-weight: 700; font-size: .8rem; }
dialog.mt-dlg input, dialog.mt-dlg select { font: inherit; font-weight: 500; font-size: 1rem; padding: 9px 10px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); min-width: 0; }
dialog.mt-dlg .mt-unit { display: inline-flex; margin-left: 4px; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; vertical-align: middle; }
dialog.mt-dlg .mt-unit button { font: inherit; font-size: .7rem; font-weight: 700; border: 0; background: var(--panel); color: var(--muted); padding: 1px 7px; cursor: pointer; }
dialog.mt-dlg .mt-unit button.on { background: ${ACC}; color: #fff; }
dialog.mt-dlg .mt-ymm { grid-template-columns: 76px minmax(0, 1fr) minmax(0, 1.4fr); }
dialog.mt-dlg .mt-ymm select { padding: 9px 4px; font-size: .9rem; }
dialog.mt-dlg .mt-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
dialog.mt-dlg .mt-seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
dialog.mt-dlg .mt-seg button { font: inherit; font-size: .82rem; font-weight: 700; padding: 9px 4px; border-radius: 9px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
dialog.mt-dlg .mt-seg button.on { background: ${ACC}; border-color: ${ACC}; color: #fff; }
dialog.mt-dlg .mt-types { display: flex; flex-direction: column; gap: 4px; }
dialog.mt-dlg .mt-types button { font: inherit; text-align: left; padding: 8px 10px; border-radius: 9px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
dialog.mt-dlg .mt-types button b { display: block; font-size: .86rem; }
dialog.mt-dlg .mt-types button small { color: var(--muted); font-size: .74rem; }
dialog.mt-dlg .mt-types button.on { border: 2px solid ${ACC}; background: color-mix(in srgb, ${ACC} 10%, var(--panel)); }
dialog.mt-dlg .mt-sum { background: var(--chip); border-radius: 10px; padding: 8px 10px; font-size: .84rem; }
dialog.mt-dlg .mt-bikes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
dialog.mt-dlg .mt-bikes button { font: inherit; width: 100%; text-align: left; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
dialog.mt-dlg .mt-bikes button.on { border: 2px solid ${ACC}; }
dialog.mt-dlg .mt-bikes small { display: block; color: var(--muted); font-size: .76rem; }
dialog.mt-dlg .mt-btns { display: flex; gap: 8px; flex-wrap: wrap; }
dialog.mt-dlg .mt-btns button { font: inherit; font-weight: 700; padding: 10px 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
dialog.mt-dlg .mt-btns button.go { background: ${ACC}; border-color: ${ACC}; color: #fff; flex: 1; }
dialog.mt-dlg .mt-btns button.del { color: #c92a2a; }
dialog.mt-dlg .mt-note { color: var(--muted); font-size: .76rem; margin: 0; }
dialog.mt-dlg .mt-xb { font: inherit; border: 0; background: var(--chip); color: var(--muted); cursor: pointer; width: 32px; height: 32px; border-radius: 50%; }
.mt-mapkey .mt-keybtn { font: inherit; font-weight: 800; display: inline-flex; align-items: center; gap: 5px; padding: 7px 11px; border-radius: 999px; border: 0; background: #fff; color: #212529; box-shadow: 0 1px 4px #0004; cursor: pointer; font-size: 12px; }
.mt-mapkey .mt-keybtn svg { color: ${ACC}; }
.mt-mapkey .mt-keybox { margin-top: 6px; background: #fff; color: #212529; border-radius: 12px; padding: 8px 10px; box-shadow: 0 2px 10px #0004; width: min(250px, calc(100vw - 40px)); max-height: 45vh; overflow: auto; font: 500 11px/1.35 var(--font-body, system-ui); }
.mt-mapkey .mt-keybox b { display: block; margin: 4px 0 2px; font-size: 11px; }
.mt-mapkey .mt-keybox i { display: inline-block; width: 14px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.mt-mapkey .mt-keybox i.d { width: 10px; border-radius: 50%; }
.mapwrap.is3d .mt-mapkey { margin-bottom: 46px; }
.mt-pin { width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; display: grid; place-items: center; color: #fff; font: 800 11px/1 system-ui, sans-serif; box-shadow: 0 0 0 2px #fff, 0 1px 4px #0006; }
.mt-wp { width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; background: ${ACC}; color: #fff; display: grid; place-items: center; font: 800 12px/1 system-ui, sans-serif; box-shadow: 0 0 0 2.5px #fff, 0 1px 5px #0007; }
.mt-wp.end { background: #212529; }
.mt-mud { font: 800 10px/1.1 system-ui, sans-serif; color: #fff; text-shadow: 0 0 3px #000, 0 0 2px #000; white-space: nowrap; transform: translate(-50%, -50%); pointer-events: none; }
.mt-planbar { position: absolute; z-index: 1000; left: 50%; top: 12px; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; white-space: nowrap;
  background: var(--panel); color: var(--fg); border: 2px solid ${ACC}; border-radius: 999px; box-shadow: 0 6px 18px rgba(0,0,0,.25); padding: 6px 6px 6px 14px; font-size: .86rem; font-weight: 700; }
.mt-planbar button { font: inherit; border: 1px solid var(--line); border-radius: 999px; background: var(--chip); color: var(--fg); padding: 6px 12px; cursor: pointer; }
.mt-planbar button.go { background: ${ACC}; border-color: ${ACC}; color: #fff; }
@media (max-width: 760px) { .mt-planbar { top: calc(env(safe-area-inset-top, 0px) + 84px); left: 12px; right: 12px; transform: none; justify-content: space-between; white-space: normal; } }
body.sport-moto .nav-strip button { min-height: 48px; }
#motoPane .mt-saferow .mt-pill { flex: 1; justify-content: center; }
#motoPane .mt-saferow .mt-pill.armed { border-color: #2f9e44; color: #2b8a3e; }
#motoPane .mt-saferow .mt-pill.armed svg { color: #2f9e44; }
#motoPane .mt-chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
#motoPane .mt-chips button { font: inherit; font-size: .76rem; font-weight: 700; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; white-space: nowrap; }
#motoPane .mt-chips button.on { background: ${ACC}; border-color: ${ACC}; color: #fff; }
#motoPane .mt-g { display: inline-block; min-width: 18px; padding: 0 5px; border-radius: 6px; color: #fff; font-weight: 800; font-size: .72rem; text-align: center; background: var(--c); margin-right: 4px; }
.mt-alarm { position: fixed; inset: 0; z-index: 4000; background: #c92a2a; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px; text-align: center; font: 600 1rem/1.4 var(--font-body, system-ui); }
.mt-alarm h2 { margin: 0; font-size: 2rem; }
.mt-alarm .big { font: inherit; font-size: 1.4rem; font-weight: 800; padding: 18px 40px; border-radius: 999px; border: 0; background: #fff; color: #c92a2a; cursor: pointer; }
.mt-alarm a, .mt-alarm button.sec { font: inherit; color: #fff; background: #0003; border: 2px solid #fff; border-radius: 999px; padding: 10px 18px; text-decoration: none; cursor: pointer; }
.mt-alarm .count { font-size: 3rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.mt-flybar { position: absolute; z-index: 1000; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; background: var(--panel); color: var(--fg); border: 2px solid ${ACC}; border-radius: 999px; padding: 6px 6px 6px 14px; font-size: .86rem; font-weight: 700; box-shadow: 0 6px 18px rgba(0,0,0,.25); white-space: nowrap; }
.mt-flybar button { font: inherit; border: 1px solid var(--line); border-radius: 999px; background: var(--chip); color: var(--fg); padding: 6px 12px; cursor: pointer; }
.mt-flybar button.go { background: ${ACC}; border-color: ${ACC}; color: #fff; }
body:not(.sport-moto) .mt-flybar { display: none !important; }
@media (max-width: 760px) { .mt-flybar { bottom: calc(var(--sheet-peek, 140px) + 12px); } }`;
  document.head.append(css);

  // ---------- panel ----------
  const pane = document.createElement("section");
  pane.id = "motoPane";
  pane.setAttribute("aria-label", "Moto");
  pane.innerHTML = `
    <div class="mt-actions" role="toolbar" aria-label="Moto tools">
      <button type="button" class="mt-act" data-act="plan">${svg(IC.plan)}Plan a route</button>
      <button type="button" class="mt-act" data-act="stops">${svg(IC.fuel)}Fuel &amp; camp</button>
      <button type="button" class="mt-act" data-act="mud">${svg(IC.drop)}Mud today</button>
      <button type="button" class="mt-act" data-act="ride">${svg(IC.ride)}Ride</button>
    </div>
    <button type="button" class="mt-bike" id="mtBike"></button>
    <div class="mt-now" id="mtNow" role="status"><span>Checking today's dirt…</span></div>
    <div class="mt-row mt-saferow" id="mtSafeRow"></div>
    <div class="mt-card" id="mtTrips" hidden></div>
    <div class="mt-card" id="mtLog" hidden></div>
    <div class="mt-card" id="mtRoute" hidden></div>
    <div class="mt-card" id="mtSpot" hidden></div>
    <div class="mt-card" id="mtNear" hidden></div>
    <div class="mt-card" id="mtMap"><header>${svg(IC.layers)}<h3>Map</h3></header>
      <div class="mt-views" role="group" aria-label="Map views">${Object.entries(VIEWS).map(([k, v]) => `<button type="button" class="mt-view" data-view="${k}">${esc(v.label)}<small>${esc(v.sub)}</small></button>`).join("")}</div>
      <p class="mt-note" id="mtZoomNote"></p>
      <div class="mt-row"><button type="button" class="mt-pill" id="mtAll">${svg(IC.layers, 16)}All moto layers</button><button type="button" class="mt-pill" id="mtRoutesBtn">${svg(IC.save, 16)}Saved routes</button><button type="button" class="mt-pill" id="mtTripsBtn">${svg(IC.trips, 16)}ADV routes</button><button type="button" class="mt-pill" id="mtLogBtn">${svg(IC.log, 16)}My moto rides</button></div></div>
    <details class="mt-safe"><summary>A guide, not the law</summary>Road surfaces and grades come from OpenStreetMap and can be out of date: a road can wash out or be deactivated any day. Closures, parks and land rules come from the provinces' and Canada's open data and are simplified. Check posted signs, BC's resource road notices, Alberta's Public Land Use Zones, your province's off-highway vehicle rules, and ride to the conditions.</details>`;
  const lmMoto = document.createElement("div");
  lmMoto.className = "lm-moto";
  lmMoto.innerHTML = `<div class="lm-head">Moto layers</div><p class="mt-note" id="mtLayerNote" style="margin:0;font-size:.74rem;color:var(--muted)"></p><div id="mtLayerList"></div>`;
  const lmStyle = document.querySelector("#layersMenu .lm-style");
  if (lmStyle) lmStyle.after(lmMoto); else pane.append(lmMoto);
  const head = document.querySelector(".panel-head");
  const after = $("fishPane") || $("huntPane") || $("skiPane"), modes = head && head.querySelector(".modes");
  if (after) after.after(pane); else if (modes) modes.after(pane); else if (head) head.append(pane);
  let hintTimer = 0;
  function hint(text) {
    let el = $("mtHint");
    if (!el) { el = document.createElement("p"); el.id = "mtHint"; el.className = "mt-note"; el.setAttribute("role", "status"); pane.querySelector(".mt-actions").after(el); }
    el.textContent = text;
    clearTimeout(hintTimer); hintTimer = setTimeout(() => el.remove(), 7000);
  }
  const showCard = (el) => { if (window.tfPanelScrollTo) window.tfPanelScrollTo(el); };
  const toPanel = () => { const t = document.querySelector('#tabbar [data-nav="moto"]'); if (phone() && t && t.getAttribute("aria-current") !== "true") t.click(); };

  // ---------- my bike ----------
  function renderBike() {
    const b = bike(), el = $("mtBike");
    el.classList.toggle("setup", !b);
    el.innerHTML = b
      ? `${svg(IC.moto, 24)}<b>${esc(b.name || TYPES[b.type].label)}</b><small>${bikeLine(b)}</small><em>Change</em>`
      : `${svg(IC.moto, 24)}<b>Set up your bike</b><small>So the roads, routes and fuel range fit your bike and your riding</small><em>Start</em>`;
  }
  const dlg = document.createElement("dialog");
  dlg.className = "mt-dlg"; dlg.id = "mtBikeDlg";
  document.body.append(dlg);
  let edit = null;   // the bike in the form
  function openBikes() {
    if (!bikes.length) return editBike(null);
    dlg.innerHTML = `<form method="dialog"><h2>My bikes <button type="button" class="mt-xb" data-x aria-label="Close">✕</button></h2>
      <p class="mt-note">The one you pick sets the road colours, the routes and the fuel range.</p>
      <ul class="mt-bikes">${bikes.map((b) => `<li><button type="button" data-pick="${esc(b.id)}" class="${b.id === bike().id ? "on" : ""}"><b>${b.id === bike().id ? "✓ " : ""}${esc(b.name || TYPES[b.type].label)}</b><small>${bikeLine(b)} · ${esc(SKILL[b.skill][1])}</small></button></li>`).join("")}</ul>
      <div class="mt-btns"><button type="button" data-edit>Edit this bike</button><button type="button" data-add>+ Add a bike</button></div></form>`;
    dlg.querySelector("[data-x]").onclick = () => dlg.close();
    dlg.querySelectorAll("[data-pick]").forEach((x) => (x.onclick = () => { bikeId = x.dataset.pick; store.set("motoBike", bikeId); bikeChanged(); openBikes(); }));
    dlg.querySelector("[data-edit]").onclick = () => editBike(bike());
    dlg.querySelector("[data-add]").onclick = () => editBike(null);
    if (!dlg.open) dlg.showModal();
  }
  function editBike(b) {
    edit = b ? { ...b } : { ...DEFAULT, id: Date.now().toString(36), name: "" };
    const lb = () => store.get("motoLb", false), KG_LB = 2.20462;
    const kgShow = (kg) => (lb() ? Math.round(kg * KG_LB) : Math.round(kg));
    dlg.innerHTML = `<form method="dialog"><h2>${b ? "Edit your bike" : "Your bike"} <button type="button" class="mt-xb" data-x aria-label="Close">✕</button></h2>
      <div class="mt-3 mt-ymm"><label>Year<select id="mtYear">${Array.from({ length: new Date().getFullYear() + 2 - 1981 }, (_, i) => new Date().getFullYear() + 1 - i).map((y) => `<option value="${y}"${y === (edit.year || new Date().getFullYear()) ? " selected" : ""}>${y}</option>`).join("")}</select></label>
        <label>Make<select id="mtMake"><option value="">Pick…</option>${MAKES.map((m) => `<option${m === edit.make ? " selected" : ""}>${esc(m)}</option>`).join("")}<option value="other">Another make</option></select></label>
        <label>Model<select id="mtModel" disabled><option value="">Pick the make</option></select></label></div>
      <p class="mt-note" id="mtSpecNote">Pick your bike to fill in its numbers.</p>
      <label>Name<input id="mtName" maxlength="40" placeholder="My Ténéré" value="${esc(edit.name)}" autocomplete="off"></label>
      <div><b style="font-size:.8rem">Kind of bike</b><div class="mt-types" id="mtTypes">${Object.entries(TYPES).map(([k, t]) => `<button type="button" data-type="${k}"><b>${esc(t.label)}</b><small>${esc(t.sub)}</small></button>`).join("")}</div></div>
      <div class="mt-3"><label><span>Weight <span class="mt-unit" id="mtUnit"><button type="button" data-u="kg">kg</button><button type="button" data-u="lb">lb</button></span></span><input id="mtKg" type="number" inputmode="decimal" min="60" max="1000" value="${kgShow(edit.kg)}"></label>
        <label>Tank (litres)<input id="mtTank" type="number" inputmode="decimal" min="3" max="45" step="0.1" value="${edit.tank}"></label>
        <label>L / 100 km<input id="mtL100" type="number" inputmode="decimal" min="1.5" max="12" step="0.1" value="${edit.l100}"></label></div>
      <label>Range on a tank (km, optional: if you know it)<input id="mtRange" type="number" inputmode="numeric" min="40" max="1200" value="${edit.range || ""}" placeholder="Worked out from the tank"></label>
      <div><b style="font-size:.8rem">Tires</b><div class="mt-seg" id="mtTires">${Object.entries(TIRES).map(([k, t]) => `<button type="button" data-tire="${k}">${esc(t[1])}</button>`).join("")}</div></div>
      <div><b style="font-size:.8rem">Your dirt riding</b><div class="mt-seg" id="mtSkill">${Object.entries(SKILL).map(([k, s]) => `<button type="button" data-skill="${k}">${esc(s[1])}</button>`).join("")}</div></div>
      <div class="mt-sum" id="mtSum"></div>
      <p class="mt-note">Weights and tanks in the list are about the makers' numbers: change them for your own bike (bigger tank, luggage).</p>
      <div class="mt-btns"><button type="button" class="go" data-save>Save</button>${b && bikes.length > 1 ? `<button type="button" class="del" data-del>Delete</button>` : ""}</div></form>`;
    const q = (s) => dlg.querySelector(s);
    const sync = () => {
      dlg.querySelectorAll("[data-type]").forEach((x) => x.classList.toggle("on", x.dataset.type === edit.type));
      dlg.querySelectorAll("[data-tire]").forEach((x) => x.classList.toggle("on", x.dataset.tire === edit.tires));
      dlg.querySelectorAll("[data-skill]").forEach((x) => x.classList.toggle("on", x.dataset.skill === edit.skill));
      const cap = capOf(edit);
      q("#mtSum").innerHTML = `<b>Rides well:</b> up to grade ${cap}, ${esc(GRADES[cap][0].toLowerCase())}${cap < 5 ? `; grade ${cap + 1} is hard, more is too hard` : ""}.<br><b>Range:</b> about ${rangeOf(edit).toLocaleString()} km a tank; routes warn when gas is more than ${usable(edit).toLocaleString()} km apart.`;
    };
    q("[data-x]").onclick = () => dlg.close();
    const fillModels = async () => {
      const make = q("#mtMake").value, year = +q("#mtYear").value, sel = q("#mtModel");
      edit.year = year;
      if (!make || make === "other") { sel.disabled = true; sel.innerHTML = `<option value="">${make ? "Type it in Name" : "Pick the make"}</option>`; if (make === "other") q("#mtName").focus(); return; }
      edit.make = make;
      sel.disabled = true; sel.innerHTML = `<option value="">Loading…</option>`;
      const list = await modelsFor(make, year);
      if (q("#mtMake").value !== make || +q("#mtYear").value !== year) return;
      const known = MODELS.filter((x) => norm(x[0]).startsWith(norm(make))).map((x) => x[0].slice(x[0].indexOf(" ") + 1));
      const names = list && list.length ? list : known;
      sel.innerHTML = `<option value="">${list ? `${names.length} models…` : "Offline: our list…"}</option>${names.map((n) => `<option${n === edit.model ? " selected" : ""}>${esc(n)}</option>`).join("")}<option value="other">Not listed: I'll type it</option>`;
      sel.disabled = false;
    };
    q("#mtYear").onchange = fillModels;
    q("#mtMake").onchange = () => { edit.model = ""; fillModels(); };
    q("#mtModel").onchange = (e) => {
      const model = e.target.value, make = q("#mtMake").value;
      if (!model) return;
      if (model === "other") { q("#mtName").focus(); return; }
      const [type, kg, tank, l100, known] = specsOf(make, model);
      edit.model = model; edit.type = type; edit.kg = kg; edit.tank = tank; edit.l100 = l100; delete edit.range;
      edit.name = `${q("#mtYear").value} ${make} ${model}`;
      q("#mtName").value = edit.name; q("#mtKg").value = kgShow(kg); q("#mtTank").value = tank; q("#mtL100").value = l100; q("#mtRange").value = "";
      q("#mtSpecNote").textContent = known ? "Numbers filled in from the maker's specs (about): change them for your bike." : `We don't have this one's specs: these are typical for a ${TYPES[type].label.toLowerCase()} bike. Check your manual and fix them.`;
      sync();
    };
    if (edit.make) fillModels();
    q("#mtName").oninput = (e) => { edit.name = e.target.value.trim(); };
    const unitSync = () => dlg.querySelectorAll("[data-u]").forEach((x) => x.classList.toggle("on", (x.dataset.u === "lb") === lb()));
    unitSync();
    q("#mtUnit").onclick = (e) => { const x = e.target.closest("[data-u]"); if (!x) return; store.set("motoLb", x.dataset.u === "lb"); q("#mtKg").value = kgShow(edit.kg); unitSync(); };
    q("#mtKg").oninput = (e) => { const kg = +e.target.value / (lb() ? KG_LB : 1); if (kg > 50) { edit.kg = kg; if (edit.type !== "street") edit.type = typeOfKg(kg); sync(); } };
    q("#mtTank").oninput = (e) => { edit.tank = +e.target.value || edit.tank; sync(); };
    q("#mtL100").oninput = (e) => { edit.l100 = +e.target.value || edit.l100; sync(); };
    q("#mtRange").oninput = (e) => { const r = +e.target.value; if (r >= 40) edit.range = r; else delete edit.range; sync(); };
    q("#mtTypes").onclick = (e) => { const x = e.target.closest("[data-type]"); if (x) { edit.type = x.dataset.type; sync(); } };
    q("#mtTires").onclick = (e) => { const x = e.target.closest("[data-tire]"); if (x) { edit.tires = x.dataset.tire; sync(); } };
    q("#mtSkill").onclick = (e) => { const x = e.target.closest("[data-skill]"); if (x) { edit.skill = x.dataset.skill; sync(); } };
    q("[data-save]").onclick = () => {
      const i = bikes.findIndex((x) => x.id === edit.id);
      if (i >= 0) bikes[i] = edit; else bikes.push(edit);
      bikeId = edit.id; store.set("motoBikes", bikes); store.set("motoBike", bikeId);
      dlg.close(); bikeChanged();
    };
    const del = q("[data-del]");
    if (del) del.onclick = () => {
      if (!confirm(`Delete ${edit.name || "this bike"}?`)) return;
      bikes = bikes.filter((x) => x.id !== edit.id); bikeId = bikes[0] && bikes[0].id;
      store.set("motoBikes", bikes); store.set("motoBike", bikeId); dlg.close(); bikeChanged();
    };
    sync();
    if (!dlg.open) dlg.showModal();
  }
  $("mtBike").addEventListener("click", openBikes);
  function bikeChanged() {
    renderBike(); paintRoads(); drawRange(); renderKey(); renderTrips();
    if (route) renderRoute();
    if (spot) renderSpot();
  }

  // ---------- dirt roads (vector tiles) ----------
  // OpenFreeMap's tiles have every road's class and whether it's paved: unpaved roads come at zoom 11-12, tracks at 13.
  const ROAD_CLASSES = ["track", "minor", "service", "tertiary", "secondary", "primary", "trunk"];
  const ROAD_FILTER = ["all", ["in", ["get", "class"], ["literal", ROAD_CLASSES]], ["any", ["==", ["get", "class"], "track"], ["==", ["get", "surface"], "unpaved"]], ["!=", ["get", "brunnel"], "tunnel"]];
  function roadPaint() {
    const cap = capOf(cur()), col = (g) => FIT[fitOf(g, cap)][1];
    return ["case", ["==", ["get", "class"], "track"], col(3), col(2)];
  }
  function roadLayers(src, prefix) {
    const width = ["interpolate", ["linear"], ["zoom"], 9, 1.2, 12, 2.6, 15, 4.5];
    return [
      { id: prefix + "case", type: "line", source: src, "source-layer": "transportation", filter: ROAD_FILTER, layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#fff", "line-opacity": 0.85, "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2.6, 12, 4.6, 15, 7] } },
      { id: prefix + "road", type: "line", source: src, "source-layer": "transportation", filter: ["all", ROAD_FILTER, ["!=", ["get", "class"], "track"]], layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": roadPaint(), "line-width": width } },
      { id: prefix + "track", type: "line", source: src, "source-layer": "transportation", filter: ["all", ROAD_FILTER, ["==", ["get", "class"], "track"]], layout: { "line-join": "round" },
        paint: { "line-color": roadPaint(), "line-width": width, "line-dasharray": [2, 1] } },
    ];
  }
  map.createPane("motoGL").style.zIndex = 360;
  map.getPane("motoGL").style.pointerEvents = "none";
  let gl = null, glLoading = null;
  async function showRoads(on) {
    if (!on) { if (gl) { map.removeLayer(gl); gl = null; } return; }
    if (gl || glLoading) return;
    glLoading = window.tfLoadVectorLib ? window.tfLoadVectorLib().catch(() => null) : Promise.resolve(null);
    await glLoading; glLoading = null;
    if (!isMoto() || !shown.has("roads") || gl || !L.maplibreGL) return;
    gl = L.maplibreGL({ pane: "motoGL", interactive: false, attributionControl: false, style: { version: 8, sources: { m: OFM }, layers: roadLayers("m", "mt-") } }).addTo(map);
  }
  // BC's forest service and other resource roads (DataBC FTEN), drawn from zoom 9: the OpenStreetMap tiles above only
  // carry dirt roads from zoom 13 and tracks from 14, too close in to plan a day. Coloured like a good gravel road for
  // your bike (most are), since the map image can't say which; tap one for its own details.
  const FTEN = "pub:WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW";
  const ftenSld = () => `<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld"><NamedLayer><Name>${FTEN}</Name><UserStyle><FeatureTypeStyle><Rule><LineSymbolizer><Stroke><CssParameter name="stroke">${FIT[fitOf(2, capOf(cur()))][1]}</CssParameter><CssParameter name="stroke-width">2</CssParameter><CssParameter name="stroke-opacity">0.8</CssParameter></Stroke></LineSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`;
  const ftenLayer = L.tileLayer.wms("https://openmaps.gov.bc.ca/geo/pub/wms", { layers: FTEN, styles: "", format: "image/png", transparent: true, SLD_BODY: ftenSld(), minZoom: 9, maxZoom: 19, pane: "motoGL", bounds: L.latLngBounds([48.2, -139.1], [60, -114]), attribution: "DataBC" });
  function paintRoads() {
    if (ftenLayer._map) ftenLayer.setParams({ SLD_BODY: ftenSld() });
    if (gl3 && gl3.getSource && gl3.getSource("mt-ften") && gl3.__mtSld !== ftenSld()) sync3d();
    const g = gl && gl.getMaplibreMap && gl.getMaplibreMap(), paint = roadPaint();
    for (const m of [g, gl3]) {
      if (!m || !m.getLayer) continue;
      for (const id of ["mt-road", "mt-track"]) if (m.getLayer(id)) m.setPaintProperty(id, "line-color", paint);
    }
  }
  // The dirt road under a point of the map, from the drawn tiles: { name, class, surface } or null.
  function tileRoadAt(lat, lon, px = 12) {
    const m = gl && gl.getMaplibreMap && gl.getMaplibreMap();
    if (!m || !m.getLayer("mt-road")) return null;
    try {
      const p = m.project([lon, lat]);
      const hits = m.queryRenderedFeatures([[p.x - px, p.y - px], [p.x + px, p.y + px]], { layers: ["mt-road", "mt-track"] });
      return hits.length ? { ...hits[0].properties } : null;
    } catch { return null; }
  }

  // ---------- points: gas, camping, hot springs, shops, ferries ----------
  const PT = {
    fuel: { c: "#1971c2", t: "⛽", name: "Gas station" }, camp: { c: "#2b8a3e", t: "⛺", name: "Campsite" }, rec: { c: "#2b8a3e", t: "⛺", name: "BC rec site" },
    hot: { c: "#e64980", t: "♨", name: "Hot spring" }, shop: { c: "#5f3dc4", t: "🔧", name: "Moto shop" }, ferry: { c: "#0b7285", t: "⛴", name: "Ferry" },
  };
  const pts = { fuel: null, camp: null, hot: null, shop: null, ferry: null };   // [[lat, lon, name, extra]] for all of Canada, or null
  const ptsGot = {}, live = { fuel: new Map(), camp: new Map(), hot: new Map(), shop: new Map(), ferry: new Map() };   // live = from OpenStreetMap, by 0.5° cell
  let liveMode = false;   // the nightly files aren't there yet: ask OpenStreetMap for what's on screen
  function loadPts(k) {
    if (!ptsGot[k]) ptsGot[k] = getJ(`ca/moto/${k}.json`, 20000).then((j) => { pts[k] = j.list || []; drawPoints(); }).catch(() => { liveMode = true; loadLive(); });
    return ptsGot[k];
  }
  const OP_Q = {
    fuel: 'nwr["amenity"="fuel"]', camp: 'nwr["tourism"~"^(camp_site|wilderness_hut|alpine_hut)$"]', hot: 'nwr["natural"="hot_spring"]',
    shop: 'nwr["shop"~"^(motorcycle|motorcycle_repair)$"]', ferry: 'nwr["amenity"="ferry_terminal"]',
  };
  // One ask for the view (up to about 130 km across, kept by 0.5° cell), to the main Overpass server first and, if it
  // hasn't answered in 2.5 s, the other one too: the first answer wins (same as planner.js).
  let liveBusy = false, liveState = "";   // "", "loading", "fail"
  async function loadLive() {
    if (!liveMode || liveBusy || !isMoto() || map.getZoom() < 8) return;
    const c = map.getCenter(), b = map.getBounds();
    const s = Math.max(b.getSouth(), c.lat - 0.6), n = Math.min(b.getNorth(), c.lat + 0.6), w = Math.max(b.getWest(), c.lng - 0.9), e = Math.min(b.getEast(), c.lng + 0.9);
    const cells = [];
    for (let la = Math.floor(s * 2) / 2; la < n; la += 0.5) for (let lo = Math.floor(w * 2) / 2; lo < e; lo += 0.5) cells.push(`${la},${lo}`);
    const kinds = Object.keys(OP_Q).filter((k) => pts[k] == null && (shown.has(k) || k === "fuel"));
    if (!kinds.length || cells.every((key) => kinds.every((k) => live[k].has(key)))) return;
    const S = Math.floor(s * 2) / 2, W = Math.floor(w * 2) / 2, N = Math.ceil(n * 2) / 2, E = Math.ceil(e * 2) / 2;
    const q = `[out:json][timeout:25];(${kinds.map((k) => `${OP_Q[k]}(${S},${W},${N},${E});`).join("")});out center tags;`;
    const ask = (u) => getJ(u, 30000, { method: "POST", body: "data=" + encodeURIComponent(q) });
    liveBusy = true; liveState = "loading"; zoomNote();
    let j = null;
    try { j = await Promise.any([ask(OVERPASS[0]), new Promise((ok) => setTimeout(ok, 2500)).then(() => ask(OVERPASS[1]))]); } catch {}
    liveBusy = false;
    if (!j) { liveState = "fail"; zoomNote(); return; }
    liveState = "";
    for (let la = S; la < N; la += 0.5) for (let lo = W; lo < E; lo += 0.5) for (const k of kinds) live[k].set(`${la},${lo}`, []);
    for (const el of j.elements || []) {
      const t = el.tags || {}, la2 = el.lat ?? (el.center && el.center.lat), lo2 = el.lon ?? (el.center && el.center.lon);
      if (la2 == null) continue;
      const k = t.amenity === "fuel" ? "fuel" : t.tourism ? "camp" : t.natural === "hot_spring" ? "hot" : t.shop ? "shop" : t.amenity === "ferry_terminal" ? "ferry" : null;
      const key = `${Math.floor(la2 * 2) / 2},${Math.floor(lo2 * 2) / 2}`;
      if (k && kinds.includes(k) && live[k].has(key)) live[k].get(key).push([la2, lo2, t.name || t.brand || "", k === "camp" && t.fee === "no" ? "free" : k === "fuel" && t.brand ? t.brand : ""]);
    }
    zoomNote(); drawPoints(); drawRange(); renderNear();
  }
  const listOf = (k) => pts[k] || [...live[k].values()].flat();
  // BC rec sites (DataBC), asked for the view: many are free campsites on forest roads.
  const recCells = new Map();
  const inBCbox = (lat, lon) => lat > 48.2 && lat < 60 && lon > -139.1 && lon < -114;
  async function loadRec() {
    if (!isMoto() || !shown.has("camp") || map.getZoom() < 8) return;
    const b = map.getBounds(), todo = [];
    for (let la = Math.floor(b.getSouth()); la < b.getNorth(); la++) for (let lo = Math.floor(b.getWest()); lo < b.getEast(); lo++) if (inBCbox(la + 0.5, lo + 0.5) && !recCells.has(`${la},${lo}`)) todo.push([la, lo]);
    for (const [la, lo] of todo.slice(0, 4)) {
      recCells.set(`${la},${lo}`, []);
      const p = new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: "pub:WHSE_FOREST_TENURE.FTEN_REC_SITE_POINTS_SVW", outputFormat: "application/json", srsName: "EPSG:4326", count: "1000",
        propertyName: "PROJECT_NAME,NUM_CAMP_SITES,FOREST_FILE_ID,MAINTAIN_STD_DESC,GEOMETRY", CQL_FILTER: `BBOX(GEOMETRY,${lo},${la},${lo + 1},${la + 1},'EPSG:4326')` });
      const j = await getJ(`${WFS}?${p}`, 15000).catch(() => null);
      if (!j) { recCells.delete(`${la},${lo}`); continue; }
      recCells.set(`${la},${lo}`, (j.features || []).filter((f) => f.geometry && f.properties.NUM_CAMP_SITES > 0)
        .map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0], titleCase(f.properties.PROJECT_NAME || "Rec site"), `${f.properties.NUM_CAMP_SITES} sites`, f.properties.FOREST_FILE_ID]));
    }
    drawPoints();
  }
  const titleCase = (s) => String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const recList = () => [...recCells.values()].flat();

  map.createPane("moto").style.zIndex = 610;
  map.createPane("motoLines").style.zIndex = 430;
  map.createPane("motoRules").style.zIndex = 355;
  const ptLayer = L.layerGroup(), rangeLayer = L.layerGroup(), routeLayer = L.layerGroup(), wpLayer = L.layerGroup(), mudLayer = L.layerGroup(), rulesLayer = L.layerGroup(), spotLayer = L.layerGroup();
  const lineRenderer = L.canvas({ pane: "motoLines", padding: 0.3, tolerance: L.Browser.touch ? 10 : 5 });
  const rulesRenderer = L.canvas({ pane: "motoRules", padding: 0.3 });
  const allMoto = [ptLayer, rangeLayer, routeLayer, wpLayer, mudLayer, rulesLayer, spotLayer];
  const pinIcon = (k) => L.divIcon({ className: "", html: `<div class="mt-pin" style="background:${PT[k].c}">${PT[k].t}</div>`, iconSize: [0, 0] });
  const ICONS = Object.fromEntries(Object.keys(PT).map((k) => [k, pinIcon(k)]));
  let pts3d = [];
  function drawPoints() {
    ptLayer.clearLayers(); pts3d = [];
    if (!isMoto()) { sync3d(); return; }
    const z = map.getZoom(), b = map.getBounds().pad(0.15);
    const put = (k, p) => {
      if (!b.contains([p[0], p[1]])) return;
      const m = L.marker([p[0], p[1]], { pane: "moto", icon: ICONS[k], keyboard: false, title: p[2] || PT[k].name });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); openPoint(k, p); });
      ptLayer.addLayer(m);
      pts3d.push({ k, p });
    };
    for (const k of ["fuel", "camp", "hot", "shop", "ferry"]) {
      if (!shown.has(k) || z < (LAYERS[k].minZoom || 0)) continue;
      const list = listOf(k);
      let n = 0;
      for (const p of list) { if (n > 400) break; if (b.contains([p[0], p[1]])) { put(k, p); n++; } }
    }
    if (shown.has("camp") && z >= 8) for (const p of recList()) put("rec", p);
    sync3d();
  }
  function openPoint(k, p) {
    setSpot(p[0], p[1], "pin", { k, p });
    toPanel();
  }

  // ---------- fuel range ----------
  let you = null;   // { lat, lon } from the map's location dot
  window.addEventListener("tf:you", (e) => { you = { lat: e.detail.lat, lon: e.detail.lon }; if (isMoto()) { drawRange(); if (!spot || spot.how === "centre") renderNear(); } });
  function drawRange() {
    rangeLayer.clearLayers();
    if (!isMoto() || !shown.has("range") || !bike()) return;
    const from = (route && route.pts[0]) || (you && [you.lat, you.lon]);
    if (!from) return;
    const r = usable(cur()) * 1000;
    rangeLayer.addLayer(L.circle(from, { renderer: lineRenderer, radius: r, color: "#1971c2", weight: 2.5, dashArray: "8 7", fill: false, interactive: false }));
    rangeLayer.addLayer(L.marker(L.latLng(from[0] + r / 111320, from[1]), { pane: "moto", interactive: false, keyboard: false,
      icon: L.divIcon({ className: "", html: `<div class="mt-mud" style="color:#1971c2;text-shadow:0 0 3px #fff,0 0 3px #fff">⛽ ${usable(cur())} km</div>`, iconSize: [0, 0] }) }));
  }

  // ---------- mud and dust today ----------
  // Open-Meteo (free, no key), several squares per call: rain of the last 3 days and the next day, the top soil's
  // moisture, snow on the ground and the temperature.
  const MUD = {
    good: ["Good", "#2f9e44", "Dry and firm"], dust: ["Dusty", "#d4a017", "Dry and dusty: keep your distance"], slick: ["Slick", "#f08c00", "Damp: slick on clay and rock"],
    mud: ["Muddy", "#8b5a2b", "Wet: mud and ruts, a grade harder"], snow: ["Snow", "#4dabf7", "Snow on the ground"],
  };
  const mudCache = new Map();   // "lat,lon" (cell centre) -> { at, w }
  const MUD_TTL = 3600e3;
  function mudOf(w, tomorrow) {
    if (!w) return null;
    const h = w.hourly, now = Date.now();
    let i = h.time.findIndex((t) => new Date(t + "Z").getTime() - w.utc_offset_seconds * 1000 > now) - 1;
    if (i < 0) i = h.time.length - 1;
    if (tomorrow) i = Math.min(h.time.length - 1, i + 24);
    const sum = (a, b) => h.precipitation.slice(Math.max(0, a), Math.max(0, b)).reduce((x, y) => x + (y || 0), 0);
    const r24 = sum(i - 24, i + 1), r72 = sum(i - 72, i + 1), soil = h.soil_moisture_0_to_1cm[i], snow = h.snow_depth[i], t = h.temperature_2m[i];
    const k = snow >= 0.03 ? "snow" : r24 >= 8 || soil >= 0.42 ? "mud" : r24 >= 2 || soil >= 0.34 ? "slick" : r72 < 0.5 && soil != null && soil < 0.14 && t >= 18 ? "dust" : "good";
    return { k, r24, r72, soil, snow, t };
  }
  // One call at a time, so a spot asked for twice at once (the map moving while the card fills) is fetched once and
  // Open-Meteo's rate limit is never hit.
  let weatherQ = Promise.resolve();
  const weatherAt = (cells) => (weatherQ = weatherQ.catch(() => {}).then(() => weatherNow(cells)));
  async function weatherNow(cells) {
    const need = cells.filter((c) => { const x = mudCache.get(c.join(",")); return !x || Date.now() - x.at > MUD_TTL; });
    for (let i = 0; i < need.length; i += 40) {
      const part = need.slice(i, i + 40);
      const p = new URLSearchParams({ latitude: part.map((c) => c[0].toFixed(3)).join(","), longitude: part.map((c) => c[1].toFixed(3)).join(","),
        hourly: "precipitation,soil_moisture_0_to_1cm,snow_depth,temperature_2m", past_days: "3", forecast_days: "2", timezone: "GMT" });
      const j = await getJ(`https://api.open-meteo.com/v1/forecast?${p}`, 15000).catch(() => null);
      if (!j) break;
      (Array.isArray(j) ? j : [j]).forEach((w, n) => { w.utc_offset_seconds = 0; mudCache.set(part[n].join(","), { at: Date.now(), w }); });
    }
    return cells.map((c) => (mudCache.get(c.join(",")) || {}).w || null);
  }
  let mudSeq = 0;
  async function drawMud() {
    mudLayer.clearLayers();
    if (!isMoto() || !shown.has("mud")) return;
    const z = map.getZoom();
    if (z < 7) { zoomNote(); return; }
    const b = map.getBounds(), cells = [];
    // About 36 squares a screen at most: each is one place for Open-Meteo, and its free limit counts places.
    let step = z >= 11 ? 0.05 : z >= 9 ? 0.1 : 0.25;
    while (((b.getNorth() - b.getSouth()) / step) * ((b.getEast() - b.getWest()) / step) > 36) step *= 2;
    for (let la = Math.floor(b.getSouth() / step) * step; la < b.getNorth(); la += step) for (let lo = Math.floor(b.getWest() / step) * step; lo < b.getEast(); lo += step) cells.push([+(la + step / 2).toFixed(3), +(lo + step / 2).toFixed(3)]);
    if (cells.length > 80) return;
    const my = ++mudSeq, ws = await weatherAt(cells);
    if (my !== mudSeq || !isMoto() || !shown.has("mud")) return;
    mudLayer.clearLayers();
    cells.forEach((c, n) => {
      const m = mudOf(ws[n]);
      if (!m) return;
      const [label, color] = MUD[m.k];
      mudLayer.addLayer(L.rectangle([[c[0] - step / 2, c[1] - step / 2], [c[0] + step / 2, c[1] + step / 2]], { renderer: rulesRenderer, color, weight: 0, fillColor: color, fillOpacity: 0.28, interactive: false }));
      mudLayer.addLayer(L.marker(c, { pane: "moto", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<div class="mt-mud">${label}${m.r24 >= 1 ? ` ${Math.round(m.r24)} mm` : ""}</div>`, iconSize: [0, 0] }) }));
    });
  }
  async function renderNow() {
    const el = $("mtNow"), at = spot || (you ? { lat: you.lat, lon: you.lon } : (() => { const c = map.getCenter(); return { lat: c.lat, lon: c.lng }; })());
    const c = [+(Math.round(at.lat / 0.05) * 0.05).toFixed(3), +(Math.round(at.lon / 0.05) * 0.05).toFixed(3)];
    const [w] = await weatherAt([c]);
    const m = mudOf(w), t = mudOf(w, true);
    if (!m) { el.innerHTML = `<span>${svg(IC.drop, 16)} Dirt today: no weather right now</span>`; return; }
    const [label, color, what] = MUD[m.k];
    el.innerHTML = `<span><i class="mt-light" style="--c:${color}"></i><b>Dirt today: ${esc(label)}</b></span><span>${esc(what)}</span>
      <span>${m.r24 >= 0.5 ? `${m.r24.toFixed(0)} mm of rain in 24 h` : m.r72 >= 0.5 ? `${m.r72.toFixed(0)} mm in 3 days` : "No rain in 3 days"}${m.t != null ? ` · ${Math.round(m.t)}°C` : ""}</span>
      ${t ? `<span>Tomorrow: <i class="mt-light" style="--c:${MUD[t.k][1]}"></i>${esc(MUD[t.k][0])}</span>` : ""}`;
  }

  // ---------- where you can't ride ----------
  // The Hunting rules outlines (hunting.js: parks, reserves, BC motor vehicle closures, Quebec zecs and wildlife
  // reserves, First Nation land, Alberta's Green Area), read for a motorcycle.
  const RULES = {
    no: { color: "#e03131", label: "No riding off public roads", kinds: {
      national: "National park: ride only the public roads. No off-road riding, and park passes apply.",
      qcpark: "Quebec national park (Sépaq): park roads only, with a day pass.",
      eco: "Ecological reserve: no motor vehicles.", wilderness: "Alberta wilderness area: no motor vehicles at all.",
      military: "Military land: closed to the public.", mvpr: "Closed to motor vehicles (BC Motor Vehicle Prohibition Regulation): check the season and the vehicles it covers.",
    } },
    roads: { color: "#f08c00", label: "Park roads and marked trails only", kinds: {
      park: "Provincial park: stay on park roads; off-highway riding only where the park marks a trail for it.", protected: "Protected area: roads and marked trails only.",
      conservancy: "Conservancy: roads and marked trails only.", rec: "Recreation area: roads and marked trails only.", pra: "Alberta provincial recreation area: roads and designated trails only.",
      wildland: "Alberta wildland park: off-highway vehicles only on designated trails.", natural: "Alberta natural area: no off-highway vehicles off the roads.",
      nwa: "National wildlife area: roads open to the public only.", mbs: "Migratory bird sanctuary: public roads only.", refuge: "Wildlife refuge: public roads only.",
      consres: "Ontario conservation reserve: roads and trails open to vehicles only.", consarea: "Conservation area: the authority's roads only.", preserve: "Crown game preserve: public roads only.",
    } },
    fee: { color: "#f2b705", label: "Gate, fee or pass", kinds: {
      zec: "ZEC: register at the entry station and pay the day fee for the roads.", qcwres: "Quebec wildlife reserve (Sépaq): access fee at the gate, roads only.",
      outfit: "Outfitter's territory: the roads may be gated, ask the outfitter.",
    } },
    ask: { color: "#9c36b5", label: "Ask first", kinds: {
      reserve: "First Nation reserve: ride through only on public roads unless you have permission.", metis: "Metis settlement: ask the settlement before riding its roads.",
      rangeland: "Grazing land: ask the leaseholder.", pasture: "Provincial pasture: ask the pasture manager.",
    } },
    open: { color: "#2f9e44", label: "Public land", kinds: {
      green: "Alberta Green Area: public forest land. Roads and designated trails; random camping is allowed (a Public Lands Camping Pass on the eastern slopes).",
      wmaopen: "Wildlife management area: public roads open, gates may close for the season.", wild: "Wilderness area or biodiversity reserve: vehicles only on open roads.",
    } },
  };
  const ruleOf = (k) => { for (const [g, r] of Object.entries(RULES)) if (r.kinds[k]) return { g, color: r.color, label: r.label, text: r.kinds[k] }; return null; };
  let rulesKey = "";
  async function drawRules() {
    if (!isMoto() || !shown.has("rules") || map.getZoom() < 7 || !window.tfHunt || !window.tfHunt.areasIn) { rulesLayer.clearLayers(); rulesKey = ""; return; }
    const b = map.getBounds().pad(0.2), z = map.getZoom();
    const list = await window.tfHunt.areasIn(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()).catch(() => []);
    if (!isMoto() || !shown.has("rules")) return;
    const key = `${z}|${list.length}|${b.toBBoxString()}`;
    if (key === rulesKey) return;
    rulesKey = key;
    rulesLayer.clearLayers();
    const d = z >= 13 ? 0.0003 : z >= 11 ? 0.001 : z >= 9 ? 0.003 : 0.008;
    for (const a of list) {
      const r = ruleOf(a.k);
      if (!r || r.g === "open") continue;
      const rings = a.g.map((g) => { const out = []; let lp = null; for (let i = 0; i < g.length; i += 2) { const p = [g[i], g[i + 1]]; if (!lp || Math.abs(p[0] - lp[0]) + Math.abs(p[1] - lp[1]) > d || i === g.length - 2) { out.push(p); lp = p; } } return out; }).filter((x) => x.length > 2);
      if (!rings.length) continue;
      const line = a.k === "mvpr";
      rulesLayer.addLayer(L.polygon(rings, { renderer: rulesRenderer, color: r.color, weight: r.g === "no" ? 2 : 1.5, dashArray: r.g === "no" ? null : "6 5", fillColor: r.color, fillOpacity: r.g === "no" && !line ? 0.12 : line ? 0.18 : 0.04, interactive: false }));
    }
  }

  // ---------- province rules for a plated bike ----------
  const inAlberta = (lat, lon) => lat > 49 && lat < 60 && lon <= -110 && lon > -120 && (lat >= 53.8 || lon > -114.07 - (lat - 49) * 0.7);
  const PROV_BOX = { qc: [44.9, -79.8, 62.7, -57.1], on: [41.6, -95.2, 56.9, -74.3], mb: [48.9, -102.1, 60.1, -88.9], sk: [48.9, -110.1, 60.1, -101.3], nb: [44.5, -69.1, 48.1, -63.7], ns: [43.3, -66.5, 47.1, -59.6], pe: [45.9, -64.5, 47.1, -61.9], nl: [46.6, -67.9, 60.5, -52.5], yt: [59.9, -141.1, 69.7, -123.7], nt: [59.9, -136.5, 78.9, -101.9], nu: [51.6, -121.1, 83.2, -61.1] };
  function provOf(lat, lon) {
    if (inAlberta(lat, lon)) return "ab";
    if (lat > 48.2 && lat < 60 && lon > -139.1 && lon < -114) return "bc";
    const hit = Object.entries(PROV_BOX).filter(([, b]) => lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3]).sort((a, b) => (a[1][2] - a[1][0]) * (a[1][3] - a[1][1]) - (b[1][2] - b[1][0]) * (b[1][3] - b[1][1]));
    return hit.length ? hit[0][0] : "";
  }
  const PROV = {
    bc: ["British Columbia", "On a Forest Service Road your plated bike needs its ICBC registration and $200,000 of liability insurance (a road plate's insurance covers it). With no sign, the limit is 80 km/h. Uphill traffic yields to downhill; on active haul roads, call your kilometre on the posted radio channel or pull over for logging trucks.",
      [["BC resource road safety", "https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/resource-roads/local-road-safety-information"], ["BC off-road vehicle rules", "https://www2.gov.bc.ca/gov/content/industry/crown-land-water/crown-land/crown-land-uses/off-road-vehicles/registration"]]],
    ab: ["Alberta", "On public land, ride the roads and designated trails only. In a Public Land Use Zone, off-highway riding is only on its designated trails, and some zones close trails for the season. Random camping on the eastern slopes needs a Public Lands Camping Pass, 100 m or more from water.",
      [["Alberta Public Land Use Zones", "https://alberta.ca/about-public-land-use-zones"]]],
    on: ["Ontario", "Your bike must be plated and insured. Crown land roads are open unless they're posted closed; many logging roads are gated, and private forests often ban motorcycles. No 400-series highways off a road bike's plate.", [["Ontario off-road vehicle rules", "https://www.ontario.ca/atv"]]],
    qc: ["Quebec", "Most forest roads on public land are open, but ZECs and wildlife reserves charge at their gates. Off-road trails are run by clubs (FQMHR for motorcycles) and need their trail pass; most cross private land with the owners' permission.", []],
  };
  const PROV_OTHER = "Crown land roads are mostly open to plated, insured bikes; off-highway trails follow the province's off-highway vehicle rules. Watch for posted closures and private land.";
  const PROV_NAME = { mb: "Manitoba", sk: "Saskatchewan", nb: "New Brunswick", ns: "Nova Scotia", pe: "Prince Edward Island", nl: "Newfoundland and Labrador", yt: "Yukon", nt: "Northwest Territories", nu: "Nunavut" };

  // ---------- the spot: a road, a pin or a point on the map ----------
  let spot = null, spotSeq = 0;   // { lat, lon, how: "tap" | "pin" | "centre", pin, road }
  const spotMarker = L.marker([0, 0], { pane: "moto", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<div class="mt-pin" style="background:${ACC};width:16px;height:16px;margin:-8px 0 0 -8px"></div>`, iconSize: [0, 0] }) });
  function setSpot(lat, lon, how, pin) {
    spot = { lat, lon, how, pin, road: how === "tap" ? tileRoadAt(lat, lon) : null };
    if (how === "centre") spotLayer.removeLayer(spotMarker); else { spotMarker.setLatLng([lat, lon]); spotLayer.addLayer(spotMarker); }
    if (how !== "centre") { renderSpot(); showCard($("mtSpot")); }
    renderNow(); renderNear();
  }
  function nearest(list, lat, lon, n = 3, maxKm = 150) {
    const out = [];
    for (const p of list) {
      const dLat = Math.abs(p[0] - lat); if (dLat > maxKm / 111) continue;
      const d = kmBetween([lat, lon], [p[0], p[1]]);
      if (d <= maxKm) out.push([d, p]);
    }
    return out.sort((a, b) => a[0] - b[0]).slice(0, n);
  }
  const goLink = (lat, lon) => `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(5)},${lon.toFixed(5)}`;
  async function renderSpot() {
    const el = $("mtSpot"), s = spot;
    if (!s || s.how === "centre") { el.hidden = true; return; }
    const my = ++spotSeq, b = cur(), cap = capOf(b);
    el.hidden = false;
    const title = s.pin ? (s.pin.p[2] || PT[s.pin.k].name) : s.road ? (s.road.name || (s.road.class === "track" ? "Unnamed track" : "Unnamed gravel road")) : "This spot";
    const head = `<header>${svg(s.pin ? IC.camp : IC.road)}<h3>${esc(title)}</h3><button type="button" class="mt-x" aria-label="Close">${svg(IC.x, 16)}</button></header>`;
    const pinLine = s.pin ? `<p>${esc(PT[s.pin.k].name)}${s.pin.p[3] ? ` · ${esc(s.pin.p[3])}` : ""}${s.pin.k === "rec" ? ` · <a href="https://www.sitesandtrailsbc.ca/search/search-result.aspx?site=${encodeURIComponent(s.pin.p[4] || "")}" target="_blank" rel="noopener">BC rec site page</a>` : ""}</p>
      <div class="mt-row"><a class="mt-pill" href="${goLink(s.lat, s.lon)}" target="_blank" rel="noopener">${svg(IC.ride, 16)}Directions</a>${planning || route ? `<button type="button" class="mt-pill" data-addpt>${svg(IC.plan, 16)}Add to my route</button>` : ""}</div>` : "";
    let gradeHtml = "";
    if (s.road) {
      const g = gradeOfTile(s.road), f = fitOf(g, cap);
      gradeHtml = `<p><span class="mt-badge" style="--c:${FIT[f][1]}">${esc(FIT[f][0])}</span></p><p><b>Grade ${g}: ${esc(GRADES[g][0])}</b> · ${esc(GRADES[g][1])}</p><p class="mt-note" data-osm>Looking up this road's details…</p>`;
    }
    el.innerHTML = head + pinLine + gradeHtml + `<div data-can><p class="mt-note">Checking where you can ride…</p></div><div data-near></div>`;
    el.querySelector(".mt-x").onclick = () => { el.hidden = true; spot = null; spotLayer.removeLayer(spotMarker); spotSeq++; renderNear(); };
    const ap = el.querySelector("[data-addpt]");
    if (ap) ap.onclick = () => addPoint([s.lat, s.lon]);
    // The road's own tags (OpenStreetMap), through the router's map: the way's id, then its tags.
    if (s.road) roadDetails(s.lat, s.lon).then((d) => {
      if (my !== spotSeq) return;
      const box = el.querySelector("[data-osm]");
      if (!box) return;
      if (!d) { box.textContent = "Grade from the map's road type only (no details for this road)."; return; }
      const f = fitOf(d.g, cap);
      const badge = el.querySelector(".mt-badge");
      if (badge) { badge.style.setProperty("--c", FIT[f][1]); badge.textContent = FIT[f][0]; }
      const gl2 = badge && badge.parentElement.nextElementSibling;
      if (gl2) gl2.innerHTML = `<b>Grade ${d.g}: ${esc(GRADES[d.g][0])}</b> · ${esc(GRADES[d.g][1])}`;
      const t = d.tags || {};
      const bits = [...d.why, d.slope ? `steepest about ${Math.round(d.slope)}%` : "", t.ford === "yes" ? "a ford (water crossing)" : "", t.seasonal === "yes" || t.seasonal ? "seasonal road" : "",
        /^(no|private)$/.test(t.motorcycle || t.motor_vehicle || t.access || "") ? `<b style="color:#e03131">closed to motorcycles (${esc(t.motorcycle || t.motor_vehicle || t.access)})</b>` : ""].filter(Boolean);
      box.innerHTML = `${bits.length ? esc("From OpenStreetMap: ").replace(/$/, "") + bits.map((x) => (x.startsWith("<b") ? x : esc(x))).join(", ") + "." : "OpenStreetMap has no surface details for it."}${d.way ? ` <a href="https://www.openstreetmap.org/way/${d.way}" target="_blank" rel="noopener">See it on OpenStreetMap</a>` : ""}`;
      if (d.ften) box.insertAdjacentHTML("afterend", `<p class="mt-note"><b>BC ${esc(d.ften.FILE_TYPE_DESCRIPTION || "road")}</b> ${esc(d.ften.MAP_LABEL || "")}${d.ften.ROAD_SECTION_NAME ? ` (${esc(titleCase(d.ften.ROAD_SECTION_NAME))})` : ""}: ${d.ften.LIFE_CYCLE_STATUS_CODE === "RETIRED" ? "<b>retired</b>, no longer maintained, often deactivated" : d.ften.LIFE_CYCLE_STATUS_CODE === "ACTIVE" ? "active, held and maintained" : esc((d.ften.LIFE_CYCLE_STATUS_CODE || "").toLowerCase())}${d.ften.CLIENT_NAME ? `, ${esc(titleCase(d.ften.CLIENT_NAME))}` : ""}.</p>`);
    });
    // Can I ride here: the land at the spot and the province's rules.
    const pv = provOf(s.lat, s.lon);
    const areas = window.tfHunt && window.tfHunt.areasAt ? await window.tfHunt.areasAt(s.lat, s.lon).catch(() => []) : [];
    if (my !== spotSeq) return;
    const rs = areas.map((a) => ({ a, r: ruleOf(a.k) })).filter((x) => x.r).sort((x, y) => Object.keys(RULES).indexOf(x.r.g) - Object.keys(RULES).indexOf(y.r.g));
    const P = PROV[pv];
    const can = el.querySelector("[data-can]");
    can.innerHTML = `<h4>Can I ride here?</h4>
      ${rs.length ? rs.map(({ a, r }) => `<div class="mt-warn ${r.g === "no" ? "" : r.g === "open" ? "ok" : "hard"}"><b>${esc(a.n || r.label)}</b><br>${esc(r.text)}</div>`).join("") : `<div class="mt-warn ok">No park, reserve or closure mapped here.</div>`}
      <details class="mt-fold"><summary>${esc(P ? P[0] : PROV_NAME[pv] || "Canada")}: riding rules</summary><p>${esc(P ? P[1] : PROV_OTHER)}</p>${P && P[2].length ? `<p>${P[2].map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join(" · ")}</p>` : ""}</details>`;
    const c = await loadCell();
    if (my !== spotSeq) return;
    if (c) can.insertAdjacentHTML("afterend", `<p class="mt-note">${svg(IC.cell, 14)} ${cellNear(s.lat, s.lon) ? "Cell signal likely on the roads here (LTE or 5G)." : "<b>Likely no cell signal</b> on the roads here: tell someone your plan."}</p>`);
    renderSpotNear(el.querySelector("[data-near]"), s);
  }
  // The road under a tap: the router's map gives the OpenStreetMap way, its slopes and who may drive it, then its tags.
  async function roadDetails(lat, lon) {
    const out = { g: 2, why: [], tags: null, way: null, slope: 0, ften: null };
    const loc = await postJ(`${VALHALLA}/locate`, { locations: [{ lat, lon }], costing: "motorcycle", verbose: true }, 12000).catch(() => null);
    const e = loc && loc[0] && (loc[0].edges || []).filter((x) => x.distance < 80).sort((a, b) => a.distance - b.distance)[0];
    if (e && e.edge_info) {
      out.way = e.edge_info.way_id;
      const ga = e.edge && e.edge.geo_attributes;
      if (ga) out.slope = Math.max(Math.abs(ga.max_up_slope || 0), Math.abs(ga.max_down_slope || 0));
    }
    const [osm, ften] = await Promise.all([
      out.way ? getJ(`https://api.openstreetmap.org/api/0.6/way/${out.way}.json`, 10000).catch(() => null) : null,
      inBCbox(lat, lon) && !inAlberta(lat, lon) ? getJ(`${WFS}?${new URLSearchParams({ service: "WFS", version: "2.0.0", request: "GetFeature", typeName: "pub:WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW", outputFormat: "application/json", count: "1",
        propertyName: "MAP_LABEL,ROAD_SECTION_NAME,LIFE_CYCLE_STATUS_CODE,FILE_TYPE_DESCRIPTION,CLIENT_NAME", CQL_FILTER: `DWITHIN(GEOMETRY,SRID=4326;POINT(${lon} ${lat}),60,meters)` })}`, 10000).catch(() => null) : null]);
    const w = osm && osm.elements && osm.elements[0];
    if (w && w.tags) { out.tags = w.tags; [out.g, out.why] = gradeOfTags(w.tags); }
    if (out.slope >= 15 && out.g > 1) { out.g = Math.min(5, out.g + 1); }
    if (ften && ften.features && ften.features[0]) {
      out.ften = ften.features[0].properties;
      if (out.ften.LIFE_CYCLE_STATUS_CODE === "RETIRED") out.g = Math.max(out.g, 3);
    }
    return out.way || out.ften ? out : null;
  }
  function renderSpotNear(box, s) {
    if (!box) return;
    const f = nearest(listOf("fuel"), s.lat, s.lon, 2), c = nearest([...listOf("camp"), ...recList()], s.lat, s.lon, 2, 60);
    box.innerHTML = (f.length || c.length) ? `<h4>Nearest</h4><ul class="mt-list">${[...f.map((x) => ["fuel", x]), ...c.map((x) => [x[1].length > 4 ? "rec" : "camp", x])].map(([k, [d, p]]) =>
      `<li style="--c:${PT[k].c}"><button type="button" class="mt-go" data-ll="${p[0]},${p[1]}"><b>${PT[k].t} ${esc(p[2] || PT[k].name)}</b><small>${esc(PT[k].name)}${p[3] ? ` · ${esc(p[3])}` : ""}</small><em>${fmtKm(d)}</em></button></li>`).join("")}</ul>
      <p class="mt-note">As the crow flies.</p>` : "";
    box.querySelectorAll("[data-ll]").forEach((x) => (x.onclick = () => { const [la, lo] = x.dataset.ll.split(",").map(Number); map.setView([la, lo], Math.max(map.getZoom(), 12)); }));
  }
  // Near you (no spot picked): the closest gas, how far a tank goes, and camping.
  function renderNear() {
    const el = $("mtNear");
    if (spot && spot.how !== "centre") { el.hidden = true; return; }
    const at = you ? [you.lat, you.lon] : null;
    if (!at) { el.hidden = true; return; }
    const f = nearest(listOf("fuel"), at[0], at[1], 3, 300), c = nearest([...listOf("camp"), ...recList()], at[0], at[1], 3, 80);
    if (!f.length && !c.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<header>${svg(IC.fuel)}<h3>Near you</h3></header>
      ${f.length ? `<p>${f[0][0] > usable(cur()) ? `<b style="color:#e03131">The nearest gas is ${fmtKm(f[0][0])} away: past your range.</b>` : `Nearest gas ${fmtKm(f[0][0])} away. A tank takes you about ${usable(cur())} km with 20% left.`}</p>` : `<p class="mt-note">Gas stations are loading…</p>`}
      <ul class="mt-list">${[...f.map((x) => ["fuel", x]), ...c.map((x) => [x[1].length > 4 ? "rec" : "camp", x])].map(([k, [d, p]]) =>
        `<li style="--c:${PT[k].c}"><button type="button" class="mt-go" data-ll="${p[0]},${p[1]}"><b>${PT[k].t} ${esc(p[2] || PT[k].name)}</b><small>${esc(PT[k].name)}${p[3] ? ` · ${esc(p[3])}` : ""}</small><em>${fmtKm(d)}</em></button></li>`).join("")}</ul>`;
    el.querySelectorAll("[data-ll]").forEach((x) => (x.onclick = () => { const [la, lo] = x.dataset.ll.split(",").map(Number); map.setView([la, lo], Math.max(map.getZoom(), 12)); }));
  }

  // ---------- plan a route ----------
  // Tap points on the map; the router finds the road between them for the style and the bike. Each change asks again.
  const STYLES = {
    dirt: { label: "Most dirt", sub: "gravel first" },
    mix: { label: "Mix", sub: "some dirt" },
    paved: { label: "Paved", sub: "back roads" },
  };
  let planning = false, planPts = store.get("motoPlan", []), planStyle = store.get("motoStyle", "dirt"), planLoop = store.get("motoLoop", false), route = null, routeSeq = 0, routeErr = "";
  const planBar = document.createElement("div");
  planBar.className = "mt-planbar"; planBar.hidden = true;
  planBar.innerHTML = `<span id="mtPlanTip">Tap the map: start, then where you want to go</span><button type="button" id="mtPlanUndo">↶</button><button type="button" class="go" id="mtPlanDone">Done</button>`;
  document.querySelector(".mapwrap").append(planBar);
  L.DomEvent.disableClickPropagation(planBar);
  $("mtPlanUndo").onclick = () => { planPts.pop(); planChanged(); };
  $("mtPlanDone").onclick = () => setPlanning(false);
  function setPlanning(on) {
    planning = on;
    planBar.hidden = !on;
    document.body.classList.toggle("mt-planning", on);
    pane.querySelector('[data-act="plan"]').classList.toggle("on", on || !!route);
    if (on) { if (phone() && window.tfSnapTo) window.tfSnapTo("peek"); tip(); }
    renderRoute(); drawWaypoints();
  }
  const tip = () => { $("mtPlanTip").textContent = !planPts.length ? "Tap the map where you start" : planPts.length === 1 ? "Now tap where you want to go" : `${planPts.length} points · tap to add more`; };
  function addPoint(ll) {
    planPts.push([+ll[0].toFixed(5), +ll[1].toFixed(5)]);
    if (!planning && planPts.length === 1) setPlanning(true);
    planChanged();
  }
  function planChanged() {
    store.set("motoPlan", planPts);
    drawWaypoints(); tip();
    clearTimeout(planChanged.t);
    planChanged.t = setTimeout(buildRoute, 250);
  }
  function drawWaypoints() {
    wpLayer.clearLayers();
    if (!isMoto()) return;
    planPts.forEach((p, i) => {
      const end = i === planPts.length - 1 && i > 0;
      const m = L.marker(p, { pane: "moto", draggable: true, keyboard: false, icon: L.divIcon({ className: "", html: `<div class="mt-wp${end ? " end" : ""}">${i === 0 ? "S" : end && !planLoop ? "E" : i}</div>`, iconSize: [0, 0] }) });
      m.on("dragend", () => { const q = m.getLatLng(); planPts[i] = [+q.lat.toFixed(5), +q.lng.toFixed(5)]; planChanged(); });
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); if (planning && confirm(`Remove point ${i === 0 ? "S" : i}?`)) { planPts.splice(i, 1); planChanged(); } });
      wpLayer.addLayer(m);
    });
  }
  // Router settings for the style and the bike: use_trails is Valhalla's taste for unpaved roads and tracks (0 to 1).
  function costing() {
    const b = cur(), cap = capOf(b);
    const trails = { dirt: cap >= 4 ? 1 : cap === 3 ? 0.85 : 0.6, mix: cap >= 3 ? 0.5 : 0.35, paved: 0 }[planStyle];
    const o = { use_trails: trails, use_highways: planStyle === "paved" ? 0.15 : 0.05, use_tolls: 0.2, use_ferry: 0.6, top_speed: 110 };
    if (planStyle === "paved" || b.type === "street" && planStyle !== "dirt") o.exclude_unpaved = true;
    return o;
  }
  const decode6 = (str) => {
    const out = []; let i = 0, lat = 0, lon = 0;
    while (i < str.length) {
      for (const k of [0, 1]) {
        let b, s = 0, r = 0;
        do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << s; s += 5; } while (b >= 0x20);
        const d = r & 1 ? ~(r >> 1) : r >> 1;
        if (k === 0) lat += d; else lon += d;
      }
      out.push([lat / 1e6, lon / 1e6]);
    }
    return out;
  };
  async function buildRoute() {
    const locs = planLoop && planPts.length >= 2 ? [...planPts, planPts[0]] : planPts;
    const my = ++routeSeq;
    routeErr = "";
    if (locs.length < 2) { route = null; drawRoute(); renderRoute(); return; }
    $("mtRoute").hidden = false;
    renderRoute(true);
    const body = { locations: locs.map((p, i) => ({ lat: p[0], lon: p[1], type: i === 0 || i === locs.length - 1 ? "break" : "through" })),
      costing: "motorcycle", costing_options: { motorcycle: costing() }, directions_options: { units: "kilometers", language: "en-US" } };
    let r;
    try { r = await postJ(`${VALHALLA}/route`, body, 40000); }
    catch (e) {
      if (my !== routeSeq) return;
      routeErr = /HTTP 4/.test(e.message) ? "No road found between those points for this style: move a point onto a road, or try another style." : "The route server didn't answer. Check your signal and try again.";
      route = null; drawRoute(); renderRoute(); return;
    }
    if (my !== routeSeq) return;
    const legs = r.trip.legs, line = [], parts = [];
    for (const leg of legs) {
      const shape = decode6(leg.shape), base = line.length ? line.length - 1 : 0;
      if (line.length) line.pop();
      line.push(...shape);
      for (const m of leg.maneuvers) {
        if (m.type === 4 && leg !== legs[legs.length - 1]) continue;   // "you have arrived" at a point on the way
        parts.push({ name: (m.street_names && m.street_names[0]) || "the road", kind: "moto", lvl: null, color: ACC, say: m.verbal_transition_alert_instruction || m.instruction,
          text: m.instruction, km: m.length, a: base + m.begin_shape_index, b: base + m.end_shape_index });
      }
    }
    parts.forEach((x) => { x.pts = line.slice(x.a, Math.max(x.a + 2, x.b + 1)); });
    route = { pts: locs, line, parts: parts.filter((x) => x.pts.length > 1), km: r.trip.summary.length, time: r.trip.summary.time, ferry: r.trip.summary.has_ferry, style: planStyle, edges: null, name: "" };
    drawRoute(); renderRoute(); drawRange();
    // Surfaces along it, for km of dirt, the hard bits and the colours.
    const enc = encode6(line);
    const at = await postJ(`${VALHALLA}/trace_attributes`, { encoded_polyline: enc, shape_match: "edge_walk", costing: "motorcycle",
      filters: { attributes: ["edge.length", "edge.surface", "edge.unpaved", "edge.use", "edge.road_class", "edge.names", "edge.max_upward_grade", "edge.begin_shape_index", "edge.end_shape_index"], action: "include" } }, 40000).catch(() => null);
    if (my !== routeSeq || !route) return;
    route.edges = at && at.edges ? at.edges : null;
    nameRoute(route, my);
    drawRoute(); renderRoute();
    if (gl3) sync3d();
  }
  function encode6(pts) {
    let out = "", la = 0, lo = 0;
    const enc = (v) => { v = v < 0 ? ~(v << 1) : v << 1; let s = ""; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
    for (const [a, b] of pts) { const A = Math.round(a * 1e6), B = Math.round(b * 1e6); out += enc(A - la) + enc(B - lo); la = A; lo = B; }
    return out;
  }
  // A name from the towns at both ends (OpenStreetMap's Nominatim, one ask each).
  async function nameRoute(r, my) {
    if (r.name) return;
    const town = (p) => getJ(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&lat=${p[0]}&lon=${p[1]}`, 8000).then((j) => (j.address && (j.address.town || j.address.city || j.address.village || j.address.hamlet || j.address.county)) || "").catch(() => "");
    const a = await town(r.pts[0]), b = planLoop ? "" : await town(r.pts[r.pts.length - 1]);
    if (my !== routeSeq || route !== r || r.name) return;
    r.name = a && b && a !== b ? `${a} to ${b}` : a ? `${planLoop ? "Loop from " : "Around "}${a}` : "My moto route";
    renderRoute();
  }
  // What the route asks of the bike: km of dirt, the hard and too hard stretches, the gas on the way.
  function routeStats(r) {
    const cap = capOf(cur());
    const st = { km: r.km, dirt: 0, longest: 0, hard: [], byG: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    if (!r.edges) return st;
    let run = 0, cur2 = null;
    for (const e of r.edges) {
      const g = gradeOfEdge(e), len = e.length || 0;
      st.byG[g] += len;
      if (e.unpaved || g >= 2) { st.dirt += len; run += len; st.longest = Math.max(st.longest, run); } else run = 0;
      const f = fitOf(g, cap);
      if (f !== "ok") {
        if (cur2 && cur2.f === f && e.begin_shape_index - cur2.b <= 3) { cur2.km += len; cur2.b = e.end_shape_index; cur2.g = Math.max(cur2.g, g); if (!cur2.name && e.names) cur2.name = e.names[0]; }
        else { cur2 = { f, g, km: len, a: e.begin_shape_index, b: e.end_shape_index, name: e.names ? e.names[0] : "" }; st.hard.push(cur2); }
      } else cur2 = null;
    }
    st.hard = st.hard.filter((h) => h.km >= 0.2).sort((a, b) => (a.f === b.f ? b.km - a.km : a.f === "no" ? -1 : 1));
    return st;
  }
  // Gas on the way: stations within 1.5 km of the line, in order, and the gaps between them (start and end count).
  function fuelPlan(r) {
    const list = listOf("fuel");
    if (!list.length) return null;
    const cum = [0];
    for (let i = 1; i < r.line.length; i++) cum.push(cum[i - 1] + kmBetween(r.line[i - 1], r.line[i]));
    const box = L.latLngBounds(r.line).pad(0.02), stops = [];
    const step = Math.max(1, Math.floor(r.line.length / 3000));
    for (const p of list) {
      if (!box.contains([p[0], p[1]])) continue;
      let best = Infinity, at = 0;
      for (let i = 0; i < r.line.length; i += step) { const q = r.line[i], d = Math.abs(q[0] - p[0]) * 111 + Math.abs(q[1] - p[1]) * 70; if (d < best) { best = d; at = i; } }
      if (best > 3) continue;
      const d = kmBetween(r.line[at], [p[0], p[1]]);
      if (d <= 1.5) stops.push({ p, km: cum[at], off: d });
    }
    stops.sort((a, b) => a.km - b.km);
    const total = cum[cum.length - 1], marks = [{ km: 0, name: "the start" }, ...stops.map((s) => ({ km: s.km, name: s.p[2] || "a gas station" })), { km: total, name: "the end" }];
    const gaps = [];
    for (let i = 1; i < marks.length; i++) gaps.push({ from: marks[i - 1], to: marks[i], km: marks[i].km - marks[i - 1].km });
    return { stops, gaps, longest: gaps.reduce((m, g) => Math.max(m, g.km), 0), total };
  }
  function drawRoute() {
    routeLayer.clearLayers();
    if (!isMoto() || !route) { sync3d(); return; }
    const cap = capOf(cur());
    routeLayer.addLayer(L.polyline(route.line, { renderer: lineRenderer, color: "#fff", weight: 9, opacity: 0.9, interactive: false }));
    if (route.edges) {
      for (const e of route.edges) {
        const g = gradeOfEdge(e), seg = route.line.slice(e.begin_shape_index, e.end_shape_index + 1);
        if (seg.length < 2) continue;
        routeLayer.addLayer(L.polyline(seg, { renderer: lineRenderer, color: g === 1 ? "#495057" : FIT[fitOf(g, cap)][1], weight: 5.5, opacity: 1, interactive: false }));
      }
    } else routeLayer.addLayer(L.polyline(route.line, { renderer: lineRenderer, color: ACC, weight: 5.5, opacity: 1, interactive: false }));
    const fp = fuelPlan(route);
    if (fp) fp.stops.forEach((s) => routeLayer.addLayer(L.circleMarker([s.p[0], s.p[1]], { renderer: lineRenderer, radius: 7, color: "#fff", weight: 2.5, fillColor: PT.fuel.c, fillOpacity: 1, interactive: false })));
    sync3d();
  }
  function renderRoute(loading) {
    const el = $("mtRoute");
    if (!planning && !route && !routeErr) { el.hidden = true; return; }
    el.hidden = false;
    const r = route, b = cur();
    const styles = `<div class="mt-seg" role="group" aria-label="Route style">${Object.entries(STYLES).map(([k, s]) => `<button type="button" data-style="${k}" class="${k === planStyle ? "on" : ""}">${esc(s.label)}<small>${esc(s.sub)}</small></button>`).join("")}</div>`;
    const tools = `<div class="mt-row"><button type="button" class="mt-pill${planLoop ? " on" : ""}" data-r="loop">${svg(IC.loop, 16)}Back to start</button>${!planning ? `<button type="button" class="mt-pill" data-r="edit">${svg(IC.plan, 16)}Change it</button>` : ""}<button type="button" class="mt-pill" data-r="me">${svg(IC.me, 16)}From where I am</button><button type="button" class="mt-pill" data-r="clear">${svg(IC.x, 16)}Clear</button></div>`;
    let body = "";
    if (loading && !r) body = `<p class="mt-note">Finding the roads…</p>`;
    else if (routeErr) body = `<div class="mt-warn">${esc(routeErr)}</div>`;
    else if (!r) body = `<p class="mt-note">${planPts.length ? "Tap where you want to go." : "Tap the map where you start, or use From where I am."} Points can be dragged; tap one to remove it.</p>`;
    else {
      const st = routeStats(r), fp = fuelPlan(r), cap = capOf(b), dirtPct = r.edges ? Math.round((100 * st.dirt) / Math.max(0.1, r.km)) : null;
      const bar = r.edges ? `<div class="mt-bar" aria-label="Surfaces along the route">${[1, 2, 3, 4, 5].map((g) => st.byG[g] > 0 ? `<i style="width:${(100 * st.byG[g]) / r.km}%;background:${g === 1 ? "#495057" : FIT[fitOf(g, cap)][1]}" title="Grade ${g}: ${fmtKm(st.byG[g])}"></i>` : "").join("")}</div>
        <p class="mt-note">${[1, 2, 3, 4, 5].filter((g) => st.byG[g] >= 0.1).map((g) => `${esc(GRADES[g][0])} ${fmtKm(st.byG[g])}`).join(" · ")}</p>` : `<p class="mt-note">Reading the surfaces…</p>`;
      const hard = st.hard.length ? st.hard.slice(0, 4).map((h) => `<div class="mt-warn ${h.f === "no" ? "" : "hard"}"><b>${esc(FIT[h.f][0])}:</b> ${fmtKm(h.km)} of ${esc(GRADES[h.g][0].toLowerCase())}${h.name ? ` on ${esc(h.name)}` : ""}. <button type="button" data-show="${h.a},${h.b}">Show</button></div>`).join("")
        : r.edges ? `<div class="mt-warn ok">Every road on it is good for your ${esc(b.name || TYPES[b.type].label)}.</div>` : "";
      let fuel = "";
      if (!fp) fuel = `<p class="mt-note">Gas stations are still loading.</p>`;
      else {
        const over = fp.gaps.filter((g) => g.km > usable(b));
        fuel = over.length ? over.map((g) => `<div class="mt-warn"><b>${svg(IC.fuel, 14)} ${fmtKm(g.km)} with no gas</b> from ${esc(g.from.name)} to ${esc(g.to.name)}: more than your ${usable(b)} km. Carry fuel or add a stop.</div>`).join("")
          : `<div class="mt-warn ok">${svg(IC.fuel, 14)} Gas is never more than ${fmtKm(fp.longest)} apart (your range: ${usable(b)} km with 20% left). ${fp.stops.length} station${fp.stops.length === 1 ? "" : "s"} on the way.</div>`;
      }
      const end = r.line[r.line.length - 1], camps = nearest([...listOf("camp"), ...recList()], end[0], end[1], 3, 25);
      body = `<p><b>${esc(r.name || "Your route")}</b></p>
        <div class="mt-stats"><div><b>${fmtKm(r.km)}</b><span>distance</span></div><div><b>${fmtH(r.time)}</b><span>riding</span></div><div><b>${dirtPct == null ? "…" : dirtPct + "%"}</b><span>dirt</span></div><div><b>${r.edges ? fmtKm(st.longest) : "…"}</b><span>longest dirt</span></div></div>
        ${bar}${hard}${fuel}${highHtml(r)}${ferryHtml(r)}${roadsHtml(r)}${cellHtml(r)}
        ${camps.length ? `<details class="mt-fold"><summary>${svg(IC.camp, 14)} Camping near the end (${camps.length})</summary><ul class="mt-list">${camps.map(([d, p]) => `<li style="--c:${PT.camp.c}"><b>${esc(p[2] || "Campsite")}</b><small>${p[3] ? esc(p[3]) + " · " : ""}${fmtKm(d)} from the end</small></li>`).join("")}</ul></details>` : ""}
        <details class="mt-fold"><summary>Turns (${r.parts.length})</summary><ol class="mt-note" style="margin:0;padding-left:18px">${r.parts.map((x) => `<li>${esc(x.text)}${x.km >= 0.1 ? ` <i>${fmtKm(x.km)}</i>` : ""}</li>`).join("")}</ol></details>
        <div class="mt-row"><button type="button" class="mt-pill go" data-r="ride">${svg(IC.ride, 16)}Ride it</button><button type="button" class="mt-pill" data-r="save">${svg(IC.save, 16)}Save</button><button type="button" class="mt-pill" data-r="gpx">${svg(IC.dl, 16)}GPX</button><button type="button" class="mt-pill" data-r="offline">${svg(IC.dl, 16)}Save offline</button><button type="button" class="mt-pill" data-r="fly">${svg(IC.fly, 16)}Fly it in 3D</button></div>`;
    }
    el.innerHTML = `<header>${svg(IC.plan)}<h3>Plan a route</h3><button type="button" class="mt-x" aria-label="Close">${svg(IC.x, 16)}</button></header>${styles}${tools}${body}
      <p class="mt-note">For your ${esc(b.name || TYPES[b.type].label)} (rides grade ${capOf(b)} well). Routes by Valhalla on OpenStreetMap roads.</p>`;
    el.querySelector(".mt-x").onclick = () => { setPlanning(false); route = null; routeErr = ""; drawRoute(); renderRoute(); drawRange(); pane.querySelector('[data-act="plan"]').classList.remove("on"); };
    el.querySelectorAll("[data-style]").forEach((x) => (x.onclick = () => { planStyle = x.dataset.style; store.set("motoStyle", planStyle); renderRoute(); buildRoute(); }));
    el.querySelectorAll("[data-show]").forEach((x) => (x.onclick = () => { const [a, z] = x.dataset.show.split(",").map(Number); const seg = route.line.slice(a, z + 1); if (seg.length) { if (phone() && window.tfSnapTo) window.tfSnapTo("peek"); map.fitBounds(L.latLngBounds(seg).pad(0.6), { maxZoom: 15 }); } }));
    el.querySelectorAll("[data-r]").forEach((x) => (x.onclick = () => routeAct(x.dataset.r, x)));
    el.querySelectorAll("[data-ll]").forEach((x) => (x.onclick = () => { const [la, lo] = x.dataset.ll.split(",").map(Number); if (phone() && window.tfSnapTo) window.tfSnapTo("peek"); map.setView([la, lo], Math.max(map.getZoom(), 12)); }));
  }
  function routeAct(a, btn) {
    if (a === "loop") { planLoop = !planLoop; store.set("motoLoop", planLoop); drawWaypoints(); buildRoute(); renderRoute(); }
    else if (a === "edit") setPlanning(true);
    else if (a === "clear") { planPts = []; route = null; routeErr = ""; store.set("motoPlan", planPts); drawWaypoints(); drawRoute(); drawRange(); if (!planning) setPlanning(true); else { tip(); renderRoute(); } }
    else if (a === "me") {
      if (!you) { hint("Turn on your location (◎ on the map) first."); return; }
      planPts.unshift([+you.lat.toFixed(5), +you.lon.toFixed(5)]);
      if (!planning) setPlanning(true);
      planChanged();
    } else if (a === "ride") rideRoute();
    else if (a === "fly") flyRoute();
    else if (a === "save") saveRoute();
    else if (a === "gpx") gpx(btn);
    else if (a === "offline") {
      if (!window.tfOffline || !window.tfOffline.saveCorridor) { hint("Offline maps aren't available in this browser."); return; }
      if (!window.tfOffline.saveCorridor(route.line, route.name || "My moto route")) hint("This route is too long to save in one go: save it in two halves (plan each half).");
    }
  }
  function rideRoute() {
    if (!route || !window.tfRide) return;
    setPlanning(false);
    window.tfRide.follow([route.line], route.name || "your route", route.parts.map((x) => ({ ...x })));
  }

  // ---------- saved routes ----------
  let saved = store.get("motoRoutes", []);
  function saveRoute() {
    if (!route) return;
    const name = prompt("Name this route", route.name || "My moto route");
    if (name == null) return;
    const entry = { id: Date.now().toString(36), name: name.trim() || route.name || "My moto route", pts: planPts.slice(), loop: planLoop, style: planStyle, km: Math.round(route.km), at: Date.now(),
      line: encode6(route.line), parts: route.parts.map((x) => [x.name, x.say, x.text, x.a, x.b, +(x.km || 0).toFixed(2)]), time: route.time };
    saved = [entry, ...saved.filter((x) => x.name !== entry.name)].slice(0, 40);
    try { store.set("motoRoutes", saved); } catch {}
    route.name = entry.name;
    hint(`Saved "${entry.name}". Find it under Saved routes.`);
    renderRoute();
  }
  function openSaved() {
    const el = $("mtRoute");
    el.hidden = false;
    el.innerHTML = `<header>${svg(IC.save)}<h3>Saved routes</h3><button type="button" class="mt-x" aria-label="Close">${svg(IC.x, 16)}</button></header>
      ${saved.length ? `<ul class="mt-list">${saved.map((r) => `<li style="--c:${ACC}"><button type="button" class="mt-go" data-open="${esc(r.id)}"><b>${esc(r.name)}</b><small>${STYLES[r.style] ? esc(STYLES[r.style].label) : ""}${r.loop ? " · loop" : ""} · saved ${new Date(r.at).toLocaleDateString()}</small><em>${r.km.toLocaleString()} km</em></button></li>`).join("")}</ul>
        <p class="mt-note">Saved routes keep their line and turns, so you can ride one with no signal (save its map offline too).</p>` : `<p class="mt-note">No saved routes yet: plan one and tap Save.</p>`}`;
    el.querySelector(".mt-x").onclick = () => { el.hidden = true; renderRoute(); };
    el.querySelectorAll("[data-open]").forEach((x) => (x.onclick = () => openRoute(saved.find((r) => r.id === x.dataset.open))));
    showCard(el);
  }
  function openRoute(r) {
    if (!r) return;
    planPts = r.pts.slice(); planLoop = !!r.loop; planStyle = r.style || "dirt";
    store.set("motoPlan", planPts); store.set("motoLoop", planLoop); store.set("motoStyle", planStyle);
    const line = decode6(r.line);
    route = { pts: planLoop ? [...planPts, planPts[0]] : planPts, line, km: r.km, time: r.time || 0, style: planStyle, edges: null, name: r.name,
      parts: r.parts.map(([name, say, text, a, b, km]) => ({ name, say, text, a, b, km, kind: "moto", color: ACC, pts: line.slice(a, Math.max(a + 2, b + 1)) })).filter((x) => x.pts.length > 1) };
    drawWaypoints(); drawRoute(); renderRoute(); drawRange();
    map.fitBounds(L.latLngBounds(line).pad(0.1));
    if (navigator.onLine) {   // the surfaces again (they aren't saved): km of dirt and the hard bits for the bike you have now
      const my = ++routeSeq, rr = route;
      postJ(`${VALHALLA}/trace_attributes`, { encoded_polyline: r.line, shape_match: "edge_walk", costing: "motorcycle",
        filters: { attributes: ["edge.length", "edge.surface", "edge.unpaved", "edge.use", "edge.road_class", "edge.names", "edge.max_upward_grade", "edge.begin_shape_index", "edge.end_shape_index"], action: "include" } }, 40000)
        .then((at) => { if (my === routeSeq && route === rr) { rr.edges = at.edges || null; drawRoute(); renderRoute(); } }).catch(() => {});
    }
  }
  // GPX: the route as a track and the gas stops as waypoints. Phones share the file (downloads don't work in the app).
  async function gpx(btn) {
    if (!route) return;
    const fp = fuelPlan(route), x = (s) => esc(s).replace(/&#39;/g, "&apos;");
    const name = route.name || "My moto route";
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trail Finder" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${x(name)}</name></metadata>
${(fp ? fp.stops : []).map((s) => `<wpt lat="${s.p[0]}" lon="${s.p[1]}"><name>${x(s.p[2] || "Gas")}</name><sym>Gas Station</sym></wpt>`).join("\n")}
<trk><name>${x(name)}</name><trkseg>
${route.line.map((p) => `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"/>`).join("\n")}
</trkseg></trk>
</gpx>`;
    const file = name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") + ".gpx";
    const blob = new Blob([body], { type: "application/gpx+xml" });
    if (phone() && navigator.canShare) {
      for (const type of ["application/gpx+xml", "application/octet-stream", "text/xml"]) {
        const f = new File([body], file, { type });
        if (navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: name }); return; } catch (e) { if (e.name === "AbortError") return; } break; }
      }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    if (btn) btn.blur();
  }

  // ---------- riding ----------
  // navigate.js asks for the bar's words on each GPS fix while riding in Moto: the road under you and how it rides for
  // your bike, then the gas: the next station on the route (or the nearest one) and what's left in the tank.
  let fill = store.get("motoFill", null);   // { km: ridden since the last fill-up, at }
  let lastP = null, rideRoad = { at: 0, name: "", g: 0 };
  function rideInfo(p, speed) {
    const b = cur();
    if (lastP && fill) { const d = kmBetween(lastP, p); if (d < 5) fill.km += d; }
    noteMove(p);
    lastP = p;
    if (fill && Date.now() - (rideInfo.saved || 0) > 30000) { store.set("motoFill", fill); rideInfo.saved = Date.now(); }
    if (Date.now() - rideRoad.at > 4000) {
      const t = tileRoadAt(p[0], p[1], 16);
      rideRoad = { at: Date.now(), name: t ? t.name || (t.class === "track" ? "Track" : "Gravel road") : "", g: t ? gradeOfTile(t) : 1 };
    }
    let next = null;
    if (route && window.tfRide && window.tfRide.riding()) {
      const fp = fuelPlan(route);
      if (fp) {
        let best = Infinity, at = 0;
        for (let i = 0; i < route.line.length; i += Math.max(1, Math.floor(route.line.length / 2000))) { const q = route.line[i], d = Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]); if (d < best) { best = d; at = i; } }
        let pos = 0; for (let i = 1; i <= at; i++) pos += kmBetween(route.line[i - 1], route.line[i]);
        const s = fp.stops.find((x) => x.km > pos + 0.3);
        if (s) next = { km: s.km - pos, name: s.p[2] };
      }
    }
    if (!next) { const n = nearest(listOf("fuel"), p[0], p[1], 1, 400)[0]; if (n) next = { km: n[0], name: n[1][2], straight: true }; }
    const left = fill ? Math.round(rangeOf(b) - fill.km) : null;
    const low = left != null && next && left < next.km * 1.15;
    const f = rideRoad.g > 1 ? fitOf(rideRoad.g, capOf(b)) : null;
    const sub = [f ? `<b>${esc(FIT[f][0])}</b>` : "", next ? `⛽ ${esc(next.name || "gas")} ${fmtKm(next.km)}${next.straight ? " away" : " on the route"}` : "", left != null ? `about ${Math.max(0, left)} km in the tank` : ""].filter(Boolean).join(" · ");
    return { name: rideRoad.name, sub: low ? `<b>Low fuel:</b> ${sub}` : sub, color: low ? "#e03131" : f === "no" ? "#e03131" : f === "hard" ? "#f08c00" : ACC };
  }
  function filledUp() { fill = { km: 0, at: Date.now() }; store.set("motoFill", fill); hint(`Tank full: about ${rangeOf(cur())} km to go. The ride bar counts it down.`); }

  // ---------- quick actions, views, layers ----------
  pane.querySelector(".mt-actions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act;
    if (act === "plan") { if (planning) setPlanning(false); else { setPlanning(true); if (route) renderRoute(); } }
    else if (act === "stops") { setView("stops"); renderStops(); }
    else if (act === "mud") { setView("mud"); renderNow(); showCard($("mtNow")); }
    else if (act === "ride") { if (route) rideRoute(); else if (window.tfRide) window.tfRide.start(); }
  });
  function renderStops() {
    const el = $("mtNear"), at = you ? [you.lat, you.lon] : (() => { const c = map.getCenter(); return [c.lat, c.lng]; })();
    const f = nearest(listOf("fuel"), at[0], at[1], 4, 300), c = nearest([...listOf("camp"), ...recList()], at[0], at[1], 5, 80), h = nearest(listOf("hot"), at[0], at[1], 2, 120);
    el.hidden = false;
    el.innerHTML = `<header>${svg(IC.fuel)}<h3>Fuel &amp; camp ${you ? "near you" : "here"}</h3></header>
      <div class="mt-row"><button type="button" class="mt-pill" data-fill>${svg(IC.fuel, 16)}I just filled up</button><span class="mt-note">${fill ? `${Math.round(fill.km)} km since the last fill-up` : "Counts down your tank as you ride"}</span></div>
      ${!listOf("fuel").length ? `<p class="mt-note">${liveMode && map.getZoom() < 8 ? "Zoom in to load the gas stations." : "Gas stations are loading…"}</p>` : ""}
      <ul class="mt-list">${[...f.map((x) => ["fuel", x]), ...c.map((x) => [x[1].length > 4 ? "rec" : "camp", x]), ...h.map((x) => ["hot", x])].map(([k, [d, p]]) =>
        `<li style="--c:${PT[k].c}"><button type="button" class="mt-go" data-ll="${p[0]},${p[1]}"><b>${PT[k].t} ${esc(p[2] || PT[k].name)}</b><small>${esc(PT[k].name)}${p[3] ? ` · ${esc(p[3])}` : ""}</small><em>${fmtKm(d)}</em></button></li>`).join("")}</ul>
      <details class="mt-fold"><summary>Camping rules</summary><p>BC: free camping on most Crown land up to 14 days; rec sites are first come, some have fees. Alberta: random camping on public land, with a Public Lands Camping Pass on the eastern slopes. Ontario: free on Crown land for Canadians, up to 21 days in one spot. Quebec: in ZECs and wildlife reserves, ask at the gate. Parks: campgrounds only.</p></details>`;
    el.querySelector("[data-fill]").onclick = () => { filledUp(); renderStops(); };
    el.querySelectorAll("[data-ll]").forEach((x) => (x.onclick = () => { const [la, lo] = x.dataset.ll.split(",").map(Number); if (phone() && window.tfSnapTo) window.tfSnapTo("peek"); map.setView([la, lo], Math.max(map.getZoom(), 12)); }));
    showCard(el);
  }
  let view = store.get("motoView", "roads");
  function setView(k) {
    view = k; store.set("motoView", k);
    shown = new Set(VIEWS[k].layers.concat(shown.has("shop") ? ["shop"] : []));
    applyLayers();
  }
  function renderLayers() {
    pane.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("on", VIEWS[b.dataset.view].layers.every((l) => shown.has(l)) && b.dataset.view === view));
    pane.querySelectorAll("[data-act]").forEach((b) => { if (b.dataset.act === "stops") b.classList.toggle("on", view === "stops"); if (b.dataset.act === "mud") b.classList.toggle("on", shown.has("mud")); });
    const z = map.getZoom(), list = $("mtLayerList");
    if (list) list.innerHTML = GROUPS.map((g) => `<p class="mt-group">${esc(g)}</p>` + Object.entries(LAYERS).filter(([, l]) => l.g === g).map(([k, l]) => {
      const ic = l.icon[1] === "dot" ? `border-radius:50%;background:${l.icon[0]};width:14px;height:14px;margin:4px` : l.icon[1] === "ring" ? `border-radius:50%;border:2px dashed ${l.icon[0]}` : l.icon[1] === "line" ? `background:linear-gradient(90deg,#2f9e44 33%,#f08c00 33% 66%,#e03131 66%);height:6px;margin-top:8px` : `background:${l.icon[0]}55;border:2px solid ${l.icon[0]}`;
      return `<label class="mt-layer"><i class="mt-ic" style="${ic}"></i><span><b>${esc(l.label)}</b><small>${esc(l.sub)}${l.minZoom && z < l.minZoom ? " · zoom in" : ""}</small></span><input type="checkbox" class="mt-sw" data-layer="${k}"${shown.has(k) ? " checked" : ""}></label>`;
    }).join("")).join("");
    zoomNote();
  }
  function zoomNote() {
    zoomNote2();
    const a = $("mtZoomNote"), b = $("mtLayerNote");
    if (a && b) b.textContent = a.textContent;
  }
  function zoomNote2() {
    const z = map.getZoom(), el = $("mtZoomNote");
    if (!el) return;
    const stops = ["fuel", "camp", "hot", "shop", "ferry"].some((k) => shown.has(k));
    if (stops && liveMode && liveState === "loading") { el.textContent = "Loading gas, camping and shops from OpenStreetMap…"; return; }
    if (stops && liveMode && liveState === "fail") { el.textContent = "Couldn't reach OpenStreetMap for gas and camping: move the map to try again."; return; }
    if (stops && liveMode && z < 8) { el.textContent = "Zoom in to see gas stations, camping and shops."; return; }
    el.textContent = shown.has("roads") && z < (inBCbox(map.getCenter().lat, map.getCenter().lng) ? 9 : 13) ? (inBCbox(map.getCenter().lat, map.getCenter().lng) ? "Zoom in to see the forest roads." : "Zoom in to see the dirt roads.") : shown.has("mud") && z < 7 ? "Zoom in to see the mud and dust." : "";
  }
  $("mtLayerList").addEventListener("change", (e) => {
    const k = e.target.dataset.layer; if (!k) return;
    if (e.target.checked) shown.add(k); else shown.delete(k);
    view = ""; applyLayers();
  });
  pane.querySelector(".mt-views").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });
  $("mtAll").addEventListener("click", (e) => {
    e.stopPropagation();
    const b = $("layersBtn");
    if (b && $("layersMenu").hidden) b.click();
  });
  $("mtRoutesBtn").addEventListener("click", openSaved);
  $("mtTripsBtn").addEventListener("click", openTrips);
  $("mtLogBtn").addEventListener("click", openLog);
  function applyLayers() {
    store.set("motoLayers", [...shown]);
    renderLayers(); renderKey();
    showRoads(isMoto() && shown.has("roads"));
    if (isMoto() && shown.has("roads")) { if (!ftenLayer._map) ftenLayer.addTo(map); } else if (ftenLayer._map) map.removeLayer(ftenLayer);
    drawPoints(); drawRange(); drawMud(); drawRules(); drawCell();
    if (shown.has("camp")) loadRec();
    loadLive();
  }
  // Map key: what the colours mean.
  const keyCtl = L.control({ position: "bottomleft" });
  keyCtl.onAdd = () => {
    const d = L.DomUtil.create("div", "mt-mapkey");
    L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d);
    d.innerHTML = `<button type="button" class="mt-keybtn" aria-expanded="false">${svg(IC.layers, 16)}Key</button><div class="mt-keybox" hidden></div>`;
    d.querySelector("button").addEventListener("click", (e) => { const box = d.querySelector(".mt-keybox"); box.hidden = !box.hidden; e.currentTarget.setAttribute("aria-expanded", String(!box.hidden)); renderKey(); });
    return d;
  };
  function renderKey() {
    const box = document.querySelector(".mt-mapkey .mt-keybox");
    if (!box || box.hidden) return;
    const i = (c, dot) => `<i class="${dot ? "d" : ""}" style="background:${c}"></i>`, cap = capOf(cur());
    box.innerHTML = (shown.has("roads") ? `<b>Dirt roads for your ${esc(cur().name || TYPES[cur().type].label)}</b>${Object.entries(FIT).map(([, [l, c]]) => `<div>${i(c)}${esc(l)}</div>`).join("")}<div style="color:#666">Dashed: a track (two-track). Solid: a gravel road. Your bike rides grade ${cap} well.</div>` : "")
      + (shown.has("mud") ? `<b>Dirt today</b>${Object.values(MUD).map(([l, c]) => `<div>${i(c)}${esc(l)}</div>`).join("")}` : "")
      + (shown.has("rules") ? `<b>Land</b>${["no", "roads", "fee", "ask"].map((k) => `<div>${i(RULES[k].color)}${esc(RULES[k].label)}</div>`).join("")}` : "")
      + (["fuel", "camp", "hot", "shop", "ferry"].some((k) => shown.has(k)) ? `<b>Stops</b>${["fuel", "camp", "hot", "shop", "ferry"].filter((k) => shown.has(k)).map((k) => `<div>${i(PT[k].c, 1)}${esc(PT[k].name)}</div>`).join("")}` : "")
      + (route ? `<b>Your route</b><div>${i("#495057")}Paved</div><div>Dirt in the colours above</div>` : "")
      || "<p>No layers on: turn some on in Layers.</p>";
  }

  // ---------- 3D map (map3d.js) ----------
  // The same dirt roads from the same tiles, the stops as dots and the planned route as a line.
  let gl3 = null, wait3d = false;
  function sync3d() {
    const g = gl3;
    if (!g || !window.maplibregl) return;
    const apply = () => {
      if (!g.getStyle()) return;
      const on = isMoto();
      // BC forest roads as map images, under the vector roads (the same DataBC layer as the flat map).
      const sld = ftenSld();
      if (g.getSource("mt-ften") && g.__mtSld !== sld) { if (g.getLayer("mt-ften")) g.removeLayer("mt-ften"); g.removeSource("mt-ften"); }
      if (!g.getSource("mt-ften")) {
        g.__mtSld = sld;
        g.addSource("mt-ften", { type: "raster", tileSize: 256, minzoom: 8, maxzoom: 17, bounds: [-139.1, 48.2, -114, 60],
          tiles: [`https://openmaps.gov.bc.ca/geo/pub/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${encodeURIComponent(FTEN)}&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=true&SRS=EPSG%3A3857&WIDTH=256&HEIGHT=256&SLD_BODY=${encodeURIComponent(sld)}&BBOX={bbox-epsg-3857}`] });
        g.addLayer({ id: "mt-ften", type: "raster", source: "mt-ften", minzoom: 8, paint: { "raster-opacity": 0.9 } });
      }
      g.setLayoutProperty("mt-ften", "visibility", on && shown.has("roads") ? "visible" : "none");
      if (!g.getSource("mt-ofm")) g.addSource("mt-ofm", OFM);
      for (const l of roadLayers("mt-ofm", "mt-")) {
        if (!g.getLayer(l.id)) g.addLayer(l);
        g.setLayoutProperty(l.id, "visibility", on && shown.has("roads") ? "visible" : "none");
      }
      paintRoads();
      const rdata = { type: "FeatureCollection", features: on && route ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.line.map((p) => [p[1], p[0]]) } }] : [] };
      if (!g.getSource("mt-route")) {
        g.addSource("mt-route", { type: "geojson", data: rdata });
        g.addLayer({ id: "mt-route-case", type: "line", source: "mt-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fff", "line-width": 9 } });
        g.addLayer({ id: "mt-route", type: "line", source: "mt-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ACC, "line-width": 5 } });
      } else g.getSource("mt-route").setData(rdata);
      const pdata = { type: "FeatureCollection", features: on ? pts3d.map((x, n) => ({ type: "Feature", properties: { n, c: PT[x.k].c }, geometry: { type: "Point", coordinates: [x.p[1], x.p[0]] } })) : [] };
      if (!g.getSource("mt-pts")) {
        g.addSource("mt-pts", { type: "geojson", data: pdata });
        g.addLayer({ id: "mt-pts", type: "circle", source: "mt-pts", paint: { "circle-color": ["get", "c"], "circle-radius": 7, "circle-stroke-color": "#fff", "circle-stroke-width": 2, "circle-pitch-alignment": "viewport" } });
      } else g.getSource("mt-pts").setData(pdata);
    };
    if (g.style && (g.style._loaded || g.isStyleLoaded())) apply();
    else if (!wait3d) { wait3d = true; const go = () => { if (!wait3d) return; wait3d = false; apply(); }; g.once("style.load", go); g.once("load", go); g.once("idle", go); }
  }
  // moto.js loads only when Moto is picked, often after the 3D map was built: take the one already there too.
  function on3d(g) {
    if (!g || g === gl3) return;
    gl3 = g;
    gl3.on("click", (ev) => {
      if (!isMoto() || document.querySelector(".app.riding")) return;
      const hit = gl3.getLayer("mt-pts") && gl3.queryRenderedFeatures([[ev.point.x - 8, ev.point.y - 8], [ev.point.x + 8, ev.point.y + 8]], { layers: ["mt-pts"] })[0];
      if (hit) { const x = pts3d[hit.properties.n]; if (x) openPoint(x.k, x.p); return; }
      if (planning) { addPoint([ev.lngLat.lat, ev.lngLat.lng]); return; }
      const rd = gl3.getLayer("mt-road") && gl3.queryRenderedFeatures([[ev.point.x - 10, ev.point.y - 10], [ev.point.x + 10, ev.point.y + 10]], { layers: ["mt-road", "mt-track"] })[0];
      spot = null;
      setSpot(ev.lngLat.lat, ev.lngLat.lng, "tap");
      if (rd) { spot.road = { ...rd.properties }; renderSpot(); }
    });
    if (window.tfLoadVectorLib) sync3d();
  }
  window.addEventListener("tf:map3d", (e) => on3d(e.detail));
  if (window.trailMap3d) on3d(window.trailMap3d);

  // ---------- high points: snow and frost where the route climbs ----------
  // Valhalla's elevation along the line, then the highest points (1,000 m and up, 25 km apart) get Open-Meteo's
  // snow on the ground, the snow coming and the coldest hour in the next day at their own height. Riders on the
  // forums: "the pass still had snow in June" is the classic surprise.
  async function lookHigh(r) {
    r.high = "loading";
    try {
      const step = Math.max(250, Math.round((r.km * 1000) / 1500));
      const h = await postJ(`${VALHALLA}/height`, { encoded_polyline: encode6(r.line), resample_distance: step }, 30000);
      const sh = h.shape ? h.shape.map((p) => [p.lat, p.lon]) : h.encoded_polyline ? decode6(h.encoded_polyline) : [], hh = h.height || [];
      const pts = sh.map((p, i) => ({ p, m: hh[i], km: (i * step) / 1000 })).filter((x) => x.m != null);
      const top = [];
      for (const x of [...pts].sort((a, b) => b.m - a.m)) {
        if (x.m < 1000 || top.length >= 3) break;
        if (top.every((t) => Math.abs(t.km - x.km) > 25)) top.push(x);
      }
      if (!top.length) { r.high = pts.length ? { max: Math.max(...pts.map((x) => x.m)), top: [] } : null; renderRoute(); return; }
      const q = new URLSearchParams({ latitude: top.map((t) => t.p[0].toFixed(3)).join(","), longitude: top.map((t) => t.p[1].toFixed(3)).join(","), elevation: top.map((t) => Math.round(t.m)).join(","),
        hourly: "snow_depth,snowfall,temperature_2m", forecast_days: "2", timezone: "GMT" });
      const j = await getJ(`https://api.open-meteo.com/v1/forecast?${q}`, 15000);
      const arr = Array.isArray(j) ? j : [j], now = Date.now();
      top.forEach((t, n) => {
        const w = arr[n] && arr[n].hourly; if (!w) return;
        let i = w.time.findIndex((x) => new Date(x + "Z").getTime() > now) - 1; if (i < 0) i = 0;
        t.snow = w.snow_depth[i] || 0;
        t.fall = w.snowfall.slice(i, i + 24).reduce((a, b) => a + (b || 0), 0);
        t.low = Math.min(...w.temperature_2m.slice(i, i + 24).filter((x) => x != null));
      });
      r.high = { max: top[0].m, top: top.sort((a, b) => a.km - b.km) };
    } catch { r.high = null; }
    if (route === r) renderRoute();
  }
  function highHtml(r) {
    if (!r.edges && !r.high) return "";
    if (r.high === undefined && navigator.onLine) { lookHigh(r); return ""; }
    if (!r.high || r.high === "loading") return "";
    if (!r.high.top.length) return `<p class="mt-note">${svg(IC.peak, 14)} Highest point about ${Math.round(r.high.max).toLocaleString()} m: no high passes.</p>`;
    const rows = r.high.top.map((t) => {
      const bad = t.snow >= 0.03 || t.fall >= 1, cold = t.low <= 0;
      const say = t.snow >= 0.03 ? `snow on the ground (${Math.round(t.snow * 100)} cm)` : t.fall >= 1 ? `${Math.round(t.fall)} cm of snow coming` : cold ? `no snow, but ${Math.round(t.low)}°C: ice in the shade` : t.low != null && isFinite(t.low) ? `no snow, low ${Math.round(t.low)}°C` : "no weather";
      return `<div class="mt-warn ${bad ? "" : cold ? "hard" : "ok"}">${svg(IC.peak, 14)} <b>${Math.round(t.m).toLocaleString()} m</b> at km ${Math.round(t.km)}: ${esc(say)}. <button type="button" data-ll="${t.p[0]},${t.p[1]}">Show</button></div>`;
    }).join("");
    return `<h4>High points</h4>${rows}`;
  }
  // Road conditions and ferries: the province's own sites (511 and friends), for each province the route crosses.
  const ROAD511 = { bc: ["DriveBC", "https://www.drivebc.ca/"], ab: ["511 Alberta", "https://511.alberta.ca/"], sk: ["SK Highway Hotline", "https://hotline.gov.sk.ca/"], mb: ["Manitoba 511", "https://www.manitoba511.ca/"],
    on: ["Ontario 511", "https://511on.ca/"], qc: ["Québec 511", "https://www.quebec511.info/"], nb: ["New Brunswick 511", "https://511.gnb.ca/"], ns: ["511 Nova Scotia", "https://511.novascotia.ca/"],
    pe: ["PEI 511", "https://511.gov.pe.ca/"], nl: ["511 NL", "https://511nl.ca/"], yt: ["511 Yukon", "https://511yukon.ca/"], nt: ["Drive NWT", "https://drivenwt.ca/"] };
  const FERRY = { bc: [["BC Ferries (coast)", "https://www.bcferries.com/"], ["BC inland ferries", "https://www2.gov.bc.ca/gov/content/transportation/passenger-travel/water-travel/inland-ferries"]],
    qc: [["Société des traversiers du Québec", "https://www.traversiers.com/"]], on: [["Ontario ferries", "https://www.ontarioferries.com/"]], ns: [["Northumberland and Bay ferries", "https://www.ferries.ca/"], ["Marine Atlantic", "https://www.marineatlantic.ca/"]],
    pe: [["Northumberland Ferries", "https://www.ferries.ca/"]], nb: [["Bay Ferries", "https://www.ferries.ca/"]], nl: [["NL ferry services", "https://www.gov.nl.ca/ti/ferryservices/"], ["Marine Atlantic", "https://www.marineatlantic.ca/"]],
    yt: [["511 Yukon (ferry)", "https://511yukon.ca/"]], nt: [["Drive NWT (ferry status)", "https://drivenwt.ca/"]] };
  function provsOf(r) {
    const out = [];
    for (let i = 0; i < r.line.length; i += Math.max(1, Math.floor(r.line.length / 40))) { const p = provOf(r.line[i][0], r.line[i][1]); if (p && !out.includes(p)) out.push(p); }
    const e = r.line[r.line.length - 1], pe = provOf(e[0], e[1]); if (pe && !out.includes(pe)) out.push(pe);
    return out;
  }
  function ferryHtml(r) {
    const names = r.edges ? [...new Set(r.edges.filter((e) => e.use === "ferry").map((e) => (e.names && e.names[0]) || ""))] : [];
    if (!r.ferry && !names.length) return "";
    const links = provsOf(r).flatMap((p) => FERRY[p] || []).filter((x, i, a) => a.findIndex((y) => y[1] === x[1]) === i);
    return `<div class="mt-warn hard">⛴ <b>It takes a ferry</b>${names.filter(Boolean).length ? `: ${esc(names.filter(Boolean).join(", "))}` : ""}. Check the sailings and if bikes need a booking.${links.length ? ` ${links.map(([n, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join(" · ")}` : ""}</div>`;
  }
  function roadsHtml(r) {
    const ps = provsOf(r).filter((p) => ROAD511[p]);
    return ps.length ? `<p class="mt-note">Road closures and conditions: ${ps.map((p) => `<a href="${ROAD511[p][1]}" target="_blank" rel="noopener">${esc(ROAD511[p][0])}</a>`).join(" · ")}</p>` : "";
  }

  // ---------- cell signal on roads ----------
  // ISED's National Broadband Data: the road pieces with LTE or 5G from at least one carrier, as 2 km squares
  // (data/moto-cell.json, built once from ISED's open data; see scripts/build-moto-cell.py). A route lists the km with no
  // signal, and the layer shades the squares that have it.
  let cellRows = null, cellLoading = null;
  const loadCell = () => cellLoading || (cellLoading = getJ("data/moto-cell.json", 20000).then((j) => {
    const step = j.step || 0.02, rows = new Map();
    for (const [a, runs] of Object.entries(j.rows || {})) { const set = []; for (let i = 0; i < runs.length; i += 2) set.push([runs[i], runs[i] + runs[i + 1] - 1]); rows.set(+a, set); }
    cellRows = { step, rows }; return cellRows;
  }).catch(() => { cellLoading = null; return null; }));
  function hasCell(lat, lon) {
    if (!cellRows) return null;
    const runs = cellRows.rows.get(Math.floor(lat / cellRows.step));
    if (!runs) return false;
    const b = Math.floor(lon / cellRows.step);
    let lo = 0, hi = runs.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (b < runs[m][0]) hi = m - 1; else if (b > runs[m][1]) lo = m + 1; else return true; }
    return false;
  }
  // Squares next to a covered one count as covered: towers reach a little past the road pieces ISED lists.
  const cellNear = (lat, lon) => { const s = cellRows.step; for (const d of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) if (hasCell(lat + d[0], lon + d[1])) return true; return false; };
  function cellStats(r) {
    if (!cellRows) return null;
    let none = 0, run = 0, longest = 0, from = 0, at = 0;
    for (let i = 1; i < r.line.length; i++) {
      const d = kmBetween(r.line[i - 1], r.line[i]);
      if (!cellNear(r.line[i][0], r.line[i][1])) { none += d; run += d; if (run > longest) { longest = run; at = from; } } else { run = 0; from = i; }
    }
    return { none, longest, at };
  }
  function cellHtml(r) {
    if (!cellRows) { loadCell().then((c) => { if (c && route === r) renderRoute(); }); return ""; }
    const c = cellStats(r);
    if (!c) return "";
    if (c.none < 2) return `<p class="mt-note">${svg(IC.cell, 14)} Cell signal on about all of it (LTE or 5G, ISED's coverage data).</p>`;
    return `<div class="mt-warn ${c.longest > 40 ? "" : "hard"}">${svg(IC.cell, 14)} <b>About ${fmtKm(c.none)} with no cell signal</b>, the longest ${fmtKm(c.longest)}. Tell someone your plan; a satellite messenger works there. <button type="button" data-ll="${r.line[c.at][0]},${r.line[c.at][1]}">Show</button></div>`;
  }
  const cellLayer = L.layerGroup();
  allMoto.push(cellLayer);
  function drawCell() {
    cellLayer.clearLayers();
    if (!isMoto() || !shown.has("cell")) return;
    if (!cellRows) { loadCell().then((c) => { if (c) drawCell(); }); return; }
    if (map.getZoom() < 8) return;
    const b = map.getBounds(), s = cellRows.step;
    for (let a = Math.floor(b.getSouth() / s); a <= Math.floor(b.getNorth() / s); a++) {
      const runs = cellRows.rows.get(a); if (!runs) continue;
      const w = Math.floor(b.getWest() / s), e = Math.floor(b.getEast() / s);
      for (const [x0, x1] of runs) {
        if (x1 < w || x0 > e) continue;
        cellLayer.addLayer(L.rectangle([[a * s, Math.max(x0, w) * s], [(a + 1) * s, (Math.min(x1, e) + 1) * s]], { renderer: rulesRenderer, weight: 0, fillColor: "#4c6ef5", fillOpacity: 0.22, interactive: false }));
      }
    }
  }

  // ---------- 3D fly-through ----------
  // The camera rides the route on the 3D map, looking ahead, so you see the climbs and the valleys before the day.
  let fly = null;
  const flyBar = document.createElement("div");
  flyBar.className = "mt-flybar"; flyBar.hidden = true;
  flyBar.innerHTML = `<span id="mtFlyKm"></span><button type="button" id="mtFlyPause">Pause</button><button type="button" class="go" id="mtFlyStop">Stop</button>`;
  map.getContainer().parentElement.append(flyBar);
  const stopFly = () => { if (fly) { cancelAnimationFrame(fly.raf); fly = null; } flyBar.hidden = true; };
  $("mtFlyStop").onclick = stopFly;
  $("mtFlyPause").onclick = () => { if (!fly) return; fly.paused = !fly.paused; $("mtFlyPause").textContent = fly.paused ? "Go" : "Pause"; if (!fly.paused) fly.last = performance.now(); };
  async function flyRoute() {
    if (!route) return;
    const r = route;
    if (!map.getContainer().classList.contains("is3d")) { const b = $("btn3d"); if (b) b.click(); }
    const ready = () => { try { return gl3 && gl3.getStyle() && map.getContainer().classList.contains("is3d"); } catch { return false; } };
    for (let i = 0; i < 80 && !ready(); i++) await new Promise((ok) => setTimeout(ok, 250));
    if (!gl3 || !map.getContainer().classList.contains("is3d")) { hint("The 3D map isn't available here."); return; }
    if (route !== r) return;
    if (phone() && window.tfSnapTo) window.tfSnapTo("peek");
    stopFly();
    const line = r.line, cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + kmBetween(line[i - 1], line[i]));
    const total = cum[cum.length - 1], secs = Math.min(240, 30 + total * 0.5), speed = total / secs;   // km a second
    const at = (d) => { let i = fly.i; while (i < cum.length - 2 && cum[i + 1] < d) i++; fly.i = i; const t = (d - cum[i]) / Math.max(1e-6, cum[i + 1] - cum[i]); return [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t]; };
    const ahead = (d) => { let i = fly.i; while (i < cum.length - 1 && cum[i] < d) i++; return line[Math.min(i, line.length - 1)]; };
    const brg = (a, b) => { const y = Math.sin((b[1] - a[1]) * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180), x = Math.cos(a[0] * Math.PI / 180) * Math.sin(b[0] * Math.PI / 180) - Math.sin(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.cos((b[1] - a[1]) * Math.PI / 180); return (Math.atan2(y, x) * 180) / Math.PI; };
    fly = { d: 0, i: 0, last: performance.now(), paused: false, bearing: 0 };
    fly.bearing = brg(line[0], ahead(1.5));
    flyBar.hidden = false; $("mtFlyPause").textContent = "Pause";
    const stopOnTouch = () => stopFly();
    gl3.once("mousedown", stopOnTouch); gl3.once("touchstart", stopOnTouch);
    const step = (now) => {
      if (!fly) return;
      if (!fly.paused) { fly.d = Math.min(total, fly.d + ((now - fly.last) / 1000) * speed); }
      fly.last = now;
      const p = at(fly.d), want = brg(p, ahead(fly.d + 1.5));
      let diff = ((want - fly.bearing + 540) % 360) - 180;
      fly.bearing += diff * 0.04;
      gl3.jumpTo({ center: [p[1], p[0]], bearing: fly.bearing, pitch: 62, zoom: 12.6 });
      $("mtFlyKm").textContent = `${fmtKm(fly.d)} of ${fmtKm(total)}`;
      if (fly.d >= total) { stopFly(); return; }
      fly.raf = requestAnimationFrame(step);
    };
    fly.raf = requestAnimationFrame(step);
  }

  // ---------- my moto rides ----------
  // The rides recorded in Moto (navigate.js saves them with sport "moto" next to My rides): the day, km, time, the km
  // of dirt (Valhalla matches the track to the roads once, kept in tf:motoRideDirt), the weather when it started
  // (Open-Meteo, kept in tf:motoRideWx), and this year's totals. A tap shows the ride on the map.
  const rideLayer = L.layerGroup(); allMoto.push(rideLayer);
  let rideDirt = store.get("motoRideDirt", {}), rideWx = store.get("motoRideWx", {});
  function loadMotoRides() {
    return new Promise((resolve) => {
      let r;
      try { r = indexedDB.open("trail-finder-rides", 1); } catch { resolve([]); return; }
      r.onupgradeneeded = () => { const db = r.result; db.createObjectStore("rides", { keyPath: "id" }); db.createObjectStore("photos", { keyPath: "id" }).createIndex("rideId", "rideId"); db.createObjectStore("current", { keyPath: "id" }); };
      r.onerror = () => resolve([]);
      r.onsuccess = () => {
        const db = r.result;
        try {
          const q = db.transaction("rides").objectStore("rides").getAll();
          q.onsuccess = () => { db.close(); resolve((q.result || []).filter((x) => x.sport === "moto" && x.points && x.points.length > 1).sort((a, b) => b.start - a.start)); };
          q.onerror = () => { db.close(); resolve([]); };
        } catch { db.close(); resolve([]); }
      };
    });
  }
  const rideKm = (x) => { let k = 0; for (let i = 1; i < x.points.length; i++) { const d = kmBetween(x.points[i - 1], x.points[i]); if (d < 5) k += d; } return k; };
  const rideSecs = (x) => { const a = x.points[0][3] || x.start, b = x.points[x.points.length - 1][3] || x.end || x.start; return Math.max(0, (b - a) / 1000); };
  async function lookRide(x) {
    const km = rideKm(x);
    if (rideDirt[x.id] == null) {
      const pts = [], gap = Math.max(0.05, km / 1500);
      let acc = 0; pts.push(x.points[0]);
      for (let i = 1; i < x.points.length; i++) { acc += kmBetween(x.points[i - 1], x.points[i]); if (acc >= gap) { pts.push(x.points[i]); acc = 0; } }
      try {
        const at = await postJ(`${VALHALLA}/trace_attributes`, { encoded_polyline: encode6(pts.map((p) => [p[0], p[1]])), shape_match: "map_snap", costing: "motorcycle", filters: { attributes: ["edge.length", "edge.surface", "edge.unpaved", "edge.use", "edge.road_class"], action: "include" } }, 40000);
        rideDirt[x.id] = +(at.edges || []).reduce((s, e) => s + (e.unpaved || gradeOfEdge(e) >= 2 ? e.length || 0 : 0), 0).toFixed(1);
        store.set("motoRideDirt", rideDirt);
      } catch {}
    }
    if (!rideWx[x.id]) {
      const [lat, lon] = x.points[0], old = Date.now() - x.start > 80 * 864e5, day = new Date(x.start).toISOString().slice(0, 10);
      const url = `https://${old ? "archive-api" : "api"}.open-meteo.com/v1/${old ? "archive" : "forecast"}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=temperature_2m,precipitation&timeformat=unixtime&timezone=GMT&start_date=${day}&end_date=${day}`;
      try {
        const j = await getJ(url, 15000), h = j.hourly, i = Math.max(0, h.time.findIndex((t) => t * 1000 > x.start) - 1);
        rideWx[x.id] = [Math.round(h.temperature_2m[i]), +h.precipitation.reduce((a, b) => a + (b || 0), 0).toFixed(1)];
        store.set("motoRideWx", rideWx);
      } catch {}
    }
  }
  async function openLog() {
    const el = $("mtLog");
    toPanel();
    el.hidden = false;
    el.innerHTML = `<header>${svg(IC.log)}<h3>My moto rides</h3><button type="button" class="mt-x" aria-label="Close">${svg(IC.x, 16)}</button></header><p class="mt-note">Loading…</p>`;
    el.querySelector(".mt-x").onclick = () => { el.hidden = true; rideLayer.clearLayers(); };
    showCard(el);
    const rides = await loadMotoRides();
    const fill = () => {
      const year = new Date().getFullYear(), yr = rides.filter((x) => new Date(x.start).getFullYear() === year);
      const tot = yr.reduce((s, x) => s + rideKm(x), 0), dirt = yr.reduce((s, x) => s + (rideDirt[x.id] || 0), 0);
      el.innerHTML = `<header>${svg(IC.log)}<h3>My moto rides</h3><button type="button" class="mt-x" aria-label="Close">${svg(IC.x, 16)}</button></header>
        ${rides.length ? `<div class="mt-stats"><div><b>${yr.length}</b><span>rides ${year}</span></div><div><b>${fmtKm(tot)}</b><span>ridden</span></div><div><b>${fmtKm(dirt)}</b><span>of dirt</span></div><div><b>${tot ? Math.round((100 * dirt) / tot) : 0}%</b><span>dirt</span></div></div>
        <ul class="mt-list">${rides.slice(0, 60).map((x) => { const km = rideKm(x), d = rideDirt[x.id], w = rideWx[x.id];
          return `<li style="--c:${ACC}"><button type="button" class="mt-go" data-ride="${esc(x.id)}"><b>${esc(x.title || new Date(x.start).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }))}</b><small>${new Date(x.start).toLocaleDateString()} · ${fmtH(rideSecs(x))}${d != null ? ` · ${fmtKm(d)} dirt` : ""}${w ? ` · ${w[0]}°C${w[1] >= 0.5 ? `, ${w[1]} mm rain` : ""}` : ""}</small><em>${fmtKm(km)}</em></button></li>`; }).join("")}</ul>`
        : `<p class="mt-note">No moto rides yet. Tap Ride (or Ride it on a route) to record one; it lands here with its km of dirt and the weather.</p>`}
        <p class="mt-note"><a href="ride.html#rides">All rides, GPX files and photos</a></p>`;
      el.querySelector(".mt-x").onclick = () => { el.hidden = true; rideLayer.clearLayers(); };
      el.querySelectorAll("[data-ride]").forEach((b) => (b.onclick = () => {
        const x = rides.find((y) => String(y.id) === b.dataset.ride); if (!x) return;
        rideLayer.clearLayers();
        const ll = x.points.map((p) => [p[0], p[1]]);
        rideLayer.addLayer(L.polyline(ll, { renderer: lineRenderer, color: "#fff", weight: 8, interactive: false }));
        rideLayer.addLayer(L.polyline(ll, { renderer: lineRenderer, color: ACC, weight: 4.5, interactive: false }));
        if (phone() && window.tfSnapTo) window.tfSnapTo("peek");
        map.fitBounds(L.latLngBounds(ll).pad(0.15));
      }));
    };
    fill();
    for (const x of rides.slice(0, 30)) if (rideDirt[x.id] == null || !rideWx[x.id]) { await lookRide(x); if (!el.hidden) fill(); }
  }

  // ---------- ride safe: check-in alarm and send my location ----------
  // Riding alone off the pavement, ADV riders' first worry. While a ride records in Moto, if you haven't moved for the
  // minutes you set, the phone rings and asks "Are you OK?"; with no answer in 2 minutes it opens a text to your
  // contact with where you are. A web app can't send the text by itself, and phones pause it when the screen locks:
  // the card says so, and points to Crash Detection and satellite messengers for the real thing.
  let safe = store.get("motoSafe", { on: false, mins: 30, name: "", phone: "" });
  let moveAt = Date.now(), moveP = null, alarm = null, safeTimer = 0;
  function renderSafe() {
    const el = $("mtSafeRow"); if (!el) return;
    el.innerHTML = `<button type="button" class="mt-pill${safe.on ? " armed" : ""}" data-s="set">${svg(IC.safe, 16)}${safe.on ? `Check-in: ${safe.mins} min` : "Check-in alarm"}</button><button type="button" class="mt-pill" data-s="send">${svg(IC.pin, 16)}Send my location</button>`;
    el.querySelector('[data-s="set"]').onclick = openSafe;
    el.querySelector('[data-s="send"]').onclick = () => sendWhere(false);
  }
  function openSafe() {
    dlg.innerHTML = `<form method="dialog"><h2>Check-in alarm <button type="button" class="mt-xb" data-x aria-label="Close">✕</button></h2>
      <p class="mt-note">While you record a ride in Moto: if you haven't moved for this long, the phone rings and asks if you're OK. No answer in 2 minutes and it opens a text to your contact with where you are, ready to send.</p>
      <label>Ring after<select id="mtSafeMins">${[15, 30, 45, 60, 90].map((m) => `<option value="${m}"${m === safe.mins ? " selected" : ""}>${m} minutes without moving</option>`).join("")}</select></label>
      <label>Contact's name<input id="mtSafeName" maxlength="40" value="${esc(safe.name)}" placeholder="Sam" autocomplete="off"></label>
      <label>Their phone<input id="mtSafePhone" type="tel" inputmode="tel" maxlength="20" value="${esc(safe.phone)}" placeholder="+1 604 555 0123"></label>
      <p class="mt-note">Keep Trail Finder open on the screen: phones pause web apps when they lock. For a crash far from signal, use your phone's Crash Detection or Emergency SOS via satellite, or a satellite messenger (inReach, ZOLEO, SPOT).</p>
      <div class="mt-btns"><button type="button" class="go" data-on>${safe.on ? "Save" : "Turn on"}</button>${safe.on ? `<button type="button" data-off>Turn off</button>` : ""}</div></form>`;
    const q = (s) => dlg.querySelector(s);
    q("[data-x]").onclick = () => dlg.close();
    const read = () => ({ mins: +q("#mtSafeMins").value, name: q("#mtSafeName").value.trim(), phone: q("#mtSafePhone").value.replace(/[^\d+]/g, "") });
    q("[data-on]").onclick = () => { const v = read(); if (!v.phone) { q("#mtSafePhone").focus(); return; } safe = { ...v, on: true }; store.set("motoSafe", safe); dlg.close(); renderSafe(); watchSafe(); hint(`Check-in alarm on: ${safe.mins} minutes without moving while you ride.`); };
    const off = q("[data-off]"); if (off) off.onclick = () => { safe = { ...read(), on: false }; store.set("motoSafe", safe); dlg.close(); renderSafe(); watchSafe(); };
    if (!dlg.open) dlg.showModal();
  }
  const whereText = () => {
    const p = moveP || (you ? [you.lat, you.lon] : null);
    if (!p) return null;
    return `My location (Trail Finder, ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}): https://maps.google.com/?q=${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  };
  const smsHref = (to, body) => `sms:${to}${/iPhone|iPad|Mac/.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(body)}`;
  async function sendWhere(help) {
    const t = whereText();
    if (!t) { hint("Turn on your location (◎ on the map) first."); return; }
    const body = help ? `I may need help: I haven't moved for ${safe.mins} minutes on my moto ride. ${t}` : t;
    if (help && safe.phone) { location.href = smsHref(safe.phone, body); return; }
    if (navigator.share) { try { await navigator.share({ text: body }); return; } catch (e) { if (e.name === "AbortError") return; } }
    if (safe.phone) location.href = smsHref(safe.phone, body);
    else { try { await navigator.clipboard.writeText(body); hint("Copied your location: paste it in a message."); } catch { hint(body); } }
  }
  function noteMove(p) {
    if (!moveP || kmBetween(moveP, p) > 0.08) { moveP = p; moveAt = Date.now(); }
    else moveP = moveP || p;
  }
  function watchSafe() {
    clearInterval(safeTimer); safeTimer = 0;
    if (!safe.on || !isMoto()) return;
    safeTimer = setInterval(() => {
      const riding = window.tfRide && window.tfRide.riding();
      if (!riding) { moveAt = Date.now(); return; }
      if (!alarm && Date.now() - moveAt > safe.mins * 60e3) ring();
    }, 15000);
  }
  function ring() {
    let left = 120, ctx = null, beep = 0;
    const el = document.createElement("div");
    el.className = "mt-alarm"; el.setAttribute("role", "alertdialog");
    el.innerHTML = `<h2>Are you OK?</h2><p>You haven't moved for ${safe.mins} minutes.</p><div class="count" id="mtAlarmLeft">2:00</div>
      <button type="button" class="big" data-ok>I'm OK</button><p>No answer and a text to ${esc(safe.name || "your contact")} opens with where you are.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center"><button type="button" class="sec" data-help>Text now</button><a href="tel:911">Call 911</a></div>`;
    document.body.append(el);
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    const tone = () => { if (navigator.vibrate) navigator.vibrate([400, 200, 400]); if (!ctx) return; const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; g.gain.value = 0.25; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.35); };
    const end = () => { clearInterval(alarm); alarm = null; clearInterval(beep); el.remove(); try { ctx && ctx.close(); } catch {} moveAt = Date.now(); };
    beep = setInterval(tone, 1500); tone();
    alarm = setInterval(() => {
      left--; const m = el.querySelector("#mtAlarmLeft"); if (m) m.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
      if (left <= 0) { end(); sendWhere(true); }
    }, 1000);
    el.querySelector("[data-ok]").onclick = end;
    el.querySelector("[data-help]").onclick = () => { end(); sendWhere(true); };
  }

  // ---------- ADV routes across Canada ----------
  // A list of known adventure routes in every province and territory (data/moto-routes.json, gathered from the
  // riders' route guides, traced on OpenStreetMap roads), sorted by distance from you, with the ones that suit your
  // bike first. One opens on the map; "Plan it" makes it your route, with turns, surfaces and gas for your bike.
  let trips = null, tripsLoading = null, tripProv = "", tripFit = true, tripOpen = null;
  const tripLayer = L.layerGroup(); allMoto.push(tripLayer);
  const loadTrips = () => tripsLoading || (tripsLoading = getJ("data/moto-routes.json", 20000).then((j) => (trips = (j.routes || []).filter((t) => t && t.n && t.start))).catch(() => { tripsLoading = null; trips = null; return null; }));
  const tripFits = (t, b) => (t.grade || 2) <= capOf(b) && (!t.bikes || !t.bikes.length || t.bikes.includes(b.type) || (t.grade || 2) <= capOf(b) - 1);
  const tripLine = (t) => (typeof t.line === "string" ? decode6(t.line) : Array.isArray(t.line) ? t.line : [t.start, t.end].filter(Boolean));
  async function openTrips() {
    const el = $("mtTrips");
    toPanel();
    el.hidden = false;
    el.innerHTML = `<header>${svg(IC.trips)}<h3>ADV routes</h3><button type="button" class="mt-x" aria-label="Close">${svg(IC.x, 16)}</button></header><p class="mt-note">Loading…</p>`;
    el.querySelector(".mt-x").onclick = closeTrips;
    showCard(el);
    await loadTrips();
    renderTrips();
  }
  function closeTrips() { $("mtTrips").hidden = true; tripOpen = null; tripLayer.clearLayers(); }
  function renderTrips() {
    const el = $("mtTrips"), b = cur();
    if (el.hidden) return;
    if (!trips) { el.innerHTML = `<header>${svg(IC.trips)}<h3>ADV routes</h3><button type="button" class="mt-x" aria-label="Close">${svg(IC.x, 16)}</button></header><p class="mt-note">The route list isn't here yet: it comes with the next update.</p>`; el.querySelector(".mt-x").onclick = closeTrips; return; }
    const at = you ? [you.lat, you.lon] : (() => { const c = map.getCenter(); return [c.lat, c.lng]; })();
    const provs = [...new Set(trips.map((t) => (t.prov || "").toUpperCase()).filter(Boolean))].sort();
    let list = trips.map((t) => ({ t, d: kmBetween(at, t.start), fit: tripFits(t, b) })).filter((x) => !tripProv || (x.t.prov || "").toUpperCase() === tripProv);
    if (tripFit) list = list.filter((x) => x.fit);
    list.sort((x, y) => x.d - y.d);
    const g = (t) => { const f = fitOf(t.grade || 2, capOf(b)); return `<span class="mt-g" style="--c:${(t.grade || 2) === 1 ? "#495057" : FIT[f][1]}">${t.grade || 2}</span>`; };
    const open = tripOpen && trips.find((t) => t.id === tripOpen);
    el.innerHTML = `<header>${svg(IC.trips)}<h3>ADV routes</h3><button type="button" class="mt-x" aria-label="Close">${svg(IC.x, 16)}</button></header>
      ${open ? (() => { const f = fitOf(open.grade || 2, capOf(b)), gap = open.fuelGap; return `<p><b>${esc(open.n)}</b></p>
        <div class="mt-stats"><div><b>${fmtKm(open.km || 0)}</b><span>${open.loop ? "loop" : "distance"}</span></div><div><b>${open.dirtPct != null ? open.dirtPct + "%" : "…"}</b><span>dirt</span></div><div><b style="color:${(open.grade || 2) === 1 ? "#495057" : FIT[f][1]}">${open.grade || 2} of 5</b><span>grade</span></div><div><b>${gap ? fmtKm(gap) : "…"}</b><span>longest no gas</span></div></div>
        <div class="mt-warn ${f === "ok" ? "ok" : f === "hard" ? "hard" : ""}"><b>${esc(FIT[f][0])}</b> (${esc(GRADES[open.grade || 2][0].toLowerCase())}).${gap && gap > usable(b) ? ` <b>${fmtKm(gap)} with no gas</b> is more than your ${usable(b)} km: carry fuel.` : ""}${open.season ? ` Season: ${esc(open.season)}.` : ""}${open.ferry ? " It takes a ferry." : ""}</div>
        ${open.notes ? `<p class="mt-note" style="font-size:.82rem;color:var(--fg)">${esc(open.notes)}</p>` : ""}
        <div class="mt-row"><button type="button" class="mt-pill go" data-t="plan">${svg(IC.plan, 16)}Plan it for my bike</button><button type="button" class="mt-pill" data-t="back">All routes</button>${open.src ? `<a class="mt-pill" href="${esc(open.src)}" target="_blank" rel="noopener">Source</a>` : ""}</div>`; })()
      : `<div class="mt-chips"><button type="button" data-fit class="${tripFit ? "on" : ""}">Fits my bike</button><button type="button" data-prov="" class="${!tripProv ? "on" : ""}">All of Canada</button>${provs.map((p) => `<button type="button" data-prov="${p}" class="${tripProv === p ? "on" : ""}">${p}</button>`).join("")}</div>
        ${list.length ? `<ul class="mt-list">${list.slice(0, 40).map(({ t, d }) => `<li style="--c:${FIT[fitOf(t.grade || 2, capOf(b))][1]}"><button type="button" class="mt-go" data-trip="${esc(t.id)}"><b>${g(t)}${esc(t.n)}</b><small>${esc((t.prov || "").toUpperCase())} · ${fmtKm(t.km || 0)}${t.dirtPct != null ? ` · ${t.dirtPct}% dirt` : ""}${t.season ? ` · ${esc(t.season)}` : ""}</small><em>${fmtKm(d)}</em></button></li>`).join("")}</ul>`
        : `<p class="mt-note">${tripFit ? "None here fit your bike: turn off Fits my bike to see them all." : "No routes here."}</p>`}
        <p class="mt-note">The grade is for the roughest part, coloured for your ${esc(b.name || TYPES[b.type].label)}. Distance is from ${you ? "you" : "the map's centre"} to the start.</p>`}`;
    el.querySelector(".mt-x").onclick = closeTrips;
    el.querySelectorAll("[data-prov]").forEach((x) => (x.onclick = () => { tripProv = x.dataset.prov; renderTrips(); }));
    const fb = el.querySelector("[data-fit]"); if (fb) fb.onclick = () => { tripFit = !tripFit; renderTrips(); };
    el.querySelectorAll("[data-trip]").forEach((x) => (x.onclick = () => showTrip(x.dataset.trip)));
    const pb = el.querySelector('[data-t="plan"]'); if (pb) pb.onclick = () => planTrip(open);
    const bb = el.querySelector('[data-t="back"]'); if (bb) bb.onclick = () => { tripOpen = null; tripLayer.clearLayers(); renderTrips(); };
  }
  function showTrip(id) {
    const t = trips && trips.find((x) => x.id === id); if (!t) return;
    tripOpen = id; tripLayer.clearLayers();
    const ll = tripLine(t);
    if (ll.length > 1) {
      tripLayer.addLayer(L.polyline(ll, { renderer: lineRenderer, color: "#fff", weight: 8, interactive: false }));
      tripLayer.addLayer(L.polyline(ll, { renderer: lineRenderer, color: "#7048e8", weight: 4.5, dashArray: "10 6", interactive: false }));
      map.fitBounds(L.latLngBounds(ll).pad(0.1));
    } else map.setView(t.start, 10);
    renderTrips(); showCard($("mtTrips"));
  }
  // The route's own line, as up to 14 stops along it, so the router follows it and adds turns, surfaces and gas.
  function planTrip(t) {
    if (!t) return;
    const ll = tripLine(t);
    if (ll.length < 2) return;
    const cum = [0]; for (let i = 1; i < ll.length; i++) cum.push(cum[i - 1] + kmBetween(ll[i - 1], ll[i]));
    const total = cum[cum.length - 1], n = Math.min(14, Math.max(2, Math.round(total / 40) + 1)), pts = [];
    for (let k = 0; k < n; k++) { const want = (total * k) / (n - 1); let i = cum.findIndex((c) => c >= want); if (i < 0) i = ll.length - 1; pts.push([+ll[i][0].toFixed(5), +ll[i][1].toFixed(5)]); }
    planPts = t.loop ? pts.slice(0, -1) : pts; planLoop = !!t.loop; planStyle = "dirt";
    store.set("motoPlan", planPts); store.set("motoLoop", planLoop); store.set("motoStyle", planStyle);
    route = null; routeErr = "";
    closeTrips();
    drawWaypoints(); renderRoute(true); buildRoute().then(() => { if (route) route.name = t.n; renderRoute(); });
    showCard($("mtRoute"));
  }

  // ---------- for other scripts ----------
  window.tfMoto = {
    rideInfo,
    openLog,
    hub(what) {   // index.html's phone pages: Plan a moto route, saved routes, my bikes, my rides
      if (what === "plan") { const t = document.querySelector('#tabbar [data-nav="moto"]'); if (t) t.click(); setPlanning(true); }
      else if (what === "routes") { const t = document.querySelector('#tabbar [data-nav="moto"]'); if (t) t.click(); openSaved(); }
      else if (what === "bike") openBikes();
      else if (what === "log") openLog();
      else if (what === "trips") openTrips();
    },
  };
  // Offline maps (offline.js) saved in Moto keep the gas, camping and hot spring lists too.
  window.tfMotoOffline = () => (isMoto() ? [...["fuel", "camp", "hot", "ferry"].map((k) => `ca/moto/${k}.json`), "data/moto-cell.json", "data/moto-routes.json"] : []);

  // ---------- map taps and switching sport ----------
  map.on("click", (e) => {
    if (!isMoto() || document.querySelector(".app.riding") || document.body.classList.contains("sp-picking") || document.body.classList.contains("cp-on")) return;
    if (planning) { addPoint([e.latlng.lat, e.latlng.lng]); return; }
    setSpot(e.latlng.lat, e.latlng.lng, "tap");
    toPanel();
  });
  let moveTimer = 0;
  map.on("moveend", () => {
    if (!isMoto()) return;
    drawPoints(); zoomNote();
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { drawMud(); drawRules(); drawCell(); loadRec(); loadLive(); if (!spot) renderNow(); }, 500);
  });
  map.on("zoomend", () => { if (isMoto()) renderLayers(); });
  let started = false;
  function sync() {
    const on = isMoto();
    for (const l of allMoto) { if (on && !map.hasLayer(l)) l.addTo(map); else if (!on && map.hasLayer(l)) map.removeLayer(l); }
    if (on && !keyCtl._map) keyCtl.addTo(map); else if (!on && keyCtl._map) keyCtl.remove();
    if (!on) { if (planning) setPlanning(false); showRoads(false); drawPoints(); stopFly(); watchSafe(); sync3d(); return; }
    if (!started) { started = true; ["fuel", "camp", "hot", "shop", "ferry"].forEach(loadPts); }
    renderBike(); renderLayers(); applyLayers(); drawWaypoints(); drawRoute(); renderRoute(); renderNow(); renderNear(); renderSafe(); watchSafe(); renderTrips();
    if (planPts.length >= 2 && !route) buildRoute();
  }
  window.addEventListener("tf:sport", sync);
  sync();
})();
