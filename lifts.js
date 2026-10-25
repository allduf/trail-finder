// Live lift status in Skiing (alex 2026-10-25: "add lift status on the active map. green open orange standby and red
// close", and "when you click on the chair lift on the map show an information box with what you think is important like
// the waiting time"). Every lift of the resorts in the app is drawn on the flat map and the 3D map, coloured by the
// resort's own live status: green open, orange on standby / on hold, red closed, grey when the resort doesn't publish
// one we can read. Tapping a lift opens a box: status, wait time, hours, what kind of lift, length, vertical, ride time,
// and the runs that start at its top.
// Lifts: data/ski-lifts.json (scripts/build-ski-lifts.mjs, from OpenStreetMap). Status: the Supabase function
// "lift-status" (supabase/functions/lift-status), which reads each resort's own lift status page; the browser can't
// read most resort sites itself. Read every 3 minutes while the map shows lifts, only for the resorts near the map.
// A "Lift status" switch in the Resorts group of the Skiing layers turns it on and off (on by default).
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const isSki = () => document.body.classList.contains("sport-ski");
  const FN = "lift-status";   // the Supabase function's name
  const EVERY = 3 * 60e3;
  let on = true;
  try { on = localStorage.getItem("tf:skiLifts") !== "false"; } catch {}

  const C = { open: "#2f9e44", hold: "#f08c00", closed: "#e03131", scheduled: "#e03131", unknown: "#868e96", none: "#868e96" };
  const WORD = { open: "Open", hold: "Standby / on hold", closed: "Closed", scheduled: "Opens later today", unknown: "Status not given", none: "No live status" };
  const KIND = { gondola: "Gondola", cable_car: "Cable car (tram)", chair_lift: "Chairlift", mixed_lift: "Chairlift and gondola", "t-bar": "T-bar", "j-bar": "J-bar",
    platter: "Platter (Poma)", drag_lift: "Drag lift", rope_tow: "Rope tow", magic_carpet: "Magic carpet" };
  const DIFF = { novice: ["●", "#2f9e44"], easy: ["●", "#2f9e44"], intermediate: ["■", "#1971c2"], advanced: ["◆", "var(--fg)"], expert: ["◆◆", "var(--fg)"], freeride: ["◆", "#d9480f"], extreme: ["◆◆", "#c92a2a"] };

  const css = document.createElement("style");
  css.textContent = `
.lm-ski .sk-slot button .lf-upd { display: block; color: var(--muted); font-size: .74rem; line-height: 1.25; font-weight: 400; }
dialog.lf-dlg { border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: var(--fg); padding: 14px 14px 12px; width: min(440px, calc(100vw - 24px)); max-height: calc(100dvh - 24px); overflow: auto; box-shadow: 0 10px 40px rgba(0,0,0,.3); font: inherit; }
dialog.lf-dlg::backdrop { background: rgba(0,0,0,.45); }
dialog.lf-dlg h2 { margin: 0 40px 2px 0; font-family: var(--font-display); font-size: 1.25rem; overflow-wrap: anywhere; }
dialog.lf-dlg .lf-sub { margin: 0 0 10px; color: var(--muted); font-size: .86rem; }
dialog.lf-dlg .lf-x { position: absolute; top: 10px; right: 10px; width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font-size: 18px; cursor: pointer; }
dialog.lf-dlg .lf-state { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 12px; background: color-mix(in srgb, var(--c) 14%, transparent); border: 1px solid color-mix(in srgb, var(--c) 45%, transparent); }
dialog.lf-dlg .lf-state i { width: 14px; height: 14px; border-radius: 50%; background: var(--c); flex: none; }
dialog.lf-dlg .lf-state b { font-size: 1.05rem; }
dialog.lf-dlg .lf-state span { margin-left: auto; text-align: right; font-size: .86rem; }
dialog.lf-dlg .lf-state span strong { display: block; font-size: 1.15rem; }
dialog.lf-dlg dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 12px 0 0; font-size: .9rem; }
dialog.lf-dlg dt { color: var(--muted); }
dialog.lf-dlg dd { margin: 0; font-weight: 600; }
dialog.lf-dlg h3 { margin: 14px 0 6px; font-size: .9rem; }
dialog.lf-dlg .lf-runs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
dialog.lf-dlg .lf-runs li { font-size: .82rem; padding: 4px 9px; border-radius: 999px; border: 1px solid var(--line); background: var(--chip); }
dialog.lf-dlg .lf-runs li i { font-style: normal; margin-right: 4px; color: var(--d); }
dialog.lf-dlg .lf-foot { margin: 12px 0 0; font-size: .8rem; color: var(--muted); }
dialog.lf-dlg .lf-foot a { color: var(--accent); font-weight: 600; }
.sk-key .lf-kline { display: inline-block; width: 22px; height: 5px; border-radius: 3px; vertical-align: middle; box-shadow: 0 0 0 1.5px #fff; }
`;
  document.head.appendChild(css);

  // ---------- data ----------
  let data = null, lifts = [], resorts = {};
  const load = () => (data = data || fetch("data/ski-lifts.json?v=387").then((r) => r.json()).then((d) => {
    resorts = d.resorts || {}; lifts = d.lifts || [];
    return d;
  }).catch(() => { data = null; return null; }));
  // Live status, per resort: { t, lifts: [{ n, s, w, o, c }], err } from the function, and when we got it.
  const live = {};
  let gotAt = 0, liveErr = "", timer = 0, busy = false;
  const near = () => {
    const b = map.getBounds().pad(0.5);
    return Object.entries(resorts).filter(([, r]) => r.live && b.contains([r.lat, r.lon])).map(([id]) => id);
  };
  async function poll(force) {
    clearTimeout(timer);
    if (!shown()) return;
    timer = setTimeout(() => poll(), EVERY);
    if (document.hidden || busy) return;
    const ids = near().filter((id) => force || !live[id] || Date.now() - live[id].at > EVERY - 5000);
    if (!ids.length) { draw(); return; }
    const acct = window.tfAccount;
    if (!acct || !acct.url) { liveErr = "Live status is not set up"; draw(); return; }
    busy = true;
    try {
      // A plain GET with no extra headers, so the browser doesn't have to ask first.
      const r = await fetch(`${acct.url}/functions/v1/${FN}?r=${ids.join(",")}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      for (const [id, v] of Object.entries(d.resorts || {})) live[id] = { ...v, at: Date.now() };
      gotAt = Date.now(); liveErr = "";
    } catch (e) {
      liveErr = gotAt ? "Couldn't reach the lift status: tries again in 3 min" : "Live status isn't available yet";
    } finally { busy = false; }
    draw();
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && shown() && Date.now() - gotAt > EVERY) poll(); });
  map.on("moveend", () => { if (shown() && near().some((id) => !live[id])) poll(); });

  const norm = (s) => String(s || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  // The resort's status for one lift: by the name the build matched (st), else by the same name.
  function statusOf(l) {
    const v = live[l.r];
    if (!resorts[l.r] || !resorts[l.r].live) return { s: "none" };
    if (!v || !v.lifts) return { s: "none", wait: true };
    const st = norm(l.st || l.n), x = v.lifts.find((y) => norm(y.n) === st);
    return x ? { ...x, t: v.t } : { s: "none", t: v.t };
  }
  // Every lift of a resort closed and no update for 5 days: the resort is closed for the season.
  const season = (id) => { const v = live[id]; return !!(v && v.lifts && v.lifts.length && v.lifts.every((x) => x.s === "closed") && v.t && Date.now() - Date.parse(v.t) > 5 * 864e5); };

  // ---------- Layers switch ----------
  const btn = document.createElement("button");
  btn.type = "button"; btn.id = "liftsBtn";
  btn.title = "Every lift at the ski resorts, coloured by the resort's live lift status: green open, orange standby, red closed. Tap a lift for its wait time and details";
  btn.textContent = "🚡 Lift status";
  function placeBtn() {
    if (btn.isConnected) return true;
    return !!window.tfSkiSlot && window.tfSkiSlot("resort", btn, { label: "Lift status", sym: "🚡", bg: `linear-gradient(135deg, ${C.open} 33%, ${C.hold} 33% 66%, ${C.closed} 66%)` }) && (setNote(), true);
  }
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  function noteText() {
    if (!on) return "";
    if (liveErr) return liveErr;
    return gotAt ? `Updated ${ago(gotAt)}` : near().length ? "Getting the live status…" : "Live for 9 resorts";
  }
  function setNote() {
    const b = btn.querySelector("b"); if (!b) return;
    let s = b.querySelector(".lf-upd");
    if (!s) { s = document.createElement("small"); s.className = "lf-upd"; b.append(s); }
    s.textContent = noteText();
  }
  function setBtn() { btn.setAttribute("aria-pressed", String(on)); btn.classList.toggle("on", on); setNote(); }
  btn.addEventListener("click", () => {
    on = !on;
    try { localStorage.setItem("tf:skiLifts", String(on)); } catch {}
    sync();
  });
  setInterval(() => { if (shown()) { setNote(); keyRender(); } }, 60e3);   // keeps "updated X min ago" right

  // ---------- the map key ----------
  (window.tfSkiKeyExtra = window.tfSkiKeyExtra || []).push(() => {
    if (!shown()) return "";
    const li = (c, t) => `<li><span class="sk-kic"><i class="lf-kline" style="background:${c}"></i></span>${t}</li>`;
    return li(C.open, "Lift open") + li(C.hold, "Lift on standby / on hold") + li(C.closed, "Lift closed") + li(C.none, "Lift, no live status")
      + `<li class="lg-note" style="list-style:none">Lift status ${esc(liveErr ? liveErr.toLowerCase() : gotAt ? "updated " + ago(gotAt) : "loading")}, from each resort's own lift report</li>`;
  });
  const keyRender = () => { if (window.tfSkiKeyRender) window.tfSkiKeyRender(); };

  // ---------- drawing ----------
  // The 3D map copies these lines and their taps from the flat map (map3d.js), so they're only drawn here.
  map.createPane("lifts").style.zIndex = 430;   // over the ski runs (420)
  const renderer = L.canvas({ pane: "lifts", padding: 0.3, tolerance: 12 });   // wide enough to tap a lift with a finger
  const layer = L.layerGroup();
  let selected = null;
  const colorOf = (l) => C[statusOf(l).s] || C.none;
  function draw() {
    layer.clearLayers();
    setNote(); keyRender();
    if (!shown()) return;
    const small = map.getZoom() < 12;
    for (const l of lifts) {
      if (small && /^(magic_carpet|rope_tow)$/.test(l.k)) continue;
      const c = colorOf(l), sel = selected === l, st = statusOf(l);
      const sched = st.s === "scheduled";
      layer.addLayer(L.polyline(l.g, { renderer, color: "#fff", weight: sel ? 10 : 7, opacity: 0.95, interactive: false }));
      const ln = L.polyline(l.g, { renderer, color: sel ? "#ffe14d" : c, weight: sel ? 6 : 4, opacity: 1, dashArray: sched ? "8 6" : null });
      ln.bindTooltip(`${esc(l.n || KIND[l.k] || "Lift")}: ${esc(WORD[st.s])}${st.w > 0 && st.s === "open" ? `, ${st.w} min wait` : ""}`, { sticky: true });
      ln.on("click", (e) => { L.DomEvent.stopPropagation(e); open(l); });
      layer.addLayer(ln);
      if (!small) for (const p of [l.g[0], l.g[l.g.length - 1]]) layer.addLayer(L.circleMarker(p, { renderer, radius: 3.5, color: "#fff", weight: 1.5, fillColor: c, fillOpacity: 1, interactive: false }));
    }
  }
  let zBand = map.getZoom() >= 12;
  map.on("zoomend", () => { const b = map.getZoom() >= 12; if (b !== zBand) { zBand = b; if (shown()) draw(); } });
  const shown = () => on && isSki() && lifts.length > 0;
  async function sync() {
    placeBtn(); setBtn();
    if (on && isSki()) await load();
    const want = shown();
    if (want && !map.hasLayer(layer)) layer.addTo(map);
    if (!want && map.hasLayer(layer)) map.removeLayer(layer);
    draw();
    if (want) poll(); else clearTimeout(timer);
  }

  // ---------- the lift's box ----------
  const dlg = document.createElement("dialog");
  dlg.className = "lf-dlg";
  dlg.setAttribute("aria-label", "Lift details");
  document.body.appendChild(dlg);
  const fmtLen = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
  const fmtT = (s) => String(s).replace(/^0(\d)/, "$1").replace(/\s+/g, "").toLowerCase();
  // Ride time: the mapped one, else from usual speeds (gondolas and fast chairs about 5 m/s, fixed chairs 2.3 m/s).
  function rideMin(l) {
    if (l.dur) { const m = /^(\d+)(?::(\d+))?/.exec(l.dur); if (m) return Math.max(1, Math.round(+m[1] + (+m[2] || 0) / 60)); }
    const v = /gondola|cable_car|mixed/.test(l.k) ? 5.5 : l.k === "chair_lift" ? (l.fast || /express/i.test(l.n) ? 5 : 2.3) : /bar|platter|drag/.test(l.k) ? 3 : 1;
    return Math.max(1, Math.round(l.len / v / 60));
  }
  function kindText(l) {
    const seats = +l.seats > 0 ? (l.k === "gondola" || l.k === "cable_car" ? `${l.seats}-person cabins` : `${l.seats} seats`) : "";
    const fast = l.k === "chair_lift" && (l.fast || /express/i.test(l.n)) ? "high-speed" : "";
    return [KIND[l.k] || "Lift", [seats, fast, l.bubble ? "bubble" : "", l.heated ? "heated" : ""].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  }
  function open(l) {
    selected = l;
    const r = resorts[l.r] || {}, st = statusOf(l), v = live[l.r];
    const c = C[st.s] || C.none, waiting = st.s === "none" && st.wait && !liveErr;
    const wait = st.w != null && st.s === "open" ? (st.w > 0 ? `<span><strong>${st.w} min</strong>wait</span>` : `<span><strong>No wait</strong>walk on</span>`) : "";
    const hours = st.o || st.c ? `${st.o ? fmtT(st.o) : "?"} – ${st.c ? fmtT(st.c) : "?"}` : "";
    const why = st.s !== "none" ? "" : !r.live ? `${esc(r.name || "This resort")} doesn't publish a lift status the app can read yet.` : liveErr ? esc(liveErr) + "." : waiting ? "Getting the live status…" : "This lift isn't in the resort's lift report.";
    const seasonNote = season(l.r) ? `<p class="lf-sub" style="margin:8px 0 0">Closed for the season: the resort's last lift report was ${esc(new Date(v.t).toLocaleDateString(undefined, { month: "short", day: "numeric" }))}.</p>` : "";
    const runs = (l.runs || []).map(([n, d]) => { const x = DIFF[d]; return `<li>${x ? `<i style="--d:${x[1]}" aria-label="${esc(d)}">${x[0]}</i>` : ""}${esc(n)}</li>`; }).join("");
    const rows = [
      ["Lift", kindText(l)],
      hours && [season(l.r) ? "Usual hours" : "Hours today", hours],
      l.len && ["Length", fmtLen(l.len)],
      l.hi != null && ["Vertical", `${Math.max(0, l.hi - l.lo).toLocaleString()} m (${l.lo.toLocaleString()} → ${l.hi.toLocaleString()} m)`],
      l.len && ["Ride", `about ${rideMin(l)} min`],
      +l.cap > 0 && ["Carries", `${(+l.cap).toLocaleString()} people an hour`],
    ].filter(Boolean);
    dlg.innerHTML = `<button type="button" class="lf-x" aria-label="Close">✕</button>
      <h2>${esc(l.n || KIND[l.k] || "Lift")}</h2>
      <p class="lf-sub">${esc(r.name || "")}</p>
      <div class="lf-state" style="--c:${c}"><i></i><div><b>${esc(WORD[st.s])}</b>${why ? `<div class="lf-sub" style="margin:2px 0 0">${why}</div>` : ""}</div>${wait}</div>
      ${seasonNote}
      <dl>${rows.map(([a, b]) => `<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join("")}</dl>
      ${runs ? `<h3>Runs from the top</h3><ul class="lf-runs">${runs}</ul>` : ""}
      <p class="lf-foot">${st.t || (v && v.t) ? `Resort's lift report updated ${esc(ago(Date.parse(st.t || v.t)))}${gotAt ? `, checked ${esc(ago(gotAt))}` : ""}. ` : ""}${r.page ? `<a href="${esc(r.page)}" target="_blank" rel="noopener">${esc(r.name)} lift status ↗</a>` : ""}<br>Lift line, length and heights from OpenStreetMap.</p>`;
    dlg.querySelector(".lf-x").onclick = () => dlg.close();
    if (!dlg.open) dlg.showModal();
    draw();
  }
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => { selected = null; draw(); });

  let lastSki = isSki();
  new MutationObserver(() => { if (isSki() !== lastSki) { lastSki = isSki(); sync(); } }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(() => { if (!btn.isConnected) placeBtn(); }).observe($("layersMenu") || document.body, { childList: true, subtree: true });
  window.tfLifts = { open: (name) => load().then(() => { const l = lifts.find((x) => x.n === name); if (l) open(l); }), poll: () => poll(true), _l: (name) => lifts.find((x) => x.n === name) };
  sync();
})();
