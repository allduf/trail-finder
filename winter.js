// Skiing, the second sport in the header's sport menu (MTB / Skiing / Hunting). This file owns the menu: each sport
// sets body.sport-<id>, every non-MTB sport also body.sport-alt (which hides the MTB parts), and "tf:sport" is sent
// on every change (hunting.js listens).
// In Skiing the map shows ski routes and huts instead of the MTB trails. The panel (alex: "simplify the skiing mode")
// is four buttons, Touring / Nordic / Snowmobile / Resorts, each turning on a group of route types, then the
// Avalanche card (with Touring), the route details, the snowmobile clubs (with Snowmobile) and a list of the routes in
// view. The heatmap, your ski tours and each single route type are switches in the map's Layers menu, next to the
// "Avalanche risk" button that shades the mountain faces by Avalanche Canada's forecast, on the flat
// map and on the 3D map: each slope steep enough to slide (about 25° and more) gets the danger colour of its
// elevation band, and stripes where its aspect and elevation are named in the day's avalanche problems.
// Also a "Ski heatmap" of winter OpenStreetMap GPS traces, "Your ski tours" from the rider's own rides, and
// snowmobile trails with the region's snowmobile clubs and their latest grooming reports.
// Data: data/ski.json and data/avalanche.json, made by .github/workflows/winter-data.yml; data/ski-heat.json, made
// by .github/workflows/ski-heat.yml; data/snowmobile-clubs.json (hand-kept club list) and data/grooming.json (the
// clubs' grooming reports, read every few hours by winter-data.yml where a club's page can be read); your tours from this browser's IndexedDB "trail-finder-rides" (ride.html).
// A route's details: heights, profile and slopes from the terrain tiles, the avalanche forecast for the bands it goes
// through, riders' avalanche reports near it (data/avalanche-reports.json, Avalanche Canada's Mountain Information
// Network, made by winter-data.yml), and the weather at its top (Open-Meteo, free, no key).
// Terrain heights: AWS Terrain Tiles (Mapzen, open, no key).
(() => {
  "use strict";
  const map = window.tfLeaflet, sel = document.getElementById("sport"), avyBtn = document.getElementById("avyBtn"), T = window.tfTerrain;
  if (!map || !sel || !window.L || !T) return;
  // What's typed in the Skiing search box goes to the usage page (usage.js, iPhone app only).
  const logUse = (...a) => (window.tfUse ? window.tfUse(...a) : (window.tfUseQ = window.tfUseQ || []).push(a));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {   // "tf:setting" tells account.js (optional sign-in) to save settings to the rider's account
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Layers that paint colour over the whole ground can't be read on top of each other (alex 2026-10-29: "i dont want
  // them to be open at the same time"), and each one is a painted tile layer more for the phone: in every sport only
  // one of them is on at a time (Skiing below, hunting.js, moto.js). tfOneGround(shown, k, keys): k was just turned
  // on, so the others in keys go off. With k null (a list saved before this rule), the first one in keys stays.
  // Returns the keys it turned off.
  window.tfOneGround = (shown, k, keys) => {
    if (k != null && (!keys.includes(k) || !shown.has(k))) return [];
    const keep = k != null ? k : keys.find((x) => shown.has(x));
    const off = keys.filter((x) => x !== keep && shown.has(x));
    off.forEach((x) => shown.delete(x));
    return off;
  };

  const TYPES = {
    // Light blue on a white edge, as FATMAP drew tours (alex 2026-10-26: "add everything" from the FATMAP look): it
    // stands out on white snow and on dark forest alike.
    tour: { label: "Ski touring", color: "#1c9be6", weight: 4 },
    // Trails to the start of the skiing: OpenStreetMap ways tagged ski=yes with no piste type (Elfin Lakes Trail...).
    access: { label: "Approach trails", color: "#1c9be6", weight: 2.5, dashArray: "8 6" },
    nordic: { label: "Nordic / cross-country", color: "#0b9bb5", weight: 3 },
    snowshoe: { label: "Snowshoe", color: "#8b4fe0", weight: 3, dashArray: "6 5" },
    snowmobile: { label: "Snowmobile trails", color: "#c2255c", weight: 3, dashArray: "12 4" },
    resort: { label: "Ski resort runs", color: "#6b7787", weight: 2 },
    // Ungroomed in-bounds terrain (bowls, glades, chutes) inside a ski resort's boundary: resort skiing, not touring.
    offpiste: { label: "Resort off-piste and bowls", color: "#7a8fb8", weight: 2, dashArray: "5 4" },
    other: { label: "Other winter routes", color: "#8e9aab", weight: 2 },
  };
  // Uphill ski routes (skin tracks): the nightly job marks them up (scripts/build-winter.mjs uphillKind: Mont Sutton's
  // "Piste d'Ascension" and "Skimo" paths, alex 2026-11-03); a ski touring route named for the way up counts too.
  const UPHILL = /skimo|ski[- ]?alpinisme|skin ?(track|trail|route)|uphill|mont[ée]es? (de|en|à|a) peaux?|randonn[ée]e alpine|rando alpine|ascensio[nm]|skin ?up/i;
  const isUphill = (r) => !!r && r.lat == null && (r.up === 1 || (r.type === "tour" && !r.area && UPHILL.test(`${r.name || ""} | ${(r.tags && r.tags["piste:name"]) || ""}`)));
  const UP_LABEL = "Uphill ski route (skin track)";
  const UP_ABOUT = "A way up for skinning, not a run down. At a ski resort, skinning up usually needs an uphill pass and is only allowed at set hours and on set runs: check the resort's uphill rules before you go.";
  window.tfSkiIsUphill = isUphill;
  // Sledding and tubing hills (type "sled") aren't drawn: alex asked to take out what isn't needed.
  const HUT = { label: "Huts and cabins", color: "#7a2e10" };
  // Where to leave the car for a tour: blue P pins (alex 2026-10-25: "all ski access that i see look like parking lot").
  // Village and resort lots are left out (tidyAccess).
  const PARK = { label: "Trailhead parking", color: "#1f5fe0" };
  const START = { label: "camptocamp route starts", color: "#d9480f" };   // drawn with Ski touring
  const HEAT = { label: "Ski heatmap", ramp: ["#2b59c3", "#00b4d8", "#ffd23f", "#ff6a1a"] };   // 1, 2, 3-5, 6+ traces
  const MINE = { label: "Your ski tours", color: "#e0218a" };
  const CLUB = { label: "Snowmobile clubs", color: "#c2255c" };
  // The four buttons at the top of the panel: each one turns its group of layers on or off (more than one can be on).
  const VIEWS = {
    tour: { icon: "⛷", label: "Touring", sub: "backcountry", layers: ["tour", "access", "park", "other", "hut", "snow"],
      // Turned off with Touring but not back on by it (alex 2026-11-05: Skiing opens with a short set, faster): each is a
      // switch in Layers.
      quiet: ["other", "snow", "hut"] },
    nordic: { icon: "🎿", label: "Nordic", sub: "and snowshoe", layers: ["nordic", "snowshoe"] },
    sled: { icon: "🛷", label: "Snowmobile", sub: "trails, clubs", layers: ["snowmobile", "club"] },
    resort: { icon: "🚡", label: "Resorts", sub: "runs, bowls", layers: ["resort", "offpiste"] },
  };
  // The Skiing switches in the map's Layers menu, in groups like Hunting's (alex 2026-10-24: "i like how all the layers
  // in hunting or set. can we do the same for skiing"). A group's slot holds switches other files own (Avalanche risk,
  // Webcams, Rogers Pass, Ski areas, Slackcountry, Lift status: window.tfSkiSlot); "routes" groups are what the four panel buttons turn on.
  const GROUPS = [
    { g: "Backcountry", keys: ["tour", "access", "park", "other", "hut"], routes: true },
    // Picture tiles, 3 to a row, like FATMAP's terrain layers: what each one looks like on the mountains.
    { g: "Avalanche and terrain", slot: "avy", keys: ["slope", "aspect", "runout", "flats", "elev"], tiles: true },
    { g: "Snow and weather", keys: ["snow", "fresh", "snowfc"], slot: "wx", slotAfter: true },
    { g: "Nordic and snowmobile", keys: ["nordic", "snowshoe", "snowmobile", "club"], routes: true },
    { g: "Resorts", keys: ["resort", "offpiste"], routes: true, slot: "resort", slotAfter: true },
    { g: "Places and tracks", slot: "places", keys: ["heat", "mine"] },
  ];
  const SNOW = { label: "Snow stations", color: "#0b7285" };
  const LABEL = (k) => (TYPES[k] || { hut: HUT, park: PARK, heat: HEAT, mine: MINE, club: CLUB, snow: SNOW, slope: { label: "Slope angle" }, aspect: { label: "Slope direction" }, runout: { label: "Runout zones and traps" },
    flats: { label: "Flats" }, elev: { label: "Elevation bands" }, fresh: { label: "New snow and rain (24 h)" }, snowfc: { label: "Snow and rain forecast (3 days)" } }[k]).label;
  // Avalanche Canada's danger scale colours.
  const DANGER = [
    { label: "No rating", color: "#9aa3ad" }, { label: "1 Low", color: "#52ba4a" }, { label: "2 Moderate", color: "#fff300" },
    { label: "3 Considerable", color: "#f79218" }, { label: "4 High", color: "#ef1c29" }, { label: "5 Extreme", color: "#1a1a1a" },
  ];
  const BANDS = [["alp", "Alpine"], ["tln", "Treeline"], ["btl", "Below treeline"]];
  // Avalanche Canada's likelihood codes ("veryLikely_likely") in words, lower end first: "likely to very likely".
  const LIKELY = ["unlikely", "possible", "likely", "veryLikely", "certain"];
  const likely = (v) => {
    const parts = String(v || "").split("_").filter(Boolean);
    if (!parts.length || !parts.every((x) => LIKELY.includes(x))) return String(v || "");
    const w = [...new Set(parts)].sort((a, b) => LIKELY.indexOf(a) - LIKELY.indexOf(b)).map((x) => (x === "veryLikely" ? "very likely" : x)).join(" to ");
    return w[0].toUpperCase() + w.slice(1);
  };
  const ASPECTS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  // Each avalanche problem and size in plain words, so the forecast reads easily (alex 2026-11-08: "help people to
  // understand better the forecast"). Sizes are Avalanche Canada's destructive size scale.
  const PROB_WHAT = {
    "storm slab": "New snow from the last storms that hasn't bonded to the snow under it yet.",
    "wind slab": "Snow the wind has piled onto slopes on the side away from the wind: below ridges, in gullies, behind rolls.",
    "persistent slab": "A weak layer buried in the snowpack. It can stay touchy for weeks and be triggered from thin spots.",
    "deep persistent slab": "A weak layer deep near the ground. Hard to trigger, but huge when it goes.",
    "loose wet": "Wet surface snow sliding as the sun or warm air heats it.",
    "loose dry": "Loose dry snow sluffing off steep slopes.",
    "wet slab": "A whole slab letting go as meltwater weakens the layers under it.",
    "cornice": "Overhanging snow on ridgetops that can break off and trigger the slope below.",
    "glide slab": "The whole snowpack sliding on smooth ground like rock or grass.",
  };
  const SIZE_WHAT = ["", "Size 1: small, harmful mostly if it carries you into a terrain trap.", "Size 2: can bury, injure or kill a person.",
    "Size 3: can bury and destroy a car.", "Size 4: can destroy a railway car.", "Size 5: the largest known, can gouge the landscape."];
  const probWhat = (p) => PROB_WHAT[String(p.type || "").toLowerCase()] || "";
  const sizeWhat = (p) => { const n = Math.floor(Math.max(...String(p.size || "").split(/[^\d.]+/).map(Number).filter((x) => x > 0), 0)); return SIZE_WHAT[Math.min(5, n)] || ""; };
  const probNotes = (p) => [probWhat(p), sizeWhat(p)].filter(Boolean).map((x) => `<p class="sk-note">${esc(x)}</p>`).join("");
  // Avalanche Canada's own travel and terrain advice and the forecaster's confidence, quoted as they wrote them.
  const adviceHtml = (f) => `${(f.advice || []).length ? `<h5>${/^jan-/.test(f.id || "") ? "What the Japan Avalanche Network says" : "What Avalanche Canada says to do"}</h5><ul class="av-adv">${f.advice.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${f.confidence ? `<p class="sk-note"><span>Forecaster confidence</span>: <b>${esc(f.confidence)}</b></p>` : ""}`;
  const bandsFor = (area) => T.bandsFor(area.name);   // where treeline and alpine start, roughly (ski-terrain.js)
  // Who forecasts avalanches at a spot. Japan (Skiing only; alex 2026-10-30, a winter trip to Hakuba and Hokkaido): the
  // Japan Avalanche Network's bulletins, read into data/avalanche.json as "jan-" areas by scripts/japan-avalanche.mjs.
  const inJapan = (lat, lon) => lat > 24 && lat < 46.5 && lon > 122 && lon < 146.5;
  const AVY_SITE = {
    ca: { name: "Avalanche Canada map", host: "avalanche.ca", url: "https://avalanche.ca/map", season: "Avalanche Canada's daily forecasts run from about late November to April." },
    jp: { name: "Japan Avalanche Network", host: "nadare.jp", url: "https://data.nadare.jp/avalanche_informations?locale=en",
      season: "The Japan Avalanche Network posts bulletins for Hakuba, Myoko, Kagura-Tanigawa-Hotaka, Tateyama and Central and SW Hokkaido, from about December to April. Elsewhere in Japan there's none: judge the snowpack yourself or hire a guide." },
  };
  const avySite = (lat, lon) => AVY_SITE[lat != null && inJapan(lat, lon) ? "jp" : "ca"];
  const siteLink = (x) => `<a href="${x.url}" target="_blank" rel="noopener">${x.name}</a>`;
  // JAN rates the conditions this morning, not a forecast: said on every card that shows one.
  const janNote = (f) => f && /^jan-/.test(f.id || "") ? `<p class="sk-note">Japan Avalanche Network: today's conditions as of the morning (not a forecast). Elevation bands here are estimates.</p>` : "";

  const css = document.createElement("style");
  css.textContent = `
.brand .sport-pick { font: inherit; font-size: .85rem; font-weight: 700; color: #fff; padding: 6px 28px 6px 12px; border-radius: 999px; cursor: pointer;
  background: rgba(255,255,255,.1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23fff' stroke-width='1.6'/%3E%3C/svg%3E") right 11px center no-repeat;
  border: 1px solid rgba(255,255,255,.28); appearance: none; -webkit-appearance: none; }
.brand .sport-pick:hover { background-color: rgba(255,255,255,.18); }
.brand .sport-pick option { color: #15211a; background: #fff; }
.map-tools #sportMapBtn { display: inline-flex; align-items: center; justify-content: center; gap: 2px; padding: 0 8px 0 9px; min-width: 52px; }
.map-tools #sportMapBtn .spb-i { font-size: 1.25rem; line-height: 1; }
.map-tools #sportMapBtn .spb-c { font-size: .6rem; opacity: .6; }
.map-tools #sportMapBtn .spb-l { display: none; }
.map-tools #sportMapBtn.open { background: var(--forest, #15211a); border-color: var(--forest, #15211a); color: #fff; }
.sport-menu { position: absolute; z-index: 3; top: 48px; right: 0; width: 210px; box-sizing: border-box; padding: 8px; display: flex; flex-direction: column; gap: 6px;
  background: var(--panel); color: var(--fg); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow, 0 6px 24px rgba(0,0,0,.2)); }
.sport-menu[hidden] { display: none; }
.sport-menu .spm-head { font-size: .72rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 2px 4px 0; }
.map-tools .sport-menu button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 46px; padding: 8px 12px; border-radius: 12px; text-align: left;
  font-size: 1rem; font-weight: 700; box-shadow: none; background: var(--chip, #fff); border: 1px solid var(--line); }
.map-tools .sport-menu button span { font-size: 1.35rem; line-height: 1; width: 28px; text-align: center; }
.map-tools .sport-menu button[aria-checked="true"] { background: var(--forest, #15211a); border-color: var(--forest, #15211a); color: #fff; }
.map-tools .sport-menu button[aria-checked="true"]::after { content: "✓"; margin-left: auto; }
@media (max-width: 760px) {
  .map-tools #sportMapBtn { order: -1; width: 46px; min-width: 46px; padding: 0; }
  .map-tools #sportMapBtn .spb-c { display: none; }
  /* room for the sport chip: Skiing and Hunting have extra chips, so there Layers is its icon and count, Hunting's
     Compass and Save point their symbols; a phone too narrow still scrolls the row sideways (the menus are fixed) */
  .map-tools { overflow-x: auto; overflow-y: visible; }
  body.sport-alt .map-tools #layersBtn > span:not(.layers-n) { display: none; }
  body.sport-alt .map-tools #layersBtn { padding-left: 12px; padding-right: 10px; }
  body.sport-hunt .map-tools { gap: 5px; }
  body.sport-hunt .map-tools #compassBtn { font-size: 0; gap: 0; width: 44px; min-width: 44px; padding: 0; justify-content: center; }
  body.sport-hunt .map-tools #compassBtn svg { width: 20px; height: 20px; }
  body.sport-hunt .map-tools #spAdd { width: 44px; min-width: 44px; padding: 0; justify-content: center; }
  body.sport-hunt .map-tools #spAdd::before { content: "📍"; font-size: 1.15rem; }
  .sport-menu { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 60px); left: 12px; right: auto; width: min(260px, calc(100vw - 24px)); }
}
body.sport-alt .panel .modes, body.sport-alt .panel .pane, body.sport-alt #boxBtn, body.sport-alt .box-row-btns, body.sport-alt .tap-hint, body.sport-alt #boxRes,
body.sport-alt #status, body.sport-alt #debug, body.sport-alt #list, body.sport-alt #detail, body.sport-alt #allBtn,
body.sport-alt details.legend, body.sport-alt #searchArea { display: none !important; }
body:not(.sport-ski) #avyBtn, body:not(.sport-ski) #skiPane { display: none !important; }
#skiPane { display: flex; flex-direction: column; gap: 12px; font-size: .9rem; }
#skiPane .sk-hint { color: var(--muted); margin: 0; font-size: .85rem; }
#skiPane .sk-hint.sk-up { margin: 4px 0 2px; line-height: 1.35; }
#skiPane .sk-views { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
#skiPane .sk-view { font: inherit; font-size: .8rem; font-weight: 700; padding: 8px 2px; border-radius: 12px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; }
#skiPane .sk-view .ic { font-size: 1.3rem; line-height: 1.2; }
#skiPane .sk-view small { font-weight: 500; font-size: .66rem; color: var(--muted); white-space: nowrap; }
#skiPane .sk-view[aria-pressed="true"] { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
#skiPane .sk-view[aria-pressed="true"] small { color: #fff; }
#skiPane .sk-acts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#skiPane .sk-act { font: inherit; font-size: .88rem; font-weight: 700; padding: 10px 8px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
#skiPane #skSaveBtn { display: none; }
@media (max-width: 760px) {
  #skiPane .sk-acts { grid-template-columns: repeat(3, 1fr); }
  #skiPane .sk-act { font-size: .8rem; padding: 10px 4px; }
  #skiPane #skSaveBtn { display: block; }
}
#skiPane .sk-act[aria-pressed="true"] { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
#skiPane .sk-slopekey { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: .78rem; }
#skiPane .sk-slopekey i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; opacity: .8; }
#skiPane .sk-plan p { margin: 0; font-size: .85rem; }
.sk-planning, .sk-planning .leaflet-interactive { cursor: crosshair !important; }
.sk-planning .leaflet-tooltip { display: none; }   /* a tap while planning is a point, not a name popping up */
/* A tour on the map: the other names and pins smaller and fainter (routeFocus) */
body.sk-route-focus :is(.sc-pin:not(.on), .sc-gate, .sc-resort, .leaflet-tooltip.fr-name) { font-size: 7.5px !important; padding: 0 4px !important; opacity: .75; }
body.sk-route-focus :is(.wc-gl, .hc-pin, .sk-pin.park) { transform: scale(.75); opacity: .75; }
.sk-planbar { position: absolute; z-index: 1001; left: 50%; top: 12px; transform: translateX(-50%); display: flex; flex-wrap: wrap; gap: 8px 10px; align-items: center; width: max-content; max-width: calc(100% - 24px); box-sizing: border-box;
  background: var(--panel); color: var(--fg); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 6px 18px rgba(0,0,0,.2); padding: 8px 8px 8px 12px; font-size: .88rem; }
.sk-planbar .pb-msg { display: flex; align-items: center; gap: 9px; flex: 1 1 auto; min-width: 0; line-height: 1.25; }
.sk-planbar .pb-msg small { display: block; color: var(--muted); font-size: .76rem; font-weight: 400; margin-top: 1px; }
.sk-planbar .pb-dot { flex: none; width: 12px; height: 12px; border-radius: 50%; background: #1f5fe0; box-shadow: 0 0 0 0 #1f5fe088; animation: pbPulse 1.6s ease-out infinite; }
.sk-planbar .pb-dot.busy { background: none; border: 2px solid #2f9e44; border-right-color: transparent; width: 10px; height: 10px; animation: sksafespin .8s linear infinite; box-shadow: none; }
.sk-planbar .pb-dot.line { background: #ffd43b; box-shadow: 0 0 0 0 #fab00588; }
@keyframes pbPulse { 0% { box-shadow: 0 0 0 0 #1f5fe088; } 80%, 100% { box-shadow: 0 0 0 9px #1f5fe000; } }
.sk-planbar .pb-btns { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.sk-planbar .pb-btns button { margin: 0; line-height: 1.2; }
.sk-planbar button { font: inherit; font-weight: 700; border: 1px solid var(--line); border-radius: 999px; background: var(--chip); color: var(--fg); padding: 7px 12px; cursor: pointer; white-space: nowrap; }
.sk-planbar button:disabled { opacity: .45; cursor: default; }
.sk-planbar .pb-ask { flex: 1 1 100%; display: flex; gap: 6px; margin: 0; }
.sk-planbar .pb-ask input { flex: 1; min-width: 0; font: inherit; font-size: 16px; padding: 7px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--panel); color: var(--fg); }
.sk-planbar button.go { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
@media (max-width: 999px) { .sk-planbar { top: 70px; width: calc(100% - 24px); } .sk-planbar .pb-msg { flex-basis: 100%; } }
#skiPane .sk-row { display: flex; flex-wrap: wrap; gap: 6px; }
#skiPane .sk-tourrow { display: flex; flex-direction: column; gap: 6px; }
#skiPane .sk-tourrow .btn, #skiPane .sk-tourname .btn, #skiPane .sk-tourscard .sk-row .btn { font-size: .9rem; padding: 9px 14px; min-height: 40px; }
#skiPane .sk-tour-ok { color: var(--accent); font-weight: 700; }
#skiPane .sk-tour-ok .linkish { font: inherit; font-weight: 600; color: var(--fg); background: none; border: 0; padding: 4px 6px; text-decoration: underline; cursor: pointer; }
#skiPane .sk-tourrow .sk-row { align-items: center; }
#skiPane .sk-tourrow .sk-row .btn { flex: 1 1 auto; }
#skiPane .sk-tourname { display: flex; flex-direction: column; gap: 6px; }
#skiPane .sk-tourname label { font-size: .82rem; font-weight: 700; }
#skiPane .sk-tourname input { font: inherit; font-size: 16px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--fg); min-width: 0; }
#skiPane .sk-tours-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
#skiPane .sk-tours-h .btn { padding: 4px 10px; }
#skiPane .sk-tours { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
#skiPane .sk-tours li { display: flex; align-items: stretch; border-top: 1px solid var(--line); }
#skiPane .sk-tour-open { flex: 1; min-width: 0; text-align: left; font: inherit; background: none; border: 0; color: var(--fg); padding: 10px 2px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
#skiPane .sk-tour-open b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#skiPane .sk-tour-open small { color: var(--muted); font-size: .78rem; }
#skiPane .sk-tour-del { font: inherit; background: none; border: 0; color: var(--muted); padding: 0 12px; min-width: 44px; cursor: pointer; }
#skiPane .sk-row .btn { font-size: .82rem; padding: 6px 10px; }
#skiPane .sk-warn { background: #fff0e0; color: #7a3b00; border-radius: 8px; padding: 6px 8px; font-size: .82rem; }
#skiPane .sk-est { margin: 0 0 10px; line-height: 1.4; }
#skiPane .sk-est-dg { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 6px; font-weight: 600; }
#skiPane .sk-est-b { display: inline-flex; align-items: center; gap: 4px; }
#skiPane .sk-warn .sk-dg { background: #fff; border-color: #e3b98c; color: #5c2c00; }   /* was light text on the peach box (alex's recording 2026-11-05) */
#skiPane .sk-spark { display: flex; align-items: flex-end; gap: 3px; height: 44px; }
#skiPane .sk-spark span { flex: 1; background: #74c0fc; border-radius: 2px 2px 0 0; min-height: 1px; position: relative; }
#skiPane .sk-spark span:last-child { background: #1f5fe0; }
#skiPane .sk-days { display: flex; gap: 3px; font-size: .66rem; color: var(--muted); }
#skiPane .sk-days span { flex: 1; text-align: center; }
.sk-snow { display: inline-block; transform: translate(-50%, -100%); white-space: nowrap; font: 700 11px/1 system-ui, sans-serif; color: #fff; background: #0b7285; border: 2px solid #fff; border-radius: 10px; padding: 3px 6px; box-shadow: 0 1px 3px #0006; }
.sk-snow.on { outline: 3px solid #ffe14d; }
.sk-snow.none { background: #6b7787; }
.sk-safe-pt { position: absolute; transform: translate(-50%, -50%); background: #1a1a1a; color: #fff; font: 800 11px/1 system-ui, sans-serif; padding: 4px 7px; border-radius: 999px; border: 2px solid #fff; box-shadow: 0 1px 3px #0006; white-space: nowrap; }
.sk-safe-pt.gl { position: static; transform: none; }
.sk-safe-pt.drag { font-size: 12px; padding: 7px 10px; border-width: 2.5px; cursor: grab; touch-action: none; pointer-events: auto; }
.sk-safe-pt.drag:active { cursor: grabbing; }
.sk-safe-pt.first { background: #2f9e44; }
.sk-safe-pt.new { animation: skPtPop .5s ease-out; }
@keyframes skPtPop { 0% { scale: .3; } 60% { scale: 1.25; } 100% { scale: 1; } }
#skiPane .sk-safe { display: flex; flex-direction: column; gap: 14px; border: 1px solid var(--line); border-radius: 14px; padding: 14px; background: var(--panel); }
#skiPane .sk-safe h4 { margin: 0; font-size: 1rem; font-weight: 700; letter-spacing: -.01em; }
#skiPane .sk-sec { display: flex; flex-direction: column; gap: 8px; }
#skiPane .sk-sec + .sk-sec { border-top: 1px solid var(--line); padding-top: 14px; }
#skiPane details.sk-fold > summary { list-style: none; display: flex; align-items: center; gap: 8px; cursor: pointer; }
#skiPane details.sk-fold > summary::-webkit-details-marker { display: none; }
#skiPane details.sk-fold > summary span { margin-left: auto; font-size: .76rem; font-weight: 600; color: color-mix(in srgb, var(--c) 70%, var(--fg)); }
#skiPane details.sk-fold > summary::after { content: ""; width: 7px; height: 7px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(45deg); margin: 0 4px 3px 2px; transition: transform .15s; }
#skiPane details.sk-fold[open] > summary::after { transform: rotate(-135deg); margin-bottom: -3px; }
#skiPane details.sk-fold[open] > summary { margin-bottom: 2px; }
#skiPane .sk-lbl { font-size: .68rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 0; }
#skiPane .ss-sum { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
#skiPane .ss-sum div { display: flex; flex-direction: column; gap: 1px; padding: 7px 10px; }
#skiPane .ss-sum div + div { border-left: 1px solid var(--line); }
#skiPane .ss-sum b { font-size: 1.02rem; font-variant-numeric: tabular-nums; }
#skiPane .ss-sum small { font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; font-weight: 600; }
#skiPane .ss-names { margin: 0; font-size: .78rem; color: var(--muted); line-height: 1.45; }
#skiPane .ss-names span { color: var(--fg); font-weight: 600; }
#skiPane ol.ss-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; font-size: .85rem; line-height: 1.3; }
#skiPane ol.ss-list li { position: relative; display: grid; grid-template-columns: 24px 1fr auto; gap: 0 10px; align-items: center; padding: 4px 0; cursor: pointer; }
#skiPane ol.ss-list li::before { content: ""; position: absolute; left: 11px; top: 0; bottom: 0; width: 2px; background: var(--line); }
#skiPane ol.ss-list li:first-child::before { top: 50%; }
#skiPane ol.ss-list li:last-child::before { bottom: 50%; }
#skiPane ol.ss-list li.ss-pt { align-items: center; }
#skiPane ol.ss-list .ss-ic { position: relative; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--panel); color: var(--muted); box-shadow: inset 0 0 0 1.5px var(--line); }
#skiPane ol.ss-list .ss-ic svg { width: 13px; height: 13px; }
#skiPane ol.ss-list li.hz .ss-ic { color: var(--c); box-shadow: inset 0 0 0 1.5px var(--c); }
#skiPane ol.ss-list .ss-pin { position: relative; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: #1f5fe0; color: #fff; font: 700 11px/1 system-ui, sans-serif; box-shadow: 0 0 0 3px var(--panel); }
#skiPane ol.ss-list .ss-pin.end { background: #1a1a1a; }
#skiPane ol.ss-list .ss-pin svg { width: 11px; height: 11px; }
#skiPane ol.ss-list .ss-mv { display: flex; gap: 4px; }
#skiPane ol.ss-list .ss-mv button { width: 28px; height: 28px; padding: 0; border-radius: 8px; border: 1px solid var(--line); background: var(--panel); color: var(--muted); display: grid; place-items: center; cursor: pointer; }
#skiPane ol.ss-list .ss-mv button svg { width: 13px; height: 13px; }
#skiPane ol.ss-list .ss-mv button:active { background: var(--line); }
#skiPane ol.ss-list .ss-mv button.ss-del { margin-left: 4px; }
#skiPane .ss-add { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; min-height: 44px; margin: 8px 0 0; font: inherit; font-weight: 700; font-size: .92rem; border-radius: 12px; border: 1.5px dashed var(--line); background: none; color: #1f5fe0; cursor: pointer; }
#skiPane .ss-add span { font-size: 1.1rem; line-height: 1; }
#skiPane ol.ss-list .ss-mv button.ss-del:hover { color: #e03131; border-color: #e03131; }
#skiPane ol.ss-list .ss-t { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
#skiPane ol.ss-list .ss-t b { font-weight: 600; }
#skiPane ol.ss-list .ss-t small { color: var(--muted); font-size: .78rem; }
#skiPane ol.ss-list .ss-m { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
#skiPane ol.ss-list .ss-m small { display: inline; margin-left: 6px; color: var(--muted); font-size: .72rem; font-weight: 500; }
#skiPane ol.ss-list .ss-hz { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; margin-top: 2px; padding: 2px 7px 2px 3px; border-radius: 6px; font-size: .72rem; font-weight: 600; color: var(--fg); background: color-mix(in srgb, var(--c) 12%, var(--panel)); }
#skiPane ol.ss-list .ss-hz i { font-style: normal; min-width: 15px; height: 15px; padding: 0 3px; box-sizing: border-box; border-radius: 4px; display: inline-grid; place-items: center; background: var(--c); color: #fff; font-size: .66rem; font-weight: 800; }
.sk-safe-n { width: 18px; height: 18px; border-radius: 50%; color: #fff; font: 800 11px/18px system-ui, sans-serif; text-align: center; border: 2px solid #fff; box-shadow: 0 1px 3px #0006; box-sizing: content-box; }
#skiPane .sk-mode { border: 1px solid var(--line); border-left: 4px solid var(--c); border-radius: 10px; padding: 9px 11px; display: flex; flex-direction: column; gap: 3px; }
#skiPane .sk-mode-h { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
#skiPane .sk-mode-h b { font-size: .95rem; }
#skiPane .sk-mode-h span { font-size: .72rem; font-weight: 600; color: color-mix(in srgb, var(--c) 70%, var(--fg)); }
#skiPane .sk-mode p { margin: 0; font-size: .8rem; line-height: 1.4; color: var(--muted); }
#skiPane .sk-fc-g { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
#skiPane .sk-fc-g div { display: flex; flex-direction: column; gap: 4px; font-size: .7rem; color: var(--muted); font-weight: 600; }
#skiPane .sk-fc-g .av-chip { display: block; width: auto; min-width: 0; padding: 4px 6px; border-radius: 6px; font-size: .74rem; font-weight: 700; text-align: center; }
#skiPane .sk-fc-r { font-size: .74rem; color: var(--muted); margin: 0; line-height: 1.35; }
#skiPane .sk-safe-bar { display: flex; height: 8px; border-radius: 99px; overflow: hidden; background: var(--line); gap: 1px; }
#skiPane .sk-safe-bar i { display: block; height: 100%; }
#skiPane .sk-safe-key { display: flex; flex-direction: column; gap: 3px; font-size: .78rem; margin-bottom: 4px; }
#skiPane .sk-safe-key span { display: flex; align-items: center; gap: 6px; color: var(--muted); }
#skiPane .sk-safe-key span::before { content: ""; width: 8px; height: 8px; border-radius: 2px; background: var(--c); flex: none; }
#skiPane .sk-safe-key span b { margin-left: auto; white-space: nowrap; color: var(--fg); font-weight: 600; font-variant-numeric: tabular-nums; }
#skiPane ul.sk-safe-why, #skiPane ol.sk-safe-watch { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; font-size: .8rem; line-height: 1.4; }
#skiPane ul.sk-safe-why li { position: relative; padding-left: 14px; }
#skiPane ul.sk-safe-why li::before { content: ""; position: absolute; left: 2px; top: .55em; width: 5px; height: 5px; border-radius: 50%; background: var(--muted); }
#skiPane ol.sk-safe-watch li { display: grid; grid-template-columns: 22px 1fr; gap: 0 9px; cursor: pointer; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, var(--c) 7%, var(--panel)); border: 1px solid color-mix(in srgb, var(--c) 25%, var(--line)); }
#skiPane ol.sk-safe-watch li i { font-style: normal; height: 20px; border-radius: 5px; display: grid; place-items: center; background: var(--c); color: #fff; font-size: .7rem; font-weight: 800; }
#skiPane .sk-safe-ok { margin: 0; font-size: .8rem; color: var(--muted); }
#skiPane .sk-safe-dis { font-size: .72rem; color: var(--muted); margin: 0; line-height: 1.45; border-top: 1px solid var(--line); padding-top: 12px; }
#skiPane .sk-safe-dis b { color: var(--fg); }
/* Safest way card: calm greys, one red for hazards (alex 2026-11-04: "too much colour") */
#skiPane .sk-safe { --hz: #e03131; }
#skiPane ol.ss-list li.hz .ss-ic { color: var(--muted); box-shadow: inset 0 0 0 1.5px var(--line); }
#skiPane ol.ss-list .ss-pin, #skiPane ol.ss-list .ss-pin.end { background: var(--fg); color: var(--panel); }
#skiPane ol.ss-list .ss-hz { background: color-mix(in srgb, var(--fg) 6%, var(--panel)); }
#skiPane ol.ss-list .ss-hz i, #skiPane ol.sk-safe-watch li i { background: var(--hz); }
#skiPane .sk-mode { border-left: 1px solid var(--line); }
#skiPane details.sk-fold { display: block; }
#skiPane details.sk-fold > p.sk-lbl { margin-top: 18px; }
#skiPane details.sk-fold > * + * { margin-top: 10px; }
#skiPane details.sk-fold > .sk-fc-g, #skiPane details.sk-fold > .sk-safe-key { margin-top: 6px; }
#skiPane .sk-mode-h span, #skiPane details.sk-fold > summary span { color: var(--muted); }
#skiPane ol.sk-safe-watch li { background: transparent; border-color: var(--line); }
#skiPane .sk-dg { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; color: var(--fg); font-size: .72rem; font-weight: 600; white-space: nowrap; padding: 5px 6px; gap: 5px; }
#skiPane .sk-dg i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
#skiPane .sk-safe-wait { display: flex; align-items: center; gap: 8px; font-size: .84rem; color: var(--muted); }
#skiPane .sk-wbst { margin: 6px 0; padding: 6px 10px; border-radius: 8px; background: #f1f3f5; font-weight: 600; }
#skiPane .sk-wbst.open { background: #d3f9d8; color: #1b5e20; }
#skiPane .sk-wbst.experts { background: #fff3bf; color: #7a4f00; }
#skiPane .sk-wbst.closed { background: #ffe3e3; color: #a51111; }
#skiPane .sk-safe-wait::before { content: ""; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #2f9e44; border-right-color: transparent; animation: sksafespin .8s linear infinite; flex: none; }
@keyframes sksafespin { to { transform: rotate(360deg); } }
.sk-planbar button.safe[aria-pressed="true"] { background: #2f9e44; border-color: #2f9e44; color: #fff; }
.sk-plan-pt { width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 3px solid #e8590c; box-sizing: border-box; }
body:not(.sport-ski) .lm-ski { display: none !important; }
/* Skiing layers in the Layers menu: grouped rows with a colour icon and a switch, the same as Hunting's */
.layers-menu .lm-ski { display: flex; flex-direction: column; }
.lm-ski .sk-group { margin: 0; font-size: .66rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); padding-top: 8px; }
.lm-ski .sk-note { color: var(--muted); font-size: .74rem; margin: 4px 0 2px; }
.lm-ski .sk-layer, .map-tools .layers-menu .lm-ski .sk-slot button { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: center; padding: 6px 0; cursor: pointer;
  font: inherit; color: var(--fg); background: none; border: 0; border-radius: 0; min-height: 0; width: 100%; text-align: left; box-shadow: none; }
.lm-ski .sk-layer b, .lm-ski .sk-slot button b { display: block; font-size: .86rem; }
.lm-ski .sk-layer small { display: block; color: var(--muted); font-size: .74rem; line-height: 1.25; font-weight: 400; }
.lm-ski .sk-lic { width: 22px; height: 22px; border-radius: 6px; box-sizing: border-box; display: grid; place-items: center; font-size: 12px; line-height: 1; color: #fff; }
.lm-ski .sk-sw, .map-tools .layers-menu .lm-ski .sk-slot button::after { appearance: none; -webkit-appearance: none; width: 40px; height: 24px; border-radius: 999px; margin: 0; flex: none; cursor: pointer; transition: background .15s;
  background: radial-gradient(circle at 12px 50%, #fff 8.5px, transparent 9.5px), var(--line); box-shadow: none; }
.map-tools .layers-menu .lm-ski .sk-slot button::after { content: ""; padding: 0; }
.lm-ski .sk-sw:checked, .map-tools .layers-menu .lm-ski .sk-slot button[aria-pressed="true"]::after { background: radial-gradient(circle at 28px 50%, #fff 8.5px, transparent 9.5px), #1f5fe0; }
.lm-ski .sk-sw:focus-visible, .lm-ski .sk-slot button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
#skiPane .sk-sw { width: 18px; height: 4px; border-radius: 2px; flex: none; display: inline-block; }
#skiPane .sk-dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px #0003; flex: none; display: inline-block; }
#skiPane .sk-listwrap { display: flex; flex-direction: column; gap: 8px; }
#skiPane .sk-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; background: var(--chip); padding: 4px; border-radius: 12px; }
#skiPane .sk-tabs[hidden] { display: none; }
#skiPane .sk-tabs button { font: inherit; font-size: .88rem; font-weight: 700; padding: 7px 8px; border: 0; border-radius: 9px; background: none; color: var(--muted); cursor: pointer; }
#skiPane .sk-tabs button b { font-weight: 600; font-size: .78rem; margin-left: 2px; opacity: .8; }
#skiPane .sk-tabs button[aria-selected="true"] { background: var(--panel); color: var(--fg); box-shadow: 0 1px 3px #0002; }
#skiPane .sk-find { font: inherit; font-size: .9rem; flex: 1; min-width: 0; width: 100%; box-sizing: border-box; padding: 9px 12px 9px 34px; border: 1px solid var(--line); border-radius: 12px; color: var(--fg);
  background: var(--panel) no-repeat 11px 50% / 16px url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2.4' stroke-linecap='round'%3E%3Ccircle cx='10.5' cy='10.5' r='6.5'/%3E%3Cpath d='m15.5 15.5 5 5'/%3E%3C/svg%3E"); }
#skiPane .sk-findform { margin: 0; }
#skiPane .sk-count { margin: 0; color: var(--muted); font-size: .78rem; }
#skiPane .sk-count:empty { display: none; }
#skiPane ul.sk-list { list-style: none; margin: 0 -4px; padding: 0; display: flex; flex-direction: column; }
#skiPane .sk-list li + li { border-top: 1px solid var(--line); }
#skiPane .sk-list li button { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 10px; padding: 9px 8px; border-radius: 10px; cursor: pointer; }
#skiPane .sk-list li button:hover, #skiPane .sk-list li button[aria-current="true"] { background: var(--chip); }
#skiPane .sk-list li button:focus-visible { outline: 2px solid #1f5fe0; outline-offset: -2px; }
#skiPane .sk-ic { width: 24px; flex: none; display: grid; place-items: center; }
#skiPane .sk-ic .sk-sw { width: 22px; height: 5px; }
#skiPane .sk-ic .sk-pin { width: 22px; height: 22px; font-size: 11px; }
#skiPane .sk-ic .sk-dot { width: 13px; height: 13px; }
#skiPane .sk-tx { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
#skiPane .sk-list .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; font-size: .92rem; }
#skiPane .sk-list .sub:empty { display: none; }
#skiPane .sk-list .sub { color: var(--muted); font-size: .76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#skiPane .sk-away { flex: none; text-align: right; font-size: .82rem; font-weight: 700; display: flex; flex-direction: column; line-height: 1.15; }
#skiPane .sk-away small { font-size: .66rem; font-weight: 500; color: var(--muted); }
#skiPane .sk-diff { color: var(--c); font-weight: 700; }
#skiPane .sk-diff i { font-style: normal; font-size: .7em; margin-right: 3px; vertical-align: 1px; }
#skiPane .sk-empty { color: var(--muted); font-size: .85rem; padding: 10px 4px; }
#skiPane .sk-card { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: var(--panel); display: flex; flex-direction: column; gap: 6px; }
#skiPane .sk-card h3 { margin: 0; font-size: 1rem; }
#skiPane .sk-card dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: .82rem; }
#skiPane .sk-card dt { color: var(--muted); }
#skiPane .sk-card dd { margin: 0; overflow-wrap: anywhere; }
#skiPane .sk-x { float: right; font: inherit; border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 1rem; }
#skiPane .av-days { display: flex; gap: 4px; flex-wrap: wrap; }
#skiPane .av-days button { font: inherit; font-size: .8rem; font-weight: 600; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
#skiPane .av-days button[aria-pressed="true"] { background: var(--fg); color: var(--panel); border-color: var(--fg); }
#skiPane .av-chip { font-weight: 700; font-size: .78rem; padding: 2px 8px; border-radius: 6px; text-align: center; min-width: 108px; }
#skiPane .av-prob { display: grid; grid-template-columns: 74px 1fr; gap: 10px; align-items: start; border-top: 1px solid var(--line); padding-top: 8px; }
#skiPane .av-prob b { display: block; }
#skiPane .av-prob p, #skiPane .av-card p { margin: 2px 0; font-size: .82rem; }
#skiPane .av-card { gap: 8px; }
#skiPane .av-top { display: flex; flex-direction: column; gap: 1px; }
#skiPane .av-top h3 { font-size: .95rem; }
#skiPane .av-where { color: var(--muted); font-size: .78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#skiPane .av-line { margin: 0; font-size: .85rem; }
#skiPane .av-card.av-dup .av-line { display: none; }
#skiPane .av-bands { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
#skiPane .av-band { background: var(--c); color: var(--t); border-radius: 8px; padding: 6px 4px; text-align: center; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
#skiPane .av-band b { font-size: .8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#skiPane .av-band span { font-size: .66rem; opacity: .85; white-space: nowrap; }
#skiPane .av-foot { display: flex; flex-wrap: wrap; gap: 5px; }
#skiPane .av-pill { font: inherit; font-size: .76rem; font-weight: 700; padding: 5px 10px; white-space: nowrap; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; text-decoration: none; }
#skiPane .av-sw { display: inline-block; width: 14px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; background: linear-gradient(90deg, #52ba4a, #fff300, #f79218, #ef1c29); }
#skiPane .av-pill[aria-pressed="true"] { background: #f79218; border-color: #f79218; color: #1a1a1a; }
#skiPane .av-card > details > summary { font-size: .82rem; color: var(--muted); }
#skiPane .av-warn { background: #fff3cd; color: #5c4400; border-radius: 8px; padding: 6px 8px; font-size: .82rem; font-weight: 600; }
#skiPane .av-adv { margin: 4px 0 6px; padding-left: 18px; font-size: .82rem; }
#skiPane .av-adv li { margin: 2px 0; }
#skiPane .av-legend { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; font-size: .8rem; }
#skiPane .av-legend i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; border: 1px solid #0002; }
#skiPane details summary { cursor: pointer; font-weight: 600; font-size: .85rem; }
#skiPane details p { white-space: pre-line; }
.sk-pin { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px #0006; color: #fff; font-size: 12px; line-height: 1; }
.sk-pin.on { outline: 3px solid #ffe14d; }
/* Hut pins (zoomed in): a brown house above the spot, drawn over webcams so a hut with a camera beside it still shows. */
.sk-hutpin { position: relative; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px; background: #7a2e10; border: 2px solid #fff; box-shadow: 0 1px 4px #0008; cursor: pointer; box-sizing: border-box; }
.sk-hutpin:after { content: ""; position: absolute; left: 50%; bottom: -7px; margin-left: -5px; border: 5px solid transparent; border-top: 6px solid #fff; border-bottom: 0; }
.sk-hutpin svg { width: 16px; height: 16px; fill: #fff; }
.sk-hutpin.book b { position: absolute; top: -8px; right: -10px; padding: 0 4px; border-radius: 7px; background: #0b7a3e; color: #fff; font: 800 9px/14px system-ui, sans-serif; border: 1.5px solid #fff; }
.sk-hutpin.on { box-shadow: 0 0 0 3px #ffe14d, 0 1px 4px #0008; }
.sk-hutgl { z-index: 3; }
.sk-plangl { z-index: 5; }
.sk-book { display: grid; gap: 4px; margin: 8px 0 4px; padding: 10px 12px; border-radius: 10px; background: #f6efe9; border: 1px solid #e3d3c6; color: #3b1d0d; }
.sk-hutphs { margin: 8px 0 2px; }
.sk-hutph { display: block; position: relative; width: 100%; padding: 0; border: 0; border-radius: 10px; overflow: hidden; background: var(--chip, #eee); cursor: zoom-in; }
.sk-hutph img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; }
.sk-hutph-n { position: absolute; right: 8px; bottom: 8px; padding: 2px 8px; border-radius: 999px; background: rgba(0,0,0,.6); color: #fff; font-size: 13px; font-weight: 700; }
.sk-hutph-row { display: flex; gap: 6px; margin-top: 6px; overflow-x: auto; }
.sk-hutph-t { flex: 0 0 auto; padding: 0; border: 0; border-radius: 8px; overflow: hidden; background: var(--chip, #eee); }
.sk-hutph-t img { display: block; width: 72px; height: 54px; object-fit: cover; }
.sk-hutph-credit { margin: 4px 0 0; font-size: 11px; }
.sk-hutph-none { margin: 0; }
.sk-book.must { background: #fff4e0; border-color: #f0b85a; }
.sk-book b { font-size: 15px; }
.sk-book .sk-bookbtn { justify-self: start; margin-top: 2px; padding: 8px 16px; border-radius: 999px; background: #0b7a3e; color: #fff; font-weight: 700; text-decoration: none; }
.leaflet-tooltip.sk-hutname { background: none; border: 0; box-shadow: none; padding: 0; color: #7a2e10; font: 700 12px/1.2 system-ui, sans-serif; text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff; }
.leaflet-tooltip.sk-hutname:before { display: none; }
.sk-pin.park { border-radius: 6px; font-weight: 800; font-family: system-ui, sans-serif; }
body.sport-ski details.legend.sk-key { display: block !important; }
body:not(.sport-ski) details.legend.sk-key { display: none !important; }
.legend.sk-key .sk-kic { width: 34px; flex: none; display: flex; justify-content: center; }
.legend.sk-key .sk-kic i { width: 30px; }
.legend.sk-key .sk-kdot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px #0005; }
.legend.sk-key .sk-pin { width: 18px; height: 18px; font-size: 10px; }
.legend.sk-key .sk-snow { transform: none; font-size: 9px; padding: 2px 4px; }
#skiPane .sk-safe { font-size: .78rem; color: var(--muted); margin: 0; }
#skiPane .sb-club { border-top: 1px solid var(--line); padding-top: 8px; margin-top: 8px; display: flex; flex-direction: column; gap: 3px; font-size: .82rem; }
#skiPane .sb-club b { font-size: .9rem; }
#skiPane .sb-areas, #skiPane .sb-when { color: var(--muted); }
#skiPane .sb-rep { white-space: pre-line; background: var(--chip); border-radius: 8px; padding: 6px 8px; max-height: 9em; overflow: auto; }
#skiPane .sb-links { display: flex; flex-wrap: wrap; gap: 4px 12px; }
#skiPane .sb-club.on { outline: 2px solid #ffe14d; outline-offset: 4px; border-radius: 4px; }
#skiPane .sk-sec { border-top: 1px solid var(--line); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; font-size: .85rem; }
#skiPane .sk-sec h4 { margin: 0; font-size: .92rem; }
#skiPane .sk-sec h5 { margin: 4px 0 0; font-size: .85rem; }
#skiPane .sk-sec p { margin: 0; }
#skiPane .sk-note { color: var(--muted); font-size: .78rem; font-weight: 400; }
#skiPane .sk-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; text-align: center; }
#skiPane .sk-stats div { background: var(--chip); border-radius: 8px; padding: 5px 2px; display: flex; flex-direction: column; }
#skiPane .sk-stats b { font-size: .88rem; white-space: nowrap; }
#skiPane .sk-stats span { color: var(--muted); font-size: .72rem; }
#skiPane .sk-prof { width: 100%; height: auto; display: block; touch-action: none; cursor: crosshair; }
#skiPane .sk-prof .pf-fill { fill: #1f5fe0; opacity: .14; }
#skiPane .sk-prof .pf-line { fill: none; stroke: #1f5fe0; stroke-width: 2; stroke-linejoin: round; }
#skiPane .sk-prof .pf-steep { fill: none; stroke: #e8590c; stroke-width: 3; stroke-linecap: round; }
#skiPane .sk-prof .pf-band { stroke: var(--muted); stroke-dasharray: 3 3; stroke-width: 1; opacity: .7; }
#skiPane .sk-prof .pf-lbl { font-size: 9px; fill: var(--muted); }
#skiPane .sk-prof .pf-cur { stroke: #e8590c; stroke-width: 1.2; }
#skiPane .pf-read { font-size: .78rem; color: var(--muted); min-height: 1.2em; }
#skiPane table.sk-avt, #skiPane table.sk-wx { border-collapse: collapse; width: 100%; font-size: .8rem; }
#skiPane .sk-avt th, #skiPane .sk-avt td, #skiPane .sk-wx th, #skiPane .sk-wx td { padding: 3px 4px; text-align: left; vertical-align: middle; }
#skiPane .sk-wx th { font-weight: 600; color: var(--muted); font-size: .72rem; }
#skiPane .sk-wx tr > th:first-child, #skiPane .sk-avt tr > th:first-child { color: var(--fg); font-size: .8rem; white-space: nowrap; }
#skiPane .sk-wx td { white-space: nowrap; }
#skiPane .sk-avt .av-chip { min-width: 0; display: block; font-size: .72rem; padding: 2px 4px; white-space: nowrap; }
#skiPane .sk-avt th .sk-note { display: block; font-size: .7rem; }
#skiPane .sk-avt td + td { width: 28px; }
#skiPane .sk-avt tr.off, #skiPane .av-prob.off { opacity: .45; }
#skiPane .sk-pre { white-space: pre-line; }
#skiPane ul.sk-min { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
#skiPane ul.sk-min li { border-left: 3px solid var(--line); padding-left: 8px; }
#skiPane ul.sk-min li.av { border-left-color: #ef1c29; }
#skiPane .ab-photos { margin: 0; }
#skiPane .sk-light { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; color: var(--fg); }
#skiPane .sk-light i { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 1px #0003; flex: none; }
#skiPane .sk-ates { display: inline-block; font-weight: 700; font-size: .72rem; line-height: 1.4; padding: 0 6px; border-radius: 5px; color: #fff; background: var(--c); box-shadow: 0 0 0 1px #fff3; }
#skiPane .sk-countrow { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
#skiPane .sk-sort { font: inherit; font-size: .76rem; font-weight: 700; border: 0; background: none; color: #1f5fe0; cursor: pointer; padding: 2px 0; white-space: nowrap; }
#skiPane .sk-sort[hidden] { display: none; }
#skiPane .sk-check { border-radius: 10px; padding: 8px 10px; background: color-mix(in srgb, var(--c) 16%, var(--panel)); border-left: 6px solid var(--c); display: flex; flex-direction: column; gap: 2px; }
#skiPane .sk-check b { font-size: 1.02rem; }
#skiPane ul.sk-checkdays, #skiPane ul.sk-signs, #skiPane ul.sk-why { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: .82rem; }
#skiPane ul.sk-why li::before { content: "· "; color: var(--muted); }
#skiPane ul.sk-signs li { border-left: 4px solid #f2b705; padding: 1px 0 1px 8px; }
#skiPane ul.sk-signs li.hi { border-left-color: #e03131; }
#skiPane ul.sk-signs li.ok { border-left-color: #2f9e44; }
#skiPane .sk-spot h4 { margin: 6px 0 2px; font-size: .92rem; }
#skiPane .sk-spot h5 { margin: 4px 0 0; font-size: .82rem; }
#skiPane .sk-spot .sk-stats .sk-spotslope { background: color-mix(in srgb, var(--c) 45%, var(--panel)); box-shadow: inset 0 -4px 0 var(--c); }
#skiPane .sk-spot .sk-stats.sk-spotg { grid-template-columns: minmax(0, .8fr) minmax(0, .8fr) minmax(0, 1.1fr) minmax(0, 1.3fr); gap: 5px; }
#skiPane .sk-spot .sk-stats div { min-width: 0; }
#skiPane .sk-spot .sk-stats b { overflow: hidden; text-overflow: ellipsis; }
#skiPane .sk-spot .sk-stats .sk-spotates { background: color-mix(in srgb, var(--c) 22%, var(--panel)); box-shadow: inset 0 -4px 0 var(--c), inset 0 0 0 1px color-mix(in srgb, var(--c) 45%, var(--muted)); }
#skiPane .sk-spot .sk-stats .sk-spotates b { color: var(--fg); font-size: .8rem; letter-spacing: -.01em; line-height: 1.35; }
#skiPane .sk-spotdays { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 6px; text-align: center; font-size: .74rem; color: var(--muted); }
#skiPane .sk-spotdays div { display: flex; flex-direction: column; gap: 2px; }
#skiPane .sk-spotdays .av-chip { min-width: 0; font-size: .72rem; padding: 3px 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#skiPane .sk-stats.sk-stats3 { grid-template-columns: repeat(3, 1fr); }
#skiPane .sk-spot .sk-snowlbl { margin: 4px 0 0; font-size: .78rem; font-weight: 700; color: var(--muted); }
#skiPane .sk-daysx { overflow-x: auto; -webkit-overflow-scrolling: touch; }
#skiPane table.sk-days { border-collapse: collapse; width: 100%; font-size: .74rem; text-align: center; }
#skiPane .sk-days th, #skiPane .sk-days td { padding: 2px 1px; white-space: nowrap; line-height: 1.25; }
#skiPane .sk-days th { text-align: left; color: var(--muted); font-weight: 600; padding-right: 4px; }
#skiPane .sk-days tr:first-child td { font-size: .72rem; }
#skiPane .sk-days tr + tr td { border-top: 1px solid var(--line); }
#skiPane .sk-days small { color: var(--muted); font-size: .66rem; }
#skiPane .sk-days .sk-dsnow { display: inline-block; min-width: 1.8em; border-radius: 4px; padding: 0 2px; }
#skiPane .sk-spot .sk-fold summary { cursor: pointer; font-weight: 700; font-size: .85rem; padding: 4px 0; }
#skiPane .sk-spot .sk-spotacts { margin-top: 4px; }
#skiPane .sk-watch[aria-pressed="true"] { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
#skiPane .sk-keyrow { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: .78rem; }
#skiPane .sk-keyrow i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
/* Avalanche and terrain layers as picture tiles, 3 to a row (FATMAP's layer menu) */
.lm-ski .sk-tilegrid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 8px; padding: 6px 0 4px; }
.lm-ski .sk-tilegrid .sk-slot, .lm-ski .sk-tilegrid .sk-rows { display: contents; }
.lm-ski .sk-tile, .map-tools .layers-menu .lm-ski .sk-tilegrid .sk-slot button { position: relative; display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 0; margin: 0;
  cursor: pointer; background: none; border: 0; border-radius: 0; font: inherit; color: var(--fg); min-height: 0; min-width: 0; width: auto; box-shadow: none; text-align: center; }
.lm-ski .sk-thumb, .map-tools .layers-menu .lm-ski .sk-tilegrid .sk-slot .sk-lic { position: relative; display: grid; place-items: center; width: 100%; height: auto; aspect-ratio: 1; border-radius: 12px;
  box-sizing: border-box; border: 2px solid var(--line); background-size: cover; background-position: center; font-size: 22px; color: #fff; text-shadow: 0 1px 3px #0008; }
.lm-ski .sk-tcap, .map-tools .layers-menu .lm-ski .sk-tilegrid .sk-slot button b { display: block; font-size: .74rem; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
.lm-ski .sk-tile .sk-sw { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
.map-tools .layers-menu .lm-ski .sk-tilegrid .sk-slot button::after { display: none; }
.lm-ski .sk-tile:has(.sk-sw:checked) .sk-thumb, .map-tools .layers-menu .lm-ski .sk-tilegrid .sk-slot button[aria-pressed="true"] .sk-lic { border-color: #1f5fe0; box-shadow: 0 0 0 2px #1f5fe0; }
.lm-ski .sk-tile:has(.sk-sw:checked) .sk-thumb::after, .map-tools .layers-menu .lm-ski .sk-tilegrid .sk-slot button[aria-pressed="true"] .sk-lic::after { content: "✓"; position: absolute; top: 4px; right: 4px;
  width: 18px; height: 18px; border-radius: 50%; background: #1f5fe0; color: #fff; font: 800 11px/18px system-ui, sans-serif; text-align: center; text-shadow: none; }
.lm-ski .sk-tile:has(.sk-sw:focus-visible) .sk-thumb { outline: 2px solid var(--accent); outline-offset: 2px; }
.lm-ski .sk-palrow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: .76rem; color: var(--muted); padding: 2px 0 4px; }
.lm-ski .sk-palrow[hidden] { display: none; }
.map-tools .layers-menu .lm-ski .sk-palrow button { font: inherit; font-weight: 700; font-size: .76rem; padding: 4px 10px; min-height: 0; width: auto; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); box-shadow: none; cursor: pointer; }
.map-tools .layers-menu .lm-ski .sk-palrow button[aria-pressed="true"] { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
/* The colour key of the shaded layers, top left of the map, on the flat and the 3D map (FATMAP's key bar) */
.leaflet-control.sk-bars { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; pointer-events: auto; }
.leaflet-control.sk-bars[hidden] { display: none; }
.sk-bar { all: unset; box-sizing: border-box; display: block; width: 188px; max-width: calc(100vw - 150px); cursor: pointer; border-radius: 8px; overflow: hidden; background: rgba(18, 26, 34, .82);
  box-shadow: 0 1px 4px #0005; color: #fff; font: 700 10px/1 system-ui, sans-serif; }
.sk-bar .bt { display: block; padding: 3px 6px 2px; font-size: 9.5px; letter-spacing: .04em; text-transform: uppercase; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-bar .bc { display: flex; height: 8px; }
.sk-bar .bc i { flex: 1; }
.sk-bar .bl { display: flex; padding: 2px 0 3px; }
.sk-bar .bl span { flex: 1; text-align: center; white-space: nowrap; font-size: 9.5px; }
.sk-bar:focus-visible { outline: 2px solid #ffe14d; }
/* A route's short card at the top of its details (FATMAP's route card) */
#skiPane .sk-rc { display: flex; flex-direction: column; gap: 8px; }
#skiPane .sk-rc-ph { display: block; width: 100%; aspect-ratio: 16 / 7; object-fit: cover; border-radius: 10px; background: var(--chip); }
#skiPane .sk-rc-ph[hidden] { display: none; }
#skiPane .sk-rc-tag { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: .82rem; }
#skiPane .sk-rc-word { font-weight: 800; color: var(--c); }
#skiPane .sk-rc-elev { display: flex; flex-direction: column; gap: 6px; }
#skiPane .sk-rc-elev .sk-stats b { font-variant-numeric: tabular-nums; }
#skiPane .sk-rc-elev .sk-prof { touch-action: pan-y; }
#skiPane .sk-rc-elev .sk-note { margin: 0; }
#skiPane .sk-rc-btns { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 6px; }
#skiPane .sk-rc-btns button { font: inherit; font-size: .78rem; font-weight: 700; padding: 8px 2px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
#skiPane .sk-rc-btns button .ic { font-size: 1.1rem; line-height: 1.1; }
#skiPane .sk-rc-btns button.go { background: #1c9be6; border-color: #1c9be6; color: #fff; }
#skiPane .sk-rc-btns button[aria-pressed="true"] { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
#skiPane .sk-cond { display: flex; flex-direction: column; gap: 6px; }
#skiPane .sk-cond-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
#skiPane .sk-cond-head h4 { margin: 0; font-size: .92rem; }
#skiPane .sk-cond-days { display: flex; gap: 3px; }
#skiPane .sk-cond-days button { font: inherit; font-size: .74rem; font-weight: 700; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
#skiPane .sk-cond-days button[aria-pressed="true"] { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
#skiPane .sk-cond-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
#skiPane .sk-ct { font: inherit; text-align: left; display: flex; flex-direction: column; gap: 1px; min-width: 0; padding: 7px 9px 8px; border-radius: 12px; cursor: pointer;
  border: 1px solid var(--line); border-top: 5px solid var(--c, var(--line)); background: color-mix(in srgb, var(--c, transparent) 12%, var(--panel)); color: var(--fg); }
#skiPane .sk-ct > small { font-size: .66rem; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
#skiPane .sk-ct > b { font-size: 1.02rem; line-height: 1.2; }
#skiPane .sk-ct > span { font-size: .76rem; line-height: 1.3; }
#skiPane .sk-ct > span.m { color: var(--muted); }
#skiPane .sk-ct .sk-strip { display: flex; gap: 1px; height: 7px; margin: 3px 0 1px; border-radius: 3px; overflow: hidden; }
#skiPane .sk-ct .sk-strip i { flex: 1; }
#skiPane .sk-cond-signs { display: flex; flex-wrap: wrap; gap: 4px; }
#skiPane .sk-cond-signs button { font: inherit; font-size: .74rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; border: 1px solid #f2b705; background: color-mix(in srgb, #f2b705 15%, var(--panel)); color: var(--fg); cursor: pointer; }
#skiPane .sk-cond-signs button.hi { border-color: #e03131; background: color-mix(in srgb, #e03131 14%, var(--panel)); }
#skiPane .sk-cond .sk-note { margin: 0; }
#skiPane .sk-more-btn { font: inherit; font-size: .85rem; font-weight: 700; padding: 8px; border-radius: 10px; border: 1px dashed var(--line); background: none; color: #1f5fe0; cursor: pointer; }
.sk-fly { position: absolute; z-index: 1002; left: 50%; bottom: calc(18px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); display: flex; gap: 8px; align-items: center;
  background: rgba(18, 26, 34, .88); color: #fff; border-radius: 999px; padding: 6px 6px 6px 14px; font: 600 .85rem system-ui, sans-serif; box-shadow: 0 4px 14px #0006; max-width: calc(100% - 24px); box-sizing: border-box; }
.sk-fly span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-fly button { font: inherit; font-weight: 700; border: 0; border-radius: 999px; background: #fff; color: #15211a; padding: 7px 14px; cursor: pointer; white-space: nowrap; }
@media (max-width: 760px) { .sk-fly { bottom: auto; top: calc(env(safe-area-inset-top, 0px) + 74px); left: auto; right: 10px; transform: none; max-width: calc(100% - 130px); } }`;
  document.head.append(css);

  // ---------- the sport menu ----------
  const SPORTS = ["mtb", "ski", "hunt", "fish", "moto", "hike"];   // Hiking (hike.js) since 2026-11-02
  let sport = SPORTS.includes(store.get("sport", "mtb")) ? store.get("sport", "mtb") : "mtb";
  let avyOn = store.get("avy", false);

  // ---------- panel ----------
  const pane = document.createElement("section");
  pane.id = "skiPane";
  pane.setAttribute("aria-label", "Skiing");
  pane.innerHTML = `
    <div class="sk-views" id="skViews" role="group" aria-label="Show these routes"></div>
    <form class="sk-findform" id="skFindForm" role="search"><div class="ps-row"><input type="search" class="sk-find" id="skFind" placeholder="Search or ask a question" aria-label="Search a route, hut, resort, freeride line or place, or ask in plain words" autocomplete="off" spellcheck="false" enterkeyhint="search"><button type="submit" class="ps-go">Go</button></div></form>
    <p class="ps-msg" id="skPlaceMsg" role="status"></p><ul class="ps-hits" id="skPlaces" aria-label="Search results"></ul>
    <button type="button" class="sk-now" id="skNow" hidden></button>
    <div class="sk-acts"><button type="button" class="sk-act" id="skPlanBtn">✎ Plan a tour</button><button type="button" class="sk-act" id="skRecBtn">▶ Record a tour</button><button type="button" class="sk-act" id="skSaveBtn" title="Save a point on the map with a name, a description and a photo">📍 Save a point</button><button type="button" class="sk-act" id="skNewBtn" hidden>＋ Plan a new tour</button><button type="button" class="sk-act" id="skToursBtn" hidden>📂 Saved tours</button></div>
    <div class="sk-slopekey" id="skSlopeKey" hidden></div>
    <div class="sk-slopekey" id="skLayerKey" hidden></div>
    <div class="sk-card sk-plan" id="skPlan" hidden></div>
    <div class="sk-card sk-tourscard" id="skTours" hidden></div>
    <div class="sk-card sk-spot" id="skSpot" hidden></div>
    <div class="sk-card" id="skStation" hidden></div>
    <div class="sk-card" id="skDetail" hidden></div>
    <div class="av-card sk-card" id="avCard" hidden></div>
    <details class="sk-card" id="sbCard" hidden><summary id="sbSum">Snowmobile clubs and grooming</summary><div id="sbBody"></div></details>
    <div class="sk-listwrap">
      <div class="sk-tabs" id="skTabs" role="tablist" aria-label="List"><button type="button" role="tab" data-tab="routes">Routes</button><button type="button" role="tab" data-tab="huts">Huts</button></div>
      <div class="sk-countrow"><p class="sk-count" id="skCount">Routes in view</p><button type="button" class="sk-sort" id="skSort" hidden></button></div>
      <ul class="sk-list" id="skList"></ul>
    </div>
    <p class="sk-safe">Open maps can be wrong and no route is avalanche-safe. Trail Finder helps you plan; it doesn't replace avalanche training (<a href="https://avysavvy.avalanche.ca/" target="_blank" rel="noopener">free online course</a>, then an AST 1), a beacon, probe and shovel, <a href="https://avalanche.ca/map" target="_blank" rel="noopener">Avalanche Canada's forecast</a> or what you see on the day. Where you go is your decision and your risk.</p>`;
  const head = document.querySelector(".panel-head");
  const modes = head && head.querySelector(".modes");
  if (modes) modes.after(pane); else if (head) head.append(pane);
  const $ = (id) => document.getElementById(id);

  // ---------- canvases over the ski routes (lifts.js, slackcountry.js) ----------
  // Leaflet sends a tap only to the canvas on top, so a canvas over the ski routes' canvas would swallow the taps on the
  // routes (and on any other canvas below it). Those canvases call tfSkiTapThrough(renderer): their canvas lets taps
  // through (pointer-events: none), and a tap that lands on one of their own tappable lines is caught here first (the
  // highest pane wins) and sent to that line as a click, as Leaflet would have.
  const through = [];
  window.tfSkiTapThrough = (renderer) => {
    through.push(renderer);
    const pane = renderer.options.pane;
    document.head.insertAdjacentHTML("beforeend", `<style>.leaflet-${pane}-pane > canvas { pointer-events: none !important; }</style>`);
  };
  const hitOn = (r, lp) => {
    let hit = null;
    for (let o = r._drawFirst; o; o = o.next) { const l = o.layer; if (l.options.interactive && l._containsPoint && l._containsPoint(lp)) hit = l; }   // the last drawn is on top
    return hit;
  };
  // A pin (webcam, gate, parking, resort...) or a map button keeps its own tap: webcams sit at lift stations, so the
  // lift line under them took the tap and the camera never opened (alex's iPhone, 2026-10-27). Taps on the 3D map are
  // map3d.js's (it finds the lines itself); the flat map hidden under it lines up with the 3D ground only from straight above.
  const ownTap = ".leaflet-marker-icon, .leaflet-control, .leaflet-popup, .leaflet-tooltip, #map3d";
  map.getContainer().addEventListener("click", (e) => {
    if (!through.length || (map.dragging && map.dragging.moved())) return;
    if (e.target && e.target.closest && e.target.closest(ownTap)) return;
    const cp = map.mouseEventToContainerPoint(e), lp = map.containerPointToLayerPoint(cp);
    const rs = through.filter((r) => r._map && r._container).sort((a, b) => (+map.getPane(b.options.pane).style.zIndex || 0) - (+map.getPane(a.options.pane).style.zIndex || 0));
    for (const r of rs) {
      const l = hitOn(r, lp);
      if (!l) continue;
      e.stopPropagation(); e.preventDefault();
      l.fire("click", { latlng: map.containerPointToLatLng(cp), layerPoint: lp, containerPoint: cp, originalEvent: e }, true);
      return;
    }
  }, true);

  // ---------- ski routes ----------
  map.createPane("ski").style.zIndex = 420;
  const skiRenderer = L.canvas({ pane: "ski", padding: 0.3, tolerance: L.Browser.touch ? 10 : 5 });
  const skiLayer = L.layerGroup();
  const hutLayer = L.layerGroup();
  let ski = null, skiLoading = null, skiErr = "";
  // "skiLayers2": the simpler Skiing starts everyone again on Touring (and their own tours), the old 13 chips forgotten.
  // Skiing opens with a short set (alex 2026-11-05: "those should be by default", "take huts and cabin of the default
  // layer"): touring routes, approaches, parking and the rider's own tours (+ Lift status, lifts.js; Rogers Pass permits
  // ask when the map is there, rogers.js). The 3D ground was ready about 14% sooner, 397 -> ~27 pins at Whistler. Everyone gets it once ("skiShort"); after that their own choice stays.
  // alex 2026-11-07 (Layers screenshot, "make it like that instead"): Your ski tours start off, Slackcountry on
  // (slackcountry.js). Everyone gets "Your ski tours" off once ("skiMineOff"); after that their own choice stays.
  // alex 2026-11-08 (screen recording, "make those layer by default when you are not sign in"): a device that isn't
  // signed in opens Skiing on Ski touring + Snowmobile trails, with Webcams, Lift status and Slackcountry on (webcams.js,
  // lifts.js, slackcountry.js read the tf:ski* switches written here; they load after this file). Approach trails,
  // parking and every ground colour start off. Signed-out devices get it once ("skiGuest"); after that their own choice
  // stays. Signed-in devices keep their own layers.
  const signedIn = (() => { try { return Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k)); } catch { return false; } })();
  const GUEST_START = ["tour", "snowmobile"];
  const SKI_START = signedIn ? ["tour", "access", "park"] : GUEST_START;
  let shown = new Set(store.get("skiLayers2", SKI_START));
  if (!signedIn && !store.get("skiGuest", false)) {
    shown = new Set(GUEST_START);
    try { ["tf:skiCams", "tf:skiLifts", "tf:skiSlack"].forEach((k) => localStorage.setItem(k, "true")); } catch {}
    store.set("avy", false); avyOn = false;
    ["skiShort", "skiMineOff", "skiSnowAdded", "skiParkAdded", "skiGuest"].forEach((k) => store.set(k, true));   // the older one-time changes don't touch it after
    store.set("skiLayers2", [...shown]);
  }
  if (!store.get("skiShort", false)) {
    ["other", "snow", "hut"].forEach((k) => shown.delete(k));
    store.set("skiSnowAdded", true); store.set("skiParkAdded", true); store.set("skiShort", true); store.set("skiLayers2", [...shown]);
  }
  if (!store.get("skiMineOff", false)) { shown.delete("mine"); store.set("skiMineOff", true); store.set("skiLayers2", [...shown]); }
  if (!store.get("skiSnowAdded", false)) { if (shown.has("tour")) shown.add("snow"); store.set("skiSnowAdded", true); store.set("skiLayers2", [...shown]); }
  if (!store.get("skiParkAdded", false)) { if (shown.has("access")) shown.add("park"); store.set("skiParkAdded", true); store.set("skiLayers2", [...shown]); }
  // The ground colours (Avalanche risk and the shaded terrain and snow layers): one at a time (window.tfOneGround).
  const GROUND = ["avy", "slope", "aspect", "runout", "flats", "elev", "fresh", "snowfc"];
  // k just went on: the other ground colours go off. Returns the keys turned off (the caller redraws them).
  function oneGround(k) {
    const s = new Set(shown);
    if (avyOn) s.add("avy");
    const off = window.tfOneGround(s, k, GROUND);
    off.forEach((x) => shown.delete(x));
    if (off.includes("avy")) { avyOn = false; store.set("avy", false); }
    return off;
  }
  if (oneGround(null).length) store.set("skiLayers2", [...shown]);
  let selected = null;   // route or hut object
  // A tour being planned: the points tapped on the map (kept on this device), drawn as an orange line.
  const plan = { on: false, pts: store.get("skiPlan", []), layer: L.layerGroup(), slopeWas: false, groundWas: [], timer: 0,
    safe: store.get("skiSafe", false) === true,   // off until turned on for this tour (alex 2026-11-06, liability review: a choice, not the default)
    path: store.get("skiPlanPath", null), run: 0, wait: "", fail: "", hist: [], offer: null, flash: -1, dragAt: 0, show: false,   // safe: the 🛡 Safest way (ski-route.js)
    tour: store.get("skiPlanTour", null), naming: false };   // tour: the saved tour (tf:skiTours) on the card, if it's one
  // The ?demo=forecast past forecast (taken out 2026-11-07) left its flag on the phones that opened it, and a way found
  // with it kept that day's "3 Considerable" as today's danger (alex's screenshot 2026-11-07). Both go; the way is found
  // again with the real forecast.
  try { if (localStorage.getItem("tf:demoAvy") != null) { localStorage.removeItem("tf:demoAvy"); plan.path = null; store.set("skiPlanPath", null); } } catch {}
  const SAFE_CLS = {
    ok: { color: "#2f9e44", label: "Gentle ground" }, mid: { color: "#f2b705", label: "25° to 30°" }, steep: { color: "#e03131", label: "30°+ slope" },
    under: { color: "#e8590c", label: "Under steep slopes" }, trap: { color: "#a61e4d", label: "Terrain trap" },
  };
  const SAFE_ASP = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"], SAFE_BAND = ["alpine", "treeline", "below treeline"];
  // The places to watch on a found way: its steep, exposed and trap pieces, those less than 150 m apart as one stretch.
  function safeWatch(sp) {
    const out = [];
    let cur = null, gap = 0;
    for (const r of sp.runs || []) {
      if (r.cls !== "steep" && r.cls !== "under" && r.cls !== "trap") { if (cur) gap += r.m; continue; }
      if (cur && gap < 150) {
        cur.m += gap + r.m; cur.by[r.cls] = (cur.by[r.cls] || 0) + r.m; cur.hit = cur.hit || r.hit;
        if (r.maxDeg > cur.maxDeg) { cur.maxDeg = r.maxDeg; cur.asp = r.asp; cur.band = r.band; }
        if (r.src && (!cur.src || r.src.deg + (r.src.hit ? 10 : 0) > cur.src.deg + (cur.src.hit ? 10 : 0))) cur.src = r.src;
        if (r.m > cur.big) { cur.big = r.m; cur.mid = r.mid; }
        cur.at1 = r.at1;
      } else { cur = { ...r, by: { [r.cls]: r.m }, big: r.m }; out.push(cur); }
      gap = 0;
    }
    for (const w of out) w.cls = w.by.trap >= 20 ? "trap" : (w.by.steep || 0) >= (w.by.under || 0) ? "steep" : "under";
    const res = out.filter((w) => w.m >= 40);
    return res;
  }
  const aboveLayer = L.layerGroup();   // drawAbove()
  const pinLayer = L.layerGroup();     // drawPins(): the opened tour's start and top
  const lineOf = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
  const km = (r) => {
    if (r.km != null) return r.km;
    if (!r.g) return 0;   // huts, starts and other points have no line (a tapped hut threw here on the 3D map)
    let m = 0;
    for (const part of r.g) for (let i = 2; i < part.length; i += 2) m += map.distance([part[i - 2], part[i - 1]], [part[i], part[i + 1]]);
    return (r.km = m / 1000);
  };
  // The size of a route mapped as a closed ring (r.area), in hectares.
  const hectares = (r) => {
    const p = r.g[0], k = Math.cos((p[0] * Math.PI) / 180) * 111320;
    let a = 0;
    for (let i = 2; i < p.length; i += 2) a += (p[i - 1] * k) * (p[i] * 110540) - (p[i + 1] * k) * (p[i - 2] * 110540);
    return Math.abs(a) / 2 / 10000;
  };
  // Each route's terrain class estimate and lowest and highest points, worked out every night (data/ski-terrain.json,
  // scripts/build-ski-terrain.mjs with ski-terrain.js): the trip planner light in the list without loading any terrain.
  let terrain = null;
  function loadTerrain() {
    if (terrain) return;
    terrain = {};
    fetch("data/ski-terrain.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { terrain = (d && d.routes) || {}; renderList(); if (selected && !$("skDetail").hidden) showCheck(); }).catch(() => {});
  }
  // Spelling slips in mapped names (alex 2026-11-04: "Steep Creek Forest Serivce Road" on the Duffey).
  const NAME_FIX = [[/\bSerivce\b/g, "Service"], [/\bSevice\b/g, "Service"], [/\bFores\b(?= Service)/g, "Forest"]];
  function fixName(r) { if (r.name) NAME_FIX.forEach(([re, to]) => { r.name = r.name.replace(re, to); }); }
  function loadSki() {
    loadTerrain();
    if (ski || skiLoading) return skiLoading;
    skiLoading = Promise.all([fetch("data/ski.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }), loadHutInfo()])
      .then(([d]) => {
        ski = d;
        tidyAccess(d);
        d.huts = hutFacts(d.huts || [], true);
        (d.routes || []).forEach((r) => { r.lines = r.g.map(lineOf); r.bounds = L.latLngBounds(r.lines.flat()); fixName(r); });
        window.dispatchEvent(new CustomEvent("tf:ski-data", { detail: d }));   // rogers.js: official terrain classes (r.ates)
        drawSki(); renderSwitches(); renderList(); loadCanadaView();
      })
      .catch((e) => { skiErr = e.message; renderList(); })
      .finally(() => { skiLoading = null; });
    return skiLoading;
  }
  // Hut facts from the clubs and parks that run them (data/huts.json; alex 2026-10-30: "There is huts missing! Look
  // for more and keep it updated. If you need to book it tell it and add the link to book"): booking, the link to
  // book, price, beds, heat, water, toilets. Each entry's tags go on the OpenStreetMap hut with the same name within
  // 5 km (or any hut within 250 m); an entry with no hut on the map is added as its own hut. Huts of a club or park
  // with no entry get the club's own rules (operators). The cabin trip planner reads the same tags off each hut.
  let hutInfo = null, hutInfoLoading = null;
  const loadHutInfo = () => hutInfo ? Promise.resolve(hutInfo) : hutInfoLoading || (hutInfoLoading = fetch("data/huts.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((d) => {
      hutInfo = { huts: (d && d.huts) || [], checked: d && d.checked, ops: ((d && d.operators) || []).map((o) => ({ ...o, re: new RegExp(o.op, "i") })) };
      hutInfo.huts.forEach((e) => { e.keys = [e.name, ...(e.aka || [])].map(hutKey).filter(Boolean); });
      return hutInfo;
    }));
  // "Kees & Claire Hut", "Kees and Claire Memorial Hut" -> "keesclaire", "keesclairememorial"
  const hutKey = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(the|and|hut|huts|cabin|lodge|shelter|refuge|chalet)\b/g, "").replace(/[^a-z0-9]+/g, "");
  const hutM = (a, b) => Math.hypot((a.lat - b.lat) * 110540, (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180));
  function hutEntry(h) {
    const k = hutKey(h.name);
    let best = null, bestM = Infinity;
    for (const e of hutInfo.huts) {
      if (e.lat == null) continue;
      const m = hutM(h, e);
      const named = k && m < 5000 && e.keys.some((n) => n === k || (n.length >= 5 && k.length >= 5 && (n.includes(k) || k.includes(n))));
      if ((named || m < 250) && m < bestM) { best = e; bestM = m; }
    }
    return best;
  }
  const opRule = (h) => hutInfo.ops.find((o) => o.re.test((h.tags && h.tags.operator) || ""));
  function withFacts(h, e) {
    if (e) { h.tags = { ...(h.tags || {}), ...e.tags }; h.facts = e; if (!h.name) h.name = e.name; }
    else if (h.facts && h.facts.keys) { h.tags = { ...h.tags, ...h.facts.tags }; }   // added again with the map's tags
    const o = opRule(h);
    if (o) { h.tags = { ...o.tags, ...h.tags }; if (!h.facts) h.facts = o; }
    // The ACC's old hut pages (alpineclubofcanada.ca/web/ACCMember/...), still on many map huts, are gone.
    if (/alpineclubofcanada\.ca\/web\//i.test((h.tags && h.tags.website) || "")) h.tags = { ...h.tags, website: "https://alpineclubofcanada.ca/huts/" };
    return h;
  }
  // The home file (first) adds the entries no map hut matched; the Canada squares loaded later leave out a hut
  // already added that way (its map tags join the added one).
  function hutFacts(list, first) {
    if (!hutInfo) return list;
    const out = [];
    for (const h of list) {
      const e = hutEntry(h);
      if (e && e.added) {
        const a = e.added;
        if (a.src === "club") Object.assign(a, { id: h.id, src: h.src, kind: h.kind || a.kind, pv: h.pv });
        a.tags = { ...(h.tags || {}), ...a.tags }; withFacts(a); continue;
      }
      if (e) e.found = true;
      out.push(withFacts(h, e));
    }
    if (first) hutInfo.huts.forEach((e, i) => {
      if (e.found || e.added || e.lat == null) return;
      e.added = withFacts({ id: "club" + i, src: "club", name: e.name, kind: e.kind || "alpine_hut", lat: e.lat, lon: e.lon, tags: {} }, e);
      out.push(e.added);
    });
    return out;
  }

  // The rest of Canada (alex: "add all the backcountry route that you can find"): backcountry routes and huts outside
  // the home region, in squares of 3° by 6° (data/ski-canada/, scripts/build-winter.mjs). Only the squares the map
  // shows are loaded, then added to ski.routes / huts / starts like the home region's, so the list, search, details,
  // 3D map and alerts all work the same. Zoomed out further than CAN_MIN_Z nothing more is loaded (a phone would
  // otherwise load the whole country).
  // Resort runs, groomed nordic and snowmobile trails outside the home region come the same way, from the nightly Canada
  // job (ca/w/, scripts/build-canada-winter.mjs; alex 2026-10-26: everything everywhere). Squares are keyed "<dir><square>".
  const CAN_MIN_Z = 5;
  // Japan (jp/w/, scripts/build-japan.mjs, weekly; alex 2026-10-30, Skiing only) comes the same way, with its ski lifts.
  // Hokkaido Wilds' ski tours (data/ski-japan-hw/, scripts/hokkaido-wilds.py, hand-run; alex 2026-11-01) too.
  // Hand-kept routes no open source has (data/ski-hand/, alex 2026-11-03: Joffre Shoulder) too.
  const CAN_DIRS = ["data/ski-canada/", "ca/w/", "jp/w/", "data/ski-japan-hw/", "data/ski-hand/"];
  let canIdx = null, canIdxLoading = null, canRedraw = 0;
  const canGot = new Map();   // square -> its loading promise
  const loadCanIdx = () => canIdx ? Promise.resolve(canIdx) : canIdxLoading || (canIdxLoading = Promise.all(CAN_DIRS.map((dir) => fetch(dir + "index.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)))
    .then((idx) => {
      if (!idx.some(Boolean)) { canIdxLoading = null; return null; }
      const tiles = {};
      CAN_DIRS.forEach((dir, i) => Object.entries(idx[i]?.tiles || {}).forEach(([k, t]) => { tiles[dir + k] = t; }));
      return (canIdx = { ...(idx[0] || {}), tiles });
    }));
  function loadCanada(bounds) {
    if (!ski || !canIdx) return Promise.resolve();
    const hit = Object.entries(canIdx.tiles || {}).filter(([k, t]) => bounds.intersects(L.latLngBounds([t.box[0], t.box[1]], [t.box[2], t.box[3]])));
    const want = hit.filter(([k]) => !canGot.has(k));
    // Squares already on their way count too: the Safest way's search (tfSki.trip.near) waits for them, or it would plan
    // without the hand-kept routes when the map had only just asked for them.
    const coming = hit.filter(([k]) => canGot.has(k)).map(([k]) => canGot.get(k));
    return Promise.all([...coming, ...want.map(([k]) => {
      const p = fetch(`${k}.json`, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then((t) => {
        const ids = new Set((ski.routes || []).map((r) => r.id));
        tidyAccess(t);
        for (const r of t.routes || []) {
          if (ids.has(r.id)) continue;
          r.lines = r.g.map(lineOf); r.bounds = L.latLngBounds(r.lines.flat()); fixName(r);
          ski.routes.push(r);
        }
        // Facts added by hand to OpenStreetMap routes (data/ski-hand/ "patch", by route id): a name, tags, links
        // (alex 2026-11-03: the Sea to Sky Gondola's groomed Backcountry Access Road).
        for (const [id, p] of Object.entries(t.patch || {})) {
          const r = ski.routes.find((x) => x.id === id);
          if (!r) continue;
          if (p.name) r.name = p.name;
          // A line redrawn from a GPS track (alex 2026-11-05: the Poop Chutes, skied down the Phalanx Glacier, not from
          // the ridge where OpenStreetMap starts it), and a documented way the Safest way follows (ski-route.js wayOf).
          if (p.g) { r.g = p.g; r.lines = p.g.map(lineOf); r.bounds = L.latLngBounds(r.lines.flat()); r.info = null; }
          if (p.way) r.way = true;
          r.tags = { ...(r.tags || {}), ...(p.tags || {}) };
          if (p.links) r.links = [...(r.links || []), ...p.links.filter((l) => !(r.links || []).some((x) => x.u === l.u))];
        }
        ski.huts = dedupeHw([...(ski.huts || []), ...hutFacts(t.huts || [])]);
        ski.starts = [...(ski.starts || []), ...(t.starts || [])];
        ski.parking = [...(ski.parking || []), ...(t.parking || [])];
        // Ground the Safest way never crosses (data/ski-hand/ "nogo", ski-route.js): flat [lat, lon, ...] lines.
        ski.nogo = [...(ski.nogo || []), ...(t.nogo || []).map((n) => ({ ...n, pts: lineOf(n.g) }))];
        if (t.lifts && t.lifts.length && window.tfLifts) window.tfLifts.add(t);
        clearTimeout(canRedraw);
        canRedraw = setTimeout(() => { if (sport === "ski") { drawSki(); renderList(); } window.dispatchEvent(new CustomEvent("tf:ski-more")); }, 50);   // freeride.js
      }).catch(() => canGot.delete(k));
      canGot.set(k, p);
      return p;
    })]);
  }
  // A Hokkaido Wilds hut and the same hut from OpenStreetMap (within 300 m): one pin, Hokkaido Wilds' (its notes),
  // keeping the OpenStreetMap hut's Japanese name.
  function dedupeHw(huts) {
    const hw = huts.filter((h) => h.src === "hw");
    if (!hw.length) return huts;
    return huts.filter((h) => {
      if (h.src === "hw") return true;
      const twin = hw.find((x) => Math.abs(x.lat - h.lat) < 0.003 && Math.abs(x.lon - h.lon) < 0.004 && map.distance([x.lat, x.lon], [h.lat, h.lon]) < 300);
      if (!twin) return true;
      const ja = (h.tags && h.tags["name:ja"]) || (/[\u3040-\u30ff\u4e00-\u9fff]/.test(h.name || "") ? h.name : "");
      if (ja && !twin.tags["name:ja"]) twin.tags["name:ja"] = ja;
      return false;
    });
  }
  function loadCanadaView() {
    if (sport !== "ski" || !ski || map.getZoom() < CAN_MIN_Z) return;
    loadCanIdx().then(() => loadCanada(map.getBounds().pad(0.25)));
  }
  map.on("moveend", loadCanadaView);
  // "Ski access" was every OpenStreetMap way tagged ski=yes with no piste type: some are trails to the skiing, but the
  // closed rings with no path tag are parking lots (Whistler Village's Lots 1 to 3, Diamond Head's lot). The nightly
  // job (scripts/build-winter.mjs) now sends those as d.parking points; files made before it are sorted out here the
  // same way. Lots within 800 m of a resort run are village or resort parking, not a trailhead: left out. So are
  // private ways and bits of trail under 100 m (a bridge, a mapping slip).
  const RESORT_LOT_M = 800;
  function tidyAccess(d) {
    const lots = [...(d.parking || [])];
    d.routes = (d.routes || []).filter((r) => {
      if (r.type !== "access") return true;
      const t = r.tags || {}, p = r.g[0];
      if (/^(private|no)$/.test(t.access || "")) return false;
      const closed = r.g.length === 1 && p.length >= 8 && Math.hypot((p[0] - p.at(-2)) * 110540, (p[1] - p.at(-1)) * 71000) < 15;
      if (closed && !t.highway) {
        let lat = 0, lon = 0;
        for (let i = 0; i < p.length - 2; i += 2) { lat += p[i]; lon += p[i + 1]; }
        const n = (p.length - 2) / 2;
        lots.push({ id: r.id, src: r.src, kind: "parking", name: r.name || t.description || "", lat: +(lat / n).toFixed(5), lon: +(lon / n).toFixed(5), tags: t });
        return false;
      }
      let m = 0;
      for (const g of r.g) for (let i = 2; i < g.length; i += 2) m += Math.hypot((g[i] - g[i - 2]) * 110540, (g[i + 1] - g[i - 1]) * 71000);
      return m >= 100;
    });
    const runs = (d.routes || []).filter((r) => r.type === "resort" || r.type === "offpiste");
    d.parking = lots.filter((h) => {
      const kx = Math.cos((h.lat * Math.PI) / 180) * 111320, lim = RESORT_LOT_M * RESORT_LOT_M;
      for (const r of runs) for (const g of r.g) for (let i = 0; i < g.length; i += 2) {
        const dx = (g[i + 1] - h.lon) * kx, dy = (g[i] - h.lat) * 110540;
        if (dx * dx + dy * dy < lim) return false;
      }
      return true;
    });
  }
  // A tap on a route, hut or start: its details, or, while planning a tour, the next point of the plan.
  // A tap on the map opens the card and brings it up on phones, as a tap on an empty spot does (alex 2026-10-30).
  const tap = (e, it) => { L.DomEvent.stopPropagation(e); if (plan.on) planAdd(e.latlng); else { select(it); cardInView($("skDetail"), it.lat, it.lon); } };
  function drawSki() {
    skiLayer.clearLayers(); hutLayer.clearLayers();
    if (!ski) return;
    for (const r of ski.routes || []) {
      if (!shown.has(r.type)) continue;
      const t = TYPES[r.type] || TYPES.other, sel = selected === r;
      r.layers = [];
      for (const line of r.lines) {
        // An area (a bowl or zone mapped as a closed ring): a light fill with a thin outline, not a route to follow.
        if (r.area) {
          const a = L.polygon(line, { renderer: skiRenderer, color: sel ? "#ffe14d" : t.color, weight: sel ? 3 : 1.5, opacity: 0.9, dashArray: sel ? null : "5 4", fillColor: t.color, fillOpacity: sel ? 0.25 : 0.12 });
          a.bindTooltip(esc(nameOf(r) || t.label), { sticky: true });
          a.on("click", (e) => tap(e, r));
          skiLayer.addLayer(a);
          continue;
        }
        skiLayer.addLayer(L.polyline(line, { renderer: skiRenderer, color: sel ? "#ffe14d" : "#fff", weight: t.weight + (sel ? 6 : 3), opacity: sel ? 1 : 0.8, interactive: false }));
        const l = L.polyline(line, { renderer: skiRenderer, color: t.color, weight: t.weight + (sel ? 1.5 : 0), opacity: 1, dashArray: t.dashArray, label: r.name || "" });
        l.bindTooltip(esc(nameOf(r) || t.label), { sticky: true });
        l.on("click", (e) => tap(e, r));
        skiLayer.addLayer(l);
      }
    }
    if (shown.has("hut")) for (const h of ski.huts || []) {
      const m = L.circleMarker([h.lat, h.lon], { renderer: skiRenderer, radius: selected === h ? 9 : 6, color: "#fff", weight: 2, fillColor: HUT.color, fillOpacity: 1, label: h.name || "", labelZoom: 12.5 });
      m.bindTooltip(esc(h.name || "Hut"));
      m.on("click", (e) => tap(e, h));
      hutLayer.addLayer(m);
    }
    drawHutNames();
    drawHutPins();
    drawParking();
    if (shown.has("tour")) for (const h of ski.starts || []) {
      const m = L.marker([h.lat, h.lon], { icon: L.divIcon({ className: "", html: `<span class="sk-pin${selected === h ? " on" : ""}" style="background:${START.color}">⛷</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }) });
      m.bindTooltip(esc(h.name || "camptocamp route"));
      m.on("click", (e) => tap(e, h));
      hutLayer.addLayer(m);
    }
  }
  // Hut names beside the brown dots once zoomed in close (alex 2026-10-30); the 3D map writes them from the dots' label.
  const HUT_NAME_ZOOM = 13;
  const hutNames = L.layerGroup();
  function drawHutNames() {
    hutNames.clearLayers();
    if (sport !== "ski" || !ski || !shown.has("hut") || map.getZoom() < HUT_NAME_ZOOM) return;
    const box = map.getBounds().pad(0.3);
    for (const h of ski.huts || []) {
      if (!h.name || !box.contains([h.lat, h.lon])) continue;
      hutNames.addLayer(L.tooltip({ permanent: true, direction: "right", offset: [8, 0], className: "sk-hutname", interactive: false }).setLatLng([h.lat, h.lon]).setContent(esc(h.name)));
    }
  }
  map.on("moveend", () => { if (sport === "ski") { drawHutNames(); drawHutPins(); } });
  // Zoomed in, each hut in view is also a brown house pin (a "Book" tag when it must be booked), on the 3D map too and
  // over the webcam pins: Kees and Claire Hut's small dot was hidden under the Russet Lake webcam (alex 2026-10-30,
  // "There is huts missing!"). The dots stay under them (3D names and taps, and zoomed out).
  const HUT_PIN_ZOOM = 10, HUT_PIN_MAX = 80;
  const hutPins = L.layerGroup();
  let hutGl = [];
  const HOUSE = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 1 7.6l1 1.2 1-.9V14.5h4v-4h2v4h4V7.9l1 .9 1-1.2z"/></svg>`;
  const mustBook = (h) => /^(required|members_only)$/.test((h.tags && h.tags.reservation) || "");
  const hutPin = (h) => `<span class="sk-hutpin${mustBook(h) ? " book" : ""}${selected === h ? " on" : ""}">${HOUSE}${mustBook(h) ? "<b>Book</b>" : ""}</span>`;
  function drawHutPins() {
    hutPins.clearLayers();
    hutGl.forEach((m) => m.remove()); hutGl = [];
    if (sport !== "ski" || !ski || !shown.has("hut") || map.getZoom() < HUT_PIN_ZOOM) return;
    const c = map.getCenter(), box = map.getBounds().pad(0.2), gl = window.trailMap3d;
    const near = (ski.huts || []).filter((h) => box.contains([h.lat, h.lon]))
      .map((h) => ({ h, d: map.distance(c, [h.lat, h.lon]) })).sort((a, b) => a.d - b.d).slice(0, HUT_PIN_MAX);
    for (const { h } of near) {
      const label = h.name || KIND[h.kind] || "Hut";
      const m = L.marker([h.lat, h.lon], { icon: L.divIcon({ className: "", html: hutPin(h), iconSize: [26, 32], iconAnchor: [13, 32] }), title: label, zIndexOffset: 1000 });
      m.on("click", (e) => tap(e, h));
      hutPins.addLayer(m);
      if (gl && window.maplibregl) {
        const el = document.createElement("div");
        el.className = "sk-hutgl"; el.title = label; el.innerHTML = hutPin(h);
        el.addEventListener("click", (e) => { e.stopPropagation(); if (plan.on) planAdd(L.latLng(h.lat, h.lon)); else { select(h); cardInView($("skDetail"), h.lat, h.lon); } });
        hutGl.push(new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -4], opacityWhenCovered: 1 }).setLngLat([h.lon, h.lat]).addTo(gl));
      }
    }
  }
  window.addEventListener("tf:map3d", () => setTimeout(drawHutPins, 0));
  // Trailhead parking pins, on the 3D map too (it doesn't show Leaflet markers).
  const parkLayer = L.layerGroup();
  let parkGl = [];
  const parkPin = (h) => `<span class="sk-pin park${selected === h ? " on" : ""}" style="background:${PARK.color}">P</span>`;
  function drawParking() {
    parkLayer.clearLayers();
    parkGl.forEach((m) => m.remove()); parkGl = [];
    if (sport !== "ski" || !ski || !shown.has("park")) return;
    const gl = window.trailMap3d;
    for (const h of ski.parking || []) {
      const label = h.name || PARK.label;
      const m = L.marker([h.lat, h.lon], { icon: L.divIcon({ className: "", html: parkPin(h), iconSize: [22, 22], iconAnchor: [11, 11] }), title: label });
      m.bindTooltip(esc(label));
      m.on("click", (e) => tap(e, h));
      parkLayer.addLayer(m);
      if (gl && window.maplibregl) {
        const el = document.createElement("div");
        el.title = label; el.innerHTML = parkPin(h);
        el.addEventListener("click", (e) => { e.stopPropagation(); if (plan.on) planAdd(L.latLng(h.lat, h.lon)); else { select(h); cardInView($("skDetail"), h.lat, h.lon); } });
        parkGl.push(new maplibregl.Marker({ element: el, anchor: "center", opacityWhenCovered: 1 }).setLngLat([h.lon, h.lat]).addTo(gl));
      }
    }
  }
  window.addEventListener("tf:map3d", () => setTimeout(drawParking, 0));
  // The four buttons in the panel, and the Skiing switches in the map's Layers menu (under Map style, like Hunting's).
  const lm = document.createElement("div");
  lm.className = "lm-ski";
  lm.innerHTML = `<div class="lm-head">Skiing layers</div>` + GROUPS.map((x, i) => {
    const slot = x.slot ? `<div class="sk-slot" id="lmSkiSlot-${x.slot}"></div>` : "";
    const rows = `<div class="sk-rows${x.routes ? " sk-routes" : ""}${x.tiles ? " sk-tiles" : ""}" data-g="${i}"></div>`;
    if (x.tiles) return `<h4 class="sk-group">${esc(x.g)}</h4><div class="sk-tilegrid">${slot}${rows}</div><div class="sk-palrow" id="skPalRow" hidden></div>`;
    return `<h4 class="sk-group">${esc(x.g)}</h4>${x.slotAfter ? "" : slot}${rows}${x.slotAfter ? slot : ""}`;
  }).join("") + `<p class="sk-note">What the lines and dots mean: tap Key on the map.</p>`;
  const lmStyle = document.querySelector("#layersMenu .lm-style");
  if (lmStyle) lmStyle.after(lm); else if (avyBtn) avyBtn.before(lm);
  // Puts another file's switch in a group, drawn as a row like the others: icon (a symbol on a colour), label, switch.
  window.tfSkiSlot = (slot, btn, ic) => {
    const box = $("lmSkiSlot-" + slot);
    if (!box) return false;
    if (!btn.querySelector(".sk-lic")) btn.innerHTML = `<span class="sk-lic" style="background:${ic.bg}" aria-hidden="true">${ic.sym || ""}</span><b>${esc(ic.label)}</b>`;
    if (btn.parentElement !== box) box.append(btn);
    return true;
  };
  if (avyBtn) window.tfSkiSlot("avy", avyBtn, { label: "Avalanche risk", sym: "⚠", bg: "linear-gradient(135deg, #52ba4a, #fff300 40%, #f79218 70%, #ef1c29)" });
  // The colour icon of each row: what the layer looks like on the map.
  const SW_ICON = {
    hut: `background:${HUT.color};border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1px #0004`,
    park: `background:${PARK.color};border-radius:6px;color:#fff;font-weight:800;font-size:13px;display:grid;place-items:center`,
    club: `background:${CLUB.color};border-radius:50%`,
    snow: `background:${SNOW.color}`,
    slope: "background:linear-gradient(135deg, #f2e14c, #f59f00 35%, #e8392f 60%, #9c36b5 80%, #1c3faa)",
    aspect: "background:conic-gradient(#1c7ed6, #0ca678, #74b816, #fab005, #f76707, #e03131, #ae3ec9, #5c5fd6, #1c7ed6)",
    runout: "background:repeating-linear-gradient(135deg, #8c28a0 0 3px, #d6336c99 3px 7px)",
    flats: "background:#38d9a9",
    elev: "background:linear-gradient(180deg, #9775fa, #ffd43b 50%, #51cf66)",
    fresh: "background:linear-gradient(135deg, #d0ebff, #748ffc 50%, #e64980)",
    snowfc: "background:linear-gradient(135deg, #d0ebff, #748ffc 50%, #e64980)",
    heat: `background:linear-gradient(135deg, ${HEAT.ramp.join(", ")})`,
    mine: `border:3px solid ${MINE.color}`,
  };
  const SW_SYM = { club: "❄", snow: "❄", park: "P", fresh: "❄", snowfc: "🌨" };
  const swIcon = (k) => {
    const t = TYPES[k];
    const st = t ? `border:3px ${t.dashArray ? "dashed" : "solid"} ${t.color}` : SW_ICON[k] || "";
    return `<span class="sk-lic" style="${st}" aria-hidden="true">${SW_SYM[k] || ""}</span>`;
  };
  const SW_TITLE = {
    access: "Trails that lead to the skiing, like the Elfin Lakes Trail",
    park: "Where to leave the car for a ski tour. Village and ski resort lots aren't shown",
    heat: "Public OpenStreetMap GPS traces from December to April, roads and lifts left out",
    mine: "Your tours from My rides (import or record them there)",
    slope: "Colours the slopes by steepness: 27° and up, where avalanches start",
    snow: "Snow stations (BC snow pillows, Quebec's climate network, Environment Canada elsewhere): snow depth, new snow and temperature, every 2 hours",
    aspect: "Colours the slopes of 25° and more by the way they face, to match the forecast's problem aspects",
    runout: "Where avalanches from steep slopes above can reach, and the gullies and creek beds where snow piles up deep",
    flats: "Nearly flat ground (under 5°): where you'll have to skate, pole or skin out, and where a splitboard has to switch to walk mode",
    elev: "The three heights of the avalanche forecast: below treeline, treeline and alpine, at the heights used for that area",
    fresh: "Snow that fell in the last 24 hours, in centimetres; where it rained instead, the rain in millimetres in greens (Open-Meteo weather model)",
    snowfc: "Snow coming in the next 3 days, in centimetres; where rain comes instead, the rain in millimetres in greens (Open-Meteo weather model)",
  };
  const thumbs = {};   // picture tiles' pictures (makeThumbs)
  function renderSwitches() {
    const al = avyBtn && thumbs.avy && avyBtn.querySelector(".sk-lic");
    if (al) { al.style.background = `url(${thumbs.avy}) center / cover`; al.textContent = ""; }
    $("skViews").innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button type="button" class="sk-view" data-view="${k}" aria-pressed="${v.layers.some((x) => shown.has(x))}"><span class="ic" aria-hidden="true">${v.icon}</span>${esc(v.label)}<small>${esc(v.sub)}</small></button>`).join("");
    const row = (k) => {
      const on = shown.has(k), extra = k === "heat" && !heat ? (heatErr ? "Not ready yet" : "") : k === "snow" && snowErr ? "Not ready yet" : k === "mine" && !mine.length ? "None yet: record or import them in My rides" : "";
      return `<label class="sk-layer"${SW_TITLE[k] ? ` title="${esc(SW_TITLE[k])}"` : ""}>${swIcon(k)}<span><b>${esc(LABEL(k))}</b>${extra ? `<small>${esc(extra)}</small>` : ""}</span><input type="checkbox" class="sk-sw" role="switch" data-k="${k}"${on ? " checked" : ""} aria-label="${esc(LABEL(k))}"></label>`;
    };
    // A picture tile: a small painted piece of real mountain showing the layer (thumbs, painted once the menu opens).
    const tile = (k) => {
      const on = shown.has(k), bg = thumbs[k] ? `background:url(${thumbs[k]}) center / cover` : (SW_ICON[k] || "");
      return `<label class="sk-tile"${SW_TITLE[k] ? ` title="${esc(SW_TITLE[k])}"` : ""}><span class="sk-thumb" style="${bg}" aria-hidden="true"></span><span class="sk-tcap">${esc(LABEL(k))}</span><input type="checkbox" class="sk-sw" role="switch" data-k="${k}"${on ? " checked" : ""} aria-label="${esc(LABEL(k))}"></label>`;
    };
    lm.querySelectorAll(".sk-rows").forEach((el) => { const g = GROUPS[el.dataset.g]; el.innerHTML = g.keys.map(g.tiles ? tile : row).join(""); });
    renderPalRow();
  }
  function applySwitches() {
    store.set("skiLayers2", [...shown]);
    if (shown.has("snow")) loadSnow();
    renderSwitches(); drawSki(); renderList(); refreshHeat(); refreshSlope(); refreshTerrainLayers(); refreshMoreLayers(); drawMine(); drawClubs(); drawSnow(); renderClubs(); renderForecast(); renderSkiKey();
  }
  // The map key in Skiing: what each line, dot and pin on the map is, for the layers that are on (alex 2026-10-24:
  // "What are those?" about the brown hut dots). Folded by default, like the MTB trail colours key.
  const skiKey = L.control({ position: "bottomleft" });   // "Key", bottom left, like every sport
  skiKey.onAdd = () => {
    const el = L.DomUtil.create("details", "legend sk-key");
    el.innerHTML = `<summary><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3 2 8l10 5 10-5z M2 13l10 5 10-5 M2 17.5l10 5 10-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>Key</summary><ul id="skKeyList"></ul><p class="lg-note">Tap any line, dot or pin on the map to see what it is.</p>`;
    L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el);
    return el;
  };
  skiKey.addTo(map);
  function renderSkiKey() {
    const ul = $("skKeyList");
    if (!ul) return;
    const line = (t) => `<li><span class="sk-kic"><i style="background:${t.dashArray ? `repeating-linear-gradient(90deg, ${t.color} 0 6px, transparent 6px 10px)` : t.color}"></i></span>${esc(t.label)}</li>`;
    const pin = (c, ic, label) => `<li><span class="sk-kic"><span class="sk-pin" style="background:${c}">${ic}</span></span>${esc(label)}</li>`;
    ul.innerHTML = Object.keys(TYPES).filter((k) => shown.has(k)).map((k) => line(TYPES[k])).join("")
      + (shown.has("hut") ? `<li><span class="sk-kic"><span class="sk-kdot" style="background:${HUT.color}"></span></span>Huts, cabins and shelters (brown dots; brown house pins when zoomed in, “Book” when they must be booked ahead)</li>` : "")
      + (shown.has("park") ? `<li><span class="sk-kic"><span class="sk-pin park" style="background:${PARK.color}">P</span></span>Trailhead parking</li>` : "")
      + (shown.has("tour") ? pin(START.color, "⛷", "Start of a camptocamp ski route") : "")
      + (shown.has("club") ? pin(CLUB.color, "❄", CLUB.label) : "")
      + (shown.has("snow") ? `<li><span class="sk-kic"><span class="sk-snow">❄</span></span>${esc(SNOW.label)}: snow depth</li>` : "")
      + (shown.has("mine") ? line(MINE) : "")
      + (pinLayer.getLayers().length ? `<li><span class="sk-kic"><span class="sk-kdot" style="background:#2f9e44"></span><span class="sk-kdot" style="background:#e03131;margin-left:3px"></span></span>Start and top of the tour you opened</li>` : "")
      + (window.tfSkiKeyExtra || []).map((f) => { try { return f() || ""; } catch { return ""; } }).join("")   // other files' layers (lifts.js)
      || `<li>No ski layers on. Turn some on with the buttons in the panel.</li>`;
  }
  renderSkiKey();
  window.tfSkiKeyRender = renderSkiKey;
  $("skViews").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]"); if (!b) return;
    const view = VIEWS[b.dataset.view], v = view.layers, on = v.some((k) => shown.has(k));
    v.forEach((k) => (on ? shown.delete(k) : (view.quiet || []).includes(k) || shown.add(k)));
    if (!on && b.dataset.view === "sled") loadClubs();
    applySwitches();
  });
  lm.addEventListener("change", (e) => {
    const b = e.target.closest("[data-k]"); if (!b) return;
    const k = b.dataset.k;
    if (b.checked) shown.add(k); else shown.delete(k);
    const off = b.checked ? oneGround(k) : [];
    if (k === "club" && b.checked) loadClubs();
    applySwitches();
    if (off.includes("avy")) refreshAvy();
  });
  // The list under the map: Routes or Huts, nearest the middle of the map first, each with how far it is, how long it
  // is and how hard (alex 2026-10-24: "make it user friendly, nice to use"). Typing a name searches everything shown,
  // not only the view.
  let listTab = store.get("skiTab", "routes") === "huts" ? "huts" : "routes", findText = "";
  const DIFF_PILL = { novice: ["●", "Beginner", "#2f9e44"], easy: ["●", "Easy", "#2f9e44"], intermediate: ["■", "Intermediate", "#1971c2"],
    advanced: ["◆", "Advanced", "var(--fg)"], expert: ["◆◆", "Expert", "var(--fg)"], extreme: ["◆◆", "Extreme", "#c92a2a"], freeride: ["◆", "Freeride", "#d9480f"] };
  const diffPill = (d) => { const x = DIFF_PILL[d]; return x ? `<span class="sk-diff" style="--c:${x[2]}"><i aria-hidden="true">${x[0]}</i>${x[1]}</span>` : ""; };
  const fmtAway = (m) => (m < 950 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : m < 9500 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`);
  // Metres from a point to the closest point of a route (every few points of a long line: plenty for a list).
  function awayM(lat, lon, rs) {
    const kx = Math.cos((lat * Math.PI) / 180) * 111320;
    let best = Infinity;
    for (const r of rs) for (const line of r.lines) {
      const step = Math.max(1, line.length >> 5);
      for (let i = 0; i < line.length; i += step) { const dx = (line[i][1] - lon) * kx, dy = (line[i][0] - lat) * 110540, d = dx * dx + dy * dy; if (d < best) best = d; }
    }
    return Math.sqrt(best);
  }
  const ptAway = (lat, lon, h) => Math.hypot((h.lon - lon) * Math.cos((lat * Math.PI) / 180) * 111320, (h.lat - lat) * 110540);
  // camptocamp names are "Summit : way up": the summit is the title, the way up goes under it.
  const c2cName = (n) => { const i = (n || "").indexOf(" : "); return i > 0 ? [n.slice(0, i), n.slice(i + 3)] : [n || "camptocamp route", ""]; };
  const KIND = { alpine_hut: "Alpine hut", wilderness_hut: "Backcountry cabin", shelter: "Shelter", basic_hut: "Hut", cabin: "Cabin", parking: "Trailhead parking", trailhead: "Trailhead" };
  // One plain line at the top of a hut's details: what the brown dot on the map is.
  const HUT_ABOUT = {
    alpine_hut: "A staffed or bookable mountain hut, for staying overnight on a ski tour.",
    wilderness_hut: "A backcountry cabin you ski or hike to: an unstaffed place to warm up or spend the night.",
    shelter: "A small shelter from the weather, usually not for sleeping in.",
    basic_hut: "A simple backcountry hut you ski or hike to.",
    cabin: "A cabin in the backcountry. It may be private: check before using it.",
    parking: "Where to leave the car to start a ski tour. Winter plowing isn't guaranteed: check the road before you drive up.",
    trailhead: "Where a ski tour or approach trail starts. Check the road and parking before you drive up.",
  };
  // ---------- the trip planner light ----------
  // Avalanche Canada's Avaluator chart (ski-terrain.js): the day's danger rating in the bands a route goes through,
  // with its terrain class, gives Normal caution, Extra caution or Not recommended (alex 2026-10-24: "be a reference
  // on avalanche forecast and management").
  // A list entry's terrain (pieces with the same name): the hardest class of its pieces, its lowest and highest points.
  function groupTerrain(g) {
    let c = 0, lo = Infinity, hi = -Infinity, top = null, k30 = 0, k35 = 0, ab = 0, tr = 0;
    for (const r of g) {
      const t = terrain && terrain[r.id];
      if (!t) continue;
      c = Math.max(c, t.c); lo = Math.min(lo, t.lo); k30 += t.k30 || 0; k35 += t.k35 || 0; ab += t.ab || 0; tr += t.tr || 0;
      if (t.hi > hi) { hi = t.hi; top = t.top; }
    }
    if (!c) return null;
    // Pieces of one route add up: four short stretches under steep slopes are one long one.
    const sum = { km30: k30, km35: k35, above: ab, traps: tr };
    // An official ATES rating (r.ates = { cls, src, url }, from a park's own ratings) wins over the estimate.
    const off = g.find((r) => r.ates && r.ates.cls >= 1 && r.ates.cls <= 3);
    return { c: off ? off.ates.cls : Math.max(c, T.terrainClass(sum).c), official: off ? off.ates : null, lo, hi, top, ...sum };
  }
  // The forecast for a spot on a day: { r: the highest rating from lo to hi m (0 = none), band, area, d: the day },
  // or null when there's no forecast there (or it has expired).
  function dangerAt(lat, lon, lo, hi, dayIdx = day) {
    const a = avy || example ? areaAt(lat, lon) : null, f = a && a.forecast;
    if (!f || !f.days || !f.days.length) return null;
    if (!example && f.validUntil && new Date(f.validUntil) < new Date()) return null;
    const d = f.days[Math.min(dayIdx, f.days.length - 1)];
    return { ...T.dangerIn(d, a.bands, lo, hi), area: a, d };
  }
  function riskOf(g) {
    const t = groupTerrain(g);
    if (!t) return null;
    const dg = t.top ? dangerAt(t.top[0], t.top[1], t.lo, t.hi) : null;
    return { ...t, dg, l: dg && dg.r ? T.light(dg.r, t.c) : -1 };
  }
  const lightPill = (l) => { const x = T.LIGHTS[l]; return `<span class="sk-light" style="--c:${x.color}"><i aria-hidden="true"></i>${x.label}</span>`; };
  const classPill = (c, title) => { const x = T.CLASSES[c]; return `<span class="sk-ates" style="--c:${x.color}" title="${esc(title || "Avalanche terrain, estimated")}">${x.label}</span>`; };
  const riskPill = (k) => (!k ? "" : k.l >= 0 ? lightPill(k.l) : classPill(k.c));
  // Lowest risk first: by the light when there's a rating, else by the terrain class; routes not rated yet last.
  let sortSafe = store.get("skiSort", "near") === "safe";
  const riskRank = (x) => (!x.k ? 5 : x.k.l >= 0 ? x.k.l : x.k.c - 1);
  $("skSort").addEventListener("click", () => { sortSafe = !sortSafe; store.set("skiSort", sortSafe ? "safe" : "near"); renderList(); });
  function renderList() {
    const list = $("skList");
    if (!ski) { $("skCount").textContent = ""; list.innerHTML = `<li class="sk-empty">${skiErr ? "The ski route list isn't on the site yet (it's collected every night). Try again later." : "Loading ski routes…"}</li>`; return; }
    const b = map.getBounds(), c = map.getCenter(), q = findText.trim().toLowerCase();
    const has = (n) => (n || "").toLowerCase().includes(q);
    const inView = (r) => b.intersects(r.bounds);
    // Pieces with the same name and type are one entry.
    const groups = new Map();
    for (const r of ski.routes || []) {
      if (!shown.has(r.type) || (q ? !has(nameOf(r)) && !has(r.tags && r.tags["hand:aka"]) : !inView(r))) continue;
      const key = r.name ? r.type + "|" + r.name.toLowerCase() : r.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const starts = (shown.has("tour") ? ski.starts || [] : []).filter((h) => (q ? has(h.name) : b.contains([h.lat, h.lon])));
    // Huts are few and far apart: count the ones around the view too, so a tight view of a village doesn't say "Huts 0"
    // (app review 2026-11-02, Whistler).
    const hb = b.pad(1);
    const huts = (shown.has("hut") ? ski.huts || [] : []).filter((h) => (q ? has(h.name) : hb.contains([h.lat, h.lon])));
    // In Touring, plain winter routes (valley walking and nordic loops at Lost Lake...) go after the ski tours: the list
    // opened with Nature Walking Trail, Tin Pants and Gipsy Drum at Whistler (app review 2026-11-02).
    const plainLast = (x) => (shown.has("tour") && x.g && x.g[0].type === "other" ? 1 : 0);
    // A route with no name and no peak close by goes after the named ones.
    const routes = [...[...groups.values()].map((g) => ({ g, d: awayM(c.lat, c.lng, g), anon: !nameOf(g[0]), k: riskOf(g) })), ...starts.map((h) => ({ h, d: ptAway(c.lat, c.lng, h), anon: false }))]
      .sort((x, y) => x.anon - y.anon || plainLast(x) - plainLast(y) || (sortSafe ? riskRank(x) - riskRank(y) : 0) || x.d - y.d);
    const hutRows = huts.map((h) => ({ h, d: ptAway(c.lat, c.lng, h) })).sort((x, y) => x.d - y.d);
    const tabs = $("skTabs");
    tabs.hidden = !shown.has("hut");
    if (tabs.hidden) listTab = "routes";
    tabs.querySelectorAll("[data-tab]").forEach((t) => {
      const n = t.dataset.tab === "huts" ? hutRows.length : routes.length;
      t.setAttribute("aria-selected", String(t.dataset.tab === listTab));
      t.innerHTML = `${t.dataset.tab === "huts" ? "Huts" : "Routes"} <b>${n}</b>`;
    });
    const rows = listTab === "huts" ? hutRows : routes, MAX = 100;
    const what = listTab === "huts" ? "hut" : "route";
    const rated = listTab === "routes" && routes.some((x) => x.k), safe = sortSafe && rated;
    $("skSort").hidden = !rated;
    $("skSort").textContent = safe ? "Sort: lowest risk ⇅" : "Sort: nearest ⇅";
    $("skSort").title = safe ? "Sort by distance instead" : "Lowest avalanche risk first: the trip planner light, or the terrain class when there's no rating";
    $("skCount").textContent = q ? `${rows.length} ${what}${rows.length === 1 ? "" : "s"} named “${findText.trim()}”, ${safe ? "lowest risk" : "nearest"} first`
      : rows.length ? (safe ? "Lowest avalanche risk first, then nearest. Tap one for its details." : "Nearest the middle of the map first. Tap one for its details.") : "";
    // The kind of route only when it isn't the list's usual kind (in Touring nearly all are ski touring).
    const kinds = new Map();
    for (const x of rows) if (x.g) kinds.set(x.g[0].type, (kinds.get(x.g[0].type) || 0) + 1);
    const usual = [...kinds].sort((a, b2) => b2[1] - a[1])[0]?.[0];
    const away = (d) => `<span class="sk-away">${fmtAway(d)}<small>away</small></span>`;
    list.innerHTML = rows.slice(0, MAX).map((x, i) => {
      const cur = x.g ? x.g.includes(selected) : selected === x.h;
      let ic, nm, sub;
      if (x.g) {
        const r = x.g[0], t = TYPES[r.type] || TYPES.other, len = x.g.reduce((s2, y) => s2 + km(y), 0);
        ic = `<span class="sk-ic"><span class="sk-sw" style="background:${t.color}"></span></span>`;
        nm = esc(nameOf(r) || "Unnamed " + t.label.toLowerCase());
        sub = [riskPill(x.k), isUphill(r) ? "Uphill (skin track)" : r.type !== usual && esc(SHORT[r.type] || t.label), r.area ? "bowl or area" : len >= 0.05 ? `${len < 10 ? len.toFixed(1) : Math.round(len)} km long` : "", diffPill(r.diff)].filter(Boolean).join(" · ");
      } else if (x.h.src === "c2c") {
        const [top, way] = c2cName(x.h.name), tg = x.h.tags || {};
        ic = `<span class="sk-ic"><span class="sk-pin" style="background:${START.color}">⛷</span></span>`;
        nm = esc(top);
        sub = [tg.climb && "↑ " + esc(tg.climb), tg["ski rating"] && "rated " + esc(tg["ski rating"]), way && esc(way)].filter(Boolean).join(" · ");
      } else {
        const ele = x.h.tags?.ele && parseFloat(x.h.tags.ele);
        ic = `<span class="sk-ic"><span class="sk-dot" style="background:${HUT.color}"></span></span>`;
        nm = esc(x.h.name || "Hut");
        sub = [esc(KIND[x.h.kind] || "Hut"), ele ? Math.round(ele).toLocaleString() + " m high" : "", x.h.tags?.capacity ? `sleeps ${esc(x.h.tags.capacity)}` : "",
          mustBook(x.h) ? "<b>book ahead</b>" : x.h.tags?.reservation === "no" ? "no booking" : ""].filter(Boolean).join(" · ");
      }
      return `<li><button type="button" data-i="${i}"${cur ? ' aria-current="true"' : ""}>${ic}<span class="sk-tx"><span class="nm">${nm}</span><span class="sub">${sub}</span></span>${away(x.d)}</button></li>`;
    }).join("")
      + (rows.length > MAX ? `<li class="sk-empty">${rows.length - MAX} more: ${q ? "type more of the name" : "zoom in"} to see them.</li>` : "")
      + (!rows.length ? `<li class="sk-empty">${q ? `Nothing named “${esc(findText.trim())}” in what's shown.` : listTab === "huts" ? "No huts in view. Zoom out or move the map." : shown.has("heat") ? "No mapped ski routes in view. The heatmap shows where people have toured here." : `<span>No mapped ski routes in view. Zoom out, or turn on the ski heatmap: it shows where people tour even where no route is mapped.</span> <button type="button" class="linkish" id="skHeatOn">Show the ski heatmap</button>`}</li>` : "");
    const heatBtn = $("skHeatOn");
    if (heatBtn) heatBtn.addEventListener("click", () => { shown.add("heat"); const off = oneGround("heat"); applySwitches(); if (off.includes("avy")) refreshAvy(); });
    list.querySelectorAll("button[data-i]").forEach((bt) => bt.addEventListener("click", () => { const x = rows[+bt.dataset.i]; select(x.g || x.h, true); }));
  }
  $("skTabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]"); if (!t) return;
    listTab = t.dataset.tab; store.set("skiTab", listTab); renderList();
  });
  $("skFind").addEventListener("input", (e) => { findText = e.target.value; renderList(); renderPlaces(); });
  // One search box at the top of Skiing, like every other sport (alex 2026-11-03: "can we add a search option like
  // every sport"). While typing, what matches shows right under the box: ski resorts, backcountry areas, heli and cat
  // skiing (ski-areas.js, helicat.js), slackcountry and freeride lines, routes and huts, then Canadian towns
  // (place-search.js). Go or Enter asks OpenStreetMap for any other place: a region, range or mountain ("Chic-Chocs",
  // "Rogers Pass") jumps the map there and the list fills with what's near it (alex 2026-10-26: "add search an region").
  let placeQ = "", placeFound = null, placeRows = [];
  let resorts = [], slack = [];
  $("skFind").addEventListener("focus", () => window.tfLoadSport("ski").then(() => {   // ski-areas.js and helicat.js come with Skiing
    if (window.tfSkiAreas && window.tfSkiAreas.load) window.tfSkiAreas.load().then(renderPlaces);
    if (window.tfHeliCat && window.tfHeliCat.load) window.tfHeliCat.load().then(renderPlaces);   // heli and cat skiing (helicat.js)
    // The same files lifts.js and slackcountry.js read (cached).
    fetch("data/ski-lifts.json?v=3890").then((r) => (r.ok ? r.json() : null)).then((d) => {
      // Each resort's lifts give its outline: picking it fits the lifts on the screen (the runs sit around them).
      const bbs = {};
      for (const l of (d && d.lifts) || []) for (const [la, lo] of l.g || []) {
        const b = bbs[l.r] || (bbs[l.r] = [la, la, lo, lo]);
        b[0] = Math.min(b[0], la); b[1] = Math.max(b[1], la); b[2] = Math.min(b[2], lo); b[3] = Math.max(b[3], lo);
      }
      const pad = (b) => b && [b[0] - 0.006, b[1] + 0.006, b[2] - 0.008, b[3] + 0.008];
      resorts = Object.entries((d && d.resorts) || {}).map(([id, r]) => ({ id, name: r.name, lat: r.lat, lon: r.lon, live: r.live, access: r.access, bb: pad(bbs[id]) }));
      renderPlaces();
    }).catch(() => {});
    fetch("data/slackcountry.json").then((r) => (r.ok ? r.json() : null)).then((d) => {
      slack = ((d && d.resorts) || []).flatMap((rs) => (rs.lines || []).map((l) => ({ id: l.id, name: l.name, short: l.short, resort: rs.name, lat: rs.lat, lon: rs.lon })));
      renderPlaces();
    }).catch(() => {});
  }).catch(() => {}), { once: true });
  const plain = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  // 4 the whole name, 3 its start, 2 the start of a word in it, 1 anywhere in it (3 letters or more), under 1 a slip;
  // 0 no match.
  const score = (name, q) => {
    const n = plain(name);
    if (!n || !q) return 0;
    if (n === q) return 4;
    if (n.startsWith(q)) return 3;
    if (n.includes(" " + q)) return 2;
    // Each word typed starts a word of the name: "bromont exp" finds "Bromont, montagne d'expériences".
    const nw = n.split(" "), qw = q.split(" ");
    if (qw.length > 1 && qw.every((w) => nw.some((x) => x.startsWith(w)))) return nw[0].startsWith(qw[0]) ? 3 : 2;
    if (q.length >= 3 && n.includes(q)) return 1;
    // One slip off the start of the name or a word ("revol" -> Revelstoke, "whisler" -> Whistler), after the rest.
    const P = window.tfPlaceSearch, d = P && P.slips && q.length >= 4 ? P.slips(q, n) : -1;
    return d >= 0 ? 0.6 - d / 10 : 0;
  };
  const kmAway = (m) => (m < 950 ? `${Math.max(100, Math.round(m / 100) * 100)} m` : `${m < 9500 ? (m / 1000).toFixed(1) : Math.round(m / 1000)} km`);
  const ROUTE_IC = { tour: "⛷", access: "🥾", nordic: "🎿", snowshoe: "❄", snowmobile: "🛷", resort: "🚡", offpiste: "◆", other: "❄" };
  // Routes (same-name pieces as one), tour starts and huts already loaded around the map, best match then nearest.
  function localHits(q) {
    const c = map.getCenter(), out = [];
    if (ski) {
      const groups = new Map();
      for (const r of ski.routes || []) {
        const n = nameOf(r), s = r.name ? score(n, q) : 0;   // unnamed routes ("Ski touring near ...") don't count
        if (!s) continue;
        const key = r.type + "|" + n.toLowerCase();
        if (!groups.has(key)) groups.set(key, { g: [], s });
        groups.get(key).g.push(r);
      }
      for (const { g, s } of groups.values()) {
        const r = g[0], d = awayM(c.lat, c.lng, g), free = window.tfFreeride && window.tfFreeride.isFree && window.tfFreeride.isFree(r);
        out.push({ name: (free && r.frName) || nameOf(r), sub: `${free ? "Freeride line" : isUphill(r) ? UP_LABEL : (TYPES[r.type] || TYPES.other).label} · ${kmAway(d)}`, ic: free ? "◆" : ROUTE_IC[r.type] || "❄", s, d, route: g });
      }
      for (const h of [...(ski.huts || []), ...(ski.starts || [])]) {
        const s = score(h.name, q);
        if (!s) continue;
        const d = ptAway(c.lat, c.lng, h), hut = (ski.huts || []).includes(h);
        out.push({ name: h.name, sub: `${hut ? "Hut" : (TYPES[h.type] || TYPES.tour).label} · ${kmAway(d)}`, ic: hut ? "🛖" : "⛷", s, d, point: h });
      }
    }
    for (const l of slack) {
      const s = Math.max(score(l.name, q), score(l.short, q));
      if (s) out.push({ name: l.name, sub: `Slackcountry line · ${l.resort}`, ic: "⛷", s, d: ptAway(c.lat, c.lng, l), slack: l });
    }
    for (const r of resorts) {
      const s = score(r.name, q);
      // An access gondola (the Sea to Sky Gondola) isn't a ski resort: picking it opens its box (lifts.js).
      if (s) out.push({ name: r.name, sub: `${r.access ? "Backcountry access gondola" : "Ski resort"}${r.live ? " · live status" : ""} · ${kmAway(ptAway(c.lat, c.lng, r))}`, ic: "🚡", s: s + 0.5, d: ptAway(c.lat, c.lng, r), lat: r.lat, lon: r.lon, bb: r.bb || null, zoom: 15, access: r.access ? r.name : "" });
    }
    return out.sort((x, y) => y.s - x.s || x.d - y.d);
  }
  function renderPlaces() {
    const P = window.tfPlaceSearch, ul = $("skPlaces"), msg = $("skPlaceMsg"), q = findText.trim(), pq = plain(q);
    if (!P || pq.length < 2) { ul.innerHTML = ""; msg.textContent = ""; placeRows = []; return; }
    const areas = [...(window.tfSkiAreas && window.tfSkiAreas.match ? window.tfSkiAreas.match(q) : []),
      ...(window.tfHeliCat && window.tfHeliCat.match ? window.tfHeliCat.match(q) : [])];
    const asked = placeQ === q.toLowerCase();
    const mine = localHits(pq);
    // Resorts first (the place people type most), then the backcountry areas, then the rest, then towns.
    // (an area whose name only has the word in the middle, "Marmot Basin backcountry and Whistlers Creek", after).
    const areaTop = areas.filter((a) => score(a.name, pq) >= 3), areaRest = areas.filter((a) => !areaTop.includes(a));
    const top = [...mine.filter((x) => x.zoom && x.s >= 3).slice(0, 2), ...areaTop.slice(0, asked ? 2 : 3)];
    const rest = [...mine.filter((x) => !top.includes(x)).slice(0, Math.max(2, 6 - top.length)), ...areaRest.slice(0, 2)];
    const towns = P.towns ? P.towns(q, asked ? 0 : 2, () => { if (findText.trim() === q) renderPlaces(); }) : [];
    placeRows = asked ? [...top.slice(0, 3), ...rest.slice(0, 3), ...(placeFound || [])] : [...top, ...rest, ...towns];
    // Mountains, lakes, parks and regions from Photon once the typing pauses (place-search.js live), not already listed.
    if (!asked && P.live) P.addNew(placeRows, P.live(q, () => { if (findText.trim() === q) renderPlaces(); }), placeRows.length + 3);
    logUse("search", "Ski find:" + q, placeRows.length);   // the usage page's "What people search for"
    ul.innerHTML = placeRows.map(P.hitHtml).join("")
      + (asked ? "" : `<li><button type="button" data-more><span class="ps-ic" aria-hidden="true">🔍</span><span class="ps-tx"><span class="ps-more">Search places named “${esc(q)}”</span><small>A region, range, mountain or town: the map goes there</small></span></button></li>`);
    if (!asked) msg.textContent = "";
  }
  async function askPlaces() {
    const P = window.tfPlaceSearch, q = findText.trim();
    if (!P || !q) return;
    const msg = $("skPlaceMsg");
    msg.textContent = `Finding ${q}…`;
    try {
      const found = await P.search(q);
      if (findText.trim() !== q) return;
      placeQ = q.toLowerCase(); placeFound = found;
      // No place by that name and several words: it's a question, so Ask answers it (alex 2026-11-06: "Simple ski tour
      // in the duffeys" said "No place named …": "Not clear where to ask").
      if (!found.length && window.tfAsk && q.split(/\s+/).length >= 3) { msg.textContent = ""; $("skFind").blur(); window.tfAsk.open(q); return; }
      msg.textContent = found.length ? "Tap a place to go there." : `No place named “${q}”.`;
      $("skFind").blur();   // the phone keyboard out of the way of the list
      renderPlaces();
    } catch { msg.textContent = "Couldn't reach the place search. Check your signal, or move the map yourself."; }
  }
  $("skFindForm").addEventListener("submit", (e) => { e.preventDefault(); askPlaces(); });
  $("skPlaces").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-more")) { askPlaces(); return; }
    const p = placeRows[+b.dataset.i]; if (!p) return;
    logUse("pick", "Ski find");
    findText = ""; $("skFind").value = ""; $("skFind").blur();
    renderPlaces();
    // A route, hut or line: its card, as when it's tapped on the map (its kind of route goes on if it was off).
    const r = p.route ? p.route[0] : p.point;
    if (r) {
      $("skPlaceMsg").textContent = "";
      if (!shown.has(r.type) && TYPES[r.type]) { shown.add(r.type); applySwitches(); }
      select(p.route || p.point, true);
      const at = p.route ? r.lines[0][Math.floor(r.lines[0].length / 2)] : [r.lat, r.lon];
      cardInView($("skDetail"), at[0], at[1]);
      return;
    }
    if (p.slack) {
      $("skPlaceMsg").textContent = "";
      map.setView([p.slack.lat, p.slack.lon], Math.max(map.getZoom(), 13));
      if (window.tfSlack) window.tfSlack.load().then(() => window.tfSlack.open(p.slack.id)).catch(() => {});
      return;
    }
    $("skPlaceMsg").textContent = `Near ${p.name}: nearest the middle of the map first.`;
    window.tfPlaceSearch.go(p);
    if (p.helicat && window.tfHeliCat) window.tfHeliCat.open(p.helicat);
    if (p.access && window.tfLifts) window.tfLifts.open(p.access);
    renderList();
    // The list of what's near the place under the box (again once the avalanche card above has filled in).
    const top = () => {
      if (!window.tfPanelScrollTo || sport !== "ski") return;
      const el = $("skTabs").hidden ? $("skList") : $("skTabs"), sc = window.tfPanelScroller && window.tfPanelScroller(el);
      window.tfPanelScrollTo(el);
      if (sc) sc.scrollTop = Math.max(0, sc.scrollTop - 16);   // clear of the sheet's handle
    };
    setTimeout(top, 400); setTimeout(top, 1800);
  });
  // ---------- route details: heights, slopes, avalanche forecast and reports, weather ----------
  // A short name for each kind of route, for unnamed routes: "Ski touring near Ipsoot Mountain" (data/ski.json "near"
  // is the named peak closest to the route, found by the nightly job).
  const SHORT = { tour: "Ski touring", access: "Approach trail", nordic: "Nordic trail", snowshoe: "Snowshoe trail", snowmobile: "Snowmobile trail", resort: "Ski run", offpiste: "Resort off-piste", other: "Winter route" };
  const nameOf = (r) => r.name || (r.near ? `${SHORT[r.type] || "Route"} near ${r.near}` : "");
  const fmtM = (m) => Math.round(m).toLocaleString() + " m";
  // Heights, slopes, steep ground above and terrain traps along a route: ski-terrain.js, shared with the nightly job
  // that rates every route (scripts/build-ski-terrain.mjs), so both work a route out the same way.
  const { ABOVE_M } = T;
  const chain = (group) => T.chain(group.flatMap((r) => r.lines));
  const DEFAULT_BANDS = { lo: 1500, hi: 1900 };
  const bandOf = (e, b) => (e >= b.hi ? "alp" : e >= b.lo ? "tln" : "btl");
  // Everything about the route's shape: heights, climb, slopes, which bands and aspects it crosses, what's above it.
  async function routeInfo(group) {
    const r = group[0];
    if (r.info) return r.info;
    const info = await T.info(group.flatMap((x) => x.lines), dem, r.src === "plan");
    if (r.src === "plan" && r.key) {
      planInfo.set(r.key, info);
      if (planInfo.size > 12) planInfo.delete(planInfo.keys().next().value);
    }
    return (r.info = info);
  }
  const bandKm = (info, b) => {
    const out = { alp: 0, tln: 0, btl: 0 };
    info.pts.forEach((p, i) => { if (i) out[bandOf(p.e, b)] += (p.d - info.pts[i - 1].d) / 1000; });
    return out;
  };
  // Height profile: distance across, height up; steep ground (30° and more) in orange, treeline and alpine heights dashed.
  function profileSvg(info, bands) {
    const W = 320, H = 130, L0 = 38, R0 = 6, T0 = 8, B0 = 18, pts = info.pts;
    const lo = Math.floor(info.min / 100) * 100, hi = Math.max(lo + 100, Math.ceil(info.max / 100) * 100);
    const X = (d) => L0 + (d / (info.total || 1)) * (W - L0 - R0), Y = (e) => T0 + (1 - (e - lo) / (hi - lo)) * (H - T0 - B0);
    const line = pts.map((p) => `${X(p.d).toFixed(1)},${Y(p.e).toFixed(1)}`).join(" ");
    let steep = "";
    pts.forEach((p, i) => { if (i && info.sl[i] >= 30) steep += `M${X(pts[i - 1].d).toFixed(1)} ${Y(pts[i - 1].e).toFixed(1)}L${X(p.d).toFixed(1)} ${Y(p.e).toFixed(1)}`; });
    const bandLines = [[bands.lo, "treeline"], [bands.hi, "alpine"]].filter(([e]) => e > lo && e < hi)
      .map(([e, n]) => `<line x1="${L0}" x2="${W - R0}" y1="${Y(e).toFixed(1)}" y2="${Y(e).toFixed(1)}" class="pf-band"/><text x="${W - R0 - 2}" y="${(Y(e) - 3).toFixed(1)}" text-anchor="end" class="pf-lbl">${n} ~${e} m</text>`).join("");
    const kmMax = info.total / 1000, tick = kmMax > 20 ? 5 : kmMax > 8 ? 2 : kmMax > 3 ? 1 : 0.5;
    let ticks = "";
    for (let k = tick; k < kmMax - tick / 3; k += tick) ticks += `<text x="${X(k * 1000).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="pf-lbl">${k} km</text>`;
    return `<svg class="sk-prof" viewBox="0 0 ${W} ${H}" role="img" aria-label="Height profile: from ${fmtM(info.min)} up to ${fmtM(info.max)} over ${kmMax.toFixed(1)} km">
      <polygon points="${L0},${H - B0} ${line} ${W - R0},${H - B0}" class="pf-fill"/>
      ${bandLines}
      <polyline points="${line}" class="pf-line"/>
      <path d="${steep}" class="pf-steep"/>
      <text x="${L0 - 4}" y="${T0 + 4}" text-anchor="end" class="pf-lbl">${hi}</text><text x="${L0 - 4}" y="${H - B0}" text-anchor="end" class="pf-lbl">${lo}</text>
      ${ticks}<line class="pf-cur" x1="0" x2="0" y1="${T0}" y2="${H - B0}" visibility="hidden"/></svg>
      <div class="pf-read" aria-live="polite">Move along the profile to see the spot on the map.</div>`;
  }
  const hoverLayer = L.layerGroup();
  function bindProfile(el, info) {
    const svg = el.querySelector(".sk-prof"), cur = svg && svg.querySelector(".pf-cur"), read = el.querySelector(".pf-read");
    if (!svg) return;
    const W = 320, L0 = 38, R0 = 6;
    const move = (e) => {
      const b = svg.getBoundingClientRect(), x = ((e.clientX - b.left) / b.width) * W;
      const d = Math.max(0, Math.min(1, (x - L0) / (W - L0 - R0))) * info.total;
      let i = 0;
      while (i < info.pts.length - 1 && info.pts[i].d < d) i++;
      const p = info.pts[i];
      cur.setAttribute("x1", x.toFixed(1)); cur.setAttribute("x2", x.toFixed(1)); cur.setAttribute("visibility", "visible");
      read.textContent = `${fmtM(p.e)} · ${(p.d / 1000).toFixed(1)} km · ground ${Math.round(info.sl[i])}° facing ${ASPECTS[p.asp].toUpperCase()}`;
      hoverLayer.clearLayers();
      hoverLayer.addLayer(L.circleMarker([p.lat, p.lon], { radius: 7, color: "#fff", weight: 3, fillColor: "#e8590c", fillOpacity: 1, interactive: false }));
      if (!map.hasLayer(hoverLayer)) hoverLayer.addTo(map);
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerdown", move);
    svg.addEventListener("pointerleave", () => { cur.setAttribute("visibility", "hidden"); read.textContent = "Move along the profile to see the spot on the map."; hoverLayer.clearLayers(); });
  }
  function elevHtml(info, bands, area, onCard) {
    const bk = bandKm(info, bands), asp = info.faces.map((s) => s.toUpperCase()).join(", ");
    return `<h4>${onCard ? "Slopes" : "Elevation"}</h4>
      ${onCard ? "" : `<div class="sk-stats"><div><b>${fmtM(info.max)}</b><span>top</span></div><div><b>${fmtM(info.min)}</b><span>bottom</span></div>
        <div><b>↑ ${fmtM(info.up)}</b><span>climb</span></div><div><b>↓ ${fmtM(info.down)}</b><span>descent</span></div></div>
      ${profileSvg(info, bands)}`}
      <dl><dt>Ground</dt><dd>steepest about ${Math.round(info.maxSlope)}°${info.km30 >= 0.05 ? `; ${info.km30.toFixed(1)} km on slopes of 30° or more${info.km35 >= 0.05 ? ` (${info.km35.toFixed(1)} km of 35°+)` : ""}` : "; no slopes of 30° or more under the route"}</dd>
      ${asp ? `<dt>Steep parts face</dt><dd>${asp}</dd>` : ""}
      <dt>Bands</dt><dd>${BANDS.filter(([b]) => bk[b] >= 0.05).map(([b, n]) => `${n} ${bk[b].toFixed(1)} km`).join(" · ")}</dd></dl>
      ${info.above == null ? "" : info.above >= 0.05
        ? `<div class="sk-warn"><b>⚠ Steep slopes above:</b> ${info.above.toFixed(1)} km of the route is under ground of 30° or more that could slide onto it (red dashes on the map).</div>`
        : `<p class="sk-note">No steep slopes found above the route (within ${ABOVE_M} m).</p>`}
      ${onCard ? "" : `<p class="sk-note">Orange on the profile is 30° and steeper.</p>`}`;
  }

  // Avalanche Canada forecast for the route, and riders' reports of avalanches near it (data/avalanche-reports.json).
  let minData = null, minLoading = null, minErr = "";
  function loadMin() {
    if (minData || minLoading) return minLoading;
    minLoading = fetch("data/avalanche-reports.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { minData = d; }).catch((e) => { minErr = e.message; }).finally(() => { minLoading = null; });
    return minLoading;
  }
  const near = (pts, lat, lon) => { let best = Infinity; for (let i = 0; i < pts.length; i += 4) best = Math.min(best, map.distance([pts[i].lat, pts[i].lon], [lat, lon])); return best / 1000; };
  const MIN_KM = 15;
  function minHtml(pts) {
    if (!minData) return minErr ? `<p class="sk-note">Riders' avalanche reports aren't on the site yet (they're collected every 2 hours).</p>` : "<p class=\"sk-note\">Loading riders' reports…</p>";
    const days = minData.days || 14;
    const list = (minData.reports || []).map((m) => ({ m, km: near(pts, m.lat, m.lon) })).filter((x) => x.km <= MIN_KM)
      .sort((a, b) => (!!b.m.av?.seen - !!a.m.av?.seen) || (b.m.date > a.m.date ? 1 : -1));
    const seen = list.filter((x) => x.m.av?.seen).length;
    const head = `<h5>Reported by riders within ${MIN_KM} km, last ${days} days</h5>`;
    if (!list.length) return `${head}<p class="sk-note">None near here (few people post, so that doesn't mean no avalanches).</p>`;
    return `${head}<p>${seen ? `<b>${seen} report${seen === 1 ? "" : "s"} of avalanches</b>` : "No avalanches reported"}, ${list.length} report${list.length === 1 ? "" : "s"} in all.</p>
      <ul class="sk-min">${list.slice(0, 8).map(({ m, km }) => {
        const a = m.av || {}, what = [a.what, a.signs && a.signs.length && (a.what ? "also " : "") + a.signs.join(", ")].filter(Boolean).join("; ");
        const extra = [a.trigger && "trigger: " + a.trigger, a.aspect && "aspect " + a.aspect].filter(Boolean).join(", ");
        return `<li class="${a.seen ? "av" : ""}"><b>${esc(when(m.date) || "")}</b>, ${km.toFixed(0)} km away${m.title ? `: ${esc(m.title)}` : ""}${what ? `<br>${esc(what)}${extra ? ` (${esc(extra)})` : ""}` : ""}${m.text ? `<br><span class="sk-note">${esc(m.text.slice(0, 220))}${m.text.length > 220 ? "…" : ""}</span>` : ""}
          ${m.id ? `<br><a href="https://avalanche.ca/mountain-information-network/submissions/${encodeURIComponent(m.id)}" target="_blank" rel="noopener">Full report</a>` : ""}</li>`;
      }).join("")}</ul>${list.length > 8 ? `<p class="sk-note">…and ${list.length - 8} more on <a href="https://avalanche.ca/map" target="_blank" rel="noopener">avalanche.ca</a>.</p>` : ""}`;
  }
  function avyHtml(area, info, pt) {
    const data = example ? exampleData() : avy;
    const at = pt || (info && info.pts && info.pts[0] ? [info.pts[0].lat, info.pts[0].lon] : null), site = at ? avySite(at[0], at[1]) : AVY_SITE.ca;
    const link = siteLink(site);
    if (!data) return `<h4>Avalanche</h4><p class="sk-note">${avyErr ? `The avalanche forecast isn't on the site yet. ${link}` : "Loading the avalanche forecast…"}</p>`;
    const f = area && area.forecast, d = f && dayOf(f);
    const rated = f && f.days?.some((x) => x.alp || x.tln || x.btl);
    let html = `<h4>Avalanche${f ? `: ${esc(f.title || area.name)}` : ""}</h4>`;
    if (example) html += `<div class="av-warn">EXAMPLE, not a real forecast.</div>`;
    if (!f || !d) html += `<p>No avalanche forecast here right now. ${site.season} ${link}</p>`;
    else {
      const expired = !example && f.validUntil && new Date(f.validUntil) < new Date();
      const on = info ? bandKm(info, area.bands) : null;
      // Today in words, later days as the number only, so three days fit across a phone.
      const chip = (r, short) => `<span class="av-chip" title="${DANGER[r].label}" style="background:${DANGER[r].color};color:${r >= 4 ? "#fff" : "#1a1a1a"}">${short ? r || "–" : DANGER[r].label}</span>`;
      if (expired) html += `<div class="av-warn">This forecast has expired. Check ${site.host} for the latest.</div>`;
      if (rated) {
        html += `<table class="sk-avt"><tr><th></th>${f.days.map((x) => `<th>${esc((x.label || x.date || "").slice(0, 3))}</th>`).join("")}</tr>
          ${BANDS.map(([b, n]) => `<tr class="${on && on[b] < 0.05 ? "off" : ""}"><th>${n}${on ? `<span class="sk-note">${on[b] >= 0.05 ? `${on[b].toFixed(1)} km of the route` : "not on the route"}</span>` : ""}</th>${f.days.map((x, j) => `<td>${chip(x[b], j > 0)}</td>`).join("")}</tr>`).join("")}</table>`;
      } else html += `<p>No danger ratings yet${f.highlights ? ":" : "."}</p>`;
      if (f.highlights) html += `<p><strong>${esc(f.highlights)}</strong></p>`;
      // Each problem, and whether it's where this route goes.
      const bandsOn = on ? BANDS.filter(([b]) => on[b] >= 0.05).map(([b]) => b) : null;
      html += (f.problems || []).map((p) => {
        const bHit = bandsOn ? p.elevations.filter((b) => bandsOn.includes(b)) : p.elevations;
        const aHit = info && info.faces.length ? p.aspects.filter((a) => info.faces.includes(a)) : [];
        const names = (bs) => bs.map((b) => BANDS.find((x) => x[0] === b)[1].toLowerCase()).join(", ");
        const where = !bandsOn ? `${esc(p.aspects.map((s) => s.toUpperCase()).join(" "))} · ${names(p.elevations)}`
          : !bHit.length ? `not in the bands this route goes through (${names(p.elevations)})`
          : `on this route: ${names(bHit)}${aHit.length ? `, on its ${aHit.map((s) => s.toUpperCase()).join(", ")} slopes` : info.faces.length ? `, but its steep slopes face other ways (problem on ${p.aspects.map((s) => s.toUpperCase()).join(" ")})` : ""}`;
        return `<div class="av-prob${bandsOn && !bHit.length ? " off" : ""}">${rose(p)}<div><b>${esc(p.type)}</b><p>${where}</p><p>${p.likelihood ? "Likelihood: " + esc(likely(p.likelihood)) : ""}${p.size ? ` · size ${esc(p.size)}` : ""}</p></div></div>`;
      }).join("");
      const sum = f.summaries?.["avalanche-summary"] || f.summaries?.["avalanche summary"];
      if (sum) html += `<h5>Recent avalanches (forecaster)</h5><p class="sk-pre">${esc(sum.slice(0, 900))}${sum.length > 900 ? "…" : ""}</p>`;
      html += `${janNote(f)}<p><a href="${esc(f.url || site.url)}" target="_blank" rel="noopener">Full ${/^jan-/.test(f.id || "") ? "bulletin" : "forecast"} on ${site.host}</a></p>`;
    }
    html += minHtml(info ? info.pts : [{ lat: pt[0], lon: pt[1] }]);
    return html;
  }

  // Mountain weather at the top of the route, from Open-Meteo (free, no key), adjusted to the top's height.
  const WX = "https://api.open-meteo.com/v1/forecast";
  const WICON = { 0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️", 45: "🌫️", 48: "🌫️", 51: "🌦️", 53: "🌦️", 55: "🌧️", 56: "🌧️", 57: "🌧️", 61: "🌦️", 63: "🌧️", 65: "🌧️",
    66: "🌧️", 67: "🌧️", 71: "🌨️", 73: "🌨️", 75: "❄️", 77: "🌨️", 80: "🌦️", 81: "🌧️", 82: "🌧️", 85: "🌨️", 86: "❄️", 95: "⛈️", 96: "⛈️", 99: "⛈️" };
  const wxCache = new Map();
  function weather(lat, lon, ele) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)},${Math.round(ele / 50) * 50}`, c = wxCache.get(key);
    if (c && Date.now() - c.at < 30 * 60000) return c.p;
    const p = fetch(`${WX}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}${ele != null ? `&elevation=${Math.round(ele)}` : ""}&timezone=auto&past_days=7&forecast_days=8`
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,snowfall_sum,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant"
      + "&hourly=freezing_level_height,temperature_2m,precipitation,snowfall,wind_speed_10m,wind_direction_10m&current=temperature_2m,weather_code")
      .then((r) => { if (!r.ok) throw new Error(r.status === 429 ? "too many requests today, try later" : `HTTP ${r.status}`); return r.json(); });
    p.catch(() => wxCache.delete(key));
    wxCache.set(key, { at: Date.now(), p });
    return p;
  }
  const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  // Avalanche weather: the weather signs the avalanche courses teach (and Avalanche Canada's forecasts watch): lots of
  // new snow, wind moving snow onto the slopes facing away from it, rain on snow and warming. From the same
  // Open-Meteo forecast, at the height asked for (the route's top, or the alpine for the Avalanche card).
  function avyWeather(w, ele) {
    const h = w.hourly;
    if (!h || !h.snowfall || !w.current) return null;
    let i0 = h.time.findIndex((t) => t > w.current.time) - 1;
    if (i0 < 0) i0 = h.time.length - 1;
    const sum = (arr, a, b) => { let t = 0; for (let i = Math.max(0, a); i <= Math.min(arr.length - 1, b); i++) t += arr[i] || 0; return t; };
    const snow24 = sum(h.snowfall, i0 - 23, i0), snow72 = sum(h.snowfall, i0 - 71, i0), next24 = sum(h.snowfall, i0 + 1, i0 + 24);
    // Wind strong enough to move snow (25 km/h and more) in the last day and the next 12 hours.
    let wx = 0, wy = 0, windy = 0, maxW = 0;
    for (let i = Math.max(0, i0 - 23); i <= Math.min(h.time.length - 1, i0 + 12); i++) {
      const v = h.wind_speed_10m[i] || 0;
      maxW = Math.max(maxW, v);
      if (v < 25) continue;
      windy++;
      const a = ((h.wind_direction_10m[i] || 0) * Math.PI) / 180;
      wx += Math.sin(a) * v; wy += Math.cos(a) * v;
    }
    // Rain: precipitation when it's above freezing at this height, last day and next day.
    let rain = 0, warm = -99;
    for (let i = Math.max(0, i0 - 23); i <= Math.min(h.time.length - 1, i0 + 24); i++) {
      if ((h.temperature_2m[i] ?? -99) > 0.5) rain += h.precipitation[i] || 0;
      if (i > i0) warm = Math.max(warm, h.temperature_2m[i] ?? -99);
    }
    const fzNow = h.freezing_level_height[i0], fzMax = Math.max(...h.freezing_level_height.slice(i0, i0 + 25).filter((v) => v != null));
    const signs = [], at = fmtM(ele);
    let lee = null;
    if (snow24 >= 25 || snow72 >= 40) signs.push(["hi", `❄ Heavy new snow: ${Math.round(snow24)} cm in the last day, ${Math.round(snow72)} cm in 3 days. New slabs are touchy until they settle.`]);
    else if (snow24 >= 10 || snow72 >= 20) signs.push(["", `❄ New snow: ${Math.round(snow24)} cm in the last day, ${Math.round(snow72)} cm in 3 days. Watch for new slabs.`]);
    if (next24 >= 15) signs.push([next24 >= 30 ? "hi" : "", `🌨 Storm coming: about ${Math.round(next24)} cm of snow in the next day.`]);
    if (windy >= 3 && (snow72 >= 5 || next24 >= 5)) {
      const from = Math.round((((Math.atan2(wx, wy) * 180) / Math.PI + 360) % 360) / 45) % 8;
      lee = [(from + 3) % 8, (from + 4) % 8, (from + 5) % 8];
      signs.push([maxW >= 50 ? "hi" : "", `💨 Wind loading: ${COMPASS[from]} wind up to ${Math.round(maxW)} km/h with snow to move. Slopes facing ${lee.map((x) => COMPASS[x]).join(", ")} (and below ridges) get wind slabs.`]);
    }
    if (rain >= 2 && fzMax > ele) signs.push(["hi", `🌧 Rain on snow: about ${Math.round(rain)} mm of rain at ${at}. Wet slides, and a crust after.`]);
    if (warm >= 3) signs.push([warm >= 6 ? "hi" : "", `☀ Warming: up to ${Math.round(warm)}°C at ${at} in the next day. Wet avalanches and falling cornices: off sunny and steep slopes early.`]);
    return { signs, fzNow, fzMax, snow24, snow72, next24, lee, maxW, rain, warm };
  }
  function signsHtml(a, ele) {
    if (!a) return "";
    return `<ul class="sk-signs">${a.signs.length ? a.signs.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join("")
      : `<li class="ok">No warning signs in the weather at ${fmtM(ele)} (check the forecast anyway).</li>`}</ul>
      <p class="sk-note">Freezing level now about ${fmtM(a.fzNow)}, up to ${fmtM(a.fzMax)} in the next day.</p>`;
  }
  function wxHtml(w, ele) {
    const dd = w.daily, today = dd.time.indexOf(new Date().toLocaleDateString("en-CA", { timeZone: w.timezone }));
    const t0 = today >= 0 ? today : 7;
    const past = dd.snowfall_sum.slice(Math.max(0, t0 - 3), t0).reduce((s, x) => s + (x || 0), 0);
    const fz = (date) => { const v = w.hourly.time.map((t, i) => (t.startsWith(date) ? w.hourly.freezing_level_height[i] : null)).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    const rows = dd.time.slice(t0, t0 + 4).map((date, j) => {
      const i = t0 + j, dayName = j === 0 ? "Today" : new Date(date + "T12:00").toLocaleDateString(undefined, { weekday: "short" }), f = fz(date);
      return `<tr><th>${dayName}</th><td>${WICON[dd.weather_code[i]] || ""}</td><td>${Math.round(dd.temperature_2m_min[i])}° / ${Math.round(dd.temperature_2m_max[i])}°</td>
        <td>${dd.snowfall_sum[i] >= 0.5 ? `<b>${Math.round(dd.snowfall_sum[i])} cm</b>` : dd.precipitation_sum[i] >= 1 ? `${Math.round(dd.precipitation_sum[i])} mm rain` : "–"}</td>
        <td>${Math.round(dd.wind_speed_10m_max[i])}<span class="sk-note">/${Math.round(dd.wind_gusts_10m_max[i])}</span> ${COMPASS[Math.round(dd.wind_direction_10m_dominant[i] / 45) % 8]}</td>
        <td>${f != null ? fmtM(f) : "–"}</td></tr>`;
    }).join("");
    const aw = ele != null ? avyWeather(w, ele) : null;
    return `<h4>Weather at ${ele != null ? `the top (${fmtM(ele)})` : "this spot"}</h4>
      ${aw ? `<h5>Avalanche weather</h5>${signsHtml(aw, ele)}` : `<p>New snow in the last 3 days: <b>${Math.round(past)} cm</b></p>`}
      <table class="sk-wx"><tr><th></th><th></th><th>Low / high</th><th>Snow</th><th>Wind km/h</th><th>Freezing level</th></tr>${rows}</table>
      <p class="sk-note">Model forecast from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>. Wind: strongest / gusts.</p>`;
  }

  // Whistler Blackcomb's uphill and backcountry access routes (data/ski-hand/ "wb": the name on their map): today's state
  // from the operator's own terrain status map (an ArcGIS layer, open to any site), read when a card opens, kept 5 min.
  const WB_ST = { 1: { k: "open", label: "Open" }, 2: { k: "experts", label: "Experts only" }, 3: { k: "closed", label: "Closed" } };
  let wbSt = null;
  function wbStatus(name) {
    if (!wbSt || Date.now() - wbSt.at > 300000) {
      const q = "where=1%3D1&outFields=Name,status,Status&returnGeometry=false&f=json";
      const B = "https://services3.arcgis.com/XthfLqjm6BwtGUpE/arcgis/rest/services/";
      wbSt = { at: Date.now(), p: Promise.all(["Backcountry_Access", "Early_Season_Uphill_Access"].map((s) => fetch(`${B}${s}/FeatureServer/0/query?${q}`).then((r) => r.json())))
        .then((js) => { const m = new Map(); for (const j of js) for (const f of j.features || []) { const a = f.attributes || {}; m.set(String(a.Name || "").trim(), a); } return m; })
        .catch(() => { wbSt = null; return null; }) };
    }
    return wbSt.p.then((m) => {
      const a = m && m.get(name); if (!a) return null;
      return WB_ST[a.status || a.Status] || null;
    });
  }
  // OpenStreetMap tags in plain words; the rest are left out (alex: "take out everything unnecessary").
  const GROOM = { backcountry: "Not groomed (backcountry)", no: "Not groomed", classic: "Groomed for classic", skating: "Groomed for skate", "classic+skating": "Groomed for classic and skate", "classic;skating": "Groomed for classic and skate", scooter: "Packed by snowmobile", mogul: "Moguls" };
  const DIFF = { novice: "Novice", easy: "Easy", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert", freeride: "Freeride (off-piste)", extreme: "Extreme" };
  const ON = { track: "a forest road or track", path: "a trail", footway: "a footpath", service: "a road", unclassified: "a road", bridleway: "a trail" };
  const yesNo = (v) => ({ yes: "allowed", designated: "allowed (signed for it)", permissive: "allowed", no: "not allowed", private: "private" }[v] || v);
  const PLAIN = {
    "piste:grooming": (v) => ["Grooming", GROOM[v] || v], "piste:difficulty": null, highway: (v) => ON[v] && ["Follows", ON[v]],
    description: (v) => ["Description", v], "winter:access": (v) => ["Winter access", v.replace(/^Winter: /, "")], "winter:closure": (v) => ["⚠️ Closures", v], "winter:closure:website": (v) => ["Closure notices", v], note: (v) => ["Note", v], operator: (v) => ["Run by", v], fee: (v, t) => !t.charge && ["Fee", v === "yes" ? "yes, a fee to use it" : v === "no" ? "free" : v],
    access: (v) => ["Access", yesNo(v)], ski: (v) => ["Skiing", yesNo(v)], snowmobile: (v) => ["Snowmobiles", yesNo(v)], "snowmobile:conditional": (v) => ["Snowmobiles when", v],
    "name:ja": (v) => ["Japanese name", v], "description:en": (v) => ["Description", v],
    seasonal: (v) => ["Seasonal", v], opening_hours: (v) => ["Open", v], ref: (v) => ["Number", v], ele: (v) => ["Height", v + " m"],
    wikimedia_commons: null, image: null, wikidata: null, capacity: null, reservation: null, "reservation:website": null, "booking:note": null, charge: null, website: (v) => ["Website", v], url: (v) => ["Website", v],
    // Hut facts (data/huts.json): booking, price and beds are in the box at the top of the card (bookHtml).
    heating: (v) => ["Heat", { wood: "Wood stove", propane: "Propane heater", gas: "Gas heater", electric: "Electric", no: "None", none: "None" }[v] || v],
    drinking_water: (v, t) => ["Water", [{ yes: "Drinking water", no: "No drinking water" }[v] || v, t["drinking_water:note"]].filter(Boolean).join(": ")],
    "drinking_water:note": null, toilets: (v, t) => ["Toilet", [{ yes: "Yes", no: "None" }[v] || v, t["toilets:note"]].filter(Boolean).join(": ")], "toilets:note": null,
    season: (v) => ["Open", v],
    "piste:type": null, name: null, "piste:name": null,
    // Sépaq and Parks Canada trails (data/ski-canada/)
    park: (v) => ["Park", v], sector: (v) => ["Sector", v], difficulty: (v) => ["Difficulty", FR_DIFF[v] || v], "winter difficulty": (v) => ["Difficulty in winter", v],
    use: (v) => ["For", v.split(", ").map((u) => FR_USE[u] || u).join(", ")],
    // Hokkaido Wilds routes (data/ski-japan-hw/)
    "hw:about": (v) => ["About", v], "hw:difficulty": (v) => ["Difficulty", v], "hw:distance": (v) => ["Distance", v], "hw:time": (v) => ["Time", v],
    "hw:ascent": (v) => ["Climb", v], "hw:high": (v) => ["Highest point", v], "hw:season": (v) => ["Best season", v], "hw:aspect": (v) => ["Main aspect", v],
    "hw:trailhead": (v) => ["Getting there", v], "hw:parking": (v) => ["Parking", v], "hw:safety": (v) => ["Safety", v], "hw:by": null,
    // Hand-kept routes (data/ski-hand/)
    "hand:about": (v) => ["About", v], "hand:climb": (v) => ["Climb", v], "hand:high": (v) => ["Highest point", v], "hand:aspect": (v) => ["Main aspect", v],
    "hand:start": (v) => ["Getting there", v], "hand:safety": (v) => ["Safety", v], "hand:rules": (v) => ["Rules", v], "hand:line": (v) => ["The line", v],
    "hand:groomed": (v) => ["Groomed", v], "hand:classic": (v) => ["Classic", `A ${v} classic`], "hand:aka": (v) => ["Also called", v],
  };
  const FR_DIFF = { Facile: "Easy", "Débutant": "Beginner", "Intermédiaire": "Intermediate", Difficile: "Difficult", "Très difficile": "Very difficult", Polyvalent: "Mixed" };
  const FR_USE = { Raquette: "snowshoeing", "Ski nordique": "backcountry nordic skiing (not groomed)", "Randonnée alpine": "alpine ski touring", "Accès ski hors-piste": "access to off-piste skiing",
    "Pédestre sur neige": "winter walking", VPS: "fat biking", "Ski classique": "classic skiing", "Pas de patin": "skate skiing", "Ski Hok": "Hok skis" };
  const linksHtml = (r) => (r.links || []).map((l) => `<a href="${esc(l.u)}" target="_blank" rel="noopener">${esc(l.t)}</a>`).join(", ");
  const val2 = (v) => (/^https?:\/\//.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>` : esc(v));
  function tagsHtml(r) {
    const plain = [];
    for (const [k, v] of Object.entries(r.tags || {})) {
      const f = PLAIN[k];
      if (f === null) continue;
      const out = f ? f(v, r.tags) : r.src === "c2c" ? [k[0].toUpperCase() + k.slice(1), v] : null;
      if (out) plain.push(out);
    }
    return { plain: plain.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${val2(v)}</dd>`).join("") };
  }
  // The top of a hut's card: must it be booked, the Book button, price and beds (alex 2026-10-30: "If you need to book
  // it tell it and add the link to book").
  const BOOK = { required: "Must be booked ahead", yes: "Booking recommended", recommended: "Booking recommended", members_only: "Club members only", no: "No booking: first come, first served" };
  function bookHtml(h) {
    const t = h.tags || {}, how = BOOK[t.reservation];
    const link = t["reservation:website"] || (t.reservation && t.reservation !== "no" ? t.website : "");
    if (!how && !t.charge && !t.capacity && !link) return "";
    const facts = [t.charge || (t.fee === "no" ? "Free" : ""), t.capacity ? `Sleeps ${t.capacity}` : ""].filter(Boolean);
    const from = h.facts && h.facts.src ? `<a href="${esc(h.facts.src)}" target="_blank" rel="noopener">${esc(h.facts.src.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])}</a>` : "";
    return `<div class="sk-book${t.reservation === "required" || t.reservation === "members_only" ? " must" : ""}">
      ${how ? `<b>${esc(how)}</b>` : ""}${facts.length ? `<span>${facts.map(esc).join(" · ")}</span>` : ""}
      ${t["booking:note"] ? `<span class="sk-note">${esc(t["booking:note"])}</span>` : ""}
      ${link ? `<a class="sk-bookbtn" href="${esc(link)}" target="_blank" rel="noopener">${t.reservation === "no" ? "Hut page ↗" : "Book ↗"}</a>` : ""}
      ${from ? `<span class="sk-note">From ${from}${hutInfo && hutInfo.checked && h.facts.keys ? `, checked ${esc(hutInfo.checked)}` : ""}</span>` : ""}</div>`;
  }
  // Huts and camptocamp routes within 2 km of the route.
  function nearbyHtml(info) {
    if (!ski || !info) return "";
    const pts = info.pts, out = [];
    for (const h of [...(ski.huts || []), ...(ski.parking || []), ...(ski.starts || [])]) {
      const km = near(pts, h.lat, h.lon);
      if (km <= 2) out.push({ h, km });
    }
    if (!out.length) return "";
    out.sort((a, b) => a.km - b.km);
    return `<dt>Nearby</dt><dd>${out.slice(0, 6).map(({ h, km }) => `<a href="#" class="sk-go" data-id="${esc(h.id)}">${esc(h.name || (h.src === "c2c" ? "camptocamp route" : KIND[h.kind] || "Hut"))}</a> <span class="sk-note">${h.src === "c2c" ? "camptocamp route, " : h.kind === "parking" && h.name ? "parking, " : ""}${km < 0.1 ? "on the route" : km.toFixed(1) + " km"}</span>`).join("<br>")}</dd>`;
  }
  // Photos of the route and its top: Wikimedia Commons pictures taken within PH_NEAR m of the line or PH_TOP m of
  // its high point, and the route's own photos on camptocamp.org. Open licences only, each credited.
  const PH_NEAR = 400, PH_TOP = 1500, PH_MAX = 24, PH_FIRST = 9;
  const C2C_MEDIA = "https://media.camptocamp.org/c2corg-active/";
  async function c2cPhotos(id) {
    const r = await fetch(`https://api.camptocamp.org/routes/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return ((j.associations && j.associations.images) || []).filter((im) => im.filename).map((im) => {
      const size = (k) => C2C_MEDIA + im.filename.replace(/\.(\w+)$/, k + ".$1"), loc = (im.locales || [])[0] || {};
      return { src: "camptocamp.org", thumb: size("MI"), big: size("BI"), full: C2C_MEDIA + im.filename, page: `https://www.camptocamp.org/images/${im.document_id}`,
        title: loc.title || "Route photo", about: "", author: "", licence: im.image_type === "personal" ? "CC BY-NC-ND 4.0" : "CC BY-SA 4.0", date: "", dist: 0, own: true };
    });
  }
  const metresTo = (pts, lat, lon) => { let best = Infinity; for (const p of pts) best = Math.min(best, map.distance([p.lat, p.lon], [lat, lon])); return best; };
  async function routePhotos(r, info) {
    if (r.photos) return r.photos;
    const P = window.tfPhotos;
    if (!P) return (r.photos = { list: [], failed: true });
    const pts = info ? info.pts : [{ lat: r.lat, lon: r.lon }], top = info ? info.top : pts[0];
    // Around the top, then a few points along the line.
    const picks = [top];
    if (info) { const step = Math.max(1, Math.floor(pts.length / 6)); for (let i = 0; i < pts.length && picks.length < 8; i += step) picks.push(pts[i]); }
    const jobs = picks.map((p, k) => P.commons({ generator: "geosearch", ggscoord: `${p.lat.toFixed(5)}|${p.lon.toFixed(5)}`, ggsradius: k ? "1000" : String(PH_TOP), ggsnamespace: "6", ggslimit: "50" }).catch(() => null));
    const own = r.src === "c2c" ? c2cPhotos(r.id.slice(3)).catch(() => []) : Promise.resolve([]);
    const [mine, ...lists] = await Promise.all([own, ...jobs]);
    const seen = new Set(), list = [...mine];
    mine.forEach((p) => seen.add(p.full));
    for (const p of lists.filter(Boolean).flat()) {
      if (seen.has(p.full) || !p.at) continue;
      seen.add(p.full);
      const dist = metresTo(pts, p.at[0], p.at[1]), dTop = map.distance([top.lat, top.lon], p.at);
      if (dist <= PH_NEAR || dTop <= PH_TOP) list.push({ ...p, dist, from: "route", top: dTop <= PH_TOP && dist > PH_NEAR });
    }
    list.sort((a, b) => !!b.own - !!a.own || a.dist - b.dist);
    return (r.photos = { list: list.slice(0, PH_MAX), failed: lists.every((l) => l == null) });
  }
  // A photo whose title names the route: every word of 4+ letters in the name (words like "the", "run" and "bowl"
  // alone don't count, so "Glacier Bowl" needs "glacier"), e.g. "Saudan Couloir from the lift" for Saudan Couloir.
  const PH_GENERIC = new Set(["bowl", "bowls", "chute", "chutes", "run", "runs", "face", "ridge", "glades", "trees", "trail", "route", "line", "upper", "lower", "main", "north", "south", "east", "west", "left", "right", "mount", "peak"]);
  const phNorm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, "");
  function namesIt(p, r) {
    const words = phNorm(r.name).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !PH_GENERIC.has(w));
    if (!words.length) return false;
    const t = phNorm(`${p.title || ""} ${p.about || ""}`);
    return words.every((w) => new RegExp(`\\b${w}`).test(t));
  }
  function photosHtml(ph, isHut) {
    const { list, failed } = ph;
    const credit = (p) => [p.author && `© ${p.author}`, p.licence, p.src].filter(Boolean).join(" · ");
    const body = list.length ? `<div class="ab-photos">${list.map((p, i) => `<button type="button" class="ab-ph" data-i="${i}"${i >= PH_FIRST ? " hidden" : ""} title="${esc(p.title + (credit(p) ? " · " + credit(p) : ""))}">
        <img src="${esc(p.thumb)}" alt="${esc(p.title)}" loading="lazy" referrerpolicy="no-referrer"></button>`).join("")}</div>
      ${list.length > PH_FIRST ? `<button class="linkish ab-all" type="button">Show all ${list.length} photos</button>` : ""}
`
      : `<p class="sk-note">${failed ? "Couldn't reach the photo sources right now." : `No open photos found ${isHut ? "here" : "on this route or around its top"} yet.`}</p>`;
    return `<h4>${isHut ? "Photos nearby" : "Photos"}</h4>${body}`;
  }
  function bindPhotos(el, list) {
    const all = el.querySelector(".ab-all");
    if (all) all.addEventListener("click", () => { el.querySelectorAll(".ab-ph[hidden]").forEach((b) => { b.hidden = false; }); all.remove(); });
    el.querySelectorAll(".ab-ph").forEach((b) => b.addEventListener("click", () => window.tfPhotos.open(list, +b.dataset.i)));
    el.querySelectorAll(".ab-ph img").forEach((img) => img.addEventListener("error", () => img.closest(".ab-ph").remove()));
  }
  // Photos of the hut itself (alex 2026-11-03: "find if there is any pictures of the cabin on the internet, if yes add
  // them to the cabin info"). Open licences only, credited: the files listed for the hut in data/huts.json ('photos'),
  // the map's wikimedia_commons / image tag, then a live Wikimedia Commons search by the hut's name (a picture counts
  // only when its title or caption names the hut and it isn't far away), then a picture taken right at the hut.
  // Club sites' own photos are copyrighted: the card links to them instead.
  const HUT_WORD = /\b(hut|huts|cabin|cabins|shelter|lodge|refuge|chalet|cabane|abri|bothy|camp|hostel)\b/;
  const HUT_GEN = /\b(the|and|of|du|de|la|le|les|des|hut|huts|cabin|shelter|lodge|refuge|chalet|cabane|abri|memorial|emergency|backcountry|alpine|mount|mt)\b/g;
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const stem = (w) => w.replace(/s$/, "");
  async function hutPhotos(r) {
    if (r.hutPh) return r.hutPh;
    const P = window.tfPhotos;
    if (!P) return (r.hutPh = []);
    const t = r.tags || {}, files = [...((r.facts && r.facts.photos) || [])];
    const wc = t.wikimedia_commons || "";
    if (/^File:/i.test(wc)) files.push(wc);
    const img = /commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/i.exec(t.image || "");
    if (img) files.push(decodeURIComponent(img[1]).replace(/_/g, " "));
    const there = (p) => (p.at ? map.distance([r.lat, r.lon], p.at) : null);
    const out = [], seen = new Set();
    const add = (list, from) => list.forEach((p) => { if (!seen.has(p.full)) { seen.add(p.full); out.push({ ...p, dist: there(p), from: "hut", own: true, why: from }); } });
    const jobs = [];
    if (files.length) jobs.push(P.commons({ titles: [...new Set(files)].slice(0, 20).join("|") }).then((l) => {
      // Keep the hand-picked order.
      const key = (p) => decodeURIComponent((p.page || "").split("/wiki/")[1] || "").replace(/_/g, " ").toLowerCase();
      const want = files.map((f) => f.toLowerCase()), at = (p) => { const i = want.indexOf(key(p)); return i < 0 ? 99 : i; };
      return l.sort((a, b) => at(a) - at(b));
    }).catch(() => []));
    else jobs.push(Promise.resolve([]));
    if (/^Category:/i.test(wc)) jobs.push(P.commons({ generator: "categorymembers", gcmtitle: wc, gcmtype: "file", gcmlimit: "20" }).catch(() => []));
    else jobs.push(Promise.resolve([]));
    // By name: every word of the name that isn't "hut", "the"... must be in the photo's title or caption.
    const names = [r.name, ...((r.facts && r.facts.aka) || [])].filter(Boolean);
    const cores = names.map((n) => norm(n).replace(HUT_GEN, " ").replace(/\s+/g, " ").trim()).filter((c) => c.length >= 4);
    const core = cores[0];
    jobs.push(core ? P.commons({ generator: "search", gsrsearch: `"${core}" filetype:bitmap`, gsrnamespace: "6", gsrlimit: "30" }).then((l) => l.filter((p) => {
      const text = " " + norm(p.title + " " + p.about) + " ", words = text.split(" ").map(stem);
      const d = there(p);
      if (d != null && d > 8000) return false;                                     // another place with the same name
      if (names.some((n) => text.includes(" " + norm(n) + " "))) return true;      // the full name: "Wedgemount Hut"
      const all = cores.some((c) => c.split(" ").every((w) => words.includes(stem(w))));
      return all && HUT_WORD.test(text) && d != null && d < 3000;                  // "Elfin lakes shelter", close by
    })).catch(() => []) : Promise.resolve([]));
    // Taken right at the hut (within 60 m): most likely the hut or the view from its door.
    jobs.push(P.commons({ generator: "geosearch", ggscoord: `${r.lat.toFixed(5)}|${r.lon.toFixed(5)}`, ggsradius: "60", ggsnamespace: "6", ggslimit: "10" }).catch(() => []));
    const [mine, cat, named, at] = await Promise.all(jobs);
    add(mine, "list"); add(cat, "list"); add(named, "name"); add(at.filter((p) => p.at), "at");
    return (r.hutPh = out.slice(0, 12));
  }
  // The club or park page (its photos are theirs to show), and a web image search, when no open photo is found.
  function hutPhotoLinks(r) {
    const t = r.tags || {}, page = t.website || t.url || (r.facts && r.facts.src) || "";
    const site = page ? page.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : "";
    const q = encodeURIComponent(`"${r.name}" ${HUT_WORD.test(norm(r.name)) ? "" : "hut "}${r.lat > 0 && r.lon < -50 ? "Canada" : ""}`.trim());
    return [page ? `<a href="${esc(page)}" target="_blank" rel="noopener">Photos on ${esc(site)} ↗</a>` : "",
      r.name ? `<a href="https://www.google.com/search?tbm=isch&q=${q}" target="_blank" rel="noopener">Search the web for photos ↗</a>` : ""].filter(Boolean).join(" · ");
  }
  function hutPhHtml(r, list) {
    const p = list[0];
    if (!p) {
      const links = hutPhotoLinks(r);
      return links ? `<p class="sk-note sk-hutph-none">No free-to-use photo of this hut yet. ${links}</p>` : "";
    }
    const credit = [p.author && `© ${p.author}`, p.licence, p.src].filter(Boolean).join(" · ");
    return `<button type="button" class="sk-hutph" data-i="0" aria-label="Open the hut's photos"><img src="${esc(p.big || p.thumb)}" alt="${esc(p.title)}" referrerpolicy="no-referrer">
        ${list.length > 1 ? `<span class="sk-hutph-n">📷 ${list.length}</span>` : ""}</button>
      ${list.length > 1 ? `<div class="sk-hutph-row">${list.slice(1, 6).map((x, i) => `<button type="button" class="sk-hutph-t" data-i="${i + 1}"><img src="${esc(x.thumb)}" alt="${esc(x.title)}" loading="lazy" referrerpolicy="no-referrer"></button>`).join("")}</div>` : ""}
      <p class="sk-note sk-hutph-credit">${p.why === "at" ? "Taken at the hut. " : ""}${esc(credit)}</p>`;
  }
  function bindHutPh(el, list) {
    el.querySelectorAll(".sk-hutph, .sk-hutph-t").forEach((b) => b.addEventListener("click", () => window.tfPhotos.open(list, +b.dataset.i)));
    el.querySelectorAll(".sk-hutph-t img").forEach((img) => img.addEventListener("error", () => img.closest("button").remove()));
    const big = el.querySelector(".sk-hutph img");
    if (big) big.addEventListener("error", () => { const p = list[0]; if (p.full && big.src !== p.full) big.src = p.full; else el.querySelector(".sk-hutph").remove(); });
  }
  // GPX of the route, with the heights when they're loaded.
  function gpx(title, group, info) {
    const x = (s) => esc(s);
    const segs = info ? Object.values(info.pts.reduce((o, p) => ((o[p.seg] = o[p.seg] || []).push(p), o), {})).map((s) => s.sort((a, b) => a.d - b.d))
      : group.flatMap((r) => r.lines).map((l) => l.map(([lat, lon]) => ({ lat, lon })));
    const body = segs.map((s) => `<trkseg>${s.map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.e != null ? `<ele>${p.e.toFixed(1)}</ele>` : ""}</trkpt>`).join("")}</trkseg>`).join("\n");
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Trail Finder" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${x(title)}</name></metadata><trk><name>${x(title)}</name>\n${body}\n</trk></gpx>\n`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([xml], { type: "application/gpx+xml" }));
    a.download = (title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "ski-route") + ".gpx";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- the route card: stats, start and top pins, flyover ----------
  let moreOpen = store.get("skiMore", false) === true;
  // Time for a ski tour, the Munter way the avalanche courses teach: 4 "units" an hour on the way up (1 unit = 1 km
  // or 100 m of climb), 10 on the way down. Up and down split by where the top is.
  function tourHours(info) {
    const ti = info.pts.indexOf(info.top), upKm = (ti >= 0 ? info.pts[ti].d : info.total / 2) / 1000, downKm = info.total / 1000 - upKm;
    return (upKm + info.up / 100) / 4 + (downKm + info.down / 100) / 10;
  }
  const fmtHours = (h) => (h < 0.75 ? `${Math.max(15, Math.round((h * 60) / 15) * 15)} min` : `${Math.round(h * 2) / 2} h`);
  // alex 2026-11-03: "the same kind of info elevation table in the trail info, a bit like mtb trail": six boxes
  // (length, climb, descent, time, top, bottom) and the height profile right on the card, not only under More details.
  const rcGrid = (cells) => `<div class="sk-stats sk-stats3">${cells.map(([v, n, tip]) => `<div${tip ? ` title="${tip}"` : ""}><b>${v}</b><span>${n}</span></div>`).join("")}</div>`;
  function fillCard(info, bands) {
    const el = $("skRcStats");
    if (!el) return;
    el.innerHTML = rcGrid([[(info.total / 1000).toFixed(1) + " km", "Length"], ["↑ " + fmtM(info.up), "Climb"], ["↓ " + fmtM(info.down), "Descent"],
      [fmtHours(tourHours(info)), "Takes", "Munter estimate: 4 km or 400 m of climb an hour up, 10 km or 1000 m an hour down"], [fmtM(info.max), "Top"], [fmtM(info.min), "Bottom"]])
      + profileSvg(info, bands || DEFAULT_BANDS) + `<p class="sk-note">Orange on the profile is 30° and steeper.</p>`;
    bindProfile(el, info);
  }
  // ---------- conditions on the route card ----------
  // alex 2026-10-27: "when i click on a ski route i would like to see all the weather information necessary for
  // backcountry skiing: weather, avalanche risk, visibility, snow condition. make it user friendly." Four boxes on the
  // card, for today or one of the next two days: weather at the top and the bottom, the avalanche danger in the bands
  // the route goes through, the visibility at the top (clouds by height, clouds.js) and the snow (new snow, a guess at
  // the surface from the last 3 days, the closest snow station). Each box opens its part of More details. Everything
  // comes from what the details already load (the same Open-Meteo asks, cached), plus one ask at the bottom's height.
  let condDay = 0, cond = null;
  const CHIGH = "#e03131", CMID = "#f08c00", COK = "#2f9e44", CINFO = "#1c7ed6", CGREY = "#868e96";
  const localDate = (d) => d.toLocaleDateString("en-CA");
  function condStart(r, group, live) {
    cond = { r, live, info: null, top: null, bot: null, hrs: null, err: "" };
    if (r.info) showCond(r.info);
  }
  function showCond(info) {
    const c = cond;
    if (!c || !c.live() || c.info === info) return;
    c.info = info;
    const bot = info.pts.reduce((b, p) => (p.e < b.e ? p : b), info.pts[0]);
    const got = (k) => (v) => { if (cond === c && c.live()) { c[k] = v; renderCond(); } };
    weather(info.top.lat, info.top.lon, info.max).then(got("top"), (e) => { if (cond === c) { c.err = e.message; renderCond(); } });
    weather(bot.lat, bot.lon, info.min).then(got("bot"), () => got("bot")(null));
    if (window.tfClouds && window.tfClouds.hours) window.tfClouds.hours(info.top.lat, info.top.lon, info.min, info.max).then(got("hrs"), () => got("hrs")([]));
    renderCond();
  }
  function renderCond() {
    const el = $("skCond");
    if (!el || !cond || !cond.live()) return;
    el.innerHTML = condHtml(cond);
    el.querySelectorAll(".sk-cond-days button").forEach((b) => b.addEventListener("click", () => { condDay = +b.dataset.d; renderCond(); }));
    el.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => openMore(b.dataset.go)));
  }
  // Opens More details (it stays open, as with its button) at one section.
  function openMore(id) {
    const box = $("skMore"), btn = $("skMoreBtn");
    if (box && box.hidden && btn) btn.click();
    const sec = $(id) && !$(id).hidden ? $(id) : box;
    if (!sec) return;
    if (window.tfPanelScrollTo) window.tfPanelScrollTo(sec); else sec.scrollIntoView({ block: "start" });
  }
  // The hours of one day (8 am to 4 pm, when people are out: the hours from 8 to 15 o'clock) in an Open-Meteo answer.
  const dayHours = (w, date, h0 = 8, h1 = 15) => w.hourly.time.map((t, i) => (t.startsWith(date) && +t.slice(11, 13) >= h0 && +t.slice(11, 13) <= h1 ? i : -1)).filter((i) => i >= 0);
  const avg = (arr, idx) => { const v = idx.map((i) => arr[i]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const hmax = (arr, idx) => { const v = idx.map((i) => arr[i]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
  const deg = (v) => (v == null ? "–" : `${Math.round(v) === 0 ? 0 : Math.round(v)}°`);
  const hourWord = (t) => new Date(t * 1000).toLocaleTimeString("en-CA", { hour: "numeric" }).replace(/\s?([ap])\.?m\.?/i, " $1m");
  function condHtml(c) {
    const head = (days) => `<div class="sk-cond-head"><h4>Conditions</h4>${days.length > 1 ? `<div class="sk-cond-days" role="group" aria-label="Day">${days.map((d, i) => `<button type="button" data-d="${i}" aria-pressed="${i === condDay}">${esc(d.label)}</button>`).join("")}</div>` : ""}</div>`;
    const tile = (go, col, label, big, lines, extra = "") => `<button type="button" class="sk-ct" data-go="${go}" style="--c:${col}"><small>${label}</small><b>${big}</b>${extra}${lines.filter(Boolean).map((l) => `<span${l.m ? ' class="m"' : ""}>${l.m || l}</span>`).join("")}</button>`;
    if (!c || !c.info) return `${head([])}<p class="sk-note">Working out the route's heights for the forecast…</p>`;
    const w = c.top, info = c.info;
    if (!w) return `${head([])}<p class="sk-note">${c.err ? `Couldn't load the weather (${esc(c.err)}).` : "Loading the weather at the top and the bottom…"}</p>`;
    const dd = w.daily, today = localDate(new Date());
    let t0 = dd.time.indexOf(today);
    if (t0 < 0) t0 = 7;
    const days = dd.time.slice(t0, t0 + 3).map((date, j) => ({ date, i: t0 + j, label: j === 0 ? "Today" : new Date(date + "T12:00").toLocaleDateString("en-CA", { weekday: "short" }) }));
    if (condDay >= days.length) condDay = 0;
    const D = days[condDay], hrsTop = dayHours(w, D.date), b = c.bot, hrsBot = b ? dayHours(b, D.date) : [];

    // Weather: the day's temperature at the top and the bottom, the strongest wind up there, rain or snow, freezing level.
    const tTop = avg(w.hourly.temperature_2m, hrsTop), tBot = b ? avg(b.hourly.temperature_2m, hrsBot) : null;
    const wind = hmax(w.hourly.wind_speed_10m, hrsTop), gust = dd.wind_gusts_10m_max[D.i], from = COMPASS[Math.round((dd.wind_direction_10m_dominant[D.i] || 0) / 45) % 8];
    const fz = hmax(w.hourly.freezing_level_height, hrsTop);
    const snowDay = dd.snowfall_sum[D.i] || 0, rainBot = b ? b.daily.precipitation_sum[D.i] - (b.daily.snowfall_sum[D.i] || 0) / 0.7 : 0;
    const wet = (dd.precipitation_sum[D.i] || 0) - snowDay / 0.7;   // Open-Meteo counts 0.7 cm of snow for each mm of water; the rest fell as rain
    const precip = snowDay >= 0.5 ? `❄ ${Math.round(snowDay)} cm of snow up high` : wet >= 1 ? `🌧 ${Math.round(wet)} mm of rain at the top` : rainBot >= 1 ? `🌧 ${Math.round(rainBot)} mm of rain low down` : "Dry";
    const windWord = wind >= 50 || gust >= 80 ? "Very windy" : wind >= 30 || gust >= 55 ? "Windy" : wind >= 15 ? "Breezy" : "Light wind";
    const wCol = wind >= 50 || gust >= 80 ? CHIGH : wind >= 30 || gust >= 55 || wet >= 2 ? CMID : CINFO;
    const wxTile = tile("skWx", wCol, "Weather", `${WICON[dd.weather_code[D.i]] || ""} ${deg(tTop)} / ${deg(tBot)}`, [
      { m: `at the top (${fmtM(info.max)}) / bottom` }, `💨 ${windWord}: ${Math.round(wind || 0)} km/h ${from}, gusts ${Math.round(gust || 0)}`, precip,
      fz != null ? (fz > info.max ? `Freezing level ${fmtM(fz)}: above the top, thawing all the way up` : `Freezing level ${fmtM(fz)}`) : "",
    ]);

    // Avalanche: the highest rating in the bands the route goes through that day, the light, the problems there.
    let avTile;
    const dgList = (avy || example) ? (areaAt(info.top.lat, info.top.lon)?.forecast?.days || []) : [];
    const fIdx = dgList.findIndex((x) => x.date === D.date);
    const dg = fIdx >= 0 || (condDay === 0 && dgList.length) ? dangerAt(info.top.lat, info.top.lon, info.min, info.max, fIdx >= 0 ? fIdx : 0) : null;
    if (!avy && !example && !avyErr) avTile = tile("skAvy", CGREY, "Avalanche", "Loading…", []);
    else if (!dg || !dg.r) {
      const none = !dgList.length ? "No forecast here today" : fIdx < 0 ? "Not forecast yet" : "No rating yet";
      const site = avySite(info.top.lat, info.top.lon);
      avTile = tile("skAvy", CGREY, "Avalanche", none, [{ m: !dgList.length ? site.season : `Check ${site.host} before you go.` }]);
    } else {
      const g = selGroup || [cond.r], pre = cond.r.src === "plan" || cond.r.src === "trip" ? null : groupTerrain(g);
      const official = g.find((x) => x.ates && x.ates.cls >= 1 && x.ates.cls <= 3)?.ates;
      const cls = official ? official.cls : Math.max(T.terrainClass(info).c, pre ? pre.c : 0);
      const L1 = T.LIGHTS[T.light(dg.r, cls)];
      const on = bandKm(info, dg.area.bands), bandsOn = BANDS.filter(([k]) => on[k] >= 0.05).map(([k]) => k);
      const probs = (dg.area.forecast.problems || []).filter((p) => p.elevations.some((e) => bandsOn.includes(e))).map((p) => p.type);
      const bandName = (BANDS.find((x) => x[0] === dg.band) || ["", ""])[1].toLowerCase();
      avTile = tile("skAvy", DANGER[dg.r].color, "Avalanche", esc(DANGER[dg.r].label.replace(/^\d /, "")) + (example ? " (example)" : ""), [
        `in the ${bandName} on this route`,
        `<span class="sk-rc-word" style="--c:${L1.color}">● ${esc(L1.label)}</span> · ${esc(T.CLASSES[cls].label)} terrain`,
        probs.length ? `⚠ ${esc([...new Set(probs)].slice(0, 3).join(", "))}` : { m: "No avalanche problems listed for its bands" },
      ]);
    }

    // Visibility at the top in daylight: in the cloud, under it (flat light), clear or above a cloud sea.
    let visTile;
    if (!c.hrs) visTile = tile("skClouds", CGREY, "Visibility", "Loading…", []);
    else {
      const hs = c.hrs.filter((x) => x.day && localDate(new Date(x.t * 1000)) === D.date && new Date(x.t * 1000).getHours() >= 8 && new Date(x.t * 1000).getHours() <= 15);
      const S = window.tfClouds.STATES, fogCode = dd.weather_code[D.i] === 45 || dd.weather_code[D.i] === 48;
      if (!hs.length) visTile = tile("skClouds", fogCode ? CHIGH : CGREY, "Visibility", fogCode ? "Fog" : "Daylight is over", [{ m: condDay === 0 ? "Pick a day above for its forecast." : "No forecast for that day yet." }]);
      else {
        const n = (st) => hs.filter((x) => x.top === st).length, inside = n("inside"), under = n("under"), good = n("clear") + n("above");
        const run = (st) => { let best = null, cur = null; hs.forEach((x, i) => { if (x.top === st) { cur = cur && cur.e === i - 1 ? { ...cur, e: i } : { s: i, e: i }; if (!best || cur.e - cur.s > best.e - best.s) best = cur; } else cur = null; }); return best; };
        const span = (r) => (r.s === 0 && r.e === hs.length - 1 ? "all day" : `${hourWord(hs[r.s].t)} to ${hourWord(hs[r.e].t + 3600)}`);
        let big, col, line;
        if (inside >= hs.length / 2) { big = "Poor: in the cloud"; col = CHIGH; line = `The top is in the cloud ${span(run("inside"))}. Hard to see the slope and the way.`; }
        else if (good >= hs.length / 2) {
          const above = n("above") > n("clear");
          big = above ? "Good: above the clouds" : "Good"; col = COK;
          line = `${above ? "Over a cloud sea" : "Clear at the top"} ${span(run(above ? "above" : "clear") || { s: 0, e: hs.length - 1 })}${c.hrs.length && hs.some((x) => x.bottom === "inside") ? ", cloud lower down" : ""}.`;
        } else { big = "Flat light"; col = CMID; line = `Under the clouds ${under ? span(run("under")) : "part of the day"}: bumps and drops are hard to see.`; }
        const strip = `<span class="sk-strip" aria-hidden="true">${hs.map((x) => `<i style="background:${S[x.top][0]}"></i>`).join("")}</span>`;
        visTile = tile("skClouds", col, "Visibility", big, [line, { m: `${hourWord(hs[0].t)} to ${hourWord(hs.at(-1).t + 3600)} at the top` }], strip);
      }
    }

    // Snow: new snow (or the day's snowfall for a day ahead), a guess at the surface, the closest snow station.
    const h = w.hourly, nowIdx = Math.max(0, h.time.findIndex((t) => t > w.current.time) - 1);
    const ref = condDay === 0 ? nowIdx : Math.max(0, h.time.indexOf(D.date + "T08:00"));
    const sumH = (arr, a, z) => { let t = 0; for (let i = Math.max(0, a); i <= Math.min(arr.length - 1, z); i++) t += arr[i] || 0; return t; };
    const snow24 = sumH(h.snowfall, ref - 23, ref), snow72 = sumH(h.snowfall, ref - 71, ref);
    let lastWarm = -1, rainTop = 0, windy = 0;
    for (let i = Math.max(0, ref - 71); i <= ref; i++) {
      const t = h.temperature_2m[i] ?? -99;
      if (t > 0.5) { lastWarm = i; rainTop += Math.max(0, (h.precipitation[i] || 0) - (h.snowfall[i] || 0) / 0.7); }
      if (i > ref - 24 && (h.wind_speed_10m[i] || 0) >= 35) windy++;
    }
    const since = lastWarm < 0 ? snow72 : sumH(h.snowfall, lastWarm + 1, ref);
    let surf, sCol;
    if (since >= 10) { surf = windy >= 3 ? "Wind-blown new snow: soft in places, slabs on lee slopes" : `Fresh powder: ${Math.round(since)} cm since it last thawed`; sCol = windy >= 3 ? CMID : COK; }
    else if (rainTop >= 2) { surf = "Rain crust likely: hard and icy until new snow covers it"; sCol = CMID; }
    else if (lastWarm >= 0) { surf = "Melt-freeze crust likely: hard in the morning, softer in the sun"; sCol = CINFO; }
    else if (snow72 >= 3) { surf = "A little new snow on older snow"; sCol = CINFO; }
    else { surf = "Older settled snow, wind-packed in open places"; sCol = CINFO; }
    const bNow = b && b.current ? b.current.temperature_2m : null;
    const lowWet = b && (bNow > 1 || avg(b.hourly.temperature_2m, hrsBot) > 1);
    const next24 = condDay === 0 ? sumH(h.snowfall, ref + 1, ref + 24) : 0;
    const st = (() => { if (!snow && !snowErr) loadSnow(); const x = nearSnow(info.top.lat, info.top.lon)[0]; return x && x.st.sd != null ? x : null; })();
    const big = condDay === 0 ? (snow24 >= 0.5 ? `${Math.round(snow24)} cm new` : snow72 >= 0.5 ? `${Math.round(snow72)} cm in 3 days` : "No new snow") : snowDay >= 0.5 ? `${Math.round(snowDay)} cm that day` : "No snow that day";
    const snowTile = tile("skSnowNear", sCol, "Snow", big, [
      condDay === 0 ? { m: [snow24 >= 0.5 ? `last 24 h at the top, ${Math.round(snow72)} cm in 3 days` : snow72 >= 0.5 ? "at the top, none in the last day" : "", next24 >= 1 ? `${Math.round(next24)} cm more in the next day` : ""].filter(Boolean).join(" · ") || "at the top" } : { m: `${Math.round(snow72)} cm in the 3 days before` },
      `${surf}${lowWet ? "; wet or crusty low down" : ""}`,
      st ? { m: `Station ${esc(st.st.name)}, ${st.st.ele.toLocaleString()} m: ${cm(st.st.sd)} (${plus(st.st.sd24)} in 24 h)` } : "",
    ]);

    // The weather's avalanche warning signs (today only), as short words that open the full text.
    const aw = condDay === 0 ? avyWeather(w, info.max) : null;
    const signs = aw && aw.signs.length ? `<div class="sk-cond-signs">${aw.signs.map(([cl, t]) => `<button type="button" class="${cl}" data-go="skWx" title="${esc(t)}">${esc(t.split(":")[0])}</button>`).join("")}</div>` : "";
    return `${head(days)}<div class="sk-cond-grid">${wxTile}${avTile}${visTile}${snowTile}</div>${signs}
      <p class="sk-note">${condDay === 0 ? "Today" : esc(D.label)}, 8 am to 4 pm. Model forecasts (Open-Meteo) and Avalanche Canada; the snow surface is a guess from the last 3 days' weather. Tap a box for the details.</p>`;
  }

  // The selected tour's start (its lower end, where you put the skins on) and top, as FATMAP pinned them.
  function drawPins(info) {
    pinLayer.clearLayers();
    const a = info.pts[0], b = info.pts[info.pts.length - 1], start = a.e <= b.e ? a : b, top = info.top;
    const pin = (p, fill, label) => L.circleMarker([p.lat, p.lon], { pane: "ski", radius: 8, color: "#fff", weight: 3, fillColor: fill, fillOpacity: 1, interactive: false }).bindTooltip(label);
    pinLayer.addLayer(pin(start, "#2f9e44", `Start, ${fmtM(start.e)}`));
    if (Math.hypot(top.lat - start.lat, (top.lon - start.lon) * 0.65) > 0.0008) pinLayer.addLayer(pin(top, "#e03131", `Top, ${fmtM(top.e)}`));
    renderSkiKey();
  }
  // Flyover: the 3D camera flies the tour from its start to its top and on to its end, like FATMAP's. Any touch on
  // the map or Stop ends it. Not too close (zoom 13 in 3D), so the phone doesn't load more ground than it can hold.
  let flying = null;
  function stopFly() {
    if (!flying) return;
    cancelAnimationFrame(flying.raf); flying.pill.remove();
    flying.off();
    flying = null;
    const b = $("skFly"); if (b) b.innerHTML = `<span class="ic" aria-hidden="true">✈</span>Flyover`;
  }
  async function flyover(info, title) {
    stopFly();
    const mapEl = map.getContainer();
    if (!mapEl.classList.contains("is3d")) document.getElementById("btn3d")?.click();
    let gl = null;
    for (let n = 0; n < 150; n++) { gl = window.trailMap3d; if (gl && gl.getStyle() && mapEl.classList.contains("is3d")) break; await new Promise((ok) => setTimeout(ok, 100)); }
    if (!gl || !mapEl.classList.contains("is3d")) { if (window.tfToast) window.tfToast("The 3D map isn't ready, so no flyover. Try again in a moment."); return; }
    let pts = info.pts.slice();
    if (pts[0].e > pts[pts.length - 1].e) pts.reverse();
    // Distance along the way it's flown (pts[].d runs the other way when reversed).
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + map.distance([pts[i - 1].lat, pts[i - 1].lon], [pts[i].lat, pts[i].lon]));
    const total = along[along.length - 1] || 1, dur = Math.max(15000, Math.min(50000, (total / 1000) * 5000));
    const at = (m) => {
      m = Math.max(0, Math.min(total, m));
      let i = 1;
      while (i < along.length - 1 && along[i] < m) i++;
      const t = (m - along[i - 1]) / ((along[i] - along[i - 1]) || 1), p = pts[i - 1], q = pts[i];
      return [p.lon + (q.lon - p.lon) * t, p.lat + (q.lat - p.lat) * t];
    };
    const bear = (a, b) => (Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI;
    const pill = document.createElement("div");
    pill.className = "sk-fly"; pill.setAttribute("role", "status");
    pill.innerHTML = `<span>✈ Flyover: ${esc(title)}</span><button type="button">Stop</button>`;
    pill.querySelector("button").addEventListener("click", stopFly);
    L.DomEvent.disableClickPropagation(pill);
    mapEl.append(pill);
    if (window.tfLowerSheet) window.tfLowerSheet();   // phones: the whole map for the flight
    const box = document.getElementById("map3d"), touch = () => stopFly();
    box && box.addEventListener("pointerdown", touch);
    const onSport = () => stopFly();
    window.addEventListener("tf:sport", onSport);
    const b = $("skFly"); if (b) b.innerHTML = `<span class="ic" aria-hidden="true">■</span>Stop`;
    let heading = bear(at(0), at(400)), t0 = 0;
    const zoom = PHONE_UI() ? 13 : 13.5;
    flying = { raf: 0, pill, off: () => { box && box.removeEventListener("pointerdown", touch); window.removeEventListener("tf:sport", onSport); } };
    const step = (now) => {
      if (!flying) return;
      if (!t0) t0 = now;
      const f = Math.min(1, (now - t0) / dur), m = f * total, here = at(m);
      // Look 400 m ahead, and turn smoothly so a zigzag skin track doesn't shake the camera.
      let want = bear(here, at(m + 400)), diff = ((want - heading + 540) % 360) - 180;
      heading += diff * 0.04;
      gl.jumpTo({ center: here, zoom, pitch: 68, bearing: heading });
      if (f >= 1) { stopFly(); return; }
      flying.raf = requestAnimationFrame(step);
    };
    gl.jumpTo({ center: at(0), zoom, pitch: 68, bearing: heading });
    flying.raf = requestAnimationFrame(step);
  }
  const PHONE_UI = () => matchMedia("(max-width: 760px)").matches;

  let selToken = 0;
  // Close the details and drop the highlight: the ✕, or a tap on the map away from any route (alex 2026-10-24).
  function unselect() {
    if (!selected) return;
    selected = null; selToken++; $("skDetail").hidden = true; hoverLayer.clearLayers(); aboveLayer.clearLayers(); pinLayer.clearLayers(); stopFly();
    drawSki(); renderList(); renderForecast(); renderSkiKey();
  }
  function select(it, fly) {
    if (spot) closeSpot();
    const group = Array.isArray(it) ? it : [it];
    const r = group[0];
    if (selected !== r) { hoverLayer.clearLayers(); aboveLayer.clearLayers(); pinLayer.clearLayers(); stopFly(); }
    const was = selected;
    selGroup = group;
    selected = r;
    // Your tour swapped for its other way (🛡 Safest on or off): no mapped route changes its highlight, so the
    // whole Skiing layer (and the 3D map's copy of it) isn't redrawn.
    if (!(was && was.src === "plan" && r.src === "plan")) drawSki();
    renderList();
    if (fly) {
      if (r.lat != null) map.setView([r.lat, r.lon], Math.max(map.getZoom(), 14));
      else map.fitBounds(group.reduce((b, x) => b.extend(x.bounds), L.latLngBounds(r.bounds.getSouthWest(), r.bounds.getNorthEast())), { padding: [30, 30], maxZoom: 15 });
    }
    // The pieces of a route with the same name and type go together (as in the list).
    if (!Array.isArray(it) && r.lat == null && r.name && ski) {
      const box = r.bounds.pad(0.5), same = (ski.routes || []).filter((x) => x.type === r.type && x.name && x.name.toLowerCase() === r.name.toLowerCase() && box.intersects(x.bounds));
      if (same.length > 1) group.splice(0, group.length, r, ...same.filter((x) => x !== r));
    }
    const token = ++selToken, live = () => token === selToken && selected === r;
    const d = $("skDetail");
    const isHut = r.lat != null, isStart = isHut && r.src === "c2c", t = isStart ? TYPES[r.type] || TYPES.tour : isHut ? HUT : TYPES[r.type] || TYPES.other;
    const osmType = { w: "way", r: "relation", n: "node" }[r.id[0]];
    const mine = r.src === "plan" || r.src === "trip";   // your planned tour, or a cabin trip's way in (cabin-trip.js)
    const src = mine ? "your plan" : r.src === "bc"
      ? `BC Recreation Sites and Trails (<a href="https://www.sitesandtrailsbc.ca/" target="_blank" rel="noopener">sitesandtrailsbc.ca</a>)`
      : r.src === "c2c"
      ? `<a href="https://www.camptocamp.org/routes/${esc(r.id.slice(3))}" target="_blank" rel="noopener">camptocamp.org</a> (CC BY-SA)`
      : r.src === "sepaq"
      ? `Sépaq winter trails (<a href="https://www.donneesquebec.ca/recherche/dataset/sentiers-hivernaux" target="_blank" rel="noopener">Données Québec</a>, CC BY 4.0)`
      : r.src === "club"
      ? `${r.facts && r.facts.src ? `<a href="${esc(r.facts.src)}" target="_blank" rel="noopener">${esc(r.tags.operator || "the hut's club")}</a>` : esc(r.tags.operator || "the hut's club")} (not on OpenStreetMap yet)`
      : r.src === "hw"
      ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a> by ${esc(r.tags["hw:by"] || "Rob Thomson")} (<a href="https://hokkaidowilds.org/" target="_blank" rel="noopener">hokkaidowilds.org</a>, CC BY-SA 4.0): full guide, photos and topo map there`
      : r.src === "hand" && r.official
      ? `Whistler Blackcomb's own backcountry access map: ${linksHtml(r)}`
      : r.src === "hand"
      ? `${r.osmLine ? "the operator's pages and guide notes" : "trip reports and guidebooks"}${(r.links || []).length ? ": " + linksHtml(r) : ""}${r.osmLine ? `; the line follows trails on <a href="https://www.openstreetmap.org/" target="_blank" rel="noopener">OpenStreetMap</a>` : " (not on OpenStreetMap yet)"}`
      : r.src === "pc"
      ? `Parks Canada trails (<a href="https://open.canada.ca/data/en/dataset/64a90e8d-5bc0-4027-8645-b5881b4068d4" target="_blank" rel="noopener">open.canada.ca</a>, Open Government Licence)`
      : `<a href="https://www.openstreetmap.org/${osmType}/${r.id.slice(1)}" target="_blank" rel="noopener">OpenStreetMap</a>${(r.links || []).length ? `; more facts from ${linksHtml(r)}` : ""}`;
    const tags = tagsHtml(r);
    const club = !isHut && r.type === "snowmobile" ? clubNear(r.lines[0][0][0], r.lines[0][0][1]) : null;
    const title = isHut ? r.name || (isStart ? "camptocamp route" : KIND[r.kind] || "Hut") : nameOf(r) || "Unnamed route";
    const pt = isHut ? [r.lat, r.lon] : r.lines[0][0];
    d.hidden = false;
    // A route to follow gets FATMAP's short card first (photo, how risky today, km / climb / time, Flyover, Watch,
    // GPX, Go); the rest is under "More details", which stays open once opened.
    const isRoute = !isHut && !r.area;
    const len = isRoute ? group.reduce((s, x) => s + km(x), 0) : 0;
    const card = isRoute ? `<div class="sk-rc">
        <img class="sk-rc-ph" id="skRcPh" alt="" hidden referrerpolicy="no-referrer">
        <div><button type="button" class="sk-x" aria-label="Close">✕</button><h3>${esc(title)}</h3></div>
        <div class="sk-rc-tag" id="skRcTag">${[esc(isUphill(r) ? UP_LABEL : t.label), diffPill(r.diff)].filter(Boolean).join(" · ")}</div>
        ${r.wb ? `<p class="sk-wbst" id="skWbSt"><span>Whistler Blackcomb today</span> <b>…</b></p>` : ""}
        ${isUphill(r) ? `<p class="sk-hint sk-up">⬆ ${esc(UP_ABOUT)}</p>` : ""}
        <div class="sk-rc-elev" id="skRcStats">${rcGrid([[len.toFixed(1) + " km", "Length"], ["…", "Climb"], ["…", "Descent"], ["…", "Takes"], ["…", "Top"], ["…", "Bottom"]])}<p class="sk-note">Loading heights…</p></div>
        <div class="sk-cond" id="skCond">${condHtml()}</div>
        <div class="sk-rc-btns">
          <button type="button" id="skFly" title="Fly along the route on the 3D map"><span class="ic" aria-hidden="true">✈</span>Flyover</button>
          ${mine ? "" : `<button type="button" id="skRcWatch" aria-pressed="false" disabled title="Alerts in the 🔔 when this tour turns risky"><span class="ic" aria-hidden="true">🔔</span>Watch</button>`}
          <button type="button" id="skGpx" title="Download the route as a GPX file"><span class="ic" aria-hidden="true">⬇</span>GPX</button>
          ${r.src === "plan" ? "" : `<button type="button" id="skAddTour" title="Put this line in your planned tour: the route follows it from its top to its bottom"><span class="ic" aria-hidden="true">＋</span>Add to tour</button>`}
          ${window.tfRide ? `<button type="button" class="go" id="skFollow" title="Follow this tour with your location"><span class="ic" aria-hidden="true">▶</span>Go</button>` : ""}
        </div>
        <button type="button" class="sk-more-btn" id="skMoreBtn" aria-expanded="${moreOpen}" aria-controls="skMore">${moreOpen ? "Fewer details ▴" : "More details: avalanche check, slopes, forecast, weather ▾"}</button>
      </div>` : `<div><button type="button" class="sk-x" aria-label="Close">✕</button><h3>${esc(title)}</h3></div>${isHut && !isStart && !/^(parking|trailhead)$/.test(r.kind) ? `<div id="skHutPh" class="sk-hutphs"><p class="sk-note sk-hutph-none">Looking for photos of the hut…</p></div>` : ""}${isHut && !isStart ? bookHtml(r) : ""}`;
    d.innerHTML = `${card}<div id="skMore"${isRoute && !moreOpen ? " hidden" : ""} class="sk-morebox">
      ${isHut && !isStart ? `<p class="sk-hint">${esc(HUT_ABOUT[r.kind] || HUT_ABOUT.basic_hut)}</p>` : ""}
      <dl><dt>Type</dt><dd>${esc(isStart ? t.label + " (start point only; see camptocamp for the route)" : isHut ? KIND[r.kind] || (r.kind || "hut").replace(/_/g, " ") : isUphill(r) ? UP_LABEL : t.label)}</dd>
      ${isHut ? "" : r.area ? `<dt>Size</dt><dd>${hectares(r).toFixed(0)} ha: mapped as an area (a bowl or zone), not a line to follow</dd>`
        : `<dt>Length</dt><dd>${group.reduce((s, x) => s + km(x), 0).toFixed(1)} km${group.length > 1 ? ` (${group.length} pieces)` : ""}</dd>`}
      ${r.diff ? `<dt>Difficulty</dt><dd>${esc(DIFF[r.diff] || r.diff)}</dd>` : ""}
      ${r.kind === "parking" || r.kind === "trailhead" ? `<dt>Drive</dt><dd><a href="https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}" target="_blank" rel="noopener">Directions to here</a></dd>` : ""}
      ${r.routes ? `<dt>Part of</dt><dd>${esc(r.routes.join(", "))}</dd>` : ""}
      ${club ? `<dt>Club</dt><dd><a href="#" class="sb-go">${esc(club.c.name)}</a> (${esc(club.a.name)}, ${club.km.toFixed(0)} km away): grooming report and trail pass</dd>` : ""}
      ${tags.plain}<span id="skNear"></span></dl>
      ${isHut || r.area ? "" : `<div class="sk-sec" id="skCheck"><h4>Avalanche check</h4><p class="sk-note">Working out the terrain…</p></div>`}
      ${isHut ? "" : `<div class="sk-sec" id="skElev"><h4>${isRoute ? "Slopes" : "Elevation"}</h4><p class="sk-note">Loading heights…</p></div>`}
      <div class="sk-sec" id="skLocal" hidden></div>
      <div class="sk-sec" id="skAvy"></div>
      <div class="sk-sec" id="skWx"><h4>Weather</h4><p class="sk-note">Loading the forecast…</p></div>
      <div class="sk-sec" id="skSnowNear" hidden></div>
      ${mine ? "" : `<div class="sk-sec" id="skPh"><h4>Photos</h4><p class="sk-note">Looking for photos…</p></div>
      <p class="sk-note">From ${src}</p>`}</div>`;
    const moreBtn = $("skMoreBtn");
    if (moreBtn) moreBtn.addEventListener("click", () => {
      moreOpen = $("skMore").hidden; store.set("skiMore", moreOpen);
      $("skMore").hidden = !moreOpen;
      moreBtn.setAttribute("aria-expanded", String(moreOpen));
      moreBtn.textContent = moreOpen ? "Fewer details ▴" : "More details: avalanche check, slopes, forecast, weather ▾";
    });
    if (r.wb) wbStatus(r.wb).then((st) => {
      const el = $("skWbSt");
      if (!el || !live()) return;
      el.className = `sk-wbst ${st ? st.k : ""}`;
      el.querySelector("b").textContent = st ? st.label : "Couldn't load it: check their terrain status map";
    });
    const rcw = $("skRcWatch");
    if (rcw) rcw.addEventListener("click", () => { const w = $("skWatch"); if (w) w.click(); });
    const flyBtn = $("skFly");
    if (flyBtn) flyBtn.addEventListener("click", () => {
      if (flying) { stopFly(); return; }
      flyBtn.disabled = true;
      routeInfo(group).then((info) => { if (live()) flyover(info, title); }, () => window.tfToast && window.tfToast("Couldn't load the route's heights for the flyover."))
        .finally(() => { flyBtn.disabled = false; });
    });
    window.dispatchEvent(new CustomEvent("tf:ski-select", { detail: { item: r, el: $("skLocal") } }));   // rogers.js: permit areas, huts
    d.querySelector(".sk-x").addEventListener("click", unselect);
    const fol = $("skFollow");
    if (fol) fol.addEventListener("click", () => { if (plan.on) setPlanning(false); window.tfRide.follow(r.info ? chain(group) : group.flatMap((x) => x.lines), title); });
    showNearSnow();
    renderForecast();
    const go = d.querySelector(".sb-go");
    if (go) go.addEventListener("click", (e) => { e.preventDefault(); showClub(club.c); });
    const gpxBtn = $("skGpx");
    if (gpxBtn) gpxBtn.addEventListener("click", () => gpx(title, group, r.info));
    // Add to tour (alex 2026-11-04: "make it so you can put line in your tour"): the line goes in Plan a tour as two
    // points, its top and its bottom (a skin track: bottom then top), and the leg between them follows it as drawn.
    const addBtn = $("skAddTour");
    if (addBtn) addBtn.addEventListener("click", () => {
      addBtn.disabled = true;
      planRouteLine(r, group, title).finally(() => { addBtn.disabled = false; });
    });

    // The avalanche forecast is needed here even with the shading off.
    if (!avy && !example && !avyErr) loadAvy();
    const showAvy = (info) => {
      if (!live()) return;
      const p = info ? [info.top.lat, info.top.lon] : pt;
      const area = (avy || example) ? areaAt(p[0], p[1]) : null;
      const el = $("skAvy");
      el.innerHTML = avyHtml(area, info, p);
      const elev = $("skElev");
      const bands = area ? area.bands : DEFAULT_BANDS;
      if (info && elev) { elev.innerHTML = elevHtml(info, bands, area, isRoute); bindProfile(elev, info); }
      if (info && isRoute) fillCard(info, bands);   // the card's profile shows the treeline and alpine of this forecast area
      showCheck();
    };
    // Under the weather: clouds by height against the route's top and bottom (clouds.js).
    const showWx = (lat, lon, ele, lo) => weather(lat, lon, ele).then((w) => {
      if (!live()) return;
      $("skWx").innerHTML = wxHtml(w, ele) + (window.tfClouds ? `<div class="sk-sec" id="skClouds"></div>` : "");
      if (window.tfClouds) window.tfClouds.chart($("skClouds"), { lat, lon, lo: lo ?? ele, hi: ele, kind: lo != null && ele - lo >= 60 ? "route" : "here" });
    })
      .catch((e) => { if (live()) $("skWx").innerHTML = `<h4>Weather</h4><p class="sk-note">Couldn't load the weather (${esc(e.message)}).</p>`; });
    showAvy(r.info || null);
    if (!minData && !minErr) loadMin().then(() => showAvy(r.info || null));
    if (isRoute) condStart(r, group, live);
    const showPh = (info) => mine ? null : routePhotos(r, info).then((ph) => {
      const el = $("skPh"); if (!live() || !el) return; el.innerHTML = photosHtml(ph, isHut); bindPhotos(el, ph.list);
      // The card's photo only when it's really of this route (alex 2026-11-03: "most of the time it is not a picture of
      // the line"): the route's own (camptocamp), or one whose title names it. The nearby photos stay in Photos below.
      const img = $("skRcPh"), i0 = ph.list.findIndex((p) => p.own || namesIt(p, r)), p0 = ph.list[i0];
      if (img && p0) { img.src = p0.big || p0.thumb; img.alt = p0.title || ""; img.hidden = false; img.onclick = () => window.tfPhotos.open(ph.list, i0); img.onerror = () => { img.hidden = true; }; }
    });
    if ($("skHutPh")) hutPhotos(r).then((list) => {
      const el = $("skHutPh"); if (!live() || !el) return;
      el.innerHTML = hutPhHtml(r, list); bindHutPh(el, list);
    });
    if (isHut) { showWx(r.lat, r.lon, parseFloat(r.tags?.ele) || null); showPh(null); return; }
    routeInfo(group).then((info) => {
      if (!live()) return;
      showAvy(info);
      showWx(info.top.lat, info.top.lon, info.max, info.min);
      showPh(info);
      drawAbove(info);
      if (isRoute) { drawPins(info); showCond(info); }
      if (mine) renderPlan();
      if (r.src === "plan") warmPlanOther();
      const nb = $("skNear");
      if (nb) {
        nb.outerHTML = nearbyHtml(info);
        d.querySelectorAll(".sk-go").forEach((a) => a.addEventListener("click", (e) => {
          e.preventDefault();
          const h = [...(ski.huts || []), ...(ski.parking || []), ...(ski.starts || [])].find((x) => x.id === a.dataset.id);
          if (h) select(h, true);
        }));
      }
    }).catch((e) => {
      if (!live()) return;
      $("skElev").innerHTML = `<h4>Elevation</h4><p class="sk-note">Couldn't load the heights (${esc(e.message)}).</p>`;
      if (mine) renderPlan();
      showWx(pt[0], pt[1], null);
      showPh({ pts: group.flatMap((x) => x.lines.flat()).map(([lat, lon]) => ({ lat, lon })), top: { lat: pt[0], lon: pt[1] } });
    });
  }

  // The avalanche check at the top of a route's details: the trip planner light for each forecast day, the terrain
  // class with what it's based on, and 🔔 Watch this tour (alerts in the bell, notify.js, from tf:skiWatch).
  let selGroup = null;
  const watchList = () => store.get("skiWatch", []);
  const watchKeyOf = (r, top) => (r.src === "plan" || r.src === "trip" ? `p:${top.lat.toFixed(3)},${top.lon.toFixed(3)}` : r.id);
  function showCheck() {
    const el = $("skCheck"), g = selGroup;
    if (!el || !g || selected !== g[0]) return;
    const r = g[0], info = r.info || null;
    const pre = r.src === "plan" || r.src === "trip" ? null : groupTerrain(g);
    const live = info ? T.terrainClass(info) : null;
    const preCls = pre ? { ...T.terrainClass(pre), ...T.CLASSES[pre.c], c: pre.c } : null;   // pre.c: the pieces' hardest, or their sum
    const official = g.find((x) => x.ates && x.ates.cls >= 1 && x.ates.cls <= 3)?.ates || null;
    const cls = official ? { ...(live || preCls || { why: [] }), ...T.CLASSES[official.cls], c: official.cls } : live && (!preCls || live.c >= preCls.c) ? live : preCls;
    if (!cls || (!info && !pre)) { el.innerHTML = `<h4>Avalanche check</h4><p class="sk-note">Working out the terrain…</p>`; return; }
    const lo = info ? info.min : pre.lo, hi = info ? info.max : pre.hi, top = info ? info.top : { lat: pre.top[0], lon: pre.top[1] };
    const area = avy || example ? areaAt(top.lat, top.lon) : null, f = area && area.forecast;
    const expired = f && !example && f.validUntil && new Date(f.validUntil) < new Date();
    const days = f && !expired && f.days ? f.days.map((d, j) => ({ d, j, ...dangerAt(top.lat, top.lon, lo, hi, j) })).filter((x) => x.r) : [];
    const bandName = (b) => (BANDS.find((x) => x[0] === b) || ["", ""])[1].toLowerCase();
    const dayName = (d, j) => (j === 0 && d.date === new Date().toISOString().slice(0, 10) ? "Today" : d.label || d.date);
    let head;
    if (days.length) {
      const now = days.find((x) => x.j === Math.min(day, f.days.length - 1)) || days[0], l = T.light(now.r, cls.c), L0 = T.LIGHTS[l];
      head = `<div class="sk-check" style="--c:${L0.color}"><b>${L0.label}</b><span>${esc(dayName(now.d, now.j))}: ${esc(DANGER[now.r].label.replace(/^\d /, ""))} in the ${bandName(now.band)} × ${cls.label} terrain</span></div>
        <p class="sk-note">${esc(L0.what)}</p>
        ${days.length > 1 ? `<ul class="sk-checkdays">${days.filter((x) => x !== now).map((x) => `<li>${esc(dayName(x.d, x.j))}: ${lightPill(T.light(x.r, cls.c))} <span class="sk-note">${esc(DANGER[x.r].label.replace(/^\d /, ""))}, ${bandName(x.band)}</span></li>`).join("")}</ul>` : ""}`;
    } else {
      head = `<div class="sk-check" style="--c:${cls.color}"><b>${cls.label} terrain</b><span>No danger rating ${f && !expired ? "yet" : "here today"}, so no trip planner light. Check ${siteLink(avySite(top.lat, top.lon))} before you go.</span></div>`;
    }
    const k = watchKeyOf(r, top), on = watchList().some((w) => w.k === k);
    el.innerHTML = `<h4>Avalanche check${example ? " (example forecast)" : ""}</h4>${head}
      <dl><dt>Terrain</dt><dd>${classPill(cls.c, official ? "Official ATES rating" : "")} <span class="sk-note">${official ? `official ATES rating${official.src ? ` from ${official.url ? `<a href="${esc(official.url)}" target="_blank" rel="noopener">${esc(official.src)}</a>` : esc(official.src)}` : ""}` : "estimate"}</span><br>${esc(cls.what)}</dd>
        ${cls.why.length ? `<dt>${official ? "Terrain seen" : "Because"}</dt><dd><ul class="sk-why">${cls.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></dd>` : ""}</dl>
      <div class="sk-row"><button type="button" class="btn sk-watch" id="skWatch" aria-pressed="${on}">${on ? "🔔 Watching this tour" : "🔔 Watch this tour"}</button></div>
      <p class="sk-note">${on ? "The 🔔 tells you when this tour turns to Extra caution or Not recommended (and your phone, if 📱 is on there). " : ""}The terrain class is worked out from the shape of the ground, like ATES (simple, challenging, complex): forest, cornices, glaciers and small features aren't seen. Where an area has an official rating, it's on <a href="https://avalanche.ca/planning/trip-planner" target="_blank" rel="noopener">Avalanche Canada's trip planner</a>. The light follows Avalanche Canada's Avaluator chart: it's for planning, not a decision on the day.</p>`;
    $("skWatch").addEventListener("click", () => {
      const list = watchList().filter((w) => w.k !== k);
      if (on && window.tfAccount && window.tfAccount.gone) window.tfAccount.gone("skiWatch", k);   // so the account doesn't bring it back
      if (!on) {
        list.unshift({ k, at: Date.now(), n: r.src === "plan" ? "Your planned tour" : r.src === "trip" ? r.name : nameOf(r) || "Unnamed tour", c: [Math.round(top.lat * 1e5) / 1e5, Math.round(top.lon * 1e5) / 1e5], lo: Math.round(lo), hi: Math.round(hi), cls: cls.c });
        if (store.get("avyAlert", null) !== true) store.set("avyAlert", true);   // watching a tour means wanting its alerts
      }
      store.set("skiWatch", list.slice(0, 40));
      showCheck();
    });
    // The card at the top: today's light (or the terrain class) as its coloured word, and Watch.
    const tg = $("skRcTag");
    if (tg) {
      const L1 = days.length ? T.LIGHTS[T.light((days.find((x) => x.j === Math.min(day, f.days.length - 1)) || days[0]).r, cls.c)] : null;
      tg.innerHTML = [L1 ? `<span class="sk-rc-word" style="--c:${L1.color}">● ${esc(L1.label)}</span>` : "", classPill(cls.c, official ? "Official ATES rating" : ""),
        esc(isUphill(r) ? UP_LABEL : (TYPES[r.type] || TYPES.other).label), diffPill(r.diff)].filter(Boolean).join(" · ");
    }
    renderCond();
    const cw = $("skRcWatch");
    if (cw) { cw.disabled = false; cw.setAttribute("aria-pressed", String(on)); cw.innerHTML = `<span class="ic" aria-hidden="true">🔔</span>${on ? "Watching" : "Watch"}`; }
  }

  // The closest snow stations, under a route's or a hut's details.
  function showNearSnow() {
    const el = $("skSnowNear"), r = selected;
    if (!el || !r) return;
    const at = r.lat != null ? [r.lat, r.lon] : r.info ? [r.info.top.lat, r.info.top.lon] : r.lines[0][0];
    if (!snow && !snowErr) loadSnow();
    const list = nearSnow(at[0], at[1]);
    el.hidden = !list.length;
    el.innerHTML = `<h4>Snow stations nearby</h4>` + list.map(({ st, km }) =>
      `<p><a href="#" data-st="${esc(st.id)}">${esc(st.name)}</a> <span class="sk-note">${st.ele.toLocaleString()} m, ${km.toFixed(0)} km away</span><br>${st.sd != null ? `Snow <b>${cm(st.sd)}</b> · last 24 h <b>${plus(st.sd24)}</b> · 3 days ${plus(st.sd72)}` : "No snow depth sensor"}${st.ta != null ? ` · ${Math.round(st.ta)}°C` : ""}</p>`).join("");
    el.querySelectorAll("[data-st]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); const st = snow.stations.find((x) => x.id === a.dataset.st); if (st) { if (!shown.has("snow")) { shown.add("snow"); applySwitches(); } showStation(st); } }));
  }
  // ---------- plan a tour ----------
  // Tap the map for each point of the way (up the skin track, then the way down): the line goes straight between
  // them, as on CalTopo. As soon as there are two points the tour gets the same details as a mapped route (heights,
  // slopes under it and above it, the avalanche forecast for its bands, weather at the top, GPX and Follow). Slope
  // angles show while planning. The plan stays on this device until it's cleared.
  // 🛡 Safest way (ski-route.js): with it on, the line between the points is the one it found (kept with the points it
  // was found for), not straight.
  const planKey = () => JSON.stringify(plan.pts);
  // A found way is only good on the day it was found: its danger ratings are that day's forecast, shown as "today".
  const sameDay = (t) => !!t && new Date(t).toDateString() === new Date().toDateString();
  const safePath = () => (plan.safe && plan.path && plan.path.key === planKey() && sameDay(plan.path.at) && plan.path.line && plan.path.line.length > 1 ? plan.path : null);
  // Each way's heights and slopes are kept (by its points and whether it's the safest way), so turning 🛡 Safest on
  // and off shows the other way's numbers and card at once instead of working them out again (alex 2026-11-04: "It
  // lag when I activate and deactivate safest way").
  const planInfo = new Map();
  const planLineKey = () => (plan.pts.length < 2 ? "" : (safePath() ? "s" : "p") + planKey());
  function planRoute() {
    if (plan.pts.length < 2) return null;
    const sp = safePath(), line = sp ? sp.line.slice() : plan.pts.slice(), key = planLineKey();
    const r = { id: "plan", src: "plan", type: "tour", name: sp ? "Your tour, less exposed way" : "Your planned tour", tags: {}, g: [line.flatMap((p) => [p[0], p[1]])], lines: [line], bounds: L.latLngBounds(line), key };
    if (planInfo.has(key)) r.info = planInfo.get(key);
    return r;
  }
  // Once one way's numbers are in, the other way's (straight between the points, or the safest way when it's been
  // found) are worked out quietly too, so even the first 🛡 Safest switch is instant.
  function warmPlanOther() {
    if (plan.pts.length < 2) return;
    const k = planKey(), sp = plan.path && plan.path.key === k && sameDay(plan.path.at) && plan.path.line && plan.path.line.length > 1 ? plan.path : null;
    const other = safePath() ? { key: "p" + k, line: plan.pts.slice() } : sp ? { key: "s" + k, line: sp.line.slice() } : null;
    if (!other || planInfo.has(other.key)) return;
    setTimeout(() => {
      if (planInfo.has(other.key) || planKey() !== k) return;
      routeInfo([{ src: "plan", key: other.key, lines: [other.line] }]).catch(() => {});
    }, 800);
  }
  // A tour kept from last time (or from another device) had no numbers until a point moved: "Working out heights and
  // slopes…" stayed on for good (alex's recording 2026-11-05). Work them out quietly once, then show them.
  let planWarming = "";
  function warmPlanNow() {
    const r = planRoute();
    if (!r || r.info || planWarming === r.key) return;
    planWarming = r.key;
    routeInfo([r]).then(() => { if (planLineKey() === r.key) renderPlan(); }, () => {}).finally(() => { if (planWarming === r.key && planInfo.has(r.key)) planWarming = ""; });
  }
  // The numbers for the way on the map now: none while the other way's are still showing.
  const planNowInfo = () => {
    const key = planLineKey();
    if (!key) return null;
    if (selected && selected.src === "plan" && selected.key === key && selected.info) return selected.info;
    return planInfo.get(key) || null;
  };
  // The plan's labels on the 3D map too (it doesn't show Leaflet markers): Start, 1, 2 ... End and the !n watch-outs
  // (alex 2026-11-04: "put point on map in the route").
  let planGl = [];
  function planGlPin(ll, html, z, onDrag) {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    const el = document.createElement("div");
    el.className = "sk-plangl"; el.style.zIndex = z; el.style.pointerEvents = onDrag ? "auto" : "none"; el.innerHTML = html;
    const m = new maplibregl.Marker({ element: el, anchor: "center", opacityWhenCovered: 1, draggable: !!onDrag }).setLngLat([ll[1], ll[0]]).addTo(gl);
    if (onDrag) {
      // A tap on a point isn't a new point there; a drag moves it (alex 2026-11-04: "I want to move it on the map").
      el.addEventListener("click", (e) => e.stopPropagation());
      m.on("dragstart", () => { plan.dragAt = Date.now(); });
      m.on("dragend", () => { plan.dragAt = Date.now(); const c = m.getLngLat(); onDrag(L.latLng(c.lat, c.lng)); });
    }
    planGl.push(m);
  }
  // While a tour is planned or shown, everything else on the map steps back so the route reads first (alex 2026-11-05:
  // "When you set a route make everything else just a bit smaller", "Smaller highlighted line"): the other lines
  // (slackcountry, freeride, touring, runs, lifts...) thinner and a little fainter, their names and pins smaller, on the
  // flat map and in 3D (map3d.js copies the thinner lines; tf:routefocus for its names). The tour's own lines, its points
  // and a line offered while planning keep their size. Areas (polygons) are left as they are.
  const FOCUS_W = 0.5, FOCUS_O = 0.7;
  let focusOn = false;
  const thinIt = (l) => {
    if (!focusOn || !(l instanceof L.Polyline) || l instanceof L.Polygon || l._tfThin || plan.layer.hasLayer(l) || !(l.options.weight > 0)) return;
    l._tfThin = { w: l.options.weight, o: l.options.opacity };
    l.setStyle({ weight: Math.max(1.5, l.options.weight * FOCUS_W), opacity: (l.options.opacity == null ? 1 : l.options.opacity) * FOCUS_O });
  };
  map.on("layeradd", (e) => thinIt(e.layer));
  function routeFocus(want) {
    if (want === focusOn) return;
    focusOn = want;
    document.body.classList.toggle("sk-route-focus", want);
    map.eachLayer((l) => {
      if (want) thinIt(l);
      else if (l._tfThin) { const t = l._tfThin; delete l._tfThin; l.setStyle({ weight: t.w, opacity: t.o }); }
    });
    map.fire("trailfocus");   // map3d.js: copy the lines again
    window.dispatchEvent(new CustomEvent("tf:routefocus", { detail: want }));
  }
  function drawPlan() {
    routeFocus(sport === "ski" && (plan.on || (plan.show && plan.pts.length > 1)));
    plan.layer.clearLayers();
    planGl.forEach((m) => m.remove()); planGl = [];
    if (sport !== "ski" || (!plan.pts.length && !plan.offer)) return;
    // The tour is on the map only while it's being planned or edited, or after Show on map (alex 2026-11-04: "are we
    // always seeing the ski route on the map? i dont want to always see it"). It stays saved either way.
    if (!plan.on && !plan.show) return;
    // Zoomed out, only the line: its numbered points and watch-outs piled up into one blob.
    const pins = plan.on || map.getZoom() >= 12;
    const sp = safePath();
    if (sp) {
      const C = SAFE_CLS;
      // Easy to pick out among the runs and trails (alex 2026-11-04: "hard to see the route"): a dark halo, a white band, then the colours.
      for (const r of sp.runs) plan.layer.addLayer(L.polyline(r.pts, { pane: "ski", color: "#111", weight: 14, opacity: 0.45, lineCap: "round", lineJoin: "round", interactive: false }));
      for (const r of sp.runs) plan.layer.addLayer(L.polyline(r.pts, { pane: "ski", color: "#fff", weight: 10, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false }));
      for (const r of sp.runs) plan.layer.addLayer(L.polyline(r.pts, { pane: "ski", color: (C[r.cls] || C.ok).color, weight: 6, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false }));
      // No advice tags or regroup pins on the map (alex 2026-11-06: "that the advise off pls", "we need to be carefull
      // with the presition of the app"): the coloured line shows the terrain; the Watch out list says what's there.
    } else if (plan.pts.length > 1) {
      plan.layer.addLayer(L.polyline(plan.pts, { pane: "ski", color: "#fff", weight: 8, opacity: 0.9, interactive: false }));
      plan.layer.addLayer(L.polyline(plan.pts, { pane: "ski", color: plan.safe ? "#868e96" : "#e8590c", weight: 4, opacity: 1, dashArray: plan.on || plan.safe ? "10 6" : null, interactive: false }));
    }
    // A freeride or slackcountry line tapped while planning: lit up until it's added or passed over.
    if (plan.offer && !map.getPane("skiOffer")) { map.createPane("skiOffer").style.zIndex = 450; map.getPane("skiOffer").style.pointerEvents = "none"; }   // over the freeride and slackcountry lines
    if (plan.offer) for (const line of plan.offer.lines) {
      plan.layer.addLayer(L.polyline(line, { pane: "skiOffer", color: "#111", weight: 12, opacity: 0.55, lineCap: "round", interactive: false }));
      plan.layer.addLayer(L.polyline(line, { pane: "skiOffer", color: "#ffd43b", weight: 7, opacity: 1, lineCap: "round", interactive: false }));
    }
    // The points are labelled like the step list (Start, 1, 2 ... End). While planning they're bigger and can be
    // dragged to a new spot, on the flat map and in 3D (alex 2026-11-04: "I want to move it on the map").
    if (!map.getPane("skiSafePt")) { map.createPane("skiSafePt").style.zIndex = 660; map.getPane("skiSafePt").style.pointerEvents = "none"; }   // over the parking and hut pins
    const n = plan.pts.length, drag = plan.on;
    if (pins) plan.pts.forEach((q, i) => {
      const cls = `sk-safe-pt${drag ? " drag" : ""}${i ? "" : " first"}${plan.flash === i ? " new" : ""}`, name = esc(ptName(i, n, true));
      const m = L.marker(q, { pane: "skiSafePt", interactive: drag, draggable: drag, keyboard: false, autoPan: true,
        icon: L.divIcon({ className: "", html: `<div class="${cls}">${name}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] }) });
      if (drag) {
        m.on("click", (e) => L.DomEvent.stopPropagation(e));
        m.on("dragstart", () => { plan.dragAt = Date.now(); });
        m.on("dragend", () => { plan.dragAt = Date.now(); movePt(i, m.getLatLng()); });
      }
      plan.layer.addLayer(m);
      planGlPin(q, `<div class="${cls} gl">${name}</div>`, 5, drag ? (ll) => movePt(i, ll) : null);
    });
    if (!map.hasLayer(plan.layer)) plan.layer.addTo(map);
    aboveLayer.eachLayer((l) => l.bringToFront());   // the red "steep slopes above" dashes stay on top of the plan
  }
  window.addEventListener("tf:map3d", () => setTimeout(drawPlan, 0));
  // Its points come back in close (zoom 12) and go zoomed out.
  let planPinsWere = map.getZoom() >= 12;
  map.on("zoomend", () => { const z = map.getZoom() >= 12; if (z !== planPinsWere) { planPinsWere = z; if (plan.show && !plan.on) drawPlan(); } });
  // While planning, a bar on the map keeps the totals and the buttons in sight (on a phone the panel is lowered).
  const planBar = document.createElement("div");
  planBar.className = "sk-planbar"; planBar.hidden = true; planBar.setAttribute("role", "status");
  document.querySelector(".mapwrap").append(planBar);
  L.DomEvent.disableClickPropagation(planBar);
  function renderPlan() {
    const card = $("skPlan"), info = planNowInfo(), n = plan.pts.length;
    planBar.hidden = !plan.on;
    if (plan.on) {
      // Always says what a tap does next, on its own line on a phone (alex 2026-11-04: "Is hard to know when you can
      // place a point"). A tapped freeride or slackcountry line asks first: the whole line, or just a point there.
      const o = plan.offer;
      const msg = o ? `<b>${esc(o.name)}</b> <small>${esc(o.kind)}: add the whole line to your tour?</small>`
        : n === 0 ? `<b>Tap the map where you start</b><small>Start where you park. Tap a freeride or slackcountry line to add it all.</small>`
        : n === 1 ? `<b>Now tap where you want to go</b><small>Drag a point to move it.</small>`
        : `<b>${plan.wait ? esc(plan.wait) : info ? `${(info.total / 1000).toFixed(1)} km · ↑ ${fmtM(info.up)} · steepest ${Math.round(info.maxSlope)}°` : "Working it out…"}</b><small>Tap to add a point · drag a point to move it</small>`;
      // Or typed in plain words (alex 2026-11-07: "When I click plan a route I want to be able to ask what I want to plan"):
      // Ask (ask.js) reads the plan of the day and makes the tour from it.
      const askRow = !o && n === 0 && window.tfAsk ? `<form class="pb-ask" role="search"><input type="search" enterkeyhint="go" autocomplete="off" aria-label="Type your plan" placeholder="💬 Or type your plan: start at…, ski…, finish…"><button type="submit">Plan it</button></form>` : "";
      const was = planBar.querySelector(".pb-ask input"), wasQ = was ? was.value : "", wasF = was && document.activeElement === was;   // typing survives a redraw
      planBar.innerHTML = `<div class="pb-msg"><i class="pb-dot${o ? " line" : ""}${plan.wait && !o ? " busy" : ""}" aria-hidden="true"></i><span>${msg}</span></div>
        <div class="pb-btns">${o ? `<button type="button" data-p="line" class="go">＋ Add line</button><button type="button" data-p="point">Just a point</button><button type="button" data-p="nope" aria-label="Neither">✕</button>`
          : `<button type="button" data-p="safe" class="safe" aria-pressed="${plan.safe}" title="Find a way between your points that keeps off steep and exposed slopes">${plan.safe ? "Less exposed: on" : "Less exposed: off"}</button><button type="button" data-p="undo" aria-label="Undo"${plan.hist.length || n ? "" : " disabled"}>↶ Undo</button><button type="button" data-p="done" class="go">✓ Done</button>`}</div>${askRow}`;
      const af = planBar.querySelector(".pb-ask");
      if (af && wasQ) { const i = af.querySelector("input"); i.value = wasQ; if (wasF) i.focus(); }
      if (af) af.addEventListener("submit", (e) => { e.preventDefault(); const i = af.querySelector("input"), q = i.value.trim(); i.blur(); window.tfAsk.open(q, { plan: true }); });
      planBar.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
        const p = b.dataset.p;
        if (p === "undo") planUndo();
        else if (p === "safe") setSafe(!plan.safe);
        else if (p === "line") { plan.offer = null; renderPlan(); o.add(); }
        else if (p === "point") { plan.offer = null; planAdd(o.at); }
        else if (p === "nope") { plan.offer = null; drawPlan(); renderPlan(); }
        else setPlanning(false);
      }));
    }
    $("skPlanBtn").setAttribute("aria-pressed", String(plan.on));
    $("skPlanBtn").textContent = plan.on ? "✓ Done planning" : n > 1 ? "✎ Edit my tour" : "✎ Plan a tour";
    // ＋ Plan a new tour and 📂 Saved tours sit with ✎ Plan a tour at the top of Routes (alex 2026-11-07, with a drawing
    // of the tour card: "should it go there?"), not on the tour card.
    const cnt = tours().length;
    $("skNewBtn").hidden = plan.on || n < 2;
    $("skToursBtn").hidden = !cnt;
    $("skToursBtn").textContent = `📂 Saved tours (${cnt})`;
    card.hidden = !plan.on && n < 2 && !plan.wait && !plan.fail;
    if (card.hidden) return;
    if (n > 1 && !info && !plan.wait) warmPlanNow();
    if (info && !plan.on && plan.tour) { const t = tourOf(); if (t && t.km == null && tourSame(t)) { keepTour(false); return; } }   // its length and climb, now known
    const sum = n < 2 ? "" : !info ? `<p>Working out heights and slopes…</p>`
      : `<p><b>${(info.total / 1000).toFixed(1)} km</b> · ↑ ${fmtM(info.up)} · ↓ ${fmtM(info.down)} · top ${fmtM(info.max)}</p>
        <p>Steepest ${Math.round(info.maxSlope)}° · ${info.km30 >= 0.05 ? `<b>${info.km30.toFixed(1)} km on 30°+ slopes</b>` : info.maxSlope >= 30 ? "only short bits on 30°+ slopes" : "no 30°+ slopes under it"}${info.above >= 0.05 && !safePath() ? ` · <b>${info.above.toFixed(1)} km under steep slopes</b>` : ""}</p>`;
    card.innerHTML = `${plan.on ? `<p><b>Tap the map</b> to add each point of your tour: ${plan.safe ? "where you start, then where you want to go (add more points to go a certain way). The Less exposed way finds a line between them." : "up the skin track, then the way down."} ${n ? "" : "Start where you park."}</p>` : `<p><b>${safePath() ? "Your tour, less exposed way" : "Your planned tour"}</b></p>`}
      ${sum}
      ${tourRow(n)}
      <div class="sk-row"><button type="button" class="btn sk-safebtn" id="skSafeBtn" aria-pressed="${plan.safe}">${plan.safe ? "Less exposed way: on" : "Find a less exposed way"}</button></div>
      ${safeHtml()}
      <div class="sk-row">${plan.on && n ? `<button type="button" class="btn" id="skPlanUndo">↶ Undo</button>` : ""}${n ? `<button type="button" class="btn" id="skPlanClear">Clear</button>` : ""}${!plan.on && n > 1 ? `<button type="button" class="btn" id="skPlanMap">${plan.show ? "Hide from map" : "Show on map"}</button><button type="button" class="btn" id="skPlanShow">Show details</button>` : ""}</div>
      ${safePath() ? "" : ptsHtml()}`;
    const u = $("skPlanUndo"); if (u) u.addEventListener("click", planUndo);
    const c = $("skPlanClear"); if (c) c.addEventListener("click", () => { if (plan.pts.length > 2 && !tourSame(tourOf()) && !confirm("Clear your planned tour?")) return; snap(); plan.pts = []; plan.safe = false; store.set("skiSafe", false); setTour(null); planChanged(); });
    tourWire(card);   // the next tour starts safest
    const sh = $("skPlanShow"); if (sh) sh.addEventListener("click", () => { plan.show = true; drawPlan(); const r = planRoute(); if (r) select(r, true); });
    const pm = $("skPlanMap"); if (pm) pm.addEventListener("click", () => {
      plan.show = !plan.show; drawPlan(); renderPlan();
      if (plan.show) { const r = planRoute(); if (r) map.fitBounds(r.bounds, { padding: [30, 30], maxZoom: 15 }); }
    });
    $("skSafeBtn").addEventListener("click", () => setSafe(!plan.safe));
    // A tap on a point or step shows it up close (alex 2026-11-05: "i wanted to have a better view of the point you
    // click on to see it better on the map"; before, the map only slid over at the zoom it had, the point stayed small
    // and far): a 1 km square around it fills what the phone sheet leaves showing, in 3D tilted 55° and turned to
    // the side it's seen from best, not from behind a peak (alex: "make sure you are facing the point"), like a search
    // result (place-search.js go, map3d.js turnToSee).
    card.querySelectorAll("[data-safe-at]").forEach((li) => li.addEventListener("click", () => {
      const [la, lo] = li.dataset.safeAt.split(",").map(Number), ps = window.tfPlaceSearch;
      // (a phone sheet pulled all the way up comes down to half, so there's map to see the point on)
      const pad = window.tfMapPad ? window.tfMapPad() : null, tall = pad && pad.br[1] > innerHeight * 0.6;
      if (ps && ps.go) ps.go({ lat: la, lon: lo }, { km: 1, maxZoom: 16, sheet: tall ? "half" : false });
      else map.setView([la, lo], 16);
    }));
    const ag = $("skSafeAgain"); if (ag) ag.addEventListener("click", () => { plan.path = null; planChanged(); });
    // Reorder the points from the list (alex 2026-11-04: "make it so we can change the other way"): swap a point with
    // the one above or below, or reverse the whole tour; the safest way is found again in the new order.
    card.querySelectorAll("[data-mv]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const [i, d] = b.dataset.mv.split(",").map(Number), j = i + d;
      if (j < 0 || j >= plan.pts.length) return;
      snap();
      [plan.pts[i], plan.pts[j]] = [plan.pts[j], plan.pts[i]];
      planChanged();
    }));
    // Delete a point (alex 2026-11-04: "make it so i can delete point"); the way is found again without it.
    card.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      snap();
      plan.pts.splice(+b.dataset.del, 1);
      planChanged();
    }));
    const rv = $("skSafeRev"); if (rv) rv.addEventListener("click", () => { snap(); plan.pts.reverse(); planChanged(); });
    // ＋ Add a point under End (alex 2026-11-05: "i want to add point"): back to tapping the map; the point tapped is the
    // new End, and the way to it is found like the others. (A point between two others: drag the line, or move it up.)
    card.querySelectorAll("[data-add-pt]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!plan.on) setPlanning(true);
      if (window.tfSnapTo) setTimeout(() => window.tfSnapTo("peek"), 0);
      window.tfToast && window.tfToast("Tap the map where you want to go next: it becomes the new End.");
    }));
  }
  // ---------- saved tours ----------
  // alex 2026-11-07: "once you are done planning a tour make it so we can save it and start planning another tour if we
  // want". ★ Save this tour (with a name) keeps it in tf:skiTours, on this phone and, signed in, on the account
  // (account.js); ＋ Plan a new tour starts again from nothing. Saved tours are in the Saved tab (and from the tour card);
  // opening one puts it back on the map to edit or follow. Only the points are kept: a less exposed way is found again
  // with that day's forecast when it's opened, never shown with an old day's danger.
  const tours = () => store.get("skiTours", []);
  // (or, after an Undo or from another device, the saved tour with exactly these points)
  const tourOf = () => (plan.tour && tours().find((t) => t.id === plan.tour)) || (plan.pts.length > 1 && tours().find((t) => JSON.stringify(t.pts) === planKey())) || null;
  const tourSame = (t) => !!t && JSON.stringify(t.pts) === planKey() && !!t.safe === !!plan.safe;
  const setTour = (id) => { plan.tour = id; plan.naming = false; store.set("skiPlanTour", id); };
  const tourDay = (at) => new Date(at).toLocaleDateString(window.tfLang && window.tfLang.lang === "fr" ? "fr-CA" : "en-CA", { month: "short", day: "numeric" });
  // A first name for it: the lines it skis (Ask's or tapped freeride lines), else the day it was planned.
  function tourName() {
    const names = [...new Set(plan.pts.map((p) => p[2] && p[2].name).filter(Boolean))];
    const n = names.join(", ");
    return n ? (n.length > 48 ? n.slice(0, 46) + "…" : n) : `${window.tfLang && window.tfLang.lang === "fr" ? "Sortie" : "Tour"} ${tourDay(Date.now())}`;
  }
  function tourRow(n) {
    const cnt = tours().length;
    if (plan.on && n === 0 && cnt) return `<div class="sk-row"><button type="button" class="btn" data-tour="list">📂 Or open a saved tour (${cnt})</button></div>`;
    if (plan.on || n < 2) return "";
    const t = tourOf(), same = tourSame(t);
    if (plan.naming) return `<form class="sk-tourname" id="skTourForm"><label for="skTourName">Name this tour</label>
        <input id="skTourName" type="text" maxlength="60" autocomplete="off" enterkeyhint="done" value="${esc(t ? t.n : tourName())}">
        <div class="sk-row"><button type="submit" class="btn primary">★ Save</button><button type="button" class="btn" data-tour="cancel">Cancel</button></div></form>`;
    // Kept by itself (alex 2026-11-07: "a lot of step to organize a plan for ski tour"): a tour is saved when it's made
    // (✓ Done, or Ask's Make this tour) under the lines it skis, and follows its edits; Rename is there if wanted.
    return `<div class="sk-tourrow">${same ? `<p class="sk-tour-ok"><span>${esc("✓ Saved as " + t.n)}</span> <button type="button" class="linkish" data-tour="rename">Rename</button></p>` : ""}
      ${same ? "" : `<div class="sk-row"><button type="button" class="btn primary" data-tour="save">${t ? "★ Save changes" : "★ Save this tour"}</button></div>`}</div>`;
  }
  function tourWire(card) {
    const f = card.querySelector("#skTourForm");
    if (f) {
      const i = f.querySelector("input");
      setTimeout(() => { i.focus(); i.select(); }, 30);
      f.addEventListener("submit", (e) => { e.preventDefault(); saveTour(i.value); });
    }
    card.querySelectorAll("[data-tour]").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      const a = b.dataset.tour;
      if (a === "save") { const t = tourOf(); saveTour(t ? t.n : tourName()); }   // one tap: named after its lines (Rename after)
      else if (a === "rename") { plan.naming = true; renderPlan(); }
      else if (a === "cancel") { plan.naming = false; renderPlan(); }
      else if (a === "new") newTour();
      else if (a === "list") showTours();
    }));
  }
  function saveTour(name, quiet) {
    if (plan.pts.length < 2) return;
    const old = tourOf(), info = planNowInfo(), now = Date.now(), b = planRoute().bounds;
    const t = { id: old ? old.id : "t" + now.toString(36), n: String(name || "").trim().slice(0, 60) || tourName(), pts: JSON.parse(planKey()), safe: !!plan.safe, at: old ? old.at : now, ed: now,
      bb: [+b.getSouth().toFixed(5), +b.getWest().toFixed(5), +b.getNorth().toFixed(5), +b.getEast().toFixed(5)] };
    if (info) Object.assign(t, { km: +(info.total / 1000).toFixed(1), up: Math.round(info.up), down: Math.round(info.down), top: Math.round(info.max) });
    store.set("skiTours", [t, ...tours().filter((x) => x.id !== t.id)].slice(0, 50));
    setTour(t.id);
    renderPlan(); renderTours();
    if (quiet && old) return;   // an edit of a kept tour: no toast each time
    window.tfToast && window.tfToast(window.tfAccount && window.tfAccount.user ? "Tour saved: it's in Saved, on all your devices." : "Tour saved: it's in Saved.");
  }
  // A tour is kept as soon as it's made (✓ Done, Ask's Make this tour: force), then follows its edits (a point moved,
  // deleted or swapped on the card, Less exposed way on or off, Undo) without a Save tap. Its length and climb are
  // added once they're worked out. A tour deleted from Saved while on the map isn't put back until it's changed.
  function keepTour(force) {
    if (plan.on || plan.pts.length < 2 || planKey() === plan.noKeep) return;
    const t = tourOf();
    if (!force && !(plan.tour && t)) return;
    if (tourSame(t) && (t.km != null || !planNowInfo())) { if (plan.tour !== t.id) setTour(t.id); return; }
    saveTour(t ? t.n : tourName(), true);
  }
  // A new tour from nothing (the one before stays in Saved if it was saved; Undo brings it back if it wasn't).
  function newTour() {
    if (plan.pts.length > 1 && !tourSame(tourOf()) && !confirm("This tour isn't saved. Start a new one anyway?")) return;
    snap();
    plan.pts = []; plan.fail = ""; plan.safe = false; store.set("skiSafe", false);
    setTour(null);
    planChanged();
    setPlanning(true);
    window.tfToast && window.tfToast("New tour: tap the map where you start.");
  }
  function openTour(id) {
    const t = tours().find((x) => x.id === id);
    if (!t) return;
    if (plan.pts.length > 1 && !tourSame(tourOf()) && JSON.stringify(t.pts) !== planKey() && !confirm("The tour on the map isn't saved. Open this one instead?")) return;
    if (sport !== "ski") setSport("ski");
    snap();
    plan.pts = JSON.parse(JSON.stringify(t.pts)); plan.fail = ""; plan.safe = !!t.safe; store.set("skiSafe", plan.safe);
    setTour(t.id);
    if (plan.on) setPlanning(false);
    plan.show = true;
    $("skTours").hidden = true;
    planChanged();
    if (t.bb) map.fitBounds([[t.bb[0], t.bb[1]], [t.bb[2], t.bb[3]]], { padding: [30, 30], maxZoom: 15 });
    if (window.tfSnapTo) setTimeout(() => window.tfSnapTo("half"), 0);
    if (window.tfPanelScrollTo) setTimeout(() => window.tfPanelScrollTo($("skPlan")), 60);
  }
  function delTour(id) {
    const t = tours().find((x) => x.id === id);
    if (!t || !confirm(`Delete "${t.n}"?`)) return;
    if (window.tfAccount && window.tfAccount.gone) window.tfAccount.gone("skiTours", id);   // so a sync doesn't bring it back
    store.set("skiTours", tours().filter((x) => x.id !== id));
    if (plan.tour === id || JSON.stringify(t.pts) === planKey()) { setTour(null); plan.noKeep = planKey(); }   // (kept off until it's changed)
    renderTours(); renderPlan();
  }
  // The list of saved tours (a card in the Skiing pane; the Saved tab and the tour card open it).
  function renderTours() {
    const el = $("skTours");
    if (!el || el.hidden) return;
    const l = tours();
    el.innerHTML = `<div class="sk-tours-h"><b>Saved tours</b><button type="button" class="btn" data-tours="close" aria-label="Close">✕</button></div>
      ${l.length ? `<ul class="sk-tours">${l.map((t) => `<li><button type="button" class="sk-tour-open" data-open-tour="${esc(t.id)}"><b>${esc(t.n)}</b><small>${t.km != null ? `${t.km.toFixed(1)} km · ↑ ${fmtM(t.up)} · ` : ""}${t.safe ? `<span>less exposed way</span> · ` : ""}${tourDay(t.ed || t.at)}</small></button><button type="button" class="sk-tour-del" data-del-tour="${esc(t.id)}" aria-label="Delete this tour">✕</button></li>`).join("")}</ul>`
        : `<p>No saved tours yet. Each tour you plan is kept here.</p>`}
      <div class="sk-row"><button type="button" class="btn primary" data-tours="new">＋ Plan a new tour</button></div>`;
  }
  function showTours() {
    const el = $("skTours");
    el.hidden = false; renderTours();
    if (window.tfSnapTo) setTimeout(() => window.tfSnapTo("half"), 0);
    setTimeout(() => { if (window.tfPanelScrollTo) window.tfPanelScrollTo(el); else el.scrollIntoView({ block: "start" }); }, 60);
  }
  $("skTours").addEventListener("click", (e) => {
    const o = e.target.closest("[data-open-tour]"); if (o) { openTour(o.dataset.openTour); return; }
    const d = e.target.closest("[data-del-tour]"); if (d) { e.stopPropagation(); delTour(d.dataset.delTour); return; }
    const b = e.target.closest("[data-tours]"); if (!b) return;
    if (b.dataset.tours === "close") $("skTours").hidden = true;
    else { $("skTours").hidden = true; newTour(); }
  });
  // Another device saved or deleted a tour (account.js sync).
  window.addEventListener("tf:settings-synced", () => { renderTours(); if (sport === "ski") renderPlan(); });
  // Undo goes back one change, whatever it was (a point added, moved, deleted, swapped, a line added, a clear).
  function snap() {
    plan.offer = null;
    plan.hist.push(JSON.stringify(plan.pts));
    if (plan.hist.length > 40) plan.hist.shift();
  }
  function planUndo() {
    plan.offer = null;
    if (plan.hist.length) plan.pts = JSON.parse(plan.hist.pop());
    else plan.pts.pop();
    planChanged();
  }
  // Dragging the end of an added line along it cuts the line there: the tour follows the line to that spot, then
  // goes on to the next point (alex 2026-11-04: "when i move a point that was put at the end of a line it mean that i
  // want to stop the line there and go to the next point"). The same at a line's start. Dropped away from the line,
  // the line is cut at its nearest spot and the tour goes on to where the point was dropped.
  function movePt(i, ll) {
    const q = plan.pts[i];
    if (!q) return;
    snap();
    const to = [+ll.lat.toFixed(6), +ll.lng.toFixed(6)], d = (a, b) => map.distance([a[0], a[1]], [b[0], b[1]]);
    // The spot on v nearest the drop: on segment j (v[j] to v[j + 1]), at p.
    const nearest = (v) => {
      const kx = Math.cos((to[0] * Math.PI) / 180);
      let best = { j: 0, p: v[0], far: Infinity };
      for (let j = 0; j + 1 < v.length; j++) {
        const a = v[j], b = v[j + 1], dx = (b[1] - a[1]) * kx, dy = b[0] - a[0], L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, (((to[1] - a[1]) * kx) * dx + (to[0] - a[0]) * dy) / L2)) : 0;
        const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], m = d(p, to);
        if (m < best.far) best = { j, p, far: m };
      }
      return best;
    };
    // The line on the leg into this point (it ends here), or else on the leg out of it (it starts here).
    const into = q[2] && q[2].via && q[2].via.length > 1 ? q : null, nx = plan.pts[i + 1], out = !into && nx && nx[2] && nx[2].via && nx[2].via.length > 1 ? nx : null;
    const own = into || out;
    if (own) {
      const v = own[2].via, here = q;   // this point sits at one end of v
      const atLast = d(v[v.length - 1], here) <= d(v[0], here);                   // which end
      const { j, p, far } = nearest(v), pt = [+p[0].toFixed(6), +p[1].toFixed(6)];
      const cut = atLast ? [...v.slice(0, j + 1), pt] : [pt, ...v.slice(j + 1)];
      if (map.distance(cut[0], cut[cut.length - 1]) > 30) {
        if (into) plan.pts[i] = [pt[0], pt[1], { ...q[2], via: cut }];
        else { plan.pts[i] = pt; plan.pts[i + 1] = [nx[0], nx[1], { ...nx[2], via: cut }]; }
        if (far > 60) plan.pts.splice(into ? i + 1 : i, 0, to);                   // then on to (or from) where it was dropped
        planChanged();
        return;
      }
    }
    plan.pts[i] = to;   // moved off an added line: a plain point
    planChanged();
  }
  function planChanged() {
    store.set("skiPlan", plan.pts);
    if (plan.noKeep && planKey() !== plan.noKeep) plan.noKeep = "";
    keepTour(false);
    clearTimeout(plan.timer);
    plan.fail = "";
    if (plan.safe && plan.pts.length > 1 && !safePath()) {
      plan.run++; plan.wait = "Finding a less exposed way…";
      drawPlan(); renderPlan();
      plan.timer = setTimeout(findSafe, 600);   // a quick run of taps works it out once
      return;
    }
    if (plan.pts.length < 2) { plan.run++; plan.wait = ""; }
    drawPlan();
    const r = planRoute();
    if (!r) {
      if (selected && selected.src === "plan") { selected = null; selToken++; $("skDetail").hidden = true; aboveLayer.clearLayers(); renderForecast(); }
      renderPlan(); return;
    }
    renderPlan();
    if (r.info) { select(r); return; }   // already worked out (🛡 Safest turned back on or off): at once
    plan.timer = setTimeout(() => select(r), 350);   // a quick run of taps works it out once
  }
  // ---------- 🛡 the safest way ----------
  // ski-route.js finds the way between the points with the least avalanche risk for today's forecast (or from the
  // best plowed parking to a spot, from the "This spot" card), with fish-route.js's grid and search.
  // Today's forecast where the tour starts, in the shape ski-route.js reads.
  async function avyFor(lat, lon) {
    if (!avy && !example && !avyErr) { try { await loadAvy(); } catch { /* no forecast file: planned as Considerable */ } }
    const a = avy || example ? areaAt(lat, lon) : null, f = a && a.forecast;
    const bands = a ? a.bands : DEFAULT_BANDS, expired = f && !example && f.validUntil && new Date(f.validUntil) < new Date();
    if (!f || !f.days || !f.days.length || expired) return { r: {}, mask: {}, bands, none: true };
    const d = dayOf(f) || {};
    return { r: { alp: d.alp || 0, tln: d.tln || 0, btl: d.btl || 0 }, mask: { ...a.mask }, bands, title: f.title || a.name || "", day: d.label || d.date || "", example: !!example,
      probs: (f.problems || []).map((p) => ({ type: p.type || "", aspects: p.aspects || [], elevations: p.elevations || [] })) };
  }
  // Today's weather signs for the safest way (ski-route.js wxF): Open-Meteo at the alpine height (the forecast's alpine
  // band, where slabs form) where the tour starts. { snowF, lee, rainTo, warm, snow24, snow72, maxW, wind } or
  // { none: true } when it can't be had (offline, Open-Meteo's daily limit): the route then reads the forecast only.
  async function routeWx(pt, av) {
    const ele = Math.round(((av.bands && av.bands.hi) || DEFAULT_BANDS.hi) + 150);
    try {
      const w = await Promise.race([weather(pt[0], pt[1], ele), new Promise((_, no) => setTimeout(() => no(new Error("slow")), 8000))]);
      const a = avyWeather(w, ele);
      if (!a) return { none: true };
      const snowF = a.snow24 >= 25 || a.snow72 >= 40 ? 1.6 : a.snow24 >= 10 || a.snow72 >= 20 ? 1.25 : 1;
      return { snowF, lee: a.lee, rainTo: a.rain >= 2 && a.fzMax > 0 ? a.fzMax : 0, warm: Math.round(a.warm), snow24: Math.round(a.snow24), snow72: Math.round(a.snow72), maxW: Math.round(a.maxW), ele };
    } catch { return { none: true }; }
  }
  // What's kept of a found way (on this device, with the points it was found for).
  const slimSafe = (out, key) => ({ key, level: out.level || "balanced", line: out.line, legs: out.legs || [], from: out.from, park: out.park || "", stats: out.stats, straight: out.straight, av: out.av, weigh: out.weigh, alts: out.alts || [], safe: out.safe || [], at: Date.now(),
    runs: out.runs.map((r) => ({ cls: r.cls, m: Math.round(r.m), at0: r.at0, at1: r.at1, pts: r.pts.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]), mid: [+r.mid[0].toFixed(6), +r.mid[1].toFixed(6)], maxDeg: r.maxDeg, band: r.band, asp: r.asp, hit: r.hit, src: r.src ? { ...r.src, at: undefined } : null })) });
  function gotSafe(out, key) {
    plan.path = slimSafe(out, key);
    store.set("skiPlanPath", plan.path);
    plan.wait = ""; plan.fail = "";
    drawPlan(); renderPlan();
    const r = planRoute();
    if (r) select(r, !plan.on);
  }
  // No way is drawn when today's danger anywhere on the tour's bands is High or Extreme, or there's no forecast to weigh
  // (alex 2026-11-06, "fix all those": Avalanche Canada's "not recommended" days; the points and terrain stay).
  function avyGate(av) {
    if (!av || av.none) return "nofc";
    const m = Math.max(av.r.alp || 0, av.r.tln || 0, av.r.btl || 0);
    return m >= 4 ? "high" : "";
  }
  async function findSafe() {
    const my = ++plan.run, pts = plan.pts.slice(), key = planKey();
    const say = (t) => { if (my === plan.run) { plan.wait = t; renderPlan(); } };
    // The person accepts once that the tour and its risks are theirs (risk.js); Cancel leaves the points, no way.
    if (window.tfRiskOk && !(await window.tfRiskOk("avy"))) { if (my === plan.run) { plan.wait = ""; renderPlan(); } return; }
    say("Finding a less exposed way…");
    try {
      await loadJs("ski-route");
      const av = await avyFor(pts[0][0], pts[0][1]);
      const gate = avyGate(av);
      if (gate) { if (my === plan.run) { plan.wait = ""; plan.fail = gate; plan.failAv = av; drawPlan(); renderPlan(); } return; }
      av.wx = await routeWx(pts[0], av);
      const out = await window.tfSkiRoute.route(pts, av, say);
      if (my !== plan.run) return;
      if (out.fail) { plan.wait = ""; plan.fail = out.fail; plan.failAt = out; drawPlan(); renderPlan(); return; }
      gotSafe(out, key);
    } catch (e) {
      if (my !== plan.run) return;
      plan.wait = ""; plan.fail = "net"; drawPlan(); renderPlan();
    }
  }
  // The "This spot" card's 🛡 Safest way here: from the best plowed parking within 9 km.
  async function safeTo(lat, lon) {
    const my = ++plan.run;
    clearTimeout(plan.timer);
    plan.safe = true; store.set("skiSafe", true);
    plan.pts = []; store.set("skiPlan", plan.pts); plan.fail = ""; setTour(null);
    if (selected && selected.src === "plan") { selected = null; selToken++; $("skDetail").hidden = true; aboveLayer.clearLayers(); }
    const say = (t) => { if (my === plan.run) { plan.wait = t; renderPlan(); } };
    say("Looking for a less exposed way in from a plowed road…");
    drawPlan();
    spotLayer.clearLayers(); spotLayer.addLayer(L.circleMarker([lat, lon], { radius: 9, color: "#fff", weight: 3, fillColor: "#2f9e44", fillOpacity: 1, interactive: false })); if (!map.hasLayer(spotLayer)) spotLayer.addTo(map);
    if (window.tfSnapTo) window.tfSnapTo("half");
    if (window.tfPanelScrollTo) window.tfPanelScrollTo($("skPlan"));
    if (window.tfRiskOk && !(await window.tfRiskOk("avy"))) { if (my === plan.run) { spotLayer.clearLayers(); plan.wait = ""; renderPlan(); } return; }
    try {
      await loadJs("ski-route");
      const av = await avyFor(lat, lon);
      const gate = avyGate(av);
      if (gate) { if (my === plan.run) { spotLayer.clearLayers(); plan.wait = ""; plan.fail = gate; plan.failAv = av; renderPlan(); } return; }
      av.wx = await routeWx([lat, lon], av);
      const out = await window.tfSkiRoute.fromRoad([lat, lon], av, say);
      if (my !== plan.run) return;
      spotLayer.clearLayers();
      if (out.fail) { plan.wait = ""; plan.fail = out.fail; renderPlan(); return; }
      plan.pts = [[+out.start[0].toFixed(6), +out.start[1].toFixed(6)], [+lat.toFixed(6), +lon.toFixed(6)]];
      store.set("skiPlan", plan.pts);
      gotSafe(out, planKey());
    } catch (e) {
      if (my !== plan.run) return;
      spotLayer.clearLayers();
      plan.wait = ""; plan.fail = "net"; renderPlan();
    }
  }
  function setSafe(on) {
    plan.safe = on; store.set("skiSafe", on);
    if (!on) { plan.run++; plan.wait = ""; plan.fail = ""; }
    planChanged();
  }
  const pct = (a, b) => Math.round((a / Math.max(1, b)) * 100);
  // Point names, the same on the map and in the list: Start, Point 1, Point 2 ... End (short: Start, 1, 2 ... End).
  const ptName = (i, n, short) => (i <= 0 ? "Start" : i >= n - 1 ? "End" : short ? String(i) : `Point ${i}`);
  // The route as a list, like MTB's Plan a route (alex 2026-11-04: "a list of the route like point 1 point 2 ... start
  // end", then "a list like we have for mtb ride"): the named tracks it uses in order (chips), then one row per stretch
  // (↗ skin up, ↘ ski down, → across, ↝ off trail) with its length and climb, the points (Start, 1, 2 ... End) between
  // them, and a ⚠ on the rows with steep or exposed ground (its !n on the map). A row's tap shows it on the map.
  function stepsHtml(sp, watch) {
    const legs = sp.legs || [], n = plan.pts.length;
    if (!legs.length) return "";
    const C = SAFE_CLS;
    const D = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
    const ud = (x) => [x.up >= 10 ? `↑${Math.round(x.up)}` : "", x.down >= 10 ? `↓${Math.round(x.down)}` : ""].filter(Boolean).join(" ");
    const svg = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const IC = { up: svg('<path d="M4 12 12 4M6 4h6v6"/>'), down: svg('<path d="M4 4l8 8M12 6v6H6"/>'), across: svg('<path d="M2 8h11M9 4l4 4-4 4"/>'), flag: svg('<path d="M4 14V2.5h8l-2 3 2 3H4"/>') };
    const watchNo = (s) => {   // the closest Watch out stretch to this step, so each step shows its own number
      let best = -1, bd = Math.max(300, s.m / 2);
      watch.forEach((w, i) => { const d = L.latLng(w.mid).distanceTo(s.mid); if (d < bd) { bd = d; best = i; } });
      return best >= 0 ? `${best + 1}` : "";
    };
    const hz = (s) => {
      if (s.worst === "ok" || s.worst === "mid") return "";
      const w = s.worst === "steep" ? `${s.maxDeg}° slope` : s.worst === "trap" ? "Terrain trap" : "Under steep slopes";
      const no = watchNo(s);
      return `<span class="ss-hz" style="--c:${C[s.worst].color}"><i>${no ? `!${no}` : "!"}</i>${w}${s.hzM && s.hzM < s.m * 0.6 ? ` · ${D(s.hzM)}` : ""}</span>`;
    };
    const row = (s) => {
      const climb = s.up >= 30 && s.up > s.down * 1.5, desc = s.down >= 30 && s.down > s.up * 1.5;
      const verb = climb ? "Skin up" : desc ? "Ski down" : "Traverse";
      const on = s.kind !== "off" ? (s.name ? esc(s.name) : s.kind === "road" ? "Road" : "Trail") : "Off trail";
      const bad = s.worst !== "ok" && s.worst !== "mid";
      return `<li class="ss-row${bad ? " hz" : ""}" style="--c:${(C[s.worst] || C.ok).color}" data-safe-at="${s.mid[0]},${s.mid[1]}"><span class="ss-ic">${climb ? IC.up : desc ? IC.down : IC.across}</span><span class="ss-t"><span><b>${verb}</b> <small>· ${on}</small></span>${hz(s)}</span><span class="ss-m">${D(s.m)}${ud(s) ? `<small>${ud(s)}</small>` : ""}</span></li>`;
    };
    const pt = (i) => {
      const q = plan.pts[i], mid = i && i < n - 1;
      return `<li class="ss-pt" data-safe-at="${q[0]},${q[1]}"><span class="ss-pin${mid ? "" : " end"}">${mid ? i : IC.flag}</span><span class="ss-t"><b>${esc(ptName(i, n))}</b>${i === 0 && sp.park ? `<small>${esc(sp.park)}</small>` : ""}</span><span class="ss-mv">${i > 0 ? `<button type="button" data-mv="${i},-1" aria-label="Move ${esc(ptName(i, n))} up">${IC.up.replace("M4 12 12 4M6 4h6v6", "M8 13V3M4 7l4-4 4 4")}</button>` : ""}${i < n - 1 ? `<button type="button" data-mv="${i},1" aria-label="Move ${esc(ptName(i, n))} down">${IC.up.replace("M4 12 12 4M6 4h6v6", "M8 3v10M4 9l4 4 4-4")}</button>` : ""}<button type="button" class="ss-del" data-del="${i}" aria-label="Delete ${esc(ptName(i, n))}">${IC.up.replace("M4 12 12 4M6 4h6v6", "M4 4l8 8M12 4l-8 8")}</button></span></li>`;
    };
    let html = pt(0), m = 0, up = 0, down = 0;
    legs.forEach((l, k) => { html += l.steps.filter((s) => s.m >= 40 || l.steps.length === 1).map(row).join("") + pt(k + 1); for (const s of l.steps) { m += s.m; up += s.up || 0; down += s.down || 0; } });
    // The named tracks in order, as MTB's "Trail → Trail" line.
    const names = [];
    for (const l of legs) for (const s of l.steps) if (s.name && s.m >= 100 && names[names.length - 1] !== s.name) names.push(s.name);
    const via = names.length ? `<p class="ss-names">Via ${names.slice(0, 8).map((x) => `<span>${esc(x)}</span>`).join(", ")}${names.length > 8 ? ` and ${names.length - 8} more` : ""}</p>` : "";
    // The totals the summary above and the route card show (heights every 25 m along the line), once they're in, so the
    // same tour never shows two climbs (alex 2026-11-04: 1,061 m above, 1090 m here).
    const inf = planNowInfo();
    if (inf) { m = inf.total; up = inf.up; down = inf.down; }
    const sum = `<div class="ss-sum"><div><b>${D(m)}</b><small>Distance</small></div><div><b>${Math.round(up)} m</b><small>Climb</small></div><div><b>${Math.round(down)} m</b><small>Descent</small></div></div>`;
    return `<div class="sk-sec"><h4>Your route</h4>${sum}${via}<ol class="ss-list">${html}</ol><button type="button" class="ss-add" data-add-pt><span aria-hidden="true">＋</span> Add a point</button></div>`;
  }

  // The tour's points, always in sight under Undo and Clear (alex 2026-11-04: "WE SHOULD BE ABLE TO SEE THE LIST AT
  // ALL TIME"): while the safest way is worked out, with it off, or when it couldn't be found. Same rows and buttons
  // (move up/down, delete, tap to go there) as the step list the safest way shows.
  function ptsHtml() {
    const n = plan.pts.length;
    if (!n) return "";
    const svg = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const up = svg('<path d="M8 13V3M4 7l4-4 4 4"/>'), dn = svg('<path d="M8 3v10M4 9l4 4 4-4"/>'), del = svg('<path d="M4 4l8 8M12 4l-8 8"/>'), flag = svg('<path d="M4 14V2.5h8l-2 3 2 3H4"/>');
    const km = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
    const rows = plan.pts.map((q, i) => {
      const mid = i > 0 && i < n - 1, name = ptName(i, n), o = q[2];
      const leg = i ? (o && o.via ? `along ${o.name || "the line"}` : `${km(map.distance([plan.pts[i - 1][0], plan.pts[i - 1][1]], [q[0], q[1]]))} from ${ptName(i - 1, n)}`) : "";
      return `<li class="ss-pt" data-safe-at="${q[0]},${q[1]}"><span class="ss-pin${mid ? "" : " end"}">${mid ? i : flag}</span><span class="ss-t"><b>${esc(name)}</b>${leg ? `<small>${esc(leg)}</small>` : ""}</span><span class="ss-mv">${i > 0 ? `<button type="button" data-mv="${i},-1" aria-label="Move ${esc(name)} up">${up}</button>` : ""}${i < n - 1 ? `<button type="button" data-mv="${i},1" aria-label="Move ${esc(name)} down">${dn}</button>` : ""}<button type="button" class="ss-del" data-del="${i}" aria-label="Delete ${esc(name)}">${del}</button></span></li>`;
    }).join("");
    return `<div class="sk-sec sk-pts"><h4>Your points</h4><ol class="ss-list">${rows}</ol>${plan.on ? "" : '<button type="button" class="ss-add" data-add-pt><span aria-hidden="true">＋</span> Add a point</button>'}</div>`;
  }
  function safeHtml() {
    if (!plan.safe) return "";
    if (plan.wait) return `<div class="sk-safe"><div class="sk-safe-wait">${esc(plan.wait)}</div></div>`;
    if (plan.fail === "far") { const f = plan.failAt || {}; return `<div class="sk-safe"><p><b>${esc(ptName(f.leg - 1, plan.pts.length))} to ${esc(ptName(f.leg, plan.pts.length))} is ${f.km} km in a straight line:</b> too far for one ski tour (12 km at most between two points). Put your points closer, or tap points along the way you want to go.</p></div>`; }
    if (plan.fail === "high" || plan.fail === "nofc") {
      const av = plan.failAv || {}, dg = (v) => `<span class="sk-dg"><i style="background:${DANGER[v || 0].color}"></i>${esc(DANGER[v || 0].label)}</span>`;
      return `<div class="sk-safe"><div class="sk-warn sk-est">${plan.fail === "high"
        ? `<b>No route drawn: avalanche danger is High or Extreme here today.</b> Avalanche Canada doesn't recommend backcountry travel in avalanche terrain at this danger, so the app doesn't draw a way. Your points stay on the map.
          <span class="sk-est-dg"><span>Avalanche danger${av.example ? " (example)" : " today"}:</span>${[["Alpine", av.r.alp], ["Treeline", av.r.tln], ["Below treeline", av.r.btl]].map(([n, v]) => `<span class="sk-est-b">${n} ${dg(v)}</span>`).join("")}</span>`
        : `<b>No route drawn: there's no avalanche forecast here today.</b> Without one, the app can't weigh the danger, so it doesn't draw a way. Your points stay on the map. Check ${siteLink(avySite(plan.pts[0] ? plan.pts[0][0] : map.getCenter().lat, plan.pts[0] ? plan.pts[0][1] : map.getCenter().lng))}.`}</div></div>`;
    }
    if (plan.fail) return `<div class="sk-safe"><p>${esc({ water: "That point is out on open water: move it to the shore.", noway: "Couldn't find a way between these points (cliffs or open water in the way, or too far apart). Move a point or add one between.",
      noroad: "No plowed road or parking within 9 km of this spot that the map knows of. Use ✎ Plan a tour and tap where you start.", net: "Couldn't get the terrain for this area. Check your connection and try again." }[plan.fail] || "")}</p></div>`;
    const sp = safePath();
    if (!sp) return plan.pts.length < 2 ? `<p class="sk-note">Tap where you start and where you want to go: the way between them stays off steep slopes, avoids today's avalanche problem aspects and keeps out from under slopes that could slide.</p>`
      : `<div class="sk-row"><button type="button" class="btn" id="skSafeAgain">Find a less exposed way between my points</button></div>`;
    const st = sp.stats, av = sp.av || {}, tot = Math.max(1, st.total), C = SAFE_CLS, sl = sp.straight || { total: 0, steep: 0, under: 0 };
    const chip = (v) => `<span class="sk-dg"><i style="background:${DANGER[v || 0].color}"></i>${esc(DANGER[v || 0].label)}</span>`;
    const K = { ok: "#ced4da", mid: "#868e96", steep: "#e03131", under: "#ffa8a8", trap: "#a61e4d" };   // card bar: greys + reds only
    const LV = { direct: ["#2f9e44", "Direct", "Low or Moderate danger" ], balanced: ["#f79218", "Balanced", "Considerable danger"], strict: ["#ef1c29", "Most careful", "High or Extreme danger"] }[sp.level || "balanced"];
    const lvTxt = { direct: "The way up takes the least exposed line it finds. Skiing down, it takes slopes up to about 35° when that saves a long way round, while staying off the steepest ground and out from under big slopes where it can.",
      balanced: "The way up takes the least exposed line it finds. Skiing down, it goes round 30°+ slopes and steep slopes above when there's a sensible way, and takes the shortest steep section when there isn't.",
      strict: "Stays off 30°+ slopes and out from under steep slopes, however much longer that makes it. If there's no way round, reconsider the trip." }[sp.level || "balanced"];
    const lvHtml = `<div class="sk-mode" style="--c:${LV[0]}"><div class="sk-mode-h"><b>${LV[1]} route</b><span>${av.none ? "No rating: planned as Moderate" : LV[2]}</span></div><p>${lvTxt}</p></div>`;
    const fc = av.none ? `<div class="sk-warn"><b>No avalanche forecast here ${example ? "" : "today"}.</b> Planned as for Moderate danger (a direct route); early and late in the season, conditions can change fast. Check ${siteLink(avySite(sp.line[0][0], sp.line[0][1]))} before you go.</div>`
      : `<p class="sk-lbl">Avalanche forecast${av.example ? " · Example" : ""}</p><div class="sk-fc-g"><div>Alpine${chip(av.r.alp)}</div><div>Treeline${chip(av.r.tln)}</div><div>Below treeline${chip(av.r.btl)}</div></div><p class="sk-fc-r">${esc(av.title)}${av.day ? ` · ${esc(av.day)}` : ""}</p>`;
    const kinds = ["ok", "mid", "steep", "under", "trap"].filter((k) => st[k] >= 5);
    const why = [];
    why.push(`<b>${pct(st.ok + st.mid, tot)}%</b> of the way is under 30°${st.ok / tot > 0.5 ? `, ${pct(st.ok, tot)}% under 25°` : ""}.`);
    const now = st.steep + st.under + st.trap, then = sl.steep + sl.under;
    if (sl.total && then - now >= 50) why.push(`Straight across would be ${fmtM(sl.steep)} on 30°+ slopes and ${fmtM(sl.under)} under steep slopes. This way: ${now >= 5 ? `${fmtM(st.steep)} and ${fmtM(st.under + st.trap)}` : "none"}.`);
    // Time exposed, and how the search weighs it against a longer way (alex 2026-11-05: "sometime it safer to go down
    // traverse on flat and go up again instead to stay expose on a slope").
    const mins = (sec) => { const m = Math.max(1, Math.round(sec / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
    if (st.sec > 0) {
      const ex = st.steepSec + st.underSec;
      why.push(ex >= 30 ? `<b>About ${mins(ex)} exposed</b> of ${mins(st.sec)} on the move: ${[st.steepSec >= 30 ? `${mins(st.steepSec)} on 30°+ slopes` : "", st.underSec >= 30 ? `${mins(st.underSec)} under steep slopes` : ""].filter(Boolean).join(", ")}. Time on or under a slope that could slide is what it keeps short.`
        : `<b>Next to no time exposed</b> in ${mins(st.sec)} on the move: ${st.steep + st.under + st.trap >= 5 ? "only short bits on or under steep slopes" : "no 30°+ slopes and nothing steep above"}, as far as the terrain map can see.`);
    }
    const wg = sp.weigh;
    if (wg) why.push(`How it weighs it today, on skins: 1 min on a 30-35° slope counts like ${Math.round(wg.s30)} min on gentle ground, 35-40° like ${Math.round(wg.s35)} min (${Math.round(wg.side35)} min sidehilling across it), under a steep slope like ${Math.round(wg.under)} min. So it drops to flatter ground, crosses and climbs back when that's less time exposed, even if it's longer.`);
    // Today's weather in the risk (routeWx).
    const wx = av.wx;
    if (wx && !wx.none) {
      const bits = [];
      if (wx.snowF > 1) bits.push(`${wx.snow24} cm of new snow in the last day, ${wx.snow72} cm in 3 days: every slope counts ${wx.snowF}x`);
      if (wx.lee && wx.lee.length) bits.push(`wind up to ${wx.maxW} km/h with snow to move: ${wx.lee.map((x) => SAFE_ASP[x]).join(", ")}-facing slopes in the alpine and at treeline count 1.5x (wind slabs)`);
      if (wx.rainTo) bits.push(`rain on snow up to about ${fmtM(wx.rainTo)}: 1.5x below that`);
      if (wx.warm >= 3) bits.push(`warming to ${wx.warm}°C at ${fmtM(wx.ele)}: sunny slopes count up to 1.4x`);
      why.push(bits.length ? `Today's weather is in it too (at ${fmtM(wx.ele)}): ${bits.join("; ")}.` : `Today's weather (at ${fmtM(wx.ele)}) shows no new snow, wind loading, rain or warming to add.`);
    } else if (wx && wx.none) why.push("Today's weather couldn't be loaded, so only the avalanche forecast is in it: check for new snow, wind and warming yourself.");
    for (const x of sp.alts || []) why.push(`Leaves the usual skin track (${esc(x.name)}) before its crux: that track sidehills ${fmtM(x.theirs.steep)} on 30°+ slopes, about ${mins(x.theirs.expo)} exposed. This way: ${x.mine.steep >= 20 ? fmtM(x.mine.steep) : "none"}, about ${mins(x.mine.expo)}${x.mine.sec - x.theirs.sec >= 120 ? `, for about ${mins(x.mine.sec - x.theirs.sec)} more on the move` : ""}.`);
    if (!av.none && (av.probs || []).length) {
      const parts = (av.probs || []).filter((p) => p.aspects.length && p.aspects.length < 8).map((p) => `${p.aspects.map((x) => x.toUpperCase()).join(" ")} in the ${p.elevations.map((b) => ({ alp: "alpine", tln: "treeline", btl: "below treeline" }[b] || b)).join(", ")} (${esc(p.type)})`);
      if (parts.length) why.push(`Keeps off today's problem aspects where it can: ${parts.join("; ")}.${st.hit >= 5 ? ` Still ${fmtM(st.hit)} on them.` : ""}`);
      if ((av.probs || []).some((p) => p.aspects.length >= 8)) why.push("One of today's problems is on every aspect, so slope angle and what's above matter most.");
    }
    if (sp.park) why.push(`${esc(sp.park)}: the closest plowed road for a less exposed way in (logging roads past it aren't plowed, they're part of the ski).`);
    const watch = safeWatch(sp);
    const say = (r) => {
      const asp = r.asp >= 0 ? `${SAFE_ASP[r.asp]}-facing` : "";
      const also = r.cls === "steep" && (r.by.under || 0) >= 30 ? ` Part of it is also under steeper slopes${r.src ? ` (${r.src.deg}° ${SAFE_ASP[r.src.asp]}-facing above)` : ""}.` : r.cls === "under" && (r.by.steep || 0) >= 30 ? ` About ${fmtM(r.by.steep)} of it is on 30°+ ground itself.` : "";
      return say1(r, asp) + also;
    };
    const say1 = (r, asp) => {
      if (r.cls === "steep") return `<b>${fmtM(r.m)} on slopes up to ${r.maxDeg}°</b>${asp ? `, ${asp}` : ""} (${SAFE_BAND[r.band]})${r.hit ? ", <b>on an aspect in today's avalanche problems</b>" : ""}..`;
      if (r.cls === "trap") return `<b>${fmtM(r.m)} in a gully or creek bed under steep slopes</b>${r.src ? ` (${r.src.deg}° ${SAFE_ASP[r.src.asp]}-facing, ${r.src.up > 0 ? `${r.src.up} m above` : "above"})` : ""}: a terrain trap.`;
      return `<b>${fmtM(r.m)} under steep slopes</b>${r.src ? `: a ${r.src.deg}° ${SAFE_ASP[r.src.asp]}-facing slope ${r.src.up > 0 ? `${r.src.up} m above` : "above"}${r.src.hit ? ", on a problem aspect today" : ""}` : ""}.`;
    };
    // Top of every planned tour (Safest way liability review 2026-11-06, alex picked "Rename + safer wording"): what it
    // is, that it can't see today's snowpack, that the call is theirs, and today's danger, before any step of the way.
    const topWarn = `<div class="sk-warn sk-est"><b>A computer's estimate, not a safe route.</b> It can't see today's snowpack, cornices or wind loading. You decide whether and where to go.
      <span class="sk-est-dg">${av.none ? "No avalanche forecast here today." : `<span>Avalanche danger${av.example ? " (example)" : " today"}:</span>${[["Alpine", av.r.alp], ["Treeline", av.r.tln], ["Below treeline", av.r.btl]].map(([n, v]) => `<span class="sk-est-b">${n} ${chip(v)}</span>`).join("")}`}</span></div>`;
    return `<div class="sk-safe">
      ${topWarn}
      ${stepsHtml(sp, watch)}
      <details class="sk-sec sk-fold"><summary><h4>Why this way</h4><span style="--c:${LV[0]}">${LV[1]} route</span></summary>
        ${lvHtml}
        ${fc}
        <p class="sk-lbl">Terrain on this route</p>
        <div class="sk-safe-bar" aria-hidden="true">${kinds.map((k) => `<i style="width:${(st[k] / tot) * 100}%;background:${K[k]}"></i>`).join("")}</div>
        <div class="sk-safe-key">${kinds.map((k) => `<span style="--c:${K[k]}">${C[k].label}<b>${fmtM(st[k])}</b></span>`).join("")}</div>
        <ul class="sk-safe-why">${why.map((t) => `<li>${t}</li>`).join("")}</ul>
      </details>
      ${watch.length ? `<details class="sk-sec sk-fold"><summary><h4>Watch out</h4><span style="--c:${C[watch.some((r) => r.cls === "steep" || r.cls === "trap") ? "steep" : "under"].color}">${watch.length} ${watch.length === 1 ? "spot" : "spots"}</span></summary><ol class="sk-safe-watch">${watch.map((r, i) => `<li style="--c:${(C[r.cls] || C.ok).color}" data-safe-at="${r.mid[0]},${r.mid[1]}"><i>!${i + 1}</i><span>${say(r)}</span></li>`).join("")}</ol></details>`
        : (sp.legs || []).some((l) => l.steps.some((s) => s.worst === "steep" || s.worst === "under" || s.worst === "trap"))
          // Short bits (under 40 m) still show "!" on their step: the card says so instead of "no 30°+ slopes" (alex's
          // recording 2026-11-05: a step read "33° slope · 30 m" over "No 30°+ slopes on this route").
          ? `<div class="sk-sec"><p class="sk-safe-ok">Only short steep bits (under 40 m each), marked ! in the steps above. Nothing longer on 30°+ slopes or under steep slopes, as far as the terrain map can see.</p></div>`
          : `<div class="sk-sec"><p class="sk-safe-ok">No 30°+ slopes and no steep slopes above on this route, as far as the terrain map can see.</p></div>`}
      <div class="sk-row"><button type="button" class="btn" id="skSafeRev">⇅ Reverse the tour</button><button type="button" class="btn" id="skSafeAgain">↻ Find again</button></div>
      <p class="sk-safe-dis"><b>Not a substitute for avalanche training.</b> This is a planning aid based on a terrain model (10 to 30 m) and the regional forecast. It can't see cornices, wind loading, small slopes, trees or today's snowpack, and a forecast covers a whole region. How much a minute on a steep slope weighs against a longer way is judgment taken from avalanche course rules of thumb, not measured odds. Take an avalanche course (AST 1), carry a transceiver, probe and shovel with partners who know how to use them, read the full forecast on ${siteLink(avySite(sp.line[0][0], sp.line[0][1]))}, and make your own decisions in the field.</p>
      
    </div>`;
  }
  // A line put in a tour never doubles back (noback.js): a line made of pieces joined end to end, or drawn with a knot,
  // is cut where it turns round or loops, so the tour doesn't follow it there and back (alex 2026-11-05).
  const noBackLine = (line) => (window.tfNoBack && line && line.length > 2 ? window.tfNoBack.clean(line, { loops: true }) : line);
  function planVia(line, name) {
    line = noBackLine(line);
    snap();
    const a = line[0], z = line[line.length - 1], last = plan.pts[plan.pts.length - 1];
    if (last && map.distance([last[0], last[1]], a) < 60) plan.pts[plan.pts.length - 1] = last[2] ? last : [a[0], a[1]];
    else plan.pts.push([a[0], a[1]]);
    plan.pts.push([z[0], z[1], { via: line, name }]);
    if (!plan.on) setPlanning(true);
    planChanged();
    const n = plan.pts.length;
    window.tfToast && window.tfToast(`${name} is in your tour, from ${ptName(n - 2, n)} to ${ptName(n - 1, n)}.`);
  }
  function planAdd(ll) {
    if (plan.dragAt && Date.now() - plan.dragAt < 400) return;   // the end of dragging a point, not a tap
    if (plan.offer) { plan.offer = null; drawPlan(); renderPlan(); }
    if (map.getZoom() < 12) {   // too far out to place a point well: zoom in there first
      map.setView(ll, 13);
      window.tfToast && window.tfToast("Zoomed in there: tap again to place your point.");
      return;
    }
    snap();
    plan.pts.push([+ll.lat.toFixed(6), +ll.lng.toFixed(6)]);
    plan.flash = plan.pts.length - 1;
    setTimeout(() => { plan.flash = -1; }, 600);
    planChanged();
  }
  // While planning, a freeride or slackcountry line tapped on the map (freeride.js, slackcountry.js) lights up and the
  // bar asks: add the whole line, or just a point there (alex 2026-11-04: "make it so you can select and add a freeride
  // line or a slackcountry route"). o: { name, kind, at (latlng), lines ([[lat, lon]...] list), add() }.
  function planOffer(o) {
    if (!plan.on) return;
    if (plan.dragAt && Date.now() - plan.dragAt < 400) return;
    plan.offer = o;
    drawPlan(); renderPlan();
  }
  // A ski route (a freeride line) in the tour as drawn, from where it's skied (a skin track from its bottom).
  function planRouteLine(r, group, title) {
    return routeInfo(group || [r]).then((info) => {
      let line = info.pts.map((p) => [+p.lat.toFixed(6), +p.lon.toFixed(6)]);   // from its lower end
      if (!isUphill(r)) line.reverse();                                          // skied from the top
      if (line.length > 300) { const k = Math.ceil(line.length / 300); line = line.filter((_, i) => i % k === 0 || i === line.length - 1); }
      planVia(line, title || nameOf(r) || "This line");
    }, () => { window.tfToast && window.tfToast("Couldn't load the line's heights. Try again."); });
  }
  function setPlanning(on) {
    if (plan.on === on) return;
    plan.on = on;
    plan.offer = null;
    // A new tour (no way drawn yet) starts with the Less exposed way off; people turn it on for each tour (alex 2026-11-06,
    // "fix all those" in the liability review, replacing the 2026-11-05 "on by default" rule).
    if (on && plan.pts.length < 2 && plan.safe) { plan.safe = false; store.set("skiSafe", false); }
    if (on) plan.show = true;   // just planned: it stays on the map until Hide from map (or the app is opened again)
    // The map's layers stay as they are while planning (alex 2026-11-04: "dont put the slope angle layer by default when
    // you plan a tour"); Slope angle is in Layers for whoever wants it.
    map.getContainer().classList.toggle("sk-planning", on);
    if (on && map.getZoom() < 12) map.setZoom(13);
    if (!on) keepTour(true);   // ✓ Done: the tour is saved, no extra Save tap
    // After the tap's own click reaches the panel (which raises a lowered sheet).
    if (window.tfSnapTo) setTimeout(() => window.tfSnapTo(on ? "peek" : plan.pts.length > 1 ? "half" : "peek"), 0);
    drawPlan(); renderPlan();
    if (plan.safe && plan.pts.length > 1 && !safePath() && !plan.wait) planChanged();   // points from another device, or from before 🛡 was on
    if (!on && selected && selected.src === "plan" && window.tfPanelScrollTo) window.tfPanelScrollTo($("skPlan"));
    window.dispatchEvent(new CustomEvent("tf:ski-plan", { detail: { on } }));   // cabin-trip.js: a way in drawn by hand
  }
  // ---------- this spot: a tap on the map away from everything ----------
  // alex 2026-10-27: "click anywhere on the map and see information about that terrain, avalanche risk, slope angle,
  // last snow". The ground there (slope, the way it faces, height, steep slopes above, gullies) from the same terrain
  // tiles as the slope shading; the avalanche forecast for that band and area; new snow, wind and warming from
  // Open-Meteo at that height (one ask per tap, kept 30 min for the same spot); the closest route, hut and snow
  // station. Pins and lines keep their own cards (their taps stop before the map).
  const spotLayer = L.layerGroup();
  let spotSeq = 0, spot = null;
  const SPOT_RING = 60;   // m: the steepest ground this close is shown too (the terrain tiles are ~15 m a pixel)
  const ASPECT_NAME = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
  const slopeCol = (deg) => { let c = "var(--chip)"; for (const b of SLOPE) if (deg >= b[0]) c = b[2]; return c; };
  function closeSpot() {
    spotSeq++; spot = null;
    $("skSpot").hidden = true;
    spotLayer.clearLayers();
    if (map.hasLayer(spotLayer)) map.removeLayer(spotLayer);
  }
  async function spotGround(lat, lon) {
    const dLat = SPOT_RING / 111320, dLon = dLat / Math.cos((lat * Math.PI) / 180);
    const pts = [{ lat, lon }];
    for (let a = 0; a < 8; a++) pts.push({ lat: lat + Math.cos((a * Math.PI) / 4) * dLat, lon: lon + Math.sin((a * Math.PI) / 4) * dLon });
    await T.heights(pts, 0, dem);
    const p = pts[0], steep = pts.reduce((b, x) => (x.slope > b.slope ? x : b), p);
    const c = [{ lat, lon, e: p.e, d: 0 }];
    const oh = await T.overhead(c, 0, dem).catch(() => null);
    return { e: p.e, slope: p.slope, asp: p.asp, max: steep.slope, above: oh ? c[0].above : null, trap: oh ? c[0].trap : null };
  }
  // The ground in avalanche terms, and an ATES-style class for this one spot (an estimate from the terrain only).
  function spotTerrain(g) {
    const s = g.slope, why = [];
    const c = s >= 35 || (g.above && g.trap) ? 3 : s >= 30 || g.max >= 30 || g.above || g.trap ? 2 : 1;
    if (s < 5) why.push(["ok", "Flat ground: no avalanche can start here."]);
    else if (s < 25) why.push(["ok", `${Math.round(s)}°: too gentle for most slab avalanches to start.`]);
    else if (s < 30) why.push(["", `${Math.round(s)}°: low-angle avalanche terrain. It can slide when the snow is unstable.`]);
    else if (s <= 45) why.push(["hi", `${Math.round(s)}°: prime avalanche angle (30° to 45°, where most slab avalanches start).`]);
    else why.push(["hi", `${Math.round(s)}°: very steep. Sluffs run often and a fall here is serious.`]);
    if (g.max >= 30 && g.max - s >= 4) why.push([g.max >= 35 ? "hi" : "", `Steeper ground close by: up to ${Math.round(g.max)}° within ${SPOT_RING} m.`]);
    if (g.above) why.push(["hi", "Steep slopes above: ground of 30° or more within 350 m uphill could slide down onto this spot."]);
    else if (g.above === false && s < 30) why.push(["ok", "No steep slopes above that could slide onto this spot."]);
    if (g.trap) why.push(["hi", "Terrain trap: a gully or creek bed. Even a small slide piles up deep here."]);
    return { c, ...T.CLASSES[c], why };
  }
  function spotAvyHtml(lat, lon, g, cls) {
    const data = example ? exampleData() : avy;
    const site = avySite(lat, lon), link = siteLink(site);
    if (!data) return `<h4>Avalanche danger</h4><p class="sk-note">${avyErr ? `The avalanche forecast isn't on the site yet. ${link}` : "Loading the avalanche forecast…"}</p>`;
    const a = areaAt(lat, lon), f = a && a.forecast, bands = a ? a.bands : DEFAULT_BANDS, band = bandOf(g.e, bands);
    const bandN = BANDS.find((x) => x[0] === band)[1];
    const where = `${bandN} here (${band === "alp" ? `above ~${fmtM(bands.hi)}` : band === "tln" ? `~${fmtM(bands.lo)} to ${fmtM(bands.hi)}` : `below ~${fmtM(bands.lo)}`})`;
    let html = `<h4>Avalanche danger${f ? `: ${esc(f.title || a.name)}` : ""}</h4>`;
    if (example) html += `<div class="av-warn">EXAMPLE, not a real forecast.</div>`;
    const expired = f && !example && f.validUntil && new Date(f.validUntil) < new Date();
    if (!f || !f.days || !f.days.length || expired) return html + `<p class="sk-note">${where}.</p><p>No avalanche forecast here right now${expired ? " (the last one has expired)" : ""}. ${site.season} ${link}</p>`;
    const d = dayOf(f), r = (d && d[band]) || 0, li = r ? T.light(r, cls.c) : -1;
    if (r && g.slope >= 25) {
      const mask = a ? a.mask[band] : 0, hit = mask & (1 << g.asp), lv = slopeLevel(r, hit, mask, g.slope);
      html += `<p>On the map, this slope is <span class="av-chip" style="background:${DANGER[lv].color};color:${lv >= 4 ? "#fff" : "#1a1a1a"}">${esc(DANGER[lv].label)}</span>: ${Math.round(g.slope)}° ${esc(ASPECT_NAME[g.asp])}-facing, ${hit ? "on an aspect in today's problems" : mask ? "away from today's problems" : "no problems listed in this band"}.</p>`;
    }
    if (li >= 0) {
      const L0 = T.LIGHTS[li];
      html += `<div class="sk-check" style="--c:${L0.color}"><b>${L0.label}</b><span>${esc(d.label || d.date || "")}: ${esc(DANGER[r].label.replace(/^\d /, ""))} in the ${bandN.toLowerCase()} × ${cls.label} terrain (estimate)</span></div>`;
    }
    html += `<p class="sk-note">${where}</p>
      <div class="sk-spotdays">${f.days.map((x) => { const v = x[band] || 0; return `<div><span>${esc((x.label || x.date || "").slice(0, 3))}</span><span class="av-chip" style="background:${DANGER[v].color};color:${v >= 4 ? "#fff" : "#1a1a1a"}">${esc(DANGER[v].label)}</span></div>`; }).join("")}</div>`;
    const asp = ASPECTS[g.asp], probs = (f.problems || []).filter((p) => (p.elevations || []).includes(band));
    if (probs.length) html += probs.map((p) => {
      const on = g.slope >= 20 && (p.aspects || []).includes(asp);
      return `<div class="av-prob${on ? "" : " off"}">${rose(p)}<div><b>${esc(p.type)}</b><p>${on ? `<b>On this slope:</b> ${esc(ASPECT_NAME[g.asp])}-facing in the ${bandN.toLowerCase()}` : g.slope < 20 ? "Gentle ground here, but on the slopes around it" : `On other aspects (${esc(p.aspects.map((s) => s.toUpperCase()).join(" "))}), not this ${esc(ASPECT_NAME[g.asp])}-facing slope`}</p><p>${p.likelihood ? "Likelihood: " + esc(likely(p.likelihood)) : ""}${p.size ? ` · size ${esc(p.size)}` : ""}</p>${on ? probNotes(p) : ""}</div></div>`;
    }).join("");
    else if ((f.problems || []).length) html += `<p class="sk-note">None of today's avalanche problems are in the ${bandN.toLowerCase()}.</p>`;
    if (f.highlights) html += `<p><strong>${esc(f.highlights)}</strong></p>`;
    html += adviceHtml(f);
    return html + `${janNote(f)}<p><a href="${esc(f.url || site.url)}" target="_blank" rel="noopener">Full ${/^jan-/.test(f.id || "") ? "bulletin" : "forecast"} on ${site.host}</a></p>`;
  }
  // Snow that fell (last 24 h, 3 days, week) and snow coming (next 24 h, 3 days, week) at the spot's height, each box
  // tinted with the New snow / Snow forecast map colours, then the weather day by day: the last 7 days and the next 7.
  function spotSnowHtml(w, g) {
    const aw = avyWeather(w, g.e), h = w.hourly, dd = w.daily;
    if (!aw) return `<h4>Snow and weather</h4>${wxHtml(w, null)}`;
    let i0 = h.time.findIndex((t) => t > w.current.time) - 1;
    if (i0 < 0) i0 = h.time.length - 1;
    const sum = (arr, a, b) => { let t = 0; for (let i = Math.max(0, a); i <= Math.min(arr.length - 1, b); i++) t += arr[i] || 0; return t; };
    const past = [aw.snow24, aw.snow72, sum(h.snowfall, i0 - 167, i0)], next = [aw.next24, sum(h.snowfall, i0 + 1, i0 + 72), sum(h.snowfall, i0 + 1, i0 + 168)];
    const n = (v) => (v >= 0.5 ? `${Math.round(v)} cm` : "0");
    const box = (v, label) => { const c = snowColor(v); return `<div${c ? ` style="background:rgba(${c.map(Math.round).join(",")},.55)"` : ""}><b>${n(v)}</b><span>${label}</span></div>`; };
    const LBL = ["24 h", "3 days", "7 days"];
    const wind = h.wind_speed_10m[i0], wdir = COMPASS[Math.round((h.wind_direction_10m[i0] || 0) / 45) % 8];
    let html = `<h4>Snow at ${fmtM(g.e)}</h4>
      <p class="sk-snowlbl">❄ Fell in the last</p><div class="sk-stats sk-stats3">${past.map((v, k) => box(v, LBL[k])).join("")}</div>
      <p class="sk-snowlbl">🌨 Forecast, next</p><div class="sk-stats sk-stats3">${next.map((v, k) => box(v, LBL[k])).join("")}</div>
      <p class="sk-note" id="skSpotLayer"></p>`;
    if (aw.lee && g.slope >= 20 && aw.lee.includes(g.asp)) html += `<div class="sk-warn"><b>⚠ Wind loaded:</b> this slope faces ${ASPECT_NAME[g.asp]}, downwind of the ${Math.round(aw.maxW)} km/h wind with snow to move. Expect wind slabs.</div>`;
    // Day by day: snow, rain, high / low and wind, the 7 days before today and today plus the 6 after.
    let t0 = dd.time.indexOf(new Date().toLocaleDateString("en-CA", { timeZone: w.timezone }));
    if (t0 < 0) t0 = 7;
    const strip = (title, a, b) => {
      const idx = [];
      for (let i = Math.max(0, a); i < Math.min(dd.time.length, b); i++) idx.push(i);
      if (!idx.length) return "";
      const day = (i) => (i === t0 ? "Today" : i === t0 - 1 ? "Yest." : new Date(dd.time[i] + "T12:00").toLocaleDateString("en-CA", { weekday: "short" }));
      const rain = (i) => (dd.precipitation_sum[i] || 0) - (dd.snowfall_sum[i] || 0) / 0.7;   // Open-Meteo counts 0.7 cm of snow for each mm of water
      const row = (head, f) => `<tr><th>${head}</th>${idx.map((i) => `<td>${f(i)}</td>`).join("")}</tr>`;
      return `<h5>${title}</h5><div class="sk-daysx"><table class="sk-days">
        ${row("", (i) => `<b>${day(i)}</b><br>${WICON[dd.weather_code[i]] || ""}`)}
        ${row("Snow", (i) => { const v = dd.snowfall_sum[i] || 0, c = snowColor(v); return v >= 0.5 ? `<b class="sk-dsnow"${c ? ` style="background:rgba(${c.map(Math.round).join(",")},.6)"` : ""}>${Math.round(v)}</b>` : "–"; })}
        ${row("Rain", (i) => (rain(i) >= 1 ? `${Math.round(rain(i))}` : "–"))}
        ${row("High", (i) => deg(dd.temperature_2m_max[i]))}
        ${row("Low", (i) => deg(dd.temperature_2m_min[i]))}
        ${row("Wind", (i) => `${Math.round(dd.wind_speed_10m_max[i] || 0)}<br><small>${COMPASS[Math.round((dd.wind_direction_10m_dominant[i] || 0) / 45) % 8]}</small>`)}
      </table></div>`;
    };
    html += `<h4>Weather at ${fmtM(g.e)}</h4>
      <p>Now <b>${WICON[w.current.weather_code ?? dd.weather_code[t0]] || ""} ${Math.round(w.current.temperature_2m)}°C</b> · wind ${Math.round(wind || 0)} km/h from the ${wdir}</p>
      ${strip("Next 7 days", t0, t0 + 7)}${strip("Last 7 days", t0 - 7, t0)}
      <p class="sk-note">Snow in cm, rain in mm, wind in km/h (strongest of the day, and where it comes from). Weather model from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, at this spot's height.</p>`;
    html += `<h5>Avalanche weather</h5>${signsHtml(aw, g.e)}`;
    return html;
  }
  // What the New snow and Snow forecast map layers show at this spot (same grid and blend as their tiles), so the card
  // can say why its numbers differ when they do: the card is worked out for the spot's own height.
  async function spotLayerNote(lat, lon, w, g) {
    const s = snowStep(11), fi = lat / s, fj = lon / s, i = Math.floor(fi), j = Math.floor(fj), ty = fi - i, tx = fj - j;
    const v = await Promise.all([[i, j], [i, j + 1], [i + 1, j], [i + 1, j + 1]].map(([a, b]) => snowPoint(s, a, b)));
    if (v.some((x) => !x || x.err)) return "";
    const mix = (k) => (v[0][k] * (1 - tx) + v[1][k] * tx) * (1 - ty) + (v[2][k] * (1 - tx) + v[3][k] * tx) * ty;
    const aw = avyWeather(w, g.e), h = w.hourly;
    if (!aw) return "";
    let i0 = h.time.findIndex((t) => t > w.current.time) - 1;
    if (i0 < 0) i0 = h.time.length - 1;
    let n72 = 0;
    for (let q = i0 + 1; q <= Math.min(h.time.length - 1, i0 + 72); q++) n72 += h.snowfall[q] || 0;
    const f = mix("f"), nx = mix("n");
    if (Math.abs(f - aw.snow24) < 3 && Math.abs(nx - n72) < 3) return "";
    return `The map's New snow and Snow forecast colours here: ${Math.round(f)} cm in the last 24 h, ${Math.round(nx)} cm in the next 3 days. They use the weather model's smoothed ground, this card the spot's own height (${fmtM(g.e)}).`;
  }
  // The closest route on the map (within 3 km), hut (within 10 km) and snow station (within 30 km).
  function spotNearHtml(lat, lon) {
    const out = [], here = L.latLng(lat, lon), box = here.toBounds(6000);
    if (ski) {
      let best = null, bestKm = 3;
      for (const r of ski.routes || []) {
        if (!shown.has(r.type) || !r.bounds || !r.bounds.intersects(box)) continue;
        for (const line of r.lines) for (let i = 0; i < line.length; i += 3) {
          const km = map.distance(line[i], here) / 1000;
          if (km < bestKm) { bestKm = km; best = r; }
        }
      }
      if (best) out.push(`<dt>Route</dt><dd><a href="#" class="sk-go" data-rid="${esc(best.id)}">${esc(nameOf(best) || (TYPES[best.type] || TYPES.other).label)}</a> <span class="sk-note">${bestKm < 0.05 ? "here" : `${bestKm.toFixed(1)} km`}</span></dd>`);
      const hut = (ski.huts || []).map((x) => ({ x, km: map.distance([x.lat, x.lon], here) / 1000 })).filter((x) => x.km <= 10).sort((a, b) => a.km - b.km)[0];
      if (hut) out.push(`<dt>Hut</dt><dd><a href="#" class="sk-go" data-hid="${esc(hut.x.id)}">${esc(hut.x.name || "Hut")}</a> <span class="sk-note">${hut.km.toFixed(1)} km</span></dd>`);
    }
    const st = nearSnow(lat, lon)[0];
    if (st) out.push(`<dt>Snow station</dt><dd><a href="#" class="sk-go" data-st="${esc(st.st.id)}">${esc(st.st.name)}</a> <span class="sk-note">${st.km.toFixed(0)} km, ${st.st.ele.toLocaleString()} m</span>${st.st.sd != null ? `<br>Snow <b>${cm(st.st.sd)}</b> · 24 h ${plus(st.st.sd24)} · 3 days ${plus(st.st.sd72)}` : ""}</dd>`);
    return out.length ? `<h4>Nearby</h4><dl>${out.join("")}</dl>` : "";
  }
  // Phones: the sheet up to half. The camera stays where it is (alex 2026-10-27: a tap that zoomed the 3D map out was
  // unwelcome); only on the flat map, a spot the sheet now covers slides up above it, at the same zoom.
  const spotInView = (lat, lon) => cardInView($("skSpot"), lat, lon);
  // Phones: the sheet up to half with the card at its top, and the tapped point slid clear of the sheet (flat map only).
  function cardInView(el, lat, lon) {
    if (!el || el.hidden) return;
    if (!PHONE_UI()) { if (window.tfPanelScrollTo) window.tfPanelScrollTo(el); return; }
    if (window.tfSnapTo) { const p = document.querySelector(".panel"); if (!p || p.classList.contains("sheet-peek")) window.tfSnapTo("half"); }   // only grows the sheet
    setTimeout(() => {
      if (window.tfPanelScrollTo) window.tfPanelScrollTo(el);
      const sc = window.tfPanelScroller && window.tfPanelScroller(el);
      if (sc) sc.scrollTop = Math.max(0, sc.scrollTop - 16);   // a little room above the card, clear of the sheet's handle
      const panel = document.querySelector(".panel"), box = map.getContainer().getBoundingClientRect();
      if (lat == null || !panel || map.getContainer().closest(".is3d")) return;   // 3D: the class is on the map's wrapper
      const top = panel.getBoundingClientRect().top, y = box.top + map.latLngToContainerPoint([lat, lon]).y;
      if (y < top - 40) return;
      map.panBy([0, y - (box.top + (top - box.top) * 0.6)]);
    }, 320);
  }
  window.tfSkiSpot = (lat, lon) => { unselect(); showSpot(lat, lon); };   // a shared spot (ski-points.js #pin=)
  async function showSpot(lat, lon) {
    const seq = ++spotSeq, el = $("skSpot");
    spot = { lat, lon, g: null, cls: null };
    spotLayer.clearLayers();
    spotLayer.addLayer(L.circleMarker([lat, lon], { radius: 9, color: "#fff", weight: 3, fillColor: "#e8590c", fillOpacity: 1, interactive: false }));
    if (!map.hasLayer(spotLayer)) spotLayer.addTo(map);
    el.hidden = false;
    el.innerHTML = `<div><button type="button" class="sk-x" aria-label="Close">✕</button>${window.tfShareBtn ? window.tfShareBtn(lat, lon, { sport: "ski" }) : ""}<h3>📍 This spot</h3></div>
      <p class="sk-hint">${lat.toFixed(4)}, ${lon.toFixed(4)}</p>
      <div id="skSpotGround"><p class="sk-note">Reading the terrain…</p></div><div id="skSpotAvy"></div><div id="skSpotSnow"></div><div id="skSpotNear"></div><div id="skSpotMin"></div>
      <div class="sk-acts sk-spotacts"><button type="button" class="sk-act" data-act="safe">Less exposed way here</button><button type="button" class="sk-act" data-act="plan">✎ Plan a tour from here</button>${shown.has("slope") ? "" : `<button type="button" class="sk-act" data-act="slope">Show slope angles</button>`}</div>`;
    el.querySelector(".sk-x").addEventListener("click", closeSpot);
    el.querySelector("[data-act=plan]").addEventListener("click", () => { closeSpot(); setPlanning(true); planAdd(L.latLng(lat, lon)); });
    el.querySelector("[data-act=safe]").addEventListener("click", () => { closeSpot(); if (plan.on) setPlanning(false); safeTo(lat, lon); });
    const sb = el.querySelector("[data-act=slope]");
    if (sb) sb.addEventListener("click", () => { shown.add("slope"); const off = oneGround("slope"); applySwitches(); if (off.includes("avy")) refreshAvy(); sb.remove(); });
    spotInView(lat, lon);
    const live = () => seq === spotSeq;
    const fill = (id, html) => { if (live() && $(id)) $(id).innerHTML = html; };
    if (!avy && !example) loadAvy();
    if (!snow && !snowErr) loadSnow();
    let g;
    try { g = await spotGround(lat, lon); } catch { fill("skSpotGround", `<p class="sk-note">Couldn't read the terrain here (no connection?).</p>`); return; }
    if (!live()) return;
    const cls = spotTerrain(g);
    Object.assign(spot, { g, cls });
    const flat = g.slope < 5;
    const shb = el.querySelector(".tf-share");   // the shared text says how high and which way it faces
    if (shb) shb.dataset.about = `${fmtM(g.e)}, ${flat ? "flat" : `faces ${ASPECTS[g.asp].toUpperCase()}, ${Math.round(g.slope)}°`}`;
    fill("skSpotGround", `<div class="sk-stats sk-spotg"><div class="sk-spotslope" style="--c:${slopeCol(g.slope)}"><b>${Math.round(g.slope)}°</b><span>slope</span></div>
        <div><b>${flat ? "flat" : ASPECTS[g.asp].toUpperCase()}</b><span>faces</span></div><div><b>${fmtM(g.e)}</b><span>height</span></div>
        <div class="sk-spotates" style="--c:${cls.color}"><b>${cls.label}</b><span>terrain</span></div></div>
      <ul class="sk-signs">${cls.why.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join("")}</ul>
      <p class="sk-note">${esc(cls.what)} Terrain class is an estimate from the terrain map (ATES-style), not an official rating.</p>`);
    fillSpotAvy();
    const near = () => { if (!live()) return; fill("skSpotNear", spotNearHtml(lat, lon)); bindSpotNear(); };
    near();
    if (snow && !snow.stations.length) setTimeout(near, 1500);   // the stations file is still loading
    if (!minData) await loadMin();
    if (live()) fill("skSpotMin", `<details class="sk-fold"><summary>Avalanches reported by riders nearby</summary>${minHtml([{ lat, lon }])}</details>`);
    fill("skSpotSnow", `<p class="sk-note">Loading snow and weather…</p>`);
    // Rapid taps around the map ask Open-Meteo once, for the spot they stop on.
    await new Promise((ok) => setTimeout(ok, 400));
    if (!live()) return;
    weather(lat, lon, g.e).then((w) => {
      fill("skSpotSnow", spotSnowHtml(w, g));
      spotLayerNote(lat, lon, w, g).then((t) => { if (t) fill("skSpotLayer", t); }, () => {});
    }, (e) => fill("skSpotSnow", `<p class="sk-note">Couldn't load the weather here: ${esc(e.message)}.</p>`));
  }
  function fillSpotAvy() {
    if (!spot || !spot.g || $("skSpot").hidden) return;
    $("skSpotAvy").innerHTML = spotAvyHtml(spot.lat, spot.lon, spot.g, spot.cls);
  }
  function bindSpotNear() {
    $("skSpotNear").querySelectorAll(".sk-go").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      const d = a.dataset;
      if (d.rid) { const r = (ski?.routes || []).find((x) => x.id === d.rid); if (r) select(r, true); }
      else if (d.hid) { const h = (ski?.huts || []).find((x) => x.id === d.hid); if (h) select(h, true); }
      else if (d.st) { const st = snow?.stations.find((x) => x.id === d.st); if (st) { if (!shown.has("snow")) { shown.add("snow"); applySwitches(); } showStation(st); } }
    }));
  }
  window.addEventListener("tf:sport", () => { if (!document.body.classList.contains("sport-ski") && spot) closeSpot(); });

  // Taps on routes, huts, pins, webcams and stations stop here (they open their own details), so a click that reaches
  // the map landed beside them: it closes an open route and shows what's at that spot. In 3D, map3d.js sends taps
  // that miss every line to this same click.
  let offTimer = 0;
  map.on("click", (e) => {
    if (sport !== "ski") return;
    if (plan.on) { planAdd(e.latlng); return; }
    if (document.body.classList.contains("sp-picking") || document.querySelector(".app.riding")) return;   // placing a saved point (ski-points.js), recording
    clearTimeout(offTimer);
    const ll = e.latlng;
    offTimer = setTimeout(() => { unselect(); showSpot(ll.lat, ll.lng); }, 260);   // a double-click zooms instead
  });
  map.on("dblclick", () => clearTimeout(offTimer));
  let dbl3d = null;
  window.addEventListener("tf:map3d", () => { const gl = window.trailMap3d; if (gl && gl !== dbl3d) { dbl3d = gl; gl.on("dblclick", () => clearTimeout(offTimer)); } });
  $("skPlanBtn").addEventListener("click", () => setPlanning(!plan.on));
  $("skNewBtn").addEventListener("click", () => newTour());
  $("skToursBtn").addEventListener("click", () => showTours());
  // Save a point lives here on phones, so the map keeps the same four buttons in every sport
  $("skSaveBtn").addEventListener("click", () => { if (window.tfPoints) window.tfPoints.add(); });
  $("skRecBtn").addEventListener("click", () => {
    if (!window.tfRide) return;
    if (plan.on) setPlanning(false);
    window.tfRide.start();
  });

  // Red dashes over the stretches of the selected route that have steep slopes above them (aboveLayer).
  function drawAbove(info) {
    aboveLayer.clearLayers();
    if (!info || !info.above) return;
    if (selected && selected.src === "plan" && safePath()) return;   // the 🛡 safest way colours its own exposed pieces
    let run = [];
    const flush = () => { if (run.length > 1) aboveLayer.addLayer(L.polyline(run, { color: "#c92a2a", weight: 7, opacity: 0.85, dashArray: "4 7", lineCap: "round", interactive: false, pane: "ski" })); run = []; };
    info.pts.forEach((p, i) => {
      if (p.above && (!run.length || i === 0 || info.pts[i - 1].seg === p.seg)) run.push([p.lat, p.lon]);
      else { if (p.above) { flush(); run.push([p.lat, p.lon]); } else flush(); }
    });
    flush();
    if (!map.hasLayer(aboveLayer)) aboveLayer.addTo(map);
  }

  // ---------- snowmobile clubs and their grooming reports ----------
  // Pins at each club's staging areas; the card lists every club with its latest grooming report when the nightly
  // job could read it (data/grooming.json), or a link to where the club posts it (often Facebook, which can't be read).
  const clubLayer = L.layerGroup();
  let clubs = null, clubLinks = [], grooming = null, clubOn = null;
  function loadClubs() {
    if (clubs) return;
    clubs = [];
    const get = (u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get("data/snowmobile-clubs.json"), get("data/grooming.json")]).then(([c, g]) => {
      clubs = (c && c.clubs) || []; clubLinks = (c && c.links) || []; grooming = g;
      renderSwitches(); drawClubs(); renderClubs();
    });
  }
  const when = (iso) => {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (!t) return iso;
    const d = Math.round((Date.now() - t) / 86400e3);
    return d < 1 ? "today" : d === 1 ? "yesterday" : d < 45 ? `${d} days ago` : new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };
  function clubNear(lat, lon) {
    let best = null;
    for (const c of clubs || []) for (const a of c.areas || []) {
      if (a.lat == null) continue;
      const km = map.distance([lat, lon], [a.lat, a.lon]) / 1000;
      if (km <= (a.radiusKm || 25) && (!best || km < best.km)) best = { c, a, km };
    }
    return best;
  }
  function drawClubs() {
    clubLayer.clearLayers();
    if (!shown.has("club")) return;
    for (const c of clubs || []) for (const a of c.areas || []) {
      if (a.lat == null) continue;
      const m = L.marker([a.lat, a.lon], { icon: L.divIcon({ className: "", html: `<span class="sk-pin${clubOn === c ? " on" : ""}" style="background:${CLUB.color}">❄</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }) });
      m.bindTooltip(`${esc(a.name)} · ${esc(c.name)}`);
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); if (plan.on) planAdd(e.latlng); else showClub(c); });
      clubLayer.addLayer(m);
    }
  }
  function showClub(c) {
    clubOn = c;
    const card = $("sbCard");
    card.open = true;
    renderClubs(); drawClubs();
    const el = document.getElementById("sb-" + c.id);
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  const link = (u, t) => (u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : "");
  function renderClubs() {
    const card = $("sbCard");
    card.hidden = !(clubs && clubs.length && shown.has("club"));
    if (card.hidden) return;
    $("sbSum").textContent = `Snowmobile clubs and grooming (${clubs.length})`;
    $("sbBody").innerHTML = clubs.map((c) => {
      const rep = grooming?.reports?.[c.id], r = c.report || {};
      const got = rep && rep.text;
      const status = got
        ? `<span class="sb-when">Grooming report${rep.date ? ` dated ${esc(rep.date)}` : ""}, read ${esc(when(rep.fetchedAt))}${rep.changedAt ? `, last changed ${esc(when(rep.changedAt))}` : ""}</span><div class="sb-rep">${esc(rep.text)}</div>`
        : `<span class="sb-when">${esc(r.note || "The club's grooming updates aren't on a page this site can read: open the link.")}</span>`;
      return `<div class="sb-club${clubOn === c ? " on" : ""}" id="sb-${esc(c.id)}"><b>${esc(c.name)}</b>
        ${c.town ? `<span class="sb-areas">${esc(c.town)}</span>` : ""}
        ${(c.areas || []).map((a) => `<span><a href="#" class="sb-area" data-c="${esc(c.id)}" data-lat="${a.lat}" data-lon="${a.lon}">${esc(a.name)}</a>${a.note ? `: ${esc(a.note)}` : ""}</span>`).join("")}
        ${status}
        ${c.pass ? `<span>Trail pass: ${esc(c.pass)}</span>` : ""}
        <div class="sb-links">${link(r.url, r.label || "Grooming report")}${(c.maps || []).map((m) => link(m.url, m.label || "Trail map")).join("")}${link(c.web, "Website")}</div></div>`;
    }).join("") + (clubLinks.length ? `<div class="sb-club"><b>For the whole region</b><div class="sb-links">${clubLinks.map((l) => link(l.url, l.label)).join("")}</div></div>` : "") + `<p class="sk-safe">Pins are the staging areas, placed roughly. Reports are the clubs' own posts.</p>`;
    $("sbBody").querySelectorAll(".sb-area").forEach((el) => el.addEventListener("click", (e) => {
      e.preventDefault();
      if (el.dataset.lat !== "undefined") map.setView([+el.dataset.lat, +el.dataset.lon], Math.max(map.getZoom(), 11));
    }));
  }
  // ---------- snow stations (data/snow-stations.json, BC's automated snow pillows and Environment Canada's snow depth stations elsewhere, read every 2 hours) ----------
  // Measured snow depth, new snow and temperature high in the mountains, as pins showing the depth.
  const snowLayer = L.layerGroup();
  let snow = null, snowErr = "", snowOn = null;
  function loadSnow() {
    if (snow || snowErr) return;
    snow = { stations: [] };
    fetch("data/snow-stations.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { snow = d; drawSnow(); renderSwitches(); if (selected) showNearSnow(); })
      .catch((e) => { snow = null; snowErr = e.message; renderSwitches(); });
  }
  const cm = (v) => (v == null ? "–" : `${Math.round(v)} cm`);
  const plus = (v) => (v == null ? "–" : `${v > 0 ? "+" : ""}${Math.round(v)} cm`);
  function drawSnow() {
    snowLayer.clearLayers();
    if (!shown.has("snow") || !snow) return;
    for (const st of snow.stations || []) {
      const label = st.sd != null ? cm(st.sd) + (st.sd24 >= 2 ? ` +${Math.round(st.sd24)}` : "") : st.ta != null ? `${Math.round(st.ta)}°` : "·";
      const m = L.marker([st.lat, st.lon], { icon: L.divIcon({ className: "", html: `<span class="sk-snow${st.sd == null ? " none" : ""}${snowOn === st ? " on" : ""}">❄ ${esc(label)}</span>`, iconSize: [0, 0] }) });
      m.bindTooltip(`${esc(st.name)} · ${st.ele} m`);
      m.on("click", (e) => { L.DomEvent.stopPropagation(e); if (plan.on) planAdd(e.latlng); else showStation(st); });
      snowLayer.addLayer(m);
    }
  }
  function stationHtml(st, close) {
    const max = Math.max(1, ...st.days.filter((v) => v != null));
    const day = (i) => (i === st.days.length - 1 ? "now" : new Date(Date.parse(st.at) - (st.days.length - 1 - i) * 864e5).toLocaleDateString(undefined, { weekday: "narrow" }));
    return `${close ? '<div><button type="button" class="sk-x" aria-label="Close">✕</button>' : "<div>"}<h3>❄ ${esc(st.name)}</h3></div>
      <p class="sk-hint">Snow station at ${st.ele.toLocaleString()} m · read ${esc(when(st.at))}</p>
      <div class="sk-stats"><div><b>${cm(st.sd)}</b><span>snow</span></div><div><b>${plus(st.sd24)}</b><span>24 h</span></div><div><b>${plus(st.sd72)}</b><span>3 days</span></div><div><b>${st.ta == null ? "–" : Math.round(st.ta) + "°C"}</b><span>air now</span></div></div>
      ${st.days.length && st.days.some((v) => v) ? `<div class="sk-spark" aria-label="Snow depth over the last 7 days">${st.days.map((v) => `<span style="height:${v == null ? 0 : Math.max(2, (v / max) * 100)}%" title="${cm(v)}"></span>`).join("")}</div><div class="sk-days">${st.days.map((_, i) => `<span>${day(i)}</span>`).join("")}</div>` : ""}
      <p class="sk-note">${st.lo24 != null ? `Last 24 h: low ${Math.round(st.lo24)}°C, high ${Math.round(st.hi24)}°C. ` : ""}${st.swe != null ? `Water in the snow: ${Math.round(st.swe)} mm. ` : ""}Measured by ${st.src === "msc" ? "Environment Canada, at the station (often a valley or airport, not the mountain)" : st.src === "qc" ? "Quebec's climate network (Ministère de l'Environnement), at the station" : "BC's River Forecast Centre"}. The snow on the slopes around can be quite different.</p>`;
  }
  function showStation(st) {
    snowOn = st;
    const card = $("skStation");
    card.hidden = false;
    card.innerHTML = stationHtml(st, true);
    card.querySelector(".sk-x").addEventListener("click", () => { snowOn = null; card.hidden = true; drawSnow(); });
    drawSnow();
    if (window.tfPanelScrollTo) window.tfPanelScrollTo(card);
    const sc = window.tfPanelScroller && window.tfPanelScroller(card);
    if (sc) sc.scrollTop = Math.max(0, sc.scrollTop - 16);   // a little room above the card, clear of the sheet's handle
  }
  // The closest snow stations to a route or hut, for its details.
  function nearSnow(lat, lon) {
    return (snow?.stations || []).map((st) => ({ st, km: map.distance([lat, lon], [st.lat, st.lon]) / 1000 })).filter((x) => x.km <= 30 && (x.st.sd != null || x.st.ta != null))
      .sort((a, b) => a.km - b.km).slice(0, 2);
  }

  map.on("moveend", () => { if (sport === "ski") { renderList(); renderForecast(); } });

  // ---------- avalanche forecast ----------
  let avy = null, avyLoading = null, avyErr = "", example = false, day = 0;
  function prepAreas(d) {
    (d.areas || []).forEach((a) => {
      a.polys = (a.rings || []).map((r) => { const pts = []; for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]); return pts; });
      const all = a.polys.flat();
      a.box = all.length ? [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))] : null;
      a.bands = bandsFor(a);
      // Bit masks of the aspects named in the problems, per elevation band.
      a.mask = { alp: 0, tln: 0, btl: 0 };
      (a.forecast?.problems || []).forEach((p) => (p.elevations || []).forEach((b) => (p.aspects || []).forEach((s) => { if (b in a.mask) a.mask[b] |= 1 << ASPECTS.indexOf(s); })));
    });
    return d;
  }
  function loadAvy() {
    if (avy || avyLoading) return avyLoading;
    avyLoading = fetch("data/avalanche.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { avy = prepAreas(d); refreshAvy(); })
      .catch((e) => { avyErr = e.message; renderForecast(); })
      .finally(() => { avyLoading = null; });
    return avyLoading;
  }
  function inPoly(lat, lon, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [ay, ax] = poly[i], [by, bx] = poly[j];
      if ((ay > lat) !== (by > lat) && lon < ((bx - ax) * (lat - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  }
  function areaAt(lat, lon) {
    for (const a of (example ? exampleData() : avy)?.areas || []) {
      if (!a.box || lat < a.box[0] || lat > a.box[2] || lon < a.box[1] || lon > a.box[3]) continue;
      if (a.polys.some((p) => inPoly(lat, lon, p))) return a;
    }
    return null;
  }
  // The nearest area with a forecast, within 300 km: { a, km } (distance to its outline's corners, close enough).
  function nearestArea(lat, lon) {
    let best = null;
    const k = Math.cos((lat * Math.PI) / 180);
    for (const a of avy?.areas || []) {
      if (!a.forecast || !a.forecast.days?.length || !a.box) continue;
      if (lat < a.box[0] - 3 || lat > a.box[2] + 3 || lon < a.box[1] - 6 || lon > a.box[3] + 6) continue;
      for (const p of a.polys) for (const [y, x] of p) {
        const km = Math.hypot(y - lat, (x - lon) * k) * 111;
        if (km <= 300 && (!best || km < best.km)) best = { a, km };
      }
    }
    return best;
  }
  const dayOf = (f) => f && f.days && (f.days[Math.min(day, f.days.length - 1)] || null);
  const hasForecasts = () => (avy?.areas || []).some((a) => a.forecast && a.forecast.days?.length);

  // A made-up forecast to try the shading out of season, clearly marked as an example.
  let exampleCache = null;
  function exampleData() {
    if (exampleCache) return exampleCache;
    const box = (s, w, n, e) => [s, w, s, e, n, e, n, w, s, w];
    const today = new Date();
    const dayN = (i) => { const d = new Date(today); d.setDate(d.getDate() + i); return { date: d.toISOString().slice(0, 10), label: d.toLocaleDateString(undefined, { weekday: "long" }) }; };
    const fc = (title, days, problems) => ({ title, url: "https://avalanche.ca/map", issued: today.toISOString(), validUntil: "", highlights: "Example only. This is not a real forecast.", days, problems, summaries: {} });
    return (exampleCache = prepAreas({ example: true, areas: [
      { id: "ex-s2s", name: "Sea to Sky (example)", rings: [box(49.25, -124.0, 50.62, -122.55)], forecast: fc("Sea to Sky (example)",
        [{ ...dayN(0), alp: 3, tln: 3, btl: 2 }, { ...dayN(1), alp: 3, tln: 2, btl: 1 }, { ...dayN(2), alp: 2, tln: 2, btl: 1 }],
        [{ type: "Wind Slab", aspects: ["n", "ne", "e"], elevations: ["alp", "tln"], likelihood: "Likely", size: "1-2", comment: "Example: fresh wind slabs on lee slopes below ridgecrests." },
          { type: "Persistent Slab", aspects: ["n", "ne", "e", "se", "s", "sw", "w", "nw"], elevations: ["alp"], likelihood: "Possible", size: "2-3", comment: "Example: a buried weak layer that can be triggered from thin spots." }]) },
      { id: "ex-sci", name: "South Coast Inland (example)", rings: [box(50.42, -122.55, 51.25, -121.7)], forecast: fc("South Coast Inland (example)",
        [{ ...dayN(0), alp: 2, tln: 2, btl: 1 }, { ...dayN(1), alp: 2, tln: 2, btl: 1 }, { ...dayN(2), alp: 2, tln: 1, btl: 1 }],
        [{ type: "Storm Slab", aspects: ["n", "ne", "e", "se", "s", "sw", "w", "nw"], elevations: ["alp", "tln"], likelihood: "Possible", size: "1-1.5", comment: "Example." }]) },
    ] }));
  }

  // Avalanche Canada's aspect and elevation diagram: rings for alpine (inside), treeline and below treeline (outside).
  function rose(p) {
    const R = [0, 13, 26, 39], cx = 40, cy = 40, pt = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)].map((v) => v.toFixed(1)).join(" ");
    let s = "";
    BANDS.forEach(([b], ring) => ASPECTS.forEach((asp, k) => {
      const a0 = ((k * 45 - 22.5) * Math.PI) / 180, a1 = ((k * 45 + 22.5) * Math.PI) / 180, r0 = R[ring], r1 = R[ring + 1];
      const on = p.elevations.includes(b) && p.aspects.includes(asp);
      const d = r0 ? `M${pt(r0, a0)} L${pt(r1, a0)} A${r1} ${r1} 0 0 1 ${pt(r1, a1)} L${pt(r0, a1)} A${r0} ${r0} 0 0 0 ${pt(r0, a0)}Z` : `M${cx} ${cy} L${pt(r1, a0)} A${r1} ${r1} 0 0 1 ${pt(r1, a1)}Z`;
      s += `<path d="${d}" fill="${on ? "#2a3b4c" : "#e8ecef"}" stroke="#fff" stroke-width="1"/>`;
    }));
    return `<svg viewBox="0 0 80 88" width="74" height="81" role="img" aria-label="${esc(p.type)}: ${esc(p.aspects.join(", ").toUpperCase())} aspects, ${esc(p.elevations.join(", "))}">${s}<text x="40" y="86" text-anchor="middle" font-size="8" fill="currentColor">N at top</text></svg>`;
  }
  // The Avalanche card (with Touring, or with the slope shading on): today's ratings for the area in the middle of the
  // map, then the problems, the forecaster's notes, riders' reports near the middle of the map and the colour key
  // folded under "More".
  let avMore = false;
  // The avalanche weather on the card: at the alpine height of the forecast area in the middle of the map.
  let cardWx = { key: "", html: "" };
  function cardWeather(c, ele) {
    const lat = Math.round(c.lat * 10) / 10, lon = Math.round(c.lng * 10) / 10, key = `${lat},${lon},${ele}`;
    if (cardWx.key === key) return cardWx.html;
    cardWx = { key, html: `<p class="sk-note">Loading the avalanche weather…</p>` };
    const put = (html) => { if (cardWx.key !== key) return; cardWx.html = html; const el = $("avWx"); if (el) el.innerHTML = html; };
    weather(lat, lon, ele).then((w) => put(`<h5>Avalanche weather at ${fmtM(ele)}</h5>${signsHtml(avyWeather(w, ele), ele)}`), () => put(""));
    return cardWx.html;
  }
  function renderForecast() {
    const card = $("avCard");
    card.hidden = !(sport === "ski" && (avyOn || shown.has("tour")) && $("skDetail").hidden);   // a route's details have their own
    if (card.hidden) return;
    if (!avy && !example && !avyErr) loadAvy();
    if (!minData && !minErr && !minLoading) loadMin().then(renderForecast);
    const data = example ? exampleData() : avy;
    // Short: the day's three ratings and one line of what to do, with everything else one tap away (alex 2026-10-24).
    const shade = `<button type="button" class="av-pill" id="avShade" aria-pressed="${avyOn}"><i class="av-sw" aria-hidden="true"></i>${avyOn ? "Slopes shaded" : "Shade slopes"}</button>`;
    const top = (where) => `<div class="av-top"><h3>⚠ Avalanche</h3>${where ? `<span class="av-where">${where}</span>` : ""}</div>`;
    const c = map.getCenter(), site = avySite(c.lat, c.lng), wxAt = () => ((avy || example) && areaAt(c.lat, c.lng)?.bands || DEFAULT_BANDS).hi;
    const short = (where, msg, ex) => { card.innerHTML = `${top(where)}<p class="av-line">${msg}</p><div id="avWx">${cardWeather(c, wxAt())}</div>${ex ? `<div class="av-foot"><button type="button" class="av-pill" id="avEx">See an example</button></div>` : ""}`; bindEx(); };
    if (!data) return short("", avyErr ? "The forecast isn't on the site yet." : "Loading the forecast…", !!avyErr);
    if (!example && !hasForecasts()) return short("", `No forecast right now. ${site.season}`, true);
    // Only the area under the map centre (or a forecast with no outline): the Chic-Chocs used to show Glacier's forecast.
    const area = (example ? null : areaAt(c.lat, c.lng)) || (data.areas.find((a) => a.polys.some((p) => inPoly(c.lat, c.lng, p))) || data.areas.find((a) => !a.polys.length && a.forecast?.days?.length));
    const f = area && area.forecast;
    if (!area && site === AVY_SITE.jp) return short("", `No avalanche bulletin covers this spot. ${site.season} ${siteLink(site)}`);
    // Outside every forecast area (Whitehorse: Avalanche Canada covers the White Pass only, fix list item 45,
    // 2026-11-02): the nearest forecast, how far, its rating today, and riders' reports near the spot.
    if (!area) {
      const nb = nearestArea(c.lat, c.lng), nd = nb && dayOf(nb.a.forecast), r = nd ? Math.max(nd.alp || 0, nd.tln || 0, nd.btl || 0) : 0;
      const reps = minData ? (minData.reports || []).filter((m) => map.distance([m.lat, m.lon], c) <= 40000) : [];
      const seen = reps.filter((m) => m.av && m.av.seen).length;
      const days = (minData && minData.days) || 14, nm = nb ? (nb.a.forecast.title || nb.a.name) : "";
      const msg = [`No avalanche forecast covers this spot.`,
        nb && (r ? `The nearest is ${nm}, ${Math.round(nb.km)} km away (${DANGER[r].label.replace(/^\d /, "").toLowerCase()} at its worst today): snow and danger can be very different here.`
          : `The nearest is ${nm}, ${Math.round(nb.km)} km away: snow and danger can be very different here.`),
        minData && (reps.length ? `${reps.length} rider report${reps.length === 1 ? "" : "s"} within 40 km in the last ${days} days${seen ? `, ${seen} with avalanches` : ""}.` : `No rider reports within 40 km in the last ${days} days.`),
        "Read the snow yourself."].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join(" ") + ` <a href="https://avalanche.ca/map" target="_blank" rel="noopener">Check avalanche.ca</a>`;
      return short("", msg);
    }
    if (!f || !f.days?.length) return short(esc(area.name), "No forecast for this area right now.");
    const d = dayOf(f), expired = !example && f.validUntil && new Date(f.validUntil) < new Date();
    const notes = Object.values(f.summaries || {}).filter(Boolean), rated = example || f.days.some((x) => x.alp || x.tln || x.btl);
    const band = (b, n) => { const r = d[b] || 0, x = DANGER[r]; return `<div class="av-band" style="--c:${x.color};--t:${r >= 4 ? "#fff" : "#1a1a1a"}"><b>${esc(x.label.replace(/^\d /, ""))}</b><span>${n}</span></div>`; };
    card.innerHTML = `${example ? `<div class="av-warn">EXAMPLE, not a real forecast.</div>` : ""}
      ${expired ? `<div class="av-warn">This forecast has expired. Check ${site.host}.</div>` : ""}
      ${top(esc(f.title || area.name))}
      ${rated ? `${f.days.length > 1 ? `<div class="av-days" role="group" aria-label="Day">${f.days.map((x, i) => `<button type="button" data-d="${i}" aria-pressed="${x === d}">${esc(x.label || x.date)}</button>`).join("")}</div>` : ""}
      <div class="av-bands">${BANDS.map(([b, n]) => band(b, n)).join("")}</div>`
        : `<p class="av-line">No danger ratings yet: it's early season.</p>`}
      <div id="avWx">${cardWeather(c, area.bands.hi)}</div>
      <details id="avMore"${avMore ? " open" : ""}><summary>${rated ? "Problems, notes and riders' reports" : "Read the bulletin"}</summary>
        ${f.highlights ? `<p><strong>${esc(f.highlights)}</strong></p>` : ""}
        ${(f.problems || []).map((p) => `<div class="av-prob">${rose(p)}<div><b>${esc(p.type)}</b><p>${esc(p.aspects.map((s) => s.toUpperCase()).join(" "))} · ${esc(p.elevations.map((b) => BANDS.find((x) => x[0] === b)[1]).join(", "))}</p><p>${p.likelihood ? "Likelihood: " + esc(likely(p.likelihood)) : ""}${p.size ? " · Size " + esc(p.size) : ""}</p>${probNotes(p)}${p.comment ? `<details><summary>More</summary><p>${esc(p.comment)}</p></details>` : ""}</div></div>`).join("")}
        ${(f.problems || []).length ? `<p class="sk-note">Each rose shows where a problem is: dark parts are the slopes facing that way (north at the top), the middle ring is the alpine, then treeline, then below treeline.</p>` : ""}
        ${adviceHtml(f)}
        ${notes.length ? `<h5>Forecaster's notes</h5>${notes.map((s) => `<p>${esc(s)}</p>`).join("")}` : ""}
        ${minHtml([{ lat: c.lat, lon: c.lng }])}
        ${avyOn ? `<h5>Slope colours</h5><ul class="av-legend">${DANGER.slice(1).map((x) => `<li><i style="background:${x.color}"></i>${x.label}</li>`).join("")}<li><i style="background:repeating-linear-gradient(135deg,#f79218 0 3px,#7a4a0c 3px 5px)"></i>Problem aspect</li></ul>
        <p class="sk-note">Slopes of 25° and more, coloured by their band's rating (treeline about ${area.bands.lo}-${area.bands.hi} m here), then one level less where a slope faces away from today's problems or is under 30°, and one more at 40°+ on a problem aspect. An estimate, not a terrain rating. Where you go is your decision and your risk.</p>` : ""}
        ${janNote(f)}<p class="sk-note">${f.issued ? "Issued " + esc(new Date(f.issued).toLocaleDateString()) + ", for" : "For"} the middle of the map.</p>
      </details>
      <div class="av-foot">${shade}${example ? `<button type="button" class="av-pill" id="avExOff">Hide example</button>` : rated ? "" : `<button type="button" class="av-pill" id="avEx">Example</button>`}<a class="av-pill" href="${esc(f.url || site.url)}" target="_blank" rel="noopener">${site.host} ↗</a></div>`;
    card.querySelectorAll(".av-days button").forEach((b) => b.addEventListener("click", () => { day = +b.dataset.d; refreshAvy(); }));
    $("avMore").addEventListener("toggle", (e) => { avMore = e.currentTarget.open; });
    const off = $("avExOff"); if (off) off.addEventListener("click", () => { example = false; refreshAvy(); });
    bindEx();
  }
  // Today's line at the top of the Routes tab (and on the map's sheet): the avalanche card in one line, a tap opens it.
  function syncNow() {
    const card = $("avCard"), b = $("skNow");
    if (!b) return;
    const bands = [...card.querySelectorAll(".av-band")].map((x) => [x.querySelector("b")?.textContent || "", x.querySelector("span")?.textContent || ""]);
    const line = card.querySelector(".av-line");
    const html = card.hidden ? "" : bands.length ? `<span>⚠ <b>Avalanche: ${esc(bands[0][0])}</b> ${esc(bands[0][1].toLowerCase())}</span>${bands.slice(1).map(([r, n]) => `<span>${esc(r)} ${esc(n.toLowerCase())}</span>`).join("")}`
      : line ? `<span>⚠ <b>Avalanche:</b> ${esc(line.textContent.split(/\.\s/)[0].replace(/\.$/, ""))}</span>` : "";   // first sentence: the card under it has the rest
    if (b.innerHTML !== html) b.innerHTML = html;
    b.hidden = !html;
    // The one-line card (early season, no forecast...) says the same as the line on top: said once (alex's recording 2026-11-05).
    card.classList.toggle("av-dup", !!(html && !bands.length && line && !/\.\s/.test(line.textContent.trim())));
  }
  new MutationObserver(syncNow).observe($("avCard"), { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  $("skNow").addEventListener("click", () => { const c = $("avCard"); if (!c.hidden && window.tfPanelScrollTo) window.tfPanelScrollTo(c); });
  function bindEx() {
    const b = $("avEx"); if (b) b.addEventListener("click", () => { example = true; refreshAvy(); });
    const sh = $("avShade"); if (sh) sh.addEventListener("click", () => avyBtn.click());
  }

  // ---------- slope shading ----------
  // Terrain heights: AWS Terrain Tiles (Terrarium colour code), 256 px, up to zoom 14 here.
  const DEM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
  const demCache = new Map();
  function demTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (demCache.has(key)) { const p = demCache.get(key); demCache.delete(key); demCache.set(key, p); return p; }
    const p = fetch(DEM(z, x, y)).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); }).then(createImageBitmap).then((bmp) => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 256;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0, 256, 256);
      const px = cx.getImageData(0, 0, 256, 256).data, e = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
      e.z = z;
      return e;
    });
    p.catch(() => demCache.delete(key));
    demCache.set(key, p);
    if (demCache.size > 80) demCache.delete(demCache.keys().next().value);
    return p;
  }
  // Heights for a tile. With no connection, Skiing's offline areas only have the terrain down to zoom 12 (OFFLINE_DEM_Z):
  // a closer tile is then cut from the one that holds it, up to 3 zooms out, and enlarged. E.z says which zoom the
  // heights really come from, so the slope maths can allow for the coarser detail.
  async function dem(z, x, y) {
    for (let up = 0; ; up++) {
      try {
        const P = await demTile(z - up, x >> up, y >> up);
        if (!up) return P;
        const s = 2 ** up, ox = ((x % s) * 256) / s, oy = ((y % s) * 256) / s, E = new Float32Array(65536);
        for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
          const fx = Math.min(254.999, ox + (px + 0.5) / s - 0.5), fy = Math.min(254.999, oy + (py + 0.5) / s - 0.5);
          const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), ax = Math.max(0, fx - x0), ay = Math.max(0, fy - y0), i = y0 * 256 + x0;
          E[py * 256 + px] = (P[i] * (1 - ax) + P[i + 1] * ax) * (1 - ay) + (P[i + 256] * (1 - ax) + P[i + 257] * ax) * ay;
        }
        E.z = z - up;
        return E;
      } catch (e) { if (up >= 3 || z - up <= 8) throw e; }
    }
  }
  const tileLat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
  const tileLon = (x, z) => (x / 2 ** z) * 360 - 180;
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const COLORS = DANGER.map((d) => rgb(d.color));
  // Pixels at low zoom are hundreds of metres wide, which flattens slopes: ask for less steepness there.
  const minSlope = (z) => (z >= 12 ? 25 : z === 11 ? 21 : z === 10 ? 17 : z === 9 ? 13 : 10);
  // The danger on one slope, from its band's rating moved by its direction and steepness (alex 2026-10-27: "the red
  // zone based on slope aspect and angle too, not just the alpine"): one level less where the slope faces away from
  // today's avalanche problems in its band (only when there are problems there) and one less under 30°; one more at
  // 40° and steeper on a problem aspect, where most accidents happen. Never past Extreme or below Low.
  function slopeLevel(r, hit, probs, slope) {
    if (!r) return 0;
    let lv = r;
    if (probs && !hit) lv--;
    if (slope < 30) lv--;
    else if (hit && slope >= 40) lv++;
    return Math.max(1, Math.min(5, lv));
  }
  async function paint(z, x, y) {
    const data = example ? exampleData() : avy;
    const out = new ImageData(256, 256);
    if (!data) return out;
    // Which forecast area each 16 px block is in.
    const B = 16, areas = new Array(B * B);
    let any = false;
    for (let by = 0; by < B; by++) for (let bx = 0; bx < B; bx++) {
      const lat = tileLat(y + (by + 0.5) / B, z), lon = tileLon(x + (bx + 0.5) / B, z);
      const a = data.areas.find((a) => a.box && lat >= a.box[0] && lat <= a.box[2] && lon >= a.box[1] && lon <= a.box[3] && a.polys.some((p) => inPoly(lat, lon, p)));
      const d = a && dayOf(a.forecast);
      areas[by * B + bx] = d ? { a, d } : null;
      if (d) any = true;
    }
    if (!any) return out;
    const E = await dem(z, x, y), o = out.data, thr = minSlope(E.z), k = 25 / thr;
    for (let py = 0; py < 256; py++) {
      const lat = tileLat(y + (py + 0.5) / 256, z), m = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
      const y0 = py > 0 ? py - 1 : py, y1 = py < 255 ? py + 1 : py;
      for (let px = 0; px < 256; px++) {
        const cell = areas[(py >> 4) * B + (px >> 4)];
        if (!cell) continue;
        const i = py * 256 + px, e = E[i];
        if (e < 0) continue;
        const x0 = px > 0 ? px - 1 : px, x1 = px < 255 ? px + 1 : px;
        const dzdx = (E[py * 256 + x1] - E[py * 256 + x0]) / ((x1 - x0) * m), dzdy = (E[y1 * 256 + px] - E[y0 * 256 + px]) / ((y1 - y0) * m);
        const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI * k;
        if (slope < 25) continue;
        const { a, d } = cell;
        const band = e >= a.bands.hi ? "alp" : e >= a.bands.lo ? "tln" : "btl", r = d[band];
        if (!r) continue;
        // Downhill direction: east = -dz/dx, north = +dz/dy (pixel rows run south).
        const asp = ((Math.atan2(-dzdx, dzdy) * 180) / Math.PI + 360) % 360, sector = Math.round(asp / 45) % 8;
        const hit = a.mask[band] & (1 << sector), lv = slopeLevel(r, hit, a.mask[band], slope);
        let alpha = slope < 30 ? 0.3 : slope < 45 ? 0.55 : 0.42;
        let [cr, cg, cb] = COLORS[lv];
        if (hit) { alpha = Math.min(0.85, alpha + 0.22); if ((px + py) % 7 < 2) { cr *= 0.45; cg *= 0.45; cb *= 0.45; } }
        const j = i * 4;
        o[j] = cr; o[j + 1] = cg; o[j + 2] = cb; o[j + 3] = alpha * 255;
      }
    }
    return out;
  }

  // 2D map layer
  map.createPane("avy").style.zIndex = 360;
  const AvyGrid = L.GridLayer.extend({
    createTile(c, done) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      paint(c.z, c.x, c.y).then((img) => { cv.getContext("2d").putImageData(img, 0, 0); done(null, cv); }, (e) => done(e, cv));
      return cv;
    },
  });
  const avyGrid = new AvyGrid({ pane: "avy", minZoom: 8, maxNativeZoom: 14, maxZoom: 20, attribution: 'Avalanche forecast: <a href="https://avalanche.ca">Avalanche Canada</a> · Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a>' });

  // Adds a layer to the 3D map now, or once it's free. isStyleLoaded() is false for as long as any tile is still
  // loading, and "styledata" only comes on a style change, so waiting on those (as before) could wait forever on a
  // 3D map that keeps loading tiles: the shading and slope layers then never showed in 3D (alex, 2026-10-24).
  // Each apply throws while the style isn't ready (getStyle() is empty then: it used to return quietly, so the layer was
  // never added until something else redrew it; Snow forecast stayed off a wide 3D view for minutes, alex 2026-10-29),
  // and is tried again on the next style change or idle, whichever comes first.
  function whenStyle(gl, apply) {
    try { apply(); } catch {
      const again = () => { try { apply(); } catch { return; } gl.off("styledata", again); gl.off("idle", again); };
      gl.on("styledata", again); gl.on("idle", again);
    }
  }
  // 3D map layer, through a tile protocol that paints the same tiles as PNGs.
  let ver = 0, protocol = false;
  function sync3d() {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    if (!protocol) {
      protocol = true;
      maplibregl.addProtocol("tfavy", async (params) => {
        const [z, x, y] = params.url.replace("tfavy://", "").split("?")[0].split("/").map(Number);
        // A picture, not PNG bytes: encoding a canvas on the page waits for the 3D map's drawing (see map3d.js tfdem).
        return { data: await createImageBitmap(await paint(z, x, y)) };
      });
    }
    const want = sport === "ski" && avyOn;
    const apply = () => {
      if (!gl.getStyle()) throw new Error("3D style not ready");
      const has = !!gl.getLayer("avy");
      if (!want) { if (has) gl.removeLayer("avy"); if (gl.getSource("avy")) gl.removeSource("avy"); return; }
      const tiles = [`tfavy://{z}/{x}/{y}?v=${ver}`];
      if (gl.getSource("avy")) gl.getSource("avy").setTiles(tiles);
      else gl.addSource("avy", { type: "raster", tiles, tileSize: 256, minzoom: 8, maxzoom: 14, attribution: "Avalanche forecast: <a href=\"https://avalanche.ca\">Avalanche Canada</a>" });
      if (!has) gl.addLayer({ id: "avy", type: "raster", source: "avy", paint: { "raster-fade-duration": 0 } }, gl.getLayer("osm-roads") ? "osm-roads" : undefined);
    };
    whenStyle(gl, apply);
  }
  window.addEventListener("tf:map3d", sync3d);

  // ---------- slope angle: any day, with or without a forecast ----------
  // The usual avalanche-terrain colours (as on CalTopo, onX and FATMAP): 27° is about where slabs start to slide,
  // 30-45° is where most avalanches start.
  // Or FATMAP's (alex 2026-10-26): from 25°, cream to crimson. The Canadian colours stay the default: they're the ones
  // Avalanche Canada's courses and CalTopo use.
  const PALETTES = {
    ca: { label: "Canadian", bands: [[27, "27-29°", "#f2e14c", "27°"], [30, "30-34°", "#f59f00", "30°"], [35, "35-39°", "#e8392f", "35°"], [40, "40-44°", "#9c36b5", "40°"], [45, "45°+", "#1c3faa", "45°+"]], alpha: 150 },
    fatmap: { label: "FATMAP", bands: [[25, "25-29°", "#fff3a8", "25°"], [30, "30-34°", "#fdc55d", "30°"], [35, "35-39°", "#f98e3d", "35°"], [40, "40-44°", "#e8402f", "40°"], [45, "45°+", "#c2185b", "45°+"]], alpha: 165 },
  };
  let slopePal = store.get("slopePal", "ca") === "fatmap" ? "fatmap" : "ca";
  let SLOPE = PALETTES[slopePal].bands, SLOPE_RGB = SLOPE.map((x) => rgb(x[2]));
  function setSlopePal(k) {
    slopePal = PALETTES[k] ? k : "ca"; store.set("slopePal", slopePal);
    SLOPE = PALETTES[slopePal].bands; SLOPE_RGB = SLOPE.map((x) => rgb(x[2]));
    $("skSlopeKey").innerHTML = "";
    delete thumbs.slope; thumbSlope();
    if (map.hasLayer(slopeGrid)) slopeGrid.redraw();
    const gl = window.trailMap3d;
    if (gl && gl.getSource && gl.getSource("skislope")) gl.getSource("skislope").setTiles([`tfslope://{z}/{x}/{y}?p=${slopePal}`]);
    renderSwitches(); refreshSlope(); renderBars();
  }
  async function paintSlope(z, x, y) {
    const out = new ImageData(256, 256), E = await dem(z, x, y), o = out.data, k = 25 / minSlope(E.z), a = PALETTES[slopePal].alpha;
    for (let py = 0; py < 256; py++) {
      const lat = tileLat(y + (py + 0.5) / 256, z), m = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
      const y0 = py > 0 ? py - 1 : py, y1 = py < 255 ? py + 1 : py;
      for (let px = 0; px < 256; px++) {
        const i = py * 256 + px;
        if (E[i] < 0) continue;
        const x0 = px > 0 ? px - 1 : px, x1 = px < 255 ? px + 1 : px;
        const dzdx = (E[py * 256 + x1] - E[py * 256 + x0]) / ((x1 - x0) * m), dzdy = (E[y1 * 256 + px] - E[y0 * 256 + px]) / ((y1 - y0) * m);
        const slope = ((Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI) * k;
        if (slope < SLOPE[0][0]) continue;
        const c = SLOPE_RGB[slope >= 45 ? 4 : slope >= 40 ? 3 : slope >= 35 ? 2 : slope >= 30 ? 1 : 0], j = i * 4;
        o[j] = c[0]; o[j + 1] = c[1]; o[j + 2] = c[2]; o[j + 3] = a;
      }
    }
    return out;
  }
  map.createPane("skislope").style.zIndex = 355;
  const SlopeGrid = L.GridLayer.extend({
    createTile(c, done) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      paintSlope(c.z, c.x, c.y).then((img) => { cv.getContext("2d").putImageData(img, 0, 0); done(null, cv); }, (e) => done(e, cv));
      return cv;
    },
  });
  const slopeGrid = new SlopeGrid({ pane: "skislope", minZoom: 9, maxNativeZoom: 14, maxZoom: 20, attribution: 'Slope angle: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a>' });
  let slopeProtocol = false;
  function syncSlope3d() {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    if (!slopeProtocol) {
      slopeProtocol = true;
      maplibregl.addProtocol("tfslope", async (params) => {
        const [z, x, y] = params.url.replace("tfslope://", "").split("?")[0].split("/").map(Number);
        return { data: await createImageBitmap(await paintSlope(z, x, y)) };   // a picture, not PNG bytes (see avy above)
      });
    }
    const want = sport === "ski" && shown.has("slope");
    const apply = () => {
      if (!gl.getStyle()) throw new Error("3D style not ready");
      const has = !!gl.getLayer("skislope");
      if (!want) { if (has) gl.removeLayer("skislope"); if (gl.getSource("skislope")) gl.removeSource("skislope"); return; }
      if (!gl.getSource("skislope")) gl.addSource("skislope", { type: "raster", tiles: [`tfslope://{z}/{x}/{y}?p=${slopePal}`], tileSize: 256, minzoom: 9, maxzoom: 14, attribution: "Slope angle: Mapzen Terrain Tiles" });
      if (!has) gl.addLayer({ id: "skislope", type: "raster", source: "skislope", paint: { "raster-fade-duration": 0 } }, gl.getLayer("avy") ? "avy" : gl.getLayer("osm-roads") ? "osm-roads" : undefined);
    };
    whenStyle(gl, apply);
  }
  window.addEventListener("tf:map3d", syncSlope3d);
  function refreshSlope() {
    const want = sport === "ski" && shown.has("slope");
    if (want && !map.hasLayer(slopeGrid)) slopeGrid.addTo(map);
    else if (!want && map.hasLayer(slopeGrid)) map.removeLayer(slopeGrid);
    syncSlope3d();
    const key = $("skSlopeKey");
    key.hidden = !want;
    if (want && !key.innerHTML) key.innerHTML = `<b>Slope angle</b>${SLOPE.map((x) => `<span><i style="background:${x[2]}"></i>${x[1]}</span>`).join("")}`;
  }

  // ---------- slope direction, runout zones and terrain traps ----------
  // A map layer painted tile by tile from the terrain, on the flat map and on the 3D map (the same tiles as pictures).
  function paintedLayer(id, paintFn, o) {
    map.createPane(id).style.zIndex = o.z;
    const Grid = L.GridLayer.extend({
      createTile(c, done) {
        const cv = document.createElement("canvas");
        cv.width = cv.height = 256;
        paintFn(c.z, c.x, c.y).then((img) => { cv.getContext("2d").putImageData(img, 0, 0); done(null, cv); }, (e) => done(e, cv));
        return cv;
      },
    });
    const grid = new Grid({ pane: id, minZoom: o.minZoom, maxNativeZoom: o.maxNative || 14, maxZoom: 20, opacity: o.opacity || 1, attribution: o.attribution });
    let proto = false, want = false;
    const url = () => `tf${id}://{z}/{x}/{y}?v=${o.ver ? o.ver() : 0}`;
    function sync3d() {
      const gl = window.trailMap3d;
      if (!gl || !window.maplibregl) return;
      if (!proto) {
        proto = true;
        maplibregl.addProtocol("tf" + id, async (params) => {
          const [z, x, y] = params.url.replace(`tf${id}://`, "").split("?")[0].split("/").map(Number);
          return { data: await createImageBitmap(await paintFn(z, x, y)) };   // a picture, not PNG bytes (see avy above)
        });
      }
      const apply = () => {
        if (!gl.getStyle()) throw new Error("3D style not ready");
        const has = !!gl.getLayer(id);
        if (!want) { if (has) gl.removeLayer(id); if (gl.getSource(id)) gl.removeSource(id); return; }
        const src = gl.getSource(id);
        if (!src) gl.addSource(id, { type: "raster", tiles: [url()], tileSize: 256, minzoom: o.minZoom, maxzoom: o.maxNative || 14, attribution: o.attribution3d || "Terrain: Mapzen Terrain Tiles" });
        else if (src.tiles && src.tiles[0] !== url()) later3d(src);
        if (!has) gl.addLayer({ id, type: "raster", source: id, paint: { "raster-fade-duration": 0, "raster-opacity": o.opacity || 1 } }, gl.getLayer("avy") ? "avy" : gl.getLayer("osm-roads") ? "osm-roads" : undefined);
      };
      whenStyle(gl, apply);
    }
    // A new picture of the layer in 3D (Snow forecast after more points came in, the hourly update) loads every tile
    // of it again and repaints all the ground under it. At most once every 4 s, and not in the first 5 s back in the
    // app or while it's away: alex's iPhone restarted in 3D right after turning on Snow and rain forecast and right
    // after coming back to the app (2026-10-30), when everything else on the map is loading too.
    let lastSet = 0, setT = 0, shownAt = 0;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) shownAt = Date.now(); });
    function later3d(src) {
      const wait = Math.max(lastSet + 4000, shownAt + 5000) - Date.now();
      if (wait <= 0 && !document.hidden) { lastSet = Date.now(); src.setTiles([url()]); return; }
      if (!setT) setT = setTimeout(() => { setT = 0; sync3d(); }, Math.max(wait, 1000));
    }
    window.addEventListener("tf:map3d", sync3d);
    const set = (on) => {
      want = on;
      if (on && !map.hasLayer(grid)) grid.addTo(map);
      else if (!on && map.hasLayer(grid)) map.removeLayer(grid);
      sync3d();
    };
    set.redraw = () => { if (map.hasLayer(grid)) grid.redraw(); sync3d(); };   // after o.ver() changed
    return set;
  }
  // Slope direction (as CalTopo and onX shade it): slopes of 25° and more coloured by the way they face, so the
  // forecast's problem aspects (its rose) can be found on the map.
  const ASPECT_COLORS = ["#1c7ed6", "#0ca678", "#74b816", "#fab005", "#f76707", "#e03131", "#ae3ec9", "#5c5fd6"];
  const ASPECT_RGB = ASPECT_COLORS.map(rgb);
  async function paintAspect(z, x, y) {
    const out = new ImageData(256, 256), E = await dem(z, x, y), o = out.data, k = 25 / minSlope(E.z);
    for (let py = 0; py < 256; py++) {
      const lat = tileLat(y + (py + 0.5) / 256, z), m = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
      const y0 = py > 0 ? py - 1 : py, y1 = py < 255 ? py + 1 : py;
      for (let px = 0; px < 256; px++) {
        const i = py * 256 + px;
        if (E[i] < 0) continue;
        const x0 = px > 0 ? px - 1 : px, x1 = px < 255 ? px + 1 : px;
        const dzdx = (E[py * 256 + x1] - E[py * 256 + x0]) / ((x1 - x0) * m), dzdy = (E[y1 * 256 + px] - E[y0 * 256 + px]) / ((y1 - y0) * m);
        if (((Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI) * k < 25) continue;
        const c = ASPECT_RGB[Math.round((((Math.atan2(-dzdx, dzdy) * 180) / Math.PI + 360) % 360) / 45) % 8], j = i * 4;
        o[j] = c[0]; o[j + 1] = c[1]; o[j + 2] = c[2]; o[j + 3] = 140;
      }
    }
    return out;
  }
  // Runout zones: ground below steep slopes (30° and more, at least 50 m higher) that an avalanche from them could
  // reach: a line 24° down from a start zone (a typical avalanche path's "alpha angle"), up to 1 km away, with no
  // ridge in between. A start zone is a 100 m block with at least a quarter of its ground at 30° or more, so a few
  // steep pixels in the forest don't count. Terrain traps: in a runout zone, a gully or creek bed (ground 5 m or more higher on at least 5 of 8 sides
  // about 75 m away), where even a small slide piles up deep. Worked out on zoom 12 tiles (about 25 m pixels) with the
  // 8 tiles around for slopes just off the edge; closer zooms are cut from them. 0 = nothing, 1 = runout, 2 = trap.
  const RUN_M = 1000, RUN_DEG = 24, RZ = 12;
  const runCache = new Map();
  function runoutTile(x, y) {
    const key = x + "/" + y;
    if (runCache.has(key)) return runCache.get(key);
    const p = (async () => {
      const tiles = await Promise.all([-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => dem(RZ, x + dx, y + dy).catch(() => null))));
      if (!tiles[4]) throw new Error("no terrain");
      const lat = tileLat(y + 0.5, RZ), m = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** RZ);
      const M = Math.ceil(RUN_M / m) + 4, W = 256 + 2 * M, H = new Float32Array(W * W).fill(NaN);
      for (let yy = 0; yy < W; yy++) for (let xx = 0; xx < W; xx++) {
        const gx = xx - M + 256, gy = yy - M + 256, t = tiles[Math.floor(gy / 256) * 3 + Math.floor(gx / 256)];
        if (t) H[yy * W + xx] = t[(gy & 255) * 256 + (gx & 255)];
      }
      // Start zones, per 4 x 4 pixel block: the highest steep pixel in it.
      const B = 4, NB = Math.ceil(W / B), src = new Float32Array(NB * NB).fill(-Infinity), cnt = new Uint8Array(NB * NB), k30 = Math.tan((30 * Math.PI) / 180) / (25 / minSlope(RZ));
      for (let yy = 1; yy < W - 1; yy++) for (let xx = 1; xx < W - 1; xx++) {
        const i = yy * W + xx, e = H[i];
        if (!(e > -100)) continue;
        const g = Math.hypot(H[i + 1] - H[i - 1], H[i + W] - H[i - W]) / (2 * m);
        if (g >= k30) { const b = Math.floor(yy / B) * NB + Math.floor(xx / B); cnt[b]++; if (e > src[b]) src[b] = e; }
      }
      for (let b = 0; b < src.length; b++) if (cnt[b] < 4) src[b] = -Infinity;
      const out = new Uint8Array(65536), tanA = Math.tan((RUN_DEG * Math.PI) / 180), RB = Math.ceil(RUN_M / (B * m)), rr = Math.round(75 / m);
      // Every 2 x 2 pixels (about 50 m): enough for a map, four times quicker.
      for (let py = 0; py < 256; py += 2) for (let px = 0; px < 256; px += 2) {
        const yy = py + M, xx = px + M, i = yy * W + xx, e = H[i];
        if (!(e > -100)) continue;
        const g = Math.hypot(H[i + 1] - H[i - 1], H[i + W] - H[i - W]) / (2 * m);
        if (g >= k30) continue;   // a start zone itself: Slope angle shows those
        const bx = Math.floor(xx / B), by = Math.floor(yy / B);
        let hit = false;
        for (let dy = -RB; dy <= RB && !hit; dy++) for (let dx = -RB; dx <= RB && !hit; dx++) {
          const sb = src[(by + dy) * NB + bx + dx];
          if (!(sb - e >= 50)) continue;
          const sx = (bx + dx) * B + B / 2, sy = (by + dy) * B + B / 2, d = Math.hypot((sx - xx) * m, (sy - yy) * m);
          if (d > RUN_M || sb - e < tanA * d) continue;
          // No ridge in between: the ground halfway is lower than the start zone and not well above the line down.
          const mid = H[Math.round((sy + yy) / 2) * W + Math.round((sx + xx) / 2)];
          if (mid <= sb && mid <= (sb + e) / 2 + 40) hit = true;
        }
        if (!hit) continue;
        let higher = 0;
        for (let a = 0; a < 8; a++) { const v = H[(yy + Math.round(-Math.cos(a * Math.PI / 4) * rr)) * W + xx + Math.round(Math.sin(a * Math.PI / 4) * rr)]; if (v - e >= 5) higher++; }
        const val = higher >= 5 ? 2 : 1;
        out[py * 256 + px] = out[py * 256 + px + 1] = out[(py + 1) * 256 + px] = out[(py + 1) * 256 + px + 1] = val;
      }
      return out;
    })();
    p.catch(() => runCache.delete(key));
    runCache.set(key, p);
    if (runCache.size > 60) runCache.delete(runCache.keys().next().value);
    return p;
  }
  async function paintRunout(z, x, y) {
    const out = new ImageData(256, 256), o = out.data;
    if (z < RZ) return out;
    const s = 2 ** (z - RZ), R = await runoutTile(x >> (z - RZ), y >> (z - RZ)), ox = (x % s) * (256 / s), oy = (y % s) * (256 / s);
    for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
      const v = R[Math.floor(oy + py / s) * 256 + Math.floor(ox + px / s)];
      if (!v) continue;
      const j = (py * 256 + px) * 4;
      if (v === 2) { const st = ((px + py) >> 2) % 2; o[j] = st ? 88 : 140; o[j + 1] = st ? 24 : 40; o[j + 2] = st ? 110 : 160; o[j + 3] = 200; }
      else { o[j] = 214; o[j + 1] = 51; o[j + 2] = 108; o[j + 3] = 80; }
    }
    return out;
  }
  const aspectLayer = paintedLayer("skiaspect", paintAspect, { z: 356, minZoom: 9, attribution: 'Slope direction: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a>' });
  const runoutLayer = paintedLayer("skirunout", paintRunout, { z: 357, minZoom: RZ, attribution: 'Runout zones (estimate): <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a>' });
  function refreshTerrainLayers() {
    const a = sport === "ski" && shown.has("aspect"), r = sport === "ski" && shown.has("runout");
    aspectLayer(a); runoutLayer(r);
    const key = $("skLayerKey");
    key.hidden = !a && !r;
    key.innerHTML = (a ? `<div class="sk-keyrow"><b>Slope faces</b>${ASPECTS.map((s2, i) => `<span><i style="background:${ASPECT_COLORS[i]}"></i>${s2.toUpperCase()}</span>`).join("")}</div>` : "")
      + (r ? `<div class="sk-keyrow"><b>Runout</b><span><i style="background:rgba(214,51,108,.45)"></i>avalanches can reach</span><span><i style="background:repeating-linear-gradient(135deg,#8c28a0 0 3px,#58186e 3px 6px)"></i>terrain trap</span>${map.getZoom() < RZ ? `<span class="sk-note">zoom in to see it</span>` : ""}</div>
        <p class="sk-note">A rough estimate from the terrain, for planning: big avalanches can run further.</p>` : "");
  }
  map.on("zoomend", () => { if (sport === "ski" && shown.has("runout")) refreshTerrainLayers(); });

  // ---------- flats and elevation bands (FATMAP's Flats and Elevation layers) ----------
  // Flats: ground under 5°, where you skate, pole or skin out (and a splitboard goes back to walk mode).
  const FLAT_DEG = 5, FLAT_RGB = rgb("#20c997");
  async function paintFlats(z, x, y) {
    const out = new ImageData(256, 256), E = await dem(z, x, y), o = out.data, k = 25 / minSlope(E.z);
    for (let py = 0; py < 256; py++) {
      const lat = tileLat(y + (py + 0.5) / 256, z), m = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
      const y0 = py > 0 ? py - 1 : py, y1 = py < 255 ? py + 1 : py;
      for (let px = 0; px < 256; px++) {
        const i = py * 256 + px;
        if (E[i] < 0) continue;   // the sea
        const x0 = px > 0 ? px - 1 : px, x1 = px < 255 ? px + 1 : px;
        const dzdx = (E[py * 256 + x1] - E[py * 256 + x0]) / ((x1 - x0) * m), dzdy = (E[y1 * 256 + px] - E[y0 * 256 + px]) / ((y1 - y0) * m);
        if (((Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI) * k >= FLAT_DEG) continue;
        const j = i * 4;
        o[j] = FLAT_RGB[0]; o[j + 1] = FLAT_RGB[1]; o[j + 2] = FLAT_RGB[2]; o[j + 3] = 115;
      }
    }
    return out;
  }
  // Elevation bands: the forecast's below treeline, treeline and alpine, at the heights used for the forecast area
  // there (ski-terrain.js bandsFor), with a dark line where one band meets the next.
  const ELEV = [["btl", "Below treeline", "#40c057", 55], ["tln", "Treeline", "#fcc419", 75], ["alp", "Alpine", "#9775fa", 85]];
  const ELEV_RGB = ELEV.map((x) => rgb(x[2]));
  async function paintElev(z, x, y) {
    if (!avy && !avyErr) await (loadAvy() || Promise.resolve()).catch(() => {});
    const out = new ImageData(256, 256), E = await dem(z, x, y), o = out.data;
    const B = 16, bands = new Array(B * B);
    for (let by = 0; by < B; by++) for (let bx = 0; bx < B; bx++) {
      const a = avy ? areaAt(tileLat(y + (by + 0.5) / B, z), tileLon(x + (bx + 0.5) / B, z)) : null;
      bands[by * B + bx] = a ? a.bands : DEFAULT_BANDS;
    }
    const bandIx = (i, b) => (E[i] >= b.hi ? 2 : E[i] >= b.lo ? 1 : 0);
    for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
      const i = py * 256 + px;
      if (E[i] < 0) continue;
      const b = bands[(py >> 4) * B + (px >> 4)], v = bandIx(i, b), j = i * 4;
      const edge = (px < 255 && bandIx(i + 1, b) !== v) || (py < 255 && bandIx(i + 256, b) !== v);
      if (edge) { o[j] = 33; o[j + 1] = 37; o[j + 2] = 41; o[j + 3] = 210; continue; }
      const c = ELEV_RGB[v];
      o[j] = c[0]; o[j + 1] = c[1]; o[j + 2] = c[2]; o[j + 3] = ELEV[v][3];
    }
    return out;
  }
  const flatsLayer = paintedLayer("skiflats", paintFlats, { z: 354, minZoom: 11, attribution: 'Flats: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a>' });
  let elevVer = 0;
  const elevLayer = paintedLayer("skielev", paintElev, { z: 353, minZoom: 9, ver: () => elevVer, attribution: 'Elevation bands: Avalanche Canada areas, <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</a>' });

  // ---------- snow on the map: new snow and the snow forecast (FATMAP's Live snow) ----------
  // Open-Meteo's weather model (free, no key) on a grid of points, a tenth of a degree apart close up (coarser zoomed
  // out), asked 100 points at a time; each map tile blends the 4 grid points around each pixel. Kept for 2 hours.
  // Open-Meteo allows 600 places a minute from one phone or computer (loam, weather cards and this share it). The 3D map
  // asks for far more tiles than the flat one (out to Vancouver Island from Squamish: ~700 places in a few seconds), so
  // the last requests were refused and their squares stayed bare for an hour: dark patches and a dark far distance in the
  // pale snow tint, which looked like the map never loaded (alex, 2026-10-29). Now at most SNOW_PER_MIN places a minute
  // are asked, a refused or failed request is asked again (after the minute, up to 4 times), and a tile drawn before all
  // its points came is drawn again once they're in.
  // Open-Meteo also stops answering for the rest of the hour after 5,000 places (and the day after 10,000), shared with
  // loam and the weather cards; a refused request can't even be read, so the app can't tell which limit it was. A few
  // hours of panning the 3D map got there and Whistler stayed dark inside a pale tint (alex 2026-10-29: "it lag"). So
  // the grid is kept on the phone for 2 hours (opening the app again asks nothing), at most SNOW_PER_HOUR places an
  // hour are asked, refusals in a row wait longer each time (1, 10, then 30 minutes), and a square whose points are
  // missing is coloured from the points around it instead of left bare.
  const SNOW_CM = [[1, "#d0ebff"], [5, "#91a7ff"], [10, "#748ffc"], [20, "#9775fa"], [30, "#da77f2"], [50, "#f783ac"], [80, "#e64980"]];
  const SNOW_RGB = SNOW_CM.map(([v, c]) => [v, ...rgb(c)]);
  // Rain in the same layers, in greens (alex 2026-10-29: "if it is rain in the valley you can show it in the same layer
  // as snow"): where less than 1 cm of snow comes, the rain (mm) is coloured instead, so the valleys aren't left bare.
  const RAIN_MM = [[1, "#d3f9d8"], [5, "#8ce99a"], [10, "#51cf66"], [25, "#2f9e44"], [50, "#1b6e30"]];
  const RAIN_RGB = RAIN_MM.map(([v, c]) => [v, ...rgb(c)]);
  // Tiles stop at zoom 10 (maxNative): the grid is 7-11 km between points, so closer tiles only drew the same colours
  // with 4x as many pieces, and every piece arriving repaints the 3D ground under it (half the 3D map's lag with Snow
  // forecast on, measured over Whistler).
  // Far away (the 3D map's horizon) a point every half degree is plenty, and every degree at zoom 7 and out.
  const snowStep = (z) => (z >= 9 ? 0.1 : z >= 8 ? 0.5 : 1);
  const SNOW_KEEP_MS = 2 * 3600000, SNOW_SAVE = "tf:snowGrid", SNOW_USE = "tf:snowUse";   // not synced settings
  // "step|i|j" -> { f: snow cm in the last 24 h, n: snow cm in the next 3 days, rf / rn: rain mm the same, at } or { err, at }
  const snowGrid = new Map();
  const snowAsk = new Map();    // waiting to be asked: key -> { lat, lon, done: [resolve], tries }
  const SNOW_PER_MIN = 250, SNOW_PER_HOUR = 2000, SNOW_TRIES = 4, SNOW_WAIT_MS = 800;
  let snowTimer = 0, snowVer = 0, snowPause = 0, snowRefused = 0, snowSaveT = 0;
  let snowSent = [];   // [time, places] in the last hour, kept on the phone so opening the app again counts them
  try {
    const now = Date.now();
    snowSent = (JSON.parse(localStorage.getItem(SNOW_USE)) || []).filter((x) => now - x[0] < 3600000);
    for (const [k, f, n, rf, rn, at] of JSON.parse(localStorage.getItem(SNOW_SAVE)) || []) if (now - at < SNOW_KEEP_MS) snowGrid.set(k, { f, n, rf, rn, at });
  } catch {}
  const snowSave = () => {
    if (snowSaveT) return;
    snowSaveT = setTimeout(() => {
      snowSaveT = 0;
      const now = Date.now(), keep = [];
      const r1 = (x) => Math.round(x * 10) / 10;
      for (const [k, v] of snowGrid) if (!v.err && now - v.at < SNOW_KEEP_MS) keep.push([k, r1(v.f), r1(v.n), r1(v.rf), r1(v.rn), v.at]);
      try { localStorage.setItem(SNOW_SAVE, JSON.stringify(keep.slice(-4000))); localStorage.setItem(SNOW_USE, JSON.stringify(snowSent)); } catch {}
    }, 3000);
  };
  const snowLater = (ms) => { if (!snowTimer) snowTimer = setTimeout(snowFlush, ms); };
  function snowFlush() {
    snowTimer = 0;
    const now = Date.now();
    if (now < snowPause) return snowLater(snowPause - now);
    snowSent = snowSent.filter((x) => now - x[0] < 3600000);
    const used = (ms) => snowSent.reduce((a, x) => a + (now - x[0] < ms ? x[1] : 0), 0);
    const room = Math.min(SNOW_PER_MIN - used(60000), SNOW_PER_HOUR - used(3600000));
    // Close-up points first: a wide 3D view asks hundreds of far-away ones first, which used up the minute's places
    // before the mountains in front were asked (Whistler stayed bare for 2 minutes in a test).
    const all = [...snowAsk.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).slice(0, Math.max(0, room));
    for (const [k] of all) snowAsk.delete(k);
    if (snowAsk.size) {
      // The next time some room frees up: a minute after the oldest of this minute's, or of this hour's when that's full.
      const full = SNOW_PER_HOUR - used(3600000) <= 0, from = snowSent.find((x) => now - x[0] < (full ? 3600000 : 60000));
      snowLater(from ? Math.max(1000, from[0] + (full ? 3600000 : 60000) - now) : 1000);
    }
    for (let s = 0; s < all.length; s += 100) {
      const part = all.slice(s, s + 100);
      snowSent.push([now, part.length]);
      fetch(`${WX}?latitude=${part.map(([, p]) => p.lat.toFixed(3)).join(",")}&longitude=${part.map(([, p]) => p.lon.toFixed(3)).join(",")}&hourly=snowfall,rain&past_hours=24&forecast_hours=72&timezone=GMT`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((j) => {
          snowRefused = 0;
          const list = Array.isArray(j) ? j : [j];
          part.forEach(([k, p], i) => {
            const h = list[i] && list[i].hourly, sf = (h && h.snowfall) || [], ra = (h && h.rain) || [];
            let f = 0, n = 0, rf = 0, rn = 0;
            sf.forEach((v, q) => { if (q < 24) f += v || 0; else n += v || 0; });
            ra.forEach((v, q) => { if (q < 24) rf += v || 0; else rn += v || 0; });
            snowGrid.set(k, h ? { f, n, rf, rn, at: Date.now() } : { err: true, at: Date.now() });
            p.done.forEach((d) => d());
          });
          snowSave();
        })
        .catch(() => {
          // Refused (too many this minute, hour or day) or no signal: asked again later, waiting longer after each
          // refusal in a row. The tiles already drew what they had (missing squares filled from around them).
          const wait = [65000, 600000, 1800000][Math.min(2, snowRefused++)];
          snowPause = Math.max(snowPause, Date.now() + wait);
          part.forEach(([k, p]) => {
            if (++p.tries < SNOW_TRIES) { const w = snowAsk.get(k); if (w) w.done.push(...p.done); else snowAsk.set(k, p); return; }
            snowGrid.set(k, { err: true, at: Date.now() - SNOW_KEEP_MS + 10 * 60000 }); p.done.forEach((d) => d());   // asked again in 10 min
          });
          snowSave();
          snowLater(snowPause - Date.now());
        });
    }
    snowSave();
  }
  function snowPoint(step, i, j) {
    const k = `${step}|${i}|${j}`, v = snowGrid.get(k);
    if (v && Date.now() - v.at < SNOW_KEEP_MS) return Promise.resolve(v);
    return new Promise((ok) => {
      const w = snowAsk.get(k) || { lat: i * step, lon: j * step, done: [], tries: 0 };
      w.done.push(() => ok(snowGrid.get(k)));
      snowAsk.set(k, w);
      snowLater(150);   // the tiles of one view are all asked for at once: all of them, so the close ones go first
    });
  }
  // Tiles drawn with points still missing are drawn again when those come (all of them at once, under a second later).
  // A tile doesn't wait longer than SNOW_WAIT_MS (one Open-Meteo answer): a waiting tile holds one of the map's
  // download places, which the Winter photos need too. It waited 3 s before, and the ground filled in slower after
  // each move (alex's recording, 2026-10-29); it now draws the coarse grid or the points around meanwhile.
  let snowAgain = 0;
  const snowRedraw = () => { if (!snowAgain) snowAgain = setTimeout(() => { snowAgain = 0; snowVer++; freshLayer.redraw(); snowfcLayer.redraw(); }, 700); };
  // The half-degree (then one-degree) grid's blend at a spot, from the points already in, or null.
  function snowCoarse(lat, lon) {
    for (const st of [0.5, 1]) {
      const fi = lat / st, fj = lon / st, i = Math.floor(fi), j = Math.floor(fj), ty = fi - i, tx = fj - j;
      const p = [[i, j], [i, j + 1], [i + 1, j], [i + 1, j + 1]].map(([a, b]) => snowGrid.get(`${st}|${a}|${b}`));
      if (p.some((v) => !v || v.err || Date.now() - v.at >= SNOW_KEEP_MS)) continue;
      const mix = (k) => ((p[0][k] || 0) * (1 - tx) + (p[1][k] || 0) * tx) * (1 - ty) + ((p[2][k] || 0) * (1 - tx) + (p[3][k] || 0) * tx) * ty;
      return { f: mix("f"), n: mix("n"), rf: mix("rf"), rn: mix("rn") };
    }
    return null;
  }
  // Missing points (not answered yet, or refused) take the average of the points next to them, a few rounds out, so a
  // missing point leaves no bare square in the tint.
  function snowFill(vals, R, C) {
    for (let round = 0; round < 4; round++) {
      const miss = [];
      for (let q = 0; q < vals.length; q++) if (Number.isNaN(vals[q])) miss.push(q);
      if (!miss.length || miss.length === vals.length) return;
      const next = miss.map((q) => {
        const r = (q / C) | 0, c = q % C;
        let t = 0, n = 0;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= R || cc >= C) continue;
          const v = vals[rr * C + cc];
          if (!Number.isNaN(v)) { t += v; n++; }
        }
        return n ? t / n : NaN;
      });
      miss.forEach((q, m) => { vals[q] = next[m]; });
    }
  }
  const snowColor = (cm, scale = SNOW_RGB) => {
    if (!(cm >= scale[0][0])) return null;
    for (let q = scale.length - 1; q >= 0; q--) if (cm >= scale[q][0]) {
      const a = scale[q], b = scale[q + 1];
      if (!b) return a.slice(1);
      const t = (cm - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
    return null;
  };
  const paintSnowBy = (field, rainField) => async (z, x, y) => {
    const out = new ImageData(256, 256), o = out.data, s = snowStep(z);
    const top = tileLat(y, z), bottom = tileLat(y + 1, z), left = tileLon(x, z), right = tileLon(x + 1, z);
    const i0 = Math.floor(bottom / s), i1 = Math.ceil(top / s), j0 = Math.floor(left / s), j1 = Math.ceil(right / s);
    const R = i1 - i0 + 1, C = j1 - j0 + 1, vals = new Float32Array(R * C).fill(NaN), rain = new Float32Array(R * C).fill(NaN), jobs = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) jobs.push(snowPoint(s, i, j).then((v) => {
      if (v && !v.err) { vals[(i - i0) * C + (j - j0)] = v[field]; rain[(i - i0) * C + (j - j0)] = v[rainField] || 0; }
    }));
    const all = Promise.all(jobs);
    let partial = false;
    await Promise.race([all, new Promise((ok) => setTimeout(() => { partial = true; ok(); }, SNOW_WAIT_MS))]);
    // Drawn again as each missing point comes, not only once all of them have: after a refusal the last ones can take
    // half an hour, and the ones already in should show.
    if (partial) jobs.forEach((j) => j.then(snowRedraw));
    // A close-up point still missing takes the far-away grid's value there when that's in (asked first after opening).
    if (s < 0.5) for (let q = 0; q < vals.length; q++) if (Number.isNaN(vals[q])) {
      const v = snowCoarse((i0 + ((q / C) | 0)) * s, (j0 + (q % C)) * s);
      if (v) { vals[q] = v[field]; rain[q] = v[rainField] || 0; }
    }
    snowFill(vals, R, C); snowFill(rain, R, C);
    const blend = (g, ia, ja, tx, ty) => {
      const a = g[ia * C + ja], b = g[ia * C + ja + 1], c = g[(ia + 1) * C + ja], d = g[(ia + 1) * C + ja + 1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;   // NaN when a point is missing
    };
    for (let py = 0; py < 256; py++) {
      const fi = tileLat(y + (py + 0.5) / 256, z) / s - i0, ia = Math.floor(fi), ty = fi - ia;
      for (let px = 0; px < 256; px++) {
        const fj = tileLon(x + (px + 0.5) / 256, z) / s - j0, ja = Math.floor(fj), tx = fj - ja;
        const sn = blend(vals, ia, ja, tx, ty);
        if (Number.isNaN(sn)) continue;
        const col = snowColor(sn) || snowColor(blend(rain, ia, ja, tx, ty), RAIN_RGB);
        if (!col) continue;
        const k = (py * 256 + px) * 4;
        o[k] = col[0]; o[k + 1] = col[1]; o[k + 2] = col[2]; o[k + 3] = 150;
      }
    }
    return out;
  };
  const snowAttr = 'Snow: <a href="https://open-meteo.com/">Open-Meteo</a> weather model';
  const freshLayer = paintedLayer("skifresh", paintSnowBy("f", "rf"), { z: 352, minZoom: 6, maxNative: 10, ver: () => snowVer, attribution: snowAttr, attribution3d: "Snow: Open-Meteo" });
  const snowfcLayer = paintedLayer("skisnowfc", paintSnowBy("n", "rn"), { z: 351, minZoom: 6, maxNative: 10, ver: () => snowVer, attribution: snowAttr, attribution3d: "Snow: Open-Meteo" });
  // New numbers every hour: repaint the tiles then.
  setInterval(() => { if (sport === "ski" && (shown.has("fresh") || shown.has("snowfc"))) { snowVer++; freshLayer.redraw(); snowfcLayer.redraw(); } }, 3600000);
  function refreshMoreLayers() {
    const on = (k) => sport === "ski" && shown.has(k);
    flatsLayer(on("flats")); elevLayer(on("elev")); freshLayer(on("fresh")); snowfcLayer(on("snowfc"));
    renderBars();
  }

  // ---------- the colour keys on the map ----------
  // FATMAP showed a thin key across the top of the map for each shaded layer; here they sit at the top left, on the flat
  // and the 3D map. A tap opens the Layers menu (where the slope colours can be changed).
  const bars = L.control({ position: "topleft" });
  bars.onAdd = () => {
    const el = L.DomUtil.create("div", "sk-bars");
    el.id = "skBars"; el.hidden = true;
    L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el);
    el.addEventListener("click", (e) => {
      if (!e.target.closest(".sk-bar")) return;
      const lb = document.getElementById("layersBtn");
      if (lb && lb.getAttribute("aria-expanded") !== "true") lb.click();
    });
    return el;
  };
  bars.addTo(map);
  function renderBars() {
    const el = $("skBars");
    if (!el) return;
    const bar = (title, cells) => `<button type="button" class="sk-bar" title="Tap to change the layers"><span class="bt">${esc(title)}</span><span class="bc">${cells.map((c) => `<i style="background:${c[0]}"></i>`).join("")}</span><span class="bl">${cells.map((c) => `<span>${esc(c[1])}</span>`).join("")}</span></button>`;
    const out = [];
    if (sport === "ski") {
      if (avyOn) out.push(bar("Avalanche danger, slopes 25°+", DANGER.slice(1).map((d) => [d.color, d.label.replace(/^\d /, "").replace("Considerable", "Consid.")])));
      if (shown.has("slope")) out.push(bar(slopePal === "fatmap" ? "Slope angle (FATMAP)" : "Slope angle", SLOPE.map((s) => [s[2], s[3]])));
      if (shown.has("aspect")) out.push(bar("Slope direction, 25°+", ASPECTS.map((s, i) => [ASPECT_COLORS[i], s.toUpperCase()])));
      if (shown.has("runout")) out.push(bar(map.getZoom() < RZ ? "Runout zones: zoom in" : "Runout zones", [["rgba(214,51,108,.6)", "can reach"], ["repeating-linear-gradient(135deg,#8c28a0 0 3px,#58186e 3px 6px)", "trap"]]));
      if (shown.has("flats")) out.push(bar(map.getZoom() < 11 ? "Flats: zoom in" : "Flats", [[`rgba(${FLAT_RGB.join(",")},.6)`, `under ${FLAT_DEG}°`]]));
      if (shown.has("elev")) out.push(bar("Elevation bands", ELEV.map((e) => [e[2], e[1].replace("Below treeline", "Below TL")])));
      const cm = SNOW_CM.slice(0, 6).map(([v, c], i) => [c, i === 5 ? `${v}+` : String(v)]);
      const mm = RAIN_MM.map(([v, c], i) => [c, i === RAIN_MM.length - 1 ? `${v}+` : String(v)]);
      if (shown.has("fresh")) out.push(bar("New snow, last 24 h (cm)", cm), bar("Rain instead, last 24 h (mm)", mm));
      if (shown.has("snowfc")) out.push(bar("Snow coming, next 3 days (cm)", cm), bar("Rain instead, next 3 days (mm)", mm));
    }
    el.innerHTML = out.join("");
    el.hidden = !out.length;
  }
  map.on("zoomend", () => { if (sport === "ski") renderBars(); });

  // The slope colours choice, in the Layers menu under the tiles while Slope angle is on.
  function renderPalRow() {
    const row = $("skPalRow");
    if (!row) return;
    row.hidden = !shown.has("slope");
    row.innerHTML = `Slope colours:${Object.entries(PALETTES).map(([k, p]) => `<button type="button" data-pal="${k}" aria-pressed="${k === slopePal}">${esc(p.label)}</button>`).join("")}`;
  }
  lm.addEventListener("click", (e) => { const b = e.target.closest("[data-pal]"); if (b) { e.preventDefault(); setSlopePal(b.dataset.pal); } });

  // ---------- picture tiles: small painted pieces of real mountain (Blackcomb and Spearhead) ----------
  const THUMB_AT = [50.075, -122.87], THUMB_Z = 12;
  let thumbsOn = false;
  const thumbXY = () => { const n = 2 ** THUMB_Z, r = (THUMB_AT[0] * Math.PI) / 180; return [Math.floor(((THUMB_AT[1] + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)]; };
  // Light on the snow from the north-west, a little blue in the shadows, like FATMAP's winter map.
  function snowBase(E, y) {
    const img = new ImageData(256, 256), o = img.data, lat = tileLat(y + 0.5, THUMB_Z), m = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** THUMB_Z);
    for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
      const i = py * 256 + px, x0 = Math.max(0, px - 1), x1 = Math.min(255, px + 1), y0 = Math.max(0, py - 1), y1 = Math.min(255, py + 1);
      const dx = (E[py * 256 + x1] - E[py * 256 + x0]) / ((x1 - x0) * m), dy = (E[y1 * 256 + px] - E[y0 * 256 + px]) / ((y1 - y0) * m);
      const len = Math.hypot(dx, dy, 1), lit = Math.max(0, (dx * -0.5 + dy * 0.5 + 0.7) / len);   // light from the north-west, 45° up
      const v = 0.45 + 0.55 * Math.min(1, lit), j = i * 4;
      o[j] = 205 * v + 30; o[j + 1] = 215 * v + 30; o[j + 2] = 225 * v + 30; o[j + 3] = 255;
    }
    return img;
  }
  // Avalanche risk needs a forecast: the tile shows a made-up day (low below treeline, moderate at treeline,
  // considerable in the alpine), the way the layer looks in winter.
  function avyThumb(E, y) {
    const img = new ImageData(256, 256), o = img.data, lat = tileLat(y + 0.5, THUMB_Z), m = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** THUMB_Z), k = 25 / minSlope(E.z);
    for (let py = 1; py < 255; py++) for (let px = 1; px < 255; px++) {
      const i = py * 256 + px, dx = (E[i + 1] - E[i - 1]) / (2 * m), dy = (E[i + 256] - E[i - 256]) / (2 * m);
      if (((Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI) * k < 25) continue;
      const c = COLORS[E[i] >= DEFAULT_BANDS.hi ? 3 : E[i] >= DEFAULT_BANDS.lo ? 2 : 1], j = i * 4;
      o[j] = c[0]; o[j + 1] = c[1]; o[j + 2] = c[2]; o[j + 3] = 150;
    }
    return img;
  }
  let thumbBase = null;
  async function thumbOf(k, paintFn) {
    const [x, y] = thumbXY(), E = await dem(THUMB_Z, x, y);
    if (!thumbBase) { thumbBase = document.createElement("canvas"); thumbBase.width = thumbBase.height = 256; thumbBase.getContext("2d").putImageData(snowBase(E, y), 0, 0); }
    const over = document.createElement("canvas"); over.width = over.height = 256;
    over.getContext("2d").putImageData(await paintFn(E, x, y), 0, 0);
    const cv = document.createElement("canvas"); cv.width = cv.height = 112;
    const cx = cv.getContext("2d");
    cx.drawImage(thumbBase, 0, 0, 112, 112); cx.drawImage(over, 0, 0, 112, 112);
    thumbs[k] = cv.toDataURL("image/jpeg", 0.82);
  }
  const thumbSlope = () => thumbsOn && thumbOf("slope", (E, x, y) => paintSlope(THUMB_Z, x, y)).then(renderSwitches, () => {});
  function makeThumbs() {
    if (thumbsOn) return;
    thumbsOn = true;
    const jobs = [["avy", (E, x, y) => avyThumb(E, y)], ["slope", (E, x, y) => paintSlope(THUMB_Z, x, y)], ["aspect", (E, x, y) => paintAspect(THUMB_Z, x, y)],
      ["runout", (E, x, y) => paintRunout(THUMB_Z, x, y)], ["flats", (E, x, y) => paintFlats(THUMB_Z, x, y)], ["elev", (E, x, y) => paintElev(THUMB_Z, x, y)]];
    jobs.reduce((p, [k, f]) => p.then(() => thumbOf(k, f)).then(renderSwitches, () => {}), Promise.resolve());   // one at a time, each shown when ready
  }
  document.getElementById("layersBtn")?.addEventListener("click", () => { if (sport === "ski") makeThumbs(); });

  function refreshAvy() {
    ver++;
    const want = sport === "ski" && avyOn;
    if (want && !avy && !example) loadAvy();
    if (want) { if (!map.hasLayer(avyGrid)) avyGrid.addTo(map); else avyGrid.redraw(); }
    else if (map.hasLayer(avyGrid)) map.removeLayer(avyGrid);
    sync3d();
    renderForecast();
    fillSpotAvy();
    if (sport === "ski") renderList();   // the trip planner lights follow the forecast and the day picked
    if (selected && sport === "ski") { const d = $("skDetail"); if (!d.hidden) select(selected); }
    avyBtn.classList.toggle("on", avyOn);
    avyBtn.setAttribute("aria-pressed", String(avyOn));
    renderBars();
  }
  avyBtn.hidden = false;
  avyBtn.title = "Shade the slopes by the avalanche forecast (Avalanche Canada)";
  avyBtn.addEventListener("click", () => {
    avyOn = !avyOn; store.set("avy", avyOn);
    if (avyOn && oneGround("avy").length) applySwitches();
    if (avyOn && map.getZoom() < 9) map.setZoom(10);
    refreshAvy();
  });

  // ---------- ski heatmap (data/ski-heat.json) ----------
  // Per map square: cells of CELL_LAT x CELL_LON degrees as [row, col, traces, ...] from the square's south-west corner.
  let heat = null, heatLoading = null, heatErr = "", heatVer = 0;
  function loadHeat() {
    if (heat || heatLoading) return heatLoading;
    heatLoading = fetch("data/ski-heat.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => {
        const squares = Object.values(d.tiles || {}).filter((t) => t && t.box && t.c && t.c.length);
        heat = { cell: d.cell || [0.0003, 0.00045], builtAt: d.builtAt, squares: squares.map((t) => ({ box: t.box, c: Int32Array.from(t.c) })),
          traces: Object.values(d.tiles || {}).reduce((a, t) => a + ((t && t.n) || 0), 0) };
        heatVer++; renderSwitches(); refreshHeat();
      })
      .catch((e) => { heatErr = e.message; renderSwitches(); })
      .finally(() => { heatLoading = null; });
    return heatLoading;
  }
  const HEAT_RGB = HEAT.ramp.map(rgb);
  const mercY = (lat) => { const r = (lat * Math.PI) / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; };
  const heatLevel = (v) => (v === 1 ? 1 : v === 2 ? 2 : v <= 5 ? 3 : 4);
  function paintHeat(z, x, y) {
    const out = new ImageData(256, 256);
    if (!heat) return out;
    const n = 2 ** z * 256, top = tileLat(y, z), bottom = tileLat(y + 1, z), left = tileLon(x, z), right = tileLon(x + 1, z);
    const [cl, co] = heat.cell;
    const cw = (co / 360) * n;
    // Close up (a cell 3 px wide or more), squares of colour look blocky (alex, 2026-10-24): paint smooth lines.
    if (cw >= 3) return paintHeatSmooth(out, z, x, y, top, bottom, left, right, cl, co);
    const buf = new Uint16Array(65536), MIN_PX = z <= 10 ? 3 : 2.5;
    let any = false;
    for (const sq of heat.squares) {
      const [s, w, nn, e] = sq.box;
      if (s > top || nn < bottom || w > right || e < left) continue;
      const c = sq.c;
      for (let i = 0; i < c.length; i += 3) {
        const lat0 = s + c[i] * cl, lon0 = w + c[i + 1] * co;
        if (lat0 > top || lat0 + cl < bottom || lon0 > right || lon0 + co < left) continue;
        // Zoomed out a cell is under a pixel: each is drawn MIN_PX wide around its middle, so a single trace still
        // shows as a line (alex 2026-10-26: "i dont see much on the map").
        const pxc = ((lon0 + co / 2 + 180) / 360) * n - x * 256, pyc = mercY(lat0 + cl / 2) * n - y * 256;
        const hw = Math.max(MIN_PX, cw) / 2, hh = Math.max(MIN_PX, mercY(lat0) * n - mercY(lat0 + cl) * n) / 2;
        const xa = Math.max(0, Math.floor(pxc - hw)), xb = Math.min(256, Math.ceil(pxc + hw));
        const ya = Math.max(0, Math.floor(pyc - hh)), yb = Math.min(256, Math.ceil(pyc + hh));
        const v = c[i + 2];
        for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) { const j = yy * 256 + xx; if (buf[j] < v) buf[j] = v; }
        any = true;
      }
    }
    if (!any) return out;
    const o = out.data;
    for (let j = 0; j < 65536; j++) {
      const v = buf[j];
      if (!v) continue;
      const k = heatLevel(v) - 1;
      o[j * 4] = HEAT_RGB[k][0]; o[j * 4 + 1] = HEAT_RGB[k][1]; o[j * 4 + 2] = HEAT_RGB[k][2]; o[j * 4 + 3] = k ? 235 : 190;
    }
    return out;
  }
  // The cells as a smooth field, so a line of cells reads as a smooth line instead of a staircase of squares: the
  // cells are blurred a little (a Gaussian, 0.75 cell wide), then each pixel blends the 4 nearest cell centres. The
  // colour blends the trace counts of the cells around, so it fades from one count to the next instead of stepping.
  const HK = [0.015, 0.219, 0.532, 0.219, 0.015];
  function paintHeatSmooth(out, z, x, y, top, bottom, left, right, cl, co) {
    const o = out.data, best = new Float32Array(65536), col = new Float32Array(65536);
    // Where each pixel row and column falls (pixel rows follow Mercator, not degrees).
    const latOf = new Float64Array(256), lonOf = new Float64Array(256);
    for (let p = 0; p < 256; p++) { latOf[p] = tileLat(y + (p + 0.5) / 256, z); lonOf[p] = tileLon(x + (p + 0.5) / 256, z); }
    let any = false;
    for (const sq of heat.squares) {
      const [s, w, nn, e] = sq.box;
      if (s > top + 3 * cl || nn < bottom - 3 * cl || w > right + 3 * co || e < left - 3 * co) continue;
      // The square's cells that touch this tile (with 3 cells around it for the blur), on a small grid.
      const r0 = Math.floor((bottom - s) / cl) - 3, r1 = Math.ceil((top - s) / cl) + 3;
      const c0 = Math.floor((left - w) / co) - 3, c1 = Math.ceil((right - w) / co) + 3;
      const R = r1 - r0 + 1, C = c1 - c0 + 1, N = R * C, c = sq.c;
      const occ = new Float32Array(N), lev = new Float32Array(N);
      let has = false;
      for (let i = 0; i < c.length; i += 3) {
        const r = c[i] - r0, k = c[i + 1] - c0;
        if (r < 0 || k < 0 || r >= R || k >= C) continue;
        occ[r * C + k] = 1; lev[r * C + k] = heatLevel(c[i + 2]); has = true;
      }
      if (!has) continue;
      any = true;
      // Blur both, along rows then columns.
      const blur = (f) => {
        const t = new Float32Array(N), u = new Float32Array(N);
        for (let r = 0; r < R; r++) for (let k = 0; k < C; k++) {
          let v = 0;
          for (let d = -2; d <= 2; d++) { const kk = k + d; if (kk >= 0 && kk < C) v += f[r * C + kk] * HK[d + 2]; }
          t[r * C + k] = v;
        }
        for (let r = 0; r < R; r++) for (let k = 0; k < C; k++) {
          let v = 0;
          for (let d = -2; d <= 2; d++) { const rr = r + d; if (rr >= 0 && rr < R) v += t[rr * C + k] * HK[d + 2]; }
          u[r * C + k] = v;
        }
        return u;
      };
      const O = blur(occ), L = blur(lev);
      for (let py = 0; py < 256; py++) {
        const fr = (latOf[py] - s) / cl - 0.5 - r0, ra = Math.floor(fr), ty = fr - ra;
        if (ra < 0 || ra + 1 >= R) continue;
        for (let px = 0; px < 256; px++) {
          const fc = (lonOf[px] - w) / co - 0.5 - c0, ca = Math.floor(fc), tx = fc - ca;
          if (ca < 0 || ca + 1 >= C) continue;
          const i0 = ra * C + ca, i1 = i0 + C;
          const wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wc = (1 - tx) * ty, wd = tx * ty;
          const f = O[i0] * wa + O[i0 + 1] * wb + O[i1] * wc + O[i1 + 1] * wd, j = py * 256 + px;
          if (f < 0.2 || f <= best[j]) continue;
          best[j] = f;
          col[j] = (L[i0] * wa + L[i0 + 1] * wb + L[i1] * wc + L[i1 + 1] * wd) / f;   // the trace level of the cells around
        }
      }
    }
    if (!any) return out;
    for (let j = 0; j < 65536; j++) {
      const f = best[j];
      if (f < 0.22) continue;
      const edge = Math.min(1, (f - 0.22) / 0.1);   // soft, anti-aliased edge
      const lv = Math.max(0, col[j] - 1), k = Math.min(2, Math.floor(lv)), t = Math.min(1, lv - k), A = HEAT_RGB[k], B = HEAT_RGB[k + 1];
      o[j * 4] = A[0] + (B[0] - A[0]) * t; o[j * 4 + 1] = A[1] + (B[1] - A[1]) * t; o[j * 4 + 2] = A[2] + (B[2] - A[2]) * t;
      o[j * 4 + 3] = edge * (lv < 1 ? 190 + 45 * lv : 235);
    }
    return out;
  }
  map.createPane("skiheat").style.zIndex = 370;
  const HeatGrid = L.GridLayer.extend({
    createTile(c) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 256;
      cv.getContext("2d").putImageData(paintHeat(c.z, c.x, c.y), 0, 0);
      return cv;
    },
  });
  const heatGrid = new HeatGrid({ pane: "skiheat", minZoom: 7, maxNativeZoom: 16, maxZoom: 20, opacity: 0.85, attribution: 'Ski heatmap: <a href="https://www.openstreetmap.org/traces">OpenStreetMap public GPS traces</a> © OpenStreetMap contributors' });
  let heatProtocol = false;
  function syncHeat3d() {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    if (!heatProtocol) {
      heatProtocol = true;
      maplibregl.addProtocol("tfheat", async (params) => {
        const [z, x, y] = params.url.replace("tfheat://", "").split("?")[0].split("/").map(Number);
        return { data: await createImageBitmap(paintHeat(z, x, y)) };   // a picture, not PNG bytes (see avy above)
      });
    }
    const want = sport === "ski" && shown.has("heat") && !!heat;
    const apply = () => {
      if (!gl.getStyle()) throw new Error("3D style not ready");
      const has = !!gl.getLayer("skiheat");
      if (!want) { if (has) gl.removeLayer("skiheat"); if (gl.getSource("skiheat")) gl.removeSource("skiheat"); return; }
      const tiles = [`tfheat://{z}/{x}/{y}?v=${heatVer}`];
      if (gl.getSource("skiheat")) gl.getSource("skiheat").setTiles(tiles);
      else gl.addSource("skiheat", { type: "raster", tiles, tileSize: 256, minzoom: 7, maxzoom: 16, attribution: "Ski heatmap: OpenStreetMap public GPS traces" });
      if (!has) gl.addLayer({ id: "skiheat", type: "raster", source: "skiheat", paint: { "raster-fade-duration": 0, "raster-opacity": 0.85 } }, gl.getLayer("osm-roads") ? "osm-roads" : undefined);
    };
    whenStyle(gl, apply);
  }
  window.addEventListener("tf:map3d", syncHeat3d);
  function refreshHeat() {
    const want = sport === "ski" && shown.has("heat");
    if (want && !heat && !heatErr) loadHeat();
    if (want && heat) { if (!map.hasLayer(heatGrid)) heatGrid.addTo(map); else heatGrid.redraw(); }
    else if (map.hasLayer(heatGrid)) map.removeLayer(heatGrid);
    syncHeat3d();
  }

  // ---------- your ski tours (rides saved in Record ride, ride.html) ----------
  const mineLayer = L.layerGroup();
  let mine = [];
  function loadRides() {
    return new Promise((resolve) => {
      let r;
      try { r = indexedDB.open("trail-finder-rides", 1); } catch { resolve([]); return; }
      r.onupgradeneeded = () => {   // same stores as ride.html
        const db = r.result;
        db.createObjectStore("rides", { keyPath: "id" });
        db.createObjectStore("photos", { keyPath: "id" }).createIndex("rideId", "rideId");
        db.createObjectStore("current", { keyPath: "id" });
      };
      r.onerror = () => resolve([]);
      r.onsuccess = () => {
        const db = r.result;
        try {
          const q = db.transaction("rides").objectStore("rides").getAll();
          q.onsuccess = () => { db.close(); resolve(q.result || []); };
          q.onerror = () => { db.close(); resolve([]); };
        } catch { db.close(); resolve([]); }
      };
    });
  }
  // A ski tour: the file says so, the name says so, or it was in winter and went high (bike parks and alpine trails are under snow).
  const SKI_SPORT = /ski|snow|board/i, SKI_NAME = /\b(ski\w*|skin\w*|splitboard\w*|snowshoe\w*|backcountry|pow(der)?)\b/i;
  function isSkiTour(r) {
    if (!r || !Array.isArray(r.points) || r.points.length < 2 || r.sport === "hunt" || r.sport === "fish" || r.sport === "moto") return false;
    if (SKI_SPORT.test(r.sport || "") || SKI_NAME.test(r.title || "")) return true;
    const m = new Date(r.start).getMonth();
    if (!(m >= 10 || m <= 4)) return false;
    return r.points.some((p) => p[2] != null && p[2] >= 1300);
  }
  function loadMine() {
    return loadRides().then((all) => {
      mine = all.filter(isSkiTour).sort((a, b) => b.start - a.start);
      renderSwitches(); drawMine();
    });
  }
  function drawMine() {
    mineLayer.clearLayers();
    if (!shown.has("mine")) return;
    for (const r of mine) {
      const line = r.points.map((p) => [p[0], p[1]]);
      const when = new Date(r.start).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
      mineLayer.addLayer(L.polyline(line, { renderer: skiRenderer, color: "#fff", weight: 5, opacity: 0.7, interactive: false }));
      const l = L.polyline(line, { renderer: skiRenderer, color: MINE.color, weight: 2.5, opacity: 1 });
      l.bindTooltip(`${esc(r.title || "Ski tour")} · ${esc(when)}`, { sticky: true });
      l.on("click", (e) => { L.DomEvent.stopPropagation(e); location.href = "ride.html#ride/" + encodeURIComponent(r.id); });
      mineLayer.addLayer(l);
    }
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && sport === "ski") loadMine(); });

  // ---------- for other scripts ----------
  // navigate.js (recording a tour in Skiing): the slope under you. offline.js (Offline maps saved in Skiing): the
  // ski data files and the terrain tiles for slope shading, route heights and the avalanche shading, zooms 10 to
  // OFFLINE_DEM_Z (closer zooms are cut from those when offline, see dem()).
  const OFFLINE_DEM_Z = 12;
  window.tfSki = {
    // index.html's Saved tab (Skiing): the saved tours.
    tours: () => {
      if (sport !== "ski") setSport("ski");
      const t = document.querySelector('#tabbar [data-nav="ski"]');
      if (window.matchMedia("(max-width: 760px)").matches && t && t.getAttribute("aria-current") !== "true") t.click();
      setTimeout(showTours, 0);
    },
    // Ask in plain words (ask.js): the named routes of these types (all when null) and the huts within maxKm of c
    // ([lat, lon]), nearest first, the way the list shows them (same-name pieces as one) with their risk light.
    near: async (c, maxKm, types) => {
      await loadSki();
      if (!ski) return { routes: [], huts: [] };
      const b = L.latLng(c[0], c[1]).toBounds(maxKm * 2000), lim = maxKm * 1000;
      await loadCanIdx(); await loadCanada(b);
      const groups = new Map();
      for (const r of ski.routes || []) {
        if (!r.name || (types && !types.includes(r.type)) || !r.bounds || !b.intersects(r.bounds)) continue;
        const k = r.type + "|" + r.name.toLowerCase();
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
      }
      const routes = [...groups.values()].map((g) => {
        // cls: hand-kept routes not in the nightly terrain file yet have their class read from the guidebooks (data/ski-hand/ "hand:cls")
        const r = g[0], risk = riskOf(g);
        return { id: r.id, name: nameOf(r), type: r.type, label: (TYPES[r.type] || TYPES.other).label, km: g.reduce((s, y) => s + km(y), 0), d: awayM(c[0], c[1], g),
          cls: risk ? risk.c : +(g.find((y) => y.tags && y.tags["hand:cls"]) || { tags: {} }).tags["hand:cls"] || 0, diff: r.diff || "", classic: g.some((y) => y.tags && y.tags["hand:classic"]), pill: [riskPill(risk), diffPill(r.diff)].filter(Boolean).join(" "), c: [r.lines[0][0][0], r.lines[0][0][1]] };
      }).filter((x) => x.d <= lim).sort((x, y) => x.d - y.d);
      const huts = (ski.huts || []).map((h) => ({ name: h.name || "Hut", kind: KIND[h.kind] || "Hut", lat: h.lat, lon: h.lon, d: ptAway(c[0], c[1], h) }))
        .filter((h) => h.d <= lim).sort((x, y) => x.d - y.d);
      return { routes, huts };
    },
    showHut: async (lat, lon) => {
      if (sport !== "ski") setSport("ski");
      await loadSki();
      const h = (ski?.huts || []).find((x) => Math.abs(x.lat - lat) < 1e-5 && Math.abs(x.lon - lon) < 1e-5);
      if (h) select(h, true); else map.setView([lat, lon], 14);
    },
    // slackcountry.js: today's danger at a line's top, for its go/caution light (null until the forecast is loaded).
    dangerAt: (lat, lon, lo, hi) => { if (!avy && !example) loadAvy(); return dangerAt(lat, lon, lo, hi); },
    // freeride.js: every route loaded so far (home region and the Canada squares), loading the squares in bounds;
    // open one route's card.
    routes: () => (ski && ski.routes) || [],
    loadIn: async (b) => { await loadSki(); await loadCanIdx(); await loadCanada(b); return (ski && ski.routes) || []; },
    open: (r, fly) => { if (sport !== "ski") setSport("ski"); select(r, fly); const p = r.lines[0][Math.floor(r.lines[0].length / 2)]; cardInView($("skDetail"), p[0], p[1]); },
    slopeAt: async (lat, lon) => { const p = [{ lat, lon }]; await T.heights(p, 0, dem); return { slope: p[0].slope, e: p[0].e }; },
    // The 🔔 (notify.js): open a watched tour (by its route id) or a spot (a forecast area) in Skiing.
    show: async (k, c) => {
      if (sport !== "ski") setSport("ski");
      await loadSki();
      if (c && k && !(ski?.routes || []).some((x) => x.id === k)) { await loadCanIdx(); await loadCanada(L.latLngBounds([c, c]).pad(0.5)); }   // a tour elsewhere in Canada
      const r = k && (ski?.routes || []).find((x) => x.id === k);
      if (r) select(r, true); else if (c) map.setView(c, Math.max(map.getZoom(), k ? 13 : 10));
    },
  };
  // Plan a cabin trip (cabin-trip.js): the parts of Skiing a trip is built from.
  window.tfSki.trip = {
    loadSki: () => Promise.resolve(loadSki()).then(() => loadCanIdx()).then(() => ski),
    near: async (c, km) => { await loadSki(); await loadCanIdx(); const b = L.latLng(c[0], c[1]).toBounds(km * 2000); await loadCanada(b); return (ski?.routes || []).filter((r) => r.type !== "resort" && r.bounds && b.intersects(r.bounds)); },
    // No-go ground near c (after near() has loaded the squares): [{ pts: [[lat, lon], ...], name, why }].
    nogo: (c, km) => { const b = L.latLng(c[0], c[1]).toBounds(km * 2000); return (ski?.nogo || []).filter((n) => n.pts.some((p) => b.contains(p))); },
    info: (lines) => T.info(lines, dem),
    hours: (info) => tourHours(info),
    weather: (lat, lon, ele) => weather(lat, lon, ele),
    avy: () => (avy || example ? Promise.resolve() : avyErr ? Promise.reject(new Error(avyErr)) : loadAvy()),
    // The avalanche forecast on a date (yyyy-mm-dd) from lo to hi m: { r, band, area, d }, { none: "why" } without one.
    dangerOn: (lat, lon, lo, hi, date) => {
      const a = avy || example ? areaAt(lat, lon) : null, f = a && a.forecast;
      if (!f || !f.days || !f.days.length || (!example && f.validUntil && new Date(f.validUntil) < new Date())) return { none: "no forecast here today" };
      const i = f.days.findIndex((d) => d.date === date);
      if (i < 0) return { none: date < f.days[0].date ? "past" : "not forecast yet" };
      return dangerAt(lat, lon, lo, hi, i);
    },
    example: () => example,
    nearSnow: (lat, lon) => { if (!snow && !snowErr) loadSnow(); return nearSnow(lat, lon); },
    showStation: (id) => { const st = (snow?.stations || []).find((x) => x.id === id); if (st) { if (!shown.has("snow")) { shown.add("snow"); applySwitches(); } showStation(st); } },
    // The way in as a tour (src "trip"): the same card as a mapped route, with its conditions, Flyover, GPX and Go.
    route: (line, name, info) => {
      const r = { id: "trip", src: "trip", type: "tour", name, tags: {}, g: [line.flat()], lines: [line], bounds: L.latLngBounds(line) };
      if (info) r.info = info;
      return r;
    },
    select: (r) => select(r, true),
    selectHut: (h) => select(h, true),
    selected: () => selected,
    // Draw your own way in with Plan a tour, from pts (the hut's end of it, or what was there).
    plan: (pts) => { if (pts) { plan.pts = pts.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]); setTour(null); planChanged(); } setPlanning(true); },
    planPts: () => plan.pts.slice(),
    planning: () => plan.on,
    planOffer: (o) => planOffer(o),
    planRouteLine: (r) => planRouteLine(r),
    planVia: (line, name) => planVia(line, name),
    // Ask in plain words (ask.js), a tour typed as a plan of the day ("start at the top of Showcase, ski DOA, finish in
    // Lakeside Bowl"): every named route within maxKm of c of any kind (tours, resort runs, off-piste bowls) with its
    // lines, then the tour made from its pieces (the same points as tapped, a line's end carrying { via, name }).
    namedNear: async (c, maxKm) => {
      await loadSki(); await loadCanIdx();
      const b = L.latLng(c[0], c[1]).toBounds(maxKm * 2000);
      await loadCanada(b);
      return ((ski && ski.routes) || []).filter((r) => r.name && r.bounds && b.intersects(r.bounds) && r.lines && r.lines.length)
        .map((r) => ({ id: r.id, name: nameOf(r), type: r.type, diff: r.diff || "", area: !!r.area, aka: (r.tags && r.tags["hand:aka"]) || "", lines: r.lines }));
    },
    // Trailhead parking near c (km), nearest first (ask.js: where a typed tour starts when no start is said).
    parkingNear: async (c, maxKm) => { await loadSki(); return ((ski && ski.parking) || []).map((h) => ({ lat: h.lat, lon: h.lon, name: h.name || "", d: map.distance(c, [h.lat, h.lon]) })).filter((h) => h.d <= maxKm * 1000).sort((a, b) => a.d - b.d); },
    heightAt: async (lat, lon) => { const p = [{ lat, lon }]; await T.heights(p, 0, dem); return p[0].e; },
    planSet: (pts, o) => {
      if (sport !== "ski") setSport("ski");
      snap();
      plan.pts = pts.map((p) => (p[2] ? [+p[0].toFixed(6), +p[1].toFixed(6), p[2].via ? { ...p[2], via: noBackLine(p[2].via) } : p[2]] : [+p[0].toFixed(6), +p[1].toFixed(6)]));
      plan.path = null; plan.fail = ""; plan.show = true; setTour(null);   // a new tour, not the saved one that was open
      // A new tour starts with the Less exposed way off, turned on per tour (alex 2026-11-06): Ask's "Make it the less
      // exposed way" is that choice for this tour, in the same tap as making it (alex 2026-11-07: fewer steps).
      plan.safe = !!(o && o.safe); store.set("skiSafe", plan.safe);
      if (plan.on) { plan.on = false; map.getContainer().classList.remove("sk-planning"); }
      map.fitBounds(L.latLngBounds(pts.flatMap((p) => [[p[0], p[1]], ...((p[2] && p[2].via) || [])])), { padding: [40, 40], maxZoom: 15 });
      planChanged();
      keepTour(true);   // kept at once, like ✓ Done
      // A tour asked for a day ("tomorrow", ask.js): the forecast of that day, for the less exposed way and the map.
      if (o && o.date) (avy || example ? Promise.resolve() : loadAvy()).then(() => {
        const ar = areaAt(pts[0][0], pts[0][1]), f = ar && ar.forecast, i = f && f.days ? f.days.findIndex((d) => d.date === o.date) : -1;
        if (i >= 0 && i !== day) { day = i; refreshAvy(); plan.path = null; planChanged(); }
      }).catch(() => {});
      if (window.tfSnapTo) setTimeout(() => window.tfSnapTo("half"), 0);
      if (window.tfPanelScrollTo) setTimeout(() => window.tfPanelScrollTo($("skPlan")), 50);
    },
    loadJs: (n) => loadJs(n),
    KIND, HUT_ABOUT, DANGER, BANDS, WICON, COMPASS,
  };
  window.tfSkiOffline = (box) => {
    const tx = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
    const ty = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
    const tiles = [];
    for (let z = 10; z <= OFFLINE_DEM_Z; z++) for (let x = tx(box[1], z); x <= tx(box[3], z); x++) for (let y = ty(box[2], z); y <= ty(box[0], z); y++) tiles.push(DEM(z, x, y));
    const can = Object.entries(canIdx?.tiles || {}).filter(([, t]) => t.box[0] <= box[2] && t.box[2] >= box[0] && t.box[1] <= box[3] && t.box[3] >= box[1]).map(([k]) => k);
    const data = [...["ski", "ski-terrain", "avalanche", "avalanche-reports", "snow-stations", "snowmobile-clubs", "grooming", "ski-heat", "rogers-pass", "rogers-status", "freeride-lines", "slackcountry"].map((n) => "data/" + n), ...CAN_DIRS.map((d) => d + "index"), ...can].map((n) => new URL(`${n}.json`, location.href).href);
    return { data, tiles };
  };

  // ---------- switching sport ----------
  // Each sport's own scripts load only the first time that sport is picked (alex's fix list 2026-10-28: the first open
  // was 2.4 MB of scripts for every sport), so MTB opens without Hunting, Fishing, Skiing's extras or Moto. They run
  // in this order (the order they used to have in index.html), after the page's own scripts, and each one draws
  // itself for the sport that's on when it arrives. Same ?v= as this script, for the same cache rule.
  const jsVer = (document.currentScript && new URL(document.currentScript.src).search) || "";
  const SPORT_JS = ["crownland", "hunting", "fish-bait", "fish-route", "fishing", "compass", "webcams", "lifts", "rogers", "slackcountry", "freeride", "ski-areas", "helicat", "cabin-trip", "camper", "japanese", "japan-snow", "moto", "hike"];
  const NEEDS = {
    hunt: ["crownland", "hunting", "compass"],
    fish: ["crownland", "fish-bait", "fish-route", "fishing"],
    ski: ["webcams", "lifts", "rogers", "slackcountry", "freeride", "ski-areas", "helicat", "cabin-trip", "camper", "japanese", "japan-snow"],
    hike: ["hike"],
    moto: ["crownland", "hunting", "moto"],   // Moto's "Can I ride here" reads Hunting's parks and closures (window.tfHunt)
  };
  const jsLoads = {};
  const pageReady = new Promise((ok) => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", ok, { once: true }) : ok()));
  function loadJs(n) {
    if (jsLoads[n]) return jsLoads[n];
    const src = `${n}.js${jsVer}`;
    const pre = document.createElement("link"); pre.rel = "preload"; pre.as = "script"; pre.href = src;   // downloads now, runs below
    document.head.append(pre);
    return (jsLoads[n] = pageReady.then(() => new Promise((ok, no) => {
      const el = document.createElement("script"); el.src = src; el.async = false;   // in the order asked
      el.onload = ok; el.onerror = () => { delete jsLoads[n]; no(new Error(src)); };
      document.body.append(el);
    })));
  }
  const loadSport = (s) => Promise.all(SPORT_JS.filter((n) => (NEEDS[s] || []).includes(n)).map(loadJs));
  window.tfLoadSport = loadSport;
  window.tfLoadMoto = () => loadSport("moto");
  function setSport(s) {
    sport = SPORTS.includes(s) ? s : "mtb";
    loadSport(sport).catch(() => {});
    store.set("sport", sport);
    sel.value = sport;
    for (const s of SPORTS) document.body.classList.toggle(`sport-${s}`, sport === s);
    document.body.classList.toggle("sport-alt", sport !== "mtb");
    if (window.tfSyncResultsCol) window.tfSyncResultsCol();   // wide desktop: no empty MTB results column in Skiing or Hunting
    const mtb = window.tfMtbLayers || [];
    if (sport === "mtb") mtb.forEach((l) => { if (!map.hasLayer(l)) l.addTo(map); });
    else mtb.forEach((l) => map.removeLayer(l));
    if (sport === "ski") {
      skiLayer.addTo(map); hutLayer.addTo(map); hutNames.addTo(map); hutPins.addTo(map); pinLayer.addTo(map); parkLayer.addTo(map); mineLayer.addTo(map); clubLayer.addTo(map); snowLayer.addTo(map); aboveLayer.addTo(map);
      loadSki(); loadMine(); loadClubs(); if (shown.has("snow")) loadSnow(); renderSwitches(); renderList(); drawPlan(); renderPlan();
      if (plan.safe && plan.pts.length > 1 && !safePath() && !plan.wait && !plan.fail) planChanged();   // a way from another day (or the old demo forecast): today's
    } else {
      setPlanning(false);
      routeFocus(false);
      drawParking();
      drawHutPins();
      [skiLayer, hutLayer, hutNames, hutPins, pinLayer, parkLayer, mineLayer, clubLayer, hoverLayer, snowLayer, aboveLayer, plan.layer].forEach((l) => map.removeLayer(l));
    }
    // The map's ▶ Ride button records a ski tour in Skiing (navigate.js). The same word as the phone's tab: Ride in
    // the riding sports, Record in the others (interface review 2026-11-02 item 6; Hunting and Fishing said Ride).
    const rideBtn = document.getElementById("navRideBtn");
    if (rideBtn) rideBtn.textContent = sport === "mtb" || sport === "moto" ? "▶ Ride" : "▶ Record";
    refreshAvy(); refreshHeat(); refreshSlope(); refreshTerrainLayers(); refreshMoreLayers();
    map.invalidateSize({ pan: false });   // the map is wider in Skiing and Hunting on a wide desktop (no results column)
    window.dispatchEvent(new CustomEvent("tf:sport", { detail: sport }));
  }
  sel.addEventListener("change", () => setSport(sel.value));

  // ---------- the sport button on the map (alex: "make the sport mode easier to access, put an icon on the map") ----------
  // Shows the current sport's icon; one tap opens the three sports, a second tap switches. On phones it is the first
  // chip of the map's chip row, on wide screens it sits at the top of the map tools; the same on the 3D map.
  // [icon, name, short name for the map button when the name is too long for it]
  const SPORT_UI = { mtb: ["🚵", "MTB"], ski: ["⛷", "Skiing"], hunt: ["🦌", "Hunting"], fish: ["🎣", "Fishing"], moto: ["🏍", "Adventure moto", "Moto"], hike: ["🥾", "Hiking"] };
  // Line drawings like Layers, 3D and Me beside it (line-icons.js; interface review 2026-11-02 item 8).
  const line = (e, size) => (window.tfLine ? window.tfLine(e, size) : e);
  const tools = document.querySelector(".map-tools");
  let sportBtn = null, sportMenu = null;
  if (tools) {
    sportBtn = document.createElement("button");
    sportBtn.type = "button"; sportBtn.id = "sportMapBtn";
    sportBtn.setAttribute("aria-haspopup", "true"); sportBtn.setAttribute("aria-expanded", "false"); sportBtn.setAttribute("aria-controls", "sportMenu");
    sportMenu = document.createElement("div");
    sportMenu.className = "sport-menu"; sportMenu.id = "sportMenu"; sportMenu.hidden = true;
    sportMenu.setAttribute("role", "radiogroup"); sportMenu.setAttribute("aria-label", "Sport");
    sportMenu.innerHTML = `<div class="spm-head">Sport</div>` + SPORTS.map((s) =>
      `<button type="button" role="radio" data-sport="${s}" aria-checked="false"><span aria-hidden="true">${line(SPORT_UI[s][0], 22)}</span>${SPORT_UI[s][1]}</button>`).join("");
    tools.prepend(sportBtn, sportMenu);
    const setOpen = (open) => {
      sportMenu.hidden = !open;
      sportBtn.setAttribute("aria-expanded", String(open));
      sportBtn.classList.toggle("open", open);
      tools.classList.toggle("menu-open", open);   // over the map key, like the Layers menu
    };
    sportBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const lb = document.getElementById("layersBtn");   // one menu at a time
      if (lb && lb.getAttribute("aria-expanded") === "true") lb.click();
      setOpen(sportMenu.hidden);
    });
    sportMenu.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-sport]");
      if (!b) return;
      setOpen(false);
      if (b.dataset.sport !== sport) { sel.value = b.dataset.sport; sel.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    document.addEventListener("click", (e) => { if (!sportMenu.hidden && !sportMenu.contains(e.target) && !sportBtn.contains(e.target)) setOpen(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sportMenu.hidden) { setOpen(false); sportBtn.focus(); } });
  }
  const syncSportBtn = () => {
    if (!sportBtn) return;
    const [icon, name, short] = SPORT_UI[sport];
    sportBtn.innerHTML = `<span class="spb-i" aria-hidden="true">${line(icon, 24)}</span><span class="spb-l" aria-hidden="true">${short || name}</span><span class="spb-c" aria-hidden="true">▾</span>`;
    sportBtn.setAttribute("aria-label", `Sport: ${name}. Change sport`);
    sportBtn.title = `Sport: ${name} (tap to change)`;
    sportMenu.querySelectorAll("button[data-sport]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.sport === sport)));
  };
  window.addEventListener("tf:sport", syncSportBtn);
  setSport(sport);
})();
