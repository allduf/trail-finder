// My hunts (alex, 2026-10-26: "My rides" is a bike thing, Hunting needs its own). Each walk tracked in Hunting is saved
// with sport "hunt" in the same IndexedDB as My rides (navigate.js, ride.html). The Hunting log (ski-points.js) shows
// them in two tabs drawn here:
//  - Hunts: each outing with its day, time out, distance, climb, a small drawing of the walk, what you saved on the
//    way (sightings, sign, harvests: hunting points saved between its start and end), the zone, and the weather when it
//    started (wind, temperature, pressure trend, rain, moon), looked up once from Open-Meteo and kept in tf:huntCond.
//    A tap shows the walk on the map, with a bar to close it.
//  - What works: with 3 hunts or more, the share of hunts you saw animals on by wind, pressure, moon, time and cold.
// The header's "My rides" link follows the sport too: My tours in Skiing, My hunts in Hunting, the Fishing log in Fishing.
(() => {
  "use strict";
  const map = window.tfLeaflet;
  if (!map || !window.L) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sportNow = () => (document.body.classList.contains("sport-ski") ? "ski" : document.body.classList.contains("sport-hunt") ? "hunt" : document.body.classList.contains("sport-fish") ? "fish" : document.body.classList.contains("sport-moto") ? "moto" : "mtb");
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const COLOR = "#a34f00";
  const SEEN = ["sighting", "sign", "rub", "scrape", "bed", "harvest"];   // points that mean you found animals or their sign

  // ---------- the hunts (same database and stores as ride.html) ----------
  function loadHunts() {
    return new Promise((resolve) => {
      let r;
      try { r = indexedDB.open("trail-finder-rides", 1); } catch { resolve([]); return; }
      r.onupgradeneeded = () => {
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
          q.onsuccess = () => { db.close(); resolve((q.result || []).filter((x) => x.sport === "hunt" && x.points && x.points.length > 1).sort((a, b) => b.start - a.start)); };
          q.onerror = () => { db.close(); resolve([]); };
        } catch { db.close(); resolve([]); }
      };
    });
  }

  // ---------- the weather when each hunt started ----------
  let conds = {};
  try { conds = JSON.parse(localStorage.getItem("tf:huntCond") || "{}") || {}; } catch {}
  const saveConds = () => { try { localStorage.setItem("tf:huntCond", JSON.stringify(conds)); } catch {} };
  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const dirOf = (deg) => DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  const ymd = (t) => new Date(t).toISOString().slice(0, 10);
  function moonName(t) {
    const age = ((((t - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % 29.530589) + 29.530589) % 29.530589;
    return age < 1.85 ? "New moon" : age < 5.54 ? "Waxing crescent" : age < 9.23 ? "First quarter" : age < 12.92 ? "Waxing gibbous"
      : age < 16.61 ? "Full moon" : age < 20.3 ? "Waning gibbous" : age < 23.99 ? "Last quarter" : age < 27.68 ? "Waning crescent" : "New moon";
  }
  const timeWord = (t) => { const h = new Date(t).getHours(); return h < 5 ? "Night" : h < 9 ? "Early morning" : h < 12 ? "Morning" : h < 16 ? "Midday" : h < 20 ? "Evening" : "Night"; };
  async function lookUp(h) {
    const [lat, lon] = h.points[0], end = h.end || h.points[h.points.length - 1][3] || h.start;
    const old = Date.now() - h.start > 80 * 864e5;   // the forecast API keeps about 3 months, the archive the rest
    const url = `https://${old ? "archive-api" : "api"}.open-meteo.com/v1/${old ? "archive" : "forecast"}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
      + `&hourly=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,precipitation,cloud_cover&timeformat=unixtime&timezone=GMT`
      + `&start_date=${ymd(h.start - 864e5)}&end_date=${ymd(end)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const j = (await res.json()).hourly || {}, ts = j.time || [];
    if (!ts.length) throw new Error("no hours");
    const at = (t) => { let k = 0; for (let i = 0; i < ts.length; i++) if (Math.abs(ts[i] * 1000 - t) < Math.abs(ts[k] * 1000 - t)) k = i; return k; };
    const i = at(h.start), i3 = at(h.start - 3 * 36e5), ie = at(end), v = (k, n) => (j[k] && j[k][n] != null ? j[k][n] : null);
    if (v("temperature_2m", i) == null) throw new Error("no data yet");
    let rain = 0; for (let n = i; n <= ie; n++) rain += v("precipitation", n) || 0;
    const dp = v("pressure_msl", i) != null && v("pressure_msl", i3) != null ? v("pressure_msl", i) - v("pressure_msl", i3) : null;
    const c = { temp: Math.round(v("temperature_2m", i)), kmh: Math.round(v("wind_speed_10m", i) || 0), gust: Math.round(v("wind_gusts_10m", i) || 0),
      wind: v("wind_direction_10m", i) != null ? dirOf(v("wind_direction_10m", i)) : "", hpa: v("pressure_msl", i) != null ? Math.round(v("pressure_msl", i)) : null,
      trend: dp == null ? "" : dp <= -1 ? "Falling" : dp >= 1 ? "Rising" : "Steady", rain: Math.round(rain * 10) / 10, cloud: v("cloud_cover", i) };
    try { c.zone = window.tfHunt ? await Promise.race([window.tfHunt.zoneAt(lat, lon), new Promise((r) => setTimeout(() => r(""), 4000))]) : ""; } catch {}
    return c;
  }
  let filling = null;
  // Looks up the hunts with no weather yet (newest first, a few at a time); then() when something new came in.
  function fill(hunts) {
    if (filling) return filling;
    const todo = hunts.filter((h) => !conds[h.id] && Date.now() - h.start > 36e5).slice(0, 12);
    if (!todo.length) return Promise.resolve(false);
    filling = (async () => {
      let got = false;
      for (let i = 0; i < todo.length; i += 4) {   // four at a time
        await Promise.all(todo.slice(i, i + 4).map((h) => lookUp(h).then((c) => { conds[h.id] = c; got = true; }, () => {})));
      }
      if (got) saveConds();
      filling = null;
      return got;
    })();
    return filling;
  }

  // ---------- drawing ----------
  const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const dur = (ms) => { const m = Math.round(ms / 6e4); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
  const km = (m) => (m == null ? "" : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
  const endOf = (h) => h.end || h.points[h.points.length - 1][3] || h.start;
  const seasonOf = (t) => { const d = new Date(t), s = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${s}-${String((s + 1) % 100).padStart(2, "0")}`; };
  // The hunting points saved while you were out (a quarter hour of slack before, half an hour after).
  const pointsOf = (h, pts) => pts.filter((p) => p.created >= h.start - 9e5 && p.created <= endOf(h) + 18e5);
  function thumb(h, seen) {
    const pts = h.points, K = Math.cos(pts[0][0] * Math.PI / 180);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[1] * K); x1 = Math.max(x1, p[1] * K); y0 = Math.min(y0, p[0]); y1 = Math.max(y1, p[0]); }
    const S = 76, pad = 8, s = (S - 2 * pad) / Math.max(x1 - x0, y1 - y0, 1e-6);
    const ox = pad + (S - 2 * pad - (x1 - x0) * s) / 2, oy = pad + (S - 2 * pad - (y1 - y0) * s) / 2;
    const xy = (lat, lon) => [(ox + (lon * K - x0) * s).toFixed(1), (oy + (y1 - lat) * s).toFixed(1)];
    const step = Math.max(1, Math.floor(pts.length / 300));
    const line = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => xy(p[0], p[1]).join(",")).join(" ");
    const a = xy(pts[0][0], pts[0][1]);
    return `<svg class="hh-map" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" aria-hidden="true"><polyline points="${line}" fill="none" stroke="${COLOR}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`
      + seen.map((p) => { const b = xy(p.lat, p.lon); return `<circle cx="${b[0]}" cy="${b[1]}" r="3.2" fill="${p.kind === "harvest" ? "#c92a2a" : "#f08c00"}" stroke="#fff" stroke-width="1.2"/>`; }).join("")
      + `<circle cx="${a[0]}" cy="${a[1]}" r="3.4" fill="#2b8a3e" stroke="#fff" stroke-width="1.2"/></svg>`;
  }
  function condLine(c) {
    if (!c) return `<span class="hh-wx muted">Weather loading…</span>`;
    return `<span class="hh-wx">${[c.wind && (c.kmh < 5 ? "Calm" : `Wind ${c.wind} ${c.kmh} km/h`), `${c.temp}°`, c.trend && `pressure ${c.trend.toLowerCase()}`, c.rain >= 0.5 ? `${c.rain} mm rain` : "", c.moon && c.moon.toLowerCase()].filter(Boolean).map(esc).join(" · ")}</span>`;
  }
  const kindsLine = (seen, kinds) => {
    const by = {};
    for (const p of seen) by[p.kind] = (by[p.kind] || 0) + 1;
    return Object.entries(by).map(([k, n]) => { const d = kinds.find((x) => x[0] === k) || [k, k, "📍"]; return `${d[2]} ${n > 1 ? `${n} ` : ""}${esc(d[1].toLowerCase())}${n > 1 && !/s$/.test(d[1]) ? "s" : ""}`; }).join(", ");
  };

  function huntsHtml(hunts, pts, kinds) {
    if (!hunts.length) return `<p class="sp-empty">No hunts yet. When you head out, tap <b>${phone() ? "Track" : "Start tracking"}</b> and the app records your walk. Save it at the end and it shows here with the time you were out, how far you walked, a map of where you went, what you saved on the way (sightings, sign, harvests) and the wind and weather when you started.</p>
      <div class="sp-row"><button type="button" class="go" data-hh="start">▶ Start tracking a hunt</button></div>`;
    const by = new Map();
    for (const h of hunts) { const k = seasonOf(h.start); (by.get(k) || by.set(k, []).get(k)).push(h); }
    return [...by.entries()].map(([season, hs]) => {
      const dist = hs.reduce((n, h) => n + ((h.stats && h.stats.dist) || 0), 0), time = hs.reduce((n, h) => n + (endOf(h) - h.start), 0);
      const saw = hs.filter((h) => pointsOf(h, pts).some((p) => SEEN.includes(p.kind))).length;
      return `<div class="sp-season"><h3>${season} season</h3><span class="sp-meta">${hs.length} hunt${hs.length > 1 ? "s" : ""} · ${km(dist)} · ${dur(time)} out${saw ? ` · animals on ${saw}` : ""}</span></div>
        <ul class="hh-list">${hs.map((h) => {
          const mine = pointsOf(h, pts), seen = mine.filter((p) => p.kind !== "truck"), c = conds[h.id], st = h.stats || {};
          return `<li><button type="button" class="hh" data-hunt="${esc(h.id)}">${thumb(h, seen)}<span class="hh-tx">
            <b>${esc(h.title || "Hunt")}</b>
            <span class="sp-meta">${esc(fmtDay(h.start))}, ${esc(fmtTime(h.start))} to ${esc(fmtTime(endOf(h)))}${c && c.zone ? ` · ${esc(c.zone)}` : ""}</span>
            <span class="hh-nums">${esc(dur(endOf(h) - h.start))} · ${esc(km(st.dist))}${st.climb != null ? ` · ↑ ${Math.round(st.climb)} m` : ""}</span>
            ${seen.length ? `<span class="hh-seen">${kindsLine(seen, kinds)}</span>` : `<span class="hh-seen none">Nothing saved on the way</span>`}
            ${condLine(c && { ...c, moon: moonName(h.start) })}</span></button></li>`;
        }).join("")}</ul>`;
    }).join("") + `<p class="sp-meta">Tap a hunt to see your walk on the map. Photos, notes and GPX are in <a href="ride.html#rides">all your tracks</a>.</p>`;
  }

  function bars(title, rows) {
    const list = Object.entries(rows).filter(([k, r]) => k && r.n).sort((a, b) => b[1].saw / b[1].n - a[1].saw / a[1].n || b[1].n - a[1].n);
    if (!list.length) return "";
    return `<h3>${esc(title)}</h3><div class="sp-bars">${list.map(([k, r]) => `<span>${esc(k)}</span><span><i style="width:${Math.max(3, Math.round(r.saw / r.n * 100))}%"></i></span><b>${r.saw} of ${r.n}</b>`).join("")}</div>`;
  }
  function worksHtml(hunts, pts) {
    if (hunts.length < 3) return `<p class="sp-empty">Track a few hunts and this shows when you find animals: the wind, pressure, moon, time of day and cold on the hunts you saved a sighting, sign or harvest, next to the ones you didn't. ${hunts.length ? `${hunts.length} so far, 3 needed.` : ""}</p>`;
    const groups = { wind: {}, trend: {}, moon: {}, time: {}, temp: {} };
    const add = (g, k, saw) => { if (!k) return; const r = groups[g][k] || (groups[g][k] = { n: 0, saw: 0 }); r.n++; if (saw) r.saw++; };
    let withC = 0;
    for (const h of hunts) {
      const saw = pointsOf(h, pts).some((p) => SEEN.includes(p.kind)), c = conds[h.id];
      add("moon", moonName(h.start), saw); add("time", timeWord(h.start), saw);
      if (!c) continue;
      withC++;
      add("wind", c.wind && (c.kmh < 5 ? "Calm" : `From ${c.wind}`), saw); add("trend", c.trend && `${c.trend} pressure`, saw);
      add("temp", c.temp == null ? "" : c.temp <= -10 ? "Below -10°" : c.temp <= 0 ? "-10° to 0°" : c.temp <= 10 ? "0° to 10°" : "Above 10°", saw);
    }
    const all = hunts.filter((h) => pointsOf(h, pts).some((p) => SEEN.includes(p.kind))).length;
    const best = (g) => { const e = Object.entries(groups[g]).filter(([, r]) => r.n >= 2).sort((a, b) => b[1].saw / b[1].n - a[1].saw / a[1].n)[0]; return e && e[1].saw ? e[0] : ""; };
    const tops = [best("wind") && `wind ${best("wind").toLowerCase()}`, best("trend").toLowerCase(), best("time").toLowerCase(), best("moon").toLowerCase()].filter(Boolean);
    return `<p class="sp-best"><b>You found animals on ${all} of ${hunts.length} hunts.</b>${tops.length ? ` Best so far: ${esc(tops.join(", "))}.` : ""}</p>
      ${bars("Wind", groups.wind)}${bars("Pressure", groups.trend)}${bars("Time you set out", groups.time)}${bars("Moon", groups.moon)}${bars("Temperature", groups.temp)}
      <p class="sp-meta">A hunt counts when you saved a sighting, tracks, a rub, scrape, bed or harvest point while you were out. ${withC < hunts.length ? `Weather is in for ${withC} of ${hunts.length}. ` : ""}More hunts make the patterns surer.</p>`;
  }

  // ---------- one hunt on the map ----------
  let shown = null;
  const bar = document.createElement("div");
  bar.className = "hh-bar"; bar.hidden = true;
  map.getContainer().append(bar);
  L.DomEvent.disableClickPropagation(bar);
  function hide() { if (shown) { map.removeLayer(shown); shown = null; } bar.hidden = true; }
  function show(h, pts, kinds) {
    hide();
    const ll = h.points.map((p) => [p[0], p[1]]), seen = pointsOf(h, pts).filter((p) => p.kind !== "truck");
    shown = L.layerGroup([
      L.polyline(ll, { color: "#fff", weight: 8, opacity: 0.9, interactive: false }),
      L.polyline(ll, { color: COLOR, weight: 4.5, opacity: 1, interactive: false }),
      L.circleMarker(ll[0], { radius: 7, color: "#fff", weight: 2.5, fillColor: "#2b8a3e", fillOpacity: 1, interactive: false }),
      L.circleMarker(ll[ll.length - 1], { radius: 6, color: "#fff", weight: 2.5, fillColor: "#343a40", fillOpacity: 1, interactive: false }),
      ...seen.map((p) => { const d = kinds.find((x) => x[0] === p.kind); return L.marker([p.lat, p.lon], { interactive: false, icon: L.divIcon({ className: "hh-pin", html: d ? d[2] : "📍", iconSize: [26, 26], iconAnchor: [13, 13] }) }); }),
    ]).addTo(map);
    const st = h.stats || {};
    bar.innerHTML = `<span><b>${esc(h.title || "Hunt")}</b><small>${esc(fmtDay(h.start))} · ${esc(dur(endOf(h) - h.start))} · ${esc(km(st.dist))}</small></span><button type="button" aria-label="Close the hunt">✕</button>`;
    bar.querySelector("button").addEventListener("click", hide);
    bar.hidden = false;
    if (phone()) { const b = document.querySelector('#tabbar [data-nav="map"]'); if (b) b.click(); }
    // Framed by hand above the phone's sheet: Leaflet's fitBounds padding is off on the rotatable map (as fish-route.js).
    const b = L.latLngBounds(ll), [tl, br] = phone() ? [[30, 130], [30, 150]] : [[60, 90], [60, 60]];
    setTimeout(() => {
      const z = Math.min(17, map.getBoundsZoom(b, false, L.point(tl[0] + br[0], tl[1] + br[1])));
      const c = map.project(b.getCenter(), z).add(L.point((br[0] - tl[0]) / 2, (br[1] - tl[1]) / 2));
      map.setView(map.unproject(c, z), z);
    }, 350);
  }
  window.addEventListener("tf:sport", () => { if (sportNow() !== "hunt") hide(); syncLink(); });

  const css = document.createElement("style");
  css.textContent = `
dialog.sp-log .hh-list { list-style: none; margin: 0 0 6px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
dialog.sp-log button.hh { display: flex; gap: 10px; width: 100%; text-align: left; align-items: flex-start; padding: 8px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); color: var(--fg); font: inherit; cursor: pointer; }
dialog.sp-log button.hh:hover { border-color: ${COLOR}; }
dialog.sp-log .hh-map { flex: none; border-radius: 9px; background: color-mix(in srgb, ${COLOR} 8%, var(--chip, #eee)); }
dialog.sp-log .hh-tx { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: .84rem; }
dialog.sp-log .hh-tx b { font-size: .95rem; }
dialog.sp-log .hh-tx .sp-meta { margin: 0; }
dialog.sp-log .hh-nums { font-weight: 700; font-variant-numeric: tabular-nums; }
dialog.sp-log .hh-seen.none, dialog.sp-log .hh-wx.muted { color: var(--muted); }
dialog.sp-log .hh-wx { color: var(--muted); font-size: .78rem; }
body.sport-hunt dialog.sp-log .sp-bars i { background: ${COLOR}; }
@media (max-width: 520px) { body.sport-hunt dialog.sp-log .sp-tabs { display: grid; grid-template-columns: 1fr 1fr; } }
.hh-bar { position: absolute; z-index: 800; top: 12px; left: 50%; transform: translateX(-50%); max-width: calc(100% - 140px); display: flex; align-items: center; gap: 10px;
  padding: 7px 8px 7px 14px; border-radius: 14px; background: var(--bg, #fff); color: var(--fg); box-shadow: 0 2px 10px rgba(0,0,0,.25); border-left: 5px solid ${COLOR}; }
.hh-bar[hidden] { display: none; }
.hh-bar span { display: flex; flex-direction: column; min-width: 0; font-size: .86rem; }
.hh-bar b, .hh-bar small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hh-bar small { color: var(--muted); }
.hh-bar button { flex: none; width: 34px; height: 34px; border-radius: 50%; border: 1px solid var(--line); background: var(--chip, #eee); color: var(--fg); font-size: 1rem; cursor: pointer; }
@media (max-width: 760px) { .hh-bar { top: calc(env(safe-area-inset-top, 0px) + 84px); left: 12px; right: 12px; transform: none; max-width: none; } .hh-bar span { flex: 1; } }   /* under the map buttons */
.hh-pin { display: grid; place-items: center; font-size: 15px; background: #fff; border-radius: 50%; border: 2px solid ${COLOR}; box-shadow: 0 1px 4px rgba(0,0,0,.3); }`;
  document.head.append(css);

  // ---------- the header link follows the sport ----------
  const link = document.getElementById("myRidesLink");
  const LINK = {
    mtb: ["🚴 My rides", "Your recorded and imported rides (GPX, Strava archive) and stats"],
    ski: ["⛷ My tours", "Your recorded and imported ski tours"],
    hunt: ["🦌 My hunts", "Your hunts (where you walked, the weather, what you saw), harvests and trail cameras"],
    fish: ["🎣 Fishing log", "Your catches and what works for you"],
    moto: ["🏍 My moto rides", "Your moto rides: where you went, km of dirt, the weather"],
  };
  function syncLink() {
    if (!link) return;
    const [text, title] = LINK[sportNow()];
    link.textContent = text; link.title = title;
  }
  if (link) link.addEventListener("click", (e) => {
    const sp = sportNow();
    if (sp === "moto" && window.tfMoto) { e.preventDefault(); window.tfMoto.openLog(); return; }
    if ((sp === "hunt" || sp === "fish") && window.tfPoints) { e.preventDefault(); window.tfPoints.openLog(sp === "hunt" ? "hunts" : undefined); }
  });
  syncLink();

  window.tfHunts = {
    load: loadHunts, fill, huntsHtml, worksHtml, hide, linkText: () => LINK[sportNow()][0],
    // Wires a rendered tab: tap a hunt to show it, the start button to start tracking.
    wire(box, hunts, pts, kinds, close) {
      box.querySelectorAll("[data-hunt]").forEach((b) => b.addEventListener("click", () => { const h = hunts.find((x) => x.id === b.dataset.hunt); if (h) { close(); show(h, pts, kinds); } }));
      const st = box.querySelector('[data-hh="start"]');
      if (st) st.addEventListener("click", () => { close(); if (window.tfRide) window.tfRide.start(); });
    },
  };
  // ride.html sends a saved hunt back here: #myhunts opens My hunts.
  if (location.hash === "#myhunts") {
    history.replaceState(null, "", location.pathname + location.search);
    const go = () => (window.tfPoints && sportNow() === "hunt" ? window.tfPoints.openLog("hunts") : null);
    window.addEventListener("load", () => setTimeout(go, 600));
  }
})();
