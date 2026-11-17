// The trip planner every sport shares (alex 2026-11-16: "i want to make the same kind of trip planner for all the other
// sport too", then picked "one shared trip planner, with a part made for each sport", Hiking first).
// This file is the part that's the same for any trip; each sport plugs in its own "kit" (cabin-trip.js for Skiing,
// hike-trip.js for Hiking) with what only that sport has: the place the trip is centred on, what each day shows, its
// own packing list, its own sections and its own words. A sport calls window.tfTripEngine(make), where make(E) gets
// this engine's helpers and returns the kit (see "the kit" below).
// What every trip has, from the Skiing cabin trip (2026-10-30 to 2026-11-16):
//  - The trip itself: a name, the first day, nights and people, a countdown; it can start with no place picked.
//  - Your lines for this trip: lines kept with their points, drawn together on the map, GPX of the whole trip.
//  - Packing list: built by the sport's kit, your own items and the ones you never bring carried to the next trips,
//    Who brings? on shared items, Who brings what, hold ☰ to drag, ticks per phone.
//  - Your group, Who are you?, sharing with the group by link (supabase/shared-trips.sql; everyone sees and edits the
//    same trip, merged item by item), a new link to stop someone opening it.
//  - Meals for each day, Booking (with a reminder for the calendar), Costs and who pays whom, the journal with notes
//    (shared) and photos (this phone only).
//  - Tell someone your plan: the plan as text and a late alert for a friend's calendar; overdue in red.
//  - Each day: the kit's forecast for the trip's dates, kept with the trip for no signal, and updated by itself each
//    time the app opens from the day before the trip; Save the trip offline (offline.js), with a calendar reminder.
// Nothing in here is advice: the facts each kit shows come with their source, and the rest is the group's own notes.
window.tfTripEngine = function tfTripEngine(make) {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return null;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("tf:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) {   // "tf:setting" tells account.js to save the trips to the account
      try { const s = JSON.stringify(v); if (localStorage.getItem("tf:" + k) === s) return; localStorage.setItem("tf:" + k, s); window.dispatchEvent(new Event("tf:setting")); } catch {}
    },
  };
  const localDate = (d) => d.toLocaleDateString("en-CA");
  const addDays = (date, n) => { const d = new Date(date + "T12:00"); d.setDate(d.getDate() + n); return localDate(d); };
  const dayWord = (date) => new Date(date + "T12:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
  const fmtM = (m) => Math.round(m).toLocaleString() + " m";
  const fmtH = (h) => (h < 0.75 ? `${Math.max(15, Math.round((h * 60) / 15) * 15)} min` : `${Math.round(h * 2) / 2} h`);
  const deg = (v) => (v == null ? "–" : `${Math.round(v) === 0 ? 0 : Math.round(v)}°`);
  const when = (v) => new Date(v).toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const toast = (m) => { if (window.tfToast) window.tfToast(m); };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  // "2 nights", or "day trip" for a trip with no night (Fishing allows 0 nights: K.minNights).
  const nightsW = (t) => (t.nights ? `${t.nights} night${t.nights > 1 ? "s" : ""}` : "day trip");

  // ---------- the look (once for every sport: each pane sets its own --tp colour) ----------
  if (!window.tfTripCss) {
    window.tfTripCss = 1;
    const P = ":is(#skiPane, #hikePane, #fishPane, #huntPane, #motoPane, #results, .plan-bar)";   // #results: MTB's bike trip card and trail card; .plan-bar: Plan a route
    const css = document.createElement("style");
    css.textContent = `
${P} .tp-card { border: 1.5px solid var(--tp); background: color-mix(in srgb, var(--tp) 5%, var(--panel)); }
${P} .tp-card h3 { display: flex; gap: 6px; align-items: baseline; }
${P} .tp-card h3 small { font-weight: 600; color: var(--muted); font-size: .78rem; }
${P} .tp-form { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 6px; }
${P} .tp-form label { display: flex; flex-direction: column; gap: 2px; font-size: .7rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); min-width: 0; }
${P} .tp-form input { font: inherit; font-size: .9rem; padding: 7px 6px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); min-width: 0; width: 100%; box-sizing: border-box; }
${P} .tp-step { display: flex; align-items: center; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); overflow: hidden; }
${P} .tp-step button { font: inherit; font-size: 1rem; font-weight: 800; border: 0; background: none; color: var(--fg); width: 30px; height: 34px; cursor: pointer; flex: none; }
${P} .tp-step b { flex: 1; text-align: center; font-size: .95rem; color: var(--fg); text-transform: none; letter-spacing: 0; }
${P} .tp-facts { display: flex; flex-wrap: wrap; gap: 4px; }
${P} .tp-facts span, ${P} .tp-facts a { font-size: .76rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: var(--chip); color: var(--fg); text-decoration: none; border: 1px solid var(--line); }
${P} .tp-facts a { color: #1f5fe0; }
${P} .tp-facts .warn { background: color-mix(in srgb, #f08c00 18%, var(--panel)); border-color: #f08c00; }
${P} .tp-way { display: flex; flex-direction: column; gap: 4px; }
${P} .tp-stats { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: .86rem; }
${P} .tp-stats b { font-size: 1rem; }
${P} .tp-days { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
${P} .tp-days li { border: 1px solid var(--line); border-left: 6px solid var(--c, var(--line)); border-radius: 10px; padding: 6px 9px; display: grid; grid-template-columns: 1fr auto; gap: 1px 8px; font-size: .8rem; background: var(--panel); }
${P} .tp-days li > b { font-size: .88rem; }
${P} .tp-days li > .tp-wx { grid-row: span 2; text-align: right; font-size: .8rem; line-height: 1.35; }
${P} .tp-days li > .tp-wx big { font-size: 1.05rem; font-weight: 800; }
${P} .tp-days li > span { color: var(--fg); }
${P} .tp-days li > small { grid-column: 1 / -1; color: var(--muted); }
${P} .tp-btns { display: flex; flex-wrap: wrap; gap: 6px; }
${P} .tp-btns > * { font: inherit; font-size: .84rem; font-weight: 800; padding: 9px 12px; border-radius: 11px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; }
${P} .tp-btns .go { background: var(--tp); border-color: var(--tp); color: #fff; flex: 1; justify-content: center; }
${P} .tp-closed { margin: 0 0 8px; padding: 8px 10px; border-radius: 10px; border: 1.5px solid #e03131; background: color-mix(in srgb, #e03131 10%, var(--panel)); font-size: .8rem; line-height: 1.35; }
${P} .tp-closed a { color: #1f5fe0; font-weight: 700; }
${P} .tp-winter { margin: 6px 0 0; padding: 8px 10px; border-radius: 10px; background: var(--chip); border: 1px solid var(--line); font-size: .8rem; line-height: 1.35; }
${P} .tp-winter b { display: block; font-size: .74rem; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); margin-bottom: 2px; }
${P} .tp-wait { display: flex; align-items: center; gap: 8px; font-size: .84rem; color: var(--muted); margin: 0; }
${P} .tp-wait::before { content: ""; width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--tp); border-right-color: transparent; animation: tpspin .8s linear infinite; flex: none; }
@keyframes tpspin { to { transform: rotate(360deg); } }
${P} .tp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
${P} .tp-list button { font: inherit; width: 100%; text-align: left; display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--fg); cursor: pointer; font-size: .85rem; }
${P} .tp-list button small { color: var(--muted); white-space: nowrap; }
${P} .sk-tripgo { font: inherit; font-size: .9rem; font-weight: 800; padding: 10px; border-radius: 11px; border: 0; background: var(--tp); color: #fff; cursor: pointer; }
${P} .tp-tours li { display: flex; gap: 4px; }
${P} .tp-tours li > button:first-child { flex: 1; }
${P} .tp-tours small { color: var(--muted); white-space: normal; }
${P} .tp-tours .tp-day { flex: none; width: 88px; align-self: center; font-size: 16px; padding: 6px 4px; }
${P} .tp-list .tp-star { flex: none; width: 48px; justify-content: center; align-items: center; font-size: 1.3rem; color: #f08c00; }
${P} details.tp-pack > summary, ${P} details.tp-plan > summary { font-size: .92rem; font-weight: 800; padding: 4px 0; }
${P} details summary small { font-weight: 600; color: var(--muted); margin-left: 4px; }
${P} .tp-pack h5 { margin: 8px 0 2px; font-size: .74rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
${P} .tp-check { display: flex; gap: 8px; align-items: flex-start; padding: 5px 0; font-size: .86rem; line-height: 1.3; cursor: pointer; }
${P} .tp-check input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: var(--tp); }
${P} .tp-pkrow .tp-check input:checked + span { color: var(--muted); text-decoration: line-through; }   /* packed, not "Booked" */
${P} .tp-pack .tp-btns, ${P} .tp-plan .tp-btns { margin-top: 8px; }
${P} .tp-plan > p, ${P} .tp-plan-form { margin: 6px 0; }
${P} .tp-plan-form { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
${P} .tp-plan-form .wide { grid-column: 1 / -1; }
${P} .tp-plan-form label { display: flex; flex-direction: column; gap: 2px; font-size: .7rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); min-width: 0; }
${P} .tp-plan-form input { font: inherit; font-size: 16px; padding: 7px 6px; border: 1px solid var(--line); border-radius: 9px; background: var(--bg); color: var(--fg); min-width: 0; width: 100%; box-sizing: border-box; }
${P} .tp-plan .tp-btns > * { flex: 1 1 40%; justify-content: center; text-align: center; }
${P} .tp-late { color: #c92a2a; font-weight: 700; }
${P} .tp-late-tag { color: #fff !important; background: #c92a2a; border-radius: 6px; padding: 1px 6px; font-weight: 800; }
${P} .tp-lines .tp-sw { display: inline-block; width: 16px; height: 4px; border-radius: 2px; background: var(--tpl, #e8590c); vertical-align: middle; margin-right: 6px; box-shadow: 0 0 0 1.5px #fff, 0 0 0 2.5px var(--line); }
${P} .tp-lines .tp-sw.way { background: var(--tp); }
${P} .tp-list .tp-rm { flex: none; width: 44px; justify-content: center; align-items: center; font-size: 1rem; color: var(--muted); }
${P} .tp-addf { display: flex; gap: 6px; margin-top: 8px; }
${P} .tp-addf input { flex: 1; font: inherit; font-size: 16px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); min-width: 0; }
${P} .tp-addf .tp-who { flex: none; width: 92px; font: inherit; font-size: 16px; padding: 6px 4px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--muted); min-width: 0; }
${P} .tp-addf .tp-who.set { color: var(--fg); font-weight: 700; border-color: var(--tp); }
${P} .tp-addf button { font: inherit; font-size: .86rem; font-weight: 800; padding: 8px 14px; border-radius: 10px; border: 0; background: var(--tp); color: #fff; cursor: pointer; }
${P} .tp-addto { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
${P} .tp-addto > button, ${P} .tp-addto li button { font: inherit; font-size: .86rem; font-weight: 800; padding: 10px; border-radius: 11px; border: 1.5px solid var(--tp); background: color-mix(in srgb, var(--tp) 7%, var(--panel)); color: var(--fg); cursor: pointer; width: 100%; }
${P} .tp-addto .tp-in { display: flex; align-items: center; gap: 8px; font-size: .84rem; padding: 8px 10px; border-radius: 11px; background: color-mix(in srgb, var(--tp) 10%, var(--panel)); }
${P} .tp-addto .tp-in span { flex: 1; }
${P} .tp-addto .tp-in button { font: inherit; font-size: .8rem; font-weight: 700; border: 1px solid var(--line); background: var(--panel); color: var(--fg); border-radius: 9px; padding: 6px 10px; cursor: pointer; }
${P} .tp-names { list-style: none; margin: 6px 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
${P} .tp-names li { display: inline-flex; align-items: center; gap: 2px; padding: 2px 2px 2px 12px; border-radius: 999px; background: color-mix(in srgb, var(--tp) 14%, var(--panel)); font-weight: 700; font-size: .86rem; }
${P} .tp-names button { font: inherit; border: 0; background: none; color: var(--muted); width: 32px; height: 32px; cursor: pointer; }
${P} .tp-mine { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; font-size: .7rem; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
${P} .tp-mine input, ${P} .tp-meal input, ${P} .tp-costadd input, ${P} .tp-note textarea { font: inherit; font-size: 16px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); min-width: 0; box-sizing: border-box; }
${P} .tp-mine input { text-transform: none; letter-spacing: 0; font-weight: 400; }
${P} .tp-mine select { font: inherit; font-size: 16px; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); text-transform: none; letter-spacing: 0; font-weight: 400; }
${P} .tp-iam { margin: 8px 0; padding: 10px 12px; border-radius: 12px; border: 2px solid var(--tp); background: color-mix(in srgb, var(--tp) 8%, var(--panel)); }
${P} .tp-iam h4 { margin: 0 0 2px; }
${P} .tp-iamn { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
${P} .tp-iamn button { font: inherit; font-size: .95rem; font-weight: 700; padding: 10px 16px; border-radius: 999px; border: 1px solid var(--tp); background: var(--bg); color: var(--fg); cursor: pointer; }
${P} .tp-by { display: block; font-size: .72rem; color: var(--muted); font-weight: 400; }
${P} .tp-card select { font: inherit; font-size: 16px; padding: 7px 6px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); min-width: 0; max-width: 100%; }
${P} .tp-plan-form select { width: 100%; }
${P} .tp-pkrow { display: flex; align-items: center; gap: 6px; }
${P} .tp-pkrow .tp-check { flex: 1; min-width: 0; }
${P} .tp-pkrow .tp-pkx { flex: none; width: 30px; height: 30px; padding: 0; border: 0; background: none; color: var(--muted); font-size: 14px; cursor: pointer; border-radius: 8px; }
${P} .tp-pkrow .tp-pkx:hover { color: #c92a2a; }
${P} .tp-pkrow .tf-grip { width: 30px; margin-right: -6px; }
${P} .tp-pkrow .tp-who { flex: none; width: 104px; font-size: 13px; padding: 5px 4px; color: var(--muted); }
${P} .tp-pkrow .tp-who.set { color: var(--fg); font-weight: 700; border-color: var(--tp); background: color-mix(in srgb, var(--tp) 8%, var(--bg)); }
${P} .tp-whos { margin: 4px 0 6px; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); }
${P} .tp-whos h5 { margin: 0 0 4px; }
${P} .tp-whos ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: .86rem; }
${P} .tp-whos li { display: flex; gap: 8px; }
${P} .tp-whos li b { flex: none; min-width: 52px; }
${P} .tp-whos li i { font-style: normal; }
${P} .tp-whos .sk-note { margin: 4px 0 0; }
${P} .tp-bar { height: 10px; border-radius: 999px; background: var(--chip); overflow: hidden; margin: 4px 0 6px; border: 1px solid var(--line); }
${P} .tp-bar i { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, var(--tp), #20c997); transition: width .4s ease; }
${P} .tp-ready { margin: 4px 0; padding: 8px 10px; border-radius: 10px; background: color-mix(in srgb, #20c997 16%, var(--panel)); font-weight: 800; font-size: .9rem; animation: tppop .5s ease; }
@keyframes tppop { 0% { transform: scale(.9); opacity: 0; } 60% { transform: scale(1.03); opacity: 1; } 100% { transform: scale(1); } }
/* The meal on its own full-width line under the meal's name and who cooks, growing with the text so all of it shows
   (alex 2026-11-11: "when you click on it you see everything you write"). */
${P} .tp-meal { display: grid; grid-template-columns: 1fr 120px; gap: 4px 6px; align-items: center; margin: 6px 0 10px; font-size: .84rem; font-weight: 700; }
${P} .tp-meal select { font-size: 13px; padding: 7px 4px; }
${P} .tp-meal textarea { grid-column: 1 / -1; font: inherit; font-size: 16px; font-weight: 400; line-height: 1.35; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); color: var(--fg); width: 100%; box-sizing: border-box; resize: none; overflow: hidden; min-height: 40px; field-sizing: content; }
${P} .tp-meal textarea:focus { border-color: var(--tp); outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--tp) 18%, transparent); }
${P} .tp-costs, ${P} .tp-pay { list-style: none; margin: 6px 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
${P} .tp-costs li { display: flex; align-items: center; gap: 8px; padding: 6px 4px 6px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); font-size: .88rem; }
${P} .tp-costs li span { flex: 1; display: flex; flex-direction: column; }
${P} .tp-costs li { flex-wrap: wrap; }
${P} .tp-split { flex-basis: 100%; grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 2px 0 2px; }
${P} .tp-split small { color: var(--muted); font-size: .78rem; font-weight: 700; margin-right: 2px; }
${P} .tp-split button.tp-chip { width: auto; height: auto; font: inherit; font-size: .8rem; font-weight: 700; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--bg); color: var(--muted); cursor: pointer; text-decoration: line-through; }
${P} .tp-split button.tp-chip[aria-pressed="true"] { background: color-mix(in srgb, var(--tp) 14%, var(--panel)); border-color: var(--tp); color: var(--fg); text-decoration: none; }
${P} .tp-split button.tp-chip[aria-pressed="true"]::before { content: "✓ "; }
${P} .tp-split button.tp-all { text-decoration: none; color: var(--tp); border-color: var(--tp); background: var(--panel); }
${P} .tp-split button.tp-all[aria-pressed="true"] { background: var(--tp); color: #fff; }
${P} .tp-costs li small { color: var(--muted); font-size: .76rem; }
${P} .tp-costs li button, ${P} .tp-notei button { font: inherit; border: 0; background: none; color: var(--muted); width: 34px; height: 34px; cursor: pointer; }
${P} .tp-costadd { display: grid; grid-template-columns: 1fr 72px; gap: 6px; margin-top: 6px; }
${P} .tp-costadd select { grid-column: 1; }
${P} .tp-costadd button, ${P} .tp-note button { font: inherit; font-size: .86rem; font-weight: 800; padding: 9px 12px; border-radius: 10px; border: 0; background: var(--tp); color: #fff; cursor: pointer; }
${P} .tp-sum { margin: 8px 0 2px; font-size: .9rem; }
${P} .tp-pay li { padding: 6px 10px; border-radius: 10px; background: color-mix(in srgb, #20c997 12%, var(--panel)); font-size: .88rem; }
${P} .tp-note { display: flex; flex-direction: column; gap: 6px; }
${P} .tp-note textarea { width: 100%; resize: vertical; }
${P} .tp-notei { border-left: 3px solid var(--tp); padding: 2px 0 2px 10px; margin: 8px 0; }
${P} .tp-notei small { display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: .76rem; }
${P} .tp-nbtn { display: flex; align-items: center; }
${P} .tp-notei.tf-dragging { background: var(--panel); box-shadow: 0 4px 14px rgba(0,0,0,.18); }
${P} .tp-notei p { margin: 0; font-size: .88rem; white-space: pre-wrap; }
${P} .tp-photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
${P} .tp-photos figure { margin: 0; position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden; background: var(--chip); }
${P} .tp-photos img { width: 100%; height: 100%; object-fit: cover; display: block; }
${P} .tp-photos button { position: absolute; top: 3px; right: 3px; width: 30px; height: 30px; border-radius: 50%; border: 0; background: rgba(0,0,0,.55); color: #fff; cursor: pointer; }
${P} .tp-photoadd { display: flex; justify-content: center; margin-top: 6px; padding: 10px; border-radius: 11px; border: 1.5px dashed var(--tp); font-weight: 800; font-size: .88rem; cursor: pointer; }`;
    document.head.append(css);
  }

  // ---------- the engine's state ----------
  let K = null;   // the sport's kit, made below
  let cur = null, seq = 0, view = null;   // cur: the trip on the card; view: its forecast rows as last worked out
  const card = document.createElement("div");
  card.className = "sk-card sk-trip tp-card";
  card.hidden = true;
  const btn = document.createElement("button");
  btn.type = "button";
  const layer = L.layerGroup();
  const trips = () => store.get(K.key, []);
  const putTrip = (t, snapOnly) => {   // without what's only for now (a way in being worked out)
    if (!snapOnly) t.ed = Date.now();   // the newer edit wins when two devices' trips merge (account.js); a new forecast isn't an edit
    const { wayWait, ...keep } = t, l = trips().filter((x) => x.id !== t.id);
    l.unshift(keep); store.set(K.key, l.slice(0, 20));
    if (!snapOnly && t.share) pushSoon(t);   // a shared trip: the change goes to the group
  };
  const tripById = (id) => (cur && cur.id === id ? cur : trips().find((x) => x.id === id));
  const title = (t) => K.title(t);
  const scrollTo = () => { if (window.tfSnapTo) window.tfSnapTo("half"); setTimeout(() => { if (window.tfPanelScrollTo) window.tfPanelScrollTo(card); else card.scrollIntoView({ block: "start" }); }, 60); };
  function close() {
    seq++; cur = null; view = null; card.hidden = true; card.innerHTML = ""; layer.clearLayers();
    try { sessionStorage.removeItem("tf:tripOpen"); } catch {}
    btn.setAttribute("aria-pressed", "false");
    if (K.close) K.close();
  }

  // ---------- trips ----------
  const newTrip = () => ({ id: Date.now().toString(36), hut: null, name: "", date: addDays(localDate(new Date()), 1), nights: 2, people: 4, at: Date.now(), lines: [], ...(K.newTrip ? K.newTrip() : {}), ...packTpl() });
  function start(t) {
    cur = t; view = null;
    try { sessionStorage.setItem("tf:tripOpen", t.id); } catch {}   // back on the same trip if the page reloads (signing in)
    if (!t.own) Object.assign(t, packTpl());   // a trip from before your own items: starts with your usual ones
    if (!trips().some((x) => x.id === t.id)) putTrip(t);   // kept from the first tap, so nothing started is ever lost
    card.hidden = false; btn.setAttribute("aria-pressed", "true");
    render();
    drawMap();
    scrollTo();
    if (t.share) syncTrip(t.id, true);   // a shared trip: the group's latest the moment it opens, not 30 s later
    K.start(t);
  }
  // "· 3 days to go" (fun to watch it count down), "· today!", "· you're there", nothing once it's over.
  const countdown = (t) => {
    const d = Math.round((new Date(t.date + "T12:00") - new Date(localDate(new Date()) + "T12:00")) / 864e5);
    return d > 1 ? ` · <b>${d} days to go</b>` : d === 1 ? " · <b>tomorrow!</b>" : d === 0 ? " · <b>today!</b>" : -d <= t.nights ? " · <b>you're there</b>" : "";
  };

  // ---------- the map ----------
  // The trip's place, its lines and what the kit adds (Skiing: the way in), in the sport's own map pane.
  function drawMap() {
    layer.clearLayers();
    const t = cur;
    if (!t || !K.isOn()) return;
    const pane = K.pane;
    if (t.hut) L.circleMarker([t.hut.lat, t.hut.lon], { pane, radius: 9, color: "#fff", weight: 3, fillColor: K.color, fillOpacity: 1, interactive: false }).addTo(layer);
    for (const x of linesOf(t)) for (const l of x.ls) {
      L.polyline(l, { pane, color: "#fff", weight: 7, opacity: 0.9, interactive: false }).addTo(layer);
      L.polyline(l, { pane, color: K.lineColor, weight: 4, opacity: 1, interactive: false }).addTo(layer);
    }
    if (K.drawExtra) K.drawExtra(t, layer);
    if (!map.hasLayer(layer)) layer.addTo(map);
    const b = tripBounds(t) || (t.hut ? L.latLng(t.hut.lat, t.hut.lon).toBounds(3000) : null);
    if (!b) return;
    if (!map.getBounds().contains(b)) map.fitBounds(b, { padding: [30, 30], maxZoom: 14 });
  }

  // ---------- the days ----------
  // The kit's forecast for each day of the trip, kept with the trip (t.snap) for when there's no signal.
  const tripDates = (t) => Array.from({ length: t.nights + 1 }, (_, i) => addDays(t.date, i));
  async function loadDays(t) {
    if (!K.hasDays(t)) return;
    const my = ++seq;
    const r = await K.snapOf(t);
    if (my !== seq || cur !== t) return;
    if (r.err) { view = t.snap ? { ...t.snap, old: true, err: r.err } : { err: r.err }; renderDays(); return; }
    view = r.snap;
    t.snap = view;
    putTrip(t, true);
    renderDays();
  }

  // ---------- the day before: everything that changes, updated by itself (alex 2026-11-11) ----------
  // A web page (and the iPhone app) can't run while it's closed, so this runs each time the app is opened or comes
  // back to the screen, from the day before the trip to its last day (winter.js loads the sport's files for it even
  // when another sport is on): each day's forecast goes into the trip (t.snap, with the time it was fetched), and the
  // trip's offline save gets the kit's latest files (the service worker keeps the saved copy as fresh as each
  // download). At most every 2 hours a trip. The calendar reminder (⏰ Remind me the day before) gets the app opened.
  const inWindow = (t, today) => K.hasDays(t) && addDays(t.date, -1) <= today && today <= addDays(t.date, t.nights);
  let refreshing = false;
  async function refreshAhead() {
    if (refreshing || !navigator.onLine) return;
    const today = localDate(new Date()), due = trips().filter((t) => inWindow(t, today) && Date.now() - (t.autoAt || 0) > 2 * 3600e3);
    if (!due.length) return;
    refreshing = true;
    try {
      for (const t0 of due) {
        const r = await K.snapOf(t0);
        if (r.err) continue;
        const t = tripById(t0.id) || t0;
        t.snap = r.snap; t.autoAt = Date.now();
        const st = offSt(t), urls = st && st.box && K.offUrls ? K.offUrls(st.box) : [];
        if (urls.length) {   // the saved copy's changing files, downloaded again
          let ok = 0;
          for (let i = 0; i < urls.length; i += 6) ok += (await Promise.all(urls.slice(i, i + 6).map((u) => fetch(u, { cache: "no-cache" }).then((x) => x.ok, () => false)))).filter(Boolean).length;
          if (ok) t.offFresh = Date.now();
        }
        putTrip(t, true);
        if (cur && cur.id === t.id) { cur.snap = t.snap; cur.autoAt = t.autoAt; cur.offFresh = t.offFresh; view = t.snap; renderDays(); const el = $("tpOff"); if (el) el.innerHTML = offHtml(cur); }
      }
    } finally { refreshing = false; }
  }
  // A calendar event the evening before: open the app so the trip updates (forecast, offline copy).
  function dayBeforeIcs(t) {
    const at = new Date(addDays(t.date, -1) + "T18:00"), url = appBase();
    return ics([`UID:tf-before-${t.id}@trail-finder`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(at)}`, `DTEND:${stamp(new Date(at.getTime() + 15 * 60000))}`,
      `SUMMARY:${icsEsc(`Open Trail Finder: update your ${title(t)} trip`)}`,
      `DESCRIPTION:${icsEsc(`Your trip starts tomorrow. Open Trail Finder with signal: ${K.w.updates} update by themselves.\n${url}`)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(`Open Trail Finder to update your ${title(t)} trip`)}`, "TRIGGER:PT0M", "END:VALARM"]);
  }

  // ---------- your lines for this trip ----------
  // The trip as a folder (alex 2026-11-11): every line you want to do while you're there, kept with its points
  // (rounded, about every 12 m), so it draws, opens and saves offline with no signal. rid: a mapped line's id (its card
  // opens from the list); tour: one of your own planned lines (its id in the sport's saved list).
  const linesOf = (t) => t.lines || [];
  const r5 = (p) => [+(+p[0]).toFixed(5), +(+p[1]).toFixed(5)];
  const thin = (l) => { const out = []; l.forEach((p, i) => { const q = r5(p); if (!out.length || i === l.length - 1 || map.distance(out.at(-1), q) >= 12) out.push(q); }); return out; };
  const lineKm = (ls) => ls.reduce((s, l) => s + l.reduce((a, p, i) => (i ? a + map.distance(l[i - 1], p) : 0), 0), 0) / 1000;
  function tripBounds(t) {
    const pts = [...(t.hut ? [[t.hut.lat, t.hut.lon]] : []), ...(K.extraPts ? K.extraPts(t) : []), ...linesOf(t).flatMap((x) => x.ls.flat())];
    return pts.length > 1 ? L.latLngBounds(pts) : null;
  }
  const sameLine = (a, b) => (a.rid ? a.rid === b.rid : a.tour ? a.tour === b.tour : !b.rid && !b.tour && a.name === b.name);
  function addLine(t, x) {
    const ls = x.ls.map(thin).filter((l) => l.length > 1);
    if (!ls.length) return;
    const y = { id: x.rid || x.tour || "l" + Date.now().toString(36), rid: x.rid || "", tour: x.tour || "", name: String(x.name || K.w.line).slice(0, 80), label: x.label || "", ls, km: +lineKm(ls).toFixed(1), c: x.c ? r5(x.c) : ls[0][0] }, old = linesOf(t).find((z) => sameLine(z, y)), ab = (old && old.ab) || meOf(t);
    if (ab) y.ab = ab;
    if (old && old.day != null) y.day = old.day;   // the day it's planned for (Hike trips) stays when it's added again
    t.lines = [...linesOf(t).filter((z) => !sameLine(z, y)), y];
    putTrip(t);
    if (cur === t) { renderLines(); if (K.linesChanged) K.linesChanged(t); drawMap(); }
  }
  function dropLine(t, id) {
    t.lines = linesOf(t).filter((z) => z.id !== id);
    putTrip(t);
    if (cur === t) { renderLines(); if (K.linesChanged) K.linesChanged(t); drawMap(); }
  }
  function linesHtml(t) {
    const l = linesOf(t), top = K.linesTop ? K.linesTop(t) : "";
    const rows = l.map((x) => `<li><button type="button" data-tl="${esc(x.id)}"><span><i class="tp-sw"></i>${esc(x.name)} <small>${[x.label, x.km.toFixed(1) + " km"].filter(Boolean).map(esc).join(" · ")}</small>${byHtml(t, x)}</span></button>${K.lineExtra ? K.lineExtra(t, x) : ""}${x.tour && K.canEdit ? `<button type="button" class="tp-rm" data-tledit="${esc(x.tour)}" aria-label="Change ${esc(x.name)}: its points">✎</button>` : ""}<button type="button" class="tp-rm" data-tlrm="${esc(x.id)}" aria-label="Take ${esc(x.name)} off this trip">✕</button></li>`).join("");
    return `${top || rows ? `<ul class="tp-list tp-tours">${top}${rows}</ul>` : ""}
      ${l.length ? "" : `<p class="sk-note">${K.linesEmpty(t)}</p>`}
      <div class="tp-btns"><button type="button" data-tp="drawline">✏️ ${esc(K.drawLabel(t))}</button>${l.length ? `<button type="button" data-tp="fitall">🗺 See them all</button>` : ""}${l.length || top ? `<button type="button" data-tp="gpx">⬇ GPX of the whole trip</button>` : ""}</div>`;
  }
  // "Add to … trip" on a line's card (only once you have a trip): into the trip that's open, your only trip, or the one you pick.
  function offerAdd(after, getItem) {
    if (!after || !trips().length) return;
    const box = document.createElement("div");
    box.className = "tp-addto";
    after.after(box);
    const draw = (pick) => {
      const x = getItem(), l = trips();
      if (!x) { box.innerHTML = ""; return; }
      if (pick) { box.innerHTML = `<p class="sk-note">Add it to which trip?</p><ul class="tp-list">${pick.map((t) => `<li><button type="button" data-addto="${esc(t.id)}"><span>${esc(title(t))}</span><small>${esc(dayWord(t.date))}</small></button></li>`).join("")}</ul>`; return; }
      const inT = l.filter((t) => linesOf(t).some((y) => sameLine(y, x)));
      box.innerHTML = inT.map((t) => `<div class="tp-in"><span>✓ In your trip to <b>${esc(title(t))}</b></span><button type="button" data-addrm="${esc(t.id)}">Take off</button></div>`).join("")
        + (inT.length === l.length ? "" : `<button type="button" data-addgo="1">${esc(K.w.addTo)}</button>`);
    };
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button"), x = b && getItem();
      if (!x) return;
      e.stopPropagation();
      const into = (id) => { const t = tripById(id); if (!t) return; addLine(t, x); toast(`Added to your trip to ${title(t)}.`); draw(); };
      if (b.dataset.addrm) { const t = tripById(b.dataset.addrm), y = t && linesOf(t).find((z) => sameLine(z, x)); if (y) dropLine(t, y.id); draw(); }
      else if (b.dataset.addto) into(b.dataset.addto);
      else if (b.dataset.addgo) {
        const free = trips().filter((t) => !linesOf(t).some((y) => sameLine(y, x)));
        if (cur && !card.hidden && free.some((t) => t.id === cur.id)) into(cur.id); else if (free.length === 1) into(free[0].id); else draw(free);
      }
    });
    draw();
  }
  card.addEventListener("click", (e) => {
    const a = e.target.closest("[data-tl], [data-tlrm], [data-tledit]");
    if (!a || !cur) return;
    const t = cur;
    if (a.dataset.tlrm) { dropLine(t, a.dataset.tlrm); return; }
    if (a.dataset.tledit) { if (K.editLine) K.editLine(t, a.dataset.tledit); return; }
    if (a.dataset.tl === "way") { if (K.openWay) K.openWay(t); return; }
    const x = linesOf(t).find((y) => y.id === a.dataset.tl);
    if (x) K.openLine(t, x);
  });

  // ---------- packing list ----------
  // The kit builds it from the trip ([[heading, [[key, label]...]]...]); ticks stay with the trip on this phone (t.packed).
  const packDone = (t) => ({ ...(t.packed || {}), ...(t.offAt ? { offline: 1 } : {}), ...(t.plan && t.plan.sent ? { plan: 1 } : {}) });
  // Your own items, and the ones you never bring, carry over to your next trips of that sport (K.packKey, on the
  // account when signed in). Own items' keys start with "my_" (their ticks are in t.packed like the others).
  const packTpl = () => { const v = store.get(K.packKey, {}); return { own: (v.own || []).map((x) => ({ ...x })), hide: (v.hide || []).slice() }; };
  const tplSet = (f) => { const v = store.get(K.packKey, {}); store.set(K.packKey, f({ own: v.own || [], hide: v.hide || [] })); };
  function packList(t) {
    const hide = new Set(t.hide || []);
    const G = K.packItems(t, view).map(([h, items]) => [h, items.filter((x) => !hide.has(x[0])).map((x) => [x[0], x[1], h])]);
    const own = (t.own || []).map((x) => [x.k, x.label, "Your own items"]);
    const into = (h) => { let g = G.find((y) => y[0] === h); if (!g) { g = [h, []]; const i = G.findIndex((y) => y[0] === "Before you go"); G.splice(i < 0 ? G.length : i, 0, g); } return g; };
    if (own.length) into("Your own items")[1].push(...own);
    // Where you dragged things (☰, alex 2026-11-11): t.pk.sec, an item moved to another section; t.pk.order, the order.
    // Items the trip adds later go at the end of their section.
    const pk = t.pk || {}, sec = pk.sec || {}, moved = [];
    G.forEach((g) => { g[1] = g[1].filter((x) => { const to = sec[x[0]]; if (to && to !== g[0]) { moved.push([to, x]); return false; } return true; }); });
    moved.forEach(([to, x]) => into(to)[1].push(x));
    if ((pk.order || []).length) { const at = new Map(pk.order.map((k, i) => [k, i])), o = (x) => (at.has(x[0]) ? at.get(x[0]) : 1e9); G.forEach((g) => g[1].sort((a, b) => o(a) - o(b))); }
    return G.filter((x) => x[1].length);
  }
  // Who brings a shared item (alex 2026-11-11: "how do you assign who brings some item? maybe in a share item list"):
  // Who? on every shared item and your own items, there even before the group has names ("Add a name…" adds one and
  // puts it on that item), and Who brings what at the top: each person's items, and how many shared items have no one.
  const gearSel = (t, k) => { const v = (t.gear || {})[k];
    return `<select data-gear="${esc(k)}" class="tp-who${v ? " set" : ""}" aria-label="Who brings it">${[`<option value="">Who?</option>`, ...names(t).map((n) => `<option ${n === v ? "selected" : ""}>${esc(n)}</option>`), ...(v && !names(t).includes(v) ? [`<option selected>${esc(v)}</option>`] : []), `<option value="+add">Add a name…</option>`].join("")}</select>`; };
  function whoHtml(t, G) {
    const items = G.flatMap((g) => g[1]).filter((x) => isGroupGear(x[0])), gear = t.gear || {}, by = new Map();
    for (const x of items) { const w = gear[x[0]]; if (w) { if (!by.has(w)) by.set(w, []); by.get(w).push(x[1].replace(/:.*$/, "")); } }
    const open = items.filter((x) => !gear[x[0]]).length;
    if (!by.size) return `<p class="sk-note">Tap Who? beside a shared item (stove, first aid, your own items) to say who brings it, so nobody brings two.</p>`;
    const order = [...names(t).filter((n) => by.has(n)), ...[...by.keys()].filter((n) => !names(t).includes(n))];
    return `<div class="tp-whos"><h5>Who brings what</h5><ul>${order.map((n) => `<li><b>${esc(n)}</b><span>${by.get(n).map((x) => `<i>${esc(x)}</i>`).join(", ")}</span></li>`).join("")}</ul>${open ? `<p class="sk-note">${open} shared item${open > 1 ? "s have" : " has"} no one yet: tap Who? beside it.</p>` : ""}</div>`;
  }
  let gearFor = "";   // the item waiting for a name typed in Your group (Who? › Add a name…)
  // Who? right in the Add an item box (alex 2026-11-14: "can you add an item with the who option"): pick who brings it
  // while adding. What you typed and picked stays put while Who? › Add a name… takes you to Your group and back.
  let addDraft = { label: "", who: "" };
  const whoPick = (t) => { const v = addDraft.who;
    return `<select data-pkwho="1" class="tp-who${v ? " set" : ""}" aria-label="Who brings it">${[`<option value="">Who?</option>`, ...names(t).map((n) => `<option ${n === v ? "selected" : ""}>${esc(n)}</option>`), ...(v && !names(t).includes(v) ? [`<option selected>${esc(v)}</option>`] : []), `<option value="+add">Add a name…</option>`].join("")}</select>`; };
  function packHtml(t) {
    const G = packList(t), done = packDone(t), auto = { offline: !!t.offAt, plan: !!(t.plan && t.plan.sent) }, all = G.flatMap((x) => x[1]), n = all.filter((x) => done[x[0]]).length;
    // Every row: tick it, ✕ to take it off, hold ☰ and drag it up or down, or into another section (alex 2026-11-11).
    const body = G.map(([h, items]) => `<h5 data-h="${esc(h)}">${esc(h)}</h5>${items.map(([k, label, home]) => `<div class="tp-pkrow" data-k="${esc(k)}" data-home="${esc(home)}" data-sec="${esc(h)}"><label class="tp-check"><input type="checkbox" data-pk="${k}" ${done[k] ? "checked" : ""} ${auto[k] ? "disabled" : ""}> <span>${esc(label)}${home === "Your own items" ? byHtml(t, (t.own || []).find((y) => y.k === k)) : ""}</span></label>${isGroupGear(k) ? gearSel(t, k) : ""}<button type="button" class="tp-pkx" data-pkrm="${esc(k)}" aria-label="Take ${esc(label)} off the list">✕</button>${window.tfGrip || ""}</div>`).join("")}`).join("");
    const pct = all.length ? Math.round((n / all.length) * 100) : 0;
    return `<details class="tp-pack" ${t.packOpen ? "open" : ""}><summary>🎒 Packing list <small>${n} of ${all.length} packed</small></summary>
      <div class="tp-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Packed"><i style="width:${pct}%"></i></div>
      ${n && n === all.length ? `<p class="tp-ready">🎉 Your bag is ready. Have a great trip!</p>` : ""}
      ${whoHtml(t, G)}
      ${body}
      <form class="tp-addf" data-pkadd="1"><input type="text" maxlength="80" placeholder="Add an item" autocomplete="off" enterkeyhint="done" aria-label="Add an item to the packing list" value="${esc(addDraft.label)}">${whoPick(t)}<button type="submit">Add</button></form>
      <p class="sk-note">Hold ☰ to drag an item up or down. What you take off (✕) or add stays that way for your next trips too.</p>
      <div class="tp-btns"><button type="button" data-tp="packshare">📤 Send the list to the group</button>${n ? `<button type="button" data-tp="packclear">Untick all</button>` : ""}${(t.hide || []).length ? `<button type="button" data-tp="packback">Put back what you took off</button>` : ""}</div></details>`;
  }

  // ---------- tell someone your plan, and the late alert ----------
  // What AdventureSmart asks you to leave with someone: who, where, when you'll be out and when to call for help. It goes
  // out through the share sheet (text, email...). The late alert is a calendar event for the friend that rings at the
  // "call for help" time, with what to do in it: it works with no signal on your side, and no server. On your phone the
  // trip turns red once your out time has passed, until you tap We're out safe.
  const me = () => store.get("tripMe", {});
  // Who you are in a shared trip (alex 2026-11-11): your name from its group, picked the first time you open it
  // ("Who are you?"). t.me (the group key) stays on this phone. A group name the same as your usual name counts as you.
  const myKey = (t) => { const g = t.group || [], m = (me().name || "").toLowerCase(); return (t.me && g.some((x) => x.k === t.me)) ? t.me : ((m && g.find((x) => x.n.toLowerCase() === m)) || {}).k || ""; };
  const meOf = (t) => { const k = myKey(t), x = k && (t.group || []).find((y) => y.k === k); return x ? x.n : (me().name || ""); };
  // "added by Sam" on what someone added, only in a shared trip (where it matters).
  const byHtml = (t, x) => (t.share && x && x.ab ? `<small class="tp-by">added by ${esc(x.ab)}</small>` : "");
  function iamHtml(t) {
    if (!t.share || myKey(t) || t.meSkip) return "";
    const g = t.group || [];
    return `<div class="tp-iam" id="tpIam"><h4>Who are you?</h4><p class="sk-note">Pick your name so the group sees what you add.</p>
      ${g.length ? `<div class="tp-iamn" role="group" aria-label="Your name">${g.map((x) => `<button type="button" data-iam="${esc(x.k)}">${esc(x.n)}</button>`).join("")}</div>` : ""}
      <form class="tp-addf" data-iamadd="1"><input type="text" maxlength="30" placeholder="${g.length ? "Not on the list? Your name" : "Your name"}" autocomplete="off" enterkeyhint="done" aria-label="Your name"><button type="submit">Add me</button></form>
      <div class="tp-btns"><button type="button" data-iamskip="1">Not now</button></div></div>`;
  }
  const outDay = (t) => addDays(t.date, t.nights);
  const planOf = (t) => {
    const m = me(), pl = t.plan || {};
    return { who: pl.who != null ? pl.who : m.who || "", car: pl.car != null ? pl.car : m.car || "", friend: pl.friend != null ? pl.friend : m.friend || "",
      out: pl.out || `${outDay(t)}T16:00`, help: pl.help || `${outDay(t)}T20:00`, sent: pl.sent || 0, safe: pl.safe || 0 };
  };
  const late = (t) => { const pl = t.plan; return !!(pl && pl.sent && !pl.safe && Date.now() > new Date(pl.out || `${outDay(t)}T16:00`).getTime()); };
  const icsEsc = (s) => String(s).replace(/[\\;,]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  // One calendar event, its lines folded (75 bytes a line at most).
  const ics = (ev) => ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//Trail Finder//${K.w.prod}//EN`, "CALSCALE:GREGORIAN", "BEGIN:VEVENT", ...ev, "END:VEVENT", "END:VCALENDAR"]
    .map((l) => (l.match(/.{1,60}/gu) || [""]).join("\r\n ")).join("\r\n");
  function alertIcs(t) {
    const pl = planOf(t), at = new Date(pl.help), who = pl.who || "your friend";
    return ics([`UID:tf-trip-${t.id}@trail-finder`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(at)}`, `DTEND:${stamp(new Date(at.getTime() + 30 * 60000))}`,
      `SUMMARY:${icsEsc(`Heard from ${who}? (${title(t)} trip)`)}`, ...(t.hut ? [`GEO:${t.hut.lat.toFixed(5)};${t.hut.lon.toFixed(5)}`] : []),
      `DESCRIPTION:${icsEsc(`Not heard from ${who} yet? If they haven't told you they're out safe, call 911 and say they're overdue on ${K.w.overdue}.\n\n${K.planText(t, pl)}`)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(`Not heard from ${who}? Call 911`)}`, "TRIGGER:PT0M", "END:VALARM"]);
  }
  function bookIcs(t) {
    const d = (t.book && t.book.remind) || localDate(new Date()), at = new Date(d + "T09:00"), site = K.bookSite(t);
    return ics([`UID:tf-book-${t.id}@trail-finder`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(at)}`, `DTEND:${stamp(new Date(at.getTime() + 15 * 60000))}`,
      `SUMMARY:${icsEsc(`Book ${title(t)} (${dayWord(t.date)}, ${nightsW(t)})`)}`,
      `DESCRIPTION:${icsEsc(`${K.bookWhat(t)}${site ? `\n${site}` : ""}`)}`,
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(`Book ${title(t)}`)}`, "TRIGGER:PT0M", "END:VALARM"]);
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
    toast(text && /^Saved/.test(text) ? text : `Saved ${name}: send it to your friend to open.`);
    return true;
  }
  async function shareText(head, text) {
    try {
      if (navigator.share) { await navigator.share({ title: head, text }); return true; }
      await navigator.clipboard.writeText(text);
      toast("Copied: paste it in a message.");
      return true;
    } catch (e) { if (e && e.name === "AbortError") return false; try { prompt("Copy this:", text); } catch {} return true; }
  }
  function planHtml(t) {
    const pl = planOf(t), isLate = late(t);
    const status = pl.safe ? `<p class="sk-note">✅ Out safe ${esc(when(pl.safe))}.</p>`
      : isLate ? `<p class="tp-late">Past your out time (${esc(when(pl.out))}). Out safe? Tell ${esc(pl.friend || "your friend")} now${Date.now() > new Date(pl.help).getTime() ? ": their alert has gone off" : `, before the alert goes off at ${esc(when(pl.help))}`}.</p>`
      : pl.sent ? `<p class="sk-note">Sent ${esc(when(pl.sent))}: their alert goes off at ${esc(when(pl.help))} unless you tell them you're out.</p>` : "";
    return `<details class="tp-plan" ${t.planOpen || isLate ? "open" : ""}><summary>🛟 Tell someone your plan${isLate ? ` <small class="tp-late-tag">Overdue</small>` : pl.sent ? " <small>sent</small>" : ""}</summary>
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
  const names = (t) => (t.group || []).map((x) => x.n);
  const whoSel = (t, attr, val, none) => `<select ${attr} aria-label="Who">${[`<option value="">${esc(none || "Who?")}</option>`, ...names(t).map((n) => `<option ${n === val ? "selected" : ""}>${esc(n)}</option>`), ...(val && !names(t).includes(val) ? [`<option selected>${esc(val)}</option>`] : [])].join("")}</select>`;
  const money = (v) => `$${(Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, "")}`;
  // The shared items in the packing list (the kit's groupGear): one for the group, so it gets a name. Your own items can too.
  const isGroupGear = (k) => K.groupGear.has(k) || k.startsWith("my_");

  function groupHtml(t) {
    const sh = t.share, l = t.group || [], my = me().name || "";
    const st = sh ? `<p class="sk-note">${sh.dead ? `<b style="color:#c92a2a">Not shared any more</b>: ${esc(sh.err)}. Your copy stays on this phone.` : sh.err ? `<b style="color:#c92a2a">Not synced yet</b> (${esc(sh.err)}): your changes go to the group when you have signal.` : `✓ Shared: everyone with the link sees and edits the same trip${sh.at ? `, last synced ${esc(new Date(sh.at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }))}` : ""}${sh.by ? ` (last change by ${esc(sh.by)})` : ""}.`}</p>` : "";
    return `<details class="tp-pack tp-grp" ${t.grpOpen ? "open" : ""}><summary>👥 Your group <small>${sh ? "shared" : l.length ? `${l.length} ${l.length > 1 ? "people" : "person"}` : ""}</small></summary>
      <p class="sk-note">Their names are used for who brings what, who cooks, who booked and who paid.</p>
      <ul class="tp-names">${l.map((x) => `<li>${esc(x.n)}<button type="button" data-grm="${esc(x.k)}" aria-label="Take ${esc(x.n)} off the group">✕</button></li>`).join("")}</ul>
      <form class="tp-addf" data-gadd="1"><input type="text" maxlength="30" placeholder="Add a name" autocomplete="off" enterkeyhint="done" aria-label="Add a name to the group"><button type="submit">Add</button></form>
      ${sh && l.length ? `<label class="tp-mine">You are<select data-iamsel="1" aria-label="Who you are in this group"><option value="">Pick your name</option>${l.map((x) => `<option value="${esc(x.k)}" ${x.k === myKey(t) ? "selected" : ""}>${esc(x.n)}</option>`).join("")}</select></label>`
        : `<label class="tp-mine">Your name<input type="text" data-me="name" maxlength="30" value="${esc(my)}" placeholder="So the group sees who changed what" autocomplete="off"></label>`}
      ${st}
      <div class="tp-btns">${sh ? (sh.dead ? `<button type="button" data-tp="share">📤 Share it again with a new link</button>` : `<button type="button" class="go" data-tp="sharelink">📤 Send the link again</button><button type="button" data-tp="syncnow">↻ Sync now</button>`)
        : `<button type="button" class="go" data-tp="share">📤 Share this trip with your group</button>`}</div>
      ${sh && !sh.dead ? `<p class="sk-note">Taking a name off the group doesn't take away their link. To stop someone opening this trip, make a new link: the old one stops working for everyone, then send the new one to the people still going.</p><div class="tp-btns"><button type="button" data-tp="rekey">Make a new link</button></div>` : ""}
      <p class="sk-note">${sh ? "Anyone with the link can see and change this trip, so only send it to your group. Your ticks in the packing list, the plan you tell someone and your photos stay on your phone." : "Your group opens the link in Trail Finder and gets the same trip: lines, packing list, who brings what, meals, booking and costs. Everyone can add and delete things. Your ticks, the plan you tell someone and your photos stay yours."}</p></details>`;
  }

  function bookHtml(t) {
    const b = t.book || {}, top = K.bookTop(t);
    return `<details class="tp-pack tp-book" ${t.bookOpen ? "open" : ""}><summary>📅 Booking <small>${b.done ? "booked ✓" : top.tag}</small></summary>
      ${top.html}
      <label class="tp-check"><input type="checkbox" data-set="book.done" ${b.done ? "checked" : ""}> <span>Booked</span></label>
      <div class="tp-plan-form">
        <label>Confirmation #<input type="text" data-set="book.conf" maxlength="40" value="${esc(b.conf || "")}" autocomplete="off"></label>
        <label>Paid ($)<input type="number" inputmode="decimal" min="0" step="any" data-set="book.paid" value="${esc(b.paid || "")}"></label>
        <label class="wide">Booked by${whoSel(t, 'data-set="book.by"', b.by, "—")}</label>
        ${b.done ? "" : `<label class="wide">Remind me to book on<input type="date" data-set="book.remind" value="${esc(b.remind || localDate(new Date()))}"></label>`}
      </div>
      ${b.done ? "" : `<div class="tp-btns"><button type="button" data-tp="bookics">⏰ Add the reminder to my calendar</button></div>`}</details>`;
  }

  // Meals: the first day (lunch on the way, dinner), the full days, and the morning of the last day.
  const MEALS = [["b", "Breakfast"], ["l", "Lunch"], ["d", "Dinner"]];
  function mealsHtml(t) {
    const m = t.meals || {}, dates = tripDates(t), n = Object.values(m).filter((x) => x && x.what).length;
    return `<details class="tp-pack tp-meals" ${t.mealOpen ? "open" : ""}><summary>🍲 Meals <small>${n ? `${n} planned` : ""}</small></summary>
      ${dates.map((date, i) => `<h5>${esc(dayWord(date))}${i === 0 ? ` · ${K.w.first}` : i === dates.length - 1 ? ` · ${K.w.last}` : ""}</h5>
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
  // The group's names as buttons to tap in or out of a cost. "All" at the end puts everyone back in at once (alex 2026-11-11: "add all").
  const chips = (t, on, attr, all) => names(t).map((n) => `<button type="button" class="tp-chip" ${attr(n)} aria-pressed="${on.includes(n)}">${esc(n)}</button>`).join("")
    + `<button type="button" class="tp-chip tp-all" ${all} aria-pressed="${on.length >= names(t).length}">All</button>`;
  function costHtml(t) {
    const l = t.costs || [], s = settle(t);
    return `<details class="tp-pack tp-cost" ${t.costOpen ? "open" : ""}><summary>💵 Costs <small>${l.length ? `${money(s.total)}${s.even ? ` · ${money(s.each)} each` : ""}` : ""}</small></summary>
      ${l.length ? `<ul class="tp-costs">${l.map((x) => { const f = splitOf(t, x), all = f.length === names(t).length; return `<li><span>${esc(x.what)}<small>${x.by ? `paid by ${esc(x.by)}` : "who paid?"}${names(t).length ? ` · ${all ? "split with everyone" : `split with ${esc(f.join(", "))}`}` : ""}</small>${x.ab && x.ab !== x.by ? byHtml(t, x) : ""}</span><b>${money(+x.amt || 0)}</b><button type="button" data-crm="${esc(x.id)}" aria-label="Delete ${esc(x.what)}">✕</button>${names(t).length > 1 ? `<div class="tp-split" role="group" aria-label="Who shares ${esc(x.what)}">${chips(t, f, (n) => `data-csplit="${esc(x.id)}" data-n="${esc(n)}"`, `data-callsplit="${esc(x.id)}"`)}</div>` : ""}</li>`; }).join("")}</ul>` : `<p class="sk-note">${K.costHint(t)}</p>`}
      <form class="tp-costadd" data-cadd="1"><input type="text" maxlength="40" placeholder="What (gas, food…)" autocomplete="off" aria-label="What it was for"><input type="number" inputmode="decimal" min="0" step="any" placeholder="$" aria-label="Amount">${whoSel(t, "", "", "Paid by")}<button type="submit">Add</button>${names(t).length > 1 ? `<div class="tp-split" role="group" aria-label="Split between"><small>Split between</small>${chips(t, names(t), (n) => `data-fsplit="${esc(n)}"`, "data-fall=\"1\"")}</div>` : ""}</form>
      ${l.length ? `<p class="tp-sum">${s.even ? `<b>${money(s.total)}</b> in all, <b>${money(s.each)}</b> each for ${s.n} ${s.n > 1 ? "people" : "person"}${names(t).length ? "" : " (add names in Your group to split it)"}.` : `<b>${money(s.total)}</b> in all. Each one's share: ${names(t).map((w) => `${esc(w)} <b>${money(s.share[w])}</b>`).join(" · ")}`}</p>
        ${s.pay.length ? `<ul class="tp-pay">${s.pay.map(([a, b, v]) => `<li>${esc(a)} pays ${esc(b)} <b>${money(v)}</b></li>`).join("")}</ul>` : ""}
        ${s.noPayer ? `<p class="sk-note">${s.noPayer} cost${s.noPayer > 1 ? "s have" : " has"} no one from the group as the payer: they're in the total but not in who pays whom.</p>` : ""}` : ""}</details>`;
  }

  // Journal: notes (shared with the group) and photos (on this phone only), for after you come out.
  function journalHtml(t) {
    // Newest first, until someone moves a note (alex 2026-11-16: "make it so we can move those up and down"): then the
    // order they put them in (t.nOrd: the notes' ids, shared with the group), notes added since going on top.
    const ord = Array.isArray(t.nOrd) ? t.nOrd : [], at = (x) => ord.indexOf(x.id);
    const l = (t.notes || []).slice().sort((a, b) => (at(a) < 0 || at(b) < 0 ? (at(b) < 0) - (at(a) < 0) || b.at - a.at : at(a) - at(b)));
    return `<details class="tp-pack tp-jour" ${t.jourOpen ? "open" : ""}><summary>📓 Trip journal <small>${l.length ? `${l.length} note${l.length > 1 ? "s" : ""}` : ""}</small></summary>
      <p class="sk-note">${esc(K.w.journal)}</p>
      <form class="tp-note" data-nadd="1"><textarea maxlength="1000" rows="3" placeholder="Write a note" aria-label="Write a note"></textarea><button type="submit">Add the note</button></form>
      <div class="tp-notes">${l.map((x) => `<div class="tp-notei" data-nid="${esc(x.id)}"><small><span>${esc(new Date(x.at).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}${x.by ? ` · ${esc(x.by)}` : ""}</span><span class="tp-nbtn"><button type="button" data-nrm="${esc(x.id)}" aria-label="Delete this note">✕</button>${l.length > 1 ? window.tfGrip || "" : ""}</span></small><p>${esc(x.text)}</p></div>`).join("")}</div>
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
  const tripKey = (t) => (t.share ? "s:" + (t.share.pk || t.share.id) : t.id);   // pk: the first link's id, kept through a new link
  const urls = [];
  async function renderPhotos() {
    const el = $("tpPhotos"), t = cur;
    if (!el || !t || !card.contains(el)) return;
    let l = [];
    try { l = await ptx("readonly", (s) => s.index("trip").getAll(tripKey(t))); } catch {}
    if (cur !== t) return;
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    el.innerHTML = l.sort((a, b) => a.at - b.at).map((p) => { const u = URL.createObjectURL(p.blob); urls.push(u); return `<figure><a href="${u}" target="_blank" rel="noopener"><img src="${u}" alt="Trip photo" loading="lazy"></a><button type="button" data-prm="${esc(p.id)}" aria-label="Delete this photo">✕</button></figure>`; }).join("");
  }

  // GPX of the whole trip: the place, what the kit adds (Skiing's way in) and every line, for a watch or another app.
  function tripGpx(t) {
    const x = (s) => String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
    const trk = (name, ls) => `<trk><name>${x(name)}</name>${ls.map((l) => `<trkseg>${l.map((p) => `<trkpt lat="${p[0]}" lon="${p[1]}"/>`).join("")}</trkseg>`).join("")}</trk>`;
    const wpt = (lat, lon, name) => `<wpt lat="${lat}" lon="${lon}"><name>${x(name)}</name></wpt>`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Trail Finder" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${x(title(t))} ${x(K.w.trip)}</name></metadata>`
      + (t.hut ? wpt(t.hut.lat, t.hut.lon, t.hut.name || title(t)) : "")
      + (K.gpxExtra ? K.gpxExtra(t, trk, wpt) : "") + linesOf(t).map((l) => trk(l.name, l.ls)).join("") + `</gpx>`;
  }

  // ---------- sharing the trip with the group ----------
  // The trip goes to the app's database (supabase/shared-trips.sql) under a random id, with a random key that only the
  // link carries (the database keeps an md5 of it): anyone with the link reads and changes it, nobody else can. Each
  // phone keeps its copy (works with no signal) and the copy it last synced (share.base): a sync merges the group's
  // changes with yours item by item (an added line or item, a deleted one, a meal typed), so two people editing at once
  // both keep their changes. Ticks, the plan you tell someone, offline saves and photos stay on each phone.
  // A trip says which sport it's for (sport, missing on Skiing's older trips), so the link opens the right one.
  const SHARED = () => ["sport", "hut", "name", "date", "nights", "people", ...(K.shared || []), "lines", "own", "hide", "pk", "gear", "meals", "book", "costs", "notes", "nOrd", "group"];
  const docOf = (t) => JSON.parse(JSON.stringify(Object.fromEntries(SHARED().filter((k) => t[k] !== undefined).map((k) => [k, t[k]]))));
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
      const id = (x) => x.id || x.k, mp = (a) => Object.fromEntries((a || []).map((x) => [id(x), x]));
      const o = merge3(mp(b), mp(m), mp(r)), order = [...(r || []).map(id), ...(m || []).map(id)];
      return [...new Set(order)].filter((k) => k in o).map((k) => o[k]);
    }
    // Lists of names (what was taken off the packing list, its order): both phones' adds and removals kept.
    const strs = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
    if (strs(m) && strs(r) && (b === undefined || strs(b))) {
      const bs = new Set(b || []), ms = new Set(m), gone = new Set([...bs].filter((x) => !ms.has(x)));
      return [...new Set([...r.filter((x) => !gone.has(x)), ...m.filter((x) => !bs.has(x))])];
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
  // Skiing's links stay as they were (#trip=id.key); another sport's carry it at the end (#trip=id.key.hike).
  const tripLink = (t) => `${appBase()}#trip=${t.share.id}.${t.share.key}${K.id === "ski" ? "" : "." + K.id}`;
  function applyDoc(t, d) { for (const k of SHARED()) { if (d[k] === undefined) delete t[k]; else t[k] = d[k]; } }
  let syncing = null, pushTimer = 0;
  async function syncTrip(id, quiet) {
    if (syncing) return syncing.then(() => syncTrip(id, quiet));
    syncing = (async () => {
      const t = tripById(id);
      if (!t || !t.share || t.share.dead) return;
      const sh = t.share, before = K.keyOf ? K.keyOf(t) : "";
      let changed = false;
      try {
        for (let n = 0; n < 4; n++) {
          const r = await rpc("trip_get", { p_id: sh.id, p_key: sh.key });
          if (!r) { sh.err = "the trip was deleted"; break; }
          if (r.data && r.data.moved) { sh.dead = 1; sh.err = "this link doesn't work any more: someone in the group made a new one. Ask them to send it"; break; }
          const mine = docOf(t), merged = merge3(sh.base || {}, mine, r.data || {});
          if (!same(merged, mine)) { applyDoc(t, merged); changed = true; }
          Object.assign(sh, { rev: r.rev, base: r.data, by: r.by || "" });
          if (same(merged, r.data)) { sh.err = ""; sh.at = Date.now(); break; }
          const w = await rpc("trip_put", { p_id: sh.id, p_key: sh.key, p_data: merged, p_rev: r.rev, p_by: meOf(t) });
          if (w && w.ok) { Object.assign(sh, { rev: w.rev, base: merged, err: "", at: Date.now(), by: meOf(t) }); break; }
        }
      } catch (e) { sh.err = e.message || "no signal"; if (!quiet) toast(`Couldn't sync the trip: ${sh.err}.`); }
      putTrip(t, true);
      if (cur && cur.id === t.id) {
        if (cur !== t) Object.assign(cur, t);
        if (!changed) renderOrg("tpGroup", groupHtml, true);   // only the "last synced" line
        else if (typing()) needRender = true;   // never redraw under someone's fingers: once they leave the box
        else { render(); renderPhotos(); }
        if (changed) { drawMap(); if ((K.keyOf ? K.keyOf(cur) : "") !== before) loadDays(cur); }
      }
    })().finally(() => { syncing = null; });
    return syncing;
  }
  const pushSoon = (t) => { if (!t.share) return; clearTimeout(pushTimer); const id = t.id; pushTimer = setTimeout(() => syncTrip(id, true), 1200); };
  async function shareTrip(t) {
    if (t.share && t.share.dead) delete t.share;   // its old link was replaced: sharing again makes a new trip for the group
    if (!t.share) {
      const key = crypto.randomUUID ? crypto.randomUUID() : uid("k"), doc = docOf(t);
      try {
        const id = await rpc("trip_new", { p_key: key, p_data: doc, p_by: meOf(t) });
        t.share = { id, key, rev: 1, base: doc, at: Date.now(), by: meOf(t), err: "" };
        putTrip(t, true);
        if (cur === t) render();
      } catch (e) { toast(`Couldn't share the trip: ${e.message || e}.`); return; }
    }
    const text = `${title(t)} ${K.w.trip}, ${dayWord(t.date)}, ${nightsW(t)}. Open it in Trail Finder to see the lines and add to the packing list, meals and costs:`;
    try {
      if (navigator.share) await navigator.share({ title: `${title(t)} ${K.w.trip}`, text, url: tripLink(t) });
      else { await navigator.clipboard.writeText(`${text}\n${tripLink(t)}`); toast("Link copied: paste it in your group's chat."); }
    } catch (e) { if (!e || e.name !== "AbortError") { try { prompt("Copy this link for your group:", tripLink(t)); } catch {} } }
  }
  // A new link (alex 2026-11-16, taking a friend off a shared trip): the trip goes to a new row with a new key, and the
  // old row keeps only { moved } (no trip in it), so the old link stops working for everyone who has it. The share
  // sheet then opens to send the new link to the people still going.
  async function rekey(t) {
    if (!t.share || !confirm("Make a new link? The old link stops working for everyone, and you send the new one to the people still going.")) return;
    await syncTrip(t.id, true);
    const old = t.share;
    if (old.dead) { toast(`Couldn't make a new link: ${old.err}.`); return; }
    try {
      const key = crypto.randomUUID ? crypto.randomUUID() : uid("k"), doc = docOf(t);
      const id = await rpc("trip_new", { p_key: key, p_data: doc, p_by: meOf(t) });
      let done = false;
      for (let n = 0; n < 4 && !done; n++) {
        const r = await rpc("trip_get", { p_id: old.id, p_key: old.key });
        if (!r) break;
        const w = await rpc("trip_put", { p_id: old.id, p_key: old.key, p_data: { hut: null, moved: 1 }, p_rev: r.rev, p_by: meOf(t) });
        done = !!(w && w.ok);
      }
      if (!done) throw new Error("the old link couldn't be closed");
      t.share = { id, key, rev: 1, base: doc, at: Date.now(), by: meOf(t), err: "", pk: old.pk || old.id };
      putTrip(t, true);
      if (cur === t) render();
      toast("New link made: the old one doesn't work any more.");
    } catch (e) { toast(`Couldn't make a new link: ${e.message || e}.`); return; }
    shareTrip(t);
  }
  // Opening a group's link (#trip=id.key, from ski-points.js): the trip on this phone, kept in sync from then on.
  async function join(id, key) {
    const have = trips().find((x) => x.share && x.share.id === id);
    if (have) { start(have); return; }   // start() syncs it
    try {
      const r = await rpc("trip_get", { p_id: id, p_key: key });
      if (r && r.data && r.data.moved) { toast("This trip link doesn't work any more: someone in the group made a new one. Ask them to send it."); return; }
      if (!r || !r.data || !r.data.date) { toast("This shared trip doesn't exist any more."); return; }
      const t = { id: uid(""), at: Date.now(), ...r.data, share: { id, key, rev: r.rev, base: r.data, at: Date.now(), by: r.by || "", err: "" } };
      // The new link of a trip already on this phone (its old link was replaced): it takes the old copy's place, with
      // this phone's own ticks, trip plan, name and photos.
      const was = trips().find((x) => x.share && x.share.dead && x.date === t.date && title(x) === title(t));
      if (was) {
        for (const k of ["packed", "plan", "me", "meSkip", "offAt", "snap"]) if (was[k] !== undefined) t[k] = was[k];
        t.id = was.id; t.share.pk = was.share.pk || was.share.id;
      }
      putTrip(t, true);
      start(t);
      // A friend's first open: shown once "Before you head out" (risk.js) is agreed to, not hidden under it.
      const hi = () => toast(`You joined the ${title(t)} ${K.w.trip}.`);
      if (window.tfTerms && window.tfTerms.pending) document.addEventListener("tf:terms", () => setTimeout(hi, 400), { once: true }); else hi();
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
      putTrip(t); if (el.dataset.set === "book.done") renderOrg("tpBook", bookHtml); if (el.dataset.set === "name") render(); return;
    }
    if (el.dataset.meal || el.dataset.mealwho) {
      const k = el.dataset.meal || el.dataset.mealwho, f = el.dataset.meal ? "what" : "who", m = { ...(t.meals || {}) }, x = { ...(m[k] || {}) };
      if (el.value.trim()) x[f] = el.value.trim(); else delete x[f];
      if (Object.keys(x).length) m[k] = x; else delete m[k];
      t.meals = m; putTrip(t); return;
    }
    if (el.dataset.pkwho) {   // Who? in the Add an item box
      const f = el.closest("form"), i = f && f.querySelector("input");
      addDraft = { label: i ? i.value : "", who: el.value === "+add" ? addDraft.who : el.value };
      if (el.value !== "+add") { el.classList.toggle("set", !!el.value); return; }
      el.value = addDraft.who; gearFor = "+new";
      t.grpOpen = true; const d = card.querySelector("#tpGroup details"); if (d) d.open = true;
      const g = card.querySelector("[data-gadd] input");
      if (g) { if (window.tfPanelScrollTo) window.tfPanelScrollTo($("tpGroup")); setTimeout(() => g.focus(), 120); }
      toast("Type their name and tap Add: they'll bring the item you're adding.");
      return;
    }
    if (el.dataset.gear && el.value === "+add") {   // a new name for this item: Your group opens with its box ready
      gearFor = el.dataset.gear; el.value = (t.gear || {})[gearFor] || "";
      t.grpOpen = true; const d = card.querySelector("#tpGroup details"); if (d) d.open = true;
      const i = card.querySelector("[data-gadd] input");
      if (i) { if (window.tfPanelScrollTo) window.tfPanelScrollTo($("tpGroup")); setTimeout(() => i.focus(), 120); }
      toast("Type their name and tap Add: it goes on that item.");
      return;
    }
    if (el.dataset.gear) {
      t.gear = { ...(t.gear || {}) };
      if (el.value) t.gear[el.dataset.gear] = el.value; else delete t.gear[el.dataset.gear];
      putTrip(t); renderPack(); return;   // Who brings what follows
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
      if (gearFor === "+new") {   // Who? › Add a name… in the Add an item box: back to the box, with that name picked
        gearFor = ""; addDraft = { ...addDraft, who: n }; putTrip(t); render();
        const a = card.querySelector("[data-pkadd] input");
        if (a) { if (window.tfPanelScrollTo) setTimeout(() => window.tfPanelScrollTo(a.closest("form")), 80); if (!a.value) setTimeout(() => a.focus(), 160); }
        toast(`${n} brings it.`); return;
      }
      if (gearFor) {   // Who? › Add a name…: the new name goes on that item, and you're back at it
        const k = gearFor; gearFor = ""; t.gear = { ...(t.gear || {}), [k]: n }; putTrip(t); render(); toast(`${n} brings it.`);
        const r = card.querySelector(`.tp-pkrow[data-k="${CSS.escape(k)}"]`); if (r && window.tfPanelScrollTo) setTimeout(() => window.tfPanelScrollTo(r), 80); return;
      }
      putTrip(t); render(); const i = card.querySelector("[data-gadd] input"); if (i) i.focus(); return;
    }
    if (f.dataset.cadd) {
      const [w, a] = f.querySelectorAll("input"), by = f.querySelector("select").value, amt = parseFloat(a.value);
      if (!w.value.trim() || !(amt > 0)) { toast("Add what it was for and how much."); return; }
      const on = [...f.querySelectorAll("[data-fsplit][aria-pressed=true]")].map((b) => b.dataset.fsplit);
      t.costs = [...(t.costs || []), { id: uid("c"), what: w.value.trim().slice(0, 40), amt: Math.round(amt * 100) / 100, by, ...(meOf(t) ? { ab: meOf(t) } : {}), ...(on.length && on.length < names(t).length ? { for: on } : {}) }];
      putTrip(t); renderOrg("tpCost", costHtml); return;
    }
    const text = f.querySelector("textarea").value.trim().slice(0, 1000);
    if (!text) return;
    t.notes = [...(t.notes || []), { id: uid("n"), at: Date.now(), by: meOf(t), text }];
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
  card.addEventListener("input", (e) => { if (e.target.matches(".tp-meal textarea")) grow(e.target); if (e.target.matches("[data-pkadd] input")) addDraft.label = e.target.value; });
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches(".tp-meal textarea")) { e.preventDefault(); e.target.blur(); } });
  card.addEventListener("toggle", (e) => { if (e.target.open && e.target.classList.contains("tp-meals")) growAll(); }, true);
  new MutationObserver(() => requestAnimationFrame(growAll)).observe(card, { childList: true, subtree: true });
  function renderOrg(id, f, notTyping) { const el = $(id); if (el && cur && card.contains(el) && !(notTyping && el.contains(document.activeElement))) el.innerHTML = f(cur); }
  let needRender = false;
  const typing = () => { const a = document.activeElement; return !!(a && card.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)); };
  card.addEventListener("focusout", () => setTimeout(() => { if (needRender && cur && !typing()) { needRender = false; render(); renderPhotos(); } }, 150));

  // ---------- drawing the card ----------
  function daysHtml() {
    const v = view;
    if (!v) return `<p class="tp-wait">Loading the forecast for your dates…</p>`;
    if (!v.rows) return `<p class="sk-note">Couldn't load the forecast (${esc(v.err)}).</p>`;
    return K.daysHtml(cur, v);
  }
  function render() {
    const t = cur;
    if (!t) return;
    card.innerHTML = `<div><button type="button" class="sk-x" aria-label="Close">✕</button><h3>${K.w.icon} ${esc(title(t))} <small>${esc(K.w.trip)}</small></h3></div>
      ${iamHtml(t)}
      <label class="tp-mine">Trip name<input type="text" data-set="name" maxlength="40" value="${esc(t.name || "")}" placeholder="${esc(K.namePh(t))}" autocomplete="off"></label>
      <div class="tp-form">
        <label>${esc(K.w.goIn)}<input type="date" data-tp="date" value="${esc(t.date)}"></label>
        <label>Nights<span class="tp-step"><button type="button" data-tp="n-" aria-label="One night less">−</button><b>${t.nights}</b><button type="button" data-tp="n+" aria-label="One night more">+</button></span></label>
        <label>People<span class="tp-step"><button type="button" data-tp="p-" aria-label="One person less">−</button><b>${t.people}</b><button type="button" data-tp="p+" aria-label="One person more">+</button></span></label>
      </div>
      <p class="sk-note">${esc(dayWord(t.date))}${t.nights ? ` to ${esc(dayWord(addDays(t.date, t.nights)))}` : ""}${countdown(t)}</p>
      ${K.baseHtml(t)}
      <div class="sk-sec" id="tpGroup">${groupHtml(t)}</div>
      ${K.midHtml(t)}
      <div class="sk-sec tp-lines" id="tpLines"><h4>${esc(K.w.lines)}</h4>${linesHtml(t)}</div>
      ${K.afterLinesHtml ? K.afterLinesHtml(t) : ""}
      <div class="sk-sec" id="tpPack">${packHtml(t)}</div>
      <div class="sk-sec" id="tpMeals">${mealsHtml(t)}</div>
      <div class="sk-sec" id="tpBook">${bookHtml(t)}</div>
      <div class="sk-sec" id="tpCost">${costHtml(t)}</div>
      <div class="sk-sec" id="tpPlan">${planHtml(t)}</div>
      <div class="sk-sec" id="tpJour">${journalHtml(t)}</div>
      <div class="sk-sec"><div class="tp-btns"><button type="button" data-tp="off" ${offPts(t).length ? "" : "disabled"}>⤓ ${offSaved(t) ? "Change the saved area" : "Save the trip offline"}</button>${K.baseBtn ? K.baseBtn(t) : ""}<button type="button" data-tp="del">🗑 ${t.share ? "Leave this trip" : "Delete"}</button></div>
        <p class="sk-note" id="tpOff">${offHtml(t)}</p>
        ${K.hasDays(t) && localDate(new Date()) < t.date ? `<div class="tp-btns"><button type="button" data-tp="beforeics">⏰ Remind me the day before</button></div><p class="sk-note">From the day before the trip, each time you open the app with signal, ${esc(K.w.updates)} update by themselves. The app can't do it while it's closed: the reminder is a calendar alert the evening before that tells you to open it.</p>` : ""}</div>`;
    if (K.afterRender) K.afterRender(t);   // every redraw (a name added, a night more...) brings the kit's lists back, not a spinner
  }
  // Where the trip's offline save is, from Offline maps itself (offline.js status, PR #544): saving, saved, or not
  // finished with files missing (alex saw "Saved offline" with 2 files missing). Missing files retry on their own.
  const offName = (t) => `${K.w.offPrefix}${K.offBase(t)}`;   // renaming the trip keeps its offline save
  const day = (ms) => esc(new Date(ms).toLocaleDateString("en-CA", { month: "short", day: "numeric" }));
  // What the save starts around: the trip's place, what the kit adds and every line of the trip.
  const offPts = (t) => [...(K.extraPts ? K.extraPts(t) : []), ...(t.hut ? [[t.hut.lat, t.hut.lon]] : []), ...linesOf(t).flatMap((x) => x.ls.flat())];
  const offSt = (t) => (window.tfOffline && window.tfOffline.status ? window.tfOffline.status(offName(t)) : null);
  const offSaved = (t) => { const st = offSt(t); return !!(st && st.state !== "saving"); };
  // Lines or places added after the save that go past the saved square.
  const offOut = (t, b) => !!b && offPts(t).some(([la, lo]) => la < b[0] || lo < b[1] || la > b[2] || lo > b[3]);
  function offHtml(t) {
    const st = offSt(t), W = K.w;
    if (st && st.state !== "saving" && offOut(t, st.box)) return `<b style="color:#c92a2a">Some of your trip is outside the saved area</b> (${esc(W.offOut)}). Tap Change the saved area to take it in.`;
    if (st && st.state === "saving") return `<b>Saving offline… ${Math.round(st.pct || 0)}%</b> Keep the app open until it's done.`;
    if (st && st.state === "missing") return `<b style="color:#c92a2a">Not finished: ${st.missing} file${st.missing === 1 ? "" : "s"} still missing.</b> They download again by themselves when you have signal; don't count on this trip offline until it says Saved.`;
    if (st && st.state === "saved") return `<b>Saved offline ${day(st.at || t.offAt)}</b>: ${esc(W.offSaved)} in the square you picked work with no signal${t.offFresh ? `; ${esc(W.offFresh)} updated ${esc(when(t.offFresh))}` : ""}; the forecast above is kept as it was when last checked. The trip stays on this phone.`;
    if (t.offAt && window.tfOffline && window.tfOffline.status) return `Not saved offline any more (it was deleted from Offline maps). Save it again for no signal.`;
    return `Saves ${esc(W.offWhat)}, and keeps this forecast, for no signal. The trip stays on this phone.`;
  }
  window.addEventListener("tf:offline", (e) => {
    const d = e.detail || {};
    // The save started (not just the square opened): the trip counts as saved offline from here (✓ in the packing list).
    if (d.state === "saving") { const t = trips().find((x) => offName(x) === d.name); if (t && !t.offAt) { t.offAt = Date.now(); putTrip(t); if (cur && cur.id === t.id) cur.offAt = t.offAt; } }
    if (cur && d.name === offName(cur)) { const el = $("tpOff"); if (el && card.contains(el)) el.innerHTML = offHtml(cur); const b = card.querySelector('[data-tp="off"]'); if (b) b.textContent = `⤓ ${offSaved(cur) ? "Change the saved area" : "Save the trip offline"}`; }
  });
  const part = (id) => { const el = $(id); return el && card.contains(el) ? el : null; };   // this sport's card's own part (every sport's card has the same ids)
  const renderDays = () => { const el = cur && part("tpDays"); if (el) el.innerHTML = `<h4>Each day</h4>${daysHtml()}`; renderPack(); };
  const renderLines = () => { const el = cur && part("tpLines"); if (el) el.innerHTML = `<h4>${esc(K.w.lines)}</h4>${linesHtml(cur)}`; };
  const renderPack = () => { const el = cur && part("tpPack"); if (el) el.innerHTML = packHtml(cur); };
  const renderPlan = () => { const el = cur && part("tpPlan"); if (el) el.innerHTML = planHtml(cur); };
  card.addEventListener("toggle", (e) => {   // keep the packing list / trip plan open across redraws
    if (!cur) return;
    if (e.target.closest("#tpPack")) cur.packOpen = e.target.open;   // the other sections share .tp-pack for its look
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
  // ☰ on a journal note: drag it up or down; the group gets the same order.
  if (window.tfDragSort) window.tfDragSort(card, { list: ".tp-notes", row: ".tp-notei", done: (rows) => {
    const t = cur; if (!t) return;
    t.nOrd = rows.map((r) => r.dataset.nid); putTrip(t);
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
  // "Who are you?" in a shared trip: tap your name, or add yourself to the group. Kept on this phone (t.me).
  const iam = (t, k) => { const x = (t.group || []).find((y) => y.k === k); if (!x) return; t.me = k; delete t.meSkip; store.set("tripMe", { ...me(), name: x.n }); putTrip(t, true); render(); renderPhotos(); };
  card.addEventListener("click", (e) => {
    const b = e.target.closest("[data-iam],[data-iamskip]"), t = cur;
    if (!b || !t) return;
    if (b.dataset.iam) { iam(t, b.dataset.iam); toast(`Got it: what you add shows "added by ${(t.group.find((y) => y.k === t.me) || {}).n}".`); return; }
    t.meSkip = 1; putTrip(t, true); const el = $("tpIam"); if (el) el.remove();
  });
  card.addEventListener("change", (e) => {
    const el = e.target, t = cur;
    if (!el.dataset.iamsel || !t) return;
    if (el.value) iam(t, el.value); else { delete t.me; t.meSkip = 1; putTrip(t, true); }
  });
  card.addEventListener("submit", (e) => {
    if (!e.target.dataset.iamadd || !cur) return;
    e.preventDefault();
    const t = cur, n = e.target.querySelector("input").value.trim().replace(/\s+/g, " ").slice(0, 30);
    if (!n) return;
    const have = (t.group || []).find((x) => x.n.toLowerCase() === n.toLowerCase());
    if (have) { iam(t, have.k); return; }
    const k = uid("g");
    t.group = [...(t.group || []), { k, n }];
    if (t.group.length > t.people) t.people = t.group.length;
    putTrip(t);   // the new name goes to the group
    iam(t, k);
    toast(`Added you to the group as ${n}.`);
  });
  card.addEventListener("submit", (e) => {   // + Add an item: on this trip and the next ones
    if (!e.target.dataset.pkadd || !cur) return;
    e.preventDefault();
    const t = cur, label = e.target.querySelector("input").value.trim().replace(/\s+/g, " ").slice(0, 80), lab = label.toLowerCase();
    if (!label) return;
    if ((t.own || []).some((y) => y.label.toLowerCase() === lab)) { toast("It's on the list already."); return; }
    const x = { k: "my_" + Date.now().toString(36), label }, who = addDraft.who;
    t.own = [...(t.own || []), meOf(t) ? { ...x, ab: meOf(t) } : x];
    if (who) t.gear = { ...(t.gear || {}), [x.k]: who };   // who brings it is for this trip only, not the next ones
    addDraft = { label: "", who: "" };
    tplSet((v) => ({ ...v, own: v.own.some((y) => y.label.toLowerCase() === lab) ? v.own : [...v.own, x] }));
    putTrip(t); renderPack();
    if (who) toast(`${who} brings it.`);
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
    cur.date = e.target.value; putTrip(cur); render(); loadDays(cur); if (K.datesChanged) K.datesChanged(cur);
  });
  const slug = (t) => title(t).replace(/[^\w]+/g, "-").toLowerCase();
  card.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tp], .sk-x");
    if (!b || !cur) return;
    const t = cur, k = b.dataset.tp;
    if (b.classList.contains("sk-x")) { close(); return; }
    if (k === "n-" || k === "n+") { t.nights = Math.max(K.minNights == null ? 1 : K.minNights, Math.min(10, t.nights + (k === "n+" ? 1 : -1))); putTrip(t); render(); loadDays(t); if (K.datesChanged) K.datesChanged(t); }
    else if (k === "p-" || k === "p+") { t.people = Math.max(1, Math.min(40, t.people + (k === "p+" ? 1 : -1))); putTrip(t); render(); }
    else if (k === "packshare") {
      const done = packDone(t), left = packList(t).map(([h, items]) => [h, items.filter((x) => !done[x[0]] && !/^(offline|plan)$/.test(x[0]))]).filter((x) => x[1].length);
      const gr = t.gear || {};
      shareText(`Packing for ${title(t)}`, `Packing for ${title(t)}, ${dayWord(t.date)}, ${nightsW(t)}:\n` + left.map(([h, items]) => `\n${h}\n${items.map((x) => `- ${x[1]}${gr[x[0]] ? ` (${gr[x[0]]})` : ""}`).join("\n")}`).join("\n"));
    } else if (k === "packclear") { t.packed = {}; putTrip(t); renderPack(); }
    else if (k === "share" || k === "sharelink") shareTrip(t);
    else if (k === "syncnow") syncTrip(t.id);
    else if (k === "rekey") rekey(t);
    else if (k === "gpx") shareFile(tripGpx(t), `${slug(t)}-trip.gpx`, "application/gpx+xml", `Saved the GPX of your ${title(t)} trip.`);
    else if (k === "beforeics") shareFile(dayBeforeIcs(t), `before-${slug(t)}.ics`, "text/calendar", `Saved the reminder: open it to add it to your calendar.`);
    else if (k === "bookics") shareFile(bookIcs(t), `book-${slug(t)}.ics`, "text/calendar", `Saved the reminder: open it to add it to your calendar.`);
    else if (k === "mealshare") {
      const m = t.meals || {}, rows = tripDates(t).map((d) => [d, MEALS.map(([mk, lab]) => [lab, m[`${d}:${mk}`]]).filter((x) => x[1] && (x[1].what || x[1].who))]).filter((x) => x[1].length);
      if (!rows.length) { toast("No meals typed in yet."); return; }
      shareText(`Meals for ${title(t)}`, `Meals for ${title(t)}:\n` + rows.map(([d, l]) => `\n${dayWord(d)}\n${l.map(([lab, x]) => `- ${lab}: ${x.what || "?"}${x.who ? ` (${x.who})` : ""}`).join("\n")}`).join("\n"));
    }
    else if (k === "packback") { t.hide = []; tplSet((v) => ({ ...v, hide: [] })); putTrip(t); renderPack(); }
    else if (k === "fitall") { const bb = tripBounds(t); if (bb) map.fitBounds(bb, { padding: [30, 30], maxZoom: 15 }); if (window.tfSnapTo) window.tfSnapTo("peek"); }
    else if (k === "plansend" || k === "planics") {
      const pl = planOf(t);
      if (new Date(pl.help) <= new Date(pl.out)) { toast("Call for help at must be after your out time."); return; }
      const go = k === "plansend" ? shareText(`Trip plan: ${title(t)}`, K.planText(t, pl))
        : shareFile(alertIcs(t), `trip-alert-${slug(t)}.ics`, "text/calendar", `Add this to your calendar: it rings at ${when(pl.help)} if you haven't heard from ${pl.who || "me"}.`);
      go.then((ok) => { if (!ok) return; t.plan = { ...(t.plan || {}), who: pl.who, car: pl.car, friend: pl.friend, out: pl.out, help: pl.help, sent: t.plan && t.plan.sent || Date.now(), safe: 0 }; putTrip(t); renderPlan(); renderPack(); });
    } else if (k === "safe") {
      const pl = planOf(t);
      shareText("Out safe", `${pl.who || "We"}: out safe from ${title(t)}, back at the car ${when(Date.now())}. You can delete the late alert.`)
        .then((ok) => { if (!ok) return; t.plan = { ...(t.plan || {}), safe: Date.now() }; putTrip(t); renderPlan(); });
    } else if (k === "live" && window.tfLive) window.tfLive.open();
    else if (k === "del") {
      if (!confirm(t.share ? `Take the ${title(t)} trip off your phone? The rest of the group keeps it.` : `Delete your trip to ${title(t)}?`)) return;
      if (window.tfAccount && window.tfAccount.gone) window.tfAccount.gone(K.key, t.id);   // so the account doesn't bring it back
      store.set(K.key, trips().filter((x) => x.id !== t.id)); close();
    } else if (k === "off") {
      // The square to save opens on the map, around the trip, to move and resize before saving (alex 2026-11-11).
      if (!window.tfOffline || !window.tfOffline.pickBox) { toast("Offline maps aren't available in this browser."); return; }
      const ll = offPts(t); if (!ll.length) return;
      const st = offSt(t), b0 = [Math.min(...ll.map((p) => p[0])), Math.min(...ll.map((p) => p[1])), Math.max(...ll.map((p) => p[0])), Math.max(...ll.map((p) => p[1]))];
      const box = st && st.box && !offOut(t, st.box) ? st.box : b0;   // changing it: start from the square saved, if the trip still fits in it
      window.tfOffline.pickBox(box, offName(t), { replace: true, exact: box !== b0 });
    } else if (K.onTp) K.onTp(k, t, b);
  });

  // The trips list (the sport's trip button): your trips, and places near the middle of the map to start one.
  function showList(quiet) {
    close();
    card.hidden = false; btn.setAttribute("aria-pressed", "true");
    const mine = trips();
    card.innerHTML = `<div><button type="button" class="sk-x" aria-label="Close">✕</button><h3>${K.w.icon} ${esc(K.w.Trips)}</h3></div>
      <button type="button" class="sk-tripgo" data-newtrip="1">＋ Start a new trip</button>
      ${window.tfTutorials && K.tutorial ? window.tfTutorials.button(K.tutorial) : ""}
      ${mine.length ? `<ul class="tp-list">${mine.map((t) => `<li><button type="button" data-trip="${esc(t.id)}"><span>${esc(title(t))}${t.share ? " 👥" : ""}</span><small>${late(t) ? `<b class="tp-late-tag">Overdue</b> ` : ""}${esc(dayWord(t.date))} · ${nightsW(t)}${(t.lines || []).length ? ` · ${t.lines.length} line${t.lines.length > 1 ? "s" : ""}` : ""}${K.listInfo ? esc(K.listInfo(t)) : ""}</small></button></li>`).join("")}</ul>` : ""}
      <p class="sk-note">${K.listNote()}</p>
      <ul class="tp-list" id="tpNear"><li><p class="tp-wait">${esc(K.w.finding)}</p></li></ul>`;
    if (!quiet) scrollTo();
    if (K.nearList) K.nearList();
  }
  card.addEventListener("click", (e) => {
    const n = e.target.closest("[data-newtrip]");
    if (n) { const t = newTrip(); start(t); setTimeout(() => { const i = card.querySelector('[data-set="name"]'); if (i) i.focus(); }, 300); return; }
    const a = e.target.closest("[data-trip]");
    if (!a) return;
    const t = trips().find((x) => x.id === a.dataset.trip); if (t) start(t);
  });
  card.addEventListener("click", (e) => { if (!cur && e.target.closest(".sk-x")) close(); });
  btn.addEventListener("click", () => { if (btn.getAttribute("aria-pressed") === "true") close(); else showList(); });

  // ---------- the kit ----------
  // What the engine gives the sport's kit, and what the kit gives back (cabin-trip.js has every part):
  //  id, key (the trips' store key), packKey, color, lineColor, pane (the Leaflet pane), w (words), groupGear,
  //  isOn(), mount(card, btn), title(t), namePh(t), start(t), hasDays(t), snapOf(t), daysHtml(t, view),
  //  packItems(t, view), planText(t, pl), bookTop(t), bookSite(t), bookWhat(t), costHint(t), baseHtml(t), midHtml(t),
  //  linesEmpty(t), drawLabel(t), openLine(t, x), listNote(), offBase(t); and if it has them: shared (more fields for
  //  the group), newTrip(), close(), afterLinesHtml(t), afterRender(t), baseBtn(t), linesTop(t), linesChanged(t),
  //  canEdit, editLine(t, id), openWay(t), drawExtra(t, layer), extraPts(t), gpxExtra(t, trk, wpt), keyOf(t) (what
  //  makes the forecast change), offUrls(box), onTp(k, t, button), datesChanged(t), nearList(), tutorial, minNights (0 lets
  //  a trip be one day), listInfo(t) (more words on the trip's row in the list).
  const E = {
    map, card, btn, layer, $, esc, store, toast, uid, localDate, addDays, dayWord, fmtM, fmtH, deg, when, tripDates,
    cur: () => cur, view: () => view, daysHtml, setView: (v) => { view = v; }, trips, putTrip, tripById, start, close, render, renderDays, renderLines, renderPack,
    drawMap, scrollTo, loadDays, addLine, dropLine, linesOf, sameLine, offerAdd, meOf, byHtml, newTrip, showList, offSt, part, names, nightsW, shareText, renderOrg,
  };
  K = make(E);
  card.id = K.cardId || "tpCard";
  card.style.setProperty("--tp", K.color);
  card.style.setProperty("--tpl", K.lineColor);
  btn.textContent = K.w.btn; btn.title = K.w.btnTitle;
  if (K.mount(card, btn) === false) return null;
  setTimeout(refreshAhead, 4000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshAhead(); });
  window.addEventListener("online", () => refreshAhead());
  window.addEventListener("tf:sport", () => { if (!K.isOn()) close(); else if (cur) drawMap(); });
  { const o = trips().find(late); if (o) setTimeout(() => toast(`Past your out time from ${title(o)}: open ${K.w.btn} and tap We're out safe.`), 2500); }
  // Trips from the rider's other devices (account.js): the list shows them, and an open trip changed or deleted there follows.
  window.addEventListener("tf:settings-synced", (e) => {
    if (!e.detail.includes(K.key) || card.hidden) return;
    if (!cur) { showList(true); return; }
    const t = trips().find((x) => x.id === cur.id);
    if (!t) close();
    else if ((t.ed || 0) > (cur.ed || 0)) { cur = t; view = null; render(); drawMap(); loadDays(t); }
  });
  // Signing in reloads the page once to show the account's settings: the trip you were planning opens again, with
  // everything you'd done (trips are saved as you go, and the account keeps both this phone's and its own trips).
  { let o = null; try { o = sessionStorage.getItem("tf:tripOpen"); } catch {}
    const t = o && trips().find((x) => x.id === o);
    if (t && K.isOn()) setTimeout(() => { if (!cur && K.isOn()) start(t); }, 1500); }
  const api = { start, list: showList, close, count: () => trips().length, join: (id, key) => join(id, key), offerAdd, cur: () => cur, newTrip };
  window.tfTrips = window.tfTrips || {};
  window.tfTrips[K.id] = api;
  return api;
};
