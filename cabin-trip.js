// Plan a cabin trip (Skiing). alex 2026-10-30: "we should have feature 'plan a cabin trip' in skiing", then picked
// the core first: the cabin and the dates, the way in, the conditions for each day of the trip, and saving it all for
// when there's no signal.
//  - "🏕 Plan a cabin trip here" on a hut's card (winter.js select) opens the trip card: the night you go in, how many
//    nights, how many people, and what's known about the cabin (its tags: beds, price, booking, who runs it, links;
//    the huts thread fills the same tags from the clubs' own pages).
//  - The way in: the easiest walk from a parking lot (or a road) to the cabin, worked out by fish-route.js (the same
//    search as Fishing's Route, with the ski routes added as trails; a logging road counts as a start but costs more,
//    as most aren't plowed). Then its heights and slopes (ski-terrain.js): km, climb, Munter time in and out, steepest,
//    30°+ slopes, steep slopes above, the terrain class. "Show on map" opens it as a tour, with the route card's
//    Conditions, Avalanche check, Flyover, GPX and Go. "Draw my own" uses Plan a tour.
//  - Each day of the trip: the avalanche danger on the way in (Avalanche Canada, about 3 days ahead) with the
//    Avaluator light for the way in's terrain, and the weather at the cabin (Open-Meteo, about a week ahead); the snow
//    and wind in the 3 days before you go in.
//  - Save offline: the map, ski data and terrain around the cabin and the way in (offline.js), and the forecast as it
//    is now is kept with the trip and shown when there's no signal.
//  - Then (alex picked them 2026-10-30): day tours from the cabin (mapped tours within 1.5 km, ★ the ones you plan),
//    a packing list built from the trip (nights, people, what the cabin has, the coldest night, the way in's slopes),
//    and a trip plan to leave with a friend, with a late alert for their calendar at the "call for help" time.
//  - Then (alex 2026-11-11: "a folder where you can save the approach route and all the lines that you want to ride on that
//    trip", and a list of what to bring that you tick as it goes in the bag): each trip is a folder. "Your lines for
//    this trip" holds the way in plus any ski line added from its card (🏕 Add to cabin trip), a saved planned tour, or a
//    ★ tour near the cabin; they're kept with the trip (their points, so they show with no signal and go in the offline
//    save) and drawn together on the map. The packing list takes your own items and drops the ones you don't bring;
//    those choices carry over to the next trip (tf:tripPack, on the account when signed in).
// Trips are kept in tf:skiTrips, saved to the rider's account when signed in (account.js merges both devices' trips).
(() => {
  "use strict";
  const map = window.tfLeaflet, S = window.tfSki && window.tfSki.trip, T = window.tfTerrain;
  if (!map || !window.L || !S || !T) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const isSki = () => document.body.classList.contains("sport-ski");
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {   // "tf:setting" tells account.js to save the trips to the rider's account
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const COL = "#7048e8";   // the way in on the map and the trip card's colour
  const localDate = (d) => d.toLocaleDateString("en-CA");
  const addDays = (date, n) => { const d = new Date(date + "T12:00"); d.setDate(d.getDate() + n); return localDate(d); };
  const dayWord = (date) => new Date(date + "T12:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
  const fmtM = (m) => Math.round(m).toLocaleString() + " m";
  const fmtH = (h) => (h < 0.75 ? `${Math.max(15, Math.round((h * 60) / 15) * 15)} min` : `${Math.round(h * 2) / 2} h`);
  const deg = (v) => (v == null ? "–" : `${Math.round(v) === 0 ? 0 : Math.round(v)}°`);

  const css = document.createElement("style");
  css.textContent = `
#skiPane .sk-trip { border: 1.5px solid ${COL}; background: color-mix(in srgb, ${COL} 5%, var(--panel)); }
#skiPane .sk-trip h3 { display: flex; gap: 6px; align-items: baseline; }
#skiPane .sk-trip h3 small { font-weight: 600; color: var(--muted); font-size: .78rem; }
#skiPane .tp-form { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 6px; }
#skiPane .tp-form label { display: flex; flex-direction: column; gap: 2px; font-size: .7rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); min-width: 0; }
#skiPane .tp-form input { font: inherit; font-size: .9rem; padding: 7px 6px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); min-width: 0; width: 100%; box-sizing: border-box; }
#skiPane .tp-step { display: flex; align-items: center; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); overflow: hidden; }
#skiPane .tp-step button { font: inherit; font-size: 1rem; font-weight: 800; border: 0; background: none; color: var(--fg); width: 30px; height: 34px; cursor: pointer; flex: none; }
#skiPane .tp-step b { flex: 1; text-align: center; font-size: .95rem; color: var(--fg); text-transform: none; letter-spacing: 0; }
#skiPane .tp-facts { display: flex; flex-wrap: wrap; gap: 4px; }
#skiPane .tp-facts span, #skiPane .tp-facts a { font-size: .76rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--chip); color: var(--fg); text-decoration: none; border: 1px solid var(--line); }
#skiPane .tp-facts a { color: #1f5fe0; }
#skiPane .tp-facts .warn { background: color-mix(in srgb, #f08c00 18%, var(--panel)); border-color: #f08c00; }
#skiPane .tp-way { display: flex; flex-direction: column; gap: 4px; }
#skiPane .tp-stats { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: .86rem; }
#skiPane .tp-stats b { font-size: 1rem; }
#skiPane .tp-days { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
#skiPane .tp-days li { border: 1px solid var(--line); border-left: 6px solid var(--c, var(--line)); border-radius: 10px; padding: 6px 9px; display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; font-size: .8rem; background: var(--panel); }
#skiPane .tp-days li > b { font-size: .88rem; }
#skiPane .tp-days li > .tp-wx { grid-row: span 2; text-align: right; font-size: .8rem; line-height: 1.35; }
#skiPane .tp-days li > .tp-wx big { font-size: 1.05rem; font-weight: 800; }
#skiPane .tp-days li > span { color: var(--fg); }
#skiPane .tp-days li > small { grid-column: 1 / -1; color: var(--muted); }
#skiPane .tp-btns { display: flex; flex-wrap: wrap; gap: 6px; }
#skiPane .tp-btns > * { font: inherit; font-size: .84rem; font-weight: 800; padding: 9px 12px; border-radius: 11px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; }
#skiPane .tp-btns .go { background: ${COL}; border-color: ${COL}; color: #fff; flex: 1; justify-content: center; }
#skiPane .tp-closed { margin: 0 0 8px; padding: 8px 10px; border-radius: 10px; border: 1.5px solid #e03131; background: color-mix(in srgb, #e03131 10%, var(--panel)); font-size: .8rem; line-height: 1.35; }
#skiPane .tp-closed a { color: #1f5fe0; font-weight: 700; }
#skiPane .tp-winter { margin: 6px 0 0; padding: 8px 10px; border-radius: 10px; background: var(--chip); border: 1px solid var(--line); font-size: .8rem; line-height: 1.35; }
#skiPane .tp-winter b { display: block; font-size: .74rem; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); margin-bottom: 2px; }
#skiPane .tp-wait { display: flex; align-items: center; gap: 8px; font-size: .84rem; color: var(--muted); margin: 0; }
#skiPane .tp-wait::before { content: ""; width: 14px; height: 14px; border-radius: 50%; border: 2px solid ${COL}; border-right-color: transparent; animation: tpspin .8s linear infinite; flex: none; }
@keyframes tpspin { to { transform: rotate(360deg); } }
#skiPane .tp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
#skiPane .tp-list button { font: inherit; width: 100%; text-align: left; display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; font-size: .85rem; }
#skiPane .tp-list button small { color: var(--muted); white-space: nowrap; }
#skiPane .sk-tripgo { font: inherit; font-size: .9rem; font-weight: 800; padding: 10px; border-radius: 11px; border: 0; background: ${COL}; color: #fff; cursor: pointer; }
#skiPane .tp-tours li { display: flex; gap: 4px; }
#skiPane .tp-tours li > button:first-child { flex: 1; }
#skiPane .tp-tours small { color: var(--muted); white-space: normal; }
#skiPane .tp-list .tp-star { flex: none; width: 48px; justify-content: center; align-items: center; font-size: 1.3rem; color: #f08c00; }
#skiPane details.tp-pack > summary, #skiPane details.tp-plan > summary { font-size: .92rem; font-weight: 800; padding: 4px 0; }
#skiPane details summary small { font-weight: 600; color: var(--muted); margin-left: 4px; }
#skiPane .tp-pack h5 { margin: 8px 0 2px; font-size: .74rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
#skiPane .tp-check { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; font-size: .86rem; line-height: 1.3; cursor: pointer; }
#skiPane .tp-check input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: ${COL}; }
#skiPane .tp-check input:checked + span { color: var(--muted); text-decoration: line-through; }
#skiPane .tp-pack .tp-btns, #skiPane .tp-plan .tp-btns { margin-top: 8px; }
#skiPane .tp-plan > p, #skiPane .tp-plan-form { margin: 6px 0; }
#skiPane .tp-plan-form { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#skiPane .tp-plan-form .wide { grid-column: 1 / -1; }
#skiPane .tp-plan-form label { display: flex; flex-direction: column; gap: 2px; font-size: .7rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); min-width: 0; }
#skiPane .tp-plan-form input { font: inherit; font-size: 16px; padding: 7px 6px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); min-width: 0; width: 100%; box-sizing: border-box; }
#skiPane .tp-plan .tp-btns > * { flex: 1 1 40%; justify-content: center; text-align: center; }
#skiPane .tp-late { color: #c92a2a; font-weight: 700; }
#skiPane .tp-late-tag { color: #fff !important; background: #c92a2a; border-radius: 6px; padding: 1px 6px; font-weight: 800; }
#skiPane .tp-lines .tp-sw { display: inline-block; width: 16px; height: 4px; border-radius: 2px; background: #e8590c; vertical-align: middle; margin-right: 6px; box-shadow: 0 0 0 1.5px #fff, 0 0 0 2.5px var(--line); }
#skiPane .tp-lines .tp-sw.way { background: ${COL}; }
#skiPane .tp-list .tp-rm { flex: none; width: 44px; justify-content: center; align-items: center; font-size: 1rem; color: var(--muted); }
#skiPane .tp-addf { display: flex; gap: 6px; margin-top: 8px; }
#skiPane .tp-addf input { flex: 1; font: inherit; font-size: 16px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); min-width: 0; }
#skiPane .tp-addf button { font: inherit; font-size: .86rem; font-weight: 800; padding: 8px 14px; border-radius: 10px; border: 0; background: ${COL}; color: #fff; cursor: pointer; }
#skiPane .tp-addto { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
#skiPane .tp-addto > button, #skiPane .tp-addto li button { font: inherit; font-size: .86rem; font-weight: 800; padding: 10px; border-radius: 11px; border: 1.5px solid ${COL}; background: color-mix(in srgb, ${COL} 7%, var(--panel)); color: var(--fg); cursor: pointer; width: 100%; }
#skiPane .tp-addto .tp-in { display: flex; align-items: center; gap: 8px; font-size: .84rem; padding: 8px 10px; border-radius: 11px; background: color-mix(in srgb, ${COL} 10%, var(--panel)); }
#skiPane .tp-addto .tp-in span { flex: 1; }
#skiPane .tp-addto .tp-in button { font: inherit; font-size: .8rem; font-weight: 700; border: 1px solid var(--line); background: var(--panel); color: var(--fg); border-radius: 9px; padding: 6px 10px; cursor: pointer; }
#skiPane .tp-names { list-style: none; margin: 6px 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
#skiPane .tp-names li { display: inline-flex; align-items: center; gap: 2px; padding: 2px 2px 2px 12px; border-radius: 999px; background: color-mix(in srgb, ${COL} 14%, var(--panel)); font-weight: 700; font-size: .86rem; }
#skiPane .tp-names button { font: inherit; border: 0; background: none; color: var(--muted); width: 32px; height: 32px; cursor: pointer; }
#skiPane .tp-mine { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; font-size: .7rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
#skiPane .tp-mine input, #skiPane .tp-meal input, #skiPane .tp-costadd input, #skiPane .tp-note textarea { font: inherit; font-size: 16px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); min-width: 0; box-sizing: border-box; }
#skiPane .tp-mine input { text-transform: none; letter-spacing: 0; font-weight: 400; }
#skiPane .sk-trip select { font: inherit; font-size: 16px; padding: 7px 6px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); min-width: 0; max-width: 100%; }
#skiPane .tp-plan-form select { width: 100%; }
#skiPane .tp-pkrow { display: flex; align-items: center; gap: 6px; }
#skiPane .tp-pkrow .tp-check { flex: 1; min-width: 0; }
#skiPane .tp-pkrow .tp-pkx { flex: none; width: 30px; height: 30px; padding: 0; border: 0; background: none; color: var(--muted); font-size: 14px; cursor: pointer; border-radius: 8px; }
#skiPane .tp-pkrow .tp-pkx:hover { color: #c92a2a; }
#skiPane .tp-pkrow .tf-grip { width: 30px; margin-right: -6px; }
#skiPane .tp-pkrow .tp-who { flex: none; width: 104px; font-size: 13px; padding: 5px 4px; color: var(--muted); }
#skiPane .tp-pkrow .tp-who.set { color: var(--fg); font-weight: 700; border-color: ${COL}; background: color-mix(in srgb, ${COL} 8%, var(--bg)); }
#skiPane .tp-bar { height: 10px; border-radius: 999px; background: var(--chip); overflow: hidden; margin: 4px 0 6px; border: 1px solid var(--line); }
#skiPane .tp-bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, ${COL}, #20c997); transition: width .4s ease; }
#skiPane .tp-ready { margin: 4px 0; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, #20c997 16%, var(--panel)); font-weight: 800; font-size: .9rem; animation: tppop .5s ease; }
@keyframes tppop { 0% { transform: scale(.9); opacity: 0; } 60% { transform: scale(1.03); opacity: 1; } 100% { transform: scale(1); } }
/* The meal on its own full-width line under the meal's name and who cooks, growing with the text so all of it shows
   (alex 2026-11-11: "when you click on it you see everything you write"). */
#skiPane .tp-meal { display: grid; grid-template-columns: 1fr 120px; gap: 4px 6px; align-items: center; margin: 6px 0 10px; font-size: .84rem; font-weight: 700; }
#skiPane .tp-meal select { font-size: 13px; padding: 7px 4px; }
#skiPane .tp-meal textarea { grid-column: 1 / -1; font: inherit; font-size: 16px; font-weight: 400; line-height: 1.35; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); width: 100%; box-sizing: border-box; resize: none; overflow: hidden; min-height: 40px; field-sizing: content; }
#skiPane .tp-meal textarea:focus { border-color: ${COL}; outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, ${COL} 18%, transparent); }
#skiPane .tp-costs, #skiPane .tp-pay { list-style: none; margin: 6px 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
#skiPane .tp-costs li { display: flex; align-items: center; gap: 8px; padding: 6px 4px 6px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); font-size: .88rem; }
#skiPane .tp-costs li span { flex: 1; display: flex; flex-direction: column; }
#skiPane .tp-costs li { flex-wrap: wrap; }
#skiPane .tp-split { flex-basis: 100%; grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 2px 0 2px; }
#skiPane .tp-split small { color: var(--muted); font-size: .78rem; font-weight: 700; margin-right: 2px; }
#skiPane .tp-split button.tp-chip { width: auto; height: auto; font: inherit; font-size: .8rem; font-weight: 700; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); color: var(--muted); cursor: pointer; text-decoration: line-through; }
#skiPane .tp-split button.tp-chip[aria-pressed="true"] { background: color-mix(in srgb, ${COL} 14%, var(--panel)); border-color: ${COL}; color: var(--fg); text-decoration: none; }
#skiPane .tp-split button.tp-chip[aria-pressed="true"]::before { content: "✓ "; }
#skiPane .tp-split button.tp-all { text-decoration: none; color: ${COL}; border-color: ${COL}; background: var(--panel); }
#skiPane .tp-split button.tp-all[aria-pressed="true"] { background: ${COL}; color: #fff; }
#skiPane .tp-costs li small { color: var(--muted); font-size: .76rem; }
#skiPane .tp-costs li button, #skiPane .tp-notei button { font: inherit; border: 0; background: none; color: var(--muted); width: 34px; height: 34px; cursor: pointer; }
#skiPane .tp-costadd { display: grid; grid-template-columns: 1fr 72px; gap: 6px; margin-top: 6px; }
#skiPane .tp-costadd select { grid-column: 1; }
#skiPane .tp-costadd button, #skiPane .tp-note button { font: inherit; font-size: .86rem; font-weight: 800; padding: 9px 12px; border-radius: 10px; border: 0; background: ${COL}; color: #fff; cursor: pointer; }
#skiPane .tp-sum { margin: 8px 0 2px; font-size: .9rem; }
#skiPane .tp-pay li { padding: 6px 10px; border-radius: 10px; background: color-mix(in srgb, #20c997 12%, var(--panel)); font-size: .88rem; }
#skiPane .tp-note { display: flex; flex-direction: column; gap: 6px; }
#skiPane .tp-note textarea { width: 100%; resize: vertical; }
#skiPane .tp-notei { border-left: 3px solid ${COL}; padding: 2px 0 2px 10px; margin: 8px 0; }
#skiPane .tp-notei small { display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: .76rem; }
#skiPane .tp-notei p { margin: 0; font-size: .88rem; white-space: pre-wrap; }
#skiPane .tp-photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
#skiPane .tp-photos figure { margin: 0; position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden; background: var(--chip); }
#skiPane .tp-photos img { width: 100%; height: 100%; object-fit: cover; display: block; }
#skiPane .tp-photos button { position: absolute; top: 3px; right: 3px; width: 30px; height: 30px; border-radius: 50%; border: 0; background: rgba(0,0,0,.55); color: #fff; cursor: pointer; }
#skiPane .tp-photoadd { display: flex; justify-content: center; margin-top: 6px; padding: 10px; border-radius: 11px; border: 1.5px dashed ${COL}; font-weight: 800; font-size: .88rem; cursor: pointer; }
#skiPane .sk-acts.tp4 { grid-template-columns: repeat(3, 1fr); }`;   /* phones: one row each (theme.css) */
  document.head.append(css);

  // ---------- the card and its button ----------
  const card = document.createElement("div");
  card.className = "sk-card sk-trip";
  card.id = "skTrip";
  card.hidden = true;
  const detail = $("skDetail");
  if (detail) detail.before(card); else return;
  const acts = document.querySelector("#skiPane .sk-acts");
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "sk-act"; btn.id = "skTripBtn"; btn.textContent = "🏕 Cabin trip";
  btn.title = "Plan a trip to a backcountry cabin: the way in, the forecast for each day, offline";
  if (acts) { acts.append(btn); acts.classList.add("tp4"); }
  const layer = L.layerGroup();

  const trips = () => store.get("skiTrips", []);
  const putTrip = (t, snapOnly) => {   // without what's only for now (the way in's heights are big: worked out again when needed)
    if (!snapOnly) t.ed = Date.now();   // the newer edit wins when two devices' trips merge (account.js); a new forecast isn't an edit
    const { wayWait, ...keep } = t, l = trips().filter((x) => x.id !== t.id);
    l.unshift(keep); store.set("skiTrips", l.slice(0, 20));
    if (!snapOnly && t.share) pushSoon(t);   // a shared trip: the change goes to the group
  };
  const infos = new Map();   // trip id -> the way in's heights and slopes (ski-terrain.js info), for its route card
  let cur = null, seq = 0, view = null;   // cur: the trip on the card; view: its forecast rows as last worked out
  const wayRun = { n: 0 };

  const scrollTo = () => { if (window.tfSnapTo) window.tfSnapTo("half"); setTimeout(() => { if (window.tfPanelScrollTo) window.tfPanelScrollTo(card); else card.scrollIntoView({ block: "start" }); }, 60); };
  function close() {
    seq++; cur = null; view = null; card.hidden = true; card.innerHTML = ""; layer.clearLayers();
    try { sessionStorage.removeItem("tf:tripOpen"); } catch {}
    btn.setAttribute("aria-pressed", "false");
  }

  // ---------- trips ----------
  const hutOf = (h) => ({ id: h.id, name: h.name || "", kind: h.kind || "", lat: h.lat, lon: h.lon, tags: h.tags || {} });
  // A trip doesn't need a cabin to start (alex 2026-11-11: "I don't want to be obligated to select a cabin before starting
  // organising the rest"): ＋ Start a new trip opens one with no cabin (t.hut null, named by you), and the cabin comes
  // later, from the card's list or a cabin's 🏕 Use this cabin for… on the map.
  const newTrip = () => ({ id: Date.now().toString(36), hut: null, name: "", date: addDays(localDate(new Date()), 1), nights: 2, people: 4, way: null, at: Date.now(), lines: [], ...packTpl() });
  function setHut(t, h) {
    t.hut = hutOf(h); t.way = null; t.wayFail = ""; t.tours = null; t.snap = null;
    putTrip(t);
    start(t);
    toast(`${hutName(t)} is the cabin for this trip.`);
  }
  function open(h) {
    if (!h) return;
    if (cur && !cur.hut && !card.hidden) { setHut(cur, h); return; }   // the open trip had no cabin yet
    const old = trips().find((x) => x.hut && x.hut.id === h.id);
    const t = old || { ...newTrip(), hut: hutOf(h) };
    t.hut = { ...t.hut, ...hutOf(h), tags: { ...(t.hut.tags || {}), ...(h.tags || {}) } };   // newer facts about the cabin win
    start(t);
  }
  function start(t) {
    cur = t; view = null;
    try { sessionStorage.setItem("tf:tripOpen", t.id); } catch {}   // back on the same trip if the page reloads (signing in)
    if (!t.own) Object.assign(t, packTpl());   // a trip from before your own items: starts with your usual ones
    if (!trips().some((x) => x.id === t.id)) putTrip(t);   // kept from the first tap, so nothing started is ever lost
    card.hidden = false; btn.setAttribute("aria-pressed", "true");
    render();
    drawWay();
    scrollTo();
    if (!t.hut) { nearCabins(); return; }
    if (t.way && t.way.src === "auto" && t.way.v !== WAY_V) { t.way = null; t.wayFail = ""; }
    if (!t.way && !/^(noroad|water)$/.test(t.wayFail || "")) findWay(t);
    loadDays(t);
    loadTours(t).then(() => movePicks(t));
  }
  // "· 3 days to go" (fun to watch it count down), "· today!", "· you're there", nothing once it's over.
  const countdown = (t) => {
    const d = Math.round((new Date(t.date + "T12:00") - new Date(localDate(new Date()) + "T12:00")) / 864e5);
    return d > 1 ? ` · <b>${d} days to go</b>` : d === 1 ? " · <b>tomorrow!</b>" : d === 0 ? " · <b>today!</b>" : -d <= t.nights ? " · <b>you're there</b>" : "";
  };
  const hutName = (t) => (t.hut ? t.name || t.hut.name || S.KIND[t.hut.kind] || "Cabin" : t.name || "My trip");

  // ---------- the way in ----------
  // The search from fish-route.js, back from the cabin to the best place to leave the car within 2, 5 or 9 km, with
  // the ski routes as trails. Its line runs from the start to the cabin. In winter the car stays on a plowed road
  // (alex 2026-10-30, Tom's Hut: "most fsr are not plowed during winter so you have to backcountry ski on the fsr"):
  // a paved road or a lot beside one; logging roads and tracks are part of the ski in. A hut's known winter parking
  // (data/huts.json "winter:parking", from the club or a trip report) wins: the way in starts there. And it follows the
  // hut's own winter route (alex 2026-11-06, Keith's Hut: "are you basing ... the route to the cabin on the winter access
  // information?"): the mapped ski routes named in "winter:route" (";" between names), or named after the hut with
  // "winter" in the name ("Keith's Hut Winter Access"), cost half as much as any other trail (fish-route.js WAY_X).
  const WAY_V = 3;   // ways worked out before the winter parking and winter routes are worked out again
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  function winterWay(hut) {
    const named = String(hut.tags["winter:route"] || "").split(";").map(norm).filter(Boolean);
    const base = norm(hut.name).replace(/\b(memorial|hut|cabin|lodge|refuge|shelter|the)\b/g, " ").replace(/\s+/g, " ").trim();
    return (name) => { const n = norm(name); return !!n && (named.includes(n) || (base.length > 2 && /\bwinter\b/.test(n) && n.includes(base))); };
  }
  async function findWay(t) {
    const my = ++wayRun.n;
    t.wayWait = "Looking for the easiest way in from a parking lot…"; render();
    const say = (s) => { if (cur === t && wayRun.n === my) { t.wayWait = s; renderWay(); } };
    try {
      await S.loadJs("fish-route");
      const FR = window.tfFishRoute;
      if (!FR || !FR._build) throw new Error("no route finder");
      const routes = await S.near([t.hut.lat, t.hut.lon], 10);
      const isWay = winterWay(t.hut);
      const lines = routes.flatMap((r) => r.lines.map((pts) => ({ pts, name: r.name || "", way: isWay(r.name) })));
      const wayNames = [...new Set(lines.filter((l) => l.way).map((l) => l.name))];
      const wp = String(t.hut.tags["winter:parking"] || "").split(",").map(Number), known = wp.length === 2 && wp.every(isFinite) ? wp : null;
      const out = await FR._build([t.hut.lat, t.hut.lon], known ? { you: known, lines } : { lines, radii: [2000, 5000, 9000], winter: true },
        (s) => say(s === "terrain" ? "Reading the terrain, trails and roads around the cabin…" : "Working out the easiest way in…"));
      if (wayRun.n !== my) return;
      if (out.fail) { t.wayFail = out.fail === "water" ? "water" : "noroad"; t.wayWait = ""; putTrip(t); if (cur === t) { render(); drawWay(); } return; }
      const d = FR._describe(out.g, out.res);
      const line = [];
      for (const r of d.runs) for (const p of r.pts) { const q = [+p[0].toFixed(5), +p[1].toFixed(5)], l = line[line.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) line.push(q); }
      const from = known ? `Park at ${t.hut.tags["winter:parking:name"] || "the winter parking"}` : out.park ? (out.parkName ? `Park at ${/parking|trailhead|lot\b|stationnement/i.test(out.parkName) ? "" : "the parking for "}${out.parkName}` : `Park at the parking lot${out.roadName ? ` by ${out.roadName}` : ""}`)
        : `Park beside ${out.roadName || "the plowed road"}`;
      await setWay(t, line, { src: "auto", v: WAY_V, from, known: !!known, unplowed: Math.round(out.unplowed || 0), winter: wayNames.filter((n) => d.runs.reduce((m, r) => m + (r.name === n ? r.m : 0), 0) >= 200), offM: Math.round(d.offM), names: [...new Set(d.runs.filter((r) => r.name && r.m >= 300).map((r) => r.name))].slice(0, 4) });
    } catch (e) {
      if (wayRun.n !== my) return;
      t.wayFail = "net"; t.wayWait = "";
      if (cur === t) render();
    }
  }
  // Heights, slopes and times of a way in (line from the start to the cabin).
  async function setWay(t, line, o) {
    t.wayWait = "Working out the heights and slopes…"; if (cur === t) renderWay();
    const info = await S.info([line]);
    const pts = info.pts, flip = map.distance([pts[0].lat, pts[0].lon], line[0]) > map.distance([pts.at(-1).lat, pts.at(-1).lon], line[0]);
    const seq2 = flip ? pts.slice().reverse() : pts;   // from the start to the cabin
    const munter = (ps) => { let h = 0; for (let i = 1; i < ps.length; i++) { const dk = Math.abs(ps[i].d - ps[i - 1].d) / 1000, dz = ps[i].e - ps[i - 1].e; h += dz >= 0 ? (dk + dz / 100) / 4 : (dk - dz / 100) / 10; } return h; };
    const cls = T.terrainClass(info);
    t.way = { ...o, line, km: +(info.total / 1000).toFixed(2), up: Math.round(info.up), down: Math.round(info.down), min: Math.round(info.min), max: Math.round(info.max),
      hut: Math.round(seq2.at(-1).e), park: Math.round(seq2[0].e), hIn: +munter(seq2).toFixed(2), hOut: +munter(seq2.slice().reverse()).toFixed(2),
      steep: Math.round(info.maxSlope), km30: +info.km30.toFixed(2), above: info.above == null ? null : +info.above.toFixed(2), cls: cls.c, why: cls.why };
    infos.set(t.id, info);
    t.wayFail = ""; t.wayWait = "";
    putTrip(t);
    if (cur === t) { render(); drawWay(); loadDays(t); }
  }
  function drawWay() {
    layer.clearLayers();
    const t = cur;
    if (!t || !isSki()) return;
    if (t.hut) L.circleMarker([t.hut.lat, t.hut.lon], { pane: "ski", radius: 9, color: "#fff", weight: 3, fillColor: COL, fillOpacity: 1, interactive: false }).addTo(layer);
    for (const x of linesOf(t)) for (const l of x.ls) {
      L.polyline(l, { pane: "ski", color: "#fff", weight: 7, opacity: 0.9, interactive: false }).addTo(layer);
      L.polyline(l, { pane: "ski", color: LCOL, weight: 4, opacity: 1, interactive: false }).addTo(layer);
    }
    if (t.way && t.way.line.length > 1) {
      L.polyline(t.way.line, { pane: "ski", color: "#fff", weight: 8, opacity: 0.9, interactive: false }).addTo(layer);
      L.polyline(t.way.line, { pane: "ski", color: COL, weight: 4.5, opacity: 1, interactive: false }).addTo(layer);
      L.marker(t.way.line[0], { pane: "ski", interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<span class="sk-pin park" style="background:#1f5fe0">P</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(layer);
    }
    if (!map.hasLayer(layer)) layer.addTo(map);
    const b = tripBounds(t) || (t.hut ? L.latLng(t.hut.lat, t.hut.lon).toBounds(3000) : null);
    if (!b) return;
    if (!map.getBounds().contains(b)) map.fitBounds(b, { padding: [30, 30], maxZoom: 14 });
  }
  // Your own way in, drawn with Plan a tour: points from where you park to the cabin.
  let drawing = null;
  window.addEventListener("tf:ski-plan", (e) => {
    if (e.detail.on || !drawing) return;
    const t = drawing; drawing = null;
    let pts = S.planPts();
    if (pts.length < 2 || cur !== t) return;
    if (map.distance(pts[0], [t.hut.lat, t.hut.lon]) < map.distance(pts.at(-1), [t.hut.lat, t.hut.lon])) pts = pts.reverse();   // drawn from the cabin out
    setWay(t, pts.map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]), { src: "own", from: "Your own way in", offM: 0, names: [] }).catch(() => {});
    scrollTo();
  });

  // ---------- the days ----------
  // The weather at the cabin's height for each day, and the avalanche danger on the way in (its lowest to highest point;
  // the cabin's height ± 300 m before there is one). Kept with the trip (t.snap) for when there's no signal.
  const tripDates = (t) => Array.from({ length: t.nights + 1 }, (_, i) => addDays(t.date, i));
  async function loadDays(t) {
    if (!t.hut) return;
    const my = ++seq;
    const r = await snapOf(t);
    if (my !== seq || cur !== t) return;
    if (r.err) { view = t.snap ? { ...t.snap, old: true, err: r.err } : { err: r.err }; renderDays(); return; }
    view = r.snap;
    t.snap = view;
    putTrip(t, true);
    renderDays();
  }
  // The forecast rows for a trip, worked out fresh: { snap } or { err }.
  async function snapOf(t) {
    const ele = t.way ? t.way.hut : parseFloat(t.hut.tags.ele) || null;
    let w = null, err = "";
    try { w = await S.weather(t.hut.lat, t.hut.lon, ele); } catch (e) { err = e.message || "no signal"; }
    await S.avy().catch(() => {});
    if (!w) return { err: err || "no signal" };
    const dd = w.daily, lo = t.way ? t.way.min : (ele || 1500) - 300, hi = t.way ? t.way.max : (ele || 1500) + 300;
    const cls = t.way ? t.way.cls : 0;
    const rows = tripDates(t).map((date, j) => {
      const i = dd.time.indexOf(date), last = j === t.nights;
      const row = { date, tag: j === 0 ? "in" : last ? "out" : "" };
      if (i >= 0) Object.assign(row, { code: dd.weather_code[i], hi: dd.temperature_2m_max[i], lo: dd.temperature_2m_min[i], snow: dd.snowfall_sum[i] || 0,
        rain: Math.max(0, (dd.precipitation_sum[i] || 0) - (dd.snowfall_sum[i] || 0) / 0.7), wind: dd.wind_speed_10m_max[i], gust: dd.wind_gusts_10m_max[i], dir: dd.wind_direction_10m_dominant[i] });
      const dg = S.dangerOn(t.hut.lat, t.hut.lon, lo, hi, date);
      if (dg && dg.r) { row.r = dg.r; row.band = dg.band; if (cls) row.l = T.light(dg.r, cls); }
      else row.avNone = dg ? dg.none || "no rating" : "no forecast here today";
      return row;
    });
    // The 3 days before you go in: snow and the strongest wind (what loads the slopes you'll cross).
    const bi = [-3, -2, -1].map((k) => dd.time.indexOf(addDays(t.date, k))).filter((i) => i >= 0);
    const before = bi.length ? { snow: bi.reduce((s, i) => s + (dd.snowfall_sum[i] || 0), 0), wind: Math.max(...bi.map((i) => dd.wind_speed_10m_max[i] || 0)), n: bi.length } : null;
    const end = dd.time.at(-1);
    return { snap: { at: Date.now(), rows, before, end, ele: Math.round(ele || w.elevation || 0), example: S.example() } };
  }

  // ---------- the day before: everything that changes, updated by itself (alex 2026-11-11) ----------
  // A web page (and the iPhone app) can't run while it's closed, so this runs each time the app is opened or comes
  // back to the screen, from the day before the trip to its last day (winter.js loads this file for it even when
  // another sport is on): the weather and avalanche danger for each day go into the trip (t.snap, with the time they
  // were fetched), and the trip's offline save gets the latest ski, avalanche and snow files (the service worker
  // keeps the saved copy as fresh as each download). At most every 2 hours a trip. The calendar reminder below
  // (⏰ Remind me the day before) is what gets the app opened.
  const inWindow = (t, today) => t.hut && addDays(t.date, -1) <= today && today <= addDays(t.date, t.nights);
  let refreshing = false;
  async function refreshAhead() {
    if (refreshing || !navigator.onLine) return;
    const today = localDate(new Date()), due = trips().filter((t) => inWindow(t, today) && Date.now() - (t.autoAt || 0) > 2 * 3600e3);
    if (!due.length) return;
    refreshing = true;
    try {
      for (const t0 of due) {
        const r = await snapOf(t0);
        if (r.err) continue;
        const t = tripById(t0.id) || t0;
        t.snap = r.snap; t.autoAt = Date.now();
        const st = offSt(t);
        if (st && st.box && window.tfSkiOffline) {   // the saved copy's changing files, downloaded again
          const urls = window.tfSkiOffline(st.box).data;
          let ok = 0;
          for (let i = 0; i < urls.length; i += 6) ok += (await Promise.all(urls.slice(i, i + 6).map((u) => fetch(u, { cache: "no-cache" }).then((x) => x.ok, () => false)))).filter(Boolean).length;
          if (ok) t.offFresh = Date.now();
        }
        putTrip(t, true);
        if (cur && cur.id === t.id) { cur.snap = t.snap; cur.autoAt = t.autoAt; cur.offFresh = t.offFresh; view = t.snap; renderDays(); const el = $("tpOff"); if (el) el.innerHTML = offHtml(cur); }
      }
    } finally { refreshing = false; }
  }
  setTimeout(refreshAhead, 4000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshAhead(); });
  window.addEventListener("online", () => refreshAhead());
  // A calendar event the evening before: open the app so the trip updates (forecast, avalanche, offline copy).
  function dayBeforeIcs(t) {
    const at = new Date(addDays(t.date, -1) + "T18:00"), url = location.protocol === "https:" ? location.origin + location.pathname : "https://trailfinderapp.ca/";
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trail Finder//Cabin trip//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT", `UID:tf-before-${t.id}@trail-finder`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(at)}`, `DTEND:${stamp(new Date(at.getTime() + 15 * 60000))}`,
      `SUMMARY:${icsEsc(`Open Trail Finder: update your ${hutName(t)} trip`)}`,
      `DESCRIPTION:${icsEsc(`Your trip starts tomorrow. Open Trail Finder with signal: the trip's weather, avalanche danger and offline copy update by themselves.\n${url}`)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(`Open Trail Finder to update your ${hutName(t)} trip`)}`, "TRIGGER:PT0M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].map((l) => (l.match(/.{1,60}/gu) || [""]).join("\r\n ")).join("\r\n");
  }

  // ---------- day tours from the cabin ----------
  // The mapped tours and snowshoe routes that pass within 1.5 km of the cabin, for the full days you're there. A ★ puts
  // one in the trip plan you leave with a friend. Kept with the trip (t.tours) so the list shows with no signal.
  async function loadTours(t) {
    if (!t.hut || !window.tfSki || !window.tfSki.near) return;
    try {
      const r = await window.tfSki.near([t.hut.lat, t.hut.lon], 3, ["tour", "snowshoe", "other"]);
      t.tours = r.routes.filter((x) => x.d <= 1500).slice(0, 8).map((x) => ({ id: x.id, name: x.name, label: x.label, km: +x.km.toFixed(1), d: Math.round(x.d), pill: x.pill, c: x.c }));
      putTrip(t, true);   // a fresh list isn't an edit
    } catch { if (!t.tours) t.tours = []; }
    if (cur === t) renderTours();
  }
  function toursHtml(t) {
    const full = t.nights - 1, l = t.tours;
    const lead = `<p class="sk-note">${full > 0 ? `<b>${full} full day${full > 1 ? "s" : ""}</b> at the cabin, plus the afternoon you get in.` : "One night: the afternoon you get in and the morning before you ski out."}</p>`;
    if (!l) return `${lead}<p class="tp-wait">Looking for tours near the cabin…</p>`;
    if (!l.length) return `${lead}<p class="sk-note">No mapped tours start near the cabin. Tap the slopes around it on the map for their angle and avalanche terrain, or draw one with Plan a tour.</p>`;
    const pick = linesOf(t).map((x) => x.rid);
    return `${lead}<ul class="tp-list tp-tours">${l.map((x) => `<li><button type="button" data-tour="${esc(x.id)}"><span>${esc(x.name)} <small>${esc(x.label)} · ${x.km.toFixed(1)} km${x.d >= 150 ? ` · starts ${(x.d / 1000).toFixed(1)} km away` : " · from the door"}</small>${x.pill ? `<br>${x.pill}` : ""}</span></button><button type="button" class="tp-star" data-star="${esc(x.id)}" aria-pressed="${pick.includes(x.id)}" aria-label="Plan to do ${esc(x.name)}">${pick.includes(x.id) ? "★" : "☆"}</button></li>`).join("")}</ul>
      <p class="sk-note">Tap one for its slopes and today's avalanche check. ★ the ones you plan to do: they go in your lines for this trip and in your trip plan.</p>`;
  }

  // ---------- your lines for this trip ----------
  // The trip as a folder (alex 2026-11-11): the way in, then every line you want to ski while you're there. A line is
  // kept with its points (rounded, about every 12 m), so it draws, opens and saves offline with no signal. rid: a mapped
  // ski route's id (its card opens from the list); tour: a saved planned tour's id (tf:skiTours).
  const LCOL = "#e8590c";
  const toast = (m) => { if (window.tfToast) window.tfToast(m); };
  const linesOf = (t) => t.lines || [];
  const r5 = (p) => [+(+p[0]).toFixed(5), +(+p[1]).toFixed(5)];
  const thin = (l) => { const out = []; l.forEach((p, i) => { const q = r5(p); if (!out.length || i === l.length - 1 || map.distance(out.at(-1), q) >= 12) out.push(q); }); return out; };
  const lineKm = (ls) => ls.reduce((s, l) => s + l.reduce((a, p, i) => (i ? a + map.distance(l[i - 1], p) : 0), 0), 0) / 1000;
  function tripBounds(t) {
    const pts = [...(t.hut ? [[t.hut.lat, t.hut.lon]] : []), ...(t.way ? t.way.line : []), ...linesOf(t).flatMap((x) => x.ls.flat())];
    return pts.length > 1 ? L.latLngBounds(pts) : null;
  }
  const sameLine = (a, b) => (a.rid ? a.rid === b.rid : a.tour ? a.tour === b.tour : !b.rid && !b.tour && a.name === b.name);
  const tripById = (id) => (cur && cur.id === id ? cur : trips().find((x) => x.id === id));
  function addLine(t, x) {
    const ls = x.ls.map(thin).filter((l) => l.length > 1);
    if (!ls.length) return;
    const y = { id: x.rid || x.tour || "l" + Date.now().toString(36), rid: x.rid || "", tour: x.tour || "", name: String(x.name || "Ski line").slice(0, 80), label: x.label || "", ls, km: +lineKm(ls).toFixed(1), c: x.c ? r5(x.c) : ls[0][0] };
    t.lines = [...linesOf(t).filter((z) => !sameLine(z, y)), y];
    putTrip(t);
    if (cur === t) { renderLines(); renderTours(); drawWay(); }
  }
  function dropLine(t, id) {
    t.lines = linesOf(t).filter((z) => z.id !== id);
    putTrip(t);
    if (cur === t) { renderLines(); renderTours(); drawWay(); }
  }
  // A mapped tour near the cabin, all its same-name pieces (the way the tours list shows it).
  async function routeLines(t, id) {
    try {
      const rs = await S.near([t.hut.lat, t.hut.lon], 3), r = rs.find((x) => x.id === id);
      if (!r) return null;
      const nm = (r.name || "").toLowerCase();
      return (nm ? rs.filter((x) => x.type === r.type && (x.name || "").toLowerCase() === nm) : [r]).flatMap((x) => x.lines);
    } catch { return null; }
  }
  // Trips from before the folder: their ★ tours (t.pick) become lines. Ones that can't load yet stay for next time.
  async function movePicks(t) {
    if (!t.pick || !t.pick.length) return;
    const left = [];
    for (const id of t.pick) {
      const x = (t.tours || []).find((y) => y.id === id);
      if (!x || linesOf(t).some((y) => y.rid === id)) continue;
      const ls = await routeLines(t, id);
      if (ls) addLine(t, { rid: id, name: x.name, label: x.label, ls, c: x.c }); else left.push(id);
    }
    if (left.length) t.pick = left; else delete t.pick;
    putTrip(t, true);
  }
  function linesHtml(t) {
    const l = linesOf(t), w = t.way;
    const way = w ? `<li><button type="button" data-tl="way"><span><i class="tp-sw way"></i>The way in <small>${w.km.toFixed(1)} km · ↑ ${fmtM(w.up)}</small></span></button></li>` : "";
    const rows = l.map((x) => `<li><button type="button" data-tl="${esc(x.id)}"><span><i class="tp-sw"></i>${esc(x.name)} <small>${[x.label, x.km.toFixed(1) + " km"].filter(Boolean).map(esc).join(" · ")}</small></span></button>${x.tour ? `<button type="button" class="tp-rm" data-tledit="${esc(x.tour)}" aria-label="Change ${esc(x.name)}: its points">✎</button>` : ""}<button type="button" class="tp-rm" data-tlrm="${esc(x.id)}" aria-label="Take ${esc(x.name)} off this trip">✕</button></li>`).join("");
    return `${way || rows ? `<ul class="tp-list tp-tours">${way}${rows}</ul>` : ""}
      ${l.length ? "" : `<p class="sk-note">No lines yet. Tap any ski line on the map and then <b>🏕 Add to cabin trip</b>, ${t.hut ? "★ a tour near the cabin below, " : ""}or draw your own.</p>`}
      <div class="tp-btns"><button type="button" data-tp="drawline">✏️ ${t.hut ? "Draw a tour from the cabin" : "Draw a tour"}</button>${l.length ? `<button type="button" data-tp="fitall">🗺 See them all</button>` : ""}${l.length || w ? `<button type="button" data-tp="gpx">⬇ GPX of the whole trip</button>` : ""}</div>`;
  }
  // A saved planned tour as a line (winter.js planLine: the less exposed way when it's on, its saved name and id).
  const planItem = () => { const p = S.planLine && S.planLine(); return p && p.line.length > 1 ? { tour: p.tour, name: p.name, ls: [p.line] } : null; };
  // A ski line's card: the line with its same-name pieces close by (the way its card counts them).
  function routeItem(r) {
    const all = (window.tfSki.routes && window.tfSki.routes()) || [], nm = (r.name || "").toLowerCase(), near = r.bounds && r.bounds.pad ? r.bounds.pad(3) : null;
    const g = nm && near ? all.filter((x) => x.type === r.type && (x.name || "").toLowerCase() === nm && x.bounds && near.intersects(x.bounds)) : [];
    if (!g.includes(r)) g.push(r);
    const h = document.querySelector("#skDetail h3");
    return { rid: r.id, name: (h && h.textContent.trim()) || r.name || "Ski line", ls: g.flatMap((x) => x.lines), c: r.lines[0][0] };
  }
  // "🏕 Add to cabin trip" (only once you have a trip): into the trip that's open, your only trip, or the one you pick.
  function offerAdd(after, getItem) {
    if (!after || !trips().length) return;
    const box = document.createElement("div");
    box.className = "tp-addto";
    after.after(box);
    const draw = (pick) => {
      const x = getItem(), l = trips();
      if (!x) { box.innerHTML = ""; return; }
      if (pick) { box.innerHTML = `<p class="sk-note">Add it to which trip?</p><ul class="tp-list">${pick.map((t) => `<li><button type="button" data-addto="${esc(t.id)}"><span>${esc(hutName(t))}</span><small>${esc(dayWord(t.date))}</small></button></li>`).join("")}</ul>`; return; }
      const inT = l.filter((t) => linesOf(t).some((y) => sameLine(y, x)));
      box.innerHTML = inT.map((t) => `<div class="tp-in"><span>✓ In your trip to <b>${esc(hutName(t))}</b></span><button type="button" data-addrm="${esc(t.id)}">Take off</button></div>`).join("")
        + (inT.length === l.length ? "" : `<button type="button" data-addgo="1">🏕 Add to cabin trip</button>`);
    };
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button"), x = b && getItem();
      if (!x) return;
      e.stopPropagation();
      const into = (id) => { const t = tripById(id); if (!t) return; addLine(t, x); toast(`Added to your trip to ${hutName(t)}.`); draw(); };
      if (b.dataset.addrm) { const t = tripById(b.dataset.addrm), y = t && linesOf(t).find((z) => sameLine(z, x)); if (y) dropLine(t, y.id); draw(); }
      else if (b.dataset.addto) into(b.dataset.addto);
      else if (b.dataset.addgo) {
        const free = trips().filter((t) => !linesOf(t).some((y) => sameLine(y, x)));
        if (cur && !card.hidden && free.some((t) => t.id === cur.id)) into(cur.id); else if (free.length === 1) into(free[0].id); else draw(free);
      }
    });
    draw();
  }
  window.addEventListener("tf:ski-select", (e) => {
    const r = e.detail && e.detail.item, d = $("skDetail");
    if (!r || !d || r.lat != null || r.area || r.src === "trip" || !r.lines || !r.lines.length) return;
    let item = null;
    offerAdd(d.querySelector(".sk-rc-btns"), () => (r.src === "plan" ? planItem() : item || (item = routeItem(r))));
  });
  // A tour drawn from the cabin with Plan a tour (✏️ Draw a tour from the cabin) goes in the trip once it's ✓ Done.
  // While drawing, the trip card steps aside so the tour card (its points: move up, down, delete) is right there at the
  // top (alex 2026-11-11 scrolled down past the trip looking for them); it comes back on ✓ Done with the line in it.
  let drawingLine = null;
  const tuckCard = () => { card.hidden = true; setTimeout(() => { const p = $("skPlan"); if (p && window.tfPanelScrollTo) window.tfPanelScrollTo(p); }, 120); };
  window.addEventListener("tf:ski-plan", (e) => {
    if (e.detail.on || !drawingLine) return;
    const t = drawingLine; drawingLine = null;
    setTimeout(() => {
      const x = planItem();
      if (x) { addLine(t, x); toast(`Added to your trip to ${hutName(t)}.`); }
      if (cur && cur.id === t.id) { card.hidden = false; render(); drawWay(); }
      const p = $("skPlan"); if (p && !p.hidden && window.tfPanelScrollTo) setTimeout(() => window.tfPanelScrollTo(p), 120);
    }, 80);
  });
  card.addEventListener("click", (e) => {
    const a = e.target.closest("[data-tl], [data-tlrm], [data-tledit]");
    if (!a || !cur) return;
    const t = cur;
    if (a.dataset.tlrm) { dropLine(t, a.dataset.tlrm); return; }
    if (a.dataset.tledit) {   // your own tour: back on the map with its points, then ✓ Done puts the new shape in the trip
      if (!(S.editTour && S.editTour(a.dataset.tledit))) { toast("That tour isn't in your saved tours any more. Draw it again with ✏️ Draw a tour."); return; }
      drawingLine = t; tuckCard(); return;
    }
    const toCard = () => setTimeout(() => window.tfPanelScrollTo && $("skDetail") && window.tfPanelScrollTo($("skDetail")), 80);
    if (a.dataset.tl === "way") { if (t.way) { S.select(S.route(t.way.line, `Way in to ${hutName(t)}`, infos.get(t.id) || null)); toCard(); } return; }
    const x = linesOf(t).find((y) => y.id === a.dataset.tl);
    if (!x) return;
    if (x.rid && window.tfSki.show) { window.tfSki.show(x.rid, x.c).then(toCard); return; }
    S.select({ id: "trip", src: "trip", type: "tour", name: x.name, tags: {}, g: x.ls.map((l) => l.flat()), lines: x.ls, bounds: L.latLngBounds(x.ls.flat()) });
    toCard();
  });

  // ---------- packing list ----------
  // Built from the trip: how many nights and people, what the cabin has (heat, water, outhouse, booking, fee), the way
  // in's slopes and the coldest night in the forecast. Ticks stay with the trip (t.packed).
  function packItems(t) {
    const g = (t.hut && t.hut.tags) || {}, w = t.way, n = t.nights, p = t.people;
    const rows = view && view.rows ? view.rows.filter((r) => r.code != null) : [];
    const cold = rows.length ? Math.min(...rows.map((r) => r.lo)) : null;
    const noWater = g.drinking_water !== "yes", noHeat = !g.heating || g.heating === "none";
    const fuel = Math.ceil((p * n * (noWater ? 0.2 : 0.1) + 0.1) * 10) / 10;   // litres of white gas: about 200 ml a person a day melting snow
    const bag = cold == null ? "Sleeping bag" : `Sleeping bag rated to ${Math.min(-5, Math.round(cold) - 5)}°C${noHeat ? " (no heat: inside gets near the outside cold)" : ""}`;
    const G = [
      ["Avalanche and safety", [
        ["beacon", `Avalanche beacon each, fresh batteries${p > 1 ? ` (${p})` : ""}`], ["shovel", "Shovel and probe each"],
        ["sat", "Satellite messenger or PLB (inReach, Zoleo): most cabins have no cell signal"], ["aid", "First aid kit"],
        ["repair", "Repair kit: skin glue/straps, binding parts, pole splint, tape"], ["bivy", "Emergency bivy or tarp"],
        ["lamp", "Headlamp and spare batteries"], ["power", "Phone charged + power bank (cold drains it)"]]],
      ["Skiing", [
        ["skis", "Skis or splitboard, skins, poles"],
        ...(w && (w.steep >= 25 || w.km30 > 0) ? [["crampons", `Ski crampons: the way in gets to ${w.steep}°`]] : []),
        ...(rows.some((r) => r.snow >= 10 || r.gust >= 50) ? [["goggles", "Goggles: snow or strong wind in the forecast"]] : [["goggles", "Goggles and sunglasses"]]),
        ["wax", "Skin wax"]]],
      ["Sleeping", [
        ["bag", bag], ["pad", "Sleeping pad (check if the cabin has mattresses)"], ["booties", "Hut booties or down slippers"], ["plugs", "Earplugs"]]],
      ["Cooking and water", [
        ["stove", `Stove and about ${fuel.toFixed(1)} L of fuel${noWater ? (g.drinking_water === "no" ? ": no water, you melt snow" : ": plan to melt snow") : ""}`],
        ["pot", "Pot, lighter × 2, mug, spoon"], ["bottle", "Water bottles + a thermos"],
        ...(/wood|stove/i.test(g.heating || "") ? [["fire", "Fire starter (check if wood is supplied)"]] : [])]],
      ["Food", [
        ["meals", `${n} breakfast${n > 1 ? "s" : ""}, ${n + 1} lunches and ${n} dinner${n > 1 ? "s" : ""}${p > 1 ? ` for ${p}` : ""}`],
        ["snacks", `Snacks for ${n + 1} days`], ["spare", "One spare day of food, in case you're stuck in by weather"]]],
      ["Clothes", [
        ["layers", "Base layers, puffy jacket, shell jacket and pants"], ["hands", "Spare gloves, warm mitts, toque, buff"], ["socks", `Dry socks for ${n} night${n > 1 ? "s" : ""}`]]],
      ["Cabin", [
        ...(/^(required|only|yes)$/.test(g.reservation || "") ? [["booking", "Booking confirmation"]] : []),
        ...(g.charge || g.fee === "yes" ? [["fee", `Cabin fee${g.charge ? `: ${g.charge}` : ""}`]] : []),
        ...(g.toilets === "no" ? [["wag", "Wag bags: there's no outhouse, pack it out"]] : [["tp", "Toilet paper"]]),
        ["trash", "Garbage bag: pack everything out"]]],
      ["Before you go", [["offline", "Trip saved offline (button below)"], ["plan", "Trip plan left with a friend (below)"]]],
    ];
    return G;
  }
  const packDone = (t) => ({ ...(t.packed || {}), ...(t.offAt ? { offline: 1 } : {}), ...(t.plan && t.plan.sent ? { plan: 1 } : {}) });
  // Your own items, and the ones you never bring, carry over to your next trips (tf:tripPack, on the account when
  // signed in). Own items' keys start with "my_" (their ticks are in t.packed like the others).
  const packTpl = () => { const v = store.get("tripPack", {}); return { own: (v.own || []).map((x) => ({ ...x })), hide: (v.hide || []).slice() }; };
  const tplSet = (f) => { const v = store.get("tripPack", {}); store.set("tripPack", f({ own: v.own || [], hide: v.hide || [] })); };
  function packList(t) {
    const hide = new Set(t.hide || []);
    const G = packItems(t).map(([h, items]) => [h, items.filter((x) => !hide.has(x[0])).map((x) => [x[0], x[1], h])]);
    const own = (t.own || []).map((x) => [x.k, x.label, "Your own items"]);
    const into = (h) => { let g = G.find((y) => y[0] === h); if (!g) { g = [h, []]; const i = G.findIndex((y) => y[0] === "Before you go"); G.splice(i < 0 ? G.length : i, 0, g); } return g; };
    if (own.length) into("Your own items")[1].push(...own);
    // Where you dragged things (☰, alex 2026-11-11): t.pk.sec, an item moved to another section; t.pk.order, the order.
    // Items the trip adds later (crampons once the way in is known) go at the end of their section.
    const pk = t.pk || {}, sec = pk.sec || {}, moved = [];
    G.forEach((g) => { g[1] = g[1].filter((x) => { const to = sec[x[0]]; if (to && to !== g[0]) { moved.push([to, x]); return false; } return true; }); });
    moved.forEach(([to, x]) => into(to)[1].push(x));
    if ((pk.order || []).length) { const at = new Map(pk.order.map((k, i) => [k, i])), o = (x) => (at.has(x[0]) ? at.get(x[0]) : 1e9); G.forEach((g) => g[1].sort((a, b) => o(a) - o(b))); }
    return G.filter((x) => x[1].length);
  }
  function packHtml(t) {
    const G = packList(t), done = packDone(t), auto = { offline: !!t.offAt, plan: !!(t.plan && t.plan.sent) }, all = G.flatMap((x) => x[1]), n = all.filter((x) => done[x[0]]).length;
    // Every row: tick it, ✕ to take it off, hold ☰ and drag it up or down, or into another section (alex 2026-11-11).
    const body = G.map(([h, items]) => `<h5 data-h="${esc(h)}">${esc(h)}</h5>${items.map(([k, label, home]) => `<div class="tp-pkrow" data-k="${esc(k)}" data-home="${esc(home)}" data-sec="${esc(h)}"><label class="tp-check"><input type="checkbox" data-pk="${k}" ${done[k] ? "checked" : ""} ${auto[k] ? "disabled" : ""}> <span>${esc(label)}</span></label>${isGroupGear(k) && names(t).length ? whoSel(t, `data-gear="${k}" class="tp-who${(t.gear || {})[k] ? " set" : ""}"`, (t.gear || {})[k], "Who brings?") : ""}<button type="button" class="tp-pkx" data-pkrm="${esc(k)}" aria-label="Take ${esc(label)} off the list">✕</button>${window.tfGrip || ""}</div>`).join("")}`).join("");
    const pct = all.length ? Math.round((n / all.length) * 100) : 0;
    return `<details class="tp-pack" ${t.packOpen ? "open" : ""}><summary>🎒 Packing list <small>${n} of ${all.length} packed</small></summary>
      <div class="tp-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Packed"><i style="width:${pct}%"></i></div>
      ${n && n === all.length ? `<p class="tp-ready">🎉 Your bag is ready. Have a great trip!</p>` : ""}
      ${names(t).length ? "" : `<p class="sk-note">Add your group's names (👥 Your group) to put a name on shared gear like the stove, so nobody brings two.</p>`}
      ${body}
      <form class="tp-addf" data-pkadd="1"><input type="text" maxlength="80" placeholder="Add an item" autocomplete="off" enterkeyhint="done" aria-label="Add an item to the packing list"><button type="submit">Add</button></form>
      <p class="sk-note">Hold ☰ to drag an item up or down. What you take off (✕) or add stays that way for your next trips too.</p>
      <div class="tp-btns"><button type="button" data-tp="packshare">📤 Send the list to the group</button>${n ? `<button type="button" data-tp="packclear">Untick all</button>` : ""}${(t.hide || []).length ? `<button type="button" data-tp="packback">Put back what you took off</button>` : ""}</div></details>`;
  }

  // ---------- trip plan for a friend, and the late alert ----------
  // What AdventureSmart asks you to leave with someone: who, where, the way in, when you'll be out and when to call
  // for help. It goes out through the share sheet (text, email...). The late alert is a calendar event for the friend
  // that rings at the "call for help" time, with what to do in it: it works with no signal on your side, and no server.
  // On your phone the trip turns red once your out time has passed, until you tap We're out safe.
  const me = () => store.get("tripMe", {});
  const outDay = (t) => addDays(t.date, t.nights);
  const planOf = (t) => {
    const m = me(), pl = t.plan || {};
    return { who: pl.who != null ? pl.who : m.who || "", car: pl.car != null ? pl.car : m.car || "", friend: pl.friend != null ? pl.friend : m.friend || "",
      out: pl.out || `${outDay(t)}T16:00`, help: pl.help || `${outDay(t)}T20:00`, sent: pl.sent || 0, safe: pl.safe || 0 };
  };
  const when = (v) => new Date(v).toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const late = (t) => { const pl = t.plan; return !!(pl && pl.sent && !pl.safe && Date.now() > new Date(pl.out || `${outDay(t)}T16:00`).getTime()); };
  function planText(t) {
    const pl = planOf(t), w = t.way, ll = (a, b) => `${a.toFixed(5)}, ${b.toFixed(5)}`;
    const tours = linesOf(t).map((x) => x.name);
    const hasSat = (t.packed || {}).sat;
    return [`TRIP PLAN: ${hutName(t)} (backcountry ski trip)`,
      `Who: ${pl.who || "me"}${t.people > 1 ? ` (${t.people} people)` : ""}`,
      ...(t.hut ? [`Cabin: ${t.hut.name || hutName(t)}, ${ll(t.hut.lat, t.hut.lon)} https://www.google.com/maps?q=${t.hut.lat.toFixed(5)},${t.hut.lon.toFixed(5)}`] : []),
      `Going in: ${dayWord(t.date)}${w ? `, ${w.from.replace(/^Park /, "parking ")} (${ll(w.line[0][0], w.line[0][1])}), ${w.km.toFixed(1)} km and ${fmtM(w.up)} up, about ${fmtH(w.hIn)}` : ""}`,
      ...(w && w.names && w.names.length ? [`Way in: via ${w.names.join(", ")}`] : []),
      `Nights: ${t.nights}. Back at the car by ${when(pl.out)}`,
      ...(tours.length ? [`Lines we may ski: ${tours.join(", ")}`] : []),
      ...(pl.car ? [`Car: ${pl.car}${w ? " at the parking above" : ""}`] : []),
      `Gear: avalanche beacons, shovels, probes, first aid${hasSat ? ", satellite messenger" : ""}, ${t.nights + 1} days of food + a spare day`,
      ``, `If you haven't heard from us by ${when(pl.help)}: call 911 (or the RCMP) and say we're overdue on a backcountry ski trip. They call Search and Rescue. Read them this plan.`,
      ...(t.hut && t.hut.tags.operator ? [`The cabin is run by ${t.hut.tags.operator}${t.hut.tags.website ? ` (${t.hut.tags.website})` : ""}.`] : []),
    ].join("\n");
  }
  const icsEsc = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  function alertIcs(t) {
    const pl = planOf(t), at = new Date(pl.help), who = pl.who || "your friend";
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trail Finder//Cabin trip//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT", `UID:tf-trip-${t.id}@trail-finder`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(at)}`, `DTEND:${stamp(new Date(at.getTime() + 30 * 60000))}`,
      `SUMMARY:${icsEsc(`Heard from ${who}? (${hutName(t)} trip)`)}`, ...(t.hut ? [`GEO:${t.hut.lat.toFixed(5)};${t.hut.lon.toFixed(5)}`] : []),
      `DESCRIPTION:${icsEsc(`Not heard from ${who} yet? If they haven't told you they're out safe, call 911 and say they're overdue on a backcountry ski trip.\n\n${planText(t)}`)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(`Not heard from ${who}? Call 911`)}`, "TRIGGER:PT0M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].map((l) => (l.match(/.{1,60}/gu) || [""]).join("\r\n ")).join("\r\n");   // folded: 75 bytes a line at most
  }
  function bookIcs(t) {
    const d = (t.book && t.book.remind) || localDate(new Date()), at = new Date(d + "T09:00"), g = (t.hut && t.hut.tags) || {}, site = g["reservation:website"] || g.website || "";
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Trail Finder//Cabin trip//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT", `UID:tf-book-${t.id}@trail-finder`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(at)}`, `DTEND:${stamp(new Date(at.getTime() + 15 * 60000))}`,
      `SUMMARY:${icsEsc(`Book ${hutName(t)} (${dayWord(t.date)}, ${t.nights} night${t.nights > 1 ? "s" : ""})`)}`,
      `DESCRIPTION:${icsEsc(`Book the cabin for ${t.people} people.${site ? `\n${site}` : ""}`)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(`Book ${hutName(t)}`)}`, "TRIGGER:PT0M", "END:VALARM",
      "END:VEVENT", "END:VCALENDAR"].map((l) => (l.match(/.{1,60}/gu) || [""]).join("\r\n ")).join("\r\n");
  }
  async function shareFile(body, name, type, text) {
    const f = new File([body], name, { type });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) {
      try { await navigator.share({ files: [f], title: name, text }); return true; } catch (e) { if (e && e.name === "AbortError") return false; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([body], { type })); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    if (window.tfToast) window.tfToast(text && /^Saved/.test(text) ? text : `Saved ${name}: send it to your friend to open.`);
    return true;
  }
  async function shareText(title, text) {
    try {
      if (navigator.share) { await navigator.share({ title, text }); return true; }
      await navigator.clipboard.writeText(text);
      if (window.tfToast) window.tfToast("Copied: paste it in a message.");
      return true;
    } catch (e) { if (e && e.name === "AbortError") return false; try { prompt("Copy this:", text); } catch {} return true; }
  }
  function planHtml(t) {
    const pl = planOf(t), isLate = late(t);
    const status = pl.safe ? `<p class="sk-note">✅ Out safe ${esc(when(pl.safe))}.</p>`
      : isLate ? `<p class="tp-late">Past your out time (${esc(when(pl.out))}). Out safe? Tell ${esc(pl.friend || "your friend")} now${Date.now() > new Date(pl.help).getTime() ? ": their alert has gone off" : `, before the alert goes off at ${esc(when(pl.help))}`}.</p>`
      : pl.sent ? `<p class="sk-note">Sent ${esc(when(pl.sent))}: their alert goes off at ${esc(when(pl.help))} unless you tell them you're out.</p>` : "";
    return `<details class="tp-plan" ${t.planOpen || isLate ? "open" : ""}><summary>🛟 Trip plan for a friend${isLate ? ` <small class="tp-late-tag">Overdue</small>` : pl.sent ? " <small>sent</small>" : ""}</summary>
      <p class="sk-note">Leave it with someone at home: if you don't check in, they call for help.</p>
      <div class="tp-plan-form">
        <label>Who's going<input type="text" data-pl="who" value="${esc(pl.who)}" placeholder="Your names" autocomplete="off"></label>
        <label>Friend at home<input type="text" data-pl="friend" value="${esc(pl.friend)}" placeholder="Their name" autocomplete="off"></label>
        <label class="wide">Car<input type="text" data-pl="car" value="${esc(pl.car)}" placeholder="Colour, make, plate" autocomplete="off"></label>
        <label class="wide">Out by<input type="datetime-local" data-pl="out" value="${esc(pl.out)}"></label>
        <label class="wide">Call for help at (if no word from you)<input type="datetime-local" data-pl="help" value="${esc(pl.help)}"></label>
      </div>
      ${status}
      <div class="tp-btns"><button type="button" class="go" data-tp="plansend">📤 Send the trip plan</button><button type="button" data-tp="planics">⏰ Late alert for their calendar</button>
        ${window.tfLive ? `<button type="button" data-tp="live">📍 Live location</button>` : ""}${pl.sent && !pl.safe ? `<button type="button" data-tp="safe">✅ We're out safe</button>` : ""}</div>
      <p class="sk-note">The late alert is a calendar event: it rings on their phone at "Call for help at" with what to do. Live location only sends where you have signal.</p><p class="sk-note">Trail Finder doesn't call for help itself: your friend does.</p></details>`;
  }

  // ---------- the trip organizer (alex 2026-11-11: the group, who brings what, meals, booking, costs, journal) ----------
  // The group's names (t.group) are typed once and picked from everywhere else: who brings a shared item, who cooks,
  // who booked, who paid. Nothing here is advice: it's the group's own notes.
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const names = (t) => (t.group || []).map((x) => x.n);
  const whoSel = (t, attr, val, none) => `<select ${attr} aria-label="Who">${[`<option value="">${esc(none || "Who?")}</option>`, ...names(t).map((n) => `<option ${n === val ? "selected" : ""}>${esc(n)}</option>`), ...(val && !names(t).includes(val) ? [`<option selected>${esc(val)}</option>`] : [])].join("")}</select>`;
  const money = (v) => `$${(Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, "")}`;
  // The shared items in the packing list: one for the group, so it gets a name (gear split). Your own items can too.
  const GROUP_GEAR = new Set(["sat", "aid", "repair", "bivy", "stove", "pot", "fire", "booking", "fee", "wag", "tp", "trash"]);
  const isGroupGear = (k) => GROUP_GEAR.has(k) || k.startsWith("my_");

  function groupHtml(t) {
    const sh = t.share, l = t.group || [], my = me().name || "";
    const st = sh ? `<p class="sk-note">${sh.err ? `<b style="color:#c92a2a">Not synced yet</b> (${esc(sh.err)}): your changes go to the group when you have signal.` : `✓ Shared: everyone with the link sees and edits the same trip${sh.at ? `, last synced ${esc(new Date(sh.at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }))}` : ""}${sh.by ? ` (last change by ${esc(sh.by)})` : ""}.`}</p>` : "";
    return `<details class="tp-pack tp-grp" ${t.grpOpen ? "open" : ""}><summary>👥 Your group <small>${sh ? "shared" : l.length ? `${l.length} ${l.length > 1 ? "people" : "person"}` : ""}</small></summary>
      <p class="sk-note">Their names are used for who brings what, who cooks, who booked and who paid.</p>
      <ul class="tp-names">${l.map((x) => `<li>${esc(x.n)}<button type="button" data-grm="${esc(x.k)}" aria-label="Take ${esc(x.n)} off the group">✕</button></li>`).join("")}</ul>
      <form class="tp-addf" data-gadd="1"><input type="text" maxlength="30" placeholder="Add a name" autocomplete="off" enterkeyhint="done" aria-label="Add a name to the group"><button type="submit">Add</button></form>
      <label class="tp-mine">Your name<input type="text" data-me="name" maxlength="30" value="${esc(my)}" placeholder="So the group sees who changed what" autocomplete="off"></label>
      ${st}
      <div class="tp-btns">${sh ? `<button type="button" class="go" data-tp="sharelink">📤 Send the link again</button><button type="button" data-tp="syncnow">↻ Sync now</button>`
        : `<button type="button" class="go" data-tp="share">📤 Share this trip with your group</button>`}</div>
      <p class="sk-note">${sh ? "Anyone with the link can see and change this trip, so only send it to your group. Your ticks in the packing list, the trip plan for a friend and your photos stay on your phone." : "Your group opens the link in Trail Finder and gets the same trip: lines, packing list, who brings what, meals, booking and costs. Everyone can add and delete things. Your ticks, your trip plan for a friend and your photos stay yours."}</p></details>`;
  }

  function bookHtml(t) {
    const b = t.book || {}, g = (t.hut && t.hut.tags) || {}, site = g["reservation:website"] || (/^(required|only|yes)$/.test(g.reservation || "") ? g.website : "");
    return `<details class="tp-pack tp-book" ${t.bookOpen ? "open" : ""}><summary>📅 Booking <small>${b.done ? "booked ✓" : /^(required|only)$/.test(g.reservation || "") ? "needs booking" : ""}</small></summary>
      ${g.reservation ? `<p class="sk-note">${g.reservation === "no" ? "This cabin isn't booked: first come, first served." : /^(required|only)$/.test(g.reservation) ? "This cabin must be booked ahead." : "This cabin can be booked."}${g.charge ? ` Fee: ${esc(g.charge)}.` : ""}</p>` : ""}
      ${site ? `<div class="tp-btns"><a href="${esc(site)}" target="_blank" rel="noopener">🔗 Book on their site</a></div>` : ""}
      <label class="tp-check"><input type="checkbox" data-set="book.done" ${b.done ? "checked" : ""}> <span>Booked</span></label>
      <div class="tp-plan-form">
        <label>Confirmation #<input type="text" data-set="book.conf" maxlength="40" value="${esc(b.conf || "")}" autocomplete="off"></label>
        <label>Paid ($)<input type="number" inputmode="decimal" min="0" step="any" data-set="book.paid" value="${esc(b.paid || "")}"></label>
        <label class="wide">Booked by${whoSel(t, 'data-set="book.by"', b.by, "—")}</label>
        ${b.done ? "" : `<label class="wide">Remind me to book on<input type="date" data-set="book.remind" value="${esc(b.remind || localDate(new Date()))}"></label>`}
      </div>
      ${b.done ? "" : `<div class="tp-btns"><button type="button" data-tp="bookics">⏰ Add the reminder to my calendar</button></div>`}</details>`;
  }

  // Meals: the afternoon you get in (lunch on the way, dinner), the full days, and the morning you ski out.
  const MEALS = [["b", "Breakfast"], ["l", "Lunch"], ["d", "Dinner"]];
  function mealsHtml(t) {
    const m = t.meals || {}, dates = tripDates(t), n = Object.values(m).filter((x) => x && x.what).length;
    return `<details class="tp-pack tp-meals" ${t.mealOpen ? "open" : ""}><summary>🍲 Meals <small>${n ? `${n} planned` : ""}</small></summary>
      ${dates.map((date, i) => `<h5>${esc(dayWord(date))}${i === 0 ? " · going in" : i === dates.length - 1 ? " · out" : ""}</h5>
        ${MEALS.filter(([k]) => !(i === 0 && k === "b") && !(i === dates.length - 1 && k === "d")).map(([k, label]) => { const x = m[`${date}:${k}`] || {}; return `<div class="tp-meal"><span>${label}</span>${whoSel(t, `data-mealwho="${date}:${k}"`, x.who, "Who?")}<textarea rows="1" maxlength="200" data-meal="${date}:${k}" placeholder="What's for ${label.toLowerCase()}?" autocomplete="off" enterkeyhint="done" aria-label="${label} ${esc(dayWord(date))}">${esc(x.what || "")}</textarea></div>`; }).join("")}`).join("")}
      <div class="tp-btns"><button type="button" data-tp="mealshare">📤 Send the meal plan</button></div></details>`;
  }

  // Costs: what each person paid, the share each, and who pays whom to even it out.
  // Who shares a cost (alex 2026-11-11: "maybe it is not all the personne of that trip that is include to all the
  // cost"): x.for, names from the group; none (or none still in the group) means everyone.
  const splitOf = (t, x) => { const who = names(t), f = (x.for || []).filter((w) => who.includes(w)); return f.length ? f : who; };
  function settle(t) {
    const l = t.costs || [], total = l.reduce((s, x) => s + (+x.amt || 0), 0), who = names(t);
    const share = Object.fromEntries(who.map((w) => [w, 0])), bal = Object.fromEntries(who.map((w) => [w, 0]));
    for (const x of l) {
      const a = +x.amt || 0, f = splitOf(t, x);
      f.forEach((w) => { share[w] += a / f.length; bal[w] -= a / f.length; });
      if (x.by && x.by in bal) bal[x.by] += a;
    }
    const v = who.map((w) => share[w]), even = !who.length || v.every((x) => Math.abs(x - v[0]) < 0.005);
    const pos = Object.entries(bal).filter((x) => x[1] > 0.005).sort((a, b) => b[1] - a[1]), neg = Object.entries(bal).filter((x) => x[1] < -0.005).sort((a, b) => a[1] - b[1]), pay = [];
    let i = 0, j = 0;
    while (i < neg.length && j < pos.length) { const m = Math.min(-neg[i][1], pos[j][1]); pay.push([neg[i][0], pos[j][0], m]); neg[i][1] += m; pos[j][1] -= m; if (neg[i][1] > -0.005) i++; if (pos[j][1] < 0.005) j++; }
    return { total, each: who.length ? v[0] : total, even, share, n: Math.max(who.length, 1), pay, noPayer: l.filter((x) => !x.by || !who.includes(x.by)).length };
  }
  // The group's names as buttons to tap in or out of a cost.
  // "All" at the end puts everyone back in at once (alex 2026-11-11: "add all").
  const chips = (t, on, attr, all) => names(t).map((n) => `<button type="button" class="tp-chip" ${attr(n)} aria-pressed="${on.includes(n)}">${esc(n)}</button>`).join("")
    + `<button type="button" class="tp-chip tp-all" ${all} aria-pressed="${on.length >= names(t).length}">All</button>`;
  function costHtml(t) {
    const l = t.costs || [], s = settle(t), g = (t.hut && t.hut.tags) || {};
    return `<details class="tp-pack tp-cost" ${t.costOpen ? "open" : ""}><summary>💵 Costs <small>${l.length ? `${money(s.total)}${s.even ? ` · ${money(s.each)} each` : ""}` : ""}</small></summary>
      ${l.length ? `<ul class="tp-costs">${l.map((x) => { const f = splitOf(t, x), all = f.length === names(t).length; return `<li><span>${esc(x.what)}<small>${x.by ? `paid by ${esc(x.by)}` : "who paid?"}${names(t).length ? ` · ${all ? "split with everyone" : `split with ${esc(f.join(", "))}`}` : ""}</small></span><b>${money(+x.amt || 0)}</b><button type="button" data-crm="${esc(x.id)}" aria-label="Delete ${esc(x.what)}">✕</button>${names(t).length > 1 ? `<div class="tp-split" role="group" aria-label="Who shares ${esc(x.what)}">${chips(t, f, (n) => `data-csplit="${esc(x.id)}" data-n="${esc(n)}"`, `data-callsplit="${esc(x.id)}"`)}</div>` : ""}</li>`; }).join("")}</ul>` : `<p class="sk-note">Add the cabin fee, gas, food and anything else the group shares.${g.charge ? ` The cabin's fee: ${esc(g.charge)}.` : ""}</p>`}
      <form class="tp-costadd" data-cadd="1"><input type="text" maxlength="40" placeholder="What (gas, food…)" autocomplete="off" aria-label="What it was for"><input type="number" inputmode="decimal" min="0" step="any" placeholder="$" aria-label="Amount">${whoSel(t, "", "", "Paid by")}<button type="submit">Add</button>${names(t).length > 1 ? `<div class="tp-split" role="group" aria-label="Split between"><small>Split between</small>${chips(t, names(t), (n) => `data-fsplit="${esc(n)}"`, "data-fall=\"1\"")}</div>` : ""}</form>
      ${l.length ? `<p class="tp-sum">${s.even ? `<b>${money(s.total)}</b> in all, <b>${money(s.each)}</b> each for ${s.n} ${s.n > 1 ? "people" : "person"}${names(t).length ? "" : " (add names in Your group to split it)"}.` : `<b>${money(s.total)}</b> in all. Each one's share: ${names(t).map((w) => `${esc(w)} <b>${money(s.share[w])}</b>`).join(" · ")}`}</p>
        ${s.pay.length ? `<ul class="tp-pay">${s.pay.map(([a, b, v]) => `<li>${esc(a)} pays ${esc(b)} <b>${money(v)}</b></li>`).join("")}</ul>` : ""}
        ${s.noPayer ? `<p class="sk-note">${s.noPayer} cost${s.noPayer > 1 ? "s have" : " has"} no one from the group as the payer: they're in the total but not in who pays whom.</p>` : ""}` : ""}</details>`;
  }

  // Journal: notes (shared with the group) and photos (on this phone only), for after you come out.
  function journalHtml(t) {
    const l = (t.notes || []).slice().sort((a, b) => b.at - a.at);
    return `<details class="tp-pack tp-jour" ${t.jourOpen ? "open" : ""}><summary>📓 Trip journal <small>${l.length ? `${l.length} note${l.length > 1 ? "s" : ""}` : ""}</small></summary>
      <p class="sk-note">How the snow was, what you skied, what to bring next time.</p>
      <form class="tp-note" data-nadd="1"><textarea maxlength="1000" rows="3" placeholder="Write a note" aria-label="Write a note"></textarea><button type="submit">Add the note</button></form>
      ${l.map((x) => `<div class="tp-notei"><small>${esc(new Date(x.at).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}${x.by ? ` · ${esc(x.by)}` : ""}<button type="button" data-nrm="${esc(x.id)}" aria-label="Delete this note">✕</button></small><p>${esc(x.text)}</p></div>`).join("")}
      <h5>Photos</h5><div class="tp-photos" id="tpPhotos"></div>
      <label class="tp-photoadd">📷 Add photos<input type="file" accept="image/*" multiple data-photo="1" hidden></label>
      <p class="sk-note">Photos stay on this phone.</p></details>`;
  }
  // Photos in IndexedDB (tf-trip-journal), made smaller (1600 px, JPEG) so a phone holds many trips.
  const PDB = () => new Promise((ok, no) => { const r = indexedDB.open("tf-trip-journal", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos", { keyPath: "id" }).createIndex("trip", "trip"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const ptx = async (mode, f) => { const db = await PDB(); return new Promise((ok, no) => { const tx = db.transaction("photos", mode), r = f(tx.objectStore("photos")); tx.oncomplete = () => ok(r && r.result); tx.onerror = () => no(tx.error); }); };
  async function shrink(file) {
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return file;
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((ok) => c.toBlob((b) => ok(b || file), "image/jpeg", 0.82));
  }
  const tripKey = (t) => (t.share ? "s:" + t.share.id : t.id);
  const urls = [];
  async function renderPhotos() {
    const el = $("tpPhotos"), t = cur;
    if (!el || !t) return;
    let l = [];
    try { l = await ptx("readonly", (s) => s.index("trip").getAll(tripKey(t))); } catch {}
    if (cur !== t) return;
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    el.innerHTML = l.sort((a, b) => a.at - b.at).map((p) => { const u = URL.createObjectURL(p.blob); urls.push(u); return `<figure><a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Trip photo" loading="lazy"></a><button type="button" data-prm="${esc(p.id)}" aria-label="Delete this photo">✕</button></figure>`; }).join("");
  }

  // GPX of the whole trip: the cabin, the way in and every line, for a watch or another app.
  function tripGpx(t) {
    const x = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
    const trk = (name, ls) => `<trk><name>${x(name)}</name>${ls.map((l) => `<trkseg>${l.map((p) => `<trkpt lat="${p[0]}" lon="${p[1]}"/>`).join("")}</trkseg>`).join("")}</trk>`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Trail Finder" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${x(hutName(t))} cabin trip</name></metadata>`
      + (t.hut ? `<wpt lat="${t.hut.lat}" lon="${t.hut.lon}"><name>${x(t.hut.name || hutName(t))}</name></wpt>` : "")
      + (t.way ? trk(`Way in to ${hutName(t)}`, [t.way.line]) : "") + linesOf(t).map((l) => trk(l.name, l.ls)).join("") + `</gpx>`;
  }

  // ---------- sharing the trip with the group ----------
  // The trip goes to the app's database (supabase/shared-trips.sql) under a random id, with a random key that only the
  // link carries (the database keeps an md5 of it): anyone with the link reads and changes it, nobody else can. Each
  // phone keeps its copy (works with no signal) and the copy it last synced (share.base): a sync merges the group's
  // changes with yours item by item (an added line or item, a deleted one, a meal typed), so two people editing at once
  // both keep their changes. Ticks, the trip plan for a friend, offline saves and photos stay on each phone.
  const SHARED = ["hut", "name", "date", "nights", "people", "way", "lines", "own", "hide", "pk", "gear", "meals", "book", "costs", "notes", "group"];
  const docOf = (t) => JSON.parse(JSON.stringify(Object.fromEntries(SHARED.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]))));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const keyed = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && (x.id || x.k));
  // Three-way merge: what changed on this phone since the last sync wins over what didn't; lists of items merge by id.
  function merge3(b, m, r) {
    if (same(m, b)) return r;
    if (same(r, b) || same(m, r)) return m;
    if ((isObj(m) || m === undefined) && (isObj(r) || r === undefined) && (isObj(m) || isObj(r))) {
      const out = {}, bb = isObj(b) ? b : {};
      for (const k of new Set([...Object.keys(m || {}), ...Object.keys(r || {}), ...Object.keys(bb)])) { const v = merge3(bb[k], (m || {})[k], (r || {})[k]); if (v !== undefined) out[k] = v; }
      return out;
    }
    if ((keyed(m) || (Array.isArray(m) && !m.length)) && (keyed(r) || (Array.isArray(r) && !r.length)) && (keyed(b) || !b || (Array.isArray(b) && !b.length))) {
      const id = (x) => x.id || x.k, map = (a) => Object.fromEntries((a || []).map((x) => [id(x), x]));
      const o = merge3(map(b), map(m), map(r)), order = [...(r || []).map(id), ...(m || []).map(id)];
      return [...new Set(order)].filter((k) => k in o).map((k) => o[k]);
    }
    return m;
  }
  async function rpc(fn, args) {
    const A = window.tfAccount;
    if (!A || !A.enabled) throw new Error("sharing isn't available in this copy of the app");
    if (!navigator.onLine) throw new Error("no signal");
    await A.load();
    if (!A.client) throw new Error("couldn't reach the app's database");
    const { data, error } = await A.client.rpc(fn, args);
    if (error) throw new Error(/function .* does not exist|Could not find the function/i.test(error.message) ? "shared trips aren't switched on yet" : error.message);
    return data;
  }
  const appBase = () => (location.protocol === "https:" ? location.origin + location.pathname : "https://trailfinderapp.ca/");
  const tripLink = (t) => `${appBase()}#trip=${t.share.id}.${t.share.key}`;
  function applyDoc(t, d) { for (const k of SHARED) { if (d[k] === undefined) delete t[k]; else t[k] = d[k]; } }
  let syncing = null, pushTimer = 0;
  async function syncTrip(id, quiet) {
    if (syncing) return syncing.then(() => syncTrip(id, quiet));
    syncing = (async () => {
      const t = tripById(id);
      if (!t || !t.share) return;
      const sh = t.share, wayBefore = JSON.stringify(t.way || null);
      let changed = false;
      try {
        for (let n = 0; n < 4; n++) {
          const r = await rpc("trip_get", { p_id: sh.id, p_key: sh.key });
          if (!r) { sh.err = "the trip was deleted"; break; }
          const mine = docOf(t), merged = merge3(sh.base || {}, mine, r.data || {});
          if (!same(merged, mine)) { applyDoc(t, merged); changed = true; }
          Object.assign(sh, { rev: r.rev, base: r.data, by: r.by || "" });
          if (same(merged, r.data)) { sh.err = ""; sh.at = Date.now(); break; }
          const w = await rpc("trip_put", { p_id: sh.id, p_key: sh.key, p_data: merged, p_rev: r.rev, p_by: me().name || "" });
          if (w && w.ok) { Object.assign(sh, { rev: w.rev, base: merged, err: "", at: Date.now(), by: me().name || "" }); break; }
        }
      } catch (e) { sh.err = e.message || "no signal"; if (!quiet) toast(`Couldn't sync the trip: ${sh.err}.`); }
      putTrip(t, true);
      if (cur && cur.id === t.id) {
        if (cur !== t) Object.assign(cur, t);
        if (!changed) renderOrg("tpGroup", groupHtml, true);   // only the "last synced" line
        else if (typing()) needRender = true;   // never redraw under someone's fingers: once they leave the box
        else { render(); renderPhotos(); }
        if (changed) { drawWay(); if (JSON.stringify(cur.way || null) !== wayBefore) loadDays(cur); }
      }
    })().finally(() => { syncing = null; });
    return syncing;
  }
  const pushSoon = (t) => { if (!t.share) return; clearTimeout(pushTimer); const id = t.id; pushTimer = setTimeout(() => syncTrip(id, true), 1200); };
  async function shareTrip(t) {
    if (!t.share) {
      const key = crypto.randomUUID ? crypto.randomUUID() : uid("k"), doc = docOf(t);
      try {
        const id = await rpc("trip_new", { p_key: key, p_data: doc, p_by: me().name || "" });
        t.share = { id, key, rev: 1, base: doc, at: Date.now(), by: me().name || "", err: "" };
        putTrip(t, true);
        if (cur === t) render();
      } catch (e) { toast(`Couldn't share the trip: ${e.message || e}.`); return; }
    }
    const text = `${hutName(t)} cabin trip, ${dayWord(t.date)}, ${t.nights} night${t.nights > 1 ? "s" : ""}. Open it in Trail Finder to see the lines and add to the packing list, meals and costs:`;
    try {
      if (navigator.share) await navigator.share({ title: `${hutName(t)} cabin trip`, text, url: tripLink(t) });
      else { await navigator.clipboard.writeText(`${text}\n${tripLink(t)}`); toast("Link copied: paste it in your group's chat."); }
    } catch (e) { if (!e || e.name !== "AbortError") { try { prompt("Copy this link for your group:", tripLink(t)); } catch {} } }
  }
  // Opening a group's link (#trip=id.key, from ski-points.js): the trip on this phone, kept in sync from then on.
  async function join(id, key) {
    const have = trips().find((x) => x.share && x.share.id === id);
    if (have) { start(have); syncTrip(have.id, true); return; }
    try {
      const r = await rpc("trip_get", { p_id: id, p_key: key });
      if (!r || !r.data || !r.data.date) { toast("This shared trip doesn't exist any more."); return; }
      const t = { id: uid(""), at: Date.now(), ...r.data, share: { id, key, rev: r.rev, base: r.data, at: Date.now(), by: r.by || "", err: "" } };
      putTrip(t, true);
      start(t);
      toast(`You joined the ${hutName(t)} cabin trip.`);
    } catch (e) { toast(`Couldn't open the shared trip: ${e.message || e}.`); }
  }
  setInterval(() => { if (cur && cur.share && !card.hidden && document.visibilityState === "visible") syncTrip(cur.id, true); }, 30000);
  document.addEventListener("visibilitychange", () => { if (cur && cur.share && document.visibilityState === "visible") syncTrip(cur.id, true); });
  window.addEventListener("online", () => { if (cur && cur.share) syncTrip(cur.id, true); });

  // ---------- the organizer's inputs and buttons ----------
  const setPath = (t, path, v) => { const [a, b] = path.split("."); if (b) { t[a] = { ...(t[a] || {}) }; if (v === "" || v === false) delete t[a][b]; else t[a][b] = v; } else t[a] = v; };
  card.addEventListener("change", (e) => {
    const el = e.target, t = cur;
    if (!t) return;
    if (el.dataset.set) {
      setPath(t, el.dataset.set, el.type === "checkbox" ? (el.checked ? 1 : false) : el.type === "number" ? (el.value === "" ? "" : Math.max(0, +el.value)) : el.value.trim());
      putTrip(t); if (el.dataset.set === "book.done") renderOrg("tpBook", bookHtml); if (el.dataset.set === "name") { render(); if (!t.hut) nearCabins(); } return;
    }
    if (el.dataset.meal || el.dataset.mealwho) {
      const k = el.dataset.meal || el.dataset.mealwho, f = el.dataset.meal ? "what" : "who", m = { ...(t.meals || {}) }, x = { ...(m[k] || {}) };
      if (el.value.trim()) x[f] = el.value.trim(); else delete x[f];
      if (Object.keys(x).length) m[k] = x; else delete m[k];
      t.meals = m; putTrip(t); return;
    }
    if (el.dataset.gear) {
      t.gear = { ...(t.gear || {}) };
      if (el.value) t.gear[el.dataset.gear] = el.value; else delete t.gear[el.dataset.gear];
      putTrip(t); return;
    }
    if (el.dataset.me) { store.set("tripMe", { ...me(), [el.dataset.me]: el.value.trim().slice(0, 30) }); return; }
    if (el.dataset.photo && el.files && el.files.length) {
      const files = [...el.files]; el.value = "";
      (async () => { for (const f of files) { const blob = await shrink(f); await ptx("readwrite", (s) => s.put({ id: uid("p"), trip: tripKey(t), at: Date.now(), blob })).catch(() => toast("Couldn't keep the photo: the phone may be full.")); } renderPhotos(); })();
    }
  });
  card.addEventListener("submit", (e) => {
    const f = e.target, t = cur;
    if (!t || !(f.dataset.gadd || f.dataset.cadd || f.dataset.nadd)) return;
    e.preventDefault();
    if (f.dataset.gadd) {
      const n = f.querySelector("input").value.trim().replace(/\s+/g, " ").slice(0, 30);
      if (!n) return;
      if (names(t).some((x) => x.toLowerCase() === n.toLowerCase())) { toast("That name is in the group already."); return; }
      t.group = [...(t.group || []), { k: uid("g"), n }];
      if (t.group.length > t.people) t.people = t.group.length;
      putTrip(t); render(); const i = card.querySelector("[data-gadd] input"); if (i) i.focus(); return;
    }
    if (f.dataset.cadd) {
      const [w, a] = f.querySelectorAll("input"), by = f.querySelector("select").value, amt = parseFloat(a.value);
      if (!w.value.trim() || !(amt > 0)) { toast("Add what it was for and how much."); return; }
      const on = [...f.querySelectorAll("[data-fsplit][aria-pressed=true]")].map((b) => b.dataset.fsplit);
      t.costs = [...(t.costs || []), { id: uid("c"), what: w.value.trim().slice(0, 40), amt: Math.round(amt * 100) / 100, by, ...(on.length && on.length < names(t).length ? { for: on } : {}) }];
      putTrip(t); renderOrg("tpCost", costHtml); return;
    }
    const text = f.querySelector("textarea").value.trim().slice(0, 1000);
    if (!text) return;
    t.notes = [...(t.notes || []), { id: uid("n"), at: Date.now(), by: me().name || "", text }];
    putTrip(t); renderOrg("tpJour", journalHtml); renderPhotos();
  });
  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-grm], [data-crm], [data-nrm], [data-prm], [data-csplit], [data-fsplit], [data-callsplit], [data-fall]"), t = cur;
    if (!b || !t) return;
    if (b.dataset.fall) { b.closest(".tp-split").querySelectorAll(".tp-chip").forEach((c) => c.setAttribute("aria-pressed", "true")); return; }
    if (b.dataset.callsplit) { t.costs = (t.costs || []).map((y) => { if (y.id !== b.dataset.callsplit) return y; const z = { ...y }; delete z.for; return z; }); putTrip(t); renderOrg("tpCost", costHtml); return; }
    if (b.dataset.fsplit) {   // the new cost's split: at least one person stays in
      const f = b.closest(".tp-split"), on = b.getAttribute("aria-pressed") === "true";
      if (on && f.querySelectorAll("[data-fsplit][aria-pressed=true]").length < 2) { toast("At least one person shares it."); return; }
      b.setAttribute("aria-pressed", String(!on));
      const al = f.querySelector(".tp-all"); if (al) al.setAttribute("aria-pressed", String(!f.querySelector("[data-fsplit][aria-pressed=false]")));
      return;
    }
    if (b.dataset.csplit) {   // a cost already in: tap a name in or out
      const x = (t.costs || []).find((y) => y.id === b.dataset.csplit); if (!x) return;
      const f = splitOf(t, x), n = b.dataset.n, nf = f.includes(n) ? f.filter((w) => w !== n) : [...f, n];
      if (!nf.length) { toast("At least one person shares it."); return; }
      t.costs = t.costs.map((y) => { if (y.id !== x.id) return y; const z = { ...y }; if (nf.length >= names(t).length) delete z.for; else z.for = names(t).filter((w) => nf.includes(w)); return z; });
      putTrip(t); renderOrg("tpCost", costHtml); return;
    }
    if (b.dataset.grm) { t.group = (t.group || []).filter((x) => x.k !== b.dataset.grm); putTrip(t); render(); }
    else if (b.dataset.crm) { t.costs = (t.costs || []).filter((x) => x.id !== b.dataset.crm); putTrip(t); renderOrg("tpCost", costHtml); }
    else if (b.dataset.nrm) { if (!confirm("Delete this note?")) return; t.notes = (t.notes || []).filter((x) => x.id !== b.dataset.nrm); putTrip(t); renderOrg("tpJour", journalHtml); renderPhotos(); }
    else if (b.dataset.prm) { if (!confirm("Delete this photo?")) return; ptx("readwrite", (s) => s.delete(b.dataset.prm)).then(renderPhotos, renderPhotos); }
  });
  card.addEventListener("toggle", (e) => {
    if (!cur) return;
    const c = e.target.classList, f = c.contains("tp-grp") ? "grpOpen" : c.contains("tp-book") ? "bookOpen" : c.contains("tp-meals") ? "mealOpen" : c.contains("tp-cost") ? "costOpen" : c.contains("tp-jour") ? "jourOpen" : "";
    if (f) cur[f] = e.target.open;
    if (f === "jourOpen" && e.target.open) renderPhotos();
  }, true);
  // Meal boxes grow with their text (field-sizing where the browser has it, this everywhere else). Enter is done.
  const grow = (el) => { if (!el.offsetParent) return; el.style.height = "auto"; el.style.height = el.scrollHeight + 2 + "px"; };
  const growAll = () => card.querySelectorAll(".tp-meal textarea").forEach(grow);
  card.addEventListener("input", (e) => { if (e.target.matches(".tp-meal textarea")) grow(e.target); });
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches(".tp-meal textarea")) { e.preventDefault(); e.target.blur(); } });
  card.addEventListener("toggle", (e) => { if (e.target.open && e.target.classList.contains("tp-meals")) growAll(); }, true);
  new MutationObserver(() => requestAnimationFrame(growAll)).observe(card, { childList: true, subtree: true });
  function renderOrg(id, f, notTyping) { const el = $(id); if (el && cur && !(notTyping && el.contains(document.activeElement))) el.innerHTML = f(cur); }
  let needRender = false;
  const typing = () => { const a = document.activeElement; return !!(a && card.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
  card.addEventListener("focusout", () => setTimeout(() => { if (needRender && cur && !typing()) { needRender = false; render(); renderPhotos(); } }, 150));

  // ---------- drawing the card ----------
  function factsHtml(t) {
    const g = t.hut.tags || {}, out = [];
    const beds = parseInt(g.capacity, 10);
    if (beds) out.push(`<span class="${t.people > beds ? "warn" : ""}">🛏 Sleeps ${beds}${t.people > beds ? `: you're ${t.people}` : ""}</span>`);
    if (g.charge) out.push(`<span>💲 ${esc(g.charge)}</span>`); else if (g.fee === "yes") out.push(`<span>💲 Fee</span>`); else if (g.fee === "no") out.push(`<span>Free</span>`);
    if (/^(required|only)$/.test(g.reservation)) out.push(`<span class="warn">📅 Booking needed</span>`);
    else if (g.reservation === "yes" || g.reservation === "recommended") out.push(`<span>📅 Booking possible</span>`);
    else if (g.reservation === "no") out.push(`<span>First come, first served</span>`);
    const book = g["reservation:website"] || g["reservation:url"];
    if (book) out.push(`<a href="${esc(book)}" target="_blank" rel="noopener">📅 Book it</a>`);
    if (g.website && g.website !== book) out.push(`<a href="${esc(g.website)}" target="_blank" rel="noopener">ℹ Hut page</a>`);
    if (g.heating) out.push(`<span>🔥 ${esc(g.heating === "none" ? "No heat" : g.heating)}</span>`);
    if (g.drinking_water) out.push(`<span>💧 ${g.drinking_water === "no" ? "No water: melt snow" : esc(g.drinking_water === "yes" ? "Water" : g.drinking_water)}</span>`);
    if (g.toilets) out.push(`<span>${g.toilets === "no" ? "No outhouse" : "🚻 Outhouse"}</span>`);
    return `${out.length ? `<div class="tp-facts">${out.join("")}</div>` : ""}
      ${g.operator ? `<p class="sk-note">Run by ${esc(g.operator)}${book || /^(required|only|yes)$/.test(g.reservation || "") ? "" : ". Check with them before you go: some cabins need booking or a permit."}</p>` : !out.length ? `<p class="sk-note">${esc(S.HUT_ABOUT[t.hut.kind] || S.HUT_ABOUT.basic_hut)} Check who runs it and if it needs booking before you go.</p>` : ""}
      ${g.description ? `<p class="sk-note">${esc(g.description)}</p>` : ""}`;
  }
  // The hut's closure notice (data/huts.json "winter:closure", with "winter:closure:website" for the notices) at the
  // top of the way in, and its winter access (how the club and guides say to get in) under it.
  function closedHtml(t) {
    const g = t.hut.tags || {}, c = g["winter:closure"], u = g["winter:closure:website"];
    return c ? `<p class="tp-closed">⚠️ <b>Closures:</b> ${esc(c)}${u ? ` <a href="${esc(u)}" target="_blank" rel="noopener">Check the notices</a>` : ""}</p>` : "";
  }
  function winterHtml(t) {
    const a = t.hut.tags["winter:access"];
    return a ? `<p class="tp-winter"><b>Winter access</b>${esc(a.replace(/^Winter: /, ""))}</p>` : "";
  }
  function wayHtml(t) {
    return closedHtml(t) + wayBody(t);
  }
  function wayBody(t) {
    const w = t.way;
    if (t.wayWait) return `<p class="tp-wait">${esc(t.wayWait)}</p>${winterHtml(t)}`;
    if (!w) {
      const msg = { noroad: "No parking lot or road within 9 km that the map knows of: the way in must start further away (by snowmobile, lift or a long ski).", water: "The cabin sits on the water on the map.", net: "Couldn't get the map data for the way in. Check your connection and try again." }[t.wayFail] || "";
      return `<p class="sk-note">${esc(msg)}</p>${winterHtml(t)}<div class="tp-btns"><button type="button" data-tp="draw">✎ Draw the way in</button>${t.wayFail === "net" ? `<button type="button" data-tp="again">↻ Try again</button>` : ""}</div>`;
    }
    const C = T.CLASSES[w.cls], a = w.line[0];
    const ios = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && "ontouchend" in document;
    const drive = ios ? `https://maps.apple.com/?daddr=${a[0]},${a[1]}&dirflg=d` : `https://www.google.com/maps/dir/?api=1&destination=${a[0]},${a[1]}&travelmode=driving`;
    return `<p><b>${esc(w.from)}</b>${w.names && w.names.length ? ` <span class="sk-note">· via ${esc(w.names.join(", "))}</span>` : ""}</p>
      <div class="tp-stats"><span><b>${w.km.toFixed(1)}</b> km</span><span>↗ ${fmtM(w.up)}</span><span>↘ ${fmtM(w.down)}</span><span title="Munter estimate: 4 km or 400 m of climb an hour up, 10 km or 1000 m an hour down">⏱ ${fmtH(w.hIn)} in · ${fmtH(w.hOut)} out</span></div>
      <div class="tp-stats"><span>${fmtM(w.park)} at the car → ${fmtM(w.hut)} at the cabin</span><span>steepest ${w.steep}°</span></div>
      <p><span class="sk-ates" style="--c:${C.color}">${C.label}</span> <span class="sk-note">avalanche terrain, estimated: ${esc((w.why || []).join("; "))}</span></p>
      ${w.offM >= 50 ? `<p class="sk-note">${fmtM(w.offM)} of it isn't on a mapped trail or road: it follows the terrain.</p>` : ""}
      ${w.unplowed >= 200 ? `<p class="sk-note"><b>${(w.unplowed / 1000).toFixed(1)} km of it is on gravel or logging roads</b>: not plowed in winter, so you ski it (counted in the km, climb and time).</p>` : ""}
      ${w.winter && w.winter.length ? `<p class="sk-note">✓ Starts at the winter parking and follows the mapped winter route (${esc(w.winter.join(", "))}).</p>`
        : w.known ? `<p class="sk-note">✓ Starts at the winter parking from the winter access below.</p>` : ""}
      ${winterHtml(t)}
      ${w.src === "auto" && !w.known ? `<p class="sk-note">Starts at the closest paved road (usually plowed): the map can't tell if it's plowed today or if parking there is allowed.</p>` : ""}
      <div class="tp-btns"><button type="button" class="go" data-tp="show">Show the way in + conditions</button><a href="${drive}" target="_blank" rel="noopener">🚗 Drive</a><button type="button" data-tp="draw">✎ Draw my own</button></div>`;
  }
  function daysHtml() {
    const t = cur, v = view;
    if (!v) return `<p class="tp-wait">Loading the forecast for your dates…</p>`;
    if (!v.rows) return `<p class="sk-note">Couldn't load the forecast (${esc(v.err)}).</p>`;
    const today = localDate(new Date());
    const rows = v.rows.map((r) => {
      const DG = r.r ? S.DANGER[r.r] : null, L1 = r.l != null ? T.LIGHTS[r.l] : null;
      const band = r.band ? (S.BANDS.find((b) => b[0] === r.band) || ["", ""])[1].toLowerCase() : "";
      const av = DG ? `<span><b style="color:${DG.color === "#fff300" ? "#b08800" : DG.color}">⚠ ${esc(DG.label.replace(/^\d /, ""))}</b> ${band ? `in the ${band}` : ""}${L1 ? ` · <span class="sk-rc-word" style="--c:${L1.color}">● ${esc(L1.label)}</span>` : ""}</span>`
        : `<span class="sk-note">Avalanche: ${r.date < today ? "past" : r.avNone === "not forecast yet" ? "not forecast yet (about 3 days ahead)" : esc(r.avNone)}</span>`;
      const wx = r.code != null ? `<span class="tp-wx"><big>${S.WICON[r.code] || ""} ${deg(r.hi)}</big><br>low ${deg(r.lo)}</span>` : `<span class="tp-wx sk-note">${r.date > v.end ? "Too far<br>ahead" : "–"}</span>`;
      const bits = r.code != null ? [r.snow >= 0.5 ? `❄ ${Math.round(r.snow)} cm` : r.rain >= 1 ? `🌧 ${Math.round(r.rain)} mm rain` : "Dry",
        `💨 ${Math.round(r.wind || 0)} km/h ${S.COMPASS[Math.round((r.dir || 0) / 45) % 8]}${r.gust >= 50 ? `, gusts ${Math.round(r.gust)}` : ""}`] : [];
      return `<li style="--c:${DG ? DG.color : "var(--line)"}"><b>${esc(dayWord(r.date))}${r.tag ? ` · ${r.tag === "in" ? "ski in" : "ski out"}` : ""}</b>${wx}${av}${bits.length ? `<small>${bits.join(" · ")}</small>` : ""}</li>`;
    }).join("");
    const b = v.before;
    const far = v.rows.some((r) => r.code == null && r.date > v.end);
    return `${b ? `<p class="sk-note">Before you go in (${b.n} days): ${b.snow >= 0.5 ? `<b>${Math.round(b.snow)} cm of new snow</b>` : "no new snow"}, wind up to ${Math.round(b.wind)} km/h.${b.snow >= 30 || b.wind >= 40 ? " Fresh slabs likely on the way in." : ""}</p>` : ""}
      <ul class="tp-days">${rows}</ul>
      <p class="sk-note">${v.old ? `<b>Saved forecast from ${esc(when(v.at))}</b> (no signal now). ` : v.at ? `Checked ${esc(when(v.at))}${t.autoAt && Math.abs(t.autoAt - v.at) < 60000 ? " (updated by itself)" : ""}. ` : ""}Weather at the cabin (${fmtM(v.ele)}), Open-Meteo${far ? `, about a week ahead: come back from ${esc(dayWord(addDays(t.date, -7)))} for the first day` : ""}. Avalanche danger on the way in, from Avalanche Canada${v.example ? " (example forecast)" : ""}${t.way ? ", with the Avaluator light for its terrain" : ""}. Check avalanche.ca the morning you go.</p>`;
  }
  function render() {
    const t = cur;
    if (!t) return;
    card.innerHTML = `<div><button type="button" class="sk-x" aria-label="Close">✕</button><h3>🏕 ${esc(hutName(t))} <small>cabin trip</small></h3></div>
      <label class="tp-mine">Trip name<input type="text" data-set="name" maxlength="40" value="${esc(t.name || "")}" placeholder="${esc(t.hut ? t.hut.name || "Cabin trip" : "Like: Spearhead hut trip")}" autocomplete="off"></label>
      <div class="tp-form">
        <label>Go in<input type="date" data-tp="date" value="${esc(t.date)}"></label>
        <label>Nights<span class="tp-step"><button type="button" data-tp="n-" aria-label="One night less">−</button><b>${t.nights}</b><button type="button" data-tp="n+" aria-label="One night more">+</button></span></label>
        <label>People<span class="tp-step"><button type="button" data-tp="p-" aria-label="One person less">−</button><b>${t.people}</b><button type="button" data-tp="p+" aria-label="One person more">+</button></span></label>
      </div>
      <p class="sk-note">${esc(dayWord(t.date))} to ${esc(dayWord(addDays(t.date, t.nights)))}${countdown(t)}</p>
      ${t.hut ? factsHtml(t) : `<div class="sk-sec tp-nohut" id="tpCabin"><h4>The cabin</h4><p class="sk-note">No cabin yet: everything else works without one. Tap a cabin (the brown dots) on the map and then <b>🏕 Use this cabin for ${esc(hutName(t))}</b>, or pick one near the middle of the map:</p><ul class="tp-list" id="tpNear"><li><p class="tp-wait">Finding cabins…</p></li></ul></div>`}
      <div class="sk-sec" id="tpGroup">${groupHtml(t)}</div>
      ${t.hut ? `<div class="sk-sec tp-way" id="tpWay"><h4>The way in</h4>${wayHtml(t)}</div>
      <div class="sk-sec" id="tpDays"><h4>Each day</h4>${daysHtml()}</div>` : ""}
      <div class="sk-sec tp-lines" id="tpLines"><h4>Your lines for this trip</h4>${linesHtml(t)}</div>
      ${t.hut ? `<div class="sk-sec" id="tpTours"><h4>Day tours from the cabin</h4>${toursHtml(t)}</div>` : ""}
      <div class="sk-sec" id="tpPack">${packHtml(t)}</div>
      <div class="sk-sec" id="tpMeals">${mealsHtml(t)}</div>
      <div class="sk-sec" id="tpBook">${bookHtml(t)}</div>
      <div class="sk-sec" id="tpCost">${costHtml(t)}</div>
      <div class="sk-sec" id="tpPlan">${planHtml(t)}</div>
      <div class="sk-sec" id="tpJour">${journalHtml(t)}</div>
      <div class="sk-sec"><div class="tp-btns"><button type="button" data-tp="off" ${offPts(t).length ? "" : "disabled"}>⤓ ${offSaved(t) ? "Change the saved area" : "Save the trip offline"}</button>${t.hut ? `<button type="button" data-tp="hut">Cabin details</button>` : ""}<button type="button" data-tp="del">🗑 Delete</button></div>
        <p class="sk-note" id="tpOff">${offHtml(t)}</p>
        ${t.hut && localDate(new Date()) < t.date ? `<div class="tp-btns"><button type="button" data-tp="beforeics">⏰ Remind me the day before</button></div><p class="sk-note">From the day before the trip, each time you open the app with signal, the trip's weather, avalanche danger and offline copy update by themselves. The app can't do it while it's closed: the reminder is a calendar alert the evening before that tells you to open it.</p>` : ""}</div>`;
  }
  // Where the trip's offline save is, from Offline maps itself (offline.js status, PR #544): saving, saved, or not
  // finished with files missing (alex saw "Saved offline" with 2 files missing). Missing files retry on their own.
  const offName = (t) => `Cabin trip: ${(t.hut && t.hut.name) || hutName(t)}`;   // the cabin's name: renaming the trip keeps its offline save
  const day = (ms) => esc(new Date(ms).toLocaleDateString("en-CA", { month: "short", day: "numeric" }));
  // What the save starts around: the way in, the cabin and every line of the trip (a trip with no cabin yet: its lines).
  const offPts = (t) => [...(t.way ? t.way.line : []), ...(t.hut ? [[t.hut.lat, t.hut.lon]] : []), ...linesOf(t).flatMap((x) => x.ls.flat())];
  const offSt = (t) => (window.tfOffline && window.tfOffline.status ? window.tfOffline.status(offName(t)) : null);
  const offSaved = (t) => { const st = offSt(t); return !!(st && st.state !== "saving"); };
  // Lines, the way in or the cabin added after the save that go past the saved square.
  const offOut = (t, b) => !!b && offPts(t).some(([la, lo]) => la < b[0] || lo < b[1] || la > b[2] || lo > b[3]);
  function offHtml(t) {
    const st = offSt(t);
    const what = "the map, ski routes, slopes and avalanche forecast in the square you pick (it starts around the cabin, the way in and your lines)";
    if (st && st.state !== "saving" && offOut(t, st.box)) return `<b style="color:#c92a2a">Some of your trip is outside the saved area</b> (a line or the way in added since). Tap Change the saved area to take it in.`;
    if (st && st.state === "saving") return `<b>Saving offline… ${Math.round(st.pct || 0)}%</b> Keep the app open until it's done.`;
    if (st && st.state === "missing") return `<b style="color:#c92a2a">Not finished: ${st.missing} file${st.missing === 1 ? "" : "s"} still missing.</b> They download again by themselves when you have signal; don't count on this trip offline until it says Saved.`;
    if (st && st.state === "saved") return `<b>Saved offline ${day(st.at || t.offAt)}</b>: the map, ski routes, slopes and avalanche forecast in the square you picked work with no signal${t.offFresh ? `; avalanche, ski and snow files updated ${esc(when(t.offFresh))}` : ""}; the forecast above is kept as it was when last checked. The trip stays on this phone.`;
    if (t.offAt && window.tfOffline && window.tfOffline.status) return `Not saved offline any more (it was deleted from Offline maps). Save it again for no signal.`;
    return `Saves ${what}, and keeps this forecast, for no signal. The trip stays on this phone.`;
  }
  window.addEventListener("tf:offline", (e) => {
    const d = e.detail || {};
    // The save started (not just the square opened): the trip counts as saved offline from here (✓ in the packing list).
    if (d.state === "saving") { const t = trips().find((x) => offName(x) === d.name); if (t && !t.offAt) { t.offAt = Date.now(); putTrip(t); if (cur && cur.id === t.id) cur.offAt = t.offAt; } }
    if (cur && d.name === offName(cur)) { const el = $("tpOff"); if (el) el.innerHTML = offHtml(cur); const b = card.querySelector('[data-tp="off"]'); if (b) b.textContent = `⤓ ${offSaved(cur) ? "Change the saved area" : "Save the trip offline"}`; }
  });
  const renderWay = () => { const el = $("tpWay"); if (el && cur) el.innerHTML = `<h4>The way in</h4>${wayHtml(cur)}`; renderLines(); };
  const renderDays = () => { const el = $("tpDays"); if (el && cur) el.innerHTML = `<h4>Each day</h4>${daysHtml()}`; renderPack(); };
  const renderLines = () => { const el = $("tpLines"); if (el && cur) el.innerHTML = `<h4>Your lines for this trip</h4>${linesHtml(cur)}`; };
  const renderTours = () => { const el = $("tpTours"); if (el && cur) el.innerHTML = `<h4>Day tours from the cabin</h4>${toursHtml(cur)}`; };
  const renderPack = () => { const el = $("tpPack"); if (el && cur) el.innerHTML = packHtml(cur); };
  const renderPlan = () => { const el = $("tpPlan"); if (el && cur) el.innerHTML = planHtml(cur); };
  card.addEventListener("toggle", (e) => {   // keep the packing list / trip plan open across redraws
    if (!cur) return;
    if (e.target.classList.contains("tp-pack")) cur.packOpen = e.target.open;
    else if (e.target.classList.contains("tp-plan")) cur.planOpen = e.target.open;
  }, true);

  // ☰ on a packing list item: drag it up or down, or into another section (alex 2026-11-11).
  if (window.tfDragSort) window.tfDragSort(card, { list: ".tp-pack", row: ".tp-pkrow", head: "h5", done: (rows) => {
    const t = cur; if (!t) return;
    const order = [], sec = {};
    rows.forEach((r) => {
      order.push(r.dataset.k);
      let p = r.previousElementSibling; while (p && !p.matches("h5")) p = p.previousElementSibling;
      const h = p && p.dataset.h; if (h && h !== r.dataset.home) sec[r.dataset.k] = h;
    });
    t.pk = { order, sec }; putTrip(t); renderPack();
  } });
  card.addEventListener("click", (e) => {   // ✕ on a packing list item
    const b = e.target.closest("[data-pkrm]");
    if (!b || !cur) return;
    const t = cur, k = b.dataset.pkrm;
    if (k.startsWith("my_")) {
      const x = (t.own || []).find((y) => y.k === k), lab = x ? x.label.toLowerCase() : "";
      t.own = (t.own || []).filter((y) => y.k !== k);
      tplSet((v) => ({ ...v, own: v.own.filter((y) => y.label.toLowerCase() !== lab) }));
    } else {
      t.hide = [...new Set([...(t.hide || []), k])];
      tplSet((v) => ({ ...v, hide: [...new Set([...v.hide, k])] }));
    }
    putTrip(t); renderPack();
    toast("Taken off. It stays off your next trips too.");
  });
  card.addEventListener("submit", (e) => {   // + Add an item: on this trip and the next ones
    if (!e.target.dataset.pkadd || !cur) return;
    e.preventDefault();
    const t = cur, label = e.target.querySelector("input").value.trim().replace(/\s+/g, " ").slice(0, 80), lab = label.toLowerCase();
    if (!label) return;
    if ((t.own || []).some((y) => y.label.toLowerCase() === lab)) { toast("It's on the list already."); return; }
    const x = { k: "my_" + Date.now().toString(36), label };
    t.own = [...(t.own || []), x];
    tplSet((v) => ({ ...v, own: v.own.some((y) => y.label.toLowerCase() === lab) ? v.own : [...v.own, x] }));
    putTrip(t); renderPack();
    const i = card.querySelector("[data-pkadd] input"); if (i) i.focus();   // ready for the next one
  });
  card.addEventListener("change", (e) => {
    if (!cur) return;
    const el = e.target;
    if (el.dataset.pk) {
      cur.packed = { ...(cur.packed || {}) };
      if (el.checked) cur.packed[el.dataset.pk] = 1; else delete cur.packed[el.dataset.pk];
      putTrip(cur); renderPack(); return;
    }
    if (el.dataset.pl) {
      const k = el.dataset.pl;
      cur.plan = { ...(cur.plan || {}), [k]: el.value.trim() };
      if (k === "out" && el.value && !(cur.plan.helpSet)) { const d = new Date(el.value); d.setHours(d.getHours() + 4); cur.plan.help = `${localDate(d)}T${d.toTimeString().slice(0, 5)}`; }
      if (k === "help") cur.plan.helpSet = 1;
      if (/^(who|car|friend)$/.test(k)) store.set("tripMe", { ...me(), [k]: el.value.trim() });   // the next trip starts with them
      putTrip(cur); if (k === "out" || k === "help") renderPlan(); return;
    }
    if (el.dataset.tp !== "date" || !el.value) return;
    cur.date = e.target.value; putTrip(cur); render(); loadDays(cur);
  });
  card.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tp], .sk-x");
    if (!b || !cur) return;
    const t = cur, k = b.dataset.tp;
    if (b.classList.contains("sk-x")) { close(); return; }
    if (k === "n-" || k === "n+") { t.nights = Math.max(1, Math.min(10, t.nights + (k === "n+" ? 1 : -1))); putTrip(t); render(); loadDays(t); }
    else if (k === "p-" || k === "p+") { t.people = Math.max(1, Math.min(40, t.people + (k === "p+" ? 1 : -1))); putTrip(t); render(); }
    else if (k === "again") { t.wayFail = ""; findWay(t); }
    else if (k === "packshare") {
      const done = packDone(t), left = packList(t).map(([h, items]) => [h, items.filter((x) => !done[x[0]] && !/^(offline|plan)$/.test(x[0]))]).filter((x) => x[1].length);
      const gr = t.gear || {};
      shareText(`Packing for ${hutName(t)}`, `Packing for ${hutName(t)}, ${dayWord(t.date)}, ${t.nights} night${t.nights > 1 ? "s" : ""}:\n` + left.map(([h, items]) => `\n${h}\n${items.map((x) => `- ${x[1]}${gr[x[0]] ? ` (${gr[x[0]]})` : ""}`).join("\n")}`).join("\n"));
    } else if (k === "packclear") { t.packed = {}; putTrip(t); renderPack(); }
    else if (k === "share" || k === "sharelink") shareTrip(t);
    else if (k === "syncnow") syncTrip(t.id);
    else if (k === "gpx") shareFile(tripGpx(t), `${hutName(t).replace(/[^\w]+/g, "-").toLowerCase()}-trip.gpx`, "application/gpx+xml", `Saved the GPX of your ${hutName(t)} trip.`);
    else if (k === "beforeics") shareFile(dayBeforeIcs(t), `before-${hutName(t).replace(/[^\w]+/g, "-").toLowerCase()}.ics`, "text/calendar", `Saved the reminder: open it to add it to your calendar.`);
    else if (k === "bookics") shareFile(bookIcs(t), `book-${hutName(t).replace(/[^\w]+/g, "-").toLowerCase()}.ics`, "text/calendar", `Saved the reminder: open it to add it to your calendar.`);
    else if (k === "mealshare") {
      const m = t.meals || {}, rows = tripDates(t).map((d) => [d, MEALS.map(([mk, lab]) => [lab, m[`${d}:${mk}`]]).filter((x) => x[1] && (x[1].what || x[1].who))]).filter((x) => x[1].length);
      if (!rows.length) { toast("No meals typed in yet."); return; }
      shareText(`Meals for ${hutName(t)}`, `Meals for ${hutName(t)}:\n` + rows.map(([d, l]) => `\n${dayWord(d)}\n${l.map(([lab, x]) => `- ${lab}: ${x.what || "?"}${x.who ? ` (${x.who})` : ""}`).join("\n")}`).join("\n"));
    }
    else if (k === "packback") { t.hide = []; tplSet((v) => ({ ...v, hide: [] })); putTrip(t); renderPack(); }
    else if (k === "fitall") { const b = tripBounds(t); if (b) map.fitBounds(b, { padding: [30, 30], maxZoom: 15 }); if (window.tfSnapTo) window.tfSnapTo("peek"); }
    else if (k === "drawline") {
      if (S.planPts().length > 1 && !confirm("Start a new tour from the cabin? The tour on the map now stays in Saved tours.")) return;
      drawingLine = t;
      S.plan(t.hut ? [[t.hut.lat, t.hut.lon]] : []);
      tuckCard();
      toast(t.hut ? "Tap the map along your tour from the cabin, then ✓ Done. It goes in this trip." : "Tap the map along your tour, then ✓ Done. It goes in this trip.");
    }
    else if (k === "plansend" || k === "planics") {
      const pl = planOf(t);
      if (new Date(pl.help) <= new Date(pl.out)) { if (window.tfToast) window.tfToast("Call for help at must be after your out time."); return; }
      const go = k === "plansend" ? shareText(`Trip plan: ${hutName(t)}`, planText(t))
        : shareFile(alertIcs(t), `trip-alert-${hutName(t).replace(/[^\w]+/g, "-").toLowerCase()}.ics`, "text/calendar", `Add this to your calendar: it rings at ${when(pl.help)} if you haven't heard from ${pl.who || "me"}.`);
      go.then((ok) => { if (!ok) return; t.plan = { ...(t.plan || {}), who: pl.who, car: pl.car, friend: pl.friend, out: pl.out, help: pl.help, sent: t.plan && t.plan.sent || Date.now(), safe: 0 }; putTrip(t); renderPlan(); renderPack(); });
    } else if (k === "safe") {
      const pl = planOf(t);
      shareText("Out safe", `${pl.who || "We"}: out safe from ${hutName(t)}, back at the car ${when(Date.now())}. You can delete the late alert.`)
        .then((ok) => { if (!ok) return; t.plan = { ...(t.plan || {}), safe: Date.now() }; putTrip(t); renderPlan(); });
    } else if (k === "live" && window.tfLive) window.tfLive.open();
    else if (k === "show" && t.way) {
      const r = S.route(t.way.line, `Way in to ${hutName(t)}`, infos.get(t.id) || null);
      S.select(r);
      setTimeout(() => { if (window.tfPanelScrollTo && $("skDetail")) window.tfPanelScrollTo($("skDetail")); }, 80);
    } else if (k === "draw") {
      const had = S.planPts();
      if (had.length > 2 && !confirm("Replace your planned tour with the way in to this cabin?")) return;
      drawing = t;
      S.plan(t.way ? [t.way.line[0]] : []);
      if (window.tfToast) window.tfToast("Tap from where you park up to the cabin, then ✓ Done.");
    } else if (k === "hut") {
      S.loadSki().then((ski) => { const h = (ski?.huts || []).find((x) => x.id === t.hut.id) || t.hut; S.selectHut(h); setTimeout(() => window.tfPanelScrollTo && window.tfPanelScrollTo($("skDetail")), 80); });
    } else if (k === "del") {
      if (!confirm(t.share ? `Take the ${hutName(t)} trip off your phone? The rest of the group keeps it.` : `Delete your trip to ${hutName(t)}?`)) return;
      if (window.tfAccount && window.tfAccount.gone) window.tfAccount.gone("skiTrips", t.id);   // so the account doesn't bring it back
      store.set("skiTrips", trips().filter((x) => x.id !== t.id)); close();
    } else if (k === "off") {
      // The square to save opens on the map, around the trip, to move and resize before saving (alex 2026-11-11).
      if (!window.tfOffline || !window.tfOffline.pickBox) { if (window.tfToast) window.tfToast("Offline maps aren't available in this browser."); return; }
      const ll = offPts(t); if (!ll.length) return;
      const st = offSt(t), b0 = [Math.min(...ll.map((p) => p[0])), Math.min(...ll.map((p) => p[1])), Math.max(...ll.map((p) => p[0])), Math.max(...ll.map((p) => p[1]))];
      const box = st && st.box && !offOut(t, st.box) ? st.box : b0;   // changing it: start from the square saved, if the trip still fits in it
      window.tfOffline.pickBox(box, offName(t), { replace: true, exact: box !== b0 });
    }
  });

  // The trips list (the 🏕 Cabin trip button): your trips, and the cabins near the middle of the map to start one.
  async function showList(quiet) {
    close();
    card.hidden = false; btn.setAttribute("aria-pressed", "true");
    const mine = trips();
    card.innerHTML = `<div><button type="button" class="sk-x" aria-label="Close">✕</button><h3>🏕 Cabin trips</h3></div>
      <button type="button" class="sk-tripgo" data-newtrip="1">＋ Start a new trip</button>
      ${window.tfTutorials ? window.tfTutorials.button("cabin-trip") : ""}
      ${mine.length ? `<ul class="tp-list">${mine.map((t) => `<li><button type="button" data-trip="${esc(t.id)}"><span>${esc(hutName(t))}${t.share ? " 👥" : ""}</span><small>${late(t) ? `<b class="tp-late-tag">Overdue</b> ` : ""}${esc(dayWord(t.date))} · ${t.nights} night${t.nights > 1 ? "s" : ""}${(t.lines || []).length ? ` · ${t.lines.length} line${t.lines.length > 1 ? "s" : ""}` : ""}</small></button></li>`).join("")}</ul>` : ""}
      <p class="sk-note">Or start from a cabin: tap one (the brown dots) on the map, then <b>🏕 Plan a cabin trip here</b>, or pick one near you:</p>
      <ul class="tp-list" id="tpNear"><li><p class="tp-wait">Finding cabins…</p></li></ul>`;
    if (!quiet) scrollTo();
    nearCabins();
  }
  // The named cabins nearest the middle of the map (the trips list, and a trip with no cabin yet).
  async function nearCabins() {
    const c = map.getCenter(), ski = await S.loadSki();
    const near = (ski?.huts || []).filter((h) => h.kind !== "shelter" && h.name).map((h) => ({ h, d: map.distance(c, [h.lat, h.lon]) })).sort((a, b) => a.d - b.d).slice(0, 6);
    const el = $("tpNear");
    if (!el) return;
    el.innerHTML = near.length ? near.map(({ h, d }) => `<li><button type="button" data-hut="${esc(h.id)}"><span>${esc(h.name)}</span><small>${d < 9500 ? (d / 1000).toFixed(1) : Math.round(d / 1000)} km</small></button></li>`).join("")
      : `<li class="sk-note">No cabins on the map near here.</li>`;
  }
  card.addEventListener("click", (e) => {
    const a = e.target.closest("[data-tour], [data-star]");
    if (!a || !cur) return;
    const t = cur, id = a.dataset.tour || a.dataset.star, x = (t.tours || []).find((y) => y.id === id);
    if (a.dataset.star) {
      if (linesOf(t).some((y) => y.rid === id)) { dropLine(t, id); return; }
      if (!x) return;
      routeLines(t, id).then((ls) => { if (ls) addLine(t, { rid: id, name: x.name, label: x.label, ls, c: x.c }); else if (window.tfToast) window.tfToast("Couldn't load that tour's line. Try again with signal."); });
      return;
    }
    if (x && window.tfSki.show) window.tfSki.show(x.id, x.c).then(() => setTimeout(() => window.tfPanelScrollTo && $("skDetail") && window.tfPanelScrollTo($("skDetail")), 80));
  });
  card.addEventListener("click", (e) => {
    const n = e.target.closest("[data-newtrip]");
    if (n) { const t = newTrip(); start(t); setTimeout(() => { const i = card.querySelector('[data-set="name"]'); if (i) i.focus(); }, 300); return; }
    const a = e.target.closest("[data-trip], [data-hut]");
    if (!a) return;
    if (a.dataset.trip) { const t = trips().find((x) => x.id === a.dataset.trip); if (t) start(t); return; }
    S.loadSki().then((ski) => { const h = (ski?.huts || []).find((x) => x.id === a.dataset.hut); if (h) open(h); });
  });
  card.addEventListener("click", (e) => { if (!cur && e.target.closest(".sk-x")) close(); });
  btn.addEventListener("click", () => { if (btn.getAttribute("aria-pressed") === "true") close(); else showList(); });

  // "🏕 Plan a cabin trip here" on a cabin's details (not shelters you can't sleep in, parking or route starts).
  window.addEventListener("tf:ski-select", (e) => {
    const h = e.detail && e.detail.item, d = $("skDetail");
    if (!h || !d || h.lat == null || h.src === "c2c" || /^(parking|trailhead|shelter)$/.test(h.kind || "")) return;
    const row = document.createElement("button");
    const pick = cur && !cur.hut && !card.hidden;   // a trip with no cabin yet is open: this cabin goes in it
    row.type = "button"; row.className = "sk-tripgo"; row.textContent = pick ? `🏕 Use this cabin for ${hutName(cur)}` : "🏕 Plan a cabin trip here";
    row.addEventListener("click", () => { if (pick && cur && !cur.hut) setHut(cur, h); else open(h); });
    const head = d.firstElementChild;
    if (head) head.after(row); else d.prepend(row);
  });
  window.addEventListener("tf:sport", () => { if (!isSki()) close(); });
  { const o = trips().find(late); if (o && window.tfToast) setTimeout(() => window.tfToast(`Past your out time from ${hutName(o)}: open 🏕 Cabin trip and tap We're out safe.`), 2500); }
  // Trips from the rider's other devices (account.js): the list shows them, and an open trip changed or deleted there follows.
  window.addEventListener("tf:settings-synced", (e) => {
    if (!e.detail.includes("skiTrips") || card.hidden) return;
    if (!cur) { showList(true); return; }
    const t = trips().find((x) => x.id === cur.id);
    if (!t) close();
    else if ((t.ed || 0) > (cur.ed || 0)) { cur = t; view = null; render(); drawWay(); loadDays(t); }
  });
  // Signing in reloads the page once to show the account's settings: the trip you were planning opens again, with
  // everything you'd done (trips are saved as you go, and the account keeps both this phone's and its own trips).
  { let o = null; try { o = sessionStorage.getItem("tf:tripOpen"); } catch {}
    const t = o && trips().find((x) => x.id === o);
    if (t && isSki()) setTimeout(() => { if (!cur && isSki()) start(t); }, 1500); }
  window.tfCabinTrip = { open, list: showList, close, count: () => trips().length, join: (id, key) => join(id, key), addPlan: (el) => offerAdd(el, planItem) };
})();
