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
  const map = window.tfLeaflet, sel = document.getElementById("sport"), avyBtn = document.getElementById("avyBtn");
  if (!map || !sel || !window.L) return;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {   // "tf:setting" tells account.js (optional sign-in) to save settings to the rider's account
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const TYPES = {
    tour: { label: "Ski touring", color: "#1f5fe0", weight: 3.5 },
    access: { label: "Ski access", color: "#1f5fe0", weight: 2.5, dashArray: "8 6" },
    nordic: { label: "Nordic / cross-country", color: "#0b9bb5", weight: 3 },
    snowshoe: { label: "Snowshoe", color: "#8b4fe0", weight: 3, dashArray: "6 5" },
    snowmobile: { label: "Snowmobile trails", color: "#c2255c", weight: 3, dashArray: "12 4" },
    resort: { label: "Ski resort runs", color: "#6b7787", weight: 2 },
    // Ungroomed in-bounds terrain (bowls, glades, chutes) inside a ski resort's boundary: resort skiing, not touring.
    offpiste: { label: "Resort off-piste and bowls", color: "#7a8fb8", weight: 2, dashArray: "5 4" },
    other: { label: "Other winter routes", color: "#8e9aab", weight: 2 },
  };
  // Sledding and tubing hills (type "sled") aren't drawn: alex asked to take out what isn't needed.
  const HUT = { label: "Huts and cabins", color: "#7a2e10" };
  const START = { label: "camptocamp route starts", color: "#d9480f" };   // drawn with Ski touring
  const HEAT = { label: "Ski heatmap", ramp: ["#2b59c3", "#00b4d8", "#ffd23f", "#ff6a1a"] };   // 1, 2, 3-5, 6+ traces
  const MINE = { label: "Your ski tours", color: "#e0218a" };
  const CLUB = { label: "Snowmobile clubs", color: "#c2255c" };
  // The four buttons at the top of the panel: each one turns its group of layers on or off (more than one can be on).
  const VIEWS = {
    tour: { icon: "⛷", label: "Touring", sub: "backcountry", layers: ["tour", "access", "other", "hut", "snow"] },
    nordic: { icon: "🎿", label: "Nordic", sub: "and snowshoe", layers: ["nordic", "snowshoe"] },
    sled: { icon: "🛷", label: "Snowmobile", sub: "trails, clubs", layers: ["snowmobile", "club"] },
    resort: { icon: "🚡", label: "Resorts", sub: "runs, bowls", layers: ["resort", "offpiste"] },
  };
  // The switches in the map's Layers menu: the two extras, then every single layer under "Single layers".
  const EXTRAS = ["slope", "snow", "heat", "mine"];
  const SINGLES = ["tour", "access", "other", "hut", "nordic", "snowshoe", "snowmobile", "club", "resort", "offpiste"];
  const SNOW = { label: "Snow stations", color: "#0b7285" };
  const LABEL = (k) => (TYPES[k] || { hut: HUT, heat: HEAT, mine: MINE, club: CLUB, snow: SNOW, slope: { label: "Slope angle" } }[k]).label;
  // Avalanche Canada's danger scale colours.
  const DANGER = [
    { label: "No rating", color: "#9aa3ad" }, { label: "1 Low", color: "#52ba4a" }, { label: "2 Moderate", color: "#fff300" },
    { label: "3 Considerable", color: "#f79218" }, { label: "4 High", color: "#ef1c29" }, { label: "5 Extreme", color: "#1a1a1a" },
  ];
  const BANDS = [["alp", "Alpine"], ["tln", "Treeline"], ["btl", "Below treeline"]];
  const ASPECTS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  // Where treeline sits, roughly (m): wetter coast ranges lower than the drier inland ranges (Duffey, Lillooet),
  // and highest in the Rockies (Kananaskis, Banff).
  const bandsFor = (area) => /rock|kananaskis|banff|yoho|jasper|purcell/i.test(area.name || "") ? { lo: 1900, hi: 2400 }
    : /inland|duffey|lillooet|chilcotin|cariboo|interior|columbia|selkirk|monashee|kootenay|boundary|glacier|lizard|flathead|okanagan|shuswap|thompson/i.test(area.name || "")
      ? { lo: 1700, hi: 2200 } : { lo: 1500, hi: 1900 };

  const css = document.createElement("style");
  css.textContent = `
.brand .sport-pick { font: inherit; font-size: .85rem; font-weight: 700; color: #fff; padding: 6px 28px 6px 12px; border-radius: 999px; cursor: pointer;
  background: rgba(255,255,255,.1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23fff' stroke-width='1.6'/%3E%3C/svg%3E") right 11px center no-repeat;
  border: 1px solid rgba(255,255,255,.28); appearance: none; -webkit-appearance: none; }
.brand .sport-pick:hover { background-color: rgba(255,255,255,.18); }
.brand .sport-pick option { color: #15211a; background: #fff; }
body.sport-alt .panel .modes, body.sport-alt .panel .pane, body.sport-alt #boxBtn, body.sport-alt .box-row-btns, body.sport-alt .tap-hint, body.sport-alt #boxRes,
body.sport-alt #status, body.sport-alt #debug, body.sport-alt #list, body.sport-alt #detail, body.sport-alt #allBtn,
body.sport-alt details.legend, body.sport-alt #searchArea { display: none !important; }
body:not(.sport-ski) #avyBtn, body:not(.sport-ski) #skiPane { display: none !important; }
.map-tools #avyBtn.on { background: #f79218; border-color: #f79218; color: #1a1a1a; }
#skiPane { display: flex; flex-direction: column; gap: 12px; font-size: .9rem; }
#skiPane .sk-hint { color: var(--muted); margin: 0; font-size: .85rem; }
#skiPane .sk-views { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
#skiPane .sk-view { font: inherit; font-size: .8rem; font-weight: 700; padding: 8px 2px; border-radius: 12px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; }
#skiPane .sk-view .ic { font-size: 1.3rem; line-height: 1.2; }
#skiPane .sk-view small { font-weight: 500; font-size: .66rem; color: var(--muted); white-space: nowrap; }
#skiPane .sk-view[aria-pressed="true"] { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
#skiPane .sk-view[aria-pressed="true"] small { color: #fff; }
#skiPane .sk-acts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#skiPane .sk-act { font: inherit; font-size: .88rem; font-weight: 700; padding: 10px 8px; border-radius: 12px; border: 1px solid var(--line); background: var(--chip); color: var(--fg); cursor: pointer; }
#skiPane .sk-act[aria-pressed="true"] { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
#skiPane .sk-slopekey { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: .78rem; }
#skiPane .sk-slopekey i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; opacity: .8; }
#skiPane .sk-plan p { margin: 0; font-size: .85rem; }
.sk-planning, .sk-planning .leaflet-interactive { cursor: crosshair !important; }
.sk-planbar { position: absolute; z-index: 1001; left: 50%; top: 12px; transform: translateX(-50%); display: flex; gap: 8px; align-items: center; max-width: calc(100% - 24px); box-sizing: border-box;
  background: var(--panel); color: var(--fg); border: 1px solid var(--line); border-radius: 999px; box-shadow: 0 6px 18px rgba(0,0,0,.2); padding: 6px 6px 6px 14px; font-size: .88rem; }
.sk-planbar span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sk-planbar button { font: inherit; font-weight: 700; border: 1px solid var(--line); border-radius: 999px; background: var(--chip); color: var(--fg); padding: 6px 12px; cursor: pointer; white-space: nowrap; }
.sk-planbar button.go { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
@media (max-width: 999px) { .sk-planbar { top: 70px; } }
#skiPane .sk-row { display: flex; flex-wrap: wrap; gap: 6px; }
#skiPane .sk-row .btn { font-size: .82rem; padding: 6px 10px; }
#skiPane .sk-warn { background: #fff0e0; color: #7a3b00; border-radius: 8px; padding: 6px 8px; font-size: .82rem; }
#skiPane .sk-spark { display: flex; align-items: flex-end; gap: 3px; height: 44px; }
#skiPane .sk-spark span { flex: 1; background: #74c0fc; border-radius: 2px 2px 0 0; min-height: 1px; position: relative; }
#skiPane .sk-spark span:last-child { background: #1f5fe0; }
#skiPane .sk-days { display: flex; gap: 3px; font-size: .66rem; color: var(--muted); }
#skiPane .sk-days span { flex: 1; text-align: center; }
.sk-snow { display: inline-block; transform: translate(-50%, -100%); white-space: nowrap; font: 700 11px/1 system-ui, sans-serif; color: #fff; background: #0b7285; border: 2px solid #fff; border-radius: 10px; padding: 3px 6px; box-shadow: 0 1px 3px #0006; }
.sk-snow.on { outline: 3px solid #ffe14d; }
.sk-snow.none { background: #6b7787; }
.sk-plan-pt { width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 3px solid #e8590c; box-sizing: border-box; }
body:not(.sport-ski) .lm-ski { display: none !important; }
.layers-menu .lm-ski { display: grid; gap: 6px; }
.layers-menu .lm-ski .lm-head { margin-top: 6px; }
.map-tools .layers-menu .lm-ski button.on { background: #1f5fe0; border-color: #1f5fe0; color: #fff; }
#skiPane .sk-sw { width: 18px; height: 4px; border-radius: 2px; flex: none; display: inline-block; }
#skiPane .sk-dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 0 0 1px #0003; flex: none; display: inline-block; }
#skiPane ul.sk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
#skiPane .sk-list li button { all: unset; box-sizing: border-box; width: 100%; display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 8px; cursor: pointer; }
#skiPane .sk-list li button:hover, #skiPane .sk-list li button[aria-current="true"] { background: var(--chip); }
#skiPane .sk-list .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
#skiPane .sk-list .meta { color: var(--muted); font-size: .78rem; white-space: nowrap; }
#skiPane .sk-card { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; background: var(--panel); display: flex; flex-direction: column; gap: 6px; }
#skiPane .sk-card h3 { margin: 0; font-size: 1rem; }
#skiPane .sk-card dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: .82rem; }
#skiPane .sk-card dt { color: var(--muted); }
#skiPane .sk-card dd { margin: 0; overflow-wrap: anywhere; }
#skiPane .sk-x { float: right; font: inherit; border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 1rem; }
#skiPane .av-days { display: flex; gap: 4px; flex-wrap: wrap; }
#skiPane .av-days button { font: inherit; font-size: .8rem; font-weight: 600; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; }
#skiPane .av-days button[aria-pressed="true"] { background: var(--fg); color: var(--panel); border-color: var(--fg); }
#skiPane .av-rate { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; font-size: .85rem; }
#skiPane .av-chip { font-weight: 700; font-size: .78rem; padding: 2px 8px; border-radius: 6px; text-align: center; min-width: 108px; }
#skiPane .av-prob { display: grid; grid-template-columns: 74px 1fr; gap: 10px; align-items: start; border-top: 1px solid var(--line); padding-top: 8px; }
#skiPane .av-prob b { display: block; }
#skiPane .av-prob p, #skiPane .av-card p { margin: 2px 0; font-size: .82rem; }
#skiPane .av-warn { background: #fff3cd; color: #5c4400; border-radius: 8px; padding: 6px 8px; font-size: .82rem; font-weight: 600; }
#skiPane .av-legend { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; font-size: .8rem; }
#skiPane .av-legend i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; border: 1px solid #0002; }
#skiPane details summary { cursor: pointer; font-weight: 600; font-size: .85rem; }
#skiPane details p { white-space: pre-line; }
.sk-pin { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px #0006; color: #fff; font-size: 12px; line-height: 1; }
.sk-pin.on { outline: 3px solid #ffe14d; }
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
#skiPane .ab-photos { margin: 0; }`;
  document.head.append(css);

  // ---------- the sport menu ----------
  const SPORTS = ["mtb", "ski", "hunt"];   // an old saved "hike" (Hiking, never built) opens MTB
  let sport = SPORTS.includes(store.get("sport", "mtb")) ? store.get("sport", "mtb") : "mtb";
  let avyOn = store.get("avy", false);

  // ---------- panel ----------
  const pane = document.createElement("section");
  pane.id = "skiPane";
  pane.setAttribute("aria-label", "Skiing");
  pane.innerHTML = `
    <div class="sk-views" id="skViews" role="group" aria-label="Show these routes"></div>
    <div class="sk-acts"><button type="button" class="sk-act" id="skPlanBtn">✎ Plan a tour</button><button type="button" class="sk-act" id="skRecBtn">▶ Record a tour</button></div>
    <div class="sk-slopekey" id="skSlopeKey" hidden></div>
    <div class="sk-card sk-plan" id="skPlan" hidden></div>
    <p class="sk-hint" id="skHint">Tap a route or a snow station for its details. More in <b>Layers</b> on the map.</p>
    <div class="sk-card" id="skStation" hidden></div>
    <div class="sk-card" id="skDetail" hidden></div>
    <div class="av-card sk-card" id="avCard" hidden></div>
    <details class="sk-card" id="sbCard" hidden><summary id="sbSum">Snowmobile clubs and grooming</summary><div id="sbBody"></div></details>
    <div><div class="label" id="skCount">Routes in view</div><ul class="sk-list" id="skList"></ul></div>
    <p class="sk-safe">Open maps can be wrong and no route is avalanche-safe: go with training, a beacon, probe and shovel, and the day's forecast.</p>`;
  const head = document.querySelector(".panel-head");
  const modes = head && head.querySelector(".modes");
  if (modes) modes.after(pane); else if (head) head.append(pane);
  const $ = (id) => document.getElementById(id);

  // ---------- ski routes ----------
  map.createPane("ski").style.zIndex = 420;
  const skiRenderer = L.canvas({ pane: "ski", padding: 0.3, tolerance: L.Browser.touch ? 10 : 5 });
  const skiLayer = L.layerGroup();
  const hutLayer = L.layerGroup();
  let ski = null, skiLoading = null, skiErr = "";
  // "skiLayers2": the simpler Skiing starts everyone again on Touring (and their own tours), the old 13 chips forgotten.
  let shown = new Set(store.get("skiLayers2", [...VIEWS.tour.layers, "mine"]));
  if (!store.get("skiSnowAdded", false)) { if (shown.has("tour")) shown.add("snow"); store.set("skiSnowAdded", true); store.set("skiLayers2", [...shown]); }
  let selected = null;   // route or hut object
  // A tour being planned: the points tapped on the map (kept on this device), drawn as an orange line.
  const plan = { on: false, pts: store.get("skiPlan", []), layer: L.layerGroup(), slopeWas: false, timer: 0 };
  const aboveLayer = L.layerGroup();   // drawAbove()
  const lineOf = (flat) => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
  const km = (r) => {
    if (r.km != null) return r.km;
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
  function loadSki() {
    if (ski || skiLoading) return skiLoading;
    skiLoading = fetch("data/ski.json", { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => {
        ski = d;
        (d.routes || []).forEach((r) => { r.lines = r.g.map(lineOf); r.bounds = L.latLngBounds(r.lines.flat()); });
        drawSki(); renderSwitches(); renderList();
      })
      .catch((e) => { skiErr = e.message; renderList(); })
      .finally(() => { skiLoading = null; });
    return skiLoading;
  }
  // A tap on a route, hut or start: its details, or, while planning a tour, the next point of the plan.
  const tap = (e, it) => { L.DomEvent.stopPropagation(e); if (plan.on) planAdd(e.latlng); else select(it); };
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
        const l = L.polyline(line, { renderer: skiRenderer, color: t.color, weight: t.weight + (sel ? 1.5 : 0), opacity: 1, dashArray: t.dashArray });
        l.bindTooltip(esc(nameOf(r) || t.label), { sticky: true });
        l.on("click", (e) => tap(e, r));
        skiLayer.addLayer(l);
      }
    }
    if (shown.has("hut")) for (const h of ski.huts || []) {
      const m = L.circleMarker([h.lat, h.lon], { renderer: skiRenderer, radius: selected === h ? 9 : 6, color: "#fff", weight: 2, fillColor: HUT.color, fillOpacity: 1 });
      m.bindTooltip(esc(h.name || "Hut"));
      m.on("click", (e) => tap(e, h));
      hutLayer.addLayer(m);
    }
    if (shown.has("tour")) for (const h of ski.starts || []) {
      const m = L.marker([h.lat, h.lon], { icon: L.divIcon({ className: "", html: `<span class="sk-pin${selected === h ? " on" : ""}" style="background:${START.color}">⛷</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }) });
      m.bindTooltip(esc(h.name || "camptocamp route"));
      m.on("click", (e) => tap(e, h));
      hutLayer.addLayer(m);
    }
  }
  // The four buttons in the panel, and the Skiing switches in the map's Layers menu.
  const lm = document.createElement("div");
  lm.className = "lm-ski";
  lm.innerHTML = `<div class="lm-head">Skiing</div><div class="lm-list" id="lmSkiExtras"></div>
    <details class="lm-more lm-ski-singles"><summary>Single layers</summary><div class="lm-list" id="lmSkiSingles"></div></details>`;
  if (avyBtn) { avyBtn.before(lm); lm.querySelector(".lm-head").after(avyBtn); }
  function renderSwitches() {
    $("skViews").innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button type="button" class="sk-view" data-view="${k}" aria-pressed="${v.layers.some((x) => shown.has(x))}"><span class="ic" aria-hidden="true">${v.icon}</span>${esc(v.label)}<small>${esc(v.sub)}</small></button>`).join("");
    const btn = (k) => {
      const on = shown.has(k), extra = k === "heat" && !heat ? (heatErr ? " (not yet)" : "") : k === "snow" && snowErr ? " (not yet)" : k === "mine" && !mine.length ? " (none yet)" : "";
      return `<button type="button" data-k="${k}" aria-pressed="${on}" class="${on ? "on" : ""}"${k === "heat" ? ' title="Public OpenStreetMap GPS traces from December to April, roads and lifts left out"' : k === "mine" ? ' title="Your tours from My rides (import or record them there)"' : k === "slope" ? ' title="Colours the slopes by steepness: 27° and up, where avalanches start"' : k === "snow" ? ' title="BC snow pillow stations: snow depth, new snow and temperature, every 2 hours"' : ""}>${esc(LABEL(k))}${extra}</button>`;
    };
    $("lmSkiExtras").innerHTML = EXTRAS.map(btn).join("");
    $("lmSkiSingles").innerHTML = SINGLES.map(btn).join("");
  }
  function applySwitches() {
    store.set("skiLayers2", [...shown]);
    if (shown.has("snow")) loadSnow();
    renderSwitches(); drawSki(); renderList(); refreshHeat(); refreshSlope(); drawMine(); drawClubs(); drawSnow(); renderClubs(); renderForecast();
  }
  $("skViews").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]"); if (!b) return;
    const v = VIEWS[b.dataset.view].layers, on = v.some((k) => shown.has(k));
    v.forEach((k) => (on ? shown.delete(k) : shown.add(k)));
    if (!on && b.dataset.view === "sled") loadClubs();
    applySwitches();
  });
  lm.addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]"); if (!b) return;
    const k = b.dataset.k;
    shown.has(k) ? shown.delete(k) : shown.add(k);
    applySwitches();
  });
  const typeOrder = Object.keys(TYPES);
  function renderList() {
    const list = $("skList");
    if (!ski) { $("skCount").textContent = "Routes in view"; list.innerHTML = `<li class="sk-hint">${skiErr ? "The ski route list isn't on the site yet (it's collected every night). Try again later." : "Loading ski routes…"}</li>`; return; }
    const b = map.getBounds();
    const items = (ski.routes || []).filter((r) => shown.has(r.type) && b.intersects(r.bounds));
    const huts = [...(shown.has("tour") ? ski.starts || [] : []), ...(shown.has("hut") ? ski.huts || [] : [])].filter((h) => b.contains([h.lat, h.lon]));
    // Named routes first, then by type; pieces with the same name and type are one entry.
    const groups = new Map();
    for (const r of items) {
      const key = r.name ? r.type + "|" + r.name.toLowerCase() : r.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const rows = [...groups.values()].sort((a, b2) => (!a[0].name - !b2[0].name) || typeOrder.indexOf(a[0].type) - typeOrder.indexOf(b2[0].type) || (a[0].name || "").localeCompare(b2[0].name || ""));
    const nStarts = huts.filter((h) => h.src === "c2c").length, nHuts = huts.length - nStarts;
    $("skCount").textContent = `${rows.length + nStarts} route${rows.length + nStarts === 1 ? "" : "s"} and ${nHuts} hut${nHuts === 1 ? "" : "s"} in view`;
    const MAX = 120;
    list.innerHTML = huts.slice(0, 30).map((h, i) => `<li><button type="button" data-h="${i}"${selected === h ? ' aria-current="true"' : ""}><span class="sk-dot" style="background:${h.src === "c2c" ? START.color : HUT.color}"></span><span class="nm">${esc(h.name || "Hut")}</span><span class="meta">${h.src === "c2c" ? "camptocamp" : h.tags?.ele ? esc(h.tags.ele) + " m" : "hut"}</span></button></li>`).join("")
      + rows.slice(0, MAX).map((g, i) => {
        const r = g[0], t = TYPES[r.type] || TYPES.other, len = g.reduce((s, x) => s + km(x), 0);
        return `<li><button type="button" data-g="${i}"${g.includes(selected) ? ' aria-current="true"' : ""}><span class="sk-sw" style="background:${t.color}"></span><span class="nm">${esc(nameOf(r) || "Unnamed " + t.label.toLowerCase())}</span><span class="meta">${len.toFixed(1)} km${r.diff ? " · " + esc(r.diff) : ""}</span></button></li>`;
      }).join("")
      + (rows.length > MAX ? `<li class="sk-hint">…and ${rows.length - MAX} more: zoom in.</li>` : "")
      + (!rows.length && !huts.length ? `<li class="sk-hint">No ski routes in view. Zoom out or move the map.</li>` : "");
    list.querySelectorAll("button[data-g]").forEach((bt) => bt.addEventListener("click", () => select(rows[+bt.dataset.g], true)));
    list.querySelectorAll("button[data-h]").forEach((bt) => bt.addEventListener("click", () => select(huts[+bt.dataset.h], true)));
  }
  // ---------- route details: heights, slopes, avalanche forecast and reports, weather ----------
  // A short name for each kind of route, for unnamed routes: "Ski touring near Ipsoot Mountain" (data/ski.json "near"
  // is the named peak closest to the route, found by the nightly job).
  const SHORT = { tour: "Ski touring", access: "Ski access", nordic: "Nordic trail", snowshoe: "Snowshoe trail", snowmobile: "Snowmobile trail", resort: "Ski run", offpiste: "Resort off-piste", other: "Winter route" };
  const nameOf = (r) => r.name || (r.near ? `${SHORT[r.type] || "Route"} near ${r.near}` : "");
  const fmtM = (m) => Math.round(m).toLocaleString() + " m";
  const SAMPLE_M = 25;   // a height every 25 m along the route
  // The route's pieces as one line, each piece joined to the end of the last at its nearer end.
  function chain(group) {
    const left = group.flatMap((r) => r.lines).filter((l) => l.length > 1).map((l) => l.slice()), out = [];
    if (!left.length) return out;
    out.push(left.shift());
    while (left.length) {
      const end = out[out.length - 1].at(-1), start = out[0][0];
      let best = 0, bestD = Infinity, how = "";
      left.forEach((l, i) => {
        for (const [h, a, b] of [["ae", end, l[0]], ["be", end, l.at(-1)], ["as", start, l.at(-1)], ["bs", start, l[0]]]) {
          const d = map.distance(a, b);
          if (d < bestD) { bestD = d; best = i; how = h; }
        }
      });
      const l = left.splice(best, 1)[0];
      if (how === "ae") out.push(l); else if (how === "be") out.push(l.reverse());
      else if (how === "as") out.unshift(l); else out.unshift(l.reverse());
    }
    return out;
  }
  // Points every SAMPLE_M metres along the pieces; d = distance along the route (gaps between pieces not counted).
  function sampleLine(pieces, step) {
    const pts = [];
    let d0 = 0;
    pieces.forEach((line, seg) => {
      let next = d0;
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i], len = map.distance(a, b);
        for (; next < d0 + len; next += step) { const f = len ? (next - d0) / len : 0; pts.push({ lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f, d: next, seg }); }
        d0 += len;
      }
      const z = line.at(-1);
      pts.push({ lat: z[0], lon: z[1], d: d0, seg });
    });
    return pts;
  }
  // Height, slope and the way the slope faces at each point, from the AWS terrain tiles (the same ones as the shading).
  async function heights(pts, total) {
    const z = total > 80000 ? 11 : total > 40000 ? 12 : 13, n = 2 ** z;
    pts.forEach((p) => {
      const x = ((p.lon + 180) / 360) * n, s = Math.sin((p.lat * Math.PI) / 180), y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
      p.tx = Math.floor(x); p.ty = Math.floor(y); p.px = (x - p.tx) * 256 - 0.5; p.py = (y - p.ty) * 256 - 0.5;
    });
    const keys = [...new Set(pts.map((p) => p.tx + "/" + p.ty))];
    const tiles = new Map(await Promise.all(keys.map(async (key) => { const [x, y] = key.split("/").map(Number); return [key, await dem(z, x, y)]; })));
    for (const p of pts) {
      const E = tiles.get(p.tx + "/" + p.ty), k = 25 / minSlope(E.z), at = (x, y) => E[Math.min(255, Math.max(0, y)) * 256 + Math.min(255, Math.max(0, x))];
      const x0 = Math.floor(p.px), y0 = Math.floor(p.py), fx = p.px - x0, fy = p.py - y0;
      p.e = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
      const xi = Math.round(p.px), yi = Math.round(p.py), m = (40075016.686 * Math.cos((p.lat * Math.PI) / 180)) / (256 * n);
      const dzdx = (at(xi + 1, yi) - at(xi - 1, yi)) / (2 * m), dzdy = (at(xi, yi + 1) - at(xi, yi - 1)) / (2 * m);
      p.slope = Math.min(60, ((Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI) * k);
      p.asp = Math.round((((Math.atan2(-dzdx, dzdy) * 180) / Math.PI + 360) % 360) / 45) % 8;
      delete p.tx; delete p.ty; delete p.px; delete p.py;
    }
  }
  const DEFAULT_BANDS = { lo: 1500, hi: 1900 };
  const bandOf = (e, b) => (e >= b.hi ? "alp" : e >= b.lo ? "tln" : "btl");
  // Everything about the route's shape: heights, climb, slopes, which bands and aspects it crosses.
  async function routeInfo(group) {
    const r = group[0];
    if (r.info) return r.info;
    const pieces = chain(group);
    let pts = sampleLine(pieces, SAMPLE_M);
    const total = pts.length ? pts.at(-1).d : 0;
    if (pts.length > 1500) { const st = Math.ceil(pts.length / 1500); pts = pts.filter((_, i) => i % st === 0 || i === pts.length - 1); }
    await heights(pts, total);
    // Start from the lower end: a tour climbs from the valley.
    if (pts.at(-1).e < pts[0].e) { pts.reverse(); pts.forEach((p) => { p.d = total - p.d; }); }
    let up = 0, down = 0, ref = pts[0].e;
    for (const p of pts) { if (p.e - ref >= 5) { up += p.e - ref; ref = p.e; } else if (ref - p.e >= 5) { down += ref - p.e; ref = p.e; } }
    const es = pts.map((p) => p.e), top = pts[es.indexOf(Math.max(...es))];
    // Steepness of the ground under the route: the middle of each 3 points, so one odd pixel doesn't count.
    const sl = pts.map((p, i) => [pts[i - 1]?.slope ?? p.slope, p.slope, pts[i + 1]?.slope ?? p.slope].sort((a, b) => a - b)[1]);
    let km30 = 0, km35 = 0;
    const aspects = new Array(8).fill(0);
    pts.forEach((p, i) => {
      const seg = i ? (p.d - pts[i - 1].d) / 1000 : 0;
      if (sl[i] >= 30) km30 += seg;
      if (sl[i] >= 35) km35 += seg;
      if (sl[i] >= 25) aspects[p.asp] += seg;
    });
    const steepKm = aspects.reduce((s, x) => s + x, 0);
    const faces = steepKm ? ASPECTS.filter((_, i) => aspects[i] >= steepKm * 0.15).sort((a, b) => aspects[ASPECTS.indexOf(b)] - aspects[ASPECTS.indexOf(a)]) : [];
    const above = await overhead(pts, total).catch(() => null);
    return (r.info = { pts, sl, total, up, down, top, min: Math.min(...es), max: top.e, maxSlope: Math.max(...sl), km30, km35, faces, above });
  }
  // What's above you: stretches of the route under steep ground (30° and more) that could slide down onto it, that
  // is within ABOVE_M, at least 50 m higher (enough slope to bury someone), and seen from the route at least ABOVE_DEG up (a rough "alpha angle":
  // avalanches seldom run out further than a line about 20° down from where they start). From the same terrain
  // tiles, zoom 13, checking every 4th point (about 100 m apart). Returns the km exposed, and p.above on the points.
  const ABOVE_M = 350, ABOVE_DEG = 20;
  async function overhead(pts, total) {
    if (total > 60000 || !pts.length) return null;
    const z = 13, n = 2 ** z * 256, tanA = Math.tan((ABOVE_DEG * Math.PI) / 180);
    const gxy = (p) => { const s = Math.sin((p.lat * Math.PI) / 180); return [((p.lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]; };
    const check = pts.filter((_, i) => i % 4 === 0 || i === pts.length - 1);
    const need = new Set();
    for (const p of check) {
      const [gx, gy] = gxy(p), m = (40075016.686 * Math.cos((p.lat * Math.PI) / 180)) / n, r = Math.ceil(ABOVE_M / m) + 2;
      Object.assign(p, { gx, gy, m, r });
      for (let tx = Math.floor((gx - r) / 256); tx <= Math.floor((gx + r) / 256); tx++) for (let ty = Math.floor((gy - r) / 256); ty <= Math.floor((gy + r) / 256); ty++) need.add(tx + "/" + ty);
    }
    const tiles = new Map(await Promise.all([...need].map(async (key) => { const [x, y] = key.split("/").map(Number); return [key, await dem(z, x, y).catch(() => null)]; })));
    const at = (ix, iy) => { const t = tiles.get((ix >> 8) + "/" + (iy >> 8)); return t ? t[(iy & 255) * 256 + (ix & 255)] : null; };
    let km = 0;
    check.forEach((p, k) => {
      const cx = Math.round(p.gx), cy = Math.round(p.gy), k30 = Math.tan((30 * Math.PI) / 180) / (25 / minSlope(13));
      let hit = false;
      for (let dy = -p.r; dy <= p.r && !hit; dy += 2) for (let dx = -p.r; dx <= p.r && !hit; dx += 2) {
        const d = Math.hypot(dx, dy) * p.m;
        if (d < 60 || d > ABOVE_M) continue;
        const e = at(cx + dx, cy + dy);
        if (e == null || e - p.e < 50 || (e - p.e) / d < tanA) continue;
        const ex = at(cx + dx + 1, cy + dy), wx = at(cx + dx - 1, cy + dy), sy = at(cx + dx, cy + dy + 1), ny = at(cx + dx, cy + dy - 1);
        if (ex == null || wx == null || sy == null || ny == null) continue;
        if (Math.hypot(ex - wx, sy - ny) / (2 * p.m) >= k30) hit = true;
      }
      p.above = hit;
      delete p.gx; delete p.gy; delete p.m; delete p.r;
      if (hit && k) km += (p.d - check[k - 1].d) / 1000;
    });
    // The points between the checked ones take the flag of the checked point before them.
    let flag = false;
    pts.forEach((p) => { if (p.above != null) flag = p.above; else p.above = flag; });
    return km;
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
  function elevHtml(info, bands, area) {
    const bk = bandKm(info, bands), asp = info.faces.map((s) => s.toUpperCase()).join(", ");
    return `<h4>Elevation</h4>
      <div class="sk-stats"><div><b>${fmtM(info.max)}</b><span>top</span></div><div><b>${fmtM(info.min)}</b><span>bottom</span></div>
        <div><b>↑ ${fmtM(info.up)}</b><span>climb</span></div><div><b>↓ ${fmtM(info.down)}</b><span>descent</span></div></div>
      ${profileSvg(info, bands)}
      <dl><dt>Ground</dt><dd>steepest about ${Math.round(info.maxSlope)}°${info.km30 >= 0.05 ? `; ${info.km30.toFixed(1)} km on slopes of 30° or more${info.km35 >= 0.05 ? ` (${info.km35.toFixed(1)} km of 35°+)` : ""}` : "; no slopes of 30° or more under the route"}</dd>
      ${asp ? `<dt>Steep parts face</dt><dd>${asp}</dd>` : ""}
      <dt>Bands</dt><dd>${BANDS.filter(([b]) => bk[b] >= 0.05).map(([b, n]) => `${n} ${bk[b].toFixed(1)} km`).join(" · ")}</dd></dl>
      ${info.above == null ? "" : info.above >= 0.05
        ? `<div class="sk-warn"><b>⚠ Steep slopes above:</b> ${info.above.toFixed(1)} km of the route is under ground of 30° or more that could slide onto it (red dashes on the map).</div>`
        : `<p class="sk-note">No steep slopes found above the route (within ${ABOVE_M} m).</p>`}
      <p class="sk-note">Orange on the profile is 30° and steeper.</p>`;
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
    const link = `<a href="https://avalanche.ca/map" target="_blank" rel="noopener">Avalanche Canada map</a>`;
    if (!data) return `<h4>Avalanche</h4><p class="sk-note">${avyErr ? `The avalanche forecast isn't on the site yet. ${link}` : "Loading the avalanche forecast…"}</p>`;
    const f = area && area.forecast, d = f && dayOf(f);
    const rated = f && f.days?.some((x) => x.alp || x.tln || x.btl);
    let html = `<h4>Avalanche${f ? `: ${esc(f.title || area.name)}` : ""}</h4>`;
    if (example) html += `<div class="av-warn">EXAMPLE, not a real forecast.</div>`;
    if (!f || !d) html += `<p>No avalanche forecast here right now. Avalanche Canada's daily forecasts run from about late November to April. ${link}</p>`;
    else {
      const expired = !example && f.validUntil && new Date(f.validUntil) < new Date();
      const on = info ? bandKm(info, area.bands) : null;
      // Today in words, later days as the number only, so three days fit across a phone.
      const chip = (r, short) => `<span class="av-chip" title="${DANGER[r].label}" style="background:${DANGER[r].color};color:${r >= 4 ? "#fff" : "#1a1a1a"}">${short ? r || "–" : DANGER[r].label}</span>`;
      if (expired) html += `<div class="av-warn">This forecast has expired. Check avalanche.ca for the latest.</div>`;
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
        return `<div class="av-prob${bandsOn && !bHit.length ? " off" : ""}">${rose(p)}<div><b>${esc(p.type)}</b><p>${where}</p><p>${p.likelihood ? "Likelihood: " + esc(p.likelihood) : ""}${p.size ? ` · size ${esc(p.size)}` : ""}</p></div></div>`;
      }).join("");
      const sum = f.summaries?.["avalanche-summary"] || f.summaries?.["avalanche summary"];
      if (sum) html += `<h5>Recent avalanches (forecaster)</h5><p class="sk-pre">${esc(sum.slice(0, 900))}${sum.length > 900 ? "…" : ""}</p>`;
      html += `<p><a href="${esc(f.url || "https://avalanche.ca/map")}" target="_blank" rel="noopener">Full forecast on avalanche.ca</a></p>`;
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
    const p = fetch(`${WX}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}${ele != null ? `&elevation=${Math.round(ele)}` : ""}&timezone=auto&past_days=3&forecast_days=4`
      + "&daily=weather_code,temperature_2m_max,temperature_2m_min,snowfall_sum,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant&hourly=freezing_level_height")
      .then((r) => { if (!r.ok) throw new Error(r.status === 429 ? "too many requests today, try later" : `HTTP ${r.status}`); return r.json(); });
    p.catch(() => wxCache.delete(key));
    wxCache.set(key, { at: Date.now(), p });
    return p;
  }
  const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  function wxHtml(w, ele) {
    const dd = w.daily, today = dd.time.indexOf(new Date().toLocaleDateString("en-CA", { timeZone: w.timezone }));
    const t0 = today >= 0 ? today : 3;
    const past = dd.snowfall_sum.slice(Math.max(0, t0 - 3), t0).reduce((s, x) => s + (x || 0), 0);
    const fz = (date) => { const v = w.hourly.time.map((t, i) => (t.startsWith(date) ? w.hourly.freezing_level_height[i] : null)).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
    const rows = dd.time.slice(t0, t0 + 4).map((date, j) => {
      const i = t0 + j, dayName = j === 0 ? "Today" : new Date(date + "T12:00").toLocaleDateString(undefined, { weekday: "short" }), f = fz(date);
      return `<tr><th>${dayName}</th><td>${WICON[dd.weather_code[i]] || ""}</td><td>${Math.round(dd.temperature_2m_min[i])}° / ${Math.round(dd.temperature_2m_max[i])}°</td>
        <td>${dd.snowfall_sum[i] >= 0.5 ? `<b>${Math.round(dd.snowfall_sum[i])} cm</b>` : dd.precipitation_sum[i] >= 1 ? `${Math.round(dd.precipitation_sum[i])} mm rain` : "–"}</td>
        <td>${Math.round(dd.wind_speed_10m_max[i])}<span class="sk-note">/${Math.round(dd.wind_gusts_10m_max[i])}</span> ${COMPASS[Math.round(dd.wind_direction_10m_dominant[i] / 45) % 8]}</td>
        <td>${f != null ? fmtM(f) : "–"}</td></tr>`;
    }).join("");
    return `<h4>Weather at ${ele != null ? `the top (${fmtM(ele)})` : "this spot"}</h4>
      <p>New snow in the last 3 days: <b>${Math.round(past)} cm</b></p>
      <table class="sk-wx"><tr><th></th><th></th><th>Low / high</th><th>Snow</th><th>Wind km/h</th><th>Freezing level</th></tr>${rows}</table>
      <p class="sk-note">Model forecast from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>. Wind: strongest / gusts.</p>`;
  }

  // OpenStreetMap tags in plain words; the rest are left out (alex: "take out everything unnecessary").
  const GROOM = { backcountry: "Not groomed (backcountry)", no: "Not groomed", classic: "Groomed for classic", skating: "Groomed for skate", "classic+skating": "Groomed for classic and skate", "classic;skating": "Groomed for classic and skate", scooter: "Packed by snowmobile", mogul: "Moguls" };
  const DIFF = { novice: "Novice", easy: "Easy", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert", freeride: "Freeride (off-piste)", extreme: "Extreme" };
  const ON = { track: "a forest road or track", path: "a trail", footway: "a footpath", service: "a road", unclassified: "a road", bridleway: "a trail" };
  const yesNo = (v) => ({ yes: "allowed", designated: "allowed (signed for it)", permissive: "allowed", no: "not allowed", private: "private" }[v] || v);
  const PLAIN = {
    "piste:grooming": (v) => ["Grooming", GROOM[v] || v], "piste:difficulty": null, highway: (v) => ON[v] && ["Follows", ON[v]],
    description: (v) => ["Description", v], note: (v) => ["Note", v], operator: (v) => ["Run by", v], fee: (v) => ["Fee", v === "yes" ? "yes, a fee to use it" : v === "no" ? "free" : v],
    access: (v) => ["Access", yesNo(v)], ski: (v) => ["Skiing", yesNo(v)], snowmobile: (v) => ["Snowmobiles", yesNo(v)], "snowmobile:conditional": (v) => ["Snowmobiles when", v],
    seasonal: (v) => ["Seasonal", v], opening_hours: (v) => ["Open", v], ref: (v) => ["Number", v], ele: (v) => ["Height", v + " m"],
    capacity: (v) => ["Sleeps", v], reservation: (v) => ["Booking", v === "required" ? "required" : v], website: (v) => ["Website", v], url: (v) => ["Website", v],
    "piste:type": null, name: null, "piste:name": null,
  };
  const val2 = (v) => (/^https?:\/\//.test(v) ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>` : esc(v));
  function tagsHtml(r) {
    const plain = [];
    for (const [k, v] of Object.entries(r.tags || {})) {
      const f = PLAIN[k];
      if (f === null) continue;
      const out = f ? f(v) : r.src === "c2c" ? [k[0].toUpperCase() + k.slice(1), v] : null;
      if (out) plain.push(out);
    }
    return { plain: plain.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${val2(v)}</dd>`).join("") };
  }
  // Huts and camptocamp routes within 2 km of the route.
  function nearbyHtml(info) {
    if (!ski || !info) return "";
    const pts = info.pts, out = [];
    for (const h of [...(ski.huts || []), ...(ski.starts || [])]) {
      const km = near(pts, h.lat, h.lon);
      if (km <= 2) out.push({ h, km });
    }
    if (!out.length) return "";
    out.sort((a, b) => a.km - b.km);
    return `<dt>Nearby</dt><dd>${out.slice(0, 6).map(({ h, km }) => `<a href="#" class="sk-go" data-id="${esc(h.id)}">${esc(h.name || (h.src === "c2c" ? "camptocamp route" : "Hut"))}</a> <span class="sk-note">${h.src === "c2c" ? "camptocamp route, " : ""}${km < 0.1 ? "on the route" : km.toFixed(1) + " km"}</span>`).join("<br>")}</dd>`;
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
  function photosHtml(ph, isHut) {
    const { list, failed } = ph;
    const credit = (p) => [p.author && `© ${p.author}`, p.licence, p.src].filter(Boolean).join(" · ");
    const body = list.length ? `<div class="ab-photos">${list.map((p, i) => `<button type="button" class="ab-ph" data-i="${i}"${i >= PH_FIRST ? " hidden" : ""} title="${esc(p.title + (credit(p) ? " · " + credit(p) : ""))}">
        <img src="${esc(p.thumb)}" alt="${esc(p.title)}" loading="lazy" referrerpolicy="no-referrer"></button>`).join("")}</div>
      ${list.length > PH_FIRST ? `<button class="linkish ab-all" type="button">Show all ${list.length} photos</button>` : ""}
`
      : `<p class="sk-note">${failed ? "Couldn't reach the photo sources right now." : `No open photos found ${isHut ? "here" : "on this route or around its top"} yet.`}</p>`;
    return `<h4>Photos</h4>${body}`;
  }
  function bindPhotos(el, list) {
    const all = el.querySelector(".ab-all");
    if (all) all.addEventListener("click", () => { el.querySelectorAll(".ab-ph[hidden]").forEach((b) => { b.hidden = false; }); all.remove(); });
    el.querySelectorAll(".ab-ph").forEach((b) => b.addEventListener("click", () => window.tfPhotos.open(list, +b.dataset.i)));
    el.querySelectorAll(".ab-ph img").forEach((img) => img.addEventListener("error", () => img.closest(".ab-ph").remove()));
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

  let selToken = 0;
  function select(it, fly) {
    const group = Array.isArray(it) ? it : [it];
    const r = group[0];
    if (selected !== r) { hoverLayer.clearLayers(); aboveLayer.clearLayers(); }
    selected = r;
    drawSki(); renderList();
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
    const mine = r.src === "plan";
    const src = mine ? "your plan" : r.src === "bc"
      ? `BC Recreation Sites and Trails (<a href="https://www.sitesandtrailsbc.ca/" target="_blank" rel="noopener">sitesandtrailsbc.ca</a>)`
      : r.src === "c2c"
      ? `<a href="https://www.camptocamp.org/routes/${esc(r.id.slice(3))}" target="_blank" rel="noopener">camptocamp.org</a> (CC BY-SA)`
      : `<a href="https://www.openstreetmap.org/${osmType}/${r.id.slice(1)}" target="_blank" rel="noopener">OpenStreetMap</a>`;
    const tags = tagsHtml(r);
    const club = !isHut && r.type === "snowmobile" ? clubNear(r.lines[0][0][0], r.lines[0][0][1]) : null;
    const title = isHut ? r.name || (isStart ? "camptocamp route" : "Hut") : nameOf(r) || "Unnamed route";
    const pt = isHut ? [r.lat, r.lon] : r.lines[0][0];
    d.hidden = false;
    d.innerHTML = `<div><button type="button" class="sk-x" aria-label="Close">✕</button><h3>${esc(title)}</h3></div>
      <dl><dt>Type</dt><dd>${esc(isStart ? t.label + " (start point only; see camptocamp for the route)" : isHut ? (r.kind || "hut").replace(/_/g, " ") : t.label)}</dd>
      ${isHut ? "" : r.area ? `<dt>Size</dt><dd>${hectares(r).toFixed(0)} ha: mapped as an area (a bowl or zone), not a line to follow</dd>`
        : `<dt>Length</dt><dd>${group.reduce((s, x) => s + km(x), 0).toFixed(1)} km${group.length > 1 ? ` (${group.length} pieces)` : ""}</dd>`}
      ${r.diff ? `<dt>Difficulty</dt><dd>${esc(DIFF[r.diff] || r.diff)}</dd>` : ""}
      ${r.routes ? `<dt>Part of</dt><dd>${esc(r.routes.join(", "))}</dd>` : ""}
      ${club ? `<dt>Club</dt><dd><a href="#" class="sb-go">${esc(club.c.name)}</a> (${esc(club.a.name)}, ${club.km.toFixed(0)} km away): grooming report and trail pass</dd>` : ""}
      ${tags.plain}<span id="skNear"></span></dl>
      ${isHut ? "" : `<div class="sk-sec" id="skElev"><h4>Elevation</h4><p class="sk-note">Loading heights…</p></div>`}
      <div class="sk-sec" id="skAvy"></div>
      <div class="sk-sec" id="skWx"><h4>Weather</h4><p class="sk-note">Loading the forecast…</p></div>
      <div class="sk-sec" id="skSnowNear" hidden></div>
      ${isHut || r.area ? "" : `<div class="sk-row">${window.tfRide ? `<button type="button" class="btn primary" id="skFollow">▶ Follow this tour</button>` : ""}<button type="button" class="btn" id="skGpx">⬇ GPX</button></div>`}
      ${mine ? "" : `<div class="sk-sec" id="skPh"><h4>Photos</h4><p class="sk-note">Looking for photos…</p></div>
      <p class="sk-note">From ${src}</p>`}`;
    d.querySelector(".sk-x").addEventListener("click", () => { selected = null; selToken++; d.hidden = true; hoverLayer.clearLayers(); aboveLayer.clearLayers(); drawSki(); renderList(); renderForecast(); });
    const fol = $("skFollow");
    if (fol) fol.addEventListener("click", () => { if (plan.on) setPlanning(false); window.tfRide.follow(r.info ? chain(group) : group.flatMap((x) => x.lines), title); });
    showNearSnow();
    renderForecast();
    const go = d.querySelector(".sb-go");
    if (go) go.addEventListener("click", (e) => { e.preventDefault(); showClub(club.c); });
    const gpxBtn = $("skGpx");
    if (gpxBtn) gpxBtn.addEventListener("click", () => gpx(title, group, r.info));

    // The avalanche forecast is needed here even with the shading off.
    if (!avy && !example && !avyErr) loadAvy();
    const showAvy = (info) => {
      if (!live()) return;
      const p = info ? [info.top.lat, info.top.lon] : pt;
      const area = (avy || example) ? areaAt(p[0], p[1]) : null;
      const el = $("skAvy");
      el.innerHTML = avyHtml(area, info, p);
      const elev = $("skElev");
      if (info && elev) { elev.innerHTML = elevHtml(info, area ? area.bands : DEFAULT_BANDS, area); bindProfile(elev, info); }
    };
    const showWx = (lat, lon, ele) => weather(lat, lon, ele).then((w) => { if (live()) $("skWx").innerHTML = wxHtml(w, ele); })
      .catch((e) => { if (live()) $("skWx").innerHTML = `<h4>Weather</h4><p class="sk-note">Couldn't load the weather (${esc(e.message)}).</p>`; });
    showAvy(r.info || null);
    if (!minData && !minErr) loadMin().then(() => showAvy(r.info || null));
    const showPh = (info) => mine ? null : routePhotos(r, info).then((ph) => { const el = $("skPh"); if (!live() || !el) return; el.innerHTML = photosHtml(ph, isHut); bindPhotos(el, ph.list); });
    if (isHut) { showWx(r.lat, r.lon, parseFloat(r.tags?.ele) || null); showPh(null); return; }
    routeInfo(group).then((info) => {
      if (!live()) return;
      showAvy(info);
      showWx(info.top.lat, info.top.lon, info.max);
      showPh(info);
      drawAbove(info);
      if (mine) renderPlan();
      const nb = $("skNear");
      if (nb) {
        nb.outerHTML = nearbyHtml(info);
        d.querySelectorAll(".sk-go").forEach((a) => a.addEventListener("click", (e) => {
          e.preventDefault();
          const h = [...(ski.huts || []), ...(ski.starts || [])].find((x) => x.id === a.dataset.id);
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
  function planRoute() {
    if (plan.pts.length < 2) return null;
    return { id: "plan", src: "plan", type: "tour", name: "Your planned tour", tags: {}, g: [plan.pts.flat()], lines: [plan.pts.slice()], bounds: L.latLngBounds(plan.pts) };
  }
  function drawPlan() {
    plan.layer.clearLayers();
    if (sport !== "ski" || !plan.pts.length) return;
    if (plan.pts.length > 1) {
      plan.layer.addLayer(L.polyline(plan.pts, { pane: "ski", color: "#fff", weight: 8, opacity: 0.9, interactive: false }));
      plan.layer.addLayer(L.polyline(plan.pts, { pane: "ski", color: "#e8590c", weight: 4, opacity: 1, dashArray: plan.on ? "10 6" : null, interactive: false }));
    }
    plan.pts.forEach((q, i) => plan.layer.addLayer(L.marker(q, { pane: "ski", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<div class="sk-plan-pt"${i ? "" : ' style="border-color:#2f9e44"'}></div>`, iconSize: [12, 12], iconAnchor: [6, 6] }) })));
    if (!map.hasLayer(plan.layer)) plan.layer.addTo(map);
    aboveLayer.eachLayer((l) => l.bringToFront());   // the red "steep slopes above" dashes stay on top of the plan
  }
  // While planning, a bar on the map keeps the totals and the buttons in sight (on a phone the panel is lowered).
  const planBar = document.createElement("div");
  planBar.className = "sk-planbar"; planBar.hidden = true; planBar.setAttribute("role", "status");
  document.querySelector(".mapwrap").append(planBar);
  L.DomEvent.disableClickPropagation(planBar);
  function renderPlan() {
    const card = $("skPlan"), info = selected && selected.src === "plan" ? selected.info : null, n = plan.pts.length;
    planBar.hidden = !plan.on;
    if (plan.on) {
      planBar.innerHTML = `<span>${n < 2 ? `<b>Tap the map</b> ${n ? "for the next point" : "where you start"}` : info ? `<b>${(info.total / 1000).toFixed(1)} km</b> · ↑ ${fmtM(info.up)} · steepest ${Math.round(info.maxSlope)}°` : "Working it out…"}</span>
        ${n ? `<button type="button" data-p="undo">↶ Undo</button>` : ""}<button type="button" data-p="done" class="go">✓ Done</button>`;
      planBar.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { if (b.dataset.p === "undo") { plan.pts.pop(); planChanged(); } else setPlanning(false); }));
    }
    $("skPlanBtn").setAttribute("aria-pressed", String(plan.on));
    $("skPlanBtn").textContent = plan.on ? "✓ Done planning" : n > 1 ? "✎ Edit my tour" : "✎ Plan a tour";
    card.hidden = !plan.on && n < 2;
    if (card.hidden) return;
    const sum = n < 2 ? "" : !info ? `<p>Working out heights and slopes…</p>`
      : `<p><b>${(info.total / 1000).toFixed(1)} km</b> · ↑ ${fmtM(info.up)} · ↓ ${fmtM(info.down)} · top ${fmtM(info.max)}</p>
        <p>Steepest ${Math.round(info.maxSlope)}° · ${info.km30 >= 0.05 ? `<b>${info.km30.toFixed(1)} km on 30°+ slopes</b>` : "no 30°+ slopes under it"}${info.above >= 0.05 ? ` · <b>${info.above.toFixed(1)} km under steep slopes</b>` : ""}</p>`;
    card.innerHTML = `${plan.on ? `<p><b>Tap the map</b> to add each point of your tour: up the skin track, then the way down. ${n ? "" : "Start where you park."}</p>` : "<p><b>Your planned tour</b></p>"}
      ${sum}
      <div class="sk-row">${plan.on && n ? `<button type="button" class="btn" id="skPlanUndo">↶ Undo</button>` : ""}${n ? `<button type="button" class="btn" id="skPlanClear">Clear</button>` : ""}${!plan.on && n > 1 ? `<button type="button" class="btn" id="skPlanShow">Show details</button>` : ""}</div>`;
    const u = $("skPlanUndo"); if (u) u.addEventListener("click", () => { plan.pts.pop(); planChanged(); });
    const c = $("skPlanClear"); if (c) c.addEventListener("click", () => { if (plan.pts.length > 2 && !confirm("Clear your planned tour?")) return; plan.pts = []; planChanged(); });
    const sh = $("skPlanShow"); if (sh) sh.addEventListener("click", () => { const r = planRoute(); if (r) select(r, true); });
  }
  function planChanged() {
    store.set("skiPlan", plan.pts);
    drawPlan();
    clearTimeout(plan.timer);
    const r = planRoute();
    if (!r) {
      if (selected && selected.src === "plan") { selected = null; selToken++; $("skDetail").hidden = true; aboveLayer.clearLayers(); renderForecast(); }
      renderPlan(); return;
    }
    renderPlan();
    plan.timer = setTimeout(() => select(r), 350);   // a quick run of taps works it out once
  }
  function planAdd(ll) {
    if (map.getZoom() < 12) { map.setView(ll, 13); return; }   // too far out to place a point well: zoom in there first
    plan.pts.push([+ll.lat.toFixed(6), +ll.lng.toFixed(6)]);
    planChanged();
  }
  function setPlanning(on) {
    if (plan.on === on) return;
    plan.on = on;
    // Slope angles while planning (CalTopo-style), back to how they were after.
    if (on) { plan.slopeWas = shown.has("slope"); if (!plan.slopeWas) { shown.add("slope"); applySwitches(); } }
    else if (!plan.slopeWas && shown.has("slope")) { shown.delete("slope"); applySwitches(); }
    map.getContainer().classList.toggle("sk-planning", on);
    if (on && map.getZoom() < 12) map.setZoom(13);
    // After the tap's own click reaches the panel (which raises a lowered sheet).
    if (window.tfSnapTo) setTimeout(() => window.tfSnapTo(on ? "peek" : plan.pts.length > 1 ? "half" : "peek"), 0);
    drawPlan(); renderPlan();
    if (!on && selected && selected.src === "plan" && window.tfPanelScrollTo) window.tfPanelScrollTo($("skPlan"));
    if (on) $("skHint").hidden = true; else $("skHint").hidden = false;
  }
  map.on("click", (e) => { if (sport === "ski" && plan.on) planAdd(e.latlng); });
  $("skPlanBtn").addEventListener("click", () => setPlanning(!plan.on));
  $("skRecBtn").addEventListener("click", () => {
    if (!window.tfRide) return;
    if (plan.on) setPlanning(false);
    window.tfRide.start();
  });

  // Red dashes over the stretches of the selected route that have steep slopes above them (aboveLayer).
  function drawAbove(info) {
    aboveLayer.clearLayers();
    if (!info || !info.above) return;
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
  // ---------- snow stations (data/snow-stations.json, BC's automated snow pillows, read every 2 hours) ----------
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
      <p class="sk-note">${st.lo24 != null ? `Last 24 h: low ${Math.round(st.lo24)}°C, high ${Math.round(st.hi24)}°C. ` : ""}${st.swe != null ? `Water in the snow: ${Math.round(st.swe)} mm. ` : ""}Measured by BC's River Forecast Centre. The snow on the slopes around can be quite different.</p>`;
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
  function renderForecast() {
    const card = $("avCard");
    card.hidden = !(sport === "ski" && (avyOn || shown.has("tour")) && $("skDetail").hidden);   // a route's details have their own
    if (card.hidden) return;
    if (!avy && !example && !avyErr) loadAvy();
    if (!minData && !minErr && !minLoading) loadMin().then(renderForecast);
    const data = example ? exampleData() : avy;
    const shade = `<button type="button" class="linkish" id="avShade">${avyOn ? "Hide the slope shading" : "Shade the slopes on the map"}</button>`;
    if (!data) { card.innerHTML = avyErr ? `<h3>Avalanche</h3><p class="sk-hint">The forecast isn't on the site yet. <button type="button" class="linkish" id="avEx">Show an example</button></p>` : "<h3>Avalanche</h3><p class=\"sk-hint\">Loading the forecast…</p>"; bindEx(); return; }
    if (!example && !hasForecasts()) {
      card.innerHTML = `<h3>Avalanche</h3><p class="sk-hint">No forecast right now: Avalanche Canada's run from about late November to April. <button type="button" class="linkish" id="avEx">Show an example</button></p>`;
      bindEx(); return;
    }
    const c = map.getCenter();
    const area = (example ? null : areaAt(c.lat, c.lng)) || (data.areas.find((a) => a.polys.some((p) => inPoly(c.lat, c.lng, p))) || data.areas.find((a) => a.forecast?.days?.length));
    const f = area && area.forecast;
    if (!area) { card.innerHTML = "<h3>Avalanche</h3><p class=\"sk-hint\">No forecast area here.</p>"; return; }
    if (!f || !f.days?.length) { card.innerHTML = `<h3>Avalanche: ${esc(area.name)}</h3><p class="sk-hint">No forecast for this area right now.</p>`; return; }
    const d = dayOf(f), expired = !example && f.validUntil && new Date(f.validUntil) < new Date();
    const chip = (r) => `<span class="av-chip" style="background:${DANGER[r].color};color:${r >= 4 ? "#fff" : "#1a1a1a"}">${DANGER[r].label}</span>`;
    const notes = Object.values(f.summaries || {}).filter(Boolean), rated = example || f.days.some((x) => x.alp || x.tln || x.btl);
    card.innerHTML = `${example ? `<div class="av-warn">EXAMPLE, not a real forecast.</div>` : ""}
      ${expired ? `<div class="av-warn">This forecast has expired. Check avalanche.ca.</div>` : ""}
      <h3>Avalanche: ${esc(f.title || area.name)}</h3>
      ${rated ? `<div class="av-days" role="group" aria-label="Day">${f.days.map((x, i) => `<button type="button" data-d="${i}" aria-pressed="${x === d}">${esc(x.label || x.date)}</button>`).join("")}</div>
      <div class="av-rate">${BANDS.map(([b, n]) => `<span>${n}</span>${chip(d[b])}`).join("")}</div>`
        : `<p>No danger ratings yet (early season). <button type="button" class="linkish" id="avEx">Show an example</button></p>`}
      ${f.highlights ? `<p><strong>${esc(f.highlights)}</strong></p>` : ""}
      <details id="avMore"${avMore ? " open" : ""}><summary>Problems, notes and riders' reports</summary>
        ${(f.problems || []).map((p) => `<div class="av-prob">${rose(p)}<div><b>${esc(p.type)}</b><p>${esc(p.aspects.map((s) => s.toUpperCase()).join(" "))} · ${esc(p.elevations.map((b) => BANDS.find((x) => x[0] === b)[1]).join(", "))}</p><p>${p.likelihood ? "Likelihood: " + esc(p.likelihood) : ""}${p.size ? " · Size " + esc(p.size) : ""}</p>${p.comment ? `<details><summary>More</summary><p>${esc(p.comment)}</p></details>` : ""}</div></div>`).join("")}
        ${notes.length ? `<h5>Forecaster's notes</h5>${notes.map((s) => `<p>${esc(s)}</p>`).join("")}` : ""}
        ${minHtml([{ lat: c.lat, lon: c.lng }])}
        ${avyOn ? `<h5>Slope colours</h5><ul class="av-legend">${DANGER.slice(1).map((x) => `<li><i style="background:${x.color}"></i>${x.label}</li>`).join("")}<li><i style="background:repeating-linear-gradient(135deg,#f79218 0 3px,#7a4a0c 3px 5px)"></i>Problem aspect</li></ul>
        <p class="sk-note">Slopes of 25° and more, coloured by their band's rating (treeline about ${area.bands.lo}-${area.bands.hi} m here). An estimate, not a terrain rating.</p>` : ""}
      </details>
      <p class="sk-hint">${f.issued ? "Issued " + esc(new Date(f.issued).toLocaleDateString()) + " · " : ""}for the middle of the map · <a href="${esc(f.url || "https://avalanche.ca/map")}" target="_blank" rel="noopener">avalanche.ca</a><br>${shade}${example ? ` · <button type="button" class="linkish" id="avExOff">Hide the example</button>` : ""}</p>`;
    card.querySelectorAll(".av-days button").forEach((b) => b.addEventListener("click", () => { day = +b.dataset.d; refreshAvy(); }));
    $("avMore").addEventListener("toggle", (e) => { avMore = e.currentTarget.open; });
    const off = $("avExOff"); if (off) off.addEventListener("click", () => { example = false; refreshAvy(); });
    bindEx();
  }
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
        const hit = a.mask[band] & (1 << sector);
        let alpha = slope < 30 ? 0.3 : slope < 45 ? 0.55 : 0.42;
        let [cr, cg, cb] = COLORS[r];
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

  // 3D map layer, through a tile protocol that paints the same tiles as PNGs.
  let ver = 0, protocol = false;
  function sync3d() {
    const gl = window.trailMap3d;
    if (!gl || !window.maplibregl) return;
    if (!protocol) {
      protocol = true;
      maplibregl.addProtocol("tfavy", async (params) => {
        const [z, x, y] = params.url.replace("tfavy://", "").split("?")[0].split("/").map(Number);
        const img = await paint(z, x, y);
        const cv = new OffscreenCanvas(256, 256);
        cv.getContext("2d").putImageData(img, 0, 0);
        return { data: await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer() };
      });
    }
    const want = sport === "ski" && avyOn;
    const apply = () => {
      if (!gl.getStyle()) return;
      const has = !!gl.getLayer("avy");
      if (!want) { if (has) gl.removeLayer("avy"); if (gl.getSource("avy")) gl.removeSource("avy"); return; }
      const tiles = [`tfavy://{z}/{x}/{y}?v=${ver}`];
      if (gl.getSource("avy")) gl.getSource("avy").setTiles(tiles);
      else gl.addSource("avy", { type: "raster", tiles, tileSize: 256, minzoom: 8, maxzoom: 14, attribution: "Avalanche forecast: <a href=\"https://avalanche.ca\">Avalanche Canada</a>" });
      if (!has) gl.addLayer({ id: "avy", type: "raster", source: "avy", paint: { "raster-fade-duration": 0 } }, gl.getLayer("osm-roads") ? "osm-roads" : undefined);
    };
    if (gl.isStyleLoaded()) apply(); else gl.once("styledata", apply);
  }
  window.addEventListener("tf:map3d", sync3d);

  // ---------- slope angle: any day, with or without a forecast ----------
  // The usual avalanche-terrain colours (as on CalTopo, onX and FATMAP): 27° is about where slabs start to slide,
  // 30-45° is where most avalanches start.
  const SLOPE = [[27, "27-29°", "#f2e14c"], [30, "30-34°", "#f59f00"], [35, "35-39°", "#e8392f"], [40, "40-44°", "#9c36b5"], [45, "45°+", "#1c3faa"]];
  const SLOPE_RGB = SLOPE.map((x) => rgb(x[2]));
  async function paintSlope(z, x, y) {
    const out = new ImageData(256, 256), E = await dem(z, x, y), o = out.data, k = 25 / minSlope(E.z);
    for (let py = 0; py < 256; py++) {
      const lat = tileLat(y + (py + 0.5) / 256, z), m = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
      const y0 = py > 0 ? py - 1 : py, y1 = py < 255 ? py + 1 : py;
      for (let px = 0; px < 256; px++) {
        const i = py * 256 + px;
        if (E[i] < 0) continue;
        const x0 = px > 0 ? px - 1 : px, x1 = px < 255 ? px + 1 : px;
        const dzdx = (E[py * 256 + x1] - E[py * 256 + x0]) / ((x1 - x0) * m), dzdy = (E[y1 * 256 + px] - E[y0 * 256 + px]) / ((y1 - y0) * m);
        const slope = ((Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI) * k;
        if (slope < 27) continue;
        const c = SLOPE_RGB[slope >= 45 ? 4 : slope >= 40 ? 3 : slope >= 35 ? 2 : slope >= 30 ? 1 : 0], j = i * 4;
        o[j] = c[0]; o[j + 1] = c[1]; o[j + 2] = c[2]; o[j + 3] = 150;
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
        const cv = new OffscreenCanvas(256, 256);
        cv.getContext("2d").putImageData(await paintSlope(z, x, y), 0, 0);
        return { data: await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer() };
      });
    }
    const want = sport === "ski" && shown.has("slope");
    const apply = () => {
      if (!gl.getStyle()) return;
      const has = !!gl.getLayer("skislope");
      if (!want) { if (has) gl.removeLayer("skislope"); if (gl.getSource("skislope")) gl.removeSource("skislope"); return; }
      if (!gl.getSource("skislope")) gl.addSource("skislope", { type: "raster", tiles: ["tfslope://{z}/{x}/{y}"], tileSize: 256, minzoom: 9, maxzoom: 14, attribution: "Slope angle: Mapzen Terrain Tiles" });
      if (!has) gl.addLayer({ id: "skislope", type: "raster", source: "skislope", paint: { "raster-fade-duration": 0 } }, gl.getLayer("avy") ? "avy" : gl.getLayer("osm-roads") ? "osm-roads" : undefined);
    };
    if (gl.isStyleLoaded()) apply(); else gl.once("styledata", apply);
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

  function refreshAvy() {
    ver++;
    const want = sport === "ski" && avyOn;
    if (want && !avy && !example) loadAvy();
    if (want) { if (!map.hasLayer(avyGrid)) avyGrid.addTo(map); else avyGrid.redraw(); }
    else if (map.hasLayer(avyGrid)) map.removeLayer(avyGrid);
    sync3d();
    renderForecast();
    if (selected && sport === "ski") { const d = $("skDetail"); if (!d.hidden) select(selected); }
    avyBtn.classList.toggle("on", avyOn);
    avyBtn.setAttribute("aria-pressed", String(avyOn));
  }
  avyBtn.hidden = false;
  avyBtn.title = "Shade the slopes by the avalanche forecast (Avalanche Canada)";
  avyBtn.addEventListener("click", () => {
    avyOn = !avyOn; store.set("avy", avyOn);
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
  function paintHeat(z, x, y) {
    const out = new ImageData(256, 256);
    if (!heat) return out;
    const n = 2 ** z * 256, top = tileLat(y, z), bottom = tileLat(y + 1, z), left = tileLon(x, z), right = tileLon(x + 1, z);
    const [cl, co] = heat.cell, buf = new Uint16Array(65536);
    const cw = Math.max(1, (co / 360) * n);
    let any = false;
    for (const sq of heat.squares) {
      const [s, w, nn, e] = sq.box;
      if (s > top || nn < bottom || w > right || e < left) continue;
      const c = sq.c;
      for (let i = 0; i < c.length; i += 3) {
        const lat0 = s + c[i] * cl, lon0 = w + c[i + 1] * co;
        if (lat0 > top || lat0 + cl < bottom || lon0 > right || lon0 + co < left) continue;
        const px0 = ((lon0 + 180) / 360) * n - x * 256, py1 = mercY(lat0) * n - y * 256, py0 = mercY(lat0 + cl) * n - y * 256;
        const xa = Math.max(0, Math.floor(px0)), xb = Math.min(256, Math.max(xa + 1, Math.ceil(px0 + cw)));
        const ya = Math.max(0, Math.floor(py0)), yb = Math.min(256, Math.max(ya + 1, Math.ceil(py1)));
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
      const k = v === 1 ? 0 : v === 2 ? 1 : v <= 5 ? 2 : 3;
      o[j * 4] = HEAT_RGB[k][0]; o[j * 4 + 1] = HEAT_RGB[k][1]; o[j * 4 + 2] = HEAT_RGB[k][2]; o[j * 4 + 3] = k ? 235 : 190;
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
        const cv = new OffscreenCanvas(256, 256);
        cv.getContext("2d").putImageData(paintHeat(z, x, y), 0, 0);
        return { data: await (await cv.convertToBlob({ type: "image/png" })).arrayBuffer() };
      });
    }
    const want = sport === "ski" && shown.has("heat") && !!heat;
    const apply = () => {
      if (!gl.getStyle()) return;
      const has = !!gl.getLayer("skiheat");
      if (!want) { if (has) gl.removeLayer("skiheat"); if (gl.getSource("skiheat")) gl.removeSource("skiheat"); return; }
      const tiles = [`tfheat://{z}/{x}/{y}?v=${heatVer}`];
      if (gl.getSource("skiheat")) gl.getSource("skiheat").setTiles(tiles);
      else gl.addSource("skiheat", { type: "raster", tiles, tileSize: 256, minzoom: 7, maxzoom: 16, attribution: "Ski heatmap: OpenStreetMap public GPS traces" });
      if (!has) gl.addLayer({ id: "skiheat", type: "raster", source: "skiheat", paint: { "raster-fade-duration": 0, "raster-opacity": 0.85 } }, gl.getLayer("osm-roads") ? "osm-roads" : undefined);
    };
    if (gl.isStyleLoaded()) apply(); else gl.once("styledata", apply);
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
    if (!r || !Array.isArray(r.points) || r.points.length < 2) return false;
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
    slopeAt: async (lat, lon) => { const p = [{ lat, lon }]; await heights(p, 0); return { slope: p[0].slope, e: p[0].e }; },
  };
  window.tfSkiOffline = (box) => {
    const tx = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
    const ty = (lat, z) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
    const tiles = [];
    for (let z = 10; z <= OFFLINE_DEM_Z; z++) for (let x = tx(box[1], z); x <= tx(box[3], z); x++) for (let y = ty(box[2], z); y <= ty(box[0], z); y++) tiles.push(DEM(z, x, y));
    const data = ["ski", "avalanche", "avalanche-reports", "snow-stations", "snowmobile-clubs", "grooming", "ski-heat"].map((n) => new URL(`data/${n}.json`, location.href).href);
    return { data, tiles };
  };

  // ---------- switching sport ----------
  function setSport(s) {
    sport = SPORTS.includes(s) ? s : "mtb";
    store.set("sport", sport);
    sel.value = sport;
    for (const s of SPORTS) document.body.classList.toggle(`sport-${s}`, sport === s);
    document.body.classList.toggle("sport-alt", sport !== "mtb");
    if (window.tfSyncResultsCol) window.tfSyncResultsCol();   // wide desktop: no empty MTB results column in Skiing or Hunting
    const mtb = window.tfMtbLayers || [];
    if (sport === "mtb") mtb.forEach((l) => { if (!map.hasLayer(l)) l.addTo(map); });
    else mtb.forEach((l) => map.removeLayer(l));
    if (sport === "ski") {
      skiLayer.addTo(map); hutLayer.addTo(map); mineLayer.addTo(map); clubLayer.addTo(map); snowLayer.addTo(map); aboveLayer.addTo(map);
      loadSki(); loadMine(); loadClubs(); if (shown.has("snow")) loadSnow(); renderSwitches(); renderList(); drawPlan(); renderPlan();
    } else {
      setPlanning(false);
      [skiLayer, hutLayer, mineLayer, clubLayer, hoverLayer, snowLayer, aboveLayer, plan.layer].forEach((l) => map.removeLayer(l));
    }
    // The map's ▶ Ride button records a ski tour in Skiing (navigate.js).
    const rideBtn = document.getElementById("navRideBtn");
    if (rideBtn) rideBtn.textContent = sport === "ski" ? "▶ Record" : "▶ Ride";
    refreshAvy(); refreshHeat(); refreshSlope();
    map.invalidateSize({ pan: false });   // the map is wider in Skiing and Hunting on a wide desktop (no results column)
    window.dispatchEvent(new CustomEvent("tf:sport", { detail: sport }));
  }
  sel.addEventListener("change", () => setSport(sel.value));
  setSport(sport);
})();
